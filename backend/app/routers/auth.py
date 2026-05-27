"""OAuth 2.0 authentication router for the 37signals Basecamp integration.

Handles the authorisation code flow:
1. ``GET /auth/login``    — redirects the user to the 37signals consent page.
2. ``GET /auth/callback`` — exchanges the code for tokens and stores them.
3. ``GET /auth/status``   — returns whether a token exists in the database.
4. ``DELETE /auth/logout`` — removes the stored token.

App-level authentication (username + password from .env):
- ``POST /auth/app-login``   — validates credentials, sets a session cookie.
- ``GET  /auth/app-status``  — returns whether the session is app-authenticated.
- ``POST /auth/app-logout``  — clears the session.

The ``get_token`` dependency is imported by all protected routers to retrieve
the current access token from the database.
"""

import hmac
import secrets
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, HTTPException, Request, Depends
from fastapi.responses import RedirectResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from ..database import get_db
from ..models import OAuthToken
from ..services import basecamp
from ..config import get_settings

router = APIRouter(prefix="/auth", tags=["auth"])

# In-memory map of state token → expiry used for CSRF validation.
_pending_states: dict[str, datetime] = {}


# ── App-level auth ────────────────────────────────────────────────────────────

async def require_app_auth(request: Request) -> None:
    """Dependency that raises 401 when the app session is not authenticated."""
    if not request.session.get("app_authenticated"):
        raise HTTPException(status_code=401, detail="App login required")


@router.post("/app-login")
async def app_login(body: dict, request: Request):
    """Validate username/password from .env and set a session cookie."""
    cfg = get_settings()
    username = body.get("username", "")
    password = body.get("password", "")
    valid = (
        hmac.compare_digest(username.encode(), cfg.app_username.encode())
        and hmac.compare_digest(password.encode(), cfg.app_password.encode())
    )
    if not valid:
        raise HTTPException(status_code=401, detail="Invalid credentials")
    request.session["app_authenticated"] = True
    return {"ok": True}


@router.get("/app-status")
async def app_status(request: Request):
    """Return whether the current session is app-authenticated."""
    return {"authenticated": bool(request.session.get("app_authenticated"))}


@router.post("/app-logout")
async def app_logout(request: Request):
    """Clear the app session."""
    request.session.pop("app_authenticated", None)
    return {"ok": True}


# ── Basecamp OAuth ────────────────────────────────────────────────────────────

@router.get("/login", dependencies=[Depends(require_app_auth)])
async def login():
    """Redirect the browser to the 37signals OAuth authorisation page."""
    state = secrets.token_urlsafe(32)
    _pending_states[state] = datetime.now(timezone.utc) + timedelta(minutes=10)
    url = basecamp.get_auth_url(state)
    return RedirectResponse(url)


@router.get("/callback", dependencies=[Depends(require_app_auth)])
async def callback(code: str, state: str | None = None, db: AsyncSession = Depends(get_db)):
    """Handle the OAuth redirect and persist the token."""
    if state is not None:
        expiry = _pending_states.pop(state, None)
        if not expiry or datetime.now(timezone.utc) > expiry:
            raise HTTPException(status_code=400, detail="Invalid or expired state")

    token_data = await basecamp.exchange_code(code)

    result = await db.execute(select(OAuthToken).limit(1))
    token = result.scalar_one_or_none()

    if token:
        token.access_token = token_data["access_token"]
        token.refresh_token = token_data["refresh_token"]
        token.expires_at = token_data.get("expires_in")
    else:
        token = OAuthToken(
            access_token=token_data["access_token"],
            refresh_token=token_data["refresh_token"],
            expires_at=str(token_data.get("expires_in", "")),
        )
        db.add(token)

    await db.commit()
    cfg = get_settings()
    return RedirectResponse(f"{cfg.frontend_url}/")


@router.get("/status", dependencies=[Depends(require_app_auth)])
async def status(db: AsyncSession = Depends(get_db)):
    """Return ``{"authenticated": true}`` if an OAuth token is stored."""
    result = await db.execute(select(OAuthToken).limit(1))
    token = result.scalar_one_or_none()
    return {"authenticated": bool(token)}


@router.delete("/logout", dependencies=[Depends(require_app_auth)])
async def logout(db: AsyncSession = Depends(get_db)):
    """Delete the stored OAuth token, effectively logging the user out."""
    result = await db.execute(select(OAuthToken).limit(1))
    token = result.scalar_one_or_none()
    if token:
        await db.delete(token)
        await db.commit()
    return {"ok": True}


async def get_token(db: AsyncSession = Depends(get_db)) -> str:
    """FastAPI dependency that returns the current access token.

    Raises:
        HTTPException(401): If no token is found in the database.
    """
    result = await db.execute(select(OAuthToken).limit(1))
    token = result.scalar_one_or_none()
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return token.access_token
