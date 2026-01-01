from typing import Optional
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import func

from ..models import (
    Framework, FrameworkDomain, ControlObjective, FrameworkControl,
    NormalizedControl, ControlMapping, Evidence, EvidenceControlMapping,
    Risk, Document, ITAsset, GRCUser, get_db
)
from .auth_router import require_auth, get_user_tenants

router = APIRouter(prefix="/dashboard", tags=["Dashboard"])


def calculate_framework_compliance(framework_id: int, user_tenants: list, db: Session) -> dict:
    total_controls = db.query(func.count(FrameworkControl.id)).join(
        ControlObjective, FrameworkControl.objective_id == ControlObjective.id
    ).join(
        FrameworkDomain, ControlObjective.domain_id == FrameworkDomain.id
    ).filter(
        FrameworkDomain.framework_id == framework_id
    ).scalar() or 0
    
    if total_controls == 0:
        return {"score": 0, "status": "not_started", "total_controls": 0, "covered_controls": 0}
    
    framework_control_ids = db.query(FrameworkControl.id).join(
        ControlObjective, FrameworkControl.objective_id == ControlObjective.id
    ).join(
        FrameworkDomain, ControlObjective.domain_id == FrameworkDomain.id
    ).filter(
        FrameworkDomain.framework_id == framework_id
    ).all()
    framework_control_ids = [fc[0] for fc in framework_control_ids]
    
    normalized_control_ids = db.query(ControlMapping.normalized_control_id).filter(
        ControlMapping.framework_control_id.in_(framework_control_ids)
    ).distinct().all()
    normalized_control_ids = [nc[0] for nc in normalized_control_ids]
    
    if not user_tenants:
        return {"score": 0, "status": "not_started", "total_controls": total_controls, "covered_controls": 0}
    
    controls_with_evidence = 0
    if normalized_control_ids:
        controls_with_evidence = db.query(func.count(func.distinct(EvidenceControlMapping.normalized_control_id))).join(
            Evidence, EvidenceControlMapping.evidence_id == Evidence.id
        ).filter(
            EvidenceControlMapping.normalized_control_id.in_(normalized_control_ids),
            Evidence.tenant_id.in_(user_tenants),
            Evidence.status == "approved"
        ).scalar() or 0
    
    controls_with_direct_evidence = 0
    if framework_control_ids:
        controls_with_direct_evidence = db.query(func.count(func.distinct(EvidenceControlMapping.framework_control_id))).join(
            Evidence, EvidenceControlMapping.evidence_id == Evidence.id
        ).filter(
            EvidenceControlMapping.framework_control_id.in_(framework_control_ids),
            Evidence.tenant_id.in_(user_tenants),
            Evidence.status == "approved"
        ).scalar() or 0
    
    covered_controls = max(controls_with_evidence, controls_with_direct_evidence)
    
    score = round((covered_controls / total_controls) * 100) if total_controls > 0 else 0
    
    if score >= 90:
        status = "compliant"
    elif score >= 70:
        status = "partial"
    elif score >= 30:
        status = "in_progress"
    else:
        status = "not_started"
    
    return {
        "score": score,
        "status": status,
        "total_controls": total_controls,
        "covered_controls": covered_controls
    }


@router.get("/stats")
def get_dashboard_stats(
    tenant_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    frameworks_count = db.query(func.count(Framework.id)).filter(Framework.is_active == True).scalar()
    controls_count = db.query(func.count(NormalizedControl.id)).scalar()
    
    if user_tenants:
        tenant_filter = user_tenants
        if tenant_id and tenant_id in user_tenants:
            tenant_filter = [tenant_id]
        
        evidence_count = db.query(func.count(Evidence.id)).filter(
            Evidence.tenant_id.in_(tenant_filter)
        ).scalar()
        
        open_risks = db.query(func.count(Risk.id)).filter(
            Risk.status.in_(["identified", "under_review", "mitigating"]),
            Risk.tenant_id.in_(tenant_filter)
        ).scalar()
        
        documents_count = db.query(func.count(Document.id)).filter(
            Document.tenant_id.in_(tenant_filter)
        ).scalar()
        
        assets_count = db.query(func.count(ITAsset.id)).filter(
            ITAsset.tenant_id.in_(tenant_filter)
        ).scalar()
    else:
        evidence_count = 0
        open_risks = 0
        documents_count = 0
        assets_count = 0
    
    frameworks = db.query(Framework).filter(Framework.is_active == True).all()
    compliance_overview = []
    
    for fw in frameworks[:5]:
        compliance_data = calculate_framework_compliance(fw.id, user_tenants, db)
        compliance_overview.append({
            "framework": fw.name,
            "short_code": fw.short_code,
            "score": compliance_data["score"],
            "status": compliance_data["status"],
            "total_controls": compliance_data["total_controls"],
            "covered_controls": compliance_data["covered_controls"]
        })
    
    recent_activity = []
    if user_tenants:
        recent_evidence = db.query(Evidence).filter(
            Evidence.tenant_id.in_(user_tenants)
        ).order_by(Evidence.uploaded_at.desc()).limit(5).all()
        
        for ev in recent_evidence:
            recent_activity.append({
                "type": "evidence",
                "action": "uploaded",
                "name": ev.name,
                "timestamp": ev.uploaded_at.isoformat(),
                "status": ev.status
            })
        
        recent_risks = db.query(Risk).filter(
            Risk.tenant_id.in_(user_tenants)
        ).order_by(Risk.created_at.desc()).limit(3).all()
        
        for risk in recent_risks:
            recent_activity.append({
                "type": "risk",
                "action": "created",
                "name": risk.title,
                "timestamp": risk.created_at.isoformat(),
                "status": risk.status
            })
        
        recent_activity.sort(key=lambda x: x["timestamp"], reverse=True)
        recent_activity = recent_activity[:5]
    
    return {
        "stats": {
            "frameworks": frameworks_count or 0,
            "controls": controls_count or 0,
            "evidence": evidence_count or 0,
            "open_risks": open_risks or 0,
            "documents": documents_count or 0,
            "assets": assets_count or 0
        },
        "compliance_overview": compliance_overview,
        "recent_activity": recent_activity
    }


@router.get("/compliance/{framework_id}")
def get_framework_compliance_detail(
    framework_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    framework = db.query(Framework).filter(Framework.id == framework_id).first()
    if not framework:
        return {"error": "Framework not found"}
    
    domains = db.query(FrameworkDomain).filter(
        FrameworkDomain.framework_id == framework_id
    ).order_by(FrameworkDomain.order).all()
    
    domain_compliance = []
    for domain in domains:
        domain_control_count = db.query(func.count(FrameworkControl.id)).join(
            ControlObjective, FrameworkControl.objective_id == ControlObjective.id
        ).filter(
            ControlObjective.domain_id == domain.id
        ).scalar() or 0
        
        domain_control_ids = db.query(FrameworkControl.id).join(
            ControlObjective, FrameworkControl.objective_id == ControlObjective.id
        ).filter(
            ControlObjective.domain_id == domain.id
        ).all()
        domain_control_ids = [dc[0] for dc in domain_control_ids]
        
        covered = 0
        if domain_control_ids and user_tenants:
            covered = db.query(func.count(func.distinct(EvidenceControlMapping.framework_control_id))).join(
                Evidence, EvidenceControlMapping.evidence_id == Evidence.id
            ).filter(
                EvidenceControlMapping.framework_control_id.in_(domain_control_ids),
                Evidence.tenant_id.in_(user_tenants),
                Evidence.status == "approved"
            ).scalar() or 0
        
        score = round((covered / domain_control_count) * 100) if domain_control_count > 0 else 0
        
        domain_compliance.append({
            "domain_id": domain.id,
            "code": domain.code,
            "name": domain.name,
            "total_controls": domain_control_count,
            "covered_controls": covered,
            "score": score
        })
    
    overall = calculate_framework_compliance(framework_id, user_tenants, db)
    
    return {
        "framework": {
            "id": framework.id,
            "name": framework.name,
            "short_code": framework.short_code
        },
        "overall_compliance": overall,
        "domain_compliance": domain_compliance
    }
