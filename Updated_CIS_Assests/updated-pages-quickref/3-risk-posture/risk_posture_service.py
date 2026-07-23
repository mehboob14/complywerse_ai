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
    """0-1 (1 = worst).

    Bug fix: total used to be the WHOLE library count (e.g. 4855), which
    made a Windows host's pass-rate be 63/4855=1.3% instead of the real
    63/538=12% against rules actually applicable to it. Now `total` is
    the count of rules whose os_keys family-walk matches the asset's
    os_normalized — i.e. the same Stage 1 set the matcher uses at scan
    time. Stage 2 narrowing is not used here because we want coverage
    to be conservative (any rule that could apply counts as expected).
    """
    # ─── Applicable rule count for THIS asset (Stage 1 family-walk) ─────
    # Fetch the asset's os_normalized; if unset, fall back to whole-library
    # count (preserving previous behavior for unprofiled assets).
    asset = db.query(ITAsset).filter(ITAsset.id == asset_id).first()
    asset_os = (asset.os_normalized or "").strip() if asset else ""

    def _stage1_ok(plugin_os_keys, asset_key):
        if not asset_key:
            return True  # no OS data → all rules are "candidates"
        if not plugin_os_keys:
            return False
        if asset_key in plugin_os_keys:
            return True
        if "-" in asset_key:
            parts = asset_key.split("-")
            for i in range(len(parts) - 1, 0, -1):
                if "-".join(parts[:i]) in plugin_os_keys:
                    return True
        return False

    all_plugins = (
        db.query(CompliancePlugin.id, CompliancePlugin.os_keys, CompliancePlugin.benchmark)
        .filter(
            (CompliancePlugin.tenant_id.is_(None)) | (CompliancePlugin.tenant_id == tenant_id),
            CompliancePlugin.review_status.in_(["approved", "auto_approved"]),
            CompliancePlugin.enabled.is_(True),
        )
        .all()
    )

    # Prefer Stage-2 narrowing: if the asset has been scanned, the SPECIFIC
    # benchmark its (non-leaked) runs hit IS the applicable benchmark. That
    # gives the correct denominator (538 for Win11 25H2 Enterprise v5.0.1)
    # instead of the broader Stage 1 family count (962, which includes the
    # archived Stand-alone v2.0.0). Fall back to Stage 1 family-walk when no
    # runs exist yet.
    from collections import Counter
    bench_counter = Counter(
        p.benchmark for p, run in
        db.query(CompliancePlugin, CompliancePluginRun)
        .join(CompliancePluginRun, CompliancePluginRun.plugin_id == CompliancePlugin.id)
        .filter(
            CompliancePluginRun.asset_id == asset_id,
            CompliancePluginRun.tenant_id == tenant_id,
            CompliancePluginRun.is_leaked.is_(False),
        ).all()
        if p.benchmark
    )
    picked_benchmark = bench_counter.most_common(1)[0][0] if bench_counter else None

    if picked_benchmark:
        applicable_plugin_ids = {p.id for p in all_plugins if p.benchmark == picked_benchmark}
    elif asset_os:
        # ── STRICT MATCHER FALLBACK ──
        # Asset has OS but no runs yet → use the operator-owned mapping
        # table, not the legacy Stage 1 family-walk. Keeps _cis_gap()
        # consistent with /jobs, /scan-all, and /match-preview which all
        # use the strict matcher. If no mapping row exists for this OS,
        # the dimension stays "unknown" rather than falling back to a
        # broader (potentially over-counted) candidate set.
        from grc.modules.compliance_plugins.services.strict_matcher import pick_benchmark_for_os
        mapping = pick_benchmark_for_os(db, tenant_id, asset_os)
        if mapping:
            applicable_plugin_ids = {
                p.id for p in all_plugins if p.benchmark == mapping.benchmark_name
            }
        else:
            applicable_plugin_ids = set()
    else:
        applicable_plugin_ids = {p.id for p in all_plugins}
    total = len(applicable_plugin_ids)

    runs = (
        db.query(CompliancePluginRun)
        .filter(
            CompliancePluginRun.tenant_id == tenant_id,
            CompliancePluginRun.asset_id == asset_id,
            CompliancePluginRun.is_leaked.is_(False),
        )
        .order_by(
            CompliancePluginRun.started_at.desc().nullslast(),
            CompliancePluginRun.id.desc(),
        )
        .all()
    )
    # Only count runs against applicable plugins. (A run whose plugin isn't
    # in the Stage 1 applicable set is treated as not-counting — that's a
    # leftover from before the matcher fix and should not poison coverage.)
    latest: Dict[int, str] = {}
    for r in runs:
        if r.plugin_id not in latest and r.plugin_id in applicable_plugin_ids:
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
    scanned = passed + failed
    pass_rate = round(passed / total * 100, 1)
    if scanned == 0:
        score = 0.0
    else:
        scanned_gap = failed / scanned
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
    for v in active:
        sev = (v.severity or "low").lower()
        if sev in breakdown:
            breakdown[sev] += 1
    for v in links:
        st = (v.status or "open").lower()
        by_status[st] = by_status.get(st, 0) + 1

    # ── Effective-risk path (Risk Posture v2, plan §2 + §4) ─────────────
    # Replaces the old severity-bucket points sum (10/7/3/1) with the
    # weighted formula combining CVSS + EPSS + KEV + asset CIA +
    # business_impact. The formula module owns the math and the
    # explanation; we just feed it typed inputs.
    #
    # We compute one RiskOutput per active vuln, then take the MAX
    # across the asset's open vulns as the dimension score. MAX is the
    # honest aggregation: one weaponised KEV-listed RCE on this asset
    # should dominate the dimension, not be diluted by 50 low-severity
    # findings. The legacy raw_points figure is kept for backward
    # compat with the existing UI strip and audit log, derived from the
    # same severity bucket counts.
    from grc.models import ITAsset
    from grc.modules.risk_posture.effective_risk import (
        RiskInputs, compute_effective_risk,
    )

    asset = db.query(ITAsset).filter(ITAsset.id == asset_id).first()
    asset_cia_max = None
    if asset is not None:
        cia_vals = [
            asset.confidentiality_rating,
            asset.integrity_rating,
            asset.availability_rating,
        ]
        cia_vals = [v for v in cia_vals if v is not None]
        if cia_vals:
            asset_cia_max = max(cia_vals)

    best_score = 0.0
    best_breakdown: Optional[dict] = None
    best_reason: Optional[str] = None
    per_vuln_scores: list = []
    for v in active:
        inp = RiskInputs(
            cvss_score=v.cvss_score,
            epss_score=v.epss_score,
            kev_flag=bool(v.kev_flag),
            asset_cia_max=asset_cia_max,
            is_customer_facing=bool(getattr(asset, "is_customer_facing", False)) if asset else False,
            is_internet_facing=bool(getattr(asset, "is_internet_facing", False)) if asset else False,
            regulated_data_type=(getattr(asset, "regulated_data_type", "none") if asset else "none"),
            operational_dependency=(getattr(asset, "operational_dependency", "medium") if asset else "medium"),
        )
        out = compute_effective_risk(inp)
        per_vuln_scores.append({
            "vuln_id": v.id,
            "cve_id": v.cve_id,
            "title": v.title,
            "severity": v.severity,
            "cvss_score": v.cvss_score,
            "epss_score": v.epss_score,
            "kev_flag": bool(v.kev_flag),
            "score": out.score,
            "band": out.band,
            "escalated": out.escalated,
            "contributions": out.contributions,
            "business_impact_factor": out.business_impact_factor,
            "reason": out.reason,
        })
        # Persist the per-vuln effective risk back so the per-vuln UI can
        # cite numbers without recomputing. Best-effort — a malformed row
        # shouldn't break the dimension score.
        try:
            from datetime import datetime as _dt
            v.effective_risk_score = out.score
            v.effective_risk_reason = out.reason
            v.effective_risk_computed_at = _dt.utcnow()
        except Exception:  # noqa: BLE001
            pass
        if out.score > best_score:
            best_score = out.score
            best_breakdown = out.contributions
            best_reason = out.reason
    # Commit the effective_risk writes (best-effort — caller's transaction
    # boundary owns rollback semantics).
    try:
        db.commit()
    except Exception:  # noqa: BLE001
        db.rollback()

    # ── Legacy raw_points kept for the existing UI strip ────────────
    legacy_points = sum(
        VULN_SEVERITY_POINTS.get((v.severity or "low").lower(), 0) for v in active
    )

    return {
        "score": round(best_score, 4), "known": True,
        "raw_points": round(legacy_points, 2),
        "open_count": len(active),
        "active_count": len(active),
        "total_linked": len(links),
        "by_severity": breakdown,
        "by_status": by_status,
        # NEW (Risk Posture v2): explainable breakdown of the dimension.
        # Surfaces in the asset detail page's "Why this score" callout
        # and on the per-vuln breakdown in the Vulnerabilities tab.
        "effective_risk": {
            "method": "weighted_cvss_epss_kev_cia_biz",
            "best_score": round(best_score, 4),
            "best_contributions": best_breakdown,
            "best_reason": best_reason,
            "per_vuln": per_vuln_scores,
        },
    }


def _cia_value(asset: ITAsset) -> Dict[str, Any]:
    """0-1. `known` only when at least one of C/I/A is set, OR when we
    can derive sensible defaults from the asset's criticality.

    Banks set criticality on every asset (low/medium/high/critical) but
    rarely fill in C/I/A individually until a formal classification
    exercise — which delays risk-posture scoring forever. We provide a
    safe default: critical→5, high→4, medium→3, low→2, unknown→3
    (mid-scale). The flag `auto_derived` makes it clear the operator
    hasn't yet provided explicit ratings, so they can override.
    """
    explicit = [
        asset.confidentiality_rating,
        asset.integrity_rating,
        asset.availability_rating,
    ]
    has_any_explicit = any(v is not None for v in explicit)

    # Default ladder keyed by criticality. Mid-scale neutral when
    # criticality itself is unknown.
    crit = (asset.criticality or "").lower()
    DEFAULTS = {
        "critical": 5, "high": 4, "medium": 3, "low": 2,
    }
    default_val = DEFAULTS.get(crit, 3)

    c = asset.confidentiality_rating if asset.confidentiality_rating is not None else default_val
    i = asset.integrity_rating       if asset.integrity_rating       is not None else default_val
    a = asset.availability_rating    if asset.availability_rating    is not None else default_val

    avg = (c + i + a) / 3.0
    # Normalize 1..5 → 0..1. Higher CIA value → higher risk weight.
    norm = max(0.0, (avg - 1) / 4)
    return {
        "score": round(norm, 4), "known": True,
        "confidentiality": c,
        "integrity": i,
        "availability": a,
        "missing": not has_any_explicit,
        "auto_derived": not has_any_explicit,
        "derived_from": f"criticality={crit!r}" if not has_any_explicit else None,
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
    owner_id: Optional[int] = None,
) -> Dict[str, Any]:
    """Tenant-wide rollup — per-asset rows + aggregate stats.

    `owner_id`, if set, scopes the rollup to assets the caller owns. The
    Banking User (and any other non-tenant-wide role) only gets to see
    their own slice of the posture so the dashboard shows their
    responsibility, not the whole bank's. Administrators / Auditors /
    Scanning Admins call this without the filter and get the full estate.
    """
    # Pull this tenant's effective weights once; same number that drives
    # every per-asset compute below, so the response field and the math
    # stay in lock-step.
    weights = resolve_weights_for_tenant(db, tenant_id)
    asset_q = db.query(ITAsset).filter(ITAsset.tenant_id == tenant_id)
    if owner_id is not None:
        asset_q = asset_q.filter(ITAsset.owner_id == owner_id)
    assets = asset_q.all()
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
