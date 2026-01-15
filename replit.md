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
- **IT Asset Inventory**: Asset classification, valuation, and linking to GRC elements.
- **Role-Based Access Control (RBAC)**: Fine-grained permissions per tenant.
- **Unified Control Library**: AI-powered control mapping across frameworks with evidence recommendations and gap analysis, including common control groups, AI similarity analysis, control inheritance, and harmonization reports.
- **Vulnerability Management**: A module for managing vulnerability and penetration testing reports with AI-powered fix recommendations, SLA tracking, compliance mapping, team-based workflow, and escalation systems.

## External Dependencies
- **PostgreSQL**: Primary database.
- **FastAPI**: Backend API framework.
- **SQLAlchemy**: Python ORM for database interactions.
- **Next.js 14**: Frontend framework.
- **TypeScript**: Frontend language.
- **Tailwind CSS**: Frontend styling.
- **React Query**: Frontend data management.
- **OpenAI (via Replit AI Integrations)**: Used for AI-powered document parsing, control extraction, evidence quality assessment, vulnerability fix recommendations, and control similarity analysis (GPT-4o).