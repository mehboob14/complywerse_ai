"""Network topology — built from what discovery actually found.

The map is sourced from DISCOVERY OBSERVATIONS, the same deduped device list the
Overview radar / Connect / Review queues read (`/discovery/discovered-devices`),
NOT from `grc_it_assets`. That matters: the resolver deliberately keeps a swept
device as an `unclaimed` observation until a human promotes it (resolver.py) — so
an asset-sourced map would show almost nothing. Sourcing from observations means
every device discovery finds appears on the map, and it stays in sync with the
rest of discovery automatically.

Two layers of edges, both computed on read (cheap) from data collected at scan
time:
  * inferred — the /24 gateway star (a device at .1/.254, or one fingerprinted as
    network gear, is the subnet's gateway; the rest hang off it).
  * measured — SNMP LLDP/CDP/FDB, correlated by `snmp_topology.correlate_edges`
    from the per-device SNMP walk that `collect_snmp_topology` stores on each
    infra device's observation at scan time.

`collect_snmp_topology` runs in the discovery pipeline (execute_run) and walks
the DISCOVERED network gear (observations), so switches get read even before
anyone promotes them. Best-effort throughout: a silent switch just keeps the
inferred star; nothing here is required for a run to succeed.

ponytail: /24 is assumed for subnet grouping (a sweep gives an address, not a
mask); FDB uplink detection is a MAC-count heuristic. Both are documented ceilings.
"""
from __future__ import annotations

import ipaddress
import logging
from typing import Any, Dict, List, Optional

from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

# device_type values (from the discovery fingerprint) that mean network gear that
# can be a gateway / can be walked over SNMP for neighbours.
_GATEWAY_TYPES = frozenset({"network_device", "router", "switch", "firewall", "gateway"})
_GATEWAY_SUFFIXES = (1, 254)          # conventional gateway host addresses, preferred order
_MAX_SNMP_DEVICES = 64                 # bound the per-run SNMP walks
# Observation resolutions that count as "a device discovery is showing" — the same
# set /discovery/discovered-devices lists, so the map matches that view exactly.
_VISIBLE = ("unclaimed", "created", "pending", "review", "merged")


def _private_ip(value: Optional[str]) -> "Optional[ipaddress.IPv4Address]":
    if not value:
        return None
    try:
        ip = ipaddress.ip_address(str(value).strip())
    except (ValueError, AttributeError):
        return None
    return ip if ip.version == 4 and ip.is_private else None


def _is_ip(value: str) -> bool:
    try:
        ipaddress.ip_address(value.strip())
        return True
    except (ValueError, AttributeError):
        return False


def _norm_mac(mac: Optional[str]) -> Optional[str]:
    if not mac:
        return None
    h = "".join(c for c in mac.lower() if c in "0123456789abcdef")
    return ":".join(h[i:i + 2] for i in range(0, 12, 2)) if len(h) == 12 else None


def _subnet24(ip: "ipaddress.IPv4Address") -> str:
    return str(ipaddress.ip_network(f"{ip}/24", strict=False))


def _last_octet(node: Dict[str, Any]) -> Optional[int]:
    ip = _private_ip(node.get("ip"))
    return int(ip) & 0xFF if ip is not None else None


def _pick_gateway_node(members: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """The subnet's gateway node, or None to leave it unlinked. Preference: a node
    at the conventional gateway address (.1, then .254), else one fingerprinted as
    network gear."""
    by_octet: Dict[int, Dict[str, Any]] = {}
    for n in members:
        oct_ = _last_octet(n)
        if oct_ is not None:
            by_octet.setdefault(oct_, n)
    for suf in _GATEWAY_SUFFIXES:
        if suf in by_octet:
            return by_octet[suf]
    for n in members:
        if n.get("type") in _GATEWAY_TYPES:
            return n
    return None


def _assemble_edges(nodes: List[Dict[str, Any]], collected: Dict[Any, Any]):
    """Build the edges, plus any synthetic subnet-anchor nodes. Returns
    (edges, synthetic_nodes). measured (SNMP) edges take precedence; every node
    SNMP did not place hangs off its subnet's anchor — the real gateway device if
    one was discovered, else a synthesized ``subnet`` node (negative id) so the
    hosts still cluster into their segment instead of floating as a flat row.
    Pure — no DB, no network."""
    edges: Dict[tuple, tuple] = {}      # (child,parent) -> (measured_bool, method)

    measured_children = set()
    if collected:
        from .snmp_topology import correlate_edges
        reprs = [{"id": n["id"], "ip": n["ip"], "name": n["name"],
                  "mac": n["mac"], "type": n["type"]} for n in nodes]
        for c, p, method in correlate_edges(reprs, collected):
            edges[(c, p)] = (True, method)
            measured_children.add(c)

    subnets: Dict[str, List[Dict[str, Any]]] = {}
    for n in nodes:
        ip = _private_ip(n.get("ip"))
        if ip is not None:
            subnets.setdefault(_subnet24(ip), []).append(n)

    synthetic: List[Dict[str, Any]] = []
    for cidr, members in subnets.items():
        gw = _pick_gateway_node(members)
        if gw is not None:
            anchor_id = gw["id"]
        else:
            # No gateway device was discovered on this segment — synthesize an
            # anchor so its hosts cluster under the subnet instead of scattering.
            anchor_id = -(len(synthetic) + 1)
            synthetic.append({"id": anchor_id, "ip": None, "mac": None, "name": cidr,
                              "type": "subnet", "subnet": cidr, "in_inventory": False,
                              "asset_id": None, "snmp": None})
        for n in members:
            if n["id"] == anchor_id or n["id"] in measured_children:
                continue
            edges.setdefault((n["id"], anchor_id), (False, "gateway"))

    edge_list = [{"source": c, "target": p, "measured": meas, "method": method}
                 for (c, p), (meas, method) in edges.items()]
    return edge_list, synthetic


# ── observation → device node ────────────────────────────────────────────────
def _device_key(o) -> str:
    """A stable identity for one machine across its several sightings — MAC first
    (the strongest), then a real hostname, then IP. Mirrors the dedup the
    discovered-devices endpoint uses, so the map and that list agree on 'one
    device'."""
    m = _norm_mac(getattr(o, "mac_address", None))
    if m:
        return "mac:" + m
    nm = (getattr(o, "host_name", None) or "").strip().lower()
    if nm and not _is_ip(nm):
        return "name:" + nm
    ip = getattr(o, "ip_address", None)
    return ("ip:" + ip) if ip else f"obs:{o.id}"


def _representative_observations(db: Session, tenant_id: int,
                                 run_id: Optional[int] = None) -> Dict[str, Any]:
    """Newest observation per device (the representative), keyed by device identity.
    The same visible set the rest of discovery shows. `run_id` scopes it to one
    discovery run; None = the full deduped backlog (current state of the network)."""
    from grc.models import DiscoveryObservation
    q = db.query(DiscoveryObservation).filter(
        DiscoveryObservation.tenant_id == tenant_id,
        DiscoveryObservation.resolution.in_(_VISIBLE))
    if run_id is not None:
        q = q.filter(DiscoveryObservation.run_id == run_id)
    rows = q.order_by(DiscoveryObservation.id.desc()).all()
    reps: Dict[str, Any] = {}
    for o in rows:
        key = _device_key(o)
        if key not in reps:            # newest wins (descending id order)
            reps[key] = o
    return reps


def _node_from_obs(o) -> Dict[str, Any]:
    raw = o.raw if isinstance(o.raw, dict) else {}
    ip = o.ip_address
    return {
        "id": o.id,                                        # int node id, stable within a response
        "ip": ip,
        "mac": _norm_mac(o.mac_address),
        "name": o.host_name or ip or f"device-{o.id}",
        "type": raw.get("device_type") or "unknown",
        "subnet": (_subnet24(_private_ip(ip)) if _private_ip(ip) else None),
        "in_inventory": o.resolution in ("created", "merged") or o.resolved_asset_id is not None,
        "asset_id": o.resolved_asset_id,
        "snmp": raw.get("snmp_topology"),                  # stored by collect_snmp_topology
    }


def build_topology_view(db: Session, tenant_id: int,
                        run_id: Optional[int] = None) -> Dict[str, Any]:
    """The topology graph from discovered devices: {nodes, edges}. `run_id` scopes
    it to one discovery run (None = current state across all runs). Nodes carry
    `asset_id`/`snmp` for callers that need them (attack-path overlay); the
    /discovery/topology endpoint projects those away. Read-only, computed on read."""
    reps = _representative_observations(db, tenant_id, run_id)
    nodes = [_node_from_obs(o) for o in reps.values()]
    collected = {n["id"]: n["snmp"] for n in nodes if n.get("snmp")}
    edges, synthetic = _assemble_edges(nodes, collected)
    return {"nodes": nodes + synthetic, "edges": edges}


# ── scan-time SNMP collection (stores neighbour tables on the observation) ────
def _tenant_communities(db: Session, tenant_id: int) -> List[bytes]:
    """SNMP read communities to try: the ones set on this tenant's campaigns
    (plaintext) plus the env default. Deduped, order-preserving."""
    out: List[bytes] = []
    seen: set = set()
    try:
        from grc.models import DiscoveryCampaign
        for (s,) in db.query(DiscoveryCampaign.snmp_communities).filter(
                DiscoveryCampaign.tenant_id == tenant_id).all():
            for part in (s or "").split(","):
                part = part.strip()
                if part and part not in seen:
                    seen.add(part)
                    out.append(part.encode())
    except Exception:
        logger.debug("tenant SNMP communities load failed", exc_info=True)
    try:
        from .fingerprint import _snmp_communities
        for c in _snmp_communities():
            if c not in out:
                out.append(c)
    except Exception:
        logger.debug("env SNMP communities load failed", exc_info=True)
    return out


def collect_snmp_topology(db: Session, tenant_id: int) -> int:
    """Walk each DISCOVERED network device (observation) over SNMP for its LLDP/
    CDP neighbours and bridge FDB, and store the result on that device's newest
    observation (`raw['snmp_topology']`) for `build_topology_view` to correlate on
    read. Best-effort — a silent device is simply skipped. Returns how many
    devices answered. Runs in execute_run so switches are read even before anyone
    promotes them to inventory."""
    reps = _representative_observations(db, tenant_id)
    infra = [o for o in reps.values()
             if _private_ip(o.ip_address)
             and (o.raw or {}).get("device_type") in _GATEWAY_TYPES]
    if not infra:
        return 0
    comms = _tenant_communities(db, tenant_id)
    if not comms:
        return 0

    from .snmp_topology import collect_device_topology
    walked = 0
    for o in infra[:_MAX_SNMP_DEVICES]:
        data = collect_device_topology(o.ip_address, comms)
        if data:
            raw = o.raw if isinstance(o.raw, dict) else {}
            o.raw = {**raw, "snmp_topology": data}     # reassign so SQLAlchemy sees the JSON change
            walked += 1
    if walked:
        db.flush()
        logger.info("network topology: SNMP-walked %d device(s) (tenant=%s)", walked, tenant_id)
    return walked


if __name__ == "__main__":  # pragma: no cover — pure-logic self-check, no DB / no SNMP
    # gateway pick
    m = [{"id": 1, "ip": "10.0.0.50", "type": "host"},
         {"id": 2, "ip": "10.0.0.1", "type": "host"},
         {"id": 3, "ip": "10.0.0.9", "type": "switch"}]
    assert _pick_gateway_node(m)["id"] == 2, "the .1 device is the gateway"
    m2 = [{"id": 4, "ip": "10.0.0.50", "type": "host"}, {"id": 5, "ip": "10.0.0.9", "type": "router"}]
    assert _pick_gateway_node(m2)["id"] == 5, "fall back to network gear"
    assert _pick_gateway_node([{"id": 6, "ip": "10.0.0.50", "type": "host"}]) is None

    # inferred gateway star (no SNMP): every non-gateway host → the gateway; a
    # discovered .1 means no synthetic anchor is needed.
    nodes = [{"id": 1, "ip": "10.0.0.1", "type": "router", "name": "gw", "mac": None},
             {"id": 2, "ip": "10.0.0.50", "type": "host", "name": "pc", "mac": None},
             {"id": 3, "ip": "10.0.0.60", "type": "host", "name": "prn", "mac": None}]
    edges, synth = _assemble_edges(nodes, {})
    assert {(e["source"], e["target"]) for e in edges} == {(2, 1), (3, 1)}
    assert all(e["measured"] is False for e in edges) and synth == []

    # no gateway discovered → a synthetic subnet anchor holds the hosts together
    nogw = [{"id": 10, "ip": "10.0.0.50", "type": "host", "name": "a", "mac": None},
            {"id": 11, "ip": "10.0.0.60", "type": "host", "name": "b", "mac": None}]
    e2, s2 = _assemble_edges(nogw, {})
    assert len(s2) == 1 and s2[0]["type"] == "subnet", s2
    anchor = s2[0]["id"]
    assert anchor < 0 and {(e["source"], e["target"]) for e in e2} == {(10, anchor), (11, anchor)}
    assert _norm_mac("AA-BB-CC-DD-EE-FF") == "aa:bb:cc:dd:ee:ff"
    print("network_topology self-check OK")
