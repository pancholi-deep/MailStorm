from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from backend.routes.auth_routes import router as auth_router
from backend.routes.email_routes import router as email_router
from backend.core.config import REDIRECT_URL

app = FastAPI()

origins = [
    REDIRECT_URL,  # frontend dev server
    "https://mass-email-frontend.onrender.com",  # add this for production
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/ping")
async def ping():
    return {"message": "pong"}

app.include_router(auth_router)
app.include_router(email_router)
