from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from backend.routes.auth_routes import router as auth_router
from backend.routes.email_routes import router as email_router

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://mass-email-frontend.onrender.com"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/ping")
async def ping():
    return {"message": "pong"}

app.include_router(auth_router)
app.include_router(email_router)
