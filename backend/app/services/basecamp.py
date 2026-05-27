"""Async client for the Basecamp 3 REST API (3.basecampapi.com).

All public functions accept an ``account_id`` keyword argument that overrides
the organisation used in URL paths.  When ``None`` is passed (the default),
``_acct()`` falls back to ``BASECAMP_ACCOUNT_ID`` from the environment config.

Authentication uses Bearer tokens issued by the 37signals Launchpad OAuth
service.  All requests include the required ``User-Agent`` header.
"""

import asyncio
import httpx
from typing import Any
from ..config import get_settings

BASE_URL = "https://3.basecampapi.com"
LAUNCHPAD_URL = "https://launchpad.37signals.com"


def _acct(override: str | None) -> str:
    """Return *override* if set, otherwise fall back to ``BASECAMP_ACCOUNT_ID`` from config.

    Raises:
        ValueError: When no account ID is available from either source.
    """
    if override:
        return override
    acct = get_settings().basecamp_account_id
    if not acct:
        raise ValueError("BASECAMP_ACCOUNT_ID is not set.")
    return acct


def get_auth_url(state: str) -> str:
    """Build the 37signals OAuth authorisation URL with a CSRF *state* token.

    Args:
        state: A cryptographically random string stored server-side for CSRF
            validation during the callback.

    Returns:
        The full URL the user should be redirected to.
    """
    settings = get_settings()
    return (
        f"{LAUNCHPAD_URL}/authorization/new"
        f"?type=web_server"
        f"&client_id={settings.basecamp_client_id}"
        f"&redirect_uri={settings.basecamp_redirect_uri}"
        f"&state={state}"
    )


async def exchange_code(code: str) -> dict:
    """Exchange an OAuth authorisation code for an access/refresh token pair.

    Args:
        code: The one-time code received in the OAuth callback query string.

    Returns:
        The raw token response from 37signals containing ``access_token``,
        ``refresh_token``, and ``expires_in``.
    """
    settings = get_settings()
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"{LAUNCHPAD_URL}/authorization/token",
            params={
                "type": "web_server",
                "client_id": settings.basecamp_client_id,
                "redirect_uri": settings.basecamp_redirect_uri,
                "client_secret": settings.basecamp_client_secret,
                "code": code,
            },
        )
        resp.raise_for_status()
        return resp.json()


async def refresh_access_token(refresh_token: str) -> dict:
    """Obtain a new access token using a refresh token.

    Args:
        refresh_token: A valid refresh token previously issued by 37signals.

    Returns:
        A new token response with a fresh ``access_token``.
    """
    settings = get_settings()
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"{LAUNCHPAD_URL}/authorization/token",
            params={
                "type": "refresh",
                "client_id": settings.basecamp_client_id,
                "redirect_uri": settings.basecamp_redirect_uri,
                "client_secret": settings.basecamp_client_secret,
                "refresh_token": refresh_token,
            },
        )
        resp.raise_for_status()
        return resp.json()


def _headers(access_token: str) -> dict:
    """Return the HTTP headers required by every Basecamp API request."""
    return {
        "Authorization": f"Bearer {access_token}",
        "User-Agent": "BetterCamp (ramphy.aq@gmail.com)",
    }


async def get_assignments(access_token: str, page: int = 1, account_id: str | None = None) -> dict:
    """Fetch the authenticated user's active assignments from Basecamp.

    Returns both priorities and non-priorities in a single dict keyed by
    ``"priorities"`` and ``"non_priorities"``.

    Args:
        access_token: A valid Basecamp Bearer token.
        page: Pagination page (1-based).
        account_id: Organisation ID override from ``UserPreferences``.
    """
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            f"{BASE_URL}/{_acct(account_id)}/my/assignments.json",
            headers=_headers(access_token),
            params={"page": page},
        )
        resp.raise_for_status()
        return resp.json()


async def get_completed_assignments(access_token: str, account_id: str | None = None) -> list[dict]:
    """Fetch the authenticated user's recently completed assignments.

    Args:
        access_token: A valid Basecamp Bearer token.
        account_id: Organisation ID override.
    """
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            f"{BASE_URL}/{_acct(account_id)}/my/assignments/completed.json",
            headers=_headers(access_token),
        )
        resp.raise_for_status()
        return resp.json()


async def search_todos_for_person(
    access_token: str,
    person_id: int,
    account_id: str | None = None,
    pinned_project_ids: list[int] | None = None,
) -> list[dict]:
    """Find all active todos assigned to *person_id* by scanning every project.

    Because the Basecamp 3 API only exposes ``/my/assignments.json`` for the
    token owner, this function builds the equivalent list for any other person
    by iterating projects → todosets → todolists → todos and filtering by
    assignee.  All project fetches run concurrently with ``asyncio.gather``.

    The search is scoped to *pinned_project_ids* when provided (falling back to
    all active projects if the list is empty or produces no matches).

    Args:
        access_token: A valid Basecamp Bearer token.
        person_id: Basecamp person ID to search assignments for.
        account_id: Organisation ID override.
        pinned_project_ids: Restrict the search to these project IDs for speed.

    Returns:
        A list of todo dicts, each augmented with ``bucket`` (project) and
        ``parent`` (todolist) fields so they are compatible with
        ``assignments._normalize()``.
    """
    all_projects = await get_projects(access_token, account_id=account_id)
    active = [p for p in all_projects if p.get("status") == "active"]

    if pinned_project_ids:
        pinned_set = set(pinned_project_ids)
        scoped = [p for p in active if p["id"] in pinned_set] or active
    else:
        scoped = active

    async def fetch_project(project: dict) -> list[dict]:
        project_id = project["id"]
        project_name = project.get("name", "")
        todoset_tool = next(
            (d for d in project.get("dock", []) if d["name"] == "todoset" and d["enabled"]),
            None,
        )
        if not todoset_tool:
            return []
        try:
            todolists = await get_todolists(
                access_token, project_id, todoset_tool["id"], account_id=account_id
            )
        except Exception:
            return []

        list_results = await asyncio.gather(
            *[get_todos(access_token, project_id, tl["id"], account_id=account_id) for tl in todolists],
            return_exceptions=True,
        )

        matched: list[dict] = []
        for tl, todos_or_err in zip(todolists, list_results):
            if isinstance(todos_or_err, Exception):
                continue
            for t in todos_or_err:
                if t.get("completed"):
                    continue
                if any(a["id"] == person_id for a in t.get("assignees", [])):
                    matched.append({
                        **t,
                        "bucket": {"id": project_id, "name": project_name},
                        "parent": {
                            "id": tl["id"],
                            "title": tl.get("title") or tl.get("name", ""),
                        },
                    })
        return matched

    results = await asyncio.gather(*[fetch_project(p) for p in scoped], return_exceptions=True)
    todos: list[dict] = []
    for r in results:
        if not isinstance(r, Exception):
            todos.extend(r)
    return todos


async def get_projects(access_token: str, account_id: str | None = None) -> list[dict]:
    """Fetch all projects in the organisation, following pagination automatically.

    Args:
        access_token: A valid Basecamp Bearer token.
        account_id: Organisation ID override.

    Returns:
        Combined list of raw project dicts across all pages.
    """
    return await _paginate(access_token, f"{BASE_URL}/{_acct(account_id)}/projects.json")


def _next_link(link_header: str) -> str | None:
    """Parse a ``Link`` header and return the ``rel="next"`` URL, or ``None``."""
    for part in link_header.split(","):
        part = part.strip()
        if 'rel="next"' in part:
            return part.split(";")[0].strip().strip("<>")
    return None


async def _paginate(access_token: str, start_url: str) -> list[dict]:
    """Fetch all pages of a Basecamp list endpoint, following ``Link`` headers.

    Args:
        access_token: A valid Basecamp Bearer token.
        start_url: The initial URL to request.

    Returns:
        Combined list of all items across every page.
    """
    items: list[dict] = []
    url: str | None = start_url
    headers = _headers(access_token)
    async with httpx.AsyncClient() as client:
        while url:
            resp = await client.get(url, headers=headers)
            resp.raise_for_status()
            items.extend(resp.json())
            url = _next_link(resp.headers.get("Link", ""))
    return items


async def get_people(access_token: str, account_id: str | None = None) -> list[dict]:
    """List all people (members) in the organisation, following pagination.

    Args:
        access_token: A valid Basecamp Bearer token.
        account_id: Organisation ID override.
    """
    return await _paginate(access_token, f"{BASE_URL}/{_acct(account_id)}/people.json")


async def get_todosets(access_token: str, project_id: int, account_id: str | None = None) -> Any:
    """Fetch the todoset (todo tool) for a given project.

    Args:
        access_token: A valid Basecamp Bearer token.
        project_id: Basecamp bucket / project ID.
        account_id: Organisation ID override.
    """
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            f"{BASE_URL}/{_acct(account_id)}/buckets/{project_id}/todosets.json",
            headers=_headers(access_token),
        )
        resp.raise_for_status()
        return resp.json()


async def get_todolists(
    access_token: str, project_id: int, todoset_id: int, account_id: str | None = None
) -> list[dict]:
    """Fetch all todo lists inside a project's todoset, following pagination.

    Args:
        access_token: A valid Basecamp Bearer token.
        project_id: Basecamp bucket / project ID.
        todoset_id: The todoset tool ID obtained from the project dock.
        account_id: Organisation ID override.
    """
    return await _paginate(
        access_token,
        f"{BASE_URL}/{_acct(account_id)}/buckets/{project_id}/todosets/{todoset_id}/todolists.json",
    )


async def get_todos(
    access_token: str, project_id: int, todolist_id: int, account_id: str | None = None
) -> list[dict]:
    """Fetch all active todos inside a specific todo list, following pagination.

    Args:
        access_token: A valid Basecamp Bearer token.
        project_id: Basecamp bucket / project ID.
        todolist_id: The todo list ID.
        account_id: Organisation ID override.
    """
    return await _paginate(
        access_token,
        f"{BASE_URL}/{_acct(account_id)}/buckets/{project_id}/todolists/{todolist_id}/todos.json",
    )


async def get_item_detail(
    access_token: str, project_id: int, item_id: int, item_type: str = "todo",
    account_id: str | None = None
) -> dict:
    """Fetch the full detail of a single todo or card.

    Args:
        access_token: A valid Basecamp Bearer token.
        project_id: Basecamp bucket / project ID.
        item_id: ID of the todo or card.
        item_type: ``"todo"`` or ``"card"`` — determines the API path used.
        account_id: Organisation ID override.
    """
    if item_type == "card":
        path = f"buckets/{project_id}/card_tables/cards/{item_id}.json"
    else:
        path = f"buckets/{project_id}/todos/{item_id}.json"
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            f"{BASE_URL}/{_acct(account_id)}/{path}",
            headers=_headers(access_token),
        )
        resp.raise_for_status()
        return resp.json()


async def get_comments(
    access_token: str, project_id: int, item_id: int, account_id: str | None = None
) -> list[dict]:
    """Fetch all comments on a recording (todo, card, message, etc.).

    Args:
        access_token: A valid Basecamp Bearer token.
        project_id: Basecamp bucket / project ID.
        item_id: ID of the parent recording.
        account_id: Organisation ID override.
    """
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            f"{BASE_URL}/{_acct(account_id)}/buckets/{project_id}/recordings/{item_id}/comments.json",
            headers=_headers(access_token),
        )
        resp.raise_for_status()
        return resp.json()


def _completion_url(account_id: str, project_id: int, item_id: int, item_type: str) -> str:
    """Build the Basecamp completion endpoint URL for a todo or card."""
    if item_type == "card":
        return f"{BASE_URL}/{account_id}/buckets/{project_id}/card_tables/cards/{item_id}/completion.json"
    return f"{BASE_URL}/{account_id}/buckets/{project_id}/todos/{item_id}/completion.json"


async def complete_item(
    access_token: str, project_id: int, item_id: int, item_type: str = "todo",
    account_id: str | None = None
) -> None:
    """Mark a todo as completed in Basecamp.

    Args:
        access_token: A valid Basecamp Bearer token.
        project_id: Basecamp bucket / project ID.
        item_id: ID of the todo.
        item_type: ``"todo"`` or ``"card"``.
        account_id: Organisation ID override.
    """
    url = _completion_url(_acct(account_id), project_id, item_id, item_type)
    async with httpx.AsyncClient() as client:
        resp = await client.post(url, headers=_headers(access_token))
        resp.raise_for_status()


async def reopen_item(
    access_token: str, project_id: int, item_id: int, item_type: str = "todo",
    account_id: str | None = None
) -> None:
    """Reopen (un-complete) a previously completed todo in Basecamp.

    Args:
        access_token: A valid Basecamp Bearer token.
        project_id: Basecamp bucket / project ID.
        item_id: ID of the todo.
        item_type: ``"todo"`` or ``"card"``.
        account_id: Organisation ID override.
    """
    url = _completion_url(_acct(account_id), project_id, item_id, item_type)
    async with httpx.AsyncClient() as client:
        resp = await client.delete(url, headers=_headers(access_token))
        resp.raise_for_status()


async def get_recording_events(
    access_token: str, project_id: int, recording_id: int, account_id: str | None = None
) -> list[dict]:
    """Fetch the activity event log for a recording (todo, card, message, etc.).

    Events include actions such as ``"commented"``, ``"mentioned"``,
    ``"boosted"``, ``"completed"``, and ``"created"``.  Returns an empty list
    if the recording is not found (404) or access is denied (403).

    Args:
        access_token: A valid Basecamp Bearer token.
        project_id: Basecamp bucket / project ID.
        recording_id: ID of the recording to query.
        account_id: Organisation ID override.
    """
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            f"{BASE_URL}/{_acct(account_id)}/buckets/{project_id}/recordings/{recording_id}/events.json",
            headers=_headers(access_token),
        )
        if resp.status_code in (404, 403):
            return []
        resp.raise_for_status()
        return resp.json()


async def get_notifications(access_token: str, account_id: str | None = None) -> list[dict]:
    """Fetch recent comments across the user's active assignments as notifications.

    The Basecamp 3 recording-events endpoint does not reliably surface
    "commented" / "mentioned" / "boosted" action types, so this function uses
    the comments endpoint directly — the same one used by the item-detail view.

    Each comment dict is augmented with ``_item_title`` and ``_bucket_name``
    so the caller can build a human-readable notification title without an
    additional API call.

    Args:
        access_token: A valid Basecamp Bearer token.
        account_id: Organisation ID override from ``UserPreferences``.

    Returns:
        Up to 50 comment dicts sorted by ``created_at`` descending.
    """
    assignments_raw = await get_assignments(access_token, page=1, account_id=account_id)
    assignments = (
        assignments_raw.get("priorities", []) + assignments_raw.get("non_priorities", [])
        if isinstance(assignments_raw, dict)
        else assignments_raw if isinstance(assignments_raw, list) else []
    )
    recent = assignments[:15]
    if not recent:
        return []

    async def fetch_item_comments(item: dict) -> list[dict]:
        try:
            item_id = item.get("id")
            bucket_id = (item.get("bucket") or {}).get("id")
            if not item_id or not bucket_id:
                return []
            comments = await get_comments(access_token, bucket_id, item_id, account_id=account_id)
            item_title = item.get("title") or item.get("content", "")
            bucket_name = (item.get("bucket") or {}).get("name", "")
            return [
                {
                    **c,
                    "action": "commented",
                    "_item_title": item_title,
                    "_bucket_name": bucket_name,
                }
                for c in (comments if isinstance(comments, list) else [])
            ]
        except Exception:
            return []

    results = await asyncio.gather(*[fetch_item_comments(item) for item in recent])
    all_notifications: list[dict] = []
    for comments in results:
        all_notifications.extend(comments)

    all_notifications.sort(key=lambda c: c.get("created_at") or "", reverse=True)
    return all_notifications[:50]


async def post_comment(
    access_token: str, project_id: int, item_id: int, content: str,
    account_id: str | None = None
) -> dict:
    """Post a plain-text comment on a recording.

    Args:
        access_token: A valid Basecamp Bearer token.
        project_id: Basecamp bucket / project ID.
        item_id: ID of the recording to comment on.
        content: Plain-text comment body.
        account_id: Organisation ID override.

    Returns:
        The newly created comment dict from the Basecamp API.
    """
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"{BASE_URL}/{_acct(account_id)}/buckets/{project_id}/recordings/{item_id}/comments.json",
            headers={**_headers(access_token), "Content-Type": "application/json"},
            json={"content": content},
        )
        resp.raise_for_status()
        return resp.json()


async def get_me(access_token: str) -> dict:
    """Fetch the authenticated user's identity and account list from Launchpad.

    Returns:
        A dict with ``identity`` (name, email, avatar) and ``accounts``
        (list of Basecamp organisations the user belongs to).
    """
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            f"{LAUNCHPAD_URL}/authorization.json",
            headers=_headers(access_token),
        )
        resp.raise_for_status()
        return resp.json()
