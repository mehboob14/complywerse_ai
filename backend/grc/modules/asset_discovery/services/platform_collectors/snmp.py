"""SNMPv2c deep-inventory collector — dependency-free (no pysnmp).

A discovered device that speaks SNMP (a router / switch / printer / UPS / NAS
that takes no host login) is inventoried here over read-only SNMPv2c. Same
contract as cisco.py:

  * Flat identity scalars at the top (hostname, vendor, model, os, uptime …)
    from the SNMPv2-MIB system group.
  * Deep sections wrapped by `collect_section` (interfaces = a GETNEXT walk of
    ifTable), so a denied/empty table degrades to a status section and never
    aborts the collect.
  * READ-ONLY. GET + GETNEXT only — never SET.
  * Raises RuntimeError on no-response so the connect records a clean failure.

The BER/DER + UDP primitives are REUSED from fingerprint.py (the discovery sweep
already hand-builds an SNMPv2c GET there) — ONE implementation, imported, not
copy-pasted. This module adds only what fingerprint lacks: arbitrary-OID encode/
decode, a generalized GET/GETNEXT PDU builder, typed value decoding, and the
ifTable walk.
"""
from __future__ import annotations

from typing import Any, Callable, Dict, List, Optional, Tuple

from . import register, collect_section
# Reuse the sweep's hand-built SNMPv2c primitives — single implementation.
from ..fingerprint import (  # noqa: F401
    _ber_int, _tlv, _read_tlv, _udp_roundtrip, SNMP_PORT, _match_device,
)

_CAP = 256                 # per-table row cap (ifTable can be large)
_REQ_ID = 0x1A2B3C4D       # fixed request-id — fresh socket + immediate read per request

# SNMPv2-MIB system group (each .0 = the single scalar instance).
_SYS = {
    "descr":      "1.3.6.1.2.1.1.1.0",
    "object_id":  "1.3.6.1.2.1.1.2.0",
    "uptime":     "1.3.6.1.2.1.1.3.0",
    "contact":    "1.3.6.1.2.1.1.4.0",
    "name":       "1.3.6.1.2.1.1.5.0",
    "location":   "1.3.6.1.2.1.1.6.0",
    "if_number":  "1.3.6.1.2.1.2.1.0",
}
_IFTABLE = "1.3.6.1.2.1.2.2.1"      # ifTable entry; columns: ifDescr .2, ifType .3, ifOperStatus .8

# GET vs GETNEXT PDU tags.
_GET, _GETNEXT = 0xA0, 0xA1
# Varbind value exception tags (SNMPv2c) — "no value here".
_NOSUCH = (0x80, 0x81, 0x82)        # noSuchObject / noSuchInstance / endOfMibView

_IF_OPER = {1: "up", 2: "down", 3: "testing", 4: "unknown", 5: "dormant",
            6: "notPresent", 7: "lowerLayerDown"}
_IF_TYPE = {1: "other", 6: "ethernet", 24: "loopback", 53: "propVirtual",
            131: "tunnel", 135: "l2vlan", 136: "l3ipvlan", 161: "lag"}


# ── BER OID codec (the only piece fingerprint hardcodes; generalized here) ────
def _b128(n: int) -> bytes:
    """One OID sub-identifier, base-128 with high-bit continuation."""
    if n == 0:
        return b"\x00"
    out = bytearray([n & 0x7F])
    n >>= 7
    while n:
        out.append((n & 0x7F) | 0x80)
        n >>= 7
    return bytes(reversed(out))


def _encode_oid(oid: str) -> bytes:
    parts = [int(x) for x in oid.strip(".").split(".")]
    if len(parts) < 2:
        raise ValueError(f"bad OID {oid!r}")
    body = _b128(40 * parts[0] + parts[1])
    for arc in parts[2:]:
        body += _b128(arc)
    return body


def _decode_oid(data: bytes) -> str:
    if not data:
        return ""
    fb = data[0]
    vals: List[int] = [0, fb] if fb < 40 else ([1, fb - 40] if fb < 80 else [2, fb - 80])
    n = 0
    for b in data[1:]:
        n = (n << 7) | (b & 0x7F)
        if not (b & 0x80):
            vals.append(n)
            n = 0
    return ".".join(str(v) for v in vals)


def _decode_value(tag: int, val: bytes) -> Any:
    """Decode a varbind value by BER/SNMP tag to a Python scalar (or None)."""
    if tag in _NOSUCH or tag == 0x05:          # exception marker / NULL
        return None
    if tag == 0x02:                            # INTEGER (signed)
        return int.from_bytes(val, "big", signed=True) if val else 0
    if tag in (0x41, 0x42, 0x43, 0x46):        # Counter32 / Gauge32 / TimeTicks / Counter64
        return int.from_bytes(val, "big", signed=False) if val else 0
    if tag == 0x40 and len(val) == 4:          # IpAddress
        return ".".join(str(b) for b in val)
    if tag == 0x06:                            # OBJECT IDENTIFIER
        return _decode_oid(val)
    return val.decode("utf-8", "replace").strip() or None   # OCTET STRING / other


# ── one SNMPv2c request (GET or GETNEXT) over UDP ─────────────────────────────
def _build_pdu(oid: bytes, community: bytes, pdu_tag: int) -> bytes:
    """A single-varbind SNMPv2c request. Generalizes fingerprint._build_snmp_get
    (which hardcodes sysDescr + GET) to any OID and GET/GETNEXT."""
    version = _tlv(0x02, b"\x01")                                  # INTEGER 1 -> v2c
    comm = _tlv(0x04, community)
    varbind = _tlv(0x30, _tlv(0x06, oid) + _tlv(0x05, b""))        # OID + NULL value
    pdu = _tlv(pdu_tag,
               _tlv(0x02, _ber_int(_REQ_ID))
               + _tlv(0x02, b"\x00")                               # error-status
               + _tlv(0x02, b"\x00")                               # error-index
               + _tlv(0x30, varbind))
    return _tlv(0x30, version + comm + pdu)


def _request(host: str, port: int, community: bytes, oid: str, timeout: float,
             pdu_tag: int) -> Optional[Tuple[str, int, bytes]]:
    """Send one GET/GETNEXT and return (returned_oid, value_tag, value_bytes),
    or None on no-reply / PDU error. Never raises."""
    data = _udp_roundtrip(host, port, _build_pdu(_encode_oid(oid), community, pdu_tag), timeout)
    if data is None:
        return None
    try:
        _, seq, _ = _read_tlv(data, 0)          # outer SEQUENCE
        i = 0
        _, _v, i = _read_tlv(seq, i)            # version
        _, _c, i = _read_tlv(seq, i)            # community
        _, pdu, i = _read_tlv(seq, i)           # response PDU
        j = 0
        _, _rid, j = _read_tlv(pdu, j)
        _, errst, j = _read_tlv(pdu, j)         # error-status
        _, _eidx, j = _read_tlv(pdu, j)
        _, vbs, j = _read_tlv(pdu, j)           # varbind list
        if errst and errst[0] != 0:             # PDU-level error (e.g. authz / noSuchName)
            return None
        _, vb, _ = _read_tlv(vbs, 0)            # first varbind
        k = 0
        _, oid_ret, k = _read_tlv(vb, k)        # OID
        vtag, vval, k = _read_tlv(vb, k)        # value
        return _decode_oid(oid_ret), vtag, vval
    except Exception:  # noqa: BLE001 — a malformed reply is a non-answer
        return None


def _walk_column(host: str, port: int, community: bytes, base: str,
                 timeout: float, cap: int = _CAP) -> Dict[str, Any]:
    """GETNEXT-walk one ifTable column. Returns {row_index: decoded_value}.
    Stops at the end of the column subtree, endOfMibView, or the cap."""
    out: Dict[str, Any] = {}
    cur = base
    prefix = base + "."
    for _ in range(cap):
        r = _request(host, port, community, cur, timeout, _GETNEXT)
        if r is None:
            break
        ret_oid, vtag, vval = r
        if not ret_oid.startswith(prefix) or vtag in _NOSUCH:
            break                               # left the column / end of view
        out[ret_oid[len(prefix):]] = _decode_value(vtag, vval)
        cur = ret_oid
    return out


def _interfaces(host: str, port: int, community: bytes, timeout: float) -> Dict[str, Any]:
    """ifTable → [{index, descr, type, oper_status}]. Best-effort: an empty walk
    (agent restricts ifTable) returns an empty, still-DISCOVERED table."""
    descr = _walk_column(host, port, community, _IFTABLE + ".2", timeout)
    itype = _walk_column(host, port, community, _IFTABLE + ".3", timeout)
    oper = _walk_column(host, port, community, _IFTABLE + ".8", timeout)
    idxs = sorted(set(descr) | set(itype) | set(oper),
                  key=lambda x: int(x) if x.isdigit() else 1 << 30)
    rows = [{
        "index": i,
        "descr": descr.get(i),
        "type": _IF_TYPE.get(itype.get(i), itype.get(i)),
        "oper_status": _IF_OPER.get(oper.get(i), oper.get(i)),
    } for i in idxs[:_CAP]]
    return {"items": rows, "count": len(idxs)}


def _fmt_uptime(ticks: Optional[int]) -> Optional[str]:
    """TimeTicks (hundredths of a second) → 'Xd Yh Zm'."""
    if not isinstance(ticks, int) or ticks < 0:
        return None
    s = ticks // 100
    d, s = divmod(s, 86400)
    h, s = divmod(s, 3600)
    m, _ = divmod(s, 60)
    return f"{d}d {h}h {m}m"


# ── the collector ─────────────────────────────────────────────────────────────
@register("snmp_v2c")
def collect_snmp(creds: Dict[str, Any]) -> Dict[str, Any]:
    """Deep-inventory a device over read-only SNMPv2c. Credential keys:
    snmp_host, snmp_port (default 161), snmp_community (default 'public')."""
    host = creds.get("snmp_host")
    if not host:
        raise RuntimeError("SNMP host is required")
    port = int(creds.get("snmp_port") or SNMP_PORT)
    community = creds.get("snmp_community") or "public"
    if isinstance(community, str):
        community = community.encode()
    timeout = float(creds.get("snmp_timeout") or 2.0)

    def _get(oid: str) -> Any:
        r = _request(host, port, community, oid, timeout, _GET)
        if r is None:
            return None
        _oid, vtag, vval = r
        return _decode_value(vtag, vval)

    # Reachability gate: probe the three most-answered scalars first. If NONE
    # reply, the agent is off, filtered, or the community is wrong — fail clean
    # (and cheap: don't fire the remaining GETs against a dead host).
    sys_descr = _get(_SYS["descr"])
    sys_name = _get(_SYS["name"])
    sys_oid = _get(_SYS["object_id"])
    if sys_descr is None and sys_name is None and sys_oid is None:
        raise RuntimeError("SNMP: no response — agent off or wrong community")

    uptime = _get(_SYS["uptime"])
    contact = _get(_SYS["contact"])
    location = _get(_SYS["location"])
    if_number = _get(_SYS["if_number"])

    descr_line = str(sys_descr).splitlines()[0].strip()[:255] if sys_descr else None
    _dtype, vendor = _match_device(str(sys_descr or ""))    # reuse fingerprint's signature table

    props: Dict[str, Any] = {
        "device_class": "network",
        "host": host,
        "port": port,
        "snmp_version": "v2c",
        "hostname": sys_name,
        "vendor": vendor,
        "model": descr_line,
        "os": descr_line,
        "description": str(sys_descr)[:1000] if sys_descr else None,
        "sys_name": sys_name,
        "sys_object_id": sys_oid,
        "sys_contact": contact,
        "sys_location": location,
        "uptime": _fmt_uptime(uptime),
        "uptime_ticks": uptime,
        "if_number": if_number,
    }
    # Deep section: ifTable walk, status-wrapped so a denied/empty table never aborts.
    props["interfaces"] = collect_section(
        lambda: _interfaces(host, port, community, timeout))
    return props


def _demo() -> None:
    """Self-check: BER OID codec + value decoding. No network. Run: python -m ...snmp"""
    # sysDescr.0 must encode to the exact bytes fingerprint.py hardcodes.
    assert _encode_oid("1.3.6.1.2.1.1.1.0") == bytes([0x2B, 6, 1, 2, 1, 1, 1, 0])
    assert _decode_oid(bytes([0x2B, 6, 1, 2, 1, 1, 1, 0])) == "1.3.6.1.2.1.1.1.0"
    # Multi-byte sub-identifiers (>127) must round-trip.
    for oid in ("1.3.6.1.4.1.9.1.516", "1.3.6.1.4.1.8072.3.2.10", "1.3.6.1.2.1.2.2.1.2.2790"):
        assert _decode_oid(_encode_oid(oid)) == oid, oid
    assert _decode_value(0x02, b"\x2a") == 42                         # INTEGER
    assert _decode_value(0x43, b"\x00\x00\x27\x10") == 10000          # TimeTicks
    assert _decode_value(0x04, b"router-1") == "router-1"             # OCTET STRING
    assert _decode_value(0x40, bytes([192, 168, 1, 1])) == "192.168.1.1"  # IpAddress
    assert _decode_value(0x06, bytes([0x2B, 6, 1])) == "1.3.6.1"      # OID value
    assert _decode_value(0x81, b"") is None                          # noSuchInstance
    assert _fmt_uptime(360000) == "0d 1h 0m"                          # 360000 ticks = 1h
    # A GET PDU parses back to our OID + a NULL value.
    pkt = _build_pdu(_encode_oid(_SYS["descr"]), b"public", _GET)
    _, seq, _ = _read_tlv(pkt, 0)
    assert seq[:1] == b"\x02"                                        # starts with version INTEGER
    print("snmp._demo OK")


if __name__ == "__main__":
    _demo()
