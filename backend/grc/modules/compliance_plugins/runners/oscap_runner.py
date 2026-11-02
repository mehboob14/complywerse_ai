"""OpenSCAP (oscap) runner — real CIS/STIG evaluation for Linux hosts.

Why this exists: the PDF-auto-generated Linux CIS rules produced non-executable
commands (e.g. ``grep -E 'x' |``), so every Linux scan failed. This runner
replaces that with the industry-standard OpenSCAP engine + the SCAP Security
Guide (SSG) content, which ships real, validated checks.

Design — one scan, many rules:
    A CIS profile has ~200 rules, but ``oscap xccdf eval`` evaluates the WHOLE
    profile in a single invocation. The plugin engine, however, calls a runner
    once PER rule. So the first rule of a scan triggers exactly one oscap run;
    its parsed per-rule verdicts are cached (keyed by host+datastream+profile)
    and every subsequent rule in the same scan reads its verdict from the cache.
    A short TTL means a fresh "Scan now" re-runs oscap.

Read-only contract: ``oscap xccdf eval`` only inspects the system; it never
remediates (that would be ``oscap xccdf remediate``, which we never call).

check_definition shape (set by the SSG importer):
    {
      "oscap": {
        "rule_id":   "xccdf_org.ssgproject.content_rule_...",   # the rule to report
        "datastream":"/opt/ssg/content/ssg-ubuntu2404-ds.xml",  # SCAP datastream
        "profile":   "xccdf_org.ssgproject.content_profile_cis_level1_server"
      }
    }

Target resolution:
    * local host (asset == the box the backend runs on) → run ``oscap`` directly.
    * remote host → ``oscap-ssh <user>@<host> <port> xccdf eval ...`` (needs the
      SSH creds already resolved for linux_ssh, plus oscap-ssh on the backend
      host and oscap on the target).
"""
from __future__ import annotations

import os
import socket
import subprocess
import tempfile
import threading
import time
import xml.etree.ElementTree as ET
from typing import Any, Dict, Optional, Tuple

from .registry import register, RunnerResult

# ── result cache: one oscap run serves every rule in a scan ──────────────────
_CACHE: Dict[Tuple[str, str, str], Dict[str, Any]] = {}
_CACHE_LOCK = threading.Lock()
_CACHE_TTL_SECONDS = 300  # a fresh scan after this re-runs oscap

# oscap xccdf eval exit codes: 0 = all pass, 1 = error, 2 = some rules failed.
# 0 and 2 are both "the scan ran"; only 1 is a real failure.
_OK_EXIT = {0, 2}

# XCCDF <result> value → our RunnerResult.status
_STATUS_MAP = {
    "pass": "passed",
    "fixed": "passed",
    "fail": "failed",
    "error": "error",
    "unknown": "error",
    # everything below means "the rule did not apply / was not evaluated"
    "notapplicable": "skipped",
    "notchecked": "skipped",
    "notselected": "skipped",
    "informational": "skipped",
}


def _local_identities() -> set[str]:
    ids = {"", "localhost", "127.0.0.1", "::1", "self"}
    try:
        ids.add(socket.gethostname().lower())
        ids.add(socket.getfqdn().lower())
    except Exception:
        pass
    return ids


def _is_local_target(host: Optional[str]) -> bool:
    return (host or "").strip().lower() in _local_identities()


def _strip_ns(tag: str) -> str:
    return tag.rsplit("}", 1)[-1] if "}" in tag else tag


def _parse_results(results_path: str) -> Dict[str, str]:
    """Parse an XCCDF results file into {rule_id: xccdf_result_string}."""
    verdicts: Dict[str, str] = {}
    tree = ET.parse(results_path)
    for el in tree.iter():
        if _strip_ns(el.tag) != "rule-result":
            continue
        rule_id = el.get("idref")
        if not rule_id:
            continue
        for child in el:
            if _strip_ns(child.tag) == "result":
                verdicts[rule_id] = (child.text or "").strip().lower()
                break
    return verdicts


def _build_command(host: Optional[str], creds: Dict[str, Any],
                   datastream: str, profile: str, results_path: str,
                   remote_sudo: bool = False) -> list[str]:
    if _is_local_target(host):
        # Local scan needs root to read /etc/shadow, sysctl, etc. The backend
        # user must have passwordless sudo for oscap (see deploy runbook).
        base = ["sudo", "-n", "oscap", "xccdf", "eval"]
    else:
        user = creds.get("ssh_username") or "root"
        port = str(creds.get("ssh_port") or 22)
        # oscap-ssh --sudo runs `sudo oscap` on the target. Only passed when the
        # user has passwordless sudo (probed by _remote_sudo_ok) — without root,
        # checks that read the effective config (sshd -T, auditd, …) return
        # "error" instead of a real pass/fail.
        base = ["oscap-ssh"] + (["--sudo"] if remote_sudo else []) + [f"{user}@{host}", port, "xccdf", "eval"]
    return base + [
        "--profile", profile,
        "--results", results_path,
        datastream,
    ]


def _remote_sudo_ok(host: str, creds: Dict[str, Any],
                    ssh_opts: list[str], use_sshpass: bool,
                    env: Dict[str, str]) -> bool:
    """True if the SSH user has passwordless sudo on the target. Uses `sudo -n`
    so a user without it fails fast (never hangs on a password prompt over the
    non-tty ssh), in which case the scan just runs unprivileged."""
    user = creds.get("ssh_username") or "root"
    port = str(creds.get("ssh_port") or 22)
    cmd = ["ssh", *ssh_opts, "-o", "ConnectTimeout=10",
           "-p", port, f"{user}@{host}", "sudo", "-n", "true"]
    if use_sshpass:
        cmd = ["sshpass", "-e", *cmd]
    try:
        return subprocess.run(cmd, capture_output=True, text=True,
                              timeout=25, env=env).returncode == 0
    except Exception:  # noqa: BLE001
        return False


def _run_oscap(host: Optional[str], creds: Dict[str, Any],
               datastream: str, profile: str) -> Dict[str, Any]:
    """Run oscap once and return {'verdicts': {...}, 'error': str|None}."""
    if not os.path.exists(datastream) and _is_local_target(host):
        return {"verdicts": {}, "error": f"SCAP datastream not found: {datastream}"}

    fd, results_path = tempfile.mkstemp(prefix="oscap-", suffix=".xml")
    os.close(fd)
    try:
        env = dict(os.environ)
        remote_sudo = False
        use_sshpass = False
        if not _is_local_target(host):
            # oscap-ssh shells out to system ssh/scp. Trust-on-first-use
            # (accept-new) is the right model for a scanner hitting freshly
            # registered assets: add an unseen host key, still reject a changed
            # one. ssh_accept_unknown_hosts opts out of even that check.
            # shortcut: TOFU not pinned keys — honour ssh_known_hosts if an
            # asset's SSH identity must be verified up front.
            strict = "no" if creds.get("ssh_accept_unknown_hosts") else "accept-new"
            ssh_opts = ["-o", f"StrictHostKeyChecking={strict}"]
            env["SSH_ADDITIONAL_OPTIONS"] = " ".join(ssh_opts)
            # Password auth: oscap-ssh opens one -M master connection that
            # authenticates once (then reuses the control socket), so a single
            # sshpass -e feed covers the whole run. Skip when a key is supplied.
            pw = creds.get("ssh_password")
            use_sshpass = bool(pw and not creds.get("ssh_private_key"))
            if use_sshpass:
                env["SSHPASS"] = pw
            remote_sudo = _remote_sudo_ok(host, creds, ssh_opts, use_sshpass, env)
        cmd = _build_command(host, creds, datastream, profile, results_path, remote_sudo)
        if use_sshpass:
            cmd = ["sshpass", "-e", *cmd]
        proc = subprocess.run(
            cmd, capture_output=True, text=True, timeout=900, env=env,
        )
        if proc.returncode not in _OK_EXIT:
            return {
                "verdicts": {},
                "error": f"oscap exited {proc.returncode}: "
                         f"{(proc.stderr or proc.stdout or '').strip()[:400]}",
            }
        if not os.path.getsize(results_path):
            return {"verdicts": {}, "error": "oscap produced no results file"}
        return {"verdicts": _parse_results(results_path), "error": None}
    except subprocess.TimeoutExpired:
        return {"verdicts": {}, "error": "oscap timed out (>900s)"}
    except Exception as exc:  # noqa: BLE001
        return {"verdicts": {}, "error": f"oscap invocation failed: {exc}"}
    finally:
        try:
            os.unlink(results_path)
        except Exception:
            pass


def _get_scan_verdicts(host: Optional[str], creds: Dict[str, Any],
                       datastream: str, profile: str) -> Dict[str, Any]:
    """Return the cached oscap verdicts for this (host, datastream, profile),
    running oscap exactly once per scan window under a lock."""
    key = ((host or "local").lower(), datastream, profile)
    now = time.time()
    with _CACHE_LOCK:
        hit = _CACHE.get(key)
        if hit and (now - hit["ts"]) < _CACHE_TTL_SECONDS:
            return hit
        entry = _run_oscap(host, creds, datastream, profile)
        entry["ts"] = now
        _CACHE[key] = entry
        return entry


@register("oscap")
def run_oscap(check_definition: Dict[str, Any], credentials: Dict[str, Any]) -> RunnerResult:
    spec = check_definition.get("oscap") or {}
    rule_id = spec.get("rule_id")
    datastream = spec.get("datastream")
    profile = spec.get("profile")
    if not (rule_id and datastream and profile):
        return RunnerResult(
            status="error",
            summary="oscap check misconfigured (need rule_id, datastream, profile).",
            error_message="missing_oscap_spec",
        )

    host = credentials.get("ssh_host") or credentials.get("host")
    scan = _get_scan_verdicts(host, credentials, datastream, profile)

    if scan.get("error") and not scan.get("verdicts"):
        return RunnerResult(
            status="error",
            summary=f"OpenSCAP scan failed: {scan['error']}",
            error_message=scan["error"],
            raw_output={"oscap_error": scan["error"], "rule_id": rule_id},
        )

    verdict = scan["verdicts"].get(rule_id)
    if verdict is None:
        # Rule wasn't in the profile's evaluated set (deselected/not present).
        return RunnerResult(
            status="skipped",
            summary=f"Rule not evaluated by profile ({rule_id}).",
            raw_output={"rule_id": rule_id, "reason": "not_in_profile"},
        )

    status = _STATUS_MAP.get(verdict, "error")
    pretty = {"passed": "Compliant", "failed": "Non-compliant",
              "skipped": "Not applicable", "error": "Check error"}.get(status, verdict)
    return RunnerResult(
        status=status,
        summary=f"{pretty} (OpenSCAP: {verdict}).",
        raw_output={"engine": "openscap", "rule_id": rule_id,
                    "xccdf_result": verdict, "profile": profile},
    )
