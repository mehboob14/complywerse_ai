"""SOC 2 quantitative automation API.

Thin additive layer over compliance-plugins aws_readonly runner.
Mounted at /automation/soc2 — does not modify existing CIS routes.
"""
from __future__ import annotations

import json
import logging
from collections import defaultdict
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import desc, distinct, func
from sqlalchemy.orm import Session

from grc.models import (
    CompliancePlugin,
    CompliancePluginRun,
    GRCUser,
    IntegrationConnection,
    SCFControl,
    SCFMapping,
    SCFObjective,
    SCFRelease,
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
    CONNECTOR_CHECKS,
    PROVIDER_API,
    all_control_codes,
    provider_meta,
    run_provider,
)
from grc.modules.compliance_plugins.services.credentials import resolve_credentials_for_connection
from grc.modules.compliance_plugins.services.run_service import execute_plugin
from grc.crypto import encrypt_secret

logger = logging.getLogger(__name__)

# Display names for the framework slugs the SCF crosswalk resolves to. Anything not
# listed falls back to a title-cased slug, so a newly seeded framework still shows.
_FW_LABELS = {
    "soc2": "SOC 2", "iso_27001": "ISO 27001", "iso_42001": "ISO 42001",
    "iso_45001": "ISO 45001",
    "iso_22301": "ISO 22301", "pci_dss": "PCI DSS", "gdpr": "GDPR",
    "hipaa": "HIPAA", "nist_800_53": "NIST 800-53", "nist_800_171": "NIST 800-171",
    "nist_csf": "NIST CSF", "nist_airmf": "NIST AI RMF", "cis_controls": "CIS CSC",
    "csa_ccm_v4": "CSA CCM", "cobit": "COBIT", "dora": "DORA", "nis2": "NIS2",
    "mas_trm": "MAS TRM", "sama_csf": "SAMA CSF", "swift_cscf": "SWIFT CSCF",
    "hitrust_csf": "HITRUST", "adhics": "ADHICS", "doh_adhie_policy": "DoH ADHIE",
    "qcb_technology_risks": "QCB", "sbp_cloud": "SBP Cloud", "sbp_etgrmf": "SBP ETGRMF",
    "sbp_internet_banking": "SBP Internet Banking", "sl_csf": "SL CSF",
    "pisf_2026": "PISF 2026", "ndmo": "NDMO", "ksa_pdp_transfer": "KSA PDP Transfer",
    "aramco_ccc": "Aramco CCC", "sabic_cybertrust": "SABIC CyberTrust", "sox": "SOX",
}

router = APIRouter(prefix="/automation/soc2", tags=["SOC2 Automation"])

# Framework-aware control-library reads (SOC 2, ISO 27001, GDPR). They share the
# SOC 2 automated-check engine on `router` below: there is one plugin pool (AWS
# quantitative + SaaS connectors) indexed by SOC 2 criteria. Each framework has
# its own control library + requirements under seed_data/automation/<framework>/,
# plus a crosswalk.json mapping its criteria to the SOC 2 criteria the shared
# checks are indexed by — so the same checks light up across every framework.
lib_router = APIRouter(prefix="/automation/{framework}", tags=["Automation Frameworks"])
# One common control library (Probo mitigations) whose controls each carry their
# requirement mappings across SOC 2 + ISO 27001 + GDPR — the unified view.
common_router = APIRouter(prefix="/automation/common", tags=["Automation Common Controls"])

_require_scan_perm = require_tenant_permission("compliance:scan:execute")

_AUTOMATION_DATA = Path(__file__).resolve().parents[2] / "seed_data" / "automation"

# framework key -> display metadata. The seed sub-directory name == the key.
FRAMEWORKS: Dict[str, Dict[str, str]] = {
    "soc2": {"label": "SOC 2", "catalog_version": "SOC2_TSC_2017", "criteria_label": "Trust Services Criteria"},
    "iso27001": {"label": "ISO 27001 (2022)", "catalog_version": "ISO_IEC_27001_2022", "criteria_label": "Clauses & Annex A controls"},
    "gdpr": {"label": "GDPR", "catalog_version": "GDPR_2016_679", "criteria_label": "Articles"},
}


def _fw(framework: str) -> Dict[str, str]:
    meta = FRAMEWORKS.get(framework)
    if not meta:
        raise HTTPException(404, f"Unknown framework '{framework}'. Expected one of: {', '.join(FRAMEWORKS)}")
    return meta


def _read_json(framework: str, name: str) -> Any:
    try:
        return json.loads((_AUTOMATION_DATA / framework / name).read_text(encoding="utf-8"))
    except FileNotFoundError:
        return []
    except Exception:  # noqa: BLE001
        logger.exception("could not load automation data file %s/%s", framework, name)
        return []


def _control_criteria_map(framework: str) -> Dict[str, List[str]]:
    """template_code (GRC-04) -> sorted unique framework criteria codes."""
    out: Dict[str, List[str]] = {}
    for row in _read_json(framework, "template_requirements.json"):
        code = row.get("template_code")
        key = (row.get("requirement_key") or "").split(":", 1)[-1]
        if code and key:
            bucket = out.setdefault(code, [])
            if key not in bucket:
                bucket.append(key)
    for code in out:
        out[code].sort()
    return out


def _load_control_library(framework: str) -> Dict[str, Any]:
    meta = _fw(framework)
    crit = _control_criteria_map(framework)
    controls = []
    for t in _read_json(framework, "control_templates.json"):
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
    return {"framework": meta["label"], "catalog_version": meta["catalog_version"], "controls": controls}


def _load_criteria(framework: str) -> List[Dict[str, Any]]:
    """The framework's requirements (SOC 2 TSC / ISO clauses+Annex A / GDPR articles)."""
    return _read_json(framework, "requirements.json")


def _load_crosswalk(framework: str) -> Dict[str, List[str]]:
    """Framework criterion code -> SOC 2 criteria the shared checks are indexed by.
    Empty for SOC 2 itself (identity mapping)."""
    data = _read_json(framework, "crosswalk.json")
    return data if isinstance(data, dict) else {}


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


def _checks_for_control(db: Session, control_codes: List[str]) -> List[Dict[str, Any]]:
    """Plugins bound to this control, carrying ONLY the checks that name one of its codes.

    A connector plugin is indexed under the UNION of its checks' SOC 2 codes, so binding
    at plugin granularity credits every check in the connector to every code it touches:
    a DigitalOcean backup check and a DigitalOcean firewall check become interchangeable,
    and a control that maps to only one of those codes inherits both. Filtering to the
    intersection is what makes checks_count, sub_type and the roll-up mean anything.
    """
    wanted = set(control_codes or [])
    if not wanted:
        return []
    plugins = (
        db.query(CompliancePlugin)
        .filter(
            CompliancePlugin.benchmark.in_([BENCHMARK, CONNECTOR_BENCHMARK]),
            CompliancePlugin.enabled.is_(True),
        )
        .all()
    )
    out: List[Dict[str, Any]] = []
    for p in plugins:
        if p.benchmark == CONNECTOR_BENCHMARK:
            provider = (p.check_definition or {}).get("provider")
            cdef = CONNECTOR_CHECKS.get(provider) or {}
            matched = [c for c in cdef.get("checks", []) if wanted & set(c.get("controls") or [])]
            if not matched:
                continue
            out.append({"plugin": p, "provider": provider, "checks": matched})
        else:
            if p.rule_id in wanted:
                out.append({"plugin": p, "provider": None, "checks": []})
    return out


def _status_from_run(run, check_ids: set, control_codes: List[str]) -> str:
    """The status of ONE control from ONE run, using only that control's findings.

    The run-level status is the connector's verdict across every check it ran, so
    inheriting it makes one failing item mark every control the connector touches.
    A control's status must come from the findings that name its own checks or its
    own codes — otherwise a single personal GitHub account without 2FA marks dozens
    of unrelated controls, including key management and network segmentation, failed.
    """
    raw = getattr(run, "raw_output", None) or {}
    findings = raw.get("findings") or []
    wanted = set(control_codes or [])
    mine = [
        f for f in findings
        if (f.get("check") in check_ids) or (wanted & set(f.get("control_codes") or []))
    ]
    if not mine:
        return "not_run"
    statuses = {f.get("status") for f in mine}
    if "fail" in statuses:
        return "failed"
    if "error" in statuses:
        return "error"
    if "pass" in statuses:
        return "passed"
    return "not_run"


def _linked_checks_for(db: Session, tenant_id: int, control_codes: List[str]):
    """(checks payload, per-control statuses) for a control, scoped to its own codes."""
    bound = _checks_for_control(db, control_codes)
    if not bound:
        return [], []
    latest = _latest_runs_by_plugin(db, tenant_id, [b["plugin"].id for b in bound])
    linked, statuses = [], []
    for b in bound:
        pl = b["plugin"]
        run = latest.get(pl.id)
        ids = {c.get("id") for c in b["checks"]}
        st = _status_from_run(run, ids, control_codes) if run else "not_run"
        statuses.append(st)
        linked.append({
            "plugin_key": pl.plugin_key, "id": pl.id, "title": pl.title,
            "severity": pl.severity, "seeded": True,
            "source": "connector" if pl.benchmark == CONNECTOR_BENCHMARK else "aws",
            "checks_matched": len(b["checks"]),
            "control_status": st,
            "last_run": _run_out(run) if run else None,
        })
    return linked, statuses


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


# Full Steampipe connector universe for the discovery catalog (data file, ~118).
_STEAMPIPE_CATALOG_PATH = (
    Path(__file__).resolve().parents[2] / "seed_data" / "evidence" / "steampipe_catalog.json"
)
try:
    _STEAMPIPE_CATALOG: Dict[str, Any] = json.loads(_STEAMPIPE_CATALOG_PATH.read_text(encoding="utf-8"))
except Exception:  # pragma: no cover - catalog is optional
    _STEAMPIPE_CATALOG = {}

# Generic "what this collects" copy for catalog-only (not-yet-wired) connectors,
# keyed by category. Implemented connectors derive their syncs from real checks.
_GENERIC_SYNCS = {
    "cloud": ["Accounts & projects", "IAM & access", "Resource configuration", "Encryption & logging"],
    "identity": ["Users & groups", "MFA enrollment", "SSO & app assignments", "Deprovisioning"],
    "security": ["Findings & alerts", "Coverage & agents", "Policy configuration"],
    "scm": ["Repositories", "Branch protection", "Members & access", "CI/CD settings"],
    "observability": ["Monitors & alerts", "Users & roles", "Retention settings"],
    "data": ["Users & roles", "Access grants", "Encryption settings"],
    "productivity": ["Users & members", "Roles & permissions", "Audit configuration"],
    "comms": ["Users & members", "Access & retention", "Admin settings"],
    "email": ["Domains & auth (SPF/DKIM)", "Suppression & logs"],
    "hr": ["Employee roster", "Onboarding & offboarding"],
    "mdm": ["Enrolled devices", "Disk encryption", "OS & patch compliance"],
    "ai": ["API keys & members", "Usage & access"],
    "payments": ["Users & roles", "API keys", "Webhook configuration"],
    "other": ["Users & access", "Configuration", "Audit logs"],
}


def _humanize_syncs(provider: str, category: str) -> List[str]:
    """What an implemented connector collects, from its real check resources."""
    cdef = CONNECTOR_CHECKS.get(provider) or {}
    names = [str(r.get("name", "")).replace("_", " ").strip() for r in cdef.get("resources", [])]
    syncs = [n[:1].upper() + n[1:] for n in names if n]
    return syncs or _GENERIC_SYNCS.get(category, _GENERIC_SYNCS["other"])


@router.get("/catalog")
def connector_catalog(db: Session = Depends(get_db), current_user: GRCUser = Depends(require_auth)):
    """The whole connector universe: the connectors this platform can collect
    from today (wired to the live_api evidence engine, with connection status),
    plus the full Steampipe plugin catalog as discovery/roadmap entries."""
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
    entries: List[Dict[str, Any]] = []
    implemented = set()
    for m in provider_meta():
        p = m["provider"]
        implemented.add(p)
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
        entries.append({
            "id": p,
            "name": m["label"],
            "category": m["category"],
            "categories": [m["category"]],
            "provider": p,
            "supported": True,
            "control_codes": all_control_codes(p),
            "syncs": _humanize_syncs(p, m["category"]),
            "connected": bool(c),
            "connection_id": c.id if c else None,
            "last_run": last,
            "steampipe_plugin": _STEAMPIPE_CATALOG.get(p, {}).get("steampipe_plugin", p),
        })
    for key, meta in _STEAMPIPE_CATALOG.items():
        if key in implemented:
            continue
        cat = meta.get("category", "other")
        entries.append({
            "id": key,
            "name": meta.get("label", key.title()),
            "category": cat,
            "categories": [cat],
            "provider": None,
            "supported": False,
            "control_codes": [],
            "syncs": _GENERIC_SYNCS.get(cat, _GENERIC_SYNCS["other"]),
            "connected": False,
            "connection_id": None,
            "last_run": None,
            "steampipe_plugin": meta.get("steampipe_plugin", key),
        })
    entries.sort(key=lambda e: (not e["supported"], e["name"].lower()))
    return {
        "connectors": entries,
        "counts": {
            "total": len(entries),
            "supported": sum(1 for e in entries if e["supported"]),
            "connected": sum(1 for e in entries if e["connected"]),
            "catalog": sum(1 for e in entries if not e["supported"]),
        },
    }


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


@lib_router.get("/controls")
def list_controls(
    framework: str,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """Control library for the framework with per-control automated-check status.
    Each control maps to framework criteria; its linked checks = every shared SOC 2
    automated check (AWS quantitative + SaaS connector) covering any of those
    criteria — resolved through the framework crosswalk — latest run aggregated."""
    _fw(framework)
    tenant_id = get_user_primary_tenant(current_user, db)
    lib = _load_control_library(framework)
    crosswalk = _load_crosswalk(framework)
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
            # SOC 2 has no crosswalk (identity); ISO/GDPR map their criterion to
            # the SOC 2 criteria the shared checks are indexed by.
            for sc in crosswalk.get(code, [code]):
                for p in by_code.get(sc, []):
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
        "framework": lib.get("framework"),
        "framework_key": framework,
        "catalog_version": lib.get("catalog_version"),
        "seeded_plugin_count": sum(c["checks_count"] for c in out),
        "controls": controls_out,
    }


@lib_router.get("/criteria")
def list_criteria(
    framework: str,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """The framework's requirements — SOC 2 Trust Services Criteria / ISO 27001
    clauses + Annex A controls / GDPR articles. Powers the Requirements tab."""
    meta = _fw(framework)
    criteria = _load_criteria(framework)
    return {"framework": meta["label"], "framework_key": framework,
            "criteria_label": meta["criteria_label"], "count": len(criteria), "criteria": criteria}


@common_router.get("/controls")
def list_common_controls(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """The common control library, served from the SCF catalog.

    One canonical control set; each control lists the requirements it discharges
    across every framework we support (via grc_scf_mapping) rather than the three
    the Probo library covered. Falls back to the legacy Probo library for a tenant
    whose SCF catalog has not been imported, so this never 500s mid-rollout.
    """
    tenant_id = get_user_primary_tenant(current_user, db)
    release = (
        db.query(SCFRelease)
        .filter(SCFRelease.import_status == "ready", SCFRelease.is_current.is_(True))
        .first()
    )
    if release is None:
        return _legacy_common_controls(db, tenant_id)

    # Crosswalk: only OUR framework slugs (provenance resolver|ai). SCF's own 249
    # source keys are the upstream catalogue, not what a tenant is assessed against.
    reqs: Dict[str, Dict[str, List[Dict[str, Any]]]] = defaultdict(lambda: defaultdict(list))
    fw_seen: set = set()
    ai_slugs: set = set()
    for scf_id, slug, code, prov in (
        db.query(SCFMapping.scf_id, SCFMapping.source_slug,
                 SCFMapping.requirement_code, SCFMapping.provenance)
        .filter(SCFMapping.release_id == release.id,
                SCFMapping.provenance.in_(("resolver", "ai")))
        .all()
    ):
        bucket = reqs[scf_id][slug]
        if len(bucket) < 12:                      # the table renders 6 + overflow
            bucket.append({"code": code, "name": code})
        fw_seen.add(slug)
        if prov == "ai":
            ai_slugs.add(slug)

    # Checks still reach a control through the SOC 2 criteria it discharges, but only
    # the individual checks naming those criteria count — not the whole connector.

    rows = (
        db.query(SCFControl.scf_id, SCFControl.name, SCFControl.domain_name,
                 SCFControl.domain_identifier, SCFControl.pptdf, SCFControl.weight,
                 SCFControl.is_material, SCFControl.ao_count, SCFControl.sort_key)
        .filter(SCFControl.release_id == release.id)
        .order_by(SCFControl.sort_key)
        .all()
    )

    out: List[Dict[str, Any]] = []
    categories: set = set()
    for scf_id, name, domain, dom_id, pptdf, weight, material, ao_count, _sk in rows:
        if domain:
            categories.add(domain)
        req = {k: v for k, v in (reqs.get(scf_id) or {}).items() if v}
        soc2_codes = [r["code"] for r in req.get("soc2", [])]
        linked, statuses = _linked_checks_for(db, tenant_id, soc2_codes)
        out.append({
            "control_id": scf_id,
            "canonical_key": scf_id,
            "title": name,
            "description": None,
            "category": domain,
            "domain": dom_id,
            "importance": "material" if material else None,
            "sub_type": "Automated" if linked else "Manual",
            "pptdf": pptdf,
            "weight": weight,
            "ao_count": ao_count,
            "frameworks": sorted(req.keys()),
            "requirements": req,
            "requirement_count": sum(len(v) for v in req.values()),
            "checks_count": len(linked),
            "overall_status": _aggregate_status(statuses) if linked else "manual",
            "checks": linked,
        })

    return {
        "framework": "SCF " + release.version,
        "source": "scf",
        "count": len(out),
        "categories": sorted(x for x in categories if x),
        # data-driven, so a newly crosswalked framework appears with no code change
        "frameworks": [
            {"key": s, "label": _FW_LABELS.get(s, s.replace("_", " ").title()),
             "authored": s in ai_slugs,
             # every requirement accounted for, not just the mapped ones
             "coverage": (_disposition_index().get("frameworks", {}).get(s) or {}).get("counts"),
             "requirement_total": (_disposition_index().get("frameworks", {}).get(s) or {}).get("total")}
            for s in sorted(fw_seen)
        ],
        "seeded_plugin_count": sum(c["checks_count"] for c in out),
        "controls": out,
    }


@common_router.get("/coverage")
def requirement_coverage(
    framework: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """Every requirement in every framework, and what accounts for it.

    Reporting "3,703 of 3,892 mapped" leaves 189 requirements unexplained, which
    is the first thing an assessor asks about. Most are not gaps: they bind the
    regulator, the exchange operator or a supervisory authority, and no control
    the assessed organisation implements can discharge them. Each unmapped
    requirement carries its disposition, the rule that classified it and the
    written reason, so the shortfall is auditable rather than asserted.
    """
    doc = _disposition_index()
    if not doc:
        raise HTTPException(503, "Requirement dispositions have not been built for this release")

    # How many of a framework's mapped requirements were matched on the code
    # itself, and how many were inferred across a granularity difference. A
    # framework can read 100% mapped while every row is an inference — COBIT
    # does — and that is not the same claim.
    inferred: Dict[str, int] = {}
    release = (
        db.query(SCFRelease)
        .filter(SCFRelease.import_status == "ready", SCFRelease.is_current.is_(True))
        .order_by(desc(SCFRelease.imported_at))
        .first()
    )
    if release is not None:
        for slug, n in (
            db.query(SCFMapping.source_slug,
                     func.count(distinct(SCFMapping.requirement_code)))
            .filter(SCFMapping.release_id == release.id,
                    SCFMapping.provenance == "resolver",
                    SCFMapping.match_mode != "exact")
            .group_by(SCFMapping.source_slug)
            .all()
        ):
            inferred[slug] = int(n)

    reqs = _requirement_index()
    rows: List[Dict[str, Any]] = []
    for slug, fw in sorted(doc.get("frameworks", {}).items()):
        if framework and slug != framework:
            continue
        counts = fw.get("counts") or {}
        total = fw.get("total") or 0
        idx = reqs.get(slug) or {}
        unmapped = []
        for code, d in sorted((fw.get("requirements") or {}).items()):
            meta = idx.get(code) or {}
            unmapped.append({
                "code": code,
                "reference": meta.get("reference") or code,
                "title": meta.get("title"),
                "disposition": d.get("disposition"),
                "rule": d.get("rule"),
                "reason": d.get("reason") or None,
            })
        rows.append({
            "key": slug,
            "label": _FW_LABELS.get(slug, slug.replace("_", " ").title()),
            "total": total,
            "counts": counts,
            "mapped_pct": round(counts.get("mapped", 0) / total * 100, 1) if total else 0.0,
            # everything except `pending` is accounted for, mapped or not
            "accounted_pct": round((total - counts.get("pending", 0)) / total * 100, 1) if total else 0.0,
            # mapped, but by parent/child rollup rather than on the code itself
            "inferred": inferred.get(slug, 0),
            "unmapped": unmapped,
        })

    grand = doc.get("total") or 0
    counts = doc.get("counts") or {}
    return {
        "generated": doc.get("generated"),
        "total": grand,
        "counts": counts,
        "labels": DISPOSITION_LABELS,
        "mapped_pct": round(counts.get("mapped", 0) / grand * 100, 1) if grand else 0.0,
        "accounted_pct": round((grand - counts.get("pending", 0)) / grand * 100, 1) if grand else 0.0,
        "frameworks": rows,
    }


def _legacy_common_controls(db: Session, tenant_id: int) -> Dict[str, Any]:
    """Pre-SCF Probo library. Kept only until every tenant has an SCF release."""
    data = _read_json("common", "controls.json")
    controls = data.get("controls", []) if isinstance(data, dict) else []
    by_code = _plugins_by_control_code(db)
    all_ids = {p.id for ps in by_code.values() for p in ps}
    latest = _latest_runs_by_plugin(db, tenant_id, list(all_ids))

    out: List[Dict[str, Any]] = []
    categories: set = set()
    for c in controls:
        if c.get("category"):
            categories.add(c["category"])
        linked: List[Dict[str, Any]] = []
        statuses: List[str] = []
        seen: set = set()
        for code in c.get("soc2_criteria") or []:
            for p in by_code.get(code, []):
                if p.id in seen:
                    continue
                seen.add(p.id)
                run = latest.get(p.id)
                if run:
                    statuses.append(run.status)
                linked.append({
                    "plugin_key": p.plugin_key, "id": p.id, "title": p.title,
                    "severity": p.severity, "seeded": True,
                    "source": "connector" if p.benchmark == CONNECTOR_BENCHMARK else "aws",
                    "last_run": _run_out(run) if run else None,
                })
        req = c.get("requirements") or {}
        out.append({
            "control_id": c.get("code"), "canonical_key": c.get("canonical_key"),
            "title": c.get("title"), "description": c.get("description"),
            "guidance": c.get("guidance"), "category": c.get("category"),
            "domain": c.get("category"), "importance": c.get("importance"),
            "sub_type": c.get("sub_type"), "frameworks": c.get("frameworks") or [],
            "requirements": req,
            "requirement_count": sum(len(req.get(k) or []) for k in ("soc2", "iso27001", "gdpr")),
            "checks_count": len(linked),
            "overall_status": _aggregate_status(statuses) if linked else "manual",
            "checks": linked,
        })
    return {
        "framework": "Common Controls", "source": "probo", "count": len(out),
        "categories": sorted(x for x in categories if x),
        "frameworks": [{"key": k, "label": l, "authored": False}
                       for k, l in (("soc2", "SOC 2"), ("iso27001", "ISO 27001"), ("gdpr", "GDPR"))],
        "seeded_plugin_count": sum(c["checks_count"] for c in out), "controls": out,
    }


# ── requirement dispositions ─────────────────────────────────────────────────
# A requirement with no control is not automatically a gap. Most of the ones we
# cannot map bind a different party — the sector regulator, the health-exchange
# operator, a supervisory authority — and no control the assessed organisation
# implements can discharge them. `dispositions.json` records which, with the
# reason, so coverage can be reported as fully accounted for rather than as an
# unexplained shortfall. Built by grc.tools.build_scf_dispositions.

DISPOSITION_LABELS = {
    "mapped": "Mapped to a control",
    "other_party": "Obligation of another party",
    "out_of_scope": "Outside the control catalogue",
    "pending": "Not yet assessed",
}


@lru_cache(maxsize=1)
def _disposition_index() -> Dict[str, Any]:
    """slug -> {total, counts, requirements{code: {disposition, rule, reason}}}.

    Only non-mapped requirements are listed: a code absent from `requirements`
    is mapped. Missing file is not fatal — coverage simply reports no
    dispositions rather than the whole control library failing to load.
    """
    path = Path(__file__).resolve().parents[2] / "seed_data" / "scf" / "dispositions.json"
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001
        logger.exception("dispositions.json unreadable — coverage will omit dispositions")
        return {}


# ── requirement text lookup ──────────────────────────────────────────────────
# The crosswalk stores identifiers only. The detail view needs the actual
# requirement wording, which lives in the framework libraries, so we index them
# once per process: framework slug -> control_id -> {reference, title, text}.

@lru_cache(maxsize=1)
def _requirement_index() -> Dict[str, Dict[str, Dict[str, Any]]]:
    fw_dir = Path(__file__).resolve().parents[2] / "seed_data" / "frameworks"
    reg_path = Path(__file__).resolve().parents[2] / "seed_data" / "scf" / "crosswalk_registry.json"
    try:
        registry = json.loads(reg_path.read_text(encoding="utf-8"))["frameworks"]
    except Exception:  # noqa: BLE001
        logger.exception("crosswalk registry unreadable — requirement text unavailable")
        return {}
    out: Dict[str, Dict[str, Dict[str, Any]]] = {}
    for entry in registry:
        path = fw_dir / (entry.get("file") or "")
        if not path.exists():
            continue
        try:
            doc = json.loads(path.read_text(encoding="utf-8"))
        except Exception:  # noqa: BLE001
            logger.exception("framework library unreadable: %s", path.name)
            continue
        meta = doc.get("metadata") or {}
        # CRITICAL: index by the SAME field the crosswalk resolver joined on.
        # iso_42001's control_id is a local 1..n counter while the citable clause
        # lives in original_reference — keying on the wrong one silently renders a
        # different requirement's text under the right code.
        join_field = entry.get("join_field") or "control_id"
        idx: Dict[str, Dict[str, Any]] = {}
        for c in doc.get("controls") or []:
            cid = str(c.get(join_field) or c.get("control_id") or "").strip()
            if not cid:
                continue
            # description is the normalised summary; full_text the verbatim clause.
            # Prefer the longer of the two — some libraries populate only one.
            desc, full = c.get("description") or "", c.get("full_text") or ""
            row = {
                "reference": c.get("original_reference") or c.get("control_id") or cid,
                "title": c.get("title") or c.get("name"),
                "text": full if len(full) > len(desc) else desc,
                "domain": c.get("domain"),
                "section": c.get("parent_section"),
            }
            idx.setdefault(cid, row)
            alt = str(c.get("control_id") or "").strip()
            if alt and alt != cid:
                idx.setdefault(alt, row)
        out[entry["slug"]] = idx
        out.setdefault("__versions__", {})[entry["slug"]] = meta.get("version")
    return out


# ── implementation guidance + recommended evidence ───────────────────────────

@lru_cache(maxsize=1)
def _scf_extras() -> Dict[str, Any]:
    """cmm_levels + ERL, loaded once. Both ship in the seed artifacts."""
    base = Path(__file__).resolve().parents[2] / "seed_data" / "scf"
    out: Dict[str, Any] = {"cmm": {}, "erl": {}, "erl_links": {}}
    try:
        out["cmm"] = json.loads((base / "cmm_levels.json").read_text(encoding="utf-8"))["cmm_levels"]
    except Exception:  # noqa: BLE001
        logger.exception("cmm_levels.json unreadable")
    try:
        erl = json.loads((base / "erl.json").read_text(encoding="utf-8"))
        out["erl"] = {a["erl_id"]: a for a in erl.get("artifacts", [])}
        links: Dict[str, List[str]] = defaultdict(list)
        for erl_id, scf_id in erl.get("links", []):
            links[scf_id].append(erl_id)
        out["erl_links"] = links
    except Exception:  # noqa: BLE001
        logger.exception("erl.json unreadable")
    return out


@lru_cache(maxsize=1)
def _consolidated_evidence() -> Dict[str, Any]:
    """Per-control evidence sets already merged into one artifact per real document.

    The raw union of every linked framework's asks is unusable — GOV-02 alone drew
    450 entries, 95% of which are the same handful of documents in different words.
    These sets collapse that ~10x while citing every framework that wants each one.
    """
    p = Path(__file__).resolve().parents[2] / "seed_data" / "scf" / "evidence_consolidated.json"
    try:
        return json.loads(p.read_text(encoding="utf-8")).get("controls", {})
    except Exception:  # noqa: BLE001 — optional artifact
        return {}


@lru_cache(maxsize=1)
def _framework_evidence_index() -> Dict[str, Dict[str, List[Dict[str, Any]]]]:
    """framework slug -> requirement code -> its own evidence asks.

    Libraries store these either as objects ({name, description, filetype}) or as
    bare strings; both are normalised to the object form.
    """
    fw_dir = Path(__file__).resolve().parents[2] / "seed_data" / "frameworks"
    reg_path = Path(__file__).resolve().parents[2] / "seed_data" / "scf" / "crosswalk_registry.json"
    out: Dict[str, Dict[str, List[Dict[str, Any]]]] = {}
    try:
        registry = json.loads(reg_path.read_text(encoding="utf-8"))["frameworks"]
    except Exception:  # noqa: BLE001
        return out
    for entry in registry:
        path = fw_dir / (entry.get("file") or "")
        if not path.exists():
            continue
        try:
            doc = json.loads(path.read_text(encoding="utf-8"))
        except Exception:  # noqa: BLE001
            continue
        join = entry.get("join_field") or "control_id"
        idx: Dict[str, List[Dict[str, Any]]] = {}
        for c in doc.get("controls") or []:
            key = str(c.get(join) or c.get("control_id") or "").strip()
            items = c.get("evidence_requirements") or []
            norm: List[Dict[str, Any]] = []
            for it in items:
                if isinstance(it, dict):
                    norm.append({"name": it.get("name"), "description": it.get("description"),
                                 "filetype": it.get("filetype")})
                elif isinstance(it, str) and it.strip():
                    norm.append({"name": it.strip(), "description": None, "filetype": None})
            if key and norm:
                idx.setdefault(key, norm)
        out[entry["slug"]] = idx
    return out


def _build_guidance(ctl, req_groups: List[Dict[str, Any]], linked_checks: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Implementation guidance and a de-duplicated recommended-evidence set.

    Evidence is grouped by HOW it is obtained, which is what determines who does the
    work: automated (a connector asserts it), manual (someone produces an artifact).
    A control is 'hybrid' when both exist — the automated part never covers the whole
    control, so the manual half is still required.
    """
    extras = _scf_extras()
    fw_ev = _framework_evidence_index()

    automated = [{
        "check_id": ch.get("plugin_key"),
        "connector": (ch.get("plugin_key") or "").split("__")[-1],
        "title": ch.get("title"),
        "last_run": ch.get("last_run"),
    } for ch in linked_checks]

    # SCF's own evidence request list for this control — the artifact to ask for.
    manual: List[Dict[str, Any]] = []
    seen: set = set()
    for erl_id in extras["erl_links"].get(ctl.scf_id, []):
        art = extras["erl"].get(erl_id)
        if not art:
            continue
        key = (art.get("artifact") or erl_id).strip().lower()
        if key in seen:
            continue
        seen.add(key)
        manual.append({
            "source": "SCF evidence request list", "ref": erl_id,
            "name": art.get("artifact"), "description": art.get("description"),
            "area": art.get("area_of_focus"), "filetype": None,
        })

    # what the LINKED framework requirements themselves ask for, de-duplicated by
    # name so N frameworks asking for the same policy produce one line, not N
    for g in req_groups:
        idx = fw_ev.get(g["framework"]) or {}
        for it in g["items"]:
            for ev in idx.get(it["code"], []):
                nm = (ev.get("name") or "").strip()
                if not nm:
                    continue
                key = nm.lower()
                if key in seen:
                    continue
                seen.add(key)
                manual.append({
                    "source": g["label"], "ref": it["code"], "name": nm,
                    "description": ev.get("description"), "area": None,
                    "filetype": ev.get("filetype"),
                })

    # A consolidated set, where one exists, is what the user should see: the raw
    # union is the same documents restated by every framework.
    consolidated = _consolidated_evidence().get(ctl.scf_id)

    if automated and manual:
        mode = "hybrid"
    elif automated:
        mode = "automated"
    else:
        mode = "manual"

    cmm = extras["cmm"].get(ctl.scf_id) or {}
    # Level 3 "Well Defined" is the target for a compliance obligation, so it leads.
    target = next((v for k, v in cmm.items() if "Level 3" in k), None)
    return {
        "assurance_mode": mode,
        "implementation": {
            "target_maturity": target,               # verbatim SCF
            "maturity_levels": cmm,                  # verbatim SCF
            "solutions": ctl.solutions or {},        # verbatim SCF, per firm size
            "conformity_cadence": ctl.conformity_cadence,
            "pptdf": ctl.pptdf,
        },
        "evidence": {
            "automated": automated,
            "manual": manual,
            "automated_count": len(automated),
            "manual_count": len(manual),
            "from_frameworks": len({m["source"] for m in manual if m["source"] != "SCF evidence request list"}),
            # present only where the asks have been merged; the UI prefers this
            "consolidated": (consolidated or {}).get("artifacts"),
            "consolidated_from": (consolidated or {}).get("input_count"),
        },
    }


@common_router.get("/controls/{scf_id}")
def get_common_control(
    scf_id: str,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """One control, with every framework requirement it discharges — code, the
    framework's own reference, title and full text — plus how that mapping was
    established, so a reviewer can trace any row back to its source."""
    tenant_id = get_user_primary_tenant(current_user, db)
    release = (
        db.query(SCFRelease)
        .filter(SCFRelease.import_status == "ready", SCFRelease.is_current.is_(True))
        .first()
    )
    if release is None:
        raise HTTPException(404, "SCF catalog not provisioned for this tenant")

    ctl = (
        db.query(SCFControl)
        .filter(SCFControl.release_id == release.id, SCFControl.scf_id == scf_id)
        .first()
    )
    if ctl is None:
        raise HTTPException(404, f"Unknown control '{scf_id}'")

    idx = _requirement_index()
    versions = idx.get("__versions__", {})

    groups: Dict[str, Dict[str, Any]] = {}
    for slug, code, prov, conf, mode, pivot in (
        db.query(SCFMapping.source_slug, SCFMapping.requirement_code,
                 SCFMapping.provenance, SCFMapping.confidence,
                 SCFMapping.match_mode, SCFMapping.pivot_via_slug)
        .filter(SCFMapping.release_id == release.id,
                SCFMapping.scf_id == scf_id,
                SCFMapping.provenance.in_(("resolver", "ai")))
        .all()
    ):
        g = groups.setdefault(slug, {
            "framework": slug,
            "label": _FW_LABELS.get(slug, slug.replace("_", " ").title()),
            "version": versions.get(slug),
            "provenance": prov,
            "pivot_via": pivot,
            "items": [],
            "_seen": set(),
        })
        if code in g["_seen"]:
            continue
        g["_seen"].add(code)
        meta = (idx.get(slug) or {}).get(code) or {}
        g["items"].append({
            "code": code,
            "reference": meta.get("reference") or code,
            "title": meta.get("title"),
            "text": meta.get("text"),
            "domain": meta.get("domain"),
            # How the code was matched, and how far that can be trusted. `exact`
            # is code identity; `parent`/`child` are structural inferences across
            # a granularity difference — fine for navigation, not for assurance
            # without review. Carried per item because one framework group can
            # hold a mix.
            "match_mode": mode or "exact",
            "confidence": float(conf) if conf is not None else None,
            # an identifier we could not resolve to library text is shown as such,
            # never silently rendered as if the code were the requirement
            "resolved": bool(meta),
        })

    req_groups = []
    for g in groups.values():
        g.pop("_seen", None)
        g["items"].sort(key=lambda i: i["code"])
        g["count"] = len(g["items"])
        g["unresolved"] = sum(1 for i in g["items"] if not i["resolved"])
        modes = {i["match_mode"] for i in g["items"]}
        g["match_modes"] = sorted(modes)
        # inferred across a granularity difference, not matched on the code itself
        g["inferred_count"] = sum(1 for i in g["items"] if i["match_mode"] != "exact")
        # the group is only as good as its weakest row, not its first one
        confs = [i["confidence"] for i in g["items"] if i["confidence"] is not None]
        g["confidence"] = min(confs) if confs else None
        req_groups.append(g)
    # SCF-published mappings first: an audit of 671 links found them 73%
    # defensible against 38% for our authored ones, so the reliable evidence
    # leads and the weaker material sits below it.
    req_groups.sort(key=lambda g: (g["provenance"] != "resolver", -g["count"], g["label"]))

    objectives = [{
        "ao_id": o.ao_id, "seq": o.seq, "objective": o.objective,
        "pptdf": o.pptdf, "rigor": o.rigor,
    } for o in (
        db.query(SCFObjective)
        .filter(SCFObjective.release_id == release.id, SCFObjective.scf_id == scf_id)
        .order_by(SCFObjective.seq)
        .all()
    )]

    soc2_codes = [i["code"] for g in req_groups if g["framework"] == "soc2" for i in g["items"]]
    linked, statuses = _linked_checks_for(db, tenant_id, soc2_codes)

    return {
        "control_id": ctl.scf_id,
        "title": ctl.name,
        "description": ctl.description,
        "control_question": ctl.control_question,
        "category": ctl.domain_name,
        "domain": ctl.domain_identifier,
        "pptdf": ctl.pptdf,
        "weight": ctl.weight,
        "is_material": bool(ctl.is_material),
        "conformity_cadence": ctl.conformity_cadence,
        "ao_count": ctl.ao_count,
        "sub_type": "Automated" if linked else "Manual",
        "checks_count": len(linked),
        "overall_status": _aggregate_status(statuses) if linked else "manual",
        "checks": linked,
        "objectives": objectives,
        **_build_guidance(ctl, req_groups, linked),
        "requirement_groups": req_groups,
        "requirement_count": sum(g["count"] for g in req_groups),
        "framework_count": len(req_groups),
        "release": release.version,
    }


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
