"""Agentless software inventory — the no-agent twin of the agent's
inventory_windows / inventory_linux collectors.

The agent heartbeat path (grc/modules/agents/router.py) collects a 3-layer
software inventory ON the box and POSTs it; the cloud enriches it into the
asset's detected_software_json, which drives the "Applications on this host"
panel. Agentless hosts had no equivalent — this module closes that gap.

Given a host's stored IntegrationConnection credential, it runs the SAME
probe REMOTELY (WinRM run_ps for Windows, SSH exec for Linux), parses the
output into the identical {name, version, source} shape, and feeds the
identical enrich_inventory() → asset.detected_software_json. Downstream
(panel, promotion, composite score) is unchanged — only the collection
transport differs.

Read-only: the probes only read the registry / installed packages /
listening sockets. Nothing here writes to the remote host.
"""
from __future__ import annotations

import io
import json
import logging
import re
from typing import Any, Optional

from sqlalchemy.orm import Session

from grc.models import IntegrationConnection, ITAsset
from grc.modules.compliance_plugins.services.credentials import (
    resolve_credentials_for_connection,
)
from grc.modules.compliance_plugins.services.software_normaliser import (
    enrich_inventory,
    preserve_promotions,
)

logger = logging.getLogger(__name__)

try:
    import winrm  # type: ignore
    WINRM_AVAILABLE = True
except Exception:  # noqa: BLE001
    WINRM_AVAILABLE = False

try:
    import paramiko  # type: ignore
    PARAMIKO_AVAILABLE = True
except Exception:  # noqa: BLE001
    PARAMIKO_AVAILABLE = False


# Same read-only PowerShell probe the agent runs locally (inventory_windows),
# emitting one compact JSON object with the 3-layer software inventory. Kept
# in sync deliberately as a copy so the backend has no import dependency on
# the agent package.
_WIN_PROBE_PS = r"""
$ErrorActionPreference = 'SilentlyContinue'
$ProgressPreference = 'SilentlyContinue'
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
$roles = @()
if (Get-Command Get-WindowsFeature -ErrorAction SilentlyContinue) {
  $roles = Get-WindowsFeature | Where-Object { $_.Installed } | ForEach-Object {
    [pscustomobject]@{ name = "$($_.Name)"; version = $null; source = 'windows_role' }
  }
}
$listen = @()
if (Get-Command Get-NetTCPConnection -ErrorAction SilentlyContinue) {
  $listen = Get-NetTCPConnection -State Listen |
    Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object {
      $proc = Get-Process -Id $_ -ErrorAction SilentlyContinue
      if ($proc) { [pscustomobject]@{ name = "$($proc.ProcessName)"; version = $null; source = 'listening_process' } }
    }
}
$software = @(); $software += $apps; $software += $roles; $software += $listen
# Hardware inventory — read-only CIM queries (CPU / RAM / disk / OEM / serial).
$hw = @{}
try {
  $cs   = Get-CimInstance Win32_ComputerSystem -ErrorAction SilentlyContinue
  $cpu  = (Get-CimInstance Win32_Processor  -ErrorAction SilentlyContinue | Measure-Object -Property NumberOfLogicalProcessors -Sum).Sum
  $bios = Get-CimInstance Win32_BIOS        -ErrorAction SilentlyContinue
  $disk = (Get-CimInstance Win32_DiskDrive  -ErrorAction SilentlyContinue | Measure-Object -Property Size -Sum).Sum
  $hw = @{
    cpu_cores     = [int]$cpu
    memory_gb     = if ($cs)   { [int][math]::Round($cs.TotalPhysicalMemory / 1GB) } else { 0 }
    storage_gb    = if ($disk) { [int][math]::Round($disk / 1GB) } else { 0 }
    manufacturer  = "$($cs.Manufacturer)"
    model         = "$($cs.Model)"
    serial_number = "$($bios.SerialNumber)"
  }
} catch {}
@{ installed_software = @($software); hardware = $hw } | ConvertTo-Json -Depth 4 -Compress
"""

# One round-trip Linux probe: os-release + packages (dpkg|rpm) + listening
# sockets, fenced by markers we split on. Read-only.
_LINUX_PROBE_SH = (
    "echo '===DPKG==='; dpkg-query -W -f='${Package}\\t${Version}\\n' 2>/dev/null; "
    "echo '===RPM==='; rpm -qa --qf '%{NAME}\\t%{VERSION}\\n' 2>/dev/null; "
    "echo '===LISTEN==='; { ss -tlnpH 2>/dev/null || ss -tlnp 2>/dev/null; }; "
    # Hardware inventory — no root needed (nproc / /proc / lsblk / DMI sysfs).
    "echo '===HARDWARE==='; "
    "echo \"cpu_cores=$(nproc 2>/dev/null)\"; "
    "echo \"memory_kb=$(awk '/MemTotal/{print $2}' /proc/meminfo 2>/dev/null)\"; "
    "echo \"storage_bytes=$(lsblk -bdno SIZE 2>/dev/null | awk '{s+=$1} END{print s}')\"; "
    "echo \"manufacturer=$(cat /sys/class/dmi/id/sys_vendor 2>/dev/null)\"; "
    "echo \"model=$(cat /sys/class/dmi/id/product_name 2>/dev/null)\"; "
    "echo \"serial=$(cat /sys/class/dmi/id/product_serial 2>/dev/null)\""
)

_SS_PROC_RE = re.compile(r'\(\("([^"]+)"')


def _parse_windows(stdout: str) -> list[dict[str, Any]]:
    """Parse the WinRM probe's JSON into raw {name,version,source} items."""
    out = (stdout or "").strip()
    if not out:
        return []
    try:
        data = json.loads(out)
    except json.JSONDecodeError:
        return []
    raw = data.get("installed_software") if isinstance(data, dict) else None
    if isinstance(raw, dict):       # ConvertTo-Json collapses a 1-element array
        raw = [raw]
    elif not isinstance(raw, list):
        raw = []
    return [
        {"name": e.get("name"), "version": (e.get("version") or None),
         "source": e.get("source")}
        for e in raw if isinstance(e, dict) and e.get("name")
    ]


def _parse_linux(stdout: str) -> list[dict[str, Any]]:
    """Parse the marker-fenced Linux probe into raw {name,version,source}."""
    text = stdout or ""
    # Carve the three sections out by marker.
    def _section(name: str) -> str:
        start = text.find(f"==={name}===")
        if start < 0:
            return ""
        start += len(f"==={name}===")
        nxt = min(
            (p for p in (text.find("===DPKG===", start), text.find("===RPM===", start),
                         text.find("===LISTEN===", start)) if p >= 0),
            default=len(text),
        )
        return text[start:nxt]

    items: list[dict[str, Any]] = []
    for tool, src in (("DPKG", "dpkg"), ("RPM", "rpm")):
        for line in _section(tool).splitlines():
            name, _, ver = line.partition("\t")
            name = name.strip()
            if name:
                items.append({"name": name, "version": (ver.strip() or None),
                              "source": src})
    seen: set = set()
    for line in _section("LISTEN").splitlines():
        for m in _SS_PROC_RE.finditer(line):
            if m.group(1) not in seen:
                seen.add(m.group(1))
                items.append({"name": m.group(1), "version": None,
                              "source": "listening_process"})
    return items


# Junk OEM strings CIM / DMI return when a field is unset — treated as empty.
_HW_JUNK = {"", "to be filled by o.e.m.", "system manufacturer", "system product name",
            "default string", "none", "not specified", "not available", "0", "o.e.m.",
            "not applicable", "chassis manufacture", "unknown"}


def _clean_hw(raw: dict) -> dict[str, Any]:
    """Normalise a raw hardware dict → {cpu_cores, memory_gb, storage_gb (ints>0),
    manufacturer, model, serial_number (clean strings)}, dropping junk/empties."""
    out: dict[str, Any] = {}
    for k in ("cpu_cores", "memory_gb", "storage_gb"):
        try:
            v = int(float(raw.get(k)))
            if v > 0:
                out[k] = v
        except (TypeError, ValueError):
            pass
    for k in ("manufacturer", "model", "serial_number"):
        v = str(raw.get(k) or "").strip()
        if v and v.lower() not in _HW_JUNK:
            out[k] = v[:255]
    return out


def _parse_hardware_windows(stdout: str) -> dict[str, Any]:
    """Pull the `hardware` object out of the WinRM probe JSON."""
    try:
        data = json.loads((stdout or "").strip())
    except json.JSONDecodeError:
        return {}
    hw = data.get("hardware") if isinstance(data, dict) else None
    return _clean_hw(hw) if isinstance(hw, dict) else {}


def _parse_hardware_linux(stdout: str) -> dict[str, Any]:
    """Parse the `===HARDWARE===` key=value block from the Linux probe."""
    text = stdout or ""
    start = text.find("===HARDWARE===")
    if start < 0:
        return {}
    kv: dict[str, str] = {}
    for line in text[start + len("===HARDWARE==="):].splitlines():
        key, sep, val = line.partition("=")
        if sep and key.strip():
            kv[key.strip()] = val.strip()
    raw: dict[str, Any] = {
        "cpu_cores": kv.get("cpu_cores"),
        "manufacturer": kv.get("manufacturer"),
        "model": kv.get("model"),
        "serial_number": kv.get("serial"),
    }
    try:
        mk = int(kv.get("memory_kb") or 0)
        if mk > 0:
            raw["memory_gb"] = round(mk / 1024 / 1024)
    except ValueError:
        pass
    try:
        sb = int(kv.get("storage_bytes") or 0)
        if sb > 0:
            raw["storage_gb"] = round(sb / 1_000_000_000)
    except ValueError:
        pass
    return _clean_hw(raw)


def collect_windows(credentials: dict, timeout: int = 60) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Run the Windows inventory probe over WinRM. Returns (software, hardware),
    or raises RuntimeError with a human cause on connection/transport failure."""
    if not WINRM_AVAILABLE:
        raise RuntimeError("pywinrm is not installed on this server")
    endpoint = credentials.get("winrm_endpoint")
    username = credentials.get("winrm_username")
    password = credentials.get("winrm_password")
    if not endpoint or not username or not password:
        raise RuntimeError("WinRM credentials missing (endpoint/username/password)")
    session = winrm.Session(
        endpoint,
        auth=(username, password),
        transport=(credentials.get("winrm_transport") or "ntlm").lower(),
        server_cert_validation=(credentials.get("winrm_server_cert_validation") or "validate").lower(),
        ca_trust_path=credentials.get("winrm_ca_trust_path"),
        read_timeout_sec=timeout + 5,
        operation_timeout_sec=timeout,
    )
    r = session.run_ps(_WIN_PROBE_PS)
    if int(r.status_code) != 0:
        err = (r.std_err or b"").decode("utf-8", errors="replace")[:300]
        raise RuntimeError(f"WinRM inventory probe failed (rc={r.status_code}): {err}")
    out = (r.std_out or b"").decode("utf-8", errors="replace")
    return _parse_windows(out), _parse_hardware_windows(out)


def collect_linux(credentials: dict, timeout: int = 30) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Run the Linux inventory probe over SSH. Returns (software, hardware),
    or raises RuntimeError on connection/auth failure."""
    if not PARAMIKO_AVAILABLE:
        raise RuntimeError("paramiko is not installed on this server")
    host = credentials.get("ssh_host")
    user = credentials.get("ssh_username")
    password = credentials.get("ssh_password")
    pkey_pem = credentials.get("ssh_private_key")
    if not host or not user or not (password or pkey_pem):
        raise RuntimeError("SSH credentials missing (host/username/secret)")

    client = paramiko.SSHClient()
    try:
        client.load_system_host_keys()
    except Exception:  # noqa: BLE001
        pass
    if credentials.get("ssh_known_hosts"):
        try:
            client.get_host_keys().load(io.StringIO(credentials["ssh_known_hosts"]))
        except Exception:  # noqa: BLE001
            pass
    accept_unknown = str(credentials.get("ssh_accept_unknown_hosts", "")).lower() in ("1", "true", "yes")
    client.set_missing_host_key_policy(
        paramiko.AutoAddPolicy() if accept_unknown else paramiko.RejectPolicy()
    )
    try:
        kwargs: dict[str, Any] = dict(
            hostname=host, port=int(credentials.get("ssh_port") or 22),
            username=user, timeout=timeout, banner_timeout=timeout,
            auth_timeout=timeout, look_for_keys=False, allow_agent=False,
        )
        if pkey_pem:
            try:
                kwargs["pkey"] = paramiko.RSAKey.from_private_key(io.StringIO(pkey_pem))
            except paramiko.SSHException:
                kwargs["pkey"] = paramiko.Ed25519Key.from_private_key(io.StringIO(pkey_pem))
        else:
            kwargs["password"] = password
        client.connect(**kwargs)
        _in, out, _err = client.exec_command(_LINUX_PROBE_SH, timeout=timeout)
        stdout = out.read().decode("utf-8", errors="replace")
    finally:
        try:
            client.close()
        except Exception:  # noqa: BLE001
            pass
    return _parse_linux(stdout), _parse_hardware_linux(stdout)


def _transport_for(connection: IntegrationConnection, asset: ITAsset) -> Optional[str]:
    """Decide which probe to run: 'windows', 'linux', or None if unsupported.
    Prefer the connection's integration_type; fall back to the asset OS."""
    itype = (connection.integration_type or "").lower()
    if itype == "windows_winrm":
        return "windows"
    if itype in ("linux_ssh", "netdev_ssh"):
        return "linux"
    fam = (asset.os_family or asset.os_normalized or "").lower()
    if fam.startswith("windows"):
        return "windows"
    if fam.startswith(("linux", "ubuntu", "debian", "rhel", "centos", "rocky",
                       "almalinux", "oraclelinux", "amazonlinux", "sles", "suse")):
        return "linux"
    return None


def resolve_connection_for_asset(
    db: Session, tenant_id: int, asset: ITAsset,
) -> Optional[IntegrationConnection]:
    """Pick the tenant's first ACTIVE connection whose integration_type fits
    this asset's OS — mirrors _resolve_connection_for_plugin's pool strategy."""
    fam = (asset.os_family or asset.os_normalized or "").lower()
    if fam.startswith("windows"):
        itype = "windows_winrm"
    elif fam.startswith(("linux", "ubuntu", "debian", "rhel", "centos", "rocky",
                         "almalinux", "oraclelinux", "amazonlinux", "sles", "suse")):
        itype = "linux_ssh"
    else:
        return None
    return (
        db.query(IntegrationConnection)
        .filter(
            IntegrationConnection.tenant_id == tenant_id,
            IntegrationConnection.integration_type == itype,
            IntegrationConnection.is_active.is_(True),
        )
        .order_by(IntegrationConnection.updated_at.desc().nullslast(),
                  IntegrationConnection.id.desc())
        .first()
    )


def probe_and_store(
    db: Session, asset: ITAsset, connection: IntegrationConnection,
) -> dict[str, Any]:
    """Run the agentless inventory probe for one asset over its connection,
    enrich it, and persist to asset.detected_software_json — the same write
    the agent heartbeat performs. Returns a summary dict.

    Raises RuntimeError (with a human cause) on transport/credential failure
    so the caller can surface it; never writes a partial inventory.
    """
    transport = _transport_for(connection, asset)
    if transport is None:
        raise RuntimeError(
            f"No agentless inventory probe for integration_type "
            f"{connection.integration_type!r} / OS {asset.os_family!r}"
        )
    credentials = resolve_credentials_for_connection(connection)
    raw, hardware = collect_windows(credentials) if transport == "windows" else collect_linux(credentials)

    # Persist auto-discovered hardware specs (vCPU/RAM/disk/OEM/serial) — only
    # non-junk values survive _clean_hw, and we never overwrite with a blank.
    for _col, _val in (hardware or {}).items():
        setattr(asset, _col, _val)

    enriched = enrich_inventory(db, raw)
    # Preserve promoted_asset_id links so a re-probe doesn't forget which
    # detected apps were already turned into child assets. Shared with the
    # agent heartbeat so the two collectors can't drift apart.
    asset.detected_software_json = preserve_promotions(
        asset.detected_software_json, enriched
    )
    # Derive antivirus/EDR presence + software categories from the fresh
    # inventory so the asset's Security Posture reflects what we just collected.
    try:
        from grc.modules.compliance_plugins.services.security_classifier import apply_posture
        apply_posture(asset)
    except Exception:
        logger.exception("agentless: security posture computation failed")
    db.add(asset)
    db.flush()

    promotable = sum(1 for e in enriched if e.get("benchmark_available") and not e.get("promoted_asset_id"))
    return {
        "ok": True,
        "transport": transport,
        "raw_count": len(raw),
        "hardware": hardware,
        "detected": enriched,
        "counts": {
            "total": len(enriched),
            "promotable": promotable,
            "promoted": sum(1 for e in enriched if e.get("promoted_asset_id")),
            "no_benchmark": sum(1 for e in enriched if not e.get("benchmark_available")),
        },
    }
