"""A document as editable blocks.

The studio keeps a document as Markdown (the platform's own format: the viewer, versions, statements and gap analysis all
read it). To edit it with an AI, to show what changed and to patch a Word file, the Markdown is cut into *blocks*: a
heading, a paragraph, one list item, a table, a quote, a code block, a rule, or a line the parser has no block for (kept
as ``raw`` so nothing is ever lost). Each block keeps its exact Markdown ``source``, so untouched text is never rewritten.

* ``parse`` / ``render``: Markdown <-> blocks (blocks are separated by a blank line; consecutive list items by a line).
* ``align``: pairs the blocks of two versions (equal, modified, inserted, deleted) the way a reader would.
* ``word_diff`` / ``redline``: what changed, at word level, block by block (tables cell by cell).
* ``apply_ops``: the AI's edits (replace / insert / delete a run of blocks by id) applied to a block list.

Only ``<u>`` is kept as inline HTML (underline has no Markdown form); every other tag is plain text.
"""
from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass, field
from difflib import SequenceMatcher
from typing import Any, Dict, List, Optional, Sequence, Tuple

from markdown_it import MarkdownIt

_MD = MarkdownIt("commonmark", {"html": True}).enable(["table", "strikethrough"])
_WORD = re.compile(r"\s+|\w+|[^\w\s]", re.UNICODE)
_BLANK = re.compile(r"\s+")


# ── inline text with formatting ──────────────────────────────────────────────
@dataclass(frozen=True)
class Seg:
    """A run of text with one formatting."""
    text: str
    bold: bool = False
    italic: bool = False
    underline: bool = False
    strike: bool = False
    code: bool = False
    href: Optional[str] = None

    def flags(self) -> Tuple[bool, bool, bool, bool, bool]:
        return (self.bold, self.italic, self.underline, self.strike, self.code)


def _merge(segs: List[Seg]) -> List[Seg]:
    out: List[Seg] = []
    for s in segs:
        if not s.text:
            continue
        if out and out[-1].flags() == s.flags() and out[-1].href == s.href:
            out[-1] = Seg(out[-1].text + s.text, *s.flags(), href=s.href)
        else:
            out.append(s)
    return out


def inline_segments(inline) -> List[Seg]:
    """The formatted runs of one markdown-it ``inline`` token."""
    bold = italic = underline = strike = 0
    href: Optional[str] = None
    out: List[Seg] = []

    def add(text: str, code: bool = False) -> None:
        out.append(Seg(text, bool(bold), bool(italic), bool(underline), bool(strike), code, href))

    for t in (inline.children or []) if inline is not None else []:
        k = t.type
        if k == "text":
            add(t.content)
        elif k == "code_inline":
            add(t.content, True)
        elif k in ("softbreak",):
            add(" ")
        elif k == "hardbreak":
            add("\n")
        elif k == "strong_open":
            bold += 1
        elif k == "strong_close":
            bold = max(0, bold - 1)
        elif k == "em_open":
            italic += 1
        elif k == "em_close":
            italic = max(0, italic - 1)
        elif k == "s_open":
            strike += 1
        elif k == "s_close":
            strike = max(0, strike - 1)
        elif k == "link_open":
            href = dict(t.attrs or {}).get("href")
        elif k == "link_close":
            href = None
        elif k == "html_inline":
            tag = t.content.strip().lower()
            if tag == "<u>":
                underline += 1
            elif tag == "</u>":
                underline = max(0, underline - 1)
            elif tag in ("<br>", "<br/>", "<br />"):
                add("\n")
            else:
                add(t.content)                     # any other tag is text, never markup
        elif k == "image":
            add(t.content or "")
        elif t.content:
            add(t.content)
    return _merge(out)


def plain(segs: Sequence[Seg]) -> str:
    return "".join(s.text for s in segs)


def normalize(text: str) -> str:
    """The text as a comparison sees it: white space collapsed, case kept."""
    return _BLANK.sub(" ", (text or "").replace("\u00a0", " ")).strip()


# ── blocks ───────────────────────────────────────────────────────────────────
@dataclass
class Cell:
    text: str
    segments: List[Seg] = field(default_factory=list)


@dataclass
class Block:
    kind: str                                   # heading | paragraph | list_item | table | quote | code | hr | raw
    source: str                                 # the Markdown exactly as written
    text: str = ""                              # the plain text (formatting marks removed; for a table, its cells joined)
    level: int = 0                              # heading level 1-6, or list nesting depth (0 = top)
    ordered: bool = False
    number: Optional[int] = None                # the number of an ordered list item
    segments: List[Seg] = field(default_factory=list)
    rows: List[List[Cell]] = field(default_factory=list)      # a table's cells, header row first
    start: int = 0
    end: int = 0
    locator: Any = None                         # where this block lives in a source file (set by a file importer)

    @property
    def signature(self) -> str:
        return f"{self.kind}|{self.level}|{normalize(self.text)}"

    @property
    def digest(self) -> str:
        return hashlib.sha1(self.signature.encode("utf-8")).hexdigest()[:10]

    @property
    def words(self) -> int:
        return len(re.findall(r"\w+", self.text))


def _match(tokens, i: int) -> int:
    close = tokens[i].type.replace("_open", "_close")
    level = tokens[i].level
    for k in range(i + 1, len(tokens)):
        if tokens[k].type == close and tokens[k].level == level:
            return k
    return len(tokens) - 1


def _slice(lines: List[str], start: int, end: int) -> str:
    chunk = lines[start:end]
    while chunk and not chunk[-1].strip():
        chunk.pop()
    return "\n".join(chunk)


def _inline_of(tokens, lo: int, hi: int):
    for k in range(lo, hi):
        if tokens[k].type == "inline":
            return tokens[k]
    return None


def _table(tokens, lo: int, hi: int) -> List[List[Cell]]:
    rows: List[List[Cell]] = []
    row: Optional[List[Cell]] = None
    for k in range(lo, hi):
        t = tokens[k]
        if t.type == "tr_open":
            row = []
        elif t.type == "tr_close" and row is not None:
            rows.append(row)
            row = None
        elif t.type in ("th_open", "td_open") and row is not None:
            segs = inline_segments(tokens[k + 1] if k + 1 < hi and tokens[k + 1].type == "inline" else None)
            row.append(Cell(plain(segs), segs))
    return rows


def _walk(tokens, lo: int, hi: int, lines: List[str], out: List[Block], depth: int = -1) -> None:
    i = lo
    while i < hi:
        t = tokens[i]
        k = t.type
        if k == "heading_open":
            c = _match(tokens, i)
            segs = inline_segments(_inline_of(tokens, i, c))
            out.append(Block("heading", _slice(lines, *t.map), plain(segs), level=int(t.tag[1]), segments=segs, start=t.map[0], end=t.map[1]))
            i = c + 1
        elif k == "paragraph_open":
            c = _match(tokens, i)
            segs = inline_segments(_inline_of(tokens, i, c))
            out.append(Block("paragraph", _slice(lines, *t.map), plain(segs), segments=segs, start=t.map[0], end=t.map[1]))
            i = c + 1
        elif k in ("fence", "code_block"):
            out.append(Block("code", _slice(lines, *t.map), t.content.rstrip("\n"), start=t.map[0], end=t.map[1]))
            i += 1
        elif k == "hr":
            out.append(Block("hr", _slice(lines, *t.map), "", start=t.map[0], end=t.map[1]))
            i += 1
        elif k == "html_block":
            out.append(Block("raw", _slice(lines, *t.map), re.sub(r"<[^>]+>", " ", t.content).strip(), start=t.map[0], end=t.map[1]))
            i += 1
        elif k == "table_open":
            c = _match(tokens, i)
            rows = _table(tokens, i, c)
            out.append(Block("table", _slice(lines, *t.map), " | ".join(cell.text for row in rows for cell in row),
                             rows=rows, start=t.map[0], end=t.map[1]))
            i = c + 1
        elif k == "blockquote_open":
            c = _match(tokens, i)
            text = "\n".join(plain(inline_segments(x)) for x in tokens[i:c] if x.type == "inline")
            out.append(Block("quote", _slice(lines, *t.map), text, start=t.map[0], end=t.map[1]))
            i = c + 1
        elif k in ("bullet_list_open", "ordered_list_open"):
            c = _match(tokens, i)
            _items(tokens, i, c, lines, out, depth + 1, k == "ordered_list_open")
            i = c + 1
        else:
            i += 1


def _items(tokens, lo: int, hi: int, lines: List[str], out: List[Block], depth: int, ordered: bool) -> None:
    i = lo + 1
    while i < hi:
        t = tokens[i]
        if t.type != "list_item_open":
            i += 1
            continue
        c = _match(tokens, i)
        inline = _inline_of(tokens, i, c)
        nested = next((k for k in range(i + 1, c) if tokens[k].type in ("bullet_list_open", "ordered_list_open")
                       and tokens[k].level == t.level + 1), None)
        own_end = tokens[nested].map[0] if nested is not None else t.map[1]
        segs = inline_segments(inline)
        number = None
        if ordered:
            try:
                number = int(t.info)
            except (TypeError, ValueError):
                number = None
        out.append(Block("list_item", _slice(lines, t.map[0], own_end), plain(segs), level=depth, ordered=ordered,
                         number=number, segments=segs, start=t.map[0], end=own_end))
        if nested is not None:
            nc = _match(tokens, nested)
            _items(tokens, nested, nc, lines, out, depth + 1, tokens[nested].type == "ordered_list_open")
        i = c + 1


def parse(markdown: str) -> List[Block]:
    """The blocks of a document, in order."""
    src = (markdown or "").replace("\r\n", "\n").replace("\r", "\n")
    lines = src.split("\n")
    blocks: List[Block] = []
    tokens = _MD.parse(src)
    _walk(tokens, 0, len(tokens), lines, blocks)
    covered = set()
    for b in blocks:
        covered.update(range(b.start, b.end))
    run: List[int] = []
    for n, line in enumerate(lines + [""]):
        if n < len(lines) and line.strip() and n not in covered:
            run.append(n)
            continue
        if run:                                                    # a line no block took: a reference definition, say
            blocks.append(Block("raw", "\n".join(lines[run[0]:run[-1] + 1]), "\n".join(lines[run[0]:run[-1] + 1]), start=run[0], end=run[-1] + 1))
            run = []
    blocks.sort(key=lambda b: (b.start, b.end))
    return blocks


def render(blocks: Sequence[Block]) -> str:
    """The Markdown of a block list: a blank line between blocks, a plain line between neighbouring list items."""
    out: List[str] = []
    prev: Optional[Block] = None
    for b in blocks:
        if prev is not None:
            out.append("\n" if prev.kind == "list_item" and b.kind == "list_item" else "\n\n")
        out.append(b.source)
        prev = b
    return "".join(out) + ("\n" if out else "")


def is_blank(blocks: Sequence[Block]) -> bool:
    """Nothing written yet: no blocks, or only a title."""
    return not blocks or (len(blocks) == 1 and blocks[0].kind == "heading")


def ids(blocks: Sequence[Block]) -> List[str]:
    return [f"B{i + 1}" for i in range(len(blocks))]


def index_of(block_id: str, count: int) -> Optional[int]:
    """The 0-based index of ``B12``; ``START`` is -1; anything else None."""
    if block_id.strip().upper() == "START":
        return -1
    m = re.fullmatch(r"B?(\d+)", block_id.strip(), re.I)
    if not m:
        return None
    n = int(m.group(1)) - 1
    return n if 0 <= n < count else None


def listing(blocks: Sequence[Block], *, limit_chars: Optional[int] = None) -> str:
    """The document as the model reads it: every block's Markdown after its id. ``limit_chars`` shortens long blocks."""
    out = []
    for n, b in enumerate(blocks, start=1):
        src = b.source
        if limit_chars and len(src) > limit_chars:
            src = src[:limit_chars].rstrip() + " …"
        first, _, rest = src.partition("\n")
        out.append(f"[B{n}] {first}" + (("\n" + rest) if rest else ""))
    return "\n".join(out)


# ── tables ───────────────────────────────────────────────────────────────────
def table_markdown(rows: Sequence[Sequence[str]]) -> str:
    """A GFM table from plain cell texts (the first row is the header)."""
    if not rows:
        return ""
    width = max(len(r) for r in rows)

    def cell(text: str) -> str:
        return (text or "").replace("|", "\\|").replace("\n", "<br>").strip()
    lines = ["| " + " | ".join(cell(c) for c in list(r) + [""] * (width - len(r))) + " |" for r in rows]
    lines.insert(1, "| " + " | ".join(["---"] * width) + " |")
    return "\n".join(lines)


def escape_inline(text: str) -> str:
    """Plain text safe to put inside Markdown: nothing in it can turn into formatting or into a different kind of block."""
    text = re.sub(r"([\\`*_\[\]<>|~])", r"\\\1", text)
    m = re.match(r"^(\s*)(#{1,6})(\s)", text)                           # would be a heading
    if m:
        return m.group(1) + "\\" + text[len(m.group(1)):]
    m = re.match(r"^(\s*)([-+])(\s)", text)                              # would be a bullet
    if m:
        return m.group(1) + "\\" + text[len(m.group(1)):]
    return re.sub(r"^(\s*\d+)([.)])(\s)", r"\1\\\2\3", text)           # would be a numbered item


# ── comparing two block lists ────────────────────────────────────────────────
def word_diff(a: str, b: str) -> List[Tuple[str, str]]:
    """``[(op, text)]`` with op ``equal`` | ``insert`` | ``delete``, by word."""
    ta, tb = _WORD.findall(a or ""), _WORD.findall(b or "")
    out: List[Tuple[str, str]] = []
    for tag, i1, i2, j1, j2 in SequenceMatcher(None, ta, tb, autojunk=False).get_opcodes():
        if tag == "equal":
            out.append(("equal", "".join(ta[i1:i2])))
        else:
            if i2 > i1:
                out.append(("delete", "".join(ta[i1:i2])))
            if j2 > j1:
                out.append(("insert", "".join(tb[j1:j2])))
    merged: List[Tuple[str, str]] = []
    for op, text in out:
        if merged and merged[-1][0] == op:
            merged[-1] = (op, merged[-1][1] + text)
        else:
            merged.append((op, text))
    return merged


def _ratio(a: Block, b: Block) -> float:
    if a.kind != b.kind and not (a.kind in ("paragraph", "list_item", "heading") and b.kind in ("paragraph", "list_item", "heading")):
        return 0.0
    return SequenceMatcher(None, normalize(a.text), normalize(b.text), autojunk=False).ratio()


@dataclass
class Pair:
    status: str                                 # equal | modified | inserted | deleted
    base: Optional[int] = None
    cur: Optional[int] = None
    format_only: bool = False                   # same words, different formatting or kind


def _same_format(a: Block, b: Block, numbers: bool = True) -> bool:
    if a.kind != b.kind or a.level != b.level or a.ordered != b.ordered or (numbers and a.number != b.number):
        return False
    if a.kind == "table":
        return [[c.text for c in r] for r in a.rows] == [[c.text for c in r] for r in b.rows]
    return [s.flags() for s in a.segments] == [s.flags() for s in b.segments] and [s.href for s in a.segments] == [s.href for s in b.segments]


def align(base: Sequence[Block], cur: Sequence[Block], threshold: float = 0.5) -> List[Pair]:
    """Pair the blocks of two versions. Blocks with the same text are equal; blocks in between are paired when they are alike
    enough to be an edit of one another, otherwise one is deleted and the other inserted."""
    pairs: List[Pair] = []
    sm = SequenceMatcher(None, [b.signature for b in base], [c.signature for c in cur], autojunk=False)
    for tag, i1, i2, j1, j2 in sm.get_opcodes():
        if tag == "equal":
            pairs += [Pair("equal", i1 + n, j1 + n) for n in range(i2 - i1)]
            continue
        a, b = list(range(i1, i2)), list(range(j1, j2))
        while a and b:
            if _ratio(base[a[0]], cur[b[0]]) >= threshold:
                pairs.append(Pair("modified", a.pop(0), b.pop(0)))
                continue
            look_b = next((n for n, j in enumerate(b[:6]) if _ratio(base[a[0]], cur[j]) >= threshold + 0.1), None)
            look_a = next((n for n, i in enumerate(a[:6]) if _ratio(base[i], cur[b[0]]) >= threshold + 0.1), None)
            if look_b is not None and (look_a is None or look_b <= look_a):
                pairs += [Pair("inserted", None, b.pop(0)) for _ in range(look_b)]
            elif look_a is not None:
                pairs += [Pair("deleted", a.pop(0), None) for _ in range(look_a)]
            else:
                pairs.append(Pair("deleted", a.pop(0), None))
                pairs.append(Pair("inserted", None, b.pop(0)))
        pairs += [Pair("deleted", i, None) for i in a]
        pairs += [Pair("inserted", None, j) for j in b]
    for p in pairs:
        if p.status == "equal" and not _same_format(base[p.base], cur[p.cur]):
            p.status, p.format_only = "modified", True
        elif p.status == "modified" and normalize(base[p.base].text) == normalize(cur[p.cur].text):
            p.format_only = True
    return pairs


def _cells(b: Block) -> List[List[str]]:
    return [[c.text for c in row] for row in b.rows]


def pair_rows(ra: Sequence[Sequence[str]], rb: Sequence[Sequence[str]]) -> List[Tuple[str, Optional[int], Optional[int]]]:
    """Pair the rows of two versions of a table: ``(status, row in a, row in b)`` with status equal | modified | inserted |
    deleted. A row that changed is paired with the row it became, so an edited row is not a deletion plus an insertion."""
    out: List[Tuple[str, Optional[int], Optional[int]]] = []
    sm = SequenceMatcher(None, [" | ".join(r) for r in ra], [" | ".join(r) for r in rb], autojunk=False)
    for tag, i1, i2, j1, j2 in sm.get_opcodes():
        if tag == "equal":
            out += [("equal", i1 + n, j1 + n) for n in range(i2 - i1)]
            continue
        a, b = list(range(i1, i2)), list(range(j1, j2))
        while a and b:
            like = lambda x, y: SequenceMatcher(None, " | ".join(ra[x]), " | ".join(rb[y]), autojunk=False).ratio()
            if like(a[0], b[0]) >= 0.4:
                out.append(("modified", a.pop(0), b.pop(0)))
            elif len(b) > 1 and like(a[0], b[1]) >= 0.5:
                out.append(("inserted", None, b.pop(0)))
            elif len(a) > 1 and like(a[1], b[0]) >= 0.5:
                out.append(("deleted", a.pop(0), None))
            else:
                out.append(("deleted", a.pop(0), None))
                out.append(("inserted", None, b.pop(0)))
        out += [("deleted", i, None) for i in a]
        out += [("inserted", None, j) for j in b]
    return out


def table_diff(a: Block, b: Block) -> List[Dict[str, Any]]:
    """A table's changes row by row: ``[{status, cells: [[(op, text)...]]}]``."""
    ra, rb = _cells(a), _cells(b)
    out: List[Dict[str, Any]] = []
    for status, i, j in pair_rows(ra, rb):
        if status == "equal":
            out.append({"status": "equal", "cells": [[("equal", c)] for c in ra[i]]})
        elif status == "modified":
            x, y = ra[i], rb[j]
            out.append({"status": "modified", "cells": [word_diff(x[c] if c < len(x) else "", y[c] if c < len(y) else "")
                                                        for c in range(max(len(x), len(y)))]})
        elif status == "deleted":
            out.append({"status": "deleted", "cells": [[("delete", c)] for c in ra[i]]})
        else:
            out.append({"status": "inserted", "cells": [[("insert", c)] for c in rb[j]]})
    return out


def redline(base: Sequence[Block], cur: Sequence[Block], pairs: Optional[List[Pair]] = None) -> List[Dict[str, Any]]:
    """The change from ``base`` to ``cur`` as the reader sees it, block by block."""
    out: List[Dict[str, Any]] = []
    for p in pairs if pairs is not None else align(base, cur):
        a = base[p.base] if p.base is not None else None
        b = cur[p.cur] if p.cur is not None else None
        ref = b or a
        row: Dict[str, Any] = {"status": p.status, "kind": ref.kind, "level": ref.level, "ordered": ref.ordered,
                               "base_index": p.base, "cur_index": p.cur, "format_only": p.format_only}
        if ref.kind == "table":
            row["table"] = table_diff(a, b) if a and b else [{"status": "inserted" if b else "deleted",
                                                               "cells": [[("insert" if b else "delete", c)] for c in r]} for r in _cells(ref)]
        elif p.status == "equal":
            row["segments"] = [("equal", b.text)]
        elif p.status == "inserted":
            row["segments"] = [("insert", b.text)]
        elif p.status == "deleted":
            row["segments"] = [("delete", a.text)]
        else:
            row["segments"] = word_diff(a.text, b.text)
            if a.kind != b.kind or a.level != b.level or a.ordered != b.ordered:
                row["was"] = {"kind": a.kind, "level": a.level, "ordered": a.ordered}
            shape = structure(a, b)
            if shape:
                row["structure"] = shape
        out.append(row)
    return out


def _shape(b: Block) -> str:
    if b.kind == "heading":
        return f"Heading {b.level}"
    if b.kind == "list_item":
        return "Numbered list" if b.ordered else "Bullet list"
    return {"paragraph": "Paragraph", "table": "Table", "quote": "Quote", "code": "Code", "hr": "Line", "raw": "HTML block"}.get(b.kind, b.kind)


def structure(a: Block, b: Block) -> List[str]:
    """How a block's place in the outline changed, in words ("Heading 2 → Heading 3", "Paragraph → Heading 2", "Bullet list →
    numbered list", "List level 1 → 2", "Renumbered 3 → 4"). Empty when only its words or their formatting changed."""
    if a.kind != b.kind or (a.kind == "heading" and a.level != b.level):
        return [f"{_shape(a)} → {_shape(b)}"]
    if a.kind != "list_item":
        return []
    out = []
    if a.ordered != b.ordered:
        out.append(f"{_shape(a)} → {_shape(b).lower()}")
    if a.level != b.level:
        out.append(f"List level {a.level + 1} → {b.level + 1}")
    if a.ordered and b.ordered and None not in (a.number, b.number) and a.number != b.number:
        out.append(f"Renumbered {a.number} → {b.number}")
    return out


def stats(base: Sequence[Block], cur: Sequence[Block]) -> Dict[str, int]:
    """How much changed: blocks inserted, deleted, modified and the words added and removed."""
    pairs = align(base, cur)
    added = removed = 0
    for p in pairs:
        if p.status == "inserted":
            added += cur[p.cur].words
        elif p.status == "deleted":
            removed += base[p.base].words
        elif p.status == "modified":
            for op, text in word_diff(base[p.base].text, cur[p.cur].text):
                n = len(re.findall(r"\w+", text))
                added += n if op == "insert" else 0
                removed += n if op == "delete" else 0
    return {"inserted": sum(p.status == "inserted" for p in pairs), "deleted": sum(p.status == "deleted" for p in pairs),
            "modified": sum(p.status == "modified" for p in pairs), "words_added": added, "words_removed": removed}


# ── applying edits ───────────────────────────────────────────────────────────
@dataclass
class Op:
    """One edit of a block list. ``kind``: replace (blocks ``start``..``end`` become ``markdown``), insert (``markdown`` goes
    after ``start``; ``START`` is the top), delete (blocks ``start``..``end`` go), replace_all (the whole document)."""
    id: str
    kind: str
    start: str = ""
    end: str = ""
    markdown: str = ""
    reason: str = ""
    refs: List[str] = field(default_factory=list)


def _range(op: Op, count: int) -> Optional[Tuple[int, int]]:
    s = index_of(op.start, count)
    e = index_of(op.end or op.start, count)
    if s is None or e is None or s < 0 or e < s:
        return None
    return s, e


def check_op(op: Op, count: int) -> Optional[str]:
    """Why an op cannot be applied to a document of ``count`` blocks, or None."""
    if op.kind == "replace_all":
        return None if op.markdown.strip() else "the new document is empty"
    if op.kind == "insert":
        i = index_of(op.start, count)
        if i is None:
            return f"there is no block {op.start!r} to insert after"
        return None if op.markdown.strip() else "nothing to insert"
    if op.kind in ("replace", "delete"):
        if _range(op, count) is None:
            return f"there is no block range {op.start!r}..{op.end or op.start!r}"
        if op.kind == "replace" and not op.markdown.strip():
            return "the replacement is empty"
        return None
    return f"unknown edit {op.kind!r}"


def apply_ops(base: Sequence[Block], ops: Sequence[Op]) -> Tuple[List[Block], Dict[str, str]]:
    """The block list after the ops that fit. Returns ``(blocks, {op id: "applied" | reason it was not})``. Ops refer to
    blocks of ``base`` by id; two ops that touch the same block do not both apply (the first does)."""
    n = len(base)
    status: Dict[str, str] = {}
    taken = [False] * n
    replace_at: Dict[int, Tuple[int, List[Block]]] = {}          # first index -> (last index, new blocks)
    insert_after: Dict[int, List[Block]] = {}
    whole: Optional[Op] = None
    for op in ops:
        why = check_op(op, n)
        if why:
            status[op.id] = why
            continue
        if op.kind == "replace_all":
            whole = op if whole is None else whole
            status[op.id] = "applied" if whole is op else "another edit replaces the whole document"
            continue
        if op.kind == "insert":
            insert_after.setdefault(index_of(op.start, n), []).extend(parse(op.markdown))
            status[op.id] = "applied"
            continue
        s, e = _range(op, n)
        if any(taken[s:e + 1]):
            status[op.id] = "it touches blocks another edit already changes"
            continue
        for k in range(s, e + 1):
            taken[k] = True
        replace_at[s] = (e, parse(op.markdown) if op.kind == "replace" else [])
        status[op.id] = "applied"
    if whole is not None:
        return parse(whole.markdown), status
    out: List[Block] = list(insert_after.get(-1, []))
    i = 0
    while i < n:
        if i in replace_at:
            last, new = replace_at[i]
            out += new
            out += [b for k in range(i, last + 1) for b in insert_after.get(k, [])]
            i = last + 1
            continue
        out.append(base[i])
        out += insert_after.get(i, [])
        i += 1
    return out, status


def locate(base: Sequence[Block], current: Sequence[Block]) -> Dict[int, int]:
    """For each block of ``base`` that is still in ``current`` unchanged, its index there. Used to place an edit made against
    an older version onto the version the person has now."""
    # a list item that was only renumbered (an item added above it) is still the same block for placing an edit
    return {p.base: p.cur for p in align(base, current)
            if p.status == "equal" or (p.format_only and _same_format(base[p.base], current[p.cur], numbers=False))}
