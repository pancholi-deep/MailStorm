from contextlib import asynccontextmanager
import httpx
import asyncio
from starlette.concurrency import run_in_threadpool
from backend.jobs.store import Store
from backend.jobs.worker import Worker
from backend.storage.objects import Objects
from backend.routes.campaign_routes import router as campaign_router
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from backend.core.config import settings
from backend.core.request_limits import RequestBodyLimit
from backend.routes.auth_routes import router as auth_router
from backend.routes.email_routes import router as email_router


@asynccontextmanager
async def lifespan(app):
    settings.validate_startup()
    async with httpx.AsyncClient(timeout=settings.http_timeout) as client:
        app.state.http_client = client
        app.state.store = await run_in_threadpool(Store)
        if settings.environment != 'production':
            await run_in_threadpool(app.state.store.database.migrate)
        await run_in_threadpool(app.state.store.database.verify)
        app.state.objects = await run_in_threadpool(Objects)
        stop = asyncio.Event()
        worker = asyncio.create_task(Worker(app.state.store, app.state.objects, client).run(stop)) if settings.embedded_worker else None
        try:
            yield
        finally:
            stop.set()
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

app.include_router(campaign_router)

@app.get('/readyz')
async def ready():
    await run_in_threadpool(app.state.store.database.verify)
    return {'status': 'ready'}

@app.middleware('http')
async def no_cache(request, call_next):
    response = await call_next(request)
    response.headers['Cache-Control'] = 'no-store'
    response.headers['X-Content-Type-Options'] = 'nosniff'
    return response
