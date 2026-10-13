"""Delivery job endpoints. Ownership checks precede body reads."""

from uuid import UUID
from fastapi import APIRouter, Request, HTTPException, Query
from fastapi.responses import StreamingResponse
from starlette.concurrency import run_in_threadpool as thread
from backend.routes.dependencies import owner, payload
from backend.routes.schemas import Campaign
from backend.utils.validation import validate_template
from backend.utils.logs import stream_logs

router = APIRouter(prefix="/v1")


@router.post("/campaigns", status_code=202)
async def create(request: Request):
    user = await owner(request)
    data = await payload(request, Campaign)
    try:
        key = str(UUID(request.headers.get("idempotency-key", "")))
        validate_template(data.subject, data.body)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    identifier = await thread(
        request.app.state.store.campaigns.create,
        user,
        key,
        data.upload_id,
        data.subject,
        data.body,
        data.is_html,
        data.field_mapping,
    )
    return await thread(request.app.state.store.campaigns.status, user, identifier)


@router.get("/campaigns")
async def listing(request: Request):
    return await thread(request.app.state.store.campaigns.list_campaigns, await owner(request))


@router.get("/campaigns/{identifier}")
async def status(identifier: str, request: Request):
    return await thread(request.app.state.store.campaigns.status, await owner(request), identifier)


@router.get("/campaigns/{identifier}/recipients")
async def results(
    identifier: str,
    request: Request,
    after: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=250),
):
    return await thread(
        request.app.state.store.campaigns.result_page,
        await owner(request),
        identifier,
        after,
        limit,
    )


@router.post("/campaigns/{identifier}/cancel")
async def cancel(identifier: str, request: Request):
    user = await owner(request)
    await thread(request.app.state.store.campaigns.cancel, user, identifier)
    return await thread(request.app.state.store.campaigns.status, user, identifier)


@router.post("/campaigns/{identifier}/retry")
async def retry(identifier: str, request: Request):
    user = await owner(request)
    await thread(request.app.state.store.campaigns.retry, user, identifier)
    return await thread(request.app.state.store.campaigns.status, user, identifier)


@router.get("/campaigns/{identifier}/logs")
async def logs(identifier: str, request: Request):
    user = await owner(request)
    store = request.app.state.store
    await thread(store.campaigns.status, user, identifier)
    return StreamingResponse(
        stream_logs(store.campaigns.result_page, user, identifier),
        media_type="text/csv",
        headers={
            "Content-Disposition": 'attachment; filename="mailstorm-logs.csv"',
            "Cache-Control": "no-store",
        },
    )
