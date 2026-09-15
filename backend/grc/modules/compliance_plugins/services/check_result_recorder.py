"""Persist what each check actually asserted, as durable rows.

Until this existed the platform could answer "is this control satisfactory now"
and not "was it operating on 12 March". Findings died inside
`CompliancePluginRun.raw_output` JSON and nothing queried them, so every
as-of/audit-period question was unanswerable and every coverage number was a
live recomputation with no history to explain a change.

`SCFCheckResult` was modelled for exactly this and had no writer. This is the
writer. It adds no table and no column.

Two honesty rules are enforced here rather than left to the reader:

  * Inventory is not a verdict. A finding with status `info` enumerates what
    exists; it asserts nothing about a control and is not recorded as a result.
  * Stage G covers: when a check has non-empty ``covers`` (inline or overlay),
    we write one SCFCheckResult per cover target (ao_id set when token has
    ``_A``, scf_id = parent control) and skip the SOC 2 crosswalk fan-out for
    that finding — covers-only prevents pure SOC 2 inflation. When covers are
    empty, the crosswalk fan-out remains the claim path (criterion → mapped
    SCF controls via ``SCFMapping``), with provenance recorded in ``detail``.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

# SCF publishes a reassessment cadence per control; a result older than its own
# window has stopped being evidence. Mirrors _CADENCE_DAYS in the automation
# router — the same three windows SCF ships.
_CADENCE_DAYS = {"Quarterly": 90, "Semi-Annual": 180, "Annual": 365}

# `status` is String(10). pass/fail/error/not_run all fit; `not_applicable` (14)
# does not, and arrives with the objective-binding work that needs it. Guard here
# so a future status silently truncating is impossible.
_MAX_STATUS = 10
# An assertion, as opposed to collected inventory.
_VERDICTS = {"pass", "fail", "error", "not_run"}


def _default_scope_id(db: Session, tenant_id: int) -> Optional[int]:
    try:
        from grc.modules.scf.scope_service import ensure_default_scope
        scope = ensure_default_scope(db, tenant_id)
        return int(scope.id) if scope is not None else None
    except Exception:  # noqa: BLE001 — recorder must never raise
        return None


def record_check_results(
    db: Session,
    *,
    tenant_id: int,
    run,
    plugin,
    findings: List[Dict[str, Any]],
    collected_at: Optional[datetime] = None,
) -> int:
    """Write one SCFCheckResult per (finding, SCF control / cover target).

    Never raises: a recorder that breaks a collection run is worse than a missing
    row. Returns the number of rows written.
    """
    from grc.models import SCFControl, SCFMapping, SCFRelease, SCFCheckResult
    from grc.modules.compliance_plugins.runners.covers import (
        ao_id_from_token,
        covers_for_check,
        scf_targets_from_covers,
    )

    verdicts = [f for f in (findings or []) if f.get("status") in _VERDICTS]
    if not verdicts:
        return 0

    release = (
        db.query(SCFRelease)
        .filter(SCFRelease.import_status == "ready", SCFRelease.is_current.is_(True))
        .first()
    )
    if release is None:
        return 0                       # no catalog for this tenant; nothing to key on

    # Resolve covers per finding check_id (finding["check"] / ["id"]).
    covers_by_check: Dict[str, List[str]] = {}
    for f in verdicts:
        check_id = (f.get("check") or f.get("id") or "check")[:128]
        if check_id in covers_by_check:
            continue
        covers_by_check[check_id] = covers_for_check({"id": check_id, "covers": f.get("covers")})

    codes = {c for f in verdicts for c in (f.get("control_codes") or [])}
    # Only load SOC 2 crosswalk for findings that have no covers (fallback path).
    need_soc2 = any(not covers_by_check.get((f.get("check") or f.get("id") or "check")[:128])
                    for f in verdicts)
    crosswalk: Dict[str, List] = {}
    if need_soc2 and codes:
        for scf_id, code, prov in (
            db.query(SCFMapping.scf_id, SCFMapping.requirement_code, SCFMapping.provenance)
            .filter(SCFMapping.release_id == release.id,
                    SCFMapping.source_slug == "soc2",
                    SCFMapping.requirement_code.in_(sorted(codes)),
                    SCFMapping.provenance.in_(("resolver", "ai")))
            .distinct().all()
        ):
            crosswalk.setdefault(code, []).append((scf_id, prov))
        if not crosswalk and not any(covers_by_check.values()):
            return 0

    if not any(covers_by_check.values()) and not crosswalk:
        return 0

    cadence = {
        c.scf_id: c.conformity_cadence
        for c in db.query(SCFControl.scf_id, SCFControl.conformity_cadence)
        .filter(SCFControl.release_id == release.id).all()
    }

    at = collected_at or getattr(run, "started_at", None) or datetime.utcnow()
    connector = (getattr(plugin, "check_definition", None) or {}).get("provider") or "manual"
    scope_id = _default_scope_id(db, tenant_id)
    written = 0
    seen = set()

    for f in verdicts:
        status = (f.get("status") or "")[:_MAX_STATUS]
        check_id = (f.get("check") or f.get("id") or "check")[:128]
        covers = covers_by_check.get(check_id) or []

        if covers:
            # Prefer covers-only when covers non-empty — stops pure SOC 2 inflation.
            for token in covers:
                scf_id = next(iter(scf_targets_from_covers([token])), None)
                if not scf_id:
                    continue
                ao = ao_id_from_token(token)
                key = (check_id, scf_id, ao, f.get("resource"))
                if key in seen:
                    continue
                seen.add(key)
                days = _CADENCE_DAYS.get(cadence.get(scf_id) or "", 365)
                db.add(SCFCheckResult(
                    tenant_id=tenant_id,
                    scope_id=scope_id,
                    run_id=getattr(run, "id", None),
                    connector=connector[:64],
                    connection_id=getattr(run, "connection_id", None),
                    check_id=check_id,
                    scf_id=scf_id[:16],
                    ao_id=(ao[:24] if ao else None),
                    method="TEST",
                    status=status,
                    severity=(getattr(plugin, "severity", None) or None),
                    resource=(f.get("resource") or None) and str(f["resource"])[:255],
                    population_size=f.get("population_size"),
                    tested_size=f.get("tested_size"),
                    truncated=bool(f.get("truncated")) if f.get("truncated") is not None else False,
                    detail=f"[covers {token}] {f.get('detail') or ''}"[:4000],
                    collected_at=at,
                    expires_at=at + timedelta(days=days),
                ))
                written += 1
            continue

        # SOC 2 fan-out fallback when covers empty.
        for code in f.get("control_codes") or []:
            for scf_id, prov in crosswalk.get(code, []):
                key = (check_id, scf_id, None, f.get("resource"))
                if key in seen:        # one check can name a criterion twice
                    continue
                seen.add(key)
                days = _CADENCE_DAYS.get(cadence.get(scf_id) or "", 365)
                db.add(SCFCheckResult(
                    tenant_id=tenant_id,
                    scope_id=scope_id,
                    run_id=getattr(run, "id", None),
                    connector=connector[:64],
                    connection_id=getattr(run, "connection_id", None),
                    check_id=check_id,
                    scf_id=scf_id[:16],
                    ao_id=None,
                    method="TEST",
                    status=status,
                    severity=(getattr(plugin, "severity", None) or None),
                    resource=(f.get("resource") or None) and str(f["resource"])[:255],
                    population_size=f.get("population_size"),
                    tested_size=f.get("tested_size"),
                    truncated=bool(f.get("truncated")) if f.get("truncated") is not None else False,
                    detail=f"[{code} via {prov}] {f.get('detail') or ''}"[:4000],
                    collected_at=at,
                    expires_at=at + timedelta(days=days),
                ))
                written += 1

    try:
        db.commit()
    except SQLAlchemyError:
        db.rollback()
        logger.exception("record_check_results failed for run %s", getattr(run, "id", None))
        return 0
    return written
