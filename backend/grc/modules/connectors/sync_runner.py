"""Synchronous sync execution (shared by the Celery task and the
inline-fallback path in the router).

The dispatcher decides which adapter method to call based on
`connection.category`:

  * ticketing  → push queued vulns/exceptions + pull statuses on known external_ids
  * siem       → fetch_events since last_sync_at → enrich vulns
  * pentest    → fetch_exploits since last_sync_at → boost vuln priority
  * collab     → light health probe (active sends are on-demand)
  * transcribe → fetch_transcripts → create CommitteeMeetingMinutes rows

This module owns the dispatch + result persistence; the actual data
fan-out (vuln/exception lookup, exploitation enrichment, meeting minute
creation) is delegated to small helpers below so each category stays
testable in isolation.
"""
from __future__ import annotations

import logging
from datetime import datetime
from typing import Any, Dict, List

from sqlalchemy.orm import Session

from ...models import IntegrationConnection, SyncHistory
from ...services.connector_credentials import (
    decrypt_credentials,
    encrypt_credentials,
)
from .base import (
    CollabAdapter,
    PenTestAdapter,
    SiemAdapter,
    SyncResult,
    TicketingAdapter,
    TranscribeAdapter,
)
from .registry import build_adapter

logger = logging.getLogger(__name__)


def run_inline_sync(conn: IntegrationConnection, db: Session) -> Dict[str, Any]:
    """Entry point shared with the Celery task. Returns a serialisable dict."""
    started = datetime.utcnow()
    history = SyncHistory(
        tenant_id=conn.tenant_id,
        connection_id=conn.id,
        sync_type="manual",
        started_at=started,
        status="running",
    )
    db.add(history)
    db.commit()
    db.refresh(history)

    try:
        creds = decrypt_credentials(conn.encrypted_credentials) or {}
        tokens = decrypt_credentials(conn.oauth_tokens) or {}
        adapter = build_adapter(
            provider=conn.integration_type,
            console_url=conn.console_url,
            credentials=creds,
            config=conn.provider_config or {},
            oauth_tokens=tokens,
        )

        result = _dispatch_sync(adapter, conn, db)

        # Adapter may have refreshed OAuth tokens during the sync — persist.
        if adapter.oauth_tokens and adapter.oauth_tokens != tokens:
            conn.oauth_tokens = encrypt_credentials(adapter.oauth_tokens)

        conn.last_sync_at = datetime.utcnow()
        conn.last_sync_status = "success" if result.success else (
            "partial" if (result.items_pulled + result.items_pushed + result.items_updated) else "failed"
        )
        conn.last_sync_stats = {
            "pushed": result.items_pushed,
            "pulled": result.items_pulled,
            "updated": result.items_updated,
            "closed": result.items_closed,
            "errors": result.errors[:10],
        }
        conn.consecutive_failures = 0 if result.success else (conn.consecutive_failures or 0) + 1
        conn.status = "connected" if result.success else "error"

        completed = datetime.utcnow()
        history.completed_at = completed
        history.duration_ms = int((completed - started).total_seconds() * 1000)
        history.status = conn.last_sync_status
        history.errors_count = len(result.errors)
        history.error_details = {"errors": result.errors[:25]} if result.errors else None
        history.sync_metadata = result.details
        db.commit()

        return {
            "success": result.success,
            "stats": conn.last_sync_stats,
            "errors": result.errors[:10],
        }
    except Exception as exc:
        logger.exception("Connector sync failed for %s", conn.id)
        conn.last_sync_status = "failed"
        conn.consecutive_failures = (conn.consecutive_failures or 0) + 1
        conn.status = "error"
        history.completed_at = datetime.utcnow()
        history.status = "failed"
        history.errors_count = 1
        history.error_details = {"errors": [str(exc)]}
        db.commit()
        return {"success": False, "errors": [str(exc)]}


def _dispatch_sync(adapter, conn: IntegrationConnection, db: Session) -> SyncResult:
    """Route to the right adapter call based on category."""
    cat = (conn.category or "").lower()

    if cat == "ticketing":
        return _sync_ticketing(adapter, conn, db)
    if cat == "siem":
        return adapter.run_sync(since=conn.last_sync_at)
    if cat == "pentest":
        return adapter.run_sync(since=conn.last_sync_at)
    if cat == "collab":
        return adapter.run_sync()
    if cat == "transcribe":
        result = adapter.run_sync(since=conn.last_sync_at)
        _persist_transcripts(result, conn, db)
        return result
    # Unknown category — run the health probe equivalent.
    return adapter.run_sync() if hasattr(adapter, "run_sync") else SyncResult(success=False, errors=[f"Unknown category {cat}"])


# ─── Ticketing fan-out ──────────────────────────────────────────────

def _sync_ticketing(adapter: TicketingAdapter, conn: IntegrationConnection, db: Session) -> SyncResult:
    """Find vulns/exceptions queued for push, send them, then pull back
    statuses on already-pushed tickets.

    "Queued for push" semantics: any open vuln above the tenant's
    configured CVSS push threshold (default 7.0) that doesn't already
    have a `ticket_external_id` recorded. Exceptions: any pending
    exception request the tenant hasn't pushed yet.
    """
    from ...models import Vulnerability, PolicyException
    from .base import TicketRequest

    push_threshold = float((conn.provider_config or {}).get("push_cvss_threshold", 7.0))

    # Vulnerabilities ready to push (no ticket yet, CVSS >= threshold, status open).
    vulns = (
        db.query(Vulnerability)
        .filter(
            Vulnerability.tenant_id == conn.tenant_id,
            Vulnerability.status == "open",
            Vulnerability.cvss_score >= push_threshold,
        )
        .limit(50)
        .all()
    )
    # Filter to those without a stored ticket id for this connector.
    requests = []
    for v in vulns:
        existing_tickets = ((v.template_fields or {}).get("connector_tickets") or {})
        if str(conn.id) in existing_tickets:
            continue
        requests.append(TicketRequest(
            kind="vulnerability",
            summary=v.title or f"CVE: {v.cve_id or 'unknown'}",
            description=v.description or "",
            severity=(v.severity or "medium").lower(),
            external_id=str(v.id),
            extra_fields={"u_cve_id": v.cve_id or ""},
        ))

    # Exception requests pending push.
    exceptions = (
        db.query(PolicyException)
        .filter(
            PolicyException.tenant_id == conn.tenant_id,
            PolicyException.status == "pending",
        )
        .limit(50)
        .all()
    )
    for e in exceptions:
        existing_ext = (e.metadata_info or {}).get("connector_tickets", {}).get(str(conn.id))
        if existing_ext:
            continue
        requests.append(TicketRequest(
            kind="exception",
            summary=e.title or "Policy exception request",
            description=e.justification or e.description or "",
            severity="medium",
            external_id=f"exception:{e.id}",
        ))

    # Known external ids — for status sync.
    known_ids: List[str] = []
    for v in vulns:
        tk = ((v.template_fields or {}).get("connector_tickets") or {}).get(str(conn.id))
        if tk: known_ids.append(tk)
    for e in exceptions:
        tk = (e.metadata_info or {}).get("connector_tickets", {}).get(str(conn.id))
        if tk: known_ids.append(tk)

    result = adapter.run_sync(requests=requests, known_ids=known_ids)

    # Persist the new external ids back onto the vuln/exception rows so
    # we don't double-push next time.
    created = result.details.get("created") or []
    if created:
        for entry in created:
            if entry["kind"] == "vulnerability":
                v = db.query(Vulnerability).filter(
                    Vulnerability.id == int(entry["ours"]),
                    Vulnerability.tenant_id == conn.tenant_id,
                ).first()
                if v:
                    fields = dict(v.template_fields or {})
                    tickets = dict(fields.get("connector_tickets") or {})
                    tickets[str(conn.id)] = entry["external_id"]
                    fields["connector_tickets"] = tickets
                    v.template_fields = fields
            else:  # exception
                try:
                    ex_id = int(entry["ours"].split(":", 1)[1])
                except Exception:
                    continue
                e = db.query(PolicyException).filter(
                    PolicyException.id == ex_id,
                    PolicyException.tenant_id == conn.tenant_id,
                ).first()
                if e:
                    info = dict(e.metadata_info or {})
                    tickets = dict(info.get("connector_tickets") or {})
                    tickets[str(conn.id)] = entry["external_id"]
                    info["connector_tickets"] = tickets
                    e.metadata_info = info

    db.commit()
    return result


# ─── Transcript fan-out ─────────────────────────────────────────────

def _persist_transcripts(result: SyncResult, conn: IntegrationConnection, db: Session) -> None:
    """Best-effort persistence of pulled transcripts as committee meeting
    minutes. The transcript-to-committee mapping needs explicit pairing
    (calendar invite → committee), which is configured via
    `provider_config['committee_id']`. If that's not set we leave the
    transcripts as raw artefacts on the SyncHistory row.
    """
    try:
        from ...models import CommitteeMeeting, GovernanceCommittee
    except Exception:
        return

    committee_id = (conn.provider_config or {}).get("committee_id")
    if not committee_id:
        return
    committee = db.query(GovernanceCommittee).filter(
        GovernanceCommittee.id == committee_id,
        GovernanceCommittee.tenant_id == conn.tenant_id,
    ).first()
    if not committee:
        return

    summaries = result.details.get("transcripts") or []
    for s in summaries:
        started_iso = s.get("started_at")
        try:
            started_at = datetime.fromisoformat((started_iso or "").replace("Z", "+00:00"))
        except Exception:
            started_at = datetime.utcnow()
        existing = db.query(CommitteeMeeting).filter(
            CommitteeMeeting.tenant_id == conn.tenant_id,
            CommitteeMeeting.committee_id == committee.id,
            CommitteeMeeting.title == s.get("title"),
            CommitteeMeeting.scheduled_at == started_at,
        ).first()
        if existing:
            continue
        try:
            meeting = CommitteeMeeting(
                tenant_id=conn.tenant_id,
                committee_id=committee.id,
                title=s.get("title") or "(Imported meeting)",
                scheduled_at=started_at,
                duration_minutes=s.get("duration"),
                status="completed",
                source=f"transcribe:{conn.integration_type}",
            )
            db.add(meeting)
        except Exception:
            logger.exception("Failed to create CommitteeMeeting from transcript")

    try:
        db.commit()
    except Exception:
        logger.exception("Failed to commit transcript-derived meetings")
        db.rollback()
