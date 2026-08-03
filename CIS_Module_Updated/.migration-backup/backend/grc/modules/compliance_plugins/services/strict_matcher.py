"""Strict single-stage matcher.

Replaces Stage 1 (os_keys family-walk over all approved plugins) + Stage 2
(AI router pick) with a single, deterministic lookup:

    asset.os_normalized  →  BenchmarkOsMapping  →  benchmark name  →  rules

No mixing of archived vs live benchmarks. No AI call. Operator-owned
mapping. Archive benchmarks simply have no mapping row, so they never
enter scope for any asset.

Used by:
    /compliance-plugins/match-preview
    /compliance-plugins/scan-all
    /agents/jobs
    risk_posture._cis_gap()
"""
from __future__ import annotations

from typing import List, Optional, Tuple

from sqlalchemy.orm import Session

from grc.models import (
    BenchmarkOsMapping,
    CompliancePlugin,
)


def _pattern_matches(pattern: str, asset_os: str) -> bool:
    """Pattern matches asset OS via prefix walk.

    pattern='windows-11' matches asset_os='windows-11', 'windows-11-25H2',
    'windows-11-23H2', etc. Pattern can also be an exact key like
    'ubuntu-22.04' for tighter control.
    """
    if not pattern or not asset_os:
        return False
    p = pattern.strip().lower()
    a = asset_os.strip().lower()
    if a == p:
        return True
    if a.startswith(p + "-"):
        return True
    return False


def pick_benchmark_for_os(db: Session, tenant_id: Optional[int], asset_os: str) -> Optional[BenchmarkOsMapping]:
    """Return the BenchmarkOsMapping row matching this asset's OS.

    Resolution rules:
      1. Per-tenant mappings beat global (tenant_id IS NULL) mappings.
      2. Among tied mappings, lower `priority` wins.
      3. Among tied (tenant, priority) mappings, the LONGER `os_pattern`
         wins (more specific). Example: pattern 'windows-11-25H2' beats
         pattern 'windows-11' for an asset that matches both.
    """
    if not asset_os:
        return None

    candidates = (
        db.query(BenchmarkOsMapping)
        .filter(
            BenchmarkOsMapping.is_active.is_(True),
            (BenchmarkOsMapping.tenant_id == tenant_id) | (BenchmarkOsMapping.tenant_id.is_(None)),
        )
        .all()
    )
    matches = [m for m in candidates if _pattern_matches(m.os_pattern, asset_os)]
    if not matches:
        return None

    def sort_key(m: BenchmarkOsMapping):
        # tenant_specific=True is better, lower priority is better, longer pattern is better
        return (
            0 if m.tenant_id == tenant_id else 1,
            m.priority,
            -len(m.os_pattern or ""),
        )

    matches.sort(key=sort_key)
    return matches[0]


def applicable_plugins_for_asset(
    db: Session,
    tenant_id: int,
    asset_os: str,
) -> Tuple[List[CompliancePlugin], Optional[str]]:
    """Return (plugins, picked_benchmark_name).

    plugins is the set of CompliancePlugin rows the matcher says will
    execute on this asset. picked_benchmark_name is None when no mapping
    exists — caller can show a clear "configure benchmark for this OS"
    message instead of running nothing silently.
    """
    mapping = pick_benchmark_for_os(db, tenant_id, asset_os)
    if mapping is None:
        return [], None
    plugins = (
        db.query(CompliancePlugin)
        .filter(
            (CompliancePlugin.tenant_id.is_(None)) | (CompliancePlugin.tenant_id == tenant_id),
            CompliancePlugin.review_status.in_(["approved", "auto_approved"]),
            CompliancePlugin.enabled.is_(True),
            CompliancePlugin.benchmark == mapping.benchmark_name,
        )
        .order_by(CompliancePlugin.rule_id.asc())
        .all()
    )
    return plugins, mapping.benchmark_name
