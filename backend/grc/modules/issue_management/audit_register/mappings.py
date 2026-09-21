"""The register's names, mapped once to the platform's records.

The workbook writes owners as "Rivera, P" or "ROBIN" and lines of business as
"BSA/AML" or "Corp Gov". Most owners match a user on their own; the rest are
mapped here by hand, once, and every later import uses the mapping. A line of
business maps to a business unit, or creates one.
"""
from __future__ import annotations

from collections import Counter
from typing import Any, Dict, List, Optional

from sqlalchemy.orm import Session

from ....models import (AuditIssueProfile, AuditRegisterAlias, BusinessUnit, GRCUser, Issue,
                        IssueAction, IssueActivity)
from .crosslinks import alias_key, business_unit_for, sync_crosslinks
from .service import build_owner_index, match_owner


def _aliases(db: Session, tenant_id: int, kind: str) -> Dict[str, AuditRegisterAlias]:
    return {a.alias_key: a for a in db.query(AuditRegisterAlias)
            .filter(AuditRegisterAlias.tenant_id == tenant_id, AuditRegisterAlias.kind == kind)}


def _set_alias(db: Session, tenant_id: int, kind: str, raw: str, target_id: Optional[int],
               actor_id: Optional[int]) -> None:
    key = alias_key(raw)
    if not key:
        raise ValueError("A name is required")
    alias = _aliases(db, tenant_id, kind).get(key)
    if target_id is None:
        if alias:
            db.delete(alias)
        return
    if alias:
        alias.target_id, alias.raw_name = target_id, raw
    else:
        db.add(AuditRegisterAlias(tenant_id=tenant_id, kind=kind, alias_key=key, raw_name=raw,
                                  target_id=target_id, created_by=actor_id))
    db.flush()


def _profiles_named(db: Session, tenant_id: int, column, raw: str) -> List[AuditIssueProfile]:
    key = alias_key(raw)
    return [p for p in db.query(AuditIssueProfile)
            .filter(AuditIssueProfile.tenant_id == tenant_id, AuditIssueProfile.deleted_at.is_(None),
                    column.isnot(None)).all()
            if alias_key(getattr(p, column.key)) == key]


# ── owners ───────────────────────────────────────────────────────────────────

def owner_mappings(db: Session, tenant_id: int) -> Dict[str, Any]:
    counts = Counter(p.owner_name_raw for p in db.query(AuditIssueProfile)
                     .filter(AuditIssueProfile.tenant_id == tenant_id,
                             AuditIssueProfile.deleted_at.is_(None),
                             AuditIssueProfile.owner_name_raw.isnot(None)).all())
    index = build_owner_index(db)
    mapped = _aliases(db, tenant_id, "owner")
    users = {u.id: u for u in db.query(GRCUser).all()}
    rows = []
    for raw, count in counts.items():
        user_id = match_owner(raw, index)
        user = users.get(user_id)
        rows.append({
            "name": raw, "findings": count, "user_id": user_id,
            "user_name": (getattr(user, "display_name", None) or user.username) if user else None,
            "how": "mapped" if alias_key(raw) in mapped else ("matched" if user_id else "unmatched"),
        })
    rows.sort(key=lambda r: (r["how"] != "unmatched", r["name"].lower()))
    return {"rows": rows,
            "users": [{"id": u.id, "name": getattr(u, "display_name", None) or u.username,
                       "email": u.email} for u in users.values()]}


def set_owner_mapping(db: Session, tenant_id: int, raw: str, user_id: Optional[int],
                      actor: Optional[GRCUser] = None) -> int:
    """Map (or unmap) a workbook owner name; returns how many findings moved."""
    if user_id is not None and not db.get(GRCUser, user_id):
        raise ValueError("owner must be a platform user")
    _set_alias(db, tenant_id, "owner", raw, user_id, getattr(actor, "id", None))
    target = user_id if user_id is not None else match_owner(raw, build_owner_index(db))
    moved = 0
    for profile in _profiles_named(db, tenant_id, AuditIssueProfile.owner_name_raw, raw):
        issue = db.get(Issue, profile.issue_id)
        if "owner" in (profile.edited_fields or []) or issue.owner_id == target:
            continue                   # set by hand on the finding itself: that wins
        db.add(IssueActivity(issue_id=issue.id, user_id=getattr(actor, "id", None),
                             type="register_edit",
                             payload={"changes": {"owner": [issue.owner_id, target]},
                                      "via": f"owner mapping for {raw!r}"}))
        issue.owner_id = target
        action = (db.query(IssueAction)
                  .filter(IssueAction.issue_id == issue.id,
                          IssueAction.action_type == "corrective").first())
        if action:
            action.assignee_id = target
        sync_crosslinks(db, issue, profile, actor_id=getattr(actor, "id", None))
        moved += 1
    return moved


# ── lines of business ────────────────────────────────────────────────────────

def lob_mappings(db: Session, tenant_id: int) -> Dict[str, Any]:
    counts = Counter(p.lob for p in db.query(AuditIssueProfile)
                     .filter(AuditIssueProfile.tenant_id == tenant_id,
                             AuditIssueProfile.deleted_at.is_(None),
                             AuditIssueProfile.lob.isnot(None)).all())
    units = {u.id: u for u in db.query(BusinessUnit).filter(BusinessUnit.tenant_id == tenant_id)}
    mapped = _aliases(db, tenant_id, "lob")
    rows = []
    for raw, count in counts.items():
        unit_id = business_unit_for(db, tenant_id, raw)
        rows.append({"name": raw, "findings": count, "business_unit_id": unit_id,
                     "business_unit": units[unit_id].name if unit_id in units else None,
                     "how": ("mapped" if alias_key(raw) in mapped
                             else "same name" if unit_id else "unmapped")})
    rows.sort(key=lambda r: (r["how"] != "unmapped", r["name"].lower()))
    return {"rows": rows,
            "business_units": sorted(({"id": u.id, "name": u.name} for u in units.values()),
                                     key=lambda u: u["name"].lower())}


def set_lob_mapping(db: Session, tenant_id: int, raw: str, business_unit_id: Optional[int] = None,
                    create: bool = False, actor: Optional[GRCUser] = None) -> Dict[str, Any]:
    """Map a LOB to a business unit, or create a unit named after it."""
    if create:
        unit = BusinessUnit(tenant_id=tenant_id, name=raw.strip()[:255])
        db.add(unit)
        db.flush()
        business_unit_id = unit.id
    elif business_unit_id is not None and not (
            db.query(BusinessUnit).filter(BusinessUnit.id == business_unit_id,
                                          BusinessUnit.tenant_id == tenant_id).first()):
        raise ValueError("That business unit was not found")
    _set_alias(db, tenant_id, "lob", raw, business_unit_id, getattr(actor, "id", None))
    moved = 0
    for profile in _profiles_named(db, tenant_id, AuditIssueProfile.lob, raw):
        unit_id = business_unit_for(db, tenant_id, profile.lob)
        if profile.business_unit_id != unit_id:
            profile.business_unit_id = unit_id
            moved += 1
    return {"business_unit_id": business_unit_id, "findings": moved}
