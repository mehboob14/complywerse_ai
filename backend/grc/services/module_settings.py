"""Status levels, SLA days and extra fields a tenant sets for itself, per module.

One JSON document per (tenant, module), defaults in code, every patched key
validated — the shape the audit issue register already proved. Three things it
deliberately does:

* **Status levels are data.** They were Python constants in fifteen places, so
  nobody could add "Awaiting regulator" without a release. A module that opts in
  validates writes against the configured list instead of a hardcoded set.
* **SLA state is computed on read, never stored.** A tenant shortening an SLA
  must change what every open record shows immediately, with no backfill and no
  sweep. The reminder sweep, when it runs, reads the same numbers.
* **Extra field values are validated.** Every other user-defined-field mechanism
  in this repo stores whatever it is handed; a required field that is never
  enforced is not a required field.

Removing a field archives it rather than dropping it, because the values already
recorded against it are audit evidence.
"""
from __future__ import annotations

import re
from copy import deepcopy
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

from sqlalchemy.orm import Session

from ..models import ModuleSettings

KEY = re.compile(r"^[a-z][a-z0-9_]{1,39}$")
TONES = ("slate", "blue", "amber", "emerald", "rose", "violet")
FIELD_TYPES = ("text", "textarea", "number", "date", "select", "multiselect", "checkbox", "user")
_MAX_DAYS = 3650
_OPTION_TYPES = ("select", "multiselect")


def _status(key: str, label: str, order: int, *, terminal: bool = False,
            tone: str = "slate", escalate_after_days: Optional[int] = None) -> Dict[str, Any]:
    return {"key": key, "label": label, "order": order, "terminal": terminal,
            "tone": tone, "escalate_after_days": escalate_after_days}


# What each module ships with. `permissions` gate its settings; `priorities`
# bound the SLA table to the vocabulary the records actually use.
MODULES: Dict[str, Dict[str, Any]] = {
    "statutory_audit": {
        "label": "Statutory Audit",
        "record": "Observation",
        "permissions": {"view": "compliance:assessments:view", "edit": "compliance:assessments:edit"},
        "priorities": ("critical", "high", "medium", "low"),
        "defaults": {
            "statuses": [
                _status("open", "Open", 1, tone="amber", escalate_after_days=14),
                _status("in_progress", "In progress", 2, tone="blue", escalate_after_days=30),
                _status("complied", "Complied", 3, tone="emerald"),
                _status("closed", "Closed", 4, terminal=True, tone="slate"),
                _status("cancelled", "Cancelled", 5, terminal=True, tone="slate"),
            ],
            "sla": {"by_priority": {"critical": 30, "high": 60, "medium": 90, "low": 180},
                    "due_soon_days": 7, "escalate_after_days": 14, "escalate_to": [],
                    "remind_before_due": 3, "repeat_every": 7},
            "fields": [],
        },
    },
    "internal_audit": {
        "label": "Internal Audit",
        "record": "Audit",
        "permissions": {"view": "compliance:assessments:view", "edit": "compliance:assessments:edit"},
        "priorities": ("critical", "high", "medium", "low"),
        "defaults": {
            "statuses": [
                _status("planned", "Planned", 1, tone="slate", escalate_after_days=7),
                _status("in_progress", "In progress", 2, tone="blue", escalate_after_days=14),
                _status("completed", "Completed", 3, terminal=True, tone="emerald"),
                _status("cancelled", "Cancelled", 4, terminal=True, tone="slate"),
            ],
            "sla": {"by_priority": {"critical": 30, "high": 60, "medium": 90, "low": 120},
                    "due_soon_days": 7, "escalate_after_days": 14, "escalate_to": [],
                    "remind_before_due": 3, "repeat_every": 7},
            "fields": [],
        },
    },
}


def spec(module_key: str) -> Dict[str, Any]:
    if module_key not in MODULES:
        raise ValueError(f"Unknown module '{module_key}'. One of {sorted(MODULES)}")
    return MODULES[module_key]


# ── read ─────────────────────────────────────────────────────────────────────

def get_settings(db: Session, tenant_id: int, module_key: str) -> Dict[str, Any]:
    """The tenant's settings, defaults filled in. No row is needed."""
    module = spec(module_key)
    merged = deepcopy(module["defaults"])
    row = db.query(ModuleSettings).filter(
        ModuleSettings.tenant_id == tenant_id, ModuleSettings.module_key == module_key).first()
    stored = (row.config if isinstance(getattr(row, "config", None), dict) else {}) or {}
    if isinstance(stored.get("statuses"), list) and stored["statuses"]:
        merged["statuses"] = stored["statuses"]
    if isinstance(stored.get("fields"), list):
        merged["fields"] = stored["fields"]
    if isinstance(stored.get("sla"), dict):
        merged["sla"].update({k: v for k, v in stored["sla"].items() if k in merged["sla"]})
    merged["statuses"] = sorted(merged["statuses"], key=lambda s: (s.get("order") or 0, s.get("label") or ""))
    merged["fields"] = sorted(merged["fields"], key=lambda f: (f.get("order") or 0, f.get("label") or ""))
    merged["module"] = {"key": module_key, "label": module["label"], "record": module["record"],
                        "priorities": list(module["priorities"])}
    merged["updated_at"] = row.updated_at.isoformat() if row is not None and row.updated_at else None
    return merged


def status_keys(settings: Dict[str, Any]) -> List[str]:
    return [str(s["key"]) for s in settings.get("statuses") or []]


def is_terminal(settings: Dict[str, Any], status: Optional[str]) -> bool:
    key = (status or "").strip().lower()
    return any(s.get("terminal") and str(s.get("key")) == key for s in settings.get("statuses") or [])


def active_fields(settings: Dict[str, Any]) -> List[Dict[str, Any]]:
    return [f for f in settings.get("fields") or [] if not f.get("archived")]


# ── validation ───────────────────────────────────────────────────────────────

def _int(value: Any, name: str, low: int, high: int, allow_none: bool = False) -> Optional[int]:
    if value is None and allow_none:
        return None
    try:
        number = int(value)
    except (TypeError, ValueError):
        raise ValueError(f"{name} must be a whole number")
    if not low <= number <= high:
        raise ValueError(f"{name} must be between {low} and {high}")
    return number


def _text(value: Any, name: str, limit: int, required: bool = True) -> str:
    cleaned = " ".join(str(value or "").split())[:limit]
    if required and not cleaned:
        raise ValueError(f"{name} is required")
    return cleaned


def _clean_statuses(raw: Any) -> List[Dict[str, Any]]:
    if not isinstance(raw, list) or not raw:
        raise ValueError("At least one status level is needed")
    out, seen = [], set()
    for index, item in enumerate(raw):
        if not isinstance(item, dict):
            raise ValueError("Each status level must be an object")
        key = str(item.get("key") or "").strip().lower()
        if not KEY.match(key):
            raise ValueError(f"Status key '{key}' must be lower case letters, digits and underscores")
        if key in seen:
            raise ValueError(f"Status '{key}' is listed twice")
        seen.add(key)
        tone = str(item.get("tone") or "slate").lower()
        out.append({
            "key": key,
            "label": _text(item.get("label") or key, "Status label", 60),
            "order": _int(item.get("order", index + 1), "Status order", 0, 999),
            "terminal": bool(item.get("terminal")),
            "tone": tone if tone in TONES else "slate",
            "escalate_after_days": _int(item.get("escalate_after_days"), "Days to escalation",
                                        0, _MAX_DAYS, allow_none=True),
        })
    if not any(s["terminal"] for s in out):
        raise ValueError("One status level must be marked as closing the record")
    return sorted(out, key=lambda s: (s["order"], s["label"]))


def _clean_sla(raw: Any, module: Dict[str, Any], current: Dict[str, Any]) -> Dict[str, Any]:
    if not isinstance(raw, dict):
        raise ValueError("SLA settings must be an object")
    sla = deepcopy(current)
    for key, value in raw.items():
        if key == "by_priority":
            if not isinstance(value, dict):
                raise ValueError("SLA days must be given per priority")
            for priority, days in value.items():
                if priority not in module["priorities"]:
                    raise ValueError(f"Unknown priority '{priority}'")
                sla["by_priority"][priority] = _int(days, f"SLA days for {priority}", 0, _MAX_DAYS)
        elif key in ("due_soon_days", "remind_before_due", "repeat_every"):
            sla[key] = _int(value, key.replace("_", " "), 0, 365)
        elif key == "escalate_after_days":
            sla[key] = _int(value, "days to escalation", 0, _MAX_DAYS)
        elif key == "escalate_to":
            if not isinstance(value, list) or len(value) > 10:
                raise ValueError("Escalate to must be a list of at most 10 entries")
            targets = []
            for entry in value:
                target = _text(entry, "escalation target", 80)
                if not (target.startswith("role:") or target.startswith("user:")):
                    raise ValueError(f"'{target}' must start with 'role:' or 'user:'")
                targets.append(target)
            sla["escalate_to"] = targets
        else:
            raise ValueError(f"Unknown SLA setting '{key}'")
    return sla


def _clean_fields(raw: Any, existing: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    if not isinstance(raw, list):
        raise ValueError("Fields must be a list")
    out, seen = [], set()
    for index, item in enumerate(raw):
        if not isinstance(item, dict):
            raise ValueError("Each field must be an object")
        key = str(item.get("key") or "").strip().lower()
        if not KEY.match(key):
            raise ValueError(f"Field key '{key}' must be lower case letters, digits and underscores")
        if key in seen:
            raise ValueError(f"Field '{key}' is listed twice")
        seen.add(key)
        kind = str(item.get("type") or "text").lower()
        if kind not in FIELD_TYPES:
            raise ValueError(f"Field type '{kind}' must be one of {', '.join(FIELD_TYPES)}")
        options: List[str] = []
        if kind in _OPTION_TYPES:
            values = item.get("options")
            if not isinstance(values, list) or not values:
                raise ValueError(f"Field '{key}' is a {kind}, so it needs at least one option")
            for option in values[:50]:
                options.append(_text(option, "option", 80))
        out.append({
            "key": key,
            "label": _text(item.get("label") or key, "Field label", 80),
            "type": kind,
            "required": bool(item.get("required")),
            "options": options,
            "help": _text(item.get("help"), "help text", 200, required=False),
            "order": _int(item.get("order", index + 1), "field order", 0, 999),
            "archived": bool(item.get("archived")),
        })
    # A field taken out of the list is archived, not dropped: values already
    # recorded against it are evidence.
    for old in existing:
        if str(old.get("key")) not in seen:
            kept = deepcopy(old)
            kept["archived"] = True
            out.append(kept)
    return sorted(out, key=lambda f: (f["order"], f["label"]))


def save_settings(db: Session, tenant_id: int, module_key: str, patch: Dict[str, Any],
                  user_id: Optional[int] = None) -> Dict[str, Any]:
    """Apply a patch of whole sections. Unknown keys are refused rather than
    quietly stored, so a typo cannot look like a saved setting."""
    module = spec(module_key)
    if not isinstance(patch, dict) or not patch:
        raise ValueError("Nothing to save")
    current = get_settings(db, tenant_id, module_key)
    row = db.query(ModuleSettings).filter(
        ModuleSettings.tenant_id == tenant_id, ModuleSettings.module_key == module_key).first()
    stored = deepcopy(row.config) if row is not None and isinstance(row.config, dict) else {}

    for section, value in patch.items():
        if section == "statuses":
            stored["statuses"] = _clean_statuses(value)
        elif section == "sla":
            stored["sla"] = _clean_sla(value, module, current["sla"])
        elif section == "fields":
            stored["fields"] = _clean_fields(value, current.get("fields") or [])
        else:
            raise ValueError(f"Unknown settings section '{section}'")

    if row is None:
        row = ModuleSettings(tenant_id=tenant_id, module_key=module_key, config=stored)
        db.add(row)
    else:
        row.config = stored
    row.updated_by = user_id
    row.updated_at = datetime.utcnow()
    db.commit()
    return get_settings(db, tenant_id, module_key)


# ── the clock ────────────────────────────────────────────────────────────────

def target_days(settings: Dict[str, Any], priority: Optional[str]) -> Optional[int]:
    by_priority = (settings.get("sla") or {}).get("by_priority") or {}
    return by_priority.get((priority or "").strip().lower())


def sla_state(settings: Dict[str, Any], *, status: Optional[str], due_date: Optional[datetime],
              priority: Optional[str] = None, opened_at: Optional[datetime] = None,
              now: Optional[datetime] = None) -> Dict[str, Any]:
    """Where this record stands against the tenant's SLA, computed fresh.

    With no due date of its own, one is implied from when the record opened plus
    the days its priority allows — otherwise a record without a date is invisible
    to an SLA it is nonetheless subject to.
    """
    now = now or datetime.utcnow()
    days = target_days(settings, priority)
    implied = None
    if due_date is None and opened_at is not None and days is not None:
        implied = opened_at + timedelta(days=days)
    deadline = due_date or implied
    state = {"state": "no_due_date", "days_overdue": None, "due_in_days": None,
             "target_days": days, "due_date": deadline.isoformat() if deadline else None,
             "implied_due_date": implied is not None, "escalate_after_days": None, "escalated": False}

    if is_terminal(settings, status):
        state["state"] = "closed"
        return state
    if deadline is None:
        return state

    overdue_days = (now.date() - deadline.date()).days
    due_soon = (settings.get("sla") or {}).get("due_soon_days") or 0
    if overdue_days > 0:
        state.update(state="breached", days_overdue=overdue_days, due_in_days=-overdue_days)
    elif -overdue_days <= due_soon:
        state.update(state="due_soon", days_overdue=0, due_in_days=-overdue_days)
    else:
        state.update(state="on_track", days_overdue=0, due_in_days=-overdue_days)

    # Per-status days win over the module default; either may be unset.
    per_status = next((s.get("escalate_after_days") for s in settings.get("statuses") or []
                       if str(s.get("key")) == (status or "").strip().lower()), None)
    after = per_status if per_status is not None else (settings.get("sla") or {}).get("escalate_after_days")
    state["escalate_after_days"] = after
    if after is not None and state["state"] == "breached" and overdue_days >= after:
        state["escalated"] = True
    return state


# ── extra field values ───────────────────────────────────────────────────────

def validate_custom_values(settings: Dict[str, Any], values: Any, *,
                           partial: bool = False) -> Dict[str, Any]:
    """Clean a record's extra field values against the tenant's definitions.

    `partial` is for a PATCH: only the keys given are checked, and a required
    field that was not sent is left alone.
    """
    if values is None:
        values = {}
    if not isinstance(values, dict):
        raise ValueError("Field values must be an object")
    by_key = {str(f["key"]): f for f in settings.get("fields") or []}
    cleaned: Dict[str, Any] = {}

    for key, value in values.items():
        field = by_key.get(str(key))
        if field is None:
            raise ValueError(f"'{key}' is not a field on this record")
        if field.get("archived"):
            raise ValueError(f"'{field['label']}' has been removed and cannot be set")
        kind = field["type"]
        if value in (None, ""):
            cleaned[key] = None
            continue
        if kind == "number":
            try:
                cleaned[key] = float(value) if not float(value).is_integer() else int(float(value))
            except (TypeError, ValueError):
                raise ValueError(f"'{field['label']}' must be a number")
        elif kind == "checkbox":
            cleaned[key] = bool(value) if not isinstance(value, str) else value.strip().lower() in (
                "1", "true", "yes", "on")
        elif kind == "date":
            text = str(value).strip()[:10]
            try:
                datetime.strptime(text, "%Y-%m-%d")
            except ValueError:
                raise ValueError(f"'{field['label']}' must be a date as YYYY-MM-DD")
            cleaned[key] = text
        elif kind == "select":
            text = _text(value, field["label"], 200)
            if text not in field["options"]:
                raise ValueError(f"'{field['label']}' must be one of: {', '.join(field['options'])}")
            cleaned[key] = text
        elif kind == "multiselect":
            if not isinstance(value, list):
                raise ValueError(f"'{field['label']}' must be a list")
            picked = []
            for entry in value[:50]:
                text = _text(entry, field["label"], 200)
                if text not in field["options"]:
                    raise ValueError(f"'{field['label']}' must be one of: {', '.join(field['options'])}")
                picked.append(text)
            cleaned[key] = picked
        elif kind == "user":
            cleaned[key] = _int(value, field["label"], 1, 2_147_483_647)
        else:
            cleaned[key] = _text(value, field["label"], 4000, required=False)

    if not partial:
        for field in active_fields(settings):
            if field.get("required") and cleaned.get(field["key"]) in (None, "", []):
                raise ValueError(f"'{field['label']}' is required")
    return cleaned
