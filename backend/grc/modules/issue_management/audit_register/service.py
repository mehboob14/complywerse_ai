"""Apply a parsed register workbook to the tenant's issues.

One register row becomes one Issue plus its AuditIssueProfile, so the finding is
tracked with everything Issues already provide — owner, actions, SLA, and links
to controls, risks, assets and vulnerabilities — while the client's own columns
stay readable exactly as they wrote them.

Re-uploading next month's pack updates the rows it already knows, keyed on
(source, record type, report, issue reference). Owner names are matched to
platform users; the ones that match nothing are reported rather than dropped, so
the import lands and the names get resolved afterwards.
"""
from __future__ import annotations

import re
from collections import Counter
from dataclasses import dataclass, field as dc_field
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy.orm import Session

from ....models import (AuditIssueProfile, AuditRegisterAlias, AuditRegisterImport, GRCUser, Issue,
                        IssueAction)
from ..services.code_generator import next_issue_code
from . import template as T
from .linkage import (
    build_asset_index, build_vendor_index, build_vulnerability_index, link_issue,
)
from .crosslinks import alias_key, sync_crosslinks
from .parser import ParsedWorkbook, RegisterRow

PROFILE_FIELDS = {c.name for c in AuditIssueProfile.__table__.columns}

# The register's own category words, mapped onto the platform's issue categories.
_CATEGORY_BY_SELF_ID = {"reg": "regulatory", "it": "security", "fin": "operations", "ops": "operations"}
_SOURCE_CATEGORY = {"regulator": "regulatory", "it_pen": "security"}


@dataclass
class ImportResult:
    import_id: Optional[int] = None
    created: int = 0
    updated: int = 0
    skipped: int = 0
    unmatched_owners: List[str] = dc_field(default_factory=list)
    warnings: List[str] = dc_field(default_factory=list)
    # Links made to the rest of the platform while importing.
    linked: Dict[str, int] = dc_field(default_factory=lambda: {"assets": 0, "vulnerabilities": 0, "vendors": 0})
    # Platform edits the file would have overwritten, left as they were.
    kept_edits: int = 0


# ── people ───────────────────────────────────────────────────────────────────

def _name_keys(text: str) -> set:
    """Keys a name can be matched on: "Rivera, P" → {"rivera p", "p rivera"}."""
    cleaned = re.sub(r"[^a-z0-9,\s@.]", " ", str(text or "").lower())
    cleaned = " ".join(cleaned.split())
    if not cleaned:
        return set()
    keys = {cleaned}
    if "," in cleaned:                                  # "Last, First" and "First Last"
        last, _, first = cleaned.partition(",")
        keys |= {f"{first.strip()} {last.strip()}".strip(), last.strip()}
    if "@" in cleaned:
        keys.add(cleaned.split("@")[0])
    return {k for k in keys if k}


def _user_keys(user: GRCUser) -> set:
    """Every way the register might name this user.

    The file writes "Rivera, P" or just "ROBIN", while the platform holds
    "Pat Rivera" and p.rivera@bank.example — so a user is indexed under their
    full name, surname, first name, and surname with a first initial.
    """
    keys = set()
    email_local = str(user.email or "").split("@")[0]
    for value in (str(getattr(user, "display_name", "") or ""), email_local):
        parts = [p for p in re.split(r"[^a-z0-9]+", value.lower()) if p]
        if not parts:
            continue
        keys.add(" ".join(parts))
        if len(parts) >= 2:
            first, last = parts[0], parts[-1]
            keys |= {last, first, f"{first[0]} {last}", f"{last} {first[0]}"}
        else:
            keys.add(parts[0])
    for value in (user.username, user.email):
        if value:
            keys.add(str(value).strip().lower())
    return {k for k in keys if len(k) > 2}


def build_owner_index(db: Session) -> Dict[str, int]:
    """Every way a tenant user can be addressed → their id.

    A key shared by two users is dropped: the register would not say which, and
    assigning a bank's audit finding to the wrong person is worse than leaving it
    unassigned for someone to set.
    """
    index: Dict[str, Any] = {}
    for user in db.query(GRCUser).all():
        for key in _user_keys(user):
            index[key] = user.id if index.get(key) in (None, user.id) else "ambiguous"
    index = {k: v for k, v in index.items() if isinstance(v, int)}
    # Names someone mapped by hand on the Mappings view win over any guess.
    for alias in db.query(AuditRegisterAlias).filter(AuditRegisterAlias.kind == "owner").all():
        index[_ALIAS + alias.alias_key] = alias.target_id
    return index


_ALIAS = "alias:"


def match_owner(raw_name: Optional[str], index: Dict[str, int]) -> Optional[int]:
    if (mapped := index.get(_ALIAS + alias_key(raw_name))) is not None:
        return mapped
    for key in _name_keys(raw_name or ""):
        if key in index:
            return index[key]
    return None


# ── status ───────────────────────────────────────────────────────────────────

def workflow_state_for(values: Dict[str, Any]) -> str:
    """The register states what is true; this is the same fact in platform words."""
    state = T.WORKFLOW_BY_RECOMMENDATION_STATE.get(
        str(values.get("recommendation_state") or "").strip().upper())
    if not state:
        state = T.WORKFLOW_BY_IA_STATUS.get(str(values.get("ia_status") or "").strip().upper())
    if not state:
        state = T.WORKFLOW_BY_REMEDIATION_STATUS.get(
            str(values.get("remediation_status") or "").strip().upper())
    if state == "closure_review" and str(
            values.get("validation_status") or "").strip().upper() in T.VALIDATION_STATUS_CLOSES:
        state = "closed"                      # remediated and Audit Services signed it off
    if not state and str(values.get("resolution_status") or "").strip().upper() == "CLOSED":
        state = "closed"
    # Management reports the plan done and Audit Services have not sent it back
    # (DE/PD): it is awaiting their validation.
    if (state in (None, "new", "in_progress")
            and str(values.get("ia_status") or "").strip().upper() not in ("DE", "PD")
            and str(values.get("management_reported_status") or "").strip().upper()
            in T.MANAGEMENT_REPORTS_DONE):
        state = "closure_review"
    return state or "new"


def register_key(row: RegisterRow) -> Tuple[str, str, str]:
    """What identifies this row across monthly files: report, reference, title.

    The reference alone is not enough — the client's own file repeats it, with
    eight findings in one report all numbered "MRA" — so the title comes along
    to tell them apart. A renamed finding is still recognised by the fallback in
    ``_find_profile``.
    """
    values = row.values
    report = values.get("report_number") or values.get("report_name") or values.get("project_name") or ""
    reference = values.get("issue_ref")
    if not reference:                         # self-identified events carry no reference
        reference = f"{values.get('event_date') or ''} {values.get('title') or ''}".strip()[:80]
    title_key = " ".join(str(values.get("title") or "").lower().split())[:120]
    return str(report)[:255], str(reference)[:80], title_key


def _find_profile(db: Session, tenant_id: int, row: RegisterRow, report_key: str,
                  reference: str, title_key: str, touched: set,
                  allow_rename: bool) -> Optional[AuditIssueProfile]:
    """The row this file line already created, if any.

    Matching is by title within the reference. The rename fallback — matching on
    the reference alone — runs only when ``allow_rename`` says this file uses the
    reference once; otherwise renaming one of the eight findings numbered "MRA"
    would reshuffle which row owns which issue on every upload. ``touched`` holds
    what this import already claimed.
    """
    base = db.query(AuditIssueProfile).filter(
        AuditIssueProfile.tenant_id == tenant_id,
        AuditIssueProfile.source == row.source,
        AuditIssueProfile.record_type == row.record_type,
        AuditIssueProfile.report_key == report_key,
        AuditIssueProfile.issue_ref == reference,
    )
    exact = base.filter(AuditIssueProfile.title_key == title_key).first()
    if exact:
        return exact
    if not allow_rename:
        return None
    # The title was edited: only safe when one unclaimed row carries that reference.
    candidates = [c for c in base.limit(5).all() if c.id not in touched]
    return candidates[0] if len(candidates) == 1 else None


# ── applying ─────────────────────────────────────────────────────────────────

def _issue_fields(row: RegisterRow, owner_id: Optional[int],
                  as_of: Optional[Any] = None) -> Dict[str, Any]:
    values = row.values
    state = workflow_state_for(values)
    due = values.get("revised_target_date") or values.get("target_date")
    detected = (values.get("report_date") or values.get("event_date")
                or values.get("as_of_date") or as_of)
    category = _CATEGORY_BY_SELF_ID.get(str(values.get("self_id_category") or "").strip().lower())
    return {
        "title": (values.get("title") or values.get("issue_ref") or "Untitled finding")[:255],
        "description": values.get("issue_text") or values.get("condition"),
        "severity": T.SEVERITY_BY_RISK_RATING.get(
            str(values.get("risk_rating") or "").strip().upper(), "medium"),
        "issue_type": "audit_finding",
        "source_type": "audit",        # Issues' own "Audit" source: its chip, filter and rollup
        "category": category or _SOURCE_CATEGORY.get(row.source or ""),
        "owner_id": owner_id,
        "due_date": datetime.combine(due, datetime.min.time()) if due else None,
        "target_closure_date": datetime.combine(due, datetime.min.time()) if due else None,
        "detected_at": datetime.combine(detected, datetime.min.time()) if detected else None,
        "workflow_state": state,
        "status": "closed" if state == "closed" else "open",
        "closed_at": _closed_at(values, as_of) if state == "closed" else None,
    }


def _closed_at(values: Dict[str, Any], as_of: Optional[Any] = None) -> Optional[datetime]:
    # When the sheet gives no validation date, the file's own "AS OF" is the
    # date we learned it was closed.
    when = (values.get("validation_completed_on") or values.get("validated_on")
            or values.get("as_of_date") or as_of)
    return datetime.combine(when, datetime.min.time()) if when else None


def _sync_action(db: Session, issue: Issue, row: RegisterRow, owner_id: Optional[int]) -> None:
    """The management action plan, tracked as the issue's corrective action."""
    values = row.values
    plan = (values.get("management_action_plan") or values.get("corrective_actions")
            or values.get("recommendation") or values.get("actions_to_address"))
    if not plan:
        return
    action = (db.query(IssueAction)
              .filter(IssueAction.issue_id == issue.id, IssueAction.action_type == "corrective")
              .first())
    if action is None:
        action = IssueAction(issue_id=issue.id, action_type="corrective")
        db.add(action)
    action.title = ("Management action plan" if values.get("management_action_plan")
                    else "Corrective action")
    action.description = plan
    action.assignee_id = owner_id
    action.due_date = issue.due_date
    action.status = "completed" if issue.workflow_state == "closed" else "open"
    if issue.workflow_state == "closed":
        action.completed_at = action.completed_at or issue.closed_at


def apply_workbook(db: Session, tenant_id: int, book: ParsedWorkbook, *,
                   actor_id: Optional[int] = None) -> ImportResult:
    """Create or update one Issue per register row. The caller commits."""
    result = ImportResult(warnings=list(book.warnings))
    record = AuditRegisterImport(
        tenant_id=tenant_id, file_name=book.file_name, as_of_date=book.as_of,
        sheet_counts=book.sheet_counts, client_summary=book.summary,
        summary_month=book.summary_month, status_definitions=book.status_definitions,
        sheet_headers=book.sheet_headers,
        created_by=actor_id, status="applied",
        applied_at=datetime.utcnow(),
    )
    db.add(record)
    db.flush()

    owner_index = build_owner_index(db)
    assets = build_asset_index(db)
    vendors = build_vendor_index(db)
    vulnerabilities = build_vulnerability_index(db)
    unmatched: Dict[str, int] = {}
    touched: set = set()
    # How often each reference appears in this file; a repeated one can only be
    # told apart by its title.
    reference_uses = Counter(
        (r.source, r.record_type) + register_key(r)[:2] for r in book.rows if r.source)

    for row in book.rows:
        if not row.source:
            result.skipped += 1
            result.warnings.append(
                f"{row.sheet} row {row.row_number}: no source — not imported")
            continue

        report_key, reference, title_key = register_key(row)
        owner_id = match_owner(row.values.get("owner_name_raw"), owner_index)
        if row.values.get("owner_name_raw") and owner_id is None:
            unmatched[row.values["owner_name_raw"]] = unmatched.get(row.values["owner_name_raw"], 0) + 1

        unique_reference = reference_uses[(row.source, row.record_type, report_key, reference)] == 1
        profile = _find_profile(db, tenant_id, row, report_key, reference, title_key,
                                touched, unique_reference)
        if profile is not None and profile.deleted_at is not None:
            # Deleted in the platform: the file still carrying it does not bring it back.
            touched.add(profile.id)
            result.skipped += 1
            result.warnings.append(f"{row.sheet} row {row.row_number}: "
                                   f"{profile.issue_ref or 'finding'} was deleted in the platform — left out")
            continue

        if profile is None:
            issue = Issue(tenant_id=tenant_id, code=next_issue_code(tenant_id, db),
                          reporter_id=actor_id, **_issue_fields(row, owner_id, book.as_of))
            db.add(issue)
            db.flush()
            profile = AuditIssueProfile(tenant_id=tenant_id, issue_id=issue.id,
                                        source=row.source, record_type=row.record_type,
                                        report_key=report_key, issue_ref=reference,
                                        title_key=title_key)
            db.add(profile)
            result.created += 1
            is_new = True
        else:
            is_new = False
            issue = db.get(Issue, profile.issue_id)
            # A field someone edited in the platform wins over this file: the
            # edit is newer than the month-end pack it would be reverted from.
            edited = set(profile.edited_fields or [])
            if edited:
                merged = dict(row.values)
                for field in edited:
                    if field == "title":
                        merged["title"] = issue.title
                    elif field in PROFILE_FIELDS:
                        merged[field] = getattr(profile, field)
                result.kept_edits += sum(
                    1 for f in edited
                    if f in row.values and merged.get(f) != row.values.get(f))
                row = RegisterRow(row.sheet, row.row_number, row.record_type, row.source, merged)
                if "owner" in edited:
                    owner_id = issue.owner_id
            for key, value in _issue_fields(row, owner_id, book.as_of).items():
                setattr(issue, key, value)
            result.updated += 1

        edited = set(profile.edited_fields or [])
        for key, value in row.values.items():
            # issue_ref is part of the register key, already set (and length-
            # capped) from register_key; copying the raw value over it would let
            # a long reference overflow the column and drift from the key.
            if key in PROFILE_FIELDS and key != "issue_ref" and key not in edited:
                setattr(profile, key, value)
        profile.title_key = title_key
        profile.import_id = record.id
        touched.add(profile.id)
        profile.source_sheet = row.sheet
        profile.source_row = row.row_number
        profile.as_of_date = profile.as_of_date or book.as_of
        db.flush()
        _sync_action(db, issue, row, owner_id)
        for kind, count in link_issue(db, issue, profile, assets=assets, vendors=vendors,
                                      vulnerabilities=vulnerabilities, actor_id=actor_id).items():
            result.linked[kind] += count
        for kind, count in sync_crosslinks(db, issue, profile, actor_id=actor_id,
                                           as_of=book.as_of, create=is_new).items():
            result.linked[kind] = result.linked.get(kind, 0) + count

    record.created_count = result.created
    record.updated_count = result.updated
    record.skipped_count = result.skipped
    record.unmatched_owners = [{"name": n, "rows": c} for n, c in sorted(unmatched.items())]
    record.warnings = result.warnings
    result.import_id = record.id
    result.unmatched_owners = sorted(unmatched)
    return result
