"""Thomson Reuters CLEAR (System-to-System) — due-diligence enrichment.

What is public (plan §3.2): REST-style XML requests, search → retrieve-report
flow, client-certificate authentication, and mandatory GLB / DPPA permissible
purposes. The business search/report XML schemas are NOT public, so:

* endpoint paths are per-connection settings (``search_path`` / ``report_path``);
* the response is parsed generically (XML → dict) and red flags are derived by
  recognising report SECTIONS by keyword (bankruptcy, lien, judgment, lawsuit,
  criminal, sanction/OFAC, news, business status). This keeps working across
  schema versions and is confirmed against the licensed guide in Phase 7.
"""
from __future__ import annotations

import os
import ssl
import tempfile
from typing import Any, Dict, List, Optional
from xml.sax.saxutils import escape

from lxml import etree

from .http import RateLimiter, request

_LIMITER = RateLimiter(rate_per_sec=2.0, burst=2)

DEFAULT_SEARCH_PATH = "/v3/business/searchResults"
DEFAULT_REPORT_PATH = "/v3/business/reportResults"

# family, keywords (matched against section tag / title, lower-case), domain, severity, label
FLAG_RULES = [
    ("bankruptcy", ("bankruptc", "insolven"), "financial", "high", "Bankruptcy filings"),
    ("liens", ("lien",), "financial", "medium", "Liens"),
    ("judgments", ("judgment", "judgement"), "financial", "medium", "Judgments"),
    ("lawsuits", ("lawsuit", "litigation", "docket"), "legal", "medium", "Lawsuits / litigation"),
    ("criminal", ("criminal", "arrest", "infraction", "incarcerat"), "compliance", "high",
     "Criminal / arrest records"),
    ("sanctions", ("sanction", "ofac", "watchlist"), "compliance", "high", "Sanctions / watchlist records"),
    ("news", ("news", "media"), "reputational", "low", "Adverse news"),
]
_INACTIVE_WORDS = ("inactive", "dissolved", "revoked", "suspended", "forfeit", "delinquent")


# ── pure mapping ─────────────────────────────────────────────────────────────

def xml_to_dict(node) -> Any:
    """Namespace-stripped, list-aware XML → dict (repeated tags become lists)."""
    children = list(node)
    if not children:
        return (node.text or "").strip()
    out: Dict[str, Any] = {}
    for c in children:
        if not isinstance(c.tag, str):
            continue
        tag = etree.QName(c).localname
        val = xml_to_dict(c)
        if tag in out:
            if not isinstance(out[tag], list):
                out[tag] = [out[tag]]
            out[tag].append(val)
        else:
            out[tag] = val
    return out


def _count_records(val: Any) -> int:
    if isinstance(val, list):
        return len([v for v in val if v not in ("", None, {})])
    if isinstance(val, dict):
        inner = [v for v in val.values() if isinstance(v, (list, dict))]
        if len(inner) == 1:
            return _count_records(inner[0])
        return 1 if val else 0
    return 1 if val not in ("", None, "0") else 0


def derive_flags(report: Dict[str, Any]) -> List[dict]:
    """Walk a report dict and emit one flag per recognised non-empty section."""
    found: Dict[str, dict] = {}

    def visit(node, path: str):
        if isinstance(node, dict):
            for key, val in node.items():
                k = key.lower()
                for family, words, domain, severity, label in FLAG_RULES:
                    if family in found:
                        continue
                    if any(w in k for w in words):
                        n = _count_records(val)
                        if n > 0:
                            found[family] = {
                                "key": family, "family": family, "label": label, "severity": severity,
                                "domain": domain, "count": n,
                                "detail": f"{n} record(s) in the CLEAR report section '{key}'.",
                            }
                visit(val, f"{path}/{key}")
                if k in ("status", "businessstatus", "corporatestatus") and isinstance(val, str):
                    if any(w in val.lower() for w in _INACTIVE_WORDS) and "business_status" not in found:
                        found["business_status"] = {
                            "key": "business_status", "family": "business_status",
                            "label": "Business registration not in good standing", "severity": "medium",
                            "domain": "operational", "count": 1, "detail": f"Registered status: {val}.",
                        }
        elif isinstance(node, list):
            for v in node:
                visit(v, path)

    visit(report, "")
    order = {r[0]: i for i, r in enumerate(FLAG_RULES)}
    return sorted(found.values(), key=lambda f: order.get(f["family"], 99))


def risk_score(flags: List[dict]) -> float:
    """Additive score in the spirit of Risk Inform (sum of per-flag weights), 0–100."""
    weight = {"critical": 40, "high": 25, "medium": 12, "low": 5}
    return float(min(100, sum(weight.get(f["severity"], 5) for f in flags)))


# ── live client ──────────────────────────────────────────────────────────────

def _search_xml(name: str, glb: str, dppa: str, country: Optional[str], is_person: bool) -> str:
    kind = "Person" if is_person else "Business"
    name_el = (f"<LastName>{escape(name)}</LastName>" if is_person
               else f"<BusinessName>{escape(name)}</BusinessName>")
    loc = f"<Country>{escape(country)}</Country>" if country else ""
    return (
        f'<?xml version="1.0" encoding="UTF-8"?>'
        f"<{kind}SearchRequestV3>"
        f"<PermissiblePurpose><GLB>{escape(glb)}</GLB><DPPA>{escape(dppa)}</DPPA></PermissiblePurpose>"
        f"<Criteria><{kind}Criteria>{name_el}{loc}</{kind}Criteria></Criteria>"
        f"</{kind}SearchRequestV3>"
    )


def client_ssl_context(cert_pem: str, key_pem: str) -> ssl.SSLContext:
    """TLS context carrying the CLEAR client certificate. The stdlib can only load
    a chain from FILES, so the PEMs are written 0600 to a private temp dir that is
    deleted as soon as the chain is loaded (secrets never linger on disk)."""
    ctx = ssl.create_default_context()
    d = tempfile.mkdtemp(prefix="clear-")
    cert_path, key_path = os.path.join(d, "c.pem"), os.path.join(d, "k.pem")
    try:
        for path, data in ((cert_path, cert_pem), (key_path, key_pem)):
            fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(fd, "w") as fh:
                fh.write(data)
        try:
            ctx.load_cert_chain(cert_path, key_path)
        except ssl.SSLError as exc:
            raise ValueError("The CLEAR client certificate / private key could not be loaded "
                             "(check both are PEM and belong together).") from exc
    finally:
        for path in (cert_path, key_path):
            try:
                os.remove(path)
            except OSError:
                pass
        try:
            os.rmdir(d)
        except OSError:
            pass
    return ctx


class ClearClient:
    simulated = False

    def __init__(self, base_url: str, creds: Dict[str, str], config: Optional[dict] = None):
        cert, key = creds.get("client_cert_pem"), creds.get("client_key_pem")
        if not cert or not key:
            raise ValueError("CLEAR live mode needs the client certificate and private key.")
        self._base = base_url.rstrip("/")
        self._ssl = client_ssl_context(cert, key)
        self._auth = (creds["username"], creds["password"]) if creds.get("username") and creds.get("password") else None
        cfg = config or {}
        self._search_path = cfg.get("search_path") or DEFAULT_SEARCH_PATH
        self._report_path = cfg.get("report_path") or DEFAULT_REPORT_PATH

    def _post(self, path: str, xml: str) -> Dict[str, Any]:
        headers = {"Content-Type": "application/xml", "Accept": "application/xml"}
        if self._auth:
            import base64
            token = base64.b64encode(f"{self._auth[0]}:{self._auth[1]}".encode()).decode()
            headers["Authorization"] = f"Basic {token}"
        resp = request("POST", self._base + path, headers=headers, content=xml.encode("utf-8"),
                       verify=self._ssl, limiter=_LIMITER, limiter_key="clear")
        root = etree.fromstring(resp.content, parser=etree.XMLParser(resolve_entities=False, no_network=True))
        return {etree.QName(root).localname: xml_to_dict(root)}

    def test(self) -> dict:
        # A harmless search proves the certificate + credentials are accepted.
        self.search("Connection Test", glb="test", dppa="test")
        return {"ok": True, "message": "CLEAR accepted the client certificate."}

    def search(self, name: str, *, glb: str, dppa: str, country: Optional[str] = None,
               is_person: bool = False) -> List[dict]:
        data = self._post(self._search_path, _search_xml(name, glb, dppa, country, is_person))
        candidates: List[dict] = []

        def visit(node):
            if isinstance(node, dict):
                gid = node.get("GroupId") or node.get("RecordId") or node.get("ReportId")
                nm = node.get("Name") or node.get("BusinessName") or node.get("FullName")
                if gid and nm:
                    candidates.append({"id": str(gid), "name": nm if isinstance(nm, str) else str(nm),
                                       "address": node.get("Address") if isinstance(node.get("Address"), str) else None})
                for v in node.values():
                    visit(v)
            elif isinstance(node, list):
                for v in node:
                    visit(v)

        visit(data)
        return candidates

    def report(self, candidate_id: str, *, glb: str, dppa: str, name: str = "") -> Dict[str, Any]:
        xml = (f'<?xml version="1.0" encoding="UTF-8"?><ReportRequest>'
               f"<PermissiblePurpose><GLB>{escape(glb)}</GLB><DPPA>{escape(dppa)}</DPPA></PermissiblePurpose>"
               f"<GroupId>{escape(candidate_id)}</GroupId></ReportRequest>")
        data = self._post(self._report_path, xml)
        return {"report_id": candidate_id, "report": data}
