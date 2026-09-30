"""Thomson Reuters Regulatory Intelligence → Governance regulatory feed items.

Plan §6.6. A feed source of type 'tr_regulatory_intelligence' pulls documents
through the tenant's Regulatory Intelligence connection (simulated or live) and
writes RegulatoryFeedItem rows (guid-deduped), after which the EXISTING flow —
AI analysis → convert to Regulatory Change → impact assessment → tasks — applies
unchanged. Same contract as ``poll_rss_feed``: returns FeedPollResult, commits.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta

from sqlalchemy.orm import Session

from ...models import RegulatoryFeedItem, RegulatoryFeedSource, TR_PROVIDER_TRRI
from ...schemas import FeedPollResult
from ...integrations_tr import connections, registry
from ...integrations_tr.http import ProviderError
from ...integrations_tr.trri import normalise_document

logger = logging.getLogger(__name__)

_FIRST_POLL_LOOKBACK = timedelta(days=30)
_OVERLAP = timedelta(hours=1)   # re-read a little history; guid dedup absorbs repeats


def poll_trri_feed(source: RegulatoryFeedSource, db: Session, tenant_id: int) -> FeedPollResult:
    now = datetime.utcnow()
    previous_success = source.last_successful_poll
    source.last_polled_at = now

    def fail(msg: str) -> FeedPollResult:
        db.commit()
        return FeedPollResult(feed_source_id=source.id, feed_source_name=source.name, success=False,
                              items_found=0, new_items=0, error_message=msg, polled_at=now)

    conn = connections.get_connection(db, tenant_id, TR_PROVIDER_TRRI)
    if conn is None or not conn.is_active:
        return fail("Regulatory Intelligence is not configured for this tenant (TPRM → Settings → Data providers).")
    since = (previous_success - _OVERLAP) if previous_success else (now - _FIRST_POLL_LOOKBACK)
    try:
        client = registry.trri_client(conn)
        docs = client.list_documents(source.provider_query or {}, since=since, limit=100)
    except (ProviderError, ValueError) as e:
        connections.record_result(conn, False, str(e))
        logger.warning("TRRI poll failed source=%s: %s", source.id, e)
        return fail(f"Regulatory Intelligence: {e}")

    new_items = 0
    try:
        for raw in docs:
            n = normalise_document(raw)
            if not n["guid"]:
                continue
            exists = db.query(RegulatoryFeedItem.id).filter(
                RegulatoryFeedItem.feed_source_id == source.id, RegulatoryFeedItem.guid == n["guid"],
            ).first()
            if exists:
                continue
            db.add(RegulatoryFeedItem(
                tenant_id=tenant_id, feed_source_id=source.id, guid=n["guid"], title=n["title"],
                description=(n["description"] or None) and str(n["description"])[:10000],
                link=n["link"], published_date=n["published_date"],
                content=(n["content"] or None) and str(n["content"])[:50000],
                status="new", external_metadata=n["metadata"],
            ))
            new_items += 1
        source.last_successful_poll = now
        source.items_processed = (source.items_processed or 0) + new_items
        connections.record_result(conn, True)
        db.commit()
    except Exception as e:  # noqa: BLE001 — mirror poll_rss_feed: report, don't raise
        db.rollback()
        source = db.merge(source)
        source.last_polled_at = now
        db.commit()
        logger.exception("TRRI ingest failed source=%s", source.id)
        return FeedPollResult(feed_source_id=source.id, feed_source_name=source.name, success=False,
                              items_found=len(docs), new_items=0, error_message=str(e), polled_at=now)
    return FeedPollResult(feed_source_id=source.id, feed_source_name=source.name, success=True,
                          items_found=len(docs), new_items=new_items, error_message=None, polled_at=now)
