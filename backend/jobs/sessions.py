"""SessionRepository: transactional operations for sessions."""

import hashlib
import secrets
from sqlalchemy import select, update, delete
from fastapi import HTTPException
from backend.core.config import settings
from backend.jobs.database import connections, sessions, campaigns


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
                db.execute(select(connections).where(connections.c.owner == owner))
                .mappings()
                .first()
            )
            old = self.vault.open(existing["secret"]) if existing else {}
            value = {
                "token": token,
                "refresh_token": refresh_token or old.get("refresh_token"),
                "expires_at": expires_at,
                "name": info.get("name", ""),
                "email": info["email"],
            }
            if existing:
                db.execute(
                    update(connections)
                    .where(connections.c.owner == owner)
                    .values(
                        secret=self.vault.seal(value), version=existing["version"] + 1, updated=now
                    )
                )
            else:
                db.execute(
                    connections.insert().values(
                        owner=owner,
                        secret=self.vault.seal(value),
                        next_at=0,
                        updated=now,
                        version=1,
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
                .where(campaigns.c.owner == owner, campaigns.c.state == "awaiting_auth")
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
