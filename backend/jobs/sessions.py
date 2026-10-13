"""SessionRepository: transactional operations for sessions."""

import hashlib
import secrets
from sqlalchemy import select, update, delete
from fastapi import HTTPException
from backend.core.config import settings
from backend.jobs.database import accounts, authorizations, sessions, campaigns


class SessionRepository:
    def __init__(self, database, vault):
        self.database = database
        self.vault = vault

    def login(self, info, token, refresh_token, expires_at):
        owner = hashlib.sha256(info["sub"].encode()).hexdigest()
        session = secrets.token_urlsafe(32)
        with self.database.transaction() as db:
            now = self.database.now(db)
            existing = (
                db.execute(select(accounts).where(accounts.c.owner == owner)).mappings().first()
            )
            if existing and existing["disconnect_until"] > now:
                raise HTTPException(
                    409, "Gmail disconnection is in progress. Please try again shortly."
                )
            grant = (
                db.execute(select(authorizations).where(authorizations.c.owner == owner))
                .mappings()
                .first()
            )
            old = self.vault.open(grant["secret"]) if grant else {}
            version = (
                max(existing["version"] if existing else 0, grant["version"] if grant else 0) + 1
            )
            value = {
                "token": token,
                "refresh_token": refresh_token or old.get("refresh_token"),
                "expires_at": expires_at,
            }
            profile = {"name": info.get("name", ""), "email": info["email"]}
            if existing:
                db.execute(
                    update(accounts)
                    .where(accounts.c.owner == owner)
                    .values(
                        secret=self.vault.seal(profile),
                        version=version,
                        updated=now,
                        revocation_pending=False,
                        disconnect_until=0,
                    )
                )
            else:
                db.execute(
                    accounts.insert().values(
                        owner=owner,
                        secret=self.vault.seal(profile),
                        next_at=0,
                        updated=now,
                        version=version,
                    )
                )
            if grant:
                db.execute(
                    update(authorizations)
                    .where(authorizations.c.owner == owner)
                    .values(secret=self.vault.seal(value), version=version, updated=now)
                )
            else:
                db.execute(
                    authorizations.insert().values(
                        owner=owner, secret=self.vault.seal(value), version=version, updated=now
                    )
                )
            db.execute(
                sessions.insert().values(
                    hash=hashlib.sha256(session.encode()).hexdigest(),
                    owner=owner,
                    expires=now + settings.session_seconds,
                )
            )
            db.execute(
                update(campaigns)
                .where(
                    campaigns.c.owner == owner,
                    campaigns.c.state == "awaiting_auth",
                    campaigns.c.cancel_requested == False,
                )
                .values(state="queued", next_at=now, updated=now, error=None)
            )
        return session

    def authenticate(self, token):
        with self.database.engine.connect() as db:
            owner = db.scalar(
                select(sessions.c.owner).where(
                    sessions.c.hash == hashlib.sha256(token.encode()).hexdigest(),
                    sessions.c.expires > self.database.now(db),
                )
            )
        if not owner:
            raise HTTPException(401, "Your session has expired. Please sign in again.")
        return owner

    def logout(self, token):
        with self.database.transaction() as db:
            db.execute(
                delete(sessions).where(
                    sessions.c.hash == hashlib.sha256(token.encode()).hexdigest()
                )
            )
