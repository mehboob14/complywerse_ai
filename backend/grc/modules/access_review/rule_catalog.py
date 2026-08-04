"""Catalog-driven access-review rule engine (B1).

The OLD approach hard-coded six checks in checks.py. This module replaces that
with a **catalog**: every rule is a declarative entry (id, domain, severity,
what it reads, when it trips, regulation mapping) and the runnable ones carry a
`check` callable. A tenant turns rules on/off via grc_access_review_rule_config;
the definitions themselves live here in code.

Three "tiers" of connectivity decide whether a rule can run today:
  * runnable        — runs on the directory data we already sync (Tier 1)
  * needs_data      — logic exists but needs a data feed we don't have yet
  * needs_connector — needs a Tier-2/3 connector (SAP, AWS, DB, …) first

Only `runnable` rules execute; the rest are shown in the Rule Library so the
full auditor catalog is visible, each with the reason it can't run yet.
"""
from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any, Callable, Dict, List, Optional

from sqlalchemy.orm import Session

from ...models import (
    AccessReviewFinding,
    AccessReviewItem,
    Role,
    SoDRule,
    UserRole,
)

STALE_DAYS = 90
IT_SECURITY_DEPTS = {"it", "information technology", "security", "infosec", "information security"}
# Tokens that mark an account as shared / non-human (segment match, not substring).
_SHARED_TOKENS = {"svc", "service", "shared", "admin", "test", "sys", "system",
                  "generic", "bot", "automation", "robot", "root"}

RUNNABLE = "runnable"
NEEDS_DATA = "needs_data"
NEEDS_CONNECTOR = "needs_connector"

Finding = Dict[str, Any]


# --------------------------------------------------------------------------- #
# Check functions — each takes (item, ctx) and returns a list of findings.    #
# ctx is precomputed once per run (see _build_context) to avoid N+1 queries.  #
# --------------------------------------------------------------------------- #
def _chk_ghost(item: AccessReviewItem, ctx: Dict[str, Any]) -> List[Finding]:
    if item.termination_date and item.account_enabled:
        return [{"finding_type": "ghost_account", "severity": "critical",
                 "title": "Terminated user still active",
                 "detail": f"{item.email} has termination date {item.termination_date} but the account is still enabled."}]
    return []


def _chk_stale(item: AccessReviewItem, ctx: Dict[str, Any]) -> List[Finding]:
    if not item.account_enabled:
        return []
    if item.last_sign_in is None:
        return [{"finding_type": "stale_account", "severity": "medium",
                 "title": "No sign-in on record",
                 "detail": f"{item.email} has an active account with no recorded sign-in."}]
    if item.last_sign_in < ctx["now"] - timedelta(days=STALE_DAYS):
        days = (ctx["now"] - item.last_sign_in).days
        return [{"finding_type": "stale_account", "severity": "medium",
                 "title": "Stale account",
                 "detail": f"{item.email} has not signed in for {days} days."}]
    return []


def _chk_mfa(item: AccessReviewItem, ctx: Dict[str, Any]) -> List[Finding]:
    if item.account_enabled and item.mfa_enabled is False:
        return [{"finding_type": "mfa_missing", "severity": "high",
                 "title": "MFA not registered",
                 "detail": f"{item.email} has an active account but no registered MFA method."}]
    return []


def _chk_shared(item: AccessReviewItem, ctx: Dict[str, Any]) -> List[Finding]:
    local = (item.email or "").split("@")[0].lower()
    parts = set(p for p in local.replace(".", " ").replace("_", " ").replace("-", " ").split() if p)
    if parts & _SHARED_TOKENS:
        return [{"finding_type": "shared_account", "severity": "high",
                 "title": "Shared / generic account",
                 "detail": f"{item.email} looks like a shared or service account, not tied to one named person."}]
    return []


def _chk_over_priv(item: AccessReviewItem, ctx: Dict[str, Any]) -> List[Finding]:
    if item.is_privileged:
        dept = (item.department or "").strip().lower()
        if dept not in IT_SECURITY_DEPTS:
            where = f"works in '{item.department}'" if dept else "has no department recorded"
            return [{"finding_type": "over_privileged", "severity": "high",
                     "title": "Privileged access outside IT/Security",
                     "detail": f"{item.email} holds a privileged role but {where}. Confirm least-privilege."}]
    return []


def _chk_sod(item: AccessReviewItem, ctx: Dict[str, Any]) -> List[Finding]:
    if not item.user_id:
        return []
    held = ctx["user_role_ids"].get(item.user_id, set())
    out: List[Finding] = []
    for rule in ctx["sod_rules"]:
        if rule.role_a_id in held and rule.role_b_id in held:
            ra = ctx["role_names"].get(rule.role_a_id, str(rule.role_a_id))
            rb = ctx["role_names"].get(rule.role_b_id, str(rule.role_b_id))
            out.append({"finding_type": "sod_conflict", "severity": rule.severity or "high",
                        "title": f"SoD conflict: {rule.name}",
                        "detail": f"{item.email} holds conflicting roles '{ra}' and '{rb}'.",
                        "sod_rule_id": rule.id})
    return out


def _chk_creep(item: AccessReviewItem, ctx: Dict[str, Any]) -> List[Finding]:
    if not item.user_id:
        return []
    count = len(ctx["user_role_ids"].get(item.user_id, set()))
    dept = (item.department or "").strip().lower()
    avg = ctx["dept_avg_roles"].get(dept, ctx["global_avg_roles"])
    if count >= 4 and count > avg + 2:
        return [{"finding_type": "privilege_creep", "severity": "medium",
                 "title": "Privilege creep",
                 "detail": f"{item.email} holds {count} roles — well above the peer average of {avg:.1f} in '{item.department or 'n/a'}'."}]
    return []


def _chk_no_approval(item: AccessReviewItem, ctx: Dict[str, Any]) -> List[Finding]:
    if item.user_id and item.user_id in ctx["unapproved_user_ids"]:
        return [{"finding_type": "no_approval", "severity": "low",
                 "title": "Access without recorded approval",
                 "detail": f"{item.email} has a role assignment with no recorded approver or source."}]
    return []


# ---- Database pack (runs once a Tier-3 Database connector is synced) ----
_DB_DEFAULT_NAMES = {"postgres", "sa", "root", "admin", "sys", "dba", "mysql", "system"}


def _is_db_account(item: AccessReviewItem) -> bool:
    return bool(item.email) and item.email.endswith(".db")


def _item_role_names(item: AccessReviewItem) -> set:
    return set(item.roles_snapshot or [])


def _chk_db_super(item: AccessReviewItem, ctx: Dict[str, Any]) -> List[Finding]:
    if _is_db_account(item) and "DB Superuser" in _item_role_names(item):
        return [{"finding_type": "db_superuser", "severity": "critical",
                 "title": "Database superuser account",
                 "detail": f"{item.email} holds database superuser — confirm it is an authorised DBA."}]
    return []


def _chk_db_default(item: AccessReviewItem, ctx: Dict[str, Any]) -> List[Finding]:
    if _is_db_account(item) and item.account_enabled:
        local = (item.email or "").split("@")[0].lower()
        if local in _DB_DEFAULT_NAMES:
            return [{"finding_type": "db_default_account", "severity": "high",
                     "title": "Default / shared database account",
                     "detail": f"{item.email} is a default/shared DB account and can log in."}]
    return []


def _rule(id, domain, name, severity, status, reads, trips, regulation, check=None, default=None):
    return {
        "id": id, "domain": domain, "name": name, "severity": severity,
        "status": status, "reads": reads, "trips": trips, "regulation": regulation,
        "check": check,
        # runnable rules default ON; the rest default OFF (can't run anyway).
        "default_enabled": (status == RUNNABLE) if default is None else default,
    }


# --------------------------------------------------------------------------- #
# THE CATALOG. Runnable rules carry a check; the rest are metadata-only so the #
# Rule Library shows the full auditor catalog with the reason each is blocked. #
# --------------------------------------------------------------------------- #
RULE_CATALOG: List[Dict[str, Any]] = [
    # ---- Identity lifecycle ----
    _rule("IDM-01", "Identity lifecycle", "Terminated still active", "critical", RUNNABLE,
          "HR termination + account status", "termination date set AND account still enabled", "SOX·SAMA", _chk_ghost),
    _rule("IDM-02", "Identity lifecycle", "Role kept after transfer (mover)", "high", NEEDS_DATA,
          "department-change history", "dept changed AND old-dept role still held", "SOX"),
    _rule("IDM-03", "Identity lifecycle", "Orphan account", "high", NEEDS_DATA,
          "account ↔ HR identity link", "account has no matching active employee", "SOX·PCI"),
    _rule("IDM-04", "Identity lifecycle", "Dormant access", "medium", RUNNABLE,
          "last sign-in", "no sign-in > 90 days (or never)", "SOX", _chk_stale),
    # ---- Authentication ----
    _rule("AUTH-01", "Authentication", "No MFA", "high", RUNNABLE,
          "mfa_enabled", "active account AND no MFA registered", "PCI·SAMA", _chk_mfa),
    _rule("AUTH-02", "Authentication", "Shared / generic account", "high", RUNNABLE,
          "account naming", "account not tied to one named person", "SOX·PCI", _chk_shared),
    _rule("AUTH-03", "Authentication", "SSO not enforced", "medium", NEEDS_DATA,
          "per-user auth method", "local password login on an SSO-capable app", "—"),
    # ---- Privilege & SoD ----
    _rule("PRIV-01", "Privilege & SoD", "Over-privileged", "high", RUNNABLE,
          "roles + department", "privileged role outside IT/Security", "SOX", _chk_over_priv),
    _rule("PRIV-02", "Privilege & SoD", "SoD toxic combo", "high", RUNNABLE,
          "role pairs vs SoD rules", "holds both roles of a forbidden pair", "SOX·SAMA", _chk_sod),
    _rule("PRIV-03", "Privilege & SoD", "Standing admin (no JIT)", "medium", NEEDS_DATA,
          "assignment type", "permanent privileged role, not time-bound", "—"),
    _rule("PRIV-04", "Privilege & SoD", "Privilege creep", "medium", RUNNABLE,
          "role count vs peers", "roles accumulated well beyond peer average", "SOX", _chk_creep),
    # ---- Authorization ----
    _rule("APRV-01", "Authorization", "No recorded approval", "low", RUNNABLE,
          "role assignment approver/source", "held role with no approver or source", "SOX", _chk_no_approval),
    # ---- Network devices (needs connector) ----
    _rule("NET-01", "Network devices", "Default / shared device creds", "critical", NEEDS_CONNECTOR,
          "device local accounts", "default or shared admin present", "PCI"),
    _rule("NET-02", "Network devices", "Not via TACACS+/RADIUS", "high", NEEDS_CONNECTOR,
          "device AAA config", "local admin auth, not centralized", "PCI"),
    _rule("NET-03", "Network devices", "No MFA on network admin", "high", NEEDS_CONNECTOR,
          "admin access method", "privileged device access without MFA", "PCI"),
    _rule("NET-04", "Network devices", "Firewall any-any rule", "high", NEEDS_CONNECTOR,
          "firewall ruleset", "overly broad allow rule", "PCI"),
    # ---- DevOps / CI-CD ----
    _rule("DEV-01", "DevOps / CI-CD", "Secrets in repo", "critical", NEEDS_CONNECTOR,
          "repo content scan", "hardcoded key/secret found", "PCI·SOX"),
    _rule("DEV-02", "DevOps / CI-CD", "Standing repo / org admin", "high", NEEDS_CONNECTOR,
          "repo org roles", "permanent owner/admin", "SOX"),
    _rule("DEV-03", "DevOps / CI-CD", "Long-lived token", "high", NEEDS_CONNECTOR,
          "PATs / service tokens", "token without expiry or rotation", "PCI"),
    _rule("DEV-04", "DevOps / CI-CD", "Dev has prod deploy", "high", NEEDS_CONNECTOR,
          "pipeline / prod roles", "developer holds prod deploy rights", "SOX"),
    # ---- Databases (RUNNABLE once a Tier-3 Database connector is synced) ----
    _rule("DB-01", "Databases", "Database superuser (DBA)", "critical", RUNNABLE,
          "DB roles", "account holds DB superuser", "SOX", _chk_db_super),
    _rule("DB-02", "Databases", "Default / shared DB account", "high", RUNNABLE,
          "DB account name", "default account (postgres/sa/root…) can log in", "PCI", _chk_db_default),
    _rule("DB-03", "Databases", "Direct prod / PII access", "high", NEEDS_CONNECTOR,
          "table grants", "direct read on sensitive tables, bypassing app", "GDPR·PCI"),
    _rule("DB-04", "Databases", "GRANT ALL / public role", "high", NEEDS_CONNECTOR,
          "privilege grants", "excessive grant or public-role privileges", "SOX"),
    # ---- Cloud ----
    _rule("CLD-01", "Cloud", "Root used / no MFA on root", "critical", NEEDS_CONNECTOR,
          "root activity + MFA", "root login OR root MFA off", "SOX·PCI"),
    _rule("CLD-02", "Cloud", "Wildcard IAM policy", "critical", NEEDS_CONNECTOR,
          "IAM policies", "*:* or Owner-equivalent", "SOX"),
    _rule("CLD-03", "Cloud", "Long-lived access key", "high", NEEDS_CONNECTOR,
          "access keys + age", "key not rotated > 90 days", "PCI"),
    _rule("CLD-04", "Cloud", "Public storage / open SG", "high", NEEDS_CONNECTOR,
          "bucket ACL + security groups", "public bucket OR 0.0.0.0/0 ingress", "PCI·GDPR"),
    _rule("CLD-05", "Cloud", "Orphaned cloud user", "high", NEEDS_CONNECTOR,
          "cloud users ↔ HR", "active cloud user for a leaver", "SOX"),
    # ---- Finance ERP ----
    _rule("ERP-01", "Finance ERP", "SoD: create vendor + run payment", "critical", NEEDS_CONNECTOR,
          "ERP roles", "same user holds both entitlements", "SOX·SAMA"),
    _rule("ERP-02", "Finance ERP", "SoD: post + approve journal", "critical", NEEDS_CONNECTOR,
          "ERP roles", "same user posts AND approves", "SOX"),
    _rule("ERP-03", "Finance ERP", "SAP_ALL / super-user profile", "critical", NEEDS_CONNECTOR,
          "profiles", "SAP_ALL or equivalent assigned", "SOX"),
    _rule("ERP-04", "Finance ERP", "Firefighter not logged", "high", NEEDS_CONNECTOR,
          "emergency-access logs", "firefighter use without log/justification", "SOX·SAMA"),
    _rule("ERP-05", "Finance ERP", "Powerful t-code to non-finance", "high", NEEDS_CONNECTOR,
          "t-code assignments", "sensitive t-code held by non-finance user", "SOX"),
    _rule("ERP-06", "Finance ERP", "Maker-checker not enforced", "high", NEEDS_CONNECTOR,
          "workflow config", "same user can initiate AND approve", "SAMA"),
    # ---- Privileged access (PAM) ----
    _rule("PAM-01", "Privileged access (PAM)", "Standing privileged, not vaulted", "high", NEEDS_CONNECTOR,
          "privileged accounts vs vault", "privileged account not under PAM", "PCI"),
    _rule("PAM-02", "Privileged access (PAM)", "Shared admin password", "high", NEEDS_CONNECTOR,
          "shared-cred inventory", "admin password shared across people", "PCI"),
    _rule("PAM-03", "Privileged access (PAM)", "Break-glass w/o justification", "high", NEEDS_CONNECTOR,
          "break-glass usage logs", "used without ticket/justification", "SOX"),
    # ---- OS / servers ----
    _rule("OS-01", "OS / servers", "Domain admin sprawl", "critical", NEEDS_CONNECTOR,
          "domain admin group", "excessive domain-admin members", "SOX"),
    _rule("OS-02", "OS / servers", "Local root/admin not centralized", "high", NEEDS_CONNECTOR,
          "server local admins", "local admin not via central IdM", "SOX"),
    # ---- SaaS / data ----
    _rule("SAAS-01", "SaaS / data", "External / guest standing access", "medium", NEEDS_CONNECTOR,
          "guest users", "external user with persistent access", "GDPR"),
    _rule("SAAS-02", "SaaS / data", "Over-shared sensitive files", "medium", NEEDS_CONNECTOR,
          "sharing settings", "sensitive file shared broadly/public", "GDPR"),
    # ---- Cross-system & approval ----
    _rule("XSYS-01", "Cross-system & approval", "Toxic cross-system combo", "high", NEEDS_CONNECTOR,
          "roles across systems", "e.g. AD admin AND DB admin together", "SOX"),
    _rule("XSYS-02", "Cross-system & approval", "Requester = approver", "high", NEEDS_DATA,
          "request + approval records", "same person requested AND approved", "SOX·SAMA"),
    _rule("XSYS-03", "Cross-system & approval", "Terminated active anywhere", "critical", NEEDS_CONNECTOR,
          "all systems + HR", "leaver still active in ANY connected system", "SOX·SAMA"),
    _rule("CERT-01", "Cross-system & approval", "Recertification overdue", "medium", NEEDS_DATA,
          "last certification date", "access not recertified within the cycle", "SOX"),
]

CATALOG_BY_ID = {r["id"]: r for r in RULE_CATALOG}


def domain_order() -> List[str]:
    seen, out = set(), []
    for r in RULE_CATALOG:
        if r["domain"] not in seen:
            seen.add(r["domain"]); out.append(r["domain"])
    return out


# --------------------------------------------------------------------------- #
# Engine                                                                      #
# --------------------------------------------------------------------------- #
def _build_context(tenant_db: Session, tenant_id: int, items: List[AccessReviewItem]) -> Dict[str, Any]:
    sod_rules = (
        tenant_db.query(SoDRule)
        .filter(SoDRule.tenant_id == tenant_id, SoDRule.is_active == True)  # noqa: E712
        .all()
    )
    role_names = {r.id: r.name for r in tenant_db.query(Role).all()}

    user_ids = [i.user_id for i in items if i.user_id]
    user_role_ids: Dict[int, set] = {uid: set() for uid in user_ids}
    unapproved: set = set()
    if user_ids:
        for ur in tenant_db.query(UserRole).filter(UserRole.user_id.in_(user_ids)).all():
            user_role_ids.setdefault(ur.user_id, set()).add(ur.role_id)
            if not ur.assigned_by and not ur.source:
                unapproved.add(ur.user_id)

    # Peer averages for privilege-creep, by department.
    dept_counts: Dict[str, List[int]] = {}
    all_counts: List[int] = []
    for it in items:
        if not it.user_id:
            continue
        c = len(user_role_ids.get(it.user_id, set()))
        all_counts.append(c)
        dept_counts.setdefault((it.department or "").strip().lower(), []).append(c)
    dept_avg = {d: (sum(v) / len(v) if v else 0) for d, v in dept_counts.items()}
    global_avg = (sum(all_counts) / len(all_counts)) if all_counts else 0

    return {
        "now": datetime.utcnow(),
        "sod_rules": sod_rules,
        "role_names": role_names,
        "user_role_ids": user_role_ids,
        "unapproved_user_ids": unapproved,
        "dept_avg_roles": dept_avg,
        "global_avg_roles": global_avg,
    }


def effective_enabled(rule: Dict[str, Any], cfg) -> bool:
    """A rule runs if a tenant config row says so, else the catalog default."""
    if cfg is not None and cfg.enabled is not None:
        return bool(cfg.enabled)
    return bool(rule["default_enabled"])


def run_enabled_rules(tenant_db: Session, *, tenant_id: int, campaign_id: int,
                      items: List[AccessReviewItem]) -> int:
    """Clear prior findings, then run every ENABLED + RUNNABLE catalog rule over
    each sampled item. Returns the total number of findings written."""
    from ...models import AccessReviewRuleConfig

    tenant_db.query(AccessReviewFinding).filter(
        AccessReviewFinding.campaign_id == campaign_id
    ).delete(synchronize_session=False)

    cfg_map = {
        c.rule_id: c
        for c in tenant_db.query(AccessReviewRuleConfig)
        .filter(AccessReviewRuleConfig.tenant_id == tenant_id).all()
    }
    ctx = _build_context(tenant_db, tenant_id, items)

    active = [
        r for r in RULE_CATALOG
        if r["check"] is not None and effective_enabled(r, cfg_map.get(r["id"]))
    ]
    sev_override = {rid: c.severity for rid, c in cfg_map.items() if c.severity}

    total = 0
    for item in items:
        for rule in active:
            for f in rule["check"](item, ctx):
                tenant_db.add(AccessReviewFinding(
                    tenant_id=tenant_id, campaign_id=campaign_id, item_id=item.id,
                    finding_type=f["finding_type"],
                    severity=sev_override.get(rule["id"]) or f["severity"],
                    title=f["title"], detail=f.get("detail"),
                    sod_rule_id=f.get("sod_rule_id"),
                ))
                total += 1
    return total


def catalog_view(tenant_db: Session, tenant_id: int) -> Dict[str, Any]:
    """Catalog grouped by domain with each rule's effective enabled state, for
    the Rule Library screen."""
    from ...models import AccessReviewRuleConfig

    cfg_map = {
        c.rule_id: c
        for c in tenant_db.query(AccessReviewRuleConfig)
        .filter(AccessReviewRuleConfig.tenant_id == tenant_id).all()
    }
    domains: Dict[str, List[Dict[str, Any]]] = {}
    enabled_n = runnable_n = 0
    for r in RULE_CATALOG:
        cfg = cfg_map.get(r["id"])
        en = effective_enabled(r, cfg)
        is_runnable = r["status"] == RUNNABLE
        if is_runnable:
            runnable_n += 1
        if en and is_runnable:
            enabled_n += 1
        domains.setdefault(r["domain"], []).append({
            "id": r["id"], "name": r["name"],
            "severity": (cfg.severity if cfg and cfg.severity else r["severity"]),
            "status": r["status"], "reads": r["reads"], "trips": r["trips"],
            "regulation": r["regulation"], "runnable": is_runnable, "enabled": en,
        })
    return {
        "summary": {"total": len(RULE_CATALOG), "runnable": runnable_n, "enabled_active": enabled_n},
        "domains": [{"domain": d, "rules": domains[d]} for d in domain_order()],
    }
