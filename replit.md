# Enterprise GRC Platform

## Overview
A comprehensive, enterprise-grade Governance, Risk, and Compliance (GRC) platform with multi-tenancy support. The platform supports 8 regulatory frameworks with a normalized control model, evidence management, enterprise risk management, governance orchestration, policy management, and IT asset inventory.

## Key Features
- **Multi-Tenancy**: Complete tenant isolation with row-level security
- **Multi-Framework Support**: 8 pre-seeded regulatory frameworks (PCI DSS, ISO 27001, ISO 20000, NIST CSF, SWIFT CSP, CBB, SAMA, SBP)
- **Normalized Control Model**: Single source of truth with cross-framework mappings
- **Evidence Management**: Upload, versioning, review workflow with AI assessment stubs
- **Enterprise Risk Management**: 6 risk categories, scoring matrix, treatment tracking
- **Governance Orchestration**: Compliance programs, objectives, exceptions, issues
- **Policy/Document Management**: Versioning, approval workflows, categorization
- **IT Asset Inventory**: Classification, CIA ratings, valuation, control linkage
- **Role-Based Access Control**: Fine-grained permissions per tenant

## Project Structure
```
├── backend/
│   ├── main.py              # Main FastAPI app (mounts PCI DSS + GRC)
│   ├── models.py            # PCI DSS SQLAlchemy models
│   ├── router.py            # PCI DSS API endpoints
│   └── grc/                  # Enterprise GRC Platform
│       ├── main.py          # GRC FastAPI sub-app
│       ├── models.py        # 37+ SQLAlchemy models
│       ├── schemas.py       # Pydantic schemas
│       ├── seed_frameworks.py # Framework seeding data
│       └── routers/         # Modular API routers
│           ├── auth_router.py
│           ├── tenants_router.py
│           ├── frameworks_router.py
│           ├── controls_router.py
│           ├── evidence_router.py
│           ├── risks_router.py
│           ├── governance_router.py
│           ├── documents_router.py
│           ├── assets_router.py
│           └── dashboard_router.py
├── grc-frontend/            # Next.js 14 frontend
│   └── src/
│       ├── app/            # App router pages
│       │   ├── (dashboard)/ # Protected dashboard routes
│       │   │   ├── dashboard/
│       │   │   ├── frameworks/
│       │   │   ├── controls/
│       │   │   ├── evidence/
│       │   │   ├── risks/
│       │   │   ├── governance/
│       │   │   ├── documents/
│       │   │   └── assets/
│       │   └── login/
│       ├── components/     # React components
│       ├── lib/           # API service layer
│       └── types/         # TypeScript types
└── frontend/              # Legacy React/Vite frontend (PCI DSS)
```

## Tech Stack
- **Backend**: Python 3.11, FastAPI, SQLAlchemy, PostgreSQL
- **Frontend**: Next.js 14, TypeScript, Tailwind CSS, React Query
- **Database**: PostgreSQL with multi-tenant schema
- **Authentication**: Cookie-based JWT with Secure/SameSite/HttpOnly flags

## Database Schema (37+ Tables)

### Multi-Tenancy
- `grc_tenants` - Tenant organizations
- `grc_tenant_users` - User-tenant associations
- `grc_business_units` - Hierarchical business units

### RBAC
- `grc_users` - User accounts
- `grc_roles` - Roles (system and tenant-specific)
- `grc_permissions` - Resource-action permissions
- `grc_role_permissions` - Role-permission mappings
- `grc_user_roles` - User role assignments

### Framework Normalization
- `grc_frameworks` - 8 regulatory frameworks
- `grc_framework_domains` - 36 domains
- `grc_control_objectives` - 65 control objectives
- `grc_framework_controls` - 180 framework-specific controls
- `grc_framework_sub_controls` - 30 sub-controls
- `grc_normalized_controls` - 20 unified controls
- `grc_control_mappings` - 160 cross-framework mappings
- `grc_required_evidence` - 51 evidence requirements

### Evidence Management
- `grc_evidence` - Uploaded evidence items
- `grc_evidence_versions` - Version history
- `grc_evidence_control_mapping` - Control linkage
- `grc_evidence_ai_assessment` - AI confidence scores

### Risk Management
- `grc_risks` - Risk register
- `grc_risk_control_link` - Control linkage
- `grc_risk_evidence_link` - Evidence linkage

### Governance
- `grc_governance_objectives` - Business objectives
- `grc_exceptions` - Control exceptions
- `grc_issues` - Compliance issues
- `grc_compliance_programs` - Framework adoption

### Documents
- `grc_documents` - Policies/procedures/standards
- `grc_document_versions` - Version history
- `grc_document_approval_workflow` - Approval chain
- `grc_document_control_link` - Control linkage

### Assets
- `grc_it_assets` - IT asset inventory
- `grc_asset_control_link` - Control coverage
- `grc_asset_risk_assessment` - Risk assessments

## Supported Frameworks
1. **PCI DSS v4.0** - Payment Card Industry Data Security Standard
2. **ISO 27001:2022** - Information Security Management System
3. **ISO 20000-1:2018** - IT Service Management
4. **NIST CSF 2.0** - Cybersecurity Framework
5. **SWIFT CSP 2024** - Customer Security Programme
6. **CBB 2023** - Central Bank of Bahrain Cyber Security Framework
7. **SAMA 1.0** - Saudi Arabian Monetary Authority Framework
8. **SBP 2023** - State Bank of Pakistan IT/IS Guidelines

## API Endpoints

### Authentication (/grc/auth)
- `POST /register` - User registration
- `POST /login` - User login (sets secure cookie)
- `POST /logout` - User logout
- `GET /me` - Current user info (auto-refreshes token)
- `POST /refresh` - Manual token refresh

### Dashboard (/grc/dashboard)
- `GET /stats` - Real-time compliance statistics
- `GET /compliance/{framework_id}` - Framework compliance details

### Frameworks (/grc/frameworks)
- Full CRUD for frameworks, domains, objectives, controls, sub-controls
- `POST /import` - Bulk framework import
- `GET /{id}/controls` - Hierarchical control view

### Controls (/grc/controls)
- Normalized controls CRUD
- `GET /mappings` - Cross-framework mappings
- `POST /mappings` - Create control mapping

### Evidence (/grc/evidence)
- Upload, versioning, review workflow
- `POST /assess` - AI assessment (stub)
- `GET /gaps` - Gap detection

### Risks (/grc/risks)
- Risk register CRUD
- `GET /dashboard` - Risk dashboard
- `GET /heatmap` - Risk heatmap data

### Governance (/grc/governance)
- Objectives, exceptions, issues, programs
- `GET /dashboard` - Governance dashboard

### Documents (/grc/documents)
- Policy/document CRUD with versioning
- Approval workflow management

### Assets (/grc/assets)
- IT asset inventory
- Control linkage, risk assessments

## Security Features
- Cookie-based JWT with Secure/SameSite/HttpOnly flags
- Required SESSION_SECRET environment variable
- Token refresh mechanism (6-hour refresh window)
- Multi-tenant data isolation
- Tenant scoping on all queries

## Running the Application
- Backend: `cd backend && python main.py` (port 8000)
- Frontend: `cd grc-frontend && npm run dev` (port 5000)

## Environment Variables
- `DATABASE_URL` - PostgreSQL connection string
- `SESSION_SECRET` - Required JWT signing key (must be set)

## Recent Changes (Jan 1, 2026)
- Created enterprise GRC platform with multi-tenancy
- Added 8 regulatory frameworks with full control hierarchy
- Implemented normalized control model with cross-framework mappings
- Built Next.js frontend with TypeScript and Tailwind CSS
- Added security hardening (cookie security, tenant isolation)
- Real-time compliance scoring based on evidence coverage
- 10 modular API routers with 100+ endpoints

### Certification Journey System (Jan 1, 2026)
- Added CertificationJourney, ControlImplementation, ImplementationEvidence models
- Created certification_router.py with 13 endpoints for guided certification
- Implemented guided implementation wizard with 6-phase stepper
- Evidence upload with simulated AI confidence scoring (0-100%)
- Multi-control evidence matching (one evidence can satisfy multiple controls)
- Gap analysis endpoint showing missing evidence and pending controls
- Custom framework creation modal for institutional frameworks
- Progress tracking by domain with real-time completion percentages

## User Preferences
- Backend in Python only
- Modular routers in separate files
- Separate backend and frontend folders
- Dark theme UI (slate-900/slate-800)
- Multi-tenant architecture
- PostgreSQL database
