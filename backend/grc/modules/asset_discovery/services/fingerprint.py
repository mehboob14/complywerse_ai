"""Protocol-aware service fingerprinting for discovery — dependency-free.

The lightweight presence sweep (executor._sweep_host) only knocks on the TCP
ports Windows/Linux answer on (445/3389/5985/5986 = Windows, 22 = SSH/Linux).
Network gear, DNS resolvers and web appliances speak other protocols — and
crucially **SNMP and DNS are UDP**, so a TCP connect never sees them. That's why
discovery only ever surfaced Windows/Linux.

This module adds quiet, protocol-aware probes so discovery can SEE and CLASSIFY
routers / switches / firewalls / DNS — not just Windows/Linux:

  * SNMP  — hand-built SNMPv2c GET of sysDescr.0 over UDP/161
  * DNS   — version.bind CHAOS TXT query over UDP/53
  * SSH   — banner grab on TCP/22
  * HTTP  — Server header on TCP/80 & 443

No third-party deps (no nmap, no pysnmp/dnspython): the SNMP GET and DNS query
are raw UDP packets built by hand, banners are plain sockets. Everything is
best-effort and NEVER raises — a silent host is "no evidence", never an error.

Design rule (per review): **classification is driven by the fingerprint, not by
an open port.** An open port only proves something is listening; the SNMP
sysDescr / SSH banner is what tells a Cisco router from a printer from a Windows
box that merely runs an SNMP agent.
"""
from __future__ import annotations

import os
import re
import socket
import ssl
from typing import Any, Callable, Dict, List, Optional

SNMP_PORT = 161
DNS_PORT = 53

# (ip, open_tcp_ports, timeout_s) -> evidence+classification dict
FingerprintFn = Callable[[str, List[int], float], Dict[str, Any]]


# ─── minimal BER/DER for one SNMPv2c GET ────────────────────────────────────
def _ber_len(n: int) -> bytes:
    if n < 0x80:
        return bytes([n])
    out = b""
    while n:
        out = bytes([n & 0xFF]) + out
        n >>= 8
    return bytes([0x80 | len(out)]) + out


def _tlv(tag: int, value: bytes) -> bytes:
    return bytes([tag]) + _ber_len(len(value)) + value


def _ber_int(n: int) -> bytes:
    if n == 0:
        return b"\x00"
    out = b""
    while n:
        out = bytes([n & 0xFF]) + out
        n >>= 8
    if out[0] & 0x80:  # keep it positive
        out = b"\x00" + out
    return out


# OID 1.3.6.1.2.1.1.1.0 (SNMPv2-MIB::sysDescr.0); first pair 1.3 -> 0x2b.
_SYSDESCR_OID = bytes([0x2B, 0x06, 0x01, 0x02, 0x01, 0x01, 0x01, 0x00])


def _build_snmp_get(community: bytes = b"public", request_id: int = 0x1A2B3C4D) -> bytes:
    version = _tlv(0x02, b"\x01")                      # INTEGER 1 -> SNMPv2c
    comm = _tlv(0x04, community)                       # OCTET STRING community
    varbind = _tlv(0x30, _tlv(0x06, _SYSDESCR_OID) + _tlv(0x05, b""))  # OID + NULL
    pdu = _tlv(
        0xA0,                                          # GetRequest-PDU
        _tlv(0x02, _ber_int(request_id))
        + _tlv(0x02, b"\x00")                          # error-status
        + _tlv(0x02, b"\x00")                          # error-index
        + _tlv(0x30, varbind),                         # variable-bindings
    )
    return _tlv(0x30, version + comm + pdu)


def _read_tlv(data: bytes, i: int):
    tag = data[i]; i += 1
    length = data[i]; i += 1
    if length & 0x80:
        num = length & 0x7F
        length = int.from_bytes(data[i:i + num], "big"); i += num
    value = data[i:i + length]; i += length
    return tag, value, i


def _udp_attempts() -> int:
    """How many times to send a UDP probe before giving up. Default 2 (one
    retry) — UDP is lossy, so a single dropped packet must not read as 'device
    not present'. Overridable via env DISCOVERY_UDP_ATTEMPTS."""
    try:
        return max(1, int(os.environ.get("DISCOVERY_UDP_ATTEMPTS", "2")))
    except ValueError:
        return 2


def _udp_roundtrip(ip: str, port: int, pkt: bytes, timeout: float) -> Optional[bytes]:
    """Send one UDP packet and wait for a reply, retrying on TIMEOUT to tolerate
    packet loss. Returns the response bytes, or None if every attempt timed out
    or the socket errored. Retries only on timeout — a hard error (unreachable)
    fails fast."""
    for _ in range(_udp_attempts()):
        sock = None
        try:
            sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            sock.settimeout(timeout)
            sock.sendto(pkt, (ip, port))
            return sock.recvfrom(4096)[0]
        except socket.timeout:
            continue  # lost packet — retry
        except Exception:
            return None
        finally:
            if sock is not None:
                try:
                    sock.close()
                except Exception:
                    pass
    return None


def _snmp_communities() -> List[bytes]:
    """SNMP read communities to try, from env DISCOVERY_SNMP_COMMUNITIES
    (comma-separated). Defaults to 'public' so out-of-the-box discovery works —
    but 'public' is NOT hard-coded as *the* production credential: set the env
    (ideally sourced from the discovery connection's stored SNMP credential) to
    your real read-only communities in production."""
    raw = os.environ.get("DISCOVERY_SNMP_COMMUNITIES", "public")
    out = [c.strip().encode() for c in raw.split(",") if c.strip()]
    return out or [b"public"]


def snmp_sysdescr(ip: str, timeout: float = 1.0,
                  communities: Optional[List[bytes]] = None) -> Optional[str]:
    """SNMPv2c GET sysDescr.0 over UDP/161, trying each configured community in
    turn; returns the description on the first reply, else None. A reply at all
    means SNMP is enabled and the sysDescr text drives classification. No reply
    is INCONCLUSIVE (SNMP may be off, filtered, or need a different community) —
    callers must never read None as 'definitely not an SNMP device'."""
    for community in (communities or _snmp_communities()):
        r = _snmp_get_one(ip, community, timeout)
        if r is not None:
            return r
    return None


def _snmp_get_one(ip: str, community: bytes, timeout: float) -> Optional[str]:
    if ":" in ip:  # IPv6 not handled by this raw-UDP v4 probe
        return None
    data = _udp_roundtrip(ip, SNMP_PORT, _build_snmp_get(community), timeout)
    if data is None:
        return None
    try:
        _, seq, _ = _read_tlv(data, 0)          # outer SEQUENCE
        i = 0
        _, _ver, i = _read_tlv(seq, i)
        _, _comm, i = _read_tlv(seq, i)
        _, pdu, i = _read_tlv(seq, i)           # response PDU
        j = 0
        _, _reqid, j = _read_tlv(pdu, j)
        _, errst, j = _read_tlv(pdu, j)
        if errst and errst[0] != 0:
            return None
        _, _erridx, j = _read_tlv(pdu, j)
        _, vbs, j = _read_tlv(pdu, j)           # varbind list
        _, vb, _ = _read_tlv(vbs, 0)            # first varbind
        k = 0
        _, _oid, k = _read_tlv(vb, k)           # OID
        vtag, val, k = _read_tlv(vb, k)         # value
        if vtag == 0x04:                        # OCTET STRING
            return val.decode("utf-8", "replace").strip() or None
    except Exception:
        return None
    return None


def dns_probe(ip: str, timeout: float = 1.0) -> Optional[str]:
    """Standard DNS query (root '.' NS record) over UDP/53. ANY valid DNS
    response — even REFUSED/SERVFAIL — proves the host speaks DNS, so it returns
    'dns'. A root/NS query is answered far more widely than 'version.bind',
    which many servers deliberately hide. No response is INCONCLUSIVE, never
    negative: we simply don't tag it, and never infer 'not a DNS server' from
    silence."""
    if ":" in ip:  # IPv6 not handled by this raw-UDP v4 probe
        return None
    txn = b"\x13\x37"
    header = txn + b"\x01\x00" + b"\x00\x01" + b"\x00\x00" + b"\x00\x00" + b"\x00\x00"
    question = b"\x00" + b"\x00\x02" + b"\x00\x01"  # root name, QTYPE NS, QCLASS IN
    data = _udp_roundtrip(ip, DNS_PORT, header + question, timeout)
    if data and len(data) >= 4 and data[:2] == txn and (data[2] & 0x80):  # id + response bit
        return "dns"
    return None


def ssh_banner(ip: str, timeout: float = 1.0) -> Optional[str]:
    sock = None
    try:
        sock = socket.create_connection((ip, 22), timeout=timeout)
        sock.settimeout(timeout)
        return sock.recv(256).decode("latin-1", "replace").strip() or None
    except Exception:
        return None
    finally:
        if sock is not None:
            try:
                sock.close()
            except Exception:
                pass


def http_server(ip: str, port: int, timeout: float = 1.0, tls: bool = False) -> Optional[str]:
    raw = None
    sock = None
    try:
        raw = socket.create_connection((ip, port), timeout=timeout)
        sock = ssl._create_unverified_context().wrap_socket(raw, server_hostname=ip) if tls else raw
        sock.settimeout(timeout)
        sock.sendall(f"HEAD / HTTP/1.0\r\nHost: {ip}\r\n\r\n".encode())
        resp = sock.recv(2048).decode("latin-1", "replace")
        for ln in resp.split("\r\n"):
            if ln.lower().startswith("server:"):
                return ln.split(":", 1)[1].strip() or None
        return None
    except Exception:
        return None
    finally:
        for s in (sock, raw):
            if s is not None:
                try:
                    s.close()
                except Exception:
                    pass


def http_probe(ip: str, port: int, timeout: float = 1.0, tls: bool = False):
    """GET / on an HTTP(S) port. Returns (server, title, auth) — the Server
    header, the HTML <title>, and any WWW-Authenticate realm. Any of these can
    identify a router / NAS / camera / printer admin page — turning a bare ':80'
    from 'Other' into a real device type."""
    raw = None
    sock = None
    try:
        raw = socket.create_connection((ip, port), timeout=timeout)
        sock = ssl._create_unverified_context().wrap_socket(raw, server_hostname=ip) if tls else raw
        sock.settimeout(timeout)
        sock.sendall(f"GET / HTTP/1.0\r\nHost: {ip}\r\nUser-Agent: asset-discovery\r\n\r\n".encode())
        buf = b""
        while len(buf) < 8192:
            chunk = sock.recv(4096)
            if not chunk:
                break
            buf += chunk
        resp = buf.decode("latin-1", "replace")
    except Exception:
        return (None, None, None)
    finally:
        for s in (sock, raw):
            if s is not None:
                try:
                    s.close()
                except Exception:
                    pass
    head, _, body = resp.partition("\r\n\r\n")
    server = auth = title = None
    for ln in head.split("\r\n"):
        low = ln.lower()
        if low.startswith("server:"):
            server = ln.split(":", 1)[1].strip()[:120] or None
        elif low.startswith("www-authenticate:"):
            auth = ln.split(":", 1)[1].strip()[:120] or None
    m = re.search(r"<title[^>]*>(.*?)</title>", body, re.I | re.S)
    if m:
        title = re.sub(r"\s+", " ", m.group(1)).strip()[:120] or None
    return (server, title, auth)


# sysDescr / banner keyword -> vendor. Network-gear signatures.
_NETDEV_SIGNS = [
    ("cisco", "cisco"), ("ios-xe", "cisco"), ("ios xe", "cisco"), ("nx-os", "cisco"),
    ("adaptive security appliance", "cisco"), ("juniper", "juniper"), ("junos", "juniper"),
    ("mikrotik", "mikrotik"), ("routeros", "mikrotik"), ("fortigate", "fortinet"),
    ("fortinet", "fortinet"), ("pan-os", "paloalto"), ("palo alto", "paloalto"),
    ("arista", "arista"), ("huawei", "huawei"), ("aruba", "aruba"), ("procurve", "hpe"),
    ("ubiquiti", "ubiquiti"), ("edgeos", "ubiquiti"), ("edgemax", "ubiquiti"),
    ("sonicwall", "sonicwall"), ("check point", "checkpoint"), ("checkpoint", "checkpoint"),
    ("big-ip", "f5"), ("f5 networks", "f5"),
]


def _match_netdev(text: str) -> Optional[str]:
    t = (text or "").lower()
    for kw, vendor in _NETDEV_SIGNS:
        if kw in t:
            return vendor
    return None


# Printers are the most common non-Windows/Linux box on a LAN; their SNMP
# sysDescr / HTTP header is a dead giveaway. "HP ETHERNET MULTI-ENVIRONMENT" is
# the classic HP JetDirect print-server signature.
_PRINTER_SIGNS = [
    ("hp ethernet multi-environment", "hp"), ("jetdirect", "hp"), ("laserjet", "hp"),
    ("officejet", "hp"), ("designjet", "hp"), ("lexmark", "lexmark"), ("brother", "brother"),
    ("canon", "canon"), ("epson", "epson"), ("xerox", "xerox"), ("phaser", "xerox"),
    ("kyocera", "kyocera"), ("ricoh", "ricoh"), ("zebra", "zebra"), ("sharp mx", "sharp"),
]


def _match_printer(text: str) -> Optional[str]:
    t = (text or "").lower()
    for kw, vendor in _PRINTER_SIGNS:
        if kw in t:
            return vendor
    return None


def _best_product(fp: Dict[str, Any]) -> Optional[str]:
    """The most human-readable identity string captured — SNMP sysDescr first
    (richest), else the HTTP Server header, else the SSH banner. This is 'which
    device it is', for display under the type."""
    for key in ("snmp_sysdescr", "http_server", "http_title", "ssh_banner"):
        v = fp.get(key)
        if v:
            first = str(v).splitlines()[0].strip()
            if first:
                return first[:120]
    return None


def netbios_name(ip: str, timeout: float = 1.0) -> Optional[str]:
    """NetBIOS node-status query (UDP/137) — asks a Windows host for its computer
    name DIRECTLY, no DNS needed, and it often answers even when SMB (445) is
    firewalled. Returns the computer name or None."""
    if ":" in ip:
        return None
    txn = b"\x13\x38"
    header = txn + b"\x00\x00" + b"\x00\x01" + b"\x00\x00" + b"\x00\x00" + b"\x00\x00"
    # Encoded wildcard name '*' -> 'CKAAAA...': 0x20 length + 32 bytes + 0x00.
    qname = b"\x20" + b"CKAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" + b"\x00"
    data = _udp_roundtrip(ip, 137, header + qname + b"\x00\x21\x00\x01", timeout)  # NBSTAT, IN
    if not data or len(data) < 57 or data[:2] != txn:
        return None
    try:
        idx = 56  # header(12) + answer name(34) + type/class/ttl/rdlen(10)
        num = data[idx]; idx += 1
        for _ in range(num):
            name = data[idx:idx + 15].decode("latin-1", "replace").rstrip(" \x00")
            suffix = data[idx + 15]
            group = bool(int.from_bytes(data[idx + 16:idx + 18], "big") & 0x8000)
            idx += 18
            if suffix == 0x00 and not group and name:  # unique workstation name
                return name
    except Exception:
        return None
    return None


def reverse_dns(ip: str, timeout: float = 1.0) -> Optional[str]:
    """OS reverse lookup (PTR) -> short hostname, or None. Best-effort; the
    socket timeout bounds it. Corporate LANs with DHCP-registered DNS resolve
    most managed hosts this way even when they answer no port."""
    old = socket.getdefaulttimeout()
    try:
        socket.setdefaulttimeout(timeout)
        name = socket.gethostbyaddr(ip)[0]
        return name.split(".")[0] if name else None
    except Exception:
        return None
    finally:
        try:
            socket.setdefaulttimeout(old)
        except Exception:
            pass


def _read_dns_name(data: bytes, off: int):
    """Read a DNS name at ``off``, following compression pointers. Returns
    (name, next_offset) where next_offset is the position right after the name
    as it appeared at the ORIGINAL offset (so answer parsing can continue)."""
    labels: List[str] = []
    orig_next = None
    guard = 0
    while off < len(data):
        length = data[off]
        if length == 0:
            off += 1
            if orig_next is None:
                orig_next = off
            break
        if (length & 0xC0) == 0xC0:  # compression pointer
            if orig_next is None:
                orig_next = off + 2
            off = ((length & 0x3F) << 8) | data[off + 1]
            guard += 1
            if guard > 20:
                break
            continue
        off += 1
        labels.append(data[off:off + length].decode("latin-1", "replace"))
        off += length
    return ".".join(labels), (orig_next if orig_next is not None else off)


def _dns_first_ptr_name(data: bytes) -> Optional[str]:
    """Return the target name of the first PTR answer in a DNS/mDNS response."""
    if len(data) < 12:
        return None
    qd = int.from_bytes(data[4:6], "big")
    an = int.from_bytes(data[6:8], "big")
    off = 12
    for _ in range(qd):
        _, off = _read_dns_name(data, off)
        off += 4  # qtype + qclass
    for _ in range(an):
        _, off = _read_dns_name(data, off)
        rtype = int.from_bytes(data[off:off + 2], "big")
        off += 8  # type(2) + class(2) + ttl(4)
        rdlen = int.from_bytes(data[off:off + 2], "big")
        off += 2
        if rtype == 12:  # PTR
            name, _ = _read_dns_name(data, off)
            return name or None
        off += rdlen
    return None


def mdns_name(ip: str, timeout: float = 1.0) -> Optional[str]:
    """Unicast mDNS (UDP/5353) reverse query. Bonjour / avahi devices — Macs,
    iPhones, AirPrint printers, Chromecasts, IoT — answer with their '.local'
    name even when every TCP port is closed. Returns the short name or None."""
    if ":" in ip:
        return None
    labels = ip.split(".")[::-1] + ["in-addr", "arpa"]
    qname = b"".join(bytes([len(x)]) + x.encode() for x in labels) + b"\x00"
    # header + question: QTYPE PTR (0x000c), QCLASS IN + unicast-response bit.
    pkt = (b"\x13\x3a" + b"\x00\x00" + b"\x00\x01" + b"\x00\x00" * 3
           + qname + b"\x00\x0c" + b"\x80\x01")
    data = _udp_roundtrip(ip, 5353, pkt, timeout)
    if not data:
        return None
    name = _dns_first_ptr_name(data)
    if name:
        return name.split(".")[0] or None
    return None


def ssdp_info(ip: str, timeout: float = 1.0) -> Optional[str]:
    """Unicast SSDP/UPnP M-SEARCH (UDP/1900). Smart TVs, media players, routers,
    NAS and IoT answer with a SERVER string (e.g. 'Linux/3.14 UPnP/1.0 ...').
    Returns that SERVER identity or None — a strong 'consumer/IoT device' clue."""
    if ":" in ip:
        return None
    req = (b"M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\n"
           b"MAN: \"ssdp:discover\"\r\nMX: 1\r\nST: ssdp:all\r\n\r\n")
    data = _udp_roundtrip(ip, 1900, req, timeout)
    if not data:
        return None
    for ln in data.decode("latin-1", "replace").split("\r\n"):
        if ln.lower().startswith("server:"):
            return ln.split(":", 1)[1].strip()[:120] or None
    return None


# Broader device signatures — discovery is not limited to Windows/Linux/network.
# (keyword, device_type, vendor). Matched against SNMP sysDescr / HTTP / SSH.
_OTHER_SIGNS = [
    # hypervisors
    ("vmware esxi", "hypervisor", "vmware"), ("esxi", "hypervisor", "vmware"),
    ("vsphere", "hypervisor", "vmware"), ("proxmox", "hypervisor", "proxmox"),
    ("xenserver", "hypervisor", "citrix"), ("hyper-v", "hypervisor", "microsoft"),
    # storage / NAS
    ("synology", "storage", "synology"), ("diskstation", "storage", "synology"),
    ("rackstation", "storage", "synology"), ("qnap", "storage", "qnap"),
    ("netapp", "storage", "netapp"), ("truenas", "storage", "truenas"),
    ("freenas", "storage", "truenas"), ("unraid", "storage", "unraid"),
    # cameras / NVR
    ("hikvision", "camera", "hikvision"), ("dahua", "camera", "dahua"),
    ("axis", "camera", "axis"), ("network camera", "camera", None),
    ("ip camera", "camera", None), ("nvr", "camera", None),
    # VoIP
    ("polycom", "voip", "polycom"), ("yealink", "voip", "yealink"),
    ("grandstream", "voip", "grandstream"), ("cisco ip phone", "voip", "cisco"),
    ("snom", "voip", "snom"), ("avaya", "voip", "avaya"),
    # UPS / power
    ("smart-ups", "ups", "apc"), ("apc web/snmp", "ups", "apc"),
    ("network ups", "ups", None), ("eaton", "ups", "eaton"),
    # web-admin interfaces (matched via HTTP server / title / auth realm)
    ("dd-wrt", "network_device", None), ("openwrt", "network_device", None),
    ("routeros", "network_device", "mikrotik"), ("pfsense", "network_device", "netgate"),
    ("opnsense", "network_device", None), ("tomato", "network_device", None),
    ("openmediavault", "storage", None), ("webcamxp", "camera", None),
]


def _match_device(text: str):
    """Return (device_type, vendor) for the first signature that matches, else
    (None, None). Precedence: printer -> other devices -> network gear."""
    t = (text or "").lower()
    for kw, vendor in _PRINTER_SIGNS:
        if kw in t:
            return ("printer", vendor)
    for kw, dtype, vendor in _OTHER_SIGNS:
        if kw in t:
            return (dtype, vendor)
    for kw, vendor in _NETDEV_SIGNS:
        if kw in t:
            return ("network_device", vendor)
    return (None, None)


# HTTP Server header -> OS hint. HTTP alone never decides device_type (a web
# server is a service, not a device kind) — but the header IS useful evidence.
_HTTP_OS_HINTS = [("microsoft-iis", "windows"), ("iis/", "windows")]

# Web servers that ship ONLY in embedded / IoT / appliance firmware — never on a
# general-purpose workstation or server. Their presence proves "this is not a PC"
# but NOT which kind of device, so it yields a modest-confidence generic
# 'appliance' with the banner kept as the product for a human to refine (camera /
# router / IoT). Deliberately excludes nginx/apache/lighttpd (real servers too).
_EMBEDDED_WEB_SIGNS = (
    "goahead", "boa/", "boa server", "thttpd", "mini_httpd", "mini-httpd",
    "uc-httpd", "router webserver", "rompager", "allegro-software", "lwip",
)


def classify(open_ports: List[int], fp: Dict[str, Any]) -> Dict[str, Any]:
    """Decide device_type / os_guess from FINGERPRINTS first, ports last.

    Returns, alongside the type: ``product`` (the concrete identity string),
    ``confidence`` (0-1) and ``evidence`` (the signals that drove it) — so a GRC
    reviewer can see *why* an asset was classified. Guiding rule: a port is
    evidence of a SERVICE; a fingerprint is evidence of a DEVICE. So HTTP/SSH
    ports alone give only a low-confidence guess, never a confident device type.
    """
    sd = (fp.get("snmp_sysdescr") or "").lower()
    http = " ".join(x for x in (fp.get("http_server"), fp.get("http_title"),
                                fp.get("http_auth")) if x).lower()
    ssh = (fp.get("ssh_banner") or "").lower()
    udp = fp.get("udp_services") or []
    op = set(open_ports or [])
    product = _best_product(fp)

    def _r(device_type, vendor, os_guess, confidence, evidence, product_override=None):
        # product_override lets a rule name the service it proved (e.g. a listening
        # 5432 -> "postgres") when no banner/HTTP product string was found.
        return {"device_type": device_type, "vendor": vendor, "os_guess": os_guess,
                "product": product or product_override, "confidence": round(confidence, 2),
                "evidence": evidence, "signal": evidence[0] if evidence else None}

    # 1) Device signature from SNMP sysDescr (strongest), then the HTTP header —
    #    printer / network gear / hypervisor / storage / camera / VoIP / UPS.
    dt, vendor = _match_device(sd)
    if dt:
        return _r(dt, vendor, None, 0.95, ["snmp_sysdescr"])
    if "windows" in sd:
        return _r("host", None, "windows", 0.9, ["snmp_sysdescr"])
    if "linux" in sd:
        return _r("host", None, "linux", 0.9, ["snmp_sysdescr"])
    dt, vendor = _match_device(http)
    if dt:
        ev = [k for k in ("http_server", "http_title", "http_auth") if fp.get(k)]
        return _r(dt, vendor, None, 0.75, ev or ["http"])

    # 2) SSH banner can name a network OS / device (Cisco/Juniper over SSH, etc.)
    dt, vendor = _match_device(ssh)
    if dt:
        return _r(dt, vendor, None, 0.9, ["ssh_banner"])

    # 4) HTTP Server header OS hint (e.g. IIS -> Windows). Header as evidence —
    #    HTTP is not itself a device type.
    for kw, os_ in _HTTP_OS_HINTS:
        if kw in http:
            return _r("host", None, os_, 0.6, ["http_server"])

    # 5) Windows-SPECIFIC service ports. WinRM (5985/5986) is a definitive
    #    Windows signal; RDP (3389) is a strong one. SMB (445) is NOT — macOS
    #    and Samba answer 445 (and NetBIOS), so it means "an SMB host", not
    #    "Windows".
    if op & {5985, 5986}:
        return _r("host", None, "windows", 0.85, ["port:winrm"])
    if 3389 in op:
        return _r("host", None, "windows", 0.7, ["port:rdp"])

    # 5b) IDENTITY ports — what a device IS when it takes no host login. Placed
    #     AFTER the definitive Windows signals (a Windows print server is a host,
    #     not a printer) but BEFORE the generic SMB/SSH host fallbacks, so a
    #     printer/camera/phone that also shares SMB keeps its real type.
    if op & {9100, 515}:               # JetDirect / LPD — printer-specific
        return _r("printer", None, None, 0.8, ["port:jetdirect" if 9100 in op else "port:lpd"])
    if 554 in op:                       # RTSP — IP camera / NVR
        return _r("camera", None, None, 0.7, ["port:rtsp"])
    if 5060 in op or "sip" in udp:      # SIP — VoIP phone / PBX
        return _r("voip", None, None, 0.7, ["port:sip"])
    if 631 in op and not (op & {5985, 5986, 3389, 22}):  # IPP w/o a host login -> printer (CUPS runs on hosts too)
        return _r("printer", None, None, 0.6, ["port:ipp"])

    # 5b) SERVICE ports — a listening database / directory / cluster API is a
    #     strong statement about what the box IS. Ranked BEFORE the generic
    #     SMB/SSH host fallbacks so a Postgres server reads "PostgreSQL database"
    #     instead of a nameless "host", and an otherwise-silent box that only
    #     serves Mongo/Redis stops showing as "Unknown". The port proves a service
    #     is listening — it does not prove the version, so confidence stays honest.
    for _port, _dtype, _label in (
        (5432, "database", "postgres"), (3306, "database", "mysql"),
        (1433, "database", "mssql"),    (1521, "database", "oracle"),
        (27017, "database", "mongodb"), (6379, "database", "redis"),
        (9200, "database", "elasticsearch"),
        (6443, "cluster", "kubernetes"),
        (636, "directory", "ldaps"),    (389, "directory", "ldap"),
    ):
        if _port in op:
            return _r(_dtype, None, None, 0.7, [f"port:{_label}"], product_override=_label)

    # 6) SSH: take the OS from the banner when it reveals one; a bare SSH host is
    #    OS-unknown (SSH runs on Linux, macOS, BSD, network gear…).
    if 22 in op:
        if any(k in ssh for k in ("ubuntu", "debian", "raspbian", "centos", "fedora", "red hat", "linux")):
            return _r("host", None, "linux", 0.75, ["ssh_banner"])
        if "windows" in ssh:
            return _r("host", None, "windows", 0.75, ["ssh_banner"])
        return _r("host", None, None, 0.5, ["port:ssh"])

    # 7) SMB (445) or NetBIOS (139) with no Windows-specific signal -> an SMB
    #    host of UNKNOWN OS (could be Windows, macOS or Samba). Do NOT claim
    #    Windows from the port alone — but the hostname often makes it clear
    #    (DESKTOP-… -> Windows), which the naming step applies on top of this.
    if op & {445, 139}:
        return _r("host", None, None, 0.5, ["port:smb" if 445 in op else "port:netbios"])

    # 7) SNMP answered but sysDescr unreadable/unknown vendor -> managed device.
    if "snmp" in udp:
        return _r("network_device", None, None, 0.6, ["snmp"])

    # 8) DNS resolver.
    if "dns" in udp:
        return _r("dns_server", None, None, 0.7, ["dns"])

    # 9) Embedded-firmware web server (GoAhead / Boa / RomPager / …). These run
    #    ONLY on appliances/IoT, so this proves "not a PC" — but not which kind.
    #    Generic 'appliance' at modest confidence; the banner (product) says more.
    if any(sig in http for sig in _EMBEDDED_WEB_SIGNS):
        return _r("appliance", None, None, 0.5, ["http_server:embedded"])

    # 10) Only a web port answered and nothing identifies it. HTTP is a service on
    #    almost anything (host, router, printer, NAS, IoT), so we DO NOT call it
    #    an 'appliance' — it stays UNKNOWN at low confidence, with the http
    #    evidence recorded for a human to resolve.
    if op & {80, 443, 8080, 8443}:
        return _r("unknown", None, None, 0.3, ["port:http"])
    # Telnet with nothing else — legacy managed gear (switch / old router / IoT).
    if 23 in op:
        return _r("network_device", None, None, 0.45, ["port:telnet"])

    return _r("unknown", None, None, 0.1, [])


def fingerprint_host(ip: str, open_ports: List[int], timeout_s: float = 1.0,
                     communities: Optional[List[bytes]] = None) -> Dict[str, Any]:
    """Protocol-aware fingerprint of one host. ALWAYS probes SNMP (UDP/161) and
    DNS (UDP/53) — that's how SNMP/DNS-only devices with no open TCP port get
    seen at all — then grabs SSH/HTTP banners for hosts whose TCP ports are open.
    ``communities`` overrides the SNMP read communities (per-campaign credential);
    None falls back to the env default. Returns evidence merged with a
    classification. Never raises."""
    fp: Dict[str, Any] = {
        "udp_services": [], "snmp_sysdescr": None, "dns": None,
        "http_server": None, "http_title": None, "http_auth": None,
        "ssh_banner": None,
    }
    op = set(open_ports or [])

    sd = snmp_sysdescr(ip, timeout_s, communities=communities)
    if sd is not None:
        fp["udp_services"].append("snmp")
        fp["snmp_sysdescr"] = sd

    dns = dns_probe(ip, timeout_s)
    if dns is not None:
        fp["udp_services"].append("dns")
        fp["dns"] = dns

    if 22 in op:
        fp["ssh_banner"] = ssh_banner(ip, timeout_s)
    for _hp, _tls in ((80, False), (443, True), (8080, False), (8443, True)):
        if _hp in op and not fp.get("http_server") and not fp.get("http_title"):
            srv, title, auth = http_probe(ip, _hp, timeout_s, tls=_tls)
            if srv:
                fp["http_server"] = srv
            if title:
                fp["http_title"] = title
            if auth:
                fp["http_auth"] = auth

    fp.update(classify(list(op), fp))
    return fp


def noop_fingerprint(ip: str, open_ports: List[int], timeout_s: float = 1.0) -> Dict[str, Any]:
    """Default for the low-level sweep so unit tests (and any caller that doesn't
    opt in) do ZERO network fingerprinting. Production callers pass
    ``fingerprint_host`` explicitly."""
    return {"udp_services": []}
