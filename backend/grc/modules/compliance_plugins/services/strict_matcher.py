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

from sqlalchemy import or_, cast, String
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

    Resolution order:
      1. Strict map (operator-owned ``BenchmarkOsMapping`` row).
      2. Soft fallback: walk ``CompliancePlugin.os_keys`` for the OS
         (and progressively-stripped version suffixes). Same lookup the
         /ip-peers "Asset Benchmarks" panel uses — keeping the two paths
         consistent so the UI doesn't show "1 benchmark available" while
         the scan path sees 0 applicable rules. Strict still wins when
         present; soft only fires when the operator hasn't mapped the OS.
    """
    benchmark_name: Optional[str] = None
    mapping = pick_benchmark_for_os(db, tenant_id, os_normalized)
    if mapping is not None:
        benchmark_name = mapping.benchmark_name
    elif os_normalized:
        from .software_normaliser import benchmark_for_software_key
        benchmark_name = benchmark_for_software_key(db, os_normalized)
        if benchmark_name:
            logger.info(
                "strict_matcher: soft fallback resolved tenant_id=%s os=%s → %s "
                "(no operator-owned mapping)",
                tenant_id, os_normalized, benchmark_name,
            )

    if not benchmark_name:
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
            CompliancePlugin.benchmark == benchmark_name,
            CompliancePlugin.enabled.is_(True),
            # Exclude unimplemented stubs. A rule whose check_definition still
            # carries a TODO placeholder compares the host's output against the
            # literal string "TODO_expected_value", so it can only ever fail —
            # 222 of the 424 rules in one Windows benchmark were these, and they
            # were being reported as security failures. An unwritten check is
            # not a finding; running it manufactures one.
            ~cast(CompliancePlugin.check_definition, String).ilike("%TODO%"),
            # Also exclude auto-pass placeholders. The PDF-ingest parser writes
            # expect={"kind":"any"} ("reviewer must tighten") when it cannot derive
            # a real check — the rule then passes unconditionally. Executing it
            # manufactures compliance: PostgreSQL 18 has 66 of 70 rules like this,
            # and ALL network/cloud benchmarks are 100%% of them. An unauthored
            # check is not a passing check.
            ~cast(CompliancePlugin.check_definition, String).ilike('%%"kind": "any"%%'),
            ~cast(CompliancePlugin.check_definition, String).ilike('%%"kind":"any"%%'),
            # Manual / attestation rules are never auto pass/fail — keep them out
            # of the automated pass-rate denominator (same n/a scoring rule).
            CompliancePlugin.runner_type != "manual",
        )
        .all()
    )
    return (plugins, benchmark_name)


def applicable_benchmarks_for_asset(db: Session, tenant_id: int, asset) -> List[dict]:
    """Every benchmark that applies to an asset — its OS benchmark PLUS any
    benchmark covering software detected on the host.

    A real server is rarely "just an OS": a Windows box running SQL Server, a
    Linux host running PostgreSQL, etc. The OS benchmark alone understates the
    asset's true compliance surface. This walks ``asset.detected_software_json``
    (populated by the Connect-Wizard probe / agent inventory and normalised via
    ``software_normaliser``) and adds each software's benchmark so posture
    aggregates across the whole stack.

    Returns ``[{"benchmark": name, "source": "os"|"software",
    "software_key": str|None}]`` — de-duplicated, OS first.
    """
    out: List[dict] = []
    seen = set()

    os_norm = getattr(asset, "os_normalized", None)
    mapping = pick_benchmark_for_os(db, tenant_id, os_norm)
    os_bench = mapping.benchmark_name if mapping is not None else None
    if not os_bench and os_norm:
        from .software_normaliser import benchmark_for_software_key
        os_bench = benchmark_for_software_key(db, os_norm)
    if os_bench:
        seen.add(os_bench)
        out.append({"benchmark": os_bench, "source": "os", "software_key": None})

    software = getattr(asset, "detected_software_json", None) or []
    if isinstance(software, list) and software:
        from .software_normaliser import benchmark_for_software_key
        for item in software:
            if not isinstance(item, dict):
                continue
            key = item.get("software_key")
            bench = item.get("benchmark_name")
            if not bench and key:
                bench = benchmark_for_software_key(db, key)
            if bench and bench not in seen:
                seen.add(bench)
                out.append({"benchmark": bench, "source": "software", "software_key": key})
    return out


def applicable_plugins_for_asset_multi(
    db: Session, tenant_id: int, asset,
) -> Tuple[List[CompliancePlugin], List[dict]]:
    """Multi-benchmark variant of ``applicable_plugins_for_asset``.

    Returns ``(plugins, benchmarks)`` where ``plugins`` is the union of enabled
    rules across the asset's OS benchmark + every software benchmark, and
    ``benchmarks`` is the list from ``applicable_benchmarks_for_asset`` enriched
    with a per-benchmark ``rule_count``.
    """
    benchmarks = applicable_benchmarks_for_asset(db, tenant_id, asset)
    if not benchmarks:
        return ([], [])
    names = [b["benchmark"] for b in benchmarks]
    plugins = (
        db.query(CompliancePlugin)
        .filter(
            or_(
                CompliancePlugin.tenant_id == tenant_id,
                CompliancePlugin.tenant_id.is_(None),
            ),
            CompliancePlugin.benchmark.in_(names),
            CompliancePlugin.enabled.is_(True),
            CompliancePlugin.runner_type != "manual",
            ~cast(CompliancePlugin.check_definition, String).ilike("%TODO%"),
            ~cast(CompliancePlugin.check_definition, String).ilike('%%"kind": "any"%%'),
            ~cast(CompliancePlugin.check_definition, String).ilike('%%"kind":"any"%%'),
        )
        .all()
    )
    from collections import Counter
    counts = Counter(p.benchmark for p in plugins)
    for b in benchmarks:
        b["rule_count"] = counts.get(b["benchmark"], 0)
    return (plugins, benchmarks)
