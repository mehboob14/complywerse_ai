"""Pull advisories from an API source and upsert them for a tenant.

API-sourced advisories are created ``open`` and bridged immediately — a
structured feed is trustworthy, unlike an uploaded PDF (which needs the
human-review gate). De-dup is per (source, external_id); cross-source CVE
de-dup is Sprint 6.
"""
from __future__ import annotations

import logging
from typing import Any, Dict

from sqlalchemy.orm import Session

from .models import Advisory, AdvisoryCve, AdvisorySource
from .service import normalise_severity
from .events import record_event
from .sources import SOURCE_REGISTRY, get_fetcher

logger = logging.getLogger(__name__)


def _get_or_create_source(db: Session, tenant_id: int, key: str) -> AdvisorySource:
    meta = SOURCE_REGISTRY[key]
    source = (
        db.query(AdvisorySource)
        .filter(AdvisorySource.tenant_id == tenant_id, AdvisorySource.name == meta["name"])
        .first()
    )
    if source is None:
        source = AdvisorySource(tenant_id=tenant_id, name=meta["name"], kind=meta["kind"])
        db.add(source)
        db.flush()
    return source


def _short_error(exc: Exception) -> str:
    """A short, UI-friendly reason — e.g. 'HTTP 404 from source' / 'timed out'."""
    import requests as _rq
    if isinstance(exc, _rq.HTTPError) and exc.response is not None:
        return f"HTTP {exc.response.status_code} from source (unreachable from this host)"
    if isinstance(exc, (_rq.ConnectionError, _rq.Timeout)):
        return "source unreachable (connection/timeout)"
    return str(exc)[:160] or exc.__class__.__name__


def sync_source(db: Session, *, tenant_id: int, key: str, limit: int = 50,
                actor: Any = None) -> Dict[str, Any]:
    """Fetch the source's latest advisories and upsert them. Caller-agnostic:
    used by the manual sync endpoint and (later) the scheduled task. A fetch
    failure is reported (ok=False + reason), not swallowed into a silent 0."""
    fetcher = get_fetcher(key)
    meta = SOURCE_REGISTRY.get(key)
    if not fetcher or not meta:
        raise ValueError(f"unknown advisory source: {key}")

    source = _get_or_create_source(db, tenant_id, key)
    try:
        drafts = fetcher(limit)
    except Exception as exc:
        logger.warning("advisory sync %s: fetch failed: %s", key, exc)
        return {"source": meta["name"], "key": key, "ok": False,
                "error": _short_error(exc), "fetched": 0, "created": 0, "updated": 0}

    created = 0
    updated = 0
    for d in drafts:
        existing = (
            db.query(Advisory)
            .filter(
                Advisory.tenant_id == tenant_id,
                Advisory.source_id == source.id,
                Advisory.external_id == d.external_id,
            )
            .first()
        )
        if existing is not None:
            # Record an 'updated' event only when a field actually changed upstream.
            changed = []
            new_title = d.title or existing.title
            if new_title != existing.title:
                existing.title = new_title
                changed.append("title")
            if d.summary is not None and d.summary != existing.summary:
                existing.summary = d.summary
                changed.append("summary")
            if d.severity:
                new_sev = normalise_severity(d.severity)
                if new_sev != existing.severity:
                    existing.severity = new_sev
                    changed.append("severity")
            # Backfill the real publication date (RSS <pubDate>) onto advisories
            # synced before the parser captured it.
            if d.published_at is not None and d.published_at != existing.published_at:
                existing.published_at = d.published_at
                changed.append("published_at")
            if changed:
                record_event(db, tenant_id=tenant_id, advisory_id=existing.id, event="updated",
                             actor=actor, detail={"source": meta["name"], "fields": changed})
                updated += 1
            continue

        advisory = Advisory(
            tenant_id=tenant_id,
            source_id=source.id,
            external_id=d.external_id,
            title=d.title,
            summary=d.summary,
            severity=normalise_severity(d.severity) if d.severity else None,
            url=d.url,
            published_at=d.published_at,
            status="open",
        )
        db.add(advisory)
        db.flush()
        seen: set = set()
        for item in d.cves:
            cve = (item.get("cve_id") or "").strip().upper()
            if not cve or cve in seen:
                continue
            seen.add(cve)
            row = AdvisoryCve(
                tenant_id=tenant_id, advisory_id=advisory.id, cve_id=cve,
                affected_product=item.get("product"), affected_versions=item.get("versions"),
            )
            db.add(row)
            db.flush()
        record_event(db, tenant_id=tenant_id, advisory_id=advisory.id, event="ingested", actor=actor,
                     detail={"origin": "api", "source": meta["name"], "cves": len(seen)})
        created += 1

    db.commit()
    return {"source": meta["name"], "key": key, "ok": True, "fetched": len(drafts),
            "created": created, "updated": updated}
