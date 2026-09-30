"""TPRA screening API — key people + World-Check One screening & resolution.

Mounted under /vendor-risk/tpra (additive; new paths only). Key people and
screening results are PII, so reads need a screening/vendor permission (unlike
the auth-only lifecycle reads). Resolving a match is a compliance decision and
needs the dedicated `vendor_risk:screening:resolve` (no generic fallback),
mirroring approvals.
"""
from __future__ import annotations

from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import desc, func
from sqlalchemy.orm import Session

from ....models import (
    get_db, GRCUser, Vendor, TPRAVendorPerson, TPRAScreeningSubject, TPRAScreeningMatch,
    TPRAFinding, TR_PROVIDER_WC1,
)
from ....routers.auth_router import require_auth, get_user_tenants
from ....integrations_tr import connections, registry
from ....integrations_tr.http import ProviderError
from . import rbac, screening

router = APIRouter(prefix="/tpra", tags=["TPRA Screening"])

_VIEW_PERMS = ["vendor_risk:screening:view", "vendor_risk:screening:run", "vendor_risk:screening:resolve",
               "erm:risks:edit"]
PERSON_ROLES = ("director", "ubo", "key_contact", "signatory", "other")


# ── helpers ──────────────────────────────────────────────────────────────────

def _tids(user: GRCUser, db: Session) -> List[int]:
    tids = get_user_tenants(user, db)
    if not tids:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "No tenant context")
    return tids


def _vendor(db: Session, vendor_id: int, tids: List[int]) -> Vendor:
    v = db.query(Vendor).filter(Vendor.id == vendor_id, Vendor.tenant_id.in_(tids),
                                Vendor.deleted_at.is_(None)).first()
    if not v:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Vendor not found")
    return v


def _require_view(db: Session, user: GRCUser) -> None:
    if not rbac.user_has_any_permission(db, user, _VIEW_PERMS):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Permission denied — requires vendor_risk:screening:view")


def _conn_state(db: Session, tenant_id: int) -> dict:
    c = connections.get_connection(db, tenant_id, TR_PROVIDER_WC1)
    if c is None:
        return {"configured": False, "active": False, "mode": None, "status": "not_configured"}
    return {"configured": True, "active": bool(c.is_active), "mode": c.mode, "status": c.status,
            "last_error": c.last_error}


def _provider_http(e: Exception) -> HTTPException:
    if isinstance(e, connections.NotConfigured):
        return HTTPException(status.HTTP_409_CONFLICT, str(e))
    if isinstance(e, screening.ScreeningError):
        return HTTPException(status.HTTP_400_BAD_REQUEST, str(e))
    return HTTPException(status.HTTP_502_BAD_GATEWAY, f"World-Check One: {e}")


# ── serializers ──────────────────────────────────────────────────────────────

def s_person(p: TPRAVendorPerson) -> dict:
    return {
        "id": p.id, "vendor_id": p.vendor_id, "full_name": p.full_name, "role": p.role,
        "ownership_pct": p.ownership_pct, "date_of_birth": p.date_of_birth, "nationality": p.nationality,
        "country_location": p.country_location, "gender": p.gender,
        "include_in_screening": bool(p.include_in_screening), "row_version": p.row_version,
        "deleted_at": p.deleted_at, "created_at": p.created_at, "updated_at": p.updated_at,
    }


def s_subject(s: TPRAScreeningSubject, counts: Optional[dict] = None) -> dict:
    return {
        "id": s.id, "vendor_id": s.vendor_id, "person_id": s.person_id, "entity_type": s.entity_type,
        "submitted_name": s.submitted_name, "status": s.status, "ongoing_screening": bool(s.ongoing_screening),
        "has_case": bool(s.external_case_id), "last_screened_at": s.last_screened_at,
        "last_error": s.last_error, "simulated": bool(s.simulated), "match_counts": counts or {},
    }


def s_match(m: TPRAScreeningMatch, subject: Optional[TPRAScreeningSubject] = None,
            vendor_name: Optional[str] = None) -> dict:
    return {
        "id": m.id, "vendor_id": m.vendor_id, "vendor_name": vendor_name, "subject_id": m.subject_id,
        "subject_name": subject.submitted_name if subject else None,
        "subject_type": subject.entity_type if subject else None,
        "external_result_id": m.external_result_id, "reference_id": m.reference_id,
        "matched_name": m.matched_name, "match_strength": m.match_strength, "provider_type": m.provider_type,
        "categories": m.categories or [], "countries": m.countries or [], "hit_class": m.hit_class,
        "resolution_status": m.resolution_status, "risk_level": m.risk_level, "reason": m.reason,
        "remark": m.remark, "resolved_by": m.resolved_by, "resolved_at": m.resolved_at,
        "sync_status": m.sync_status, "sync_error": m.sync_error, "linked_finding_id": m.linked_finding_id,
        "first_seen_via": m.first_seen_via, "simulated": bool(m.simulated), "row_version": m.row_version,
        "created_at": m.created_at, "updated_at": m.updated_at,
    }


# ── key people ───────────────────────────────────────────────────────────────

class PersonIn(BaseModel):
    full_name: str
    role: str = "director"
    ownership_pct: Optional[float] = None
    date_of_birth: Optional[str] = None
    nationality: Optional[str] = None
    country_location: Optional[str] = None
    gender: Optional[str] = None
    include_in_screening: bool = True


class PersonUpdate(BaseModel):
    full_name: Optional[str] = None
    role: Optional[str] = None
    ownership_pct: Optional[float] = None
    date_of_birth: Optional[str] = None
    nationality: Optional[str] = None
    country_location: Optional[str] = None
    gender: Optional[str] = None
    include_in_screening: Optional[bool] = None
    row_version: Optional[int] = None


def _validate_person(data: dict) -> dict:
    if "full_name" in data and data["full_name"] is not None:
        data["full_name"] = data["full_name"].strip()
        if not data["full_name"]:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Full name is required")
    if data.get("role") is not None and data["role"] not in PERSON_ROLES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"role must be one of {', '.join(PERSON_ROLES)}")
    dob = data.get("date_of_birth")
    if dob:
        try:
            datetime.strptime(dob, "%Y-%m-%d")
        except ValueError:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "date_of_birth must be YYYY-MM-DD")
    for k in ("nationality", "country_location"):
        if data.get(k):
            v = data[k].strip().upper()
            if len(v) != 3 or not v.isalpha():
                raise HTTPException(status.HTTP_400_BAD_REQUEST, f"{k} must be an ISO-3166 alpha-3 code (e.g. GBR)")
            data[k] = v
    if data.get("gender") and data["gender"].upper() not in ("MALE", "FEMALE", "UNSPECIFIED"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "gender must be MALE, FEMALE or UNSPECIFIED")
    if data.get("gender"):
        data["gender"] = data["gender"].upper()
    pct = data.get("ownership_pct")
    if pct is not None and not (0 <= pct <= 100):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "ownership_pct must be between 0 and 100")
    return data


@router.get("/vendors/{vendor_id}/people")
def list_people(vendor_id: int, include_deleted: bool = False, db: Session = Depends(get_db),
                user: GRCUser = Depends(require_auth)):
    tids = _tids(user, db)
    v = _vendor(db, vendor_id, tids)
    _require_view(db, user)
    q = db.query(TPRAVendorPerson).filter(TPRAVendorPerson.vendor_id == v.id)
    if not include_deleted:
        q = q.filter(TPRAVendorPerson.deleted_at.is_(None))
    rows = q.order_by(TPRAVendorPerson.id).all()
    return {"items": [s_person(p) for p in rows], "total": len(rows)}


@router.post("/vendors/{vendor_id}/people", status_code=status.HTTP_201_CREATED)
def create_person(vendor_id: int, body: PersonIn, db: Session = Depends(get_db),
                  user: GRCUser = Depends(require_auth)):
    tids = _tids(user, db)
    v = _vendor(db, vendor_id, tids)
    rbac.require_write(db, user, "vendors", "edit")
    data = _validate_person(body.model_dump())
    p = TPRAVendorPerson(tenant_id=v.tenant_id, vendor_id=v.id, created_by=user.id, **data)
    db.add(p)
    db.flush()
    screening.service.write_audit(db, v.tenant_id, entity="vendor_person", action="create", vendor_id=v.id,
                                  entity_id=p.id, actor_id=user.id, to_value=p.role)
    db.commit()
    return s_person(p)


def _person(db: Session, person_id: int, tids: List[int], allow_deleted=False) -> TPRAVendorPerson:
    q = db.query(TPRAVendorPerson).filter(TPRAVendorPerson.id == person_id, TPRAVendorPerson.tenant_id.in_(tids))
    if not allow_deleted:
        q = q.filter(TPRAVendorPerson.deleted_at.is_(None))
    p = q.first()
    if not p:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Person not found")
    return p


@router.put("/people/{person_id}")
def update_person(person_id: int, body: PersonUpdate, db: Session = Depends(get_db),
                  user: GRCUser = Depends(require_auth)):
    tids = _tids(user, db)
    p = _person(db, person_id, tids)
    rbac.require_write(db, user, "vendors", "edit")
    if body.row_version is not None and p.row_version not in (None, body.row_version):
        raise HTTPException(status.HTTP_409_CONFLICT, "Record was modified by someone else — reload and retry")
    data = _validate_person(body.model_dump(exclude_unset=True, exclude={"row_version"}))
    for k, val in data.items():
        setattr(p, k, val)
    p.row_version = (p.row_version or 1) + 1
    screening.service.write_audit(db, p.tenant_id, entity="vendor_person", action="update", vendor_id=p.vendor_id,
                                  entity_id=p.id, actor_id=user.id, extra={"fields": sorted(data.keys())})
    db.commit()
    return s_person(p)


@router.delete("/people/{person_id}")
def delete_person(person_id: int, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    tids = _tids(user, db)
    p = _person(db, person_id, tids)
    rbac.require_write(db, user, "vendors", "edit")
    p.deleted_at = datetime.utcnow()
    p.row_version = (p.row_version or 1) + 1
    screening.service.write_audit(db, p.tenant_id, entity="vendor_person", action="delete", vendor_id=p.vendor_id,
                                  entity_id=p.id, actor_id=user.id)
    db.commit()
    return {"deleted": True, "id": p.id}


@router.post("/people/{person_id}/restore")
def restore_person(person_id: int, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    tids = _tids(user, db)
    p = _person(db, person_id, tids, allow_deleted=True)
    rbac.require_write(db, user, "vendors", "edit")
    p.deleted_at = None
    p.row_version = (p.row_version or 1) + 1
    screening.service.write_audit(db, p.tenant_id, entity="vendor_person", action="restore", vendor_id=p.vendor_id,
                                  entity_id=p.id, actor_id=user.id)
    db.commit()
    return s_person(p)


# ── screening ────────────────────────────────────────────────────────────────

@router.get("/vendors/{vendor_id}/screening")
def vendor_screening(vendor_id: int, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    tids = _tids(user, db)
    v = _vendor(db, vendor_id, tids)
    _require_view(db, user)
    subjects = db.query(TPRAScreeningSubject).filter(
        TPRAScreeningSubject.vendor_id == v.id, TPRAScreeningSubject.deleted_at.is_(None),
    ).order_by(TPRAScreeningSubject.person_id.isnot(None), TPRAScreeningSubject.id).all()
    sid = [s.id for s in subjects] or [-1]
    matches = db.query(TPRAScreeningMatch).filter(TPRAScreeningMatch.subject_id.in_(sid)).order_by(
        TPRAScreeningMatch.resolution_status != "unresolved", desc(TPRAScreeningMatch.created_at)).all()
    by_subject = {s.id: s for s in subjects}
    counts: dict = {}
    for m in matches:
        c = counts.setdefault(m.subject_id, {})
        c[m.resolution_status] = c.get(m.resolution_status, 0) + 1
    return {
        "connection": _conn_state(db, v.tenant_id),
        "subjects": [s_subject(s, counts.get(s.id)) for s in subjects],
        "matches": [s_match(m, by_subject.get(m.subject_id), v.name) for m in matches],
        "summary": {
            "unresolved": sum(1 for m in matches if m.resolution_status == "unresolved"),
            "positive": sum(1 for m in matches if m.resolution_status == "positive"),
            "sync_failed": sum(1 for m in matches if m.sync_status == "failed"),
        },
    }


class RunIn(BaseModel):
    subject_ids: Optional[List[int]] = None


@router.post("/vendors/{vendor_id}/screening/run")
def run_screening(vendor_id: int, body: RunIn = RunIn(), db: Session = Depends(get_db),
                  user: GRCUser = Depends(require_auth)):
    tids = _tids(user, db)
    v = _vendor(db, vendor_id, tids)
    rbac.require_write(db, user, "screening", "run")
    try:
        summary = screening.screen_vendor(db, v, actor_id=user.id, subject_ids=body.subject_ids)
    except (connections.NotConfigured, screening.ScreeningError, ProviderError) as e:
        db.rollback()
        raise _provider_http(e)
    db.commit()
    return summary


class OngoingIn(BaseModel):
    enabled: bool
    subject_ids: Optional[List[int]] = None


@router.put("/vendors/{vendor_id}/screening/ongoing")
def set_ongoing(vendor_id: int, body: OngoingIn, db: Session = Depends(get_db),
                user: GRCUser = Depends(require_auth)):
    tids = _tids(user, db)
    v = _vendor(db, vendor_id, tids)
    rbac.require_write(db, user, "screening", "run")
    try:
        changed = screening.set_ongoing(db, v, body.enabled, actor_id=user.id, subject_ids=body.subject_ids)
    except (connections.NotConfigured, screening.ScreeningError, ProviderError) as e:
        db.rollback()
        raise _provider_http(e)
    db.commit()
    return {"changed": changed, "enabled": body.enabled}


@router.get("/screening/matches")
def list_matches(
    resolution_status: Optional[str] = Query(None), hit_class: Optional[str] = Query(None),
    vendor_id: Optional[int] = Query(None), sync_status: Optional[str] = Query(None),
    skip: int = Query(0, ge=0), limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db), user: GRCUser = Depends(require_auth),
):
    """Portfolio screening work queue across vendors."""
    tids = _tids(user, db)
    _require_view(db, user)
    q = db.query(TPRAScreeningMatch).join(
        TPRAScreeningSubject, TPRAScreeningSubject.id == TPRAScreeningMatch.subject_id,
    ).filter(TPRAScreeningMatch.tenant_id.in_(tids), TPRAScreeningSubject.deleted_at.is_(None))
    if resolution_status:
        q = q.filter(TPRAScreeningMatch.resolution_status == resolution_status)
    if hit_class:
        q = q.filter(TPRAScreeningMatch.hit_class == hit_class)
    if vendor_id:
        q = q.filter(TPRAScreeningMatch.vendor_id == vendor_id)
    if sync_status:
        q = q.filter(TPRAScreeningMatch.sync_status == sync_status)
    total = q.count()
    rows = q.order_by(desc(TPRAScreeningMatch.created_at)).offset(skip).limit(limit).all()
    subj = {s.id: s for s in db.query(TPRAScreeningSubject).filter(
        TPRAScreeningSubject.id.in_({m.subject_id for m in rows} or {-1})).all()}
    vnames = dict(db.query(Vendor.id, Vendor.name).filter(Vendor.id.in_({m.vendor_id for m in rows} or {-1})).all())
    return {"items": [s_match(m, subj.get(m.subject_id), vnames.get(m.vendor_id)) for m in rows],
            "total": total, "skip": skip, "limit": limit}


@router.get("/screening/summary")
def screening_summary(db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    tids = _tids(user, db)
    _require_view(db, user)
    base = db.query(TPRAScreeningMatch).join(
        TPRAScreeningSubject, TPRAScreeningSubject.id == TPRAScreeningMatch.subject_id,
    ).filter(TPRAScreeningMatch.tenant_id.in_(tids), TPRAScreeningSubject.deleted_at.is_(None))
    by_status = dict(base.with_entities(TPRAScreeningMatch.resolution_status, func.count()).group_by(
        TPRAScreeningMatch.resolution_status).all())
    unresolved_by_class = dict(base.filter(TPRAScreeningMatch.resolution_status == "unresolved").with_entities(
        TPRAScreeningMatch.hit_class, func.count()).group_by(TPRAScreeningMatch.hit_class).all())
    sync_failed = base.filter(TPRAScreeningMatch.sync_status == "failed").count()
    tenant_id = tids[0]
    return {"by_status": by_status, "unresolved_by_class": unresolved_by_class, "sync_failed": sync_failed,
            "connection": _conn_state(db, tenant_id)}


def _match(db: Session, match_id: int, tids: List[int]) -> TPRAScreeningMatch:
    m = db.query(TPRAScreeningMatch).filter(TPRAScreeningMatch.id == match_id,
                                            TPRAScreeningMatch.tenant_id.in_(tids)).first()
    if not m:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Screening match not found")
    return m


@router.get("/screening/matches/{match_id}")
def get_match(match_id: int, profile: bool = False, db: Session = Depends(get_db),
              user: GRCUser = Depends(require_auth)):
    tids = _tids(user, db)
    _require_view(db, user)
    m = _match(db, match_id, tids)
    subject = db.query(TPRAScreeningSubject).filter(TPRAScreeningSubject.id == m.subject_id).first()
    vname = db.query(Vendor.name).filter(Vendor.id == m.vendor_id).scalar()
    out = {"match": s_match(m, subject, vname), "raw": m.raw or {}}
    if m.linked_finding_id:
        f = db.query(TPRAFinding).filter(TPRAFinding.id == m.linked_finding_id).first()
        out["finding"] = {"id": f.id, "title": f.title, "severity": f.severity, "status": f.status} if f else None
    if profile and m.reference_id:
        try:
            conn = screening.get_wc1_connection(db, m.tenant_id)
            out["profile"] = registry.wc1_client(conn).profile(m.reference_id)
            db.commit()
        except (connections.NotConfigured, ProviderError, ValueError) as e:
            out["profile_error"] = str(e)
    return out


@router.get("/screening/resolution-options")
def resolution_options(db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    tids = _tids(user, db)
    _require_view(db, user)
    try:
        conn = screening.get_wc1_connection(db, tids[0])
        opts = screening.resolution_options(db, conn)
    except (connections.NotConfigured, screening.ScreeningError, ProviderError) as e:
        db.rollback()
        raise _provider_http(e)
    db.commit()
    return {**opts, "statuses_supported": list(screening.RESOLUTION_STATUSES),
            "risk_levels": list(screening.RISK_LEVELS)}


class ResolutionIn(BaseModel):
    status: str
    risk_level: Optional[str] = None
    reason: Optional[str] = None
    remark: Optional[str] = None
    row_version: Optional[int] = None


@router.put("/screening/matches/{match_id}/resolution")
def resolve_match(match_id: int, body: ResolutionIn, db: Session = Depends(get_db),
                  user: GRCUser = Depends(require_auth)):
    tids = _tids(user, db)
    m = _match(db, match_id, tids)
    rbac.require_write(db, user, "screening", "resolve", allow_fallback=False)
    if body.row_version is not None and m.row_version not in (None, body.row_version):
        raise HTTPException(status.HTTP_409_CONFLICT, "Record was modified by someone else — reload and retry")
    try:
        out = screening.resolve_match(db, m, status=body.status, actor_id=user.id, risk_level=body.risk_level,
                                      reason=body.reason, remark=body.remark)
    except screening.ScreeningError as e:
        db.rollback()
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e))
    db.commit()
    subject = db.query(TPRAScreeningSubject).filter(TPRAScreeningSubject.id == m.subject_id).first()
    return {"match": s_match(out["match"], subject), "finding_id": out["finding_id"], "synced": out["synced"]}


@router.post("/screening/matches/{match_id}/sync")
def retry_sync(match_id: int, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    tids = _tids(user, db)
    m = _match(db, match_id, tids)
    rbac.require_write(db, user, "screening", "resolve", allow_fallback=False)
    ok = screening.sync_resolution(db, m)
    db.commit()
    return {"synced": ok, "sync_status": m.sync_status, "sync_error": m.sync_error}
