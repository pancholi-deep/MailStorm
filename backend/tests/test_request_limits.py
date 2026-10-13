import asyncio
from backend.core.config import settings
from backend.core.request_limits import RequestBodyLimit


def test_chunked_body_is_limited_before_multipart_parsing(monkeypatch):
    monkeypatch.setattr(settings, "max_csv_bytes", 10)
    monkeypatch.setattr(settings, "max_body_bytes", 10)
    called = []
    messages = []

    async def app(scope, receive, send):
        from fastapi import HTTPException
        from fastapi.responses import JSONResponse

        try:
            await receive()
            called.append(True)
        except HTTPException as exc:
            await JSONResponse({"detail": exc.detail}, status_code=exc.status_code)(
                scope, receive, send
            )

    async def receive():
        return {"type": "http.request", "body": b"x" * 131200, "more_body": True}

    async def send(message):
        messages.append(message)

    asyncio.run(
        RequestBodyLimit(app)(
            {"type": "http", "method": "POST", "path": "/send-emails", "headers": []}, receive, send
        )
    )
    assert not called
    assert messages[0]["status"] == 413


def test_declared_oversized_auth_body_is_rejected_without_reading():
    messages = []

    async def never(*args):
        raise AssertionError("Oversized requests must not be parsed")

    async def send(message):
        messages.append(message)

    asyncio.run(
        RequestBodyLimit(never)(
            {
                "type": "http",
                "method": "POST",
                "path": "/auth/google",
                "headers": [(b"content-length", b"20000")],
            },
            never,
            send,
        )
    )
    assert messages[0]["status"] == 413
