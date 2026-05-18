"""Teams admin — CRUD + member management.

Owns: /admin/teams + /admin/teams/{id}/members.

Teams are tenant-scoped org units (Payments, Identity, Platform Engineering,
…). Used by:
  * `ITAsset.owning_team_id` — the asset's owning team.
  * Future features that need a "team picker" dropdown.

Members are GRCUsers tagged with a `role_in_team` ∈ {lead, member, viewer}.
That's independent of the platform-wide RBAC role — a person can be lead
of Payments while holding the "Compliance Analyst" platform role.

All endpoints are tenant-scoped via `get_user_tenants`. Write endpoints
require the `admin:teams:manage` permission (falls back to legacy admin
check), keeping the surface auditable.
"""
from __future__ import annotations

import logging
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session, joinedload

from ..models import GRCUser, Team, TeamMember, get_db
from .auth_router import (
    require_auth, get_user_tenants, get_user_primary_tenant,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/admin/teams", tags=["Teams"])


_VALID_ROLES_IN_TEAM = {"lead", "member", "viewer"}


# ─── Schemas ─────────────────────────────────────────────────────────────────


class TeamMemberResponse(BaseModel):
    id: int
    user_id: int
    user_display_name: Optional[str] = None
    user_email: Optional[str] = None
    role_in_team: str
    added_at: datetime

    class Config:
        from_attributes = True


class TeamResponse(BaseModel):
    id: int
    tenant_id: int
    name: str
    description: Optional[str] = None
    lead_user_id: Optional[int] = None
    lead_user_name: Optional[str] = None
    is_active: bool
    member_count: int = 0
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class TeamDetailResponse(TeamResponse):
    members: List[TeamMemberResponse] = []


class TeamCreate(BaseModel):
    name: str
    description: Optional[str] = None
    lead_user_id: Optional[int] = None


class TeamUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    lead_user_id: Optional[int] = None
    is_active: Optional[bool] = None


class TeamMemberCreate(BaseModel):
    user_id: int
    role_in_team: Optional[str] = "member"


class TeamMemberUpdate(BaseModel):
    role_in_team: str


# ─── Helpers ─────────────────────────────────────────────────────────────────


def _get_team_for_user(team_id: int, user: GRCUser, db: Session) -> Team:
    tenants = get_user_tenants(user, db)
    row = (
        db.query(Team)
        .filter(Team.id == team_id)
        .filter(Team.tenant_id.in_(tenants))
        .first()
    )
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Team not found.")
    return row


def _serialize_team(t: Team, member_count: Optional[int] = None) -> TeamResponse:
    lead_name = None
    if t.lead is not None:
        lead_name = t.lead.display_name or t.lead.username
    return TeamResponse(
        id=t.id,
        tenant_id=t.tenant_id,
        name=t.name,
        description=t.description,
        lead_user_id=t.lead_user_id,
        lead_user_name=lead_name,
        is_active=bool(t.is_active),
        member_count=member_count if member_count is not None else (
            len(t.members) if hasattr(t, "members") and t.members is not None else 0
        ),
        created_at=t.created_at,
        updated_at=t.updated_at,
    )


def _serialize_member(m: TeamMember) -> TeamMemberResponse:
    return TeamMemberResponse(
        id=m.id,
        user_id=m.user_id,
        user_display_name=(m.user.display_name or m.user.username) if m.user else None,
        user_email=m.user.email if m.user else None,
        role_in_team=m.role_in_team,
        added_at=m.added_at,
    )


# ─── Endpoints ───────────────────────────────────────────────────────────────


@router.get("", response_model=List[TeamResponse])
def list_teams(
    include_inactive: bool = False,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """List teams in the caller's tenant. Used by both the admin page and
    the "owning team" dropdown in EditAssetModal."""
    tenants = get_user_tenants(current_user, db)
    if not tenants:
        return []
    q = (
        db.query(Team)
        .options(joinedload(Team.lead), joinedload(Team.members))
        .filter(Team.tenant_id.in_(tenants))
    )
    if not include_inactive:
        q = q.filter(Team.is_active.is_(True))
    rows = q.order_by(Team.name.asc()).all()
    return [_serialize_team(t, member_count=len(t.members)) for t in rows]


@router.post("", response_model=TeamResponse, status_code=status.HTTP_201_CREATED)
def create_team(
    payload: TeamCreate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    tenant_id = get_user_primary_tenant(current_user, db)
    if not tenant_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="User is not assigned to any tenant.",
        )
    name = (payload.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Team name is required.")

    # Uniqueness — friendly error rather than a raw IntegrityError on commit.
    existing = (
        db.query(Team)
        .filter(Team.tenant_id == tenant_id)
        .filter(Team.name == name)
        .first()
    )
    if existing:
        raise HTTPException(status_code=400, detail=f"A team named '{name}' already exists.")

    row = Team(
        tenant_id=tenant_id,
        name=name,
        description=(payload.description or None),
        lead_user_id=payload.lead_user_id,
        is_active=True,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    # Refresh members eagerly to keep the response shape consistent.
    _ = row.members  # forces lazy load (will be empty)
    return _serialize_team(row, member_count=0)


@router.get("/{team_id}", response_model=TeamDetailResponse)
def get_team(
    team_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    team = _get_team_for_user(team_id, current_user, db)
    # Load members + user info in one query.
    members = (
        db.query(TeamMember)
        .options(joinedload(TeamMember.user))
        .filter(TeamMember.team_id == team.id)
        .order_by(TeamMember.added_at.asc())
        .all()
    )
    base = _serialize_team(team, member_count=len(members))
    return TeamDetailResponse(
        **base.model_dump(),
        members=[_serialize_member(m) for m in members],
    )


@router.patch("/{team_id}", response_model=TeamResponse)
def update_team(
    team_id: int,
    payload: TeamUpdate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    team = _get_team_for_user(team_id, current_user, db)
    data = payload.model_dump(exclude_unset=True)
    if "name" in data:
        new_name = (data["name"] or "").strip()
        if not new_name:
            raise HTTPException(status_code=400, detail="Team name cannot be empty.")
        clash = (
            db.query(Team)
            .filter(Team.tenant_id == team.tenant_id)
            .filter(Team.name == new_name)
            .filter(Team.id != team.id)
            .first()
        )
        if clash:
            raise HTTPException(status_code=400, detail=f"A team named '{new_name}' already exists.")
        team.name = new_name
    if "description" in data:
        team.description = data["description"] or None
    if "lead_user_id" in data:
        team.lead_user_id = data["lead_user_id"]
    if "is_active" in data:
        team.is_active = bool(data["is_active"])
    db.commit()
    db.refresh(team)
    return _serialize_team(team, member_count=len(team.members) if team.members else 0)


@router.delete("/{team_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_team(
    team_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    team = _get_team_for_user(team_id, current_user, db)
    # Best-effort cleanup: clear ITAsset.owning_team_id pointing here so we
    # don't leave dangling FKs on databases without ON DELETE SET NULL.
    try:
        from ..models import ITAsset
        db.query(ITAsset).filter(ITAsset.owning_team_id == team.id).update(
            {"owning_team_id": None}, synchronize_session=False,
        )
    except Exception:
        logger.exception("Failed to clear ITAsset.owning_team_id for team=%s", team.id)
    db.delete(team)
    db.commit()
    return None


# ── Members ────────────────────────────────────────────────────────────


@router.get("/{team_id}/members", response_model=List[TeamMemberResponse])
def list_members(
    team_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    team = _get_team_for_user(team_id, current_user, db)
    members = (
        db.query(TeamMember)
        .options(joinedload(TeamMember.user))
        .filter(TeamMember.team_id == team.id)
        .order_by(TeamMember.added_at.asc())
        .all()
    )
    return [_serialize_member(m) for m in members]


@router.post("/{team_id}/members", response_model=TeamMemberResponse, status_code=status.HTTP_201_CREATED)
def add_member(
    team_id: int,
    payload: TeamMemberCreate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    team = _get_team_for_user(team_id, current_user, db)
    role = (payload.role_in_team or "member").strip().lower()
    if role not in _VALID_ROLES_IN_TEAM:
        raise HTTPException(
            status_code=400,
            detail=f"role_in_team must be one of: {', '.join(sorted(_VALID_ROLES_IN_TEAM))}.",
        )

    # Ensure user belongs to the same tenant.
    user = db.query(GRCUser).filter(GRCUser.id == payload.user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found.")

    # Idempotent — duplicate add returns the existing row instead of 400.
    existing = (
        db.query(TeamMember)
        .options(joinedload(TeamMember.user))
        .filter(TeamMember.team_id == team.id)
        .filter(TeamMember.user_id == payload.user_id)
        .first()
    )
    if existing:
        if existing.role_in_team != role:
            existing.role_in_team = role
            db.commit()
        return _serialize_member(existing)

    member = TeamMember(
        team_id=team.id,
        user_id=payload.user_id,
        role_in_team=role,
        added_by=current_user.id,
    )
    db.add(member)
    db.commit()
    db.refresh(member)
    # Eager-load the user side now that the row is committed.
    member = (
        db.query(TeamMember)
        .options(joinedload(TeamMember.user))
        .filter(TeamMember.id == member.id)
        .first()
    )
    return _serialize_member(member)


@router.patch("/{team_id}/members/{member_id}", response_model=TeamMemberResponse)
def update_member(
    team_id: int,
    member_id: int,
    payload: TeamMemberUpdate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    team = _get_team_for_user(team_id, current_user, db)
    member = (
        db.query(TeamMember)
        .options(joinedload(TeamMember.user))
        .filter(TeamMember.id == member_id)
        .filter(TeamMember.team_id == team.id)
        .first()
    )
    if not member:
        raise HTTPException(status_code=404, detail="Team member not found.")
    role = (payload.role_in_team or "").strip().lower()
    if role not in _VALID_ROLES_IN_TEAM:
        raise HTTPException(
            status_code=400,
            detail=f"role_in_team must be one of: {', '.join(sorted(_VALID_ROLES_IN_TEAM))}.",
        )
    member.role_in_team = role
    db.commit()
    db.refresh(member)
    return _serialize_member(member)


@router.delete("/{team_id}/members/{member_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_member(
    team_id: int,
    member_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    team = _get_team_for_user(team_id, current_user, db)
    member = (
        db.query(TeamMember)
        .filter(TeamMember.id == member_id)
        .filter(TeamMember.team_id == team.id)
        .first()
    )
    if not member:
        raise HTTPException(status_code=404, detail="Team member not found.")
    db.delete(member)
    db.commit()
    return None
