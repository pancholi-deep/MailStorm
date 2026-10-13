"""Consumer contracts. Adapters are composed at startup, not selected by business logic."""

from collections.abc import AsyncIterable, Awaitable, Callable
from typing import BinaryIO, ContextManager, Protocol


class AuthorizationRequired(Exception):
    """The stored provider authorization must be renewed by signing in."""


class SendError(Exception):
    def __init__(
        self,
        message,
        *,
        stop=False,
        uncertain=False,
        auth=False,
        retryable=False,
        retry_after=0,
        code="provider_rejected",
        project_limit=False,
    ):
        super().__init__(message)
        self.stop = stop
        self.uncertain = uncertain
        self.auth = auth
        self.retryable = retryable
        self.retry_after = retry_after
        self.code = code
        self.project_limit = project_limit


class AssistError(Exception):
    def __init__(self, message, status=502, code="ai_invalid_response"):
        super().__init__(message)
        self.status = status
        self.code = code


class MessageProvider(Protocol):
    async def refresh(self, connection: dict) -> bool:
        """Update credentials in place and report whether persistence is needed."""
        ...

    async def send(
        self, connection: dict, to: str, subject: str, body: str, is_html: bool
    ) -> str | None: ...


class ObjectReader(Protocol):
    def open(self, identifier: str) -> ContextManager[BinaryIO]: ...


class RetainedObjects(ObjectReader, Protocol):
    def delete(self, identifier: str) -> None: ...


class PrivateObjects(RetainedObjects, Protocol):
    completion_state: str
    receive_content: Callable[[dict, AsyncIterable[bytes]], Awaitable[None]] | None

    def target(self, identifier: str, size: int) -> dict: ...
    def save_stream(self, identifier: str, source: BinaryIO) -> None: ...
    def finalize(self, identifier: str, size: int) -> None: ...


class UploadReader(Protocol):
    def upload(self, owner: str, identifier: str) -> dict: ...


class ImportQueue(Protocol):
    def begin_import(self, job: dict) -> None: ...
    def import_chunk(self, job: dict, rows: list) -> bool: ...
    def finish_import(self, job: dict) -> None: ...
    def release(self, job: dict, state=None, error=None, delay=0) -> None: ...


class DeliveryQueue(ImportQueue, Protocol):
    def claim(self, worker: str) -> dict | None: ...
    def heartbeat(self, job: dict) -> None: ...
    def connection(self, job: dict) -> tuple[dict, int]: ...
    def save_connection(self, job: dict, secret: dict, version: int) -> None: ...
    def next_recipient(self, job: dict) -> tuple[dict | None, str | None, float]: ...
    def defer_sender(self, job: dict, delay: float, project=False) -> None: ...
    def outcome(
        self, job: dict, recipient: dict, state: str, provider_id=None, error=None
    ) -> None: ...


class Retention(Protocol):
    def cleanup(self) -> list[str]: ...
    def delete_upload_record(self, identifier: str) -> None: ...
