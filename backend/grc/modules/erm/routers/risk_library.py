"""Risk Library: browse the risks a standard lists, and move one into the risk register.

The library is shipped data (`services/risk_library.py`), the same for every tenant; this router only reads it, marks what the
caller's tenant already has in its register, and creates the register entry when a person adds one. The entry is a normal
register risk (`source_type` "risk_library", `source_reference` the library risk's id), so everything the register does with a
risk works on it. Adding a risk also links the controls of its objective that the tenant has installed (the framework library),
and takes the tenant's own custom risk fields, like the register's own form.
"""
from datetime import datetime
from typing import Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ....models import GRCUser, ParsedFrameworkControl, Risk, Tenant, get_db
from ....routers.auth_router import (
    get_user_primary_tenant, get_user_tenants, refuse_imported_accounts, require_auth, require_tenant_permission,
)
from ....services.module_settings import clean_record_values
from ..services import risk_framework_requirements as requirements
from ..services import risk_library
from .risks import _clean_priority, _resolve_team_to_business_unit, calculate_risk_score

router = APIRouter(prefix="/risk-library", tags=["ERM - Risk Library"])

CATEGORIES = ("strategic", "operational", "financial", "compliance", "technology", "third_party", "project_change", "internal")
# ^ the register's standard categories, which the library's suggestions come from; a tenant may keep its own category list, so a pop-up is not held to these
REGISTER_TYPE = {"uae_ia": "UAE IA"}            # what the register's Register type column says for a risk added from that library


def _in_register(db: Session, tenant_ids: List[int], ids: List[str]) -> Dict[str, dict]:
    """{library risk id: {risk_id, title, status, times}} for the ones this tenant already has in its register."""
    if not ids or not tenant_ids:
        return {}
    rows = (db.query(Risk).filter(Risk.tenant_id.in_(tenant_ids), Risk.source_type == risk_library.SOURCE_TYPE,
                                  Risk.source_reference.in_(ids)).order_by(Risk.id).all())
    out: Dict[str, dict] = {}
    for r in rows:
        mark = out.setdefault(r.source_reference, {"risk_id": r.id, "title": r.title, "status": r.status, "times": 0})
        mark["times"] += 1
    return out


def _installed(db: Session, tenant_ids: List[int], framework_key: str):
    """The tenant's installed copy of a library's framework and the control ids it holds: (framework or None, set of codes)."""
    lib = risk_library.library(framework_key)
    framework = requirements.find_framework(db, tenant_ids, framework_key, lib["framework"]["name"] if lib else None)
    return framework, (requirements.codes_installed(db, framework.id) if framework else set())


def _shape(item: dict, marks: Dict[str, dict], codes: Optional[set] = None) -> dict:
    out = {**item, "in_register": marks.get(item["id"])}
    if codes is not None:
        out["controls"] = [{**c, "installed": c["control_id"] in codes} for c in item["controls"]]
    return out


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
    installed, codes = _installed(db, tenants, key)
    return {
        "framework": next(f for f in available if f["key"] == key), "frameworks": available,
        "items": [_shape(r, marks, codes) for r in page], "total": len(everything), "skip": skip, "limit": limit,
        "in_register_total": len(marks), "facets": risk_library.facets(key),
        "installed_framework": {"id": installed.id, "name": installed.name} if installed else None,
    }


@router.get("/{item_id}")
def get_library_risk(item_id: str, db: Session = Depends(get_db), current_user: GRCUser = Depends(require_auth)):
    item = risk_library.find(item_id)
    if item is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "That risk is not in the library")
    tenants = get_user_tenants(current_user, db)
    _, codes = _installed(db, tenants, item["framework_key"])
    return _shape(item, _in_register(db, tenants, [item_id]), codes)


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
    status: Optional[str] = Field("open", max_length=50)
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
    item = risk_library.find(item_id)
    if item is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "That risk is not in the library")
    tenant_id = get_user_primary_tenant(current_user, db)
    if not tenant_id or db.query(Tenant.id).filter(Tenant.id == tenant_id).first() is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "User is not assigned to any tenant")
    already = _in_register(db, [tenant_id], [item_id]).get(item_id)
    if already and not body.allow_duplicate:
        raise HTTPException(status.HTTP_409_CONFLICT, f"This risk is already in the register (risk #{already['risk_id']}).")

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
    inherent = calculate_risk_score(body.inherent_likelihood, body.inherent_impact)
    residual = (calculate_risk_score(body.residual_likelihood, body.residual_impact)
                if body.residual_likelihood is not None else None)
    title = (body.title or item["title"]).strip()
    if not title:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "The risk needs a title")

    # which controls of the objective to link: the ones asked for (all when not said) that this tenant has installed
    asked = [c["control_id"] for c in item["controls"]] if body.control_codes is None else [
        c for c in body.control_codes if c in {x["control_id"] for x in item["controls"]}]
    framework, codes = _installed(db, [tenant_id], item["framework_key"])
    to_link = ([c for c in db.query(ParsedFrameworkControl).filter(ParsedFrameworkControl.uploaded_framework_id == framework.id,
                                                                  ParsedFrameworkControl.control_id.in_(asked))
                .order_by(ParsedFrameworkControl.id.asc())] if framework and asked else [])

    risk = Risk(
        tenant_id=tenant_id, title=title, description=(body.description if body.description is not None else item["description"]),
        category=category, risk_category=category, risk_sub_category=item["objective_title"][:100],
        register_type=REGISTER_TYPE.get(item["framework_key"]), custom_values=custom_values,
        owner_id=body.owner_id, business_owner_id=body.business_owner_id,
        business_unit_id=_resolve_team_to_business_unit(team_id=body.team_id, fallback_business_unit_id=None, tenant_id=tenant_id, db=db),
        inherent_likelihood=body.inherent_likelihood, inherent_impact=body.inherent_impact, inherent_score=inherent,
        residual_likelihood=body.residual_likelihood, residual_impact=body.residual_impact, residual_score=residual,
        status=body.status or "open", priority=_clean_priority(body.priority), treatment_plan=body.treatment_plan,
        review_date=body.review_date, source_type=risk_library.SOURCE_TYPE, source_reference=item_id,
    )
    db.add(risk)
    db.flush()
    linked = requirements.link_controls(db, risk, framework, to_link, "partial", None, current_user.id) if to_link else {"linked": [], "already": []}
    db.commit()
    db.refresh(risk)
    return {
        "risk": {"id": risk.id, "title": risk.title, "category": risk.category, "status": risk.status,
                 "inherent_score": risk.inherent_score, "priority": risk.effective_priority},
        "linked_controls": linked["linked"],
        "controls_not_installed": [c for c in asked if c not in codes],
        "library_risk": _shape(item, _in_register(db, [tenant_id], [item_id]), codes),
    }
