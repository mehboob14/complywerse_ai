"""CTEM Phase 2 — control effectiveness evidence: producers + tier derivation.

Turns validation events (scanner-verified closures, finding retests) into
dated evidence on the controls linked to those findings, and derives each
control's assurance tier AT READ TIME. No stored badge anywhere: staleness
has no event (nothing fires at month 18), so a stored badge would need a
sweeper and would lie between sweeps; deriving from facts cannot.

Tier semantics (review-settled, auditors will challenge anything looser):
  * tested_effective    — newest evidence is a PASS from a GENUINE test
                          (retest; BAS later) within the staleness window.
  * tested_failed       — the newest evidence is a FAIL, whatever the source.
                          A recent fail dominates any older pass.
  * remediation_verified— newest evidence is a pass, but only scanner
                          closures back it. Closures prove remediation
                          happened, NOT that the control works — they can
                          never reach tested_effective.
  * stale               — there is pass evidence, but the newest is older
                          than the window (default 18 months). An old pass
                          must not wear a fresh badge.
  * attested_only       — no automated evidence at all.
"""

import logging
import os
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

# The genuine effectiveness sources — closures are deliberately NOT here.
GENUINE_TEST_SOURCES = ("retest", "bas")

STALENESS_DAYS_DEFAULT = 548  # ~18 months


def staleness_window_days() -> int:
    try:
        return int(os.environ.get("CONTROL_EVIDENCE_STALENESS_DAYS", STALENESS_DAYS_DEFAULT))
    except (TypeError, ValueError):
        return STALENESS_DAYS_DEFAULT


_CONTROL_REF_FIELDS = (
    "framework_control_id",
    "normalized_control_id",
    "internal_control_id",
    "parsed_framework_control_id",
)


def derive_tier(
    evidence: List[Dict[str, Any]],
    now: Optional[datetime] = None,
    window_days: Optional[int] = None,
) -> Dict[str, Any]:
    """Pure function: evidence facts -> tier. evidence items need
    {source_type, result, tested_at}. Returns {tier, last_tested_at,
    last_source, basis} — `basis` is the sentence the badge tooltip shows."""
    now = now or datetime.utcnow()
    window = timedelta(days=window_days if window_days is not None else staleness_window_days())

    rows = [e for e in evidence if e.get("tested_at") is not None]
    if not rows:
        return {"tier": "attested_only", "last_tested_at": None, "last_source": None,
                "basis": "No automated evidence — status rests on attestation only."}

    rows.sort(key=lambda e: e["tested_at"], reverse=True)
    newest = rows[0]

    if newest["result"] == "fail":
        return {
            "tier": "tested_failed",
            "last_tested_at": newest["tested_at"],
            "last_source": newest["source_type"],
            "basis": f"Most recent evidence ({newest['source_type']}, "
                     f"{newest['tested_at']:%Y-%m-%d}) is a FAIL — a recent fail "
                     "dominates older passes.",
        }

    # Newest is a pass. Fresh or stale?
    if now - newest["tested_at"] > window:
        return {
            "tier": "stale",
            "last_tested_at": newest["tested_at"],
            "last_source": newest["source_type"],
            "basis": f"Newest pass ({newest['tested_at']:%Y-%m-%d}) is older than the "
                     f"{window.days}-day window — treated as attested-only until re-tested.",
        }

    # Fresh pass: genuine test → tested_effective; closures alone cap at
    # remediation_verified.
    fresh_genuine_pass = any(
        e["result"] == "pass" and e["source_type"] in GENUINE_TEST_SOURCES
        and (now - e["tested_at"]) <= window
        for e in rows
    )
    if fresh_genuine_pass:
        newest_genuine = next(e for e in rows
                              if e["result"] == "pass" and e["source_type"] in GENUINE_TEST_SOURCES)
        return {
            "tier": "tested_effective",
            "last_tested_at": newest_genuine["tested_at"],
            "last_source": newest_genuine["source_type"],
            "basis": f"Genuine effectiveness test ({newest_genuine['source_type']}, "
                     f"{newest_genuine['tested_at']:%Y-%m-%d}) passed within the window.",
        }
    return {
        "tier": "remediation_verified",
        "last_tested_at": newest["tested_at"],
        "last_source": newest["source_type"],
        "basis": f"Scanner-verified remediation ({newest['tested_at']:%Y-%m-%d}) proves "
                 "fixes land, not that the control works — a retest or BAS run is "
                 "needed for the full tested badge.",
    }


# ── producer ────────────────────────────────────────────────────────────────

def record_vuln_evidence(
    db: Session,
    vuln,
    *,
    source_type: str,
    result: str,
    tested_at: datetime,
    details: Optional[Dict[str, Any]] = None,
    actor_user_id: Optional[int] = None,
) -> int:
    """Upsert one evidence row per control linked to `vuln`.

    Bounded by design: identity is (control ref × vulnerability × source), so
    repeat closures/retests update tested_at/result in place — a noisy
    scanner cannot flood the panel. The trade-off is that the overwrite
    erases prior state from the evidence table — so every RESULT TRANSITION
    (pass→fail, fail→pass) writes an AuditLog row carrying the old result and
    old tested_at first. "When did this control fail and when did it recover"
    stays answerable from audit even though the table holds only the latest
    fact. Same-result refreshes (a re-scan bumping tested_at) are not
    transitions and are deliberately not audited — auditing those would
    re-create the per-sync flood the upsert exists to prevent.

    Never raises; never commits (runs inside the caller's transaction)."""
    try:
        from ..models import AuditLog, ControlEffectivenessEvidence, VulnerabilityControlLink
    except Exception:
        logger.exception("control_assurance: models unavailable")
        return 0

    written = 0
    try:
        links = db.query(VulnerabilityControlLink).filter(
            VulnerabilityControlLink.vulnerability_id == vuln.id,
        ).all()
        for link in links:
            ref = {f: getattr(link, f, None) for f in _CONTROL_REF_FIELDS}
            if not any(ref.values()):
                continue
            row = db.query(ControlEffectivenessEvidence).filter_by(
                tenant_id=vuln.tenant_id,
                vulnerability_id=vuln.id,
                source_type=source_type,
                **ref,
            ).first()
            if row:
                if row.result != result:
                    try:
                        db.add(AuditLog(
                            tenant_id=vuln.tenant_id,
                            user_id=actor_user_id,
                            action="control_evidence.result_changed",
                            resource_type="control_effectiveness_evidence",
                            resource_id=row.id,
                            changes={
                                "old_result": row.result,
                                "old_tested_at": row.tested_at.isoformat() if row.tested_at else None,
                                "new_result": result,
                                "new_tested_at": tested_at.isoformat() if tested_at else None,
                                "source_type": source_type,
                                "vulnerability_id": vuln.id,
                                "control_ref": {k: v for k, v in ref.items() if v is not None},
                            },
                        ))
                    except Exception:
                        logger.exception("control_assurance: transition audit failed (non-fatal)")
                row.result = result
                row.tested_at = tested_at
                row.details = details
                row.updated_at = datetime.utcnow()
            else:
                db.add(ControlEffectivenessEvidence(
                    tenant_id=vuln.tenant_id,
                    vulnerability_id=vuln.id,
                    source_type=source_type,
                    result=result,
                    tested_at=tested_at,
                    details=details,
                    **ref,
                ))
            written += 1
        if written:
            db.flush()
    except Exception:
        logger.exception("control_assurance: evidence write failed for vuln %s (non-fatal)",
                         getattr(vuln, "id", "?"))
        return 0
    return written


# ── read-side rollups ───────────────────────────────────────────────────────

def _ref_key(row) -> Optional[Tuple[str, int]]:
    for f in _CONTROL_REF_FIELDS:
        v = getattr(row, f, None)
        if v is not None:
            return (f.replace("_id", ""), v)
    return None


def tier_for_ref(db: Session, tenant_id: int, kind: str, control_id: int) -> Dict[str, Any]:
    """Lightweight tier lookup for list endpoints (no row serialization)."""
    from ..models import ControlEffectivenessEvidence

    field = f"{kind}_id"
    if field not in _CONTROL_REF_FIELDS:
        raise ValueError(f"Unknown control kind: {kind}")
    rows = db.query(
        ControlEffectivenessEvidence.source_type,
        ControlEffectivenessEvidence.result,
        ControlEffectivenessEvidence.tested_at,
    ).filter(
        ControlEffectivenessEvidence.tenant_id == tenant_id,
        getattr(ControlEffectivenessEvidence, field) == control_id,
    ).all()
    return derive_tier([
        {"source_type": r[0], "result": r[1], "tested_at": r[2]} for r in rows
    ])


def evidence_for_control(db: Session, tenant_id: int, kind: str, control_id: int) -> Dict[str, Any]:
    """All evidence + derived tier for one control. `kind` is one of
    framework_control | normalized_control | internal_control |
    parsed_framework_control."""
    from ..models import ControlEffectivenessEvidence

    field = f"{kind}_id"
    if field not in _CONTROL_REF_FIELDS:
        raise ValueError(f"Unknown control kind: {kind}")
    rows = db.query(ControlEffectivenessEvidence).filter(
        ControlEffectivenessEvidence.tenant_id == tenant_id,
        getattr(ControlEffectivenessEvidence, field) == control_id,
    ).order_by(ControlEffectivenessEvidence.tested_at.desc()).all()

    facts = [{"source_type": r.source_type, "result": r.result, "tested_at": r.tested_at}
             for r in rows]
    tier = derive_tier(facts)
    return {
        "kind": kind,
        "control_id": control_id,
        **{**tier, "last_tested_at": tier["last_tested_at"].isoformat()
           if tier["last_tested_at"] else None},
        "window_days": staleness_window_days(),
        "evidence": [{
            "id": r.id,
            "source_type": r.source_type,
            "result": r.result,
            "tested_at": r.tested_at.isoformat() if r.tested_at else None,
            "vulnerability_id": r.vulnerability_id,
            "details": r.details,
        } for r in rows],
    }


def assurance_summary(db: Session, tenant_id: int) -> Dict[str, Any]:
    """Tenant-wide rollup: coverage (the honest number the review demanded)
    + tier distribution over every control that has links or evidence."""
    from ..models import ControlEffectivenessEvidence, VulnerabilityControlLink
    from sqlalchemy import func

    linked_controls = set()
    for link in db.query(VulnerabilityControlLink).all():
        k = _ref_key(link)
        if k:
            linked_controls.add(k)

    by_control: Dict[Tuple[str, int], List[Dict[str, Any]]] = {}
    for r in db.query(ControlEffectivenessEvidence).filter(
        ControlEffectivenessEvidence.tenant_id == tenant_id,
    ).all():
        k = _ref_key(r)
        if k:
            by_control.setdefault(k, []).append(
                {"source_type": r.source_type, "result": r.result, "tested_at": r.tested_at})

    tiers: Dict[str, int] = {}
    for k in linked_controls | set(by_control.keys()):
        t = derive_tier(by_control.get(k, []))["tier"]
        tiers[t] = tiers.get(t, 0) + 1

    from ..models import ParsedFrameworkControl, InternalControl
    total_parsed = db.query(func.count(ParsedFrameworkControl.id)).scalar() or 0
    total_internal = db.query(func.count(InternalControl.id)).scalar() or 0

    return {
        "coverage": {
            "controls_with_linked_findings": len(linked_controls),
            "controls_with_evidence": len(by_control),
            "total_parsed_framework_controls": total_parsed,
            "total_internal_controls": total_internal,
        },
        "tiers": tiers,
        "window_days": staleness_window_days(),
        "note": (
            "Coverage is honest by design: a control without linked findings can "
            "never earn automated evidence — raising link coverage is the roadmap "
            "item, not a hidden gap."
        ),
    }
