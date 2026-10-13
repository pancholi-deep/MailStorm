"""Gmail grants have a lifecycle independent of account and campaign ownership."""

from fastapi import HTTPException
from sqlalchemy import select, update, delete, or_, case
from backend.core.config import settings
from backend.jobs.database import accounts, authorizations, campaigns
from backend.jobs.state import ACTIVE


class AuthorizationRepository:
    def __init__(self, database, vault):
        self.database, self.vault = database, vault

    def status(self, owner):
        with self.database.engine.connect() as db:
            row = (
                db.execute(
                    select(
                        accounts.c.revocation_pending,
                        authorizations.c.owner.label("authorized_owner"),
                    )
                    .select_from(
                        accounts.outerjoin(
                            authorizations, accounts.c.owner == authorizations.c.owner
                        )
                    )
                    .where(accounts.c.owner == owner)
                )
                .mappings()
                .first()
            )
        if not row:
            raise HTTPException(401, "Your session has expired. Please sign in again.")
        return {
            "connected": bool(row["authorized_owner"]),
            "revocation_pending": row["revocation_pending"],
        }

    def expired_owners(self):
        with self.database.engine.connect() as db:
            now = self.database.now(db)
            busy = select(campaigns.c.owner).where(
                or_(campaigns.c.state.in_(ACTIVE), campaigns.c.lease_until > now)
            )
            return list(
                db.scalars(
                    select(authorizations.c.owner)
                    .where(
                        authorizations.c.updated < now - settings.authorization_retention_seconds,
                        authorizations.c.owner.not_in(busy),
                    )
                    .limit(10)
                )
            )

    def disconnect(self, owner, *, only_if_expired=False):
        with self.database.transaction() as db:
            now = self.database.now(db)
            account = (
                db.execute(select(accounts).where(accounts.c.owner == owner)).mappings().first()
            )
            if not account:
                if only_if_expired:
                    return None
                raise HTTPException(401, "Your session has expired. Please sign in again.")
            if account["disconnect_until"] > now:
                if only_if_expired:
                    return None
                raise HTTPException(
                    409, "Gmail disconnection is in progress. Please try again shortly."
                )
            grant = (
                db.execute(select(authorizations).where(authorizations.c.owner == owner))
                .mappings()
                .first()
            )
            if not grant:
                return None
            if only_if_expired:
                busy = db.scalar(
                    select(campaigns.c.id)
                    .where(
                        campaigns.c.owner == owner,
                        or_(campaigns.c.state.in_(ACTIVE), campaigns.c.lease_until > now),
                    )
                    .limit(1)
                )
                if busy or grant["updated"] >= now - settings.authorization_retention_seconds:
                    return None
            secret = self.vault.open(grant["secret"])
            version = max(account["version"], grant["version"]) + 1
            db.execute(
                update(accounts)
                .where(accounts.c.owner == owner)
                .values(version=version, disconnect_until=now + 60, revocation_pending=True)
            )
            # Detach first: even a failed Google request must stop this application sending.
            db.execute(delete(authorizations).where(authorizations.c.owner == owner))
            db.execute(
                update(campaigns)
                .where(
                    campaigns.c.owner == owner,
                    campaigns.c.state.in_((*ACTIVE, "blocked", "awaiting_auth")),
                )
                .values(
                    cancel_requested=True,
                    updated=now,
                    state=case(
                        (campaigns.c.lease_until > now, campaigns.c.state), else_="cancelled"
                    ),
                )
            )
            return {"version": version, "token": secret.get("refresh_token") or secret.get("token")}

    def finish_disconnect(self, owner, version, confirmed):
        with self.database.transaction() as db:
            db.execute(
                update(accounts)
                .where(accounts.c.owner == owner, accounts.c.version == version)
                .values(disconnect_until=0, revocation_pending=not confirmed)
            )
