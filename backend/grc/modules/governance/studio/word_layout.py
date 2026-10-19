"""What a Word file shows that its text does not hold, so the studio can show a Word document's hierarchy as Word does.

* ``labels`` - the number Word writes in front of each numbered paragraph ("1.", "1.3.1.1.", "II.", "a)", a bullet), worked
  out the way Word numbers: in document order, one set of counters per list definition, a deeper level restarting after a
  higher one, each level's own start, format (decimal, roman, letters, zero-padded, legal) and text ("%1.%2.%3.").
* ``body_look`` - whether a paragraph styled as a heading actually looks like body text (a clause numbered through a heading
  style, as policy manuals often do): neither bold nor larger than the document's normal text.
* ``text_look`` - the typography Word gives a paragraph (font, size, bold, colour, alignment, spacing), resolved the way Word
  resolves it, and ``page`` - the page's width and margins and the document's normal text.

Nothing here changes the file; the text of a paragraph never holds these numbers (Word adds them when it lays the page out).
"""
from __future__ import annotations

import functools
import io
import re
from typing import Any, Dict, List, Optional, Tuple

from docx.opc.constants import RELATIONSHIP_TYPE as RT
from docx.oxml import parse_xml
from docx.oxml.ns import qn

from .docx_io import symbol_twin
from .docx_io import Ctx, Node, Para, TableInfo, _local, _on



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
            # a bullet in a symbol font as the sign that font draws (Symbol's F0E0 is a lozenge, Wingdings' an arrow)
            fonts = lvl.find(qn("w:rPr") + "/" + qn("w:rFonts"))
            face = (fonts.get(qn("w:ascii")) or fonts.get(qn("w:hAnsi")) or "") if fonts is not None else ""
            twin = symbol_twin(face, text)
            out[p] = twin or ("◦" if text == "o" else text if text and text.isprintable() and not ("\uf000" <= text[0] <= "\uf8ff") else "•")
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


def indent(ctx: Ctx, p) -> Tuple[float, float, float]:
    """Where Word sets a paragraph, in points: its left indent, the hanging part its number sits in (negative for a first-line
    indent) and its right indent. Each comes from the paragraph itself, else its list level, else its style and the styles that
    style is based on."""
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
    left = hang = right = None
    for ind in places:
        if ind is None:
            continue
        left = _twips(ind, "left", "start") if left is None else left
        right = _twips(ind, "right", "end") if right is None else right
        if hang is None:
            h, first = _twips(ind, "hanging"), _twips(ind, "firstLine")
            hang = h if h is not None else (-first if first is not None else None)
    return (left or 0) / 20, (hang or 0) / 20, (right or 0) / 20


def number_tab(ctx: Ctx, p, left: float, hang: float) -> Optional[float]:
    """Where a numbered paragraph's text starts on its first line, in points, when Word's tab after the number stops at a tab stop
    before the left indent ("1.3.1." at the margin, its indent at 0.85" and a list stop at 0.5": the text starts at 0.5", as the
    View draws it); None when it starts at the indent. Stops from the styles (base first), the list level, then the paragraph:
    each clears the stops it names, and a list stop of a nearer one replaces the one before it."""
    ppr = p.find(qn("w:pPr"))
    ps = ppr.find(qn("w:pStyle")) if ppr is not None else None
    places = list(reversed(list(ctx.styles.chain(ps.get(qn("w:val")) if ps is not None else ctx.styles.default_p))))
    num_id, ilvl = _numpr(ctx, p)
    lvl = ctx.numbering._find(num_id, ilvl)[0] if num_id is not None else None
    stops: Dict[float, str] = {}
    for el in places + [lvl, p]:
        tabs = el.find(qn("w:pPr") + "/" + qn("w:tabs")) if el is not None else None
        found = [(t.get(qn("w:val")), _twips(t, "pos")) for t in (tabs if tabs is not None else []) if t.tag == qn("w:tab")]
        if any(v == "num" for v, _ in found):
            stops = {pos: v for pos, v in stops.items() if v != "num"}
        for v, pos in found:
            if pos is None:
                continue
            if v == "clear":
                stops.pop(pos / 20, None)
            else:
                stops[pos / 20] = v
    start = left - hang
    before = sorted(pos for pos, v in stops.items() if v in ("left", "start", "num") and start < pos < left)
    return before[0] if before else None


# ── typography: what Word gives a paragraph's text ───────────────────────────
_A = "{http://schemas.openxmlformats.org/drawingml/2006/main}"
_HEX = re.compile(r"[0-9A-Fa-f]{6}")
_ALIGN = {"center": "center", "right": "right", "end": "right", "both": "justify", "distribute": "justify"}
# the names a run's colour uses for the theme's colours (with Word's usual mapping of text and background onto dark and light)
_THEME_COLOUR = {"text1": "dk1", "dark1": "dk1", "background1": "lt1", "light1": "lt1", "text2": "dk2", "dark2": "dk2", "background2": "lt2",
                 "light2": "lt2", "hyperlink": "hlink", "followedHyperlink": "folHlink"}
Theme = Tuple[Dict[str, str], Dict[str, str]]          # the theme's Latin typefaces and its colours


def theme(doc) -> Theme:
    """The theme's Latin typefaces ({"major": "Cambria", "minor": "Calibri"}) and colours ({"accent1": "#4F81BD", ...}): what a
    style's ``asciiTheme`` and a run's ``themeColor`` point at."""
    fonts: Dict[str, str] = {}
    colours: Dict[str, str] = {}
    try:
        root = parse_xml(doc.part.part_related_by(RT.THEME).blob)
    except Exception:       # noqa: BLE001 - no theme part (or a damaged one): no theme fonts or colours
        return fonts, colours
    for kind in ("major", "minor"):
        latin = root.find(f".//{_A}{kind}Font/{_A}latin")
        if latin is not None and latin.get("typeface"):
            fonts[kind] = latin.get("typeface")
    scheme = root.find(f".//{_A}clrScheme")
    for el in (scheme if scheme is not None else []):
        for c in el:
            v = c.get("val") if _local(c) == "srgbClr" else c.get("lastClr") if _local(c) == "sysClr" else None
            if v and _HEX.fullmatch(v):
                colours[_local(el)] = "#" + v.upper()
    return fonts, colours


def _props(ctx: Ctx, tag: str, sid: Optional[str], own=None, char: Optional[str] = None) -> List[Any]:
    """The ``tag`` properties (``rPr`` or ``pPr``) that apply, the strongest first, as Word stacks them: the run's or paragraph's
    own, the character style ``char`` and the styles it is based on, the paragraph style ``sid`` and the styles it is based on,
    the document's defaults."""
    out = [own] + [st.find(qn(f"w:{tag}")) for st in ctx.styles.chain(char)] + [st.find(qn(f"w:{tag}")) for st in ctx.styles.chain(sid)]
    defaults = ctx.doc.styles.element.find(qn("w:docDefaults"))
    out.append(defaults.find(f"{qn(f'w:{tag}Default')}/{qn(f'w:{tag}')}") if defaults is not None else None)
    return [x for x in out if x is not None]


def _first(levels: List[Any], name: str, read=lambda e: e.get(qn("w:val"))):
    """The value of property ``name`` at the strongest level that sets it."""
    for el in levels:
        e = el.find(qn(f"w:{name}"))
        if e is not None:
            v = read(e)
            if v is not None:
                return v
    return None


def _half_points(e) -> Optional[float]:
    v = e.get(qn("w:val"))
    return int(v) / 2 if v and v.isdigit() else None


def _underlined(e) -> bool:
    return (e.get(qn("w:val")) or "single") != "none"


def _font_name(name: Optional[str]) -> Optional[str]:
    """A font's name as it can go into a style (a file is not trusted to hold a name and nothing else)."""
    name = re.sub(r'["\\;{}<>\x00-\x1f]', "", name or "").strip()[:64]
    return name or None


def _spacing(levels: List[Any]) -> Dict[str, Any]:
    """``before``/``after`` in points (automatic spacing is Word's 14 pt) and ``line``: a multiple of single spacing, or
    "14pt" for an exact or at-least line height. Each from the strongest level that sets it."""
    out: Dict[str, Any] = {}
    for el in levels:
        sp = el.find(qn("w:spacing"))
        if sp is None:
            continue
        for side in ("before", "after"):
            if side in out:
                continue
            if (sp.get(qn(f"w:{side}Autospacing")) or "").lower() in ("1", "true", "on"):
                out[side] = 14.0
            elif _twips(sp, side) is not None:
                out[side] = _twips(sp, side) / 20
        line = _twips(sp, "line")
        if "line" not in out and line:
            out["line"] = round(line / 240, 2) if (sp.get(qn("w:lineRule")) or "auto") == "auto" else f"{line / 20:g}pt"
    return out


def _main_run(para: Para):
    """The run holding most of the paragraph's text outside links (the first on a tie): its look is the paragraph's, where a
    bold lead-in is not. A link's look is the link's (the editor draws links itself), so a paragraph that is all links - the
    entries of a table of contents - has its style's look (None)."""
    count: Dict[Any, int] = {}
    for pc in para.pieces:
        if pc.kind == "t" and pc.link is None and pc.text.strip():
            count[pc.run] = count.get(pc.run, 0) + len(pc.text.strip())
    return max(count, key=count.get) if count else None


def text_look(ctx: Ctx, th: Theme, para: Optional[Para], sid: Optional[str]) -> Dict[str, Any]:
    """The typography Word gives paragraph ``para`` (or any paragraph of style ``sid`` when ``para`` is None), resolved as Word
    does: the document's defaults, then the paragraph style from the style it is based on to itself, then the paragraph's own
    properties; for the text, the run holding most of it adds its character style and its own properties. ``font`` is the Latin
    font only (``ascii``, a theme font winning on the same element; never ``eastAsia`` or ``cs``). Bold, italic and underline
    come from the paragraph's style, kept while its main run keeps them: the Markdown already shows those set on the words
    themselves. Spacing and alignment only where Word adds them; ``font`` and ``size`` always (Word's own defaults: Times New
    Roman, 10 pt)."""
    fonts, colours = th
    own = para.el.find(qn("w:pPr")) if para is not None else None
    pl = _props(ctx, "pPr", sid, own)
    run = _main_run(para) if para is not None else None
    rpr = run.find(qn("w:rPr")) if run is not None else None
    char = rpr.find(qn("w:rStyle")) if rpr is not None else None
    rl = _props(ctx, "rPr", sid, rpr, char.get(qn("w:val")) if char is not None else None)
    styled = _props(ctx, "rPr", sid)                      # what the paragraph's style gives its text

    def font(e) -> Optional[str]:
        t = e.get(qn("w:asciiTheme"))                     # a theme font wins over a named one on the same element
        return _font_name((fonts.get("major" if t.startswith("major") else "minor") if t else None) or e.get(qn("w:ascii")))

    def colour(e) -> str:
        v = e.get(qn("w:val")) or ""
        if _HEX.fullmatch(v):                             # Word writes the theme colour's shade or tint here too
            return "#" + v.upper()
        t = e.get(qn("w:themeColor"))
        return colours.get(_THEME_COLOUR.get(t, t), "auto") if t else "auto"

    look: Dict[str, Any] = {"font": _first(rl, "rFonts", font) or "Times New Roman", "size": _first(rl, "sz", _half_points) or 10}
    for key, name, read in (("bold", "b", _on), ("italic", "i", _on), ("underline", "u", _underlined)):
        if _first(styled, name, read) and _first(rl, name, read):
            look[key] = True
    if _first(rl, "caps", _on):
        look["caps"] = True
    c = _first(rl, "color", colour)
    if c and c != "auto":
        look["color"] = c
    align = _ALIGN.get(_first(pl, "jc") or "")
    if align:
        look["align"] = align
    look.update({k: v for k, v in _spacing(pl).items() if v})
    return look


def _contextual(ctx: Ctx, para: Para) -> bool:
    return bool(_first(_props(ctx, "pPr", para.style_id, para.el.find(qn("w:pPr"))), "contextualSpacing", _on))


def table_look(ctx: Ctx, th: Theme, info: TableInfo) -> Dict[str, Any]:
    """``head_fill``: the shading of the table's first row, where it has one; ``size``: the size of its text (the first row
    under the header, else the header)."""
    look: Dict[str, Any] = {}
    for cell in info.rows[0]:
        shd = cell.tc.find(qn("w:tcPr") + "/" + qn("w:shd")) if cell.tc is not None else None
        fill = (shd.get(qn("w:fill")) or "") if shd is not None else ""
        if _HEX.fullmatch(fill):
            look["head_fill"] = "#" + fill.upper()
            break
    para = next((p for row in info.rows[1:] + info.rows[:1] for c in row for p in c.paras), None)
    if para is not None:
        look["size"] = text_look(ctx, th, para, para.style_id)["size"]
    return look


def page(ctx: Ctx, th: Theme) -> Dict[str, Any]:
    """The page the document is laid out on, from its last section: ``width`` and the ``left``, ``right`` and ``top`` margins in
    points (only what the file sets), and ``normal``: the look of a paragraph of the default style, for text that has no look of
    its own yet."""
    out: Dict[str, Any] = {}
    sect = ctx.doc.element.body.find(qn("w:sectPr"))
    size = sect.find(qn("w:pgSz")) if sect is not None else None
    margins = sect.find(qn("w:pgMar")) if sect is not None else None
    if _twips(size, "w"):
        out["width"] = _twips(size, "w") / 20
    for side in ("left", "right", "top"):
        v = _twips(margins, side)
        if v is not None:
            out[side] = abs(v) / 20
    out["normal"] = text_look(ctx, th, None, ctx.styles.default_p)
    return out


def layout(ctx: Ctx, nodes: List[Node], th: Optional[Theme] = None) -> List[Dict[str, Any]]:
    """For each block the studio shows (in order) what Word shows that the text does not hold: ``label`` (the number in front of
    it), ``left``, ``hang`` and ``right`` (its indents, in points), ``tab`` (where its text starts after the number, when that is
    a tab stop before the indent), ``body`` (a heading that looks like body text), ``locked``
    (Word makes or draws it: a table of contents, a text box, a diagram) and its typography (``text_look``; a table's is
    ``table_look``). Only what applies. Spacing between paragraphs of one style that Word leaves out (``contextualSpacing``, as
    list styles do) is left out here."""
    th = th or theme(ctx.doc)
    numbers = labels(ctx)
    normal = _normal_size(ctx)
    out: List[Dict[str, Any]] = []
    tight: List[bool] = []
    style: List[Optional[str]] = []
    for n in nodes:
        look: Dict[str, Any] = {"locked": True} if n.generated else {}
        text = n.kind in ("heading", "paragraph", "list_item") and n.para is not None
        if text:
            if numbers.get(n.el):
                look["label"] = numbers[n.el]
            left, hang, right = indent(ctx, n.el)
            if left or hang:
                look["left"], look["hang"] = left, hang
            tab = number_tab(ctx, n.el, left, hang) if look.get("label") and hang > 0 else None
            if tab is not None:
                look["tab"] = tab
            if right:
                look["right"] = right
            if body_look(ctx, n, normal):
                look["body"] = True
            look.update(text_look(ctx, th, n.para, n.para.style_id))
        elif n.kind == "table" and n.table is not None:
            look.update(table_look(ctx, th, n.table))
        out.append(look)
        tight.append(text and _contextual(ctx, n.para))
        style.append(n.para.style_id if text else None)
    for i, look in enumerate(out):
        if tight[i] and i > 0 and style[i - 1] == style[i]:
            look.pop("before", None)
        if tight[i] and i + 1 < len(out) and style[i + 1] == style[i]:
            look.pop("after", None)
    return out


def read(data: bytes, markdown: str) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
    """The look of each block of ``markdown`` in ``data``, the Word file it was written into (which reads back as it, rules
    aside: a rule has no paragraph in Word, so it gets nothing), and the page (``page``)."""
    from docx import Document

    from . import blocks as B
    from .docx_io import walk

    doc = Document(io.BytesIO(data))
    ctx = Ctx(doc)
    ctx.numbering._find = functools.lru_cache(maxsize=None)(ctx.numbering._find)       # only read from here on: each list level once
    th = theme(doc)
    nodes, _ = walk(doc, ctx)
    per_node = iter(layout(ctx, nodes, th))
    return [{} if b.kind == "hr" else next(per_node, {}) for b in B.parse(markdown)], page(ctx, th)


def for_blocks(data: bytes, markdown: str) -> List[Dict[str, Any]]:
    """The look of each block of ``markdown`` in ``data`` (see ``read``)."""
    return read(data, markdown)[0]
