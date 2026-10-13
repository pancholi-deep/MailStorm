"""Atomic daily limits across API processes; no prompt or response retention."""

from sqlalchemy import select, delete, update
from backend.jobs.database import ai_usage
from backend.ports import AssistError


def reserve_ai_usage(database, owner, user_limit, project_limit):
    with database.transaction() as db:
        now = database.now(db)
        day = int(now // 86400)
        db.execute(delete(ai_usage).where(ai_usage.c.day < day))
        for scope, limit, interval in (
            ("project", project_limit, 4),
            ("user:" + owner, user_limit, 10),
        ):
            row = db.execute(select(ai_usage).where(ai_usage.c.scope == scope)).mappings().first()
            if row and (row["count"] >= limit or row["next_at"] > now):
                message = (
                    "AI daily allowance reached. Try tomorrow; you can keep editing."
                    if row["count"] >= limit
                    else "Please wait a few seconds before requesting AI again."
                )
                raise AssistError(message, 429, "ai_local_limit")
            if row:
                db.execute(
                    update(ai_usage)
                    .where(ai_usage.c.scope == scope)
                    .values(count=row["count"] + 1, next_at=now + interval)
                )
            else:
                db.execute(
                    ai_usage.insert().values(scope=scope, day=day, count=1, next_at=now + interval)
                )
