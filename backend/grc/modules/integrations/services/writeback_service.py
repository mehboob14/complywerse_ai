"""GRC → scanner decision write-back (the outbound half of the closure loop).

When a finding is decided in ComplyVerse — false positive, risk accepted,
exception approved, remediated — that decision is pushed to the scanner where
its API can represent it, and recorded as skipped (with the adapter's reason)
where it can't. Local Nessus, for example, supports host-scopable plugin rules
for false-positives/exceptions but has no accept-risk or "mark remediated"
API — those actions land as ``skipped_unsupported`` rows, which is itself the
audit answer to "why doesn't the scanner show this decision?".

Mechanics:
  * Every decision becomes a :class:`ScannerWritebackAction` outbox row
    (idempotent — one live row per vulnerability+action).
  * Pushes are attempted best-effort at decision time and re-driven at the end
    of every sync (``process_pending``), the same self-healing discipline as
    enrichment. No Celery dependency.
  * Reversals (finding re-opened, FP undone, exception revoked) delete the
    scanner-side rule and mark the row ``reverted``. Reverts run even when
    write-back has since been disabled — removing our footprint is always
    allowed.
  * Gated per connection by ``provider_config['scanner_writeback']`` (default
    OFF — modifying a customer's scanner is opt-in) with the
    ``VULN_SCANNER_WRITEBACK`` env var as a global ops kill-switch.
"""

import logging
import os
from datetime import datetime
from typing import Any, Dict, Optional

from sqlalchemy.orm import Session

from grc.models import (
    IntegrationAuditLog,
    IntegrationConnection,
    ScannerWritebackAction,
    Vulnerability,
    VulnerabilityAssetLink,
)

logger = logging.getLogger(__name__)

# Actions the outbox understands. Kept in sync with
# BaseAdapter.writeback_capabilities() keys.
WRITEBACK_ACTIONS = ("false_positive", "risk_accepted", "exception", "remediated")

# A row in one of these states is "live" — enqueueing the same action again is
# a no-op instead of a duplicate.
_LIVE_STATUSES = ("pending", "pushed", "failed", "revert_pending")

_MAX_PUSH_ATTEMPTS = 5


def connection_writeback_enabled(connection: IntegrationConnection) -> bool:
    """Per-connection switch for scanner write-back. Default **OFF**.

    Pushing decisions modifies the customer's scanner configuration (plugin
    rules), which some tenants prohibit — so unlike auto-link this is opt-in:
    ``provider_config['scanner_writeback']`` must be explicitly truthy.
    ``VULN_SCANNER_WRITEBACK`` set to a falsey value is a global kill-switch
    that overrides every connection (ops escape hatch).
    """
    env = os.getenv("VULN_SCANNER_WRITEBACK")
    if env is not None and env.strip().lower() in ("0", "false", "no", "off"):
        return False
    cfg = getattr(connection, "provider_config", None) or {}
    return bool(cfg.get("scanner_writeback"))


class WritebackService:

    # ── enqueue ──────────────────────────────────────────────────────────────

    @staticmethod
    def enqueue(
        db: Session,
        vuln: Vulnerability,
        action: str,
        trigger: str,
        user_id: Optional[int] = None,
    ) -> Optional[ScannerWritebackAction]:
        """Record that a decision should reach the scanner. Idempotent; no-op
        for findings that didn't come from a scanner connection."""
        if action not in WRITEBACK_ACTIONS:
            raise ValueError(f"Unknown writeback action: {action}")
        connection_id = getattr(vuln, "connection_id", None)
        if not connection_id:
            return None

        row = db.query(ScannerWritebackAction).filter(
            ScannerWritebackAction.tenant_id == vuln.tenant_id,
            ScannerWritebackAction.vulnerability_id == vuln.id,
            ScannerWritebackAction.action == action,
            ScannerWritebackAction.status.in_(_LIVE_STATUSES),
        ).first()
        if row:
            return row

        row = ScannerWritebackAction(
            tenant_id=vuln.tenant_id,
            vulnerability_id=vuln.id,
            connection_id=connection_id,
            action=action,
            trigger=trigger,
            triggered_by_user_id=user_id,
            status="pending",
        )
        db.add(row)
        db.flush()
        return row

    @staticmethod
    def request_revert(
        db: Session,
        vuln: Vulnerability,
        action: str,
        trigger: str,
        user_id: Optional[int] = None,
    ) -> Optional[ScannerWritebackAction]:
        """The decision was reversed in GRC — undo its scanner-side footprint.

        A never-pushed row is simply marked reverted; a pushed row moves to
        ``revert_pending`` and the rule deletion is driven by
        :meth:`process_pending`."""
        row = db.query(ScannerWritebackAction).filter(
            ScannerWritebackAction.tenant_id == vuln.tenant_id,
            ScannerWritebackAction.vulnerability_id == vuln.id,
            ScannerWritebackAction.action == action,
            ScannerWritebackAction.status.in_(_LIVE_STATUSES),
        ).first()
        if not row:
            return None
        now = datetime.utcnow()
        if row.status in ("pending", "failed"):
            row.status = "reverted"
            row.reverted_at = now
            row.skip_reason = f"Decision reversed before push ({trigger})."
        else:  # pushed → needs scanner-side cleanup
            row.status = "revert_pending"
        row.trigger = trigger
        if user_id:
            row.triggered_by_user_id = user_id
        row.updated_at = now
        db.flush()
        return row

    # ── convenience hooks for the vuln lifecycle ────────────────────────────

    @staticmethod
    def on_status_change(
        db: Session,
        vuln: Vulnerability,
        previous_status: Optional[str],
        new_status: str,
        user_id: Optional[int] = None,
    ) -> None:
        """Translate a GRC status transition into outbox actions. Never raises."""
        try:
            status_action = {
                "false_positive": "false_positive",
                "accepted": "risk_accepted",
                "remediated": "remediated",
                "resolved": "remediated",
            }
            prev_action = status_action.get(previous_status or "")
            new_action = status_action.get(new_status)
            if prev_action and prev_action != new_action:
                WritebackService.request_revert(
                    db, vuln, prev_action, trigger="status_change", user_id=user_id,
                )
            if new_action:
                WritebackService.enqueue(
                    db, vuln, new_action, trigger="status_change", user_id=user_id,
                )
        except Exception:
            logger.exception("writeback on_status_change failed for vuln %s (non-fatal)", vuln.id)

    @staticmethod
    def on_exception_change(
        db: Session,
        vuln: Vulnerability,
        active: bool,
        user_id: Optional[int] = None,
    ) -> None:
        """Exception granted (active=True) or removed/revoked/expired (False)."""
        try:
            if active:
                WritebackService.enqueue(
                    db, vuln, "exception", trigger="exception_granted", user_id=user_id,
                )
            else:
                WritebackService.request_revert(
                    db, vuln, "exception", trigger="exception_removed", user_id=user_id,
                )
        except Exception:
            logger.exception("writeback on_exception_change failed for vuln %s (non-fatal)", vuln.id)

    @staticmethod
    def try_process_now(db: Session, vuln: Vulnerability) -> None:
        """Best-effort immediate push after a decision (the scanner is usually
        reachable and local). Any failure is swallowed — the end-of-sync retry
        picks the row up."""
        try:
            connection_id = getattr(vuln, "connection_id", None)
            if not connection_id:
                return
            connection = db.query(IntegrationConnection).filter(
                IntegrationConnection.id == connection_id,
                IntegrationConnection.tenant_id == vuln.tenant_id,
            ).first()
            if connection:
                WritebackService.process_pending(db, connection, vuln.tenant_id)
        except Exception:
            logger.exception("Immediate writeback push failed (non-fatal, retried at next sync)")

    # ── the driver ──────────────────────────────────────────────────────────

    @staticmethod
    def process_pending(
        db: Session,
        connection: IntegrationConnection,
        tenant_id: int,
        limit: int = 100,
    ) -> Dict[str, int]:
        """Drive every live outbox row for one connection to a terminal (or
        retriable) state. Called after each sync and best-effort at decision
        time. Commits its own progress."""
        counts = {"pushed": 0, "skipped": 0, "failed": 0, "reverted": 0}
        rows = db.query(ScannerWritebackAction).filter(
            ScannerWritebackAction.tenant_id == tenant_id,
            ScannerWritebackAction.connection_id == connection.id,
            ScannerWritebackAction.status.in_(("pending", "failed", "revert_pending")),
        ).order_by(ScannerWritebackAction.id.asc()).limit(limit).all()
        if not rows:
            return counts

        # Local import — SyncService imports this module's sibling namespace.
        from .sync_service import SyncService

        enabled = connection_writeback_enabled(connection)
        adapter = None
        capabilities: Dict[str, Dict[str, Any]] = {}

        def _get_adapter():
            nonlocal adapter, capabilities
            if adapter is None:
                adapter = SyncService.build_adapter(connection)
                try:
                    capabilities = adapter.writeback_capabilities()
                except Exception:
                    capabilities = {}
            return adapter

        now = datetime.utcnow()
        for row in rows:
            try:
                if row.status == "revert_pending":
                    # Reverts run even when write-back is disabled — we are
                    # removing a rule WE created.
                    WritebackService._process_revert(db, _get_adapter(), row, counts)
                    continue

                if not enabled:
                    row.status = "skipped_disabled"
                    row.skip_reason = (
                        "Scanner write-back is disabled for this connection "
                        "(provider_config.scanner_writeback). Decision recorded in ComplyVerse only."
                    )
                    row.updated_at = now
                    counts["skipped"] += 1
                    WritebackService._audit(db, row, "writeback_skipped")
                    continue

                if row.attempts >= _MAX_PUSH_ATTEMPTS:
                    continue  # stays visible as failed; ops can re-trigger by editing

                cap = (_get_adapter() and capabilities.get(row.action)) or {}
                if not cap.get("supported"):
                    row.status = "skipped_unsupported"
                    row.skip_reason = cap.get("reason") or (
                        "This scanner's API cannot represent this decision."
                    )
                    row.updated_at = now
                    counts["skipped"] += 1
                    WritebackService._audit(db, row, "writeback_skipped")
                    continue

                WritebackService._process_push(db, _get_adapter(), row, cap, counts)
            except Exception as e:
                logger.exception("Writeback row %s processing error", row.id)
                row.attempts = (row.attempts or 0) + 1
                row.last_attempt_at = now
                row.status = "failed"
                row.error = str(e)[:500]
                row.updated_at = now
                counts["failed"] += 1

        db.commit()
        return counts

    # ── internals ───────────────────────────────────────────────────────────

    @staticmethod
    def _process_push(
        db: Session,
        adapter,
        row: ScannerWritebackAction,
        cap: Dict[str, Any],
        counts: Dict[str, int],
    ) -> None:
        now = datetime.utcnow()
        row.attempts = (row.attempts or 0) + 1
        row.last_attempt_at = now

        vuln = db.query(Vulnerability).filter(Vulnerability.id == row.vulnerability_id).first()
        if not vuln:
            row.status = "reverted"
            row.reverted_at = now
            row.skip_reason = "Vulnerability no longer exists."
            row.updated_at = now
            return
        plugin_id = getattr(vuln, "external_vuln_id", None)
        if not plugin_id:
            row.status = "skipped_unsupported"
            row.skip_reason = "Finding has no scanner-native id (external_vuln_id) to reference."
            row.updated_at = now
            counts["skipped"] += 1
            WritebackService._audit(db, row, "writeback_skipped")
            return

        host = WritebackService._resolve_host_identity(db, vuln)
        payload: Dict[str, Any] = {
            "reason": row.action,
            "comment": f"ComplyVerse decision: {row.action} (vuln {vuln.vuln_id}, trigger: {row.trigger})",
            "scope": {"vulnerability": str(plugin_id)},
        }
        if host:
            payload["scope"]["host"] = host
        expiry = getattr(vuln, "exception_expires_at", None) or getattr(vuln, "exception_expiry", None)
        if row.action == "exception" and expiry:
            # Nessus plugin rules take an epoch expiry date.
            payload["expires"] = int(expiry.timestamp())

        result = adapter.create_exception(payload) or {}
        if result.get("status") == "created":
            row.status = "pushed"
            row.push_method = cap.get("method")
            row.external_rule_id = str(result.get("id", "")) or None
            row.pushed_at = now
            row.error = None
            row.updated_at = now
            counts["pushed"] += 1
            WritebackService._audit(db, row, "writeback_pushed", extra={
                "external_rule_id": row.external_rule_id,
                "host_scope": host or "global",
            })
        else:
            row.status = "failed"
            row.error = (result.get("message") or "Scanner did not accept the rule")[:500]
            row.updated_at = now
            counts["failed"] += 1

    @staticmethod
    def _process_revert(
        db: Session,
        adapter,
        row: ScannerWritebackAction,
        counts: Dict[str, int],
    ) -> None:
        now = datetime.utcnow()
        row.attempts = (row.attempts or 0) + 1
        row.last_attempt_at = now
        ok = True
        if row.external_rule_id:
            ok = bool(adapter.delete_exception(row.external_rule_id))
        if ok:
            row.status = "reverted"
            row.reverted_at = now
            row.error = None
            counts["reverted"] += 1
            WritebackService._audit(db, row, "writeback_reverted")
        else:
            row.error = "Scanner-side rule deletion failed; will retry."
        row.updated_at = now

    @staticmethod
    def _resolve_host_identity(db: Session, vuln: Vulnerability) -> str:
        """A concrete host (IP preferred, then hostname) for scoping a scanner
        rule. `affected_host` holds our stable hash id, not a network identity,
        so resolve through the linked asset; unresolvable → "" (global rule,
        matching the pre-existing exception-push behaviour, with the scope
        recorded in the audit trail)."""
        try:
            link = db.query(VulnerabilityAssetLink).filter(
                VulnerabilityAssetLink.vulnerability_id == vuln.id,
            ).first()
            asset = getattr(link, "asset", None) if link else None
            if asset is not None:
                return getattr(asset, "ip_address", None) or getattr(asset, "host_name", None) or ""
        except Exception:
            logger.exception("Host-identity resolution failed for vuln %s", vuln.id)
        return ""

    @staticmethod
    def _audit(db: Session, row: ScannerWritebackAction, action: str, extra: Optional[Dict] = None) -> None:
        try:
            details = {
                "vulnerability_id": row.vulnerability_id,
                "writeback_action": row.action,
                "trigger": row.trigger,
                "status": row.status,
                "skip_reason": row.skip_reason,
            }
            if extra:
                details.update(extra)
            db.add(IntegrationAuditLog(
                tenant_id=row.tenant_id,
                connection_id=row.connection_id,
                entity_type="writeback",
                entity_id=row.id,
                action=action,
                performed_by=(f"user:{row.triggered_by_user_id}" if row.triggered_by_user_id else "SYSTEM"),
                performed_by_user_id=row.triggered_by_user_id,
                metadata_info=details,
            ))
        except Exception:
            logger.exception("Failed to write writeback audit row (non-fatal)")
