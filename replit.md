# Enterprise GRC Platform

## Overview
A comprehensive, enterprise-grade Governance, Risk, and Compliance (GRC) platform with multi-tenancy support. The platform integrates 8 regulatory frameworks with a normalized control model, evidence management, enterprise risk management, governance orchestration, policy management, and IT asset inventory. Its purpose is to streamline GRC processes, provide a single source of truth for compliance, and enable real-time risk assessment and management for enterprises.

## User Preferences
- Backend in Python only
- Modular routers in separate files
- Separate backend and frontend folders
- Dark theme UI (slate-900/slate-800)
- Multi-tenant architecture
- PostgreSQL database

## System Architecture
The platform features a multi-tenant architecture with complete tenant isolation and row-level security. It supports 8 pre-seeded regulatory frameworks through a normalized control model, allowing for cross-framework mappings. Evidence management includes upload, versioning, and review workflows with AI assessment stubs. Enterprise Risk Management (ERM) covers 7 risk categories with sub-categories, configurable scoring matrices, treatment tracking with mitigation actions, risk appetite management with tolerance thresholds, and a 5x5 risk heatmap. Governance orchestration manages compliance programs, objectives, exceptions, and issues. Policy and document management include versioning, approval workflows, and categorization. An IT asset inventory classifies assets, assigns CIA ratings, values assets, and links them to controls. The system utilizes Role-Based Access Control (RBAC) with fine-grained permissions per tenant.

**Technical Implementations:**
- **Backend**: Python 3.11, FastAPI, SQLAlchemy, PostgreSQL.
- **Frontend**: Next.js 14, TypeScript, Tailwind CSS, React Query.
- **Database**: PostgreSQL with a multi-tenant schema (37+ tables).
- **Authentication**: Cookie-based JWT with Secure/SameSite/HttpOnly flags.
- **UI/UX**: Next.js 14 frontend with a dark theme (slate-900/slate-800) and an App Router for navigation.

**Key Features:**
- Multi-Tenancy
- Multi-Framework Support (8 regulatory frameworks)
- Normalized Control Model
- Evidence Management
- Enterprise Risk Management (ERM Module)
- Governance Orchestration
- Policy/Document Management
- IT Asset Inventory
- Role-Based Access Control

## ERM Module Structure

The ERM (Enterprise Risk Management) module is organized as a standalone module:

### Backend (`/grc/erm/*`)
```
backend/grc/modules/erm/
├── router.py              # Main ERM router
└── routers/
    ├── risks.py           # Risk register CRUD, heatmap, dashboard, close/reopen, aging
    ├── kris.py            # Key Risk Indicators
    ├── incidents.py       # Risk incidents
    ├── reviews.py         # Review workflow
    ├── dependencies.py    # Risk dependencies
    ├── reports.py         # Reporting & analytics
    ├── mitigation_actions.py  # Mitigation action tracking
    ├── scales.py          # Configurable likelihood/impact scales
    └── appetite.py        # Risk appetite management & tolerance breaches
```

### Frontend (`/erm/*`)
```
grc-frontend/src/app/(dashboard)/erm/
├── layout.tsx              # Shared layout with tab navigation
├── page.tsx                # ERM overview dashboard
├── risks/page.tsx          # Risk register (with sub-categories, business owner, departments)
├── mitigation-actions/page.tsx  # Mitigation action tracking & status
├── appetite/page.tsx       # Risk appetite config & tolerance breaches
├── kris/page.tsx           # Key Risk Indicators
├── incidents/page.tsx      # Incidents
├── reviews/page.tsx        # Review workflow
├── dependencies/page.tsx   # Dependencies
└── reports/page.tsx        # Reporting
```

### ERM API Endpoints
- `GET /grc/erm` - Module info
- **Risks**: `/grc/erm/risks/*` - CRUD, dashboard, heatmap, linking, close/reopen, aging
- **Mitigation Actions**: `/grc/erm/mitigation-actions/*` - CRUD, complete, overdue tracking
- **Appetite**: `/grc/erm/appetite/*` - Config, with-stats, breaches, seed-defaults
- **KRIs**: `/grc/erm/kris/*` - Create, measure, alerts, trends
- **Incidents**: `/grc/erm/incidents/*` - CRUD, dashboard
- **Reviews**: `/grc/erm/reviews/*` - Schedule, approve, overdue
- **Dependencies**: `/grc/erm/dependencies/*` - Cascade analysis
- **Reports**: `/grc/erm/reports/*` - Executive, board, department, audit
- **Scales**: `/grc/erm/scales/*` - Configurable likelihood/impact scales

### ERM Database Tables
- `grc_risks` - Risk register (with sub_category, business_owner, departments, closure workflow)
- `grc_risk_mitigation_actions` - Mitigation action tracking
- `grc_risk_audit_finding_links` - Links between risks and audit findings
- `grc_likelihood_impact_scales` - Configurable scoring scales
- `grc_risk_kris` - Key Risk Indicators
- `grc_risk_kri_measurements` - KRI measurement history
- `grc_risk_incidents` - Risk incidents/events
- `grc_risk_reviews` - Review workflow
- `grc_risk_score_history` - Score change history
- `grc_risk_dependencies` - Risk-to-risk dependencies
- `grc_risk_appetite_config` - Risk appetite configuration (with tolerance thresholds)
- `grc_risk_reports` - Generated reports

## Governance Module Structure

The Governance module provides full lifecycle management for governance artifacts with version control, approval workflows, and cross-module integration.

### Governance Document Types
- **Policy** - High-level organizational directives
- **Standard** - Technical or operational requirements
- **Procedure** - Step-by-step instructions
- **Guideline** - Recommended practices
- **Charter** - Committee/team authorization documents
- **Framework** - Structural governance documents

### Governance Document Statuses
- `draft` - Initial creation
- `pending_review` - Under review
- `pending_approval` - Awaiting approval
- `approved` - Approved by designated approvers
- `published` - Published and effective
- `expired` - Past expiry date
- `archived` - No longer active
- `exception_applied` - Has exception applied

### Backend (`/grc/governance/*`)
```
backend/grc/modules/governance/
├── router.py              # Main governance router
└── routers/
    ├── documents.py       # Document CRUD, filtering, hierarchy, bulk operations
    ├── versions.py        # Version control, compare, rollback
    ├── workflows.py       # Approval workflow management
    ├── reviews.py         # Review scheduling, overdue tracking
    ├── mappings.py        # Cross-module links (risks, controls, assets)
    └── dashboard.py       # Executive KPIs, stats, analytics
```

### Frontend (`/governance/*`)
```
grc-frontend/src/app/(dashboard)/governance/
├── layout.tsx              # Tabbed navigation (Overview, Documents, Workflows, Reviews)
├── page.tsx                # Executive dashboard with KPIs
├── documents/page.tsx      # Document library with filters, CRUD
├── workflows/page.tsx      # Pending approvals, approve/reject actions
└── reviews/page.tsx        # Review calendar, overdue alerts
```

### Governance API Endpoints
- `GET /grc/governance` - Module info
- **Documents**: `/grc/governance/documents/*` - CRUD, filtering, hierarchy, bulk operations
- **Type-specific**: `/grc/governance/documents/policies`, `/standards`, `/procedures`, `/guidelines`, `/charters`, `/frameworks`
- **Versions**: `/grc/governance/versions/*` - Version history, compare, rollback
- **Workflows**: `/grc/governance/workflows/*` - Pending approvals, approve, reject, delegate
- **Reviews**: `/grc/governance/reviews/*` - Upcoming, overdue, complete review
- **Mappings**: `/grc/governance/mappings/*` - Link to risks, controls, assets, regulatory
- **Dashboard**: `/grc/governance/dashboard/*` - Summary stats, KPIs

### Governance Database Tables
- `grc_governance_documents` - Document library with hierarchy, lifecycle, regulatory scope
- `grc_governance_document_versions` - Version history with change tracking
- `grc_document_reviewers` - Assigned reviewers/approvers
- `grc_document_approval_steps` - Multi-step approval workflow
- `grc_document_audit_logs` - Complete audit trail
- `grc_document_control_links` - Links to normalized controls
- `grc_document_risk_links` - Links to risks
- `grc_document_regulatory_links` - Links to regulatory requirements
- `grc_document_asset_links` - Links to IT assets

## External Dependencies
- **PostgreSQL**: Primary database for all application data, including multi-tenant schemas.
- **FastAPI**: Python web framework used for building the backend API.
- **SQLAlchemy**: Python SQL toolkit and Object-Relational Mapper (ORM) for database interactions.
- **Next.js 14**: React framework for the frontend application.
- **TypeScript**: Superset of JavaScript used for frontend development.
- **Tailwind CSS**: Utility-first CSS framework for styling the frontend.
- **React Query**: Library for data fetching, caching, and state management in React applications.