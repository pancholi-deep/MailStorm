"""Reserve, receive and seal private contact uploads."""

from fastapi import APIRouter, Request, HTTPException
from starlette.concurrency import run_in_threadpool as thread
from backend.core.config import settings
from backend.routes.dependencies import owner, payload
from backend.routes.schemas import Reservation

router = APIRouter(prefix="/v1")


@router.post("/uploads", status_code=201)
async def reserve(request: Request):
    user = await owner(request)
    data = await payload(request, Reservation)
    if data.size > settings.max_csv_bytes:
        raise HTTPException(413, "CSV exceeds the configured upload limit")
    identifier = await thread(
        request.app.state.store.uploads.reserve_upload, user, data.size, data.sha256
    )
    target = await thread(request.app.state.objects.target, identifier, data.size)
    return {"id": identifier, **target}


@router.put("/uploads/{identifier}/content")
async def content(identifier: str, request: Request):
    user = await owner(request)
    store, objects = request.app.state.store, request.app.state.objects
    upload = await thread(store.uploads.upload, user, identifier)
    if objects.receive_content is None:
        raise HTTPException(409, "Use the signed object-storage upload")
    await thread(store.uploads.transition_upload, user, identifier, "reserved", "receiving")
    try:
        await objects.receive_content(upload, request.stream())
        await thread(store.uploads.transition_upload, user, identifier, "receiving", "received")
    except BaseException:
        # A failed reservation is not reusable; reserve a new upload.
        await thread(objects.delete, identifier)
        raise
    return {"id": identifier}


@router.post("/uploads/{identifier}/complete")
async def complete_upload(identifier: str, request: Request):
    user = await owner(request)
    store, objects = request.app.state.store, request.app.state.objects
    upload = await thread(store.uploads.upload, user, identifier)
    if upload["state"] == "uploaded":
        return {"id": identifier}
    await thread(
        store.uploads.transition_upload, user, identifier, objects.completion_state, "finalizing"
    )
    try:
        await thread(objects.finalize, identifier, upload["size"])
    except Exception as exc:
        raise HTTPException(409, "Upload could not be finalized; reserve a new upload.") from exc
    await thread(store.uploads.transition_upload, user, identifier, "finalizing", "uploaded")
    return {"id": identifier}
