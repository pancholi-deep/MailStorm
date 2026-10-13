"""Compose the configured upload adapter; consumers depend on its storage contract."""

from pathlib import Path
import boto3
from botocore.config import Config
from backend.core.config import settings
from backend.ports import PrivateObjects
from backend.storage.local import LocalObjects
from backend.storage.s3 import S3Objects


def create_objects() -> PrivateObjects:
    if settings.s3_bucket:
        client = boto3.client(
            "s3",
            region_name=settings.s3_region,
            endpoint_url=settings.s3_endpoint or None,
            config=Config(connect_timeout=5, read_timeout=30, retries={"max_attempts": 3}),
        )
        return S3Objects(client, settings.s3_bucket)
    return LocalObjects(Path(settings.storage_dir) / "uploads")
