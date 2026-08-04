import logging
import hashlib
from datetime import datetime
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

NEXPOSE_SEVERITY_MAP = {
    1: "info",
    2: "info",
    3: "low",
    4: "low",
    5: "medium",
    6: "medium",
    7: "high",
    8: "critical",
    9: "critical",
    10: "critical",
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
        dt = datetime.fromisoformat(val.replace("Z", "+00:00"))
        if dt.tzinfo is not None:
            return dt.replace(tzinfo=None)
        return dt
    except Exception:
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


class Rapid7Transformer:

    @staticmethod
    def compute_composite_risk(
        cvss_score: float = 0.0,
        nexpose_risk: float = 0.0,
        asset_criticality: float = 5.0,
        framework_impact: float = 5.0,
        exploit_count: int = 0,
        first_detected: Optional[datetime] = None,
    ) -> float:
        cvss_norm = min(cvss_score, 10.0) if cvss_score else 0.0
        nexpose_norm = min(nexpose_risk / 100.0, 10.0) if nexpose_risk else 0.0
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
            + nexpose_norm * 0.20
            + asset_norm * 0.20
            + framework_norm * 0.15
            + exploit_factor * 0.10
            + exposure_factor * 0.05
        )
        return round(min(composite, 10.0), 2)

    @staticmethod
    def generate_vuln_id(external_vuln_id: str, asset_id: str, tenant_id: int) -> str:
        raw = f"{tenant_id}:{external_vuln_id}:{asset_id}"
        return f"NX-{hashlib.md5(raw.encode()).hexdigest()[:12].upper()}"

    @staticmethod
    def transform_asset(raw: Dict[str, Any], connection_id: int, tenant_id: int) -> Dict[str, Any]:
        addresses = raw.get("addresses", [])
        ips = [a.get("ip") for a in addresses if a.get("ip")]
        macs = [a.get("mac") for a in addresses if a.get("mac")]
        primary_ip = ips[0] if ips else raw.get("ip", "")
        primary_mac = macs[0] if macs else ""

        os_info = raw.get("os", {}) or {}
        os_name = raw.get("osFingerprint", {}).get("description") or os_info.get("description", "")

        vuln_counts = raw.get("vulnerabilities", {}) or {}

        return {
            "external_asset_id": str(raw.get("id", "")),
            "name": raw.get("hostName") or raw.get("ip") or f"Asset-{raw.get('id', '')}",
            "ip_address": primary_ip,
            "mac_address": primary_mac,
            "host_name": raw.get("hostName", ""),
            "operating_system": os_name,
            "external_risk_score": raw.get("riskScore"),
            "is_assessed": raw.get("assessedForVulnerabilities", False),
            "last_scan_date": _iso_to_dt(raw.get("history", [{}])[-1].get("date")) if raw.get("history") else None,
            "first_discovered": _iso_to_dt(raw.get("history", [{}])[0].get("date")) if raw.get("history") else None,
            "all_ips": ips,
            "all_macs": macs,
            "nexpose_site": ",".join(str(s) for s in raw.get("sites", [])) if raw.get("sites") else None,
            "total_vulns": vuln_counts.get("total", 0),
            "critical_vulns": vuln_counts.get("critical", 0),
            "severe_vulns": vuln_counts.get("severe", 0),
            "moderate_vulns": vuln_counts.get("moderate", 0),
            "scanner_source": "nexpose",
            "scanner_connection_id": connection_id,
            "tenant_id": tenant_id,
        }

    @staticmethod
    def transform_vulnerability(
        vuln_detail: Dict[str, Any],
        instance: Dict[str, Any],
        asset_external_id: str,
        connection_id: int,
        tenant_id: int,
    ) -> Dict[str, Any]:
        vuln_id_raw = vuln_detail.get("id", instance.get("id", ""))

        cvss_v3 = vuln_detail.get("cvss", {}).get("v3", {}) or {}
        cvss_v2 = vuln_detail.get("cvss", {}).get("v2", {}) or {}

        cvss_v3_score = cvss_v3.get("score")
        cvss_v2_score = cvss_v2.get("score")
        best_cvss = cvss_v3_score or cvss_v2_score or 0.0

        nexpose_risk = vuln_detail.get("riskScore", 0)
        severity_int = vuln_detail.get("severity", 0)
        scanner_severity = NEXPOSE_SEVERITY_MAP.get(severity_int, "info")

        exploit_info = vuln_detail.get("exploits", []) or []
        exploit_count = len(exploit_info) if isinstance(exploit_info, list) else 0

        cves = vuln_detail.get("cves", []) or []

        generated_id = Rapid7Transformer.generate_vuln_id(str(vuln_id_raw), asset_external_id, tenant_id)

        first_detected = _iso_to_dt(instance.get("since"))

        composite = Rapid7Transformer.compute_composite_risk(
            cvss_score=best_cvss,
            nexpose_risk=nexpose_risk,
            exploit_count=exploit_count,
            first_detected=first_detected,
        )

        status = instance.get("status", "")
        mapped_status = Rapid7Transformer.map_scanner_status(status)

        return {
            "vuln_id": generated_id,
            "external_vuln_id": str(vuln_id_raw),
            "title": vuln_detail.get("title", f"Vulnerability {vuln_id_raw}"),
            "description": vuln_detail.get("description", {}).get("text", "") if isinstance(vuln_detail.get("description"), dict) else vuln_detail.get("description", ""),
            "severity": scanner_severity,
            "cvss_score": best_cvss,
            "cvss_vector": cvss_v3.get("vector") or cvss_v2.get("vector"),
            "cvss_v3_score": cvss_v3_score,
            "cvss_v3_vector": cvss_v3.get("vector"),
            "cvss_v2_score": cvss_v2_score,
            "cvss_v2_vector": cvss_v2.get("vector"),
            "nexpose_risk_score": nexpose_risk,
            "scanner_severity": scanner_severity,
            "compliverse_risk_score": composite,
            "compliverse_severity": _compute_compliverse_severity(composite),
            "cve_id": cves[0] if cves else None,
            "cve_ids": cves,
            "published_date": _iso_to_dt(vuln_detail.get("published")),
            "modified_date": _iso_to_dt(vuln_detail.get("modified")),
            "added_to_scanner": _iso_to_dt(vuln_detail.get("added")),
            "categories": vuln_detail.get("categories", []),
            "known_exploits": exploit_info if exploit_info else None,
            "exploit_count": exploit_count,
            "malware_kits": vuln_detail.get("malwareKits"),
            "is_dos": vuln_detail.get("denialOfService", False),
            "pci_status": vuln_detail.get("pci", {}).get("status") if vuln_detail.get("pci") else None,
            "pci_severity": vuln_detail.get("pci", {}).get("severity") if vuln_detail.get("pci") else None,
            "scanner_status": status,
            "status": mapped_status,
            "proof": instance.get("proof"),
            "result_key": instance.get("key"),
            "first_detected": first_detected,
            "last_seen": _iso_to_dt(instance.get("lastFound")),
            "times_detected": instance.get("timesFound", 0),
            "affected_host": asset_external_id,
            "source": "nexpose",
            "connection_id": connection_id,
            "tenant_id": tenant_id,
        }

    @staticmethod
    def map_scanner_status(scanner_status: str) -> str:
        mapping = {
            "vulnerable-version": "open",
            "vulnerable-exploited": "open",
            "vulnerable": "open",
            "invulnerable": "closed_scanner",
            "not-vulnerable": "closed_scanner",
            "exception-vuln-expl": "risk_accepted",
            "exception-vuln-version": "risk_accepted",
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
            "remediation_summary": raw.get("summary", {}).get("text", "") if isinstance(raw.get("summary"), dict) else raw.get("summary", ""),
            "remediation_steps": raw.get("steps", {}).get("text", "") if isinstance(raw.get("steps"), dict) else raw.get("steps", ""),
            "solution_type": raw.get("type"),
            "remediation_estimate": raw.get("estimate"),
            "additional_info": raw.get("additionalInformation", {}).get("text", "") if isinstance(raw.get("additionalInformation"), dict) else raw.get("additionalInformation"),
            "applies_to": raw.get("appliesTo"),
        }

    @staticmethod
    def transform_scan(raw: Dict[str, Any], connection_id: int, tenant_id: int) -> Dict[str, Any]:
        return {
            "tenant_id": tenant_id,
            "connection_id": connection_id,
            "external_scan_id": str(raw.get("id", "")),
            "scan_name": raw.get("scanName") or raw.get("name"),
            "scan_type": raw.get("scanType") or raw.get("type"),
            "start_time": _iso_to_dt(raw.get("startTime")),
            "end_time": _iso_to_dt(raw.get("endTime")),
            "duration_ms": raw.get("duration"),
            "scan_status": raw.get("status"),
            "assets_scanned": raw.get("assets"),
            "engine_name": raw.get("engineName"),
            "vulns_found": raw.get("vulnerabilities", {}).get("total") if isinstance(raw.get("vulnerabilities"), dict) else raw.get("vulnerabilities"),
        }
