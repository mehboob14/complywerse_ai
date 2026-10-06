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
RULE_HEADERS = ["Rule", "Name", "Category", "Runs on", "Severity", "Result", "Tested", "Failed",
                "Frameworks (clauses)", "What it found"]
_RESULT = {"pass": "Pass", "fail": "Fail", "not_run": "Not run", "not_applicable": "Not applicable", "error": "Error"}


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


def _runs_on(rule: Dict[str, Any]) -> str:
    if rule.get("kind") != "connector":
        return "Sampled identities"
    try:
        from .connector_rules import packs
        pack = packs().get(rule.get("connector"))
        return pack.label if pack else str(rule.get("connector") or "")
    except Exception:  # noqa: BLE001
        return str(rule.get("connector") or "")


def _found(rule: Dict[str, Any]) -> str:
    """The failing resources of a connector rule, or why a rule could not be judged."""
    failures = rule.get("failures") or []
    if failures:
        shown = "; ".join(f"{f.get('resource')}: {f.get('detail')}" for f in failures[:10])
        more = (rule.get("failed") or len(failures)) - min(len(failures), 10)
        return shown + (f" (+{more} more)" if more > 0 else "")
    return rule.get("reason") or (rule.get("detail") if rule.get("status") != "pass" else "") or ""


def rule_rows(rules: List[Dict[str, Any]]) -> List[List[Any]]:
    return [[r["id"], r["name"], r.get("domain") or "", _runs_on(r), r.get("severity") or "",
             _RESULT.get(r.get("status"), str(r.get("status") or "")), r.get("tested", 0), r.get("failed", 0),
             frameworks_text(r), _found(r)] for r in rules]


def csv_response(stem: str, items: List[Dict[str, Any]], rules: List[Dict[str, Any]] | None = None) -> StreamingResponse:
    """Users, then the rules that were checked — result, category, framework."""
    import csv
    import io
    from fastapi.responses import StreamingResponse

    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(ITEM_HEADERS)
    for row in item_rows(items):
        writer.writerow(row)
    if rules:
        writer.writerow([])
        writer.writerow(RULE_HEADERS)
        for row in rule_rows(rules):
            writer.writerow(row)
    buf.seek(0)
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{stem}.csv"'},
    )


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


def _verdict_reasons(report: Dict[str, Any]) -> str:
    return "; ".join(report.get("verdict_reasons") or [])


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
    if _verdict_reasons(report):
        elems.append(Paragraph(f"Because: {escape(_verdict_reasons(report))}", styles["Normal"]))
    for note in report.get("connector_notes") or []:
        if note.get("limits"):
            elems.append(Paragraph(f"{escape(str(note.get('label') or ''))}: {escape(note['limits'])}", styles["Normal"]))
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
        count = lambda s: sum(1 for r in rules if r.get("status") == s)
        elems.append(Paragraph(
            f"<b>Rules checked</b> — {count('pass')} passed, {count('fail')} failed, "
            f"{count('not_run')} not run, {count('not_applicable')} not applicable", styles["Heading3"]))
        elems.append(table([RULE_HEADERS] + rule_rows(rules),
                           widths=[15 * mm, 44 * mm, 24 * mm, 22 * mm, 13 * mm, 17 * mm, 11 * mm, 11 * mm, 44 * mm, 70 * mm]))
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
