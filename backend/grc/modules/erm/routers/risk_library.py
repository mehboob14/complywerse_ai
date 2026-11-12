"""Risk Library: the risks a standard lists, suggested for a unit, proposed to its risk owner and accepted into the register.

The library is shipped data (`services/risk_library.py`), the same for every tenant. Identifying a risk from it runs on a
proposal (`RiskLibraryProposal`): the risk team asks what the library suggests for a unit and proposes a risk to an owner; the
owner confirms it applies and drafts the inherent score, which makes a Draft register risk (`source_type` "risk_library",
`source_reference` the library risk's id), or declines with a reason; someone other than the person who drafted it accepts it
into the register (Draft -> Open, with the library item's requirements and mapped controls linked and the history naming the
item) or returns it with comments. A draft is not counted by the register's list, dashboards or appetite. An administrator may
still add a risk straight from the library, with the tenant's own risk fields; it too starts as a draft waiting for acceptance.
"""
from datetime import datetime
from typing import Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from ....models import (BusinessUnit, GRCUser, NormalizedControl, NormalizedControlLink, ParsedFrameworkControl, Risk,
                        RiskLibraryProposal, Tenant, get_db)
from ....routers.auth_router import (
    get_user_primary_tenant, get_user_tenants, has_tenant_permission, is_tenant_admin, refuse_imported_accounts, require_auth,
    require_tenant_permission,
)
from ....services.module_settings import clean_record_values
from ....services.segregation import ensure_independent
from ...workflow_engine.services.notification_service import send_workflow_notification
from ..services import risk_framework_requirements as requirements
from ..services import risk_library
from ..services.risk_control_links import find_link, link_control
from .risks import (DRAFT_STATUS, _clean_priority, _resolve_team_to_business_unit, _user_names, calculate_risk_score,
                    record_risk_change, risk_snapshot)

router = APIRouter(prefix="/risk-library", tags=["ERM - Risk Library"])

CATEGORIES = ("strategic", "operational", "financial", "compliance", "technology", "third_party", "project_change", "internal")
# ^ the register's standard categories, which the library's suggestions come from; a tenant may keep its own category list, so a pop-up is not held to these
OPEN = ("proposed", "drafted", "returned")          # a proposal still in hand
CAN_PROPOSE = Depends(require_tenant_permission("erm:risks:create", "erm:risks:edit"))
CAN_CHALLENGE = Depends(require_tenant_permission("erm:risks:edit"))


def _in_register(db: Session, tenant_ids: List[int], ids: List[str], unit_id: Optional[int] = None) -> Dict[str, dict]:
    """{library risk id: {risk_id, title, status, times, units}} for the ones this tenant has in its register (a draft is not in it
    yet); with `unit_id`, the ones in that unit's register."""
    if not ids or not tenant_ids:
        return {}
    q = db.query(Risk).filter(Risk.tenant_id.in_(tenant_ids), Risk.source_type == risk_library.SOURCE_TYPE,
                              Risk.source_reference.in_(ids), Risk.status.is_distinct_from(DRAFT_STATUS))
    if unit_id is not None:
        q = q.filter(Risk.business_unit_id == unit_id)
    out: Dict[str, dict] = {}
    for r in q.order_by(Risk.id).all():
        mark = out.setdefault(r.source_reference, {"risk_id": r.id, "title": r.title, "status": r.status, "times": 0, "units": []})
        mark["times"] += 1
        if r.business_unit and r.business_unit.name not in mark["units"]:
            mark["units"].append(r.business_unit.name)
    return out


def _open_proposals(db: Session, tenant_ids: List[int], ids: List[str], unit_id: Optional[int] = None) -> Dict[str, List[dict]]:
    """{library risk id: [its proposals still in hand]} (optionally for one unit), for the "Proposed" mark."""
    if not ids or not tenant_ids:
        return {}
    q = db.query(RiskLibraryProposal).filter(RiskLibraryProposal.tenant_id.in_(tenant_ids), RiskLibraryProposal.library_item_id.in_(ids),
                                             RiskLibraryProposal.status.in_(OPEN))
    if unit_id is not None:
        q = q.filter(RiskLibraryProposal.business_unit_id == unit_id)
    rows = q.order_by(RiskLibraryProposal.id).all()
    names = _user_names(db, {p.owner_id for p in rows})
    out: Dict[str, List[dict]] = {}
    for p in rows:
        out.setdefault(p.library_item_id, []).append({
            "id": p.id, "status": p.status, "business_unit_id": p.business_unit_id,
            "unit_name": p.business_unit.name if p.business_unit else None, "owner_id": p.owner_id,
            "owner_name": names.get(p.owner_id), "risk_id": p.risk_id})
    return out


def _installed(db: Session, tenant_ids: List[int], framework_key: str):
    """The tenant's installed copy of a library's framework and the control ids it holds: (framework or None, set of codes)."""
    lib = risk_library.library(framework_key)
    framework = requirements.find_framework(db, tenant_ids, framework_key, lib["framework"]["name"] if lib else None)
    return framework, (requirements.codes_installed(db, framework.id) if framework else set())


def _shape(item: dict, marks: Dict[str, dict], codes: Optional[set] = None, proposals: Optional[Dict[str, List[dict]]] = None) -> dict:
    out = {**item, "in_register": marks.get(item["id"]), "proposals": (proposals or {}).get(item["id"], [])}
    if codes is not None:
        out["controls"] = [{**c, "installed": c["control_id"] in codes} for c in item["controls"]]
    return out


def _item(item_id: str) -> dict:
    item = risk_library.find(item_id)
    if item is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "That risk is not in the library")
    return item


def _tenant(db: Session, user: GRCUser) -> int:
    tenant_id = get_user_primary_tenant(user, db)
    if not tenant_id or db.query(Tenant.id).filter(Tenant.id == tenant_id).first() is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "User is not assigned to any tenant")
    return tenant_id


def _unit(db: Session, tenant_ids: List[int], unit_id: int) -> BusinessUnit:
    unit = db.query(BusinessUnit).filter(BusinessUnit.id == unit_id, BusinessUnit.tenant_id.in_(tenant_ids or [-1])).first()
    if unit is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "That unit is not in your organisation")
    return unit


def _proposal(db: Session, user: GRCUser, proposal_id: int) -> RiskLibraryProposal:
    p = (db.query(RiskLibraryProposal)
         .filter(RiskLibraryProposal.id == proposal_id, RiskLibraryProposal.tenant_id.in_(get_user_tenants(user, db) or [-1])).first())
    if p is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Proposal not found")
    return p


def _risk_out(risk: Optional[Risk]) -> Optional[dict]:
    if risk is None:
        return None
    return {"id": risk.id, "title": risk.title, "description": risk.description, "category": risk.category, "status": risk.status,
            "inherent_likelihood": risk.inherent_likelihood, "inherent_impact": risk.inherent_impact,
            "inherent_score": risk.inherent_score, "priority": risk.effective_priority}


def _proposal_out(p: RiskLibraryProposal, names: Dict[int, Optional[str]], user: GRCUser, may_challenge: bool) -> dict:
    item = risk_library.find(p.library_item_id) or {}
    owner = p.owner_id == user.id
    return {
        "id": p.id, "library_item_id": p.library_item_id, "title": item.get("title"), "objective_id": item.get("objective_id"),
        "objective_title": item.get("objective_title"), "business_unit_id": p.business_unit_id,
        "unit_name": p.business_unit.name if p.business_unit else None, "owner_id": p.owner_id, "owner_name": names.get(p.owner_id),
        "proposed_by": p.proposed_by, "proposed_by_name": names.get(p.proposed_by), "proposed_at": p.proposed_at, "note": p.note,
        "status": p.status, "drafted_by": p.drafted_by, "drafted_at": p.drafted_at, "decline_reason": p.decline_reason,
        "reviewed_by": p.reviewed_by, "reviewed_by_name": names.get(p.reviewed_by), "reviewed_at": p.reviewed_at,
        "review_comment": p.review_comment, "risk": _risk_out(p.risk),
        # what the caller may do with it now (the drafter never challenges their own draft)
        "you": {"may_draft": owner and p.status in ("proposed", "returned"), "may_decline": owner and p.status == "proposed",
                "may_challenge": may_challenge and p.status == "drafted" and p.drafted_by != user.id},
    }


def _may_challenge(db: Session, user: GRCUser) -> bool:
    return has_tenant_permission(db, user, "erm:risks:edit")


def _one_out(db: Session, p: RiskLibraryProposal, user: GRCUser) -> dict:
    return _proposal_out(p, _user_names(db, (p.owner_id, p.proposed_by, p.reviewed_by)), user, _may_challenge(db, user))


def _notify(db: Session, p: RiskLibraryProposal, user_id: Optional[int], subject: str, message: str) -> None:
    if user_id:
        send_workflow_notification(db, tenant_id=p.tenant_id, subject=subject, message=message, workflow_instance_id=None,
                                   user_ids=[user_id], link=f"/erm/risk-library?tab=proposals&proposal={p.id}")


def _risk_from_item(item: dict, tenant_id: int, category: str, **fields) -> Risk:
    """A Draft register risk from a library risk: the library's words and where it came from, with what the person gave."""
    return Risk(tenant_id=tenant_id, category=category, risk_category=category, risk_sub_category=item["objective_title"][:100],
                register_type=risk_library.short_name(item["framework_key"]), status=DRAFT_STATUS,
                source_type=risk_library.SOURCE_TYPE, source_reference=item["id"], **fields)


def _link_library_controls(db: Session, risk: Risk, item: dict, control_codes: Optional[List[str]], user_id: Optional[int]) -> dict:
    """Link the library item's requirements (its objective's controls that the installed framework holds; `control_codes`
    narrows them, None = all) and the organisation's common controls mapped to those requirements. Already linked ones are
    left as they are; the caller commits. {requirements, controls: the codes newly linked, not_installed}."""
    asked = [c["control_id"] for c in item["controls"]] if control_codes is None else [
        c for c in control_codes if c in {x["control_id"] for x in item["controls"]}]
    framework, codes = _installed(db, [risk.tenant_id], item["framework_key"])
    parsed = (db.query(ParsedFrameworkControl).filter(ParsedFrameworkControl.uploaded_framework_id == framework.id,
                                                      ParsedFrameworkControl.control_id.in_(asked))
              .order_by(ParsedFrameworkControl.id.asc()).all() if framework and asked else [])
    linked = requirements.link_controls(db, risk, framework, parsed, "partial", None, user_id) if parsed else {"linked": [], "already": []}
    controls: List[str] = []
    if parsed:
        mapped = (db.query(NormalizedControl)
                  .join(NormalizedControlLink, NormalizedControlLink.normalized_control_id == NormalizedControl.id)
                  .filter(NormalizedControlLink.parsed_control_id.in_([c.id for c in parsed]), NormalizedControl.retired_at.is_(None),
                          or_(NormalizedControl.tenant_id.is_(None), NormalizedControl.tenant_id == risk.tenant_id))
                  .order_by(NormalizedControl.id).all())
        for nc in mapped:
            if not find_link(db, risk.id, "normalized", nc.id):
                link_control(db, risk, "normalized", nc.id, user_id)       # the one risk–control link
                controls.append(nc.code)
    return {"requirements": linked["linked"], "controls": controls, "not_installed": [c for c in asked if c not in codes]}


@router.get("/frameworks")
def list_frameworks(current_user: GRCUser = Depends(require_auth)):
    return {"items": risk_library.frameworks()}


@router.get("/people")
def list_people(db: Session = Depends(get_db), current_user: GRCUser = Depends(require_auth)):
    """Who can own a risk, for the pop-up: the people of this platform. Open to anyone who may add a risk, who may not be allowed to
    read the admin user list (accounts an access review imported are not people here)."""
    from ....routers.auth_router import platform_account

    get_user_tenants(current_user, db)
    rows = (db.query(GRCUser).filter(GRCUser.is_active.is_(True), platform_account())
            .order_by(GRCUser.display_name.asc().nullslast(), GRCUser.username.asc()))
    return {"items": [{"id": u.id, "name": u.display_name or u.username or u.email} for u in rows]}


@router.get("/units")
def list_units(db: Session = Depends(get_db), current_user: GRCUser = Depends(require_auth)):
    """The units a library risk can be suggested for and proposed to: this organisation's business units."""
    rows = (db.query(BusinessUnit).filter(BusinessUnit.tenant_id.in_(get_user_tenants(current_user, db) or [-1]))
            .order_by(BusinessUnit.name.asc(), BusinessUnit.id.asc()))
    return {"items": [{"id": u.id, "name": u.name} for u in rows]}


@router.get("/suggestions")
def suggest_for_unit(
    business_unit_id: int = Query(..., description="The unit to suggest library risks for"),
    framework: Optional[str] = Query(None, description="Framework key; the first library when omitted"),
    limit: int = Query(50, ge=1, le=500),
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """What the library suggests for a unit, best first, each with why: a requirement it maps to that the organisation has adopted
    (+2), a category the unit already records (+1). Items already in that unit's register are left out, and nothing is suggested
    without a reason. Deterministic rules, no AI."""
    tenants = get_user_tenants(current_user, db)
    unit = _unit(db, tenants, business_unit_id)
    available = risk_library.frameworks()
    if not available:
        return {"unit": {"id": unit.id, "name": unit.name}, "framework": None, "items": [], "total": 0}
    key = framework or available[0]["key"]
    if risk_library.library(key) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "There is no risk library for that framework")
    everything = risk_library.search(key)
    ids = [r["id"] for r in everything]
    in_unit = _in_register(db, tenants, ids, unit.id)
    proposals = _open_proposals(db, tenants, ids, unit.id)
    _, codes = _installed(db, tenants, key)
    recorded = {(c or "").strip().lower().replace(" ", "_") for (c,) in db.query(func.coalesce(Risk.risk_category, Risk.category))
                .filter(Risk.tenant_id.in_(tenants), Risk.business_unit_id == unit.id, Risk.status.is_distinct_from(DRAFT_STATUS)).distinct()}
    short = risk_library.short_name(key)
    ranked = []
    for r in everything:
        if r["id"] in in_unit:
            continue
        reasons, score = [], 0
        adopted = [c["control_id"] for c in r["controls"] if c["control_id"] in codes]
        if adopted:
            more = f" and {len(adopted) - 1} more" if len(adopted) > 1 else ""
            reasons.append(f"Matches {short} {adopted[0]}{more} you have adopted")
            score += 2
        if r["suggested_category"] in recorded:
            reasons.append(f"{unit.name} already records {r['suggested_category'].replace('_', ' ')} risks")
            score += 1
        if reasons:
            ranked.append({**_shape(r, {}, codes, proposals), "reasons": reasons, "score": score})
    ranked.sort(key=lambda x: -x["score"])          # stable: the library's own order within a score
    return {"unit": {"id": unit.id, "name": unit.name}, "framework": next(f for f in available if f["key"] == key),
            "items": ranked[:limit], "total": len(ranked)}


@router.get("/proposals")
def list_proposals(
    mine: bool = Query(False, description="Only the ones proposed to me as the risk owner"),
    status_filter: Optional[str] = Query(None, alias="status"),
    limit: int = Query(200, ge=1, le=500),
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    q = db.query(RiskLibraryProposal).filter(RiskLibraryProposal.tenant_id.in_(get_user_tenants(current_user, db) or [-1]))
    if mine:
        q = q.filter(RiskLibraryProposal.owner_id == current_user.id)
    if status_filter:
        q = q.filter(RiskLibraryProposal.status == status_filter)
    rows = q.order_by(RiskLibraryProposal.id.desc()).limit(limit).all()
    names = _user_names(db, {u for p in rows for u in (p.owner_id, p.proposed_by, p.reviewed_by)})
    may_challenge = _may_challenge(db, current_user)
    return {"items": [_proposal_out(p, names, current_user, may_challenge) for p in rows]}


@router.get("/proposals/{proposal_id}")
def get_proposal(proposal_id: int, db: Session = Depends(get_db), current_user: GRCUser = Depends(require_auth)):
    """One proposal with the library's text beside the owner's draft, for the review."""
    p = _proposal(db, current_user, proposal_id)
    item = risk_library.find(p.library_item_id)
    tenants = [p.tenant_id]
    library_risk = None
    if item:
        _, codes = _installed(db, tenants, item["framework_key"])
        library_risk = _shape(item, _in_register(db, tenants, [item["id"]]), codes, _open_proposals(db, tenants, [item["id"]]))
    return {**_one_out(db, p, current_user), "library_risk": library_risk}


@router.get("")
def list_library(
    framework: Optional[str] = Query(None, description="Framework key (uae_ia); the first library when omitted"),
    family: Optional[str] = Query(None, description="Family id, such as M2 or T5"),
    objective: Optional[str] = Query(None, description="Control objective id, such as M2.3"),
    q: Optional[str] = Query(None, description="Words in the risk, its objective, its family or a control id"),
    in_register: Optional[bool] = Query(None, description="true: only those already in the register; false: only those not yet"),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=500),
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    available = risk_library.frameworks()
    if not available:
        return {"framework": None, "frameworks": [], "items": [], "total": 0, "skip": skip, "limit": limit, "in_register_total": 0,
                "facets": {"families": [], "objectives": []}, "installed_framework": None}
    key = framework or available[0]["key"]
    if risk_library.library(key) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "There is no risk library for that framework")
    tenants = get_user_tenants(current_user, db)
    everything = risk_library.search(key, family, objective, q)
    marks = _in_register(db, tenants, [r["id"] for r in everything])
    if in_register is True:
        everything = [r for r in everything if r["id"] in marks]
    elif in_register is False:
        everything = [r for r in everything if r["id"] not in marks]
    page = everything[skip:skip + limit]
    proposals = _open_proposals(db, tenants, [r["id"] for r in page])
    installed, codes = _installed(db, tenants, key)
    return {
        "framework": next(f for f in available if f["key"] == key), "frameworks": available,
        "items": [_shape(r, marks, codes, proposals) for r in page], "total": len(everything), "skip": skip, "limit": limit,
        "in_register_total": len(marks), "facets": risk_library.facets(key),
        "installed_framework": {"id": installed.id, "name": installed.name} if installed else None,
    }


@router.get("/{item_id}")
def get_library_risk(item_id: str, db: Session = Depends(get_db), current_user: GRCUser = Depends(require_auth)):
    item = _item(item_id)
    tenants = get_user_tenants(current_user, db)
    _, codes = _installed(db, tenants, item["framework_key"])
    return _shape(item, _in_register(db, tenants, [item_id]), codes, _open_proposals(db, tenants, [item_id]))


# ── propose, draft, accept ───────────────────────────────────────────────────

class ProposeToOwner(BaseModel):
    business_unit_id: int
    owner_id: int
    note: Optional[str] = Field(None, max_length=2000)


@router.post("/{item_id}/propose", status_code=status.HTTP_201_CREATED)
def propose_to_owner(item_id: str, body: ProposeToOwner, _perm: bool = CAN_PROPOSE, db: Session = Depends(get_db),
                     current_user: GRCUser = Depends(require_auth)):
    """The risk team proposes a library risk to a risk owner for one unit; the owner is told."""
    item = _item(item_id)
    tenant_id = _tenant(db, current_user)
    unit = _unit(db, [tenant_id], body.business_unit_id)
    refuse_imported_accounts(db, [body.owner_id])
    if db.query(GRCUser.id).filter(GRCUser.id == body.owner_id, GRCUser.is_active.is_(True)).first() is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Choose an active person as the risk owner")
    already = _in_register(db, [tenant_id], [item_id], unit.id).get(item_id)
    if already:
        raise HTTPException(status.HTTP_409_CONFLICT, f"{unit.name} already has this risk in its register (risk #{already['risk_id']}).")
    if _open_proposals(db, [tenant_id], [item_id], unit.id):
        raise HTTPException(status.HTTP_409_CONFLICT, f"This risk is already proposed for {unit.name}.")
    p = RiskLibraryProposal(tenant_id=tenant_id, library_item_id=item_id, business_unit_id=unit.id, owner_id=body.owner_id,
                            proposed_by=current_user.id, note=(body.note or "").strip() or None, status="proposed")
    db.add(p)
    db.flush()
    by = current_user.display_name or current_user.username
    _notify(db, p, p.owner_id, f"Risk proposed to you: {item['title']}",
            f"{by} proposes the library risk \"{item['title']}\" ({item['objective_id']} {item['objective_title']}) for {unit.name}. "
            "Confirm it applies and draft its score, or decline it with a reason.")
    db.commit()
    db.refresh(p)
    return _one_out(db, p, current_user)


class DraftScore(BaseModel):
    """The owner confirms the risk applies and drafts its inherent score; the words may be the library's or the owner's."""
    inherent_likelihood: int = Field(..., ge=1, le=5)
    inherent_impact: int = Field(..., ge=1, le=5)
    title: Optional[str] = Field(None, max_length=255)
    description: Optional[str] = None
    category: Optional[str] = Field(None, max_length=50)
    custom_values: Optional[dict] = None


def _owner_only(p: RiskLibraryProposal, user: GRCUser) -> None:
    if p.owner_id != user.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the risk owner it was proposed to can answer this proposal.")


@router.post("/proposals/{proposal_id}/draft")
def draft_proposal(proposal_id: int, body: DraftScore, db: Session = Depends(get_db), current_user: GRCUser = Depends(require_auth)):
    """The owner's "Send for challenge": a Draft register risk (or, after a return, the same draft with the new answers)."""
    p = _proposal(db, current_user, proposal_id)
    _owner_only(p, current_user)
    if p.status not in ("proposed", "returned"):
        raise HTTPException(status.HTTP_409_CONFLICT, f"This proposal is {p.status}; there is nothing to draft.")
    item = _item(p.library_item_id)
    title = (body.title or item["title"]).strip()
    category = (body.category or item["suggested_category"]).strip().lower()
    if not title or not category:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "The risk needs a title and a category")
    score = calculate_risk_score(body.inherent_likelihood, body.inherent_impact)
    words = {"title": title, "description": body.description if body.description is not None else item["description"],
             "inherent_likelihood": body.inherent_likelihood, "inherent_impact": body.inherent_impact, "inherent_score": score}
    risk = p.risk
    try:
        custom = clean_record_values(db, p.tenant_id, "risks", body.custom_values, risk.custom_values if risk else None, creating=risk is None)
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc))
    if risk is None:
        risk = _risk_from_item(item, p.tenant_id, category, owner_id=p.owner_id, business_unit_id=p.business_unit_id,
                               custom_values=custom, **words)
        db.add(risk)
        db.flush()
        p.risk_id = risk.id
    else:
        before = risk_snapshot(risk)
        for field, value in {**words, "category": category, "risk_category": category, "custom_values": custom}.items():
            setattr(risk, field, value)
        record_risk_change(db, risk, before, current_user, reason=f"Redrafted after the risk team returned it: {p.review_comment or ''}".strip(),
                           label="Redrafted")
    p.status, p.drafted_by, p.drafted_at = "drafted", current_user.id, datetime.utcnow()
    by = current_user.display_name or current_user.username
    _notify(db, p, p.proposed_by, f"Draft sent for challenge: {title}",
            f"{by} confirmed \"{title}\" applies to {p.business_unit.name if p.business_unit else 'their area'} and drafted a score "
            f"of {score:g}. Challenge it, then accept it into the register or return it.")
    db.commit()
    db.refresh(p)
    return _one_out(db, p, current_user)


class Decline(BaseModel):
    reason: str = Field(..., max_length=2000)


@router.post("/proposals/{proposal_id}/decline")
def decline_proposal(proposal_id: int, body: Decline, db: Session = Depends(get_db), current_user: GRCUser = Depends(require_auth)):
    """The owner says the risk does not apply, and why; no register risk is made."""
    p = _proposal(db, current_user, proposal_id)
    _owner_only(p, current_user)
    if p.status != "proposed":
        raise HTTPException(status.HTTP_409_CONFLICT, f"This proposal is {p.status}; only a new proposal can be declined.")
    reason = body.reason.strip()
    if not reason:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Say why the risk does not apply")
    p.status, p.decline_reason = "declined", reason
    item = risk_library.find(p.library_item_id) or {"title": p.library_item_id}
    _notify(db, p, p.proposed_by, f"Proposal declined: {item['title']}",
            f"{current_user.display_name or current_user.username} declined \"{item['title']}\": {reason}")
    db.commit()
    db.refresh(p)
    return _one_out(db, p, current_user)


class Challenge(BaseModel):
    comment: Optional[str] = Field(None, max_length=4000)


def _ready_for_challenge(p: RiskLibraryProposal, user: GRCUser, what: str) -> None:
    if p.status != "drafted" or p.risk is None:
        raise HTTPException(status.HTTP_409_CONFLICT, f"This proposal is {p.status}; only a drafted risk can be challenged.")
    ensure_independent(p.drafted_by, user, what)


@router.post("/proposals/{proposal_id}/accept", dependencies=[CAN_CHALLENGE])
def accept_proposal(proposal_id: int, body: Challenge, db: Session = Depends(get_db), current_user: GRCUser = Depends(require_auth)):
    """The risk team accepts the draft into the register (Draft -> Open), by someone other than the person who drafted it; the
    library item's requirements and mapped controls are linked and the history names the item."""
    p = _proposal(db, current_user, proposal_id)
    _ready_for_challenge(p, current_user, "accept this risk into the register")
    item = _item(p.library_item_id)
    risk = p.risk
    before = risk_snapshot(risk)
    risk.status = "open"
    links = _link_library_controls(db, risk, item, p.control_codes, current_user.id)
    comment = (body.comment or "").strip() or None
    record_risk_change(db, risk, before, current_user,
                       reason=f"Accepted into the register from the Risk Library: {item['title']} ({item['id']})" + (f". {comment}" if comment else ""),
                       action="accepted_from_library", label="Accepted from the Risk Library")
    p.status, p.reviewed_by, p.reviewed_at, p.review_comment = "accepted", current_user.id, datetime.utcnow(), comment
    _notify(db, p, p.owner_id, f"Accepted into the register: {risk.title}",
            f"{current_user.display_name or current_user.username} accepted \"{risk.title}\" into the risk register (risk #{risk.id}).")
    db.commit()
    db.refresh(p)
    return {**_one_out(db, p, current_user), "linked_requirements": links["requirements"], "linked_controls": links["controls"]}


@router.post("/proposals/{proposal_id}/return", dependencies=[CAN_CHALLENGE])
def return_proposal(proposal_id: int, body: Challenge, db: Session = Depends(get_db), current_user: GRCUser = Depends(require_auth)):
    """The risk team sends the draft back to the owner with comments; it stays a draft."""
    p = _proposal(db, current_user, proposal_id)
    _ready_for_challenge(p, current_user, "return this draft")
    comment = (body.comment or "").strip()
    if not comment:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Say what the owner should look at again")
    p.status, p.reviewed_by, p.reviewed_at, p.review_comment = "returned", current_user.id, datetime.utcnow(), comment
    _notify(db, p, p.owner_id, f"Draft returned: {p.risk.title}",
            f"{current_user.display_name or current_user.username} returned \"{p.risk.title}\" with comments: {comment}")
    db.commit()
    db.refresh(p)
    return _one_out(db, p, current_user)


# ── add straight to the register (administrators) ────────────────────────────

class AddToRegister(BaseModel):
    """What the library cannot know: who owns the risk and how likely and severe it is for this organisation."""
    title: Optional[str] = Field(None, max_length=255)
    description: Optional[str] = None
    category: Optional[str] = Field(None, max_length=50)
    owner_id: int
    business_owner_id: Optional[int] = None
    team_id: Optional[int] = None
    inherent_likelihood: int = Field(..., ge=1, le=5)
    inherent_impact: int = Field(..., ge=1, le=5)
    residual_likelihood: Optional[int] = Field(None, ge=1, le=5)
    residual_impact: Optional[int] = Field(None, ge=1, le=5)
    status: Optional[str] = Field(None, max_length=50)   # older screens send "open"; the risk starts as a draft whatever is sent
    treatment_plan: Optional[str] = None
    review_date: Optional[datetime] = None
    priority: Optional[str] = None
    custom_values: Optional[dict] = None          # the tenant's own risk fields (Settings > Risk Register); required ones are checked
    control_codes: Optional[List[str]] = None     # which of the objective's controls to link: omitted = all of them, [] = none
    allow_duplicate: bool = False                 # add it again although this tenant's register already has it


@router.post("/{item_id}/add-to-register", status_code=status.HTTP_201_CREATED)
def add_to_register(
    item_id: str,
    body: AddToRegister,
    _perm: bool = Depends(require_tenant_permission("erm:risks:create", "erm:risks:edit")),
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """An administrator's shortcut past the owner's draft: the risk still starts as a Draft and joins the register only when
    someone else accepts it (the proposals' accept)."""
    if not is_tenant_admin(db, current_user):
        raise HTTPException(status.HTTP_403_FORBIDDEN,
                            "Only an administrator adds a library risk straight to the register. Propose it to the risk owner instead.")
    if body.status and body.status.strip().lower() not in ("open", DRAFT_STATUS):
        raise HTTPException(status.HTTP_400_BAD_REQUEST,
                            f"A library risk starts as a draft until the risk team accepts it; it cannot be added as {body.status.strip()}.")
    item = _item(item_id)
    tenant_id = _tenant(db, current_user)
    already = _in_register(db, [tenant_id], [item_id]).get(item_id)
    pending = _open_proposals(db, [tenant_id], [item_id]).get(item_id)
    if (already or pending) and not body.allow_duplicate:
        if already:
            raise HTTPException(status.HTTP_409_CONFLICT, f"This risk is already in the register (risk #{already['risk_id']}).")
        draft = pending[0]["risk_id"]
        raise HTTPException(status.HTTP_409_CONFLICT, f"This risk is already proposed{f' (draft risk #{draft})' if draft else ''}.")

    category = (body.category or item["suggested_category"]).strip().lower()      # the register's own rule: any category the tenant lists
    if not category:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "The risk needs a category")
    if (body.residual_likelihood is None) != (body.residual_impact is None):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Give both the residual likelihood and the residual impact, or neither")
    refuse_imported_accounts(db, [body.owner_id, body.business_owner_id])
    try:
        custom_values = clean_record_values(db, tenant_id, "risks", body.custom_values, creating=True)
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc))
    title = (body.title or item["title"]).strip()
    if not title:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "The risk needs a title")

    risk = _risk_from_item(
        item, tenant_id, category, title=title, custom_values=custom_values,
        description=(body.description if body.description is not None else item["description"]),
        owner_id=body.owner_id, business_owner_id=body.business_owner_id,
        business_unit_id=_resolve_team_to_business_unit(team_id=body.team_id, fallback_business_unit_id=None, tenant_id=tenant_id, db=db),
        inherent_likelihood=body.inherent_likelihood, inherent_impact=body.inherent_impact,
        inherent_score=calculate_risk_score(body.inherent_likelihood, body.inherent_impact),
        residual_likelihood=body.residual_likelihood, residual_impact=body.residual_impact,
        residual_score=(calculate_risk_score(body.residual_likelihood, body.residual_impact) if body.residual_likelihood is not None else None),
        priority=_clean_priority(body.priority), treatment_plan=body.treatment_plan, review_date=body.review_date,
    )
    db.add(risk)
    db.flush()
    p = RiskLibraryProposal(tenant_id=tenant_id, library_item_id=item_id, business_unit_id=risk.business_unit_id, owner_id=body.owner_id,
                            proposed_by=current_user.id, status="drafted", control_codes=body.control_codes, risk_id=risk.id,
                            drafted_by=current_user.id, drafted_at=datetime.utcnow())
    db.add(p)
    links = _link_library_controls(db, risk, item, body.control_codes, current_user.id)
    db.commit()
    db.refresh(risk)
    _, codes = _installed(db, [tenant_id], item["framework_key"])
    return {
        "risk": {"id": risk.id, "title": risk.title, "category": risk.category, "status": risk.status,
                 "inherent_score": risk.inherent_score, "priority": risk.effective_priority},
        "proposal": _one_out(db, p, current_user),
        "linked_controls": links["requirements"],
        "controls_not_installed": links["not_installed"],
        "library_risk": _shape(item, _in_register(db, [tenant_id], [item_id]), codes, _open_proposals(db, [tenant_id], [item_id])),
    }
