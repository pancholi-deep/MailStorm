"""JobQueue: transactional operations for queue."""

import uuid
from sqlalchemy import select, update, delete, func
from backend.core.config import settings
from backend.jobs.database import campaigns, recipients, attempts, accounts, authorizations, gate
from backend.ports import AuthorizationRequired
from backend.jobs.state import ACTIVE, STATE_COLUMNS, LostLease


class JobQueue:
    def __init__(self, database, vault):
        self.database = database
        self.vault = vault

    def claim(self, worker):
        with self.database.transaction() as db:
            now = self.database.now(db)
            # Recover interrupted provider calls conservatively before any work is reclaimed.
            expired = (
                db.execute(
                    select(*STATE_COLUMNS)
                    .where(campaigns.c.lease_owner.is_not(None), campaigns.c.lease_until <= now)
                    .limit(50)
                )
                .mappings()
                .all()
            )
            for row in expired:
                changed = db.execute(
                    update(recipients)
                    .where(recipients.c.campaign == row["id"], recipients.c.state == "submitting")
                    .values(state="unknown", error="worker_lost", updated=now)
                ).rowcount
                db.execute(
                    update(attempts)
                    .where(attempts.c.campaign == row["id"], attempts.c.state == "submitting")
                    .values(state="unknown", error="worker_lost")
                )
                db.execute(
                    update(campaigns)
                    .where(campaigns.c.id == row["id"])
                    .values(
                        lease_owner=None,
                        lease_until=0,
                        unknown=row["unknown"] + changed,
                        state="cancelled"
                        if row["cancel_requested"]
                        else ("importing" if row["state"] == "importing" else "queued"),
                    )
                )
            active = db.scalar(
                select(func.count()).select_from(campaigns).where(campaigns.c.lease_until > now)
            )
            if active >= settings.max_active_batches:
                return None
            busy = select(campaigns.c.owner).where(campaigns.c.lease_until > now)
            row = (
                db.execute(
                    select(campaigns)
                    .where(
                        campaigns.c.state.in_(ACTIVE),
                        campaigns.c.next_at <= now,
                        campaigns.c.lease_until <= now,
                        campaigns.c.cancel_requested == False,
                        campaigns.c.owner.not_in(busy),
                    )
                    .order_by(campaigns.c.updated, campaigns.c.id)
                    .limit(1)
                )
                .mappings()
                .first()
            )
            if not row:
                return None
            row = dict(row)
            row["generation"] += 1
            row["lease_owner"] = worker
            db.execute(
                update(campaigns)
                .where(campaigns.c.id == row["id"])
                .values(
                    lease_owner=worker,
                    generation=row["generation"],
                    lease_until=now + settings.lease_seconds,
                    updated=now,
                )
            )
            row["template"] = self.vault.open(row["secret"])
            return row

    def fenced(self, db, job):
        row = (
            db.execute(
                select(*STATE_COLUMNS).where(
                    campaigns.c.id == job["id"],
                    campaigns.c.lease_owner == job["lease_owner"],
                    campaigns.c.generation == job["generation"],
                    campaigns.c.lease_until > self.database.now(db),
                )
            )
            .mappings()
            .first()
        )
        if not row:
            raise LostLease()
        return row

    def heartbeat(self, job):
        with self.database.transaction() as db:
            self.fenced(db, job)
            db.execute(
                update(campaigns)
                .where(campaigns.c.id == job["id"])
                .values(lease_until=self.database.now(db) + settings.lease_seconds)
            )

    def release(self, job, state=None, error=None, delay=0):
        with self.database.transaction() as db:
            row = self.fenced(db, job)
            now = self.database.now(db)
            values = dict(
                lease_owner=None, lease_until=0, updated=now, next_at=now + delay, error=error
            )
            values["state"] = "cancelled" if row["cancel_requested"] else state or row["state"]
            db.execute(update(campaigns).where(campaigns.c.id == job["id"]).values(**values))

    def begin_import(self, job):
        with self.database.transaction() as db:
            self.fenced(db, job)
            db.execute(delete(recipients).where(recipients.c.campaign == job["id"]))
            db.execute(update(campaigns).where(campaigns.c.id == job["id"]).values(total=0))

    def import_chunk(self, job, rows):
        values = [
            dict(
                campaign=job["id"],
                row_no=row_no,
                secret=self.vault.seal(recipient),
                state="pending",
                updated=0,
            )
            for row_no, recipient in rows
        ]
        with self.database.transaction() as db:
            row = self.fenced(db, job)
            if row["cancel_requested"]:
                return False
            db.execute(recipients.insert(), values)
            db.execute(
                update(campaigns)
                .where(campaigns.c.id == job["id"])
                .values(total=row["total"] + len(values))
            )
        return True

    def connection(self, job):
        with self.database.engine.connect() as db:
            row = (
                db.execute(select(authorizations).where(authorizations.c.owner == job["owner"]))
                .mappings()
                .first()
            )
            if not row:
                raise AuthorizationRequired("Gmail is disconnected. Sign in again to reconnect.")
            profile = db.scalar(select(accounts.c.secret).where(accounts.c.owner == job["owner"]))
        return {**self.vault.open(profile), **self.vault.open(row["secret"])}, row["version"]

    def finish_import(self, job):
        with self.database.transaction() as db:
            self.fenced(db, job)
            db.execute(update(campaigns).where(campaigns.c.id == job["id"]).values(imported=True))

    def save_connection(self, job, secret, version):
        with self.database.transaction() as db:
            self.fenced(db, job)
            credentials = {key: secret.get(key) for key in ("token", "refresh_token", "expires_at")}
            changed = db.execute(
                update(authorizations)
                .where(
                    authorizations.c.owner == job["owner"],
                    authorizations.c.version == version,
                )
                .values(
                    secret=self.vault.seal(credentials),
                    version=version + 1,
                    updated=self.database.now(db),
                )
            ).rowcount
            if not changed:
                raise AuthorizationRequired("Gmail authorization changed. Please try again.")

    def next_recipient(self, job):
        with self.database.transaction() as db:
            campaign = self.fenced(db, job)
            now = self.database.now(db)
            if campaign["cancel_requested"]:
                return None, "cancelled", 0
            if not db.scalar(
                select(authorizations.c.owner).where(authorizations.c.owner == job["owner"])
            ):
                return None, "awaiting_auth", 0
            row = (
                db.execute(
                    select(recipients)
                    .where(
                        recipients.c.campaign == job["id"],
                        recipients.c.state.in_(("pending", "retry_wait")),
                    )
                    .order_by(recipients.c.row_no)
                    .limit(1)
                )
                .mappings()
                .first()
            )
            if not row:
                return None, "complete", 0
            connection = (
                db.execute(select(accounts).where(accounts.c.owner == job["owner"]))
                .mappings()
                .one()
            )
            project_at = db.scalar(select(gate.c.next_at).where(gate.c.id == 1))
            wait = max(connection["next_at"], project_at) - now
            if wait > 0:
                return None, "queued", wait
            db.execute(
                update(accounts)
                .where(accounts.c.owner == job["owner"])
                .values(next_at=now + settings.sender_interval)
            )
            db.execute(
                update(gate).where(gate.c.id == 1).values(next_at=now + settings.project_interval)
            )
            db.execute(
                update(authorizations)
                .where(authorizations.c.owner == job["owner"])
                .values(updated=now)
            )
            attempt_id = uuid.uuid4().hex
            db.execute(
                update(recipients)
                .where(recipients.c.campaign == job["id"], recipients.c.row_no == row["row_no"])
                .values(state="submitting", attempts=row["attempts"] + 1, updated=now)
            )
            db.execute(
                attempts.insert().values(
                    id=attempt_id,
                    campaign=job["id"],
                    row_no=row["row_no"],
                    state="submitting",
                    created=now,
                )
            )
            db.execute(update(campaigns).where(campaigns.c.id == job["id"]).values(state="running"))
            return dict(row, attempt_id=attempt_id, data=self.vault.open(row["secret"])), None, 0

    def defer_sender(self, job, delay, project=False):
        with self.database.transaction() as db:
            self.fenced(db, job)
            until = self.database.now(db) + delay
            db.execute(
                update(accounts)
                .where(accounts.c.owner == job["owner"], accounts.c.next_at < until)
                .values(next_at=until)
            )
            if project:
                db.execute(
                    update(gate).where(gate.c.id == 1, gate.c.next_at < until).values(next_at=until)
                )

    def outcome(self, job, recipient, state, provider_id=None, error=None):
        with self.database.transaction() as db:
            self.fenced(db, job)
            now = self.database.now(db)
            db.execute(
                update(recipients)
                .where(
                    recipients.c.campaign == job["id"], recipients.c.row_no == recipient["row_no"]
                )
                .values(state=state, provider_id=provider_id, error=error, updated=now)
            )
            db.execute(
                update(attempts)
                .where(attempts.c.id == recipient["attempt_id"])
                .values(state=state, provider_id=provider_id, error=error)
            )
            field = {
                "accepted": "accepted",
                "permanently_failed": "failed",
                "unknown": "unknown",
            }.get(state)
            if field:
                db.execute(
                    update(campaigns)
                    .where(campaigns.c.id == job["id"])
                    .values({field: campaigns.c[field] + 1})
                )
