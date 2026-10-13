"""Immutable local contact files, used by the development upload API."""

import hashlib
import shutil
from pathlib import Path
from fastapi import HTTPException
from starlette.concurrency import run_in_threadpool as thread


class LocalObjects:
    completion_state = "received"

    def __init__(self, root):
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True, mode=0o700)

    def target(self, identifier, size):
        return {"method": "PUT", "url": f"/v1/uploads/{identifier}/content"}

    async def receive_content(self, upload, chunks):
        digest, size = hashlib.sha256(), 0
        file = await thread((self.root / upload["id"]).open, "xb")
        try:
            async for chunk in chunks:
                size += len(chunk)
                if size > upload["size"]:
                    raise HTTPException(413, "Upload exceeds reserved size")
                digest.update(chunk)
                await thread(file.write, chunk)
        finally:
            await thread(file.close)
        if size != upload["size"] or digest.hexdigest() != upload["sha256"]:
            raise HTTPException(422, "Upload checksum or size mismatch")

    def save_stream(self, identifier, source):
        with (self.root / identifier).open("xb") as target:
            shutil.copyfileobj(source, target, 65536)

    def finalize(self, identifier, size):
        if (self.root / identifier).stat().st_size != size:
            raise ValueError("Uploaded size does not match the reservation")

    def open(self, identifier):
        return (self.root / identifier).open("rb")

    def delete(self, identifier):
        (self.root / identifier).unlink(missing_ok=True)
