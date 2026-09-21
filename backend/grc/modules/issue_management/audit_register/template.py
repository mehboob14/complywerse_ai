"""The client's audit register workbook, described once.

The pack holds one register in four column layouts — regulatory findings,
internal-audit issues and recommendations, the closed / IT archive, and
self-identified events — plus a SUMMARY roll-forward.

Columns are matched on normalised header text, so the spacing the file carries
("Report  Date", "Status (NS/IP/DE/ PD/ EXT/CD )") need not be reproduced, and a
header the client tweaks slightly still lands in the right field. A layout is
never matched by column position: sheets carry pivot tables above the register,
and the archive sheets differ by a column or two between versions.
"""
from __future__ import annotations

import re
from typing import Any, Dict, List, Optional, Tuple


def norm(text: Any) -> str:
    """Normalise a header: "Report  Date" and "report date" both give "report date".

    "#" becomes "num" first, because "Issue #" (the reference) and "Issue" (the
    finding itself) are different columns on the regulatory sheet.
    """
    return re.sub(r"[^a-z0-9]+", " ", str(text or "").replace("#", " num ").lower()).strip()


# Header as the workbook writes it -> field name. Fields map to AuditIssueProfile,
# except `title`, which is the Issue's own title.
_HEADERS: Dict[str, str] = {
    # ── where it came from ───────────────────────────────────────────────────
    "Source (Mercadien/ EY)": "source_label",
    "Source": "source_label",
    "Regulator": "regulator",
    "TYPE OF AUDIT": "type_of_audit",
    "Report #": "report_number",
    "Report Number": "report_number",
    "Report Name": "report_name",
    "Audit Report Name": "report_name",
    "Report Date": "report_date",
    "Audit Report Date": "report_date",
    "Engagement Year": "engagement_year",
    "Project Name-Year (20XX)": "project_name",
    "Issue #": "issue_ref",
    "Issue ID": "issue_ref",
    "Issue / Recommendation": "record_type_raw",
    "Recommendation State": "recommendation_state",
    "As of Date": "as_of_date",
    "Date Received": "date_received",
    # ── the finding ──────────────────────────────────────────────────────────
    "Issue Name": "title",
    "Issue Subject": "title",
    "Issue": "issue_text",
    "Description": "issue_text",
    "Condition": "condition",
    "Risk": "risk_text",
    "Impact": "impact_text",
    "Causes": "causes",
    "Consequences": "consequences",
    "Counsel": "counsel",
    "Risk Rating": "risk_rating",
    "Relative Risk": "risk_rating",
    "Risk Level": "risk_rating",
    # ── what is being done ───────────────────────────────────────────────────
    "Recommendation": "recommendation",
    "Recommendation Title": "recommendation_title",
    "Corrective Actions": "corrective_actions",
    "Management Action Plan": "management_action_plan",
    "Management Response": "management_response",
    "Actions to Address Event": "actions_to_address",
    # ── who owns it ──────────────────────────────────────────────────────────
    "Owner": "owner_name_raw",
    "OWNER": "owner_name_raw",
    "Title": "owner_title",
    "LOB": "lob",
    "Line of Business": "lob",
    "Business Unit": "business_unit",
    "Executive": "executive",
    # ── dates and aging ──────────────────────────────────────────────────────
    "Date": "event_date",
    "Target Date": "target_date",
    "Original Target Date": "target_date",
    "Revised Target Date": "revised_target_date",
    "# extensions": "extensions_count",
    "Days Past Due": "days_past_due",
    "Aged Days from Target": "aged_days_from_target",
    "Aged status": "aged_status",
    # ── status and the validation Audit Services owns ────────────────────────
    "Management Reported Status": "management_reported_status",
    "Management Self-Reported Status": "management_reported_status",
    "Status (NS/IP/DE/ PD/ EXT/CD )": "ia_status",
    "Status (NS/IP/DE/ PD/ EXT/ CD)": "ia_status",
    "Issue Resolution Status Update": "resolution_status",
    "Issue Resolution Status Update (OPEN OR CLOSED)": "resolution_status",
    "REMEDIATION STATUS (NOT STARTED / IN PROGRESS / DELAYED / COMPLETED)": "remediation_status",
    "REMEDIATION TYPE": "remediation_type",
    "Current Internal Status": "current_internal_status",
    "VALIDATION STATUS (NOT STARTED/ IN PROGRESS/ CLOSED)": "validation_status",
    "Validation Pass/Fail": "validation_pass_fail",
    "Date of Validation by CFSB IA": "validated_on",
    "VALIDATION PERFORMED BY: EY/CIAO/TBD/NA-CLOSED": "validation_performed_by",
    "Validation Start": "validation_started_on",
    "Validation Completed": "validation_completed_on",
    "Source of Validation Materials": "validation_materials_source",
    "LOCATION OF ISSUE VALIDATION": "validation_location",
    "COMMENTS (EXPLAIN ISSUE AND VALIDATION STATUS OR RATIONALE FOR CLOSED)": "comments",
    "Notes": "notes",
    # ── IT findings ──────────────────────────────────────────────────────────
    "ISSUE OR VULNERABILITY (FOR IT ONLY)": "it_record_kind",
    "Affected Hosts": "affected_hosts",
    "Location": "location",
    # ── self-identified events ───────────────────────────────────────────────
    "Category (Fin/Ops/Reg/IT)": "self_id_category",
    "Monetary Impact": "monetary_impact",
    "Impact to Client": "impact_to_client",
}

FIELD_BY_HEADER: Dict[str, str] = {}
for _header, _field in _HEADERS.items():
    FIELD_BY_HEADER.setdefault(norm(_header), _field)

# A header the archive layout uses twice: the second "Owner" sits in the
# validation block and names whoever validated, not who owns the remediation.
FIELD_BY_REPEATED_HEADER: Dict[Tuple[str, int], str] = {("owner", 2): "validation_owner"}

# Headers whose text starts the same way in every version of the file; the long
# parenthesised ones above get abbreviated by hand from time to time.
_PREFIX_HEADERS = [
    ("comments explain issue", "comments"),
    ("remediation status", "remediation_status"),
    ("validation status", "validation_status"),
    ("validation performed by", "validation_performed_by"),
    ("issue or vulnerability", "it_record_kind"),
    ("status ns ip de pd ext", "ia_status"),
    ("issue resolution status", "resolution_status"),
    ("category fin ops reg it", "self_id_category"),
]

DATE_FIELDS = {
    "report_date", "target_date", "revised_target_date", "validated_on",
    "validation_started_on", "validation_completed_on", "as_of_date",
    "date_received", "event_date",
}
INT_FIELDS = {"extensions_count", "days_past_due", "aged_days_from_target"}
DECIMAL_FIELDS = {"monetary_impact"}


def field_for(header: Any, seen: Dict[str, int]) -> Optional[str]:
    """Field for a header cell, counting repeats so the second "Owner" differs."""
    key = norm(header)
    if not key:
        return None
    seen[key] = seen.get(key, 0) + 1
    if (key, seen[key]) in FIELD_BY_REPEATED_HEADER:
        return FIELD_BY_REPEATED_HEADER[(key, seen[key])]
    if key in FIELD_BY_HEADER:
        return FIELD_BY_HEADER[key] if seen[key] == 1 else None
    for prefix, field in _PREFIX_HEADERS:
        if key.startswith(prefix):
            return field
    return None


# ── sheets ───────────────────────────────────────────────────────────────────
# Prefix match on the normalised sheet name: the file ships "IA-EY Issue " with a
# trailing space, and the closed sheets carry the cut-off date in their names.
SHEET_RULES = [
    # (name prefix, kind, source, record_type)
    ("summary", "summary", None, None),
    ("regulatory", "register", "regulator", "issue"),
    ("ia mercadien", "register", "mercadien", "issue"),
    ("ia ey recommendation", "register", "ey", "recommendation"),
    ("ia ey issue", "register", "ey", "issue"),
    ("issueclosed", "register", None, None),   # source and type come from the row
    ("it pen", "register", "it_pen", None),
    ("self id", "register", "self_id", "issue"),
    # Not in the pack yet; its SUMMARY column is. Read in the IA layout until
    # the client's own sheet shows its columns.
    ("credit review", "register", "credit_review", "issue"),
]

SOURCES = ("regulator", "mercadien", "ey", "internal_audit", "self_id", "it_pen", "credit_review")

# The SUMMARY sheet's column headings, in its order.
SOURCE_TITLES = {
    "regulator": "Regulator",
    "mercadien": "CFSB Audit-Mercadien",
    "ey": "CFSB Audit-EY",
    "internal_audit": "Internal Audit",
    "self_id": "Self Identified",
    "it_pen": "IT Pen Test",
    "credit_review": "Credit Reviews",
}

# The SUMMARY sheet counts issues under these headings.
SOURCE_BY_SUMMARY_COLUMN = {
    "regulator": "regulator",
    "cfsb audit mercadien": "mercadien",
    "cfsb audit ey": "ey",
    "self identified": "self_id",
    "it pen test": "it_pen",
    "credit reviews": "credit_review",
}

# What a row says about its own origin, for sheets that mix sources.
SOURCE_BY_LABEL = {
    "ey": "ey",
    "mercadien": "mercadien",
    "occ": "regulator",
    "fdic": "regulator",
    "regulator": "regulator",
    "regulatory": "regulator",
    "self id": "self_id",
    "self identified": "self_id",
    "independent review": "it_pen",
    "penetration test": "it_pen",
    "pen test": "it_pen",
    "internal audit report": "internal_audit",
    "cfsb ia": "internal_audit",
    "internal audit": "internal_audit",
    "credit review": "credit_review",
}

SUMMARY_ROWS = {
    "beginning number of issues": "beginning",
    "add issues opened this month": "opened",
    "less issues closed this month": "closed",
    "ending number of issues": "ending",
    "recommendations not tracked": "recommendations",
}
# The status × source table further down the SUMMARY sheet.
SUMMARY_STATUS_ROWS = {
    "not started": "NS",
    "in progress": "IP",
    "delayed": "DE",
    "past due": "PD",
    "extension": "EXT",
    "total open issues": "open",
}

# The pack's status rows, in the client's order and words.
STATUS_LABELS = {
    "NS": "Not Started",
    "IP": "In Progress",
    "DE": "Delayed",
    "PD": "Past Due",
    "EXT": "Extension",
    "unstated": "Other or no status",   # RM, N/A, blank — ours, so the totals still add up
}

# "Past Due: Action Plan has not been …" — the status definitions each sheet
# carries above its header. Read from the file, so they stay the client's words.
STATUS_DEFINITION_TERMS = {
    "complete": "COMPLETE",
    "not started": "NS",
    "in progress": "IP",
    "delayed": "DE",
    "past due": "PD",
    "extension": "EXT",
    "closed": "CD",
}

# ── the client's vocabulary, mapped onto the platform's ──────────────────────
# Issue workflow states: new, triage, in_progress, resolution, closure_review,
# closed, cancelled. The register's own code is always kept verbatim as well.
WORKFLOW_BY_IA_STATUS = {
    "NS": "new",          # not started
    "IP": "in_progress",
    "DE": "in_progress",  # delayed — validation needs more material
    "PD": "in_progress",  # past due — the aging fields carry the detail
    "EX": "in_progress",  # extension approved
    "EXT": "in_progress",
    "CD": "closed",
    "CL": "closed",
    "COMPLETE": "closed",
    "CLOSED": "closed",
}
WORKFLOW_BY_REMEDIATION_STATUS = {
    "NOT STARTED": "new",
    "IN PROGRESS": "in_progress",
    "DELAYED": "in_progress",
    "COMPLETED": "closure_review",   # done, but Audit Services has not signed it off
}
WORKFLOW_BY_RECOMMENDATION_STATE = {
    "CLOSED-VALIDATED": "closed",
    "CLOSED-PENDING VALIDATION": "closure_review",
}
VALIDATION_STATUS_CLOSES = {"CLOSED"}
MANAGEMENT_REPORTS_DONE = {"COMPLETED", "COMPLETE", "SUBMITTED FOR VALIDATION"}

SEVERITY_BY_RISK_RATING = {
    "CRITICAL": "critical",
    "HIGH": "high",
    "MODERATE": "medium",
    "MEDIUM": "medium",
    "LOW": "low",
    "INFORMATIONAL": "informational",
}


# ── the edit form: each sheet layout's own fields, in its own order ──────────
# A finding shows and edits only the columns its sheet has — a regulatory MRA
# has no affected hosts, a self-identified event no report number. Labels are
# the client's header wording. Kinds drive the input: text, long (textarea),
# date, int, money, choice (fixed list), pick (values already in the register),
# user (a platform user), and title (the issue's own title).
FIELD_SPEC: Dict[str, Tuple[str, str, str]] = {
    # field: (label, group, kind)
    "regulator": ("Regulator", "Where it came from", "pick"),
    "source_label": ("Source", "Where it came from", "pick"),
    "type_of_audit": ("Type of audit", "Where it came from", "pick"),
    "report_number": ("Report #", "Where it came from", "text"),
    "report_name": ("Report name", "Where it came from", "pick"),
    "report_date": ("Report date", "Where it came from", "date"),
    "engagement_year": ("Engagement year", "Where it came from", "text"),
    "project_name": ("Project name-year", "Where it came from", "pick"),
    "record_type": ("Issue / Recommendation", "Where it came from", "choice"),
    "recommendation_state": ("Recommendation state", "Validation", "choice"),
    "issue_ref": ("Issue #", "Where it came from", "text"),
    "as_of_date": ("As of date", "Dates and aging", "date"),
    "date_received": ("Date received", "Validation", "date"),
    "title": ("Issue name", "The finding", "title"),
    "risk_rating": ("Risk rating", "The finding", "choice"),
    "issue_text": ("Issue", "The finding", "long"),
    "condition": ("Condition", "The finding", "long"),
    "risk_text": ("Risk", "The finding", "long"),
    "impact_text": ("Impact", "The finding", "long"),
    "causes": ("Causes", "The finding", "long"),
    "consequences": ("Consequences", "The finding", "long"),
    "counsel": ("Counsel", "The response", "long"),
    "recommendation_title": ("Recommendation title", "The response", "long"),
    "recommendation": ("Recommendation", "The response", "long"),
    "corrective_actions": ("Corrective actions", "The response", "long"),
    "management_action_plan": ("Management action plan", "The response", "long"),
    "management_response": ("Management response", "The response", "long"),
    "actions_to_address": ("Actions to address event", "The response", "long"),
    "owner": ("Owner", "Ownership", "user"),
    "owner_title": ("Title", "Ownership", "pick"),
    "lob": ("LOB", "Ownership", "pick"),
    "business_unit": ("Business unit", "Ownership", "pick"),
    "executive": ("Executive", "Ownership", "text"),
    "event_date": ("Date", "Dates and aging", "date"),
    "target_date": ("Target date", "Dates and aging", "date"),
    "revised_target_date": ("Revised target date", "Dates and aging", "date"),
    "extensions_count": ("# extensions", "Dates and aging", "int"),
    "days_past_due": ("Days past due", "Dates and aging", "int"),
    "aged_days_from_target": ("Aged days from target", "Dates and aging", "int"),
    "aged_status": ("Aged status", "Dates and aging", "choice"),
    "management_reported_status": ("Management reported status", "Validation", "long"),
    "ia_status": ("Status (NS/IP/DE/PD/EXT/CD)", "Validation", "choice"),
    "resolution_status": ("Issue resolution status update", "Validation", "long"),
    "remediation_status": ("Remediation status", "Validation", "choice"),
    "remediation_type": ("Remediation type", "Validation", "pick"),
    "validation_status": ("Validation status", "Validation", "choice"),
    "validation_pass_fail": ("Validation pass/fail", "Validation", "choice"),
    "validated_on": ("Date of validation by CFSB IA", "Validation", "date"),
    "validation_performed_by": ("Validation performed by", "Validation", "choice"),
    "validation_owner": ("Validation owner", "Validation", "text"),
    "validation_started_on": ("Validation start", "Validation", "date"),
    "validation_completed_on": ("Validation completed", "Validation", "date"),
    "validation_materials_source": ("Source of validation materials", "Validation", "long"),
    "validation_location": ("Location of issue validation", "Validation", "long"),
    "current_internal_status": ("Current internal status", "Validation", "pick"),
    "comments": ("Comments", "Validation", "long"),
    "notes": ("Notes", "Validation", "long"),
    "it_record_kind": ("Issue or vulnerability", "IT finding", "choice"),
    "location": ("Location", "IT finding", "text"),
    "affected_hosts": ("Affected hosts", "IT finding", "long"),
    "self_id_category": ("Category (Fin/Ops/Reg/IT)", "The finding", "choice"),
    "monetary_impact": ("Monetary impact", "The finding", "money"),
    "impact_to_client": ("Impact to client", "The finding", "long"),
}

# The columns each sheet layout carries, in the order the sheet has them.
LAYOUT_FIELDS: Dict[str, List[str]] = {
    "regulatory": [
        "regulator", "report_number", "report_name", "report_date", "issue_ref", "risk_rating",
        "title", "issue_text", "causes", "consequences", "corrective_actions",
        "management_action_plan", "owner", "owner_title", "lob", "target_date",
        "revised_target_date", "management_reported_status", "validated_on", "ia_status",
        "validation_pass_fail", "resolution_status", "validation_materials_source",
    ],
    "internal_audit": [
        "source_label", "report_number", "report_name", "report_date", "issue_ref", "risk_rating",
        "title", "issue_text", "risk_text", "impact_text", "recommendation",
        "management_action_plan", "owner", "owner_title", "lob", "target_date",
        "revised_target_date", "extensions_count", "days_past_due", "management_reported_status",
        "validated_on", "ia_status", "validation_pass_fail", "resolution_status",
        "validation_materials_source",
    ],
    "archive": [
        "project_name", "issue_ref", "record_type", "recommendation_state", "source_label",
        "engagement_year", "as_of_date", "title", "condition", "risk_rating",
        "recommendation_title", "counsel", "management_response", "target_date",
        "revised_target_date", "aged_days_from_target", "aged_status", "lob", "business_unit",
        "owner", "type_of_audit", "comments", "remediation_status", "remediation_type",
        "it_record_kind", "validation_status", "validation_performed_by", "validation_owner",
        "date_received", "validation_started_on", "validation_completed_on",
        "validation_location", "current_internal_status", "notes", "location", "affected_hosts",
    ],
    "self_id": [
        "event_date", "lob", "executive", "self_id_category", "issue_text", "monetary_impact",
        "impact_to_client", "actions_to_address", "risk_rating", "title",
    ],
}


# The sheets a finding can be added on by hand, one form per sheet in that
# sheet's own columns: (key, label, sheet name, source, record type). The two
# closed archives are the workbook's history, not somewhere new work is logged.
ENTRY_TEMPLATES: List[Tuple[str, str, str, str, str]] = [
    ("regulatory", "Regulatory", "Regulatory", "regulator", "issue"),
    ("ia_mercadien", "IA-Mercadien", "IA-Mercadien", "mercadien", "issue"),
    ("ia_ey_issue", "IA-EY Issue", "IA-EY Issue", "ey", "issue"),
    ("ia_ey_recommendation", "IA-EY Recommendation", "IA-EY Recommendation", "ey", "recommendation"),
    ("it_pen", "IT Pen", "IT Pen", "it_pen", "issue"),
    ("self_id", "Self ID", "Self ID", "self_id", "issue"),
    ("credit_review", "Credit Reviews", "Credit Review", "credit_review", "issue"),
]
# Worked out from the dates, or by the extension step, rather than typed in.
ENTRY_COMPUTED = {"days_past_due", "aged_days_from_target", "aged_status", "extensions_count"}
# Which entry form a source's findings are added on.
ENTRY_TEMPLATE_BY_SOURCE = {"regulator": "regulatory", "mercadien": "ia_mercadien", "ey": "ia_ey_issue",
                            "it_pen": "it_pen", "self_id": "self_id", "credit_review": "credit_review"}


# Header text for a field, for a blank template when no workbook has been
# uploaded yet (with one, its own header rows are reproduced instead). The
# first spelling in _HEADERS, with each sheet layout's own words where they differ.
_HEADER_BY_LAYOUT: Dict[str, Dict[str, str]] = {
    "regulatory": {"report_date": "Report  Date"},
    "internal_audit": {"source_label": "Source (Mercadien/ EY)", "report_number": "Report Number",
                       "report_name": "Audit Report Name", "report_date": "Audit Report Date"},
    "archive": {"issue_ref": "Issue ID", "title": "Issue Subject", "risk_rating": "Relative Risk",
                "target_date": "Original Target Date", "source_label": "Source"},
    "self_id": {"event_date": "Date", "lob": "Line of Business", "issue_text": "Description",
                "risk_rating": "Risk Level"},
}
_HEADER_FOR_FIELD = {"owner": "Owner", "record_type": "Issue / Recommendation",
                     "validation_owner": "Owner"}


def default_headers(layout: str) -> List[str]:
    first: Dict[str, str] = {}
    for text, field in _HEADERS.items():
        first.setdefault(field, text)
    words = {**first, **_HEADER_FOR_FIELD, **_HEADER_BY_LAYOUT.get(layout, {})}
    return [words[name] for name in LAYOUT_FIELDS[layout] if name in words]


def layout_for(source: Optional[str], source_sheet: Optional[str]) -> str:
    """Which sheet layout a finding came from, so it shows that sheet's columns."""
    sheet = norm(source_sheet)
    if sheet.startswith(("it pen", "issueclosed")) or source == "it_pen":
        return "archive"
    if source == "regulator":
        return "regulatory"
    if source == "self_id":
        return "self_id"
    return "internal_audit"


# Fixed vocabularies for the choice fields — the template's own codes.
CHOICES: Dict[str, List[str]] = {
    "ia_status": ["NS", "IP", "DE", "PD", "EXT", "CD"],
    "remediation_status": ["NOT STARTED", "IN PROGRESS", "DELAYED", "COMPLETED"],
    "validation_status": ["NOT STARTED", "IN PROGRESS", "CLOSED"],
    "validation_pass_fail": ["Pass", "Fail"],
    "validation_performed_by": ["EY", "CIAO", "TBD", "NA-CLOSED"],
    "risk_rating": ["High", "Moderate", "Medium", "Low"],
    "record_type": ["issue", "recommendation"],
    "recommendation_state": ["Open", "Closed-Pending Validation", "Closed-Validated"],
    "it_record_kind": ["ISSUE", "VULNERABILITY"],
    "self_id_category": ["Fin", "Ops", "Reg", "IT"],
    "aged_status": ["Current", "0-30", "31-60", "61-90", ">90"],
}
