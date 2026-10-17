"""The change chain of a governance document: who changed what, from what to what, and where each change came from.

A document passes through hands: it is written (often with the AI Studio), edited, reviewed, approved. Every save is a
version (``GovernanceDocumentVersion``). This module reads those versions as a chain a reviewer can follow:

* ``compare`` cuts the difference between two texts into *changes* (runs of changed blocks, split at headings), each with
  its section, its words before and after, and what it added and removed; ``revert`` takes chosen changes back out;
* ``attribute`` says where a change came from: a request the person made to the AI (with the sources the AI relied on and
  whether each quote was found in them), the person's own edit, a restored version, a sign-off stamp;
* ``chain`` lists the versions oldest to newest with their changes and, between them, the approvals that happened
  (sent for review, signed, rejected, published), so the next person sees what each person changed and what stage it was in;
* ``catalog`` flattens that into tables for the Excel / PDF / CSV export (``change_chain_export.py``).

Nothing here is stored twice. A version written by the AI Studio or by a revert carries a ``change_set`` (its changes with
their origin, because the AI's part is not recoverable from two texts); every other version is compared with the one
before it when the chain is read. Reading never writes.
"""
from __future__ import annotations

import hashlib
import logging
import os
import re
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Dict, Iterable, List, Optional, Sequence, Set, Tuple

from .studio import blocks as B

logger = logging.getLogger(__name__)

SPLIT_LEVEL = 3                  # a run of changed blocks is split before a heading of this level or a higher one
TEXT_CAP = 4_000                 # characters of one side of a change kept in a stored change set and sent in the chain
SOURCE_QUOTE_CAP = 400
LOCKED = re.compile(r"approval\s*sign-?\s*off", re.I)     # the sign-off table is stamped by the sign-off flow, not edited by hand
_FILE_TEXT_CACHE: Dict[Tuple[int, Optional[int], str], Optional[str]] = {}

STAGE_LABEL = {"draft": "Draft", "pending_review": "In review", "pending_approval": "In approval", "approved": "Approved",
               "published": "Published", "expired": "Expired", "archived": "Archived", "exception_applied": "Exception applied"}
ORIGIN_LABEL = {"ai": "Comply Agent", "manual": "Edited by hand", "mixed": "Comply Agent and edited by hand", "revert": "Taken back",
                "restore": "Earlier version restored", "signoff": "Sign-off stamp", "initial": "The original", "file": "File replaced",
                "import": "Imported", "unknown": "Changed", "nochange": "No change to the text"}
# audit entries that matter to the chain (the rest - views, downloads, field edits - do not)
_EVENT_ACTIONS = {"created", "sent_for_review", "sent_for_approval", "signed", "rejected", "published", "archived", "status_changed",
                  "review_completed", "version_rollback"}


# ── cutting a difference into changes ────────────────────────────────────────
def section_paths(blocks: Sequence[B.Block]) -> List[str]:
    """For every block, where it sits: "7. Policy Statements › 7.2 Joiners, movers and leavers" (the headings above it, the
    document's own title left out)."""
    stack: List[Tuple[int, str]] = []
    out: List[str] = []
    for b in blocks:
        if b.kind == "heading" and b.level > 1:
            while stack and stack[-1][0] >= b.level:
                stack.pop()
            stack.append((b.level, re.sub(r"\s+", " ", b.text).strip()))
        out.append(" › ".join(t for _, t in stack if t))
    return out


@dataclass
class _Run:
    id: int
    pairs: List[B.Pair]
    base: Optional[Tuple[int, int]]          # first and last block of the older text in this change
    cur: Optional[Tuple[int, int]]           # ... and of the newer text
    insert_at: int                            # in the newer text: where a removed run stood


def _runs(base: Sequence[B.Block], cur: Sequence[B.Block], pairs: List[B.Pair]) -> Tuple[List[_Run], List[Optional[int]]]:
    """The changes: a block that was reworded is a change of its own (from this, to that); consecutive blocks that were added or
    removed are one change, and a change never runs across a heading. Also, for every pair, the change it is in (None when unchanged)."""
    runs: List[_Run] = []
    pair_run: List[Optional[int]] = []
    group: List[B.Pair] = []
    last_cur, start_after = -1, -1

    def flush() -> None:
        nonlocal group
        if group:
            bs = [p.base for p in group if p.base is not None]
            cs = [p.cur for p in group if p.cur is not None]
            runs.append(_Run(len(runs), group, (bs[0], bs[-1]) if bs else None, (cs[0], cs[-1]) if cs else None, start_after + 1))
            group = []

    for p in pairs:
        if p.status == "equal":
            flush()
            last_cur = p.cur if p.cur is not None else last_cur
            pair_run.append(None)
            continue
        ref = cur[p.cur] if p.cur is not None else base[p.base]
        if group and (p.status == "modified" or group[-1].status == "modified" or (ref.kind == "heading" and ref.level <= SPLIT_LEVEL)):
            flush()
        if not group:
            start_after = last_cur
        group.append(p)
        pair_run.append(len(runs))                  # the run being built gets the id it will be given by flush()
        if p.cur is not None:
            last_cur = p.cur
    flush()
    return runs, pair_run


def _words_of(text: str) -> int:
    return len(re.findall(r"\w+", text or ""))


def _plain(block: B.Block) -> str:
    """A block as words a reader can compare: a table is its rows, one per line, cells separated by " | "."""
    if block.kind == "table" and block.rows:
        return "\n".join(" | ".join(c.text for c in row) for row in block.rows)
    return block.text


def _hunk(base: Sequence[B.Block], cur: Sequence[B.Block], run: _Run, paths_base: Sequence[str], paths_cur: Sequence[str]) -> Dict[str, Any]:
    added = removed = 0
    for p in run.pairs:
        if p.status == "inserted":
            added += cur[p.cur].words
        elif p.status == "deleted":
            removed += base[p.base].words
        else:
            for op, text in B.word_diff(base[p.base].text, cur[p.cur].text):
                n = _words_of(text)
                added += n if op == "insert" else 0
                removed += n if op == "delete" else 0
    bs = [base[p.base] for p in run.pairs if p.base is not None]
    cs = [cur[p.cur] for p in run.pairs if p.cur is not None]
    first = run.pairs[0]
    section = paths_cur[first.cur] if first.cur is not None else paths_base[first.base]
    if all(p.status == "inserted" for p in run.pairs):
        status = "inserted"
    elif all(p.status == "deleted" for p in run.pairs):
        status = "deleted"
    else:
        status = "modified"
    return {"id": run.id, "status": status, "section": section, "locked": bool(LOCKED.search(section)),
            "blocks": len(run.pairs), "words_added": added, "words_removed": removed,
            "format_only": all(p.format_only for p in run.pairs),
            # how the outline changed ("Heading 2 → Heading 3", "List level 1 → 2"): what a change shows when its words did not change
            "structure": [x for p in run.pairs if p.base is not None and p.cur is not None for x in B.structure(base[p.base], cur[p.cur])],
            "before_text": "\n".join(_plain(b) for b in bs), "after_text": "\n".join(_plain(b) for b in cs),
            "before_digests": [b.digest for b in bs], "after_digests": [b.digest for b in cs]}


def content_hash(markdown: str) -> str:
    """A fingerprint of a text as the studio sees it (blocks, not stray white space): a screen that asks to change a document
    sends it back, so a change made meanwhile is noticed."""
    return hashlib.sha1(B.render(B.parse(markdown)).strip().encode("utf-8")).hexdigest()[:16]


def compare(base_md: str, cur_md: str) -> Dict[str, Any]:
    """What changed from ``base_md`` to ``cur_md``: the redline rows (each carrying the id of its change), the changes, the counts."""
    base, cur = B.parse(base_md), B.parse(cur_md)
    pairs = B.align(base, cur)
    runs, pair_run = _runs(base, cur, pairs)
    rows = B.redline(base, cur, pairs)
    for row, k in zip(rows, pair_run):
        row["hunk"] = k
    paths_base, paths_cur = section_paths(base), section_paths(cur)
    hunks = [_hunk(base, cur, r, paths_base, paths_cur) for r in runs]
    stats = {"inserted": sum(p.status == "inserted" for p in pairs), "deleted": sum(p.status == "deleted" for p in pairs),
             "modified": sum(p.status == "modified" for p in pairs),
             "words_added": sum(h["words_added"] for h in hunks), "words_removed": sum(h["words_removed"] for h in hunks)}
    return {"rows": rows, "hunks": hunks, "stats": stats, "hash": content_hash(cur_md)}


def hunks_of(base_md: str, cur_md: str) -> List[Dict[str, Any]]:
    base, cur = B.parse(base_md), B.parse(cur_md)
    pairs = B.align(base, cur)
    runs, _ = _runs(base, cur, pairs)
    paths_base, paths_cur = section_paths(base), section_paths(cur)
    return [_hunk(base, cur, r, paths_base, paths_cur) for r in runs]


def revert(base_md: str, cur_md: str, hunk_ids: Iterable[int]) -> str:
    """``cur_md`` with the chosen changes taken back to what ``base_md`` had. Everything else stays as it is now."""
    wanted = set(hunk_ids)
    base, cur = B.parse(base_md), B.parse(cur_md)
    pairs = B.align(base, cur)
    _, pair_run = _runs(base, cur, pairs)
    if not wanted or not wanted <= {k for k in pair_run if k is not None}:
        raise ValueError("That change is no longer in the document.")
    out: List[B.Block] = []
    for p, k in zip(pairs, pair_run):
        if k in wanted:
            if p.base is not None:
                out.append(base[p.base])
        elif p.cur is not None:
            out.append(cur[p.cur])
    return B.render(out)


# ── where a change came from ─────────────────────────────────────────────────
def make_origin(kind: str, *, by: str = "", by_id: Optional[int] = None, at: Optional[str] = None, version: Optional[str] = None,
                request: str = "", reason: str = "", sources: Optional[List[Dict[str, Any]]] = None,
                after: Iterable[str] = (), before: Iterable[str] = (), ref: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """One thing that changed the document: what it produced (``after``, block digests) and what it removed (``before``)."""
    return {"kind": kind, "by": by, "by_id": by_id, "at": at, "version": version, "request": request, "reason": reason,
            "sources": sources or [], "after": set(after), "before": set(before), "ref": ref or {}}


def attribute(hunk: Dict[str, Any], origins: Sequence[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """The latest origin that produced the blocks of this change (or, for a removal, removed them): who, when, on whose request
    and from which sources. ``coverage`` is the share of the new blocks it produced; below 1 the text was edited afterwards."""
    after, before = set(hunk.get("after_digests") or []), set(hunk.get("before_digests") or [])
    best: Optional[Tuple[Dict[str, Any], float]] = None
    for o in origins:                                    # oldest first: a later origin takes over
        if after and o["after"] & after:
            best = (o, len(o["after"] & after) / len(after))
        elif not after and before and o["before"] & before:
            best = (o, 1.0)
    if best is None:
        return None
    o, share = best
    return {"origin": o["kind"], "by": o["by"], "by_id": o["by_id"], "at": o["at"], "version": o["version"], "request": o["request"],
            "reason": o["reason"], "sources": o["sources"], "ref": o["ref"], "coverage": round(share, 2)}


# ── the text of a version ────────────────────────────────────────────────────
def version_text(version) -> Optional[str]:
    """The Markdown of a version: its content, else the text of its file (kept after the first read). None when neither exists."""
    if (version.content or "").strip():
        return version.content
    path = version.file_path
    if not path or not os.path.exists(path):
        return None
    key = (version.id, version.file_size, path)
    if key not in _FILE_TEXT_CACHE:
        try:
            from .studio.importers import import_file

            _FILE_TEXT_CACHE[key] = import_file(path, version.file_name or path).markdown
        except Exception:       # noqa: BLE001 - a file that cannot be read is a version without a comparison, not a failed page
            logger.warning("the text of version %s could not be read for the change chain", version.id, exc_info=True)
            _FILE_TEXT_CACHE[key] = None
        if len(_FILE_TEXT_CACHE) > 64:
            _FILE_TEXT_CACHE.pop(next(iter(_FILE_TEXT_CACHE)))
    return _FILE_TEXT_CACHE[key]


def document_text(doc) -> Optional[str]:
    if (doc.content or "").strip():
        return doc.content
    path = doc.file_path
    if path and os.path.exists(path):
        class _V:       # a document's own file read like a version's
            id, content, file_path, file_name, file_size = -(doc.id or 0), None, path, doc.file_name, doc.file_size
        return version_text(_V)
    return None


# ── what stage the document was in ───────────────────────────────────────────
def _status_after(row) -> Optional[str]:
    if row.field_changed == "status" and row.new_value:
        return row.new_value
    if row.action == "signed":
        m = re.search(r"(?:→|->)\s*(pending_approval|approved|pending_review|published)", row.action_details or "")
        return m.group(1) if m else None
    return None


def _status_history(rows: Sequence[Any]) -> List[Tuple[datetime, str]]:
    out: List[Tuple[datetime, str]] = []
    for r in rows:
        s = _status_after(r)
        if s and r.performed_at:
            out.append((r.performed_at, s))
    return out


def _stage_at(history: Sequence[Tuple[datetime, str]], when: Optional[datetime], *, before: bool = False) -> str:
    """The stage at ``when``. ``before``: just before it - for a version, whose save writes the status change it causes in the
    same clock tick on Windows (~15 ms steps, PITFALLS 73), so an equal time is the version's own consequence, not its stage."""
    stage = "draft"
    for at, s in history:
        if when is not None and (at >= when if before else at > when):
            break
        stage = s
    return stage


# ── the chain of a library document ──────────────────────────────────────────
def _iso(dt) -> Optional[str]:
    return dt.isoformat() if dt else None


def _cap(text: str, limit: int = TEXT_CAP) -> Tuple[str, bool]:
    return (text, False) if len(text or "") <= limit else (text[:limit].rstrip() + " …", True)


def public_item(hunk: Dict[str, Any], origin: Optional[Dict[str, Any]], *, default_kind: str, by: str, by_id: Optional[int], at: Optional[str]) -> Dict[str, Any]:
    """One change as it is stored on a version and sent to the page: the texts are cut, the origin is filled in."""
    before, cut_a = _cap(hunk["before_text"])
    after, cut_b = _cap(hunk["after_text"])
    o = origin or {}
    return {"status": hunk["status"], "section": hunk["section"], "locked": hunk["locked"], "blocks": hunk["blocks"],
            "words_added": hunk["words_added"], "words_removed": hunk["words_removed"], "format_only": hunk["format_only"],
            "structure": hunk.get("structure") or [], "before_text": before, "after_text": after, "truncated": cut_a or cut_b,
            "before_digests": hunk["before_digests"], "after_digests": hunk["after_digests"],
            "origin": o.get("origin") or default_kind, "by": o.get("by") or by, "by_id": o.get("by_id") if o.get("by_id") is not None else by_id,
            "at": o.get("at") or at, "request": o.get("request") or "", "reason": o.get("reason") or "", "sources": o.get("sources") or [],
            "ref": o.get("ref") or {}, "coverage": o.get("coverage", 1.0)}


def build_change_set(old_text: str, new_text: str, origins: Sequence[Dict[str, Any]], *, default_kind: str, by: str, by_id: Optional[int],
                     at: Optional[str], extra: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """What a version changed against the one before it, with each change's origin: what is kept on the version."""
    items = []
    for h in hunks_of(old_text or "", new_text or ""):
        items.append(public_item(h, attribute(h, origins), default_kind=default_kind, by=by, by_id=by_id, at=at))
    for n, it in enumerate(items, start=1):
        it["n"] = n
    sources: Dict[Tuple[str, str, str], Dict[str, Any]] = {}
    for it in items:
        for s in it["sources"]:
            sources.setdefault((str(s.get("title")), str(s.get("locator")), str(s.get("quote"))[:60]), s)
    return {"v": 1, "at": at, "by": by, "by_id": by_id, "items": items, "sources": list(sources.values()),
            "words_added": sum(i["words_added"] for i in items), "words_removed": sum(i["words_removed"] for i in items), **(extra or {})}


def _default_kind(version) -> str:
    kind = (version.change_type or "").lower()
    summary = (version.change_summary or "").lower()
    if kind == "signoff":
        return "signoff"
    if summary.startswith("rollback to") or "restored" in summary[:20]:
        return "restore"
    if kind == "baseline":
        return "initial"
    return "manual"


_RESTORED = re.compile(r"rollback (?:from version \S+ )?to version (\d+(?:\.\d+)*)", re.I)


def _restored_from(version) -> Optional[str]:
    """The version a restore went back to ("Rollback to version 1.0" in its summary). None for any other version."""
    m = _RESTORED.search(version.change_summary or "") or _RESTORED.search(version.change_reason or "")
    return m.group(1) if m else None


def _origin_of(items: Sequence[Dict[str, Any]], fallback: str) -> str:
    kinds = {i["origin"] for i in items}
    if not kinds:
        return fallback
    if kinds == {"ai"}:
        return "ai"
    if "ai" in kinds and len(kinds) > 1:
        return "mixed"
    return next(iter(kinds)) if len(kinds) == 1 else "mixed"


def _names(db, ids: Iterable[Optional[int]]) -> Dict[int, str]:
    from ...models import GRCUser

    wanted = {i for i in ids if i}
    if not wanted:
        return {}
    return {u.id: (u.display_name or u.username or f"User {u.id}") for u in db.query(GRCUser).filter(GRCUser.id.in_(wanted)).all()}


def chain(db, doc, upto=None) -> Dict[str, Any]:
    """The document's versions oldest to newest with what each changed, and the approvals between them. Reads only. ``upto``: the
    version row in force, for someone who reads that one - the chain ends there."""
    from ...models import DocumentAuditLog, GovernanceDocumentVersion
    from .permissions import in_force_number

    query = db.query(GovernanceDocumentVersion).filter(GovernanceDocumentVersion.document_id == doc.id)
    if upto is not None:
        query = query.filter(GovernanceDocumentVersion.id <= upto.id)
    versions = query.order_by(GovernanceDocumentVersion.created_at.asc(), GovernanceDocumentVersion.id.asc()).all()
    audit = (db.query(DocumentAuditLog).filter(DocumentAuditLog.document_id == doc.id)
             .order_by(DocumentAuditLog.performed_at.asc(), DocumentAuditLog.id.asc()).all())
    names = _names(db, [v.created_by for v in versions] + [v.approved_by for v in versions] + [a.performed_by for a in audit]
                   + [doc.owner_id, doc.author_id, doc.approved_by])
    history = _status_history(audit)
    out_versions: List[Dict[str, Any]] = []
    previous = None
    for v in versions:
        by = names.get(v.created_by) or "Unknown"
        at = _iso(v.created_at)
        stored = v.change_set if isinstance(v.change_set, dict) else None
        comparable = True
        if stored is not None and isinstance(stored.get("items"), list):
            items = [dict(i) for i in stored["items"]]
            origin = stored.get("origin") or _origin_of(items, "unknown")
            sources = stored.get("sources") or []
        elif previous is None or (v.change_type or "") == "baseline":
            items, origin, sources = [], "initial", []
        else:
            old, new = version_text(previous), version_text(v)
            if old is None or new is None:
                items, origin, sources, comparable = [], "file", [], False
            else:
                kind = _default_kind(v)
                items = [public_item(h, None, default_kind=kind, by=by, by_id=v.created_by, at=at) for h in hunks_of(old, new)]
                for n, it in enumerate(items, start=1):
                    it["n"] = n
                origin, sources = (kind if items or kind != "manual" else "nochange"), []
        for it in items:
            it.setdefault("origin", "unknown")
        out_versions.append({
            "id": v.id, "number": v.version_number, "kind": v.change_type, "status": v.status, "at": at, "by": by, "by_id": v.created_by,
            "stage": _stage_at(history, v.created_at, before=True), "origin": origin, "origin_label": ORIGIN_LABEL.get(origin, ORIGIN_LABEL["unknown"]),
            "summary": v.change_summary or "", "reason": v.change_reason or "", "comparable": comparable,
            "has_file": bool(v.file_path), "file_name": v.file_name or "", "title": v.title, "items": items, "sources": sources,
            "words_added": sum(i["words_added"] for i in items), "words_removed": sum(i["words_removed"] for i in items),
            "changes": len(items), "approved_by": names.get(v.approved_by), "approved_at": _iso(v.approved_at),
            "session_id": (stored or {}).get("session_id"),
            "reverts": (stored or {}).get("reverts"), "restored_from": _restored_from(v),
        })
        previous = v
    for item in out_versions:
        item["stage_label"] = STAGE_LABEL.get(item["stage"], item["stage"])
    events = []
    for a in audit:
        if a.action not in _EVENT_ACTIONS:
            continue
        events.append({"at": _iso(a.performed_at), "kind": a.action, "actor": names.get(a.performed_by), "actor_id": a.performed_by,
                       "detail": a.action_details or "", "from": a.old_value if a.field_changed == "status" else None,
                       "to": _status_after(a), "stage": _stage_at(history, a.performed_at)})
    all_sources: Dict[Tuple[str, str, str], Dict[str, Any]] = {}
    for v in out_versions:
        for it in v["items"]:
            for s in it.get("sources") or []:
                key = (str(s.get("title")), str(s.get("locator")), str(s.get("quote"))[:60])
                row = all_sources.setdefault(key, {**s, "versions": []})
                if v["number"] not in row["versions"]:
                    row["versions"].append(v["number"])
    people = {v["by"] for v in out_versions if v["by"]} | {e["actor"] for e in events if e["actor"]}
    return {
        "enabled": True,
        "document": {"id": doc.id, "title": doc.title, "code": doc.document_code, "status": doc.status, "in_force": in_force_number(doc),
                     "version": upto.version_number if upto is not None else doc.current_version,
                     "stage_label": STAGE_LABEL.get(doc.status, doc.status), "owner": names.get(doc.owner_id), "author": names.get(doc.author_id),
                     "approved_by": names.get(doc.approved_by), "approved_at": _iso(doc.approved_at), "doc_type": doc.doc_type,
                     "is_file": bool(doc.file_path) and not (doc.content or "").strip(), "file_type": doc.file_type},
        "versions": out_versions, "events": events, "sources": list(all_sources.values()),
        "summary": {"versions": len(out_versions), "changes": sum(v["changes"] for v in out_versions), "people": len(people),
                    "ai_assisted": sum(1 for v in out_versions for i in v["items"] if i.get("origin") in ("ai",)),
                    "sources": len(all_sources),
                    "words_added": sum(v["words_added"] for v in out_versions), "words_removed": sum(v["words_removed"] for v in out_versions)},
    }


def baseline_options(db, doc) -> List[Dict[str, Any]]:
    """The versions a reader can compare the document against, newest first."""
    from ...models import GovernanceDocumentVersion

    rows = (db.query(GovernanceDocumentVersion).filter(GovernanceDocumentVersion.document_id == doc.id)
            .order_by(GovernanceDocumentVersion.created_at.desc(), GovernanceDocumentVersion.id.desc()).all())
    names = _names(db, [v.created_by for v in rows])
    return [{"id": v.id, "number": v.version_number, "at": _iso(v.created_at), "by": names.get(v.created_by), "status": v.status,
             "kind": v.change_type, "summary": v.change_summary or "", "approved_at": _iso(v.approved_at)} for v in rows]


def redline(db, doc, from_version_id: int, to_version_id: Optional[int] = None) -> Dict[str, Any]:
    """The document as it changed from one version to another (the current text when ``to_version_id`` is None), with every change
    attributed through the versions in between, and whether the changes can be taken back here."""
    from ...models import GovernanceDocumentVersion

    base_v = db.query(GovernanceDocumentVersion).filter(GovernanceDocumentVersion.id == from_version_id,
                                                        GovernanceDocumentVersion.document_id == doc.id).first()
    if base_v is None:
        raise LookupError("That version was not found for this document.")
    base_text = version_text(base_v)
    to_v = None
    if to_version_id:
        to_v = db.query(GovernanceDocumentVersion).filter(GovernanceDocumentVersion.id == to_version_id,
                                                          GovernanceDocumentVersion.document_id == doc.id).first()
        if to_v is None:
            raise LookupError("That version was not found for this document.")
        cur_text = version_text(to_v)
    else:
        cur_text = document_text(doc)
    if base_text is None or cur_text is None:
        raise ValueError("The text of one of these versions cannot be read, so they cannot be compared here.")
    result = compare(base_text, cur_text)
    # who made each change: the versions after the one compared with, oldest first
    c = chain(db, doc)
    origins: List[Dict[str, Any]] = []
    started = False
    for v in c["versions"]:
        if v["id"] == from_version_id:
            started = True
            continue
        if not started:
            continue
        for it in v["items"]:
            origins.append(make_origin(it.get("origin") or "manual", by=it.get("by") or v["by"], by_id=it.get("by_id"), at=it.get("at") or v["at"],
                                       version=v["number"], request=it.get("request") or "", reason=it.get("reason") or v["reason"] or v["summary"],
                                       sources=it.get("sources"), after=it.get("after_digests") or [], before=it.get("before_digests") or [],
                                       ref=it.get("ref")))
        if to_version_id and v["id"] == to_version_id:
            break
    for h in result["hunks"]:
        h["by"] = attribute(h, origins)
    now_text = document_text(doc)            # the document as it is now: its text, or the text of its file (an uploaded Word or PDF)
    editable = now_text is not None
    current_hash = result["hash"]
    if to_v is not None and editable:
        # the changes of one version are taken back from the document as it is now: each is found there again by its words
        # (a change edited by a later version is no longer the same change and cannot be taken back on its own)
        now = compare(base_text, now_text)
        current_hash = now["hash"]
        found = {(tuple(h["before_digests"]), tuple(h["after_digests"])): h["id"] for h in now["hunks"]}
        for h in result["hunks"]:
            h["current_id"] = found.get((tuple(h["before_digests"]), tuple(h["after_digests"])))
            h["can_revert"] = h["current_id"] is not None and not h["locked"]
    else:
        for h in result["hunks"]:
            h["current_id"] = h["id"]
            h["can_revert"] = editable and not h["locked"]
    if not editable:
        why = "The text of this document's file cannot be read, so a change cannot be taken back here."
    elif to_v is not None:
        why = "This change was changed again by a later version, so it cannot be taken back on its own. Compare with the current document instead."
    else:
        why = None
    return {"enabled": True, "from": {"id": base_v.id, "number": base_v.version_number}, "to": {"id": to_v.id, "number": to_v.version_number} if to_v else None,
            "rows": result["rows"], "hunks": result["hunks"], "stats": result["stats"], "hash": result["hash"], "current_hash": current_hash,
            "can_revert": editable, "why_not": why}


# ── tables for the export ────────────────────────────────────────────────────
def _clock(iso: Optional[str]) -> str:
    return (iso or "").replace("T", " ")[:16]


def catalog(c: Dict[str, Any]) -> Dict[str, List[List[Any]]]:
    """The chain as flat rows: versions, changes, sources and approvals."""
    versions = [[v["number"], _clock(v["at"]), v["by"], v["stage_label"], v["origin_label"], v["changes"], v["words_added"], v["words_removed"],
                 v["summary"] or v["reason"], v["status"] or "", v["approved_by"] or "", _clock(v["approved_at"]), v.get("file_name") or ""] for v in c["versions"]]
    changes: List[List[Any]] = []
    for v in c["versions"]:
        for it in v["items"]:
            sources = "; ".join(f"{s.get('title') or s.get('ref')}" + (f" · {s['locator']}" if s.get("locator") else "") for s in it.get("sources") or [])
            changes.append([f"{v['number']}.{it.get('n', '')}", v["number"], _clock(it.get("at") or v["at"]), it.get("by") or v["by"], v["stage_label"],
                            it.get("section") or "", {"inserted": "Added", "deleted": "Removed", "modified": "Changed"}.get(it["status"], it["status"]),
                            it.get("before_text") or "", it.get("after_text") or "", it.get("words_added", 0), it.get("words_removed", 0),
                            ORIGIN_LABEL.get(it.get("origin"), "Changed"), it.get("request") or "", it.get("reason") or "", sources,
                            "yes" if any(s.get("verified") for s in it.get("sources") or []) else ""])
    sources = [[s.get("title") or s.get("ref") or "", s.get("kind") or "", s.get("locator") or "", s.get("quote") or "",
                "found" if s.get("verified") else ("not found" if s.get("verified") is False else ""), ", ".join(str(n) for n in s.get("versions", []))]
               for s in c["sources"]]
    approvals = [[_clock(e["at"]), {"created": "Created", "sent_for_review": "Sent for review", "sent_for_approval": "Sent for approval", "signed": "Signed",
                                     "rejected": "Rejected", "published": "Published", "archived": "Archived", "status_changed": "Status changed",
                                     "review_completed": "Review completed", "version_rollback": "Earlier version restored"}.get(e["kind"], e["kind"]),
                  e["actor"] or "", e["detail"] or ""] for e in c["events"]]
    return {"versions": versions, "changes": changes, "sources": sources, "approvals": approvals}


CATALOG_HEADERS = {
    "versions": ["Version", "Date", "Changed by", "Stage", "How", "Changes", "Words added", "Words removed", "Summary", "Status", "Approved by", "Approved on", "File"],
    "changes": ["Ref", "Version", "Date", "Changed by", "Stage", "Section", "Change", "From", "To", "Words added", "Words removed", "How",
                "Request", "Reason", "Sources", "Quote found"],
    "sources": ["Source", "Kind", "Where in it", "Quoted words", "Check", "Versions"],
    "approvals": ["Date", "Event", "By", "Detail"],
}
