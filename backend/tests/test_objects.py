from unittest.mock import Mock
import pytest
from backend.storage.s3 import S3Objects


def test_s3_finalization_captures_etag_snapshot(configured, monkeypatch):
    objects = S3Objects(Mock(), "test-bucket")
    objects.client.head_object.return_value = {"ContentLength": 12, "ETag": "etag"}
    objects.finalize("upload-id", 12)
    args = objects.client.copy_object.call_args.kwargs
    assert args["CopySourceIfMatch"] == "etag"
    assert args["Key"] == "sealed/upload-id"
    assert args["ServerSideEncryption"] == "AES256"
    with pytest.raises(ValueError):
        objects.finalize("upload-id", 13)


def test_s3_delete_errors_are_retried(configured):
    objects = S3Objects(Mock(), "test-bucket")
    objects.client.delete_objects.return_value = {
        "Errors": [{"Key": "sealed/id", "Code": "AccessDenied"}]
    }
    with pytest.raises(RuntimeError):
        objects.delete("id")


def test_s3_targets_keep_exact_size_and_encryption_constraints():
    objects = S3Objects(Mock(), "test-bucket")
    objects.client.generate_presigned_post.return_value = {
        "url": "https://example.org",
        "fields": {"key": "incoming/id"},
    }
    assert objects.target("id", 12) == {
        "method": "POST",
        "url": "https://example.org",
        "fields": {"key": "incoming/id"},
    }
    kwargs = objects.client.generate_presigned_post.call_args.kwargs
    assert kwargs["Conditions"] == [
        ["content-length-range", 12, 12],
        {"x-amz-server-side-encryption": "AES256"},
    ]
    assert kwargs["Key"] == "incoming/id"
    assert kwargs["ExpiresIn"] == 900
    assert objects.receive_content is None


def test_compatibility_endpoint_writes_to_sealed_s3_storage(api):
    import uuid
    from backend.main import app

    client, calls, _ = api
    objects = S3Objects(Mock(), "test-bucket")
    app.state.objects = objects
    response = client.post(
        "/send-emails",
        headers={"Idempotency-Key": str(uuid.uuid4())},
        files={"csv_file": ("contacts.csv", b"name,email\nAlice,a@example.org")},
        data={"email_subject": "Hi", "email_body": "Message", "isHtml": "false"},
    )
    assert response.status_code == 202
    args, kwargs = objects.client.upload_fileobj.call_args
    assert args[1] == "test-bucket"
    assert args[2].startswith("sealed/")
    assert kwargs["ExtraArgs"] == {"ServerSideEncryption": "AES256"}
    assert not calls
