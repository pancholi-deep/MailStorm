"""Private immutable upload objects; S3 in production and local files in development."""
from pathlib import Path
import boto3
from botocore.config import Config
from backend.core.config import settings


class Objects:
    def __init__(self):
        self.s3 = boto3.client('s3', region_name=settings.s3_region, endpoint_url=settings.s3_endpoint or None,
            config=Config(connect_timeout=5, read_timeout=30, retries={'max_attempts': 3})) if settings.s3_bucket else None
        self.root = Path(settings.storage_dir) / 'uploads'
        if not self.s3:
            self.root.mkdir(parents=True, exist_ok=True, mode=0o700)

    def target(self, identifier, size):
        if not self.s3:
            return {'method': 'PUT', 'url': f'/v1/uploads/{identifier}/content'}
        signed = self.s3.generate_presigned_post(Bucket=settings.s3_bucket, Key=f'incoming/{identifier}',
            Fields={'x-amz-server-side-encryption': 'AES256'},
            Conditions=[['content-length-range', size, size], {'x-amz-server-side-encryption': 'AES256'}], ExpiresIn=900)
        return {'method': 'POST', **signed}

    def finalize(self, identifier, size):
        if self.s3:
            head = self.s3.head_object(Bucket=settings.s3_bucket, Key=f'incoming/{identifier}')
            if head['ContentLength'] != size:
                raise ValueError('Uploaded size does not match the reservation')
            # Capture an immutable object snapshot; the browser can overwrite only incoming/.
            self.s3.copy_object(Bucket=settings.s3_bucket, Key=f'sealed/{identifier}',
                CopySource={'Bucket': settings.s3_bucket, 'Key': f'incoming/{identifier}'},
                CopySourceIfMatch=head['ETag'], ServerSideEncryption='AES256')
        elif (self.root / identifier).stat().st_size != size:
            raise ValueError('Uploaded size does not match the reservation')

    def open(self, identifier):
        if self.s3:
            return self.s3.get_object(Bucket=settings.s3_bucket, Key=f'sealed/{identifier}')['Body']
        return (self.root / identifier).open('rb')

    def delete(self, identifier):
        if self.s3:
            result = self.s3.delete_objects(Bucket=settings.s3_bucket, Delete={'Objects': [{'Key': f'incoming/{identifier}'}, {'Key': f'sealed/{identifier}'}]})
            if result.get('Errors'):
                raise RuntimeError('Object deletion failed; cleanup will retry')
        else:
            (self.root / identifier).unlink(missing_ok=True)
