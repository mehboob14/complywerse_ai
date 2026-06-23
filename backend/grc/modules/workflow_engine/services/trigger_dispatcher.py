from datetime import datetime
import logging
import os
from typing import Any, Dict, List, Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from ....models import AuditLog, WorkflowDefinition
from .condition_evaluator import ConditionEvaluator


logger = logging.getLogger(__name__)


def _env_bool(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


# ---------------------------------------------------------------------------
# Event name mapping: (resource_type, action) → [workflow trigger names]
# ---------------------------------------------------------------------------

_EVENT_MAP: Dict[str, Dict[str, List[str]]] = {
    "incidents": {
        "create": ["incident_reported", "incidents.create", "erm.incident_reported"],
        "update": ["incidents.update"],
    },
    "risks": {
        "create": ["risk_created", "risks.create", "risks.created"],
        "update": ["risk_updated", "risk_score_exceeds_threshold", "risk_status_changed", "risks.update",
                   "risks.status_changed", "risks.score_threshold_exceeded"],
        "delete": ["risk_deleted", "risks.delete"],
    },
    "evidence": {
        "create": ["evidence_uploaded", "evidence.create", "evidence.uploaded"],
        "update": ["evidence_approved", "evidence_expires", "evidence.update",
                   "evidence.approved", "evidence.expires"],
        "delete": ["evidence.delete"],
    },
    "vulnerabilities": {
        "create": ["vulnerability_created", "new_vulnerability_detected", "vulnerabilities.create", "vulnerabilities.detected"],
        "update": ["vulnerability_updated", "vulnerability_sla_breach", "vulnerability_sla_warning", "vulnerabilities.update",
                   "vulnerabilities.sla_breach", "vulnerabilities.sla_warning"],
        "delete": ["vulnerability_deleted", "vulnerabilities.delete"],
    },
    "kri": {
        "create": ["kri_breach", "kri.create", "erm.kri_breach"],
        "update": ["kri_breach", "kri.update", "erm.kri_breach"],
    },
    "policies": {
        "create": ["policies.create"],
        "update": ["policy_approved", "policies.update", "governance.policy_approved"],
        "submit_for_review": ["policy_submitted_for_review"],
    },
    "governance": {
        "create": ["governance.create"],
        "update": ["assessment_status_change", "control_review_due", "attestation_overdue",
                   "governance.update", "compliance.assessment_status_change",
                   "governance.control_review_due", "governance.attestation_overdue"],
    },
    "compliance": {
        "create": ["compliance.create", "compliance_gap_detected", "compliance.gap_detected"],
        "update": ["assessment_status_change", "compliance.update",
                   "compliance.assessment_status_change", "compliance_gap_detected",
                   "compliance.certification_expiry_approaching"],
    },
    "assets": {
        "create": ["asset_created", "assets.create"],
        "update": ["asset_updated", "assets.update"],
        "delete": ["asset_deleted", "assets.delete"],
    },
    # ── Audit (Auditor Portal) ───────────────────────────────────────────
    # `resource_type='audits'` comes from the audit_logger alias
    # `auditor-portal → audits`.  The portal's only writes are review
    # submission (POST /auditor-portal/reviews → action=create) and control
    # auto-approval (POST .../controls/{id}/auto-approve → action=auto_approve,
    # the hyphenated trailing segment is parsed as a sub-action verb).
    "audits": {
        "create": ["audit_review_submitted", "audits.create"],
        "auto_approve": ["audit_control_approved", "audits.auto_approve"],
    },
    # ── Issue Management ─────────────────────────────────────────────────
    # `resource_type='issues'` comes from the audit_logger's
    # _MODULE_SUB_ENTITY_PREFIXES extraction on /issue-management/issues/...
    # paths.  Severity / state semantics are split out in the special-case
    # block below this map (same pattern governance uses for policy
    # submissions vs generic updates).
    "issues": {
        "create": ["issue_created", "issue-management.issues.create"],
        "update": ["issue_severity_changed", "issue_state_changed",
                   "issue-management.issues.update"],
        "delete": ["issue-management.issues.delete"],
    },
    # ── CIS Compliance Plugins ───────────────────────────────────────────
    # plugin-run rows: created when a scan starts; the per-run check pass/
    # fail status comes through as an update.  cis_scan_completed is the
    # coarser-grained event fired from the scan-all endpoint's audit row.
    "runs": {
        "create": ["compliance-plugins.runs.create"],
        "update": ["cis_check_failed", "compliance-plugins.runs.update"],
    },
    "scan-all": {
        "create": ["cis_scan_completed", "compliance-plugins.scan-all"],
    },
    # ── Compliance Agents ────────────────────────────────────────────────
    # `agent_enrolled` fires on the enroll endpoint write.  The offline
    # event is dispatched from the periodic heartbeat-staleness check (not
    # audit-log driven); see _periodic_threshold_checks below.
    "enroll": {
        "create": ["agent_enrolled", "agents.enroll"],
    },
    # ── Connect Wizard ───────────────────────────────────────────────────
    # handshake POST = a new IntegrationConnection got persisted.
    "handshake": {
        "create": ["connection_handshake_completed", "connect-wizard.handshake"],
    },
}

# Module path aliases → normalised resource type
_MODULE_ALIASES: Dict[str, str] = {
    "erm": "risks",
    "evidence-mgmt": "evidence",
    "vuln-management": "vulnerabilities",
    "framework-upload": "frameworks",
    "compliance": "compliance",
    "governance": "governance",
    "audit-management": "audits",
    "control-library": "controls",
}


# ────────────────────────────────────────────────────────────────────────
# v6 canonical resource map (Workflow/Audit-AI integration)
# Maps a (URL module, URL entity) pair from the FastAPI audit-log path to
# the v6 Pattern-B catalog's (canonical_module, canonical_entity). Without
# this, real CRUD audit logs only fire the legacy `risk_created`-style
# workflows and the v6 Pattern-B workflows can never match (they use names
# like `risk.risk_register.create`). The "*" wildcard catches sub-paths
# whose second segment is a numeric ID (e.g. /grc/evidence/4).
# ────────────────────────────────────────────────────────────────────────
_CANONICAL_RESOURCE_MAP: Dict[tuple, tuple] = {
    # /erm/* -> risk.<canonical_entity>
    ("erm", "risks"):                ("risk", "risk_register"),
    ("erm", "kris"):                 ("risk", "kris"),
    ("erm", "internal-controls"):    ("risk", "internal_controls"),
    ("erm", "internal_controls"):    ("risk", "internal_controls"),
    ("erm", "mitigation-actions"):   ("risk", "mitigation_actions"),
    ("erm", "mitigation_actions"):   ("risk", "mitigation_actions"),
    ("erm", "incidents"):            ("risk", "incidents"),
    ("erm", "rcsa"):                 ("risk", "rcsa"),
    ("erm", "reviews"):              ("risk", "reviews"),
    ("erm", "risk-assessments"):     ("risk", "risk_assessments"),
    ("erm", "risk_assessments"):     ("risk", "risk_assessments"),
    ("erm", "risk-framework"):       ("risk", "risk_framework"),
    ("erm", "risk_framework"):       ("risk", "risk_framework"),
    ("erm", "vendor-risk"):          ("risk", "vendor_risk"),
    ("erm", "vendor_risk"):          ("risk", "vendor_risk"),
    # Top-level vendor-risk shortcut routes used by some frontend pages
    ("vendor-risk", "*"):            ("risk", "vendor_risk"),
    ("vendor_risk", "*"):            ("risk", "vendor_risk"),
    # Compliance
    ("frameworks", "*"):                       ("compliance", "frameworks"),
    ("controls", "*"):                         ("compliance", "controls"),
    ("evidence", "*"):                         ("compliance", "evidence"),
    # Evidence Management module — the actual UI where users upload/delete
    # evidence (DELETE /grc/evidence-mgmt/items/{id}). Canonicalise it to the
    # same (compliance, evidence) event the "Delete/Upload Evidence" palette
    # nodes infer, so a workflow built on those nodes fires on real evidence
    # operations regardless of which evidence surface they came from.
    ("evidence-mgmt", "items"):                ("compliance", "evidence"),
    ("evidence-mgmt", "*"):                    ("compliance", "evidence"),
    ("evidence_mgmt", "items"):                ("compliance", "evidence"),
    ("evidence_mgmt", "*"):                    ("compliance", "evidence"),
    ("evidence-requirements", "*"):            ("compliance", "evidence_requirements"),
    ("evidence_requirements", "*"):            ("compliance", "evidence_requirements"),
    ("control-library", "*"):                  ("compliance", "control_library"),
    ("control_library", "*"):                  ("compliance", "control_library"),
    ("compliance", "statements"):              ("compliance", "statements"),
    ("compliance", "assessments"):             ("compliance", "assessments"),
    ("compliance", "frameworks"):              ("compliance", "frameworks"),
    ("compliance", "controls"):                ("compliance", "controls"),
    ("compliance", "evidence"):                ("compliance", "evidence"),
    ("compliance", "control-library"):         ("compliance", "control_library"),
    ("compliance", "control_library"):         ("compliance", "control_library"),
    # Governance
    ("governance", "documents"):               ("governance", "documents"),
    ("governance", "attestations"):            ("governance", "attestations"),
    # The UI POSTs attestation campaign creates to
    # /grc/governance/attestation-campaigns/campaigns — the canonical entity
    # in the v6 catalog is still "attestations", so alias it.
    ("governance", "attestation-campaigns"):   ("governance", "attestations"),
    ("governance", "attestation_campaigns"):   ("governance", "attestations"),
    ("governance", "committees"):              ("governance", "committees"),
    ("governance", "regulatory-changes"):      ("governance", "regulatory_changes"),
    ("governance", "regulatory_changes"):      ("governance", "regulatory_changes"),
    ("governance", "regulatory-feeds"):        ("governance", "regulatory_feeds"),
    ("governance", "regulatory_feeds"):        ("governance", "regulatory_feeds"),
    ("governance", "clause-coverage"):         ("governance", "clause_coverage"),
    ("governance", "clause_coverage"):         ("governance", "clause_coverage"),
    ("governance", "patch-proposals"):         ("governance", "patch_proposals"),
    ("governance", "patch_proposals"):         ("governance", "patch_proposals"),
    ("governance", "critical-rules"):          ("governance", "critical_rules"),
    ("governance", "critical_rules"):          ("governance", "critical_rules"),
    # Vulnerability management
    ("vulnerabilities", "departments"):        ("vulnmgmt", "departments"),
    ("vulnerabilities", "reports"):            ("vulnmgmt", "reports"),
    ("vulnerabilities", "sla"):                ("vulnmgmt", "sla_config"),
    ("vulnerabilities", "sla-config"):         ("vulnmgmt", "sla_config"),
    ("vulnerabilities", "sla_config"):         ("vulnmgmt", "sla_config"),
    ("vulnerabilities", "*"):                  ("vulnmgmt", "vulnerabilities"),
}


def _resolve_canonical_resource(module: str, entity: str) -> tuple:
    """Return (canonical_module, canonical_entity) for a (URL module, URL entity).

    Falls back to (None, None) when no mapping applies — callers should then
    use the legacy behaviour. The '*' wildcard entity matches whenever there's
    no more-specific (module, entity) mapping — including the common case
    where the second path segment is a numeric ID (e.g. /grc/evidence/4).
    """
    if (module, entity) in _CANONICAL_RESOURCE_MAP:
        return _CANONICAL_RESOURCE_MAP[(module, entity)]
    if (module, "*") in _CANONICAL_RESOURCE_MAP:
        return _CANONICAL_RESOURCE_MAP[(module, "*")]
    return (None, None)


# ── Tenant session helpers (per-tenant DB architecture) ──────────────────────
# Workflow tables (definitions, instances, steps, schedules, approvals) AND the
# audit log all live in each tenant's own ``grc_<slug>`` database, not the
# master catalog. The embedded runtime therefore has to open a session against
# the right tenant DB for every poll / timer / queued-item it processes.

def iter_tenant_sessions():
    """Yield ``(tenant_id, slug, session)`` for every active tenant.

    One short-lived session is opened per tenant and closed automatically
    after the consumer's iteration step. Quiet on errors (e.g. a tenant DB
    being unreachable must not kill the whole pass).
    """
    from grc.models import Tenant, SessionLocal as _MasterSession
    from grc.db import open_tenant_session
    master = _MasterSession()
    try:
        tenants = master.query(Tenant).filter(Tenant.is_active.is_(True)).all() \
            if hasattr(Tenant, "is_active") else master.query(Tenant).all()
    finally:
        master.close()
    for t in tenants:
        slug = getattr(t, "slug", None) or getattr(t, "schema_name", None)
        if not slug:
            continue
        try:
            sess = open_tenant_session(slug)
        except Exception:  # noqa: BLE001
            logger.warning("workflow.tenant_session: could not open for tenant=%s", slug)
            continue
        try:
            yield t.id, slug, sess
        finally:
            try:
                sess.close()
            except Exception:  # noqa: BLE001
                pass


def open_tenant_session_for_id(tenant_id):
    """Open a session for a single tenant by id. Caller MUST close it.
    Returns None if the tenant / slug can't be resolved or the DB is down."""
    if tenant_id is None:
        return None
    from grc.models import Tenant, SessionLocal as _MasterSession
    from grc.db import open_tenant_session
    master = _MasterSession()
    try:
        t = master.query(Tenant).filter(Tenant.id == tenant_id).first()
        slug = (getattr(t, "slug", None) or getattr(t, "schema_name", None)) if t else None
    finally:
        master.close()
    if not slug:
        return None
    try:
        return open_tenant_session(slug)
    except Exception:  # noqa: BLE001
        logger.warning("workflow.tenant_session: could not open for tenant_id=%s", tenant_id)
        return None


class TriggerDispatcher:
    def __init__(self, event_queue):
        self.event_queue = event_queue
        self.last_audit_log_id = 0
        self._bootstrap_complete = False
        # Default behavior is real-time dispatch only; no historical replay flood on process restart.
        self.replay_historical_audits = _env_bool("WORKFLOW_DISPATCH_REPLAY_AUDIT_LOGS", False)
        # Read events are typically high-volume and low-signal for workflow automation.
        self.include_read_events = _env_bool("WORKFLOW_DISPATCH_INCLUDE_READ_EVENTS", False)

        # ── Periodic-threshold checks (issue_sla_breached, agent_offline,
        # cis_pass_rate_dropped) ──────────────────────────────────────────
        # These can't come off the audit log because nothing WRITES when a
        # deadline silently passes.  Tracked separately and run inside the
        # runtime loop at a coarser cadence (default 60 s) so the per-tenant
        # query cost doesn't multiply across the 500ms audit-log poll.
        self._last_threshold_check_at = 0.0
        # Edge-trigger memory so we don't re-fire identical alerts every
        # cycle.  Keys are tenant_id; values are sets of resource ids that
        # have already been alerted at their current state.  Cleared when
        # the resource transitions back (agent heartbeats again, issue
        # gets closed, pass-rate recovers).
        self._alerted_offline_agents: Dict[int, set] = {}
        self._alerted_sla_breached_issues: Dict[int, set] = {}
        self._alerted_pass_rate_drop_tenants: set = set()

    def poll_platform_events(self, db: Session) -> int:
        """Poll every active tenant's audit log for new platform events.

        Audit rows (``grc_audit_logs``) live in the per-tenant ``grc_<slug>``
        databases, NOT in the master catalog — so we iterate one session per
        tenant (same pattern as the threshold checks). The ``db`` argument
        (the master session passed by the runtime loop) is intentionally not
        used for the audit query; querying it would raise UndefinedTable.

        A per-tenant high-water mark ensures each tenant only processes rows
        newer than the last one it saw.
        """
        total = 0
        for tenant_id, _slug, sess in self._iter_tenant_sessions():
            try:
                total += self.poll_tenant_audit_events(tenant_id, sess)
            except Exception:  # noqa: BLE001 — one tenant must not kill the cycle
                logger.exception(
                    "workflow.dispatcher.tenant_poll_failed tenant_id=%s", tenant_id
                )
        return total

    def poll_tenant_audit_events(self, tenant_id: int, sess: Session) -> int:
        """Process new audit rows for a single tenant DB session."""
        if not hasattr(self, "_last_audit_id_by_tenant"):
            self._last_audit_id_by_tenant: Dict[int, int] = {}

        # Per-tenant tail bootstrap: on first sight of a tenant, skip the
        # historical backlog unless replay_historical_audits is set.
        watermark = self._last_audit_id_by_tenant.get(tenant_id)
        if watermark is None:
            if self.replay_historical_audits:
                watermark = 0
            else:
                latest_id = sess.query(func.max(AuditLog.id)).scalar() or 0
                watermark = int(latest_id)
                logger.info(
                    "workflow.dispatcher.bootstrap tenant_id=%s mode=tail latest_audit_log_id=%s",
                    tenant_id, watermark,
                )
            self._last_audit_id_by_tenant[tenant_id] = watermark

        logs = (
            sess.query(AuditLog)
            .filter(AuditLog.id > watermark)
            .order_by(AuditLog.id.asc())
            .limit(200)
            .all()
        )

        processed = 0
        skipped_read_logs = 0
        for log in logs:
            watermark = max(watermark, log.id)
            self._last_audit_id_by_tenant[tenant_id] = watermark

            # Loop-prevention guard: skip audit rows the workflow engine itself
            # wrote (tagged actor_source="workflow" inside changes by
            # rich_audit) so a workflow's own audit emissions can never trigger
            # another workflow run. NULL / non-"workflow" sources (user,
            # integration, cron, system) all still fire workflows as before.
            _chg = log.changes if isinstance(log.changes, dict) else {}
            if (_chg.get("actor_source") or "") == "workflow":
                continue

            if (log.action or "").strip().lower() == "read" and not self.include_read_events:
                skipped_read_logs += 1
                continue

            event_names = self._derive_event_names(log)
            enriched_payload = self._build_payload(log)
            # In a per-tenant DB the row's own tenant_id may be unset; fall
            # back to the tenant we're iterating so events route correctly.
            ev_tenant = getattr(log, "tenant_id", None) or tenant_id

            for event_name in event_names:
                self.publish_event(
                    event_name=event_name,
                    tenant_id=ev_tenant,
                    payload=enriched_payload,
                    # Audit ids are per-tenant sequences — namespace by tenant
                    # so correlation ids never collide across tenants.
                    correlation_id=f"audit:{tenant_id}:{log.id}",
                )
            processed += 1

        if processed or skipped_read_logs:
            logger.info(
                "workflow.dispatcher.poll_cycle tenant_id=%s processed_logs=%s skipped_read_logs=%s",
                tenant_id, processed, skipped_read_logs,
            )

        return processed

    # ── Periodic threshold checks ────────────────────────────────────────
    # Called from the runtime loop. Self-throttles to once per
    # WORKFLOW_THRESHOLD_CHECK_INTERVAL seconds (default 60). Each check
    # is wrapped in try/except so one tenant's bad data can't kill the
    # whole pass.
    def poll_threshold_events(self) -> int:
        import time as _time
        interval = float(__import__("os").environ.get("WORKFLOW_THRESHOLD_CHECK_INTERVAL", "60"))
        now = _time.time()
        if (now - self._last_threshold_check_at) < interval:
            return 0
        self._last_threshold_check_at = now

        fired = 0
        try:
            fired += self._check_issue_sla_breached()
        except Exception:  # noqa: BLE001
            logger.exception("threshold-check: issue_sla_breached failed")
        try:
            fired += self._check_agent_offline()
        except Exception:  # noqa: BLE001
            logger.exception("threshold-check: agent_offline failed")
        try:
            fired += self._check_cis_pass_rate_dropped()
        except Exception:  # noqa: BLE001
            logger.exception("threshold-check: cis_pass_rate_dropped failed")
        if fired:
            logger.info("workflow.dispatcher.threshold_cycle fired_events=%s", fired)
        return fired

    def _iter_tenant_sessions(self):
        """Yield (tenant_id, slug, session) for every active tenant.

        Thin instance wrapper around the module-level :func:`iter_tenant_sessions`
        so existing call-sites keep working.
        """
        yield from iter_tenant_sessions()

    def _check_issue_sla_breached(self) -> int:
        """Fire ``issue_sla_breached`` for any Issue whose
        target_closure_date is in the past and that's not already in a
        terminal state. Edge-trigger via ``_alerted_sla_breached_issues``
        so the workflow doesn't refire every 60 s for the same issue."""
        from datetime import datetime
        from grc.models import Issue
        fired = 0
        now = datetime.utcnow()
        for tenant_id, _slug, sess in self._iter_tenant_sessions():
            try:
                breached = sess.query(Issue).filter(
                    Issue.target_closure_date.isnot(None),
                    Issue.target_closure_date < now,
                    Issue.status.notin_(("closed", "cancelled")),
                ).all()
            except Exception:  # noqa: BLE001
                continue
            seen = self._alerted_sla_breached_issues.setdefault(tenant_id, set())
            current_ids = {i.id for i in breached}
            # New breaches → fire event + add to memo
            for issue in breached:
                if issue.id in seen:
                    continue
                seen.add(issue.id)
                fired += 1
                self.publish_event(
                    event_name="issue_sla_breached",
                    tenant_id=tenant_id,
                    payload={
                        "resource_type": "issues",
                        "resource_id": issue.id,
                        "severity": issue.severity,
                        "status": issue.status,
                        "title": issue.title,
                        "target_closure_date": issue.target_closure_date.isoformat() if issue.target_closure_date else None,
                        "owner_id": issue.owner_id,
                    },
                    correlation_id=f"sla_breach:issue:{issue.id}",
                )
            # Recovered (closed / cancelled) issues drop out of memo
            self._alerted_sla_breached_issues[tenant_id] = current_ids & seen
        return fired

    def _check_agent_offline(self) -> int:
        """Fire ``agent_offline`` for active ComplianceAgent rows whose
        ``last_heartbeat_at`` is older than the configured threshold
        (default 5 min). Edge-trigger so we alert once per offline
        episode, not every cycle."""
        from datetime import datetime, timedelta
        from grc.models import ComplianceAgent
        threshold_min = int(__import__("os").environ.get("WORKFLOW_AGENT_OFFLINE_AFTER_MIN", "5"))
        cutoff = datetime.utcnow() - timedelta(minutes=threshold_min)
        fired = 0
        for tenant_id, _slug, sess in self._iter_tenant_sessions():
            try:
                offline = sess.query(ComplianceAgent).filter(
                    ComplianceAgent.status == "active",
                    ComplianceAgent.last_heartbeat_at.isnot(None),
                    ComplianceAgent.last_heartbeat_at < cutoff,
                ).all()
            except Exception:  # noqa: BLE001
                continue
            seen = self._alerted_offline_agents.setdefault(tenant_id, set())
            current_ids = {a.id for a in offline}
            for agent in offline:
                if agent.id in seen:
                    continue
                seen.add(agent.id)
                fired += 1
                self.publish_event(
                    event_name="agent_offline",
                    tenant_id=tenant_id,
                    payload={
                        "resource_type": "agents",
                        "resource_id": agent.id,
                        "agent_name": agent.agent_name,
                        "hostname": agent.hostname,
                        "os_family": agent.os_family,
                        "last_heartbeat_at": agent.last_heartbeat_at.isoformat() if agent.last_heartbeat_at else None,
                        "threshold_min": threshold_min,
                    },
                    correlation_id=f"offline:agent:{agent.id}",
                )
            # Agents that have come back online (no longer in offline set)
            # drop out so they can re-alert next time they stall.
            self._alerted_offline_agents[tenant_id] = current_ids & seen
        return fired

    def _check_cis_pass_rate_dropped(self) -> int:
        """Fire ``cis_pass_rate_dropped`` when a tenant's overall CIS
        pass rate (latest-run-per-plugin) falls below the configured
        threshold (default 70%). Edge-trigger per tenant."""
        from grc.models import CompliancePluginRun
        from sqlalchemy import func as _f
        threshold_pct = float(__import__("os").environ.get("WORKFLOW_CIS_PASS_RATE_THRESHOLD", "70"))
        fired = 0
        for tenant_id, _slug, sess in self._iter_tenant_sessions():
            try:
                # Cheap aggregate — count by status. is_leaked filter is on
                # the post-CIS-merge column (see CIS_INTEGRATION_STATUS.md).
                rows = (
                    sess.query(CompliancePluginRun.status, _f.count(CompliancePluginRun.id))
                    .filter(
                        CompliancePluginRun.tenant_id == tenant_id,
                        CompliancePluginRun.is_leaked.is_(False),
                    )
                    .group_by(CompliancePluginRun.status)
                    .all()
                )
            except Exception:  # noqa: BLE001
                continue
            counts = {st: int(c) for st, c in rows}
            passed = counts.get("passed", 0) + counts.get("pass", 0)
            failed = counts.get("failed", 0) + counts.get("fail", 0)
            evaluated = passed + failed
            if evaluated < 20:  # not enough signal — skip
                continue
            pass_pct = (passed / evaluated) * 100.0
            tenant_key = tenant_id
            if pass_pct < threshold_pct:
                if tenant_key in self._alerted_pass_rate_drop_tenants:
                    continue  # already alerted; wait for recovery
                self._alerted_pass_rate_drop_tenants.add(tenant_key)
                fired += 1
                self.publish_event(
                    event_name="cis_pass_rate_dropped",
                    tenant_id=tenant_id,
                    payload={
                        "resource_type": "compliance-plugins",
                        "pass_rate_pct": round(pass_pct, 1),
                        "threshold_pct": threshold_pct,
                        "passed": passed,
                        "failed": failed,
                        "evaluated": evaluated,
                    },
                    correlation_id=f"pass_rate_drop:tenant:{tenant_id}",
                )
            else:
                # Tenant recovered → clear memo so a future drop re-fires.
                self._alerted_pass_rate_drop_tenants.discard(tenant_key)
        return fired

    @staticmethod
    def _derive_event_names(log: AuditLog) -> List[str]:
        action = (log.action or "read").strip().lower()
        resource_type = (log.resource_type or "system").strip().lower()

        event_names: List[str] = [f"{resource_type}.{action}"]

        # Direct mapping from _EVENT_MAP
        resource_map = _EVENT_MAP.get(resource_type, {})
        for mapped_event in resource_map.get(action, []):
            if mapped_event not in event_names:
                event_names.append(mapped_event)

        # Special: governance document submitted for review
        # Fires when PUT /{doc_id}/status is called with {"status": "pending_review"}
        if resource_type == "governance" and action == "update":
            changes_inner = (log.changes or {}) if isinstance(log.changes, dict) else {}
            requested = changes_inner.get("request") or {}
            if isinstance(requested, dict) and requested.get("status") == "pending_review":
                if "policy_submitted_for_review" not in event_names:
                    event_names.append("policy_submitted_for_review")

        # Special: Issue Management update → split into severity_changed
        # vs state_changed vs closed events based on what changed in the
        # request payload. The base map adds both events on any update so
        # workflows that only care about ONE bucket don't fire spuriously;
        # this block strips out the irrelevant event when the request
        # body indicates which field actually moved.
        if resource_type == "issues" and action == "update":
            changes_inner = (log.changes or {}) if isinstance(log.changes, dict) else {}
            req = changes_inner.get("request") or {}
            if isinstance(req, dict):
                changed_severity = any(
                    k in req for k in ("severity", "severity_override", "impact", "urgency")
                )
                changed_state = any(
                    k in req for k in ("workflow_state", "status", "to_state")
                )
                if changed_severity and not changed_state:
                    # Pure severity-only change → drop the state_changed event.
                    event_names = [e for e in event_names if e != "issue_state_changed"]
                elif changed_state and not changed_severity:
                    event_names = [e for e in event_names if e != "issue_severity_changed"]
                # If the request transitioned to closed, fire the closed event too.
                if req.get("status") == "closed" or req.get("to_state") == "closed":
                    if "issue_closed" not in event_names:
                        event_names.append("issue_closed")

        # Path-based enrichment
        changes = (log.changes or {}) if isinstance(log.changes, dict) else {}
        path = str(changes.get("path") or "").strip()
        if path:
            parts = [part for part in path.split("/") if part and part != "grc"]
            if len(parts) >= 2:
                module = parts[0].lower()
                entity = parts[1].lower()

                # v6 Workflow integration — Nested sub-resource handling.
                # Paths like /erm/risks/65/mitigation-actions log
                #   action="mitigation_actions" (sub-resource name)
                #   resource_type="risks" (parent)
                # Neither matches any workflow on its own. Detect the
                # pattern and re-route to the sub-resource's canonical
                # event so workflows for the child entity fire correctly.
                if (
                    len(parts) >= 4
                    and parts[2].isdigit()
                    and action in (parts[3].lower().replace("-", "_"), "create", "update", "delete")
                ):
                    sub_entity = parts[3].lower()
                    sub_module = module
                    sub_v6_module, sub_v6_entity = _resolve_canonical_resource(sub_module, sub_entity)
                    # Treat the operation as a create on the sub-resource —
                    # POST is the only way it gets logged with the sub name.
                    sub_verb = "create" if action in (sub_entity.replace("-", "_"),) else action
                    if sub_v6_module and sub_v6_entity:
                        sub_event = f"{sub_v6_module}.{sub_v6_entity}.{sub_verb}"
                        if sub_event not in event_names:
                            event_names.append(sub_event)
                    canonical_for_sub = _MODULE_ALIASES.get(sub_module, sub_module)
                    if canonical_for_sub != sub_entity:
                        generic_sub = f"{canonical_for_sub}.{sub_entity.replace('-', '_')}.{sub_verb}"
                        if generic_sub not in event_names:
                            event_names.append(generic_sub)

                # Normalise module name
                canonical = _MODULE_ALIASES.get(module, module)
                # Only add a generic compound event when the entity is distinct
                # from the canonical type.  Skipping when they are equal prevents
                # spurious events like 'risks.risks.create'.
                if not entity.isdigit() and canonical != entity:
                    generic = f"{canonical}.{entity}.{action}"
                    if generic not in event_names:
                        event_names.append(generic)

                # v6 Workflow integration — emit the canonical v6 event name
                # so Pattern-B workflows (e.g. risk.risk_register.create)
                # match real CRUD audit logs. Without this only legacy
                # `<noun>_<verb>` workflows fire.
                v6_module, v6_entity = _resolve_canonical_resource(module, entity)
                if v6_module and v6_entity:
                    v6_event = f"{v6_module}.{v6_entity}.{action}"
                    if v6_event not in event_names:
                        event_names.append(v6_event)
                    # Also emit the .trigger flavour for non-CRUD success actions
                    if (action not in ("create", "update", "delete", "read")
                            and not action.endswith("_failed")):
                        trig = f"{v6_module}.{v6_entity}.trigger"
                        if trig not in event_names:
                            event_names.append(trig)

                # Apply entity-level event map after alias resolution
                entity_map = _EVENT_MAP.get(canonical, {})
                for mapped in entity_map.get(action, []):
                    if mapped not in event_names:
                        event_names.append(mapped)

                # Legacy erm.incidents special case
                if canonical == "risks" and entity == "incidents":
                    for mapped in _EVENT_MAP.get("incidents", {}).get(action, []):
                        if mapped not in event_names:
                            event_names.append(mapped)

        return event_names

    @staticmethod
    def _build_payload(log: AuditLog) -> Dict[str, Any]:
        """Build an enriched event payload from an audit log entry."""
        payload: Dict[str, Any] = {
            "audit_log_id": log.id,
            "resource_type": log.resource_type,
            "resource_id": log.resource_id,
            "action": log.action,
            "changes": log.changes or {},
            "timestamp": log.timestamp.isoformat() if log.timestamp else datetime.utcnow().isoformat(),
            "user_id": log.user_id,
            "tenant_id": log.tenant_id,
        }

        # Infer severity / score from changes for risk/vuln events
        changes = log.changes or {}
        if isinstance(changes, dict):
            if "risk_score" in changes:
                payload["risk_score"] = changes["risk_score"]
                try:
                    score = float(changes["risk_score"])
                    payload["severity"] = "critical" if score >= 20 else "high" if score >= 12 else "medium"
                except (TypeError, ValueError):
                    pass
            if "severity" in changes:
                payload["severity"] = changes["severity"]
            if "status" in changes:
                payload["status"] = changes["status"]

        return payload

    def publish_event(self, event_name: str, tenant_id: int, payload: Dict[str, Any], correlation_id: Optional[str] = None) -> None:
        logger.debug(
            "workflow.dispatcher.publish_event event_name=%s tenant_id=%s correlation_id=%s",
            event_name,
            tenant_id,
            correlation_id,
        )
        self.event_queue.publish(
            {
                "kind": "event",
                "event_name": event_name,
                "tenant_id": tenant_id,
                "payload": payload or {},
                "correlation_id": correlation_id,
            }
        )

    def dispatch_event(self, db: Session, event: Dict[str, Any]) -> int:
        event_name = event.get("event_name")
        tenant_id = event.get("tenant_id")
        payload = event.get("payload") or {}

        if not event_name or not tenant_id:
            return 0

        logger.debug(
            "workflow.dispatcher.dispatch_event.start event_name=%s tenant_id=%s correlation_id=%s",
            event_name,
            tenant_id,
            event.get("correlation_id"),
        )

        # Match on exact trigger_event OR wildcard patterns (e.g. "risks.*")
        definitions = db.query(WorkflowDefinition).filter(
            WorkflowDefinition.tenant_id == tenant_id,
            WorkflowDefinition.is_active == True,
        ).all()

        def _matches(trig: str) -> bool:
            # Exact match or prefix wildcard (e.g. "risks.*" matches "risks.update")
            if not trig:
                return False
            return trig == event_name or (trig.endswith(".*") and event_name.startswith(trig[:-2]))

        triggered = 0
        for definition in definitions:
            # Multi-trigger OR logic: the workflow fires when the incoming event
            # matches the primary trigger_event OR any entry in trigger_events.
            candidate_triggers = [definition.trigger_event or ""]
            extra = definition.trigger_events
            if isinstance(extra, list):
                candidate_triggers.extend(str(t) for t in extra if t)
            if any(_matches(t) for t in candidate_triggers):
                if ConditionEvaluator.evaluate(definition.trigger_conditions or {}, payload):
                    self.event_queue.publish(
                        {
                            "kind": "start_instance",
                            "workflow_definition_id": definition.id,
                            "tenant_id": tenant_id,
                            "trigger_event": event_name,
                            "trigger_payload": payload,
                            "correlation_id": event.get("correlation_id"),
                        }
                    )
                    triggered += 1
                    logger.info(
                        "workflow.dispatcher.dispatch_event.triggered workflow_definition_id=%s event_name=%s tenant_id=%s",
                        definition.id,
                        event_name,
                        tenant_id,
                    )

        if triggered > 0:
            logger.info(
                "workflow.dispatcher.dispatch_event.done event_name=%s tenant_id=%s triggered=%s",
                event_name,
                tenant_id,
                triggered,
            )
        else:
            logger.info(
                "workflow.dispatcher.dispatch_event.no_match event_name=%s tenant_id=%s "
                "— no active workflow definition found for this trigger event",
                event_name,
                tenant_id,
            )

        return triggered
