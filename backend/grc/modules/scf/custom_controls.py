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
    BusinessUnit,
    CustomControlProfile,
    GRCUser,
    NormalizedControl,
    NormalizedControlLink,
    ParsedFrameworkControl,
    SCFControl,
    SCFControlState,
    SCFMapping,
    SCFRelease,
    SCFScope,
    UploadedFramework,
)
from grc.modules.scf import registry
from grc.modules.scf.ownership import ensure_state, state_snapshot
from grc.rich_audit import write_rich_audit_log

VALID_PPTDF = {"People", "Process", "Technology", "Data", "Facility"}
VALID_CADENCE = {"Annual", "Semi-Annual", "Quarterly"}
VALID_SUB_TYPE = {"Manual", "Automated", "Hybrid", "IT-Dependent Manual"}

# The internal-control register's vocabulary, kept identical so a control
# authored here reads the same as one from Risk Management.
VALID_CONTROL_TYPE = {"preventive", "detective", "corrective"}
VALID_OPERATING_FREQUENCY = {
    "continuous", "daily", "weekly", "monthly", "quarterly", "annually", "ad_hoc",
}
#: draft → pending_approval → active | rejected; active ↔ inactive.
VALID_LIFECYCLE = {"draft", "pending_approval", "active", "inactive", "rejected"}

CONTROL_CATEGORIES: Dict[str, List[str]] = {
    "Operations": ["Process Management", "Change Management", "Business Continuity",
                   "Quality Assurance"],
    "Financial": ["General Ledger", "Reconciliations", "Accounts Payable",
                  "Accounts Receivable", "Treasury"],
    "IT Security": ["Access Management", "Network Security", "Endpoint Security",
                    "Vulnerability Management", "Data Protection"],
    "AML/CFT": ["KYC", "Transaction Monitoring", "Sanctions Screening",
                "Suspicious Activity Reporting"],
    "Credit Risk": ["Underwriting", "Credit Review", "Collateral Management",
                    "Provisioning"],
    "Customer Service": ["Complaint Handling", "Service Delivery",
                         "Customer Onboarding", "Escalation Management"],
}

#: Profile columns a caller may set, and how each is coerced.
_PROFILE_TEXT = ("category", "sub_category", "regulatory_source")
_PROFILE_ENUM = {
    "control_type": VALID_CONTROL_TYPE,
    "operating_frequency": VALID_OPERATING_FREQUENCY,
}
_PROFILE_INT = ("department_id", "backup_owner_id")
_PROFILE_DATE = ("effective_date", "review_date")
PROFILE_FIELDS = (*_PROFILE_TEXT, *_PROFILE_ENUM, *_PROFILE_INT, *_PROFILE_DATE)

#: Authored guidance, on the control row itself (never AI-drafted, never SCF text).
GUIDANCE_FIELDS = ("objective", "implementation_guidance", "testing_guidance")

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


def next_custom_code(db: Session, tenant_id: int, prefix: str = "CTL") -> str:
    """The next free ``CTL-0001`` style code for this tenant.

    Authoring a control from a policy statement or a risk should not make anyone
    invent an identifier, so the code is offered rather than demanded. Numbering
    continues from the highest one used, and never reuses a retired control's.
    """
    prefix = (prefix or "CTL").strip().upper() or "CTL"
    pattern = re.compile(rf"^{re.escape(prefix)}-(\d+)$")
    highest = 0
    for (code,) in (db.query(NormalizedControl.scf_id)
                    .filter(NormalizedControl.tenant_id == tenant_id,
                            NormalizedControl.source == "custom").all()):
        match = pattern.match((code or "").strip().upper())
        if match:
            highest = max(highest, int(match.group(1)))
    taken = {
        c for (c,) in db.query(NormalizedControl.code)
        .filter(NormalizedControl.code.like(f"{prefix}-%")).all() if c
    }
    for n in range(highest + 1, highest + 1000):
        candidate = f"{prefix}-{n:04d}"
        if candidate not in taken:
            return candidate
    raise ValueError("could not allocate a control code — set one explicitly")


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


def _coerce_date(value: Any) -> Optional[datetime]:
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        return value
    text = str(value).strip().replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        raise ValueError(f"'{value}' is not a date (expected YYYY-MM-DD)")
    return parsed.replace(tzinfo=None)


def clean_profile(raw: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """Validate and coerce the register fields. Unknown keys are ignored."""
    out: Dict[str, Any] = {}
    for key, value in (raw or {}).items():
        if key not in PROFILE_FIELDS:
            continue
        if key in _PROFILE_ENUM:
            text = (str(value).strip().lower() if value not in (None, "") else None)
            if text is not None and text not in _PROFILE_ENUM[key]:
                raise ValueError(f"{key} must be one of {sorted(_PROFILE_ENUM[key])}")
            out[key] = text
        elif key in _PROFILE_INT:
            out[key] = int(value) if value not in (None, "") else None
        elif key in _PROFILE_DATE:
            out[key] = _coerce_date(value)
        else:
            text = str(value).strip() if value is not None else ""
            out[key] = text[:255] or None
    return out


def clean_evidence(raw: Optional[Sequence[Any]]) -> Optional[List[Dict[str, Any]]]:
    """Normalise authored evidence into the shape the control views render.

    Accepts plain strings or objects; anything without a name is dropped.
    """
    if raw is None:
        return None
    out: List[Dict[str, Any]] = []
    seen: Set[str] = set()
    for item in raw:
        if isinstance(item, str):
            item = {"name": item}
        if not isinstance(item, dict):
            continue
        name = str(item.get("name") or "").strip()
        if not name or name.lower() in seen:
            continue
        seen.add(name.lower())
        method = str(item.get("collection_method") or "manual").strip().lower()
        out.append({
            "name": name[:255],
            "description": (str(item.get("description") or "").strip() or None),
            "collection_method": method if method in ("manual", "automated", "hybrid") else "manual",
            "filetype": (str(item.get("filetype") or "").strip() or None),
            "mandatory": bool(item.get("mandatory")),
            "source": "authored",
        })
    return out


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
    objective: Optional[str] = None,
    implementation_guidance: Optional[str] = None,
    testing_guidance: Optional[str] = None,
    recommended_evidence: Optional[Sequence[Any]] = None,
    profile: Optional[Dict[str, Any]] = None,
    lifecycle_status: str = "draft",
) -> NormalizedControl:
    _validate_enums(
        pptdf=pptdf,
        conformity_cadence=conformity_cadence,
        control_sub_type=control_sub_type,
    )
    name_clean = (name or "").strip()
    if not name_clean:
        raise ValueError("name is required")
    if lifecycle_status not in VALID_LIFECYCLE:
        raise ValueError(f"lifecycle_status must be one of {sorted(VALID_LIFECYCLE)}")
    profile_values = clean_profile(profile)
    _validate_people(db, tenant_id, profile_values)

    release_id = _current_release_id(db, scope)
    # No code given: allocate the next one rather than refusing the control.
    cleaned = (validate_code(code, existing_scf_ids=_catalog_scf_ids(db, release_id))
               if str(code or "").strip() else next_custom_code(db, tenant_id))

    if get_custom(db, tenant_id, cleaned) is not None:
        raise ValueError(f"custom control '{cleaned}' already exists")
    # `code` is unique across the whole control table, not just this tenant's
    # custom ones: without this the insert failed on the constraint with a 500.
    if db.query(NormalizedControl.id).filter(NormalizedControl.code == cleaned).first():
        raise ValueError(f"code '{cleaned}' is already used by another control")

    impl = None
    if implements_scf_ids is not None:
        impl = [str(x).strip().upper() for x in implements_scf_ids if str(x).strip()]

    nc = NormalizedControl(
        run_id=None,
        code=cleaned,
        name=name_clean[:255],
        statement=(statement or "").strip() or None,
        objective=(objective or "").strip() or None,
        implementation_guidance=(implementation_guidance or "").strip() or None,
        testing_guidance=(testing_guidance or "").strip() or None,
        recommended_evidence=clean_evidence(recommended_evidence),
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

    db.add(CustomControlProfile(
        tenant_id=tenant_id,
        normalized_control_id=nc.id,
        lifecycle_status=lifecycle_status,
        created_by=actor_id,
        **profile_values,
    ))
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


_UPDATABLE = (
    "name", "statement", "domain", "pptdf", "conformity_cadence", "control_sub_type",
    *GUIDANCE_FIELDS,
)


def update_custom(
    db: Session,
    tenant_id: int,
    code: str,
    actor_id: Optional[int],
    *,
    recommended_evidence: Optional[Sequence[Any]] = None,
    profile: Optional[Dict[str, Any]] = None,
    **fields: Any,
) -> NormalizedControl:
    """Update the control's own fields, its authored evidence and its register
    profile. Only the keys passed change; ``None`` clears a field."""
    nc = get_custom(db, tenant_id, code)
    if nc is None:
        raise LookupError(f"custom control '{code}' not found")
    if nc.retired_at is not None:
        raise ValueError("cannot update a retired custom control")

    unknown = set(fields) - set(_UPDATABLE)
    if unknown:
        raise ValueError(f"unknown field(s): {sorted(unknown)}")

    _validate_enums(
        pptdf=fields.get("pptdf", nc.pptdf),
        conformity_cadence=fields.get("conformity_cadence", nc.conformity_cadence),
        control_sub_type=fields.get("control_sub_type", nc.control_sub_type),
    )
    profile_values = clean_profile(profile) if profile is not None else {}
    _validate_people(db, tenant_id, profile_values)

    def snapshot() -> Dict[str, Any]:
        row = {f: getattr(nc, f) for f in _UPDATABLE}
        row["recommended_evidence_count"] = len(nc.recommended_evidence or [])
        prof = get_profile(db, nc)
        row.update({f: _iso(getattr(prof, f, None)) for f in PROFILE_FIELDS})
        return row

    before = snapshot()
    for field_name, value in fields.items():
        if field_name in ("pptdf", "conformity_cadence", "control_sub_type"):
            setattr(nc, field_name, value)
            continue
        text = (value or "").strip() if isinstance(value, str) else value
        if field_name == "name":
            if not text:
                raise ValueError("name cannot be empty")
            nc.name = str(text)[:255]
        else:
            setattr(nc, field_name, text or None)
    if recommended_evidence is not None:
        nc.recommended_evidence = clean_evidence(recommended_evidence)
    if profile is not None:
        prof = ensure_profile(db, tenant_id, nc, actor_id)
        for key, value in profile_values.items():
            setattr(prof, key, value)
        prof.updated_at = datetime.utcnow()
    db.flush()

    after = snapshot()
    changed = sorted(k for k in after if before.get(k) != after.get(k))
    write_rich_audit_log(
        db=db,
        tenant_id=tenant_id,
        user_id=actor_id,
        action="custom_control_update",
        resource_type="scf_control_state",
        resource_id=nc.id,
        resource_name=nc.scf_id,
        summary=(f"Updated custom control {nc.scf_id}"
                 + (f": {', '.join(k.replace('_', ' ') for k in changed)}" if changed else "")),
        before={k: before[k] for k in changed} or before,
        after={k: after[k] for k in changed} or after,
    )
    return nc


def _iso(value: Any) -> Any:
    return value.isoformat() if isinstance(value, datetime) else value


def _validate_people(db: Session, tenant_id: int, values: Dict[str, Any]) -> None:
    """A department or backup owner must exist in this tenant."""
    dept_id = values.get("department_id")
    if dept_id:
        ok = (db.query(BusinessUnit.id)
              .filter(BusinessUnit.id == dept_id, BusinessUnit.tenant_id == tenant_id).first())
        if not ok:
            raise ValueError(f"department {dept_id} not found in this tenant")
    user_id = values.get("backup_owner_id")
    if user_id:
        if not db.query(GRCUser.id).filter(GRCUser.id == user_id).first():
            raise ValueError(f"user {user_id} not found in this tenant")


def get_profile(db: Session, nc: NormalizedControl) -> Optional[CustomControlProfile]:
    return (db.query(CustomControlProfile)
            .filter(CustomControlProfile.normalized_control_id == nc.id).first())


def ensure_profile(
    db: Session, tenant_id: int, nc: NormalizedControl, actor_id: Optional[int] = None,
) -> CustomControlProfile:
    """The profile row, created on demand.

    Controls authored before the register fields existed have no profile; they
    read as active, which is what they were.
    """
    prof = get_profile(db, nc)
    if prof is None:
        prof = CustomControlProfile(
            tenant_id=tenant_id, normalized_control_id=nc.id,
            lifecycle_status="active", created_by=actor_id,
        )
        db.add(prof)
        db.flush()
    return prof


def profile_to_dict(db: Session, prof: Optional[CustomControlProfile]) -> Dict[str, Any]:
    """Register fields for the API, with names resolved for display."""
    if prof is None:
        return {
            **{f: None for f in PROFILE_FIELDS},
            "lifecycle_status": "active", "department_name": None,
            "backup_owner_name": None, "submitted_at": None, "approved_at": None,
            "submitted_by": None, "approved_by": None, "decision_comment": None,
        }
    names = _user_names(db, [prof.backup_owner_id, prof.submitted_by, prof.approved_by])
    dept = (db.query(BusinessUnit.name).filter(BusinessUnit.id == prof.department_id).scalar()
            if prof.department_id else None)
    return {
        **{f: _iso(getattr(prof, f)) for f in PROFILE_FIELDS},
        "lifecycle_status": prof.lifecycle_status or "draft",
        "department_name": dept,
        "backup_owner_name": names.get(prof.backup_owner_id),
        "submitted_by": prof.submitted_by,
        "submitted_by_name": names.get(prof.submitted_by),
        "submitted_at": _iso(prof.submitted_at),
        "approved_by": prof.approved_by,
        "approved_by_name": names.get(prof.approved_by),
        "approved_at": _iso(prof.approved_at),
        "decision_comment": prof.decision_comment,
    }


def _user_names(db: Session, ids: Sequence[Optional[int]]) -> Dict[int, str]:
    wanted = {int(i) for i in ids if i}
    if not wanted:
        return {}
    return {
        u.id: (getattr(u, "display_name", None) or getattr(u, "username", None)
               or getattr(u, "email", None) or str(u.id))
        for u in db.query(GRCUser).filter(GRCUser.id.in_(sorted(wanted))).all()
    }


#: action -> (statuses it is allowed from, resulting status, past-tense verb)
LIFECYCLE_ACTIONS: Dict[str, tuple] = {
    "submit": (("draft", "rejected", "inactive"), "pending_approval", "submitted for approval"),
    "approve": (("pending_approval",), "active", "approved"),
    "reject": (("pending_approval",), "rejected", "rejected"),
    "activate": (("inactive", "draft", "approved"), "active", "activated"),
    "deactivate": (("active",), "inactive", "deactivated"),
}


def set_lifecycle(
    db: Session,
    tenant_id: int,
    code: str,
    actor_id: Optional[int],
    action: str,
    comment: Optional[str] = None,
) -> CustomControlProfile:
    """Move the control through the register's approval workflow.

    Segregation of duties: whoever submitted a control cannot approve it.
    """
    nc = get_custom(db, tenant_id, code)
    if nc is None:
        raise LookupError(f"custom control '{code}' not found")
    if nc.retired_at is not None:
        raise ValueError("cannot change the status of a retired control")
    rule = LIFECYCLE_ACTIONS.get((action or "").strip().lower())
    if rule is None:
        raise ValueError(f"action must be one of {sorted(LIFECYCLE_ACTIONS)}")
    allowed_from, new_status, verb = rule

    prof = ensure_profile(db, tenant_id, nc, actor_id)
    current = prof.lifecycle_status or "draft"
    if current not in allowed_from:
        raise ValueError(f"cannot {action} a control that is {current.replace('_', ' ')}")
    if action == "approve" and prof.submitted_by and actor_id and int(prof.submitted_by) == int(actor_id):
        raise ValueError(
            "Segregation of duties: the person who submitted a control cannot approve it"
        )

    now = datetime.utcnow()
    prof.lifecycle_status = new_status
    prof.decision_comment = (comment or "").strip() or None
    prof.updated_at = now
    if action == "submit":
        prof.submitted_by, prof.submitted_at = actor_id, now
        prof.approved_by, prof.approved_at = None, None
    elif action == "approve":
        prof.approved_by, prof.approved_at = actor_id, now
    elif action == "reject":
        prof.approved_by, prof.approved_at = None, None
    db.flush()

    write_rich_audit_log(
        db=db, tenant_id=tenant_id, user_id=actor_id, action=f"custom_control_{action}",
        resource_type="scf_control_state", resource_id=nc.id, resource_name=nc.scf_id,
        resource_url=f"/automation/soc2-controls/{nc.scf_id}",
        summary=f"Custom control {nc.scf_id} {verb}" + (f" — {comment.strip()}" if comment else ""),
        before={"lifecycle_status": current},
        after={"lifecycle_status": new_status},
    )
    return prof


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
    prof = get_profile(db, nc)
    if prof is not None:
        prof.lifecycle_status = "inactive"
        prof.updated_at = stamp
    # A retired control leaves the library, so it must stop counting as
    # applicable — otherwise scope totals and the overview keep including it.
    for state in (db.query(SCFControlState)
                  .filter(SCFControlState.tenant_id == tenant_id,
                          SCFControlState.scf_id == (nc.scf_id or nc.code)).all()):
        state.is_applicable = False
        state.applicability_reason = "Custom control retired"
        state.updated_at = stamp
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
        # Seeded framework rows carry no slug, so resolve the crosswalk slug the
        # rest of the module keys on (scope, requirement text, evidence asks).
        slug = registry.slug_for_framework(fw.name, slug=fw.slug) or (
            (fw.slug or "").strip() or f"framework_{fw.id}"
        )
        bucket = out.setdefault(slug, [])
        # Join on the same field the crosswalk resolver used: ISO 42001 and DORA
        # cite original_reference while their control_id is a local counter.
        join_field = registry.join_field_for_slug(slug)
        code = (
            getattr(pfc, join_field, None) or pfc.control_id or pfc.original_reference
            or str(pfc.id)
        ).strip()
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

    def _add(slug: str, code: str, owner_scf: str) -> None:
        bucket = out.setdefault(slug, [])
        if any(x.get("code") == code for x in bucket):
            return
        bucket.append({
            "code": code,
            "name": code,
            "title": code,
            "source": "implements_scf",
            "via_scf_id": owner_scf,
        })

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
        # A reviewer who retargeted this requirement onto a different control
        # moved the credit with it: it is no longer discharged here.
        if retargets.get(key, owner_scf) not in ids:
            continue
        _add(slug, code, owner_scf)

    # …and requirements retargeted *onto* a control we implement come with it.
    for (slug, code, owner_scf), target in retargets.items():
        if target in ids and owner_scf not in ids and (slug, code, owner_scf) not in suppressed:
            _add(slug, code, target)
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


def nc_to_dict(nc: NormalizedControl, db: Optional[Session] = None) -> Dict[str, Any]:
    profile = profile_to_dict(db, get_profile(db, nc)) if db is not None else {}
    return {
        "id": nc.id,
        "code": nc.scf_id or nc.code,
        "name": nc.name,
        "statement": nc.statement,
        "objective": nc.objective,
        "implementation_guidance": nc.implementation_guidance,
        "testing_guidance": nc.testing_guidance,
        "recommended_evidence": list(nc.recommended_evidence or []),
        "profile": profile,
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
