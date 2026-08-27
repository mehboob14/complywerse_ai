"""DigitalOcean ACCOUNT inventory collector.

The DigitalOcean *droplet* path (platform "digitalocean" → linux_ssh) inventories
ONE droplet as a Linux server. This collector is the account-level twin — the
same shape as AWS/Azure: a read-only API token enumerates EVERYTHING in the DO
account (droplets, volumes, snapshots, VPCs, firewalls, load balancers, reserved
IPs, managed databases, Kubernetes clusters, container registry, projects).

Registered as `digitalocean_api` (kind = cloud). Read-only (GET only). Each
resource type is a status-wrapped section, so a token missing a scope shows
`permission_denied` and never aborts the whole collect.

Credential key: `do_api_token` (resolved from the connection by credentials.py).
"""
from __future__ import annotations

from typing import Any, Dict, List

from . import register, collect_section

_BASE = "https://api.digitalocean.com/v2"
_PAGE = 200        # per_page
_MAX_PAGES = 5     # cap total pages per resource (→ up to 1000 items)


@register("digitalocean_api")
def collect_digitalocean(creds: Dict[str, Any]) -> Dict[str, Any]:
    """Inventory a DigitalOcean account over the read-only API."""
    try:
        import requests  # type: ignore
    except ImportError:
        raise RuntimeError("requests not installed on this server")

    token = (creds.get("do_api_token") or creds.get("do_token") or "").strip()
    if not token:
        raise RuntimeError("DigitalOcean API token is required")

    sess = requests.Session()
    sess.headers.update({
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    })
    timeout = int(creds.get("timeout") or 15)

    def _get(path: str) -> dict:
        r = sess.get(f"{_BASE}{path}", timeout=timeout)
        if r.status_code in (401, 403):
            raise PermissionError(f"DigitalOcean API {r.status_code}: not authorized for {path}")
        r.raise_for_status()
        return r.json() if r.content else {}

    def _list(path: str, key: str) -> List[dict]:
        """Paginated list of a resource collection, bounded."""
        out: List[dict] = []
        url = f"{path}?per_page={_PAGE}"
        pages = 0
        while url and pages < _MAX_PAGES:
            data = _get(url)
            out.extend(data.get(key, []) or [])
            nxt = (((data.get("links") or {}).get("pages") or {}).get("next"))
            url = nxt.replace(_BASE, "") if nxt else None
            pages += 1
        return out

    # ── connect signal — a bad token fails HERE (mirrors other collectors) ──
    acct = _get("/account").get("account", {})

    props: Dict[str, Any] = {
        "provider": "DigitalOcean",
        "account_email": acct.get("email"),
        "account_status": acct.get("status"),
        "uuid": acct.get("uuid"),
        "droplet_limit": acct.get("droplet_limit"),
        "team": (acct.get("team") or {}).get("name") if isinstance(acct.get("team"), dict) else None,
    }

    def _droplets():
        rows = _list("/droplets", "droplets")
        out = []
        for d in rows:
            nets = d.get("networks") or {}
            v4 = nets.get("v4") or []
            pub = next((n["ip_address"] for n in v4 if n.get("type") == "public"), None)
            priv = next((n["ip_address"] for n in v4 if n.get("type") == "private"), None)
            out.append({
                "id": d.get("id"), "name": d.get("name"),
                "status": d.get("status"),
                "region": (d.get("region") or {}).get("slug"),
                "size": d.get("size_slug"),
                "vcpus": d.get("vcpus"), "memory_mb": d.get("memory"), "disk_gb": d.get("disk"),
                "image": (d.get("image") or {}).get("slug") or (d.get("image") or {}).get("distribution"),
                "public_ip": pub, "private_ip": priv,
                "vpc_uuid": d.get("vpc_uuid"),
                "tags": d.get("tags") or [],
                "created_at": d.get("created_at"),
            })
        return out
    props["droplets"] = collect_section(_droplets)

    def _volumes():
        return [{
            "id": v.get("id"), "name": v.get("name"),
            "size_gb": v.get("size_gigabytes"),
            "region": (v.get("region") or {}).get("slug"),
            "attached_droplet_ids": v.get("droplet_ids") or [],
            "filesystem_type": v.get("filesystem_type"),
        } for v in _list("/volumes", "volumes")]
    props["volumes"] = collect_section(_volumes)

    def _snapshots():
        return [{
            "id": s.get("id"), "name": s.get("name"), "type": s.get("resource_type"),
            "size_gb": s.get("size_gigabytes"), "regions": s.get("regions") or [],
            "created_at": s.get("created_at"),
        } for s in _list("/snapshots", "snapshots")]
    props["snapshots"] = collect_section(_snapshots)

    def _vpcs():
        return [{
            "id": v.get("id"), "name": v.get("name"),
            "region": v.get("region"), "ip_range": v.get("ip_range"),
            "default": v.get("default"),
        } for v in _list("/vpcs", "vpcs")]
    props["vpcs"] = collect_section(_vpcs)

    def _firewalls():
        return [{
            "id": f.get("id"), "name": f.get("name"), "status": f.get("status"),
            "inbound_rule_count": len(f.get("inbound_rules") or []),
            "outbound_rule_count": len(f.get("outbound_rules") or []),
            "droplet_ids": f.get("droplet_ids") or [],
        } for f in _list("/firewalls", "firewalls")]
    props["firewalls"] = collect_section(_firewalls)

    def _load_balancers():
        return [{
            "id": lb.get("id"), "name": lb.get("name"), "status": lb.get("status"),
            "region": (lb.get("region") or {}).get("slug"),
            "ip": lb.get("ip"), "algorithm": lb.get("algorithm"),
            "droplet_ids": lb.get("droplet_ids") or [],
        } for lb in _list("/load_balancers", "load_balancers")]
    props["load_balancers"] = collect_section(_load_balancers)

    def _reserved_ips():
        return [{
            "ip": r.get("ip"), "region": (r.get("region") or {}).get("slug"),
            "droplet_id": (r.get("droplet") or {}).get("id") if r.get("droplet") else None,
        } for r in _list("/reserved_ips", "reserved_ips")]
    props["reserved_ips"] = collect_section(_reserved_ips)

    def _databases():
        return [{
            "id": d.get("id"), "name": d.get("name"),
            "engine": d.get("engine"), "version": d.get("version"),
            "region": d.get("region"), "status": d.get("status"),
            "size": d.get("size"), "num_nodes": d.get("num_nodes"),
        } for d in _list("/databases", "databases")]
    props["managed_databases"] = collect_section(_databases)

    def _k8s():
        return [{
            "id": c.get("id"), "name": c.get("name"),
            "region": c.get("region"), "version": c.get("version"),
            "status": (c.get("status") or {}).get("state"),
            "node_pool_count": len(c.get("node_pools") or []),
            "node_count": sum(p.get("count", 0) for p in (c.get("node_pools") or [])),
        } for c in _list("/kubernetes/clusters", "kubernetes_clusters")]
    props["kubernetes_clusters"] = collect_section(_k8s)

    def _registry():
        reg = _get("/registry").get("registry") or {}
        if not reg:
            return {}
        return {"name": reg.get("name"), "region": reg.get("region"),
                "storage_usage_bytes": reg.get("storage_usage_bytes")}
    props["container_registry"] = collect_section(_registry)

    def _projects():
        return [{
            "id": p.get("id"), "name": p.get("name"),
            "purpose": p.get("purpose"), "environment": p.get("environment"),
            "is_default": p.get("is_default"),
        } for p in _list("/projects", "projects")]
    props["projects"] = collect_section(_projects)

    return props
