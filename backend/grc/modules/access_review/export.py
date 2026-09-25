"""Report export for access reviews — CSV, XLSX, PDF.

CSV reuses the generic helper in search_router; XLSX and PDF are built here with
openpyxl and reportlab (both already installed). All return a StreamingResponse.
Every format says which rules the review ran and what each found, not only the
people it flagged.
"""

from __future__ import annotations

import io
from typing import Any, Dict, List
from xml.sax.saxutils import escape

from fastapi.responses import StreamingResponse

# Per-item table columns shared by every format.
ITEM_HEADERS = [
    "User", "Email", "Department", "Designation", "Roles",
    "MFA", "Account", "Privileged", "Terminated", "Last sign-in",
    "Rules failed", "Findings", "Decision",
]
RULE_HEADERS = ["Rule", "Name", "Category", "Severity", "Result", "Failed", "Passed", "Frameworks (clauses)"]


def item_rows(items: List[Dict[str, Any]]) -> List[List[Any]]:
    rows: List[List[Any]] = []
    for it in items:
        findings = "; ".join(f.get("title", "") for f in it.get("findings", [])) or "clean"
        failed = [r for r in it.get("rules") or [] if r.get("status") == "fail"]
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
            "; ".join(f"{r['id']} {r['name']}" for r in failed) or "none",
            findings,
            it.get("decision") or "pending",
        ])
    return rows


def frameworks_text(rule: Dict[str, Any], limit: int = 3) -> str:
    """'ISO 27001 A.5.15, A.8.2 · SOC 2 CC6.1' — the frameworks a rule evidences, with their clauses."""
    refs = rule.get("frameworks") or []
    text = " · ".join(f"{f['name']} {', '.join(f.get('codes') or [])}".strip() for f in refs[:limit])
    more = (rule.get("frameworks_total") or len(refs)) - min(len(refs), limit)
    return f"{text} (+{more} more)" if more > 0 else (text or rule.get("regulation") or "—")


def rule_rows(rules: List[Dict[str, Any]]) -> List[List[Any]]:
    return [[r["id"], r["name"], r.get("domain") or "", r.get("severity") or "",
             "Fail" if r.get("status") == "fail" else "Pass", r.get("failed", 0), r.get("passed", 0),
             frameworks_text(r)] for r in rules]


def csv_response(stem: str, items: List[Dict[str, Any]]) -> StreamingResponse:
    from ...routers.search_router import _csv_response
    return _csv_response(f"{stem}.csv", ITEM_HEADERS, item_rows(items))


def xlsx_response(stem: str, items: List[Dict[str, Any]], rules: List[Dict[str, Any]]) -> StreamingResponse:
    """Two sheets: the people certified, and the rules they were checked against."""
    from openpyxl import Workbook
    from openpyxl.styles import Font

    wb = Workbook()
    for ws, headers, rows in ((wb.active, ITEM_HEADERS, item_rows(items)),
                              (wb.create_sheet("Rules"), RULE_HEADERS, rule_rows(rules))):
        ws.append(headers)
        for cell in ws[1]:
            cell.font = Font(bold=True)
        for row in rows:
            ws.append(["" if v is None else v for v in row])
    wb.active.title = "Users"
    buf = io.BytesIO()
    wb.save(buf)
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{stem}.xlsx"'},
    )


_VERDICTS = {"effective": "Effective", "deficient": "Deficient", "material_weakness": "Material weakness"}
_SCOPES = {"enabled": "Every rule enabled in the library", "custom": "Rules picked for this review"}


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
    cell = styles["BodyText"].clone("cell", fontSize=7, leading=8.5)
    elems: List[Any] = []

    def table(rows: List[List[Any]], widths=None) -> Table:
        # cell text is data, not markup: "Privilege & SoD" must not read as an entity
        t = Table([[Paragraph(escape(str(v)), cell) for v in r] for r in rows], repeatRows=1, colWidths=widths)
        t.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#0f766e")),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("GRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#cbd5e1")),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f1f5f9")]),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ]))
        return t

    elems.append(Paragraph(f"Access review certification — {escape(campaign.get('name') or '')}", styles["Title"]))
    verdict = _VERDICTS.get(report.get("verdict", ""), report.get("verdict", ""))
    state = "Sealed" if not report.get("provisional") else f"In progress ({report.get('pending', 0)} still to decide)"
    elems.append(Paragraph(f"Verdict: <b>{verdict}</b> &nbsp;&nbsp; {state}", styles["Normal"]))
    cov = round(report["sample_size"] / report["population_size"] * 100) if report.get("population_size") else 0
    elems.append(Paragraph(
        f"Population: {report.get('population_size', 0)} &nbsp; "
        f"Sample: {report.get('sample_size', 0)} ({cov}% coverage) &nbsp; "
        f"Users with open exceptions: {report.get('users_with_exceptions', 0)} &nbsp; "
        f"Findings: {report.get('exceptions_total', 0)}",
        styles["Normal"],
    ))
    scope = report.get("rule_scope") or "enabled"
    scope_text = (f"The runnable rules that evidence {report.get('rule_framework_name') or report.get('rule_framework')}"
                  if scope == "framework" else _SCOPES.get(scope, scope))
    elems.append(Paragraph(f"Rules run: {escape(scope_text or '')}", styles["Normal"]))
    elems.append(Spacer(1, 5 * mm))

    rules = report.get("rule_results") or []
    if rules:
        failed = sum(1 for r in rules if r.get("status") == "fail")
        elems.append(Paragraph(f"<b>Rules checked</b> — {len(rules) - failed} passed, {failed} failed", styles["Heading3"]))
        elems.append(table([RULE_HEADERS] + rule_rows(rules),
                           widths=[16 * mm, 55 * mm, 32 * mm, 16 * mm, 13 * mm, 13 * mm, 13 * mm, 115 * mm]))
        elems.append(Spacer(1, 6 * mm))

    elems.append(Paragraph("<b>Users certified</b>", styles["Heading3"]))
    elems.append(table([ITEM_HEADERS] + item_rows(items)))

    doc.build(elems)
    buf.seek(0)
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{stem}.pdf"'},
    )
