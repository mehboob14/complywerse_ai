"""Policy exceptions, the rest of their life (DECISIONS D62): the unit and document hierarchy, potential risks, the implementation and its
compensating controls, assets, and AI assist at every step. The exception itself (list, create, change, submit, decide, withdraw, revoke) is
``routers/policy_exception_router.py``; who is asked is ``exception_approvals.py``; the rules of each piece are in ``exception_risks.py``,
``exception_controls.py``, ``exception_assets.py``, ``exception_hierarchy.py`` and ``exception_ai.py``.

Reads are what ``GET /{id}`` already was: any member of the organisation. Writes are for the people each step asks (``exception_risks``: the
person asked at the open step; ``exception_controls``: the implementer; ``exception_assets``: the requester, someone allowed to edit exceptions,
the implementer), and the AI helpers ask the same of the person as the thing they draft for. This router is included BEFORE the legacy one so
that its fixed paths (``/by-unit``, ``/ai/draft``) are not read as an exception id.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ....models import GRCUser, PolicyException, get_db
from ....routers import policy_exception_router as legacy
from ....routers.auth_router import get_user_primary_tenant, get_user_tenants, require_auth
from .. import exception_ai as AI
from .. import exception_approvals as A
from .. import exception_assets as ASSETS
from .. import exception_controls as C
from .. import exception_hierarchy as H
from .. import exception_risks as K

router = APIRouter(prefix="/policy-exceptions", tags=["Policy Exceptions"])

OWNER_AI_REFUSED = "Only someone allowed to request or edit policy exceptions can ask AI to help with one."


class DraftIn(BaseModel):
    title: str
    document_id: Optional[int] = None
    department_id: Optional[int] = None


class ScheduleIn(BaseModel):
    title: str
    justification: Optional[str] = None
    document_id: Optional[int] = None
    priority: Optional[str] = None


class AssetsAiIn(BaseModel):
    title: str
    justification: Optional[str] = None
    document_id: Optional[int] = None
    department_id: Optional[int] = None


class AssetsIn(BaseModel):
    asset_ids: List[int]


class CompleteIn(BaseModel):
    note: Optional[str] = None
    confirm_uncovered: bool = False


class LinkIn(BaseModel):
    risk_id: Optional[int] = None


def _exception(db: Session, user: GRCUser, exception_id: int) -> PolicyException:
    exc = db.query(PolicyException).filter(PolicyException.id == exception_id, PolicyException.tenant_id.in_(get_user_tenants(user, db))).first()
    if exc is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Exception not found")
    return exc


def _decider(db: Session, user: GRCUser, exc: PolicyException) -> bool:
    """The older flow (no rule): someone allowed to approve who is not the requester."""
    return "approve" in legacy._held(db, user) and exc.requested_by != user.id


def _may_edit(db: Session, user: GRCUser) -> bool:
    return "edit" in legacy._held(db, user)


def _full(db: Session, user: GRCUser, exc: PolicyException) -> dict:
    db.refresh(exc)
    return legacy._exception_to_dict(exc, db, legacy._viewer(db, user, [exc]))


def _tenant(db: Session, user: GRCUser) -> int:
    tenant_id = get_user_primary_tenant(user, db)
    if not tenant_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="User is not assigned to any tenant")
    return tenant_id


def _owner_ai(db: Session, user: GRCUser) -> None:
    if not legacy._held(db, user) & {"create", "edit"}:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=OWNER_AI_REFUSED)


# ── the hierarchy ────────────────────────────────────────────────────────────
@router.get("/by-unit")
def exceptions_by_unit(db: Session = Depends(get_db), current_user: GRCUser = Depends(require_auth)):
    """The units that have exceptions, as a tree, each counting its own and everything under it."""
    legacy._ensure_columns(db)
    return H.by_unit(db, current_user)


@router.get("/by-document")
def exceptions_by_document(db: Session = Depends(get_db), current_user: GRCUser = Depends(require_auth)):
    """The units as folders, the documents that have exceptions under each, the exceptions under each document."""
    legacy._ensure_columns(db)
    return H.by_document(db, current_user)


# ── AI for the person raising an exception ───────────────────────────────────
@router.post("/ai/draft")
def ai_draft(body: DraftIn, db: Session = Depends(get_db), current_user: GRCUser = Depends(require_auth)):
    """A draft justification and business impact. Nothing is saved."""
    _owner_ai(db, current_user)
    if not body.title.strip():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Title is required")
    return AI.draft(db, current_user, get_user_tenants(current_user, db), body.title.strip(), body.document_id)


@router.post("/ai/schedule")
def ai_schedule(body: ScheduleIn, db: Session = Depends(get_db), current_user: GRCUser = Depends(require_auth)):
    """A suggested priority and period. Nothing is saved."""
    _owner_ai(db, current_user)
    if not body.title.strip():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Title is required")
    return AI.schedule(db, current_user, get_user_tenants(current_user, db), body.title.strip(), (body.justification or "").strip(),
                       body.document_id, (body.priority or "").strip().lower() or None)


@router.post("/ai/assets")
def ai_assets(body: AssetsAiIn, db: Session = Depends(get_db), current_user: GRCUser = Depends(require_auth)):
    """Assets the exception probably touches. Nothing is saved."""
    _owner_ai(db, current_user)
    if not body.title.strip():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Title is required")
    return AI.suggest_assets(db, current_user, _tenant(db, current_user), get_user_tenants(current_user, db), body.title.strip(),
                             (body.justification or "").strip(), body.document_id)


# ── potential risks ──────────────────────────────────────────────────────────
@router.get("/{exception_id}/risks")
def list_risks(exception_id: int, db: Session = Depends(get_db), current_user: GRCUser = Depends(require_auth)):
    exc = _exception(db, current_user, exception_id)
    return K.listing(db, exc, current_user, _decider(db, current_user, exc))


def _risk_out(db: Session, exc: PolicyException, user: GRCUser, row) -> dict:
    return K.view(row, A._names(db, [row.recorded_by]), user.id, True, K.level_labels(db, exc.tenant_id))


@router.post("/{exception_id}/risks", status_code=status.HTTP_201_CREATED)
def add_risk(exception_id: int, data: dict, db: Session = Depends(get_db), current_user: GRCUser = Depends(require_auth)):
    """Record a potential risk (or "none identified") at the step the person is asked at."""
    exc = _exception(db, current_user, exception_id)
    row = K.add(db, exc, current_user, data or {}, _decider(db, current_user, exc))
    db.commit()
    return _risk_out(db, exc, current_user, row)


@router.put("/{exception_id}/risks/{risk_id}")
def change_risk(exception_id: int, risk_id: int, data: dict, db: Session = Depends(get_db), current_user: GRCUser = Depends(require_auth)):
    exc = _exception(db, current_user, exception_id)
    row = K.update(db, exc, current_user, risk_id, data or {}, _decider(db, current_user, exc))
    db.commit()
    return _risk_out(db, exc, current_user, row)


@router.delete("/{exception_id}/risks/{risk_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_risk(exception_id: int, risk_id: int, db: Session = Depends(get_db), current_user: GRCUser = Depends(require_auth)):
    exc = _exception(db, current_user, exception_id)
    K.delete(db, exc, current_user, risk_id, _decider(db, current_user, exc))
    db.commit()
    return None


@router.post("/{exception_id}/risks/{risk_id}/link")
def link_risk(exception_id: int, risk_id: int, body: LinkIn, db: Session = Depends(get_db), current_user: GRCUser = Depends(require_auth)):
    """Link a potential risk to an entry of the risk register, or take the link off (``risk_id`` null)."""
    exc = _exception(db, current_user, exception_id)
    row = K.link_register(db, exc, current_user, risk_id, body.risk_id, _decider(db, current_user, exc))
    db.commit()
    return _risk_out(db, exc, current_user, row)


@router.post("/{exception_id}/ai/risks")
def ai_risks(exception_id: int, db: Session = Depends(get_db), current_user: GRCUser = Depends(require_auth)):
    """Potential risks and a summary to decide on, for the person asked at the open step. Nothing is saved."""
    exc = _exception(db, current_user, exception_id)
    if K.context(db, exc, current_user, _decider(db, current_user, exc)) is None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=K.NOT_YOUR_STEP)
    return AI.suggest_risks(db, current_user, get_user_tenants(current_user, db), exc)


# ── the implementation ───────────────────────────────────────────────────────
@router.get("/{exception_id}/controls")
def list_controls(exception_id: int, db: Session = Depends(get_db), current_user: GRCUser = Depends(require_auth)):
    return C.listing(db, _exception(db, current_user, exception_id), current_user)


def _control_out(db: Session, exc: PolicyException, user: GRCUser, row) -> dict:
    return next(c for c in C.listing(db, exc, user)["controls"] if c["id"] == row.id)


@router.post("/{exception_id}/controls", status_code=status.HTTP_201_CREATED)
def add_control(exception_id: int, data: dict, db: Session = Depends(get_db), current_user: GRCUser = Depends(require_auth)):
    """Record a compensating control (the people asked to implement the exception)."""
    exc = _exception(db, current_user, exception_id)
    row = C.add(db, exc, current_user, data or {})
    db.commit()
    return _control_out(db, exc, current_user, row)


@router.put("/{exception_id}/controls/{control_id}")
def change_control(exception_id: int, control_id: int, data: dict, db: Session = Depends(get_db), current_user: GRCUser = Depends(require_auth)):
    exc = _exception(db, current_user, exception_id)
    row = C.update(db, exc, current_user, control_id, data or {})
    db.commit()
    return _control_out(db, exc, current_user, row)


@router.delete("/{exception_id}/controls/{control_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_control(exception_id: int, control_id: int, db: Session = Depends(get_db), current_user: GRCUser = Depends(require_auth)):
    exc = _exception(db, current_user, exception_id)
    C.delete(db, exc, current_user, control_id)
    db.commit()
    return None


@router.post("/{exception_id}/implementation/complete")
def complete_implementation(exception_id: int, body: CompleteIn = CompleteIn(), db: Session = Depends(get_db), current_user: GRCUser = Depends(require_auth)):
    """Mark the exception implemented: needs a compensating control; potential risks no control covers need ``confirm_uncovered``."""
    exc = _exception(db, current_user, exception_id)
    C.complete(db, exc, current_user, body.note, body.confirm_uncovered)
    db.commit()
    return _full(db, current_user, exc)


@router.post("/{exception_id}/ai/controls")
def ai_controls(exception_id: int, db: Session = Depends(get_db), current_user: GRCUser = Depends(require_auth)):
    """Compensating controls for the potential risks and assets, for the people asked to implement. Nothing is saved."""
    exc = _exception(db, current_user, exception_id)
    run = C.may_implement(db, exc, current_user)
    if run is None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=C.NOT_YOURS)
    return AI.suggest_controls(db, current_user, get_user_tenants(current_user, db), exc, run)


# ── assets ───────────────────────────────────────────────────────────────────
@router.post("/{exception_id}/assets")
def add_assets(exception_id: int, body: AssetsIn, db: Session = Depends(get_db), current_user: GRCUser = Depends(require_auth)):
    """Put assets on the exception's list: the person who raised it, someone allowed to edit exceptions, the people asked to implement it."""
    exc = _exception(db, current_user, exception_id)
    ASSETS.add(db, exc, current_user, body.asset_ids, _may_edit(db, current_user))
    db.commit()
    return {"asset_links": ASSETS.view(db, exc, current_user, _may_edit(db, current_user))}


@router.delete("/{exception_id}/assets/{asset_id}")
def remove_asset(exception_id: int, asset_id: int, db: Session = Depends(get_db), current_user: GRCUser = Depends(require_auth)):
    exc = _exception(db, current_user, exception_id)
    ASSETS.remove(db, exc, current_user, asset_id, _may_edit(db, current_user))
    db.commit()
    return {"asset_links": ASSETS.view(db, exc, current_user, _may_edit(db, current_user))}
