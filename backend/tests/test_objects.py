from unittest.mock import Mock
import pytest
from backend.storage.objects import Objects
from backend.core.config import settings


def test_s3_finalization_captures_etag_snapshot(configured, monkeypatch):
    objects = Objects()
    objects.s3 = Mock()
    objects.s3.head_object.return_value = {'ContentLength': 12, 'ETag': 'etag'}
    monkeypatch.setattr(settings, 's3_bucket', 'test-bucket')
    objects.finalize('upload-id', 12)
    args = objects.s3.copy_object.call_args.kwargs
    assert args['CopySourceIfMatch'] == 'etag'
    assert args['Key'] == 'sealed/upload-id'
    assert args['ServerSideEncryption'] == 'AES256'
    with pytest.raises(ValueError):
        objects.finalize('upload-id', 13)


def test_s3_delete_errors_are_retried(configured):
    objects = Objects()
    objects.s3 = Mock()
    objects.s3.delete_objects.return_value = {'Errors': [{'Key': 'sealed/id', 'Code': 'AccessDenied'}]}
    with pytest.raises(RuntimeError):
        objects.delete('id')
