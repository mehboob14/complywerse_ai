"""DHCP-lease enrichment for asset discovery.

An unauthenticated sweep learns nothing about a silent / privacy-MAC device
beyond IP + MAC. But that same device almost always told the DHCP server its
*hostname* (Option 12) and often a vendor class (Option 60) when it took its
lease — even while hiding from our probes. So the DHCP server holds names and
device hints for exactly the devices the sweep can't identify.

This module is the vendor-neutral core: a `DhcpLease` record, PARSERS that turn
each DHCP source's raw output into leases (pure functions — fully testable with
no network), a small DHCP FINGERPRINT map (vendor class -> os/device guess), and
`enrich_observations` which folds leases onto discovery observations (fills a
blank host_name, records the DHCP evidence, and lifts an Unknown to a real type
when the fingerprint is clear). Transport adapters (MikroTik / Windows / dnsmasq
/ SNMP) and the passive listener live in sibling modules and all produce
`DhcpLease` objects consumed here — so the matching/enrichment logic is written
and tested exactly once.

No third-party dependencies; safe to import anywhere.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple

__all__ = [
    "DhcpLease", "normalize_mac", "guess_from_dhcp",
    "parse_mikrotik", "parse_dnsmasq", "parse_isc_dhcpd", "parse_windows_leases",
    "parse_dhcp_packet", "enrich_observations",
]


# ── model ────────────────────────────────────────────────────────────────────
@dataclass
class DhcpLease:
    """One DHCP binding. ip/mac are the join keys; hostname/vendor_class are the
    enrichment payload. `source` records where it came from (audit)."""
    ip: Optional[str] = None
    mac: Optional[str] = None
    hostname: Optional[str] = None
    vendor_class: Optional[str] = None   # DHCP Option 60
    param_list: Optional[str] = None     # DHCP Option 55 (comma-joined ints)
    source: str = "dhcp"

    def is_useful(self) -> bool:
        return bool(self.mac or self.ip) and bool(self.hostname or self.vendor_class)


def normalize_mac(mac: Optional[str]) -> Optional[str]:
    """Lower-case, colon-separated 6-octet MAC, or None. Accepts aa-bb, aabb.ccdd
    forms and stray whitespace so every parser/source keys the same way."""
    if not mac:
        return None
    hexs = re.sub(r"[^0-9a-fA-F]", "", mac).lower()
    if len(hexs) != 12:
        return None
    return ":".join(hexs[i:i + 2] for i in range(0, 12, 2))


def _clean_host(h: Optional[str]) -> Optional[str]:
    """A hostname or None. Drop the placeholders the sources use for 'no name'."""
    if not h:
        return None
    h = h.strip().strip('"').strip()
    if not h or h in ("*", "-", "unknown", "(none)", "N/A"):
        return None
    return h[:120]


# ── DHCP fingerprint: vendor class (Option 60) -> (device_type, os) ───────────
# Conservative and HONEST: only substrings that are unambiguous. Absence of a
# match yields no guess (never a bad one). Option 60 is the reliable signal; the
# Option 55 parameter-list fingerprint is intentionally NOT hard-coded here (it
# is noisy without a full Fingerbank-style DB) — vendor class carries the weight.
_VENDOR_CLASS_SIGNS: List[Tuple[str, Optional[str], Optional[str]]] = [
    # substring (lowercased)     device_type   os
    ("msft",                      "host",       "windows"),   # "MSFT 5.0" / "MSFT 98"
    ("android-dhcp",              "host",       "android"),
    ("dhcpcd",                    "host",       "linux"),
    ("udhcp",                     "host",       "linux"),      # busybox / embedded linux
    ("linux",                     "host",       "linux"),
    ("ubuntu",                    "host",       "linux"),
    ("debian",                    "host",       "linux"),
    ("pxeclient",                 "host",       None),         # netboot -> a host
    ("ipxe",                      "host",       None),
    ("hewlett",                   "printer",    None),
    ("hp ",                       "printer",    None),
    ("jetdirect",                 "printer",    None),
    ("canon",                     "printer",    None),
    ("epson",                     "printer",    None),
    ("brother",                   "printer",    None),
    ("lexmark",                   "printer",    None),
    ("cisco",                     "network_device", None),
    ("mikrotik",                  "network_device", None),
    ("aruba",                     "network_device", None),
    ("ubnt",                      "network_device", None),     # Ubiquiti
    ("axis",                      "camera",     None),
    ("hikvision",                 "camera",     None),
    ("dahua",                     "camera",     None),
    ("polycom",                   "voip",       None),
    ("yealink",                   "voip",       None),
    ("grandstream",               "voip",       None),
]


def guess_from_dhcp(vendor_class: Optional[str]) -> Tuple[Optional[str], Optional[str]]:
    """(device_type, os) inferred from the DHCP vendor class, or (None, None).
    A best-effort hint — the caller applies it only to still-Unknown devices and
    tags it as DHCP evidence, never overriding a probe-proven classification."""
    if not vendor_class:
        return (None, None)
    v = vendor_class.lower()
    for sub, dt, os_ in _VENDOR_CLASS_SIGNS:
        if sub in v:
            return (dt, os_)
    return (None, None)


# ── parsers (pure functions — one per source format) ─────────────────────────
def parse_mikrotik(text: str) -> List[DhcpLease]:
    """RouterOS `/ip dhcp-server lease print detail` (or API) output — space-
    separated key=value tokens, one lease per record. Robust to reordering."""
    leases: List[DhcpLease] = []
    blob = re.sub(r"\r", "", text or "")
    # Records start at a line with a leading index number (RouterOS print /
    # print detail). Splitting there keeps each lease whole — note we must NOT
    # split on 'address=' itself, because 'mac-address=' contains it.
    records = re.split(r"(?m)^\s*\d+\s+", blob)

    def _kv(rec: str, key: str) -> Optional[str]:
        # (?<![-\w]) so 'address' does not also match inside 'mac-address'.
        m = re.search(rf'(?<![-\w]){key}=("([^"]*)"|(\S+))', rec)
        if not m:
            return None
        return m.group(2) if m.group(2) is not None else m.group(3)

    for rec in records:
        if "address=" not in rec:
            continue
        lease = DhcpLease(
            ip=_kv(rec, "address"),
            mac=normalize_mac(_kv(rec, "mac-address")),
            hostname=_clean_host(_kv(rec, "host-name")),
            source="mikrotik",
        )
        if lease.ip or lease.mac:
            leases.append(lease)
    return leases


def parse_dnsmasq(text: str) -> List[DhcpLease]:
    """dnsmasq leases file: `<expiry> <mac> <ip> <hostname> <clientid>` per line."""
    leases: List[DhcpLease] = []
    for line in (text or "").splitlines():
        f = line.split()
        if len(f) < 4:
            continue
        leases.append(DhcpLease(
            mac=normalize_mac(f[1]), ip=f[2],
            hostname=_clean_host(f[3]), source="dnsmasq",
        ))
    return leases


def parse_isc_dhcpd(text: str) -> List[DhcpLease]:
    """ISC dhcpd.leases: `lease <ip> { ... hardware ethernet <mac>; client-hostname "<h>"; }`."""
    leases: List[DhcpLease] = []
    for m in re.finditer(r"lease\s+(\d+\.\d+\.\d+\.\d+)\s*\{(.*?)\}", text or "", re.S):
        ip, body = m.group(1), m.group(2)
        mac_m = re.search(r"hardware\s+ethernet\s+([0-9a-fA-F:]+)\s*;", body)
        host_m = re.search(r'client-hostname\s+"([^"]*)"\s*;', body)
        vc_m = re.search(r'vendor-class-identifier\s+"([^"]*)"\s*;', body)
        leases.append(DhcpLease(
            ip=ip, mac=normalize_mac(mac_m.group(1) if mac_m else None),
            hostname=_clean_host(host_m.group(1) if host_m else None),
            vendor_class=(vc_m.group(1) if vc_m else None), source="isc-dhcpd",
        ))
    return leases


def parse_windows_leases(text: str) -> List[DhcpLease]:
    """Windows `Get-DhcpServerv4Lease | Export-Csv` output — a CSV with (at least)
    IPAddress, ClientId (the MAC), HostName columns. Header order is not assumed."""
    import csv
    import io
    leases: List[DhcpLease] = []
    # Strip a possible '#TYPE ...' first line that Export-Csv emits.
    lines = [ln for ln in (text or "").splitlines() if not ln.startswith("#TYPE")]
    reader = csv.DictReader(io.StringIO("\n".join(lines)))
    if not reader.fieldnames:
        return leases
    # case-insensitive column resolution
    cols = {c.lower().strip(): c for c in reader.fieldnames}
    ip_c = cols.get("ipaddress") or cols.get("ip")
    mac_c = cols.get("clientid") or cols.get("macaddress") or cols.get("mac")
    host_c = cols.get("hostname") or cols.get("name")
    for row in reader:
        leases.append(DhcpLease(
            ip=(row.get(ip_c) or "").strip() or None if ip_c else None,
            mac=normalize_mac(row.get(mac_c) if mac_c else None),
            hostname=_clean_host(row.get(host_c) if host_c else None),
            source="windows-dhcp",
        ))
    return leases


# ── passive: parse a raw DHCP packet (for the sniffing listener) ─────────────
_DHCP_MAGIC = b"\x63\x82\x53\x63"


def parse_dhcp_packet(data: bytes) -> Optional[DhcpLease]:
    """Parse a BOOTP/DHCP message: client MAC (chaddr), Option 12 hostname,
    Option 60 vendor class, Option 55 parameter list. Returns a DhcpLease (with
    no IP — the client may not have one yet) or None if it isn't DHCP. Never
    raises on a malformed packet."""
    try:
        if len(data) < 240 or data[236:240] != _DHCP_MAGIC:
            return None
        hlen = data[2]
        chaddr = data[28:28 + (hlen if 1 <= hlen <= 16 else 6)]
        mac = normalize_mac(chaddr.hex())
        host = vclass = None
        params = None
        i = 240
        n = len(data)
        while i < n:
            code = data[i]
            if code == 255:       # END
                break
            if code == 0:         # PAD
                i += 1
                continue
            if i + 1 >= n:
                break
            ln = data[i + 1]
            val = data[i + 2:i + 2 + ln]
            if code == 12:
                host = val.decode("utf-8", "replace")
            elif code == 60:
                vclass = val.decode("latin-1", "replace")
            elif code == 55:
                params = ",".join(str(b) for b in val)
            i += 2 + ln
        return DhcpLease(mac=mac, hostname=_clean_host(host),
                         vendor_class=vclass, param_list=params, source="passive")
    except Exception:
        return None


# ── enrichment: fold leases onto discovery observations ──────────────────────
def _index(leases: List[DhcpLease]) -> Tuple[Dict[str, DhcpLease], Dict[str, DhcpLease]]:
    """Index leases by mac and by ip. A later, more-complete lease wins (has a
    hostname over one that doesn't)."""
    by_mac: Dict[str, DhcpLease] = {}
    by_ip: Dict[str, DhcpLease] = {}
    for l in leases:
        if l.mac:
            cur = by_mac.get(l.mac)
            if cur is None or (l.hostname and not cur.hostname):
                by_mac[l.mac] = l
        if l.ip:
            cur = by_ip.get(l.ip)
            if cur is None or (l.hostname and not cur.hostname):
                by_ip[l.ip] = l
    return by_mac, by_ip


def enrich_observations(db, tenant_id: int, leases: List[DhcpLease],
                        run_id: Optional[int] = None) -> Dict[str, int]:
    """Apply DHCP leases to this tenant's discovery observations. Matches by MAC
    first (stable across IP changes), then IP. Fills a BLANK host_name, records
    the DHCP evidence under raw.fingerprint.dhcp, and — only when the observation
    is still Unknown/None — lifts it to the DHCP-inferred type. Never overwrites a
    probe-proven name or type. Returns a small tally. Caller commits.

    Import is local so the module stays dependency-free for unit tests.
    """
    from grc.models._47_asset_discovery_models import DiscoveryObservation

    by_mac, by_ip = _index([l for l in leases if l.is_useful() or l.hostname])
    if not by_mac and not by_ip:
        return {"matched": 0, "named": 0, "typed": 0}

    q = db.query(DiscoveryObservation).filter(
        DiscoveryObservation.tenant_id == tenant_id,
    )
    if run_id is not None:
        q = q.filter(DiscoveryObservation.run_id == run_id)

    matched = named = typed = 0
    for obs in q.all():
        lease = None
        omac = normalize_mac(obs.mac_address)
        if omac and omac in by_mac:
            lease = by_mac[omac]
        elif obs.ip_address and obs.ip_address in by_ip:
            lease = by_ip[obs.ip_address]
        if lease is None:
            continue
        matched += 1

        raw = dict(obs.raw or {})
        fp = dict(raw.get("fingerprint") or {})
        fp["dhcp"] = {"hostname": lease.hostname, "vendor_class": lease.vendor_class,
                      "source": lease.source}

        # 1) Name: fill only if the observation has none (probe names win).
        if lease.hostname and not obs.host_name:
            obs.host_name = lease.hostname
            named += 1

        # 2) Type/OS: only lift a still-Unknown device, and mark it DHCP-derived.
        dt, os_ = guess_from_dhcp(lease.vendor_class)
        cur_dt = raw.get("device_type")
        if dt and cur_dt in (None, "unknown"):
            raw["device_type"] = dt
            fp["device_type"] = dt
            if os_:
                raw["os_guess"] = raw.get("os_guess") or os_
                fp["os_guess"] = fp.get("os_guess") or os_
            ev = list(raw.get("evidence") or [])
            if "dhcp:vendor_class" not in ev:
                ev.append("dhcp:vendor_class")
            raw["evidence"] = fp["evidence"] = ev
            # DHCP class is a decent but not probe-grade signal.
            raw["confidence"] = max(raw.get("confidence") or 0, 0.6)
            fp["confidence"] = raw["confidence"]
            typed += 1

        raw["fingerprint"] = fp
        obs.raw = raw

    return {"matched": matched, "named": named, "typed": typed}
