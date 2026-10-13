"""Bounded, short-lived in-memory results, isolated by owner and model; no disk writes."""

import asyncio
from collections import OrderedDict

from backend.ports import AssistError


class ReviewCache:
    def __init__(self, capacity=128, ttl=900):
        self.capacity, self.ttl = capacity, ttl
        self.results = OrderedDict()
        self.pending = {}

    async def get_or_create(self, key, create):
        if key in self.results:
            result, _ = self.results[key]
            self.results.move_to_end(key)
            return result, True
        if key in self.pending:
            return await asyncio.shield(self.pending[key]), True
        if len(self.pending) >= 8:
            raise AssistError(
                "AI review is busy. Local checks are available; try again shortly.", 429
            )

        async def run():
            try:
                result = await create()
                while len(self.results) >= self.capacity:
                    _, (_, timer) = self.results.popitem(last=False)
                    timer.cancel()
                timer = asyncio.get_running_loop().call_later(self.ttl, self.expire, key)
                self.results[key] = (result, timer)
                return result
            finally:
                self.pending.pop(key, None)

        task = asyncio.create_task(run())
        self.pending[key] = task
        # Observe failures even when every waiting HTTP request has disconnected.
        task.add_done_callback(lambda done: None if done.cancelled() else done.exception())
        return await asyncio.shield(task), False

    def expire(self, key):
        item = self.results.pop(key, None)
        if item:
            item[1].cancel()

    async def close(self):
        for key in list(self.results):
            self.expire(key)
        tasks = list(self.pending.values())
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
