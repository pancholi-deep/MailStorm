"""Durable worker: network calls never run inside database transactions."""
import asyncio
import logging
import random
import signal
import time
import uuid
from contextlib import suppress
import httpx
from starlette.concurrency import run_in_threadpool as thread
from backend.core.config import settings
from backend.jobs.store import Store, LostLease
from backend.jobs.importer import import_campaign
from backend.storage.objects import Objects
from backend.utils.validation import personalize
from backend.utils.email_utils import send_via_gmail_api, SendError

logger = logging.getLogger(__name__)


class Worker:
    def __init__(self, store, objects, client):
        self.store, self.objects, self.client = store, objects, client
        self.identifier = uuid.uuid4().hex

    async def heartbeat(self, job):
        while True:
            await asyncio.sleep(settings.lease_seconds / 3)
            await thread(self.store.heartbeat, job)

    async def run_once(self):
        job = await thread(self.store.claim, self.identifier)
        if not job:
            return False
        heartbeat = asyncio.create_task(self.heartbeat(job))
        try:
            if not job['imported']:
                try:
                    await thread(import_campaign, self.store, self.objects, job)
                except ValueError as exc:
                    await thread(self.store.release, job, 'invalid', str(exc))
                return True
            connection, version = await thread(self.store.connection, job)
            if connection['expires_at'] < time.time() + 60:
                if not connection.get('refresh_token'):
                    await thread(self.store.release, job, 'awaiting_auth', 'Sign in again to continue.')
                    return True
                response = await self.client.post(settings.google_token_url, data={
                    'client_id': settings.google_client_id, 'client_secret': settings.google_client_secret,
                    'grant_type': 'refresh_token', 'refresh_token': connection['refresh_token']})
                if response.status_code in (400, 401, 403):
                    await thread(self.store.release, job, 'awaiting_auth', 'Google authorization needs renewal.')
                    return True
                response.raise_for_status()
                refreshed = response.json()
                connection.update(token=refreshed['access_token'], expires_at=time.time() + refreshed.get('expires_in', 3600))
                await thread(self.store.save_connection, job, connection, version)
            recipient, state, delay = await thread(self.store.next_recipient, job)
            if recipient is None:
                await thread(self.store.release, job, state, None, delay)
                return True
            template = job['template']
            try:
                provider_id = await send_via_gmail_api(connection['token'], recipient['data']['email'],
                    personalize(template['subject'], recipient['data']),
                    personalize(template['body'], recipient['data'], template['is_html']),
                    connection['name'], connection['email'], template['is_html'], self.client)
            except SendError as exc:
                retry = exc.retryable and recipient['attempts'] + 1 < settings.max_attempts
                outcome = 'unknown' if exc.uncertain else ('retry_wait' if retry or exc.auth else 'permanently_failed')
                await thread(self.store.outcome, job, recipient, outcome, None, exc.code)
                state = 'awaiting_auth' if exc.auth else ('retry_wait' if retry else ('blocked' if exc.stop or exc.retryable else 'queued'))
                delay = max(exc.retry_after, min(300, 2 ** (recipient['attempts'] + 1)) + random.random()) if retry else 0
                if exc.retryable:
                    await thread(self.store.defer_sender, job, max(delay, exc.retry_after), exc.project_limit)
                await thread(self.store.release, job, state, str(exc), delay)
            else:
                await thread(self.store.outcome, job, recipient, 'accepted', provider_id)
                await thread(self.store.release, job, 'queued')
        except LostLease:
            logger.warning('worker_lease_lost campaign=%s', job['id'])
        except Exception:
            # Do not release a potentially submitting row: expiry recovery marks it unknown.
            logger.error('worker_operation_failed campaign=%s', job['id'])
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
                    for identifier in await thread(self.store.cleanup):
                        await thread(self.objects.delete, identifier)
                        await thread(self.store.delete_upload_record, identifier)
                    maintenance = time.monotonic() + 60
            except Exception:
                logger.error('worker_iteration_failed')
                worked = False
            if not worked:
                with suppress(asyncio.TimeoutError):
                    await asyncio.wait_for(stop.wait(), 0.5)


async def main():
    settings.validate_startup()
    store = Store()
    store.database.verify()
    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for value in (signal.SIGTERM, signal.SIGINT):
        loop.add_signal_handler(value, stop.set)
    async with httpx.AsyncClient(timeout=settings.http_timeout) as client:
        await Worker(store, Objects(), client).run(stop)


if __name__ == '__main__':
    asyncio.run(main())
