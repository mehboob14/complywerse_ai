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
    NormalizedControl, InternalControl
)
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
            recent_activities=[]
        )
    
    query = db.query(Vulnerability).filter(Vulnerability.tenant_id.in_(user_tenants))
    
    if tenant_id:
        validate_tenant_access(current_user, tenant_id, db)
        query = query.filter(Vulnerability.tenant_id == tenant_id)
        target_tenant = tenant_id
    else:
        target_tenant = get_user_primary_tenant(current_user, db) or user_tenants[0]
    
    vulns = query.all()
    
    by_severity = {}
    by_status = {}
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
        
        if v.due_date and v.due_date < now and v.status not in ["resolved", "accepted", "false_positive"]:
            overdue_count += 1
        
        if v.resolved_at and v.discovered_at:
            resolution_time = (v.resolved_at - v.discovered_at).days
            resolved_times.append(resolution_time)
        
        if v.status not in ["resolved", "accepted", "false_positive"]:
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
    
    sla_compliance = {}
    for severity in ["critical", "high", "medium", "low", "info"]:
        sev_vulns = [v for v in vulns if v.severity == severity]
        if sev_vulns:
            on_time = sum(1 for v in sev_vulns 
                         if v.status in ["resolved", "accepted", "false_positive"] 
                         and v.resolved_at and v.due_date 
                         and v.resolved_at <= v.due_date)
            total_resolved = sum(1 for v in sev_vulns 
                                if v.status in ["resolved", "accepted", "false_positive"])
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
        recent_activities=recent_activities
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
