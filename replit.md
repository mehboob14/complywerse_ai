# Enterprise GRC Platform

## Overview
A comprehensive, enterprise-grade Governance, Risk, and Compliance (GRC) platform with multi-tenancy support. It integrates 8 regulatory frameworks with a normalized control model, evidence management, enterprise risk management, governance orchestration, policy management, and IT asset inventory. The platform aims to streamline GRC processes, provide a single source of truth for compliance, and enable real-time risk assessment and management for enterprises, offering significant market potential.

## User Preferences
- Backend in Python only
- Modular routers in separate files
- Separate backend and frontend folders
- Dark theme UI (slate-900/slate-800)
- Multi-tenant architecture
- PostgreSQL database

## System Architecture
The platform utilizes a multi-tenant architecture with complete tenant isolation and row-level security. It supports 8 pre-seeded regulatory frameworks through a normalized control model for cross-framework mappings. Key modules include Evidence Management (upload, versioning, AI assessment stubs), Enterprise Risk Management (7 risk categories, configurable scoring, mitigation tracking, 5x5 heatmap), Governance Orchestration (compliance programs, objectives, issues), Policy and Document Management (versioning, approval workflows), and IT Asset Inventory (classification, CIA ratings, control linking). Role-Based Access Control (RBAC) with fine-grained permissions ensures secure access.

**UI/UX Decisions:**
- Frontend built with Next.js 14, TypeScript, and Tailwind CSS.
- Dark theme (slate-900/slate-800) implemented across the UI.
- App Router for streamlined navigation.

**Technical Implementations:**
- **Backend**: Python 3.11, FastAPI, SQLAlchemy.
- **Frontend**: Next.js 14, TypeScript, Tailwind CSS, React Query.
- **Database**: PostgreSQL with a multi-tenant schema.
- **Authentication**: Cookie-based JWT with Secure/SameSite/HttpOnly flags.

**Feature Specifications:**
- **Multi-Tenancy**: Complete isolation and row-level security.
- **Multi-Framework Support**: Integration of 8 regulatory frameworks.
- **Normalized Control Model**: For cross-framework control mapping.
- **Evidence Management**: Upload, versioning, AI assessment, and linking to controls.
- **Enterprise Risk Management (ERM)**: Risk register, mitigation actions, appetite management, KRIs, incidents, and reporting.
- **Governance Orchestration**: Lifecycle management for policies, standards, and procedures with version control and approval workflows.
- **Policy/Document Management**: Comprehensive document lifecycle, versioning, and approval.
- **IT Asset Inventory**: Asset classification, valuation, and linking to GRC elements.
- **Role-Based Access Control (RBAC)**: Fine-grained permissions per tenant.
- **Framework Upload Module**: AI-powered parsing of regulatory documents (PDF/DOCX) for control extraction and alignment.
- **Unified Control Library**: AI-powered control mapping across frameworks with evidence recommendations and gap analysis.

## Unified Control Library Module

The Unified Control Library provides AI-powered control mapping across regulatory frameworks, enabling organizations to identify similar controls, reduce compliance overhead, and optimize evidence collection.

### Key Capabilities
- **Common Control Groups** - Cluster similar controls across frameworks into unified groups
- **AI Similarity Analysis** - Use OpenAI GPT-4o to calculate control similarity scores
- **Control Inheritance** - Track when satisfying one control automatically satisfies others
- **Evidence Recommendations** - AI-suggested evidence types for each control/group
- **Gap Analysis** - Identify unmapped controls, missing evidence, and coverage gaps
- **Framework Comparison** - Side-by-side comparison with AI difference analysis
- **Coverage Matrix** - Visual heatmap of evidence coverage across frameworks
- **Harmonization Reports** - Exportable reports for auditors (Excel/CSV)

### Backend (`/grc/control-library/*`)
```
backend/grc/modules/control_library/
├── router.py              # Main control library router
└── routers/
    ├── groups.py          # Common control groups CRUD, auto-grouping
    ├── ai_mapping.py      # AI similarity analysis, batch processing
    ├── inheritance.py     # Control inheritance relationships
    ├── evidence_recs.py   # AI evidence recommendations
    ├── gap_analysis.py    # Gap identification and dashboard
    ├── comparison.py      # Framework comparison, side-by-side
    ├── coverage.py        # Coverage matrix, heatmap data
    └── reports.py         # Harmonization reports, export
```

### Frontend (`/control-library/*`)
```
grc-frontend/src/app/(dashboard)/control-library/
├── page.tsx                # Control groups list with AI actions
├── [id]/page.tsx           # Group detail with controls, evidence recs
├── gaps/page.tsx           # Gap analysis dashboard
├── compare/page.tsx        # Framework comparison view
├── coverage/page.tsx       # Coverage matrix heatmap
└── evidence/page.tsx       # Evidence suggestions and reuse metrics
```

### Control Library API Endpoints
- `GET /grc/control-library` - Module info
- **Groups**: `/grc/control-library/groups/*` - CRUD, auto-group, generate summary
- **AI Mapping**: `/grc/control-library/ai/*` - Analyze, similarities, suggestions
- **Inheritance**: `/grc/control-library/inheritance/*` - Parent/child relationships
- **Evidence Recs**: `/grc/control-library/evidence-recs/*` - Generate, bulk, priority
- **Gap Analysis**: `/grc/control-library/gaps/*` - Dashboard, unmapped, evidence gaps
- **Comparison**: `/grc/control-library/comparison/*` - Frameworks, side-by-side, differences
- **Coverage**: `/grc/control-library/coverage/*` - Matrix, heatmap, audit savings
- **Reports**: `/grc/control-library/reports/*` - Harmonization, export, executive summary

### Control Library Database Tables
- `grc_common_control_groups` - Unified control clusters with AI summary
- `grc_common_control_group_mappings` - Links controls to groups with confidence
- `grc_control_similarity_mappings` - AI-calculated similarity between controls
- `grc_control_inheritance` - Control inheritance relationships
- `grc_ai_evidence_recommendations` - AI-suggested evidence types
- `grc_control_mapping_analysis` - AI analysis job tracking

## Internal Control Register Module (ERM Sub-module)

The Internal Control Register is a sub-module of Enterprise Risk Management that manages organization-specific internal controls independent of regulatory frameworks. Controls can optionally be mapped to framework controls when needed.

### Key Capabilities
- **Control Register** - Full CRUD for internal controls with unique IDs (IC-001, IC-002, etc.)
- **Workflow Management** - Draft → Pending Approval → Active lifecycle with approval/rejection
- **Control Testing** - Track design and operating effectiveness with test records
- **Departmental Assignment** - Assign controls to departments and owners
- **Escalation Rules** - Define escalation paths and triggers for control failures
- **Risk Linking** - Connect controls to ERM risks they mitigate
- **Framework Mapping** - Optionally map internal controls to framework controls
- **Banking Sample Controls** - 22 pre-seeded real-world banking controls

### Control Categories
- Operations
- Financial
- IT Security
- AML/CFT
- Credit Risk
- Customer Service

### Backend (`/grc/erm/internal-controls/*`)
```
backend/grc/modules/erm/routers/internal_controls.py
```

### Frontend (`/erm/internal-controls/*`)
```
grc-frontend/src/app/(dashboard)/erm/internal-controls/
├── page.tsx           # Control list with filters, dashboard stats
└── [id]/page.tsx      # Control detail with tabs (Details, Testing, Risks, Escalations, Framework Mappings, Workflow)
```

### Internal Control API Endpoints
- `GET /grc/erm/internal-controls` - List controls with filters
- `POST /grc/erm/internal-controls` - Create new control
- `GET /grc/erm/internal-controls/{id}` - Get control details
- `PUT /grc/erm/internal-controls/{id}` - Update control
- `DELETE /grc/erm/internal-controls/{id}` - Delete control
- `POST /grc/erm/internal-controls/{id}/submit` - Submit for approval
- `POST /grc/erm/internal-controls/{id}/approve` - Approve control
- `POST /grc/erm/internal-controls/{id}/reject` - Reject control
- `GET /grc/erm/internal-controls/{id}/tests` - List tests
- `POST /grc/erm/internal-controls/{id}/tests` - Add test
- `GET /grc/erm/internal-controls/{id}/risks` - List linked risks
- `POST /grc/erm/internal-controls/{id}/risks` - Link to risk
- `GET /grc/erm/internal-controls/{id}/escalations` - List escalation rules
- `GET /grc/erm/internal-controls/{id}/framework-links` - Framework mappings
- `GET /grc/erm/internal-controls/dashboard` - Dashboard statistics

### Internal Control Database Tables
- `grc_internal_controls` - Main control register
- `grc_internal_control_tests` - Design/operating effectiveness tests
- `grc_internal_control_risk_links` - Links to ERM risks
- `grc_internal_control_framework_links` - Optional framework mappings
- `grc_internal_control_escalations` - Escalation rules
- `grc_internal_control_workflow_actions` - Workflow audit trail

## External Dependencies
- **PostgreSQL**: Primary database.
- **FastAPI**: Backend API framework.
- **SQLAlchemy**: Python ORM for database interactions.
- **Next.js 14**: Frontend framework.
- **TypeScript**: Frontend language.
- **Tailwind CSS**: Frontend styling.
- **React Query**: Frontend data management.
- **OpenAI (via Replit AI Integrations)**: Used for AI-powered document parsing, control extraction, and evidence quality assessment (GPT-4o vision).