"""Projects router — ``/api/projects``.

Provides project listing (optionally filtered to pinned projects), todo list
enumeration, and individual todo fetching for a given project.
"""

import json
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from ..services import basecamp
from ..models import UserPreferences
from ..database import get_db
from ..routers.auth import get_token

router = APIRouter(prefix="/api/projects", tags=["projects"])


@router.get("")
async def list_projects(
    pinned: bool = False,
    access_token: str = Depends(get_token),
    db: AsyncSession = Depends(get_db),
):
    """List active Basecamp projects.

    When ``pinned=true`` is passed, only projects saved in ``UserPreferences``
    are returned.  If no projects are pinned yet, all active projects are
    returned as a fallback so the UI is never empty.
    """
    projects = await basecamp.get_projects(access_token, account_id=None)
    active = [
        {"id": p["id"], "name": p["name"], "description": p.get("description", ""), "status": p.get("status")}
        for p in projects
        if p.get("status") == "active"
    ]

    if pinned:
        result = await db.execute(select(UserPreferences).limit(1))
        prefs = result.scalar_one_or_none()
        if prefs and prefs.pinned_project_ids:
            try:
                ids = set(json.loads(prefs.pinned_project_ids))
                if ids:
                    return [p for p in active if p["id"] in ids]
            except Exception:
                pass

    return active


@router.get("/{project_id}/todolists")
async def list_todolists(
    project_id: int,
    access_token: str = Depends(get_token),
    db: AsyncSession = Depends(get_db),
):
    """Return all todo lists for a project.

    Looks up the project's todoset tool from the dock before fetching lists.
    Returns an empty list if the project has no todo tool enabled.
    """
    projects = await basecamp.get_projects(access_token, account_id=None)
    project = next((p for p in projects if p["id"] == project_id), None)
    if not project:
        return []

    todoset_tool = next(
        (d for d in project.get("dock", []) if d["name"] == "todoset" and d["enabled"]),
        None,
    )
    if not todoset_tool:
        return []

    todoset_id = todoset_tool["id"]
    todolists = await basecamp.get_todolists(access_token, project_id, todoset_id, account_id=None)
    return [
        {
            "id": tl["id"],
            "name": tl["name"],
            "description": tl.get("description", ""),
            "completed_ratio": tl.get("completed_ratio", ""),
            "todos_count": tl.get("todos_count", 0),
        }
        for tl in todolists
    ]


@router.get("/{project_id}/todolists/{todolist_id}/todos")
async def list_todos(
    project_id: int,
    todolist_id: int,
    access_token: str = Depends(get_token),
    db: AsyncSession = Depends(get_db),
):
    """Return all active todos in a specific todo list."""
    todos = await basecamp.get_todos(access_token, project_id, todolist_id, account_id=None)
    return [
        {
            "id": t["id"],
            "title": t["title"],
            "completed": t.get("completed", False),
            "due_on": t.get("due_on"),
            "assignees": [{"id": a["id"], "name": a["name"]} for a in t.get("assignees", [])],
            "project_id": project_id,
        }
        for t in todos
    ]
