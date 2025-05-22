# config.py
from dotenv import load_dotenv
import os

load_dotenv()

PORT = int(os.getenv("PORT"))
EMAIL_HOST = os.getenv("EMAIL_HOST")
EMAIL_PORT = int(os.getenv("EMAIL_PORT"))
EMAIL_USER = os.getenv("EMAIL_USER")
EMAIL_PASS = os.getenv("EMAIL_PASS")
REDIRECT_URL = os.getenv("REDIRECT_URL")
