"""Outside-in monitoring feeds, behind one contract.

A connector says whether it is configured for a tenant, and polls one vendor:
it fetches, normalises what it found into signal drafts, and hands them back.
The runner here does the rest the same way for every feed — polls each vendor
on its tier's cadence (monitoring.due_vendors), writes each draft through
monitoring.record_signal (which dedupes on the provider's own id), and moves the
vendor's cursor on. A feed that is not configured contributes nothing and breaks
nothing; the screens say so rather than showing an empty column.

Feeds today:
  * Evidence library — certificates and reports on file that have lapsed. First-
    party, always on.
  * GDELT news — breach and adverse-media coverage, through the four checks in
    adverse_media.py. Off until a tenant turns it on (it queries the internet
    with vendor names).
A security-ratings provider is a paid feed (decision 2): it plugs in as another
connector when a client asks for one; until then ratings arrive by import
(ratings.py).
"""
from __future__ import annotations

import logging
from dataclasses import asdict, dataclass, field
from datetime import datetime, timedelta
from typing import List, Optional

from sqlalchemy.orm import Session

from ....models import Evidence, TPRAEvidenceLink, Vendor
from . import adverse_media, monitoring
from .bootstrap import get_tiering_config

logger = logging.getLogger(__name__)
BATCH = 50


@dataclass
class SignalDraft:
    """A provider-agnostic monitoring signal a connector emits (pre-persistence)."""
    # security_rating | breach | adverse_media | financial | sla | cert_expiry
    signal_type: str
    severity: str = "medium"          # critical | high | medium | low
    title: Optional[str] = None
    detail: Optional[str] = None
    external_id: Optional[str] = None  # the provider's own id: the dedupe key
    occurred_at: Optional[datetime] = None
    sources: list = field(default_factory=list)
    verification: Optional[dict] = None


class MonitoringConnector:
    """A live monitoring feed. Subclass: set provider/label/kind, implement both methods."""

    provider: str = "base"
    label: str = ""
    kind: str = ""                     # certificates | adverse_media | ratings | exposure
    reaches_internet: bool = False

    def is_configured(self, db: Session, tenant_id: int) -> bool:
        return False

    def poll(self, db: Session, vendor: Vendor, since: Optional[datetime], now: datetime) -> List[SignalDraft]:
        raise NotImplementedError     # pragma: no cover


class CertificateLapseConnector(MonitoringConnector):
    provider = "Evidence library"
    label = "Certificates and reports that have lapsed"
    kind = "certificates"

    def is_configured(self, db: Session, tenant_id: int) -> bool:
        return True

    def poll(self, db: Session, vendor: Vendor, since: Optional[datetime], now: datetime) -> List[SignalDraft]:
        drafts, seen = [], set()
        for link, ev in (db.query(TPRAEvidenceLink, Evidence).join(Evidence, Evidence.id == TPRAEvidenceLink.evidence_id)
                         .filter(TPRAEvidenceLink.vendor_id == vendor.id, TPRAEvidenceLink.deleted_at.is_(None),
                                 Evidence.expiry_date.isnot(None), Evidence.expiry_date < now,
                                 Evidence.expiry_date >= now - timedelta(days=365))):
            if ev.id in seen or (ev.status or "").lower() in ("archived", "superseded", "rejected"):
                continue
            seen.add(ev.id)
            drafts.append(SignalDraft(
                signal_type="cert_expiry", severity="low",
                title=f"{ev.name} lapsed on {ev.expiry_date:%d %b %Y}",
                detail="A certificate or report held for this vendor is past its expiry date. Ask the vendor for the current one.",
                external_id=f"cert:{ev.id}:{ev.expiry_date:%Y%m%d}", occurred_at=ev.expiry_date,
                sources=[{"title": ev.name, "evidence_id": ev.id}],
            ))
        return drafts


class AdverseMediaConnector(MonitoringConnector):
    provider = adverse_media.PROVIDER
    label = "Breach and adverse-media news"
    kind = "adverse_media"
    reaches_internet = True
    fetch = staticmethod(adverse_media.fetch_gdelt)

    def is_configured(self, db: Session, tenant_id: int) -> bool:
        return bool((get_tiering_config(db, tenant_id).get("monitoring_policy") or {}).get("adverse_media"))

    def poll(self, db: Session, vendor: Vendor, since: Optional[datetime], now: datetime) -> List[SignalDraft]:
        found = adverse_media.research(vendor.name, since, now,
                                       monitoring.rejected(db, vendor.tenant_id, vendor.id, self.provider),
                                       fetch=self.fetch)
        return [SignalDraft(**draft) for draft in found]


CONNECTORS: List[MonitoringConnector] = [CertificateLapseConnector(), AdverseMediaConnector()]


def providers(db: Session, tenant_id: int) -> List[dict]:
    """Every feed, whether it is on for this tenant, and what it does."""
    return [{"provider": c.provider, "label": c.label, "kind": c.kind, "reaches_internet": c.reaches_internet,
             "configured": c.is_configured(db, tenant_id)} for c in CONNECTORS]


def any_connector_configured(db: Optional[Session] = None, tenant_id: Optional[int] = None) -> bool:
    """Whether a feed beyond the evidence library is live (drives the honest
    'Manual monitoring' vs 'Continuous monitoring' labelling)."""
    if db is None or tenant_id is None:
        return False
    return any(c.is_configured(db, tenant_id) for c in CONNECTORS if c.kind != "certificates")


def run_connectors(db: Session, tenant_id: int, now: Optional[datetime] = None, batch: int = BATCH) -> dict:
    """Poll every configured feed for a tenant, each vendor on its tier's cadence."""
    now = now or datetime.utcnow()
    results = {}
    for connector in CONNECTORS:
        if not connector.is_configured(db, tenant_id):
            continue
        tally = {"polled": 0, "failed": 0, "new_signals": 0, "verified": 0}
        for vendor, last in monitoring.due_vendors(db, tenant_id, connector.provider, now, batch):
            try:
                with db.begin_nested():
                    for draft in connector.poll(db, vendor, last, now):
                        signal, _, created = monitoring.record_signal(
                            db, vendor, source=connector.provider, **asdict(draft))
                        if not created:
                            monitoring.corroborate(db, vendor, signal, draft.sources, draft.verification)
                        tally["new_signals"] += int(created)
                        tally["verified"] += int(created and signal.verified)
                    monitoring.mark_polled(db, tenant_id, vendor.id, connector.provider, now)
                tally["polled"] += 1
            except Exception as exc:  # noqa: BLE001 — one feed or vendor must not stop the sweep
                logger.warning("monitoring %s failed for vendor %s: %s", connector.provider, vendor.id, exc)
                monitoring.mark_failed(db, tenant_id, vendor.id, connector.provider, f"{type(exc).__name__}: {exc}")
                tally["failed"] += 1
        results[connector.provider] = tally
    return {"connectors": len(results), "results": results}
