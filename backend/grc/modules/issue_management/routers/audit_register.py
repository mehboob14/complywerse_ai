"""Upload the client's audit register workbook.

Two steps on purpose: *preview* reads the file and reports what it would do —
rows per sheet, owner names that match nobody, anything it could not place —
and *import* applies it. The monthly pack is the bank's own record, so it gets
looked at before it lands, and every import is kept with its counts.
"""
from __future__ import annotations

from datetime import date
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile, status
from fastapi.responses import Response
from sqlalchemy.orm import Session

from ....rich_audit import write_rich_audit_log

from ....models import (AuditExtensionRequest, AuditIssueProfile, AuditRegisterImport,
                        AuditRegisterReport, BusinessUnit, GRCUser, IssueActivity, IssueAssetLink,
                        IssueVulnerabilityLink, RiskIncident, Tenant, get_db)
from ....routers.auth_router import get_user_primary_tenant, require_auth, require_tenant_permission
from ..audit_register import assist, mappings, settings as register_settings, template as T, workflow
from ..audit_register.crosslinks import REGULATOR_STATUSES, observation_for, sync_crosslinks
from ..audit_register.export import build_workbook
from ..audit_register.parser import ParsedWorkbook, parse_workbook
from ..audit_register.service import apply_workbook, build_owner_index, match_owner
from ..audit_register.summary import (days_past_due, effective_status, months_available, pack,
                                      report_prefill, reports, roll_forward)
from ..audit_register.suggestions import suggestions_for
from ..audit_register.editing import (apply_edit, create_finding, delete_finding, entry_templates,
                                      form_for, options as edit_options, restore_finding)
from ..audit_register.export import build_template
from ..audit_register.template import ENTRY_TEMPLATES, ENTRY_TEMPLATE_BY_SOURCE, default_headers, layout_for
from ..audit_register.linkage import (
    build_asset_index, build_vendor_index, build_vulnerability_index, link_issue,
)

router = APIRouter(prefix="/issues/audit-register", tags=["Issue Management - Audit register"])

_require_create = require_tenant_permission("issue_management:issues:create")
_require_edit = require_tenant_permission("issue_management:issues:edit")
_require_view = require_tenant_permission("issue_management:issues:view")
_require_delete = require_tenant_permission("issue_management:issues:delete")
_ACCEPTED = (".xlsb", ".xlsx", ".xlsm")
_LINKS = {"asset": (IssueAssetLink, IssueAssetLink.asset_id),
          "vulnerability": (IssueVulnerabilityLink, IssueVulnerabilityLink.vulnerability_id)}


def _audit(request: Request, db: Session, tenant_id: int, user: GRCUser, action: str,
           summary: str, *, resource_id: Optional[int] = None, resource_name: Optional[str] = None,
           resource_type: str = "audit-register", before: Optional[Dict[str, Any]] = None,
           after: Optional[Dict[str, Any]] = None) -> None:
    """One readable Audit Log row per register action, in the caller's
    transaction. The request's own generic row is then skipped (the middleware
    checks request.state.audit_recorded), and the workflow engine turns this
    row into the register's named trigger events."""
    from ...workflow_engine.services.route_events import endpoint_of

    write_rich_audit_log(db=db, tenant_id=tenant_id, user_id=user.id, action=action,
                         resource_type=resource_type, resource_id=resource_id,
                         resource_name=resource_name, summary=summary, before=before, after=after,
                         ip_address=request.client.host if request.client else None,
                         method=request.method, endpoint=endpoint_of(request.scope))
    request.state.audit_recorded = True


def _named(profile: AuditIssueProfile) -> str:
    """"MRA-1 · Wire controls (ISS-0012)" — how a finding reads in the log."""
    issue = profile.issue
    label = " · ".join(x for x in (profile.issue_ref, issue.title if issue else None) if x)
    return f"{label} ({issue.code})" if issue is not None and issue.code else label


def _change_text(db: Session, changed: Dict[str, List[Any]]) -> str:
    from ..audit_register import template as T

    def shown(field: str, value: Any) -> str:
        if value in (None, ""):
            return "blank"
        if field == "owner":
            user = db.get(GRCUser, value)
            return (getattr(user, "display_name", None) or getattr(user, "username", None)) if user else f"user {value}"
        text = str(value)
        return text if len(text) <= 40 else text[:37] + "…"

    parts = [f"{T.FIELD_SPEC.get(f, (f,))[0]}: {shown(f, a)} → {shown(f, b)}"
             for f, (a, b) in list(changed.items())[:4]]
    return "; ".join(parts) + (f"; +{len(changed) - 4} more" if len(changed) > 4 else "")


async def _read(file: UploadFile) -> ParsedWorkbook:
    name = (file.filename or "").lower()
    if not name.endswith(_ACCEPTED):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"File must be an Excel workbook ({', '.join(_ACCEPTED)})",
        )
    try:
        return parse_workbook(await file.read(), file_name=file.filename or "")
    except Exception as exc:                      # a corrupt or unexpected workbook
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                            detail=f"Could not read the workbook: {exc}")


def _preview_payload(book: ParsedWorkbook, db: Session) -> Dict[str, Any]:
    index = build_owner_index(db)
    unmatched: Dict[str, int] = {}
    by_source: Dict[str, int] = {}
    for row in book.rows:
        by_source[row.source or "unassigned"] = by_source.get(row.source or "unassigned", 0) + 1
        raw = row.values.get("owner_name_raw")
        if raw and match_owner(raw, index) is None:
            unmatched[raw] = unmatched.get(raw, 0) + 1
    return {
        "file_name": book.file_name,
        "as_of": book.as_of.isoformat() if book.as_of else None,
        "rows": len(book.rows),
        "sheet_counts": book.sheet_counts,
        "by_source": by_source,
        "summary": book.summary,                  # the pack's own roll-forward
        "unmatched_owners": [{"name": n, "rows": c} for n, c in sorted(unmatched.items())],
        "warnings": book.warnings,
        "sample": [
            {"sheet": r.sheet, "row": r.row_number, "source": r.source,
             "record_type": r.record_type, "reference": r.values.get("issue_ref"),
             "title": r.values.get("title"), "owner": r.values.get("owner_name_raw"),
             "status": r.values.get("ia_status") or r.values.get("remediation_status")}
            for r in book.rows[:25]
        ],
    }


@router.post("/preview", dependencies=[Depends(_require_create)])
async def preview_register(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """Read the workbook and report what an import would do. Writes nothing."""
    return _preview_payload(await _read(file), db)


@router.post("/import", dependencies=[Depends(_require_create)])
async def import_register(
    request: Request,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """Create or update one issue per register row."""
    tenant_id = get_user_primary_tenant(current_user, db)
    if not tenant_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                            detail="User is not assigned to any tenant")
    book = await _read(file)
    result = apply_workbook(db, tenant_id, book, actor_id=current_user.id)
    _audit(request, db, tenant_id, current_user, "import",
           f'Imported the register workbook "{book.file_name}"'
           + (f" ({book.summary_month} pack)" if book.summary_month else "")
           + f": {result.created} created, {result.updated} updated, {result.skipped} skipped"
           + (f", {len(result.unmatched_owners)} owner name(s) unmatched" if result.unmatched_owners else ""),
           resource_type="audit-register-import", resource_id=result.import_id,
           resource_name=book.file_name,
           after={"file_name": book.file_name, "summary_month": book.summary_month,
                  "created": result.created, "updated": result.updated,
                  "skipped": result.skipped, "sheets": book.sheet_counts})
    db.commit()
    return {
        "import_id": result.import_id,
        "created": result.created,
        "updated": result.updated,
        "skipped": result.skipped,
        "sheet_counts": book.sheet_counts,
        "as_of": book.as_of.isoformat() if book.as_of else None,
        "unmatched_owners": result.unmatched_owners,
        "warnings": result.warnings,
        "linked": result.linked,
        "kept_edits": result.kept_edits,
    }


@router.get("/imports", dependencies=[Depends(_require_create)])
def list_imports(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
) -> List[Dict[str, Any]]:
    """Every upload of the register, newest first."""
    tenant_id = get_user_primary_tenant(current_user, db)
    rows = (db.query(AuditRegisterImport)
            .filter(AuditRegisterImport.tenant_id == tenant_id)
            .order_by(AuditRegisterImport.id.desc()).limit(50).all())
    return [{
        "id": r.id,
        "file_name": r.file_name,
        "as_of": r.as_of_date.isoformat() if r.as_of_date else None,
        "created": r.created_count,
        "updated": r.updated_count,
        "skipped": r.skipped_count,
        "sheet_counts": r.sheet_counts or {},
        "unmatched_owners": r.unmatched_owners or [],
        "warnings": r.warnings or [],
        "imported_at": r.applied_at.isoformat() if r.applied_at else None,
    } for r in rows]


@router.get("/rows", dependencies=[Depends(_require_view)])
def list_register_rows(
    source: str = None,
    deleted: bool = False,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
) -> List[Dict[str, Any]]:
    """The register as the client keeps it: their columns, their words.
    ``deleted=true`` lists what was deleted instead, to restore."""
    tenant_id = get_user_primary_tenant(current_user, db)
    query = (db.query(AuditIssueProfile)
             .filter(AuditIssueProfile.tenant_id == tenant_id,
                     AuditIssueProfile.deleted_at.isnot(None) if deleted
                     else AuditIssueProfile.deleted_at.is_(None))
             .order_by(AuditIssueProfile.source, AuditIssueProfile.issue_ref))
    if source:
        query = query.filter(AuditIssueProfile.source == source)
    out = []
    today = date.today()
    for profile in query.limit(5000).all():                  # the Reports module's cap too
        issue = profile.issue
        out.append({
            "issue_id": profile.issue_id,
            "code": getattr(issue, "code", None),
            "source": profile.source,
            "record_type": profile.record_type,
            "regulator": profile.regulator,
            "report": profile.report_name or profile.report_number or profile.project_name,
            "report_key": profile.report_key,
            "report_prefill": report_prefill(profile),
            "added_in_platform": profile.import_id is None,
            "reference": profile.issue_ref,
            "title": getattr(issue, "title", None),
            "risk_rating": profile.risk_rating,
            "lob": profile.lob,
            "owner": profile.owner_name_raw,
            "owner_id": getattr(issue, "owner_id", None),
            "owner_name": (getattr(getattr(issue, "owner", None), "display_name", None)
                           or getattr(getattr(issue, "owner", None), "username", None)),
            "affected_hosts": profile.affected_hosts,
            "edited": bool(profile.edited_fields),
            "target_date": profile.target_date.isoformat() if profile.target_date else None,
            "revised_target_date": (profile.revised_target_date.isoformat()
                                    if profile.revised_target_date else None),
            "ia_status": profile.ia_status,
            "remediation_status": profile.remediation_status,
            "validation_status": profile.validation_status,
            "validation_pass_fail": profile.validation_pass_fail,
            "aged_status": profile.aged_status,
            # Computed from the agreed date; the file's own count where it gives no date.
            "days_past_due": (days_past_due(profile, issue, today)
                              if (profile.revised_target_date or profile.target_date or issue.due_date)
                              else profile.days_past_due or profile.aged_days_from_target),
            "status": effective_status(profile, issue, today),
            "workflow_state": getattr(issue, "workflow_state", None),
            "deleted": profile.deleted_at is not None,
            "deleted_at": profile.deleted_at.isoformat() if profile.deleted_at else None,
        })
    return out


@router.get("/summary", dependencies=[Depends(_require_view)])
def register_summary(
    month: str = None,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """The monthly roll-forward by source, beside the client's own figures."""
    tenant_id = get_user_primary_tenant(current_user, db)
    months = months_available(db, tenant_id)
    chosen = month or (months[0] if months else None)
    if not chosen:
        return {"months": [], "month": None, "rows": [], "totals": {}, "has_reported": False}
    try:
        return {"months": months, **roll_forward(db, tenant_id, chosen)}
    except (ValueError, IndexError):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                            detail="month must look like 2026-04")


def _profile_or_404(db: Session, tenant_id: int, issue_id: int,
                    live: bool = False) -> AuditIssueProfile:
    """The finding; ``live`` refuses one that was deleted — restore it first."""
    profile = (db.query(AuditIssueProfile)
               .filter(AuditIssueProfile.tenant_id == tenant_id,
                       AuditIssueProfile.issue_id == issue_id).first())
    if not profile:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND,
                            detail="This issue did not come from the register")
    if live and profile.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                            detail="This finding was deleted — restore it before changing it")
    return profile


def _links_payload(db: Session, profile: AuditIssueProfile) -> Dict[str, Any]:
    """Where this finding also lives: Statutory Audit, Incidents, Business units."""
    observation = observation_for(db, profile.issue_id)
    incident = db.get(RiskIncident, profile.incident_id) if profile.incident_id else None
    unit = db.get(BusinessUnit, profile.business_unit_id) if profile.business_unit_id else None
    return {
        "observation": ({"id": observation.id, "code": observation.code, "status": observation.status}
                        if observation else None),
        "incident": {"id": incident.id, "title": incident.title, "status": incident.status} if incident else None,
        "business_unit": {"id": unit.id, "name": unit.name} if unit else None,
        "regulator_status": profile.regulator_status,
        "regulator_statuses": list(REGULATOR_STATUSES) if profile.source == "regulator" else [],
    }


def _finding_payload(profile: AuditIssueProfile, db: Optional[Session] = None) -> Dict[str, Any]:
    issue = profile.issue
    owner = issue.owner if hasattr(issue, "owner") else None
    return {
        **({"links": _links_payload(db, profile)} if db is not None else {}),
        "issue_id": issue.id,
        "code": issue.code,
        "title": issue.title,
        "source": profile.source,
        "record_type": profile.record_type,
        "source_sheet": profile.source_sheet,
        "source_row": profile.source_row,
        "added_in_platform": profile.import_id is None,
        "workflow_state": issue.workflow_state,
        "severity": issue.severity,
        "owner_id": issue.owner_id,
        "owner_name": (getattr(owner, "display_name", None) or getattr(owner, "username", None))
        if owner else None,
        "edited_fields": profile.edited_fields or [],
        **form_for(issue, profile),
    }


@router.get("/profile/{issue_id}", dependencies=[Depends(_require_view)])
def register_profile(
    issue_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """The finding in its own sheet's columns, grouped and typed for view and edit."""
    tenant_id = get_user_primary_tenant(current_user, db)
    return _finding_payload(_profile_or_404(db, tenant_id, issue_id), db)


@router.patch("/profile/{issue_id}", dependencies=[Depends(_require_create)])
def edit_profile(
    issue_id: int,
    body: Dict[str, Any],
    request: Request,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """Edit any of the finding's columns; the issue follows, the import keeps it."""
    tenant_id = get_user_primary_tenant(current_user, db)
    profile = _profile_or_404(db, tenant_id, issue_id, live=True)
    changes = body.get("changes") if isinstance(body.get("changes"), dict) else {}
    try:
        changed = apply_edit(db, profile.issue, profile, changes, actor=current_user)
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
    if changed:
        _audit(request, db, tenant_id, current_user, "update",
               f"Edited {_named(profile)} — {_change_text(db, changed)}",
               resource_id=issue_id, resource_name=_named(profile),
               before={f: v[0] for f, v in changed.items()},
               after={f: v[1] for f, v in changed.items()})
    db.commit()
    db.refresh(profile)
    return {"changed": changed, **_finding_payload(profile, db)}


@router.get("/options", dependencies=[Depends(_require_view)])
def register_options(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """What the edit form's dropdowns offer: the template's codes, the values
    already in the register, and the tenant's users."""
    return edit_options(db, get_user_primary_tenant(current_user, db))


@router.post("/relink", dependencies=[Depends(_require_create)])
def relink_register(
    request: Request,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """Re-run the linking for every finding — after assets, vulnerabilities or
    vendors were added — without re-uploading the workbook. MRAs, Self ID
    events and LOBs are brought into Statutory Audit, Incidents and business
    units the same way."""
    tenant_id = get_user_primary_tenant(current_user, db)
    assets, vendors = build_asset_index(db), build_vendor_index(db)
    vulnerabilities = build_vulnerability_index(db)
    made = {"assets": 0, "vulnerabilities": 0, "vendors": 0}
    for profile in (db.query(AuditIssueProfile)
                    .filter(AuditIssueProfile.tenant_id == tenant_id,
                            AuditIssueProfile.deleted_at.is_(None)).all()):
        for kind, count in link_issue(db, profile.issue, profile, assets=assets, vendors=vendors,
                                      vulnerabilities=vulnerabilities,
                                      actor_id=current_user.id).items():
            made[kind] += count
        for kind, count in sync_crosslinks(db, profile.issue, profile, actor_id=current_user.id,
                                           create=True).items():
            made[kind] = made.get(kind, 0) + count
    made_text = ", ".join(f"{n} {kind.replace('_', ' ')}" for kind, n in made.items() if n)
    _audit(request, db, tenant_id, current_user, "relink",
           f"Re-linked the register to the rest of the platform: {made_text or 'nothing new'}",
           after=made)
    db.commit()
    return {"linked": made}


@router.get("/findings-for", dependencies=[Depends(_require_view)])
def findings_for(
    kind: str,
    record_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
) -> List[Dict[str, Any]]:
    """Register findings linked to one asset or vulnerability — the "Audit
    finding: CLDCA.01" tag on the Cybersecurity Assurance pages."""
    if kind not in _LINKS:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                            detail="kind must be asset or vulnerability")
    link, column = _LINKS[kind]
    tenant_id = get_user_primary_tenant(current_user, db)
    profiles = (db.query(AuditIssueProfile)
                .join(link, link.issue_id == AuditIssueProfile.issue_id)
                .filter(AuditIssueProfile.tenant_id == tenant_id, column == record_id,
                        AuditIssueProfile.deleted_at.is_(None))
                .order_by(AuditIssueProfile.issue_ref).all())
    return [{
        "issue_id": p.issue_id,
        "reference": p.issue_ref,
        "title": p.issue.title,
        "source": p.source,
        "record_type": p.record_type,
        "report": p.project_name or p.report_name or p.report_number,
        "workflow_state": p.issue.workflow_state,
    } for p in profiles]


@router.get("/suggestions/{issue_id}", dependencies=[Depends(_require_create)])
def register_suggestions(
    issue_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """Controls and risks this finding looks related to — to accept or ignore."""
    tenant_id = get_user_primary_tenant(current_user, db)
    profile = _profile_or_404(db, tenant_id, issue_id)
    return suggestions_for(db, tenant_id, profile.issue, profile)


def _bad_request(exc: Exception):
    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))


def _month_or_latest(db: Session, tenant_id: int, month: Optional[str]) -> str:
    """The month asked for, else the month of the pack uploaded last."""
    latest = (db.query(AuditRegisterImport.summary_month)
              .filter(AuditRegisterImport.tenant_id == tenant_id,
                      AuditRegisterImport.summary_month.isnot(None))
              .order_by(AuditRegisterImport.id.desc()).first())
    chosen = month or (latest[0] if latest else months_available(db, tenant_id)[0])
    try:
        date(int(chosen[:4]), int(chosen[5:7]), 1)
    except (ValueError, IndexError):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="month must look like 2026-04")
    return chosen


def _parse_date(value: Any, field: str) -> Optional[date]:
    if value in (None, ""):
        return None
    try:
        return date.fromisoformat(str(value)[:10])
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"{field} must be a date")


# ── the monthly pack (SUMMARY) and the reports view ──────────────────────────

@router.get("/pack", dependencies=[Depends(_require_view)])
def register_pack(
    month: str = None,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """Every section of the client's SUMMARY sheet, computed from the register."""
    tenant_id = get_user_primary_tenant(current_user, db)
    chosen = _month_or_latest(db, tenant_id, month)
    return {"months": months_available(db, tenant_id), **pack(db, tenant_id, chosen)}


@router.get("/pack/export", dependencies=[Depends(_require_view)])
def export_pack(
    month: str = None,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """The pack as an .xlsx laid out like their SUMMARY sheet."""
    tenant_id = get_user_primary_tenant(current_user, db)
    chosen = _month_or_latest(db, tenant_id, month)
    tenant = db.get(Tenant, tenant_id)
    content = build_workbook(pack(db, tenant_id, chosen), getattr(tenant, "name", None) or "")
    return Response(content=content,
                    media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    headers={"Content-Disposition": f'attachment; filename="Issue Summary {chosen}.xlsx"'})


@router.get("/reports", dependencies=[Depends(_require_view)])
def register_reports(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """One line per audit report or exam, with how its findings stand — and
    what a new finding on the same report starts from."""
    return [{**line, "template": ENTRY_TEMPLATE_BY_SOURCE.get(line["source"])}
            for line in reports(db, get_user_primary_tenant(current_user, db))]


# ── adding a finding by hand ─────────────────────────────────────────────────

@router.get("/templates", dependencies=[Depends(_require_view)])
def register_templates(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """One blank form per sheet of the client's workbook, in its own columns."""
    return entry_templates(db, get_user_primary_tenant(current_user, db))


@router.post("/findings", dependencies=[Depends(_require_create)])
def add_finding(
    body: Dict[str, Any],
    request: Request,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """Add a single finding on one of the sheets, as the workbook would carry it."""
    tenant_id = get_user_primary_tenant(current_user, db)
    values = body.get("values")
    if not isinstance(values, dict):
        raise HTTPException(status_code=400, detail="values must be an object of the sheet's columns")
    # The columns the person took from AI Assist and kept as it wrote them.
    asked = body.get("ai_fields") if isinstance(body.get("ai_fields"), list) else []
    drafted = sorted({str(f) for f in asked} & {k for k, v in values.items() if v not in (None, "")}
                     & set(T.FIELD_SPEC))
    try:
        profile = create_finding(db, tenant_id, str(body.get("template") or ""), values, current_user,
                                 report_id=int(body["report_id"]) if body.get("report_id") else None,
                                 ai_fields=drafted)
    except (ValueError, TypeError) as exc:
        db.rollback()
        _bad_request(exc)
    _audit(request, db, tenant_id, current_user, "create",
           f'Added {_named(profile)} on the "{(profile.source_sheet or "").strip()}" sheet'
           + (f" (AI-drafted and accepted: {', '.join(T.FIELD_SPEC[f][0] for f in drafted)})" if drafted else ""),
           resource_id=profile.issue_id, resource_name=_named(profile),
           after={**{k: v for k, v in values.items() if v not in (None, "")},
                  **({"ai_fields": drafted} if drafted else {})})
    db.commit()
    db.refresh(profile)
    return _finding_payload(profile, db)


@router.post("/assist", dependencies=[Depends(_require_create)])
def assist_finding(
    body: Dict[str, Any],
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """AI Assist on the add-a-finding form: values for the columns still empty,
    each with its reason, list columns only from the platform's own lists.
    Saves nothing; the person applies what they want."""
    tenant_id = get_user_primary_tenant(current_user, db)
    values = body.get("values") if isinstance(body.get("values"), dict) else {}
    try:
        return assist.suggest(db, tenant_id, str(body.get("template") or ""), values,
                              report_id=int(body["report_id"]) if body.get("report_id") else None)
    except (ValueError, TypeError) as exc:
        _bad_request(exc)


@router.delete("/findings/{issue_id}", dependencies=[Depends(_require_delete)])
def remove_finding(
    issue_id: int,
    request: Request,
    body: Optional[Dict[str, Any]] = None,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """Take a finding out of the register — kept as a cancelled issue, restorable."""
    tenant_id = get_user_primary_tenant(current_user, db)
    profile = _profile_or_404(db, tenant_id, issue_id)
    reason = str((body or {}).get("reason") or "").strip()
    try:
        delete_finding(db, profile.issue, profile, current_user, reason)
    except ValueError as exc:
        db.rollback()
        _bad_request(exc)
    _audit(request, db, tenant_id, current_user, "delete",
           f"Deleted {_named(profile)} from the register" + (f" — {reason}" if reason else ""),
           resource_id=issue_id, resource_name=_named(profile), after={"reason": reason or None})
    db.commit()
    return {"deleted": True, "issue_id": issue_id}


@router.post("/findings/{issue_id}/restore", dependencies=[Depends(_require_delete)])
def restore_deleted_finding(
    issue_id: int,
    request: Request,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    tenant_id = get_user_primary_tenant(current_user, db)
    profile = _profile_or_404(db, tenant_id, issue_id)
    try:
        restore_finding(db, profile.issue, profile, current_user)
    except ValueError as exc:
        db.rollback()
        _bad_request(exc)
    _audit(request, db, tenant_id, current_user, "restore",
           f"Restored {_named(profile)} to the register",
           resource_id=issue_id, resource_name=_named(profile))
    db.commit()
    db.refresh(profile)
    return _finding_payload(profile, db)


@router.get("/template", dependencies=[Depends(_require_view)])
def download_template(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """A blank workbook in the client's own layout: the sheets and header rows of
    the last upload that carried them, else the register's standard sheets."""
    tenant_id = get_user_primary_tenant(current_user, db)
    source = next((r for r in (db.query(AuditRegisterImport)
                               .filter(AuditRegisterImport.tenant_id == tenant_id)
                               .order_by(AuditRegisterImport.id.desc()).limit(12).all())
                   if r.sheet_headers), None)
    if source:
        headers, definitions = source.sheet_headers, source.status_definitions or {}
    else:
        headers = {sheet: default_headers(layout_for(src, sheet))
                   for _, _, sheet, src, _ in ENTRY_TEMPLATES}
        definitions = {}
    tenant = db.get(Tenant, tenant_id)
    content = build_template(headers, definitions, getattr(tenant, "name", None) or "")
    name = (source.file_name.rsplit(".", 1)[0] if source and source.file_name else "Audit register")
    name = "".join(ch for ch in name if ch.isascii() and (ch.isalnum() or ch in " _.-")) or "Audit register"
    return Response(content=content,
                    media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    headers={"Content-Disposition": f'attachment; filename="{name} - blank.xlsx"'})


@router.get("/status", dependencies=[Depends(_require_view)])
def register_status(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """Whether this tenant keeps an audit register — Issues offers the view when it does."""
    tenant_id = get_user_primary_tenant(current_user, db)
    findings = (db.query(AuditIssueProfile.id)
                .filter(AuditIssueProfile.tenant_id == tenant_id,
                        AuditIssueProfile.deleted_at.is_(None)).count())
    last = (db.query(AuditRegisterImport)
            .filter(AuditRegisterImport.tenant_id == tenant_id)
            .order_by(AuditRegisterImport.id.desc()).first())
    return {
        "has_register": findings > 0 or last is not None,
        "findings": findings,
        "last_import": ({"file_name": last.file_name, "summary_month": last.summary_month,
                         "as_of": last.as_of_date.isoformat() if last.as_of_date else None}
                        if last else None),
    }


# ── validation ───────────────────────────────────────────────────────────────

@router.get("/validation/{issue_id}", dependencies=[Depends(_require_view)])
def validation_state(
    issue_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    tenant_id = get_user_primary_tenant(current_user, db)
    profile = _profile_or_404(db, tenant_id, issue_id)
    return workflow.validation_state(db, profile.issue, profile)


@router.post("/validation/{issue_id}/submit", dependencies=[Depends(_require_edit)])
async def submit_validation(
    issue_id: int,
    request: Request,
    note: str = Form(""),
    files: List[UploadFile] = File(default=[]),
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """The owner hands the finding to Audit Services, with the materials."""
    tenant_id = get_user_primary_tenant(current_user, db)
    profile = _profile_or_404(db, tenant_id, issue_id, live=True)
    uploads = []
    for upload in files:
        data = await upload.read()
        if len(data) > workflow.MAX_FILE_BYTES:
            raise HTTPException(status_code=413, detail=f"{upload.filename} is over 25 MB")
        if data:
            uploads.append((upload.filename or "file", upload.content_type, data))
    try:
        result = workflow.submit_for_validation(db, profile.issue, profile, current_user, note, uploads)
    except ValueError as exc:
        db.rollback()
        _bad_request(exc)
    names = ", ".join(name for name, _, _ in uploads)
    _audit(request, db, tenant_id, current_user, "submit_validation",
           f"Submitted {_named(profile)} for validation"
           + (f" with {len(uploads)} file(s): {names}" if uploads else "")
           + (f" — {note.strip()}" if note.strip() else ""),
           resource_id=issue_id, resource_name=_named(profile),
           after={"note": note.strip() or None, "files": [n for n, _, _ in uploads],
                  "evidence_ids": result["evidence_ids"]})
    db.commit()
    return {**result, **workflow.validation_state(db, profile.issue, profile)}


_VALIDATION_ACTIONS = {"pass": ("validation_passed", "Validation passed — closed"),
                       "more_info": ("validation_more_info", "More materials asked for"),
                       "fail": ("validation_failed", "Validation failed")}


@router.post("/validation/{issue_id}/decide", dependencies=[Depends(_require_create)])
def decide_validation(
    issue_id: int,
    body: Dict[str, Any],
    request: Request,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """Audit Services: pass (close), more materials needed (DE), or fail (PD)."""
    tenant_id = get_user_primary_tenant(current_user, db)
    profile = _profile_or_404(db, tenant_id, issue_id, live=True)
    result, reason = str(body.get("result") or ""), str(body.get("reason") or "").strip()
    try:
        workflow.decide_validation(db, profile.issue, profile, current_user, result, reason)
    except ValueError as exc:
        db.rollback()
        _bad_request(exc)
    action, words = _VALIDATION_ACTIONS[result]
    _audit(request, db, tenant_id, current_user, action,
           f"{words}: {_named(profile)}" + (f" — {reason}" if reason else ""),
           resource_id=issue_id, resource_name=_named(profile),
           after={"result": result, "reason": reason or None})
    db.commit()
    return workflow.validation_state(db, profile.issue, profile)


# ── extensions (Audit Committee) ─────────────────────────────────────────────

@router.get("/extensions", dependencies=[Depends(_require_view)])
def list_extensions(
    issue_id: int = None,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    tenant_id = get_user_primary_tenant(current_user, db)
    query = db.query(AuditExtensionRequest).filter(AuditExtensionRequest.tenant_id == tenant_id)
    if issue_id:
        query = query.filter(AuditExtensionRequest.issue_id == issue_id)
    out = []
    for ext in query.order_by(AuditExtensionRequest.id.desc()).limit(200).all():
        profile = (db.query(AuditIssueProfile)
                   .filter(AuditIssueProfile.issue_id == ext.issue_id).first())
        out.append({**workflow.extension_payload(db, ext),
                    "reference": profile.issue_ref if profile else None,
                    "title": profile.issue.title if profile else None,
                    "source": profile.source if profile else None})
    return out


@router.get("/extensions/meetings", dependencies=[Depends(_require_view)])
def extension_meetings(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """Upcoming Audit Committee meetings an extension request can go to."""
    return workflow.audit_committee_meetings(db, get_user_primary_tenant(current_user, db))


@router.post("/extensions/{issue_id}", dependencies=[Depends(_require_edit)])
def request_extension(
    issue_id: int,
    body: Dict[str, Any],
    request: Request,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    tenant_id = get_user_primary_tenant(current_user, db)
    profile = _profile_or_404(db, tenant_id, issue_id, live=True)
    requested = _parse_date(body.get("requested_date"), "requested_date")
    if not requested:
        raise HTTPException(status_code=400, detail="requested_date is required")
    try:
        ext = workflow.request_extension(db, profile.issue, profile, current_user, requested,
                                         str(body.get("reason") or ""),
                                         int(body["meeting_id"]) if body.get("meeting_id") else None)
    except ValueError as exc:
        db.rollback()
        _bad_request(exc)
    payload = workflow.extension_payload(db, ext)
    _audit(request, db, tenant_id, current_user, "extension_requested",
           f"Requested an extension of {_named(profile)} to {requested.isoformat()}"
           + (f" — on the agenda of {payload['meeting']['title']}" if payload["meeting"] else " — no committee meeting scheduled yet"),
           resource_id=issue_id, resource_name=_named(profile),
           after={"request_id": ext.id, "previous_date": payload["previous_date"],
                  "requested_date": requested.isoformat(), "reason": ext.reason,
                  "meeting": (payload["meeting"] or {}).get("title")})
    db.commit()
    return workflow.extension_payload(db, ext)


def _extension_or_404(db: Session, tenant_id: int, request_id: int) -> AuditExtensionRequest:
    ext = (db.query(AuditExtensionRequest)
           .filter(AuditExtensionRequest.id == request_id,
                   AuditExtensionRequest.tenant_id == tenant_id).first())
    if not ext:
        raise HTTPException(status_code=404, detail="Extension request not found")
    return ext


def _extension_profile(db: Session, ext: AuditExtensionRequest) -> Optional[AuditIssueProfile]:
    return db.query(AuditIssueProfile).filter(AuditIssueProfile.issue_id == ext.issue_id).first()


@router.post("/extensions/decide/{request_id}", dependencies=[Depends(_require_create)])
def decide_extension(
    request_id: int,
    body: Dict[str, Any],
    request: Request,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """Record the Audit Committee's decision; approval moves the target date."""
    tenant_id = get_user_primary_tenant(current_user, db)
    ext = _extension_or_404(db, tenant_id, request_id)
    approve = bool(body.get("approve"))
    try:
        workflow.decide_extension(db, ext, current_user, approve, str(body.get("notes") or ""),
                                  _parse_date(body.get("regulator_notified_on"), "regulator_notified_on"))
    except ValueError as exc:
        db.rollback()
        _bad_request(exc)
    profile = _extension_profile(db, ext)
    named = _named(profile) if profile else f"issue {ext.issue_id}"
    _audit(request, db, tenant_id, current_user,
           "extension_approved" if approve else "extension_rejected",
           f"Audit Committee {'approved' if approve else 'did not approve'} the extension of {named} "
           f"to {ext.requested_date.isoformat()}" + (f" — {ext.decision_notes}" if ext.decision_notes else ""),
           resource_id=ext.issue_id, resource_name=named,
           after={"request_id": ext.id, "approved": approve, "requested_date": ext.requested_date.isoformat(),
                  "notes": ext.decision_notes})
    db.commit()
    return workflow.extension_payload(db, ext)


@router.post("/extensions/regulator-notice/{request_id}", dependencies=[Depends(_require_create)])
def record_regulator_notice(
    request_id: int,
    body: Dict[str, Any],
    request: Request,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """For an MRA: the date the regulator was told about the approved extension."""
    tenant_id = get_user_primary_tenant(current_user, db)
    ext = _extension_or_404(db, tenant_id, request_id)
    ext.regulator_notified_on = _parse_date(body.get("date"), "date") or date.today()
    db.add(IssueActivity(issue_id=ext.issue_id, user_id=current_user.id,
                         type="extension_regulator_notified",
                         payload={"request_id": ext.id,
                                  "date": ext.regulator_notified_on.isoformat()}))
    profile = _extension_profile(db, ext)
    named = _named(profile) if profile else f"issue {ext.issue_id}"
    _audit(request, db, tenant_id, current_user, "regulator_notified",
           f"Recorded that the regulator was told on {ext.regulator_notified_on.isoformat()} "
           f"of the extension of {named}",
           resource_id=ext.issue_id, resource_name=named,
           after={"request_id": ext.id, "regulator_notified_on": ext.regulator_notified_on.isoformat()})
    db.commit()
    return workflow.extension_payload(db, ext)


# ── reminders ────────────────────────────────────────────────────────────────

@router.get("/reminders", dependencies=[Depends(_require_create)])
def preview_reminders(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """Who would be reminded today, and about what. Sends nothing."""
    return workflow.send_reminders(db, get_user_primary_tenant(current_user, db), dry_run=True)


@router.post("/reminders", dependencies=[Depends(_require_create)])
def send_reminders(
    request: Request,
    body: Dict[str, Any] = None,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """Remind owners now (the daily sweep does this too). In-app, email if asked."""
    tenant_id = get_user_primary_tenant(current_user, db)
    asked = (body or {}).get("email")
    result = workflow.send_reminders(db, tenant_id, email=None if asked is None else bool(asked))
    email = result["email"]
    _audit(request, db, tenant_id, current_user, "reminders_sent",
           f"Reminded {result['owners']} owner(s) about "
           f"{result['due_soon'] + result['past_due'] + result['delayed'] + result['not_started']} finding(s) "
           f"({result['due_soon']} coming due, {result['past_due']} past due, {result['delayed']} delayed, "
           f"{result['not_started']} not started)"
           + (f"; {result['escalated']} escalated to Audit Services" if result["escalated"] else "")
           + (f"; {result['validation_waiting']} waiting on validation" if result["validation_waiting"] else "")
           + (" — in-app and email" if email else " — in-app"),
           after={k: result[k] for k in ("due_soon", "past_due", "delayed", "not_started",
                                         "validation_waiting", "owners", "escalated")})
    db.commit()
    return result


# ── regulator status (MRAs) ──────────────────────────────────────────────────

@router.patch("/regulator-status/{issue_id}", dependencies=[Depends(_require_create)])
def set_regulator_status(
    issue_id: int,
    body: Dict[str, Any],
    request: Request,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """Submitted to / accepted by the regulator, or the MRA closed by them.
    The Statutory Audit observation follows."""
    tenant_id = get_user_primary_tenant(current_user, db)
    profile = _profile_or_404(db, tenant_id, issue_id, live=True)
    if profile.source != "regulator":
        raise HTTPException(status_code=400, detail="Only regulator findings have a regulator status")
    value = (body.get("status") or "").strip() or None
    if value and value not in REGULATOR_STATUSES:
        raise HTTPException(status_code=400, detail=f"status must be one of {', '.join(REGULATOR_STATUSES)}")
    before = profile.regulator_status
    profile.regulator_status = value
    db.add(IssueActivity(issue_id=issue_id, user_id=current_user.id, type="regulator_status",
                         payload={"changes": {"regulator_status": [before, value]},
                                  "date": (_parse_date(body.get("date"), "date") or date.today()).isoformat()}))
    sync_crosslinks(db, profile.issue, profile, actor_id=current_user.id)
    _audit(request, db, tenant_id, current_user, "regulator_status_changed",
           f"Regulator status of {_named(profile)}: {before or 'not submitted'} → {value or 'not submitted'}",
           resource_id=issue_id, resource_name=_named(profile),
           before={"regulator_status": before}, after={"regulator_status": value})
    db.commit()
    return _links_payload(db, profile)


# ── mappings: owner names → users, LOBs → business units ─────────────────────

@router.get("/mappings/owners", dependencies=[Depends(_require_create)])
def owner_mappings(db: Session = Depends(get_db), current_user: GRCUser = Depends(require_auth)):
    return mappings.owner_mappings(db, get_user_primary_tenant(current_user, db))


@router.put("/mappings/owners", dependencies=[Depends(_require_create)])
def set_owner_mapping(
    body: Dict[str, Any],
    request: Request,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    tenant_id = get_user_primary_tenant(current_user, db)
    name = str(body.get("name") or "")
    user_id = int(body["user_id"]) if body.get("user_id") else None
    try:
        moved = mappings.set_owner_mapping(db, tenant_id, name, user_id, current_user)
    except ValueError as exc:
        db.rollback()
        _bad_request(exc)
    target = db.get(GRCUser, user_id) if user_id else None
    who = (getattr(target, "display_name", None) or getattr(target, "username", None)) if target else "no one"
    _audit(request, db, tenant_id, current_user, "owner_mapped",
           f'Mapped the workbook owner "{name}" to {who} — {moved} finding(s) reassigned',
           resource_name=name, after={"name": name, "user_id": user_id, "findings_updated": moved})
    db.commit()
    return {"findings_updated": moved, **mappings.owner_mappings(db, tenant_id)}


@router.get("/mappings/lobs", dependencies=[Depends(_require_create)])
def lob_mappings(db: Session = Depends(get_db), current_user: GRCUser = Depends(require_auth)):
    return mappings.lob_mappings(db, get_user_primary_tenant(current_user, db))


@router.put("/mappings/lobs", dependencies=[Depends(_require_create)])
def set_lob_mapping(
    body: Dict[str, Any],
    request: Request,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    tenant_id = get_user_primary_tenant(current_user, db)
    name = str(body.get("name") or "")
    try:
        result = mappings.set_lob_mapping(
            db, tenant_id, name,
            int(body["business_unit_id"]) if body.get("business_unit_id") else None,
            create=bool(body.get("create")), actor=current_user)
    except ValueError as exc:
        db.rollback()
        _bad_request(exc)
    unit = db.get(BusinessUnit, result["business_unit_id"]) if result["business_unit_id"] else None
    _audit(request, db, tenant_id, current_user, "lob_mapped",
           f'Mapped the LOB "{name}" to {("the new business unit " if body.get("create") else "")}'
           f'{unit.name if unit else "no business unit"} — {result["findings"]} finding(s) moved',
           resource_name=name, after={"name": name, **result, "created": bool(body.get("create"))})
    db.commit()
    return {**result, **mappings.lob_mappings(db, tenant_id)}


# ── settings: SLAs, dropdown lists, reports and exams, numbering ─────────────

def _settings_payload(db: Session, tenant_id: int, current: Dict[str, Any]) -> Dict[str, Any]:
    return {
        **current,
        "values": register_settings.list_values(db, tenant_id, current),
    }


@router.get("/settings", dependencies=[Depends(_require_view)])
def read_settings(db: Session = Depends(get_db), current_user: GRCUser = Depends(require_auth)):
    tenant_id = get_user_primary_tenant(current_user, db)
    return _settings_payload(db, tenant_id, register_settings.get_settings(db, tenant_id))


@router.put("/settings", dependencies=[Depends(_require_create)])
def write_settings(
    body: Dict[str, Any],
    request: Request,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """Save the parts of the settings that changed (sla, email, audit_services,
    lists, numbering)."""
    tenant_id = get_user_primary_tenant(current_user, db)
    before = register_settings.get_settings(db, tenant_id)
    try:
        current = register_settings.save_settings(db, tenant_id, body or {}, current_user)
    except (ValueError, TypeError) as exc:
        db.rollback()
        _bad_request(exc)
    changed = sorted(k for k in (body or {}) if before.get(k) != current.get(k))
    _audit(request, db, tenant_id, current_user, "settings_updated",
           f"Changed the register settings: {', '.join(changed) or 'no change'}",
           before={k: before.get(k) for k in changed}, after={k: current.get(k) for k in changed})
    db.commit()
    return _settings_payload(db, tenant_id, current)


@router.get("/report-catalog", dependencies=[Depends(_require_view)])
def list_report_catalog(db: Session = Depends(get_db), current_user: GRCUser = Depends(require_auth)):
    """The audit reports and exams findings are picked against."""
    from sqlalchemy.exc import IntegrityError

    tenant_id = get_user_primary_tenant(current_user, db)
    try:
        rows = register_settings.report_catalog(db, tenant_id)
        db.commit()                                  # the sync may have added some
    except IntegrityError:                           # another request added the same one first
        db.rollback()
        rows = register_settings.report_catalog(db, tenant_id)
    return rows


@router.post("/report-catalog", dependencies=[Depends(_require_create)])
def add_report(
    body: Dict[str, Any],
    request: Request,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    tenant_id = get_user_primary_tenant(current_user, db)
    try:
        report = register_settings.create_report(db, tenant_id, str(body.get("source") or ""),
                                                 body, current_user)
    except ValueError as exc:
        db.rollback()
        _bad_request(exc)
    _audit(request, db, tenant_id, current_user, "report_added",
           f"Added the audit report \"{report.report_name or report.report_number}\" "
           f"({T.SOURCE_TITLES.get(report.source, report.source)})",
           resource_name=report.report_name or report.report_number,
           after=register_settings.report_payload(report))
    db.commit()
    return register_settings.report_payload(report)


def _report_or_404(db: Session, tenant_id: int, report_id: int) -> AuditRegisterReport:
    report = (db.query(AuditRegisterReport)
              .filter(AuditRegisterReport.id == report_id,
                      AuditRegisterReport.tenant_id == tenant_id).first())
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")
    return report


@router.put("/report-catalog/{report_id}", dependencies=[Depends(_require_create)])
def edit_report(
    report_id: int,
    body: Dict[str, Any],
    request: Request,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """Correct a report once; every finding on it follows."""
    tenant_id = get_user_primary_tenant(current_user, db)
    report = _report_or_404(db, tenant_id, report_id)
    before = register_settings.report_payload(report)
    try:
        moved = register_settings.update_report(db, report, body or {})
    except (ValueError, TypeError) as exc:
        db.rollback()
        _bad_request(exc)
    after = register_settings.report_payload(report)
    _audit(request, db, tenant_id, current_user, "report_updated",
           f"Updated the audit report \"{report.report_name or report.report_number}\" — "
           f"{moved} finding(s) updated",
           resource_name=report.report_name or report.report_number, before=before, after=after)
    db.commit()
    return {**after, "findings_updated": moved}


@router.delete("/report-catalog/{report_id}", dependencies=[Depends(_require_create)])
def remove_report(
    report_id: int,
    request: Request,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    tenant_id = get_user_primary_tenant(current_user, db)
    report = _report_or_404(db, tenant_id, report_id)
    name = report.report_name or report.report_number
    try:
        register_settings.delete_report(db, report)
    except ValueError as exc:
        db.rollback()
        _bad_request(exc)
    _audit(request, db, tenant_id, current_user, "report_deleted",
           f"Removed the audit report \"{name}\" from the list", resource_name=name)
    db.commit()
    return {"deleted": True}


@router.get("/next-reference", dependencies=[Depends(_require_view)])
def suggest_reference(
    template: str,
    report_key: str = None,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """The Issue # a new finding on this report would get."""
    tenant_id = get_user_primary_tenant(current_user, db)
    try:
        return {"reference": register_settings.next_reference(db, tenant_id, template, report_key or None)}
    except ValueError as exc:
        _bad_request(exc)
