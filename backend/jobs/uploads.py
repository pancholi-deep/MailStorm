"""UploadRepository: transactional operations for uploads."""

import uuid
from sqlalchemy import select, update, func
from fastapi import HTTPException
from backend.core.config import settings
from backend.jobs.database import uploads


class UploadRepository:
    def __init__(self, database):
        self.database = database

    def reserve_upload(self, owner, size, digest):
        with self.database.transaction() as db:
            now = self.database.now(db)
            pending = db.scalar(
                select(func.count())
                .select_from(uploads)
                .where(uploads.c.owner == owner, uploads.c.created > now - 3600)
            )
            total = db.scalar(
                select(func.count()).select_from(uploads).where(uploads.c.created > now - 3600)
            )
            if pending >= 20 or total >= settings.max_queued_total * 2:
                raise HTTPException(
                    429,
                    "Upload allowance reached. Please try again later.",
                    headers={"Retry-After": "3600"},
                )
            identifier = uuid.uuid4().hex
            db.execute(
                uploads.insert().values(
                    id=identifier,
                    owner=owner,
                    size=size,
                    sha256=digest,
                    state="reserved",
                    created=now,
                )
            )
            return identifier

    def upload(self, owner, identifier):
        with self.database.engine.connect() as db:
            row = (
                db.execute(
                    select(uploads).where(uploads.c.id == identifier, uploads.c.owner == owner)
                )
                .mappings()
                .first()
            )
        if not row:
            raise HTTPException(404, "Upload not found")
        return dict(row)

    def transition_upload(self, owner, identifier, expected, target):
        with self.database.transaction() as db:
            result = db.execute(
                update(uploads)
                .where(
                    uploads.c.id == identifier,
                    uploads.c.owner == owner,
                    uploads.c.state == expected,
                    uploads.c.created > self.database.now(db) - 900,
                )
                .values(state=target)
            )
            if result.rowcount != 1:
                raise HTTPException(409, "Upload expired or already in use; reserve a new upload")

    def mark_uploaded(self, owner, identifier):
        with self.database.transaction() as db:
            result = db.execute(
                update(uploads)
                .where(
                    uploads.c.id == identifier,
                    uploads.c.owner == owner,
                    uploads.c.state == "reserved",
                )
                .values(state="uploaded")
            )
            if result.rowcount != 1:
                raise HTTPException(409, "Upload is already finalized")
