from fastapi import APIRouter, Request, HTTPException
from starlette.concurrency import run_in_threadpool as thread
from backend.routes.dependencies import owner, payload
from backend.routes.schemas import NewSavedCampaign, UpdatedSavedCampaign, Revision
from backend.utils.validation import validate_template

router = APIRouter(prefix="/v1/saved-campaigns")


def fields(data):
    values = data.model_dump(
        include={"name", "filename", "upload_id", "subject", "body", "is_html", "field_mapping"}
    )
    values["name"] = values["name"].strip()
    if (
        not values["name"]
        or not values["filename"].strip()
        or any(c in values["name"] + values["filename"] for c in "\r\n\x00")
    ):
        raise HTTPException(422, "Campaign and contact-list names must be nonempty single lines")
    try:
        validate_template(values["subject"], values["body"])
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    return values


@router.get("")
async def listing(request: Request):
    user = await owner(request)
    return await thread(request.app.state.store.library.listing, user)


@router.get("/{identifier}")
async def detail(identifier: str, request: Request):
    return await thread(request.app.state.store.library.get, await owner(request), identifier)


@router.post("", status_code=201)
async def create(request: Request):
    user = await owner(request)
    data = await payload(request, NewSavedCampaign)
    return await thread(
        request.app.state.store.library.save,
        request.app.state.objects,
        user,
        data.id.hex,
        fields(data),
    )


@router.put("/{identifier}")
async def overwrite(identifier: str, request: Request):
    user = await owner(request)
    data = await payload(request, UpdatedSavedCampaign)
    return await thread(
        request.app.state.store.library.save,
        request.app.state.objects,
        user,
        identifier,
        fields(data),
        data.revision,
    )


@router.post("/{identifier}/delete")
async def remove(identifier: str, request: Request):
    user = await owner(request)
    data = await payload(request, Revision)
    await thread(request.app.state.store.library.remove, user, identifier, data.revision)
    return {"ok": True}
