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

## External Dependencies
- **PostgreSQL**: Primary database.
- **FastAPI**: Backend API framework.
- **SQLAlchemy**: Python ORM for database interactions.
- **Next.js 14**: Frontend framework.
- **TypeScript**: Frontend language.
- **Tailwind CSS**: Frontend styling.
- **React Query**: Frontend data management.
- **OpenAI (via Replit AI Integrations)**: Used for AI-powered document parsing, control extraction, and evidence quality assessment (GPT-4o vision).