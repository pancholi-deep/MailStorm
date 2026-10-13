"""Preflight the entire batch before any message is sent."""
import csv
import html
import io
import re
from collections import Counter
from backend.core.config import settings

EMAIL_PATTERN = re.compile(r"^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$")
PLACEHOLDER = re.compile(r"\{([A-Za-z_][A-Za-z0-9_]*)\}")


def valid_email(value):
    local = value.split("@")[0]
    return (len(value) <= 254 and len(local) <= 64 and bool(EMAIL_PATTERN.fullmatch(value))
            and ".." not in local and not local.startswith(".") and not local.endswith("."))


def parse_recipients(data: bytes):
    try:
        text = data.decode("utf-8-sig")
        reader = csv.reader(io.StringIO(text, newline=""), strict=True)
        headers = [value.strip().lower() for value in next(reader)]
        if len(set(headers)) != len(headers) or not {"name", "email"}.issubset(headers):
            raise ValueError("CSV must contain unique 'name' and 'email' columns")
        recipients = []
        for values in reader:
            if not values or all(not value.strip() for value in values):
                continue
            if len(values) != len(headers):
                raise ValueError(f"CSV row {reader.line_num} has an incorrect number of columns")
            row = dict(zip(headers, (value.strip() for value in values)))
            if not row["name"] or not row["email"]:
                raise ValueError(f"CSV row {reader.line_num} requires name and email")
            if len(row["name"]) > 200 or any(c in row["name"] for c in "\r\n\x00"):
                raise ValueError(f"CSV row {reader.line_num} has an invalid name")
            if not valid_email(row["email"]):
                raise ValueError(f"CSV row {reader.line_num} has an invalid email address")
            recipients.append({"name": row["name"].split()[0], "email": row["email"]})
            if len(recipients) > settings.max_recipients:
                raise ValueError(f"CSV must contain at most {settings.max_recipients} recipients")
        if not recipients:
            raise ValueError("CSV must contain at least one recipient")
        return recipients
    except (UnicodeDecodeError, csv.Error, StopIteration) as exc:
        raise ValueError("CSV must be a nonempty, valid UTF-8 CSV file") from exc


def validate_subject(subject):
    if not subject.strip() or len(subject) > 998 or any(c in subject for c in "\r\n\x00"):
        raise ValueError("Email subject must be nonempty, at most 998 characters, and contain no line breaks")


def validate_template(subject, body):
    validate_subject(subject)
    if not body.strip() or len(body) > settings.max_body_chars or "\x00" in body:
        raise ValueError(f"Email body must be nonempty and at most {settings.max_body_chars} characters")
    unknown = set(PLACEHOLDER.findall(subject + "\n" + body)) - {"name", "email"}
    if unknown:
        raise ValueError("Unknown template placeholder(s): " + ", ".join(sorted(unknown)))


def validate_rendered_templates(subject, body, recipients, is_html):
    validate_template(subject, body)
    counts = Counter(PLACEHOLDER.findall(body))
    for recipient in recipients:
        validate_subject(personalize(subject, recipient))
        # Count expansion without building potentially enormous rendered bodies
        # or scanning the full template for every recipient.
        size = len(body)
        for key, count in counts.items():
            value = html.escape(recipient[key], quote=True) if is_html else recipient[key]
            size += count * (len(value) - len(key) - 2)
        if size > settings.max_body_chars:
            raise ValueError(f"Personalized email body exceeds {settings.max_body_chars} characters")


def personalize(template, recipient, is_html=False):
    return PLACEHOLDER.sub(
        lambda match: html.escape(recipient[match[1]], quote=True) if is_html else recipient[match[1]], template,
    )
