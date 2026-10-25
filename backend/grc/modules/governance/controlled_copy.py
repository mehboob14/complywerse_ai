"""A platform-written document as a controlled copy: its text with the document control pages in the places a document keeps them (the
user, 2026-10-25: the sections for the document's description, its reviews and approvals and its revisions are part of the document,
kept by the platform from the workflow - not a card under it, not an appendix).

``segments`` splits the Markdown of a document into its own text and the places for those sections: where the document has a section of
its own under a heading that says what it is (Document Description, Approval Signoff, Revision History, and what the standard
templates and banks call them), the section's body is replaced by a place for the platform's (the heading stays, so the document's
numbering does); a section the document does not have gets one, with a title, at the top, after the title and the lines under it.
The screens draw a place from the approval record (approval_record.py); ``pdf`` puts the PDF together: the text as it always is
(routers/_artifact_export.py) in pieces, the control pages (approval_record_export.py) where the places are.

Nothing here reads or writes the database, and the stored text is never changed.
"""
from __future__ import annotations

import re
from typing import Any, Dict, Iterable, List, Mapping, Optional, Tuple

from . import approval_record_export as X
from .studio.templates import _ALIASES, key_of

SLOTS = X.SLOTS                                                  # description, signoff, revision: the order the group at the top is in
# what a heading says that stands for each place: the standard templates' key and its aliases (studio/templates.py), and more of what
# banks call the section
_NAMES = {
    "description": ("document description", ()),
    "signoff": ("approval signoff", ("approval sign off", "approvals sign-off", "approvals sign off", "approvals signoff", "approval and sign-off",
                                     "approvals and sign-off", "approval and signoff", "approvals and signoff", "review and approval",
                                     "review and approvals", "recommendation and review")),
    "revision": ("revision history", ()),
}
_ATX = re.compile(r"^ {0,3}(#{1,6})[ \t]+(.*?)[ \t]*$")
_CLOSING = re.compile(r"[ \t]+#+$")
_FENCE = re.compile(r"^ {0,3}(`{3,}|~{3,})")


def _slot_of() -> Dict[str, str]:
    return {key: slot for slot, (base, more) in _NAMES.items() for key in (base, *_ALIASES.get(base, ()), *more)}


def _plain(title: str) -> str:
    """A heading's words without the Markdown around them (emphasis, code, closing hashes)."""
    return re.sub(r"[*_`]+", "", _CLOSING.sub("", title)).strip()


def headings(lines: List[str]) -> List[Tuple[int, int, str]]:
    """(line, level, words) of the ATX headings of a document, none of them inside a fenced block of code."""
    out: List[Tuple[int, int, str]] = []
    fence: Optional[Tuple[str, int]] = None
    for i, line in enumerate(lines):
        m = _FENCE.match(line)
        if m:
            mark = m.group(1)
            if fence is None:
                fence = (mark[0], len(mark))
            elif mark[0] == fence[0] and len(mark) >= fence[1] and not line.strip().strip(mark[0]):        # a closing fence has nothing after it
                fence = None
            continue
        if fence is None:
            h = _ATX.match(line)
            if h:
                out.append((i, len(h.group(1)), h.group(2)))
    return out


def _first_paragraph_end(lines: List[str], title: int) -> int:
    """The line after the first paragraph (lines up to a blank one) under the title at line ``title``: where the places go in a document
    that has no heading after its title, so they do not fall at the end of all its text."""
    i = title + 1
    while i < len(lines) and not lines[i].strip():
        i += 1
    while i < len(lines) and lines[i].strip():
        i += 1
    return i


def segments(markdown: str, *, have: Iterable[str] = SLOTS) -> List[Dict[str, Any]]:
    """The document as ``[{"type": "markdown", "text"}, {"type": "slot", "slot": "description" | "signoff" | "revision", "heading": bool}]``.

    The first heading of each kind - found by its words (``key_of``: numbers and "Annex A" taken off, case ignored) among the
    section names above - keeps its line; its body, up to the next heading of any level, is the place (``heading`` False: the
    document has the heading). A kind with no heading of its own is a place with ``heading`` True, in the order description, sign-off,
    revision, after the first level-1 heading and the lines under it, up to the next heading (the first paragraph, when none follows;
    the top of the document when it has no level-1 heading). ``have``: the kinds the platform provides; a document's section of
    another kind stays as it is. The texts joined are the document, less the replaced bodies; a text with nothing in it is not a
    segment."""
    text = (markdown or "").replace("\r\n", "\n").replace("\r", "\n")
    want = {s for s in have if s in SLOTS}
    lines = text.split("\n")
    if text.endswith("\n"):
        lines.pop()                                                         # the empty piece after the last newline is not a line
    heads = headings(lines)
    names = _slot_of()
    found: Dict[str, int] = {}
    for n, (_line, _level, words) in enumerate(heads):
        slot = names.get(key_of(_plain(words)))
        if slot in want and slot not in found:
            found[slot] = n
    events: List[Tuple[int, int, Any]] = []                                 # (line it happens at, replaced body before group at a line, what)
    for slot, n in found.items():
        end = heads[n + 1][0] if n + 1 < len(heads) else len(lines)
        events.append((heads[n][0] + 1, 0, (slot, end)))
    missing = [s for s in SLOTS if s in want and s not in found]
    if missing:
        h1 = next((n for n, (_i, level, _w) in enumerate(heads) if level == 1), None)
        events.append((0 if h1 is None else heads[h1 + 1][0] if h1 + 1 < len(heads) else _first_paragraph_end(lines, heads[h1][0]), 1, missing))
    out: List[Dict[str, Any]] = []

    def add_text(chunk: List[str], last: bool = False) -> None:
        body = "\n".join(chunk) + ("\n" if not last or text.endswith("\n") else "")
        if not body.strip():
            return
        if out and out[-1]["type"] == "markdown":
            out[-1]["text"] += body
        else:
            out.append({"type": "markdown", "text": body})

    at = 0
    for line, _order, what in sorted(events, key=lambda e: e[:2]):
        add_text(lines[at:line])
        at = max(at, line)
        if isinstance(what, list):
            out += [{"type": "slot", "slot": s, "heading": True} for s in what]
        else:
            out.append({"type": "slot", "slot": what[0], "heading": False})
            at = what[1]
    add_text(lines[at:], last=True)
    return out


def _heading_of(chunk: str) -> Tuple[str, Optional[str]]:
    """A text that ends with a heading line, as (the text without it, its words); the text itself when it does not."""
    lines = chunk.rstrip("\n").split("\n")
    m = _ATX.match(lines[-1])
    return ("\n".join(lines[:-1]), _plain(m.group(2))) if m else (chunk, None)


def pdf(markdown: str, record: Mapping[str, Any], images: Optional[Mapping[int, bytes]], *, title: str) -> bytes:
    """The document's PDF with its control pages where the places are: each piece of the text is rendered as a document's PDF always
    is (``_artifact_export.build_export``; the first with the document's title), each place as control pages (the heading the
    document has over a place goes with its pages, so it is not left at the foot of the page before), and the parts are put
    together page by page. The pages count themselves ("Document control page X of Y": only these pages)."""
    import fitz

    from ...routers._artifact_export import build_export

    plan: List[List[Any]] = []                                  # ["md", text] | ["slot", slot, heading words or None]
    for seg in segments(markdown):
        if seg["type"] == "markdown":
            plan.append(["md", seg["text"]])
            continue
        words = X.SLOT_TITLE[seg["slot"]] if seg["heading"] else None
        if not seg["heading"] and plan and plan[-1][0] == "md":
            plan[-1][1], words = _heading_of(plan[-1][1])
            if not plan[-1][1].strip():
                plan.pop()
        plan.append(["slot", seg["slot"], words])
    slots = [i for i, item in enumerate(plan) if item[0] == "slot"]

    def control(i: int, first: int = 1, of: Optional[int] = None) -> bytes:
        _kind, slot, words = plan[i]
        lead = title if i == 0 else None                        # no title above them: theirs is the document's first line
        return X.to_pdf(record, images, slots=(slot,), titles={slot: words}, first=first, of=of, lead=lead, notes=i == slots[-1])

    made = {i: control(i) for i in slots}
    if len(slots) > 1:                                          # more than one part: count them together, then number them
        counts = {i: _pages(made[i]) for i in slots}
        total, before = sum(counts.values()), 0
        for i in slots:
            made[i] = control(i, first=before + 1, of=total)
            before += counts[i]
    out = fitz.open()
    try:
        for i, item in enumerate(plan):
            if item[0] == "md":
                data, _media, _ext = build_export("pdf", title=title if i == 0 else "", content=item[1])
            else:
                data = made[i]
            with fitz.open(stream=data, filetype="pdf") as part:
                out.insert_pdf(part)
        out.set_metadata({"title": title or "", "producer": "", "creator": ""})
        return out.tobytes(deflate=True)
    finally:
        out.close()


def _pages(data: bytes) -> int:
    import fitz

    with fitz.open(stream=data, filetype="pdf") as part:
        return part.page_count
