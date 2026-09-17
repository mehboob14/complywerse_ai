"""SOC 2 quantitative automation API.

Thin additive layer over compliance-plugins aws_readonly runner.
Mounted at /automation/soc2 — does not modify existing CIS routes.
"""
from __future__ import annotations

import json
import logging
import re
from collections import Counter, defaultdict, namedtuple
from datetime import datetime
from functools import lru_cache
from pathlib import Path
from types import SimpleNamespace
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import desc, distinct, func, or_
from sqlalchemy.orm import Session

from grc.models import (
    CompliancePlugin,
    CompliancePluginRun,
    ControlAssuranceSnapshot,
    ControlWorkEvidence,
    ControlWorkItem,
    CustomControlProfile,
    GRCUser,
    IntegrationConnection,
    NormalizedControl,
    SCFCheckResult,
    SCFControl,
    SCFControlState,
    SCFMapping,
    SCFMappingReview,
    SCFObjective,
    SCFRelease,
    get_db,
)
from grc.modules.automation.evidence_match import artifact_key
from grc.modules.scf import ownership as scf_own
from grc.modules.scf import custom_controls as scf_custom
from grc.modules.scf import record_links as scf_record_links
from grc.rich_audit import write_rich_audit_log
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
    provider_checks,
    all_control_codes,
    provider_meta,
    run_provider,
)
from grc.modules.compliance_plugins.runners.covers import (
    covers_for_check,
    scf_targets_from_covers,
)
from grc.modules.compliance_plugins.runners.connector_setup import (
    connector_setup, form_fields, missing_fields, normalize_domain,
)
from grc.modules.compliance_plugins.runners.explain import (
    check_title, connector_reads, connector_tests, explain_check,
)
from grc.modules.compliance_plugins.services.credentials import resolve_credentials_for_connection
from grc.modules.compliance_plugins.services.run_service import execute_plugin
from grc.crypto import encrypt_secret
from grc.modules.scf.scope_service import ensure_default_scope, get_applicable_scf_ids
from grc.modules.scf.registry import scf_keys_for_slug
from grc.modules.scf import risk_links as scf_risks
from grc.modules.scf import asset_links as scf_assets

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
# Seed / connectors / mapping review share the scan gate — same operators who
# run checks configure the automation plane. Evidence attach uses the evidence
# library edit permission so auditors without scan rights can still link files.
_require_evidence_edit = require_tenant_permission("evidence:evidence_library:edit")


def _require_risk_link_edit(
    current_user: GRCUser = Depends(require_auth),
    db: Session = Depends(get_db),
):
    """erm:risks:edit OR controls:control_library:edit (Stage E link writes)."""
    from grc.modules.vendor_risk.tpra.rbac import user_has_any_permission

    if user_has_any_permission(
        db, current_user, ("erm:risks:edit", "controls:control_library:edit")
    ):
        return True
    raise HTTPException(status_code=403, detail="Permission denied")


def _require_asset_link_edit(
    current_user: GRCUser = Depends(require_auth),
    db: Session = Depends(get_db),
):
    """assets:asset_inventory:edit OR controls:control_library:edit (Stage F)."""
    from grc.modules.vendor_risk.tpra.rbac import user_has_any_permission

    if user_has_any_permission(
        db,
        current_user,
        ("assets:asset_inventory:edit", "controls:control_library:edit"),
    ):
        return True
    raise HTTPException(status_code=403, detail="Permission denied")

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
    # above a passing sibling: if one collector could not collect, part of this
    # control is unasserted, and "passing" would overstate what we know
    if any(s == "collection_failed" for s in statuses):
        return "collection_failed"
    if any(s == "error" for s in statuses):
        return "error"
    if any(s in ("running", "pending") for s in statuses):
        return "running"
    # ranked above passed deliberately: a control with one stale assertion is not
    # a passing control, it is a control we can no longer vouch for in full
    if any(s == "expired" for s in statuses):
        return "expired"
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


def _connected_providers(db: Session, tenant_id: int) -> set:
    """Providers this tenant has actually configured.

    The connectors bound to a control are ALTERNATIVES, not a checklist: 53 of
    them claim CC6.1 because 53 systems can prove logical access, and no tenant
    runs 53. A provider the tenant has not configured is not a gap in their
    control — it is not in their estate, and letting it contribute `not_run`
    made a control whose one real collector passed report "partial".

    What remains is a conjunction over what they DO run: weak MFA in AWS is not
    excused by Okta passing, because both are in scope.
    """
    return {
        c.integration_type
        for c in db.query(IntegrationConnection.integration_type)
        .filter(IntegrationConnection.tenant_id == tenant_id,
                IntegrationConnection.is_active.is_(True))
        .all()
    }


# A plugin with no `provider` still needs something connected to run: the
# quantitative SOC 2 checks are boto3 calls and are as out of scope without an
# AWS account as a GitHub check is without GitHub. Scoping only the connector
# plugins left these contributing `not_run` for the same wrong reason.
_RUNNER_NEEDS = {"aws_readonly": {"aws_readonly", "aws"}}


def _plugin_in_scope(plugin, provider: Optional[str], connected: set) -> bool:
    if provider is not None:
        return provider in connected
    needs = _RUNNER_NEEDS.get(plugin.runner_type)
    return bool(needs & connected) if needs else True


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
            matched = [c for c in provider_checks(provider) if wanted & set(c.get("controls") or [])]
            if not matched:
                continue
            out.append({"plugin": p, "provider": provider, "checks": matched})
        else:
            if p.rule_id in wanted:
                out.append({"plugin": p, "provider": None, "checks": []})
    return out


# SCF publishes a reassessment cadence per control. A result older than its own
# window has stopped being evidence: the token may have been revoked, the bucket
# reopened, the reviewer left. Defaulting to Annual is the loosest of SCF's three
# windows, so an unspecified cadence never expires a result early.
_CADENCE_DAYS = {"Quarterly": 90, "Semi-Annual": 180, "Annual": 365}
# A collector that has not collected in a quarter is not a working collector,
# whatever its last verdict said.
COLLECTION_STALE_DAYS = 90


def _is_stale(run, cadence: Optional[str]) -> bool:
    at = getattr(run, "started_at", None)
    if at is None:
        return False
    return (datetime.utcnow() - at).days > _CADENCE_DAYS.get(cadence or "", 365)


def _status_from_run(run, check_ids: set, control_codes: List[str],
                     cadence: Optional[str] = None) -> str:
    """The status of ONE control from ONE run, using only that control's findings.

    The run-level status is the connector's verdict across every check it ran, so
    inheriting it makes one failing item mark every control the connector touches.
    A control's status must come from the findings that name its own checks or its
    own codes — otherwise a single personal GitHub account without 2FA marks dozens
    of unrelated controls, including key management and network segmentation, failed.
    """
    # The collector could not collect — a revoked scope, an expired secret, a
    # provider outage. That says nothing about the control, and reporting it as a
    # control failure is how a broken integration reads as a broken environment.
    if getattr(run, "status", None) == "error":
        return "collection_failed"
    raw = getattr(run, "raw_output", None) or {}
    findings = raw.get("findings") or []
    wanted = set(control_codes or [])
    mine = [
        f for f in findings
        if (f.get("check") in check_ids) or (wanted & set(f.get("control_codes") or []))
    ]
    if not mine:
        return "not_run"
    # A verdict older than the control's reassessment window is not a verdict any
    # more. Reporting it green is how a check that passed 400 days ago on a
    # since-revoked token keeps a control looking assured.
    if _is_stale(run, cadence):
        return "expired"
    statuses = {f.get("status") for f in mine}
    if "fail" in statuses:
        return "failed"
    if "error" in statuses:
        return "error"
    if "pass" in statuses:
        return "passed"
    return "not_run"


_SCF_RESULT_STATUS = {
    "pass": "passed",
    "fail": "failed",
    "error": "collection_failed",
    "not_run": "not_run",
}


def _status_from_scf_results(
    rows: List[Any],
    check_ids: set,
    now: Optional[datetime] = None,
) -> Optional[str]:
    """Aggregate latest SCFCheckResult per check_id. None → fall back to run."""
    if not rows or not check_ids:
        return None
    latest: Dict[str, Any] = {}
    for r in rows:
        cid = getattr(r, "check_id", None)
        if cid not in check_ids:
            continue
        prev = latest.get(cid)
        if prev is None or (getattr(r, "collected_at", None) or datetime.min) >= (
            getattr(prev, "collected_at", None) or datetime.min
        ):
            latest[cid] = r
    if not latest:
        return None
    stamp = now or datetime.utcnow()
    mapped: List[str] = []
    for r in latest.values():
        exp = getattr(r, "expires_at", None)
        if exp is not None and exp < stamp:
            mapped.append("expired")
            continue
        mapped.append(_SCF_RESULT_STATUS.get((getattr(r, "status", None) or ""), "not_run"))
    return _aggregate_status(mapped) if mapped else None


def _scf_results_for_control(
    db: Session,
    tenant_id: int,
    scf_id: str,
    check_ids: Optional[set] = None,
) -> List[Any]:
    """Latest-ish result rows for a control (and optionally its bound checks)."""
    q = db.query(SCFCheckResult).filter(
        SCFCheckResult.tenant_id == tenant_id,
        SCFCheckResult.scf_id == scf_id,
    )
    if check_ids:
        q = q.filter(SCFCheckResult.check_id.in_(sorted(check_ids)))
    return q.order_by(desc(SCFCheckResult.collected_at)).limit(500).all()


def _provider_of(check: Dict[str, Any]) -> Optional[str]:
    """Which connector a linked check belongs to.

    Connector plugins carry it in their key. The quantitative checks are boto3 calls
    with no provider of their own, and they are AWS whatever their key says.
    """
    key = check.get("plugin_key") or ""
    if check.get("source") == "aws" or "SOC2_QUANTITATIVE" in key:
        return "aws"
    return key.split("__", 1)[1] if "__" in key else None


_SUMMARY_RESOURCES = ("directory", "region", "account")


def _check_result(run_out: Optional[Dict[str, Any]], check_id: str) -> Optional[Dict[str, Any]]:
    """One check's verdict from its connector's latest run: status, the line that
    explains it, how many items it looked at, and which ones failed."""
    findings = ((run_out or {}).get("raw_output") or {}).get("findings") or []
    mine = [f for f in findings if f.get("check") == check_id]
    if not mine:
        return None
    summary = next((f for f in reversed(mine) if f.get("resource") in _SUMMARY_RESOURCES), mine[-1])
    return {
        "status": summary.get("status"),
        "detail": summary.get("detail"),
        "population": summary.get("population_size"),
        "tested": summary.get("tested_size"),
        "failing_items": [f.get("resource") for f in mine
                          if f is not summary and f.get("status") == "fail"][:10],
        "checked_at": (run_out or {}).get("started_at"),
    }


def _test_groups(linked: List[Dict[str, Any]], connected: set) -> List[Dict[str, Any]]:
    """The Tests tab, grouped the way a customer has to decide.

    A tenant runs one identity provider. Okta, Entra ID and Google Workspace are
    alternatives for the same evidence, so listing each as its own "Not run" test
    implies all three must be checked, which no tenant can satisfy and none should
    try to. Grouping by category turns 26 flat rows into "connect any one of these",
    and only the connected source's results are shown as results.
    """
    by_cat: Dict[str, Dict[str, Dict[str, Any]]] = defaultdict(dict)
    for chk in linked:
        p = _provider_of(chk)
        if not p:
            continue
        spec = PROVIDER_API.get(p) or {}
        slot = by_cat[spec.get("category") or "other"].setdefault(p, {
            "provider": p, "label": spec.get("label", p),
            "connected": p in connected, "checks": [],
        })
        slot["checks"].append(chk)

    for provs in by_cat.values():
        for row in provs.values():
            # One entry per check this control is bound to: what it does, in words,
            # and — once the source is connected — what it last found.
            row["tests"] = [
                {"id": cid, "title": check_title(row["provider"], cid),
                 "explain": explain_check(row["provider"], cid),
                 "result": _check_result(chk.get("last_run"), cid) if row["connected"] else None}
                for chk in row["checks"] for cid in (chk.get("check_ids") or [])
            ]

    groups = []
    for cat, provs in by_cat.items():
        rows = sorted(provs.values(), key=lambda x: (not x["connected"], -len(x["checks"]), x["label"]))
        live = [r for r in rows if r["connected"]]
        # A connected provider's verdict is the only one that means anything; an
        # unconnected one contributes nothing and is shown as an option, not a test.
        statuses = [c["control_status"] for r in live for c in r["checks"]]
        groups.append({
            "category": cat,
            "connected": bool(live),
            "status": _aggregate_status(statuses) if statuses else "connect_one",
            "providers": rows,
        })
    groups.sort(key=lambda g: (not g["connected"], -len(g["providers"]), g["category"]))
    return groups


@lru_cache(maxsize=1)
def _templated_artifact_ids() -> frozenset:
    """Catalogue artifacts that have an authored starter document.

    1,498 of 4,706 catalogue deliverables have none, so offering a download on
    every row would 404 a third of the time. artifact_content.json is 14.8 MB, so
    only its keys are kept.
    """
    p = Path(__file__).resolve().parents[2] / "seed_data" / "artifact_content.json"
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001 — optional artifact
        return frozenset()
    return frozenset(aid for fw in data.values() if isinstance(fw, dict) for aid in fw)


def _automatable_controls(db: Session, release_id: int) -> set:
    """Controls SCF itself says a machine could assess.

    Every assessment objective carries a PPTDF tag, and `Technology` is SCF's own
    judgement that the objective is about a system's configuration rather than a
    person's behaviour or a documented process. A control with at least one such
    objective is automatable in principle, whatever we have built.
    """
    return {
        s for (s,) in db.query(SCFObjective.scf_id)
        .filter(SCFObjective.release_id == release_id,
                SCFObjective.pptdf == "Technology")
        .distinct().all()
    }


def _coverage_for(bound: List[Dict[str, Any]], connected: set,
                  automatable: bool = False) -> Dict[str, Any]:
    """What could evidence this control, and what to do if nothing does yet.

    Connectors are grouped by category because that is the shape of the ask a
    customer can act on: "connect an identity provider" is a decision, "connect
    one of these 53 things" is a list. Within a category they are ranked by how
    many of this control's checks they actually contribute, so the provider that
    proves the most appears first rather than the one that sorts first.
    """
    cats: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    for b in bound:
        p = b.get("provider")
        if not p:                       # a non-connector plugin, nothing to connect
            continue
        cats[(PROVIDER_API.get(p) or {}).get("category") or "other"].append(
            {"provider": p, "label": (PROVIDER_API.get(p) or {}).get("label", p),
             "checks": len(b["checks"]), "connected": p in connected})
    options = [
        {"category": c,
         "providers": sorted(v, key=lambda x: (-x["checks"], x["provider"])),
         "connected": any(x["connected"] for x in v)}
        for c, v in cats.items()
    ]
    options.sort(key=lambda o: (not o["connected"], -len(o["providers"]), o["category"]))
    satisfying = sorted({p["provider"] for o in options for p in o["providers"] if p["connected"]})
    if satisfying:
        state = "covered"
    elif options:
        # actionable: this control CAN be proven, the tenant simply runs none of
        # the systems that would prove it
        state = "connect_one"
    elif automatable:
        # SCF says a machine could assess this, and no check reaches it. Calling
        # that `manual` is false — 570 of 1,534 controls sit here, including
        # IAC-06 Multi-Factor Authentication, which maps to 18 frameworks and no
        # SOC 2 criterion, so none of our four MFA collectors can touch it. It is
        # a check-authoring gap, and naming it one makes it a worklist instead of
        # a shrug.
        state = "unbound"
    else:
        state = "manual"
    return {
        "state": state,
        "satisfied_by": satisfying,
        "options": options,
        "provider_count": sum(len(o["providers"]) for o in options),
    }


def _linked_checks_for(db: Session, tenant_id: int, control_codes: List[str],
                       cadence: Optional[str] = None, connected: Optional[set] = None,
                       automatable: bool = False, scf_id: Optional[str] = None):
    """(checks payload, statuses, coverage, binding_source) for a control.

    Prefer covers→scf_id bindings; fall back to SOC 2 codes when covers miss.
    `statuses` covers ONLY the providers this tenant has connected — see
    `_connected_providers` for why an unconfigured connector must not contribute.
    `linked` still carries every bound connector so the detail page can show what
    else could prove this control.
    """
    idx = _check_index(db)
    if connected is None:
        connected = _connected_providers(db, tenant_id)
    latest = _latest_runs_by_plugin(
        db, tenant_id, sorted({p.id for lst in list(idx["soc2"].values()) + list(idx["scf"].values())
                               for p, _ in lst}),
    )
    return _linked_from_index(
        idx, latest, connected, control_codes, cadence, automatable,
        scf_id=scf_id, db=db, tenant_id=tenant_id,
    )


@router.post("/seed", status_code=201)
def seed_soc2(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _perm: bool = Depends(_require_scan_perm),
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
    write_rich_audit_log(
        db=db, tenant_id=tenant_id, user_id=current_user.id, action="checks_catalog_seed",
        resource_type="controls_automation", resource_name="Automated checks catalog",
        resource_url="/automation/soc2-controls",
        summary=f"Refreshed the automated checks catalog: {n + connectors} checks, {mapped} framework mappings",
    )
    db.commit()
    return {
        "status": "ok",
        "upserted": n + connectors,
        "connectors_upserted": connectors,
        "framework_mappings_created": mapped,
        "controls": len(catalog.get("controls") or []),
    }


# ── Evidence Collectors (SaaS API connectors) ────────────────────────────────
class CollectorConnectBody(BaseModel):
    token: str = Field(..., description="API token / access token (stored encrypted). "
                                        "For a cloud transport this is the secret key.")
    domain: Optional[str] = Field(None, description="Instance domain for Okta/Jira/Grafana/Zendesk/etc.")
    email: Optional[str] = Field(None, description="Account email (for Jira basic auth)")
    # Cloud transports authenticate as a principal in a region. The key id names
    # who is calling and is not itself a secret, so it is stored in clear.
    access_key_id: Optional[str] = Field(None, description="Cloud access key id (AWS)")
    region: Optional[str] = Field(None, description="Cloud region (AWS)")
    # A second secret for providers that need two (Datadog's application key,
    # Dropbox's app secret). Stored encrypted, like the token.
    secret2: Optional[str] = Field(None, description="Second secret, when the provider needs one (stored encrypted)")


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
            # a cloud transport authenticates as a principal in a region, so the
            # connect form has to ask for more than one secret
            "needs_key_id": m.get("needs_key_id", False),
            "needs_region": m.get("needs_region", False),
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
    _perm: bool = Depends(_require_scan_perm),
):
    """Save (encrypted) credentials for a collector, creating/updating its connection."""
    if provider not in PROVIDER_API:
        raise HTTPException(status_code=404, detail="Unknown collector provider")
    tenant_id = get_user_primary_tenant(current_user, db)
    spec = PROVIDER_API[provider]
    values = {
        "token": (body.token or "").strip(),
        "domain": normalize_domain(provider, body.domain) if body.domain else "",
        "email": (body.email or "").strip(),
        "access_key_id": (body.access_key_id or "").strip(),
        "region": (body.region or "").strip(),
        "secret2": (body.secret2 or "").strip(),
    }
    # Refuse a half-filled form here, not on the first collection an hour later.
    missing = missing_fields(provider, values)
    if missing:
        raise HTTPException(status_code=422, detail=f"{spec['label']} also needs: {', '.join(missing)}")
    extra = {**values, "token": encrypt_secret(values["token"]),
             "secret2": encrypt_secret(values["secret2"]) if values["secret2"] else ""}
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
    db.flush()
    # Which fields were given, never their values: the audit log is not a credential store.
    write_rich_audit_log(
        db=db, tenant_id=tenant_id, user_id=current_user.id, action="collector_connect",
        resource_type="evidence_collector", resource_id=conn.id, resource_name=spec["label"],
        resource_url=f"/admin/evidence-collectors?connector={provider}",
        summary=f"Connected the {spec['label']} evidence collector",
        after={"provider": provider, "fields_set": sorted(k for k, v in values.items() if v)},
    )
    db.commit()
    db.refresh(conn)
    return {"status": "ok", "provider": provider, "connection_id": conn.id}


@router.get("/collectors/{provider}/details")
def collector_details(provider: str, current_user: GRCUser = Depends(require_auth)):
    """Everything someone needs before connecting a collector: how to create the
    credential and what it needs, the form fields, every test it runs with the
    controls each evidences, and every call it makes."""
    if provider not in PROVIDER_API:
        raise HTTPException(status_code=404, detail="Unknown collector provider")
    spec = PROVIDER_API[provider]
    return {
        "provider": provider,
        "label": spec["label"],
        "category": spec["category"],
        "fields": form_fields(provider),
        "setup": connector_setup(provider),
        "tests": connector_tests(provider),
        "reads": connector_reads(provider),
    }


@router.post("/collectors/{provider}/test")
def test_collector(provider: str, db: Session = Depends(get_db), current_user: GRCUser = Depends(require_auth),
                   _perm: bool = Depends(_require_scan_perm)):
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
def run_collector(provider: str, db: Session = Depends(get_db), current_user: GRCUser = Depends(require_auth),
                  _perm: bool = Depends(_require_scan_perm)):
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
    """Deprecated per-framework control library.

    Prefer ``GET /automation/common/controls`` (SCF). Kept as a thin wrapper so
    old bookmarks do not 500; the previous body referenced an undefined ``out``.
    """
    _fw(framework)
    # Redirect callers to the common library payload shape without the crash.
    return list_common_controls(db=db, current_user=current_user, scope="all")


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
    scope: str = Query("in_scope", description="in_scope | all"),
    ownership: Optional[str] = Query(
        None, description="unowned | mine | overdue (only with scope=in_scope)"
    ),
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """The common control library, served from the SCF catalog.

    One canonical control set; each control lists the requirements it discharges
    across every framework we support (via grc_scf_mapping) rather than the three
    the Probo library covered. Falls back to the legacy Probo library for a tenant
    whose SCF catalog has not been imported, so this never 500s mid-rollout.

    ``scope=in_scope`` (default) filters to the tenant's default SCF scope
    applicable set. With no frameworks selected yet, returns an empty list and
    ``scope_status: unconfigured`` rather than all 1,534 controls.
    """
    tenant_id = get_user_primary_tenant(current_user, db)
    own_filter = (ownership or "").strip().lower() or None
    if own_filter and own_filter not in ("unowned", "mine", "overdue"):
        raise HTTPException(400, "ownership must be 'unowned', 'mine', or 'overdue'")
    if own_filter and (scope if isinstance(scope, str) else "in_scope").strip().lower() != "in_scope":
        raise HTTPException(400, "ownership filter requires scope=in_scope")
    release = (
        db.query(SCFRelease)
        .filter(SCFRelease.import_status == "ready", SCFRelease.is_current.is_(True))
        .first()
    )
    if release is None:
        return _legacy_common_controls(db, tenant_id)

    scope_mode = scope if isinstance(scope, str) else "in_scope"
    scope_mode = (scope_mode or "in_scope").strip().lower()
    if scope_mode not in ("in_scope", "all"):
        raise HTTPException(400, "scope must be 'in_scope' or 'all'")

    scf_scope = None
    applicable: Optional[set] = None
    scope_status = "all"
    try:
        scf_scope = ensure_default_scope(db, tenant_id)
    except RuntimeError:
        scf_scope = None

    if scope_mode == "in_scope" and scf_scope is not None:
        fw_slugs = list(scf_scope.framework_slugs or [])
        if not fw_slugs and int(scf_scope.esp_level or 0) <= 0:
            scope_status = "unconfigured"
            # Still surface tenant-authored custom controls when scope is empty.
            custom_out = _custom_controls_for_list(
                db, tenant_id, scf_scope, release.id, current_user.id,
                own_filter=own_filter, suppressed=set(), retargets={},
            )
            return {
                "framework": "SCF " + release.version,
                "source": "scf",
                "count": len(custom_out),
                "categories": sorted({c["category"] for c in custom_out if c.get("category")}),
                "frameworks": [],
                "seeded_plugin_count": 0,
                "controls": custom_out,
                "scope_status": scope_status,
                "scope": {
                    "framework_slugs": [],
                    "applicable_count": len(custom_out),
                    "total_count": (
                        db.query(func.count(SCFControl.id))
                        .filter(SCFControl.release_id == release.id)
                        .scalar() or 0
                    ),
                },
            }
        applicable = get_applicable_scf_ids(db, tenant_id, scf_scope.id)
        scope_status = "in_scope"

    # Crosswalk: only OUR framework slugs (provenance resolver|ai). SCF's own 249
    # source keys are the upstream catalogue, not what a tenant is assessed against.
    # Reviewer suppressions and retargets are applied at read time.
    suppressed, retargets = _mapping_reviews(db, tenant_id)
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
        effective = _effective_mapping_scf(slug, code, scf_id, suppressed, retargets)
        if effective is None:
            continue
        bucket = reqs[effective][slug]
        # Full list for accurate counts; FE truncates display itself.
        if not any(x.get("code") == code for x in bucket):
            bucket.append({"code": code, "name": code})
        fw_seen.add(slug)
        if prov == "ai":
            ai_slugs.add(slug)

    # Only the frameworks the tenant is assessed against are shown, in either mode.
    scope_fws = _scope_frameworks(scf_scope)
    scope_slugs = [f["key"] for f in scope_fws]
    published = _published_scope_codes(db, release.id, scope_slugs, suppressed, retargets) if scope_slugs else {}

    # Checks still reach a control through the SOC 2 criteria it discharges, but only
    # the individual checks naming those criteria count — not the whole connector.

    rows = (
        db.query(SCFControl.scf_id, SCFControl.name, SCFControl.domain_name,
                 SCFControl.domain_identifier, SCFControl.pptdf, SCFControl.weight,
                 SCFControl.is_material, SCFControl.ao_count, SCFControl.sort_key,
                 SCFControl.conformity_cadence)
        .filter(SCFControl.release_id == release.id)
        .order_by(SCFControl.sort_key)
        .all()
    )
    total_count = len(rows)

    out: List[Dict[str, Any]] = []
    categories: set = set()
    connected = _connected_providers(db, tenant_id)
    automatable = _automatable_controls(db, release.id)
    idx = _check_index(db)
    plugin_ids = {
        p.id
        for bucket in (idx.get("soc2") or {}, idx.get("scf") or {})
        for lst in bucket.values()
        for p, _ in lst
    }
    latest = _latest_runs_by_plugin(db, tenant_id, sorted(plugin_ids))

    state_by_scf: Dict[str, SCFControlState] = {}
    owner_names: Dict[int, str] = {}
    now = datetime.utcnow()
    if scf_scope is not None:
        state_by_scf = scf_own.states_by_scf_id(db, tenant_id, scf_scope.id)
        owner_ids = {s.owner_user_id for s in state_by_scf.values() if s.owner_user_id}
        if owner_ids:
            for u in db.query(GRCUser).filter(GRCUser.id.in_(sorted(owner_ids))).all():
                owner_names[u.id] = (
                    getattr(u, "display_name", None)
                    or getattr(u, "username", None)
                    or getattr(u, "email", None)
                    or str(u.id)
                )

    # the testing record lives on the control's work item, keyed by its NormalizedControl
    work_item_by_scf: Dict[str, ControlWorkItem] = {}
    scf_of_norm = dict(db.query(NormalizedControl.id, NormalizedControl.scf_id)
                       .filter(NormalizedControl.scf_id.isnot(None)).all())
    if scf_of_norm:
        for wi in (db.query(ControlWorkItem)
                   .filter(ControlWorkItem.tenant_id == tenant_id, ControlWorkItem.source_type == "normalized").all()):
            sid = scf_of_norm.get(wi.source_id)
            if sid:
                work_item_by_scf[sid] = wi
    target_default = (scf_scope.target_cmm if scf_scope is not None and scf_scope.target_cmm is not None else 3)

    for scf_id, name, domain, dom_id, pptdf, weight, material, ao_count, _sk, cad in rows:
        if applicable is not None and scf_id not in applicable:
            continue
        st = state_by_scf.get(scf_id)
        own_fields = scf_own.ownership_fields(
            st,
            owner_name=owner_names.get(st.owner_user_id) if st and st.owner_user_id else None,
            now=now,
        )
        if own_filter == "unowned" and own_fields["ownership_status"] != "unowned":
            continue
        if own_filter == "overdue" and own_fields["ownership_status"] != "overdue":
            continue
        if own_filter == "mine":
            is_owner = st is not None and st.owner_user_id == current_user.id
            is_assigned = scf_own.user_in_assigned(st, current_user.id)
            if not (is_owner or is_assigned):
                continue
        if domain:
            categories.add(domain)
        req = {k: v for k, v in (reqs.get(scf_id) or {}).items() if v}
        soc2_codes = [r["code"] for r in req.get("soc2", [])]
        linked, statuses, coverage, binding_source = _linked_from_index(
            idx, latest, connected, soc2_codes, cad, scf_id in automatable,
            scf_id=scf_id, db=db, tenant_id=tenant_id,
        )
        # Display only; check binding above keeps using every SOC 2 code we resolved.
        req = _in_scope_requirements(req, published.get(scf_id), scope_slugs)
        out.append({
            "control_id": scf_id,
            "canonical_key": scf_id,
            "title": name,
            "description": None,
            "category": domain,
            "domain": dom_id,
            "importance": "material" if material else None,
            "sub_type": _control_sub_type(linked, pptdf),
            "pptdf": pptdf,
            "weight": weight,
            "ao_count": ao_count,
            "frameworks": sorted(req.keys()),
            "requirements": req,
            "requirement_count": sum(len(v) for v in req.values()),
            "checks_count": len(linked),
            # `statuses` holds only the providers this tenant has connected, so a
            # control whose one real collector passed no longer reads "partial"
            # against 52 systems they do not run. With none connected there is
            # nothing to aggregate, and `coverage` says what to connect instead.
            "overall_status": (_aggregate_status(statuses) if statuses
                               else ("connect_one" if linked else coverage["state"])),
            "coverage": coverage,
            "checks": linked,
            "binding_source": binding_source,
            **own_fields,
            **_assurance_fields(st, work_item_by_scf.get(scf_id), target_default),
        })

    # Stage D — append active custom controls (tenant-authored, always in-scope).
    for custom_row in _custom_controls_for_list(
        db, tenant_id, scf_scope, release.id, current_user.id,
        own_filter=own_filter, suppressed=suppressed, retargets=retargets,
        existing_codes={c["control_id"] for c in out},
        idx=idx, latest=latest, connected=connected,
        work_item_by_scf=work_item_by_scf, target_default=target_default,
    ):
        if custom_row.get("category"):
            categories.add(custom_row["category"])
        if scope_slugs:
            custom_row["requirements"] = _in_scope_requirements(custom_row["requirements"], None, scope_slugs)
            custom_row["frameworks"] = sorted(custom_row["requirements"])
            custom_row["requirement_count"] = sum(len(v) for v in custom_row["requirements"].values())
        out.append(custom_row)

    fw_slugs_out = list((scf_scope.framework_slugs if scf_scope else None) or [])
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
            for s in (scope_slugs or sorted(fw_seen))
        ],
        "frameworks_total": len(fw_seen),
        "seeded_plugin_count": sum(c["checks_count"] for c in out),
        "controls": out,
        "scope_status": scope_status,
        "scope": {
            "framework_slugs": fw_slugs_out,
            "frameworks": scope_fws,
            # counted in both modes, so the In scope / All switch can show both numbers
            "applicable_count": (len(applicable) if applicable is not None
                                 else len(get_applicable_scf_ids(db, tenant_id, scf_scope.id)) if scope_slugs
                                 else len(out)),
            "total_count": total_count,
        },
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

    # Stage D — additive parallel section; does not alter disposition math.
    tenant_id = get_user_primary_tenant(current_user, db)
    custom_mappings: List[Dict[str, Any]] = []
    for nc in scf_custom.list_custom_for_tenant(db, tenant_id, include_retired=False):
        code = nc.scf_id or nc.code
        for slug, items in scf_custom.requirements_for_custom(db, nc).items():
            if framework and slug != framework:
                continue
            for item in items:
                custom_mappings.append({
                    "framework": slug,
                    "requirement_code": item["code"],
                    "control_code": code,
                })

    return {
        "generated": doc.get("generated"),
        "total": grand,
        "counts": counts,
        "labels": DISPOSITION_LABELS,
        "mapped_pct": round(counts.get("mapped", 0) / grand * 100, 1) if grand else 0.0,
        "accounted_pct": round((grand - counts.get("pending", 0)) / grand * 100, 1) if grand else 0.0,
        "frameworks": rows,
        "custom_mappings": custom_mappings,
    }


class MappingReviewBody(BaseModel):
    source_slug: str
    requirement_code: str
    scf_id: str
    verdict: str                      # confirmed | suppressed | retargeted
    retarget_scf_id: Optional[str] = None
    note: Optional[str] = None


_VERDICTS = {"confirmed", "suppressed", "retargeted"}


def _suppressed_pairs(db: Session, tenant_id: int) -> set:
    """(source_slug, requirement_code, scf_id) a reviewer has struck out."""
    return {
        (r.source_slug, r.requirement_code, r.scf_id)
        for r in db.query(SCFMappingReview.source_slug,
                          SCFMappingReview.requirement_code,
                          SCFMappingReview.scf_id)
        .filter(SCFMappingReview.tenant_id == tenant_id,
                SCFMappingReview.verdict == "suppressed")
        .all()
    }


def _mapping_reviews(db: Session, tenant_id: int) -> tuple:
    """Standing review decisions: suppressed triples + retarget map.

    Retarget key is ``(source_slug, requirement_code, scf_id)`` → new SCF id.
    Applied at read time so catalogue rows stay intact and decisions reverse.
    """
    suppressed: set = set()
    retargets: Dict[tuple, str] = {}
    for r in (
        db.query(SCFMappingReview.source_slug, SCFMappingReview.requirement_code,
                 SCFMappingReview.scf_id, SCFMappingReview.verdict,
                 SCFMappingReview.retarget_scf_id)
        .filter(SCFMappingReview.tenant_id == tenant_id,
                SCFMappingReview.verdict.in_(("suppressed", "retargeted")))
        .all()
    ):
        key = (r.source_slug, r.requirement_code, r.scf_id)
        if r.verdict == "suppressed":
            suppressed.add(key)
        elif r.verdict == "retargeted" and (r.retarget_scf_id or "").strip():
            retargets[key] = r.retarget_scf_id.strip()
    return suppressed, retargets


def _effective_mapping_scf(
    slug: str, code: str, scf_id: str, suppressed: set, retargets: Dict[tuple, str],
) -> Optional[str]:
    """Return the SCF id that should own this mapping, or None if suppressed."""
    key = (slug, code, scf_id)
    if key in suppressed:
        return None
    return retargets.get(key, scf_id)


def _scope_frameworks(scf_scope) -> List[Dict[str, str]]:
    """The tenant's in-scope frameworks, labelled, in the order they were chosen.

    Empty when nothing is selected, which callers read as "show every framework".
    """
    slugs = (scf_scope.framework_slugs if scf_scope is not None else None) or []
    return [{"key": s, "label": _FW_LABELS.get(s, s.replace("_", " ").title())} for s in slugs]


def _published_scope_codes(
    db: Session, release_id: int, slugs: List[str], suppressed: set, retargets: Dict[tuple, str],
) -> Dict[str, Dict[str, List[str]]]:
    """scf_id -> in-scope framework -> requirement codes from SCF's own crosswalk.

    Applicability counts SCF's published rows for a framework (``pci_dss_401``)
    as well as the rows our resolver matched to our library, so a control can be
    in scope through a requirement our library does not carry. Showing only our
    rows left those controls with an empty crosswalk (36 of 534 in scope on
    1link), so in-scope views add SCF's codes under our framework slug.
    """
    slugs_by_key: Dict[str, List[str]] = defaultdict(list)
    for s in slugs:
        for k in scf_keys_for_slug(s):
            slugs_by_key[k].append(s)
    out: Dict[str, Dict[str, List[str]]] = defaultdict(lambda: defaultdict(list))
    if not slugs_by_key:
        return out
    for scf_id, key, code in (
        db.query(SCFMapping.scf_id, SCFMapping.source_slug, SCFMapping.requirement_code)
        .filter(SCFMapping.release_id == release_id, SCFMapping.source_slug.in_(list(slugs_by_key)))
        .all()
    ):
        for slug in slugs_by_key[key]:
            effective = _effective_mapping_scf(slug, code, scf_id, suppressed, retargets)
            if effective is not None and code not in out[effective][slug]:
                out[effective][slug].append(code)
    return out


def in_scope_artifacts(artifacts: List[Dict[str, Any]], scope_fws: List[Dict[str, str]]) -> List[Dict[str, Any]]:
    """The artifacts an in-scope framework asks for, ``required_by`` cut to those frameworks.

    A consolidated set merges every framework's requests (AST-01: 36 artifacts);
    a tenant assessed against PCI DSS owes the 7 that PCI DSS asks for.
    ``required_by`` holds the same labels as _FW_LABELS, so the match is exact.
    """
    labels = {f["label"] for f in scope_fws}
    out = []
    for a in artifacts:
        req = [r for r in (a.get("required_by") or []) if r in labels]
        if req:
            out.append({**a, "required_by": req})
    return out


# Keywords in an evidence ask's name that say what kind of document it is, for
# the badge the Frameworks page shows. First match wins, so the order matters:
# "Log Review Procedure" is a procedure, not a log.
_EVIDENCE_TYPES = (
    ("policy", r"\bpolic"),
    ("procedure", r"\b(procedure|process|playbook|runbook|sop)\b"),
    ("certificate", r"\bcertificat"),
    ("contract", r"\b(contract|agreement|sla)\b"),
    ("register", r"\b(register|inventory|catalog(ue)?|list|matrix|sbom)\b"),
    ("test_results", r"\b(test|tests|testing|exercise|drill|penetration)\b"),
    ("log", r"\b(log|logs|audit trail)\b"),
    ("report", r"\b(report|reports|assessment|analysis|dashboard)\b"),
    ("configuration", r"\b(config|configuration|settings?|baseline|ruleset)\b"),
    ("screenshot", r"\bscreenshots?\b"),
    ("record", r"\b(record|records|minutes|tickets?|approvals?|attestations?|sign-off|evidence)\b"),
)
_EVIDENCE_TYPE_BY_FILETYPE = {"LOG": "log", "PNG": "screenshot", "JPG": "screenshot",
                              "JSON": "configuration", "YAML": "configuration", "EML": "record"}
#: File types a connected collector produces rather than a person.
_MACHINE_FILETYPES = {"JSON", "LOG", "YAML"}


def evidence_type(name: Optional[str], filetype: Optional[str]) -> str:
    """What kind of document an evidence ask names: policy, register, log…

    Framework libraries give a name and a file type, not a kind, so the name's
    keywords decide and a file type only one kind produces breaks a tie.
    """
    text = (name or "").lower()
    for kind, pattern in _EVIDENCE_TYPES:
        if re.search(pattern, text):
            return kind
    return _EVIDENCE_TYPE_BY_FILETYPE.get((filetype or "").upper(), "document")


def _natural(code: str) -> list:
    return [int(t) if t.isdigit() else t for t in re.split(r"(\d+)", code)]


def scoped_required_evidence(
    codes_by_slug: Dict[str, List[str]], scope_fws: List[Dict[str, str]], automated: bool,
) -> List[Dict[str, Any]]:
    """What the in-scope frameworks' own requirements ask for, one row per distinct ask.

    This is the list the Frameworks page shows under each requirement, in the
    library's own words: a control scoped to PCI DSS gets PCI DSS's asks for the
    requirements it maps to, named once however many of them repeat an ask, and
    nothing another framework wants. A machine-readable export (JSON, LOG, YAML)
    of a control with connected checks is marked automated, because a passing
    collector result can stand for it.
    """
    labels = {f["key"]: f["label"] for f in scope_fws}
    index = _framework_evidence_index()
    out: Dict[str, Dict[str, Any]] = {}
    for slug, label in labels.items():
        for code in sorted(codes_by_slug.get(slug) or [], key=_natural):
            for ask in (index.get(slug) or {}).get(code, []):
                name = (ask.get("name") or "").strip()
                key = artifact_key(name)
                if not key:
                    continue
                item = out.get(key)
                if item is None:
                    filetype = (ask.get("filetype") or "").strip().upper() or None
                    item = out[key] = {
                        "key": key,
                        "name": name,
                        "description": ask.get("description") or "",
                        "filetype": filetype,
                        "type": evidence_type(name, filetype),
                        "collection_method": "automated" if automated and filetype in _MACHINE_FILETYPES else "manual",
                        "required_by": [],
                        "references": [],
                        "mandatory": True,
                    }
                if label not in item["required_by"]:
                    item["required_by"].append(label)
                ref = f"{label} {code}"
                if ref not in item["references"]:
                    item["references"].append(ref)
    return list(out.values())


def consolidated_artifacts_for(db: Session, tenant_id: int, scf_id: str) -> List[Dict[str, Any]]:
    """A control's consolidated evidence set.

    A tenant-authored control has none of its own, so it inherits the sets of the
    SCF controls it declares it implements — the same deliverables, cited once.
    """
    arts = (_consolidated_evidence().get(scf_id) or {}).get("artifacts") or []
    if arts:
        return arts
    nc = scf_custom.get_custom(db, tenant_id, scf_id)
    if nc is None:
        return []
    out, seen = [], set()
    for sid in (nc.implements_scf_ids or []):
        for a in ((_consolidated_evidence().get(sid) or {}).get("artifacts") or []):
            key = a.get("artifact_id") or a.get("name")
            if key in seen:
                continue
            seen.add(key)
            out.append({**a, "via_scf_id": sid})
    return out


def requirement_codes_for_control(
    db: Session, tenant_id: int, release_id: int, scf_id: str, slugs: List[str],
    suppressed: set, retargets: Dict[tuple, str],
) -> Dict[str, List[str]]:
    """In-scope requirement codes for an SCF control or a custom one.

    Custom controls are not in the crosswalk, so their codes come from their own
    framework links plus whatever the SCF controls they implement discharge.
    """
    codes = in_scope_codes(db, release_id, scf_id, slugs, suppressed, retargets)
    if codes:
        return codes
    nc = scf_custom.get_custom(db, tenant_id, scf_id)
    if nc is None:
        return codes
    merged = scf_custom.merge_requirements(
        scf_custom.requirements_for_custom(db, nc),
        scf_custom.inherited_requirements_from_scf(
            db, release_id, nc.implements_scf_ids, suppressed, retargets),
    )
    out: Dict[str, List[str]] = defaultdict(list)
    for slug, items in merged.items():
        if slugs and slug not in slugs:
            continue
        for item in items:
            if item["code"] not in out[slug]:
                out[slug].append(item["code"])
    if nc.implements_scf_ids and slugs:
        published = _published_scope_codes(db, release_id, list(slugs), suppressed, retargets)
        for sid in nc.implements_scf_ids:
            for slug, cs in (published.get(sid) or {}).items():
                for code in cs:
                    if code not in out[slug]:
                        out[slug].append(code)
    return out


def in_scope_codes(
    db: Session, release_id: int, scf_id: str, slugs: List[str], suppressed: set, retargets: Dict[tuple, str],
) -> Dict[str, List[str]]:
    """This control's requirement codes in each in-scope framework: ours, then SCF's."""
    out: Dict[str, List[str]] = defaultdict(list)
    if not slugs:
        return out
    for owner, slug, code in (
        db.query(SCFMapping.scf_id, SCFMapping.source_slug, SCFMapping.requirement_code)
        .filter(SCFMapping.release_id == release_id, SCFMapping.provenance.in_(("resolver", "ai")),
                SCFMapping.source_slug.in_(list(slugs)))
        .all()
    ):
        if _effective_mapping_scf(slug, code, owner, suppressed, retargets) == scf_id and code not in out[slug]:
            out[slug].append(code)
    for slug, codes in (_published_scope_codes(db, release_id, list(slugs), suppressed, retargets).get(scf_id) or {}).items():
        for code in codes:
            if code not in out[slug]:
                out[slug].append(code)
    return out


def _in_scope_requirements(
    reqs: Dict[str, List[Dict[str, Any]]], published: Optional[Dict[str, List[str]]], slugs: List[str],
) -> Dict[str, List[Dict[str, Any]]]:
    """A control's requirements cut to the in-scope frameworks; all of them when none are."""
    if not slugs:
        return reqs
    out = {}
    for s in slugs:
        items = list(reqs.get(s) or [])
        have = {i["code"] for i in items}
        items += [{"code": c, "name": c} for c in (published or {}).get(s, []) if c not in have]
        if items:
            out[s] = items
    return out


def _assurance_fields(state, work_item, target_default: Optional[int]) -> Dict[str, Any]:
    """Assurance columns for a list row: signed-off status, maturity and the latest test results."""
    return {
        "designation": (state.designation if state else None) or "not_assessed",
        "cmm_actual": state.cmm_actual if state else None,
        "cmm_target": state.cmm_target if state and state.cmm_target is not None else target_default,
        "last_assessed_at": state.last_assessed_at.isoformat() if state and state.last_assessed_at else None,
        "design_effectiveness": work_item.design_effectiveness if work_item else None,
        "operating_effectiveness": work_item.operating_effectiveness if work_item else None,
        "last_tested_at": work_item.last_tested_at.isoformat() if work_item and work_item.last_tested_at else None,
        "next_test_date": work_item.next_test_date.isoformat() if work_item and work_item.next_test_date else None,
    }


def _work_item_fields(db: Session, tenant_id: int, normalized_control_id: int) -> Dict[str, Any]:
    """Priority, key-control flag and the latest test results, from the work item
    the Assurance tab writes. Absent work item: the control has not been worked."""
    wi = (db.query(ControlWorkItem)
          .filter(ControlWorkItem.tenant_id == tenant_id,
                  ControlWorkItem.source_type == "normalized",
                  ControlWorkItem.source_id == normalized_control_id).first())
    return {
        "priority": wi.priority if wi else None,
        "is_key_control": bool(wi.is_key_control) if wi else False,
        "implementation_status": wi.implementation_status if wi else None,
        "test_frequency": wi.frequency if wi else None,
        "design_effectiveness": wi.design_effectiveness if wi else None,
        "operating_effectiveness": wi.operating_effectiveness if wi else None,
        "last_tested_at": wi.last_tested_at.isoformat() if wi and wi.last_tested_at else None,
        "next_test_date": wi.next_test_date.isoformat() if wi and wi.next_test_date else None,
    }


def _control_sub_type(linked: list, pptdf: Optional[str]) -> str:
    """Automated / Manual / Hybrid from linked checks + PPTDF dimensions.

    Technology/Data with people/process/facility dimensions → Hybrid when checks
    exist (automation covers only part of the control). No checks → Manual.
    """
    if not linked:
        return "Manual"
    dims = set((pptdf or "").upper())
    has_tech = bool(dims & {"T", "D"})
    has_human = bool(dims & {"P", "F"}) or "P" in (pptdf or "").upper()
    # PPTDF strings are sometimes concatenated letters without separators.
    raw = (pptdf or "").upper()
    has_tech = has_tech or ("T" in raw or "D" in raw)
    has_human = has_human or ("P" in raw or "F" in raw)
    if has_tech and has_human:
        return "Hybrid"
    return "Automated"


def _bound_checks_payload(
    db: Session,
    tenant_id: int,
    scf_id: str,
    bound_check_ids: List[str],
    idx: Optional[Dict[str, Any]] = None,
    latest: Optional[Dict[int, Any]] = None,
    connected: Optional[set] = None,
    cadence: Optional[str] = None,
) -> tuple:
    """Resolve custom-control bound_check_ids into linked/status/coverage."""
    wanted = {str(x).strip() for x in (bound_check_ids or []) if str(x).strip()}
    if not wanted:
        return [], [], {"state": "manual", "hint": "Custom control — no connector checks",
                        "satisfied_by": [], "options": [], "provider_count": 0}, "none"

    if idx is None:
        idx = _check_index(db)
    if connected is None:
        connected = _connected_providers(db, tenant_id)

    # Invert covers index: find plugins that own these check ids.
    bound: Dict[int, Any] = {}
    check_covers = idx.get("check_covers") or {}
    for bucket in (idx.get("scf") or {}, idx.get("soc2") or {}):
        for _key, lst in bucket.items():
            for p, cids in lst:
                hit = (cids or set()) & wanted
                if not hit and not cids:
                    continue
                if hit:
                    entry = bound.setdefault(
                        p.id,
                        {"plugin": p, "checks": set(),
                         "provider": (p.check_definition or {}).get("provider")},
                    )
                    entry["checks"].update(hit)

    # Also scan provider_checks for ids not yet indexed (bound-only checks).
    if len({c for b in bound.values() for c in b["checks"]}) < len(wanted):
        for p in (db.query(CompliancePlugin)
                  .filter(CompliancePlugin.benchmark.in_([BENCHMARK, CONNECTOR_BENCHMARK]),
                          CompliancePlugin.enabled.is_(True)).all()):
            provider = (p.check_definition or {}).get("provider")
            if not provider:
                continue
            for c in provider_checks(provider):
                cid = c.get("id")
                if cid in wanted:
                    entry = bound.setdefault(
                        p.id,
                        {"plugin": p, "checks": set(), "provider": provider},
                    )
                    entry["checks"].add(cid)
                    if cid not in check_covers:
                        check_covers[cid] = covers_for_check(c)

    if not bound:
        return [], [], {"state": "unbound", "hint": "bound_check_ids set but no plugins matched",
                        "satisfied_by": [], "options": [], "provider_count": 0}, "covers"

    if latest is None:
        latest = _latest_runs_by_plugin(db, tenant_id, sorted(bound.keys()))

    all_cids = {cid for b in bound.values() for cid in b["checks"]}
    # Results keyed by custom code OR any of the bound check ids.
    scf_rows = (
        db.query(SCFCheckResult)
        .filter(
            SCFCheckResult.tenant_id == tenant_id,
            or_(
                SCFCheckResult.scf_id == scf_id,
                SCFCheckResult.check_id.in_(sorted(all_cids)),
            ),
        )
        .order_by(desc(SCFCheckResult.collected_at))
        .limit(500)
        .all()
    )

    linked, statuses = [], []
    for b in bound.values():
        pl = b["plugin"]
        run = latest.get(pl.id)
        ids = b["checks"]
        st = _status_from_scf_results(scf_rows, ids)
        if st is None:
            st = _status_from_run(run, ids, [], cadence) if run else "not_run"
        in_scope = _plugin_in_scope(pl, b.get("provider"), connected)
        if in_scope:
            statuses.append(st)
        linked.append({
            "plugin_key": pl.plugin_key, "id": pl.id, "title": pl.title,
            "severity": pl.severity, "seeded": True,
            "source": "connector" if pl.benchmark == CONNECTOR_BENCHMARK else "aws",
            "checks_matched": len(ids),
            "control_status": st,
            "in_scope": in_scope,
            "last_run": _run_out(run) if run else None,
            "binding": "covers",
            # Flat unique tokens for the FE chips (not a per-check map).
            "covers": sorted({
                str(t).strip()
                for cid in ids
                for t in (check_covers.get(cid) or [])
                if str(t).strip()
            }),
            "check_ids": sorted(ids),
        })
    bound_list = [{"plugin": b["plugin"], "checks": [{"id": x} for x in b["checks"]],
                   "provider": b.get("provider")} for b in bound.values()]
    return linked, statuses, _coverage_for(bound_list, connected, True), "covers"


def _custom_controls_for_list(
    db: Session,
    tenant_id: int,
    scf_scope,
    release_id: int,
    user_id: int,
    *,
    own_filter: Optional[str],
    suppressed: set,
    retargets: Dict[tuple, str],
    existing_codes: Optional[set] = None,
    idx: Optional[Dict[str, Any]] = None,
    latest: Optional[Dict[int, Any]] = None,
    connected: Optional[set] = None,
    work_item_by_scf: Optional[Dict[str, Any]] = None,
    target_default: Optional[int] = None,
) -> List[Dict[str, Any]]:
    """Build list-row dicts for non-retired custom NormalizedControls."""
    existing_codes = existing_codes or set()
    customs = scf_custom.list_custom_for_tenant(db, tenant_id, include_retired=False)
    if not customs:
        return []

    state_by_scf: Dict[str, SCFControlState] = {}
    owner_names: Dict[int, str] = {}
    now = datetime.utcnow()
    if scf_scope is not None:
        state_by_scf = scf_own.states_by_scf_id(db, tenant_id, scf_scope.id)
        owner_ids = {s.owner_user_id for s in state_by_scf.values() if s.owner_user_id}
        if owner_ids:
            for u in db.query(GRCUser).filter(GRCUser.id.in_(sorted(owner_ids))).all():
                owner_names[u.id] = (
                    getattr(u, "display_name", None)
                    or getattr(u, "username", None)
                    or getattr(u, "email", None)
                    or str(u.id)
                )

    profiles = {
        p.normalized_control_id: p
        for p in db.query(CustomControlProfile).filter(
            CustomControlProfile.normalized_control_id.in_([c.id for c in customs])).all()
    }
    # What SCF itself publishes for the controls these implement, so a row's
    # requirement count matches what the control page shows.
    scope_slugs = list((scf_scope.framework_slugs if scf_scope else None) or [])
    published: Dict[str, Dict[str, List[str]]] = {}
    if scope_slugs and any(c.implements_scf_ids for c in customs):
        published = _published_scope_codes(db, release_id, scope_slugs, suppressed, retargets)
    if work_item_by_scf is None:
        work_item_by_scf = {
            wi.source_id: wi
            for wi in db.query(ControlWorkItem).filter(
                ControlWorkItem.tenant_id == tenant_id,
                ControlWorkItem.source_type == "normalized",
                ControlWorkItem.source_id.in_([c.id for c in customs])).all()
        }
        work_item_by_scf = {
            (c.scf_id or c.code): work_item_by_scf[c.id]
            for c in customs if c.id in work_item_by_scf
        }

    out: List[Dict[str, Any]] = []
    for nc in customs:
        code = nc.scf_id or nc.code
        if not code or code in existing_codes:
            continue
        st = state_by_scf.get(code)
        wi = (work_item_by_scf or {}).get(code)
        own_fields = scf_own.ownership_fields(
            st,
            owner_name=owner_names.get(st.owner_user_id) if st and st.owner_user_id else None,
            now=now,
        )
        if own_filter == "unowned" and own_fields["ownership_status"] != "unowned":
            continue
        if own_filter == "overdue" and own_fields["ownership_status"] != "overdue":
            continue
        if own_filter == "mine":
            is_owner = st is not None and st.owner_user_id == user_id
            is_assigned = scf_own.user_in_assigned(st, user_id)
            if not (is_owner or is_assigned):
                continue

        direct = scf_custom.requirements_for_custom(db, nc)
        inherited = scf_custom.inherited_requirements_from_scf(
            db, release_id, nc.implements_scf_ids, suppressed, retargets,
        )
        req = scf_custom.merge_requirements(direct, inherited)
        for sid in (nc.implements_scf_ids or []):
            for slug, codes in (published.get(sid) or {}).items():
                bucket = req.setdefault(slug, [])
                have = {i["code"] for i in bucket}
                bucket.extend({"code": c, "name": c} for c in codes if c not in have)
        # Strip internal keys for list shape (code/name only).
        req_list = {
            slug: [{"code": i["code"], "name": i.get("name") or i.get("title") or i["code"]}
                   for i in items]
            for slug, items in req.items()
        }
        bound_ids = list(nc.bound_check_ids or [])
        linked, statuses, coverage, binding_source = _bound_checks_payload(
            db, tenant_id, code, bound_ids, idx=idx, latest=latest,
            connected=connected, cadence=nc.conformity_cadence,
        )
        overall = (
            _aggregate_status(statuses) if statuses
            else ("connect_one" if linked else coverage.get("state", "manual"))
        )
        profile = profiles.get(nc.id)
        out.append({
            "control_id": code,
            "canonical_key": code,
            "title": nc.name,
            "description": nc.statement,
            "category": (profile.category if profile else None) or nc.domain,
            "domain": nc.domain,
            "importance": None,
            "sub_type": nc.control_sub_type or ("Automated" if linked else "Manual"),
            "pptdf": nc.pptdf,
            "weight": None,
            "ao_count": 0,
            "frameworks": sorted(req_list.keys()),
            "requirements": req_list,
            "requirement_count": sum(len(v) for v in req_list.values()),
            "checks_count": len(linked),
            "overall_status": overall if linked else "manual",
            "coverage": coverage,
            "checks": linked,
            "binding_source": binding_source,
            "bound_check_ids": bound_ids,
            "custom": True,
            "badge": "Custom",
            "conformity_cadence": nc.conformity_cadence,
            "implements_scf_ids": list(nc.implements_scf_ids or []),
            # Register fields, so the list filters and the reports read the same
            # way for an authored control as for one from the SCF catalogue.
            "sub_category": profile.sub_category if profile else None,
            "control_type": profile.control_type if profile else None,
            "operating_frequency": profile.operating_frequency if profile else None,
            "regulatory_source": profile.regulatory_source if profile else None,
            "lifecycle_status": (profile.lifecycle_status if profile else None) or "active",
            "effective_date": profile.effective_date.isoformat() if profile and profile.effective_date else None,
            "review_date": profile.review_date.isoformat() if profile and profile.review_date else None,
            "priority": wi.priority if wi else None,
            "is_key_control": bool(wi.is_key_control) if wi else False,
            "implementation_status": wi.implementation_status if wi else None,
            **_assurance_fields(st, wi, target_default),
            **own_fields,
        })
    return out


def inherited_scf_guidance(db: Session, release_id: int, implements: List[str]) -> Dict[str, Any]:
    """Maturity criteria, solutions and evidence requests of the SCF controls a
    custom control implements — rendered verbatim, never rewritten or merged into
    new prose (CC BY-ND), and only for display.
    """
    extras = _scf_extras()
    out: Dict[str, Any] = {
        "maturity_levels": {}, "solutions": {}, "maturity_from": None,
        "manual": [], "consolidated": [], "titles": {},
    }
    if not implements:
        return out
    rows = (db.query(SCFControl.scf_id, SCFControl.name, SCFControl.solutions)
            .filter(SCFControl.release_id == release_id, SCFControl.scf_id.in_(implements)).all())
    by_id = {r[0]: r for r in rows}
    out["titles"] = {r[0]: r[1] for r in rows}

    seen: set = set()
    for sid in implements:
        cmm = extras["cmm"].get(sid) or {}
        # One control's criteria, not a blend of several: a blend would be a
        # derivative of the catalogue and would read as neither control's.
        if cmm and not out["maturity_levels"]:
            out["maturity_levels"], out["maturity_from"] = cmm, sid
            out["solutions"] = (by_id.get(sid) or (None, None, {}))[2] or {}
        for erl_id in extras["erl_links"].get(sid, []):
            art = extras["erl"].get(erl_id)
            if not art:
                continue
            key = (art.get("artifact") or erl_id).strip().lower()
            if key in seen:
                continue
            seen.add(key)
            out["manual"].append({
                "source": f"SCF evidence request list (via {sid})", "ref": erl_id,
                "name": art.get("artifact"), "description": art.get("description"),
                "area": art.get("area_of_focus"), "filetype": None,
            })
        for a in ((_consolidated_evidence().get(sid) or {}).get("artifacts") or []):
            out["consolidated"].append({**a, "via_scf_id": sid})
    return out


def inherited_objectives(db: Session, release_id: int, implements: List[str]) -> List[Dict[str, Any]]:
    """Assessment objectives of the SCF controls a custom control implements."""
    if not implements:
        return []
    return [{
        "ao_id": o.ao_id, "seq": o.seq, "objective": o.objective,
        "pptdf": o.pptdf, "rigor": o.rigor, "via_scf_id": o.scf_id,
    } for o in (db.query(SCFObjective)
                .filter(SCFObjective.release_id == release_id, SCFObjective.scf_id.in_(implements))
                .order_by(SCFObjective.scf_id, SCFObjective.seq).all())]


def _authored_evidence(nc: NormalizedControl) -> List[Dict[str, Any]]:
    """The tenant's own recommended evidence, in the shape the views render."""
    out = []
    for a in (nc.recommended_evidence or []):
        if not isinstance(a, dict) or not (a.get("name") or "").strip():
            continue
        name = a["name"].strip()
        out.append({
            "key": artifact_key(name), "name": name,
            "description": a.get("description") or "",
            "filetype": a.get("filetype"),
            "type": evidence_type(name, a.get("filetype")),
            "collection_method": a.get("collection_method") or "manual",
            "required_by": ["This control"], "references": [],
            "mandatory": bool(a.get("mandatory")),
            "source": "authored",
        })
    return out


def _custom_control_detail(
    db: Session,
    tenant_id: int,
    code: str,
    release: SCFRelease,
    current_user: GRCUser,
) -> Optional[Dict[str, Any]]:
    """A tenant-authored control in the same payload shape as an SCF one.

    Its requirements, guidance, evidence and artifacts come from three places:
    what the tenant wrote, what the frameworks it maps to ask for, and — for the
    SCF controls it declares it implements — those controls' own catalogue
    material, quoted as published.
    """
    nc = scf_custom.get_custom(db, tenant_id, code)
    if nc is None or nc.retired_at is not None:
        return None

    scf_id = nc.scf_id or nc.code
    implements = list(nc.implements_scf_ids or [])
    suppressed, retargets = _mapping_reviews(db, tenant_id)
    direct = scf_custom.requirements_for_custom(db, nc)
    inherited = scf_custom.inherited_requirements_from_scf(
        db, release.id, implements, suppressed, retargets,
    )
    merged = scf_custom.merge_requirements(direct, inherited)

    in_scope_slugs: set = set()
    scf_scope = None
    try:
        scf_scope = ensure_default_scope(db, tenant_id)
        in_scope_slugs = set(scf_scope.framework_slugs or [])
    except RuntimeError:
        pass
    scope_fws = _scope_frameworks(scf_scope)

    # Requirements the SCF catalogue itself publishes for the controls this one
    # implements, so inheritance covers the same ground as the SCF control page.
    if implements and scope_fws:
        published = _published_scope_codes(
            db, release.id, [f["key"] for f in scope_fws], suppressed, retargets,
        )
        for sid in implements:
            for slug, codes in (published.get(sid) or {}).items():
                bucket = merged.setdefault(slug, [])
                have = {i["code"] for i in bucket}
                bucket.extend({"code": c, "name": c, "source": "implements_scf",
                               "via_scf_id": sid} for c in codes if c not in have)

    idx = _requirement_index()
    versions = idx.get("__versions__", {})
    req_groups = []
    for slug, items in merged.items():
        rows = []
        for i in items:
            meta = (idx.get(slug) or {}).get(i["code"]) or {}
            rows.append({
                "code": i["code"],
                "reference": meta.get("reference") or i.get("reference") or i["code"],
                "title": meta.get("title") or i.get("title") or i.get("name"),
                "text": meta.get("text"),
                "domain": meta.get("domain"),
                "match_mode": "exact",
                "confidence": None,
                "resolved": bool(meta),
                "source": i.get("source") or "ncl",
                "via_scf_id": i.get("via_scf_id"),
            })
        rows.sort(key=lambda r: r["code"])
        req_groups.append({
            "framework": slug,
            "label": _FW_LABELS.get(slug, slug.replace("_", " ").title()),
            "version": versions.get(slug),
            "provenance": "custom",
            "pivot_via": None,
            "items": rows,
            "count": len(rows),
            "unresolved": sum(1 for r in rows if not r["resolved"]),
            "match_modes": ["exact"],
            "inferred_count": 0,
            "confidence": None,
            "in_scope": slug in in_scope_slugs if in_scope_slugs else False,
        })
    req_groups.sort(key=lambda g: (not g.get("in_scope"), -g["count"], g["label"]))
    if in_scope_slugs:
        req_groups = [g for g in req_groups if g["in_scope"]]

    own_fields = {
        "owner_user_id": None,
        "owner_name": None,
        "reviewer_user_id": None,
        "assigned_user_ids": [],
        "next_due_at": None,
        "ownership_status": "unowned",
    }
    assurance_fields = {
        "exception_id": None, "alternative_scf_id": None, "inheritance_type": None,
        "provider_vendor_id": None, "designation": None, "cmm_actual": None,
        "cmm_target": None,
    }
    if scf_scope is not None:
        st = (
            db.query(SCFControlState)
            .filter(
                SCFControlState.tenant_id == tenant_id,
                SCFControlState.scope_id == scf_scope.id,
                SCFControlState.scf_id == scf_id,
            )
            .first()
        )
        owner_name = None
        if st and st.owner_user_id:
            ou = db.query(GRCUser).filter(GRCUser.id == st.owner_user_id).first()
            if ou:
                owner_name = (
                    getattr(ou, "display_name", None)
                    or getattr(ou, "username", None)
                    or getattr(ou, "email", None)
                )
        own_fields = scf_own.ownership_fields(st, owner_name=owner_name)
        if st is not None:
            assurance_fields = {
                "exception_id": st.exception_id,
                "alternative_scf_id": st.alternative_scf_id,
                "inheritance_type": st.inheritance_type,
                "provider_vendor_id": st.provider_vendor_id,
                "designation": st.designation or "not_assessed",
                "cmm_actual": st.cmm_actual,
                "cmm_target": st.cmm_target,
            }

    bound_ids = list(nc.bound_check_ids or [])
    linked, statuses, coverage, binding_source = _bound_checks_payload(
        db, tenant_id, scf_id, bound_ids, cadence=nc.conformity_cadence,
    )
    overall = (
        _aggregate_status(statuses) if statuses
        else ("connect_one" if linked else coverage.get("state", "manual"))
    )

    # Guidance: the framework asks come from the same helper the SCF page uses,
    # then the tenant's own text and the implemented controls' material.
    shim = SimpleNamespace(scf_id=scf_id, solutions={},
                           conformity_cadence=nc.conformity_cadence, pptdf=nc.pptdf)
    guidance = _build_guidance(shim, req_groups, linked)
    scf_guidance = inherited_scf_guidance(db, release.id, implements)
    authored = _authored_evidence(nc)
    guidance["implementation"].update({
        "maturity_levels": scf_guidance["maturity_levels"],
        "solutions": scf_guidance["solutions"],
        "maturity_from": scf_guidance["maturity_from"],
        "target_maturity": next(
            (v for k, v in scf_guidance["maturity_levels"].items() if "Level 3" in k), None,
        ),
        "objective": nc.objective,
        "guidance": nc.implementation_guidance,
        "testing_guidance": nc.testing_guidance,
        "authored": bool(nc.implementation_guidance or nc.testing_guidance or nc.objective),
    })
    have = {(m.get("name") or "").strip().lower() for m in guidance["evidence"]["manual"]}
    for item in scf_guidance["manual"]:
        if (item.get("name") or "").strip().lower() not in have:
            guidance["evidence"]["manual"].append(item)
    for item in authored:
        if item["name"].strip().lower() not in have:
            guidance["evidence"]["manual"].insert(0, {
                "source": "Authored", "ref": None, "name": item["name"],
                "description": item["description"], "area": None,
                "filetype": item["filetype"],
            })
    guidance["evidence"]["manual_count"] = len(guidance["evidence"]["manual"])
    guidance["evidence"]["authored"] = authored

    artifacts = [
        {**a, "has_template": a.get("artifact_id") in _templated_artifact_ids()}
        for a in scf_guidance["consolidated"] if a.get("source") == "catalog"
    ]
    applicable = None
    if in_scope_slugs:
        artifacts = in_scope_artifacts(artifacts, scope_fws)
        required = scoped_required_evidence(
            {g["framework"]: [i["code"] for i in g["items"]] for g in req_groups},
            scope_fws, automated=bool(linked),
        )
        keys = {r["key"] for r in required}
        guidance["evidence"]["required"] = required + [a for a in authored if a["key"] not in keys]
        guidance["evidence"]["consolidated"] = None
        guidance["evidence"]["consolidated_from"] = None
        applicable = get_applicable_scf_ids(db, tenant_id, scf_scope.id)
    else:
        guidance["evidence"]["consolidated"] = (
            [{**a} for a in scf_guidance["consolidated"]] + authored) or None

    pairs = {(g["framework"], i["code"]) for g in req_groups for i in g["items"]}
    related = (_related_controls(db, release.id, scf_id, slugs=in_scope_slugs or None,
                                 applicable=applicable, pairs=pairs, include_family=False)
               if pairs else {"family": [], "by_requirements": []})
    # The controls it implements lead the list: that link is a statement, not an
    # inference from shared requirements.
    implemented_rows = [{"control_id": sid, "title": scf_guidance["titles"].get(sid),
                         "shared": 0, "score": None, "requirements": ["Implements this control"]}
                        for sid in implements]
    related["by_requirements"] = implemented_rows + [
        r for r in related.get("by_requirements", []) if r["control_id"] not in set(implements)
    ]

    profile = scf_custom.profile_to_dict(db, scf_custom.get_profile(db, nc))
    work = _work_item_fields(db, tenant_id, nc.id)

    return {
        "control_id": scf_id,
        "title": nc.name,
        "description": nc.statement,
        "control_question": nc.objective,
        "category": profile.get("category") or nc.domain,
        "domain": nc.domain,
        "pptdf": nc.pptdf,
        "weight": None,
        "is_material": bool(work.get("is_key_control")),
        "conformity_cadence": nc.conformity_cadence,
        "ao_count": 0,
        "sub_type": nc.control_sub_type or ("Automated" if linked else "Manual"),
        "checks_count": len(linked),
        "overall_status": overall if linked else "manual",
        "coverage": coverage,
        "checks": linked,
        "binding_source": binding_source,
        "binding_via": sorted({t for chk in linked for t in (chk.get("covers") or [])}),
        "test_groups": _test_groups(linked, _connected_providers(db, tenant_id)) if linked else [],
        "related": related,
        "scope_id": scf_scope.id if scf_scope is not None else None,
        "scope_frameworks": scope_fws,
        "cmm_target_default": (scf_scope.target_cmm if scf_scope is not None
                               and scf_scope.target_cmm is not None else 3),
        "artifacts": artifacts,
        # An authored control has no objectives of its own; where it implements
        # SCF controls, theirs are what its testing has to satisfy.
        "objectives": inherited_objectives(db, release.id, implements),
        "objectives_note": (
            f"Assessment objectives of the SCF control(s) this one implements: {', '.join(implements)}"
            if implements else
            "Authored control — write its test procedures on the Assurance tab"
        ),
        **guidance,
        "requirement_groups": req_groups,
        "requirement_count": sum(g["count"] for g in req_groups),
        "framework_count": len(req_groups),
        "release": release.version,
        "custom": True,
        "badge": "Custom",
        "implements_scf_ids": implements,
        "implements_titles": scf_guidance["titles"],
        "bound_check_ids": bound_ids,
        "profile": profile,
        "link_counts": scf_record_links.link_counts(db, nc.id),
        **work,
        **own_fields,
        **assurance_fields,
    }


def _linked_from_index(
    idx: Dict[str, Any],
    latest: Dict[int, Any],
    connected: set,
    soc2_codes: List[str],
    cadence: Optional[str],
    automatable: bool,
    scf_id: Optional[str] = None,
    db: Optional[Session] = None,
    tenant_id: Optional[int] = None,
):
    """Same payload as ``_linked_checks_for``, using a pre-built check index.

    Prefer covers→scf_id; fall back to SOC 2 codes. Status prefers SCFCheckResult
    rows when present for the bound check_ids.
    """
    soc2_idx = idx.get("soc2") if isinstance(idx, dict) and "soc2" in idx else idx
    scf_idx = idx.get("scf") if isinstance(idx, dict) else {}
    check_covers = (idx.get("check_covers") if isinstance(idx, dict) else None) or {}

    bound: Dict[int, Any] = {}
    binding_source = "none"

    if scf_id and scf_idx:
        for p, cids in scf_idx.get(scf_id, []):
            entry = bound.setdefault(
                p.id,
                {"plugin": p, "checks": set(),
                 "provider": (p.check_definition or {}).get("provider")},
            )
            entry["checks"].update(cids or set())
        if bound:
            binding_source = "covers"

    if not bound:
        for code in soc2_codes or []:
            for p, cids in (soc2_idx or {}).get(code, []):
                entry = bound.setdefault(
                    p.id,
                    {"plugin": p, "checks": set(),
                     "provider": (p.check_definition or {}).get("provider")},
                )
                entry["checks"].update(cids or set())
        if bound:
            binding_source = "soc2_fallback"

    if not bound:
        return [], [], {"state": "unbound" if automatable else "manual",
                        "satisfied_by": [], "options": [], "provider_count": 0}, binding_source

    all_cids = {cid for b in bound.values() for cid in b["checks"]}
    scf_rows: List[Any] = []
    if db is not None and tenant_id is not None and scf_id:
        scf_rows = _scf_results_for_control(db, tenant_id, scf_id, all_cids or None)

    linked, statuses = [], []
    for b in bound.values():
        pl = b["plugin"]
        run = latest.get(pl.id)
        ids = b["checks"]
        st = _status_from_scf_results(scf_rows, ids)
        if st is None:
            st = _status_from_run(run, ids, soc2_codes, cadence) if run else "not_run"
        in_scope = _plugin_in_scope(pl, b.get("provider"), connected)
        if in_scope:
            statuses.append(st)
        linked.append({
            "plugin_key": pl.plugin_key, "id": pl.id, "title": pl.title,
            "severity": pl.severity, "seeded": True,
            "source": "connector" if pl.benchmark == CONNECTOR_BENCHMARK else "aws",
            "checks_matched": len(b["checks"]),
            "control_status": st,
            "in_scope": in_scope,
            "last_run": _run_out(run) if run else None,
            "binding": binding_source,
            # Flat unique tokens for the FE chips (not a per-check map).
            "covers": sorted({
                str(t).strip()
                for cid in ids
                for t in (check_covers.get(cid) or [])
                if str(t).strip()
            }),
            "check_ids": sorted(ids),
        })
    bound_list = [{"plugin": b["plugin"], "checks": [{"id": x} for x in b["checks"]],
                   "provider": b.get("provider")} for b in bound.values()]
    return linked, statuses, _coverage_for(bound_list, connected, automatable), binding_source


def _check_index(db: Session) -> Dict[str, Any]:
    """Index checks by SOC 2 code (fallback) and by SCF id from covers.

    Returns ``{"soc2": {code: [(plugin, check_ids)]}, "scf": {scf_id: [...]},
    "check_covers": {check_id: [tokens]}}``.
    """
    soc2: Dict[str, List[Any]] = defaultdict(list)
    scf: Dict[str, List[Any]] = defaultdict(list)
    check_covers: Dict[str, List[str]] = {}

    for p in (db.query(CompliancePlugin)
              .filter(CompliancePlugin.benchmark.in_([BENCHMARK, CONNECTOR_BENCHMARK]),
                      CompliancePlugin.enabled.is_(True)).all()):
        if p.benchmark == CONNECTOR_BENCHMARK:
            provider = (p.check_definition or {}).get("provider")
            for c in provider_checks(provider):
                cid = c.get("id")
                cset = {cid} if cid else set()
                for code in c.get("controls") or []:
                    soc2[code].append((p, cset))
                covers = covers_for_check(c)
                if cid and covers:
                    check_covers[cid] = covers
                    for target in scf_targets_from_covers(covers):
                        scf[target].append((p, cset))
        elif p.rule_id:
            soc2[p.rule_id].append((p, set()))
            # Quantitative AWS plugins: look up cloud checks by rule's sibling
            # covers via check id when the plugin is a transport provider.
            provider = (p.check_definition or {}).get("provider")
            if provider:
                for c in provider_checks(provider):
                    cid = c.get("id")
                    covers = covers_for_check(c)
                    if cid and covers:
                        check_covers[cid] = covers
                        for target in scf_targets_from_covers(covers):
                            scf[target].append((p, {cid}))
    return {"soc2": soc2, "scf": scf, "check_covers": check_covers}


#: The Overview's library rows: SCF catalogue controls and tenant-authored ones
#: read the same way, so every panel counts both without a second code path.
_LibRow = namedtuple(
    "_LibRow",
    "scf_id domain_identifier domain_name is_material pptdf ao_count conformity_cadence",
)


def _custom_library_rows(
    db: Session, tenant_id: int, scf_scope, in_scope_only: bool, customs: List[Any],
) -> List[Any]:
    """Tenant-authored controls as library rows.

    In scope, a custom control counts when the tenant has not marked it
    inapplicable — the same decision the SCF controls go through, made by hand
    rather than by the applicability rules.
    """
    if not customs:
        return []
    states = (scf_own.states_by_scf_id(db, tenant_id, scf_scope.id)
              if (in_scope_only and scf_scope is not None) else {})
    profiles = {
        pr.normalized_control_id: pr
        for pr in db.query(CustomControlProfile).filter(
            CustomControlProfile.normalized_control_id.in_([c.id for c in customs])).all()
    }
    rows = []
    for nc in customs:
        code = nc.scf_id or nc.code
        state = states.get(code)
        if in_scope_only and state is not None and state.is_applicable is False:
            continue
        prof = profiles.get(nc.id)
        rows.append(_LibRow(
            scf_id=code,
            domain_identifier=None,
            domain_name=nc.domain or (prof.category if prof else None) or "Custom controls",
            is_material=False,
            pptdf=nc.pptdf,
            ao_count=0,
            conformity_cadence=nc.conformity_cadence,
        ))
    return rows


@common_router.get("/overview")
def common_controls_overview(
    scope: str = Query("in_scope", description="in_scope | all"),
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """One screen for the state of the common control library.

    Six questions, each answered from the system that actually knows: what the
    library contains (SCF), what a check can assert (the plugin engine), which
    frameworks it discharges (the crosswalk), what evidence it asks for (the
    consolidated sets), who owns it and whether it was tested (the control
    workbench), and which way the numbers moved (the assurance snapshots).

    Where a system holds nothing yet the count is zero and the caller is told
    which system it came from, because "0 implemented" and "implementation is
    not tracked here yet" are different statements and only one is true today.

    ``scope=in_scope`` (default) restricts aggregates to the default SCF scope.
    """
    tenant_id = get_user_primary_tenant(current_user, db)
    release = (
        db.query(SCFRelease)
        .filter(SCFRelease.import_status == "ready", SCFRelease.is_current.is_(True))
        .first()
    )
    if release is None:
        raise HTTPException(status_code=409, detail="No SCF release imported for this tenant")

    scope_mode = scope if isinstance(scope, str) else "in_scope"
    scope_mode = (scope_mode or "in_scope").strip().lower()
    if scope_mode not in ("in_scope", "all"):
        raise HTTPException(400, "scope must be 'in_scope' or 'all'")

    scf_scope = None
    applicable: Optional[set] = None
    scope_status = "all"
    try:
        scf_scope = ensure_default_scope(db, tenant_id)
    except RuntimeError:
        scf_scope = None

    if scope_mode == "in_scope" and scf_scope is not None:
        fw_slugs = list(scf_scope.framework_slugs or [])
        if not fw_slugs and int(scf_scope.esp_level or 0) <= 0:
            total = (
                db.query(func.count(SCFControl.id))
                .filter(SCFControl.release_id == release.id)
                .scalar() or 0
            )
            return {
                "release": release.version,
                "scope_status": "unconfigured",
                "scope": {
                    "framework_slugs": [],
                    "applicable_count": 0,
                    "total_count": total,
                },
                "library": {
                    "controls": 0, "custom": 0, "domains": 0, "material": 0,
                    "orphans": 0, "objectives": 0,
                    "pptdf": {}, "cadence": {}, "by_domain": [],
                },
                "automation": {
                    "controls_with_checks": 0, "checks_bound": 0,
                    "plugins_enabled": 0, "plugins_run": 0,
                    "last_run_at": None, "posture": {},
                },
                "connector_categories": [],
                "collection": {"connectors": [], "counts": {}, "stale_after_days": COLLECTION_STALE_DAYS},
                "frameworks": [],
                "crosswalk": {"rows": 0, "by_match_mode": {}, "reviewed": 0},
                "evidence": {"controls_with_set": 0, "artifacts": 0, "by_method": {}, "top_owners": []},
                "message": "No frameworks selected in SCF scope — configure scope before viewing in-scope controls.",
            }
        applicable = get_applicable_scf_ids(db, tenant_id, scf_scope.id)
        scope_status = "in_scope"

    controls = (
        db.query(SCFControl.scf_id, SCFControl.domain_identifier, SCFControl.domain_name,
                 SCFControl.is_material, SCFControl.pptdf, SCFControl.ao_count,
                 SCFControl.conformity_cadence)
        .filter(SCFControl.release_id == release.id)
        .order_by(SCFControl.sort_key)
        .all()
    )
    total_count = len(controls)
    if applicable is not None:
        controls = [c for c in controls if c.scf_id in applicable]
    # Tenant-authored controls are part of the library: they carry requirements,
    # checks, evidence and testing like any other, so every panel counts them.
    customs = scf_custom.list_custom_for_tenant(db, tenant_id, include_retired=False)
    custom_rows = _custom_library_rows(db, tenant_id, scf_scope, applicable is not None, customs)
    custom_codes = {r.scf_id for r in custom_rows}
    customs = [c for c in customs if (c.scf_id or c.code) in custom_codes]
    controls = list(controls) + custom_rows
    total_count += len(custom_rows)
    in_list = {c.scf_id for c in controls}
    # In scope, every panel speaks for the frameworks the tenant selected: the
    # crosswalk, requirement counts, required evidence, testing and collectors.
    scope_fws = _scope_frameworks(scf_scope) if scope_status == "in_scope" else []
    scope_slugs = {f["key"] for f in scope_fws}

    # ── crosswalk: frameworks per control, and how firm each claim is ──────────
    suppressed, retargets = _mapping_reviews(db, tenant_id)
    fw_of: Dict[str, set] = defaultdict(set)
    soc2_of: Dict[str, List[str]] = defaultdict(list)
    inferred: Dict[str, set] = defaultdict(set)
    fw_reqs: Dict[str, set] = defaultdict(set)
    fw_controls: Dict[str, set] = defaultdict(set)
    codes_of: Dict[str, Dict[str, set]] = defaultdict(lambda: defaultdict(set))
    mapping_modes: Counter = Counter()
    for scf_id, slug, code, mode in (
        db.query(SCFMapping.scf_id, SCFMapping.source_slug,
                 SCFMapping.requirement_code, SCFMapping.match_mode)
        .filter(SCFMapping.release_id == release.id,
                SCFMapping.provenance.in_(("resolver", "ai")))
        .all()
    ):
        effective = _effective_mapping_scf(slug, code, scf_id, suppressed, retargets)
        if effective is None:
            continue
        if slug == "soc2":
            # checks bind through SOC 2 criteria whatever the scope, as on the list
            soc2_of[effective].append(code)
        if scope_slugs and (slug not in scope_slugs or effective not in in_list):
            continue
        fw_of[effective].add(slug)
        fw_controls[slug].add(effective)
        fw_reqs[slug].add(code)
        codes_of[effective][slug].add(code)
        mapping_modes[mode or "exact"] += 1
        if mode and mode != "exact":
            # a requirement, not a row: one code mapped to five controls by parent
            # rollup is one inferred requirement, not five
            inferred[slug].add(code)
    if scope_slugs:
        # SCF's own crosswalk puts a control in scope through requirements our
        # library does not carry; count those controls under their framework too.
        for scf_id, by_slug in _published_scope_codes(
                db, release.id, sorted(scope_slugs), suppressed, retargets).items():
            if scf_id not in in_list:
                continue
            for slug, codes in by_slug.items():
                fw_of[scf_id].add(slug)
                fw_controls[slug].add(scf_id)
                codes_of[scf_id][slug].update(codes)

    if custom_codes:
        published_for_custom = (
            _published_scope_codes(db, release.id, sorted(scope_slugs), suppressed, retargets)
            if scope_slugs else {}
        )
        for nc in customs:
            code = nc.scf_id or nc.code
            merged = scf_custom.merge_requirements(
                scf_custom.requirements_for_custom(db, nc),
                scf_custom.inherited_requirements_from_scf(
                    db, release.id, nc.implements_scf_ids, suppressed, retargets),
            )
            for sid in (nc.implements_scf_ids or []):
                for slug, codes in (published_for_custom.get(sid) or {}).items():
                    bucket = merged.setdefault(slug, [])
                    have = {i["code"] for i in bucket}
                    bucket.extend({"code": c} for c in codes if c not in have)
            for slug, items in merged.items():
                if scope_slugs and slug not in scope_slugs:
                    continue
                codes = {i["code"] for i in items}
                fw_of[code].add(slug)
                fw_controls[slug].add(code)
                fw_reqs[slug] |= codes
                codes_of[code][slug] |= codes

    # ── automation: what a check can currently assert ─────────────────────────
    cadence_of = {c.scf_id: c.conformity_cadence for c in controls}
    connected_now = _connected_providers(db, tenant_id)
    automatable_now = _automatable_controls(db, release.id)
    idx = _check_index(db)
    plugin_ids = {
        p.id
        for bucket in (idx.get("soc2") or {}, idx.get("scf") or {})
        for lst in bucket.values()
        for p, _ in lst
    }
    latest = _latest_runs_by_plugin(db, tenant_id, sorted(plugin_ids))
    status_of: Dict[str, str] = {}
    checks_per_control: Dict[str, int] = {}
    scf_keys = (set(soc2_of.keys()) | set((idx.get("scf") or {}).keys())) & in_list
    for scf_id in scf_keys:
        codes = soc2_of.get(scf_id) or []
        linked, statuses, _cov, _src = _linked_from_index(
            idx, latest, connected_now, codes, cadence_of.get(scf_id),
            scf_id in automatable_now,
            scf_id=scf_id, db=db, tenant_id=tenant_id,
        )
        if not linked:
            continue
        checks_per_control[scf_id] = len(linked)
        status_of[scf_id] = _aggregate_status(statuses) if statuses else "connect_one"

    for nc in customs:
        code = nc.scf_id or nc.code
        if not nc.bound_check_ids:
            continue
        linked, statuses, _cov, _src = _bound_checks_payload(
            db, tenant_id, code, list(nc.bound_check_ids), idx=idx, latest=latest,
            connected=connected_now, cadence=nc.conformity_cadence,
        )
        if not linked:
            continue
        checks_per_control[code] = len(linked)
        status_of[code] = _aggregate_status(statuses) if statuses else "connect_one"

    now = datetime.utcnow()

    # ── connector categories: which one to connect, and what it unlocks ────────
    # The library-level form of the question each control page asks. A tenant
    # needs any one source per category, so the useful number is how many
    # controls a category can reach and how many of those are waiting on it —
    # automatable, but with nothing connected that proves them.
    cat_controls: Dict[str, set] = defaultdict(set)
    cat_providers: Dict[str, Dict[str, int]] = defaultdict(dict)
    for scf_id in scf_keys:
        codes = soc2_of.get(scf_id) or []
        seen_plugins: set = set()
        for p, cids in (idx.get("scf") or {}).get(scf_id, []):
            seen_plugins.add(p.id)
            prov = (p.check_definition or {}).get("provider") or (
                "aws" if p.runner_type == "aws_readonly" else None)
            if not prov:
                continue
            cat = (PROVIDER_API.get(prov) or {}).get("category") or "other"
            cat_controls[cat].add(scf_id)
            cat_providers[cat][prov] = cat_providers[cat].get(prov, 0) + 1
        for code in codes:
            for p, cids in (idx.get("soc2") or {}).get(code, []):
                if p.id in seen_plugins:
                    continue
                prov = (p.check_definition or {}).get("provider") or (
                    "aws" if p.runner_type == "aws_readonly" else None)
                if not prov:
                    continue
                cat = (PROVIDER_API.get(prov) or {}).get("category") or "other"
                cat_controls[cat].add(scf_id)
                cat_providers[cat][prov] = cat_providers[cat].get(prov, 0) + 1
    connector_categories = []
    for cat, reach in cat_controls.items():
        provs = cat_providers[cat]
        live = sorted(p for p in provs if p in connected_now)
        waiting = {s for s in reach if status_of.get(s) == "connect_one"}
        connector_categories.append({
            "category": cat,
            "connected": bool(live),
            "connected_providers": [
                {"provider": p, "label": (PROVIDER_API.get(p) or {}).get("label", p)} for p in live],
            "providers": sorted(
                ({"provider": p, "label": (PROVIDER_API.get(p) or {}).get("label", p),
                  "connected": p in connected_now, "bindings": n} for p, n in provs.items()),
                key=lambda x: (not x["connected"], -x["bindings"], x["label"])),
            "controls_reachable": len(reach),
            # controls this category could move out of connect_one if connected
            "controls_waiting": len(waiting),
        })
    # unconnected categories that unlock the most controls come first
    connector_categories.sort(key=lambda c: (c["connected"], -c["controls_waiting"],
                                             -c["controls_reachable"], c["category"]))

    # ── collection health: a broken collector is not a broken control ─────────
    # A run that FAILED still collected — its checks came back negative. Only an
    # errored run means we could not look, so those are the only ones excluded
    # from "last successful collection".
    last_ok: Dict[int, datetime] = {}
    if plugin_ids:
        last_ok = dict(
            db.query(CompliancePluginRun.plugin_id, func.max(CompliancePluginRun.started_at))
            .filter(CompliancePluginRun.tenant_id == tenant_id,
                    CompliancePluginRun.plugin_id.in_(sorted(plugin_ids)),
                    CompliancePluginRun.status.in_(("passed", "failed")))
            .group_by(CompliancePluginRun.plugin_id).all())
    plugin_meta = {
        p.id: p
        for bucket in (idx.get("soc2") or {}, idx.get("scf") or {})
        for lst in bucket.values()
        for p, _ in lst
    }
    controls_per_plugin: Counter = Counter()
    for scf_id in scf_keys:
        codes = soc2_of.get(scf_id) or []
        pids = {p.id for p, _ in (idx.get("scf") or {}).get(scf_id, [])}
        for code in codes:
            pids.update(p.id for p, _ in (idx.get("soc2") or {}).get(code, []))
        for pid in pids:
            controls_per_plugin[pid] += 1
    if applicable is not None:
        # a collector that evidences none of the in-scope controls is not this scope's business
        plugin_meta = {pid: p for pid, p in plugin_meta.items() if controls_per_plugin.get(pid)}
        plugin_ids = set(plugin_meta)
        latest = {pid: run for pid, run in latest.items() if pid in plugin_ids}

    collection: List[Dict[str, Any]] = []
    coll_counts: Counter = Counter()
    for pid, p in sorted(plugin_meta.items(), key=lambda kv: kv[1].plugin_key or ""):
        run = latest.get(pid)
        ok_at = last_ok.get(pid)
        days = (now - ok_at).days if ok_at else None
        if run is None:
            state = "never_run"
        elif run.status == "error" or ok_at is None:
            state = "failing"
        elif days is not None and days > COLLECTION_STALE_DAYS:
            state = "stale"
        else:
            state = "healthy"
        coll_counts[state] += 1
        if state == "never_run":       # 74 of 75 unconfigured checks is not a worklist
            continue
        collection.append({
            "plugin_key": p.plugin_key, "title": p.title,
            "provider": (p.check_definition or {}).get("provider"),
            "state": state,
            "last_success_at": ok_at.isoformat() if ok_at else None,
            "days_since_success": days,
            "last_attempt_at": run.started_at.isoformat() if run and run.started_at else None,
            "error": (run.error_message or run.result_summary) if run and state == "failing" else None,
            "controls_affected": controls_per_plugin.get(pid, 0),
        })
    collection.sort(key=lambda c: ({"failing": 0, "stale": 1, "healthy": 2}[c["state"]],
                                   -c["controls_affected"]))

    # ── evidence: what the in-scope frameworks ask for, or the consolidated sets ─
    if scope_fws:
        # the same asks the control page lists: each in-scope requirement's own evidence
        ev = {}
        for c in controls:
            asks = scoped_required_evidence({s: sorted(v) for s, v in (codes_of.get(c.scf_id) or {}).items()},
                                            scope_fws, automated=c.scf_id in checks_per_control)
            if asks:
                ev[c.scf_id] = {"artifacts": asks}
    else:
        ev = {k: v for k, v in _consolidated_evidence().items() if k in in_list}
        for code in custom_codes:
            arts = consolidated_artifacts_for(db, tenant_id, code)
            if arts:
                ev.setdefault(code, {"artifacts": arts})
    for nc in customs:
        code = nc.scf_id or nc.code
        authored = _authored_evidence(nc)
        if not authored:
            continue
        entry = ev.setdefault(code, {"artifacts": []})
        have = {(a.get("name") or "").strip().lower() for a in entry["artifacts"]}
        entry["artifacts"] = list(entry["artifacts"]) + [
            a for a in authored if a["name"].strip().lower() not in have]
    ev_owners: Counter = Counter()
    ev_method: Counter = Counter()
    ev_artifacts = 0
    for entry in ev.values():
        for a in entry.get("artifacts") or []:
            ev_artifacts += 1
            ev_method[a.get("collection_method") or "manual"] += 1
            if a.get("owner"):
                ev_owners[a["owner"]] += 1

    # ── assurance: ownership and testing live in the control workbench ────────
    scf_of_norm = {nid: sid for nid, sid in
                   db.query(NormalizedControl.id, NormalizedControl.scf_id)
                   .filter(NormalizedControl.scf_id.isnot(None)).all()}
    assurance = {k: 0 for k in ("tracked", "assigned", "implemented", "tested", "effective",
                                "partially_effective", "ineffective", "overdue",
                                "evidence_pending")}
    impl_status: Counter = Counter()
    assured_of: Dict[str, Dict[str, Any]] = {}
    work_ids: List[int] = []
    for wi in (db.query(ControlWorkItem)
               .filter(ControlWorkItem.tenant_id == tenant_id,
                       ControlWorkItem.source_type == "normalized").all()):
        scf_id = scf_of_norm.get(wi.source_id)
        if not scf_id or scf_id not in in_list:
            continue
        work_ids.append(wi.id)
        assurance["tracked"] += 1
        impl_status[wi.implementation_status or "not_started"] += 1
        if wi.assigned_user_ids or wi.assigned_to_user_id:
            assurance["assigned"] += 1
        if wi.implementation_status in ("implemented", "verified"):
            assurance["implemented"] += 1
        eff = wi.operating_effectiveness or wi.design_effectiveness
        if eff and eff != "not_tested":
            assurance["tested"] += 1
            if eff in assurance:
                assurance[eff] += 1
        elif wi.last_tested_at:
            assurance["tested"] += 1
        if wi.next_test_date and wi.next_test_date < now:
            assurance["overdue"] += 1
        assured_of[scf_id] = {"implementation_status": wi.implementation_status,
                              "effectiveness": eff}
    if work_ids:
        assurance["evidence_pending"] = (
            db.query(func.count(ControlWorkEvidence.id))
            .filter(ControlWorkEvidence.tenant_id == tenant_id,
                    ControlWorkEvidence.work_item_id.in_(work_ids),
                    ControlWorkEvidence.review_status == "pending").scalar() or 0)

    # ── per-domain rollup: the category axis ──────────────────────────────────
    doms: Dict[str, Dict[str, Any]] = {}
    pptdf: Counter = Counter()
    cadence: Counter = Counter()
    posture: Counter = Counter()
    material = orphans = 0
    for scf_id, dom_id, dom, is_material, pp, ao, cad in controls:
        d = doms.setdefault(dom or "Unclassified", {
            "domain": dom or "Unclassified", "identifier": dom_id, "controls": 0,
            "material": 0, "with_checks": 0, "with_evidence": 0, "frameworks": set(),
            "tracked": 0, "implemented": 0, "objectives": 0})
        d["controls"] += 1
        d["objectives"] += ao or 0
        d["frameworks"] |= fw_of.get(scf_id, set())
        pptdf[pp or "Unspecified"] += 1
        cadence[cad or "Unspecified"] += 1
        if is_material:
            material += 1
            d["material"] += 1
        if not fw_of.get(scf_id) and scf_id not in custom_codes:
            orphans += 1
        if scf_id in checks_per_control:
            d["with_checks"] += 1
        if scf_id in ev:
            d["with_evidence"] += 1
        a = assured_of.get(scf_id)
        if a:
            d["tracked"] += 1
            if a["implementation_status"] in ("implemented", "verified"):
                d["implemented"] += 1
        # A control no check reaches is only `manual` if SCF says no machine could
        # assess it. Otherwise it is `unbound`: a check-authoring gap, not a
        # property of the control.
        posture[status_of.get(scf_id) or
                ("unbound" if scf_id in automatable_now else "manual")] += 1
    by_domain = sorted(
        ({**d, "frameworks": len(d["frameworks"])} for d in doms.values()),
        key=lambda x: -x["controls"])

    # ── review progress on the crosswalk itself ───────────────────────────────
    reviewed_q = db.query(func.count(SCFMappingReview.id)).filter(SCFMappingReview.tenant_id == tenant_id)
    if scope_slugs:
        reviewed_q = reviewed_q.filter(SCFMappingReview.source_slug.in_(sorted(scope_slugs)))
    reviewed = reviewed_q.scalar() or 0

    # Same source as `assurance`, so the series moves with it. The snapshot's own
    # `controls` count is deliberately not carried: it counts the workbench's
    # framework controls, a different denominator from the 1,534 here, and putting
    # the two numbers on one screen invites reading a ratio that does not exist.
    trend = [
        {"date": s.snapshot_date, "tested": s.tested,
         "effective": s.effective, "assigned": s.assigned, "overdue": s.overdue}
        for s in (db.query(ControlAssuranceSnapshot)
                  .filter(ControlAssuranceSnapshot.tenant_id == tenant_id)
                  .order_by(ControlAssuranceSnapshot.snapshot_date.desc())
                  .limit(30).all())
    ][::-1]

    disp = _disposition_index().get("frameworks", {})
    frameworks = []
    # in scope: every selected framework, in the order chosen, even one with nothing mapped yet
    for slug in ([f["key"] for f in scope_fws] if scope_fws else sorted(fw_controls)):
        counts = (disp.get(slug) or {}).get("counts") or {}
        n = len(fw_reqs[slug])
        frameworks.append({
            "key": slug, "label": _FW_LABELS.get(slug, slug.replace("_", " ").title()),
            "controls": len(fw_controls[slug]), "requirements": n,
            "requirement_total": (disp.get(slug) or {}).get("total"),
            "counts": counts,
            # the share of this framework's mapped requirements that were inferred
            # from a broader or narrower code rather than matched on it
            "inferred": len(inferred.get(slug, ())),
            "inferred_pct": round(100 * len(inferred.get(slug, ())) / n, 1) if n else 0.0,
        })
    if not scope_fws:
        frameworks.sort(key=lambda f: -f["requirements"])

    last_run = max((r.started_at for r in latest.values() if r.started_at), default=None)
    return {
        "release": release.version,
        "scope_status": scope_status,
        "scope": {
            "framework_slugs": list((scf_scope.framework_slugs if scf_scope else None) or []),
            "frameworks": scope_fws,
            "applicable_count": len(applicable) if applicable is not None else len(controls),
            "total_count": total_count,
        },
        "library": {
            "controls": len(controls), "custom": len(custom_rows),
            "domains": len(doms), "material": material,
            "orphans": orphans, "objectives": sum(d["objectives"] for d in by_domain),
            "pptdf": dict(pptdf), "cadence": dict(cadence), "by_domain": by_domain,
        },
        "automation": {
            "controls_with_checks": len(checks_per_control),
            "checks_bound": sum(checks_per_control.values()),
            "plugins_enabled": len(plugin_ids),
            "plugins_run": len(latest),
            "last_run_at": last_run.isoformat() if last_run else None,
            "posture": dict(posture),
        },
        # Deliberately its own block, not folded into posture: a connector that
        # cannot authenticate tells you nothing about the control, and the two
        # belong on separate lines of the same screen.
        "connector_categories": connector_categories,
        "collection": {"connectors": collection, "counts": dict(coll_counts),
                       "stale_after_days": COLLECTION_STALE_DAYS},
        "frameworks": frameworks,
        "crosswalk": {"rows": sum(mapping_modes.values()), "by_match_mode": dict(mapping_modes),
                      "reviewed": reviewed},
        "evidence": {
            "controls_with_set": len(ev), "artifacts": ev_artifacts,
            "by_method": dict(ev_method),
            "top_owners": [{"owner": o, "artifacts": n} for o, n in ev_owners.most_common(8)],
        },
        # `source` names the system so an empty panel reads as "not tracked here
        # yet" rather than "nothing is implemented".
        "assurance": {**assurance, "by_implementation_status": dict(impl_status),
                      "source": "control workbench"},
        "trend": trend,
    }


@common_router.get("/review-queue")
def mapping_review_queue(
    framework: Optional[str] = None,
    limit: int = 50,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """Mappings a reviewer should look at, worst first.

    Ranked by how likely the row is to be wrong and how much rests on it:
    lowest confidence first, then fan-out — a requirement claiming many controls
    or a control claimed by many requirements is diluted either way — then
    material controls, because a wrong mapping there costs the most. Rows the
    reviewer has already ruled on never come back.
    """
    tenant_id = get_user_primary_tenant(current_user, db)
    release = (
        db.query(SCFRelease)
        .filter(SCFRelease.import_status == "ready", SCFRelease.is_current.is_(True))
        .order_by(desc(SCFRelease.imported_at))
        .first()
    )
    if release is None:
        raise HTTPException(503, "No SCF release is loaded")

    decided = {
        (r.source_slug, r.requirement_code, r.scf_id)
        for r in db.query(SCFMappingReview.source_slug,
                          SCFMappingReview.requirement_code,
                          SCFMappingReview.scf_id)
        .filter(SCFMappingReview.tenant_id == tenant_id).all()
    }

    q = (
        db.query(SCFMapping.source_slug, SCFMapping.requirement_code, SCFMapping.scf_id,
                 SCFMapping.confidence, SCFMapping.match_mode, SCFMapping.provenance)
        .filter(SCFMapping.release_id == release.id,
                SCFMapping.provenance != "scf")     # SCF's own rows are not ours to review
    )
    if framework:
        q = q.filter(SCFMapping.source_slug == framework)
    rows = q.all()

    # fan-out both ways, computed once over the candidate set
    per_req = Counter((r.source_slug, r.requirement_code) for r in rows)
    per_ctl = Counter((r.source_slug, r.scf_id) for r in rows)
    material = {
        c.scf_id for c in db.query(SCFControl.scf_id)
        .filter(SCFControl.release_id == release.id, SCFControl.is_material.is_(True)).all()
    }
    labels = _requirement_index()

    out = []
    for r in rows:
        key = (r.source_slug, r.requirement_code, r.scf_id)
        if key in decided:
            continue
        conf = float(r.confidence or 0)
        fan = per_req[(r.source_slug, r.requirement_code)] + per_ctl[(r.source_slug, r.scf_id)]
        meta = (labels.get(r.source_slug) or {}).get(r.requirement_code) or {}
        out.append({
            "source_slug": r.source_slug,
            "framework": _FW_LABELS.get(r.source_slug, r.source_slug.replace("_", " ").title()),
            "requirement_code": r.requirement_code,
            "reference": meta.get("reference") or r.requirement_code,
            "requirement_title": meta.get("title"),
            "scf_id": r.scf_id,
            "confidence": conf,
            "match_mode": r.match_mode,
            "provenance": r.provenance,
            "fan_out": fan,
            "is_material": r.scf_id in material,
            # ascending confidence, then most diluted, then material first
            "_rank": (conf, -fan, 0 if r.scf_id in material else 1),
        })
    out.sort(key=lambda x: x.pop("_rank"))
    return {
        "release": release.version,
        "remaining": len(out),
        "reviewed": len(decided),
        "items": out[: max(1, min(limit, 200))],
    }


@common_router.post("/review")
def record_mapping_review(
    body: MappingReviewBody,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _perm: bool = Depends(_require_scan_perm),
):
    """Record one standing decision. Idempotent on the mapping's identity."""
    tenant_id = get_user_primary_tenant(current_user, db)
    verdict = (body.verdict or "").strip().lower()
    if verdict not in _VERDICTS:
        raise HTTPException(400, f"verdict must be one of {sorted(_VERDICTS)}")
    if verdict == "retargeted" and not (body.retarget_scf_id or "").strip():
        raise HTTPException(400, "retargeted requires retarget_scf_id")

    release = (
        db.query(SCFRelease)
        .filter(SCFRelease.import_status == "ready", SCFRelease.is_current.is_(True))
        .order_by(desc(SCFRelease.imported_at))
        .first()
    )
    row = (
        db.query(SCFMappingReview)
        .filter(SCFMappingReview.tenant_id == tenant_id,
                SCFMappingReview.source_slug == body.source_slug,
                SCFMappingReview.requirement_code == body.requirement_code,
                SCFMappingReview.scf_id == body.scf_id)
        .first()
    )
    before = {"verdict": row.verdict, "retarget_scf_id": row.retarget_scf_id} if row is not None else None
    if row is None:
        row = SCFMappingReview(tenant_id=tenant_id, source_slug=body.source_slug,
                               requirement_code=body.requirement_code, scf_id=body.scf_id)
        db.add(row)
    row.verdict = verdict
    row.retarget_scf_id = (body.retarget_scf_id or None) if verdict == "retargeted" else None
    row.note = body.note or None
    row.reviewed_by = current_user.id
    row.reviewed_at = datetime.utcnow()
    row.release_version = release.version if release else None
    label = _FW_LABELS.get(body.source_slug, body.source_slug)
    write_rich_audit_log(
        db=db, tenant_id=tenant_id, user_id=current_user.id, action="mapping_review",
        resource_type="controls_automation", resource_name=body.scf_id,
        resource_url=f"/automation/soc2-controls/{body.scf_id}",
        summary=f"{verdict.capitalize()} the mapping {label} {body.requirement_code} → {body.scf_id}"
                + (f" (to {row.retarget_scf_id})" if row.retarget_scf_id else ""),
        before=before, after={"verdict": verdict, "retarget_scf_id": row.retarget_scf_id, "note": row.note},
    )
    db.commit()
    return {"ok": True, "verdict": verdict,
            "identity": [body.source_slug, body.requirement_code, body.scf_id]}


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


def _normalized_control_id(db: Session, scf_id: str, tenant_id: Optional[int] = None) -> Optional[int]:
    """The evidence module links to grc_normalized_controls, which carries scf_id.

    Catalogue rows have no tenant; an authored control belongs to one, so pass
    the tenant to keep another tenant's code from resolving here.
    """
    q = db.query(NormalizedControl.id).filter(NormalizedControl.scf_id == scf_id)
    if tenant_id is not None:
        q = q.filter(or_(NormalizedControl.tenant_id.is_(None),
                         NormalizedControl.tenant_id == tenant_id))
    row = q.order_by(NormalizedControl.id.desc()).first()
    return row[0] if row else None


@common_router.get("/controls/{scf_id}/evidence")
def list_control_evidence(
    scf_id: str,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """Evidence a person has attached to this control.

    Distinct from what a collector asserted: this is the manual and hybrid half,
    the policy PDF or the access-review export, which no API produces.
    """
    from grc.models import Evidence, EvidenceControlMapping

    tenant_id = get_user_primary_tenant(current_user, db)
    nc_id = _normalized_control_id(db, scf_id, tenant_id)
    if nc_id is None:
        return {"scf_id": scf_id, "items": []}
    rows = (
        db.query(Evidence, EvidenceControlMapping)
        .join(EvidenceControlMapping, EvidenceControlMapping.evidence_id == Evidence.id)
        .filter(Evidence.tenant_id == tenant_id,
                EvidenceControlMapping.normalized_control_id == nc_id)
        .order_by(Evidence.uploaded_at.desc())
        .all()
    )
    return {"scf_id": scf_id, "items": [{
        "evidence_id": e.id, "mapping_id": m.id, "name": e.name,
        "description": e.description, "file_name": e.file_name, "file_type": e.file_type,
        "evidence_type": e.evidence_type, "status": e.status,
        "uploaded_at": e.uploaded_at.isoformat() if e.uploaded_at else None,
        "expiry_date": e.expiry_date.isoformat() if e.expiry_date else None,
        "is_stale": bool(e.is_stale), "coverage_type": m.coverage_type,
    } for e, m in rows]}


def _related_controls(db: Session, release_id: int, scf_id: str, limit: int = 10,
                      slugs: Optional[set] = None, applicable: Optional[set] = None,
                      pairs: Optional[set] = None, include_family: bool = True) -> Dict[str, Any]:
    """Controls genuinely related to this one, as two different kinds of relatedness.

    The page used to call two controls related if they shared ONE requirement, and
    then showed the first 12 alphabetically. A broad requirement such as "have an
    information security policy" maps to dozens of controls, so the list was
    mostly noise: IAC-06 Multi-Factor Authentication listed BCD-11 backups, and
    its own MFA sub-controls never appeared because they sort after the cut-off.

    family            SCF's own structure. IAC-06.1 is a sub-control of IAC-06;
                      that is a fact in the catalogue, not an inference.
    by_requirements   ranked by rarity-weighted overlap. A requirement shared by
                      two controls is strong evidence they belong together; one
                      shared by thirty-seven is barely any. Each shared requirement
                      contributes 1/ln(1 + number of controls it maps to).

    With a scope (slugs, applicable) only in-scope frameworks' requirements count
    and only in-scope controls are returned.

    A tenant-authored control has no place in the SCF family tree, so it passes
    its own requirement pairs and asks for the second half only.
    """
    import math

    family: List[Dict[str, Any]] = []
    if include_family:
        base = (db.query(SCFControl.base_scf_id)
                .filter(SCFControl.release_id == release_id, SCFControl.scf_id == scf_id).scalar()) or scf_id.split(".")[0]
        family = [
            {"control_id": s, "title": n}
            for s, n in (db.query(SCFControl.scf_id, SCFControl.name)
                         .filter(SCFControl.release_id == release_id,
                                 (SCFControl.base_scf_id == base) | (SCFControl.scf_id == base),
                                 SCFControl.scf_id != scf_id)
                         .order_by(SCFControl.sort_key).all())
            if applicable is None or s in applicable
        ]
    family_ids = {f["control_id"] for f in family}

    live = (SCFMapping.release_id == release_id, SCFMapping.provenance.in_(("resolver", "ai")))
    mine = pairs if pairs is not None else {
        (fw, code) for fw, code in
        db.query(SCFMapping.source_slug, SCFMapping.requirement_code)
        .filter(*live, SCFMapping.scf_id == scf_id).distinct().all()
        if not slugs or fw in slugs}
    if not mine:
        return {"family": family, "by_requirements": []}

    from sqlalchemy import tuple_

    holders: Dict[tuple, set] = defaultdict(set)
    # one query for every requirement at once, bounded by this control's
    # requirements x their fan-out rather than the whole catalogue
    for fw, code, s in (db.query(SCFMapping.source_slug, SCFMapping.requirement_code, SCFMapping.scf_id)
                        .filter(*live, tuple_(SCFMapping.source_slug, SCFMapping.requirement_code)
                                .in_(sorted(mine)))
                        .distinct().all()):
        holders[(fw, code)].add(s)

    score: Dict[str, float] = defaultdict(float)
    shared: Dict[str, int] = defaultdict(int)
    reasons: Dict[str, List[tuple]] = defaultdict(list)
    for req, ctrls in holders.items():
        weight = 1.0 / math.log(1 + len(ctrls))
        for other in ctrls:
            if other != scf_id and other not in family_ids and (applicable is None or other in applicable):
                score[other] += weight
                shared[other] += 1
                reasons[other].append((weight, req))

    top = sorted(score, key=lambda o: (-score[o], o))[:limit]
    titles = dict(db.query(SCFControl.scf_id, SCFControl.name)
                  .filter(SCFControl.release_id == release_id, SCFControl.scf_id.in_(top)).all()) if top else {}
    return {
        "family": family,
        "by_requirements": [
            {"control_id": o, "title": titles.get(o), "shared": shared[o],
             "score": round(score[o], 2),
             # the most specific shared requirements first: they are the reason
             "requirements": [f"{_FW_LABELS.get(fw, fw)} {code}"
                              for _, (fw, code) in sorted(reasons[o], key=lambda r: (-r[0], r[1]))[:3]]}
            for o in top
        ],
    }


@common_router.get("/controls/{scf_id}/artifacts")
def list_control_artifacts(
    scf_id: str,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """This control's deliverables, in the shape the Frameworks artifact UI uses.

    The Frameworks page lets a user view, assign, review, edit and download an
    artifact, through modals keyed on one framework. A control's artifacts come
    from many frameworks at once — IAC-06 draws on Aramco, CIS and MAS — so this
    returns each as a real catalogue item carrying its own framework_key and
    catalogue id, joined to the tenant's working copy where one exists. The
    frontend then reuses the Frameworks modals unchanged: one lifecycle, one
    store, no second artifact model.
    """
    from grc.models import ArtifactCatalogItem, TenantArtifact
    from grc.routers.artifacts_router import (
        _artifact_out, _ensure_catalog_seeded, _load_artifact_content,
    )

    tenant_id = get_user_primary_tenant(current_user, db)
    arts = consolidated_artifacts_for(db, tenant_id, scf_id)
    try:
        scope_fws = _scope_frameworks(ensure_default_scope(db, tenant_id))
    except RuntimeError:
        scope_fws = []
    if scope_fws:
        arts = in_scope_artifacts(arts, scope_fws)
    wanted = {a["artifact_id"]: a for a in arts if a.get("source") == "catalog" and a.get("artifact_id")}
    if not wanted:
        return {"scf_id": scf_id, "items": []}

    _ensure_catalog_seeded(db)
    catalog = (db.query(ArtifactCatalogItem)
               .filter(ArtifactCatalogItem.artifact_id.in_(sorted(wanted))).all())
    content = _load_artifact_content()

    def has_body(aid: str) -> Optional[dict]:
        # same rule as /artifacts/catalog: a key with empty content is not a
        # starter document, it is a placeholder
        for bucket in content.values():
            e = bucket.get(aid) if isinstance(bucket, dict) else None
            if e and e.get("content"):
                return e
        return None

    copies = {
        a.catalog_item_id: a
        for a in (db.query(TenantArtifact)
                  .filter(TenantArtifact.tenant_id == tenant_id,
                          TenantArtifact.catalog_item_id.in_([c.id for c in catalog]))
                  .order_by(TenantArtifact.id.desc()).all())
    }

    items = []
    for c in catalog:
        entry = has_body(c.artifact_id)
        src = wanted[c.artifact_id]
        copy = copies.get(c.id)
        items.append({
            "framework_key": c.framework_key,
            "framework_name": c.framework_name,
            "catalog": {
                "id": c.id, "artifact_id": c.artifact_id, "stage": c.stage,
                "stage_number": c.stage_number, "name": c.name,
                "artifact_type": c.artifact_type, "control_ref": c.control_ref,
                "mandatory": c.mandatory, "description": c.description,
                "format": c.format, "owner": c.owner,
                "is_platform_native": c.is_platform_native,
                "platform_data_type": c.platform_data_type,
                "has_content": entry is not None,
                "content_format": (entry.get("content_format") or "markdown") if entry else None,
            },
            "artifact": _artifact_out(copy) if copy else None,
            "required_by": src.get("required_by") or [],
            # a section-level reference attached this, which is a weaker claim
            "match_mode": src.get("match_mode"),
        })
    # working copies first, then mandatory, then the rest
    items.sort(key=lambda i: (i["artifact"] is None, not i["catalog"]["mandatory"],
                              i["catalog"]["name"]))
    return {"scf_id": scf_id, "items": items,
            "missing_from_catalog": sorted(set(wanted) - {c.artifact_id for c in catalog})}


# ── linked records (any module) ──────────────────────────────────────────────

class LinkRecordBody(BaseModel):
    type: str
    record_id: int
    note: Optional[str] = None


def _nc_for_links(db: Session, tenant_id: int, code: str) -> NormalizedControl:
    from grc.modules.scf.risk_links import ensure_normalized_for_control

    try:
        return ensure_normalized_for_control(db, tenant_id=tenant_id, scf_id_or_code=code)
    except ValueError as exc:
        raise HTTPException(404, str(exc)) from exc


def _require_link_write(db: Session, current_user: GRCUser, type_key: str) -> None:
    """The target module's own edit permission, or the control library's."""
    from grc.modules.vendor_risk.tpra.rbac import user_has_any_permission

    try:
        perms = scf_record_links.write_permissions(type_key)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    if not user_has_any_permission(db, current_user, (*perms, "controls:control_library:edit")):
        raise HTTPException(403, "Permission denied")


@common_router.get("/link-types")
def list_link_types(current_user: GRCUser = Depends(require_auth)):
    """Record types a control can be linked to."""
    return {"types": scf_record_links.list_types()}


@common_router.get("/link-targets")
def search_link_targets(
    type: str = Query(..., description="risk | asset | evidence | document | …"),
    q: Optional[str] = Query(None, description="Search text"),
    limit: int = Query(20, ge=1, le=50),
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """Records of one type to pick from. Searched on the server: a register with
    40,000 rows cannot be shipped to the browser and filtered there."""
    tenant_id = get_user_primary_tenant(current_user, db)
    try:
        items = scf_record_links.search_targets(db, tenant_id, type, q, limit)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    return {"type": type, "items": items}


@common_router.get("/controls/{scf_id}/links")
def list_control_links(
    scf_id: str,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    tenant_id = get_user_primary_tenant(current_user, db)
    nc = _nc_for_links(db, tenant_id, scf_id)
    db.commit()
    return {"scf_id": scf_id, "items": scf_record_links.list_links(db, tenant_id, nc.id)}


@common_router.post("/controls/{scf_id}/links", status_code=201)
def link_control_record(
    scf_id: str,
    body: LinkRecordBody,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """Link any record — risk, asset, evidence, document, policy statement,
    vulnerability, issue, vendor, project, task or internal control."""
    tenant_id = get_user_primary_tenant(current_user, db)
    _require_link_write(db, current_user, body.type)
    nc = _nc_for_links(db, tenant_id, scf_id)
    try:
        out = scf_record_links.link_record(
            db, tenant_id, nc, body.type, body.record_id,
            getattr(current_user, "id", None), body.note,
        )
    except ValueError as exc:
        db.rollback()
        raise HTTPException(404, str(exc)) from exc
    db.commit()
    return out


@common_router.delete("/controls/{scf_id}/links/{type}/{record_id}")
def unlink_control_record(
    scf_id: str,
    type: str,
    record_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    tenant_id = get_user_primary_tenant(current_user, db)
    _require_link_write(db, current_user, type)
    nc = _nc_for_links(db, tenant_id, scf_id)
    try:
        removed = scf_record_links.unlink_record(
            db, tenant_id, nc, type, record_id, getattr(current_user, "id", None),
        )
    except ValueError as exc:
        db.rollback()
        raise HTTPException(422, str(exc)) from exc
    if not removed:
        db.rollback()
        raise HTTPException(404, "Link not found")
    db.commit()
    return {"ok": True}


class LinkRiskBody(BaseModel):
    risk_id: int


class NewRiskBody(BaseModel):
    title: str
    description: Optional[str] = None
    category: Optional[str] = None
    inherent_likelihood: Optional[int] = None
    inherent_impact: Optional[int] = None


@common_router.get("/controls/{scf_id}/risks")
def list_control_risks(
    scf_id: str,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    tenant_id = get_user_primary_tenant(current_user, db)
    try:
        items = scf_risks.list_risks_for_control(db, tenant_id, scf_id)
    except ValueError as e:
        raise HTTPException(404, str(e)) from e
    return {"items": items}


@common_router.post("/controls/{scf_id}/risks", status_code=201)
def link_control_risk(
    scf_id: str,
    body: LinkRiskBody,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _perm: bool = Depends(_require_risk_link_edit),
):
    tenant_id = get_user_primary_tenant(current_user, db)
    try:
        link = scf_risks.link_risk(
            db, tenant_id, scf_id, body.risk_id, getattr(current_user, "id", None),
        )
        db.commit()
    except ValueError as e:
        db.rollback()
        raise HTTPException(404, str(e)) from e
    return {"link_id": link.id, "risk_id": link.risk_id,
            "normalized_control_id": link.normalized_control_id}


@common_router.delete("/controls/{scf_id}/risks/{link_id}")
def unlink_control_risk(
    scf_id: str,
    link_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _perm: bool = Depends(_require_risk_link_edit),
):
    tenant_id = get_user_primary_tenant(current_user, db)
    try:
        scf_risks.unlink_risk(
            db, tenant_id, scf_id, link_id, getattr(current_user, "id", None),
        )
        db.commit()
    except ValueError as e:
        db.rollback()
        raise HTTPException(404, str(e)) from e
    return {"ok": True}


@common_router.post("/controls/{scf_id}/risks/new", status_code=201)
def create_and_link_control_risk(
    scf_id: str,
    body: NewRiskBody,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _perm: bool = Depends(_require_risk_link_edit),
):
    """Create a tenant Risk and link it to this control.

    Decision 4: do NOT invent residual from control status — residual stays
    unset unless the Risk model / caller supplies likelihood×impact later.
    """
    from grc.models import Risk

    tenant_id = get_user_primary_tenant(current_user, db)
    title = (body.title or "").strip()
    if not title:
        raise HTTPException(422, "title required")
    category = (body.category or "compliance").strip().lower() or "compliance"
    likelihood = body.inherent_likelihood if body.inherent_likelihood in (1, 2, 3, 4, 5) else None
    impact = body.inherent_impact if body.inherent_impact in (1, 2, 3, 4, 5) else None
    inherent_score = float(likelihood * impact) if (likelihood and impact) else None

    risk = Risk(
        tenant_id=tenant_id,
        title=title[:255],
        description=body.description,
        category=category,
        risk_category=category,
        inherent_likelihood=likelihood,
        inherent_impact=impact,
        inherent_score=inherent_score,
        # residual deliberately left None — indicator status must not invent it
        status="open",
        source_type="framework_gap",
        source_reference=f"scf:{scf_id}",
        owner_id=getattr(current_user, "id", None),
    )
    db.add(risk)
    db.flush()
    try:
        link = scf_risks.link_risk(
            db, tenant_id, scf_id, risk.id, getattr(current_user, "id", None),
        )
        db.commit()
    except ValueError as e:
        db.rollback()
        raise HTTPException(404, str(e)) from e
    return {
        "risk_id": risk.id,
        "link_id": link.id,
        "title": risk.title,
        "inherent_score": risk.inherent_score,
        "residual_score": risk.residual_score,
    }


class LinkAssetBody(BaseModel):
    asset_id: int


@common_router.get("/controls/{scf_id}/assets")
def list_control_assets(
    scf_id: str,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    tenant_id = get_user_primary_tenant(current_user, db)
    try:
        items = scf_assets.list_assets_for_control(db, tenant_id, scf_id)
    except ValueError as e:
        raise HTTPException(404, str(e)) from e

    note = None
    in_scope: List[Dict[str, Any]] = []
    try:
        scf_scope = ensure_default_scope(db, tenant_id)
        in_scope = scf_assets.in_scope_assets(db, tenant_id, scf_scope)
        if not list(scf_scope.framework_slugs or []):
            note = "No frameworks in default SCF scope — in_scope list is empty."
    except Exception:  # noqa: BLE001
        note = "Could not resolve default SCF scope for in-scope assets."

    return {"items": items, "in_scope": in_scope, "note": note}


@common_router.post("/controls/{scf_id}/assets", status_code=201)
def link_control_asset(
    scf_id: str,
    body: LinkAssetBody,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _perm: bool = Depends(_require_asset_link_edit),
):
    tenant_id = get_user_primary_tenant(current_user, db)
    try:
        link = scf_assets.link_asset(
            db, tenant_id, scf_id, body.asset_id, getattr(current_user, "id", None),
        )
        db.commit()
    except ValueError as e:
        db.rollback()
        raise HTTPException(404, str(e)) from e
    return {
        "link_id": link.id,
        "asset_id": link.asset_id,
        "normalized_control_id": link.normalized_control_id,
    }


@common_router.delete("/controls/{scf_id}/assets/{link_id}")
def unlink_control_asset(
    scf_id: str,
    link_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _perm: bool = Depends(_require_asset_link_edit),
):
    tenant_id = get_user_primary_tenant(current_user, db)
    try:
        scf_assets.unlink_asset(
            db, tenant_id, scf_id, link_id, getattr(current_user, "id", None),
        )
        db.commit()
    except ValueError as e:
        db.rollback()
        raise HTTPException(404, str(e)) from e
    return {"ok": True}


class LinkEvidenceBody(BaseModel):
    coverage_type: str = Field("supporting", description="full | partial | supporting")
    note: Optional[str] = None


@common_router.post("/controls/{scf_id}/evidence/{evidence_id}", status_code=201)
def link_control_evidence(
    scf_id: str,
    evidence_id: int,
    body: LinkEvidenceBody,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _perm: bool = Depends(_require_evidence_edit),
):
    """Attach an already-uploaded evidence item to an SCF control.

    Upload stays in the evidence module, which owns storage, file-type
    validation, versioning and OCR; this only records which control the file
    evidences. Idempotent, so a double-click cannot attach the same file twice.
    """
    from grc.models import Evidence, EvidenceControlMapping

    tenant_id = get_user_primary_tenant(current_user, db)
    ev = db.query(Evidence).filter(Evidence.id == evidence_id,
                                   Evidence.tenant_id == tenant_id).first()
    if ev is None:
        raise HTTPException(status_code=404, detail="Evidence not found for this tenant")
    if body.coverage_type not in ("full", "partial", "supporting"):
        raise HTTPException(status_code=422, detail="coverage_type must be full, partial or supporting")
    nc_id = _normalized_control_id(db, scf_id, tenant_id)
    if nc_id is None:
        raise HTTPException(status_code=404, detail=f"No control {scf_id} in this tenant's catalog")

    existing = (db.query(EvidenceControlMapping)
                .filter(EvidenceControlMapping.evidence_id == evidence_id,
                        EvidenceControlMapping.normalized_control_id == nc_id).first())
    if existing:
        return {"mapping_id": existing.id, "created": False}

    release = (db.query(SCFRelease)
               .filter(SCFRelease.import_status == "ready", SCFRelease.is_current.is_(True)).first())
    m = EvidenceControlMapping(
        evidence_id=evidence_id,
        normalized_control_id=nc_id,
        framework_name=f"SCF {release.version}" if release else "SCF",
        control_code=scf_id,
        coverage_type=body.coverage_type,
        matching_rationale=body.note,
        rule_based_validation=False,
        # A person attached this. The column defaults to True, so without this
        # every hand-made link was reported as an AI suggestion.
        created_by_ai=False,
    )
    db.add(m)
    db.flush()
    write_rich_audit_log(
        db=db, tenant_id=tenant_id, user_id=current_user.id, action="evidence_link",
        resource_type="control_evidence", resource_id=m.id, resource_name=scf_id,
        resource_url=f"/automation/soc2-controls/{scf_id}?tab=evidence",
        summary=f"Linked {ev.name or ev.file_name} to {scf_id}",
    )
    db.commit()
    return {"mapping_id": m.id, "created": True}


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
        custom_detail = _custom_control_detail(
            db, tenant_id, scf_id, release, current_user,
        )
        if custom_detail is not None:
            return custom_detail
        raise HTTPException(404, f"Unknown control '{scf_id}'")

    idx = _requirement_index()
    versions = idx.get("__versions__", {})

    # A reviewer's suppression is a standing decision: the row is wrong and does
    # not come back on the next release. Applied at read time rather than by
    # deleting the mapping, so the catalogue stays a faithful copy of what was
    # imported and the decision remains visible and reversible. Retargets move
    # a requirement onto a different SCF control without rewriting the catalogue.
    suppressed, retargets = _mapping_reviews(db, tenant_id)

    groups: Dict[str, Dict[str, Any]] = {}
    mapping_rows = (
        db.query(SCFMapping.scf_id, SCFMapping.source_slug, SCFMapping.requirement_code,
                 SCFMapping.provenance, SCFMapping.confidence,
                 SCFMapping.match_mode, SCFMapping.pivot_via_slug)
        .filter(SCFMapping.release_id == release.id,
                SCFMapping.provenance.in_(("resolver", "ai")))
        .all()
    )
    def _add(slug, code, prov, conf, mode, pivot):
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
            return
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

    for owner_scf, slug, code, prov, conf, mode, pivot in mapping_rows:
        if _effective_mapping_scf(slug, code, owner_scf, suppressed, retargets) == scf_id:
            _add(slug, code, prov, conf, mode, pivot)
    # Checks bind through the SOC 2 codes we resolved; scope never changes that.
    soc2_codes = [i["code"] for i in (groups.get("soc2") or {}).get("items", [])]

    req_groups = []
    in_scope_slugs: set = set()
    try:
        scf_scope = ensure_default_scope(db, tenant_id)
        in_scope_slugs = set(scf_scope.framework_slugs or [])
    except RuntimeError:
        scf_scope = None
    scope_fws = _scope_frameworks(scf_scope)
    published = _published_scope_codes(
        db, release.id, [f["key"] for f in scope_fws], suppressed, retargets,
    ).get(scf_id) or {}
    for slug, codes in published.items():
        for code in codes:
            _add(slug, code, "scf", None, "exact", None)

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
        g["in_scope"] = g["framework"] in in_scope_slugs if in_scope_slugs else False
        req_groups.append(g)
    # In-scope frameworks first, then SCF-published (resolver) mappings, then count.
    req_groups.sort(key=lambda g: (
        not g.get("in_scope"),
        g["provenance"] != "resolver",
        -g["count"],
        g["label"],
    ))
    # The tenant is assessed against its in-scope frameworks; the rest is noise here.
    if in_scope_slugs:
        req_groups = [g for g in req_groups if g["in_scope"]]

    objectives = [{
        "ao_id": o.ao_id, "seq": o.seq, "objective": o.objective,
        "pptdf": o.pptdf, "rigor": o.rigor,
    } for o in (
        db.query(SCFObjective)
        .filter(SCFObjective.release_id == release.id, SCFObjective.scf_id == scf_id)
        .order_by(SCFObjective.seq)
        .all()
    )]

    connected = _connected_providers(db, tenant_id)
    linked, statuses, coverage, binding_source = _linked_checks_for(
        db, tenant_id, soc2_codes, ctl.conformity_cadence, connected,
        ctl.scf_id in _automatable_controls(db, release.id),
        scf_id=ctl.scf_id,
    )

    templated = _templated_artifact_ids()
    artifacts = [
        {**a, "has_template": a.get("artifact_id") in templated}
        for a in ((_consolidated_evidence().get(ctl.scf_id) or {}).get("artifacts") or [])
        if a.get("source") == "catalog"
    ]
    guidance = _build_guidance(ctl, req_groups, linked)
    applicable = None
    if in_scope_slugs:
        artifacts = in_scope_artifacts(artifacts, scope_fws)
        # The in-scope frameworks' own asks replace the merge across every framework.
        guidance["evidence"]["required"] = scoped_required_evidence(
            {g["framework"]: [i["code"] for i in g["items"]] for g in req_groups},
            scope_fws, automated=bool(linked),
        )
        guidance["evidence"]["consolidated"] = None
        guidance["evidence"]["consolidated_from"] = None
        applicable = get_applicable_scf_ids(db, tenant_id, scf_scope.id)

    own_fields = {
        "owner_user_id": None,
        "owner_name": None,
        "reviewer_user_id": None,
        "assigned_user_ids": [],
        "next_due_at": None,
        "ownership_status": "unowned",
    }
    # Stage H — light designation / exception / inheritance fields from default scope.
    assurance_fields = {
        "exception_id": None,
        "alternative_scf_id": None,
        "inheritance_type": None,
        "provider_vendor_id": None,
        "designation": None,
        "cmm_actual": None,
        "cmm_target": None,
    }
    if scf_scope is not None:
        st = (
            db.query(SCFControlState)
            .filter(
                SCFControlState.tenant_id == tenant_id,
                SCFControlState.scope_id == scf_scope.id,
                SCFControlState.scf_id == scf_id,
            )
            .first()
        )
        owner_name = None
        if st and st.owner_user_id:
            ou = db.query(GRCUser).filter(GRCUser.id == st.owner_user_id).first()
            if ou:
                owner_name = (
                    getattr(ou, "display_name", None)
                    or getattr(ou, "username", None)
                    or getattr(ou, "email", None)
                )
        own_fields = scf_own.ownership_fields(st, owner_name=owner_name)
        if st is not None:
            assurance_fields = {
                "exception_id": st.exception_id,
                "alternative_scf_id": st.alternative_scf_id,
                "inheritance_type": st.inheritance_type,
                "provider_vendor_id": st.provider_vendor_id,
                "designation": st.designation or "not_assessed",
                "cmm_actual": st.cmm_actual,
                "cmm_target": st.cmm_target,
            }

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
        "sub_type": _control_sub_type(linked, ctl.pptdf),
        "checks_count": len(linked),
        "overall_status": (_aggregate_status(statuses) if statuses
                           else ("connect_one" if linked else coverage["state"])),
        "coverage": coverage,
        "checks": linked,
        "binding_source": binding_source,
        # what the binding went through: the SCF tokens a check covers, or the
        # SOC 2 criteria it inherits through while its covers await review
        "binding_via": (sorted({t for chk in linked for t in (chk.get("covers") or [])})
                        if binding_source == "covers" else soc2_codes),
        "test_groups": _test_groups(linked, connected),
        "related": _related_controls(db, release.id, ctl.scf_id,
                                     slugs=in_scope_slugs or None, applicable=applicable),
        # Deliverables the frameworks name for this control, with whether an
        # authored starter document exists to download.
        "artifacts": artifacts,
        "objectives": objectives,
        "scope_id": scf_scope.id if scf_scope is not None else None,
        "scope_frameworks": scope_fws,
        # SCF's usual target for a compliance obligation, unless the scope says otherwise
        "cmm_target_default": (scf_scope.target_cmm if scf_scope is not None and scf_scope.target_cmm is not None else 3),
        **guidance,
        "requirement_groups": req_groups,
        "requirement_count": sum(g["count"] for g in req_groups),
        "framework_count": len(req_groups),
        "release": release.version,
        **own_fields,
        **assurance_fields,
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
    db: Session, tenant_id: int, connection_id: Optional[int]
) -> IntegrationConnection:
    q = (
        db.query(IntegrationConnection)
        .filter(
            IntegrationConnection.tenant_id == tenant_id,
            IntegrationConnection.integration_type == "aws_readonly",
        )
    )
    if connection_id is not None:
        conn = q.filter(IntegrationConnection.id == connection_id).first()
    else:
        # Control-page "Run test" may omit the id; use the newest connection.
        conn = q.order_by(IntegrationConnection.id.desc()).first()
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
