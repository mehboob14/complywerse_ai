"""The approval record (approval_record.py) as files: on its own as a PDF or Word document, or added after the document it belongs to
(the user, 2026-10-23: it is part of every document, so what compliance hands an auditor carries it). Built from the record only - no
database - so ``to_pdf`` / ``to_docx`` / ``append_to_docx`` / ``append_to_pdf`` are the same few functions whatever the document is; the
drawn signatures come in as ``images`` ({e-signature id: PNG bytes}), a signature without ink is left out.

Every time is printed as ``YYYY-MM-DD HH:MM UTC`` - the date AND the time, with the meaning of each signature beside it (what a
signed record must show in every human-readable form, 21 CFR 11.50). A page footer carries the record's reference and "Page X of Y".
The stored document is never touched: an uploaded Word or PDF file is read, the record is added to a copy.
"""
from __future__ import annotations

import html
import io
import re
from datetime import datetime
from typing import Any, List, Mapping, Optional, Sequence, Tuple
from urllib.parse import quote

TITLE = "Approval record"
_DECISION = {"signed": "Signed", "rejected": "Rejected", "pending": "Pending", "changes_requested": "Asked for changes", "delegated": "Handed over"}
_STATUS = {"complete": "Complete", "pending": "Pending", "changes_requested": "Waiting for changes", "rejected": "Rejected"}
_STATE = {"published": "Published", "approved": "Approved, not published", "in_approval": "In approval", "in_review": "In review",
          "draft": "Draft", "archived": "Archived"}
_RULE = {"all": "everyone signs", "any": "any one signs"}
IMAGE_BOX = (3.4, 1.3)                        # cm: the room a drawn signature gets in a table cell
MIME = {"pdf": "application/pdf", "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document"}


_UNFIT = re.compile("[\x00-\x08\x0b\x0c\x0e-\x1f\ud800-\udfff]")         # not allowed in a Word file (XML), and nothing to print in a PDF


def scrub(value: Any) -> Any:
    """The record with every text cleaned of characters a document cannot hold (a comment may carry anything a person pasted)."""
    if isinstance(value, str):
        return _UNFIT.sub("", value)
    if isinstance(value, Mapping):
        return {k: scrub(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [scrub(v) for v in value]
    return value


# ── what the record says, as text (shared by the PDF and the Word file) ───────────
def when(iso: Optional[str]) -> str:
    """``2026-10-21 10:15 UTC`` (a record's times are naive UTC); a dash when there is none."""
    if not iso:
        return "-"
    try:
        return datetime.fromisoformat(iso).strftime("%Y-%m-%d %H:%M UTC")
    except ValueError:
        return str(iso)


def day(iso: Optional[str]) -> str:
    return str(iso)[:10] if iso else "-"


def rule_text(stage: Mapping[str, Any]) -> str:
    if stage["rule"] == "at_least":
        return f"at least {stage['min_count'] or 1} sign"
    return _RULE.get(stage["rule"], "everyone signs")


def stage_title(stage: Mapping[str, Any]) -> str:
    return f"{stage['position']}. {stage['label']}" + (f" - {stage['name']}" if stage.get("name") else "")


def who(p: Mapping[str, Any]) -> List[Tuple[str, str]]:
    """The lines of a person's cell: name (for whom, when handed over), designation, then what they wrote. (text, style)."""
    lines = [(p["name"] + (f" (for {p['on_behalf_of']})" if p.get("on_behalf_of") else ""), "bold")]
    if p.get("designation"):
        lines.append((p["designation"], "plain"))
    if p.get("comment"):
        lines.append((f"“{p['comment']}”", "italic"))
    return lines


def facts(record: Mapping[str, Any]) -> List[Tuple[str, str]]:
    d = record["document"]
    published = when(d["published_at"]) + (f", by {d['published_by']}" if d.get("published_by") and d["published_at"] else "")
    prep = record["prepared_by"]
    return [("Document", d["title"]), ("Code", d["code"] or "-"), ("Type", d["type"] or "-"), ("Classification", (d["classification"] or "-").title()),
            ("Version", d["version"]), ("State", _STATE.get(record["state"], record["state"])), ("Department", d["department"] or "-"),
            ("Owner", d["owner"] or "-"), ("Author", d["author"] or "-"), ("Effective", day(d["effective_date"])), ("Next review", day(d["next_review_date"])),
            ("Prepared by", (prep["name"] or "-") + (f", {prep['designation']}" if prep.get("designation") else "") + (f" - version made {when(prep['at'])}" if prep.get("at") else "")),
            ("Approved", when(d["approved_at"])), ("Published", published),
            ("Round", f"started {when(record['round']['started_at'])}" + (f", completed {when(record['round']['completed_at'])}" if record["round"]["complete"] else ", not completed"))]


def history_cell(row: Mapping[str, Any]) -> List[Tuple[str, str]]:
    """The approvers of a version: each as a name (with designation) and, under it, what they signed as and when."""
    out: List[Tuple[str, str]] = []
    for a in row["approvers"]:
        out += [(a["name"] + (f", {a['designation']}" if a.get("designation") else ""), "bold"), (f"{a['meaning']} - {when(a['signed_at'])}", "plain")]
    return out or [("-", "plain")]


def content_disposition(filename: str) -> str:
    """An attachment header that survives any file name: an ASCII fallback, and the real name encoded (RFC 5987) when it differs."""
    plain = re.sub(r"[^A-Za-z0-9._ -]+", "_", filename).strip() or "document"
    return f'attachment; filename="{plain}"' + ("" if plain == filename else f"; filename*=UTF-8''{quote(filename)}")


def stem(record: Mapping[str, Any]) -> str:
    """The first part of the file name: the document's code, else its title."""
    d = record["document"]
    return re.sub(r"[^\w\-]+", "-", d["code"] or d["title"] or "document", flags=re.UNICODE).strip("-")[:70] or "document"


def fit(png: bytes, box: Tuple[float, float] = IMAGE_BOX) -> Optional[Tuple[float, float]]:
    """The size, in the box's unit, a drawn signature takes in a cell (its own shape, as large as the box allows); None when unreadable."""
    try:
        from PIL import Image

        with Image.open(io.BytesIO(png)) as im:
            w, h = im.size
        scale = min(box[0] / w, box[1] / h)
        return w * scale, h * scale
    except Exception:       # noqa: BLE001 - a picture that cannot be read is left out, the record still prints
        return None


# ── PDF ──────────────────────────────────────────────────────────────────────────
def to_pdf(record: Mapping[str, Any], images: Optional[Mapping[int, bytes]] = None, page_word: str = "Page") -> bytes:
    """The record on its own: A4, the document's title, code and version at the top, the tables, the drawn signatures, and the record's
    reference with "Page X of Y" at the foot (``page_word``: "Approval record page" when the pages are added to a document's own, so
    the count is the record's and says so)."""
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.lib.units import cm
    from reportlab.pdfgen import canvas as rl_canvas
    from reportlab.platypus import Image, KeepTogether, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

    from .studio.exporters import _pdf_font

    images, record = images or {}, scrub(record)
    regular, bold, italic, _bi = _pdf_font()
    ink, grey, rule, fill = (colors.HexColor(c) for c in ("#000000", "#404040", "#BFBFBF", "#F2F2F2"))
    base = ParagraphStyle("base", fontName=regular, fontSize=9, leading=12)
    cell = ParagraphStyle("cell", parent=base, fontSize=8.3, leading=10.4)
    small = ParagraphStyle("small", parent=base, fontSize=7.5, leading=9.5, textColor=grey)
    sub = ParagraphStyle("sub", parent=small, keepWithNext=1, spaceAfter=2)               # a stage's state line stays with its heading and its table
    head = ParagraphStyle("head", parent=cell, fontName=bold)
    h1 = ParagraphStyle("h1", parent=base, fontName=bold, fontSize=20, leading=24, spaceAfter=3)
    h2 = ParagraphStyle("h2", parent=base, fontName=bold, fontSize=12, leading=15, spaceBefore=12, spaceAfter=5, keepWithNext=1)
    h3 = ParagraphStyle("h3", parent=base, fontName=bold, fontSize=10, leading=13, spaceBefore=8, spaceAfter=1, keepWithNext=1)
    styles = {"bold": ParagraphStyle("b", parent=cell, fontName=bold), "italic": ParagraphStyle("i", parent=cell, fontName=italic), "plain": cell}

    def esc(text: Any) -> str:
        return html.escape(str(text if text is not None else "")).replace("\n", "<br/>")

    def lines(rows: Sequence[Tuple[str, str]]) -> List[Any]:
        return [Paragraph(esc(text), styles[style]) for text, style in rows]

    def grid(data: List[List[Any]], widths: Sequence[float]) -> Table:
        t = Table(data, colWidths=[w * cm for w in widths], repeatRows=1)
        t.setStyle(TableStyle([("GRID", (0, 0), (-1, -1), 0.4, ink), ("BACKGROUND", (0, 0), (-1, 0), fill), ("VALIGN", (0, 0), (-1, -1), "TOP"),
                               ("TOPPADDING", (0, 0), (-1, -1), 3), ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
                               ("LEFTPADDING", (0, 0), (-1, -1), 4), ("RIGHTPADDING", (0, 0), (-1, -1), 4)]))
        return t

    d = record["document"]
    story: List[Any] = [Paragraph(TITLE, h1), Paragraph(esc(d["title"]), ParagraphStyle("t", parent=base, fontName=bold, fontSize=13, leading=16)),
                        Paragraph(esc(f"Reference {record['reference']} - generated {when(record['generated_at'])}"), small), Spacer(1, 8)]
    t = Table([[Paragraph(esc(k), head), Paragraph(esc(v), cell)] for k, v in facts(record)], colWidths=[3.6 * cm, 13.4 * cm])
    t.setStyle(TableStyle([("GRID", (0, 0), (-1, -1), 0.4, ink), ("BACKGROUND", (0, 0), (0, -1), fill), ("VALIGN", (0, 0), (-1, -1), "TOP"),
                           ("TOPPADDING", (0, 0), (-1, -1), 3), ("BOTTOMPADDING", (0, 0), (-1, -1), 3)]))
    story += [t, Paragraph("Approval stages", h2)]
    if not record["stages"]:
        story.append(Paragraph("No review or approval is recorded for this version.", base))
    for stage in record["stages"]:
        story.append(Paragraph(esc(stage_title(stage)), h3))
        story.append(Paragraph(esc(f"{_STATUS.get(stage['status'], stage['status'])} - {rule_text(stage)}"), sub))
        data = [[Paragraph(esc(h), head) for h in ("Name and designation", "Meaning", "Decision", "Date and time", "Signature")]]
        for p in stage["people"]:
            sig = p.get("signature")
            png = images.get(sig["id"]) if sig else None
            size = fit(png, IMAGE_BOX) if png else None
            mark: List[Any] = [Image(io.BytesIO(png), width=size[0] * cm, height=size[1] * cm, hAlign="LEFT")] if png and size else []
            if sig:
                mark.append(Paragraph(esc(f"Drawn e-signature, seal {sig['seal_short']}"), small))
            data.append([lines(who(p)), Paragraph(esc(p["meaning"]), cell), Paragraph(esc(_DECISION.get(p["decision"], p["decision"])), cell),
                         Paragraph(esc(when(p["signed_at"]) if p["signed_at"] else "-"), cell), mark or Paragraph("-", cell)])
        story.append(grid(data, [4.5, 2.5, 2.2, 3.7, 4.1]))
    story.append(Paragraph("Milestones", h2))
    data = [[Paragraph(esc(h), head) for h in ("Date and time", "Event", "By", "Detail")]]
    data += [[Paragraph(esc(when(x["at"])), cell), Paragraph(esc(x["event"]), cell), Paragraph(esc(x["actor"] or "-"), cell), Paragraph(esc(x["detail"]), cell)]
             for x in record["milestones"]]
    story.append(grid(data, [3.6, 2.7, 3.0, 7.7]))
    if record["history"]:
        story.append(Paragraph("Approved versions", h2))
        data = [[Paragraph(esc(h), head) for h in ("Version", "Approved", "Published", "Prepared by and summary", "Approved by")]]
        for row in record["history"]:
            data.append([Paragraph(esc(row["version"]), cell), Paragraph(esc(when(row["approved_at"])), cell), Paragraph(esc(when(row["published_at"])), cell),
                         lines([(row["prepared_by"] or "-", "bold")] + ([(row["summary"], "plain")] if row["summary"] else [])), lines(history_cell(row))])
        story.append(grid(data, [1.5, 3.5, 3.5, 3.9, 4.6]))
    if record["notes"]:
        story += [Paragraph("Notes", h2)] + [Paragraph(esc("- " + n), cell) for n in record["notes"]]
    story.append(Spacer(1, 6))
    story.append(KeepTogether(Paragraph(esc("This record is produced by the platform from the document's sign-off, signature and audit data. It is not edited by hand."), small)))

    top = f"{d['code']} - v{d['version']}" if d["code"] else f"v{d['version']}"

    class Canvas(rl_canvas.Canvas):
        """Two passes, so every page can say how many there are."""

        def __init__(self, *args, **kwargs):
            super().__init__(*args, **kwargs)
            self._pages: List[dict] = []

        def showPage(self):
            self._pages.append(dict(self.__dict__))
            self._startPage()

        def save(self):
            total = len(self._pages)
            for state in self._pages:
                self.__dict__.update(state)
                self._chrome(total)
                super().showPage()
            super().save()

        def _chrome(self, total: int) -> None:
            w, h = A4
            self.setStrokeColor(rule)
            self.setLineWidth(0.5)
            self.setFillColor(grey)
            self.setFont(bold, 8.5)
            self.drawString(2.0 * cm, h - 1.3 * cm, f"{TITLE} - {d['title']}"[:90])
            self.setFont(regular, 8.5)
            self.drawRightString(w - 2.0 * cm, h - 1.3 * cm, top)
            self.line(2.0 * cm, h - 1.6 * cm, w - 2.0 * cm, h - 1.6 * cm)
            self.line(2.0 * cm, 1.7 * cm, w - 2.0 * cm, 1.7 * cm)
            self.drawString(2.0 * cm, 1.2 * cm, f"Reference {record['reference']}")
            self.drawRightString(w - 2.0 * cm, 1.2 * cm, f"{page_word} {self._pageNumber} of {total}")

    out = io.BytesIO()
    SimpleDocTemplate(out, pagesize=A4, leftMargin=2.0 * cm, rightMargin=2.0 * cm, topMargin=2.3 * cm, bottomMargin=2.2 * cm,
                      title=f"{TITLE} - {d['title']} v{d['version']}", author="").build(story, canvasmaker=Canvas)
    return out.getvalue()


def append_to_pdf(data: bytes, record: Mapping[str, Any], images: Optional[Mapping[int, bytes]] = None) -> bytes:
    """A PDF's bytes with the record's pages after its own (the file given is read, never changed). ValueError when it cannot be read."""
    import fitz

    base = fitz.open(stream=data, filetype="pdf")
    try:
        # a protected file is not rewritten, whether it asks for a password or opens without one (its owner's restrictions would be dropped)
        if base.needs_pass or base.is_encrypted or (base.metadata or {}).get("encryption"):
            raise ValueError("The PDF is protected.")
        extra = fitz.open(stream=to_pdf(record, images, page_word="Approval record page"), filetype="pdf")
        try:
            base.insert_pdf(extra)
        finally:
            extra.close()
        return base.tobytes(deflate=True)
    finally:
        base.close()


# ── Word ─────────────────────────────────────────────────────────────────────────
def _heading(doc, text: str, level: int):
    from docx.shared import Pt

    try:
        return doc.add_heading(text, level)
    except KeyError:                    # a Word file without the heading styles: the same look by hand
        p = doc.add_paragraph()
        run = p.add_run(text)
        run.bold, run.font.size = True, Pt({1: 16, 2: 13, 3: 11}.get(level, 11))
        p.paragraph_format.keep_with_next = True
        return p


def _grid(table) -> None:
    """Thin borders on every cell, set on the table itself so a file without a "Table Grid" style still shows them."""
    from docx.oxml import OxmlElement
    from docx.oxml.ns import qn

    pr = table._tbl.tblPr
    borders = OxmlElement("w:tblBorders")
    for edge in ("top", "left", "bottom", "right", "insideH", "insideV"):
        el = OxmlElement(f"w:{edge}")
        for k, v in (("val", "single"), ("sz", "4"), ("space", "0"), ("color", "808080")):
            el.set(qn(f"w:{k}"), v)
        borders.append(el)
    after = {qn("w:shd"), qn("w:tblLayout"), qn("w:tblCellMar"), qn("w:tblLook")}          # Word's schema puts them before these
    nxt = next((c for c in pr if c.tag in after), None)
    (nxt.addprevious(borders) if nxt is not None else pr.append(borders))


def _fill(cell, lines: Sequence[Tuple[str, str]], size: float = 8.5, shade: Optional[str] = None) -> None:
    from docx.shared import Pt

    cell.text = ""
    for stray in cell.paragraphs[0].runs:               # `cell.text = ""` leaves an empty run behind
        stray._r.getparent().remove(stray._r)
    for i, (text, style) in enumerate(lines):
        p = cell.paragraphs[0] if i == 0 else cell.add_paragraph()
        p.paragraph_format.space_before, p.paragraph_format.space_after = Pt(0), Pt(1)
        run = p.add_run(text)
        run.font.size = Pt(size)
        run.bold = True if style == "bold" else None
        run.italic = True if style == "italic" else None
    if shade:
        from docx.oxml import OxmlElement
        from docx.oxml.ns import qn

        shd = OxmlElement("w:shd")
        shd.set(qn("w:val"), "clear")
        shd.set(qn("w:color"), "auto")
        shd.set(qn("w:fill"), shade)
        cell._tc.get_or_add_tcPr().append(shd)


def _table(doc, headers: Sequence[str], rows: Sequence[Sequence[Any]], fractions: Sequence[float], width) -> List[Any]:
    """A table of ``rows`` (each cell a list of (text, style), or a callable that fills the cell) as wide as ``width``; returns its rows."""
    from docx.oxml import OxmlElement
    from docx.oxml.ns import qn

    table = doc.add_table(rows=1 + len(rows), cols=len(headers))
    table.autofit = False
    _grid(table)
    for c, h in enumerate(headers):
        _fill(table.rows[0].cells[c], [(h, "bold")], shade="F2F2F2")
    for r, tr in enumerate(table.rows):                  # a row (a person with a drawn signature) is never cut across two pages; the header repeats
        props = tr._tr.get_or_add_trPr()
        props.append(OxmlElement("w:cantSplit"))
        if r == 0:
            head = OxmlElement("w:tblHeader")
            head.set(qn("w:val"), "true")
            props.append(head)
    for r, row in enumerate(rows, start=1):
        for c, value in enumerate(row):
            (value(table.rows[r].cells[c]) if callable(value) else _fill(table.rows[r].cells[c], value))
    for c, fraction in enumerate(fractions):             # the grid, the cells and the table all say the same widths (Word and LibreOffice read different ones)
        table.columns[c].width = int(width * fraction)
        for row in table.rows:
            row.cells[c].width = int(width * fraction)
    total = table._tbl.tblPr.find(qn("w:tblW"))
    if total is not None:
        total.set(qn("w:type"), "dxa")
        total.set(qn("w:w"), str(int(width / 635)))      # twips: 635 EMU each
    return list(table.rows)


def _signature_cell(png: Optional[bytes], seal: Optional[str]):
    def fill(cell) -> None:
        from io import BytesIO

        from docx.shared import Cm, Pt

        cell.text = ""
        p = cell.paragraphs[0]
        for stray in p.runs:                            # `cell.text = ""` leaves an empty run behind
            stray._r.getparent().remove(stray._r)
        p.paragraph_format.space_after = Pt(1)
        size = fit(png, IMAGE_BOX) if png else None
        if size:
            try:
                p.add_run().add_picture(BytesIO(png), width=Cm(size[0]), height=Cm(size[1]))
            except Exception:       # noqa: BLE001 - a picture Word cannot take is left out, the record still prints
                pass
        if seal:
            q = cell.add_paragraph() if p.runs else p
            run = q.add_run(f"Drawn e-signature, seal {seal}")
            run.font.size = Pt(7.5)
        elif not p.runs:
            p.add_run("-").font.size = Pt(8.5)

    return fill


def _add_record(doc, record: Mapping[str, Any], images: Mapping[int, bytes], standalone: bool) -> None:
    """The record's section: heading, the document's facts, each stage with its people and drawn signatures, the milestones, the
    approved versions and the notes. Added at the end of ``doc`` (an uploaded Word file keeps its own styles: nothing here depends on them)."""
    from docx.shared import Pt

    record = scrub(record)
    section = doc.sections[-1]
    width = section.page_width - section.left_margin - section.right_margin
    d = record["document"]
    if standalone:
        doc.add_paragraph(TITLE, style="Title")
    else:
        _heading(doc, TITLE, 1)
    p = doc.add_paragraph()
    run = p.add_run(d["title"])
    run.bold, run.font.size = True, Pt(13)
    p = doc.add_paragraph()
    run = p.add_run(f"Reference {record['reference']} - generated {when(record['generated_at'])}")
    run.font.size = Pt(8.5)
    _table(doc, ("Item", "Detail"), [[[(k, "bold")], [(v, "plain")]] for k, v in facts(record)], (0.24, 0.76), width)
    _heading(doc, "Approval stages", 2)
    if not record["stages"]:
        doc.add_paragraph("No review or approval is recorded for this version.")
    for stage in record["stages"]:
        _heading(doc, stage_title(stage), 3)
        sub = doc.add_paragraph()
        r = sub.add_run(f"{_STATUS.get(stage['status'], stage['status'])} - {rule_text(stage)}")
        r.font.size = Pt(8.5)
        rows = []
        for q in stage["people"]:
            sig = q.get("signature")
            rows.append([who(q), [(q["meaning"], "plain")], [(_DECISION.get(q["decision"], q["decision"]), "plain")],
                         [(when(q["signed_at"]) if q["signed_at"] else "-", "plain")],
                         _signature_cell(images.get(sig["id"]) if sig else None, sig["seal_short"] if sig else None)])
        _table(doc, ("Name and designation", "Meaning", "Decision", "Date and time", "Signature"), rows, (0.29, 0.15, 0.13, 0.17, 0.26), width)
    _heading(doc, "Milestones", 2)
    _table(doc, ("Date and time", "Event", "By", "Detail"),
           [[[(when(x["at"]), "plain")], [(x["event"], "plain")], [(x["actor"] or "-", "plain")], [(x["detail"], "plain")]] for x in record["milestones"]],
           (0.18, 0.16, 0.19, 0.47), width)
    if record["history"]:
        _heading(doc, "Approved versions", 2)
        _table(doc, ("Version", "Approved", "Published", "Prepared by and summary", "Approved by"),
               [[[(row["version"], "plain")], [(when(row["approved_at"]), "plain")], [(when(row["published_at"]), "plain")],
                 [(row["prepared_by"] or "-", "bold")] + ([(row["summary"], "plain")] if row["summary"] else []), history_cell(row)]
                for row in record["history"]], (0.09, 0.16, 0.16, 0.26, 0.33), width)
    if record["notes"]:
        _heading(doc, "Notes", 2)
        for note in record["notes"]:
            doc.add_paragraph(note)
    p = doc.add_paragraph()
    run = p.add_run("This record is produced by the platform from the document's sign-off, signature and audit data. It is not edited by hand.")
    run.font.size, run.italic = Pt(8), True


def to_docx(record: Mapping[str, Any], images: Optional[Mapping[int, bytes]] = None) -> bytes:
    """The record on its own as a Word document: A4, black headings, the reference and "Page X of Y" in the footer."""
    from docx import Document
    from docx.enum.text import WD_TAB_ALIGNMENT
    from docx.shared import Pt, RGBColor

    from .studio.exporters import GREY, _border, _field, _style_doc

    record = scrub(record)
    doc = Document()
    _style_doc(doc)
    d = record["document"]
    section = doc.sections[0]
    head = section.header.paragraphs[0]
    run = head.add_run(f"{TITLE} - {d['title']}")
    run.font.size, run.bold, run.font.color.rgb = Pt(9), True, RGBColor.from_string(GREY)
    _border(head, "bottom", 6, "BFBFBF", 6)
    foot = section.footer.paragraphs[0]
    foot.paragraph_format.tab_stops.add_tab_stop(section.page_width - section.left_margin - section.right_margin, WD_TAB_ALIGNMENT.RIGHT)
    run = foot.add_run(f"Reference {record['reference']}")
    run.font.size, run.font.color.rgb = Pt(8.5), RGBColor.from_string(GREY)
    foot.add_run("\tPage ").font.size = Pt(8.5)
    _field(foot, "PAGE")
    foot.add_run(" of ").font.size = Pt(8.5)
    _field(foot, "NUMPAGES")
    _border(foot, "top", 6, "BFBFBF", 6)
    doc.core_properties.title = f"{TITLE} - {d['title']} v{d['version']}"
    _add_record(doc, record, images or {}, standalone=True)
    out = io.BytesIO()
    doc.save(out)
    return out.getvalue()


def append_to_docx(data: bytes, record: Mapping[str, Any], images: Optional[Mapping[int, bytes]] = None) -> bytes:
    """A Word file's bytes with the record on new pages after its own content (the file given is read, never changed)."""
    from docx import Document

    doc = Document(io.BytesIO(data))
    doc.add_page_break()
    _add_record(doc, record, images or {}, standalone=False)
    out = io.BytesIO()
    doc.save(out)
    return out.getvalue()
