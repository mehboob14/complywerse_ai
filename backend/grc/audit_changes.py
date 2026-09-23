"""What a request changed in the database, for its audit row.

A SQLAlchemy after_flush hook notes every record the request's sessions
created, updated or deleted: its table, id and name, and old → new for each
column that changed (every column for a new record). The audit middleware
opens a bucket per request (start/finish); outside a request — Celery workers,
the workflow runtime — there is no bucket and nothing is collected. Secrets are
masked, long values cut short, and the list capped so a bulk import can't bloat
the row.
"""
import contextvars
import json
from datetime import date, datetime
from decimal import Decimal
from typing import Any, Dict, Optional

from sqlalchemy import event, inspect, select
from sqlalchemy.orm import Session

from .rich_audit import is_sensitive_key

MAX_RECORDS = 30
MAX_FIELDS = 25
MAX_VALUE = 200
MAX_CHARS = 16_000  # the whole list, serialised
# Bookkeeping that changes on almost every write and says nothing on its own.
_QUIET_FIELDS = {"updated_at", "modified_at", "last_updated", "last_modified", "updated_on", "version_id"}
_NAME_FIELDS = ("name", "title", "display_name", "username", "email", "label", "item_number",
                "reference", "reference_id", "code", "control_id", "file_name", "filename")

_bucket: contextvars.ContextVar = contextvars.ContextVar("audit_changes", default=None)


def start() -> contextvars.Token:
    return _bucket.set({"records": [], "more": 0, "chars": 0})


def finish(token: contextvars.Token) -> Optional[Dict[str, Any]]:
    data = _bucket.get()
    _bucket.reset(token)
    if not data or not (data["records"] or data["more"]):
        return None
    return {"records": data["records"], "more": data["more"]}


# The audit rows themselves, and the per-call AI usage meter the OpenAI shim
# writes inside requests.
_SKIP_TABLES = {"grc_audit_logs", "ai_usage_events"}


def _skip_table(name: str) -> bool:
    return name in _SKIP_TABLES


def _value(v: Any) -> Any:
    if v is None or isinstance(v, (bool, int, float)):
        return v
    if isinstance(v, (datetime, date)):
        return v.isoformat()
    if isinstance(v, Decimal):
        return float(v)
    if isinstance(v, (bytes, bytearray, memoryview)):
        return f"<{len(v)} bytes>"
    text = json.dumps(v, default=str) if isinstance(v, (dict, list)) else str(v)
    return text if len(text) <= MAX_VALUE else text[:MAX_VALUE] + "…"


def _record(op: str, obj: Any, old_values: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    state = inspect(obj)
    mapper = state.mapper
    table = getattr(mapper.local_table, "name", "") or mapper.class_.__name__
    if _skip_table(table):
        return None
    loaded = state.dict  # never triggers a load inside the flush
    fields: Dict[str, Any] = {}
    for attr in mapper.column_attrs:
        key = attr.key
        if op == "updated":
            hist = state.attrs[key].history
            if not hist.has_changes():
                continue
            old = hist.deleted[0] if hist.deleted else old_values.get(key)
            new = hist.added[0] if hist.added else None
            if old == new:
                continue
            fields[key] = ["***", "***"] if is_sensitive_key(key) else [_value(old), _value(new)]
        elif op == "created":
            value = loaded.get(key)
            if value is None or value == "" or key == "id":
                continue
            fields[key] = "***" if is_sensitive_key(key) else _value(value)
        if len(fields) >= MAX_FIELDS:
            break
    if op == "updated" and not (set(fields) - _QUIET_FIELDS):
        return None
    try:
        pk = [v for v in mapper.primary_key_from_instance(obj) if v is not None]
    except Exception:  # noqa: BLE001
        pk = []
    name = next((loaded[k] for k in _NAME_FIELDS if isinstance(loaded.get(k), str) and loaded[k].strip()), None)
    rec: Dict[str, Any] = {"op": op, "table": table, "id": pk[0] if len(pk) == 1 else (pk or None)}
    if name:
        rec["name"] = _value(name)
    if fields:
        rec["fields"] = fields
    return rec


# A flush is only a change once its transaction commits: records wait on the
# session, tagged with the transaction (or savepoint) they were flushed in, and
# move to the request's bucket on commit. A rolled-back savepoint drops its own;
# a full rollback drops them all.
_PENDING = "audit_pending"
_OLD = "audit_old_values"


@event.listens_for(Session, "before_flush")
def _remember_old_values(session: Session, _flush_context: Any, _instances: Any) -> None:
    """A field set on a record expired by an earlier commit keeps no old value;
    read it from the row before the flush overwrites it."""
    if _bucket.get() is None:
        return
    try:
        old = session.info.setdefault(_OLD, {})
        with session.no_autoflush:
            for obj in list(session.dirty)[:MAX_RECORDS]:
                state = inspect(obj)
                if not state.persistent:
                    continue
                attrs = [a for a in state.mapper.column_attrs
                         if state.attrs[a.key].history.added and not state.attrs[a.key].history.deleted]
                if not attrs:
                    continue
                pk = state.mapper.primary_key_from_instance(obj)
                where = [col == value for col, value in zip(state.mapper.primary_key, pk)]
                row = session.execute(select(*[a.columns[0] for a in attrs]).where(*where)).first()
                if row is not None:
                    old[id(obj)] = {a.key: value for a, value in zip(attrs, row)}
    except Exception:  # noqa: BLE001 — the audit trail must never break a write
        return


@event.listens_for(Session, "after_flush")
def _collect(session: Session, _flush_context: Any) -> None:
    if _bucket.get() is None:
        return
    try:
        old = session.info.pop(_OLD, {})
        tx = session.get_nested_transaction() or session.get_transaction()
        pending = session.info.setdefault(_PENDING, [])
        for op, objs in (("created", session.new), ("updated", session.dirty), ("deleted", session.deleted)):
            for obj in objs:
                if len(pending) >= MAX_RECORDS:
                    pending.append((tx, None))  # past the cap: only counted
                    continue
                rec = _record(op, obj, old.get(id(obj), {}))
                if rec is not None:
                    pending.append((tx, rec))
    except Exception:  # noqa: BLE001 — the audit trail must never break a write
        return


@event.listens_for(Session, "after_soft_rollback")
def _rolled_back(session: Session, previous_transaction: Any) -> None:
    pending = session.info.get(_PENDING)
    if not pending:
        return
    if getattr(previous_transaction, "nested", False):
        session.info[_PENDING] = [(tx, rec) for tx, rec in pending if tx is not previous_transaction]
    else:
        session.info.pop(_PENDING, None)


@event.listens_for(Session, "after_commit")
def _committed(session: Session) -> None:
    pending = session.info.pop(_PENDING, None)
    data = _bucket.get()
    if not pending or data is None:
        return
    try:
        for _tx, rec in pending:
            size = len(json.dumps(rec, default=str)) if rec is not None else 0
            if rec is None or len(data["records"]) >= MAX_RECORDS or data["chars"] + size > MAX_CHARS:
                data["more"] += 1
                continue
            data["chars"] += size
            data["records"].append(rec)
    except Exception:  # noqa: BLE001
        return
