from typing import List, Optional, Dict, Any
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import func

from ....models import (
    Vulnerability, VulnerabilityAssetLink, VulnerabilitySLAConfig,
    ITAsset, GRCUser, get_db
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
