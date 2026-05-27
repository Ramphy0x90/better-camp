# BetterCamp — Setup

A cleaner Basecamp UI: kanban board for your assignments + project browser.

## Prerequisites

- Docker + Docker Compose
- A Basecamp account

---

## Step 1 — Register a Basecamp OAuth app (one-time, ~2 min)

1. Go to https://integrate.37signals.com
2. Sign in with your 37signals account
3. Click **Register an application**
4. Fill in:
   - **Name**: BetterCamp (or anything)
   - **Website**: http://localhost:9090
   - **Redirect URI**: `http://localhost:9090/auth/callback`
5. Save — you'll get a **Client ID** and **Client Secret**

---

## Step 2 — Create your .env file

```bash
cp .env.example .env
```

Edit `.env` and fill in:

```
BASECAMP_CLIENT_ID=<from step 1>
BASECAMP_CLIENT_SECRET=<from step 1>
BASECAMP_ACCOUNT_ID=3501249      # already set — your account ID
SECRET_KEY=<any random string>
```

---

## Step 3 — Run

```bash
docker compose up --build
```

Open http://localhost:9090 — you'll be redirected to Basecamp to authorize, then land on your kanban board.

---

## Kanban columns

| Column | Syncs to Basecamp? |
|---|---|
| To Do | No — local state |
| In Progress | No — local state |
| In Review | No — local state |
| Done | Yes — marks todo as completed |

Moving a card back from Done → any other column also reopens it in Basecamp.

---

## Future Kubernetes deployment

The app is stateless except for a SQLite file (`/app/data/bettercamp.db`).
For k8s, mount a PVC at `/app/data` and set `DATABASE_URL` in a Secret.
The redirect URI and frontend URL will need to point to your ingress hostname.
