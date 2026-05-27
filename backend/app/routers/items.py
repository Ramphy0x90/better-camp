"""Item detail and comment router — ``/api/items``.

Provides a unified endpoint for fetching the full detail of any Basecamp
recording (todo or card) and for posting plain-text comments.
"""

import asyncio
from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from ..services import basecamp
from ..routers.auth import get_token

router = APIRouter(prefix="/api/items", tags=["items"])


class CommentBody(BaseModel):
    """Request body for ``POST /api/items/{item_id}/comments``."""

    content: str
    """Plain-text comment body."""

    project_id: int
    """Basecamp bucket / project ID that owns the recording."""


@router.post("/{item_id}/comments")
async def post_comment(
    item_id: int,
    body: CommentBody,
    access_token: str = Depends(get_token),
):
    """Post a plain-text comment on a todo or card and return the created comment."""
    comment = await basecamp.post_comment(access_token, body.project_id, item_id, body.content, account_id=None)
    return {
        "id": comment.get("id"),
        "content": comment.get("content", ""),
        "creator": comment.get("creator"),
        "created_at": comment.get("created_at"),
    }


@router.get("/{item_id}")
async def get_item_detail(
    item_id: int,
    project_id: int = Query(..., description="Basecamp bucket / project ID"),
    item_type: str = Query("todo", description="'todo' or 'card'"),
    access_token: str = Depends(get_token),
):
    """Fetch the full detail of a todo or card, including its comments.

    The detail and comments are fetched concurrently to minimise latency.
    """
    detail, comments = await asyncio.gather(
        basecamp.get_item_detail(access_token, project_id, item_id, item_type, account_id=None),
        basecamp.get_comments(access_token, project_id, item_id, account_id=None),
    )

    return {
        "id": detail.get("id"),
        "title": detail.get("title") or detail.get("content", ""),
        "description": detail.get("description", ""),
        "completed": detail.get("completed", False),
        "due_on": detail.get("due_on"),
        "created_at": detail.get("created_at"),
        "updated_at": detail.get("updated_at"),
        "creator": detail.get("creator"),
        "assignees": detail.get("assignees", []),
        "app_url": detail.get("app_url", ""),
        "comments": [
            {
                "id": c.get("id"),
                "content": c.get("content", ""),
                "creator": c.get("creator"),
                "created_at": c.get("created_at"),
            }
            for c in (comments if isinstance(comments, list) else [])
        ],
    }
