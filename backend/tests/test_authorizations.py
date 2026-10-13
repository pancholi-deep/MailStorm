import asyncio
import time

import pytest
from fastapi import HTTPException
from sqlalchemy import select, update, inspect

from backend.main import app
from backend.jobs.database import (
    accounts,
    authorizations,
    schema,
    sessions,
    SCHEMA_VERSION,
)
from backend.jobs.worker import Worker
from backend.ports import AuthorizationRequired
from backend.services.gmail_authorization import GmailAuthorizationService
from backend.tests.test_library import save
from backend.tests.test_sending import create, step


def owner(client):
    return app.state.store.sessions.authenticate(
        client.headers["Authorization"].removeprefix("Bearer ")
    )


def reconnect():
    return app.state.store.sessions.login(
        {"sub": "google-user", "name": "Sender", "email": "sender@gmail.com"},
        "new-access-token",
        "new-refresh-token",
        time.time() + 3600,
    )


def test_profile_session_and_grant_are_separate_and_private(api):
    client, _, _ = api
    store = app.state.store
    with store.database.engine.connect() as db:
        profile = db.execute(select(accounts)).mappings().one()
        grant = db.execute(select(authorizations)).mappings().one()
        session = db.execute(select(sessions)).mappings().one()
    assert store.vault.open(profile["secret"]) == {"name": "Sender", "email": "sender@gmail.com"}
    assert set(store.vault.open(grant["secret"])) == {"token", "refresh_token", "expires_at"}
    assert "test-token" not in grant["secret"] and "refresh-secret" not in grant["secret"]
    assert session["hash"] not in client.headers["Authorization"]
    assert client.get("/v1/gmail").json() == {"connected": True, "revocation_pending": False}
    for path in ["/v1/gmail", "/v1/campaigns", "/v1/saved-campaigns"]:
        assert "refresh-secret" not in client.get(path).text
    client.headers.pop("Authorization")
    assert client.get("/v1/gmail").status_code == 401
    assert client.post("/v1/gmail/disconnect").status_code == 401


def test_disconnect_preserves_campaigns_and_session_but_stops_sending(api):
    client, calls, _ = api
    saved = save(client).json()
    job = create(client).json()["id"]
    response = client.post("/v1/gmail/disconnect")
    assert response.json() == {
        "connected": False,
        "revocation_pending": False,
        "revocation_confirmed": True,
    }
    assert len(calls) == 1 and str(calls[0].url) == "https://oauth2.googleapis.com/revoke"
    assert b"token=refresh-secret" in calls[0].content
    assert "token=" not in str(calls[0].url)
    assert client.get(f"/v1/saved-campaigns/{saved['id']}").json() == saved
    assert save(client, name="Still editable").status_code == 201
    assert client.get(f"/v1/campaigns/{job}").json()["state"] == "cancelled"
    assert create(client).status_code == 409
    assert client.post(f"/v1/campaigns/{job}/retry").status_code == 409
    step()
    assert len(calls) == 1
    assert client.post("/v1/gmail/disconnect").status_code == 200
    assert len(calls) == 1
    reconnect()
    assert client.get("/v1/gmail").json()["connected"]
    assert client.get(f"/v1/campaigns/{job}").json()["state"] == "cancelled"
    assert create(client).status_code == 202


@pytest.mark.parametrize("failure", ["timeout", 500, 400])
def test_google_revocation_failure_still_removes_tokens_and_reports_uncertainty(api, failure):
    client, _, status = api
    status["send"] = failure
    response = client.post("/v1/gmail/disconnect")
    assert response.status_code == 200
    assert response.json()["revocation_confirmed"] is False
    assert response.json()["connected"] is False
    assert client.get("/v1/gmail").json()["revocation_pending"] is True
    with app.state.store.database.engine.connect() as db:
        assert db.execute(select(authorizations)).first() is None
    assert "refresh-secret" not in response.text


def test_logout_does_not_disconnect_gmail(api):
    client, calls, _ = api
    assert client.post("/v1/logout").status_code == 200
    assert client.get("/v1/gmail").status_code == 401
    with app.state.store.database.engine.connect() as db:
        assert db.execute(select(authorizations)).first()
    assert not calls


def test_disconnect_during_refresh_cannot_restore_or_send_credentials(api):
    client, _, _ = api
    job_id = create(client).json()["id"]
    step()
    store = app.state.store
    identity = owner(client)
    old_job = store.queue.claim("worker")
    connection, version = store.queue.connection(old_job)
    grant = store.authorizations.disconnect(identity)
    with pytest.raises(HTTPException) as error:
        reconnect()
    assert error.value.status_code == 409
    with pytest.raises(AuthorizationRequired):
        store.queue.save_connection(old_job, connection, version)
    assert store.queue.next_recipient(old_job)[1] == "cancelled"
    store.authorizations.finish_disconnect(identity, grant["version"], True)
    reconnect()
    with pytest.raises(AuthorizationRequired):
        store.queue.save_connection(old_job, connection, version)
    assert store.queue.next_recipient(old_job)[1] == "cancelled"
    store.queue.release(old_job, "queued")
    assert client.get(f"/v1/campaigns/{job_id}").json()["state"] == "cancelled"


def test_disconnect_during_provider_submission_preserves_its_outcome(api):
    client, _, _ = api
    identifier = create(client, "name,email\nAlice,a@example.org\nBob,b@example.org").json()["id"]
    step()
    store = app.state.store
    submitted = []

    class Provider:
        async def refresh(self, connection):
            return False

        async def send(self, connection, to, subject, body, is_html):
            submitted.append(to)
            grant = store.authorizations.disconnect(owner(client))
            store.authorizations.finish_disconnect(owner(client), grant["version"], True)
            return "already-accepted"

    worker = Worker(store.queue, store.uploads, store.retention, app.state.objects, Provider())
    asyncio.run(worker.run_once())
    asyncio.run(worker.run_once())
    result = client.get(f"/v1/campaigns/{identifier}").json()
    assert result["state"] == "cancelled" and result["accepted"] == 1
    assert submitted == ["a@example.org"]


def test_idle_grants_expire_even_with_saved_campaign_and_live_session(api):
    client, calls, _ = api
    saved = save(client).json()
    store = app.state.store
    with store.database.transaction() as db:
        db.execute(update(authorizations).values(updated=0))
    asyncio.run(
        GmailAuthorizationService(store.authorizations, app.state.http_client).cleanup_expired()
    )
    store.retention.cleanup()
    assert client.get("/v1/gmail").json()["connected"] is False
    assert client.get(f"/v1/saved-campaigns/{saved['id']}").status_code == 200
    assert len(calls) == 1


def test_active_jobs_protect_grants_and_retention_rechecks_activity(api):
    client, _, _ = api
    store = app.state.store
    with store.database.transaction() as db:
        db.execute(update(authorizations).values(updated=0))
    candidates = store.authorizations.expired_owners()
    assert candidates == [owner(client)]
    create(client)
    assert store.authorizations.expired_owners() == []
    assert store.authorizations.disconnect(candidates[0], only_if_expired=True) is None
    assert client.get("/v1/gmail").json()["connected"] is True


def legacy_database(store):
    """Reconstruct v2 tables with actual FK relationships and combined encrypted secrets."""
    with store.database.engine.begin() as db:
        profile = db.execute(select(accounts)).mappings().one()
        grant = db.execute(select(authorizations)).mappings().one()
        combined = {**store.vault.open(profile["secret"]), **store.vault.open(grant["secret"])}
        db.execute(update(accounts).values(secret=store.vault.seal(combined)))
        authorizations.drop(db)
        db.exec_driver_sql("ALTER TABLE job_accounts DROP COLUMN disconnect_until")
        db.exec_driver_sql("ALTER TABLE job_accounts DROP COLUMN revocation_pending")
        db.exec_driver_sql("ALTER TABLE job_accounts RENAME TO job_connections")
        db.execute(update(schema).values(version=2))


def test_v2_migration_preserves_sessions_campaigns_and_splits_secrets(api):
    client, _, _ = api
    saved = save(client).json()
    job_id = create(client).json()["id"]
    store = app.state.store
    legacy_database(store)
    store.database.migrate()
    store.database.migrate()
    store.database.verify()
    assert client.get(f"/v1/saved-campaigns/{saved['id']}").json() == saved
    assert client.get(f"/v1/campaigns/{job_id}").status_code == 200
    assert client.get("/v1/gmail").json()["connected"] is True
    with store.database.engine.connect() as db:
        assert db.scalar(select(schema.c.version)) == SCHEMA_VERSION
        assert "token" not in store.vault.open(db.scalar(select(accounts.c.secret)))
        assert (
            store.vault.open(db.scalar(select(authorizations.c.secret)))["refresh_token"]
            == "refresh-secret"
        )
        assert not db.exec_driver_sql("PRAGMA foreign_key_check").all()
    assert client.post("/v1/gmail/disconnect").status_code == 200
    assert client.get(f"/v1/saved-campaigns/{saved['id']}").status_code == 200


def test_migration_failure_rolls_back_ddl_and_preserves_old_schema(api, monkeypatch):
    from backend.jobs.crypto import Vault

    store = app.state.store
    legacy_database(store)
    monkeypatch.setattr(Vault, "open", lambda *_: (_ for _ in ()).throw(ValueError("wrong key")))
    with pytest.raises(ValueError, match="wrong key"):
        store.database.migrate()
    with store.database.engine.connect() as db:
        assert db.scalar(select(schema.c.version)) == 2
        assert "job_connections" in inspect(db).get_table_names()
        assert "job_accounts" not in inspect(db).get_table_names()
