"""Write-on-material-change persistence for exploitability assessments (Phase 3).

The live assessment is computed on read and is free, so these writes exist ONLY to
record HISTORY — a new ReachabilitySnapshot iff the material content changed from the
last one (or it's the first ever). A re-render writes nothing; that's what keeps the
history legible ("flipped likely→unlikely the day the patch landed", not buried under
fifty identical re-renders).

Two invariants the audit record depends on:
  * ATOMIC — the snapshot header and its step rows commit together or not at all. A
    header with no steps (or steps under an uncommitted header) is a corrupt audit
    record, and audit records are the product here.
  * NARRATION IS OFF THE CHANGE PATH — ``attach_narration`` only updates the narration
    columns of an already-identified snapshot. It never creates a snapshot and never
    recomputes the hash, so reading the story can never look like a verdict change.

Best-effort: a persistence failure must never break the read path, so these roll back
and return falsy rather than raising.
"""
from __future__ import annotations

import logging
from datetime import datetime
from typing import Optional, Tuple

from ....models import ReachabilitySnapshot, ReachabilityStep
from .snapshot import assessment_hash

logger = logging.getLogger(__name__)


def latest_snapshot(db, vulnerability_id: int, asset_id: int) -> Optional["ReachabilitySnapshot"]:
    """The most recent snapshot for a finding (vuln × asset), or None."""
    return (
        db.query(ReachabilitySnapshot)
        .filter(
            ReachabilitySnapshot.vulnerability_id == vulnerability_id,
            ReachabilitySnapshot.asset_id == asset_id,
        )
        .order_by(ReachabilitySnapshot.assessed_at.desc(), ReachabilitySnapshot.id.desc())
        .first()
    )


def record_snapshot(db, tenant_id: int, vuln, asset, view: dict) -> Tuple[Optional["ReachabilitySnapshot"], bool]:
    """Persist a snapshot IFF the material content changed from the last one — or none
    exists yet, in which case first-seen writes unconditionally (that baseline is what
    the whole history hangs off). Returns ``(snapshot, created)``. On any error, rolls
    back and returns ``(latest_or_None, False)`` — never raises.
    """
    try:
        h = assessment_hash(view)
        latest = latest_snapshot(db, vuln.id, asset.id)
        # Unchanged → the live view already shows the present; recording it again buries
        # the one row that matters. No write. ("no prior snapshot" is NOT this branch —
        # latest is None there, so first-seen always writes.)
        if latest is not None and latest.content_hash == h:
            return latest, False

        verdict = view.get("verdict") or {}
        snap = ReachabilitySnapshot(
            tenant_id=tenant_id,
            vulnerability_id=vuln.id,
            asset_id=asset.id,
            content_hash=h,
            verdict=verdict.get("verdict") or "unlikely",
            verdict_reason=verdict.get("verdict_reason"),
            signal_pct=verdict.get("signal_pct"),
            data_completeness=verdict.get("data_completeness"),
            attack_version=view.get("attack_version"),
            assessed_at=datetime.utcnow(),
        )
        db.add(snap)
        db.flush()  # assign snap.id for the step FKs — still inside the transaction
        for t in view.get("chain") or []:
            db.add(ReachabilityStep(
                snapshot_id=snap.id,
                tenant_id=tenant_id,
                technique_id=t.get("technique_id"),
                tactic=t.get("tactic"),
                status=t.get("status"),
                reason=t.get("why"),
                mapping_source=t.get("mapping_source"),
                mapping_confidence=t.get("mapping_confidence"),
                assumed=bool(t.get("assumed")),
            ))
        db.commit()  # header + steps as ONE transaction — atomic, no orphans
        return snap, True
    except Exception:
        logger.exception("record_snapshot failed for vuln %s asset %s",
                         getattr(vuln, "id", "?"), getattr(asset, "id", "?"))
        db.rollback()
        return None, False


def attach_narration(db, snapshot: "ReachabilitySnapshot", narration: str, model: Optional[str]) -> bool:
    """Store the narration ON an existing snapshot — a column update on that row ONLY.
    Never creates a snapshot, never touches the hash (so an expand can't read as a
    verdict change). Best-effort."""
    if snapshot is None or not narration:
        return False
    try:
        snapshot.narration = narration
        snapshot.narration_model = model
        snapshot.narration_generated_at = datetime.utcnow()
        db.commit()
        return True
    except Exception:
        logger.exception("attach_narration failed for snapshot %s", getattr(snapshot, "id", "?"))
        db.rollback()
        return False
