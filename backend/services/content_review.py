"""Explainable content checks. Scores are editorial heuristics, never Gmail probabilities.

Weights are MailStorm's uncalibrated warning points. They do not model Gmail's
classifier or inspect reputation, authentication, complaints, or recipient consent.
"""

import re
from html.parser import HTMLParser
from urllib.parse import urlsplit

from backend.utils.validation import PLACEHOLDER

GUIDELINES = "https://support.google.com/mail/answer/81126?hl=en"
URL = re.compile(r"https?://[^\s<>\"']+", re.I)
SHORTENERS = {"bit.ly", "tinyurl.com", "t.co", "ow.ly", "is.gd", "buff.ly"}
HIDDEN = re.compile(
    r"(?:display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0(?:[;\s]|$)|font-size\s*:\s*0(?:px|pt|em|rem|[;\s]|$))",
    re.I,
)


def host(value):
    try:
        return (urlsplit(value).hostname or "").lower().removeprefix("www.").encode("idna").decode()
    except (ValueError, UnicodeError):
        return ""


class EmailContent(HTMLParser):
    def __init__(self, body):
        super().__init__(convert_charrefs=True)
        self.text = []
        self.links = []
        self.anchor = None
        self.images = 0
        self.hidden = False
        self.active_content = False
        self.ignored = None
        self.elements = []
        self.feed(body)
        self.close()

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag in {"script", "iframe", "object", "embed", "form"}:
            self.active_content = True
        if tag in {"head", "script", "style", "title"} and not self.ignored:
            self.ignored = tag
        hidden = bool("hidden" in attrs or HIDDEN.search(attrs.get("style") or ""))
        if hidden:
            self.hidden = True
        if tag not in {
            "area",
            "base",
            "br",
            "col",
            "embed",
            "hr",
            "img",
            "input",
            "link",
            "meta",
            "param",
            "source",
            "track",
            "wbr",
        }:
            if len(self.elements) >= 256:
                raise ValueError("HTML nesting exceeds the content review limit")
            self.elements.append((tag, hidden or bool(self.elements and self.elements[-1][1])))
        if tag == "img":
            self.images += 1
        if tag == "a" and not self.ignored:
            self.anchor = {"url": (attrs.get("href") or "").strip(), "label": ""}
            self.links.append(self.anchor)
        if tag in {"p", "br", "div", "li", "td", "h1", "h2", "h3"}:
            self.text.append(" ")

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        self.handle_endtag(tag)

    def handle_endtag(self, tag):
        for index in range(len(self.elements) - 1, -1, -1):
            if self.elements[index][0] == tag:
                del self.elements[index:]
                break
        if tag == self.ignored:
            self.ignored = None
        if tag == "a":
            self.anchor = None
        if tag in {"p", "div", "li", "td", "h1", "h2", "h3"}:
            self.text.append(" ")

    def handle_data(self, data):
        if not self.ignored and not (self.elements and self.elements[-1][1]):
            self.text.append(data)
            if self.anchor is not None:
                self.anchor["label"] += data


def review_content(subject, body, is_html):
    findings = []

    def flag(condition, code, points, title, suggestion):
        if condition:
            findings.append(
                {"code": code, "points": points, "title": title, "suggestion": suggestion}
            )

    try:
        html = EmailContent(body) if is_html else None
    except (ValueError, AssertionError):
        return {
            "score": None,
            "level": "unavailable",
            "findings": [],
            "version": 1,
            "message": "Campaign saved, but its HTML could not be analyzed. Check the markup and save again.",
        }
    text = "".join(html.text) if html else body
    # Placeholder names are schema labels, not content (e.g. {FREE_OFFER}).
    subject_text = PLACEHOLDER.sub("", subject)
    combined = PLACEHOLDER.sub("", subject_text + " " + text)
    letters = [c for c in subject_text if c.isalpha() and c.lower() != c.upper()]
    links = html.links if html else [{"url": url, "label": url} for url in URL.findall(body)]
    urls = {link["url"].rstrip(".,;!?)") for link in links if link["url"]}
    flag(
        len(letters) >= 12 and sum(c.isupper() for c in letters) / len(letters) > 0.7,
        "capitalization",
        10,
        "Mostly uppercase subject",
        "Use sentence case and a specific, accurate subject instead of a shouted headline.",
    )
    flag(
        bool(re.search(r"[!?]{3,}", combined)),
        "punctuation",
        10,
        "Repeated exclamation or question marks",
        "Reduce repeated punctuation and let clear wording convey the message.",
    )
    flag(
        bool(
            re.search(
                r"\b(?:act now|guaranteed income|risk[- ]free|100% free|instant cash)\b",
                combined,
                re.I,
            )
        ),
        "pressure",
        10,
        "High-pressure promotional wording",
        "Replace pressure or sweeping promises with concrete, verifiable benefits and a clear next step.",
    )
    flag(
        bool(re.match(r"\s*(?:re|fwd?)\s*:", subject, re.I)),
        "thread_subject",
        10,
        "Reply or forward prefix",
        "Keep Re: or Fwd: only for a genuine reply or forward. Use a fresh subject for new outreach.",
    )
    flag(
        bool(html and html.hidden),
        "hidden_content",
        20,
        "Hidden HTML content",
        "Inspect hidden text and remove misleading or unnecessary content. A legitimate preheader can also trigger this check.",
    )
    flag(
        bool(html and html.active_content),
        "active_content",
        25,
        "Scripts, forms, or embedded content",
        "Use ordinary email text, tables, and links; remove scripts, forms, frames, and embedded objects.",
    )
    flag(
        any(host(url) in SHORTENERS for url in urls),
        "short_links",
        15,
        "Shortened link destinations",
        "Use the full, recognizable destination URL so recipients can understand where the link leads.",
    )
    dangerous = any(
        re.match(r"\s*(?:javascript|data|vbscript):", link["url"], re.I) for link in links
    )
    flag(
        dangerous,
        "unsafe_links",
        30,
        "Unsafe link scheme",
        "Replace script or data links with a genuine HTTPS destination.",
    )
    mismatch = False
    for link in links:
        label = link["label"].strip()
        if URL.fullmatch(label):
            displayed, destination = host(label), host(link["url"])
            if displayed and destination and displayed != destination:
                if not displayed.endswith("." + destination) and not destination.endswith(
                    "." + displayed
                ):
                    mismatch = True
    flag(
        mismatch,
        "misleading_links",
        25,
        "Displayed URL differs from the destination",
        "Make the visible URL match its destination, or use a clear description of the destination.",
    )
    flag(
        len(urls) > 10,
        "many_links",
        10,
        "Many different links",
        "Keep links focused on the purpose of the email and remove unnecessary destinations.",
    )
    flag(
        bool(html and html.images and len(combined.strip()) < 80),
        "image_heavy",
        15,
        "Little readable text alongside images",
        "Explain the message and next step in visible text so the email remains useful when images are blocked.",
    )
    promotional = bool(
        re.search(
            r"\b(?:newsletter|discount|promotion|special offer)\b|\d+\s*%\s*off\b", combined, re.I
        )
    )
    opt_out = bool(re.search(r"\b(?:unsubscribe|opt[- ]out|stop receiving)\b", text, re.I))
    flag(
        promotional and not opt_out,
        "opt_out",
        15,
        "No visible opt-out wording detected",
        "For marketing or subscription mail, add a clear, working unsubscribe option. A body link alone does not implement one-click unsubscribe headers.",
    )
    flag(
        is_html and len(body.encode("utf-8")) > 100000,
        "large_html",
        10,
        "Large HTML message",
        "Simplify unnecessary markup and styling to keep the email lightweight and readable.",
    )
    score = min(100, sum(item["points"] for item in findings))
    return {
        "score": score,
        "level": "high" if score >= 50 else "moderate" if score >= 25 else "low",
        "findings": findings,
        "version": 1,
        "guidelines_url": GUIDELINES,
    }


def with_content_review(saved):
    return {
        **saved,
        "content_review": review_content(saved["subject"], saved["body"], saved["is_html"]),
    }
