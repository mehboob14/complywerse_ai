"""Custom fields suggested from a template the user uploads.

The ask: stop adding custom fields by hand. Upload the sheet, CSV or document the organisation already uses;
AI reads it and proposes the fields; the person checks them and adds them in one click.

Three rules keep it honest, the way the rest of the platform's AI is:

* **Only what the file holds.** A suggestion has to be traceable to the file: its name is a column heading, a form
  label or a table cell in it, and a dropdown's options are values the file itself shows (the cells under the
  heading, an Excel dropdown list, a PDF choice field). Whatever the model returns that is not in the file is
  dropped, and the response says how many were. The model also may not claim a date or a number for a column whose
  values are neither.
* **Little leaves the server.** The model sees the headings and up to five short sample values per column (for a
  document, its text), never the rows. The file is read in memory and not kept. The licence guard on the model
  client refuses SCF text should any slip in.
* **Nothing is written here.** `suggest` returns suggestions to check; `add_fields` saves only what the person
  confirmed, through the same validation as a field made by hand.

With no AI configured, or an answer that cannot be used, the suggestions come from the headings and values by rule,
and the response says so.
"""
from __future__ import annotations

import csv
import difflib
import io
import json
import logging
import re
import zipfile
from collections import Counter
from copy import deepcopy
from dataclasses import dataclass, field
from datetime import date, datetime
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Sequence, Tuple

from sqlalchemy.orm import Session

from . import module_settings as ms

logger = logging.getLogger(__name__)

MAX_BYTES = 5 * 1024 * 1024
MAX_ROWS = 2000            # data rows read per sheet or table
MAX_COLS = 80
MAX_SHEETS = 12
MAX_TABLES = 20
MAX_PAGES = 15
MAX_SUGGESTIONS = 60
MAX_AI_HEADINGS = 150      # headings handed to the model in one go
MAX_OPTIONS = 50
SAMPLE_VALUES = 5
SAMPLE_CHARS = 60
DOC_CHARS = 14000
SHEET_TYPES = (".xlsx", ".xlsm")
LEGACY_SHEET_TYPES = (".xlsb", ".xls", ".ods")
TEXT_SHEET_TYPES = (".csv", ".tsv")
SUPPORTED = SHEET_TYPES + LEGACY_SHEET_TYPES + TEXT_SHEET_TYPES + (".docx", ".pdf")

# What a person is told when a file cannot be used.
ACCEPT_HINT = "Upload a spreadsheet (.xlsx, .csv) or a Word (.docx) or PDF document."


class TemplateError(ValueError):
    """The file cannot be used; the message says why, in words for the person who uploaded it."""


@dataclass
class Column:
    """One heading of the template and what is under it."""
    header: str
    where: str
    filled: int = 0
    rows: int = 0
    kinds: Counter = field(default_factory=Counter)
    distinct: List[str] = field(default_factory=list)      # first-seen order, capped
    samples: List[str] = field(default_factory=list)
    choices: List[str] = field(default_factory=list)       # a list the file itself defines for it
    note: str = ""                                         # a cell comment next to the heading
    longest: int = 0
    total_len: int = 0
    sequential: bool = False                               # 1, 2, 3, ... a row counter
    hint: str = ""                                         # a type the file states (a PDF checkbox)


@dataclass
class Template:
    name: str
    kind: str                                              # "sheet" or "document"
    columns: List[Column] = field(default_factory=list)
    text: str = ""                                         # documents: the readable text
    sheets: List[str] = field(default_factory=list)


# ── reading values ───────────────────────────────────────────────────────────

_BOOL_WORDS = {"yes", "no", "y", "n", "true", "false"}
_DATE = re.compile(
    r"^(\d{4}[-/.]\d{1,2}[-/.]\d{1,2}([ T]\d{1,2}:\d{2}(:\d{2})?)?"
    r"|\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}"
    r"|\d{1,2}[ -][A-Za-z]{3,9}[ -,]*\d{2,4}"
    r"|[A-Za-z]{3,9}\.? \d{1,2},? \d{4})$")
_NUMBER = re.compile(r"^[-+]?\d[\d,]*(\.\d+)?%?$")
_EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _present(value: Any) -> bool:
    return value is not None and (not isinstance(value, str) or value.strip() != "")


def _show(value: Any) -> str:
    """A cell as a person would read it."""
    if isinstance(value, bool):
        return "Yes" if value else "No"
    if isinstance(value, datetime):
        return value.strftime("%Y-%m-%d") if (value.hour, value.minute, value.second) == (0, 0, 0) else value.strftime("%Y-%m-%d %H:%M")
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return " ".join(str(value).split())


def _kind(value: Any) -> str:
    if isinstance(value, bool):
        return "bool"
    if isinstance(value, (datetime, date)):
        return "date"
    if isinstance(value, (int, float)):
        return "number"
    text = " ".join(str(value).split())
    low = text.lower()
    if low in _BOOL_WORDS:
        return "bool"
    if _EMAIL.match(text):
        return "email"
    if _DATE.match(text):
        return "date"
    if _NUMBER.match(text) and not (len(text) > 1 and text.startswith("0") and text[1].isdigit()) \
            and len(text.replace(",", "").split(".")[0].lstrip("+-")) < 12:
        return "number"
    return "text"


def _sequential(values: Sequence[Any]) -> bool:
    nums = []
    for v in values[:20]:
        try:
            nums.append(int(float(str(v).strip())))
        except (TypeError, ValueError):
            return False
    return len(nums) >= 2 and all(b - a == 1 for a, b in zip(nums, nums[1:]))


def _letter(index: int) -> str:
    out = ""
    n = index + 1
    while n:
        n, rem = divmod(n - 1, 26)
        out = chr(65 + rem) + out
    return out


def _clean_header(cell: Any) -> str:
    return " ".join(str(cell).split())[:120] if _present(cell) else ""


def _profile(col: Column, values: Sequence[Any], rows: int) -> None:
    col.rows = rows
    col.filled = len(values)
    seen = set()
    for v in values:
        col.kinds[_kind(v)] += 1
        s = _show(v)
        col.longest = max(col.longest, len(s))
        col.total_len += len(s)
        if s not in seen and len(col.distinct) < 60:
            seen.add(s)
            col.distinct.append(s)
        if s[:SAMPLE_CHARS] not in col.samples and len(col.samples) < SAMPLE_VALUES:
            col.samples.append(s[:SAMPLE_CHARS])
    col.sequential = _sequential(values)


def _find_header(rows: List[List[Any]]) -> Optional[int]:
    """The heading row: the first of the top rows that is mostly words and about as wide as the sheet.

    A title ("Asset register") is one cell wide, so it is passed over; a one-column sheet has nothing wider to
    prefer, so its first filled row is the heading.
    """
    scan = rows[:30]
    counts = [sum(1 for c in r if _present(c)) for r in scan]
    widest = max(counts, default=0)
    if widest == 0:
        return None
    for i, r in enumerate(scan):
        words = sum(1 for c in r if _present(c) and _kind(c) == "text")
        if words >= max(2, -(-widest // 2)) or (widest == 1 and words == 1):
            return i
    return None


def _columns_from_rows(label: str, rows: List[List[Any]], comments: Optional[Dict[Tuple[int, int], str]] = None,
                       choices: Optional[Dict[int, List[str]]] = None) -> List[Column]:
    rows = [list(r) for r in rows[:MAX_ROWS + 31]]
    h = _find_header(rows)
    if h is None:
        return []
    body = rows[h + 1:h + 1 + MAX_ROWS]
    out: List[Column] = []
    for j, cell in enumerate(rows[h][:MAX_COLS]):
        text = _clean_header(cell)
        if not text:
            continue
        col = Column(header=text, where=f"{label} · column {_letter(j)}" if label else f"column {_letter(j)}")
        _profile(col, [r[j] for r in body if j < len(r) and _present(r[j])], len(body))
        col.note = (comments or {}).get((h, j), "")
        col.choices = list((choices or {}).get(j, []))
        out.append(col)
    return out


# ── readers ──────────────────────────────────────────────────────────────────

def _decode(data: bytes) -> str:
    for encoding in ("utf-8-sig", "utf-16"):
        try:
            return data.decode(encoding)
        except UnicodeDecodeError:
            continue
    try:
        from charset_normalizer import from_bytes
        best = from_bytes(data).best()
        if best is not None:
            return str(best)
    except Exception:   # noqa: BLE001
        pass
    return data.decode("latin-1")


def _read_csv(name: str, data: bytes) -> Template:
    text = _decode(data)
    if not text.strip():
        raise TemplateError("This file is empty.")
    sample = text[:4096]
    try:
        dialect = csv.Sniffer().sniff(sample, delimiters=",;\t|")
        delimiter = dialect.delimiter
    except csv.Error:
        first = sample.splitlines()[0] if sample.splitlines() else ""
        delimiter = max(",;\t|", key=first.count)
    csv.field_size_limit(1_000_000)
    rows = []
    for i, row in enumerate(csv.reader(io.StringIO(text), delimiter=delimiter)):
        rows.append(row)
        if i >= MAX_ROWS + 30:
            break
    cols = _columns_from_rows("", rows)
    if not cols:
        raise TemplateError("No column headings were found in this file.")
    return Template(name=name, kind="sheet", columns=cols, sheets=[name])


def _rows_of(value: Any) -> List[List[Any]]:
    return [list(r) for r in value]


def _validation_choices(ws: Any, wb: Any, header_row: int) -> Dict[int, List[str]]:
    """Excel dropdown lists on the sheet, by column index: a typed list, or a range of cells."""
    from openpyxl.utils import range_boundaries

    found: Dict[int, List[str]] = {}
    validations = getattr(getattr(ws, "data_validations", None), "dataValidation", None) or []
    for dv in validations:
        if getattr(dv, "type", None) != "list" or not dv.formula1:
            continue
        formula = str(dv.formula1).strip()
        options: List[str] = []
        if formula.startswith('"'):
            options = [o.strip() for o in formula.strip('"').split(",") if o.strip()]
        else:
            ref = formula.lstrip("=").replace("$", "")
            sheet = ws
            if "!" in ref:
                sheet_name, ref = ref.rsplit("!", 1)
                sheet_name = sheet_name.strip("'")
                if sheet_name not in wb.sheetnames:
                    continue
                sheet = wb[sheet_name]
            try:
                c1, r1, c2, r2 = range_boundaries(ref)
                for row in sheet.iter_rows(min_row=r1, max_row=min(r2, r1 + 200), min_col=c1, max_col=c2, values_only=True):
                    options += [_show(v) for v in row if _present(v)]
            except Exception:   # noqa: BLE001 - a named range or a formula: not readable here
                continue
        options = list(dict.fromkeys(options))[:MAX_OPTIONS]
        if not options:
            continue
        for rng in str(dv.sqref).split():
            try:
                c1, _r1, c2, _r2 = range_boundaries(rng)
            except Exception:   # noqa: BLE001
                continue
            for c in range(c1, c2 + 1):
                found.setdefault(c - 1, options)
    return found


MAX_UNPACKED = 80 * 1024 * 1024


def _check_zip(data: bytes, what: str) -> None:
    """An Excel or Word file is a zip: refuse one that is not, or that unpacks to something huge."""
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            unpacked = sum(item.file_size for item in archive.infolist())
    except zipfile.BadZipFile:
        raise TemplateError(f"This is not a valid {what} file.")
    if unpacked > MAX_UNPACKED:
        raise TemplateError("This file is too large once unpacked. Remove images or extra sheets and try again.")


def _read_xlsx(name: str, data: bytes) -> Template:
    _check_zip(data, "Excel (.xlsx)")
    from openpyxl import load_workbook

    try:
        wb = load_workbook(io.BytesIO(data), data_only=True)
    except Exception:   # noqa: BLE001
        raise TemplateError("This Excel file could not be opened. Is it password protected or damaged?")
    cols: List[Column] = []
    names: List[str] = []
    visible = [ws for ws in wb.worksheets if getattr(ws, "sheet_state", "visible") == "visible"][:MAX_SHEETS]
    for ws in visible:
        rows = [list(r) for r in ws.iter_rows(max_row=MAX_ROWS + 31, max_col=MAX_COLS, values_only=True)]
        h = _find_header(rows)
        if h is None:
            continue
        comments: Dict[Tuple[int, int], str] = {}
        for j, cell in enumerate(ws[h + 1][:MAX_COLS] if ws.max_row >= h + 1 else []):
            note = getattr(getattr(cell, "comment", None), "text", None)
            if note:
                comments[(h, j)] = " ".join(str(note).split())[:200]
        found = _columns_from_rows(ws.title if len(visible) > 1 else "", rows, comments, _validation_choices(ws, wb, h))
        if found:
            names.append(ws.title)
            cols += found
    if not cols:
        raise TemplateError("No column headings were found in this workbook.")
    return Template(name=name, kind="sheet", columns=cols, sheets=names)


def _read_calamine(name: str, data: bytes) -> Template:
    try:
        from python_calamine import CalamineWorkbook
        wb = CalamineWorkbook.from_filelike(io.BytesIO(data))
    except Exception:   # noqa: BLE001
        raise TemplateError("This spreadsheet could not be opened. Save it as .xlsx and try again.")
    cols: List[Column] = []
    names: List[str] = []
    sheet_names = wb.sheet_names[:MAX_SHEETS]
    for sheet in sheet_names:
        rows = _rows_of(wb.get_sheet_by_name(sheet).to_python(skip_empty_area=False))[:MAX_ROWS + 31]
        found = _columns_from_rows(sheet if len(sheet_names) > 1 else "", rows)
        if found:
            names.append(sheet)
            cols += found
    if not cols:
        raise TemplateError("No column headings were found in this workbook.")
    return Template(name=name, kind="sheet", columns=cols, sheets=names)


def _table_text(rows: List[List[str]]) -> str:
    return "\n".join("| " + " | ".join(r) + " |" for r in rows if any(r))


def _form_labels(rows: List[List[str]]) -> List[str]:
    """Labels of a "label | blank" form table: a cell with words whose right neighbour is empty."""
    out = []
    for r in rows:
        for c, text in enumerate(r):
            if text and (c + 1 >= len(r) or not r[c + 1]) and len(text) <= 80 and text.rstrip(":").strip():
                out.append(text.rstrip(":").strip())
    return list(dict.fromkeys(out))


def _columns_from_table(label: str, rows: List[List[str]]) -> List[Column]:
    rows = [r for r in rows if any(r)]
    if not rows or max(len(r) for r in rows) < 2:
        return []
    first = rows[0]
    header_like = len(first) >= 2 and all(first)
    if header_like:
        return _columns_from_rows(label, [list(r) for r in rows])
    return [Column(header=text, where=f"{label}, form field") for text in _form_labels(rows)]


def _read_docx(name: str, data: bytes) -> Template:
    _check_zip(data, "Word (.docx)")
    from docx import Document

    try:
        doc = Document(io.BytesIO(data))
    except Exception:   # noqa: BLE001
        raise TemplateError("This Word file could not be opened. Is it damaged?")
    parts = [" ".join(p.text.split()) for p in doc.paragraphs if p.text.strip()]
    cols: List[Column] = []
    for ti, table in enumerate(doc.tables[:MAX_TABLES], 1):
        rows: List[List[str]] = []
        for row in table.rows[:MAX_ROWS]:
            cells, seen = [], set()
            for cell in row.cells:          # a merged cell repeats: take it once
                if id(cell._tc) in seen:
                    continue
                seen.add(id(cell._tc))
                cells.append(" ".join(cell.text.split()))
            rows.append(cells)
        parts.append(_table_text(rows))
        cols += _columns_from_table(f"table {ti}", rows)
    text = "\n".join(p for p in parts if p).strip()
    if not text:
        raise TemplateError("There is no readable text in this document.")
    return Template(name=name, kind="document", columns=cols + _label_columns(text, cols), text=text[:DOC_CHARS])


_LABEL_LINE = re.compile(
    r"^\s*(?:[-•*]\s*|\d{1,2}[.)]\s*)?(?P<label>[A-Za-z][A-Za-z0-9 /&()'\-]{1,60}?)\s*"
    r"(?::\s*(?:[_.\-\s]*|\[\s*\]|\(\s*\)|☐|□)|\s[_.]{4,})\s*$")


def _label_columns(text: str, known: Sequence[Column]) -> List[Column]:
    """Form labels written as lines: "Owner: ______", "Review date ........". Short lines only."""
    have = {_norm(c.header) for c in known}
    out: List[Column] = []
    for line in text.splitlines():
        m = _LABEL_LINE.match(line)
        if not m or len(line) > 90:
            continue
        label = " ".join(m.group("label").split())
        if len(label.split()) > 6 or not _norm(label) or _norm(label) in have:
            continue
        have.add(_norm(label))
        out.append(Column(header=label, where="form line"))
    return out[:MAX_COLS]


_PDF_TYPE = {"/Tx": "", "/Btn": "checkbox", "/Ch": "select"}


def _read_pdf(name: str, data: bytes) -> Template:
    if not data.lstrip().startswith(b"%PDF"):
        raise TemplateError("This is not a valid PDF file.")
    from PyPDF2 import PdfReader

    try:
        reader = PdfReader(io.BytesIO(data))
        if reader.is_encrypted and not reader.decrypt(""):
            raise TemplateError("This PDF is password protected.")
        fields = reader.get_fields() or {}
        pages = []
        for page in reader.pages[:MAX_PAGES]:
            pages.append(page.extract_text() or "")
    except TemplateError:
        raise
    except Exception:   # noqa: BLE001
        raise TemplateError("This PDF could not be read. Is it damaged?")
    cols: List[Column] = []
    for key, item in list(fields.items())[:MAX_COLS]:
        label = " ".join(str(item.get("/TU") or item.get("/T") or key).replace("_", " ").split())
        if not label:
            continue
        opts = [str(o[-1] if isinstance(o, (list, tuple)) else o) for o in (item.get("/Opt") or [])]
        kind = _PDF_TYPE.get(str(item.get("/FT")), "")
        cols.append(Column(header=label[:120], where="form field", choices=opts[:MAX_OPTIONS],
                           hint="select" if opts else kind))
    text = "\n".join(" ".join(line.split()) for page in pages for line in page.splitlines() if line.strip()).strip()
    if not text and not cols:
        raise TemplateError(
            "No readable text was found in this PDF (it may be a scan). Upload a text-based PDF, a Word file or a spreadsheet.")
    return Template(name=name, kind="document", columns=cols + _label_columns(text, cols), text=text[:DOC_CHARS])


def read_template(filename: str, data: bytes) -> Template:
    name = Path(filename or "template").name
    ext = Path(name).suffix.lower()
    if not data:
        raise TemplateError("This file is empty.")
    if len(data) > MAX_BYTES:
        raise TemplateError(f"This file is larger than {MAX_BYTES // (1024 * 1024)} MB.")
    if ext in SHEET_TYPES:
        return _read_xlsx(name, data)
    if ext in LEGACY_SHEET_TYPES:
        return _read_calamine(name, data)
    if ext in TEXT_SHEET_TYPES:
        return _read_csv(name, data)
    if ext == ".docx":
        return _read_docx(name, data)
    if ext == ".pdf":
        return _read_pdf(name, data)
    if ext == ".doc":
        raise TemplateError("Old Word (.doc) files are not read. Save it as .docx and try again.")
    raise TemplateError(f"A {ext or 'file without a type'} file cannot be read. {ACCEPT_HINT}")


# ── what a column looks like ─────────────────────────────────────────────────

_ROWNUM = re.compile(r"^(#|no\.?|s\.? ?no\.?|sr\.? ?no\.?|sl\.? ?no\.?|serial( no\.?| number)?|index|row)$", re.I)
_REQUIRED = re.compile(r"(\s*\*+\s*$)|(\s*[\(\[]\s*(required|mandatory)\s*[\)\]])", re.I)
_DATE_HDR = re.compile(r"\b(date|deadline|expiry|expires|expiration|renewal)\b", re.I)
_YESNO_HDR = re.compile(r"(\?\s*$)|^(is|are|has|have|does|do|can|should)\b", re.I)
_PERSON_HDR = re.compile(
    r"\b(owner|assignee|assigned to|manager|reviewer|responsible|approver|custodian|reported by|created by|"
    r"prepared by|point of contact|contact person)\b", re.I)
_LONG_HDR = re.compile(
    r"\b(description|comments?|notes?|remarks?|justification|details?|summary|observation|recommendation|rationale)\b", re.I)
_NUMBER_HDR = re.compile(r"\b(number of|count|amount|cost|quantity|qty|score|percent|percentage)\b", re.I)


def _label_of(header: str) -> Tuple[str, bool]:
    """The heading without a "*" or "(required)" marker, and whether it carried one."""
    required = bool(_REQUIRED.search(header))
    label = _REQUIRED.sub("", header).strip(" : ")
    return (label or header.strip())[:80], required


def _tokens(text: str) -> List[str]:
    return re.sub(r"[^a-z0-9]+", " ", str(text).lower()).split()


def _norm(text: str) -> str:
    return " ".join(_tokens(text))


def _stem(token: str) -> str:
    return token[:-1] if len(token) > 3 and token.endswith("s") and not token.endswith("ss") else token


def _same(a: str, b: str) -> bool:
    """Two labels that name the same thing: same words, in any order, singular or plural."""
    ta, tb = [_stem(t) for t in _tokens(a)], [_stem(t) for t in _tokens(b)]
    return bool(ta) and sorted(ta) == sorted(tb)


def _infer(col: Column) -> Tuple[str, List[str]]:
    """The type and options by rule: what the values say, or what the heading says when there are none."""
    label, _ = _label_of(col.header)
    if col.choices:
        return "select", list(col.choices)
    if col.hint:
        return col.hint, []
    n = col.filled
    if n == 0:
        if _PERSON_HDR.search(label) and not _LONG_HDR.search(label):
            return "user", []
        if _DATE_HDR.search(label):
            return "date", []
        if _YESNO_HDR.search(label):
            return "checkbox", []
        if _LONG_HDR.search(label):
            return "textarea", []
        if _NUMBER_HDR.search(label):
            return "number", []
        return "text", []
    frac = lambda name: col.kinds.get(name, 0) / n            # noqa: E731
    if frac("bool") >= 0.9:
        return "checkbox", []
    if frac("date") >= 0.8:
        return "date", []
    if frac("number") >= 0.9:
        return "number", []
    if _PERSON_HDR.search(label) and not _LONG_HDR.search(label) and (frac("email") >= 0.5 or col.longest <= 60):
        return "user", []
    if n >= 3 and 2 <= len(col.distinct) <= min(12, max(2, n // 2)) and col.longest <= 40 and len(col.distinct) < 60:
        return "select", list(col.distinct)
    if (col.total_len / n) > 100 or col.longest > 250 or _LONG_HDR.search(label):
        return "textarea", []
    return "text", []


def _skip_reason(col: Column) -> Optional[str]:
    label, _ = _label_of(col.header)
    if _ROWNUM.match(label) and (col.sequential or col.filled == 0):
        return "A row number"
    return None


def _candidates(template: Template) -> List[Dict[str, Any]]:
    """Every heading as a candidate field, with what the rules make of it. Duplicate headings keep the first."""
    out, seen = [], set()
    for i, col in enumerate(template.columns):
        label, required = _label_of(col.header)
        key = _norm(label)
        if not key or key in seen:
            continue
        seen.add(key)
        kind, options = _infer(col)
        out.append({
            "id": i, "label": label, "type": kind, "options": options, "required": required, "help": col.note,
            "where": col.where, "example": col.samples[0] if col.samples else "", "skip": _skip_reason(col),
            "col": col,
        })
    return out


# ── the model's part ─────────────────────────────────────────────────────────

SYSTEM = (
    "You turn a template a user uploaded into custom form fields for the \"{record}\" form of a governance, risk and "
    "compliance platform.\n"
    "Rules:\n"
    "- Use ONLY what the template shows. Never add a field the template does not have, and never invent options: a "
    "dropdown's options must be values that appear in the template (cells under the heading, a dropdown the file "
    "defines, or the document text).\n"
    "- Leave out columns that are not information the user would record on each {record} (row numbers, totals, "
    "instructions, empty headings) and say why in \"left_out\".\n"
    "- Field types: text, textarea, number, date, select, multiselect, checkbox, user. user is a person on the team "
    "(an owner, reviewer, assignee). checkbox is a yes/no question (never a dropdown of Yes and No). Use number or "
    "date only when the values are numbers or dates.\n"
    "- Keep the label as the template words it; you may fix capitalisation and drop a trailing * or colon.\n"
    "- required is true only if the template marks the field required (an asterisk, \"mandatory\", \"required\").\n"
    "- help is only text the template itself gives about the field; otherwise leave it empty.\n"
    "- Do not suggest anything listed in already_on_form.\n"
    "Reply with JSON only: {{\"fields\":[{{\"column\": <id of the heading it came from, or null for a document>, "
    "\"label\":\"\", \"type\":\"\", \"required\":false, \"options\":[], \"help\":\"\", \"confidence\":0.0}}], "
    "\"left_out\":[{{\"label\":\"\", \"reason\":\"\"}}]}}")


def _payload(template: Template, cands: List[Dict[str, Any]], record: str, existing: Sequence[str]) -> str:
    cols = []
    for c in cands:
        col: Column = c["col"]
        cols.append({
            "id": c["id"], "heading": col.header, "where": col.where, "filled": col.filled, "rows": col.rows,
            "samples": col.samples, "distinct_values": col.distinct[:25], "dropdown_in_file": col.choices[:25],
            "note": col.note, "rule_type": c["type"],
        })
    body: Dict[str, Any] = {"record": record, "file": template.name, "kind": template.kind,
                            "columns" if template.kind == "sheet" else "headings_and_form_fields": cols,
                            "already_on_form": list(existing)[:60]}
    if template.kind == "document":
        body["text"] = template.text
    return json.dumps(body, ensure_ascii=False)


def _json(text: str) -> Dict[str, Any]:
    cleaned = (text or "").strip()
    start, end = cleaned.find("{"), cleaned.rfind("}")
    try:
        data = json.loads(cleaned[start:end + 1]) if 0 <= start < end else {}
    except json.JSONDecodeError:
        data = {}
    return data if isinstance(data, dict) else {}


def _complete(messages: List[Dict[str, str]]) -> str:
    from .assessment_evidence_ai import openai_complete
    return openai_complete(messages, max_tokens=4000, json_mode=True, timeout=90)


class AIDeclined(RuntimeError):
    """The model was not used or its answer could not be used; the message is shown to the person."""


def _ai_fields(template: Template, cands: List[Dict[str, Any]], record: str, existing: Sequence[str],
               complete: Callable[[List[Dict[str, str]]], str]) -> Tuple[List[Dict[str, Any]], List[Dict[str, str]]]:
    from .assessment_evidence_ai import AIEmptyAnswer, AIUnavailable
    try:
        from .licence_guard import LicenceRestrictedContent
    except Exception:   # noqa: BLE001
        LicenceRestrictedContent = ()   # type: ignore[assignment,misc]
    messages = [{"role": "system", "content": SYSTEM.format(record=record.lower())},
                {"role": "user", "content": _payload(template, cands, record, existing)}]
    try:
        answer = _json(complete(messages))
    except AIUnavailable:
        raise AIDeclined("AI isn't set up on this server, so these come from the file's headings and values.")
    except LicenceRestrictedContent:
        raise AIDeclined("This file holds text that cannot be sent to AI, so these come from its headings and values.")
    except AIEmptyAnswer:
        raise AIDeclined("AI could not read this file this time, so these come from its headings and values.")
    except Exception:   # noqa: BLE001
        logger.exception("Template field suggestions: the model call failed")
        raise AIDeclined("AI could not be reached, so these come from the file's headings and values.")
    fields = answer.get("fields")
    if not isinstance(fields, list) or not fields:
        raise AIDeclined("AI found no fields it could vouch for in this file, so these come from its headings and values.")
    left = [{"label": str(x.get("label") or "")[:80], "reason": str(x.get("reason") or "")[:120]}
            for x in (answer.get("left_out") or []) if isinstance(x, dict)]
    return [f for f in fields if isinstance(f, dict)], left


def _kind_ok(kind: str, col: Optional[Column]) -> bool:
    """A model may not call a column a date or a number when its values are neither."""
    if col is None or col.filled == 0:
        return True
    share = lambda name: col.kinds.get(name, 0) / col.filled     # noqa: E731
    if kind == "date":
        return share("date") >= 0.5
    if kind == "number":
        return share("number") >= 0.5
    if kind == "checkbox":
        return share("bool") >= 0.5
    return True


def _grounded_options(options: Sequence[Any], col: Optional[Column], text: str) -> List[str]:
    """Only options the file shows: its dropdown list, the values under the heading, or (a document) its text."""
    allowed: List[str] = []
    if col is not None:
        allowed += col.choices + col.distinct
        for v in col.distinct:                              # "A; B" in one cell: each part is an option
            allowed += [p.strip() for p in re.split(r"[;|]", v) if p.strip()]
    pool = {_norm(a) for a in allowed}
    hay = _norm(text)
    out: List[str] = []
    for option in options:
        shown = " ".join(str(option).split())[:80]
        n = _norm(shown)
        if not n or any(_norm(o) == n for o in out):
            continue
        if n in pool or (text and n in hay):
            out.append(shown)
    return out[:MAX_OPTIONS]


def _where_in_text(label: str, text: str) -> str:
    """The line of the document a label was found on, so the person can see it for themselves."""
    wanted = _norm(label)
    for line in text.splitlines():
        if wanted and wanted in _norm(line):
            shown = " ".join(line.split())
            return "“" + (shown if len(shown) <= 90 else shown[:87] + "...") + "”"
    return "the document text"


def _ground(raw: List[Dict[str, Any]], template: Template, cands: List[Dict[str, Any]]
            ) -> Tuple[List[Dict[str, Any]], int]:
    """Keep what the model returned only where the file backs it. Returns the fields and how many were dropped."""
    by_id = {c["id"]: c for c in cands}
    by_norm = {_norm(c["label"]): c for c in cands}
    hay = _norm(template.text)
    out, dropped = [], 0
    for item in raw:
        label = " ".join(str(item.get("label") or "").split())
        label = _REQUIRED.sub("", label).strip(" :")[:80]
        if not label:
            dropped += 1
            continue
        cand = by_id.get(item.get("column")) if isinstance(item.get("column"), int) else None
        if cand is None:
            cand = by_norm.get(_norm(label))
        if cand is None:
            near = difflib.get_close_matches(_norm(label), list(by_norm), n=1, cutoff=0.85)
            cand = by_norm[near[0]] if near else None
        if cand is None and not (template.kind == "document" and hay and _norm(label) in hay):
            dropped += 1                       # not a heading, not in the text: the model made it up
            continue
        col: Optional[Column] = cand["col"] if cand else None
        kind = str(item.get("type") or "").lower()
        if kind not in ms.FIELD_TYPES:
            kind = cand["type"] if cand else "text"
        if not _kind_ok(kind, col):
            kind = cand["type"] if cand else "text"
        options: List[str] = []
        if kind in ("select", "multiselect"):
            options = _grounded_options(item.get("options") or [], col, template.text if template.kind == "document" else "")
            if not options:
                kind = "text" if not (cand and cand["type"] == "textarea") else "textarea"
        marked = bool(cand and (cand["required"] or _REQUIRED.search(col.header if col else "")))
        if not marked and template.kind == "document":
            marked = bool(re.search(re.escape(label) + r"[^\n]{0,40}(\*|required|mandatory)", template.text, re.I))
        help_text = " ".join(str(item.get("help") or "").split())[:200]
        source_text = (cand["help"] if cand else "") + " " + (col.header if col else "") + " " + (template.text if template.kind == "document" else "")
        if help_text and _norm(help_text) not in _norm(source_text):
            help_text = ""
        try:
            confidence = max(0.0, min(1.0, float(item.get("confidence"))))
        except (TypeError, ValueError):
            confidence = None
        out.append({
            "label": label, "type": kind, "required": bool(item.get("required")) and marked, "options": options,
            "help": help_text, "where": cand["where"] if cand else _where_in_text(label, template.text),
            "example": cand["example"] if cand else "", "confidence": confidence,
            "id": cand["id"] if cand else None,
        })
    return out, dropped


# ── putting it together ──────────────────────────────────────────────────────

def _unique_key(label: str, taken: set) -> str:
    stem = ms._slug(label) or "field"
    if not ms.KEY.match(stem):
        stem = f"f_{stem}"[:40]
    key, n = stem, 2
    while key in taken or not ms.KEY.match(key):
        key = f"{stem[:36]}_{n}"
        n += 1
    taken.add(key)
    return key


def _names(settings: Dict[str, Any]) -> Tuple[List[str], set]:
    """Labels already on the form (live custom fields and the built-in ones) and every key that is taken."""
    labels = [f["label"] for f in settings.get("fields") or [] if not f.get("archived")]
    labels += [b["label"] for b in settings.get("builtins") or []]
    keys = {f["key"] for f in settings.get("fields") or []} | {b["key"] for b in settings.get("builtins") or []}
    return labels, keys


def suggest(filename: str, data: bytes, settings: Dict[str, Any], *, use_ai: bool = True,
            complete: Optional[Callable[[List[Dict[str, str]]], str]] = None) -> Dict[str, Any]:
    """Suggested fields for the module whose current `settings` are given. Nothing is saved."""
    template = read_template(filename, data)
    record = str(((settings.get("module") or {}).get("record")) or "record")
    existing_labels, taken = _names(settings)
    cands = _candidates(template)
    live = [c for c in cands if not c["skip"]]
    notes: List[str] = []
    left_out: List[Dict[str, str]] = [{"label": c["label"], "reason": c["skip"]} for c in cands if c["skip"]]
    by = "rules"
    fields: List[Dict[str, Any]]

    if not live and template.kind == "sheet":
        raise TemplateError("There are no usable column headings in this file.")
    fields = [{"label": c["label"], "type": c["type"], "required": c["required"], "options": c["options"][:MAX_OPTIONS],
               "help": c["help"], "where": c["where"], "example": c["example"], "confidence": None, "id": c["id"]}
              for c in live]
    if use_ai:
        try:
            read = live[:MAX_AI_HEADINGS]                      # a very wide workbook: AI reads the first headings
            raw, left = _ai_fields(template, read, record, existing_labels, complete or _complete)
            grounded, dropped = _ground(raw, template, read)
            if len(live) > len(read):
                notes.append(f"AI read the first {len(read)} of {len(live)} headings in this file.")
            if grounded:
                fields, by = grounded, "ai"
                left_out += left
                if dropped:
                    notes.append(f"{dropped} suggestion{'s' if dropped != 1 else ''} from AI "
                                 f"{'were' if dropped != 1 else 'was'} left out because the file does not contain "
                                 f"{'them' if dropped != 1 else 'it'}.")
            else:
                notes.append("AI's answer did not match anything in this file, so these come from its headings and values.")
        except AIDeclined as exc:
            notes.append(str(exc))
    if not fields:
        raise TemplateError("No fields could be found in this file.")

    out, seen = [], []
    truncated = len(fields) > MAX_SUGGESTIONS
    for f in fields:
        if len(out) >= MAX_SUGGESTIONS:
            break
        if any(_same(f["label"], s) for s in seen):
            continue                                     # the same field twice in one answer
        twin = next((e for e in existing_labels if _same(f["label"], e)), None)
        row = {**f, "status": "exists" if twin else "new", "exists_as": twin}
        row.pop("id", None)
        if not twin:
            row["key"] = _unique_key(f["label"], taken)
            seen.append(f["label"])
        out.append(row)
    if truncated:
        notes.append(f"Only the first {MAX_SUGGESTIONS} fields are shown.")
    return {
        "file": {"name": template.name, "kind": template.kind, "sheets": template.sheets,
                 "headings": len(template.columns)},
        "by": by, "fields": out, "left_out": left_out[:60], "notes": notes,
    }


def add_fields(db: Session, tenant_id: int, module_key: str, items: Any, *, user_id: Optional[int] = None) -> Dict[str, Any]:
    """Add the fields the person confirmed to the module's form. Duplicates of what is already there are skipped,
    not doubled; a dropdown with no options is added as text. Validated by the same code as a hand-made field."""
    if "fields" not in ms.sections(module_key):
        raise ValueError(f"{ms.spec(module_key)['label']} has no custom fields")
    if not isinstance(items, list) or not items:
        raise ValueError("Nothing to add")
    current = ms.get_settings(db, tenant_id, module_key)
    labels, taken = _names(current)
    order = max([int(f.get("order") or 0) for f in current.get("fields") or []] + [0])
    new_fields: List[Dict[str, Any]] = []
    skipped: List[Dict[str, str]] = []
    for raw in items[:MAX_SUGGESTIONS]:
        if not isinstance(raw, dict):
            continue
        label = ms._text(raw.get("label"), "Field name", 80, required=False)
        if not label:
            skipped.append({"label": "", "reason": "No name"})
            continue
        if any(_same(label, e) for e in labels):
            skipped.append({"label": label, "reason": "Already on the form"})
            continue
        kind = str(raw.get("type") or "text").lower()
        if kind not in ms.FIELD_TYPES:
            kind = "text"
        options: List[str] = []
        if kind in ("select", "multiselect"):
            for o in (raw.get("options") or [])[:MAX_OPTIONS] if isinstance(raw.get("options"), list) else []:
                text = ms._text(o, "option", 80, required=False)
                if text and text not in options:
                    options.append(text)
            if not options:
                kind = "text"
        order += 1
        labels.append(label)
        new_fields.append({
            "key": _unique_key(label, taken), "label": label, "type": kind, "required": bool(raw.get("required")),
            "options": options, "depends_on": None, "groups": {},
            "help": ms._text(raw.get("help"), "help text", 200, required=False), "order": order, "archived": False,
        })
    if not new_fields:
        return {"settings": current, "added": [], "skipped": skipped}
    saved = ms.save_settings(db, tenant_id, module_key, {"fields": deepcopy(current.get("fields") or []) + new_fields},
                             user_id=user_id)
    return {"settings": saved, "added": [{"key": f["key"], "label": f["label"], "type": f["type"]} for f in new_fields],
            "skipped": skipped}
