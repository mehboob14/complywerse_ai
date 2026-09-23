"""Monitoring signals, however they arrive: typed in, or fetched by a connector.

One function writes a signal, so a hand-entered one and a fetched one behave the
same: deduplicated on the provider's own id, audited against the vendor, and able
to reopen the vendor's assessment at its tier's threshold. An alert a connector
could not verify is kept and shown, marked unverified; it never reopens an
assessment and is never emailed.

Connectors poll each vendor on its tier's cadence. Which vendors are due is
worked out in SQL before the batch limit, never-polled first and then the
longest waiting, so a long tail of low-tier vendors cannot starve critical ones.

A signal becomes a finding with one action, and the finding carries where it
came from; a finding becomes a risk the way every finding does.
"""
from __future__ import annotations

from datetime import datetime, timedelta
from typing import List, Optional, Tuple

from sqlalchemy import and_, case, func, or_
from sqlalchemy.orm import Session, aliased

from ....models import (
    TPRAFinding, TPRAMonitoringCursor, TPRAMonitoringSignal, TPRASignalRejection, Vendor,
)
from . import service, tier_policy
from .bootstrap import get_tiering_config
from .engine_monitoring import should_trigger_reassessment

POLL_EVERY_DAYS = {"critical": 1, "high": 7, "medium": 30, "low": 90}
_INACTIVE = ("retired", "offboarded", "inactive", "terminated")
_DOMAIN_FOR = {"breach": "cybersecurity", "security_rating": "cybersecurity", "cert_expiry": "compliance",
               "financial": "financial", "adverse_media": "reputational", "sla": "operational"}


def due_vendors(db: Session, tenant_id: int, provider: str, now: datetime, limit: int = 50,
                every_days: Optional[int] = None) -> List[Tuple[Vendor, Optional[datetime]]]:
    """Vendors a connector should poll now, most overdue first, at most `limit`.
    A feed cheap enough to check every vendor on one cadence passes `every_days`."""
    cursor = aliased(TPRAMonitoringCursor)
    tier = func.lower(func.coalesce(Vendor.tier, "medium"))
    if every_days:
        due = or_(cursor.last_polled_at.is_(None), cursor.last_polled_at <= now - timedelta(days=every_days))
    else:
        due = or_(
            cursor.last_polled_at.is_(None),
            *[and_(tier == t, cursor.last_polled_at <= now - timedelta(days=d)) for t, d in POLL_EVERY_DAYS.items()],
            and_(~tier.in_(list(POLL_EVERY_DAYS)),
                 cursor.last_polled_at <= now - timedelta(days=POLL_EVERY_DAYS["medium"])),
        )
    return (db.query(Vendor, cursor.last_polled_at)
            .outerjoin(cursor, and_(cursor.vendor_id == Vendor.id, cursor.provider == provider,
                                    cursor.tenant_id == tenant_id))
            .filter(Vendor.tenant_id == tenant_id, Vendor.deleted_at.is_(None),
                    ~func.lower(func.coalesce(Vendor.status, "active")).in_(_INACTIVE), due)
            .order_by(case((cursor.last_polled_at.is_(None), 0), else_=1), cursor.last_polled_at, Vendor.id)
            .limit(limit).all())


def mark_polled(db: Session, tenant_id: int, vendor_id: int, provider: str, now: datetime) -> None:
    row = db.query(TPRAMonitoringCursor).filter(
        TPRAMonitoringCursor.tenant_id == tenant_id, TPRAMonitoringCursor.vendor_id == vendor_id,
        TPRAMonitoringCursor.provider == provider).first()
    if row is None:
        row = TPRAMonitoringCursor(tenant_id=tenant_id, vendor_id=vendor_id, provider=provider)
        db.add(row)
    row.last_polled_at, row.last_status, row.last_error = now, "ok", None


def mark_failed(db: Session, tenant_id: int, vendor_id: int, provider: str, error: str) -> None:
    """A failed poll is recorded but does not move the cursor: the vendor stays due."""
    row = db.query(TPRAMonitoringCursor).filter(
        TPRAMonitoringCursor.tenant_id == tenant_id, TPRAMonitoringCursor.vendor_id == vendor_id,
        TPRAMonitoringCursor.provider == provider).first()
    if row is None:
        row = TPRAMonitoringCursor(tenant_id=tenant_id, vendor_id=vendor_id, provider=provider)
        db.add(row)
    row.last_status, row.last_error = "failed", error[:2000]


def rejected(db: Session, tenant_id: int, vendor_id: int, provider: str) -> set:
    return {f for (f,) in db.query(TPRASignalRejection.fingerprint).filter(
        TPRASignalRejection.tenant_id == tenant_id, TPRASignalRejection.vendor_id == vendor_id,
        TPRASignalRejection.provider == provider)}


def record_signal(db: Session, vendor: Vendor, *, signal_type: str, severity: str = "medium",
                  title: Optional[str] = None, detail: Optional[str] = None, source: Optional[str] = None,
                  occurred_at: Optional[datetime] = None, external_id: Optional[str] = None,
                  sources: Optional[list] = None, verification: Optional[dict] = None,
                  actor_id: Optional[int] = None) -> Tuple[TPRAMonitoringSignal, Optional[int], bool]:
    """Write one signal. Returns (signal, reassessment id it opened or joined, created)."""
    if external_id:
        existing = db.query(TPRAMonitoringSignal).filter(
            TPRAMonitoringSignal.vendor_id == vendor.id, TPRAMonitoringSignal.source == source,
            TPRAMonitoringSignal.external_id == external_id).first()
        if existing is not None:
            return existing, None, False
    verified = verification is None or bool(verification.get("verified"))
    sig = TPRAMonitoringSignal(
        tenant_id=vendor.tenant_id, vendor_id=vendor.id, signal_type=signal_type,
        severity=severity or "medium", source=source, title=(title or "")[:255] or None, detail=detail,
        occurred_at=occurred_at or datetime.utcnow(), external_id=external_id, sources=sources or [],
        verification=verification, verified=verified,
    )
    db.add(sig)
    db.flush()

    triggered = _maybe_reopen(db, vendor, sig, actor_id) if verified else None
    service.write_audit(db, vendor.tenant_id, entity="signal", action="create", vendor_id=vendor.id,
                        entity_id=sig.id, actor_id=actor_id, to_value=signal_type,
                        extra={"triggered_assessment_id": triggered, "source": source, "verified": verified})
    return sig, triggered, True


def _maybe_reopen(db: Session, vendor: Vendor, sig: TPRAMonitoringSignal, actor_id: Optional[int]) -> Optional[int]:
    """Reopen the vendor's assessment when the signal is serious enough for its tier."""
    threshold = tier_policy.reassess_threshold(
        vendor.tier, tier_policy.merged(get_tiering_config(db, vendor.tenant_id).get("tier_policy")))
    if not should_trigger_reassessment(sig.signal_type, sig.severity, threshold):
        return None
    # Dedup / debounce — if a reassessment is already IN FLIGHT (a superseding
    # version already open in the diligence phase), attach this signal to it
    # rather than superseding + restarting, which would discard in-flight
    # progress and let a burst of signals spawn a storm of reassessments.
    active = service.get_active_assessment(db, vendor)
    in_flight = (active is not None and (active.version_no or 1) > 1 and active.lifecycle_status == "active"
                 and active.current_stage not in ("monitoring", "reassessment"))
    if in_flight:
        sig.triggered_reassessment = True
        sig.triggered_assessment_id = active.id
        return active.id
    return service.create_reassessment_version(
        db, vendor, actor_id=actor_id, reason=f"Auto-triggered by {sig.signal_type} signal",
        triggered_signal=sig).id


def corroborate(db: Session, vendor: Vendor, sig: TPRAMonitoringSignal, sources: Optional[list],
                verification: Optional[dict]) -> None:
    """A later poll found more reports of an event already recorded: keep the new
    sources, and if the event is now verified, treat it as a verified signal."""
    known = {s.get("url") for s in sig.sources or []}
    added = [s for s in sources or [] if s.get("url") and s.get("url") not in known]
    if added:
        sig.sources = list(sig.sources or []) + added
    if sig.verified or not (verification or {}).get("verified"):
        return
    sig.verified, sig.verification = True, verification
    triggered = _maybe_reopen(db, vendor, sig, None)
    service.write_audit(db, vendor.tenant_id, entity="signal", action="verify", vendor_id=vendor.id,
                        entity_id=sig.id, to_value="verified", extra={"triggered_assessment_id": triggered})


def raise_finding(db: Session, signal: TPRAMonitoringSignal, vendor: Vendor,
                  actor_id: Optional[int]) -> TPRAFinding:
    """The signal as a finding on the vendor's current assessment, once."""
    if signal.finding_id:
        found = db.get(TPRAFinding, signal.finding_id)
        if found is not None and found.deleted_at is None:
            return found
    assessment = service.ensure_active_assessment(db, vendor, actor_id)
    links = "\n".join(f"- {s.get('title') or s.get('url')}: {s.get('url')}" for s in (signal.sources or []) if s.get("url"))
    finding = TPRAFinding(
        tenant_id=vendor.tenant_id, vendor_id=vendor.id, assessment_id=assessment.id,
        domain=_DOMAIN_FOR.get(signal.signal_type, "cybersecurity"), severity=signal.severity or "medium",
        title=(signal.title or f"{signal.signal_type.replace('_', ' ').title()} signal")[:255],
        description=(f"Raised from a monitoring signal ({signal.source or 'manual'}, "
                     f"{signal.occurred_at:%d %b %Y}).\n\n{signal.detail or ''}"
                     + (f"\n\nSources:\n{links}" if links else "")).strip(),
        status="open", created_by=actor_id,
    )
    db.add(finding)
    db.flush()
    signal.finding_id = finding.id
    service.write_audit(db, vendor.tenant_id, entity="signal", action="raise_finding", vendor_id=vendor.id,
                        assessment_id=assessment.id, entity_id=signal.id, actor_id=actor_id, to_value=finding.id)
    service.ensure_finding_issue(db, finding, actor_id)
    return finding


def reject(db: Session, signal: TPRAMonitoringSignal, actor_id: Optional[int], reason: Optional[str]) -> None:
    """Rule a fetched alert out as not about the vendor: it goes, and its articles
    are remembered so the same ones are never raised again."""
    from .adverse_media import fingerprint

    for source in signal.sources or []:
        if not source.get("url"):
            continue
        fp = fingerprint(source["url"])
        if not db.query(TPRASignalRejection.id).filter(
                TPRASignalRejection.tenant_id == signal.tenant_id, TPRASignalRejection.vendor_id == signal.vendor_id,
                TPRASignalRejection.provider == (signal.source or ""), TPRASignalRejection.fingerprint == fp).first():
            db.add(TPRASignalRejection(tenant_id=signal.tenant_id, vendor_id=signal.vendor_id,
                                       provider=signal.source or "", fingerprint=fp, reason=reason,
                                       rejected_by=actor_id))
    signal.deleted_at = datetime.utcnow()
    service.write_audit(db, signal.tenant_id, entity="signal", action="reject", vendor_id=signal.vendor_id,
                        entity_id=signal.id, actor_id=actor_id, reason=reason)
