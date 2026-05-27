"""Assignments router — ``/api/assignments``.

Manages the kanban view of todos and cards assigned to the selected person.

Key design notes:
- Without a ``?person_id=`` parameter, ``/my/assignments.json`` is used
  (fast, native Basecamp support for the token owner).
- With ``?person_id=X``, ``search_todos_for_person`` iterates projects and
  filters by assignee, because Basecamp 3 has no per-person assignments
  endpoint for non-token-owners.
- Kanban column positions are stored locally in ``TodoKanbanState`` so the user
  can drag cards without affecting Basecamp.  Moving a todo to/from ``done``
  also syncs the completion state back to Basecamp.
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from ..database import get_db
from ..models import TodoKanbanState, UserPreferences
from ..services import basecamp
from ..routers.auth import get_token

router = APIRouter(prefix="/api/assignments", tags=["assignments"])

VALID_COLUMNS = {"todo", "in_progress", "in_review", "done"}

# Keywords used to map a card's Basecamp column name to a kanban column
_DONE_KEYWORDS     = {"done", "completed", "complete", "finished", "closed", "shipped"}
_REVIEW_KEYWORDS   = {"review", "testing", "qa", "staging", "approval", "checked"}
_PROGRESS_KEYWORDS = {"progress", "doing", "active", "working", "dev", "started", "wip"}


def _card_default_column(parent_title: str) -> str:
    """Derive a kanban column from a Basecamp card-table column name.

    Cards live in named columns in Basecamp (e.g. "In Progress", "Done").
    This heuristic maps those names to the app's four fixed columns so that
    cards are placed correctly on first load without requiring a manual drag.
    """
    t = parent_title.lower()
    if any(k in t for k in _DONE_KEYWORDS):
        return "done"
    if any(k in t for k in _REVIEW_KEYWORDS):
        return "in_review"
    if any(k in t for k in _PROGRESS_KEYWORDS):
        return "in_progress"
    return "todo"


def _normalize(raw: dict) -> dict:
    """Normalise a raw Basecamp assignment/todo dict to the frontend shape.

    Handles both ``/my/assignments.json`` (uses ``content`` for the title) and
    ``/todolists/{id}/todos.json`` (uses ``title``).  The ``type`` field is
    lowercased to match the TypeScript union ``'todo' | 'card'``.
    """
    # /my/assignments.json uses "content"; todolists API uses "title"
    return {
        "id": raw["id"],
        "title": raw.get("title") or raw.get("content", ""),
        "completed": raw.get("completed", False),
        "due_on": raw.get("due_on"),
        "item_type": (raw.get("type") or "todo").lower(),
        "assignees": [
            {"id": a["id"], "name": a["name"]}
            for a in raw.get("assignees", [])
        ],
        "project_id": (raw.get("bucket") or {}).get("id"),
        "bucket": raw.get("bucket"),
        "todolist": raw.get("parent"),
        "priority": raw.get("priority", False),
    }


@router.get("")
async def list_assignments(  # noqa: C901
    page: int = 1,
    person_id: int | None = None,
    access_token: str = Depends(get_token),
    db: AsyncSession = Depends(get_db),
):
    import asyncio, json as _json
    result = await db.execute(select(UserPreferences).limit(1))
    prefs = result.scalar_one_or_none()
    pinned_ids: list[int] = []
    if prefs and prefs.pinned_project_ids:
        try:
            pinned_ids = _json.loads(prefs.pinned_project_ids)
        except Exception:
            pass

    if person_id:
        # Search across projects because /my/assignments.json only returns the token owner's work
        active_raw = await basecamp.search_todos_for_person(
            access_token, person_id, account_id=None,
            pinned_project_ids=pinned_ids or None,
        )
        active = [_normalize(t) for t in active_raw]
        completed: list[dict] = []  # completed todos for other people are not fetched
    else:
        active_data = await basecamp.get_assignments(access_token, page=page, account_id=None)
        completed_raw = await basecamp.get_completed_assignments(access_token, account_id=None)
        active_raw_my = active_data.get("priorities", []) + active_data.get("non_priorities", [])
        active = [_normalize(t) for t in active_raw_my]
        completed = [_normalize(t) for t in (completed_raw if isinstance(completed_raw, list) else [])]

    # Load local kanban overrides for active items only
    active_ids = [t["id"] for t in active]
    result = await db.execute(
        select(TodoKanbanState).where(TodoKanbanState.todo_id.in_(active_ids))
    )
    local_states = {s.todo_id: s.column for s in result.scalars().all()}

    for todo in active:
        tid = todo["id"]
        local_col = local_states.get(tid)
        if local_col and local_col != "done":
            # User explicitly moved this to an open column → honour it
            todo["kanban_column"] = local_col
        else:
            # No local override — derive column from the parent list/column name.
            # Works for both card-table cards and regular todos in named lists.
            parent_title = (todo.get("todolist") or {}).get("title", "")
            todo["kanban_column"] = _card_default_column(parent_title)

    # Completed todos always land in Done regardless of local state
    for todo in completed:
        todo["kanban_column"] = "done"

    return active + completed


@router.patch("/{todo_id}/move")
async def move_todo(  # noqa: C901
    todo_id: int,
    body: dict,
    access_token: str = Depends(get_token),
    db: AsyncSession = Depends(get_db),
):
    column = body.get("column")
    if column not in VALID_COLUMNS:
        raise HTTPException(status_code=400, detail=f"column must be one of {VALID_COLUMNS}")

    project_id = body.get("project_id")
    if not project_id:
        raise HTTPException(status_code=400, detail="project_id required")

    item_type = body.get("item_type", "todo")

    result = await db.execute(
        select(TodoKanbanState).where(TodoKanbanState.todo_id == todo_id)
    )
    state = result.scalar_one_or_none()
    prev_column = state.column if state else "todo"

    # Only todos support Basecamp completion sync; cards are tracked locally only
    if item_type == "todo":
        try:
            if column == "done" and prev_column != "done":
                await basecamp.complete_item(access_token, project_id, todo_id, item_type, account_id=None)
            elif column != "done" and prev_column == "done":
                await basecamp.reopen_item(access_token, project_id, todo_id, item_type, account_id=None)
        except Exception as e:
            raise HTTPException(status_code=422, detail=f"Basecamp error: {str(e)}")

    if state:
        state.column = column
    else:
        state = TodoKanbanState(todo_id=todo_id, column=column)
        db.add(state)

    await db.commit()
    return {"todo_id": todo_id, "column": column}
