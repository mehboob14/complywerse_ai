# ComplyVerse GRC — Architecture & Extension Guide

> Read this before adding functionality or integrating a module (e.g. code lifted from Replit).
> It explains the structure, the request flow, the **non-negotiable conventions**, and gives
> copy-pasteable recipes. Keep changes **additive** and **verify** with the smoke harness (§13).

---

## 1. What this is

Multi-tenant **Governance, Risk & Compliance** platform.

| Layer | Tech | Entry |
|---|---|---|
| Backend | FastAPI + SQLAlchemy 2.0 + Celery | `backend/main.py` → mounts `backend/grc/main.py` at `/grc`, port **4000** |
| Frontend | Next.js (App Router) + TypeScript + React Query + axios | `grc-frontend/`, port **3000** |
| Data | **PostgreSQL, one database per tenant** (+ a master catalog DB) | `backend/grc/db.py` |
| Async | Celery + Redis | `backend/grc/celery_app.py` |

### Run it
```bash
# backend (from backend/)
cd backend && python main.py                 # http://localhost:4000/grc , docs at /grc/docs

# frontend
cd grc-frontend && npm run dev                # http://localhost:3000

# heavy background jobs (parse-policy, gap-analysis, framework parse)
cd backend && python -m celery -A grc.celery_app worker --queues=parsing --pool=solo --loglevel=info
```

---

## 2. Repository map

```
backend/
  main.py                      # ASGI entry: loads .env, CORS, mounts grc at /grc
  requirements.txt             # the dependency source of truth (no uv/poetry)
  grc/
    main.py                    # FastAPI app + ALL router registration (order-sensitive!)
    config.py                  # ⭐ central config: REDIS_URL, Celery URLs, get_openai_api_key()
    db.py                      # per-tenant Postgres engines/sessions, provisioning
    models/                    # ⭐ ORM models — a PACKAGE split by domain (_NN_*.py), re-exported
    schemas/                   # ⭐ Pydantic schemas — a PACKAGE split by domain (_NN_*.py), re-exported
    permissions.py             # RBAC permission catalog
    crypto.py  audit_logger.py  job_status.py  tenant_manager.py
    middleware/                # TenantMiddleware (subdomain / X-Tenant-Slug → request.state.tenant_slug)
    routers/                   # ~35 "core" API routers (auth, frameworks, risks, evidence, …)
    modules/                   # ~19 feature modules (erm, governance, vendor_risk, vuln_management, …)
    services/                  # cross-cutting helpers shared by routers/modules
    tasks/                     # Celery tasks (TenantTask base); registered in celery_app.py
    seed_data/  seed_*.py      # framework + workflow seed data (run at tenant provisioning)
grc-frontend/
  src/
    app/                       # App Router: (dashboard) group, login, register, vendor-risk
    lib/api.ts                 # ⭐ central axios client (all backend calls go through here)
    components/  hooks/  types/
docs/                          # this guide + SETUP, DATABASE_SCHEMA, DESIGN_REFERENCE, INDEX
```

⭐ = the pieces you touch most when extending.

---

## 3. Request flow (the critical path)

```
HTTP request
  → TenantMiddleware (middleware/subdomain.py)
        resolves tenant from subdomain or `X-Tenant-Slug` header
        sets request.state.tenant_slug
  → router endpoint, with  db: Session = Depends(get_db)
  → get_db (grc/models)  uses request.state.tenant_slug
        → db.py opens a session bound to that tenant's own Postgres DB (grc_<slug>)
  → endpoint queries/commits against the tenant DB, returns a Pydantic schema
```

Every operational endpoint **must** carry tenant context. `get_db` raises **400** if there's no
tenant slug. The frontend supplies it automatically (`X-Tenant-Slug` header in `lib/api.ts`).

**Auth dependencies** (import from `grc.routers.auth_router`):
- `require_auth` — require a logged-in user (FastAPI dependency).
- `require_tenant_permission("<permission>")` — require an RBAC permission (factory → dependency).
- `get_current_user`, `get_user_tenants`, `get_user_primary_tenant` — helpers.

---

## 4. Non-negotiable conventions (break these → silent failures)

1. **Router registration ORDER matters** (`grc/main.py`): NCA routers register **before**
   `risks_router` / `vuln_management_router` (the parametric `/risks/{id}` route would otherwise
   swallow `/risks/nca`). `auth_router` registers before API routers. **Append new routers; don't reorder.**
2. **Relative imports are depth-based.** Moving a file changes its dot-count. See the table in §6.
3. **No Alembic.** `models/` IS the schema — tables auto-created via `Base.metadata.create_all` +
   idempotent self-heal on tenant-engine init (`db.py`). **Don't rename/drop columns or model classes.**
   Adding new tables/columns is fine (they get created automatically for each tenant).
4. **One shared `Base`.** Every ORM model uses the single `Base` from `models/_00_base.py`.
   **Never call `declarative_base()` again** in a new module — import the existing `Base`.
5. **`models` and `schemas` are PACKAGES**, not files (see §5). `from grc.models import X` still works.
6. **Config via `grc/config.py`**, not inline `os.getenv` (see §10).

---

## 5. `models/` and `schemas/` are split packages

Each is a folder of `_NN_<domain>.py` section files chained with `from .prev import *`, plus an
`__init__.py` that re-exports everything. This preserves the original single-namespace semantics:
`from grc.models import Risk` and `from grc.schemas import RiskCreate` work exactly as before.

**To add a model/schema:** append the class to the section file that best fits its domain
(e.g. a new vendor table → `models/_35_vendor_risk_management_models.py`). It propagates
automatically through the chain — **no `__init__.py` edit needed.**

**To add a whole new domain file** (only if it doesn't fit any section):
1. Create `models/_39_<domain>.py` starting with `from ._38_database_initialization_functions import *`
   (chain from the current last file).
2. Change the last line of `models/__init__.py` to `from ._39_<domain> import *`.
3. Keep model classes subclassing the shared `Base` (already in scope via the chain import).

---

## 6. Relative-import depth cheat-sheet

| File location | `models`/`schemas`/`config` | auth_router |
|---|---|---|
| `grc/routers/<x>_router.py` | `from ..models import …` | `from .auth_router import …` |
| `grc/modules/<m>/router.py` | `from ...models import …` | `from ...routers.auth_router import …` |
| `grc/modules/<m>/routers/<f>.py` | `from ....models import …` | `from ....routers.auth_router import …` |
| `grc/services/<x>.py` | `from ..models import …` | `from ..routers.auth_router import …` |

Rule of thumb: count directories up to `grc/`, that's the number of dots. **Get this wrong and the
module fails to import — the smoke test in §13 catches it instantly.**

---

## 7. Anatomy of a feature module

```
grc/modules/<name>/
  __init__.py        # from .router import router as <name>_router  ;  __all__ = ["<name>_router"]
  router.py          # APIRouter(prefix="/<name>", tags=[...])  +  include_router() for each sub-router
  routers/
    __init__.py      # exports the sub-routers
    <feature>.py     # router = APIRouter(prefix="/<feature>", tags=[...])  + endpoints
  services/          # (optional) pure business logic for this module
```

Real example — `modules/vendor_risk/`:
```python
# __init__.py
from .router import router as vendor_risk_router
__all__ = ["vendor_risk_router"]

# router.py
from fastapi import APIRouter
from .routers import vendors_router, assessments_router, questionnaires_router
router = APIRouter(prefix="/vendor-risk", tags=["Vendor Risk Management"])
router.include_router(vendors_router)
router.include_router(assessments_router)
router.include_router(questionnaires_router)
```

---

## 8. Recipe — add a new backend feature module

1. **Scaffold** `grc/modules/<name>/` with `__init__.py`, `router.py`, `routers/<feature>.py`
   following §7. Use the correct import depths from §6.
2. **Endpoints** in `routers/<feature>.py`:
   ```python
   from fastapi import APIRouter, Depends
   from sqlalchemy.orm import Session
   from ....models import get_db, GRCUser            # ORM + session dep
   from ....schemas import MyThingCreate, MyThingOut # Pydantic
   from ....routers.auth_router import require_auth, require_tenant_permission

   router = APIRouter(prefix="/my-things", tags=["My Things"])

   @router.get("", response_model=list[MyThingOut])
   def list_things(db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
       ...
   ```
3. **Models** → append classes to the best-fit `models/_NN_*.py` (subclass the shared `Base`).
4. **Schemas** → append to the best-fit `schemas/_NN_*.py`.
5. **Register** in `grc/main.py` (import + `include_router`), **after** the NCA/auth block:
   ```python
   from .modules.my_module import my_module_router
   app.include_router(my_module_router)
   ```
6. **Permissions** (if gated) → add to `permissions.py` and use `require_tenant_permission("…")`.
7. **Verify** (§13). New tables are created automatically per tenant on first access.

---

## 9. Recipe — integrate a module taken from Replit / elsewhere

External code usually assumes a flat layout and absolute imports. Adapt it to our conventions:

1. **Drop it in** as `grc/modules/<name>/` and reshape to the §7 module pattern.
2. **Fix imports** — this is the #1 friction:
   - Convert absolute/app-root imports (`from app.models import X`, `from models import X`) to our
     **relative** form at the right depth (§6): `from ....models import X`.
   - For shared infra, import ours: `from ....config import get_openai_api_key, REDIS_URL`.
3. **Merge models onto the shared `Base`** — delete any `Base = declarative_base()` /
   `metadata` the snippet brought; import our `Base` and move its tables into a `models/_NN_*.py`
   section. (Two Bases = invisible tables + broken relationships.)
   - Make `relationship(...)` and `ForeignKey(...)` use **string** targets (`"grc_other.id"`,
     `"OtherModel"`) — that's the convention here and it keeps cross-section refs resolvable.
4. **Move Pydantic models** into a `schemas/_NN_*.py` section.
5. **Env/secrets** → add defaults to `grc/config.py`; never re-introduce inline `os.getenv` for
   Redis or the OpenAI key.
6. **Background work** → wrap long tasks as Celery tasks under `grc/tasks/` using the `TenantTask`
   base, and add the module to the `include=[...]` list in `celery_app.py` (see §11).
7. **Uploads** → use a `__file__`-anchored absolute path, NOT a cwd-relative string (see §12).
8. **Register the router** in `grc/main.py` (§8 step 5), respecting order (§4.1).
9. **Frontend** → add an API group in `lib/api.ts` and pages under `src/app/(dashboard)/` (§14).
10. **Verify** (§13), then `configure_mappers()` must pass (proves relationships resolve).

---

## 10. Config & secrets

- Central module: **`grc/config.py`**. Add new env-driven settings there with sensible defaults.
  - `REDIS_URL`, `CELERY_BROKER_URL`, `CELERY_RESULT_BACKEND`
  - `get_openai_api_key()` → prefers `AI_INTEGRATIONS_OPENAI_API_KEY`, falls back to `OPENAI_API_KEY`.
- Secrets live in `backend/.env` (git-ignored; see `backend/.env.example`). **Never hardcode keys**
  or read the same env var inline in multiple places — add it to `config.py` once.

---

## 11. Background jobs (Celery)

- Tasks live in `grc/tasks/<area>.py`, based on `TenantTask` (`tasks/base.py`) which injects a
  tenant-scoped DB session, Redis locks, and per-tenant rate limiting.
- Pattern: extract the real work into a plain function (in a router/service), then have both the
  endpoint and the Celery task call it (no duplicated logic).
- Register a new task module by adding it to `include=[...]` in `grc/celery_app.py`.
- Progress is reported via `job_status.py` (Redis) so the UI can poll.

---

## 12. File uploads (and a known bug)

⚠️ Several routers define upload dirs as **cwd-relative strings** (e.g.
`UPLOAD_DIR = "backend/grc/uploads/compliance_assessments"`). Run from `backend/`, these resolve
under `backend/backend/…`, so evidence is currently split across three roots and
`backend/backend/` holds **live data**. **Do not delete `backend/backend/`.**

For **new** code, always anchor to `__file__` so it's cwd-independent:
```python
from pathlib import Path
UPLOAD_DIR = Path(__file__).resolve().parents[N] / "uploads" / "<area>"   # N = depth up to grc/
```

---

## 13. Verify your change (smoke harness — no DB needed)

Engines are lazy, so importing the app does **not** hit Postgres. Run from the repo root:

```bash
# 1) full app imports + every router wires up (expect ROUTES 1596 + your new ones)
python -c "import sys; sys.path.insert(0,'backend'); \
  from dotenv import load_dotenv; load_dotenv('backend/.env'); \
  import grc.main as m; print('ROUTES', len(m.app.routes))"

# 2) ORM integrity — all relationships resolve, schema coherent
python -c "import sys; sys.path.insert(0,'backend'); import grc.models as M; \
  from sqlalchemy.orm import configure_mappers; configure_mappers(); \
  print('tables', len(M.Base.metadata.tables))"

# 3) everything compiles
python -m compileall backend/grc -q

# 4) frontend
cd grc-frontend && npm run build
```

Baseline invariants (a drop = regression): **1596 routes**, **268 tables / 3574 columns**.
After adding a feature, the counts should **go up**, never down. When Postgres + Redis are up,
also do a live check: `python main.py` → `GET /grc/health` → click the new feature in the UI.

---

## 14. Frontend integration

- All backend calls go through the central axios client in **`src/lib/api.ts`** (it injects the
  auth token + `X-Tenant-Slug` automatically). Add a new API group there rather than calling
  `fetch()` ad-hoc.
- Pages live under `src/app/(dashboard)/<area>/page.tsx` (protected route group). Public pages
  (login/register/public questionnaire) sit at the app root.
- Data fetching: **React Query** (`useQuery`/`useMutation`). Mirror an existing page.
- Types in `src/types/` are hand-maintained — keep them in sync with the backend `schemas/`.

---

## 15. Quick reference

| I want to… | Do this |
|---|---|
| Add an endpoint to an existing module | new function in `modules/<m>/routers/<f>.py` |
| Add a new feature area | new module (§7–8) + register in `main.py` |
| Add a DB table | add a model class to a `models/_NN_*.py` section (subclass shared `Base`) |
| Add a request/response shape | add a class to a `schemas/_NN_*.py` section |
| Add config / an API key | `grc/config.py` (+ `.env` / `.env.example`) |
| Run something heavy/async | Celery task in `grc/tasks/` + add to `celery_app.py` `include` |
| Call the backend from the UI | add to `src/lib/api.ts` |
| Check I didn't break anything | the smoke harness (§13) |

See also: [DATABASE_SCHEMA.md](DATABASE_SCHEMA.md), [SETUP.md](SETUP.md),
[../.github/copilot-instructions.md](../.github/copilot-instructions.md).
