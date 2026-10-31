"""Risk Library: browse the risks a standard lists, and move one into the risk register.

The library is shipped data (`services/risk_library.py`), the same for every tenant; this router only reads it, marks what the
caller's tenant already has in its register, and creates the register entry when a person adds one. The entry is a normal
register risk (`source_type` "risk_library", `source_reference` the library risk's id), so everything the register does with a
risk works on it.
"""
from datetime import datetime
from typing import Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ....models import GRCUser, Risk, Tenant, get_db
from ....routers.auth_router import (
    get_user_primary_tenant, get_user_tenants, refuse_imported_accounts, require_auth, require_tenant_permission,
)
from ..services import risk_library
from .risks import _clean_priority, _resolve_team_to_business_unit, calculate_risk_score

router = APIRouter(prefix="/risk-library", tags=["ERM - Risk Library"])

CATEGORIES = ("strategic", "operational", "financial", "compliance", "technology", "third_party", "project_change", "internal")
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


def _shape(item: dict, marks: Dict[str, dict]) -> dict:
    return {**item, "in_register": marks.get(item["id"])}


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
                "facets": {"families": [], "objectives": []}}
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
    return {
        "framework": next(f for f in available if f["key"] == key), "frameworks": available,
        "items": [_shape(r, marks) for r in page], "total": len(everything), "skip": skip, "limit": limit,
        "in_register_total": len(marks), "facets": risk_library.facets(key),
    }


@router.get("/{item_id}")
def get_library_risk(item_id: str, db: Session = Depends(get_db), current_user: GRCUser = Depends(require_auth)):
    item = risk_library.find(item_id)
    if item is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "That risk is not in the library")
    return _shape(item, _in_register(db, get_user_tenants(current_user, db), [item_id]))


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
    status: Optional[str] = "open"
    treatment_plan: Optional[str] = None
    review_date: Optional[datetime] = None
    priority: Optional[str] = None
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

    category = (body.category or item["suggested_category"]).strip().lower()
    if category not in CATEGORIES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Category must be one of: {', '.join(CATEGORIES)}")
    if (body.residual_likelihood is None) != (body.residual_impact is None):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Give both the residual likelihood and the residual impact, or neither")
    refuse_imported_accounts(db, [body.owner_id, body.business_owner_id])
    inherent = calculate_risk_score(body.inherent_likelihood, body.inherent_impact)
    residual = (calculate_risk_score(body.residual_likelihood, body.residual_impact)
                if body.residual_likelihood is not None else None)
    title = (body.title or item["title"]).strip()
    if not title:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "The risk needs a title")

    risk = Risk(
        tenant_id=tenant_id, title=title, description=(body.description if body.description is not None else item["description"]),
        category=category, risk_category=category, risk_sub_category=item["objective_title"][:100],
        register_type=REGISTER_TYPE.get(item["framework_key"]),
        owner_id=body.owner_id, business_owner_id=body.business_owner_id,
        business_unit_id=_resolve_team_to_business_unit(team_id=body.team_id, fallback_business_unit_id=None, tenant_id=tenant_id, db=db),
        inherent_likelihood=body.inherent_likelihood, inherent_impact=body.inherent_impact, inherent_score=inherent,
        residual_likelihood=body.residual_likelihood, residual_impact=body.residual_impact, residual_score=residual,
        status=body.status or "open", priority=_clean_priority(body.priority), treatment_plan=body.treatment_plan,
        review_date=body.review_date, source_type=risk_library.SOURCE_TYPE, source_reference=item_id,
    )
    db.add(risk)
    db.commit()
    db.refresh(risk)
    return {
        "risk": {"id": risk.id, "title": risk.title, "category": risk.category, "status": risk.status,
                 "inherent_score": risk.inherent_score, "priority": risk.effective_priority},
        "library_risk": _shape(item, _in_register(db, [tenant_id], [item_id])),
    }
