"""Cisco / network-device deep inventory collector (SSH).

Legacy `collect_cisco` only parsed `show version`. This module keeps the exact
same paramiko connection setup and credential keys (ssh_host / ssh_port /
ssh_username / ssh_password / ssh_private_key) but runs a battery of read-only
`show` commands over the ONE session and parses each leniently.

Contract (see status.py):
  * Flat identity scalars live at the top (hostname, vendor, model, serial, os …).
  * Every DEEP section is a named key wrapped by `collect_section(...)`, so a
    command the platform doesn't support (NX-OS vs IOS) or the credential can't
    run degrades to `{"status": "not_supported"|..., "data": None}` and NEVER
    aborts the collect.
  * READ-ONLY. Only `show` commands (+ a best-effort `terminal length 0`).
"""
from __future__ import annotations

import re
from typing import Any, Dict, List, Optional

from . import (
    register, collect_section, section, discovered,
    DISCOVERED, PERMISSION_DENIED, NOT_SUPPORTED, NOT_APPLICABLE, UNAVAILABLE, ERROR,
)

# Per-list cap — keep counts for the remainder so big tables never blow the row.
_CAP = 200


def _cap(items: List[Any]) -> tuple[List[Any], int]:
    """Return (bounded list, total count)."""
    total = len(items)
    return items[:_CAP], total


class _UnsupportedCommand(Exception):
    """Raised when a `show` command output signals the platform rejected it, so
    `collect_section` classifies the section as not_supported / permission_denied
    instead of returning an empty-but-DISCOVERED table."""


_ERR_HINTS = (
    "% invalid input", "% invalid command", "invalid input detected",
    "% incomplete command", "% ambiguous command", "% unknown command",
    "% not supported", "syntax error", "% permission denied", "command authorization failed",
    "% authorization failed", "% bad ip address",
)


def _guard(out: str) -> str:
    """Raise `_UnsupportedCommand` if the device rejected the command; otherwise
    return the output unchanged. Empty output is allowed (caller decides)."""
    low = out.lower()
    for h in _ERR_HINTS:
        if h in low:
            raise _UnsupportedCommand(out.strip()[:200] or h)
    return out


def _first(pat: str, text: str, flags: int = re.IGNORECASE) -> Optional[str]:
    m = re.search(pat, text, flags)
    if not m:
        return None
    for g in (m.groups() or (m.group(0),)):
        if g:
            return g.strip()
    return None


def _detect_os(ver: str) -> str:
    low = ver.lower()
    if "nx-os" in low or "nexus" in low:
        return "NX-OS"
    if "ios-xe" in low or "ios xe" in low:
        return "IOS-XE"
    if "ios xr" in low or "ios-xr" in low:
        return "IOS-XR"
    if "adaptive security appliance" in low or "asa" in low:
        return "ASA"
    if "ios" in low:
        return "IOS"
    return ""


# ── section parsers ─────────────────────────────────────────────────────────

def _parse_inventory(out: str) -> List[Dict[str, Any]]:
    """`show inventory` → list of {name, descr, pid, serial}. Format:
        NAME: "Chassis", DESCR: "..."
        PID: WS-..., VID: V03, SN: FOC..."""
    _guard(out)
    items: List[Dict[str, Any]] = []
    name = descr = None
    for line in out.splitlines():
        nm = re.search(r'NAME:\s*"?([^",]+)"?\s*,\s*DESCR:\s*"?([^"]*)"?', line, re.IGNORECASE)
        if nm:
            name, descr = nm.group(1).strip(), nm.group(2).strip()
            continue
        pm = re.search(r'PID:\s*(\S*)\s*,?.*?SN:\s*(\S+)', line, re.IGNORECASE)
        if pm:
            items.append({
                "name": name, "descr": descr,
                "pid": pm.group(1).strip(" ,") or None,
                "serial": pm.group(2).strip(),
            })
            name = descr = None
    bounded, total = _cap(items)
    return {"items": bounded, "count": total}


def _parse_ip_int_brief(out: str) -> List[Dict[str, Any]]:
    """`show ip interface brief` → per-interface primary IP + status."""
    _guard(out)
    rows: List[Dict[str, Any]] = []
    for line in out.splitlines()[1:]:
        parts = line.split()
        if len(parts) >= 6 and not line.lower().startswith("interface"):
            rows.append({
                "name": parts[0],
                "ipv4": None if parts[1].lower() in ("unassigned", "unset") else parts[1],
                "oper_state": parts[-1],
                "admin_state": parts[-2],
            })
    return rows


def _parse_interfaces(out: str) -> List[Dict[str, Any]]:
    """`show interfaces` → rich per-interface record. Parsed leniently block by
    block (a block starts at a line beginning in column 0 with "X is ...")."""
    _guard(out)
    rows: List[Dict[str, Any]] = []
    cur: Optional[Dict[str, Any]] = None
    for line in out.splitlines():
        head = re.match(r"^(\S+) is (administratively down|up|down|reset)(?:, line protocol is (\S+))?", line)
        if head:
            if cur:
                rows.append(cur)
            admin = "down" if head.group(2).startswith("administratively") else "up"
            cur = {
                "name": head.group(1),
                "admin_state": admin,
                "oper_state": head.group(3) or head.group(2),
                "description": None, "mac": None, "ipv4": None,
                "speed": None, "duplex": None, "mtu": None,
            }
            continue
        if cur is None:
            continue
        d = _first(r"Description:\s*(.+)", line)
        if d:
            cur["description"] = d
        mac = _first(r"address is\s+([0-9a-f\.]{14})", line)
        if mac:
            cur["mac"] = mac
        ip = _first(r"Internet address is\s+([0-9\.]+/?\d*)", line)
        if ip:
            cur["ipv4"] = ip
        mtu = _first(r"MTU\s+(\d+)\s*bytes", line)
        if mtu:
            cur["mtu"] = mtu
        dup = _first(r"\b(Full|Half|Auto)-duplex", line)
        if dup:
            cur["duplex"] = dup
        spd = _first(r"[, ]\s*([0-9]+\s*[MGK]b/s|Auto-speed)", line)
        if spd:
            cur["speed"] = spd
    if cur:
        rows.append(cur)
    bounded, total = _cap(rows)
    return {"items": bounded, "count": total}


def _parse_int_status(out: str) -> List[Dict[str, Any]]:
    """`show interfaces status` → {name, description, oper_state, vlan, duplex,
    speed, type}."""
    _guard(out)
    rows: List[Dict[str, Any]] = []
    for line in out.splitlines():
        if not line.strip() or line.lower().startswith("port"):
            continue
        parts = line.split()
        if len(parts) < 4:
            continue
        # Port [Name...] Status Vlan Duplex Speed Type — Name may contain spaces.
        rows.append({
            "name": parts[0],
            "oper_state": parts[-5] if len(parts) >= 6 else None,
            "vlan": parts[-4] if len(parts) >= 5 else None,
            "duplex": parts[-3] if len(parts) >= 4 else None,
            "speed": parts[-2] if len(parts) >= 3 else None,
            "type": parts[-1],
        })
    bounded, total = _cap(rows)
    return {"items": bounded, "count": total}


def _parse_vlans(out: str) -> Dict[str, Any]:
    """`show vlan brief` → {vlan_id, name, status, ports}."""
    _guard(out)
    rows: List[Dict[str, Any]] = []
    for line in out.splitlines():
        m = re.match(r"^\s*(\d{1,4})\s+(\S+)\s+(active|act/lshut|suspended|\S+)\s*(.*)$", line)
        if m:
            ports = [p.strip() for p in m.group(4).replace(",", " ").split() if p.strip()]
            rows.append({
                "vlan_id": m.group(1), "name": m.group(2),
                "status": m.group(3), "ports": ports,
            })
    bounded, total = _cap(rows)
    return {"items": bounded, "count": total}


def _parse_mac_table(out: str) -> Dict[str, Any]:
    """`show mac address-table` → {mac, vlan, port}."""
    _guard(out)
    rows: List[Dict[str, Any]] = []
    for line in out.splitlines():
        m = re.search(r"^\s*(\d+|All)\s+([0-9a-f]{4}\.[0-9a-f]{4}\.[0-9a-f]{4})\s+(\S+)\s+(\S+)\s*$", line, re.IGNORECASE)
        if m:
            rows.append({"vlan": m.group(1), "mac": m.group(2), "port": m.group(4)})
    bounded, total = _cap(rows)
    return {"items": bounded, "count": total}


def _parse_arp(out: str) -> Dict[str, Any]:
    """`show ip arp` → {ip, mac, interface}."""
    _guard(out)
    rows: List[Dict[str, Any]] = []
    for line in out.splitlines():
        m = re.search(
            r"Internet\s+([0-9\.]+)\s+\S+\s+([0-9a-f]{4}\.[0-9a-f]{4}\.[0-9a-f]{4})\s+\S+\s+(\S+)",
            line, re.IGNORECASE)
        if m:
            rows.append({"ip": m.group(1), "mac": m.group(2), "interface": m.group(3)})
    bounded, total = _cap(rows)
    return {"items": bounded, "count": total}


def _parse_route_summary(out: str) -> Dict[str, Any]:
    """`show ip route summary` → route count by protocol. Falls back to counting
    prefixes in `show ip route` when summary isn't available."""
    _guard(out)
    by_proto: Dict[str, int] = {}
    total = None
    for line in out.splitlines():
        m = re.match(r"^\s*([a-zA-Z][a-zA-Z0-9 _\-]+?)\s+\d+\s+\d+\s+\d+\s+(\d+)", line)
        if m:
            by_proto[m.group(1).strip()] = int(m.group(2))
        tm = re.search(r"Total\s+\S+\s+\S+\s+\S+\s+(\d+)", line, re.IGNORECASE)
        if tm:
            total = int(tm.group(1))
    if by_proto or total is not None:
        return {"by_protocol": by_proto, "total": total}
    # Fallback: count "X.X.X.X/nn" prefixes in a raw route table.
    prefixes = len(re.findall(r"\b\d{1,3}(?:\.\d{1,3}){3}/\d+", out))
    return {"by_protocol": {}, "total": prefixes or None}


def _parse_vrf(out: str) -> Dict[str, Any]:
    """`show vrf` → list of VRF names."""
    _guard(out)
    vrfs: List[str] = []
    for line in out.splitlines()[1:]:
        parts = line.split()
        if parts and not line.lower().startswith(("name", "vrf")):
            vrfs.append(parts[0])
    return {"vrfs": vrfs, "count": len(vrfs)}


def _parse_cdp(out: str) -> Dict[str, Any]:
    """`show cdp neighbors detail` → {device_id, local_intf, remote_intf,
    platform, ip}."""
    _guard(out)
    rows: List[Dict[str, Any]] = []
    for block in re.split(r"-{4,}", out):
        if "Device ID" not in block:
            continue
        rows.append({
            "device_id": _first(r"Device ID:\s*(\S+)", block),
            "ip": _first(r"IP(?:v4)? address:\s*([0-9\.]+)", block),
            "platform": _first(r"Platform:\s*([^,]+)", block),
            "local_intf": _first(r"Interface:\s*([^,]+)", block),
            "remote_intf": _first(r"Port ID \(outgoing port\):\s*(.+)", block),
        })
    bounded, total = _cap(rows)
    return {"items": bounded, "count": total}


def _parse_kv(out: str) -> Dict[str, Any]:
    """Generic: keep a bounded raw snippet for status/config commands whose value
    is the human-readable text itself (NTP / SNMP / STP / etherchannel)."""
    _guard(out)
    text = out.strip()
    if not text:
        raise _UnsupportedCommand("empty output")
    return {"raw": text[:1500]}


# ── the collector ───────────────────────────────────────────────────────────

@register("netdev_ssh")
def collect_cisco(creds: Dict[str, Any]) -> Dict[str, Any]:
    """Deep-inventory a Cisco (IOS / IOS-XE / NX-OS / ASA) device over read-only
    SSH. Same connection + credential keys as the legacy collector; runs a
    battery of `show` commands, each parsed leniently and wrapped as a status
    section so an unsupported command marks only that section not_supported."""
    try:
        import paramiko  # type: ignore
    except ImportError:
        raise RuntimeError("paramiko not installed on this server")

    host = creds.get("ssh_host")
    port = int(creds.get("ssh_port") or 22)
    user = creds.get("ssh_username")
    pw = creds.get("ssh_password")
    pkey = creds.get("ssh_private_key")
    if not host or not user:
        raise RuntimeError("SSH host and username are required")

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    kwargs: Dict[str, Any] = dict(
        hostname=host, port=port, username=user, timeout=15,
        allow_agent=False, look_for_keys=False,
    )
    if pkey:
        from io import StringIO
        try:
            kwargs["pkey"] = paramiko.RSAKey.from_private_key(StringIO(pkey))
        except Exception:  # noqa: BLE001
            kwargs["pkey"] = paramiko.Ed25519Key.from_private_key(StringIO(pkey))
    else:
        kwargs["password"] = pw
    client.connect(**kwargs)

    props: Dict[str, Any] = {"device_class": "network", "vendor": "Cisco", "host": host}
    try:
        def _run(cmd: str) -> str:
            _i, out, _e = client.exec_command(cmd, timeout=20)
            return out.read().decode(errors="replace")

        def _sec(cmd: str, parser):
            """Run a command and wrap its parsed result as a status section.
            A rejected command (or a parser raising _UnsupportedCommand) becomes
            a not_supported/permission_denied section, never aborting."""
            return collect_section(lambda: parser(_run(cmd)))

        # Best-effort disable paging so long outputs aren't truncated by --More--.
        try:
            _run("terminal length 0")
        except Exception:  # noqa: BLE001
            pass

        # ── device identity (flat scalars) from `show version` ──────────────
        ver = ""
        try:
            ver = _run("show version")
        except Exception:  # noqa: BLE001
            ver = ""
        os_name = _detect_os(ver)
        props["os"] = os_name or None
        props["hostname"] = (
            _first(r"^(\S+)\s+uptime is", ver, re.IGNORECASE | re.MULTILINE)
            or _first(r"Device name:\s*(\S+)", ver)
        )
        props["model"] = (
            _first(r"cisco\s+(\S+)\s+.*(?:processor|chassis)", ver)
            or _first(r"Model number\s*:\s*(\S+)", ver)
            or _first(r"[Hh]ardware:\s*([^\n,]+)", ver)
        )
        props["serial"] = (
            _first(r"[Pp]rocessor board ID\s+(\S+)", ver)
            or _first(r"System serial number\s*:\s*(\S+)", ver)
            or _first(r"Processor Serial Number\s*:\s*(\S+)", ver)
        )
        props["chassis_id"] = _first(r"[Cc]hassis(?:\s+ID)?\s*:?\s*(\S+)", ver)
        props["os_version"] = (
            _first(r"(?:IOS[ -].*?Version|NX-OS.*?version|Version)\s+([0-9][^\s,]+)", ver)
        )
        props["firmware"] = (
            _first(r"ROM:\s*(.+)", ver)
            or _first(r"BIOS:\s*version\s*(\S+)", ver)
        )
        props["uptime"] = _first(r"uptime is\s+(.+)", ver)
        props["boot_image"] = (
            _first(r'System image file is\s*"?([^"\n]+)"?', ver)
            or _first(r"boot(?:flash)?:\S*", ver)
        )
        props["raw_show_version"] = ver[:2000] if ver else None

        # ── hardware (cpu/mem/flash scalars + module list) ──────────────────
        def _hardware() -> Dict[str, Any]:
            hw: Dict[str, Any] = {
                "cpu": _first(r"([A-Za-z0-9\- ]*(?:CPU|processor)[^\n]*)", ver),
                "memory": _first(r"with\s+([0-9]+K?/?[0-9]*K?\s*bytes of (?:physical )?memory)", ver),
                "flash": _first(r"([0-9]+K?\s*bytes of .*[Ff]lash)", ver),
            }
            try:
                mem = _run("show processes memory")
                tot = _first(r"Total:\s*(\d+)", mem)
                used = _first(r"Used:\s*(\d+)", mem)
                if tot:
                    hw["memory_total_bytes"] = tot
                if used:
                    hw["memory_used_bytes"] = used
            except Exception:  # noqa: BLE001
                pass
            return hw
        props["hardware"] = collect_section(_hardware)

        # ── modules / line-cards / PSU / fans / sensors ─────────────────────
        props["modules"] = _sec("show inventory", _parse_inventory)
        props["environment"] = _sec("show environment", _parse_kv)

        # ── interfaces (rich; fall back to brief if `show interfaces` denied) ─
        props["interfaces"] = _sec("show interfaces", _parse_interfaces)
        props["ip_interfaces"] = _sec("show ip interface brief", _parse_ip_int_brief)
        props["interface_status"] = _sec("show interfaces status", _parse_int_status)

        # ── L2 / L3 tables ──────────────────────────────────────────────────
        props["vlans"] = _sec("show vlan brief", _parse_vlans)
        props["mac_table"] = _sec("show mac address-table", _parse_mac_table)
        props["arp"] = _sec("show ip arp", _parse_arp)
        props["routing"] = _sec("show ip route summary", _parse_route_summary)
        props["vrfs"] = _sec("show vrf", _parse_vrf)
        props["cdp_neighbors"] = _sec("show cdp neighbors detail", _parse_cdp)

        # ── config-posture sections (each independent) ──────────────────────
        props["ntp"] = _sec("show ntp status", _parse_kv)
        props["snmp"] = _sec("show snmp", _parse_kv)
        props["spanning_tree"] = _sec("show spanning-tree summary", _parse_kv)
        props["port_channels"] = _sec("show etherchannel summary", _parse_kv)

        return props
    finally:
        try:
            client.close()
        except Exception:  # noqa: BLE001
            pass
