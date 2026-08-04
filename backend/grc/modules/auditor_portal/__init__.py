"""Auditor portal — read-and-review module that aggregates every
framework-linked artifact (controls, evidence, documents, risks, assets,
vulnerabilities, vendors, exceptions, audit trail) for an external/internal
auditor working through a certification journey.

The module is *thin* — it does not introduce new tables. Every endpoint
queries the existing module-owned tables, filters them down to the
framework in scope, and (where applicable) routes approve/reject/remarks
actions back through the existing approval workflows on those tables.

Tenant scoping is enforced via `get_user_tenants(current_user, db)` like
every other module — the auditor is just a user with the right
permissions. Shareable URLs are stable per-journey; no share-token table.
"""
from .router import router as auditor_portal_router

__all__ = ["auditor_portal_router"]
