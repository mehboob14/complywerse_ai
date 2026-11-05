"""The kinds of policy exception an organisation tells apart (DECISIONS D59): a list of its own that the approval rules may name ("a
Technical exception goes to ...").

It is kept as module settings (``governance_exceptions``, list ``exception_type``, services/module_settings.py): defaults in code, stable
values, and taking a type off the list archives it, so an exception that holds it keeps it and its name. The exceptions page offers the
types in use; the Settings > Exception approvals card edits the list. An exception with no type simply has none, and a rule that names
no type fits every exception.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from ...services import module_settings as settings

MODULE, LIST = "governance_exceptions", "exception_type"


def options(db: Session, tenant_id: int, include_archived: bool = True) -> List[Dict[str, Any]]:
    """The organisation's types in the order it set them: [{value, label, archived}]."""
    found = settings.list_options(settings.get_settings(db, tenant_id, MODULE), LIST, include_archived=include_archived)
    return [{"value": o["value"], "label": o["label"], "archived": bool(o.get("archived"))} for o in found]


def labels(db: Session, tenant_id: int) -> Dict[str, str]:
    """value -> name, archived types too (an exception that has one still shows its name)."""
    return {o["value"]: o["label"] for o in options(db, tenant_id)}


def clean(db: Session, tenant_id: int, value: Any, current: Optional[str] = None) -> Optional[str]:
    """The type chosen for an exception: nothing, a type in use, or the one it has already (kept after it was taken off the list)."""
    text = str(value or "").strip()
    if not text:
        return None
    if text == (current or None):
        return text
    found = next((o for o in options(db, tenant_id) if o["value"] == text), None)
    if found is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="The type chosen does not exist.")
    if found["archived"]:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="The type chosen is no longer offered.")
    return text


def check_known(db: Session, tenant_id: int, values: List[str]) -> None:
    """A rule may name only types the organisation has (in use or taken off the list), never a word that was never one."""
    known = {o["value"] for o in options(db, tenant_id)}
    unknown = [v for v in values if v not in known]
    if unknown:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="A type chosen does not exist.")


def save(db: Session, tenant_id: int, rows: List[Dict[str, Any]], by_user_id: Optional[int]) -> List[Dict[str, Any]]:
    """Set the list: each row {value?, label, archived?} (a new type has no value: it is made from its name). A type left out is archived."""
    try:
        settings.save_settings(db, tenant_id, MODULE, {"lists": {LIST: rows}}, user_id=by_user_id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from None
    return options(db, tenant_id)
