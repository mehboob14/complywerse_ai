"""Report export for access reviews — CSV, XLSX, PDF.

CSV/XLSX reuse the generic helpers already in search_router (no new deps). PDF
uses reportlab (already installed). All return a FastAPI StreamingResponse.
"""

from __future__ import annotations

import io
from typing import Any, Dict, List

from fastapi.responses import StreamingResponse

# Per-item table columns shared by every format.
ITEM_HEADERS = [
    "User", "Email", "Department", "Designation", "Roles",
    "MFA", "Account", "Privileged", "Terminated", "Last sign-in",
    "Findings", "Decision",
]


def item_rows(items: List[Dict[str, Any]]) -> List[List[Any]]:
    rows: List[List[Any]] = []
    for it in items:
        findings = "; ".join(f.get("title", "") for f in it.get("findings", [])) or "clean"
        rows.append([
            it.get("display_name") or it.get("email") or "",
            it.get("email") or "",
            it.get("department") or "",
            it.get("designation") or "",
            ", ".join(it.get("roles") or []),
            "yes" if it.get("mfa_enabled") else ("no" if it.get("mfa_enabled") is False else "?"),
            "disabled" if it.get("account_enabled") is False else "active",
            "yes" if it.get("is_privileged") else "no",
            "yes" if it.get("is_terminated") else "no",
            it.get("last_sign_in") or "",
            findings,
            it.get("decision") or "pending",
        ])
    return rows


def csv_response(stem: str, items: List[Dict[str, Any]]) -> StreamingResponse:
    from ...routers.search_router import _csv_response
    return _csv_response(f"{stem}.csv", ITEM_HEADERS, item_rows(items))


def xlsx_response(stem: str, items: List[Dict[str, Any]]) -> StreamingResponse:
    from ...routers.search_router import _xlsx_response
    return _xlsx_response(f"{stem}.xlsx", ITEM_HEADERS, item_rows(items))


def pdf_response(
    stem: str,
    campaign: Dict[str, Any],
    report: Dict[str, Any],
    items: List[Dict[str, Any]],
) -> StreamingResponse:
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import landscape, A4
    from reportlab.lib.styles import getSampleStyleSheet
    from reportlab.lib.units import mm
    from reportlab.platypus import (
        SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    )

    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=landscape(A4),
        leftMargin=12 * mm, rightMargin=12 * mm, topMargin=12 * mm, bottomMargin=12 * mm,
    )
    styles = getSampleStyleSheet()
    elems: List[Any] = []

    elems.append(Paragraph(f"Access Review Report — {campaign.get('name', '')}", styles["Title"]))
    verdict = report.get("verdict", "")
    elems.append(Paragraph(
        f"Status: {campaign.get('status', '')} &nbsp;&nbsp; Verdict: <b>{verdict.replace('_', ' ')}</b>",
        styles["Normal"],
    ))
    cov = 0
    if report.get("population_size"):
        cov = round(report["sample_size"] / report["population_size"] * 100)
    elems.append(Paragraph(
        f"Population: {report.get('population_size', 0)} &nbsp; "
        f"Sample: {report.get('sample_size', 0)} ({cov}% coverage) &nbsp; "
        f"Users with exceptions: {report.get('users_with_exceptions', 0)} &nbsp; "
        f"Total exceptions: {report.get('exceptions_total', 0)}",
        styles["Normal"],
    ))
    elems.append(Spacer(1, 6 * mm))

    # Findings-by-type summary line
    by_type = report.get("findings_by_type") or {}
    if by_type:
        summary = ", ".join(f"{k}: {v}" for k, v in by_type.items())
        elems.append(Paragraph(f"<b>Exceptions by type:</b> {summary}", styles["Normal"]))
        elems.append(Spacer(1, 4 * mm))

    # Per-item table
    data = [ITEM_HEADERS] + item_rows(items)
    table = Table(data, repeatRows=1)
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1e3a8a")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTSIZE", (0, 0), (-1, -1), 6.5),
        ("GRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#cbd5e1")),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f1f5f9")]),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ]))
    elems.append(table)

    doc.build(elems)
    buf.seek(0)
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{stem}.pdf"'},
    )
