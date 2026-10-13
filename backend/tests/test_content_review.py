import uuid
import pytest

from backend.services.content_review import review_content
from backend.tests.test_library import save


def codes(review):
    return {finding["code"] for finding in review["findings"]}


def test_normal_personalized_template_has_no_checked_warnings():
    review = review_content(
        "Hi {FREE_OFFER}", "<p>Hello {name}. Here is the update you requested.</p>", True
    )
    assert review["score"] == 0 and review["level"] == "low"
    assert review["findings"] == []


def test_high_score_explains_contributions_and_drops_after_edits():
    review = review_content(
        "GUARANTEED INCOME!!!", "Act now! A special offer: https://bit.ly/example", False
    )
    assert review["score"] >= 50 and review["level"] == "high"
    assert review["score"] == sum(item["points"] for item in review["findings"])
    assert all(item["suggestion"] for item in review["findings"])
    assert (
        review_content(
            "Requested product overview", "Here is the overview. https://example.org/product", False
        )["score"]
        == 0
    )


@pytest.mark.parametrize(
    "body,expected",
    [
        ('<a href="https://elsewhere.org">https://example.org</a>', {"misleading_links"}),
        ('<a href="https://www.example.org/path">https://example.org</a>', set()),
        ('<a href="https://example.org">Read more</a>', set()),
        ('<a href="javascript:alert(1)">Read more</a>', {"unsafe_links"}),
        ("<p hidden>Secret</p><script>act now!!!</script>", {"hidden_content", "active_content"}),
        ('<img src="banner.png">', {"image_heavy"}),
        ("<p>Newsletter. Unsubscribe by replying to this email.</p>", set()),
        ("<p>Newsletter.</p>", {"opt_out"}),
        ("<p>Newsletter.</p><div hidden><p>Unsubscribe</p></div>", {"hidden_content", "opt_out"}),
        ('<p title="ACT NOW!!!">An ordinary message.</p>', set()),
    ],
)
def test_html_checks_use_visible_text_and_link_destinations(body, expected):
    assert codes(review_content("An update", body, True)) == expected


def test_score_is_capped_and_each_rule_counts_once():
    body = '<div hidden><script>bad()</script><p>Special offer: Act now!!!</p><a href="data:bad">link</a><a href="https://bit.ly/demo">https://elsewhere.org</a></div>'
    review = review_content("RE: GUARANTEED INCOME!!!", body * 3, True)
    assert review["score"] == 100
    assert len(codes(review)) == len(review["findings"])


def test_overly_nested_markup_does_not_break_saving_or_claim_low_risk(api):
    client, calls, _ = api
    result = save(client, body="<div>" * 300 + "Hello").json()
    assert result["revision"] == 1
    assert result["content_review"]["score"] is None
    assert result["content_review"]["level"] == "unavailable"
    assert not calls


def test_save_overwrite_copy_and_reopen_return_fresh_review_without_sending(api):
    client, calls, _ = api
    saved = save(
        client,
        subject="GUARANTEED INCOME!!!",
        body="Act now! Special offer https://bit.ly/demo",
        is_html=False,
    ).json()
    path = f"/v1/saved-campaigns/{saved['id']}"
    assert saved["content_review"]["level"] == "high"
    assert client.get(path).json()["content_review"] == saved["content_review"]
    response = client.put(
        path,
        json={
            **saved,
            "subject": "Product overview",
            "body": "Hello {name}. Here is the overview you requested.",
        },
    )
    assert response.status_code == 200
    changed = response.json()
    assert changed["revision"] == 2 and changed["content_review"]["score"] == 0
    assert client.get(path).json()["content_review"]["score"] == 0
    copied = client.post("/v1/saved-campaigns", json={**changed, "id": str(uuid.uuid4())})
    assert copied.status_code == 201
    assert copied.json()["content_review"]["score"] == 0
    assert not calls
