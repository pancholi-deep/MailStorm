import base64
import math
import time
from email.utils import parsedate_to_datetime
from email.message import EmailMessage
from email.utils import formataddr
import httpx
import anyio
from starlette.concurrency import run_in_threadpool
from backend.core.config import settings


class SendError(Exception):
    def __init__(self, message, *, stop=False, uncertain=False, auth=False, retryable=False, retry_after=0, code="provider_rejected", project_limit=False):
        super().__init__(message)
        self.stop = stop
        self.uncertain = uncertain
        self.auth = auth
        self.retryable = retryable
        self.retry_after = retry_after
        self.code = code
        self.project_limit = project_limit


def create_message(sender_name, sender_email, to, subject, body, isHtml=False):
    message = EmailMessage()
    message["To"] = to
    message["From"] = formataddr((sender_name or "", sender_email))
    message["Subject"] = subject
    message.set_content(body, subtype="html" if isHtml else "plain", charset="utf-8")
    return {"raw": base64.urlsafe_b64encode(message.as_bytes()).decode("ascii")}


async def send_via_gmail_api(access_token, to, subject, body, sender_name, sender_email, isHtml, client):
    message = await run_in_threadpool(create_message, sender_name, sender_email, to, subject, body, isHtml)
    try:
        with anyio.fail_after(settings.http_timeout):
            response = await client.post(
                settings.gmail_send_url,
                headers={"Authorization": f"Bearer {access_token}"},
                json=message,
            )
    except (httpx.ConnectError, httpx.ConnectTimeout, httpx.PoolTimeout) as exc:
        raise SendError("Connection unavailable; retry scheduled.", retryable=True, code="connect_failed") from exc
    except (httpx.HTTPError, TimeoutError) as exc:
        raise SendError("Delivery outcome unknown. This recipient will not be resent automatically.", stop=True, uncertain=True) from exc
    if response.status_code == 401:
        raise SendError("Your Google session has expired. Please sign in again.", stop=True, auth=True)
    reasons = set()
    try:
        reasons = {entry.get('reason') for entry in response.json().get('error', {}).get('errors', [])}
    except (ValueError, AttributeError, TypeError):
        pass
    if response.status_code == 429 or (response.status_code == 403 and reasons & {'rateLimitExceeded', 'userRateLimitExceeded'}):
        try:
            delay = max(0, float(response.headers.get('Retry-After', '60')))
        except ValueError:
            try:
                delay = max(0, parsedate_to_datetime(response.headers['Retry-After']).timestamp() - time.time())
            except (ValueError, TypeError, KeyError):
                delay = 60
        if not math.isfinite(delay):
            delay = 60
        raise SendError('Google rate limit reached; retry scheduled.', retryable=True, retry_after=min(delay, 86400), code='rate_limited', project_limit='rateLimitExceeded' in reasons)
    if response.status_code == 403:
        raise SendError("Google denied sending. Check Gmail permissions or sending limits.", stop=True)
    if response.status_code >= 500:
        raise SendError("Google is unavailable; delivery outcome unknown. This recipient will not be resent automatically.", stop=True, uncertain=True)
    if not response.is_success:
        raise SendError("Google rejected this message.")

    return response.json().get("id")
