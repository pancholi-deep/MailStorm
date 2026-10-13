"""Durable worker: network calls never run inside database transactions."""

import asyncio
import logging
import random
import time
import uuid
from contextlib import suppress
from collections.abc import Awaitable, Callable
from starlette.concurrency import run_in_threadpool as thread
from backend.core.config import settings
from backend.jobs.state import LostLease
from backend.jobs.importer import import_campaign
from backend.utils.validation import personalize
from backend.ports import (
    AuthorizationRequired,
    SendError,
    DeliveryQueue,
    UploadReader,
    Retention,
    RetainedObjects,
    MessageProvider,
)

logger = logging.getLogger(__name__)


class Worker:
    def __init__(
        self,
        queue: DeliveryQueue,
        uploads: UploadReader,
        retention: Retention,
        objects: RetainedObjects,
        provider: MessageProvider,
        authorization_cleanup: Callable[[], Awaitable[None]] | None = None,
    ):
        self.queue, self.uploads, self.retention = queue, uploads, retention
        self.objects, self.provider = objects, provider
        self.authorization_cleanup = authorization_cleanup
        self.identifier = uuid.uuid4().hex

    async def heartbeat(self, job):
        while True:
            await asyncio.sleep(settings.lease_seconds / 3)
            await thread(self.queue.heartbeat, job)

    async def run_once(self):
        job = await thread(self.queue.claim, self.identifier)
        if not job:
            return False
        heartbeat = asyncio.create_task(self.heartbeat(job))
        try:
            if not job["imported"]:
                try:
                    await thread(import_campaign, self.queue, self.uploads, self.objects, job)
                except ValueError as exc:
                    await thread(self.queue.release, job, "invalid", str(exc))
                return True
            try:
                connection, version = await thread(self.queue.connection, job)
                refreshed = await self.provider.refresh(connection)
                if refreshed:
                    await thread(self.queue.save_connection, job, connection, version)
            except AuthorizationRequired as exc:
                await thread(self.queue.release, job, "awaiting_auth", str(exc))
                return True
            recipient, state, delay = await thread(self.queue.next_recipient, job)
            if recipient is None:
                await thread(self.queue.release, job, state, None, delay)
                return True
            template = job["template"]
            try:
                provider_id = await self.provider.send(
                    connection,
                    recipient["data"]["email"],
                    personalize(template["subject"], recipient["data"]),
                    personalize(template["body"], recipient["data"], template["is_html"]),
                    template["is_html"],
                )
            except SendError as exc:
                retry = exc.retryable and recipient["attempts"] + 1 < settings.max_attempts
                outcome = (
                    "unknown"
                    if exc.uncertain
                    else ("retry_wait" if retry or exc.auth else "permanently_failed")
                )
                await thread(self.queue.outcome, job, recipient, outcome, None, exc.code)
                state = (
                    "awaiting_auth"
                    if exc.auth
                    else (
                        "retry_wait"
                        if retry
                        else ("blocked" if exc.stop or exc.retryable else "queued")
                    )
                )
                delay = (
                    max(
                        exc.retry_after,
                        min(300, 2 ** (recipient["attempts"] + 1)) + random.random(),
                    )
                    if retry
                    else 0
                )
                if exc.retryable:
                    await thread(
                        self.queue.defer_sender, job, max(delay, exc.retry_after), exc.project_limit
                    )
                await thread(self.queue.release, job, state, str(exc), delay)
            else:
                await thread(self.queue.outcome, job, recipient, "accepted", provider_id)
                await thread(self.queue.release, job, "queued")
        except LostLease:
            logger.warning("worker_lease_lost campaign=%s", job["id"])
        except Exception:
            # Do not release a potentially submitting row: expiry recovery marks it unknown.
            logger.error("worker_operation_failed campaign=%s", job["id"])
        finally:
            heartbeat.cancel()
            with suppress(asyncio.CancelledError, LostLease):
                await heartbeat
        return True

    async def run(self, stop):
        maintenance = 0
        while not stop.is_set():
            try:
                worked = await self.run_once()
                if time.monotonic() >= maintenance:
                    if self.authorization_cleanup:
                        await self.authorization_cleanup()
                    for identifier in await thread(self.retention.cleanup):
                        await thread(self.objects.delete, identifier)
                        await thread(self.retention.delete_upload_record, identifier)
                    maintenance = time.monotonic() + 60
            except Exception:
                logger.error("worker_iteration_failed")
                worked = False
            if not worked:
                with suppress(asyncio.TimeoutError):
                    await asyncio.wait_for(stop.wait(), 0.5)


if __name__ == "__main__":
    from backend.jobs.runtime import main

    asyncio.run(main())
