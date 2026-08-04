"""Notes, History and derived Alerts for assets and vulnerabilities.

Three things the reference product has that we lacked. Grouped in one router
because they share the same shape (given an entity, return a list) and the
same tenant-scoping.

  * Notes    — a real collaboration thread, backed by `grc_entity_notes`.
  * History  — an audit trail. We write to the existing generic AuditLog on
               asset/vuln edits elsewhere; here we READ it back per entity.
  * Alerts   — DERIVED, not stored. There is no alert producer in our system,
               so a table would be permanently empty. Instead we compute the
               alerts that matter from data we already hold: open KEV/critical
               findings, overdue SLAs, and stale discovery. Populated from day
               one, nothing to maintain.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..models import (
    ASSET_RELATIONSHIP_TYPES, AssetAlertState, AssetRelationship, AuditLog,
    EntityNote, GRCUser, ITAsset, Vulnerability, VulnerabilityAssetLink, get_db,
)
from .auth_router import require_auth, get_user_tenants

logger = logging.getLogger(__name__)
router = APIRouter(tags=["Notes, History & Alerts"])

_VALID_ENTITIES = {"asset", "vulnerability"}


def _check_entity(entity_type: str, entity_id: int, tenants: List[int], db: Session) -> None:
    """404 if the entity doesn't exist in one of the caller's tenants."""
    if entity_type not in _VALID_ENTITIES:
        raise HTTPException(400, f"Unknown entity type '{entity_type}'")
    model = ITAsset if entity_type == "asset" else Vulnerability
    exists = db.query(model.id).filter(
        model.id == entity_id, model.tenant_id.in_(tenants)
    ).first()
    if not exists:
        raise HTTPException(404, f"{entity_type} not found in this tenant")


# ─── Notes ──────────────────────────────────────────────────────────────────

class NoteIn(BaseModel):
    body: str = Field(min_length=1, max_length=8000)


class NoteOut(BaseModel):
    id: int
    body: str
    author_name: Optional[str] = None
    created_at: datetime

    class Config:
        from_attributes = True


@router.get("/notes/{entity_type}/{entity_id}", response_model=List[NoteOut])
def list_notes(entity_type: str, entity_id: int, db: Session = Depends(get_db),
               current_user: GRCUser = Depends(require_auth)):
    tenants = get_user_tenants(current_user, db) or []
    _check_entity(entity_type, entity_id, tenants, db)
    return (
        db.query(EntityNote)
        .filter(
            EntityNote.tenant_id.in_(tenants),
            EntityNote.entity_type == entity_type,
            EntityNote.entity_id == entity_id,
        )
        .order_by(EntityNote.created_at.desc())
        .all()
    )


@router.post("/notes/{entity_type}/{entity_id}", response_model=NoteOut, status_code=201)
def add_note(entity_type: str, entity_id: int, body: NoteIn, db: Session = Depends(get_db),
             current_user: GRCUser = Depends(require_auth)):
    tenants = get_user_tenants(current_user, db) or []
    _check_entity(entity_type, entity_id, tenants, db)
    note = EntityNote(
        tenant_id=tenants[0],
        entity_type=entity_type,
        entity_id=entity_id,
        body=body.body.strip(),
        author_id=current_user.id,
        author_name=getattr(current_user, "display_name", None) or current_user.username,
    )
    db.add(note)
    db.commit()
    db.refresh(note)
    return note


# ─── History (read the generic AuditLog per entity) ──────────────────────────

class HistoryOut(BaseModel):
    id: int
    action: str
    detail: Optional[str] = None
    actor_name: Optional[str] = None
    created_at: Optional[datetime] = None


@router.get("/history/{entity_type}/{entity_id}", response_model=List[HistoryOut])
def entity_history(entity_type: str, entity_id: int, db: Session = Depends(get_db),
                   current_user: GRCUser = Depends(require_auth)):
    """Audit rows for one entity. Empty until edits start being journalled —
    which we do on the asset/vuln update paths."""
    tenants = get_user_tenants(current_user, db) or []
    _check_entity(entity_type, entity_id, tenants, db)
    resource = "it_asset" if entity_type == "asset" else "vulnerability"
    rows = (
        db.query(AuditLog)
        .filter(
            AuditLog.tenant_id.in_(tenants),
            AuditLog.resource_type == resource,
            AuditLog.resource_id == entity_id,          # resource_id is Integer
        )
        .order_by(AuditLog.timestamp.desc())
        .limit(200)
        .all()
    )
    out: List[HistoryOut] = []
    for r in rows:
        changes = r.changes if isinstance(r.changes, dict) else None
        detail = None
        if changes:
            detail = changes.get("detail") or ", ".join(
                f"{k}: {v}" for k, v in list(changes.items())[:4]
            ) or None
        actor = None
        try:
            if r.user is not None:
                actor = getattr(r.user, "display_name", None) or getattr(r.user, "username", None)
        except Exception:
            actor = None
        out.append(HistoryOut(
            id=r.id,
            action=r.action or "changed",
            detail=detail,
            actor_name=actor,
            created_at=r.timestamp,
        ))
    return out


# ─── Alerts (derived, no table) ──────────────────────────────────────────────

class AlertOut(BaseModel):
    severity: str          # 'critical' | 'warning' | 'info'
    title: str
    detail: str
    kind: str              # 'kev' | 'sla' | 'stale' | 'exposure'
    # Human response, read from grc_asset_alert_states. The alert itself is
    # derived; only the response to it is stored.
    status: str = "open"   # open | acknowledged | resolved
    acknowledged_by_name: Optional[str] = None
    resolved_by_name: Optional[str] = None


@router.get("/asset-alerts/{asset_id}", response_model=List[AlertOut])
def asset_alerts(asset_id: int, db: Session = Depends(get_db),
                 current_user: GRCUser = Depends(require_auth)):
    """Alerts computed live from what we already store. No producer, no table."""
    tenants = get_user_tenants(current_user, db) or []
    asset = db.query(ITAsset).filter(
        ITAsset.id == asset_id, ITAsset.tenant_id.in_(tenants)
    ).first()
    if not asset:
        raise HTTPException(404, "Asset not found in this tenant")

    alerts: List[AlertOut] = []
    now = datetime.utcnow()

    # Vulnerabilities on this asset — KEV, criticals, overdue SLA.
    vulns = (
        db.query(Vulnerability)
        .join(VulnerabilityAssetLink, VulnerabilityAssetLink.vulnerability_id == Vulnerability.id)
        .filter(VulnerabilityAssetLink.asset_id == asset_id)
        .all()
    )
    active = [v for v in vulns if (v.status or "").lower() not in ("remediated", "verified", "closed", "resolved", "accepted")]

    kev = [v for v in active if getattr(v, "kev_flag", False)]
    if kev:
        alerts.append(AlertOut(
            severity="critical", kind="kev",
            title=f"{len(kev)} known-exploited finding{'s' if len(kev) != 1 else ''} open",
            detail="Listed in CISA KEV — actively exploited in the wild. Treat as an incident.",
        ))

    crit = [v for v in active if (v.severity or "").lower() == "critical" and not getattr(v, "kev_flag", False)]
    if crit:
        alerts.append(AlertOut(
            severity="critical", kind="kev",
            title=f"{len(crit)} critical-severity finding{'s' if len(crit) != 1 else ''} open",
            detail="Critical CVSS severity, not yet remediated.",
        ))

    overdue = [v for v in active if getattr(v, "due_date", None) and v.due_date < now]
    if overdue:
        alerts.append(AlertOut(
            severity="warning", kind="sla",
            title=f"{len(overdue)} finding{'s' if len(overdue) != 1 else ''} past SLA",
            detail="Remediation due date has passed.",
        ))

    # Exposure.
    if getattr(asset, "internet_facing", False) and active:
        alerts.append(AlertOut(
            severity="warning", kind="exposure",
            title="Internet-facing with open findings",
            detail="This asset is reachable from the internet and has unresolved vulnerabilities.",
        ))

    # Risk acceptances that have lapsed, or are about to.
    #
    # Computed from the dates rather than from `exception_status`, so this is
    # right the moment the date passes — it does not wait for the expiry sweep.
    # An acceptance with no review date is called out separately: "accepted
    # forever" is a decision nobody consciously makes, it's what you get when
    # the field was left blank.
    lapsed, lapsing, undated = [], [], []
    for v in vulns:
        if (getattr(v, "exception_status", None) or "none") not in ("approved", "expired"):
            continue
        exp = getattr(v, "exception_expires_at", None)
        if exp is None:
            undated.append(v)
        elif exp < now:
            lapsed.append(v)
        elif (exp - now).days <= 30:
            lapsing.append(v)

    if lapsed:
        alerts.append(AlertOut(
            severity="critical", kind="exception_expired",
            title=f"{len(lapsed)} risk acceptance{'s have' if len(lapsed) != 1 else ' has'} expired",
            detail="The agreed review date has passed, so the risk is being carried "
                   "without current sign-off. These findings are back in the open queue.",
        ))
    if lapsing:
        soonest = min((v.exception_expires_at for v in lapsing))
        alerts.append(AlertOut(
            severity="warning", kind="exception_expiring",
            title=f"{len(lapsing)} risk acceptance{'s' if len(lapsing) != 1 else ''} up for review",
            detail=f"Earliest review date is {soonest:%d %b %Y}. Re-approve or remediate "
                   "before it lapses.",
        ))
    if undated:
        alerts.append(AlertOut(
            severity="warning", kind="exception_undated",
            title=f"{len(undated)} risk acceptance{'s' if len(undated) != 1 else ''} with no review date",
            detail="Accepted indefinitely. Set a review date so the decision is revisited.",
        ))

    # Stale discovery.
    last_seen = getattr(asset, "last_seen_at", None)
    if last_seen:
        days = (now - last_seen).days if last_seen.tzinfo is None else (datetime.now(timezone.utc) - last_seen).days
        if days > 30:
            alerts.append(AlertOut(
                severity="info", kind="stale",
                title=f"Not seen for {days} days",
                detail="No scan or agent contact recently — the record may be stale.",
            ))

    # Overlay the stored human response onto each derived alert.
    states = {
        s.alert_kind: s
        for s in db.query(AssetAlertState).filter(AssetAlertState.asset_id == asset_id).all()
    }
    for a in alerts:
        st = states.get(a.kind)
        if st:
            a.status = st.status
            a.acknowledged_by_name = st.acknowledged_by_name
            a.resolved_by_name = st.resolved_by_name

    # Unresolved first, then by severity — the same ordering as the reference.
    sev_rank = {"critical": 0, "warning": 1, "info": 2}
    alerts.sort(key=lambda a: (a.status == "resolved", sev_rank.get(a.severity, 3)))
    return alerts


def _set_alert_state(asset_id: int, kind: str, new_status: str,
                     db: Session, current_user: GRCUser) -> AlertOut:
    """Upsert the acknowledgement row for one derived alert."""
    tenants = get_user_tenants(current_user, db) or []
    asset = db.query(ITAsset).filter(
        ITAsset.id == asset_id, ITAsset.tenant_id.in_(tenants)
    ).first()
    if not asset:
        raise HTTPException(404, "Asset not found in this tenant")

    who = getattr(current_user, "display_name", None) or current_user.username
    now = datetime.utcnow()
    st = db.query(AssetAlertState).filter(
        AssetAlertState.asset_id == asset_id, AssetAlertState.alert_kind == kind
    ).first()
    if st is None:
        st = AssetAlertState(tenant_id=asset.tenant_id, asset_id=asset_id, alert_kind=kind)
        db.add(st)

    st.status = new_status
    if new_status == "acknowledged":
        st.acknowledged_by_name = who
        st.acknowledged_at = now
    elif new_status == "resolved":
        st.resolved_by_name = who
        st.resolved_at = now
        # Resolving implies it was seen.
        if not st.acknowledged_at:
            st.acknowledged_by_name, st.acknowledged_at = who, now
    db.commit()
    db.refresh(st)
    return AlertOut(
        severity="info", kind=kind, title="", detail="",
        status=st.status,
        acknowledged_by_name=st.acknowledged_by_name,
        resolved_by_name=st.resolved_by_name,
    )


@router.post("/asset-alerts/{asset_id}/{kind}/acknowledge", response_model=AlertOut)
def acknowledge_alert(asset_id: int, kind: str, db: Session = Depends(get_db),
                      current_user: GRCUser = Depends(require_auth)):
    return _set_alert_state(asset_id, kind, "acknowledged", db, current_user)


@router.post("/asset-alerts/{asset_id}/{kind}/resolve", response_model=AlertOut)
def resolve_alert(asset_id: int, kind: str, db: Session = Depends(get_db),
                  current_user: GRCUser = Depends(require_auth)):
    return _set_alert_state(asset_id, kind, "resolved", db, current_user)


# ─── Asset relationships (the CMDB edge) ────────────────────────────────────

class RelationshipIn(BaseModel):
    target_asset_id: int
    relationship_type: str = Field(default="depends_on")
    notes: Optional[str] = None


class RelationshipOut(BaseModel):
    id: int
    relationship_type: str
    direction: str            # 'outgoing' | 'incoming'
    other_asset_id: int
    other_asset_name: Optional[str] = None
    other_asset_criticality: Optional[str] = None
    notes: Optional[str] = None
    created_by_name: Optional[str] = None


@router.get("/assets/{asset_id}/relationships", response_model=List[RelationshipOut])
def list_relationships(asset_id: int, db: Session = Depends(get_db),
                       current_user: GRCUser = Depends(require_auth)):
    """Every edge touching this asset, in BOTH directions.

    Direction is preserved so the UI can say "depends on X" vs "is depended on
    by Y" — collapsing them would lose the meaning of the edge.
    """
    tenants = get_user_tenants(current_user, db) or []
    _check_entity("asset", asset_id, tenants, db)

    rows = db.query(AssetRelationship).filter(
        AssetRelationship.tenant_id.in_(tenants),
        (AssetRelationship.source_asset_id == asset_id)
        | (AssetRelationship.target_asset_id == asset_id),
    ).all()

    # One lookup for every counterpart asset rather than N queries.
    other_ids = {r.target_asset_id if r.source_asset_id == asset_id else r.source_asset_id for r in rows}
    others = {}
    if other_ids:
        for a in db.query(ITAsset).filter(ITAsset.id.in_(other_ids)).all():
            others[a.id] = a

    out: List[RelationshipOut] = []
    for r in rows:
        outgoing = r.source_asset_id == asset_id
        oid = r.target_asset_id if outgoing else r.source_asset_id
        a = others.get(oid)
        out.append(RelationshipOut(
            id=r.id,
            relationship_type=r.relationship_type,
            direction="outgoing" if outgoing else "incoming",
            other_asset_id=oid,
            other_asset_name=a.name if a else None,
            other_asset_criticality=a.criticality if a else None,
            notes=r.notes,
            created_by_name=r.created_by_name,
        ))
    return out


@router.post("/assets/{asset_id}/relationships", response_model=RelationshipOut, status_code=201)
def create_relationship(asset_id: int, body: RelationshipIn, db: Session = Depends(get_db),
                        current_user: GRCUser = Depends(require_auth)):
    tenants = get_user_tenants(current_user, db) or []
    _check_entity("asset", asset_id, tenants, db)
    _check_entity("asset", body.target_asset_id, tenants, db)

    if body.relationship_type not in ASSET_RELATIONSHIP_TYPES:
        raise HTTPException(400, f"relationship_type must be one of {', '.join(ASSET_RELATIONSHIP_TYPES)}")
    if body.target_asset_id == asset_id:
        raise HTTPException(400, "An asset cannot be related to itself")

    existing = db.query(AssetRelationship).filter(
        AssetRelationship.source_asset_id == asset_id,
        AssetRelationship.target_asset_id == body.target_asset_id,
        AssetRelationship.relationship_type == body.relationship_type,
    ).first()
    if existing:
        raise HTTPException(409, "That relationship already exists")

    rel = AssetRelationship(
        tenant_id=tenants[0],
        source_asset_id=asset_id,
        target_asset_id=body.target_asset_id,
        relationship_type=body.relationship_type,
        notes=body.notes,
        created_by_id=current_user.id,
        created_by_name=getattr(current_user, "display_name", None) or current_user.username,
    )
    db.add(rel)
    db.commit()
    db.refresh(rel)

    target = db.query(ITAsset).filter(ITAsset.id == body.target_asset_id).first()
    return RelationshipOut(
        id=rel.id, relationship_type=rel.relationship_type, direction="outgoing",
        other_asset_id=body.target_asset_id,
        other_asset_name=target.name if target else None,
        other_asset_criticality=target.criticality if target else None,
        notes=rel.notes, created_by_name=rel.created_by_name,
    )


@router.delete("/assets/{asset_id}/relationships/{rel_id}", status_code=204)
def delete_relationship(asset_id: int, rel_id: int, db: Session = Depends(get_db),
                        current_user: GRCUser = Depends(require_auth)):
    tenants = get_user_tenants(current_user, db) or []
    rel = db.query(AssetRelationship).filter(
        AssetRelationship.id == rel_id,
        AssetRelationship.tenant_id.in_(tenants),
    ).first()
    if not rel:
        raise HTTPException(404, "Relationship not found")
    # Either end may remove the edge — it is one shared fact, not two.
    if asset_id not in (rel.source_asset_id, rel.target_asset_id):
        raise HTTPException(400, "That relationship does not involve this asset")
    db.delete(rel)
    db.commit()
    return None


@router.get("/asset-relationship-types", response_model=List[str])
def relationship_types(current_user: GRCUser = Depends(require_auth)):
    return list(ASSET_RELATIONSHIP_TYPES)
