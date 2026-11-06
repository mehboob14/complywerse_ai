"""At a glance as a PDF for a committee pack: the six figures, the departments, the statuses, the kinds and what waits on people, for the scope the person
sees. Built from ``documents_overview.summary`` (so the same read rules apply to every number); nothing here reads the database.
"""
from __future__ import annotations

import io
import re
from datetime import datetime
from typing import Any, Dict, List, Sequence, Tuple
from xml.sax.saxutils import escape

from .documents_overview import STATUS_WORDS

PDF = "application/pdf"
ISSUE_WORDS = (("stuck", "Stuck in a stage"), ("on_hold", "On hold"), ("late_approvals", "Late approvals"), ("late_acknowledgements", "Late acknowledgements"),
               ("no_owner", "No owner"), ("expired", "Expired"), ("exception_applied", "Exception applied"))
REQUEST_WORDS = (("review", "Reviews"), ("approval", "Approvals"), ("acknowledgement", "Acknowledgements"))


def _when(iso: str) -> str:
    try:
        return datetime.fromisoformat(iso).strftime("%Y-%m-%d %H:%M UTC")
    except (TypeError, ValueError):
        return ""


def _waiting(row: Dict[str, Any], field: str) -> int:
    return sum(int(((row.get("waiting") or {}).get(kind) or {}).get(field) or 0) for kind, _ in REQUEST_WORDS)


def pdf_bytes(s: Dict[str, Any], by: str) -> bytes:
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4, landscape
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.lib.units import cm
    from reportlab.platypus import KeepTogether, Paragraph, SimpleDocTemplate, Table, TableStyle

    from .studio.exporters import _pdf_font

    regular, bold, _, _ = _pdf_font()
    cell = ParagraphStyle("cell", fontName=regular, fontSize=8, leading=10)
    head = ParagraphStyle("head", fontName=bold, fontSize=8, leading=10, textColor=colors.white)
    h1 = ParagraphStyle("h1", fontName=bold, fontSize=16, leading=20, spaceAfter=2)
    h2 = ParagraphStyle("h2", fontName=bold, fontSize=11, leading=14, spaceBefore=12, spaceAfter=4)
    body = ParagraphStyle("body", fontName=regular, fontSize=9, leading=12, textColor=colors.HexColor("#586472"))
    scope = s["scope"]
    totals, requests, reviews, issues = s["totals"], s["requests"], s["reviews"], s["issues"]
    late = sum(int(requests[kind]["overdue"]) for kind, _ in REQUEST_WORDS)

    def table(columns: Sequence[str], rows: Sequence[Sequence[Any]], widths: Sequence[float], numeric_from: int = 1) -> Table:
        data = [[Paragraph(escape(c), head) for c in columns]]
        for r in rows:
            data.append([Paragraph(str(v) if isinstance(v, int) else escape(str(v)), cell) for v in r])
        t = Table(data, colWidths=[w * cm for w in widths], repeatRows=1)
        style = [("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#0F4C5C")), ("VALIGN", (0, 0), (-1, -1), "TOP"),
                 ("GRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#B8C4C8")),
                 ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F4F7F8")]),
                 ("LEFTPADDING", (0, 0), (-1, -1), 4), ("RIGHTPADDING", (0, 0), (-1, -1), 4)]
        if numeric_from < len(columns):
            style.append(("ALIGN", (numeric_from, 0), (-1, -1), "RIGHT"))
        t.setStyle(TableStyle(style))
        return t

    story: List[Any] = [Paragraph("At a glance", h1), Paragraph(escape(scope["name"]) + (" and everything under it" if scope.get("includes_below") and not scope.get("whole_organisation") else ""), body),
                        Paragraph(f"As of {escape(_when(s.get('as_of') or ''))} · produced by {escape(by)}", body)]

    story.append(Paragraph("Figures", h2))
    story.append(table(["Documents", "Published", "In progress", "Overdue reviews", "Late requests", "Issues"],
                       [[totals["documents"], totals["in_force"], totals["in_progress"], reviews["overdue"], late, issues["documents"]]], [4.3] * 6, numeric_from=0))

    departments = [r for r in s.get("by_department") or []]
    if departments:
        rows = [["   " * int(r.get("depth") or 0) + str(r["name"]), r.get("owner") or "", r["documents"], r["in_force"], r["in_progress"],
                 r["overdue_reviews"], _waiting(r, "pending"), _waiting(r, "overdue"), r["issues"]] for r in departments]
        story.append(Paragraph("By department", h2))
        story.append(table(["Department", "Owner", "Documents", "Published", "In progress", "Overdue reviews", "Waiting on people", "Of them late", "Issues"], rows,
                           [6.4, 3.8, 2.1, 2.1, 2.1, 2.4, 2.5, 2.1, 1.7], numeric_from=2))

    status_rows = [[STATUS_WORDS.get(r["status"], r["status"].replace("_", " ").capitalize()), r["count"]] for r in s.get("by_status") or [] if r["count"]]
    type_rows = [[r["label"], r["count"], r["in_force"]] for r in s.get("by_type") or []]
    wait_rows = [[label, requests[kind]["pending"], requests[kind]["overdue"]] for kind, label in REQUEST_WORDS]
    issue_rows = [[label, issues[key]] for key, label in ISSUE_WORDS if issues.get(key)]
    sections = [("By status", ["Status", "Documents"], status_rows, [6.0, 2.5]), ("By type", ["Type", "Documents", "Published"], type_rows, [6.0, 2.5, 2.5]),
                ("Waiting on people", ["Asked of people", "Waiting", "Late"], wait_rows, [6.0, 2.5, 2.5]), ("Issues", ["Issue", "Documents"], issue_rows, [6.0, 2.5])]
    for title, columns, rows, widths in sections:
        if rows:
            story.append(KeepTogether([Paragraph(title, h2), table(columns, rows, widths)]))

    def footer(canvas, doc):
        canvas.saveState()
        canvas.setFont(regular, 7)
        canvas.setFillColor(colors.HexColor("#586472"))
        canvas.drawString(1.2 * cm, 0.8 * cm, f"At a glance - {scope['name']} - produced by {by}")
        canvas.drawRightString(landscape(A4)[0] - 1.2 * cm, 0.8 * cm, f"Page {doc.page}")
        canvas.restoreState()

    out = io.BytesIO()
    SimpleDocTemplate(out, pagesize=landscape(A4), leftMargin=1.2 * cm, rightMargin=1.2 * cm, topMargin=1.2 * cm, bottomMargin=1.5 * cm,
                      title=f"At a glance - {scope['name']}", author=by).build(story, onFirstPage=footer, onLaterPages=footer)
    return out.getvalue()


def file_name(s: Dict[str, Any]) -> str:
    stem = re.sub(r"[^\w\- ]+", "", s["scope"]["name"], flags=re.UNICODE).strip().replace(" ", "-").lower()[:60] or "organisation"
    return f"at-a-glance-{stem}-{datetime.utcnow().date().isoformat()}.pdf"


def build(s: Dict[str, Any], by: str) -> Tuple[bytes, str, str]:
    """``(file bytes, media type, file name)``."""
    return pdf_bytes(s, by), PDF, file_name(s)
