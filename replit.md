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
- `grc_framework_domains` - 47 domains
- `grc_control_objectives` - 236 control objectives
- `grc_framework_controls` - 510 framework-specific controls (comprehensive)
- `grc_framework_sub_controls` - Sub-controls per framework
- `grc_normalized_controls` - Unified controls
- `grc_control_mappings` - Cross-framework mappings
- `grc_required_evidence` - Evidence requirements per control

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
- Full risk register CRUD with 6 categories (strategic, operational, financial, compliance, technology, third_party)
- `GET /dashboard` - Aggregated risk statistics by category, status, score range
- `GET /heatmap` - 5x5 likelihood vs impact heatmap data (toggle inherent/residual)
- `GET /{id}/detail` - Full risk detail with all linked items
- `POST /{id}/link-framework-control` - Link risk to framework control with mitigation effectiveness
- `DELETE /{id}/link-framework-control/{link_id}` - Unlink framework control
- `POST /{id}/link-governance` - Link risk to governance objective with impact level
- `DELETE /{id}/link-governance/{link_id}` - Unlink governance objective
- `POST /{id}/controls`, `DELETE /{id}/controls/{link_id}` - Link/unlink normalized controls
- `POST /{id}/assets`, `DELETE /{id}/assets/{link_id}` - Link/unlink IT assets
- `POST /{id}/evidence`, `DELETE /{id}/evidence/{link_id}` - Link/unlink evidence
- `POST /{id}/treatment` - Update treatment plan
- `POST /{id}/assess` - Perform risk assessment

### Governance (/grc/governance)
- Objectives, exceptions, issues, programs
- `GET /dashboard` - Governance dashboard

### Documents (/grc/documents)
- Policy/document CRUD with versioning
- Approval workflow management

### Assets (/grc/assets)
- IT asset inventory (5 asset types: application, infrastructure, data, cloud, third_party)
- `GET /dashboard` - Asset statistics and metrics
- `GET /{id}/detail` - Full asset detail with linked items
- `POST /{id}/link-framework-control` - Link asset to framework control
- `DELETE /{id}/link-framework-control/{link_id}` - Remove framework control link
- `POST /{id}/link-evidence` - Link asset to evidence
- `DELETE /{id}/link-evidence/{link_id}` - Remove evidence link
- `GET /{id}/coverage-analysis` - Coverage analysis with gaps
- `POST /{id}/assess-risk` - Perform risk assessment

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

### Curated Evidence Library (Jan 1, 2026)
- Added CuratedEvidenceItem model for control-specific evidence requirements
- Created seed_evidence_items.py with 3,688 curated evidence items
- Evidence items have specific titles like "Password Policy GPO Export", "ASV Scan Attestation"
- Each item includes: title, description, artifact_type, format_guidance, frequency, is_required
- Coverage: PCI DSS (8 categories), ISO 27001 (12 categories), NIST CSF (5 categories)
- Evidence linked to sub-controls for precise control-evidence mapping
- Frontend displays evidence with type badges, frequency, and format guidance

### Enterprise Risk Management (Jan 1, 2026)
- 6 risk categories: strategic, operational, financial, compliance, technology, third_party
- Inherent and residual risk scoring (likelihood × impact, 1-5 scale)
- 5x5 risk heatmap visualization with toggle between inherent/residual
- Treatment plans with status tracking (open, in_treatment, mitigated, accepted, closed)
- Link risks to normalized controls, framework controls, IT assets, evidence, governance objectives
- Risk dashboard with aggregated stats by category, status, score range
- Risk detail page with 6 tabs and comprehensive linking modals
- New models: RiskFrameworkControlLink, RiskGovernanceLink
- 15+ API endpoints for complete ERM functionality

### IT Asset Inventory & Valuation (Jan 1, 2026)
- 5 asset types: application, infrastructure, data, cloud, third_party
- CIA ratings (1-5 scale): Confidentiality, Integrity, Availability
- Asset valuation in USD with criticality classification
- Link assets to normalized controls, framework controls, evidence, and risks
- Asset detail page with tabs: Details, Controls, Evidence, Risks, Assessments
- Coverage analysis showing control gaps
- Risk assessment with scoring algorithm
- Dashboard with 6 stat cards: Total, By Type, By Criticality, High Value, Need Assessment, Status
- New models: AssetFrameworkControlLink, AssetEvidenceLink
- 7 new API endpoints for linking and coverage analysis

## User Preferences
- Backend in Python only
- Modular routers in separate files
- Separate backend and frontend folders
- Dark theme UI (slate-900/slate-800)
- Multi-tenant architecture
- PostgreSQL database
