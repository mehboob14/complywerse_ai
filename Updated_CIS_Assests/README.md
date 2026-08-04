# Compliverse — IT-Assets Module Update (handoff package)

This package contains the **updated IT-Assets module** of the Compliverse GRC
platform and everything needed to run it on a fresh PC. The work in this round
is focused on four connected areas:

1. **IT Assets** — the asset inventory, the asset detail page, and the new
   **Host-Applications ("room-and-chair") panel** that shows every app
   co-located on a host, each app's CIS benchmark, its score, and a composite
   group score.
2. **CIS / Compliance Plugins** — benchmark matching, agentless inventory,
   OS detection, and the per-asset CIS dashboard.
3. **Risk Posture** — the per-asset risk page and how scan results roll up
   into an effective risk score.
4. **Agents / Connect Wizard** — agent vs. agentless onboarding, the Connect
   Wizard navigation fixes, and agent-side software inventory.

> The package ships the **whole runnable project** (frontend + backend) so it
> starts on a clean machine, but everything documented and highlighted here is
> the IT-Assets module and its pages.

---

## What's in this folder

```
compliverse-asset-pages-update/
├── README.md                  ← you are here (setup + overview)
├── CHANGES.md                 ← every change we made, grouped by area
├── updated-pages-quickref/    ← copies of the key updated files, by area
│   ├── 1-it-assets/
│   ├── 2-cis-compliance/
│   ├── 3-risk-posture/
│   ├── 4-agents-connect/
│   └── 5-shared/
├── database/
│   ├── grc-demo.sql.gz        ← restore this (schema + demo data, ~20 MB)
│   ├── grc-schema.sql         ← schema only, for reference
│   └── RESTORE.md             ← step-by-step DB restore
├── scripts/                   ← copies of the run scripts
└── project/                   ← the full runnable app (frontend + backend)
```

`updated-pages-quickref/` is just easy-to-browse **copies** — the real files
that run live under `project/` at their original paths. `CHANGES.md` lists both
paths for each file.

---

## Architecture (how the 3 processes fit together)

```
Browser ──▶  Vite frontend (port 20080)
                 │  calls /api/*
                 ▼
            Node api-server proxy (port 8080)  ──▶  FastAPI backend (port 5000)
                                                          │
                                                          ▼
                                                  PostgreSQL  (port 5433, db "grc")
```

- **Frontend** — React 19 + Vite + Tailwind, in `project/artifacts/grc-frontend`.
- **Backend** — FastAPI (Python), in `project/.migration-backup/backend`.
- **Proxy** — small Node server in `project/artifacts/api-server` that forwards
  `/api` to the backend (optional for pure dev, but the start scripts use it).
- **Database** — PostgreSQL 18, database `grc`, port 5433.

---

## Setup on a new PC (Windows)

### 0. Install prerequisites
- **Node.js 20+** and **pnpm** — `npm install -g pnpm`
- **Python 3.11+** (matches the agent's embedded runtime)
- **PostgreSQL 18** — https://www.postgresql.org/download/windows/
  (during install, set the port to **5433** and the `postgres` password to
  `YourStr0ng!Pass`, or adjust `DATABASE_URL` later — see `database/RESTORE.md`)

### 1. Restore the database
Follow **`database/RESTORE.md`**. In short:
```powershell
$PG = "C:\Program Files\PostgreSQL\18\bin"
$env:PGPASSWORD = "YourStr0ng!Pass"
& "$PG\createdb.exe" -h 127.0.0.1 -p 5433 -U postgres grc
& "C:\Program Files\Git\usr\bin\gzip.exe" -d -k database\grc-demo.sql.gz
& "$PG\psql.exe" -h 127.0.0.1 -p 5433 -U postgres -d grc -f database\grc-demo.sql
```

### 2. Configure secrets
The bundled `.env` files already have the local DB URL and dev session secret.
**Optional:** open `project/.migration-backup/backend/.env` and paste your own
`OPENAI_API_KEY` (enables AI features) and SMTP mailbox (enables email). The app
runs fine without them — those features simply no-op.

### 3. Install dependencies
```powershell
# Frontend workspace (run from project/)
cd project
pnpm install

# Backend Python deps (run from the backend folder)
cd .migration-backup\backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt   # or: pip install fastapi uvicorn sqlalchemy psycopg2-binary python-dotenv bcrypt cryptography openai
```

### 4. Run all three processes (separate terminals)
From `project/`:
```powershell
# Terminal 1 — backend (FastAPI on :5000)
.\start-backend.ps1        # = uvicorn main:app --port 5000  (in .migration-backup/backend)

# Terminal 2 — frontend (Vite on :20080)
.\start-frontend.ps1       # = pnpm --filter @workspace/grc-frontend run dev

# Terminal 3 — proxy (Node on :8080)  [optional]
.\start-proxy.ps1
```
Then open **http://localhost:20080**.

### 5. Log in
- **Email:** `hassan@demobank.com`
- **Password:** `demo1234`

Go to **IT Assets → Inventory → demo-bank-srv-01 → Compliance tab** to see the
updated Host-Applications panel (the "room-and-chair" composite score and the
co-located MSSQL / Tomcat / IIS / Oracle apps).

---

## Quick smoke test (does the new work render?)

1. Asset **demo-bank-srv-01** → **Compliance** tab → you should see:
   - an **IP Group** header ("5 assets share this IP")
   - a **Group compliance score** card with a **Configure weights** button
   - a **CO-LOCATED ASSETS (5)** list, one clean row per app, each showing the
     **real benchmark name** (e.g. `CIS_Microsoft_SQL_Server_2022_Benchmark…`),
     rule count, score (or an amber **Not scanned** pill), and a clickable
     **criticality badge** that opens a justification popover.
2. Click a benchmark name → it deep-links to that asset's compliance page.
3. Open **Risk Posture → demo-bank-srv-01** → the effective risk reflects the
   group's scan scores.

---

## Notes / known constraints

- The bundled DB dump has the **data** of three noisy tables emptied
  (`grc_cis_ingest_jobs`, `grc_audit_logs`, `grc_workflow_audit_logs`) to keep
  it small — see `database/RESTORE.md`. Nothing in the IT-Assets flows needs them.
- The 24 MB prebuilt **Windows agent installer** and its 85 MB build tree were
  excluded from `project/` to keep the package light. The agent **source**
  (`.../agent/complyverse_agent/`) is included. Rebuild the installer from the
  original repo's `agent/packaging` if needed, or download it from the in-app
  **Agents** page.
- `.env` secrets (OpenAI key, SMTP password) were replaced with placeholders.
  Use your own.
