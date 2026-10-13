from fastapi import APIRouter, Request, HTTPException
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool as thread

from backend.core.config import settings
from backend.jobs.ai_usage import reserve_ai_usage
from backend.providers.gemini import GeminiClient
from backend.services.ai_review import ReviewRequest, VERSION, assess, fingerprint, review_input
from backend.routes.dependencies import owner, payload
from backend.ports import AssistError
from backend.services.ai_assist import AssistRequest, assist

router = APIRouter(prefix="/v1/ai")


@router.get("/status")
async def status(request: Request):
    await owner(request)
    return {"available": bool(settings.gemini_api_key)}


@router.post("/assist")
async def writing_assistance(request: Request):
    user = await owner(request)
    data = await payload(request, AssistRequest)
    if not settings.gemini_api_key:
        return JSONResponse(
            {
                "detail": "AI Assist is not configured. You can continue editing manually.",
                "code": "ai_not_configured",
            },
            status_code=503,
        )
    try:
        await thread(
            reserve_ai_usage,
            request.app.state.store.database,
            user,
            settings.ai_user_daily_limit,
            settings.ai_project_daily_limit,
        )
        provider = GeminiClient(
            request.app.state.http_client, settings.gemini_api_key, settings.gemini_model
        )
        return await assist(provider, data)
    except AssistError as exc:
        return JSONResponse({"detail": str(exc), "code": exc.code}, status_code=exc.status)


@router.post("/review")
async def content_assessment(request: Request):
    user = await owner(request)
    data = await payload(request, ReviewRequest)
    saved = await thread(request.app.state.store.library.get, user, data.campaign_id.hex)
    if saved["revision"] != data.revision:
        raise HTTPException(409, "This campaign changed. Reopen or save it before reviewing.")
    if not settings.gemini_api_key:
        return JSONResponse(
            {
                "detail": "AI review is not configured. Local checks are available.",
                "code": "ai_not_configured",
            },
            status_code=503,
        )
    try:
        value = await thread(review_input, saved)
        key = (user, settings.gemini_review_model, VERSION, await thread(fingerprint, saved))

        async def create():
            await thread(
                reserve_ai_usage,
                request.app.state.store.database,
                user,
                settings.ai_user_daily_limit,
                settings.ai_project_daily_limit,
            )
            provider = GeminiClient(
                request.app.state.http_client, settings.gemini_api_key, settings.gemini_review_model
            )
            return await assess(provider, saved, value)

        result, cached = await request.app.state.review_cache.get_or_create(key, create)
        return {
            **result,
            "cached": cached,
            "campaign_id": saved["id"],
            "revision": saved["revision"],
        }
    except AssistError as exc:
        return JSONResponse({"detail": str(exc), "code": exc.code}, status_code=exc.status)
