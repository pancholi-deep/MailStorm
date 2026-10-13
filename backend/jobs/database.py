"""Durable queue schema. PostgreSQL in production, SQLite for local development."""
from contextlib import contextmanager
from pathlib import Path
import time
from sqlalchemy import (create_engine, MetaData, Table, Column, String, Text, Integer,
                        Float, Boolean, Index, ForeignKey, select, text)
from backend.core.config import settings

metadata = MetaData()
schema = Table('job_schema', metadata, Column('version', Integer, primary_key=True))
gate = Table('job_scheduler', metadata, Column('id', Integer, primary_key=True), Column('next_at', Float, nullable=False))
connections = Table('job_connections', metadata,
    Column('owner', String(64), primary_key=True), Column('secret', Text, nullable=False),
    Column('version', Integer, nullable=False, default=1), Column('next_at', Float, nullable=False, default=0),
    Column('updated', Float, nullable=False))
sessions = Table('job_sessions', metadata,
    Column('hash', String(64), primary_key=True), Column('owner', String(64), ForeignKey('job_connections.owner'), nullable=False),
    Column('expires', Float, nullable=False))
uploads = Table('job_uploads', metadata,
    Column('id', String(64), primary_key=True), Column('owner', String(64), nullable=False),
    Column('size', Integer, nullable=False), Column('sha256', String(64)), Column('state', String(20), nullable=False),
    Column('created', Float, nullable=False), Column('object_version', String(256)))
campaigns = Table('job_campaigns', metadata,
    Column('id', String(64), primary_key=True), Column('owner', String(64), ForeignKey('job_connections.owner'), nullable=False),
    Column('key', String(64), nullable=False), Column('fingerprint', String(64), nullable=False),
    Column('upload_id', String(64), ForeignKey('job_uploads.id'), nullable=False), Column('secret', Text, nullable=False),
    Column('state', String(24), nullable=False), Column('cancel_requested', Boolean, nullable=False, default=False),
    Column('imported', Boolean, nullable=False, default=False),
    Column('total', Integer, nullable=False, default=0), Column('accepted', Integer, nullable=False, default=0),
    Column('failed', Integer, nullable=False, default=0), Column('unknown', Integer, nullable=False, default=0),
    Column('lease_owner', String(64)), Column('generation', Integer, nullable=False, default=0),
    Column('lease_until', Float, nullable=False, default=0), Column('next_at', Float, nullable=False, default=0),
    Column('created', Float, nullable=False), Column('updated', Float, nullable=False), Column('error', Text))
Index('job_campaign_idempotency', campaigns.c.owner, campaigns.c.key, unique=True)
Index('job_campaign_schedule', campaigns.c.state, campaigns.c.next_at, campaigns.c.updated)
Index('job_campaign_owner', campaigns.c.owner, campaigns.c.lease_until)
recipients = Table('job_recipients', metadata,
    Column('campaign', String(64), ForeignKey('job_campaigns.id', ondelete='CASCADE'), primary_key=True),
    Column('row_no', Integer, primary_key=True), Column('secret', Text, nullable=False),
    Column('state', String(24), nullable=False), Column('attempts', Integer, nullable=False, default=0),
    Column('provider_id', String(256)), Column('error', String(128)), Column('updated', Float, nullable=False))
Index('job_recipient_state', recipients.c.campaign, recipients.c.state, recipients.c.row_no)
attempts = Table('job_attempts', metadata,
    Column('id', String(64), primary_key=True), Column('campaign', String(64), ForeignKey('job_campaigns.id', ondelete='CASCADE'), nullable=False),
    Column('row_no', Integer, nullable=False), Column('state', String(24), nullable=False),
    Column('provider_id', String(256)), Column('error', String(128)), Column('created', Float, nullable=False))
Index('job_attempt_campaign', attempts.c.campaign, attempts.c.created)

Index('job_upload_created', uploads.c.created)
Index('job_upload_owner_created', uploads.c.owner, uploads.c.created)
Index('job_session_expiry', sessions.c.expires)
Index('job_session_owner', sessions.c.owner)
Index('job_connection_updated', connections.c.updated)
Index('job_campaign_retention', campaigns.c.state, campaigns.c.updated)


class Database:
    def __init__(self, url=None):
        url = url or settings.database_url or f'sqlite:///{settings.batch_db}'
        if url.startswith('postgresql://'):
            url = url.replace('postgresql://', 'postgresql+psycopg://', 1)
        if url.startswith('sqlite:///'):
            Path(url.removeprefix('sqlite:///')).parent.mkdir(parents=True, exist_ok=True)
        options = {'connect_args': {'check_same_thread': False, 'timeout': 10}} if url.startswith('sqlite:') else {'pool_size': 8, 'max_overflow': 8, 'pool_timeout': 5}
        self.engine = create_engine(url, pool_pre_ping=True, **options)
        self.sqlite = self.engine.dialect.name == 'sqlite'

    def migrate(self):
        # Run once before starting production processes; serialized by deployment migration job.
        metadata.create_all(self.engine)
        with self.engine.begin() as db:
            if db.scalar(select(schema.c.version)) is None:
                db.execute(schema.insert().values(version=1))
            if db.scalar(select(gate.c.id)) is None:
                db.execute(gate.insert().values(id=1, next_at=0))

    def verify(self):
        with self.engine.connect() as db:
            if db.scalar(select(schema.c.version)) != 1:
                raise RuntimeError('Run python -m backend.jobs.migrate before starting this service')

    @contextmanager
    def transaction(self):
        with self.engine.connect() as db:
            try:
                if self.sqlite:
                    db.exec_driver_sql('PRAGMA foreign_keys=ON')
                    db.exec_driver_sql('BEGIN IMMEDIATE')
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
        return time.time() if self.sqlite else float(db.scalar(text('SELECT EXTRACT(EPOCH FROM clock_timestamp())')))
