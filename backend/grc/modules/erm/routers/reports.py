from typing import List, Optional
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session

from ....models import (
    Risk, RiskIncident, RiskReview, RiskKRI, RiskReport,
    RiskAppetiteConfig, BusinessUnit, GRCUser, get_db
)
from ....schemas import (
    RiskReportCreate, RiskReportResponse,
    ExecutiveDashboard, BoardReportData, DepartmentRiskSummary,
    AggregatedRiskView
)
from ....routers.auth_router import require_auth, get_user_tenants, get_user_primary_tenant

router = APIRouter(prefix="/reports", tags=["ERM - Reports"])


def get_user_tenant_id(user: GRCUser, db: Session) -> int:
    tenant_id = get_user_primary_tenant(user, db)
    if not tenant_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="User is not assigned to any tenant"
        )
    return tenant_id


def calculate_kri_status(value: float, kri: RiskKRI) -> str:
    if kri.green_threshold is None or kri.amber_threshold is None:
        return "unknown"
    
    if kri.threshold_direction == "lower_is_better":
        if value <= kri.green_threshold:
            return "green"
        elif value <= kri.amber_threshold:
            return "amber"
        else:
            return "red"
    else:
        if value >= kri.green_threshold:
            return "green"
        elif value >= kri.amber_threshold:
            return "amber"
        else:
            return "red"


@router.get("", response_model=List[RiskReportResponse])
def list_reports(
    report_type: Optional[str] = None,
    status_filter: Optional[str] = None,
    skip: int = 0,
    limit: int = 50,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    tenant_id = get_user_tenant_id(current_user, db)
    
    query = db.query(RiskReport).filter(RiskReport.tenant_id == tenant_id)
    
    if report_type:
        query = query.filter(RiskReport.report_type == report_type)
    if status_filter:
        query = query.filter(RiskReport.status == status_filter)
    
    reports = query.order_by(RiskReport.generated_at.desc()).offset(skip).limit(limit).all()
    return reports


@router.post("/generate", response_model=RiskReportResponse, status_code=status.HTTP_201_CREATED)
def generate_report(
    report: RiskReportCreate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    tenant_id = get_user_tenant_id(current_user, db)
    
    risks = db.query(Risk).filter(Risk.tenant_id == tenant_id).all()
    incidents = db.query(RiskIncident).filter(RiskIncident.tenant_id == tenant_id).all()
    
    by_category = {}
    by_status = {}
    by_score_band = {"critical": 0, "high": 0, "medium": 0, "low": 0}
    
    for risk in risks:
        cat = risk.risk_category or risk.category
        by_category[cat] = by_category.get(cat, 0) + 1
        by_status[risk.status] = by_status.get(risk.status, 0) + 1
        
        score = risk.residual_score or risk.inherent_score or 0
        if score >= 20:
            by_score_band["critical"] += 1
        elif score >= 12:
            by_score_band["high"] += 1
        elif score >= 6:
            by_score_band["medium"] += 1
        else:
            by_score_band["low"] += 1
    
    report_data = {
        "generated_at": datetime.utcnow().isoformat(),
        "total_risks": len(risks),
        "by_category": by_category,
        "by_status": by_status,
        "by_score_band": by_score_band,
        "total_incidents": len(incidents),
        "open_incidents": sum(1 for i in incidents if i.status in ["open", "investigating"]),
        "top_risks": [
            {"id": r.id, "title": r.title, "score": r.residual_score or r.inherent_score}
            for r in sorted(risks, key=lambda x: x.residual_score or x.inherent_score or 0, reverse=True)[:10]
        ]
    }
    
    db_report = RiskReport(
        tenant_id=tenant_id,
        report_type=report.report_type,
        title=report.title,
        description=report.description,
        report_period_start=report.report_period_start,
        report_period_end=report.report_period_end,
        generated_by=current_user.id,
        report_data=report_data,
        status="generated"
    )
    db.add(db_report)
    db.commit()
    db.refresh(db_report)
    return db_report


@router.get("/executive-dashboard", response_model=ExecutiveDashboard)
def get_executive_dashboard(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    tenant_id = get_user_tenant_id(current_user, db)
    
    risks = db.query(Risk).filter(Risk.tenant_id == tenant_id).all()
    
    by_category = {}
    by_status = {}
    by_score_band = {"critical": 0, "high": 0, "medium": 0, "low": 0}
    
    for risk in risks:
        cat = risk.risk_category or risk.category
        by_category[cat] = by_category.get(cat, 0) + 1
        by_status[risk.status] = by_status.get(risk.status, 0) + 1
        
        score = risk.residual_score or risk.inherent_score or 0
        if score >= 20:
            by_score_band["critical"] += 1
        elif score >= 12:
            by_score_band["high"] += 1
        elif score >= 6:
            by_score_band["medium"] += 1
        else:
            by_score_band["low"] += 1
    
    appetite_configs = db.query(RiskAppetiteConfig).filter(
        RiskAppetiteConfig.tenant_id == tenant_id
    ).all()
    config_map = {c.category: c for c in appetite_configs}
    
    breaches = []
    for risk in risks:
        category = risk.risk_category or risk.category
        score = risk.residual_score or risk.inherent_score or 0
        config = config_map.get(category)
        if config and score > config.max_acceptable_score:
            breaches.append({
                "risk_id": risk.id,
                "risk_title": risk.title,
                "category": category,
                "score": score,
                "threshold": config.max_acceptable_score
            })
    
    top_risks = sorted(risks, key=lambda x: x.residual_score or x.inherent_score or 0, reverse=True)[:10]
    
    recent_incidents = db.query(RiskIncident).filter(
        RiskIncident.tenant_id == tenant_id
    ).order_by(RiskIncident.incident_date.desc()).limit(5).all()
    
    kri_alerts = db.query(RiskKRI).join(Risk).filter(
        Risk.tenant_id == tenant_id,
        RiskKRI.is_active == True,
        RiskKRI.current_value.isnot(None)
    ).all()
    
    kri_alert_list = []
    for kri in kri_alerts:
        kri_status = calculate_kri_status(kri.current_value, kri)
        if kri_status in ["red", "amber"]:
            kri_alert_list.append({
                "kri_id": kri.id,
                "name": kri.name,
                "value": kri.current_value,
                "status": kri_status
            })
    
    now = datetime.utcnow()
    pending_reviews = db.query(RiskReview).join(Risk).filter(
        Risk.tenant_id == tenant_id,
        RiskReview.status.in_(["pending", "in_review"])
    ).count()
    
    overdue_reviews = db.query(RiskReview).join(Risk).filter(
        Risk.tenant_id == tenant_id,
        RiskReview.status.in_(["pending", "in_review"]),
        RiskReview.due_date < now
    ).count()
    
    return ExecutiveDashboard(
        total_risks=len(risks),
        risks_by_category=by_category,
        risks_by_status=by_status,
        risks_by_score_band=by_score_band,
        appetite_breaches=breaches,
        top_risks=[
            {"id": r.id, "title": r.title, "category": r.risk_category or r.category,
             "score": r.residual_score or r.inherent_score, "status": r.status}
            for r in top_risks
        ],
        recent_incidents=[
            {"id": i.id, "title": i.title, "severity": i.severity, "date": i.incident_date.isoformat()}
            for i in recent_incidents
        ],
        kri_alerts=kri_alert_list,
        pending_reviews=pending_reviews,
        overdue_reviews=overdue_reviews,
        trend_summary={
            "total_tracked": len(risks),
            "period": "90 days"
        }
    )


@router.get("/board-summary", response_model=BoardReportData)
def get_board_summary(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    tenant_id = get_user_tenant_id(current_user, db)
    
    risks = db.query(Risk).filter(Risk.tenant_id == tenant_id).all()
    incidents = db.query(RiskIncident).filter(RiskIncident.tenant_id == tenant_id).all()
    
    by_category = {}
    by_status = {}
    total_inherent = 0
    total_residual = 0
    count_with_score = 0
    
    for risk in risks:
        cat = risk.risk_category or risk.category
        by_category[cat] = by_category.get(cat, 0) + 1
        by_status[risk.status] = by_status.get(risk.status, 0) + 1
        if risk.inherent_score:
            total_inherent += risk.inherent_score
            count_with_score += 1
        if risk.residual_score:
            total_residual += risk.residual_score
    
    configs = db.query(RiskAppetiteConfig).filter(
        RiskAppetiteConfig.tenant_id == tenant_id
    ).all()
    config_map = {c.category: c for c in configs}
    
    appetite_status = []
    for cat, count in by_category.items():
        config = config_map.get(cat)
        cat_risks = [r for r in risks if (r.risk_category or r.category) == cat]
        breaching = sum(
            1 for r in cat_risks
            if config and (r.residual_score or r.inherent_score or 0) > config.max_acceptable_score
        )
        appetite_status.append({
            "category": cat,
            "total_risks": count,
            "breaching_appetite": breaching,
            "appetite_level": config.appetite_level if config else "undefined",
            "max_score": config.max_acceptable_score if config else None
        })
    
    top_risks = sorted(risks, key=lambda x: x.residual_score or x.inherent_score or 0, reverse=True)[:5]
    
    open_incidents = sum(1 for i in incidents if i.status in ["open", "investigating"])
    total_impact = sum(i.financial_impact or 0 for i in incidents)
    
    return BoardReportData(
        report_period=f"{datetime.utcnow().strftime('%B %Y')}",
        executive_summary=f"The organization currently manages {len(risks)} identified risks across {len(by_category)} categories. {by_status.get('open', 0)} risks remain open, with {len([r for r in risks if (r.residual_score or r.inherent_score or 0) >= 20])} rated as critical.",
        risk_overview={
            "total_risks": len(risks),
            "by_category": by_category,
            "by_status": by_status,
            "avg_inherent_score": round(total_inherent / count_with_score, 1) if count_with_score else 0,
            "avg_residual_score": round(total_residual / count_with_score, 1) if count_with_score else 0
        },
        appetite_status=appetite_status,
        top_risks=[
            {
                "id": r.id,
                "title": r.title,
                "category": r.risk_category or r.category,
                "score": r.residual_score or r.inherent_score,
                "status": r.status,
                "treatment_plan": r.treatment_plan
            }
            for r in top_risks
        ],
        key_changes=[],
        incidents_summary={
            "total_incidents": len(incidents),
            "open_incidents": open_incidents,
            "total_financial_impact": total_impact
        },
        recommendations=[
            "Review and update risk assessments for critical risks",
            "Address appetite breaches through enhanced controls",
            "Complete pending risk reviews before due dates"
        ]
    )


@router.get("/department/{bu_id}", response_model=DepartmentRiskSummary)
def get_department_summary(
    bu_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    tenant_id = get_user_tenant_id(current_user, db)
    
    bu = db.query(BusinessUnit).filter(
        BusinessUnit.id == bu_id,
        BusinessUnit.tenant_id == tenant_id
    ).first()
    
    if not bu:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Business unit not found"
        )
    
    risks = db.query(Risk).filter(
        Risk.tenant_id == tenant_id,
        Risk.business_unit_id == bu_id
    ).all()
    
    by_category = {}
    by_status = {}
    total_inherent = 0
    total_residual = 0
    count = 0
    critical_risks = []
    
    configs = db.query(RiskAppetiteConfig).filter(
        RiskAppetiteConfig.tenant_id == tenant_id
    ).all()
    config_map = {c.category: c for c in configs}
    
    breaches = 0
    
    for risk in risks:
        cat = risk.risk_category or risk.category
        by_category[cat] = by_category.get(cat, 0) + 1
        by_status[risk.status] = by_status.get(risk.status, 0) + 1
        
        score = risk.residual_score or risk.inherent_score or 0
        if risk.inherent_score:
            total_inherent += risk.inherent_score
            count += 1
        if risk.residual_score:
            total_residual += risk.residual_score
        
        if score >= 20:
            critical_risks.append({
                "id": risk.id,
                "title": risk.title,
                "score": score,
                "status": risk.status
            })
        
        config = config_map.get(cat)
        if config and score > config.max_acceptable_score:
            breaches += 1
    
    return DepartmentRiskSummary(
        business_unit_id=bu_id,
        business_unit_name=bu.name,
        total_risks=len(risks),
        by_category=by_category,
        by_status=by_status,
        critical_risks=critical_risks,
        avg_inherent_score=round(total_inherent / count, 1) if count else 0,
        avg_residual_score=round(total_residual / count, 1) if count else 0,
        appetite_breaches=breaches
    )


@router.get("/audit-export")
def get_audit_export(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    tenant_id = get_user_tenant_id(current_user, db)
    
    risks = db.query(Risk).filter(Risk.tenant_id == tenant_id).all()
    incidents = db.query(RiskIncident).filter(RiskIncident.tenant_id == tenant_id).all()
    reviews = db.query(RiskReview).join(Risk).filter(Risk.tenant_id == tenant_id).all()
    configs = db.query(RiskAppetiteConfig).filter(RiskAppetiteConfig.tenant_id == tenant_id).all()
    
    return {
        "export_date": datetime.utcnow().isoformat(),
        "tenant_id": tenant_id,
        "risks": [
            {
                "id": r.id,
                "title": r.title,
                "description": r.description,
                "category": r.risk_category or r.category,
                "status": r.status,
                "inherent_likelihood": r.inherent_likelihood,
                "inherent_impact": r.inherent_impact,
                "inherent_score": r.inherent_score,
                "residual_likelihood": r.residual_likelihood,
                "residual_impact": r.residual_impact,
                "residual_score": r.residual_score,
                "treatment_plan": r.treatment_plan,
                "owner_id": r.owner_id,
                "created_at": r.created_at.isoformat() if r.created_at else None,
                "updated_at": r.updated_at.isoformat() if r.updated_at else None
            }
            for r in risks
        ],
        "incidents": [
            {
                "id": i.id,
                "title": i.title,
                "risk_id": i.risk_id,
                "severity": i.severity,
                "status": i.status,
                "incident_date": i.incident_date.isoformat() if i.incident_date else None,
                "financial_impact": i.financial_impact,
                "root_cause": i.root_cause,
                "corrective_actions": i.corrective_actions
            }
            for i in incidents
        ],
        "reviews": [
            {
                "id": r.id,
                "risk_id": r.risk_id,
                "review_type": r.review_type,
                "status": r.status,
                "due_date": r.due_date.isoformat() if r.due_date else None,
                "completed_at": r.completed_at.isoformat() if r.completed_at else None,
                "findings": r.findings
            }
            for r in reviews
        ],
        "appetite_config": [
            {
                "category": c.category,
                "appetite_level": c.appetite_level,
                "max_acceptable_score": c.max_acceptable_score
            }
            for c in configs
        ],
        "summary": {
            "total_risks": len(risks),
            "total_incidents": len(incidents),
            "total_reviews": len(reviews),
            "open_risks": sum(1 for r in risks if r.status == "open"),
            "open_incidents": sum(1 for i in incidents if i.status in ["open", "investigating"])
        }
    }


@router.get("/{report_id}", response_model=RiskReportResponse)
def get_report(
    report_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    tenant_id = get_user_tenant_id(current_user, db)
    
    report = db.query(RiskReport).filter(
        RiskReport.id == report_id,
        RiskReport.tenant_id == tenant_id
    ).first()
    
    if not report:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Report not found"
        )
    
    return report


@router.get("/aggregated", response_model=List[AggregatedRiskView])
def get_aggregated_views(
    group_by: str = Query("category", description="Group by: category, status, business_unit"),
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    tenant_id = get_user_tenant_id(current_user, db)
    
    risks = db.query(Risk).filter(Risk.tenant_id == tenant_id).all()
    
    groups = {}
    
    for risk in risks:
        if group_by == "category":
            key = risk.risk_category or risk.category or "uncategorized"
        elif group_by == "status":
            key = risk.status or "unknown"
        elif group_by == "business_unit":
            key = str(risk.business_unit_id) if risk.business_unit_id else "unassigned"
        else:
            key = "all"
        
        if key not in groups:
            groups[key] = {
                "risks": [],
                "critical": 0, "high": 0, "medium": 0, "low": 0,
                "open": 0, "in_treatment": 0, "mitigated": 0,
                "inherent_total": 0, "residual_total": 0, "count_with_score": 0
            }
        
        groups[key]["risks"].append(risk)
        
        score = risk.residual_score or risk.inherent_score or 0
        if score >= 20:
            groups[key]["critical"] += 1
        elif score >= 12:
            groups[key]["high"] += 1
        elif score >= 6:
            groups[key]["medium"] += 1
        else:
            groups[key]["low"] += 1
        
        if risk.status == "open":
            groups[key]["open"] += 1
        elif risk.status == "in_treatment":
            groups[key]["in_treatment"] += 1
        elif risk.status == "mitigated":
            groups[key]["mitigated"] += 1
        
        if risk.inherent_score:
            groups[key]["inherent_total"] += risk.inherent_score
            groups[key]["count_with_score"] += 1
        if risk.residual_score:
            groups[key]["residual_total"] += risk.residual_score
    
    result = []
    for key, data in groups.items():
        count = data["count_with_score"]
        result.append(AggregatedRiskView(
            group_by=group_by,
            group_value=key,
            total_risks=len(data["risks"]),
            critical_count=data["critical"],
            high_count=data["high"],
            medium_count=data["medium"],
            low_count=data["low"],
            avg_inherent_score=round(data["inherent_total"] / count, 2) if count else 0,
            avg_residual_score=round(data["residual_total"] / count, 2) if count else 0,
            open_count=data["open"],
            in_treatment_count=data["in_treatment"],
            mitigated_count=data["mitigated"]
        ))
    
    return sorted(result, key=lambda x: x.total_risks, reverse=True)
