"""Framework onboarding and the organisation profile (API). Plan: ``docs/framework-onboarding-plan.md``.

Reads need a sign-in only (they hold organisation facts the compliance team already sees); writes need ``compliance:org_profile:edit`` /
``compliance:framework_onboarding:edit|approve|override``. Anyone who may edit frameworks (``compliance:frameworks:edit``) may also edit
the profile and an onboarding, so nobody who works here today is locked out; approving and overriding are new grants (an Administrator
holds all). A GET never writes. Errors carry ``{message, errors: [{field, message}]}`` like the Cyber Security scoping.
"""
from __future__ import annotations

from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ...models import GRCUser, get_db
from ...routers.auth_router import get_user_primary_tenant, require_auth, require_tenant_permission
from . import ai, catalog, gate, profile, service

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
