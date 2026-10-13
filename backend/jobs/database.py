"""Durable queue schema. PostgreSQL in production, SQLite for local development."""

from contextlib import contextmanager
from pathlib import Path
import time
from sqlalchemy import (
    create_engine,
    MetaData,
    Table,
    Column,
    String,
    Text,
    Integer,
    Float,
    Boolean,
    Index,
    ForeignKey,
    select,
    text,
    update,
    inspect,
)
from backend.core.config import settings

metadata = MetaData()
schema = Table("job_schema", metadata, Column("version", Integer, primary_key=True))
gate = Table(
    "job_scheduler",
    metadata,
    Column("id", Integer, primary_key=True),
    Column("next_at", Float, nullable=False),
)
accounts = Table(
    "job_accounts",
    metadata,
    Column("owner", String(64), primary_key=True),
    Column("secret", Text, nullable=False),
    Column("version", Integer, nullable=False, default=1),
    Column("next_at", Float, nullable=False, default=0),
    Column("updated", Float, nullable=False),
    Column("disconnect_until", Float, nullable=False, server_default="0"),
    Column("revocation_pending", Boolean, nullable=False, server_default=text("false")),
)
authorizations = Table(
    "gmail_authorizations",
    metadata,
    Column("owner", String(64), ForeignKey("job_accounts.owner"), primary_key=True),
    Column("secret", Text, nullable=False),
    Column("version", Integer, nullable=False),
    Column("updated", Float, nullable=False),
)
Index("gmail_authorization_updated", authorizations.c.updated)
sessions = Table(
    "job_sessions",
    metadata,
    Column("hash", String(64), primary_key=True),
    Column("owner", String(64), ForeignKey("job_accounts.owner"), nullable=False),
    Column("expires", Float, nullable=False),
)
uploads = Table(
    "job_uploads",
    metadata,
    Column("id", String(64), primary_key=True),
    Column("owner", String(64), nullable=False),
    Column("size", Integer, nullable=False),
    Column("sha256", String(64)),
    Column("state", String(20), nullable=False),
    Column("created", Float, nullable=False),
    Column("object_version", String(256)),
)
campaigns = Table(
    "job_campaigns",
    metadata,
    Column("id", String(64), primary_key=True),
    Column("owner", String(64), ForeignKey("job_accounts.owner"), nullable=False),
    Column("key", String(64), nullable=False),
    Column("fingerprint", String(64), nullable=False),
    Column("upload_id", String(64), ForeignKey("job_uploads.id"), nullable=False),
    Column("secret", Text, nullable=False),
    Column("state", String(24), nullable=False),
    Column("cancel_requested", Boolean, nullable=False, default=False),
    Column("imported", Boolean, nullable=False, default=False),
    Column("total", Integer, nullable=False, default=0),
    Column("accepted", Integer, nullable=False, default=0),
    Column("failed", Integer, nullable=False, default=0),
    Column("unknown", Integer, nullable=False, default=0),
    Column("lease_owner", String(64)),
    Column("generation", Integer, nullable=False, default=0),
    Column("lease_until", Float, nullable=False, default=0),
    Column("next_at", Float, nullable=False, default=0),
    Column("created", Float, nullable=False),
    Column("updated", Float, nullable=False),
    Column("error", Text),
)
Index("job_campaign_idempotency", campaigns.c.owner, campaigns.c.key, unique=True)
Index("job_campaign_schedule", campaigns.c.state, campaigns.c.next_at, campaigns.c.updated)
Index("job_campaign_owner", campaigns.c.owner, campaigns.c.lease_until)
recipients = Table(
    "job_recipients",
    metadata,
    Column(
        "campaign", String(64), ForeignKey("job_campaigns.id", ondelete="CASCADE"), primary_key=True
    ),
    Column("row_no", Integer, primary_key=True),
    Column("secret", Text, nullable=False),
    Column("state", String(24), nullable=False),
    Column("attempts", Integer, nullable=False, default=0),
    Column("provider_id", String(256)),
    Column("error", String(128)),
    Column("updated", Float, nullable=False),
)
Index("job_recipient_state", recipients.c.campaign, recipients.c.state, recipients.c.row_no)
attempts = Table(
    "job_attempts",
    metadata,
    Column("id", String(64), primary_key=True),
    Column(
        "campaign", String(64), ForeignKey("job_campaigns.id", ondelete="CASCADE"), nullable=False
    ),
    Column("row_no", Integer, nullable=False),
    Column("state", String(24), nullable=False),
    Column("provider_id", String(256)),
    Column("error", String(128)),
    Column("created", Float, nullable=False),
)
Index("job_attempt_campaign", attempts.c.campaign, attempts.c.created)

Index("job_upload_created", uploads.c.created)
Index("job_upload_owner_created", uploads.c.owner, uploads.c.created)
Index("job_session_expiry", sessions.c.expires)
Index("job_session_owner", sessions.c.owner)
Index("job_account_updated", accounts.c.updated)
Index("job_campaign_retention", campaigns.c.state, campaigns.c.updated)

# Reusable definitions are independent of immutable delivery jobs.
saved_campaigns = Table(
    "saved_campaigns",
    metadata,
    Column("id", String(32), primary_key=True),
    Column("owner", String(64), ForeignKey("job_accounts.owner"), nullable=False),
    Column("upload_id", String(64), ForeignKey("job_uploads.id"), nullable=False),
    Column("label", Text, nullable=False),
    Column("secret", Text, nullable=False),
    Column("revision", Integer, nullable=False, default=1),
    Column("recipient_count", Integer, nullable=False),
    Column("created", Float, nullable=False),
    Column("updated", Float, nullable=False),
)
Index("saved_campaign_owner_updated", saved_campaigns.c.owner, saved_campaigns.c.updated)
Index("saved_campaign_upload", saved_campaigns.c.upload_id)
SCHEMA_VERSION = 3


class Database:
    def __init__(self, url=None):
        url = url or settings.database_url or f"sqlite:///{settings.batch_db}"
        if url.startswith("postgresql://"):
            url = url.replace("postgresql://", "postgresql+psycopg://", 1)
        if url.startswith("sqlite:///"):
            Path(url.removeprefix("sqlite:///")).parent.mkdir(parents=True, exist_ok=True)
        options = (
            {"connect_args": {"check_same_thread": False, "timeout": 10}}
            if url.startswith("sqlite:")
            else {"pool_size": 8, "max_overflow": 8, "pool_timeout": 5}
        )
        self.engine = create_engine(url, pool_pre_ping=True, **options)
        self.sqlite = self.engine.dialect.name == "sqlite"

    def migrate(self):
        # Run with old API/workers stopped. DDL and secret splitting commit together.
        from backend.jobs.crypto import Vault

        with self.engine.begin() as db:
            if self.sqlite:
                db.exec_driver_sql("BEGIN IMMEDIATE")
            schema.create(db, checkfirst=True)
            version = db.scalar(select(schema.c.version))
            if version not in (None, 1, 2, SCHEMA_VERSION):
                raise RuntimeError("Unsupported database schema version")
            legacy = "job_connections" in inspect(db).get_table_names()
            if legacy:
                db.exec_driver_sql("ALTER TABLE job_connections RENAME TO job_accounts")
                db.exec_driver_sql(
                    "ALTER TABLE job_accounts ADD COLUMN disconnect_until FLOAT NOT NULL DEFAULT 0"
                )
                db.exec_driver_sql(
                    "ALTER TABLE job_accounts ADD COLUMN revocation_pending BOOLEAN NOT NULL DEFAULT false"
                )
            metadata.create_all(db)
            if legacy:
                vault = Vault()
                for row in db.execute(select(accounts)).mappings():
                    value = vault.open(row["secret"])
                    profile = {key: value.get(key, "") for key in ("name", "email")}
                    credentials = {
                        key: value.get(key) for key in ("token", "refresh_token", "expires_at")
                    }
                    db.execute(
                        authorizations.insert().values(
                            owner=row["owner"],
                            secret=vault.seal(credentials),
                            version=row["version"],
                            updated=row["updated"],
                        )
                    )
                    db.execute(
                        update(accounts)
                        .where(accounts.c.owner == row["owner"])
                        .values(secret=vault.seal(profile))
                    )
            if version is None:
                db.execute(schema.insert().values(version=SCHEMA_VERSION))
            else:
                db.execute(update(schema).values(version=SCHEMA_VERSION))
            if db.scalar(select(gate.c.id)) is None:
                db.execute(gate.insert().values(id=1, next_at=0))

    def verify(self):
        with self.engine.connect() as db:
            if db.scalar(select(schema.c.version)) != SCHEMA_VERSION:
                raise RuntimeError(
                    "Run python -m backend.jobs.migrate before starting this service"
                )

    @contextmanager
    def transaction(self):
        with self.engine.connect() as db:
            try:
                if self.sqlite:
                    db.exec_driver_sql("PRAGMA foreign_keys=ON")
                    db.exec_driver_sql("BEGIN IMMEDIATE")
                else:
                    db.begin()
                    # Short scheduling/checkpoint transactions share one ordering point.
                    # No network calls or file parsing occur while this lock is held.
                    db.execute(select(gate.c.id).where(gate.c.id == 1).with_for_update())
                yield db
                db.commit()
            except BaseException:
                db.rollback()
                raise

    def now(self, db):
        return (
            time.time()
            if self.sqlite
            else float(db.scalar(text("SELECT EXTRACT(EPOCH FROM clock_timestamp())")))
        )
