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
  * The crosswalk fan-out is the crosswalk's claim, not the check's. One GitHub
    2FA finding becomes ~28 rows because 28 SCF controls are mapped to CC6.1 by
    `SCFMapping`. Each row therefore records, in `detail`, the criterion the
    check actually tested and the provenance of the mapping that carried it
    there — so an assessor asking "why is IAC-06 green" gets the whole chain
    rather than its conclusion.
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


def record_check_results(
    db: Session,
    *,
    tenant_id: int,
    run,
    plugin,
    findings: List[Dict[str, Any]],
    collected_at: Optional[datetime] = None,
) -> int:
    """Write one SCFCheckResult per (finding, SCF control it was credited to).

    Never raises: a recorder that breaks a collection run is worse than a missing
    row. Returns the number of rows written.
    """
    from grc.models import SCFControl, SCFMapping, SCFRelease, SCFCheckResult

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

    codes = {c for f in verdicts for c in (f.get("control_codes") or [])}
    if not codes:
        return 0

    # criterion -> [(scf_id, provenance)]. Same provenance filter the rest of the
    # system uses: SCF's own 249 upstream sources are the catalogue, not what a
    # tenant is assessed against.
    crosswalk: Dict[str, List] = {}
    for scf_id, code, prov in (
        db.query(SCFMapping.scf_id, SCFMapping.requirement_code, SCFMapping.provenance)
        .filter(SCFMapping.release_id == release.id,
                SCFMapping.source_slug == "soc2",
                SCFMapping.requirement_code.in_(sorted(codes)),
                SCFMapping.provenance.in_(("resolver", "ai")))
        .distinct().all()
    ):
        crosswalk.setdefault(code, []).append((scf_id, prov))
    if not crosswalk:
        return 0

    cadence = {
        c.scf_id: c.conformity_cadence
        for c in db.query(SCFControl.scf_id, SCFControl.conformity_cadence)
        .filter(SCFControl.release_id == release.id).all()
    }

    at = collected_at or getattr(run, "started_at", None) or datetime.utcnow()
    connector = (getattr(plugin, "check_definition", None) or {}).get("provider") or "manual"
    written = 0
    seen = set()

    for f in verdicts:
        status = (f.get("status") or "")[:_MAX_STATUS]
        check_id = (f.get("check") or "check")[:128]
        for code in f.get("control_codes") or []:
            for scf_id, prov in crosswalk.get(code, []):
                key = (check_id, scf_id, f.get("resource"))
                if key in seen:        # one check can name a criterion twice
                    continue
                seen.add(key)
                days = _CADENCE_DAYS.get(cadence.get(scf_id) or "", 365)
                db.add(SCFCheckResult(
                    tenant_id=tenant_id,
                    scope_id=None,          # scope tailoring is not wired yet
                    run_id=getattr(run, "id", None),
                    connector=connector[:64],
                    connection_id=getattr(run, "connection_id", None),
                    check_id=check_id,
                    scf_id=scf_id[:16],
                    ao_id=None,             # objective binding is the next step
                    method="TEST",
                    status=status,
                    severity=(getattr(plugin, "severity", None) or None),
                    resource=(f.get("resource") or None) and str(f["resource"])[:255],
                    population_size=f.get("population_size"),
                    tested_size=f.get("tested_size"),
                    truncated=bool(f.get("truncated")) if f.get("truncated") is not None else False,
                    # the provenance chain, not just the conclusion
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
