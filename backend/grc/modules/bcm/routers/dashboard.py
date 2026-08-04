"""BCM dashboard KPIs, per-tenant settings, and lightweight picker options
(documents / incidents / risks / users) so BCM users don't need to hold other
modules' permissions just to reference their records."""
from datetime import datetime, timedelta
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ....models import (
    BcmPlan, BcmBiaRecord, BcmDrill, BcmDrillResult, BcmFinding,
    GovernanceDocument, RiskIncident, Risk, ITAsset, GRCUser, get_db,
)
from ....routers.auth_router import require_auth, get_user_tenants, require_tenant_permission
from ._common import (
    SEVERITIES, get_or_create_settings, is_drill_overdue, finding_issue_view,
    serialize_drill,
)

router = APIRouter(tags=["BCM - Dashboard & Config"])


def _tenant(current_user, db) -> List[int]:
    ids = get_user_tenants(current_user, db)
    if not ids:
        raise HTTPException(status_code=403, detail="User is not associated with any tenant")
    return ids


@router.get("/dashboard")
def dashboard(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _p: bool = Depends(require_tenant_permission("bcm:dashboard:view")),
):
    tenant_ids = _tenant(current_user, db)
    plans = db.query(BcmPlan).filter(BcmPlan.tenant_id.in_(tenant_ids)).all()
    drills = db.query(BcmDrill).filter(BcmDrill.tenant_id.in_(tenant_ids)).all()
    findings = db.query(BcmFinding).filter(BcmFinding.tenant_id.in_(tenant_ids)).all()

    # Plans by status
    plans_by_status = {}
    for p in plans:
        plans_by_status[p.status] = plans_by_status.get(p.status, 0) + 1
    active_plans = [p for p in plans if p.status != "retired"]

    # Drills by effective status (overdue overrides scheduled)
    drills_by_status = {}
    overdue_count = 0
    for d in drills:
        eff = "overdue" if is_drill_overdue(d) else d.status
        drills_by_status[eff] = drills_by_status.get(eff, 0) + 1
        if eff == "overdue":
            overdue_count += 1

    # Drill coverage — active plans with >=1 drill in the trailing 12 months
    window_start = datetime.utcnow() - timedelta(days=365)
    plan_ids_with_recent_drill = set()
    for d in drills:
        anchor = d.scheduled_date or d.created_at
        if anchor and anchor >= window_start:
            plan_ids_with_recent_drill.add(d.plan_id)
    active_ids = {p.id for p in active_plans}
    covered = len(active_ids & plan_ids_with_recent_drill)
    coverage_pct = round((covered / len(active_ids)) * 100, 1) if active_ids else 0.0

    # RTO/RPO pass rate — over drills that have a recorded result
    results = db.query(BcmDrillResult).filter(BcmDrillResult.tenant_id.in_(tenant_ids)).all()
    rto_total = sum(1 for r in results if r.rto_met is not None)
    rto_pass = sum(1 for r in results if r.rto_met is True)
    rpo_total = sum(1 for r in results if r.rpo_met is not None)
    rpo_pass = sum(1 for r in results if r.rpo_met is True)
    rto_pass_rate = round((rto_pass / rto_total) * 100, 1) if rto_total else None
    rpo_pass_rate = round((rpo_pass / rpo_total) * 100, 1) if rpo_total else None

    # Open findings by severity + cross-module linkage rollups. A finding is
    # "open" when it has no linked issue, or its linked issue is still open.
    open_by_severity = {s: 0 for s in SEVERITIES}
    open_findings_total = 0
    open_capas = 0          # findings whose linked Issue/CAPA is still open
    total_capas = 0         # findings that have a linked Issue/CAPA at all
    findings_linked_risk = 0
    for f in findings:
        view = finding_issue_view(db, f)
        if view["is_open"]:
            open_findings_total += 1
            open_by_severity[f.severity] = open_by_severity.get(f.severity, 0) + 1
        if f.linked_issue_id:
            total_capas += 1
            if view["is_open"]:
                open_capas += 1
        if f.linked_risk_id:
            findings_linked_risk += 1

    bia_linked_risk = db.query(BcmBiaRecord).filter(
        BcmBiaRecord.tenant_id.in_(tenant_ids), BcmBiaRecord.linked_risk_id.isnot(None)
    ).count()
    incident_invocations = sum(1 for d in drills if d.source_type == "incident_triggered")

    # Recent + overdue drill spotlights
    recent = sorted(drills, key=lambda d: (d.updated_at or d.created_at or datetime.min), reverse=True)[:6]
    overdue_list = [d for d in drills if is_drill_overdue(d)]
    overdue_list = sorted(overdue_list, key=lambda d: d.scheduled_date or datetime.min)[:6]

    return {
        "totals": {
            "plans": len(plans),
            "active_plans": len(active_plans),
            "drills": len(drills),
            "overdue_drills": overdue_count,
            "bia_records": db.query(BcmBiaRecord).filter(BcmBiaRecord.tenant_id.in_(tenant_ids)).count(),
            "open_findings": open_findings_total,
        },
        "plans_by_status": plans_by_status,
        "drills_by_status": drills_by_status,
        "drill_coverage_pct": coverage_pct,
        "coverage_detail": {"covered": covered, "active_plans": len(active_ids)},
        "rto_pass_rate": rto_pass_rate,
        "rpo_pass_rate": rpo_pass_rate,
        "results_scored": len(results),
        "open_findings_by_severity": open_by_severity,
        # Cross-module linkage rollup (Issues/CAPA, Risk Register, Incidents).
        "linkage": {
            "open_capas": open_capas,
            "total_capas": total_capas,
            "risks_linked": bia_linked_risk + findings_linked_risk,
            "incident_invocations": incident_invocations,
        },
        "recent_drills": [serialize_drill(db, d) for d in recent],
        "overdue_drills": [serialize_drill(db, d) for d in overdue_list],
    }


# ── Settings ────────────────────────────────────────────────────────────────
class SettingsUpdate(BaseModel):
    finding_issue_threshold: Optional[str] = None


@router.get("/settings")
def get_settings(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _p: bool = Depends(require_tenant_permission("bcm:dashboard:view")),
):
    tenant_ids = _tenant(current_user, db)
    s = get_or_create_settings(db, tenant_ids[0])
    db.commit()
    return {"finding_issue_threshold": s.finding_issue_threshold}


@router.put("/settings")
def update_settings(
    payload: SettingsUpdate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _p: bool = Depends(require_tenant_permission("bcm:plans:edit")),
):
    tenant_ids = _tenant(current_user, db)
    s = get_or_create_settings(db, tenant_ids[0])
    if payload.finding_issue_threshold is not None:
        if payload.finding_issue_threshold not in SEVERITIES:
            raise HTTPException(status_code=400, detail=f"Invalid threshold. One of {sorted(SEVERITIES)}")
        s.finding_issue_threshold = payload.finding_issue_threshold
    s.updated_at = datetime.utcnow()
    db.commit()
    return {"finding_issue_threshold": s.finding_issue_threshold}


# ── Picker options (no cross-module permission required) ─────────────────────
@router.get("/document-options")
def document_options(
    search: Optional[str] = Query(None),
    limit: int = 50,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _p: bool = Depends(require_tenant_permission("bcm:plans:view")),
):
    tenant_ids = _tenant(current_user, db)
    q = db.query(GovernanceDocument).filter(GovernanceDocument.tenant_id.in_(tenant_ids))
    if search:
        q = q.filter(GovernanceDocument.title.ilike(f"%{search}%"))
    rows = q.order_by(GovernanceDocument.updated_at.desc().nullslast()).limit(limit).all()
    return {"items": [
        {"value": d.id, "label": d.title, "subLabel": d.doc_type or d.document_code or None}
        for d in rows
    ]}


@router.get("/incident-options")
def incident_options(
    search: Optional[str] = Query(None),
    limit: int = 50,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _p: bool = Depends(require_tenant_permission("bcm:drills:view")),
):
    tenant_ids = _tenant(current_user, db)
    q = db.query(RiskIncident).filter(RiskIncident.tenant_id.in_(tenant_ids))
    if search:
        q = q.filter(RiskIncident.title.ilike(f"%{search}%"))
    rows = q.order_by(RiskIncident.incident_date.desc().nullslast()).limit(limit).all()
    return {"items": [
        {"value": i.id, "label": i.title, "subLabel": f"{i.severity or ''} · {i.status or ''}".strip(" ·")}
        for i in rows
    ]}


@router.get("/risk-options")
def risk_options(
    search: Optional[str] = Query(None),
    limit: int = 50,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _p: bool = Depends(require_tenant_permission("bcm:findings:view")),
):
    tenant_ids = _tenant(current_user, db)
    q = db.query(Risk).filter(Risk.tenant_id.in_(tenant_ids))
    if search:
        q = q.filter(Risk.title.ilike(f"%{search}%"))
    rows = q.order_by(Risk.updated_at.desc().nullslast()).limit(limit).all()
    return {"items": [
        {"value": r.id, "label": r.title, "subLabel": r.register_type or r.category or None}
        for r in rows
    ]}


@router.get("/asset-options")
def asset_options(
    search: Optional[str] = Query(None),
    limit: int = 100,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _p: bool = Depends(require_tenant_permission("bcm:bia:view")),
):
    tenant_ids = _tenant(current_user, db)
    q = db.query(ITAsset).filter(ITAsset.tenant_id.in_(tenant_ids))
    if search:
        q = q.filter(ITAsset.name.ilike(f"%{search}%"))
    rows = q.order_by(ITAsset.name.asc().nullslast()).limit(limit).all()
    return {"items": [
        {"value": a.id, "label": a.name, "subLabel": a.asset_type or None}
        for a in rows
    ]}


@router.get("/user-options")
def user_options(
    search: Optional[str] = Query(None),
    limit: int = 100,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _p: bool = Depends(require_tenant_permission("bcm:plans:view")),
):
    _tenant(current_user, db)  # authorize; users are per-tenant-DB (no tenant_id column)
    q = db.query(GRCUser).filter(GRCUser.is_active == True)  # noqa: E712
    if search:
        like = f"%{search}%"
        q = q.filter((GRCUser.display_name.ilike(like)) | (GRCUser.email.ilike(like)))
    rows = q.order_by(GRCUser.display_name.asc().nullslast()).limit(limit).all()
    return {"items": [
        {"value": u.id, "label": u.display_name or u.email, "subLabel": u.email}
        for u in rows
    ]}
