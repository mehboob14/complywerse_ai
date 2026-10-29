"""What we use a supplier for: each engagement is tiered, assessed and approved on its own.

One supplier often serves several parts of the business in different ways: payroll
for HR, a data warehouse for finance. Each such use is an engagement, with its own
owner, facts, tier, questionnaires, score, approval and review date; the lifecycle
runs it through the same stages (service.py, by the assessment's engagement_id).
The supplier shows the worst of its open engagements.

A supplier nobody has split carries on as one General engagement, which is the
supplier itself: the list answers with a General built from it and writes nothing.
The first engagement added makes the General row, from the supplier's facts and
scores as they stand; General's assessments keep engagement_id NULL, so nothing
already recorded is rewritten.

An engagement is ended, never deleted: it keeps its history, its open assessment is
archived and the supplier shows the worst of what is left. General is the supplier
itself, so it is neither edited nor ended here: the supplier's own record and its
offboarding do that. An engagement can also be offboarded on its own, with an exit
checklist kept on the engagement: finishing it ends the engagement the same way.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Dict, List, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import case, func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ....models import BusinessUnit, GRCUser, TPRAEngagement, Vendor, VendorAssessment, get_db
from ....routers.auth_router import get_user_tenants, refuse_imported_accounts, require_auth
from ..lifecycle import exit_steps, stamp_steps
from . import intake, rbac, service
from .bootstrap import get_tiering_config
from .tier_policy import _ACCESS_RANK

router = APIRouter(tags=["Vendor engagements"])

ACCESS_LEVELS = list(_ACCESS_RANK)      # as on the supplier: none … regulated
_MAX_ITEMS = 50


# ── reading ──────────────────────────────────────────────────────────────────

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


def _engagement(db: Session, engagement_id: int, tids: List[int]):
    row = (db.query(TPRAEngagement, Vendor).join(Vendor, Vendor.id == TPRAEngagement.vendor_id)
           .filter(TPRAEngagement.id == engagement_id, TPRAEngagement.tenant_id.in_(tids),
                   Vendor.deleted_at.is_(None)).first())
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Engagement not found")
    return row


def _types(custom: Optional[dict]) -> List[dict]:
    """What we buy, in the words of the tenant's intake form."""
    options = intake.spec(custom)["questions"]["engagement_type"].get("options") or []
    return [{"value": o["value"], "label": o["label"]} for o in options if not o.get("archived")]


def _names(db: Session, ids) -> Dict[int, str]:
    ids = {i for i in ids if i}
    if not ids:
        return {}
    return {u.id: u.display_name or u.username or u.email for u in db.query(GRCUser).filter(GRCUser.id.in_(ids))}


def _iso(value) -> Optional[str]:
    return value.isoformat() if value is not None else None


def _list(value) -> list:
    return list(value) if isinstance(value, list) else ([value] if value else [])


def _starters(rows) -> list:
    return [r.offboarding.get("started_by") for r in rows if isinstance(r.offboarding, dict)]


def _exit_summary(state, names: Dict[int, str]) -> Optional[dict]:
    """One engagement's exit as it is shown: why, when and by whom, the steps and how far, and whether it is done."""
    if not isinstance(state, dict):
        return None
    items = [i for i in state.get("items") or [] if isinstance(i, dict)]
    return {"reason": state.get("reason"), "started_at": state.get("started_at"),
            "started_by": names.get(state.get("started_by")), "notes": state.get("notes"),
            "completed_at": state.get("completed_at"), "items": items,
            "done": sum(1 for i in items if i.get("done")), "total": len(items)}


def exits(db: Session, vendor: Vendor) -> List[dict]:
    """The exits of the supplier's single engagements (the supplier's own is its offboarding): those under way
    first, then the finished, each with its engagement's id and name."""
    rows = [r for r in db.query(TPRAEngagement).filter(TPRAEngagement.vendor_id == vendor.id,
                                                       TPRAEngagement.is_general.is_(False))
            .order_by(TPRAEngagement.id) if isinstance(r.offboarding, dict)]
    names = _names(db, _starters(rows))
    return [{"id": r.id, "name": r.name, "ended": r.status == "ended", **_exit_summary(r.offboarding, names)}
            for r in sorted(rows, key=lambda r: r.status == "ended")]


def _row(v: Vendor, e: Optional[TPRAEngagement], names: Dict[int, str], units: Dict[int, str],
         grade: Optional[str] = None) -> dict:
    """One engagement as the list shows it. General (no row yet, or its row) is the
    supplier: its facts, owner, assessment, stage and review date are the supplier's;
    its tier and scores are its row's once it has one."""
    general = e is None or e.is_general
    own = v if general else e                       # facts and pointers
    scores = e if e is not None else v
    return {
        "id": e.id if e is not None else None, "vendor_id": v.id,
        "name": "General" if general else e.name, "is_general": general,
        "description": None if general else e.description,
        "owner_id": own.owner_id, "owner_name": names.get(own.owner_id),
        "business_unit_id": own.business_unit_id, "business_unit": units.get(own.business_unit_id),
        "engagement_type": (((v.intake or {}).get("answers") or {}).get("engagement_type") if general
                            else e.engagement_type),
        "data_access_level": own.data_access_level, "data_types_accessed": _list(own.data_types_accessed),
        "services_provided": _list(own.services_provided),
        "criticality": None if general else e.criticality,
        "intake": None if general else e.intake,
        "start_date": None if general else _iso(e.start_date), "end_date": None if general else _iso(e.end_date),
        "tier": scores.tier, "inherent_risk_score": scores.inherent_risk_score,
        "residual_risk_score": scores.residual_risk_score, "risk_rating": scores.risk_rating,
        "rating_grade": e.rating_grade if e is not None else grade,
        "active_assessment_id": own.active_assessment_id, "lifecycle_stage": own.lifecycle_stage,
        "reassessment_cadence_days": own.reassessment_cadence_days,
        "next_reassessment_date": _iso(own.next_reassessment_date),
        "status": e.status if e is not None else "active",
        "ended_reason": e.ended_reason if e is not None else None,
        "archived_at": _iso(e.archived_at) if e is not None else None,
        "created_at": _iso(e.created_at) if e is not None else None,
        "offboarding": None if general else _exit_summary(e.offboarding, names),
    }


def _units(db: Session, tenant_id: int) -> Dict[int, str]:
    return {u.id: u.name for u in db.query(BusinessUnit).filter(BusinessUnit.tenant_id == tenant_id)
            .order_by(BusinessUnit.name, BusinessUnit.id)}


def _one(db: Session, v: Vendor, e: TPRAEngagement) -> dict:
    return _row(v, e, _names(db, [e.owner_id, v.owner_id, *_starters([e])]), _units(db, v.tenant_id))


@router.get("/vendors/{vendor_id}/engagements")
def list_engagements(vendor_id: int, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    """The supplier's engagements: General first, then the open ones by name, then
    the ended. A supplier never split is answered with a General built from it."""
    tids = _tids(user, db)
    v = _vendor(db, vendor_id, tids)
    rows = (db.query(TPRAEngagement).filter(TPRAEngagement.vendor_id == v.id)
            .order_by(TPRAEngagement.is_general.desc(), case((TPRAEngagement.status == "ended", 1), else_=0),
                      func.lower(TPRAEngagement.name), TPRAEngagement.id).all())
    units = _units(db, v.tenant_id)
    names = _names(db, [v.owner_id, *(r.owner_id for r in rows), *_starters(rows)])
    if rows:
        items = [_row(v, r, names, units) for r in rows]
    else:
        active = service.get_active_assessment(db, v)
        items = [_row(v, None, names, units, active.rating_grade if active is not None else None)]
    in_use = [i for i in items if i["status"] != "ended"]
    return {
        "items": items,
        # The supplier's own columns: the worst of its open engagements once it has any.
        "supplier": {"tier": v.tier, "risk_rating": v.risk_rating, "inherent_risk_score": v.inherent_risk_score,
                     "residual_risk_score": v.residual_risk_score,
                     "rating_grade": max((i["rating_grade"] for i in in_use if i["rating_grade"]), default=None),
                     "engagements": len(in_use)},
        "units": [{"id": k, "name": n} for k, n in units.items()],
        "types": _types(get_tiering_config(db, v.tenant_id).get("customisation")),
        "access_levels": ACCESS_LEVELS,
    }


# ── writing ──────────────────────────────────────────────────────────────────

class EngagementIn(BaseModel):
    """Only the fields a request names are written; null or blank clears one."""
    name: Optional[str] = Field(None, max_length=255)
    description: Optional[str] = None
    owner_id: Optional[int] = None
    business_unit_id: Optional[int] = None
    engagement_type: Optional[str] = None
    data_access_level: Optional[str] = None
    data_types_accessed: Optional[List[str]] = None
    services_provided: Optional[List[str]] = None
    criticality: Optional[Literal["low", "medium", "high", "critical"]] = None
    intake: Optional[dict] = None       # {"answers": {...}, "justifications": {...}}: the intake questions
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    reassessment_cadence_days: Optional[int] = None
    next_reassessment_date: Optional[datetime] = None


class EndIn(BaseModel):
    reason: str


def _bad(message: str) -> HTTPException:
    return HTTPException(status.HTTP_400_BAD_REQUEST, message)


def _clean(db: Session, v: Vendor, body: EngagementIn, given, custom: Optional[dict],
           current: Optional[TPRAEngagement] = None) -> dict:
    """The fields a write names, checked."""
    out: dict = {}
    for key in given:
        value = getattr(body, key)
        if isinstance(value, str):
            value = value.strip() or None
        if key == "name":
            value = " ".join((value or "").split())
            if not value:
                raise _bad("Give the engagement a name")
            if value.lower() == "general":
                raise _bad("General is the supplier itself: name what this engagement is for")
            same = db.query(TPRAEngagement.id).filter(
                TPRAEngagement.vendor_id == v.id, TPRAEngagement.status != "ended",
                func.lower(TPRAEngagement.name) == value.lower())
            if current is not None:
                same = same.filter(TPRAEngagement.id != current.id)
            if same.first():
                raise HTTPException(status.HTTP_409_CONFLICT, f"{v.name} already has an engagement called {value}")
        elif key == "description" and value:
            value = value[:4000]
        elif key == "owner_id" and value:
            refuse_imported_accounts(db, [value], kept=[current.owner_id] if current is not None else ())
            if not db.query(GRCUser.id).filter(GRCUser.id == value, GRCUser.is_active.is_(True)).first():
                raise _bad("There is no active user with that id")
        elif key == "business_unit_id" and value:
            if not db.query(BusinessUnit.id).filter(BusinessUnit.id == value,
                                                    BusinessUnit.tenant_id == v.tenant_id).first():
                raise _bad("Unknown business unit")
        elif key == "engagement_type" and value:
            kinds = _types(custom)
            if value not in {t["value"] for t in kinds}:
                raise _bad(f"What we buy must be one of: {', '.join(t['label'] for t in kinds)}")
        elif key == "data_access_level" and value:
            if value not in ACCESS_LEVELS:
                raise _bad(f"Data access must be one of: {', '.join(ACCESS_LEVELS)}")
        elif key in ("data_types_accessed", "services_provided"):
            value = list(dict.fromkeys(" ".join(str(x).split())[:100] for x in value or [] if str(x).strip()))[:_MAX_ITEMS]
        elif key == "intake" and value is not None:
            try:
                patch = intake.clean(value.get("answers"), value.get("justifications"), custom)
            except ValueError as exc:
                raise _bad(str(exc))
            value = intake.merge(current.intake if current is not None else None, patch)
        elif key == "reassessment_cadence_days" and value is not None and not 1 <= value <= 3650:
            raise _bad("The review cadence must be 1 to 3,650 days")
        out[key] = value
    start = out.get("start_date", current.start_date if current is not None else None)
    end = out.get("end_date", current.end_date if current is not None else None)
    if start and end and end < start:
        raise _bad("The end date is before the start date")
    if out.get("reassessment_cadence_days") and "next_reassessment_date" not in given:
        # A cadence alone schedules the next review from today, as the supplier's does.
        out["next_reassessment_date"] = datetime.utcnow() + timedelta(days=out["reassessment_cadence_days"])
    return out


def ensure_general(db: Session, vendor: Vendor, actor_id: Optional[int]) -> TPRAEngagement:
    """The supplier's General row, made the first time an engagement is added from
    its facts and scores as they stand. Its assessments keep engagement_id NULL."""
    row = service.general_row(db, vendor)
    if row is not None:
        return row
    active = service.get_active_assessment(db, vendor)
    row = TPRAEngagement(
        tenant_id=vendor.tenant_id, vendor_id=vendor.id, name="General", is_general=True, status="active",
        owner_id=vendor.owner_id, business_unit_id=vendor.business_unit_id,
        engagement_type=((vendor.intake or {}).get("answers") or {}).get("engagement_type"),
        data_access_level=vendor.data_access_level, data_types_accessed=_list(vendor.data_types_accessed),
        services_provided=_list(vendor.services_provided), intake=vendor.intake,
        tier=vendor.tier, inherent_risk_score=vendor.inherent_risk_score,
        residual_risk_score=vendor.residual_risk_score, risk_rating=vendor.risk_rating,
        rating_grade=active.rating_grade if active is not None else None,
        active_assessment_id=vendor.active_assessment_id, lifecycle_stage=vendor.lifecycle_stage,
        reassessment_cadence_days=vendor.reassessment_cadence_days,
        next_reassessment_date=vendor.next_reassessment_date, created_by=actor_id,
    )
    db.add(row)
    db.flush()
    service.write_audit(db, vendor.tenant_id, entity="engagement", action="create", vendor_id=vendor.id,
                        entity_id=row.id, actor_id=actor_id, to_value="General",
                        reason="The supplier as it stood when its first engagement was added")
    return row


def add_first(db: Session, vendor: Vendor, name: Optional[str], actor_id: Optional[int]) -> Optional[TPRAEngagement]:
    """The engagement a request named, made when the request is picked up: General's row first, from the
    supplier as it stands, then this one with the supplier's facts and the request's answers (it is tiered
    when someone opens it). None when the request names none, names General, or the name is taken."""
    name = " ".join((name or "").split())[:255]
    if not name or name.lower() == "general" or db.query(TPRAEngagement.id).filter(
            TPRAEngagement.vendor_id == vendor.id, TPRAEngagement.status != "ended",
            func.lower(TPRAEngagement.name) == name.lower()).first():
        return None
    ensure_general(db, vendor, actor_id)
    answers = (vendor.intake or {}).get("answers") or {}
    row = TPRAEngagement(
        tenant_id=vendor.tenant_id, vendor_id=vendor.id, name=name, status="active", created_by=actor_id,
        description=answers.get("purpose"), owner_id=vendor.owner_id, business_unit_id=vendor.business_unit_id,
        engagement_type=answers.get("engagement_type"), data_access_level=vendor.data_access_level,
        data_types_accessed=_list(vendor.data_types_accessed), services_provided=_list(vendor.services_provided),
        intake=vendor.intake)
    db.add(row)
    db.flush()
    service.write_audit(db, vendor.tenant_id, entity="engagement", action="create", vendor_id=vendor.id,
                        entity_id=row.id, actor_id=actor_id, to_value=row.name, reason="Named by the request")
    return row


@router.post("/vendors/{vendor_id}/engagements", status_code=status.HTTP_201_CREATED)
def create_engagement(vendor_id: int, body: EngagementIn, db: Session = Depends(get_db),
                      user: GRCUser = Depends(require_auth)):
    """Add an engagement; the first one also makes General's row."""
    tids = _tids(user, db)
    v = _vendor(db, vendor_id, tids)
    rbac.require_write(db, user, "vendors", "edit")
    values = _clean(db, v, body, {"name", *body.model_fields_set},
                    get_tiering_config(db, v.tenant_id).get("customisation"))
    try:
        ensure_general(db, v, user.id)
        e = TPRAEngagement(tenant_id=v.tenant_id, vendor_id=v.id, status="active", created_by=user.id, **values)
        db.add(e)
        db.flush()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT,
                            "Someone added an engagement to this supplier a moment ago. Reload and try again.")
    service.write_audit(db, v.tenant_id, entity="engagement", action="create", vendor_id=v.id, entity_id=e.id,
                        actor_id=user.id, to_value=e.name)
    db.commit()
    return _one(db, v, e)


@router.put("/engagements/{engagement_id}")
def update_engagement(engagement_id: int, body: EngagementIn, db: Session = Depends(get_db),
                      user: GRCUser = Depends(require_auth)):
    tids = _tids(user, db)
    e, v = _engagement(db, engagement_id, tids)
    rbac.require_write(db, user, "vendors", "edit")
    if e.is_general:
        raise _bad("General is the supplier itself: change it on the supplier's record")
    if e.status == "ended":
        raise _bad("This engagement has ended")
    values = _clean(db, v, body, body.model_fields_set, get_tiering_config(db, v.tenant_id).get("customisation"), e)
    changed = [k for k, value in values.items() if getattr(e, k) != value]
    for key in changed:
        setattr(e, key, values[key])
    if changed:
        service.write_audit(db, v.tenant_id, entity="engagement", action="update", vendor_id=v.id, entity_id=e.id,
                            actor_id=user.id, to_value=", ".join(changed), extra={"changes": changed})
    db.commit()
    return _one(db, v, e)


def _end(db: Session, v: Vendor, e: TPRAEngagement, actor_id: Optional[int], reason: str,
         extra: Optional[dict] = None) -> None:
    """The engagement is over: marked ended with when and why, its open assessment archived, the supplier recached
    to the worst of the rest. Nothing is deleted. The caller commits."""
    now = datetime.utcnow()
    e.status, e.archived_at, e.ended_reason = "ended", now, reason[:2000]
    if e.end_date is None or e.end_date > now.date():
        e.end_date = now.date()
    archived = []
    for a in (db.query(VendorAssessment)
              .filter(VendorAssessment.engagement_id == e.id, VendorAssessment.lifecycle_status == "active",
                      VendorAssessment.deleted_at.is_(None))
              .order_by(VendorAssessment.id)):
        a.lifecycle_status = "archived"
        a.row_version = (a.row_version or 1) + 1
        archived.append(a.id)
    db.flush()          # tenant sessions do not autoflush (PITFALLS 74): recache reads the ended status from the database
    service.recache(db, v)
    service.write_audit(db, v.tenant_id, entity="engagement", action="end", vendor_id=v.id, entity_id=e.id,
                        actor_id=actor_id, from_value="active", to_value="ended", reason=reason,
                        extra={"archived_assessments": archived, **(extra or {})})


@router.post("/engagements/{engagement_id}/end")
def end_engagement(engagement_id: int, body: EndIn, db: Session = Depends(get_db),
                   user: GRCUser = Depends(require_auth)):
    """End an engagement. Nothing is deleted: it is marked ended with when and why,
    its open assessment is archived, and the supplier shows the worst of the rest."""
    tids = _tids(user, db)
    e, v = _engagement(db, engagement_id, tids)
    rbac.require_write(db, user, "vendors", "edit")
    if e.is_general:
        raise _bad("General is the supplier itself and is not ended: offboard the supplier instead")
    if e.status == "ended":
        raise _bad("This engagement has already ended")
    reason = " ".join((body.reason or "").split())
    if len(reason) < 3:
        raise _bad("Say why the engagement ended")
    _end(db, v, e, user.id, reason)
    db.commit()
    return _one(db, v, e)


# ── offboarding one engagement ───────────────────────────────────────────────
# An exit of its own: a checklist kept on the engagement, started with a reason and finished when every step is
# done, which ends the engagement as above. The supplier stays active with its portal links; offboarding the
# whole relationship is the supplier's (routers/lifecycle.py).

class ExitStart(BaseModel):
    reason: str


class ExitUpdate(BaseModel):
    # The whole list as it now stands, {item, done}; notes alone leave it as it is.
    items: Optional[list] = None
    notes: Optional[str] = Field(None, max_length=8000)


def _open_exit(e: TPRAEngagement) -> dict:
    """The engagement's exit state while it is under way; 400 when there is none to work on."""
    if e.status == "ended" or not isinstance(e.offboarding, dict) or e.offboarding.get("completed_at"):
        raise _bad("There is no exit under way for this engagement")
    return e.offboarding


@router.post("/engagements/{engagement_id}/offboarding/start")
def start_exit(engagement_id: int, body: ExitStart, db: Session = Depends(get_db),
               user: GRCUser = Depends(require_auth)):
    """Start the exit of one engagement: its own checklist opens. It stays in use until the exit is finished."""
    e, v = _engagement(db, engagement_id, _tids(user, db))
    rbac.require_write(db, user, "vendors", "edit")
    if e.is_general:
        raise _bad("General is the supplier itself: offboard the supplier instead")
    if e.status == "ended":
        raise _bad("This engagement has already ended")
    if (v.status or "").lower() == "offboarded":
        raise HTTPException(status.HTTP_409_CONFLICT, "The whole relationship is already being offboarded.")
    if isinstance(e.offboarding, dict):
        raise HTTPException(status.HTTP_409_CONFLICT, "This exit is already under way. Finish it rather than starting another.")
    reason = " ".join((body.reason or "").split())
    if len(reason) < 3:
        raise _bad("Say why the engagement is ending")
    e.offboarding = {"items": exit_steps(), "reason": reason[:2000], "started_at": datetime.utcnow().isoformat(),
                     "started_by": user.id, "notes": None, "completed_at": None}
    service.write_audit(db, v.tenant_id, entity="engagement", action="offboard", vendor_id=v.id, entity_id=e.id,
                        actor_id=user.id, to_value="offboarding", reason=reason)
    db.commit()
    return _one(db, v, e)


@router.patch("/engagements/{engagement_id}/offboarding")
def update_exit(engagement_id: int, body: ExitUpdate, db: Session = Depends(get_db),
                user: GRCUser = Depends(require_auth)):
    """Tick steps (the list replaces the old one; a step already done keeps who and when) and keep notes."""
    e, v = _engagement(db, engagement_id, _tids(user, db))
    rbac.require_write(db, user, "vendors", "edit")
    state = dict(_open_exit(e))
    if body.items is not None:
        state["items"] = stamp_steps(body.items, state.get("items"), user.id)
    if body.notes is not None:
        state["notes"] = body.notes.strip() or None
    e.offboarding = state
    db.commit()
    return _one(db, v, e)


@router.post("/engagements/{engagement_id}/offboarding/complete")
def complete_exit(engagement_id: int, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    """Finish the exit once every step is done: the engagement ends (as End engagement does) and the supplier stays active."""
    e, v = _engagement(db, engagement_id, _tids(user, db))
    rbac.require_write(db, user, "vendors", "edit")
    state = _open_exit(e)
    open_steps = [i.get("item") for i in state.get("items") or [] if isinstance(i, dict) and not i.get("done")]
    if open_steps:
        raise HTTPException(status.HTTP_409_CONFLICT, {"message": "Some offboarding steps are not done.", "open": open_steps})
    _end(db, v, e, user.id, state.get("reason") or "Offboarded", extra={"offboarding": True})
    e.offboarding = {**state, "completed_at": datetime.utcnow().isoformat()}
    db.commit()
    return _one(db, v, e)
