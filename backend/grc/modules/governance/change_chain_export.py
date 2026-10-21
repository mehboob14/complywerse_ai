"""The change log (the change chain) as files: Excel (one sheet each for versions, changes, sources and approvals), PDF (the same as tables) and
CSV (the changes). Built from ``change_chain.catalog``; the export says who produced it and when, so a printed copy stands alone.
"""
from __future__ import annotations

import csv
import io
import re
from datetime import datetime
from typing import Any, Dict, List, Sequence, Tuple
from xml.sax.saxutils import escape

from .change_chain import CATALOG_HEADERS, catalog

XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
PDF = "application/pdf"
CSV = "text/csv; charset=utf-8"
_SHEETS = (("Versions", "versions"), ("Changes", "changes"), ("Sources", "sources"), ("Approvals", "approvals"))   # the review, approval and acknowledgement trail
_WIDTHS = {"versions": [9, 17, 22, 14, 24, 9, 9, 9, 48, 12, 22, 17, 30],
           "changes": [8, 9, 17, 22, 14, 36, 10, 50, 50, 9, 9, 22, 36, 36, 40, 8],
           "sources": [38, 16, 22, 60, 12, 14], "approvals": [17, 22, 22, 80]}
PDF_CELL_CAP = 600


def _header_lines(c: Dict[str, Any], by: str) -> List[Tuple[str, str]]:
    d = c["document"]
    s = c["summary"]
    # a filtered export says so, and with what, before its counts (which are of what it holds)
    filtered = [("Filtered", "; ".join(f"{k}: {v}" for k, v in c["filters"]))] if c.get("filters") else []
    return [("Document", f"{d.get('code') or ''} {d['title']}".strip()), ("Current version", f"{d['version'] or ''} ({d['stage_label']})"),
            ("Type", d.get("doc_type") or ""), ("Owner", d.get("owner") or ""), ("Approved by", d.get("approved_by") or ""), *filtered,
            ("Versions", str(s["versions"])), ("Changes recorded", str(s["changes"])), ("People who changed it", str(s["people"])),
            ("Words added / removed", f"+{s['words_added']} / -{s['words_removed']}"), ("Sources relied on", str(s["sources"])),
            ("Produced by", by), ("Produced on", datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC"))]


def _text_cell(ws, row: int, col: int, value: Any):
    """A cell holding words, never a formula (a sentence that starts with = + - @ must not run)."""
    cell = ws.cell(row=row, column=col, value=value)
    if isinstance(value, str):
        cell.data_type = "s"
    return cell


def xlsx_bytes(c: Dict[str, Any], by: str) -> bytes:
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Font, PatternFill
    from openpyxl.utils import get_column_letter

    cat = catalog(c)
    wb = Workbook()
    ws = wb.active
    ws.title = "Summary"
    ws.column_dimensions["A"].width = 26
    ws.column_dimensions["B"].width = 70
    ws.cell(row=1, column=1, value="Change log").font = Font(bold=True, size=14)
    for n, (label, value) in enumerate(_header_lines(c, by), start=3):
        ws.cell(row=n, column=1, value=label).font = Font(bold=True)
        _text_cell(ws, n, 2, value)
    head_fill = PatternFill("solid", fgColor="0F4C5C")
    for title, key in _SHEETS:
        sheet = wb.create_sheet(title)
        for col, name in enumerate(CATALOG_HEADERS[key], start=1):
            cell = sheet.cell(row=1, column=col, value=name)
            cell.font = Font(bold=True, color="FFFFFF")
            cell.fill = head_fill
            cell.alignment = Alignment(vertical="center", wrap_text=True)
            sheet.column_dimensions[get_column_letter(col)].width = _WIDTHS[key][col - 1]
        for r, row in enumerate(cat[key], start=2):
            for col, value in enumerate(row, start=1):
                cell = _text_cell(sheet, r, col, value)
                cell.alignment = Alignment(vertical="top", wrap_text=True)
        sheet.freeze_panes = "A2"
        if cat[key]:
            sheet.auto_filter.ref = f"A1:{get_column_letter(len(CATALOG_HEADERS[key]))}{len(cat[key]) + 1}"
    out = io.BytesIO()
    wb.save(out)
    return out.getvalue()


def csv_text(c: Dict[str, Any], by: str) -> str:
    """The changes, one row each, with the document named on every row so the file stands alone."""
    cat = catalog(c)
    d = c["document"]
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["Document", "Document version now"] + CATALOG_HEADERS["changes"])
    for row in cat["changes"]:
        w.writerow([f"{d.get('code') or ''} {d['title']}".strip(), d["version"]] + [("'" + v if isinstance(v, str) and v[:1] in "=+-@" else v) for v in row])
    return buf.getvalue()


def pdf_bytes(c: Dict[str, Any], by: str) -> bytes:
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4, landscape
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.lib.units import cm
    from reportlab.platypus import PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

    from .studio.exporters import _pdf_font

    regular, bold, _, _ = _pdf_font()
    small = ParagraphStyle("cell", fontName=regular, fontSize=7, leading=8.6)
    head = ParagraphStyle("head", fontName=bold, fontSize=7, leading=8.6, textColor=colors.white)
    h1 = ParagraphStyle("h1", fontName=bold, fontSize=15, leading=19, spaceAfter=4)
    h2 = ParagraphStyle("h2", fontName=bold, fontSize=10.5, leading=13, spaceBefore=10, spaceAfter=4)
    body = ParagraphStyle("body", fontName=regular, fontSize=8.5, leading=11)

    def cap(v: Any) -> str:
        text = str(v if v is not None else "")
        return escape(text if len(text) <= PDF_CELL_CAP else text[:PDF_CELL_CAP].rstrip() + " … (cut: the Excel file has the whole text)").replace("\n", "<br/>")

    cat = catalog(c)
    story: List[Any] = [Paragraph("Change log", h1)]
    for label, value in _header_lines(c, by):
        story.append(Paragraph(f"<b>{escape(label)}:</b> {escape(value)}", body))

    def table(title: str, key: str, columns: Sequence[int], widths: Sequence[float]) -> None:
        story.append(Paragraph(title, h2))
        rows = cat[key]
        if not rows:
            story.append(Paragraph("Nothing recorded.", body))
            return
        data = [[Paragraph(escape(CATALOG_HEADERS[key][i]), head) for i in columns]]
        for row in rows:
            data.append([Paragraph(cap(row[i]), small) for i in columns])
        t = Table(data, colWidths=[w * cm for w in widths], repeatRows=1)
        t.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#0F4C5C")), ("VALIGN", (0, 0), (-1, -1), "TOP"),
                               ("GRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#B8C4C8")),
                               ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F4F7F8")]),
                               ("LEFTPADDING", (0, 0), (-1, -1), 3), ("RIGHTPADDING", (0, 0), (-1, -1), 3)]))
        story.append(t)

    # 26 cm of width on landscape A4
    table("Versions", "versions", [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1.4, 2.6, 3.2, 2.2, 3.6, 1.4, 1.5, 1.5, 6.6, 2.0])
    story.append(PageBreak())
    table("Changes, from what to what", "changes", [0, 2, 3, 5, 6, 7, 8, 9, 10, 11, 12, 14], [1.1, 2.2, 2.2, 2.9, 1.3, 4.2, 4.2, 0.9, 0.9, 1.9, 2.6, 2.1])
    story.append(PageBreak())
    table("Sources the changes rest on", "sources", [0, 1, 2, 3, 4, 5], [5.5, 2.6, 3.2, 10.0, 2.0, 2.7])
    table("Reviews, approvals, acknowledgements and other events", "approvals", [0, 1, 2, 3], [3.0, 4.0, 4.5, 14.5])

    def footer(canvas, doc):
        canvas.saveState()
        canvas.setFont(regular, 7)
        canvas.setFillColor(colors.HexColor("#586472"))
        canvas.drawString(1.2 * cm, 0.8 * cm, f"{c['document']['title']} - change log - produced by {by}")
        canvas.drawRightString(landscape(A4)[0] - 1.2 * cm, 0.8 * cm, f"Page {doc.page}")
        canvas.restoreState()

    out = io.BytesIO()
    SimpleDocTemplate(out, pagesize=landscape(A4), leftMargin=1.2 * cm, rightMargin=1.2 * cm, topMargin=1.2 * cm, bottomMargin=1.5 * cm,
                      title=f"{c['document']['title']} - change log", author=by).build(story, onFirstPage=footer, onLaterPages=footer)
    return out.getvalue()


def build(c: Dict[str, Any], fmt: str, by: str) -> Tuple[bytes, str, str]:
    """``(file bytes, media type, file name)`` for ``fmt`` (xlsx | pdf | csv)."""
    stem = re.sub(r"[^\w\- ]+", "", c["document"]["title"], flags=re.UNICODE).strip().replace(" ", "-")[:70] or "document"
    stem = f"{stem}-change-log{'-filtered' if c.get('filters') else ''}"
    if fmt == "xlsx":
        return xlsx_bytes(c, by), XLSX, f"{stem}.xlsx"
    if fmt == "pdf":
        return pdf_bytes(c, by), PDF, f"{stem}.pdf"
    if fmt == "csv":
        return ("﻿" + csv_text(c, by)).encode("utf-8"), CSV, f"{stem}.csv"
    raise ValueError("Choose xlsx, pdf or csv.")
