"""Connector adapter base classes.

Each connector category exposes a slightly different shape — ticketing
pushes outbound and syncs status back, SIEM pulls events, transcription
pulls recordings + transcripts — but all share `test_connection()` and
a category-specific `run_sync()` operation.

Concrete adapters subclass the category-specific base and implement the
abstract methods. The router calls `test_connection()` on save and
`run_sync()` on the scheduled or on-demand sync.

Every adapter takes its credentials + config dict in `__init__` so the
router never has to know provider-specific shapes.
"""
from __future__ import annotations

import logging
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)


# ─── Shared dataclasses ─────────────────────────────────────────────

@dataclass
class ConnectionTestResult:
    """Returned by `test_connection()` on every adapter."""
    success: bool
    message: str
    server_version: Optional[str] = None
    details: Dict[str, Any] = field(default_factory=dict)


@dataclass
class SyncResult:
    """Returned by `run_sync()` on every adapter.

    The router persists this into `IntegrationConnection.last_sync_stats`
    and adds a `SyncHistory` row from it.
    """
    success: bool
    items_pushed: int = 0
    items_pulled: int = 0
    items_updated: int = 0
    items_closed: int = 0
    errors: List[str] = field(default_factory=list)
    details: Dict[str, Any] = field(default_factory=dict)


# ─── Base + category bases ──────────────────────────────────────────

class BaseConnectorAdapter(ABC):
    """Common parent of every connector category.

    Subclasses do NOT call this directly — they implement one of the
    category base classes below.
    """

    # Subclasses set these as class attributes so the registry can
    # describe them without instantiating.
    provider: str = ""
    category: str = ""

    def __init__(
        self,
        *,
        console_url: Optional[str],
        credentials: Dict[str, Any],
        config: Optional[Dict[str, Any]] = None,
        oauth_tokens: Optional[Dict[str, Any]] = None,
        verify_ssl: bool = True,
    ):
        self.console_url = (console_url or "").rstrip("/")
        self.credentials = credentials or {}
        self.config = config or {}
        self.oauth_tokens = oauth_tokens or {}
        self.verify_ssl = verify_ssl

    @abstractmethod
    def test_connection(self) -> ConnectionTestResult:
        """Verify credentials work against the live API. Must be cheap —
        the admin save flow blocks on it.
        """

    # `run_sync()` is intentionally NOT abstract here — each category
    # base class declares its own signature.


# ─── Ticketing (ServiceNow / BMC) ───────────────────────────────────

@dataclass
class TicketRequest:
    """Vuln or exception data being pushed to a ticketing system."""
    kind: str  # "vulnerability" | "exception"
    summary: str
    description: str
    severity: str  # critical | high | medium | low
    external_id: str  # vuln/exception PK in our DB
    assignment_group: Optional[str] = None
    extra_fields: Dict[str, Any] = field(default_factory=dict)


@dataclass
class TicketStatus:
    """Reply from the ticketing system describing one ticket's state."""
    external_id: str   # ticket id in the remote system (e.g. INC0010234)
    status: str        # raw status in their system
    normalised_status: str  # one of: new, in_progress, on_hold, resolved, closed, cancelled
    last_updated_at: Optional[datetime] = None
    resolved_at: Optional[datetime] = None
    resolution_note: Optional[str] = None
    extra: Dict[str, Any] = field(default_factory=dict)


class TicketingAdapter(BaseConnectorAdapter):
    """Outbound ticket push + bidirectional status sync."""
    category = "ticketing"

    @abstractmethod
    def create_ticket(self, request: TicketRequest) -> str:
        """Create a ticket. Return the ticket's external id."""

    @abstractmethod
    def update_ticket(self, external_id: str, fields: Dict[str, Any]) -> bool:
        """Update an existing ticket. Return True on success."""

    @abstractmethod
    def close_ticket(self, external_id: str, resolution_note: str) -> bool:
        """Close / resolve a ticket."""

    @abstractmethod
    def fetch_statuses(self, external_ids: List[str]) -> List[TicketStatus]:
        """Pull current status for a batch of tickets the platform has
        already pushed. Used by the inbound-sync side of the ticketing
        flow so resolutions in ServiceNow propagate back to GRC."""

    def run_sync(self, *, requests: List[TicketRequest], known_ids: List[str]) -> SyncResult:
        """Default orchestration: push new `requests`, fetch statuses for
        `known_ids`. Concrete adapters can override for richer flows.
        """
        result = SyncResult(success=True)
        for req in requests:
            try:
                ext_id = self.create_ticket(req)
                result.items_pushed += 1
                result.details.setdefault("created", []).append(
                    {"external_id": ext_id, "kind": req.kind, "ours": req.external_id}
                )
            except Exception as exc:
                logger.exception("create_ticket failed")
                result.errors.append(f"create_ticket: {exc}")
        if known_ids:
            try:
                statuses = self.fetch_statuses(known_ids)
                result.items_updated += len(statuses)
                result.details["statuses"] = [
                    {
                        "external_id": s.external_id,
                        "status": s.normalised_status,
                        "raw_status": s.status,
                    }
                    for s in statuses
                ]
            except Exception as exc:
                logger.exception("fetch_statuses failed")
                result.errors.append(f"fetch_statuses: {exc}")
        result.success = not result.errors
        return result


# ─── SIEM (Splunk / Wazuh / QRadar) ─────────────────────────────────

@dataclass
class SecurityEvent:
    """Normalised event pulled from a SIEM."""
    source_event_id: str
    timestamp: datetime
    severity: str  # critical | high | medium | low | info
    rule_name: str
    cve_ids: List[str] = field(default_factory=list)
    affected_host: Optional[str] = None
    affected_ip: Optional[str] = None
    message: Optional[str] = None
    raw: Dict[str, Any] = field(default_factory=dict)


class SiemAdapter(BaseConnectorAdapter):
    """Inbound: pull active-exploit / alert events from a SIEM."""
    category = "siem"

    @abstractmethod
    def fetch_events(
        self,
        *,
        since: Optional[datetime] = None,
        limit: int = 500,
    ) -> List[SecurityEvent]:
        """Pull events newer than `since`. Adapter is responsible for
        translating its query language (SPL, KQL, AQL) into the right
        request.
        """

    def run_sync(self, *, since: Optional[datetime] = None) -> SyncResult:
        result = SyncResult(success=True)
        try:
            events = self.fetch_events(since=since)
            result.items_pulled = len(events)
            result.details["events"] = [
                {
                    "id": e.source_event_id,
                    "severity": e.severity,
                    "cves": e.cve_ids,
                    "host": e.affected_host,
                    "rule": e.rule_name,
                }
                for e in events
            ]
        except Exception as exc:
            logger.exception("SIEM fetch_events failed")
            result.success = False
            result.errors.append(str(exc))
        return result


# ─── Pen-test (Metasploit / Core Impact) ────────────────────────────

@dataclass
class ExploitConfirmation:
    """A confirmed successful exploit attempt on a host."""
    source_id: str
    timestamp: datetime
    cve_ids: List[str]
    target_host: Optional[str] = None
    target_ip: Optional[str] = None
    exploit_name: Optional[str] = None
    payload: Optional[str] = None
    raw: Dict[str, Any] = field(default_factory=dict)


class PenTestAdapter(BaseConnectorAdapter):
    """Inbound: pull successful exploit records to boost vuln priority."""
    category = "pentest"

    @abstractmethod
    def fetch_exploits(
        self,
        *,
        since: Optional[datetime] = None,
        limit: int = 500,
    ) -> List[ExploitConfirmation]:
        """Pull exploit confirmations newer than `since`."""

    def run_sync(self, *, since: Optional[datetime] = None) -> SyncResult:
        result = SyncResult(success=True)
        try:
            confirms = self.fetch_exploits(since=since)
            result.items_pulled = len(confirms)
            result.details["exploits"] = [
                {
                    "id": c.source_id,
                    "host": c.target_host,
                    "cves": c.cve_ids,
                    "exploit": c.exploit_name,
                }
                for c in confirms
            ]
        except Exception as exc:
            logger.exception("PenTest fetch_exploits failed")
            result.success = False
            result.errors.append(str(exc))
        return result


# ─── Collaboration (MS Teams / Zoom / Office 365) ───────────────────

@dataclass
class CollabMessage:
    """Outbound notification."""
    title: str
    body_markdown: str
    severity: str = "info"  # info | warning | critical
    link_url: Optional[str] = None
    extra: Dict[str, Any] = field(default_factory=dict)


@dataclass
class MeetingRequest:
    """Request to schedule a committee meeting on the collab platform."""
    subject: str
    body: str
    start_at: datetime
    duration_minutes: int = 60
    attendee_emails: List[str] = field(default_factory=list)


class CollabAdapter(BaseConnectorAdapter):
    """Outbound: send alerts, schedule meetings, optionally fetch recordings."""
    category = "collab"

    @abstractmethod
    def send_message(self, channel_id: str, message: CollabMessage) -> str:
        """Post a notification. Return the message id on success."""

    @abstractmethod
    def schedule_meeting(self, request: MeetingRequest) -> Dict[str, Any]:
        """Schedule a meeting. Return `{join_url, meeting_id, ...}`."""

    @abstractmethod
    def list_recent_recordings(self, since: Optional[datetime] = None) -> List[Dict[str, Any]]:
        """List recordings available for transcription pickup. Each entry:
        `{recording_id, subject, started_at, ended_at, download_url}`.
        """

    def run_sync(self) -> SyncResult:
        """Collab adapters don't have a periodic sync per se — the router
        calls send_message / schedule_meeting on demand. The "sync" is a
        light health probe."""
        result = SyncResult(success=True)
        try:
            probe = self.test_connection()
            result.success = probe.success
            if not probe.success:
                result.errors.append(probe.message)
            result.details["probe"] = probe.details
        except Exception as exc:
            result.success = False
            result.errors.append(str(exc))
        return result


# ─── Transcription (Fireflies.ai) ───────────────────────────────────

@dataclass
class MeetingTranscript:
    """A meeting transcript pulled from a transcription provider."""
    source_id: str
    title: str
    started_at: datetime
    ended_at: Optional[datetime]
    duration_minutes: Optional[int]
    attendees: List[str]
    transcript_markdown: str
    summary: Optional[str] = None
    action_items: List[str] = field(default_factory=list)
    raw: Dict[str, Any] = field(default_factory=dict)


class TranscribeAdapter(BaseConnectorAdapter):
    """Pull meeting transcripts → CommitteeMeetingMinutes."""
    category = "transcribe"

    @abstractmethod
    def fetch_transcripts(
        self,
        *,
        since: Optional[datetime] = None,
        limit: int = 50,
    ) -> List[MeetingTranscript]:
        """Pull new transcripts available since `since`."""

    def run_sync(self, *, since: Optional[datetime] = None) -> SyncResult:
        result = SyncResult(success=True)
        try:
            transcripts = self.fetch_transcripts(since=since)
            result.items_pulled = len(transcripts)
            result.details["transcripts"] = [
                {
                    "id": t.source_id,
                    "title": t.title,
                    "started_at": t.started_at.isoformat() if t.started_at else None,
                    "duration": t.duration_minutes,
                }
                for t in transcripts
            ]
        except Exception as exc:
            logger.exception("Transcribe fetch_transcripts failed")
            result.success = False
            result.errors.append(str(exc))
        return result


# ─── EASM passive source (Shodan / Censys / SecurityTrails) ─────────

class EasmSourceAdapter(BaseConnectorAdapter):
    """Keyed passive attack-surface source. Pull-only: the asset-discovery
    external collector reads these providers directly with the stored API key
    (see asset_discovery/services/external_collect.py). There is no push side
    and no periodic connector sync — the connector row exists purely to hold
    and health-check the credential, so `run_sync` is just the health probe,
    mirroring CollabAdapter."""
    category = "easm_source"

    @abstractmethod
    def test_connection(self) -> ConnectionTestResult:
        """Verify the API key against the provider's health endpoint."""

    def run_sync(self) -> SyncResult:
        result = SyncResult(success=True)
        try:
            probe = self.test_connection()
            result.success = probe.success
            if not probe.success:
                result.errors.append(probe.message)
            result.details["probe"] = probe.details
        except Exception as exc:
            result.success = False
            result.errors.append(str(exc))
        return result
