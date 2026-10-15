"""The AI turns of the studio: a chat turn (draft, revise, answer), a language and requirements check, and a comparison.

Each runs as a *message*: the assistant's row is created ``working`` and filled in here, so the person sees progress and the
result is kept with the conversation. Nothing the AI returns is trusted: edits are placed by block id and dropped when they
do not fit or touch a protected value, HTML is stripped, every quote it reports is looked for in the reference it names, and
what it says is a *proposal* the person accepts, not a change to the document.
"""
from __future__ import annotations

import logging
import re
from datetime import datetime
from typing import Any, Dict, List, Optional, Sequence

from ....services.ai_gateway import claude_client, patterns
from ....services.ai_gateway.errors import AIBlocked
from ....services.licence_guard import LicenceRestrictedContent
from . import blocks as B
from . import checks, live, prompts
from . import references as refs

logger = logging.getLogger(__name__)

MAX_DOC_CHARS = 260_000                 # a document sent whole in one turn
CHECK_WHOLE_CHARS = 150_000             # a document checked in one call (requirements need the whole of it)
CHECK_CHUNK_CHARS = 40_000
_TOKEN = re.compile(r"<[A-Z][A-Z_]*_\d+>")
_GENERATE = re.compile(r"\b(rewrite|regenerate|from scratch|entire|whole|complete|full|draft|write|create|generate|prepare)\b", re.I)


class TurnProblem(ValueError):
    """Why a turn cannot run; the message is for the person."""


def friendly(exc: BaseException) -> str:
    """What the person is told when a turn fails: written for them, naming no vendor."""
    if isinstance(exc, (AIBlocked, LicenceRestrictedContent, claude_client.ClaudeNotConfigured, claude_client.ClaudeRefused,
                        claude_client.ClaudeFailed, refs.ReferenceProblem, TurnProblem)):
        return str(exc)
    logger.exception("a studio turn failed")
    return "Something went wrong while the AI was working. Try again; if it keeps happening, tell an administrator."


# ── what comes back from the model ───────────────────────────────────────────
_STRIP_ELEMENTS = re.compile(r"<(script|style|iframe|object|embed)\b.*?</\1\s*>", re.I | re.S)
_STRIP_TAGS = re.compile(
    r"</?(?:script|style|iframe|object|embed|img|svg|div|span|p|a|b|i|strong|em|h[1-6]|ul|ol|li|table|thead|tbody|tr|td|th|font|center|section|"
    r"article|form|input|button|link|meta)\b[^>]*>", re.I)


def sanitize_markdown(md: str) -> str:
    """The Markdown a model wrote, safe to keep: no wrapping code fence, no HTML except <u> and <br>."""
    md = (md or "").replace("\r\n", "\n").strip("\n")
    fenced = re.fullmatch(r"```(?:markdown|md)?\n(.*)\n```", md.strip(), re.S)
    if fenced:
        md = fenced.group(1)
    return _STRIP_TAGS.sub("", _STRIP_ELEMENTS.sub("", md))


def protected_blocks(blocks: Sequence[B.Block]) -> List[int]:
    """Blocks holding a value the guard removes before anything is sent (a secret, an account number): the AI cannot see them
    whole, so it must not be allowed to rewrite them."""
    return [i for i, b in enumerate(blocks) if patterns.detect_dropped(b.source)]


def _op_view(op: B.Op, blocks: Sequence[B.Block]) -> Dict[str, Any]:
    after = B.parse(op.markdown) if op.kind != "delete" else []
    first = 0
    if op.kind == "replace_all":
        before: List[B.Block] = list(blocks)
    elif op.kind in ("replace", "delete"):
        first, e = B._range(op, len(blocks))
        before = list(blocks[first:e + 1])
    else:
        before = []
    old = " ".join(b.text for b in before)
    new = " ".join(b.text for b in after)
    added = removed = 0
    for kind, text in B.word_diff(old, new):
        n = len(re.findall(r"\w+", text))
        added += n if kind == "insert" else 0
        removed += n if kind == "delete" else 0
    return {"id": op.id, "kind": op.kind, "start": op.start, "end": op.end or op.start, "markdown": op.markdown, "reason": op.reason,
            "refs": op.refs, "status": "pending", "words_added": added, "words_removed": removed,
            "before": [{"index": first + n, "kind": b.kind, "text": b.text[:600]} for n, b in enumerate(before[:40])] if op.kind != "replace_all" else [],
            "before_count": len(before), "after": [{"kind": b.kind, "level": b.level, "text": b.text[:600]} for b in after[:40]], "after_count": len(after)}


def interpret(data: Dict[str, Any], blocks: Sequence[B.Block], references: Sequence[Any], protected: Sequence[int]) -> Dict[str, Any]:
    """The model's answer as the studio keeps it: reply, the edits that can be placed (pending), the references with each quote
    checked, the placeholders now in the document, the requirement verdicts and what the person should know."""
    notes: List[str] = []
    keys = {r.ref_key: r for r in references}
    valid: List[B.Op] = []
    for n, c in enumerate(data.get("changes") or [], start=1):
        op = B.Op(f"c{n}", str(c.get("kind") or ""), str(c.get("start") or "").strip(), str(c.get("end") or "").strip(),
                  sanitize_markdown(str(c.get("markdown") or "")), str(c.get("reason") or "").strip(),
                  [r for r in (c.get("refs") or []) if r in keys])
        why = B.check_op(op, len(blocks))
        if not why and op.kind in ("replace", "delete"):
            s, e = B._range(op, len(blocks))
            if any(i in protected for i in range(s, e + 1)):
                why = "it touches a block that holds a protected value"
        if not why and re.search(r"<REMOVED_[A-Z_]+>", op.markdown):
            why = "it contains a value that was removed for protection"
        if why:
            notes.append(f"One change could not be used: {why}.")
        else:
            valid.append(op)
    proposed, status = B.apply_ops(blocks, valid)
    ops: List[Dict[str, Any]] = []
    for op in valid:
        if status.get(op.id) == "applied":
            ops.append(_op_view(op, blocks))
        else:
            notes.append(f"One change could not be used: {status.get(op.id)}.")

    used: List[Dict[str, Any]] = []
    for u in data.get("references_used") or []:
        key, quote, basis = str(u.get("ref") or "").strip(), str(u.get("quote") or "").strip(), u.get("basis") or "reference"
        ref = keys.get(key)
        row: Dict[str, Any] = {"ref": key, "title": ref.title if ref else "", "kind": ref.kind if ref else "", "locator": str(u.get("locator") or "").strip(),
                               "quote": quote, "how": str(u.get("how") or "").strip(), "basis": basis, "verified": None, "locator_ok": None}
        if basis == "reference":
            row["verified"] = bool(ref and quote and refs.verify_quote(ref.text, quote))
            row["locator_ok"] = refs.verify_locator(ref, row["locator"]) if ref else None
        used.append(row)
    unverified = sum(1 for u in used if u["basis"] == "reference" and not u["verified"])
    if unverified:
        notes.append(f"{unverified} quoted passage(s) could not be found in the reference they are attributed to: check them before relying on them.")

    proposed_blocks = proposed
    text_after = "\n".join(b.source for b in proposed_blocks)
    leftover = len(set(_TOKEN.findall(text_after)) - set(_TOKEN.findall("\n".join(b.source for b in blocks))))
    if leftover:
        notes.append(f"{leftover} protected placeholder(s) in the new text could not be matched to a real value: check the highlighted text.")
    return {
        "reply": str(data.get("reply") or "").strip(), "ops": ops, "references_used": used,
        "questions": [str(q).strip() for q in data.get("questions") or [] if str(q).strip()][:3],
        "placeholders": checks.placeholders(proposed_blocks), "requirements": list(data.get("requirements") or []),
        "notes": notes, "stats": B.stats(blocks, proposed_blocks) if ops else None,
    }


# ── a chat turn ──────────────────────────────────────────────────────────────
def _history(db, session, before_id: int) -> List[tuple]:
    from ....models import StudioMessage

    rows = (db.query(StudioMessage).filter(StudioMessage.session_id == session.id, StudioMessage.id < before_id, StudioMessage.kind == "chat",
                                           StudioMessage.status == "done").order_by(StudioMessage.id.desc()).limit(10).all())
    return [(r.role, r.content) for r in reversed(rows) if r.content.strip()]


def _stage(db, msg, label: str, **kw: Any) -> None:
    """The line the person sees while the turn works, and the list of steps behind it (see ``live``)."""
    live.stage(db, msg, label, **kw)


_VERB = {"replace": "Rewording", "insert": "Adding", "delete": "Removing", "replace_all": "Writing the whole document"}


def describe_change(c: Dict[str, Any]) -> str:
    """One line for a change the AI is preparing, from as much of it as is written ("Rewording block 12 (140 words so far)"). Empty until its
    kind and where it goes are known."""
    kind = str(c.get("kind") or "")
    if kind not in _VERB or (kind != "replace_all" and not re.fullmatch(r"(?i)B\d+|START", str(c.get("start") or "").strip())):
        return ""
    start, end = re.sub(r"^B", "", str(c.get("start") or "").strip(), flags=re.I), re.sub(r"^B", "", str(c.get("end") or "").strip(), flags=re.I)
    if kind == "replace_all":
        where = ""
    elif kind == "insert":
        where = " at the top" if start.upper() == "START" else f" after block {start}" if start else ""
    else:
        where = f" blocks {start}–{end}" if end and end != start else f" block {start}" if start else ""
    n = live.words(str(c.get("markdown") or ""))
    return f"{_VERB[kind]}{where}" + (f" ({n:,} words so far)" if n and kind != "delete" else "")


def chat_progress(db, msg):
    """The function that shows a chat answer on its message as the AI writes it: the steps, the reply so far, and each change as it is prepared."""
    state = {"step": None}

    def step(name: str, label: str, **fields: Any) -> None:
        live.stage(db, msg, label, step=state["step"] != name, **fields)
        state["step"] = name

    def show(p: claude_client.Progress) -> None:
        if p.phase != "writing":
            step(p.phase, "The AI is reading your request" if p.phase == "reading" else "The AI is thinking it through",
                 detail=f"Protected {p.protected} value{'' if p.protected == 1 else 's'} (names, numbers, secrets) before sending" if p.protected and state["step"] is None else None)
            return
        data = p.data if isinstance(p.data, dict) else {}
        described = [(c, describe_change(c)) for c in data.get("changes") or [] if isinstance(c, dict)]
        changes, lines = [c for c, line in described if line], [line for _, line in described if line]
        reply = p.show(str(data.get("reply") or ""))
        if not changes:
            step("reply", "Writing the reply", text=reply)
            return
        whole = len(changes) == 1 and changes[0].get("kind") == "replace_all"
        label = f"Writing the whole document: {live.words(str(changes[0].get('markdown') or '')):,} words so far" if whole else f"Preparing the changes: {len(changes)} so far"
        step("changes", label, text=reply, groups=[{"label": "Changes being prepared", "items": lines}],
             tail=live.tail(str(changes[-1].get("markdown") or ""), p.show), tail_label=lines[-1].split(" (")[0])

    return show


def counting(db, msg, base: str, field: str, noun: str):
    """The function that shows, as the AI writes a report, how many ``field`` items it has found so far ("Checking: 4 problems so far")."""
    def show(p: claude_client.Progress) -> None:
        n = len((p.data or {}).get(field) or []) if p.phase == "writing" and isinstance(p.data, dict) else 0
        live.stage(db, msg, f"{base}: {n} {noun} so far" if n else base, step=False)

    return show


def run_chat_turn(db, session_id: int, message_id: int) -> None:
    """Fill in the assistant message ``message_id`` of a session. Never raises: a failure is written on the message."""
    from ....models import StudioMessage, StudioReference, StudioSession
    from . import service, templates

    session, msg = db.get(StudioSession, session_id), db.get(StudioMessage, message_id)
    try:
        request = (db.query(StudioMessage).filter(StudioMessage.session_id == session_id, StudioMessage.role == "user",
                                                  StudioMessage.id < message_id).order_by(StudioMessage.id.desc()).first())
        if request is None:
            raise TurnProblem("There is nothing to answer.")
        _stage(db, msg, "Reading the document and the references")
        blocks = B.parse(session.content)
        from . import drafting

        if drafting.wants_whole_document(session, blocks, request.content):       # a document not yet started, asked for whole: write it, do not sketch it
            drafting.run_draft(db, session_id, message_id)
            return
        references = (db.query(StudioReference).filter(StudioReference.session_id == session_id).order_by(StudioReference.id).all())
        live.note(db, msg, ("a blank document" if B.is_blank(blocks) else f"{len(blocks)} blocks") + " · "
                  + (f"{len(references)} reference{'' if len(references) == 1 else 's'}" if references else "no references"))
        if sum(len(b.source) for b in blocks) > MAX_DOC_CHARS:
            raise TurnProblem("This document is too large to work on in one go. Open the part you want to change as its own document, or work on one section at a time.")
        if refs.total_chars(references) > refs.MAX_TOTAL_CHARS:
            raise TurnProblem("The references are too large together. Remove one, or narrow a framework to the parts you need.")
        # the required sections steer a new document and one started from a template; an uploaded document is not held to them
        structure = templates.structure_for(db, session.doc_type, session.template_id) if (B.is_blank(blocks) or session.template_id) else None
        protected = protected_blocks(blocks)
        file_notes = []
        if (session.native_map or {}).get("auto_numbered"):
            file_notes.append("The headings of this Word file are numbered by Word itself: write a heading without its number (\"Scope\", not \"2. Scope\").")
        if session.source_kind == "pdf":
            file_notes.append("This text was read from a PDF, so a heading, list or table may have been read wrongly; keep what is clearly right and fix what is clearly broken.")
        turn = prompts.TurnInput(kind=session.kind, doc_type=session.doc_type, title=session.title, instructions=session.instructions or {},
                                 blocks=blocks, request=request.content, references=references, structure=structure,
                                 protected=protected, revision=session.revision_no, history=_history(db, session, request.id), format_notes=file_notes)
        big = B.is_blank(blocks) or bool(_GENERATE.search(request.content))
        result = claude_client.complete(
            use_case="governance.studio_chat", system=prompts.SYSTEM, messages=[{"role": "user", "content": prompts.render_user(turn)}],
            schema=prompts.TURN_SCHEMA, max_tokens=64000 if big else 32000, effort="high" if big else "medium", on_progress=chat_progress(db, msg))
        _stage(db, msg, "Checking the result")
        out = interpret(result.data, blocks, references, protected)
        if result.truncated:
            out["notes"].append("The answer reached its length limit: the last change may be incomplete. Ask for the rest in a follow-up.")
        msg.content = out["reply"] or ("I made changes for you to review." if out["ops"] else "")
        msg.proposal = {"ops": out["ops"], "base_revision": session.revision_no, "stats": out["stats"],
                        "placeholders": len(out["placeholders"]), "requirements": out["requirements"]}
        msg.references_used, msg.questions, msg.notes = out["references_used"], out["questions"], out["notes"]
        msg.base_revision = session.revision_no
        msg.usage = {"input_tokens": result.usage.get("input_tokens", 0) + result.usage.get("cache_read_input_tokens", 0)
                     + result.usage.get("cache_creation_input_tokens", 0), "output_tokens": result.usage.get("output_tokens", 0),
                     "cached_tokens": result.usage.get("cache_read_input_tokens", 0)}
        msg.status, msg.stage, msg.error, msg.updated_at = "done", None, None, datetime.utcnow()
        db.commit()
        if out["ops"] and (B.is_blank(blocks) or (session.settings or {}).get("auto_apply")):
            service.accept_ops(db, session, msg, [o["id"] for o in out["ops"]], request.created_by, auto=True)
    except Exception as exc:        # noqa: BLE001 - the person sees a sentence, the log sees the cause
        db.rollback()
        msg = db.get(StudioMessage, message_id)
        msg.status, msg.stage, msg.error, msg.updated_at = "error", None, friendly(exc), datetime.utcnow()
        db.commit()


# ── language and requirement checks ──────────────────────────────────────────
def _find_quote(block: B.Block, quote: str) -> Optional[str]:
    """``quote`` as it is written in the block's Markdown, or None when it is not in the block."""
    if not quote:
        return None
    if quote in block.source:
        return quote
    flat = re.sub(r"\s+", " ", quote).strip()
    return flat if flat and flat in re.sub(r"\s+", " ", block.source) else None


def _chunks(blocks: Sequence[B.Block], protected: Sequence[int]) -> List[tuple]:
    """Runs of blocks small enough to proofread in one call, cut before a heading when possible: ``[(first index, last index)]``."""
    out, start, size = [], 0, 0
    for i, b in enumerate(blocks):
        if size and size + len(b.source) > CHECK_CHUNK_CHARS and b.kind == "heading":
            out.append((start, i - 1))
            start, size = i, 0
        size += len(b.source)
        if size > CHECK_CHUNK_CHARS * 1.5:
            out.append((start, i))
            start, size = i + 1, 0
    if start < len(blocks):
        out.append((start, len(blocks) - 1))
    return out


def run_ai_checks(db, session_id: int, message_id: int) -> None:
    """Proofread the document (spelling, grammar, wording, consistency) and judge the required items. Result on the message."""
    from ....models import StudioMessage, StudioSession

    session, msg = db.get(StudioSession, session_id), db.get(StudioMessage, message_id)
    try:
        blocks = B.parse(session.content)
        if not blocks:
            raise TurnProblem("The document is empty: there is nothing to check.")
        protected = protected_blocks(blocks)
        reqs = [r for r in (session.instructions or {}).get("requirements") or [] if str(r).strip()]
        whole = sum(len(b.source) for b in blocks) <= CHECK_WHOLE_CHARS
        spans = [(0, len(blocks) - 1)] if whole else _chunks(blocks, protected)
        notes: List[str] = []
        if reqs and not whole:
            notes.append("The document is too large to judge the required items in one go: they were not checked.")
        issues: List[Dict[str, Any]] = []
        verdicts: List[Dict[str, Any]] = []
        summary = ""
        usage = {"input_tokens": 0, "output_tokens": 0, "cached_tokens": 0}
        for n, (a, z) in enumerate(spans, start=1):
            _stage(db, msg, f"Reading the document ({n} of {len(spans)})" if len(spans) > 1 else "Reading the document")
            part = B.listing(blocks[a:z + 1])
            part = re.sub(r"^\[B(\d+)\]", lambda m: f"[B{int(m.group(1)) + a}]", part, flags=re.M)
            for i in protected:
                part = re.sub(rf"^\[B{i + 1}\] ", f"[B{i + 1} read-only] ", part, count=1, flags=re.M)
            user = f"<document blocks=\"B{a + 1}..B{z + 1}\">\n{part}\n</document>"
            if reqs and whole:
                user += "\n\n<required_items>\n" + "\n".join(f"- {r}" for r in reqs) + "\n</required_items>"
            result = claude_client.complete(use_case="governance.studio_checks", system=prompts.CHECKS_SYSTEM,
                                            messages=[{"role": "user", "content": user}], schema=prompts.CHECKS_SCHEMA,
                                            max_tokens=24000, effort="medium",
                                            on_progress=counting(db, msg, f"Checking ({n} of {len(spans)})" if len(spans) > 1 else "Checking", "issues", "problems"))
            data = result.data
            summary = summary or str(data.get("summary") or "")
            verdicts += list(data.get("requirements") or [])
            for k in usage:
                usage[k] += result.usage.get({"input_tokens": "input_tokens", "output_tokens": "output_tokens", "cached_tokens": "cache_read_input_tokens"}[k], 0)
            for it in data.get("issues") or []:
                idx = B.index_of(str(it.get("block") or ""), len(blocks))
                if idx is None or idx < 0 or idx in protected:
                    continue
                quote = _find_quote(blocks[idx], str(it.get("quote") or "").strip())
                if quote is None:
                    continue
                suggestion = str(it.get("suggestion") or "").strip()
                issues.append({"id": f"ai:{len(issues) + 1}", "kind": it.get("kind") or "grammar", "rule": it.get("kind") or "grammar",
                               "severity": it.get("severity") or "warning", "block": idx, "quote": quote, "message": str(it.get("message") or "").strip(),
                               "suggestion": suggestion or None,
                               "fix": {"type": "replace", "block": idx, "find": quote, "replace": suggestion, "occurrence": 0} if suggestion else None})
        for v in verdicts:
            v["block"] = B.index_of(str(v.get("block") or ""), len(blocks))
        msg.content = summary or "The document was checked."
        msg.proposal = {"issues": issues, "requirements": verdicts, "summary": summary, "revision": session.revision_no}
        msg.notes, msg.usage = notes, usage
        msg.status, msg.stage, msg.error, msg.updated_at = "done", None, None, datetime.utcnow()
        db.commit()
    except Exception as exc:        # noqa: BLE001
        db.rollback()
        msg = db.get(StudioMessage, message_id)
        msg.status, msg.stage, msg.error, msg.updated_at = "error", None, friendly(exc), datetime.utcnow()
        db.commit()


# ── comparison ───────────────────────────────────────────────────────────────
def run_ai_compare(db, session_id: int, message_id: int, other_title: str, other_markdown: str) -> None:
    """Explain how the session's document and another one differ in substance. Result on the message."""
    from ....models import StudioMessage, StudioSession

    session, msg = db.get(StudioSession, session_id), db.get(StudioMessage, message_id)
    try:
        a, b = B.parse(session.content), B.parse(other_markdown)
        if not a or not b:
            raise TurnProblem("Both documents need some text to be compared.")
        if sum(len(x.source) for x in a) + sum(len(x.source) for x in b) > MAX_DOC_CHARS:
            raise TurnProblem("These documents are too large to compare in one go.")
        _stage(db, msg, "Reading both documents")
        user = (f"<document_a title=\"{session.title.replace(chr(34), chr(39))}\">\n{B.listing(a)}\n</document_a>\n\n"
                f"<document_b title=\"{other_title.replace(chr(34), chr(39))}\">\n{B.listing(b)}\n</document_b>")
        _stage(db, msg, "Comparing")
        result = claude_client.complete(use_case="governance.studio_compare", system=prompts.COMPARE_SYSTEM,
                                        messages=[{"role": "user", "content": user}], schema=prompts.COMPARE_SCHEMA, max_tokens=24000, effort="high",
                                        on_progress=counting(db, msg, "Comparing", "differences", "differences"))
        data = result.data
        msg.content = str(data.get("summary") or "")
        msg.proposal = {"summary": data.get("summary"), "differences": data.get("differences") or [], "recommendation": data.get("recommendation"),
                        "other_title": other_title, "stats": B.stats(b, a)}
        msg.usage = {"input_tokens": result.usage.get("input_tokens", 0), "output_tokens": result.usage.get("output_tokens", 0),
                     "cached_tokens": result.usage.get("cache_read_input_tokens", 0)}
        msg.status, msg.stage, msg.error, msg.updated_at = "done", None, None, datetime.utcnow()
        db.commit()
    except Exception as exc:        # noqa: BLE001
        db.rollback()
        msg = db.get(StudioMessage, message_id)
        msg.status, msg.stage, msg.error, msg.updated_at = "error", None, friendly(exc), datetime.utcnow()
        db.commit()
