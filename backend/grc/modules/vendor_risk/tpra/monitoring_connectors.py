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
  * CISA KEV — a known-exploited vulnerability in a product on a vendor's
    watchlist. On once any vendor has a watched product; it reads the catalogue
    the vulnerability module already downloads daily, every vendor every day.
  * CISA KEV, technology seen — a newly listed known-exploited vulnerability in
    software an outside-in scan saw on a supplier's estate. The version cannot be
    confirmed from outside, so the alert is kept unverified: shown for triage,
    never reopening an assessment by itself.
  * Outside-in scan — each supplier's websites and domains as the internet sees
    them (outside_in.py): certificates, web hardening, mail spoofing protection,
    and exposed services and vulnerabilities where a Shodan key is held. Off until
    a tenant turns it on; on its own, slower tier cadence and a small batch.
  * UpGuard, SecurityScorecard and BitSight — ratings from the providers a tenant
    pays for (rating_feeds.py), on once its key is added under Admin → Connectors.
    Without one, ratings still arrive by import (ratings.py).
"""
from __future__ import annotations

import logging
import re
from dataclasses import asdict, dataclass, field
from datetime import datetime, timedelta
from typing import List, Optional

from sqlalchemy.orm import Session

from ....models import Evidence, TPRAEvidenceLink, TPRASurfaceScan, TPRAVendorProduct, Vendor
from . import adverse_media, monitoring, monitoring_policy, outside_in, rating_feeds, ratings
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
    kind: str = ""                     # certificates | adverse_media | ratings | vulnerabilities
    reaches_internet: bool = False
    every_days: Optional[int] = None   # one cadence for every vendor, instead of the tier's
    cadence: Optional[dict] = None     # or its own days per tier, instead of monitoring.POLL_EVERY_DAYS
    # Which of the tenant's cadences it follows (monitoring_policy): checks, or the slower scans.
    cadence_key: str = "check_every_days"
    batch: Optional[int] = None        # fewer vendors per run for a slow feed

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


def _words(text) -> str:
    return " ".join(w for w in re.split(r"[^a-z0-9]+", str(text or "").lower().replace("_", " ")) if w)


def product_matches(product: TPRAVendorProduct, vendor_name: str, entry: dict) -> bool:
    """Does a catalogue entry concern this watched product? The vendor must match
    (its CPE vendor, or the vendor's own name); then the product, if one is named."""
    wanted_vendors = {_words(product.cpe_vendor), _words(adverse_media.core_name(vendor_name))} - {""}
    if _words(entry.get("vendor_project")) not in wanted_vendors:
        return False
    wanted = _words(product.cpe_product) or _words(product.name)
    found = _words(entry.get("product"))
    return not wanted or wanted in found or (bool(found) and found in wanted)


def _kev_catalogue() -> dict:
    from ...vuln_management.enrichment.kev_cache import all_kev_cves, kev_metadata

    return {cve: kev_metadata(cve) or {} for cve in all_kev_cves()}


class ProductWatchConnector(MonitoringConnector):
    provider = "CISA KEV"
    label = "Known exploited vulnerabilities in watched products"
    kind = "vulnerabilities"
    reaches_internet = True            # the CISA catalogue, already fetched for vulnerability enrichment
    every_days = 1
    catalogue = staticmethod(_kev_catalogue)

    def is_configured(self, db: Session, tenant_id: int) -> bool:
        return db.query(TPRAVendorProduct.id).filter(TPRAVendorProduct.tenant_id == tenant_id).first() is not None

    def poll(self, db: Session, vendor: Vendor, since: Optional[datetime], now: datetime) -> List[SignalDraft]:
        products = db.query(TPRAVendorProduct).filter(TPRAVendorProduct.vendor_id == vendor.id).all()
        if not products:
            return []
        start = (since or now - timedelta(days=30)) - timedelta(days=3)
        drafts = []
        for cve, entry in self.catalogue().items():
            added = entry.get("date_added")
            if not added or added < start or not any(product_matches(p, vendor.name, entry) for p in products):
                continue
            ransomware = str(entry.get("known_ransomware_campaign_use") or "").lower() == "known"
            action = entry.get("required_action")
            due = entry.get("due_date")
            drafts.append(SignalDraft(
                signal_type="vulnerability", severity="high" if ransomware else "medium",
                title=f"{cve}: {entry.get('vulnerability_name') or entry.get('product') or 'known exploited vulnerability'}"[:255],
                detail=(f"{entry.get('short_description') or ''}"
                        + (f"\n\nRequired action: {action}" if action else "")
                        + (f" (CISA due date {due:%d %b %Y})" if due else "")
                        + ("\n\nKnown to be used in ransomware campaigns." if ransomware else "")).strip(),
                external_id=f"kev:{cve}", occurred_at=added,
                sources=[{"url": f"https://nvd.nist.gov/vuln/detail/{cve}", "title": cve, "domain": "nvd.nist.gov"}],
                verification={"verified": True, "checks": {"catalogue": "CISA Known Exploited Vulnerabilities"}},
            ))
        return drafts


def tech_matches(tech_name: str, entry: dict) -> bool:
    """Does a catalogue entry concern a technology seen on an estate? Every word of
    the technology's name must be in the entry's vendor and product, and one at
    least in the product itself ("Apache HTTP Server" matches Apache / HTTP Server)."""
    wanted = set(_words(tech_name).split())
    product = set(_words(entry.get("product")).split())
    return bool(wanted) and wanted <= product | set(_words(entry.get("vendor_project")).split()) and bool(wanted & product)


class TechnologyWatchConnector(MonitoringConnector):
    provider = "CISA KEV, technology seen"
    label = "Known exploited vulnerabilities in software seen on a supplier's estate"
    kind = "vulnerabilities"
    reaches_internet = True            # the CISA catalogue, already fetched for vulnerability enrichment
    every_days = 1
    catalogue = staticmethod(_kev_catalogue)

    def is_configured(self, db: Session, tenant_id: int) -> bool:
        return outside_in.policy_on(db, tenant_id)

    def poll(self, db: Session, vendor: Vendor, since: Optional[datetime], now: datetime) -> List[SignalDraft]:
        scan = (db.query(TPRASurfaceScan).filter(TPRASurfaceScan.vendor_id == vendor.id, TPRASurfaceScan.status == "done")
                .order_by(TPRASurfaceScan.started_at.desc()).first())
        techs = outside_in.seen_technologies(scan) if scan is not None else []
        if not techs:
            return []
        start = (since or now - timedelta(days=30)) - timedelta(days=3)
        drafts = []
        for cve, entry in self.catalogue().items():
            added = entry.get("date_added")
            hit = next((t for t in techs if tech_matches(t["name"], entry)), None) if added and added >= start else None
            if hit is None:
                continue
            ransomware = str(entry.get("known_ransomware_campaign_use") or "").lower() == "known"
            hosts = ", ".join((hit.get("hosts") or [])[:3]) or "its estate"
            drafts.append(SignalDraft(
                signal_type="vulnerability", severity="high" if ransomware else "medium",
                title=f"{cve}: {hit['name']} is seen on {vendor.name}'s estate"[:255],
                detail=(f"{entry.get('short_description') or entry.get('vulnerability_name') or ''}\n\n"
                        f"{hit['name']} was seen on {hosts}"
                        + (f" (version {', '.join(hit['versions'])})" if hit.get("versions") else "")
                        + ". Whether that version is affected cannot be told from outside: ask the supplier whether "
                          "it is affected and patched."
                        + ("\n\nKnown to be used in ransomware campaigns." if ransomware else "")).strip(),
                external_id=f"kev-tech:{cve}", occurred_at=added,
                sources=[{"url": f"https://nvd.nist.gov/vuln/detail/{cve}", "title": cve, "domain": "nvd.nist.gov"}],
                verification={"verified": False, "checks": {"catalogue": "CISA Known Exploited Vulnerabilities",
                                                            "match": f"{hit['name']} seen from outside; version unconfirmed"}},
            ))
        return drafts


class SurfaceScanConnector(MonitoringConnector):
    provider = outside_in.PROVIDER
    label = "Supplier websites and domains, as the internet sees them"
    kind = "ratings"
    reaches_internet = True
    cadence = outside_in.SCAN_EVERY_DAYS
    cadence_key = "scan_every_days"
    batch = 10                         # a scan can take a minute

    def is_configured(self, db: Session, tenant_id: int) -> bool:
        return outside_in.policy_on(db, tenant_id)

    def poll(self, db: Session, vendor: Vendor, since: Optional[datetime], now: datetime) -> List[SignalDraft]:
        if not outside_in.domains_for(vendor):
            return []
        scan = TPRASurfaceScan(tenant_id=vendor.tenant_id, vendor_id=vendor.id, status="running", started_at=now)
        db.add(scan)
        db.flush()
        return [SignalDraft(**d) for d in outside_in.drafts(vendor, outside_in.complete(db, scan, vendor, now))]


class RatingFeedConnector(MonitoringConnector):
    """A paid ratings provider: the latest rating for the supplier's main domain.
    ratings.record keeps it and raises the signal when it falls."""
    kind = "ratings"
    reaches_internet = True
    cadence = outside_in.SCAN_EVERY_DAYS
    cadence_key = "scan_every_days"

    def __init__(self, integration: str):
        self.integration, self.provider = integration, rating_feeds.PROVIDERS[integration]
        self.label = f"{self.provider} security ratings"

    def is_configured(self, db: Session, tenant_id: int) -> bool:
        return rating_feeds.credentials(db, tenant_id, self.integration) is not None

    def poll(self, db: Session, vendor: Vendor, since: Optional[datetime], now: datetime) -> List[SignalDraft]:
        domains = outside_in.domains_for(vendor)
        creds = rating_feeds.credentials(db, vendor.tenant_id, self.integration)
        found = rating_feeds.FETCH[self.integration](domains[0], creds) if domains and creds else None
        if found:
            ratings.record(db, vendor, self.provider, found["score"], now, found.get("grade"),
                           details={"risks": found["risks"]} if found.get("risks") else None)
        return []


CONNECTORS: List[MonitoringConnector] = [
    CertificateLapseConnector(), AdverseMediaConnector(), ProductWatchConnector(), TechnologyWatchConnector(),
    SurfaceScanConnector(),
    *(RatingFeedConnector(key) for key in rating_feeds.PROVIDERS),
]


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
    days = monitoring_policy.for_tenant(db, tenant_id)
    for connector in CONNECTORS:
        if not connector.is_configured(db, tenant_id):
            continue
        tally = {"polled": 0, "failed": 0, "new_signals": 0, "verified": 0}
        cadence = days.get(connector.cadence_key) or connector.cadence
        for vendor, last in monitoring.due_vendors(db, tenant_id, connector.provider, now, connector.batch or batch,
                                                   every_days=connector.every_days, cadence=cadence):
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
