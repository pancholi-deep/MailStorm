"""Preflight the entire batch before any message is sent."""

import html
import re
from collections import Counter
from backend.core.config import settings

EMAIL_PATTERN = re.compile(
    r"^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$"
)
PLACEHOLDER = re.compile(r"\{([A-Za-z_][A-Za-z0-9_]*)\}")


def valid_email(value):
    local = value.split("@")[0]
    return (
        len(value) <= 254
        and len(local) <= 64
        and bool(EMAIL_PATTERN.fullmatch(value))
        and ".." not in local
        and not local.startswith(".")
        and not local.endswith(".")
    )


def validate_subject(subject):
    if not subject.strip() or len(subject) > 998 or any(c in subject for c in "\r\n\x00"):
        raise ValueError(
            "Email subject must be nonempty, at most 998 characters, and contain no line breaks"
        )


def validate_field_mapping(mapping):
    if not isinstance(mapping, dict) or len(mapping) > 32:
        raise ValueError("Use at most 32 field mappings")
    for key, column in mapping.items():
        if (
            not isinstance(key, str)
            or not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]{0,63}", key)
            or not isinstance(column, str)
            or not column.strip()
            or len(column) > 128
            or any(c in column for c in "\r\n\x00")
        ):
            raise ValueError("Field mappings require a placeholder name and a CSV column")
        if key in {"name", "email"} and column != key:
            raise ValueError("The name and email placeholders cannot be remapped")
    return {key: value.strip().lower() for key, value in mapping.items()}


def validate_template(subject, body, available_fields=None):
    validate_subject(subject)
    if not body.strip() or len(body) > settings.max_body_chars or "\x00" in body:
        raise ValueError(
            f"Email body must be nonempty and at most {settings.max_body_chars} characters"
        )
    unknown = (
        set(PLACEHOLDER.findall(subject + "\n" + body)) - set(available_fields)
        if available_fields is not None
        else set()
    )
    if unknown:
        raise ValueError("Unknown template placeholder(s): " + ", ".join(sorted(unknown)))


def validate_rendered_templates(subject, body, recipients, is_html):
    validate_template(subject, body, recipients[0] if recipients else ())
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
            raise ValueError(
                f"Personalized email body exceeds {settings.max_body_chars} characters"
            )


def personalize(template, recipient, is_html=False):
    return PLACEHOLDER.sub(
        lambda match: html.escape(recipient[match[1]], quote=True)
        if is_html
        else recipient[match[1]],
        template,
    )
