# ComplyVerse GRC Platform - Local Setup Guide

## Table of Contents
- [Prerequisites](#prerequisites)
- [Project Structure](#project-structure)
- [Backend Setup](#backend-setup)
- [Frontend Setup](#frontend-setup)
- [Environment Variables](#environment-variables)
- [Running the Application](#running-the-application)
- [API Routes Reference](#api-routes-reference)
- [Frontend Routes Reference](#frontend-routes-reference)
- [Proxy Configuration](#proxy-configuration)
- [Multi-Tenant Architecture](#multi-tenant-architecture)
- [Default Credentials](#default-credentials)

---

## Prerequisites

- **Python** 3.11+
- **Node.js** 18+ and npm
- **PostgreSQL** 14+ (running locally or remote)

---

## Project Structure

```
complyverse/
├── backend/                    # Python FastAPI backend
│   ├── main.py                 # Entry point - runs on port 8000
│   ├── requirements.txt        # Python dependencies
│   ├── uploads/                # File uploads directory
│   └── grc/                    # Core GRC application
│       ├── main.py             # FastAPI app with all routers
│       ├── models.py           # SQLAlchemy models + DB init
│       ├── schemas.py          # Pydantic schemas
│       ├── permissions.py      # RBAC permission definitions
│       ├── tenant_manager.py   # Multi-tenant schema management
│       ├── tenant_models.py    # Tenant-specific models
│       ├── middleware/
│       │   └── subdomain.py    # Tenant identification middleware
│       ├── routers/            # Core API routers
│       │   ├── auth_router.py
│       │   ├── admin_router.py
│       │   ├── frameworks_router.py
│       │   ├── controls_router.py
│       │   ├── evidence_router.py
│       │   ├── risks_router.py
│       │   ├── governance_router.py
│       │   ├── documents_router.py
│       │   ├── assets_router.py
│       │   ├── dashboard_router.py
│       │   ├── certification_router.py
│       │   ├── advanced_erm_router.py
│       │   ├── compliance_assessments_router.py
│       │   └── tenants_router.py
│       ├── modules/            # Feature modules
│       │   ├── erm/            # Enterprise Risk Management
│       │   ├── governance/     # Governance & Policy Management
│       │   ├── framework_upload/ # Framework Upload & Parsing
│       │   ├── compliance/     # Compliance Module
│       │   ├── evidence/       # Evidence Management
│       │   ├── control_library/ # Unified Control Library
│       │   └── vuln_management/ # Vulnerability Management
│       ├── scripts/            # Utility scripts
│       └── seed_*.py           # Database seed data files
│
├── grc-frontend/               # Next.js 14 frontend
│   ├── package.json
│   ├── next.config.js          # Proxy rewrites to backend
│   ├── tailwind.config.ts
│   ├── tsconfig.json
│   └── src/
│       ├── app/
│       │   ├── layout.tsx      # Root layout
│       │   ├── globals.css     # Global styles (Poppins font, theme)
│       │   ├── login/          # Login page
│       │   ├── register/       # Organization registration
│       │   └── (dashboard)/    # Protected dashboard pages
│       ├── components/
│       │   ├── layout/         # Header, Sidebar
│       │   ├── ui/             # Reusable UI components
│       │   ├── charts/         # Chart components
│       │   └── dashboard/      # Dashboard-specific components
│       ├── lib/
│       │   └── api.ts          # API client (axios)
│       └── types/
│           └── index.ts        # TypeScript type definitions
│
├── docs/                       # Documentation
├── SETUP.md                    # This file
└── replit.md                   # Project overview and architecture
```

---

## Backend Setup

### 1. Create a virtual environment

```bash
cd backend
python -m venv venv
source venv/bin/activate        # Linux/Mac
# venv\Scripts\activate         # Windows
```

### 2. Install dependencies

```bash
pip install -r requirements.txt
```

### 3. Set up PostgreSQL

Create a database:

```sql
CREATE DATABASE complyverse_grc;
```

### 4. Configure environment variables

Create a `.env` file in the `backend/` directory or export them:

```bash
export DATABASE_URL="postgresql://username:password@localhost:5432/complyverse_grc"
export SESSION_SECRET="your-secret-key-here-min-32-chars"
```

See [Environment Variables](#environment-variables) for all options.

### 5. Run the backend

```bash
cd backend
python main.py
```

The backend will start on `http://localhost:8000`. The GRC API is available at `http://localhost:8000/grc/`.

API documentation: `http://localhost:8000/grc/docs`

---

## Frontend Setup

### 1. Install dependencies

```bash
cd grc-frontend
npm install
```

### 2. Configure the API proxy

The frontend proxies API calls to the backend. The proxy is configured in `grc-frontend/next.config.js`:

```js
// Default proxy configuration
{
  source: '/api/:path*',
  destination: 'http://localhost:8000/grc/:path*',
}
```

If your backend runs on a different host/port, update the `destination` URL in `next.config.js`.

### 3. Run the frontend

```bash
cd grc-frontend
npm run dev -- -p 5000
```

The frontend will start on `http://localhost:5000`.

---

## Environment Variables

### Required

| Variable | Description | Example |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://user:pass@localhost:5432/complyverse_grc` |
| `SESSION_SECRET` | JWT signing secret (32+ chars) | `my-super-secret-key-at-least-32-characters` |

### Optional

| Variable | Description | Default |
|----------|-------------|---------|
| `OPENAI_API_KEY` | OpenAI API key for AI features | (AI features disabled without this) |
| `SMTP_HOST` | SMTP server for email notifications | None |
| `SMTP_PORT` | SMTP port | `587` |
| `SMTP_USER` | SMTP username | None |
| `SMTP_PASSWORD` | SMTP password | None |
| `SMTP_FROM_EMAIL` | Sender email address | `noreply@grc-platform.com` |

### Frontend Environment (Optional)

Create a `.env.local` file in `grc-frontend/`:

| Variable | Description | Default |
|----------|-------------|---------|
| `NEXT_PUBLIC_API_BASE_URL` | Override API base URL | `/api` (proxied to backend) |

---

## Running the Application

### Start both services

**Terminal 1 - Backend:**
```bash
cd backend
python main.py
# Runs on http://localhost:8000
```

**Terminal 2 - Frontend:**
```bash
cd grc-frontend
npm run dev -- -p 5000
# Runs on http://localhost:5000
```

Then open `http://localhost:5000` in your browser.

---

## API Routes Reference

All backend API routes are served under the `/grc` mount point. The frontend proxies `/api/*` to `/grc/*`.

### Authentication
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/auth/register-organization` | Register new organization + admin user |
| POST | `/auth/tenant-login` | Login to a specific tenant |
| GET | `/auth/tenant-me` | Get current user info with tenant context |
| POST | `/auth/logout` | Logout (clear cookies) |

### Administration
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/admin/organization` | Get organization profile |
| PUT | `/admin/organization` | Update organization profile |
| GET | `/admin/users` | List tenant users |
| POST | `/admin/users` | Create new user |
| GET | `/admin/roles` | List tenant roles |
| POST | `/admin/roles` | Create new role |
| PUT | `/admin/roles/{id}` | Update role permissions |
| GET | `/admin/audit-logs` | View audit logs |

### Dashboard
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/dashboard/stats` | Dashboard statistics |
| GET | `/dashboard/ai-insights` | AI-generated compliance insights |

### Frameworks
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/frameworks` | List regulatory frameworks |
| POST | `/frameworks` | Create framework |
| GET | `/frameworks/{id}` | Get framework details |
| DELETE | `/frameworks/{id}` | Delete framework |

### Framework Upload & Parsing
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/framework-upload/upload` | Upload framework document |
| POST | `/framework-upload/parse/{id}` | Parse uploaded framework |
| GET | `/framework-upload/alignment` | Get framework alignment data |
| GET | `/framework-upload/assessment` | Get framework assessment |

### Controls
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/controls` | List normalized controls |
| POST | `/controls` | Create control |
| GET | `/controls/{id}` | Get control details |
| PUT | `/controls/{id}` | Update control |
| GET | `/controls/ai-recommendations` | AI control recommendations |

### Control Library
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/control-library/groups` | List control groups |
| GET | `/control-library/coverage` | Control coverage analysis |
| GET | `/control-library/gaps` | Gap analysis |
| GET | `/control-library/compare` | Cross-framework comparison |
| GET | `/control-library/ai-mapping` | AI-powered control mapping |
| POST | `/control-library/ai-mapping` | Generate AI mappings |

### Evidence Management
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/evidence` | List evidence items |
| POST | `/evidence` | Upload evidence |
| GET | `/evidence/{id}` | Get evidence details |
| POST | `/evidence-mgmt/ai/quick-assess` | AI quick assessment |
| GET | `/evidence-mgmt/audit-packages` | Audit packages |
| POST | `/evidence-mgmt/control-links` | Link evidence to controls |

### Risk Management
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/risks` | List risks |
| POST | `/risks` | Create risk |
| GET | `/risks/{id}` | Get risk details |
| PUT | `/risks/{id}` | Update risk |

### Enterprise Risk Management (ERM)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/erm/risks` | ERM risk register |
| GET | `/erm/kris` | Key Risk Indicators |
| GET | `/erm/incidents` | Risk incidents |
| POST | `/erm/incidents/ai-analyze` | AI incident analysis |
| GET | `/erm/appetite` | Risk appetite settings |
| GET | `/erm/mitigation-actions` | Mitigation actions |
| GET | `/erm/internal-controls` | Internal controls register |
| GET | `/erm/rcsa` | RCSA module |
| GET | `/erm/reviews` | Risk reviews |
| GET | `/erm/reports` | ERM reports |

### Governance & Policy Management
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/governance/documents` | List governance documents |
| POST | `/governance/documents` | Create document |
| POST | `/governance/documents/ai-draft` | AI draft policy |
| GET | `/governance/attestations` | List attestations |
| GET | `/governance/committees` | List committees |
| GET | `/governance/committees/{id}` | Committee details |
| GET | `/governance/committees/{id}/meetings` | Committee meetings |
| GET | `/governance/regulatory-changes` | Regulatory changes |
| GET | `/governance/regulatory-feeds` | Regulatory feeds |
| GET | `/governance/reviews` | Document reviews |
| GET | `/governance/workflows` | Approval workflows |
| GET | `/governance/dashboard` | Governance dashboard |

### Compliance Assessments
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/compliance/assessments` | List assessments |
| POST | `/compliance/assessments` | Create assessment |
| POST | `/compliance/assessments/upload` | Upload assessment file |
| GET | `/compliance/policies/statements` | Compliance statements |

### Certifications
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/certifications` | List certifications |
| GET | `/certifications/{id}` | Certification details |
| GET | `/certifications/{id}/phases` | Certification phases |

### IT Assets
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/assets` | List IT assets |
| POST | `/assets` | Create asset |
| GET | `/assets/{id}` | Get asset details |
| PUT | `/assets/{id}` | Update asset |

### Vulnerability Management
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/vuln-management/vulnerabilities` | List vulnerabilities |
| POST | `/vuln-management/vulnerabilities` | Create vulnerability |
| GET | `/vuln-management/dashboard` | Vulnerability dashboard |
| GET | `/vuln-management/sla` | SLA configuration |
| GET | `/vuln-management/departments` | Department management |
| GET | `/vuln-management/reports` | Vulnerability reports |
| POST | `/vuln-management/ai-analysis` | AI vulnerability analysis |

### Advanced ERM
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/advanced-erm/scales` | Risk scales |
| GET | `/advanced-erm/dependencies` | Risk dependencies |

### Tenants
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/tenants` | List tenants |
| GET | `/tenants/{id}` | Get tenant details |

---

## Frontend Routes Reference

### Public Pages
| Route | Description |
|-------|-------------|
| `/login` | Tenant login page |
| `/register` | Organization registration (multi-step wizard) |

### Dashboard
| Route | Description |
|-------|-------------|
| `/dashboard` | Main dashboard with stats, charts, AI insights |

### Frameworks
| Route | Description |
|-------|-------------|
| `/frameworks` | Regulatory frameworks list |
| `/frameworks/[id]` | Framework detail with controls |
| `/frameworks/overview/[id]` | Framework overview (certification vs compliance) |
| `/framework-upload` | Upload new framework |
| `/framework-upload/controls` | Parsed controls review |
| `/framework-upload/alignment` | Cross-framework alignment |
| `/framework-upload/assessment` | Framework assessment |

### Controls
| Route | Description |
|-------|-------------|
| `/controls` | Normalized controls list |
| `/control-library` | Unified control library |
| `/control-library/[id]` | Control detail |
| `/control-library/compare` | Cross-framework comparison |
| `/control-library/coverage` | Control coverage view |
| `/control-library/evidence` | Evidence requirements |
| `/control-library/gaps` | Gap analysis |

### Evidence
| Route | Description |
|-------|-------------|
| `/evidence` | Evidence repository |
| `/evidence/[id]` | Evidence detail with AI assessment |
| `/evidence/coverage` | Evidence coverage analysis |
| `/evidence/audit-packages` | Audit packages |
| `/evidence-requirements` | AI-generated evidence requirements |

### Risk Management
| Route | Description |
|-------|-------------|
| `/risks` | Risk register |
| `/risks/[id]` | Risk detail |
| `/risks/advanced` | Advanced risk analysis |
| `/risks/rcsa` | RCSA module |
| `/risks/rcsa/assessments` | RCSA assessments |
| `/risks/rcsa/campaigns` | RCSA campaigns |
| `/risks/rcsa/findings` | RCSA findings |
| `/risks/rcsa/templates` | RCSA templates |
| `/risks/rcsa/approvals` | RCSA approvals |

### ERM
| Route | Description |
|-------|-------------|
| `/erm` | ERM dashboard |
| `/erm/risks` | ERM risk register |
| `/erm/incidents` | Risk incidents |
| `/erm/kris` | Key Risk Indicators |
| `/erm/appetite` | Risk appetite management |
| `/erm/mitigation-actions` | Mitigation action tracking |
| `/erm/internal-controls` | Internal controls register |
| `/erm/internal-controls/[id]` | Internal control detail |
| `/erm/reviews` | Risk reviews |
| `/erm/dependencies` | Risk dependencies |
| `/erm/reports` | ERM reports |

### Governance
| Route | Description |
|-------|-------------|
| `/governance` | Governance dashboard |
| `/governance/documents` | Policy/document management |
| `/governance/approvals` | Pending approvals |
| `/governance/attestations` | Attestation tracking |
| `/governance/attestations/campaigns` | Attestation campaigns |
| `/governance/attestations/complete/[id]` | Complete attestation |
| `/governance/committees` | Committee management |
| `/governance/committees/[id]` | Committee detail |
| `/governance/committees/meetings/[id]` | Meeting detail |
| `/governance/committees/actions` | Oversight actions |
| `/governance/regulatory-changes` | Regulatory change tracking |
| `/governance/regulatory-changes/[id]` | Regulatory change detail |
| `/governance/regulatory-feeds` | Regulatory feeds |
| `/governance/reviews` | Document reviews |
| `/governance/reviews/calendar` | Review calendar |
| `/governance/workflows` | Workflow management |
| `/governance/mappings` | Policy-to-control mappings |

### Compliance
| Route | Description |
|-------|-------------|
| `/compliance` | Compliance dashboard |
| `/compliance/assessments` | Compliance assessments |
| `/compliance/assessments/[id]` | Assessment detail |
| `/compliance/assessments/approvals` | Assessment approvals |
| `/compliance/statements` | Compliance statements |

### Documents
| Route | Description |
|-------|-------------|
| `/documents` | Document management |

### IT Assets
| Route | Description |
|-------|-------------|
| `/assets` | IT asset inventory |
| `/assets/[id]` | Asset detail |

### Vulnerabilities
| Route | Description |
|-------|-------------|
| `/vulnerabilities` | Vulnerability list |
| `/vulnerabilities/[id]` | Vulnerability detail |
| `/vulnerabilities/dashboard` | Vulnerability dashboard |
| `/vulnerabilities/sla` | SLA configuration |
| `/vulnerabilities/departments` | Department management |
| `/vulnerabilities/reports` | Vulnerability reports |

### Administration
| Route | Description |
|-------|-------------|
| `/admin` | Admin dashboard |
| `/admin/organization` | Organization profile |
| `/admin/users` | User management |
| `/admin/roles` | Role & permission management |
| `/admin/audit-logs` | Audit log viewer |

---

## Proxy Configuration

The Next.js frontend proxies all API calls to the FastAPI backend:

```
Browser Request          Next.js Proxy          FastAPI Backend
─────────────────────────────────────────────────────────────
GET /api/frameworks  →   Rewritten to    →   GET /grc/frameworks
POST /api/auth/login →   Rewritten to    →   POST /grc/auth/tenant-login
GET /api/dashboard   →   Rewritten to    →   GET /grc/dashboard/stats
```

### How it works

1. The frontend makes requests to `/api/*` (configured in `grc-frontend/src/lib/api.ts`)
2. Next.js rewrites these to `http://localhost:8000/grc/*` (configured in `grc-frontend/next.config.js`)
3. The backend serves the GRC API at the `/grc` mount point (configured in `backend/main.py`)

### Changing the backend URL

If your backend runs on a different host or port, update `grc-frontend/next.config.js`:

```js
{
  source: '/api/:path*',
  destination: 'http://YOUR_BACKEND_HOST:YOUR_PORT/grc/:path*',
}
```

---

## Multi-Tenant Architecture

### How It Works

1. Each organization gets an isolated PostgreSQL schema (e.g., `tenant_acme`, `tenant_hbf`)
2. A master tenant registry in the `public` schema stores organization metadata
3. Tenant identification is done via:
   - **Subdomain**: `acme.yourdomain.com` (production)
   - **X-Tenant-Slug header**: For development/testing

### Tenant Identification in Development

When running locally, use the `X-Tenant-Slug` header to identify the tenant:

```bash
curl -H "X-Tenant-Slug: acme" http://localhost:8000/grc/dashboard/stats
```

Or configure the frontend to send the header via `grc-frontend/src/lib/api.ts`.

### Registration Flow

1. User registers at `/register` with organization details
2. Backend creates a new PostgreSQL schema for the tenant
3. Seeds default roles and permissions
4. Creates admin user with full access
5. Returns login credentials and tenant subdomain

---

## Default Credentials

After registering an organization, the admin account is created with the credentials you provide during registration. There are no hardcoded default credentials.

### Registration Steps

1. Go to `http://localhost:5000/register`
2. Step 1: Enter email (corporate domain only), password, and name
3. Step 2: Enter organization name, legal entity, industry, company size
4. Step 3: Select geography, regulatory scope, contact phone
5. Step 4: Review and submit

After registration, login at `http://localhost:5000/login` with:
- **Subdomain/Slug**: The subdomain assigned during registration
- **Username**: The email you registered with
- **Password**: The password you chose

---

## Troubleshooting

### Backend won't start
- Ensure PostgreSQL is running and `DATABASE_URL` is correct
- Check that `SESSION_SECRET` is set
- Run `pip install -r requirements.txt` to install all dependencies

### Frontend shows "Cannot connect to API"
- Ensure the backend is running on port 8000
- Check `next.config.js` proxy destination matches your backend URL
- Verify no firewall blocking localhost connections

### AI features not working
- Set `OPENAI_API_KEY` environment variable with a valid OpenAI API key
- AI features gracefully degrade when the key is not set

### Database migration
- The backend auto-creates tables on startup via `init_grc_db()`
- No manual migration steps needed for first setup
