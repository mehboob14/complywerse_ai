"""Network discovery — probe a CIDR range for live hosts.

Takes a CIDR (e.g. 10.0.0.0/24) + a runner type, and for each address:
  1. TCP-probe the appropriate port (5986 for windows_winrm,
     22 for linux_ssh, 443 for vmware_vcenter, 161 for netdev_snmp)
  2. Optionally attempt reverse DNS to get hostname
  3. Return status: 'reachable' | 'unreachable'

We do NOT attempt full credential preflight in this synchronous path
because (a) preflight per host can take 5-10s and (b) the CIDR may be
/24 (256 hosts) — full preflight × 256 = too slow for a sync request.
Instead the discovery returns the probe results; the operator picks
which hosts to import, and the import step runs full preflight on the
chosen subset.

Concurrency: ThreadPoolExecutor with 32 workers. A /24 (256 hosts) at
1s timeout per probe completes in ~10s. Larger CIDRs (e.g. /22 = 1024)
take ~30s; we cap at /20 (4096) and return 400 above that.
"""
from __future__ import annotations

import ipaddress
import socket
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any, Dict, List

# Maximum CIDR size we accept synchronously. /20 = 4096 addresses.
# Larger ranges would be a backgrounded task (Phase 5).
MAX_HOSTS = 4096

# Per-runner-type default probe port. Operators can override per-call.
RUNNER_DEFAULT_PORTS: Dict[str, int] = {
    "windows_winrm": 5986,
    "linux_ssh": 22,
    "netdev_ssh": 22,
    "netdev_snmp": 161,
    "aws_readonly": 0,    # cloud → no IP probe applicable
    "oracle_sql": 1521,   # Oracle TNS Listener
}


def _probe_one(host: str, port: int, timeout_s: float = 1.0) -> Dict[str, Any]:
    """Single-host TCP probe + reverse DNS. Returns dict with status."""
    out: Dict[str, Any] = {"ip": host, "port": port, "hostname": None, "status": "unreachable", "rtt_ms": None}
    try:
        import time
        start = time.monotonic()
        with socket.create_connection((host, port), timeout=timeout_s) as s:
            out["rtt_ms"] = int((time.monotonic() - start) * 1000)
            out["status"] = "reachable"
    except (socket.timeout, ConnectionRefusedError, OSError):
        return out
    # Reverse DNS (best-effort; some networks lack it)
    try:
        out["hostname"] = socket.gethostbyaddr(host)[0]
    except Exception:
        out["hostname"] = None
    return out


def discover_cidr(
    cidr: str,
    runner_type: str,
    port_override: int | None = None,
    timeout_s: float = 1.0,
    max_workers: int = 32,
) -> Dict[str, Any]:
    """Discover live hosts in a CIDR range. Returns probe results + summary."""
    try:
        network = ipaddress.ip_network(cidr, strict=False)
    except ValueError as e:
        return {"error": f"Invalid CIDR: {e}"}

    hosts = list(network.hosts()) if network.num_addresses > 2 else list(network)
    if len(hosts) > MAX_HOSTS:
        return {"error": f"CIDR has {len(hosts)} hosts; max {MAX_HOSTS} per discovery"}

    port = port_override or RUNNER_DEFAULT_PORTS.get(runner_type, 0)
    if not port:
        return {"error": f"No default port for runner_type={runner_type}; pass port_override"}

    results: List[Dict[str, Any]] = []
    with ThreadPoolExecutor(max_workers=max_workers) as pool:
        futures = {pool.submit(_probe_one, str(ip), port, timeout_s): ip for ip in hosts}
        for fut in as_completed(futures):
            try:
                results.append(fut.result())
            except Exception as e:  # pragma: no cover — defensive
                results.append({"ip": str(futures[fut]), "port": port, "status": "error", "error": str(e)})

    results.sort(key=lambda r: ipaddress.ip_address(r["ip"]))
    reachable = [r for r in results if r["status"] == "reachable"]
    return {
        "cidr": cidr,
        "runner_type": runner_type,
        "port": port,
        "scanned": len(results),
        "reachable_count": len(reachable),
        "hosts": results,
    }
