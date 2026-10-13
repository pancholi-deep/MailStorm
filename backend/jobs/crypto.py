import json
import os
from pathlib import Path
from cryptography.fernet import Fernet
from backend.core.config import settings


class Vault:
    def __init__(self):
        key = settings.encryption_key
        if not key:
            if settings.environment == 'production':
                raise RuntimeError('CREDENTIAL_ENCRYPTION_KEY is required')
            directory = Path(settings.storage_dir)
            directory.mkdir(parents=True, exist_ok=True, mode=0o700)
            path = directory / 'encryption.key'
            try:
                fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            except FileExistsError:
                pass
            else:
                with os.fdopen(fd, 'wb') as file:
                    file.write(Fernet.generate_key())
            key = path.read_bytes()
        self.cipher = Fernet(key)

    def seal(self, value):
        return self.cipher.encrypt(json.dumps(value, ensure_ascii=False).encode()).decode()

    def open(self, value):
        return json.loads(self.cipher.decrypt(value.encode()))
