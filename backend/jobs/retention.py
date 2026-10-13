"""RetentionRepository: transactional operations for retention."""

from sqlalchemy import select, update, delete
from backend.core.config import settings
from backend.jobs.database import (
    campaigns,
    sessions,
    uploads,
    accounts,
    authorizations,
    saved_campaigns,
)
from backend.jobs.state import TERMINAL


class RetentionRepository:
    def __init__(self, database):
        self.database = database

    def cleanup(self):
        with self.database.transaction() as db:
            now = self.database.now(db)
            db.execute(
                delete(sessions).where(
                    sessions.c.hash.in_(
                        select(sessions.c.hash).where(sessions.c.expires < now).limit(1000)
                    )
                )
            )
            db.execute(
                delete(campaigns).where(
                    campaigns.c.id.in_(
                        select(campaigns.c.id)
                        .where(
                            campaigns.c.state.in_(TERMINAL),
                            campaigns.c.lease_until <= now,
                            campaigns.c.updated < now - settings.retention_seconds,
                        )
                        .limit(25)
                    )
                )
            )
            orphaned = (
                db.execute(
                    select(uploads.c.id)
                    .where(
                        uploads.c.created < now - 3600,
                        uploads.c.id.not_in(select(campaigns.c.upload_id)),
                        uploads.c.id.not_in(select(saved_campaigns.c.upload_id)),
                    )
                    .limit(250)
                )
                .scalars()
                .all()
            )
            # Claim orphan objects before leaving the transaction; new references must
            # require state=uploaded, so a cleanup candidate cannot become live again.
            if orphaned:
                db.execute(
                    update(uploads).where(uploads.c.id.in_(orphaned)).values(state="deleting")
                )
            db.execute(
                delete(accounts).where(
                    accounts.c.updated < now - settings.retention_seconds,
                    accounts.c.owner.not_in(select(authorizations.c.owner)),
                    accounts.c.disconnect_until <= now,
                    accounts.c.owner.not_in(select(campaigns.c.owner)),
                    accounts.c.owner.not_in(select(sessions.c.owner)),
                    accounts.c.owner.not_in(select(saved_campaigns.c.owner)),
                )
            )
            # Delete objects first; rows remain until deletion succeeds, making cleanup retryable.
            return orphaned

    def delete_upload_record(self, identifier):
        with self.database.transaction() as db:
            db.execute(delete(uploads).where(uploads.c.id == identifier))
