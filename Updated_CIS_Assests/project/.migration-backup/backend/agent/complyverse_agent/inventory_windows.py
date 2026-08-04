"""Local Windows inventory probe — the "room and chair" collector.

The cloud heartbeat endpoint (`/grc/agents/heartbeat`) accepts an OS
profile plus a 3-layer `installed_software` inventory and enriches it into
the linked asset's `detected_software_json`, which drives the
"Applications on this host" panel and the per-application benchmark
matcher.

The server side was always ready to receive this; the agent client just
never gathered it. This module closes that gap. It is endpoint-mode only
(the host running the agent == the host being inventoried) and read-only:
it reads the OS caption, the Uninstall registry hive, installed Windows
Server roles, and the set of listening TCP processes. Nothing here writes
to the host.

Three inventory layers, matching `software_normaliser._SOFTWARE_PATTERNS`:
  Layer 1  windows_role   — Get-WindowsFeature (Server SKUs only)
  Layer 2  registry       — HKLM/HKCU Uninstall DisplayName + DisplayVersion
  Layer 3  listening       — owning process name of each listening TCP port

The backend drops everything that isn't security-relevant (browsers,
runtimes, redistributables, …) via `normalise_software`, so we report
generously and let the server filter.
"""
from __future__ import annotations

import json
import logging
import platform
import subprocess
from typing import Any, Optional

logger = logging.getLogger(__name__)


# Single read-only PowerShell probe. Emits one compact JSON object with the
# OS profile and the raw 3-layer software inventory. Every collector clause
# is wrapped so a failure in one layer (e.g. Get-WindowsFeature missing on a
# client SKU) never aborts the others.
_PROBE_PS = r"""
$ErrorActionPreference = 'SilentlyContinue'
$ProgressPreference = 'SilentlyContinue'

# --- OS profile -------------------------------------------------------------
$os  = Get-CimInstance Win32_OperatingSystem
$cv  = Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion'

# --- Layer 2: registry-installed applications -------------------------------
$uninstallPaths = @(
  'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*',
  'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*',
  'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*'
)
$apps = foreach ($p in $uninstallPaths) {
  Get-ItemProperty $p | Where-Object { $_.DisplayName } | ForEach-Object {
    [pscustomobject]@{ name = "$($_.DisplayName)"; version = "$($_.DisplayVersion)"; source = 'registry' }
  }
}

# --- Layer 1: installed Windows Server roles (Server SKUs only) -------------
$roles = @()
if (Get-Command Get-WindowsFeature -ErrorAction SilentlyContinue) {
  $roles = Get-WindowsFeature | Where-Object { $_.Installed } | ForEach-Object {
    [pscustomobject]@{ name = "$($_.Name)"; version = $null; source = 'windows_role' }
  }
}

# --- Layer 3: listening TCP processes ---------------------------------------
$listen = @()
if (Get-Command Get-NetTCPConnection -ErrorAction SilentlyContinue) {
  $listen = Get-NetTCPConnection -State Listen |
    Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object {
      $proc = Get-Process -Id $_ -ErrorAction SilentlyContinue
      if ($proc) { [pscustomobject]@{ name = "$($proc.ProcessName)"; version = $null; source = 'listening_process' } }
    }
}

$software = @()
$software += $apps
$software += $roles
$software += $listen

$result = [pscustomobject]@{
  caption     = "$($os.Caption)"
  build       = "$($cv.DisplayVersion)"
  current_build = "$($cv.CurrentBuild)"
  edition     = "$($cv.EditionID)"
  product_type = $os.ProductType
  installed_software = @($software)
}
$result | ConvertTo-Json -Depth 4 -Compress
"""


def _normalise_os_key(caption: str, product_type: Optional[int]) -> str:
    """Best-effort level-2 OS key from the Windows caption. The backend
    recomputes/truncates this too, so we only need to be close."""
    c = (caption or "").lower()
    if "windows 11" in c:
        return "windows-11"
    if "windows 10" in c:
        return "windows-10"
    if "server 2022" in c:
        return "windows-server-2022"
    if "server 2019" in c:
        return "windows-server-2019"
    if "server 2016" in c:
        return "windows-server-2016"
    if "server 2012 r2" in c or "server 2012r2" in c:
        return "windows-server-2012r2"
    if "server 2012" in c:
        return "windows-server-2012"
    return "windows"


def _run_probe(timeout: int = 45) -> Optional[dict[str, Any]]:
    """Run the PowerShell probe and parse its JSON. Returns None on any
    failure — inventory is best-effort and must never break the heartbeat."""
    try:
        proc = subprocess.run(
            ["powershell", "-NoProfile", "-NonInteractive",
             "-ExecutionPolicy", "Bypass", "-Command", _PROBE_PS],
            capture_output=True, text=True, timeout=timeout,
        )
    except (subprocess.TimeoutExpired, FileNotFoundError, OSError) as exc:
        logger.warning("inventory probe failed to run: %s", exc)
        return None

    out = (proc.stdout or "").strip()
    if not out:
        logger.warning("inventory probe produced no output (stderr=%s)",
                       (proc.stderr or "")[:200])
        return None
    try:
        return json.loads(out)
    except json.JSONDecodeError as exc:
        logger.warning("inventory probe returned non-JSON: %s", exc)
        return None


def collect() -> dict[str, Any]:
    """Collect the OS profile + software inventory for this Windows host.

    Returns a dict ready to merge into the heartbeat body:
        os_family, os_version, os_build, os_edition, os_normalized,
        installed_software

    On non-Windows or any probe failure, returns an empty dict so the
    caller can simply `body.update(collect())` unconditionally.
    """
    if not platform.system().lower().startswith("win"):
        return {}

    data = _run_probe()
    if not data:
        return {}

    raw_sw = data.get("installed_software") or []
    # ConvertTo-Json collapses a single-element array into one object — and
    # an empty list into nothing. Normalise back to a list of dicts.
    if isinstance(raw_sw, dict):
        raw_sw = [raw_sw]
    elif not isinstance(raw_sw, list):
        raw_sw = []
    software = [
        {"name": e.get("name"), "version": (e.get("version") or None),
         "source": e.get("source")}
        for e in raw_sw
        if isinstance(e, dict) and e.get("name")
    ]

    caption = data.get("caption") or ""
    try:
        product_type = int(data.get("product_type")) if data.get("product_type") else None
    except (TypeError, ValueError):
        product_type = None

    profile: dict[str, Any] = {
        "os_family": "windows",
        "os_version": caption or None,
        "os_build": data.get("build") or data.get("current_build") or None,
        "os_edition": data.get("edition") or None,
        "os_normalized": _normalise_os_key(caption, product_type),
    }
    if software:
        profile["installed_software"] = software
    # Drop None values so we never clobber existing asset fields with nulls.
    return {k: v for k, v in profile.items() if v is not None}
