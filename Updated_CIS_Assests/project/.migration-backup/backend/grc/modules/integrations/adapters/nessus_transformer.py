import logging
import hashlib
from datetime import datetime
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

NESSUS_SEVERITY_MAP = {
    0: "info",
    1: "low",
    2: "medium",
    3: "high",
    4: "critical",
}

COMPLIVERSE_SEVERITY_ORDER = {
    "critical": 4,
    "high": 3,
    "medium": 2,
    "low": 1,
    "info": 0,
}


def _iso_to_dt(val: Optional[str]) -> Optional[datetime]:
    if not val:
        return None
    try:
        if isinstance(val, (int, float)):
            return datetime.utcfromtimestamp(val)
        dt = datetime.fromisoformat(val.replace("Z", "+00:00"))
        if dt.tzinfo is not None:
            return dt.replace(tzinfo=None)
        return dt
    except Exception:
        return None


def _epoch_to_dt(val) -> Optional[datetime]:
    if not val:
        return None
    try:
        ts = int(val)
        if ts > 0:
            return datetime.utcfromtimestamp(ts)
    except (ValueError, TypeError, OSError):
        pass
    return None


def _compute_compliverse_severity(composite_score: float) -> str:
    if composite_score >= 9.0:
        return "critical"
    elif composite_score >= 7.0:
        return "high"
    elif composite_score >= 4.0:
        return "medium"
    elif composite_score >= 0.1:
        return "low"
    return "info"


class NessusTransformer:

    @staticmethod
    def compute_composite_risk(
        cvss_score: float = 0.0,
        nessus_severity: int = 0,
        asset_criticality: float = 5.0,
        framework_impact: float = 5.0,
        exploit_count: int = 0,
        first_detected: Optional[datetime] = None,
    ) -> float:
        cvss_norm = min(cvss_score, 10.0) if cvss_score else 0.0
        nessus_norm = min(nessus_severity * 2.5, 10.0)
        asset_norm = min(asset_criticality, 10.0) if asset_criticality else 5.0
        framework_norm = min(framework_impact, 10.0) if framework_impact else 5.0

        exploit_factor = 0.0
        if exploit_count and exploit_count > 0:
            exploit_factor = min(10.0, 5.0 + (exploit_count * 1.0))

        exposure_factor = 5.0
        if first_detected:
            days_open = (datetime.utcnow() - first_detected).days
            if days_open > 365:
                exposure_factor = 10.0
            elif days_open > 180:
                exposure_factor = 8.0
            elif days_open > 90:
                exposure_factor = 7.0
            elif days_open > 30:
                exposure_factor = 6.0
            else:
                exposure_factor = 4.0

        composite = (
            cvss_norm * 0.30
            + nessus_norm * 0.20
            + asset_norm * 0.20
            + framework_norm * 0.15
            + exploit_factor * 0.10
            + exposure_factor * 0.05
        )
        return round(min(composite, 10.0), 2)

    @staticmethod
    def generate_vuln_id(plugin_id: str, host_key: str, tenant_id: int) -> str:
        raw = f"{tenant_id}:nessus:{plugin_id}:{host_key}"
        return f"NS-{hashlib.md5(raw.encode()).hexdigest()[:12].upper()}"

    @staticmethod
    def _stable_asset_id(hostname: str, host_ip: str, tenant_id: int, asset_uuid: str = "") -> str:
        if asset_uuid:
            return f"nessus-{asset_uuid[:64]}"
        key = hostname or host_ip
        if not key:
            return f"nessus-unknown-{tenant_id}"
        raw = f"{tenant_id}:nessus:{key}"
        return f"nessus-{hashlib.sha256(raw.encode()).hexdigest()[:24]}"

    @staticmethod
    def transform_asset(raw: Dict[str, Any], connection_id: int, tenant_id: int) -> Dict[str, Any]:
        def _pick_from_value(val: Any) -> str:
            if isinstance(val, str) and val.strip():
                return val.strip()
            if isinstance(val, list):
                for item in val:
                    if isinstance(item, str) and item.strip():
                        return item.strip()
            return ""

        def pick_first(*values: Any) -> str:
            for val in values:
                picked = _pick_from_value(val)
                if picked:
                    return picked
            return ""

        scan_contexts = raw.get("_scan_contexts")
        scan_name = ""
        if scan_contexts and isinstance(scan_contexts, list):
            scan_name = pick_first(*(ctx.get("scan_name") for ctx in scan_contexts if isinstance(ctx, dict)))
        if not scan_name:
            scan_name = pick_first(raw.get("_scan_name"))

        raw_name = pick_first(
            raw.get("name"),
            raw.get("display_name"),
            raw.get("displayName"),
            raw.get("asset_name"),
            raw.get("device_name"),
            raw.get("computer_name"),
            raw.get("system_name"),
            raw.get("host-name"),
            raw.get("host_name"),
            raw.get("fqdn"),
            raw.get("dns_name"),
            raw.get("dns"),
            raw.get("netbios_name"),
            raw.get("netbios"),
            scan_name,
        )

        hostname = pick_first(raw.get("hostname"), raw.get("host-name"), raw_name)
        host_ip = pick_first(raw.get("host-ip"), raw.get("ipv4"), raw.get("ip"))

        asset_uuid = raw.get("_asset_uuid", "")
        source = raw.get("_source", "scan")

        if source == "workbench":
            sev_counts = raw.get("severity_counts", {})
            total_vulns = sum(sev_counts.values())
            critical_vulns = sev_counts.get("4", 0)
            severe_vulns = sev_counts.get("3", 0)
            moderate_vulns = sev_counts.get("2", 0)
            os_list = raw.get("operating_system", [])
            os_name = os_list[0] if os_list else ""
            last_scan = _iso_to_dt(raw.get("last_seen"))
            first_discovered = _iso_to_dt(raw.get("first_seen"))
            fqdn_list = raw.get("fqdn", [])
            ipv4_list = raw.get("ipv4", [])
            all_ips = ipv4_list if ipv4_list else ([host_ip] if host_ip else [])
            if not hostname and isinstance(fqdn_list, list) and fqdn_list:
                hostname = pick_first(fqdn_list[0])
            if not host_ip and isinstance(ipv4_list, list) and ipv4_list:
                host_ip = pick_first(ipv4_list[0])
        else:
            total_vulns = sum(raw.get(sev, 0) or 0 for sev in ("critical", "high", "medium", "low", "info"))
            critical_vulns = raw.get("critical", 0) or 0
            severe_vulns = raw.get("high", 0) or 0
            moderate_vulns = raw.get("medium", 0) or 0
            os_name = raw.get("operating-system") or raw.get("os", "") or ""
            last_scan = _epoch_to_dt(raw.get("host_end")) or _epoch_to_dt(raw.get("host_start"))
            first_discovered = _epoch_to_dt(raw.get("host_start"))
            all_ips = [host_ip] if host_ip else []

        external_id = NessusTransformer._stable_asset_id(hostname, host_ip, tenant_id, asset_uuid)

        site_name = ""
        if scan_contexts and isinstance(scan_contexts, list):
            site_name = ",".join(ctx.get("scan_name", "") for ctx in scan_contexts if ctx.get("scan_name"))
        else:
            site_name = raw.get("_scan_name", "")

        display_name = pick_first(raw_name, hostname)

        return {
            "external_asset_id": external_id,
            "name": display_name or host_ip or f"Nessus-Host-{external_id[:12]}",
            "ip_address": host_ip,
            "mac_address": "",
            "host_name": hostname or display_name,
            "operating_system": os_name,
            "external_risk_score": raw.get("score"),
            "is_assessed": True,
            "last_scan_date": last_scan,
            "first_discovered": first_discovered,
            "all_ips": all_ips,
            "all_macs": [],
            "nexpose_site": site_name,
            "total_vulns": total_vulns,
            "critical_vulns": critical_vulns,
            "severe_vulns": severe_vulns,
            "moderate_vulns": moderate_vulns,
            "scanner_source": "nessus",
            "scanner_connection_id": connection_id,
            "tenant_id": tenant_id,
        }

    @staticmethod
    def transform_vulnerability(
        vuln_data: Dict[str, Any],
        host_key: str,
        connection_id: int,
        tenant_id: int,
    ) -> Dict[str, Any]:
        plugin_id = str(vuln_data.get("plugin_id", ""))
        plugin_name = vuln_data.get("plugin_name") or vuln_data.get("plugin_name", f"Plugin {plugin_id}")
        severity = vuln_data.get("severity", 0)
        if isinstance(severity, str):
            try:
                severity = int(severity)
            except ValueError:
                severity = 0
        scanner_severity = NESSUS_SEVERITY_MAP.get(severity, "info")

        info = vuln_data.get("info") or {}
        if isinstance(info, dict):
            plugin_desc = info.get("plugindescription", {})
        else:
            plugin_desc = {}
        plugin_attrs = plugin_desc.get("pluginattributes", {})

        if not plugin_attrs:
            attrs = vuln_data.get("attributes") or {}
            if isinstance(attrs, dict) and attrs:
                plugin_attrs = attrs
                if not plugin_name or plugin_name == f"Plugin {plugin_id}":
                    plugin_name = attrs.get("plugin_name") or attrs.get("synopsis") or plugin_name
                if not severity and attrs.get("risk_factor"):
                    rf = attrs.get("risk_factor", "").lower()
                    severity = {"critical": 4, "high": 3, "medium": 2, "low": 1, "none": 0}.get(rf, severity)
                    scanner_severity = NESSUS_SEVERITY_MAP.get(severity, scanner_severity)

        risk_info = plugin_attrs.get("risk_information", {})

        cvss_v3_score = None
        cvss_v3_vector = None
        cvss_v2_score = None
        cvss_v2_vector = None

        try:
            cvss_v3_score = float(risk_info.get("cvss3_base_score", 0) or 0)
        except (ValueError, TypeError):
            cvss_v3_score = None
        try:
            cvss_v3_vector = risk_info.get("cvss3_vector")
        except Exception:
            pass
        try:
            cvss_v2_score = float(risk_info.get("cvss_base_score", 0) or 0)
        except (ValueError, TypeError):
            cvss_v2_score = None
        try:
            cvss_v2_vector = risk_info.get("cvss_vector")
        except Exception:
            pass

        best_cvss = cvss_v3_score or cvss_v2_score or 0.0

        description = ""
        synopsis = ""
        solution = ""
        see_also = ""
        plugin_output_text = ""

        if isinstance(info, dict):
            description = info.get("description", "") or plugin_attrs.get("description", "")
            synopsis = info.get("synopsis", "") or plugin_attrs.get("synopsis", "")
            solution = info.get("solution", "") or plugin_attrs.get("solution", "")
            see_also = info.get("see_also", "") or plugin_attrs.get("see_also", "")
            outputs = info.get("output") or info.get("plugin_output") or ""
            if isinstance(outputs, list):
                plugin_output_text = "\n".join(str(o) for o in outputs)
            else:
                plugin_output_text = str(outputs)

        ref_info = plugin_attrs.get("ref_information", {})
        refs = ref_info.get("ref", []) if isinstance(ref_info, dict) else []
        cve_ids = []
        if isinstance(refs, list):
            for ref in refs:
                if isinstance(ref, dict) and ref.get("name") == "cve":
                    vals = ref.get("values", [])
                    if isinstance(vals, list):
                        for v in vals:
                            if isinstance(v, dict):
                                cve_ids.append(v.get("value", ""))
                            elif isinstance(v, str):
                                cve_ids.append(v)

        vuln_info = plugin_attrs.get("vuln_information", {})
        exploit_available = False
        exploitability = vuln_info.get("exploitability_ease", "")
        if exploitability and "available" in str(exploitability).lower():
            exploit_available = True
        exploit_count = 1 if exploit_available else 0

        first_detected = _epoch_to_dt(vuln_data.get("_host_start"))
        last_seen = _epoch_to_dt(vuln_data.get("_host_end"))

        generated_id = NessusTransformer.generate_vuln_id(plugin_id, host_key, tenant_id)

        composite = NessusTransformer.compute_composite_risk(
            cvss_score=best_cvss,
            nessus_severity=severity,
            exploit_count=exploit_count,
            first_detected=first_detected,
        )

        full_description = ""
        if synopsis:
            full_description += f"Synopsis: {synopsis}\n\n"
        if description:
            full_description += description

        categories = []
        plugin_family = vuln_data.get("plugin_family") or plugin_desc.get("pluginfamily", "")
        if plugin_family:
            categories.append(plugin_family)

        return {
            "vuln_id": generated_id,
            "external_vuln_id": plugin_id,
            "title": plugin_name,
            "description": full_description.strip() or f"Nessus Plugin {plugin_id}",
            "severity": scanner_severity,
            "cvss_score": best_cvss,
            "cvss_vector": cvss_v3_vector or cvss_v2_vector,
            "cvss_v3_score": cvss_v3_score,
            "cvss_v3_vector": cvss_v3_vector,
            "cvss_v2_score": cvss_v2_score,
            "cvss_v2_vector": cvss_v2_vector,
            "nexpose_risk_score": None,
            "scanner_severity": scanner_severity,
            "compliverse_risk_score": composite,
            "compliverse_severity": _compute_compliverse_severity(composite),
            "cve_id": cve_ids[0] if cve_ids else None,
            "cve_ids": cve_ids if cve_ids else None,
            "published_date": _epoch_to_dt(plugin_attrs.get("plugin_information", {}).get("plugin_publication_date")),
            "modified_date": _epoch_to_dt(plugin_attrs.get("plugin_information", {}).get("plugin_modification_date")),
            "added_to_scanner": None,
            "categories": categories,
            "known_exploits": [{"source": "nessus", "available": True}] if exploit_available else None,
            "exploit_count": exploit_count,
            "malware_kits": None,
            "is_dos": "denial of service" in (plugin_name or "").lower() or "denial of service" in (description or "").lower(),
            "pci_status": None,
            "pci_severity": None,
            "scanner_status": "present",
            "status": "open",
            "proof": plugin_output_text[:2000] if plugin_output_text else None,
            "result_key": f"nessus:{plugin_id}",
            "first_detected": first_detected,
            "last_seen": last_seen,
            "times_detected": vuln_data.get("count", 1),
            "affected_host": host_key,
            "source": "nessus",
            "connection_id": connection_id,
            "tenant_id": tenant_id,
        }

    @staticmethod
    def map_scanner_status(scanner_status: str) -> str:
        mapping = {
            "present": "open",
            "active": "open",
            "resurfaced": "open",
            "new": "open",
            "fixed": "closed_scanner",
            "removed": "closed_scanner",
        }
        return mapping.get(scanner_status.lower(), "open") if scanner_status else "open"

    @staticmethod
    def transform_solution(
        raw: Dict[str, Any],
        vulnerability_id: int,
        tenant_id: int,
    ) -> Dict[str, Any]:
        return {
            "tenant_id": tenant_id,
            "vulnerability_id": vulnerability_id,
            "external_solution_id": str(raw.get("id", "")),
            "remediation_summary": raw.get("summary", ""),
            "remediation_steps": raw.get("steps", ""),
            "solution_type": raw.get("type", "remediation"),
            "remediation_estimate": None,
            "additional_info": raw.get("see_also", ""),
            "applies_to": None,
        }

    @staticmethod
    def transform_scan(raw: Dict[str, Any], connection_id: int, tenant_id: int) -> Dict[str, Any]:
        start_time = _epoch_to_dt(raw.get("starttime") or raw.get("creation_date"))
        end_time = _epoch_to_dt(raw.get("last_modification_date"))

        duration_ms = None
        if start_time and end_time:
            duration_ms = int((end_time - start_time).total_seconds() * 1000)

        return {
            "tenant_id": tenant_id,
            "connection_id": connection_id,
            "external_scan_id": str(raw.get("id", "")),
            "scan_name": raw.get("name"),
            "scan_type": raw.get("type"),
            "start_time": start_time,
            "end_time": end_time,
            "duration_ms": duration_ms,
            "scan_status": raw.get("status"),
            "assets_scanned": raw.get("hostcount"),
            "engine_name": raw.get("scanner_name"),
            "vulns_found": None,
        }
