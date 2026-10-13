"""Coordinate local token removal and Google's remote revocation outside transactions."""

from starlette.concurrency import run_in_threadpool as thread
from backend.providers.gmail import revoke_authorization


class GmailAuthorizationService:
    def __init__(self, repository, client):
        self.repository, self.client = repository, client

    async def disconnect(self, owner, *, only_if_expired=False):
        grant = await thread(self.repository.disconnect, owner, only_if_expired=only_if_expired)
        if grant:
            confirmed = await revoke_authorization(self.client, grant["token"])
            await thread(self.repository.finish_disconnect, owner, grant["version"], confirmed)
        if only_if_expired:
            return None
        status = await thread(self.repository.status, owner)
        return {**status, "revocation_confirmed": not status["revocation_pending"]}

    async def cleanup_expired(self):
        for owner in await thread(self.repository.expired_owners):
            await self.disconnect(owner, only_if_expired=True)
