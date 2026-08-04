"""Linux SSH check runner using paramiko.

`check_definition` shape:
    {
      "command": "cat /etc/ssh/sshd_config",       # the read-only shell command
      "expect": {
         "kind": "exit_zero" | "stdout_contains" | "stdout_not_contains"
                 | "stdout_regex" | "stdout_not_regex"
                 | "line_kv_equals",
         "value": "...",                # for *_contains / regex
         "field": "PermitRootLogin",    # for line_kv_equals
         "expected": "no"               # for line_kv_equals
      },
      "pass_message": "...",
      "fail_message": "...",
      "timeout_seconds": 15,
    }

Credentials dict expected keys: ssh_host, ssh_port, ssh_username,
ssh_password OR ssh_private_key (PEM string).
Read-only contract: commands are NEVER executed with sudo and the runner
performs no shell substitution on the command string.
"""
from __future__ import annotations

import io
import re
from typing import Any, Dict

from .registry import RunnerResult, register

try:
    import paramiko
    PARAMIKO_AVAILABLE = True
except ImportError:  # pragma: no cover
    PARAMIKO_AVAILABLE = False


_DENY_PATTERNS = [
    re.compile(r"\bsudo\b"),
    re.compile(r"\brm\b"),
    re.compile(r"\bmv\b"),
    re.compile(r"\bdd\b"),
    re.compile(r"\b(systemctl|service)\s+(start|stop|restart|reload)\b"),
    re.compile(r"\b(apt|yum|dnf|snap)\s+(install|remove|purge)\b"),
]
# Redirects that write to a real file are unsafe. Permit redirects to
# /dev/null and /dev/stderr (common no-op patterns like `2>/dev/null`).
_REDIRECT_RE = re.compile(r"(?<![0-9])[12]?>>?\s*(\S+)")


def _is_command_safe(cmd: str) -> tuple[bool, str]:
    for pat in _DENY_PATTERNS:
        if pat.search(cmd):
            return False, f"Command rejected by read-only safety filter: matches {pat.pattern!r}"
    for target in _REDIRECT_RE.findall(cmd):
        if target not in ("/dev/null", "/dev/stderr", "/dev/stdout"):
            return False, f"Command rejected: write-redirect to '{target}' is not permitted"
    return True, ""


def _evaluate_ssh(stdout: str, exit_status: int, expect: Dict[str, Any]) -> tuple[bool, str]:
    kind = (expect or {}).get("kind", "exit_zero")
    if kind == "exit_zero":
        return exit_status == 0, f"exit_status={exit_status}"
    if kind == "stdout_contains":
        v = expect.get("value", "")
        return v in stdout, f"contains {v!r}: {v in stdout}"
    if kind == "stdout_not_contains":
        v = expect.get("value", "")
        return v not in stdout, f"not contains {v!r}: {v not in stdout}"
    if kind == "stdout_regex":
        v = expect.get("value", "")
        ok = bool(re.search(v, stdout, re.MULTILINE))
        return ok, f"regex {v!r}: {ok}"
    if kind == "stdout_not_regex":
        v = expect.get("value", "")
        ok = not bool(re.search(v, stdout, re.MULTILINE))
        return ok, f"!regex {v!r}: {ok}"
    if kind == "line_kv_equals":
        field = expect.get("field", "")
        expected = str(expect.get("expected", ""))
        # Look for "field VALUE" or "field=VALUE" matching (case-insensitive),
        # ignoring lines that begin with '#'.
        pat = re.compile(rf"^\s*{re.escape(field)}\s*[=\s]\s*(\S+)\s*$", re.IGNORECASE | re.MULTILINE)
        # Use the LAST non-comment value, mirroring sshd/grub config semantics.
        non_comment = "\n".join(ln for ln in stdout.splitlines() if not ln.lstrip().startswith("#"))
        matches = pat.findall(non_comment)
        if not matches:
            return False, f"field '{field}' not found in stdout"
        actual = matches[-1].lower()
        ok = actual == expected.lower()
        return ok, f"{field}={actual} (expected {expected})"
    return False, f"Unknown expect kind: {kind}"


@register("linux_ssh")
@register("netdev_ssh")  # Cisco IOS/NX-OS/ASA/Firepower — same SSH transport
def linux_ssh_runner(check_definition: Dict[str, Any], credentials: Dict[str, Any]) -> RunnerResult:
    if not PARAMIKO_AVAILABLE:
        return RunnerResult(
            status="error",
            summary="paramiko is not installed on this server.",
            error_message="ImportError: paramiko",
        )

    command = check_definition.get("command")
    if not command or not isinstance(command, str):
        return RunnerResult(status="error", summary="Missing 'command' in check_definition.", error_message="invalid_check_definition")
    safe, reason = _is_command_safe(command)
    if not safe:
        return RunnerResult(status="error", summary=reason, error_message="unsafe_command")

    host = credentials.get("ssh_host")
    port = int(credentials.get("ssh_port") or 22)
    user = credentials.get("ssh_username")
    password = credentials.get("ssh_password")
    pkey_pem = credentials.get("ssh_private_key")
    if not host or not user or not (password or pkey_pem):
        return RunnerResult(status="error", summary="SSH credentials missing (need ssh_host, ssh_username, and ssh_password or ssh_private_key).", error_message="missing_credentials")

    timeout = int(check_definition.get("timeout_seconds") or 15)

    client = paramiko.SSHClient()
    # Read-only contract: refuse unknown hosts by default to prevent MITM. A
    # tenant can opt-in per-connection by setting `ssh_accept_unknown_hosts=true`
    # (e.g. ephemeral lab hosts). Production hosts should preload host keys via
    # the `ssh_known_hosts` credential entry.
    accept_unknown = str(credentials.get("ssh_accept_unknown_hosts", "")).lower() in ("1", "true", "yes")
    known_hosts_pem = credentials.get("ssh_known_hosts")
    # Always try to load the system known_hosts file (~/.ssh/known_hosts +
    # /etc/ssh/ssh_known_hosts) so operators can manage trust the standard
    # OpenSSH way — paramiko silently skips files that don't exist.
    try:
        client.load_system_host_keys()
    except Exception:
        pass
    if known_hosts_pem:
        try:
            client.get_host_keys().load(io.StringIO(known_hosts_pem))  # type: ignore[arg-type]
        except Exception:
            pass
    if accept_unknown:
        client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    else:
        client.set_missing_host_key_policy(paramiko.RejectPolicy())
    try:
        connect_kwargs: Dict[str, Any] = dict(
            hostname=host,
            port=port,
            username=user,
            timeout=timeout,
            banner_timeout=timeout,
            auth_timeout=timeout,
            look_for_keys=False,
            allow_agent=False,
        )
        if pkey_pem:
            try:
                pkey = paramiko.RSAKey.from_private_key(io.StringIO(pkey_pem))
            except paramiko.SSHException:
                pkey = paramiko.Ed25519Key.from_private_key(io.StringIO(pkey_pem))
            connect_kwargs["pkey"] = pkey
        else:
            connect_kwargs["password"] = password
        client.connect(**connect_kwargs)

        stdin, stdout, stderr = client.exec_command(command, timeout=timeout)
        out = stdout.read().decode("utf-8", errors="replace")
        err = stderr.read().decode("utf-8", errors="replace")
        rc = stdout.channel.recv_exit_status()
    except Exception as exc:  # noqa: BLE001
        return RunnerResult(
            status="error",
            summary=f"SSH execution failed: {exc}",
            error_message=str(exc),
        )
    finally:
        try:
            client.close()
        except Exception:
            pass

    expect = check_definition.get("expect") or {}
    ok, detail = _evaluate_ssh(out, rc, expect)
    msg = (check_definition.get("pass_message") if ok else check_definition.get("fail_message")) or detail

    # Truncate stdout for storage (keep first 8KB).
    if len(out) > 8192:
        stored_out = out[:8192] + f"\n…[truncated, total {len(out)} bytes]"
    else:
        stored_out = out

    return RunnerResult(
        status="passed" if ok else "failed",
        summary=f"{msg} ({detail})",
        raw_output={
            "command": command,
            "exit_status": rc,
            "stdout": stored_out,
            "stderr": err[:2048],
            "expectation_detail": detail,
        },
    )
