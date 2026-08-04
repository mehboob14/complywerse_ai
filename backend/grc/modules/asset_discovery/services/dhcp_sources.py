"""DHCP source adapters + passive listener + orchestration.

The pure parsing/enrichment logic lives in `dhcp_enrich`. This module is the
side-effecting layer: it FETCHES lease data from a real DHCP source (over the
same WinRM/SSH transports Connect already uses) or captures it passively off the
wire, hands the raw text/packets to the tested parsers, and folds the result
onto observations via `enrich_observations`.

A "DHCP source" is not a new config object — it is just a saved Connect
credential (`CredentialProfile`) pointed at the box that hands out leases, plus
a `source_type` telling us which command/parser to use. That keeps the whole
feature inside the credential model the operator already understands.

Transport fetches can't be unit-tested without the live box, so they are thin,
defensive wrappers around the ALREADY-tested runners + parsers: build creds →
run one read-only command → parse. The passive listener degrades gracefully
(returns a reason) when it lacks the privilege/OS support to bind the DHCP port.
"""
from __future__ import annotations

import logging
import socket
from typing import Dict, List, Optional

from .dhcp_enrich import (
    DhcpLease, enrich_observations, parse_dhcp_packet,
    parse_dnsmasq, parse_isc_dhcpd, parse_mikrotik, parse_windows_leases,
)

logger = logging.getLogger(__name__)

# source_type -> (transport, shell, command, parser)
_SSH_READS = {
    "mikrotik": ("linux", "/ip dhcp-server lease print detail without-paging", parse_mikrotik),
    "dnsmasq": ("linux",
                "cat /var/lib/misc/dnsmasq.leases 2>/dev/null || "
                "cat /var/lib/dnsmasq/dnsmasq.leases 2>/dev/null || "
                "cat /tmp/dnsmasq.leases 2>/dev/null", parse_dnsmasq),
    "isc": ("linux",
            "cat /var/lib/dhcp/dhcpd.leases 2>/dev/null || "
            "cat /var/lib/dhcpd/dhcpd.leases 2>/dev/null", parse_isc_dhcpd),
}
_WIN_READ_CMD = (
    "Get-DhcpServerv4Scope | Get-DhcpServerv4Lease | "
    "Select-Object IPAddress,ClientId,HostName,AddressState | "
    "ConvertTo-Csv -NoTypeInformation"
)
SOURCE_TYPES = tuple(_SSH_READS.keys()) + ("windows",)


def _run_command(transport: str, shell: str, command: str, creds: Dict) -> str:
    """Run one read-only command via the existing WinRM/SSH runner; return stdout
    (empty string on any failure — a source we can't read just yields no leases)."""
    try:
        from grc.modules.compliance_plugins.runners.winrm_runner import windows_winrm_runner
        from grc.modules.compliance_plugins.runners.ssh_runner import linux_ssh_runner
        cd = {"shell": shell, "command": command, "expect": {"kind": "exit_zero"}}
        runner = windows_winrm_runner if transport == "windows" else linux_ssh_runner
        res = runner(cd, creds)
        out = res.raw_output or {}
        return out.get("stdout", "") or ""
    except Exception:  # noqa: BLE001
        logger.info("dhcp source read failed (%s)", transport, exc_info=True)
        return ""


def fetch_from_credential(profile, ip: str, source_type: str) -> List[DhcpLease]:
    """Read the lease table from one DHCP source described by a saved credential.
    `profile` is a CredentialProfile; `ip` is the DHCP server address; source_type
    is one of SOURCE_TYPES. Returns parsed leases (possibly empty)."""
    from .deep_collect import _credentials_dict

    if source_type == "windows":
        creds = _credentials_dict(profile, ip, "windows")
        raw = _run_command("windows", "powershell", _WIN_READ_CMD, creds)
        return parse_windows_leases(raw)

    spec = _SSH_READS.get(source_type)
    if spec is None:
        return []
    transport, command, parser = spec
    creds = _credentials_dict(profile, ip, "linux")
    raw = _run_command("linux", "sh", command, creds)
    return parser(raw)


# ── passive listener ─────────────────────────────────────────────────────────
def passive_capture(seconds: float = 20.0) -> Dict[str, object]:
    """Best-effort passive DHCP capture: bind UDP/67 and read the DHCP traffic
    the segment broadcasts, parsing hostname/vendor-class from each packet.

    Honest about its limits: binding the DHCP port needs elevated privilege and a
    segment that actually broadcasts to us (same L2, or a relay/mirror). Where
    that isn't available it returns a `reason` and no leases rather than
    pretending. Robust capture across routed segments needs a packet-capture
    library and is deliberately out of this dependency-free build."""
    leases: List[DhcpLease] = []
    seen: set = set()
    sock = None
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
        except OSError:
            pass
        sock.bind(("", 67))
        sock.settimeout(1.0)
    except (OSError, PermissionError) as exc:
        if sock is not None:
            sock.close()
        return {"leases": [], "reason": f"cannot bind DHCP port 67 ({exc}); "
                f"passive capture needs admin/root and a broadcast-visible segment",
                "captured": 0}

    import time  # local: time is fine at runtime (not in workflow scripts)
    deadline = time.monotonic() + max(1.0, seconds)
    try:
        while time.monotonic() < deadline:
            try:
                data, _addr = sock.recvfrom(2048)
            except socket.timeout:
                continue
            lease = parse_dhcp_packet(data)
            if lease and (lease.hostname or lease.vendor_class) and lease.mac:
                if lease.mac not in seen:
                    seen.add(lease.mac)
                    leases.append(lease)
    finally:
        sock.close()
    return {"leases": leases, "reason": None, "captured": len(leases)}


# ── orchestration ────────────────────────────────────────────────────────────
def run_dhcp_enrichment(db, tenant_id: int, sources: List[Dict],
                        run_id: Optional[int] = None) -> Dict[str, object]:
    """Fetch leases from each configured source, plus optional passive capture,
    then enrich this tenant's observations once with the merged set. `sources` is
    a list of {profile, ip, source_type}. Caller commits. Returns a tally."""
    all_leases: List[DhcpLease] = []
    per_source: List[Dict] = []
    for s in sources:
        try:
            got = fetch_from_credential(s["profile"], s["ip"], s["source_type"])
        except Exception:  # noqa: BLE001 — one bad source must not sink the rest
            logger.info("dhcp source %s failed", s.get("source_type"), exc_info=True)
            got = []
        per_source.append({"ip": s.get("ip"), "source_type": s.get("source_type"),
                           "leases": len(got)})
        all_leases.extend(got)

    tally = enrich_observations(db, tenant_id, all_leases, run_id=run_id)
    tally["sources"] = per_source
    tally["leases_total"] = len(all_leases)
    return tally
