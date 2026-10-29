"""Who reviews which part of a supplier's answers, and when they are done.

A questionnaire's questions fall into sections: a question's own section, else its
category, else its risk domain, else General. One or more people are assigned a
section, or the whole questionnaire, and each is told in the app and by email. An
assignment is assigned, in review once its reviewer opens it, then done; done
takes a decision (accepted, or a clarification asked) on every question of the
section that applies to the answers given. One marked done before a decision was
cleared, or before the supplier answered a clarification, is in review again.
Accepting the questionnaire waits until every assignment is done
(routers/questionnaires.py), and planning counts the people assigned among the
assessment's reviewers (service.reviewers_assigned).

Anyone who may review assigns and unassigns; only the reviewer, the assessment's
TPRM lead or an administrator moves an assignment along.

Comments on answers are messages on the questionnaire's thread, one per question
(tpra/supplier_requests.py): ours are internal unless shared, and a shared one
reaches the supplier on that question in the portal (tpra/supplier_portal.py) and
by email. A supplier's reply there is told to the question's reviewers.
"""
from __future__ import annotations

import logging
import re
from datetime import datetime
from typing import List, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ....models import GRCUser, TPRAReviewAssignment, Vendor, VendorAssessment, VendorQuestionnaireResponse, get_db
from ....routers.auth_router import get_user_tenants, refuse_imported_accounts, require_auth
from ..routers import questionnaires as routes
from . import contacts, portal, rbac, service, versions
from .emails import render

logger = logging.getLogger(__name__)

router = APIRouter(tags=["Questionnaire reviews"])

A = TPRAReviewAssignment
DECIDED = ("accepted", "clarify")
WHOLE = "Whole questionnaire"


def section_of(q: dict) -> str:
    """A question's section, as a key: lower case, words apart."""
    raw = q.get("section") or q.get("category") or q.get("domain") or "general"
    return " ".join(re.split(r"[\s_]+", str(raw).strip().lower()))[:100] or "general"


def label(key: Optional[str]) -> str:
    return WHOLE if key is None else key[:1].upper() + key[1:]


def _words(key: Optional[str]) -> str:
    """'the whole questionnaire', or 'the Cybersecurity section'."""
    return "the whole questionnaire" if key is None else f"the {label(key)} section"


def sections(questions: List[dict], qr: VendorQuestionnaireResponse) -> List[dict]:
    """Each section of the questions that apply, in question order, with the
    questions in it still waiting for a decision."""
    review, out = qr.review or {}, {}
    for q in portal.visible_questions(questions, qr.responses or {}):
        key, s = str(q.get("id")), section_of(q)
        row = out.setdefault(s, {"key": s, "label": label(s), "questions": [], "undecided": []})
        row["questions"].append(key)
        if (review.get(key) or {}).get("status") not in DECIDED:
            row["undecided"].append(key)
    return list(out.values())


def _undecided(secs: List[dict], section_key: Optional[str]) -> List[str]:
    return [k for s in secs if section_key is None or s["key"] == section_key for k in s["undecided"]]


def state(a: TPRAReviewAssignment, undecided: List[str]) -> str:
    """Done holds only while every question of the section has a decision."""
    return "in_review" if a.status == "done" and undecided else a.status


def _assignments(db: Session, qr: VendorQuestionnaireResponse) -> List[TPRAReviewAssignment]:
    """The whole questionnaire's first, then by section, reviewer and id."""
    return (db.query(A).filter(A.questionnaire_response_id == qr.id)
            .order_by(A.section_key.isnot(None), A.section_key, A.reviewer_id, A.id).all())


def unfinished(db: Session, qr: VendorQuestionnaireResponse) -> Optional[str]:
    """Who is not done yet, and with what, e.g. "Ana Lyst (Cybersecurity)"; None
    when every assignment is done (or there is none)."""
    rows = _assignments(db, qr)
    if not rows:
        return None
    secs = sections(versions.questions_for(db, qr), qr)
    waiting = [a for a in rows if state(a, _undecided(secs, a.section_key)) != "done"]
    names = contacts._names(db, [a.reviewer_id for a in waiting])
    return ", ".join(f"{names.get(a.reviewer_id) or 'Someone'} ({label(a.section_key)})" for a in waiting) or None


def _leads(db: Session, user: GRCUser, qr: VendorQuestionnaireResponse) -> bool:
    """The assessment's TPRM lead (Assign duties) or an administrator."""
    assessment = db.get(VendorAssessment, qr.assessment_id) if qr.assessment_id else None
    lead = (assessment.team_roster or {}).get("tprm_lead") if assessment is not None else None
    return (lead is not None and lead == user.id) or rbac._is_admin_or_primary(db, user)


def _iso(value) -> Optional[str]:
    return value.isoformat() if value else None


def _rows(db: Session, rows: List[TPRAReviewAssignment], secs: List[dict], user: GRCUser, lead: bool) -> List[dict]:
    names = contacts._names(db, [x for a in rows for x in (a.reviewer_id, a.assigned_by)])
    out = []
    for a in rows:
        undecided = _undecided(secs, a.section_key)
        out.append({
            "id": a.id, "section_key": a.section_key, "section_label": label(a.section_key),
            "reviewer": {"id": a.reviewer_id, "name": names.get(a.reviewer_id)}, "status": state(a, undecided),
            "undecided": len(undecided), "note": a.note, "assigned_by": names.get(a.assigned_by),
            "assigned_at": _iso(a.assigned_at), "started_at": _iso(a.started_at), "done_at": _iso(a.done_at),
            "mine": a.reviewer_id == user.id, "can_act": a.reviewer_id == user.id or lead,
        })
    return out


def summary(db: Session, qr: VendorQuestionnaireResponse, user: GRCUser) -> dict:
    secs = sections(versions.questions_for(db, qr), qr)
    lead = _leads(db, user, qr)
    return {"sections": [{**s, "undecided": len(s["undecided"])} for s in secs],
            "assignments": _rows(db, _assignments(db, qr), secs, user, lead), "lead": lead}


def _link(qr: VendorQuestionnaireResponse) -> str:
    return (f"/vendor-risk/assessments/{qr.assessment_id}?tab=questionnaire" if qr.assessment_id
            else f"/vendor-risk/vendors/{qr.vendor_id}")


def _notify(db: Session, qr: VendorQuestionnaireResponse, user_ids: List[int], key: str, values: dict) -> None:
    """In the app and by email, once the caller's write is committed. Never fails it."""
    from ...workflow_engine.services.notification_service import send_workflow_notification

    people = [p for p in dict.fromkeys(user_ids) if p]
    if not people:
        return
    try:
        subject, message, _ = render(db, qr.tenant_id, key, {**values, "link": _link(qr)})
        send_workflow_notification(db, tenant_id=qr.tenant_id, subject=subject[:500], message=message,
                                   workflow_instance_id=None, user_ids=people, channels=["in_app", "email"],
                                   notification_type="assignment" if key == "review_assigned" else "info",
                                   link=_link(qr))
        db.commit()
    except Exception:  # noqa: BLE001 — the write it follows is saved either way
        logger.warning("questionnaire review notice for response %s not sent", qr.id, exc_info=True)
        db.rollback()


def tell_reviewers(db: Session, qr: VendorQuestionnaireResponse, question_key: str, title: str) -> None:
    """A supplier wrote on a question: its section's reviewers and the whole
    questionnaire's hear of it, or the supplier's owner when there are none."""
    questions = {str(q.get("id")): q for q in versions.questions_for(db, qr)}
    section = section_of(questions.get(question_key) or {})
    people = [a.reviewer_id for a in _assignments(db, qr) if a.section_key in (None, section)]
    vendor = db.get(Vendor, qr.vendor_id)
    _notify(db, qr, people or [vendor.owner_id if vendor else None], "supplier_responded",
            {"title": title, "vendor": vendor.name if vendor else ""})


# ── REST (signed in) ─────────────────────────────────────────────────────────

def _one(db: Session, qr: VendorQuestionnaireResponse, assignment_id: int) -> TPRAReviewAssignment:
    a = db.query(A).filter(A.id == assignment_id, A.questionnaire_response_id == qr.id).first()
    if a is None:
        raise HTTPException(404, "That assignment is not on this questionnaire")
    return a


def _audit(db: Session, qr: VendorQuestionnaireResponse, a: TPRAReviewAssignment, user: GRCUser, action: str,
           from_value=None, to_value=None) -> None:
    service.write_audit(db, qr.tenant_id, entity="review_assignment", action=action, vendor_id=qr.vendor_id,
                        assessment_id=qr.assessment_id, entity_id=a.id, actor_id=user.id, from_value=from_value,
                        to_value=to_value, extra={"questionnaire_id": qr.id, "section": a.section_key,
                                                  "reviewer_id": a.reviewer_id})


@router.get("/questionnaire-responses/{response_id}/reviewers")
def list_reviewers(response_id: int, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    """The sections, who has each and where they stand."""
    return summary(db, routes._response_or_404(db, user, response_id), user)


class AssignIn(BaseModel):
    reviewer_id: int
    section_key: Optional[str] = Field(None, max_length=100)          # none: the whole questionnaire
    note: Optional[str] = Field(None, max_length=2000)


@router.post("/questionnaire-responses/{response_id}/reviewers", status_code=201)
def assign(response_id: int, body: AssignIn, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    qr = routes._response_or_404(db, user, response_id)
    rbac.require_write(db, user, "assessments", "edit")
    if qr.status == "accepted":
        raise HTTPException(409, "This questionnaire is accepted: there is nothing left to review")
    questions = versions.questions_for(db, qr)
    if body.section_key is not None and body.section_key not in {section_of(q) for q in questions}:
        raise HTTPException(404, "That section is not in this questionnaire")
    reviewer = db.query(GRCUser).filter(GRCUser.id == body.reviewer_id, GRCUser.is_active.is_(True)).first()
    if reviewer is None:
        raise HTTPException(400, "There is no active user with that id")
    refuse_imported_accounts(db, [reviewer.id])
    if db.query(A.id).filter(A.questionnaire_response_id == qr.id, A.reviewer_id == reviewer.id,
                             A.section_key.is_(None) if body.section_key is None
                             else A.section_key == body.section_key).first():
        raise HTTPException(409, f"{contacts._names(db, [reviewer.id]).get(reviewer.id)} already reviews "
                                 f"{_words(body.section_key)}")
    a = A(tenant_id=qr.tenant_id, vendor_id=qr.vendor_id, assessment_id=qr.assessment_id,
          questionnaire_response_id=qr.id, section_key=body.section_key, reviewer_id=reviewer.id,
          status="assigned", note=" ".join((body.note or "").split()) or None, assigned_by=user.id)
    db.add(a)
    db.flush()
    _audit(db, qr, a, user, "assign", to_value=reviewer.id)
    db.commit()
    if reviewer.id != user.id:
        vendor, version = db.get(Vendor, qr.vendor_id), versions.pin(db, qr)
        _notify(db, qr, [reviewer.id], "review_assigned", {
            "section": _words(a.section_key),
            "questionnaire": version.name if version else "Questionnaire", "vendor": vendor.name if vendor else "",
            "assigned_by": contacts._names(db, [user.id]).get(user.id) or "A colleague"})
    secs = sections(questions, qr)
    return _rows(db, [a], secs, user, _leads(db, user, qr))[0]


class StatusIn(BaseModel):
    status: Literal["in_review", "done"]


@router.put("/questionnaire-responses/{response_id}/reviewers/{assignment_id}")
def set_status(response_id: int, assignment_id: int, body: StatusIn, db: Session = Depends(get_db),
               user: GRCUser = Depends(require_auth)):
    """In review (opened, or opened again), or done: every question of the section
    that applies has a decision."""
    qr = routes._response_or_404(db, user, response_id)
    a = _one(db, qr, assignment_id)
    rbac.require_write(db, user, "assessments", "edit")
    lead = _leads(db, user, qr)
    if a.reviewer_id != user.id and not lead:
        raise HTTPException(403, "Only the reviewer, the assessment's TPRM lead or an administrator can change this")
    secs = sections(versions.questions_for(db, qr), qr)
    undecided = _undecided(secs, a.section_key)
    if body.status == "done" and undecided:
        n = len(undecided)
        raise HTTPException(409, f"{n} question{'s' if n != 1 else ''} in {_words(a.section_key)} "
                                 f"still need{'' if n != 1 else 's'} a decision")
    before, now = a.status, datetime.utcnow()
    if before != body.status:
        a.status, a.started_at = body.status, a.started_at or now
        a.done_at = now if body.status == "done" else None
        _audit(db, qr, a, user, "status", from_value=before, to_value=body.status)
        db.commit()
    return _rows(db, [a], secs, user, lead)[0]


@router.delete("/questionnaire-responses/{response_id}/reviewers/{assignment_id}")
def unassign(response_id: int, assignment_id: int, db: Session = Depends(get_db),
             user: GRCUser = Depends(require_auth)):
    qr = routes._response_or_404(db, user, response_id)
    a = _one(db, qr, assignment_id)
    rbac.require_write(db, user, "assessments", "edit")
    _audit(db, qr, a, user, "unassign", from_value=a.reviewer_id)
    db.delete(a)
    db.commit()
    return {"deleted": True, "id": assignment_id}


@router.get("/assessments/{assessment_id}/reviewers")
def planning_reviewers(assessment_id: int, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    """How many different reviewers planning counts, of how many the tier needs:
    the stage gate's own facts (service.build_stage_context)."""
    a = db.query(VendorAssessment).filter(VendorAssessment.id == assessment_id,
                                          VendorAssessment.tenant_id.in_(get_user_tenants(user, db) or [-1])).first()
    vendor = db.get(Vendor, a.vendor_id) if a is not None else None
    if vendor is None:
        raise HTTPException(404, "Assessment not found")
    ctx = service.build_stage_context(db, vendor, a, "dd_planning")
    return {"assigned": ctx["reviewers_assigned"], "required": ctx["required_reviewers"],
            "roles": ctx["reviewer_roles"]}
