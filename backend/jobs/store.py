"""Transactional campaign operations. Lease generations fence every worker write."""
import hashlib
import json
import secrets
import uuid
from sqlalchemy import select, update, delete, func
from fastapi import HTTPException
from backend.core.config import settings
from backend.jobs.database import Database, connections, sessions, uploads, campaigns, recipients, attempts, gate
from backend.jobs.crypto import Vault

ACTIVE = ('importing', 'queued', 'running', 'retry_wait')
TERMINAL = ('complete', 'cancelled', 'invalid', 'blocked', 'awaiting_auth')
STATE_COLUMNS = [column for column in campaigns.c if column.name != 'secret']
STATUS_FIELDS = ('id', 'state', 'total', 'accepted', 'failed', 'unknown', 'cancel_requested', 'created', 'updated', 'error', 'next_at')


class LostLease(Exception):
    pass


class Store:
    def __init__(self, database=None):
        self.database = database or Database()
        self.vault = Vault()

    def login(self, info, token, refresh_token, expires_at):
        owner = hashlib.sha256(info['sub'].encode()).hexdigest()
        session = secrets.token_urlsafe(32)
        with self.database.transaction() as db:
            now = self.database.now(db)
            existing = db.execute(select(connections).where(connections.c.owner == owner)).mappings().first()
            old = self.vault.open(existing['secret']) if existing else {}
            value = {'token': token, 'refresh_token': refresh_token or old.get('refresh_token'),
                     'expires_at': expires_at, 'name': info.get('name', ''), 'email': info['email']}
            if existing:
                db.execute(update(connections).where(connections.c.owner == owner).values(secret=self.vault.seal(value), version=existing['version'] + 1, updated=now))
            else:
                db.execute(connections.insert().values(owner=owner, secret=self.vault.seal(value), next_at=0, updated=now, version=1))
            db.execute(sessions.insert().values(hash=hashlib.sha256(session.encode()).hexdigest(), owner=owner, expires=now + settings.session_seconds))
            db.execute(update(campaigns).where(campaigns.c.owner == owner, campaigns.c.state == 'awaiting_auth').values(state='queued', next_at=now, updated=now, error=None))
        return session

    def authenticate(self, token):
        with self.database.engine.connect() as db:
            owner = db.scalar(select(sessions.c.owner).where(sessions.c.hash == hashlib.sha256(token.encode()).hexdigest(), sessions.c.expires > self.database.now(db)))
        if not owner:
            raise HTTPException(401, 'Your session has expired. Please sign in again.')
        return owner

    def logout(self, token):
        with self.database.transaction() as db:
            db.execute(delete(sessions).where(sessions.c.hash == hashlib.sha256(token.encode()).hexdigest()))

    def reserve_upload(self, owner, size, digest):
        with self.database.transaction() as db:
            now = self.database.now(db)
            pending = db.scalar(select(func.count()).select_from(uploads).where(uploads.c.owner == owner, uploads.c.created > now - 3600))
            total = db.scalar(select(func.count()).select_from(uploads).where(uploads.c.created > now - 3600))
            if pending >= 20 or total >= settings.max_queued_total * 2:
                raise HTTPException(429, 'Upload allowance reached. Please try again later.', headers={'Retry-After': '3600'})
            identifier = uuid.uuid4().hex
            db.execute(uploads.insert().values(id=identifier, owner=owner, size=size, sha256=digest, state='reserved', created=now))
            return identifier

    def upload(self, owner, identifier):
        with self.database.engine.connect() as db:
            row = db.execute(select(uploads).where(uploads.c.id == identifier, uploads.c.owner == owner)).mappings().first()
        if not row:
            raise HTTPException(404, 'Upload not found')
        return dict(row)

    def transition_upload(self, owner, identifier, expected, target):
        with self.database.transaction() as db:
            result = db.execute(update(uploads).where(uploads.c.id == identifier, uploads.c.owner == owner,
                uploads.c.state == expected, uploads.c.created > self.database.now(db) - 900).values(state=target))
            if result.rowcount != 1:
                raise HTTPException(409, 'Upload expired or already in use; reserve a new upload')

    def mark_uploaded(self, owner, identifier):
        with self.database.transaction() as db:
            result = db.execute(update(uploads).where(uploads.c.id == identifier, uploads.c.owner == owner, uploads.c.state == 'reserved').values(state='uploaded'))
            if result.rowcount != 1:
                raise HTTPException(409, 'Upload is already finalized')

    def create(self, owner, key, upload_id, subject, body, is_html):
        template = {'subject': subject, 'body': body, 'is_html': is_html}
        with self.database.transaction() as db:
            now = self.database.now(db)
            upload = db.execute(select(uploads).where(uploads.c.id == upload_id, uploads.c.owner == owner, uploads.c.state == 'uploaded')).mappings().first()
            if not upload:
                raise HTTPException(409, 'Upload must be completed first')
            fingerprint = hashlib.sha256(json.dumps([upload['sha256'], template], sort_keys=True).encode()).hexdigest()
            existing = db.execute(select(campaigns.c.id, campaigns.c.fingerprint).where(campaigns.c.owner == owner, campaigns.c.key == key)).mappings().first()
            if existing:
                if existing['fingerprint'] != fingerprint:
                    raise HTTPException(409, 'This batch identifier belongs to different message content.')
                return existing['id']
            count = lambda condition: db.scalar(select(func.count()).select_from(campaigns).where(campaigns.c.state.in_(ACTIVE), condition))
            if count(campaigns.c.owner == owner) >= settings.max_queued_per_owner or count(True) >= settings.max_queued_total:
                raise HTTPException(429, 'Campaign queue is full. Please try again later.', headers={'Retry-After': '30'})
            identifier = uuid.uuid4().hex
            db.execute(campaigns.insert().values(id=identifier, owner=owner, key=key, fingerprint=fingerprint, upload_id=upload_id,
                secret=self.vault.seal(template), state='importing', created=now, updated=now, next_at=now))
            return identifier

    def status(self, owner, identifier):
        with self.database.engine.connect() as db:
            row = db.execute(select(*STATE_COLUMNS).where(campaigns.c.id == identifier, campaigns.c.owner == owner)).mappings().first()
        if not row:
            raise HTTPException(404, 'Campaign not found')
        return {key: row[key] for key in STATUS_FIELDS}

    def list_campaigns(self, owner):
        with self.database.engine.connect() as db:
            rows = db.execute(select(*(campaigns.c[key] for key in STATUS_FIELDS)).where(campaigns.c.owner == owner)
                .order_by(campaigns.c.created.desc()).limit(50)).mappings().all()
        return [dict(row) for row in rows]

    def result_page(self, owner, identifier, after=0, limit=100):
        self.status(owner, identifier)
        with self.database.engine.connect() as db:
            rows = db.execute(select(recipients).where(recipients.c.campaign == identifier, recipients.c.row_no > after).order_by(recipients.c.row_no).limit(limit)).mappings().all()
        return [dict(row_no=row['row_no'], state=row['state'], provider_id=row['provider_id'], error=row['error'], **self.vault.open(row['secret'])) for row in rows]

    def cancel(self, owner, identifier):
        with self.database.transaction() as db:
            row = db.execute(select(*STATE_COLUMNS).where(campaigns.c.id == identifier, campaigns.c.owner == owner)).mappings().first()
            if not row:
                raise HTTPException(404, 'Campaign not found')
            if row['state'] != 'complete':
                now = self.database.now(db)
                db.execute(update(campaigns).where(campaigns.c.id == identifier).values(cancel_requested=True, updated=now,
                    state=row['state'] if row['lease_until'] > now else 'cancelled'))

    def retry(self, owner, identifier):
        with self.database.transaction() as db:
            row = db.execute(select(*STATE_COLUMNS).where(campaigns.c.id == identifier, campaigns.c.owner == owner)).mappings().first()
            if not row:
                raise HTTPException(404, 'Campaign not found')
            now = self.database.now(db)
            if row['state'] == 'invalid':
                raise HTTPException(409, 'Correct the file and create a new campaign')
            if row['lease_until'] > now:
                raise HTTPException(409, 'Campaign is still stopping')
            # Unknown and permanent failures are never automatically replayed.
            db.execute(update(campaigns).where(campaigns.c.id == identifier).values(state='queued' if row['imported'] else 'importing',
                cancel_requested=False, error=None, next_at=now, updated=now))

    def claim(self, worker):
        with self.database.transaction() as db:
            now = self.database.now(db)
            # Recover interrupted provider calls conservatively before any work is reclaimed.
            expired = db.execute(select(*STATE_COLUMNS).where(campaigns.c.lease_owner.is_not(None), campaigns.c.lease_until <= now).limit(50)).mappings().all()
            for row in expired:
                changed = db.execute(update(recipients).where(recipients.c.campaign == row['id'], recipients.c.state == 'submitting').values(state='unknown', error='worker_lost', updated=now)).rowcount
                db.execute(update(attempts).where(attempts.c.campaign == row['id'], attempts.c.state == 'submitting').values(state='unknown', error='worker_lost'))
                db.execute(update(campaigns).where(campaigns.c.id == row['id']).values(lease_owner=None, lease_until=0, unknown=row['unknown'] + changed,
                    state='cancelled' if row['cancel_requested'] else ('importing' if row['state'] == 'importing' else 'queued')))
            active = db.scalar(select(func.count()).select_from(campaigns).where(campaigns.c.lease_until > now))
            if active >= settings.max_active_batches:
                return None
            busy = select(campaigns.c.owner).where(campaigns.c.lease_until > now)
            row = db.execute(select(campaigns).where(campaigns.c.state.in_(ACTIVE), campaigns.c.next_at <= now,
                campaigns.c.lease_until <= now, campaigns.c.cancel_requested == False, campaigns.c.owner.not_in(busy))
                .order_by(campaigns.c.updated, campaigns.c.id).limit(1)).mappings().first()
            if not row:
                return None
            row = dict(row)
            row['generation'] += 1
            row['lease_owner'] = worker
            db.execute(update(campaigns).where(campaigns.c.id == row['id']).values(lease_owner=worker, generation=row['generation'], lease_until=now + settings.lease_seconds, updated=now))
            row['template'] = self.vault.open(row['secret'])
            return row

    def fenced(self, db, job):
        row = db.execute(select(*STATE_COLUMNS).where(campaigns.c.id == job['id'], campaigns.c.lease_owner == job['lease_owner'],
            campaigns.c.generation == job['generation'], campaigns.c.lease_until > self.database.now(db))).mappings().first()
        if not row:
            raise LostLease()
        return row

    def heartbeat(self, job):
        with self.database.transaction() as db:
            self.fenced(db, job)
            db.execute(update(campaigns).where(campaigns.c.id == job['id']).values(lease_until=self.database.now(db) + settings.lease_seconds))

    def release(self, job, state=None, error=None, delay=0):
        with self.database.transaction() as db:
            row = self.fenced(db, job)
            now = self.database.now(db)
            values = dict(lease_owner=None, lease_until=0, updated=now, next_at=now + delay, error=error)
            values['state'] = 'cancelled' if row['cancel_requested'] else state or row['state']
            db.execute(update(campaigns).where(campaigns.c.id == job['id']).values(**values))

    def begin_import(self, job):
        with self.database.transaction() as db:
            self.fenced(db, job)
            db.execute(delete(recipients).where(recipients.c.campaign == job['id']))
            db.execute(update(campaigns).where(campaigns.c.id == job['id']).values(total=0))

    def import_chunk(self, job, rows):
        values = [dict(campaign=job['id'], row_no=row_no, secret=self.vault.seal(recipient), state='pending', updated=0) for row_no, recipient in rows]
        with self.database.transaction() as db:
            row = self.fenced(db, job)
            if row['cancel_requested']:
                return False
            db.execute(recipients.insert(), values)
            db.execute(update(campaigns).where(campaigns.c.id == job['id']).values(total=row['total'] + len(values)))
        return True

    def connection(self, job):
        with self.database.engine.connect() as db:
            row = db.execute(select(connections).where(connections.c.owner == job['owner'])).mappings().one()
        return self.vault.open(row['secret']), row['version']

    def finish_import(self, job):
        with self.database.transaction() as db:
            self.fenced(db, job)
            db.execute(update(campaigns).where(campaigns.c.id == job['id']).values(imported=True))

    def save_connection(self, job, secret, version):
        with self.database.transaction() as db:
            self.fenced(db, job)
            db.execute(update(connections).where(connections.c.owner == job['owner'], connections.c.version == version)
                .values(secret=self.vault.seal(secret), version=version + 1, updated=self.database.now(db)))

    def next_recipient(self, job):
        with self.database.transaction() as db:
            campaign = self.fenced(db, job)
            now = self.database.now(db)
            if campaign['cancel_requested']:
                return None, 'cancelled', 0
            row = db.execute(select(recipients).where(recipients.c.campaign == job['id'], recipients.c.state.in_(('pending', 'retry_wait'))).order_by(recipients.c.row_no).limit(1)).mappings().first()
            if not row:
                return None, 'complete', 0
            connection = db.execute(select(connections).where(connections.c.owner == job['owner'])).mappings().one()
            project_at = db.scalar(select(gate.c.next_at).where(gate.c.id == 1))
            wait = max(connection['next_at'], project_at) - now
            if wait > 0:
                return None, 'queued', wait
            db.execute(update(connections).where(connections.c.owner == job['owner']).values(next_at=now + settings.sender_interval))
            db.execute(update(gate).where(gate.c.id == 1).values(next_at=now + settings.project_interval))
            attempt_id = uuid.uuid4().hex
            db.execute(update(recipients).where(recipients.c.campaign == job['id'], recipients.c.row_no == row['row_no']).values(state='submitting', attempts=row['attempts'] + 1, updated=now))
            db.execute(attempts.insert().values(id=attempt_id, campaign=job['id'], row_no=row['row_no'], state='submitting', created=now))
            db.execute(update(campaigns).where(campaigns.c.id == job['id']).values(state='running'))
            return dict(row, attempt_id=attempt_id, data=self.vault.open(row['secret'])), None, 0

    def defer_sender(self, job, delay, project=False):
        with self.database.transaction() as db:
            self.fenced(db, job)
            until = self.database.now(db) + delay
            db.execute(update(connections).where(connections.c.owner == job['owner'], connections.c.next_at < until).values(next_at=until))
            if project:
                db.execute(update(gate).where(gate.c.id == 1, gate.c.next_at < until).values(next_at=until))

    def outcome(self, job, recipient, state, provider_id=None, error=None):
        with self.database.transaction() as db:
            self.fenced(db, job)
            now = self.database.now(db)
            db.execute(update(recipients).where(recipients.c.campaign == job['id'], recipients.c.row_no == recipient['row_no']).values(state=state, provider_id=provider_id, error=error, updated=now))
            db.execute(update(attempts).where(attempts.c.id == recipient['attempt_id']).values(state=state, provider_id=provider_id, error=error))
            field = {'accepted': 'accepted', 'permanently_failed': 'failed', 'unknown': 'unknown'}.get(state)
            if field:
                db.execute(update(campaigns).where(campaigns.c.id == job['id']).values({field: campaigns.c[field] + 1}))

    def cleanup(self):
        with self.database.transaction() as db:
            now = self.database.now(db)
            db.execute(delete(sessions).where(sessions.c.hash.in_(select(sessions.c.hash).where(sessions.c.expires < now).limit(1000))))
            db.execute(delete(campaigns).where(campaigns.c.id.in_(select(campaigns.c.id).where(campaigns.c.state.in_(TERMINAL), campaigns.c.lease_until <= now, campaigns.c.updated < now - settings.retention_seconds).limit(25))))
            orphaned = db.execute(select(uploads.c.id).where(uploads.c.created < now - 3600,
                uploads.c.id.not_in(select(campaigns.c.upload_id))).limit(250)).scalars().all()
            db.execute(delete(connections).where(connections.c.updated < now - settings.retention_seconds,
                connections.c.owner.not_in(select(campaigns.c.owner)), connections.c.owner.not_in(select(sessions.c.owner))))
            # Delete objects first; rows remain until deletion succeeds, making cleanup retryable.
            return orphaned

    def delete_upload_record(self, identifier):
        with self.database.transaction() as db:
            db.execute(delete(uploads).where(uploads.c.id == identifier))
