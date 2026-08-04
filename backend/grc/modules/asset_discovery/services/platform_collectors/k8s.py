"""Kubernetes cluster deep inventory collector (API).

Legacy `collect_k8s` returned only a version string + three counts. This module
keeps the exact same connection setup and credential keys (kubeconfig, or
k8s_server + k8s_token) but discovers actual objects: nodes, namespaces,
workloads, pods, containers, services, ingresses, storage and network policies.

Contract (see status.py):
  * Flat identity scalars live at the top (provider, version, api_server …).
  * Every DEEP section is a named key wrapped by `collect_section(...)`, so an
    RBAC-denied API group degrades to `{"status": "permission_denied", ...}` and
    NEVER aborts the collect.
  * READ-ONLY (list/get only). Secret VALUES are never read.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from . import (
    register, collect_section, section, discovered,
    DISCOVERED, PERMISSION_DENIED, NOT_SUPPORTED, NOT_APPLICABLE, UNAVAILABLE, ERROR,
)

_CAP = 200


def _cap(items: List[Any]) -> Dict[str, Any]:
    return {"items": items[:_CAP], "count": len(items)}


def _q(obj, *names):
    """Safe nested getattr — return the first present attribute chain or None."""
    for name in names:
        obj = getattr(obj, name, None)
        if obj is None:
            return None
    return obj


@register("k8s_api")
def collect_k8s(creds: Dict[str, Any]) -> Dict[str, Any]:
    """Deep-inventory a Kubernetes cluster over the read-only API. Same
    connection + credential keys as the legacy collector. Each API-group call is
    wrapped as a status section so an RBAC denial marks only that section
    permission_denied while the rest of the collect still succeeds."""
    try:
        from kubernetes import client as k8s, config as k8scfg  # type: ignore
    except ImportError:
        raise RuntimeError("kubernetes client not installed on this server")
    import os as _os
    import tempfile

    kubeconfig = creds.get("kubeconfig")
    api_server: Optional[str] = None
    if kubeconfig:
        with tempfile.NamedTemporaryFile("w", suffix=".yaml", delete=False) as fh:
            fh.write(kubeconfig)
            path = fh.name
        try:
            k8scfg.load_kube_config(config_file=path)
        finally:
            try:
                _os.unlink(path)
            except Exception:  # noqa: BLE001
                pass
    elif creds.get("k8s_server"):
        cfg = k8s.Configuration()
        cfg.host = creds.get("k8s_server")
        cfg.api_key = {"authorization": "Bearer " + (creds.get("k8s_token") or "")}
        cfg.verify_ssl = False
        k8s.Configuration.set_default(cfg)
        api_server = creds.get("k8s_server")
    else:
        raise RuntimeError("Kubernetes needs a kubeconfig or server+token")

    core = k8s.CoreV1Api()
    apps = k8s.AppsV1Api()
    batch = k8s.BatchV1Api()
    net = k8s.NetworkingV1Api()
    storage_api = k8s.StorageV1Api()

    if api_server is None:
        try:
            api_server = k8s.Configuration.get_default_copy().host
        except Exception:  # noqa: BLE001
            api_server = None

    props: Dict[str, Any] = {"provider": "Kubernetes", "api_server": api_server}

    # ── cluster identity (flat + a cluster section) ─────────────────────────
    def _cluster() -> Dict[str, Any]:
        v = k8s.VersionApi().get_code()
        return {
            "version": f"{getattr(v, 'major', '')}.{getattr(v, 'minor', '')}".strip("."),
            "git_version": getattr(v, "git_version", None),
            "platform": getattr(v, "platform", None),
        }
    cluster = collect_section(_cluster)
    props["cluster"] = cluster
    if cluster.get("status") == DISCOVERED and isinstance(cluster.get("data"), dict):
        props["version"] = cluster["data"].get("version")

    # ── nodes ───────────────────────────────────────────────────────────────
    def _nodes() -> Dict[str, Any]:
        rows: List[Dict[str, Any]] = []
        for n in core.list_node().items:
            labels = _q(n, "metadata", "labels") or {}
            roles = [k.split("/", 1)[1] for k in labels
                     if k.startswith("node-role.kubernetes.io/") and "/" in k]
            info = _q(n, "status", "node_info")
            cap = _q(n, "status", "capacity") or {}
            alloc = _q(n, "status", "allocatable") or {}
            addrs = _q(n, "status", "addresses") or []
            internal = next((a.address for a in addrs if a.type == "InternalIP"), None)
            external = next((a.address for a in addrs if a.type == "ExternalIP"), None)
            conds = _q(n, "status", "conditions") or []
            ready = next((c.status for c in conds if c.type == "Ready"), None)
            rows.append({
                "name": _q(n, "metadata", "name"),
                "roles": roles,
                "os_image": getattr(info, "os_image", None) if info else None,
                "kernel_version": getattr(info, "kernel_version", None) if info else None,
                "architecture": getattr(info, "architecture", None) if info else None,
                "container_runtime_version": getattr(info, "container_runtime_version", None) if info else None,
                "kubelet_version": getattr(info, "kubelet_version", None) if info else None,
                "cpu_capacity": cap.get("cpu"),
                "memory_capacity": cap.get("memory"),
                "cpu_allocatable": alloc.get("cpu"),
                "memory_allocatable": alloc.get("memory"),
                "internal_ip": internal,
                "external_ip": external,
                "ready": ready,
                "conditions": {c.type: c.status for c in conds},
            })
        return _cap(rows)
    props["nodes"] = collect_section(_nodes)

    # ── namespaces (+ resource-quota count per ns) ──────────────────────────
    def _namespaces() -> Dict[str, Any]:
        rows: List[Dict[str, Any]] = []
        for ns in core.list_namespace().items:
            name = _q(ns, "metadata", "name")
            rq = None
            try:
                rq = len(core.list_namespaced_resource_quota(name).items)
            except Exception:  # noqa: BLE001
                rq = None
            rows.append({
                "name": name,
                "status": _q(ns, "status", "phase"),
                "resource_quota_count": rq,
            })
        return _cap(rows)
    props["namespaces"] = collect_section(_namespaces)

    # ── workloads (counts + brief lists) ────────────────────────────────────
    def _brief(items, ready_fn) -> Dict[str, Any]:
        rows = []
        for it in items:
            rows.append({
                "name": _q(it, "metadata", "name"),
                "namespace": _q(it, "metadata", "namespace"),
                **ready_fn(it),
            })
        return _cap(rows)

    props["deployments"] = collect_section(lambda: _brief(
        apps.list_deployment_for_all_namespaces().items,
        lambda d: {"replicas": _q(d, "spec", "replicas"),
                   "ready": _q(d, "status", "ready_replicas")}))
    props["statefulsets"] = collect_section(lambda: _brief(
        apps.list_stateful_set_for_all_namespaces().items,
        lambda d: {"replicas": _q(d, "spec", "replicas"),
                   "ready": _q(d, "status", "ready_replicas")}))
    props["daemonsets"] = collect_section(lambda: _brief(
        apps.list_daemon_set_for_all_namespaces().items,
        lambda d: {"desired": _q(d, "status", "desired_number_scheduled"),
                   "ready": _q(d, "status", "number_ready")}))
    props["replicasets"] = collect_section(lambda: _brief(
        apps.list_replica_set_for_all_namespaces().items,
        lambda d: {"replicas": _q(d, "spec", "replicas"),
                   "ready": _q(d, "status", "ready_replicas")}))
    props["jobs"] = collect_section(lambda: _brief(
        batch.list_job_for_all_namespaces().items,
        lambda d: {"succeeded": _q(d, "status", "succeeded"),
                   "active": _q(d, "status", "active")}))
    props["cronjobs"] = collect_section(lambda: _brief(
        batch.list_cron_job_for_all_namespaces().items,
        lambda d: {"schedule": _q(d, "spec", "schedule"),
                   "suspended": _q(d, "spec", "suspend")}))

    # ── pods + containers (aggregate from the one pod list) ─────────────────
    _pod_cache: Dict[str, Any] = {}

    def _list_pods():
        if "items" not in _pod_cache:
            _pod_cache["items"] = core.list_pod_for_all_namespaces().items
        return _pod_cache["items"]

    def _pods() -> Dict[str, Any]:
        rows: List[Dict[str, Any]] = []
        for p in _list_pods():
            containers = _q(p, "spec", "containers") or []
            rows.append({
                "name": _q(p, "metadata", "name"),
                "namespace": _q(p, "metadata", "namespace"),
                "node": _q(p, "spec", "node_name"),
                "phase": _q(p, "status", "phase"),
                "pod_ip": _q(p, "status", "pod_ip"),
                "container_count": len(containers),
            })
        return _cap(rows)
    props["pods"] = collect_section(_pods)

    def _containers() -> Dict[str, Any]:
        rows: List[Dict[str, Any]] = []
        for p in _list_pods():
            ns = _q(p, "metadata", "namespace")
            for c in (_q(p, "spec", "containers") or []):
                image = getattr(c, "image", None) or ""
                tag = None
                if "@" in image:
                    tag = image.split("@", 1)[1]
                elif ":" in image.rsplit("/", 1)[-1]:
                    tag = image.rsplit(":", 1)[1]
                res = getattr(c, "resources", None)
                rows.append({
                    "name": getattr(c, "name", None),
                    "namespace": ns,
                    "image": image or None,
                    "image_tag": tag,
                    "requests": dict(getattr(res, "requests", None) or {}) if res else None,
                    "limits": dict(getattr(res, "limits", None) or {}) if res else None,
                })
                if len(rows) >= _CAP:
                    return {"items": rows, "count": len(rows), "truncated": True}
        return _cap(rows)
    props["containers"] = collect_section(_containers)

    # ── services / ingress ──────────────────────────────────────────────────
    def _services() -> Dict[str, Any]:
        rows: List[Dict[str, Any]] = []
        for s in core.list_service_for_all_namespaces().items:
            ext = _q(s, "status", "load_balancer", "ingress") or []
            ext_ips = [getattr(i, "ip", None) or getattr(i, "hostname", None) for i in ext]
            ports = [{"port": getattr(pp, "port", None),
                      "protocol": getattr(pp, "protocol", None),
                      "target": getattr(pp, "target_port", None)}
                     for pp in (_q(s, "spec", "ports") or [])]
            rows.append({
                "name": _q(s, "metadata", "name"),
                "namespace": _q(s, "metadata", "namespace"),
                "type": _q(s, "spec", "type"),
                "cluster_ip": _q(s, "spec", "cluster_ip"),
                "external_ip": [e for e in ext_ips if e] or None,
                "ports": ports,
            })
        return _cap(rows)
    props["services"] = collect_section(_services)

    def _ingress() -> Dict[str, Any]:
        rows: List[Dict[str, Any]] = []
        for ig in net.list_ingress_for_all_namespaces().items:
            rules = _q(ig, "spec", "rules") or []
            hosts = [getattr(r, "host", None) for r in rules if getattr(r, "host", None)]
            rows.append({
                "name": _q(ig, "metadata", "name"),
                "namespace": _q(ig, "metadata", "namespace"),
                "hosts": hosts,
                "rules_count": len(rules),
            })
        return _cap(rows)
    props["ingress"] = collect_section(_ingress)

    # ── storage: PVs, PVCs, storage classes ─────────────────────────────────
    def _pvs() -> Dict[str, Any]:
        rows = []
        for pv in core.list_persistent_volume().items:
            cap = _q(pv, "spec", "capacity") or {}
            rows.append({
                "name": _q(pv, "metadata", "name"),
                "capacity": cap.get("storage"),
                "storage_class": _q(pv, "spec", "storage_class_name"),
                "phase": _q(pv, "status", "phase"),
            })
        return _cap(rows)
    props["persistent_volumes"] = collect_section(_pvs)

    def _pvcs() -> Dict[str, Any]:
        rows = []
        for pvc in core.list_persistent_volume_claim_for_all_namespaces().items:
            cap = _q(pvc, "status", "capacity") or {}
            rows.append({
                "name": _q(pvc, "metadata", "name"),
                "namespace": _q(pvc, "metadata", "namespace"),
                "capacity": cap.get("storage"),
                "status": _q(pvc, "status", "phase"),
                "storage_class": _q(pvc, "spec", "storage_class_name"),
            })
        return _cap(rows)
    props["persistent_volume_claims"] = collect_section(_pvcs)

    def _storage_classes() -> Dict[str, Any]:
        rows = [{"name": _q(sc, "metadata", "name"),
                 "provisioner": getattr(sc, "provisioner", None)}
                for sc in storage_api.list_storage_class().items]
        return _cap(rows)
    props["storage_classes"] = collect_section(_storage_classes)

    # ── network policies (metadata only) ────────────────────────────────────
    def _netpol() -> Dict[str, Any]:
        rows = [{"name": _q(np, "metadata", "name"),
                 "namespace": _q(np, "metadata", "namespace")}
                for np in net.list_network_policy_for_all_namespaces().items]
        return _cap(rows)
    props["network_policies"] = collect_section(_netpol)

    return props
