"""Thomson Reuters Regulatory Intelligence — REST client + document mapper.

Public facts (plan §3.3): REST API at ``…/regulatory-intelligence/v1`` with
``GET /documents/{id}``, OAuth 2.0 app-only bearer tokens (API key + secret,
≤60 min). The list/search endpoint and metadata field names are UNVERIFIED, so
the documents path is a setting and the mapper accepts several field spellings;
confirmed against the licensed docs in Phase 7. Access tokens are cached in
process memory only (never written to the database).
"""
from __future__ import annotations

import threading
import time
from datetime import datetime
from typing import Any, Dict, List, Optional

from . import connections
from .http import ProviderError, RateLimiter, request

_LIMITER = RateLimiter(rate_per_sec=2.0, burst=4)
_TOKENS: Dict[str, tuple] = {}          # cache key → (token, expires_monotonic)
_TOKEN_LOCK = threading.Lock()
DEFAULT_DOCUMENTS_PATH = "/documents"


def _first(d: dict, *keys, default=None):
    for k in keys:
        v = d.get(k)
        if v not in (None, "", []):
            return v
    return default


def _as_list(v) -> List[str]:
    if v is None:
        return []
    if isinstance(v, list):
        return [str(x.get("name") if isinstance(x, dict) else x) for x in v if x]
    if isinstance(v, dict):
        return [str(v.get("name") or v.get("value") or "")]
    return [str(v)]


def _parse_dt(v) -> Optional[datetime]:
    if not v:
        return None
    s = str(v).replace("Z", "+00:00")
    for parse in (datetime.fromisoformat, lambda x: datetime.strptime(x[:10], "%Y-%m-%d")):
        try:
            dt = parse(s)
            return dt.replace(tzinfo=None)
        except (ValueError, TypeError):
            continue
    return None


def normalise_document(raw: Dict[str, Any]) -> Dict[str, Any]:
    """Map one TRRI document to a RegulatoryFeedItem-shaped dict."""
    doc_id = str(_first(raw, "id", "documentId", "docId", "guid", default="") or "")
    return {
        "guid": f"trri:{doc_id}" if doc_id else "",
        "title": str(_first(raw, "title", "headline", "name", default="Untitled"))[:1000],
        "description": _first(raw, "summary", "abstract", "description"),
        "link": _first(raw, "url", "link", "webUrl", "documentUrl"),
        "published_date": _parse_dt(_first(raw, "publishedDate", "publicationDate", "published", "date")),
        "content": _first(raw, "content", "body", "text"),
        "metadata": {
            "document_id": doc_id or None,
            "jurisdiction": _as_list(_first(raw, "jurisdictions", "jurisdiction", "country", "region")),
            "regulator": _as_list(_first(raw, "regulators", "regulator", "issuingBody", "source")),
            "topics": _as_list(_first(raw, "topics", "topic", "subjects", "categories")),
            "document_type": _first(raw, "documentType", "docType", "type"),
            "effective_date": (lambda d: d.date().isoformat() if d else None)(
                _parse_dt(_first(raw, "effectiveDate", "effective"))),
            "simulated": bool(raw.get("simulated")),
        },
    }


def extract_documents(data: Any) -> List[dict]:
    if isinstance(data, list):
        return [d for d in data if isinstance(d, dict)]
    if isinstance(data, dict):
        for key in ("documents", "items", "results", "data", "hits"):
            if isinstance(data.get(key), list):
                return [d for d in data[key] if isinstance(d, dict)]
    return []


class TRRIClient:
    simulated = False

    def __init__(self, conn):
        creds = connections.credentials(conn)
        self._id, self._secret = creds.get("client_id", ""), creds.get("client_secret", "")
        if not self._id or not self._secret:
            raise ValueError("Regulatory Intelligence live mode needs the API key and secret.")
        self._base = connections.base_url(conn)
        cfg = connections.effective_config(conn)
        self._token_url = (cfg.get("token_url") or f"{self._base}/oauth2/token").strip()
        self._docs_path = cfg.get("documents_path") or DEFAULT_DOCUMENTS_PATH
        self._cache_key = f"{conn.tenant_id}:{self._id}"

    def _token(self) -> str:
        with _TOKEN_LOCK:
            tok = _TOKENS.get(self._cache_key)
            if tok and tok[1] > time.monotonic() + 60:
                return tok[0]
        resp = request("POST", self._token_url, data={
            "grant_type": "client_credentials", "client_id": self._id, "client_secret": self._secret,
        }, headers={"Accept": "application/json"}, limiter=_LIMITER, limiter_key=self._cache_key)
        body = resp.json()
        token = body.get("access_token")
        if not token:
            raise ProviderError("Token endpoint returned no access_token")
        ttl = min(int(body.get("expires_in") or 3600), 3600)
        with _TOKEN_LOCK:
            _TOKENS[self._cache_key] = (token, time.monotonic() + ttl)
        return token

    def _get(self, path: str, params: Optional[dict] = None) -> Any:
        resp = request("GET", self._base + path, params=params,
                       headers=lambda: {"Authorization": f"Bearer {self._token()}", "Accept": "application/json"},
                       limiter=_LIMITER, limiter_key=self._cache_key)
        return resp.json()

    def test(self) -> dict:
        self._token()
        return {"ok": True, "message": "Authenticated with Regulatory Intelligence (OAuth token issued)."}

    def list_documents(self, query: Optional[dict] = None, since: Optional[datetime] = None,
                       limit: int = 50) -> List[dict]:
        q = query or {}
        params: Dict[str, Any] = {"pageSize": max(1, min(int(limit), 200))}
        for ours, theirs in (("jurisdictions", "jurisdiction"), ("regulators", "regulator"),
                             ("topics", "topic"), ("document_types", "documentType"), ("keywords", "q")):
            vals = q.get(ours)
            if vals:
                params[theirs] = ",".join(vals) if isinstance(vals, list) else str(vals)
        if since:
            params["updatedSince"] = since.replace(microsecond=0).isoformat() + "Z"
        return extract_documents(self._get(self._docs_path, params))

    def get_document(self, doc_id: str) -> dict:
        return self._get(f"{self._docs_path}/{doc_id}")
