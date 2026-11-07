"""Scheduled & emailed reports - the logic (no HTTP, no Celery).

Generation REUSES the Report Builder's own export endpoint function
(`grc.routers.reporting_router.export_dataset`, which itself reuses
`search_router._report_export`) by import, called as a plain function with the
schedule OWNER as the acting user. So a scheduled file is byte-for-byte what the
same owner would download from the builder: same dataset permission gate, same
tenant scoping, same filter/sort engine, same CSV / XLSX / PDF writers, same row cap.

Safety rules that matter for something that emails data on a timer:
  * a run executes with the permissions of the schedule's CREATOR (re-checked on every
    run - a user who loses the dataset permission stops getting that report);
  * a filter that cannot be applied FAILS the run instead of silently broadening it
    (the export engine skips an unusable filter; for an emailed report that would leak
    more rows than the author intended);
  * "claiming" a due schedule advances next_run with a compare-and-set UPDATE before it is
    sent, so two workers / two beat ticks can never double-send.
"""
from __future__ import annotations

import asyncio
import calendar
import concurrent.futures
import html as _html
import importlib
import logging
import re
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

from fastapi import HTTPException
from sqlalchemy.orm import Session

from grc.models import GRCUser, ReportDefinition, Tenant

from . import mailer
from .models import ScheduledReport

logger = logging.getLogger(__name__)

FREQUENCIES = ("daily", "weekly", "monthly")
FORMATS = ("csv", "xlsx", "pdf")
MAX_RECIPIENTS = 25
MAX_SCHEDULES_PER_TENANT = 200
MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024          # most mail servers refuse more
DEFAULT_HOUR_UTC = 6

_MIME = {
    "csv": "text/csv",
    "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "pdf": "application/pdf",
}
_EXT_BY_MEDIA = {
    "text/csv": "csv",
    "application/pdf": "pdf",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
}

# Operators the export engine understands per filter kind (reporting_router._build_condition).
_OPS_BY_KIND = {
    "text": {"eq", "neq", "contains", "notcontains", "starts", "empty", "notempty"},
    "badge": {"eq", "neq", "contains", "notcontains", "starts", "empty", "notempty"},
    "number": {"eq", "neq", "gt", "lt", "gte", "lte", "empty", "notempty"},
    "date": {"before", "after", "on", "empty", "notempty"},
}
_NO_VALUE_OPS = {"empty", "notempty"}

_EMAIL_RE = re.compile(
    r"^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?"
    r"(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$"
)


class ScheduleError(ValueError):
    """A problem the caller can fix (bad input, missing report, unusable filter) -> HTTP 400."""


class ScheduleForbidden(ScheduleError):
    """The acting user may not report on that dataset -> HTTP 403."""


# --------------------------------------------------------------------------- #
# plumbing
# --------------------------------------------------------------------------- #
_ENSURED: set = set()


def ensure_table(db: Session) -> None:
    """Create grc_scheduled_reports if this tenant engine was opened before the model
    was imported (create_all normally covers it). Memoized per engine; never raises."""
    try:
        key = str(getattr(db.get_bind(), "url", "default"))
    except Exception:  # noqa: BLE001
        key = "default"
    if key in _ENSURED:
        return
    try:
        ScheduledReport.__table__.create(bind=db.get_bind(), checkfirst=True)
        _ENSURED.add(key)
    except Exception:  # noqa: BLE001 - never block the caller
        pass


def _rr():
    """The Report Builder router module, imported lazily (no load-time coupling).
    importlib on purpose: grc.routers re-exports some routers under their module's name."""
    return importlib.import_module("grc.routers.reporting_router")


def _ensure_report_defs(db: Session) -> None:
    try:
        _rr()._ensure_report_table(db)
    except Exception:  # noqa: BLE001
        pass


def _utcnow() -> datetime:
    return datetime.utcnow()


def _to_naive_utc(dt: datetime) -> datetime:
    if dt.tzinfo is not None:
        dt = dt.astimezone(timezone.utc).replace(tzinfo=None)
    return dt


def _iso(dt: Optional[datetime]) -> Optional[str]:
    if dt is None:
        return None
    return dt.isoformat() + ("Z" if dt.tzinfo is None else "")


def _one_line(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def _slug(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", (value or "").lower()).strip("-")[:48]


def is_admin(db: Session, user: Any) -> bool:
    try:
        return "*:*:*" in _rr()._user_perm_names(user, db)
    except Exception:  # noqa: BLE001
        return False


# --------------------------------------------------------------------------- #
# time
# --------------------------------------------------------------------------- #
def _add_months(dt: datetime, months: int) -> datetime:
    y = dt.year + (dt.month - 1 + months) // 12
    m = (dt.month - 1 + months) % 12 + 1
    return dt.replace(year=y, month=m, day=min(dt.day, calendar.monthrange(y, m)[1]))


def next_occurrence(anchor: datetime, frequency: str, after: datetime) -> datetime:
    """The first instant of the series anchor + k*period (k >= 0) that is strictly after
    `after`. Always derived from the anchor, so monthly runs on the 31st clamp to the
    month end without drifting, and a stalled scheduler catches up with ONE run, not a
    burst."""
    if after < anchor:
        return anchor
    if frequency == "daily":
        return anchor + ((after - anchor) // timedelta(days=1) + 1) * timedelta(days=1)
    if frequency == "weekly":
        return anchor + ((after - anchor) // timedelta(days=7) + 1) * timedelta(days=7)
    k = max(0, (after.year - anchor.year) * 12 + (after.month - anchor.month) - 1)
    cand = _add_months(anchor, k)
    while cand <= after:
        k += 1
        cand = _add_months(anchor, k)
    return cand


def default_start(now: datetime) -> datetime:
    """Next 06:00 UTC after `now` (used when the caller gives no first-run time)."""
    cand = now.replace(hour=DEFAULT_HOUR_UTC, minute=0, second=0, microsecond=0)
    return cand if cand > now else cand + timedelta(days=1)


# --------------------------------------------------------------------------- #
# input validation
# --------------------------------------------------------------------------- #
def clean_recipients(raw: Any) -> List[str]:
    if isinstance(raw, str):
        raw = re.split(r"[,\s;]+", raw)
    out: List[str] = []
    seen: set = set()
    for item in raw or []:
        addr = str(item).strip()
        if not addr:
            continue
        if len(addr) > 254 or not _EMAIL_RE.match(addr):
            raise ScheduleError(f"'{addr}' is not a valid email address.")
        if addr.lower() in seen:
            continue
        seen.add(addr.lower())
        out.append(addr)
    if not out:
        raise ScheduleError("Add at least one recipient email address.")
    if len(out) > MAX_RECIPIENTS:
        raise ScheduleError(f"A schedule can have at most {MAX_RECIPIENTS} recipients.")
    return out


def _norm_filters(raw: Any) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for f in raw or []:
        if hasattr(f, "model_dump"):
            f = f.model_dump()
        if not isinstance(f, dict):
            continue
        col = f.get("col") or f.get("field")
        op = f.get("op")
        if not col or not op:
            raise ScheduleError("Every filter needs a column and an operator.")
        out.append({"col": str(col), "op": str(op), "value": f.get("value")})
    return out


def _norm_logic(value: Any) -> str:
    return "OR" if str(value or "AND").strip().upper() == "OR" else "AND"


def _norm_spec(spec: Any) -> Dict[str, Any]:
    """Read a saved report's open-JSON `spec` tolerantly: {columns, filters, logic,
    search, sorts}; anything else (incl. the builder's `format`) is ignored."""
    spec = spec if isinstance(spec, dict) else {}
    sorts = []
    for s in spec.get("sorts") or []:
        if isinstance(s, dict) and s.get("key"):
            sorts.append({"key": str(s["key"]), "dir": "desc" if str(s.get("dir", "asc")).lower() == "desc" else "asc"})
    search = spec.get("search")
    return {
        "columns": [str(c) for c in (spec.get("columns") or []) if isinstance(c, str)],
        "filters": _norm_filters(spec.get("filters")),
        "logic": _norm_logic(spec.get("logic")),
        "search": search.strip() if isinstance(search, str) and search.strip() else None,
        "sorts": sorts,
    }


def _dataset_spec(db: Session, user: Any, dataset: str):
    """The registered DatasetSpec, after the allowlist + permission gates the builder applies."""
    rr = _rr()
    ds = rr.SERVER_DATASETS.get(dataset)
    allow = getattr(rr, "AVA_DATASET_ALLOWLIST", None)
    if ds is None or (allow is not None and dataset not in allow):
        raise ScheduleError(f"'{dataset}' is not a dataset that can be reported on.")
    if not rr._user_can(user, db, ds.permissions):
        raise ScheduleForbidden(f"You do not have permission to report on '{dataset}'.")
    return ds


def _validate_filters(rr: Any, db: Session, ds: Any, filters: List[Dict[str, Any]], logic: str,
                      search: Optional[str]) -> None:
    """Fail loudly on any filter the export engine would silently drop."""
    for f in filters:
        kind = ds.filterable.get(f["col"])
        if kind is None:
            raise ScheduleError(f"'{f['col']}' cannot be filtered on in this dataset.")
        if f["op"] not in _OPS_BY_KIND.get(kind, set()):
            raise ScheduleError(f"The '{f['op']}' operator is not valid for '{f['col']}'.")
        if f["op"] not in _NO_VALUE_OPS and (f.get("value") is None or str(f["value"]).strip() == ""):
            raise ScheduleError(f"The filter on '{f['col']}' has no value, so it would be ignored.")
    if not filters:
        return
    flt = [rr.FilterSpec(col=f["col"], op=f["op"], value=f.get("value")) for f in filters]
    _, skipped = rr._apply_query_filters(db.query(ds.model), ds.model, ds, flt, logic, search)
    if skipped:
        bad = "; ".join(f"{s['col']} {s['op']} ({s['reason']})" for s in skipped)
        raise ScheduleError(f"These filters cannot be applied: {bad}.")


def _find_visible_saved(db: Session, user: Any, slug: str) -> Optional[ReportDefinition]:
    """A saved report the user may reference: their own, else one shared in the tenant."""
    _ensure_report_defs(db)
    own = (
        db.query(ReportDefinition)
        .filter(ReportDefinition.slug == slug, ReportDefinition.created_by == user.id)
        .first()
    )
    if own is not None:
        return own
    return (
        db.query(ReportDefinition)
        .filter(ReportDefinition.slug == slug, ReportDefinition.is_shared.is_(True))
        .first()
    )


def _load_saved(db: Session, row: ScheduledReport) -> Optional[ReportDefinition]:
    """The saved report a schedule points at, as visible to the schedule's OWNER."""
    if row.saved_report_id is None:
        return None
    _ensure_report_defs(db)
    d = db.query(ReportDefinition).filter(ReportDefinition.id == row.saved_report_id).first()
    if d is None:
        return None
    if d.created_by != row.created_by and not d.is_shared:
        return None
    return d


# --------------------------------------------------------------------------- #
# create / update / delete / read
# --------------------------------------------------------------------------- #
def _apply(db: Session, user: Any, row: ScheduledReport, data: Dict[str, Any], *,
           creating: bool, now: datetime) -> None:
    rr = _rr()

    if creating or "name" in data:
        name = _one_line(data.get("name"))
        if not name:
            raise ScheduleError("Give the schedule a name.")
        row.name = name[:200]

    # ---- source of the report ---------------------------------------------------
    slug = _one_line(data.get("saved_report_slug")) if data.get("saved_report_slug") else ""
    if slug:
        d = _find_visible_saved(db, user, slug)
        if d is None:
            raise ScheduleError(f"The saved report '{slug}' was not found.")
        ds = _dataset_spec(db, user, d.dataset)
        norm = _norm_spec(d.spec)
        _validate_filters(rr, db, ds, norm["filters"], norm["logic"], norm["search"])
        row.saved_report_id = d.id
        row.saved_report_slug = d.slug
        row.dataset = d.dataset
        row.columns, row.filters, row.logic = [], [], "AND"
    elif data.get("dataset"):
        dataset = _one_line(data["dataset"])
        ds = _dataset_spec(db, user, dataset)
        columns = [str(c) for c in (data.get("columns") or [])]
        valid = set(ds.fields) | set(ds.user_fields.values())
        unknown = [c for c in columns if c not in valid]
        if unknown:
            raise ScheduleError(f"Unknown column(s) for '{dataset}': {', '.join(unknown)}.")
        filters = _norm_filters(data.get("filters"))
        logic = _norm_logic(data.get("logic"))
        _validate_filters(rr, db, ds, filters, logic, None)
        row.saved_report_id = None
        row.saved_report_slug = None
        row.dataset = dataset
        row.columns, row.filters, row.logic = columns, filters, logic
    elif creating:
        raise ScheduleError("Choose a saved report, or a dataset to report on.")
    elif any(k in data for k in ("columns", "filters", "logic")) and row.saved_report_id is None and row.dataset:
        # editing the inline definition in place
        ds = _dataset_spec(db, user, row.dataset)
        columns = [str(c) for c in (data["columns"] if "columns" in data else row.columns or [])]
        valid = set(ds.fields) | set(ds.user_fields.values())
        unknown = [c for c in columns if c not in valid]
        if unknown:
            raise ScheduleError(f"Unknown column(s) for '{row.dataset}': {', '.join(unknown)}.")
        filters = _norm_filters(data["filters"] if "filters" in data else row.filters)
        logic = _norm_logic(data["logic"] if "logic" in data else row.logic)
        _validate_filters(rr, db, ds, filters, logic, None)
        row.columns, row.filters, row.logic = columns, filters, logic

    # ---- how often / to whom / format ---------------------------------------------
    if creating or "frequency" in data:
        freq = str(data.get("frequency") or "weekly").lower()
        if freq not in FREQUENCIES:
            raise ScheduleError(f"Frequency must be one of: {', '.join(FREQUENCIES)}.")
        row.frequency = freq
    if creating or "format" in data:
        fmt = str(data.get("format") or "xlsx").lower()
        if fmt not in FORMATS:
            raise ScheduleError(f"Format must be one of: {', '.join(FORMATS)}.")
        row.format = fmt
    if creating or "recipients" in data:
        row.recipients = clean_recipients(data.get("recipients"))
    if "message" in data:
        msg = (data.get("message") or "").strip()
        row.message = msg[:2000] or None

    # ---- timing ---------------------------------------------------------------------
    start_given = data.get("start_at") is not None
    if start_given:
        row.start_at = _to_naive_utc(data["start_at"]).replace(second=0, microsecond=0)
    elif creating:
        row.start_at = default_start(now)

    was_active = bool(row.active) if row.active is not None else True
    if "active" in data and data["active"] is not None:
        row.active = bool(data["active"])
    elif creating:
        row.active = True

    retime = creating or start_given or "frequency" in data or (row.active and not was_active)
    if not row.active:
        row.next_run = None
    elif retime or row.next_run is None:
        row.next_run = next_occurrence(row.start_at, row.frequency, now)


def create_schedule(db: Session, user: Any, tenant_id: int, data: Dict[str, Any]) -> ScheduledReport:
    ensure_table(db)
    if db.query(ScheduledReport).count() >= MAX_SCHEDULES_PER_TENANT:
        raise ScheduleError(f"This workspace already has {MAX_SCHEDULES_PER_TENANT} scheduled reports.")
    now = _utcnow()
    row = ScheduledReport(
        tenant_id=tenant_id,
        created_by=user.id,
        created_by_name=(getattr(user, "display_name", None) or getattr(user, "email", None)
                         or getattr(user, "username", None)),
        created_at=now,
        updated_at=now,
        columns=[], filters=[], recipients=[], logic="AND", active=True,
        start_at=now, frequency="weekly", format="xlsx",
    )
    _apply(db, user, row, data, creating=True, now=now)
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def update_schedule(db: Session, user: Any, row: ScheduledReport, data: Dict[str, Any]) -> ScheduledReport:
    _apply(db, user, row, data, creating=False, now=_utcnow())
    db.commit()
    db.refresh(row)
    return row


def delete_schedule(db: Session, row: ScheduledReport) -> None:
    db.delete(row)
    db.commit()


def get_schedule(db: Session, schedule_id: int) -> Optional[ScheduledReport]:
    ensure_table(db)
    return db.query(ScheduledReport).filter(ScheduledReport.id == schedule_id).first()


def can_manage(db: Session, user: Any, row: ScheduledReport) -> bool:
    return row.created_by == user.id or is_admin(db, user)


def list_schedules(db: Session, user: Any) -> List[ScheduledReport]:
    """The caller's schedules; administrators see the whole tenant's."""
    ensure_table(db)
    q = db.query(ScheduledReport)
    if not is_admin(db, user):
        q = q.filter(ScheduledReport.created_by == user.id)
    return q.order_by(ScheduledReport.created_at.desc(), ScheduledReport.id.desc()).all()


def serialize(db: Session, rows: List[ScheduledReport], viewer_id: Optional[int]) -> List[Dict[str, Any]]:
    """API shape for schedules, with the saved-report links resolved in one batch."""
    rr = _rr()
    ids = [r.saved_report_id for r in rows if r.saved_report_id is not None]
    saved: Dict[int, ReportDefinition] = {}
    if ids:
        _ensure_report_defs(db)
        for d in db.query(ReportDefinition).filter(ReportDefinition.id.in_(ids)).all():
            saved[d.id] = d
    out = []
    for r in rows:
        d = saved.get(r.saved_report_id) if r.saved_report_id is not None else None
        missing = r.saved_report_id is not None and d is None
        dataset = d.dataset if d is not None else r.dataset
        out.append({
            "id": r.id,
            "name": r.name,
            "saved_report_slug": r.saved_report_slug,
            "saved_report_name": d.name if d is not None else None,
            "saved_report_missing": missing,
            "dataset": dataset,
            "dataset_label": rr._dataset_label(dataset) if dataset else None,
            "columns": list(r.columns or []),
            "filters": list(r.filters or []),
            "logic": r.logic or "AND",
            "frequency": r.frequency,
            "recipients": list(r.recipients or []),
            "format": r.format,
            "message": r.message,
            "start_at": _iso(r.start_at),
            "next_run": _iso(r.next_run),
            "active": bool(r.active),
            "created_by_name": r.created_by_name,
            "is_mine": r.created_by == viewer_id,
            "created_at": _iso(r.created_at),
            "updated_at": _iso(r.updated_at),
            "last_run_at": _iso(r.last_run_at),
            "last_status": r.last_status,
            "last_error": r.last_error,
        })
    return out


# --------------------------------------------------------------------------- #
# generating the file (the Report Builder's export path, by import)
# --------------------------------------------------------------------------- #
@dataclass
class GeneratedReport:
    filename: str
    mimetype: str
    data: bytes
    rows_total: Optional[int]      # rows matching the filters (None if it could not be counted)
    rows_exported: Optional[int]   # rows actually in the file (export is capped)


def _response_bytes(resp: Any) -> bytes:
    """Read a Starlette response body from synchronous code. Plain responses carry .body;
    StreamingResponse exposes an ASYNC iterator, which we drain on a private event loop."""
    body = getattr(resp, "body", None)
    if body:
        return bytes(body)
    iterator = getattr(resp, "body_iterator", None)
    if iterator is None:
        return b""

    async def _collect() -> bytes:
        buf = bytearray()
        async for chunk in iterator:
            buf += chunk.encode("utf-8") if isinstance(chunk, str) else bytes(chunk)
        return bytes(buf)

    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return asyncio.run(_collect())
    with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:   # called from inside a loop
        return pool.submit(lambda: asyncio.run(_collect())).result()


def resolve_run_spec(db: Session, row: ScheduledReport) -> Dict[str, Any]:
    """What to run RIGHT NOW: the live saved report if linked, else the inline definition."""
    if row.saved_report_id is not None:
        d = _load_saved(db, row)
        if d is None:
            raise ScheduleError(
                "The saved report this schedule uses no longer exists (or is no longer shared). "
                "Edit the schedule and pick another report."
            )
        spec = _norm_spec(d.spec)
        spec["dataset"] = d.dataset
        spec["source_label"] = d.name
        return spec
    if not row.dataset:
        raise ScheduleError("This schedule has no report configured.")
    return {
        "dataset": row.dataset,
        "columns": [str(c) for c in (row.columns or [])],
        "filters": _norm_filters(row.filters),
        "logic": _norm_logic(row.logic),
        "search": None,
        "sorts": [],
        "source_label": None,
    }


def _count_rows(rr: Any, db: Session, user: Any, ds: Any, spec: Dict[str, Any]) -> Optional[int]:
    try:
        q = db.query(ds.model)
        q = rr._tenant_scope(q, ds.model, user, db)
        flt = [rr.FilterSpec(col=f["col"], op=f["op"], value=f.get("value")) for f in spec["filters"]]
        q, _ = rr._apply_query_filters(q, ds.model, ds, flt, spec["logic"], spec.get("search"))
        return int(q.count())
    except Exception:  # noqa: BLE001 - a count is garnish; never fail the report over it
        db.rollback()
        return None


def generate_report_file(db: Session, user: Any, spec: Dict[str, Any], fmt: str, *,
                         name: str, now: datetime) -> GeneratedReport:
    rr = _rr()
    ds = _dataset_spec(db, user, spec["dataset"])                # permission re-checked on every run
    _validate_filters(rr, db, ds, spec["filters"], spec["logic"], spec.get("search"))
    body = rr.ExportBody(
        dataset=spec["dataset"],
        columns=spec["columns"],
        filters=[rr.FilterSpec(col=f["col"], op=f["op"], value=f.get("value")) for f in spec["filters"]],
        logic=spec["logic"],
        search=spec.get("search"),
        sorts=[rr.SortSpec(key=s["key"], dir=s["dir"]) for s in spec.get("sorts", [])],
        format=fmt,
    )
    try:
        resp = rr.export_dataset(body, db=db, user=user)         # <- the builder's own export
    except HTTPException as exc:
        db.rollback()
        raise ScheduleError(str(exc.detail)) from exc
    data = _response_bytes(resp)
    media = (getattr(resp, "media_type", None) or "").split(";")[0].strip()
    ext = _EXT_BY_MEDIA.get(media, fmt)                           # e.g. xlsx degraded to csv
    total = _count_rows(rr, db, user, ds, spec)
    exported = None if total is None else min(total, getattr(rr, "MAX_EXPORT_ROWS", total))
    stem = _slug(name) or spec["dataset"]
    return GeneratedReport(
        filename=f"{stem}-{now:%Y-%m-%d}.{ext}",
        mimetype=_MIME.get(ext, media or "application/octet-stream"),
        data=data,
        rows_total=total,
        rows_exported=exported,
    )


# --------------------------------------------------------------------------- #
# the email
# --------------------------------------------------------------------------- #
def _human_size(n: int) -> str:
    if n < 1024:
        return f"{n} B"
    if n < 1024 * 1024:
        return f"{n / 1024:.0f} KB"
    return f"{n / (1024 * 1024):.1f} MB"


def build_email(row: ScheduledReport, spec: Dict[str, Any], gen: GeneratedReport, *,
                tenant_name: Optional[str], now: datetime, trigger: str,
                actor: Optional[str]) -> Tuple[str, str, str]:
    """(subject, plain text, html). Every user-supplied string is escaped in the HTML."""
    rr = _rr()
    esc = _html.escape
    dataset_label = rr._dataset_label(spec["dataset"])
    when = f"{now:%Y-%m-%d %H:%M} UTC"
    subject = _one_line(f"[ComplyVerse] {row.name} - {now:%Y-%m-%d}")

    if gen.rows_total is None:
        rows_line = None
    elif gen.rows_exported is not None and gen.rows_total > gen.rows_exported:
        rows_line = f"{gen.rows_exported:,} of {gen.rows_total:,} (export limit reached)"
    else:
        rows_line = f"{gen.rows_total:,}"

    if trigger == "manual":
        how = f"Sent on demand{f' by {actor}' if actor else ''}."
    else:
        how = f"Scheduled {row.frequency} report."

    facts: List[Tuple[str, str]] = [("Dataset", dataset_label)]
    if spec.get("source_label"):
        facts.insert(0, ("Report", spec["source_label"]))
    if rows_line:
        facts.append(("Rows", rows_line))
    facts.append(("Attachment", f"{gen.filename} ({_human_size(len(gen.data))})"))
    facts.append(("Generated", when))
    if tenant_name:
        facts.append(("Workspace", tenant_name))

    note = (row.message or "").strip()
    text_lines = [row.name, "", *( [note, ""] if note else [] )]
    text_lines += [f"{k}: {v}" for k, v in facts]
    text_lines += ["", how, "You receive this because you were added as a recipient in ComplyVerse."]
    text = "\n".join(text_lines)

    fact_rows = "".join(
        f'<tr><td style="padding:3px 18px 3px 0;color:#64748b;white-space:nowrap">{esc(k)}</td>'
        f'<td style="padding:3px 0;color:#0f172a">{esc(v)}</td></tr>'
        for k, v in facts
    )
    note_html = (
        f'<p style="margin:0 0 16px;font-size:14px;line-height:1.5;white-space:pre-wrap">{esc(note)}</p>'
        if note else ""
    )
    html = (
        '<div style="font-family:Segoe UI,Helvetica,Arial,sans-serif;color:#0f172a;max-width:560px">'
        f'<h2 style="margin:0 0 4px;font-size:18px;font-weight:600">{esc(row.name)}</h2>'
        f'<div style="margin:0 0 16px;font-size:13px;color:#64748b">{esc(dataset_label)} &middot; {esc(when)}</div>'
        f"{note_html}"
        f'<table role="presentation" style="border-collapse:collapse;font-size:13px">{fact_rows}</table>'
        f'<p style="margin:20px 0 0;font-size:12px;color:#64748b">{esc(how)} '
        "You receive this because you were added as a recipient in ComplyVerse.</p>"
        "</div>"
    )
    return subject, text, html


# --------------------------------------------------------------------------- #
# running
# --------------------------------------------------------------------------- #
def _record(db: Session, row: ScheduledReport, status: str, error: Optional[str], now: datetime) -> None:
    try:
        row.last_run_at = now
        row.last_status = status
        row.last_error = error[:1000] if error else None
        db.commit()
    except Exception:  # noqa: BLE001
        db.rollback()
        logger.exception("report_scheduler: could not record the outcome of schedule %s", getattr(row, "id", "?"))


def run_schedule(db: Session, row: ScheduledReport, *, trigger: str = "manual",
                 actor: Optional[str] = None) -> Dict[str, Any]:
    """Generate the file and email it. Expected failures (no email setup, bad filter,
    permission lost, SMTP down) come back as {"ok": False, "message": ...} and are
    recorded on the row - they never raise. Does NOT move next_run (see claim_due)."""
    now = _utcnow()
    recipients = list(row.recipients or [])
    result: Dict[str, Any] = {
        "ok": False, "status": "error", "message": "", "filename": None,
        "size_bytes": None, "rows": None, "recipients": recipients, "refused": {},
    }
    try:
        owner = db.query(GRCUser).filter(GRCUser.id == row.created_by).first() if row.created_by else None
        if owner is None or not owner.is_active:
            raise ScheduleError("The user who created this schedule no longer has an active account.")
        spec = resolve_run_spec(db, row)
        gen = generate_report_file(db, owner, spec, row.format, name=row.name, now=now)
        result.update(filename=gen.filename, size_bytes=len(gen.data), rows=gen.rows_total)
        if len(gen.data) > MAX_ATTACHMENT_BYTES:
            raise ScheduleError(
                f"The report is {_human_size(len(gen.data))}, over the {_human_size(MAX_ATTACHMENT_BYTES)} "
                "email limit. Narrow the filters or choose fewer columns."
            )
        smtp = mailer.resolve_smtp(db, row.tenant_id)
        if smtp is None:
            raise ScheduleError(mailer.NOT_CONFIGURED_MESSAGE)
        tenant = db.query(Tenant).first()
        tenant_name = getattr(tenant, "name", None)
        subject, text, html = build_email(
            row, spec, gen, tenant_name=tenant_name, now=now, trigger=trigger, actor=actor,
        )
        sent = mailer.send_with_attachment(
            smtp, recipients, subject, text, html, gen.filename, gen.data, gen.mimetype,
        )
        result["refused"] = sent.get("refused") or {}
        if not sent["success"]:
            raise ScheduleError(sent["message"])
        result.update(ok=True, status="sent", message=sent["message"])
        _record(db, row, "sent", None, now)
    except ScheduleError as exc:
        db.rollback()
        result["message"] = str(exc)
        _record(db, row, "error", str(exc), now)
    except Exception as exc:  # noqa: BLE001 - a report must never take the worker/request down
        db.rollback()
        logger.exception("report_scheduler: schedule %s failed", getattr(row, "id", "?"))
        result["message"] = f"Unexpected error while building or sending the report: {exc}"
        _record(db, row, "error", result["message"], now)
    return result


def _due_snapshot(db: Session, now: datetime) -> List[Tuple[int, datetime, datetime, str]]:
    """(id, next_run, start_at, frequency) of every active schedule due at `now`, as PLAIN
    values: ORM rows would be expired by the first commit in claim_due and re-read the
    value a competing worker just wrote, defeating the compare-and-set below."""
    ensure_table(db)
    return [
        (r.id, r.next_run, r.start_at, r.frequency)
        for r in (
            db.query(ScheduledReport.id, ScheduledReport.next_run, ScheduledReport.start_at,
                     ScheduledReport.frequency)
            .filter(ScheduledReport.active.is_(True), ScheduledReport.next_run.isnot(None),
                    ScheduledReport.next_run <= now)
            .order_by(ScheduledReport.next_run.asc(), ScheduledReport.id.asc())
            .all()
        )
    ]


def claim_due(db: Session, now: Optional[datetime] = None) -> List[int]:
    """Atomically take every due schedule: advance next_run to the next slot AFTER now
    with a compare-and-set UPDATE (`WHERE next_run = <the value we saw>`), and return only
    the ids this caller won. A schedule claimed here is sent exactly once even if two beat
    ticks / workers race - the loser's UPDATE matches 0 rows."""
    now = now or _utcnow()
    won: List[int] = []
    for sid, seen_next, start_at, frequency in _due_snapshot(db, now):
        new_next = next_occurrence(start_at, frequency, now)
        claimed = (
            db.query(ScheduledReport)
            .filter(ScheduledReport.id == sid, ScheduledReport.active.is_(True),
                    ScheduledReport.next_run == seen_next)
            .update({"next_run": new_next}, synchronize_session=False)
        )
        db.commit()
        if claimed == 1:
            won.append(sid)
    return won


def run_due(db: Session, now: Optional[datetime] = None) -> Dict[str, Any]:
    """Inline equivalent of one beat tick for ONE tenant DB: claim, then send each."""
    ids = claim_due(db, now)
    sent = failed = 0
    for sid in ids:
        row = db.query(ScheduledReport).filter(ScheduledReport.id == sid).first()
        if row is None:
            continue
        res = run_schedule(db, row, trigger="scheduled")
        sent += 1 if res["ok"] else 0
        failed += 0 if res["ok"] else 1
    return {"claimed": len(ids), "sent": sent, "failed": failed}
