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
        _url = console_url.rstrip("/")
        # Strip a port already embedded in the URL (e.g. "https://host:8834") so
        # combining it with console_port below can't double it into
        # "https://host:8834:8834" and break the connection.
        _head, _sep, _tail = _url.rpartition(":")
        if _sep and _tail.isdigit() and "//" in _head:
            _url = _head
        self.console_url = _url
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

    def get_scan_coverage(self) -> List[Dict[str, Any]]:
        """Which hosts were covered by which COMPLETED scan runs.

        Returns a list of ``{scan_id, scan_name, status, ended_at (epoch),
        hosts: [host_key, ...]}`` — one entry per scan whose latest run
        finished successfully. This is the evidence base for inbound closure:
        a finding may only be auto-closed when its host appears in a completed
        run that ended after the finding was last seen. Adapters that cannot
        prove coverage return [] and their findings are simply never
        auto-closed — absence of evidence closes nothing.
        """
        return []

    def writeback_capabilities(self) -> Dict[str, Dict[str, Any]]:
        """What GRC decisions this scanner's API can represent, action by action.

        Shape: ``{action: {"supported": bool, "method": str|None, "reason": str}}``
        for the actions ``false_positive`` / ``risk_accepted`` / ``exception`` /
        ``remediated``. Default: nothing supported — the writeback service
        records each push as skipped with the adapter's reason instead of
        guessing at an API the scanner doesn't have.
        """
        _no = {"supported": False, "method": None,
               "reason": "Write-back not implemented for this scanner type."}
        return {
            "false_positive": dict(_no),
            "risk_accepted": dict(_no),
            "exception": dict(_no),
            "remediated": dict(_no),
        }

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
