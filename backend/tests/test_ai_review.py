import asyncio
import json
import time
import uuid

import httpx
import pytest
from sqlalchemy import select, update

from backend.core.config import settings
from backend.jobs.database import ai_usage
from backend.main import app
from backend.ports import AssistError
from backend.services.ai_review import review_input
from backend.services.review_cache import ReviewCache
from backend.tests.test_library import save


@pytest.fixture
def review_api(api, monkeypatch):
    client, _, _ = api
    monkeypatch.setattr(settings, "gemini_api_key", "review-test-key")
    monkeypatch.setattr(settings, "gemini_review_model", "gemini-3.1-flash-lite")
    calls = []
    outcome = {
        "result": {"score": 0, "summary": "No substantive content concerns.", "findings": []}
    }

    def provider(request):
        calls.append(request)
        if outcome.get("timeout"):
            raise httpx.ReadTimeout("private provider input", request=request)
        return httpx.Response(
            200,
            json={
                "candidates": [
                    {
                        "finishReason": "STOP",
                        "content": {"parts": [{"text": json.dumps(outcome["result"])}]},
                    }
                ]
            },
        )

    app.state.http_client = httpx.AsyncClient(transport=httpx.MockTransport(provider))
    return client, calls, outcome


def request_review(client, saved, **changes):
    return client.post(
        "/v1/ai/review",
        json={
            "campaign_id": saved["id"],
            "revision": saved["revision"],
            "consent": True,
            **changes,
        },
    )


def reset_interval():
    with app.state.store.database.transaction() as db:
        db.execute(update(ai_usage).values(next_at=0))


def test_save_does_not_call_ai_and_review_requires_explicit_consent(review_api):
    client, calls, _ = review_api
    saved = save(client).json()
    assert not calls
    assert request_review(client, saved, consent=False).status_code == 422
    result = request_review(client, saved)
    assert result.status_code == 200 and result.json()["source"] == "gemini"
    assert result.json()["revision"] == saved["revision"]
    assert result.headers["cache-control"] == "no-store"
    value = json.loads(json.loads(calls[0].content)["contents"][0]["parts"][0]["text"])
    assert value["text"] == "A pitch for {email}"
    assert "Alice" not in calls[0].content.decode()
    assert "alice@example.org" not in calls[0].content.decode()
    assert "test-token" not in calls[0].content.decode()
    assert "key=" not in str(calls[0].url)
    assert calls[0].headers["x-goog-api-key"] == "review-test-key"


def test_contextual_score_can_remove_keyword_false_positives_but_keeps_technical_floor(review_api):
    client, calls, outcome = review_api
    saved = save(
        client,
        subject="A risk-free consultation",
        body='<div hidden>Secret</div><script>alert(1)</script><a href="javascript:bad()">Open</a><p>Ask for a free consultation.</p>',
    ).json()
    response = request_review(client, saved).json()
    assert response["ai_score"] == 0
    assert response["technical_score"] == 75 and response["score"] == 75
    assert response["level"] == "high"
    assert {item["code"] for item in response["findings"]} == {
        "hidden_content",
        "active_content",
        "unsafe_links",
    }
    assert len(calls) == 1


def test_review_finds_evidence_and_returns_actionable_suggestions(review_api):
    client, _, outcome = review_api
    outcome["result"] = {
        "score": 65,
        "summary": "The guarantee needs evidence.",
        "findings": [
            {
                "title": "Unsupported guarantee",
                "excerpt": "Guaranteed income",
                "suggestion": "Describe verifiable benefits instead of guaranteed outcomes.",
            }
        ],
    }
    saved = save(client, subject="Guaranteed income", body="Start here.").json()
    response = request_review(client, saved).json()
    assert response["score"] == 65 and response["level"] == "high"
    assert response["findings"][0]["excerpt"] == "Guaranteed income"


@pytest.mark.parametrize(
    "bad",
    [
        {"score": 90, "summary": "Bad", "findings": []},
        {"score": 101, "summary": "Bad", "findings": []},
        {"score": "40", "summary": "Bad", "findings": []},
        {"score": True, "summary": "Bad", "findings": []},
        {"score": 0, "summary": " ", "findings": []},
        {
            "score": 50,
            "summary": "Concern",
            "findings": [
                {"title": "Invented", "excerpt": "NOT IN THE EMAIL", "suggestion": "Fix it"}
            ],
        },
    ],
)
def test_unsubstantiated_or_invalid_model_output_falls_back_without_mutating_saved_content(
    review_api, bad
):
    client, _, outcome = review_api
    saved = save(client).json()
    outcome["result"] = bad
    assert request_review(client, saved).status_code == 502
    reloaded = client.get(f"/v1/saved-campaigns/{saved['id']}").json()
    assert reloaded["body"] == saved["body"] and reloaded["revision"] == 1
    assert reloaded["content_review"] == saved["content_review"]


def test_unchanged_content_reuses_cache_across_revision_and_copy_without_extra_quota(review_api):
    client, calls, _ = review_api
    saved = save(client).json()
    assert request_review(client, saved).json()["cached"] is False
    assert request_review(client, saved).json()["cached"] is True
    renamed = client.put(
        f"/v1/saved-campaigns/{saved['id']}", json={**saved, "name": "Renamed"}
    ).json()
    assert request_review(client, renamed).json()["cached"] is True
    copied = client.post("/v1/saved-campaigns", json={**renamed, "id": str(uuid.uuid4())}).json()
    result = request_review(client, copied).json()
    assert result["cached"] is True and result["campaign_id"] == copied["id"]
    assert len(calls) == 1
    with app.state.store.database.engine.connect() as db:
        assert all(row["count"] == 1 for row in db.execute(select(ai_usage)).mappings())


def test_changed_content_and_model_invalidate_cache_and_stale_revision_is_rejected(
    review_api, monkeypatch
):
    client, calls, _ = review_api
    saved = save(client).json()
    request_review(client, saved)
    changed = client.put(
        f"/v1/saved-campaigns/{saved['id']}", json={**saved, "body": "A different message."}
    ).json()
    assert request_review(client, saved).status_code == 409
    reset_interval()
    assert request_review(client, changed).json()["cached"] is False
    monkeypatch.setattr(settings, "gemini_review_model", "different-test-model")
    reset_interval()
    assert request_review(client, changed).json()["cached"] is False
    assert len(calls) == 3


def test_authentication_and_ownership_are_checked_even_for_cached_results(review_api):
    client, calls, _ = review_api
    saved = save(client).json()
    request_review(client, saved)
    token = app.state.store.sessions.login(
        {"sub": "other", "email": "other@example.org"}, "other", None, time.time() + 3600
    )
    client.headers["Authorization"] = f"Bearer {token}"
    assert request_review(client, saved).status_code == 404
    own = save(client).json()
    reset_interval()
    assert request_review(client, own).json()["cached"] is False
    client.headers.pop("Authorization")
    assert request_review(client, saved).status_code == 401
    assert len(calls) == 2


def test_timeout_not_cached_and_daily_budget_shared_with_writing(review_api, monkeypatch):
    client, calls, outcome = review_api
    monkeypatch.setattr(settings, "ai_user_daily_limit", 1)
    saved = save(client).json()
    outcome["timeout"] = True
    assert request_review(client, saved).json()["code"] == "ai_timeout"
    reset_interval()
    assert request_review(client, saved).status_code == 429
    response = client.post(
        "/v1/ai/assist",
        json={"action": "proofread", "body": "Hello", "subject": "Hi", "consent": True},
    )
    assert response.status_code == 429
    assert len(calls) == 1
    assert client.get(f"/v1/saved-campaigns/{saved['id']}").json()["revision"] == 1


def test_long_or_unreadable_content_never_consumes_ai_quota(review_api):
    client, calls, _ = review_api
    for body in ("a" * 21000, "<div>" * 300 + "Hi"):
        saved = save(client, body=body).json()
        assert request_review(client, saved).status_code == 422
    assert not calls


def test_html_input_omits_scripts_styles_hidden_text_and_tracking_parameters():
    value = review_input(
        {
            "subject": "Hello",
            "is_html": True,
            "body": '<head><style>secret</style></head><p>Visible {name}</p><div hidden>Hidden</div><script>private script</script><a href="https://user:pass@example.org/demo?token=secret#private">Demo</a>',
        }
    )
    assert value == {
        "subject": "Hello",
        "text": "Visible {name} Demo",
        "links": [{"label": "Demo", "destination": "https://example.org/demo"}],
    }


def test_cache_coalesces_concurrent_calls_expires_evicts_and_retries_failures():
    async def check():
        cache = ReviewCache(capacity=1, ttl=0.02)
        calls = 0

        async def create():
            nonlocal calls
            calls += 1
            await asyncio.sleep(0)
            return {"score": 0}

        first, second = await asyncio.gather(
            cache.get_or_create("one", create), cache.get_or_create("one", create)
        )
        assert calls == 1 and first[0] == second[0]
        await cache.get_or_create("two", create)
        assert "one" not in cache.results
        await asyncio.sleep(0.03)
        assert not cache.results

        async def fail():
            raise AssistError("unavailable")

        with pytest.raises(AssistError):
            await cache.get_or_create("one", fail)
        assert not cache.pending and not cache.results
        await cache.get_or_create("one", create)
        assert calls == 3
        await cache.close()
        assert not cache.results

    asyncio.run(check())
