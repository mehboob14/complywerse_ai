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
        "spf": None, "dmarc": None, "caa": None,
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
    """Grade an external asset's security hygiene from its probe facts.

    Returns {score: 0-100 (higher = HEALTHIER), grade: A-F, components: {...}}.
    Pure — no I/O — so it is unit-testable offline. Each category yields a 0-1
    sub-score with a weight; categories with no applicable data drop their weight
    from the denominator (same pattern as risk_posture), so a host we couldn't
    reach isn't graded on headers it never got to send."""
    live = bool(facts.get("live"))
    comps: Dict[str, Dict[str, Any]] = {}

    # 1) TLS hygiene (0.25) — a valid, current, modern cert vs expired/self-signed
    #    /missing. An http-only host that serves NO https at all is a TLS failure,
    #    not "unknown".
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
            d2e = facts.get("tls_days_to_expiry")
            if isinstance(d2e, (int, float)) and 0 <= d2e < 30:
                s -= 0.2
                detail.append("expiring <30d")
        comps["tls"] = {"score": max(0.0, s), "weight": 0.25,
                        "detail": ", ".join(detail) or "valid, current"}
    elif live and facts.get("scheme") == "http":
        comps["tls"] = {"score": 0.0, "weight": 0.25, "detail": "no HTTPS"}

    # 2) Security headers (0.25) — fraction of the standard set present.
    if live:
        n_expected = len(_SEC_HEADERS)
        n_present = len(facts.get("security_headers") or {})
        comps["headers"] = {"score": n_present / n_expected, "weight": 0.25,
                            "detail": f"{n_present}/{n_expected} present"}

    # 3) Transport (0.15) — HTTPS reachable, HTTP redirects to it, HSTS set.
    if live:
        s = 0.0
        detail = []
        if facts.get("https_available") or facts.get("scheme") == "https":
            s += 0.5
        else:
            detail.append("no HTTPS")
        if facts.get("redirected_to_https"):
            s += 0.3
        elif facts.get("scheme") == "http":
            detail.append("no HTTPS redirect")
        if (facts.get("security_headers") or {}).get("hsts"):
            s += 0.2
        comps["transport"] = {"score": min(1.0, s), "weight": 0.15,
                              "detail": ", ".join(detail) or "HTTPS enforced"}

    # 4) Email security (0.15) — only where the name actually receives mail (MX).
    if facts.get("dns_mx"):
        s = 0.0
        detail = []
        if facts.get("spf"):
            s += 0.5
        else:
            detail.append("no SPF")
        if facts.get("dmarc"):
            s += 0.5
        else:
            detail.append("no DMARC")
        comps["email"] = {"score": s, "weight": 0.15,
                          "detail": ", ".join(detail) or "SPF + DMARC set"}

    # A host we never reached (no HTTP, no TLS attempt, no DNS A) can't be graded
    # — don't let a "0 CVEs" vuln score alone fake an A for a dead / dangling name.
    reachable = (live or bool(facts.get("tls_not_after")) or bool(facts.get("tls_error"))
                 or bool(facts.get("dns_a")))
    if not reachable:
        return {"score": None, "grade": None, "components": comps,
                "reason": "unreachable — no signals to grade"}

    # 5) Known vulnerabilities (0.20) — a KEV on an exposed host is worst-case.
    vuln_s = 1.0
    detail = []
    if kev_count:
        vuln_s = 0.0
        detail.append(f"{kev_count} KEV")
    elif cve_count:
        vuln_s = max(0.0, 1.0 - 0.2 * cve_count)
        detail.append(f"{cve_count} CVE")
    comps["vuln"] = {"score": vuln_s, "weight": 0.20,
                     "detail": ", ".join(detail) or "no known CVEs"}

    total_w = sum(c["weight"] for c in comps.values())
    if total_w == 0:
        return {"score": None, "grade": None, "components": comps,
                "reason": "unreachable — no signals to grade"}
    score = round(sum(c["score"] * c["weight"] for c in comps.values()) / total_w * 100)
    return {"score": score, "grade": _grade(score), "components": comps}


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
    """How many vulnerabilities are already linked to this asset — the vuln input
    to the health score. Best-effort (0 on any error)."""
    try:
        from grc.models import VulnerabilityAssetLink
        return int(
            db.query(VulnerabilityAssetLink)
            .filter(VulnerabilityAssetLink.asset_id == asset_id)
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
                facts["health"] = compute_health_score(
                    facts, cve_count=_asset_cve_count(db, asset.id))
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

    # health score — a clean HTTPS host with every header + email auth grades A;
    # an http-only, header-less, no-cert host with CVEs grades F, and lower.
    _good = {
        "live": True, "scheme": "https", "https_available": True,
        "redirected_to_https": True, "tls_not_after": "2027-01-01T00:00:00",
        "tls_expired": False, "tls_self_signed": False, "tls_version": "TLSv1.3",
        "tls_days_to_expiry": 300,
        "security_headers": {"hsts": "x", "csp": "x", "x_frame_options": "x",
                             "x_content_type_options": "x", "referrer_policy": "x",
                             "permissions_policy": "x"},
        "dns_mx": ["10 mail"], "spf": "v=spf1 -all", "dmarc": "v=DMARC1; p=reject"}
    _hg = compute_health_score(_good, cve_count=0)
    assert _hg["grade"] == "A" and _hg["score"] == 100, _hg
    _bad = {
        "live": True, "scheme": "http", "https_available": False,
        "tls_error": "ConnectionRefusedError", "security_headers": {},
        "missing_security_headers": list(_SEC_HEADERS.values()),
        "dns_mx": ["10 mail"], "spf": None, "dmarc": None}
    _hb = compute_health_score(_bad, cve_count=3)
    assert _hb["grade"] in ("D", "F") and _hb["score"] < _hg["score"], _hb
    # A host we never reached and that has no cert/DNS is UNGRADED, not falsely A.
    _hn = compute_health_score({"live": False}, cve_count=0)
    assert _hn["grade"] is None and _hn.get("reason"), _hn
    print(f"external_probe self-check OK - banner-to-CPE + health score "
          f"(A={_hg['score']}, F={_hb['score']})")
