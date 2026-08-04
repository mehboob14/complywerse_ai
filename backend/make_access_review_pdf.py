# -*- coding: utf-8 -*-
"""Access Review brief with diagrams: cover + architecture page + one page per
stage (business/logical/technical + a flow diagram). Output: Access_Review_Stages.pdf
"""
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, PageBreak, Table, TableStyle, HRFlowable,
)
from reportlab.graphics.shapes import Drawing, Rect, String, Line, Polygon

OUT = r"C:\Users\HP\OneDrive\Desktop\GRC 1\Access_Review_Stages.pdf"

AMBER, AMBER_L = colors.HexColor("#B5710F"), colors.HexColor("#FCEED6")
VIOLET, VIOLET_L = colors.HexColor("#4A41A8"), colors.HexColor("#ECEAFB")
BLUE, BLUE_L = colors.HexColor("#155A9C"), colors.HexColor("#E2EFFB")
GREEN, GREEN_L = colors.HexColor("#1D9E75"), colors.HexColor("#E1F5EE")
INDIGO, INDIGO_L = colors.HexColor("#6366F1"), colors.HexColor("#EEF2FF")
SLATE, SLATE_L = colors.HexColor("#334155"), colors.HexColor("#F1F5F9")
INK = colors.HexColor("#1F2933")
GREY = colors.HexColor("#5F5E5A")
GREY2 = colors.HexColor("#94A3B8")
ARROW = colors.HexColor("#7C7B76")
WHITE = colors.white

STAGE = {1: (GREEN, GREEN_L), 2: (INDIGO, INDIGO_L), 3: (AMBER, AMBER_L),
         4: (BLUE, BLUE_L), 5: (VIOLET, VIOLET_L), 6: (SLATE, SLATE_L)}

styles = getSampleStyleSheet()
H = ParagraphStyle("H", parent=styles["Normal"], fontName="Helvetica-Bold", fontSize=11, textColor=INK)
BODY = ParagraphStyle("BODY", parent=styles["Normal"], fontName="Helvetica", fontSize=9.5, leading=13.5, textColor=INK)
WH = ParagraphStyle("WH", parent=BODY, textColor=WHITE, fontName="Helvetica-Bold", fontSize=9)
CAP = ParagraphStyle("CAP", parent=BODY, fontSize=8.5, textColor=GREY)
ONELINE = ParagraphStyle("ONE", parent=BODY, fontSize=10.5, leading=14, fontName="Helvetica-Oblique")


# ---------- reportlab vector helpers ----------
def _box(d, x, y, w, h, lines, fill, stroke):
    d.add(Rect(x, y, w, h, rx=5, ry=5, fillColor=fill, strokeColor=stroke, strokeWidth=1))
    lh = max((s for _, _, _, s in lines), default=8) + 2.5
    start = y + h / 2 + (len(lines) - 1) * lh / 2 - 2
    for i, (txt, bold, col, sz) in enumerate(lines):
        d.add(String(x + w / 2, start - i * lh, txt,
                     fontName="Helvetica-Bold" if bold else "Helvetica",
                     fontSize=sz, fillColor=col, textAnchor="middle"))


def _arrow(d, x1, y, x2, vertical=False, ytop=None):
    if vertical:
        d.add(Line(x1, y, x1, ytop + 4, strokeColor=ARROW, strokeWidth=1.1))
        d.add(Polygon([x1 - 3, ytop + 5, x1 + 3, ytop + 5, x1, ytop], fillColor=ARROW, strokeColor=None))
    else:
        d.add(Line(x1, y, x2 - 4, y, strokeColor=ARROW, strokeWidth=1.1))
        d.add(Polygon([x2 - 5, y - 3, x2 - 5, y + 3, x2, y], fillColor=ARROW, strokeColor=None))


def stage_flow(in_l, act_l, out_l, color, light):
    d = Drawing(470, 56)
    _box(d, 0, 9, 138, 40, in_l, SLATE_L, GREY2)
    _arrow(d, 138, 29, 166)
    _box(d, 166, 9, 138, 40, act_l, light, color)
    _arrow(d, 304, 29, 332)
    _box(d, 332, 9, 138, 40, out_l, SLATE_L, GREY2)
    return d


def pipeline_dg():
    d = Drawing(490, 48)
    items = [(1, "Populate"), (2, "Sample"), (3, "Run Checks"),
             (4, "Certify"), (5, "Report"), (6, "Close")]
    x = 0
    for i, (n, lbl) in enumerate(items):
        c, l = STAGE[n]
        _box(d, x, 6, 70, 36, [(f"{n}  {lbl}", True, c, 8)], l, c)
        if i < 5:
            _arrow(d, x + 70, 24, x + 84)
        x += 84
    return d


def arch_dg():
    W, Hc = 496, 470
    d = Drawing(W, Hc)

    def T(top, h):
        return Hc - top - h
    # band labels
    def lab(top, t):
        d.add(String(0, T(top, 0) - 2, t, fontName="Helvetica-Bold", fontSize=7.5, fillColor=GREY))
    # Sources -> population
    lab(0, "STAGE 1  SOURCES  >  POPULATION")
    _box(d, 0, T(12, 34), 210, 34, [("Microsoft Entra ID  (Graph API)", True, colors.HexColor("#0F6E56"), 8),
                                     ("production - read-only", False, GREY, 6.5)], GREEN_L, GREEN)
    _box(d, 0, T(52, 34), 210, 34, [("Test Data  (Generate / CSV)", True, colors.HexColor("#6B4A12"), 8),
                                    ("testing - no Microsoft", False, GREY, 6.5)], AMBER_L, AMBER)
    _box(d, 300, T(12, 74), 196, 74, [("grc_users", True, VIOLET, 10), ("the population", False, INK, 7.5),
                                      ("both sources fill it", False, GREY, 6.5)], VIOLET_L, VIOLET)
    _arrow(d, 210, T(29, 0), 298)
    _arrow(d, 210, T(69, 0), 298)
    # Frontend
    lab(102, "PRESENTATION")
    _box(d, 0, T(114, 38), W, 38, [("Next.js Frontend  -  dashboard - workflow - SoD - test data - export", True, colors.HexColor("#3730A3"), 8.5)], INDIGO_L, INDIGO)
    _arrow(d, W / 2, T(152, 0), 0, vertical=True, ytop=T(168, 0))
    # API
    lab(158, "APPLICATION  ·  API (admin-gated, per-tenant)")
    _box(d, 0, T(170, 48), W, 48, [("FastAPI  access_review_router", True, BLUE, 9),
                                   ("1 sync  2 sample  3 run-checks  4 decision  5 report  6 close", False, BLUE, 7.5)], BLUE_L, BLUE)
    _arrow(d, W / 2, T(218, 0), 0, vertical=True, ytop=T(234, 0))
    # Modules
    lab(224, "DOMAIN LOGIC")
    mods = ["enrichment", "sampling", "checks (6 rules)", "export"]
    bw = (W - 3 * 8) / 4
    for i, m in enumerate(mods):
        _box(d, i * (bw + 8), T(236, 34), bw, 34, [(m, True, BLUE, 8)], colors.HexColor("#F4F8FC"), BLUE)
    _arrow(d, W / 2, T(270, 0), 0, vertical=True, ytop=T(286, 0))
    # Data
    lab(276, "DATA  ·  per-tenant PostgreSQL")
    _box(d, 0, T(288, 44), W, 44, [("campaigns > items (immutable snapshot) > findings · sod_rules · escalations", True, SLATE, 8),
                                   ("+ grc_users (population) · reused: roles / user_roles / evidence", False, GREY, 7)], SLATE_L, SLATE)
    # Pipeline
    lab(344, "PROCESS  ·  the 6 stages  >  audit evidence")
    items = [(1, "Populate"), (2, "Sample"), (3, "Checks"), (4, "Certify"), (5, "Report"), (6, "Close")]
    pw = (W - 5 * 6) / 6
    x = 0
    for i, (n, lbl) in enumerate(items):
        c, l = STAGE[n]
        _box(d, x, T(356, 32), pw, 32, [(f"{n} {lbl}", True, c, 7.5)], l, c)
        x += pw + 6
    return d


def lens(label, color, light, text):
    t = Table([[Paragraph(label, WH), Paragraph(text, BODY)]], colWidths=[26 * mm, 150 * mm])
    t.setStyle(TableStyle([("BACKGROUND", (0, 0), (0, 0), color), ("BACKGROUND", (1, 0), (1, 0), light),
                           ("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 8),
                           ("RIGHTPADDING", (0, 0), (-1, -1), 8), ("TOPPADDING", (0, 0), (-1, -1), 7),
                           ("BOTTOMPADDING", (0, 0), (-1, -1), 7), ("LINEBELOW", (0, 0), (-1, -1), 3, WHITE)]))
    return t


def header(n, title, color):
    t = Table([[Paragraph(f"STAGE {n}" if n else "", WH),
                Paragraph(title, ParagraphStyle("SH", parent=WH, fontSize=14))]], colWidths=[28 * mm, 148 * mm])
    t.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), color), ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                           ("LEFTPADDING", (0, 0), (-1, -1), 10), ("TOPPADDING", (0, 0), (-1, -1), 9),
                           ("BOTTOMPADDING", (0, 0), (-1, -1), 9), ("LINEAFTER", (0, 0), (0, 0), 2, WHITE)]))
    return t


def kv(label, value):
    t = Table([[Paragraph(f"<b>{label}</b>", CAP), Paragraph(value, BODY)]], colWidths=[30 * mm, 146 * mm])
    t.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), SLATE_L), ("VALIGN", (0, 0), (-1, -1), "TOP"),
                           ("LEFTPADDING", (0, 0), (-1, -1), 8), ("TOPPADDING", (0, 0), (-1, -1), 5),
                           ("BOTTOMPADDING", (0, 0), (-1, -1), 5)]))
    return t


def stage_page(n, title, oneliner, flow, business, logical, technical, datain, dataout, status, extra=None):
    c, l = STAGE[n]
    s = [header(n, title, c), Spacer(1, 6), Paragraph(f'"<i>{oneliner}</i>"', ONELINE), Spacer(1, 8),
         flow, Spacer(1, 10),
         lens("BUSINESS<br/>why", AMBER, AMBER_L, business), Spacer(1, 5),
         lens("LOGICAL<br/>what", VIOLET, VIOLET_L, logical), Spacer(1, 5),
         lens("TECHNICAL<br/>how", BLUE, BLUE_L, technical), Spacer(1, 10)]
    if extra:
        s += extra + [Spacer(1, 8)]
    s += [kv("Data in", datain), Spacer(1, 3), kv("Data out", dataout), Spacer(1, 3), kv("Status", status)]
    return s


story = []
# ---------- COVER ----------
story += [Spacer(1, 44 * mm),
          Paragraph("Access Review", ParagraphStyle("CT", parent=styles["Title"], fontSize=34, textColor=INK, leading=38)),
          Paragraph("User-Access Certification - the 6 stages, end to end",
                    ParagraphStyle("CS", parent=BODY, fontSize=14, textColor=GREY, spaceBefore=6)),
          Spacer(1, 10), HRFlowable(width="100%", thickness=2, color=BLUE), Spacer(1, 14),
          Paragraph("Each page covers one stage in the business, logical and technical view together, with "
                    "a flow diagram. The same pipeline runs on real Microsoft Entra data or on test data; "
                    "only Stage 1's source differs.", ParagraphStyle("CB", parent=BODY, fontSize=11, leading=16)),
          Spacer(1, 22), pipeline_dg(), PageBreak()]

# ---------- ARCHITECTURE ----------
story += [header(0, "End-to-End Architecture", BLUE), Spacer(1, 10), arch_dg(), Spacer(1, 12),
          Paragraph("<b>How to read it:</b> two Stage-1 sources (Microsoft Entra in production, or Test Data in "
                    "testing) fill one table - grc_users. The Next.js frontend calls an admin-gated, per-tenant "
                    "FastAPI router, which drives four modules over a per-tenant PostgreSQL store. The six-stage "
                    "process turns the population into a verdict and exportable audit evidence. Everything below "
                    "the population is identical whether the data is real or test - which is why the control can "
                    "be fully validated before connecting Microsoft.", BODY), PageBreak()]

# ---------- STAGE 1 ----------
story += stage_page(
    1, "Build Population", "You can't certify access you can't see - so first, gather everyone.",
    stage_flow([("Entra / Test Data", True, INK, 8)],
               [("Sync / Generate", True, GREEN, 8.5), ("Stage 1", False, GREY, 6.5)],
               [("grc_users", True, VIOLET, 8.5), ("population", False, GREY, 6.5)], GREEN, GREEN_L),
    "A regulator or auditor (ISO 27001, SOC 2, NDMO) requires periodic proof that access is correct. The "
    "starting point is the single authoritative list of who has access today.",
    "Pull every user plus their access attributes into one population - the universe to be reviewed. The "
    "population can be scoped by review type: all users, privileged only, or terminated only.",
    "<b>Production:</b> POST /sync-population calls enrichment.sync_population(), reading Microsoft Entra "
    "via Graph API (app-only OAuth2, read-only, admin-consented) and enriching grc_users (mfa_enabled, "
    "account_enabled, entra_last_sign_in, termination_date, department). <b>Testing:</b> "
    "POST /test-population/generate or /import fills grc_users directly. build_population(review_type) scopes it.",
    "Microsoft Entra directory (prod) OR generated/CSV mock users (test).",
    "grc_users (enriched population); campaign.population_size.",
    "draft  ->  population_built")
story.append(PageBreak())

# ---------- STAGE 2 ----------
story += stage_page(
    2, "Draw Sample", "Checking everyone is too costly - scoop a fair, reproducible handful, and freeze it.",
    stage_flow([("grc_users", True, INK, 8), ("population", False, GREY, 6.5)],
               [("Draw Sample", True, INDIGO, 8.5), ("stride (reproducible)", False, GREY, 6.5)],
               [("items", True, VIOLET, 8.5), ("snapshot", False, GREY, 6.5)], INDIGO, INDIGO_L),
    "Reviewing all N-thousand users by hand is impractical; auditors accept a representative sample that "
    "deliberately includes the risky accounts (admins, leavers).",
    "Pick a defensible subset - random, risk-based or full - then take a point-in-time snapshot of each "
    "chosen user, so the audit shows what their access looked like on the review date.",
    "POST /sample calls sampling.draw_sample(): a deterministic stride (not random shuffle) so the same "
    "population always yields the same sample - reproducible and defensible. Each user is frozen into an "
    "AccessReviewItem (roles, mfa, account, last_sign_in, termination, is_privileged); tier-1 reviewer = "
    "creator. Re-running replaces the prior sample (idempotent).",
    "grc_users (population, scoped by review type).",
    "access_review_items - one immutable snapshot row per sampled user.",
    "population_built  ->  sampled")
story.append(PageBreak())

# ---------- STAGE 3 ----------
rules = [["Rule", "Fires when", "Reads", "Sev"],
         ["mfa_missing", "active account, no MFA", "Entra MFA report", "High"],
         ["ghost_account", "terminated but still enabled", "Entra leave date", "Crit"],
         ["stale_account", "no sign-in 90+ days (or never)", "Entra sign-in", "Med"],
         ["over_privileged", "admin role outside IT/Security", "RBAC + dept", "High"],
         ["sod_conflict", "holds both roles of a SoD rule", "user_roles + SoD", "High"],
         ["no_approval", "role with no approver/source", "user_roles", "Low"]]
rt = Table(rules, colWidths=[30 * mm, 60 * mm, 50 * mm, 14 * mm])
rt.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, 0), AMBER), ("TEXTCOLOR", (0, 0), (-1, 0), WHITE),
                        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"), ("FONTSIZE", (0, 0), (-1, -1), 8),
                        ("FONTNAME", (0, 1), (0, -1), "Courier"), ("FONTSIZE", (0, 1), (0, -1), 7.5),
                        ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#CBD5E1")),
                        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [WHITE, colors.HexColor("#F8FAFC")]),
                        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"), ("TOPPADDING", (0, 0), (-1, -1), 4),
                        ("BOTTOMPADDING", (0, 0), (-1, -1), 4), ("LEFTPADDING", (0, 0), (-1, -1), 5)]))
story += stage_page(
    3, "Run Checks", "Let the machine flag the risky access - every sampled user, six rules, one pass.",
    stage_flow([("items + RBAC", True, INK, 8), ("+ SoD rules", False, GREY, 6.5)],
               [("Run Checks", True, AMBER, 8.5), ("6 rules", False, GREY, 6.5)],
               [("findings", True, VIOLET, 8.5), ("severity-tagged", False, GREY, 6.5)], AMBER, AMBER_L),
    "Surface real risk fast: terminated users still active, accounts with no MFA, toxic role combinations, "
    "over-privilege - the work an auditor would otherwise do by hand.",
    "Run every sampled snapshot through six fixed control rules in one pass. Each rule that fires raises an "
    "exception (a finding) tagged with a severity. One user can trip several at once.",
    "POST /run-checks calls checks.run_checks(): clears prior findings (idempotent), loads active SoD rules "
    "and RBAC assignments, evaluates the six rules per item, and writes an AccessReviewFinding for each hit. "
    "The machine only flags - it never decides (that is Stage 4).",
    "access_review_items + RBAC (roles, user_roles) + sod_rules.",
    "access_review_findings; campaign.exceptions_found.",
    "sampled  ->  in_review",
    extra=[Paragraph("<b>The six rules</b>", H), Spacer(1, 3), rt])
story.append(PageBreak())

# ---------- STAGE 4 ----------
story += stage_page(
    4, "Certify", "A named human owns each decision - keep, cut, or known-exception - on the record.",
    stage_flow([("items + findings", True, INK, 8)],
               [("Certify (human)", True, BLUE, 8.5), ("approve/revoke/except", False, GREY, 6.2)],
               [("decisions", True, VIOLET, 8.5), ("+ evidence", False, GREY, 6.5)], BLUE, BLUE_L),
    "Accountability. A machine cannot be accountable; an auditor wants a named person to put their name on "
    "each user's access, backed by evidence.",
    "A reviewer rules on each user: Approve (keep), Revoke (remove), or Exception (known, accepted - note "
    "why). Findings can be triaged (remediated / accepted-risk / false-positive). Overdue items escalate up "
    "the approver chain.",
    "POST /items/{id}/decision records decision, comment, decision_by, decision_at. "
    "POST /items/{id}/evidence attaches proof. PATCH /findings/{id} triages a finding. /escalation-chain "
    "defines tiers; /escalate-overdue bumps still-pending items to the next approver past the due date.",
    "access_review_items + access_review_findings.",
    "decisions (+ who/when), evidence files, finding statuses, escalations.",
    "in_review (per-item decisions accumulate)")
story.append(PageBreak())

# ---------- STAGE 5 ----------
story += stage_page(
    5, "Report", "Boil the review down to one grade plus a downloadable audit artifact.",
    stage_flow([("items + findings", True, INK, 8)],
               [("Aggregate", True, VIOLET, 8.5), ("open findings only", False, GREY, 6.5)],
               [("verdict", True, VIOLET, 8.5), ("CSV/XLSX/PDF", False, GREY, 6.5)], VIOLET, VIOLET_L),
    "Produce the artifact and verdict to hand the regulator: how many checked, how many exceptions, what "
    "kind, and an overall effectiveness grade.",
    "Aggregate every ruling and finding into a verdict. Only OPEN findings count - triaged ones are treated "
    "as handled, so working findings down improves the grade.",
    "GET /report calls _build_report(): tallies by type and severity, computes users-with-open-exceptions "
    "and the verdict - effective (none), deficient (up to ~1 in 10), or material_weakness (more). "
    "GET /report/export?format=csv|xlsx|pdf renders the artifact via export.py. Read-only stage.",
    "access_review_items + access_review_findings.",
    "report JSON (verdict, coverage, breakdowns) + CSV / XLSX / PDF.",
    "in_review (read-only)")
story.append(PageBreak())

# ---------- STAGE 6 ----------
story += stage_page(
    6, "Close", "Sign, seal, file - freeze the review as tamper-proof audit evidence.",
    stage_flow([("the review", True, INK, 8)],
               [("Close", True, SLATE, 8.5), ("lock", False, GREY, 6.5)],
               [("completed", True, SLATE, 8.5), ("locked", False, GREY, 6.5)], SLATE, SLATE_L),
    "Lock the review so it stands as a permanent, dated record for the audit trail - the difference between "
    "a working draft and an official filed document.",
    "Freeze the campaign as the final, immutable record. An open review can still change; a closed one is "
    "fixed on a date with named sign-offs.",
    "POST /close records final tallies (items_reviewed, exceptions_found), stamps closed_at, sets status = "
    "completed. A guard (_assert_not_completed) then blocks every mutation - sync, sample, run-checks, "
    "decision, escalate - returning HTTP 400 'Campaign is completed and locked'.",
    "access_review_items + access_review_findings.",
    "completed campaign (locked); cached tallies; closed_at.",
    "in_review  ->  completed (locked)")
story.append(PageBreak())

# ---------- ASSURANCE ----------
story += [header(0, "Assurance & Test Strategy", BLUE), Spacer(1, 10)]
for label, text in [
    ("ACCESS", "Every endpoint is admin-gated via SSO; only admins can run reviews."),
    ("ISOLATION", "One PostgreSQL database per customer - no cross-tenant access."),
    ("LEAST PRIV", "Microsoft Entra access is app-only, read-only, admin-consented (read the directory; nothing else)."),
    ("TAMPER-PROOF", "Sampled items are immutable snapshots; a completed campaign is locked against all changes."),
    ("AUDIT TRAIL", "Every decision records who, when, the note and any evidence; the report carries a defensible verdict."),
    ("TESTABLE", "Stages 2-6 are identical for real or test data. Validated two ways: a full mock-data run produced "
                 "all six finding types; and a fixture test feeds a recorded Microsoft Graph payload through the real "
                 "mapping and asserts every grc_users field. So connecting real Entra is a low-risk config change."),
]:
    story += [lens(label, GREEN, GREEN_L, text), Spacer(1, 5)]
story += [Spacer(1, 4),
          Paragraph("Bottom line: the conceptual model and the running code match across all six stages, verified "
                    "end-to-end in the browser and by automated checks. Turning on real Microsoft Entra changes only "
                    "Stage 1's data source.", ParagraphStyle("BL", parent=BODY, fontSize=10, leading=14,
                    backColor=colors.HexColor("#FBF7EF"), borderPadding=8))]


def footer(canvas, doc):
    canvas.saveState(); canvas.setFont("Helvetica", 7.5); canvas.setFillColor(GREY)
    canvas.drawString(20 * mm, 12 * mm, "Access Review - User-Access Certification")
    canvas.drawRightString(190 * mm, 12 * mm, f"Page {doc.page}")
    canvas.restoreState()


doc = SimpleDocTemplate(OUT, pagesize=A4, leftMargin=18 * mm, rightMargin=18 * mm,
                        topMargin=16 * mm, bottomMargin=18 * mm, title="Access Review - the 6 stages")
doc.build(story, onFirstPage=footer, onLaterPages=footer)
print("WROTE:", OUT)
