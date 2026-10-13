"""Count bytes as ASGI chunks arrive; never buffer an entire upload in middleware."""

import time
import anyio
from fastapi import HTTPException
from fastapi.responses import JSONResponse
from backend.core.config import settings


class RequestBodyLimit:
    def __init__(self, app):
        self.app = app
        self.active = 0

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or scope.get("method") not in ("POST", "PUT"):
            return await self.app(scope, receive, send)
        path = scope["path"]
        if path.endswith("/content") or path == "/send-emails":
            limit = settings.max_csv_bytes + settings.max_body_bytes + 131072
        elif path == "/v1/campaigns" or path.startswith("/v1/saved-campaigns"):
            limit = (
                settings.max_body_bytes * 2 + 16384
            )  # JSON escaping; semantic UTF-8 limit remains authoritative.
        else:
            limit = 16384
        try:
            length = int(dict(scope.get("headers", [])).get(b"content-length", b"0"))
        except ValueError:
            length = 0
        if length > limit:
            return await JSONResponse(
                {"detail": "Request exceeds the upload limit", "code": "body_too_large"},
                status_code=413,
            )(scope, receive, send)
        if self.active >= settings.max_uploads:
            return await JSONResponse(
                {"detail": "Server is busy receiving uploads"},
                status_code=429,
                headers={"Retry-After": "5"},
            )(scope, receive, send)
        self.active += 1
        size = 0
        deadline = time.monotonic() + settings.upload_timeout

        async def bounded_receive():
            nonlocal size
            try:
                with anyio.fail_after(max(0, deadline - time.monotonic())):
                    message = await receive()
            except TimeoutError as exc:
                raise HTTPException(408, "Upload timed out") from exc
            size += len(message.get("body", b""))
            if size > limit:
                raise HTTPException(413, "Request exceeds the upload limit")
            return message

        try:
            await self.app(scope, bounded_receive, send)
        finally:
            self.active -= 1
