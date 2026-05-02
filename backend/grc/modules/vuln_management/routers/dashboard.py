from typing import List, Optional, Dict, Any
from datetime import datetime, timedelta, date
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import func, and_, or_

from ....models import (
    Vulnerability, VulnerabilityAssetLink, VulnerabilitySLAConfig,
    VulnerabilityControlLink, ITAsset, GRCUser, get_db,
    GRCDepartment, GRCVulnerabilityDepartmentAssignment, GRCVulnWorkflowState,
    GRCVulnWorkflowHistory, GRCVulnEscalationLog, FrameworkControl,
    NormalizedControl, InternalControl, VulnerabilityMitigation
)

RESOLVED_STATUSES = ["resolved", "remediated", "verified", "closed", "accepted", "false_positive"]
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
            by_department={}
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
    resolved_times = []
    now = datetime.utcnow()
    
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
        by_department=by_department
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
        Vulnerability.status.notin_(["resolved", "accepted", "false_positive"])
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
    
    asset_ids = db.query(VulnerabilityAssetLink.asset_id).join(
        Vulnerability
    ).filter(
        Vulnerability.tenant_id.in_(filter_tenants),
        Vulnerability.status.notin_(["resolved", "false_positive"])
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
            Vulnerability.status.notin_(["resolved", "false_positive"])
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
        
        open_count = sum(1 for v in dept_vulns if v.status not in ["resolved", "accepted", "false_positive"])
        resolved_vulns = [v for v in dept_vulns if v.status in ["resolved", "accepted", "false_positive"]]
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
                          and v.status not in ["resolved", "accepted", "false_positive"])
        
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
        Vulnerability.status.in_(["resolved", "accepted", "false_positive"]),
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
        Vulnerability.status.notin_(["resolved", "accepted", "false_positive"])
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
        Vulnerability.status.in_(["resolved", "accepted", "false_positive"]),
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
        Vulnerability.status.notin_(["resolved", "accepted", "false_positive"])
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
        Vulnerability.status.notin_(["resolved", "accepted", "false_positive"])
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


@router.get("/trends")
def get_dashboard_trends(
    tenant_id: Optional[int] = None,
    period: str = "90d",
    bucket: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """Time-bucketed metrics for the overview trend charts.

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

    days, default_bucket = _resolve_period(period)
    bucket = (bucket or default_bucket).lower()
    if bucket not in ("day", "week", "month"):
        bucket = default_bucket

    now = datetime.utcnow()
    start = now - timedelta(days=days)

    # Discovered (created_at within window).
    discovered_rows = db.query(Vulnerability.created_at, Vulnerability.discovered_at).filter(
        Vulnerability.tenant_id.in_(filter_tenants),
        or_(
            and_(Vulnerability.discovered_at != None, Vulnerability.discovered_at >= start),
            and_(Vulnerability.discovered_at == None, Vulnerability.created_at >= start),
        ),
    ).all()

    # Resolved (resolved_at within window).
    resolved_rows = db.query(Vulnerability.resolved_at).filter(
        Vulnerability.tenant_id.in_(filter_tenants),
        Vulnerability.resolved_at != None,
        Vulnerability.resolved_at >= start,
    ).all()

    # Status-change events from workflow history.
    status_change_rows = db.query(GRCVulnWorkflowHistory.performed_at).join(
        Vulnerability,
        Vulnerability.id == GRCVulnWorkflowHistory.vulnerability_id,
    ).filter(
        Vulnerability.tenant_id.in_(filter_tenants),
        GRCVulnWorkflowHistory.performed_at != None,
        GRCVulnWorkflowHistory.performed_at >= start,
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
    ).all()
    for disc_at, res_at in mttr_rows:
        if disc_at and res_at:
            resolution_days_within.append((res_at - disc_at).total_seconds() / 86400.0)
    mttr_within = (sum(resolution_days_within) / len(resolution_days_within)) if resolution_days_within else None

    # Fill zero-buckets so charts are continuous.
    bucket_keys = _enumerate_buckets(start.date(), now.date(), bucket)
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
        "end": now.date().isoformat(),
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


def _render_pdf_report(payload: dict) -> bytes:
    """Render the trend payload as a PDF using reportlab.

    Returns raw PDF bytes. Raises ImportError if reportlab is not installed,
    in which case the caller falls back to a plain-text report.
    """
    from reportlab.lib.pagesizes import letter
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak
    from reportlab.lib import colors
    import io as _io

    buf = _io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=letter, title="Vulnerability Status Report")
    styles = getSampleStyleSheet()
    h2 = ParagraphStyle("h2", parent=styles["Heading2"], spaceAfter=6)
    body = styles["BodyText"]

    s = payload.get("summary", {})
    story = [
        Paragraph("Vulnerability Status Report", styles["Title"]),
        Spacer(1, 6),
        Paragraph(
            f"Window: {s.get('start','')} – {s.get('end','')} "
            f"({s.get('period_days','?')} days, bucket: {s.get('bucket','day')})",
            body,
        ),
        Spacer(1, 12),
        Paragraph("Summary", h2),
    ]

    summary_table = [
        ["Total discovered", s.get("total_discovered", 0)],
        ["Total resolved", s.get("total_resolved", 0)],
        ["Net change (open delta)", s.get("net_change", 0)],
        ["Status changes", s.get("total_status_changes", 0)],
        ["MTTR (days, in window)",
         s.get("mttr_days_within_window") if s.get("mttr_days_within_window") is not None else "—"],
        ["Fixed-vs-new ratio",
         s.get("fixed_vs_new_ratio") if s.get("fixed_vs_new_ratio") is not None else "—"],
    ]
    t = Table(summary_table, hAlign="LEFT", colWidths=[200, 100])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (0, -1), colors.lightgrey),
        ("BOX", (0, 0), (-1, -1), 0.25, colors.grey),
        ("INNERGRID", (0, 0), (-1, -1), 0.25, colors.grey),
        ("FONTNAME", (0, 0), (-1, -1), "Helvetica"),
        ("FONTSIZE", (0, 0), (-1, -1), 10),
        ("ALIGN", (1, 0), (1, -1), "RIGHT"),
    ]))
    story.append(t)
    story.append(Spacer(1, 16))

    # Linked task progress.
    tp = s.get("task_progress") or {}
    story.append(Paragraph("Task Progress (linked to vulnerabilities)", h2))
    if tp.get("total"):
        rows = [["Status", "Count"]]
        for st, cnt in (tp.get("by_status") or {}).items():
            rows.append([str(st), int(cnt)])
        rows.append(["Total", int(tp.get("total", 0))])
        t2 = Table(rows, hAlign="LEFT", colWidths=[200, 100])
        t2.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), colors.lightgrey),
            ("BOX", (0, 0), (-1, -1), 0.25, colors.grey),
            ("INNERGRID", (0, 0), (-1, -1), 0.25, colors.grey),
            ("FONTNAME", (0, 0), (-1, -1), "Helvetica"),
            ("FONTSIZE", (0, 0), (-1, -1), 10),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("BACKGROUND", (0, -1), (-1, -1), colors.whitesmoke),
            ("FONTNAME", (0, -1), (-1, -1), "Helvetica-Bold"),
        ]))
        story.append(t2)
    else:
        story.append(Paragraph("No tasks are linked to vulnerabilities in this window.", body))
    story.append(Spacer(1, 16))

    # Time-series tables (compact).
    def _series_table(title: str, series: List[Dict[str, Any]]):
        story.append(Paragraph(title, h2))
        if not series:
            story.append(Paragraph("No data in window.", body))
            return
        rows = [["Date", "Count"]]
        for p in series:
            rows.append([p.get("date", ""), int(p.get("count", 0))])
        tt = Table(rows, hAlign="LEFT", colWidths=[200, 100], repeatRows=1)
        tt.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), colors.lightgrey),
            ("BOX", (0, 0), (-1, -1), 0.25, colors.grey),
            ("INNERGRID", (0, 0), (-1, -1), 0.25, colors.grey),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("FONTSIZE", (0, 0), (-1, -1), 9),
        ]))
        story.append(tt)
        story.append(Spacer(1, 12))

    _series_table("Discovered over time", payload.get("discovered") or [])
    _series_table("Resolved over time", payload.get("resolved") or [])
    _series_table("Net open delta", payload.get("net_open_delta") or [])
    _series_table("Status changes", payload.get("status_changes") or [])

    doc.build(story)
    pdf_bytes = buf.getvalue()
    buf.close()
    return pdf_bytes


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
    fmt: str = "pdf",
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """Download a vulnerability status report.

    `fmt` accepts `pdf` (default) or `text`. PDF rendering uses reportlab if
    available; if it isn't installed in the deployment we fall back to a
    plain-text report (filename .txt) so the endpoint never errors out.
    """
    payload = get_dashboard_trends(
        tenant_id=tenant_id,
        period=period,
        bucket=bucket,
        db=db,
        current_user=current_user,
    )

    from fastapi.responses import StreamingResponse
    import io as _io

    fname_base = f"vulnerability-report-{payload.get('summary', {}).get('end', 'now')}-{period}"
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
