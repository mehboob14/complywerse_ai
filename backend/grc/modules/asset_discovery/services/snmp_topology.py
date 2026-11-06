"""Phase 2 — SNMP-measured L2 topology.

Reads the network gear itself to turn the inferred gateway-star into the real
tree. Two sources, both walked read-only over SNMPv2c, reusing the sweep's own
SNMP primitives (one implementation, imported — never re-hand-rolled):

  * LLDP (`lldpRemSysName`) + CDP (`cdpCacheDeviceId`/`cdpCacheAddress`) →
    the infrastructure spine: switch ↔ switch ↔ router ↔ AP, by the neighbour's
    own name / management IP.
  * Bridge FDB (`dot1dTpFdbAddress`/`dot1dTpFdbPort`) → endpoint → switch:
    which access port learned a host's MAC. A port that has learned many MACs
    is a trunk/uplink and is skipped, so only genuine edge ports attribute a
    host to a switch.

Collection is best-effort and NEVER raises — a switch that doesn't answer SNMP
just yields nothing and the caller falls back to the inferred star. The edge
CORRELATION (`correlate_edges`) is a pure function with a self-check, so the
part that decides the graph is tested even without a live switch.
"""
from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

# ── OIDs (numeric, so no MIB files needed) ───────────────────────────────────
_SYSNAME = "1.3.6.1.2.1.1.5.0"                       # sysName.0 — the community probe
_LLDP_REM_SYSNAME = "1.0.8802.1.1.2.1.4.1.1.9"       # lldpRemSysName
_CDP_DEVICE_ID = "1.3.6.1.4.1.9.9.23.1.2.1.1.6"      # cdpCacheDeviceId
_CDP_ADDRESS = "1.3.6.1.4.1.9.9.23.1.2.1.1.4"        # cdpCacheAddress (raw network address)
_FDB_ADDRESS = "1.3.6.1.2.1.17.4.3.1.1"              # dot1dTpFdbAddress (value = MAC)
_FDB_PORT = "1.3.6.1.2.1.17.4.3.1.2"                 # dot1dTpFdbPort (value = bridge port)

# A bridge port that has learned more than this many MACs is a trunk / uplink,
# not an access port, so we do NOT attribute its MACs to an endpoint on it.
# ponytail: a MAC-count heuristic — a hub or a tiny daisy-chain on one port could
# fool it. Upgrade path: cross it with dot1dBasePortIfIndex + the LLDP/CDP uplink
# port set. Kept simple because access ports overwhelmingly learn 1 MAC.
_UPLINK_MAC_THRESHOLD = 4

_GATEWAY_TYPES = frozenset({"network_device", "router", "switch", "firewall", "gateway"})
_METHOD_RANK = {"lldp": 0, "cdp": 0, "fdb": 1}       # spine beats FDB when both claim an edge


# ── value decoders ───────────────────────────────────────────────────────────
def _txt(raw: bytes) -> Optional[str]:
    s = raw.decode("utf-8", "replace").strip()
    return s or None


def _ipv4(raw: bytes) -> Optional[str]:
    return ".".join(str(b) for b in raw) if len(raw) == 4 else None


def _mac(raw: bytes) -> Optional[str]:
    return ":".join("%02x" % b for b in raw) if len(raw) == 6 else None


def _as_int(raw: bytes) -> Optional[int]:
    return int.from_bytes(raw, "big") if raw else None


def _norm_mac(mac: Optional[str]) -> Optional[str]:
    if not mac:
        return None
    h = "".join(c for c in mac.lower() if c in "0123456789abcdef")
    return ":".join(h[i:i + 2] for i in range(0, 12, 2)) if len(h) == 12 else None


# ── SNMP collection (best-effort; imports the sweep's own primitives) ─────────
def _walk(host: str, community: bytes, base: str, timeout: float, cap: int = 512):
    """Raw GETNEXT walk of one column → list of (index_suffix, tag, raw_bytes).
    Raw (not decoded) so a binary value like a CDP IP address survives."""
    from .platform_collectors.snmp import _request, _GETNEXT
    from .fingerprint import SNMP_PORT
    out = []
    cur, prefix = base, base + "."
    for _ in range(cap):
        r = _request(host, SNMP_PORT, community, cur, timeout, _GETNEXT)
        if r is None:
            break
        oid, tag, raw = r
        if not oid.startswith(prefix):
            break
        out.append((oid[len(prefix):], tag, raw))
        cur = oid
    return out


def collect_device_topology(host: str, communities: List[bytes], timeout: float = 1.5) -> Dict[str, Any]:
    """Walk one device's LLDP/CDP neighbours + bridge FDB. Returns
    {"neighbors": [{name, ip, source}], "fdb": [{mac, port}]} or {} when the
    device doesn't answer SNMP. Never raises."""
    try:
        from .platform_collectors.snmp import _request, _GET
        from .fingerprint import SNMP_PORT
        working: Optional[bytes] = None
        for c in communities:
            if _request(host, SNMP_PORT, c, _SYSNAME, timeout, _GET) is not None:
                working = c
                break
        if working is None:
            return {}

        neighbors: List[Dict[str, Any]] = []
        for _idx, _t, raw in _walk(host, working, _LLDP_REM_SYSNAME, timeout):
            nm = _txt(raw)
            if nm:
                neighbors.append({"name": nm, "ip": None, "source": "lldp"})
        dev = {i: _txt(raw) for i, _t, raw in _walk(host, working, _CDP_DEVICE_ID, timeout)}
        addr = {i: _ipv4(raw) for i, _t, raw in _walk(host, working, _CDP_ADDRESS, timeout)}
        for i, nm in dev.items():
            if nm:
                neighbors.append({"name": nm, "ip": addr.get(i), "source": "cdp"})

        ports = {i: _as_int(raw) for i, _t, raw in _walk(host, working, _FDB_PORT, timeout)}
        fdb: List[Dict[str, Any]] = []
        for i, _t, raw in _walk(host, working, _FDB_ADDRESS, timeout):
            m = _mac(raw)
            p = ports.get(i)
            if m and p is not None:
                fdb.append({"mac": m, "port": p})

        # dedup neighbours by (name, ip)
        seen = set()
        uniq = []
        for n in neighbors:
            k = (n["name"], n.get("ip"))
            if k not in seen:
                seen.add(k)
                uniq.append(n)
        return {"neighbors": uniq, "fdb": fdb}
    except Exception:
        logger.debug("collect_device_topology failed for %s", host, exc_info=True)
        return {}


# ── pure correlation (unit-tested) ───────────────────────────────────────────
def _is_gateway(a: Dict[str, Any]) -> bool:
    if a.get("type") in ("router", "firewall", "gateway"):
        return True
    ip = a.get("ip") or ""
    return ip.split(".")[-1] == "1" if "." in ip else False


def _last_octet(a: Dict[str, Any]) -> int:
    try:
        return int((a.get("ip") or "0.0.0.0").split(".")[-1])
    except ValueError:
        return 999


def _orient(a: Dict[str, Any], b: Dict[str, Any]) -> Tuple[Dict[str, Any], Dict[str, Any]]:
    """Return (child, parent) for an infra↔infra link. The router/gateway side is
    the parent; between two switches, the one closer to .1 (lower last octet) is
    treated as the more-core parent — a deterministic heuristic, not gospel."""
    ga, gb = _is_gateway(a), _is_gateway(b)
    if ga and not gb:
        return b, a
    if gb and not ga:
        return a, b
    la, lb = _last_octet(a), _last_octet(b)
    if la != lb:
        return (a, b) if la > lb else (b, a)
    return (a, b) if a["id"] > b["id"] else (b, a)


def correlate_edges(assets: List[Dict[str, Any]],
                    collected: Dict[int, Dict[str, Any]]) -> List[Tuple[int, int, str]]:
    """Given the topology assets and each infra device's collected tables, return
    measured (child_id, parent_id, method) edges. Pure — no I/O."""
    by_id = {a["id"]: a for a in assets}
    by_ip = {a["ip"]: a for a in assets if a.get("ip")}
    by_name = {a["name"].lower(): a for a in assets if a.get("name")}
    by_mac = {m: a for a in assets if (m := _norm_mac(a.get("mac")))}

    edges: Dict[Tuple[int, int], str] = {}

    def add(child: int, parent: int, method: str) -> None:
        if child == parent:
            return
        if (parent, child) in edges:          # keep the first orientation we chose
            return
        cur = edges.get((child, parent))
        if cur is None or _METHOD_RANK[method] < _METHOD_RANK[cur]:
            edges[(child, parent)] = method

    for did, data in collected.items():
        D = by_id.get(did)
        if not D:
            continue
        # spine: LLDP / CDP neighbours → the other infra device
        for n in data.get("neighbors", []):
            X = (by_ip.get(n["ip"]) if n.get("ip") else None) or by_name.get((n.get("name") or "").lower())
            if not X or X["id"] == did:
                continue
            child, parent = _orient(D, X)
            add(child["id"], parent["id"], n.get("source", "lldp"))
        # endpoints: FDB access ports → the host learned there
        cnt: Dict[int, int] = {}
        for f in data.get("fdb", []):
            cnt[f["port"]] = cnt.get(f["port"], 0) + 1
        for f in data.get("fdb", []):
            if cnt.get(f["port"], 0) > _UPLINK_MAC_THRESHOLD:
                continue                       # trunk / uplink port — not an endpoint
            A = by_mac.get(_norm_mac(f["mac"]))
            if not A or A["id"] == did or A.get("type") in _GATEWAY_TYPES:
                continue                       # infra links come from LLDP/CDP, not FDB
            add(A["id"], did, "fdb")

    return [(c, p, m) for (c, p), m in edges.items()]


if __name__ == "__main__":  # pragma: no cover — pure-correlation self-check, no SNMP
    assets = [
        {"id": 1, "ip": "10.0.0.1", "name": "gw", "mac": "aa:aa:aa:aa:aa:01", "type": "router"},
        {"id": 2, "ip": "10.0.0.2", "name": "sw-a", "mac": "aa:aa:aa:aa:aa:02", "type": "switch"},
        {"id": 3, "ip": "10.0.0.50", "name": "pc", "mac": "bb:bb:bb:bb:bb:50", "type": "host"},
        {"id": 4, "ip": "10.0.0.51", "name": "laptop", "mac": "bb:bb:bb:bb:bb:51", "type": "host"},
    ]
    collected = {
        2: {  # switch A sees the router (CDP) and learns pc/laptop on access ports
            "neighbors": [{"name": "gw", "ip": "10.0.0.1", "source": "cdp"}],
            "fdb": [
                {"mac": "bb:bb:bb:bb:bb:50", "port": 5},
                {"mac": "bb:bb:bb:bb:bb:51", "port": 6},
                # a trunk/uplink port with many MACs → every MAC on it is ignored
                *[{"mac": f"cc:00:00:00:00:0{i}", "port": 1} for i in range(1, 6)],
            ],
        },
    }
    got = {(c, p) for c, p, _ in correlate_edges(assets, collected)}
    assert got == {(2, 1), (3, 2), (4, 2)}, got
    # the router is the parent of the switch (gateway wins orientation)
    assert (2, 1, "cdp") in correlate_edges(assets, collected)
    # a MAC on the busy uplink port must NOT create an edge
    assert not any(c == 1 for c, _, _ in correlate_edges(assets, collected))
    # decoders
    assert _ipv4(bytes([10, 0, 0, 1])) == "10.0.0.1" and _ipv4(b"\x01\x02") is None
    assert _mac(bytes(range(6))) == "00:01:02:03:04:05"
    assert _norm_mac("AA-BB-CC-DD-EE-FF") == "aa:bb:cc:dd:ee:ff"
    print("snmp_topology self-check OK")
