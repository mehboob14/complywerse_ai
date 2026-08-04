"""Compliance Plugin Engine API (Task #55)."""
from __future__ import annotations

import logging
import os
from typing import Any, List, Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import func, text, cast, String
from sqlalchemy.orm import Session

from grc.models import (
    CisIngestJob,
    CompliancePlugin,
    CompliancePluginRun,
    GRCUser,
    IntegrationConnection,
    ITAsset,
    PluginAssetScope,
    PluginControlMapping,
    PluginScheduleOverride,
    get_db,
)
from grc.routers.auth_router import (
    get_user_primary_tenant,
    require_auth,
    require_tenant_permission,
)

# Permission gate for any operation that triggers a real scan against a host.
# Administrators bypass this check (they always pass). Other tenant users must
# have `compliance:scan:execute` explicitly granted via their role.
_require_scan_perm = require_tenant_permission("compliance:scan:execute")

# CIS package shipped with `require_platform_admin` + `require_tenant_admin`
# deps that don't exist in our auth layer (they would tighten certain
# benchmark-mapping + promote endpoints to platform/tenant Administrator
# only). Until the auth-layer merge brings them across, alias both to the
# same compliance-plugins manage permission — Admins bypass via wildcard,
# Scanning-Admin keeps its existing access. Matches pre-merge behaviour
# of the destructive operations.
require_tenant_admin = require_tenant_permission("compliance:scan:execute")
require_platform_admin = require_tenant_permission("compliance:scan:execute")

from .pdf_ingest import ingest_pdf
from .runners import RUNNERS
from .seed import _validate_readonly_at_seed_time, seed_compliance_plugins
from .services.run_service import execute_plugin

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/compliance-plugins", tags=["Compliance Plugins"])


# ─── Schemas ─────────────────────────────────────────────────────────────────

class PluginOut(BaseModel):
    id: int
    tenant_id: Optional[int]
    plugin_key: str
    benchmark: str
    rule_id: str
    title: str
    description: Optional[str]
    rationale: Optional[str]
    remediation: Optional[str]
    severity: str
    runner_type: str
    check_definition: dict[str, Any]
    enabled: bool
    is_builtin: bool
    source_url: Optional[str]


class PluginRunCreate(BaseModel):
    asset_id: Optional[int] = None
    connection_id: Optional[int] = None
    # Manual attestation (for text-only CIS rules with runner_type="manual"):
    # the operator's recorded outcome + optional evidence note.
    manual_result: Optional[str] = None   # "pass" | "fail" | "na"
    manual_note: Optional[str] = None


class PluginRunOut(BaseModel):
    id: int
    plugin_id: int
    plugin_key: Optional[str] = None
    plugin_title: Optional[str] = None
    asset_id: Optional[int]
    asset_name: Optional[str] = None
    connection_id: Optional[int]
    connection_name: Optional[str] = None
    status: str
    result_summary: Optional[str]
    raw_output: Optional[dict[str, Any]]
    evidence_hash: Optional[str]
    duration_ms: Optional[int]
    triggered_by: str
    started_at: Optional[str]
    completed_at: Optional[str]
    error_message: Optional[str]


class ControlMappingCreate(BaseModel):
    framework_control_id: Optional[int] = None
    normalized_control_id: Optional[int] = None
    weight: float = 1.0


def _effective_schedule(p: CompliancePlugin, tenant_id: int, db: Session) -> tuple[Optional[str], bool]:
    """Returns (effective_cron, is_overridden_for_tenant)."""
    ov = (
        db.query(PluginScheduleOverride)
        .filter(
            PluginScheduleOverride.plugin_id == p.id,
            PluginScheduleOverride.tenant_id == tenant_id,
        )
        .first()
    )
    if ov is not None:
        return ov.schedule_cron, True
    return getattr(p, "schedule_cron", None), False


def _scope_to_dict(s: Optional[PluginAssetScope]) -> dict:
    if s is None:
        return {"mode": "all", "asset_ids": []}
    return {"mode": s.mode or "all", "asset_ids": list(s.asset_ids or [])}


def _plugin_to_dict(p: CompliancePlugin, *, tenant_id: Optional[int] = None, db: Optional[Session] = None) -> dict:
    schedule_cron = getattr(p, "schedule_cron", None)
    schedule_overridden = False
    if tenant_id is not None and db is not None:
        schedule_cron, schedule_overridden = _effective_schedule(p, tenant_id, db)
    return {
        "id": p.id,
        "tenant_id": p.tenant_id,
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
        "schedule_cron": schedule_cron,
        "schedule_overridden": schedule_overridden,
        "catalog_schedule_cron": getattr(p, "schedule_cron", None),
        # PDF-ingest fields (nullable on legacy/seeded rows):
        "parent_plugin_id": getattr(p, "parent_plugin_id", None),
        "depth": getattr(p, "depth", None),
        "level": getattr(p, "level", None),
        "assessment_status": getattr(p, "assessment_status", None),
        "audit_steps_text": getattr(p, "audit_steps_text", None),
        "references_json": getattr(p, "references_json", None) or [],
        "cis_controls_json": getattr(p, "cis_controls_json", None) or [],
        "mitre_techniques_json": getattr(p, "mitre_techniques_json", None) or [],
        "confidence_score": getattr(p, "confidence_score", None),
        "review_status": getattr(p, "review_status", None) or "auto_approved",
        "auto_generated_check": bool(getattr(p, "auto_generated_check", False)),
        "source_ingest_job_id": getattr(p, "source_ingest_job_id", None),
    }


def _job_to_dict(j: CisIngestJob) -> dict:
    return {
        "id": j.id,
        "tenant_id": j.tenant_id,
        "uploaded_by": j.uploaded_by,
        "original_filename": j.original_filename,
        "sha256": j.sha256,
        "benchmark_label": j.benchmark_label,
        "status": j.status,
        "page_count": j.page_count,
        "rules_extracted": j.rules_extracted or 0,
        "rules_inserted": j.rules_inserted or 0,
        "rules_updated": j.rules_updated or 0,
        "rules_flagged": j.rules_flagged or 0,
        "rules_toc_rejected": getattr(j, "rules_toc_rejected", 0) or 0,
        "ocr_pages": j.ocr_pages or 0,
        "error_text": j.error_text,
        "extraction_log": j.extraction_log or [],
        "started_at": j.started_at.isoformat() if j.started_at else None,
        "completed_at": j.completed_at.isoformat() if j.completed_at else None,
        "created_at": j.created_at.isoformat() if j.created_at else None,
    }


def _user_label(user: Optional[GRCUser]) -> Optional[dict]:
    """Render a user reference for the frontend — picks the best display name.

    GRC has separate "real name" / "username" / "email" fields per user. The
    UI just wants something it can show next to an action ("Bob ran this").
    """
    if not user:
        return None
    full = (
        getattr(user, "full_name", None)
        or getattr(user, "display_name", None)
        or getattr(user, "username", None)
        or getattr(user, "email", None)
        or f"user#{user.id}"
    )
    return {
        "id": user.id,
        "name": full,
        "email": getattr(user, "email", None),
        "username": getattr(user, "username", None),
        "initial": (full or "?")[:1].upper(),
    }


def _user_by_id(db: Session, user_id: Optional[int]) -> Optional[GRCUser]:
    if not user_id:
        return None
    return db.query(GRCUser).filter(GRCUser.id == user_id).first()


def _run_to_dict(r: CompliancePluginRun, plugin: Optional[CompliancePlugin] = None,
                 asset: Optional[ITAsset] = None, conn: Optional[IntegrationConnection] = None,
                 triggered_by_user: Optional[GRCUser] = None) -> dict:
    return {
        "id": r.id,
        "plugin_id": r.plugin_id,
        "plugin_key": plugin.plugin_key if plugin else None,
        "plugin_title": plugin.title if plugin else None,
        "asset_id": r.asset_id,
        "asset_name": asset.name if asset else None,
        "connection_id": r.connection_id,
        "connection_name": conn.connection_name if conn else None,
        "status": r.status,
        "result_summary": r.result_summary,
        "result_detail": getattr(r, "result_detail", None),
        "remediation_shown": getattr(r, "remediation_shown", None),
        "raw_output": r.raw_output,
        "evidence_snapshot": getattr(r, "evidence_snapshot", None),
        "evidence_hash": r.evidence_hash,
        "duration_ms": r.duration_ms,
        "triggered_by": r.triggered_by,
        "triggered_by_user": _user_label(triggered_by_user),
        "triggered_by_user_id": getattr(r, "triggered_by_user_id", None),
        "started_at": r.started_at.isoformat() if r.started_at else None,
        "completed_at": r.completed_at.isoformat() if r.completed_at else None,
        "error_message": r.error_message,
    }


# ─── Routes ──────────────────────────────────────────────────────────────────

@router.get("")
def list_plugins(
    benchmark: Optional[str] = Query(None),
    runner_type: Optional[str] = Query(None),
    severity: Optional[str] = Query(None),
    include_pending: bool = Query(False, description="If true, also include pending_review/rejected rules in the response. Default false: library only shows approved rules."),
    limit: int = Query(500, ge=1, le=5000, description="Cap response size. Defaults to 500 so an unfiltered page load returns in ~3s instead of 30s+ (we have 4855 plugins)."),
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    tenant_id = get_user_primary_tenant(current_user, db)
    q = db.query(CompliancePlugin).filter(
        (CompliancePlugin.tenant_id.is_(None)) | (CompliancePlugin.tenant_id == tenant_id)
    )
    if not include_pending:
        # Library shows ONLY approved rules. Pending/rejected stay in the
        # review queue until the operator explicitly approves them.
        q = q.filter(
            (CompliancePlugin.review_status == "approved") |
            (CompliancePlugin.review_status == "auto_approved")
        )
    if benchmark:
        q = q.filter(CompliancePlugin.benchmark == benchmark)
    if runner_type:
        q = q.filter(CompliancePlugin.runner_type == runner_type)
    if severity:
        q = q.filter(CompliancePlugin.severity == severity)
    total = q.count()
    plugins = q.order_by(CompliancePlugin.benchmark.asc(), CompliancePlugin.rule_id.asc()).limit(limit).all()
    # Aggregate per-plugin pass/fail/error counts for the library table.
    from sqlalchemy import func as _f
    stats_rows = (
        db.query(
            CompliancePluginRun.plugin_id,
            CompliancePluginRun.status,
            _f.count(CompliancePluginRun.id),
        )
        .filter(
            CompliancePluginRun.tenant_id == tenant_id,
            CompliancePluginRun.is_leaked.is_(False),
        )
        .group_by(CompliancePluginRun.plugin_id, CompliancePluginRun.status)
        .all()
    )
    stats: dict[int, dict[str, int]] = {}
    for pid, st, cnt in stats_rows:
        s = stats.setdefault(pid, {"passed": 0, "failed": 0, "error": 0, "total": 0})
        if st in s:
            s[st] = int(cnt)
        s["total"] += int(cnt)

    # Batch-load schedule overrides ONCE for this tenant. Without this,
    # _effective_schedule was firing one query per plugin (4855 DB
    # round-trips for an unfiltered library load), which timed out the
    # /compliance-plugins page — Hassan saw it as "rules look gone".
    overrides_q = (
        db.query(PluginScheduleOverride)
        .filter(PluginScheduleOverride.tenant_id == tenant_id)
        .all()
    )
    overrides_by_plugin: dict[int, str] = {o.plugin_id: o.schedule_cron for o in overrides_q}

    out = []
    for p in plugins:
        d = _plugin_to_dict(p, tenant_id=None, db=None)  # skip per-row schedule lookup
        if p.id in overrides_by_plugin:
            d["schedule_cron"] = overrides_by_plugin[p.id]
            d["schedule_overridden"] = True
        else:
            d["schedule_cron"] = getattr(p, "schedule_cron", None)
            d["schedule_overridden"] = False
        d["stats"] = stats.get(p.id, {"passed": 0, "failed": 0, "error": 0, "total": 0})
        out.append(d)

    # Pending-review count: distinct rules awaiting operator approval.
    # The library list above filters those out; we surface the count
    # separately so the frontend KPI card can show "Pending review"
    # without a duplicate request.
    pending_total = (
        db.query(CompliancePlugin)
        .filter(
            (CompliancePlugin.tenant_id.is_(None)) | (CompliancePlugin.tenant_id == tenant_id),
            CompliancePlugin.review_status == "pending_review",
        )
        .count()
    )

    return {
        "plugins": out,
        "total": total,             # full match count (may exceed len(plugins) when limit caps)
        "returned": len(plugins),   # how many actually shipped in this response
        "limit": limit,
        "pending_total": pending_total,
        "available_runner_types": sorted(RUNNERS.keys()),
    }


@router.get("/per-user-summary")
def per_user_summary(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """Per-user activity breakdown for the current tenant.

    For each user who has triggered at least one CIS plugin run in the
    tenant, computes:
       passed: distinct plugin_ids where THE USER's latest run on that
               plugin succeeded.
       scanned: distinct plugins the user has run at least once.
       total_rules: total approved/scannable rules in the library (the
                    denominator for the user's pass rate).
       failed: distinct plugins where the user's latest run failed.
       errored: distinct plugins where the user's latest run errored.

    Used by the per-user-activity panel on the CIS plugins page so the
    operator can see how each team member's coverage is progressing
    against the same denominator.
    """
    tenant_id = get_user_primary_tenant(current_user, db)
    total_rules = (
        db.query(CompliancePlugin)
        .filter(
            (CompliancePlugin.tenant_id.is_(None)) | (CompliancePlugin.tenant_id == tenant_id),
            CompliancePlugin.review_status.in_(["approved", "auto_approved"]),
            CompliancePlugin.enabled.is_(True),
        )
        .count()
    )

    # Pull all runs in the tenant ordered newest-first so we can fold
    # them into "latest per (user, plugin)" in one pass.
    runs = (
        db.query(CompliancePluginRun)
        .filter(
            CompliancePluginRun.tenant_id == tenant_id,
            CompliancePluginRun.is_leaked.is_(False),
        )
        .order_by(CompliancePluginRun.started_at.desc().nullslast(), CompliancePluginRun.id.desc())
        .all()
    )
    per_user_latest: dict[int, dict[int, str]] = {}
    for r in runs:
        uid = r.triggered_by_user_id
        if uid is None:
            continue
        bucket = per_user_latest.setdefault(uid, {})
        if r.plugin_id not in bucket:
            bucket[r.plugin_id] = r.status

    # Build the FULL tenant member list — even users who have never run a
    # scan should appear in the panel with 0/total. That way the operator
    # sees who hasn't onboarded yet and can chase them.
    #
    # Our architecture is per-tenant DB (not schema-per-tenant): the
    # injected `db` session is already pointed at this tenant's own
    # `grc_<slug>` database, so `db.query(GRCUser).all()` IS the tenant
    # roster — no `tenant_models` / `SET search_path` gymnastics needed.
    # `tenant_users` stays as an empty list and the `public_users` block
    # below feeds the merge directly (step-1 no-op, step-2 covers all).
    tenant_users: list[dict] = []

    # Public grc_users for this tenant — same DB, no cross-tenant leakage
    # because the per-tenant connection only sees its own rows.
    public_users = {
        u.id: {
            "id": u.id,
            "username": u.username,
            "email": u.email,
            "display_name": getattr(u, "display_name", None) or u.username,
        }
        for u in db.query(GRCUser).all()
    }

    # Merge by EMAIL (the only stable identity across the public and
    # tenant schemas). Same person → one row, with the run counts taken
    # from whichever user_id actually has runs against them.
    by_email: dict[str, dict] = {}

    def _add(meta: dict, runs_uid: int | None):
        email = (meta.get("email") or "").lower().strip() or None
        key = email or f"id:{meta.get('id')}"
        if key not in by_email:
            by_email[key] = {"user": meta, "run_uid": runs_uid}
        elif runs_uid is not None and by_email[key]["run_uid"] is None:
            by_email[key]["run_uid"] = runs_uid

    # Step 1: every tenant member (whether they've scanned or not).
    for u in tenant_users:
        # Find matching public_user by email so we link runs correctly
        matching_run_uid = None
        for puid, pu in public_users.items():
            if (pu.get("email") or "").lower() == (u.get("email") or "").lower() and puid in per_user_latest:
                matching_run_uid = puid
                break
        if matching_run_uid is None and u["id"] in per_user_latest:
            matching_run_uid = u["id"]
        _add(u, matching_run_uid)

    # Step 2: any run-row user that the tenant-schema list didn't surface
    # (e.g. legacy users that pre-date the schema split).
    for runs_uid in per_user_latest.keys():
        pu = public_users.get(runs_uid) or {
            "id": runs_uid, "username": f"user#{runs_uid}", "email": None,
            "display_name": f"user#{runs_uid}",
        }
        # Skip if email already covered by a tenant row
        email = (pu.get("email") or "").lower().strip()
        if email and email in by_email:
            continue
        _add(pu, runs_uid)

    rows = []
    for entry in by_email.values():
        runs_uid = entry["run_uid"]
        plugin_statuses = per_user_latest.get(runs_uid, {}) if runs_uid else {}
        passed = sum(1 for s in plugin_statuses.values() if s == "passed")
        failed = sum(1 for s in plugin_statuses.values() if s == "failed")
        errored = sum(1 for s in plugin_statuses.values() if s == "error")
        scanned = len(plugin_statuses)
        rows.append({
            "user": entry["user"],
            "passed": passed,
            "failed": failed,
            "errored": errored,
            "scanned": scanned,
            "pass_pct": round(passed / total_rules * 100, 1) if total_rules else 0,
        })
    # Sort: people who've scanned (passed desc), then non-scanners alphabetically.
    rows.sort(key=lambda r: (-r["scanned"], -r["passed"], r["user"].get("display_name") or ""))
    return {
        "total_rules": total_rules,
        "users": rows,
        "your_user_email": current_user.email,
        "your_user_id": current_user.id,
    }


# ─── Asset Inventory (for CIS module) ────────────────────────────────────────

# OS family classifier. Heuristic for now; the agent enrollment in Phase 3
# will populate an explicit os_family column on grc_it_assets and this
# fallback will only kick in for assets that haven't been touched yet.
_OS_PATTERNS = [
    ("windows_server", [
        "windows server", "win server", "winserver", "windows 2012",
        "windows 2016", "windows 2019", "windows 2022", "windows 2025",
        "domain controller", "active directory",
    ]),
    ("windows_workstation", [
        "windows 10", "windows 11", "windows 7", "windows 8", "win10", "win11",
        "windows workstation", "desktop-",
    ]),
    ("linux_server", [
        "linux", "ubuntu", "rhel", "redhat", "red hat", "centos", "debian",
        "fedora", "suse", "rocky", "alma", "amazon linux", "amzn",
    ]),
    ("aws_account", [
        "aws", "amazon web services", "ec2", "s3", "iam", " account", "-account",
    ]),
    ("azure_account", ["azure", "microsoft cloud", "az-"]),
    ("gcp_account", ["gcp", "google cloud", "gke"]),
    ("vmware_host", ["vmware", "esxi", "vcenter", "vsphere"]),
    ("network_device", [
        "cisco", "juniper", "fortinet", "palo alto", "switch", "router",
        "firewall", "asa", "nexus", "catalyst",
    ]),
    ("database", ["database", "mssql", "mysql", "postgres", "oracle db", "mariadb"]),
    ("container", ["docker", "kubernetes", "k8s", "container", "pod"]),
]

_RUNNER_TYPE_TO_OS = {
    "windows_winrm": "windows_server",
    "linux_ssh": "linux_server",
    "aws_readonly": "aws_account",
    "azure_readonly": "azure_account",
    "gcp_readonly": "gcp_account",
    "vmware_vcenter": "vmware_host",
    "netdev_ssh": "network_device",
    # SQL runners — without these, a DB connection never drives the overview
    # bucket (and apps that only have a SQL credential would fall through).
    "postgres_sql": "database",
    "mssql_sql": "database",
    "mysql_sql": "database",
    "oracle_sql": "database",
    "k8s_api": "container",
    "ldap_query": "identity",
}

_OS_FAMILY_LABELS = {
    "windows_server": "Windows Servers",
    "windows_workstation": "Windows Workstations",
    "linux_server": "Linux Servers",
    "aws_account": "AWS Accounts",
    "azure_account": "Azure Accounts",
    "gcp_account": "GCP Accounts",
    "vmware_host": "VMware Hosts",
    "network_device": "Network Devices",
    "database": "Databases",
    "identity": "Identity / AD",
    "container": "Containers / Orchestration",
    "unclassified": "Unclassified",
}

# software_key / os_normalized prefix → overview family. Used for application
# assets that inherit the host's os_family for scan routing — bucketing must
# follow the app, not the host WinRM/SSH connection.
_SOFTWARE_KEY_TO_OS = (
    (("postgresql", "postgres"), "database"),
    (("mssql", "sql-server", "sqlserver"), "database"),
    (("mysql", "mariadb"), "database"),
    (("oracle-db", "oracle"), "database"),
    (("iis",), "windows_server"),
    (("nginx", "apache", "tomcat"), "linux_server"),
    (("docker", "kubernetes", "k8s"), "container"),
)


def _classify_from_software_key(asset: ITAsset) -> Optional[str]:
    """Map an application asset to an overview family via vendor / os_normalized.

    Returns None when we can't tell — caller falls through to host heuristics.
    """
    v = (asset.vendor or "").lower().strip()
    if v == "postgresql":
        return "database"
    if v in ("mysql", "mariadb"):
        return "database"
    if v == "oracle":
        return "database"
    if v == "microsoft" and (asset.asset_type or "") == "application":
        return "database"  # MSSQL — Windows OS apps use asset_role host
    if v == "iis":
        return "windows_server"
    if v in ("apache", "nginx", "tomcat"):
        return "linux_server"

    k = (asset.os_normalized or "").lower().strip()
    if not k:
        return None
    for prefixes, family in _SOFTWARE_KEY_TO_OS:
        if any(k.startswith(p) for p in prefixes):
            return family
    return None


def _is_application_asset(asset: ITAsset) -> bool:
    role = (getattr(asset, "asset_role", None) or "").lower().strip()
    if role == "application":
        return True
    if getattr(asset, "parent_asset_id", None):
        return True
    return (asset.asset_type or "").lower().strip() == "application"


def _classify_asset_os(
    asset: ITAsset,
    connections_by_host: dict[str, IntegrationConnection],
    connections_by_host_all: Optional[dict[str, list]] = None,
) -> str:
    """Best-effort overview category for an asset.

    Priority:
      1. Application assets → software key / vendor (NOT the host's WinRM/SSH
         connection — children inherit host os_family for scan routing and would
         otherwise land under Windows/Linux hosts).
      2. Preferred runner on the host when multiple connections exist.
      3. First connection matched by host_name → console_url.
      4. Keyword scan on name/description/asset_type/vendor.
      5. unclassified.
    """
    # 1. Applications bucket by what they are, not what host they ride on.
    if _is_application_asset(asset):
        from_sw = _classify_from_software_key(asset)
        if from_sw:
            return from_sw

    # 2/3. Match by host_name → connection(s). Prefer a runner that matches
    # the asset's software signal when several connections share a host
    # (WinRM + postgres_sql on the same box is the common case).
    host = (asset.host_name or "").lower().strip()
    if host:
        preferred = _classify_from_software_key(asset)
        all_conns = (connections_by_host_all or {}).get(host) or []
        if preferred and all_conns:
            for conn in all_conns:
                mapped = _RUNNER_TYPE_TO_OS.get(conn.integration_type)
                if mapped == preferred:
                    return mapped
        conn = connections_by_host.get(host)
        if conn and conn.integration_type in _RUNNER_TYPE_TO_OS:
            return _RUNNER_TYPE_TO_OS[conn.integration_type]

    # 4. Keyword scan over name + description + asset_type
    hay = " ".join([
        asset.name or "",
        asset.description or "",
        asset.asset_type or "",
        asset.vendor or "",
    ]).lower()
    for family, patterns in _OS_PATTERNS:
        for p in patterns:
            if p in hay:
                return family

    return "unclassified"


@router.get("/assets-overview")
def assets_overview(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """Tenant's IT-asset inventory, grouped by OS family, enriched with
    CIS scan stats.

    Used by the Assets tab on the CIS Benchmark page so the operator
    sees every asset (not just the ones already wired to a connection)
    classified by what type of machine it is, plus pass/fail counts.
    """
    tenant_id = get_user_primary_tenant(current_user, db)

    # Tenant assets
    assets = (
        db.query(ITAsset)
        .filter(ITAsset.tenant_id == tenant_id)
        .order_by(ITAsset.criticality.desc(), ITAsset.name.asc())
        .all()
    )

    # Tenant connections — keyed by host so we can match assets by host_name.
    # Keep BOTH a first-wins map (legacy) and an all-connections map so a host
    # with WinRM + postgres_sql can resolve the right runner per asset.
    connections = (
        db.query(IntegrationConnection)
        .filter(IntegrationConnection.tenant_id == tenant_id)
        .all()
    )
    connections_by_host: dict[str, IntegrationConnection] = {}
    connections_by_host_all: dict[str, list] = {}
    for c in connections:
        h = (c.console_url or "").lower().strip()
        if not h:
            continue
        connections_by_host_all.setdefault(h, []).append(c)
        if h not in connections_by_host:
            connections_by_host[h] = c

    # Approved rule total — the per-asset pass-rate denominator
    total_rules = (
        db.query(CompliancePlugin)
        .filter(
            (CompliancePlugin.tenant_id.is_(None)) | (CompliancePlugin.tenant_id == tenant_id),
            CompliancePlugin.review_status.in_(["approved", "auto_approved"]),
            CompliancePlugin.enabled.is_(True),
        )
        .count()
    )

    # Pull every run in tenant ordered newest-first; fold to latest per
    # (asset_id, plugin_id) so we count each rule once per asset.
    runs = (
        db.query(CompliancePluginRun)
        .filter(
            CompliancePluginRun.tenant_id == tenant_id,
            CompliancePluginRun.is_leaked.is_(False),
        )
        .order_by(
            CompliancePluginRun.started_at.desc().nullslast(),
            CompliancePluginRun.id.desc(),
        )
        .all()
    )
    # asset_id → { plugin_id: status }
    per_asset_latest: dict[int, dict[int, str]] = {}
    # asset_id → latest started_at across all plugins
    per_asset_last_scan: dict[int, Any] = {}
    for r in runs:
        if r.asset_id is None:
            continue
        bucket = per_asset_latest.setdefault(r.asset_id, {})
        if r.plugin_id not in bucket:
            bucket[r.plugin_id] = r.status
        if r.asset_id not in per_asset_last_scan and r.started_at:
            per_asset_last_scan[r.asset_id] = r.started_at

    # Build per-asset records
    groups: dict[str, list[dict]] = {}
    totals_scanned = 0
    total_pass_rate_sum = 0.0
    total_pass_rate_count = 0

    # Strict matcher — per-asset applicable rule count AND benchmark name.
    # The /compliance-overview page needs both: rule count for the
    # KPI / pass-rate denominator, benchmark label so each asset card can
    # show "what benchmark is this scanning against" without a second
    # match-preview round-trip per asset.
    from .services.strict_matcher import applicable_plugins_for_asset
    applicable_count_by_asset: dict[int, int] = {}
    matched_benchmark_by_asset: dict[int, Optional[str]] = {}
    # Plugin ids that are CURRENTLY applicable, per asset. Results from a
    # benchmark the asset is no longer matched to must not be counted: an
    # earlier scan against a superseded benchmark leaves its own plugin rows
    # behind, and because those ids differ from the current benchmark's,
    # "latest result per plugin" happily counted BOTH. Live symptom: a device
    # with a 538-rule benchmark reported 962 checks — 538 current + 424 from a
    # retired ARCHIVE benchmark — so the headline compliance % blended a live
    # scan with a stale one.
    applicable_ids_by_asset: dict[int, set] = {}
    for a in assets:
        if a.os_normalized:
            plugins_for_a, bench_for_a = applicable_plugins_for_asset(
                db, tenant_id, a.os_normalized,
            )
            applicable_count_by_asset[a.id] = len(plugins_for_a)
            matched_benchmark_by_asset[a.id] = bench_for_a
            applicable_ids_by_asset[a.id] = {p.id for p in plugins_for_a}
        else:
            applicable_count_by_asset[a.id] = 0
            matched_benchmark_by_asset[a.id] = None
            applicable_ids_by_asset[a.id] = set()

    for a in assets:
        os_family = _classify_asset_os(a, connections_by_host, connections_by_host_all)
        statuses = per_asset_latest.get(a.id, {})
        # Current posture only. History stays in grc_compliance_plugin_runs and
        # is still readable per run; it just doesn't inflate the live numbers.
        _appl = applicable_ids_by_asset.get(a.id) or set()
        if _appl:
            statuses = {pid: st for pid, st in statuses.items() if pid in _appl}
        passed = sum(1 for s in statuses.values() if s == "passed")
        failed = sum(1 for s in statuses.values() if s == "failed")
        errored = sum(1 for s in statuses.values() if s == "error")
        skipped = sum(1 for s in statuses.values() if s == "skipped")
        scanned = len(statuses)
        # Pass rate uses the asset's APPLICABLE rule count (Stage 2 strict
        # pick), not the whole library. Mehboob → 63 / 538 = 11.7%, not
        # 63 / 4855 = 1.3% which was the historical mis-reporting.
        # Skipped / not_applicable / not_assessed results drop from the
        # denominator (same n/a scoring rule as inventory scoring).
        applicable_for_this_asset = applicable_count_by_asset.get(a.id, 0) or total_rules
        denom = max(int(applicable_for_this_asset) - int(skipped), 0)
        pass_rate = round(passed / denom * 100, 1) if denom else None
        last_scan = per_asset_last_scan.get(a.id)

        # Connection match — STRICT, host_name → console_url only. Prefer a
        # runner that matches the asset's software signal when the host has
        # multiple credentials (e.g. WinRM + postgres_sql). Never invent a
        # connection for a different host.
        host_lc = (a.host_name or "").lower().strip()
        host_conns = connections_by_host_all.get(host_lc, []) if host_lc else []
        matched_conn = None
        if host_conns:
            want_family = os_family if _is_application_asset(a) else None
            if want_family:
                for c in host_conns:
                    if _RUNNER_TYPE_TO_OS.get(c.integration_type) == want_family:
                        matched_conn = c
                        break
            if matched_conn is None:
                matched_conn = connections_by_host.get(host_lc)

        groups.setdefault(os_family, []).append({
            "id": a.id,
            "name": a.name,
            "host_name": a.host_name,
            "ip_address": a.ip_address,
            "asset_type": a.asset_type,
            "asset_role": getattr(a, "asset_role", None),
            "parent_asset_id": getattr(a, "parent_asset_id", None),
            "criticality": a.criticality,
            "owner_name": a.owner_name,
            "confidentiality_rating": a.confidentiality_rating,
            "integrity_rating": a.integrity_rating,
            "availability_rating": a.availability_rating,
            "status": a.status,
            "os_family": os_family,
            "os_normalized": a.os_normalized,
            "runner_type": matched_conn.integration_type if matched_conn else None,
            "connection_id": matched_conn.id if matched_conn else None,
            "has_connection": matched_conn is not None,
            "last_scan_at": last_scan.isoformat() if last_scan else None,
            "scanned_rules": scanned,
            "passed": passed,
            "failed": failed,
            "errored": errored,
            "pass_rate": pass_rate,
            # New: strict-matcher resolution per asset so /compliance-overview
            # can show "what benchmark covers this asset" + "how many rules
            # apply" without a separate match-preview round-trip per row.
            "matched_benchmark": matched_benchmark_by_asset.get(a.id),
            "applicable_rules": applicable_count_by_asset.get(a.id, 0),
        })

        if scanned > 0:
            totals_scanned += 1
            if pass_rate is not None:
                total_pass_rate_sum += pass_rate
                total_pass_rate_count += 1

    # Order groups for stable UI rendering
    group_order = [
        "windows_server", "linux_server", "aws_account", "azure_account",
        "gcp_account", "vmware_host", "network_device", "database",
        "identity", "container", "windows_workstation", "unclassified",
    ]
    ordered_groups = []
    for fam in group_order:
        if fam in groups:
            ordered_groups.append({
                "os_family": fam,
                "label": _OS_FAMILY_LABELS.get(fam, fam.title()),
                "count": len(groups[fam]),
                "assets": groups[fam],
            })

    avg_pass = (
        round(total_pass_rate_sum / total_pass_rate_count, 1)
        if total_pass_rate_count else 0.0
    )

    return {
        "groups": ordered_groups,
        "totals": {
            "assets": len(assets),
            "scanned": totals_scanned,
            "unscanned": len(assets) - totals_scanned,
            "avg_pass_rate": avg_pass,
            "total_rules": total_rules,
        },
    }


@router.get("/per-asset-coverage")
def per_asset_coverage(
    asset_id: int = Query(...),
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """Detailed CIS coverage for a single asset.

    Returns the latest run status per approved rule (passed/failed/error/
    never_run) so the per-asset dashboard can render a "what's failing"
    table without a flood of per-plugin requests.
    """
    tenant_id = get_user_primary_tenant(current_user, db)

    asset = db.query(ITAsset).filter(
        ITAsset.id == asset_id,
        ITAsset.tenant_id == tenant_id,
    ).first()
    if not asset:
        raise HTTPException(404, "Asset not found")

    plugins = (
        db.query(CompliancePlugin)
        .filter(
            (CompliancePlugin.tenant_id.is_(None)) | (CompliancePlugin.tenant_id == tenant_id),
            CompliancePlugin.review_status.in_(["approved", "auto_approved"]),
            CompliancePlugin.enabled.is_(True),
        )
        .all()
    )

    runs = (
        db.query(CompliancePluginRun)
        .filter(
            CompliancePluginRun.tenant_id == tenant_id,
            CompliancePluginRun.asset_id == asset.id,
            CompliancePluginRun.is_leaked.is_(False),
        )
        .order_by(
            CompliancePluginRun.started_at.desc().nullslast(),
            CompliancePluginRun.id.desc(),
        )
        .all()
    )
    latest_by_plugin: dict[int, CompliancePluginRun] = {}
    for r in runs:
        if r.plugin_id not in latest_by_plugin:
            latest_by_plugin[r.plugin_id] = r

    rule_rows: list[dict] = []
    # Tally every status we observe so the response sums to total_rules.
    # Previously we hard-coded {passed, failed, error, never_run} which
    # silently dropped stale 'running' rows (left over from a killed
    # scan) — totals didn't reconcile with rules.length.
    counts = {"passed": 0, "failed": 0, "error": 0, "running": 0, "never_run": 0}
    last_scan: Any = None
    for p in plugins:
        r = latest_by_plugin.get(p.id)
        status = r.status if r else "never_run"
        counts[status] = counts.get(status, 0) + 1
        if r and r.started_at and (last_scan is None or r.started_at > last_scan):
            last_scan = r.started_at
        rule_rows.append({
            "plugin_id": p.id,
            "rule_id": p.rule_id,
            "title": p.title,
            "severity": p.severity,
            "benchmark": p.benchmark,
            "runner_type": p.runner_type,
            "status": status,
            "result_summary": r.result_summary if r else None,
            "started_at": r.started_at.isoformat() if (r and r.started_at) else None,
            "run_id": r.id if r else None,
        })

    total = len(plugins)
    pass_rate = round(counts["passed"] / total * 100, 1) if total else 0.0

    # Asset os classification (reuse the same helper)
    connections = (
        db.query(IntegrationConnection)
        .filter(IntegrationConnection.tenant_id == tenant_id)
        .all()
    )
    conns_by_host: dict[str, IntegrationConnection] = {}
    for c in connections:
        h = (c.console_url or "").lower().strip()
        if h and h not in conns_by_host:
            conns_by_host[h] = c
    os_family = _classify_asset_os(asset, conns_by_host)

    return {
        "asset": {
            "id": asset.id,
            "name": asset.name,
            "host_name": asset.host_name,
            "ip_address": asset.ip_address,
            "asset_type": asset.asset_type,
            "criticality": asset.criticality,
            "owner_name": asset.owner_name,
            "confidentiality_rating": asset.confidentiality_rating,
            "integrity_rating": asset.integrity_rating,
            "availability_rating": asset.availability_rating,
            "status": asset.status,
            "os_family": os_family,
            "os_family_label": _OS_FAMILY_LABELS.get(os_family, os_family.title()),
        },
        "totals": {
            "total_rules": total,
            "passed": counts["passed"],
            "failed": counts["failed"],
            "error": counts["error"],
            "running": counts["running"],
            "never_run": counts["never_run"],
            "pass_rate": pass_rate,
            "last_scan_at": last_scan.isoformat() if last_scan else None,
        },
        "rules": rule_rows,
    }


@router.get("/match-preview")
def match_preview(
    asset_id: int = Query(...),
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """Visualisation of the 2-stage AI rule classification funnel.

    Returns: total approved plugins, what the regex stage kept/skipped,
    what the AI stage refined to, the primary benchmark picked, and
    a few example plugins per bucket so the UI can show the user *why*
    a given rule applies (or doesn't) to this asset.

    Read-only: does NOT execute scans. Compliverse is not a scanner —
    this endpoint just explains the classification.
    """
    # NOTE: legacy Stage 1 + Stage 2 helpers (benchmark_applies_to_asset,
    # select_benchmarks_for_os, _stage1_match) are no longer imported here
    # — the strict matcher fully replaced them. The strict-matcher code
    # path lives below, after the asset lookup.

    tenant_id = get_user_primary_tenant(current_user, db)
    asset = db.query(ITAsset).filter(
        ITAsset.id == asset_id,
        ITAsset.tenant_id == tenant_id,
    ).first()
    if not asset:
        raise HTTPException(404, "Asset not found")

    plugins = (
        db.query(CompliancePlugin)
        .filter(
            (CompliancePlugin.tenant_id.is_(None)) | (CompliancePlugin.tenant_id == tenant_id),
            CompliancePlugin.review_status.in_(["approved", "auto_approved"]),
            CompliancePlugin.enabled.is_(True),
        )
        .all()
    )
    total = len(plugins)

    def _sample(items, n=3):
        out = []
        for p in items[:n]:
            out.append({
                "rule_id": p.rule_id,
                "title": (p.title or "")[:80],
                "benchmark": p.benchmark,
            })
        return out

    os_normalized = getattr(asset, "os_normalized", None)
    os_version = getattr(asset, "os_version", None)
    os_family = getattr(asset, "os_family", None)

    # ── STRICT SINGLE-STAGE MATCHER ──
    # Replaces the two-stage Stage 1 (os_keys family-walk) + Stage 2 (AI
    # router) pipeline with a single deterministic lookup:
    #
    #   asset.os_normalized → grc_benchmark_os_mappings.os_pattern
    #                       → mapping.benchmark_name
    #                       → all approved+enabled plugins with that benchmark
    #
    # No mixing of archived/live versions. No AI call. Operator owns the
    # mapping table. The UI keeps showing the same "stage1 / stage2" fields
    # so existing dashboards don't break, but they now report the strict
    # result.
    from .services.strict_matcher import applicable_plugins_for_asset, pick_benchmark_for_os

    mapping = pick_benchmark_for_os(db, tenant_id, os_normalized or "")
    # Always call applicable_plugins_for_asset — it already encapsulates the
    # strict→soft fallback. Gating it on `if mapping:` here would silently
    # disable the soft fallback for this endpoint and keep the UI showing
    # "0 applicable rules" while the /ip-peers panel shows the same benchmark
    # has 438 rules. Same resolution order, single source of truth.
    stage2_kept, picked_bench = applicable_plugins_for_asset(db, tenant_id, os_normalized or "")
    primary_benchmark = picked_bench
    ai_picks = [picked_bench] if picked_bench else None
    # strict_map = operator-owned mapping resolved this; soft_map = picked
    # from CompliancePlugin.os_keys family walk; no_mapping = neither.
    if mapping:
        ai_status = "strict_map"
    elif picked_bench:
        ai_status = "soft_map"
    else:
        ai_status = "no_mapping"
    stage2_skipped: list = []
    stage1_kept = stage2_kept
    stage1_skipped = [p for p in plugins if p not in stage2_kept]
    candidate_benchmarks = [picked_bench] if picked_bench else []

    # Look up the OS knowledge entry so the UI can render the canonical
    # display name + parent + EOL flag without doing a second round trip.
    from sqlalchemy import text as _sql_text
    os_entry = None
    if os_normalized:
        r = db.execute(_sql_text(
            "SELECT family, product, build, parent_key, display_name, "
            "       is_supported, eol_year, benchmark_hint "
            "FROM grc_os_versions WHERE normalized_key = :k"
        ), {"k": os_normalized}).first()
        if r:
            os_entry = {
                "family": r[0], "product": r[1], "build": r[2],
                "parent_key": r[3], "display_name": r[4],
                "is_supported": r[5], "eol_year": r[6],
                "benchmark_hint": r[7],
            }

    return {
        "asset": {
            "id": asset.id,
            "name": asset.name,
            "os_family": os_family,
            "os_version": os_version,
            "os_normalized": os_normalized,
            "os_build": getattr(asset, "os_build", None),
            "os_edition": getattr(asset, "os_edition", None),
            "criticality": asset.criticality,
            "os_knowledge": os_entry,
        },
        "total_plugins": total,
        "matcher_mode": "strict_single_stage",
        "matcher_mapping": {
            "os_pattern": mapping.os_pattern if mapping else (os_normalized if picked_bench else None),
            "benchmark_name": mapping.benchmark_name if mapping else picked_bench,
            "scope": (
                "tenant" if (mapping and mapping.tenant_id is not None)
                else "global" if mapping
                else "soft" if picked_bench
                else None
            ),
            "mapping_id": mapping.id if mapping else None,
            "source": "strict" if mapping else ("soft" if picked_bench else None),
        },
        "stage1_regex": {
            "name": "Strict OS→Benchmark mapping",
            "description": "Asset OS prefix is looked up in the strict mapping table. The single chosen benchmark's rules are the candidates — no family-walk mixing.",
            "kept": len(stage1_kept),
            "skipped": len(stage1_skipped),
            "examples_kept": _sample(stage1_kept),
            "examples_skipped": _sample(stage1_skipped),
        },
        "stage2_ai": {
            "name": "Strict pick (no AI)",
            "description": "Strict mode: Stage 2 is identity. The chosen benchmark is the single mapped one. Archived benchmarks never appear.",
            "status": ai_status,
            "candidates_in": len(candidate_benchmarks),
            "kept": len(stage2_kept),
            "skipped": 0,
            "ai_picked_benchmarks": [primary_benchmark] if primary_benchmark else [],
            "primary_benchmark": primary_benchmark,
            "examples_kept": _sample(stage2_kept),
            "examples_skipped": [],
        },
        "applicable": {
            "count": len(stage2_kept),
            "examples": _sample(stage2_kept, n=5),
        },
    }


@router.post("/assets/{asset_id}/re-detect-os")
def re_detect_asset_os(
    asset_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """Re-probe the asset's OS via its stored integration connection.

    Used when:
      - CMDB import gave vague OS data ("Windows 11") and operator wants
        to refresh to the exact build (windows-11-23H2).
      - An OS upgrade happened on the host (22H2 → 23H2 cycle).

    Looks up the connection whose console_url matches the asset's host,
    re-runs the OS probe, and writes the result back to the asset row.
    Returns the before/after diff so the UI can show what changed.
    """
    from .services.credentials import resolve_credentials_for_connection
    from .services.os_detector import detect_for_runner_full

    tenant_id = get_user_primary_tenant(current_user, db)
    asset = db.query(ITAsset).filter(
        ITAsset.id == asset_id, ITAsset.tenant_id == tenant_id
    ).first()
    if not asset:
        raise HTTPException(404, "Asset not found")
    if not asset.host_name:
        raise HTTPException(400, "Asset has no host_name to probe")

    # Find the connection that targets this asset's host. Multiple
    # connections can share a console_url (e.g. localhost hosts a Windows
    # service AND a Postgres instance) — naive .first() would pick by
    # arbitrary insertion order and probe the wrong service (Windows for a
    # Postgres asset, etc.). Prefer the connection whose integration_type
    # matches the asset's vendor / os_normalized profile, then fall back
    # to most recent.
    candidates = db.query(IntegrationConnection).filter(
        IntegrationConnection.tenant_id == tenant_id,
        IntegrationConnection.is_active.is_(True),
        func.lower(IntegrationConnection.console_url) == asset.host_name.lower().strip(),
    ).order_by(IntegrationConnection.id.desc()).all()
    if not candidates:
        raise HTTPException(
            400,
            f"No integration connection found for host '{asset.host_name}'. "
            f"Add credentials via Connect Wizard first.",
        )

    def _preferred_runner_for_asset(a: ITAsset) -> Optional[str]:
        """Derive the integration_type the operator likely wants to probe
        for this asset. Reads vendor first (operator-curated, more reliable
        than os_normalized which may be missing on manual rows), then os."""
        v = (a.vendor or "").lower().strip()
        if v == "postgresql": return "postgres_sql"
        if v == "mysql": return "mysql_sql"
        if v == "oracle": return "oracle_sql"
        # vendor='Microsoft' can mean Windows OR MSSQL — disambiguate by
        # asset_type. Application + Microsoft → SQL Server.
        if v == "microsoft" and (a.asset_type or "") == "application":
            return "mssql_sql"
        if v == "iis": return "windows_winrm"
        if v in ("apache", "nginx", "tomcat", "red hat"): return "linux_ssh"
        # OS-normalized signal is the secondary source.
        k = (a.os_normalized or "").lower()
        if k.startswith("postgresql") or k.startswith("postgres"): return "postgres_sql"
        if k.startswith("mysql") or k.startswith("mariadb"): return "mysql_sql"
        if k.startswith("mssql") or k.startswith("sql-server"): return "mssql_sql"
        if k.startswith("oracle-db") or k.startswith("oracle"): return "oracle_sql"
        if k.startswith("windows") or k.startswith("iis"): return "windows_winrm"
        if any(k.startswith(p) for p in ("ubuntu","linux","debian","centos","rhel","amazon-linux","rocky","almalinux","oraclelinux","tomcat","apache","nginx")):
            return "linux_ssh"
        return None

    preferred = _preferred_runner_for_asset(asset)
    conn = next((c for c in candidates if c.integration_type == preferred), None) if preferred else None
    if conn is None:
        conn = candidates[0]  # most recent by id desc

    try:
        creds = resolve_credentials_for_connection(conn) or {}
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(500, f"Failed to load credentials: {exc}")

    before = {
        "os_family": asset.os_family,
        "os_version": asset.os_version,
        "os_normalized": asset.os_normalized,
        "os_build": asset.os_build,
        "os_edition": asset.os_edition,
    }
    fam, ver, norm, build, edition = detect_for_runner_full(conn.integration_type, creds)
    if fam:     asset.os_family = fam
    if ver:     asset.os_version = ver
    if norm:    asset.os_normalized = norm
    if build:   asset.os_build = build
    if edition: asset.os_edition = edition
    db.commit()
    after = {
        "os_family": asset.os_family,
        "os_version": asset.os_version,
        "os_normalized": asset.os_normalized,
        "os_build": asset.os_build,
        "os_edition": asset.os_edition,
    }
    changes = {k: {"before": before[k], "after": after[k]} for k in after if before[k] != after[k]}
    return {
        "asset_id": asset.id,
        "asset_name": asset.name,
        "connection": {"id": conn.id, "name": conn.connection_name, "type": conn.integration_type},
        "before": before,
        "after": after,
        "changes": changes,
        "any_changed": bool(changes),
    }


@router.get("/connections")
def list_connections(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """All agentless integration connections in the tenant with their
    scope metadata + live resolution counts. The Connections UI lists
    these and shows: "this SSH cred → 12 of 47 Linux hosts"."""
    from .services.scope import resolve_assets
    tenant_id = get_user_primary_tenant(current_user, db)
    conns = db.query(IntegrationConnection).filter(
        IntegrationConnection.tenant_id == tenant_id
    ).all()
    assets = db.query(ITAsset).filter(ITAsset.tenant_id == tenant_id).all()
    out = []
    for c in conns:
        resolved = resolve_assets(c, assets)
        out.append({
            "id": c.id,
            "name": c.connection_name,
            "integration_type": c.integration_type,
            "console_url": c.console_url,
            "status": c.status,
            "scope_mode": c.scope_mode or "tenant_all",
            "scope_value": c.scope_value or {},
            "resolved_asset_count": len(resolved),
            "last_scope_resolution_count": c.last_scope_resolution_count,
            "scope_updated_at": c.scope_updated_at.isoformat() if c.scope_updated_at else None,
        })
    return {"connections": out, "tenant_asset_total": len(assets)}


@router.put("/connections/{connection_id}/scope")
def update_connection_scope(
    connection_id: int,
    body: dict,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """Set a credential's scope. Accepts:
        {"scope_mode": "asset_list", "scope_value": {"asset_ids": [1,2]}}
        {"scope_mode": "tenant_all"}
        {"scope_mode": "asset_tag", "scope_value": {"tags": ["DMZ"]}}
        {"scope_mode": "ip_range", "scope_value": {"cidrs": ["10.0.0.0/8"]}}
    Returns the new resolution count.
    """
    from datetime import datetime, timezone
    from .services.scope import resolve_assets
    tenant_id = get_user_primary_tenant(current_user, db)
    conn = db.query(IntegrationConnection).filter(
        IntegrationConnection.id == connection_id,
        IntegrationConnection.tenant_id == tenant_id,
    ).first()
    if not conn:
        raise HTTPException(404, "Connection not found")
    allowed_modes = {"tenant_all", "asset_list", "asset_tag", "ip_range"}
    mode = (body.get("scope_mode") or "").strip()
    if mode not in allowed_modes:
        raise HTTPException(422, f"scope_mode must be one of {sorted(allowed_modes)}")
    value = body.get("scope_value") or {}
    if not isinstance(value, dict):
        raise HTTPException(422, "scope_value must be an object")
    conn.scope_mode = mode
    conn.scope_value = value
    conn.scope_updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(conn)
    assets = db.query(ITAsset).filter(ITAsset.tenant_id == tenant_id).all()
    resolved = resolve_assets(conn, assets)
    conn.last_scope_resolution_count = len(resolved)
    db.commit()
    return {
        "connection_id": conn.id,
        "scope_mode": conn.scope_mode,
        "scope_value": conn.scope_value,
        "resolved_asset_count": len(resolved),
        "sample": [{"id": a.id, "name": a.name, "host_name": a.host_name} for a in resolved[:10]],
    }


@router.post("/connections/{connection_id}/scope-preview")
def preview_connection_scope(
    connection_id: int,
    body: dict,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """Hypothetical: 'if I set scope to X, how many assets would resolve?'
    Used by the Connect Wizard's scope step before the user commits."""
    from .services.scope import preview_scope
    tenant_id = get_user_primary_tenant(current_user, db)
    conn = db.query(IntegrationConnection).filter(
        IntegrationConnection.id == connection_id,
        IntegrationConnection.tenant_id == tenant_id,
    ).first()
    if not conn:
        raise HTTPException(404, "Connection not found")
    # Stage a *shadow* connection with the proposed scope without persisting
    class _Shadow:
        def __init__(self, src, mode, value):
            self.id = src.id
            self.integration_type = src.integration_type
            self.scope_mode = mode
            self.scope_value = value
    shadow = _Shadow(
        conn,
        (body.get("scope_mode") or conn.scope_mode or "tenant_all"),
        (body.get("scope_value") or {}),
    )
    assets = db.query(ITAsset).filter(ITAsset.tenant_id == tenant_id).all()
    return preview_scope(shadow, assets, sample=10)


@router.get("/library-tree/rule-targets")
def rule_targets(
    rule_id: int = Query(..., description="grc_compliance_plugins.id"),
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """For a single rule, return the assets this rule applies to.

    Uses the pre-computed os_keys (Block A persistence) to do a fast
    intersection with asset.os_normalized — no live AI call. Returns:
      {
        rule: {rule_id, title, benchmark, os_keys, runner_type},
        ai_verdict: {
          applies_to_count: 3,
          tenant_asset_count: 12,
          confidence: "high" | "medium" | "low",
          reasoning: "..."
        },
        assets: [{id, name, host_name, os_normalized, criticality}, ...]
      }
    """
    tenant_id = get_user_primary_tenant(current_user, db)
    rule = db.query(CompliancePlugin).filter(
        CompliancePlugin.id == rule_id,
        (CompliancePlugin.tenant_id.is_(None)) | (CompliancePlugin.tenant_id == tenant_id),
    ).first()
    if not rule:
        raise HTTPException(404, "Rule not found")

    all_assets = db.query(ITAsset).filter(ITAsset.tenant_id == tenant_id).all()
    rule_os_keys = set(rule.os_keys or [])

    # Match if asset's normalized key OR any ancestor (family-walk) is in
    # the rule's os_keys. Stage 1 is permissive — Stage 2 AI does precision.
    matching = []
    for a in all_assets:
        a_norm = (a.os_normalized or "").strip()
        if not a_norm:
            continue
        if a_norm in rule_os_keys:
            matching.append(a)
            continue
        # Family walk: windows-11-25H2 → windows-11 → windows
        if "-" in a_norm:
            parts = a_norm.split("-")
            matched = False
            for i in range(len(parts) - 1, 0, -1):
                if "-".join(parts[:i]) in rule_os_keys:
                    matched = True
                    break
            if matched:
                matching.append(a)

    # Confidence: high if rule has classified os_keys + matches exist
    if rule.classification_source == "ai":
        confidence = "high"
        reasoning = f"AI router (gpt-4o-mini) tagged this rule to {len(rule_os_keys)} OS key(s): {sorted(rule_os_keys)}. Matched against {len(all_assets)} tenant assets."
    elif rule.classification_source == "regex":
        confidence = "high"
        reasoning = f"Regex matcher confidently tagged this rule to {sorted(rule_os_keys) or 'unknown OS'}. Matched against {len(all_assets)} tenant assets."
    else:
        confidence = "low"
        reasoning = "Rule has no pre-classified OS keys yet. Run the AI Classifier to tag."

    return {
        "rule": {
            "id": rule.id,
            "rule_id": rule.rule_id,
            "title": rule.title,
            "benchmark": rule.benchmark,
            "os_keys": list(rule_os_keys),
            "severity": rule.severity,
            "runner_type": rule.runner_type,
            "classification_source": rule.classification_source,
        },
        "ai_verdict": {
            "applies_to_count": len(matching),
            "tenant_asset_count": len(all_assets),
            "confidence": confidence,
            "reasoning": reasoning,
        },
        "assets": [
            {
                "id": a.id, "name": a.name, "host_name": a.host_name,
                "ip_address": a.ip_address, "os_normalized": a.os_normalized,
                "os_build": getattr(a, "os_build", None),
                "criticality": a.criticality,
            }
            for a in matching
        ],
    }


@router.get("/library-tree/benchmark-sections")
def library_tree_benchmark_sections(
    benchmark: str = Query(..., description="Exact benchmark name to drill into"),
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """Drill into a single benchmark and return its rules grouped by
    section / subsection — the way CIS PDFs organise content.

    Example: "CIS_Microsoft_Windows_11_Enterprise_Benchmark_v5.0.1" →
      [
        { number: "1", label: "Section 1", rule_count: 11, subsections: [
          { number: "1.1", label: "Subsection 1.1", rule_count: 7, rules: [
            { rule_id: "1.1.1", title: "Enforce password history...", severity: "high" },
            { rule_id: "1.1.2", title: "Maximum password age...", severity: "medium" }
          ]},
          { number: "1.2", ... }
        ]},
        { number: "2", ... }
      ]

    The section labels here are numeric ("Section 1") rather than human
    ("Account Policies"). CIS PDFs do publish human section names but
    they're not in our rule rows yet — Block H wired a section_path
    column for future enrichment.
    """
    tenant_id = get_user_primary_tenant(current_user, db)
    rules = (
        db.query(CompliancePlugin)
        .filter(
            CompliancePlugin.benchmark == benchmark,
            CompliancePlugin.enabled.is_(True),
            CompliancePlugin.review_status.in_(["approved", "auto_approved"]),
            (CompliancePlugin.tenant_id.is_(None)) | (CompliancePlugin.tenant_id == tenant_id),
        )
        .order_by(CompliancePlugin.rule_id)
        .all()
    )

    if not rules:
        raise HTTPException(404, f"No approved rules found for benchmark '{benchmark}'")

    # Group: section_top → subsection → rules
    sections: dict[str, dict] = {}
    for r in rules:
        rid = (r.rule_id or "").strip()
        if not rid:
            continue
        parts = rid.split(".")
        top = parts[0]
        sub = ".".join(parts[:2]) if len(parts) >= 2 else top
        section = sections.setdefault(top, {
            "number": top,
            "label": f"Section {top}",
            "rule_count": 0,
            "subsections": {},
        })
        subsection = section["subsections"].setdefault(sub, {
            "number": sub,
            "label": f"Subsection {sub}",
            "rule_count": 0,
            "rules": [],
        })
        subsection["rules"].append({
            "id": r.id,
            "rule_id": r.rule_id,
            "title": r.title or "",
            "severity": r.severity,
            "runner_type": r.runner_type,
            "os_keys": r.os_keys or [],
        })
        subsection["rule_count"] += 1
        section["rule_count"] += 1

    # Sort numerically (so 2.1 comes before 10.1)
    def _num_sort(v: str) -> tuple:
        try:
            return tuple(int(p) for p in v.split("."))
        except ValueError:
            return (9999,) + tuple(ord(c) for c in v)

    out = []
    for sec in sorted(sections.values(), key=lambda s: _num_sort(s["number"])):
        sec_subs = sorted(sec["subsections"].values(), key=lambda s: _num_sort(s["number"]))
        out.append({
            "number": sec["number"],
            "label": sec["label"],
            "rule_count": sec["rule_count"],
            "subsections": sec_subs,
        })
    return {
        "benchmark": benchmark,
        "total_rules": len(rules),
        "sections": out,
    }


@router.get("/library-tree")
def library_tree(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """Hierarchical rule library: OS family → product → build → benchmark.

    For the Plugin Automation page hierarchy view. Each node carries a
    rule_count so the operator can see at a glance "Windows 11 23H2 →
    548 rules, Cisco ASA → 76 rules" without expanding everything.

    Tree shape:
      [
        { key: "windows", label: "Windows", rule_count: 4023, children: [
          { key: "windows-11", label: "Windows 11", rule_count: 538,
            children: [
              { key: "windows-11-23H2", label: "23H2 (build)", rule_count: 538,
                children: [
                  { key: "benchmark::CIS_...", label: "CIS Win 11 Ent v5.0.1",
                    rule_count: 538, leaf: true }
                ]}
            ]}
        ]}
      ]
    """
    from sqlalchemy import text as _sql_text
    tenant_id = get_user_primary_tenant(current_user, db)

    # Per-OS-key rule count (uses Block A persisted os_keys column).
    #
    # The CAST(... AS jsonb) is defensive: schema_migrations declares
    # os_keys as JSONB, but tenant DBs created BEFORE that migration
    # landed with the column typed as plain JSON. Adding a column with
    # CREATE-IF-NOT-EXISTS semantics is a no-op when the column already
    # exists, so the type never got upgraded for those tenants. Casting
    # in the query makes this endpoint work on both type variants
    # without forcing a per-tenant ALTER COLUMN sweep.
    # Guard: some rows persist os_keys as a JSON scalar (e.g. "" or null)
    # rather than an array. jsonb_array_elements_text() raises "cannot extract
    # elements from a scalar" on those, 500-ing the whole endpoint. Only expand
    # rows whose os_keys is actually a JSON array; others contribute no keys.
    key_counts_rows = db.execute(_sql_text(
        "SELECT key, COUNT(*) AS n "
        "FROM grc_compliance_plugins, "
        "     jsonb_array_elements_text("
        "       CASE WHEN jsonb_typeof(CAST(os_keys AS jsonb)) = 'array' "
        "            THEN CAST(os_keys AS jsonb) ELSE '[]'::jsonb END"
        "     ) AS key "
        "WHERE enabled = TRUE AND review_status IN ('approved','auto_approved') "
        "  AND (tenant_id IS NULL OR tenant_id = :tid) "
        "GROUP BY key"
    ), {"tid": tenant_id}).all()
    rules_per_key: dict[str, int] = {row[0]: row[1] for row in key_counts_rows}

    # Per-benchmark (rule_count + which os_keys it targets)
    bench_rows = db.execute(_sql_text(
        "SELECT benchmark, os_keys, COUNT(*) AS n "
        "FROM grc_compliance_plugins "
        "WHERE enabled = TRUE AND review_status IN ('approved','auto_approved') "
        "  AND (tenant_id IS NULL OR tenant_id = :tid) "
        "  AND benchmark IS NOT NULL "
        "GROUP BY benchmark, os_keys"
    ), {"tid": tenant_id}).all()

    # OS registry entries (parent-child)
    reg_rows = db.execute(_sql_text(
        "SELECT family, normalized_key, parent_key, display_name, build, is_supported "
        "FROM grc_os_versions ORDER BY family, normalized_key"
    )).all()

    # Build registry index
    by_key: dict[str, dict] = {}
    by_parent: dict[str | None, list[dict]] = {}
    families: set[str] = set()
    for fam, key, parent, label, build, supported in reg_rows:
        node = {
            "key": key, "label": label, "build": build,
            "is_supported": supported, "family": fam,
            "rule_count": rules_per_key.get(key, 0),
            "children": [],
            "benchmarks": [],
        }
        by_key[key] = node
        by_parent.setdefault(parent, []).append(node)
        families.add(fam)

    # Attach benchmarks to their most-specific OS key (last item in os_keys[])
    for bench, os_keys, n in bench_rows:
        if not bench:
            continue
        keys_list = os_keys or []
        target_key = keys_list[-1] if keys_list else None
        bench_node = {
            "kind": "benchmark", "key": f"benchmark::{bench}", "label": bench,
            "rule_count": n, "os_keys": keys_list,
        }
        if target_key and target_key in by_key:
            by_key[target_key]["benchmarks"].append(bench_node)
        else:
            # Orphan benchmark — bucket under a synthetic node
            orphan = by_key.setdefault("__orphan__", {
                "key": "__orphan__", "label": "Other / unclassified",
                "family": "other", "rule_count": 0, "children": [],
                "benchmarks": [],
            })
            orphan["benchmarks"].append(bench_node)
            orphan["rule_count"] += n

    # Wire children
    for parent_key, kids in by_parent.items():
        if parent_key and parent_key in by_key:
            by_key[parent_key]["children"].extend(kids)

    # Roll counts UP the tree: every parent folder shows the SUM of all its
    # descendants' rules. A rule belongs to exactly one benchmark, so summing
    # benchmark counts up the hierarchy is accurate with no double-counting
    # (unlike per-os-key counts, where a rule tagged ["windows","windows-11"]
    # lands in two buckets). This is why family/product folders were showing 0:
    # plugins are tagged with specific build keys (windows-10) but not the bare
    # family key (windows), so `rules_per_key["windows"]` was empty.
    def _rollup(node: dict) -> int:
        total = sum(b.get("rule_count", 0) for b in node.get("benchmarks", []))
        for child in node.get("children", []):
            total += _rollup(child)
        node["rule_count"] = total
        return total

    for _root in by_parent.get(None, []):
        _rollup(_root)

    # Build family roots
    family_labels = {
        "windows": "Windows",
        "linux": "Linux",
        "macos": "macOS",
        "cisco": "Cisco",
        "cloud": "Cloud Accounts",
        "container": "Containers",
        "db": "Databases",
        "network": "Network",
        "app": "Applications",
        "unix": "Unix / Mainframe",
        "hypervisor": "Hypervisors",
        "endpoint": "Endpoints",
        "other": "Other",
    }
    tree = []
    for fam in sorted(families):
        # roots inside this family = parent_key IS NULL nodes whose family matches
        roots = [n for n in by_parent.get(None, []) if n.get("family") == fam]
        # Unwrap the bare family node (key == family, e.g. "windows" labelled
        # "Windows") so we don't render a redundant "Windows > Windows" nest —
        # its children/benchmarks fold directly under the family folder.
        children, family_benchmarks = [], []
        for r in roots:
            if r["key"] == fam:
                children.extend(r.get("children", []))
                family_benchmarks.extend(r.get("benchmarks", []))
            else:
                children.append(r)
        total_rules = sum(c["rule_count"] for c in children) + sum(b.get("rule_count", 0) for b in family_benchmarks)
        tree.append({
            "key": f"family::{fam}",
            "label": family_labels.get(fam, fam.title()),
            "kind": "family",
            "rule_count": total_rules,
            "children": children,
            "benchmarks": family_benchmarks,
        })
    if "__orphan__" in by_key:
        orph = by_key["__orphan__"]
        tree.append({
            "key": "family::other",
            "label": "Other / unclassified",
            "kind": "family",
            "rule_count": orph["rule_count"],
            "children": [],
            "benchmarks": orph["benchmarks"],
        })

    # Prune empty branches: OS folders that carry no rules anywhere beneath
    # them (e.g. a "Windows 10 — 21H2" build with no benchmark mapped to that
    # exact build) are noise — the operator sees "0 rules" under a parent that
    # says 2,199 and thinks it's broken. Drop any child whose rolled-up count
    # is 0; the benchmarks that actually hold the rules (attached to the
    # product level) stay visible, and every folder shown now has real rules.
    def _prune(node: dict) -> None:
        node["children"] = [c for c in node.get("children", []) if c.get("rule_count", 0) > 0]
        for c in node["children"]:
            _prune(c)
    for _fam_node in tree:
        _prune(_fam_node)
    tree = [f for f in tree if f.get("rule_count", 0) > 0 or f.get("benchmarks")]

    # Total-rules KPI must be the actual count of approved+enabled plugins,
    # NOT the sum-over-os-keys (which double-counts: a plugin tagged
    # ["windows", "windows-11"] would land in both rules_per_key buckets).
    # The previous `sum(rules_per_key.values())` inflated the KPI by ~70%.
    distinct_total = db.execute(_sql_text(
        "SELECT COUNT(*) FROM grc_compliance_plugins "
        "WHERE enabled = TRUE AND review_status IN ('approved','auto_approved') "
        "  AND (tenant_id IS NULL OR tenant_id = :tid)"
    ), {"tid": tenant_id}).scalar() or 0

    return {
        "tree": tree,
        "total_rules": int(distinct_total),
        "total_benchmarks": len(set(row[0] for row in bench_rows if row[0])),
    }


@router.get("/os-registry")
def os_registry(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """Canonical OS knowledge graph used for build-level rule routing.

    Returns every supported OS family / product / build the system
    recognises, with: normalized_key, parent_key, display_name, support
    flag, suggested benchmark hint, and live counts of (plugins targeting
    this key, assets running this OS). The UI uses this for the OS
    Registry admin page and for the per-asset OS dropdown.
    """
    from sqlalchemy import text as _sql_text
    tenant_id = get_user_primary_tenant(current_user, db)

    rows = db.execute(_sql_text(
        "SELECT v.id, v.family, v.product, v.build, v.normalized_key, "
        "       v.parent_key, v.display_name, v.release_year, v.eol_year, "
        "       v.is_supported, v.benchmark_hint, "
        "       (SELECT COUNT(*) FROM grc_compliance_plugins p "
        "        WHERE p.os_keys ? v.normalized_key "
        "          AND p.enabled = TRUE "
        "          AND p.review_status IN ('approved','auto_approved')"
        "       ) AS plugin_count, "
        "       (SELECT COUNT(*) FROM grc_it_assets a "
        "        WHERE a.tenant_id = :tid "
        "          AND a.os_normalized = v.normalized_key"
        "       ) AS asset_count "
        "FROM grc_os_versions v "
        "ORDER BY v.family, v.product, v.build NULLS FIRST, v.normalized_key"
    ), {"tid": tenant_id}).all()

    items = [
        {
            "id": r[0],
            "family": r[1],
            "product": r[2],
            "build": r[3],
            "normalized_key": r[4],
            "parent_key": r[5],
            "display_name": r[6],
            "release_year": r[7],
            "eol_year": r[8],
            "is_supported": r[9],
            "benchmark_hint": r[10],
            "plugin_count": r[11] or 0,
            "asset_count": r[12] or 0,
        }
        for r in rows
    ]
    return {"items": items, "total": len(items)}


@router.get("/classify-stream")
async def classify_stream(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """Stream live AI classification of every unique benchmark.

    Walks all approved plugins, groups by benchmark, and for each unique
    benchmark: (1) tries the deterministic regex matcher first, (2) falls
    back to AI for unknown benchmarks, (3) persists the result to
    `os_keys` + `classification_source` + `classified_at` on every plugin
    sharing that benchmark.

    Emits text/event-stream so the admin UI can render the funnel in real
    time. Each event payload:
        {i, total, benchmark, plugin_count, keys, source, reasoning?}
    Final event:
        {done: true, total, by_source: {regex: N, ai: N, unknown: N}}
    """
    import asyncio
    import json as _json
    from datetime import datetime, timezone
    from fastapi.responses import StreamingResponse
    from sqlalchemy import text as _sql_text
    from .services.benchmark_matcher import benchmark_target_keys, BENCHMARK_PATTERNS, EXTRA_AI_OS_KEYS
    from .services.ai_benchmark_router import classify_benchmark_with_ai

    tenant_id = get_user_primary_tenant(current_user, db)

    # Distinct benchmark → list[plugin_id] map (tenant + global pool)
    rows = (
        db.query(CompliancePlugin.id, CompliancePlugin.benchmark)
        .filter(
            (CompliancePlugin.tenant_id.is_(None)) | (CompliancePlugin.tenant_id == tenant_id),
            CompliancePlugin.review_status.in_(["approved", "auto_approved"]),
            CompliancePlugin.enabled.is_(True),
        )
        .all()
    )
    by_benchmark: dict[str, list[int]] = {}
    for pid, bench in rows:
        b = (bench or "").strip()
        if not b:
            continue
        by_benchmark.setdefault(b, []).append(pid)

    benchmarks = sorted(by_benchmark.keys())
    total = len(benchmarks)

    # Build the controlled vocabulary the AI is allowed to pick from
    all_keys: set[str] = set(EXTRA_AI_OS_KEYS)
    for _pat, keys in BENCHMARK_PATTERNS:
        all_keys.update(keys)
    known_keys_csv = ",".join(sorted(all_keys))

    async def event_gen():
        counts = {"regex": 0, "ai": 0, "unknown": 0}
        yield f"data: {_json.dumps({'phase': 'start', 'total': total})}\n\n"
        for i, bench in enumerate(benchmarks):
            plugin_ids = by_benchmark[bench]
            # Stage A — regex
            keys = list(benchmark_target_keys(bench))
            source = "regex" if keys else None
            reasoning = ""
            # Stage B — AI fallback
            if not keys:
                ai_keys, ai_reasoning = classify_benchmark_with_ai(bench, known_keys_csv)
                if ai_keys:
                    keys = list(ai_keys)
                    source = "ai"
                    reasoning = ai_reasoning
                else:
                    source = "unknown"
                    reasoning = ai_reasoning or "no match found"
            counts[source] = counts.get(source, 0) + 1
            # Persist
            now = datetime.now(timezone.utc)
            db.execute(
                _sql_text(
                    "UPDATE grc_compliance_plugins SET "
                    "os_keys = CAST(:keys AS jsonb), "
                    "classification_source = :src, "
                    "classified_at = :ts "
                    "WHERE id = ANY(:ids)"
                ),
                {"keys": _json.dumps(keys), "src": source, "ts": now, "ids": plugin_ids},
            )
            db.commit()
            payload = {
                "phase": "tick",
                "i": i,
                "total": total,
                "benchmark": bench,
                "plugin_count": len(plugin_ids),
                "keys": keys,
                "source": source,
                "reasoning": reasoning,
            }
            yield f"data: {_json.dumps(payload)}\n\n"
            # Small pacing so UI can render frames; AI calls already slow.
            await asyncio.sleep(0.02)
        yield f"data: {_json.dumps({'phase': 'done', 'total': total, 'by_source': counts})}\n\n"

    return StreamingResponse(event_gen(), media_type="text/event-stream", headers={
        "Cache-Control": "no-cache",
        "X-Accel-Buffering": "no",
    })


@router.get("/classification-stats")
def classification_stats(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """Snapshot of how many plugins have been pre-classified."""
    from sqlalchemy import text as _sql_text
    tenant_id = get_user_primary_tenant(current_user, db)
    row = db.execute(
        _sql_text(
            "SELECT "
            "  COUNT(*) AS total, "
            "  COUNT(*) FILTER (WHERE classification_source IS NOT NULL) AS classified, "
            "  COUNT(*) FILTER (WHERE classification_source = 'regex') AS regex_cnt, "
            "  COUNT(*) FILTER (WHERE classification_source = 'ai') AS ai_cnt, "
            "  COUNT(*) FILTER (WHERE classification_source = 'unknown') AS unknown_cnt, "
            "  COUNT(DISTINCT benchmark) AS unique_benchmarks, "
            "  MAX(classified_at) AS last_run "
            "FROM grc_compliance_plugins "
            "WHERE (tenant_id IS NULL OR tenant_id = :tid) "
            "  AND review_status IN ('approved', 'auto_approved') "
            "  AND enabled = TRUE"
        ),
        {"tid": tenant_id},
    ).first()
    return {
        "total": row[0] or 0,
        "classified": row[1] or 0,
        "regex": row[2] or 0,
        "ai": row[3] or 0,
        "unknown": row[4] or 0,
        "unique_benchmarks": row[5] or 0,
        "last_run": row[6].isoformat() if row[6] else None,
    }


class _PromoteBenchmarkRequest(BaseModel):
    """Operator-driven promote request. The caller names a target
    benchmark (the new version) and optionally a single specific old
    sibling to promote. If old_label is omitted, every older sibling in
    the same family is promoted (rare — usually the operator picks the
    one specific older version they want to retire)."""
    new_label: str
    old_label: Optional[str] = None


@router.post("/benchmarks/promote")
def promote_benchmark(
    body: _PromoteBenchmarkRequest,
    db: Session = Depends(get_db),
    # PLATFORM-ADMIN ONLY. Promotion mutates the shared global benchmark
    # library (archives old version, flips every tenant's mapping). Must
    # never be triggered by a tenant user, even an admin one.
    current_user: GRCUser = Depends(require_platform_admin),
):
    """Promote a benchmark over an older sibling.

    Renames the older version's rows to ``<label>-ARCHIVE`` and flips any
    OS→benchmark mapping rows from old → new. This is the explicit
    operator action that replaces the v1 ingest-time auto-flip.

    Hassan's policy: ingestion never silently flips anything. A dev/
    operator uploads a new PDF, both versions co-exist in the library,
    and someone with admin rights clicks "Promote" when the bank is
    ready to switch its assets to the new rulebook.
    """
    from .pdf_ingest.benchmark_supersession import promote_to_supersede
    tenant_id = get_user_primary_tenant(current_user, db)
    # The benchmark rows are written with tenant_id=NULL (global library)
    # in the current ingest path. promote_to_supersede also accepts a
    # tenant_id so per-tenant overrides remain possible later.
    result = promote_to_supersede(
        db, body.new_label,
        tenant_id=None,
        only_promote_label=body.old_label,
    )
    return {
        "promoted_to": result.new_label,
        "family": result.family,
        "new_version": ".".join(str(p) for p in result.new_version),
        "archived_siblings": result.archived_siblings,
        "rules_archived": result.rules_archived,
        "mapping_rows_repointed": result.mapping_rows_repointed,
        "skipped_downgrade_of": result.skipped_downgrade_of,
    }


@router.get("/benchmarks")
def list_benchmarks(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    tenant_id = get_user_primary_tenant(current_user, db)
    rows = (
        db.query(CompliancePlugin.benchmark, CompliancePlugin.runner_type)
        .filter((CompliancePlugin.tenant_id.is_(None)) | (CompliancePlugin.tenant_id == tenant_id))
        .all()
    )
    counts: dict[str, dict[str, Any]] = {}
    for b, rt in rows:
        c = counts.setdefault(b, {"benchmark": b, "runner_type": rt, "rule_count": 0})
        c["rule_count"] += 1
    return {"benchmarks": list(counts.values())}


# ─── CIS PDF Ingestion ──────────────────────────────────────────────────────

@router.post("/ingest", status_code=201)
async def ingest_cis_pdf(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    # PLATFORM-ADMIN ONLY. Per Hassan: tenants never upload benchmarks;
    # Compliverse ingests them centrally. Anyone not in
    # COMPLIVERSE_PLATFORM_ADMINS (.env) gets a 403.
    current_user: GRCUser = Depends(require_platform_admin),
):
    """Upload a CIS Benchmark PDF and run the multi-layer extraction pipeline.

    The pipeline: pdfplumber text → PyMuPDF blocks (sparse-page fallback)
    → Tesseract OCR (image-page fallback) → numeric-prefix rule splitter
    → field extractor → check_definition synthesiser → upsert into the
    plugin library. New rules are inserted disabled and (when confidence
    < 0.6) flagged for human review before they can run.
    """
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(422, "File must be a .pdf")
    pdf_bytes = await file.read()
    if not pdf_bytes:
        raise HTTPException(422, "Uploaded file is empty")
    if len(pdf_bytes) > 50 * 1024 * 1024:
        raise HTTPException(413, "PDF exceeds 50 MB limit")
    # Tenant-scoped ingestion: rules land under the caller's tenant_id so
    # no other tenant inherits them automatically.
    tenant_id = get_user_primary_tenant(current_user, db)
    job = ingest_pdf(
        db,
        pdf_bytes,
        original_filename=file.filename,
        tenant_id=tenant_id,
        uploaded_by=current_user.id,
    )
    return _job_to_dict(job)


@router.get("/ingest")
def list_ingest_jobs(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    tenant_id = get_user_primary_tenant(current_user, db)
    jobs = (
        db.query(CisIngestJob)
        .filter(CisIngestJob.tenant_id == tenant_id)
        .order_by(CisIngestJob.id.desc())
        .limit(100)
        .all()
    )
    return {"jobs": [_job_to_dict(j) for j in jobs]}


@router.post("/ingest/{job_id}/reparse", status_code=200)
def reparse_ingest_job(
    job_id: int,
    db: Session = Depends(get_db),
    # PLATFORM-ADMIN ONLY — same rationale as /ingest above.
    current_user: GRCUser = Depends(require_platform_admin),
):
    """Re-run the extraction pipeline against this job's stored PDF bytes.

    Use case: ship a parser fix, click "Re-parse" on the affected job,
    and watch the rule counts/titles update without forcing a re-upload
    of the same 5-50 MB PDF. Plugins from the previous run that are
    still ``pending_review`` and not yet linked to runs are deleted
    first so the review queue reflects only the latest parse — already
    approved or executed plugins are kept and updated in place by the
    pipeline's normal upsert path.
    """
    tenant_id = get_user_primary_tenant(current_user, db)
    job = (
        db.query(CisIngestJob)
        .filter(CisIngestJob.id == job_id, CisIngestJob.tenant_id == tenant_id)
        .first()
    )
    if not job:
        raise HTTPException(404, "Ingest job not found")
    if not job.pdf_bytes:
        raise HTTPException(
            409,
            "This job was uploaded before PDF retention was enabled — re-upload "
            "the source file to re-parse.",
        )
    # Drop pending_review plugins from the previous run so stale rules
    # aren't double-counted. Approved / runnable plugins are left alone
    # so historical evidence and approvals survive a re-parse.
    deleted = (
        db.query(CompliancePlugin)
        .filter(
            CompliancePlugin.source_ingest_job_id == job.id,
            CompliancePlugin.review_status == "pending_review",
        )
        .delete(synchronize_session=False)
    )
    db.commit()
    job = ingest_pdf(
        db,
        bytes(job.pdf_bytes),
        original_filename=job.original_filename,
        tenant_id=tenant_id,
        uploaded_by=current_user.id,
        reuse_job=job,
    )
    out = _job_to_dict(job)
    out["pending_review_deleted"] = int(deleted)
    return out


@router.delete("/ingest/{job_id}", status_code=200)
def delete_ingest_job(
    job_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """Delete an ingest job AND every plugin extracted from it.

    Hard-removes both the ``CisIngestJob`` row and every
    ``CompliancePlugin`` whose ``source_ingest_job_id`` points at it —
    including approved / enabled rows. Past
    ``CompliancePluginRun`` evidence is detached (its ``plugin_id``
    foreign key is set NULL) so historical scan results survive even
    after the originating rule is gone.
    """
    tenant_id = get_user_primary_tenant(current_user, db)
    job = (
        db.query(CisIngestJob)
        .filter(CisIngestJob.id == job_id, CisIngestJob.tenant_id == tenant_id)
        .first()
    )
    if not job:
        raise HTTPException(404, "Ingest job not found")

    plugin_ids = [
        pid
        for (pid,) in db.query(CompliancePlugin.id)
        .filter(CompliancePlugin.source_ingest_job_id == job.id)
        .all()
    ]
    runs_detached = 0
    if plugin_ids:
        # Detach historical run rows so we don't violate the FK on delete.
        runs_detached = (
            db.query(CompliancePluginRun)
            .filter(CompliancePluginRun.plugin_id.in_(plugin_ids))
            .update({CompliancePluginRun.plugin_id: None}, synchronize_session=False)
        )
        # CIS rules form a parent/child tree (1.1 → 1.1.1) via
        # parent_plugin_id, with no ON DELETE behaviour declared on the
        # FK. Null those refs before the bulk delete so PG doesn't raise
        # a FK violation when a child row is deleted before its parent.
        db.query(CompliancePlugin).filter(
            CompliancePlugin.parent_plugin_id.in_(plugin_ids)
        ).update(
            {CompliancePlugin.parent_plugin_id: None}, synchronize_session=False
        )
        # Drop tenant-scoped scope/schedule overrides too.
        db.query(PluginAssetScope).filter(PluginAssetScope.plugin_id.in_(plugin_ids)).delete(
            synchronize_session=False
        )
        db.query(PluginScheduleOverride).filter(
            PluginScheduleOverride.plugin_id.in_(plugin_ids)
        ).delete(synchronize_session=False)
        db.query(PluginControlMapping).filter(
            PluginControlMapping.plugin_id.in_(plugin_ids)
        ).delete(synchronize_session=False)
        deleted_plugins = (
            db.query(CompliancePlugin)
            .filter(CompliancePlugin.id.in_(plugin_ids))
            .delete(synchronize_session=False)
        )
    else:
        deleted_plugins = 0
    db.delete(job)
    db.commit()
    return {
        "deleted_job_id": job_id,
        "deleted_plugins": int(deleted_plugins),
        "detached_runs": int(runs_detached),
    }


@router.get("/ingest/{job_id}")
def get_ingest_job(
    job_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    tenant_id = get_user_primary_tenant(current_user, db)
    job = (
        db.query(CisIngestJob)
        .filter(CisIngestJob.id == job_id, CisIngestJob.tenant_id == tenant_id)
        .first()
    )
    if not job:
        raise HTTPException(404, "Ingest job not found")
    rules = (
        db.query(CompliancePlugin)
        .filter(CompliancePlugin.source_ingest_job_id == job.id)
        .order_by(CompliancePlugin.rule_id)
        .all()
    )
    return {
        **_job_to_dict(job),
        "rules": [
            {
                "id": p.id,
                "rule_id": p.rule_id,
                "title": p.title,
                "severity": p.severity,
                "runner_type": p.runner_type,
                "review_status": p.review_status,
                "confidence_score": p.confidence_score,
                "auto_generated_check": bool(p.auto_generated_check),
                "depth": p.depth,
                "parent_plugin_id": p.parent_plugin_id,
            }
            for p in rules
        ],
    }


@router.get("/review-queue")
def review_queue(
    ingest_job_id: Optional[int] = Query(
        None, description="When set, only return plugins extracted from this ingest job"
    ),
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """List every plugin in this tenant that needs reviewer approval.

    The optional ``ingest_job_id`` filter scopes the queue to a single PDF
    upload — without it, reviewing one benchmark also drowns the screen in
    leftover entries from earlier uploads.
    """
    tenant_id = get_user_primary_tenant(current_user, db)
    q = db.query(CompliancePlugin).filter(
        CompliancePlugin.tenant_id == tenant_id,
        CompliancePlugin.review_status == "pending_review",
    )
    if ingest_job_id is not None:
        q = q.filter(CompliancePlugin.source_ingest_job_id == ingest_job_id)
    # Pre-Phase-3 the parser produced thousands of garbage rules so this
    # limit guarded the UI. Phase 3 dropped garbage rule_ids → ~972 valid
    # rules across two PDFs; 2000 is now safely above the real ceiling and
    # avoids the "Review Queue (500)" undercount the operator saw earlier.
    LIMIT = 2000
    total_pending = q.count()
    rows = (
        q.order_by(CompliancePlugin.confidence_score.asc().nullsfirst(), CompliancePlugin.rule_id)
        .limit(LIMIT)
        .all()
    )
    return {
        "plugins": [_plugin_to_dict(p, tenant_id=tenant_id, db=db) for p in rows],
        "total_pending": total_pending,
        "limit": LIMIT,
    }


@router.post("/{plugin_id}/review")
def review_plugin(
    plugin_id: int,
    body: dict,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _admin: bool = Depends(require_tenant_admin),
):
    """Approve or reject an ingested plugin.

    On ``approve`` the caller may also patch the plugin's editable fields
    (``check_definition``, ``runner_type``, ``severity``, ``title``,
    ``description``, ``rationale``, ``remediation``) so reviewers can
    tighten an auto-synthesised check before enabling it. All patches go
    through the same safety filters as :func:`import_plugins_json`.
    """
    tenant_id = get_user_primary_tenant(current_user, db)
    plugin = (
        db.query(CompliancePlugin)
        .filter(
            CompliancePlugin.id == plugin_id,
            CompliancePlugin.tenant_id == tenant_id,
        )
        .first()
    )
    if not plugin:
        raise HTTPException(404, "Plugin not found")
    decision = (body.get("decision") or "").lower()
    if decision not in {"approve", "reject"}:
        raise HTTPException(422, "decision must be 'approve' or 'reject'")

    if decision == "approve":
        # Apply optional patches before enabling. Validate against the same
        # gates used by the JSON importer so a reviewer cannot smuggle in an
        # unsafe command via the editor.
        new_runner = body.get("runner_type", plugin.runner_type)
        if new_runner not in RUNNERS:
            raise HTTPException(422, f"runner_type must be one of {sorted(RUNNERS.keys())}")

        if "severity" in body:
            sev = str(body["severity"]).lower()
            if sev not in _VALID_SEVERITIES:
                raise HTTPException(422, f"severity must be one of {sorted(_VALID_SEVERITIES)}")
            plugin.severity = sev

        if "title" in body and isinstance(body["title"], str) and body["title"].strip():
            plugin.title = body["title"].strip()
        for opt_field in ("description", "rationale", "remediation"):
            if opt_field in body and (body[opt_field] is None or isinstance(body[opt_field], str)):
                setattr(plugin, opt_field, body[opt_field])

        check_def = body.get("check_definition", plugin.check_definition or {})
        if not isinstance(check_def, dict):
            raise HTTPException(422, "check_definition must be an object")

        # Re-validate every time — runner_type may have changed.
        try:
            _validate_readonly_at_seed_time({
                "runner_type": new_runner,
                "plugin_key": plugin.plugin_key,
                "check_definition": check_def,
            })
        except ValueError as ve:
            raise HTTPException(422, str(ve)) from ve

        if new_runner == "linux_ssh":
            from .runners.ssh_runner import _is_command_safe as _ssh_safe  # type: ignore
            cmd = (check_def.get("command") or "").strip()
            if not cmd:
                raise HTTPException(422, "linux_ssh check_definition.command is required")
            ok, reason = _ssh_safe(cmd)
            if not ok:
                raise HTTPException(422, f"command rejected: {reason}")
        elif new_runner == "windows_winrm":
            from .runners.winrm_runner import _is_command_safe as _ps_safe  # type: ignore
            cmd = (check_def.get("command") or "").strip()
            if not cmd:
                raise HTTPException(422, "windows_winrm check_definition.command is required")
            ok, reason = _ps_safe(cmd)
            if not ok:
                raise HTTPException(422, f"command rejected: {reason}")

        plugin.runner_type = new_runner
        plugin.check_definition = check_def
        plugin.review_status = "approved"
        plugin.enabled = True
        # Reviewer has hand-checked it — clear the auto_generated flag so
        # the library tab no longer flags it with a yellow "needs review"
        # badge.
        if hasattr(plugin, "auto_generated_check"):
            plugin.auto_generated_check = False
    else:
        plugin.review_status = "rejected"
        plugin.enabled = False
    db.commit()
    db.refresh(plugin)
    return _plugin_to_dict(plugin, tenant_id=tenant_id, db=db)


@router.post("/review-bulk", status_code=200)
def review_plugins_bulk(
    body: dict,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _admin: bool = Depends(require_tenant_admin),
):
    """Bulk approve or reject many plugins in one call.

    Body shape: ``{"plugin_ids": [..], "decision": "approve" | "reject"}``.
    Differentiator vs Cywift: Cywift requires one-by-one approval; Compliverse
    can flip a filter's worth of pending rules in a single round-trip so
    Account Policy / Service / Audit Policy cohorts go live together.
    """
    tenant_id = get_user_primary_tenant(current_user, db)
    plugin_ids = body.get("plugin_ids") or []
    if not isinstance(plugin_ids, list) or not plugin_ids:
        raise HTTPException(422, "plugin_ids must be a non-empty list")
    decision = (body.get("decision") or "").lower()
    if decision not in {"approve", "reject"}:
        raise HTTPException(422, "decision must be 'approve' or 'reject'")

    plugins = (
        db.query(CompliancePlugin)
        .filter(
            CompliancePlugin.id.in_(plugin_ids),
            CompliancePlugin.tenant_id == tenant_id,
        )
        .all()
    )
    if not plugins:
        raise HTTPException(404, "No matching plugins for this tenant")

    approved = 0
    rejected_count = 0
    errors: list[dict] = []
    for plugin in plugins:
        try:
            if decision == "approve":
                # Re-validate read-only safety before flipping enabled=True.
                _validate_readonly_at_seed_time({
                    "runner_type": plugin.runner_type,
                    "plugin_key": plugin.plugin_key,
                    "check_definition": plugin.check_definition or {},
                })
                plugin.review_status = "approved"
                plugin.enabled = True
                if hasattr(plugin, "auto_generated_check"):
                    plugin.auto_generated_check = False
                approved += 1
            else:
                plugin.review_status = "rejected"
                plugin.enabled = False
                rejected_count += 1
        except ValueError as ve:
            errors.append({"plugin_id": plugin.id, "reason": str(ve)})
    db.commit()
    return {
        "decision": decision,
        "requested": len(plugin_ids),
        "approved": approved,
        "rejected": rejected_count,
        "errors": errors,
    }


@router.post("/seed", status_code=201)
def seed_endpoint(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """Manually re-run the built-in seeder (idempotent)."""
    n = seed_compliance_plugins(db)
    return {"status": "ok", "upserted": n}


# ─── JSON Plugin Import (custom tenant-scoped plugins) ──────────────────────

_REQUIRED_IMPORT_FIELDS = (
    "plugin_key", "benchmark", "rule_id", "title", "severity",
    "runner_type", "check_definition",
)
_VALID_SEVERITIES = {"low", "medium", "high", "critical"}


@router.post("/import-json", status_code=201)
def import_plugins_json(
    body: dict,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _admin: bool = Depends(require_tenant_admin),
):
    """Import one or more custom plugin definitions from a JSON payload.

    Request body: ``{"plugins": [ {plugin_key, benchmark, rule_id, title,
    severity, runner_type, check_definition, ...optional...}, ... ],
    "auto_approve": false }``.

    Imported plugins are tenant-scoped (``tenant_id = caller's tenant``,
    ``is_builtin = False``). They land in ``review_status = 'pending_review'``
    (and ``enabled = False``) by default unless ``auto_approve = true``.

    Validation:
      * required fields present, severity ∈ {low/medium/high/critical}
      * runner_type ∈ available runners (currently aws_readonly / linux_ssh)
      * AWS checks must use a read-only verb (same gate as the built-in
        seeder — :func:`_validate_readonly_at_seed_time`)
      * SSH checks reuse the runtime ``_is_command_safe`` filter

    Idempotent on (tenant_id, plugin_key): re-importing the same key updates
    the existing tenant row.
    """
    tenant_id = get_user_primary_tenant(current_user, db)
    raw_plugins = body.get("plugins")
    if not isinstance(raw_plugins, list) or not raw_plugins:
        raise HTTPException(422, "Body must contain a non-empty 'plugins' list")
    if len(raw_plugins) > 500:
        raise HTTPException(413, "Maximum 500 plugins per import")
    # auto_approve marks the imported plugin as review_status='approved' so
    # it bypasses the human review queue. This is a tenant-scoped flag — the
    # caller can only ever approve plugins inside their own tenant. Even when
    # auto_approved we still leave `enabled=False` so a separate UI toggle is
    # required before the scheduler can run the check; this avoids importing a
    # JSON file that immediately starts hitting AWS / SSH on its own.
    auto_approve = bool(body.get("auto_approve", False))

    # Lazy import to avoid a circular dep at module load.
    from .runners.ssh_runner import _is_command_safe  # type: ignore

    inserted: list[dict] = []
    updated: list[dict] = []
    errors: list[dict] = []

    for idx, raw in enumerate(raw_plugins):
        if not isinstance(raw, dict):
            errors.append({"index": idx, "error": "entry is not an object"})
            continue
        # Required fields
        missing = [f for f in _REQUIRED_IMPORT_FIELDS if not raw.get(f)]
        if missing:
            errors.append({"index": idx, "plugin_key": raw.get("plugin_key"),
                           "error": f"missing required fields: {missing}"})
            continue
        sev = str(raw.get("severity", "")).lower()
        if sev not in _VALID_SEVERITIES:
            errors.append({"index": idx, "plugin_key": raw.get("plugin_key"),
                           "error": f"severity must be one of {sorted(_VALID_SEVERITIES)}"})
            continue
        runner_type = raw.get("runner_type")
        if runner_type not in RUNNERS:
            errors.append({"index": idx, "plugin_key": raw.get("plugin_key"),
                           "error": f"runner_type must be one of {sorted(RUNNERS.keys())}"})
            continue
        check_def = raw.get("check_definition") or {}
        if not isinstance(check_def, dict):
            errors.append({"index": idx, "plugin_key": raw.get("plugin_key"),
                           "error": "check_definition must be an object"})
            continue

        # Read-only AWS gate (mirrors seed-time validator)
        try:
            _validate_readonly_at_seed_time({"runner_type": runner_type,
                                             "plugin_key": raw["plugin_key"],
                                             "check_definition": check_def})
        except ValueError as ve:
            errors.append({"index": idx, "plugin_key": raw["plugin_key"],
                           "error": str(ve)})
            continue

        # Safe-command gate for SSH
        if runner_type == "linux_ssh":
            cmd = (check_def.get("command") or "").strip()
            if not cmd:
                errors.append({"index": idx, "plugin_key": raw["plugin_key"],
                               "error": "linux_ssh check_definition.command is required"})
                continue
            safe, reason = _is_command_safe(cmd)
            if not safe:
                errors.append({"index": idx, "plugin_key": raw["plugin_key"],
                               "error": f"command rejected: {reason}"})
                continue

        # Safe-command gate for Windows WinRM (PowerShell / CMD)
        if runner_type == "windows_winrm":
            from .runners.winrm_runner import _is_command_safe as _ps_safe  # type: ignore
            cmd = (check_def.get("command") or "").strip()
            if not cmd:
                errors.append({"index": idx, "plugin_key": raw["plugin_key"],
                               "error": "windows_winrm check_definition.command is required"})
                continue
            safe, reason = _ps_safe(cmd)
            if not safe:
                errors.append({"index": idx, "plugin_key": raw["plugin_key"],
                               "error": f"command rejected: {reason}"})
                continue

        # Optional control_mappings — list of {framework_control_id?,
        # normalized_control_id?, weight?}. We validate shape here and
        # persist after the plugin row exists.
        # Source-of-truth semantics: when the key is *present* in the JSON
        # (even as []), existing mappings for this (tenant, plugin) are
        # replaced with the imported list. When the key is *omitted*, we
        # leave existing mappings alone so callers who only want to update
        # plugin metadata don't accidentally wipe their control coverage.
        mappings_provided = "control_mappings" in raw
        raw_mappings = raw.get("control_mappings") if mappings_provided else []
        if raw_mappings is None:
            raw_mappings = []
        if not isinstance(raw_mappings, list):
            errors.append({"index": idx, "plugin_key": raw["plugin_key"],
                           "error": "control_mappings must be a list"})
            continue
        mapping_specs: list[dict] = []
        mapping_shape_ok = True

        def _coerce_int(val: Any, field: str, mi: int) -> Optional[int]:
            if val is None:
                return None
            if isinstance(val, bool):  # bool is an int subclass — reject explicitly
                raise ValueError(f"control_mappings[{mi}].{field} must be an integer, got bool")
            if isinstance(val, int):
                return val
            if isinstance(val, str) and val.strip().lstrip("-").isdigit():
                return int(val.strip())
            raise ValueError(f"control_mappings[{mi}].{field} must be an integer")

        def _coerce_weight(val: Any, mi: int) -> float:
            if val is None:
                return 1.0
            if isinstance(val, bool):
                raise ValueError(f"control_mappings[{mi}].weight must be a number, got bool")
            if isinstance(val, (int, float)):
                return float(val)
            if isinstance(val, str):
                try:
                    return float(val)
                except ValueError as ve:
                    raise ValueError(f"control_mappings[{mi}].weight must be a number") from ve
            raise ValueError(f"control_mappings[{mi}].weight must be a number")

        for mi, m in enumerate(raw_mappings):
            if not isinstance(m, dict):
                errors.append({"index": idx, "plugin_key": raw["plugin_key"],
                               "error": f"control_mappings[{mi}] is not an object"})
                mapping_shape_ok = False
                break
            try:
                fcid = _coerce_int(m.get("framework_control_id"), "framework_control_id", mi)
                ncid = _coerce_int(m.get("normalized_control_id"), "normalized_control_id", mi)
                weight = _coerce_weight(m.get("weight"), mi)
            except ValueError as ve:
                errors.append({"index": idx, "plugin_key": raw["plugin_key"], "error": str(ve)})
                mapping_shape_ok = False
                break
            if fcid is None and ncid is None:
                errors.append({"index": idx, "plugin_key": raw["plugin_key"],
                               "error": f"control_mappings[{mi}] requires framework_control_id or normalized_control_id"})
                mapping_shape_ok = False
                break
            mapping_specs.append({
                "framework_control_id": fcid,
                "normalized_control_id": ncid,
                "weight": weight,
            })
        if not mapping_shape_ok:
            continue

        spec = {
            "plugin_key": raw["plugin_key"],
            "benchmark": raw["benchmark"],
            "rule_id": str(raw["rule_id"]),
            "title": raw["title"],
            "description": raw.get("description"),
            "rationale": raw.get("rationale"),
            "remediation": raw.get("remediation"),
            "severity": sev,
            "runner_type": runner_type,
            "check_definition": check_def,
            "source_url": raw.get("source_url"),
        }

        existing = (
            db.query(CompliancePlugin)
            .filter(CompliancePlugin.tenant_id == tenant_id,
                    CompliancePlugin.plugin_key == spec["plugin_key"])
            .first()
        )
        if existing:
            for k, v in spec.items():
                setattr(existing, k, v)
            existing.is_builtin = False
            existing.review_status = "approved" if auto_approve else "pending_review"
            # Always require an explicit "enable" toggle in the UI before the
            # scheduler picks the plugin up — even when auto_approve=True.
            existing.enabled = False
            db.add(existing)
            db.flush()
            plugin_row = existing
            updated.append({"plugin_key": spec["plugin_key"], "id": existing.id})
        else:
            plugin_row = CompliancePlugin(
                tenant_id=tenant_id,
                is_builtin=False,
                enabled=False,
                review_status="approved" if auto_approve else "pending_review",
                auto_generated_check=False,
                **spec,
            )
            db.add(plugin_row)
            db.flush()
            inserted.append({"plugin_key": spec["plugin_key"], "id": plugin_row.id})

        if mappings_provided:
            # JSON is the source of truth: clear any previous mappings for
            # this (tenant, plugin) and rewrite them from the payload — even
            # when the imported list is empty.
            db.query(PluginControlMapping).filter(
                PluginControlMapping.tenant_id == tenant_id,
                PluginControlMapping.plugin_id == plugin_row.id,
            ).delete(synchronize_session=False)
            for ms in mapping_specs:
                db.add(PluginControlMapping(
                    tenant_id=tenant_id,
                    plugin_id=plugin_row.id,
                    framework_control_id=ms["framework_control_id"],
                    normalized_control_id=ms["normalized_control_id"],
                    weight=ms["weight"],
                ))

    db.commit()
    return {
        "inserted": inserted,
        "updated": updated,
        "errors": errors,
        "summary": {
            "received": len(raw_plugins),
            "inserted": len(inserted),
            "updated": len(updated),
            "errors": len(errors),
            "auto_approved": auto_approve,
        },
    }


@router.get("/runs")
def list_runs(
    plugin_id: Optional[int] = Query(None),
    asset_id: Optional[int] = Query(None),
    status: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=5000),
    include_leaked: bool = Query(False, description="If true, include runs flagged as is_leaked=true (from before the Stage 2 fix). Default false so dashboards aren't poisoned by old wrong-benchmark rows."),
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    tenant_id = get_user_primary_tenant(current_user, db)
    q = db.query(CompliancePluginRun).filter(CompliancePluginRun.tenant_id == tenant_id)
    if not include_leaked:
        q = q.filter(CompliancePluginRun.is_leaked.is_(False))
    if plugin_id:
        q = q.filter(CompliancePluginRun.plugin_id == plugin_id)
    if asset_id:
        q = q.filter(CompliancePluginRun.asset_id == asset_id)
    if status:
        q = q.filter(CompliancePluginRun.status == status)
    runs = q.order_by(CompliancePluginRun.id.desc()).limit(limit).all()
    plugins_by_id = {p.id: p for p in db.query(CompliancePlugin).filter(
        CompliancePlugin.id.in_([r.plugin_id for r in runs] or [0])
    ).all()}
    asset_ids = [r.asset_id for r in runs if r.asset_id]
    assets_by_id = {a.id: a for a in db.query(ITAsset).filter(ITAsset.id.in_(asset_ids or [0])).all()}
    conn_ids = [r.connection_id for r in runs if r.connection_id]
    conns_by_id = {c.id: c for c in db.query(IntegrationConnection).filter(
        IntegrationConnection.id.in_(conn_ids or [0])
    ).all()}
    # Resolve the "who triggered this" user — single query for all runs.
    user_ids = [getattr(r, "triggered_by_user_id", None) for r in runs]
    user_ids = [uid for uid in user_ids if uid]
    users_by_id = {
        u.id: u for u in db.query(GRCUser).filter(GRCUser.id.in_(user_ids or [0])).all()
    }
    return {
        "runs": [
            _run_to_dict(
                r,
                plugins_by_id.get(r.plugin_id),
                assets_by_id.get(r.asset_id),
                conns_by_id.get(r.connection_id),
                triggered_by_user=users_by_id.get(getattr(r, "triggered_by_user_id", None)),
            )
            for r in runs
        ],
        "total": len(runs),
    }


@router.get("/runs/{run_id}")
def get_run(
    run_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    tenant_id = get_user_primary_tenant(current_user, db)
    run = db.query(CompliancePluginRun).filter(
        CompliancePluginRun.id == run_id,
        CompliancePluginRun.tenant_id == tenant_id,
    ).first()
    if not run:
        raise HTTPException(404, "Run not found")
    plugin = db.query(CompliancePlugin).filter(CompliancePlugin.id == run.plugin_id).first()
    asset = db.query(ITAsset).filter(ITAsset.id == run.asset_id).first() if run.asset_id else None
    conn = db.query(IntegrationConnection).filter(IntegrationConnection.id == run.connection_id).first() if run.connection_id else None
    trig_user = _user_by_id(db, getattr(run, "triggered_by_user_id", None))
    return _run_to_dict(run, plugin, asset, conn, triggered_by_user=trig_user)


# ─── Strict benchmark→OS mapping admin endpoints ──────────────────────────
# IMPORTANT: must be defined BEFORE the `/{plugin_id}` catch-all below,
# otherwise FastAPI tries to parse "benchmark-mappings" as an int → 422.
from grc.models import BenchmarkOsMapping


@router.get("/benchmark-mappings")
def list_benchmark_mappings(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    tenant_id = get_user_primary_tenant(current_user, db)
    rows = (
        db.query(BenchmarkOsMapping)
        .filter(
            (BenchmarkOsMapping.tenant_id == tenant_id) | (BenchmarkOsMapping.tenant_id.is_(None)),
        )
        .order_by(BenchmarkOsMapping.priority.asc(), BenchmarkOsMapping.os_pattern.asc())
        .all()
    )
    return {"mappings": [
        {
            "id": m.id,
            "os_pattern": m.os_pattern,
            "benchmark_name": m.benchmark_name,
            "scope": "tenant" if m.tenant_id is not None else "global",
            "is_active": m.is_active,
            "priority": m.priority,
            "notes": m.notes,
            "created_at": m.created_at.isoformat() if m.created_at else None,
        }
        for m in rows
    ]}


class _MappingCreate(BaseModel):
    os_pattern: str
    benchmark_name: str
    priority: int = 100
    notes: Optional[str] = None
    is_active: bool = True


@router.post("/benchmark-mappings", status_code=201)
def create_benchmark_mapping(
    body: _MappingCreate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    tenant_id = get_user_primary_tenant(current_user, db)
    m = BenchmarkOsMapping(
        tenant_id=tenant_id,
        os_pattern=body.os_pattern.strip().lower(),
        benchmark_name=body.benchmark_name.strip(),
        priority=body.priority,
        notes=body.notes,
        is_active=body.is_active,
    )
    db.add(m)
    db.commit()
    return {"id": m.id}


@router.delete("/benchmark-mappings/{mapping_id}")
def delete_benchmark_mapping(
    mapping_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    tenant_id = get_user_primary_tenant(current_user, db)
    m = db.query(BenchmarkOsMapping).filter(
        BenchmarkOsMapping.id == mapping_id,
        BenchmarkOsMapping.tenant_id == tenant_id,
    ).first()
    if not m:
        raise HTTPException(404, "Mapping not found (or it's a global mapping — only Compliverse can delete those)")
    db.delete(m)
    db.commit()
    return {"deleted": mapping_id}


class _NormaliseOsRequest(BaseModel):
    os_version: str


@router.post("/normalise-os")
def normalise_os(
    body: _NormaliseOsRequest,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    from .services.ai_os_normaliser import normalise_os_string
    return normalise_os_string(body.os_version)


@router.get("/benchmark-mappings/suggest")
def suggest_benchmark_mappings(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    from .services.ai_mapping_suggester import suggest_for_all_unmapped
    tenant_id = get_user_primary_tenant(current_user, db)
    suggestions = suggest_for_all_unmapped(db, tenant_id)
    return {"suggestions": suggestions, "count": len(suggestions)}


@router.get("/benchmark-mappings/suggest-for-asset/{asset_id}")
def suggest_mapping_for_asset(
    asset_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    from .services.ai_mapping_suggester import suggest_for_unmapped_os
    tenant_id = get_user_primary_tenant(current_user, db)
    asset = db.query(ITAsset).filter(
        ITAsset.id == asset_id,
        ITAsset.tenant_id == tenant_id,
    ).first()
    if not asset:
        raise HTTPException(404, "Asset not found")
    return suggest_for_unmapped_os(db, tenant_id, asset.os_normalized or "")


@router.get("/{plugin_id}")
def get_plugin(
    plugin_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    tenant_id = get_user_primary_tenant(current_user, db)
    plugin = db.query(CompliancePlugin).filter(
        CompliancePlugin.id == plugin_id,
        (CompliancePlugin.tenant_id.is_(None)) | (CompliancePlugin.tenant_id == tenant_id),
    ).first()
    if not plugin:
        raise HTTPException(404, "Plugin not found")
    # Tenant-scope mapping reads — built-in plugins (tenant_id=NULL) are
    # shared across tenants by ID, but PluginControlMapping rows are
    # per-tenant. Filtering only by plugin_id would leak other tenants'
    # mappings on shared built-in plugins.
    mappings = db.query(PluginControlMapping).filter(
        PluginControlMapping.plugin_id == plugin.id,
        PluginControlMapping.tenant_id == tenant_id,
    ).all()
    scope = (
        db.query(PluginAssetScope)
        .filter(PluginAssetScope.plugin_id == plugin.id, PluginAssetScope.tenant_id == tenant_id)
        .first()
    )
    return {
        **_plugin_to_dict(plugin, tenant_id=tenant_id, db=db),
        "control_mappings": [
            {
                "id": m.id,
                "framework_control_id": m.framework_control_id,
                "normalized_control_id": m.normalized_control_id,
                "weight": m.weight,
            }
            for m in mappings
        ],
        "asset_scope": _scope_to_dict(scope),
    }


_ALLOWED_CADENCES = {"hourly", "daily", "weekly", "monthly"}


@router.patch("/{plugin_id}/schedule")
def update_schedule(
    plugin_id: int,
    body: dict,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """Set or clear the schedule cadence for a plugin (per tenant).

    Tenant-owned plugins update `plugin.schedule_cron` directly.
    Built-in plugins (tenant_id=NULL) cannot be mutated globally — instead
    the cadence is upserted into PluginScheduleOverride keyed by
    (tenant_id, plugin_id). The scheduler resolves the effective cadence
    from the override when present, falling back to the catalog default.
    """
    tenant_id = get_user_primary_tenant(current_user, db)
    plugin = db.query(CompliancePlugin).filter(CompliancePlugin.id == plugin_id).first()
    if not plugin:
        raise HTTPException(404, "Plugin not found")
    if plugin.tenant_id is not None and plugin.tenant_id != tenant_id:
        raise HTTPException(404, "Plugin not found")
    cron = body.get("schedule_cron")
    if cron is not None and not isinstance(cron, str):
        raise HTTPException(422, "schedule_cron must be a string or null")
    if isinstance(cron, str) and cron and cron not in _ALLOWED_CADENCES:
        raise HTTPException(422, f"schedule_cron must be one of {sorted(_ALLOWED_CADENCES)} or null")
    cron_val = cron or None

    if plugin.tenant_id is None:
        ov = (
            db.query(PluginScheduleOverride)
            .filter(
                PluginScheduleOverride.plugin_id == plugin.id,
                PluginScheduleOverride.tenant_id == tenant_id,
            )
            .first()
        )
        if ov is None:
            ov = PluginScheduleOverride(plugin_id=plugin.id, tenant_id=tenant_id, schedule_cron=cron_val)
            db.add(ov)
        else:
            ov.schedule_cron = cron_val
    else:
        plugin.schedule_cron = cron_val
    db.commit()
    db.refresh(plugin)
    return _plugin_to_dict(plugin, tenant_id=tenant_id, db=db)


@router.get("/{plugin_id}/asset-scope")
def get_asset_scope(
    plugin_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    tenant_id = get_user_primary_tenant(current_user, db)
    plugin = db.query(CompliancePlugin).filter(
        CompliancePlugin.id == plugin_id,
        (CompliancePlugin.tenant_id.is_(None)) | (CompliancePlugin.tenant_id == tenant_id),
    ).first()
    if not plugin:
        raise HTTPException(404, "Plugin not found")
    scope = (
        db.query(PluginAssetScope)
        .filter(PluginAssetScope.plugin_id == plugin.id, PluginAssetScope.tenant_id == tenant_id)
        .first()
    )
    return _scope_to_dict(scope)


@router.put("/{plugin_id}/asset-scope")
def update_asset_scope(
    plugin_id: int,
    body: dict,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """Persist per-tenant include/exclude asset list for a plugin."""
    tenant_id = get_user_primary_tenant(current_user, db)
    plugin = db.query(CompliancePlugin).filter(
        CompliancePlugin.id == plugin_id,
        (CompliancePlugin.tenant_id.is_(None)) | (CompliancePlugin.tenant_id == tenant_id),
    ).first()
    if not plugin:
        raise HTTPException(404, "Plugin not found")
    mode = (body.get("mode") or "all").lower()
    if mode not in {"all", "include", "exclude"}:
        raise HTTPException(422, "mode must be one of: all, include, exclude")
    raw_ids = body.get("asset_ids") or []
    if not isinstance(raw_ids, list) or not all(isinstance(x, int) for x in raw_ids):
        raise HTTPException(422, "asset_ids must be a list of integers")
    # Tenant-scope the asset_ids — silently drop ids that don't belong
    # to the caller's tenant so we never leak/persist cross-tenant refs.
    if raw_ids:
        valid_ids = {
            aid for (aid,) in db.query(ITAsset.id)
            .filter(ITAsset.tenant_id == tenant_id, ITAsset.id.in_(raw_ids))
            .all()
        }
        asset_ids = [aid for aid in raw_ids if aid in valid_ids]
    else:
        asset_ids = []

    scope = (
        db.query(PluginAssetScope)
        .filter(PluginAssetScope.plugin_id == plugin.id, PluginAssetScope.tenant_id == tenant_id)
        .first()
    )
    if scope is None:
        scope = PluginAssetScope(plugin_id=plugin.id, tenant_id=tenant_id, mode=mode, asset_ids=asset_ids)
        db.add(scope)
    else:
        scope.mode = mode
        scope.asset_ids = asset_ids
    db.commit()
    db.refresh(scope)
    return _scope_to_dict(scope)


@router.post("/{plugin_id}/runs", status_code=201)
def execute(
    plugin_id: int,
    body: PluginRunCreate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _perm: bool = Depends(_require_scan_perm),
):
    tenant_id = get_user_primary_tenant(current_user, db)
    plugin = db.query(CompliancePlugin).filter(
        CompliancePlugin.id == plugin_id,
        (CompliancePlugin.tenant_id.is_(None)) | (CompliancePlugin.tenant_id == tenant_id),
    ).first()
    if not plugin:
        raise HTTPException(404, "Plugin not found")
    if not plugin.enabled:
        raise HTTPException(400, "Plugin is disabled")

    asset = None
    if body.asset_id:
        asset = db.query(ITAsset).filter(
            ITAsset.id == body.asset_id, ITAsset.tenant_id == tenant_id
        ).first()
        if not asset:
            raise HTTPException(404, "Asset not found")

    explicit_connection = None
    if body.connection_id:
        explicit_connection = db.query(IntegrationConnection).filter(
            IntegrationConnection.id == body.connection_id,
            IntegrationConnection.tenant_id == tenant_id,
        ).first()
        if not explicit_connection:
            raise HTTPException(404, "Connection not found")

    # Same auto-resolution as /scan-all: if the caller didn't pin a
    # specific connection, fall back to the tenant's most-recent active
    # connection whose runner family matches this plugin.
    connection = _resolve_connection_for_plugin(
        db, tenant_id, plugin, explicit_connection, conn_cache={},
    )

    run = execute_plugin(
        db=db,
        tenant_id=tenant_id,
        user_id=current_user.id,
        plugin=plugin,
        asset=asset,
        connection=connection,
        triggered_by="manual",
        manual_result=body.manual_result,
        manual_note=body.manual_note,
    )
    return _run_to_dict(run, plugin, asset, connection, triggered_by_user=current_user)


def _resolve_connection_for_plugin(
    db: Session, tenant_id: int, plugin: CompliancePlugin,
    explicit_connection: Optional[IntegrationConnection],
    conn_cache: dict[str, Optional[IntegrationConnection]],
) -> Optional[IntegrationConnection]:
    """Pick the right tenant connection for a plugin run.

    Resolution order:
      1. If the caller passed an explicit connection AND its runner family
         matches the plugin, use it.
      2. Otherwise, look up the tenant's first ACTIVE connection whose
         integration_type matches the plugin's runner_type. Cache the
         lookup so a 500-plugin Scan All only hits the DB once per type.

    Returns None if no compatible connection exists (the runner will then
    raise "credentials missing" — which is the correct error in that case;
    the empty-state banner on the UI already prompts the user to onboard
    a host before scanning).
    """
    if not plugin.runner_type:
        return None
    # A runner may be satisfied by more than one connection family. OpenSCAP
    # evaluates Linux hosts over the SAME SSH transport (or locally on the
    # backend host), so an `oscap` plugin is served by a linux_ssh / netdev_ssh
    # connection — not by a connection literally typed "oscap" (there is none).
    _COMPAT = {"oscap": ("oscap", "linux_ssh", "netdev_ssh")}
    acceptable = _COMPAT.get(plugin.runner_type, (plugin.runner_type,))
    if (explicit_connection is not None and
            explicit_connection.integration_type in acceptable):
        return explicit_connection
    cached = conn_cache.get(plugin.runner_type, "MISSING")
    if cached != "MISSING":
        return cached
    conn = (
        db.query(IntegrationConnection)
        .filter(
            IntegrationConnection.tenant_id == tenant_id,
            IntegrationConnection.integration_type.in_(acceptable),
            IntegrationConnection.is_active.is_(True),
        )
        .order_by(IntegrationConnection.updated_at.desc().nullslast(),
                  IntegrationConnection.id.desc())
        .first()
    )
    conn_cache[plugin.runner_type] = conn
    return conn


# In-process scan lock — prevents overlapping Scan All / Scan now hits
# from the same tenant. Frontend disables the button, but a curl user
# or a stale tab can still POST while another scan is in flight.
# Key = (tenant_id, asset_id or "all"). Value = start_iso timestamp.
import threading
_SCAN_LOCK = threading.Lock()
_ACTIVE_SCANS: dict[tuple[int, Optional[int]], str] = {}


def _scan_lock_acquire(tenant_id: int, asset_id: Optional[int]) -> bool:
    """Returns True if lock acquired, False if already running."""
    from datetime import datetime
    key = (tenant_id, asset_id)
    with _SCAN_LOCK:
        if key in _ACTIVE_SCANS:
            return False
        _ACTIVE_SCANS[key] = datetime.utcnow().isoformat()
        return True


def _scan_lock_release(tenant_id: int, asset_id: Optional[int]) -> None:
    key = (tenant_id, asset_id)
    with _SCAN_LOCK:
        _ACTIVE_SCANS.pop(key, None)


@router.post("/scan-all", status_code=202)
def scan_all(
    benchmark: Optional[str] = Query(None),
    runner_type: Optional[str] = Query(None),
    asset_id: Optional[int] = Query(None),
    connection_id: Optional[int] = Query(None),
    include_peer_asset_ids: Optional[List[int]] = Query(None),
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _perm: bool = Depends(_require_scan_perm),
):
    """Run every enabled plugin (optionally filtered) once.

    When the caller doesn't pin a specific connection, we auto-resolve the
    tenant's matching connection per plugin runner_type. This is what makes
    the "Scan All" button work for the common case of "one Windows host
    connected, scan everything" — without it, every run would fail with
    'WinRM credentials missing'.

    `include_peer_asset_ids` implements the room-scan model: when scanning a
    host (asset_id is set), the caller can include co-located peer assets
    (same ip_address) whose benchmark rules are then UNIONED into the scan.
    The scan still executes through the HOST's connection but writes each
    peer's plugin runs against THAT peer's asset_id so the peer's compliance
    history reflects the scan. Peers must share the host's ip_address.

    A process-level lock prevents two scans against the same target from
    interleaving. A 409 with the start time is returned if a scan is
    already running.
    """
    tenant_id = get_user_primary_tenant(current_user, db)

    # Acquire the scan lock BEFORE doing any work. The frontend disables
    # the button, but a stale tab / curl call can still race in.
    if not _scan_lock_acquire(tenant_id, asset_id):
        started = _ACTIVE_SCANS.get((tenant_id, asset_id), "earlier")
        raise HTTPException(
            409,
            f"A scan is already running for this {'asset' if asset_id else 'tenant'} "
            f"(started {started}). Wait for it to finish or refresh the page.",
        )

    # ─── Pre-flight checks (synchronous, fast) ─────────────────────────
    # Validate the asset exists + has a usable connection BEFORE we
    # spawn the background scan. Otherwise the operator would see "Scan
    # queued" and then have no runs ever appear — they need a fast 4xx
    # error to know to set up the connection first.
    try:
        if asset_id is not None:
            _preflight_asset = db.query(ITAsset).filter(
                ITAsset.id == asset_id, ITAsset.tenant_id == tenant_id,
            ).first()
            if _preflight_asset is None:
                raise HTTPException(404, "Asset not found in this tenant")
            if not _preflight_asset.os_normalized:
                raise HTTPException(
                    400,
                    f"Asset '{_preflight_asset.name}' has no OS classified. "
                    f"Click 'Re-detect OS' or set the OS via Edit before scanning.",
                )
            # Preflight: confirm SOME usable connection exists — either the
            # opened asset's own (matched by host_name → console_url), or in
            # room-scan mode, any active connection pinned to a co-located
            # peer at the same IP. The detailed lookup happens again in
            # _do_scan_all; this preflight just gives the operator a fast
            # 400 before we spawn the background thread.
            _has_own_connection = False
            if _preflight_asset.host_name:
                _host_lc = _preflight_asset.host_name.lower().strip()
                _conn = (
                    db.query(IntegrationConnection)
                    .filter(IntegrationConnection.tenant_id == tenant_id,
                            IntegrationConnection.is_active.is_(True),
                            func.lower(IntegrationConnection.console_url) == _host_lc)
                    .first()
                )
                _has_own_connection = _conn is not None
            _has_ip_group_connection = False
            if not _has_own_connection and _preflight_asset.ip_address:
                _peer_with_conn = db.execute(text("""
                    SELECT 1 FROM grc_it_assets a
                    JOIN grc_integration_connections c
                      ON lower(c.console_url) = lower(a.host_name)
                     AND c.tenant_id = a.tenant_id
                     AND c.is_active = true
                    WHERE a.tenant_id = :tid
                      AND a.ip_address = :ip
                      AND a.id <> :aid
                      AND a.host_name IS NOT NULL
                    LIMIT 1
                """), {
                    "tid": tenant_id,
                    "ip": _preflight_asset.ip_address,
                    "aid": _preflight_asset.id,
                }).first()
                _has_ip_group_connection = _peer_with_conn is not None
            if (
                not _has_own_connection
                and not _has_ip_group_connection
                and connection_id is None
            ):
                raise HTTPException(
                    400,
                    f"Asset '{_preflight_asset.name}' has no integration "
                    f"connection"
                    + (
                        f", and no co-located asset at IP {_preflight_asset.ip_address} has one either"
                        if _preflight_asset.ip_address else ""
                    )
                    + ". Add credentials via Connect Wizard first.",
                )
        # ── Validate include_peer_asset_ids: must be same tenant + same IP. ──
        # The room-scan model only makes sense for assets co-located on the same
        # host (same ip_address). Without this check, the caller could smuggle
        # arbitrary tenant assets into a scan and have their benchmark rules
        # executed against the wrong connection.
        validated_peer_ids: list[int] = []
        if include_peer_asset_ids:
            if _preflight_asset is None:
                raise HTTPException(
                    400,
                    "include_peer_asset_ids requires asset_id (room-scan is anchored on a host).",
                )
            if not _preflight_asset.ip_address:
                raise HTTPException(
                    400,
                    f"Asset '{_preflight_asset.name}' has no IP — peers can't be resolved.",
                )
            peers = db.query(ITAsset).filter(
                ITAsset.id.in_(include_peer_asset_ids),
                ITAsset.tenant_id == tenant_id,
            ).all()
            peer_by_id = {p.id: p for p in peers}
            for pid in include_peer_asset_ids:
                peer = peer_by_id.get(pid)
                if peer is None:
                    raise HTTPException(404, f"Peer asset {pid} not found in this tenant.")
                if peer.id == _preflight_asset.id:
                    continue  # silently drop self-reference
                if peer.ip_address != _preflight_asset.ip_address:
                    raise HTTPException(
                        400,
                        f"Peer asset {pid} ('{peer.name}') is not co-located: "
                        f"its IP {peer.ip_address!r} != host IP {_preflight_asset.ip_address!r}.",
                    )
                validated_peer_ids.append(peer.id)
    except HTTPException:
        _scan_lock_release(tenant_id, asset_id)
        raise

    # ─── Spawn the scan in a background thread ─────────────────────────
    # _do_scan_all blocks for minutes when running 500+ rules against a
    # real WinRM endpoint. Holding the HTTP connection open that long
    # times out the browser AND the Next.js dev proxy, producing a
    # 500/XML-parse error from a truncated response — even though the
    # backend finishes successfully and writes every run to the DB.
    # Background thread + immediate 202 keeps the lock held until the
    # actual scan finishes, while the frontend's existing progress
    # polling shows live "X of N rules done" via /runs?asset_id=N.
    import threading
    tenant_engine = db.get_bind()
    actor_user_id = current_user.id  # capture before request session closes

    def _scan_in_background():
        from sqlalchemy.orm import sessionmaker
        from ...models import GRCUser as _GRCUser
        Sess = sessionmaker(bind=tenant_engine, expire_on_commit=False)
        worker_db = Sess()
        try:
            actor = worker_db.query(_GRCUser).filter(_GRCUser.id == actor_user_id).first()
            _do_scan_all(
                worker_db, tenant_id, asset_id, actor,
                benchmark=benchmark, runner_type=runner_type,
                connection_id=connection_id,
                include_peer_asset_ids=validated_peer_ids,
            )
        except Exception:
            logger.exception("scan-all background worker failed")
        finally:
            worker_db.close()
            _scan_lock_release(tenant_id, asset_id)

    threading.Thread(
        target=_scan_in_background, daemon=True,
        name=f"scan-all-tenant-{tenant_id}-asset-{asset_id}",
    ).start()

    # Compute the projected total so the frontend's progress bar has a
    # target (otherwise it just spins indefinitely). For room-scans we sum
    # the applicable plugin count of the host PLUS each included peer.
    projected_total = 0
    try:
        if asset_id is not None and _preflight_asset and _preflight_asset.os_normalized:
            from .services.strict_matcher import applicable_plugins_for_asset
            plugins, _bench = applicable_plugins_for_asset(
                db, tenant_id, _preflight_asset.os_normalized,
            )
            projected_total = len(plugins)
            for pid in validated_peer_ids:
                peer = db.query(ITAsset).get(pid)
                if peer and peer.os_normalized:
                    peer_plugins, _ = applicable_plugins_for_asset(
                        db, tenant_id, peer.os_normalized,
                    )
                    projected_total += len(peer_plugins)
    except Exception:  # noqa: BLE001
        logger.exception("projected_total computation failed (non-fatal)")

    return {
        "queued": True,
        "asset_id": asset_id,
        "included_peer_asset_ids": validated_peer_ids,
        "total": projected_total,
        "message": (
            f"Scan queued for {projected_total} rule(s)"
            + (f" across host + {len(validated_peer_ids)} co-located peer(s)"
               if validated_peer_ids else "")
            + ". Watch progress in the Scan sessions table below — "
            f"each completed rule shows up as a new run."
        ),
    }


def _do_scan_all(
    db, tenant_id, asset_id, current_user,
    *, benchmark, runner_type, connection_id,
    include_peer_asset_ids: Optional[List[int]] = None,
):
    """Body of scan_all — extracted so the lock-release lives in a single
    try/finally in the caller, not 200 lines below the acquire.

    Room-scan model: when `include_peer_asset_ids` is provided, the scan
    executes plugins from the host's benchmark PLUS each peer's benchmark,
    all through the host's connection. Each plugin run is attributed to the
    asset whose benchmark it came from (so peer pages show "scanned" too).
    """
    include_peer_asset_ids = include_peer_asset_ids or []
    q = db.query(CompliancePlugin).filter(
        (CompliancePlugin.tenant_id.is_(None)) | (CompliancePlugin.tenant_id == tenant_id),
        CompliancePlugin.enabled.is_(True),
        # Only approved rules are scan-eligible. Pending/rejected stay
        # in the review queue and can't be executed.
        CompliancePlugin.review_status.in_(["approved", "auto_approved"]),
        # Unimplemented stubs are not scan-eligible either. This worker builds
        # its own query rather than calling applicable_plugins_for_asset(), so
        # the exclusion added there did NOT reach the scan path — a re-scan
        # still executed the benchmark's remaining TODO rule and recorded it as
        # a security failure. Any rule whose check_definition still contains a
        # TODO placeholder compares host output against the literal string
        # "TODO_expected_value" and can only ever fail.
        ~cast(CompliancePlugin.check_definition, String).ilike("%TODO%"),
        # Also exclude auto-pass placeholders. The PDF-ingest parser writes
        # expect={"kind":"any"} ("reviewer must tighten") when it cannot derive
        # a real check — the rule then passes unconditionally. Executing it
        # manufactures compliance: PostgreSQL 18 has 66 of 70 rules like this,
        # and ALL network/cloud benchmarks are 100%% of them. An unauthored
        # check is not a passing check.
        ~cast(CompliancePlugin.check_definition, String).ilike('%%"kind": "any"%%'),
        ~cast(CompliancePlugin.check_definition, String).ilike('%%"kind":"any"%%'),
    )
    if benchmark:
        q = q.filter(CompliancePlugin.benchmark == benchmark)
    if runner_type:
        q = q.filter(CompliancePlugin.runner_type == runner_type)
    plugins = q.all()

    asset = None
    if asset_id:
        asset = db.query(ITAsset).filter(
            ITAsset.id == asset_id, ITAsset.tenant_id == tenant_id,
        ).first()
        if not asset:
            raise HTTPException(404, "Asset not found in this tenant")

    explicit_connection = None
    if connection_id:
        explicit_connection = db.query(IntegrationConnection).filter(
            IntegrationConnection.id == connection_id,
            IntegrationConnection.tenant_id == tenant_id,
        ).first()

    # Per-asset scan: bind to the asset's OWN connection (host_name →
    # console_url match). The old behavior — fall back to any tenant
    # connection of the matching runner_type — was misleading: clicking
    # "Scan now" on DC-01 would silently run against Hassan's Dev Box
    # because that was the only Windows connection, then label the
    # results as DC-01's. Now we require a real connection for the
    # asset; otherwise 400 with a clear error.
    asset_pinned_connection: Optional[IntegrationConnection] = None
    if asset is not None and asset.host_name:
        host_lc = asset.host_name.lower().strip()
        asset_pinned_connection = (
            db.query(IntegrationConnection)
            .filter(IntegrationConnection.tenant_id == tenant_id,
                    IntegrationConnection.is_active.is_(True))
            .all()
        )
        asset_pinned_connection = next(
            (c for c in asset_pinned_connection
             if (c.console_url or "").lower().strip() == host_lc),
            None,
        )
    # Room-scan IP-group fallback: when the opened asset has no integration
    # of its own (typical for application peers like Oracle DB / SQL Server
    # which aren't directly connectable), look for an active connection
    # pinned to ANY co-located asset at the same IP. This is what makes the
    # "scan the room from a chair's perspective" UX work — Oracle's page
    # gets a Scan now button because the host on its IP supplies the
    # WinRM/SSH/etc. connection.
    if (
        asset is not None
        and asset_pinned_connection is None
        and explicit_connection is None
        and asset.ip_address
    ):
        peers_in_group = (
            db.query(ITAsset)
            .filter(
                ITAsset.tenant_id == tenant_id,
                ITAsset.ip_address == asset.ip_address,
                ITAsset.id != asset.id,
                ITAsset.host_name.isnot(None),
            )
            .all()
        )
        active_conns = (
            db.query(IntegrationConnection)
            .filter(IntegrationConnection.tenant_id == tenant_id,
                    IntegrationConnection.is_active.is_(True))
            .all()
        )
        for peer in peers_in_group:
            host_lc = (peer.host_name or "").lower().strip()
            if not host_lc:
                continue
            match = next(
                (c for c in active_conns
                 if (c.console_url or "").lower().strip() == host_lc),
                None,
            )
            if match is not None:
                asset_pinned_connection = match
                logger.info(
                    "scan_all: connection fallback via IP group — opened asset id=%s "
                    "(%s) uses connection from peer id=%s (%s)",
                    asset.id, asset.name, peer.id, peer.name,
                )
                break
    if asset is not None and explicit_connection is None and asset_pinned_connection is None:
        raise HTTPException(
            400,
            f"Asset '{asset.name}' has no connection. Add credentials via "
            f"Administration → Integrations before scanning this asset"
            + (
                f" (no co-located asset at IP {asset.ip_address} has one either)."
                if asset.ip_address else "."
            ),
        )

    # ─── Block A: credential scope enforcement ──────────────────────────
    # If the auto-resolved (or explicitly chosen) connection has a scope
    # that does NOT include this asset, refuse the scan. This is the
    # mechanism that lets one stored credential cover the whole tenant
    # while still letting the operator say "this Dev cred ONLY scopes
    # to these 3 dev hosts, never touch the production fleet".
    used_connection = explicit_connection or asset_pinned_connection
    if asset is not None and used_connection is not None:
        from .services.scope import resolve_assets
        all_tenant_assets = db.query(ITAsset).filter(ITAsset.tenant_id == tenant_id).all()
        in_scope = {a.id for a in resolve_assets(used_connection, all_tenant_assets)}
        if asset.id not in in_scope:
            raise HTTPException(
                403,
                f"Asset '{asset.name}' is not in the scope of credential "
                f"'{used_connection.connection_name}' (scope_mode="
                f"{used_connection.scope_mode}). Adjust the credential's "
                f"scope in Connections, or use a different credential.",
            )

    # Pre-compute (host → asset) so a tenant-wide Scan All can still tag
    # each run with the matching asset (lookup by connection.console_url).
    # Without this, top-bar Scan All produces runs with asset_id=null and
    # the UI can't show "currently scanning DESKTOP-XYZ".
    asset_by_host: dict[str, ITAsset] = {}
    if asset is None:
        for a in db.query(ITAsset).filter(ITAsset.tenant_id == tenant_id).all():
            if a.host_name:
                asset_by_host[a.host_name.lower().strip()] = a

    # Per-tenant + per-runner-type connection cache so we don't hit the DB
    # 972 times during a Scan All.
    conn_cache: dict[str, Optional[IntegrationConnection]] = {}
    runs: list[dict] = []
    # Skip counter for visibility in the response. Without this the
    # frontend modal can't honestly answer "did you actually run 4854
    # rules or just a subset?" — the operator needs to see what was
    # filtered out and why, especially for audit defensibility.
    skipped_wrong_os_version = 0
    skipped_ai_refinement = 0
    skipped_no_connection = 0
    _work_queue: list[tuple] = []   # (plugin, effective_asset, connection) tuples for the parallel pool
    # ── STRICT-FIRST, SOFT-FALLBACK BENCHMARK RESOLUTION ──
    # Pre-resolve the picked benchmark for each asset OS that this scan-all
    # may touch. Strict mapping table is the primary source; when no
    # operator-owned row covers the OS we fall back to the same family-walk
    # the /ip-peers panel and the agent /jobs endpoint use. Without this
    # fallback, a fresh Windows version (e.g. windows-11-25H2 when the
    # library shipped windows-11-23H2 plugins) would silently skip every
    # plugin at the picked-vs-benchmark filter below — the user sees
    # "Scanning 0 of 438" forever.
    from .services.strict_matcher import pick_benchmark_for_os
    from .services.software_normaliser import benchmark_for_software_key
    picked_bench_by_os: dict[str, Optional[str]] = {}
    # Room-scan mode: when peer ids are included, also load those peer assets
    # and resolve their benchmarks so the union scan picks them up.
    peer_assets: list[ITAsset] = []
    if asset is not None and include_peer_asset_ids:
        peer_assets = db.query(ITAsset).filter(
            ITAsset.id.in_(include_peer_asset_ids),
            ITAsset.tenant_id == tenant_id,
        ).all()
    assets_to_consider: list[ITAsset] = (
        ([asset] + peer_assets) if asset is not None
        else db.query(ITAsset).filter(ITAsset.tenant_id == tenant_id).all()
    )
    for a in assets_to_consider:
        if not a.os_normalized:
            continue
        if a.os_normalized in picked_bench_by_os:
            continue
        m = pick_benchmark_for_os(db, tenant_id, a.os_normalized)
        if m:
            picked_bench_by_os[a.os_normalized] = m.benchmark_name
        else:
            soft = benchmark_for_software_key(db, a.os_normalized)
            picked_bench_by_os[a.os_normalized] = soft
            if soft:
                logger.info(
                    "scan_all: soft fallback resolved tenant_id=%s os=%s → %s",
                    tenant_id, a.os_normalized, soft,
                )

    # Room-scan attribution map: which asset should each benchmark's runs be
    # ATTRIBUTED to? Host's benchmark → host. Each peer's benchmark → that
    # peer. This is what makes the per-asset compliance history page show
    # "scanned, X%" for every selected peer after a single room-scan.
    benchmark_to_attributed_asset: dict[str, ITAsset] = {}
    allowed_benchmarks: set[str] = set()
    if asset is not None:
        host_bench = picked_bench_by_os.get(asset.os_normalized)
        if host_bench:
            benchmark_to_attributed_asset[host_bench] = asset
            allowed_benchmarks.add(host_bench)
        for peer in peer_assets:
            pb = picked_bench_by_os.get(peer.os_normalized)
            if pb:
                # First peer wins if two peers happen to share an OS (which
                # would mean the same benchmark — attributing to whichever
                # came first is fine; both peers would end up scanned).
                benchmark_to_attributed_asset.setdefault(pb, peer)
                allowed_benchmarks.add(pb)
        if include_peer_asset_ids and not allowed_benchmarks:
            logger.warning(
                "scan_all room-scan: no benchmarks resolved for host or any peer "
                "(tenant_id=%s host_os=%s peer_ids=%s)",
                tenant_id, asset.os_normalized, include_peer_asset_ids,
            )
    for plugin in plugins:
        if asset is not None:
            # Pinned asset → ONLY the asset's own connection (or explicit
            # one if caller passed it). No tenant-wide fallback.
            connection = explicit_connection or asset_pinned_connection
            # A runner may accept multiple connection families: OpenSCAP evaluates
            # over the linux_ssh transport (or locally), so an oscap plugin is
            # served by a linux_ssh / netdev_ssh connection. Match by compatibility
            # not exact equality — otherwise every oscap plugin is skipped against
            # a linux_ssh connection and the scan creates 0 runs.
            _accept = {"oscap": ("oscap", "linux_ssh", "netdev_ssh")}.get(
                plugin.runner_type, (plugin.runner_type,))
            if connection and plugin.runner_type and connection.integration_type not in _accept:
                continue
            effective_asset = asset
        else:
            connection = _resolve_connection_for_plugin(
                db, tenant_id, plugin, explicit_connection, conn_cache,
            )
            # Reverse-resolve the asset whose host matches this connection
            # so the run gets a proper asset_id label.
            effective_asset = None
            if connection and connection.console_url:
                effective_asset = asset_by_host.get(connection.console_url.lower().strip())
        # If still no matching connection AND the plugin needs one, skip.
        if connection is None and plugin.runner_type:
            skipped_no_connection += 1
            continue
        # ─── OS-version filter (the real fix) ───────────────────────
        # Even when the runner_type matches (windows_winrm to a Windows
        # host), the BENCHMARK targets a specific product — Win-11
        # rules vs Server-2022 rules vs Win-10 rules. Without this gate
        # we'd run all of them against every Windows host, marking
        # hundreds of irrelevant checks as "failed" (registry path
        # doesn't exist on this product, etc.) and inflating the risk
        # score. Skip the plugin when the asset's detected OS doesn't
        # match the benchmark's target; if either side is unknown,
        # benchmark_applies_to_asset is permissive (back-compat).
        asset_os = getattr(effective_asset, "os_normalized", None) if effective_asset is not None else None
        asset_os_v = getattr(effective_asset, "os_version", None) if effective_asset is not None else None

        # ── STRICT SINGLE-STAGE FILTER + ROOM-SCAN UNION ──
        # In single-asset mode (no peers), the picked benchmark for this asset
        # OS is the ONLY benchmark whose rules will run.
        # In room-scan mode (peers included), the allowed benchmark set is
        # the union of {host's benchmark, each peer's benchmark}, and each
        # plugin gets attributed to the asset whose benchmark it came from.
        picked = picked_bench_by_os.get(asset_os) if asset_os else None
        # Pinned-asset NO-OS guard. Without this, an asset whose
        # os_normalized is NULL silently fell through every os-check
        # below and got every approved+enabled plugin executed against
        # it — producing thousands of bogus "failed" runs that
        # contradicted the Compliance tab's "0 applicable" panel
        # (the panel correctly used the strict matcher and returned 0).
        # Now we explicitly skip ALL plugins when a pinned asset has
        # no OS, matching what /match-preview reports to the operator.
        if asset is not None and not asset_os:
            skipped_wrong_os_version += 1
            continue
        # Default attribution = effective_asset (host in pinned mode).
        attributed_to = effective_asset
        if asset is not None and include_peer_asset_ids:
            # Room-scan: plugin is in-scope if it belongs to ANY benchmark in
            # the union, and it's attributed to that benchmark's owning asset.
            if plugin.benchmark not in allowed_benchmarks:
                skipped_ai_refinement += 1
                continue
            attributed_to = benchmark_to_attributed_asset.get(plugin.benchmark, effective_asset)
        else:
            # Single-asset mode: keep the original strict semantics.
            if asset_os and not picked:
                # No mapping for this OS → skip every plugin (operator must
                # configure the mapping). Count under the same bucket so the
                # response is comparable to legacy.
                skipped_wrong_os_version += 1
                continue
            if picked and plugin.benchmark != picked:
                skipped_ai_refinement += 1
                continue
        # Queue the work item rather than running it inline. The actual
        # network round-trip (WinRM/SSH/Oracle/etc.) happens in parallel
        # below via a ThreadPoolExecutor — without this, scanning a
        # 50-host fleet against 538 rules each ran them serially and
        # took ~hours instead of ~minutes.
        # Tuple shape: (plugin, executing_asset, attributed_asset, connection).
        # executing_asset = the host whose connection is used; attributed_asset
        # = whose asset_id gets stamped on the run (= the peer in room-scan).
        _work_queue.append((plugin, effective_asset, attributed_to, connection))

    # ─── Parallel execution of queued work items ─────────────────────────
    # SQLAlchemy Session is NOT thread-safe, so each worker opens its own
    # session and closes it on exit.  CRITICAL: the worker session must
    # be bound to the **tenant** DB (the one the request `db` was opened
    # against), NOT to `grc.models.SessionLocal` — that helper points at
    # the master catalog DB which has no `grc_compliance_plugin_runs`
    # table.  Using `db.get_bind()` gives us the exact tenant engine
    # FastAPI's `Depends(get_db)` already resolved for this request, so
    # every worker thread inserts into the same `grc_<slug>` database
    # where the plugin / asset / connection rows live.
    #
    # Concurrency cap of 10 keeps WinRM/SSH connection counts well under
    # what a typical target host will accept, and avoids overwhelming
    # the backend's network/file-descriptor budget on a 1000-rule scan.
    from concurrent.futures import ThreadPoolExecutor, as_completed
    from sqlalchemy.orm import sessionmaker

    # Resolve the request's tenant engine ONCE outside the worker so we
    # don't re-touch the request-scoped Session in worker threads (which
    # would defeat the thread-safety we're trying to preserve here).
    _tenant_engine = db.get_bind()
    _WorkerSession = sessionmaker(bind=_tenant_engine, expire_on_commit=False)

    def _one(plugin, eff_asset, attributed_asset, conn):
        worker_db = _WorkerSession()
        try:
            run = execute_plugin(
                db=worker_db,
                tenant_id=tenant_id,
                user_id=current_user.id,
                plugin=plugin,
                asset=eff_asset,
                connection=conn,
                triggered_by="scan_all",
                attributed_to_asset=attributed_asset,
            )
            # Build the response-dict view inside the worker session so
            # all lazy attrs are resolved before we close the session.
            return _run_to_dict(run, plugin, attributed_asset or eff_asset, conn, triggered_by_user=current_user)
        finally:
            worker_db.close()

    max_workers = int(os.environ.get("COMPLYVERSE_SCAN_CONCURRENCY", "10"))
    if _work_queue:
        with ThreadPoolExecutor(max_workers=max_workers) as pool:
            futures = [pool.submit(_one, p, ea, aa, c) for (p, ea, aa, c) in _work_queue]
            for fut in as_completed(futures):
                try:
                    runs.append(fut.result())
                except Exception as exc:  # noqa: BLE001
                    logger.warning("scan-all parallel worker failed: %s", exc)

    # Lock release now lives in the caller's try/finally — see scan_all
    # above. This function may return or raise; either way the lock will
    # be cleared.
    # Hint message — surfaced as a banner in the Compliance tab when the
    # operator clicks "Scan now" on an unclassified asset. Previously the
    # response was a bare {executed: 0, ...} which the modal rendered as
    # silent success.
    hint: Optional[str] = None
    if asset is not None and len(runs) == 0:
        if not asset.os_normalized:
            hint = (
                f"Asset '{asset.name}' has no normalized OS — nothing scanned. "
                f"Use 'Re-detect OS' on the Compliance tab, or set os_normalized "
                f"manually via the Edit dialog, then retry."
            )
        elif skipped_wrong_os_version > 0 and skipped_ai_refinement == 0:
            hint = (
                f"No CIS benchmark mapped for OS '{asset.os_normalized}'. "
                f"Add a mapping via Compliance Plugins → Benchmark Mappings."
            )
    return {
        "executed": len(runs),
        "runs": runs,
        "tenant_connections_used": list(conn_cache.keys()),
        "skipped_wrong_os_version": skipped_wrong_os_version,
        "skipped_ai_refinement": skipped_ai_refinement,
        "skipped_no_connection": skipped_no_connection,
        "ai_routed_os_versions": [],
        "hint": hint,
    }


# NOTE: the benchmark-mappings / normalise-os admin routes were defined
# here originally but moved earlier in the file (before the `/{plugin_id}`
# catch-all) to fix a route-shadowing 422 — FastAPI was trying to parse
# `benchmark-mappings` as an int plugin_id. See the block immediately
# above `@router.get("/{plugin_id}")` for the active definitions.


@router.get("/{plugin_id}/control-mappings")
def list_mappings(
    plugin_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    tenant_id = get_user_primary_tenant(current_user, db)
    plugin = db.query(CompliancePlugin).filter(
        CompliancePlugin.id == plugin_id,
        (CompliancePlugin.tenant_id.is_(None)) | (CompliancePlugin.tenant_id == tenant_id),
    ).first()
    if not plugin:
        raise HTTPException(404, "Plugin not found")
    rows = db.query(PluginControlMapping).filter(
        PluginControlMapping.plugin_id == plugin.id,
        PluginControlMapping.tenant_id == tenant_id,
    ).all()
    return {"mappings": [
        {
            "id": m.id,
            "plugin_id": m.plugin_id,
            "framework_control_id": m.framework_control_id,
            "normalized_control_id": m.normalized_control_id,
            "weight": m.weight,
        } for m in rows
    ]}


@router.post("/{plugin_id}/control-mappings", status_code=201)
def create_mapping(
    plugin_id: int,
    body: ControlMappingCreate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    tenant_id = get_user_primary_tenant(current_user, db)
    plugin = db.query(CompliancePlugin).filter(
        CompliancePlugin.id == plugin_id,
        (CompliancePlugin.tenant_id.is_(None)) | (CompliancePlugin.tenant_id == tenant_id),
    ).first()
    if not plugin:
        raise HTTPException(404, "Plugin not found")
    if not body.framework_control_id and not body.normalized_control_id:
        raise HTTPException(400, "Provide framework_control_id or normalized_control_id")
    m = PluginControlMapping(
        tenant_id=tenant_id,
        plugin_id=plugin.id,
        framework_control_id=body.framework_control_id,
        normalized_control_id=body.normalized_control_id,
        weight=body.weight,
    )
    db.add(m)
    db.commit()
    db.refresh(m)
    return {"id": m.id, "plugin_id": m.plugin_id}
