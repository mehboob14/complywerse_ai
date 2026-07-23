"""Phase 6 — Vendor Patch Intelligence.

PSIRT (Product Security Incident Response Team) lookups: given a CVE ID, ask
the responsible vendor's security feed for the KB articles / vendor advisory
IDs / remediation text that fixes it. Microsoft Security Response Center
(MSRC) is the first connector; the schema is designed so Red Hat (RHSA) and
Cisco PSIRT slot in without further migrations.

Public surface:
  - `sync_patch_intel(vuln, db)` — synchronous, single-row sync. Best-effort:
    returns a summary dict but never raises on network/parse errors so the
    caller (HTTP handler or Celery task) doesn't need to wrap it.

Internals (`msrc_client`, `patch_intel_service`) are private to the package.
"""
from __future__ import annotations

from .patch_intel_service import sync_patch_intel

__all__ = ["sync_patch_intel"]
