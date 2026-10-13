"""Gmail-specific credential renewal, personalization and message submission."""

import time
from backend.core.config import settings
from backend.ports import AuthorizationRequired
from backend.utils.email_utils import send_via_gmail_api


class GmailProvider:
    def __init__(self, client):
        self.client = client

    async def refresh(self, connection):
        if not connection["expires_at"] < time.time() + 60:
            return False
        if not connection.get("refresh_token"):
            raise AuthorizationRequired("Sign in again to continue.")
        response = await self.client.post(
            settings.google_token_url,
            data={
                "client_id": settings.google_client_id,
                "client_secret": settings.google_client_secret,
                "grant_type": "refresh_token",
                "refresh_token": connection["refresh_token"],
            },
        )
        if response.status_code in (400, 401, 403):
            raise AuthorizationRequired("Google authorization needs renewal.")
        response.raise_for_status()
        refreshed = response.json()
        connection.update(
            token=refreshed["access_token"],
            expires_at=time.time() + refreshed.get("expires_in", 3600),
        )
        return True

    async def send(self, connection, to, subject, body, is_html):
        return await send_via_gmail_api(
            connection["token"],
            to,
            subject,
            body,
            connection["name"],
            connection["email"],
            is_html,
            self.client,
        )


async def revoke_authorization(client, token):
    """Never log tokens or provider responses; a failure is reported to the caller."""
    import httpx

    if not token:
        return True
    try:
        response = await client.post(
            "https://oauth2.googleapis.com/revoke",
            data={"token": token},
            timeout=10,
        )
        if response.status_code == 200:
            return True
        # Already-invalid tokens have no remaining authorization to revoke.
        return response.status_code == 400 and response.json().get("error") == "invalid_token"
    except (httpx.HTTPError, ValueError, AttributeError):
        return False
