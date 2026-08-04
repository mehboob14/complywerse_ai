"""Threat-intelligence enrichment for vulnerabilities.

Adds EPSS exploit-probability scores, CISA KEV (Known Exploited) flags, and
NVD canonical details to `Vulnerability` rows that have a `cve_id`. Every
external call is best-effort — a network failure or rate-limit response
never raises into the request path. The vuln just stays un-enriched until
the next attempt (manual button, ingest hook, or daily Celery refresh).

Public surface:
  - `enrich_vulnerability(vuln, db)`  — synchronous, single-row enrichment.
  - `compute_composite_priority(...)` — pure function, used by the same
    service and by the bulk-refresh Celery task.

Internals (`nvd_client`, `epss_client`, `kev_cache`, `priority`) are
intentionally not part of the public surface — keep callers off them so the
caching strategy can evolve without breaking imports.
"""

from .enrichment_service import enrich_vulnerability
from .priority import compute_composite_priority

__all__ = ["enrich_vulnerability", "compute_composite_priority"]
