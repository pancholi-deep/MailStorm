import json
import smtplib, base64, httpx, requests
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from config import EMAIL_HOST, EMAIL_PORT
from fastapi import HTTPException, status
from google.oauth2 import id_token
from google.auth.transport import requests as grequests

def generate_oauth2_string(email, access_token):
    auth_string = f"user={email}\1auth=Bearer {access_token}\1\1"
    return base64.b64encode(auth_string.encode()).decode()

def send_email(name, recipient_email, subject, body, sender_email, access_token):
    msg = MIMEMultipart()
    msg['From'] = sender_email
    msg['To'] = recipient_email
    msg['Subject'] = subject
    msg.attach(MIMEText(body, 'plain'))

    auth_string = generate_oauth2_string(sender_email, access_token)

    with smtplib.SMTP_SSL(EMAIL_HOST, EMAIL_PORT) as smtp:
        smtp.ehlo()
        smtp.docmd('AUTH', 'XOAUTH2 ' + auth_string)
        smtp.send_message(msg)
        print("after the call")

async def get_user_email_from_token(token: str) -> str:
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing token")

    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(
                "https://www.googleapis.com/oauth2/v1/userinfo",
                params={"alt": "json"},
                headers={"Authorization": f"Bearer {token}"}
            )
            if resp.status_code != 200:
                raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
            return resp.json()["email"]
    except Exception as e:
        print(f"Token verification failed: {e}")
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")

def create_message(sender: str, to: str, subject: str, body: str) -> dict:
    message = f"From: {sender}\r\nTo: {to}\r\nSubject: {subject}\r\n\r\n{body}"
    encoded_message = base64.urlsafe_b64encode(message.encode("utf-8")).decode("utf-8")
    return {"raw": encoded_message}

def send_via_gmail_api(access_token: str, to: str, subject: str, body: str, sender_email: str):
    url = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send"
    headers = {
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/json"
    }
    message = create_message(sender_email, to, subject, body)
    response = requests.post(url, headers=headers, data=json.dumps(message))
    response.raise_for_status()