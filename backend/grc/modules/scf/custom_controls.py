"""SCF Stage D — tenant-authored custom controls (shared SCF identity).

Licence: tenants write their own text. Never copy from SCF catalogue rows and
never feed SCF prose to an LLM. ``implements_scf_ids`` is inheritance of
*mapping identity* only (which requirements a custom control also covers).
"""
from __future__ import annotations

import re
from datetime import datetime
from typing import Any, Dict, Iterable, List, Optional, Sequence, Set

from sqlalchemy.orm import Session

from grc.models import (
    NormalizedControl,
    NormalizedControlLink,
    ParsedFrameworkControl,
    SCFControl,
    SCFMapping,
    SCFRelease,
    SCFScope,
    UploadedFramework,
)
from grc.modules.scf.ownership import ensure_state, state_snapshot
from grc.rich_audit import write_rich_audit_log

VALID_PPTDF = {"People", "Process", "Technology", "Data", "Facility"}
VALID_CADENCE = {"Annual", "Semi-Annual", "Quarterly"}
VALID_SUB_TYPE = {"Manual", "Automated", "Hybrid"}

_CODE_RE = re.compile(r"^[A-Z0-9._-]{2,48}$")


def validate_code(
    code: str,
    *,
    existing_scf_ids: Optional[Iterable[str]] = None,
) -> str:
    """Normalise and validate a custom-control code.

    Strip + upper; A-Z / 0-9 / ``._-`` only; length 2–48. When
    ``existing_scf_ids`` is provided (catalog ids for the current release),
    refuse a collision so a custom control cannot shadow an SCF id.
    """
    cleaned = (code or "").strip().upper()
    if not cleaned or not _CODE_RE.match(cleaned):
        raise ValueError(
            "code must be 2–48 chars of A-Z, 0-9, '.', '_', or '-' (after uppercasing)"
        )
    if existing_scf_ids is not None:
        catalog = {str(x).strip().upper() for x in existing_scf_ids if x}
        if cleaned in catalog:
            raise ValueError(
                f"code '{cleaned}' collides with an SCF catalog control id"
            )
    return cleaned


def _validate_enums(
    *,
    pptdf: Optional[str],
    conformity_cadence: Optional[str],
    control_sub_type: Optional[str],
) -> None:
    if pptdf is not None and pptdf not in VALID_PPTDF:
        raise ValueError(f"pptdf must be one of {sorted(VALID_PPTDF)}")
    if conformity_cadence is not None and conformity_cadence not in VALID_CADENCE:
        raise ValueError(f"conformity_cadence must be one of {sorted(VALID_CADENCE)}")
    if control_sub_type is not None and control_sub_type not in VALID_SUB_TYPE:
        raise ValueError(f"control_sub_type must be one of {sorted(VALID_SUB_TYPE)}")


def _catalog_scf_ids(db: Session, release_id: Optional[int]) -> Set[str]:
    if release_id is None:
        return set()
    return {
        r[0]
        for r in db.query(SCFControl.scf_id)
        .filter(SCFControl.release_id == release_id)
        .all()
        if r[0]
    }


def _current_release_id(db: Session, scope: Optional[SCFScope] = None) -> Optional[int]:
    if scope is not None and scope.release_id:
        return int(scope.release_id)
    row = (
        db.query(SCFRelease.id)
        .filter(SCFRelease.import_status == "ready", SCFRelease.is_current.is_(True))
        .first()
    )
    return int(row[0]) if row else None


def get_custom(db: Session, tenant_id: int, code: str) -> Optional[NormalizedControl]:
    cleaned = (code or "").strip().upper()
    if not cleaned:
        return None
    return (
        db.query(NormalizedControl)
        .filter(
            NormalizedControl.tenant_id == tenant_id,
            NormalizedControl.source == "custom",
            NormalizedControl.scf_id == cleaned,
        )
        .first()
    )


def list_custom_for_tenant(
    db: Session,
    tenant_id: int,
    include_retired: bool = False,
) -> List[NormalizedControl]:
    q = db.query(NormalizedControl).filter(
        NormalizedControl.tenant_id == tenant_id,
        NormalizedControl.source == "custom",
    )
    if not include_retired:
        q = q.filter(NormalizedControl.retired_at.is_(None))
    return q.order_by(NormalizedControl.scf_id).all()


def _set_parsed_links(
    db: Session,
    nc: NormalizedControl,
    parsed_control_ids: Optional[Sequence[int]],
) -> None:
    if parsed_control_ids is None:
        return
    ids = sorted({int(x) for x in parsed_control_ids if x is not None})
    existing = (
        db.query(NormalizedControlLink)
        .filter(NormalizedControlLink.normalized_control_id == nc.id)
        .all()
    )
    for link in existing:
        if link.parsed_control_id is not None:
            db.delete(link)
    db.flush()
    for pid in ids:
        db.add(NormalizedControlLink(
            normalized_control_id=nc.id,
            parsed_control_id=pid,
            mapping_type="direct",
        ))
    db.flush()


def create_custom(
    db: Session,
    tenant_id: int,
    actor_id: Optional[int],
    *,
    code: str,
    name: str,
    statement: Optional[str],
    domain: Optional[str],
    pptdf: Optional[str],
    conformity_cadence: Optional[str],
    control_sub_type: Optional[str],
    scope: SCFScope,
    parsed_control_ids: Optional[Sequence[int]] = None,
    implements_scf_ids: Optional[Sequence[str]] = None,
) -> NormalizedControl:
    _validate_enums(
        pptdf=pptdf,
        conformity_cadence=conformity_cadence,
        control_sub_type=control_sub_type,
    )
    name_clean = (name or "").strip()
    if not name_clean:
        raise ValueError("name is required")

    release_id = _current_release_id(db, scope)
    cleaned = validate_code(code, existing_scf_ids=_catalog_scf_ids(db, release_id))

    if get_custom(db, tenant_id, cleaned) is not None:
        raise ValueError(f"custom control '{cleaned}' already exists")

    impl = None
    if implements_scf_ids is not None:
        impl = [str(x).strip().upper() for x in implements_scf_ids if str(x).strip()]

    nc = NormalizedControl(
        run_id=None,
        code=cleaned,
        name=name_clean[:255],
        statement=(statement or "").strip() or None,
        domain=(domain or "").strip() or None,
        source="custom",
        scf_id=cleaned,
        tenant_id=tenant_id,
        pptdf=pptdf,
        conformity_cadence=conformity_cadence,
        control_sub_type=control_sub_type or "Manual",
        implements_scf_ids=impl,
        review_status="approved",
    )
    db.add(nc)
    db.flush()

    state = ensure_state(db, tenant_id, scope.id, cleaned)
    before = state_snapshot(state)
    state.is_applicable = True
    state.applicability_source = "override"
    state.applicability_reason = "Custom control"
    state.status = "approved"
    state.updated_at = datetime.utcnow()
    db.flush()

    _set_parsed_links(db, nc, parsed_control_ids)

    write_rich_audit_log(
        db=db,
        tenant_id=tenant_id,
        user_id=actor_id,
        action="custom_control_create",
        resource_type="scf_control_state",
        resource_id=state.id,
        resource_name=cleaned,
        summary=f"Created custom control {cleaned}",
        before=before,
        after=state_snapshot(state),
    )
    return nc


def update_custom(
    db: Session,
    tenant_id: int,
    code: str,
    actor_id: Optional[int],
    *,
    name: Optional[str] = None,
    statement: Optional[str] = None,
    domain: Optional[str] = None,
    pptdf: Optional[str] = None,
    conformity_cadence: Optional[str] = None,
    control_sub_type: Optional[str] = None,
) -> NormalizedControl:
    nc = get_custom(db, tenant_id, code)
    if nc is None:
        raise LookupError(f"custom control '{code}' not found")
    if nc.retired_at is not None:
        raise ValueError("cannot update a retired custom control")

    _validate_enums(
        pptdf=pptdf if pptdf is not None else nc.pptdf,
        conformity_cadence=(
            conformity_cadence if conformity_cadence is not None else nc.conformity_cadence
        ),
        control_sub_type=(
            control_sub_type if control_sub_type is not None else nc.control_sub_type
        ),
    )

    before = {
        "name": nc.name,
        "statement": nc.statement,
        "domain": nc.domain,
        "pptdf": nc.pptdf,
        "conformity_cadence": nc.conformity_cadence,
        "control_sub_type": nc.control_sub_type,
    }
    if name is not None:
        cleaned_name = name.strip()
        if not cleaned_name:
            raise ValueError("name cannot be empty")
        nc.name = cleaned_name[:255]
    if statement is not None:
        nc.statement = statement.strip() or None
    if domain is not None:
        nc.domain = domain.strip() or None
    if pptdf is not None:
        nc.pptdf = pptdf
    if conformity_cadence is not None:
        nc.conformity_cadence = conformity_cadence
    if control_sub_type is not None:
        nc.control_sub_type = control_sub_type
    db.flush()

    write_rich_audit_log(
        db=db,
        tenant_id=tenant_id,
        user_id=actor_id,
        action="custom_control_update",
        resource_type="scf_control_state",
        resource_id=nc.id,
        resource_name=nc.scf_id,
        summary=f"Updated custom control {nc.scf_id}",
        before=before,
        after={
            "name": nc.name,
            "statement": nc.statement,
            "domain": nc.domain,
            "pptdf": nc.pptdf,
            "conformity_cadence": nc.conformity_cadence,
            "control_sub_type": nc.control_sub_type,
        },
    )
    return nc


def retire_custom(
    db: Session,
    tenant_id: int,
    code: str,
    actor_id: Optional[int],
    *,
    now: Optional[datetime] = None,
) -> NormalizedControl:
    """Soft-retire: set retired_at; keep history; do not delete."""
    nc = get_custom(db, tenant_id, code)
    if nc is None:
        raise LookupError(f"custom control '{code}' not found")
    if nc.retired_at is not None:
        return nc
    stamp = now or datetime.utcnow()
    nc.retired_at = stamp
    db.flush()
    write_rich_audit_log(
        db=db,
        tenant_id=tenant_id,
        user_id=actor_id,
        action="custom_control_retire",
        resource_type="scf_control_state",
        resource_id=nc.id,
        resource_name=nc.scf_id,
        summary=f"Retired custom control {nc.scf_id}",
        before={"retired_at": None},
        after={"retired_at": stamp.isoformat()},
    )
    return nc


def set_mappings(
    db: Session,
    tenant_id: int,
    code: str,
    parsed_control_ids: Optional[Sequence[int]],
    implements_scf_ids: Optional[Sequence[str]],
    actor_id: Optional[int] = None,
) -> NormalizedControl:
    nc = get_custom(db, tenant_id, code)
    if nc is None:
        raise LookupError(f"custom control '{code}' not found")
    if nc.retired_at is not None:
        raise ValueError("cannot map a retired custom control")

    before = {
        "implements_scf_ids": list(nc.implements_scf_ids or []),
    }
    if parsed_control_ids is not None:
        _set_parsed_links(db, nc, parsed_control_ids)
    if implements_scf_ids is not None:
        nc.implements_scf_ids = [
            str(x).strip().upper() for x in implements_scf_ids if str(x).strip()
        ]
    db.flush()
    write_rich_audit_log(
        db=db,
        tenant_id=tenant_id,
        user_id=actor_id,
        action="custom_control_mappings",
        resource_type="scf_control_state",
        resource_id=nc.id,
        resource_name=nc.scf_id,
        summary=f"Updated mappings for custom control {nc.scf_id}",
        before=before,
        after={"implements_scf_ids": list(nc.implements_scf_ids or [])},
    )
    return nc


def set_bound_checks(
    db: Session,
    tenant_id: int,
    code: str,
    check_ids: Sequence[str],
    actor_id: Optional[int] = None,
) -> NormalizedControl:
    """Bind connector/cloud check ids to a custom control (Stage G)."""
    nc = get_custom(db, tenant_id, code)
    if nc is None:
        raise LookupError(f"custom control '{code}' not found")
    if nc.retired_at is not None:
        raise ValueError("cannot bind checks on a retired custom control")

    cleaned: List[str] = []
    seen: Set[str] = set()
    for raw in check_ids or []:
        cid = str(raw or "").strip()
        if not cid or cid in seen:
            continue
        seen.add(cid)
        cleaned.append(cid)

    before = {"bound_check_ids": list(nc.bound_check_ids or [])}
    nc.bound_check_ids = cleaned
    db.flush()
    write_rich_audit_log(
        db=db,
        tenant_id=tenant_id,
        user_id=actor_id,
        action="custom_control_bound_checks",
        resource_type="scf_control_state",
        resource_id=nc.id,
        resource_name=nc.scf_id,
        summary=f"Bound {len(cleaned)} checks to custom control {nc.scf_id}",
        before=before,
        after={"bound_check_ids": cleaned},
    )
    return nc


def requirements_for_custom(db: Session, nc: NormalizedControl) -> Dict[str, List[Dict[str, Any]]]:
    """Direct NCL → ParsedFrameworkControl → UploadedFramework.slug/name."""
    links = (
        db.query(NormalizedControlLink)
        .filter(
            NormalizedControlLink.normalized_control_id == nc.id,
            NormalizedControlLink.parsed_control_id.isnot(None),
        )
        .all()
    )
    if not links:
        return {}
    parsed_ids = [ln.parsed_control_id for ln in links if ln.parsed_control_id]
    rows = (
        db.query(ParsedFrameworkControl, UploadedFramework)
        .join(
            UploadedFramework,
            UploadedFramework.id == ParsedFrameworkControl.uploaded_framework_id,
        )
        .filter(ParsedFrameworkControl.id.in_(parsed_ids))
        .all()
    )
    out: Dict[str, List[Dict[str, Any]]] = {}
    for pfc, fw in rows:
        slug = (fw.slug or "").strip() or f"framework_{fw.id}"
        bucket = out.setdefault(slug, [])
        code = (pfc.original_reference or pfc.control_id or str(pfc.id)).strip()
        if any(x.get("code") == code for x in bucket):
            continue
        bucket.append({
            "code": code,
            "title": pfc.title,
            "name": pfc.title,
            "reference": pfc.original_reference,
            "parsed_control_id": pfc.id,
            "framework_name": fw.name,
            "source": "ncl",
        })
    return out


def inherited_requirements_from_scf(
    db: Session,
    release_id: int,
    implements_scf_ids: Optional[Sequence[str]],
    suppressed: Optional[set] = None,
    retargets: Optional[Dict[tuple, str]] = None,
) -> Dict[str, List[Dict[str, Any]]]:
    """Requirements discharged by SCF controls this custom control implements.

    Thin SCFMapping query (resolver|ai). Suppression/retarget applied at read
    time the same way automation list/detail does — no SCF prose is copied.
    """
    ids = [str(x).strip().upper() for x in (implements_scf_ids or []) if str(x).strip()]
    if not ids or release_id is None:
        return {}
    suppressed = suppressed or set()
    retargets = retargets or {}

    out: Dict[str, List[Dict[str, Any]]] = {}
    for owner_scf, slug, code in (
        db.query(SCFMapping.scf_id, SCFMapping.source_slug, SCFMapping.requirement_code)
        .filter(
            SCFMapping.release_id == release_id,
            SCFMapping.scf_id.in_(ids),
            SCFMapping.provenance.in_(("resolver", "ai")),
        )
        .all()
    ):
        key = (slug, code, owner_scf)
        if key in suppressed:
            continue
        effective = retargets.get(key, owner_scf)
        # Keep inherited rows only when the effective owner is still one we implement
        # or the original owner was in our implement list (retarget moves credit).
        if effective not in ids and owner_scf not in ids:
            continue
        bucket = out.setdefault(slug, [])
        if any(x.get("code") == code for x in bucket):
            continue
        bucket.append({
            "code": code,
            "name": code,
            "title": code,
            "source": "implements_scf",
            "via_scf_id": owner_scf,
        })
    return out


def merge_requirements(
    direct: Dict[str, List[Dict[str, Any]]],
    inherited: Dict[str, List[Dict[str, Any]]],
) -> Dict[str, List[Dict[str, Any]]]:
    """Merge NCL + inherited maps; prefer direct rows on code collision."""
    out: Dict[str, List[Dict[str, Any]]] = {k: list(v) for k, v in direct.items()}
    for slug, items in inherited.items():
        bucket = out.setdefault(slug, [])
        seen = {x.get("code") for x in bucket}
        for item in items:
            if item.get("code") in seen:
                continue
            bucket.append(item)
            seen.add(item.get("code"))
    return out


def nc_to_dict(nc: NormalizedControl) -> Dict[str, Any]:
    return {
        "id": nc.id,
        "code": nc.scf_id or nc.code,
        "name": nc.name,
        "statement": nc.statement,
        "domain": nc.domain,
        "pptdf": nc.pptdf,
        "conformity_cadence": nc.conformity_cadence,
        "control_sub_type": nc.control_sub_type or "Manual",
        "implements_scf_ids": list(nc.implements_scf_ids or []),
        "bound_check_ids": list(nc.bound_check_ids or []),
        "retired_at": nc.retired_at.isoformat() if nc.retired_at else None,
        "source": "custom",
        "custom": True,
        "tenant_id": nc.tenant_id,
    }
