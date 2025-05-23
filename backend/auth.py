from fastapi import APIRouter, Request, HTTPException
from pydantic import BaseModel
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import Flow
from googleapiclient.discovery import build
from config import GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, REDIRECT_URI
import requests

router = APIRouter()

class CodeExchangeRequest(BaseModel):
    code: str

@router.post("/auth/google")
async def auth_google(payload: CodeExchangeRequest):
    try:
        flow = Flow.from_client_config(
            {
                "web": {
                    "client_id": GOOGLE_CLIENT_ID,
                    "client_secret": GOOGLE_CLIENT_SECRET,
                    "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                    "token_uri": "https://oauth2.googleapis.com/token",
                    "redirect_uris": [REDIRECT_URI],
                }
            },
            scopes=[
                "https://www.googleapis.com/auth/gmail.send",
                "openid",
                "https://www.googleapis.com/auth/userinfo.profile",
                "https://www.googleapis.com/auth/userinfo.email",
            ],
        )
        if flow.redirect_uri != "postmessage":
            flow.redirect_uri = "postmessage"

        # Exchange the code for credentials
        flow.fetch_token(code=payload.code)
        credentials = flow.credentials

        userinfo_response = requests.get(
            "https://www.googleapis.com/oauth2/v3/userinfo",
            headers={"Authorization": f"Bearer {credentials.token}"}
        )
        userinfo = userinfo_response.json()
        name = userinfo.get("given_name") if userinfo.get("given_name") else userinfo.get("name")
        email = userinfo.get("email")

        return {
            "user": {
                "name": name,
                "email": email
            },
            "access_token": credentials.token
        }

    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Authentication failed: {str(e)}")