"""Environment-backed settings; secrets are checked when the app starts."""

import os
from pathlib import Path
from urllib.parse import urlsplit
from dotenv import load_dotenv
from pydantic import BaseModel, Field

load_dotenv(Path(__file__).resolve().parents[1] / ".env")


def origin(value: str) -> str:
    parsed = urlsplit(value)
    if parsed.scheme not in ("http", "https") or not parsed.netloc or parsed.username:
        raise ValueError("Frontend URLs must be HTTP(S) origins")
    if parsed.path not in ("", "/") or parsed.query or parsed.fragment:
        raise ValueError("Frontend URLs must not contain paths, queries, or fragments")
    return f"{parsed.scheme}://{parsed.netloc}"


class Settings(BaseModel):
    frontend_url: str = (
        os.getenv("FRONTEND_URL") or os.getenv("REDIRECT_URL") or "http://localhost:3000"
    )
    google_client_id: str = os.getenv("GOOGLE_CLIENT_ID", "")
    google_client_secret: str = os.getenv("GOOGLE_CLIENT_SECRET", "")
    google_auth_url: str = os.getenv("GOOGLE_AUTH_URL", "https://accounts.google.com/o/oauth2/auth")
    google_token_url: str = os.getenv("GOOGLE_TOKEN_URL", "https://oauth2.googleapis.com/token")
    google_user_info_url: str = os.getenv(
        "GOOGLE_USER_INFO_URL", "https://www.googleapis.com/oauth2/v3/userinfo"
    )
    gmail_send_url: str = os.getenv(
        "GMAIL_SEND_EMAIL", "https://gmail.googleapis.com/gmail/v1/users/me/messages/send"
    )
    http_timeout: float = Field(default=float(os.getenv("HTTP_TIMEOUT", "30")), gt=0, le=120)
    max_csv_bytes: int = Field(default=int(os.getenv("MAX_CSV_BYTES", "2097152")), gt=0)
    max_recipients: int = Field(default=int(os.getenv("MAX_RECIPIENTS", "500")), gt=0)
    max_body_chars: int = Field(default=int(os.getenv("MAX_BODY_CHARS", "1000000")), gt=0)
    batch_db: str = os.getenv(
        "BATCH_DB_PATH", str(Path(__file__).resolve().parents[1] / ".data" / "batches.sqlite3")
    )
    max_active_batches: int = Field(default=8, gt=0)
    environment: str = os.getenv("APP_ENV", "development")
    database_url: str = os.getenv("DATABASE_URL", "")
    encryption_key: str = os.getenv("CREDENTIAL_ENCRYPTION_KEY", "")
    storage_dir: str = os.getenv("STORAGE_DIR", str(Path(__file__).resolve().parents[1] / ".data"))
    s3_bucket: str = os.getenv("S3_BUCKET", "")
    s3_endpoint: str = os.getenv("S3_ENDPOINT_URL", "")
    s3_region: str = os.getenv("AWS_REGION", "us-east-1")
    embedded_worker: bool = os.getenv("EMBEDDED_WORKER", "true").lower() == "true"
    lease_seconds: int = Field(default=120, ge=30)
    sender_interval: float = Field(default=float(os.getenv("SENDER_INTERVAL_SECONDS", "1.1")), gt=0)
    project_interval: float = Field(
        default=float(os.getenv("PROJECT_INTERVAL_SECONDS", "0.01")), gt=0
    )
    max_attempts: int = Field(default=5, ge=1, le=20)
    max_queued_per_owner: int = Field(default=10, ge=1)
    max_queued_total: int = Field(default=1000, ge=1)
    session_seconds: int = Field(default=604800, ge=60)
    retention_seconds: int = Field(default=int(os.getenv("RETENTION_SECONDS", "2592000")), ge=86400)
    max_uploads: int = Field(default=8, ge=1)
    upload_timeout: float = Field(default=120, gt=0)
    max_body_bytes: int = Field(default=4000000, gt=0)

    @property
    def allowed_origins(self):
        values = [self.frontend_url, *os.getenv("CORS_ORIGINS", "").split(",")]
        return list(dict.fromkeys(origin(value.strip()) for value in values if value.strip()))

    def validate_startup(self):
        if not self.google_client_id or not self.google_client_secret:
            raise ValueError(
                "Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in backend/.env or the environment"
            )
        # Legacy callback REDIRECT_URI values must not break popup sign-in.
        # The code exchange uses the verified request origin instead.
        self.allowed_origins
        if self.environment == "production":
            if not self.database_url.startswith(("postgresql://", "postgresql+psycopg://")):
                raise ValueError("Production requires a PostgreSQL DATABASE_URL")
            if not self.encryption_key or not self.s3_bucket:
                raise ValueError("Production requires CREDENTIAL_ENCRYPTION_KEY and S3_BUCKET")
            if self.embedded_worker:
                raise ValueError("Production requires EMBEDDED_WORKER=false and a separate worker")
            if any(not value.startswith("https://") for value in self.allowed_origins):
                raise ValueError("Production frontend origins must use HTTPS")


settings = Settings()
