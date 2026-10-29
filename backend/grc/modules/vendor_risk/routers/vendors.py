"""Vendor CRUD + dashboard endpoints."""

from typing import List, Optional
from datetime import datetime, timedelta
from pydantic import BaseModel, Field
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session, joinedload, object_session
from sqlalchemy import case, false, func, and_, or_

from ....models import (
    Vendor, VendorAssessment, VendorSLARecord, VendorIncident,
    GRCUser, Tenant, get_db,
    Evidence, TPRAEngagement, TPRAEvidenceLink, VendorQuestionnaireResponse,
)
from ....routers.auth_router import require_auth, get_user_tenants, refuse_imported_accounts
from ....services.module_settings import clean_record_values
from ..tpra import intake, rbac

router = APIRouter(tags=["Vendors"])


# ── Pydantic schemas ──────────────────────────────────────────────

class VendorCreate(BaseModel):
    # Deprecated & IGNORED — tenant is always derived from the auth context (TPRM-008).
    # Kept only so older clients that still send it don't 422.
    tenant_id: Optional[int] = None
    name: str = Field(..., min_length=1, max_length=255)
    description: Optional[str] = None
    tier: Optional[str] = "medium"
    status: Optional[str] = "active"
    vendor_type: Optional[str] = None
    industry: Optional[str] = None
    website: Optional[str] = None
    primary_contact_name: Optional[str] = None
    primary_contact_email: Optional[str] = None
    primary_contact_phone: Optional[str] = None
    contract_start_date: Optional[datetime] = None
    contract_end_date: Optional[datetime] = None
    contract_value: Optional[float] = None
    services_provided: Optional[list] = []
    data_access_level: Optional[str] = "none"
    data_types_accessed: Optional[list] = []
    geographic_locations: Optional[list] = []
    owner_id: Optional[int] = None
    business_unit_id: Optional[int] = None
    notes: Optional[str] = None
    # What the register slices by (see clean_register_fields): personal data, classification, where the data
    # lives, the systems touched, tags, and who else looks after the supplier.
    holds_personal_data: Optional[bool] = None
    data_classification: Optional[str] = None
    data_location: Optional[str] = None
    systems_in_scope: Optional[list] = None
    tags: Optional[list] = None
    security_owner_id: Optional[int] = None
    relationship_owner_id: Optional[int] = None
    # The tenant's own fields (services/module_settings.py, module "vendors").
    custom_values: Optional[dict] = None
    # Intake duplicate-relationship check: set True to create despite a name/website match.
    allow_duplicate: Optional[bool] = False


class VendorUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    tier: Optional[str] = None
    # Needed to change the tier of a vendor whose tier was computed (an override).
    tier_justification: Optional[str] = None
    status: Optional[str] = None
    vendor_type: Optional[str] = None
    industry: Optional[str] = None
    website: Optional[str] = None
    primary_contact_name: Optional[str] = None
    primary_contact_email: Optional[str] = None
    primary_contact_phone: Optional[str] = None
    contract_start_date: Optional[datetime] = None
    contract_end_date: Optional[datetime] = None
    contract_value: Optional[float] = None
    services_provided: Optional[list] = None
    data_access_level: Optional[str] = None
    data_types_accessed: Optional[list] = None
    geographic_locations: Optional[list] = None
    inherent_risk_score: Optional[float] = None
    residual_risk_score: Optional[float] = None
    risk_rating: Optional[str] = None
    owner_id: Optional[int] = None
    business_unit_id: Optional[int] = None
    notes: Optional[str] = None
    # TPRA additive fields (lifecycle_stage / trackers managed via dedicated endpoints)
    reassessment_cadence_days: Optional[int] = None
    contract_document_id: Optional[int] = None
    # The register fields, as on create; sent as null, one is cleared.
    holds_personal_data: Optional[bool] = None
    data_classification: Optional[str] = None
    data_location: Optional[str] = None
    systems_in_scope: Optional[list] = None
    tags: Optional[list] = None
    security_owner_id: Optional[int] = None
    relationship_owner_id: Optional[int] = None
    # Only the fields sent change; a field sent as null is cleared.
    custom_values: Optional[dict] = None


# ── Serializers ───────────────────────────────────────────────────

def _person(v: Vendor, user_id: Optional[int], people: Optional[dict] = None) -> Optional[dict]:
    """{id, full_name, email} of the person a plain-id field names, as `owner` is given; None when none is named.
    `people` is {id: user} already loaded (a page of the register); else the supplier's session is asked."""
    if not user_id:
        return None
    user = (people or {}).get(user_id)
    session = object_session(v)
    if user is None and session is not None:
        user = session.get(GRCUser, user_id)
    return {"id": user.id, "full_name": user.display_name or user.username, "email": user.email} if user else None


def serialize_vendor(v: Vendor, include_counts: bool = False, people: Optional[dict] = None) -> dict:
    data = {
        "id": v.id,
        "tenant_id": v.tenant_id,
        "name": v.name,
        "description": v.description,
        "tier": v.tier,
        "status": v.status,
        "vendor_type": v.vendor_type,
        "industry": v.industry,
        "website": v.website,
        "primary_contact_name": v.primary_contact_name,
        "primary_contact_email": v.primary_contact_email,
        "primary_contact_phone": v.primary_contact_phone,
        "contract_start_date": v.contract_start_date.isoformat() if v.contract_start_date else None,
        "contract_end_date": v.contract_end_date.isoformat() if v.contract_end_date else None,
        "contract_value": v.contract_value,
        "services_provided": v.services_provided or [],
        "data_access_level": v.data_access_level,
        "data_types_accessed": v.data_types_accessed or [],
        "geographic_locations": v.geographic_locations or [],
        "inherent_risk_score": v.inherent_risk_score,
        "residual_risk_score": v.residual_risk_score,
        "risk_rating": v.risk_rating,
        "owner_id": v.owner_id,
        "business_unit_id": v.business_unit_id,
        "notes": v.notes,
        # ── TPRA lifecycle (additive) ──
        "lifecycle_stage": getattr(v, "lifecycle_stage", None) or "intake",
        "active_assessment_id": getattr(v, "active_assessment_id", None),     # General's
        "lifecycle_history": getattr(v, "lifecycle_history", None) or [],
        "reassessment_cadence_days": getattr(v, "reassessment_cadence_days", None),
        "next_reassessment_date": (
            v.next_reassessment_date.isoformat() if getattr(v, "next_reassessment_date", None) else None
        ),
        "contract_document_id": getattr(v, "contract_document_id", None),
        "offboarding_checklist": getattr(v, "offboarding_checklist", None) or [],
        "remediation_actions": getattr(v, "remediation_actions", None) or [],
        # Set when the vendor came in as an onboarding request (tpra/onboarding.py).
        "intake_status": getattr(v, "intake_status", None),
        "custom_values": getattr(v, "custom_values", None) or {},
        "vat_number": getattr(v, "vat_number", None), "vat_check": getattr(v, "vat_check", None),
        # What the register slices by; null is "not recorded".
        "holds_personal_data": v.holds_personal_data,
        "data_classification": v.data_classification,
        "data_location": v.data_location,
        "systems_in_scope": v.systems_in_scope or [],
        "tags": v.tags or [],
        "security_owner_id": v.security_owner_id,
        "relationship_owner_id": v.relationship_owner_id,
        "security_owner": _person(v, v.security_owner_id, people),
        "relationship_owner": _person(v, v.relationship_owner_id, people),
        "business_unit": {"id": v.business_unit.id, "name": v.business_unit.name} if v.business_unit else None,
        # Set while the supplier is archived (DELETE /vendors/{id}); POST /vendors/{id}/restore clears it.
        "archived_at": v.deleted_at.isoformat() if getattr(v, "deleted_at", None) else None,
        "created_at": v.created_at.isoformat() if v.created_at else None,
        "updated_at": v.updated_at.isoformat() if v.updated_at else None,
    }
    if include_counts:
        data["assessments_count"] = len(v.assessments) if v.assessments else 0
        data["incidents_count"] = len(v.incidents) if v.incidents else 0
        data["sla_records_count"] = len(v.sla_records) if v.sla_records else 0
    if v.owner:
        data["owner"] = {"id": v.owner.id, "full_name": v.owner.display_name or v.owner.username, "email": v.owner.email}
    return data


# ── The register's notes: open engagements, and the one thing to do next ───

# code: (what the register says, where on the supplier's page). The first that holds wins.
NEXT_ACTIONS = {
    "suspended": ("Suspended", "?stage=findings"),
    "reassessment_overdue": ("Reassessment overdue", "?stage=reassessment"),
    "not_tiered": ("Needs tiering", "?stage=tiering"),
    "awaiting_approval": ("Awaiting approval", "?stage=approval"),
    "response_to_review": ("Answers to review", "?stage=questionnaire"),
    "documents_expired": ("Documents expired", "?tab=paperwork"),
    "weak_grade": ("Weak grade", "?stage=scoring"),
    "no_owner": ("No owner", ""),
    "reassessment_due": ("Reassessment due", "?stage=reassessment"),
    "offboarding": ("Finish offboarding", "?stage=reassessment"),
}
DUE_SOON_DAYS = 30
_OUT_OF_USE = ("retired", "inactive", "terminated", "requested", "rejected")


def _day(value):
    return value.date() if isinstance(value, datetime) else value


def _next(v: Vendor, code: str, engagement_id: Optional[int] = None, label: Optional[str] = None) -> dict:
    words, where = NEXT_ACTIONS[code]
    link = f"/vendor-risk/vendors/{v.id}{where}"
    if engagement_id:
        link += f"{'&' if '?' in link else '?'}engagement={engagement_id}"
    return {"code": code, "label": label or words, "link": link}


def next_action(v: Vendor, today, engagements: list, active: list, to_review: set, expired: set) -> Optional[dict]:
    """The one thing to do next on a supplier, or None: nothing waits, or it is
    archived, a request nobody has picked up, or out of use. An offboarded supplier
    has one thing left, finishing it."""
    status = (v.status or "").lower()
    if v.deleted_at is not None or (v.intake_status or "") in ("draft", "submitted", "rejected"):
        return None
    if status == "offboarded":
        return _next(v, "offboarding")
    if status in _OUT_OF_USE:
        return None
    # The earliest review of General's and of each open engagement's, and whose it is.
    dates = sorted(((d, eid) for d, eid in [(_day(v.next_reassessment_date), None),
                                            *((_day(e.next_reassessment_date), e.id) for e in engagements)] if d),
                   key=lambda pair: pair[0])
    review, review_of = dates[0] if dates else (None, None)
    approval = next((a for a in active if a.current_stage == "approval"), None)
    graded = max((a for a in active if a.rating_grade), key=lambda a: a.rating_grade, default=None)
    if status == "suspended":
        return _next(v, "suspended")
    if review is not None and review < today:
        return _next(v, "reassessment_overdue", review_of)
    if v.inherent_risk_score is None and not any(a.inherent_tier for a in active):
        return _next(v, "not_tiered")
    if approval is not None:
        return _next(v, "awaiting_approval", approval.engagement_id)
    if v.id in to_review:
        return _next(v, "response_to_review")
    if v.id in expired:
        return _next(v, "documents_expired")
    if graded is not None and graded.rating_grade >= "D":
        return _next(v, "weak_grade", graded.engagement_id, f"Weak grade {graded.rating_grade}")
    if not v.owner_id:
        return _next(v, "no_owner")
    if review is not None and review <= today + timedelta(days=DUE_SOON_DAYS):
        return _next(v, "reassessment_due", review_of)
    return None


def _grade(rows: list) -> dict:
    """A supplier's grade: the worst (A best, F worst) of its active assessments, with that one's residual score."""
    worst = max((a for a in rows if a.rating_grade), key=lambda a: (a.rating_grade, a.residual_score or 0.0),
                default=None)
    return {"grade": worst.rating_grade if worst else None,
            "grade_score": round(worst.residual_score, 1) if worst and worst.residual_score is not None else None}


def register_notes(db: Session, vendors: List[Vendor], today=None) -> dict:
    """{supplier id: {open_engagements, next_action, grade, grade_score}} for suppliers of the register,
    from five queries however many."""
    from ..tpra.paperwork import _RETIRED, ends_on

    today = today or datetime.utcnow().date()
    ids = [v.id for v in vendors] or [-1]
    engagements, active = {}, {}
    for e in (db.query(TPRAEngagement)
              .filter(TPRAEngagement.vendor_id.in_(ids), TPRAEngagement.is_general.is_(False),
                      TPRAEngagement.status != "ended")
              .order_by(TPRAEngagement.id)):
        engagements.setdefault(e.vendor_id, []).append(e)
    for a in (db.query(VendorAssessment)
              .filter(VendorAssessment.vendor_id.in_(ids), VendorAssessment.lifecycle_status == "active",
                      VendorAssessment.deleted_at.is_(None))
              .order_by(VendorAssessment.id)):
        active.setdefault(a.vendor_id, []).append(a)
    to_review = {vid for (vid,) in db.query(VendorQuestionnaireResponse.vendor_id).filter(
        VendorQuestionnaireResponse.vendor_id.in_(ids),
        VendorQuestionnaireResponse.status.in_(("submitted", "under_review")))}
    # A document's first live link speaks for it, as on the supplier's Paperwork tab.
    seen, expired = set(), set()
    for link, ev in (db.query(TPRAEvidenceLink, Evidence).join(Evidence, Evidence.id == TPRAEvidenceLink.evidence_id)
                     .filter(TPRAEvidenceLink.vendor_id.in_(ids), TPRAEvidenceLink.deleted_at.is_(None))
                     .order_by(TPRAEvidenceLink.id)):
        if (link.vendor_id, ev.id) in seen or (ev.status or "").lower() in _RETIRED:
            continue
        seen.add((link.vendor_id, ev.id))
        end = ends_on(link, ev)
        if end is not None and end < today:
            expired.add(link.vendor_id)
    return {v.id: {"open_engagements": len(engagements.get(v.id, [])),
                   "next_action": next_action(v, today, engagements.get(v.id, []), active.get(v.id, []),
                                              to_review, expired),
                   **_grade(active.get(v.id, []))}
            for v in vendors}


# ── Helper ────────────────────────────────────────────────────────

def get_vendor_or_404(vendor_id: int, tenant_ids: List[int], db: Session) -> Vendor:
    vendor = db.query(Vendor).filter(
        Vendor.id == vendor_id,
        Vendor.tenant_id.in_(tenant_ids),
    ).first()
    if not vendor:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Vendor not found")
    return vendor


# ── The register: its order, and the fields it slices by ───────────

SORTS = "risk|name|tier|status|grade|owner|next_reassessment|annual_value"
CLASSIFICATIONS = ("public", "internal", "confidential", "restricted")
# Worst first, as for tiers: what needs a person before what is simply running.
_STATUS_RANK = {"suspended": 0, "offboarded": 1, "terminated": 2, "requested": 3, "onboarding": 4, "active": 5,
                "inactive": 6, "retired": 7, "rejected": 8}
# Worst tier first. A supplier with no inherent score has had no tier decision: it ranks right after critical, an
# unanswered question rather than the least urgent row.
# ponytail: "no inherent score" stands for next_action's not_tiered, which also reads the active assessments' tiers.
_TIER_RANK = case((Vendor.tier == "critical", 0), (Vendor.inherent_risk_score.is_(None), 1), (Vendor.tier == "high", 2),
                  (Vendor.tier == "medium", 3), (Vendor.tier == "low", 4), else_=5)


def _order(sort: Optional[str], descending: bool) -> list:
    """The register's ORDER BY. Without a sort it is newest first, as it always was. Absent values sort last whichever
    way; the name and then the id end every order, so pages never overlap or skip a supplier (an import creates many
    at once)."""
    def by(column):
        return column.desc().nullslast() if descending else column.asc().nullslast()

    name = func.lower(Vendor.name)
    if sort is None:
        return [Vendor.created_at.desc(), Vendor.id.desc()]
    if sort == "risk":                    # worst tier first, and within a tier the ones nobody owns
        return [by(_TIER_RANK), by(case((Vendor.owner_id.is_(None), 0), else_=1)), by(name), by(Vendor.id)]
    column = {"name": name, "tier": _TIER_RANK, "status": case(_STATUS_RANK, value=Vendor.status, else_=9),
              "owner": func.lower(func.coalesce(GRCUser.display_name, GRCUser.username)),
              "next_reassessment": Vendor.next_reassessment_date, "annual_value": Vendor.contract_value}[sort]
    return [by(column), name.asc(), Vendor.id.asc()]


def _many(values: Optional[List[str]]) -> List[str]:
    """Repeated query values, or comma-separated ones, once each."""
    return list(dict.fromkeys(p.strip() for v in values or [] for p in v.split(",") if p.strip()))


def _words(values, what: str, most: int, longest: int) -> Optional[list]:
    """A list of short names, tidied and once each; None clears."""
    if values is None:
        return None
    if not isinstance(values, list) or not all(isinstance(v, str) for v in values):
        raise HTTPException(status_code=400, detail=f"{what} must be a list of names")
    out = list(dict.fromkeys(" ".join(v.split()) for v in values if v.strip()))
    if len(out) > most or any(len(v) > longest for v in out):
        raise HTTPException(status_code=400, detail=f"{what}: at most {most}, each up to {longest} characters")
    return out


def clean_register_fields(db: Session, data: dict, current: Optional[Vendor] = None) -> dict:
    """The register fields present in a create or update payload, checked and tidied (HTTP 400 when one is not
    valid); only those are returned. An owner has to be an active user who signs in here, as the business owner does;
    the one already on the record may be sent back as it is."""
    out = {}
    if "holds_personal_data" in data:
        out["holds_personal_data"] = data["holds_personal_data"]
    if "data_classification" in data:
        value = " ".join(str(data["data_classification"] or "").split()).lower()
        if value and value not in CLASSIFICATIONS:
            raise HTTPException(status_code=400,
                                detail=f"Data classification has to be one of: {', '.join(CLASSIFICATIONS)}")
        out["data_classification"] = value or None
    if "data_location" in data:
        value = " ".join(str(data["data_location"] or "").split())
        if len(value) > 255:
            raise HTTPException(status_code=400, detail="Data location can be at most 255 characters")
        out["data_location"] = value or None
    for key, what, most, longest in (("systems_in_scope", "Systems in scope", 50, 100), ("tags", "Tags", 30, 40)):
        if key in data:
            out[key] = _words(data[key], what, most, longest)
    owners = {k: data[k] for k in ("security_owner_id", "relationship_owner_id") if k in data}
    if owners:
        kept = [getattr(current, k, None) for k in owners]
        named = [i for i in owners.values() if i]
        refuse_imported_accounts(db, named, kept=kept)
        active = {uid for (uid,) in db.query(GRCUser.id).filter(GRCUser.id.in_(named or [-1]),
                                                                  GRCUser.is_active.is_(True))}
        if any(i not in active and i not in kept for i in named):
            raise HTTPException(status_code=400, detail="Choose an active user of this platform")
        out.update(owners)
    return out


# ── Endpoints ─────────────────────────────────────────────────────

@router.get("/vendors")
def list_vendors(
    tier: Optional[List[str]] = Query(None, description="Tier: critical, high, medium, low; repeat for several"),
    vendor_status: Optional[List[str]] = Query(None, alias="status", description="Status; repeat for several"),
    search: Optional[str] = Query(None, description="Search by name"),
    vendor_type: Optional[str] = Query(None),
    data_access_level: Optional[str] = Query(None),
    attention: Optional[List[str]] = Query(
        None, description="The next action a supplier waits on (NEXT_ACTIONS codes), or none; repeat for several"),
    owner: Optional[str] = Query(None, description="Business owner: me, unassigned, or a user id"),
    holds_personal_data: Optional[bool] = Query(None),
    business_unit_id: Optional[List[int]] = Query(None),
    sort: Optional[str] = Query(None, pattern=f"^({SORTS})$",
                                description="Order by: risk, name, tier, status, grade, owner, next_reassessment, "
                                            "annual_value. Without it: newest first"),
    direction: str = Query("asc", alias="dir", pattern="^(asc|desc)$"),
    # Archived suppliers, and onboarding requests not yet picked up (or turned down), are not suppliers in use: left
    # out unless asked for. A request in review is a supplier being onboarded and is listed.
    include_archived: bool = Query(False, description="Also list archived suppliers"),
    archived_only: bool = Query(False, description="List only the archived suppliers (the register's Archived view)"),
    include_requests: bool = Query(False, description="Also list requests not yet in review, and turned-down ones"),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, description="Page size; page with skip until `total` is reached"),
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    tenant_ids = get_user_tenants(current_user, db)
    if not tenant_ids:
        return {"items": [], "total": 0, "skip": skip, "limit": limit}

    query = db.query(Vendor).options(
        joinedload(Vendor.owner), joinedload(Vendor.business_unit),
    ).filter(Vendor.tenant_id.in_(tenant_ids))

    if archived_only:
        query = query.filter(Vendor.deleted_at.isnot(None))
    elif not include_archived:
        query = query.filter(Vendor.deleted_at.is_(None))
    if not include_requests:
        query = query.filter(or_(Vendor.intake_status.is_(None), Vendor.intake_status.in_(("in_review", "approved"))))
    tiers, statuses = _many(tier), _many(vendor_status)
    if tiers:
        query = query.filter(Vendor.tier.in_(tiers))
    if statuses:
        query = query.filter(Vendor.status.in_(statuses))
    if vendor_type:
        query = query.filter(Vendor.vendor_type == vendor_type)
    if data_access_level:
        query = query.filter(Vendor.data_access_level == data_access_level)
    if search:
        query = query.filter(Vendor.name.ilike(f"%{search}%"))
    if owner:
        if owner == "unassigned":
            query = query.filter(Vendor.owner_id.is_(None))
        elif owner == "me":
            query = query.filter(Vendor.owner_id == current_user.id)
        elif owner.isdecimal():
            query = query.filter(Vendor.owner_id == int(owner))
        else:                              # a link edited by hand names nobody: an empty register is the honest answer
            query = query.filter(false())
    if holds_personal_data is not None:
        query = query.filter(Vendor.holds_personal_data.is_(holds_personal_data))
    if business_unit_id:
        query = query.filter(Vendor.business_unit_id.in_(business_unit_id))
    if sort == "owner":
        query = query.outerjoin(GRCUser, GRCUser.id == Vendor.owner_id)

    codes, descending = _many(attention), direction == "desc"
    if not codes and sort != "grade":
        total = query.count()
        vendors = query.order_by(*_order(sort, descending)).offset(skip).limit(limit).all()
        notes = register_notes(db, vendors)
    else:
        # ponytail: next action and grade are worked out in Python over the whole filtered set; move into SQL past a few thousand suppliers.
        vendors = query.order_by(*(_order("name", False) if sort == "grade" else _order(sort, descending))).all()
        notes = register_notes(db, vendors)
        if codes:
            vendors = [v for v in vendors if ((notes[v.id]["next_action"] or {}).get("code") or "none") in codes]
        if sort == "grade":                # A best to F worst; ungraded last either way, ties stay by name
            graded = sorted((v for v in vendors if notes[v.id]["grade"]), key=lambda v: notes[v.id]["grade"],
                            reverse=descending)
            vendors = graded + [v for v in vendors if not notes[v.id]["grade"]]
        total = len(vendors)
        vendors = vendors[skip:skip + limit]

    named = {i for v in vendors for i in (v.security_owner_id, v.relationship_owner_id) if i}
    people = {u.id: u for u in db.query(GRCUser).filter(GRCUser.id.in_(named))} if named else {}
    return {
        "items": [{**serialize_vendor(v, people=people), **notes[v.id]} for v in vendors],
        "total": total,
        "skip": skip,
        "limit": limit,
    }


@router.post("/vendors", status_code=status.HTTP_201_CREATED)
def create_vendor(
    payload: VendorCreate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    rbac.require_write(db, current_user, "vendors", "create")
    tenant_ids = get_user_tenants(current_user, db)
    if not tenant_ids:
        raise HTTPException(status_code=403, detail="User not associated with any tenant")

    # TPRM-008: the tenant is ALWAYS derived from the authenticated context — the
    # request body's tenant_id is never trusted (it can't target another tenant).
    tenant_id = tenant_ids[0]

    # Intake (Stage 01): check for an existing / duplicate relationship before
    # committing. Matches on the name without case, punctuation or legal form, or
    # on the website's host. Caller can override with allow_duplicate=True (e.g. a
    # genuine second contract).
    if not payload.allow_duplicate:
        existing = intake.duplicate(db, tenant_id, payload.name, payload.website)
        if existing:
            where = "is archived" if existing.deleted_at else "already exists"
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"A vendor named “{existing.name}” {where} (ID {existing.id}). It may be the same relationship.",
            )

    try:
        custom_values = clean_record_values(db, tenant_id, "vendors", payload.custom_values, creating=True)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    refuse_imported_accounts(db, [payload.owner_id])
    register = clean_register_fields(db, payload.model_dump(exclude_unset=True))
    vendor = Vendor(
        tenant_id=tenant_id,
        custom_values=custom_values,
        **register,
        name=payload.name,
        description=payload.description,
        tier=payload.tier,
        status=payload.status,
        vendor_type=payload.vendor_type,
        industry=payload.industry,
        website=payload.website,
        primary_contact_name=payload.primary_contact_name,
        primary_contact_email=payload.primary_contact_email,
        primary_contact_phone=payload.primary_contact_phone,
        contract_start_date=payload.contract_start_date,
        contract_end_date=payload.contract_end_date,
        contract_value=payload.contract_value,
        services_provided=payload.services_provided,
        data_access_level=payload.data_access_level,
        data_types_accessed=payload.data_types_accessed,
        geographic_locations=payload.geographic_locations,
        owner_id=payload.owner_id,
        business_unit_id=payload.business_unit_id,
        notes=payload.notes,
    )
    db.add(vendor)
    db.commit()
    db.refresh(vendor)
    return serialize_vendor(vendor)


@router.get("/vendors/dashboard")
def vendor_dashboard(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    tenant_ids = get_user_tenants(current_user, db)
    if not tenant_ids:
        return {"total_vendors": 0}

    # Archived suppliers are not counted anywhere on the dashboard.
    live = and_(Vendor.tenant_id.in_(tenant_ids), Vendor.deleted_at.is_(None))
    base = db.query(Vendor).filter(live)

    total = base.count()

    # By tier
    by_tier_rows = (
        db.query(Vendor.tier, func.count(Vendor.id))
        .filter(live)
        .group_by(Vendor.tier)
        .all()
    )
    by_tier = {row[0] or "unset": row[1] for row in by_tier_rows}

    # By status
    by_status_rows = (
        db.query(Vendor.status, func.count(Vendor.id))
        .filter(live)
        .group_by(Vendor.status)
        .all()
    )
    by_status = {row[0] or "unset": row[1] for row in by_status_rows}

    # Expiring contracts (next 30 days)
    now = datetime.utcnow()
    threshold = now + timedelta(days=30)
    expiring = (
        base.filter(
            Vendor.contract_end_date != None,
            Vendor.contract_end_date >= now,
            Vendor.contract_end_date <= threshold,
        )
        .order_by(Vendor.contract_end_date.asc())
        .limit(10)
        .all()
    )

    # Average risk score
    avg_inherent = (
        db.query(func.avg(Vendor.inherent_risk_score))
        .filter(
            live,
            Vendor.inherent_risk_score != None,
        )
        .scalar()
    )
    avg_residual = (
        db.query(func.avg(Vendor.residual_risk_score))
        .filter(
            live,
            Vendor.residual_risk_score != None,
        )
        .scalar()
    )

    # Recent assessments
    recent_assessments = (
        db.query(VendorAssessment)
        .options(joinedload(VendorAssessment.vendor))
        .join(Vendor, Vendor.id == VendorAssessment.vendor_id)
        .filter(VendorAssessment.tenant_id.in_(tenant_ids), Vendor.deleted_at.is_(None))
        .order_by(VendorAssessment.created_at.desc())
        .limit(5)
        .all()
    )

    # Open incidents count
    open_incidents = (
        db.query(func.count(VendorIncident.id))
        .join(Vendor, Vendor.id == VendorIncident.vendor_id)
        .filter(
            VendorIncident.tenant_id.in_(tenant_ids),
            VendorIncident.status.in_(["open", "investigating"]),
            Vendor.deleted_at.is_(None),
        )
        .scalar()
    )

    return {
        "total_vendors": total,
        "by_tier": by_tier,
        "by_status": by_status,
        "expiring_contracts": [
            {
                "id": v.id,
                "name": v.name,
                "tier": v.tier,
                "contract_end_date": v.contract_end_date.isoformat() if v.contract_end_date else None,
            }
            for v in expiring
        ],
        "avg_inherent_risk_score": round(avg_inherent, 2) if avg_inherent else None,
        "avg_residual_risk_score": round(avg_residual, 2) if avg_residual else None,
        "recent_assessments": [
            {
                "id": a.id,
                "vendor_id": a.vendor_id,
                "vendor_name": a.vendor.name if a.vendor else None,
                "assessment_type": a.assessment_type,
                "status": a.status,
                "risk_rating": a.risk_rating,
                "created_at": a.created_at.isoformat() if a.created_at else None,
            }
            for a in recent_assessments
        ],
        "open_incidents": open_incidents or 0,
    }


@router.get("/vendors/{vendor_id}")
def get_vendor(
    vendor_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    tenant_ids = get_user_tenants(current_user, db)
    if not tenant_ids:
        raise HTTPException(status_code=403, detail="User not associated with any tenant")

    vendor = (
        db.query(Vendor)
        .options(
            joinedload(Vendor.owner),
            joinedload(Vendor.assessments),
            joinedload(Vendor.incidents),
            joinedload(Vendor.sla_records),
        )
        .filter(Vendor.id == vendor_id, Vendor.tenant_id.in_(tenant_ids))
        .first()
    )
    if not vendor:
        raise HTTPException(status_code=404, detail="Vendor not found")

    return serialize_vendor(vendor, include_counts=True)


@router.put("/vendors/{vendor_id}")
def update_vendor(
    vendor_id: int,
    payload: VendorUpdate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    rbac.require_write(db, current_user, "vendors", "edit")
    tenant_ids = get_user_tenants(current_user, db)
    if not tenant_ids:
        raise HTTPException(status_code=403, detail="User not associated with any tenant")

    vendor = get_vendor_or_404(vendor_id, tenant_ids, db)

    update_data = payload.model_dump(exclude_unset=True)
    refuse_imported_accounts(db, [update_data.get("owner_id")], kept=[vendor.owner_id])
    update_data.update(clean_register_fields(db, update_data, vendor))
    if "custom_values" in update_data:
        try:
            vendor.custom_values = clean_record_values(db, vendor.tenant_id, "vendors", update_data.pop("custom_values"),
                                                       current=vendor.custom_values, creating=False)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc))
    justification = " ".join((update_data.pop("tier_justification", None) or "").split())
    from ..tpra import service as tpra_service
    # Changing the tier of a vendor whose tier was computed is an override: it
    # needs a reason, and goes on the audit trail with what the engine said.
    new_tier = update_data.get("tier")
    if new_tier and new_tier != vendor.tier and vendor.inherent_risk_score is not None:
        active = tpra_service.get_active_assessment(db, vendor)
        if active is not None and active.inherent_tier:
            if len(justification) < 10:
                raise HTTPException(status_code=400,
                                    detail="This vendor's tier was computed. Explain why it should change.")
            tpra_service.record_tier_override(db, vendor, active, new_tier, justification, current_user.id)
            update_data.pop("tier")
    if update_data.get("status") == "offboarded" and (vendor.status or "").lower() != "offboarded":
        from .lifecycle import start_offboarding       # offboarding closes the supplier's side, however it starts
        start_offboarding(db, vendor, current_user.id, "Status set to offboarded")
    for key, value in update_data.items():
        setattr(vendor, key, value)
    # A supplier split into engagements keeps General's tier and scores on its General
    # row and shows the worst of its engagements: an edit here is General's.
    general = tpra_service.general_row(db, vendor)
    scores = {k: update_data[k] for k in ("tier", "inherent_risk_score", "residual_risk_score", "risk_rating")
              if k in update_data}
    if general is not None and scores:
        for key, value in scores.items():
            setattr(general, key, value)
        tpra_service.recache(db, vendor)

    vendor.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(vendor)
    return serialize_vendor(vendor)


@router.delete("/vendors/{vendor_id}")
def delete_vendor(
    vendor_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """Archive the supplier: it leaves the register, dashboards, queues and reminders, and everything recorded about
    it (assessments, questionnaires, SLAs, incidents, findings) stays readable. A supplier carries history, so it is
    never hard-deleted; restore brings it back as it was."""
    rbac.require_write(db, current_user, "vendors", "delete")
    tenant_ids = get_user_tenants(current_user, db)
    if not tenant_ids:
        raise HTTPException(status_code=403, detail="User not associated with any tenant")

    vendor = get_vendor_or_404(vendor_id, tenant_ids, db)
    if vendor.deleted_at is None:
        archive_vendor(db, vendor, current_user.id)
        db.commit()
    return {"message": f"Vendor '{vendor.name}' archived", "archived_at": vendor.deleted_at.isoformat()}


def archive_vendor(db: Session, vendor: Vendor, actor_id: Optional[int], reason: Optional[str] = None) -> None:
    """Archive the supplier (once), on its audit trail. The caller commits."""
    if vendor.deleted_at is None:
        from ..tpra.service import write_audit
        vendor.deleted_at = datetime.utcnow()
        write_audit(db, vendor.tenant_id, entity="vendor", action="archive", vendor_id=vendor.id,
                    entity_id=vendor.id, actor_id=actor_id, reason=reason)


@router.post("/vendors/{vendor_id}/restore")
def restore_vendor(
    vendor_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """Bring an archived supplier back, as it was when it was archived."""
    rbac.require_write(db, current_user, "vendors", "delete")
    tenant_ids = get_user_tenants(current_user, db)
    if not tenant_ids:
        raise HTTPException(status_code=403, detail="User not associated with any tenant")

    vendor = get_vendor_or_404(vendor_id, tenant_ids, db)
    if vendor.deleted_at is not None:
        from ..tpra.service import write_audit
        vendor.deleted_at = None
        write_audit(db, vendor.tenant_id, entity="vendor", action="restore", vendor_id=vendor.id,
                    entity_id=vendor.id, actor_id=current_user.id)
        db.commit()
        db.refresh(vendor)
    return serialize_vendor(vendor)
