"""Dashboard router — ``GET /api/dashboard``.

Returns todo data aggregated across one or more projects for the dashboard
charts and lists.  Project selection follows this priority:

1. Explicit ``project_ids`` query parameter (comma-separated).
2. Pinned project IDs from ``UserPreferences``.
3. All active projects (fallback when nothing is pinned).

Each project's data is fetched concurrently using ``asyncio.gather``.
"""

import asyncio
import json
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from ..services import basecamp
from ..models import UserPreferences
from ..database import get_db
from ..routers.auth import get_token

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])


async def _fetch_project_data(access_token: str, project: dict, account_id: str | None) -> dict:
    project_id = project["id"]
    project_name = project["name"]

    todoset_tool = next(
        (d for d in project.get("dock", []) if d["name"] == "todoset" and d["enabled"]),
        None,
    )
    if not todoset_tool:
        return {"project_id": project_id, "project_name": project_name, "lists": []}

    try:
        todoset_id = todoset_tool["id"]
        todolists_raw = await basecamp.get_todolists(access_token, project_id, todoset_id, account_id=account_id)
    except Exception:
        return {"project_id": project_id, "project_name": project_name, "lists": []}

    todo_results = await asyncio.gather(
        *[basecamp.get_todos(access_token, project_id, tl["id"], account_id=account_id) for tl in todolists_raw],
        return_exceptions=True,
    )

    lists = []
    for tl, todos_or_err in zip(todolists_raw, todo_results):
        todos = [] if isinstance(todos_or_err, Exception) else todos_or_err
        lists.append({
            "id": tl["id"],
            "title": tl.get("title") or tl.get("name", "Untitled"),
            "todos": [
                {
                    "id": t["id"],
                    "title": t.get("title") or t.get("content", ""),
                    "completed": t.get("completed", False),
                    "due_on": t.get("due_on"),
                    "created_at": t.get("created_at"),
                    "app_url": t.get("app_url"),
                    "assignees": [
                        {"id": a["id"], "name": a["name"], "avatar_url": a.get("avatar_url")}
                        for a in t.get("assignees", [])
                    ],
                }
                for t in todos
            ],
        })

    return {"project_id": project_id, "project_name": project_name, "lists": lists}


@router.get("")
async def get_dashboard(
    project_ids: str = "",
    access_token: str = Depends(get_token),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(UserPreferences).limit(1))
    prefs = result.scalar_one_or_none()

    all_raw = await basecamp.get_projects(access_token, account_id=None)
    active = [p for p in all_raw if p.get("status") == "active"]

    # Determine which project IDs to show
    if project_ids.strip():
        ids = {int(x.strip()) for x in project_ids.split(",") if x.strip().isdigit()}
    elif prefs and prefs.pinned_project_ids:
        try:
            ids = set(json.loads(prefs.pinned_project_ids))
        except Exception:
            ids = set()
    else:
        ids = set()

    selected = [p for p in active if p["id"] in ids] if ids else active

    results = await asyncio.gather(
        *[_fetch_project_data(access_token, p, None) for p in selected],
        return_exceptions=True,
    )
    return [r for r in results if isinstance(r, dict)]
