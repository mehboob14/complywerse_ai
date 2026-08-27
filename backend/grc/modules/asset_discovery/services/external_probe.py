"""Stage 5 — active probe of discovered EXTERNAL (outside-in / EASM) assets.

Stage 2 turns a domain seed into internet-facing, unmanaged `ITAsset` rows
(resolver `_create_from` / `_mark_internet_facing`: source='external',
discovery_state='unmanaged', internet_facing=True, an fqdn, usually no ip). Those
rows are evidence that a public face EXISTS — they say nothing about what is
actually listening there. This stage reaches back out to each one and records the
EASM PARAMETERS an attacker (or a defender grading their own surface) sees first:

  * HTTP on 80/443 — live?, status, page <title>, `Server` banner, **response
    time**, final URL / HTTPS redirect, content type+length, and the standard
    **security response headers** (HSTS, CSP, X-Frame-Options, …);
  * the TLS certificate + negotiated channel on 443 — issuer, subject, SANs,
    notBefore/notAfter, days-to-expiry, expired?, self-signed?, protocol version
    and cipher — read even when the cert is bad (that IS the finding);
  * DNS + email authentication — A / MX / NS records and SPF / DMARC / CAA.

From those parameters `compute_health_score` derives a 0–100 **health score** and
an A–F grade — the external asset's security-hygiene report card, computed on
outside-in signals alone (no CIA, no credentialed scan). Categories with no
applicable data drop their weight from the denominator, mirroring risk_posture.

The `Server` banner is also mapped (naively — common web servers only) to a CPE
and written as a `SoftwareIdentifier`, feeding the EXISTING vulnerability
machinery: Path B relinks the just-probed asset to the tenant's ALREADY-KNOWN
CVE-bearing vulnerabilities whose NVD affected-configurations match that CPE.

Isolation / safety, mirroring `deep_collect.deep_collect_run`:
  * every asset is probed inside its own `db.begin_nested()` savepoint;
  * `probe_asset` NEVER raises — a dead host / TLS failure / junk banner all come
    back as recorded facts, not exceptions;
  * bounded per run so a big external surface can't fan out into thousands of
    outbound requests in one pass.

NOTE: all `grc.*` imports are deliberately LAZY (inside the functions) so this
file is runnable directly (`python external_probe.py`) for its self-checks.
"""
from __future__ import annotations

import logging
import re
import socket
import ssl
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

import requests

logger = logging.getLogger(__name__)

# verify=False is intentional on every probe (a self-signed / expired cert is a
# finding, not an error) — silence the per-request InsecureRequestWarning.
try:  # pragma: no cover - defensive import guard
    import urllib3

    urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
except Exception:
    pass

PROBE_TIMEOUT = 5           # seconds, per outbound touch (HTTP / TLS socket / DNS)
MAX_TITLE_SCAN = 200_000    # only scan the head of a page for its <title>
# ponytail: flat per-run cap on outbound probes; page a huge surface across runs
# rather than raising this into the thousands.
MAX_EXTERNAL_PROBE_PER_RUN = 128

_TITLE_RE = re.compile(r"<title[^>]*>(.*?)</title>", re.IGNORECASE | re.DOTALL)

# ponytail: naive banner→CPE for common web servers ONLY. The `Server` header is
# self-reported and often stripped/faked; this recognises the four we see on ~all
# real HTTP surfaces and returns None for everything else.
_SERVER_CPE = {
    "nginx": ("nginx", "nginx"),
    "apache": ("apache", "http_server"),
    "httpd": ("apache", "http_server"),
    "openresty": ("openresty", "openresty"),
    "iis": ("microsoft", "iis"),
    "microsoft-iis": ("microsoft", "iis"),
}

# The standard security response headers an external asset SHOULD set. Header name
# (case-insensitive; requests uses a CaseInsensitiveDict) → the short fact key.
_SEC_HEADERS = {
    "Strict-Transport-Security": "hsts",
    "Content-Security-Policy": "csp",
    "X-Frame-Options": "x_frame_options",
    "X-Content-Type-Options": "x_content_type_options",
    "Referrer-Policy": "referrer_policy",
    "Permissions-Policy": "permissions_policy",
}


# ── Pure probe primitives (no DB) ────────────────────────────────────────────

def _extract_title(html: str) -> Optional[str]:
    """First <title> in the page head, whitespace-collapsed and length-capped."""
    if not html:
        return None
    m = _TITLE_RE.search(html)
    if not m:
        return None
    title = re.sub(r"\s+", " ", m.group(1)).strip()
    return title[:300] or None


def _security_headers(headers) -> Tuple[Dict[str, str], List[str]]:
    """Split the standard security headers into (present {key: value}, missing
    [keys]). `headers` is a case-insensitive dict."""
    present: Dict[str, str] = {}
    missing: List[str] = []
    for hdr, key in _SEC_HEADERS.items():
        val = headers.get(hdr)
        if val:
            present[key] = str(val)[:200]
        else:
            missing.append(key)
    return present, missing


_CDN_WAF_HINTS = (
    ("cf-ray", "Cloudflare"),
    ("cf-cache-status", "Cloudflare"),
    ("x-akamai-request-id", "Akamai"),
    ("x-akamai-transformed", "Akamai"),
    ("x-amz-cf-id", "CloudFront"),
    ("x-fastly-request-id", "Fastly"),
    ("x-sucuri-id", "Sucuri"),
    ("x-iinfo", "Incapsula"),
    ("x-cdn", "CDN"),
)


def _cdn_waf(headers) -> Optional[str]:
    """Best-effort CDN/WAF fingerprint from response headers. None = not seen
    (unknown — absence is not treated as unprotected)."""
    if headers is None:
        return None
    for hdr, name in _CDN_WAF_HINTS:
        if headers.get(hdr):
            return name
    server = str(headers.get("Server") or "").lower()
    via = str(headers.get("Via") or "").lower()
    blob = f"{server} {via}"
    for token, name in (
        ("cloudflare", "Cloudflare"), ("akamai", "Akamai"), ("fastly", "Fastly"),
        ("cloudfront", "CloudFront"), ("sucuri", "Sucuri"),
    ):
        if token in blob:
            return name
    return None


def _set_cookies(resp) -> List[str]:
    """Every Set-Cookie on the winning HTTP response, capped."""
    try:
        raw = getattr(resp, "raw", None)
        if raw is not None and hasattr(raw, "headers"):
            vals = raw.headers.get_all("Set-Cookie") or []
            return [str(v)[:300] for v in vals[:20]]
    except Exception:
        pass
    one = resp.headers.get("Set-Cookie") if resp is not None else None
    return [str(one)[:300]] if one else []


def _cookie_flags(cookies: List[str]) -> Dict[str, bool]:
    if not cookies:
        return {}
    blob = " ".join(cookies).lower()
    return {
        "secure": "secure" in blob,
        "httponly": "httponly" in blob,
        "samesite": "samesite" in blob,
    }


def _probe_tls(fqdn: str, facts: Dict[str, Any]) -> None:
    """Read the 443 certificate + negotiated channel into `facts`, even when the
    cert is self-signed/expired. CERT_NONE captures a bad cert instead of raising;
    the cert is pulled in DER form and parsed with `cryptography`. Any failure
    lands in `tls_error`, never propagated."""
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    der = None
    try:
        with socket.create_connection((fqdn, 443), timeout=PROBE_TIMEOUT) as raw:
            with ctx.wrap_socket(raw, server_hostname=fqdn) as ssock:
                facts["https_available"] = True
                facts["tls_version"] = ssock.version()          # e.g. "TLSv1.3"
                ciph = ssock.cipher()
                facts["tls_cipher"] = ciph[0] if ciph else None
                der = ssock.getpeercert(binary_form=True)
    except Exception as exc:  # noqa: BLE001 — a dead/closed 443 is a fact, not a crash
        facts["tls_error"] = f"{type(exc).__name__}: {exc}"[:200]
        return
    if not der:
        facts["tls_error"] = "no certificate presented"
        return
    try:
        from cryptography import x509
        from cryptography.x509.oid import ExtensionOID, NameOID

        def _cn(name) -> Optional[str]:
            try:
                attrs = name.get_attributes_for_oid(NameOID.COMMON_NAME)
                if attrs:
                    return str(attrs[0].value)
            except Exception:
                pass
            try:
                return name.rfc4514_string()
            except Exception:
                return None

        cert = x509.load_der_x509_certificate(der)
        facts["tls_subject_cn"] = _cn(cert.subject)
        facts["tls_issuer"] = _cn(cert.issuer)
        facts["tls_self_signed"] = bool(cert.subject == cert.issuer)
        try:
            san = cert.extensions.get_extension_for_oid(ExtensionOID.SUBJECT_ALTERNATIVE_NAME)
            facts["tls_sans"] = san.value.get_values_for_type(x509.DNSName)[:50]
        except Exception:
            facts["tls_sans"] = []
        nb = getattr(cert, "not_valid_before_utc", None) or cert.not_valid_before
        facts["tls_not_before"] = nb.isoformat() if nb else None
        expiry = getattr(cert, "not_valid_after_utc", None) or cert.not_valid_after
        facts["tls_not_after"] = expiry.isoformat() if expiry else None
        now = datetime.now(expiry.tzinfo) if expiry and expiry.tzinfo else datetime.utcnow()
        facts["tls_expired"] = bool(expiry and expiry < now)
        facts["tls_days_to_expiry"] = (expiry - now).days if expiry else None
    except Exception as exc:  # noqa: BLE001 — a malformed cert is a fact too
        facts["tls_error"] = f"parse: {type(exc).__name__}: {exc}"[:200]


def _probe_dns(fqdn: str, facts: Dict[str, Any]) -> None:
    """DNS + email-authentication records (A / MX / NS / SPF / DMARC / CAA).
    dnspython is a project dep, imported lazily. Best-effort — every lookup
    failure is just an empty/absent fact, never an exception."""
    try:
        import dns.resolver
    except Exception:
        return
    r = dns.resolver.Resolver()
    r.lifetime = PROBE_TIMEOUT
    r.timeout = PROBE_TIMEOUT

    def q(name: str, rtype: str) -> List[str]:
        try:
            return [str(x).strip().strip('"') for x in r.resolve(name, rtype)][:20]
        except Exception:
            return []

    facts["dns_a"] = q(fqdn, "A")
    facts["dns_mx"] = q(fqdn, "MX")
    facts["dns_ns"] = q(fqdn, "NS")
    txt = q(fqdn, "TXT")
    facts["spf"] = next((t for t in txt if "v=spf1" in t.lower()), None)
    dmarc = q("_dmarc." + fqdn, "TXT")
    facts["dmarc"] = next((t for t in dmarc if "v=dmarc1" in t.lower()), None)
    dkim = q("default._domainkey." + fqdn, "TXT")
    facts["dkim"] = next(
        (t for t in dkim if "v=dkim1" in t.lower() or "k=rsa" in t.lower()), None
    ) or (dkim[0] if dkim else None)
    facts["caa"] = q(fqdn, "CAA")


def probe_asset(fqdn: str, ip: Optional[str] = None) -> dict:
    """Touch one external host and return a FLAT dict of its EASM parameters.

    NEVER raises: an unreachable host, a hostile server, a broken cert — all come
    back as recorded facts. HTTP is tried on 443 then 80 (first responder wins);
    the TLS cert and DNS are read independently so a host with no working HTTP
    still yields cert + DNS facts."""
    facts: Dict[str, Any] = {
        "fqdn": fqdn, "ip": ip, "live": False, "scheme": None,
        "status_code": None, "title": None, "server": None,
        # ── availability / HTTP ──
        "response_time_ms": None, "final_url": None, "redirected_to_https": None,
        "content_type": None, "content_length": None,
        # ── security headers ──
        "security_headers": {}, "missing_security_headers": [],
        # ── TLS / cert ──
        "https_available": False,
        "tls_subject_cn": None, "tls_issuer": None, "tls_sans": None,
        "tls_not_before": None, "tls_not_after": None, "tls_expired": None,
        "tls_days_to_expiry": None, "tls_version": None, "tls_cipher": None,
        "tls_self_signed": None, "tls_error": None,
        # ── DNS / email auth ──
        "dns_a": None, "dns_mx": None, "dns_ns": None,
        "spf": None, "dmarc": None, "dkim": None, "caa": None,
        "set_cookies": [], "cdn_waf": None,
        "probed_at": datetime.utcnow().isoformat() + "Z",
    }
    if not fqdn:
        return facts

    for scheme in ("https", "http"):
        try:
            resp = requests.get(f"{scheme}://{fqdn}", timeout=PROBE_TIMEOUT,
                                verify=False, allow_redirects=True)
        except Exception:  # noqa: BLE001 — try the other scheme, then give up quietly
            continue
        facts["live"] = True
        facts["scheme"] = scheme
        facts["status_code"] = resp.status_code
        facts["server"] = resp.headers.get("Server")
        facts["response_time_ms"] = round(resp.elapsed.total_seconds() * 1000)
        facts["final_url"] = str(resp.url)[:500]
        facts["redirected_to_https"] = str(resp.url).lower().startswith("https://")
        facts["content_type"] = resp.headers.get("Content-Type")
        try:
            facts["content_length"] = int(resp.headers.get("Content-Length") or len(resp.content))
        except Exception:
            facts["content_length"] = None
        present, missing = _security_headers(resp.headers)
        facts["security_headers"] = present
        facts["missing_security_headers"] = missing
        facts["set_cookies"] = _set_cookies(resp)
        facts["cdn_waf"] = _cdn_waf(resp.headers)
        try:
            facts["title"] = _extract_title((resp.text or "")[:MAX_TITLE_SCAN])
        except Exception:
            facts["title"] = None
        break

    _probe_tls(fqdn, facts)
    _probe_dns(fqdn, facts)
    return facts


# ── Health score (pure — grades the parameters above) ────────────────────────

def _grade(score: int) -> str:
    return ("A" if score >= 90 else "B" if score >= 80 else "C" if score >= 70
            else "D" if score >= 55 else "F")


def compute_health_score(facts: Dict[str, Any], *, cve_count: int = 0,
                         kev_count: int = 0) -> Dict[str, Any]:
    """Grade an external asset's CONFIGURATION HYGIENE from probe facts.

    Returns {score: 0-100 (higher = HEALTHIER), grade: A-F, components, weights}.
    CVEs/KEVs are deliberately NOT part of health — they belong on the risk
    model (exploitability). ``cve_count``/``kev_count`` are accepted so old
    callers don't break, then ignored.

    Unknown dimensions drop their weight from the denominator so a host we
    couldn't reach isn't graded on headers it never sent.
    """
    del cve_count, kev_count  # exploitability lives on the risk card
    live = bool(facts.get("live"))
    comps: Dict[str, Dict[str, Any]] = {}

    HEALTH_LABELS = {
        "tls": "TLS / certificate",
        "headers": "Security headers",
        "transport": "HTTPS / redirects",
        "hsts": "HSTS",
        "cookies": "Cookie flags",
        "latency": "Response time",
        "email": "Email auth (SPF/DMARC/DKIM)",
        "cdn": "CDN / WAF",
    }

    # 1) TLS (0.20)
    tls_err = facts.get("tls_error")
    if facts.get("tls_not_after") or tls_err:
        s = 1.0
        detail: List[str] = []
        if tls_err or not facts.get("tls_not_after"):
            s = 0.0
            detail.append("no valid certificate")
        else:
            if facts.get("tls_expired"):
                s -= 0.6
                detail.append("expired")
            if facts.get("tls_self_signed"):
                s -= 0.3
                detail.append("self-signed")
            ver = str(facts.get("tls_version") or "")
            if "1.0" in ver or "1.1" in ver:
                s -= 0.3
                detail.append("outdated TLS")
            cipher = str(facts.get("tls_cipher") or "").upper()
            if any(w in cipher for w in ("RC4", "3DES", "NULL", "EXPORT")):
                s -= 0.3
                detail.append("weak cipher")
            d2e = facts.get("tls_days_to_expiry")
            if isinstance(d2e, (int, float)) and 0 <= d2e < 30:
                s -= 0.2
                detail.append("expiring <30d")
        comps["tls"] = {"score": max(0.0, s), "weight": 0.20,
                        "detail": ", ".join(detail) or (facts.get("tls_version") or "valid, current")}
    elif live and facts.get("scheme") == "http":
        comps["tls"] = {"score": 0.0, "weight": 0.20, "detail": "no HTTPS"}

    # 2) Security headers (0.14)
    if live:
        n_expected = len(_SEC_HEADERS)
        n_present = len(facts.get("security_headers") or {})
        comps["headers"] = {"score": n_present / n_expected if n_expected else 0.0,
                            "weight": 0.14,
                            "detail": f"{n_present}/{n_expected} present"}

    # 3) Transport — HTTPS + HTTP→HTTPS redirect (0.12). HSTS is its own row.
    if live:
        s = 0.0
        detail = []
        if facts.get("https_available") or facts.get("scheme") == "https":
            s += 0.6
        else:
            detail.append("no HTTPS")
        if facts.get("redirected_to_https"):
            s += 0.4
        elif facts.get("scheme") == "http":
            detail.append("no HTTPS redirect")
        comps["transport"] = {"score": min(1.0, s), "weight": 0.12,
                              "detail": ", ".join(detail) or "HTTPS enforced"}

    # 4) HSTS (0.08)
    if live:
        has_hsts = bool((facts.get("security_headers") or {}).get("hsts"))
        comps["hsts"] = {"score": 1.0 if has_hsts else 0.0, "weight": 0.08,
                         "detail": "HSTS set" if has_hsts else "no HSTS"}

    # 5) Cookie flags (0.08) — only when the host actually sets cookies.
    cookies = facts.get("set_cookies") or []
    if live and cookies:
        flags = _cookie_flags(cookies)
        n = sum(1 for v in flags.values() if v)
        missing = [k for k, v in flags.items() if not v]
        comps["cookies"] = {
            "score": n / 3.0, "weight": 0.08,
            "detail": ("missing " + ", ".join(missing)) if missing else "Secure + HttpOnly + SameSite",
        }

    # 6) Response time (0.08)
    rt = facts.get("response_time_ms")
    if live and isinstance(rt, (int, float)):
        if rt < 300:
            s, detail = 1.0, f"{int(rt)} ms"
        elif rt < 800:
            s, detail = 0.7, f"{int(rt)} ms"
        elif rt < 2000:
            s, detail = 0.4, f"{int(rt)} ms (slow)"
        else:
            s, detail = 0.15, f"{int(rt)} ms (very slow)"
        comps["latency"] = {"score": s, "weight": 0.08, "detail": detail}

    # 7) Email auth (0.15) — only where the name receives mail (MX).
    if facts.get("dns_mx"):
        s = 0.0
        detail = []
        if facts.get("spf"):
            s += 0.4
        else:
            detail.append("no SPF")
        if facts.get("dmarc"):
            s += 0.4
        else:
            detail.append("no DMARC")
        if facts.get("dkim"):
            s += 0.2
        else:
            detail.append("no DKIM")
        comps["email"] = {"score": s, "weight": 0.15,
                          "detail": ", ".join(detail) or "SPF + DMARC + DKIM"}

    # 8) CDN/WAF (0.15) — known only when a fingerprint is present. Absence is
    #    unknown (header hiding is common), not a failing grade.
    cdn = facts.get("cdn_waf")
    if cdn:
        comps["cdn"] = {"score": 1.0, "weight": 0.15, "detail": str(cdn)}

    reachable = (live or bool(facts.get("tls_not_after")) or bool(facts.get("tls_error"))
                 or bool(facts.get("dns_a")))
    if not reachable:
        return {"score": None, "grade": None, "components": comps,
                "reason": "unreachable — no signals to grade"}

    total_w = sum(c["weight"] for c in comps.values())
    if total_w == 0:
        return {"score": None, "grade": None, "components": comps,
                "reason": "unreachable — no signals to grade"}
    for key, c in comps.items():
        c["label"] = HEALTH_LABELS.get(key, key)
        c["weight_pct"] = round(c["weight"] / total_w * 100)
    score = round(sum(c["score"] * c["weight"] for c in comps.values()) / total_w * 100)
    return {
        "score": score,
        "grade": _grade(score),
        "components": comps,
        "weights": {k: c["weight"] for k, c in comps.items()},
    }


def banner_to_cpe(server_header: Optional[str]) -> Optional[str]:
    """Map a `Server` header to a CPE 2.3 string for the common web servers, else
    None. Parses "nginx/1.18.0", "Apache/2.4.41 (Ubuntu)", "Microsoft-IIS/10.0".

    # ponytail: web servers only; a real CPE-dictionary lookup comes later."""
    if not isinstance(server_header, str):
        return None
    parts = server_header.strip().split()
    if not parts:
        return None
    name, _, version = parts[0].partition("/")
    mapping = _SERVER_CPE.get(name.strip().lower())
    if mapping is None:
        return None
    vendor, product = mapping
    ver = version.strip() or "*"
    return f"cpe:2.3:a:{vendor}:{product}:{ver}:*:*:*:*:*:*:*"


# ── DB orchestration ─────────────────────────────────────────────────────────

def _ensure_software_identifier(db, asset, cpe: str) -> bool:
    """Write a CPE `SoftwareIdentifier` for this asset, guarded on the
    (tenant_id, asset_id, identifier) unique key. Returns True on a new row."""
    from grc.models import SoftwareIdentifier
    from grc.services.cpe_matcher import parse_cpe

    exists = (
        db.query(SoftwareIdentifier.id)
        .filter(
            SoftwareIdentifier.tenant_id == asset.tenant_id,
            SoftwareIdentifier.asset_id == asset.id,
            SoftwareIdentifier.identifier == cpe,
        )
        .first()
    )
    if exists:
        return False

    parsed = parse_cpe(cpe)

    def _comp(value: Optional[str]) -> Optional[str]:
        return value if value and value not in ("*", "-") else None

    db.add(SoftwareIdentifier(
        tenant_id=asset.tenant_id,
        asset_id=asset.id,
        identifier_type="cpe",
        identifier=cpe,
        vendor=_comp(parsed.vendor if parsed else None),
        product=_comp(parsed.product if parsed else None),
        version=_comp(parsed.version if parsed else None),
        source="external",
    ))
    db.flush()
    return True


def _link_known_vulns(db, tenant_id: int, asset_ids: set) -> int:
    """Path B — link the just-probed assets to the tenant's ALREADY-KNOWN
    CVE-bearing vulnerabilities whose NVD affected-configs match the CPE(s) we
    wrote this run. Mirrors grc.tasks.vulnerabilities.run_cpe_matcher_for_vuln.
    Gated behind VULN_AUTO_LINK_ASSETS (default OFF)."""
    if not asset_ids:
        return 0

    from grc.services.cpe_matcher import auto_link_enabled
    if not auto_link_enabled():
        return 0

    from grc.models import Vulnerability
    from grc.modules.vuln_management.enrichment.nvd_client import fetch_nvd
    from grc.services.cpe_matcher import match_cve_to_asset_ids, write_auto_links

    vulns = (
        db.query(Vulnerability)
        .filter(
            Vulnerability.tenant_id == tenant_id,
            Vulnerability.cve_id.isnot(None),
        )
        .all()
    )

    created = 0
    nvd_configs: Dict[str, Any] = {}
    for v in vulns:
        cve = (v.cve_id or "").upper().strip()
        if not cve:
            continue
        try:
            if cve not in nvd_configs:
                nvd = fetch_nvd(cve)
                nvd_configs[cve] = nvd.configurations if (nvd and nvd.configurations) else None
            configs = nvd_configs[cve]
            if not configs:
                continue
            matched = match_cve_to_asset_ids(
                db, tenant_id=tenant_id, cve_id=cve, configurations=configs,
            )
            targets = [a for a in matched if a in asset_ids]
            if targets:
                created += write_auto_links(
                    db, vuln_id=v.id, tenant_id=tenant_id, asset_ids=targets,
                )
            db.commit()
        except Exception as exc:  # noqa: BLE001 — one vuln's failure never stops the rest
            db.rollback()
            logger.info("external_probe: vuln %s link pass failed: %s",
                        getattr(v, "id", "?"), exc)
            continue
    return created


def _asset_cve_count(db, asset_id: int) -> int:
    """How many vulnerabilities are already linked to this asset. Best-effort (0 on any error)."""
    try:
        from grc.models import VulnerabilityAssetLink
        return int(
            db.query(VulnerabilityAssetLink)
            .filter(VulnerabilityAssetLink.asset_id == asset_id)
            .count()
        )
    except Exception:
        return 0


def _asset_kev_count(db, asset_id: int) -> int:
    """Linked findings flagged CISA KEV. Best-effort (0 on any error)."""
    try:
        from grc.models import Vulnerability, VulnerabilityAssetLink
        return int(
            db.query(VulnerabilityAssetLink)
            .join(Vulnerability, Vulnerability.id == VulnerabilityAssetLink.vulnerability_id)
            .filter(
                VulnerabilityAssetLink.asset_id == asset_id,
                Vulnerability.kev_flag.is_(True),
            )
            .count()
        )
    except Exception:
        return 0


def probe_external_run(db, run_id: int) -> Dict[str, int]:
    """Actively probe every external, resolved asset from a run: record the EASM
    parameters, compute a health score, write banner CPEs, relink known CVEs.
    Best-effort and per-asset isolated. Returns a summary tally."""
    from grc.models import DiscoveryObservation, DiscoveryRun, ITAsset

    run = db.get(DiscoveryRun, run_id)
    if run is None:
        return {"probed": 0, "live": 0, "identifiers_written": 0,
                "links_created": 0, "skipped": 0}

    obs_rows = (
        db.query(DiscoveryObservation)
        .filter(
            DiscoveryObservation.run_id == run_id,
            DiscoveryObservation.source == "external",
            DiscoveryObservation.resolution.in_(("created", "merged")),
            DiscoveryObservation.resolved_asset_id.isnot(None),
        )
        .all()
    )

    probed = live = identifiers_written = skipped = 0
    seen_assets: set = set()
    probed_asset_ids: set = set()

    for obs in obs_rows:
        if probed >= MAX_EXTERNAL_PROBE_PER_RUN:
            logger.info("external_probe: run %s hit the per-run cap", run_id)
            break
        aid = obs.resolved_asset_id
        if aid in seen_assets:
            continue
        seen_assets.add(aid)
        asset = db.get(ITAsset, aid)
        if asset is None:
            continue
        target = asset.fqdn or asset.host_name
        if not target:
            skipped += 1
            continue

        facts: Optional[Dict[str, Any]] = None
        has_cpe = False
        try:
            with db.begin_nested():
                facts = probe_asset(target, asset.ip_address)
                # Health grade from the captured parameters + this asset's already
                # linked CVEs. Stored inside the same external_probe block the UI
                # reads. (Uses existing links; a re-probe after auto-link reflects
                # any new ones.)
                cve_n = _asset_cve_count(db, asset.id)
                kev_n = _asset_kev_count(db, asset.id)
                facts["cve_count"] = cve_n
                facts["kev_count"] = kev_n
                facts["cve_detection"] = {
                    "method": "banner_cpe_plus_linked_findings",
                    "banner": facts.get("server"),
                    "banner_cpe": banner_to_cpe(facts.get("server")),
                    "linked_findings": cve_n,
                    "kev_findings": kev_n,
                    "limits": (
                        "Server-banner → CPE is a heuristic (the header is self-reported "
                        "and often stripped). We also count findings already linked to this "
                        "asset (Nessus import). This is not an active exploit test."
                    ),
                }
                facts["health"] = compute_health_score(facts)
                pp = dict(asset.platform_properties or {})
                pp["external_probe"] = facts
                asset.platform_properties = pp
                db.add(asset)

                cpes = set((obs.raw or {}).get("cpes") or [])
                banner_cpe = banner_to_cpe(facts.get("server"))
                if banner_cpe:
                    cpes.add(banner_cpe)
                for cpe in cpes:
                    has_cpe = True
                    if _ensure_software_identifier(db, asset, cpe):
                        identifiers_written += 1
            db.commit()
        except Exception as exc:  # noqa: BLE001 — isolate this asset, keep the run going
            db.rollback()
            logger.info("external_probe: asset %s failed: %s", aid, exc)
            continue

        probed += 1
        if facts and facts.get("live"):
            live += 1
        if has_cpe:
            probed_asset_ids.add(asset.id)

    links_created = _link_known_vulns(db, run.tenant_id, probed_asset_ids)

    return {"probed": probed, "live": live, "identifiers_written": identifiers_written,
            "links_created": links_created, "skipped": skipped}


if __name__ == "__main__":  # pragma: no cover - runnable offline self-checks
    # banner → CPE
    assert banner_to_cpe("nginx/1.18.0") == "cpe:2.3:a:nginx:nginx:1.18.0:*:*:*:*:*:*:*"
    assert banner_to_cpe("Apache/2.4.41 (Ubuntu)") == "cpe:2.3:a:apache:http_server:2.4.41:*:*:*:*:*:*:*"
    assert banner_to_cpe("httpd/2.4.6") == "cpe:2.3:a:apache:http_server:2.4.6:*:*:*:*:*:*:*"
    assert banner_to_cpe("Microsoft-IIS/10.0") == "cpe:2.3:a:microsoft:iis:10.0:*:*:*:*:*:*:*"
    assert banner_to_cpe("openresty/1.19.3.1") == "cpe:2.3:a:openresty:openresty:1.19.3.1:*:*:*:*:*:*:*"
    assert banner_to_cpe("nginx") == "cpe:2.3:a:nginx:nginx:*:*:*:*:*:*:*:*"
    assert banner_to_cpe("CustomServer/9.9") is None
    assert banner_to_cpe("") is None
    assert banner_to_cpe(None) is None
    assert banner_to_cpe(b"nginx/1.0") is None  # type: ignore[arg-type]

    # health score — hygiene only (CVEs are NOT in this grade).
    _good = {
        "live": True, "scheme": "https", "https_available": True,
        "redirected_to_https": True, "tls_not_after": "2027-01-01T00:00:00",
        "tls_expired": False, "tls_self_signed": False, "tls_version": "TLSv1.3",
        "tls_days_to_expiry": 300, "response_time_ms": 120,
        "security_headers": {"hsts": "x", "csp": "x", "x_frame_options": "x",
                             "x_content_type_options": "x", "referrer_policy": "x",
                             "permissions_policy": "x"},
        "set_cookies": ["session=abc; Secure; HttpOnly; SameSite=Lax"],
        "cdn_waf": "Cloudflare",
        "dns_mx": ["10 mail"], "spf": "v=spf1 -all", "dmarc": "v=DMARC1; p=reject",
        "dkim": "v=DKIM1; k=rsa; p=x"}
    _hg = compute_health_score(_good, cve_count=0)
    assert _hg["grade"] == "A" and _hg["score"] == 100, _hg
    assert "vuln" not in _hg["components"]
    _bad = {
        "live": True, "scheme": "http", "https_available": False,
        "tls_error": "ConnectionRefusedError", "security_headers": {},
        "missing_security_headers": list(_SEC_HEADERS.values()),
        "dns_mx": ["10 mail"], "spf": None, "dmarc": None}
    _hb = compute_health_score(_bad, cve_count=3)
    assert _hb["grade"] in ("D", "F") and _hb["score"] < _hg["score"], _hb
    assert "vuln" not in _hb["components"]  # CVEs are a risk input, not hygiene
    # A host we never reached and that has no cert/DNS is UNGRADED, not falsely A.
    _hn = compute_health_score({"live": False}, cve_count=0)
    assert _hn["grade"] is None and _hn.get("reason"), _hn
    print(f"external_probe self-check OK - banner-to-CPE + health score "
          f"(A={_hg['score']}, F={_hb['score']})")
