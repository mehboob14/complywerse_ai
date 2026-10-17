"""What a document says about itself, read from its file to fill in the form a person confirms before it is saved.

``read(path, name, db)`` gives each detail of a new document - title, type, description, classification, owner, department,
review cycle, effective and next review dates - with where it came from:

* ``file`` - its document-control table ("Owner | Chief Information Security Officer (CISO)"), its revision table (the latest
  effective or approval date), its first heading (unless that is a numbered section), its Purpose section, a classification
  line in its header or footer, the words of its title, its file name;
* ``ai`` - Comply Agent, asked only for the title, type and description the file leaves open, from the document's opening and
  nothing else (never a framework);
* ``default`` - what a new document starts with (internal, every year, the person as owner on the screen).

A stated owner is a role: it is matched to a person by their designation (or name). One that matches nobody is returned as
``stated`` with no value, so the screen can say who the file names. Nothing is saved here.

``schedule`` is the one rule for a new document's next review: its effective date (or today) plus its review cycle.
"""
from __future__ import annotations

import concurrent.futures
import contextvars
import threading
import logging
import os
import re
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

AI_SECONDS = 20                 # the form waits this long for Comply Agent, then shows what the file said
OPENING_CHARS = 8000            # the part of the document Comply Agent reads
TYPES = ("policy", "standard", "procedure", "guideline", "charter", "framework")      # the library's document types

# a document-control label (lower case, punctuation as spaces) -> the detail it gives
_LABELS = (
    ("title", r"(?:document|policy|procedure|standard) (?:title|name)|title|name of (?:the )?document"),
    ("owner", r"(?:document |policy |procedure |process )?owner(?:ship)?|owned by"),
    ("classification", r"(?:document |information |security |data )?classification|classified as"),
    ("effective", r"effective(?: date| from)?|date effective|date of effect"),
    ("approved", r"(?:approval|approved) date|date (?:of )?approv(?:al|ed)|approved on"),
    ("next_review", r"next (?:scheduled )?review(?: date)?|review due(?: date)?|next revision date"),
    ("cycle", r"(?:document |policy )?review (?:cycle|frequency|period|interval)|frequency(?: of review)?|review"),
    ("department", r"(?:owning |responsible )?department|business unit|division"),
    ("type", r"document type|type of document"),
    ("purpose", r"purpose|description|summary|objective"),
)
_DATES = ("effective", "approved", "next_review")
_TYPE_WORDS = (("procedure", r"procedures?|manual|sop|work instructions?"), ("standard", r"standards?|baseline"),
               ("guideline", r"guidelines?|guidance"), ("charter", r"charter|terms of reference"), ("framework", r"framework"),
               ("policy", r"polic(?:y|ies)"))
_CYCLES = ((6, r"semi[- ]?annual|bi-?annual|six[- ]?months?|6[- ]?months?|twice (?:a|per|each) year|half[- ]?year"),
           (36, r"three years|3 years|36 months|triennial|every third year"),
           (24, r"two years|2 years|24 months|biennial|every other year"),
           (12, r"annual|yearly|every year|once a year|each year|per year|12 months|twelve months|one year|1 year"))
_CLASS = re.compile(r"^\W*(?:(?:document\s+)?classification\W*)?(public|internal(?:\s+use)?(?:\s+only)?|strictly\s+confidential|confidential|restricted|secret)\W*$", re.I)
_NUMBERED = re.compile(r"^\s*(?:\d+(?:\.\d+)*[.)]?|[ivx]+[.)]|[a-z][.)])\s", re.I)
_LINE = re.compile(r"^\s*([A-Za-z][A-Za-z /&]{2,40}?)\s*[:\-–]\s+(\S.{0,300})$")


def _norm(text: Optional[str]) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[^\w&]+", " ", (text or "").lower())).strip()


def _label(text: str) -> Optional[str]:
    t = _norm(text)
    return next((field for field, pattern in _LABELS if re.fullmatch(pattern, t)), None) if t and len(t) <= 40 else None


def _value(text: Optional[str]) -> Optional[str]:
    v = re.sub(r"\s+", " ", text or "").strip(" :-–")
    return v if v and "[[" not in v else None          # a template's placeholder says nothing


# ── the dates, types and cycles a file writes in words ───────────────────────
def parse_day(text: Optional[str]) -> Optional[datetime]:
    """"September 24, 2026", "24/09/2026", "September 2027" (the 1st) -> a date; None for anything without a year."""
    from dateutil import parser

    if not text or not re.search(r"(?:19|20)\d\d", text):
        return None
    try:
        return parser.parse(text, dayfirst=True, fuzzy=True, default=datetime(2000, 1, 1)).replace(hour=0, minute=0, second=0, microsecond=0)
    except (ValueError, OverflowError):
        return None


def months_of(text: Optional[str]) -> Optional[int]:
    t = (text or "").lower()
    return next((n for n, pattern in _CYCLES if re.search(pattern, t)), None)


def type_of(text: Optional[str]) -> Optional[str]:
    """The type a title names: its last type word ("Policy and Procedure Manual" is a procedure)."""
    found = [(m.start(), kind) for kind, pattern in _TYPE_WORDS for m in re.finditer(rf"\b(?:{pattern})\b", text or "", re.I)]
    return max(found)[1] if found else None


def class_of(text: Optional[str]) -> Optional[str]:
    t = (text or "").lower()
    if re.search(r"strictly confidential|secret|restricted", t):
        return "restricted"
    return next((c for c in ("confidential", "internal", "public") if c in t), None)


_MONTH = r"(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?"
_TAIL = re.compile(r"\s+(?:v(?:er(?:sion)?)?\.?\s*\d+(?:[.\s]\d+)*|\d+\.\d+(?:\.\d+)?|(?:19|20)\d\d|q[1-4][- ]?(?:19|20)\d\d"
                   rf"|\d{{1,2}}(?:st|nd|rd|th)?\s*{_MONTH}\s*,?\s*(?:19|20)\d\d|{_MONTH}\s*(?:\d{{1,2}}(?:st|nd|rd|th)?\s*,?\s*)?(?:19|20)\d\d"
                   r"|\d{1,2}[./-]\d{1,2}[./-](?:19|20)?\d\d)$", re.I)
_NOISE = re.compile(r"^(?:v(?:er(?:sion)?)?\.?\s*\d|\d+(?:\.\d+)+$|(?:19|20)\d\d|q[1-4]\b|approved|final|draft|signed|clean|rev(?:ision)?\b)", re.I)


def tidy(title: Optional[str]) -> Optional[str]:
    """A title without the version or date written after it ("Data Governance Policy September 2026" -> "Data Governance Policy")."""
    t = re.sub(r"\s+", " ", title or "").strip(" -_.,")
    while _TAIL.search(t):
        t = _TAIL.sub("", t).strip(" -_.,")
    return t or None


def clean_name(name: str) -> Optional[str]:
    """A file name as a title: "Information Technology Policy 2013 - v1 1 - Approved by BoD.pdf" -> "Information Technology Policy"."""
    base = re.sub(r"[_]+", " ", os.path.splitext(os.path.basename(name or ""))[0])
    base = re.sub(r"[(\[][^)\]]*(?:final|draft|approved|signed|clean|v\d|\d{4})[^)\]]*[)\]]", " ", base, flags=re.I)
    kept: List[str] = []
    for part in re.split(r"\s+[-–]\s+", base):
        if _NOISE.match(part.strip()):
            break
        kept.append(part.strip())
    return tidy(" - ".join(p for p in kept if p))


# ── reading the file ─────────────────────────────────────────────────────────
def _labelled(tables: List[List[List[str]]], lines: List[str]) -> Dict[str, Any]:
    """What the document-control rows (and "Label: value" lines) say, and the latest date of each dated column of a revision table."""
    rows: Dict[str, str] = {}
    columns: Dict[str, Any] = {}
    for table in tables:
        table = [r for r in table if any((c or "").strip() for c in r)]
        if not table:
            continue
        for row in table:                                   # a control table: "Owner | CISO", or "Owner | CISO | Approval Date | ..."
            cells: List[str] = []
            for c in row:                                   # Word repeats a merged cell's text in each cell it spans
                if not cells or _norm(c) != _norm(cells[-1]):
                    cells.append(c or "")
            if len(cells) < 2 or len(cells) % 2 or not all(_label(cells[i]) for i in range(0, len(cells), 2)):
                continue                                    # a revision table's header ("Version | Effective Date | Approved By") is not one
            for i in range(0, len(cells), 2):
                field, value = _label(cells[i]), _value(cells[i + 1])
                if value and field not in rows and (field not in _DATES or parse_day(value)):     # a form's "Date | ____" is no date
                    rows[field] = value
        for k, head in enumerate(table[0]):                 # a revision table: "Version | Effective Date | ..."
            field = _label(head)
            if not field or len(table) < 2:
                continue
            cells = [_value(r[k]) for r in table[1:] if k < len(r)]
            cells = [c for c in cells if c]
            if field in _DATES:
                days = [(d, c) for c in cells for d in [parse_day(c)] if d]
                if days and field not in columns:
                    columns[field] = max(days)
            elif cells and field not in columns:
                columns[field] = cells[-1]
    for line in lines[:120]:
        m = _LINE.match(line or "")
        if m and (field := _label(m.group(1))) and field not in rows and (value := _value(m.group(2))) and (field not in _DATES or parse_day(value)):
            rows[field] = value
    return {"rows": rows, "columns": columns}


def _title_and_purpose(markdown: str) -> Tuple[Optional[str], Optional[str]]:
    from .studio import blocks as B
    from .studio.templates import _ALIASES, key_of

    sections = set(_ALIASES) | {a for names in _ALIASES.values() for a in names} | {"contents", "table of contents", "document control",
                                                                                     "policy statement", "overview"}
    purpose_keys = {"purpose", "overview", "purpose and scope", *_ALIASES["purpose"]}
    blocks = B.parse(markdown or "")
    title: Optional[str] = None
    for b in blocks[:60]:
        if b.kind != "heading":
            continue
        text = b.text.strip()
        if _NUMBERED.match(text):
            break                                           # the sections have started: the document has no title heading
        if key_of(text) in sections or not re.search(r"[A-Za-z]{3}", text) or len(text) > 150:
            continue
        title = text
        break
    purpose: Optional[str] = None
    for i, b in enumerate(blocks[:80]):                     # the document's own Purpose, not a form's further on
        if b.kind == "heading" and key_of(b.text) in purpose_keys:
            for nxt in blocks[i + 1:i + 8]:
                if nxt.kind == "heading":
                    break
                if nxt.kind in ("paragraph", "list_item") and len(nxt.text.split()) >= 5 and "[[" not in nxt.text:
                    purpose = " ".join(re.split(r"(?<=[.!?])\s+", nxt.text.strip())[:2])[:500]
                    break
            if purpose:
                break
    return title, purpose


def _names(text: Optional[str]) -> set:
    """The ways a role is written: in full, without its bracket, and the abbreviation in the bracket ("Chief ... (CISO)")."""
    t = text or ""
    out = {_norm(t), _norm(re.sub(r"\([^)]*\)", " ", t))} | {_norm(a) for a in re.findall(r"\(([^)]{2,12})\)", t)}
    return {x for x in out if x}


def _owner(db, stated: Optional[str]):
    from ...models import GRCUser

    if not stated:
        return None
    want = _names(stated)
    hits = [u for u in db.query(GRCUser).filter(GRCUser.is_active.isnot(False)).order_by(GRCUser.id).all()
            if want & (_names(u.designation) | ({_norm(u.display_name)} if u.display_name else set()))]
    return hits[0] if len(hits) == 1 else None             # two people with that designation: the person chooses


def _department(db, *names: Optional[str]) -> Optional[int]:
    from ...models import GRCDepartment

    rows = db.query(GRCDepartment).filter(GRCDepartment.is_active.isnot(False)).order_by(GRCDepartment.id).all()
    for name in names:
        want = _names(name)
        hit = next((d for d in rows if want and want & (_names(d.name) | {_norm(d.code)})), None) if name else None
        if hit is not None:
            return hit.id
    return None


def _read_file(path: str, name: str) -> Tuple[List[List[List[str]]], List[str], str]:
    from . import doc_version
    from .studio.importers import ImportProblem, import_file

    ext = os.path.splitext(name or path)[1].lower()
    tables: List[List[List[str]]] = []
    lines: List[str] = []
    markdown = ""
    if ext in (".docx", ".pdf"):
        try:
            tables, lines = doc_version._read_docx(path) if ext == ".docx" else doc_version._read_pdf(path)
        except Exception:       # noqa: BLE001 - a file that cannot be read states nothing; its name still may
            logger.info("could not read the tables of %s", name, exc_info=True)
    if ext == ".pdf" and sum(len(x) for x in lines) < 40:
        return tables, lines, ""                            # a scanned PDF: no OCR just to fill a form (the name still helps)
    try:
        markdown = import_file(path, name).markdown
    except ImportProblem:
        pass                                                # .doc, .xls and the like: only the tables and the name
    except Exception:       # noqa: BLE001
        logger.info("could not read the text of %s", name, exc_info=True)
    if ext not in (".docx", ".pdf"):
        lines = markdown.splitlines()[:120]
    return tables, lines, markdown


# ── Comply Agent, for what the file leaves open ─────────────────────────────
SYSTEM = (
    "You are Comply Agent. You read the opening of a governance document (a policy, standard, procedure, guideline, charter or "
    "framework) and fill in its library record as a document controller does.\n"
    "title: the name the document gives itself, without the organisation's name, a version, a date or a status such as Final.\n"
    "doc_type: which of the types it is.\n"
    "description: one or two plain sentences on what the document covers and why, from what it says.\n"
    "Answer with the JSON asked for, using only the text you are given."
)
SCHEMA = {"type": "object", "additionalProperties": False, "required": ["title", "doc_type", "description"],
          "properties": {"title": {"type": "string"}, "doc_type": {"type": "string", "enum": list(TYPES)}, "description": {"type": "string"}}}


def _ask_ai(opening: str, name: str) -> Optional[Dict[str, Any]]:
    """Comply Agent's title, type and description for a document, from its opening; None when it cannot answer in time."""
    from ...services.ai_gateway import claude_client

    if not claude_client.configured() or not opening.strip():
        return None
    user = f"<document file=\"{(name or 'document').replace(chr(34), chr(39))}\">\n{opening}\n</document>"
    pool = concurrent.futures.ThreadPoolExecutor(max_workers=1)
    stop = threading.Event()
    try:
        # on a thread of its own with the request's context (whose usage it is), so the form never waits longer than AI_SECONDS;
        # past it the call is told to stop, so a slow provider does not keep running (and billing) answers nobody reads
        future = pool.submit(contextvars.copy_context().run, claude_client.complete, use_case="governance.document_details", system=SYSTEM,
                             messages=[{"role": "user", "content": user}], schema=SCHEMA, max_tokens=2000, effort="low",
                             should_stop=stop.is_set)
        return future.result(timeout=AI_SECONDS).data or {}
    except concurrent.futures.TimeoutError:
        stop.set()
        logger.warning("reading the details of %r took longer than %ss; the file's own details are used", name, AI_SECONDS)
    except Exception:       # noqa: BLE001 - not configured, blocked by the guard or the licence screen, refused, failed: the file's own details
        logger.warning("Comply Agent could not read the details of %r", name, exc_info=True)
    finally:
        pool.shutdown(wait=False)
    return None


# ── the details ──────────────────────────────────────────────────────────────
def _field(value: Any, source: str, stated: Optional[str] = None) -> Dict[str, Any]:
    out: Dict[str, Any] = {"value": value, "from": source}
    if stated:
        out["stated"] = stated
    return out


def _ymd(day: Optional[datetime]) -> Optional[str]:
    return day.strftime("%Y-%m-%d") if day else None


def read(path: str, name: str, db, *, use_ai: bool = True) -> Dict[str, Any]:
    """``{"fields": {detail: {"value", "from": "file" | "ai" | "default", "stated"?}}, "ai": "used" | "not_needed" | "unavailable"}``."""
    tables, lines, markdown = _read_file(path, name)
    found = _labelled(tables, lines)
    rows, columns = found["rows"], found["columns"]
    heading, purpose = _title_and_purpose(markdown)
    fields: Dict[str, Dict[str, Any]] = {}

    named = clean_name(name)
    title = tidy(heading or rows.get("title"))
    if title and named and title.isupper() and _norm(title) == _norm(named):
        title = named                                       # "ACCEPTABLE USE POLICY" as the file name writes it
    fields["title"] = _field(title or named, "file") if (title or named) else _field(None, "default")
    kind = type_of(rows.get("type")) or type_of(title) or type_of(named)
    fields["doc_type"] = _field(kind, "file") if kind else _field("policy", "default")
    description = purpose                                   # a table's "Purpose" row is as often a form's further on
    fields["description"] = _field(description[:500], "file") if description else _field(None, "default")

    # else a short line such as "CONFIDENTIAL" in the header, footer or cover (the opening lines, not a list of levels further on)
    cls = class_of(rows.get("classification")) or next((class_of(m.group(1)) for ln in lines[:40] if len(ln or "") <= 40 for m in [_CLASS.match(ln or "")] if m), None)
    fields["classification"] = _field(cls, "file", rows.get("classification")) if cls else _field("internal", "default")

    stated_owner = rows.get("owner") or (columns.get("owner") if isinstance(columns.get("owner"), str) else None)
    owner = _owner(db, stated_owner)
    fields["owner_id"] = _field(owner.id, "file", stated_owner) if owner is not None else _field(None, "default", stated_owner)
    department = _department(db, rows.get("department"), getattr(owner, "department", None))
    fields["department_id"] = _field(department, "file") if department else _field(None, "default")

    cycle_text = rows.get("cycle")
    months = months_of(cycle_text)
    fields["review_cycle_months"] = _field(months, "file", cycle_text) if months else _field(12, "default", cycle_text)

    effective, stated = parse_day(rows.get("effective")), rows.get("effective")
    if effective is None and "effective" in columns:
        effective, stated = columns["effective"]
    if effective is None and parse_day(rows.get("approved")):
        effective, stated = parse_day(rows["approved"]), f"Approval date: {rows['approved']}"
    if effective is None and "approved" in columns:
        effective, stated = columns["approved"][0], f"Approval date: {columns['approved'][1]}"
    fields["effective_date"] = _field(_ymd(effective), "file", stated) if effective else _field(None, "default")
    next_review, stated = parse_day(rows.get("next_review")), rows.get("next_review")
    if next_review is None and "next_review" in columns:
        next_review, stated = columns["next_review"]
    if next_review:
        fields["next_review_date"] = _field(_ymd(next_review), "file", stated)
    else:
        fields["next_review_date"] = _field(_ymd(add_months(effective, fields["review_cycle_months"]["value"])) if effective else None, "default")

    wanted = [k for k, open_ in (("title", not title), ("doc_type", not kind), ("description", not description)) if open_]
    if not wanted:
        return {"fields": fields, "ai": "not_needed"}
    answer = _ask_ai(markdown[:OPENING_CHARS], name) if use_ai else None
    used = False
    for key in wanted:
        value = str((answer or {}).get(key) or "").strip()
        if key == "doc_type" and value not in TYPES:
            continue
        if value:
            fields[key] = _field(value[:500], "ai")
            used = True
    return {"fields": fields, "ai": "used" if used else "unavailable"}


# ── the next review of a new document ────────────────────────────────────────
def add_months(day: datetime, months: int) -> datetime:
    from dateutil.relativedelta import relativedelta

    return day + relativedelta(months=int(months))          # 31 January + 1 month = the last day of February


def schedule(doc) -> None:
    """A new document's next review, when none is given: its effective date (or today) plus its review cycle (12 months unless set)."""
    if doc.next_review_date is None:
        start = doc.effective_date or datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
        doc.next_review_date = add_months(start, doc.review_cycle_months or 12)


def check_details(db, *, owner_id=None, department_id=None, review_cycle_months=None, parent_document_id=None, document_id=None) -> None:
    """The details a save is given, checked before any file is written: ValueError with a sentence when one is not usable.
    ``document_id`` is the document being changed, which may not be its own parent nor be filed under its parent."""
    from ...models import GovernanceDocument, GRCDepartment, GRCUser, Tenant

    if parent_document_id is not None:
        if document_id is not None and int(parent_document_id) == int(document_id):
            raise ValueError("A document cannot be its own parent.")
        q = db.query(GovernanceDocument).filter(GovernanceDocument.id == int(parent_document_id))
        tenant = db.query(Tenant).first()
        parent = (q.filter(GovernanceDocument.tenant_id == tenant.id) if tenant else q).first()
        if parent is None:
            raise ValueError("The parent document was not found.")
        seen = set()
        while document_id is not None and parent is not None and parent.id not in seen:      # walk up: no loop
            if parent.parent_document_id == int(document_id):
                raise ValueError("The parent chosen is filed under this document, so it cannot also be its parent.")
            seen.add(parent.id)
            parent = db.get(GovernanceDocument, parent.parent_document_id) if parent.parent_document_id else None
    if owner_id is not None:
        owner = db.get(GRCUser, int(owner_id))
        if owner is None or not owner.is_active:
            raise ValueError("The owner chosen is not an active user.")
    if department_id is not None and db.get(GRCDepartment, int(department_id)) is None:
        raise ValueError("The department chosen does not exist.")
    if review_cycle_months is not None and not 1 <= int(review_cycle_months) <= 60:
        raise ValueError("The review cycle must be between 1 and 60 months.")
