# Tenant Implementation (Top-Down)

## 1) Overview

ComplyVerse uses schema-per-tenant isolation. Each tenant has its own DB schema (PostgreSQL) or tenant_id partitioning (SQLite fallback). Requests carry tenant context via:

- Subdomain (e.g., tenant.domain.com)
- Header: X-Tenant-Slug (for local/dev)
- JWT cookie: grc_auth_token contains tenant_id, subdomain, schema_name

Key principles:

- Every data query must filter by tenant_id or run in tenant schema.
- Tenant context is resolved once and reused for tenant DB access.
- Auth tokens are tenant-scoped when user_type=tenant.

## 2) Core Data Model (Master Schema)

File: backend/grc/models.py

### Tenant

Table: grc_tenants
Fields (key):

- id, name
- slug, subdomain, schema_name
- primary_contact_name, primary_contact_email, primary_contact_phone
- is_active, created_at
- settings (JSON, used for email_domain)

### TenantUser (Master)

Table: grc_tenant_users

- user_id (grc_users)
- tenant_id (grc_tenants)
- is_primary

### Master Users

Table: grc_users

- username, email, password_hash
- is_active, created_at, last_login

Notes:

- Master schema is used for global auth, tenant registry, and cross-tenant mapping.

## 3) Tenant Schema Models

File: backend/grc/tenant_models.py

Each tenant schema stores its own:

- TenantUser (tenant-local user table)
- Role, Permission, RolePermission, UserRole
- OrganizationProfile
- Domain data: risks, controls, evidence, documents, etc.

## 4) Tenant Provisioning

File: backend/grc/tenant_manager.py

### full_tenant_provisioning(...)

Creates and seeds:

- Tenant schema (provision_tenant)
- Permissions (seed_tenant_permissions)
- Admin user (create_tenant_admin_user)
- Admin role (seed_tenant_admin_role)
- Organization profile (create_organization_profile)

Returned:

- schema_name
- admin_user_id

## 5) Tenant Resolution (Backend)

### Tenant Middleware

File: backend/grc/middleware/subdomain.py

Responsibilities:

- Extract tenant from subdomain OR X-Tenant-Slug header
- Attach tenant to request.state.tenant

### Generic Tenant Lookup

File: backend/grc/routers/admin_router.py
Function: get_tenant_from_request

Resolution order:

1. request.state.tenant (set by middleware)
2. X-Tenant-Slug header
3. JWT payload (tenant_id or subdomain)

## 6) Authentication Flow

File: backend/grc/routers/auth_router.py

### /auth/register-organization

- Validates corporate email
- Enforces unique email domain (no duplicate tenant for same domain)
- Generates slug and subdomain
- Calls full_tenant_provisioning
- Creates Tenant record in master schema
- Issues tenant-scoped JWT cookie (grc_auth_token)

### /auth/login

Inputs:

- username (email strongly preferred)
- password
- Optional X-Tenant-Slug header

Login routing:

1. If tenant slug provided: authenticate in that tenant schema only
2. Else: resolve tenant by email domain
3. If multiple domain matches: 409 Conflict
4. If domain match is unique: authenticate in that tenant schema

Important rule:

- If username contains "@", match by email only (not by username) to avoid cross-tenant collisions.

### /auth/me

Returns:

- authenticated: bool
- user: id, email, display_name
- tenant: id, name, slug, subdomain
- permissions, allowed_modules, is_admin

Special:

- Primary contact email is treated as admin
- Admin role gets wildcard permission _:_:\*

## 7) Tenant-Specific Admin APIs

File: backend/grc/routers/admin_router.py

### /admin/organization (GET/PUT)

- Reads from tenant schema OrganizationProfile
- Tenant schema resolved via get_tenant_db

### /admin/users (POST/PUT/GET)

- Users stored in tenant schema
- Domain enforcement on create/update:
  - Email domain must match tenant domain

## 8) Frontend Tenant Context

### API Client

File: grc-frontend/src/lib/api.ts

- Injects X-Tenant-Slug from localStorage tenant_slug
- Sends cookies (withCredentials)

### Register Page

File: grc-frontend/src/app/register/page.tsx

- Clears localStorage on load
- On success, sets tenant_slug/subdomain/name/id

### Login Page

File: grc-frontend/src/app/login/page.tsx

- If ?tenant=slug present, uses it
- Otherwise, does NOT reuse stored tenant_slug
- Backend resolves by email domain

### Organization Page

File: grc-frontend/src/app/(dashboard)/admin/organization/page.tsx

- Calls /auth/me to re-sync tenant context
- Updates localStorage before requesting /admin/organization

## 9) Data Isolation Rules

### PostgreSQL

- Each tenant has its own schema
- search_path is set to the tenant schema

### SQLite

- Shared DB, all tenant rows are filtered by tenant_id
- Many queries include tenant_schema from tenant_db.info

## 10) Known Pitfalls and Fixes

### Wrong tenant login

Cause:

- Auto-discover tenant chose a user by username across tenants
  Fix:
- Email logins match only by email
- Domain-based resolution

### Sidebar missing

Cause:

- /auth/me returned no permissions for new tenant admin
  Fix:
- Primary contact email treated as admin
- Admin role gets wildcard permissions

### Stale tenant context

Cause:

- localStorage reuse across tenants
  Fix:
- Clear localStorage on register/login/logout
- Admin organization page re-syncs from /auth/me

## 11) Endpoints Summary

Auth:

- POST /auth/register-organization
- POST /auth/login
- GET /auth/me
- POST /auth/logout

Admin (tenant schema):

- GET /admin/organization
- PUT /admin/organization
- GET /admin/users
- POST /admin/users

Dashboard:

- GET /dashboard/unified
- GET /dashboard/ai-insights

## 12) Important Files

Backend:

- backend/grc/models.py
- backend/grc/tenant_models.py
- backend/grc/tenant_manager.py
- backend/grc/middleware/subdomain.py
- backend/grc/routers/auth_router.py
- backend/grc/routers/admin_router.py

Frontend:

- grc-frontend/src/lib/api.ts
- grc-frontend/src/app/register/page.tsx
- grc-frontend/src/app/login/page.tsx
- grc-frontend/src/app/(dashboard)/admin/organization/page.tsx
- grc-frontend/src/components/layout/Sidebar.tsx

## 13) Recommended Usage

- Always login with email (not username)
- Use tenant-specific email domains
- Use tenant slug only if domain is ambiguous
- Avoid reusing localStorage tenant slug across tenants

## 14) Future Hardening (Optional)

- Enforce unique email domain constraint at DB level
- Add tenant selector UI on login
- Add domain display in admin settings
- Add tenant_slug to all React Query keys to avoid cache bleed
