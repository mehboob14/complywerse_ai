# ComplyVerse - Enterprise GRC Platform

## Overview
ComplyVerse is a comprehensive, enterprise-grade Governance, Risk, and Compliance (GRC) platform with multi-tenancy support. It aims to streamline GRC processes, provide a single source of truth for compliance, and enable real-time risk assessment and management for enterprises. Key capabilities include integration of 8 regulatory frameworks with a normalized control model, evidence management, enterprise risk management, governance orchestration, policy management, and IT asset inventory. The platform targets significant market potential by offering a unified solution for complex GRC needs.

## User Preferences
- Backend in Python only
- Modular routers in separate files
- Separate backend and frontend folders
- Dark theme UI (slate-900/slate-800)
- Multi-tenant architecture
- PostgreSQL database

## System Architecture
The platform utilizes a multi-tenant architecture with complete tenant isolation and row-level security. All regulatory frameworks must be uploaded by users, ensuring organizations use their exact framework versions and control IDs. Role-Based Access Control (RBAC) with fine-grained permissions ensures secure access.

**UI/UX Decisions:**
- Frontend built with Next.js 14, TypeScript, and Tailwind CSS, utilizing a dark theme (slate-900/slate-800) and App Router.

**Technical Implementations:**
- **Backend**: Python 3.11, FastAPI, SQLAlchemy.
- **Frontend**: Next.js 14, TypeScript, Tailwind CSS, React Query.
- **Database**: PostgreSQL with a multi-tenant schema.
- **Authentication**: Cookie-based JWT with Secure/SameSite/HttpOnly flags.

**Feature Specifications:**
- **Multi-Tenancy**: Complete isolation and row-level security.
- **Multi-Framework Support**: Integration and user-upload of 8 regulatory frameworks.
- **Framework Classification System**: AI-powered classification of uploaded frameworks as either "certification" (requires formal third-party audit/certificate like PCI-DSS, ISO 27001, SWIFT CSP) or "compliance" (regulatory requirements like GDPR, SAMA CSF, NIST CSF). Pre-processing displays certification lifecycle structure or compliance overview before showing requirements.
- **Normalized Control Model**: For cross-framework control mapping.
- **Evidence Management**: Upload, versioning, AI assessment, and linking to controls with deterministic AI for reproducible results and clause-level mapping.
- **AI-Generated Evidence Requirements**: For each control, AI generates exact evidence requirements with specific documentation needs, acceptance criteria, collection guidance, and frequency. Includes multi-tier review workflow (Draft → Submit → Pending Review → Approved/Rejected) with full audit trail.
- **Compliance Assessments**: Upload Excel/CSV checklists (gap assessments, security audits, internal checklists) with intelligent parsing. Features AI-powered evidence recommendations for each assessment item, multi-tier approval workflows for evidence submissions (Draft → Submit → Pending Review → Approved/Rejected), and automatic integration with central Evidence repository with full tagging and traceability.
- **Enterprise Risk Management (ERM)**: Risk register, mitigation actions, appetite management, KRIs, incidents, including an Internal Control Register and RCSA module with AI-powered suggestions and multi-tier approval workflows.
- **Policy-to-Control Conversion**: When policy documents are uploaded and parsed, users can select extracted statements and convert them to internal controls. Controls are automatically linked to their source policy with cascade delete (deleting a policy also deletes its derived controls). No pre-seeded controls - all internal controls come from user-uploaded policies.
- **Governance Orchestration & Policy Management**: Lifecycle management for policies, standards, and procedures with version control, approval workflows, and attestation tracking.
- **Attestation & Certification Management**: Campaign-based attestations for SOX 302/404 certifications, policy sign-offs, BCP/DR awareness, and training acknowledgments with cascade reminders (CRO → VP → Staff) and escalation workflows. Completed attestations integrate as evidence.
- **Regulatory Change Management**: Register for tracking regulatory changes from sources (OCC, Fed, EBA, PRA, SEC, FINRA), impact assessments linking to policies/controls, implementation task tracking, and AI-powered gap analysis.
- **Board & Committee Management**: Governance committee setup with charters (including file upload for charter documents), meeting management with auto-populated agendas from pending approvals, minutes approval workflows, and oversight action tracking for Basel/EBA board governance requirements.
- **IT Asset Inventory**: Asset classification, valuation, linking to GRC elements, and bulk import via CSV/Excel templates.
- **Role-Based Access Control (RBAC)**: Fine-grained permissions per tenant.
- **Unified Control Library**: AI-powered control mapping across frameworks with evidence recommendations, gap analysis, and control inheritance.
- **Vulnerability Management**: Module for managing vulnerability and penetration testing reports with AI-powered fix recommendations, SLA tracking, department-based workflow, and escalation systems.

## Recent Changes (January 2026)

### Governance Workflow Completions
- **User Registration**: Auto-assigns new users to default tenant on registration, enabling immediate resource creation
- **Committee Dashboard**: Fixed route conflict by reordering static routes before dynamic routes
- **Meeting Agenda Auto-Population**: New endpoints to suggest and auto-populate meeting agendas from pending governance approvals (documents, exceptions, regulatory changes)
- **Document Publish Workflow**: Added explicit publish action transitioning approved documents to published status with timestamp and user tracking
- **Document Attestation Request**: Request attestations from users directly from document detail page with user selection modal
- **Attestation to Evidence Linking**: Link completed attestations to evidence repository with tenant isolation and duplicate prevention
- **Regulatory Change Close Action**: Added closure readiness check and close workflow with:
  - Task completion validation (all tasks must be completed)
  - Status transition validation (only from valid workflow states)
  - Permission checks (creator, assignee, or admin role required)
  - Full audit trail with AuditLog entries

### Frontend Enhancements
- Regulatory changes detail page with closure readiness checking and close button
- Documents page with publish and request attestation actions
- Attestations page with individual and bulk link-to-evidence actions
- Committee meeting page with suggested agenda items and auto-populate functionality

## External Dependencies
- **PostgreSQL**: Primary relational database.
- **FastAPI**: Python web framework for building APIs.
- **SQLAlchemy**: Python SQL toolkit and Object-Relational Mapper.
- **Next.js 14**: React framework for frontend development.
- **TypeScript**: Statically typed superset of JavaScript.
- **Tailwind CSS**: Utility-first CSS framework.
- **React Query**: Library for fetching, caching, and updating asynchronous data in React.
- **OpenAI (via Replit AI Integrations)**: Used for AI-powered features including document parsing, control extraction, evidence quality assessment, vulnerability fix recommendations, and control similarity analysis (specifically GPT-4o).