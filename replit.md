# Enterprise GRC Platform

## Overview
A comprehensive, enterprise-grade Governance, Risk, and Compliance (GRC) platform with multi-tenancy support. It aims to streamline GRC processes, provide a single source of truth for compliance, and enable real-time risk assessment and management for enterprises. Key capabilities include integration of 8 regulatory frameworks with a normalized control model, evidence management, enterprise risk management, governance orchestration, policy management, and IT asset inventory. The platform targets significant market potential by offering a unified solution for complex GRC needs.

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
- **Normalized Control Model**: For cross-framework control mapping.
- **Evidence Management**: Upload, versioning, AI assessment, and linking to controls with deterministic AI for reproducible results and clause-level mapping.
- **Enterprise Risk Management (ERM)**: Risk register, mitigation actions, appetite management, KRIs, incidents, including an Internal Control Register and RCSA module with AI-powered suggestions and multi-tier approval workflows.
- **Governance Orchestration & Policy Management**: Lifecycle management for policies, standards, and procedures with version control, approval workflows, and attestation tracking.
- **IT Asset Inventory**: Asset classification, valuation, linking to GRC elements, and bulk import via CSV/Excel templates.
- **Role-Based Access Control (RBAC)**: Fine-grained permissions per tenant.
- **Unified Control Library**: AI-powered control mapping across frameworks with evidence recommendations, gap analysis, and control inheritance.
- **Vulnerability Management**: Module for managing vulnerability and penetration testing reports with AI-powered fix recommendations, SLA tracking, department-based workflow, and escalation systems.

## External Dependencies
- **PostgreSQL**: Primary relational database.
- **FastAPI**: Python web framework for building APIs.
- **SQLAlchemy**: Python SQL toolkit and Object-Relational Mapper.
- **Next.js 14**: React framework for frontend development.
- **TypeScript**: Statically typed superset of JavaScript.
- **Tailwind CSS**: Utility-first CSS framework.
- **React Query**: Library for fetching, caching, and updating asynchronous data in React.
- **OpenAI (via Replit AI Integrations)**: Used for AI-powered features including document parsing, control extraction, evidence quality assessment, vulnerability fix recommendations, and control similarity analysis (specifically GPT-4o).