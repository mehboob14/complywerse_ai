"""Phase 9 — Cross-domain power search + analytics + reports.

One router covers the full Phase 9 surface so the UI hits a single
namespace:

  * `/search/power` — faceted cross-domain search.
  * `/analytics/exception-aging`, `/analytics/executive-dashboard`,
    `/analytics/analyst-dashboard`, `/analytics/patch-correlation`,
    `/analytics/vendor-risk` — read-only aggregations.
  * `/reports/exceptions-active`, `/reports/remediation-timeline`,
    `/reports/asset-register`, `/reports/patch-evidence` — exportable
    CSV / Excel. PDF is out of scope until a templating engine lands.

Every endpoint is tenant-scoped via `get_user_tenants` so the same
auth/RLS posture as the rest of the platform.
"""
from __future__ import annotations

import csv
import io
import logging
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from sqlalchemy import case, func, or_
from sqlalchemy.orm import Session

from ..models import GRCUser, ITAsset, Risk, Vulnerability, VulnerabilityAssetLink, get_db
from .auth_router import require_auth, get_user_tenants

logger = logging.getLogger(__name__)

router = APIRouter(tags=["Analytics & Search"])


# Severities the dashboards treat as "open and material". Mirrors the
# default vuln-register filter.
_OPEN_STATUSES = ("open", "in_progress", "in-progress", "reopened")
_CLOSED_STATUSES = (
    "resolved", "remediated", "verified", "closed",
    "accepted", "false_positive", "auto_closed_decommissioned",
)


# ─── Phase 9.2: Power search ────────────────────────────────────────────────


def _ilike(term: str) -> str:
    """Build a safe ILIKE pattern: escape SQL wildcards then wrap in %…%."""
    safe = term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{safe}%"


@router.get("/search/power")
def power_search(
    q: str = Query(..., min_length=2, max_length=200, description="Search term (min 2 chars)"),
    domains: Optional[str] = Query(
        None,
        description="Comma-separated list of domains to search: vulnerabilities, assets, risks. Default = all.",
    ),
    per_domain_limit: int = Query(10, ge=1, le=50),
    # Phase 9 faceted filters. All optional; vulnerabilities-only.
    severity: Optional[str] = Query(None, description="Vuln severity filter (critical/high/medium/low/info)."),
    kev_only: bool = Query(False, description="Only KEV-flagged vulns."),
    min_priority: Optional[float] = Query(None, ge=0, le=10),
    asset_criticality: Optional[str] = Query(None, description="Asset criticality (critical/high/medium/low)."),
    lifecycle_state: Optional[str] = Query(None, description="Asset lifecycle state."),
    source: Optional[str] = Query(None, description="Asset source (aws_inspector/azure_defender/gcp_scc/nessus/...)."),
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """Cross-domain faceted search. Returns typed hits with id + title +
    meta so the frontend can render a unified result list and link straight
    to each detail page.

    Vulnerability filters (severity / KEV / min priority) apply only to the
    vulnerabilities slice. Asset filters (criticality / lifecycle / source)
    apply to the asset slice. Each domain is independent.
    """
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return {"q": q, "results": {}, "total": 0}

    pattern = _ilike(q.strip())
    domains_set = (
        {d.strip().lower() for d in (domains or "").split(",") if d.strip()}
        if domains
        else {"vulnerabilities", "assets", "risks"}
    )

    results: Dict[str, List[Dict[str, Any]]] = {}
    total = 0

    if "vulnerabilities" in domains_set:
        try:
            vq = (
                db.query(Vulnerability)
                .filter(Vulnerability.tenant_id.in_(user_tenants))
                .filter(or_(
                    Vulnerability.title.ilike(pattern),
                    Vulnerability.cve_id.ilike(pattern),
                    Vulnerability.vuln_id.ilike(pattern),
                ))
            )
            if severity:
                vq = vq.filter(Vulnerability.severity == severity.lower())
            if kev_only:
                vq = vq.filter(Vulnerability.kev_flag.is_(True))
            if min_priority is not None:
                vq = vq.filter(Vulnerability.composite_priority >= min_priority)
            vuln_rows = (
                vq.order_by(Vulnerability.composite_priority.desc().nulls_last(),
                            Vulnerability.created_at.desc())
                .limit(per_domain_limit)
                .all()
            )
            hits = [
                {
                    "type": "vulnerability",
                    "id": v.id,
                    "title": v.title,
                    "subtitle": v.cve_id or v.vuln_id,
                    "severity": v.severity,
                    "status": v.status,
                    "url": f"/vulnerabilities/{v.id}",
                }
                for v in vuln_rows
            ]
            results["vulnerabilities"] = hits
            total += len(hits)
        except Exception:
            logger.exception("power_search: vulnerability query failed")
            results["vulnerabilities"] = []

    if "assets" in domains_set:
        try:
            aq = (
                db.query(ITAsset)
                .filter(ITAsset.tenant_id.in_(user_tenants))
                .filter(or_(
                    ITAsset.name.ilike(pattern),
                    ITAsset.host_name.ilike(pattern),
                    ITAsset.ip_address.ilike(pattern),
                    ITAsset.description.ilike(pattern),
                ))
            )
            if asset_criticality:
                aq = aq.filter(ITAsset.criticality == asset_criticality.lower())
            if lifecycle_state:
                aq = aq.filter(ITAsset.lifecycle_state == lifecycle_state.lower())
            if source:
                aq = aq.filter(ITAsset.last_seen_source == source.lower())
            asset_rows = (
                aq.order_by(ITAsset.criticality_score.desc().nulls_last(),
                            ITAsset.created_at.desc())
                .limit(per_domain_limit)
                .all()
            )
            hits = [
                {
                    "type": "asset",
                    "id": a.id,
                    "title": a.name,
                    "subtitle": a.host_name or a.ip_address,
                    "asset_type": a.asset_type,
                    "criticality": a.criticality,
                    "url": f"/assets/{a.id}",
                }
                for a in asset_rows
            ]
            results["assets"] = hits
            total += len(hits)
        except Exception:
            logger.exception("power_search: asset query failed")
            results["assets"] = []

    if "risks" in domains_set:
        try:
            risk_rows = (
                db.query(Risk)
                .filter(Risk.tenant_id.in_(user_tenants))
                .filter(or_(
                    Risk.title.ilike(pattern),
                    Risk.description.ilike(pattern),
                ))
                .order_by(Risk.created_at.desc())
                .limit(per_domain_limit)
                .all()
            )
            hits = [
                {
                    "type": "risk",
                    "id": r.id,
                    "title": r.title,
                    "subtitle": getattr(r, "category", None),
                    "status": getattr(r, "status", None),
                    "url": f"/risks/{r.id}",
                }
                for r in risk_rows
            ]
            results["risks"] = hits
            total += len(hits)
        except Exception:
            logger.exception("power_search: risk query failed")
            results["risks"] = []

    return {"q": q, "results": results, "total": total}


# ─── Phase 9.1: Exception-aging analytics ───────────────────────────────────


@router.get("/analytics/exception-aging")
def exception_aging(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """Aging buckets + lifecycle counts for exceptions. Drives:
      * The dashboard tile "Exceptions due for review".
      * The "Exception Aging" report.
      * The auditor's pre-audit dump.

    All counts are tenant-scoped. Uses the Phase 8 columns
    (`exception_status`, `exception_expires_at`, `exception_requested_at`).
    """
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return _empty_exception_aging()

    base = db.query(Vulnerability).filter(Vulnerability.tenant_id.in_(user_tenants))
    now = datetime.utcnow()

    # ── State counts ─────────────────────────────────────────────────────
    counts_by_state: Dict[str, int] = {state: 0 for state in (
        "none", "requested", "approved", "denied", "expired", "revoked",
    )}
    state_rows = (
        base.with_entities(Vulnerability.exception_status, Vulnerability.id)
        .filter(Vulnerability.exception_status.isnot(None))
        .all()
    )
    for state, _ in state_rows:
        key = (state or "none").lower()
        counts_by_state[key] = counts_by_state.get(key, 0) + 1

    # ── Approved-and-active aging buckets (since approval) ───────────────
    approved_rows = (
        base.filter(Vulnerability.exception_status == "approved")
        .with_entities(
            Vulnerability.id,
            Vulnerability.exception_approved_at,
            Vulnerability.exception_expires_at,
        )
        .all()
    )
    aging_buckets = {"0-30d": 0, "31-60d": 0, "61-90d": 0, "90+d": 0, "no_approval_date": 0}
    expiring_within = {"7d": 0, "14d": 0, "30d": 0}
    expired_unactioned = 0
    for _id, approved_at, expires_at in approved_rows:
        if approved_at is None:
            aging_buckets["no_approval_date"] += 1
        else:
            age_days = (now - approved_at).days
            if age_days <= 30:
                aging_buckets["0-30d"] += 1
            elif age_days <= 60:
                aging_buckets["31-60d"] += 1
            elif age_days <= 90:
                aging_buckets["61-90d"] += 1
            else:
                aging_buckets["90+d"] += 1
        if expires_at is not None:
            delta = (expires_at - now).total_seconds() / 86400.0
            if delta < 0:
                # Approved + past expiry but the sweep hasn't run yet —
                # surface so an operator notices.
                expired_unactioned += 1
            else:
                if delta <= 7:
                    expiring_within["7d"] += 1
                if delta <= 14:
                    expiring_within["14d"] += 1
                if delta <= 30:
                    expiring_within["30d"] += 1

    # ── Pending request aging — request → approval delay tells us how
    #    backlogged the reviewers are. ────────────────────────────────────
    pending_rows = (
        base.filter(Vulnerability.exception_status == "requested")
        .with_entities(Vulnerability.exception_requested_at)
        .all()
    )
    pending_aging = {"0-7d": 0, "8-14d": 0, "15-30d": 0, "30+d": 0}
    for (requested_at,) in pending_rows:
        if requested_at is None:
            continue
        age_days = (now - requested_at).days
        if age_days <= 7:
            pending_aging["0-7d"] += 1
        elif age_days <= 14:
            pending_aging["8-14d"] += 1
        elif age_days <= 30:
            pending_aging["15-30d"] += 1
        else:
            pending_aging["30+d"] += 1

    return {
        "generated_at": now.isoformat(),
        "counts_by_state": counts_by_state,
        "active_aging_buckets": aging_buckets,
        "expiring_within": expiring_within,
        "expired_unactioned": expired_unactioned,
        "pending_request_aging": pending_aging,
    }


def _empty_exception_aging() -> Dict[str, Any]:
    return {
        "generated_at": datetime.utcnow().isoformat(),
        "counts_by_state": {state: 0 for state in (
            "none", "requested", "approved", "denied", "expired", "revoked",
        )},
        "active_aging_buckets": {"0-30d": 0, "31-60d": 0, "61-90d": 0, "90+d": 0, "no_approval_date": 0},
        "expiring_within": {"7d": 0, "14d": 0, "30d": 0},
        "expired_unactioned": 0,
        "pending_request_aging": {"0-7d": 0, "8-14d": 0, "15-30d": 0, "30+d": 0},
    }


# ─── Phase 9: Executive dashboard ──────────────────────────────────────────


@router.get("/analytics/executive-dashboard")
def executive_dashboard(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """High-level posture summary. Powers the Executive Dashboard page:
    gauges for open critical/high, KEV exposure, SLA performance, and
    asset coverage by source/cloud."""
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return _empty_executive()

    vbase = db.query(Vulnerability).filter(Vulnerability.tenant_id.in_(user_tenants))
    abase = db.query(ITAsset).filter(ITAsset.tenant_id.in_(user_tenants))

    open_vulns = vbase.filter(Vulnerability.status.in_(_OPEN_STATUSES))

    by_severity: Dict[str, int] = {}
    sev_rows = (
        open_vulns.with_entities(Vulnerability.severity, func.count(Vulnerability.id))
        .group_by(Vulnerability.severity).all()
    )
    for sev, n in sev_rows:
        by_severity[(sev or "unknown").lower()] = int(n or 0)

    open_total = sum(by_severity.values())
    kev_open = open_vulns.filter(Vulnerability.kev_flag.is_(True)).count()
    overdue = open_vulns.filter(
        Vulnerability.due_date.isnot(None),
        Vulnerability.due_date < datetime.utcnow(),
    ).count()

    # SLA performance: ratio of NON-overdue open vulns. Defensive against
    # divide-by-zero.
    sla_ok = open_total - overdue if open_total else 0
    sla_pct = round((sla_ok / open_total) * 100, 1) if open_total else 100.0

    # Asset coverage by source.
    src_rows = (
        abase.with_entities(ITAsset.last_seen_source, func.count(ITAsset.id))
        .group_by(ITAsset.last_seen_source).all()
    )
    by_source: Dict[str, int] = {}
    for src, n in src_rows:
        by_source[(src or "manual").lower()] = int(n or 0)
    cloud_assets = sum(
        n for s, n in by_source.items() if s in ("aws_inspector", "azure_defender", "gcp_scc")
    )
    total_assets = sum(by_source.values())

    # Top 10 affected assets — vulns linked.
    top_assets_rows = (
        db.query(
            ITAsset.id, ITAsset.name, ITAsset.criticality, ITAsset.last_seen_source,
            func.count(VulnerabilityAssetLink.id).label("vuln_count"),
        )
        .outerjoin(VulnerabilityAssetLink, VulnerabilityAssetLink.asset_id == ITAsset.id)
        .outerjoin(Vulnerability, Vulnerability.id == VulnerabilityAssetLink.vulnerability_id)
        .filter(ITAsset.tenant_id.in_(user_tenants))
        .filter(Vulnerability.status.in_(_OPEN_STATUSES))
        .group_by(ITAsset.id, ITAsset.name, ITAsset.criticality, ITAsset.last_seen_source)
        .order_by(func.count(VulnerabilityAssetLink.id).desc())
        .limit(10)
        .all()
    )

    # 90-day trend — count of vulns created per week.
    cutoff_90 = datetime.utcnow() - timedelta(days=90)
    trend_rows = (
        vbase.filter(Vulnerability.created_at >= cutoff_90)
        .with_entities(Vulnerability.created_at, Vulnerability.severity)
        .all()
    )
    weekly_buckets: Dict[str, Dict[str, int]] = {}
    for created_at, sev in trend_rows:
        if created_at is None:
            continue
        # ISO week key.
        key = created_at.strftime("%Y-W%V")
        if key not in weekly_buckets:
            weekly_buckets[key] = {"critical": 0, "high": 0, "medium": 0, "low": 0}
        slot = (sev or "low").lower()
        if slot not in weekly_buckets[key]:
            slot = "low"
        weekly_buckets[key][slot] += 1
    trend = sorted(
        [{"week": k, **v} for k, v in weekly_buckets.items()],
        key=lambda r: r["week"],
    )

    return {
        "generated_at": datetime.utcnow().isoformat(),
        "open_total": open_total,
        "open_by_severity": by_severity,
        "kev_open": kev_open,
        "overdue_open": overdue,
        "sla_performance_pct": sla_pct,
        "assets_total": total_assets,
        "cloud_assets": cloud_assets,
        "assets_by_source": by_source,
        "top_affected_assets": [
            {
                "id": r[0], "name": r[1], "criticality": r[2],
                "source": r[3], "open_vuln_count": int(r[4] or 0),
            }
            for r in top_assets_rows
        ],
        "trend_90d": trend,
    }


def _empty_executive() -> Dict[str, Any]:
    return {
        "generated_at": datetime.utcnow().isoformat(),
        "open_total": 0,
        "open_by_severity": {},
        "kev_open": 0,
        "overdue_open": 0,
        "sla_performance_pct": 100.0,
        "assets_total": 0,
        "cloud_assets": 0,
        "assets_by_source": {},
        "top_affected_assets": [],
        "trend_90d": [],
    }


# ─── Phase 9: Analyst dashboard ─────────────────────────────────────────────


@router.get("/analytics/analyst-dashboard")
def analyst_dashboard(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """Working-list view for an individual analyst. My-assigned, due-this-week,
    recent ingest activity, stale assets."""
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return _empty_analyst()

    me = current_user.id
    vbase = db.query(Vulnerability).filter(Vulnerability.tenant_id.in_(user_tenants))

    my_open = (
        vbase.filter(Vulnerability.assigned_to == me)
        .filter(Vulnerability.status.in_(_OPEN_STATUSES))
        .order_by(Vulnerability.composite_priority.desc().nulls_last())
        .limit(25)
        .all()
    )

    now = datetime.utcnow()
    in_week = now + timedelta(days=7)
    due_this_week = (
        vbase.filter(Vulnerability.assigned_to == me)
        .filter(Vulnerability.status.in_(_OPEN_STATUSES))
        .filter(Vulnerability.due_date.isnot(None))
        .filter(Vulnerability.due_date <= in_week)
        .order_by(Vulnerability.due_date.asc())
        .limit(25)
        .all()
    )

    pending_approvals = (
        vbase.filter(Vulnerability.exception_status == "requested")
        .filter(Vulnerability.exception_requested_by_id != me)
        .order_by(Vulnerability.exception_requested_at.asc())
        .limit(25)
        .all()
    )

    # Recent ingest activity — vulns created in the last 7 days.
    cutoff_7 = now - timedelta(days=7)
    recent_count = vbase.filter(Vulnerability.created_at >= cutoff_7).count()

    # Stale assets (not seen in 30+ days).
    stale_cutoff = now - timedelta(days=30)
    stale_assets = (
        db.query(ITAsset)
        .filter(ITAsset.tenant_id.in_(user_tenants))
        .filter(or_(
            ITAsset.last_seen_at.is_(None),
            ITAsset.last_seen_at < stale_cutoff,
        ))
        .order_by(ITAsset.last_seen_at.asc().nulls_first())
        .limit(15)
        .all()
    )

    def _short_v(v):
        return {
            "id": v.id, "vuln_id": v.vuln_id, "title": v.title,
            "severity": v.severity, "status": v.status,
            "due_date": v.due_date.isoformat() if v.due_date else None,
            "composite_priority": v.composite_priority,
            "exception_status": v.exception_status,
            "exception_requested_at": v.exception_requested_at.isoformat() if v.exception_requested_at else None,
        }

    return {
        "generated_at": now.isoformat(),
        "user_id": me,
        "my_open_vulnerabilities": [_short_v(v) for v in my_open],
        "due_this_week": [_short_v(v) for v in due_this_week],
        "pending_approvals": [_short_v(v) for v in pending_approvals],
        "recent_ingest_count_7d": recent_count,
        "stale_assets": [
            {
                "id": a.id, "name": a.name,
                "last_seen_at": a.last_seen_at.isoformat() if a.last_seen_at else None,
                "last_seen_source": a.last_seen_source,
                "criticality": a.criticality,
            }
            for a in stale_assets
        ],
    }


def _empty_analyst() -> Dict[str, Any]:
    return {
        "generated_at": datetime.utcnow().isoformat(),
        "user_id": None,
        "my_open_vulnerabilities": [],
        "due_this_week": [],
        "pending_approvals": [],
        "recent_ingest_count_7d": 0,
        "stale_assets": [],
    }


# ─── Phase 9: Patch correlation analytics ──────────────────────────────────


@router.get("/analytics/patch-correlation")
def patch_correlation(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """"One patch fixes N findings" view. Aggregates the Phase 6
    `patch_references` JSON column to surface KB articles that resolve the
    most vulnerabilities."""
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return {"by_kb": [], "by_cve": []}

    rows = (
        db.query(Vulnerability)
        .filter(Vulnerability.tenant_id.in_(user_tenants))
        .filter(Vulnerability.status.in_(_OPEN_STATUSES))
        .filter(Vulnerability.patch_references.isnot(None))
        .all()
    )

    kb_counts: Dict[str, int] = {}
    kb_assets: Dict[str, set] = {}
    for v in rows:
        refs = v.patch_references or []
        if not isinstance(refs, list):
            continue
        # Asset ids for this vuln — used to count distinct affected hosts.
        asset_ids = {link.asset_id for link in (v.asset_links or [])} if hasattr(v, "asset_links") else set()
        for ref in refs:
            if not isinstance(ref, dict):
                continue
            if (ref.get("type") or "").lower() != "kb":
                continue
            kb_id = (ref.get("id") or "").upper()
            if not kb_id:
                continue
            kb_counts[kb_id] = kb_counts.get(kb_id, 0) + 1
            kb_assets.setdefault(kb_id, set()).update(asset_ids)

    by_kb = sorted(
        [
            {"kb_id": kb, "finding_count": n, "affected_assets": len(kb_assets.get(kb, set()))}
            for kb, n in kb_counts.items()
        ],
        key=lambda r: r["finding_count"],
        reverse=True,
    )[:50]

    # By CVE — how many vulns per CVE_ID across distinct assets.
    cve_rows = (
        db.query(Vulnerability.cve_id, func.count(Vulnerability.id))
        .filter(Vulnerability.tenant_id.in_(user_tenants))
        .filter(Vulnerability.cve_id.isnot(None))
        .filter(Vulnerability.status.in_(_OPEN_STATUSES))
        .group_by(Vulnerability.cve_id)
        .order_by(func.count(Vulnerability.id).desc())
        .limit(50)
        .all()
    )
    by_cve = [
        {
            "cve_id": cve,
            "finding_count": int(n or 0),
            "affected_assets": int(n or 0),  # Approximation; equal to finding count for now.
        }
        for cve, n in cve_rows
    ]

    return {"by_kb": by_kb, "by_cve": by_cve}


# ─── Phase 9: Vendor risk analytics ────────────────────────────────────────


@router.get("/analytics/vendor-risk")
def vendor_risk(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """Vuln count + severity distribution by vendor (from the asset's
    `vendor` field). Drives a vendor risk widget on the executive dashboard
    and a standalone analytics view."""
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return {"by_vendor": [], "by_cwe": []}

    rows = (
        db.query(
            ITAsset.vendor,
            Vulnerability.severity,
            func.count(Vulnerability.id),
        )
        .join(VulnerabilityAssetLink, VulnerabilityAssetLink.asset_id == ITAsset.id)
        .join(Vulnerability, Vulnerability.id == VulnerabilityAssetLink.vulnerability_id)
        .filter(ITAsset.tenant_id.in_(user_tenants))
        .filter(Vulnerability.status.in_(_OPEN_STATUSES))
        .group_by(ITAsset.vendor, Vulnerability.severity)
        .all()
    )

    by_vendor_acc: Dict[str, Dict[str, int]] = {}
    for vendor, sev, n in rows:
        key = (vendor or "unknown").lower()
        slot = by_vendor_acc.setdefault(key, {
            "vendor": vendor or "unknown",
            "vuln_count": 0,
            "critical_count": 0,
            "high_count": 0,
            "medium_count": 0,
            "low_count": 0,
        })
        slot["vuln_count"] += int(n or 0)
        sev_key = (sev or "low").lower()
        if sev_key in ("critical", "high", "medium", "low"):
            slot[f"{sev_key}_count"] += int(n or 0)

    by_vendor = sorted(
        list(by_vendor_acc.values()),
        key=lambda r: (r["critical_count"], r["high_count"], r["vuln_count"]),
        reverse=True,
    )[:50]

    # CWE distribution.
    cwe_rows = (
        db.query(Vulnerability.cwe_id, func.count(Vulnerability.id))
        .filter(Vulnerability.tenant_id.in_(user_tenants))
        .filter(Vulnerability.cwe_id.isnot(None))
        .filter(Vulnerability.status.in_(_OPEN_STATUSES))
        .group_by(Vulnerability.cwe_id)
        .order_by(func.count(Vulnerability.id).desc())
        .limit(25)
        .all()
    )
    by_cwe = [{"cwe_id": c, "count": int(n or 0)} for c, n in cwe_rows]

    return {"by_vendor": by_vendor, "by_cwe": by_cwe}


# ─── Phase 9: Compliance reports (CSV / Excel exports) ────────────────────


def _csv_response(filename: str, headers: List[str], rows: List[List[Any]]) -> StreamingResponse:
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(headers)
    for r in rows:
        writer.writerow(r)
    buf.seek(0)
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


def _xlsx_response(filename: str, headers: List[str], rows: List[List[Any]]) -> StreamingResponse:
    try:
        from openpyxl import Workbook
    except Exception:
        # openpyxl is in requirements, but degrade to CSV if somehow missing.
        return _csv_response(filename.replace(".xlsx", ".csv"), headers, rows)
    wb = Workbook()
    ws = wb.active
    ws.append(headers)
    for r in rows:
        ws.append([_xlsx_safe(c) for c in r])
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


def _xlsx_safe(value: Any) -> Any:
    """Convert datetimes + None to spreadsheet-friendly values."""
    if value is None:
        return ""
    if isinstance(value, datetime):
        return value.isoformat()
    return value


def _report_export(
    filename_stem: str, headers: List[str], rows: List[List[Any]],
    fmt: Optional[str],
) -> StreamingResponse:
    fmt = (fmt or "csv").lower()
    if fmt == "xlsx":
        return _xlsx_response(f"{filename_stem}.xlsx", headers, rows)
    return _csv_response(f"{filename_stem}.csv", headers, rows)


@router.get("/reports/exceptions-active")
def report_exceptions_active(
    start_date: Optional[str] = Query(None, description="ISO date — only exceptions requested on/after this."),
    end_date: Optional[str] = Query(None, description="ISO date — only exceptions requested on/before this."),
    format: Optional[str] = Query("csv", description="csv or xlsx"),
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """All exceptions active during a date range — the audit report.
    Default range = whole register. Lists every row that was in `approved`
    or `requested` state during the window, plus the surrounding context."""
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return _report_export("exceptions_active", ["No data"], [], format)

    q = (
        db.query(Vulnerability)
        .filter(Vulnerability.tenant_id.in_(user_tenants))
        .filter(Vulnerability.exception_status.isnot(None))
        .filter(Vulnerability.exception_status != "none")
    )
    if start_date:
        try:
            q = q.filter(Vulnerability.exception_requested_at >= datetime.fromisoformat(start_date))
        except ValueError:
            pass
    if end_date:
        try:
            q = q.filter(Vulnerability.exception_requested_at <= datetime.fromisoformat(end_date))
        except ValueError:
            pass

    rows = q.order_by(Vulnerability.exception_requested_at.desc().nulls_last()).all()

    headers = [
        "Vuln ID", "Title", "CVE", "Severity", "Status",
        "Exception status", "Requested at", "Requested by",
        "Approved at", "Expires at", "Justification", "Denial reason",
    ]
    out_rows = [
        [
            v.vuln_id, v.title, v.cve_id, v.severity, v.status,
            v.exception_status, v.exception_requested_at,
            v.exception_requested_by_id,
            v.exception_approved_at, v.exception_expires_at,
            (v.exception_justification or "")[:500],
            (v.exception_denial_reason or "")[:500],
        ]
        for v in rows
    ]
    return _report_export("exceptions_active", headers, out_rows, format)


@router.get("/reports/remediation-timeline")
def report_remediation_timeline(
    format: Optional[str] = Query("csv"),
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """Vuln remediation timeline by CVE. For each closed vuln: when
    discovered, when resolved, total time-to-close, by CVE."""
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return _report_export("remediation_timeline", ["No data"], [], format)

    rows = (
        db.query(Vulnerability)
        .filter(Vulnerability.tenant_id.in_(user_tenants))
        .filter(Vulnerability.status.in_(_CLOSED_STATUSES))
        .filter(Vulnerability.resolved_at.isnot(None))
        .order_by(Vulnerability.resolved_at.desc())
        .all()
    )

    headers = [
        "CVE", "Vuln ID", "Title", "Severity", "Discovered",
        "Resolved", "Days to resolve", "Status",
        "KEV", "EPSS percentile", "Composite priority",
    ]
    out_rows = []
    for v in rows:
        ttc = None
        if v.discovered_at and v.resolved_at:
            ttc = (v.resolved_at - v.discovered_at).days
        out_rows.append([
            v.cve_id or "", v.vuln_id, v.title, v.severity,
            v.discovered_at, v.resolved_at, ttc, v.status,
            bool(v.kev_flag), v.epss_percentile, v.composite_priority,
        ])
    return _report_export("remediation_timeline", headers, out_rows, format)


@router.get("/reports/asset-register")
def report_asset_register(
    format: Optional[str] = Query("csv"),
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """ISO 27001 A.8-style asset register dump. Captures every Phase 5
    column so an auditor can verify ownership chain + classification
    in one export."""
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return _report_export("asset_register", ["No data"], [], format)

    rows = (
        db.query(ITAsset)
        .filter(ITAsset.tenant_id.in_(user_tenants))
        .order_by(ITAsset.name.asc())
        .all()
    )
    headers = [
        "ID", "Name", "Type", "Vendor", "Location", "Host name", "IP",
        "Criticality", "Criticality score", "Data classification",
        "Internet facing", "Business function", "Compliance scope",
        "Owning team", "Primary owner ID", "Secondary owner ID",
        "Business owner ID", "Escalation contact ID",
        "Lifecycle state", "Decommissioned at", "Replacement asset ID",
        "Last seen", "Last seen source", "Created",
    ]
    out_rows = []
    for a in rows:
        out_rows.append([
            a.id, a.name, a.asset_type, a.vendor, a.location,
            a.host_name, a.ip_address,
            a.criticality, a.criticality_score, a.data_classification,
            a.internet_facing, a.business_function,
            ",".join(a.compliance_scope or []),
            a.owning_team, a.primary_owner_id, a.secondary_owner_id,
            a.business_owner_id, a.escalation_contact_id,
            a.lifecycle_state, a.decommissioned_at, a.replacement_asset_id,
            a.last_seen_at, a.last_seen_source, a.created_at,
        ])
    return _report_export("asset_register", headers, out_rows, format)


@router.get("/reports/patch-evidence")
def report_patch_evidence(
    format: Optional[str] = Query("csv"),
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """Patch deployment evidence — vuln-to-closure with the KB articles
    that resolved each. Powered by the Phase 6 `patch_references` column."""
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return _report_export("patch_evidence", ["No data"], [], format)

    rows = (
        db.query(Vulnerability)
        .filter(Vulnerability.tenant_id.in_(user_tenants))
        .filter(Vulnerability.cve_id.isnot(None))
        .order_by(Vulnerability.psirt_synced_at.desc().nulls_last())
        .all()
    )
    headers = [
        "CVE", "Vuln ID", "Title", "Status", "KB articles",
        "Vendor advisory IDs", "Remediation guidance",
        "PSIRT source", "PSIRT synced at", "Discovered", "Resolved",
    ]
    out_rows = []
    for v in rows:
        kbs = ", ".join(
            r.get("id", "") for r in (v.patch_references or [])
            if isinstance(r, dict) and r.get("type") == "kb"
        )
        out_rows.append([
            v.cve_id, v.vuln_id, v.title, v.status, kbs,
            ", ".join(v.vendor_advisory_ids or []),
            (v.remediation_guidance or "")[:500],
            v.psirt_source, v.psirt_synced_at,
            v.discovered_at, v.resolved_at,
        ])
    return _report_export("patch_evidence", headers, out_rows, format)
