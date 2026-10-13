import hashlib
import httpx
from sqlalchemy import update, select
from backend.main import app
from backend.jobs.database import connections, campaigns, sessions, uploads
from backend.core.config import settings
from backend.tests.test_sending import create, step, drain


def test_refresh_token_is_server_side_and_campaign_resumes(api):
    client, calls, _ = api
    identifier = create(client).json()["id"]
    step()
    store = app.state.store
    owner = store.sessions.authenticate(client.headers["Authorization"].removeprefix("Bearer "))
    with store.database.transaction() as db:
        row = db.execute(select(connections).where(connections.c.owner == owner)).mappings().one()
        secret = store.vault.open(row["secret"])
        secret["expires_at"] = 0
        db.execute(
            update(connections)
            .where(connections.c.owner == owner)
            .values(secret=store.vault.seal(secret))
        )
    refreshes = []

    def provider(request):
        if str(request.url) == settings.google_token_url:
            refreshes.append(request)
            return httpx.Response(200, json={"access_token": "renewed-token", "expires_in": 3600})
        assert request.headers["Authorization"] == "Bearer renewed-token"
        return httpx.Response(200, json={"id": "provider-id"})

    app.state.http_client = httpx.AsyncClient(transport=httpx.MockTransport(provider))
    assert drain(client, identifier)["accepted"] == 1
    assert len(refreshes) == 1
    assert "renewed-token" not in client.get(f"/v1/campaigns/{identifier}").text


def test_retention_deletes_objects_before_metadata_and_idle_credentials(api):
    client, _, _ = api
    identifier = create(client).json()["id"]
    drain(client, identifier)
    store = app.state.store
    with store.database.transaction() as db:
        db.execute(update(campaigns).values(updated=0))
        db.execute(update(uploads).values(created=0))
        db.execute(update(connections).values(updated=0))
        db.execute(update(sessions).values(expires=0))
    orphaned = store.retention.cleanup()
    assert len(orphaned) == 1
    assert (app.state.objects.root / orphaned[0]).exists()
    app.state.objects.delete(orphaned[0])
    store.retention.delete_upload_record(orphaned[0])
    with store.database.engine.connect() as db:
        assert db.execute(select(connections)).first() is None
        assert db.execute(select(uploads)).first() is None


def test_expired_or_cross_owner_upload_cannot_be_replaced(api):
    client, _, _ = api
    data = b"name,email\nAlice,a@example.org"
    value = client.post(
        "/v1/uploads", json={"size": len(data), "sha256": hashlib.sha256(data).hexdigest()}
    ).json()
    assert client.put(value["url"], content=data).status_code == 200
    assert client.post(f"/v1/uploads/{value['id']}/complete").status_code == 200
    assert client.put(value["url"], content=data).status_code == 409
    assert client.post(f"/v1/uploads/{value['id']}/complete").status_code == 200


def test_queue_admission_backpressure(api, monkeypatch):
    client, _, _ = api
    monkeypatch.setattr(settings, "max_queued_per_owner", 1)
    assert create(client).status_code == 202
    response = create(client)
    assert response.status_code == 429
    assert response.headers["Retry-After"] == "30"


def test_production_rejects_incomplete_configuration(configured, monkeypatch):
    import pytest

    monkeypatch.setattr(settings, "environment", "production")
    with pytest.raises(ValueError, match="PostgreSQL"):
        settings.validate_startup()


def test_large_import_chunks_and_late_invalid_row_never_send(api, monkeypatch):
    client, calls, _ = api
    monkeypatch.setattr(settings, "max_recipients", 11000)
    store = app.state.store
    original = store.queue.import_chunk
    chunk_sizes = []

    def track(job, rows):
        chunk_sizes.append(len(rows))
        return original(job, rows)

    monkeypatch.setattr(store.queue, "import_chunk", track)
    data = (
        "name,email\n"
        + "\n".join(f"Name{i},user{i}@example.org" for i in range(10000))
        + "\nInvalid,broken"
    )
    identifier = create(client, data).json()["id"]
    result = drain(client, identifier)
    assert result["state"] == "invalid"
    assert len(chunk_sizes) == 40 and max(chunk_sizes) == 250
    assert not calls


def test_rate_limit_cooldown_applies_to_other_campaigns(api):
    client, calls, status = api
    status["send"] = 429
    first = create(client).json()["id"]
    drain(client, first)
    create(client)
    for _ in range(5):
        step()
    assert len(calls) == 1


def test_worker_accepts_an_injected_message_provider_without_changing_personalization(api):
    import asyncio
    from backend.jobs.worker import Worker

    client, gmail_calls, _ = api
    identifier = create(client, "name,email\nAlice Smith,alice@example.org", is_html=True).json()[
        "id"
    ]
    step()  # Validate and import before any provider can send.
    submitted = []

    class RecordingProvider:
        async def refresh(self, connection):
            return False

        async def send(self, connection, to, subject, body, is_html):
            submitted.append((to, subject, body, is_html))
            return "injected-provider-id"

    store = app.state.store
    worker = Worker(
        store.queue, store.uploads, store.retention, app.state.objects, RecordingProvider()
    )
    asyncio.run(worker.run_once())
    assert submitted == [
        ("alice@example.org", "Hello Alice: alice@example.org", "Hello Alice", True)
    ]
    assert client.get(f"/v1/campaigns/{identifier}").json()["accepted"] == 1
    assert not gmail_calls
