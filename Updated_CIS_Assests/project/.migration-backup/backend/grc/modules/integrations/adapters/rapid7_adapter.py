import logging
import time
from typing import Any, Dict, List, Optional
from urllib.parse import urljoin

import requests
from requests.auth import HTTPBasicAuth
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

from .base_adapter import BaseAdapter, ConnectionTestResult, PagedResponse

logger = logging.getLogger(__name__)

DEFAULT_TIMEOUT = 30
MAX_RETRIES = 3
RETRY_BACKOFF = 1.0
RATE_LIMIT_SLEEP = 1.0


class Rapid7Adapter(BaseAdapter):

    API_PREFIX = "/api/3"

    def __init__(self, console_url: str, console_port: int, credentials: Dict[str, str], verify_ssl: bool = False):
        super().__init__(console_url, console_port, credentials, verify_ssl)
        self.session = self._build_session()

    def _build_session(self) -> requests.Session:
        s = requests.Session()
        s.verify = self.verify_ssl

        username = self.credentials.get("username", "")
        password = self.credentials.get("password", "")
        api_key = self.credentials.get("api_key", "")

        if api_key:
            s.headers["X-API-Key"] = api_key
        elif username and password:
            s.auth = HTTPBasicAuth(username, password)

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

    def _url(self, path: str) -> str:
        return f"{self.base_url}{self.API_PREFIX}{path}"

    def _request(self, method: str, path: str, params: Optional[Dict] = None,
                 json_body: Optional[Dict] = None, timeout: int = DEFAULT_TIMEOUT) -> Dict[str, Any]:
        url = self._url(path)
        try:
            resp = self.session.request(method, url, params=params, json=json_body, timeout=timeout)

            if resp.status_code == 429:
                retry_after = int(resp.headers.get("Retry-After", 5))
                logger.warning(f"Rate limited on {path}, sleeping {retry_after}s")
                time.sleep(retry_after)
                resp = self.session.request(method, url, params=params, json=json_body, timeout=timeout)

            resp.raise_for_status()
            if resp.status_code == 204:
                return {}
            return resp.json()
        except requests.exceptions.Timeout:
            logger.error(f"Timeout calling {method} {url}")
            raise
        except requests.exceptions.ConnectionError as e:
            logger.error(f"Connection error for {url}: {e}")
            raise
        except requests.exceptions.HTTPError as e:
            logger.error(f"HTTP {resp.status_code} from {url}: {resp.text[:500]}")
            raise

    def _get(self, path: str, params: Optional[Dict] = None, timeout: int = DEFAULT_TIMEOUT) -> Dict[str, Any]:
        return self._request("GET", path, params=params, timeout=timeout)

    def _post(self, path: str, json_body: Optional[Dict] = None, timeout: int = DEFAULT_TIMEOUT) -> Dict[str, Any]:
        return self._request("POST", path, json_body=json_body, timeout=timeout)

    def _delete(self, path: str, timeout: int = DEFAULT_TIMEOUT) -> Dict[str, Any]:
        return self._request("DELETE", path, timeout=timeout)

    def _paged_get(self, path: str, page: int = 0, page_size: int = 500,
                   extra_params: Optional[Dict] = None) -> PagedResponse:
        params = {"page": page, "size": page_size}
        if extra_params:
            params.update(extra_params)
        data = self._get(path, params=params)

        resources = data.get("resources", [])
        page_info = data.get("page", {})
        total = page_info.get("totalResources", len(resources))
        total_pages = page_info.get("totalPages", 1)
        current_page = page_info.get("number", page)

        return PagedResponse(
            data=resources,
            total_records=total,
            page=current_page,
            page_size=page_size,
            has_more=(current_page + 1) < total_pages,
        )

    def test_connection(self) -> ConnectionTestResult:
        try:
            info = self._get("/administration/info", timeout=15)
            version = info.get("version", {})
            return ConnectionTestResult(
                success=True,
                message="Connected to Rapid7 console",
                server_version=version.get("version"),
                details={
                    "serial": version.get("serial"),
                    "platform": version.get("platform"),
                    "update": version.get("update"),
                },
            )
        except requests.exceptions.ConnectionError:
            return ConnectionTestResult(success=False, message="Cannot reach Rapid7 console — check URL/port")
        except requests.exceptions.HTTPError as e:
            status = getattr(e.response, "status_code", None)
            if status == 401:
                return ConnectionTestResult(success=False, message="Authentication failed — check credentials")
            return ConnectionTestResult(success=False, message=f"HTTP {status} from console")
        except Exception as e:
            return ConnectionTestResult(success=False, message=f"Unexpected error: {str(e)[:200]}")

    def get_assets(self, page: int = 0, page_size: int = 500) -> PagedResponse:
        return self._paged_get("/assets", page=page, page_size=page_size)

    def get_asset_detail(self, asset_id: str) -> Dict[str, Any]:
        return self._get(f"/assets/{asset_id}")

    def get_asset_vulnerabilities(self, asset_id: str) -> List[Dict[str, Any]]:
        result = self._paged_get(f"/assets/{asset_id}/vulnerabilities", page_size=500)
        all_vulns = list(result.data)
        while result.has_more:
            result = self._paged_get(f"/assets/{asset_id}/vulnerabilities",
                                     page=result.page + 1, page_size=500)
            all_vulns.extend(result.data)
        return all_vulns

    def get_vulnerabilities(self, page: int = 0, page_size: int = 500) -> PagedResponse:
        return self._paged_get("/vulnerabilities", page=page, page_size=page_size)

    def get_vulnerability_detail(self, vuln_id: str) -> Dict[str, Any]:
        return self._get(f"/vulnerabilities/{vuln_id}")

    def get_solutions(self, vuln_id: str) -> List[Dict[str, Any]]:
        data = self._get(f"/vulnerabilities/{vuln_id}/solutions")
        return data.get("resources", [])

    def get_scans(self, active_only: bool = False) -> List[Dict[str, Any]]:
        params = {"active": str(active_only).lower()} if active_only else None
        data = self._get("/scans", params=params)
        return data.get("resources", [])

    def get_scan_detail(self, scan_id: str) -> Dict[str, Any]:
        return self._get(f"/scans/{scan_id}")

    def get_sites(self) -> List[Dict[str, Any]]:
        data = self._get("/sites")
        return data.get("resources", [])

    def create_exception(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        return self._post("/vulnerability_exceptions", json_body=payload)

    def delete_exception(self, exception_id: str) -> bool:
        try:
            self._delete(f"/vulnerability_exceptions/{exception_id}")
            return True
        except Exception as e:
            logger.error(f"Failed to delete exception {exception_id}: {e}")
            return False
