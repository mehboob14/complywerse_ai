# ComplyVerse GRC Platform - AI Agent Instructions

## Architecture Overview

**Multi-tenant enterprise GRC platform** with schema-per-tenant isolation, modular backend, and Next.js frontend.

- **Backend**: Python 3.11 + FastAPI + SQLAlchemy (PostgreSQL)
- **Frontend**: Next.js 14 + TypeScript + Tailwind CSS + React Query
- **Multi-tenancy**: Schema-per-tenant isolation with subdomain routing (`tenant.domain.com`)
- **Auth**: Cookie-based JWT with tenant context (`tenant_id`, `subdomain`, `schema_name`)

## Project Structure

```
backend/
  grc/
    main.py                    # FastAPI app entry point with all router includes
    models.py                  # 5000+ lines - ALL SQLAlchemy models (multi-tenant, GRC entities)
    permissions.py             # RBAC permission matrix (12 modules × submodules × actions)
    middleware/subdomain.py    # TenantMiddleware - extracts tenant from subdomain/X-Tenant-Slug header
    routers/                   # Legacy routers (frameworks, controls, risks, etc.)
    modules/                   # Feature modules with sub-routers pattern
      evidence/
        router.py              # Module entry point, includes all sub-routers
        routers/
          evidence.py          # CRUD operations
          ai_assessment.py     # AI-powered evidence assessment
          ocr.py               # OCR processing
      erm/                     # Enterprise Risk Management
      governance/              # Policy & document management
      framework_upload/        # Framework parsing & assessment creation
      compliance/              # Compliance assessments
      control_library/         # Unified control mapping
      vuln_management/         # Vulnerability & pentest management
      chatbot/                 # ComplyChat AI assistant
grc-frontend/
  src/
    app/(dashboard)/           # Protected routes (layout groups)
    components/                # Reusable UI components
    lib/api.ts                 # 1200+ lines - ALL API client methods (axios + React Query)
```

## Core Patterns

### **Backend Module Structure**

Each module follows this pattern:

```python
# backend/grc/modules/MODULE_NAME/router.py
from fastapi import APIRouter
from .routers import sub_router_1, sub_router_2

router = APIRouter(prefix="/module-name", tags=["Module Display Name"])
router.include_router(sub_router_1, tags=["Sub Feature 1"])
router.include_router(sub_router_2, tags=["Sub Feature 2"])

# backend/grc/modules/MODULE_NAME/routers/feature.py
from fastapi import APIRouter, Depends, HTTPException
from ....models import Model1, SessionLocal
from ....permissions import require_permission

router = APIRouter(prefix="/feature", tags=["Feature Name"])

@router.get("")
def list_items(db: Session = Depends(get_db), user = Depends(get_current_user)):
    # Tenant filtering using user.tenant_id
    items = db.query(Model).filter(Model.tenant_id == user.tenant_id).all()
    return items
```

**Critical**: Module routers are included in [backend/grc/main.py](backend/grc/main.py) - always check import order to avoid route conflicts (static routes before dynamic).

### **Multi-Tenancy Pattern**

Every request automatically gets tenant context via `TenantMiddleware`:

```python
# In any router
from fastapi import Request
from ..middleware.subdomain import require_tenant

@router.post("/items")
def create_item(request: Request, user = Depends(get_current_user)):
    tenant = require_tenant(request)  # Get tenant from request.state
    item = Item(tenant_id=tenant.id, ...)
    # ALL queries MUST filter by tenant_id for security
    db.query(Item).filter(Item.tenant_id == tenant.id).all()
```

**Tenant identification**: Subdomain (`hbf.domain.com`) OR `X-Tenant-Slug` header (for local dev).

### **Frontend API Pattern**

All API calls go through [grc-frontend/src/lib/api.ts](grc-frontend/src/lib/api.ts):

```typescript
// API client with tenant context injected via interceptor
apiClient.interceptors.request.use((config) => {
  const token = localStorage.getItem("token");
  const tenantSlug = localStorage.getItem("tenant_slug");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  if (tenantSlug) config.headers["X-Tenant-Slug"] = tenantSlug;
  return config;
});

// Feature APIs are grouped by domain
export const evidenceApi = {
  getAll: () => apiClient.get<Evidence[]>("/evidence-mgmt/items"),
  upload: (formData: FormData) =>
    apiClient.post("/evidence-mgmt/items/upload", formData),
};
```

**Proxying**: Next.js rewrites `/api/*` → `http://127.0.0.1:4000/grc/*` (see [grc-frontend/next.config.js](grc-frontend/next.config.js)).

### **Permission Checking**

All protected endpoints use permission decorators:

```python
from ..permissions import require_permission

@router.post("/risks")
def create_risk(
    user = Depends(require_permission("risks.risk_register.create"))
):
    # User automatically has permission checked
    pass
```

Permission matrix defined in [backend/grc/permissions.py](backend/grc/permissions.py): 12 modules × submodules × actions (view, create, edit, delete, approve, publish).

### **AI Integration Pattern**

AI features use OpenAI GPT-4o with deterministic settings for reproducibility:

```python
import openai
import os

def ai_assess_evidence(evidence_text: str, control_text: str):
    response = openai.ChatCompletion.create(
        model="gpt-4o",
        messages=[{"role": "user", "content": prompt}],
        temperature=0.3  # Low temperature for consistency
    )
    return response.choices[0].message.content
```

**7 embedded AI features** (auto-appear, no user trigger): Dashboard AI Insights, Risk Suggestions, Control Recommendations, Evidence Assessment, Policy Drafting, Incident Analysis, Gap Prioritization.

## Development Workflows

### **Run Backend**

```bash
cd backend
python main.py  # Starts on http://localhost:8000
# API docs: http://localhost:8000/grc/docs
```

**Environment variables** (`.env` or export):

- `DATABASE_URL`: PostgreSQL connection string (required)
- `SESSION_SECRET`: JWT secret, 32+ chars (required)
- `OPENAI_API_KEY`: For AI features (optional, features disabled without)

### **Run Frontend**

```bash
cd grc-frontend
npm run dev -- -p 5000  # Starts on http://localhost:5000
```

**Local dev tenant header**: Add `X-Tenant-Slug: your-tenant-slug` to API calls when not using subdomain.

### **Database Initialization**

Models auto-create tables on startup via `init_grc_db()` in [backend/grc/models.py](backend/grc/models.py).

**Seed data**: Run individual seed scripts like `python backend/grc/seed_*.py` for frameworks, controls, etc.

### **Testing**

Backend endpoint testing pattern:

```python
# test_feature.py
import requests
BASE_URL = "http://localhost:4000/grc"
headers = {"Authorization": "Bearer <token>", "X-Tenant-Slug": "test-tenant"}

response = requests.get(f"{BASE_URL}/evidence-mgmt/items", headers=headers)
assert response.status_code == 200
```

See [TESTING_GUIDE.md](TESTING_GUIDE.md) for gap analysis and theme testing specifics.

## Key Conventions

### **Router Prefix Pattern**

- **Module routers**: Include prefix in module's `router.py` (e.g., `/evidence-mgmt`)
- **Sub-routers**: Include prefix in each feature router (e.g., `/items`)
- **Final URL**: `/grc/evidence-mgmt/items`

**Critical**: Avoid doubling prefixes. If module router has `/evidence-mgmt`, don't add it again in [main.py](backend/grc/main.py).

### **UI Theme (February 2026)**

**White/light theme with black text** (no dark slate backgrounds):

```tsx
// Correct pattern
<div className="bg-white border border-gray-300 rounded-lg p-6">
  <h2 className="text-xl font-semibold text-black">Title</h2>
  <div className="bg-slate-50 p-4 rounded">
    {" "}
    {/* Light gray surface */}
    <p className="text-gray-700">Content</p>
  </div>
</div>

// Button active state: blue accent (text-blue-600, border-blue-600)
// Hover states: bg-gray-50 or bg-gray-100 (light gray)
// Font: Poppins across all pages (defined in globals.css)
```

**❌ Never use**: `bg-slate-900`, `bg-slate-800`, `text-white` (except for primary buttons).

### **Evidence AI Assessment (v3.0)**

**Three-tier matching system**:

- `explicit` (90-100%): Direct text match
- `implicit` (70-89%): Indirect address via related mechanisms
- `inferred` (50-69%): Reasonably derived from context

**Cross-framework equivalence**: When evidence satisfies one framework control, AI identifies equivalent controls across ALL other frameworks.

### **Terminology**

- UI displays: "Company" (user-facing)
- API fields/DB: `organization_name` (internal consistency)
- Models use: `tenant_id` (multi-tenancy), not `organization_id`

## Critical Files

| File                                                                       | Purpose                       | Lines | Why Critical                      |
| -------------------------------------------------------------------------- | ----------------------------- | ----- | --------------------------------- |
| [backend/grc/models.py](backend/grc/models.py)                             | ALL database models           | 5100+ | Single source of truth for schema |
| [backend/grc/main.py](backend/grc/main.py)                                 | FastAPI app + router includes | 100   | Router registration order matters |
| [grc-frontend/src/lib/api.ts](grc-frontend/src/lib/api.ts)                 | ALL API client methods        | 1200+ | Complete API surface              |
| [backend/grc/permissions.py](backend/grc/permissions.py)                   | RBAC permission matrix        | 350+  | Fine-grained access control       |
| [backend/grc/middleware/subdomain.py](backend/grc/middleware/subdomain.py) | Tenant identification         | 100   | Multi-tenancy foundation          |
| [grc-frontend/next.config.js](grc-frontend/next.config.js)                 | API proxy rewrites            | 40    | Routes `/api/*` to backend        |

## Common Tasks

### **Add New Module**

1. Create `backend/grc/modules/NEW_MODULE/router.py` (entry point)
2. Create `backend/grc/modules/NEW_MODULE/routers/feature.py` (sub-routers)
3. Add models to [backend/grc/models.py](backend/grc/models.py) with `tenant_id` FK
4. Import and include in [backend/grc/main.py](backend/grc/main.py)
5. Add permissions to [backend/grc/permissions.py](backend/grc/permissions.py)
6. Add API methods to [grc-frontend/src/lib/api.ts](grc-frontend/src/lib/api.ts)
7. Create frontend page in `grc-frontend/src/app/(dashboard)/module-name/`

### **Debug Tenant Issues**

1. Check `X-Tenant-Slug` header present in request (DevTools Network tab)
2. Verify `TenantMiddleware` setting `request.state.tenant` (add logging)
3. Confirm all queries filter by `tenant_id`: `query.filter(Model.tenant_id == user.tenant_id)`
4. Check localStorage has `tenant_slug` in frontend

### **Fix Router Conflicts**

If you see `404` or wrong route matched:

1. Check router include order in [backend/grc/main.py](backend/grc/main.py)
2. Static routes BEFORE dynamic (e.g., `/dashboard` before `/{id}`)
3. Run `curl http://localhost:4000/grc/docs` to see OpenAPI route list
4. Verify prefix not duplicated (module router + main.py)

## External Dependencies

- **PostgreSQL 14+**: Primary database with schema-per-tenant isolation
- **OpenAI API**: GPT-4o for AI features (optional, graceful degradation)
- **Tesseract**: OCR for evidence document parsing (installed system-wide)
- **PyMuPDF/PyPDF2**: PDF text extraction
- **python-docx/python-pptx**: Office document parsing

## Additional Documentation

- [SETUP.md](SETUP.md): Detailed installation and configuration
- [replit.md](replit.md): Full project overview and feature specifications
- [TESTING_GUIDE.md](TESTING_GUIDE.md): Gap analysis and theme testing
- `/grc/docs`: Live OpenAPI documentation (FastAPI auto-generated)

---

**Remember**: Always filter by `tenant_id` for security. Use white theme patterns. Check router order for conflicts.
