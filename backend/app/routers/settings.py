"""User preferences router — ``GET /api/settings`` and ``PUT /api/settings``.

Preferences are stored in a single ``UserPreferences`` row.  Currently the
only persisted preference is the list of project IDs pinned to the sidebar
and dashboard.  The Basecamp account is set via ``BASECAMP_ACCOUNT_ID`` in the
environment; per-user person filtering is done inline on the kanban and
dashboard pages.
"""

import json
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from ..database import get_db
from ..models import UserPreferences
from ..routers.auth import get_token

router = APIRouter(prefix="/api/settings", tags=["settings"])


class PreferencesBody(BaseModel):
    """Request body for ``PUT /api/settings``."""

    pinned_project_ids: list[int] = []


def _to_response(prefs: UserPreferences | None) -> dict:
    """Serialise a ``UserPreferences`` row to the API response shape."""
    pinned: list[int] = []
    if prefs and prefs.pinned_project_ids:
        try:
            pinned = json.loads(prefs.pinned_project_ids)
        except Exception:
            pass
    return {"pinned_project_ids": pinned}


@router.get("")
async def get_settings(
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_token),
):
    """Return the current user preferences, or defaults if none have been saved."""
    result = await db.execute(select(UserPreferences).limit(1))
    prefs = result.scalar_one_or_none()
    return _to_response(prefs)


@router.put("")
async def save_settings(
    body: PreferencesBody,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_token),
):
    """Upsert the user preferences row and return the persisted values."""
    result = await db.execute(select(UserPreferences).limit(1))
    prefs = result.scalar_one_or_none()

    if prefs is None:
        prefs = UserPreferences()
        db.add(prefs)

    prefs.pinned_project_ids = json.dumps(body.pinned_project_ids)

    await db.commit()
    await db.refresh(prefs)
    return _to_response(prefs)
