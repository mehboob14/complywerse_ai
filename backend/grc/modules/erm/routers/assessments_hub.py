"""One list of every assessment (ERM redesign, decision 1): risk workshops, RCSA self-assessments and framework IT risk
assessments, each status in one vocabulary, the caller's own first. Read only: a row opens the page its kind already has."""
from typing import Optional

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session, joinedload

from ....models import FrameworkRiskAssessment, FrameworkRiskQuestion, GRCUser, RCSAAssessment, RiskAssessment, get_db
from ....routers.auth_router import get_user_tenants, has_tenant_permission, require_auth

router = APIRouter(prefix="/assessments", tags=["ERM - Assessments"])

STATUSES = ("Planned", "In progress", "Returned", "Under review", "Approved", "Closed")
_WORKSHOP = {"draft": "Planned", "in_progress": "In progress", "under_review": "Under review", "approved": "Approved",
             "closed": "Closed"}
_RCSA = {"not_started": "Planned", "in_progress": "In progress", "submitted": "Under review", "under_review": "Under review",
         "requires_changes": "Returned", "rejected": "Returned", "approved": "Approved"}
_FRAMEWORK = {"in_progress": "In progress", "completed": "Under review", "approved": "Approved", "archived": "Closed"}
# any RCSA right shows the whole tenant's self-assessments; without one, only those assigned to you (the assessor answers
# with view access alone, rcsa._can_self_assess)
_RCSA_RIGHTS = ("erm:rcsa:view", "erm:rcsa:create", "erm:rcsa:edit", "erm:rcsa:delete")


def workshop_status(a: RiskAssessment) -> str:
    if a.status == "in_progress" and a.submitted_by:      # it was sent for review once, so it came back
        return "Returned"
    return _WORKSHOP.get(a.status, "In progress")


def rcsa_status(a: RCSAAssessment) -> str:
    if a.campaign and a.campaign.status in ("closed", "cancelled"):
        return "Closed"
    return _RCSA.get(a.status, "In progress")


def _name(user: Optional[GRCUser]) -> Optional[str]:
    return (user.display_name or user.username) if user else None


def _row(kind: str, id_: int, title: str, unit, status: str, raw: str, due, lead: Optional[GRCUser], mine: bool, url: str):
    return {"kind": kind, "id": id_, "title": title, "unit": unit.name if unit else None, "status": status,
            "raw_status": raw, "due_date": due.isoformat() if due else None, "lead": _name(lead),
            "lead_id": lead.id if lead else None, "mine": mine, "url": url}


@router.get("")
def list_assessments(db: Session = Depends(get_db), current_user: GRCUser = Depends(require_auth)):
    tenants = get_user_tenants(current_user, db)
    if not tenants:
        return []
    me = current_user.id
    # shortcut: no paging; a tenant runs tens of assessments a cycle. Page it if a tenant reaches thousands.
    rows = [_row("risk_workshop", a.id, a.name, a.business_unit, workshop_status(a), a.status, a.assessment_period_end,
                 a.lead_assessor, a.lead_assessor_id == me, f"/erm/risk-assessments/{a.id}")
            for a in db.query(RiskAssessment).options(joinedload(RiskAssessment.business_unit),
                                                      joinedload(RiskAssessment.lead_assessor))
            .filter(RiskAssessment.tenant_id.in_(tenants))]

    rcsa = db.query(RCSAAssessment).options(joinedload(RCSAAssessment.business_unit), joinedload(RCSAAssessment.assessor),
                                            joinedload(RCSAAssessment.campaign)).filter(RCSAAssessment.tenant_id.in_(tenants))
    if not has_tenant_permission(db, current_user, *_RCSA_RIGHTS):
        rcsa = rcsa.filter(RCSAAssessment.assessor_id == me)
    rows += [_row("self_assessment", a.id, a.campaign.name if a.campaign else f"RCSA #{a.id}", a.business_unit,
                  rcsa_status(a), a.status, a.campaign.due_date if a.campaign else None, a.assessor, a.assessor_id == me,
                  f"/erm/rcsa/assessments/{a.id}") for a in rcsa]

    answering = {aid for (aid,) in db.query(FrameworkRiskQuestion.assessment_id)
                 .filter(FrameworkRiskQuestion.assigned_user_id == me).distinct()}
    rows += [_row("framework_it_risk", a.id, a.name, None, _FRAMEWORK.get(a.status, "In progress"), a.status, None,
                  a.creator, a.created_by == me or a.id in answering, f"/erm/risk-assessments/framework/{a.id}")
             for a in db.query(FrameworkRiskAssessment).options(joinedload(FrameworkRiskAssessment.creator))
             .filter(FrameworkRiskAssessment.tenant_id.in_(tenants))]

    rows.sort(key=lambda r: (not r["mine"], r["unit"] is None, r["unit"] or "", STATUSES.index(r["status"]),
                             r["due_date"] or "9999"))
    return rows
