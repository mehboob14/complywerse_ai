"""Committee packs (Risk Management wave 3-J): the sections a pack is built from, read from live data once, and the frozen
pack as files: PDF (through the shared artifact exporter), Excel (one sheet per section), and the PDF filed as a paper on its
committee meeting, where the governance module keeps uploaded papers. The endpoints are in routers/reports.py."""
from __future__ import annotations

import io
import os
import re
import uuid
from datetime import datetime, timedelta
from typing import Any, List, Optional, Tuple

from sqlalchemy.orm import Session

from ...models import GRCUser, MeetingAttachment, Risk, RiskAppetiteConfig, RiskIncident, RiskReport, RiskReview
from ...routers._artifact_export import build_export
from ..governance.routers import committees
from ..issue_management.services.risk_actions import OPEN_ACTION_STATUSES, legacy_shaped_actions
from .routers.appetite import _breaching, _open_risks, _score, _tolerance
from .routers.incidents import _net_by_currency, _quarter_start

TOP_RISKS = 10
ACCEPTANCE_HORIZON_DAYS = 60
OPEN_REVIEW_STATUSES = ("pending", "in_review", "submitted")
APPROVED_REVIEW_STATUSES = ("approved", "completed")
PDF = "application/pdf"
XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
MONEY_SECTIONS = {"losses", "scenarios"}


def loss_quarters(incidents) -> tuple:
    """Net loss this quarter and last, per currency (loss events page rule: booked by accounting date, else occurrence)."""
    this_quarter = _quarter_start(datetime.utcnow())
    last_quarter = _quarter_start(this_quarter - timedelta(days=1))
    booked = lambda e: e.accounting_date or e.incident_date  # noqa: E731
    return (_net_by_currency(e for e in incidents if booked(e) >= this_quarter),
            _net_by_currency(e for e in incidents if last_quarter <= booked(e) < this_quarter))


# ── Committee packs: each section is (columns, rows) read from live data once, at build, plus a plain draft commentary ──
def _label(value: Optional[str]) -> str:
    return (value or "uncategorized").replace("_", " ").title()


def _day(value: Optional[datetime]) -> Optional[str]:
    return value.date().isoformat() if value else None


def _count(n: int, one: str, many: str) -> str:
    return f"{n} {one if n == 1 else many}"


def _appetite_section(db: Session, tenant_id: int, user: GRCUser) -> tuple:
    """Per category with a limit: open risks, risks over the limit and red limit KRIs, by the appetite page's one rule."""
    rows = []
    configs = db.query(RiskAppetiteConfig).filter(RiskAppetiteConfig.tenant_id == tenant_id).order_by(RiskAppetiteConfig.category)
    for config in configs:
        hits = _breaching(db, config)
        over = sum(1 for kind, _ in hits if kind == "risk")
        open_risks = _open_risks(db, [tenant_id]).filter(Risk.risk_category == config.category).count()
        rows.append([_label(config.category), config.appetite_level, _tolerance(config), open_risks, over, len(hits) - over,
                     "Outside appetite" if hits else "Within appetite"])
    outside = [r[0] for r in rows if r[-1] == "Outside appetite"]
    if not rows:
        return rows, "No appetite limits are set."
    if not outside:
        return rows, f"All {_count(len(rows), 'category is', 'categories are')} within appetite."
    return rows, f"{len(outside)} of {len(rows)} categories are outside appetite: {', '.join(outside)}."


def _direction(now: Optional[float], review: Optional[RiskReview]) -> str:
    before = review.previous_residual_score if review else None
    if review is None:
        return "No approved review"
    if now is None or before is None:
        return "—"
    return f"Up from {before:g}" if now > before else f"Down from {before:g}" if now < before else "No change"


def _top_risks_section(db: Session, tenant_id: int, user: GRCUser) -> tuple:
    """The highest open risks with their score before the last approved review."""
    risks = sorted((r for r in _open_risks(db, [tenant_id]) if _score(r)), key=_score, reverse=True)[:TOP_RISKS]
    last = {}
    for review in db.query(RiskReview).filter(RiskReview.risk_id.in_([r.id for r in risks]),
                                              RiskReview.status.in_(APPROVED_REVIEW_STATUSES)).order_by(RiskReview.completed_at, RiskReview.id):
        last[review.risk_id] = review          # ascending: the latest approved review wins
    rows = [[r.title, _label(r.risk_category or r.category), r.inherent_score, r.residual_score,
             _direction(r.residual_score, last.get(r.id))] for r in risks]
    if not rows:
        return rows, "No open risk is scored."
    up, down = (sum(1 for r in rows if r[-1].startswith(word)) for word in ("Up", "Down"))
    return rows, (f"The highest open risk is {rows[0][0]} at {_score(risks[0]):g}. Since their last approved review "
                  f"{_count(up, 'top risk rose', 'top risks rose')} and {down} fell.")


def _red_kris_section(db: Session, tenant_id: int, user: GRCUser) -> tuple:
    """The executive report's KRI alerts, red only."""
    from .routers.reports import get_executive_dashboard      # here: the reports router imports this module
    rows = [[a["name"], a["value"]] for a in get_executive_dashboard(db=db, current_user=user).kri_alerts if a["status"] == "red"]
    return rows, (f"{_count(len(rows), 'KRI is', 'KRIs are')} red: {', '.join(r[0] for r in rows)}." if rows else "No KRI is red.")


def _losses_section(db: Session, tenant_id: int, user: GRCUser) -> tuple:
    """Net loss per currency, this quarter against last: never added across currencies."""
    this, last = loss_quarters(db.query(RiskIncident).filter(RiskIncident.tenant_id == tenant_id).all())
    now, before = ({r["currency"]: r["net_loss"] for r in rows} for rows in (this, last))
    rows = [[currency or "—", now.get(currency, 0.0), before.get(currency, 0.0)]
            for currency in sorted(now.keys() | before.keys(), key=lambda c: c or "")]
    if not rows:
        return rows, "No net loss was booked this quarter or last."
    return rows, "Net loss this quarter: " + "; ".join(f"{c} {n:,.2f} (last quarter {c} {b:,.2f})" for c, n, b in rows) + "."


def _overdue_actions_section(db: Session, tenant_id: int, user: GRCUser) -> tuple:
    """Open risk actions (on the CAPA engine) past their due date, longest overdue first."""
    now = datetime.utcnow()
    titles = dict(db.query(Risk.id, Risk.title).filter(Risk.tenant_id == tenant_id).all())
    late = [a for a in legacy_shaped_actions(db, [tenant_id]) if a.status in OPEN_ACTION_STATUSES and a.due_date and a.due_date < now]
    rows = sorted(([a.title, titles.get(a.risk_id), _day(a.due_date), (now - a.due_date).days] for a in late),
                  key=lambda r: r[-1], reverse=True)
    if not rows:
        return rows, "No risk action is overdue."
    month = sum(1 for r in rows if r[-1] > 30)
    return rows, f"{_count(len(rows), 'risk action is', 'risk actions are')} overdue, {month} by more than 30 days."


def _acceptances_section(db: Session, tenant_id: int, user: GRCUser) -> tuple:
    """Approved acceptances that lapse within 60 days, or already have."""
    horizon = datetime.utcnow() + timedelta(days=ACCEPTANCE_HORIZON_DAYS)
    risks = db.query(Risk).filter(Risk.tenant_id == tenant_id, Risk.status == "accepted", Risk.acceptance_status == "approved",
                                  Risk.acceptance_expires_at <= horizon).order_by(Risk.acceptance_expires_at)
    rows = [[r.title, _day(r.acceptance_expires_at), _label(r.acceptance_state)] for r in risks]
    expired = sum(1 for r in rows if r[-1] == "Expired")
    if not rows:
        return rows, f"No risk acceptance expires within {ACCEPTANCE_HORIZON_DAYS} days."
    return rows, (f"{_count(len(rows), 'risk acceptance expires', 'risk acceptances expire')} within "
                  f"{ACCEPTANCE_HORIZON_DAYS} days or already has ({expired} expired).")


def _reviews_section(db: Session, tenant_id: int, user: GRCUser) -> tuple:
    """Reviews scheduled, in review or awaiting approval."""
    now = datetime.utcnow()
    reviews = db.query(RiskReview, Risk.title).join(Risk, Risk.id == RiskReview.risk_id).filter(
        Risk.tenant_id == tenant_id, RiskReview.status.in_(OPEN_REVIEW_STATUSES)).order_by(RiskReview.due_date)
    rows = [[title, _label(r.status), _day(r.due_date), "Yes" if r.due_date < now else "No"] for r, title in reviews]
    if not rows:
        return rows, "No risk review is open."
    late = sum(1 for r in rows if r[-1] == "Yes")
    return rows, f"{_count(len(rows), 'risk review is', 'risk reviews are')} open, {late} past the due date."


def _scenarios_section(db: Session, tenant_id: int, user: GRCUser) -> tuple:
    """Approved scenarios with their tail losses, each in its own currency."""
    from .routers.scenarios import approved_scenarios      # here: keeps this module importable without the scenarios router
    rows = [[s["title"], s["currency"], s["one_in_20"], s["one_in_100"], (s["approved_at"] or "")[:10] or None]
            for s in approved_scenarios(db, [tenant_id])]
    if not rows:
        return rows, "No scenario is approved."
    worst = max(rows, key=lambda r: r[3] or 0)
    return rows, (f"{_count(len(rows), 'scenario is', 'scenarios are')} approved. The largest 1-in-100 loss is "
                  f"{worst[1]} {worst[3] or 0:,.0f} ({worst[0]}).")


SECTIONS = (    # key, title (also the Excel sheet name: 31 characters at most), columns, builder
    ("appetite", "Appetite by category", ["Category", "Appetite", "Limit", "Open risks", "Risks over limit", "Red limit KRIs",
                                          "Status"], _appetite_section),
    ("top_risks", "Top risks", ["Risk", "Category", "Before controls", "After controls", "Change"], _top_risks_section),
    ("red_kris", "Red KRIs", ["KRI", "Value"], _red_kris_section),
    ("losses", "Net loss", ["Currency", "This quarter", "Last quarter"], _losses_section),
    ("overdue_actions", "Overdue actions", ["Action", "Risk", "Due", "Days overdue"], _overdue_actions_section),
    ("acceptances", "Acceptances expiring", ["Risk", "Expires", "State"], _acceptances_section),
    ("reviews", "Open reviews", ["Risk", "Status", "Due", "Overdue"], _reviews_section),
    ("scenarios", "Approved scenarios", ["Scenario", "Currency", "1 in 20", "1 in 100", "Approved"], _scenarios_section),
)


def build_sections(db: Session, tenant_id: int, user: GRCUser) -> Tuple[List[dict], dict]:
    """Every section from live data now ({key, title, columns, rows}), and a draft commentary per section from its numbers."""
    sections, commentary = [], {}
    for key, title, columns, build in SECTIONS:
        rows, draft = build(db, tenant_id, user)
        sections.append({"key": key, "title": title, "columns": columns, "rows": rows})
        commentary[key] = draft
    return sections, commentary


# ── The frozen pack as files ─────────────────────────────────────────────────────────────────────────────────────
def _sections(pack: RiskReport) -> List[dict]:
    return (pack.report_data or {}).get("sections", [])


def _stamp(pack: RiskReport, approver: Optional[str]) -> str:
    built = (pack.report_data or {}).get("built_at", "")[:10]
    frozen = f" Approved and frozen by {approver} on {pack.approved_at.date().isoformat()}." if pack.approved_at else ""
    return f"Built from live data on {built}.{frozen}"


def _cell(value: Any, money: bool) -> str:
    if value is None:
        return "—"
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return f"{value:,.2f}" if money else f"{value:g}"
    return str(value).replace("|", "/").replace("\n", " ")


def _markdown(pack: RiskReport, approver: Optional[str]) -> str:
    lines = [_stamp(pack, approver), "", (pack.report_data or {}).get("summary") or ""]
    for s in _sections(pack):
        lines += ["", f"## {s['title']}", "", (pack.commentary or {}).get(s["key"]) or "", ""]
        if not s["rows"]:
            lines.append("None.")
            continue
        money = s["key"] in MONEY_SECTIONS
        lines += ["| " + " | ".join(s["columns"]) + " |", "|" + "---|" * len(s["columns"])]
        lines += ["| " + " | ".join(_cell(v, money) for v in row) + " |" for row in s["rows"]]
    return "\n".join(lines)


def pdf(pack: RiskReport, approver: Optional[str]) -> Tuple[bytes, str]:
    data, media, _ext = build_export("pdf", title=pack.title, content=_markdown(pack, approver))
    return data, media


def xlsx(pack: RiskReport, approver: Optional[str]) -> Tuple[bytes, str]:
    """A summary sheet, then one sheet per section: its title, the commentary, a blank row, the header and the rows."""
    from openpyxl import Workbook
    from openpyxl.styles import Font

    book = Workbook()
    summary = book.active
    summary.title = "Pack"
    for row in ([pack.title], [_stamp(pack, approver)], [(pack.report_data or {}).get("summary") or ""]):
        summary.append(row)
    summary["A1"].font = Font(bold=True, size=14)
    for s in _sections(pack):
        sheet = book.create_sheet(s["title"][:31])
        sheet.append([s["title"]])
        sheet.append([(pack.commentary or {}).get(s["key"]) or ""])
        sheet.append([])
        sheet.append(s["columns"])
        for row in s["rows"]:
            sheet.append(row)
        for cell in (sheet["A1"], *sheet[4]):
            cell.font = Font(bold=True)
    out = io.BytesIO()
    book.save(out)
    return out.getvalue(), XLSX


def file_stem(pack: RiskReport) -> str:
    """A filename safe in a Content-Disposition header."""
    return re.sub(r"[^A-Za-z0-9 ._-]+", "", pack.title or "").strip() or f"committee-pack-{pack.id}"


def meeting_paper(pack: RiskReport, approver: GRCUser) -> MeetingAttachment:
    """Write the frozen pack's PDF where the meeting's uploaded papers live and return the attachment row (the caller adds
    and commits it). An error writing the file stops the freeze, so a pack is never frozen without its paper."""
    name = approver.display_name or approver.username
    data, _media = pdf(pack, name)
    folder = os.path.join(committees.MEETING_ATTACHMENT_DIR, str(pack.tenant_id), str(pack.meeting_id))
    os.makedirs(folder, exist_ok=True)
    path = os.path.join(folder, f"{uuid.uuid4().hex}.pdf")
    with open(path, "wb") as f:
        f.write(data)
    return MeetingAttachment(tenant_id=pack.tenant_id, meeting_id=pack.meeting_id, file_name=f"{pack.title}.pdf",
                             file_path=path, file_type="pdf", file_size=len(data), uploaded_by=approver.id,
                             description=f"Committee pack #{pack.id}, approved and frozen by {name} "
                                         f"on {pack.approved_at.date().isoformat()}.")
