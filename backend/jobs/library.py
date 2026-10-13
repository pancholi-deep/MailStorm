"""Reusable campaign definitions. Delivery jobs keep their own immutable template snapshot."""

from fastapi import HTTPException
from sqlalchemy import select, update, delete, func
from backend.jobs.database import saved_campaigns, uploads
from backend.jobs.importer import recipient_chunks
from backend.ports import UploadReader, ObjectReader

MAX_SAVED_CAMPAIGNS = 100


class Library:
    def __init__(self, database, vault, uploads: UploadReader):
        self.database = database
        self.vault = vault
        self.uploads = uploads

    def row(self, db, owner, identifier):
        row = (
            db.execute(
                select(saved_campaigns).where(
                    saved_campaigns.c.id == identifier, saved_campaigns.c.owner == owner
                )
            )
            .mappings()
            .first()
        )
        if not row:
            raise HTTPException(404, "Saved campaign not found")
        return row

    def serialize(self, row, detail=False):
        result = {
            key: row[key] for key in ("id", "revision", "recipient_count", "created", "updated")
        }
        result.update(self.vault.open(row["label"]))
        if detail:
            result.update(self.vault.open(row["secret"]), upload_id=row["upload_id"])
        return result

    def get(self, owner, identifier):
        with self.database.engine.connect() as db:
            return self.serialize(self.row(db, owner, identifier), True)

    def listing(self, owner):
        with self.database.engine.connect() as db:
            # Content can be large: the library listing fetches encrypted labels only.
            columns = [
                c for c in saved_campaigns.c if c.name not in ("secret", "upload_id", "owner")
            ]
            rows = (
                db.execute(
                    select(*columns)
                    .where(saved_campaigns.c.owner == owner)
                    .order_by(saved_campaigns.c.updated.desc(), saved_campaigns.c.id)
                    .limit(MAX_SAVED_CAMPAIGNS)
                )
                .mappings()
                .all()
            )
        return [self.serialize(row) for row in rows]

    def save(self, objects: ObjectReader, owner, identifier, data, revision=None):
        if revision is not None:
            current = self.get(owner, identifier)
            if current["revision"] != revision:
                raise HTTPException(
                    409,
                    "This campaign changed in another tab. Reopen it or save your edits as a new copy.",
                )
        upload = self.uploads.upload(owner, data["upload_id"])
        if upload["state"] != "uploaded":
            raise HTTPException(409, "Complete a new contact upload before saving")
        template = {key: data[key] for key in ("subject", "body", "is_html")}
        # Validate all recipients against this template without loading the whole list.
        try:
            count = sum(len(chunk) for chunk in recipient_chunks(objects, upload, template))
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc
        except FileNotFoundError as exc:
            raise HTTPException(
                409, "Contact upload is no longer available; upload the CSV again"
            ) from exc
        label = {"name": data["name"], "filename": data["filename"]}
        with self.database.transaction() as db:
            now = self.database.now(db)
            # Cleanup marks objects deleting under this same transaction lock.
            if not db.scalar(
                select(uploads.c.id).where(
                    uploads.c.id == upload["id"],
                    uploads.c.owner == owner,
                    uploads.c.state == "uploaded",
                )
            ):
                raise HTTPException(409, "Contact upload expired; upload it again")
            existing = (
                db.execute(select(saved_campaigns).where(saved_campaigns.c.id == identifier))
                .mappings()
                .first()
            )
            values = dict(
                upload_id=upload["id"],
                label=self.vault.seal(label),
                secret=self.vault.seal(template),
                recipient_count=count,
                updated=now,
            )
            if revision is None:
                if existing:
                    if (
                        existing["owner"] == owner
                        and existing["upload_id"] == upload["id"]
                        and self.vault.open(existing["label"]) == label
                        and self.vault.open(existing["secret"]) == template
                    ):
                        return self.serialize(
                            existing, True
                        )  # Safe retry of a lost create response.
                    raise HTTPException(409, "Save identifier is already in use; create a new copy")
                total = db.scalar(
                    select(func.count())
                    .select_from(saved_campaigns)
                    .where(saved_campaigns.c.owner == owner)
                )
                if total >= MAX_SAVED_CAMPAIGNS:
                    raise HTTPException(
                        409, "You can save up to 100 campaigns. Delete one before creating another."
                    )
                db.execute(
                    saved_campaigns.insert().values(
                        id=identifier, owner=owner, revision=1, created=now, **values
                    )
                )
            else:
                if not existing or existing["owner"] != owner:
                    raise HTTPException(404, "Saved campaign not found")
                if existing["revision"] != revision:
                    raise HTTPException(
                        409,
                        "This campaign changed in another tab. Reopen it or save your edits as a new copy.",
                    )
                db.execute(
                    update(saved_campaigns)
                    .where(saved_campaigns.c.id == identifier)
                    .values(revision=revision + 1, **values)
                )
            return self.serialize(self.row(db, owner, identifier), True)

    def remove(self, owner, identifier, revision):
        with self.database.transaction() as db:
            row = self.row(db, owner, identifier)
            if row["revision"] != revision:
                raise HTTPException(
                    409, "This campaign changed in another tab. Reopen it before deleting."
                )
            db.execute(delete(saved_campaigns).where(saved_campaigns.c.id == identifier))
        # Contact objects remain while referenced by other saved campaigns or sends.
