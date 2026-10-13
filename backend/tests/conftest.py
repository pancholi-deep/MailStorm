import httpx
import pytest
from fastapi.testclient import TestClient
from backend.core.config import settings
from backend.main import app


@pytest.fixture
def configured(monkeypatch, tmp_path):
    for key, value in {
        "frontend_url": "http://localhost:3000",
        "google_client_id": "test-client",
        "google_client_secret": "test-secret",
        "batch_db": str(tmp_path / "batches.sqlite3"),
        "storage_dir": str(tmp_path / "objects"),
        "embedded_worker": False,
        "sender_interval": 0.001,
        "project_interval": 0.001,
        "database_url": "",
        "encryption_key": "",
        "s3_bucket": "",
        "environment": "development",
    }.items():
        monkeypatch.setattr(settings, key, value)
    monkeypatch.delenv("CORS_ORIGINS", raising=False)


@pytest.fixture
def api(configured):
    calls = []
    status = {"send": 200, "profile": 200}

    def provider(request):
        if request.method == "GET":
            return httpx.Response(
                status["profile"],
                json={"sub": "google-user", "name": "Sender", "email": "sender@gmail.com"},
            )
        calls.append(request)
        if status["send"] == "timeout":
            raise httpx.ReadTimeout("private provider data", request=request)
        return httpx.Response(status["send"], json={"id": "message-id"})

    with TestClient(app) as client:
        app.state.http_client = httpx.AsyncClient(transport=httpx.MockTransport(provider))
        import time

        session = app.state.store.sessions.login(
            {"sub": "google-user", "name": "Sender", "email": "sender@gmail.com"},
            "test-token",
            "refresh-secret",
            time.time() + 3600,
        )
        client.headers["Authorization"] = f"Bearer {session}"
        yield client, calls, status
