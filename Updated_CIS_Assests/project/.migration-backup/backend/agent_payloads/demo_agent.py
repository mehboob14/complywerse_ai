#!/usr/bin/env python
"""Compliverse Agent — single-file Python agent with local job execution.

Lifecycle per machine:
  1. Read enrollment token (env COMPLYVERSE_ENROLL, CLI arg, or stored file).
  2. POST /grc/agents/enroll → permanent api_token (saved to disk).
  3. Loop forever, every TICK_SECONDS:
       a. POST /grc/agents/heartbeat with OS profile.
       b. GET  /grc/agents/jobs                       → list of jobs.
       c. For each job: execute locally (PS on Win, bash on Linux/Mac),
          evaluate the expectation, collect result.
       d. POST /grc/agents/results with batched outcomes.

The agent is the trust boundary on the endpoint: it executes ONLY commands
that pass the local safety filter (a copy of the server-side read-only
filter shipped with the backend). Write/mutating commands are rejected
even if the backend somehow asks for them.
"""
from __future__ import annotations

import json
import os
import platform
import re
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path


# ─── Boot log ─────────────────────────────────────────────────────────────
# Write to a fixed file the moment we start, BEFORE any logic that could
# crash silently. The scheduled task on Windows captures no stdout, so
# without this an early failure (missing module, bad token path, network
# refused) is invisible. The log lives next to the agent state so an
# admin can read it via File Explorer when diagnosing "PENDING forever."
def _boot_log_path() -> Path:
    sysname = platform.system().lower()
    if "windows" in sysname:
        base = Path(os.environ.get("ProgramData", r"C:\ProgramData")) / "Compliverse"
    elif sysname == "linux":
        base = Path("/var/log/compliverse")
    elif sysname == "darwin":
        base = Path("/Library/Logs/Compliverse")
    else:
        base = Path.home() / ".compliverse"
    try:
        base.mkdir(parents=True, exist_ok=True)
    except Exception:
        pass
    return base / "agent.log"


def _boot(msg: str) -> None:
    """Append a timestamped line to the boot log. Never raises — even if
    the path is unwritable, we just silently drop the line rather than
    breaking the agent on a logging failure."""
    try:
        with _boot_log_path().open("a", encoding="utf-8") as f:
            f.write(f"{datetime.now(timezone.utc).isoformat()}  {msg}\n")
    except Exception:
        pass


try:
    import getpass as _getpass
    _whoami = _getpass.getuser()
except Exception:
    _whoami = "?"
_boot("=" * 60)
_boot(f"agent.py started — python={sys.executable}")
_boot(f"  argv={sys.argv}")
_boot(f"  cwd={os.getcwd()}")
_boot(f"  user={_whoami}")
_boot(f"  platform={platform.system()} {platform.release()}")
_boot(f"  BACKEND_URL env={os.environ.get('COMPLYVERSE_URL', '(not set, will default)')}")
_boot(f"  STATE env={os.environ.get('COMPLYVERSE_STATE', '(not set, will default)')}")

AGENT_MODE = (os.environ.get("COMPLYVERSE_MODE") or "endpoint").lower()  # 'endpoint' | 'collector'
BACKEND_URL = os.environ.get("COMPLYVERSE_URL", "http://localhost:5000").rstrip("/")


def _truncate_to_second_level(version: str) -> str:
    """Reduce a dotted version string to major.minor only.

    CIS publishes benchmarks per major.minor (Ubuntu 24.04, macOS 14.4,
    RHEL 9.4). Patches and build numbers under that don't change the
    applicable benchmark, so we strip them at detection time. This keeps
    the OS→benchmark matcher deterministic across point releases — when
    Ubuntu 24.04.3 ships, no mapping update is needed.

      '24.04.2'   → '24.04'
      '9.4.0-1'   → '9.4'
      '12'        → '12'        (single component stays)
      '14.4.1'    → '14.4'
      ''          → ''           (no input, no change)
    """
    if not version:
        return version
    # split on dot first; if any part has a hyphen suffix (e.g. '9.4.0-1'),
    # the slice takes parts[:2] = ['9', '4'] which is what we want.
    parts = version.split('.')
    return '.'.join(parts[:2]) if len(parts) >= 2 else version


def _default_state_dir() -> Path:
    """Where enrollment + cached state live.

    On Windows the agent runs as the SYSTEM account (via Scheduled Task).
    SYSTEM's home directory is ``C:\\Windows\\System32\\config\\systemprofile``
    which is NOT where the installer writes the enrollment token — it
    writes to ``C:\\ProgramData\\Compliverse``. We must default to the
    SAME place the installer wrote to, otherwise SYSTEM-context agents
    can never find their token and enrollment silently fails.

    On Linux/macOS the agent runs as root via systemd/launchd; ``/var/lib``
    is the equivalent system-shared location.
    """
    sysname = platform.system().lower()
    if "windows" in sysname:
        return Path(os.environ.get("ProgramData", r"C:\ProgramData")) / "Compliverse"
    if sysname == "linux":
        return Path("/var/lib/compliverse")
    if sysname == "darwin":
        return Path("/Library/Application Support/Compliverse")
    return Path.home() / ".compliverse"


STATE_DIR = Path(os.environ.get("COMPLYVERSE_STATE", str(_default_state_dir())))
STATE_FILE = STATE_DIR / "agent.json"
TICK_SECONDS = int(os.environ.get("COMPLYVERSE_TICK", "30"))
DEFAULT_JOB_TIMEOUT = 30
MAX_JOBS_PER_TICK = int(os.environ.get("COMPLYVERSE_JOBS_PER_TICK", "200"))
AGENT_VERSION = "0.2.0-local-exec"


# ─── OS detection ────────────────────────────────────────────────────────
def detect_os() -> dict:
    sysname = platform.system().lower()
    if sysname == "windows":
        return _detect_windows()
    if sysname == "linux":
        return _detect_linux()
    if sysname == "darwin":
        return _detect_macos()
    return {"os_family": sysname or "unknown"}


def _detect_windows() -> dict:
    out: dict = {"os_family": "windows"}
    try:
        import winreg  # type: ignore
        with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE,
                            r"SOFTWARE\Microsoft\Windows NT\CurrentVersion") as k:
            product, _ = winreg.QueryValueEx(k, "ProductName")
            try:
                display_version, _ = winreg.QueryValueEx(k, "DisplayVersion")
            except FileNotFoundError:
                display_version = None
            # The registry's ProductName is FROZEN at "Windows 10 ..."
            # even on Windows 11 machines for backwards compatibility.
            # The build number is the authoritative way to tell them
            # apart: anything >= 22000 is Windows 11.
            try:
                build_str, _ = winreg.QueryValueEx(k, "CurrentBuildNumber")
                current_build = int(build_str)
            except (FileNotFoundError, ValueError):
                current_build = 0
        # Correct the product name when it lies about being Win10.
        if current_build >= 22000 and re.search(r"Windows 10", product or "", re.I):
            product = re.sub(r"Windows 10", "Windows 11", product, flags=re.I)
        out["os_version"] = f"{product} {display_version}".strip() if display_version else product
        out["os_build"] = display_version
        m = re.search(r"\b(Enterprise|Pro|Home|Education|LTSC|Datacenter|Standard)\b",
                      product or "", re.I)
        if m:
            out["os_edition"] = m.group(1)
        # Build-number based detection beats ProductName parsing because
        # ProductName is stale on Win11 (still says "Windows 10").
        if current_build >= 22000:
            base = "windows-11"
        elif re.search(r"Windows 11", product or "", re.I):
            base = "windows-11"
        elif re.search(r"Windows 10", product or "", re.I):
            base = "windows-10"
        elif re.search(r"Server", product or "", re.I):
            srv = re.search(r"Server\s*(\d{4})", product or "", re.I)
            base = f"windows-server-{srv.group(1)}" if srv else "windows-server"
        else:
            base = "windows"
        if display_version and base in ("windows-10", "windows-11"):
            out["os_normalized"] = f"{base}-{display_version}"
        else:
            out["os_normalized"] = base
    except Exception as exc:  # noqa: BLE001
        out["os_error"] = str(exc)
    return out


def _detect_linux() -> dict:
    out: dict = {"os_family": "linux"}
    try:
        text = Path("/etc/os-release").read_text(encoding="utf-8", errors="replace")
        pretty = re.search(r'PRETTY_NAME="?([^"\n]+)"?', text)
        idline = re.search(r'^ID=(\S+)', text, re.M)
        ver = re.search(r'^VERSION_ID="?([\d.]+)"?', text, re.M)
        out["os_version"] = pretty.group(1) if pretty else None
        distro = (idline.group(1) if idline else "linux").lower()
        raw_v = ver.group(1) if ver else ""
        # Truncate to major.minor for matching consistency across all
        # distros. CIS publishes per-major.minor; patch level (24.04.2)
        # is irrelevant to which benchmark applies.
        v = _truncate_to_second_level(raw_v)
        if distro == "ubuntu":
            out["os_normalized"] = f"ubuntu-{v}" if v else "ubuntu"
        elif distro == "debian":
            out["os_normalized"] = f"debian-{v}" if v else "debian"
        elif distro in ("rhel", "centos"):
            out["os_normalized"] = f"rhel-{v}" if v else "rhel"
        elif distro == "almalinux":
            out["os_normalized"] = f"almalinux-{v}" if v else "almalinux"
        elif distro == "rocky":
            out["os_normalized"] = f"rocky-{v}" if v else "rocky"
        elif "oracle" in distro:
            out["os_normalized"] = f"oraclelinux-{v}" if v else "oraclelinux"
        elif "amzn" in distro or "amazon" in distro:
            out["os_normalized"] = f"amazonlinux-{v}" if v else "amazonlinux"
        elif "sles" in distro or "suse" in distro:
            out["os_normalized"] = f"sles-{v}" if v else "sles"
        else:
            out["os_normalized"] = f"{distro}-{v}" if v else distro
        # os_build keeps the FULL raw version (e.g. "24.04.2") for human
        # display; os_normalized has the truncated value for matching.
        out["os_build"] = raw_v or None
    except Exception as exc:  # noqa: BLE001
        out["os_error"] = str(exc)
    return out


def _detect_macos() -> dict:
    out: dict = {"os_family": "macos"}
    try:
        ver = subprocess.check_output(["sw_vers", "-productVersion"], timeout=3).decode().strip()
        out["os_version"] = f"macOS {ver}"
        # major.minor for CIS matching (14.4.1 → 14.4); CIS Apple
        # benchmarks are per-minor (Sonoma 14.0, 14.4, Sequoia 15.0…).
        out["os_normalized"] = f"macos-{_truncate_to_second_level(ver)}"
        out["os_build"] = ver
    except Exception as exc:  # noqa: BLE001
        out["os_error"] = str(exc)
    return out


# ─── Safety filter (mirror of server-side WinRM/SSH read-only filter) ─────
# IMPORTANT: this is the LAST line of defence on the endpoint. Even if the
# backend (or a man-in-the-middle) asks the agent to run something mutating,
# we refuse here. Keep this in sync with backend/grc/modules/compliance_plugins
# /runners/winrm_runner.py (_DENY_PATTERNS).
_PS_DENY = [
    re.compile(r"\b(Set|New|Remove|Stop|Start|Restart|Suspend|Resume|"
               r"Disable|Enable|Add|Clear|Reset|Rename|Move|Copy|Install|"
               r"Uninstall|Register|Unregister|Mount|Dismount|Block|Unblock|"
               r"Grant|Revoke|Deny|Approve|Edit|Update|Send|Save|Push|Pop|"
               r"Submit|Invoke|Import|Export|Initialize|Optimize|Repair|"
               r"Restore|Backup|Limit|Lock|Unlock|Protect|Unprotect|Hide|"
               r"Show)-[A-Za-z][A-Za-z0-9]*", re.IGNORECASE),
    re.compile(r"\b(Out-File|Tee-Object)\b", re.IGNORECASE),
    re.compile(r"(?<![-\w])(rm|ri|ni|del|kill|spps|sajb|irm|iwr|curl|wget)(?![-\w])", re.IGNORECASE),
    re.compile(r"(?<![-\w])(del|erase|rmdir|mkdir|move|copy|xcopy|robocopy|rename|format|"
               r"diskpart|fsutil|attrib|cacls|icacls|takeown)(?:\.exe)?(?![-\w])", re.IGNORECASE),
    re.compile(r"\breg(?:\.exe)?\s+(add|delete|import|copy|save|restore|load|unload)\b", re.IGNORECASE),
    re.compile(r"\bsc(?:\.exe)?\s+(create|delete|config|start|stop|pause|continue|failure|sdset|sidtype)\b", re.IGNORECASE),
    re.compile(r"\bnetsh(?:\.exe)?\s+\S+\s+(add|set|delete|reset|import|export)\b", re.IGNORECASE),
    re.compile(r"\bnet(?:\.exe)?\s+(user|group|localgroup|share|use|stop|start|accounts)\b\s+\S+\s+/", re.IGNORECASE),
    re.compile(r"\b(cmd(?:\.exe)?|powershell(?:\.exe)?|pwsh(?:\.exe)?)\s+(/c|/k|-c|-Command|-EncodedCommand)\b", re.IGNORECASE),
    re.compile(r"\b(Start-Process|saps)\b", re.IGNORECASE),
    re.compile(r"(?<![0-9a-zA-Z_])([12]?>>?)\s*(\S+)"),
]
_PS_REDIRECT_IDX = len(_PS_DENY) - 1

# Linux: block any obvious mutation. CIS Linux benchmarks are mostly
# `cat /etc/foo`, `sysctl -n net.x.y`, `stat -c %a file`, `grep -E 'X' file`
# — pure reads. Anything else is refused.
_SH_DENY = [
    re.compile(r"(?<![-\w])(rm|mv|cp|mkdir|rmdir|chown|chmod|chgrp|chattr|"
               r"setcap|setfacl|truncate|dd|shred|ln|touch|install)(?![-\w])"),
    re.compile(r"(?<![-\w])(useradd|usermod|userdel|groupadd|groupmod|"
               r"groupdel|passwd|chpasswd|gpasswd|chage)(?![-\w])"),
    re.compile(r"(?<![-\w])(systemctl|service|update-rc.d|chkconfig|"
               r"insserv|rc-update)\s+(start|stop|restart|reload|enable|"
               r"disable|mask|unmask|edit)(?![-\w])"),
    re.compile(r"(?<![-\w])(apt-get|apt|yum|dnf|zypper|pacman|emerge|"
               r"apk)\s+(install|remove|upgrade|update|autoremove|purge)(?![-\w])"),
    re.compile(r"(?<![-\w])(iptables|nft|ufw|firewall-cmd|ipset)\s+(-A|-I|-D|-F|"
               r"--append|--insert|--delete|--flush|--add|--remove|--reload)"),
    re.compile(r"(?<![-\w])(mount|umount|losetup|swapon|swapoff|sysctl"
               r"\s+-w)(?![-\w])"),
    # Redirection writes (anything other than /dev/null).
    re.compile(r"(?<![0-9a-zA-Z_])([12]?>>?)\s*(\S+)"),
    re.compile(r"\beval\s|\bexec\s|\b\$\(.*\)|`[^`]+`"),  # block subshells/eval
]
_SH_REDIRECT_IDX = 6


def is_command_safe(cmd: str, shell: str) -> tuple[bool, str]:
    if shell in ("powershell", "cmd"):
        patterns = _PS_DENY
        redirect_idx = _PS_REDIRECT_IDX
        null_token = "$null"
    else:
        patterns = _SH_DENY
        redirect_idx = _SH_REDIRECT_IDX
        null_token = "/dev/null"
    for idx, pat in enumerate(patterns):
        m = pat.search(cmd)
        if not m:
            continue
        if idx == redirect_idx:
            target = m.group(2) if m.lastindex and m.lastindex >= 2 else ""
            if target == null_token:
                continue
            return False, f"write-redirect to {target!r} is not permitted"
        return False, f"matches safety pattern {pat.pattern[:60]!r}"
    return True, ""


# ─── Evaluator (mirror of server-side _evaluate) ──────────────────────────
def evaluate(stdout: str, exit_status: int, expect: dict) -> tuple[bool, str]:
    kind = (expect or {}).get("kind", "exit_zero")
    if kind == "exit_zero":
        return exit_status == 0, f"exit_status={exit_status}"
    if kind == "stdout_contains":
        v = str(expect.get("value", ""))
        return v in stdout, f"contains {v!r}: {v in stdout}"
    if kind == "stdout_not_contains":
        v = str(expect.get("value", ""))
        return v not in stdout, f"not contains {v!r}: {v not in stdout}"
    if kind == "stdout_regex":
        v = str(expect.get("value", ""))
        ok = bool(re.search(v, stdout, re.MULTILINE))
        first_line = next((ln.strip() for ln in stdout.splitlines() if ln.strip()), "")
        actual = first_line if first_line else "registry value not set"
        m_lit = re.match(r"^\^\\s\*(.+?)\\s\*\$$", v)
        expected_literal = m_lit.group(1) if m_lit else v
        if expected_literal == r"\S":
            expected_literal = "any non-empty value"
        return ok, f"current value: {actual}; CIS expects: {expected_literal}"
    if kind == "stdout_not_regex":
        v = str(expect.get("value", ""))
        ok = not bool(re.search(v, stdout, re.MULTILINE))
        first_line = next((ln.strip() for ln in stdout.splitlines() if ln.strip()), "")
        actual = first_line if first_line else "registry value not set"
        m_lit = re.match(r"^\^\\s\*(.+?)\\s\*\$$", v)
        prohibited = m_lit.group(1) if m_lit else v
        return ok, f"current value: {actual}; CIS forbids: {prohibited}"
    if kind == "line_kv_equals":
        field = str(expect.get("field", ""))
        expected = str(expect.get("expected", ""))
        lines = [ln for ln in stdout.splitlines() if not ln.lstrip().startswith("#")]
        pat = re.compile(rf"^\s*{re.escape(field)}\s*[:=]\s*(.+?)\s*$", re.IGNORECASE | re.MULTILINE)
        matches = pat.findall("\n".join(lines))
        if not matches:
            return False, f"field '{field}' not found in stdout"
        actual = str(matches[-1]).strip().strip('"').lower()
        ok = actual == expected.strip().lower()
        return ok, f"{field}={actual!r} (expected {expected!r})"
    if kind == "secedit_field_equals":
        field = str(expect.get("field", ""))
        expected = str(expect.get("expected", ""))
        pat = re.compile(rf"^\s*{re.escape(field)}\s*=\s*(.+?)\s*$", re.IGNORECASE | re.MULTILINE)
        matches = pat.findall(stdout)
        if not matches:
            return False, f"secedit field '{field}' not found"
        actual = str(matches[-1]).strip().lower()
        ok = actual == expected.strip().lower()
        return ok, f"{field}={actual!r} (expected {expected!r})"
    # Range comparators for CIS rules phrased as "N or more" / "N or
    # fewer". The old equals-only path graded "Maximum password age =
    # 42" as FAIL against "365 or fewer" because 42 != 365 — a false
    # positive caught in live cross-checking against `net accounts`.
    if kind in ("secedit_field_gte", "secedit_field_lte", "secedit_field_lte_nonzero"):
        field = str(expect.get("field", ""))
        expected_s = str(expect.get("expected", ""))
        pat = re.compile(rf"^\s*{re.escape(field)}\s*=\s*(.+?)\s*$", re.IGNORECASE | re.MULTILINE)
        matches = pat.findall(stdout)
        if not matches:
            return False, f"secedit field '{field}' not found"
        raw = str(matches[-1]).strip().strip('"')
        try:
            actual_n = int(raw)
            expected_n = int(expected_s)
        except ValueError:
            return False, f"{field}={raw!r} is not numeric (expected number {expected_s!r})"
        if kind == "secedit_field_gte":
            ok = actual_n >= expected_n
            return ok, f"{field}={actual_n} (require >= {expected_n})"
        if kind == "secedit_field_lte":
            ok = actual_n <= expected_n
            return ok, f"{field}={actual_n} (require <= {expected_n})"
        # lte_nonzero: "N or fewer, but not 0" — 0 usually means 'never',
        # which CIS treats as non-compliant.
        ok = 0 < actual_n <= expected_n
        return ok, f"{field}={actual_n} (require 1..{expected_n})"
    if kind == "all_lines_match":
        v = str(expect.get("value", ""))
        pat = re.compile(v)
        lines = [ln.strip() for ln in stdout.splitlines() if ln.strip()]
        if any(ln == "NO_INTERACTIVE_USERS" for ln in lines):
            return True, "no interactive user hives found (N/A)"
        if not lines:
            return False, "stdout was empty"
        bad = [ln for ln in lines if not pat.search(ln)]
        ok = not bad
        return ok, f"matched {len(lines) - len(bad)}/{len(lines)} lines"
    return False, f"unknown expect kind: {kind!r} (agent {AGENT_VERSION} needs upgrade)"


# ─── Local executors ──────────────────────────────────────────────────────
def run_local(check_definition: dict) -> dict:
    """Execute a check locally and return a normalized result dict."""
    command = check_definition.get("command")
    if not command or not isinstance(command, str):
        return _err_result("missing 'command' in check_definition")

    sysname = platform.system().lower()
    shell = (check_definition.get("shell") or
             ("powershell" if sysname == "windows" else "bash")).lower()
    timeout = int(check_definition.get("timeout_seconds") or DEFAULT_JOB_TIMEOUT)

    safe, reason = is_command_safe(command, shell)
    if not safe:
        return _err_result(f"command rejected by local safety filter: {reason}")

    started = datetime.now(timezone.utc).isoformat()
    t0 = time.time()
    try:
        if shell == "powershell":
            proc = subprocess.run(
                ["powershell", "-NoProfile", "-NonInteractive", "-Command", command],
                capture_output=True, text=True, timeout=timeout, check=False,
            )
        elif shell == "cmd":
            proc = subprocess.run(
                ["cmd.exe", "/c", command],
                capture_output=True, text=True, timeout=timeout, check=False,
            )
        else:  # bash / sh
            proc = subprocess.run(
                ["bash", "-c", command],
                capture_output=True, text=True, timeout=timeout, check=False,
            )
        rc = int(proc.returncode)
        stdout = proc.stdout or ""
        stderr = proc.stderr or ""
    except subprocess.TimeoutExpired:
        return _err_result(f"command timed out after {timeout}s",
                           started=started, duration_ms=int((time.time() - t0) * 1000))
    except FileNotFoundError as exc:
        return _err_result(f"shell not found: {exc}", started=started)
    except Exception as exc:  # noqa: BLE001
        return _err_result(f"local exec failed: {exc}", started=started)

    expect = check_definition.get("expect") or {}
    ok, detail = evaluate(stdout, rc, expect)
    msg = (check_definition.get("pass_message") if ok
           else check_definition.get("fail_message")) or detail
    duration_ms = int((time.time() - t0) * 1000)
    if len(stdout) > 8192:
        stored = stdout[:8192] + f"\n…[truncated, total {len(stdout)} bytes]"
    else:
        stored = stdout
    return {
        "status": "passed" if ok else "failed",
        "result_summary": f"{msg} ({detail})",
        "raw_output": {
            "shell": shell,
            "command": command,
            "exit_status": rc,
            "stdout": stored,
            "stderr": stderr[:2048],
            "expectation_detail": detail,
        },
        "started_at": started,
        "completed_at": datetime.now(timezone.utc).isoformat(),
        "duration_ms": duration_ms,
    }


# ─── Collector executors (remote targets via local drivers) ──────────────
# Each runner_type the backend can send a collector agent. Drivers are
# lazy-imported so a Linux box without `pymssql`/`oracledb`/etc. still
# runs the runners it CAN handle and reports a clear "missing driver"
# result for the others. Same shape as run_local() return dict.

def _wrap_remote(status: str, summary: str, raw: dict, started: str, t0: float) -> dict:
    duration_ms = int((time.time() - t0) * 1000)
    return {
        "status": status,
        "result_summary": summary,
        "raw_output": raw,
        "started_at": started,
        "completed_at": datetime.now(timezone.utc).isoformat(),
        "duration_ms": duration_ms,
    }


def run_ssh(check_definition: dict, credentials: dict) -> dict:
    """linux_ssh / netdev_ssh — paramiko SSH client to remote host."""
    started = datetime.now(timezone.utc).isoformat()
    t0 = time.time()
    try:
        import paramiko  # type: ignore
    except ImportError:
        return _err_result("SSH runner needs `pip install paramiko` on the collector.", started=started)
    command = check_definition.get("command")
    if not command:
        return _err_result("missing 'command' in check_definition", started=started)
    safe, reason = is_command_safe(command, "bash")
    if not safe:
        return _err_result(f"command rejected by local safety filter: {reason}", started=started)
    host = credentials.get("ssh_host") or credentials.get("hostname")
    port = int(credentials.get("ssh_port") or 22)
    user = credentials.get("ssh_username") or credentials.get("username")
    pw = credentials.get("ssh_password") or credentials.get("password")
    key = credentials.get("ssh_private_key")
    if not host or not user or not (pw or key):
        return _err_result(f"SSH creds missing: host={bool(host)} user={bool(user)} pw_or_key={bool(pw or key)}", started=started)
    try:
        ssh = paramiko.SSHClient()
        ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        connect_args = {"hostname": host, "port": port, "username": user, "timeout": int(check_definition.get("timeout_seconds", 15))}
        if key:
            import io as _io
            connect_args["pkey"] = paramiko.RSAKey.from_private_key(_io.StringIO(key))
        else:
            connect_args["password"] = pw
        ssh.connect(**connect_args)
        _, stdout, stderr = ssh.exec_command(command, timeout=connect_args["timeout"])
        out = stdout.read().decode("utf-8", errors="replace")
        err = stderr.read().decode("utf-8", errors="replace")
        rc = stdout.channel.recv_exit_status()
        ssh.close()
    except Exception as exc:  # noqa: BLE001
        return _err_result(f"SSH exec failed: {exc}", started=started)
    ok, detail = evaluate(out, rc, check_definition.get("expect") or {})
    msg = (check_definition.get("pass_message") if ok else check_definition.get("fail_message")) or detail
    return _wrap_remote(
        "passed" if ok else "failed",
        f"{msg} ({detail})",
        {"command": command, "exit_status": rc, "stdout": out[:8192], "stderr": err[:2048], "expectation_detail": detail},
        started, t0,
    )


def run_sql(check_definition: dict, credentials: dict, dialect: str) -> dict:
    """oracle_sql / mssql_sql / postgres_sql / mysql_sql — read-only SELECT."""
    started = datetime.now(timezone.utc).isoformat()
    t0 = time.time()
    sql = check_definition.get("sql") or check_definition.get("command")
    if not sql:
        return _err_result("missing 'sql' in check_definition", started=started)
    # SQL safety: block any write keyword. Same filter as the server runners.
    if re.search(r"\b(INSERT|UPDATE|DELETE|TRUNCATE|DROP|ALTER|CREATE|GRANT|REVOKE|EXEC|EXECUTE|MERGE|CALL)\b", sql, re.IGNORECASE):
        return _err_result(f"SQL rejected: write/mutating keyword present", started=started)
    if ";" in sql.strip().rstrip(";").rstrip():
        return _err_result("SQL rejected: multi-statement not allowed", started=started)
    try:
        if dialect == "oracle":
            import oracledb  # type: ignore
            host = credentials.get("oracle_host")
            port = int(credentials.get("oracle_port") or 1521)
            user = credentials.get("oracle_username")
            pw = credentials.get("oracle_password")
            svc = credentials.get("oracle_service_name") or "ORCL"
            dsn = oracledb.makedsn(host, port, service_name=svc)
            conn = oracledb.connect(user=user, password=pw, dsn=dsn)
        elif dialect == "mssql":
            import pymssql  # type: ignore
            conn = pymssql.connect(
                server=credentials.get("mssql_host"),
                port=int(credentials.get("mssql_port") or 1433),
                user=credentials.get("mssql_username"),
                password=credentials.get("mssql_password"),
                database=credentials.get("mssql_database") or "master",
                login_timeout=int(check_definition.get("timeout_seconds", 15)),
            )
        elif dialect == "postgres":
            import psycopg2  # type: ignore
            conn = psycopg2.connect(
                host=credentials.get("postgres_host"),
                port=int(credentials.get("postgres_port") or 5432),
                user=credentials.get("postgres_username"),
                password=credentials.get("postgres_password"),
                dbname=credentials.get("postgres_database") or "postgres",
                connect_timeout=int(check_definition.get("timeout_seconds", 15)),
            )
        elif dialect == "mysql":
            import pymysql  # type: ignore
            conn = pymysql.connect(
                host=credentials.get("mysql_host"),
                port=int(credentials.get("mysql_port") or 3306),
                user=credentials.get("mysql_username"),
                password=credentials.get("mysql_password"),
                database=credentials.get("mysql_database") or "information_schema",
                connect_timeout=int(check_definition.get("timeout_seconds", 15)),
            )
        else:
            return _err_result(f"unknown SQL dialect: {dialect!r}", started=started)
        cur = conn.cursor()
        cur.execute(sql)
        rows = cur.fetchall() or []
        rowcount = len(rows)
        first = rows[0] if rows else None
        cur.close()
        conn.close()
    except ImportError as exc:
        return _err_result(f"{dialect} driver missing — `pip install` it on the collector: {exc}", started=started)
    except Exception as exc:  # noqa: BLE001
        return _err_result(f"{dialect} query failed: {exc}", started=started)
    expect = check_definition.get("expect") or {"kind": "row_count_nonzero"}
    kind = expect.get("kind", "row_count_nonzero")
    if kind == "row_count_zero":
        ok, detail = rowcount == 0, f"rowcount={rowcount}"
    elif kind == "row_count_nonzero":
        ok, detail = rowcount > 0, f"rowcount={rowcount}"
    elif first is not None:
        actual = "" if first[0] is None else str(first[0])
        if kind == "first_value_equals":
            ok = actual.strip().lower() == str(expect.get("expected", "")).strip().lower()
            detail = f"{actual!r} ?= {expect.get('expected')!r}"
        elif kind == "first_value_contains":
            ok = str(expect.get("expected", "")) in actual
            detail = f"contains: {ok}"
        else:
            ok, detail = False, f"unknown expect kind: {kind!r}"
    else:
        ok, detail = False, "no rows"
    pass_msg = check_definition.get("pass_message") or f"{dialect} check passed."
    fail_msg = check_definition.get("fail_message") or f"{dialect} check failed."
    return _wrap_remote(
        "passed" if ok else "failed",
        f"{pass_msg if ok else fail_msg} ({detail})",
        {"sql": sql, "rowcount": rowcount, "first_row": list(first) if first else None, "expectation_detail": detail},
        started, t0,
    )


def run_ldap(check_definition: dict, credentials: dict) -> dict:
    """ldap_query — ldap3 bind + search against AD/LDAP DC."""
    started = datetime.now(timezone.utc).isoformat()
    t0 = time.time()
    try:
        import ldap3  # type: ignore
    except ImportError:
        return _err_result("LDAP runner needs `pip install ldap3` on the collector.", started=started)
    base = check_definition.get("ldap_base_dn")
    flt = check_definition.get("ldap_filter")
    if not base or not flt:
        return _err_result("missing ldap_base_dn or ldap_filter", started=started)
    try:
        server = ldap3.Server(
            credentials.get("ldap_host"),
            port=int(credentials.get("ldap_port") or 389),
            use_ssl=bool(credentials.get("ldap_use_ssl")),
            get_info=ldap3.NONE,
        )
        conn = ldap3.Connection(
            server,
            user=credentials.get("ldap_bind_dn") or credentials.get("ldap_username"),
            password=credentials.get("ldap_password"),
            auto_bind=True,
            receive_timeout=int(check_definition.get("timeout_seconds", 15)),
        )
        attrs = check_definition.get("ldap_attributes") or ldap3.ALL_ATTRIBUTES
        conn.search(base, flt, attributes=attrs)
        entries = list(conn.entries)
        conn.unbind()
    except Exception as exc:  # noqa: BLE001
        return _err_result(f"LDAP search failed: {exc}", started=started)
    expect = check_definition.get("expect") or {"kind": "result_count_zero"}
    count = len(entries)
    if expect["kind"] == "result_count_zero":
        ok, detail = count == 0, f"entries={count}"
    elif expect["kind"] == "result_count_nonzero":
        ok, detail = count > 0, f"entries={count}"
    else:
        ok, detail = False, f"unknown expect kind: {expect['kind']!r}"
    pass_msg = check_definition.get("pass_message") or "AD/LDAP check passed."
    fail_msg = check_definition.get("fail_message") or "AD/LDAP check failed."
    return _wrap_remote(
        "passed" if ok else "failed",
        f"{pass_msg if ok else fail_msg} ({detail})",
        {"base_dn": base, "filter": flt, "count": count, "expectation_detail": detail},
        started, t0,
    )


def run_azure(check_definition: dict, credentials: dict) -> dict:
    """azure_readonly — service principal lists resources of a given type."""
    started = datetime.now(timezone.utc).isoformat()
    t0 = time.time()
    try:
        from azure.identity import ClientSecretCredential  # type: ignore
        from azure.mgmt.resource import ResourceManagementClient  # type: ignore
    except ImportError:
        return _err_result("Azure runner needs `pip install azure-identity azure-mgmt-resource` on the collector.", started=started)
    sub = credentials.get("azure_subscription_id")
    tenant = credentials.get("azure_tenant_id")
    cid = credentials.get("azure_client_id")
    secret = credentials.get("azure_client_secret")
    if not all([sub, tenant, cid, secret]):
        return _err_result("Azure creds missing (subscription_id, tenant_id, client_id, client_secret)", started=started)
    resource_type = check_definition.get("azure_resource_type")
    if not resource_type:
        return _err_result("missing azure_resource_type (e.g. 'Microsoft.Storage/storageAccounts')", started=started)
    try:
        cred = ClientSecretCredential(tenant_id=tenant, client_id=cid, client_secret=secret)
        rm = ResourceManagementClient(cred, sub)
        resources = list(rm.resources.list(filter=f"resourceType eq '{resource_type}'"))
    except Exception as exc:  # noqa: BLE001
        return _err_result(f"Azure call failed: {exc}", started=started)
    expect = check_definition.get("expect") or {"kind": "result_count_zero"}
    count = len(resources)
    if expect["kind"] == "result_count_zero":
        ok, detail = count == 0, f"resources_found={count}"
    elif expect["kind"] == "result_count_nonzero":
        ok, detail = count > 0, f"resources_found={count}"
    else:
        ok, detail = False, f"unknown expect kind: {expect['kind']!r}"
    pass_msg = check_definition.get("pass_message") or f"Azure {resource_type}: passed"
    fail_msg = check_definition.get("fail_message") or f"Azure {resource_type}: failed"
    return _wrap_remote(
        "passed" if ok else "failed",
        f"{pass_msg if ok else fail_msg} ({detail})",
        {"resource_type": resource_type, "count": count,
         "sample": [str(r.id) for r in resources[:5]],
         "expectation_detail": detail},
        started, t0,
    )


def run_k8s(check_definition: dict, credentials: dict) -> dict:
    """k8s_api — read-only GET against the cluster API."""
    started = datetime.now(timezone.utc).isoformat()
    t0 = time.time()
    try:
        from kubernetes import client as k8s_client, config as k8s_config  # type: ignore
    except ImportError:
        return _err_result("K8s runner needs `pip install kubernetes pyyaml` on the collector.", started=started)
    kubeconfig_text = credentials.get("kubeconfig")
    server = credentials.get("k8s_server")
    token = credentials.get("k8s_token")
    ca = credentials.get("k8s_ca_cert")
    if not kubeconfig_text and not (server and token):
        return _err_result("K8s creds missing — need kubeconfig OR (k8s_server + k8s_token)", started=started)
    api_path = check_definition.get("k8s_api")
    if not api_path:
        return _err_result("missing k8s_api (e.g. '/api/v1/namespaces/kube-system/pods')", started=started)
    try:
        cfg = k8s_client.Configuration()
        if kubeconfig_text:
            import tempfile as _tf
            with _tf.NamedTemporaryFile("w", suffix=".yaml", delete=False) as tf:
                tf.write(kubeconfig_text)
                kpath = tf.name
            try:
                k8s_config.load_kube_config(config_file=kpath, client_configuration=cfg)
            finally:
                try:
                    os.unlink(kpath)
                except Exception:
                    pass
        else:
            cfg.host = server
            cfg.api_key = {"authorization": f"Bearer {token}"}
            if ca:
                import tempfile as _tf
                with _tf.NamedTemporaryFile("w", suffix=".crt", delete=False) as cf:
                    cf.write(ca)
                    cfg.ssl_ca_cert = cf.name
            else:
                cfg.verify_ssl = False
        api = k8s_client.ApiClient(cfg)
        resp = api.call_api(api_path, "GET", response_type="object",
                            _return_http_data_only=True, _preload_content=True)
    except Exception as exc:  # noqa: BLE001
        return _err_result(f"K8s GET failed: {exc}", started=started)
    items = (resp or {}).get("items", []) if isinstance(resp, dict) else []
    expect = check_definition.get("expect") or {"kind": "result_count_nonzero"}
    count = len(items)
    if expect["kind"] == "result_count_zero":
        ok, detail = count == 0, f"items={count}"
    elif expect["kind"] == "result_count_nonzero":
        ok, detail = count > 0, f"items={count}"
    else:
        ok, detail = False, f"unknown expect kind: {expect['kind']!r}"
    pass_msg = check_definition.get("pass_message") or "K8s check passed."
    fail_msg = check_definition.get("fail_message") or "K8s check failed."
    return _wrap_remote(
        "passed" if ok else "failed",
        f"{pass_msg if ok else fail_msg} ({detail})",
        {"api_path": api_path, "count": count, "expectation_detail": detail},
        started, t0,
    )


def run_remote(runner_type: str, check_definition: dict, credentials: dict) -> dict:
    """Dispatcher for collector-mode jobs."""
    if runner_type in ("linux_ssh", "netdev_ssh"):
        return run_ssh(check_definition, credentials)
    if runner_type == "oracle_sql":
        return run_sql(check_definition, credentials, "oracle")
    if runner_type == "mssql_sql":
        return run_sql(check_definition, credentials, "mssql")
    if runner_type == "postgres_sql":
        return run_sql(check_definition, credentials, "postgres")
    if runner_type == "mysql_sql":
        return run_sql(check_definition, credentials, "mysql")
    if runner_type == "ldap_query":
        return run_ldap(check_definition, credentials)
    if runner_type == "azure_readonly":
        return run_azure(check_definition, credentials)
    if runner_type == "k8s_api":
        return run_k8s(check_definition, credentials)
    return _err_result(f"unknown runner_type {runner_type!r}")


def _err_result(msg: str, started: str | None = None, duration_ms: int = 0) -> dict:
    started = started or datetime.now(timezone.utc).isoformat()
    return {
        "status": "error",
        "result_summary": msg,
        "raw_output": {"error": msg},
        "started_at": started,
        "completed_at": datetime.now(timezone.utc).isoformat(),
        "duration_ms": duration_ms,
    }


# ─── HTTP helpers ─────────────────────────────────────────────────────────
def http_request(method: str, path: str, body: dict | None = None,
                 token: str | None = None, timeout: int = 20) -> dict:
    data = json.dumps(body).encode("utf-8") if body is not None else None
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(f"{BACKEND_URL}{path}", data=data, method=method, headers=headers)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        raw = resp.read().decode("utf-8")
        return json.loads(raw) if raw else {}


# ─── Lifecycle ────────────────────────────────────────────────────────────
def load_state() -> dict:
    if STATE_FILE.exists():
        try:
            return json.loads(STATE_FILE.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            pass
    return {}


def save_state(state: dict) -> None:
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    STATE_FILE.write_text(json.dumps(state, indent=2), encoding="utf-8")


def enroll(enrollment_token: str) -> dict:
    print(f"[enroll] {BACKEND_URL}/grc/agents/enroll …", flush=True)
    body = {
        "enrollment_token": enrollment_token,
        "hostname": socket.gethostname(),
        "ip_address": _local_ip(),
        "os_family": detect_os().get("os_family", "unknown"),
        "agent_version": AGENT_VERSION,
    }
    resp = http_request("POST", "/grc/agents/enroll", body)
    api_token = resp.get("api_token")
    if not api_token:
        raise RuntimeError(f"enroll failed: no api_token — {resp}")
    state = {"api_token": api_token, "agent_id": resp.get("agent_id"),
             "enrolled_at": int(time.time())}
    save_state(state)
    print(f"[enroll] OK — agent_id={state['agent_id']}", flush=True)
    return state


def _local_ip() -> str:
    try:
        return socket.gethostbyname(socket.gethostname())
    except Exception:
        return "0.0.0.0"


# ─── Software inventory ("room and chair" detection) ─────────────────────
# The host OS gets CIS rules (the room), but applications running inside
# (SQL Server, IIS, Tomcat — the chairs) need their own benchmarks. The
# agent is the only honest witness of what's actually on the box, so it
# reports a 3-layer inventory on every heartbeat:
#   Layer 1: Windows Server roles    (Get-WindowsFeature) / n.a. on Linux
#   Layer 2: installed applications  (registry Uninstall keys / dpkg / rpm)
#   Layer 3: listening services      (netstat — catches zip/portable installs)
# Backend normalizes names → software_keys → benchmark match. Agent only
# collects; it never decides what's promotable.

_SW_CACHE: dict = {"at": 0.0, "data": None}
_SW_CACHE_TTL = 3600  # re-scan at most hourly; inventory changes slowly


def detect_installed_software() -> list:
    now = time.time()
    if _SW_CACHE["data"] is not None and now - _SW_CACHE["at"] < _SW_CACHE_TTL:
        return _SW_CACHE["data"]
    sysname = platform.system().lower()
    items: list = []
    try:
        if "windows" in sysname:
            items = _sw_windows()
        elif sysname == "linux":
            items = _sw_linux()
    except Exception as exc:  # noqa: BLE001
        print(f"[software] inventory failed: {exc}", flush=True)
    _SW_CACHE["at"] = now
    _SW_CACHE["data"] = items
    return items


def _sw_windows() -> list:
    out: list = []
    seen: set = set()
    # Layer 1 — Windows Server roles (fails harmlessly on Win 10/11 client)
    try:
        ps = ("Get-WindowsFeature | Where-Object {$_.Installed -eq $true -and "
              "$_.FeatureType -eq 'Role'} | Select-Object -ExpandProperty Name")
        raw = subprocess.check_output(
            ["powershell", "-NoProfile", "-Command", ps],
            timeout=60, stderr=subprocess.DEVNULL).decode("utf-8", "replace")
        for line in raw.splitlines():
            name = line.strip()
            if name and name.lower() not in seen:
                seen.add(name.lower())
                out.append({"name": name, "version": None, "source": "windows_role"})
    except Exception:
        pass  # client SKUs don't have Get-WindowsFeature
    # Layer 2 — installed applications from registry Uninstall keys.
    # Deliberately NOT Win32_Product (slow + triggers MSI self-repair).
    try:
        ps = (
            "Get-ItemProperty HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*,"
            "HKLM:\\Software\\Wow6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\* "
            "-ErrorAction SilentlyContinue | "
            "Where-Object {$_.DisplayName} | "
            "Select-Object DisplayName, DisplayVersion | ConvertTo-Json -Compress"
        )
        raw = subprocess.check_output(
            ["powershell", "-NoProfile", "-Command", ps],
            timeout=60, stderr=subprocess.DEVNULL).decode("utf-8", "replace")
        data = json.loads(raw) if raw.strip() else []
        if isinstance(data, dict):
            data = [data]
        for entry in data:
            name = (entry.get("DisplayName") or "").strip()
            if name and name.lower() not in seen:
                seen.add(name.lower())
                out.append({
                    "name": name,
                    "version": (entry.get("DisplayVersion") or "").strip() or None,
                    "source": "registry",
                })
    except Exception as exc:  # noqa: BLE001
        print(f"[software] registry scan failed: {exc}", flush=True)
    # Layer 3 — listening services (catches portable installs with no
    # registry entry: unzipped Tomcat, nginx.exe in a folder, etc).
    try:
        ps = (
            "Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | "
            "Select-Object -ExpandProperty OwningProcess -Unique | "
            "ForEach-Object { (Get-Process -Id $_ -ErrorAction SilentlyContinue).ProcessName } | "
            "Sort-Object -Unique"
        )
        raw = subprocess.check_output(
            ["powershell", "-NoProfile", "-Command", ps],
            timeout=30, stderr=subprocess.DEVNULL).decode("utf-8", "replace")
        for line in raw.splitlines():
            proc = line.strip()
            if proc and f"proc:{proc.lower()}" not in seen and proc.lower() not in (
                    "svchost", "system", "lsass", "services", "wininit", "idle"):
                seen.add(f"proc:{proc.lower()}")
                out.append({"name": proc, "version": None, "source": "listening_process"})
    except Exception:
        pass
    return out


def _sw_linux() -> list:
    out: list = []
    seen: set = set()
    # Layer 2 — package manager
    for cmd, parser in (
        (["dpkg-query", "-W", "-f", "${Package}\\t${Version}\\n"], "dpkg"),
        (["rpm", "-qa", "--qf", "%{NAME}\\t%{VERSION}\\n"], "rpm"),
    ):
        try:
            raw = subprocess.check_output(cmd, timeout=60, stderr=subprocess.DEVNULL).decode("utf-8", "replace")
            for line in raw.splitlines():
                if "\\t" in line or "\t" in line:
                    parts = line.replace("\\t", "\t").split("\t")
                    name = parts[0].strip()
                    ver = parts[1].strip() if len(parts) > 1 else None
                    # Only report server-relevant packages, not all 2000 libs
                    if name and any(k in name.lower() for k in (
                            "apache", "httpd", "nginx", "tomcat", "mysql", "mariadb",
                            "postgresql", "postgres", "mongo", "redis", "cassandra",
                            "elasticsearch", "docker", "containerd", "kubelet",
                            "openssh-server", "vsftpd", "bind9", "named", "squid",
                            "haproxy", "rabbitmq", "kafka", "oracle", "mssql")):
                        if name.lower() not in seen:
                            seen.add(name.lower())
                            out.append({"name": name, "version": ver, "source": parser})
            break  # first package manager that works wins
        except Exception:
            continue
    # Layer 3 — listening sockets
    try:
        raw = subprocess.check_output(["ss", "-tlnp"], timeout=15, stderr=subprocess.DEVNULL).decode("utf-8", "replace")
        for m in re.finditer(r'users:\(\("([^"]+)"', raw):
            proc = m.group(1)
            if proc and f"proc:{proc.lower()}" not in seen and proc not in ("sshd",):
                seen.add(f"proc:{proc.lower()}")
                out.append({"name": proc, "version": None, "source": "listening_process"})
    except Exception:
        pass
    return out


def heartbeat(token: str) -> None:
    osprof = detect_os()
    body = {
        "hostname": socket.gethostname(),
        "ip_address": _local_ip(),
        "agent_version": AGENT_VERSION,
        "os_family": osprof.get("os_family"),
        "os_version": osprof.get("os_version"),
        "os_build": osprof.get("os_build"),
        "os_edition": osprof.get("os_edition"),
        "os_normalized": osprof.get("os_normalized"),
        "installed_software": detect_installed_software(),
    }
    try:
        resp = http_request("POST", "/grc/agents/heartbeat", body, token=token)
        print(f"[heartbeat] OK agent_id={resp.get('agent_id')} "
              f"linked_asset_id={resp.get('linked_asset_id')} "
              f"os_normalized={body['os_normalized']}", flush=True)
    except urllib.error.HTTPError as e:
        msg = e.read().decode("utf-8", errors="replace")[:200]
        print(f"[heartbeat] HTTP {e.code}: {msg}", flush=True)
        if e.code == 401:
            # Token was revoked (operator wiped the agent on the admin
            # page, or the row was cleaned up). Signal the main loop to
            # re-enroll instead of just exiting — exiting forces the
            # operator to manually delete state.json before the next
            # install can succeed, which is awful UX. We raise a
            # specific exception the loop catches and handles.
            print("[heartbeat] token revoked — wiping stale state and re-enrolling", flush=True)
            raise _TokenRevoked()


class _TokenRevoked(Exception):
    """Raised when the backend rejects our api_token (status 401). The
    main loop catches this, deletes the cached state file, and re-runs
    the enrollment handshake using the freshest enrollment.txt."""
    pass


def fetch_and_run_jobs(token: str) -> None:
    # Long-poll: backend holds the request up to 25s waiting for a
    # Scan-now flag. If a Scan-now click happens mid-poll, we return
    # IMMEDIATELY with the rule set instead of waiting for the next tick.
    # Keeps the natural 30s rhythm AND collapses Scan-now latency.
    try:
        resp = http_request("GET", f"/grc/agents/jobs?limit={MAX_JOBS_PER_TICK}&wait=25",
                            token=token, timeout=35)
    except urllib.error.HTTPError as e:
        msg = e.read().decode("utf-8", errors="replace")[:200]
        print(f"[jobs] HTTP {e.code}: {msg}", flush=True)
        return
    jobs = resp.get("jobs") or []
    if not jobs:
        print("[jobs] no work this tick", flush=True)
        return
    print(f"[jobs] received {len(jobs)} jobs — executing…", flush=True)
    results = []
    t_start = time.time()
    for i, job in enumerate(jobs, 1):
        check_def = job.get("check_definition") or {}
        runner = (job.get("runner_type") or "").lower()
        # Collector agents dispatch by runner_type to a remote-target
        # executor (paramiko SSH, oracledb, pymssql, psycopg2, pymysql,
        # ldap3, etc.). Endpoint agents stick to local PowerShell/bash.
        if AGENT_MODE == "collector" and runner and runner not in ("windows_winrm",):
            creds = job.get("credentials") or {}
            result = run_remote(runner, check_def, creds)
        else:
            result = run_local(check_def)
        result["plugin_id"] = job.get("plugin_id")
        if job.get("asset_id"):
            result["asset_id"] = job["asset_id"]
        # Collector-routed jobs carry a run_id of the pre-created pending
        # CompliancePluginRun. Echo it back so the backend updates that
        # exact row instead of creating a new one (avoids orphan duplicates
        # and lets the operator's progress UI see the same run resolve).
        if job.get("run_id"):
            result["run_id"] = job["run_id"]
        results.append(result)
        if i % 25 == 0 or i == len(jobs):
            elapsed = time.time() - t_start
            print(f"[jobs] {i}/{len(jobs)} done ({elapsed:.0f}s elapsed)", flush=True)
    try:
        resp = http_request("POST", "/grc/agents/results", {"runs": results}, token=token, timeout=60)
        print(f"[jobs] uploaded: inserted={resp.get('inserted')} skipped={resp.get('skipped')}", flush=True)
    except urllib.error.HTTPError as e:
        msg = e.read().decode("utf-8", errors="replace")[:200]
        print(f"[jobs] result upload HTTP {e.code}: {msg}", flush=True)


def main() -> None:
    print(f"=== Compliverse Agent {AGENT_VERSION} ===", flush=True)
    print(f"Backend  : {BACKEND_URL}", flush=True)
    print(f"Hostname : {socket.gethostname()}", flush=True)
    print(f"OS       : {json.dumps(detect_os())}", flush=True)
    print(f"Tick     : {TICK_SECONDS}s", flush=True)

    # ── Agent-side OS fence ──
    # The setup script may set COMPLYVERSE_EXPECT_OS=windows|linux|macos
    # when it kicks off the agent. If the box we're actually running on
    # disagrees with that, refuse to enrol. Defence-in-depth alongside
    # the backend /enroll check — catches "right installer downloaded,
    # wrong machine" before we ever phone home.
    expected_os = (os.environ.get("COMPLYVERSE_EXPECT_OS") or "").lower().strip()
    if expected_os:
        actual_os = detect_os().get("os_family") or platform.system().lower()
        if actual_os == "darwin":
            actual_os = "macos"
        if actual_os != expected_os:
            print(
                f"ERROR: this agent build expected os_family={expected_os!r}, "
                f"but the host is {actual_os!r}. Download the correct installer "
                "from the admin Agents page.",
                flush=True,
            )
            sys.exit(3)

    state = load_state()
    if not state.get("api_token"):
        token = os.environ.get("COMPLYVERSE_ENROLL")
        if not token and len(sys.argv) > 1:
            token = sys.argv[1]
        if not token:
            enr_file = STATE_DIR / "enrollment.txt"
            if enr_file.exists():
                token = enr_file.read_text(encoding="utf-8").strip()
        if not token:
            print("ERROR: no enrollment token. Set COMPLYVERSE_ENROLL or pass as arg.", flush=True)
            sys.exit(2)
        state = enroll(token)

    api_token = state["api_token"]
    print(f"\n[loop] starting every {TICK_SECONDS}s — Ctrl+C to stop\n", flush=True)
    while True:
        try:
            heartbeat(api_token)
            fetch_and_run_jobs(api_token)
        except _TokenRevoked:
            # Backend rejected our api_token (revoked from admin UI or
            # operator wiped stale rows). Auto-recover: clear the state
            # file, re-enroll using the latest enrollment.txt, continue.
            try:
                STATE_FILE.unlink(missing_ok=True)
            except Exception:
                pass
            enr_file = STATE_DIR / "enrollment.txt"
            if not enr_file.exists():
                print("[loop] no enrollment.txt on disk — cannot re-enroll. "
                      "Re-run the installer to get a fresh token.", flush=True)
                sys.exit(1)
            fresh_token = enr_file.read_text(encoding="utf-8").strip()
            print(f"[loop] re-enrolling with fresh token from {enr_file}", flush=True)
            try:
                state = enroll(fresh_token)
                api_token = state["api_token"]
                print("[loop] re-enrollment OK, resuming heartbeat", flush=True)
                continue   # skip the sleep, heartbeat right away
            except Exception as ee:
                print(f"[loop] re-enrollment failed: {ee}", flush=True)
                # Fall through to the sleep and try again next tick.
        except KeyboardInterrupt:
            # Re-raise so the outer try/except in __main__ logs cleanly.
            raise
        except Exception as e:
            # ANY other failure (backend down, network blip, timeout,
            # DNS hiccup, unexpected JSON) must NOT crash the loop. The
            # old behaviour exited python which left the agent silent
            # for minutes until Task Scheduler re-fired it. Now: log it,
            # sleep, and try again on the next tick. The backend was
            # restarted 7+ times during one debug session and the agent
            # would die every time. This catch-all is the fix for that.
            print(f"[loop] tick failed: {type(e).__name__}: {e}. "
                  f"Retrying in {TICK_SECONDS}s.", flush=True)
        time.sleep(TICK_SECONDS)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n[stop] interrupted by user", flush=True)
