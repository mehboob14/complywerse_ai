"""Strict-single-stage benchmark matcher.

CIS-merge backfill — implements the matcher the package's router expects.
Replaces the AI Stage-2 router with an explicit, auditable lookup that
walks the operator-owned ``BenchmarkOsMapping`` table:

    asset.os_normalized prefix → benchmark name

Most-specific pattern wins (longest pattern first; ``priority`` is the
tie-breaker, lower wins). Archive benchmarks just don't get a row → never
in scope. No AI call, no mixing of versions.

Two callers in ``compliance_plugins/router.py``:

* ``pick_benchmark_for_os(db, tenant_id, os_normalized)`` — returns the
  ``BenchmarkOsMapping`` row (or None) for a single asset OS string.
* ``applicable_plugins_for_asset(db, tenant_id, os_normalized)`` — returns
  ``(list[CompliancePlugin], Optional[str])`` — the enabled CIS plugin
  rows that match the picked benchmark for this OS, plus the benchmark
  name itself for display.

The matching contract (from the model docstring):

    pattern='windows-11'      matches  os_normalized='windows-11-25H2'
                                   or  os_normalized='windows-11'

    pattern='ubuntu-22.04'    matches  os_normalized='ubuntu-22.04'
                                   or  os_normalized='ubuntu-22.04-server'

i.e. exact match OR pattern followed by a hyphen. Comparison is
case-insensitive against the lower-cased ``os_normalized``.
"""
from __future__ import annotations

import logging
from typing import List, Optional, Tuple

from sqlalchemy import or_
from sqlalchemy.orm import Session

from ....models import BenchmarkOsMapping, CompliancePlugin

logger = logging.getLogger(__name__)


def pick_benchmark_for_os(
    db: Session,
    tenant_id: int,
    os_normalized: Optional[str],
) -> Optional[BenchmarkOsMapping]:
    """Resolve the operator's mapping table to a single matched row.

    Returns ``None`` when the asset has no normalized OS or no mapping
    pattern is a prefix. The caller is responsible for treating a None
    result as "out of scope" — the package contract says scan-all skips
    such assets entirely.
    """
    if not os_normalized:
        return None
    os_lower = os_normalized.lower().strip()
    if not os_lower:
        return None

    # Pull every candidate row — tenant-scoped patterns + the platform-wide
    # rows (tenant_id IS NULL) that ship with seed data. Same query as the
    # benchmark-mappings management endpoints use.
    candidates = (
        db.query(BenchmarkOsMapping)
        .filter(
            or_(
                BenchmarkOsMapping.tenant_id == tenant_id,
                BenchmarkOsMapping.tenant_id.is_(None),
            ),
            BenchmarkOsMapping.is_active.is_(True),
        )
        .all()
    )

    matches: List[BenchmarkOsMapping] = []
    for m in candidates:
        pat = (m.os_pattern or "").lower().strip()
        if not pat:
            continue
        # Exact match OR prefix-with-hyphen-boundary. The hyphen boundary
        # is what stops 'windows-1' from matching 'windows-10' or
        # 'windows-11' (without it, the longest-wins rule would still
        # behave, but the boundary keeps the SQL-side filter exact when
        # an operator types something ambiguous).
        if os_lower == pat or os_lower.startswith(pat + "-"):
            matches.append(m)

    if not matches:
        logger.debug(
            "strict_matcher: no benchmark for tenant_id=%s os=%s",
            tenant_id, os_normalized,
        )
        return None

    # Longest pattern wins; lower priority is the tie-breaker.
    matches.sort(key=lambda m: (-len((m.os_pattern or "")), (m.priority or 100)))
    picked = matches[0]
    logger.debug(
        "strict_matcher: tenant_id=%s os=%s → pattern=%s benchmark=%s",
        tenant_id, os_normalized, picked.os_pattern, picked.benchmark_name,
    )
    return picked


def applicable_plugins_for_asset(
    db: Session,
    tenant_id: int,
    os_normalized: Optional[str],
) -> Tuple[List[CompliancePlugin], Optional[str]]:
    """Return the enabled CIS plugin rows that apply to this asset's OS.

    Tuple shape: ``(plugins, benchmark_name)``. When the asset's OS
    doesn't resolve to a benchmark, returns ``([], None)`` — the package
    callers treat that as "no rules to run."
    """
    mapping = pick_benchmark_for_os(db, tenant_id, os_normalized)
    if mapping is None:
        return ([], None)

    # Per-tenant DB architecture: every row in this tenant's DB *is* this
    # tenant's, but the CIS plugin seed leaves tenant_id NULL on the
    # built-in rule rows (system-wide intent). Accept both: plugin
    # rows tagged with this tenant_id AND the system-wide NULL rows
    # — same pattern as the BenchmarkOsMapping lookup above. Without
    # this the matcher returns zero plugins on every seeded tenant.
    plugins = (
        db.query(CompliancePlugin)
        .filter(
            or_(
                CompliancePlugin.tenant_id == tenant_id,
                CompliancePlugin.tenant_id.is_(None),
            ),
            CompliancePlugin.benchmark == mapping.benchmark_name,
            CompliancePlugin.enabled.is_(True),
        )
        .all()
    )
    return (plugins, mapping.benchmark_name)
