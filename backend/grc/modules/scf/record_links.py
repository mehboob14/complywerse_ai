"""Link a control to any record in the platform — the Issues module's pattern.

One registry, one API. A link is written into the *target module's own* link
table wherever one exists (risk, asset, evidence, document, policy statement,
vulnerability, issue), so the record's own page shows the control back. Record
types with no such table (vendor, IS project, critical task, internal control)
use ``grc_control_record_links``.

Everything keys on ``NormalizedControl.id``, so this works for a tenant-authored
custom control and an SCF control alike.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional, Sequence, Tuple

from sqlalchemy import or_
from sqlalchemy.orm import Session

from grc.models import (
    AssetControlLink,
    ControlRecordLink,
    CriticalTask,
    DocumentControlLink,
    Evidence,
    EvidenceControlMapping,
    GovernanceDocument,
    ISProject,
    InternalControl,
    Issue,
    IssueControlLink,
    ITAsset,
    NormalizedControl,
    PolicyStatement,
    Risk,
    RiskControlLink,
    StatementControlMapping,
    Vendor,
    Vulnerability,
    VulnerabilityControlLink,
)
from grc.rich_audit import write_rich_audit_log

MAX_LIMIT = 50


@dataclass(frozen=True)
class LinkSpec:
    """How one record type is searched, displayed and linked."""

    key: str
    label: str                      # singular, for prose ("Risk")
    plural: str                     # tab / group heading ("Risks")
    model: Any
    title_attr: str                 # the record's name
    code_attr: Optional[str]        # its human reference, when it has one
    subtitle_attrs: Sequence[str]   # a line of context under the name
    status_attr: Optional[str]
    search_attrs: Sequence[str]
    url: str                        # frontend route; "{id}" is substituted
    #: Link table + the column holding the record id. ``ControlRecordLink``
    #: means "no table of its own" and is matched on ``record_type`` too.
    link_model: Any
    link_record_col: str
    #: Extra columns to set on insert, computed from (control, record).
    defaults: Optional[Callable[[NormalizedControl, Any], Dict[str, Any]]] = None
    #: Module permissions that also allow writing this link.
    write_perms: Tuple[str, ...] = ()
    #: Rows this type never offers (soft-deleted vendors, for example).
    alive_attr: Optional[str] = None
    extra_filters: Sequence[Any] = field(default_factory=tuple)


def _evidence_defaults(nc: NormalizedControl, record: Any) -> Dict[str, Any]:
    return {
        "control_code": (nc.scf_id or nc.code or "")[:100] or None,
        "control_title": (nc.name or "")[:500] or None,
        "framework_name": "Custom control" if nc.source == "custom" else "SCF",
        "coverage_type": "supporting",
        "rule_based_validation": False,
        # A person attached this; the column defaults to True.
        "created_by_ai": False,
    }


def _statement_defaults(nc: NormalizedControl, record: Any) -> Dict[str, Any]:
    return {
        "tenant_id": record.tenant_id,
        "control_kind": "normalized",
        "control_code": (nc.scf_id or nc.code or "")[:100] or None,
        "control_title": (nc.name or "")[:500] or None,
        "framework_name": "Custom control" if nc.source == "custom" else "SCF",
        "coverage_type": "partial",
        "link_source": "manual",
        "created_by_ai": False,
    }


def _generic_defaults(record_type: str):
    def _apply(nc: NormalizedControl, record: Any) -> Dict[str, Any]:
        return {"tenant_id": record.tenant_id, "record_type": record_type}

    return _apply


SPECS: Dict[str, LinkSpec] = {
    "risk": LinkSpec(
        key="risk", label="Risk", plural="Risks", model=Risk,
        title_attr="title", code_attr=None,
        subtitle_attrs=("risk_category", "category"), status_attr="status",
        search_attrs=("title", "description"), url="/erm/risks/{id}",
        link_model=RiskControlLink, link_record_col="risk_id",
        write_perms=("erm:risks:edit",),
    ),
    "asset": LinkSpec(
        key="asset", label="Asset", plural="Assets", model=ITAsset,
        title_attr="name", code_attr=None,
        subtitle_attrs=("asset_type", "criticality"), status_attr="status",
        search_attrs=("name", "host_name", "ip_address"), url="/assets?asset={id}",
        link_model=AssetControlLink, link_record_col="asset_id",
        write_perms=("assets:asset_inventory:edit",),
    ),
    "evidence": LinkSpec(
        key="evidence", label="Evidence", plural="Evidence", model=Evidence,
        title_attr="name", code_attr=None,
        subtitle_attrs=("evidence_type", "file_name"), status_attr="status",
        search_attrs=("name", "file_name", "description"), url="/evidence/{id}",
        link_model=EvidenceControlMapping, link_record_col="evidence_id",
        defaults=_evidence_defaults, write_perms=("evidence:evidence_library:edit",),
    ),
    "document": LinkSpec(
        key="document", label="Document", plural="Documents", model=GovernanceDocument,
        title_attr="title", code_attr="document_code",
        subtitle_attrs=("doc_type", "current_version"), status_attr="status",
        search_attrs=("title", "document_code", "file_name"),
        url="/governance/documents?document={id}",
        link_model=DocumentControlLink, link_record_col="document_id",
        write_perms=("governance:policies:edit",),
    ),
    "policy_statement": LinkSpec(
        key="policy_statement", label="Policy statement", plural="Policy statements",
        model=PolicyStatement, title_attr="statement_text", code_attr="statement_code",
        subtitle_attrs=("category", "sub_category"), status_attr="status",
        search_attrs=("statement_text", "statement_code", "statement_summary"),
        url="/governance/documents?statement={id}",
        link_model=StatementControlMapping, link_record_col="statement_id",
        defaults=_statement_defaults, write_perms=("governance:policies:edit",),
    ),
    "vulnerability": LinkSpec(
        key="vulnerability", label="Vulnerability", plural="Vulnerabilities",
        model=Vulnerability, title_attr="title", code_attr="vuln_id",
        subtitle_attrs=("severity", "cve_id"), status_attr="status",
        search_attrs=("title", "vuln_id", "cve_id"), url="/vulnerabilities/{id}",
        link_model=VulnerabilityControlLink, link_record_col="vulnerability_id",
        write_perms=("vulnerabilities:vulnerability_register:edit",),
    ),
    "issue": LinkSpec(
        key="issue", label="Issue", plural="Issues", model=Issue,
        title_attr="title", code_attr="code",
        subtitle_attrs=("category", "severity"), status_attr="status",
        search_attrs=("title", "code", "description"), url="/issues?issue={id}",
        link_model=IssueControlLink, link_record_col="issue_id",
        defaults=lambda nc, record: {"link_type": "gap"},
        write_perms=("issue_management:issues:edit",),
    ),
    "vendor": LinkSpec(
        key="vendor", label="Vendor", plural="Vendors", model=Vendor,
        title_attr="name", code_attr=None,
        subtitle_attrs=("tier", "vendor_type"), status_attr="status",
        search_attrs=("name", "description"), url="/vendor-risk/vendors/{id}",
        link_model=ControlRecordLink, link_record_col="record_id",
        defaults=_generic_defaults("vendor"), alive_attr="deleted_at",
        write_perms=("vendor_risk:vendors:edit",),
    ),
    "project": LinkSpec(
        key="project", label="Project", plural="IS projects", model=ISProject,
        title_attr="name", code_attr=None,
        subtitle_attrs=("category", "priority"), status_attr="status",
        search_attrs=("name", "description"), url="/is-projects/{id}",
        link_model=ControlRecordLink, link_record_col="record_id",
        defaults=_generic_defaults("project"), write_perms=("is_projects:projects:edit",),
    ),
    "task": LinkSpec(
        key="task", label="Task", plural="Critical tasks", model=CriticalTask,
        title_attr="title", code_attr=None,
        subtitle_attrs=("category", "severity"), status_attr="status",
        search_attrs=("title", "description"), url="/tasks?task={id}",
        link_model=ControlRecordLink, link_record_col="record_id",
        defaults=_generic_defaults("task"), write_perms=("tasks:critical_tasks:edit",),
    ),
    "internal_control": LinkSpec(
        key="internal_control", label="Internal control", plural="Internal controls",
        model=InternalControl, title_attr="name", code_attr="control_id",
        subtitle_attrs=("category", "control_type"), status_attr="status",
        search_attrs=("name", "control_id", "description"), url="/controls?mode=internal",
        link_model=ControlRecordLink, link_record_col="record_id",
        defaults=_generic_defaults("internal_control"),
        write_perms=("controls:control_library:edit",),
    ),
}

#: Stable order for the picker and the linked-records list.
TYPE_ORDER = (
    "risk", "asset", "evidence", "document", "policy_statement", "vulnerability",
    "issue", "vendor", "project", "task", "internal_control",
)


def list_types() -> List[Dict[str, Any]]:
    return [{
        "key": k,
        "label": SPECS[k].label,
        "plural": SPECS[k].plural,
        "url": SPECS[k].url,
    } for k in TYPE_ORDER]


def _spec(type_key: str) -> LinkSpec:
    spec = SPECS.get((type_key or "").strip().lower())
    if spec is None:
        raise ValueError(f"Unknown record type '{type_key}'")
    return spec


def write_permissions(type_key: str) -> Tuple[str, ...]:
    """Permissions that allow writing this link, besides the control library's."""
    return _spec(type_key).write_perms


def _clip(value: Any, length: int = 160) -> Optional[str]:
    text = str(value or "").strip()
    if not text:
        return None
    return text if len(text) <= length else text[: length - 1] + "…"


def _row_out(spec: LinkSpec, record: Any) -> Dict[str, Any]:
    subtitle = " · ".join(
        str(getattr(record, a, None)).replace("_", " ")
        for a in spec.subtitle_attrs
        if getattr(record, a, None)
    )
    return {
        "type": spec.key,
        "type_label": spec.label,
        "id": record.id,
        "label": _clip(getattr(record, spec.title_attr, None)) or f"{spec.label} #{record.id}",
        "code": getattr(record, spec.code_attr, None) if spec.code_attr else None,
        "subtitle": _clip(subtitle, 120),
        "status": getattr(record, spec.status_attr, None) if spec.status_attr else None,
        "url": spec.url.replace("{id}", str(record.id)),
    }


def _base_query(db: Session, tenant_id: int, spec: LinkSpec):
    q = db.query(spec.model).filter(spec.model.tenant_id == tenant_id)
    if spec.alive_attr:
        q = q.filter(getattr(spec.model, spec.alive_attr).is_(None))
    for f in spec.extra_filters:
        q = q.filter(f)
    return q


def search_targets(
    db: Session,
    tenant_id: int,
    type_key: str,
    q: Optional[str] = None,
    limit: int = 20,
) -> List[Dict[str, Any]]:
    """Records of one type this tenant could link, newest first.

    Search is server-side: a tenant with 40k vulnerabilities cannot ship the
    list to the browser and filter it there.
    """
    spec = _spec(type_key)
    limit = max(1, min(int(limit or 20), MAX_LIMIT))
    query = _base_query(db, tenant_id, spec)
    term = (q or "").strip()
    if term:
        like = f"%{term}%"
        clauses = [getattr(spec.model, a).ilike(like) for a in spec.search_attrs
                   if hasattr(spec.model, a)]
        if clauses:
            query = query.filter(or_(*clauses))
    rows = query.order_by(spec.model.id.desc()).limit(limit).all()
    return [_row_out(spec, r) for r in rows]


def _link_filter(spec: LinkSpec, nc_id: int, record_id: Optional[int] = None):
    clauses = [spec.link_model.normalized_control_id == nc_id]
    if spec.link_model is ControlRecordLink:
        clauses.append(ControlRecordLink.record_type == spec.key)
    if record_id is not None:
        clauses.append(getattr(spec.link_model, spec.link_record_col) == record_id)
    return clauses


def list_links(db: Session, tenant_id: int, nc_id: int) -> List[Dict[str, Any]]:
    """Every record linked to this control, across every type."""
    out: List[Dict[str, Any]] = []
    for key in TYPE_ORDER:
        spec = SPECS[key]
        links = db.query(spec.link_model).filter(*_link_filter(spec, nc_id)).all()
        if not links:
            continue
        by_record = {getattr(ln, spec.link_record_col): ln for ln in links}
        records = (
            _base_query(db, tenant_id, spec)
            .filter(spec.model.id.in_(sorted(by_record)))
            .all()
        )
        for record in records:
            ln = by_record[record.id]
            created = getattr(ln, "created_at", None)
            out.append({
                **_row_out(spec, record),
                "link_id": ln.id,
                "note": getattr(ln, "note", None) or getattr(ln, "notes", None),
                "created_at": created.isoformat() if created else None,
            })
    return out


def link_counts(db: Session, nc_id: int) -> Dict[str, int]:
    """type -> number of links, without loading the records themselves."""
    counts: Dict[str, int] = {}
    for key in TYPE_ORDER:
        spec = SPECS[key]
        n = db.query(spec.link_model).filter(*_link_filter(spec, nc_id)).count()
        if n:
            counts[key] = n
    return counts


def _record_or_error(db: Session, tenant_id: int, spec: LinkSpec, record_id: int) -> Any:
    record = _base_query(db, tenant_id, spec).filter(spec.model.id == int(record_id)).first()
    if record is None:
        raise ValueError(f"No {spec.label.lower()} {record_id} in this tenant")
    return record


def link_record(
    db: Session,
    tenant_id: int,
    nc: NormalizedControl,
    type_key: str,
    record_id: int,
    actor_id: Optional[int] = None,
    note: Optional[str] = None,
) -> Dict[str, Any]:
    """Link one record. Idempotent: a second call returns the existing link."""
    spec = _spec(type_key)
    record = _record_or_error(db, tenant_id, spec, record_id)
    code = nc.scf_id or nc.code

    existing = db.query(spec.link_model).filter(*_link_filter(spec, nc.id, record.id)).first()
    if existing is not None:
        return {**_row_out(spec, record), "link_id": existing.id, "created": False}

    values: Dict[str, Any] = {
        "normalized_control_id": nc.id,
        spec.link_record_col: record.id,
    }
    if spec.defaults:
        values.update(spec.defaults(nc, record))
    if note:
        for attr in ("note", "notes", "rationale", "matching_rationale"):
            if hasattr(spec.link_model, attr):
                values[attr] = note
                break
    if hasattr(spec.link_model, "created_by"):
        values["created_by"] = actor_id
    link = spec.link_model(**values)
    db.add(link)
    db.flush()

    write_rich_audit_log(
        db=db, tenant_id=tenant_id, user_id=actor_id, action="control_link",
        resource_type="control_record_link", resource_id=link.id, resource_name=code,
        resource_url=f"/automation/soc2-controls/{code}?tab=links",
        summary=f"Linked {spec.label.lower()} '{_row_out(spec, record)['label']}' to {code}",
        after={"type": spec.key, "record_id": record.id},
    )
    return {**_row_out(spec, record), "link_id": link.id, "created": True}


def unlink_record(
    db: Session,
    tenant_id: int,
    nc: NormalizedControl,
    type_key: str,
    record_id: int,
    actor_id: Optional[int] = None,
) -> bool:
    spec = _spec(type_key)
    code = nc.scf_id or nc.code
    links = db.query(spec.link_model).filter(*_link_filter(spec, nc.id, int(record_id))).all()
    if not links:
        return False
    for link in links:
        db.delete(link)
    db.flush()
    write_rich_audit_log(
        db=db, tenant_id=tenant_id, user_id=actor_id, action="control_unlink",
        resource_type="control_record_link", resource_id=int(record_id), resource_name=code,
        resource_url=f"/automation/soc2-controls/{code}?tab=links",
        summary=f"Unlinked {spec.label.lower()} #{record_id} from {code}",
        before={"type": spec.key, "record_id": int(record_id)},
    )
    return True


def set_links(
    db: Session,
    tenant_id: int,
    nc: NormalizedControl,
    links: Dict[str, Sequence[int]],
    actor_id: Optional[int] = None,
) -> Dict[str, Any]:
    """Link every id in ``{type: [record_id]}``, skipping ones already linked.

    Used by control create/update, where the form submits the whole picker at
    once. Records that no longer exist are reported, not fatal: one deleted
    asset must not lose the other nine links.
    """
    created, skipped = 0, []
    for type_key, ids in (links or {}).items():
        for record_id in ids or []:
            try:
                result = link_record(db, tenant_id, nc, type_key, int(record_id), actor_id)
            except ValueError as exc:
                skipped.append(str(exc))
                continue
            created += 1 if result["created"] else 0
    return {"created": created, "skipped": skipped}


def unlink_all_missing(
    db: Session,
    tenant_id: int,
    nc: NormalizedControl,
    links: Dict[str, Sequence[int]],
    actor_id: Optional[int] = None,
) -> int:
    """Remove links of the given types that are not in ``links`` (edit form)."""
    removed = 0
    for type_key, ids in (links or {}).items():
        spec = _spec(type_key)
        keep = {int(x) for x in (ids or [])}
        for link in db.query(spec.link_model).filter(*_link_filter(spec, nc.id)).all():
            record_id = getattr(link, spec.link_record_col)
            if record_id in keep:
                continue
            if unlink_record(db, tenant_id, nc, type_key, record_id, actor_id):
                removed += 1
    return removed


def links_for_record(
    db: Session,
    tenant_id: int,
    type_key: str,
    record_id: int,
) -> List[Dict[str, Any]]:
    """The controls linked to one record — the reverse view."""
    spec = _spec(type_key)
    clauses = [getattr(spec.link_model, spec.link_record_col) == int(record_id)]
    if spec.link_model is ControlRecordLink:
        clauses.append(ControlRecordLink.record_type == spec.key)
    nc_ids = sorted({
        ln.normalized_control_id
        for ln in db.query(spec.link_model).filter(*clauses).all()
        if ln.normalized_control_id
    })
    if not nc_ids:
        return []
    rows = db.query(NormalizedControl).filter(NormalizedControl.id.in_(nc_ids)).all()
    return [{
        "normalized_control_id": r.id,
        "code": r.scf_id or r.code,
        "title": r.name,
        "source": r.source,
        "url": f"/automation/soc2-controls/{r.scf_id or r.code}",
    } for r in rows if (r.tenant_id is None or r.tenant_id == tenant_id)]
