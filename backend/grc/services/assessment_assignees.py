"""Who an assessment item is assigned to: any number of people and/or teams.

Stored on the item as [{"type": "user" | "team", "id": n}]. Names are looked up
when the item is read, so a rename shows everywhere and a user or team that was
deleted simply drops off the list.
"""
from typing import Dict, Iterable, List

from sqlalchemy.orm import Session

from ..models import GRCUser, Team

KINDS = ("user", "team")


def clean(raw) -> List[dict]:
    """The assignees as stored: known kinds only, ids as ints, no repeats."""
    out, seen = [], set()
    for a in raw or []:
        kind = a.get("type") if isinstance(a, dict) else None
        try:
            ident = int(a.get("id"))
        except (AttributeError, TypeError, ValueError):
            continue
        if kind in KINDS and (kind, ident) not in seen:
            seen.add((kind, ident))
            out.append({"type": kind, "id": ident})
    return out


def _names(db: Session, wanted: Iterable[dict]) -> Dict[tuple, str]:
    ids = {k: {a["id"] for a in wanted if a["type"] == k} for k in KINDS}
    names: Dict[tuple, str] = {}
    if ids["user"]:
        for uid, display, username in db.query(GRCUser.id, GRCUser.display_name, GRCUser.username).filter(GRCUser.id.in_(ids["user"])):
            names[("user", uid)] = display or username
    if ids["team"]:
        for tid, name in db.query(Team.id, Team.name).filter(Team.id.in_(ids["team"])):
            names[("team", tid)] = name
    return names


def lists_for(db: Session, items: Iterable) -> Dict[int, List[dict]]:
    """{item id: [{"type", "id", "name"}]} for many items, names looked up once."""
    stored = {it.id: clean(it.assignees) for it in items}
    names = _names(db, [a for lst in stored.values() for a in lst])
    return {iid: [{**a, "name": names[(a["type"], a["id"])]} for a in lst if (a["type"], a["id"]) in names]
            for iid, lst in stored.items()}


def missing(db: Session, wanted: List[dict]) -> List[dict]:
    """The assignees in `wanted` that name no active user / no team in this tenant."""
    ids = {k: {a["id"] for a in wanted if a["type"] == k} for k in KINDS}
    found = set()
    if ids["user"]:
        found |= {("user", r[0]) for r in db.query(GRCUser.id).filter(GRCUser.id.in_(ids["user"]), GRCUser.is_active.is_(True))}
    if ids["team"]:
        found |= {("team", r[0]) for r in db.query(Team.id).filter(Team.id.in_(ids["team"]))}
    return [a for a in wanted if (a["type"], a["id"]) not in found]


def label(assignees: List[dict]) -> str:
    """The names on one line, for exports and plain-text columns."""
    return ", ".join(a["name"] for a in assignees)
