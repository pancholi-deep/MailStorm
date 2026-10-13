"""SQLite checkpoints contain hashes and outcomes, never tokens or message data.

Share a persistent database between workers on one host. Multiple hosts require
a shared transactional store; ephemeral disks only protect within their lifetime.
"""
import hashlib
import sqlite3
import time
from contextlib import contextmanager
from pathlib import Path

from fastapi import HTTPException
from backend.core.config import settings


@contextmanager
def transaction():
    Path(settings.batch_db).parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(settings.batch_db, timeout=5)
    try:
        db.execute("PRAGMA foreign_keys = ON")
        db.execute("CREATE TABLE IF NOT EXISTS batches (id TEXT PRIMARY KEY, owner TEXT, fingerprint TEXT, lease REAL, updated REAL)")
        db.execute("CREATE TABLE IF NOT EXISTS outcomes (batch TEXT REFERENCES batches(id) ON DELETE CASCADE, row_no INTEGER, status TEXT, PRIMARY KEY (batch, row_no))")
        db.execute("BEGIN IMMEDIATE")
        yield db
        db.commit()
    except BaseException:
        db.rollback()
        raise
    finally:
        db.close()


def acquire(owner, key, fingerprint):
    owner = hashlib.sha256(owner.encode()).hexdigest()
    batch_id = hashlib.sha256(f"{owner}:{key}".encode()).hexdigest()
    now = time.time()
    with transaction() as db:
        db.execute("DELETE FROM batches WHERE updated < ? AND lease < ?", (now - settings.batch_retention_seconds, now))
        existing = db.execute("SELECT fingerprint, lease FROM batches WHERE id = ?", (batch_id,)).fetchone()
        if existing and existing[0] != fingerprint:
            raise HTTPException(409, "This batch identifier belongs to different message content.")
        if db.execute("SELECT 1 FROM batches WHERE owner = ? AND lease > ?", (owner, now)).fetchone():
            raise HTTPException(409, "A batch is still sending for this account. Please wait before retrying.")
        if db.execute("SELECT COUNT(*) FROM batches WHERE lease > ?", (now,)).fetchone()[0] >= settings.max_active_batches:
            raise HTTPException(429, "The server is busy sending emails. Please try again later.")
        # A crashed/cancelled request may have reached Google. Never retry it blindly.
        db.execute("UPDATE outcomes SET status = 'unknown' WHERE batch = ? AND status = 'pending'", (batch_id,))
        db.execute("INSERT INTO batches VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET lease=excluded.lease, updated=excluded.updated",
                   (batch_id, owner, fingerprint, now + settings.http_timeout * 2 + 60, now))
        outcomes = dict(db.execute("SELECT row_no, status FROM outcomes WHERE batch = ?", (batch_id,)))
    return batch_id, outcomes


def record(batch_id, row_no, status):
    now = time.time()
    with transaction() as db:
        db.execute("INSERT INTO outcomes VALUES (?, ?, ?) ON CONFLICT(batch, row_no) DO UPDATE SET status=excluded.status", (batch_id, row_no, status))
        db.execute("UPDATE batches SET lease = ?, updated = ? WHERE id = ?", (now + settings.http_timeout * 2 + 60, now, batch_id))


def release(batch_id):
    with transaction() as db:
        db.execute("UPDATE batches SET lease = 0, updated = ? WHERE id = ?", (time.time(), batch_id))
