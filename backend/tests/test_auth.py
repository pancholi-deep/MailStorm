from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from backend.routes import auth_routes
from backend.utils.auth_utils import get_user_info


def test_auth_requires_trusted_origin_and_verification_header(api):
    client, _, _ = api
    for headers in [
        {},
        {"Origin": "https://evil.example", "X-Requested-With": "XmlHttpRequest"},
        {"Origin": "http://localhost:3000"},
    ]:
        assert (
            client.post("/auth/google", json={"code": "code"}, headers=headers).status_code == 403
        )


def test_popup_exchange_uses_verified_origin_and_returns_expiry(api, monkeypatch):
    client, _, _ = api
    origins = []

    def exchange(code, origin):
        origins.append(origin)
        return SimpleNamespace(
            token="test-token",
            expiry=(datetime.now(timezone.utc) + timedelta(hours=1)).replace(tzinfo=None),
        )

    monkeypatch.setattr(auth_routes, "exchange_code", exchange)
    response = client.post(
        "/auth/google",
        json={"code": "code"},
        headers={"Origin": "http://localhost:3000", "X-Requested-With": "XmlHttpRequest"},
    )
    assert response.status_code == 200
    assert origins == ["http://localhost:3000"]
    assert response.json()["expires_in"] == 604800
    assert response.json()["access_token"] != "test-token"


def test_auth_errors_do_not_expose_provider_details(api, monkeypatch):
    client, _, _ = api

    def exchange(*args):
        raise ValueError("private authorization code")

    monkeypatch.setattr(auth_routes, "exchange_code", exchange)
    response = client.post(
        "/auth/google",
        json={"code": "code"},
        headers={"Origin": "http://localhost:3000", "X-Requested-With": "XmlHttpRequest"},
    )
    assert response.status_code == 400
    assert "private authorization code" not in response.text


def test_legacy_google_userinfo_endpoint_remains_supported(configured):
    import asyncio
    import httpx

    async def run():
        async with httpx.AsyncClient(
            transport=httpx.MockTransport(
                lambda request: httpx.Response(
                    200, json={"id": "legacy-google-id", "email": "sender@gmail.com"}
                )
            )
        ) as client:
            info = await get_user_info("token", client)
            assert info["sub"] == "legacy-google-id"

    asyncio.run(run())
