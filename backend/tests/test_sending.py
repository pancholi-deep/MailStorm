import asyncio
import base64
import hashlib
import json
import time
import uuid
from email import policy
from email.parser import BytesParser
import pytest
from sqlalchemy import update
from backend.main import app
from backend.core.config import settings
from backend.jobs.runtime import create_worker
from backend.jobs.store import Store
from backend.jobs.state import LostLease
from backend.jobs.database import campaigns
from backend.utils.validation import personalize


def create(client, csv="name,email\nAlice Smith,alice@example.org", key=None, **fields):
    data = csv if isinstance(csv, bytes) else csv.encode()
    upload = client.post(
        "/v1/uploads", json={"size": len(data), "sha256": hashlib.sha256(data).hexdigest()}
    )
    if upload.status_code != 201:
        return upload
    identifier = upload.json()["id"]
    assert client.put(f"/v1/uploads/{identifier}/content", content=data).status_code == 200
    assert client.post(f"/v1/uploads/{identifier}/complete").status_code == 200
    return client.post(
        "/v1/campaigns",
        headers={"Idempotency-Key": key or str(uuid.uuid4())},
        json={
            "upload_id": identifier,
            "subject": "Hello {name}: {email}",
            "body": "Hello {name}",
            "is_html": False,
            **fields,
        },
    )


def step():
    return asyncio.run(
        create_worker(app.state.store, app.state.objects, app.state.http_client).run_once()
    )


def drain(client, identifier):
    for _ in range(30):
        step()
        status = client.get(f"/v1/campaigns/{identifier}").json()
        if status["state"] in (
            "complete",
            "blocked",
            "invalid",
            "awaiting_auth",
            "cancelled",
            "retry_wait",
        ):
            return status
        time.sleep(0.003)
    raise AssertionError(status)


def test_durable_send_and_personalization(api):
    client, calls, _ = api
    response = create(client, '\ufeff Name , EMAIL\r\n"Doe, Jane",jane@example.org')
    assert response.status_code == 202
    assert not calls
    result = drain(client, response.json()["id"])
    assert result["accepted"] == 1
    message = BytesParser(policy=policy.default).parsebytes(
        base64.urlsafe_b64decode(json.loads(calls[0].content)["raw"])
    )
    assert str(message["Subject"]) == "Hello Doe,: jane@example.org"


@pytest.mark.parametrize(
    "csv",
    [
        "name,email",
        "name,email\nAlice,",
        "name,email\nAlice,a@gmail.com\nBob,broken",
        'name,email\n"unterminated,a@gmail.com',
        "name,email,email\nAlice,a@gmail.com,a@gmail.com",
        "name,email\nAlice,a@gmail.com,b@gmail.com",
    ],
)
def test_entire_import_validated_before_send(api, csv):
    client, calls, _ = api
    result = drain(client, create(client, csv).json()["id"])
    assert result["state"] == "invalid"
    assert not calls


@pytest.mark.parametrize("subject", ["Hi\nBcc: bad@example.org", "Hi {unknown}", " "])
def test_template_validation(api, subject):
    client, calls, _ = api
    assert create(client, subject=subject).status_code == 422
    assert not calls


def test_idempotency_and_encrypted_persistence(api):
    client, calls, _ = api
    key = str(uuid.uuid4())
    identifier = create(client, key=key).json()["id"]
    drain(client, identifier)
    assert create(client, key=key).json()["id"] == identifier
    assert create(client, key=key, body="changed").status_code == 409
    assert len(calls) == 1
    with open(settings.batch_db, "rb") as file:
        data = file.read()
    assert all(
        value not in data
        for value in [b"test-token", b"refresh-secret", b"alice@example.org", b"Hello"]
    )


@pytest.mark.parametrize(
    "code,expected",
    [
        (401, "awaiting_auth"),
        (403, "blocked"),
        (429, "retry_wait"),
        (503, "blocked"),
        ("timeout", "blocked"),
    ],
)
def test_provider_outcomes(api, code, expected):
    client, calls, status = api
    status["send"] = code
    identifier = create(client, "name,email\nAlice,a@gmail.com\nBob,b@gmail.com").json()["id"]
    result = drain(client, identifier)
    assert result["state"] == expected
    assert len(calls) == 1
    if code in (503, "timeout"):
        assert result["unknown"] == 1
        status["send"] = 200
        assert client.post(f"/v1/campaigns/{identifier}/retry").status_code == 200
        assert drain(client, identifier)["accepted"] == 1
        assert len(calls) == 2  # Ambiguous first recipient is never replayed.


def test_lease_fencing_and_crash_recovery(api):
    client, calls, _ = api
    identifier = create(client).json()["id"]
    step()  # Import
    store = app.state.store
    old = store.queue.claim("worker-a")
    row, _, _ = store.queue.next_recipient(old)
    assert row
    with store.database.transaction() as db:
        db.execute(update(campaigns).where(campaigns.c.id == identifier).values(lease_until=0))
    replacement = Store(store.database).queue.claim("worker-b")
    assert replacement["generation"] > old["generation"]
    with pytest.raises(LostLease):
        store.queue.release(old, "complete")
    with pytest.raises(LostLease):
        store.queue.outcome(old, row, "accepted", "late-id")
    assert store.campaigns.status(old["owner"], identifier)["unknown"] == 1
    store.queue.release(replacement, "queued")
    assert drain(client, identifier)["accepted"] == 0
    assert not calls


def test_cancel_and_owner_isolation(api):
    client, calls, _ = api
    identifier = create(client).json()["id"]
    token = app.state.store.sessions.login(
        {"sub": "another", "email": "other@example.org"}, "other-token", None, time.time() + 3600
    )
    assert (
        client.get(
            f"/v1/campaigns/{identifier}", headers={"Authorization": f"Bearer {token}"}
        ).status_code
        == 404
    )
    assert client.post(f"/v1/campaigns/{identifier}/cancel").status_code == 200
    step()
    assert not calls
    assert client.get(f"/v1/campaigns/{identifier}").json()["state"] == "cancelled"


def test_limits_checksum_and_pagination(api, monkeypatch):
    client, calls, _ = api
    monkeypatch.setattr(settings, "max_recipients", 1000)
    identifier = create(
        client, "name,email\n" + "\n".join(f"Name{i},u{i}@example.org" for i in range(600))
    ).json()["id"]
    step()
    assert client.get(f"/v1/campaigns/{identifier}").json()["total"] == 600
    rows = client.get(f"/v1/campaigns/{identifier}/recipients?limit=250&after=250").json()
    assert len(rows) == 250 and rows[0]["row_no"] == 251
    assert not calls
    assert client.get(f"/v1/campaigns/{identifier}/recipients?limit=10000").status_code == 422
    assert len(client.get(f"/v1/campaigns/{identifier}/logs").text.splitlines()) == 601
    upload = client.post("/v1/uploads", json={"size": 4, "sha256": "0" * 64}).json()
    assert client.put(upload["url"], content=b"nope").status_code == 422
    assert client.post(f"/v1/uploads/{upload['id']}/complete").status_code == 409


def test_shared_sender_limiter(api, monkeypatch):
    client, calls, _ = api
    monkeypatch.setattr(settings, "sender_interval", 60)
    first = create(client).json()["id"]
    second = create(client).json()["id"]
    for _ in range(8):
        step()
    assert len(calls) == 1
    assert (
        client.get(f"/v1/campaigns/{first}").json()["accepted"]
        + client.get(f"/v1/campaigns/{second}").json()["accepted"]
        == 1
    )


def test_html_values_and_invalid_encoding():
    assert (
        personalize("<p>{name}</p>", {"name": "<Alice&>", "email": "a@example.org"}, True)
        == "<p>&lt;Alice&amp;&gt;</p>"
    )


def test_invalid_encoding_uses_the_production_importer(api):
    client, calls, _ = api
    result = drain(client, create(client, b"\xff").json()["id"])
    assert result["state"] == "invalid"
    assert not calls


def test_unicode_template_compatibility_upload(api):
    client, _, _ = api
    response = client.post(
        "/send-emails",
        headers={"Idempotency-Key": str(uuid.uuid4())},
        files={"csv_file": ("list.csv", b"name,email\nAlice,a@example.org")},
        data={"email_subject": "Hello", "email_body": "界" * 400000, "isHtml": "false"},
    )
    assert response.status_code == 202
