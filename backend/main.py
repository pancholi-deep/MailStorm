from contextlib import asynccontextmanager
import httpx
import asyncio
from starlette.concurrency import run_in_threadpool
from backend.jobs.store import Store
from backend.jobs.runtime import create_worker
from backend.storage.objects import create_objects
from backend.routes.campaign_routes import router as campaign_router
from backend.routes.upload_routes import router as upload_router
from backend.routes.library_routes import router as library_router
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from backend.core.config import settings
from backend.core.request_limits import RequestBodyLimit
from backend.routes.auth_routes import router as auth_router
from backend.routes.email_routes import router as email_router
from backend.routes.ai_routes import router as ai_router
from backend.services.review_cache import ReviewCache


@asynccontextmanager
async def lifespan(app):
    settings.validate_startup()
    async with httpx.AsyncClient(timeout=settings.http_timeout) as client:
        app.state.http_client = client
        app.state.review_cache = ReviewCache()
        app.state.store = await run_in_threadpool(Store)
        if settings.environment != "production":
            await run_in_threadpool(app.state.store.database.migrate)
        await run_in_threadpool(app.state.store.database.verify)
        app.state.objects = await run_in_threadpool(create_objects)
        stop = asyncio.Event()
        worker = (
            asyncio.create_task(create_worker(app.state.store, app.state.objects, client).run(stop))
            if settings.embedded_worker
            else None
        )
        try:
            yield
        finally:
            stop.set()
            await app.state.review_cache.close()
            if worker:
                await worker
            app.state.store.database.engine.dispose()


app = FastAPI(lifespan=lifespan)
app.add_middleware(RequestBodyLimit)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT"],
    allow_headers=["Authorization", "Content-Type", "X-Requested-With", "Idempotency-Key"],
)


@app.get("/ping")
async def ping():
    return {"message": "pong"}


app.include_router(auth_router)
app.include_router(email_router)

app.include_router(upload_router)
app.include_router(campaign_router)
app.include_router(library_router)
app.include_router(ai_router)


@app.get("/readyz")
async def ready():
    await run_in_threadpool(app.state.store.database.verify)
    return {"status": "ready"}


@app.middleware("http")
async def no_cache(request, call_next):
    response = await call_next(request)
    response.headers["Cache-Control"] = "no-store"
    response.headers["X-Content-Type-Options"] = "nosniff"
    return response
