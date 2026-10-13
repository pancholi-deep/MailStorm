import asyncio
import pytest

from backend.ports import AssistError
from backend.services.ai_assist import AssistRequest, assist
from backend.services.html_draft import render_html_draft


def draft(**changes):
    return {
        "subject": "A product update",
        "heading": "A clearer view",
        "greeting": "Hi {name},",
        "paragraphs": ["Here is the update.", "Reply to learn more."],
        "bullets": [],
        "closing": "Thank you",
        "cta_text": "",
        "cta_url": "",
        **changes,
    }


def test_generated_sections_are_escaped_and_optional_button_is_omitted():
    subject, html = render_html_draft(
        draft(heading='<img src=x onerror="bad()">', paragraphs=["One & two\nThree"]), ""
    )
    assert subject == "A product update"
    assert "<img" not in html and "&lt;img" in html
    assert "One &amp; two<br>Three" in html
    assert "<a " not in html and "<ul " not in html
    assert "Hi {name}," in html


@pytest.mark.parametrize(
    "url,brief",
    [
        ("https://invented.example", "Use a reply CTA"),
        ("javascript:alert(1)", "javascript:alert(1)"),
        ("https://user:pass@example.org", "https://user:pass@example.org"),
        ("https://example.org/{name}", "https://example.org/{name}"),
        ("https://example.org/\n", "https://example.org/\n"),
    ],
)
def test_cta_cannot_introduce_unprovided_or_unsafe_destinations(url, brief):
    with pytest.raises(ValueError):
        render_html_draft(draft(cta_text="Open", cta_url=url), brief)


@pytest.mark.parametrize(
    "changes",
    [
        {"paragraphs": []},
        {"heading": " "},
        {"paragraphs": [" "]},
        {"paragraphs": [123]},
        {"cta_text": "Open"},
        {"cta_url": "https://example.org"},
        {"script": "bad"},
        {"subject": "a" * 999},
    ],
)
def test_invalid_structured_content_is_rejected(changes):
    with pytest.raises(ValueError):
        render_html_draft(draft(**changes), "https://example.org")


def test_bad_generated_placeholders_leave_draft_unchanged():
    class Provider:
        async def generate(self, instructions):
            return draft(paragraphs=["Hello {unknown}"])

    request = AssistRequest(
        action="draft", brief="Welcome", fields=["name"], is_html=True, consent=True
    )
    with pytest.raises(AssistError, match="Your draft is unchanged"):
        asyncio.run(assist(Provider(), request))


def test_plain_text_api_drafting_still_supported():
    class Provider:
        async def generate(self, instructions):
            assert instructions["format"] == "text"
            return {"subject": "Welcome", "segments": ["Hello {name}"]}

    result = asyncio.run(
        assist(
            Provider(),
            AssistRequest(
                action="draft", brief="Welcome", fields=["name"], is_html=False, consent=True
            ),
        )
    )
    assert result == {"subject": "Welcome", "body": "Hello {name}", "is_html": False}
