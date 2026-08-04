"""CWE → Framework-control auto-mapping.

The vulnerability register has had a `cwe_id` column and the
`VulnerabilityControlLink` table since forever, but nothing connected the
two automatically. This package fills the gap: given a vuln with a CWE,
work out which seeded framework controls it currently breaks and write
those rows into the link table. The compliance / auditor surface then
pulls them back the other way ("vulns are this control's evidence").

Public surface — only what callers should reach for:
  - `auto_map_compliance_controls(vuln, db)` — single-row writer, called
    at the end of `enrich_vulnerability` and by the on-demand endpoint.
  - `resolve_cwe_to_framework_controls(...)` — pure resolver for callers
    that want the matched controls without writing rows (e.g. the
    "what would auto-map?" preview surface, future).

Internals (`cwe_control_map`, `cwe_resolver` private helpers) are
intentionally not part of the public surface — keep callers off them so
the map can be tuned without breaking imports.
"""
from .cwe_resolver import (
    auto_map_compliance_controls,
    resolve_cwe_to_framework_controls,
    invalidate_tenant_cache,
    AUTO_LINK_NOTES_PREFIX,
    SENTINEL_KEV,
    SENTINEL_VULN_MGMT,
)

__all__ = [
    "auto_map_compliance_controls",
    "resolve_cwe_to_framework_controls",
    "invalidate_tenant_cache",
    "AUTO_LINK_NOTES_PREFIX",
    "SENTINEL_KEV",
    "SENTINEL_VULN_MGMT",
]
