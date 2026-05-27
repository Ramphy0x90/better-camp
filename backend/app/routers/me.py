"""Current-user router — profile, accounts, people, and notifications.

All endpoints under ``/api/me`` relate to the authenticated user or to data
scoped to the selected Basecamp organisation.

Notifications are approximated by fetching the most recent comments on the
user's 15 most recent active assignments, since Basecamp 3 does not expose a
global notification feed via its API.
"""

from fastapi import APIRouter, Depends
from ..services import basecamp
from ..routers.auth import get_token

router = APIRouter(prefix="/api/me", tags=["me"])


@router.get("")
async def get_me(
    access_token: str = Depends(get_token),
):
    """Return the authenticated user's profile (name, email, avatar)."""
    data = await basecamp.get_me(access_token)
    identity = data.get("identity", {})
    return {
        "id": identity.get("id"),
        "name": f"{identity.get('first_name', '')} {identity.get('last_name', '')}".strip(),
        "email": identity.get("email_address"),
        "avatar_url": identity.get("avatar_url"),
    }


@router.get("/accounts")
async def get_accounts(access_token: str = Depends(get_token)):
    """List all Basecamp 3 organisations the authenticated user belongs to.

    Used by the Settings page to populate the account selector, replacing the
    need for a ``BASECAMP_ACCOUNT_ID`` environment variable.
    """
    data = await basecamp.get_me(access_token)
    accounts = data.get("accounts", [])
    return [
        {"id": str(a["id"]), "name": a["name"], "product": a.get("product", "")}
        for a in accounts
        if a.get("product") == "bc3"
    ]


@router.get("/people")
async def get_people(
    access_token: str = Depends(get_token),
):
    """List all members of the Basecamp organisation.

    Used by the kanban and dashboard person-filter dropdowns.
    """
    people = await basecamp.get_people(access_token, account_id=None)
    people.sort(key=lambda p: p.get("name", "").lower())
    return [
        {
            "id": p["id"],
            "name": p.get("name", ""),
            "email_address": p.get("email_address"),
            "avatar_url": p.get("avatar_url"),
        }
        for p in people
    ]


@router.get("/notifications")
async def get_notifications(
    access_token: str = Depends(get_token),
):
    """Return recent comments on the user's active assignments.

    Each result is a comment fetched from the Basecamp comments endpoint,
    enriched with ``_item_title`` (the parent todo title) and ``_bucket_name``
    (the project name).  Returns up to 50 comments sorted newest-first.
    """
    comments = await basecamp.get_notifications(access_token, account_id=None)
    result = []
    for c in (comments if isinstance(comments, list) else []):
        item_title = c.get("_item_title") or "an item"
        project_name = c.get("_bucket_name") or ""
        result.append({
            "id": c.get("id"),
            "title": f'commented on "{item_title}"',
            "action": "commented",
            "content": c.get("content", ""),
            "creator": c.get("creator"),
            "created_at": c.get("created_at"),
            "app_url": c.get("app_url", ""),
            "read": False,
            "project_name": project_name,
        })
    return result
