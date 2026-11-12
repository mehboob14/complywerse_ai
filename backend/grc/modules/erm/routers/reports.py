from typing import List, Optional
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status, Query
from fastapi.responses import Response
from sqlalchemy import or_
from sqlalchemy.orm import Session

from ....models import (
    Risk, RiskIncident, RiskReview, RiskKRI, RiskReport, CommitteeMeeting, GovernanceCommittee,
    RiskAppetiteConfig, BusinessUnit, GRCUser, get_db, risk_priority_for_score
)
from ....schemas import (
    RiskReportCreate, RiskReportResponse, CommitteePackUpdate,
    ExecutiveDashboard, BoardReportData, DepartmentRiskSummary,
    AggregatedRiskView
)
from ....routers.auth_router import (require_auth, get_user_tenants, get_user_primary_tenant, require_tenant_permission,
                                     has_tenant_permission)
from ....services.segregation import ensure_independent
from .. import committee_packs
# The appetite page's rules, so a report reads a risk the same way: residual else inherent (0 is a score), the risk
# category else the category, the tolerance else the max acceptable score.
from .appetite import _breaches, _score, _tolerance as appetite_limit, appetite_category

router = APIRouter(prefix="/reports", tags=["ERM - Reports"])

PACK = "committee_pack"
PACK_EDIT = ("erm:risks:edit", "risks:risk_register:edit")


def get_user_tenant_id(user: GRCUser, db: Session) -> int:
    tenant_id = get_user_primary_tenant(user, db)
    if not tenant_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="User is not assigned to any tenant"
        )
    return tenant_id




def _count_bands(risks) -> dict:
    """Risks per severity band; an unscored risk has no band, so it is not counted as low."""
    bands = [risk_priority_for_score(_score(r)) for r in risks]
    return {band: bands.count(band) for band in ("critical", "high", "medium", "low")}


def breaches_appetite(risk: Risk, config: Optional[RiskAppetiteConfig]) -> bool:
    """Residual (else inherent) above the category's limit; a category with no appetite set has no limit."""
    return config is not None and _breaches(_score(risk), appetite_limit(config))


def _tenant_kris(db: Session, tenant_id: int):
    """Active KRIs with a value, standalone ones included (they belong to the tenant, not to a risk)."""
    return db.query(RiskKRI).outerjoin(Risk, RiskKRI.risk_id == Risk.id).filter(
        or_(RiskKRI.tenant_id == tenant_id, Risk.tenant_id == tenant_id),
        RiskKRI.is_active == True,
        RiskKRI.current_value.isnot(None)
    ).all()


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


@router.post("/generate", response_model=RiskReportResponse, status_code=status.HTTP_201_CREATED, dependencies=[Depends(require_tenant_permission("erm:risks:create", "risks:risk_register:create"))])
def generate_report(
    report: RiskReportCreate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    tenant_id = get_user_tenant_id(current_user, db)
    if report.report_type == PACK:
        return _build_pack(db, report, current_user, tenant_id)

    risks = db.query(Risk).filter(Risk.status.is_distinct_from("draft"), Risk.tenant_id == tenant_id).all()
    incidents = db.query(RiskIncident).filter(RiskIncident.tenant_id == tenant_id).all()

    by_category = {}
    by_status = {}
    by_score_band = _count_bands(risks)

    for risk in risks:
        cat = appetite_category(risk)
        by_category[cat] = by_category.get(cat, 0) + 1
        by_status[risk.status] = by_status.get(risk.status, 0) + 1

    report_data = {
        "generated_at": datetime.utcnow().isoformat(),
        "total_risks": len(risks),
        "by_category": by_category,
        "by_status": by_status,
        "by_score_band": by_score_band,
        "total_incidents": len(incidents),
        "open_incidents": sum(1 for i in incidents if i.status in ["open", "investigating"]),
        "top_risks": [
            {"id": r.id, "title": r.title, "score": _score(r)}
            for r in sorted(risks, key=lambda x: _score(x) or 0, reverse=True)[:10]
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
    
    risks = db.query(Risk).filter(Risk.status.is_distinct_from("draft"), Risk.tenant_id == tenant_id).all()
    
    by_category = {}
    by_status = {}
    by_score_band = _count_bands(risks)

    for risk in risks:
        cat = appetite_category(risk)
        by_category[cat] = by_category.get(cat, 0) + 1
        by_status[risk.status] = by_status.get(risk.status, 0) + 1

    appetite_configs = db.query(RiskAppetiteConfig).filter(
        RiskAppetiteConfig.tenant_id == tenant_id
    ).all()
    config_map = {c.category: c for c in appetite_configs}

    breaches = []
    for risk in risks:
        category = appetite_category(risk)
        config = config_map.get(category)
        if breaches_appetite(risk, config):
            breaches.append({
                "risk_id": risk.id,
                "risk_title": risk.title,
                "category": category,
                "score": _score(risk),
                "threshold": appetite_limit(config)
            })
    
    top_risks = sorted(risks, key=lambda x: _score(x) or 0, reverse=True)[:10]
    
    recent_incidents = db.query(RiskIncident).filter(
        RiskIncident.tenant_id == tenant_id
    ).order_by(RiskIncident.incident_date.desc()).limit(5).all()
    
    kri_alerts = _tenant_kris(db, tenant_id)

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
        RiskReview.status.in_(["pending", "in_review", "submitted"])
    ).count()
    
    overdue_reviews = db.query(RiskReview).join(Risk).filter(
        Risk.tenant_id == tenant_id,
        RiskReview.status.in_(["pending", "in_review", "submitted"]),
        RiskReview.due_date < now
    ).count()
    
    return ExecutiveDashboard(
        total_risks=len(risks),
        risks_by_category=by_category,
        risks_by_status=by_status,
        risks_by_score_band=by_score_band,
        appetite_breaches=breaches,
        top_risks=[
            {"id": r.id, "title": r.title, "category": appetite_category(r),
             "score": _score(r), "status": r.status}
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
            # the figures are the register as it stands now, not a window of history
            "period": f"as of {now.date().isoformat()}"
        }
    )


@router.get("/board-summary", response_model=BoardReportData)
def get_board_summary(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    tenant_id = get_user_tenant_id(current_user, db)
    
    risks = db.query(Risk).filter(Risk.status.is_distinct_from("draft"), Risk.tenant_id == tenant_id).all()
    incidents = db.query(RiskIncident).filter(RiskIncident.tenant_id == tenant_id).all()
    
    by_category = {}
    by_status = {}
    total_inherent = 0
    total_residual = 0
    count_with_score = 0
    count_with_residual = 0

    for risk in risks:
        cat = appetite_category(risk)
        by_category[cat] = by_category.get(cat, 0) + 1
        by_status[risk.status] = by_status.get(risk.status, 0) + 1
        if risk.inherent_score is not None:
            total_inherent += risk.inherent_score
            count_with_score += 1
        if risk.residual_score is not None:
            total_residual += risk.residual_score
            count_with_residual += 1

    configs = db.query(RiskAppetiteConfig).filter(
        RiskAppetiteConfig.tenant_id == tenant_id
    ).all()
    config_map = {c.category: c for c in configs}

    appetite_status = []
    for cat, count in by_category.items():
        config = config_map.get(cat)
        cat_risks = [r for r in risks if (appetite_category(r)) == cat]
        breaching = sum(1 for r in cat_risks if breaches_appetite(r, config))
        appetite_status.append({
            "category": cat,
            "total_risks": count,
            "breaching_appetite": breaching,
            "appetite_level": config.appetite_level if config else "undefined",
            "max_score": config.max_acceptable_score if config else None
        })
    
    top_risks = sorted(risks, key=lambda x: _score(x) or 0, reverse=True)[:5]
    
    open_incidents = sum(1 for i in incidents if i.status in ["open", "investigating"])
    # Loss per currency: financial_impact is the free-text-era figure, and amounts in different currencies never add up.
    loss_this_quarter, loss_last_quarter = committee_packs.loss_quarters(incidents)

    return BoardReportData(
        report_period=f"{datetime.utcnow().strftime('%B %Y')}",
        executive_summary=f"The organization currently manages {len(risks)} identified risks across {len(by_category)} categories. {by_status.get('open', 0)} risks remain open, with {_count_bands(risks)['critical']} rated as critical.",
        risk_overview={
            "total_risks": len(risks),
            "by_category": by_category,
            "by_status": by_status,
            "avg_inherent_score": round(total_inherent / count_with_score, 1) if count_with_score else 0,
            "avg_residual_score": round(total_residual / count_with_residual, 1) if count_with_residual else 0
        },
        appetite_status=appetite_status,
        top_risks=[
            {
                "id": r.id,
                "title": r.title,
                "category": appetite_category(r),
                "score": _score(r),
                "status": r.status,
                "treatment_plan": r.treatment_plan
            }
            for r in top_risks
        ],
        key_changes=[],  # no period-over-period comparison is computed yet
        incidents_summary={
            "total_incidents": len(incidents),
            "open_incidents": open_incidents,
            "net_loss_this_quarter": loss_this_quarter,
            "net_loss_last_quarter": loss_last_quarter,
        },
        recommendations=[],  # the same three sentences were sent whatever the data; nothing derives real ones yet
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
    
    risks = db.query(Risk).filter(Risk.status.is_distinct_from("draft"),
        Risk.tenant_id == tenant_id,
        Risk.business_unit_id == bu_id
    ).all()
    
    by_category = {}
    by_status = {}
    total_inherent = 0
    total_residual = 0
    count = 0
    residual_count = 0
    critical_risks = []

    configs = db.query(RiskAppetiteConfig).filter(
        RiskAppetiteConfig.tenant_id == tenant_id
    ).all()
    config_map = {c.category: c for c in configs}

    breaches = 0

    for risk in risks:
        cat = appetite_category(risk)
        by_category[cat] = by_category.get(cat, 0) + 1
        by_status[risk.status] = by_status.get(risk.status, 0) + 1

        if risk.inherent_score is not None:
            total_inherent += risk.inherent_score
            count += 1
        if risk.residual_score is not None:
            total_residual += risk.residual_score
            residual_count += 1

        if risk_priority_for_score(_score(risk)) == "critical":
            critical_risks.append({
                "id": risk.id,
                "title": risk.title,
                "score": _score(risk),
                "status": risk.status
            })

        if breaches_appetite(risk, config_map.get(cat)):
            breaches += 1
    
    return DepartmentRiskSummary(
        business_unit_id=bu_id,
        business_unit_name=bu.name,
        total_risks=len(risks),
        by_category=by_category,
        by_status=by_status,
        critical_risks=critical_risks,
        avg_inherent_score=round(total_inherent / count, 1) if count else 0,
        avg_residual_score=round(total_residual / residual_count, 1) if residual_count else 0,
        appetite_breaches=breaches
    )


@router.get("/audit-export")
def get_audit_export(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    tenant_id = get_user_tenant_id(current_user, db)
    
    risks = db.query(Risk).filter(Risk.status.is_distinct_from("draft"), Risk.tenant_id == tenant_id).all()
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
                "category": appetite_category(r),
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
                "net_loss": float(i.net_loss) if i.net_loss is not None else None,
                "currency": i.currency,
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


@router.get("/aggregated", response_model=List[AggregatedRiskView])
def get_aggregated_views(
    group_by: str = Query("category", description="Group by: category, status, business_unit"),
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    tenant_id = get_user_tenant_id(current_user, db)
    
    risks = db.query(Risk).filter(Risk.status.is_distinct_from("draft"), Risk.tenant_id == tenant_id).all()
    
    groups = {}
    
    for risk in risks:
        if group_by == "category":
            key = appetite_category(risk) or "uncategorized"
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
                "inherent_total": 0, "residual_total": 0, "count_with_score": 0, "count_with_residual": 0
            }
        
        groups[key]["risks"].append(risk)

        band = risk_priority_for_score(_score(risk))
        if band:
            groups[key][band] += 1

        if risk.status == "open":
            groups[key]["open"] += 1
        elif risk.status == "in_treatment":
            groups[key]["in_treatment"] += 1
        elif risk.status == "mitigated":
            groups[key]["mitigated"] += 1
        
        if risk.inherent_score is not None:
            groups[key]["inherent_total"] += risk.inherent_score
            groups[key]["count_with_score"] += 1
        if risk.residual_score is not None:
            groups[key]["residual_total"] += risk.residual_score
            groups[key]["count_with_residual"] += 1

    result = []
    for key, data in groups.items():
        count = data["count_with_score"]
        residual_count = data["count_with_residual"]
        result.append(AggregatedRiskView(
            group_by=group_by,
            group_value=key,
            total_risks=len(data["risks"]),
            critical_count=data["critical"],
            high_count=data["high"],
            medium_count=data["medium"],
            low_count=data["low"],
            avg_inherent_score=round(data["inherent_total"] / count, 2) if count else 0,
            avg_residual_score=round(data["residual_total"] / residual_count, 2) if residual_count else 0,
            open_count=data["open"],
            in_treatment_count=data["in_treatment"],
            mitigated_count=data["mitigated"]
        ))

    return sorted(result, key=lambda x: x.total_risks, reverse=True)


# ── Committee packs: draft -> ready -> frozen (approved by someone other than the preparer) ──────────────────────────
def _meeting(db: Session, tenant_id: int, meeting_id: Optional[int]) -> Optional[CommitteeMeeting]:
    if meeting_id is None:
        return None
    meeting = db.query(CommitteeMeeting).filter(CommitteeMeeting.id == meeting_id, CommitteeMeeting.tenant_id == tenant_id).first()
    if not meeting:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Meeting not found")
    return meeting


def _committee_id(db: Session, tenant_id: int, committee_id: Optional[int]) -> Optional[int]:
    if committee_id is not None and not db.query(GovernanceCommittee.id).filter(
            GovernanceCommittee.id == committee_id, GovernanceCommittee.tenant_id == tenant_id).first():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Committee not found")
    return committee_id


def _build_pack(db: Session, report: RiskReportCreate, user: GRCUser, tenant_id: int) -> RiskReport:
    """A draft pack: every section read from live data now and stored, with a draft commentary drawn from its numbers."""
    meeting = _meeting(db, tenant_id, report.meeting_id)
    sections, commentary = committee_packs.build_sections(db, tenant_id, user)
    now = datetime.utcnow()
    pack = RiskReport(
        tenant_id=tenant_id, report_type=PACK, title=report.title, description=report.description,
        report_period_start=report.report_period_start, report_period_end=report.report_period_end,
        generated_by=user.id, generated_at=now, status="draft", commentary=commentary,
        meeting_id=meeting.id if meeting else None,
        committee_id=meeting.committee_id if meeting else _committee_id(db, tenant_id, report.committee_id),
        report_data={"built_at": now.isoformat(), "summary": get_board_summary(db=db, current_user=user).executive_summary,
                     "sections": sections},
    )
    db.add(pack)
    db.commit()
    db.refresh(pack)
    return pack


def _pack(db: Session, report_id: int, user: GRCUser) -> RiskReport:
    pack = db.query(RiskReport).filter(RiskReport.id == report_id, RiskReport.report_type == PACK,
                                       RiskReport.tenant_id == get_user_tenant_id(user, db)).first()
    if not pack:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Pack not found")
    return pack


def _not_frozen(pack: RiskReport) -> None:
    if pack.status == "frozen":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="This pack is frozen, so it can no longer change.")


def _name(user: Optional[GRCUser]) -> Optional[str]:
    return (user.display_name or user.username) if user else None


def _pack_out(pack: RiskReport, user: GRCUser, editor: bool, full: bool = True) -> dict:
    out = {
        "id": pack.id, "title": pack.title, "description": pack.description, "status": pack.status,
        "committee_id": pack.committee_id, "committee_name": pack.committee.name if pack.committee else None,
        "meeting_id": pack.meeting_id, "meeting_title": pack.meeting.title if pack.meeting else None,
        "meeting_date": pack.meeting.scheduled_date.isoformat() if pack.meeting else None,
        "built_at": pack.generated_at.isoformat() if pack.generated_at else None,
        "prepared_by": pack.generated_by, "prepared_by_name": _name(pack.generator),
        "approved_by": pack.approved_by, "approved_by_name": _name(pack.approver),
        "approved_at": pack.approved_at.isoformat() if pack.approved_at else None,
        # the server's own rule, so the page offers the button only to someone who may press it
        "can_freeze": editor and pack.status == "ready" and pack.generated_by != user.id,
    }
    if full:
        out.update(summary=(pack.report_data or {}).get("summary"), sections=(pack.report_data or {}).get("sections", []),
                   commentary=pack.commentary or {})
    return out


def _editor(db: Session, user: GRCUser) -> bool:
    return has_tenant_permission(db, user, *PACK_EDIT)


@router.get("/packs")
def list_packs(db: Session = Depends(get_db), current_user: GRCUser = Depends(require_auth)):
    """Committee packs, newest first."""
    packs = db.query(RiskReport).filter(RiskReport.tenant_id == get_user_tenant_id(current_user, db),
                                        RiskReport.report_type == PACK).order_by(RiskReport.generated_at.desc()).limit(200)
    editor = _editor(db, current_user)
    return [_pack_out(p, current_user, editor, full=False) for p in packs]


@router.get("/packs/{report_id}")
def get_pack(report_id: int, db: Session = Depends(get_db), current_user: GRCUser = Depends(require_auth)):
    """The pack as it was built: its stored snapshot, never recomputed."""
    return _pack_out(_pack(db, report_id, current_user), current_user, _editor(db, current_user))


@router.put("/packs/{report_id}", dependencies=[Depends(require_tenant_permission(*PACK_EDIT))])
def update_pack(report_id: int, body: CommitteePackUpdate, db: Session = Depends(get_db),
                current_user: GRCUser = Depends(require_auth)):
    """Commentary per section (merged into what is there), the meeting and the title, while the pack is not frozen."""
    pack = _pack(db, report_id, current_user)
    _not_frozen(pack)
    if body.commentary is not None:
        unknown = set(body.commentary) - {s["key"] for s in (pack.report_data or {}).get("sections", [])}
        if unknown:
            raise HTTPException(status_code=422, detail=f"The pack has no section {', '.join(sorted(unknown))}.")
        pack.commentary = {**(pack.commentary or {}), **body.commentary}     # a new dict, so the JSON column is saved
    if "meeting_id" in body.model_fields_set:
        meeting = _meeting(db, pack.tenant_id, body.meeting_id)
        pack.meeting_id = body.meeting_id
        pack.committee_id = meeting.committee_id if meeting else pack.committee_id
    if body.title:
        pack.title = body.title
    db.commit()
    db.refresh(pack)
    return _pack_out(pack, current_user, True)


@router.post("/packs/{report_id}/ready", dependencies=[Depends(require_tenant_permission(*PACK_EDIT))])
def mark_pack_ready(report_id: int, db: Session = Depends(get_db), current_user: GRCUser = Depends(require_auth)):
    """The preparer has finished the commentary: the pack waits for approval."""
    pack = _pack(db, report_id, current_user)
    _not_frozen(pack)
    pack.status = "ready"
    db.commit()
    db.refresh(pack)
    return _pack_out(pack, current_user, True)


@router.post("/packs/{report_id}/freeze", dependencies=[Depends(require_tenant_permission(*PACK_EDIT))])
def freeze_pack(report_id: int, db: Session = Depends(get_db), current_user: GRCUser = Depends(require_auth)):
    """Approve and freeze, by someone other than the preparer; a pack set for a meeting becomes one of its papers."""
    pack = _pack(db, report_id, current_user)
    _not_frozen(pack)
    if pack.status != "ready":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Mark the pack ready before it is approved.")
    ensure_independent(pack.generated_by, current_user, "approve and freeze this pack")
    # Check-and-set in one statement: of two approvers pressing at once only one moves the row from ready (the other's
    # UPDATE waits on the row lock, then matches nothing), so the pack is frozen and filed with its meeting once.
    won = db.query(RiskReport).filter(RiskReport.id == pack.id, RiskReport.status == "ready").update(
        {RiskReport.status: "frozen", RiskReport.approved_by: current_user.id, RiskReport.approved_at: datetime.utcnow()},
        synchronize_session=False)
    if not won:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT,
                            detail="Someone else approved and froze this pack meanwhile.")
    db.refresh(pack)
    if pack.meeting_id:
        db.add(committee_packs.meeting_paper(pack, current_user))
    db.commit()
    db.refresh(pack)
    return _pack_out(pack, current_user, True)


@router.get("/packs/{report_id}/export")
def export_pack(report_id: int, fmt: str = Query(..., alias="format", pattern="^(pdf|xlsx)$"),
                db: Session = Depends(get_db), current_user: GRCUser = Depends(require_auth)):
    """A frozen pack as PDF or Excel."""
    pack = _pack(db, report_id, current_user)
    if pack.status != "frozen":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Only a frozen pack is exported: approve and freeze it first.")
    data, media = (committee_packs.pdf if fmt == "pdf" else committee_packs.xlsx)(pack, _name(pack.approver))
    return Response(content=data, media_type=media,
                    headers={"Content-Disposition": f'attachment; filename="{committee_packs.file_stem(pack)}.{fmt}"'})


# Last on purpose: declared earlier, this path takes the word "aggregated" and answers 422.
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
