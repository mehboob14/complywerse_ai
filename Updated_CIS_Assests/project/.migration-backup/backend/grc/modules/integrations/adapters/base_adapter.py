import logging
from abc import ABC, abstractmethod
from typing import Any, Dict, List, Optional
from dataclasses import dataclass, field

logger = logging.getLogger(__name__)


@dataclass
class PagedResponse:
    data: List[Dict[str, Any]]
    total_records: int = 0
    page: int = 0
    page_size: int = 0
    has_more: bool = False


@dataclass
class ConnectionTestResult:
    success: bool
    message: str
    server_version: Optional[str] = None
    details: Dict[str, Any] = field(default_factory=dict)


class BaseAdapter(ABC):

    def __init__(self, console_url: str, console_port: int, credentials: Dict[str, str], verify_ssl: bool = True):
        self.console_url = console_url.rstrip("/")
        self.console_port = console_port
        self.credentials = credentials
        self.verify_ssl = verify_ssl
        self.base_url = f"{self.console_url}:{self.console_port}"

    @abstractmethod
    def test_connection(self) -> ConnectionTestResult:
        pass

    @abstractmethod
    def get_assets(self, page: int = 0, page_size: int = 500) -> PagedResponse:
        pass

    @abstractmethod
    def get_asset_vulnerabilities(self, asset_id: str) -> List[Dict[str, Any]]:
        pass

    @abstractmethod
    def get_vulnerabilities(self, page: int = 0, page_size: int = 500) -> PagedResponse:
        pass

    @abstractmethod
    def get_vulnerability_detail(self, vuln_id: str) -> Dict[str, Any]:
        pass

    @abstractmethod
    def get_solutions(self, vuln_id: str) -> List[Dict[str, Any]]:
        pass

    @abstractmethod
    def get_scans(self, active_only: bool = False) -> List[Dict[str, Any]]:
        pass

    @abstractmethod
    def get_scan_detail(self, scan_id: str) -> Dict[str, Any]:
        pass

    @abstractmethod
    def create_exception(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        pass

    @abstractmethod
    def delete_exception(self, exception_id: str) -> bool:
        pass

    def _paginate_all(self, fetch_fn, page_size: int = 500) -> List[Dict[str, Any]]:
        all_data = []
        page = 0
        while True:
            result = fetch_fn(page=page, page_size=page_size)
            all_data.extend(result.data)
            if not result.has_more:
                break
            page += 1
        return all_data
