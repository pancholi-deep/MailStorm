"""Shared HTTP authentication and payload parsing, independent of any router."""

from fastapi import HTTPException
from starlette.concurrency import run_in_threadpool as thread


def bearer_token(request):
    return request.headers.get("authorization", "").removeprefix("Bearer ")


async def owner(request):
    token = bearer_token(request)
    return await thread(request.app.state.store.sessions.authenticate, token)


async def payload(request, model):
    try:
        return model.model_validate(await request.json())
    except ValueError as exc:
        raise HTTPException(422, "Invalid request fields") from exc
