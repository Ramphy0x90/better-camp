"""SQLAlchemy ORM models for persistent application state.

All tables are created automatically on startup via ``Base.metadata.create_all``
inside the FastAPI lifespan handler in ``main.py``.
"""

from sqlalchemy import String, Integer, func
from sqlalchemy.orm import Mapped, mapped_column
from .database import Base


class UserPreferences(Base):
    """Per-user configuration persisted across sessions.

    Only one row is expected (single-user application).
    """

    __tablename__ = "user_preferences"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)

    pinned_project_ids: Mapped[str | None] = mapped_column(String, nullable=True)
    """JSON-encoded list of project IDs, e.g. ``"[123, 456]"``.
    ``None`` or empty means all active projects are shown."""


class OAuthToken(Base):
    """Stores the Basecamp OAuth token for the single authenticated user.

    Only one row is expected. The token is refreshed automatically when it
    expires (not yet implemented; currently replaced on each new login).
    """

    __tablename__ = "oauth_tokens"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    access_token: Mapped[str] = mapped_column(String, nullable=False)
    refresh_token: Mapped[str] = mapped_column(String, nullable=False)
    expires_at: Mapped[str] = mapped_column(String, nullable=True)
    created_at: Mapped[str] = mapped_column(String, default=func.now())


class TodoKanbanState(Base):
    """Local kanban column override for a single todo or card.

    Basecamp does not have the concept of a four-column kanban board, so the
    user's drag-and-drop positions are stored here. The column value takes
    precedence over any default derived from the Basecamp column name, except
    when the item is completed in Basecamp (which always maps to ``done``).
    """

    __tablename__ = "todo_kanban_states"

    todo_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    column: Mapped[str] = mapped_column(String, nullable=False, default="todo")
    updated_at: Mapped[str] = mapped_column(String, default=func.now(), onupdate=func.now())
