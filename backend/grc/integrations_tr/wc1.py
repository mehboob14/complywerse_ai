"""World-Check One (LSEG) — v2 HMAC-signed client + result normalisation.

Auth (plan §3.1): HTTP-Signature HMAC-SHA256 over lowercase ``name: value`` lines
for ``(request-target) host date`` (+ ``content-type content-length`` and the raw
body for requests with a body). The v2 gateway path is part of the base URL
(e.g. ``https://api-worldcheck.refinitiv.com/v2``) and is included in the signed
request-target. v3 / OAuth can be added as another client with the same methods.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
from email.utils import formatdate
from typing import Any, Dict, List, Optional
from urllib.parse import urlsplit

from .http import RateLimiter, request

CONTENT_TYPE = "application/json"
# ~1 request/second per API user (plan §3.1) — shared across workers in-process.
_LIMITER = RateLimiter(rate_per_sec=1.0, burst=2)

# Our resolution statuses ↔ World-Check One toolkit status types.
RESOLUTION_TYPES = {"positive": "POSITIVE", "possible": "POSSIBLE", "false": "FALSE", "unspecified": "UNSPECIFIED"}


# ── signing (pure) ───────────────────────────────────────────────────────────

def http_date() -> str:
    return formatdate(usegmt=True)


def build_string_to_sign(method: str, host: str, path: str, date: str, body: Optional[str]) -> str:
    lines = [f"(request-target): {method.lower()} {path}", f"host: {host}", f"date: {date}"]
    if body is None:
        return "\n".join(lines)
    length = len(body.encode("utf-8"))
    lines += [f"content-type: {CONTENT_TYPE}", f"content-length: {length}"]
    return "\n".join(lines) + "\n" + body


def sign(api_key: str, api_secret: str, method: str, host: str, path: str, date: str,
         body: Optional[str] = None) -> Dict[str, str]:
    """Return the headers for one signed request."""
    to_sign = build_string_to_sign(method, host, path, date, body)
    digest = hmac.new(api_secret.encode("utf-8"), to_sign.encode("utf-8"), hashlib.sha256).digest()
    signature = base64.b64encode(digest).decode("ascii")
    signed_headers = "(request-target) host date" + ("" if body is None else " content-type content-length")
    headers = {
        "Date": date,
        "Authorization": (
            f'Signature keyId="{api_key}",algorithm="hmac-sha256",'
            f'headers="{signed_headers}",signature="{signature}"'
        ),
    }
    if body is not None:
        headers["Content-Type"] = CONTENT_TYPE
        headers["Content-Length"] = str(len(body.encode("utf-8")))
    return headers


# ── normalisation (pure) ─────────────────────────────────────────────────────

def classify_hit(categories: List[str], provider_type: Optional[str]) -> str:
    """Our hit class, most severe wins: sanctions > law_enforcement > pep > adverse_media > other."""
    text = " | ".join(str(c) for c in (categories or [])).lower()
    if "sanction" in text:
        return "sanctions"
    if any(k in text for k in ("law enforcement", "crime", "terror", "regulatory enforcement")):
        return "law_enforcement"
    if "pep" in text or "politically exposed" in text:
        return "pep"
    if (provider_type or "").upper() == "MEDIA_CHECK" or "adverse" in text or "media" in text:
        return "adverse_media"
    return "other"


def normalise_result(raw: Dict[str, Any]) -> Dict[str, Any]:
    """Map one World-Check One result to our match fields (tolerant of field drift)."""
    categories = raw.get("categories") or []
    if isinstance(categories, str):
        categories = [categories]
    provider_type = raw.get("providerType") or raw.get("provider_type")
    countries = []
    for link in raw.get("countryLinks") or []:
        c = (link or {}).get("country") or {}
        name = c.get("name") or c.get("code") or link.get("countryText")
        if name and name not in countries:
            countries.append(name)
    resolution = raw.get("resolution") or {}
    return {
        "external_result_id": str(raw.get("resultId") or raw.get("id") or ""),
        "reference_id": raw.get("referenceId"),
        "matched_name": raw.get("matchedTerm") or raw.get("primaryName"),
        "match_strength": (raw.get("matchStrength") or "").upper() or None,
        "provider_type": provider_type,
        "categories": [str(c) for c in categories],
        "countries": countries,
        "hit_class": classify_hit(categories, provider_type),
        "provider_resolution": resolution or None,
        "raw": raw,
    }


def toolkit_options(toolkit: Dict[str, Any]) -> Dict[str, List[dict]]:
    """Flatten a group's resolution toolkit into {statuses, risks, reasons}, each
    [{id, label, type}]. Tolerant of shape: collects any list of option dicts."""
    out = {"statuses": [], "risks": [], "reasons": []}

    def visit(node):
        if isinstance(node, dict):
            for key, val in node.items():
                k = key.lower()
                bucket = "statuses" if "status" in k else "risks" if "risk" in k else "reasons" if "reason" in k else None
                if bucket and isinstance(val, list) and all(isinstance(v, dict) for v in val):
                    for v in val:
                        oid = v.get("id")
                        if oid and not any(o["id"] == oid for o in out[bucket]):
                            out[bucket].append({"id": oid, "label": v.get("label") or v.get("name") or oid,
                                                "type": (v.get("type") or "").upper()})
                else:
                    visit(val)
        elif isinstance(node, list):
            for v in node:
                visit(v)

    visit(toolkit or {})
    return out


def pick_option(options: List[dict], wanted_type: Optional[str], label: Optional[str] = None) -> Optional[str]:
    """Choose a toolkit option id by type (e.g. POSITIVE / HIGH) or label."""
    if label:
        for o in options:
            if o["label"].lower() == label.lower() or o["id"] == label:
                return o["id"]
    if wanted_type:
        for o in options:
            if o["type"] == wanted_type.upper():
                return o["id"]
    return None


# ── live client ──────────────────────────────────────────────────────────────

class WC1Client:
    simulated = False

    def __init__(self, base_url: str, api_key: str, api_secret: str, *, limiter_key: str = "wc1"):
        if not api_key or not api_secret:
            raise ValueError("World-Check One API key and secret are required for live mode.")
        parts = urlsplit(base_url.rstrip("/"))
        self._scheme_host = f"{parts.scheme}://{parts.netloc}"
        self._host = parts.netloc
        self._prefix = parts.path.rstrip("/")   # e.g. /v2
        self._key = api_key
        self._secret = api_secret
        self._limiter_key = limiter_key

    def _call(self, method: str, path: str, payload: Any = None):
        full_path = f"{self._prefix}{path}"
        body = None if payload is None else json.dumps(payload, separators=(",", ":"))

        def headers():
            return sign(self._key, self._secret, method, self._host, full_path, http_date(), body)

        resp = request(
            method, self._scheme_host + full_path, headers=headers,
            content=None if body is None else body.encode("utf-8"),
            limiter=_LIMITER, limiter_key=self._limiter_key,
        )
        if not resp.content:
            return None
        try:
            return resp.json()
        except ValueError:
            return None

    # Interface shared with the simulated client ------------------------------
    def test(self) -> dict:
        groups = self.list_groups()
        return {"ok": True, "message": f"Authenticated — {len(groups)} group(s) visible."}

    def list_groups(self) -> List[dict]:
        data = self._call("GET", "/groups") or []
        out = []

        def walk(items):
            for g in items or []:
                out.append({"id": g.get("id"), "name": g.get("name"), "status": g.get("status")})
                walk(g.get("children"))

        walk(data if isinstance(data, list) else [data])
        return out

    def resolution_toolkit(self, group_id: str) -> dict:
        return self._call("GET", f"/groups/{group_id}/resolutionToolkit") or {}

    def screen(self, *, group_id: str, entity_type: str, name: str,
               secondary_fields: Optional[List[dict]] = None, case_system_id: Optional[str] = None) -> dict:
        if case_system_id:
            self._call("POST", f"/cases/{case_system_id}/screeningRequest")
            return {"case_system_id": case_system_id, "results": self.get_results(case_system_id)}
        payload = {
            "groupId": group_id, "entityType": entity_type, "providerTypes": ["WATCHLIST"],
            "name": name, "secondaryFields": secondary_fields or [], "customFields": [],
        }
        data = self._call("POST", "/cases/screeningRequest", payload) or {}
        case_id = data.get("caseSystemId")
        results = data.get("results")
        if results is None and case_id:
            results = self.get_results(case_id)
        return {"case_system_id": case_id, "results": results or []}

    def get_results(self, case_system_id: str) -> List[dict]:
        data = self._call("GET", f"/cases/{case_system_id}/results")
        return data if isinstance(data, list) else (data or {}).get("results", []) if isinstance(data, dict) else []

    def resolve(self, case_system_id: str, result_ids: List[str], *, status_id: str,
                risk_id: Optional[str], reason_id: Optional[str], remark: Optional[str]) -> None:
        payload = {"resultIds": result_ids, "statusId": status_id}
        if risk_id:
            payload["riskId"] = risk_id
        if reason_id:
            payload["reasonId"] = reason_id
        if remark:
            payload["resolutionRemark"] = remark[:1000]
        self._call("PUT", f"/cases/{case_system_id}/results/resolution", payload)

    def set_ongoing(self, case_system_id: str, enabled: bool) -> None:
        self._call("PUT" if enabled else "DELETE", f"/cases/{case_system_id}/ongoingScreening")

    def ongoing_updates(self, since_iso: str) -> List[str]:
        """Case ids with new ongoing-screening results since ``since_iso``.

        UNVERIFIED (plan §3.1 / Phase 7): the query-filter syntax is taken from
        public client code; confirm against the licensed schema reference."""
        payload = {"query": f"updateDate>='{since_iso}'", "sort": [{"columnName": "updateDate", "order": "ASCENDING"}]}
        data = self._call("POST", "/cases/ongoingScreeningUpdates", payload) or {}
        items = data.get("results") if isinstance(data, dict) else data
        return [str(i.get("caseSystemId")) for i in (items or []) if i.get("caseSystemId")]

    def profile(self, reference_id: str) -> dict:
        return self._call("GET", f"/reference/profile/{reference_id}") or {}
