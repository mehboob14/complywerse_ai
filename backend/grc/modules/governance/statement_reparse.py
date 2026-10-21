"""Statements follow their document: whenever a new version of a document is recorded, only the parts of its text that changed are
read again by the AI, and the statements that came from them follow.

The text is the one statement parsing reads (the document's file first, else its content: ``document_text``), cut into *parts*: the
whole sentences of a paragraph (lines that run on are one part), a list item, a table row, a heading (``parts_of``). A sign-off stamp
(the Approval Signoff table, the document-control rows the sign-off fills in) is no part: stamping a document changes no statement.
Each part has a short hash of its words. The document keeps the hashes its statements reflect (``statement_parts``), each statement
the hash of the part it came from (``source_hash``).

A new version (``run``, the job the commit of a new text or file starts, see the listeners next to ``GovernanceDocument``): nothing new
and nothing gone -> no AI call. Otherwise only the new or changed parts go to the AI (neighbours together, each run headed by the
section it is in), and

* a statement whose part changed but whose words are still in the document only moves to its new part;
* a statement whose part changed is matched one to one with what the AI found there (alike >= 0.6) and updated in place: the same id
  and code, so the links people made stay; a snapshot ``auto_reparse`` keeps each state;
* what the AI found that is like no statement becomes a new statement (the next free code), unless it repeats one; one the document
  had before (a restored version) comes back with its old code;
* a statement whose part is gone and that nothing replaced is ``superseded`` ("No longer in the document"), never deleted;
* a statement a person changed by hand that the document does not say yet is never overwritten or superseded.

The new and changed statements are then mapped to controls again (the document's own frameworks) and one Change log row says what
happened. A document whose statements were made before this existed starts from the version before the current one.
"""
from __future__ import annotations

import hashlib
import logging
import os
import re
from collections import Counter
from dataclasses import dataclass
from datetime import datetime
from difflib import SequenceMatcher
from typing import Any, Callable, Dict, FrozenSet, List, Optional, Sequence, Tuple

logger = logging.getLogger(__name__)

MAX_PASSES = 3              # saved again while the AI read it: the new change is read too, this many versions at most
MATCH_MIN = 0.6             # how alike a statement found in a changed part and a statement of that part must be to be the same one
PLACE_MIN = 0.8             # the share of a statement's words a part must hold for the statement to come from it
QUEUED = "Updating statements from the new version…"
STARTED = "statement_reparse_started"      # session.info: the documents this session started an update for
_HELD = ("manual_edit", "rollback")        # a person's own wording: the document may not say it yet

_SPACE = re.compile(r"\s+")
_MARKS = re.compile(r"[*_`]")
_WORDS = re.compile(r"[^\W_]+")
_BLOCK_TAGS = re.compile(r"(?i)<br\s*/?>|</(?:p|div|li|h[1-6]|tr|table|ul|ol|section|blockquote|pre)>")
_TABLE_RULE = re.compile(r"\|?[\s:|-]*-[\s:|-]*\|?")
_MD_HEADING = re.compile(r"^(#{1,6})\s+(.*?)\s*#*$")
_NUMBERED = re.compile(r"^(\d+(?:\.\d+)*)\.?\s+\S")
_NAMED = re.compile(r"^(?:section|chapter|article|part|annex|appendix|schedule)\s+[\divxlc]+\b", re.I)
_ITEM = re.compile(r"^(?:[-*+•▪●◦]\s|\(?[a-z0-9]{1,3}[.)]\s)", re.I)
_SENTENCE_END = re.compile(r"[.!?;:][\"'’”)\]]*$")


# ── the parts of a text ──────────────────────────────────────────────────────
@dataclass
class Part:
    hash: str
    text: str
    path: str                      # the headings above it: "7. Policy statements › 7.2 Joiners"
    norm: str
    words: FrozenSet[str]


def _norm(text: str) -> str:
    return _SPACE.sub(" ", _MARKS.sub("", (text or "").lower())).strip()


def _words(text: str) -> FrozenSet[str]:
    return frozenset(_WORDS.findall((text or "").lower()))


def part_hash(text: str) -> str:
    return hashlib.sha1(_norm(text).encode("utf-8")).hexdigest()[:16]


def _heading(line: str) -> Optional[Tuple[int, str]]:
    m = _MD_HEADING.match(line)
    if m:
        return len(m.group(1)), m.group(2).strip()
    if len(line) > 120 or _SENTENCE_END.search(line):
        return None
    m = _NUMBERED.match(line)
    if m:
        return m.group(1).count(".") + 1, line
    if _NAMED.match(line) or (line.isupper() and sum(c.isalpha() for c in line) >= 4):
        return 1, line
    return None


def parts_of(text: Optional[str]) -> List[Part]:
    """The parts of a text, in order, without the sign-off stamp."""
    from .change_chain import LOCKED
    from .routers.documents import _DOC_CONTROL_LABELS
    from .routers.policy_parser import _sanitize_policy_text

    labels = set(_DOC_CONTROL_LABELS.values())
    out: List[Part] = []
    stack: List[Tuple[int, str]] = []
    buf: List[str] = []
    path = ""

    def flush() -> None:
        if not buf:
            return
        joined = " ".join(buf)
        buf.clear()
        cells = [c.strip(" *") for c in joined.strip("|").split("|")]
        if LOCKED.search(path) or (len(cells) == 2 and cells[0].lower() in labels):
            return                 # stamped by the sign-off flow: no statement of the document
        out.append(Part(part_hash(joined), joined, path, _norm(joined), _words(joined)))

    for raw in _sanitize_policy_text(_BLOCK_TAGS.sub("\n", text or "")).split("\n"):
        line = raw.strip()
        if not line or _TABLE_RULE.fullmatch(line):
            flush()
            continue
        head = _heading(line)
        row = line.startswith("|") or " | " in line
        if head or row or _ITEM.match(line) or (buf and _SENTENCE_END.search(buf[-1])):
            flush()
        if head:
            level, title = head
            while stack and stack[-1][0] >= level:
                stack.pop()
            if not (level == 1 and line.startswith("#")):            # a Markdown title is the document's own name
                stack.append((level, title))
        if not buf:
            path = " › ".join(t for _, t in stack)
        buf.append(line)
        if head or row:
            flush()
    flush()
    return out


def place(text: str, parts: Sequence[Part], min_share: float = PLACE_MIN) -> Optional[Part]:
    """The part a statement comes from: the one holding it word for word, else the one holding most of its words."""
    want = _norm(text)
    if not want or not parts:
        return None
    for p in parts:
        if want in p.norm:
            return p
    words = _words(want)
    if not words:
        return None
    best = max(parts, key=lambda p: len(words & p.words))
    return best if len(words & best.words) / len(words) >= min_share else None


def _alike(a: str, b: str) -> float:
    m = SequenceMatcher(None, _norm(a), _norm(b), autojunk=False)
    return m.ratio() if m.real_quick_ratio() >= MATCH_MIN and m.quick_ratio() >= MATCH_MIN else 0.0


# ── the text statement parsing reads ─────────────────────────────────────────
def _text_of(file_path: Optional[str], file_type: Optional[str], content: Optional[str]) -> Optional[str]:
    text = None
    if file_path and os.path.exists(file_path):
        from .routers.policy_parser import extract_text_from_file

        try:
            text = extract_text_from_file(file_path, file_type)
        except Exception:       # noqa: BLE001 - an unreadable file: the content, as parsing does
            text = None
    if (not text or not text.strip()) and content and content.strip():
        text = content
    return text if text and text.strip() else None


def document_text(document) -> Optional[str]:
    """What statement parsing reads: the document's file first, else its content. None when neither has text."""
    return _text_of(document.file_path, document.file_type, document.content)


def text_key(document) -> Tuple[Optional[str], str]:
    """Changes when a new text or file is saved (without reading the file)."""
    return document.file_path, hashlib.sha1((document.content or "").encode("utf-8")).hexdigest()


def _previous_text(db, document, current: str) -> Optional[str]:
    """The text of the version before the current one, or None when there is none."""
    from ...models import GovernanceDocumentVersion

    has_file = bool(document.file_path and os.path.exists(document.file_path))
    rows = (db.query(GovernanceDocumentVersion).filter(GovernanceDocumentVersion.document_id == document.id)
            .order_by(GovernanceDocumentVersion.created_at.desc(), GovernanceDocumentVersion.id.desc()).all())
    for v in rows:
        if has_file and (not v.file_path or v.file_path == document.file_path):
            continue                                       # the current file, or a version that was no file
        text = _text_of(v.file_path, v.file_type, v.content)
        if text and text != current:
            return text
    return None


def actor(db, document) -> Optional[int]:
    """Who made a change nobody is named for: the newest version's author, else the document's owner."""
    from ...models import GovernanceDocumentVersion

    row = (db.query(GovernanceDocumentVersion.created_by)
           .filter(GovernanceDocumentVersion.document_id == document.id, GovernanceDocumentVersion.created_by.isnot(None))
           .order_by(GovernanceDocumentVersion.created_at.desc(), GovernanceDocumentVersion.id.desc()).first())
    return row[0] if row else document.owner_id


# ── statements ───────────────────────────────────────────────────────────────
def _statements(db, document_id: int, status: str = "active") -> list:
    from ...models import PolicyStatement

    return (db.query(PolicyStatement).filter(PolicyStatement.document_id == document_id, PolicyStatement.status == status)
            .order_by(PolicyStatement.id).all())


def record(db, document, text: str, parts: Optional[List[Part]] = None) -> List[Part]:
    """The statements reflect ``text`` now: its parts' hashes are kept and every statement without a part is placed. No commit."""
    parts = parts_of(text) if parts is None else parts
    document.statement_parts = [p.hash for p in parts]
    for s in _statements(db, document.id):
        if not s.source_hash:
            hit = place(s.statement_text, parts)
            s.source_hash = hit.hash if hit else None
    return parts


def _last_change(db, s) -> Optional[str]:
    from ...models import PolicyStatementVersion

    row = (db.query(PolicyStatementVersion.change_type).filter(PolicyStatementVersion.statement_id == s.id)
           .order_by(PolicyStatementVersion.version_number.desc(), PolicyStatementVersion.id.desc()).first())
    return row[0] if row else None


def _held(db, s) -> bool:
    """A person's own wording the document does not say: never overwritten or superseded by a new version."""
    if s.source_text is not None and (s.statement_text or "").strip() != s.source_text.strip():
        return True                                        # document sync: edited, not yet written into the document
    return _last_change(db, s) in _HELD


def _snapshot(db, s, user_id: Optional[int], reason: str) -> None:
    from .routers.policy_parser import _create_version_snapshot

    _create_version_snapshot(db, s, "auto_reparse", user_id, reason)


def _moved(db, s, part: Optional[str], user_id: Optional[int], version: str) -> None:
    """The statement's words are in the document, in ``part``. A person's own wording is the document's from now on."""
    s.source_hash = part or s.source_hash
    if _last_change(db, s) in _HELD:
        _snapshot(db, s, user_id, f"In the document since version {version}")


_LIMITS = {"category": 100, "priority": 20, "source_section": 255}


def _fill(s, found: Dict[str, Any], text: str) -> None:
    s.statement_text = text
    if found.get("statement_summary"):
        s.statement_summary = str(found["statement_summary"])[:500]
    for name, limit in _LIMITS.items():
        if found.get(name):
            setattr(s, name, str(found[name])[:limit])
    if found.get("is_mandatory") is not None:
        s.is_mandatory = bool(found["is_mandatory"])
    try:
        s.ai_confidence = float(found["ai_confidence"])
    except (KeyError, TypeError, ValueError):
        pass
    if isinstance(found.get("ai_extracted_keywords"), list):
        s.ai_extracted_keywords = found["ai_extracted_keywords"]


def _next_number(db, document_id: int) -> int:
    from ...models import PolicyStatement

    codes = db.query(PolicyStatement.statement_code).filter(PolicyStatement.document_id == document_id).all()
    numbers = [int(m.group(1)) for (code,) in codes for m in [re.search(r"(\d+)$", code or "")] if m]
    return max(numbers, default=0) + 1


def _version_row_id(db, document_id: int) -> Optional[int]:
    from ...models import GovernanceDocumentVersion

    row = (db.query(GovernanceDocumentVersion.id).filter(GovernanceDocumentVersion.document_id == document_id)
           .order_by(GovernanceDocumentVersion.created_at.desc(), GovernanceDocumentVersion.id.desc()).first())
    return row[0] if row else None


def _changed_text(parts: Sequence[Part], changed: Sequence[int]) -> str:
    """The new and changed parts as the AI reads them: neighbours together, each run under the section it is in."""
    runs: List[List[int]] = []
    for i in changed:
        if runs and runs[-1][-1] == i - 1:
            runs[-1].append(i)
        else:
            runs.append([i])
    blocks = []
    for run in runs:
        head = parts[run[0]].path
        blocks.append((f"Section: {head}\n" if head else "") + "\n".join(parts[i].text for i in run))
    return "\n\n".join(blocks)


def _codes(codes: List[str]) -> str:
    return ", ".join(codes[:20]) + (f" and {len(codes) - 20} more" if len(codes) > 20 else "")


_LABELS = (("added", "added"), ("changed", "changed"), ("removed", "no longer in the document"))


def _said(out: Dict[str, List[str]], codes: bool = True) -> str:
    return ", ".join(f"{len(out[k])} {label}" + (f" ({_codes(out[k])})" if codes else "") for k, label in _LABELS if out.get(k))


def summary(version: str, out: Dict[str, List[str]]) -> str:
    """'v2.0: 2 added (PS-0005-011, PS-0005-012), 1 changed (PS-0005-003), 1 no longer in the document (PS-0005-007)'."""
    return f"v{version}: " + (_said(out) or "no statement changed")


# ── one version ──────────────────────────────────────────────────────────────
def _pass(db, document, user_id: Optional[int], status: Callable[[dict], None]) -> Optional[Tuple[Dict[str, List[str]], List[int]]]:
    """Bring the statements up to the document's text. Returns the codes added, changed and no longer in the document and the ids of
    the statements to map again, or None when the text cannot be read. Commits."""
    from ...models import PolicyStatement, PolicyStatementCompliance
    from .doc_sync import anchor_after_parse
    from .routers.documents import create_audit_log
    from .routers.policy_parser import _is_duplicate, parse_policy_statements_with_openai

    text = document_text(document)
    if text is None:
        return None
    current = parts_of(text)
    hashes = [p.hash for p in current]
    stmts = _statements(db, document.id)
    version = document.current_version or "1.0"
    out: Dict[str, List[str]] = {"added": [], "changed": [], "removed": []}
    stored = document.statement_parts
    if stored is None:                       # statements from before this: they are taken to reflect the version before this one
        before = _previous_text(db, document, text)
        if before is None:
            record(db, document, text, current)
            db.commit()
            return out, []
        base = parts_of(before)
        stored = [p.hash for p in base]
    else:
        base = current                       # added by hand or by a gap fix since: placed where they are now, if they are there
    for s in stmts:
        if not s.source_hash:
            hit = place(s.statement_text, base)
            s.source_hash = hit.hash if hit else None
    new = Counter(hashes) - Counter(stored)
    gone = set(Counter(stored) - Counter(hashes))
    if not new and not gone:
        document.statement_parts = hashes
        db.commit()
        return out, []

    whole = _norm(text)
    free = []                                # the statements whose part changed or went
    for s in stmts:
        if s.source_hash not in gone:
            continue
        hit = place(s.statement_text, current, 0.0) if _norm(s.statement_text) and _norm(s.statement_text) in whole else None
        if hit is not None:
            _moved(db, s, hit.hash, user_id, version)       # only the paragraph around it changed
        else:
            free.append(s)

    need, changed = Counter(new), []
    for i, p in enumerate(current):
        if need[p.hash] > 0:
            changed.append(i)
            need[p.hash] -= 1
    found: List[Tuple[Dict[str, Any], str, Optional[str]]] = []
    if changed:
        def progress(current_chunk: int, total_chunks: int, phase: str = "processing") -> None:
            done = current_chunk if phase == "processed" else max(current_chunk - 1, 0)
            status({"status": "parsing", "message": QUEUED, "automatic": True,
                    "progress_percent": int(done * 100 / total_chunks) if total_chunks else 0})

        sent = [current[i] for i in changed]
        for item in parse_policy_statements_with_openai(_changed_text(current, changed), document.title, progress_callback=progress,
                                                        at_least=0) or []:
            words = str(item.get("statement_text") or "").strip()[:10000]
            if words:
                hit = place(words, sent) or place(words, current) or place(words, sent, 0.0)
                found.append((item, words, hit.hash if hit else None))

    now, row_id, remap = datetime.utcnow(), _version_row_id(db, document.id), []
    pairs = sorted(((_alike(words, s.statement_text), i, s) for i, (_item, words, _h) in enumerate(found) for s in free),
                   key=lambda x: -x[0])
    taken, matched = set(), set()
    for ratio, i, s in pairs:
        if ratio < MATCH_MIN:
            break
        if i in taken or s.id in matched:
            continue
        taken.add(i)
        matched.add(s.id)
        item, words, h = found[i]
        if _norm(words) == _norm(s.statement_text):
            _moved(db, s, h, user_id, version)                # the same statement in a changed paragraph
            continue
        if _held(db, s):
            s.source_hash = h                                  # a person's wording the document does not say: it stays theirs
            continue
        _fill(s, item, words)
        s.source_hash, s.document_version_id, s.updated_at = h, row_id or s.document_version_id, now
        s.source_text = s.source_start = s.source_match = None        # matched to the file again (document sync)
        _snapshot(db, s, user_id, f"Updated from version {version} of the document")
        out["changed"].append(s.statement_code)
        remap.append(s.id)

    known = [{"statement_text": s.statement_text} for s in stmts]
    earlier = _statements(db, document.id, "superseded")
    number = _next_number(db, document.id)
    for i, (item, words, h) in enumerate(found):
        if i in taken or _is_duplicate(words, known):
            continue
        known.append({"statement_text": words})
        back = next((s for s in earlier if _is_duplicate(words, [{"statement_text": s.statement_text}])), None)
        if back is not None:                 # in the document again (an earlier version restored): the same statement again
            earlier.remove(back)
            _fill(back, item, words)
            back.status, back.source_hash, back.document_version_id, back.updated_at = "active", h, row_id or back.document_version_id, now
            back.source_text = back.source_start = back.source_match = None
            _snapshot(db, back, user_id, f"In the document again in version {version}")
            out["added"].append(back.statement_code)
            remap.append(back.id)
            continue
        s = PolicyStatement(tenant_id=document.tenant_id, document_id=document.id, document_version_id=row_id,
                            statement_code=f"PS-{document.id:04d}-{number:03d}", statement_text=words, priority="medium",
                            is_mandatory=True, ai_extracted_keywords=[], status="active", source_hash=h, created_by=user_id,
                            created_at=now)
        number += 1
        _fill(s, item, words)
        db.add(s)
        db.flush()
        _snapshot(db, s, user_id, f"Added from version {version} of the document")
        db.add(PolicyStatementCompliance(tenant_id=document.tenant_id, statement_id=s.id, compliance_status="not_assessed",
                                         owner_id=document.owner_id))
        out["added"].append(s.statement_code)
        remap.append(s.id)

    for s in free:
        if s.id in matched or _held(db, s):
            continue
        s.status, s.updated_at = "superseded", now
        _snapshot(db, s, user_id, f"No longer in the document (version {version})")
        out["removed"].append(s.statement_code)

    document.statement_parts = hashes
    if any(out.values()):
        create_audit_log(db=db, document_id=document.id, tenant_id=document.tenant_id, user_id=user_id,
                         action="statements_updated_from_document", field_changed="statement", action_details=summary(version, out))
    db.commit()
    anchor_after_parse(db, document.id, user_id)
    return out, remap


def _remap(db, tenant_slug: Optional[str], document_id: int, ids: List[int]) -> None:
    """The new and changed statements are mapped to controls again, in the document's own frameworks, as after the first parse."""
    if not ids:
        return
    try:
        if tenant_slug:
            from ...tasks.governance import dispatch_auto_map

            dispatch_auto_map(tenant_slug, document_id, statement_ids=ids)
        else:
            from .statement_auto_map import auto_map_document

            auto_map_document(db, document_id, statement_ids=ids)
    except Exception:       # noqa: BLE001 - the statements are saved; their links come with the next mapping
        logger.warning("statements %s of document %s were not mapped again", ids, document_id, exc_info=True)
        db.rollback()


def run(db, document, user_id: Optional[int], tenant_slug: Optional[str], status: Callable[[dict], None], *,
        remap: bool = True) -> Dict[str, Any]:
    """The job a new version starts: the statements follow the text. Saved again while the AI read it -> that change is read too
    (``MAX_PASSES`` versions at most). ``remap`` False: the caller maps the whole document afterwards."""
    status({"status": "parsing", "message": QUEUED, "automatic": True, "progress_percent": 0})
    totals: Dict[str, List[str]] = {"added": [], "changed": [], "removed": []}
    ids: List[int] = []
    read = False
    for n in range(MAX_PASSES):
        key = text_key(document)
        result = _pass(db, document, user_id if n == 0 else actor(db, document), status)
        if result is None:
            break
        read = True
        for k, codes in result[0].items():
            totals[k] += codes
        ids += [i for i in result[1] if i not in ids]
        db.expire(document)
        if text_key(document) == key:
            break
    if remap:
        _remap(db, tenant_slug, document.id, ids)
    if not read:
        status({"status": "failed", "error": "No text could be extracted from the document", "automatic": True})
        return {"status": "failed"}
    counts = {k: len(v) for k, v in totals.items()}
    version = document.current_version or "1.0"
    message = (f"Statements updated from version {version}: {_said(totals, codes=False)}." if any(counts.values())
               else f"The statements already match version {version}.")
    done: Dict[str, Any] = {"status": "completed", "automatic": True, "message": message, **counts,
                            "total_statements": len(_statements(db, document.id)), "progress_percent": 100}
    from .routers.policy_parser import _load_proposals

    waiting = _load_proposals(tenant_slug, document.id) or {}
    if any(p.get("status") == "pending" for p in waiting.get("proposals") or []):
        done["has_proposals"] = True                      # a review of reading it again is still open: its panel stays
    status(done)
    return {"status": "completed", **counts}


def after_proposals(db, document, statement_ids: Sequence[int], parts: Optional[List[str]], user_id: Optional[int],
                    tenant_slug: Optional[str]) -> None:
    """After a person accepted what reading the whole document again proposed: the statements reflect the text that was read (its
    parts were kept with the proposals; for older proposals the text as it is now), the accepted ones are placed where they are and
    mapped to controls again, and a version saved since that reading is read too. Commits."""
    from ...models import PolicyStatement

    ids = list(dict.fromkeys(statement_ids))              # (several proposals can change one statement)
    for s in db.query(PolicyStatement).filter(PolicyStatement.id.in_(ids or [0])).all():
        s.source_hash = None
    text = document_text(document) or ""
    current = record(db, document, text)
    if parts is not None:
        document.statement_parts = list(parts)
    db.commit()
    _remap(db, tenant_slug, document.id, ids)
    if tenant_slug and parts is not None and list(parts) != [p.hash for p in current]:
        start(tenant_slug, [document.id])


# ── starting it ──────────────────────────────────────────────────────────────
def _dispatch(tenant_slug: str, document_id: int, user_id: Optional[int]) -> bool:
    from ...tasks.base import RateLimitExceeded, tenant_rate_limit

    try:
        redis_up = tenant_rate_limit(tenant_slug, bucket="governance_parse")
    except RateLimitExceeded:
        # ponytail: over the tenant's parse limit the update is skipped; the next new version catches up (it is compared with
        # the parts the statements reflect, not with the version before it). Queue it for later if bursts ever matter.
        logger.info("statements of document %s not updated now: over the parse limit", document_id)
        return False
    queued = {"status": "queued", "message": QUEUED, "automatic": True, "progress_percent": 0,
              "updated_at": datetime.utcnow().isoformat()}
    from .routers.policy_parser import _parsing_status

    _parsing_status[document_id] = queued
    if redis_up:
        from ...job_status import set_status

        set_status(tenant_slug, "policy_parse", document_id, queued)
    from ...tasks.governance import dispatch_parse, dispatch_parse_in_thread

    # without Redis the request does not wait on Celery's broker (that Redis): a thread at once, as on create
    (dispatch_parse if redis_up else dispatch_parse_in_thread)(tenant_slug, document_id, user_id, incremental=True)
    return True


def start(tenant_slug: str, document_ids: Sequence[int], session=None) -> List[int]:
    """Start the update of each document's statements (Celery, else a thread). Called after a commit changed their text: runs no SQL
    (the session is between transactions) and never raises. ``session``: the documents started are noted on it, so a create path
    that parses the document itself does not start a second job. Returns the documents started."""
    try:
        from ...services.ai_usage import resolve_context

        user_id = resolve_context().actor_user_id          # the person whose change it is, when a request is behind it
    except Exception:       # noqa: BLE001
        user_id = None
    started = []
    for document_id in document_ids:
        try:
            if _dispatch(tenant_slug, document_id, user_id):
                started.append(document_id)
        except Exception:   # noqa: BLE001 - the change is saved; its statements catch up with the next one
            logger.warning("statements of document %s were not updated", document_id, exc_info=True)
    if session is not None:
        session.info.setdefault(STARTED, set()).update(started)
    return started
