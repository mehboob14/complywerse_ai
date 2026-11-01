"""Plugin run orchestration: persist a row, dispatch to runner, hash, audit, cascade."""
from __future__ import annotations

import hashlib
import json
import logging
import socket
from datetime import datetime
from typing import Optional

from sqlalchemy.orm import Session

from grc.models import (
    AssessmentItem,
    AssetSecurityComplianceSelection,
    CompliancePlugin,
    CompliancePluginRun,
    ControlMapping,
    FrameworkAssessment,
    IntegrationConnection,
    ITAsset,
    PluginControlMapping,
)
from grc.rich_audit import write_rich_audit_log

from ..runners import run_check
from ..runners.registry import RunnerResult
from .credentials import resolve_credentials_for_connection

logger = logging.getLogger(__name__)


def _host_resolves(host: str) -> bool:
    """True if `host` is an IP or a DNS-resolvable name. An unresolvable discovery
    hostname (DigitalOcean droplet name etc.) returns False so the caller can fall
    back to the asset's reachable IP. Self-check: _host_resolves('127.0.0.1') is True."""
    h = (host or "").strip()
    if not h:
        return False
    try:
        socket.getaddrinfo(h, None)
        return True
    except Exception:  # noqa: BLE001 — any resolution failure means "use the IP instead"
        return False


def _resolve_host_family(asset: Optional[ITAsset]) -> Optional[str]:
    """Best-effort host OS family for applicability gates.

    Application assets (e.g. PostgreSQL child) inherit the parent's family
    when present; otherwise fall back to their own os_family / os_normalized.
    """
    if asset is None:
        return None
    fam = (getattr(asset, "os_family", None) or "").strip().lower()
    if fam in ("windows", "linux", "macos", "unix"):
        return "linux" if fam == "unix" else fam
    norm = (getattr(asset, "os_normalized", None) or "").strip().lower()
    if norm.startswith("windows") or "windows" in norm:
        return "windows"
    if any(norm.startswith(p) for p in ("ubuntu", "debian", "rhel", "centos", "rocky", "alma", "sles", "suse", "linux", "amazon")):
        return "linux"
    if norm.startswith("macos") or "darwin" in norm:
        return "macos"
    # Walk parent for application assets
    parent_id = getattr(asset, "parent_asset_id", None)
    if parent_id and hasattr(asset, "parent") and asset.parent is not None:
        return _resolve_host_family(asset.parent)
    return fam or None


def _evidence_hash(payload: dict) -> str:
    canonical = json.dumps(payload, sort_keys=True, default=str)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _cascade_to_controls(
    db: Session,
    *,
    tenant_id: int,
    plugin: CompliancePlugin,
    run: CompliancePluginRun,
) -> int:
    """Cascade pass/fail into the existing assessment-item compliance layer.

    PluginControlMapping rows define which controls inherit this plugin's
    pass/fail state. We resolve normalized_control_id mappings through
    ControlMapping → parsed_control_id and then update AssessmentItem
    rows for any in-progress assessments. AssessmentItem already drives the
    framework scoring service, so no extra recompute is needed here.

    - status="passed"  → AssessmentItem.compliance_status="compliant", score=1.0
    - status="failed"  → AssessmentItem.compliance_status="non_compliant", score=0.0
    - status="error"   → no-op (no signal to propagate).
    Returns the number of assessment items touched.
    """
    if run.status not in ("passed", "failed"):
        return 0
    mappings = (
        db.query(PluginControlMapping)
        .filter(
            PluginControlMapping.plugin_id == plugin.id,
            PluginControlMapping.tenant_id == tenant_id,
        )
        .all()
    )
    if not mappings:
        return 0

    new_status = "compliant" if run.status == "passed" else "non_compliant"
    new_score = 1.0 if run.status == "passed" else 0.0

    # Collect candidate parsed_control_ids from mappings via ControlMapping.
    parsed_ids: set[int] = set()
    for m in mappings:
        cm_q = db.query(ControlMapping)
        if m.normalized_control_id:
            cm_q = cm_q.filter(ControlMapping.normalized_control_id == m.normalized_control_id)
        elif m.framework_control_id:
            cm_q = cm_q.filter(ControlMapping.framework_control_id == m.framework_control_id)
        else:
            continue
        for cm in cm_q.all():
            pid = getattr(cm, "parsed_control_id", None)
            if pid:
                parsed_ids.add(pid)
    if not parsed_ids:
        return 0

    # Strict tenant scoping — only update assessment items belonging to a
    # FrameworkAssessment owned by the SAME tenant as this plugin run. Without
    # this join, a built-in plugin (tenant_id=NULL) mapped via one tenant
    # could mutate other tenants' assessment items sharing the same parsed
    # control. This is a hard cross-tenant isolation requirement.
    items = (
        db.query(AssessmentItem)
        .join(FrameworkAssessment,
              FrameworkAssessment.id == AssessmentItem.assessment_id)
        .filter(
            AssessmentItem.parsed_control_id.in_(list(parsed_ids)),
            FrameworkAssessment.tenant_id == tenant_id,
        )
        .all()
    )
    touched = 0
    for it in items:
        it.compliance_status = new_status
        it.compliance_score = new_score
        it.assessed_at = datetime.utcnow()
        db.add(it)
        touched += 1
    return touched


def _strip_nul(v):
    """Postgres TEXT columns reject NUL bytes (0x00). `secedit /export` emits
    UTF-16 with embedded NULs; strip before persisting."""
    if isinstance(v, str):
        return v.replace("\x00", "")
    if isinstance(v, dict):
        return {k: _strip_nul(x) for k, x in v.items()}
    if isinstance(v, list):
        return [_strip_nul(x) for x in v]
    return v


def _finalize_run(
    db: Session,
    run: CompliancePluginRun,
    result: RunnerResult,
    *,
    plugin: CompliancePlugin,
    tenant_id: int,
    user_id: Optional[int],
    triggered_by: str,
) -> CompliancePluginRun:
    """Persist a RunnerResult onto a (running or pending) run row, then cascade
    to framework controls, the legacy selection table and the audit log.

    Shared by the agentless executor (execute_plugin) AND the agent CIS results
    endpoint, so a collector/agent-produced result is BYTE-IDENTICAL to a
    locally-executed one — same row fields, same cascades, same scoring inputs.
    """
    completed = datetime.utcnow()
    started = run.started_at or completed
    duration_ms = int((completed - started).total_seconds() * 1000)
    raw = _strip_nul(result.raw_output or {})
    safe_summary = _strip_nul(result.summary) if result.summary else None
    safe_error = _strip_nul(result.error_message) if result.error_message else None
    run_asset = db.get(ITAsset, run.asset_id) if run.asset_id else None

    snapshot = {
        "plugin_key": plugin.plugin_key,
        "plugin_id": plugin.id,
        "asset_id": run.asset_id,
        "connection_id": run.connection_id,
        "raw": raw,
        "status": result.status,
        "completed_at": completed.isoformat(),
    }
    run.status = result.status
    run.result_summary = safe_summary[:2000] if safe_summary else None
    run.result_detail = safe_summary
    run.raw_output = raw
    run.evidence_snapshot = snapshot
    run.evidence_hash = _evidence_hash(snapshot)
    run.error_message = safe_error
    run.completed_at = completed
    run.duration_ms = duration_ms
    db.add(run)

    framework_controls_touched = _cascade_to_controls(
        db, tenant_id=tenant_id, plugin=plugin, run=run,
    )

    # Durable per-control record of what this run asserted. Without it the
    # findings die in raw_output JSON and "was this control operating in March"
    # has no answer. Best-effort: a recorder must never break a collection run.
    try:
        from .check_result_recorder import record_check_results
        record_check_results(
            db, tenant_id=tenant_id, run=run, plugin=plugin,
            findings=(raw or {}).get("findings") or [],
        )
    except Exception:  # noqa: BLE001 — recording is additive, collection is not
        logger.exception("check-result recording failed for run %s", run.id)
    if run_asset is not None and result.status in ("passed", "failed"):
        existing = (
            db.query(AssetSecurityComplianceSelection)
            .filter(
                AssetSecurityComplianceSelection.asset_id == run_asset.id,
                AssetSecurityComplianceSelection.benchmark == "CIS_PLUGIN",
                AssetSecurityComplianceSelection.control_id == plugin.plugin_key,
            )
            .first()
        )
        if existing is None:
            db.add(AssetSecurityComplianceSelection(
                asset_id=run_asset.id, benchmark="CIS_PLUGIN",
                control_id=plugin.plugin_key, selected_by=user_id,
            ))

    audit_action = "failed" if result.status == "failed" else "execute"
    write_rich_audit_log(
        db=db,
        tenant_id=tenant_id,
        user_id=user_id,
        action=audit_action,
        resource_type="compliance.plugin_runs",
        resource_id=run.id,
        resource_name=f"plugin_run:{plugin.plugin_key}",
        resource_url=f"/grc/compliance/plugin_runs/{run.id}",
        summary=(
            f"Plugin '{plugin.title}' [{plugin.rule_id}] → {result.status}: "
            f"{(result.summary or '')[:160]}"
        ),
        snapshot={
            "plugin_id": plugin.id,
            "plugin_key": plugin.plugin_key,
            "asset_id": run.asset_id,
            "connection_id": run.connection_id,
            "status": result.status,
            "evidence_hash": run.evidence_hash,
            "framework_controls_cascaded": framework_controls_touched,
            "triggered_by": triggered_by,
        },
    )
    db.commit()
    db.refresh(run)
    return run


def execute_plugin(
    db: Session,
    *,
    tenant_id: int,
    user_id: Optional[int],
    plugin: CompliancePlugin,
    asset: Optional[ITAsset],
    connection: Optional[IntegrationConnection],
    triggered_by: str = "manual",
    attributed_to_asset: Optional[ITAsset] = None,
    manual_result: Optional[str] = None,
    manual_note: Optional[str] = None,
) -> CompliancePluginRun:
    """Execute a plugin and persist a CompliancePluginRun row.

    The run row is created with status='running' BEFORE execution so that
    long-running checks remain observable. After execution it is updated
    in-place with the outcome (immutable thereafter — we never mutate result
    fields once status moves out of running).

    Room-scan model: ``attributed_to_asset`` overrides which asset_id is
    stamped on the run row. The plugin still EXECUTES against ``asset``'s
    connection (the host), but the run is attributed to whichever asset's
    benchmark this plugin came from (a peer). This is what makes the peer's
    own compliance history reflect a host-driven room-scan.
    """
    started = datetime.utcnow()
    # Collector routing: if the operator assigned a collector to this
    # connection, the run is "owned" by that collector. It will poll
    # /agents/jobs, see this run as pending, execute it, and post results
    # back. Backend skips local execution entirely in that case.
    collector_agent_id = (
        getattr(connection, "assigned_collector_agent_id", None)
        if connection else None
    )
    # Attribute the run to the peer whose benchmark this plugin came from,
    # or fall back to the asset whose connection is executing. In legacy
    # single-asset scans these are the same.
    run_asset = attributed_to_asset or asset
    run = CompliancePluginRun(
        tenant_id=tenant_id,
        plugin_id=plugin.id,
        asset_id=run_asset.id if run_asset else None,
        connection_id=connection.id if connection else None,
        status="pending" if collector_agent_id else "running",
        triggered_by=triggered_by,
        triggered_by_user_id=user_id,
        executed_by_agent_id=collector_agent_id,
        started_at=started,
        remediation_shown=plugin.remediation,
    )
    db.add(run)
    db.flush()
    db.commit()  # commit running state so it's visible during execution
    db.refresh(run)

    # Collector path: don't execute here. Return the pending row, the
    # collector will pick it up via /agents/jobs and update it later.
    if collector_agent_id:
        # Nudge the collector to wake on its next long-poll tick.
        try:
            from grc.models import ComplianceAgent
            agent = db.query(ComplianceAgent).get(collector_agent_id)
            if agent and agent.pending_scan_at is None:
                agent.pending_scan_at = datetime.utcnow()
                db.commit()
        except Exception:  # noqa: BLE001
            pass
        return run

    # Resolve creds against the target asset's IP: a stored host that won't
    # resolve from the scanner (common for a discovered host_name like a
    # DigitalOcean droplet name) otherwise fails EVERY rule with "could not
    # resolve host". The fallback lives in resolve_credentials_for_connection so
    # it applies to every transport (SSH / WinRM / DB), not just SSH.
    _tgt_asset = run_asset or asset
    credentials = resolve_credentials_for_connection(
        connection, asset_ip=getattr(_tgt_asset, "ip_address", None)
    ) if connection else {}
    # Manual (attestation) rules carry no executable check — the operator's
    # pass/fail/N-A decision is injected onto the check_definition so the
    # `manual` runner can turn it into a result through the same pipeline.
    effective_check = dict(plugin.check_definition or {})
    if plugin.runner_type == "manual" and (manual_result is not None or manual_note is not None):
        effective_check["_manual_result"] = manual_result
        effective_check["_manual_note"] = manual_note

    # Host-family gate for OS-level CIS rules (e.g. systemd/umask on Linux,
    # service ACL on Windows). When the asset's host OS is outside
    # applicable_host_families, return not_applicable (skipped) — never a
    # silent auto-pass and never a fabricated fail.
    host_family = _resolve_host_family(run_asset or asset)
    applicable_families = effective_check.get("applicable_host_families") or []
    if applicable_families and host_family:
        allowed = {str(f).lower() for f in applicable_families}
        # Windows alternate payload: swap runner + check when present.
        if host_family == "windows" and isinstance(effective_check.get("windows_winrm"), dict):
            win_cd = dict(effective_check["windows_winrm"])
            result = run_check("windows_winrm", win_cd, credentials)
        elif host_family not in allowed:
            result = RunnerResult(
                status="skipped",
                summary=(
                    f"Not applicable on host OS family '{host_family}' "
                    f"(rule applies to: {sorted(allowed)})."
                ),
                raw_output={"not_applicable": True, "host_family": host_family},
            )
        else:
            result = run_check(plugin.runner_type, effective_check, credentials)
    else:
        result = run_check(plugin.runner_type, effective_check, credentials)

    return _finalize_run(
        db, run, result, plugin=plugin, tenant_id=tenant_id,
        user_id=user_id, triggered_by=triggered_by,
    )
