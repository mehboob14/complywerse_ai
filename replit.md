# PCI DSS Lifecycle Application

## Overview
A comprehensive, fully dynamic PCI DSS (Payment Card Industry Data Security Standard) compliance lifecycle management application. The application enables organizations to track, manage, and demonstrate compliance with PCI DSS v4.0 requirements through a 7-phase workflow with real-time evidence collection and validation.

## Key Features
- **Dynamic Compliance Tracking**: Real-time compliance percentage based on evidence status
- **Evidence Upload Workflow**: IT/Security uploads evidence → Auditor reviews → Accept/Reject
- **Auto-Generated Findings**: Rejected evidence automatically creates compliance findings
- **Risk Management**: Business owners can approve/reject residual compliance risks
- **Role-Based Views**: Different views for IT/Security Team, QSA Auditor, and Business Owner
- **User Authentication**: Login/Register with JWT-based session management
- **Admin Panel**: Full CRUD management for phases, tasks, deliverables, requirements, sub-requirements, required evidence, and users
- **Evidence Comparison**: Visual dashboard showing required vs uploaded evidence with filtering

## Project Structure
```
├── backend/              # Python FastAPI backend
│   ├── main.py          # Application entry point
│   ├── models.py        # SQLAlchemy database models
│   ├── router.py        # All API endpoints (single file per user requirement)
│   └── seed_data.py     # Database seeding with 130 evidence items
├── frontend/             # React + Vite frontend
│   └── src/
│       ├── pages/       # Dashboard, Requirements, Findings, RiskRegister
│       ├── App.jsx      # Main app with routing
│       └── App.css      # Dark theme styling
└── uploads/             # Evidence file storage
```

## Tech Stack
- **Backend**: Python, FastAPI, SQLAlchemy, PostgreSQL/SQLite
- **Frontend**: React, Vite, React Router, Axios
- **Styling**: CSS with GitHub-inspired dark theme (#0d1117 background)

## Database Models
- **Phase**: 7 lifecycle phases with tasks and deliverables
- **Requirement**: 12 PCI DSS v4.0 requirements
- **SubRequirement**: 63 sub-requirements across all 12 requirements
- **RequiredEvidence**: 130 evidence items (policies, configs, logs, screenshots)
- **EvidenceSubmission**: User-uploaded evidence with review status
- **Finding**: Auto-created from rejected evidence
- **Risk**: Residual risks requiring business approval
- **CDESystem**: 24 in-scope Cardholder Data Environment systems
- **SecurityScan**: ASV scans, penetration tests, vulnerability scans
- **ComplianceAssessment**: Self-assessments and QSA audits

## Compliance Workflow

### Evidence Collection Flow
1. IT/Security team views required evidence per sub-requirement
2. IT/Security uploads evidence files
3. Evidence status = "pending_review"
4. QSA Auditor reviews and accepts/rejects evidence
5. If accepted → sub-requirement status improves
6. If rejected → Finding auto-created for remediation

### Compliance Calculation
- Sub-requirement status based on evidence acceptance:
  - **Compliant**: All required evidence accepted
  - **Partial**: Some evidence accepted
  - **Not Started**: No evidence accepted
- Overall compliance = weighted average across all sub-requirements

### Phase Approval Workflow (Governance Enforced)
Phases are strictly sequential and require Admin or Business Owner approval before advancing:

1. **Complete Tasks**: Check off all tasks in the current phase
2. **Auto-Request Approval**: When all tasks complete, approval_status changes to "pending_approval"
3. **Evidence Gate**: Approval blocked until all linked requirements have accepted evidence
4. **Admin/Business Owner Approval**: Only Admin or Business Owner can approve phases (separation of duties)
5. **Advance**: After approval, "Advance to Next Phase" button appears
6. **Task Regression**: If any task is unchecked after approval, approval is revoked

**Phase Fields**:
- `approval_status`: not_required | pending_approval | approved
- `approved_by`: Name of approver
- `approved_at`: Timestamp of approval

**PhaseRequirement Model**: Links phases to requirements. Admins can configure which requirements must have accepted evidence before a phase can be approved.

**Deliverables**: Each phase has deliverables shown when tasks are complete

## API Endpoints (Single router.py)

### Phases
- `GET /api/phases` - List all phases with approval status
- `GET /api/phases/current` - Get current phase
- `PATCH /api/phases/{id}/set-current` - Set active phase
- `POST /api/phases/{id}/request-approval` - Request approval (auto-triggered when tasks complete)
- `POST /api/phases/{id}/approve` - Approve phase (Admin/Business Owner only, requires linked evidence accepted)
- `POST /api/phases/{id}/advance` - Advance to next phase (requires approval)

### Requirements & Evidence
- `GET /api/requirements` - List requirements with sub-reqs and evidence
- `GET /api/requirements/{id}` - Get single requirement details
- `GET /api/sub-requirements/{id}` - Get sub-requirement with evidence
- `POST /api/evidence/{id}/upload` - Upload evidence file
- `GET /api/evidence/pending` - List evidence pending review
- `POST /api/evidence/{id}/review` - Accept/reject evidence

### Dashboard
- `GET /api/dashboard/stats` - Dynamic compliance statistics

### Findings
- `GET /api/findings` - List all findings
- `PATCH /api/findings/{id}` - Update finding status/notes

### Risks
- `GET /api/risks` - List all risks
- `POST /api/risks` - Create new risk
- `PATCH /api/risks/{id}/approve` - Approve/reject risk

## 7-Phase Compliance Lifecycle
1. PCI Scope Definition
2. Gap Assessment (Current)
3. Control Implementation
4. Evidence Collection
5. Vulnerability & Penetration Testing
6. Compliance Validation
7. Continuous Compliance

## User Preferences
- Backend in Python only
- All endpoints in single router.py file
- Separate backend and frontend folders
- Dark theme UI with GitHub-style design
- Fully dynamic, database-driven (no static data)

## Running the Application
- Backend: port 8000 (FastAPI/Uvicorn)
- Frontend: port 5000 (Vite dev server with proxy to backend)

## Recent Changes (Dec 30, 2025)
- Implemented dynamic evidence-based compliance workflow
- Added 130 required evidence items across 63 sub-requirements
- Created evidence upload/review workflow
- Auto-generation of findings from rejected evidence
- Added risk register with business owner approval workflow
- Dynamic compliance calculation based on accepted evidence
- Role-based views for different user types
- Redesigned Dashboard with new layout matching reference design:
  - Circular compliance gauge with dynamic percentage
  - Current Phase, CDE Systems, and Open Vulnerabilities metrics
  - Tabbed navigation (Guided Workflow, Overview, Phases, Requirements, CDE Scoping, Security Testing)
  - Left sidebar with certification phases and progress bars
  - Main content showing actual phase tasks with completion status
  - Related requirements preview with evidence progress
  - Generate ROC and QSA Portal action buttons

### Latest Update
- Added 100% dynamic data from backend - no static/hardcoded values
- Linked Guided Workflow and Overview tabs - both use same data source
- Added new database models: CDESystem (24 systems), SecurityScan, ComplianceAssessment
- Dashboard stats now include:
  - CDE Systems count (24 in-scope systems)
  - ASV Scans: completed/required (0/4 quarterly)
  - Pen Tests: completed/required (0/2 annual)
  - Last Assessment date (dynamically fetched)
  - Requirements Met: compliant/total
- All metrics refresh in real-time when tasks completed or evidence reviewed

### Requirements Page V2 (Evidence Upload)
- Redesigned Requirements page matching reference design
- Shows 12 PCI DSS requirements with "X/Y compliant" badges and progress bars
- Expandable requirements showing sub-requirements with status badges:
  - compliant (green), partial (yellow), non compliant (red)
  - "X evidence needed" badge for incomplete items
- Sub-requirement detail panel includes:
  - Testing Procedures section with clickable items
  - Required Evidence section with:
    - Evidence cards with Upload button
    - Examples (e.g., "Network Security Policy PDF", "Firewall rules export")
    - Validation Criteria (e.g., "Document must be dated within 12 months")
    - Uploaded evidence with Accept/Reject actions for auditors
- Role-based view: IT/Security can upload, QSA Auditor can accept/reject
- Phase filter: Filter by "Current Phase" to see only requirements linked to active phase

### User Experience Improvements (Dec 30, 2025)
- **Role Guide**: "My Role" button shows role-specific actions and quick links
- **Evidence Gating Warning**: Dashboard shows evidence status when phase needs approval
- **Phase-Requirement Linking**: Admin can link requirements to phases in Admin panel
- **Cross-Navigation**: Quick links from Dashboard to Requirements, Findings, Risk Register
- **Governance Enforcement**: Phase approval requires Admin or Business Owner only

### Role Responsibilities
- **Admin**: Manage all settings, approve phases, configure phase-requirement links (view-only on evidence)
- **Business Owner**: Approve phases and residual risks, monitor compliance (view-only on evidence)
- **Infosec Team**: Review and accept/reject evidence (rejection creates findings), manage findings
- **IT Security**: Upload evidence for requirements, complete assigned phase tasks
- **QSA Auditor**: View-only access to monitor compliance readiness and audit documentation
