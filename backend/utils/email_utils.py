import base64
import requests
import json
from email.mime.text import MIMEText
from core.config import GMAIL_SEND_EMAIL

def create_message(sender_name, sender_email, to, subject, body, isHtml=False):
    from_header = f"{sender_name} <{sender_email}>"

    # Use "html" or "plain" MIME subtype based on isHtml
    mime_subtype = "html" if isHtml else "plain"
    message = MIMEText(body, mime_subtype)

    message['to'] = to
    message['from'] = from_header
    message['subject'] = subject

    raw = base64.urlsafe_b64encode(message.as_bytes()).decode()
    return {"raw": raw}

def send_via_gmail_api(access_token: str, to: str, subject: str, body: str, sender_name: str, sender_email: str, isHtml: bool):
    url = GMAIL_SEND_EMAIL
    headers = {
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/json"
    }
    message = create_message(sender_name, sender_email, to, subject, body, isHtml)
    response = requests.post(url, headers=headers, data=json.dumps(message))
    response.raise_for_status()
