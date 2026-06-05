"""Unified Risk Posture scoring — composite score per asset combining
five dimensions: CIS pass rate, open vulnerabilities, CIA criticality,
control coverage, and linked-risk residual score.

Scores are computed on-the-fly from existing tables. No separate cache
in v1 — recompute is cheap (a handful of indexed joins) and freshness
matters more than read cost.

The score is 0-100, **higher = worse**. Internally each sub-score is
0-1, weighted, summed, and ×100. When a dimension has NO data (e.g.
asset never scanned for CIS, no CIA ratings set), that dimension is
marked `unknown` and **its weight is removed from the denominator**
— so a brand-new asset doesn't get penalized for a missing baseline.
The frontend renders unknown components with a clear badge so the
operator can fill them in.

Weights (default — tunable later via tenant settings):
    w_cis    = 0.25   CIS compliance gap
    w_vuln   = 0.30   Vulnerability burden
    w_cia    = 0.15   Asset's own CIA value
    w_ctrl   = 0.15   Inverse control coverage
    w_risk   = 0.15   Linked open-risk residual score
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional
from sqlalchemy import func
from sqlalchemy.orm import Session

from grc.models import (
    ITAsset,
    CompliancePlugin,
    CompliancePluginRun,
    Vulnerability,
    VulnerabilityAssetLink,
    AssetControlLink,
    AssetInternalControlLink,
    AssetFrameworkControlLink,
    Risk,
    RiskAssetLink,
)

# ─── Tunables ───────────────────────────────────────────────────────────────

DEFAULT_WEIGHTS = {
    "cis":  0.25,
    "vuln": 0.30,
    "cia":  0.15,
    "ctrl": 0.15,
    "risk": 0.15,
}

# Module-level mutable so existing code paths reading `WEIGHTS` keep
# working without a sweep. Per-tenant overrides come via
# `resolve_weights_for_tenant()` (see below).
WEIGHTS = dict(DEFAULT_WEIGHTS)


def resolve_weights_for_tenant(db, tenant_id: int) -> dict:
    """Return the weight map this tenant should use for risk scoring.

    Checks `grc_tenant_risk_weights` first; falls back to module defaults
    if no row exists. Senior's "har bank apne hisaab se" requirement —
    we honour per-tenant tuning without forcing a row for tenants that
    haven't customised anything.
    """
    try:
        # Lazy import to avoid circular dependency with grc.models
        from grc.models import TenantRiskWeights
        row = db.query(TenantRiskWeights).filter(
            TenantRiskWeights.tenant_id == tenant_id,
        ).first()
    except Exception:
        # If the table doesn't exist yet (e.g. running against an older
        # schema during migration), silently fall back to defaults so
        # Risk Posture keeps rendering instead of 500-ing.
        return dict(DEFAULT_WEIGHTS)
    if not row:
        return dict(DEFAULT_WEIGHTS)
    return {
        "cis":  float(row.weight_cis)  / 100.0,
        "vuln": float(row.weight_vuln) / 100.0,
        "cia":  float(row.weight_cia)  / 100.0,
        "ctrl": float(row.weight_ctrl) / 100.0,
        "risk": float(row.weight_risk) / 100.0,
    }

VULN_SEVERITY_POINTS = {
    "critical": 10.0,
    "high":      5.0,
    "medium":    2.0,
    "low":       1.0,
    "info":      0.2,
}
VULN_POINTS_CAP = 50.0
CONTROL_COVERAGE_TARGET = 12

# Cap for residual_score sum — most platforms use 1-25 (5x5 likelihood×impact),
# so a handful of medium-residual risks (~10-15 each) maxes the dimension.
RISK_SCORE_CAP = 50.0

# A risk/vuln is "active" (counts toward score) unless its status is in
# one of these terminal states. Previously we hard-locked to status=="open"
# which silently dropped real signal (e.g. a risk being mitigated is still
# pending, a vuln in_progress is still a problem).
TERMINAL_RISK_STATUSES = {"closed", "resolved", "accepted", "transferred"}
TERMINAL_VULN_STATUSES = {"resolved", "accepted", "false_positive", "closed"}


def _is_active_risk(status: Optional[str]) -> bool:
    return (status or "open").lower() not in TERMINAL_RISK_STATUSES


def _is_active_vuln(status: Optional[str]) -> bool:
    return (status or "open").lower() not in TERMINAL_VULN_STATUSES

RISK_BANDS = [
    (0,   25, "low",      "Healthy posture"),
    (25,  50, "moderate", "Watch list"),
    (50,  75, "high",     "Remediate soon"),
    (75, 101, "critical", "Immediate action"),
]


def _band_for(score: float) -> Dict[str, str]:
    for lo, hi, label, blurb in RISK_BANDS:
        if lo <= score < hi:
            return {"label": label, "description": blurb}
    return {"label": "critical", "description": "Immediate action"}


# ─── Sub-score computations ─────────────────────────────────────────────────
# Each returns a dict with at minimum {score: float 0-1, known: bool}.

def _cis_gap(db: Session, tenant_id: int, asset_id: int) -> Dict[str, Any]:
    """0-1 (1 = worst). `known` is True only if at least one run exists
    for this asset, regardless of total rule count."""
    total = (
        db.query(CompliancePlugin)
        .filter(
            (CompliancePlugin.tenant_id.is_(None)) | (CompliancePlugin.tenant_id == tenant_id),
            CompliancePlugin.review_status.in_(["approved", "auto_approved"]),
            CompliancePlugin.enabled.is_(True),
        )
        .count()
    )

    runs = (
        db.query(CompliancePluginRun)
        .filter(
            CompliancePluginRun.tenant_id == tenant_id,
            CompliancePluginRun.asset_id == asset_id,
        )
        .order_by(
            CompliancePluginRun.started_at.desc().nullslast(),
            CompliancePluginRun.id.desc(),
        )
        .all()
    )
    latest: Dict[int, str] = {}
    for r in runs:
        if r.plugin_id not in latest:
            latest[r.plugin_id] = r.status

    if not latest or total == 0:
        return {
            "score": 0.0, "known": False,
            "passed": 0, "failed": 0, "never_scanned": total, "total": total,
            "pass_rate": None,
        }

    passed = sum(1 for s in latest.values() if s == "passed")
    failed = sum(1 for s in latest.values() if s == "failed")
    never_scanned = total - len(latest)
    # Among scanned rules, gap = failed / scanned. Never-scanned rules
    # contribute proportionally as "unknown" with neutral 0.5 weight, but
    # we ALSO surface them separately so the operator sees coverage gap.
    scanned = passed + failed
    pass_rate = round(passed / total * 100, 1)
    if scanned == 0:
        score = 0.0
    else:
        scanned_gap = failed / scanned
        # Blend: 80% of weight on actually-scanned outcomes, 20% on
        # never-scanned penalty (so coverage matters but doesn't dominate).
        coverage_penalty = never_scanned / total
        score = 0.8 * scanned_gap + 0.2 * coverage_penalty

    return {
        "score": round(score, 4), "known": True,
        "passed": passed, "failed": failed, "never_scanned": never_scanned,
        "total": total, "pass_rate": pass_rate,
    }


def _vuln_score(db: Session, tenant_id: int, asset_id: int) -> Dict[str, Any]:
    """0-1. `known` only if at least one vulnerability is linked to this
    asset. Otherwise treat as unknown (operator hasn't run a vuln scan
    or imported a report yet). This matches the same gate-on-evidence
    rule used by CIS, CIA, and Risk — every dimension is consistent.
    """
    links = (
        db.query(Vulnerability)
        .join(VulnerabilityAssetLink, VulnerabilityAssetLink.vulnerability_id == Vulnerability.id)
        .filter(
            VulnerabilityAssetLink.asset_id == asset_id,
            Vulnerability.tenant_id == tenant_id,
        )
        .all()
    )
    if not links:
        return {
            "score": 0.0, "known": False,
            "raw_points": 0.0,
            "open_count": 0, "active_count": 0, "total_linked": 0,
            "by_severity": {"critical": 0, "high": 0, "medium": 0, "low": 0, "info": 0},
            "by_status": {},
        }
    active = [v for v in links if _is_active_vuln(v.status)]
    breakdown: Dict[str, int] = {"critical": 0, "high": 0, "medium": 0, "low": 0, "info": 0}
    by_status: Dict[str, int] = {}
    points = 0.0
    for v in active:
        sev = (v.severity or "low").lower()
        if sev in breakdown:
            breakdown[sev] += 1
        points += VULN_SEVERITY_POINTS.get(sev, 0)
    for v in links:
        st = (v.status or "open").lower()
        by_status[st] = by_status.get(st, 0) + 1
    normalized = min(1.0, points / VULN_POINTS_CAP)
    return {
        "score": round(normalized, 4), "known": True,
        "raw_points": round(points, 2),
        "open_count": len(active),
        "active_count": len(active),
        "total_linked": len(links),
        "by_severity": breakdown,
        "by_status": by_status,
    }


def _cia_value(asset: ITAsset) -> Dict[str, Any]:
    """0-1. `known` only when at least one of C/I/A is set."""
    vals = [
        asset.confidentiality_rating,
        asset.integrity_rating,
        asset.availability_rating,
    ]
    present = [v for v in vals if v is not None]
    if not present:
        return {
            "score": 0.0, "known": False,
            "confidentiality": None, "integrity": None, "availability": None,
            "missing": True,
        }
    avg = sum(present) / len(present)
    norm = max(0.0, (avg - 1) / 4)
    return {
        "score": round(norm, 4), "known": True,
        "confidentiality": asset.confidentiality_rating,
        "integrity": asset.integrity_rating,
        "availability": asset.availability_rating,
        "missing": False,
    }


def _control_coverage(db: Session, asset_id: int) -> Dict[str, Any]:
    """0-1 (1 = no controls linked). `known` only when at least one
    control is linked to the asset. Otherwise treat as unknown — same
    gate-on-evidence rule used by all other dimensions.
    """
    # Asset-control links live in THREE tables — UI presents them under
    # the same "Controls" tab so users (and operators) treat them as
    # interchangeable. We aggregate all three counts.
    norm_count = (
        db.query(func.count(AssetControlLink.id))
        .filter(AssetControlLink.asset_id == asset_id)
        .scalar() or 0
    )
    fw_count = (
        db.query(func.count(AssetFrameworkControlLink.id))
        .filter(AssetFrameworkControlLink.asset_id == asset_id)
        .scalar() or 0
    )
    internal_count = (
        db.query(func.count(AssetInternalControlLink.id))
        .filter(AssetInternalControlLink.asset_id == asset_id)
        .scalar() or 0
    )
    linked = norm_count + fw_count + internal_count
    if linked == 0:
        return {
            "score": 0.0, "known": False,
            "coverage_pct": 0.0,
            "linked_count": 0,
            "target": CONTROL_COVERAGE_TARGET,
        }
    coverage = min(1.0, linked / CONTROL_COVERAGE_TARGET)
    return {
        "score": round(1 - coverage, 4), "known": True,
        "coverage_pct": round(coverage * 100, 1),
        "linked_count": linked,
        "target": CONTROL_COVERAGE_TARGET,
    }


def _risk_score(db: Session, tenant_id: int, asset_id: int) -> Dict[str, Any]:
    """0-1. `known` only when at least one risk is linked to this asset.

    Counts ALL ACTIVE risks toward the score (anything not closed/resolved/
    accepted/transferred) — previously was hard-locked to status=="open",
    which dropped legitimate signals like "mitigating", "in_review", etc.

    Sums residual_score (falls back to inherent_score), normalized against
    RISK_SCORE_CAP. Surfaces by_status breakdown so operators see the
    full inventory, not just the "open" subset.
    """
    risks = (
        db.query(Risk)
        .join(RiskAssetLink, RiskAssetLink.risk_id == Risk.id)
        .filter(
            RiskAssetLink.asset_id == asset_id,
            Risk.tenant_id == tenant_id,
        )
        .all()
    )
    if not risks:
        return {
            "score": 0.0, "known": False,
            "open_count": 0, "active_count": 0, "total_linked": 0,
            "raw_points": 0.0, "by_status": {},
        }

    active = [r for r in risks if _is_active_risk(r.status)]
    open_only = [r for r in risks if (r.status or "open").lower() == "open"]
    by_status: Dict[str, int] = {}
    for r in risks:
        st = (r.status or "open").lower()
        by_status[st] = by_status.get(st, 0) + 1

    points = 0.0
    for r in active:
        s = r.residual_score if r.residual_score is not None else r.inherent_score
        if s is not None:
            points += float(s)
    normalized = min(1.0, points / RISK_SCORE_CAP)
    return {
        "score": round(normalized, 4), "known": True,
        "open_count": len(open_only),    # strictly "open"
        "active_count": len(active),     # broader "active" (counts in score)
        "total_linked": len(risks),
        "raw_points": round(points, 2),
        "by_status": by_status,
    }


# ─── Public API ─────────────────────────────────────────────────────────────

def compute_asset_risk(
    db: Session, tenant_id: int, asset: ITAsset,
) -> Dict[str, Any]:
    """Full breakdown + composite score for one asset.

    Components with `known=False` are excluded from the weighted sum and
    their weight is REMOVED from the denominator — so a brand-new asset
    isn't penalized for what we haven't measured yet.
    """
    components = {
        "cis":  _cis_gap(db, tenant_id, asset.id),
        "vuln": _vuln_score(db, tenant_id, asset.id),
        "cia":  _cia_value(asset),
        "ctrl": _control_coverage(db, asset.id),
        "risk": _risk_score(db, tenant_id, asset.id),
    }

    # Resolve per-tenant weights (falls back to DEFAULT_WEIGHTS if no override row).
    # Senior's "har bank apne hisaab se" — score reflects this tenant's policy.
    weights = resolve_weights_for_tenant(db, tenant_id)

    known_keys = [k for k, c in components.items() if c.get("known")]
    effective_weight_sum = sum(weights[k] for k in known_keys)

    if not known_keys or effective_weight_sum == 0:
        # No data at all → score is unknowable. Don't lie with a number.
        composite: Optional[float] = None
        composite_band = {"label": "unknown", "description": "No data yet — onboard or scan to measure"}
        contributions: Dict[str, float] = {k: 0.0 for k in components}
        data_quality = 0.0
    else:
        composite_unit = sum(
            weights[k] * components[k]["score"] for k in known_keys
        ) / effective_weight_sum
        composite = round(composite_unit * 100, 1)
        composite_band = _band_for(composite)
        # Contributions are reported relative to the renormalized weighting
        contributions = {
            k: round(weights[k] / effective_weight_sum * components[k]["score"] * 100, 1)
            if components[k].get("known") else 0.0
            for k in components
        }
        data_quality = round(effective_weight_sum * 100, 1)  # % of weight covered

    return {
        "asset": {
            "id": asset.id,
            "name": asset.name,
            "host_name": asset.host_name,
            "ip_address": asset.ip_address,
            "asset_type": asset.asset_type,
            "criticality": asset.criticality,
            "owner_name": asset.owner_name,
        },
        "score": composite,
        "band": composite_band,
        "weights": weights,
        "data_quality": data_quality,
        "known_dimensions": known_keys,
        "components": components,
        "contributions": contributions,
    }


def compute_tenant_posture(
    db: Session, tenant_id: int,
) -> Dict[str, Any]:
    """Tenant-wide rollup — per-asset rows + aggregate stats."""
    # Pull this tenant's effective weights once; same number that drives
    # every per-asset compute below, so the response field and the math
    # stay in lock-step.
    weights = resolve_weights_for_tenant(db, tenant_id)
    assets = (
        db.query(ITAsset)
        .filter(ITAsset.tenant_id == tenant_id)
        .all()
    )
    rows: List[Dict[str, Any]] = []
    for a in assets:
        r = compute_asset_risk(db, tenant_id, a)
        rows.append({
            "id": a.id,
            "name": a.name,
            "host_name": a.host_name,
            "asset_type": a.asset_type,
            "criticality": a.criticality,
            "score": r["score"],
            "band": r["band"],
            "data_quality": r["data_quality"],
            "known_dimensions": r["known_dimensions"],
            "contributions": r["contributions"],
            "cis_pass_rate": r["components"]["cis"].get("pass_rate"),
            "active_vulns": r["components"]["vuln"]["active_count"],
            "total_vulns": r["components"]["vuln"]["total_linked"],
            "cia_known": r["components"]["cia"]["known"],
            "control_coverage_pct": r["components"]["ctrl"]["coverage_pct"],
            "active_risks": r["components"]["risk"]["active_count"],
            "total_risks": r["components"]["risk"]["total_linked"],
        })

    # Sort: unknown scores last (None), then by score desc
    def sort_key(row: Dict[str, Any]):
        return (row["score"] is None, -(row["score"] or 0))
    rows.sort(key=sort_key)

    scored_rows = [r for r in rows if r["score"] is not None]
    if scored_rows:
        avg_score = round(sum(r["score"] for r in scored_rows) / len(scored_rows), 1)
        highest_score = scored_rows[0]["score"]
        highest_name = scored_rows[0]["name"]
    else:
        avg_score = 0.0
        highest_score = 0
        highest_name = None

    band_counts: Dict[str, int] = {"low": 0, "moderate": 0, "high": 0, "critical": 0, "unknown": 0}
    for r in rows:
        band_counts[r["band"]["label"]] = band_counts.get(r["band"]["label"], 0) + 1

    return {
        "assets": rows,
        "summary": {
            "asset_count": len(rows),
            "scored_count": len(scored_rows),
            "avg_score": avg_score,
            "by_band": band_counts,
            "highest_score": highest_score,
            "highest_name": highest_name,
        },
        "weights": weights,
    }
