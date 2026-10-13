"""Composition root for embedded and standalone workers."""

import asyncio
import signal
import httpx
from backend.core.config import settings
from backend.services.gmail_authorization import GmailAuthorizationService
from backend.jobs.store import Store
from backend.jobs.worker import Worker
from backend.providers.gmail import GmailProvider
from backend.storage.objects import create_objects


def create_worker(store, objects, client):
    return Worker(
        store.queue,
        store.uploads,
        store.retention,
        objects,
        GmailProvider(client),
        GmailAuthorizationService(store.authorizations, client).cleanup_expired,
    )


async def main():
    settings.validate_startup()
    store = Store()
    store.database.verify()
    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for value in (signal.SIGTERM, signal.SIGINT):
        loop.add_signal_handler(value, stop.set)
    async with httpx.AsyncClient(timeout=settings.http_timeout) as client:
        await create_worker(store, create_objects(), client).run(stop)
