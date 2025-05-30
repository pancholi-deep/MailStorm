import requests, base64
from core.config import GOOGLE_USER_INFO_URL

def generate_oauth2_string(email, access_token):
    auth_string = f"user={email}\1auth=Bearer {access_token}\1\1"
    return base64.b64encode(auth_string.encode()).decode()

def get_user_info(access_token: str):
    headers = {"Authorization": f"Bearer {access_token}"}
    response = requests.get(GOOGLE_USER_INFO_URL, headers=headers)
    response.raise_for_status()
    return response.json()  # contains "name", "email", etc.