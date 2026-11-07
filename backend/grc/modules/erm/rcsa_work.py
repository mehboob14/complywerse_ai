"""What an RCSA person has to do, in one read: the units they must complete (or fix after a return), the submissions waiting for their review,
the findings they own, and, for the risk team, the campaigns they run. Read only: it decides nothing and enforces nothing (the server still lets any
tenant user act on any unit; PITFALLS and the G8 audit list that), it only says what is waiting for whom so the Worklist can show true totals.

Who "has to review" a submission (G8 open decision 2, taken as the audit recommends): an administrator or a holder of ``erm:rcsa:edit`` / ``erm:rcsa:create``
(the risk team), or a person named on the campaign's approval workflow for the tier that is up (a user, or anyone holding the named role); never the unit's
own assessor.
"""
from datetime import datetime
from typing import Dict, List, Optional, Set

from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from ...models import (BusinessUnit, GRCUser, RCSAApprovalHistory, RCSAApprovalWorkflow, RCSAAssessment, RCSACampaign, RCSAFinding,
                       RCSAQuestion, RCSAResponse)
from ...routers.auth_router import has_tenant_permission, is_tenant_admin, platform_role_ids

OPEN_STATES = ("not_started", "in_progress", "requires_changes")
REVIEW_STATES = ("submitted", "under_review")
DONE_STATES = ("approved", "rejected")
KIND_RANK = {"returned": 0, "complete": 1, "review": 2, "finding": 3}
FAR = datetime(9999, 1, 1)


def is_answered(question_type: str, likelihood, impact, effectiveness, value) -> bool:
    """The rule the form uses for 'this question has an answer' (frontend lib/rcsa/answers.ts says the same)."""
    if question_type == "risk_rating":
        return bool(likelihood and impact)
    if question_type == "control_rating":
        return bool(effectiveness)
    if question_type == "yes_no":
        return value in ("yes", "no")
    return bool((value or "").strip())


def progress_of(db: Session, assessments: List[RCSAAssessment]) -> Dict[int, int]:
    """Whole percent of the REQUIRED questions answered, for the given units (one read of the questions, one of the answers)."""
    if not assessments:
        return {}
    templates = {a.campaign.template_id for a in assessments if a.campaign}
    required: Dict[int, Dict[int, str]] = {}
    for qid, tid, qtype in db.query(RCSAQuestion.id, RCSAQuestion.template_id, RCSAQuestion.question_type).filter(
            RCSAQuestion.template_id.in_(templates), RCSAQuestion.is_required == True):  # noqa: E712
        required.setdefault(tid, {})[qid] = qtype
    template_of = {a.id: a.campaign.template_id for a in assessments if a.campaign}
    answered: Dict[int, Set[int]] = {}
    for r in db.query(RCSAResponse).filter(RCSAResponse.assessment_id.in_(list(template_of))):
        qtype = required.get(template_of[r.assessment_id], {}).get(r.question_id)
        if qtype and is_answered(qtype, r.likelihood_rating, r.impact_rating, r.control_effectiveness, r.response_value):
            answered.setdefault(r.assessment_id, set()).add(r.question_id)
    out: Dict[int, int] = {}
    for a in assessments:
        wanted = required.get(a.campaign.template_id, {}) if a.campaign else {}
        done = len(answered.get(a.id, set()) & set(wanted))
        out[a.id] = int(done * 100 / len(wanted)) if wanted else 0
    return out


def _named_for_tier(workflow: Optional[RCSAApprovalWorkflow], tier: int, user_id: int, role_ids: Set[int]) -> bool:
    if not workflow:
        return False
    for t in workflow.tiers or []:
        if t.tier_order != max(tier, 1):
            continue
        if t.approver_type == "user" and t.approver_user_id == user_id:
            return True
        if t.approver_type == "role" and t.approver_role_id in role_ids:
            return True
    return False


def _in_any_workflow(workflows: List[RCSAApprovalWorkflow], user_id: int, role_ids: Set[int]) -> bool:
    return any((t.approver_type == "user" and t.approver_user_id == user_id) or (t.approver_type == "role" and t.approver_role_id in role_ids)
               for w in workflows for t in (w.tiers or []))


def _iso(value: Optional[datetime]) -> Optional[str]:
    return value.isoformat() if value else None


def my_work(db: Session, user: GRCUser, tenant_ids: List[int], limit: int = 30) -> dict:
    now = datetime.utcnow()
    today = now.date()
    admin = is_tenant_admin(db, user)
    manager = admin or has_tenant_permission(db, user, "erm:rcsa:edit", "erm:rcsa:create")
    role_ids = set(platform_role_ids(db, user))
    workflows = db.query(RCSAApprovalWorkflow).options(joinedload(RCSAApprovalWorkflow.tiers)).filter(
        RCSAApprovalWorkflow.tenant_id.in_(tenant_ids)).all()
    workflow_by_id = {w.id: w for w in workflows}
    reviewer_somewhere = manager or _in_any_workflow(workflows, user.id, role_ids)

    units = db.query(RCSAAssessment).options(
        joinedload(RCSAAssessment.campaign), joinedload(RCSAAssessment.business_unit), joinedload(RCSAAssessment.assessor),
    ).filter(RCSAAssessment.tenant_id.in_(tenant_ids)).all()

    def late(a: RCSAAssessment) -> bool:
        due = a.campaign.due_date if a.campaign else None
        return bool(due and due.date() < today and a.status not in DONE_STATES)

    mine = [a for a in units if a.assessor_id == user.id and a.campaign and a.campaign.status == "active" and a.status in OPEN_STATES]
    review = [a for a in units if a.status in REVIEW_STATES and a.campaign and a.assessor_id != user.id and (
        manager or _named_for_tier(workflow_by_id.get(a.campaign.approval_workflow_id), a.current_approval_tier or 1, user.id, role_ids))]
    owned = db.query(RCSAFinding).options(joinedload(RCSAFinding.assessment).joinedload(RCSAAssessment.campaign)).filter(
        RCSAFinding.tenant_id.in_(tenant_ids), RCSAFinding.remediation_owner_id == user.id,
        RCSAFinding.status.in_(["open", "in_progress"])).all()
    open_findings = db.query(func.count(RCSAFinding.id)).filter(
        RCSAFinding.tenant_id.in_(tenant_ids), RCSAFinding.status.in_(["open", "in_progress"])).scalar() or 0

    returned = [a for a in mine if a.status == "requires_changes"]
    to_complete = [a for a in mine if a.status != "requires_changes"]
    progress = progress_of(db, [a for a in mine if a.status == "in_progress"])
    comments: Dict[int, str] = {}
    if returned:
        for aid, text in db.query(RCSAApprovalHistory.assessment_id, RCSAApprovalHistory.comments).filter(
                RCSAApprovalHistory.assessment_id.in_([a.id for a in returned]), RCSAApprovalHistory.action == "returned"
        ).order_by(RCSAApprovalHistory.performed_at, RCSAApprovalHistory.id):
            comments[aid] = text or ""

    def tiers_of(a: RCSAAssessment) -> int:
        w = workflow_by_id.get(a.campaign.approval_workflow_id) if a.campaign else None
        return len(w.tiers) if w and w.tiers else 1

    rows: List[dict] = []
    for a in mine:
        rows.append({
            "kind": "returned" if a.status == "requires_changes" else "complete", "key": f"a-{a.id}", "assessment_id": a.id,
            "campaign_id": a.campaign_id, "campaign_name": a.campaign.name, "business_unit_name": a.business_unit.name if a.business_unit else None,
            "status": a.status, "due_date": _iso(a.campaign.due_date), "overdue": late(a), "progress": progress.get(a.id, 0 if a.status == "not_started" else None),
            "assessor_name": a.assessor.display_name if a.assessor else None, "submitted_at": _iso(a.submitted_at),
            "tier": a.current_approval_tier or 0, "total_tiers": tiers_of(a), "return_comment": comments.get(a.id), "sort_due": a.campaign.due_date,
        })
    for a in review:
        rows.append({
            "kind": "review", "key": f"a-{a.id}", "assessment_id": a.id, "campaign_id": a.campaign_id, "campaign_name": a.campaign.name,
            "business_unit_name": a.business_unit.name if a.business_unit else None, "status": a.status, "due_date": _iso(a.campaign.due_date),
            "overdue": late(a), "progress": 100, "assessor_name": a.assessor.display_name if a.assessor else None, "submitted_at": _iso(a.submitted_at),
            "tier": a.current_approval_tier or 1, "total_tiers": tiers_of(a), "return_comment": None, "sort_due": a.submitted_at or a.campaign.due_date,
        })
    for f in owned:
        c = f.assessment.campaign if f.assessment else None
        rows.append({
            "kind": "finding", "key": f"f-{f.id}", "finding_id": f.id, "assessment_id": f.assessment_id, "campaign_id": c.id if c else None,
            "campaign_name": c.name if c else None, "title": f.title, "severity": f.severity, "status": f.status,
            "due_date": _iso(f.remediation_due_date), "overdue": bool(f.remediation_due_date and f.remediation_due_date.date() < today),
            "sort_due": f.remediation_due_date,
        })
    rows.sort(key=lambda r: (not r["overdue"], KIND_RANK[r["kind"]], r["sort_due"] or FAR, r["key"]))
    for r in rows:
        r.pop("sort_due", None)

    campaigns: List[dict] = []
    campaigns_total = 0
    if manager:
        running = db.query(RCSACampaign).filter(RCSACampaign.tenant_id.in_(tenant_ids), RCSACampaign.status.in_(["draft", "active"])).order_by(
            RCSACampaign.due_date, RCSACampaign.id).all()
        campaigns_total = len(running)
        by_campaign: Dict[int, List[RCSAAssessment]] = {}
        for a in units:
            by_campaign.setdefault(a.campaign_id, []).append(a)
        for c in running[:8]:
            group = by_campaign.get(c.id, [])
            campaigns.append({
                "id": c.id, "name": c.name, "status": c.status, "period": c.period_label or c.period_type, "due_date": _iso(c.due_date),
                "units": len(group), "approved": sum(1 for a in group if a.status == "approved"),
                "waiting_review": sum(1 for a in group if a.status in REVIEW_STATES),
                "late": sum(1 for a in group if late(a)),
            })

    counts = {
        "to_complete": len(to_complete), "returned": len(returned), "to_review": len(review), "findings_owned": len(owned),
        "overdue": sum(1 for r in rows if r["overdue"] and r["kind"] in ("complete", "returned")),
        "open_findings": int(open_findings), "late_units": sum(1 for a in units if late(a) and a.campaign and a.campaign.status == "active") if manager else 0,
    }
    counts["actions"] = counts["to_complete"] + counts["returned"] + counts["to_review"] + counts["findings_owned"]
    return {
        "counts": counts,
        "rows": rows[:limit],
        "total": len(rows),
        "campaigns": campaigns,
        "campaigns_total": campaigns_total,
        "roles": {"manage": manager, "review": reviewer_somewhere, "assess": any(a.assessor_id == user.id for a in units)},
    }
