# config.py
from dotenv import load_dotenv
import os

load_dotenv()

# app
REDIRECT_URL = os.getenv("REDIRECT_URL")
REDIRECT_URI = os.getenv("REDIRECT_URI")

# google/gmail
GOOGLE_AUTH_URL = os.getenv("GOOGLE_AUTH_URL")
GOOGLE_TOKEN_URL = os.getenv("GOOGLE_TOKEN_URL")
GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID")
GOOGLE_CLIENT_SECRET = os.getenv("GOOGLE_CLIENT_SECRET")
GOOGLE_USER_INFO_URL = os.getenv("GOOGLE_USER_INFO_URL")
GMAIL_SEND_EMAIL = os.getenv("GMAIL_SEND_EMAIL")
