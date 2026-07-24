"""Startup backfill for local, repo-shipped control data.

Fresh tenants already get framework JSONs during provisioning. This module
handles existing tenant databases after a pull: on backend startup it fills any
missing local framework catalog data and creates the static normalized-control
baseline from ``seed_data/normalization_baseline.json`` when no live baseline
exists. It never calls AI.
"""

from __future__ import annotations

import json
import logging
import os
import re
from contextlib import redirect_stdout
from datetime import datetime, timedelta
from io import StringIO
from pathlib import Path
from typing import Any, Iterable, Optional

from sqlalchemy.orm import Session

from .db import MasterSession, get_tenant_engine, open_tenant_session
from .models import (
    AuditPlanEntry,
    Base,
    CommonControlGroup,
    CommonControlGroupMapping,
    ComplianceAssessmentDocument,
    ComplianceAssessmentDocumentItem,
    ComplianceSlaPolicy,
    GovernanceDocument,
    GRCUser,
    ISProject,
    ISProjectMilestone,
    ITAsset,
    Issue,
    IssueAction,
    NormalizationRun,
    NormalizedControl,
    NormalizedControlLink,
    ParsedFrameworkControl,
    Risk,
    RiskIncident,
    Tenant,
    UploadedFramework,
)

logger = logging.getLogger(__name__)

_DISABLE_VALUES = {"1", "true", "yes", "on"}
_SEED_ROOT = Path(__file__).resolve().parent / "seed_data"
_FRAMEWORK_SEED_DIR = _SEED_ROOT / "frameworks"
_BASELINE_PATH = _SEED_ROOT / "normalization_baseline.json"
_ASSESSMENT_SEED_PATH = _SEED_ROOT / "compliance_assessments_seed.json"
_ASSESSMENT_SNAPSHOT_PATH = _SEED_ROOT / "compliance_assessments_snapshot.json"
_DCC_CATALOG_PATH = _SEED_ROOT / "dcc_catalog.json"
_ASSESSMENT_SEED_SOURCE = "Startup Seed"


def _disabled() -> bool:
    return os.getenv("DISABLE_TENANT_STARTUP_SEED", "").strip().lower() in _DISABLE_VALUES


def _norm(value: Optional[str]) -> str:
    return re.sub(r"[^a-z0-9]+", "", (value or "").lower())


def _short(value: Optional[str], limit: int) -> str:
    text = (value or "").strip()
    return text[:limit]


def _seed_framework_catalog() -> dict[str, Path]:
    catalog: dict[str, Path] = {}
    if not _FRAMEWORK_SEED_DIR.exists():
        return catalog
    for path in _FRAMEWORK_SEED_DIR.glob("*.json"):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            name = ((data.get("metadata") or {}).get("name") or "").strip()
            if name:
                catalog[name] = path
        except Exception:
            logger.warning("Could not read framework seed %s", path, exc_info=True)
    return catalog


def _load_baseline() -> Optional[dict]:
    if not _BASELINE_PATH.exists():
        return None
    try:
        return json.loads(_BASELINE_PATH.read_text(encoding="utf-8"))
    except Exception:
        logger.exception("Could not load static normalization baseline %s", _BASELINE_PATH)
        return None


def _first_user_id(db: Session) -> int:
    # NOTE: use .first() (LIMIT 1), not .scalar() — .scalar() delegates to
    # .one() in this SQLAlchemy version and raises MultipleResultsFound once a
    # tenant has more than one user, which broke startup seeding.
    row = db.query(GRCUser.id).order_by(GRCUser.id.asc()).first()
    return int((row[0] if row else None) or 1)


def _tenant_payload(row: Tenant) -> dict:
    return {
        "id": row.id,
        "name": row.name,
        "slug": row.slug,
        "subdomain": row.subdomain,
        "schema_name": row.schema_name,
        "settings": row.settings or {},
        "legal_entity": row.legal_entity,
        "industry": row.industry,
        "regulatory_scope": row.regulatory_scope,
        "company_size": row.company_size,
        "geography": row.geography,
        "primary_contact_name": row.primary_contact_name,
        "primary_contact_email": row.primary_contact_email,
        "primary_contact_phone": row.primary_contact_phone,
    }


def _ensure_local_tenant_row(db: Session, tenant: dict) -> None:
    existing = db.query(Tenant).filter(Tenant.id == tenant["id"]).first()
    if existing:
        return
    db.add(
        Tenant(
            id=tenant["id"],
            name=tenant["name"],
            slug=tenant["slug"],
            subdomain=tenant.get("subdomain"),
            schema_name=tenant.get("schema_name"),
            is_active=True,
            settings=tenant.get("settings") or {},
            legal_entity=tenant.get("legal_entity"),
            industry=tenant.get("industry"),
            regulatory_scope=tenant.get("regulatory_scope"),
            company_size=tenant.get("company_size"),
            geography=tenant.get("geography"),
            primary_contact_name=tenant.get("primary_contact_name"),
            primary_contact_email=tenant.get("primary_contact_email"),
            primary_contact_phone=tenant.get("primary_contact_phone"),
        )
    )
    db.flush()


def ensure_local_framework_catalog(db: Session) -> dict:
    """Seed missing local framework JSONs into the tenant database."""
    seed_catalog = _seed_framework_catalog()
    if not seed_catalog:
        return {"seeded": False, "reason": "no_seed_files"}

    existing_names = {
        name for (name,) in db.query(UploadedFramework.name).all()
    }
    missing = sorted(set(seed_catalog) - existing_names)
    if not missing:
        return {"seeded": False, "missing": 0}

    from .seed_frameworks import load_framework_json, seed_framework_from_json

    before_frameworks = db.query(UploadedFramework).count()
    before_controls = db.query(ParsedFrameworkControl).count()
    user_id = _first_user_id(db)
    seeded_count = 0
    for name in missing:
        data = load_framework_json(str(seed_catalog[name]))
        if data is None:
            continue
        # The shared seeder prints operator-facing progress and defensive
        # truncation notices. Capture them so backend startup remains readable;
        # exceptions still escape and roll back the tenant seed transaction.
        stdout = StringIO()
        with redirect_stdout(stdout):
            seeded = seed_framework_from_json(db, data, uploaded_by=user_id)
        if seeded is not None:
            seeded_count += 1
        output = stdout.getvalue().strip()
        if output:
            logger.debug("Framework seed output for %s:\n%s", name, output)
    db.flush()
    return {
        "seeded": True,
        "missing": len(missing),
        "created_frameworks": max(0, db.query(UploadedFramework).count() - before_frameworks),
        "created_controls": max(0, db.query(ParsedFrameworkControl).count() - before_controls),
        "seed_returned": seeded_count,
    }


def _baseline_exists(db: Session, tenant_id: int) -> bool:
    return db.query(NormalizationRun.id).filter(
        NormalizationRun.tenant_id == tenant_id,
        NormalizationRun.status == "completed",
        NormalizationRun.is_baseline.is_(True),
    ).first() is not None


def _framework_key_maps(db: Session) -> tuple[dict[int, str], dict[str, int]]:
    frameworks = db.query(UploadedFramework.id, UploadedFramework.name).all()
    id_to_key = {fid: _norm(name) for fid, name in frameworks}
    name_to_id: dict[str, int] = {}
    for fid, name in frameworks:
        key = _norm(name)
        if key and key not in name_to_id:
            name_to_id[key] = fid
    return id_to_key, name_to_id


def _control_indexes(
    db: Session,
    framework_keys: dict[int, str],
) -> tuple[dict[tuple[str, str], int], dict[tuple[str, str], int]]:
    by_ref: dict[tuple[str, str], int] = {}
    by_title: dict[tuple[str, str], int] = {}
    rows = db.query(ParsedFrameworkControl).all()
    for control in rows:
        fw_key = framework_keys.get(control.uploaded_framework_id, "")
        if not fw_key:
            continue
        for ref in (control.original_reference, control.control_id):
            ref_key = _norm(ref)
            if ref_key:
                by_ref.setdefault((fw_key, ref_key), control.id)
        title_key = _norm(control.title)
        if title_key:
            by_title.setdefault((fw_key, title_key), control.id)
    return by_ref, by_title


def _resolve_framework_key(name: Optional[str], framework_names: dict[str, int]) -> str:
    key = _norm(name)
    if key in framework_names:
        return key
    for candidate in framework_names:
        if key and (key in candidate or candidate in key):
            return candidate
    return key


def _find_parsed_control(
    member: dict,
    framework_names: dict[str, int],
    by_ref: dict[tuple[str, str], int],
    by_title: dict[tuple[str, str], int],
) -> Optional[int]:
    fw_key = _resolve_framework_key(member.get("framework"), framework_names)
    ref_key = _norm(member.get("ref"))
    if fw_key and ref_key:
        found = by_ref.get((fw_key, ref_key))
        if found:
            return found
    title_key = _norm(member.get("title"))
    if fw_key and title_key:
        return by_title.get((fw_key, title_key))
    return None


def _iter_domains(payload: dict) -> Iterable[str]:
    seen: set[str] = set()
    for domain in payload.get("domains") or []:
        if domain and domain not in seen:
            seen.add(domain)
            yield domain
    for item in list(payload.get("unified") or []) + list(payload.get("standalone") or []):
        domain = item.get("domain")
        if domain and domain not in seen:
            seen.add(domain)
            yield domain


def ensure_static_control_library_baseline(db: Session, tenant_id: int) -> dict:
    """Create the local static normalized-control baseline if none exists."""
    if _baseline_exists(db, tenant_id):
        return {"seeded": False, "reason": "baseline_exists"}
    if db.query(ParsedFrameworkControl.id).first() is None:
        return {"seeded": False, "reason": "no_framework_controls"}

    payload = _load_baseline()
    if not payload:
        return {"seeded": False, "reason": "baseline_file_missing"}

    framework_keys, framework_names = _framework_key_maps(db)
    by_ref, by_title = _control_indexes(db, framework_keys)

    run = NormalizationRun(
        tenant_id=tenant_id,
        label=payload.get("label") or "Static local baseline",
        scope="full",
        framework_ids=None,
        status="running",
        is_baseline=True,
        created_by=None,
        started_at=datetime.utcnow(),
        summary={"seed_source": "seed_data/normalization_baseline.json"},
    )
    db.add(run)
    db.flush()

    groups: dict[str, CommonControlGroup] = {}
    for seq, domain in enumerate(_iter_domains(payload), start=1):
        group = CommonControlGroup(
            tenant_id=tenant_id,
            run_id=run.id,
            code=f"FDOM-{run.id}-{seq:02d}",
            name=_short(domain, 255),
            domain=_short(domain, 100),
            category=_short(domain, 100),
            keywords=[],
            evidence_types=[],
            created_by=None,
        )
        db.add(group)
        db.flush()
        groups[domain] = group

    def group_for(domain: str) -> CommonControlGroup:
        if domain in groups:
            return groups[domain]
        seq = len(groups) + 1
        group = CommonControlGroup(
            tenant_id=tenant_id,
            run_id=run.id,
            code=f"FDOM-{run.id}-{seq:02d}",
            name=_short(domain, 255),
            domain=_short(domain, 100),
            category=_short(domain, 100),
            keywords=[],
            evidence_types=[],
            created_by=None,
        )
        db.add(group)
        db.flush()
        groups[domain] = group
        return group

    created_unified = 0
    created_standalone = 0
    matched_links = 0
    missing_links = 0

    for seq, item in enumerate(payload.get("unified") or [], start=1):
        domain = item.get("domain") or "Unclassified"
        group = group_for(domain)
        nc = NormalizedControl(
            run_id=run.id,
            code=f"NCB{run.id}-{seq:04d}",
            name=_short(item.get("name"), 255) or f"Unified Control {seq}",
            source="ai_normalized",
            common_group_id=group.id,
            domain=_short(domain, 255),
            recommended_evidence=item.get("evidence") or None,
            maturity_level=0,
            review_status="approved",
        )
        db.add(nc)
        db.flush()
        db.add(
            CommonControlGroupMapping(
                group_id=group.id,
                normalized_control_id=nc.id,
                mapping_confidence=1.0,
                mapping_source="static_baseline",
            )
        )
        created_unified += 1
        for member in item.get("members") or []:
            parsed_id = _find_parsed_control(member, framework_names, by_ref, by_title)
            if parsed_id:
                db.add(
                    NormalizedControlLink(
                        normalized_control_id=nc.id,
                        parsed_control_id=parsed_id,
                        mapping_type="direct",
                    )
                )
                matched_links += 1
            else:
                missing_links += 1

    for seq, item in enumerate(payload.get("standalone") or [], start=1):
        domain = item.get("domain") or "Unclassified"
        group = group_for(domain)
        nc = NormalizedControl(
            run_id=run.id,
            code=f"NCS{run.id}-{seq:04d}",
            name=_short(item.get("title"), 255) or f"Standalone Control {seq}",
            statement=item.get("title"),
            source="static_standalone",
            common_group_id=group.id,
            domain=_short(domain, 255),
            recommended_evidence=item.get("evidence") or None,
            maturity_level=0,
            review_status="approved",
        )
        db.add(nc)
        db.flush()
        db.add(
            CommonControlGroupMapping(
                group_id=group.id,
                normalized_control_id=nc.id,
                mapping_confidence=1.0,
                mapping_source="standalone",
            )
        )
        created_standalone += 1
        parsed_id = _find_parsed_control(item, framework_names, by_ref, by_title)
        if parsed_id:
            db.add(
                NormalizedControlLink(
                    normalized_control_id=nc.id,
                    parsed_control_id=parsed_id,
                    mapping_type="direct",
                )
            )
            matched_links += 1
        else:
            missing_links += 1

    run.status = "completed"
    run.completed_at = datetime.utcnow()
    run.summary = {
        "seed_source": "seed_data/normalization_baseline.json",
        "domains": len(groups),
        "unified_controls": created_unified,
        "standalone": created_standalone,
        "controls_covered": created_unified + created_standalone,
        "raw_members_linked": matched_links,
        "raw_members_unmatched": missing_links,
        "counts_from_file": payload.get("counts") or {},
        "master_list": [item.get("name") for item in payload.get("unified") or [] if item.get("name")],
    }
    db.flush()
    return {
        "seeded": True,
        "run_id": run.id,
        "domains": len(groups),
        "unified": created_unified,
        "standalone": created_standalone,
        "matched_links": matched_links,
        "missing_links": missing_links,
    }


def _load_assessment_seed() -> Optional[dict]:
    if not _ASSESSMENT_SEED_PATH.exists():
        return None
    try:
        return json.loads(_ASSESSMENT_SEED_PATH.read_text(encoding="utf-8"))
    except Exception:
        logger.exception("Could not load assessment seed %s", _ASSESSMENT_SEED_PATH)
        return None


def _load_dcc_catalog() -> list[dict]:
    if not _DCC_CATALOG_PATH.exists():
        return []
    try:
        payload = json.loads(_DCC_CATALOG_PATH.read_text(encoding="utf-8"))
        return payload if isinstance(payload, list) else []
    except Exception:
        logger.exception("Could not load DCC catalog %s", _DCC_CATALOG_PATH)
        return []


def _int_or_none(value: Any) -> Optional[int]:
    if value is None:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _relative_datetime(now: datetime, *, in_days: Any = None, days_ago: Any = None) -> Optional[datetime]:
    delta = _int_or_none(in_days)
    if delta is not None:
        return now + timedelta(days=delta)
    delta = _int_or_none(days_ago)
    if delta is not None:
        return now - timedelta(days=delta)
    return None


def _relative_date(now: datetime, *, in_days: Any = None, days_ago: Any = None):
    dt = _relative_datetime(now, in_days=in_days, days_ago=days_ago)
    return dt.date() if dt else None


def _assessment_stats(items: list[ComplianceAssessmentDocumentItem]) -> dict[str, Any]:
    stats = {
        "total": len(items),
        "complied": 0,
        "partially_complied": 0,
        "not_complied": 0,
        "in_progress": 0,
        "na": 0,
        "overall_score": 0.0,
    }
    for item in items:
        status = item.compliance_status or "in_progress"
        if status in stats:
            stats[status] += 1
    applicable = stats["total"] - stats["na"]
    if applicable > 0:
        stats["overall_score"] = round(
            (stats["complied"] + (stats["partially_complied"] * 0.5)) / applicable * 100,
            2,
        )
    return stats


def _apply_assessment_stats(doc: ComplianceAssessmentDocument, items: list[ComplianceAssessmentDocumentItem]) -> None:
    stats = _assessment_stats(items)
    doc.total_items = stats["total"]
    doc.complied_count = stats["complied"]
    doc.partially_complied_count = stats["partially_complied"]
    doc.not_complied_count = stats["not_complied"]
    doc.in_progress_count = stats["in_progress"]
    doc.na_count = stats["na"]
    doc.overall_score = stats["overall_score"]
    doc.updated_at = datetime.utcnow()


def _seed_item_from_payload(
    *,
    tenant_id: int,
    assessment_id: int,
    item: dict,
    now: datetime,
    default_created_days_ago: int = 21,
) -> ComplianceAssessmentDocumentItem:
    status = item.get("compliance_status") or "in_progress"
    remediation_status = item.get("remediation_status")
    remarks = item.get("remarks")
    if item.get("remarks_json") is not None:
        remarks = json.dumps(item.get("remarks_json") or {}, ensure_ascii=False, sort_keys=True)

    closed_at = _relative_datetime(now, days_ago=item.get("closed_days_ago"))
    if closed_at is None and (status == "complied" or remediation_status == "closed"):
        closed_at = now - timedelta(days=1)
    target_date = _relative_datetime(now, in_days=item.get("target_in_days"))
    created_days = _int_or_none(item.get("created_days_ago"))
    if created_days is None:
        created_days = default_created_days_ago

    return ComplianceAssessmentDocumentItem(
        assessment_id=assessment_id,
        tenant_id=tenant_id,
        item_number=item.get("item_number"),
        area_domain=item.get("area_domain"),
        control_description=item.get("control_description"),
        compliance_status=status,
        gaps_identified=item.get("gaps_identified"),
        proposed_solution=item.get("proposed_solution"),
        responsible_party=item.get("responsible_party"),
        timeline=item.get("timeline"),
        priority=item.get("priority"),
        evidence_reference=item.get("evidence_reference"),
        remarks=remarks,
        maturity_score=item.get("maturity_score"),
        risk_rating=item.get("risk_rating"),
        remediation_status=remediation_status,
        control_source=item.get("control_source"),
        control_type=item.get("control_type"),
        subdomain_name=item.get("subdomain_name"),
        target_date=target_date,
        closed_at=closed_at,
        created_at=now - timedelta(days=max(0, created_days)),
        updated_at=closed_at or now,
    )


def _ensure_assessment_sla_policy(db: Session, tenant_id: int, payload: dict) -> bool:
    if db.query(ComplianceSlaPolicy.id).filter(ComplianceSlaPolicy.tenant_id == tenant_id).first():
        return False
    defaults = payload.get("sla_policy") or {}
    db.add(ComplianceSlaPolicy(tenant_id=tenant_id, **defaults))
    return True


def _ensure_seed_assessment_docs(
    db: Session,
    tenant_id: int,
    user_id: int,
    payload: dict,
) -> dict[str, Any]:
    now = datetime.utcnow()
    created_docs = 0
    created_items = 0

    for doc_data in payload.get("assessments") or []:
        name = (doc_data.get("name") or "").strip()
        fmt = (doc_data.get("assessment_format") or "standard").strip()
        if not name:
            continue
        existing = db.query(ComplianceAssessmentDocument.id).filter(
            ComplianceAssessmentDocument.tenant_id == tenant_id,
            ComplianceAssessmentDocument.name == name,
            ComplianceAssessmentDocument.assessment_format == fmt,
            ComplianceAssessmentDocument.source == _ASSESSMENT_SEED_SOURCE,
        ).first()
        if existing:
            continue

        doc = ComplianceAssessmentDocument(
            tenant_id=tenant_id,
            name=name,
            assessment_type=doc_data.get("assessment_type") or "gap_assessment",
            source=doc_data.get("source") or _ASSESSMENT_SEED_SOURCE,
            file_name=doc_data.get("file_name"),
            status=doc_data.get("status") or "in_progress",
            due_date=_relative_datetime(now, in_days=doc_data.get("due_in_days")),
            assessor=doc_data.get("assessor"),
            notes=doc_data.get("notes") or "Seeded on backend startup from seed_data/compliance_assessments_seed.json.",
            assessment_format=fmt,
            created_by=user_id,
            created_at=now - timedelta(days=30),
            updated_at=now,
        )
        db.add(doc)
        db.flush()

        items: list[ComplianceAssessmentDocumentItem] = []
        for item_data in doc_data.get("items") or []:
            item = _seed_item_from_payload(
                tenant_id=tenant_id,
                assessment_id=doc.id,
                item=item_data,
                now=now,
            )
            db.add(item)
            items.append(item)
        db.flush()
        _apply_assessment_stats(doc, items)
        created_docs += 1
        created_items += len(items)

    return {"created_docs": created_docs, "created_items": created_items}


def _ensure_nca_container_and_dcc(
    db: Session,
    tenant_id: int,
    user_id: int,
    payload: dict,
) -> dict[str, Any]:
    now = datetime.utcnow()
    container_payload = payload.get("nca_container") or {}
    if not container_payload:
        return {"created_container": False, "created_dcc_items": 0, "created_audit_plan_entries": 0}

    fmt = container_payload.get("assessment_format") or "nca_container"
    doc = db.query(ComplianceAssessmentDocument).filter(
        ComplianceAssessmentDocument.tenant_id == tenant_id,
        ComplianceAssessmentDocument.assessment_format == fmt,
    ).first()
    created_container = False
    if doc is None:
        doc = ComplianceAssessmentDocument(
            tenant_id=tenant_id,
            name=container_payload.get("name") or "NCA Cybersecurity Workspace",
            assessment_type=container_payload.get("assessment_type") or "nca_template",
            assessment_format=fmt,
            source=container_payload.get("source") or _ASSESSMENT_SEED_SOURCE,
            status=container_payload.get("status") or "in_progress",
            assessor=container_payload.get("assessor"),
            notes="Seeded NCA container for DCC and audit-plan startup data.",
            created_by=user_id,
            created_at=now - timedelta(days=30),
            updated_at=now,
        )
        db.add(doc)
        db.flush()
        created_container = True

    created_dcc_items = 0
    existing_dcc = db.query(ComplianceAssessmentDocumentItem.id).filter(
        ComplianceAssessmentDocumentItem.assessment_id == doc.id,
        ComplianceAssessmentDocumentItem.control_source == "dcc",
    ).first()
    if existing_dcc is None:
        catalog = _load_dcc_catalog()
        pattern = container_payload.get("dcc_status_pattern") or ["in_progress"]
        items: list[ComplianceAssessmentDocumentItem] = []
        for idx, ctrl in enumerate(catalog, start=1):
            status = pattern[(idx - 1) % len(pattern)] if pattern else "in_progress"
            control_type = (ctrl.get("control_type") or "basic").strip()
            priority = "high" if control_type.lower() in {"basic", "essential"} else "medium"
            item_payload = {
                "item_number": ctrl.get("ref"),
                "area_domain": ctrl.get("main_domain") or "DCC",
                "subdomain_name": ctrl.get("subdomain"),
                "control_description": ctrl.get("control_text_en") or ctrl.get("control_text_ar"),
                "compliance_status": status,
                "priority": priority,
                "control_source": "dcc",
                "control_type": control_type,
                "remarks": f"Ref: {ctrl.get('ref') or ''} | Type: {control_type}",
            }
            if status in {"not_complied", "partially_complied"}:
                item_payload["remediation_status"] = "open" if status == "not_complied" else "in_progress"
                item_payload["target_in_days"] = 14 + (idx % 45)
            elif status == "complied":
                item_payload["closed_days_ago"] = 3 + (idx % 20)
            item = _seed_item_from_payload(
                tenant_id=tenant_id,
                assessment_id=doc.id,
                item=item_payload,
                now=now,
                default_created_days_ago=35,
            )
            db.add(item)
            items.append(item)
        db.flush()
        created_dcc_items = len(items)

    all_items = db.query(ComplianceAssessmentDocumentItem).filter(
        ComplianceAssessmentDocumentItem.assessment_id == doc.id
    ).all()
    _apply_assessment_stats(doc, all_items)

    created_audit_plan_entries = 0
    existing_plan = db.query(AuditPlanEntry.id).filter(AuditPlanEntry.assessment_id == doc.id).first()
    if existing_plan is None:
        audit_entries = container_payload.get("audit_plan") or []
        for idx, entry_data in enumerate(audit_entries, start=1):
            entry_type = entry_data.get("entry_type") or "Audit"
            prefix = "R" if entry_type.lower() == "review" else "A"
            entry = AuditPlanEntry(
                assessment_id=doc.id,
                tenant_id=tenant_id,
                entry_type=entry_type,
                audit_id=f"{prefix}{idx:03d}",
                audit_name=entry_data.get("audit_name"),
                team_responsible=entry_data.get("team_responsible"),
                lead_auditor=entry_data.get("lead_auditor"),
                audit_type=entry_data.get("audit_type"),
                scope=entry_data.get("scope"),
                methods=entry_data.get("methods"),
                criteria=entry_data.get("criteria"),
                sampling=entry_data.get("sampling"),
                evidence_needed=entry_data.get("evidence_needed"),
                duration=entry_data.get("duration"),
                schedule=entry_data.get("schedule"),
                audit_start=_relative_date(now, in_days=entry_data.get("audit_start_in_days")),
                audit_end=_relative_date(now, in_days=entry_data.get("audit_end_in_days")),
                cost=entry_data.get("cost"),
                comment=entry_data.get("comment"),
                status=entry_data.get("status") or "planned",
                priority=entry_data.get("priority"),
                created_at=now,
                updated_at=now,
            )
            db.add(entry)
            created_audit_plan_entries += 1

    return {
        "created_container": created_container,
        "created_dcc_items": created_dcc_items,
        "created_audit_plan_entries": created_audit_plan_entries,
    }


def _run_backend_seed_script(script_name: str, db: Session, slug: str) -> bool:
    """Load backend/seed_demo_*.py and run seed(db, slug|tids)."""
    try:
        import importlib.util
        from pathlib import Path as _Path
        seed_path = _Path(__file__).resolve().parent.parent / script_name
        spec = importlib.util.spec_from_file_location(script_name.replace(".py", ""), seed_path)
        if not (spec and spec.loader):
            return False
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        if script_name == "seed_demo_it_assets.py":
            user = db.query(GRCUser).order_by(GRCUser.id.asc()).first()
            if not user:
                return False
            from .routers.auth_router import get_user_tenants
            tids = get_user_tenants(user, db)
            if not tids:
                return False
            mod.seed(db, tids)
        else:
            mod.seed(db, slug)
        return True
    except Exception:
        logger.exception("Seed script %s failed for tenant %s", script_name, slug)
        return False


def ensure_issues_incidents_seed(db: Session, tenant_id: int) -> dict:
    """Populate issue/incident dashboards — idempotent per code, not all-or-nothing."""
    user_id = _first_user_id(db)
    now = datetime.utcnow()
    out: dict[str, Any] = {"seeded": False, "issues_created": 0, "incidents_created": 0, "actions_created": 0}

    existing_codes = {
        row[0] for row in db.query(Issue.code).filter(Issue.tenant_id == tenant_id).all() if row[0]
    }
    specs = [
        ("ISS-001", "Privileged access review overdue", "high", "open", False, 5),
        ("ISS-002", "Backup validation failure on finance DB", "critical", "in_progress", True, -2),
        ("ISS-003", "Vendor SOC report expired", "medium", "open", False, 14),
        ("ISS-004", "Change ticket missing CAB approval", "low", "closed", False, None),
    ]
    for code, title, severity, wf, breached, due_days in specs:
        if code in existing_codes:
            continue
        issue = Issue(
            tenant_id=tenant_id,
            code=code,
            title=title,
            description=f"Operational issue seeded for dashboard metrics: {title}.",
            severity=severity,
            status="open" if wf != "closed" else "closed",
            workflow_state=wf,
            issue_type="audit_finding",
            category="security",
            impact="high" if severity in ("critical", "high") else "medium",
            urgency="high" if severity in ("critical", "high") else "medium",
            owner_id=user_id,
            assignee_id=user_id,
            reporter_id=user_id,
            sla_breached=breached,
            due_date=now + timedelta(days=due_days) if due_days is not None else None,
            closed_at=now - timedelta(days=3) if wf == "closed" else None,
        )
        db.add(issue)
        db.flush()
        db.add(IssueAction(
            issue_id=issue.id,
            action_type="corrective",
            title=f"Remediate: {title[:60]}",
            status="completed" if wf == "closed" else ("in_progress" if wf == "in_progress" else "planned"),
            assignee_id=user_id,
            due_date=now + timedelta(days=(due_days or 10)),
            completed_at=now - timedelta(days=1) if wf == "closed" else None,
            created_by=user_id,
        ))
        out["issues_created"] += 1
        out["seeded"] = True

    if not db.query(RiskIncident.id).filter(RiskIncident.tenant_id == tenant_id).first():
        risk = db.query(Risk.id).filter(Risk.tenant_id == tenant_id).order_by(Risk.id.asc()).first()
        incident_specs = [
            ("Phishing campaign blocked at mail gateway", "high", "resolved", 12, True),
            ("Unauthorized API access attempt", "critical", "investigating", 4, False),
        ]
        for title, severity, status, ago, with_rca in incident_specs:
            occurred = now - timedelta(days=ago)
            discovered = occurred + timedelta(days=1)
            resolved = now - timedelta(days=max(ago - 3, 1)) if status == "resolved" else None
            db.add(RiskIncident(
                tenant_id=tenant_id,
                risk_id=risk.id if risk else None,
                title=title,
                severity=severity,
                status=status,
                incident_date=occurred,
                discovered_date=discovered,
                reported_by=user_id,
                resolved_at=resolved,
                root_cause="Credential reuse on a third-party integration." if with_rca else None,
                financial_impact=12500.0 if with_rca else None,
                operational_impact="Mail flow delayed 45 minutes during containment." if with_rca else None,
            ))
            out["incidents_created"] += 1
        out["seeded"] = True

    if not db.query(IssueAction.id).join(Issue, Issue.id == IssueAction.issue_id).filter(Issue.tenant_id == tenant_id).first():
        for issue in db.query(Issue).filter(Issue.tenant_id == tenant_id).all():
            db.add(IssueAction(
                issue_id=issue.id,
                action_type="corrective",
                title=f"Remediate: {issue.title[:60]}",
                status="in_progress" if (issue.workflow_state or "") not in ("closed", "cancelled") else "completed",
                assignee_id=user_id,
                due_date=now + timedelta(days=10),
                completed_at=now - timedelta(days=1) if (issue.workflow_state or "") == "closed" else None,
                created_by=user_id,
            ))
        out["seeded"] = True
        out["actions_created"] = len(
            db.query(IssueAction.id).join(Issue, Issue.id == IssueAction.issue_id)
            .filter(Issue.tenant_id == tenant_id).all()
        )

    if not out["seeded"]:
        out["reason"] = "issues_and_incidents_exist"
    return out


def ensure_assurance_workbench_seed(db: Session, tenant_id: int, user_id: Optional[int] = None) -> dict:
    """Materialize CT&A work items from internal controls so assurance scorecards have data."""
    from grc.models import InternalControl, ControlWorkItem
    from grc.modules.control_library.routers.workbench import ensure_tables, sync_internal_control_work_items

    out: dict[str, Any] = {"seeded": False, "work_items": 0}
    try:
        uid = user_id or _first_user_id(db)
        ensure_tables(db)
        now = datetime.utcnow()
        for ic in db.query(InternalControl).filter(InternalControl.tenant_id == tenant_id).all():
            if ic.status == "pending_approval":
                ic.status = "active"
            if ic.status == "active":
                if not ic.next_test_date:
                    ic.next_test_date = now + timedelta(days=45)
                if not ic.last_tested_at and (ic.design_effectiveness or "") != "not_tested":
                    ic.last_tested_at = now - timedelta(days=21)
                if not ic.design_effectiveness or ic.design_effectiveness == "not_tested":
                    ic.design_effectiveness = "partially_effective"
                if not ic.operating_effectiveness or ic.operating_effectiveness == "not_tested":
                    ic.operating_effectiveness = "partially_effective"
        sync_internal_control_work_items(db, tenant_id, created_by=uid)
        out["work_items"] = db.query(ControlWorkItem).filter(ControlWorkItem.tenant_id == tenant_id).count()
        out["seeded"] = out["work_items"] > 0
    except Exception:
        logger.exception("Assurance workbench seed failed for tenant %s", tenant_id)
        out["reason"] = "error"
    return out


def ensure_operational_dashboard_seed(db: Session, tenant_id: int, slug: str) -> dict:
    """ERM, compliance, assets, and issues data powering module overview boards."""
    out: dict[str, Any] = {
        "erm": False, "compliance": False, "assets": False, "issues": False,
    }
    if not db.query(Risk.id).filter(Risk.title.like("[DEMO]%")).first():
        out["erm"] = _run_backend_seed_script("seed_demo_erm.py", db, slug)
    if not db.query(UploadedFramework.id).filter(UploadedFramework.name.like("[DEMO]%")).first():
        out["compliance"] = _run_backend_seed_script("seed_demo_compliance.py", db, slug)
    if not db.query(ITAsset.id).filter(ITAsset.name.like("[DEMO]%")).first():
        out["assets"] = _run_backend_seed_script("seed_demo_it_assets.py", db, slug)
    issues = ensure_issues_incidents_seed(db, tenant_id)
    out["issues"] = issues.get("seeded", False)
    out["issues_detail"] = issues
    assurance = ensure_assurance_workbench_seed(db, tenant_id)
    out["assurance"] = assurance.get("seeded", False)
    out["assurance_detail"] = assurance
    return out


def ensure_governance_dashboard_seed(db: Session, tenant_id: int, slug: str) -> dict:
    """Backfill governance portfolio + IS projects so section cards have data."""
    out: dict[str, Any] = {"governance_docs": False, "is_projects": False}

    has_demo_docs = db.query(GovernanceDocument.id).filter(
        GovernanceDocument.tenant_id == tenant_id,
        GovernanceDocument.document_code.like("DEMO-%"),
    ).first()
    if not has_demo_docs:
        try:
            import importlib.util
            from pathlib import Path as _Path
            seed_path = _Path(__file__).resolve().parent.parent / "seed_demo_governance_docs.py"
            spec = importlib.util.spec_from_file_location("seed_demo_governance_docs", seed_path)
            if spec and spec.loader:
                mod = importlib.util.module_from_spec(spec)
                spec.loader.exec_module(mod)
                mod.seed(db, slug)
                out["governance_docs"] = True
        except Exception:
            logger.exception("Governance portfolio seed failed for tenant %s", slug)

    if db.query(ISProject.id).filter(ISProject.tenant_id == tenant_id).first():
        return out

    user_id = _first_user_id(db)
    now = datetime.utcnow()
    specs = [
        ("ISO 27001 Certification Program", "In Progress", "On Track", 120, 185000, 94000),
        ("Privileged Access Management Rollout", "In Progress", "On Track", 90, 75000, 68000),
        ("Security Awareness Platform Refresh", "Planning", "At Risk", 180, 42000, 12000),
    ]
    created = 0
    for name, status, health, days_out, budget_est, budget_act in specs:
        proj = ISProject(
            tenant_id=tenant_id,
            name=name,
            description=f"Governance-tracked initiative: {name}.",
            category="Security",
            priority="High",
            status=status,
            health=health,
            project_owner_id=user_id,
            created_by=user_id,
            start_date=now - timedelta(days=45),
            target_end_date=now + timedelta(days=days_out),
            budget_estimated=float(budget_est),
            budget_actual=float(budget_act),
            business_justification="Seeded on backend startup to populate governance IS Projects metrics.",
            completion_percentage=35 if status == "In Progress" else 10,
        )
        db.add(proj)
        db.flush()
        db.add(ISProjectMilestone(
            project_id=proj.id,
            name="Phase 1 — design complete",
            description="Initial design and stakeholder sign-off.",
            target_date=now - timedelta(days=10),
            actual_completion_date=now - timedelta(days=3),
            status="completed",
            completion_percentage=100,
        ))
        db.add(ISProjectMilestone(
            project_id=proj.id,
            name="Phase 2 — implementation",
            description="Core implementation and control validation.",
            target_date=now + timedelta(days=45),
            status="in_progress",
            completion_percentage=40,
        ))
        created += 1
    out["is_projects"] = created > 0
    out["is_projects_created"] = created
    return out


def ensure_vendor_risk_portfolio_seed(db: Session, tenant_id: int) -> dict:
    """Seed TPRM portfolio + templates when a tenant has no vendors (powers dashboard tabs)."""
    from grc.models import Vendor
    if db.query(Vendor.id).filter(Vendor.tenant_id == tenant_id).first():
        return {"seeded": False, "reason": "has_vendors"}
    try:
        from grc.modules.vendor_risk.tpra.seed import seed_templates, seed_portfolio
        from grc.modules.vendor_risk.tpra.bootstrap import ensure_tpra_tenant_defaults
        from grc.modules.vendor_risk.tpra.schema_migrations import ensure_tpra_columns
        # Startup seeding runs before any request, so TPRA's request-path column
        # self-heal hasn't added post-provisioning columns yet. Heal first so the
        # monitoring-signal insert below has acknowledged_by/_at etc.
        ensure_tpra_columns(db)
        ensure_tpra_tenant_defaults(db, tenant_id)
        templates = seed_templates(db, tenant_id)
        portfolio = seed_portfolio(db, tenant_id, months=12)
        db.commit()
        return {
            "seeded": bool(templates or portfolio.get("created")),
            "templates": templates,
            "portfolio": portfolio,
        }
    except Exception:
        logger.exception("Vendor risk portfolio seed failed for tenant %s", tenant_id)
        db.rollback()
        return {"seeded": False, "reason": "error"}


def ensure_kpi_trend_history_seed(db: Session, tenant_id: int) -> dict:
    """Backfill weekly trend points for live KPI metrics (powers dashboard sparklines)."""
    try:
        from grc.services import metric_snapshots as ms
        from grc.modules.assessments.kpi_live import compute_kpi_metrics
        import math
        from datetime import datetime, timedelta

        ms.ensure_table(db)
        from grc.models import MetricSnapshot
        if db.query(MetricSnapshot.id).filter(
            MetricSnapshot.tenant_id == tenant_id,
            MetricSnapshot.metric.like("kpi_%"),
        ).first():
            return {"seeded": False, "reason": "already_has_history"}

        now = datetime.utcnow()
        metrics = compute_kpi_metrics(db, now, tenant_ids=[tenant_id])
        today = now.date()
        written = 0
        weeks = 9
        for key, m in metrics.items():
            cur = m.get("actual")
            if cur is None:
                continue
            offset = sum(ord(c) for c in key) % 7
            start = max(0.0, cur - 18.0)
            for i in range(weeks):
                frac = i / float(weeks)
                base = start + (cur - start) * frac
                wobble = 5.0 * math.sin(i * 1.1 + offset)
                val = max(0.0, min(100.0, round(base + wobble, 1)))
                d = today - timedelta(weeks=(weeks - i))
                ms.upsert(db, tenant_id, f"kpi_{key}", d, val)
                written += 1
        return {"seeded": written > 0, "points_written": written}
    except Exception:
        logger.exception("KPI trend history seed failed for tenant %s", tenant_id)
        return {"seeded": False, "reason": "error"}


def _load_assessment_snapshot() -> Optional[dict]:
    if not _ASSESSMENT_SNAPSHOT_PATH.exists():
        return None
    try:
        return json.loads(_ASSESSMENT_SNAPSHOT_PATH.read_text(encoding="utf-8"))
    except Exception:
        logger.exception("Could not load assessment snapshot %s", _ASSESSMENT_SNAPSHOT_PATH)
        return None


def _deser_snapshot_value(v: Any) -> Any:
    """Reverse the export's date wrapper {"__dt__": <iso>} back into a datetime."""
    if isinstance(v, dict) and set(v.keys()) == {"__dt__"}:
        try:
            return datetime.fromisoformat(v["__dt__"])
        except Exception:
            return None
    return v


def ensure_assessment_snapshot_seed(db: Session, tenant_id: int, user_id: int) -> dict:
    """Recreate the full real compliance assessments (documents + every item) from the
    committed snapshot (``compliance_assessments_snapshot.json``), so a fresh tenant DB
    reproduces the live Cyber Security / NCA / PDPL / DPIA dashboards exactly. Idempotent
    per document name: an existing document of the same name for the tenant is left as-is."""
    payload = _load_assessment_snapshot()
    out = {"created_docs": 0, "created_items": 0, "skipped_docs": 0}
    if not payload:
        return out
    doc_cols = {c.name for c in ComplianceAssessmentDocument.__table__.columns}
    item_cols = {c.name for c in ComplianceAssessmentDocumentItem.__table__.columns}
    for entry in payload.get("assessments") or []:
        name = entry.get("name")
        if not name:
            continue
        exists = (
            db.query(ComplianceAssessmentDocument.id)
            .filter(
                ComplianceAssessmentDocument.tenant_id == tenant_id,
                ComplianceAssessmentDocument.name == name,
            )
            .first()
        )
        if exists:
            out["skipped_docs"] += 1
            continue
        doc_kwargs = {
            k: _deser_snapshot_value(v)
            for k, v in entry.items()
            if k != "items" and k in doc_cols
        }
        doc = ComplianceAssessmentDocument(tenant_id=tenant_id, created_by=user_id, **doc_kwargs)
        db.add(doc)
        db.flush()  # assign doc.id for the item FK
        for it in entry.get("items") or []:
            item_kwargs = {
                k: _deser_snapshot_value(v) for k, v in it.items() if k in item_cols
            }
            db.add(
                ComplianceAssessmentDocumentItem(
                    tenant_id=tenant_id, assessment_id=doc.id, **item_kwargs
                )
            )
            out["created_items"] += 1
        out["created_docs"] += 1
    return out


def ensure_compliance_assessment_seed_data(db: Session, tenant_id: int) -> dict:
    """Seed local compliance assessment records that power /assessments dashboards.

    The real assessment content (Cyber Security, NCA/DCC, PDPL, DPIA, …) is restored
    verbatim from ``compliance_assessments_snapshot.json``; the thin
    ``compliance_assessments_seed.json`` is retained only for the SLA policy."""
    user_id = _first_user_id(db)
    thin = _load_assessment_seed()
    policy_created = _ensure_assessment_sla_policy(db, tenant_id, thin) if thin else False
    snap = ensure_assessment_snapshot_seed(db, tenant_id, user_id)
    seeded = bool(policy_created or snap["created_docs"] or snap["created_items"])
    return {
        "seeded": seeded,
        "sla_policy_created": policy_created,
        **snap,
    }


def ensure_startup_seed_data() -> dict:
    """Backfill all active tenant DBs from local seed files."""
    if _disabled():
        logger.info("Tenant startup seed is disabled")
        return {"disabled": True, "tenants": 0}

    master = MasterSession()
    try:
        tenants = [
            _tenant_payload(row)
            for row in master.query(Tenant).filter(Tenant.is_active.is_(True)).order_by(Tenant.id).all()
        ]
    finally:
        master.close()

    summary: dict[str, Any] = {"disabled": False, "tenants": len(tenants), "seeded": []}
    for tenant in tenants:
        slug = tenant["slug"]
        db: Optional[Session] = None
        try:
            engine = get_tenant_engine(slug)
            Base.metadata.create_all(bind=engine)
            db = open_tenant_session(slug)
            _ensure_local_tenant_row(db, tenant)
            catalog = ensure_local_framework_catalog(db)
            baseline = ensure_static_control_library_baseline(db, tenant["id"])
            assessments = ensure_compliance_assessment_seed_data(db, tenant["id"])
            governance = ensure_governance_dashboard_seed(db, tenant["id"], slug)
            operational = ensure_operational_dashboard_seed(db, tenant["id"], slug)
            vendor_risk = ensure_vendor_risk_portfolio_seed(db, tenant["id"])
            kpi_history = ensure_kpi_trend_history_seed(db, tenant["id"])
            db.commit()
            if (catalog.get("seeded") or baseline.get("seeded") or assessments.get("seeded")
                    or governance.get("governance_docs") or governance.get("is_projects")
                    or operational.get("erm") or operational.get("compliance")
                    or operational.get("assets") or operational.get("issues")
                    or vendor_risk.get("seeded")
                    or kpi_history.get("seeded")):
                summary["seeded"].append({
                    "slug": slug,
                    "catalog": catalog,
                    "baseline": baseline,
                    "assessments": assessments,
                    "governance": governance,
                    "operational": operational,
                    "vendor_risk": vendor_risk,
                    "kpi_history": kpi_history,
                })
                logger.info("Startup seed completed for tenant %s: %s", slug, summary["seeded"][-1])
        except Exception:
            if db is not None:
                db.rollback()
            logger.exception("Startup seed failed for tenant slug=%s", slug)
            summary.setdefault("errors", []).append(slug)
        finally:
            if db is not None:
                db.close()
    return summary
