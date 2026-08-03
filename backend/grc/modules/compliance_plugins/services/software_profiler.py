"""Deep-profile an installed application, over the host's own connection.

A host scan proves *that* PostgreSQL is installed and its version. It says
nothing about the things that make a PostgreSQL instance an asset in its own
right: which port it listens on, where its data directory is, which account the
service runs as, whether it accepts connections from anywhere. Those are the
facts an auditor asks for, and they are the ones a promoted application asset
was missing — not because the collector could not read them, but because
nobody asked it to.

Design
------
One registry, keyed by the same `software_key` the benchmark matcher uses, so a
product is described in exactly one place. Each entry lists probes:

    (attribute_name, shell, command, parser)

Probes are read-only and independently fault-tolerant: a probe that fails
records nothing rather than failing the profile, because a partial profile is
useful and a missing one is not.

The result is written to ``ITAsset.app_attributes_json`` on the application
asset. Shape varies by product deliberately — a schema that fits PostgreSQL and
IIS and Cisco IOS at once would fit none of them well.
"""
from __future__ import annotations

import logging
import re
from typing import Any, Callable, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

# (attribute, shell, command, parser)
Probe = Tuple[str, str, str, Callable[[str], Any]]


def _first_line(out: str) -> Optional[str]:
    for ln in (out or "").splitlines():
        if ln.strip():
            return ln.strip()
    return None


def _int_or_none(out: str) -> Optional[int]:
    m = re.search(r"\d+", out or "")
    return int(m.group()) if m else None


def _kv(pattern: str) -> Callable[[str], Optional[str]]:
    """Parse `key = value` / `key: value` style config output."""
    rx = re.compile(pattern, re.IGNORECASE | re.MULTILINE)

    def _p(out: str) -> Optional[str]:
        m = rx.search(out or "")
        return m.group(1).strip().strip("'\"") if m else None
    return _p


# ── Per-product probe registry ──────────────────────────────────────────────
# Windows-hosted products use PowerShell; *nix-hosted use sh. The runner is
# chosen by the PARENT host's transport, so the same product can be profiled on
# either platform where the commands differ.

_WINDOWS_POSTGRES: List[Probe] = [
    ("service_name", "powershell",
     "Get-Service -Name 'postgresql*' -ErrorAction SilentlyContinue | "
     "Select-Object -First 1 -ExpandProperty Name", _first_line),
    ("service_state", "powershell",
     "Get-Service -Name 'postgresql*' -ErrorAction SilentlyContinue | "
     "Select-Object -First 1 -ExpandProperty Status", _first_line),
    ("service_account", "powershell",
     "Get-CimInstance Win32_Service -Filter \"Name like 'postgresql%'\" | "
     "Select-Object -First 1 -ExpandProperty StartName", _first_line),
    ("install_path", "powershell",
     "Get-CimInstance Win32_Service -Filter \"Name like 'postgresql%'\" | "
     "Select-Object -First 1 -ExpandProperty PathName", _first_line),
    ("listen_port", "powershell",
     "Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | "
     "Where-Object { $_.OwningProcess -in (Get-Process postgres* -ErrorAction SilentlyContinue).Id } | "
     "Select-Object -First 1 -ExpandProperty LocalPort", _int_or_none),
]

_NIX_POSTGRES: List[Probe] = [
    ("data_directory", "sh",
     "psql -tAc 'SHOW data_directory' 2>/dev/null", _first_line),
    ("listen_addresses", "sh",
     "psql -tAc 'SHOW listen_addresses' 2>/dev/null", _first_line),
    ("listen_port", "sh", "psql -tAc 'SHOW port' 2>/dev/null", _int_or_none),
    ("ssl_enabled", "sh", "psql -tAc 'SHOW ssl' 2>/dev/null", _first_line),
    ("service_account", "sh",
     "ps -o user= -C postgres 2>/dev/null | head -1", _first_line),
]

_WINDOWS_MSSQL: List[Probe] = [
    ("service_name", "powershell",
     "Get-Service -Name 'MSSQL*' -ErrorAction SilentlyContinue | "
     "Select-Object -First 1 -ExpandProperty Name", _first_line),
    ("service_state", "powershell",
     "Get-Service -Name 'MSSQL*' -ErrorAction SilentlyContinue | "
     "Select-Object -First 1 -ExpandProperty Status", _first_line),
    ("service_account", "powershell",
     "Get-CimInstance Win32_Service -Filter \"Name like 'MSSQL%'\" | "
     "Select-Object -First 1 -ExpandProperty StartName", _first_line),
    ("instance_names", "powershell",
     "(Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Microsoft SQL Server' "
     "-Name InstalledInstances -ErrorAction SilentlyContinue).InstalledInstances -join ','",
     _first_line),
]

_WINDOWS_IIS: List[Probe] = [
    ("site_count", "powershell",
     "(Get-Website -ErrorAction SilentlyContinue | Measure-Object).Count", _int_or_none),
    ("sites", "powershell",
     "(Get-Website -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Name) -join ','",
     _first_line),
    ("app_pools", "powershell",
     "(Get-IISAppPool -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Name) -join ','",
     _first_line),
    ("service_state", "powershell",
     "Get-Service -Name 'W3SVC' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Status",
     _first_line),
]

_NIX_NGINX: List[Probe] = [
    ("config_file", "sh", "nginx -t 2>&1 | grep -o '/[^ ]*nginx.conf' | head -1", _first_line),
    ("worker_user", "sh", "grep -E '^\\s*user\\s+' /etc/nginx/nginx.conf 2>/dev/null | head -1",
     _kv(r"user\s+([^;]+);")),
    ("listen_port", "sh",
     "grep -REho 'listen\\s+[0-9]+' /etc/nginx 2>/dev/null | head -1", _int_or_none),
    ("service_account", "sh", "ps -o user= -C nginx 2>/dev/null | head -1", _first_line),
]

_NIX_MYSQL: List[Probe] = [
    ("data_directory", "sh", "mysql -N -B -e 'SELECT @@datadir' 2>/dev/null", _first_line),
    ("listen_port", "sh", "mysql -N -B -e 'SELECT @@port' 2>/dev/null", _int_or_none),
    ("ssl_enabled", "sh", "mysql -N -B -e \"SHOW VARIABLES LIKE 'have_ssl'\" 2>/dev/null", _first_line),
    ("service_account", "sh", "ps -o user= -C mysqld 2>/dev/null | head -1", _first_line),
]

# software_key prefix → {host transport → probes}
_REGISTRY: List[Tuple[str, Dict[str, List[Probe]]]] = [
    ("postgresql", {"windows": _WINDOWS_POSTGRES, "linux": _NIX_POSTGRES}),
    ("mssql",      {"windows": _WINDOWS_MSSQL}),
    ("iis",        {"windows": _WINDOWS_IIS}),
    ("nginx",      {"linux": _NIX_NGINX}),
    ("mysql",      {"linux": _NIX_MYSQL}),
]


def probes_for(software_key: str, transport: str) -> List[Probe]:
    """Probes for this product on this host platform; empty when unsupported."""
    key = (software_key or "").lower()
    for prefix, by_transport in _REGISTRY:
        if key.startswith(prefix):
            return by_transport.get((transport or "").lower(), [])
    return []


def supported_keys() -> List[str]:
    return [p for p, _ in _REGISTRY]


def profile_software(run_command, software_key: str, transport: str) -> Dict[str, Any]:
    """Collect a product's own attributes.

    ``run_command(shell, command) -> (stdout, exit_status)`` is supplied by the
    caller so this module stays transport-agnostic and unit-testable — it does
    not care whether the bytes came over WinRM or SSH.

    Every probe is isolated: one failing attribute never aborts the profile.
    Returns only attributes that produced a value, plus provenance so the UI can
    say when it was read and how many probes actually answered.
    """
    from datetime import datetime

    probes = probes_for(software_key, transport)
    if not probes:
        return {}
    out: Dict[str, Any] = {}
    attempted = 0
    for attr, shell, command, parser in probes:
        attempted += 1
        try:
            stdout, rc = run_command(shell, command)
            if rc != 0 and not (stdout or "").strip():
                continue
            value = parser(stdout or "")
            if value not in (None, "", []):
                out[attr] = value
        except Exception:  # noqa: BLE001 — a probe is best-effort by design
            logger.debug("software_profiler: probe %s failed for %s", attr, software_key,
                         exc_info=True)
    if out:
        out["_collected_at"] = datetime.utcnow().isoformat(timespec="seconds")
        out["_probes_answered"] = f"{len(out) - 1}/{attempted}"
    return out
