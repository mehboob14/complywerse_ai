"""What a Word file shows that its text does not hold, so the studio can show a Word document's hierarchy as Word does.

* ``labels`` - the number Word writes in front of each numbered paragraph ("1.", "1.3.1.1.", "II.", "a)", a bullet), worked
  out the way Word numbers: in document order, one set of counters per list definition, a deeper level restarting after a
  higher one, each level's own start, format (decimal, roman, letters, zero-padded, legal) and text ("%1.%2.%3.").
* ``body_look`` - whether a paragraph styled as a heading actually looks like body text (a clause numbered through a heading
  style, as policy manuals often do): neither bold nor larger than the document's normal text.

Nothing here changes the file; the text of a paragraph never holds these numbers (Word adds them when it lays the page out).
"""
from __future__ import annotations

import functools
import io
import re
from typing import Any, Dict, List, Optional, Tuple

from docx.oxml.ns import qn

from .docx_io import SYMBOL_GLYPHS as _BULLETS
from .docx_io import Ctx, Node, _on



def _roman(n: int) -> str:
    out = ""
    for value, sym in ((1000, "m"), (900, "cm"), (500, "d"), (400, "cd"), (100, "c"), (90, "xc"), (50, "l"), (40, "xl"), (10, "x"), (9, "ix"),
                       (5, "v"), (4, "iv"), (1, "i")):
        while n >= value:
            out, n = out + sym, n - value
    return out


def _letters(n: int) -> str:
    """Word's letters: a .. z, then aa .. zz, then aaa ..."""
    if n <= 0:
        return ""
    return chr(ord("a") + (n - 1) % 26) * ((n - 1) // 26 + 1)


def _ordinal(n: int) -> str:
    return f"{n}{'th' if 10 <= n % 100 <= 20 else {1: 'st', 2: 'nd', 3: 'rd'}.get(n % 10, 'th')}"


def format_number(n: int, fmt: Optional[str]) -> str:
    fmt = fmt or "decimal"
    if fmt == "upperRoman":
        return _roman(n).upper()
    if fmt == "lowerRoman":
        return _roman(n)
    if fmt == "upperLetter":
        return _letters(n).upper()
    if fmt == "lowerLetter":
        return _letters(n)
    if fmt == "decimalZero":
        return f"{n:02d}"
    if fmt == "ordinal":
        return _ordinal(n)
    if fmt == "none":
        return ""
    return str(n)


def _val(el, name: str) -> Optional[str]:
    e = el.find(qn(f"w:{name}")) if el is not None else None
    return e.get(qn("w:val")) if e is not None else None


def _numpr(ctx: Ctx, p) -> Tuple[Optional[str], int]:
    """The list a paragraph belongs to and its level: its own, else its style's (through the styles it is based on)."""
    ppr = p.find(qn("w:pPr"))
    np_ = ppr.find(qn("w:numPr")) if ppr is not None else None
    num = ilvl = None
    if np_ is not None:
        num = _val(np_, "numId")
        lv = _val(np_, "ilvl")
        ilvl = int(lv) if lv and lv.isdigit() else None
    ps = ppr.find(qn("w:pStyle")) if ppr is not None else None
    sid = ps.get(qn("w:val")) if ps is not None else ctx.styles.default_p
    s_num, s_lvl = ctx.styles.numpr(sid)
    num = num if num is not None else s_num
    ilvl = ilvl if ilvl is not None else (s_lvl or 0)
    return (None if num in (None, "0") else num), ilvl


def labels(ctx: Ctx) -> Dict[Any, str]:
    """For every numbered paragraph of the document (tables included), the number Word shows in front of it, by element."""
    out: Dict[Any, str] = {}
    counters: Dict[str, Dict[int, int]] = {}             # per list definition (abstractNum): level -> current number
    started: set = set()                                  # numbering instances that restarted their list when first used
    num_root = ctx.numbering.root
    if num_root is None:
        return out
    for p in ctx.doc.element.body.iter(qn("w:p")):
        num_id, ilvl = _numpr(ctx, p)
        if num_id is None:
            continue
        lvl, over = ctx.numbering._find(num_id, ilvl)
        if lvl is None:
            continue
        key = ctx.numbering.abstract_of(num_id) or f"num:{num_id}"
        levels = counters.setdefault(key, {})
        if num_id not in started:
            started.add(num_id)
            num = next((n for n in num_root.findall(qn("w:num")) if n.get(qn("w:numId")) == str(num_id)), None)
            for o in (num.findall(qn("w:lvlOverride")) if num is not None else []):
                if o.find(qn("w:startOverride")) is not None:          # this instance starts its list again
                    from_level = int(o.get(qn("w:ilvl")) or 0)
                    for k in [k for k in levels if k >= from_level]:
                        del levels[k]
        levels[ilvl] = levels.get(ilvl, ctx.numbering.start(num_id, ilvl) - 1) + 1
        for k in [k for k in levels if k > ilvl]:                       # a deeper level restarts after this one
            del levels[k]
        fmt = _val(lvl, "numFmt")
        text = _val(lvl, "lvlText") or ""
        if fmt == "bullet":
            out[p] = _BULLETS.get(text, text if text and text.isprintable() and not ("" <= text[0] <= "") else "•")
            continue
        legal = lvl.find(qn("w:isLgl")) is not None and _on(lvl.find(qn("w:isLgl")))

        def part(m: "re.Match[str]") -> str:
            k = int(m.group(1)) - 1
            if k > ilvl:
                return ""
            n = levels.get(k, ctx.numbering.start(num_id, k))
            klvl, _ = ctx.numbering._find(num_id, k)
            kfmt = "decimal" if legal else _val(klvl, "numFmt")
            return format_number(n, kfmt)

        label = re.sub(r"%([1-9])", part, text).strip()
        if label:
            out[p] = label
    return out


def _size(ctx: Ctx, sid: Optional[str]) -> Optional[int]:
    for st in ctx.styles.chain(sid):
        v = _val(st.find(qn("w:rPr")), "sz")
        if v and v.isdigit():
            return int(v)
    return None


def _normal_size(ctx: Ctx) -> int:
    size = _size(ctx, ctx.styles.default_p)
    if size:
        return size
    try:
        defaults = ctx.doc.styles.element.find(qn("w:docDefaults"))
        v = _val(defaults.find(qn("w:rPrDefault") + "/" + qn("w:rPr")), "sz") if defaults is not None else None
        return int(v) if v and v.isdigit() else 22
    except Exception:       # noqa: BLE001 - a missing default is Word's 11 pt
        return 22


def body_look(ctx: Ctx, node: Node, normal: int) -> bool:
    """A heading whose text Word shows like body text: not bold and no larger than normal text (paragraph and first run)."""
    if node.kind != "heading" or node.para is None:
        return False
    para = node.para
    bold = para.base_b
    size = _size(ctx, para.style_id)
    first = next((pc.run for pc in para.pieces if pc.kind == "t" and pc.text.strip()), None)
    rpr = first.find(qn("w:rPr")) if first is not None else None
    if rpr is not None:
        b = rpr.find(qn("w:b"))
        if b is not None:
            bold = _on(b)
        v = _val(rpr, "sz")
        if v and v.isdigit():
            size = int(v)
    return not bold and (size is None or size <= normal)


def _twips(el, *names: str) -> Optional[int]:
    for name in names:
        v = el.get(qn(f"w:{name}")) if el is not None else None
        if v is not None and v.lstrip("-").isdigit():
            return int(v)
    return None


def indent(ctx: Ctx, p) -> Tuple[float, float]:
    """Where Word sets a paragraph, in points: its left indent and the hanging part its number sits in (negative for a first-line
    indent). Each comes from the paragraph itself, else its list level, else its style and the styles that style is based on."""
    ppr = p.find(qn("w:pPr"))
    places = [ppr.find(qn("w:ind")) if ppr is not None else None]
    num_id, ilvl = _numpr(ctx, p)
    lvl = ctx.numbering._find(num_id, ilvl)[0] if num_id is not None else None
    lppr = lvl.find(qn("w:pPr")) if lvl is not None else None
    places.append(lppr.find(qn("w:ind")) if lppr is not None else None)
    ps = ppr.find(qn("w:pStyle")) if ppr is not None else None
    for st in ctx.styles.chain(ps.get(qn("w:val")) if ps is not None else ctx.styles.default_p):
        sppr = st.find(qn("w:pPr"))
        places.append(sppr.find(qn("w:ind")) if sppr is not None else None)
    left = hang = None
    for ind in places:
        if ind is None:
            continue
        left = _twips(ind, "left", "start") if left is None else left
        if hang is None:
            h, first = _twips(ind, "hanging"), _twips(ind, "firstLine")
            hang = h if h is not None else (-first if first is not None else None)
    return (left or 0) / 20, (hang or 0) / 20


def layout(ctx: Ctx, nodes: List[Node]) -> List[Dict[str, Any]]:
    """For each block the studio shows (in order) what Word shows that the text does not hold: ``label`` (the number in front of
    it), ``left`` and ``hang`` (its indent, in points), ``body`` (a heading that looks like body text) and ``locked`` (Word makes
    or draws it: a table of contents, a text box, a diagram). Only what applies."""
    numbers = labels(ctx)
    normal = _normal_size(ctx)
    out: List[Dict[str, Any]] = []
    for n in nodes:
        look: Dict[str, Any] = {"locked": True} if n.generated else {}
        if n.kind in ("heading", "paragraph", "list_item") and n.para is not None:
            if numbers.get(n.el):
                look["label"] = numbers[n.el]
            left, hang = indent(ctx, n.el)
            if left or hang:
                look["left"], look["hang"] = left, hang
            if body_look(ctx, n, normal):
                look["body"] = True
        out.append(look)
    return out


def for_blocks(data: bytes, markdown: str) -> List[Dict[str, Any]]:
    """The look of each block of ``markdown`` in ``data``, the Word file it was written into (which reads back as it, rules
    aside: a rule has no paragraph in Word, so it gets nothing)."""
    from docx import Document

    from . import blocks as B
    from .docx_io import walk

    doc = Document(io.BytesIO(data))
    ctx = Ctx(doc)
    ctx.numbering._find = functools.lru_cache(maxsize=None)(ctx.numbering._find)       # only read from here on: each list level once
    nodes, _ = walk(doc, ctx)
    looks = iter(layout(ctx, nodes))
    return [{} if b.kind == "hr" else next(looks, {}) for b in B.parse(markdown)]
