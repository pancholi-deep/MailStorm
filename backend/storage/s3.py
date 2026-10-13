"""S3 uploads are sealed by an ETag-conditional copy before workers can read them."""


class S3Objects:
    completion_state = "reserved"
    receive_content = None  # The browser uploads directly to the signed S3 target.

    def __init__(self, client, bucket):
        self.client = client
        self.bucket = bucket

    def target(self, identifier, size):
        signed = self.client.generate_presigned_post(
            Bucket=self.bucket,
            Key=f"incoming/{identifier}",
            Fields={"x-amz-server-side-encryption": "AES256"},
            Conditions=[
                ["content-length-range", size, size],
                {"x-amz-server-side-encryption": "AES256"},
            ],
            ExpiresIn=900,
        )
        return {"method": "POST", **signed}

    def save_stream(self, identifier, source):
        self.client.upload_fileobj(
            source,
            self.bucket,
            f"sealed/{identifier}",
            ExtraArgs={"ServerSideEncryption": "AES256"},
        )

    def finalize(self, identifier, size):
        head = self.client.head_object(Bucket=self.bucket, Key=f"incoming/{identifier}")
        if head["ContentLength"] != size:
            raise ValueError("Uploaded size does not match the reservation")
        self.client.copy_object(
            Bucket=self.bucket,
            Key=f"sealed/{identifier}",
            CopySource={"Bucket": self.bucket, "Key": f"incoming/{identifier}"},
            CopySourceIfMatch=head["ETag"],
            ServerSideEncryption="AES256",
        )

    def open(self, identifier):
        return self.client.get_object(Bucket=self.bucket, Key=f"sealed/{identifier}")["Body"]

    def delete(self, identifier):
        result = self.client.delete_objects(
            Bucket=self.bucket,
            Delete={
                "Objects": [{"Key": f"incoming/{identifier}"}, {"Key": f"sealed/{identifier}"}]
            },
        )
        if result.get("Errors"):
            raise RuntimeError("Object deletion failed; cleanup will retry")
