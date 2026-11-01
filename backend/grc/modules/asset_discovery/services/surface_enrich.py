"""Credential-free ("surface") enrichment for discovery — bucket B.

With NO login, these probes pull identity + service detail that the credentialed
WinRM/WMI/SSH path normally provides. They do not log in to the host — they read
what the OS/services expose before authentication:

  * SMB (445)       — computer name, domain, OS version, signing (impacket NEGOTIATE, no creds)
  * service+version — banner grab + version parse on the open ports already found
  * TLS cert        — CN / SANs / issuer / expiry on any TLS port
  * SNMP HOST-RES   — installed software + uptime via HOST-RESOURCES MIB (community only)

Every probe is best-effort and wrapped so a failure yields {} and NEVER breaks the
sweep. Called from the executor after fingerprint_host; the result merges into the
host's fingerprint and persists under platform_properties['surface_scan'], tagged
provenance='surface' so the UI shows it as credential-free.

Dependency note: fingerprint.py is intentionally dependency-free. This module may
use impacket (SMB) — already a backend dependency — and reuses fingerprint.py's raw
SNMP/UDP primitives for the HOST-RESOURCES walk, so the SNMP path stays library-free.
"""
from __future__ import annotations

import re
import socket
import ssl
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional


# ─────────────────────────── SMB identity (445) ───────────────────────────
def smb_identity(ip: str, timeout: float = 3.0) -> Dict[str, Any]:
    """Unauthenticated SMB negotiate → the host's own identity. Creating an
    SMBConnection performs the negotiate only (no login), and the server hands
    back its name/domain/OS in that exchange. Returns {} on any failure."""
    try:
        from impacket.smbconnection import SMBConnection
    except Exception:
        return {}
    conn = None
    try:
        conn = SMBConnection(ip, ip, sess_port=445, timeout=int(max(1, timeout)))
    except Exception:
        return {}
    out: Dict[str, Any] = {}
    try:
        for key, fn in (("computer_name", conn.getServerName),
                        ("domain", conn.getServerDNSDomainName),
                        ("netbios_domain", conn.getServerDomain),
                        ("os", conn.getServerOS)):
            try:
                v = fn()
                if v:
                    out[key] = str(v).strip()
            except Exception:
                pass
        for key, fn in (("signing_required", conn.isSigningRequired),
                        ("ntlmv2", conn.doesSupportNTLMv2)):
            try:
                out[key] = bool(fn())
            except Exception:
                pass
    finally:
        try:
            conn.close()
        except Exception:
            pass
    return {k: v for k, v in out.items() if v not in (None, "")}


# ─────────────────────────── TLS cert (any TLS port) ───────────────────────────
_TLS_PORTS = (443, 8443, 9443, 636, 3389, 5986, 993, 995, 465, 990, 5061)


def tls_cert(ip: str, port: int, timeout: float = 3.0) -> Dict[str, Any]:
    """The X.509 cert a TLS service presents to anyone — CN / SANs / issuer /
    expiry. No login, no validation (self-signed internal certs are the norm on
    an internal sweep), so we read the DER form: getpeercert() returns {} under
    an unverified context. Returns {} if the port isn't TLS or the handshake
    fails."""
    try:
        ctx = ssl._create_unverified_context()
        with socket.create_connection((ip, port), timeout=timeout) as raw:
            with ctx.wrap_socket(raw, server_hostname=str(ip)) as s:
                der = s.getpeercert(binary_form=True)
    except Exception:
        return {}
    return _parse_cert(der, port)


def _parse_cert(der: Optional[bytes], port: int) -> Dict[str, Any]:
    if not der:
        return {}
    try:
        from cryptography import x509
        from cryptography.x509.oid import ExtensionOID, NameOID
    except Exception:
        return {}
    try:
        cert = x509.load_der_x509_certificate(der)
    except Exception:
        return {}

    def _cn(name) -> Optional[str]:
        try:
            a = name.get_attributes_for_oid(NameOID.COMMON_NAME)
            if a:
                return a[0].value
            o = name.get_attributes_for_oid(NameOID.ORGANIZATION_NAME)
            return o[0].value if o else None
        except Exception:
            return None

    sans: List[str] = []
    try:
        ext = cert.extensions.get_extension_for_oid(ExtensionOID.SUBJECT_ALTERNATIVE_NAME)
        sans = list(ext.value.get_values_for_type(x509.DNSName))
    except Exception:
        pass
    try:
        exp = cert.not_valid_after_utc
    except Exception:
        exp = cert.not_valid_after.replace(tzinfo=timezone.utc)
    days = (exp - datetime.now(timezone.utc)).days
    out = {
        "port": port,
        "subject_cn": _cn(cert.subject),
        "issuer": _cn(cert.issuer),
        "sans": sans[:12],
        "not_after": exp.strftime("%b %d %Y"),
        "days_to_expiry": days,
    }
    return {k: v for k, v in out.items() if v not in (None, "", [])}


# ─────────────────────────── service + version ───────────────────────────
_PORT_SVC = {
    21: "ftp", 22: "ssh", 23: "telnet", 25: "smtp", 110: "pop3", 143: "imap",
    389: "ldap", 445: "smb", 587: "smtp", 1433: "mssql", 3306: "mysql",
    3389: "rdp", 5432: "postgresql", 5900: "vnc", 6379: "redis",
    9200: "elasticsearch", 11211: "memcached", 27017: "mongodb",
}
_HTTP_PORTS = {80, 443, 8080, 8443, 8000, 8008, 9443, 9000}

# Greeting-on-connect services send their banner the moment you connect.
_GREET_PORTS = {21, 22, 23, 25, 110, 143, 587, 5900}

# product/version extracted from a greeting banner.
_BANNER_RE = [
    re.compile(r"SSH-[\d.]+-(?P<product>[A-Za-z0-9_.+-]+?)[_ ]?(?P<version>\d[\w.]*)"),
    re.compile(r"\bvsftpd\s+(?P<version>[\d.]+)", re.I),
    re.compile(r"\bProFTPD\s+(?P<version>[\d.]+)", re.I),
    re.compile(r"\b(?P<product>Postfix|Exim|Sendmail|Microsoft ESMTP)\b.*?(?P<version>[\d.]+)?", re.I),
    re.compile(r"RFB\s+(?P<version>\d+\.\d+)"),
]


def _grab(ip: str, port: int, timeout: float, send: bytes = b"") -> bytes:
    try:
        with socket.create_connection((ip, port), timeout=timeout) as s:
            s.settimeout(timeout)
            if send:
                s.sendall(send)
            return s.recv(512)
    except Exception:
        return b""


def _mysql_version(raw: bytes) -> Optional[str]:
    # MySQL/MariaDB handshake: 4-byte header, 1-byte protocol, then a NUL-terminated
    # server-version string.
    try:
        if len(raw) < 6:
            return None
        body = raw[5:]
        end = body.index(b"\x00")
        v = body[:end].decode("latin-1", "replace").strip()
        return v or None
    except Exception:
        return None


def service_versions(ip: str, open_ports: List[int], timeout: float = 1.5,
                     http_server=None) -> List[Dict[str, Any]]:
    """For each open port, the service + a version string where the service
    volunteers one (banner / handshake). Credential-free. `http_server` is the
    fingerprint.http_server fn, injected to reuse its Server-header read."""
    svcs: List[Dict[str, Any]] = []
    for port in sorted(set(open_ports or []))[:40]:
        svc = _PORT_SVC.get(port) or ("http" if port in _HTTP_PORTS else None)
        entry: Dict[str, Any] = {"port": port}
        if svc:
            entry["service"] = svc
        banner = b""
        if port in _HTTP_PORTS and http_server is not None:
            try:
                hdr = http_server(ip, port, timeout, tls=(port in _TLS_PORTS))
                if hdr:
                    entry["service"] = "http"
                    entry["product"] = str(hdr)[:80]
            except Exception:
                pass
        elif port == 3306:
            banner = _grab(ip, port, timeout)
            v = _mysql_version(banner)
            if v:
                entry["product"], entry["version"] = "mysql", v
        elif port in _GREET_PORTS:
            banner = _grab(ip, port, timeout)
        if banner:
            text = banner.decode("latin-1", "replace").strip()
            if text and "banner" not in entry:
                entry["banner"] = text[:120]
            for rx in _BANNER_RE:
                m = rx.search(text)
                if m:
                    gd = m.groupdict()
                    if gd.get("product") and "product" not in entry:
                        entry["product"] = gd["product"]
                    if gd.get("version") and "version" not in entry:
                        entry["version"] = gd["version"]
                    break
        if len(entry) > 1:  # more than just {port}
            svcs.append(entry)
    return svcs


# ─────────────────────────── SNMP HOST-RESOURCES ───────────────────────────
# Reuse fingerprint.py's raw SNMP/UDP primitives so this stays library-free.
_HR_SW_NAME = "1.3.6.1.2.1.25.6.3.1.2"   # hrSWInstalledName
_HR_UPTIME = "1.3.6.1.2.1.25.1.1.0"      # hrSystemUptime


def _oid_to_bytes(oid: str) -> bytes:
    parts = [int(x) for x in oid.split(".")]
    first = 40 * parts[0] + parts[1]
    body = bytes([first])
    for n in parts[2:]:
        if n < 128:
            body += bytes([n])
        else:
            chunks = []
            while n:
                chunks.insert(0, n & 0x7F)
                n >>= 7
            for i in range(len(chunks) - 1):
                chunks[i] |= 0x80
            body += bytes(chunks)
    return body


def snmp_host_resources(ip: str, timeout: float = 1.0, max_items: int = 60) -> Dict[str, Any]:
    """Installed software via the HOST-RESOURCES MIB — a credential-free software
    inventory on SNMP hosts that expose it (needs only the community string, not
    a login). Walks hrSWInstalledName with GETNEXT. Returns {} if no community
    answers or the MIB isn't served."""
    try:
        from . import fingerprint as fp
    except Exception:
        return {}
    communities = fp._snmp_communities()
    software: List[str] = []
    base = _HR_SW_NAME
    for community in communities:
        cur = base
        software = []
        for _ in range(max_items):
            pkt = _build_snmp_getnext(community, cur)
            data = fp._udp_roundtrip(ip, fp.SNMP_PORT, pkt, timeout)
            if not data:
                break
            oid, val = _parse_snmp_varbind(data)
            if not oid or not oid.startswith(base + "."):
                break  # walked off the hrSWInstalledName subtree
            if val:
                software.append(val)
            cur = oid
        if software:
            break  # this community worked
    if not software:
        return {}
    # de-dup preserving order
    seen: set = set()
    uniq = [s for s in software if not (s in seen or seen.add(s))]
    return {"installed_software": uniq[:max_items], "software_count": len(uniq)}


def _build_snmp_getnext(community: bytes, oid: str) -> bytes:
    from . import fingerprint as fp
    version = fp._tlv(0x02, b"\x01")                 # SNMPv2c
    comm = fp._tlv(0x04, community)
    name = fp._tlv(0x06, _oid_to_bytes(oid))
    null = fp._tlv(0x05, b"")
    varbind = fp._tlv(0x30, name + null)
    varbinds = fp._tlv(0x30, varbind)
    pdu = fp._tlv(0xA1,                               # GETNEXT PDU
                  fp._tlv(0x02, fp._ber_int(0x1A2B3C4E)) +  # request-id (INTEGER)
                  fp._tlv(0x02, b"\x00") +             # error-status
                  fp._tlv(0x02, b"\x00") + varbinds)   # error-index + varbinds
    return fp._tlv(0x30, version + comm + pdu)


def _parse_snmp_varbind(data: bytes):
    """Pull the first varbind's (oid, string-value) out of a GETNEXT response.
    Minimal: good enough to walk hrSWInstalledName (OCTET STRING values)."""
    from . import fingerprint as fp
    try:
        # SEQUENCE > (version, community, GETRESPONSE PDU > (ids, errs, varbinds))
        _, seq, _ = fp._read_tlv(data, 0)
        i = 0
        # version
        _, _, i = fp._read_tlv(seq, i)
        # community
        _, _, i = fp._read_tlv(seq, i)
        # PDU (0xA2)
        _, pdu, _ = fp._read_tlv(seq, i)
        j = 0
        for _ in range(3):  # request-id, error-status, error-index
            _, _, j = fp._read_tlv(pdu, j)
        _, vbs, _ = fp._read_tlv(pdu, j)        # varbind list
        _, vb, _ = fp._read_tlv(vbs, 0)         # first varbind
        k = 0
        toid, oid_bytes, k = fp._read_tlv(vb, k)
        tval, val_bytes, _ = fp._read_tlv(vb, k)
        oid = _bytes_to_oid(oid_bytes)
        val = val_bytes.decode("latin-1", "replace").strip() if tval == 0x04 else None
        return oid, (val or None)
    except Exception:
        return None, None


def _bytes_to_oid(b: bytes) -> str:
    if not b:
        return ""
    first = b[0]
    out = [str(first // 40), str(first % 40)]
    n = 0
    for byte in b[1:]:
        n = (n << 7) | (byte & 0x7F)
        if not (byte & 0x80):
            out.append(str(n))
            n = 0
    return ".".join(out)


# ─────────────────────────── orchestrator ───────────────────────────
def enrich_surface(ip: str, open_ports: List[int], timeout: float = 1.5,
                   http_server=None) -> Dict[str, Any]:
    """Run every credential-free probe that the open ports justify, and return a
    single surface-scan block (provenance='surface'). Only non-empty probes are
    included. Never raises — the sweep must not break on a probe failure."""
    ports = set(open_ports or [])
    out: Dict[str, Any] = {"provenance": "surface"}
    if http_server is None:
        try:
            from . import fingerprint as fp
            http_server = fp.http_server
        except Exception:
            http_server = None
    try:
        svcs = service_versions(ip, open_ports, timeout, http_server=http_server)
        if svcs:
            out["services"] = svcs
    except Exception:
        pass
    if 445 in ports:
        try:
            smb = smb_identity(ip, max(timeout, 3.0))
            if smb:
                out["smb"] = smb
        except Exception:
            pass
    tls_ports = [p for p in ports if p in _TLS_PORTS]
    certs = []
    for p in sorted(tls_ports)[:4]:
        try:
            c = tls_cert(ip, p, max(timeout, 3.0))
            if c:
                certs.append(c)
        except Exception:
            pass
    if certs:
        out["tls_certs"] = certs
    if 161 in ports or not ports:  # SNMP is UDP — not in the TCP open_ports list
        try:
            hr = snmp_host_resources(ip, timeout)
            if hr:
                out["snmp_host_resources"] = hr
        except Exception:
            pass
    return out if len(out) > 1 else {}


# ─────────────────────────── self-check ───────────────────────────
if __name__ == "__main__":
    # Parsing logic is verified offline (no network), so the shaping is correct
    # even where a live target (esp. SMB — needs a Windows host) isn't reachable.
    # Build a real self-signed cert → DER → parse it, a true round-trip.
    import datetime as _dt
    from cryptography import x509
    from cryptography.x509.oid import NameOID
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import rsa
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    subj = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "host.example.com")])
    issr = x509.Name([x509.NameAttribute(NameOID.ORGANIZATION_NAME, "Acme CA")])
    now = _dt.datetime.now(_dt.timezone.utc)
    crt = (x509.CertificateBuilder().subject_name(subj).issuer_name(issr)
           .public_key(key.public_key()).serial_number(x509.random_serial_number())
           .not_valid_before(now - _dt.timedelta(days=1))
           .not_valid_after(now + _dt.timedelta(days=90))
           .add_extension(x509.SubjectAlternativeName(
               [x509.DNSName("host.example.com"), x509.DNSName("www.example.com")]), False)
           .sign(key, hashes.SHA256()))
    der = crt.public_bytes(serialization.Encoding.DER)
    c = _parse_cert(der, 443)
    assert c["subject_cn"] == "host.example.com", c
    assert c["issuer"] == "Acme CA", c
    assert "www.example.com" in c["sans"] and 80 <= c["days_to_expiry"] <= 90, c

    assert _parse_cert(None, 443) == {}
    assert _bytes_to_oid(_oid_to_bytes(_HR_SW_NAME)) == _HR_SW_NAME

    v = _mysql_version(b"\x4a\x00\x00\x00\x0a" + b"8.0.34" + b"\x00rest")
    assert v == "8.0.34", v

    # service_versions shaping over a banner (offline: feed a fake grabber result
    # by parsing a known SSH banner through the regex path).
    m = _BANNER_RE[0].search("SSH-2.0-OpenSSH_8.9p1 Ubuntu")
    assert m and m.group("product") == "OpenSSH" and m.group("version").startswith("8.9"), m

    assert enrich_surface("203.0.113.1", []) == {}  # no ports, nothing reachable → empty
    print("surface_enrich self-check PASSED")
