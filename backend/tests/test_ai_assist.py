import asyncio
import json
from concurrent.futures import ThreadPoolExecutor

import httpx
import pytest
from sqlalchemy import select, update

from backend.core.config import settings
from backend.jobs.ai_usage import reserve_ai_usage
from backend.jobs.database import ai_usage, schema
from backend.main import app
from backend.ports import AssistError
from backend.services.ai_assist import AssistRequest, HtmlText, assist


def request_data(**changes):
    return {
        "action": "proofread",
        "subject": "Hi {name}",
        "body": "Hello {name}.",
        "consent": True,
        **changes,
    }


@pytest.fixture
def ai(api, monkeypatch):
    client, _, _ = api
    monkeypatch.setattr(settings, "gemini_api_key", "ai-test-secret")
    calls = []
    outcome = {
        "status": 200,
        "subject": "Hello {name}",
        "segments": ["Greetings {name}."],
        "finish": "STOP",
    }

    def provider(request):
        calls.append(request)
        if outcome["status"] == "timeout":
            raise httpx.ReadTimeout("private input", request=request)
        if outcome["status"] == "network":
            raise httpx.ConnectError("private input", request=request)
        if "error" in outcome:
            return httpx.Response(outcome["status"], json={"error": outcome["error"]})
        return httpx.Response(
            outcome["status"],
            json={
                "candidates": [
                    {
                        "finishReason": outcome["finish"],
                        "content": {
                            "parts": [
                                {
                                    "text": json.dumps(
                                        outcome.get(
                                            "result",
                                            {
                                                "subject": outcome["subject"],
                                                "segments": outcome["segments"],
                                            },
                                        )
                                    )
                                }
                            ]
                        },
                    }
                ]
            },
        )

    app.state.http_client = httpx.AsyncClient(transport=httpx.MockTransport(provider))
    return client, calls, outcome


def test_authenticated_optional_feature(api, monkeypatch):
    client, calls, _ = api
    monkeypatch.setattr(settings, "gemini_api_key", "")
    assert client.get("/v1/ai/status").json() == {"available": False}
    assert client.post("/v1/ai/assist", json=request_data()).status_code == 503
    client.headers.pop("Authorization")
    assert client.get("/v1/ai/status").status_code == 401
    assert client.post("/v1/ai/assist", json=request_data()).status_code == 401
    assert not calls


def test_rewrite_preserves_tokens_and_does_not_store_text(ai):
    client, calls, _ = ai
    result = client.post("/v1/ai/assist", json=request_data())
    assert result.status_code == 200
    assert result.json() == {
        "subject": "Hello {name}",
        "body": "Greetings {name}.",
        "is_html": False,
    }
    assert result.headers["cache-control"] == "no-store"
    call = calls[0]
    assert "key=" not in str(call.url)
    assert call.headers["x-goog-api-key"] == "ai-test-secret"
    content = json.loads(json.loads(call.content)["contents"][0]["parts"][0]["text"])
    assert content["segments"] == ["Hello {name}."]
    assert "sender@gmail.com" not in call.content.decode()
    with app.state.store.database.engine.connect() as db:
        rows = list(db.execute(select(ai_usage)).mappings())
        assert len(rows) == 2
        assert all(row["count"] == 1 for row in rows)
        assert "Greetings" not in str(rows)


def test_draft_shares_brief_only_and_escapes_html(ai):
    client, calls, outcome = ai
    outcome["result"] = {
        "subject": "Welcome {name}",
        "heading": "A better way to work",
        "greeting": "Hi {name}",
        "paragraphs": ["Use <script> as text."],
        "bullets": ["First benefit", "Second benefit"],
        "closing": "Thanks",
        "cta_text": "See how it works",
        "cta_url": "https://example.org/demo",
    }
    result = client.post(
        "/v1/ai/assist",
        json=request_data(
            action="draft",
            brief="Welcome {name}. Link to https://example.org/demo",
            fields=["name"],
            is_html=True,
            body="Do not send this existing draft",
            subject="Private existing subject",
        ),
    )
    assert result.status_code == 200
    body = result.json()["body"]
    assert result.json()["is_html"] is True
    assert '<table role="presentation"' in body
    assert '<a href="https://example.org/demo"' in body
    assert "&lt;script&gt;" in body and "<script>" not in body
    assert "Hi {name}" in body and "<h1 " in body and "<ul " in body
    schema = json.loads(calls[0].content)["generationConfig"]["responseSchema"]
    assert "heading" in schema["required"] and "segments" not in schema["properties"]
    prompt = calls[0].content.decode()
    assert "Private existing subject" not in prompt
    assert "Do not send this existing draft" not in prompt


@pytest.mark.parametrize(
    "changes",
    [
        {"consent": False},
        {"consent": None},
        {"body": ""},
        {"body": "a" * 20001},
        {"action": "other"},
        {"tone": "other"},
        {"subject": "bad\nheader"},
        {"action": "draft", "brief": "   "},
        {"action": "draft", "brief": "Hello {unknown}", "fields": ["name"]},
        {"fields": ["bad field"]},
        {"sample": {"email": "private@example.org"}},
    ],
)
def test_invalid_requests_do_not_call_provider(ai, changes):
    client, calls, _ = ai
    assert client.post("/v1/ai/assist", json=request_data(**changes)).status_code == 422
    assert not calls


@pytest.mark.parametrize(
    "changes",
    [
        {"segments": ["Hi {other}"]},
        {"segments": ["Hi"]},
        {"segments": ["{name} {name}"]},
        {"segments": []},
        {"segments": [42]},
        {"subject": "Bad\nHeader"},
        {"finish": "MAX_TOKENS"},
        {"finish": "SAFETY"},
    ],
)
def test_invalid_provider_output_rejected(ai, changes):
    client, _, outcome = ai
    outcome.update(changes)
    assert client.post("/v1/ai/assist", json=request_data()).status_code == 502


@pytest.mark.parametrize("status, expected", [(429, 429), (403, 503), (500, 503), ("timeout", 503)])
def test_provider_failures_are_safe_and_not_retried(ai, status, expected):
    client, calls, outcome = ai
    outcome["status"] = status
    result = client.post("/v1/ai/assist", json=request_data())
    assert result.status_code == expected
    assert "private input" not in result.text
    assert "ai-test-secret" not in result.text
    assert len(calls) == 1


@pytest.mark.parametrize(
    "status, details, provider_status, code, expected",
    [
        (400, [{"reason": "API_KEY_INVALID"}], "INVALID_ARGUMENT", "ai_key_invalid", 503),
        (400, [{"reason": "API_KEY_EXPIRED"}], "INVALID_ARGUMENT", "ai_key_invalid", 503),
        (403, [{"reason": "SERVICE_DISABLED"}], "PERMISSION_DENIED", "ai_api_disabled", 503),
        (403, [], "PERMISSION_DENIED", "ai_access_denied", 503),
        (404, [], "NOT_FOUND", "ai_model_unavailable", 503),
        (400, [], "FAILED_PRECONDITION", "ai_project_ineligible", 503),
        (400, [], "INVALID_ARGUMENT", "ai_request_rejected", 502),
        (429, [], "RESOURCE_EXHAUSTED", "ai_provider_quota", 429),
        (503, [], "UNAVAILABLE", "ai_provider_unavailable", 503),
    ],
)
def test_provider_diagnostics_are_actionable_without_sensitive_logs(
    ai, caplog, status, details, provider_status, code, expected
):
    client, calls, outcome = ai
    outcome.update(
        status=status,
        error={
            "status": provider_status,
            "details": details,
            "message": "ai-test-secret private input private@example.org",
        },
    )
    response = client.post("/v1/ai/assist", json=request_data())
    assert response.status_code == expected
    assert response.json()["code"] == code
    assert code in caplog.text
    assert f"upstream_status={status}" in caplog.text
    for value in ("ai-test-secret", "private input", "private@example.org"):
        assert value not in response.text + caplog.text
    assert len(calls) == 1


@pytest.mark.parametrize(
    "status, code", [("timeout", "ai_timeout"), ("network", "ai_network_error")]
)
def test_network_and_timeout_errors_are_distinct(ai, caplog, status, code):
    client, _, outcome = ai
    outcome["status"] = status
    response = client.post("/v1/ai/assist", json=request_data())
    assert response.json()["code"] == code
    assert code in caplog.text
    assert "private input" not in caplog.text + response.text


def test_html_rewrite_preserves_markup_attributes_and_escapes_output(ai):
    client, calls, outcome = ai
    source = '<!doctype html><html><head><style>p {color:red}</style></head><body>\n<p title="{name}" style="color:red">Hi &amp; hello {name}</p><!-- keep --><a href="https://example.org?q=1&amp;x=2">Go</a></body></html>'
    outcome["segments"] = ["Welcome & hi {name}", "<script>text</script>"]
    result = client.post("/v1/ai/assist", json=request_data(body=source, is_html=True))
    assert result.status_code == 200
    assert result.json()["body"] == source.replace(
        "Hi &amp; hello {name}", "Welcome &amp; hi {name}"
    ).replace(">Go</a>", ">&lt;script&gt;text&lt;/script&gt;</a>")
    instructions = json.loads(json.loads(calls[0].content)["contents"][0]["parts"][0]["text"])
    assert instructions["segments"] == ["Hi & hello {name}", "Go"]


def test_html_text_offsets_and_entities():
    source = "<div>\nHello &amp; <b>{name}</b> &copy; 2026<br/>Done</div>"
    parsed = HtmlText(source)
    assert parsed.segments == ["\nHello & ", "{name}", " © 2026", "Done"]
    assert HtmlText(parsed.replace(parsed.segments)).segments == parsed.segments
    assert HtmlText("Hi <b>{name}</b>, welcome").replace(["Hello", "{name}", ", greetings"]) == (
        "Hello <b>{name}</b>, greetings"
    )


def test_expired_usage_is_removed_by_retention(api, monkeypatch):
    database = app.state.store.database
    now = 864000.0
    monkeypatch.setattr(database, "now", lambda db: now)
    reserve_ai_usage(database, "owner", 1, 1)
    now += 86400
    app.state.store.retention.cleanup()
    with database.engine.connect() as db:
        assert not db.execute(select(ai_usage)).all()


def test_draft_cannot_invent_placeholder():
    class Fake:
        async def generate(self, instructions):
            return {"subject": "Hello", "segments": ["{secret}"]}

    with pytest.raises(AssistError):
        asyncio.run(assist(Fake(), AssistRequest(**request_data(action="draft", brief="Hello"))))


def test_daily_limits_atomic_across_instances_and_reset(api, monkeypatch):
    client, _, _ = api
    database = app.state.store.database
    monkeypatch.setattr(database, "now", lambda db: 864000.0)

    def reserve(_):
        try:
            reserve_ai_usage(database, "owner", 1, 2)
            return True
        except AssistError:
            return False

    with ThreadPoolExecutor(max_workers=4) as pool:
        assert sum(pool.map(reserve, range(4))) == 1
    monkeypatch.setattr(database, "now", lambda db: 864100.0)
    with pytest.raises(AssistError):
        reserve_ai_usage(database, "owner", 1, 2)
    reserve_ai_usage(database, "another", 1, 2)
    monkeypatch.setattr(database, "now", lambda db: 864200.0)
    with pytest.raises(AssistError):
        reserve_ai_usage(database, "third", 1, 2)
    monkeypatch.setattr(database, "now", lambda db: 950400.0)
    reserve_ai_usage(database, "owner", 1, 2)
    with database.engine.connect() as db:
        assert len(db.execute(select(ai_usage)).all()) == 2


def test_upgrade_from_schema_three(api):
    database = app.state.store.database
    with database.engine.begin() as db:
        ai_usage.drop(db)
        db.execute(update(schema).values(version=3))
    database.migrate()
    database.verify()
    reserve_ai_usage(database, "owner", 1, 1)
