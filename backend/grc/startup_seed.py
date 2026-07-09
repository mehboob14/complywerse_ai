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
from datetime import datetime
from io import StringIO
from pathlib import Path
from typing import Any, Iterable, Optional

from sqlalchemy.orm import Session

from .db import MasterSession, get_tenant_engine, open_tenant_session
from .models import (
    Base,
    CommonControlGroup,
    CommonControlGroupMapping,
    GRCUser,
    NormalizationRun,
    NormalizedControl,
    NormalizedControlLink,
    ParsedFrameworkControl,
    Tenant,
    UploadedFramework,
)

logger = logging.getLogger(__name__)

_DISABLE_VALUES = {"1", "true", "yes", "on"}
_SEED_ROOT = Path(__file__).resolve().parent / "seed_data"
_FRAMEWORK_SEED_DIR = _SEED_ROOT / "frameworks"
_BASELINE_PATH = _SEED_ROOT / "normalization_baseline.json"


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
    user_id = db.query(GRCUser.id).order_by(GRCUser.id.asc()).scalar()
    return int(user_id or 1)


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
            db.commit()
            if catalog.get("seeded") or baseline.get("seeded"):
                summary["seeded"].append({"slug": slug, "catalog": catalog, "baseline": baseline})
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
