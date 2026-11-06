"""Stage H — assurance roll-ups, SoA snapshot, audit-period freeze, OSCAL/XLSX export.

Numbers tagged INDICATIVE are navigation aids, not an audit opinion (Decision 6 / STRM).
"""
from __future__ import annotations

import csv
import io
from datetime import date, datetime
from typing import Any, Dict, Optional, Set

from sqlalchemy.orm import Session

from grc.models import SCFAuditPeriod, SCFCheckResult, SCFControlState, SCFMapping, SCFScope
from grc.modules.scf.registry import expand_source_slugs, label_for_slug
from grc.modules.scf.scope_service import get_applicable_scf_ids

_PASS_DESIGNATIONS = frozenset({"satisfactory", "pass", "passed", "alternative_control", "na"})


def _pct(num: int, den: int) -> float:
    if den <= 0:
        return 0.0
    return round(100.0 * num / den, 1)


def _covers_scf_ids() -> Set[str]:
    """Invert covers_overlay → parent SCF ids that have ≥1 bound check."""
    try:
        from grc.modules.compliance_plugins.runners.covers import (
            load_covers_overlay,
            scf_targets_from_covers,
        )
    except Exception:
        return set()
    out: Set[str] = set()
    for row in load_covers_overlay().values():
        out |= scf_targets_from_covers(list(row.get("covers") or []))
    return out


def _scf_ids_with_check_results(db: Session, tenant_id: int, scf_ids: Set[str]) -> Set[str]:
    if not scf_ids:
        return set()
    rows = (
        db.query(SCFCheckResult.scf_id)
        .filter(
            SCFCheckResult.tenant_id == tenant_id,
            SCFCheckResult.scf_id.in_(list(scf_ids)),
        )
        .distinct()
        .all()
    )
    return {r[0] for r in rows if r[0]}


def _mapped_scf_ids_for_slug(
    db: Session,
    release_id: Optional[int],
    framework_slug: str,
    applicable: Set[str],
) -> Set[str]:
    if not release_id or not applicable or not framework_slug:
        return set()
    expanded = expand_source_slugs([framework_slug])
    rows = (
        db.query(SCFMapping.scf_id)
        .filter(
            SCFMapping.release_id == release_id,
            SCFMapping.source_slug.in_(list(expanded) or ["__none__"]),
            SCFMapping.scf_id.in_(list(applicable)),
        )
        .distinct()
        .all()
    )
    return {r[0] for r in rows if r[0]}


def _states_by_scf(
    db: Session, tenant_id: int, scope_id: int, scf_ids: Set[str],
) -> Dict[str, SCFControlState]:
    if not scf_ids:
        return {}
    rows = (
        db.query(SCFControlState)
        .filter(
            SCFControlState.tenant_id == tenant_id,
            SCFControlState.scope_id == scope_id,
            SCFControlState.scf_id.in_(list(scf_ids)),
        )
        .all()
    )
    return {r.scf_id: r for r in rows}


def framework_status(
    db: Session,
    tenant_id: int,
    scope: SCFScope,
    framework_slug: str,
) -> Dict[str, Any]:
    """Three coverage percentages for one framework slug (INDICATIVE conformity)."""
    applicable_all = get_applicable_scf_ids(db, tenant_id, scope.id)
    mapped = _mapped_scf_ids_for_slug(db, scope.release_id, framework_slug, applicable_all)
    # Denominator = applicable controls that map to this slug
    applicable = mapped
    applicable_count = len(applicable)

    covers = _covers_scf_ids()
    with_results = _scf_ids_with_check_results(db, tenant_id, applicable)
    with_checks = (applicable & covers) | with_results
    controls_with_checks = len(with_checks)

    states = _states_by_scf(db, tenant_id, scope.id, applicable)
    not_assessed = 0
    evidence_ok = 0
    assessed = 0
    passed = 0
    for sid in applicable:
        st = states.get(sid)
        des = (st.designation if st else None) or "not_assessed"
        if des == "not_assessed":
            not_assessed += 1
        else:
            assessed += 1
            if des in _PASS_DESIGNATIONS:
                passed += 1
        has_ev = bool(st and st.linked_evidence_ids)
        if has_ev or des != "not_assessed":
            evidence_ok += 1

    return {
        "framework_slug": framework_slug,
        "label": label_for_slug(framework_slug),
        "applicable_count": applicable_count,
        "not_assessed_count": not_assessed,
        "controls_with_checks": controls_with_checks,
        "automation_coverage_pct": _pct(controls_with_checks, applicable_count),
        "evidence_coverage_pct": _pct(evidence_ok, applicable_count),
        # INDICATIVE — mapping-derived; not an audit opinion (no STRM strength).
        "indicative_conformity_pct": _pct(passed, assessed),
        "indicative": True,
        "conformity_basis": "INDICATIVE",
    }


def build_soa_snapshot(db: Session, tenant_id: int, scope: SCFScope) -> Dict[str, Any]:
    """Live Statement of Applicability rows for a scope."""
    rows = (
        db.query(SCFControlState)
        .filter(
            SCFControlState.tenant_id == tenant_id,
            SCFControlState.scope_id == scope.id,
        )
        .order_by(SCFControlState.scf_id)
        .all()
    )
    controls = [
        {
            "scf_id": r.scf_id,
            "is_applicable": r.is_applicable,
            "source": r.applicability_source,
            "reason": r.applicability_reason,
            "obligation": r.obligation,
            "designation": r.designation or "not_assessed",
            "owner_user_id": r.owner_user_id,
        }
        for r in rows
    ]
    return {
        "scope_id": scope.id,
        "tenant_id": tenant_id,
        "framework_slugs": list(scope.framework_slugs or []),
        "built_at": datetime.utcnow().isoformat() + "Z",
        "controls": controls,
        "count": len(controls),
    }


def freeze_audit_period(
    db: Session,
    period: SCFAuditPeriod,
    actor_id: int,
) -> SCFAuditPeriod:
    """Freeze SoA onto the period. Status may stay open/fieldwork."""
    scope = (
        db.query(SCFScope)
        .filter(SCFScope.id == period.scope_id, SCFScope.tenant_id == period.tenant_id)
        .first()
    )
    if scope is None:
        raise ValueError("audit period scope not found")
    snap = build_soa_snapshot(db, period.tenant_id, scope)
    period.soa_snapshot = snap
    period.frozen_at = datetime.utcnow()
    period.frozen_by = actor_id
    # leave status as-is (open | fieldwork)
    db.flush()
    return period


def soa_oscal_profile(snapshot: Dict[str, Any], scope: SCFScope) -> Dict[str, Any]:
    """Minimal OSCAL-ish profile JSON from a SoA snapshot."""
    controls = list(snapshot.get("controls") or [])
    include = [c["scf_id"] for c in controls if c.get("is_applicable") is True]
    exclude = [
        {
            "control-id": c["scf_id"],
            "remarks": c.get("reason") or "",
        }
        for c in controls
        if c.get("is_applicable") is False
    ]
    imports = [
        {"href": f"framework:{slug}", "framework_slug": slug}
        for slug in (scope.framework_slugs or snapshot.get("framework_slugs") or [])
    ]
    return {
        "profile": {
            "uuid": f"soa-scope-{scope.id}",
            "metadata": {
                "title": f"Statement of Applicability — {scope.name}",
                "last-modified": snapshot.get("built_at") or datetime.utcnow().isoformat() + "Z",
                "version": "1.0",
                "oscal-version": "1.1.2",
            },
            "imports": imports,
            "merge": {
                "include-controls": [{"control-id": cid} for cid in include],
                "exclude-controls": exclude,
            },
            "modify": {
                "set-parameters": [
                    {
                        "param-id": "cmm_target",
                        "value": str(scope.target_cmm) if scope.target_cmm is not None else "3",
                    }
                ],
            },
        }
    }


def soa_xlsx_bytes(snapshot: Dict[str, Any]) -> tuple[bytes, str, str]:
    """Return (bytes, media_type, filename_hint). Prefer openpyxl; else CSV."""
    rows = list(snapshot.get("controls") or [])
    headers = [
        "scf_id", "is_applicable", "source", "reason",
        "obligation", "designation", "owner_user_id",
    ]
    try:
        from openpyxl import Workbook

        wb = Workbook()
        ws = wb.active
        ws.title = "SoA"
        ws.append(headers)
        for c in rows:
            ws.append([c.get(h) for h in headers])
        buf = io.BytesIO()
        wb.save(buf)
        return buf.getvalue(), (
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        ), "soa.xlsx"
    except ImportError:
        buf = io.StringIO()
        w = csv.writer(buf)
        w.writerow(headers)
        for c in rows:
            w.writerow([c.get(h) for h in headers])
        # ponytail: CSV fallback when openpyxl missing; content-type is text/csv
        return buf.getvalue().encode("utf-8"), "text/csv", "soa.csv"


def period_out(period: SCFAuditPeriod) -> Dict[str, Any]:
    return {
        "id": period.id,
        "tenant_id": period.tenant_id,
        "scope_id": period.scope_id,
        "name": period.name,
        "framework_slug": period.framework_slug,
        "period_start": period.period_start.isoformat() if period.period_start else None,
        "period_end": period.period_end.isoformat() if period.period_end else None,
        "release_id": period.release_id,
        "status": period.status,
        "frozen_at": period.frozen_at.isoformat() if period.frozen_at else None,
        "frozen_by": period.frozen_by,
        "has_soa_snapshot": period.soa_snapshot is not None,
        "created_at": period.created_at.isoformat() if period.created_at else None,
    }


def parse_date(value: Any) -> date:
    if isinstance(value, date) and not isinstance(value, datetime):
        return value
    if isinstance(value, datetime):
        return value.date()
    s = str(value or "").strip()
    if not s:
        raise ValueError("date required")
    return date.fromisoformat(s[:10])


# Static Stage A–G feature checklist (Decision 6 readiness surface).
PARITY_CHECKLIST: Dict[str, Any] = {
    "decision": 6,
    "note": "Static checklist of Stage A–G control-plane features present in this build.",
    "stages": [
        {
            "stage": "A",
            "name": "Catalog & crosswalk",
            "present": True,
            "features": ["SCFControl", "SCFMapping", "crosswalk_registry", "SCFRelease"],
        },
        {
            "stage": "B",
            "name": "Scope & applicability",
            "present": True,
            "features": ["SCFScope", "recompute", "applicability overrides", "SoD review"],
        },
        {
            "stage": "C",
            "name": "Ownership & cadence",
            "present": True,
            "features": ["owner/reviewer assign", "next_due_at", "my-work queue", "bulk assign"],
        },
        {
            "stage": "D",
            "name": "Custom controls",
            "present": True,
            "features": ["create/retire custom NC", "implements_scf_ids", "bound_check_ids"],
        },
        {
            "stage": "E",
            "name": "Risk links",
            "present": True,
            "features": ["risk↔NC links", "control_status_indicator (no residual mutation)"],
        },
        {
            "stage": "F",
            "name": "Asset links",
            "present": True,
            "features": ["asset↔control links", "coverage by asset"],
        },
        {
            "stage": "G",
            "name": "Covers / automation bindings",
            "present": True,
            "features": ["covers_overlay", "SCFCheckResult recorder", "covers-preferring detail"],
        },
        {
            "stage": "H",
            "name": "Assurance & reporting",
            "present": True,
            "features": [
                "framework_status (INDICATIVE)",
                "audit periods + SoA freeze",
                "OSCAL profile / XLSX export",
            ],
        },
    ],
}


def parity_checklist() -> Dict[str, Any]:
    return dict(PARITY_CHECKLIST)
