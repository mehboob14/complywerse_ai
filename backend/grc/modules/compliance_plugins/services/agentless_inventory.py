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
# Discovery-status contract for the deep-inventory sections written onto
# asset.platform_properties (see platform_collectors/status.py).
from grc.modules.asset_discovery.services.platform_collectors import (
    discovered, section, PERMISSION_DENIED, NOT_SUPPORTED, NOT_APPLICABLE,
    UNAVAILABLE, ERROR, classify_error,
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
    # Publisher comes from the same registry key we are already reading — not
    # asking for it is why the Publisher column rendered as a wall of dashes.
    [pscustomobject]@{ name = "$($_.DisplayName)"; version = "$($_.DisplayVersion)"; publisher = "$($_.Publisher)"; source = 'registry' }
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
  # Identity + network facts the machine also knows: the interactively logged-on
  # user (→ Assigned User), the primary IP-enabled NIC's MAC, and the FQDN.
  $net  = Get-CimInstance Win32_NetworkAdapterConfiguration -ErrorAction SilentlyContinue | Where-Object { $_.IPEnabled } | Select-Object -First 1
  $fqdn = if ($cs.Domain -and $cs.Domain -ne 'WORKGROUP') { "$($cs.DNSHostName).$($cs.Domain)" } else { "$($cs.DNSHostName)" }
  $hw = @{
    cpu_cores     = [int]$cpu
    memory_gb     = if ($cs)   { [int][math]::Round($cs.TotalPhysicalMemory / 1GB) } else { 0 }
    storage_gb    = if ($disk) { [int][math]::Round($disk / 1GB) } else { 0 }
    manufacturer  = "$($cs.Manufacturer)"
    model         = "$($cs.Model)"
    serial_number = "$($bios.SerialNumber)"
    assigned_user = "$($cs.UserName)"
    fqdn          = "$fqdn"
    primary_mac   = "$($net.MACAddress)"
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
    "echo \"serial=$(cat /sys/class/dmi/id/product_serial 2>/dev/null)\"; "
    # Identity — hostname, FQDN, and the default-route interface's MAC. The DMI
    # probe alone never captured these, so a wizard-added host kept the IP as a
    # placeholder host_name with blank FQDN/MAC. A rescan now fills all three.
    "echo \"host_name=$(hostname 2>/dev/null)\"; "
    "echo \"fqdn=$(hostname -f 2>/dev/null)\"; "
    "echo \"primary_mac=$(cat /sys/class/net/$(ip route show default 2>/dev/null | awk '{print $5; exit}')/address 2>/dev/null)\""
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
    for k in ("manufacturer", "model", "serial_number", "assigned_user", "fqdn", "primary_mac", "host_name"):
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
        "host_name": kv.get("host_name"),
        "fqdn": kv.get("fqdn"),
        "primary_mac": kv.get("primary_mac"),
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


# ─────────────────────────────────────────────────────────────────────────────
# DEEP host inventory — structured, OS-appropriate sections for
# asset.platform_properties. This is ADDITIVE: the flat-column + software +
# posture path above is untouched. A second read-only probe (heavier than the
# summary one) pulls per-DIMM / per-disk / per-NIC / services / security detail
# and returns it as {section: {"status","data","note?"}} sections wrapped with
# the discovery-status contract, so a permission-denied block degrades to a
# tagged empty section instead of failing the whole collect.
# ─────────────────────────────────────────────────────────────────────────────

# One PowerShell round-trip that builds an ordered map of deep sections. Every
# block is isolated in `S {}` (try/catch): a denied/failed block records its
# error and the rest still return. Read-only CIM/registry queries only.
_WIN_DEEP_PS = r"""
$ErrorActionPreference = 'SilentlyContinue'
$ProgressPreference = 'SilentlyContinue'
function S([ScriptBlock]$b) {
  $d = $null; $e = $null
  try { $d = & $b } catch { $e = "$($_.Exception.Message)" }
  @{ data = $d; error = $e }
}
$out = [ordered]@{}

$out.identity = S {
  $cs   = Get-CimInstance Win32_ComputerSystem -ErrorAction Stop
  $csp  = Get-CimInstance Win32_ComputerSystemProduct -ErrorAction SilentlyContinue
  $bios = Get-CimInstance Win32_BIOS -ErrorAction SilentlyContinue
  $fqdn = if ($cs.Domain -and $cs.Domain -ne 'WORKGROUP') { "$($cs.DNSHostName).$($cs.Domain)" } else { "$($cs.DNSHostName)" }
  @{
    hostname       = "$($cs.DNSHostName)"
    fqdn           = "$fqdn"
    domain         = "$($cs.Domain)"
    part_of_domain = [bool]$cs.PartOfDomain
    workgroup      = "$($cs.Workgroup)"
    manufacturer   = "$($cs.Manufacturer)"
    model          = "$($cs.Model)"
    serial         = "$($bios.SerialNumber)"
    uuid           = "$($csp.UUID)"
    bios_serial    = "$($bios.SerialNumber)"
  }
}

$out.os = S {
  $os = Get-CimInstance Win32_OperatingSystem -ErrorAction Stop
  $cs = Get-CimInstance Win32_ComputerSystem -ErrorAction SilentlyContinue
  $up = (Get-Date) - $os.LastBootUpTime
  @{
    edition        = "$($os.Caption)"
    version        = "$($os.Version)"
    build          = "$($os.BuildNumber)"
    architecture   = "$($os.OSArchitecture)"
    install_date   = "$($os.InstallDate)"
    last_boot      = "$($os.LastBootUpTime)"
    uptime_hours   = [int]$up.TotalHours
    timezone       = "$((Get-TimeZone -ErrorAction SilentlyContinue).Id)"
    domain         = "$($cs.Domain)"
    part_of_domain = [bool]$cs.PartOfDomain
  }
}

$out.cpu = S {
  $procs = @(Get-CimInstance Win32_Processor -ErrorAction Stop)
  $f = $procs[0]
  @{
    manufacturer       = "$($f.Manufacturer)"
    model              = "$($f.Name)".Trim()
    architecture       = "$($f.AddressWidth)-bit"
    physical_cores     = [int]($procs | Measure-Object -Property NumberOfCores -Sum).Sum
    logical_processors = [int]($procs | Measure-Object -Property NumberOfLogicalProcessors -Sum).Sum
    sockets            = $procs.Count
    clock_mhz          = [int]$f.MaxClockSpeed
  }
}

$out.memory = S {
  $dimms = @(Get-CimInstance Win32_PhysicalMemory -ErrorAction Stop)
  @{
    total_gb = [int][math]::Round((($dimms | Measure-Object -Property Capacity -Sum).Sum) / 1GB)
    dimms = @($dimms | ForEach-Object { @{
      slot         = "$($_.DeviceLocator)"
      capacity_gb  = [int][math]::Round($_.Capacity / 1GB)
      manufacturer = "$($_.Manufacturer)".Trim()
      part_number  = "$($_.PartNumber)".Trim()
      serial       = "$($_.SerialNumber)".Trim()
      speed_mhz    = [int]$_.Speed
      type         = "$($_.SMBIOSMemoryType)"
    } })
  }
}

$out.firmware = S {
  $bb   = Get-CimInstance Win32_BaseBoard -ErrorAction SilentlyContinue
  $bios = Get-CimInstance Win32_BIOS -ErrorAction Stop
  $ft   = (Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control' -Name 'PEFirmwareType' -ErrorAction SilentlyContinue).PEFirmwareType
  $mode = if ($ft -eq 2) { 'UEFI' } elseif ($ft -eq 1) { 'Legacy' } else { 'Unknown' }
  @{
    motherboard = @{ manufacturer = "$($bb.Manufacturer)"; product = "$($bb.Product)"; serial = "$($bb.SerialNumber)" }
    bios        = @{ vendor = "$($bios.Manufacturer)"; version = "$($bios.SMBIOSBIOSVersion)"; date = "$($bios.ReleaseDate)"; mode = "$mode" }
  }
}

$out.gpu = S {
  @(Get-CimInstance Win32_VideoController -ErrorAction Stop | ForEach-Object { @{
    vendor         = "$($_.AdapterCompatibility)"
    model          = "$($_.Name)"
    vram_mb        = $(if ($_.AdapterRAM -and $_.AdapterRAM -gt 0) { [int][math]::Round($_.AdapterRAM / 1MB) } else { 0 })
    driver_version = "$($_.DriverVersion)"
    driver_date    = "$($_.DriverDate)"
  } })
}

$out.storage = S {
  $phys = $null
  try {
    $phys = @(Get-PhysicalDisk -ErrorAction Stop | ForEach-Object { @{
      model      = "$($_.FriendlyName)"
      serial     = "$($_.SerialNumber)".Trim()
      size_gb    = [int][math]::Round($_.Size / 1GB)
      media_type = "$($_.MediaType)"
      bus_type   = "$($_.BusType)"
    } })
  } catch {
    $phys = @(Get-CimInstance Win32_DiskDrive -ErrorAction SilentlyContinue | ForEach-Object { @{
      model      = "$($_.Model)"
      serial     = "$($_.SerialNumber)".Trim()
      size_gb    = [int][math]::Round($_.Size / 1GB)
      media_type = "$($_.MediaType)"
      bus_type   = "$($_.InterfaceType)"
    } })
  }
  $vols = @(Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' -ErrorAction SilentlyContinue | ForEach-Object { @{
    drive_letter = "$($_.DeviceID)"
    filesystem   = "$($_.FileSystem)"
    capacity_gb  = [int][math]::Round($_.Size / 1GB)
    free_gb      = [int][math]::Round($_.FreeSpace / 1GB)
  } })
  @{ physical_disks = @($phys); volumes = $vols }
}

$out.network = S {
  $cfgs = @(Get-CimInstance Win32_NetworkAdapterConfiguration -ErrorAction Stop | Where-Object { $_.MACAddress })
  @($cfgs | ForEach-Object {
    $c = $_
    $ad = Get-CimInstance Win32_NetworkAdapter -Filter "Index=$($c.Index)" -ErrorAction SilentlyContinue
    @{
      name         = "$($ad.NetConnectionID)"
      description  = "$($c.Description)"
      mac          = "$($c.MACAddress)"
      ipv4         = @($c.IPAddress | Where-Object { $_ -and $_ -notmatch ':' })
      ipv6         = @($c.IPAddress | Where-Object { $_ -and $_ -match ':' })
      subnet       = @($c.IPSubnet)
      gateway      = @($c.DefaultIPGateway)
      dns          = @($c.DNSServerSearchOrder)
      dhcp_enabled = [bool]$c.DHCPEnabled
      speed_bps    = $(if ($ad.Speed) { [int64]$ad.Speed } else { 0 })
      status       = "$($ad.NetConnectionStatus)"
    }
  })
}

$out.services = S {
  @(Get-CimInstance Win32_Service -ErrorAction Stop | Select-Object -First 300 | ForEach-Object { @{
    name         = "$($_.Name)"
    display_name = "$($_.DisplayName)"
    state        = "$($_.State)"
    start_mode   = "$($_.StartMode)"
    path         = "$($_.PathName)"
    account      = "$($_.StartName)"
  } })
}

$out.defender = S {
  $m = Get-MpComputerStatus -ErrorAction Stop
  @{
    antivirus_enabled   = [bool]$m.AntivirusEnabled
    realtime_protection = [bool]$m.RealTimeProtectionEnabled
    antispyware_enabled = [bool]$m.AntispywareEnabled
    tamper_protected    = [bool]$m.IsTamperProtected
    engine_version      = "$($m.AMEngineVersion)"
    signature_version   = "$($m.AntivirusSignatureVersion)"
    signature_age_days  = [int]$m.AntivirusSignatureAge
  }
}

$out.firewall = S {
  @(Get-NetFirewallProfile -ErrorAction Stop | ForEach-Object { @{
    profile          = "$($_.Name)"
    enabled          = [bool]$_.Enabled
    default_inbound  = "$($_.DefaultInboundAction)"
    default_outbound = "$($_.DefaultOutboundAction)"
  } })
}

$out.bitlocker = S {
  @(Get-BitLockerVolume -ErrorAction Stop | ForEach-Object { @{
    mount_point           = "$($_.MountPoint)"
    protection_status     = "$($_.ProtectionStatus)"
    volume_status         = "$($_.VolumeStatus)"
    encryption_percentage = [int]$_.EncryptionPercentage
    encryption_method     = "$($_.EncryptionMethod)"
  } })
}

$out.local_users = S {
  @(Get-CimInstance Win32_UserAccount -Filter 'LocalAccount=True' -ErrorAction Stop | ForEach-Object { @{
    name      = "$($_.Name)"
    full_name = "$($_.FullName)"
    disabled  = [bool]$_.Disabled
    lockout   = [bool]$_.Lockout
    sid       = "$($_.SID)"
  } })
}

$out.local_groups = S {
  @(Get-CimInstance Win32_Group -Filter 'LocalAccount=True' -ErrorAction Stop | ForEach-Object { @{
    name        = "$($_.Name)"
    description = "$($_.Description)"
  } })
}

$out.scheduled_tasks = S {
  $t = @(Get-ScheduledTask -ErrorAction Stop)
  @{ total = $t.Count; enabled = @($t | Where-Object { "$($_.State)" -ne 'Disabled' }).Count }
}

$out.windows_update = S {
  $hf = @(Get-HotFix -ErrorAction Stop | Sort-Object InstalledOn -Descending)
  $last = $hf | Select-Object -First 1
  @{ hotfix_count = $hf.Count; last_hotfix = "$($last.HotFixID)"; last_installed = "$($last.InstalledOn)" }
}

$out.shares = S {
  @(Get-CimInstance Win32_Share -ErrorAction Stop | ForEach-Object { @{
    name        = "$($_.Name)"
    path        = "$($_.Path)"
    description = "$($_.Description)"
    type        = "$($_.Type)"
  } })
}

$out | ConvertTo-Json -Depth 8 -Compress
"""


# Distro-aware Linux deep probe. Every command is guarded (2>/dev/null, and
# 2>&1 || true for privileged ones so a "must be root" message is CAPTURED and
# classified as permission_denied rather than lost). Sections are fenced with
# `@@SEC:name@@` markers we split on. The package manager and init system are
# detected dynamically — no Ubuntu/systemd assumption.
_LINUX_DEEP_SH = r"""
sec(){ printf '@@SEC:%s@@\n' "$1"; }
sec os_release; cat /etc/os-release 2>/dev/null
sec identity
echo "hostname=$(hostname 2>/dev/null)"
echo "fqdn=$(hostname -f 2>/dev/null)"
echo "kernel=$(uname -r 2>/dev/null)"
echo "arch=$(uname -m 2>/dev/null)"
echo "manufacturer=$(cat /sys/class/dmi/id/sys_vendor 2>/dev/null)"
echo "model=$(cat /sys/class/dmi/id/product_name 2>/dev/null)"
echo "serial=$(cat /sys/class/dmi/id/product_serial 2>/dev/null)"
echo "bios_vendor=$(cat /sys/class/dmi/id/bios_vendor 2>/dev/null)"
echo "bios_version=$(cat /sys/class/dmi/id/bios_version 2>/dev/null)"
echo "bios_date=$(cat /sys/class/dmi/id/bios_date 2>/dev/null)"
echo "boot_time=$(uptime -s 2>/dev/null)"
echo "uptime_seconds=$(awk '{print int($1)}' /proc/uptime 2>/dev/null)"
sec cpu; lscpu 2>/dev/null
sec memory; { command -v dmidecode >/dev/null 2>&1 && dmidecode -t memory 2>&1; } || echo '__NA__'
sec gpu; { command -v lspci >/dev/null 2>&1 && lspci 2>/dev/null | grep -iE 'vga|3d controller|display controller'; } || echo '__NA__'
sec storage_disks; lsblk -dn -P -o NAME,MODEL,SERIAL,SIZE,ROTA,TRAN 2>/dev/null
sec storage_mounts; df -PT 2>/dev/null | awk 'NR==1 || $2!~/tmpfs|devtmpfs|overlay|squashfs/'
sec lvm; { command -v vgs >/dev/null 2>&1 && { echo "PV:"; pvs --noheadings 2>&1; echo "VG:"; vgs --noheadings 2>&1; echo "LV:"; lvs --noheadings 2>&1; }; } || echo '__NA__'
sec raid; { test -f /proc/mdstat && grep -q 'md[0-9]' /proc/mdstat 2>/dev/null && cat /proc/mdstat 2>/dev/null; } || echo '__NA__'
sec net_addr; ip -o addr show 2>/dev/null
sec net_link; ip -o link show 2>/dev/null
sec net_route; ip route show 2>/dev/null
sec dns; grep -E '^(nameserver|search|domain)' /etc/resolv.conf 2>/dev/null
sec pkg
if command -v dpkg-query >/dev/null 2>&1; then echo "manager=dpkg"; echo "count=$(dpkg-query -f '.\n' -W 2>/dev/null | wc -l)";
elif command -v rpm >/dev/null 2>&1; then echo "manager=rpm"; echo "count=$(rpm -qa 2>/dev/null | wc -l)";
elif command -v pacman >/dev/null 2>&1; then echo "manager=pacman"; echo "count=$(pacman -Q 2>/dev/null | wc -l)";
elif command -v apk >/dev/null 2>&1; then echo "manager=apk"; echo "count=$(apk info 2>/dev/null | wc -l)";
elif command -v zypper >/dev/null 2>&1; then echo "manager=zypper"; echo "count=$(rpm -qa 2>/dev/null | wc -l)"; fi
sec services
if command -v systemctl >/dev/null 2>&1; then echo "init=systemd"; systemctl list-units --type=service --state=running --no-legend --no-pager 2>/dev/null | awk '{print $1"\trunning"}' | head -n 300;
elif command -v rc-status >/dev/null 2>&1; then echo "init=openrc"; rc-status -s 2>/dev/null | head -n 300;
elif command -v service >/dev/null 2>&1; then echo "init=sysv"; service --status-all 2>&1 | head -n 300; fi
sec firewall
if command -v ufw >/dev/null 2>&1; then echo "tool=ufw"; ufw status 2>&1 | head -n 1;
elif command -v firewall-cmd >/dev/null 2>&1; then echo "tool=firewalld"; echo "state=$(firewall-cmd --state 2>&1)"; echo "zone=$(firewall-cmd --get-default-zone 2>&1)";
elif command -v nft >/dev/null 2>&1; then echo "tool=nftables"; echo "rules=$(nft list ruleset 2>&1 | grep -c .)";
elif command -v iptables >/dev/null 2>&1; then echo "tool=iptables"; echo "rules=$(iptables -S 2>&1 | grep -c .)"; fi
sec selinux; { command -v getenforce >/dev/null 2>&1 && getenforce 2>/dev/null; } || echo '__NA__'
sec apparmor; { command -v aa-status >/dev/null 2>&1 && aa-status 2>&1 | head -n 3; } || echo '__NA__'
sec sshd; { command -v sshd >/dev/null 2>&1 && sshd -T 2>&1 | grep -iE '^(permitrootlogin|passwordauthentication|permitemptypasswords|x11forwarding|port|protocol) '; } || echo '__NA__'
sec users; getent passwd 2>/dev/null | awk -F: '$3>=1000 && $3<65534 {print $1":"$3":"$7}'
sec sudoers; { test -d /etc/sudoers.d && ls /etc/sudoers.d 2>/dev/null | grep -vc '^README$'; } || echo 0
sec sec_updates
if command -v apt-get >/dev/null 2>&1; then echo "manager=apt"; echo "count=$(apt-get -s -o Debug::NoLocking=true upgrade 2>/dev/null | grep -ic '^inst.*security')";
elif command -v dnf >/dev/null 2>&1; then echo "manager=dnf"; echo "count=$(dnf -q updateinfo list security 2>/dev/null | grep -c .)";
elif command -v yum >/dev/null 2>&1; then echo "manager=yum"; echo "count=$(yum -q updateinfo list security 2>/dev/null | grep -c .)"; fi
sec virt; { command -v systemd-detect-virt >/dev/null 2>&1 && systemd-detect-virt 2>/dev/null; } || echo '__NA__'
sec docker; if command -v docker >/dev/null 2>&1; then echo "present=1"; echo "running=$(docker ps -q 2>&1 | grep -c .)"; else echo "present=0"; fi
sec podman; if command -v podman >/dev/null 2>&1; then echo "present=1"; echo "running=$(podman ps -q 2>&1 | grep -c .)"; else echo "present=0"; fi
sec end
"""


def _deep_section(entry: Any) -> dict:
    """Wrap one PowerShell `S {}` result ({data, error}) as a status section."""
    if not isinstance(entry, dict):
        return discovered(entry) if entry else section(UNAVAILABLE, entry)
    err = entry.get("error")
    data = entry.get("data")
    if err:
        return section(classify_error(Exception(str(err))), None, note=str(err)[:200])
    if data is None or (isinstance(data, (list, dict, str)) and len(data) == 0):
        return section(UNAVAILABLE, data)
    return discovered(data)


def _parse_deep_windows(stdout: str) -> dict[str, dict]:
    """Parse the Windows deep probe JSON into {section: {status,data,note?}}."""
    out = (stdout or "").strip()
    if not out:
        return {}
    try:
        data = json.loads(out)
    except json.JSONDecodeError:
        return {}
    if not isinstance(data, dict):
        return {}
    return {k: _deep_section(v) for k, v in data.items()}


def collect_windows_deep(credentials: dict, timeout: int = 120) -> dict[str, dict]:
    """Run the deep Windows inventory probe over WinRM and return status-wrapped
    sections for asset.platform_properties. Never raises for a partial/denied
    section (those degrade to tagged-empty sections); only a hard connect/auth
    failure propagates as RuntimeError."""
    if not WINRM_AVAILABLE:
        return {}
    endpoint = credentials.get("winrm_endpoint")
    username = credentials.get("winrm_username")
    password = credentials.get("winrm_password")
    if not endpoint or not username or not password:
        return {}
    session = winrm.Session(
        endpoint,
        auth=(username, password),
        transport=(credentials.get("winrm_transport") or "ntlm").lower(),
        server_cert_validation=(credentials.get("winrm_server_cert_validation") or "validate").lower(),
        ca_trust_path=credentials.get("winrm_ca_trust_path"),
        read_timeout_sec=timeout + 10,
        operation_timeout_sec=timeout,
    )
    r = session.run_ps(_WIN_DEEP_PS)
    out = (r.std_out or b"").decode("utf-8", errors="replace")
    return _parse_deep_windows(out)


# ── Linux deep-probe parsing ────────────────────────────────────────────────
_PERM_HINTS = ("permission denied", "must be root", "operation not permitted",
               "/dev/mem", "are you root", "access denied", "not permitted")
_LSBLK_KV_RE = re.compile(r'(\w+)="([^"]*)"')


def _split_sections(text: str) -> dict[str, str]:
    """Split the fenced probe output into {section_name: raw_body}."""
    out: dict[str, str] = {}
    parts = re.split(r'@@SEC:([a-z_]+)@@\n?', text or "")
    # parts = [pre, name1, body1, name2, body2, ...]
    for i in range(1, len(parts) - 1, 2):
        out[parts[i]] = parts[i + 1]
    return out


def _kv_block(body: str) -> dict[str, str]:
    kv: dict[str, str] = {}
    for line in (body or "").splitlines():
        k, sep, v = line.partition("=")
        if sep and k.strip():
            kv[k.strip()] = v.strip()
    return kv


def _lin_wrap(body: str, parsed: Any, *, empty: str = UNAVAILABLE, note: Optional[str] = None) -> dict:
    """Status-wrap a parsed Linux section: permission_denied if the raw output
    carries a privilege error, not_supported for an __NA__ sentinel, else the
    parsed data (or `empty` when nothing came back)."""
    low = (body or "").lower()
    if any(h in low for h in _PERM_HINTS):
        return section(PERMISSION_DENIED, parsed or None, note="requires elevated privileges")
    if "__na__" in low and not parsed:
        return section(NOT_SUPPORTED, None, note="tool not present on host")
    if not parsed:
        return section(empty, parsed, note=note)
    return discovered(parsed, note=note)


def _parse_deep_linux(stdout: str) -> dict[str, dict]:
    """Turn the fenced, distro-aware Linux probe output into status sections."""
    sec_map = _split_sections(stdout)
    result: dict[str, dict] = {}

    # identity + os (merged from os_release + identity blocks)
    osr = _kv_block(sec_map.get("os_release", "").replace('"', ""))
    idn = _kv_block(sec_map.get("identity", ""))
    identity = {
        "hostname": idn.get("hostname"),
        "fqdn": idn.get("fqdn"),
        "distribution": osr.get("PRETTY_NAME") or osr.get("NAME"),
        "distro_id": osr.get("ID"),
        "distro_version": osr.get("VERSION_ID"),
        "kernel": idn.get("kernel"),
        "architecture": idn.get("arch"),
        "manufacturer": idn.get("manufacturer"),
        "model": idn.get("model"),
        "serial": idn.get("serial"),
        "bios_vendor": idn.get("bios_vendor"),
        "bios_version": idn.get("bios_version"),
        "bios_date": idn.get("bios_date"),
        "boot_time": idn.get("boot_time"),
    }
    try:
        secs = int(idn.get("uptime_seconds") or 0)
        if secs > 0:
            identity["uptime_hours"] = secs // 3600
    except ValueError:
        pass
    identity = {k: v for k, v in identity.items() if v}
    result["identity"] = _lin_wrap(sec_map.get("identity", ""), identity)

    # cpu (lscpu key: value)
    cpu_kv: dict[str, str] = {}
    for line in sec_map.get("cpu", "").splitlines():
        k, sep, v = line.partition(":")
        if sep:
            cpu_kv[k.strip()] = v.strip()
    cpu = {
        "vendor": cpu_kv.get("Vendor ID"),
        "model": cpu_kv.get("Model name"),
        "architecture": cpu_kv.get("Architecture"),
        "cpus": cpu_kv.get("CPU(s)"),
        "threads_per_core": cpu_kv.get("Thread(s) per core"),
        "cores_per_socket": cpu_kv.get("Core(s) per socket"),
        "sockets": cpu_kv.get("Socket(s)"),
        "max_mhz": cpu_kv.get("CPU max MHz"),
    }
    cpu = {k: v for k, v in cpu.items() if v}
    result["cpu"] = _lin_wrap(sec_map.get("cpu", ""), cpu)

    # memory (dmidecode -t memory → per-DIMM). Needs root → permission_denied.
    mem_body = sec_map.get("memory", "")
    dimms = []
    cur: dict[str, str] = {}
    for line in mem_body.splitlines():
        s = line.strip()
        if s == "Memory Device":
            if cur:
                dimms.append(cur)
            cur = {}
        elif ":" in s and cur is not None:
            k, _, v = s.partition(":")
            k = k.strip(); v = v.strip()
            if k in ("Size", "Locator", "Speed", "Manufacturer", "Serial Number",
                     "Part Number", "Type"):
                cur[k] = v
    if cur:
        dimms.append(cur)
    dimms = [
        {"slot": d.get("Locator"), "size": d.get("Size"), "speed": d.get("Speed"),
         "manufacturer": d.get("Manufacturer"), "serial": d.get("Serial Number"),
         "part_number": d.get("Part Number"), "type": d.get("Type")}
        for d in dimms if (d.get("Size") and "No Module" not in d.get("Size", ""))
    ]
    result["memory"] = _lin_wrap(mem_body, dimms)

    # gpu (lspci VGA lines)
    gpus = []
    for line in sec_map.get("gpu", "").splitlines():
        line = line.strip()
        if not line or line == "__NA__":
            continue
        # "00:02.0 VGA compatible controller: Intel Corporation ..."
        desc = line.split(":", 2)[-1].strip() if line.count(":") >= 2 else line
        gpus.append({"description": desc})
    result["gpu"] = _lin_wrap(sec_map.get("gpu", ""), gpus)

    # storage disks (lsblk -P key=val pairs) + mounts (df -PT)
    disks = []
    for line in sec_map.get("storage_disks", "").splitlines():
        kv = dict(_LSBLK_KV_RE.findall(line))
        if kv.get("NAME"):
            disks.append({
                "name": kv.get("NAME"), "model": kv.get("MODEL"),
                "serial": kv.get("SERIAL"), "size": kv.get("SIZE"),
                "media_type": "HDD" if kv.get("ROTA") == "1" else "SSD",
                "interface": kv.get("TRAN"),
            })
    mounts = []
    m_lines = sec_map.get("storage_mounts", "").splitlines()
    for line in m_lines[1:] if m_lines else []:
        parts = line.split()
        if len(parts) >= 7:
            mounts.append({
                "filesystem": parts[0], "type": parts[1], "size": parts[2],
                "used": parts[3], "available": parts[4], "use_pct": parts[5],
                "mount": parts[6],
            })
    result["storage"] = _lin_wrap(
        sec_map.get("storage_disks", ""),
        ({"physical_disks": disks, "mounts": mounts} if (disks or mounts) else None),
    )

    # LVM + RAID
    lvm_body = sec_map.get("lvm", "")
    result["lvm"] = _lin_wrap(lvm_body, (lvm_body.strip() if "__NA__" not in lvm_body else None))
    raid_body = sec_map.get("raid", "")
    result["raid"] = _lin_wrap(
        raid_body, (raid_body.strip() if raid_body.strip() and "__NA__" not in raid_body else None),
        empty=NOT_APPLICABLE)

    # network — merge ip link (mac/state) with ip addr (v4/v6) by interface
    ifaces: dict[str, dict] = {}
    for line in sec_map.get("net_link", "").splitlines():
        # "2: eth0: <BROADCAST,...> mtu ... state UP ... link/ether aa:bb:.. brd .."
        m = re.match(r'\d+:\s+([^:@]+)[:@]', line)
        if not m:
            continue
        name = m.group(1).strip()
        mac_m = re.search(r'link/\w+\s+([0-9a-f:]{17})', line)
        st_m = re.search(r'state (\w+)', line)
        ifaces[name] = {"name": name, "mac": mac_m.group(1) if mac_m else None,
                        "state": st_m.group(1) if st_m else None, "ipv4": [], "ipv6": []}
    for line in sec_map.get("net_addr", "").splitlines():
        parts = line.split()
        if len(parts) < 4:
            continue
        name = parts[1]
        fam = parts[2]
        addr = parts[3]
        rec = ifaces.setdefault(name, {"name": name, "mac": None, "state": None,
                                       "ipv4": [], "ipv6": []})
        if fam == "inet":
            rec["ipv4"].append(addr)
        elif fam == "inet6":
            rec["ipv6"].append(addr)
    routes = [l.strip() for l in sec_map.get("net_route", "").splitlines() if l.strip()]
    gateway = None
    for r in routes:
        if r.startswith("default"):
            gm = re.search(r'via (\S+)', r)
            gateway = gm.group(1) if gm else None
            break
    dns = [l.strip() for l in sec_map.get("dns", "").splitlines() if l.strip()]
    net_data = {"interfaces": list(ifaces.values()), "gateway": gateway, "dns": dns} if ifaces else None
    result["network"] = _lin_wrap(sec_map.get("net_addr", ""), net_data)

    # package manager (software list handled by the summary path; record manager+count)
    pkg = _kv_block(sec_map.get("pkg", ""))
    pkg_data = None
    if pkg.get("manager"):
        pkg_data = {"package_manager": pkg.get("manager")}
        try:
            pkg_data["installed_count"] = int(pkg.get("count") or 0)
        except ValueError:
            pass
    result["packages"] = _lin_wrap(sec_map.get("pkg", ""), pkg_data)

    # services (init detection + running units)
    svc_body = sec_map.get("services", "")
    init = None
    services = []
    for line in svc_body.splitlines():
        if line.startswith("init="):
            init = line.split("=", 1)[1].strip()
            continue
        name, _, state = line.partition("\t")
        name = name.strip()
        if name:
            services.append({"name": name, "state": (state.strip() or "running")})
    svc_data = {"init_system": init, "services": services} if (init or services) else None
    result["services"] = _lin_wrap(svc_body, svc_data)

    # security sub-sections
    fw = _kv_block(sec_map.get("firewall", ""))
    fw_extra = sec_map.get("firewall", "")
    fw_data = None
    if fw.get("tool"):
        fw_data = {k: v for k, v in fw.items()}
        # ufw prints "Status: active" as a bare line, capture it
        for line in fw_extra.splitlines():
            if line.lower().startswith("status:"):
                fw_data["status"] = line.split(":", 1)[1].strip()
    result["firewall"] = _lin_wrap(fw_extra, fw_data)

    selinux_body = sec_map.get("selinux", "").strip()
    result["selinux"] = _lin_wrap(
        sec_map.get("selinux", ""),
        ({"mode": selinux_body} if selinux_body and selinux_body != "__NA__" else None))

    aa_body = sec_map.get("apparmor", "")
    result["apparmor"] = _lin_wrap(
        aa_body, (aa_body.strip() if aa_body.strip() and "__NA__" not in aa_body else None))

    sshd_body = sec_map.get("sshd", "")
    sshd_data: Optional[dict] = None
    if sshd_body.strip() and "__NA__" not in sshd_body:
        parsed_sshd: dict[str, str] = {}
        for line in sshd_body.splitlines():
            k, _, v = line.strip().partition(" ")
            if k:
                parsed_sshd[k.lower()] = v.strip()
        sshd_data = parsed_sshd or None
    result["ssh_config"] = _lin_wrap(sshd_body, sshd_data)

    users = []
    for line in sec_map.get("users", "").splitlines():
        parts = line.strip().split(":")
        if len(parts) >= 3 and parts[0]:
            users.append({"name": parts[0], "uid": parts[1], "shell": parts[2]})
    result["users"] = _lin_wrap(sec_map.get("users", ""), users)

    sudoers_body = sec_map.get("sudoers", "").strip()
    sudoers_data = None
    try:
        sudoers_data = {"sudoers_d_files": int(sudoers_body)}
    except (ValueError, TypeError):
        sudoers_data = None
    result["sudoers"] = _lin_wrap(sec_map.get("sudoers", ""), sudoers_data)

    upd = _kv_block(sec_map.get("sec_updates", ""))
    upd_data = None
    if upd.get("manager"):
        upd_data = {"update_manager": upd.get("manager")}
        try:
            upd_data["pending_security_updates"] = int(upd.get("count") or 0)
        except ValueError:
            pass
    result["security_updates"] = _lin_wrap(sec_map.get("sec_updates", ""), upd_data)

    # virtualization + containers
    virt_body = sec_map.get("virt", "").strip()
    docker = _kv_block(sec_map.get("docker", ""))
    podman = _kv_block(sec_map.get("podman", ""))
    virt_data: dict[str, Any] = {}
    if virt_body and virt_body != "__NA__":
        virt_data["hypervisor"] = virt_body
    if docker.get("present") == "1":
        virt_data["docker"] = {"present": True, "running_containers": docker.get("running")}
    if podman.get("present") == "1":
        virt_data["podman"] = {"present": True, "running_containers": podman.get("running")}
    result["virtualization"] = _lin_wrap(sec_map.get("virt", ""), (virt_data or None))

    return result


def collect_linux_deep(credentials: dict, timeout: int = 45) -> dict[str, dict]:
    """Run the distro-aware deep Linux probe over SSH and return status-wrapped
    sections for asset.platform_properties. Returns {} (never raises) when the
    ssh library or credentials are missing; a hard connect/auth failure
    propagates as the underlying paramiko error."""
    if not PARAMIKO_AVAILABLE:
        return {}
    host = credentials.get("ssh_host")
    user = credentials.get("ssh_username")
    password = credentials.get("ssh_password")
    pkey_pem = credentials.get("ssh_private_key")
    if not host or not user or not (password or pkey_pem):
        return {}

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
        _in, out, _err = client.exec_command(_LINUX_DEEP_SH, timeout=timeout)
        stdout = out.read().decode("utf-8", errors="replace")
    finally:
        try:
            client.close()
        except Exception:  # noqa: BLE001
            pass
    return _parse_deep_linux(stdout)


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
