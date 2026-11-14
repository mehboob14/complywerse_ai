"""PDF ingestion — the shared back-half of both PDF flows.

``create_pending_advisory`` is used by BOTH the upload endpoint and the scrape
flow, so the "extraction dict → pending Advisory + CVE rows" logic lives in one
place. ``scrape_source`` enumerates a CERT's PDFs (via ``scrapers.py``), downloads
each new one, runs the one extraction core, and files it as a PENDING advisory for
human review — never auto-tracked, because PDF extraction is best-effort.
"""
from __future__ import annotations

import logging
import os
import uuid
from typing import Any, Dict, List, Optional

import requests
from sqlalchemy.orm import Session

from .models import Advisory, AdvisoryCve, AdvisorySource
from .service import normalise_severity
from .extraction import extract_from_pdf
from .events import record_event
from .scrapers import PDF_SOURCE_REGISTRY, get_scraper, source_hint_for

logger = logging.getLogger(__name__)

# Uploaded/scraped advisory documents → backend/grc/uploads/advisories.
UPLOAD_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "uploads", "advisories"
)

_TIMEOUT = 30
_UA = {"User-Agent": "complyverse-advisory-sync/1.0"}
_MAX_PDF_BYTES = 25 * 1024 * 1024  # guard against a runaway download


def store_pdf(content: bytes) -> str:
    os.makedirs(UPLOAD_DIR, exist_ok=True)
    path = os.path.join(UPLOAD_DIR, f"{uuid.uuid4()}.pdf")
    with open(path, "wb") as fh:
        fh.write(content)
    return path


def download_pdf(url: str) -> bytes:
    """Fetch a PDF; raises on failure (caller handles per-item)."""
    resp = requests.get(url, headers=_UA, timeout=_TIMEOUT, stream=True)
    resp.raise_for_status()
    content = resp.content
    if len(content) > _MAX_PDF_BYTES:
        raise ValueError(f"PDF too large ({len(content)} bytes)")
    return content


def create_pending_advisory(
    db: Session,
    *,
    tenant_id: int,
    extracted: Dict[str, Any],
    source_id: Optional[int] = None,
    external_id: Optional[str] = None,
    url: Optional[str] = None,
    raw_file_path: Optional[str] = None,
    created_by: Optional[int] = None,
) -> Advisory:
    """Create a PENDING advisory + its proposed CVE rows from an extraction dict.
    No bridging here — bridging happens only when a human confirms it."""
    advisory = Advisory(
        tenant_id=tenant_id,
        source_id=source_id,
        external_id=external_id or extracted.get("external_id"),
        title=extracted["title"],
        summary=extracted.get("summary"),
        severity=normalise_severity(extracted["severity"]) if extracted.get("severity") else None,
        url=url,
        published_at=extracted.get("published_at"),
        raw_file_path=raw_file_path,
        extraction_meta=extracted.get("extraction"),
        status="pending",
        created_by=created_by,
    )
    db.add(advisory)
    db.flush()

    seen: set = set()
    for item in extracted.get("cves", []):
        cve = (item.get("cve_id") or "").strip().upper()
        if not cve or cve in seen:
            continue
        seen.add(cve)
        # Append to the relationship so advisory.cves reflects them immediately
        # (callers read len(advisory.cves) right after, e.g. for the event log).
        advisory.cves.append(AdvisoryCve(
            tenant_id=tenant_id, cve_id=cve,
            affected_product=item.get("affected_product"),
            affected_versions=item.get("affected_versions"),
        ))
    return advisory


def _get_or_create_pdf_source(db: Session, tenant_id: int, key: str) -> AdvisorySource:
    meta = PDF_SOURCE_REGISTRY[key]
    source = (
        db.query(AdvisorySource)
        .filter(AdvisorySource.tenant_id == tenant_id, AdvisorySource.name == meta["name"])
        .first()
    )
    if source is None:
        source = AdvisorySource(tenant_id=tenant_id, name=meta["name"], kind="upload")
        db.add(source)
        db.flush()
    return source


def scrape_source(db: Session, *, tenant_id: int, key: str, limit: int = 15,
                  actor: Any = None) -> Dict[str, Any]:
    """Scrape a CERT's PDF listing → download each new document → extract →
    file as a PENDING advisory. De-dups on (source, external_id) so re-scraping
    skips documents already pulled (and avoids re-downloading/re-running AI)."""
    meta = PDF_SOURCE_REGISTRY.get(key)
    if not meta:
        raise ValueError(f"unknown PDF source: {key}")
    scraper = get_scraper(key)
    if scraper is None:
        raise ValueError(f"{meta['name']} has no auto-scraper yet — upload its PDF instead")

    source = _get_or_create_pdf_source(db, tenant_id, key)
    targets = scraper(limit)
    hint = source_hint_for(key)

    created = 0
    skipped = 0
    errors: List[str] = []
    for t in targets:
        exists = (
            db.query(Advisory.id)
            .filter(
                Advisory.tenant_id == tenant_id,
                Advisory.source_id == source.id,
                Advisory.external_id == t.external_id,
            )
            .first()
        )
        if exists:
            skipped += 1
            continue
        try:
            content = download_pdf(t.url)
            extracted = extract_from_pdf(content, filename=t.title, source_hint=hint)
            extracted["title"] = extracted.get("title") or t.title  # listing title as floor
            path = store_pdf(content)
            adv = create_pending_advisory(
                db, tenant_id=tenant_id, extracted=extracted,
                source_id=source.id, external_id=t.external_id, url=t.url, raw_file_path=path,
            )
            db.flush()
            meta_x = extracted.get("extraction") or {}
            record_event(db, tenant_id=tenant_id, advisory_id=adv.id, event="ingested", actor=actor,
                         detail={"origin": "scrape", "source": meta["name"],
                                 "method": meta_x.get("method"), "confidence": meta_x.get("confidence"),
                                 "cves": len(adv.cves)})
            created += 1
        except Exception as exc:  # one bad document must not sink the batch
            logger.exception("advisory scrape %s: %s failed", key, t.url)
            errors.append(f"{t.external_id}: {exc}")

    db.commit()
    return {
        "source": meta["name"], "key": key, "region": meta["region"],
        "found": len(targets), "created": created, "skipped": skipped,
        "errors": errors, "status": "pending_review",
    }
