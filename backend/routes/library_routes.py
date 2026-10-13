from uuid import UUID
from fastapi import APIRouter, Request, HTTPException
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool as thread
from backend.routes.campaign_routes import Campaign, owner, payload
from backend.jobs.library import Library
from backend.utils.validation import validate_template

router = APIRouter(prefix='/v1/saved-campaigns')


class SavedCampaign(Campaign):
    name: str = Field(min_length=1, max_length=120)
    filename: str = Field(default='contacts.csv', min_length=1, max_length=255)


class NewSavedCampaign(SavedCampaign):
    id: UUID


class UpdatedSavedCampaign(SavedCampaign):
    revision: int = Field(ge=1)


class Revision(BaseModel):
    revision: int = Field(ge=1)


def fields(data):
    values = data.model_dump(include={'name', 'filename', 'upload_id', 'subject', 'body', 'is_html'})
    values['name'] = values['name'].strip()
    if not values['name'] or not values['filename'].strip() or any(c in values['name'] + values['filename'] for c in '\r\n\x00'):
        raise HTTPException(422, 'Campaign and contact-list names must be nonempty single lines')
    try:
        validate_template(values['subject'], values['body'])
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    return values


@router.get('')
async def listing(request: Request):
    user = await owner(request)
    return await thread(Library(request.app.state.store).listing, user)


@router.get('/{identifier}')
async def detail(identifier: str, request: Request):
    return await thread(Library(request.app.state.store).get, await owner(request), identifier)


@router.post('', status_code=201)
async def create(request: Request):
    user = await owner(request)
    data = await payload(request, NewSavedCampaign)
    return await thread(Library(request.app.state.store).save, request.app.state.objects, user, data.id.hex, fields(data))


@router.put('/{identifier}')
async def overwrite(identifier: str, request: Request):
    user = await owner(request)
    data = await payload(request, UpdatedSavedCampaign)
    return await thread(Library(request.app.state.store).save, request.app.state.objects, user, identifier, fields(data), data.revision)


@router.post('/{identifier}/delete')
async def remove(identifier: str, request: Request):
    user = await owner(request)
    data = await payload(request, Revision)
    await thread(Library(request.app.state.store).remove, user, identifier, data.revision)
    return {'ok': True}
