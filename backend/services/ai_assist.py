"""Writing assistance: bounded contracts, template preservation, no delivery side effects."""

from collections import Counter
from html import escape, unescape
from html.parser import HTMLParser
import re
from typing import Annotated, Literal, Protocol

from pydantic import BaseModel, ConfigDict, Field, model_validator

from backend.ports import AssistError
from backend.utils.validation import PLACEHOLDER, validate_template
from backend.services.html_draft import render_html_draft


class AssistRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    action: Literal["draft", "shorten", "proofread", "tone"]
    brief: str = Field(default="", max_length=2000)
    tone: Literal["professional", "friendly", "formal"] = "professional"
    subject: str = Field(default="", max_length=998)
    body: str = Field(default="", max_length=20000)
    is_html: bool = False
    fields: list[Annotated[str, Field(pattern=r"^[A-Za-z_][A-Za-z0-9_]{0,63}$")]] = Field(
        default_factory=list, max_length=64
    )
    consent: Literal[True]

    @model_validator(mode="after")
    def content(self):
        if self.action == "draft" and not self.brief.strip():
            raise ValueError("Describe the email to draft")
        if self.action != "draft" and not self.body.strip():
            raise ValueError("Write an email before requesting a rewrite")
        if "\x00" in self.body + self.brief or any(c in self.subject for c in "\r\n\x00"):
            raise ValueError("Invalid template characters")
        if self.action == "draft" and set(PLACEHOLDER.findall(self.brief)) - set(self.fields):
            raise ValueError("The brief contains unavailable placeholders")
        return self


class WritingProvider(Protocol):
    async def generate(self, instructions: dict) -> dict: ...


class HtmlText(HTMLParser):
    """Locate editable text without letting the model generate or change markup.

    Replacements use offsets in the original source. Attributes, links, styles,
    comments and document structure remain byte-for-byte unchanged.
    """

    def __init__(self, source):
        super().__init__(convert_charrefs=False)
        self.source = source
        self.lines = [0]
        self.lines.extend(i + 1 for i, c in enumerate(source) if c == "\n")
        self.spans = []
        self.start = None
        self.blocked = None
        self.feed(source)
        self.close()
        self.flush(len(source))

    def source_offset(self):
        line, column = self.getpos()
        return self.lines[line - 1] + column

    def flush(self, end):
        if self.start is not None:
            if self.source[self.start : end].strip():
                self.spans.append((self.start, end))
            self.start = None

    def handle_data(self, data):
        if not self.blocked and self.start is None:
            self.start = self.source_offset()

    handle_entityref = handle_data
    handle_charref = handle_data

    def handle_starttag(self, tag, attrs):
        self.flush(self.source_offset())
        if tag in {"head", "script", "style", "title"} and not self.blocked:
            self.blocked = tag

    def handle_endtag(self, tag):
        self.flush(self.source_offset())
        if tag == self.blocked:
            self.blocked = None

    def handle_startendtag(self, tag, attrs):
        self.flush(self.source_offset())

    def handle_comment(self, data):
        self.flush(self.source_offset())

    handle_decl = handle_comment
    handle_pi = handle_comment
    unknown_decl = handle_comment

    @property
    def segments(self):
        return [unescape(self.source[start:end]) for start, end in self.spans]

    def replace(self, segments):
        result = self.source
        for (start, end), value in reversed(list(zip(self.spans, segments))):
            # Inline tags must not join words if the model trims segment boundaries.
            original = unescape(self.source[start:end])
            leading = re.match(r"\s*", original).group()
            trailing = re.search(r"\s*$", original).group()
            replacement = leading + value.strip() + trailing
            result = result[:start] + escape(replacement, quote=False) + result[end:]
        return result


async def assist(provider: WritingProvider, data: AssistRequest):
    draft = data.action == "draft"
    try:
        html = HtmlText(data.body) if data.is_html and not draft else None
    except (ValueError, AssertionError) as exc:
        raise AssistError(
            "This HTML could not be read. Check its markup before using AI.", 422
        ) from exc
    segments = html.segments if html else [data.body]
    if not draft and (not any(s.strip() for s in segments) or len(segments) > 200):
        raise AssistError("This HTML template has too many text sections or no editable text.", 422)
    # Drafting only shares the brief; rewriting only shares the selected template's text.
    instructions = {
        "action": data.action,
        "tone": data.tone,
        "brief": data.brief if draft else "",
        "subject": "" if draft else data.subject,
        "segments": [] if draft else segments,
        "allowed_placeholders": data.fields if draft else [],
        "format": "html" if draft and data.is_html else "text",
    }
    result = await provider.generate(instructions)
    if draft and data.is_html:
        try:
            subject, body = render_html_draft(result, data.brief)
            validate_template(subject, body, data.fields)
        except (ValueError, TypeError) as exc:
            raise AssistError(
                "AI returned an invalid HTML draft or an unsupported link. Your draft is unchanged."
            ) from exc
        return {"subject": subject, "body": body, "is_html": True}
    try:
        subject, output = result["subject"], result["segments"]
        if not isinstance(subject, str) or not isinstance(output, list):
            raise ValueError()
        if len(output) != (1 if draft else len(segments)):
            raise ValueError()
        if any(not isinstance(s, str) for s in output) or sum(map(len, output)) > 20000:
            raise ValueError()
        if draft:
            if set(PLACEHOLDER.findall(subject + "\n" + output[0])) - set(data.fields):
                raise ValueError()
            body = output[0]
        else:
            for before, after in zip([data.subject, *segments], [subject, *output]):
                if Counter(PLACEHOLDER.findall(before)) != Counter(PLACEHOLDER.findall(after)):
                    raise ValueError()
            body = html.replace(output) if html else output[0]
        validate_template(subject, body)
    except (KeyError, TypeError, ValueError) as exc:
        raise AssistError(
            "AI returned an incomplete suggestion or changed placeholders. Your draft is unchanged."
        ) from exc
    return {"subject": subject, "body": body, "is_html": data.is_html}
