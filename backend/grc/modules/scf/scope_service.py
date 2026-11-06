"""SCF scope lifecycle — default scope, applicable ids, journeys, NC links."""
from __future__ import annotations

import logging
from datetime import datetime
from typing import Any, Optional, Set

from sqlalchemy import or_
from sqlalchemy.orm import Session

from grc.models import (
    CertificationJourney,
    ControlImplementation,
    Evidence,
    EvidenceControlMapping,
    ImplementationEvidence,
    NormalizedControl,
    NormalizedControlLink,
    ParsedFrameworkControl,
    SCFControlState,
    SCFMapping,
    SCFRelease,
    SCFScope,
    UploadedFramework,
)
from grc.modules.scf.applicability import commit_recompute, resolve_one
from grc.modules.scf.registry import expand_source_slugs

logger = logging.getLogger(__name__)


def _current_ready_release(db: Session) -> Optional[SCFRelease]:
    return (
        db.query(SCFRelease)
        .filter(SCFRelease.import_status == "ready", SCFRelease.is_current.is_(True))
        .order_by(SCFRelease.imported_at.desc())
        .first()
    ) or (
        db.query(SCFRelease)
        .filter(SCFRelease.import_status == "ready")
        .order_by(SCFRelease.imported_at.desc())
        .first()
    )


def ensure_default_scope(db: Session, tenant_id: int) -> SCFScope:
    """Create the tenant's default SCF scope if missing; pin current ready release."""
    existing = (
        db.query(SCFScope)
        .filter(SCFScope.tenant_id == tenant_id, SCFScope.is_default.is_(True))
        .first()
    )
    if existing is not None:
        return existing

    named = (
        db.query(SCFScope)
        .filter(SCFScope.tenant_id == tenant_id, SCFScope.name == "Default")
        .first()
    )
    if named is not None:
        named.is_default = True
        db.commit()
        db.refresh(named)
        return named

    release = _current_ready_release(db)
    if release is None:
        raise RuntimeError("not_provisioned")

    scope = SCFScope(
        tenant_id=tenant_id,
        name="Default",
        release_id=release.id,
        framework_slugs=[],
        framework_obligations={},
        baseline_keys=[],
        esp_level=0,
        has_facilities=True,
        processes_personal_data=True,
        target_cmm=3,
        is_default=True,
    )
    db.add(scope)
    db.commit()
    db.refresh(scope)
    return scope


def get_applicable_scf_ids(
    db: Session,
    tenant_id: int,
    scope_id: Optional[int] = None,
) -> Set[str]:
    """Materialised applicable SCF ids for a scope (default if omitted)."""
    if scope_id is None:
        scope = ensure_default_scope(db, tenant_id)
    else:
        scope = (
            db.query(SCFScope)
            .filter(SCFScope.id == scope_id, SCFScope.tenant_id == tenant_id)
            .first()
        )
        if scope is None:
            return set()

    states = (
        db.query(SCFControlState.scf_id)
        .filter(
            SCFControlState.tenant_id == tenant_id,
            SCFControlState.scope_id == scope.id,
            SCFControlState.is_applicable.is_(True),
        )
        .all()
    )
    if states:
        return {r[0] for r in states}

    slugs = list(scope.framework_slugs or [])
    # No materialised rows yet.
    if not slugs and int(scope.esp_level or 0) <= 0:
        return set()  # unconfigured — show none until scoped

    # Frameworks set but never recomputed: compute on the fly (read-only).
    from grc.models import SCFControl

    controls = (
        db.query(SCFControl)
        .filter(SCFControl.release_id == scope.release_id)
        .all()
    )
    map_idx: dict = {}
    for scf_id, slug in (
        db.query(SCFMapping.scf_id, SCFMapping.source_slug)
        .filter(SCFMapping.release_id == scope.release_id)
        .all()
    ):
        map_idx.setdefault(scf_id, set()).add(slug)

    applicable: Set[str] = set()
    for ctl in controls:
        ans = resolve_one(
            ctl, scope, state_row=None, ancestor_states=[],
            mapping_source_slugs_for_control=map_idx.get(ctl.scf_id) or set(),
        )
        if ans["is_applicable"]:
            applicable.add(ctl.scf_id)
    return applicable


def _find_uploaded_framework(db: Session, tenant_id: int, slug: str) -> Optional[UploadedFramework]:
    row = (
        db.query(UploadedFramework)
        .filter(
            UploadedFramework.slug == slug,
            or_(UploadedFramework.tenant_id == tenant_id, UploadedFramework.tenant_id.is_(None)),
            UploadedFramework.is_active.is_(True),
        )
        .first()
    )
    if row is not None:
        return row
    # Fallback: name ilike slug / label fragments (legacy rows without slug).
    needle = slug.replace("_", " ")
    return (
        db.query(UploadedFramework)
        .filter(
            or_(UploadedFramework.tenant_id == tenant_id, UploadedFramework.tenant_id.is_(None)),
            UploadedFramework.is_active.is_(True),
            or_(
                UploadedFramework.name.ilike(f"%{slug}%"),
                UploadedFramework.name.ilike(f"%{needle}%"),
                UploadedFramework.file_name.ilike(f"%{slug}%"),
            ),
        )
        .first()
    )


def _create_journey_for_framework(
    db: Session,
    tenant_id: int,
    user: Any,
    framework: UploadedFramework,
) -> CertificationJourney:
    """Same create-journey logic as certification_router POST /certifications (minimal)."""
    existing = (
        db.query(CertificationJourney)
        .filter(
            CertificationJourney.tenant_id == tenant_id,
            CertificationJourney.uploaded_framework_id == framework.id,
            CertificationJourney.status.in_(["in_progress", "not_started"]),
        )
        .first()
    )
    if existing is not None:
        return existing

    journey = CertificationJourney(
        tenant_id=tenant_id,
        uploaded_framework_id=framework.id,
        name=f"{framework.name} Journey",
        status="in_progress",
    )
    db.add(journey)
    db.flush()

    controls = (
        db.query(ParsedFrameworkControl)
        .filter(ParsedFrameworkControl.uploaded_framework_id == framework.id)
        .all()
    )
    selected: dict = {}
    for control in controls:
        key = control.control_id or str(control.id)
        current = selected.get(key)
        current_score = len(current.evidence_requirements or []) if current else -1
        candidate_score = len(control.evidence_requirements or [])
        if current is None or candidate_score > current_score:
            selected[key] = control

    for control in selected.values():
        db.add(ControlImplementation(
            journey_id=journey.id,
            parsed_control_id=control.id,
            status="not_started",
            priority=3,
        ))
    db.flush()

    # Best-effort evidence seed (same as certification_router).
    try:
        impl_map = {
            c.id: (
                db.query(ControlImplementation)
                .filter(
                    ControlImplementation.journey_id == journey.id,
                    ControlImplementation.parsed_control_id == c.id,
                )
                .first()
            )
            for c in selected.values()
        }
        for ecm in (
            db.query(EvidenceControlMapping)
            .filter(
                EvidenceControlMapping.uploaded_framework_id == framework.id,
                EvidenceControlMapping.parsed_control_id.isnot(None),
            )
            .all()
        ):
            impl = impl_map.get(ecm.parsed_control_id)
            if not impl:
                continue
            exists = (
                db.query(ImplementationEvidence)
                .filter(
                    ImplementationEvidence.implementation_id == impl.id,
                    ImplementationEvidence.evidence_id == ecm.evidence_id,
                )
                .first()
            )
            if exists:
                continue
            ev = db.query(Evidence).filter(Evidence.id == ecm.evidence_id).first()
            if not ev or ev.tenant_id != tenant_id:
                continue
            uploader_id = getattr(user, "id", None)
            if uploader_id is None:
                continue
            db.add(ImplementationEvidence(
                implementation_id=impl.id,
                evidence_id=ecm.evidence_id,
                file_name=ev.name,
                uploaded_by=uploader_id,
                review_status="pending",
            ))
    except Exception:
        logger.warning("Failed to seed evidence into journey for framework %s", framework.id, exc_info=True)

    return journey


def uploaded_framework_ids_for_scope(db: Session, tenant_id: int, scope: SCFScope) -> list:
    """Resolve in-scope product slugs to UploadedFramework ids (for Control Library)."""
    ids = []
    seen = set()
    for slug in scope.framework_slugs or []:
        fw = _find_uploaded_framework(db, tenant_id, slug)
        if fw is None or fw.id in seen:
            continue
        if not fw.slug:
            fw.slug = slug
        seen.add(fw.id)
        ids.append(fw.id)
    return ids


def sync_workbench_scope(db: Session, tenant_id: int, scope: SCFScope, updated_by=None) -> dict:
    """Mirror SCF framework selection into Tenant.settings control_workbench.

    Control Catalog still filters by uploaded-framework ids; once Automation
    Scope is the control plane, this keeps that filter aligned.
    """
    from grc.models import Tenant
    from sqlalchemy.orm.attributes import flag_modified

    ids = uploaded_framework_ids_for_scope(db, tenant_id, scope)
    t = db.query(Tenant).filter(Tenant.id == tenant_id).first()
    if not t:
        return {"framework_ids": ids, "synced": False}
    settings = dict(t.settings or {})
    cfg = dict(settings.get("control_workbench", {}) or {})
    prev = set(cfg.get("framework_ids", []) or [])
    newset = set(ids)
    log = list(cfg.get("log", []) or [])
    if prev != newset:
        log.append({
            "by": updated_by,
            "at": datetime.utcnow().isoformat(),
            "added": sorted(newset - prev),
            "removed": sorted(prev - newset),
            "total": len(ids),
            "source": "scf_scope",
        })
        log = log[-50:]
    cfg["framework_ids"] = ids
    cfg["updated_by"] = updated_by
    cfg["scf_scope_id"] = scope.id
    cfg["log"] = log
    settings["control_workbench"] = cfg
    t.settings = settings
    flag_modified(t, "settings")
    db.commit()
    return {"framework_ids": ids, "synced": True}


def sync_journeys_for_scope(db: Session, tenant_id: int, user: Any, scope: SCFScope) -> dict:
    """Idempotently ensure a certification journey exists for each in-scope slug."""
    created, skipped, missing = [], [], []
    for slug in scope.framework_slugs or []:
        fw = _find_uploaded_framework(db, tenant_id, slug)
        if fw is None:
            missing.append(slug)
            continue
        if not fw.slug:
            fw.slug = slug
        before = (
            db.query(CertificationJourney.id)
            .filter(
                CertificationJourney.tenant_id == tenant_id,
                CertificationJourney.uploaded_framework_id == fw.id,
                CertificationJourney.status.in_(["in_progress", "not_started"]),
            )
            .first()
        )
        journey = _create_journey_for_framework(db, tenant_id, user, fw)
        if before is None:
            created.append({"slug": slug, "journey_id": journey.id, "framework_id": fw.id})
        else:
            skipped.append({"slug": slug, "journey_id": journey.id, "framework_id": fw.id})
    db.commit()
    return {"created": created, "existing": skipped, "missing_frameworks": missing}


def backfill_normalized_links(db: Session, scope: SCFScope) -> dict:
    """Link applicable SCF NormalizedControls to in-scope ParsedFrameworkControls.

    Best-effort on requirement code match; skips silently on miss.
    """
    applicable = get_applicable_scf_ids(db, scope.tenant_id, scope.id)
    if not applicable:
        return {"linked": 0, "skipped": 0}

    ncs = {
        nc.scf_id: nc
        for nc in db.query(NormalizedControl)
        .filter(NormalizedControl.scf_id.in_(list(applicable)))
        .all()
        if nc.scf_id
    }
    if not ncs:
        return {"linked": 0, "skipped": 0}

    expanded = expand_source_slugs(list(scope.framework_slugs or []))
    # scf_id → requirement codes for in-scope mapping sources
    codes_by_scf: dict = {}
    for scf_id, slug, code in (
        db.query(SCFMapping.scf_id, SCFMapping.source_slug, SCFMapping.requirement_code)
        .filter(
            SCFMapping.release_id == scope.release_id,
            SCFMapping.scf_id.in_(list(applicable)),
            SCFMapping.source_slug.in_(list(expanded) or ["__none__"]),
        )
        .all()
    ):
        codes_by_scf.setdefault(scf_id, set()).add(code)

    # Prefetch parsed controls for in-scope uploaded frameworks
    fw_ids = []
    for slug in scope.framework_slugs or []:
        fw = _find_uploaded_framework(db, scope.tenant_id, slug)
        if fw is not None:
            fw_ids.append(fw.id)
    if not fw_ids:
        return {"linked": 0, "skipped": 0}

    parsed = (
        db.query(ParsedFrameworkControl)
        .filter(ParsedFrameworkControl.uploaded_framework_id.in_(fw_ids))
        .all()
    )
    by_code: dict = {}
    for p in parsed:
        for key in filter(None, [p.original_reference, p.control_id, p.section_number]):
            by_code.setdefault(str(key).strip().lower(), []).append(p)

    linked = skipped = 0
    for scf_id, codes in codes_by_scf.items():
        nc = ncs.get(scf_id)
        if nc is None:
            skipped += 1
            continue
        existing_parsed = {
            ln.parsed_control_id
            for ln in db.query(NormalizedControlLink)
            .filter(NormalizedControlLink.normalized_control_id == nc.id)
            .all()
            if ln.parsed_control_id
        }
        for code in codes:
            matches = by_code.get(str(code).strip().lower()) or []
            if not matches:
                skipped += 1
                continue
            for p in matches:
                if p.id in existing_parsed:
                    continue
                db.add(NormalizedControlLink(
                    normalized_control_id=nc.id,
                    parsed_control_id=p.id,
                    mapping_type="direct",
                ))
                existing_parsed.add(p.id)
                linked += 1
    db.commit()
    return {"linked": linked, "skipped": skipped}
