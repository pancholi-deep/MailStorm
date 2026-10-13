"""Versioned upload and campaign API. All ownership checks precede body reads."""
import hashlib
import csv
import io
from uuid import UUID
from fastapi import APIRouter, Request, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field, ValidationError
from starlette.concurrency import run_in_threadpool as thread
from backend.core.config import settings
from backend.utils.validation import validate_template

router = APIRouter(prefix='/v1')


async def owner(request):
    token = request.headers.get('authorization', '').removeprefix('Bearer ')
    return await thread(request.app.state.store.authenticate, token)


class Reservation(BaseModel):
    size: int = Field(gt=0)
    sha256: str = Field(pattern=r'^[a-f0-9]{64}$')


class Campaign(BaseModel):
    upload_id: str = Field(pattern=r'^[a-f0-9]{32}$')
    subject: str
    body: str
    is_html: bool = False


async def payload(request, model):
    try:
        return model.model_validate(await request.json())
    except (ValueError, ValidationError) as exc:
        raise HTTPException(422, 'Invalid request fields') from exc


@router.post('/uploads', status_code=201)
async def reserve(request: Request):
    user = await owner(request)
    data = await payload(request, Reservation)
    if data.size > settings.max_csv_bytes:
        raise HTTPException(413, 'CSV exceeds the configured upload limit')
    identifier = await thread(request.app.state.store.reserve_upload, user, data.size, data.sha256)
    target = await thread(request.app.state.objects.target, identifier, data.size)
    return {'id': identifier, **target}


@router.put('/uploads/{identifier}/content')
async def content(identifier: str, request: Request):
    user = await owner(request)
    store, objects = request.app.state.store, request.app.state.objects
    upload = await thread(store.upload, user, identifier)
    if objects.s3:
        raise HTTPException(409, 'Use the signed object-storage upload')
    await thread(store.transition_upload, user, identifier, 'reserved', 'receiving')
    path = objects.root / identifier
    digest, size = hashlib.sha256(), 0
    try:
        file = await thread(path.open, 'xb')
        try:
            async for chunk in request.stream():
                size += len(chunk)
                if size > upload['size']:
                    raise HTTPException(413, 'Upload exceeds reserved size')
                digest.update(chunk)
                await thread(file.write, chunk)
        finally:
            await thread(file.close)
        if size != upload['size'] or digest.hexdigest() != upload['sha256']:
            raise HTTPException(422, 'Upload checksum or size mismatch')
        await thread(store.transition_upload, user, identifier, 'receiving', 'received')
    except BaseException:
        # A failed reservation is not reusable; reserve a new upload.
        await thread(path.unlink, missing_ok=True)
        raise
    return {'id': identifier}


@router.post('/uploads/{identifier}/complete')
async def complete_upload(identifier: str, request: Request):
    user = await owner(request)
    store, objects = request.app.state.store, request.app.state.objects
    upload = await thread(store.upload, user, identifier)
    if upload['state'] == 'uploaded':
        return {'id': identifier}
    await thread(store.transition_upload, user, identifier, 'reserved' if objects.s3 else 'received', 'finalizing')
    try:
        await thread(objects.finalize, identifier, upload['size'])
    except Exception as exc:
        raise HTTPException(409, 'Upload could not be finalized; reserve a new upload.') from exc
    await thread(store.transition_upload, user, identifier, 'finalizing', 'uploaded')
    return {'id': identifier}


@router.post('/campaigns', status_code=202)
async def create(request: Request):
    user = await owner(request)
    data = await payload(request, Campaign)
    try:
        key = str(UUID(request.headers.get('idempotency-key', '')))
        validate_template(data.subject, data.body)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    identifier = await thread(request.app.state.store.create, user, key, data.upload_id, data.subject, data.body, data.is_html)
    return await thread(request.app.state.store.status, user, identifier)


@router.get('/campaigns')
async def listing(request: Request):
    return await thread(request.app.state.store.list_campaigns, await owner(request))


@router.get('/campaigns/{identifier}')
async def status(identifier: str, request: Request):
    return await thread(request.app.state.store.status, await owner(request), identifier)


@router.get('/campaigns/{identifier}/recipients')
async def results(identifier: str, request: Request, after: int = Query(0, ge=0), limit: int = Query(100, ge=1, le=250)):
    return await thread(request.app.state.store.result_page, await owner(request), identifier, after, limit)


@router.post('/campaigns/{identifier}/cancel')
async def cancel(identifier: str, request: Request):
    user = await owner(request)
    await thread(request.app.state.store.cancel, user, identifier)
    return await thread(request.app.state.store.status, user, identifier)


@router.post('/campaigns/{identifier}/retry')
async def retry(identifier: str, request: Request):
    user = await owner(request)
    await thread(request.app.state.store.retry, user, identifier)
    return await thread(request.app.state.store.status, user, identifier)


@router.get('/campaigns/{identifier}/logs')
async def logs(identifier: str, request: Request):
    user = await owner(request)
    store = request.app.state.store
    await thread(store.status, user, identifier)
    def stream():
        yield 'row,email,status,provider_id,error\r\n'
        after = 0
        while True:
            rows = store.result_page(user, identifier, after, 250)
            if not rows:
                break
            buffer = io.StringIO()
            writer = csv.writer(buffer)
            for row in rows:
                # Prevent spreadsheet formula evaluation in downloaded logs.
                values = [row['row_no'], row['email'], row['state'], row['provider_id'] or '', row['error'] or '']
                writer.writerow(["'" + value if isinstance(value, str) and value.startswith(('=', '+', '-', '@')) else value for value in values])
            yield buffer.getvalue()
            after = rows[-1]['row_no']
    return StreamingResponse(stream(), media_type='text/csv', headers={'Content-Disposition': 'attachment; filename="mailstorm-logs.csv"', 'Cache-Control': 'no-store'})


@router.post('/logout')
async def logout(request: Request):
    await owner(request)
    await thread(request.app.state.store.logout, request.headers.get('authorization', '').removeprefix('Bearer '))
    return {'ok': True}
