"""Azure subscription deep inventory collector.

Replaces the shallow legacy ``collect_azure`` (which returned only resource-group
NAMES and one total ``resource_count``). This collector returns TYPED resources —
VMs, disks, NICs, vnets/subnets/nsgs/public-ips/load-balancers, plus best-effort
sql/storage/aks/app-service/function/key-vault/container sections.

Each resource TYPE is its own status section (``collect_section``). Azure's
per-service SDKs are optional: when ``azure-mgmt-compute`` / ``azure-mgmt-network``
/ etc. is NOT installed, that section is marked ``not_supported`` rather than
crashing the whole collect. A section whose API call is denied becomes
``permission_denied``. A ``resource_count`` summary scalar is kept in addition to
the typed sections.

Credential keys are reused EXACTLY from the legacy collector:
  azure_subscription_id, azure_tenant_id, azure_client_id, azure_client_secret.

READ-ONLY: only list/get calls. No mutations. Every resource list is bounded.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from . import (  # noqa: F401
    register, collect_section, section, discovered,
    DISCOVERED, PERMISSION_DENIED, NOT_SUPPORTED, NOT_APPLICABLE, UNAVAILABLE, ERROR,
)

_MAX_ITEMS = 200


def _rg_of(resource_id: Optional[str]) -> Optional[str]:
    """Extract the resource-group name from an ARM resource id."""
    if not resource_id:
        return None
    parts = resource_id.split("/")
    for i, p in enumerate(parts):
        if p.lower() == "resourcegroups" and i + 1 < len(parts):
            return parts[i + 1]
    return None


class _SdkMissing(Exception):
    """Raised when an optional azure-mgmt-* SDK isn't installed → not_supported."""


def _wrap_extra(fn) -> dict:
    """Run an extra-resource lister. If the SDK is missing (``_SdkMissing``) the
    section is NOT_SUPPORTED; a denied/failed API call is classified the same way
    ``collect_section`` would (permission_denied / not_supported / error). Never
    raises — an inaccessible extra must not abort the collect."""
    from .status import classify_error
    try:
        return discovered(fn())
    except _SdkMissing as e:
        return section(NOT_SUPPORTED, None, note=str(e)[:200])
    except Exception as e:  # noqa: BLE001
        return section(classify_error(e), None, note=str(e)[:200])


@register("azure_readonly")
def collect_azure(creds: Dict[str, Any]) -> Dict[str, Any]:
    """Deep, typed inventory of an Azure subscription (read-only)."""
    try:
        from azure.identity import ClientSecretCredential  # type: ignore
        from azure.mgmt.resource import ResourceManagementClient  # type: ignore
    except ImportError:
        raise RuntimeError("azure-identity / azure-mgmt-resource not installed on this server")

    sub = creds.get("azure_subscription_id")
    tenant = creds.get("azure_tenant_id")
    cid = creds.get("azure_client_id")
    secret = creds.get("azure_client_secret")
    if not (sub and tenant and cid and secret):
        raise RuntimeError("Azure subscription/tenant/client id/secret are required")

    cred = ClientSecretCredential(tenant_id=tenant, client_id=cid, client_secret=secret)

    # ── Connect signal: build the resource client and force one call. A hard
    # failure here means "connect failed" → RuntimeError (mirrors legacy).
    resource_client = ResourceManagementClient(cred, sub)
    try:
        rg_list = list(resource_client.resource_groups.list())
    except Exception as e:  # noqa: BLE001
        raise RuntimeError(f"Azure credential validation failed: {e}")

    props: Dict[str, Any] = {
        "provider": "Azure",
        "subscription_id": sub,
        "tenant_id": tenant,
    }

    # ── Subscription identity (display name via subscription client if present) ─
    def _subscription():
        display_name = None
        try:
            from azure.mgmt.subscription import SubscriptionClient  # type: ignore
            sc = SubscriptionClient(cred)
            s = sc.subscriptions.get(sub)
            display_name = getattr(s, "display_name", None)
        except ImportError:
            display_name = None
        except Exception:  # noqa: BLE001
            display_name = None
        return {
            "subscription_id": sub,
            "tenant_id": tenant,
            "display_name": display_name,
        }
    props["subscription"] = collect_section(_subscription)

    # ── Resource groups ──────────────────────────────────────────────────────
    def _resource_groups():
        items: List[Dict[str, Any]] = []
        for g in rg_list:
            items.append({
                "name": g.name,
                "id": g.id,
                "location": g.location,
                "tags": dict(g.tags) if getattr(g, "tags", None) else {},
            })
            if len(items) >= _MAX_ITEMS:
                break
        return {"count": len(items), "items": items}
    props["resource_groups"] = collect_section(_resource_groups)
    props["resource_group_count"] = len(rg_list)

    # ── resource_count summary scalar (kept in addition to typed sections) ────
    def _resource_count():
        return sum(1 for _ in resource_client.resources.list())
    props["resource_count"] = collect_section(_resource_count)

    regions = sorted({g.location for g in rg_list if getattr(g, "location", None)})
    props["regions"] = regions

    # ── Compute: VMs + disks (azure-mgmt-compute) ────────────────────────────
    try:
        from azure.mgmt.compute import ComputeManagementClient  # type: ignore
        compute = ComputeManagementClient(cred, sub)
    except ImportError:
        compute = None

    if compute is None:
        props["virtual_machines"] = section(NOT_SUPPORTED, None,
                                            note="azure-mgmt-compute not installed")
        props["disks"] = section(NOT_SUPPORTED, None,
                                 note="azure-mgmt-compute not installed")
    else:
        def _virtual_machines():
            items: List[Dict[str, Any]] = []
            for vm in compute.virtual_machines.list_all():
                rg = _rg_of(vm.id)
                power_state = None
                try:
                    iv = compute.virtual_machines.instance_view(rg, vm.name)
                    for st in getattr(iv, "statuses", []) or []:
                        code = getattr(st, "code", "") or ""
                        if code.startswith("PowerState/"):
                            power_state = code.split("/", 1)[1]
                except Exception:  # noqa: BLE001
                    power_state = None
                hw = getattr(vm, "hardware_profile", None)
                os_profile = getattr(vm, "storage_profile", None)
                os_disk = None
                if os_profile is not None and getattr(os_profile, "os_disk", None) is not None:
                    os_disk = getattr(os_profile.os_disk, "name", None)
                os_type = None
                if os_profile is not None and getattr(os_profile, "os_disk", None) is not None:
                    ot = getattr(os_profile.os_disk, "os_type", None)
                    os_type = str(ot) if ot is not None else None
                nic_ids = []
                net_profile = getattr(vm, "network_profile", None)
                if net_profile is not None:
                    for nic in getattr(net_profile, "network_interfaces", []) or []:
                        nic_ids.append(getattr(nic, "id", None))
                items.append({
                    "vm_id": vm.id,
                    "name": vm.name,
                    "vm_size": getattr(hw, "vm_size", None) if hw else None,
                    "os_type": os_type,
                    "power_state": power_state,
                    "resource_group": rg,
                    "location": vm.location,
                    "nic_ids": nic_ids,
                    "os_disk": os_disk,
                })
                if len(items) >= _MAX_ITEMS:
                    return {"count": len(items), "items": items, "truncated": True}
            return {"count": len(items), "items": items}
        props["virtual_machines"] = collect_section(_virtual_machines)

        def _disks():
            items: List[Dict[str, Any]] = []
            for d in compute.disks.list():
                sku = getattr(d, "sku", None)
                enc = getattr(d, "encryption", None)
                items.append({
                    "disk_id": d.id,
                    "name": d.name,
                    "size_gib": getattr(d, "disk_size_gb", None),
                    "sku": getattr(sku, "name", None) if sku else None,
                    "encryption": str(getattr(enc, "type", None)) if enc else None,
                    "resource_group": _rg_of(d.id),
                    "location": getattr(d, "location", None),
                })
                if len(items) >= _MAX_ITEMS:
                    return {"count": len(items), "items": items, "truncated": True}
            return {"count": len(items), "items": items}
        props["disks"] = collect_section(_disks)

    # ── Networking (azure-mgmt-network) ──────────────────────────────────────
    try:
        from azure.mgmt.network import NetworkManagementClient  # type: ignore
        network = NetworkManagementClient(cred, sub)
    except ImportError:
        network = None

    _net_sections = ("network_interfaces", "vnets", "subnets", "nsgs",
                     "public_ips", "load_balancers")
    if network is None:
        for key in _net_sections:
            props[key] = section(NOT_SUPPORTED, None,
                                 note="azure-mgmt-network not installed")
    else:
        def _nics():
            items: List[Dict[str, Any]] = []
            for nic in network.network_interfaces.list_all():
                private_ip = public_ip_id = subnet_id = None
                for ipc in getattr(nic, "ip_configurations", []) or []:
                    private_ip = getattr(ipc, "private_ip_address", None) or private_ip
                    pip = getattr(ipc, "public_ip_address", None)
                    if pip is not None:
                        public_ip_id = getattr(pip, "id", None)
                    sn = getattr(ipc, "subnet", None)
                    if sn is not None:
                        subnet_id = getattr(sn, "id", None)
                nsg = getattr(nic, "network_security_group", None)
                items.append({
                    "nic_id": nic.id,
                    "name": nic.name,
                    "private_ip": private_ip,
                    "public_ip_id": public_ip_id,
                    "subnet_id": subnet_id,
                    "nsg_id": getattr(nsg, "id", None) if nsg else None,
                    "resource_group": _rg_of(nic.id),
                })
                if len(items) >= _MAX_ITEMS:
                    return {"count": len(items), "items": items, "truncated": True}
            return {"count": len(items), "items": items}
        props["network_interfaces"] = collect_section(_nics)

        def _vnets():
            items: List[Dict[str, Any]] = []
            for v in network.virtual_networks.list_all():
                addr = getattr(getattr(v, "address_space", None), "address_prefixes", None) or []
                items.append({
                    "id": v.id,
                    "name": v.name,
                    "location": getattr(v, "location", None),
                    "address_prefixes": list(addr),
                    "resource_group": _rg_of(v.id),
                })
                if len(items) >= _MAX_ITEMS:
                    return {"count": len(items), "items": items, "truncated": True}
            return {"count": len(items), "items": items}
        props["vnets"] = collect_section(_vnets)

        def _subnets():
            items: List[Dict[str, Any]] = []
            for v in network.virtual_networks.list_all():
                for sn in getattr(v, "subnets", []) or []:
                    nsg = getattr(sn, "network_security_group", None)
                    items.append({
                        "id": sn.id,
                        "name": sn.name,
                        "vnet": v.name,
                        "address_prefix": getattr(sn, "address_prefix", None),
                        "nsg_id": getattr(nsg, "id", None) if nsg else None,
                        "resource_group": _rg_of(v.id),
                    })
                    if len(items) >= _MAX_ITEMS:
                        return {"count": len(items), "items": items, "truncated": True}
            return {"count": len(items), "items": items}
        props["subnets"] = collect_section(_subnets)

        def _nsgs():
            items: List[Dict[str, Any]] = []
            for g in network.network_security_groups.list_all():
                items.append({
                    "id": g.id,
                    "name": g.name,
                    "location": getattr(g, "location", None),
                    "rule_count": len(getattr(g, "security_rules", []) or []),
                    "resource_group": _rg_of(g.id),
                })
                if len(items) >= _MAX_ITEMS:
                    return {"count": len(items), "items": items, "truncated": True}
            return {"count": len(items), "items": items}
        props["nsgs"] = collect_section(_nsgs)

        def _public_ips():
            items: List[Dict[str, Any]] = []
            for p in network.public_ip_addresses.list_all():
                items.append({
                    "id": p.id,
                    "name": p.name,
                    "ip_address": getattr(p, "ip_address", None),
                    "allocation_method": str(getattr(p, "public_ip_allocation_method", None)) if getattr(p, "public_ip_allocation_method", None) else None,
                    "resource_group": _rg_of(p.id),
                })
                if len(items) >= _MAX_ITEMS:
                    return {"count": len(items), "items": items, "truncated": True}
            return {"count": len(items), "items": items}
        props["public_ips"] = collect_section(_public_ips)

        def _load_balancers():
            items: List[Dict[str, Any]] = []
            for lb in network.load_balancers.list_all():
                items.append({
                    "id": lb.id,
                    "name": lb.name,
                    "location": getattr(lb, "location", None),
                    "sku": getattr(getattr(lb, "sku", None), "name", None),
                    "resource_group": _rg_of(lb.id),
                })
                if len(items) >= _MAX_ITEMS:
                    return {"count": len(items), "items": items, "truncated": True}
            return {"count": len(items), "items": items}
        props["load_balancers"] = collect_section(_load_balancers)

    # ── Best-effort extras: each its own section, not_supported if SDK absent ─
    # SQL servers
    def _sql_servers():
        try:
            from azure.mgmt.sql import SqlManagementClient  # type: ignore
        except ImportError:
            raise _SdkMissing("azure-mgmt-sql not installed")
        client = SqlManagementClient(cred, sub)
        items: List[Dict[str, Any]] = []
        for s in client.servers.list():
            items.append({
                "id": s.id,
                "name": s.name,
                "location": getattr(s, "location", None),
                "fqdn": getattr(s, "fully_qualified_domain_name", None),
                "version": getattr(s, "version", None),
                "resource_group": _rg_of(s.id),
            })
            if len(items) >= _MAX_ITEMS:
                return {"count": len(items), "items": items, "truncated": True}
        return {"count": len(items), "items": items}
    props["sql_servers"] = _wrap_extra(_sql_servers)

    # Storage accounts
    def _storage_accounts():
        try:
            from azure.mgmt.storage import StorageManagementClient  # type: ignore
        except ImportError:
            raise _SdkMissing("azure-mgmt-storage not installed")
        client = StorageManagementClient(cred, sub)
        items: List[Dict[str, Any]] = []
        for a in client.storage_accounts.list():
            items.append({
                "id": a.id,
                "name": a.name,
                "location": getattr(a, "location", None),
                "sku": getattr(getattr(a, "sku", None), "name", None),
                "kind": str(getattr(a, "kind", None)) if getattr(a, "kind", None) else None,
                "https_only": getattr(a, "enable_https_traffic_only", None),
                "resource_group": _rg_of(a.id),
            })
            if len(items) >= _MAX_ITEMS:
                return {"count": len(items), "items": items, "truncated": True}
        return {"count": len(items), "items": items}
    props["storage_accounts"] = _wrap_extra(_storage_accounts)

    # AKS clusters
    def _aks_clusters():
        try:
            from azure.mgmt.containerservice import ContainerServiceClient  # type: ignore
        except ImportError:
            raise _SdkMissing("azure-mgmt-containerservice not installed")
        client = ContainerServiceClient(cred, sub)
        items: List[Dict[str, Any]] = []
        for c in client.managed_clusters.list():
            items.append({
                "id": c.id,
                "name": c.name,
                "location": getattr(c, "location", None),
                "kubernetes_version": getattr(c, "kubernetes_version", None),
                "resource_group": _rg_of(c.id),
            })
            if len(items) >= _MAX_ITEMS:
                return {"count": len(items), "items": items, "truncated": True}
        return {"count": len(items), "items": items}
    props["aks_clusters"] = _wrap_extra(_aks_clusters)

    # App Services + Function Apps (both from azure-mgmt-web sites list)
    def _web_sites(function: bool):
        try:
            from azure.mgmt.web import WebSiteManagementClient  # type: ignore
        except ImportError:
            raise _SdkMissing("azure-mgmt-web not installed")
        client = WebSiteManagementClient(cred, sub)
        items: List[Dict[str, Any]] = []
        for s in client.web_apps.list():
            kind = (getattr(s, "kind", "") or "").lower()
            is_function = "functionapp" in kind
            if is_function != function:
                continue
            items.append({
                "id": s.id,
                "name": s.name,
                "location": getattr(s, "location", None),
                "kind": getattr(s, "kind", None),
                "state": getattr(s, "state", None),
                "default_host_name": getattr(s, "default_host_name", None),
                "https_only": getattr(s, "https_only", None),
                "resource_group": _rg_of(s.id),
            })
            if len(items) >= _MAX_ITEMS:
                return {"count": len(items), "items": items, "truncated": True}
        return {"count": len(items), "items": items}
    props["app_services"] = _wrap_extra(lambda: _web_sites(False))
    props["function_apps"] = _wrap_extra(lambda: _web_sites(True))

    # Key vaults
    def _key_vaults():
        try:
            from azure.mgmt.keyvault import KeyVaultManagementClient  # type: ignore
        except ImportError:
            raise _SdkMissing("azure-mgmt-keyvault not installed")
        client = KeyVaultManagementClient(cred, sub)
        items: List[Dict[str, Any]] = []
        for v in client.vaults.list_by_subscription():
            items.append({
                "id": v.id,
                "name": v.name,
                "location": getattr(v, "location", None),
                "resource_group": _rg_of(v.id),
            })
            if len(items) >= _MAX_ITEMS:
                return {"count": len(items), "items": items, "truncated": True}
        return {"count": len(items), "items": items}
    props["key_vaults"] = _wrap_extra(_key_vaults)

    # Container instances
    def _container_instances():
        try:
            from azure.mgmt.containerinstance import ContainerInstanceManagementClient  # type: ignore
        except ImportError:
            raise _SdkMissing("azure-mgmt-containerinstance not installed")
        client = ContainerInstanceManagementClient(cred, sub)
        items: List[Dict[str, Any]] = []
        for g in client.container_groups.list():
            items.append({
                "id": g.id,
                "name": g.name,
                "location": getattr(g, "location", None),
                "os_type": str(getattr(g, "os_type", None)) if getattr(g, "os_type", None) else None,
                "resource_group": _rg_of(g.id),
            })
            if len(items) >= _MAX_ITEMS:
                return {"count": len(items), "items": items, "truncated": True}
        return {"count": len(items), "items": items}
    props["container_instances"] = _wrap_extra(_container_instances)

    return props
