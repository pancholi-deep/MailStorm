import base64
import json
import time
import uuid
from email import policy
from email.parser import BytesParser

import pytest

from backend.main import app
from backend.core.config import settings
from backend.tests.test_library import definition, upload
from backend.tests.test_sending import create, drain


def message(call):
    return BytesParser(policy=policy.default).parsebytes(
        base64.urlsafe_b64decode(json.loads(call.content)["raw"])
    )


def test_custom_columns_and_aliases_render_without_changing_recipient(api):
    client, calls, _ = api
    result = create(
        client,
        'name,email,Company Name,offer\nAlice Smith,a@example.org,"<Acme & Co>",Save 20%',
        subject="{name} at {company}: {offer}",
        body="<p>{full_name}: {company} / {email} / {offer}</p>",
        is_html=True,
        field_mapping={"company": " Company Name ", "full_name": "name"},
    )
    assert result.status_code == 202
    assert drain(client, result.json()["id"])["accepted"] == 1
    mail = message(calls[0])
    assert str(mail["To"]) == "a@example.org"
    assert str(mail["Subject"]) == "Alice at <Acme & Co>: Save 20%"
    assert "Alice Smith: &lt;Acme &amp; Co&gt; / a@example.org / Save 20%" in mail.get_content()


@pytest.mark.parametrize(
    "changes",
    [
        {"subject": "Hi {missing}"},
        {"body": "Hi {company}", "field_mapping": {"company": "absent"}},
    ],
)
def test_missing_columns_are_rejected_before_any_send(api, changes):
    client, calls, _ = api
    job = create(client, **changes)
    assert job.status_code == 202
    assert drain(client, job.json()["id"])["state"] == "invalid"
    assert not calls


@pytest.mark.parametrize(
    "mapping",
    [
        {"email": "company"},
        {"name": "company"},
        {"bad field": "company"},
        {"company": ""},
        {"company": "bad\ncolumn"},
        {f"field{i}": "name" for i in range(33)},
    ],
)
def test_invalid_mappings_rejected_at_api(api, mapping):
    client, calls, _ = api
    assert create(client, field_mapping=mapping).status_code == 422
    assert not calls


def test_late_invalid_custom_subject_prevents_all_sends(api):
    client, calls, _ = api
    csv = 'name,email,company\nAlice,a@example.org,Acme\nBob,b@example.org,"Bad\nHeader"'
    job = create(client, csv, subject="Hi {company}").json()
    assert drain(client, job["id"])["state"] == "invalid"
    assert not calls


def test_custom_body_expansion_is_bounded(api, monkeypatch):
    client, calls, _ = api
    monkeypatch.setattr(settings, "max_body_chars", 30)
    job = create(
        client, "name,email,company\nAlice,a@example.org,&&&&&&&&&&", body="{company}", is_html=True
    ).json()
    assert drain(client, job["id"])["state"] == "invalid"
    assert not calls


def test_mapping_round_trip_copy_snapshot_and_idempotency(api):
    client, calls, _ = api
    upload_id = upload(client, b"name,email,company,team\nAlice,a@example.org,Acme,Sales")
    values = definition(upload_id, body="{business}", field_mapping={"business": "company"})
    saved = client.post("/v1/saved-campaigns", json=values).json()
    reopened = client.get(f"/v1/saved-campaigns/{saved['id']}").json()
    assert reopened["field_mapping"] == {"business": "company"}
    key = {"Idempotency-Key": str(uuid.uuid4())}
    job = client.post("/v1/campaigns", headers=key, json=saved).json()
    revised = {**saved, "field_mapping": {"business": "team"}}
    assert client.post("/v1/campaigns", headers=key, json=revised).status_code == 409
    changed = client.put(f"/v1/saved-campaigns/{saved['id']}", json=revised).json()
    copy = client.post("/v1/saved-campaigns", json={**changed, "id": str(uuid.uuid4())}).json()
    assert copy["field_mapping"] == {"business": "team"}
    assert drain(client, job["id"])["accepted"] == 1
    assert message(calls[0]).get_content().strip() == "Acme"


def test_contact_metadata_owner_checks_and_legacy_campaigns(api):
    client, _, _ = api
    identifier = upload(client, b"name,email,Company Name\nAlice Smith,a@example.org,Acme")
    metadata = client.get(f"/v1/uploads/{identifier}/fields")
    assert metadata.headers["cache-control"] == "no-store"
    assert metadata.json() == {
        "columns": ["name", "email", "company name"],
        "sample": {"name": "Alice Smith", "email": "a@example.org", "company name": "Acme"},
        "recipient_count": 1,
    }
    saved = client.post("/v1/saved-campaigns", json=definition(identifier)).json()
    assert client.get(f"/v1/saved-campaigns/{saved['id']}").status_code == 200
    token = app.state.store.sessions.login(
        {"sub": "other", "email": "other@example.org"}, "other", None, time.time() + 3600
    )
    assert (
        client.get(
            f"/v1/uploads/{identifier}/fields", headers={"Authorization": f"Bearer {token}"}
        ).status_code
        == 404
    )


def test_empty_custom_cells_are_empty_not_unknown(api):
    client, calls, _ = api
    job = create(
        client, "name,email,company\nAlice,a@example.org,", body="Hello [{company}]"
    ).json()
    assert drain(client, job["id"])["accepted"] == 1
    assert message(calls[0]).get_content().strip() == "Hello []"
