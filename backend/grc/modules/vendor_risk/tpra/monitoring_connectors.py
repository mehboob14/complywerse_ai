"""Continuous-monitoring connector framework.

Monitoring signals can be entered MANUALLY, and live outside-in feeds plug in
here: a ``MonitoringConnector`` polls its provider for a tenant and returns
``SignalDraft`` rows, which ``run_connectors`` ingests through the SAME
``service.ingest_signal`` path as manual entry (dedup by ``external_id``, then the
existing ``should_trigger_reassessment`` + in-flight debounce).

Connectors are tenant-aware: ``is_configured(db, tenant_id)`` is true only when
that tenant has an active connection (credentials are per tenant). The built-in
World-Check One (LSEG) ongoing-screening connector is registered lazily by
``_ensure_builtin_connectors``. The ``poll_monitoring_connectors_sweep`` Celery
beat task runs this every 6 hours.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime
from typing import List, Optional

from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)


@dataclass
class SignalDraft:
    """A provider-agnostic monitoring signal a connector emits (pre-persistence)."""
    vendor_id: int
    # security_rating | breach | adverse_media | financial | sla | cert_expiry
    signal_type: str
    severity: str = "medium"          # critical | high | medium | low
    title: Optional[str] = None
    detail: Optional[str] = None
    source: Optional[str] = None      # provider name, e.g. "BitSight"
    external_id: Optional[str] = None  # provider event id — dedup key for ingest
    occurred_at: Optional[datetime] = None
    source_ref: Optional[dict] = None  # e.g. {"match_id": 12, "subject_id": 3}
    simulated: bool = False            # produced by a simulated provider


class MonitoringConnector:
    """Base class for a live monitoring feed. Subclass and implement ``poll``."""

    provider: str = "base"
    requires_credentials: bool = True

    def is_configured(self, db: Optional[Session] = None, tenant_id: Optional[int] = None) -> bool:
        """True only when this tenant has credentials/config for the feed. The base
        is never configured (manual monitoring)."""
        return False

    def poll(self, db: Session, tenant_id: int) -> List[SignalDraft]:  # pragma: no cover
        raise NotImplementedError


# Registered live connectors. Built-ins are appended by _ensure_builtin_connectors;
# CONNECTORS.append(MyConnector()) still works for additional feeds.
CONNECTORS: List[MonitoringConnector] = []
_BUILTINS_LOADED = False


def _ensure_builtin_connectors() -> None:
    global _BUILTINS_LOADED
    if _BUILTINS_LOADED:
        return
    _BUILTINS_LOADED = True
    try:
        from .screening import WorldCheckOneConnector
        if not any(c.provider == WorldCheckOneConnector.provider for c in CONNECTORS):
            CONNECTORS.append(WorldCheckOneConnector())
    except ImportError:
        logger.debug("built-in monitoring connectors unavailable")
    except Exception:  # noqa: BLE001 — a broken optional feed must not break monitoring
        logger.exception("failed to register built-in monitoring connectors")


def any_connector_configured(db: Optional[Session] = None, tenant_id: Optional[int] = None) -> bool:
    """Whether at least one live monitoring feed is configured (drives the honest
    'Manual monitoring' vs 'Continuous monitoring' labelling)."""
    _ensure_builtin_connectors()
    for c in CONNECTORS:
        try:
            if c.is_configured(db, tenant_id):
                return True
        except Exception:  # noqa: BLE001
            logger.exception("monitoring connector %s is_configured failed", c.provider)
    return False


def ingest_drafts(db: Session, tenant_id: int, drafts: List[SignalDraft]) -> dict:
    """Persist drafts via service.ingest_signal. Returns counts. Caller commits."""
    from ....models import Vendor
    from . import service

    created = duplicates = skipped = 0
    for d in drafts:
        vendor = db.query(Vendor).filter(
            Vendor.id == d.vendor_id, Vendor.tenant_id == tenant_id, Vendor.deleted_at.is_(None),
        ).first()
        if vendor is None:
            skipped += 1
            continue
        _sig, _trig, was_created = service.ingest_signal(
            db, vendor, signal_type=d.signal_type, severity=d.severity, source=d.source,
            title=d.title, detail=d.detail, occurred_at=d.occurred_at, actor_id=None,
            external_id=d.external_id, source_ref=d.source_ref, simulated=d.simulated,
        )
        if was_created:
            created += 1
        else:
            duplicates += 1
    return {"created": created, "duplicates": duplicates, "skipped": skipped}


def run_connectors(db: Session, tenant_id: int) -> dict:
    """Poll every configured connector for a tenant and ingest its signal drafts.
    Failures in one connector never abort the sweep (its work is rolled back to a
    savepoint so other connectors' signals still land)."""
    _ensure_builtin_connectors()
    ingested = duplicates = 0
    errors: List[str] = []
    for c in CONNECTORS:
        try:
            if not c.is_configured(db, tenant_id):
                continue
        except Exception:  # noqa: BLE001
            logger.exception("monitoring connector %s is_configured failed (tenant=%s)", c.provider, tenant_id)
            continue
        nested = db.begin_nested()
        try:
            drafts = c.poll(db, tenant_id) or []
            counts = ingest_drafts(db, tenant_id, drafts)
            nested.commit()
        except Exception as exc:  # noqa: BLE001 — a flaky feed must not break the sweep
            nested.rollback()
            logger.exception("monitoring connector %s poll failed (tenant=%s)", c.provider, tenant_id)
            errors.append(f"{c.provider}: {exc.__class__.__name__}")
            continue
        ingested += counts["created"]
        duplicates += counts["duplicates"]
        logger.info("monitoring connector %s: %d new signal(s), %d duplicate(s) (tenant=%s)",
                    c.provider, counts["created"], counts["duplicates"], tenant_id)
    return {"connectors": len(CONNECTORS), "ingested": ingested, "duplicates": duplicates, "errors": errors}
