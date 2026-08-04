"""Continuous-monitoring connector framework (extension point / scaffolding).

TPRA monitoring signals are entered MANUALLY today. This module is the seam for
LIVE outside-in feeds — BitSight / SecurityScorecard / UpGuard security ratings,
breach & adverse-media monitoring, financial-health, and certificate expiry — so a
provider can be plugged in without touching signal ingest or the reassessment
trigger.

To add a real feed:
  1. Subclass ``MonitoringConnector`` and implement ``poll(db, tenant_id)`` against
     the provider API (read credentials from env or a tenant secret store), returning
     a list of ``SignalDraft``.
  2. Register the instance in ``CONNECTORS`` (e.g. ``CONNECTORS.append(BitSightConnector())``).
  3. The ``poll_monitoring_connectors_sweep`` Celery beat task ingests the drafts on a
     schedule, dedups by ``external_id``, writes ``TPRAMonitoringSignal`` rows, and
     fires the existing ``should_trigger_reassessment`` path.

Until a provider + credentials are configured, ``CONNECTORS`` is empty and monitoring
stays MANUAL (the UI is labelled accordingly). Full row-ingestion + external_id dedup
lands with the first real provider (needs an additive ``external_id`` column via
``schema_migrations._TPRA_ADDS``).
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
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


class MonitoringConnector:
    """Base class for a live monitoring feed. Subclass and implement ``poll``."""

    provider: str = "base"
    requires_credentials: bool = True

    def is_configured(self) -> bool:
        """True only when credentials/config are present. Real connectors check env
        or a tenant secret store; the base is never configured (manual monitoring)."""
        return False

    def poll(self, db: Session, tenant_id: int) -> List[SignalDraft]:  # pragma: no cover
        raise NotImplementedError


# Registered live connectors — EMPTY until a provider + credentials are wired in.
# Adding one here (and its is_configured/poll) is all that's needed to go from
# manual monitoring to a live feed.
CONNECTORS: List[MonitoringConnector] = []


def any_connector_configured() -> bool:
    """Whether at least one live monitoring feed is configured (drives the honest
    'Manual monitoring' vs 'Continuous monitoring' labelling)."""
    return any(c.is_configured() for c in CONNECTORS)


def run_connectors(db: Session, tenant_id: int) -> dict:
    """Poll every configured connector for a tenant and ingest its signal drafts.

    A no-op while ``CONNECTORS`` is empty. When a real provider is registered, this
    is where each draft is deduped by ``external_id`` and turned into a
    ``TPRAMonitoringSignal`` (reusing the create-signal + reassessment-trigger path).
    Failures in one connector never abort the sweep."""
    ingested = 0
    for c in CONNECTORS:
        if not c.is_configured():
            continue
        try:
            drafts = c.poll(db, tenant_id) or []
        except Exception:  # noqa: BLE001 — a flaky feed must not break the sweep
            logger.exception("monitoring connector %s poll failed (tenant=%s)", c.provider, tenant_id)
            continue
        # Row-ingestion (dedup by external_id + create_signal + trigger) is added with
        # the first live provider; counting here exercises the wiring end-to-end.
        ingested += len(drafts)
        logger.info("monitoring connector %s: %d draft(s) (tenant=%s)", c.provider, len(drafts), tenant_id)
    return {"connectors": len(CONNECTORS), "ingested": ingested}
