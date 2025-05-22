# auth.py
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from google.oauth2 import id_token
from google.auth.transport import requests as grequests

class TokenPayload(BaseModel):
    token: str

router = APIRouter()

@router.post("/auth/google")
def verify_google_token(payload: TokenPayload):
    try:
        # Validate the token and decode user info
        id_info = id_token.verify_oauth2_token(payload.token, grequests.Request())
        email = id_info.get("email")
        name = id_info.get("name")
        picture = id_info.get("picture")

        # Optionally: Save user to DB or allow list
        return {
            "email": email,
            "name": name,
            "picture": picture,
            "token": payload.token  # Echoing token back for simplicity
        }
    except Exception as e:
        raise HTTPException(status_code=401, detail="Invalid Google token")
