"""CampaignRepository: transactional operations for campaigns."""

import hashlib
import json
import uuid
from sqlalchemy import select, update, func
from fastapi import HTTPException
from backend.core.config import settings
from backend.jobs.database import authorizations, campaigns, uploads, recipients
from backend.jobs.state import ACTIVE, STATE_COLUMNS, STATUS_FIELDS


class CampaignRepository:
    def __init__(self, database, vault):
        self.database = database
        self.vault = vault

    def create(self, owner, key, upload_id, subject, body, is_html, field_mapping=None):
        template = {"subject": subject, "body": body, "is_html": is_html}
        if field_mapping:
            template["field_mapping"] = field_mapping
        with self.database.transaction() as db:
            now = self.database.now(db)
            upload = (
                db.execute(
                    select(uploads).where(
                        uploads.c.id == upload_id,
                        uploads.c.owner == owner,
                        uploads.c.state == "uploaded",
                    )
                )
                .mappings()
                .first()
            )
            if not upload:
                raise HTTPException(409, "Upload must be completed first")
            fingerprint = hashlib.sha256(
                json.dumps([upload["sha256"], template], sort_keys=True).encode()
            ).hexdigest()
            existing = (
                db.execute(
                    select(campaigns.c.id, campaigns.c.fingerprint).where(
                        campaigns.c.owner == owner, campaigns.c.key == key
                    )
                )
                .mappings()
                .first()
            )
            if existing:
                if existing["fingerprint"] != fingerprint:
                    raise HTTPException(
                        409, "This batch identifier belongs to different message content."
                    )
                return existing["id"]
            if not db.scalar(select(authorizations.c.owner).where(authorizations.c.owner == owner)):
                raise HTTPException(409, "Gmail is disconnected. Sign in again before sending.")
            count = lambda condition: db.scalar(
                select(func.count())
                .select_from(campaigns)
                .where(campaigns.c.state.in_(ACTIVE), condition)
            )
            if (
                count(campaigns.c.owner == owner) >= settings.max_queued_per_owner
                or count(True) >= settings.max_queued_total
            ):
                raise HTTPException(
                    429,
                    "Campaign queue is full. Please try again later.",
                    headers={"Retry-After": "30"},
                )
            identifier = uuid.uuid4().hex
            db.execute(
                campaigns.insert().values(
                    id=identifier,
                    owner=owner,
                    key=key,
                    fingerprint=fingerprint,
                    upload_id=upload_id,
                    secret=self.vault.seal(template),
                    state="importing",
                    created=now,
                    updated=now,
                    next_at=now,
                )
            )
            return identifier

    def status(self, owner, identifier):
        with self.database.engine.connect() as db:
            row = (
                db.execute(
                    select(*STATE_COLUMNS).where(
                        campaigns.c.id == identifier, campaigns.c.owner == owner
                    )
                )
                .mappings()
                .first()
            )
        if not row:
            raise HTTPException(404, "Campaign not found")
        return {key: row[key] for key in STATUS_FIELDS}

    def list_campaigns(self, owner):
        with self.database.engine.connect() as db:
            rows = (
                db.execute(
                    select(*(campaigns.c[key] for key in STATUS_FIELDS))
                    .where(campaigns.c.owner == owner)
                    .order_by(campaigns.c.created.desc())
                    .limit(50)
                )
                .mappings()
                .all()
            )
        return [dict(row) for row in rows]

    def result_page(self, owner, identifier, after=0, limit=100):
        self.status(owner, identifier)
        with self.database.engine.connect() as db:
            rows = (
                db.execute(
                    select(recipients)
                    .where(recipients.c.campaign == identifier, recipients.c.row_no > after)
                    .order_by(recipients.c.row_no)
                    .limit(limit)
                )
                .mappings()
                .all()
            )
        return [
            dict(
                row_no=row["row_no"],
                state=row["state"],
                provider_id=row["provider_id"],
                error=row["error"],
                **self.vault.open(row["secret"]),
            )
            for row in rows
        ]

    def cancel(self, owner, identifier):
        with self.database.transaction() as db:
            row = (
                db.execute(
                    select(*STATE_COLUMNS).where(
                        campaigns.c.id == identifier, campaigns.c.owner == owner
                    )
                )
                .mappings()
                .first()
            )
            if not row:
                raise HTTPException(404, "Campaign not found")
            if row["state"] != "complete":
                now = self.database.now(db)
                db.execute(
                    update(campaigns)
                    .where(campaigns.c.id == identifier)
                    .values(
                        cancel_requested=True,
                        updated=now,
                        state=row["state"] if row["lease_until"] > now else "cancelled",
                    )
                )

    def retry(self, owner, identifier):
        with self.database.transaction() as db:
            row = (
                db.execute(
                    select(*STATE_COLUMNS).where(
                        campaigns.c.id == identifier, campaigns.c.owner == owner
                    )
                )
                .mappings()
                .first()
            )
            if not row:
                raise HTTPException(404, "Campaign not found")
            now = self.database.now(db)
            if row["state"] == "invalid":
                raise HTTPException(409, "Correct the file and create a new campaign")
            if row["lease_until"] > now:
                raise HTTPException(409, "Campaign is still stopping")
            if not db.scalar(select(authorizations.c.owner).where(authorizations.c.owner == owner)):
                raise HTTPException(409, "Gmail is disconnected. Sign in again before sending.")
            # Unknown and permanent failures are never automatically replayed.
            db.execute(
                update(campaigns)
                .where(campaigns.c.id == identifier)
                .values(
                    state="queued" if row["imported"] else "importing",
                    cancel_requested=False,
                    error=None,
                    next_at=now,
                    updated=now,
                )
            )
