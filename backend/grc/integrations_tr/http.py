"""Resilient outbound HTTP for the Thomson Reuters / LSEG providers.

* Retries transient failures (timeouts, connection errors, 502/503/504) and HTTP
  429 with exponential backoff, honouring ``Retry-After``.
* A per-key token bucket keeps us under provider rate limits (World-Check One is
  reported at ~1 request/second per API user).
* Headers may be a callable so request signatures (HMAC over the Date header)
  are regenerated on every attempt.
* Tests inject an ``httpx.MockTransport`` via ``set_transport`` — no network.
"""
from __future__ import annotations

import logging
import threading
import time
from typing import Callable, Dict, Optional, Union

import httpx

logger = logging.getLogger(__name__)

_RETRYABLE_STATUS = {429, 502, 503, 504}
_TRANSPORT: Optional[httpx.BaseTransport] = None


class ProviderError(Exception):
    """A provider call failed. ``retryable`` tells sweeps whether to try later."""

    def __init__(self, message: str, *, status_code: Optional[int] = None, retryable: bool = False):
        super().__init__(message)
        self.status_code = status_code
        self.retryable = retryable


def set_transport(transport: Optional[httpx.BaseTransport]) -> None:
    """Test hook: route every provider request through ``transport``."""
    global _TRANSPORT
    _TRANSPORT = transport


class RateLimiter:
    """Thread-safe token bucket keyed by an arbitrary string (e.g. connection id)."""

    def __init__(self, rate_per_sec: float = 1.0, burst: int = 1):
        self.rate = max(0.01, float(rate_per_sec))
        self.burst = max(1, int(burst))
        self._lock = threading.Lock()
        self._state: Dict[str, list] = {}

    def acquire(self, key: str, sleep: Callable[[float], None] = time.sleep) -> None:
        while True:
            with self._lock:
                now = time.monotonic()
                tokens, last = self._state.get(key, [float(self.burst), now])
                tokens = min(self.burst, tokens + (now - last) * self.rate)
                if tokens >= 1:
                    self._state[key] = [tokens - 1, now]
                    return
                self._state[key] = [tokens, now]
                wait = (1 - tokens) / self.rate
            sleep(wait)


def _retry_after_seconds(resp: httpx.Response, fallback: float) -> float:
    raw = resp.headers.get("Retry-After")
    if raw:
        try:
            return max(0.0, min(60.0, float(raw)))
        except ValueError:
            pass
    return fallback


def _describe(resp: httpx.Response) -> str:
    body = (resp.text or "")[:300].replace("\n", " ")
    return f"HTTP {resp.status_code}: {body}" if body else f"HTTP {resp.status_code}"


def request(
    method: str,
    url: str,
    *,
    headers: Union[Dict[str, str], Callable[[], Dict[str, str]], None] = None,
    content: Optional[bytes] = None,
    data: Optional[dict] = None,
    params: Optional[dict] = None,
    timeout: float = 30.0,
    cert=None,
    limiter: Optional[RateLimiter] = None,
    limiter_key: str = "default",
    max_retries: int = 3,
    backoff_base: float = 1.0,
    sleep: Callable[[float], None] = time.sleep,
) -> httpx.Response:
    """Send a request with retry/backoff. Returns the 2xx response or raises
    ``ProviderError``. Never logs headers or bodies (they may carry secrets/PII)."""
    attempt = 0
    while True:
        if limiter is not None:
            limiter.acquire(limiter_key, sleep=sleep)
        hdrs = headers() if callable(headers) else (headers or {})
        try:
            with httpx.Client(timeout=timeout, cert=cert, transport=_TRANSPORT) as client:
                resp = client.request(method, url, headers=hdrs, content=content, data=data, params=params)
        except (httpx.TimeoutException, httpx.TransportError) as exc:
            if attempt >= max_retries:
                raise ProviderError(f"Network error contacting provider: {exc.__class__.__name__}",
                                    retryable=True) from exc
            delay = backoff_base * (2 ** attempt)
            logger.warning("provider %s %s transport error (%s); retry in %.1fs",
                           method, httpx.URL(url).host, exc.__class__.__name__, delay)
            sleep(delay)
            attempt += 1
            continue

        if 200 <= resp.status_code < 300:
            return resp
        if resp.status_code in _RETRYABLE_STATUS and attempt < max_retries:
            delay = _retry_after_seconds(resp, backoff_base * (2 ** attempt))
            logger.warning("provider %s %s returned %s; retry in %.1fs",
                           method, httpx.URL(url).host, resp.status_code, delay)
            sleep(delay)
            attempt += 1
            continue
        if resp.status_code in (401, 403):
            raise ProviderError("Provider rejected the credentials (" + _describe(resp) + ")",
                                status_code=resp.status_code)
        raise ProviderError(_describe(resp), status_code=resp.status_code,
                            retryable=resp.status_code in _RETRYABLE_STATUS)
