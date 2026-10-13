"""Turn model-authored email sections into safe, consistently styled email HTML."""

import re
from html import escape
from typing import Annotated
from urllib.parse import urlsplit

from pydantic import BaseModel, ConfigDict, Field

Text = Annotated[str, Field(max_length=3000)]


class HtmlDraft(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    subject: str = Field(min_length=1, max_length=998)
    heading: str = Field(min_length=1, max_length=160)
    greeting: str = Field(max_length=300)
    paragraphs: list[Text] = Field(min_length=1, max_length=8)
    bullets: list[Text] = Field(max_length=8)
    closing: str = Field(max_length=500)
    cta_text: str = Field(max_length=100)
    cta_url: str = Field(max_length=2000)


HTML_DRAFT_SCHEMA = {
    "type": "OBJECT",
    "properties": {
        **{
            key: {"type": "STRING"}
            for key in ("subject", "heading", "greeting", "closing", "cta_text", "cta_url")
        },
        "paragraphs": {"type": "ARRAY", "items": {"type": "STRING"}},
        "bullets": {"type": "ARRAY", "items": {"type": "STRING"}},
    },
    "required": [
        "subject",
        "heading",
        "greeting",
        "paragraphs",
        "bullets",
        "closing",
        "cta_text",
        "cta_url",
    ],
}


def render_html_draft(result, brief):
    draft = HtmlDraft.model_validate(result)
    if not draft.heading.strip() or not any(value.strip() for value in draft.paragraphs):
        raise ValueError("Empty HTML draft")
    if bool(draft.cta_text.strip()) != bool(draft.cta_url.strip()):
        raise ValueError("A button needs a label and a provided destination")
    if draft.cta_url:
        # No invented destinations, tracking pixels or placeholder-controlled URLs.
        provided_urls = {
            value.rstrip(".,;!?)") for value in re.findall(r'https?://[^\s<>"\']+', brief)
        }
        url = urlsplit(draft.cta_url)
        if (
            draft.cta_url not in provided_urls
            or url.scheme not in {"http", "https"}
            or not url.hostname
            or url.username
            or url.password
            or any(c in draft.cta_url for c in "\r\n\x00{}")
        ):
            raise ValueError("The button must use an HTTP(S) URL supplied in the brief")

    def text(value):
        return escape(value.strip()).replace("\n", "<br>")

    def paragraph(value):
        return (
            f'<p style="margin:0 0 18px;line-height:1.7">{text(value)}</p>' if value.strip() else ""
        )

    content = paragraph(draft.greeting)
    content += "".join(paragraph(value) for value in draft.paragraphs)
    if draft.bullets:
        content += '<ul style="padding-left:22px;margin:0 0 24px;line-height:1.7">'
        content += "".join(
            f'<li style="margin-bottom:10px">{text(value)}</li>'
            for value in draft.bullets
            if value.strip()
        )
        content += "</ul>"
    if draft.cta_url:
        content += (
            '<p style="margin:26px 0">'
            f'<a href="{escape(draft.cta_url, quote=True)}" style="display:inline-block;background-color:#0866c6;'
            'color:#ffffff;text-decoration:none;padding:14px 22px;border-radius:8px;font-weight:bold">'
            f"{text(draft.cta_text)}</a></p>"
        )
    content += paragraph(draft.closing)
    body = (
        '<!doctype html><html><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width, initial-scale=1"></head>'
        '<body style="margin:0;padding:0;background-color:#f2f5fa;color:#24334a;font-family:Arial,Helvetica,sans-serif">'
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f2f5fa">'
        '<tr><td align="center" style="padding:28px 12px">'
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background-color:#ffffff;border-radius:12px;border:1px solid #dce4ee">'
        '<tr><td style="padding:30px 26px;background-color:#eaf2ff;border-radius:12px 12px 0 0;border-top:4px solid #0866c6">'
        f'<h1 style="margin:0;font-size:25px;line-height:1.3;color:#133763">{text(draft.heading)}</h1>'
        '</td></tr><tr><td style="padding:28px 26px;font-size:16px;line-height:1.7">'
        f"{content}</td></tr></table></td></tr></table></body></html>"
    )
    return draft.subject, body
