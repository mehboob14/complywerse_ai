from typing import List, Optional
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session
from sqlalchemy import func
from pydantic import BaseModel

from ....models import (
    QAIPReview, AuditTemplate, AuditEngagement,
    GRCUser, get_db
)
from ....routers.auth_router import require_auth, get_user_tenants, get_user_primary_tenant

router = APIRouter(prefix="/qaip", tags=["Audit - QAIP & Templates"])

IIA_STANDARDS = [
    {"code": "1000", "name": "Purpose, Authority, and Responsibility", "category": "attribute"},
    {"code": "1100", "name": "Independence and Objectivity", "category": "attribute"},
    {"code": "1200", "name": "Proficiency and Due Professional Care", "category": "attribute"},
    {"code": "1300", "name": "Quality Assurance and Improvement Program", "category": "attribute"},
    {"code": "2000", "name": "Managing the Internal Audit Activity", "category": "performance"},
    {"code": "2010", "name": "Planning", "category": "performance"},
    {"code": "2020", "name": "Communication and Approval", "category": "performance"},
    {"code": "2030", "name": "Resource Management", "category": "performance"},
    {"code": "2040", "name": "Policies and Procedures", "category": "performance"},
    {"code": "2050", "name": "Coordination and Reliance", "category": "performance"},
    {"code": "2060", "name": "Reporting to Senior Management and the Board", "category": "performance"},
    {"code": "2100", "name": "Nature of Work", "category": "performance"},
    {"code": "2200", "name": "Engagement Planning", "category": "performance"},
    {"code": "2300", "name": "Performing the Engagement", "category": "performance"},
    {"code": "2310", "name": "Identifying Information", "category": "performance"},
    {"code": "2320", "name": "Analysis and Evaluation", "category": "performance"},
    {"code": "2330", "name": "Documenting Information", "category": "performance"},
    {"code": "2340", "name": "Engagement Supervision", "category": "performance"},
    {"code": "2400", "name": "Communicating Results", "category": "performance"},
    {"code": "2500", "name": "Monitoring Progress", "category": "performance"},
    {"code": "2600", "name": "Communicating the Acceptance of Risks", "category": "performance"},
]


class QAIPReviewCreate(BaseModel):
    engagement_id: Optional[int] = None
    review_type: Optional[str] = "internal"
    reviewer_id: Optional[int] = None
    peer_reviewer_id: Optional[int] = None
    checklist: Optional[list] = []


class QAIPReviewUpdate(BaseModel):
    checklist: Optional[list] = None
    iia_conformance: Optional[dict] = None
    maturity_score: Optional[float] = None
    overall_rating: Optional[str] = None
    findings: Optional[str] = None
    recommendations: Optional[str] = None
    status: Optional[str] = None


class TemplateCreate(BaseModel):
    name: str
    description: Optional[str] = None
    template_type: Optional[str] = "general"
    framework_type: Optional[str] = None
    procedures: Optional[list] = []
    checklist: Optional[list] = []


class TemplateUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    procedures: Optional[list] = None
    checklist: Optional[list] = None


@router.get("/reviews")
def list_qaip_reviews(
    status_filter: Optional[str] = Query(None, alias="status"),
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return {"reviews": [], "total": 0}
    
    query = db.query(QAIPReview).filter(QAIPReview.tenant_id.in_(user_tenants))
    if status_filter:
        query = query.filter(QAIPReview.status == status_filter)
    
    reviews = query.order_by(QAIPReview.created_at.desc()).all()
    result = []
    for r in reviews:
        result.append({
            "id": r.id,
            "engagement_id": r.engagement_id,
            "review_type": r.review_type,
            "reviewer_id": r.reviewer_id,
            "reviewer_name": (r.reviewer.display_name or r.reviewer.username) if r.reviewer else None,
            "peer_reviewer_id": r.peer_reviewer_id,
            "peer_reviewer_name": (r.peer_reviewer.display_name or r.peer_reviewer.username) if r.peer_reviewer else None,
            "checklist": r.checklist,
            "iia_conformance": r.iia_conformance,
            "maturity_score": r.maturity_score,
            "overall_rating": r.overall_rating,
            "findings": r.findings,
            "recommendations": r.recommendations,
            "status": r.status,
            "completed_at": r.completed_at.isoformat() if r.completed_at else None,
            "created_at": r.created_at.isoformat() if r.created_at else None,
        })
    
    return {"reviews": result, "total": len(result)}


@router.post("/reviews", status_code=status.HTTP_201_CREATED)
def create_qaip_review(
    data: QAIPReviewCreate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    tenant_id = get_user_primary_tenant(current_user, db)
    if not tenant_id:
        raise HTTPException(status_code=403, detail="No tenant access")
    
    default_checklist = data.checklist or [
        {"item": "Engagement objectives clearly defined", "status": "pending", "notes": ""},
        {"item": "Scope appropriately determined", "status": "pending", "notes": ""},
        {"item": "Risk assessment performed", "status": "pending", "notes": ""},
        {"item": "Work program adequate", "status": "pending", "notes": ""},
        {"item": "Evidence sufficient and appropriate", "status": "pending", "notes": ""},
        {"item": "Findings properly documented", "status": "pending", "notes": ""},
        {"item": "Conclusions supported by evidence", "status": "pending", "notes": ""},
        {"item": "Report clear and accurate", "status": "pending", "notes": ""},
        {"item": "Workpapers properly reviewed", "status": "pending", "notes": ""},
        {"item": "IIA Standards compliance verified", "status": "pending", "notes": ""},
    ]
    
    review = QAIPReview(
        tenant_id=tenant_id,
        engagement_id=data.engagement_id,
        review_type=data.review_type,
        reviewer_id=data.reviewer_id or current_user.id,
        peer_reviewer_id=data.peer_reviewer_id,
        checklist=default_checklist,
    )
    db.add(review)
    db.commit()
    db.refresh(review)
    return {"id": review.id, "status": review.status, "message": "QAIP review created"}


@router.put("/reviews/{review_id}")
def update_qaip_review(
    review_id: int,
    data: QAIPReviewUpdate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    review = db.query(QAIPReview).filter(
        QAIPReview.id == review_id,
        QAIPReview.tenant_id.in_(user_tenants)
    ).first()
    if not review:
        raise HTTPException(status_code=404, detail="Review not found")
    
    for field, value in data.dict(exclude_unset=True).items():
        setattr(review, field, value)
    
    if data.status == "completed":
        review.completed_at = datetime.utcnow()
    
    review.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(review)
    return {"id": review.id, "status": review.status, "message": "Review updated"}


@router.get("/iia-standards")
def get_iia_standards(
    current_user: GRCUser = Depends(require_auth)
):
    return {"standards": IIA_STANDARDS}


@router.get("/conformance")
def get_iia_conformance(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return {"conformance": {}, "overall_score": 0}
    
    reviews = db.query(QAIPReview).filter(
        QAIPReview.tenant_id.in_(user_tenants),
        QAIPReview.status == "completed"
    ).all()
    
    all_conformance = {}
    for r in reviews:
        if r.iia_conformance:
            for code, status in r.iia_conformance.items():
                if code not in all_conformance:
                    all_conformance[code] = {"conforms": 0, "partial": 0, "non_conform": 0, "total": 0}
                all_conformance[code]["total"] += 1
                if status == "conforms":
                    all_conformance[code]["conforms"] += 1
                elif status == "partial":
                    all_conformance[code]["partial"] += 1
                else:
                    all_conformance[code]["non_conform"] += 1
    
    total_checks = sum(v["total"] for v in all_conformance.values())
    total_conforms = sum(v["conforms"] for v in all_conformance.values())
    overall = (total_conforms / total_checks * 100) if total_checks > 0 else 0
    
    return {
        "conformance": all_conformance,
        "overall_score": round(overall, 1),
        "standards": IIA_STANDARDS,
    }


@router.get("/maturity")
def get_maturity_assessment(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return {"maturity": {}}
    
    reviews = db.query(QAIPReview).filter(
        QAIPReview.tenant_id.in_(user_tenants),
        QAIPReview.maturity_score.isnot(None)
    ).all()
    
    if not reviews:
        return {"maturity": {"level": "Initial", "score": 1.0, "description": "No maturity assessments completed yet"}}
    
    avg_score = sum(r.maturity_score for r in reviews) / len(reviews)
    
    if avg_score >= 4.5:
        level, desc = "Optimizing", "Continuous improvement culture with leading practices"
    elif avg_score >= 3.5:
        level, desc = "Managed", "Standardized and measured audit processes"
    elif avg_score >= 2.5:
        level, desc = "Defined", "Documented and consistent audit methodology"
    elif avg_score >= 1.5:
        level, desc = "Developing", "Basic audit processes in place but inconsistent"
    else:
        level, desc = "Initial", "Ad-hoc audit practices with limited structure"
    
    return {
        "maturity": {
            "level": level,
            "score": round(avg_score, 1),
            "description": desc,
            "reviews_count": len(reviews),
        }
    }


@router.get("/templates")
def list_templates(
    framework_type: Optional[str] = None,
    template_type: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return {"templates": [], "total": 0}
    
    from sqlalchemy import or_
    query = db.query(AuditTemplate).filter(
        or_(
            AuditTemplate.tenant_id.in_(user_tenants),
            AuditTemplate.is_system == True
        )
    )
    
    if framework_type:
        query = query.filter(AuditTemplate.framework_type == framework_type)
    if template_type:
        query = query.filter(AuditTemplate.template_type == template_type)
    
    templates = query.order_by(AuditTemplate.name).all()
    result = []
    for t in templates:
        result.append({
            "id": t.id,
            "name": t.name,
            "description": t.description,
            "template_type": t.template_type,
            "framework_type": t.framework_type,
            "procedures": t.procedures,
            "checklist": t.checklist,
            "is_system": t.is_system,
            "created_at": t.created_at.isoformat() if t.created_at else None,
        })
    
    return {"templates": result, "total": len(result)}


@router.post("/templates", status_code=status.HTTP_201_CREATED)
def create_template(
    data: TemplateCreate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    tenant_id = get_user_primary_tenant(current_user, db)
    if not tenant_id:
        raise HTTPException(status_code=403, detail="No tenant access")
    
    template = AuditTemplate(
        tenant_id=tenant_id,
        name=data.name,
        description=data.description,
        template_type=data.template_type,
        framework_type=data.framework_type,
        procedures=data.procedures or [],
        checklist=data.checklist or [],
    )
    db.add(template)
    db.commit()
    db.refresh(template)
    return {"id": template.id, "name": template.name, "message": "Template created"}


@router.put("/templates/{template_id}")
def update_template(
    template_id: int,
    data: TemplateUpdate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    template = db.query(AuditTemplate).filter(
        AuditTemplate.id == template_id,
        AuditTemplate.tenant_id.in_(user_tenants)
    ).first()
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")
    
    for field, value in data.dict(exclude_unset=True).items():
        setattr(template, field, value)
    
    template.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(template)
    return {"id": template.id, "name": template.name, "message": "Template updated"}


@router.delete("/templates/{template_id}")
def delete_template(
    template_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    template = db.query(AuditTemplate).filter(
        AuditTemplate.id == template_id,
        AuditTemplate.tenant_id.in_(user_tenants),
        AuditTemplate.is_system == False
    ).first()
    if not template:
        raise HTTPException(status_code=404, detail="Template not found or is a system template")
    
    db.delete(template)
    db.commit()
    return {"message": "Template deleted"}


@router.post("/templates/{template_id}/apply/{engagement_id}")
def apply_template_to_engagement(
    template_id: int,
    engagement_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    from sqlalchemy import or_
    template = db.query(AuditTemplate).filter(
        AuditTemplate.id == template_id,
        or_(
            AuditTemplate.tenant_id.in_(user_tenants),
            AuditTemplate.is_system == True
        )
    ).first()
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")
    
    eng = db.query(AuditEngagement).filter(
        AuditEngagement.id == engagement_id,
        AuditEngagement.tenant_id.in_(user_tenants)
    ).first()
    if not eng:
        raise HTTPException(status_code=404, detail="Engagement not found")
    
    from ....models import AuditWorkpaper, AuditProcedure
    
    wp = AuditWorkpaper(
        engagement_id=engagement_id,
        title=f"Template: {template.name}",
        description=template.description,
        workpaper_type="template",
        preparer_id=current_user.id,
    )
    db.add(wp)
    db.commit()
    db.refresh(wp)
    
    created_procedures = 0
    for idx, proc_data in enumerate(template.procedures or []):
        proc = AuditProcedure(
            workpaper_id=wp.id,
            procedure_number=f"P-{idx + 1:03d}",
            title=proc_data.get("title", f"Procedure {idx + 1}"),
            description=proc_data.get("description", ""),
            test_type=proc_data.get("test_type", "control_test"),
            sampling_methodology=proc_data.get("sampling_methodology"),
        )
        db.add(proc)
        created_procedures += 1
    
    db.commit()
    return {
        "message": f"Template applied: created workpaper with {created_procedures} procedures",
        "workpaper_id": wp.id,
    }
