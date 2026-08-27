"""SOC 2 quantitative automation API.

Thin additive layer over compliance-plugins aws_readonly runner.
Mounted at /automation/soc2 — does not modify existing CIS routes.
"""
from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import desc
from sqlalchemy.orm import Session

from grc.models import (
    CompliancePlugin,
    CompliancePluginRun,
    GRCUser,
    IntegrationConnection,
    get_db,
)
from grc.routers.auth_router import (
    get_user_primary_tenant,
    require_auth,
    require_tenant_permission,
)

from grc.modules.compliance_plugins.seed_soc2_quantitative import (
    BENCHMARK,
    ensure_soc2_framework_mappings,
    load_soc2_quantitative_catalog,
    seed_soc2_quantitative_plugins,
)
from grc.modules.compliance_plugins.seed_soc2_connectors import (
    BENCHMARK as CONNECTOR_BENCHMARK,
    ensure_soc2_connector_mappings,
    seed_soc2_connector_plugins,
)
from grc.modules.compliance_plugins.runners.live_api_catalog import (
    PROVIDER_API,
    all_control_codes,
    provider_meta,
    run_provider,
)
from grc.modules.compliance_plugins.services.credentials import resolve_credentials_for_connection
from grc.modules.compliance_plugins.services.run_service import execute_plugin
from grc.crypto import encrypt_secret

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/automation/soc2", tags=["SOC2 Automation"])

_require_scan_perm = require_tenant_permission("compliance:scan:execute")

# 114-control SOC 2 implementation library + 61 TSC criteria + control→criteria
# mapping, vendored verbatim from the reference (control_templates/requirements/
# template_requirements). Each control maps to one or more TSC criteria and links
# the automated checks (AWS quantitative + SaaS connectors) covering those criteria.
_SOC2_DATA = Path(__file__).resolve().parents[2] / "seed_data" / "automation" / "soc2"


def _read_json(name: str) -> Any:
    try:
        return json.loads((_SOC2_DATA / name).read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001
        logger.exception("could not load soc2 data file %s", name)
        return []


def _control_criteria_map() -> Dict[str, List[str]]:
    """template_code (BC-01) -> sorted unique criteria codes (CC9.1, A1.2)."""
    out: Dict[str, List[str]] = {}
    for row in _read_json("template_requirements.json"):
        code = row.get("template_code")
        key = (row.get("requirement_key") or "").split(":", 1)[-1]
        if code and key:
            bucket = out.setdefault(code, [])
            if key not in bucket:
                bucket.append(key)
    for code in out:
        out[code].sort()
    return out


def _load_control_library() -> Dict[str, Any]:
    crit = _control_criteria_map()
    controls = []
    for t in _read_json("control_templates.json"):
        code = t.get("code")
        controls.append({
            "control_id": code,
            "title": t.get("name"),
            "description": t.get("description"),
            "guidance": t.get("implementation_guidance"),
            "sub_type": t.get("control_sub_type"),
            "category": t.get("category"),
            "importance": t.get("importance"),
            "criteria": crit.get(code, []),
        })
    controls.sort(key=lambda c: c.get("control_id") or "")
    return {"framework": "SOC 2", "catalog_version": "SOC2_TSC_2017", "controls": controls}


def _load_criteria() -> List[Dict[str, Any]]:
    """The 61 SOC 2 Trust Services Criteria (verbatim AICPA wording)."""
    return _read_json("requirements.json")


class RunCheckBody(BaseModel):
    connection_id: Optional[int] = Field(None, description="aws_readonly IntegrationConnection id (AWS checks only; connectors use their own)")


class RunAllBody(BaseModel):
    connection_id: int
    control_id: Optional[str] = None  # optional filter e.g. CC6.1


def _plugin_out(p: CompliancePlugin) -> Dict[str, Any]:
    return {
        "id": p.id,
        "plugin_key": p.plugin_key,
        "benchmark": p.benchmark,
        "rule_id": p.rule_id,
        "title": p.title,
        "description": p.description,
        "rationale": p.rationale,
        "remediation": p.remediation,
        "severity": p.severity,
        "runner_type": p.runner_type,
        "check_definition": p.check_definition or {},
        "enabled": bool(p.enabled),
        "is_builtin": bool(p.is_builtin),
        "source_url": p.source_url,
    }


def _run_out(r: CompliancePluginRun) -> Dict[str, Any]:
    return {
        "id": r.id,
        "plugin_id": r.plugin_id,
        "connection_id": r.connection_id,
        "status": r.status,
        "result_summary": r.result_summary,
        "result_detail": getattr(r, "result_detail", None),
        "raw_output": r.raw_output,
        "evidence_hash": r.evidence_hash,
        "error_message": r.error_message,
        "duration_ms": r.duration_ms,
        "triggered_by": r.triggered_by,
        "started_at": r.started_at.isoformat() if r.started_at else None,
        "completed_at": r.completed_at.isoformat() if r.completed_at else None,
    }


def _latest_runs_by_plugin(
    db: Session, tenant_id: int, plugin_ids: List[int]
) -> Dict[int, CompliancePluginRun]:
    if not plugin_ids:
        return {}
    runs = (
        db.query(CompliancePluginRun)
        .filter(
            CompliancePluginRun.tenant_id == tenant_id,
            CompliancePluginRun.plugin_id.in_(plugin_ids),
        )
        .order_by(desc(CompliancePluginRun.id))
        .all()
    )
    latest: Dict[int, CompliancePluginRun] = {}
    for r in runs:
        if r.plugin_id not in latest:
            latest[r.plugin_id] = r
    return latest


def _aggregate_status(statuses: List[str]) -> str:
    if not statuses:
        return "not_run"
    if any(s == "failed" for s in statuses):
        return "failed"
    if any(s == "error" for s in statuses):
        return "error"
    if any(s in ("running", "pending") for s in statuses):
        return "running"
    if all(s == "passed" for s in statuses):
        return "passed"
    if any(s == "passed" for s in statuses):
        return "partial"
    return statuses[0]


def _soc2_plugins(db: Session, control_id: Optional[str] = None) -> List[CompliancePlugin]:
    # AWS quantitative checks only — used by run-all / list-checks which run against
    # an aws_readonly connection. Connector checks run via /collectors (own token).
    q = db.query(CompliancePlugin).filter(
        CompliancePlugin.benchmark == BENCHMARK,
        CompliancePlugin.enabled.is_(True),
    )
    if control_id:
        q = q.filter(CompliancePlugin.rule_id == control_id)
    return q.order_by(CompliancePlugin.rule_id, CompliancePlugin.plugin_key).all()


def _plugins_by_control_code(db: Session) -> Dict[str, List[CompliancePlugin]]:
    """Every SOC 2 check (AWS quantitative + SaaS connector) indexed by the control
    code(s) it covers — quantitative via rule_id, connectors via all_control_codes."""
    plugins = (
        db.query(CompliancePlugin)
        .filter(
            CompliancePlugin.benchmark.in_([BENCHMARK, CONNECTOR_BENCHMARK]),
            CompliancePlugin.enabled.is_(True),
        )
        .all()
    )
    by_code: Dict[str, List[CompliancePlugin]] = {}
    for p in plugins:
        if p.benchmark == CONNECTOR_BENCHMARK:
            provider = (p.check_definition or {}).get("provider")
            codes = all_control_codes(provider) if provider else ([p.rule_id] if p.rule_id else [])
        else:
            codes = [p.rule_id] if p.rule_id else []
        for code in codes:
            by_code.setdefault(code, []).append(p)
    return by_code


@router.post("/seed", status_code=201)
def seed_soc2(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """Idempotently seed SOC 2 quantitative plugins + optional framework mappings."""
    tenant_id = get_user_primary_tenant(current_user, db)
    n = seed_soc2_quantitative_plugins(db)
    connectors = 0
    try:
        connectors = seed_soc2_connector_plugins(db)  # 39 SaaS evidence collectors
    except Exception:
        logger.exception("seed_soc2_connector_plugins failed (non-fatal)")
    mapped = 0
    try:
        mapped = ensure_soc2_framework_mappings(db, tenant_id)
        mapped += ensure_soc2_connector_mappings(db, tenant_id)
    except Exception:
        logger.exception("ensure_soc2_framework_mappings failed (non-fatal)")
    catalog = load_soc2_quantitative_catalog()
    return {
        "status": "ok",
        "upserted": n + connectors,
        "connectors_upserted": connectors,
        "framework_mappings_created": mapped,
        "controls": len(catalog.get("controls") or []),
    }


# ── Evidence Collectors (SaaS API connectors) ────────────────────────────────
class CollectorConnectBody(BaseModel):
    token: str = Field(..., description="API token / access token (stored encrypted)")
    domain: Optional[str] = Field(None, description="Instance domain for Okta/Jira/Grafana/Zendesk/etc.")
    email: Optional[str] = Field(None, description="Account email (for Jira basic auth)")


def _connector_plugin(db: Session, provider: str) -> Optional[CompliancePlugin]:
    return (
        db.query(CompliancePlugin)
        .filter(
            CompliancePlugin.tenant_id.is_(None),
            CompliancePlugin.plugin_key == f"{CONNECTOR_BENCHMARK}__{provider}",
        )
        .first()
    )


def _connector_connection(db: Session, tenant_id: int, provider: str) -> Optional[IntegrationConnection]:
    return (
        db.query(IntegrationConnection)
        .filter(
            IntegrationConnection.tenant_id == tenant_id,
            IntegrationConnection.integration_type == provider,
        )
        .order_by(desc(IntegrationConnection.id))
        .first()
    )


@router.get("/collectors")
def list_collectors(db: Session = Depends(get_db), current_user: GRCUser = Depends(require_auth)):
    """The 39 SaaS evidence collectors + per-provider connection status + last run."""
    tenant_id = get_user_primary_tenant(current_user, db)
    conns = {
        c.integration_type: c
        for c in db.query(IntegrationConnection)
        .filter(
            IntegrationConnection.tenant_id == tenant_id,
            IntegrationConnection.integration_type.in_(list(PROVIDER_API.keys())),
        )
        .all()
    }
    out = []
    for m in provider_meta():
        p = m["provider"]
        c = conns.get(p)
        plugin = _connector_plugin(db, p)
        last = None
        if plugin:
            run = (
                db.query(CompliancePluginRun)
                .filter(
                    CompliancePluginRun.tenant_id == tenant_id,
                    CompliancePluginRun.plugin_id == plugin.id,
                )
                .order_by(desc(CompliancePluginRun.started_at))
                .first()
            )
            if run:
                last = {"status": run.status, "started_at": run.started_at.isoformat() if run.started_at else None}
        out.append({
            **m,
            "connected": bool(c),
            "connection_id": c.id if c else None,
            "seeded": bool(plugin),
            "last_run": last,
        })
    return {"collectors": out, "total": len(out)}


@router.post("/collectors/{provider}/connect")
def connect_collector(
    provider: str,
    body: CollectorConnectBody,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """Save (encrypted) credentials for a collector, creating/updating its connection."""
    if provider not in PROVIDER_API:
        raise HTTPException(status_code=404, detail="Unknown collector provider")
    tenant_id = get_user_primary_tenant(current_user, db)
    extra = {
        "token": encrypt_secret(body.token),
        "domain": (body.domain or "").strip(),
        "email": (body.email or "").strip(),
    }
    conn = _connector_connection(db, tenant_id, provider)
    if conn:
        conn.credentials_extra_json = extra
        conn.console_url = (body.domain or "").strip() or conn.console_url
        conn.username = (body.email or "").strip() or conn.username
        conn.status = "connected"
        conn.is_active = True
    else:
        conn = IntegrationConnection(
            tenant_id=tenant_id,
            integration_type=provider,
            category="evidence_collector",
            connection_name=f"{PROVIDER_API[provider]['label']} evidence collector",
            # console_url is NOT NULL; SaaS collectors have no host, so fall back to
            # the provider's API base (creds still come from credentials_extra_json).
            console_url=(body.domain or "").strip() or PROVIDER_API[provider].get("base") or provider,
            username=(body.email or "").strip() or None,
            auth_method="apikey",
            credentials_extra_json=extra,
            is_active=True,
            status="connected",
            created_by_user_id=current_user.id,
        )
        db.add(conn)
    db.commit()
    db.refresh(conn)
    return {"status": "ok", "provider": provider, "connection_id": conn.id}


@router.post("/collectors/{provider}/test")
def test_collector(provider: str, db: Session = Depends(get_db), current_user: GRCUser = Depends(require_auth)):
    """Lightweight connectivity test: call the provider API live (no persistence)."""
    if provider not in PROVIDER_API:
        raise HTTPException(status_code=404, detail="Unknown collector provider")
    tenant_id = get_user_primary_tenant(current_user, db)
    conn = _connector_connection(db, tenant_id, provider)
    if not conn:
        raise HTTPException(status_code=400, detail="Configure credentials for this collector first")
    creds = resolve_credentials_for_connection(conn)
    result = run_provider(provider, creds)
    return {
        "provider": provider,
        "connectivity": result["connectivity"],
        "summary": result["summary_text"],
        "findings": result["findings"],
    }


@router.post("/collectors/{provider}/run")
def run_collector(provider: str, db: Session = Depends(get_db), current_user: GRCUser = Depends(require_auth)):
    """Full collection: execute the plugin (persists a run, snapshots evidence, cascades to controls)."""
    if provider not in PROVIDER_API:
        raise HTTPException(status_code=404, detail="Unknown collector provider")
    tenant_id = get_user_primary_tenant(current_user, db)
    plugin = _connector_plugin(db, provider)
    if not plugin:
        # Auto-seed so a Collect never dead-ends on an unseeded tenant.
        seed_soc2_connector_plugins(db)
        try:
            ensure_soc2_connector_mappings(db, tenant_id)
        except Exception:
            logger.exception("ensure_soc2_connector_mappings failed (non-fatal)")
        plugin = _connector_plugin(db, provider)
    if not plugin:
        raise HTTPException(status_code=400, detail="Collector plugin unavailable after seed")
    conn = _connector_connection(db, tenant_id, provider)
    if not conn:
        raise HTTPException(status_code=400, detail="Configure credentials for this collector first")
    run = execute_plugin(
        db, tenant_id=tenant_id, user_id=current_user.id,
        plugin=plugin, asset=None, connection=conn, triggered_by="manual",
    )
    return {
        "provider": provider,
        "run_id": run.id,
        "status": run.status,
        "evidence": run.evidence_snapshot,
    }


@router.get("/controls")
def list_controls(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """SOC 2 control library (114 implementation controls) with per-control status.
    Each control maps to TSC criteria; its linked checks = every AWS quantitative +
    SaaS connector check covering any of those criteria, latest run aggregated."""
    tenant_id = get_user_primary_tenant(current_user, db)
    lib = _load_control_library()
    by_code = _plugins_by_control_code(db)
    all_ids = {p.id for ps in by_code.values() for p in ps}
    latest = _latest_runs_by_plugin(db, tenant_id, list(all_ids))

    controls_out = []
    for c in lib.get("controls") or []:
        criteria = c.get("criteria") or []
        linked = []
        statuses: List[str] = []
        seen: set = set()
        for code in criteria:
            for p in by_code.get(code, []):
                if p.id in seen:
                    continue
                seen.add(p.id)
                run = latest.get(p.id)
                if run:
                    statuses.append(run.status)
                linked.append({
                    "plugin_key": p.plugin_key,
                    "id": p.id,
                    "title": p.title,
                    "severity": p.severity,
                    "seeded": True,
                    "source": "connector" if p.benchmark == CONNECTOR_BENCHMARK else "aws",
                    "last_run": _run_out(run) if run else None,
                })
        controls_out.append({
            "control_id": c.get("control_id"),
            "title": c.get("title"),
            "description": c.get("description"),
            "guidance": c.get("guidance"),
            "sub_type": c.get("sub_type"),
            "category": c.get("category"),
            "domain": c.get("category"),
            "importance": c.get("importance"),
            "criteria": criteria,
            "checks_count": len(linked),
            "overall_status": _aggregate_status(statuses) if linked else "manual",
            "checks": linked,
        })

    return {
        "framework": lib.get("framework", "SOC 2 Control Library"),
        "catalog_version": lib.get("catalog_version", "SOC2_LIBRARY_v1"),
        "seeded_plugin_count": len(all_ids),
        "controls": controls_out,
    }


@router.get("/criteria")
def list_criteria(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """The 61 SOC 2 Trust Services Criteria (verbatim AICPA text) — code, name,
    trust-services category, scope. Powers the control-detail Requirements tab."""
    criteria = _load_criteria()
    return {"framework": "SOC 2", "count": len(criteria), "criteria": criteria}


@router.get("/checks")
def list_checks(
    control_id: Optional[str] = Query(None, description="Filter by SOC 2 criterion e.g. CC6.1"),
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    tenant_id = get_user_primary_tenant(current_user, db)
    # All automated checks — AWS quantitative + SaaS connectors (not AWS-only).
    if control_id:
        plugins = _plugins_by_control_code(db).get(control_id, [])
    else:
        plugins = (
            db.query(CompliancePlugin)
            .filter(
                CompliancePlugin.benchmark.in_([BENCHMARK, CONNECTOR_BENCHMARK]),
                CompliancePlugin.enabled.is_(True),
            )
            .order_by(CompliancePlugin.benchmark, CompliancePlugin.rule_id, CompliancePlugin.plugin_key)
            .all()
        )
    latest = _latest_runs_by_plugin(db, tenant_id, [p.id for p in plugins])
    items = []
    for p in plugins:
        run = latest.get(p.id)
        row = _plugin_out(p)
        row["source"] = "connector" if p.benchmark == CONNECTOR_BENCHMARK else "aws"
        row["last_run"] = _run_out(run) if run else None
        items.append(row)
    return {"benchmark": "SOC2", "count": len(items), "checks": items}


@router.get("/checks/{plugin_id}")
def get_check(
    plugin_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    tenant_id = get_user_primary_tenant(current_user, db)
    plugin = (
        db.query(CompliancePlugin)
        .filter(
            CompliancePlugin.id == plugin_id,
            CompliancePlugin.benchmark.in_([BENCHMARK, CONNECTOR_BENCHMARK]),
        )
        .first()
    )
    if not plugin:
        raise HTTPException(404, "SOC 2 check not found")
    runs = (
        db.query(CompliancePluginRun)
        .filter(
            CompliancePluginRun.tenant_id == tenant_id,
            CompliancePluginRun.plugin_id == plugin.id,
        )
        .order_by(desc(CompliancePluginRun.id))
        .limit(20)
        .all()
    )
    return {
        "check": _plugin_out(plugin),
        "runs": [_run_out(r) for r in runs],
    }


@router.get("/connections")
def list_aws_connections(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """aws_readonly IntegrationConnections for this tenant."""
    tenant_id = get_user_primary_tenant(current_user, db)
    conns = (
        db.query(IntegrationConnection)
        .filter(
            IntegrationConnection.tenant_id == tenant_id,
            IntegrationConnection.integration_type == "aws_readonly",
        )
        .order_by(IntegrationConnection.id.desc())
        .all()
    )
    return {
        "connections": [
            {
                "id": c.id,
                "name": c.connection_name,
                "integration_type": c.integration_type,
                "status": c.status,
                "console_url": c.console_url,
            }
            for c in conns
        ]
    }


def _resolve_aws_connection(
    db: Session, tenant_id: int, connection_id: int
) -> IntegrationConnection:
    conn = (
        db.query(IntegrationConnection)
        .filter(
            IntegrationConnection.id == connection_id,
            IntegrationConnection.tenant_id == tenant_id,
            IntegrationConnection.integration_type == "aws_readonly",
        )
        .first()
    )
    if not conn:
        raise HTTPException(
            404,
            "aws_readonly connection not found for this tenant. "
            "Configure one via Admin / Connectors (same as CIS AWS plugins).",
        )
    return conn


@router.post("/checks/{plugin_id}/run")
def run_check(
    plugin_id: int,
    body: RunCheckBody,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _perm: bool = Depends(_require_scan_perm),
):
    tenant_id = get_user_primary_tenant(current_user, db)
    plugin = (
        db.query(CompliancePlugin)
        .filter(
            CompliancePlugin.id == plugin_id,
            CompliancePlugin.benchmark.in_([BENCHMARK, CONNECTOR_BENCHMARK]),
            CompliancePlugin.enabled.is_(True),
        )
        .first()
    )
    if not plugin:
        raise HTTPException(404, "SOC 2 check not found")
    if plugin.benchmark == CONNECTOR_BENCHMARK:
        provider = (plugin.check_definition or {}).get("provider")
        conn = _connector_connection(db, tenant_id, provider)
        if not conn:
            raise HTTPException(400, f"Configure credentials for {provider} on the Evidence Collectors page first.")
    else:
        conn = _resolve_aws_connection(db, tenant_id, body.connection_id)
    run = execute_plugin(
        db,
        tenant_id=tenant_id,
        user_id=current_user.id,
        plugin=plugin,
        asset=None,
        connection=conn,
        triggered_by="soc2_automation",
    )
    return {"run": _run_out(run), "check": _plugin_out(plugin)}


@router.post("/run-all")
def run_all(
    body: RunAllBody,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _perm: bool = Depends(_require_scan_perm),
):
    tenant_id = get_user_primary_tenant(current_user, db)
    conn = _resolve_aws_connection(db, tenant_id, body.connection_id)
    plugins = _soc2_plugins(db, control_id=body.control_id)
    if not plugins:
        raise HTTPException(
            404,
            "No SOC 2 quantitative checks found. Call POST /automation/soc2/seed first.",
        )
    results = []
    for plugin in plugins:
        try:
            run = execute_plugin(
                db,
                tenant_id=tenant_id,
                user_id=current_user.id,
                plugin=plugin,
                asset=None,
                connection=conn,
                triggered_by="soc2_automation_batch",
            )
            results.append({
                "plugin_id": plugin.id,
                "plugin_key": plugin.plugin_key,
                "rule_id": plugin.rule_id,
                "ok": True,
                "run": _run_out(run),
            })
        except Exception as exc:  # noqa: BLE001
            logger.exception("SOC2 run-all failed for plugin %s", plugin.plugin_key)
            results.append({
                "plugin_id": plugin.id,
                "plugin_key": plugin.plugin_key,
                "rule_id": plugin.rule_id,
                "ok": False,
                "error": str(exc),
            })
    passed = sum(1 for r in results if r.get("ok") and (r.get("run") or {}).get("status") == "passed")
    failed = sum(1 for r in results if r.get("ok") and (r.get("run") or {}).get("status") == "failed")
    errors = sum(1 for r in results if (not r.get("ok")) or (r.get("run") or {}).get("status") == "error")
    return {
        "connection_id": conn.id,
        "total": len(results),
        "passed": passed,
        "failed": failed,
        "errors": errors,
        "results": results,
    }
