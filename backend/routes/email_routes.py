"""Compatibility upload endpoint. Sending is always delegated to durable workers."""

import hashlib
import uuid
from fastapi import APIRouter, Request, HTTPException
from starlette.concurrency import run_in_threadpool as thread
from backend.core.config import settings
from backend.routes.dependencies import owner
from backend.utils.validation import validate_template

router = APIRouter()


@router.post("/send-emails", status_code=202)
async def send_emails(request: Request):
    user = await owner(request)
    store, objects = request.app.state.store, request.app.state.objects
    async with request.form(
        max_files=1, max_fields=3, max_part_size=settings.max_body_bytes
    ) as form:
        file = form.get("csv_file")
        if not hasattr(file, "read"):
            raise HTTPException(422, "CSV file is required")
        subject, body = form.get("email_subject", ""), form.get("email_body", "")
        try:
            key = str(uuid.UUID(request.headers.get("idempotency-key", "")))
            validate_template(subject, body)
            if form.get("isHtml", "false") not in ("true", "false"):
                raise ValueError("isHtml must be true or false")
        except (ValueError, TypeError) as exc:
            raise HTTPException(422, str(exc)) from exc
        digest, size = hashlib.sha256(), 0
        while chunk := await file.read(65536):
            size += len(chunk)
            if size > settings.max_csv_bytes:
                raise HTTPException(413, "CSV exceeds upload limit")
            digest.update(chunk)
        if not size:
            raise HTTPException(422, "CSV is empty")
        identifier = await thread(store.uploads.reserve_upload, user, size, digest.hexdigest())
        await file.seek(0)
        await thread(objects.save_stream, identifier, file.file)
        await thread(store.uploads.mark_uploaded, user, identifier)
        campaign = await thread(
            store.campaigns.create,
            user,
            key,
            identifier,
            subject,
            body,
            form.get("isHtml") == "true",
        )
    return await thread(store.campaigns.status, user, campaign)
