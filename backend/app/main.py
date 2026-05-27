from contextlib import asynccontextmanager
from fastapi import FastAPI, Request, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy.ext.asyncio import create_async_engine
from starlette.middleware.sessions import SessionMiddleware
from .config import get_settings
from .database import Base
from .routers import auth, assignments, projects, me, items, dashboard
from .routers import settings as settings_router
from .routers.auth import require_app_auth

cfg = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    engine = create_async_engine(cfg.database_url)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    await engine.dispose()
    yield


app = FastAPI(title="BetterCamp API", lifespan=lifespan)

app.add_middleware(
    SessionMiddleware,
    secret_key=cfg.secret_key,
    https_only=False,
    same_site="lax",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[cfg.frontend_url, "http://localhost:80", "http://localhost"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(assignments.router, dependencies=[Depends(require_app_auth)])
app.include_router(projects.router, dependencies=[Depends(require_app_auth)])
app.include_router(me.router, dependencies=[Depends(require_app_auth)])
app.include_router(items.router, dependencies=[Depends(require_app_auth)])
app.include_router(dashboard.router, dependencies=[Depends(require_app_auth)])
app.include_router(settings_router.router, dependencies=[Depends(require_app_auth)])


@app.exception_handler(ValueError)
async def value_error_handler(_: Request, exc: ValueError):
    return JSONResponse(status_code=400, content={"detail": str(exc)})


@app.get("/health")
async def health():
    return {"ok": True}
