"""Framework onboarding and the organisation profile (API). Plan: ``docs/framework-onboarding-plan.md``.

Reads need a sign-in only (they hold organisation facts the compliance team already sees); writes need ``compliance:org_profile:edit`` /
``compliance:framework_onboarding:edit|approve|override``. Anyone who may edit frameworks (``compliance:frameworks:edit``) may also edit
the profile and an onboarding, so nobody who works here today is locked out; approving and overriding are new grants (an Administrator
holds all). A GET never writes. Errors carry ``{message, errors: [{field, message}]}`` like the Cyber Security scoping.
"""
from __future__ import annotations

from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ...models import GRCUser, get_db
from ...routers.auth_router import get_user_primary_tenant, has_tenant_permission, require_auth, require_tenant_permission
from . import ai, catalog, files, gate, profile, service

router = APIRouter(prefix="/compliance", tags=["Framework Onboarding"])

EDIT_PROFILE = require_tenant_permission("compliance:org_profile:edit", "compliance:frameworks:edit", "admin:organization:edit")   # it lives in Administration
EDIT_ONBOARDING = require_tenant_permission("compliance:framework_onboarding:edit", "compliance:frameworks:edit")
APPROVE = require_tenant_permission("compliance:framework_onboarding:approve")
OVERRIDE = require_tenant_permission("compliance:framework_onboarding:override")


def _tenant(db: Session, user: GRCUser) -> int:
    tid = get_user_primary_tenant(user, db)
    if not tid:
        raise HTTPException(status_code=400, detail={"message": "You are not assigned to an organisation."})
    return tid


def _fail(exc: Exception) -> HTTPException:
    if isinstance(exc, service.OnboardingError):
        return HTTPException(status_code=exc.status, detail=exc.body)
    if isinstance(exc, profile.ProfileError):
        msg = {409: "A completed onboarding uses a row you removed.", 404: "Not found."}.get(exc.status, "Some answers could not be saved.")
        return HTTPException(status_code=exc.status, detail={"message": msg, "errors": exc.errors, **exc.more})
    raise exc


# --------------------------------------------------------------------------- organisation profile
@router.get("/org-profile/catalog")
def profile_catalog(user: GRCUser = Depends(require_auth)):
    return profile.catalog_view()


@router.get("/org-profile")
def get_profile(db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    return profile.view(db, _tenant(db, user))


class ProfileBody(BaseModel):
    values: Dict[str, Any] = Field(default_factory=dict)      # {"group.field": value}; each key replaces that field whole


@router.put("/org-profile")
def put_profile(body: ProfileBody, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth), _p: bool = Depends(EDIT_PROFILE)):
    try:
        return profile.save(db, _tenant(db, user), user, body.values)
    except profile.ProfileError as exc:
        db.rollback()
        raise _fail(exc)


@router.post("/org-profile/groups/{group}/review")
def review_profile_group(group: str, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth), _p: bool = Depends(EDIT_PROFILE)):
    try:
        return profile.review_group(db, _tenant(db, user), user, group)
    except profile.ProfileError as exc:
        raise _fail(exc)


# --------------------------------------------------------------------------- the register and the catalog of one framework
@router.get("/framework-onboarding")
def register(db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    return service.register(db, _tenant(db, user))


@router.get("/framework-onboarding/families/{slug}")
def family(slug: str, user: GRCUser = Depends(require_auth)):
    return catalog.resolve(slug)


@router.get("/framework-onboarding/gate/{uploaded_framework_id}")
def gate_for(uploaded_framework_id: int, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    tid = _tenant(db, user)
    try:
        return gate.decide(db, tid, service.get_framework(db, tid, uploaded_framework_id))
    except service.OnboardingError as exc:
        raise _fail(exc)


class StartBody(BaseModel):
    uploaded_framework_id: int


@router.post("/framework-onboarding", status_code=201)
def start(body: StartBody, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth), _p: bool = Depends(EDIT_ONBOARDING)):
    tid = _tenant(db, user)
    try:
        fw = service.get_framework(db, tid, body.uploaded_framework_id)
        return service.view(db, service.create(db, tid, user, fw))
    except service.OnboardingError as exc:
        raise _fail(exc)


# --------------------------------------------------------------------------- framework versions (docs/framework-version-management.md)
@router.post("/framework-onboarding/version-check")
def version_check(db: Session = Depends(get_db), user: GRCUser = Depends(require_auth), _p: bool = Depends(EDIT_ONBOARDING)):
    """Measure every settled onboarding against what it was settled on and tell the program owners (once per change). Answers the counts."""
    return service.check_versions(db, _tenant(db, user), user)


# --------------------------------------------------------------------------- documents on an answer
@router.post("/framework-onboarding/files", status_code=201)
async def upload_file(file: UploadFile = File(...), db: Session = Depends(get_db), user: GRCUser = Depends(require_auth), _p: bool = Depends(EDIT_ONBOARDING)):
    """Stores one document (kept in Evidence) and answers ``{id, name}``; the answer that carries it is saved with the usual PUT .../answers."""
    return await files.save(db, _tenant(db, user), user, file)


@router.get("/framework-onboarding/files/{evidence_id}")
def download_file(evidence_id: int, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    ev = files.find(db, _tenant(db, user), evidence_id)
    return FileResponse(ev.file_path, filename=ev.file_name or "file", media_type=ev.file_type or "application/octet-stream")


# --------------------------------------------------------------------------- one onboarding
@router.get("/framework-onboarding/{onboarding_id}")
def detail(onboarding_id: int, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    try:
        return service.view(db, service.get(db, _tenant(db, user), onboarding_id))
    except service.OnboardingError as exc:
        raise _fail(exc)


class AnswersBody(BaseModel):
    step: str
    values: Dict[str, Any] = Field(default_factory=dict)      # {field: value}; each key replaces that field whole


@router.put("/framework-onboarding/{onboarding_id}/answers")
def put_answers(onboarding_id: int, body: AnswersBody, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth),
                _p: bool = Depends(EDIT_ONBOARDING)):
    try:
        return service.save_answers(db, service.get(db, _tenant(db, user), onboarding_id), user, body.step, body.values)
    except service.OnboardingError as exc:
        db.rollback()
        raise _fail(exc)


class ExistingBody(BaseModel):
    """What an organisation already has: only ``assessment_type`` is asked; every other key is optional and a key left out is left as it was."""
    assessment_type: Optional[str] = None
    framework_version: Optional[str] = None
    assessment_date: Optional[str] = None
    valid_until: Optional[str] = None
    period_start: Optional[str] = None
    period_end: Optional[str] = None
    assessor_or_issuer: Optional[str] = None
    scope_coverage: Optional[str] = None
    scope_note: Optional[str] = None
    evidence_ids: Optional[list] = None
    note: Optional[str] = None


@router.post("/framework-onboarding/{onboarding_id}/existing", status_code=201)
def existing_add(onboarding_id: int, body: ExistingBody, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth), _p: bool = Depends(EDIT_ONBOARDING)):
    try:
        return service.existing_add(db, service.get(db, _tenant(db, user), onboarding_id), user, body.dict(exclude_unset=True))
    except service.OnboardingError as exc:
        db.rollback()
        raise _fail(exc)


@router.put("/framework-onboarding/{onboarding_id}/existing/{record_id}")
def existing_update(onboarding_id: int, record_id: int, body: ExistingBody, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth),
                    _p: bool = Depends(EDIT_ONBOARDING)):
    try:
        return service.existing_update(db, service.get(db, _tenant(db, user), onboarding_id), user, record_id, body.dict(exclude_unset=True))
    except service.OnboardingError as exc:
        db.rollback()
        raise _fail(exc)


@router.delete("/framework-onboarding/{onboarding_id}/existing/{record_id}")
def existing_remove(onboarding_id: int, record_id: int, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth), _p: bool = Depends(EDIT_ONBOARDING)):
    try:
        return service.existing_remove(db, service.get(db, _tenant(db, user), onboarding_id), user, record_id)
    except service.OnboardingError as exc:
        db.rollback()
        raise _fail(exc)


class VerifyBody(BaseModel):
    status: str = ""


@router.post("/framework-onboarding/{onboarding_id}/existing/{record_id}/verify")
def existing_verify(onboarding_id: int, record_id: int, body: VerifyBody, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth),
                    _p: bool = Depends(APPROVE)):
    try:
        return service.existing_verify(db, service.get(db, _tenant(db, user), onboarding_id), user, record_id, body.status)
    except service.OnboardingError as exc:
        db.rollback()
        raise _fail(exc)


class AiBody(BaseModel):
    step: Optional[str] = None
    field: Optional[str] = None


@router.post("/framework-onboarding/{onboarding_id}/ai/{kind}")
def ai_help(onboarding_id: int, kind: str, body: Optional[AiBody] = None, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth),
            _p: bool = Depends(EDIT_ONBOARDING)):
    try:
        return ai.run(db, service.get(db, _tenant(db, user), onboarding_id), user, kind)
    except service.OnboardingError as exc:
        raise _fail(exc)


@router.post("/framework-onboarding/{onboarding_id}/submit")
def submit(onboarding_id: int, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth), _p: bool = Depends(EDIT_ONBOARDING)):
    try:
        return service.submit(db, service.get(db, _tenant(db, user), onboarding_id), user)
    except service.OnboardingError as exc:
        raise _fail(exc)


class NoteBody(BaseModel):
    note: Optional[str] = Field(default=None, max_length=1000)


@router.post("/framework-onboarding/{onboarding_id}/approve")
def approve(onboarding_id: int, body: Optional[NoteBody] = None, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth),
            _p: bool = Depends(APPROVE)):
    try:
        return service.approve(db, service.get(db, _tenant(db, user), onboarding_id), user, body.note if body else None)
    except service.OnboardingError as exc:
        raise _fail(exc)


class ReasonBody(BaseModel):
    reason: str = Field(default="", max_length=2000)


@router.post("/framework-onboarding/{onboarding_id}/reopen")
def reopen(onboarding_id: int, body: ReasonBody, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth), _p: bool = Depends(OVERRIDE)):
    try:
        return service.reopen(db, service.get(db, _tenant(db, user), onboarding_id), user, body.reason)
    except service.OnboardingError as exc:
        raise _fail(exc)


class UnderwayBody(BaseModel):
    kind: str = ""
    reason: str = Field(default="", max_length=2000)


@router.post("/framework-onboarding/{onboarding_id}/underway")
def underway(onboarding_id: int, body: UnderwayBody, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth), _p: bool = Depends(OVERRIDE)):
    try:
        return service.mark_underway(db, service.get(db, _tenant(db, user), onboarding_id), user, body.kind, body.reason)
    except service.OnboardingError as exc:
        raise _fail(exc)


class VersionReviewBody(BaseModel):
    outcome: str = ""
    note: str = Field(default="", max_length=2000)


# who may take each decision on a version change: confirming is an approval, reopening is the reopen right, starting a draft for the newer version is editing
_REVIEW_RIGHT = {"confirmed": ("compliance:framework_onboarding:approve",), "changes_needed": ("compliance:framework_onboarding:override",),
                 "start_new_version": ("compliance:framework_onboarding:edit", "compliance:frameworks:edit")}


@router.post("/framework-onboarding/{onboarding_id}/version-review")
def version_review(onboarding_id: int, body: VersionReviewBody, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    right = _REVIEW_RIGHT.get(body.outcome)
    if right and not has_tenant_permission(db, user, *right):
        raise HTTPException(status_code=403, detail="Permission denied")
    try:
        return service.version_review(db, service.get(db, _tenant(db, user), onboarding_id), user, body.outcome, body.note)
    except service.OnboardingError as exc:
        db.rollback()
        raise _fail(exc)
