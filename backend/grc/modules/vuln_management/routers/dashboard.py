from typing import List, Optional, Dict, Any
from datetime import datetime, timedelta, date
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import func, and_, or_

from ....models import (
    Vulnerability, VulnerabilityAssetLink, VulnerabilitySLAConfig,
    VulnerabilityControlLink, ITAsset, GRCUser, Tenant, get_db,
    GRCDepartment, GRCVulnerabilityDepartmentAssignment, GRCVulnWorkflowState,
    GRCVulnWorkflowHistory, GRCVulnEscalationLog, FrameworkControl,
    NormalizedControl, InternalControl, VulnerabilityMitigation
)

RESOLVED_STATUSES = [
    "resolved", "remediated", "verified", "closed",
    "accepted", "false_positive", "auto_closed_decommissioned",
    "auto_closed_fixed",
]
from ....schemas import (
    VulnerabilityDashboard, OverdueVulnerabilityResponse, AssetExposureResponse
)
from ....routers.auth_router import require_auth, get_user_tenants, get_user_primary_tenant

router = APIRouter(prefix="/dashboard", tags=["Vulnerability Dashboard"])


def validate_tenant_access(user: GRCUser, tenant_id: int, db: Session) -> None:
    user_tenants = get_user_tenants(user, db)
    if tenant_id not in user_tenants:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied to this tenant's data"
        )


@router.get("", response_model=VulnerabilityDashboard)
def get_dashboard(
    tenant_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return VulnerabilityDashboard(
            total_vulnerabilities=0,
            by_severity={},
            by_status={},
            sla_compliance={},
            overdue_count=0,
            mttr_days=None,
            aging_buckets={},
            top_affected_assets=[],
            recent_activities=[],
            by_assignee={},
            mitigation_coverage={},
            by_department={},
            kev_count=0,
            exploit_count=0,
            no_exploit_count=0,
            with_cve_count=0,
            high_tactics_count=0,
            high_tactics_with_exploit_count=0,
            high_epss_count=0,
            internet_exposed_count=0,
            patch_count=0,
            contextual_priority={"urgent": 0, "moderate": 0, "low": 0},
        )
    
    query = db.query(Vulnerability).filter(Vulnerability.tenant_id.in_(user_tenants))
    
    if tenant_id:
        validate_tenant_access(current_user, tenant_id, db)
        query = query.filter(Vulnerability.tenant_id == tenant_id)
        target_tenant = tenant_id
    else:
        target_tenant = get_user_primary_tenant(current_user, db) or user_tenants[0]
    
    vulns = query.all()
    vuln_ids = [v.id for v in vulns]
    
    by_severity = {}
    by_status = {}
    by_assignee = {}
    overdue_count = 0
    kev_count = 0
    exploit_count = 0
    no_exploit_count = 0
    with_cve_count = 0
    high_tactics_count = 0
    high_tactics_with_exploit_count = 0
    high_epss_count = 0
    patch_count = 0
    contextual_priority = {"urgent": 0, "moderate": 0, "low": 0}
    resolved_times = []
    now = datetime.utcnow()

    # Lazy import — the ATT&CK selection path is pure/in-memory and cheap enough
    # to run once per dashboard load over the register (hundreds of rows).
    from ..attack.selection import is_high_tactics
    
    aging_buckets = {
        "0-7 days": 0,
        "8-30 days": 0,
        "31-90 days": 0,
        "90+ days": 0
    }
    
    for v in vulns:
        sev = v.severity or "unknown"
        by_severity[sev] = by_severity.get(sev, 0) + 1
        
        stat = v.status or "open"
        by_status[stat] = by_status.get(stat, 0) + 1
        
        assignee_name = v.assignee.display_name if v.assignee else "Unassigned"
        by_assignee[assignee_name] = by_assignee.get(assignee_name, 0) + 1
        
        if v.due_date and v.due_date < now and v.status not in RESOLVED_STATUSES:
            overdue_count += 1
        
        if v.resolved_at and v.discovered_at:
            resolution_time = (v.resolved_at - v.discovered_at).days
            resolved_times.append(resolution_time)
        
        if v.status not in RESOLVED_STATUSES:
            age_days = (now - v.discovered_at).days if v.discovered_at else 0
            if age_days <= 7:
                aging_buckets["0-7 days"] += 1
            elif age_days <= 30:
                aging_buckets["8-30 days"] += 1
            elif age_days <= 90:
                aging_buckets["31-90 days"] += 1
            else:
                aging_buckets["90+ days"] += 1

        # ── Redesign aggregates — threat/exposure signals + the raw→contextual story.
        if v.kev_flag:
            kev_count += 1
        has_public_exploit = (v.public_exploit_count or 0) > 0 or (v.exploitdb_count or 0) > 0
        if has_public_exploit:
            exploit_count += 1
        else:
            no_exploit_count += 1
        if v.cve_id:
            with_cve_count += 1
        high_tac = is_high_tactics(v.cwe_id, v.cvss_vector)
        if high_tac:
            high_tactics_count += 1
            if has_public_exploit:
                high_tactics_with_exploit_count += 1
        if (v.epss_score or 0) >= 0.1:
            high_epss_count += 1
        if (v.patch_references or []) or (v.remediation_guidance or "").strip():
            patch_count += 1
        # composite_priority is 0–10; ×10 => 0–100, matching the detail page's ring
        # bands (urgent = high+ ≥55, moderate 25–55, low <25). Un-enriched (None) => low.
        cp = (v.composite_priority or 0) * 10
        if cp >= 55:
            contextual_priority["urgent"] += 1
        elif cp >= 25:
            contextual_priority["moderate"] += 1
        else:
            contextual_priority["low"] += 1

    mttr_days = sum(resolved_times) / len(resolved_times) if resolved_times else None
    
    # Mitigation coverage
    if vuln_ids:
        mit_vuln_ids = set(
            row[0] for row in db.query(VulnerabilityMitigation.vulnerability_id)
            .filter(VulnerabilityMitigation.vulnerability_id.in_(vuln_ids))
            .distinct().all()
        )
    else:
        mit_vuln_ids = set()
    mitigation_coverage = {
        "with_mitigations": len(mit_vuln_ids),
        "without_mitigations": len(vuln_ids) - len(mit_vuln_ids)
    }

    # Internet-exposed — distinct findings linked to an internet-facing asset.
    # Honour BOTH exposure columns (canonical `internet_facing` and the legacy
    # `is_internet_facing`) so this KPI never disagrees with the reachability
    # engine / finding pages.
    internet_exposed_count = 0
    if vuln_ids:
        internet_exposed_count = (
            db.query(func.count(func.distinct(VulnerabilityAssetLink.vulnerability_id)))
            .join(ITAsset, ITAsset.id == VulnerabilityAssetLink.asset_id)
            .filter(
                VulnerabilityAssetLink.vulnerability_id.in_(vuln_ids),
                or_(
                    ITAsset.internet_facing.is_(True),
                    ITAsset.is_internet_facing.is_(True),
                ),
            )
            .scalar() or 0
        )

    # Department breakdown
    by_department: Dict[str, int] = {}
    if vuln_ids:
        dept_rows = db.query(
            GRCDepartment.name,
            func.count(GRCVulnerabilityDepartmentAssignment.vulnerability_id).label("cnt")
        ).join(
            GRCVulnerabilityDepartmentAssignment,
            GRCVulnerabilityDepartmentAssignment.department_id == GRCDepartment.id
        ).filter(
            GRCVulnerabilityDepartmentAssignment.vulnerability_id.in_(vuln_ids)
        ).group_by(GRCDepartment.name).all()
        for dept_name, cnt in dept_rows:
            by_department[dept_name] = cnt

    sla_compliance = {}
    for severity in ["critical", "high", "medium", "low", "info"]:
        sev_vulns = [v for v in vulns if v.severity == severity]
        if sev_vulns:
            on_time = sum(1 for v in sev_vulns 
                         if v.status in RESOLVED_STATUSES 
                         and v.resolved_at and v.due_date 
                         and v.resolved_at <= v.due_date)
            total_resolved = sum(1 for v in sev_vulns 
                                if v.status in RESOLVED_STATUSES)
            sla_compliance[severity] = {
                "total": len(sev_vulns),
                "resolved": total_resolved,
                "on_time": on_time,
                "compliance_rate": round((on_time / total_resolved * 100) if total_resolved > 0 else 0, 1)
            }
    
    asset_vuln_counts = db.query(
        VulnerabilityAssetLink.asset_id,
        func.count(VulnerabilityAssetLink.vulnerability_id).label("vuln_count")
    ).join(Vulnerability).filter(
        Vulnerability.tenant_id.in_(user_tenants)
    ).group_by(VulnerabilityAssetLink.asset_id).order_by(
        func.count(VulnerabilityAssetLink.vulnerability_id).desc()
    ).limit(5).all()
    
    top_assets = []
    for asset_id, count in asset_vuln_counts:
        asset = db.query(ITAsset).filter(ITAsset.id == asset_id).first()
        if asset:
            top_assets.append({
                "asset_id": asset_id,
                "asset_name": asset.name,
                "vulnerability_count": count
            })
    
    recent_vulns = db.query(Vulnerability).filter(
        Vulnerability.tenant_id.in_(user_tenants)
    ).order_by(Vulnerability.updated_at.desc()).limit(5).all()
    
    recent_activities = [
        {
            "id": v.id,
            "vuln_id": v.vuln_id,
            "title": v.title,
            "status": v.status,
            "updated_at": v.updated_at.isoformat() if v.updated_at else None
        }
        for v in recent_vulns
    ]
    
    return VulnerabilityDashboard(
        total_vulnerabilities=len(vulns),
        by_severity=by_severity,
        by_status=by_status,
        sla_compliance=sla_compliance,
        overdue_count=overdue_count,
        mttr_days=round(mttr_days, 1) if mttr_days else None,
        aging_buckets=aging_buckets,
        top_affected_assets=top_assets,
        recent_activities=recent_activities,
        by_assignee=by_assignee,
        mitigation_coverage=mitigation_coverage,
        by_department=by_department,
        kev_count=kev_count,
        exploit_count=exploit_count,
        no_exploit_count=no_exploit_count,
        with_cve_count=with_cve_count,
        high_tactics_count=high_tactics_count,
        high_tactics_with_exploit_count=high_tactics_with_exploit_count,
        high_epss_count=high_epss_count,
        internet_exposed_count=internet_exposed_count,
        patch_count=patch_count,
        contextual_priority=contextual_priority,
    )


@router.get("/overdue", response_model=List[OverdueVulnerabilityResponse])
def get_overdue_vulnerabilities(
    tenant_id: Optional[int] = None,
    severity: Optional[str] = None,
    skip: int = 0,
    limit: int = 50,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return []
    
    now = datetime.utcnow()
    
    query = db.query(Vulnerability).options(
        joinedload(Vulnerability.assignee)
    ).filter(
        Vulnerability.tenant_id.in_(user_tenants),
        Vulnerability.due_date < now,
        Vulnerability.status.notin_(RESOLVED_STATUSES)
    )
    
    if tenant_id:
        validate_tenant_access(current_user, tenant_id, db)
        query = query.filter(Vulnerability.tenant_id == tenant_id)
    if severity:
        query = query.filter(Vulnerability.severity == severity)
    
    vulns = query.order_by(Vulnerability.due_date.asc()).offset(skip).limit(limit).all()
    
    return [
        OverdueVulnerabilityResponse(
            id=v.id,
            vuln_id=v.vuln_id,
            title=v.title,
            severity=v.severity,
            status=v.status,
            due_date=v.due_date,
            days_overdue=(now - v.due_date).days,
            assigned_to=v.assigned_to,
            assignee_name=v.assignee.display_name if v.assignee else None
        )
        for v in vulns
    ]


@router.get("/asset-exposure", response_model=List[AssetExposureResponse])
def get_asset_exposure(
    tenant_id: Optional[int] = None,
    limit: int = 20,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return []
    
    if tenant_id:
        validate_tenant_access(current_user, tenant_id, db)
        filter_tenants = [tenant_id]
    else:
        filter_tenants = user_tenants
    
    # Exposure deliberately KEEPS "accepted" — an accepted risk is still
    # present on the asset. Excluded are only statuses meaning the finding is
    # fixed, unfounded, or the host is gone.
    _EXPOSURE_EXCLUDED = [
        "resolved", "false_positive", "remediated", "verified", "closed",
        "auto_closed_decommissioned", "auto_closed_fixed",
    ]
    asset_ids = db.query(VulnerabilityAssetLink.asset_id).join(
        Vulnerability
    ).filter(
        Vulnerability.tenant_id.in_(filter_tenants),
        Vulnerability.status.notin_(_EXPOSURE_EXCLUDED)
    ).distinct().all()
    
    results = []
    for (asset_id,) in asset_ids:
        asset = db.query(ITAsset).filter(ITAsset.id == asset_id).first()
        if not asset:
            continue
        
        vuln_links = db.query(VulnerabilityAssetLink).join(
            Vulnerability
        ).filter(
            VulnerabilityAssetLink.asset_id == asset_id,
            Vulnerability.status.notin_(_EXPOSURE_EXCLUDED)
        ).all()
        
        vuln_ids = [link.vulnerability_id for link in vuln_links]
        vulns = db.query(Vulnerability).filter(Vulnerability.id.in_(vuln_ids)).all()
        
        results.append(AssetExposureResponse(
            asset_id=asset.id,
            asset_name=asset.name,
            asset_type=asset.asset_type,
            vulnerability_count=len(vulns),
            critical_count=sum(1 for v in vulns if v.severity == "critical"),
            high_count=sum(1 for v in vulns if v.severity == "high"),
            medium_count=sum(1 for v in vulns if v.severity == "medium"),
            low_count=sum(1 for v in vulns if v.severity == "low")
        ))
    
    results.sort(key=lambda x: (x.critical_count, x.high_count, x.vulnerability_count), reverse=True)
    
    return results[:limit]


@router.get("/department-metrics")
def get_department_metrics(
    tenant_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return {"departments": [], "unassigned_count": 0}
    
    if tenant_id:
        validate_tenant_access(current_user, tenant_id, db)
        filter_tenants = [tenant_id]
    else:
        filter_tenants = user_tenants
    
    now = datetime.utcnow()
    
    departments = db.query(GRCDepartment).filter(
        GRCDepartment.tenant_id.in_(filter_tenants),
        GRCDepartment.is_active == True
    ).all()
    
    all_vulns = db.query(Vulnerability).filter(
        Vulnerability.tenant_id.in_(filter_tenants)
    ).all()
    
    assigned_vuln_ids = set()
    dept_vuln_map = {}
    
    for dept in departments:
        assignments = db.query(GRCVulnerabilityDepartmentAssignment).filter(
            GRCVulnerabilityDepartmentAssignment.department_id == dept.id
        ).all()
        dept_vuln_ids = [a.vulnerability_id for a in assignments]
        dept_vuln_map[dept.id] = dept_vuln_ids
        assigned_vuln_ids.update(dept_vuln_ids)
    
    unassigned_count = sum(1 for v in all_vulns if v.id not in assigned_vuln_ids)
    
    dept_results = []
    for dept in departments:
        vuln_ids = dept_vuln_map.get(dept.id, [])
        if not vuln_ids:
            dept_results.append({
                "department_id": dept.id,
                "department_name": dept.name,
                "department_code": dept.code,
                "total_vulnerabilities": 0,
                "open_count": 0,
                "resolved_count": 0,
                "mttr_days": None,
                "sla_compliance_percent": 0.0,
                "current_workload": 0,
                "overdue_count": 0,
                "by_severity": {"critical": 0, "high": 0, "medium": 0, "low": 0}
            })
            continue
        
        dept_vulns = db.query(Vulnerability).filter(
            Vulnerability.id.in_(vuln_ids)
        ).all()
        
        open_count = sum(1 for v in dept_vulns if v.status not in RESOLVED_STATUSES)
        resolved_vulns = [v for v in dept_vulns if v.status in RESOLVED_STATUSES]
        resolved_count = len(resolved_vulns)
        
        resolution_times = []
        for v in resolved_vulns:
            if v.resolved_at and v.discovered_at:
                resolution_times.append((v.resolved_at - v.discovered_at).days)
        mttr = sum(resolution_times) / len(resolution_times) if resolution_times else None
        
        on_time = sum(1 for v in resolved_vulns if v.resolved_at and v.due_date and v.resolved_at <= v.due_date)
        sla_compliance_percent = round((on_time / resolved_count * 100) if resolved_count > 0 else 0.0, 1)
        
        overdue_count = sum(1 for v in dept_vulns
                          if v.due_date and v.due_date < now
                          and v.status not in RESOLVED_STATUSES)
        
        by_severity = {"critical": 0, "high": 0, "medium": 0, "low": 0}
        for sev in ["critical", "high", "medium", "low"]:
            by_severity[sev] = sum(1 for v in dept_vulns if v.severity == sev)
        
        dept_results.append({
            "department_id": dept.id,
            "department_name": dept.name,
            "department_code": dept.code,
            "total_vulnerabilities": len(dept_vulns),
            "open_count": open_count,
            "resolved_count": resolved_count,
            "mttr_days": round(mttr, 1) if mttr else None,
            "sla_compliance_percent": sla_compliance_percent,
            "current_workload": open_count,
            "overdue_count": overdue_count,
            "by_severity": by_severity
        })
    
    return {"departments": dept_results, "unassigned_count": unassigned_count}


@router.get("/sla-trends")
def get_sla_trends(
    period: str = Query("30d", pattern="^(7d|30d|90d|1y)$"),
    department_id: Optional[int] = None,
    tenant_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return {"period": period, "data_points": [], "overall_compliance": 0.0}
    
    if tenant_id:
        validate_tenant_access(current_user, tenant_id, db)
        filter_tenants = [tenant_id]
    else:
        filter_tenants = user_tenants
    
    period_days = {"7d": 7, "30d": 30, "90d": 90, "1y": 365}
    days = period_days.get(period, 30)
    start_date = datetime.utcnow() - timedelta(days=days)
    
    query = db.query(Vulnerability).filter(
        Vulnerability.tenant_id.in_(filter_tenants),
        Vulnerability.status.in_(RESOLVED_STATUSES),
        Vulnerability.resolved_at >= start_date
    )
    
    if department_id:
        dept_vuln_ids = db.query(GRCVulnerabilityDepartmentAssignment.vulnerability_id).filter(
            GRCVulnerabilityDepartmentAssignment.department_id == department_id
        ).subquery()
        query = query.filter(Vulnerability.id.in_(dept_vuln_ids))
    
    resolved_vulns = query.all()
    
    if days <= 7:
        interval_days = 1
    elif days <= 30:
        interval_days = 7
    elif days <= 90:
        interval_days = 14
    else:
        interval_days = 30
    
    data_points = []
    current_date = start_date
    total_on_time = 0
    total_resolved = 0
    
    while current_date < datetime.utcnow():
        interval_end = min(current_date + timedelta(days=interval_days), datetime.utcnow())
        
        interval_vulns = [v for v in resolved_vulns 
                         if v.resolved_at and current_date <= v.resolved_at < interval_end]
        
        if interval_vulns:
            on_time = sum(1 for v in interval_vulns if v.due_date and v.resolved_at <= v.due_date)
            breaches = len(interval_vulns) - on_time
            compliance_rate = round((on_time / len(interval_vulns)) * 100, 1)
            total_on_time += on_time
            total_resolved += len(interval_vulns)
        else:
            on_time = 0
            breaches = 0
            compliance_rate = 0.0
        
        data_points.append({
            "date": current_date.strftime("%Y-%m-%d"),
            "compliance_rate": compliance_rate,
            "breaches": breaches
        })
        
        current_date = interval_end
    
    overall_compliance = round((total_on_time / total_resolved) * 100, 1) if total_resolved > 0 else 0.0
    
    return {
        "period": period,
        "data_points": data_points,
        "overall_compliance": overall_compliance
    }


@router.get("/workflow-metrics")
def get_workflow_metrics(
    tenant_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return {
            "state_distribution": [],
            "transitions_today": 0,
            "pending_approvals": 0,
            "escalations_triggered": 0
        }
    
    if tenant_id:
        validate_tenant_access(current_user, tenant_id, db)
        filter_tenants = [tenant_id]
    else:
        filter_tenants = user_tenants
    
    now = datetime.utcnow()
    today_start = datetime(now.year, now.month, now.day)
    
    vulns_with_state = db.query(Vulnerability).filter(
        Vulnerability.tenant_id.in_(filter_tenants),
        Vulnerability.current_state_id.isnot(None)
    ).all()
    
    state_counts = {}
    state_days = {}
    
    for v in vulns_with_state:
        state_id = v.current_state_id
        if state_id not in state_counts:
            state_counts[state_id] = 0
            state_days[state_id] = []
        state_counts[state_id] += 1
        
        last_transition = db.query(GRCVulnWorkflowHistory).filter(
            GRCVulnWorkflowHistory.vulnerability_id == v.id,
            GRCVulnWorkflowHistory.to_state_id == state_id
        ).order_by(GRCVulnWorkflowHistory.performed_at.desc()).first()
        
        if last_transition:
            days_in_state = (now - last_transition.performed_at).days
            state_days[state_id].append(days_in_state)
    
    state_distribution = []
    for state_id, count in state_counts.items():
        state = db.query(GRCVulnWorkflowState).filter(GRCVulnWorkflowState.id == state_id).first()
        if state:
            avg_days = round(sum(state_days[state_id]) / len(state_days[state_id]), 1) if state_days[state_id] else 0.0
            state_distribution.append({
                "state_id": state_id,
                "state_name": state.name,
                "count": count,
                "avg_days_in_state": avg_days
            })
    
    transitions_today = db.query(func.count(GRCVulnWorkflowHistory.id)).join(
        Vulnerability
    ).filter(
        Vulnerability.tenant_id.in_(filter_tenants),
        GRCVulnWorkflowHistory.performed_at >= today_start
    ).scalar() or 0
    
    pending_approvals = 0
    approval_states = db.query(GRCVulnWorkflowState).filter(
        GRCVulnWorkflowState.requires_approval == True
    ).all()
    approval_state_ids = [s.id for s in approval_states]
    
    if approval_state_ids:
        pending_approvals = db.query(func.count(Vulnerability.id)).filter(
            Vulnerability.tenant_id.in_(filter_tenants),
            Vulnerability.current_state_id.in_(approval_state_ids)
        ).scalar() or 0
    
    escalations_triggered = db.query(func.count(GRCVulnEscalationLog.id)).join(
        Vulnerability
    ).filter(
        Vulnerability.tenant_id.in_(filter_tenants),
        GRCVulnEscalationLog.triggered_at >= today_start
    ).scalar() or 0
    
    return {
        "state_distribution": state_distribution,
        "transitions_today": transitions_today,
        "pending_approvals": pending_approvals,
        "escalations_triggered": escalations_triggered
    }


@router.get("/aging-analysis")
def get_aging_analysis(
    tenant_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return {"buckets": [], "by_department": {}}
    
    if tenant_id:
        validate_tenant_access(current_user, tenant_id, db)
        filter_tenants = [tenant_id]
    else:
        filter_tenants = user_tenants
    
    now = datetime.utcnow()
    
    open_vulns = db.query(Vulnerability).filter(
        Vulnerability.tenant_id.in_(filter_tenants),
        Vulnerability.status.notin_(RESOLVED_STATUSES)
    ).all()

    bucket_labels = ["0-7 days", "8-14 days", "15-30 days", "31-60 days", "60+ days"]
    overall_buckets = {label: 0 for label in bucket_labels}
    
    departments = db.query(GRCDepartment).filter(
        GRCDepartment.tenant_id.in_(filter_tenants),
        GRCDepartment.is_active == True
    ).all()
    
    dept_vuln_map = {}
    for dept in departments:
        assignments = db.query(GRCVulnerabilityDepartmentAssignment).filter(
            GRCVulnerabilityDepartmentAssignment.department_id == dept.id
        ).all()
        dept_vuln_map[dept.id] = set(a.vulnerability_id for a in assignments)
    
    by_department = {str(dept.id): {label: 0 for label in bucket_labels} for dept in departments}
    
    for v in open_vulns:
        age_days = (now - v.discovered_at).days if v.discovered_at else 0
        
        if age_days <= 7:
            bucket = "0-7 days"
        elif age_days <= 14:
            bucket = "8-14 days"
        elif age_days <= 30:
            bucket = "15-30 days"
        elif age_days <= 60:
            bucket = "31-60 days"
        else:
            bucket = "60+ days"
        
        overall_buckets[bucket] += 1
        
        for dept in departments:
            if v.id in dept_vuln_map.get(dept.id, set()):
                by_department[str(dept.id)][bucket] += 1
    
    buckets_list = [{"label": label, "count": count} for label, count in overall_buckets.items()]
    
    return {"buckets": buckets_list, "by_department": by_department}


@router.get("/control-coverage")
def get_control_coverage(
    tenant_id: Optional[int] = None,
    limit: int = 10,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return {
            "total_vulnerabilities": 0,
            "with_control_links": 0,
            "coverage_rate": 0.0,
            "top_violated_controls": []
        }
    
    if tenant_id:
        validate_tenant_access(current_user, tenant_id, db)
        filter_tenants = [tenant_id]
    else:
        filter_tenants = user_tenants
    
    total_vulns = db.query(func.count(Vulnerability.id)).filter(
        Vulnerability.tenant_id.in_(filter_tenants)
    ).scalar() or 0
    
    vulns_with_links = db.query(func.count(func.distinct(VulnerabilityControlLink.vulnerability_id))).join(
        Vulnerability
    ).filter(
        Vulnerability.tenant_id.in_(filter_tenants)
    ).scalar() or 0
    
    coverage_rate = round((vulns_with_links / total_vulns) * 100, 1) if total_vulns > 0 else 0.0
    
    framework_control_counts = db.query(
        VulnerabilityControlLink.framework_control_id,
        func.count(VulnerabilityControlLink.id).label("count")
    ).join(Vulnerability).filter(
        Vulnerability.tenant_id.in_(filter_tenants),
        VulnerabilityControlLink.framework_control_id.isnot(None)
    ).group_by(VulnerabilityControlLink.framework_control_id).order_by(
        func.count(VulnerabilityControlLink.id).desc()
    ).limit(limit).all()
    
    normalized_control_counts = db.query(
        VulnerabilityControlLink.normalized_control_id,
        func.count(VulnerabilityControlLink.id).label("count")
    ).join(Vulnerability).filter(
        Vulnerability.tenant_id.in_(filter_tenants),
        VulnerabilityControlLink.normalized_control_id.isnot(None)
    ).group_by(VulnerabilityControlLink.normalized_control_id).order_by(
        func.count(VulnerabilityControlLink.id).desc()
    ).limit(limit).all()
    
    internal_control_counts = db.query(
        VulnerabilityControlLink.internal_control_id,
        func.count(VulnerabilityControlLink.id).label("count")
    ).join(Vulnerability).filter(
        Vulnerability.tenant_id.in_(filter_tenants),
        VulnerabilityControlLink.internal_control_id.isnot(None)
    ).group_by(VulnerabilityControlLink.internal_control_id).order_by(
        func.count(VulnerabilityControlLink.id).desc()
    ).limit(limit).all()
    
    top_controls = []
    
    for ctrl_id, count in framework_control_counts:
        ctrl = db.query(FrameworkControl).filter(FrameworkControl.id == ctrl_id).first()
        if ctrl:
            top_controls.append({
                "control_id": ctrl.code,
                "control_name": ctrl.name,
                "control_type": "framework",
                "violation_count": count
            })
    
    for ctrl_id, count in normalized_control_counts:
        ctrl = db.query(NormalizedControl).filter(NormalizedControl.id == ctrl_id).first()
        if ctrl:
            top_controls.append({
                "control_id": ctrl.code,
                "control_name": ctrl.name,
                "control_type": "normalized",
                "violation_count": count
            })
    
    for ctrl_id, count in internal_control_counts:
        ctrl = db.query(InternalControl).filter(InternalControl.id == ctrl_id).first()
        if ctrl:
            top_controls.append({
                "control_id": ctrl.control_id,
                "control_name": ctrl.name,
                "control_type": "internal",
                "violation_count": count
            })
    
    top_controls.sort(key=lambda x: x["violation_count"], reverse=True)
    top_controls = top_controls[:limit]
    
    return {
        "total_vulnerabilities": total_vulns,
        "with_control_links": vulns_with_links,
        "coverage_rate": coverage_rate,
        "top_violated_controls": top_controls
    }


@router.get("/sla-compliance-trends")
def get_sla_compliance_trends(
    weeks: int = Query(12, ge=1, le=52),
    tenant_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return {"trends": [], "summary": {}}
    
    if tenant_id:
        validate_tenant_access(current_user, tenant_id, db)
        filter_tenants = [tenant_id]
    else:
        filter_tenants = user_tenants
    
    now = datetime.utcnow()
    start_date = now - timedelta(weeks=weeks)
    
    departments = db.query(GRCDepartment).filter(
        GRCDepartment.tenant_id.in_(filter_tenants),
        GRCDepartment.is_active == True
    ).all()
    
    dept_vuln_map = {}
    for dept in departments:
        assignments = db.query(GRCVulnerabilityDepartmentAssignment).filter(
            GRCVulnerabilityDepartmentAssignment.department_id == dept.id
        ).all()
        dept_vuln_map[dept.id] = set(a.vulnerability_id for a in assignments)
    
    resolved_vulns = db.query(Vulnerability).filter(
        Vulnerability.tenant_id.in_(filter_tenants),
        Vulnerability.status.in_(RESOLVED_STATUSES),
        Vulnerability.resolved_at >= start_date
    ).all()
    
    trends = []
    for week_num in range(weeks):
        week_start = now - timedelta(weeks=(weeks - week_num))
        week_end = week_start + timedelta(weeks=1)
        
        for dept in departments:
            dept_vulns = [v for v in resolved_vulns 
                         if v.id in dept_vuln_map.get(dept.id, set())
                         and v.resolved_at and week_start <= v.resolved_at < week_end]
            
            if dept_vulns:
                on_time = sum(1 for v in dept_vulns if v.due_date and v.resolved_at <= v.due_date)
                compliance_percent = round((on_time / len(dept_vulns)) * 100, 1)
            else:
                compliance_percent = None
            
            trends.append({
                "period": f"Week {week_num + 1}",
                "date": week_start.strftime("%Y-%m-%d"),
                "compliance_percent": compliance_percent,
                "resolved_count": len(dept_vulns),
                "department_id": dept.id,
                "department_name": dept.name
            })
    
    summary = {}
    for dept in departments:
        dept_vulns = [v for v in resolved_vulns if v.id in dept_vuln_map.get(dept.id, set())]
        if dept_vulns:
            on_time = sum(1 for v in dept_vulns if v.due_date and v.resolved_at and v.resolved_at <= v.due_date)
            summary[dept.name] = round((on_time / len(dept_vulns)) * 100, 1)
        else:
            summary[dept.name] = 0.0
    
    return {"trends": trends, "summary": summary}


@router.get("/department-workload")
def get_department_workload(
    tenant_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return {"workload": []}
    
    if tenant_id:
        validate_tenant_access(current_user, tenant_id, db)
        filter_tenants = [tenant_id]
    else:
        filter_tenants = user_tenants
    
    now = datetime.utcnow()
    
    departments = db.query(GRCDepartment).filter(
        GRCDepartment.tenant_id.in_(filter_tenants),
        GRCDepartment.is_active == True
    ).all()
    
    all_open_vulns = db.query(Vulnerability).filter(
        Vulnerability.tenant_id.in_(filter_tenants),
        Vulnerability.status.notin_(RESOLVED_STATUSES)
    ).all()

    workload = []
    for dept in departments:
        assignments = db.query(GRCVulnerabilityDepartmentAssignment).filter(
            GRCVulnerabilityDepartmentAssignment.department_id == dept.id
        ).all()
        vuln_ids = set(a.vulnerability_id for a in assignments)
        
        dept_vulns = [v for v in all_open_vulns if v.id in vuln_ids]
        
        assigned_count = len(dept_vulns)
        in_progress_count = sum(1 for v in dept_vulns if v.status == "in_progress")
        pending_review_count = sum(1 for v in dept_vulns if v.status == "pending_review")
        overdue_count = sum(1 for v in dept_vulns if v.due_date and v.due_date < now)
        
        workload.append({
            "department_id": dept.id,
            "department_name": dept.name,
            "department_code": dept.code,
            "assigned_count": assigned_count,
            "in_progress_count": in_progress_count,
            "pending_review_count": pending_review_count,
            "overdue_count": overdue_count
        })
    
    workload.sort(key=lambda x: x["assigned_count"], reverse=True)
    
    return {"workload": workload}


@router.get("/aging-by-department")
def get_aging_by_department(
    tenant_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return {"aging": []}
    
    if tenant_id:
        validate_tenant_access(current_user, tenant_id, db)
        filter_tenants = [tenant_id]
    else:
        filter_tenants = user_tenants
    
    now = datetime.utcnow()
    
    departments = db.query(GRCDepartment).filter(
        GRCDepartment.tenant_id.in_(filter_tenants),
        GRCDepartment.is_active == True
    ).all()
    
    open_vulns = db.query(Vulnerability).filter(
        Vulnerability.tenant_id.in_(filter_tenants),
        Vulnerability.status.notin_(RESOLVED_STATUSES)
    ).all()

    dept_vuln_map = {}
    for dept in departments:
        assignments = db.query(GRCVulnerabilityDepartmentAssignment).filter(
            GRCVulnerabilityDepartmentAssignment.department_id == dept.id
        ).all()
        dept_vuln_map[dept.id] = set(a.vulnerability_id for a in assignments)
    
    aging = []
    for dept in departments:
        bucket_0_7 = 0
        bucket_8_30 = 0
        bucket_31_90 = 0
        bucket_90_plus = 0
        
        dept_vulns = [v for v in open_vulns if v.id in dept_vuln_map.get(dept.id, set())]
        
        for v in dept_vulns:
            age_days = (now - v.discovered_at).days if v.discovered_at else 0
            
            if age_days <= 7:
                bucket_0_7 += 1
            elif age_days <= 30:
                bucket_8_30 += 1
            elif age_days <= 90:
                bucket_31_90 += 1
            else:
                bucket_90_plus += 1
        
        aging.append({
            "department_id": dept.id,
            "department_name": dept.name,
            "bucket_0_7": bucket_0_7,
            "bucket_8_30": bucket_8_30,
            "bucket_31_90": bucket_31_90,
            "bucket_90_plus": bucket_90_plus,
            "total": len(dept_vulns)
        })
    
    return {"aging": aging}


@router.get("/escalation-metrics")
def get_escalation_metrics(
    tenant_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return {"escalations": [], "summary": {}}
    
    if tenant_id:
        validate_tenant_access(current_user, tenant_id, db)
        filter_tenants = [tenant_id]
    else:
        filter_tenants = user_tenants
    
    departments = db.query(GRCDepartment).filter(
        GRCDepartment.tenant_id.in_(filter_tenants),
        GRCDepartment.is_active == True
    ).all()
    
    all_escalations = db.query(GRCVulnEscalationLog).join(
        Vulnerability
    ).filter(
        Vulnerability.tenant_id.in_(filter_tenants)
    ).all()
    
    dept_vuln_map = {}
    for dept in departments:
        assignments = db.query(GRCVulnerabilityDepartmentAssignment).filter(
            GRCVulnerabilityDepartmentAssignment.department_id == dept.id
        ).all()
        dept_vuln_map[dept.id] = set(a.vulnerability_id for a in assignments)
    
    escalations = []
    for dept in departments:
        dept_escalations = [e for e in all_escalations if e.vulnerability_id in dept_vuln_map.get(dept.id, set())]
        
        level_1_count = sum(1 for e in dept_escalations if e.escalation_level == 1)
        level_2_count = sum(1 for e in dept_escalations if e.escalation_level == 2)
        level_3_count = sum(1 for e in dept_escalations if e.escalation_level == 3)
        
        resolved_after_esc = []
        for e in dept_escalations:
            vuln = db.query(Vulnerability).filter(Vulnerability.id == e.vulnerability_id).first()
            if vuln and vuln.resolved_at and e.triggered_at:
                resolution_days = (vuln.resolved_at - e.triggered_at).days
                resolved_after_esc.append(resolution_days)
        
        avg_resolution_after_escalation = round(sum(resolved_after_esc) / len(resolved_after_esc), 1) if resolved_after_esc else None
        
        escalations.append({
            "department_id": dept.id,
            "department_name": dept.name,
            "total_escalations": len(dept_escalations),
            "level_1_count": level_1_count,
            "level_2_count": level_2_count,
            "level_3_count": level_3_count,
            "avg_resolution_after_escalation_days": avg_resolution_after_escalation
        })
    
    total_escalations = sum(e["total_escalations"] for e in escalations)
    total_level_1 = sum(e["level_1_count"] for e in escalations)
    total_level_2 = sum(e["level_2_count"] for e in escalations)
    total_level_3 = sum(e["level_3_count"] for e in escalations)
    
    summary = {
        "total_escalations": total_escalations,
        "level_1_count": total_level_1,
        "level_2_count": total_level_2,
        "level_3_count": total_level_3
    }

    return {"escalations": escalations, "summary": summary}


# =============================================================================
# Trends + reporting (added for the overview "intuitive graphs" feature)
# =============================================================================

# Period → (start_date_offset_days, default_bucket).
# Quarter is treated as 90 days; longer windows auto-bucket into weeks/months
# so the chart series stay readable.
def _resolve_period(period: str):
    p = (period or "").strip().lower()
    if p in ("60d", "60", "60days"):
        return 60, "day"
    if p in ("90d", "90", "90days", "quarter", "q"):
        return 90, "day"
    if p in ("180d", "2quarters", "2q"):
        return 180, "week"
    if p in ("365d", "year", "1y"):
        return 365, "week"
    if p in ("30d", "30", "30days"):
        return 30, "day"
    # Allow caller-specified "<n>d" for arbitrary windows.
    if p.endswith("d") and p[:-1].isdigit():
        days = max(1, min(int(p[:-1]), 730))
        bucket = "day" if days <= 90 else "week" if days <= 270 else "month"
        return days, bucket
    return 90, "day"


def _bucket_key(dt: datetime, bucket: str) -> str:
    """Return an ISO-style key for a date bucket: YYYY-MM-DD for day,
    ISO Monday-of-week for week, YYYY-MM-01 for month."""
    if bucket == "week":
        # ISO Monday
        monday = (dt.date() - timedelta(days=dt.weekday()))
        return monday.isoformat()
    if bucket == "month":
        return dt.date().replace(day=1).isoformat()
    return dt.date().isoformat()


def _enumerate_buckets(start: date, end: date, bucket: str):
    """Yield every bucket key between two dates (inclusive on both ends).

    Filling in zero-valued buckets keeps the time-series charts continuous
    even for days/weeks with no activity.
    """
    keys = []
    cur = start
    if bucket == "week":
        cur = cur - timedelta(days=cur.weekday())
        end_b = end - timedelta(days=end.weekday())
        while cur <= end_b:
            keys.append(cur.isoformat())
            cur = cur + timedelta(days=7)
    elif bucket == "month":
        cur = cur.replace(day=1)
        end_b = end.replace(day=1)
        while cur <= end_b:
            keys.append(cur.isoformat())
            # advance one month
            year = cur.year + (1 if cur.month == 12 else 0)
            month = 1 if cur.month == 12 else cur.month + 1
            cur = date(year, month, 1)
    else:
        while cur <= end:
            keys.append(cur.isoformat())
            cur = cur + timedelta(days=1)
    return keys


def _parse_iso_date(value: Optional[str]) -> Optional[date]:
    """Parse a ``YYYY-MM-DD`` string. Returns None on empty / bad input —
    callers fall back to the period-based window in that case."""
    if not value:
        return None
    try:
        return datetime.strptime(value.strip(), "%Y-%m-%d").date()
    except (TypeError, ValueError):
        return None


def _bucket_for_span(days: int) -> str:
    """Pick the default bucket granularity for a date span (days). Mirrors
    `_resolve_period`'s heuristic so custom ranges render at the same
    densities as the preset chips."""
    if days <= 90:
        return "day"
    if days <= 270:
        return "week"
    return "month"


@router.get("/trends")
def get_dashboard_trends(
    tenant_id: Optional[int] = None,
    period: str = "90d",
    bucket: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """Time-bucketed metrics for the overview trend charts.

    `start_date` and `end_date` (ISO YYYY-MM-DD) take precedence over
    `period` when both are supplied — that's the path the custom
    date-range picker uses for executive reports. When omitted, the
    `period` chip (60d / 90d / 180d / 365d / quarter) is used.

    Returns four parallel series keyed by date bucket:
      - discovered:        new vulnerabilities created in the bucket
      - resolved:          vulnerabilities transitioned to a closed status
      - net_open_delta:    discovered - resolved (positive = backlog growing)
      - status_changes:    workflow-history events in the bucket
    Plus aggregate scalars (totals, MTTR within window, fixed-vs-new ratio)
    that the report endpoint reuses without recomputing.
    """
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return {"period": period, "bucket": bucket or "day", "buckets": [],
                "discovered": [], "resolved": [], "net_open_delta": [],
                "status_changes": [], "summary": {}}

    if tenant_id:
        validate_tenant_access(current_user, tenant_id, db)
        filter_tenants = [tenant_id]
    else:
        filter_tenants = user_tenants

    # Resolve the window: custom dates win when both are present, otherwise
    # fall back to the period chip. End-date is inclusive (we extend it to
    # 23:59:59 so the day-of bucket captures activity up to midnight).
    now = datetime.utcnow()
    sd = _parse_iso_date(start_date)
    ed = _parse_iso_date(end_date)
    if sd and ed and sd <= ed:
        start = datetime.combine(sd, datetime.min.time())
        # Inclusive end — capture the entire `ed` day.
        end_dt = datetime.combine(ed, datetime.max.time().replace(microsecond=0))
        # Cap the upper bound at "now" so a future end-date doesn't show
        # phantom empty buckets — the rest of the system treats `now` as
        # the present.
        if end_dt > now:
            end_dt = now
        days = max(1, (end_dt.date() - sd).days + 1)
        default_bucket = _bucket_for_span(days)
        # Surface the resolved range in the response so the UI can show it.
        period = f"{sd.isoformat()}..{ed.isoformat()}"
    else:
        days, default_bucket = _resolve_period(period)
        start = now - timedelta(days=days)
        end_dt = now

    bucket = (bucket or default_bucket).lower()
    if bucket not in ("day", "week", "month"):
        bucket = default_bucket

    # Discovered (created_at within window). Custom end_date bounds the upper
    # side so a report for "Jan 1–Mar 31" doesn't pick up April activity.
    discovered_rows = db.query(Vulnerability.created_at, Vulnerability.discovered_at).filter(
        Vulnerability.tenant_id.in_(filter_tenants),
        or_(
            and_(
                Vulnerability.discovered_at != None,
                Vulnerability.discovered_at >= start,
                Vulnerability.discovered_at <= end_dt,
            ),
            and_(
                Vulnerability.discovered_at == None,
                Vulnerability.created_at >= start,
                Vulnerability.created_at <= end_dt,
            ),
        ),
    ).all()

    # Resolved (resolved_at within window).
    resolved_rows = db.query(Vulnerability.resolved_at).filter(
        Vulnerability.tenant_id.in_(filter_tenants),
        Vulnerability.resolved_at != None,
        Vulnerability.resolved_at >= start,
        Vulnerability.resolved_at <= end_dt,
    ).all()

    # Status-change events from workflow history.
    status_change_rows = db.query(GRCVulnWorkflowHistory.performed_at).join(
        Vulnerability,
        Vulnerability.id == GRCVulnWorkflowHistory.vulnerability_id,
    ).filter(
        Vulnerability.tenant_id.in_(filter_tenants),
        GRCVulnWorkflowHistory.performed_at != None,
        GRCVulnWorkflowHistory.performed_at >= start,
        GRCVulnWorkflowHistory.performed_at <= end_dt,
    ).all()

    discovered_counts: Dict[str, int] = {}
    resolved_counts: Dict[str, int] = {}
    status_change_counts: Dict[str, int] = {}

    for created_at, disc_at in discovered_rows:
        when = disc_at or created_at
        if not when:
            continue
        key = _bucket_key(when, bucket)
        discovered_counts[key] = discovered_counts.get(key, 0) + 1

    resolution_days_within = []
    for (resolved_at,) in resolved_rows:
        if not resolved_at:
            continue
        key = _bucket_key(resolved_at, bucket)
        resolved_counts[key] = resolved_counts.get(key, 0) + 1

    for (performed_at,) in status_change_rows:
        if not performed_at:
            continue
        key = _bucket_key(performed_at, bucket)
        status_change_counts[key] = status_change_counts.get(key, 0) + 1

    # MTTR within the window: avg(resolved_at - discovered_at) for vulns
    # both discovered and resolved during the window.
    mttr_rows = db.query(Vulnerability.discovered_at, Vulnerability.resolved_at).filter(
        Vulnerability.tenant_id.in_(filter_tenants),
        Vulnerability.resolved_at != None,
        Vulnerability.resolved_at >= start,
        Vulnerability.resolved_at <= end_dt,
    ).all()
    for disc_at, res_at in mttr_rows:
        if disc_at and res_at:
            resolution_days_within.append((res_at - disc_at).total_seconds() / 86400.0)
    mttr_within = (sum(resolution_days_within) / len(resolution_days_within)) if resolution_days_within else None

    # Fill zero-buckets so charts are continuous. Honour the resolved
    # end_dt (custom date range may end before "now").
    bucket_keys = _enumerate_buckets(start.date(), end_dt.date(), bucket)
    discovered_series = [{"date": k, "count": discovered_counts.get(k, 0)} for k in bucket_keys]
    resolved_series = [{"date": k, "count": resolved_counts.get(k, 0)} for k in bucket_keys]
    status_change_series = [{"date": k, "count": status_change_counts.get(k, 0)} for k in bucket_keys]
    net_open_delta_series = [
        {"date": k, "count": discovered_counts.get(k, 0) - resolved_counts.get(k, 0)}
        for k in bucket_keys
    ]

    total_discovered = sum(p["count"] for p in discovered_series)
    total_resolved = sum(p["count"] for p in resolved_series)
    total_status_changes = sum(p["count"] for p in status_change_series)

    # Tasks linked to vulnerabilities — aggregate progress for the report.
    # Soft import to avoid a circular dependency at module load time.
    from ....models import CriticalTask
    task_progress = {"total": 0, "by_status": {}}
    task_rows = db.query(CriticalTask.status, func.count(CriticalTask.id)).filter(
        CriticalTask.tenant_id.in_(filter_tenants),
        CriticalTask.linked_vulnerability_id != None,
    ).group_by(CriticalTask.status).all()
    for st, cnt in task_rows:
        task_progress["by_status"][st or "Unknown"] = int(cnt)
        task_progress["total"] += int(cnt)

    summary = {
        "period_days": days,
        "bucket": bucket,
        "start": start.date().isoformat(),
        "end": end_dt.date().isoformat(),
        "total_discovered": total_discovered,
        "total_resolved": total_resolved,
        "net_change": total_discovered - total_resolved,
        "total_status_changes": total_status_changes,
        "mttr_days_within_window": round(mttr_within, 1) if mttr_within is not None else None,
        "fixed_vs_new_ratio": (
            round(total_resolved / total_discovered, 2)
            if total_discovered > 0 else None
        ),
        "task_progress": task_progress,
    }

    return {
        "period": period,
        "bucket": bucket,
        "buckets": bucket_keys,
        "discovered": discovered_series,
        "resolved": resolved_series,
        "net_open_delta": net_open_delta_series,
        "status_changes": status_change_series,
        "summary": summary,
    }


def _build_executive_narrative(payload: dict) -> str:
    """One-paragraph plain-English summary that opens the PDF.

    Translates the raw counters into the kind of sentence an executive
    actually reads — KEV exposure first (the only thing that's truly
    drop-everything urgent), then backlog dynamics, then SLA posture.
    """
    s = payload.get("summary") or {}
    posture = payload.get("posture") or {}
    ti = payload.get("threat_intel") or {}
    cov = ti.get("enrichment_coverage") or {}
    kev_count = int(cov.get("kev_count", 0) or 0)
    total_open = int(cov.get("total_open", 0) or 0)
    pri = ti.get("priority_buckets") or {}
    crit_pri = int(pri.get("critical", 0) or 0)
    high_pri = int(pri.get("high", 0) or 0)
    discovered = int(s.get("total_discovered", 0) or 0)
    resolved = int(s.get("total_resolved", 0) or 0)
    net = int(s.get("net_change", 0) or 0)
    mttr = s.get("mttr_days_within_window")
    sla_map = posture.get("sla_compliance") or {}
    sla_pct = None
    if sla_map:
        rates = [float(v.get("compliance_rate") or 0) for v in sla_map.values() if isinstance(v, dict)]
        if rates:
            sla_pct = round(sum(rates) / len(rates))
    overdue = int(posture.get("overdue_count", 0) or 0)

    bits: list[str] = []
    bits.append(
        f"Between {s.get('start','—')} and {s.get('end','—')}, "
        f"the organisation logged {discovered} new vulnerabilit{'y' if discovered == 1 else 'ies'} "
        f"and resolved {resolved}."
    )
    if net > 0:
        bits.append(f"The open backlog grew by {net} during the window.")
    elif net < 0:
        bits.append(f"The open backlog shrank by {abs(net)} during the window — net positive.")
    else:
        bits.append("The open backlog held steady during the window.")
    if total_open:
        if kev_count:
            bits.append(
                f"Of {total_open} currently-open vulnerabilities, "
                f"{kev_count} {'is' if kev_count == 1 else 'are'} actively exploited in the wild "
                f"(listed in the CISA Known Exploited Vulnerabilities catalogue) and "
                f"require remediation ahead of routine SLA windows."
            )
        else:
            bits.append(
                f"There are {total_open} open vulnerabilities; none are currently flagged by "
                f"CISA as actively exploited."
            )
    if crit_pri or high_pri:
        bits.append(
            f"Composite-priority triage (CVSS + EPSS + KEV + asset criticality) places "
            f"{crit_pri} in the Critical tier and {high_pri} in the High tier."
        )
    if mttr is not None:
        bits.append(f"Mean time to remediate within the window is {mttr} days.")
    if sla_pct is not None:
        bits.append(
            f"SLA compliance currently stands at {sla_pct}%"
            + (f" with {overdue} overdue items." if overdue else ".")
        )
    return " ".join(bits)


def _render_pdf_report(payload: dict) -> bytes:
    """Executive-ready PDF.

    Sections:
      1. Title page — tenant name, window, generated-by + timestamp,
         classification footer.
      2. Executive summary — one plain-English paragraph + KPI tile band.
      3. Current posture — severity / status breakdown, SLA table.
      4. Threat intelligence — KEV count, priority buckets, EPSS bands,
         enrichment coverage.
      5. Top-10 priority list — the actual "fix these first" table.
      6. Asset-criticality × severity matrix — where the blast lands.
      7. Activity in window — trend roll-up (totals, not noisy day rows).
      8. Appendix — full time-series tables, only when the window has data.

    Raises ImportError if reportlab is not installed; caller falls back to
    a plain-text report.
    """
    from reportlab.lib.pagesizes import letter
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.platypus import (
        SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak,
        KeepTogether,
    )
    from reportlab.lib import colors
    from reportlab.lib.units import inch
    from reportlab.lib.enums import TA_CENTER
    import io as _io

    buf = _io.BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=letter,
        leftMargin=0.6 * inch, rightMargin=0.6 * inch,
        topMargin=0.6 * inch, bottomMargin=0.6 * inch,
        title="Vulnerability Executive Report",
        author=payload.get("tenant_name") or "Vulnerability Management",
    )
    styles = getSampleStyleSheet()

    # Brand-tone palette — slate-900 / red-600 / amber-500 / blue-600.
    BRAND_DARK = colors.HexColor("#0f172a")
    BRAND_MUTED = colors.HexColor("#64748b")
    BRAND_RED = colors.HexColor("#dc2626")
    BRAND_ORANGE = colors.HexColor("#f97316")
    BRAND_AMBER = colors.HexColor("#eab308")
    BRAND_BLUE = colors.HexColor("#3b82f6")
    BRAND_BG_LIGHT = colors.HexColor("#f8fafc")
    BRAND_BORDER = colors.HexColor("#e2e8f0")

    title_style = ParagraphStyle(
        "TitleBig", parent=styles["Title"], fontSize=24, leading=28,
        textColor=BRAND_DARK, alignment=TA_CENTER, spaceAfter=4,
    )
    subtitle_style = ParagraphStyle(
        "Subtitle", parent=styles["Heading2"], fontSize=14, leading=18,
        textColor=BRAND_MUTED, alignment=TA_CENTER, spaceAfter=24,
        fontName="Helvetica",
    )
    section_style = ParagraphStyle(
        "Section", parent=styles["Heading2"], fontSize=13, leading=16,
        textColor=BRAND_DARK, spaceBefore=14, spaceAfter=6,
        fontName="Helvetica-Bold",
    )
    sub_section_style = ParagraphStyle(
        "SubSection", parent=styles["Heading3"], fontSize=11, leading=14,
        textColor=BRAND_DARK, spaceBefore=8, spaceAfter=4,
        fontName="Helvetica-Bold",
    )
    body_style = ParagraphStyle(
        "Body", parent=styles["BodyText"], fontSize=10, leading=14,
        textColor=BRAND_DARK,
    )
    body_muted = ParagraphStyle(
        "BodyMuted", parent=body_style, textColor=BRAND_MUTED, fontSize=9,
    )
    footer_style = ParagraphStyle(
        "Footer", parent=body_style, fontSize=8, textColor=BRAND_MUTED,
        alignment=TA_CENTER,
    )
    kpi_label_style = ParagraphStyle(
        "KpiLabel", parent=body_style, fontSize=8, textColor=BRAND_MUTED,
        alignment=TA_CENTER, fontName="Helvetica-Bold", spaceAfter=2,
    )
    kpi_value_style = ParagraphStyle(
        "KpiValue", parent=body_style, fontSize=18, textColor=BRAND_DARK,
        alignment=TA_CENTER, fontName="Helvetica-Bold",
    )

    story: list = []

    s = payload.get("summary") or {}
    posture = payload.get("posture") or {}
    ti = payload.get("threat_intel") or {}
    tenant_name = payload.get("tenant_name") or "Vulnerability Management"
    generated_by = payload.get("generated_by") or "—"
    generated_at = payload.get("generated_at") or ""

    # ── Section 1: Title page ────────────────────────────────────────────
    story.append(Spacer(1, 1.2 * inch))
    story.append(Paragraph("Vulnerability Management", title_style))
    story.append(Paragraph("Executive Status Report", title_style))
    story.append(Spacer(1, 0.3 * inch))
    story.append(Paragraph(tenant_name, subtitle_style))
    story.append(Spacer(1, 0.4 * inch))

    cover_info = [
        ["Reporting window", f"{s.get('start','—')}  →  {s.get('end','—')} ({s.get('period_days','?')} days)"],
        ["Granularity", (s.get('bucket') or 'day').title()],
        ["Generated by", generated_by],
        ["Generated at (UTC)", generated_at.replace("T", " ").rstrip("Z")],
    ]
    cover_table = Table(cover_info, colWidths=[2.0 * inch, 4.0 * inch])
    cover_table.setStyle(TableStyle([
        ("FONTNAME",  (0, 0), (0, -1), "Helvetica-Bold"),
        ("FONTSIZE",  (0, 0), (-1, -1), 10),
        ("TEXTCOLOR", (0, 0), (0, -1), BRAND_MUTED),
        ("TEXTCOLOR", (1, 0), (1, -1), BRAND_DARK),
        ("ALIGN",     (0, 0), (-1, -1), "LEFT"),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("LINEBELOW", (0, 0), (-1, -1), 0.25, BRAND_BORDER),
    ]))
    story.append(cover_table)
    story.append(Spacer(1, 2.2 * inch))
    story.append(Paragraph(
        "CONFIDENTIAL — Internal Use Only<br/>This document contains security-sensitive information about vulnerabilities and assets.",
        footer_style,
    ))
    story.append(PageBreak())

    # ── Section 2: Executive summary + KPI tiles ─────────────────────────
    story.append(Paragraph("Executive Summary", section_style))
    story.append(Paragraph(_build_executive_narrative(payload), body_style))
    story.append(Spacer(1, 10))

    cov = ti.get("enrichment_coverage") or {}
    total_open = int(cov.get("total_open", 0) or 0)
    kev_count = int(cov.get("kev_count", 0) or 0)
    pri = ti.get("priority_buckets") or {}
    sev = posture.get("by_severity") or {}
    sla_map = posture.get("sla_compliance") or {}
    overdue = int(posture.get("overdue_count", 0) or 0)
    mttr = posture.get("mttr_days")
    sla_pct = None
    if sla_map:
        rates = [float(v.get("compliance_rate") or 0) for v in sla_map.values() if isinstance(v, dict)]
        if rates:
            sla_pct = round(sum(rates) / len(rates))

    def _kpi_cell(label: str, value, tone: colors.Color = BRAND_DARK):
        return [
            Paragraph(label.upper(), kpi_label_style),
            Paragraph(
                f'<font color="{tone.hexval()}">{value}</font>',
                kpi_value_style,
            ),
        ]

    kpi_row = [[
        _kpi_cell("Total open", total_open, BRAND_DARK),
        _kpi_cell("Actively exploited (KEV)", kev_count, BRAND_RED if kev_count else BRAND_MUTED),
        _kpi_cell("Critical / High severity",
                  (int(sev.get("critical", 0)) + int(sev.get("high", 0))),
                  BRAND_ORANGE),
        _kpi_cell("MTTR (days)",
                  mttr if mttr is not None else "—",
                  BRAND_AMBER if mttr is not None else BRAND_MUTED),
        _kpi_cell("SLA compliance",
                  f"{sla_pct}%" if sla_pct is not None else "—",
                  BRAND_BLUE if sla_pct is not None else BRAND_MUTED),
    ]]
    kpi_table = Table(kpi_row, colWidths=[1.4 * inch] * 5, rowHeights=[0.85 * inch])
    kpi_table.setStyle(TableStyle([
        ("BOX",     (0, 0), (-1, -1), 0.5, BRAND_BORDER),
        ("INNERGRID", (0, 0), (-1, -1), 0.5, BRAND_BORDER),
        ("BACKGROUND", (0, 0), (-1, -1), BRAND_BG_LIGHT),
        ("VALIGN",  (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
    ]))
    story.append(kpi_table)
    story.append(Spacer(1, 4))
    story.append(Paragraph(
        f"{overdue} overdue items at time of report.",
        body_muted,
    ))

    # ── Section 3: Current posture ───────────────────────────────────────
    story.append(Paragraph("Current Posture", section_style))

    sev_order = ["critical", "high", "medium", "low", "info"]
    sev_rows = [["Severity", "Count"]]
    for k in sev_order:
        if int(sev.get(k, 0)):
            sev_rows.append([k.title(), int(sev.get(k, 0))])
    by_status = posture.get("by_status") or {}
    if len(sev_rows) > 1:
        story.append(Paragraph("By severity", sub_section_style))
        story.append(_styled_kv_table(sev_rows, BRAND_BORDER, BRAND_BG_LIGHT))
        story.append(Spacer(1, 6))

    status_rows = [["Status", "Count"]]
    for k, c in by_status.items():
        if int(c):
            status_rows.append([str(k).replace("_", " ").title(), int(c)])
    if len(status_rows) > 1:
        story.append(Paragraph("By status", sub_section_style))
        story.append(_styled_kv_table(status_rows, BRAND_BORDER, BRAND_BG_LIGHT))
        story.append(Spacer(1, 6))

    if sla_map:
        story.append(Paragraph("SLA compliance by severity", sub_section_style))
        sla_rows = [["Severity", "Total", "Resolved", "On time", "Rate %"]]
        for k, v in sla_map.items():
            if not isinstance(v, dict):
                continue
            sla_rows.append([
                str(k).title(),
                int(v.get("total", 0)),
                int(v.get("resolved", 0)),
                int(v.get("on_time", 0)),
                f"{round(float(v.get('compliance_rate', 0)))}%",
            ])
        sla_t = Table(sla_rows, hAlign="LEFT", colWidths=[1.2 * inch] + [0.9 * inch] * 4)
        sla_t.setStyle(_header_table_style(BRAND_BORDER, BRAND_BG_LIGHT))
        story.append(sla_t)

    # ── Section 4: Threat intelligence ──────────────────────────────────
    story.append(Paragraph("Threat Intelligence", section_style))

    enriched_pct = (
        round((int(cov.get("enriched", 0)) / total_open) * 100)
        if total_open else 0
    )
    cov_para = (
        f"Threat-intel enrichment covers <b>{int(cov.get('enriched', 0))} of {total_open}</b> "
        f"open vulnerabilities ({enriched_pct}%). Of these, <b>{kev_count}</b> are "
        f"flagged by CISA as actively exploited and <b>{int(cov.get('epss_count', 0))}</b> "
        f"have EPSS exploit-probability scores."
    )
    story.append(Paragraph(cov_para, body_style))
    story.append(Spacer(1, 6))

    story.append(Paragraph("Composite priority distribution", sub_section_style))
    pri_rows = [
        ["Priority bucket", "Open vulnerabilities", "Definition"],
        ["Critical", int(pri.get("critical", 0)), "Composite ≥ 9.0 — patch within days"],
        ["High",     int(pri.get("high", 0)),     "7.0 – 8.99 — patch within standard SLA"],
        ["Medium",   int(pri.get("medium", 0)),   "4.0 – 6.99 — routine cycle"],
        ["Low",      int(pri.get("low", 0)),      "< 4.0 — track only"],
        ["Unscored", int(pri.get("unscored", 0)), "Not yet enriched"],
    ]
    pri_t = Table(pri_rows, hAlign="LEFT", colWidths=[1.0 * inch, 1.5 * inch, 4.0 * inch])
    pri_t.setStyle(_header_table_style(BRAND_BORDER, BRAND_BG_LIGHT))
    story.append(pri_t)
    story.append(Spacer(1, 6))

    epss = ti.get("epss_bands") or {}
    epss_rows = [
        ["EPSS band", "Open vulnerabilities", "What it means"],
        ["Very High (≥0.50)", int(epss.get("very_high", 0)), "Extremely likely to be exploited in next 30 days"],
        ["High (0.10–0.50)",  int(epss.get("high", 0)),      "Meaningfully elevated chance"],
        ["Moderate (0.01–0.10)", int(epss.get("moderate", 0)), "Some exploit signal"],
        ["Low (<0.01)",       int(epss.get("low", 0)),       "Unlikely to be exploited soon"],
        ["Negligible (0)",    int(epss.get("negligible", 0)), "No exploit signal"],
        ["Unscored",          int(epss.get("unscored", 0)),  "EPSS not yet pulled"],
    ]
    story.append(Paragraph("Exploit likelihood (EPSS) distribution", sub_section_style))
    epss_t = Table(epss_rows, hAlign="LEFT", colWidths=[1.6 * inch, 1.5 * inch, 3.4 * inch])
    epss_t.setStyle(_header_table_style(BRAND_BORDER, BRAND_BG_LIGHT))
    story.append(epss_t)

    # ── Section 5: Top-10 priority list ─────────────────────────────────
    top = ti.get("top_priority_vulns") or []
    if top:
        story.append(PageBreak())
        story.append(Paragraph("Top 10 — Fix These First", section_style))
        story.append(Paragraph(
            "Ranked by composite priority (CVSS + EPSS + KEV + asset criticality). "
            "KEV-flagged rows are actively exploited in the wild and warrant immediate action "
            "regardless of standard severity SLA.",
            body_muted,
        ))
        story.append(Spacer(1, 4))
        top_rows = [["#", "Title", "CVE", "Priority", "CVSS", "EPSS", "Assets", "KEV"]]
        for i, v in enumerate(top, start=1):
            top_rows.append([
                str(i),
                _truncate(v.get("title", ""), 48),
                v.get("cve_id") or "—",
                f"{float(v.get('composite_priority')):.2f}" if isinstance(v.get("composite_priority"), (int, float)) else "—",
                f"{float(v.get('cvss_score')):.1f}" if isinstance(v.get("cvss_score"), (int, float)) else "—",
                f"{float(v.get('epss_score')):.3f}" if isinstance(v.get("epss_score"), (int, float)) else "—",
                int(v.get("linked_asset_count", 0)),
                "Yes" if v.get("kev_flag") else "—",
            ])
        top_t = Table(
            top_rows, hAlign="LEFT",
            colWidths=[0.3 * inch, 2.4 * inch, 1.1 * inch, 0.7 * inch, 0.55 * inch, 0.6 * inch, 0.55 * inch, 0.5 * inch],
            repeatRows=1,
        )
        style_cmds = [
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("BACKGROUND", (0, 0), (-1, 0), BRAND_DARK),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("FONTSIZE", (0, 0), (-1, -1), 8),
            ("ALIGN", (3, 1), (-2, -1), "RIGHT"),
            ("ALIGN", (-1, 1), (-1, -1), "CENTER"),
            ("INNERGRID", (0, 0), (-1, -1), 0.25, BRAND_BORDER),
            ("BOX", (0, 0), (-1, -1), 0.25, BRAND_BORDER),
            ("LEFTPADDING", (0, 0), (-1, -1), 4),
            ("RIGHTPADDING", (0, 0), (-1, -1), 4),
            ("TOPPADDING", (0, 0), (-1, -1), 3),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
        ]
        # Tint KEV rows red.
        for r, v in enumerate(top, start=1):
            if v.get("kev_flag"):
                style_cmds.append(("BACKGROUND", (0, r), (-1, r), colors.HexColor("#fef2f2")))
        top_t.setStyle(TableStyle(style_cmds))
        story.append(top_t)

    # ── Section 6: Asset-criticality × severity matrix ──────────────────
    matrix = ti.get("asset_criticality_matrix") or []
    if matrix:
        story.append(Spacer(1, 12))
        story.append(Paragraph("Asset Criticality vs. Vulnerability Severity", section_style))
        story.append(Paragraph(
            "Where the worst severities actually live. A critical-severity flaw on a "
            "low-criticality dev box is meaningfully different from the same flaw on a "
            "production database — this matrix surfaces the concentration of risk.",
            body_muted,
        ))
        story.append(Spacer(1, 4))
        m_rows = [["Asset criticality", "Critical", "High", "Medium", "Low", "Info", "Total"]]
        for row in matrix:
            total_in_row = sum(int(row.get(k, 0) or 0) for k in ("critical", "high", "medium", "low", "info"))
            m_rows.append([
                str(row.get("asset_criticality", "")).title(),
                int(row.get("critical", 0)),
                int(row.get("high", 0)),
                int(row.get("medium", 0)),
                int(row.get("low", 0)),
                int(row.get("info", 0)),
                total_in_row,
            ])
        m_t = Table(m_rows, hAlign="LEFT", colWidths=[1.4 * inch] + [0.75 * inch] * 6)
        m_t.setStyle(_header_table_style(BRAND_BORDER, BRAND_BG_LIGHT))
        story.append(m_t)

    # ── Section 7: Activity in window (compact, no day-row noise) ──────
    story.append(Spacer(1, 12))
    story.append(Paragraph("Activity in Reporting Window", section_style))
    activity_rows = [
        ["Metric", "Value"],
        ["Total discovered", int(s.get("total_discovered", 0))],
        ["Total resolved", int(s.get("total_resolved", 0))],
        ["Net change (open delta)", int(s.get("net_change", 0))],
        ["Status changes", int(s.get("total_status_changes", 0))],
        ["MTTR (days, in window)",
         s.get("mttr_days_within_window") if s.get("mttr_days_within_window") is not None else "—"],
        ["Fixed-vs-new ratio",
         s.get("fixed_vs_new_ratio") if s.get("fixed_vs_new_ratio") is not None else "—"],
    ]
    activity_t = Table(activity_rows, hAlign="LEFT", colWidths=[3.0 * inch, 1.5 * inch])
    activity_t.setStyle(_header_table_style(BRAND_BORDER, BRAND_BG_LIGHT))
    story.append(activity_t)

    tp = s.get("task_progress") or {}
    if tp.get("total"):
        story.append(Spacer(1, 8))
        story.append(Paragraph("Linked task progress", sub_section_style))
        task_rows = [["Status", "Count"]]
        for st, cnt in (tp.get("by_status") or {}).items():
            task_rows.append([str(st).title(), int(cnt)])
        task_rows.append(["Total", int(tp.get("total", 0))])
        story.append(_styled_kv_table(task_rows, BRAND_BORDER, BRAND_BG_LIGHT, bold_last=True))

    # ── Section 8: Appendix — full time-series ─────────────────────────
    has_series = any((payload.get(k) or []) for k in ("discovered", "resolved", "net_open_delta", "status_changes"))
    if has_series:
        story.append(PageBreak())
        story.append(Paragraph("Appendix — Time Series", section_style))
        story.append(Paragraph(
            f"Bucket granularity: {(s.get('bucket') or 'day').title()}. "
            "Zero-valued buckets are included so charts remain continuous.",
            body_muted,
        ))
        story.append(Spacer(1, 4))

        def _series_table(title: str, series):
            story.append(Paragraph(title, sub_section_style))
            if not series:
                story.append(Paragraph("No data in window.", body_muted))
                return
            rows = [["Date", "Count"]]
            for p in series:
                rows.append([p.get("date", ""), int(p.get("count", 0))])
            tt = Table(rows, hAlign="LEFT", colWidths=[2.0 * inch, 1.0 * inch], repeatRows=1)
            tt.setStyle(_header_table_style(BRAND_BORDER, BRAND_BG_LIGHT))
            story.append(tt)
            story.append(Spacer(1, 8))

        _series_table("Discovered over time", payload.get("discovered") or [])
        _series_table("Resolved over time", payload.get("resolved") or [])
        _series_table("Net open delta", payload.get("net_open_delta") or [])
        _series_table("Status changes", payload.get("status_changes") or [])

    # ── Page footer on every page ──────────────────────────────────────
    def _draw_footer(canvas, _doc):
        canvas.saveState()
        canvas.setFont("Helvetica", 8)
        canvas.setFillColor(BRAND_MUTED)
        canvas.drawString(0.6 * inch, 0.35 * inch,
                          f"{tenant_name} — Vulnerability Executive Report")
        canvas.drawRightString(letter[0] - 0.6 * inch, 0.35 * inch,
                               f"Page {_doc.page}  •  CONFIDENTIAL")
        canvas.restoreState()

    doc.build(story, onFirstPage=_draw_footer, onLaterPages=_draw_footer)
    pdf_bytes = buf.getvalue()
    buf.close()
    return pdf_bytes


def _truncate(text: str, limit: int) -> str:
    """Trim with an ellipsis for table cells where wrapping would break
    column widths."""
    if not text:
        return ""
    text = str(text)
    return (text[: limit - 1] + "…") if len(text) > limit else text


def _header_table_style(border_color, header_bg):
    """Shared TableStyle for reporting tables: bold header row, alternating
    row bg, thin grey borders."""
    from reportlab.platypus import TableStyle
    return TableStyle([
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("BACKGROUND", (0, 0), (-1, 0), header_bg),
        ("LINEBELOW", (0, 0), (-1, 0), 0.6, border_color),
        ("INNERGRID", (0, 1), (-1, -1), 0.25, border_color),
        ("BOX", (0, 0), (-1, -1), 0.5, border_color),
        ("ALIGN", (1, 1), (-1, -1), "RIGHT"),
        ("ALIGN", (0, 0), (0, -1), "LEFT"),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ])


def _styled_kv_table(rows, border_color, header_bg, bold_last: bool = False):
    """2-column key/value table with a header row. Optionally bolds the
    final row (used for "Total" lines)."""
    from reportlab.platypus import Table, TableStyle
    t = Table(rows, hAlign="LEFT", colWidths=[3.0 * inch, 1.5 * inch])
    cmds = [
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("BACKGROUND", (0, 0), (-1, 0), header_bg),
        ("LINEBELOW", (0, 0), (-1, 0), 0.6, border_color),
        ("INNERGRID", (0, 1), (-1, -1), 0.25, border_color),
        ("BOX", (0, 0), (-1, -1), 0.5, border_color),
        ("ALIGN", (1, 0), (1, -1), "RIGHT"),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
    ]
    if bold_last and len(rows) > 1:
        cmds.append(("FONTNAME", (0, -1), (-1, -1), "Helvetica-Bold"))
        cmds.append(("BACKGROUND", (0, -1), (-1, -1), header_bg))
    t.setStyle(TableStyle(cmds))
    return t


def _render_text_report(payload: dict) -> str:
    """Plain-text fallback when reportlab is unavailable."""
    s = payload.get("summary", {})
    lines = []
    lines.append("VULNERABILITY STATUS REPORT")
    lines.append("=" * 60)
    lines.append(f"Window: {s.get('start','')} - {s.get('end','')} "
                 f"({s.get('period_days','?')} days, bucket: {s.get('bucket','day')})")
    lines.append("")
    lines.append("SUMMARY")
    lines.append("-" * 60)
    lines.append(f"Total discovered:         {s.get('total_discovered', 0)}")
    lines.append(f"Total resolved:           {s.get('total_resolved', 0)}")
    lines.append(f"Net change (open delta):  {s.get('net_change', 0)}")
    lines.append(f"Status changes:           {s.get('total_status_changes', 0)}")
    mttr = s.get("mttr_days_within_window")
    lines.append(f"MTTR (days, in window):   {mttr if mttr is not None else '-'}")
    fvn = s.get("fixed_vs_new_ratio")
    lines.append(f"Fixed-vs-new ratio:       {fvn if fvn is not None else '-'}")
    lines.append("")
    tp = s.get("task_progress") or {}
    lines.append("TASK PROGRESS (linked to vulnerabilities)")
    lines.append("-" * 60)
    if tp.get("total"):
        for st, cnt in (tp.get("by_status") or {}).items():
            lines.append(f"  {st:24s}{cnt:>6d}")
        lines.append(f"  {'TOTAL':24s}{tp.get('total', 0):>6d}")
    else:
        lines.append("  No tasks linked to vulnerabilities in this window.")
    lines.append("")

    def _block(title: str, series):
        lines.append(title)
        lines.append("-" * 60)
        if not series:
            lines.append("  (no data)")
        else:
            for p in series:
                lines.append(f"  {p.get('date',''):12s}{int(p.get('count', 0)):>6d}")
        lines.append("")

    _block("DISCOVERED OVER TIME", payload.get("discovered") or [])
    _block("RESOLVED OVER TIME", payload.get("resolved") or [])
    _block("NET OPEN DELTA", payload.get("net_open_delta") or [])
    _block("STATUS CHANGES", payload.get("status_changes") or [])
    return "\n".join(lines)


@router.get("/report")
def download_dashboard_report(
    tenant_id: Optional[int] = None,
    period: str = "90d",
    bucket: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    fmt: str = "pdf",
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """Download an executive vulnerability status report.

    `start_date` / `end_date` (ISO YYYY-MM-DD) take precedence over `period`
    when both are supplied. `fmt` accepts `pdf` (default) or `text`.

    The report fuses three internal views in one document:
      - Trend window (the `start`..`end` slice the operator requested)
      - Current posture (live counts by severity / status / SLA)
      - Threat-intel snapshot (KEV / EPSS / composite priority / top-10)

    PDF rendering uses reportlab if available; without it we fall back to a
    plain-text report so the endpoint never 500s on a missing optional dep.
    """
    trends = get_dashboard_trends(
        tenant_id=tenant_id,
        period=period,
        bucket=bucket,
        start_date=start_date,
        end_date=end_date,
        db=db,
        current_user=current_user,
    )
    posture = get_dashboard(
        tenant_id=tenant_id,
        db=db,
        current_user=current_user,
    )
    threat_intel = get_threat_intel_dashboard(
        tenant_id=tenant_id,
        db=db,
        current_user=current_user,
    )

    # Resolve the tenant name + a "generated by" footer so the PDF reads
    # like a corporate document, not a debug dump. Soft-fail to defaults.
    tenant_name = "Vulnerability Management"
    try:
        primary_tenant_id = tenant_id or get_user_primary_tenant(current_user, db)
        if primary_tenant_id:
            t = db.query(Tenant).filter(Tenant.id == primary_tenant_id).first()
            if t and t.name:
                tenant_name = t.name
    except Exception:
        pass

    generated_by = (
        current_user.full_name
        if getattr(current_user, "full_name", None)
        else current_user.email
    )

    # `posture` is a Pydantic schema (VulnerabilityDashboard). Convert to dict
    # so the PDF renderer can use plain dict semantics. `getattr` fallback
    # keeps the path compatible with both pydantic v1 and v2.
    if hasattr(posture, "model_dump"):
        posture_dict = posture.model_dump()
    elif hasattr(posture, "dict"):
        posture_dict = posture.dict()
    else:
        posture_dict = dict(posture or {})

    payload = {
        **trends,                       # period, bucket, buckets, series, summary
        "posture": posture_dict,        # live counts / SLA / MTTR / overdue
        "threat_intel": threat_intel,   # KEV / EPSS / priority / top-10 / matrix
        "tenant_name": tenant_name,
        "generated_by": generated_by,
        "generated_at": datetime.utcnow().isoformat(timespec="seconds") + "Z",
    }

    from fastapi.responses import StreamingResponse

    summary = payload.get("summary") or {}
    fname_window = f"{summary.get('start','')}_to_{summary.get('end','now')}"
    fname_base = f"vulnerability-report-{fname_window}"

    if fmt.lower() == "text":
        text = _render_text_report(payload)
        return StreamingResponse(
            iter([text.encode("utf-8")]),
            media_type="text/plain",
            headers={"Content-Disposition": f"attachment; filename={fname_base}.txt"},
        )

    try:
        pdf_bytes = _render_pdf_report(payload)
    except ImportError:
        # reportlab not installed — degrade to a text report rather than 500.
        text = _render_text_report(payload)
        return StreamingResponse(
            iter([text.encode("utf-8")]),
            media_type="text/plain",
            headers={
                "Content-Disposition": f"attachment; filename={fname_base}.txt",
                "X-Report-Format-Fallback": "text-no-reportlab",
            },
        )

    return StreamingResponse(
        iter([pdf_bytes]),
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename={fname_base}.pdf"},
    )


# ─────────────────────────────────────────────────────────────────────────
# Threat-intelligence dashboard
# ─────────────────────────────────────────────────────────────────────────
# Aggregates the enrichment columns (kev_flag, epss_score, composite_priority)
# plus linked-asset criticality so the dashboard can render KEV exposure,
# priority buckets, EPSS distribution, and an asset-criticality cross-cut.
# Read-only — does not write to the DB. Open vulns only (resolved noise drowns
# out the signal).

@router.get("/threat-intel")
def get_threat_intel_dashboard(
    tenant_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """Charts powered by NVD/EPSS/KEV enrichment + linked asset criticality.

    Returns a single JSON object with sections matched 1:1 to the chart
    components on the frontend so the dashboard can render with a single
    fetch. All sections degrade to empty arrays / zeros when no enriched
    data is present yet — the page renders an "Enrich your vulns to unlock
    these views" empty state in that case.
    """
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return {
            "kev_exposure": {"kev": 0, "non_kev": 0},
            "priority_buckets": {"critical": 0, "high": 0, "medium": 0, "low": 0, "unscored": 0},
            "epss_bands": {
                "very_high": 0, "high": 0, "moderate": 0, "low": 0, "negligible": 0, "unscored": 0,
            },
            "asset_criticality_matrix": [],
            "top_priority_vulns": [],
            "enrichment_coverage": {"total_open": 0, "enriched": 0, "kev_count": 0, "epss_count": 0},
        }

    base_query = db.query(Vulnerability).filter(
        Vulnerability.tenant_id.in_(user_tenants),
        ~Vulnerability.status.in_(RESOLVED_STATUSES),
    )
    if tenant_id:
        validate_tenant_access(current_user, tenant_id, db)
        base_query = base_query.filter(Vulnerability.tenant_id == tenant_id)

    open_vulns = base_query.all()
    open_ids = [v.id for v in open_vulns]
    total_open = len(open_vulns)

    # ── KEV exposure (donut) ────────────────────────────────────────────
    kev_count = sum(1 for v in open_vulns if bool(v.kev_flag))
    non_kev = total_open - kev_count

    # ── Composite-priority buckets (pie) ────────────────────────────────
    pri = {"critical": 0, "high": 0, "medium": 0, "low": 0, "unscored": 0}
    for v in open_vulns:
        p = v.composite_priority
        if p is None:
            pri["unscored"] += 1
        elif p >= 9:
            pri["critical"] += 1
        elif p >= 7:
            pri["high"] += 1
        elif p >= 4:
            pri["medium"] += 1
        else:
            pri["low"] += 1

    # ── EPSS exploit-probability bands (bar) ────────────────────────────
    # Bands picked to match the natural-language buckets in the UI:
    #   >= 0.5 very high    (top 1-2% of CVEs)
    #   0.1 – 0.5 high      (active exploit signal)
    #   0.01 – 0.1 moderate
    #   0 – 0.01 low
    #   exactly 0 negligible
    epss = {"very_high": 0, "high": 0, "moderate": 0, "low": 0, "negligible": 0, "unscored": 0}
    for v in open_vulns:
        s = v.epss_score
        if s is None:
            epss["unscored"] += 1
        elif s >= 0.5:
            epss["very_high"] += 1
        elif s >= 0.1:
            epss["high"] += 1
        elif s >= 0.01:
            epss["moderate"] += 1
        elif s > 0:
            epss["low"] += 1
        else:
            epss["negligible"] += 1

    # ── Asset-criticality × severity matrix (stacked bar) ──────────────
    # For each linked asset criticality bucket, count vulns by severity. The
    # matrix tells operators where their concentrated risk actually lives —
    # a CVSS-9 on a "low" asset is very different from the same CVSS on a
    # "critical" production DB.
    matrix_rows: List[dict] = []
    if open_ids:
        # Build {asset_criticality, severity, count} tuples.
        rows = (
            db.query(
                ITAsset.criticality,
                Vulnerability.severity,
                func.count(Vulnerability.id),
            )
            .join(VulnerabilityAssetLink, VulnerabilityAssetLink.asset_id == ITAsset.id)
            .join(Vulnerability, Vulnerability.id == VulnerabilityAssetLink.vulnerability_id)
            .filter(Vulnerability.id.in_(open_ids))
            .group_by(ITAsset.criticality, Vulnerability.severity)
            .all()
        )
        # Reshape into [{criticality, critical: N, high: N, medium: N, low: N, info: N}, ...]
        crit_order = ["critical", "high", "medium", "low"]
        bucket: Dict[str, Dict[str, int]] = {}
        for crit, sev, count in rows:
            crit_key = (crit or "unspecified").lower().strip() or "unspecified"
            sev_key = (sev or "info").lower().strip() or "info"
            bucket.setdefault(crit_key, {})[sev_key] = (
                bucket.get(crit_key, {}).get(sev_key, 0) + count
            )
        # Emit rows in our canonical asset-criticality order, then any extras alphabetically.
        seen = set()
        for crit_key in crit_order + sorted(k for k in bucket.keys() if k not in crit_order):
            if crit_key not in bucket or crit_key in seen:
                continue
            seen.add(crit_key)
            row = bucket[crit_key]
            matrix_rows.append({
                "asset_criticality": crit_key,
                "critical": int(row.get("critical", 0)),
                "high":     int(row.get("high", 0)),
                "medium":   int(row.get("medium", 0)),
                "low":      int(row.get("low", 0)),
                "info":     int(row.get("info", 0)),
            })

    # ── Top-N composite-priority vulns (table) ──────────────────────────
    top_rows = (
        base_query
        .order_by(
            (Vulnerability.composite_priority.is_(None)).asc(),
            Vulnerability.composite_priority.desc(),
            Vulnerability.cvss_score.desc(),
            Vulnerability.created_at.desc(),
        )
        .limit(10)
        .all()
    )
    top_priority_vulns = []
    for v in top_rows:
        # Use the existing linked_assets relationship to count without
        # blowing out the query — we just need a small preview here.
        linked_count = (
            db.query(func.count(VulnerabilityAssetLink.id))
            .filter(VulnerabilityAssetLink.vulnerability_id == v.id)
            .scalar() or 0
        )
        top_priority_vulns.append({
            "id": v.id,
            "vuln_id": v.vuln_id,
            "title": v.title,
            "severity": v.severity,
            "cve_id": v.cve_id,
            "cvss_score": v.cvss_score,
            "epss_score": v.epss_score,
            "epss_percentile": v.epss_percentile,
            "kev_flag": bool(v.kev_flag),
            "composite_priority": v.composite_priority,
            "linked_asset_count": linked_count,
            "status": v.status,
        })

    # ── Enrichment coverage (small stat) ────────────────────────────────
    enriched_count = sum(1 for v in open_vulns if v.nvd_last_synced_at is not None)
    epss_count = sum(1 for v in open_vulns if v.epss_score is not None)

    return {
        "kev_exposure": {"kev": kev_count, "non_kev": non_kev},
        "priority_buckets": pri,
        "epss_bands": epss,
        "asset_criticality_matrix": matrix_rows,
        "top_priority_vulns": top_priority_vulns,
        "enrichment_coverage": {
            "total_open": total_open,
            "enriched": enriched_count,
            "kev_count": kev_count,
            "epss_count": epss_count,
        },
    }


# ─────────────────────────────────────────────────────────────────────────
# Asset risk heatmap (treemap data)
# ─────────────────────────────────────────────────────────────────────────
# Per-asset aggregation: rectangle size driven by asset criticality, colour
# driven by total open composite-priority sum. One screen answers "which
# assets should the next patching cycle focus on?". Open vulns only.

@router.get("/asset-risk-heatmap")
def get_asset_risk_heatmap(
    tenant_id: Optional[int] = None,
    limit: int = 60,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """Returns one entry per asset with at least one open vuln.

    Each row carries enough data for the treemap renderer to size and
    colour the rectangle, plus a short "top vulns" preview list so the
    tooltip / drill-in shows what's actually broken without a follow-up
    fetch.
    """
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return {"assets": [], "summary": {"total_assets": 0, "total_open_vulns": 0}}

    if tenant_id:
        validate_tenant_access(current_user, tenant_id, db)
        filter_tenants = [tenant_id]
    else:
        filter_tenants = user_tenants

    # Bulk-fetch all open vulns + their links + asset info in three queries
    # rather than N+1. We group in Python because the pivot we need is
    # awkward in SQL across all dialects.
    open_vulns_q = (
        db.query(Vulnerability)
        .filter(
            Vulnerability.tenant_id.in_(filter_tenants),
            ~Vulnerability.status.in_(RESOLVED_STATUSES),
        )
    )
    open_vulns = open_vulns_q.all()
    open_vuln_ids = [v.id for v in open_vulns]
    if not open_vuln_ids:
        return {"assets": [], "summary": {"total_assets": 0, "total_open_vulns": 0}}

    links = (
        db.query(
            VulnerabilityAssetLink.vulnerability_id,
            VulnerabilityAssetLink.asset_id,
        )
        .filter(VulnerabilityAssetLink.vulnerability_id.in_(open_vuln_ids))
        .all()
    )
    asset_ids = sorted({a_id for _, a_id in links})
    if not asset_ids:
        return {"assets": [], "summary": {"total_assets": 0, "total_open_vulns": len(open_vuln_ids)}}

    assets_rows = (
        db.query(
            ITAsset.id, ITAsset.name, ITAsset.asset_type,
            ITAsset.criticality, ITAsset.criticality_score,
            ITAsset.internet_facing, ITAsset.data_classification,
            ITAsset.business_function,
        )
        .filter(ITAsset.id.in_(asset_ids))
        .all()
    )

    # Index vulns by id, build asset→vuln mapping.
    vulns_by_id = {v.id: v for v in open_vulns}
    asset_to_vuln_ids: dict[int, list[int]] = {}
    for vuln_id, asset_id in links:
        asset_to_vuln_ids.setdefault(asset_id, []).append(vuln_id)

    # Criticality score table — keep aligned with the priority formula's
    # asset_criticality weighting. Used as the rectangle size when an asset
    # has no derived `criticality_score`.
    _CRIT_SCORE = {"critical": 10, "high": 7, "medium": 4, "low": 2}

    out_rows: list[dict] = []
    for asset_id, name, atype, crit, crit_score, inet, dclass, bfunc in assets_rows:
        vuln_ids = asset_to_vuln_ids.get(asset_id) or []
        if not vuln_ids:
            continue
        asset_vulns = [vulns_by_id[v] for v in vuln_ids if v in vulns_by_id]

        total_priority_sum = 0.0
        kev_count = 0
        max_priority = 0.0
        sev_counts = {"critical": 0, "high": 0, "medium": 0, "low": 0, "info": 0}
        for v in asset_vulns:
            p = v.composite_priority if isinstance(v.composite_priority, (int, float)) else None
            if p is None and isinstance(v.cvss_score, (int, float)):
                # Fall back to CVSS so un-enriched rows still influence the heatmap.
                p = float(v.cvss_score)
            if p is not None:
                total_priority_sum += float(p)
                if p > max_priority:
                    max_priority = float(p)
            if bool(v.kev_flag):
                kev_count += 1
            sev_key = (v.severity or "info").lower()
            if sev_key in sev_counts:
                sev_counts[sev_key] += 1

        # Size: prefer the derived criticality_score (richer signal), fall
        # back to the categorical bucket → numeric mapping.
        size = (
            float(crit_score)
            if isinstance(crit_score, (int, float)) and crit_score
            else float(_CRIT_SCORE.get((crit or "").lower(), 1))
        )

        # Top 3 vulns for the tooltip — preserves the "what's actually
        # broken" context without forcing a second API call on hover.
        sorted_vulns = sorted(
            asset_vulns,
            key=lambda v: (
                -1 if bool(v.kev_flag) else 0,
                -(float(v.composite_priority) if isinstance(v.composite_priority, (int, float)) else 0.0),
                -(float(v.cvss_score) if isinstance(v.cvss_score, (int, float)) else 0.0),
            ),
        )[:3]
        top_vulns_preview = [
            {
                "id": v.id,
                "title": v.title,
                "cve_id": v.cve_id,
                "severity": v.severity,
                "kev_flag": bool(v.kev_flag),
                "composite_priority": v.composite_priority,
            }
            for v in sorted_vulns
        ]

        out_rows.append({
            "asset_id": asset_id,
            "asset_name": name,
            "asset_type": atype,
            "criticality": crit,
            "criticality_score": (
                float(crit_score) if isinstance(crit_score, (int, float)) else None
            ),
            "internet_facing": bool(inet) if inet is not None else None,
            "data_classification": dclass,
            "business_function": bfunc,
            "open_vuln_count": len(asset_vulns),
            "kev_count": kev_count,
            "total_priority_sum": round(total_priority_sum, 2),
            "max_priority": round(max_priority, 2),
            "severity_breakdown": sev_counts,
            "size": size,                       # treemap rectangle size
            "value": round(total_priority_sum, 2),  # treemap colour intensity
            "top_vulns": top_vulns_preview,
        })

    # Order: KEV-bearing assets first, then by total priority desc. Cap to
    # `limit` so a tenant with thousands of assets doesn't ship a 5MB JSON.
    out_rows.sort(
        key=lambda r: (-r["kev_count"], -r["total_priority_sum"]),
    )
    out_rows = out_rows[: max(1, min(int(limit), 200))]

    return {
        "assets": out_rows,
        "summary": {
            "total_assets": len(out_rows),
            "total_open_vulns": len(open_vuln_ids),
            "assets_with_kev": sum(1 for r in out_rows if r["kev_count"] > 0),
        },
    }
