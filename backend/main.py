import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from routes.auth_routes import router as auth_router
from routes.email_routes import router as email_router
from core.config import REDIRECT_URL

app = FastAPI()

app.mount("/", StaticFiles(directory="frontend/build", html=True), name="static")
@app.get("/{full_path:path}")
async def catch_all(full_path: str):
    return FileResponse("frontend/build/index.html")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[REDIRECT_URL], 
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router)
app.include_router(email_router)
