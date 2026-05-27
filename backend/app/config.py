"""Application configuration loaded from environment variables or a .env file.

All values are validated by pydantic-settings at startup. The only required
variables are the Basecamp OAuth credentials; everything else has sensible
defaults for local development.
"""

from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    """Centralised application settings.

    Loaded once and cached at startup.  All values are read from environment
    variables (or a ``.env`` file).
    """

    basecamp_account_id: str
    """37signals account ID for the Basecamp organisation to query."""

    basecamp_client_id: str
    """OAuth 2.0 client ID issued by 37signals."""

    basecamp_client_secret: str
    """OAuth 2.0 client secret issued by 37signals."""

    basecamp_redirect_uri: str = "http://localhost:8000/auth/callback"
    """Redirect URI registered in the 37signals developer portal."""

    app_username: str
    """Username for the app-level login gate."""

    app_password: str
    """Password for the app-level login gate."""

    secret_key: str = "change-me-in-production"
    """Secret key used for session signing. Override in production."""

    frontend_url: str = "http://localhost:4200"
    """Base URL of the Angular frontend, used for CORS and post-login redirects."""

    database_url: str = "sqlite+aiosqlite:///./bettercamp.db"
    """SQLAlchemy-compatible async database URL."""

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}


@lru_cache
def get_settings() -> Settings:
    """Return the singleton Settings instance (cached after first call)."""
    return Settings()
