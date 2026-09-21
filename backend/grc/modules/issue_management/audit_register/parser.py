"""Read the register workbook into rows the importer can apply.

Pure — no database, no tenant. Reads the client's .xlsb as well as .xlsx, finds
each sheet's header row wherever it sits beneath the pivot tables they keep on
top, and coerces every value to the type its field expects. Anything it cannot
place it reports as a warning rather than dropping silently, so an import can be
reviewed before it is applied.
"""
from __future__ import annotations

import calendar
import re
from dataclasses import dataclass, field as dc_field
from datetime import date, datetime, timedelta
from decimal import Decimal, InvalidOperation
from typing import Any, Dict, List, Optional, Tuple, Union

from python_calamine import CalamineWorkbook

from . import template as T

HEADER_SCAN_ROWS = 40     # the internal-audit sheets carry a pivot down to row 25
MIN_HEADER_MATCHES = 5    # fewer than this and it is not a register header
MIN_ROW_VALUES = 3        # a finding has at least a reference or title and two more
_EXCEL_EPOCH = date(1899, 12, 30)   # Excel counts from here, 1900 leap bug included
_DATE_FORMATS = ("%Y-%m-%d", "%m/%d/%Y", "%d/%m/%Y", "%m/%d/%y", "%d-%b-%Y", "%b %d, %Y")


@dataclass
class RegisterRow:
    """One finding, as the workbook has it."""
    sheet: str
    row_number: int               # 1-based, as Excel shows it
    record_type: str              # issue | recommendation
    source: Optional[str]         # regulator | mercadien | ey | … | None when unstated
    values: Dict[str, Any]


@dataclass
class ParsedWorkbook:
    file_name: str
    as_of: Optional[date] = None
    rows: List[RegisterRow] = dc_field(default_factory=list)
    # SUMMARY roll-forward, status table and recommendations per source, kept
    # for reconciling against what we compute.
    summary: Dict[str, Dict[str, int]] = dc_field(default_factory=dict)
    summary_month: Optional[str] = None      # "April 2026 Issue Summary" → "2026-04"
    # Sheet → {status code: the client's definition of it}.
    status_definitions: Dict[str, Dict[str, str]] = dc_field(default_factory=dict)
    # Sheet → its header row as written, for the blank template download.
    sheet_headers: Dict[str, List[str]] = dc_field(default_factory=dict)
    sheet_counts: Dict[str, int] = dc_field(default_factory=dict)
    warnings: List[str] = dc_field(default_factory=list)


# ── value coercion ───────────────────────────────────────────────────────────

def _text(value: Any) -> Optional[str]:
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return " ".join(str(value).split()) or None


def _to_date(value: Any) -> Optional[date]:
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    if isinstance(value, (int, float)) and 1 < float(value) < 100_000:
        return _EXCEL_EPOCH + timedelta(days=int(value))   # a serial in a text column
    text = _text(value)
    if not text:
        return None
    for fmt in _DATE_FORMATS:
        try:
            return datetime.strptime(text, fmt).date()
        except ValueError:
            continue
    return None      # e.g. the file's own "3/31/2-26"; the raw text is kept elsewhere


def _to_int(value: Any) -> Optional[int]:
    text = _text(value)
    if not text:
        return None
    match = re.search(r"-?\d+", text.replace(",", ""))
    return int(match.group()) if match else None


def _to_decimal(value: Any) -> Optional[Decimal]:
    text = _text(value)
    if not text:
        return None
    try:
        return Decimal(re.sub(r"[^0-9.\-]", "", text) or "0")
    except InvalidOperation:
        return None


def _coerce(field: str, value: Any) -> Any:
    if field in T.DATE_FIELDS:
        return _to_date(value)
    if field in T.INT_FIELDS:
        return _to_int(value)
    if field in T.DECIMAL_FIELDS:
        return _to_decimal(value)
    return _text(value)


# ── sheet reading ────────────────────────────────────────────────────────────

def _sheet_rule(name: str) -> Tuple[str, Optional[str], Optional[str]]:
    key = T.norm(name)
    for prefix, kind, source, record_type in T.SHEET_RULES:
        if key.startswith(prefix):
            return kind, source, record_type
    return "register", None, None        # an unknown sheet still gets tried


def _header_fields(row: List[Any]) -> Dict[int, str]:
    seen: Dict[str, int] = {}
    return {col: f for col, cell in enumerate(row) if (f := T.field_for(cell, seen))}


def _find_header(rows: List[List[Any]]) -> Tuple[Optional[int], Dict[int, str]]:
    """The first register header, beneath whatever pivots sit above it. A sheet
    can hold more than one table; each later header starts the next one."""
    for index, row in enumerate(rows[:HEADER_SCAN_ROWS]):
        fields = _header_fields(row)
        if len(fields) >= MIN_HEADER_MATCHES:
            return index, fields
    return None, {}


_DEFINITION = re.compile(
    r"^\s*(" + "|".join(T.STATUS_DEFINITION_TERMS) + r")\b\s*[:\-–]?\s*(.{10,})$",
    re.IGNORECASE | re.DOTALL)


def _status_definitions(rows: List[List[Any]]) -> Dict[str, str]:
    """"Past Due: Action Plan has not been implemented by …" and the rest."""
    found: Dict[str, str] = {}
    for row in rows:
        for cell in row:
            match = _DEFINITION.match(str(cell or ""))
            if match:
                code = T.STATUS_DEFINITION_TERMS[match.group(1).lower()]
                found.setdefault(code, " ".join(match.group(0).split()))
    return found


def _find_as_of(rows: List[List[Any]]) -> Optional[date]:
    for row in rows[:HEADER_SCAN_ROWS]:
        for col, cell in enumerate(row):
            if T.norm(cell) == "as of":
                for later in row[col + 1:]:
                    found = _to_date(later)
                    if found:
                        return found
    return None


def _source_from_row(values: Dict[str, Any]) -> Optional[str]:
    """What the row itself says about its origin, for sheets that mix sources."""
    for field in ("source_label", "type_of_audit", "regulator"):
        key = T.norm(values.get(field))
        if not key:
            continue
        if key in T.SOURCE_BY_LABEL:
            return T.SOURCE_BY_LABEL[key]
        for label, source in T.SOURCE_BY_LABEL.items():
            if label in key:
                return source
    return None


def _parse_register_sheet(name: str, rows: List[List[Any]], default_source: Optional[str],
                          default_type: Optional[str], out: ParsedWorkbook) -> None:
    header_index, fields = _find_header(rows)
    if header_index is None:
        out.warnings.append(f"{name}: no register columns found — sheet skipped")
        return
    definitions = _status_definitions(rows[:header_index + 1])
    if definitions:
        out.status_definitions[name] = definitions
    out.sheet_headers[name] = [str(c).strip() for c in rows[header_index] if str(c or "").strip()]

    count = 0
    for offset, row in enumerate(rows[header_index + 1:], start=header_index + 2):
        if len(again := _header_fields(row)) >= MIN_HEADER_MATCHES:
            fields = again       # a second table further down the sheet, with its own columns
            continue
        values = {field: _coerce(field, row[col]) for col, field in fields.items() if col < len(row)}
        values = {k: v for k, v in values.items() if v not in (None, "")}
        if not values.get("title") and not values.get("issue_ref"):
            continue          # spacer rows, totals, and the pivots' stray cells
        if len(values) < MIN_ROW_VALUES:
            if values.get("title"):
                out.warnings.append(f"{name} row {offset}: too little filled in to be a finding — skipped")
            continue          # a pivot's "Count of Status" and its totals
        record_type = "recommendation" if T.norm(values.pop("record_type_raw", "")).startswith(
            "recommendation") else (default_type or "issue")
        source = default_source or _source_from_row(values)
        if not source:
            out.warnings.append(f"{name} row {offset}: source not stated — left unassigned")
        out.rows.append(RegisterRow(name, offset, record_type, source, values))
        count += 1
    out.sheet_counts[name] = count


_MONTHS = {m.lower(): n for n, m in enumerate(calendar.month_name) if m}
_MONTH_TITLE = re.compile(r"\b(" + "|".join(_MONTHS) + r")\s+(\d{4})\b", re.IGNORECASE)
SUMMARY_SCAN_ROWS = 80


def _summary_month(rows: List[List[Any]]) -> Optional[str]:
    for row in rows[:8]:
        for cell in row:
            if match := _MONTH_TITLE.search(str(cell or "")):
                return f"{int(match.group(2)):04d}-{_MONTHS[match.group(1).lower()]:02d}"
    return None


def _source_columns(row: List[Any]) -> Dict[int, str]:
    return {col: T.SOURCE_BY_SUMMARY_COLUMN[T.norm(cell)]
            for col, cell in enumerate(row) if T.norm(cell) in T.SOURCE_BY_SUMMARY_COLUMN}


def _parse_summary_sheet(name: str, rows: List[List[Any]], out: ParsedWorkbook) -> None:
    """The client's own figures — roll-forward, status table, recommendations —
    each under its own "Source" header row, so an import can be reconciled."""
    out.summary_month = _summary_month(rows)
    headers = [i for i, row in enumerate(rows[:SUMMARY_SCAN_ROWS]) if len(_source_columns(row)) >= 2]
    if not headers:
        out.warnings.append(f"{name}: roll-forward columns not found")
        return
    for n, start in enumerate(headers):
        columns = _source_columns(rows[start])
        block = rows[start + 1:headers[n + 1] if n + 1 < len(headers) else start + 16]
        labelled = [(next((T.norm(c) for c in row if T.norm(c)), ""), row) for row in block]
        # "Not Started" also heads the unfilled status section under the
        # roll-forward; only the table that ends in "Total Open Issues" is it.
        has_status = any(label == "total open issues" for label, _ in labelled)
        for label, row in labelled:
            measure = T.SUMMARY_ROWS.get(label) or (T.SUMMARY_STATUS_ROWS.get(label) if has_status else None)
            if not measure:
                continue
            for col, source in columns.items():
                if col < len(row) and (number := _to_int(row[col])) is not None:
                    out.summary.setdefault(source, {})[measure] = number


def parse_workbook(data: Union[bytes, str], file_name: str = "") -> ParsedWorkbook:
    """Parse a register workbook given its bytes (or a path), .xlsb or .xlsx."""
    workbook = (CalamineWorkbook.from_path(data) if isinstance(data, str)
                else CalamineWorkbook.from_filelike(__import__("io").BytesIO(data)))
    out = ParsedWorkbook(file_name=file_name)
    for name in workbook.sheet_names:
        rows = workbook.get_sheet_by_name(name).to_python(skip_empty_area=False)
        out.as_of = out.as_of or _find_as_of(rows)
        kind, source, record_type = _sheet_rule(name)
        if kind == "summary":
            _parse_summary_sheet(name, rows, out)
        else:
            _parse_register_sheet(name, rows, source, record_type, out)
    return out
