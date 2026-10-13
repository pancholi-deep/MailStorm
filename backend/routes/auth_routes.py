from datetime import datetime, timezone
import logging
import time
from fastapi import APIRouter, HTTPException, Request
from google_auth_oauthlib.flow import Flow
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool
from backend.core.config import settings
from backend.utils.auth_utils import get_user_info
from backend.routes.dependencies import owner, bearer_token

router = APIRouter()
logger = logging.getLogger(__name__)


class CodeExchangeRequest(BaseModel):
    code: str = Field(min_length=1, max_length=4096)


def exchange_code(code, redirect_uri):
    flow = Flow.from_client_config(
        {
            "web": {
                "client_id": settings.google_client_id,
                "client_secret": settings.google_client_secret,
                "auth_uri": settings.google_auth_url,
                "token_uri": settings.google_token_url,
                "redirect_uris": [redirect_uri],
            }
        },
        scopes=[
            "https://www.googleapis.com/auth/gmail.send",
            "openid",
            "https://www.googleapis.com/auth/userinfo.profile",
            "https://www.googleapis.com/auth/userinfo.email",
        ],
        redirect_uri=redirect_uri,
    )
    flow.fetch_token(code=code, timeout=settings.http_timeout)
    return flow.credentials


@router.post("/auth/google")
async def auth_google(payload: CodeExchangeRequest, request: Request):
    request_origin = request.headers.get("origin")
    if (
        request_origin not in settings.allowed_origins
        or request.headers.get("x-requested-with") != "XmlHttpRequest"
    ):
        raise HTTPException(403, "Invalid sign-in request origin or verification header.")
    try:
        credentials = await run_in_threadpool(exchange_code, payload.code, request_origin)
    except Exception as exc:
        # Never log authorization codes, credentials, or provider response bodies.
        logger.warning("Google code exchange failed (%s)", type(exc).__name__)
        raise HTTPException(400, "Google sign-in failed. Please try again.") from exc
    info = await get_user_info(credentials.token, request.app.state.http_client)
    expiry = credentials.expiry
    if expiry is not None and expiry.tzinfo is None:
        expiry = expiry.replace(tzinfo=timezone.utc)
    expires_in = (
        max(0, int((expiry - datetime.now(timezone.utc)).total_seconds())) if expiry else 3600
    )
    session = await run_in_threadpool(
        request.app.state.store.sessions.login,
        info,
        credentials.token,
        getattr(credentials, "refresh_token", None),
        time.time() + expires_in,
    )
    return {
        "user": {
            "name": info.get("given_name") or info.get("name") or info["email"],
            "email": info["email"],
        },
        "access_token": session,
        "expires_in": settings.session_seconds,
    }


@router.post("/v1/logout")
async def logout(request: Request):
    await owner(request)
    await run_in_threadpool(request.app.state.store.sessions.logout, bearer_token(request))
    return {"ok": True}
