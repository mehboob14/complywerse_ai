"""Classification helpers for parsed CIS rules.

Pulled out of `parse_fields.py` so the policy for picking runner_type,
severity, and confidence_score lives in one well-named module that the
plan (T3) calls out explicitly. `parse_fields.assemble_plugin_fields`
re-exports these via this module to preserve backwards compatibility.
"""
from __future__ import annotations

from typing import Any

def severity_from(level: str | None, body: str) -> str:
    """Heuristic severity: CIS doesn't ship a severity field but level + keywords give us one.

    Enterprise-grade keyword set covers the high-impact CIS categories that
    actually break the security model: identity bypass, plaintext credentials,
    public exposure, lockout/audit bypass, privileged access, anti-malware
    disablement. `body` should include title + description + rationale + audit
    so signals in any of those fields contribute.
    """
    body_l = (body or "").lower()

    # CRITICAL — breaks the security model outright. One match flips to critical.
    critical_kw = (
        "root account", "root access", "root login",
        "multi-factor", "mfa enabled", " mfa ",
        "publicly accessible", "public access", "public read", "public write",
        "anonymous access", "anonymous logon", "anonymous user",
        "unencrypted", "plaintext password", "send unencrypted", "cleartext",
        "lan manager hash", "lm hash", "ntlmv1",
        "smbv1", "smb signing", "smb1 protocol",
        "kerberos preauth", "credential delegation",
        "guest account", "guests group",
        "telnet", "rsh ", "rlogin",
        "bitlocker", "credential guard", "lsa protection",
        "disable security", "disable defender", "disable antivirus",
        "kernel dma protection",
        "elevation prompt", "uac:behavior of the elevation",
    )
    if any(k in body_l for k in critical_kw):
        return "critical"

    # HIGH — privileged or audit-relevant; one match flips to high.
    high_kw = (
        "password policy", "minimum password length", "password complexity",
        "password history", "password age",
        "account lockout", "lockout threshold", "lockout duration",
        "audit policy", "audit failure", "audit success", "logon audit",
        "user account control", "uac",
        "windows defender", "antivirus", "real-time protection",
        "firewall: domain", "firewall: private", "firewall: public",
        "firewall state",
        "windows update",
        "remote desktop", "rdp",
        "winrm", "powershell remoting",
        "log size", "event log",
        "user rights assignment", "deny access",
        "secure channel", "ldap signing",
    )
    if any(k in body_l for k in high_kw):
        return "high"

    # LOW — purely informational (banner text, screen savers, icons, animations).
    low_kw = (
        "screen saver", "screensaver",
        "logon banner", "legal notice",
        "default desktop", "wallpaper",
        "balloon notification", "animation",
        "fast user switching",
        "lock screen background",
    )
    if any(k in body_l for k in low_kw):
        return "low"

    # Profile level signal
    if level and "L1" in level:
        return "high"
    if level and "L2" in level:
        return "medium"
    if "audit" in body_l and "logging" in body_l:
        return "medium"
    return "medium"


def runner_type_from(audit_text: str) -> str:
    """Pick a runner_type from the verbs in the Audit section.

    Default is `linux_ssh` because most CIS benchmarks (Ubuntu, RHEL,
    Debian, Docker) are shell-driven; `aws_readonly` and `windows_winrm`
    are matched on unambiguous markers.
    """
    a = (audit_text or "").lower()
    if " aws " in f" {a} " or "aws iam " in a or "aws ec2 " in a or "aws s3" in a or "boto3" in a:
        return "aws_readonly"
    if (
        "get-itemproperty" in a
        or "winrm" in a
        or "powershell" in a
        or "net accounts" in a
        or "secedit" in a
        or "gpedit" in a
        or "registry" in a and "hkey" in a
    ):
        return "windows_winrm"
    return "linux_ssh"


# Benchmark-name → runner_type. Matched left-to-right; first hit wins.
# Patterns are case-insensitive substring matches against the benchmark slug
# produced by `_infer_benchmark_label` (e.g. "CIS_VISUAL_STUDIO_CODE_GPO_v1.0.0").
#
# Order matters: SaaS / API-driven products are checked BEFORE Windows so
# "Microsoft 365" / "Office 365" are correctly tagged manual instead of
# silently picking up the "MICROSOFT_OFFICE" Windows pattern.
_BENCHMARK_PATTERNS: list[tuple[tuple[str, ...], str]] = [
    # SaaS / API-driven products. There's no "ssh into github" — these
    # benchmarks describe console / API settings that have to be checked
    # by hand or via vendor APIs we don't yet integrate. Tag them
    # `manual` so reviewers can't accidentally schedule them under an
    # SSH or AWS runner that would silently skip everything.
    (
        (
            "GITHUB",
            "GITLAB",
            "BITBUCKET",
            "GOOGLE_WORKSPACE",
            "G_SUITE",
            "OFFICE_365",
            "MICROSOFT_365",
            "M365",
            "AZURE_AD",
            "ENTRA_ID",
            "OKTA",
            "SLACK",
            "ZOOM",
            "SALESFORCE",
            "ATLASSIAN",
            "JIRA",
            "CONFLUENCE",
        ),
        "manual",
    ),
    # Windows GPO / Microsoft desktop & server benchmarks ship as Group Policy
    # checks that are evaluated via PowerShell + registry, not SSH.
    (
        (
            "WINDOWS",
            "GPO",
            "VISUAL_STUDIO_CODE",
            "MICROSOFT_OFFICE",
            "MICROSOFT_EDGE",
            "INTERNET_EXPLORER",
            "SQL_SERVER",
            "EXCHANGE_SERVER",
            "IIS",
            "SHAREPOINT",
        ),
        "windows_winrm",
    ),
    # Cloud providers
    (("AMAZON_WEB_SERVICES", "AWS_", "_AWS"), "aws_readonly"),
    # Linux distros & shell-driven targets
    (
        (
            "UBUNTU",
            "RHEL",
            "RED_HAT",
            "CENTOS",
            "DEBIAN",
            "AMAZON_LINUX",
            "ROCKY",
            "ALMA",
            "ORACLE_LINUX",
            "SUSE",
            "DOCKER",
            "KUBERNETES",
            "APACHE",
            "NGINX",
            "POSTGRESQL",
            "MYSQL",
            "MONGODB",
        ),
        "linux_ssh",
    ),
]


def runner_type_from_benchmark(benchmark: str | None) -> str | None:
    """Infer runner_type from the benchmark slug. Returns None when ambiguous.

    Caller should fall back to :func:`runner_type_from` (audit-text-based)
    when this returns None.
    """
    if not benchmark:
        return None
    b = benchmark.upper()
    for needles, runner in _BENCHMARK_PATTERNS:
        if any(n in b for n in needles):
            return runner
    return None


def runner_type_for(benchmark: str | None, audit_text: str) -> str:
    """Combined classifier: benchmark name first, audit-text fallback.

    The benchmark slug is the strongest signal — a Visual Studio Code GPO
    benchmark is always Windows regardless of how the Audit section is
    worded. We only fall through to the audit-text heuristic when the
    benchmark name doesn't pin a target type (e.g. a generic CIS template
    or a brand-new product CIS hasn't catalogued yet).
    """
    forced = runner_type_from_benchmark(benchmark)
    if forced is not None:
        return forced
    return runner_type_from(audit_text)


def confidence_score(rule: dict[str, Any]) -> float:
    """0..1 — how complete is this extraction?

    Four core sections (Description, Rationale, Audit, Remediation) each
    contribute 0.25; References and CIS Controls add 0.05 each; very
    short titles cost 0.15. Capped to [0, 1].
    """
    secs = rule.get("sections") or {}
    have = 0
    for k in ("Description", "Rationale", "Audit", "Remediation"):
        if (secs.get(k) or "").strip():
            have += 1
    base = have / 4.0
    if (secs.get("References") or "").strip():
        base += 0.05
    if (secs.get("CIS Controls") or "").strip():
        base += 0.05
    if len((rule.get("title") or "")) < 12:
        base -= 0.15
    return max(0.0, min(1.0, base))


__all__ = ["severity_from", "runner_type_from", "confidence_score"]
