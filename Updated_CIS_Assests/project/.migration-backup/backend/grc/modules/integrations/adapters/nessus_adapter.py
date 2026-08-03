import logging
import os
import time
from typing import Any, Dict, List, Optional

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

from .base_adapter import BaseAdapter, ConnectionTestResult, PagedResponse

logger = logging.getLogger(__name__)

DEFAULT_TIMEOUT = 30
MAX_RETRIES = 3
RETRY_BACKOFF = 1.0
RATE_LIMIT_SLEEP = 1.0


class NessusAdapter(BaseAdapter):

    API_PREFIX = ""

    def __init__(self, console_url: str, console_port: int, credentials: Dict[str, str], verify_ssl: bool = False):
        super().__init__(console_url, console_port, credentials, verify_ssl)
        self.session = self._build_session()
        self._debug_payloads = os.environ.get("INTEGRATIONS_DEBUG_PAYLOADS", "true").lower() == "true"

    def _debug_shape(self, label: str, payload: Any):
        if not self._debug_payloads:
            return
        try:
            if isinstance(payload, dict):
                keys = sorted(list(payload.keys()))
                logger.info("NESSUS_DEBUG %s dict_keys=%s", label, keys)
                for list_key in ("scans", "hosts", "vulnerabilities", "assets"):
                    if list_key in payload and isinstance(payload[list_key], list):
                        items = payload[list_key]
                        sample_keys = sorted(list(items[0].keys())) if items and isinstance(items[0], dict) else []
                        logger.info(
                            "NESSUS_DEBUG %s.%s count=%s sample_keys=%s",
                            label,
                            list_key,
                            len(items),
                            sample_keys,
                        )
            elif isinstance(payload, list):
                sample_keys = sorted(list(payload[0].keys())) if payload and isinstance(payload[0], dict) else []
                logger.info("NESSUS_DEBUG %s list_count=%s sample_keys=%s", label, len(payload), sample_keys)
            else:
                logger.info("NESSUS_DEBUG %s payload_type=%s", label, type(payload).__name__)
        except Exception as e:
            logger.warning("NESSUS_DEBUG failed for %s: %s", label, e)

    def _build_session(self) -> requests.Session:
        s = requests.Session()
        s.verify = self.verify_ssl

        access_key = self.credentials.get("access_key", "")
        secret_key = self.credentials.get("secret_key", "")
        api_key = self.credentials.get("api_key", "")
        username = self.credentials.get("username", "")
        password = self.credentials.get("password", "")

        if access_key and secret_key:
            s.headers["X-ApiKeys"] = f"accessKey={access_key}; secretKey={secret_key}"
        elif api_key:
            s.headers["X-ApiKeys"] = f"accessKey={api_key}; secretKey={secret_key}"

        self._username = username
        self._password = password
        self._token = None

        s.headers["Accept"] = "application/json"
        s.headers["Content-Type"] = "application/json"

        retry = Retry(
            total=MAX_RETRIES,
            backoff_factor=RETRY_BACKOFF,
            status_forcelist=[429, 500, 502, 503, 504],
            allowed_methods=["GET", "POST", "PUT", "DELETE"],
        )
        adapter = HTTPAdapter(max_retries=retry)
        s.mount("https://", adapter)
        s.mount("http://", adapter)

        return s

    def _ensure_token(self):
        if self._token:
            return
        if not self._username or not self._password:
            return
        if "X-ApiKeys" in self.session.headers:
            return
        try:
            url = f"{self.base_url}/session"
            resp = self.session.post(url, json={
                "username": self._username,
                "password": self._password,
            }, timeout=DEFAULT_TIMEOUT)
            resp.raise_for_status()
            self._token = resp.json().get("token")
            if self._token:
                self.session.headers["X-Cookie"] = f"token={self._token}"
        except Exception as e:
            logger.error(f"Nessus session login failed: {e}")

    def _url(self, path: str) -> str:
        return f"{self.base_url}{path}"

    def _request(self, method: str, path: str, params: Optional[Dict] = None,
                 json_body: Optional[Dict] = None, timeout: int = DEFAULT_TIMEOUT) -> Any:
        self._ensure_token()
        url = self._url(path)
        try:
            if self._debug_payloads:
                logger.info("NESSUS_API_REQUEST method=%s path=%s params=%s", method, path, params)
            resp = self.session.request(method, url, params=params, json=json_body, timeout=timeout)

            if resp.status_code == 429:
                retry_after = int(resp.headers.get("Retry-After", 5))
                logger.warning(f"Rate limited on {path}, sleeping {retry_after}s")
                time.sleep(retry_after)
                resp = self.session.request(method, url, params=params, json=json_body, timeout=timeout)

            resp.raise_for_status()
            if resp.status_code == 204:
                return {}
            data = resp.json()
            if self._debug_payloads:
                if isinstance(data, dict):
                    logger.info("NESSUS_API_RESPONSE status=%s path=%s keys=%s", resp.status_code, path, sorted(list(data.keys())))
                elif isinstance(data, list):
                    sample_keys = sorted(list(data[0].keys())) if data and isinstance(data[0], dict) else []
                    logger.info("NESSUS_API_RESPONSE status=%s path=%s list_count=%s sample_keys=%s", resp.status_code, path, len(data), sample_keys)
                else:
                    logger.info("NESSUS_API_RESPONSE status=%s path=%s payload_type=%s", resp.status_code, path, type(data).__name__)
            return data
        except requests.exceptions.Timeout:
            logger.error(f"Timeout calling {method} {url}")
            raise
        except requests.exceptions.ConnectionError as e:
            logger.error(f"Connection error for {url}: {e}")
            raise
        except requests.exceptions.HTTPError as e:
            logger.error(f"HTTP {resp.status_code} from {url}: {resp.text[:500]}")
            raise

    def _get(self, path: str, params: Optional[Dict] = None, timeout: int = DEFAULT_TIMEOUT) -> Any:
        return self._request("GET", path, params=params, timeout=timeout)

    def _post(self, path: str, json_body: Optional[Dict] = None, timeout: int = DEFAULT_TIMEOUT) -> Any:
        return self._request("POST", path, json_body=json_body, timeout=timeout)

    def _put(self, path: str, json_body: Optional[Dict] = None, timeout: int = DEFAULT_TIMEOUT) -> Any:
        return self._request("PUT", path, json_body=json_body, timeout=timeout)

    def _delete(self, path: str, timeout: int = DEFAULT_TIMEOUT) -> Any:
        return self._request("DELETE", path, timeout=timeout)

    def test_connection(self) -> ConnectionTestResult:
        try:
            try:
                status_data = self._get("/server/status", timeout=10)
                server_status = status_data.get("status", "unknown")
            except Exception:
                server_status = "unknown"

            info = self._get("/server/properties", timeout=15)
            return ConnectionTestResult(
                success=True,
                message="Connected to Nessus scanner",
                server_version=info.get("server_version") or info.get("nessus_ui_version"),
                details={
                    "nessus_type": info.get("nessus_type"),
                    "server_uuid": info.get("server_uuid"),
                    "server_status": server_status,
                    "loaded_plugin_set": info.get("loaded_plugin_set"),
                    "feed": info.get("feed"),
                    "platform": info.get("platform"),
                },
            )
        except requests.exceptions.ConnectionError:
            return ConnectionTestResult(success=False, message="Cannot reach Nessus scanner — check URL/port")
        except requests.exceptions.HTTPError as e:
            status = getattr(e.response, "status_code", None)
            if status == 401:
                return ConnectionTestResult(success=False, message="Authentication failed — check API keys or credentials")
            if status == 403:
                return ConnectionTestResult(success=False, message="Access forbidden — check API key permissions")
            return ConnectionTestResult(success=False, message=f"HTTP {status} from scanner")
        except Exception as e:
            return ConnectionTestResult(success=False, message=f"Unexpected error: {str(e)[:200]}")

    def get_scans(self, active_only: bool = False) -> List[Dict[str, Any]]:
        data = self._get("/scans")
        self._debug_shape("get_scans.response", data)
        scans = data.get("scans") or []
        if active_only:
            scans = [s for s in scans if s.get("status") == "running"]
        self._debug_shape("get_scans.scans", scans)
        return scans

    def get_scan_detail(self, scan_id: str) -> Dict[str, Any]:
        detail = self._get(f"/scans/{scan_id}")
        self._debug_shape(f"get_scan_detail.{scan_id}", detail)
        return detail

    def _get_workbench_assets(self, page: int, page_size: int) -> Optional[PagedResponse]:
        try:
            params = {
                "date_range": 90,
                "filter.search_type": "and",
            }
            data = self._get("/workbenches/assets", params=params, timeout=60)
            assets = data.get("assets") or []

            enriched = []
            for asset in assets:
                asset_id = asset.get("id", "")
                fqdn_list = [f.get("fqdn", "") for f in (asset.get("fqdn") or []) if f.get("fqdn")]
                ipv4_list = [i.get("address", "") for i in (asset.get("ipv4") or []) if i.get("address")]
                hostname = fqdn_list[0] if fqdn_list else (ipv4_list[0] if ipv4_list else str(asset_id))

                enriched.append({
                    "id": asset_id,
                    "hostname": hostname,
                    "host-ip": ipv4_list[0] if ipv4_list else "",
                    "fqdn": fqdn_list,
                    "ipv4": ipv4_list,
                    "operating_system": [o.get("name", "") for o in (asset.get("operating_system") or [])],
                    "severity_counts": {str(s.get("level", "")): s.get("count", 0) for s in (asset.get("severities") or [])},
                    "last_seen": asset.get("last_seen"),
                    "first_seen": asset.get("first_seen"),
                    "has_agent": asset.get("has_agent", False),
                    "_source": "workbench",
                    "_asset_uuid": asset_id,
                })

            start = page * page_size
            end = start + page_size
            page_data = enriched[start:end]

            return PagedResponse(
                data=page_data,
                total_records=len(enriched),
                page=page,
                page_size=page_size,
                has_more=end < len(enriched),
            )
        except Exception as e:
            logger.warning(f"Workbench assets endpoint unavailable, falling back to scan-based: {e}")
            return None

    def _get_scan_based_assets(self, page: int, page_size: int) -> PagedResponse:
        all_hosts = []
        scans = self.get_scans()
        self._debug_shape("scan_based_assets.scans", scans)

        for scan in scans:
            scan_id = scan.get("id")
            if not scan_id:
                continue
            status = scan.get("status", "")
            if status in ("empty", "imported"):
                continue
            try:
                detail = self.get_scan_detail(str(scan_id))
                hosts = detail.get("hosts") or []
                self._debug_shape(f"scan_based_assets.scan_{scan_id}.hosts", hosts)
                for host in hosts:
                    host["_scan_id"] = scan_id
                    host["_scan_name"] = scan.get("name", "")
                all_hosts.extend(hosts)
            except Exception as e:
                logger.warning(f"Failed to get hosts from scan {scan_id}: {e}")

        merged: Dict[str, Dict] = {}
        for host in all_hosts:
            hostname = host.get("hostname") or host.get("host-ip") or ""
            if not hostname:
                continue

            if hostname not in merged:
                merged[hostname] = {
                    **host,
                    "_scan_contexts": [{
                        "scan_id": host.get("_scan_id"),
                        "host_id": host.get("host_id"),
                        "scan_name": host.get("_scan_name", ""),
                    }],
                    "_source": "scan",
                }
            else:
                existing = merged[hostname]
                for sev in ("critical", "high", "medium", "low", "info"):
                    existing[sev] = max(existing.get(sev) or 0, host.get(sev) or 0)
                existing["_scan_contexts"].append({
                    "scan_id": host.get("_scan_id"),
                    "host_id": host.get("host_id"),
                    "scan_name": host.get("_scan_name", ""),
                })

        unique_hosts = list(merged.values())
        start = page * page_size
        end = start + page_size
        page_data = unique_hosts[start:end]

        return PagedResponse(
            data=page_data,
            total_records=len(unique_hosts),
            page=page,
            page_size=page_size,
            has_more=end < len(unique_hosts),
        )

    def get_assets(self, page: int = 0, page_size: int = 500) -> PagedResponse:
        result = self._get_workbench_assets(page, page_size)
        if result is not None:
            return result
        return self._get_scan_based_assets(page, page_size)

    def _get_workbench_vulns_for_asset(self, asset_uuid: str) -> Optional[List[Dict[str, Any]]]:
        try:
            params = {"date_range": 90}
            data = self._get(f"/workbenches/assets/{asset_uuid}/vulnerabilities", params=params, timeout=60)
            vulns = data.get("vulnerabilities") or []
            enriched = []
            for v in vulns:
                plugin_id = v.get("plugin_id", "")
                plugin_name = v.get("plugin_name", "")
                severity = v.get("severity", 0)
                count = v.get("count", 1)
                enriched.append({
                    "plugin_id": plugin_id,
                    "plugin_name": plugin_name,
                    "severity": severity,
                    "count": count,
                    "_asset_uuid": asset_uuid,
                    "_source": "workbench",
                })
            return enriched
        except Exception as e:
            logger.warning(f"Workbench asset vulns endpoint unavailable for {asset_uuid}: {e}")
            return None

    def get_asset_vulnerabilities(self, asset_id: str, scan_contexts: Optional[List[Dict]] = None, hostname: str = "", ip_address: str = "") -> List[Dict[str, Any]]:
        if asset_id.startswith("nessus-") and not asset_id.startswith("nessus-local-"):
            uuid_part = asset_id[len("nessus-"):]
            if len(uuid_part) > 24:
                wb_vulns = self._get_workbench_vulns_for_asset(uuid_part)
                if wb_vulns is not None:
                    return wb_vulns

        if scan_contexts:
            return self._get_vulns_from_scan_contexts(scan_contexts)

        lookup_key = hostname or ip_address
        if lookup_key:
            return self._get_vulns_by_host_lookup(lookup_key)

        return []

    def _get_vulns_by_host_lookup(self, host_key: str) -> List[Dict[str, Any]]:
        all_vulns = []
        seen_plugins: set = set()
        scans = self.get_scans()

        for scan in scans:
            scan_id = scan.get("id")
            if not scan_id:
                continue
            status = scan.get("status", "")
            if status in ("empty", "imported"):
                continue
            try:
                detail = self.get_scan_detail(str(scan_id))
                for host in (detail.get("hosts") or []):
                    h_name = host.get("hostname") or host.get("host-ip") or ""
                    if h_name != host_key:
                        continue
                    host_id = host.get("host_id")
                    if host_id is None:
                        continue
                    try:
                        host_detail = self._get(f"/scans/{scan_id}/hosts/{host_id}")
                        for v in (host_detail.get("vulnerabilities") or []):
                            pid = str(v.get("plugin_id", ""))
                            if pid in seen_plugins:
                                continue
                            seen_plugins.add(pid)
                            v["_scan_id"] = scan_id
                            v["_host_id"] = host_id
                            v["_host_ip"] = h_name
                            all_vulns.append(v)
                    except Exception as e:
                        logger.warning(f"Error getting host {host_id} vulns in scan {scan_id}: {e}")
            except Exception as e:
                logger.warning(f"Error getting scan {scan_id} detail: {e}")

        return all_vulns

    def _get_vulns_from_scan_contexts(self, scan_contexts: List[Dict]) -> List[Dict[str, Any]]:
        all_vulns = []
        seen_plugins: set = set()
        self._debug_shape("scan_contexts.input", scan_contexts)

        for ctx in scan_contexts:
            scan_id = ctx.get("scan_id")
            host_id = ctx.get("host_id")
            if not scan_id or not host_id:
                continue
            try:
                host_detail = self._get(f"/scans/{scan_id}/hosts/{host_id}")
            except Exception as e:
                logger.error(f"Failed to get host {host_id} detail from scan {scan_id}: {e}")
                continue

            vulns = host_detail.get("vulnerabilities") or []
            self._debug_shape(f"scan_contexts.scan_{scan_id}.host_{host_id}.vulns", vulns)
            for v in vulns:
                plugin_id = v.get("plugin_id")
                if str(plugin_id) in seen_plugins:
                    continue
                seen_plugins.add(str(plugin_id))
                v["_scan_id"] = scan_id
                v["_host_id"] = host_id
                v["_host_ip"] = ctx.get("hostname", "")
                all_vulns.append(v)

        return all_vulns

    def _get_workbench_vulns(self, page: int, page_size: int) -> Optional[PagedResponse]:
        try:
            params = {
                "date_range": 90,
                "filter.search_type": "and",
            }
            data = self._get("/workbenches/vulnerabilities", params=params, timeout=120)
            vulns = data.get("vulnerabilities") or []

            enriched = []
            for v in vulns:
                plugin_id = v.get("plugin_id", "")
                plugin_name = v.get("plugin_name", "")
                severity = v.get("severity", 0)
                count = v.get("count", 1)
                enriched.append({
                    "plugin_id": plugin_id,
                    "plugin_name": plugin_name,
                    "severity": severity,
                    "count": count,
                    "_source": "workbench",
                })

            start = page * page_size
            end = start + page_size
            page_data = enriched[start:end]

            return PagedResponse(
                data=page_data,
                total_records=len(enriched),
                page=page,
                page_size=page_size,
                has_more=end < len(enriched),
            )
        except Exception as e:
            logger.warning(f"Workbench vulnerabilities endpoint unavailable, falling back to scan-based: {e}")
            return None

    def _get_scan_based_vulns(self, page: int, page_size: int) -> PagedResponse:
        all_vulns = []
        scans = self.get_scans()

        for scan in scans:
            scan_id = scan.get("id")
            if not scan_id:
                continue
            status = scan.get("status", "")
            if status in ("empty", "imported"):
                continue
            try:
                detail = self.get_scan_detail(str(scan_id))
                for host in (detail.get("hosts") or []):
                    host_id = host.get("host_id")
                    if host_id is None:
                        continue
                    try:
                        host_detail = self._get(f"/scans/{scan_id}/hosts/{host_id}")
                        for v in (host_detail.get("vulnerabilities") or []):
                            v["_scan_id"] = scan_id
                            v["_host_id"] = host_id
                            v["_host_ip"] = host.get("hostname") or host.get("host-ip", "")
                            all_vulns.append(v)
                    except Exception as e:
                        logger.warning(f"Error getting host {host_id} vulns: {e}")
            except Exception as e:
                logger.warning(f"Error getting scan {scan_id} detail: {e}")

        start = page * page_size
        end = start + page_size
        page_data = all_vulns[start:end]

        return PagedResponse(
            data=page_data,
            total_records=len(all_vulns),
            page=page,
            page_size=page_size,
            has_more=end < len(all_vulns),
        )

    def get_vulnerabilities(self, page: int = 0, page_size: int = 500) -> PagedResponse:
        result = self._get_workbench_vulns(page, page_size)
        if result is not None:
            return result
        return self._get_scan_based_vulns(page, page_size)

    def get_vulnerability_detail(self, vuln_id: str) -> Dict[str, Any]:
        parts = vuln_id.split(":", 2)
        if len(parts) != 3:
            return {"plugin_id": vuln_id}

        scan_id, host_id, plugin_id = parts
        try:
            plugin_output = self._get(f"/scans/{scan_id}/hosts/{host_id}/plugins/{plugin_id}")
            return plugin_output
        except Exception as e:
            logger.error(f"Failed to get plugin detail {vuln_id}: {e}")
            return {"plugin_id": plugin_id}

    def get_plugin_detail(self, plugin_id: str) -> Dict[str, Any]:
        try:
            return self._get(f"/plugins/plugin/{plugin_id}")
        except Exception as e:
            logger.error(f"Failed to get plugin {plugin_id}: {e}")
            return {"id": plugin_id}

    def get_solutions(self, vuln_id: str) -> List[Dict[str, Any]]:
        parts = vuln_id.split(":", 2)
        if len(parts) == 3:
            detail = self.get_vulnerability_detail(vuln_id)
        else:
            detail = self.get_plugin_detail(vuln_id)

        info = detail.get("info") or detail.get("attributes") or {}
        if isinstance(info, dict):
            plugin_details = info.get("plugindescription", {}).get("pluginattributes", {})
        else:
            plugin_details = {}
        solution = plugin_details.get("solution") or (info.get("solution", "") if isinstance(info, dict) else "")
        see_also = plugin_details.get("see_also") or (info.get("see_also", "") if isinstance(info, dict) else "")

        if not solution and not see_also:
            return []

        return [{
            "id": f"nessus-sol-{vuln_id}",
            "summary": solution,
            "steps": solution,
            "type": "remediation",
            "see_also": see_also,
        }]

    def create_exception(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        plugin_id = payload.get("scope", {}).get("vulnerability", "")
        host = payload.get("scope", {}).get("host", "")
        comment = payload.get("comment", "")[:200]
        reason = payload.get("reason", "Other")
        expires = payload.get("expires")

        rule_payload: Dict[str, Any] = {
            "plugin_id": int(plugin_id) if plugin_id and str(plugin_id).isdigit() else 0,
            "type": "exclude",
        }
        if host:
            rule_payload["host"] = host
        if expires:
            rule_payload["date"] = expires

        try:
            result = self._post("/plugin-rules", json_body=rule_payload)
            rule_id = result.get("id") or result.get("rule_id", "")
            logger.info(f"Created Nessus plugin rule {rule_id} for plugin {plugin_id}: {reason} - {comment}")
            return {
                "id": str(rule_id),
                "status": "created",
                "type": "plugin_rule",
                "plugin_id": plugin_id,
            }
        except Exception as e:
            logger.warning(f"Failed to create Nessus plugin rule for plugin {plugin_id}: {e}")
            logger.info(f"Nessus exception recorded locally: plugin={plugin_id}, reason={reason}, comment={comment}")
            return {
                "id": f"nessus-local-{plugin_id}",
                "status": "logged_locally",
                "message": f"Plugin rule creation failed ({str(e)[:100]}). Exception recorded in ComplyVerse.",
            }

    def delete_exception(self, exception_id: str) -> bool:
        if exception_id.startswith("nessus-local-"):
            logger.info(f"Nessus local-only exception deletion: {exception_id}")
            return True
        try:
            self._delete(f"/plugin-rules/{exception_id}")
            logger.info(f"Deleted Nessus plugin rule {exception_id}")
            return True
        except Exception as e:
            logger.error(f"Failed to delete Nessus plugin rule {exception_id}: {e}")
            return False

    def get_folders(self) -> List[Dict[str, Any]]:
        data = self._get("/folders")
        return data.get("folders") or []

    def get_policies(self) -> List[Dict[str, Any]]:
        data = self._get("/policies")
        return data.get("policies") or []

    def export_scan(self, scan_id: str, format: str = "nessus") -> Dict[str, Any]:
        payload = {"format": format}
        data = self._post(f"/scans/{scan_id}/export", json_body=payload)
        return data
