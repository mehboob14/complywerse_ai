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

from sqlalchemy import or_
from sqlalchemy.orm import Session

from ...models import (
    AccessReviewFinding,
    AccessReviewItem,
    GRCUser,
    Role,
    SoDRule,
    UserRole,
)

STALE_DAYS = 90
RECERT_DAYS = 365          # a year between certifications of the same identity
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
    # A key or a database user has no sign-in by nature; flagging every one of
    # them as "no sign-in on record" would bury the people who really are dormant.
    if _is_cloud_account(item) or _is_db_account(item):
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


PERSON, CLOUD_CREDENTIAL, DB_ACCOUNT, SERVICE_ACCOUNT = "person", "cloud_credential", "db_account", "service_account"


def account_kind(item: AccessReviewItem) -> str:
    """What sort of identity a row is. Connectors synthesise an address for what is
    not a person: DigitalOcean's keys and tokens end `.do` (its database users
    `.db.<team>.do`), the database connector's accounts end `.db`, PAM accounts `.pam`."""
    email = (item.email or "").lower()
    if email.endswith(".do"):
        return DB_ACCOUNT if ".db." in email else CLOUD_CREDENTIAL
    if email.endswith(".db"):
        return DB_ACCOUNT
    if email.endswith(".pam"):
        return SERVICE_ACCOUNT
    return PERSON


def _is_db_account(item: AccessReviewItem) -> bool:
    return account_kind(item) == DB_ACCOUNT


def _is_cloud_account(item: AccessReviewItem) -> bool:
    """A cloud credential rather than a person: a key or a token."""
    return account_kind(item) == CLOUD_CREDENTIAL


def _item_role_names(item: AccessReviewItem) -> set:
    return set(item.roles_snapshot or [])


def _chk_db_super(item: AccessReviewItem, ctx: Dict[str, Any]) -> List[Finding]:
    # "DB Superuser" is the database connector's word; DigitalOcean's admin role is "primary".
    if _is_db_account(item) and any(
            r == "DB Superuser" or "admin (primary)" in r.lower() for r in _item_role_names(item)):
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


# ---- Cloud (DigitalOcean today; any source that names cloud credentials) ----
_OLD_KEY_MARK = "older than"


def _chk_cloud_wildcard(item: AccessReviewItem, ctx: Dict[str, Any]) -> List[Finding]:
    """A credential with no scope at all — the cloud equivalent of *:*."""
    if not _is_cloud_account(item):
        return []
    hits = [r for r in _item_role_names(item)
            if "full access" in r.lower() or "read-write" in r.lower()]
    if hits:
        return [{"finding_type": "cloud_wildcard", "severity": "critical",
                 "title": "Unscoped cloud credential",
                 "detail": f"{item.email} holds \"{sorted(hits)[0]}\" — no bucket or scope limit. "
                           "Confirm it needs everything, or re-issue it scoped."}]
    return []


def _chk_cloud_key_age(item: AccessReviewItem, ctx: Dict[str, Any]) -> List[Finding]:
    """The key's age is banded at sync time and carried as an entitlement, so
    the reviewer sees it in the roles column as well."""
    if not _is_cloud_account(item):
        return []
    old = [r for r in _item_role_names(item) if _OLD_KEY_MARK in r.lower()]
    if old:
        return [{"finding_type": "cloud_stale_key", "severity": "high",
                 "title": "Long-lived cloud key",
                 "detail": f"{item.email} was issued more than 90 days ago and has not been rotated."}]
    return []


_GUEST_WORDS = ("guest", "external", "collaborator", "outside", "contractor")
_INVITE_WORDS = ("invitation pending", "pending", "invited", "not accepted")
_CODE_PLATFORMS = ("github", "gitlab", "bitbucket", "azure devops")


def _chk_guest_access(item: AccessReviewItem, ctx: Dict[str, Any]) -> List[Finding]:
    """Somebody outside the organisation holding standing access."""
    hits = [r for r in _item_role_names(item) if any(w in r.lower() for w in _GUEST_WORDS)]
    if hits and item.account_enabled:
        return [{"finding_type": "guest_access", "severity": "high",
                 "title": "External / guest standing access",
                 "detail": f"{item.email} holds \"{sorted(hits)[0]}\" — a guest or external identity with "
                           "standing access. Confirm it is still needed and time-bound."}]
    return []


def _chk_repo_admin(item: AccessReviewItem, ctx: Dict[str, Any]) -> List[Finding]:
    """Admin or owner of a code platform, where a change reaches production."""
    hits = [r for r in _item_role_names(item)
            if any(p in r.lower() for p in _CODE_PLATFORMS)
            and any(w in r.lower() for w in ("admin", "owner", "maintainer", "50", "40"))]
    if hits:
        return [{"finding_type": "repo_admin", "severity": "high",
                 "title": "Standing repository / organisation admin",
                 "detail": f"{item.email} holds \"{sorted(hits)[0]}\". Admin of the code platform can change "
                           "what ships; confirm it is required."}]
    return []


def _chk_priv_no_mfa(item: AccessReviewItem, ctx: Dict[str, Any]) -> List[Finding]:
    """The combination auditors ask about first."""
    if item.is_privileged and item.account_enabled and item.mfa_enabled is False:
        return [{"finding_type": "privileged_no_mfa", "severity": "critical",
                 "title": "Privileged access without MFA",
                 "detail": f"{item.email} holds privileged access and has no registered MFA."}]
    return []


def _chk_pending_invite(item: AccessReviewItem, ctx: Dict[str, Any]) -> List[Finding]:
    """A seat granted and never taken up is access nobody is accountable for."""
    hits = [r for r in _item_role_names(item) if any(w in r.lower() for w in _INVITE_WORDS)]
    if hits:
        return [{"finding_type": "pending_invite", "severity": "low",
                 "title": "Invitation never accepted",
                 "detail": f"{item.email} was invited but never accepted. Withdraw it if it is no longer needed."}]
    return []


def _chk_recert_overdue(item: AccessReviewItem, ctx: Dict[str, Any]) -> List[Finding]:
    """Certified once, but not since — the recertification has lapsed. Somebody
    never certified before isn't overdue; this review is their first."""
    last = ctx["last_certified"].get(item.user_id)
    if last and last < ctx["now"] - timedelta(days=RECERT_DAYS):
        days = (ctx["now"] - last).days
        return [{"finding_type": "recert_overdue", "severity": "medium",
                 "title": "Recertification overdue",
                 "detail": f"{item.email} was last certified {days} days ago, beyond the {RECERT_DAYS}-day cycle."}]
    return []


def _chk_cloud_orphan(item: AccessReviewItem, ctx: Dict[str, Any]) -> List[Finding]:
    """A cloud credential named after somebody who has left."""
    if not _is_cloud_account(item) or not item.account_enabled:
        return []
    local = (item.email or "").split("@")[0].lower()
    leaver = next((t for t in local.split("-") if len(t) > 3 and t in ctx["terminated_locals"]), None)
    if leaver:
        return [{"finding_type": "cloud_orphan", "severity": "high",
                 "title": "Cloud credential for a terminated user",
                 "detail": f"{item.email} is named after '{leaver}', who has a termination date, "
                           "but the credential is still live."}]
    return []


def _rule(id, domain, name, severity, status, reads, trips, regulation, check=None, default=None, scf=()):
    return {
        "id": id, "domain": domain, "name": name, "severity": severity,
        "kind": "identity",
        "status": status, "reads": reads, "trips": trips, "regulation": regulation,
        # SCF control ids this rule evidences. The tenant's own crosswalk turns
        # them into whichever frameworks they hold — ISO 27001, SOC 2, PCI DSS,
        # NCA ECC, SAMA — so a rule doesn't need a mapping per framework.
        "scf": tuple(scf),
        "check": check,
        # runnable rules default ON; the rest default OFF (can't run anyway).
        "default_enabled": (status == RUNNABLE) if default is None else default,
        # Which sort of identity it can judge (None = any), the facts it needs
        # about that identity, and the sources that can supply them (None = any).
        "kinds": None, "needs": (), "sources": None,
    }


# --------------------------------------------------------------------------- #
# THE CATALOG. Runnable rules carry a check; the rest are metadata-only so the #
# Rule Library shows the full auditor catalog with the reason each is blocked. #
# --------------------------------------------------------------------------- #
RULE_CATALOG: List[Dict[str, Any]] = [
    # ---- Identity lifecycle ----
    _rule("IDM-01", "Identity lifecycle", "Terminated still active", "critical", RUNNABLE,
          "HR termination + account status", "termination date set AND account still enabled", "SOX·SAMA", _chk_ghost, scf=("IAC-07.2", "IAC-15")),
    _rule("IDM-02", "Identity lifecycle", "Role kept after transfer (mover)", "high", NEEDS_DATA,
          "department-change history", "dept changed AND old-dept role still held", "SOX", scf=("IAC-07.1", "IAC-17")),
    _rule("IDM-03", "Identity lifecycle", "Orphan account", "high", NEEDS_DATA,
          "account ↔ HR identity link", "account has no matching active employee", "SOX·PCI", scf=("IAC-15", "IAC-07")),
    _rule("IDM-04", "Identity lifecycle", "Dormant access", "medium", RUNNABLE,
          "last sign-in", "no sign-in > 90 days (or never)", "SOX", _chk_stale, scf=("IAC-15.3", "IAC-17")),
    # ---- Authentication ----
    _rule("AUTH-01", "Authentication", "No MFA", "high", RUNNABLE,
          "mfa_enabled", "active account AND no MFA registered", "PCI·SAMA", _chk_mfa, scf=("IAC-06",)),
    _rule("AUTH-02", "Authentication", "Shared / generic account", "high", RUNNABLE,
          "account naming", "account not tied to one named person", "SOX·PCI", _chk_shared, scf=("IAC-15.5", "IAC-09")),
    _rule("AUTH-04", "Authentication", "Invitation never accepted", "low", RUNNABLE,
          "invitation status", "a seat was granted and never taken up", "SOX",
          _chk_pending_invite, scf=("IAC-15", "IAC-07")),
    _rule("AUTH-03", "Authentication", "SSO not enforced", "medium", NEEDS_DATA,
          "per-user auth method", "local password login on an SSO-capable app", "—", scf=("IAC-02", "IAC-06")),
    # ---- Privilege & SoD ----
    _rule("PRIV-01", "Privilege & SoD", "Over-privileged", "high", RUNNABLE,
          "roles + department", "privileged role outside IT/Security", "SOX", _chk_over_priv, scf=("IAC-21", "IAC-16")),
    _rule("PRIV-02", "Privilege & SoD", "SoD toxic combo", "high", RUNNABLE,
          "role pairs vs SoD rules", "holds both roles of a forbidden pair", "SOX·SAMA", _chk_sod, scf=("HRS-11", "IAC-21")),
    _rule("PRIV-03", "Privilege & SoD", "Standing admin (no JIT)", "medium", NEEDS_DATA,
          "assignment type", "permanent privileged role, not time-bound", "—", scf=("IAC-16", "IAC-21")),
    _rule("PRIV-05", "Privilege & SoD", "Privileged access without MFA", "critical", RUNNABLE,
          "privileged roles + MFA status", "holds privileged access AND no MFA registered", "SOX·PCI·SAMA",
          _chk_priv_no_mfa, scf=("IAC-06.1", "IAC-16")),
    _rule("PRIV-04", "Privilege & SoD", "Privilege creep", "medium", RUNNABLE,
          "role count vs peers", "roles accumulated well beyond peer average", "SOX", _chk_creep, scf=("IAC-17", "IAC-21")),
    # ---- Authorization ----
    _rule("APRV-01", "Authorization", "No recorded approval", "low", RUNNABLE,
          "role assignment approver/source", "held role with no approver or source", "SOX", _chk_no_approval, scf=("IAC-07", "IAC-15")),
    # ---- Network devices (needs connector) ----
    _rule("NET-01", "Network devices", "Default / shared device creds", "critical", NEEDS_CONNECTOR,
          "device local accounts", "default or shared admin present", "PCI", scf=("IAC-15.5", "IAC-10")),
    _rule("NET-02", "Network devices", "Not via TACACS+/RADIUS", "high", NEEDS_CONNECTOR,
          "device AAA config", "local admin auth, not centralized", "PCI", scf=("IAC-02", "IAC-20")),
    _rule("NET-03", "Network devices", "No MFA on network admin", "high", NEEDS_CONNECTOR,
          "admin access method", "privileged device access without MFA", "PCI", scf=("IAC-06.1", "IAC-16")),
    _rule("NET-04", "Network devices", "Firewall any-any rule", "high", NEEDS_CONNECTOR,
          "firewall ruleset", "overly broad allow rule", "PCI", scf=("NET-04.1", "IAC-20")),
    # ---- DevOps / CI-CD ----
    _rule("DEV-01", "DevOps / CI-CD", "Secrets in repo", "critical", NEEDS_CONNECTOR,
          "repo content scan", "hardcoded key/secret found", "PCI·SOX", scf=("TDA-20", "IAC-10")),
    _rule("DEV-02", "DevOps / CI-CD", "Standing repo / org admin", "high", RUNNABLE,
          "repo org roles", "permanent owner/admin", "SOX", _chk_repo_admin, scf=("IAC-16", "TDA-20")),
    _rule("DEV-03", "DevOps / CI-CD", "Long-lived token", "high", NEEDS_CONNECTOR,
          "PATs / service tokens", "token without expiry or rotation", "PCI", scf=("IAC-10", "CRY-09")),
    _rule("DEV-04", "DevOps / CI-CD", "Dev has prod deploy", "high", NEEDS_CONNECTOR,
          "pipeline / prod roles", "developer holds prod deploy rights", "SOX", scf=("HRS-11", "IAC-21")),
    # ---- Databases (RUNNABLE once a Tier-3 Database connector is synced) ----
    _rule("DB-01", "Databases", "Database superuser (DBA)", "critical", RUNNABLE,
          "DB roles", "account holds DB superuser", "SOX", _chk_db_super, scf=("IAC-16", "IAC-21")),
    _rule("DB-02", "Databases", "Default / shared DB account", "high", RUNNABLE,
          "DB account name", "default account (postgres/sa/root…) can log in", "PCI", _chk_db_default, scf=("IAC-15.5", "IAC-10")),
    _rule("DB-03", "Databases", "Direct prod / PII access", "high", NEEDS_CONNECTOR,
          "table grants", "direct read on sensitive tables, bypassing app", "GDPR·PCI", scf=("AST-28", "IAC-20")),
    _rule("DB-04", "Databases", "GRANT ALL / public role", "high", NEEDS_CONNECTOR,
          "privilege grants", "excessive grant or public-role privileges", "SOX", scf=("IAC-21", "AST-28")),
    # ---- Cloud ----
    _rule("CLD-01", "Cloud", "Root used / no MFA on root", "critical", NEEDS_CONNECTOR,
          "root activity + MFA", "root login OR root MFA off", "SOX·PCI", scf=("IAC-06", "IAC-16")),
    _rule("CLD-02", "Cloud", "Wildcard IAM policy", "critical", RUNNABLE,
          "cloud credentials + their scope", "a credential with no bucket or scope limit", "SOX",
          _chk_cloud_wildcard, scf=("IAC-21", "IAC-20")),
    _rule("CLD-03", "Cloud", "Long-lived access key", "high", RUNNABLE,
          "access keys + age", "key not rotated > 90 days", "PCI", _chk_cloud_key_age, scf=("IAC-10", "IAC-15")),
    _rule("CLD-04", "Cloud", "Public storage / open SG", "high", NEEDS_CONNECTOR,
          "bucket ACL + security groups", "public bucket OR 0.0.0.0/0 ingress", "PCI·GDPR", scf=("NET-04.1", "IAC-20")),
    _rule("CLD-05", "Cloud", "Orphaned cloud user", "high", RUNNABLE,
          "cloud users ↔ HR", "active cloud user for a leaver", "SOX", _chk_cloud_orphan, scf=("IAC-07.2", "IAC-15.3")),
    # ---- Finance ERP ----
    _rule("ERP-01", "Finance ERP", "SoD: create vendor + run payment", "critical", NEEDS_CONNECTOR,
          "ERP roles", "same user holds both entitlements", "SOX·SAMA", scf=("HRS-11", "IAC-21")),
    _rule("ERP-02", "Finance ERP", "SoD: post + approve journal", "critical", NEEDS_CONNECTOR,
          "ERP roles", "same user posts AND approves", "SOX", scf=("HRS-11", "IAC-21")),
    _rule("ERP-03", "Finance ERP", "SAP_ALL / super-user profile", "critical", NEEDS_CONNECTOR,
          "profiles", "SAP_ALL or equivalent assigned", "SOX", scf=("IAC-16", "IAC-21")),
    _rule("ERP-04", "Finance ERP", "Firefighter not logged", "high", NEEDS_CONNECTOR,
          "emergency-access logs", "firefighter use without log/justification", "SOX·SAMA", scf=("IAC-16", "IAC-17")),
    _rule("ERP-05", "Finance ERP", "Powerful t-code to non-finance", "high", NEEDS_CONNECTOR,
          "t-code assignments", "sensitive t-code held by non-finance user", "SOX", scf=("IAC-21", "IAC-08")),
    _rule("ERP-06", "Finance ERP", "Maker-checker not enforced", "high", NEEDS_CONNECTOR,
          "workflow config", "same user can initiate AND approve", "SAMA", scf=("HRS-11", "IAC-07")),
    # ---- Privileged access (PAM) ----
    _rule("PAM-01", "Privileged access (PAM)", "Standing privileged, not vaulted", "high", NEEDS_CONNECTOR,
          "privileged accounts vs vault", "privileged account not under PAM", "PCI", scf=("IAC-16", "IAC-16.4")),
    _rule("PAM-02", "Privileged access (PAM)", "Shared admin password", "high", NEEDS_CONNECTOR,
          "shared-cred inventory", "admin password shared across people", "PCI", scf=("IAC-15.5", "IAC-10")),
    _rule("PAM-03", "Privileged access (PAM)", "Break-glass w/o justification", "high", NEEDS_CONNECTOR,
          "break-glass usage logs", "used without ticket/justification", "SOX", scf=("IAC-16", "IAC-17")),
    # ---- OS / servers ----
    _rule("OS-01", "OS / servers", "Domain admin sprawl", "critical", NEEDS_CONNECTOR,
          "domain admin group", "excessive domain-admin members", "SOX", scf=("IAC-16", "IAC-21")),
    _rule("OS-02", "OS / servers", "Local root/admin not centralized", "high", NEEDS_CONNECTOR,
          "server local admins", "local admin not via central IdM", "SOX", scf=("IAC-16", "IAC-15")),
    # ---- SaaS / data ----
    _rule("SAAS-01", "SaaS / data", "External / guest standing access", "high", RUNNABLE,
          "guest users", "external user with persistent access", "GDPR", _chk_guest_access, scf=("IAC-03", "IAC-17")),
    _rule("SAAS-02", "SaaS / data", "Over-shared sensitive files", "medium", NEEDS_CONNECTOR,
          "sharing settings", "sensitive file shared broadly/public", "GDPR", scf=("IAC-20", "IAC-21")),
    # ---- Cross-system & approval ----
    _rule("XSYS-01", "Cross-system & approval", "Toxic cross-system combo", "high", NEEDS_CONNECTOR,
          "roles across systems", "e.g. AD admin AND DB admin together", "SOX", scf=("HRS-11", "IAC-21")),
    _rule("XSYS-02", "Cross-system & approval", "Requester = approver", "high", NEEDS_DATA,
          "request + approval records", "same person requested AND approved", "SOX·SAMA", scf=("HRS-11", "IAC-07")),
    _rule("XSYS-03", "Cross-system & approval", "Terminated active anywhere", "critical", NEEDS_CONNECTOR,
          "all systems + HR", "leaver still active in ANY connected system", "SOX·SAMA", scf=("IAC-07.2", "IAC-15.3")),
    _rule("CERT-01", "Cross-system & approval", "Recertification overdue", "medium", RUNNABLE,
          "last certification date", "access not recertified within the cycle", "SOX", _chk_recert_overdue, scf=("IAC-17",)),
]

# What each runnable rule can judge. A rule is not "passed" by an identity it cannot
# judge: MFA is a fact about a person, not about a storage key, and a source that
# never reports sign-ins cannot show that somebody has stopped signing in.
_PEOPLE = (PERSON,)
_APPLIES: Dict[str, Dict[str, Any]] = {
    "IDM-01": {"kinds": _PEOPLE},
    "IDM-04": {"kinds": _PEOPLE, "needs": ("last_sign_in",)},
    "AUTH-01": {"kinds": _PEOPLE, "needs": ("mfa_enabled",)},
    "AUTH-02": {"kinds": _PEOPLE},
    "AUTH-04": {"kinds": _PEOPLE},
    "PRIV-01": {"kinds": _PEOPLE},
    "PRIV-02": {"kinds": _PEOPLE},
    "PRIV-04": {"kinds": _PEOPLE},
    "PRIV-05": {"kinds": _PEOPLE, "needs": ("mfa_enabled",)},
    "APRV-01": {"kinds": _PEOPLE},
    "DEV-02": {"kinds": _PEOPLE, "sources": ("github", "gitlab", "bitbucket", "azure_devops")},
    "DB-01": {"kinds": (DB_ACCOUNT,), "sources": ("database", "digitalocean")},
    "DB-02": {"kinds": (DB_ACCOUNT,), "sources": ("database", "digitalocean")},
    "CLD-02": {"kinds": (CLOUD_CREDENTIAL,), "sources": ("digitalocean", "aws")},
    "CLD-03": {"kinds": (CLOUD_CREDENTIAL,), "sources": ("digitalocean", "aws")},
    "CLD-05": {"kinds": (CLOUD_CREDENTIAL,), "sources": ("digitalocean", "aws")},
    "SAAS-01": {"kinds": _PEOPLE},
}
for _rid, _extra in _APPLIES.items():
    _r = next((x for x in RULE_CATALOG if x["id"] == _rid), None)
    if _r is not None:
        _r.update(_extra)

CATALOG_BY_ID = {r["id"]: r for r in RULE_CATALOG}

# Sources that never report a sign-in time: an empty "last sign-in" says nothing about them.
NO_SIGN_IN_SOURCES = {"digitalocean"}
_MISSING = {
    "mfa_enabled": "The source does not report MFA status for this account.",
    "last_sign_in": "The source does not report sign-ins for this account.",
}
_KIND_NOUN = {PERSON: "people", CLOUD_CREDENTIAL: "cloud keys and tokens",
              DB_ACCOUNT: "database accounts", SERVICE_ACCOUNT: "service accounts"}
_KIND_ONE = {PERSON: "a person", CLOUD_CREDENTIAL: "a cloud key or token",
             DB_ACCOUNT: "a database account", SERVICE_ACCOUNT: "a service account"}


def item_sources(item: AccessReviewItem) -> set:
    """The systems that granted this identity something."""
    return {g.get("source") for g in (item.access_snapshot or []) if isinstance(g, dict) and g.get("source")}


def applicability(rule: Dict[str, Any], item: AccessReviewItem) -> Optional[tuple]:
    """None when the rule can judge this identity. Otherwise (status, reason):
    `not_applicable` (it judges another sort of account) or `not_run` (the source
    does not supply what it needs)."""
    kinds = rule.get("kinds")
    kind = account_kind(item)
    if kinds and kind not in kinds:
        wants = " and ".join(_KIND_NOUN.get(k, k) for k in kinds)
        return "not_applicable", f"This rule judges {wants}; this is {_KIND_ONE.get(kind, kind)}."
    for need in rule.get("needs") or ():
        if need == "mfa_enabled" and item.mfa_enabled is None:
            return "not_run", _MISSING[need]
        if need == "last_sign_in" and item.last_sign_in is None:
            sources = item_sources(item)
            if sources and sources <= NO_SIGN_IN_SOURCES:
                return "not_run", _MISSING[need]
    return None


def domain_order() -> List[str]:
    seen, out = set(), []
    for r in RULE_CATALOG:
        if r["domain"] not in seen:
            seen.add(r["domain"]); out.append(r["domain"])
    try:
        from . import connector_rules
        for r in connector_rules.all_rules():
            if r.domain not in seen:
                seen.add(r.domain); out.append(r.domain)
    except Exception:  # noqa: BLE001 — the library still lists the identity rules
        pass
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

    # Local-parts of everybody with a termination date — CLD-05 matches cloud
    # credentials named after a leaver.
    terminated_locals = {
        (email or "").split("@")[0].lower()
        for (email,) in tenant_db.query(GRCUser.email)
        .filter(GRCUser.termination_date.isnot(None)).all()
        if email
    }

    # When each identity was last certified — a closed campaign that decided on
    # them. CERT-01 only calls a lapsed cycle overdue, never a first review.
    last_certified: Dict[int, datetime] = {}
    try:
        from ...models import AccessReviewCampaign
        rows = (
            tenant_db.query(AccessReviewItem.user_id, AccessReviewItem.decision_at)
            .join(AccessReviewCampaign, AccessReviewCampaign.id == AccessReviewItem.campaign_id)
            .filter(AccessReviewCampaign.tenant_id == tenant_id,
                    AccessReviewCampaign.status == "completed",
                    AccessReviewItem.decision_at.isnot(None))
            .all()
        )
        for user_id, decided in rows:
            if user_id and (user_id not in last_certified or decided > last_certified[user_id]):
                last_certified[user_id] = decided
    except Exception:  # noqa: BLE001 — history is a nicety, never a blocker
        last_certified = {}

    return {
        "now": datetime.utcnow(),
        "terminated_locals": terminated_locals,
        "last_certified": last_certified,
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


# Frameworks worth naming first when a rule maps to dozens of them.
_HEADLINE_FRAMEWORKS = (
    "iso_27001_2022", "aicpa_tsc_soc2", "pci_dss_401",
    "emea_saudi_arabia_ecc_1_2018",      # NCA ECC
    "sama_csf_2017", "emea_saudi_arabia_pdpl",
    "nist_csf_20", "eu_gdpr_2016", "cis_csc_81",
)
_MAX_CODES_PER_FRAMEWORK = 4


def framework_refs(tenant_db: Session, scf_ids: List[str], limit: int = 6) -> Dict[str, Any]:
    """The tenant's own frameworks that these SCF controls satisfy.

    The platform already holds the SCF crosswalk, so a rule states the SCF
    controls it evidences once and every framework the tenant has — ISO 27001,
    SOC 2, PCI DSS, NCA ECC, SAMA — falls out of their own mapping table. No
    per-framework rule list to maintain.
    """
    if not scf_ids:
        return {"frameworks": [], "total": 0}
    from ...models import SCFMapping, SCFSource
    try:
        rows = (
            tenant_db.query(SCFSource.source_slug, SCFSource.display_name, SCFMapping.requirement_code)
            .join(SCFMapping, SCFMapping.source_slug == SCFSource.source_slug)
            .filter(SCFMapping.scf_id.in_(list(scf_ids)))
            .distinct()
            .all()
        )
    except Exception:  # noqa: BLE001 — a tenant without the crosswalk just shows none
        return {"frameworks": [], "total": 0}

    grouped = _group_frameworks([(slug, name, code) for slug, name, code in rows], limit)
    return {"frameworks": grouped["frameworks"], "total": grouped["total"]}


def enabled_rules(tenant_db: Session, tenant_id: int, cfg_map: Optional[Dict[str, Any]] = None,
                  with_frameworks: bool = False) -> List[Dict[str, Any]]:
    """The rules a review actually runs — what every sampled identity is tested
    against, so the result can say which passed as well as which failed.
    `with_frameworks` attaches the tenant's framework controls each evidences."""
    if cfg_map is None:
        from ...models import AccessReviewRuleConfig
        cfg_map = {
            c.rule_id: c
            for c in tenant_db.query(AccessReviewRuleConfig)
            .filter(AccessReviewRuleConfig.tenant_id == tenant_id).all()
        }
    active = [r for r in RULE_CATALOG
              if r["check"] is not None and effective_enabled(r, cfg_map.get(r["id"]))]
    if not with_frameworks:
        return active
    return [{**r, **{"frameworks": (refs := framework_refs(tenant_db, list(r.get("scf") or ())))["frameworks"],
                     "frameworks_total": refs["total"]}} for r in active]


# What a review can run: every rule enabled in the library, the rules that evidence
# one framework, or a set a person picked — in each case the rules of the source it
# is scoped to (or of every connected source).
RULE_SCOPES = ("enabled", "framework", "custom")


def _configs(tenant_db: Session, tenant_id: int) -> Dict[str, Any]:
    from ...models import AccessReviewRuleConfig
    return {c.rule_id: c for c in tenant_db.query(AccessReviewRuleConfig)
            .filter(AccessReviewRuleConfig.tenant_id == tenant_id).all()}


def rule_def(rule_id: str) -> Optional[Dict[str, Any]]:
    """A rule of either kind as one dict, so the library, the picker and the report treat them alike."""
    r = CATALOG_BY_ID.get(rule_id)
    if r is not None:
        return r
    from . import connector_rules as cr
    c = cr.rule(rule_id)
    if c is None:
        return None
    return {"id": c.id, "kind": "connector", "connector": c.connector, "domain": c.domain, "name": c.name,
            "severity": c.severity, "status": RUNNABLE, "reads": c.reads, "trips": c.trips,
            "regulation": "—", "scf": tuple(c.scf), "check": None, "default_enabled": True,
            "kinds": None, "needs": (), "sources": (c.connector,), "fix": c.fix}


def applies_to_source(rule: Dict[str, Any], source: Optional[str]) -> bool:
    """Can a review of `source` (None = every source) run this rule at all?"""
    sources = rule.get("sources")
    return not source or not sources or source in sources


def connector_rule_defs(tenant_db: Session, tenant_id: int, source: Optional[str] = None) -> List[Dict[str, Any]]:
    """The connector rules a review of `source` can run — or, with no source, those of
    every connector that has a credential on file."""
    from . import connector_rules as cr
    out: List[Dict[str, Any]] = []
    for pack in cr.packs().values():
        if source and pack.connector != source:
            continue
        if not source and not cr.connected(tenant_db, tenant_id, pack.connector):
            continue
        out.extend(rule_def(r.id) for r in pack.rules)
    return out


def _can_run(rule_id: str) -> bool:
    r = rule_def(rule_id)
    return bool(r) and (r.get("kind") == "connector" or r.get("check") is not None)


def framework_rule_ids(tenant_db: Session, framework: str, tenant_id: Optional[int] = None,
                       source: Optional[str] = None) -> List[str]:
    """The rules that can run and evidence one framework in the tenant's crosswalk,
    for `source` (None = every connected source)."""
    pool = [r for r in RULE_CATALOG if r["check"] is not None and applies_to_source(r, source)]
    pool += connector_rule_defs(tenant_db, tenant_id, source) if tenant_id is not None else []
    crosswalk = _crosswalk(tenant_db, sorted({c for r in pool for c in (r.get("scf") or ())}))
    return [r["id"] for r in pool
            if framework in {slug for scf_id in (r.get("scf") or ()) for slug, _n, _c in crosswalk.get(scf_id, ())}]


def resolve_rule_ids(tenant_db: Session, tenant_id: int, scope: Optional[str], framework: Optional[str] = None,
                     rule_ids: Optional[List[str]] = None, source: Optional[str] = None) -> List[str]:
    """The rule ids a review of this scope runs, as the catalog stands today."""
    if scope == "framework" and framework:
        return framework_rule_ids(tenant_db, framework, tenant_id, source)
    if scope == "custom":
        return [rid for rid in dict.fromkeys(rule_ids or []) if _can_run(rid)]
    cfg_map = _configs(tenant_db, tenant_id)
    ids = [r["id"] for r in enabled_rules(tenant_db, tenant_id, cfg_map) if applies_to_source(r, source)]
    ids += [r["id"] for r in connector_rule_defs(tenant_db, tenant_id, source)
            if effective_enabled(r, cfg_map.get(r["id"]))]
    return ids


def rules_with_frameworks(tenant_db: Session, tenant_id: int, rule_ids: List[str],
                          prefer: Optional[str] = None) -> List[Dict[str, Any]]:
    """These rules as a review reports them: the tenant's severity, and the frameworks
    each evidences — the review's own framework first."""
    cfg_map = _configs(tenant_db, tenant_id)
    rules = [d for d in (rule_def(i) for i in rule_ids) if d]
    crosswalk = _crosswalk(tenant_db, sorted({c for r in rules for c in (r.get("scf") or ())}))
    out = []
    for r in rules:
        pairs = [p for scf_id in (r.get("scf") or ()) for p in crosswalk.get(scf_id, ())]
        refs = _group_frameworks(pairs, limit=6, prefer=prefer)
        cfg = cfg_map.get(r["id"])
        out.append({**r, "severity": (cfg.severity if cfg and cfg.severity else r["severity"]),
                    "frameworks": refs["frameworks"], "frameworks_total": refs["total"]})
    return out


# ---- what each rule found ------------------------------------------------- #
def item_rule_results(item: AccessReviewItem, findings: List[Any], rules: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Every identity rule this identity was tested against: pass, fail — or, when the
    rule cannot judge it, not_applicable / not_run with the reason. A review that only
    lists failures cannot show what was checked."""
    failed = {f.rule_id: f for f in findings if f.rule_id}
    out = []
    for rule in rules:
        if rule.get("kind") == "connector":
            continue
        hit = failed.get(rule["id"])
        skip = None if hit else applicability(rule, item)
        out.append({
            "id": rule["id"], "name": rule["name"], "domain": rule["domain"],
            "severity": (hit.severity if hit else rule["severity"]),
            "regulation": rule.get("regulation"),
            "status": "fail" if hit else (skip[0] if skip else "pass"),
            "detail": hit.detail if hit else (skip[1] if skip else None),
        })
    return out


_STATUS_ORDER = {"fail": 0, "not_run": 1, "error": 1, "pass": 2, "not_applicable": 3}


def identity_rule_results(items: List[AccessReviewItem], findings_by_item: Dict[int, List[Any]],
                          rules: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Each identity rule over the whole sample: how many identities it could judge,
    how many failed, and how many it could not judge (and why). A rule that judged
    nobody is not_applicable / not_run — never a pass."""
    out = []
    for rule in rules:
        if rule.get("kind") == "connector":
            continue
        tested = failed = n_na = n_not_run = 0
        reasons: Dict[str, int] = {}
        for it in items:
            skip = applicability(rule, it)
            if skip:
                if skip[0] == "not_applicable":
                    n_na += 1
                else:
                    n_not_run += 1
                reasons[skip[1]] = reasons.get(skip[1], 0) + 1
                continue
            tested += 1
            if any(f.rule_id == rule["id"] for f in findings_by_item.get(it.id, [])):
                failed += 1
        if failed:
            status = "fail"
        elif tested:
            status = "pass"
        else:
            status = "not_run" if n_not_run else "not_applicable"
        reason = max(reasons, key=reasons.get) if reasons and not tested else None
        out.append({
            "id": rule["id"], "kind": "identity", "name": rule["name"], "domain": rule["domain"],
            "severity": rule["severity"], "regulation": rule.get("regulation"),
            "reads": rule.get("reads"), "trips": rule.get("trips"),
            "status": status, "reason": reason, "detail": reason,
            "population": len(items), "tested": tested, "failed": failed, "passed": tested - failed,
            "not_applicable": n_na, "not_run": n_not_run,
            "frameworks": rule.get("frameworks") or [], "frameworks_total": rule.get("frameworks_total"),
        })
    return out


def sort_results(results: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Failing first, then what could not be run, then passes, then what did not apply."""
    return sorted(results, key=lambda r: (_STATUS_ORDER.get(r["status"], 4), -(r.get("failed") or 0), r["id"]))


def attach_rule_meta(results: List[Dict[str, Any]], rules: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Today's name, category and framework clauses on each result. The result itself
    (status, counts, severity, failures) stays as it was when the checks ran."""
    by_id = {r["id"]: r for r in rules}
    out = []
    for res in results:
        meta = by_id.get(res["id"]) or {}
        out.append({**res, "name": meta.get("name") or res.get("name"),
                    "domain": meta.get("domain") or res.get("domain"),
                    "severity": res.get("severity") or meta.get("severity"),
                    "frameworks": meta.get("frameworks") or res.get("frameworks") or [],
                    "frameworks_total": meta.get("frameworks_total") or res.get("frameworks_total")})
    return out


def all_rule_results(items: List[AccessReviewItem], findings_by_item: Dict[int, List[Any]],
                     rules: List[Dict[str, Any]], connector_results: Optional[List[Dict[str, Any]]] = None
                     ) -> List[Dict[str, Any]]:
    """The review's whole result: identity rules over the sample, plus what each
    connector rule found."""
    results = identity_rule_results(items, findings_by_item, rules) + list(connector_results or [])
    return sort_results(attach_rule_meta(results, rules))


def run_enabled_rules(tenant_db: Session, *, tenant_id: int, campaign_id: int,
                      items: List[AccessReviewItem], rule_ids: Optional[List[str]] = None) -> int:
    """Clear prior findings, then run the review's rules — `rule_ids`, or every
    ENABLED + RUNNABLE catalog rule — over each sampled item. Returns the total
    number of findings written."""
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

    active = (enabled_rules(tenant_db, tenant_id, cfg_map) if rule_ids is None
              else [CATALOG_BY_ID[i] for i in rule_ids if (CATALOG_BY_ID.get(i) or {}).get("check")])
    sev_override = {rid: c.severity for rid, c in cfg_map.items() if c.severity}

    total = 0
    for item in items:
        for rule in active:
            if applicability(rule, item):
                continue              # a rule cannot find what it cannot judge: no finding, and no "pass" either
            for f in rule["check"](item, ctx):
                tenant_db.add(AccessReviewFinding(
                    tenant_id=tenant_id, campaign_id=campaign_id, item_id=item.id,
                    finding_type=f["finding_type"],
                    severity=sev_override.get(rule["id"]) or f["severity"],
                    title=f["title"], detail=f.get("detail"),
                    sod_rule_id=f.get("sod_rule_id"),
                    rule_id=rule["id"],
                ))
                total += 1
    return total


def _crosswalk(tenant_db: Session, scf_ids: List[str]) -> Dict[str, List[tuple]]:
    """scf id → [(slug, framework name, requirement code)] in one query, so a
    catalog of 48 rules doesn't make 48 round trips."""
    if not scf_ids:
        return {}
    from ...models import SCFMapping, SCFSource
    out: Dict[str, List[tuple]] = {}
    try:
        rows = (
            tenant_db.query(SCFMapping.scf_id, SCFSource.source_slug, SCFSource.display_name,
                            SCFMapping.requirement_code)
            .join(SCFSource, SCFSource.source_slug == SCFMapping.source_slug)
            .filter(SCFMapping.scf_id.in_(scf_ids))
            .filter(or_(SCFMapping.match_mode.is_(None), SCFMapping.match_mode != "parent"))
            .distinct()
            .all()
        )
    except Exception:  # noqa: BLE001 — a tenant without the crosswalk shows none
        return {}
    for scf_id, slug, name, code in rows:
        out.setdefault(scf_id, []).append((slug, name, code))
    return out


def _group_frameworks(pairs: List[tuple], limit: int, prefer: Optional[str] = None) -> Dict[str, Any]:
    by_slug: Dict[str, Dict[str, Any]] = {}
    for slug, name, code in pairs:
        entry = by_slug.setdefault(slug, {"slug": slug, "name": name, "codes": []})
        if code and code not in entry["codes"]:
            entry["codes"].append(code)
    for entry in by_slug.values():
        entry["codes"] = sorted(entry["codes"])[:_MAX_CODES_PER_FRAMEWORK]
    # The framework a review was scoped to comes first, then the headline ones.
    ordered = sorted(by_slug.values(), key=lambda e: (
        e["slug"] != prefer,
        _HEADLINE_FRAMEWORKS.index(e["slug"]) if e["slug"] in _HEADLINE_FRAMEWORKS else 99, e["name"]))
    return {"frameworks": ordered[:limit], "total": len(ordered), "all": ordered}


def _clauses(crosswalk: Dict[str, List[tuple]], framework: str, rules: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """The framework's own requirement clauses these rules evidence, each with the rules that answer it."""
    by_code: Dict[str, List[str]] = {}
    for r in rules:
        for scf_id in (r.get("scf") or ()):
            for slug, _name, code in crosswalk.get(scf_id, ()):
                if slug == framework and code and r["id"] not in by_code.setdefault(code, []):
                    by_code[code].append(r["id"])
    return [{"code": code, "rules": ids} for code, ids in sorted(by_code.items())]


def catalog_view(tenant_db: Session, tenant_id: int, framework: Optional[str] = None,
                 source: Optional[str] = None) -> Dict[str, Any]:
    """The rule library: every rule grouped by category with its effective enabled
    state, for the Rule Library screen and the picker.

    `source` (a connector key) narrows it to what a review of that source can run.
    `framework` (a crosswalk source slug) narrows it to the rules that evidence it,
    each with that framework's own requirement codes, and adds the clauses they cover.
    """
    from . import connector_rules as cr

    cfg_map = _configs(tenant_db, tenant_id)
    packs = cr.packs()
    connected = {key: cr.connected(tenant_db, tenant_id, key) for key in packs}

    # A review of one source is shown what can run on it: the rules that need some
    # other system (SAP, a firewall appliance) are not that source's business.
    pool: List[Dict[str, Any]] = [r for r in RULE_CATALOG
                                  if applies_to_source(r, source) and (not source or r["status"] == RUNNABLE)]
    for pack in packs.values():
        if source and pack.connector != source:
            continue
        pool.extend(rule_def(r.id) for r in pack.rules)
    crosswalk = _crosswalk(tenant_db, sorted({c for r in pool for c in (r.get("scf") or ())}))

    domains: Dict[str, List[Dict[str, Any]]] = {}
    covered: set = set()
    counted: Dict[tuple, Dict[str, int]] = {}
    enabled_n = runnable_n = shown = 0
    shown_rules: List[Dict[str, Any]] = []
    for r in pool:
        cfg = cfg_map.get(r["id"])
        en = effective_enabled(r, cfg)
        is_connector = r.get("kind") == "connector"
        # A connector rule runs once its connector has a credential on file.
        status = (RUNNABLE if connected.get(r["connector"]) else NEEDS_CONNECTOR) if is_connector else r["status"]
        is_runnable = status == RUNNABLE
        pairs = [p for scf_id in (r.get("scf") or ()) for p in crosswalk.get(scf_id, ())]
        refs = _group_frameworks(pairs, limit=6)
        # Counted over the whole pool, framework filter or not: the picker keeps every
        # framework, so choosing one is never a one-way door.
        covered.update(f["slug"] for f in refs["all"])
        for f in refs["all"]:
            c = counted.setdefault((f["slug"], f["name"]), {"rules": 0, "runnable": 0})
            c["rules"] += 1
            c["runnable"] += 1 if is_runnable else 0
        if framework:
            chosen = [f for f in refs["all"] if f["slug"] == framework]
            if not chosen:
                continue                      # this rule says nothing about that framework
            refs = {**refs, "frameworks": chosen, "total": 1}
        label = packs[r["connector"]].label if is_connector else None
        domains.setdefault(r["domain"], []).append({
            "id": r["id"], "kind": r.get("kind", "identity"), "name": r["name"],
            "severity": (cfg.severity if cfg and cfg.severity else r["severity"]),
            "status": status, "reads": r["reads"], "trips": r["trips"],
            "regulation": r["regulation"], "runnable": is_runnable, "enabled": en,
            "connector": r.get("connector") if is_connector else None, "connector_label": label,
            "sources": list(r.get("sources") or []), "fix": r.get("fix"),
            # The tenant's own frameworks this rule evidences.
            "scf": list(r.get("scf") or ()),
            "frameworks": refs["frameworks"], "frameworks_total": refs["total"],
            # every framework it answers to, so the filter can match on any
            "framework_slugs": [f["slug"] for f in refs["all"]],
        })
        shown_rules.append(r)
        shown += 1
        if is_runnable:
            runnable_n += 1
            if en:
                enabled_n += 1
    # Every framework the pool touches, most-covered first — the filter the library
    # offers, drawn from the tenant's own crosswalk rather than a fixed list.
    frameworks = sorted(
        ({"slug": slug, "name": name, **n} for (slug, name), n in counted.items()),
        key=lambda f: (-f["runnable"], -f["rules"], f["name"]),
    )
    return {
        "summary": {"total": shown, "catalog_total": len(pool), "runnable": runnable_n,
                    "enabled_active": enabled_n, "frameworks_covered": len(covered)},
        "framework": framework, "source": source,
        "frameworks": frameworks,
        # the connectors that carry rules of their own, and whether each is connected
        "connectors": [{"key": p.connector, "label": p.label, "connected": connected[p.connector],
                        "rules": len(p.rules), "limits": p.limits} for p in packs.values()],
        "clauses": _clauses(crosswalk, framework, shown_rules) if framework else [],
        "domains": [{"domain": d, "rules": domains.get(d, [])} for d in domain_order()],
    }
