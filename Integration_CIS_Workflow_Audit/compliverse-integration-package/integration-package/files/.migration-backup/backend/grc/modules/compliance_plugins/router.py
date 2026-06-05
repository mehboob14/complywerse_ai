"""Compliance Plugin Engine API (Task #55)."""
from __future__ import annotations

import logging
from typing import Any, List, Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from pydantic import BaseModel, Field
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
    plugins = q.order_by(CompliancePlugin.benchmark.asc(), CompliancePlugin.rule_id.asc()).all()
    # Aggregate per-plugin pass/fail/error counts for the library table.
    from sqlalchemy import func as _f
    stats_rows = (
        db.query(
            CompliancePluginRun.plugin_id,
            CompliancePluginRun.status,
            _f.count(CompliancePluginRun.id),
        )
        .filter(CompliancePluginRun.tenant_id == tenant_id)
        .group_by(CompliancePluginRun.plugin_id, CompliancePluginRun.status)
        .all()
    )
    stats: dict[int, dict[str, int]] = {}
    for pid, st, cnt in stats_rows:
        s = stats.setdefault(pid, {"passed": 0, "failed": 0, "error": 0, "total": 0})
        if st in s:
            s[st] = int(cnt)
        s["total"] += int(cnt)
    out = []
    for p in plugins:
        d = _plugin_to_dict(p, tenant_id=tenant_id, db=db)
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
        "total": len(plugins),
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
        .filter(CompliancePluginRun.tenant_id == tenant_id)
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
    # sees who hasn't onboarded yet and can chase them. We pull from the
    # per-tenant schema's users table (the authoritative tenant roster),
    # not just the public grc_users table, because tenant_a.users and
    # tenant_b.users have different ID spaces.
    from grc.models import Tenant
    from grc.tenant_models import TenantUser as TenantSchemaUser
    from grc.tenant_manager import get_tenant_session
    from sqlalchemy import text as _sql_text

    tenant = db.query(Tenant).filter(Tenant.id == tenant_id).first()
    tenant_users: list[dict] = []
    if tenant and tenant.schema_name:
        try:
            TenantSessionClass = get_tenant_session(tenant.schema_name)
            tdb = TenantSessionClass()
            try:
                tdb.execute(_sql_text(f'SET search_path TO "{tenant.schema_name}", public'))
                for tu in tdb.query(TenantSchemaUser).all():
                    tenant_users.append({
                        "id": tu.id,
                        "username": tu.username,
                        "email": tu.email,
                        "display_name": getattr(tu, "display_name", None) or tu.username,
                    })
            finally:
                tdb.close()
        except Exception:
            tenant_users = []

    # Fallback: also try public grc_users matched by tenant_id (legacy
    # rows that haven't been migrated to per-tenant schema yet).
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
    "container": "Containers / Orchestration",
    "unclassified": "Unclassified",
}


def _classify_asset_os(
    asset: ITAsset,
    connections_by_host: dict[str, IntegrationConnection],
) -> str:
    """Best-effort OS classification for an asset.

    Priority: explicit runner_type on a matched connection → keyword match
    on name/description/asset_type → unclassified.
    """
    # 1. Match by host_name → connection.console_url
    host = (asset.host_name or "").lower().strip()
    if host:
        conn = connections_by_host.get(host)
        if conn and conn.integration_type in _RUNNER_TYPE_TO_OS:
            return _RUNNER_TYPE_TO_OS[conn.integration_type]

    # 2. Keyword scan over name + description + asset_type
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

    # Tenant connections — keyed by host so we can match assets by host_name
    connections = (
        db.query(IntegrationConnection)
        .filter(IntegrationConnection.tenant_id == tenant_id)
        .all()
    )
    connections_by_host: dict[str, IntegrationConnection] = {}
    for c in connections:
        h = (c.console_url or "").lower().strip()
        if h and h not in connections_by_host:
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
        .filter(CompliancePluginRun.tenant_id == tenant_id)
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

    for a in assets:
        os_family = _classify_asset_os(a, connections_by_host)
        statuses = per_asset_latest.get(a.id, {})
        passed = sum(1 for s in statuses.values() if s == "passed")
        failed = sum(1 for s in statuses.values() if s == "failed")
        errored = sum(1 for s in statuses.values() if s == "error")
        scanned = len(statuses)
        pass_rate = round(passed / total_rules * 100, 1) if total_rules else 0.0
        last_scan = per_asset_last_scan.get(a.id)

        # Connection match — STRICT, host_name → console_url only. We used
        # to fall back to "any connection of the same runner_type" which
        # lied to operators: an asset with no real credentials appeared
        # to be scannable because some other Windows host had a connection.
        # If the asset's own host doesn't have a connection row, it's
        # genuinely not scannable.
        host_lc = (a.host_name or "").lower().strip()
        matched_conn = connections_by_host.get(host_lc) if host_lc else None

        groups.setdefault(os_family, []).append({
            "id": a.id,
            "name": a.name,
            "host_name": a.host_name,
            "ip_address": a.ip_address,
            "asset_type": a.asset_type,
            "criticality": a.criticality,
            "owner_name": a.owner_name,
            "confidentiality_rating": a.confidentiality_rating,
            "integrity_rating": a.integrity_rating,
            "availability_rating": a.availability_rating,
            "status": a.status,
            "os_family": os_family,
            "runner_type": matched_conn.integration_type if matched_conn else None,
            "connection_id": matched_conn.id if matched_conn else None,
            "has_connection": matched_conn is not None,
            "last_scan_at": last_scan.isoformat() if last_scan else None,
            "scanned_rules": scanned,
            "passed": passed,
            "failed": failed,
            "errored": errored,
            "pass_rate": pass_rate,
        })

        if scanned > 0:
            totals_scanned += 1
            total_pass_rate_sum += pass_rate
            total_pass_rate_count += 1

    # Order groups for stable UI rendering
    group_order = [
        "windows_server", "linux_server", "aws_account", "azure_account",
        "gcp_account", "vmware_host", "network_device", "database",
        "container", "windows_workstation", "unclassified",
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
    current_user: GRCUser = Depends(require_auth),
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
    current_user: GRCUser = Depends(require_auth),
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
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    tenant_id = get_user_primary_tenant(current_user, db)
    q = db.query(CompliancePluginRun).filter(CompliancePluginRun.tenant_id == tenant_id)
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
    if (explicit_connection is not None and
            explicit_connection.integration_type == plugin.runner_type):
        return explicit_connection
    cached = conn_cache.get(plugin.runner_type, "MISSING")
    if cached != "MISSING":
        return cached
    conn = (
        db.query(IntegrationConnection)
        .filter(
            IntegrationConnection.tenant_id == tenant_id,
            IntegrationConnection.integration_type == plugin.runner_type,
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
    q = db.query(CompliancePlugin).filter(
        (CompliancePlugin.tenant_id.is_(None)) | (CompliancePlugin.tenant_id == tenant_id),
        CompliancePlugin.enabled.is_(True),
        # Only approved rules are scan-eligible. Pending/rejected stay
        # in the review queue and can't be executed.
        CompliancePlugin.review_status.in_(["approved", "auto_approved"]),
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
            _scan_lock_release(tenant_id, asset_id)
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
    if asset is not None and explicit_connection is None and asset_pinned_connection is None:
        _scan_lock_release(tenant_id, asset_id)
        raise HTTPException(
            400,
            f"Asset '{asset.name}' has no connection. Add credentials via "
            f"Administration → Integrations before scanning this asset.",
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
    for plugin in plugins:
        if asset is not None:
            # Pinned asset → ONLY the asset's own connection (or explicit
            # one if caller passed it). No tenant-wide fallback.
            connection = explicit_connection or asset_pinned_connection
            if connection and plugin.runner_type and connection.integration_type != plugin.runner_type:
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
            continue
        run = execute_plugin(
            db=db,
            tenant_id=tenant_id,
            user_id=current_user.id,
            plugin=plugin,
            asset=effective_asset,
            connection=connection,
            triggered_by="scan_all",
        )
        runs.append(_run_to_dict(run, plugin, effective_asset, connection, triggered_by_user=current_user))

    # Release the scan lock for this tenant+asset key now that we're done.
    # Any uncaught exception above will leave the lock acquired — that's
    # safe in practice because backend restart clears the in-process dict,
    # and a stale lock just means the user must restart their dev server.
    _scan_lock_release(tenant_id, asset_id)
    return {"executed": len(runs), "runs": runs, "tenant_connections_used": list(conn_cache.keys())}


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
