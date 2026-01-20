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
The platform utilizes a multi-tenant architecture with complete tenant isolation and row-level security. It supports 8 pre-seeded regulatory frameworks through a normalized control model for cross-framework mappings. Role-Based Access Control (RBAC) with fine-grained permissions ensures secure access.

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
- **Enterprise Risk Management (ERM)**: Risk register, mitigation actions, appetite management, KRIs, incidents, and reporting, including an Internal Control Register sub-module for managing organization-specific internal controls with workflow, testing, and risk linking.
- **Governance Orchestration**: Lifecycle management for policies, standards, and procedures with version control and approval workflows.
- **Policy/Document Management**: Comprehensive document lifecycle, versioning, and approval.
- **IT Asset Inventory**: Asset classification, valuation, linking to GRC elements, and bulk import via CSV/Excel templates.
- **Role-Based Access Control (RBAC)**: Fine-grained permissions per tenant.
- **Unified Control Library**: AI-powered control mapping across frameworks with evidence recommendations and gap analysis, including common control groups, AI similarity analysis, control inheritance, and harmonization reports.
- **Vulnerability Management**: A module for managing vulnerability and penetration testing reports with AI-powered fix recommendations, SLA tracking, compliance mapping, department-based workflow, and escalation systems.

## IT Asset Bulk Import

The IT Asset module supports bulk import of assets via CSV or Excel files.

### How to Use
1. Navigate to **Assets** page
2. Click **Template** button to download the CSV template
3. Fill in your assets using the template columns:
   - `name` (Required) - Asset name
   - `description` - Description of the asset
   - `asset_type` (Required) - One of: application, infrastructure, data, cloud, third_party
   - `criticality` - One of: low, medium, high, critical (default: medium)
   - `vendor` - Vendor name
   - `location` - Physical or logical location
   - `confidentiality_rating` - 1-5 scale
   - `integrity_rating` - 1-5 scale
   - `availability_rating` - 1-5 scale
   - `valuation` - Monetary value in USD
   - `status` - One of: active, inactive, decommissioned (default: active)
4. Click **Import** button and upload the filled file
5. View import results showing successful imports and any errors

### API Endpoints
- **Download Template**: `GET /grc/assets/template/download`
- **Import Assets**: `POST /grc/assets/import/upload`

## Vulnerability Management Module

A comprehensive module for managing vulnerability and penetration testing reports with department-based assignment, email notifications, SLA tracking, and escalation systems.

### Key Capabilities
- **Report Upload** - Upload Excel/CSV vulnerability scan reports with intelligent parsing
- **Vulnerability Register** - Central list with CVSS scores, CVE/CWE tracking, severity levels
- **AI-Powered Analysis** - OpenAI-powered fix recommendations and impact assessment
- **SLA Management** - Configurable remediation SLAs by severity (Critical: 7d, High: 30d, Medium: 90d, Low: 180d)
- **Department-Based Assignment** - Assign vulnerabilities to organizational departments (IT Security, Network Ops, Development, etc.)
- **Bulk Assignment** - Multi-select vulnerabilities and assign to departments in one action
- **Email Notifications** - SMTP-based email alerts for assignments, status changes, SLA warnings, and escalations
- **Escalation Paths** - Configurable 3-level escalation chains (Member → Lead → Head → Parent Dept Head)
- **SLA-Triggered Escalations** - Automatic escalation at 75% and 100% SLA thresholds
- **Dashboard** - Department SLA compliance, MTTR by department, workload distribution, aging analysis, escalation metrics

### Backend Structure
```
backend/grc/modules/vuln_management/
├── router.py                    # Main router
├── routers/
│   ├── departments.py           # Department management, bulk assignment
│   ├── vulnerabilities.py       # CRUD, assignment, status changes
│   ├── workflows.py             # Workflow states and transitions
│   ├── escalations.py           # SLA check, escalation triggers, notifications
│   ├── dashboard.py             # Metrics, SLA trends, workload
│   └── ...
└── services/
    ├── email_service.py         # SMTP email sending with HTML templates
    ├── escalation_service.py    # SLA check and escalation logic
    └── notification_service.py  # In-app notification management
```

### Email Configuration (Optional)
Set these environment variables for email notifications:
- SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, SMTP_FROM_EMAIL
- If not configured, emails are logged for development/demo

### API Endpoints
- **Departments**: `/grc/vuln-management/departments/*`
- **Bulk Assign**: `POST /grc/vuln-management/vulnerabilities/bulk-assign`
- **Escalation Paths**: `/grc/vuln-management/departments/{id}/escalation-paths`
- **SLA Check**: `POST /grc/vuln-management/escalations/run-sla-check`
- **Dashboard Metrics**: `/grc/vuln-management/dashboard/department-metrics`, `sla-compliance-trends`, `department-workload`, `aging-by-department`, `escalation-metrics`

## Documentation
- **Database Schema**: See `docs/DATABASE_SCHEMA.md` for comprehensive documentation of all 80+ database tables, columns, relationships, and data flows.

## External Dependencies
- **PostgreSQL**: Primary database.
- **FastAPI**: Backend API framework.
- **SQLAlchemy**: Python ORM for database interactions.
- **Next.js 14**: Frontend framework.
- **TypeScript**: Frontend language.
- **Tailwind CSS**: Frontend styling.
- **React Query**: Frontend data management.
- **OpenAI (via Replit AI Integrations)**: Used for AI-powered document parsing, control extraction, evidence quality assessment, vulnerability fix recommendations, and control similarity analysis (GPT-4o).