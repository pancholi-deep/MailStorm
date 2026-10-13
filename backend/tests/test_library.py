import hashlib
import time
import uuid
import pytest
from sqlalchemy import select, update
from backend.main import app
from backend.jobs.database import saved_campaigns, campaigns, uploads, schema, SCHEMA_VERSION
from backend.jobs.library import Library
from backend.tests.test_sending import drain


def upload(client, content=b'name,email\nAlice,alice@example.org'):
    response = client.post('/v1/uploads', json={'size': len(content), 'sha256': hashlib.sha256(content).hexdigest()})
    assert response.status_code == 201
    value = response.json()
    assert client.put(value['url'], content=content).status_code == 200
    assert client.post(f"/v1/uploads/{value['id']}/complete").status_code == 200
    return value['id']


def definition(upload_id, **changes):
    return {'id': str(uuid.uuid4()), 'name': 'Sales pitch', 'filename': 'sales.csv', 'upload_id': upload_id,
            'subject': 'Hello {name}', 'body': '<p>A pitch for {email}</p>', 'is_html': True, **changes}


def save(client, **changes):
    return client.post('/v1/saved-campaigns', json=definition(upload(client), **changes))


def test_save_reload_overwrite_copy_and_no_emails(api):
    client, calls, _ = api
    first = save(client)
    assert first.status_code == 201
    saved = first.json()
    assert saved['recipient_count'] == 1 and saved['revision'] == 1
    assert client.get(f"/v1/saved-campaigns/{saved['id']}").json()['body'] == saved['body']
    listing = client.get('/v1/saved-campaigns').json()
    assert len(listing) == 1 and listing[0]['name'] == 'Sales pitch'
    assert 'body' not in listing[0] and 'upload_id' not in listing[0]
    changed = client.put(f"/v1/saved-campaigns/{saved['id']}", json={**saved, 'body': 'Revised pitch'})
    assert changed.status_code == 200 and changed.json()['revision'] == 2
    copy = client.post('/v1/saved-campaigns', json={**changed.json(), 'id': str(uuid.uuid4()), 'name': 'Sales follow-up'})
    assert copy.status_code == 201 and copy.json()['id'] != saved['id']
    assert copy.json()['upload_id'] == saved['upload_id']
    assert not calls


def test_sending_reuses_contacts_and_keeps_old_snapshot(api):
    client, calls, _ = api
    saved = save(client).json()
    key = str(uuid.uuid4())
    first = client.post('/v1/campaigns', headers={'Idempotency-Key': key}, json=saved).json()
    client.put(f"/v1/saved-campaigns/{saved['id']}", json={**saved, 'subject': 'New pitch'})
    with app.state.store.database.engine.connect() as db:
        row = db.execute(select(campaigns).where(campaigns.c.id == first['id'])).mappings().one()
        assert app.state.store.vault.open(row['secret'])['subject'] == 'Hello {name}'
    assert drain(client, first['id'])['accepted'] == 1
    assert client.post('/v1/campaigns', headers={'Idempotency-Key': key}, json=saved).json()['id'] == first['id']
    second = client.post('/v1/campaigns', headers={'Idempotency-Key': str(uuid.uuid4())}, json=saved).json()
    assert second['id'] != first['id']
    assert drain(client, second['id'])['accepted'] == 1
    assert len(calls) == 2


def test_stale_edits_and_delete_are_rejected(api):
    client, _, _ = api
    saved = save(client).json()
    path = f"/v1/saved-campaigns/{saved['id']}"
    assert client.put(path, json={**saved, 'name': 'Updated'}).status_code == 200
    assert client.put(path, json={**saved, 'body': 'Lost update'}).status_code == 409
    assert client.post(path+'/delete', json={'revision': 1}).status_code == 409
    assert client.get(path).json()['name'] == 'Updated'


def test_tenant_isolation(api):
    client, _, _ = api
    saved = save(client).json()
    token = app.state.store.login({'sub': 'other-owner', 'email': 'other@example.org'}, 'other', None, time.time()+3600)
    headers = {'Authorization': f'Bearer {token}'}
    path = f"/v1/saved-campaigns/{saved['id']}"
    assert client.get('/v1/saved-campaigns', headers=headers).json() == []
    assert client.get(path, headers=headers).status_code == 404
    assert client.put(path, headers=headers, json=saved).status_code == 404
    assert client.post(path+'/delete', headers=headers, json={'revision': 1}).status_code == 404
    assert client.post('/v1/saved-campaigns', headers=headers, json={**saved, 'id': str(uuid.uuid4())}).status_code == 404


def test_retention_pins_saved_contacts_and_copies(api):
    client, _, _ = api
    saved = save(client).json()
    copy = client.post('/v1/saved-campaigns', json={**saved, 'id': str(uuid.uuid4()), 'name': 'Copy'}).json()
    store = app.state.store
    with store.database.transaction() as db:
        db.execute(update(uploads).values(created=0))
        db.execute(update(saved_campaigns).values(updated=0))
    assert store.cleanup() == []
    assert client.post(f"/v1/saved-campaigns/{saved['id']}/delete", json={'revision': 1}).status_code == 200
    assert store.cleanup() == []
    assert client.post(f"/v1/saved-campaigns/{copy['id']}/delete", json={'revision': 1}).status_code == 200
    assert store.cleanup() == [saved['upload_id']]
    # A cleanup candidate cannot be referenced again between selection and object deletion.
    assert client.post('/v1/saved-campaigns', json={**saved, 'id': str(uuid.uuid4())}).status_code == 409
    assert client.post('/v1/campaigns', headers={'Idempotency-Key': str(uuid.uuid4())}, json=saved).status_code == 409


def test_delete_saved_campaign_preserves_active_send(api):
    client, _, _ = api
    saved = save(client).json()
    send = client.post('/v1/campaigns', headers={'Idempotency-Key': str(uuid.uuid4())}, json=saved).json()
    client.post(f"/v1/saved-campaigns/{saved['id']}/delete", json={'revision': 1})
    with app.state.store.database.transaction() as db:
        db.execute(update(uploads).values(created=0))
    assert app.state.store.cleanup() == []
    assert drain(client, send['id'])['accepted'] == 1


@pytest.mark.parametrize('changes', [{'name': '  '}, {'subject': 'Hi {bad}'}, {'body': ' '}, {'filename': 'bad\nfile.csv'}])
def test_invalid_definitions_do_not_save(api, changes):
    client, calls, _ = api
    assert save(client, **changes).status_code == 422
    assert client.get('/v1/saved-campaigns').json() == []
    assert not calls


def test_full_contact_validation_before_save(api):
    client, calls, _ = api
    identifier = upload(client, b'name,email\nAlice,alice@example.org\nBad,broken')
    assert client.post('/v1/saved-campaigns', json=definition(identifier)).status_code == 422
    assert client.get('/v1/saved-campaigns').json() == []
    assert not calls


def test_create_retries_are_idempotent_and_encrypted(api):
    client, _, _ = api
    data = definition(upload(client))
    first = client.post('/v1/saved-campaigns', json=data).json()
    assert client.post('/v1/saved-campaigns', json=data).json()['id'] == first['id']
    assert client.post('/v1/saved-campaigns', json={**data, 'body': 'Different'}).status_code == 409
    with app.state.store.database.engine.connect() as db:
        raw = db.execute(select(saved_campaigns)).mappings().one()
        assert 'Sales pitch' not in raw['label'] and 'sales.csv' not in raw['label']
        assert 'pitch' not in raw['secret'] and 'Hello' not in raw['secret']


def test_v1_to_v2_migration_preserves_jobs(api):
    client, _, _ = api
    data = definition(upload(client))
    send = client.post('/v1/campaigns', headers={'Idempotency-Key': str(uuid.uuid4())}, json=data).json()
    database = app.state.store.database
    # Reconstruct the previous schema in this disposable test database.
    saved_campaigns.drop(database.engine)
    with database.engine.begin() as db:
        db.execute(update(schema).values(version=1))
    database.migrate()
    database.migrate()  # Idempotent deployment migration.
    database.verify()
    with database.engine.connect() as db:
        assert db.scalar(select(schema.c.version)) == SCHEMA_VERSION
        assert db.scalar(select(campaigns.c.id)) == send['id']
    assert client.post('/v1/saved-campaigns', json=data).status_code == 201
