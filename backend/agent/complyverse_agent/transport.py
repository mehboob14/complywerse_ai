"""HTTP transport for the agent.

Uses stdlib `urllib.request` instead of `requests` because:
  • NSIS embedded Python ships only stdlib by default — adding `requests`
    would bloat the installer by ~2 MB
  • The agent makes maybe 3 endpoint types of calls; we don't need
    requests' kitchen-sink features

Every call goes through `_post()` / `_get()` so we have a single place to
plug in cert pinning, retries, or proxy support later.
"""
from __future__ import annotations

import json
import logging
import socket
import ssl
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Optional

logger = logging.getLogger(__name__)


class TransportError(Exception):
    """Wraps HTTP/network errors so callers don't have to import urllib."""

    def __init__(self, status: int, message: str, body: Any = None):
        super().__init__(f"HTTP {status}: {message}")
        self.status = status
        self.message = message
        self.body = body


def _build_request(
    method: str,
    url: str,
    body: Optional[dict] = None,
    token: Optional[str] = None,
    extra_headers: Optional[dict] = None,
) -> urllib.request.Request:
    headers = {"User-Agent": "ComplyverseAgent/1.0"}
    data: Optional[bytes] = None
    if body is not None:
        headers["Content-Type"] = "application/json"
        data = json.dumps(body).encode("utf-8")
    if token:
        headers["Authorization"] = f"Bearer {token}"
    if extra_headers:
        headers.update(extra_headers)
    return urllib.request.Request(url, data=data, headers=headers, method=method)


def _execute(req: urllib.request.Request, timeout: int) -> tuple[int, Any]:
    # In production we want strict TLS — but if the operator sets
    # COMPLYVERSE_INSECURE=1 (e.g. for testing against a self-signed cloud
    # in dev), we tolerate that. Default is strict.
    import os
    ctx = ssl.create_default_context()
    if os.environ.get("COMPLYVERSE_INSECURE") == "1":
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
    try:
        with urllib.request.urlopen(req, timeout=timeout, context=ctx) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
            try:
                return resp.status, json.loads(raw) if raw else {}
            except json.JSONDecodeError:
                return resp.status, {"raw": raw}
    except urllib.error.HTTPError as e:
        try:
            err_body = e.read().decode("utf-8", errors="replace")
            parsed = json.loads(err_body) if err_body else {}
        except Exception:
            parsed = {"raw": err_body if "err_body" in dir() else ""}
        raise TransportError(e.code, e.reason, parsed) from None
    except (urllib.error.URLError, socket.timeout, ConnectionError) as e:
        raise TransportError(0, f"network: {type(e).__name__}: {e}") from None


def post(url: str, body: dict, token: Optional[str] = None, timeout: int = 30) -> Any:
    req = _build_request("POST", url, body=body, token=token)
    status, data = _execute(req, timeout)
    if status >= 400:
        raise TransportError(status, "non-2xx response", data)
    return data


def get(url: str, token: Optional[str] = None, timeout: int = 30) -> Any:
    req = _build_request("GET", url, token=token)
    status, data = _execute(req, timeout)
    if status >= 400:
        raise TransportError(status, "non-2xx response", data)
    return data
