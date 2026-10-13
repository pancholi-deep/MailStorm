import httpx
import anyio
from fastapi import HTTPException
from backend.core.config import settings
from backend.utils.validation import valid_email


async def get_user_info(access_token: str, client: httpx.AsyncClient):
    try:
        with anyio.fail_after(settings.http_timeout):
            response = await client.get(
                settings.google_user_info_url,
                headers={"Authorization": f"Bearer {access_token}"},
            )
        if response.status_code in (401, 403):
            raise HTTPException(401, "Your Google session has expired. Please sign in again.")
        response.raise_for_status()
        info = response.json()
        if isinstance(info, dict):
            # The legacy configurable v2 userinfo endpoint calls this field id.
            info["sub"] = info.get("sub") or info.get("id")
        if (
            not isinstance(info, dict)
            or not isinstance(info.get("email"), str)
            or not valid_email(info["email"])
            or not isinstance(info.get("sub"), str)
            or not info["sub"]
        ):
            raise HTTPException(502, "Google returned an incomplete user profile.")
        for key in ("name", "given_name"):
            value = info.get(key)
            info[key] = " ".join(value.split()) if isinstance(value, str) else ""
        return info
    except (httpx.HTTPError, ValueError, TimeoutError) as exc:
        raise HTTPException(502, "Unable to verify your Google session. Please try again.") from exc
