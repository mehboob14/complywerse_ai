"""SSH collector — agent's collector-mode executor.

Used when the agent is installed on one Linux/Windows VM inside the bank
network and needs to scan OTHER devices (Cisco switches, Linux servers,
even Oracle if you tunnel through SSH) on behalf of the cloud.

This mirrors the backend's `ssh_runner.py` ALMOST exactly — same
allowlist of safe commands, same check_definition shape — so a CIS rule
that was authored against the cloud-side SSH runner runs identically
from the agent. The only difference is the credentials come from the
local encrypted vault instead of the cloud DB.

`check_definition` shape (matches backend):
    {
      "command": "show running-config | include enable",
      "expect": {
         "kind": "stdout_contains" | "stdout_not_contains"
                 | "stdout_regex" | "exit_zero" | "line_kv_equals",
         "value": "...",
         "field": "...",
         "expected": "..."
      },
      "pass_message": "...",
      "fail_message": "...",
      "timeout_seconds": 15
    }

Credentials dict shape (from vault.get_collector_cred()):
    {
      "type": "ssh",
      "host": "10.0.0.5", "port": 22,
      "username": "svc-compliverse",
      "password": "...",                       # OR
      "private_key_pem": "-----BEGIN ..."
    }
"""
from __future__ import annotations

import io
import logging
import re
from dataclasses import dataclass, field
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)

try:
    import paramiko  # type: ignore
    PARAMIKO_AVAILABLE = True
except ImportError:
    PARAMIKO_AVAILABLE = False


@dataclass
class SshCheckResult:
    status: str            # "passed" | "failed" | "error"
    summary: str
    raw_output: Dict[str, Any] = field(default_factory=dict)
    error_message: Optional[str] = None


# Same safety allowlist as backend ssh_runner.py — a check_definition
# that would be rejected server-side must be rejected here too. We
# duplicate the regex list (rather than import from grc.*) because the
# agent runs in an air-gapped install and shouldn't depend on the
# backend package.
_DENY_PATTERNS = [
    re.compile(r"\bsudo\b"),
    re.compile(r"\brm\b"),
    re.compile(r"\bmv\b"),
    re.compile(r"\bdd\b"),
    re.compile(r"\b(systemctl|service)\s+(start|stop|restart|reload)\b"),
    re.compile(r"\b(apt|yum|dnf|snap)\s+(install|remove|purge)\b"),
    re.compile(r"\b(reload|reboot|shutdown|halt)\b"),
    re.compile(r"\b(write|copy)\s+(running-config|startup-config)\b"),  # Cisco
]
_REDIRECT_RE = re.compile(r"(?<![0-9])[12]?>>?\s*(\S+)")


def _is_command_safe(command: str) -> tuple[bool, str]:
    for pat in _DENY_PATTERNS:
        if pat.search(command):
            return False, f"Command rejected by safety allowlist: matches {pat.pattern!r}"
    for m in _REDIRECT_RE.finditer(command):
        target = m.group(1)
        if target not in ("/dev/null", "/dev/stderr", "/dev/stdout"):
            return False, f"Redirect to {target!r} is not allowed (only /dev/null permitted)"
    return True, ""


def _open_session(creds: Dict[str, Any], timeout: int) -> "paramiko.SSHClient":
    """Open an authenticated SSH session.

    Host-key policy: defaults to RejectPolicy. Banks typically pre-populate
    known_hosts via their config-management tooling. For lab targets the
    operator can set the cred entry's `accept_unknown_hosts: true`.
    """
    client = paramiko.SSHClient()
    if creds.get("known_hosts_path"):
        client.load_host_keys(creds["known_hosts_path"])
    else:
        client.load_system_host_keys()
    if creds.get("accept_unknown_hosts"):
        client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    else:
        client.set_missing_host_key_policy(paramiko.RejectPolicy())

    connect_kwargs: Dict[str, Any] = {
        "hostname": creds["host"],
        "port": int(creds.get("port", 22)),
        "username": creds["username"],
        "timeout": timeout,
        "allow_agent": False,
        "look_for_keys": False,
    }
    if creds.get("private_key_pem"):
        pkey = paramiko.RSAKey.from_private_key(io.StringIO(creds["private_key_pem"]))
        connect_kwargs["pkey"] = pkey
    elif creds.get("password"):
        connect_kwargs["password"] = creds["password"]
    else:
        raise RuntimeError("SSH credentials require either password or private_key_pem")
    client.connect(**connect_kwargs)
    return client


def _evaluate(stdout: str, stderr: str, exit_code: int,
              expect: Dict[str, Any],
              pass_msg: str, fail_msg: str) -> SshCheckResult:
    kind = (expect.get("kind") or "exit_zero").lower()

    if kind == "exit_zero":
        if exit_code == 0:
            return SshCheckResult("passed", pass_msg, {"exit_code": exit_code})
        return SshCheckResult("failed", f"{fail_msg} (exit_code={exit_code})",
                              {"exit_code": exit_code, "stderr": stderr[:500]})

    if kind == "stdout_contains":
        needle = str(expect.get("value", ""))
        if needle in stdout:
            return SshCheckResult("passed", pass_msg, {"matched": needle})
        return SshCheckResult("failed", f"{fail_msg} (substring {needle!r} not in stdout)",
                              {"stdout_excerpt": stdout[:500]})

    if kind == "stdout_not_contains":
        needle = str(expect.get("value", ""))
        if needle not in stdout:
            return SshCheckResult("passed", pass_msg, {})
        return SshCheckResult("failed", f"{fail_msg} (forbidden substring {needle!r} present)",
                              {"stdout_excerpt": stdout[:500]})

    if kind == "stdout_regex":
        pat = re.compile(expect.get("value", ""))
        if pat.search(stdout):
            return SshCheckResult("passed", pass_msg, {})
        return SshCheckResult("failed", f"{fail_msg} (regex {pat.pattern!r} did not match)",
                              {"stdout_excerpt": stdout[:500]})

    if kind == "line_kv_equals":
        field = expect.get("field", "")
        expected = str(expect.get("expected", ""))
        for line in stdout.splitlines():
            if ":" in line:
                k, _, v = line.partition(":")
            elif "=" in line:
                k, _, v = line.partition("=")
            else:
                continue
            if k.strip().lower() == field.lower():
                actual = v.strip().strip(",").strip('"').strip("'")
                if actual.lower() == expected.lower():
                    return SshCheckResult("passed", pass_msg, {"actual": actual})
                return SshCheckResult("failed",
                                      f"{fail_msg} ({field}={actual!r}, expected {expected!r})",
                                      {"actual": actual, "expected": expected})
        return SshCheckResult("failed", f"{fail_msg} (field {field!r} not found in output)",
                              {"stdout_excerpt": stdout[:500]})

    return SshCheckResult("error", f"Unknown expectation kind: {kind}",
                          error_message=f"unknown_expectation_kind:{kind}")


def run_ssh_check(check_definition: Dict[str, Any], creds: Dict[str, Any]) -> SshCheckResult:
    """Execute one SSH check against the given target.

    Used by the agent's collector mode. The agent's job-runner calls this
    once per CIS rule for each target asset.
    """
    if not PARAMIKO_AVAILABLE:
        return SshCheckResult("error", "paramiko library not installed on this agent",
                              error_message="paramiko_not_installed")

    command = check_definition.get("command")
    if not command:
        return SshCheckResult("error", "Missing 'command' in check_definition",
                              error_message="invalid_check_definition")
    safe, reason = _is_command_safe(command)
    if not safe:
        return SshCheckResult("error", reason, error_message="unsafe_command")

    timeout = int(check_definition.get("timeout_seconds", 15))
    expect = check_definition.get("expect") or {"kind": "exit_zero"}
    pass_msg = check_definition.get("pass_message") or "Check passed."
    fail_msg = check_definition.get("fail_message") or "Check failed."

    try:
        client = _open_session(creds, timeout)
    except paramiko.AuthenticationException:
        return SshCheckResult("error", "SSH auth failed — username/password rejected",
                              error_message="auth_failed")
    except paramiko.SSHException as e:
        return SshCheckResult("error", f"SSH protocol error: {e}", error_message=str(e))
    except OSError as e:
        return SshCheckResult("error", f"SSH connect failed: {e}", error_message="network_unreachable")

    try:
        _stdin, stdout_h, stderr_h = client.exec_command(command, timeout=timeout)
        stdout = stdout_h.read().decode("utf-8", errors="replace")
        stderr = stderr_h.read().decode("utf-8", errors="replace")
        exit_code = stdout_h.channel.recv_exit_status()
        return _evaluate(stdout, stderr, exit_code, expect, pass_msg, fail_msg)
    finally:
        try:
            client.close()
        except Exception:
            pass
