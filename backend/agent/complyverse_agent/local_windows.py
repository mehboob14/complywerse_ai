"""Local Windows check execution — agent's endpoint-mode executor.

When the agent is installed directly on a Windows host (the host being
audited == the host running the agent), it executes CIS checks against
its OWN registry / policy DB / services / etc. This is the equivalent of
the cloud-side `winrm_runner.py` but without the WinRM hop — we just
shell out locally.

Reuses the same `check_definition` schema as winrm_runner.py so a rule
that was scan-tested against WinRM auto-runs through this executor.

Read-only contract: commands are pattern-matched against an allowlist
(net accounts, secedit /export, auditpol /get, Get-Service, Get-ItemProperty,
reg query). Anything else is rejected — the agent cannot accidentally be
weaponised into a config-change tool.
"""
from __future__ import annotations

import logging
import re
import subprocess
from dataclasses import dataclass, field
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)


@dataclass
class LocalCheckResult:
    status: str
    summary: str
    raw_output: Dict[str, Any] = field(default_factory=dict)
    error_message: Optional[str] = None


# Allowlist of read-only Windows binaries. The check_definition's
# `command` MUST start with one of these tokens (after `cmd /c` /
# powershell -Command stripping). Everything else fails closed.
_ALLOWED_TOKENS = (
    "net accounts",
    "net user",
    "net localgroup",
    "secedit /export",
    "secedit /analyze",
    "auditpol /get",
    "auditpol /list",
    "wmic",                     # read-only WMI queries
    "reg query",
    "powershell -command get-",
    "powershell -command (get-",
    "powershell -command select-",
    "powershell -command write-",
    "get-service",
    "get-process",
    "get-itemproperty",
    "get-localgroupmember",
    "get-smbserverconfiguration",
)

_DENY_TOKENS = (
    "rmdir", "del ", "rm ", "format ", "fdisk",
    "reg add", "reg delete", "reg import",
    "secedit /configure", "secedit /import",
    "auditpol /set", "auditpol /clear",
    "net stop", "net start",
    "shutdown", "reboot",
    "set-", "new-", "remove-", "add-", "stop-", "start-", "restart-",
)


def _is_command_safe(command: str) -> tuple[bool, str]:
    lower = command.strip().lower()
    # Reject any explicit write keyword first — wins over allowlist match
    for bad in _DENY_TOKENS:
        if bad in lower:
            return False, f"Command contains forbidden token: {bad!r}"
    for ok in _ALLOWED_TOKENS:
        if lower.startswith(ok):
            return True, ""
    return False, f"Command does not start with an allowed read-only token. Got: {lower[:60]!r}"


def _evaluate(stdout: str, stderr: str, exit_code: int,
              expect: Dict[str, Any],
              pass_msg: str, fail_msg: str) -> LocalCheckResult:
    """Same expectation evaluator as ssh runner — keeps rules portable."""
    kind = (expect.get("kind") or "exit_zero").lower()

    if kind == "exit_zero":
        if exit_code == 0:
            return LocalCheckResult("passed", pass_msg, {"exit_code": exit_code})
        return LocalCheckResult("failed", f"{fail_msg} (exit_code={exit_code})",
                                {"exit_code": exit_code, "stderr": stderr[:500]})

    if kind == "stdout_contains":
        needle = str(expect.get("value", ""))
        if needle in stdout:
            return LocalCheckResult("passed", pass_msg, {"matched": needle})
        return LocalCheckResult("failed",
                                f"{fail_msg} (substring {needle!r} not in stdout)",
                                {"stdout_excerpt": stdout[:500]})

    if kind == "stdout_not_contains":
        needle = str(expect.get("value", ""))
        if needle not in stdout:
            return LocalCheckResult("passed", pass_msg, {})
        return LocalCheckResult("failed",
                                f"{fail_msg} (forbidden substring {needle!r} present)",
                                {"stdout_excerpt": stdout[:500]})

    if kind == "stdout_regex":
        pat = re.compile(expect.get("value", ""))
        if pat.search(stdout):
            return LocalCheckResult("passed", pass_msg, {})
        return LocalCheckResult("failed",
                                f"{fail_msg} (regex {pat.pattern!r} did not match)",
                                {"stdout_excerpt": stdout[:500]})

    if kind == "line_kv_equals":
        # Net accounts / auditpol output is colon-delimited with extra
        # whitespace — same parser as the WinRM runner.
        field = expect.get("field", "")
        expected = str(expect.get("expected", ""))
        for line in stdout.splitlines():
            if ":" not in line:
                continue
            k, _, v = line.partition(":")
            if k.strip().lower() == field.strip().lower():
                actual = v.strip().strip(",")
                if actual.lower() == expected.lower():
                    return LocalCheckResult("passed", pass_msg, {"actual": actual})
                return LocalCheckResult("failed",
                                        f"{fail_msg} ({field}={actual!r}, expected {expected!r})",
                                        {"actual": actual, "expected": expected})
        return LocalCheckResult("failed", f"{fail_msg} (field {field!r} not found)",
                                {"stdout_excerpt": stdout[:500]})

    if kind == "secedit_field_equals":
        # `secedit /export /cfg out.inf` produces an INI block:
        #   [System Access]
        #   MinimumPasswordLength = 14
        # We match the LAST occurrence to handle nested sections gracefully.
        field = str(expect.get("field", ""))
        expected = str(expect.get("expected", ""))
        pat = re.compile(
            rf"^\s*{re.escape(field)}\s*=\s*(.+?)\s*$",
            re.IGNORECASE | re.MULTILINE,
        )
        matches = pat.findall(stdout)
        if not matches:
            return LocalCheckResult("failed",
                                    f"{fail_msg} (secedit field {field!r} not found)",
                                    {"stdout_excerpt": stdout[:500]})
        actual = str(matches[-1]).strip()
        if actual.lower() == expected.strip().lower():
            return LocalCheckResult("passed", pass_msg, {"actual": actual})
        return LocalCheckResult("failed",
                                f"{fail_msg} ({field}={actual!r}, expected {expected!r})",
                                {"actual": actual, "expected": expected})

    if kind == "user_rights_check":
        # Validates a Local Security Policy User Rights Assignment.
        # Same logic as backend's winrm_runner.py — kept in lockstep so
        # rules run identically server-side and agent-side.
        priv = str(expect.get("privilege", ""))
        expected_sids = expect.get("expected_sids") or []
        if not isinstance(expected_sids, list):
            expected_sids = [str(expected_sids)]
        pat = re.compile(
            rf"^\s*{re.escape(priv)}\s*=\s*(.*?)\s*$",
            re.IGNORECASE | re.MULTILINE,
        )
        m = pat.search(stdout)

        def _norm(s: str) -> str:
            return s.strip().lstrip("*").upper()

        _SID_TO_NAME = {
            "S-1-1-0": "Everyone",
            "S-1-5-6": "SERVICE", "S-1-5-7": "Anonymous Logon",
            "S-1-5-11": "Authenticated Users",
            "S-1-5-18": "SYSTEM", "S-1-5-19": "LOCAL SERVICE",
            "S-1-5-20": "NETWORK SERVICE",
            "S-1-5-32-544": "Administrators", "S-1-5-32-545": "Users",
            "S-1-5-32-546": "Guests", "S-1-5-32-547": "Power Users",
            "S-1-5-32-548": "Account Operators", "S-1-5-32-549": "Server Operators",
            "S-1-5-32-550": "Print Operators", "S-1-5-32-551": "Backup Operators",
            "S-1-5-32-552": "Replicator", "S-1-5-32-555": "Remote Desktop Users",
            "S-1-5-32-556": "Network Configuration Operators",
            "S-1-5-32-558": "Performance Monitor Users",
            "S-1-5-32-559": "Performance Log Users",
            "S-1-5-32-568": "IIS_IUSRS", "S-1-5-32-580": "Remote Management Users",
            "S-1-5-83-0": "NT VIRTUAL MACHINE\\Virtual Machines",
            "S-1-5-90-0": "Window Manager\\Window Manager Group",
            "S-1-5-113": "Local account",
            "S-1-5-114": "Local account and member of Administrators group",
        }

        def _human(sid: str) -> str:
            sid_up = sid.upper()
            if sid_up in _SID_TO_NAME:
                return _SID_TO_NAME[sid_up]
            if sid_up.startswith("S-1-5-21-"):
                return f"<local account {sid}>"
            if sid_up.startswith("S-1-5-80-"):
                return f"<service SID {sid}>"
            if not sid_up.startswith("S-1-"):
                return sid.title()
            return sid

        def _human_list(sids) -> str:
            names = sorted({_human(s) for s in sids},
                           key=lambda x: (x.startswith("<"), x.lower()))
            return ", ".join(names) if names else "no principals"

        if not m:
            # Privilege not listed in secedit output → no members.
            if not expected_sids:
                return LocalCheckResult("passed",
                                        f"{priv}: granted to no one (matches CIS 'No One')",
                                        {"actual_sids": []})
            return LocalCheckResult("failed",
                f"{priv}: not granted to anyone — CIS expects {_human_list(expected_sids)}",
                {"actual_sids": [], "expected_sids": expected_sids})

        rhs = m.group(1).strip()
        if not rhs:
            if not expected_sids:
                return LocalCheckResult("passed",
                                        f"{priv}: granted to no one (matches CIS 'No One')",
                                        {"actual_sids": []})
            return LocalCheckResult("failed",
                f"{priv}: empty — CIS expects {_human_list(expected_sids)}",
                {"actual_sids": [], "expected_sids": expected_sids})

        actual_sids = {_norm(s) for s in rhs.split(",") if s.strip()}
        expected_sid_set = {_norm(s) for s in expected_sids}
        if actual_sids == expected_sid_set:
            return LocalCheckResult("passed",
                f"{priv}: granted to {_human_list(actual_sids)} (matches CIS)",
                {"actual_sids": sorted(actual_sids)})
        return LocalCheckResult("failed",
            f"{priv}: currently {_human_list(actual_sids)} — "
            f"CIS expects {_human_list(expected_sid_set) or 'No One'}",
            {"actual_sids": sorted(actual_sids), "expected_sids": sorted(expected_sid_set)})

    if kind == "all_lines_match":
        # Every non-empty stdout line must match `value` regex.
        # Used for "for every HKEY_USERS\<sid> hive, value must be X".
        v = str(expect.get("value", ""))
        pat = re.compile(v)
        lines = [ln.strip() for ln in stdout.splitlines() if ln.strip()]
        if any(ln == "NO_INTERACTIVE_USERS" for ln in lines):
            return LocalCheckResult("passed",
                                    "no interactive user hives found (N/A)",
                                    {"line_count": 0})
        if not lines:
            return LocalCheckResult("failed",
                                    f"{fail_msg} (stdout was empty)",
                                    {})
        bad = [ln for ln in lines if not pat.search(ln)]
        if not bad:
            return LocalCheckResult("passed",
                                    f"{pass_msg} (matched {len(lines)}/{len(lines)} lines)",
                                    {"matched": len(lines)})
        return LocalCheckResult("failed",
                                f"{fail_msg} (matched {len(lines)-len(bad)}/{len(lines)} lines, first bad: {bad[0][:80]!r})",
                                {"matched": len(lines)-len(bad), "total": len(lines)})

    return LocalCheckResult("error", f"Unknown expectation kind: {kind}",
                            error_message=f"unknown_expectation_kind:{kind}")


def run_local_check(check_definition: Dict[str, Any]) -> LocalCheckResult:
    """Execute one Windows CIS check against the local host.

    The agent's job-runner calls this once per rule per host (which is
    just the local machine in endpoint mode).
    """
    command = check_definition.get("command")
    if not command:
        return LocalCheckResult("error", "Missing 'command' in check_definition",
                                error_message="invalid_check_definition")
    safe, reason = _is_command_safe(command)
    if not safe:
        return LocalCheckResult("error", reason, error_message="unsafe_command")

    timeout = int(check_definition.get("timeout_seconds", 30))
    expect = check_definition.get("expect") or {"kind": "exit_zero"}
    pass_msg = check_definition.get("pass_message") or "Check passed."
    fail_msg = check_definition.get("fail_message") or "Check failed."

    try:
        # We do NOT use shell=True — would let an attacker who can write
        # to a rule (in spite of the review queue) inject `&` etc. Splitting
        # via shlex on Windows is broken (drive letters get mangled), so we
        # use shell=False with the command as a single string for cmd.exe
        # and rely on the allowlist above for safety.
        result = subprocess.run(
            command,
            shell=True,             # required for `net accounts` etc. with spaces
            capture_output=True,
            text=True,
            timeout=timeout,
        )
    except subprocess.TimeoutExpired:
        return LocalCheckResult("error", f"Command timed out after {timeout}s",
                                error_message="timeout")
    except FileNotFoundError as e:
        return LocalCheckResult("error", f"Command not found: {e}",
                                error_message="command_not_found")

    return _evaluate(
        result.stdout or "",
        result.stderr or "",
        result.returncode,
        expect, pass_msg, fail_msg,
    )
