"""Runs in CI against a disposable schema, never the application's schema."""
import os
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from backend.jobs.database import Database
from backend.jobs.store import Store, LostLease


@pytest.mark.skipif(not os.getenv('TEST_POSTGRES_URL'), reason='TEST_POSTGRES_URL not configured')
def test_postgres_concurrent_claim_and_fencing(configured):
    url = make_url(os.environ['TEST_POSTGRES_URL']).set(drivername='postgresql+psycopg')
    admin = create_engine(url)
    name = 'mailstorm_test_' + uuid.uuid4().hex
    with admin.begin() as db:
        db.execute(text(f'CREATE SCHEMA {name}'))
    database = Database(str(url.update_query_dict({'options': f'-csearch_path={name}'}).render_as_string(hide_password=False)))
    try:
        database.migrate()
        database.verify()
        store = Store(database)
        token = store.login({'sub': 'pg-owner', 'email': 'test@example.org'}, 'provider-secret', None, time.time()+3600)
        owner = store.authenticate(token)
        upload = store.reserve_upload(owner, 1, '0'*64)
        store.mark_uploaded(owner, upload)
        for _ in range(2):
            store.create(owner, str(uuid.uuid4()), upload, 'Hi', 'Body', False)
        with ThreadPoolExecutor(max_workers=2) as executor:
            jobs = list(executor.map(store.claim, ['a', 'b']))
        assert sum(job is not None for job in jobs) == 1
        old = next(job for job in jobs if job)
        with database.transaction() as db:
            db.execute(text('UPDATE job_campaigns SET lease_until=0 WHERE id=:id'), {'id': old['id']})
        replacement = store.claim('new')
        assert replacement
        with pytest.raises(LostLease):
            store.release(old)
        store.release(replacement, 'queued')
    finally:
        database.engine.dispose()
        with admin.begin() as db:
            db.execute(text(f'DROP SCHEMA {name} CASCADE'))
        admin.dispose()
