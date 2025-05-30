from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from google_auth_oauthlib.flow import Flow
from core.config import GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, REDIRECT_URI, GOOGLE_AUTH_URL, GOOGLE_TOKEN_URL, GOOGLE_USER_INFO_URL
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
                    "auth_uri": GOOGLE_AUTH_URL,
                    "token_uri": GOOGLE_TOKEN_URL,
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
        if flow.redirect_uri != REDIRECT_URI:
            flow.redirect_uri = REDIRECT_URI

        # Exchange the code for credentials
        flow.fetch_token(code=payload.code)
        credentials = flow.credentials

        userinfo_response = requests.get(
            GOOGLE_USER_INFO_URL,
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
    
