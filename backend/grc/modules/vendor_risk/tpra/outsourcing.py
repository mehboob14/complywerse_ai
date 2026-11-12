"""Third-party risk where it meets ERM: the outsourcing steps a bank supervisor expects (EBA/GL/2019/02, the SBP
outsourcing framework), on the eleven-stage lifecycle rather than beside it.

- Materiality: the second line says whether a scope (the supplier, or one engagement) supports a critical or important
  function, with a reason. The tiering gate waits for that answer (engine_gates).
- A critical or important one is held to more. Contracting and approval ask for the contract's audit and access rights,
  exit and data return, and where the data is held. Approval also asks for an exit plan in place, every sub-outsourcer
  approved, and the decision taken by a committee at a meeting, not by one approver. Onboarding (the way to Active)
  waits for the regulator's notice where one is required. Whoever classified it cannot approve it (ensure_independent).
- A vendor incident can be recorded once as a Basel loss event (grc_risk_incidents), linked from the incident.
- Concentration: how many critical or important vendors rely on one fourth party, against the limit on the third-party
  risk appetite. Over it is a breach in the appetite log (erm/routers/appetite.check_appetite reads `worst_concentration`).
"""
from __future__ import annotations

from datetime import date, datetime
from typing import List, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import or_
from sqlalchemy.orm import Session

from ....models import (CommitteeMeeting, GRCUser, RiskAppetiteConfig, RiskIncident, TPRAContract, TPRAEngagement,
                        TPRAFourthParty, Vendor, VendorAssessment, VendorIncident, get_db)
from ....routers.auth_router import get_user_tenants, has_tenant_permission, require_auth
from ....schemas import RiskIncidentLossFields
from ....services.segregation import ensure_independent
from . import rbac
from .service import engagement_of, write_audit

router = APIRouter(prefix="/tpra", tags=["Outsourcing"])

EXIT_STATUSES = ("draft", "approved", "tested")
IN_PLACE = ("approved", "tested")                 # an exit plan that counts at the Approval gate
MIN_REASON = 10
CATEGORY = "third_party"                          # the appetite category that holds the concentration limit
LOSS_EVENT_TYPE = "execution_delivery"            # Basel level 1 for vendor and supplier failures
POSITIVE = ("approve", "approve_with_conditions")


# ── the facts on a scope ─────────────────────────────────────────────────────

def describe(scope) -> dict:
    o = scope.outsourcing or {}
    return {"critical_important": scope.critical_important, "materiality": o.get("materiality"),
            "exit_plan": o.get("exit_plan"), "regulator": o.get("regulator")}


def _put(scope, key: str, value: dict) -> None:
    scope.outsourcing = {**(scope.outsourcing or {}), key: value}     # a new dict, so the JSON column is seen as changed


def scope_of(db: Session, assessment: VendorAssessment):
    """Where an assessment's outsourcing facts live: its engagement, or the supplier itself (General)."""
    return engagement_of(db, assessment) or db.get(Vendor, assessment.vendor_id)


def classified_by(db: Session, assessment: VendorAssessment) -> Optional[int]:
    scope = scope_of(db, assessment)
    return (((scope.outsourcing if scope is not None else None) or {}).get("materiality") or {}).get("by")


def is_critical_important(db: Session, vendor: Vendor) -> bool:
    """The supplier, or one of its engagements still in use, supports a critical or important function."""
    return bool(vendor.critical_important) or db.query(TPRAEngagement.id).filter(
        TPRAEngagement.vendor_id == vendor.id, TPRAEngagement.critical_important.is_(True),
        TPRAEngagement.status != "ended").first() is not None


def critical_vendor_ids(db: Session, tenant_ids: List[int]) -> set:
    ids = {i for (i,) in db.query(Vendor.id).filter(Vendor.tenant_id.in_(tenant_ids), Vendor.critical_important.is_(True))}
    return ids | {i for (i,) in db.query(TPRAEngagement.vendor_id).filter(
        TPRAEngagement.tenant_id.in_(tenant_ids), TPRAEngagement.critical_important.is_(True),
        TPRAEngagement.status != "ended")}


def classified_vendor_ids(db: Session, tenant_ids: List[int]) -> set:
    """Vendors whose materiality anyone has decided, on the supplier or an engagement."""
    ids = {i for (i,) in db.query(Vendor.id).filter(Vendor.tenant_id.in_(tenant_ids), Vendor.critical_important.isnot(None))}
    return ids | {i for (i,) in db.query(TPRAEngagement.vendor_id).filter(
        TPRAEngagement.tenant_id.in_(tenant_ids), TPRAEngagement.critical_important.isnot(None),
        TPRAEngagement.status != "ended")}


# ── what the gates read (service.build_stage_context) ────────────────────────

def clauses_missing(db: Session, vendor: Vendor, engagement: Optional[TPRAEngagement]) -> List[str]:
    """The clauses no contract covering the scope has yet; where the data is held is the supplier's own record."""
    covers = TPRAContract.engagement_id.is_(None)
    if engagement is not None:
        covers = or_(covers, TPRAContract.engagement_id == engagement.id)
    rows = db.query(TPRAContract).filter(TPRAContract.vendor_id == vendor.id, TPRAContract.deleted_at.is_(None), covers).all()
    have = {"audit and access rights": any(c.right_to_audit for c in rows),
            "exit and data return": any(c.exit_data_return for c in rows),
            "where the data is held": bool((vendor.data_location or "").strip())}
    return [name for name, ok in have.items() if not ok]


def sub_outsourcers_waiting(db: Session, vendor: Vendor) -> List[str]:
    return [n for (n,) in db.query(TPRAFourthParty.name).filter(
        TPRAFourthParty.vendor_id == vendor.id, TPRAFourthParty.tenant_id == vendor.tenant_id,
        TPRAFourthParty.deleted_at.is_(None), TPRAFourthParty.approval_status.in_(("pending", "rejected")))
        .order_by(TPRAFourthParty.name)]


def exit_plan_ready(scope) -> bool:
    plan = (scope.outsourcing or {}).get("exit_plan") or {}
    return plan.get("status") in IN_PLACE and bool(plan.get("summary") or plan.get("link"))


def gate_facts(db: Session, vendor: Vendor, engagement: Optional[TPRAEngagement], stage_key: str) -> dict:
    """The outsourcing facts one stage's gate reads. Nothing past tiering unless the scope is critical or important."""
    scope = engagement or vendor
    if stage_key == "tiering":
        return {"critical_important": scope.critical_important}
    if scope.critical_important is not True or stage_key not in ("contracting", "approval", "onboarding"):
        return {}
    facts: dict = {"critical_important": True}
    if stage_key in ("contracting", "approval"):
        facts["clauses_missing"] = clauses_missing(db, vendor, engagement)
    if stage_key == "approval":
        facts["exit_plan_ready"] = exit_plan_ready(scope)
        facts["sub_outsourcers_waiting"] = sub_outsourcers_waiting(db, vendor)
    if stage_key == "onboarding":
        notice = (scope.outsourcing or {}).get("regulator") or {}
        facts["regulator_required"] = notice.get("required")
        facts["regulator_notified"] = bool(notice.get("sent_on"))
    return facts


# ── the decision at the gate (api.create_approval) ───────────────────────────

def decision_meeting(db: Session, user: GRCUser, assessment: VendorAssessment, decision: str,
                     meeting_id: Optional[int]) -> Optional[CommitteeMeeting]:
    """The meeting a decision was taken at, checked. A critical or important outsourcing is approved by a committee
    (a meeting is required), and never by whoever classified it (409)."""
    meeting = None
    if meeting_id is not None:
        meeting = db.query(CommitteeMeeting).filter(CommitteeMeeting.id == meeting_id,
                                                    CommitteeMeeting.tenant_id == assessment.tenant_id).first()
        if meeting is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Meeting not found")
        if meeting.status == "cancelled":
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "That meeting was cancelled")
    if decision in POSITIVE:
        ensure_independent(classified_by(db, assessment), user, "approve an outsourcing you classified")
        scope = scope_of(db, assessment)
        if meeting is None and scope is not None and scope.critical_important is True:
            raise HTTPException(status.HTTP_400_BAD_REQUEST,
                                "A critical or important outsourcing is approved by a committee: name the meeting that decided it.")
    return meeting


# ── concentration against appetite ───────────────────────────────────────────

def concentration_limit(db: Session, tenant_id: int) -> Optional[int]:
    row = db.query(RiskAppetiteConfig.concentration_limit).filter(
        RiskAppetiteConfig.tenant_id == tenant_id, RiskAppetiteConfig.category == CATEGORY).first()
    return row[0] if row else None


def concentration_rows(db: Session, tenant_id: int) -> List[dict]:
    """Each provider with the critical or important vendors relying on it, most first: through it as a fourth party (or
    seen on their estate), and the critical or important vendor that is the provider itself, bought from directly."""
    from .graph import _INACTIVE, concentration, platform_for, tenant_aliases
    critical = critical_vendor_ids(db, [tenant_id])
    if not critical:
        return []
    groups = {g["platform"].lower(): {"platform": g["platform"], "vendors": [v["name"] for v in g["vendors"] if v["id"] in critical]}
              for g in concentration(db, tenant_id, 1)}
    relied_on = set(groups)
    aliases = tenant_aliases(db, tenant_id)
    for v in db.query(Vendor).filter(Vendor.tenant_id == tenant_id, Vendor.id.in_(critical), Vendor.deleted_at.is_(None)):
        platform = platform_for(v.name, aliases) if (v.status or "").lower() not in _INACTIVE else ""
        if platform:
            group = groups.setdefault(platform.lower(), {"platform": platform, "vendors": []})
            if v.name not in group["vendors"]:
                group["vendors"].append(v.name)
    rows = [{"platform": g["platform"], "count": len(g["vendors"]), "vendors": sorted(g["vendors"], key=str.lower)}
            for key, g in groups.items()
            if g["vendors"] and (key in relied_on or len(g["vendors"]) > 1)]     # a supplier on its own is no concentration
    return sorted(rows, key=lambda r: (-r["count"], r["platform"].lower()))


def worst_concentration(db: Session, tenant_id: int) -> Optional[dict]:
    rows = concentration_rows(db, tenant_id)
    return rows[0] if rows else None


def recheck_appetite(db: Session, tenant_id: int) -> None:
    """Bring the third-party breach log in line after a change concentration reads."""
    from ...erm.routers.appetite import check_appetite
    check_appetite(db, [tenant_id], [CATEGORY])


# ── endpoints ────────────────────────────────────────────────────────────────

def _tids(user: GRCUser, db: Session) -> List[int]:
    tids = get_user_tenants(user, db)
    if not tids:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "No tenant context")
    return tids


def _vendor(db: Session, vendor_id: int, tids: List[int]) -> Vendor:
    v = db.query(Vendor).filter(Vendor.id == vendor_id, Vendor.tenant_id.in_(tids), Vendor.deleted_at.is_(None)).first()
    if v is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Vendor not found")
    return v


def _scope(db: Session, vendor: Vendor, engagement_id: Optional[int]):
    """The engagement a call names, or the supplier (nothing named, or General's own row)."""
    if not engagement_id:
        return vendor
    e = db.query(TPRAEngagement).filter(TPRAEngagement.id == engagement_id, TPRAEngagement.vendor_id == vendor.id).first()
    if e is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Engagement not found")
    return vendor if e.is_general else e


def _clean(text: Optional[str], limit: int) -> Optional[str]:
    return " ".join((text or "").split())[:limit] or None


def _stamp(user: GRCUser) -> dict:
    return {"by": user.id, "at": datetime.utcnow().isoformat()}


def _view(db: Session, vendor: Vendor, scope) -> dict:
    fps = (db.query(TPRAFourthParty).filter(TPRAFourthParty.vendor_id == vendor.id, TPRAFourthParty.tenant_id == vendor.tenant_id,
                                            TPRAFourthParty.deleted_at.is_(None)).order_by(TPRAFourthParty.name).all())
    return {**describe(scope), "vendor_id": vendor.id,
            "engagement_id": scope.id if isinstance(scope, TPRAEngagement) else None,
            "sub_outsourcers": [{"id": f.id, "name": f.name, "service": f.service, "location": f.location,
                                 "approval_status": f.approval_status, "approval": f.approval, "created_by": f.created_by}
                                for f in fps]}


@router.get("/vendors/{vendor_id}/outsourcing")
def get_outsourcing(vendor_id: int, engagement_id: Optional[int] = None, db: Session = Depends(get_db),
                    user: GRCUser = Depends(require_auth)):
    v = _vendor(db, vendor_id, _tids(user, db))
    return _view(db, v, _scope(db, v, engagement_id))


class MaterialityIn(BaseModel):
    critical_important: bool
    reason: str = Field(..., max_length=2000)


@router.put("/vendors/{vendor_id}/materiality")
def set_materiality(vendor_id: int, body: MaterialityIn, engagement_id: Optional[int] = None,
                    db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    """The second line's call: does this scope support a critical or important function, and why."""
    v = _vendor(db, vendor_id, _tids(user, db))
    rbac.require_write(db, user, "assessments", "edit")
    scope = _scope(db, v, engagement_id)
    reason = _clean(body.reason, 2000)
    if len(reason or "") < MIN_REASON:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Say why, in a sentence")
    before = scope.critical_important
    scope.critical_important = body.critical_important
    _put(scope, "materiality", {"reason": reason, **_stamp(user)})
    if body.critical_important:
        # Sub-outsourcing of a critical or important service is approved one by one, the ones already listed too.
        db.query(TPRAFourthParty).filter(TPRAFourthParty.vendor_id == v.id, TPRAFourthParty.deleted_at.is_(None),
                                         TPRAFourthParty.approval_status.is_(None)).update(
            {TPRAFourthParty.approval_status: "pending"}, synchronize_session=False)
    write_audit(db, v.tenant_id, entity="materiality", action="update", vendor_id=v.id,
                entity_id=scope.id if isinstance(scope, TPRAEngagement) else None, actor_id=user.id,
                from_value=before, to_value=body.critical_important, reason=reason)
    reopened = None
    if before is not None and before != body.critical_important:     # a first answer is not a change of classification
        reopened = reopen_approval(db, v, scope, user, reason)
    recheck_appetite(db, v.tenant_id)
    db.commit()
    return {**_view(db, v, scope), "approval_reopened": reopened}


def reopen_approval(db: Session, vendor: Vendor, scope, user: GRCUser, reason: str) -> Optional[dict]:
    """The scope's approval was given on the other materiality: its active review goes back to the Approval stage (the
    decision before stops counting, the stages after it start again) and everyone who may approve it is told."""
    from ...workflow_engine.services.notification_service import send_workflow_notification
    from .service import approvers, get_active_assessment, send_back
    from .stages import STAGE_ORDER
    engagement = scope if isinstance(scope, TPRAEngagement) else None
    a = get_active_assessment(db, vendor, engagement)
    if a is None or STAGE_ORDER.get(a.current_stage or "intake", 1) <= STAGE_ORDER["approval"]:
        return None                     # not approved yet: the Approval gate reads the new answer when it is reached
    now = "critical or important" if scope.critical_important else "not critical or important"
    send_back(db, vendor, a, "approval", user.id, f"Materiality changed after approval: now {now}. {reason}")
    ids = [p["user_id"] for p in approvers(db, a) if p["eligible"] and p["user_id"] != user.id]
    if ids:
        name = vendor.name + (f" ({engagement.name})" if engagement is not None else "")
        link = f"/vendor-risk/vendors/{vendor.id}?stage=approval" + (f"&engagement={engagement.id}" if engagement else "")
        send_workflow_notification(db, tenant_id=vendor.tenant_id, subject=f"{name}: approval reopened"[:500],
                                   message=f"Its materiality changed after approval (now {now}), so it needs your decision again.",
                                   workflow_instance_id=None, user_ids=ids, notification_type="assignment", link=link)
    return {"assessment_id": a.id, "stage": "approval"}


class ExitPlanIn(BaseModel):
    status: Literal["draft", "approved", "tested"]
    summary: Optional[str] = Field(None, max_length=4000)
    link: Optional[str] = Field(None, max_length=500, pattern=r"^https?://\S+$")


@router.put("/vendors/{vendor_id}/exit-plan")
def set_exit_plan(vendor_id: int, body: ExitPlanIn, engagement_id: Optional[int] = None,
                  db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    v = _vendor(db, vendor_id, _tids(user, db))
    rbac.require_write(db, user, "contracts", "edit")
    scope = _scope(db, v, engagement_id)
    summary, link = (body.summary or "").strip()[:4000] or None, body.link
    if body.status in IN_PLACE and not (summary or link):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "An exit plan in place has a summary or a link to it")
    _put(scope, "exit_plan", {"status": body.status, "summary": summary, "link": link, **_stamp(user)})
    write_audit(db, v.tenant_id, entity="exit_plan", action="update", vendor_id=v.id,
                entity_id=scope.id if isinstance(scope, TPRAEngagement) else None, actor_id=user.id, to_value=body.status)
    db.commit()
    return _view(db, v, scope)


class RegulatorNoticeIn(BaseModel):
    required: bool
    sent_on: Optional[date] = None
    reference: Optional[str] = Field(None, max_length=120)


@router.put("/vendors/{vendor_id}/regulator-notice")
def set_regulator_notice(vendor_id: int, body: RegulatorNoticeIn, engagement_id: Optional[int] = None,
                         db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    """Whether the regulator must be told of this outsourcing, and when it was, with the reference."""
    v = _vendor(db, vendor_id, _tids(user, db))
    rbac.require_write(db, user, "lifecycle", "advance")
    scope = _scope(db, v, engagement_id)
    if body.sent_on and body.sent_on > date.today():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "The notice cannot be sent in the future")
    sent = body.sent_on.isoformat() if body.required and body.sent_on else None
    _put(scope, "regulator", {"required": body.required, "sent_on": sent,
                              "reference": _clean(body.reference, 120) if body.required else None, **_stamp(user)})
    write_audit(db, v.tenant_id, entity="regulator_notice", action="update", vendor_id=v.id,
                entity_id=scope.id if isinstance(scope, TPRAEngagement) else None, actor_id=user.id,
                to_value=sent or ("required" if body.required else "not required"))
    db.commit()
    return _view(db, v, scope)


class SubOutsourcerDecisionIn(BaseModel):
    decision: Literal["approve", "reject"]
    note: Optional[str] = Field(None, max_length=2000)


@router.post("/fourth-parties/{fp_id}/decision")
def decide_sub_outsourcer(fp_id: int, body: SubOutsourcerDecisionIn, db: Session = Depends(get_db),
                          user: GRCUser = Depends(require_auth)):
    """Approve or reject a sub-outsourcer of a critical or important service; not by whoever added it."""
    tids = _tids(user, db)
    fp = db.query(TPRAFourthParty).filter(TPRAFourthParty.id == fp_id, TPRAFourthParty.tenant_id.in_(tids),
                                          TPRAFourthParty.deleted_at.is_(None)).first()
    if fp is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Sub-outsourcer not found")
    rbac.require_write(db, user, "approvals", "approve", allow_fallback=False)
    ensure_independent(fp.created_by, user, "approve this sub-outsourcer")
    fp.approval_status = "approved" if body.decision == "approve" else "rejected"
    fp.approval = {"note": _clean(body.note, 2000), **_stamp(user)}
    write_audit(db, fp.tenant_id, entity="fourth_party", action=body.decision, vendor_id=fp.vendor_id, entity_id=fp.id,
                actor_id=user.id, to_value=fp.approval_status, reason=fp.approval["note"])
    db.commit()
    return {"id": fp.id, "approval_status": fp.approval_status, "approval": fp.approval}


class LossEventIn(RiskIncidentLossFields):
    """The Basel fields of the loss event; the title, dates and severity come from the vendor incident."""


@router.post("/vendor-incidents/{incident_id}/loss-event", status_code=status.HTTP_201_CREATED)
def record_loss_event(incident_id: int, body: LossEventIn, db: Session = Depends(get_db),
                      user: GRCUser = Depends(require_auth)):
    """Record a vendor incident as a Basel loss event, once. Net loss is gross less recoveries (the model sets it)."""
    from ...erm.routers.incidents import _loss_keys
    tids = _tids(user, db)
    inc = db.query(VendorIncident).filter(VendorIncident.id == incident_id, VendorIncident.tenant_id.in_(tids)).first()
    if inc is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Incident not found")
    rbac.require_write(db, user, "monitoring", "edit")
    if not has_tenant_permission(db, user, "erm:incidents:create", "erm:risks:create"):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Recording a loss event needs the right to create loss events")
    if inc.loss_event_id:
        raise HTTPException(status.HTTP_409_CONFLICT, "This incident is already a loss event")
    loss = _loss_keys(body.model_dump(exclude_none=True))
    if loss.get("gross_loss") is not None and not loss.get("currency"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Give the currency of the loss")
    vendor = db.get(Vendor, inc.vendor_id)
    event = RiskIncident(
        tenant_id=inc.tenant_id, title=f"{vendor.name}: {inc.title}"[:255] if vendor else inc.title,
        description=inc.description, incident_date=inc.occurred_at or inc.created_at or datetime.utcnow(),
        severity=inc.severity or "medium", status="open", operational_impact=inc.impact_description,
        corrective_actions=inc.corrective_actions, reported_by=user.id, tags=["third_party", f"vendor:{inc.vendor_id}"],
        **{"event_type": LOSS_EVENT_TYPE, "discovered_date": inc.created_at or datetime.utcnow(), **loss},
    )
    db.add(event)
    db.flush()
    inc.loss_event_id = event.id
    write_audit(db, inc.tenant_id, entity="vendor_incident", action="loss_event", vendor_id=inc.vendor_id,
                entity_id=inc.id, actor_id=user.id, to_value=event.id)
    db.commit()
    return {"incident_id": inc.id, "loss_event_id": event.id, "event_type": event.event_type, "gross_loss": event.gross_loss,
            "recoveries": event.recoveries, "net_loss": event.net_loss, "currency": event.currency,
            "link": f"/erm/incidents/{event.id}"}


@router.get("/concentration/appetite")
def concentration_against_appetite(db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    """Critical or important vendors per fourth party, against the third-party appetite's concentration limit."""
    tenant_id = _tids(user, db)[0]
    config = db.query(RiskAppetiteConfig).filter(RiskAppetiteConfig.tenant_id == tenant_id,
                                                 RiskAppetiteConfig.category == CATEGORY).first()
    limit = config.concentration_limit if config else None
    rows = concentration_rows(db, tenant_id)
    return {"config_id": config.id if config else None, "limit": limit, "platforms": rows,
            "breaching": [r for r in rows if limit is not None and r["count"] > limit]}
