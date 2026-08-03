"""Local Linux inventory probe — the Linux twin of inventory_windows.

Endpoint-mode only (the host running the agent == the host being
inventoried) and read-only. Mirrors inventory_windows.collect() exactly:
returns a dict ready to merge into the heartbeat body, with the same
{name, version, source} software shape the cloud's enrich_inventory()
expects.

Three inventory layers, matching software_normaliser patterns:
  Layer 1  (none)          — no Linux equivalent of Windows Server roles
  Layer 2  dpkg | rpm      — installed packages (DisplayName + version twin)
  Layer 3  listening_process — owning process of each listening TCP socket

The backend drops everything that isn't security-relevant via
normalise_software, so we report generously and let the server filter.
"""
from __future__ import annotations

import logging
import platform
import re
import subprocess
from typing import Any, Optional

logger = logging.getLogger(__name__)


def _run(cmd: list[str], timeout: int = 20) -> Optional[str]:
    """Run a command, return stdout (str) or None on any failure. Inventory
    is best-effort and must never break the heartbeat."""
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    except (subprocess.TimeoutExpired, FileNotFoundError, OSError) as exc:
        logger.debug("inventory cmd %s failed: %s", cmd[:1], exc)
        return None
    return proc.stdout or None


def _read_os_release() -> dict[str, str]:
    """Parse /etc/os-release into a dict (ID, VERSION_ID, PRETTY_NAME, …)."""
    data: dict[str, str] = {}
    try:
        with open("/etc/os-release", encoding="utf-8") as fh:
            for line in fh:
                if "=" not in line:
                    continue
                k, _, v = line.partition("=")
                data[k.strip()] = v.strip().strip('"')
    except OSError:
        pass
    return data


def _normalise_os_key(osr: dict[str, str]) -> str:
    """Best-effort level-2 OS key from /etc/os-release. The backend
    re-truncates, so we only need to be close: ubuntu-24.04, rhel-9.4."""
    osid = (osr.get("ID") or "").lower().strip()
    ver = (osr.get("VERSION_ID") or "").strip()
    # Common ID aliases the library uses verbatim (ubuntu, debian, rhel,
    # centos, almalinux, rocky, ol→oraclelinux, amzn→amazonlinux, sles).
    alias = {"ol": "oraclelinux", "amzn": "amazonlinux",
             "rhel": "rhel", "sles": "sles"}.get(osid, osid)
    if alias and ver:
        return f"{alias}-{ver}"
    return alias or "linux"


def _packages() -> list[dict[str, Any]]:
    """Layer 2: installed packages via dpkg (Debian/Ubuntu) or rpm (RHEL)."""
    out = _run(["dpkg-query", "-W", "-f=${Package}\t${Version}\n"])
    if out:
        items = []
        for line in out.splitlines():
            name, _, ver = line.partition("\t")
            name = name.strip()
            if name:
                items.append({"name": name, "version": (ver.strip() or None),
                              "source": "dpkg"})
        return items
    out = _run(["rpm", "-qa", "--qf", "%{NAME}\t%{VERSION}\n"])
    if out:
        items = []
        for line in out.splitlines():
            name, _, ver = line.partition("\t")
            name = name.strip()
            if name:
                items.append({"name": name, "version": (ver.strip() or None),
                              "source": "rpm"})
        return items
    return []


_SS_PROC_RE = re.compile(r'\(\("([^"]+)"')


def _listening() -> list[dict[str, Any]]:
    """Layer 3: owning process name of each listening TCP socket via ss."""
    out = _run(["ss", "-tlnpH"]) or _run(["ss", "-tlnp"])
    if not out:
        return []
    names: set[str] = set()
    for line in out.splitlines():
        for m in _SS_PROC_RE.finditer(line):
            names.add(m.group(1))
    return [{"name": n, "version": None, "source": "listening_process"}
            for n in sorted(names)]


def collect() -> dict[str, Any]:
    """Collect the OS profile + software inventory for this Linux host.

    Returns a dict ready to merge into the heartbeat body, or {} on
    non-Linux or any probe failure so the caller can `body.update(collect())`
    unconditionally.
    """
    if platform.system().lower() != "linux":
        return {}

    osr = _read_os_release()
    software: list[dict[str, Any]] = []
    software += _packages()
    software += _listening()

    profile: dict[str, Any] = {
        "os_family": "linux",
        "os_version": osr.get("PRETTY_NAME") or osr.get("NAME") or None,
        "os_build": osr.get("VERSION_ID") or None,
        "os_normalized": _normalise_os_key(osr),
    }
    if software:
        profile["installed_software"] = software
    # Drop None values so we never clobber existing asset fields with nulls.
    return {k: v for k, v in profile.items() if v is not None}
