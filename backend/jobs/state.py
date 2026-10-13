"""Delivery lifecycle constants shared by admission, scheduling and retention."""

from backend.jobs.database import campaigns

ACTIVE = ("importing", "queued", "running", "retry_wait")
TERMINAL = ("complete", "cancelled", "invalid", "blocked", "awaiting_auth")
STATE_COLUMNS = [column for column in campaigns.c if column.name != "secret"]
STATUS_FIELDS = (
    "id",
    "state",
    "total",
    "accepted",
    "failed",
    "unknown",
    "cancel_requested",
    "created",
    "updated",
    "error",
    "next_at",
)


class LostLease(Exception):
    """The worker no longer owns this lease generation."""
