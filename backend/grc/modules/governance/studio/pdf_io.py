"""PDF files in the studio: read as Markdown from their layout.

A PDF holds positioned text, not paragraphs, so the structure is worked out from how the page looks: the size and weight of the
type (headings), a bullet or number at the start of a line (lists), the gap above a line (a new paragraph), ruled grids
(tables), and lines that repeat at the top or bottom of every page (running headers, footers and page numbers, which are
dropped). It is a good first reading, not a perfect one, so the person is told to check it. A PDF cannot be edited, so what
is saved from it is a Word copy built from this text. A scanned PDF has no text layer; it is read with the platform's local text
recognition (nothing leaves the server) and comes back as plain paragraphs.
"""
from __future__ import annotations

import re
from collections import Counter
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple

from .blocks import table_markdown
from .docx_io import _ESC
from .importers import Imported, ImportProblem, text_to_markdown

_MARKS = "•●▪◦·‣∙○■□\\-–—*"           # bullets, dashes and the private-use ones symbol fonts use
_BULLET = re.compile(rf"^\s*([{_MARKS}])\s+(\S.*)$")
_MARKER_ONLY = re.compile(rf"^\s*(?:\(?\d{{1,3}}[.)]|\(?[a-zA-Z][.)]|[{_MARKS}])\s*$")
_NUMBER = re.compile(r"^\s*(\(?\d{1,3})[.)]\s+(\S.*)$")
_LETTER = re.compile(r"^\s*(\(?[a-zA-Z])[.)]\s+(\S.*)$")
_SECTION = re.compile(r"^\s*(\d{1,2}(?:\.\d{1,2}){0,3})[.)]?\s+\S")
_PAGE_NO = re.compile(r"^\s*(?:page\s*)?\d{1,4}(?:\s*(?:of|/)\s*\d{1,4})?\s*$", re.I)
MAX_PAGES = 400


@dataclass
class Line:
    text: str
    size: float
    bold: bool
    x0: float
    y0: float
    y1: float
    block: int
    page: int


def _esc(text: str) -> str:
    return _ESC.sub(r"\\\1", text)


def _lines(page, number: int, skip: List[Tuple[float, float, float, float]]) -> List[Line]:
    out: List[Line] = []
    data = page.get_text("dict")
    for b_no, block in enumerate(data.get("blocks", [])):
        if block.get("type") != 0:
            continue
        for line in block.get("lines", []):
            spans = [s for s in line.get("spans", []) if (s.get("text") or "").strip()]
            if not spans:
                continue
            x0, y0, x1, y1 = line["bbox"]
            cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
            if any(a <= cx <= c and b <= cy <= d for a, b, c, d in skip):          # inside a table: the table has it
                continue
            text = "".join(s["text"] for s in line["spans"]).replace(" ", " ")
            chars = sum(len(s["text"]) for s in spans) or 1
            size = sum(s["size"] * len(s["text"]) for s in spans) / chars
            bold = all((s.get("flags", 0) & 16) or "bold" in (s.get("font") or "").lower() or "black" in (s.get("font") or "").lower() for s in spans)
            out.append(Line(text.strip(), round(size * 2) / 2, bool(bold), x0, y0, y1, b_no + number * 1000, number))
    return _join_markers(out)


def _join_markers(lines: List[Line]) -> List[Line]:
    """Many PDFs draw a list marker ("1.", a bullet) as a line of its own beside the text of the item: put them back together."""
    out: List[Line] = []
    for ln in lines:
        if _MARKER_ONLY.match(ln.text):
            continue
        out.append(ln)
    markers = [ln for ln in lines if _MARKER_ONLY.match(ln.text)]
    for m in markers:
        beside = [ln for ln in out if ln.page == m.page and abs((ln.y0 + ln.y1) / 2 - (m.y0 + m.y1) / 2) < max(3.0, m.size * 0.6) and ln.x0 > m.x0 and ln.x0 - m.x0 < 60]
        if beside:
            target = min(beside, key=lambda ln: ln.x0)
            target.text = f"{m.text.strip()} {target.text}"
            target.x0 = m.x0
        else:
            out.append(m)                                           # a marker with nothing beside it stays as it was
    return sorted(out, key=lambda ln: (ln.page, ln.y0, ln.x0))


def _tables(page) -> List[Tuple[Tuple[float, float, float, float], List[List[str]]]]:
    found = []
    try:
        finder = page.find_tables()
    except Exception:       # noqa: BLE001 - table detection is a bonus; text is still read without it
        return found
    for t in getattr(finder, "tables", []):
        rows = [[re.sub(r"\s+", " ", (c or "")).strip() for c in row] for row in t.extract()]
        rows = [r for r in rows if any(r)]
        if len(rows) >= 2 and max(len(r) for r in rows) >= 2:
            found.append((tuple(t.bbox), rows))
    return found


def _running(lines: List[Line], pages: int, heights: Dict[int, float]) -> set:
    """Texts that repeat in the top or bottom margin of many pages: headers, footers and page numbers."""
    margin: Counter = Counter()
    for ln in lines:
        h = heights.get(ln.page, 842)
        if ln.y1 < h * 0.09 or ln.y0 > h * 0.91:
            margin[re.sub(r"\d+", "#", ln.text.lower())] += 1
    need = max(2, int(pages * 0.4))
    return {t for t, n in margin.items() if n >= need}


def _is_margin_noise(ln: Line, repeated: set, h: float) -> bool:
    in_margin = ln.y1 < h * 0.09 or ln.y0 > h * 0.91
    return in_margin and (re.sub(r"\d+", "#", ln.text.lower()) in repeated or bool(_PAGE_NO.match(ln.text)))


def _drop_edges(lines: List[Line], heights: Dict[int, float], body: float) -> List[Line]:
    """A header or footer that does not repeat (a one-page document): a few short lines of small type at the very edge of the page,
    set apart from the text by a clear gap."""
    by_page: Dict[int, List[Line]] = {}
    for ln in lines:
        by_page.setdefault(ln.page, []).append(ln)
    drop = set()
    for page, items in by_page.items():
        items.sort(key=lambda ln: ln.y0)
        h = heights.get(page, 842)
        small = [ln.size <= body + 0.5 and len(ln.text) < 100 for ln in items]
        top = 0
        while top < len(items) and items[top].y1 < h * 0.08 and small[top]:
            top += 1
        if top and (top == len(items) or items[top].y0 - items[top - 1].y1 > items[top - 1].size * 1.2):
            drop.update(id(ln) for ln in items[:top])
        bottom = len(items)
        while bottom > top and items[bottom - 1].y0 > h * 0.92 and small[bottom - 1]:
            bottom -= 1
        if bottom < len(items) and (bottom == 0 or items[bottom].y0 - items[bottom - 1].y1 > items[bottom].size * 1.2):
            drop.update(id(ln) for ln in items[bottom:])
    return [ln for ln in lines if id(ln) not in drop]


def _heading_levels(lines: List[Line], body: float) -> Dict[float, int]:
    sizes = sorted({ln.size for ln in lines if ln.size >= body * 1.15 and len(ln.text) <= 140}, reverse=True)
    return {s: min(i + 1, 4) for i, s in enumerate(sizes)}


def import_pdf(path: str) -> Imported:
    import fitz

    try:
        doc = fitz.open(path)
    except Exception as exc:        # noqa: BLE001 - PyMuPDF raises several kinds of errors for a damaged file
        raise ImportProblem("This PDF could not be opened. It may be damaged.") from exc
    try:
        if doc.needs_pass:
            raise ImportProblem("This PDF is password protected. Remove the password and upload it again.")
        pages = min(doc.page_count, MAX_PAGES)
        notes: List[str] = []
        if doc.page_count > MAX_PAGES:
            notes.append(f"Only the first {MAX_PAGES} pages were read.")
        all_lines: List[Line] = []
        tables_by_page: Dict[int, List[Tuple[Tuple[float, float, float, float], List[List[str]]]]] = {}
        heights: Dict[int, float] = {}
        for n in range(pages):
            page = doc.load_page(n)
            heights[n] = page.rect.height
            tabs = _tables(page)
            tables_by_page[n] = tabs
            all_lines += _lines(page, n, [t[0] for t in tabs])
        if sum(len(ln.text) for ln in all_lines) < 40:
            return _scanned(path, doc.page_count, notes)
        repeated = _running(all_lines, pages, heights)
        lines = [ln for ln in all_lines if not _is_margin_noise(ln, repeated, heights.get(ln.page, 842))]
        weights: Counter = Counter()
        for ln in lines:
            weights[ln.size] += len(ln.text)
        body = weights.most_common(1)[0][0] if weights else 10.0
        lines = _drop_edges(lines, heights, body)
        levels = _heading_levels(lines, body)
        base_x = min((ln.x0 for ln in lines), default=0.0)
        title_seen = False
        out: List[Tuple[str, str]] = []                                  # (kind, markdown)
        para: List[str] = []
        last: Optional[Line] = None

        def flush() -> None:
            if para:
                text = re.sub(r"\s+", " ", " ".join(para)).strip()
                out.append(("p", _protect(_esc(text))))
                para.clear()

        events: List[Tuple[Tuple[int, float], str, Any]] = [((ln.page, ln.y0), "line", ln) for ln in lines]
        for n, tabs in tables_by_page.items():
            events += [((n, t[0][1]), "table", t[1]) for t in tabs]
        events.sort(key=lambda e: e[0])
        for _, kind, item in events:
            if kind == "table":
                flush()
                out.append(("t", table_markdown(item)))
                last = None
                continue
            ln: Line = item
            heading = levels.get(ln.size)
            numbered_bold = ln.bold and len(ln.text) <= 110 and bool(_SECTION.match(ln.text)) and not _BULLET.match(ln.text)
            standalone_bold = ln.bold and len(ln.text) <= 90 and ln.size >= body and not _BULLET.match(ln.text) and not ln.text.endswith(".")
            if heading or numbered_bold or standalone_bold:
                flush()
                if heading:
                    level = heading                                          # the largest type is the title (level 1), then 2, 3 ...
                    if not title_seen and level == 1 and len(ln.text) < 120:
                        title_seen = True
                else:
                    m = _SECTION.match(ln.text)
                    depth = m.group(1).count(".") + 1 if m else 2
                    level = min(depth + 1, 4)
                if out and out[-1][0] == "h" and last is not None and abs(ln.y0 - last.y1) < ln.size * 0.9 and last.size == ln.size:
                    prev_level, prev_text = out[-1][1].split(" ", 1)
                    out[-1] = ("h", f"{prev_level} {prev_text} {_esc(ln.text)}")      # a heading wrapped onto a second line
                else:
                    out.append(("h", "#" * level + " " + _esc(ln.text)))
                last = ln
                continue
            bullet, number, letter = _BULLET.match(ln.text), _NUMBER.match(ln.text), _LETTER.match(ln.text)
            if bullet or number or (letter and len(ln.text) > 6 and last is not None):
                flush()
                depth = max(0, min(3, round((ln.x0 - base_x) / 22)))
                if number:
                    marker, body_text = number.group(1).strip("()") + ".", number.group(2)
                else:
                    marker, body_text = "-", (bullet or letter).group(2)
                out.append(("li", "    " * depth + marker + " " + _protect(_esc(body_text.strip()))))
                last = ln
                continue
            continuing = (
                last is not None and last.block == ln.block and ln.y0 - last.y1 < ln.size * 0.9
                or (last is not None and last.page == ln.page and 0 <= ln.y0 - last.y1 < ln.size * 0.35)
                # a paragraph that runs over the end of a page: the last line stopped mid-sentence and this one carries on in lower case
                or (last is not None and last.page != ln.page and bool(para) and not re.search(r"[.:;!?)\]]$", para[-1]) and ln.text[:1].islower())
            )
            if out and out[-1][0] == "li" and last is not None and continuing and ln.x0 > base_x + 4:
                out[-1] = ("li", out[-1][1] + " " + _esc(ln.text))          # the second line of a list item
            elif para and continuing:
                if para[-1].endswith("-") and ln.text[:1].islower():
                    para[-1] = para[-1][:-1]
                    para[-1] += ln.text
                else:
                    para.append(ln.text)
            else:
                flush()
                para.append(ln.text)
            last = ln
        flush()
        if not out:
            return _scanned(path, doc.page_count, notes)
        parts: List[str] = []
        prev = None
        for kind, md in out:
            if prev is not None:
                parts.append("\n" if prev == "li" and kind == "li" else "\n\n")
            parts.append(md)
            prev = kind
        notes.append("Read from a PDF: headings, lists and tables were worked out from the layout, so check them. A PDF cannot be edited, so saving makes a Word copy of this text.")
        return Imported("".join(parts) + "\n", "pdf", notes)
    finally:
        doc.close()


def _protect(text: str) -> str:
    """A line that would turn into a heading, list or quote when read as Markdown gets its first character escaped."""
    text = re.sub(r"^(\s*)(#{1,6}\s)", r"\1\\\2", text)
    text = re.sub(r"^(\s*)([-+]\s)", r"\1\\\2", text)
    return re.sub(r"^(\s*\d+)([.)]\s)", r"\1\\\2", text)


def _scanned(path: str, page_count: int, notes: List[str]) -> Imported:
    """A PDF with no text layer: local text recognition, plain paragraphs."""
    text = ""
    try:
        from ...compliance_plugins.pdf_ingest.extract_pages import extract_all_pages

        with open(path, "rb") as f:
            data = f.read()
        text = "\n\n".join((p.get("text") or "").strip() for p in extract_all_pages(data, max_pages=min(page_count, 60), allow_ocr=True) if (p.get("text") or "").strip())
    except Exception:       # noqa: BLE001 - no recogniser installed, or it failed: say so below
        text = ""
    if not text.strip():
        raise ImportProblem("This PDF has no text in it (it looks like a scan) and the text recognition on this server found none. Upload a Word version, or a PDF that has a text layer.")
    notes.append("This PDF is a scan: its text was recognised on this server and may contain mistakes, so read it carefully. Headings and tables were not detected.")
    return Imported(text_to_markdown(text, unwrap=True), "pdf", notes)
