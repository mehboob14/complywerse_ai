"""What each supplier's internet-facing estate shows from outside, scored and kept.

For every domain a supplier is known by (its website, and any others recorded
against it) a scan finds the names public certificate logs hold, keeps those
that resolve, and looks at each the way a visitor's browser would: the
certificate and how the connection is encrypted, whether the site insists on
HTTPS and sends the usual protective headers, and whether the domain's mail is
protected from spoofing. Where the tenant holds a Shodan key, the services
Shodan has seen listening, and the known vulnerabilities in their software, are
added. Nothing here port-scans a supplier; exposure comes from Shodan's passive
record only.

Every weakness is a finding with a severity. The score starts at 100 and each
finding takes off its severity's points, once per supplier however many hosts
share it, and no one category can take more than CATEGORY_CAP. A waiver sets a
finding aside until a date, for a reason; the score is worked out again without
it, and the finding counts once more the day the waiver lapses.
"""
from __future__ import annotations

import logging
import re
import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta
from typing import Callable, Dict, Iterable, List, Optional, Tuple

import requests
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ....models import (
    GRCUser, TPRAExternalRating, TPRAMonitoringCursor, TPRASurfaceScan, TPRASurfaceWaiver, Tenant, Vendor, get_db,
)
from ....routers.auth_router import get_user_tenants, require_auth
from . import intake, monitoring, ratings, rbac, service
from .bootstrap import get_tiering_config

logger = logging.getLogger(__name__)
router = APIRouter(tags=["Vendor outside-in security"])

PROVIDER = "Outside-in scan"
CATEGORIES = {
    "tls": "Certificates and encryption", "web": "Web hardening", "email": "Email protection",
    "exposure": "Exposed services", "vulns": "Known vulnerabilities", "software": "Out-of-date software",
}
POINTS = {"critical": 30, "high": 15, "medium": 6, "low": 2}
CATEGORY_CAP = 40
SCAN_EVERY_DAYS = {"critical": 7, "high": 30, "medium": 90, "low": 180}
MAX_DOMAINS = 10
MAX_NAMES = 60            # names taken from certificate logs per domain, before resolving
MAX_HOSTS = 12            # hosts looked at per scan, apex and www of each domain first
MAX_CVES_PER_HOST = 25
WORKERS = 6
WAIVER_MAX_DAYS = 366
RUNNING_FOR = timedelta(minutes=15)   # a scan still "running" after this is taken as lost
_INACTIVE = ("retired", "offboarded", "inactive", "terminated", "requested", "rejected")
_HOSTNAME = re.compile(r"^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$")
# Services that have no business facing the internet. Mail, web and SSH are left out:
# they are expected on a public estate.
RISKY_PORTS = {
    21: ("FTP file transfer", "high"), 23: ("Telnet", "high"), 445: ("Windows file sharing (SMB)", "high"),
    3389: ("Remote desktop (RDP)", "high"), 5900: ("VNC remote control", "high"),
    1433: ("SQL Server database", "high"), 3306: ("MySQL database", "high"), 5432: ("PostgreSQL database", "high"),
    27017: ("MongoDB database", "high"), 6379: ("Redis", "high"), 9200: ("Elasticsearch", "high"),
    11211: ("Memcached", "medium"), 161: ("SNMP", "medium"), 2375: ("Docker API", "critical"),
}
_WEAK_CIPHERS = ("RC4", "3DES", "DES-CBC", "NULL", "EXPORT", "MD5")
_OLD_PROTOCOLS = ("SSLv2", "SSLv3", "TLSv1", "TLSv1.1")


# ── domains and hosts ────────────────────────────────────────────────────────

def clean_domain(value) -> Optional[str]:
    text = intake.host(str(value or "")).split(":")[0].strip(".")
    return text if _HOSTNAME.match(text) else None


def domains_for(vendor: Vendor) -> List[str]:
    out: List[str] = []
    for value in [vendor.website, *(vendor.domains or [])]:
        d = clean_domain(value)
        if d and d not in out:
            out.append(d)
    return out[:MAX_DOMAINS]


def _resolve(name: str) -> List[str]:
    from ...asset_discovery.services.external_collect import resolve_a

    return resolve_a(name)


def _collect(domain: str, sources: Optional[dict]) -> List[dict]:
    from ...asset_discovery.services.external_collect import collect_domain

    return collect_domain(domain, resolve=True, max_names=MAX_NAMES, sources=sources or None, timeout=20)


def pick_hosts(domains: List[str], sources: Optional[dict] = None, collect: Callable = _collect,
               resolve: Callable = _resolve) -> List[dict]:
    """Hosts to look at: each domain's apex and www first, then the names that
    certificate logs hold for it and that resolve, alphabetically."""
    first, rest = [], []
    for domain in domains:
        try:
            seen = {o["fqdn"]: o for o in collect(domain, sources) if o.get("fqdn")}
        except Exception:  # noqa: BLE001 — the logs being down still leaves apex and www
            logger.warning("outside-in: certificate logs failed for %s", domain, exc_info=True)
            seen = {}
        for name in [domain, f"www.{domain}", *sorted(seen)]:
            raw = (seen.get(name) or {}).get("raw") or {}
            if any(h["fqdn"] == name for h in first + rest) or name.startswith("*."):
                continue
            ips = raw.get("ip_addresses") or (resolve(name) if name not in seen else [])
            if not ips:
                continue
            host = {"fqdn": name, "ips": ips[:4], "ports": sorted(set(raw.get("open_ports") or [])), "domain": domain}
            (first if name in (domain, f"www.{domain}") else rest).append(host)
    return (first + rest)[:MAX_HOSTS]


# ── what the probes say, as findings ─────────────────────────────────────────

def _probe(fqdn: str, ip: Optional[str]) -> dict:
    from ...asset_discovery.services.external_probe import probe_asset

    return probe_asset(fqdn, ip, extras=False)


def host_findings(facts: dict) -> List[dict]:
    host = facts.get("fqdn")
    out: List[dict] = []

    def add(key, category, severity, title, detail=None):
        out.append({"key": key, "category": category, "severity": severity, "title": title,
                    "detail": detail, "host": host})

    https = bool(facts.get("https_available") or facts.get("scheme") == "https")
    if facts.get("tls_not_after"):
        days = facts.get("tls_days_to_expiry")
        if facts.get("tls_expired"):
            add("tls_expired", "tls", "high", "The certificate has expired", f"It expired on {str(facts['tls_not_after'])[:10]}.")
        elif isinstance(days, (int, float)) and 0 <= days < 14:
            add("tls_expiring", "tls", "low", f"The certificate expires in {int(days)} days")
        if facts.get("tls_self_signed"):
            add("tls_self_signed", "tls", "medium", "The certificate is self-signed", "Browsers will not trust it.")
        version = str(facts.get("tls_version") or "")
        if version in _OLD_PROTOCOLS:
            add("tls_old_protocol", "tls", "medium", f"It accepts an outdated protocol ({version})")
        cipher = str(facts.get("tls_cipher") or "")
        if any(w in cipher.upper() for w in _WEAK_CIPHERS):
            add("tls_weak_cipher", "tls", "medium", f"It negotiates a weak cipher ({cipher})")
        size = re.match(r"RSA (\d+)", str(facts.get("tls_key") or ""))
        if size and int(size.group(1)) < 2048:
            add("tls_short_key", "tls", "medium", f"The certificate's key is short ({facts['tls_key']})")
    elif https and facts.get("tls_error"):
        add("tls_unreadable", "tls", "low", "The certificate could not be read", str(facts["tls_error"])[:200])

    if facts.get("live"):
        if not https:
            add("no_https", "web", "high", "The site is served without HTTPS")
        elif facts.get("redirected_to_https") is False:
            add("no_https_redirect", "web", "low", "Plain HTTP is not sent on to HTTPS")
        present = facts.get("security_headers") or {}
        if https and not present.get("hsts"):
            add("no_hsts", "web", "low", "No HSTS header", "Browsers are not told to insist on HTTPS.")
        missing = [h for h in ("csp", "x_frame_options", "x_content_type_options") if h not in present]
        if missing:
            add("missing_headers", "web", "low", "Protective headers are missing",
                ", ".join(m.replace("_", "-").upper() if m == "csp" else m.replace("_", "-").title() for m in missing))
        server = str(facts.get("server") or "")
        if re.search(r"/\s*\d", server):
            add("version_disclosed", "web", "low", "The server names its software version", server[:120])
        cookies = " ".join(facts.get("set_cookies") or []).lower()
        if cookies and not ("secure" in cookies and "httponly" in cookies):
            add("cookie_flags", "web", "low", "Cookies are set without Secure and HttpOnly")
    return out


def email_findings(facts: dict) -> List[dict]:
    """Spoofing protection on a domain that handles mail."""
    if not facts.get("dns_mx"):
        return []
    host = facts.get("fqdn")
    spf, dmarc = str(facts.get("spf") or "").lower(), str(facts.get("dmarc") or "").lower()
    out = []

    def add(key, severity, title, detail=None):
        out.append({"key": key, "category": "email", "severity": severity, "title": title, "detail": detail, "host": host})

    if not spf:
        add("no_spf", "medium", "No SPF record", "Nothing says which servers may send this domain's mail.")
    elif "+all" in spf:
        add("spf_allows_all", "high", "SPF lets any server send as this domain (+all)")
    if not dmarc:
        add("no_dmarc", "medium", "No DMARC policy", "Mail that fakes this domain is not rejected.")
    elif re.search(r"\bp\s*=\s*none\b", dmarc):
        add("dmarc_monitor_only", "low", "DMARC only monitors (p=none)", "Faked mail is reported, not stopped.")
    return out


def _severity(cvss) -> str:
    try:
        value = float(cvss)
    except (TypeError, ValueError):
        return "medium"
    return "critical" if value >= 9 else "high" if value >= 7 else "medium" if value >= 4 else "low"


def exposure_findings(host: str, ports: Iterable[int], vulns: Dict[str, dict], kev: Iterable[str] = ()) -> List[dict]:
    kev = set(kev)
    out = []
    for port in sorted(set(ports)):
        if port in RISKY_PORTS:
            name, severity = RISKY_PORTS[port]
            out.append({"key": f"port:{port}", "category": "exposure", "severity": severity,
                        "title": f"{name} is reachable from the internet", "detail": f"Port {port}, as seen by Shodan.",
                        "host": host})
    ranked = sorted(vulns.items(), key=lambda kv: (kv[0] not in kev, -float((kv[1] or {}).get("cvss") or 0)))
    # ponytail: the worst MAX_CVES_PER_HOST per host; the category cap means more would not move the score.
    for cve, meta in ranked[:MAX_CVES_PER_HOST]:
        meta = meta or {}
        known = cve in kev
        out.append({"key": f"cve:{cve}", "category": "vulns", "severity": "critical" if known else _severity(meta.get("cvss")),
                    "title": f"{cve}{' is known to be exploited' if known else ''}",
                    "detail": str(meta.get("summary") or "")[:300] or None, "host": host,
                    "cvss": meta.get("cvss")})
    return out


def shodan_host(ip: str, key: str, get: Callable = requests.get) -> dict:
    """The ports, software and vulnerabilities Shodan has recorded for one address."""
    resp = get(f"https://api.shodan.io/shodan/host/{ip}", params={"key": key}, timeout=20)
    if resp.status_code == 404:
        return {"ports": [], "vulns": {}, "products": []}
    resp.raise_for_status()
    body = resp.json() or {}
    vulns: Dict[str, dict] = {}
    products: Dict[str, dict] = {}
    for item in body.get("data") or []:
        for cve, meta in (item.get("vulns") or {}).items():
            vulns.setdefault(cve, meta if isinstance(meta, dict) else {})
        if item.get("product"):
            products.setdefault(item["product"], {"name": str(item["product"])[:80], "category": "Service",
                                                  "version": (str(item.get("version"))[:40] or None) if item.get("version") else None,
                                                  "evidence": f"Shodan, port {item.get('port')}"})
    for cve in body.get("vulns") or []:
        vulns.setdefault(cve, {})
    return {"ports": sorted({int(p) for p in body.get("ports") or [] if str(p).isdigit()}), "vulns": vulns,
            "products": list(products.values())}


# ── the score ────────────────────────────────────────────────────────────────

def _grade(score: int) -> str:
    return "A" if score >= 90 else "B" if score >= 80 else "C" if score >= 70 else "D" if score >= 55 else "F"


def live_waivers(waivers: Iterable[TPRASurfaceWaiver], today: date) -> List[TPRASurfaceWaiver]:
    return [w for w in waivers if w.revoked_at is None and w.expires_on >= today]


def waiver_for(finding: dict, waivers: Iterable[TPRASurfaceWaiver]) -> Optional[TPRASurfaceWaiver]:
    return next((w for w in waivers if w.finding_key == finding["key"] and (not w.host or w.host == finding.get("host"))), None)


def score(findings: List[dict], waivers: Iterable[TPRASurfaceWaiver], today: date) -> dict:
    """{score, grade, categories, counted} for these findings with the waivers in date."""
    active = live_waivers(waivers, today)
    worst: Dict[str, dict] = {}
    for f in findings:
        if waiver_for(f, active):
            continue
        held = worst.get(f["key"])
        if held is None or POINTS[f["severity"]] > POINTS[held["severity"]]:
            worst[f["key"]] = f
    taken = {c: 0 for c in CATEGORIES}
    for f in worst.values():
        taken[f["category"]] += POINTS[f["severity"]]
    total = max(0, 100 - sum(min(CATEGORY_CAP, pts) for pts in taken.values()))
    return {"score": total, "grade": _grade(total), "categories": {c: max(0, 100 - pts) for c, pts in taken.items()},
            "counted": sorted(worst)}


# ── a scan ───────────────────────────────────────────────────────────────────

def _summary(facts: dict, host: dict) -> dict:
    return {"fqdn": host["fqdn"], "ip": (host.get("ips") or [None])[0], "live": bool(facts.get("live")),
            "status_code": facts.get("status_code"), "title": facts.get("title"), "server": facts.get("server"),
            "https": bool(facts.get("https_available") or facts.get("scheme") == "https"),
            "tls_issuer": facts.get("tls_issuer"), "tls_version": facts.get("tls_version"),
            "tls_expires": str(facts.get("tls_not_after") or "")[:10] or None, "cdn_waf": facts.get("cdn_waf"),
            "ports": host.get("ports") or [], "tech": host.get("tech") or []}


def software_findings(host: str, tech: List[dict], today: date) -> List[dict]:
    """Versions a host names that are out of support, or old enough to carry known flaws."""
    from ...asset_discovery.services.web_tech import outdated

    out = []
    for t in tech:
        why = outdated(t, today)
        if why:
            out.append({"key": f"outdated:{t['name']}", "category": "software", "severity": "medium",
                        "title": f"{t['name']} {t['version']} is out of date", "detail": why, "host": host})
    return out


def technologies(hosts: List[dict]) -> List[dict]:
    """Every technology the hosts showed, once, with the versions and hosts it was seen on."""
    seen: Dict[str, dict] = {}
    for h in hosts:
        for t in h.get("tech") or []:
            entry = seen.setdefault(t["name"].lower(), {"name": t["name"], "category": t["category"], "versions": [],
                                                        "hosts": [], "evidence": t.get("evidence")})
            if t.get("version") and t["version"] not in entry["versions"]:
                entry["versions"].append(t["version"])
            if h["fqdn"] not in entry["hosts"]:
                entry["hosts"].append(h["fqdn"])
    return sorted(seen.values(), key=lambda t: (t["category"], t["name"].lower()))


def _kev() -> set:
    try:
        from ...vuln_management.enrichment.kev_cache import all_kev_cves

        return set(all_kev_cves())
    except Exception:  # noqa: BLE001 — without the catalogue a CVE is graded on its CVSS alone
        return set()


def scan_facts(domains: List[str], *, sources: Optional[dict] = None, probe: Callable = _probe,
               collect: Callable = _collect, resolve: Callable = _resolve, shodan: Callable = shodan_host,
               kev: Optional[Callable] = None) -> Tuple[List[dict], List[dict]]:
    """(host summaries, findings) for a supplier's domains. Pure apart from the network."""
    from ...asset_discovery.services.web_tech import providers

    hosts = pick_hosts(domains, sources, collect, resolve)
    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        facts = list(pool.map(lambda h: probe(h["fqdn"], (h.get("ips") or [None])[0]), hosts))
    findings: List[dict] = []
    for host, found in zip(hosts, facts):
        host["tech"] = list(found.get("technologies") or [])
        findings += host_findings(found)
        if host["fqdn"] == host["domain"]:
            findings += email_findings(found)
            host["tech"] += providers(found.get("dns_mx") or [], found.get("dns_ns") or [])
    key = ((sources or {}).get("shodan") or {}).get("api_key")
    if key and hosts:
        known = (kev or _kev)()
        by_ip: Dict[str, dict] = {}
        for host in hosts:
            ip = (host.get("ips") or [None])[0]
            if not ip:
                continue
            if ip not in by_ip:
                try:
                    by_ip[ip] = shodan(ip, key)
                except Exception:  # noqa: BLE001 — one address Shodan will not answer for is not the whole scan
                    logger.warning("outside-in: Shodan lookup failed for %s", ip, exc_info=True)
                    by_ip[ip] = {"ports": [], "vulns": {}}
            seen = by_ip[ip]
            host["ports"] = sorted(set(host.get("ports") or []) | set(seen["ports"]))
            host["tech"] += [p for p in seen.get("products") or []
                             if p["name"].lower() not in {t["name"].lower() for t in host["tech"]}]
            findings += exposure_findings(host["fqdn"], host["ports"], seen["vulns"], known)
    today = datetime.utcnow().date()
    for host in hosts:
        findings += software_findings(host["fqdn"], host["tech"], today)
    return [_summary(f, h) for f, h in zip(facts, hosts)], findings


def _sources(db: Session, tenant_id: int) -> dict:
    from ...asset_discovery.services.executor import load_easm_source_creds

    return load_easm_source_creds(db, tenant_id)


def waivers_of(db: Session, vendor: Vendor) -> List[TPRASurfaceWaiver]:
    return db.query(TPRASurfaceWaiver).filter(TPRASurfaceWaiver.tenant_id == vendor.tenant_id,
                                              TPRASurfaceWaiver.vendor_id == vendor.id).all()


def complete(db: Session, scan: TPRASurfaceScan, vendor: Vendor, now: Optional[datetime] = None,
             facts: Optional[Callable] = None, sources: Optional[dict] = None) -> List[dict]:
    """Finish a scan row: look, score, keep the rating. Returns the serious
    findings this scan is the first to see, not waived, for monitoring signals.
    A supplier's first scan is its baseline: only critical findings alert then,
    or turning scanning on would reopen every critical supplier's assessment at
    once; after that, any high or critical finding that is new alerts."""
    now = now or datetime.utcnow()
    previous = (db.query(TPRASurfaceScan).filter(
        TPRASurfaceScan.vendor_id == vendor.id, TPRASurfaceScan.status == "done", TPRASurfaceScan.id != scan.id)
        .order_by(TPRASurfaceScan.started_at.desc()).first())
    domains = domains_for(vendor)
    scan.domains = domains
    try:
        if not domains:
            raise ValueError("No website or domain is recorded for this supplier")
        hosts, findings = (facts or scan_facts)(
            domains, sources=sources if sources is not None else _sources(db, vendor.tenant_id))
    except Exception as exc:  # noqa: BLE001 — a failed scan is kept, with why
        scan.status, scan.finished_at, scan.error = "failed", now, f"{exc}"[:500]
        return []
    waivers = waivers_of(db, vendor)
    result = score(findings, waivers, now.date())
    scan.hosts, scan.findings, scan.finished_at, scan.status = hosts, findings, now, "done"
    scan.technologies = technologies(hosts)
    if not any(h["live"] or h["tls_expires"] for h in hosts):
        scan.score = scan.grade = None
        scan.categories = None
        scan.error = "Nothing answered at these domains"
        return []
    scan.score, scan.grade, scan.categories = result["score"], result["grade"], result["categories"]
    ratings.record(db, vendor, PROVIDER, result["score"], now, result["grade"])
    before = {f["key"] for f in (previous.findings or [])} if previous else set()
    alerting = ("critical", "high") if previous is not None else ("critical",)
    active = live_waivers(waivers, now.date())
    return [f for f in findings if f["severity"] in alerting and f["key"] not in before
            and not waiver_for(f, active)]


def drafts(vendor: Vendor, fresh: List[dict]) -> List[dict]:
    """Signal drafts for new serious findings, one per finding key."""
    out, seen = [], set()
    for f in fresh:
        if f["key"] in seen:
            continue
        seen.add(f["key"])
        out.append({"signal_type": "security_rating", "severity": f["severity"],
                    "title": f"{vendor.name}: {f['title']}"[:255],
                    "detail": (f"Seen on {f['host']} by the outside-in scan." + (f" {f['detail']}" if f.get("detail") else ""))[:2000],
                    "external_id": f"surface:{f['key']}", "occurred_at": datetime.utcnow(),
                    "sources": [{"title": f["host"], "finding": f["key"]}],
                    "verification": {"verified": True, "checks": {"observed": "outside-in scan"}}})
    return out


# Technologies that are someone else's service the supplier relies on, and so
# count as its fourth parties when concentration is worked out.
PLATFORM_CATEGORIES = {"CDN", "WAF", "Hosting", "Email", "DNS", "Identity", "Payments", "E-commerce",
                       "Website builder", "Customer messaging"}


def latest_scans(db: Session, tenant_id: int, days: int = 400) -> Dict[int, TPRASurfaceScan]:
    """Each supplier's latest finished scan within `days`.
    ponytail: reads every scan in the window; keep a latest-scan pointer per vendor if this slows."""
    out: Dict[int, TPRASurfaceScan] = {}
    for s in (db.query(TPRASurfaceScan).filter(
            TPRASurfaceScan.tenant_id == tenant_id, TPRASurfaceScan.status == "done",
            TPRASurfaceScan.started_at >= datetime.utcnow() - timedelta(days=days))
            .order_by(TPRASurfaceScan.started_at.desc())):
        out.setdefault(s.vendor_id, s)
    return out


def seen_technologies(scan: TPRASurfaceScan) -> List[dict]:
    return scan.technologies or technologies(scan.hosts or [])


def policy_on(db: Session, tenant_id: int) -> bool:
    return bool((get_tiering_config(db, tenant_id).get("monitoring_policy") or {}).get("outside_in"))


# ── REST ─────────────────────────────────────────────────────────────────────

def _tids(user: GRCUser, db: Session) -> List[int]:
    tids = get_user_tenants(user, db)
    if not tids:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "No tenant context")
    return tids


def _vendor(db: Session, vendor_id: int, tids: List[int]) -> Vendor:
    v = db.query(Vendor).filter(Vendor.id == vendor_id, Vendor.tenant_id.in_(tids), Vendor.deleted_at.is_(None)).first()
    if v is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Vendor not found")
    return v


def _running(scan: Optional[TPRASurfaceScan], now: datetime) -> bool:
    return bool(scan and scan.status == "running" and scan.started_at and now - scan.started_at < RUNNING_FOR)


def _waiver_row(w: TPRASurfaceWaiver, today: date, names: dict) -> dict:
    return {"id": w.id, "finding_key": w.finding_key, "host": w.host, "reason": w.reason,
            "expires_on": w.expires_on.isoformat(), "by": names.get(w.created_by), "created_at": w.created_at,
            "state": "revoked" if w.revoked_at else "expired" if w.expires_on < today else "active",
            "days_left": (w.expires_on - today).days}


def _names(db: Session, ids) -> dict:
    ids = {i for i in ids if i}
    if not ids:
        return {}
    return {u.id: u.display_name or u.username or u.email for u in db.query(GRCUser).filter(GRCUser.id.in_(ids))}


def _ratings(db: Session, vendor_ids: List[int]) -> Dict[int, Dict[str, List[dict]]]:
    out: Dict[int, Dict[str, List[dict]]] = {}
    for r in (db.query(TPRAExternalRating).filter(TPRAExternalRating.vendor_id.in_(vendor_ids or [-1]))
              .order_by(TPRAExternalRating.captured_at.desc())):
        series = out.setdefault(r.vendor_id, {}).setdefault(r.provider, [])
        if len(series) < 12:
            series.append({"at": r.captured_at.date().isoformat(), "score": round(r.score, 1), "grade": r.grade})
    return out


@router.get("/vendors/{vendor_id}/outside-in")
def vendor_view(vendor_id: int, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    v = _vendor(db, vendor_id, _tids(user, db))
    now = datetime.utcnow()
    today = now.date()
    scans = (db.query(TPRASurfaceScan).filter(TPRASurfaceScan.tenant_id == v.tenant_id, TPRASurfaceScan.vendor_id == v.id)
             .order_by(TPRASurfaceScan.started_at.desc()).limit(30).all())
    done = [s for s in scans if s.status == "done"]
    latest = done[0] if done else None
    waivers = waivers_of(db, v)
    active = live_waivers(waivers, today)
    names = _names(db, [w.created_by for w in waivers])
    view = None
    if latest is not None:
        now_score = score(latest.findings or [], waivers, today) if latest.score is not None else None
        findings = []
        for f in latest.findings or []:
            w = waiver_for(f, active)
            findings.append({**f, "points": POINTS[f["severity"]], "category_label": CATEGORIES.get(f["category"]),
                             "waiver": _waiver_row(w, today, names) if w else None})
        view = {"id": latest.id, "at": latest.finished_at or latest.started_at, "domains": latest.domains,
                "hosts": latest.hosts or [], "findings": findings,
                "score": now_score["score"] if now_score else None, "grade": now_score["grade"] if now_score else None,
                "categories": now_score["categories"] if now_score else None, "scanned_score": latest.score,
                "note": latest.error, "technologies": latest.technologies or technologies(latest.hosts or [])}
    last_failed = next((s for s in scans if s.status == "failed"), None)
    return {
        "vendor": {"id": v.id, "name": v.name, "tier": v.tier, "website": v.website},
        "domains": domains_for(v), "extra_domains": v.domains or [],
        "enabled": policy_on(db, v.tenant_id), "shodan": bool((_sources(db, v.tenant_id).get("shodan") or {}).get("api_key")),
        "running": _running(scans[0] if scans else None, now), "latest": view,
        "failed": {"at": last_failed.started_at, "error": last_failed.error}
        if last_failed and (latest is None or last_failed.started_at > latest.started_at) else None,
        "history": [{"at": s.finished_at or s.started_at, "score": s.score, "grade": s.grade} for s in reversed(done) if s.score is not None],
        "ratings": _ratings(db, [v.id]).get(v.id, {}),
        "waivers": [_waiver_row(w, today, names) for w in sorted(waivers, key=lambda w: w.created_at, reverse=True)],
        "categories": CATEGORIES, "points": POINTS, "every_days": SCAN_EVERY_DAYS,
    }


@router.get("/outside-in")
def portfolio(db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    """Every supplier in use: its posture now, how it moved, and what is waived."""
    tid = _tids(user, db)[0]
    now = datetime.utcnow()
    today = now.date()
    vendors = [v for v in db.query(Vendor).filter(Vendor.tenant_id == tid, Vendor.deleted_at.is_(None)).order_by(Vendor.name)
               if (v.status or "active").lower() not in _INACTIVE]
    # ponytail: a year of scans read in one go; keep a latest-scan pointer on the vendor if this slows.
    scans: Dict[int, List[TPRASurfaceScan]] = {}
    for s in (db.query(TPRASurfaceScan).filter(TPRASurfaceScan.tenant_id == tid, TPRASurfaceScan.status == "done",
                                               TPRASurfaceScan.started_at >= now - timedelta(days=400))
              .order_by(TPRASurfaceScan.started_at.desc())):
        if len(scans.setdefault(s.vendor_id, [])) < 2:
            scans[s.vendor_id].append(s)
    waivers: Dict[int, List[TPRASurfaceWaiver]] = {}
    for w in db.query(TPRASurfaceWaiver).filter(TPRASurfaceWaiver.tenant_id == tid):
        waivers.setdefault(w.vendor_id, []).append(w)
    rated = _ratings(db, [v.id for v in vendors])
    names = _names(db, [w.created_by for ws in waivers.values() for w in ws])
    rows, grades = [], {g: 0 for g in "ABCDF"}
    expiring = []
    for v in vendors:
        own = scans.get(v.id, [])
        ws = waivers.get(v.id, [])
        latest = own[0] if own else None
        now_score = score(latest.findings or [], ws, today) if latest and latest.score is not None else None
        counted = set(now_score["counted"]) if now_score else set()
        serious = len({f["key"] for f in (latest.findings or []) if f["key"] in counted
                       and f["severity"] in ("critical", "high")}) if latest else 0
        if now_score:
            grades[now_score["grade"]] += 1
        for w in live_waivers(ws, today):
            if (w.expires_on - today).days <= 30:
                expiring.append({**_waiver_row(w, today, names), "vendor": {"id": v.id, "name": v.name}})
        rows.append({
            "vendor": {"id": v.id, "name": v.name, "tier": v.tier}, "domains": domains_for(v),
            "score": now_score["score"] if now_score else None, "grade": now_score["grade"] if now_score else None,
            "change": (latest.score - own[1].score) if latest and len(own) > 1 and latest.score is not None
            and own[1].score is not None else None,
            "scanned_at": (latest.finished_at or latest.started_at) if latest else None,
            "serious": serious, "waived": len(live_waivers(ws, today)),
            "ratings": {p: series[0] for p, series in rated.get(v.id, {}).items() if p != PROVIDER},
        })
    scored = [r["score"] for r in rows if r["score"] is not None]
    return {
        "items": rows, "grades": grades, "average": round(sum(scored) / len(scored)) if scored else None,
        "unscanned": sum(1 for r in rows if r["domains"] and r["score"] is None),
        "no_domain": sum(1 for r in rows if not r["domains"]),
        "expiring_waivers": sorted(expiring, key=lambda w: w["expires_on"]),
        "enabled": policy_on(db, tid), "shodan": bool((_sources(db, tid).get("shodan") or {}).get("api_key")),
        "every_days": SCAN_EVERY_DAYS,
    }


class DomainsIn(BaseModel):
    domains: List[str] = Field(default_factory=list, max_length=MAX_DOMAINS)


@router.put("/vendors/{vendor_id}/domains")
def set_domains(vendor_id: int, body: DomainsIn, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    """The supplier's other domains, beyond its website."""
    v = _vendor(db, vendor_id, _tids(user, db))
    rbac.require_write(db, user, "monitoring", "edit")
    cleaned: List[str] = []
    for raw in body.domains:
        d = clean_domain(raw)
        if d is None:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, f"'{raw}' is not a domain name")
        if d not in cleaned and d != clean_domain(v.website):
            cleaned.append(d)
    before = v.domains or []
    v.domains = cleaned or None
    service.write_audit(db, v.tenant_id, entity="vendor", action="domains", vendor_id=v.id, actor_id=user.id,
                        from_value=", ".join(before) or None, to_value=", ".join(cleaned) or None)
    db.commit()
    return {"domains": domains_for(v), "extra_domains": v.domains or []}


def _scan_later(tenant_id: int, vendor_id: int, scan_id: int, slug: str) -> None:
    """Run the scan off the request thread, in its own session."""
    def work():
        from ....db import open_tenant_session

        db = open_tenant_session(slug)
        try:
            vendor, scan = db.get(Vendor, vendor_id), db.get(TPRASurfaceScan, scan_id)
            fresh = complete(db, scan, vendor)
            for d in drafts(vendor, fresh):
                monitoring.record_signal(db, vendor, source=PROVIDER, **d)
            monitoring.mark_polled(db, tenant_id, vendor_id, PROVIDER, datetime.utcnow())
            db.commit()
        except Exception:  # noqa: BLE001
            db.rollback()
            logger.exception("outside-in scan %s failed", scan_id)
            scan = db.get(TPRASurfaceScan, scan_id)
            if scan is not None and scan.status == "running":
                scan.status, scan.error, scan.finished_at = "failed", "The scan stopped unexpectedly", datetime.utcnow()
                db.commit()
        finally:
            db.close()

    threading.Thread(target=work, name=f"tprm-outside-in-{scan_id}", daemon=True).start()


@router.post("/vendors/{vendor_id}/outside-in/scan", status_code=status.HTTP_202_ACCEPTED)
def scan_now(vendor_id: int, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    v = _vendor(db, vendor_id, _tids(user, db))
    rbac.require_write(db, user, "monitoring", "edit")
    if not domains_for(v):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Add the supplier's website or a domain first")
    now = datetime.utcnow()
    last = (db.query(TPRASurfaceScan).filter(TPRASurfaceScan.vendor_id == v.id)
            .order_by(TPRASurfaceScan.started_at.desc()).first())
    if _running(last, now):
        raise HTTPException(status.HTTP_409_CONFLICT, "A scan of this supplier is already running")
    scan = TPRASurfaceScan(tenant_id=v.tenant_id, vendor_id=v.id, status="running", started_at=now, requested_by=user.id)
    db.add(scan)
    db.flush()
    service.write_audit(db, v.tenant_id, entity="surface_scan", action="start", vendor_id=v.id, entity_id=scan.id,
                        actor_id=user.id)
    db.commit()
    slug = db.query(Tenant.slug).filter(Tenant.id == v.tenant_id).scalar()
    _scan_later(v.tenant_id, v.id, scan.id, slug)
    return {"scan_id": scan.id, "status": "running"}


class WaiverIn(BaseModel):
    finding_key: str = Field(..., min_length=1, max_length=200)
    host: Optional[str] = Field(None, max_length=255)
    reason: str = Field(..., max_length=2000)
    expires_on: date


@router.post("/vendors/{vendor_id}/outside-in/waivers", status_code=status.HTTP_201_CREATED)
def add_waiver(vendor_id: int, body: WaiverIn, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    """Set one finding aside until a date. Accepting a weakness is a risk decision,
    so it takes the right to accept risk, not only to edit monitoring."""
    v = _vendor(db, vendor_id, _tids(user, db))
    rbac.require_write(db, user, "findings", "accept_risk", allow_fallback=False)
    today = datetime.utcnow().date()
    reason = " ".join(body.reason.split())
    if len(reason) < 10:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Say why this can be set aside")
    if not today < body.expires_on <= today + timedelta(days=WAIVER_MAX_DAYS):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "A waiver must end after today and within a year")
    latest = (db.query(TPRASurfaceScan).filter(TPRASurfaceScan.vendor_id == v.id, TPRASurfaceScan.status == "done")
              .order_by(TPRASurfaceScan.started_at.desc()).first())
    host = (body.host or "").strip().lower() or None
    if latest is None or not any(f["key"] == body.finding_key and (host is None or f.get("host") == host)
                                 for f in latest.findings or []):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "The latest scan has no such finding")
    if any(w.finding_key == body.finding_key and w.host == host for w in live_waivers(waivers_of(db, v), today)):
        raise HTTPException(status.HTTP_409_CONFLICT, "This finding is already waived")
    w = TPRASurfaceWaiver(tenant_id=v.tenant_id, vendor_id=v.id, finding_key=body.finding_key, host=host,
                          reason=reason, expires_on=body.expires_on, created_by=user.id)
    db.add(w)
    db.flush()
    service.write_audit(db, v.tenant_id, entity="surface_waiver", action="create", vendor_id=v.id, entity_id=w.id,
                        actor_id=user.id, to_value=f"{body.finding_key}{f' on {host}' if host else ''} until {body.expires_on}",
                        reason=reason)
    db.commit()
    return _waiver_row(w, today, _names(db, [user.id]))


@router.delete("/outside-in/waivers/{waiver_id}")
def revoke_waiver(waiver_id: int, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    tids = _tids(user, db)
    w = db.query(TPRASurfaceWaiver).filter(TPRASurfaceWaiver.id == waiver_id, TPRASurfaceWaiver.tenant_id.in_(tids)).first()
    if w is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Waiver not found")
    rbac.require_write(db, user, "findings", "accept_risk", allow_fallback=False)
    if w.revoked_at is None:
        w.revoked_at, w.revoked_by = datetime.utcnow(), user.id
        service.write_audit(db, w.tenant_id, entity="surface_waiver", action="revoke", vendor_id=w.vendor_id,
                            entity_id=w.id, actor_id=user.id, from_value=w.finding_key)
        db.commit()
    return {"revoked": True, "id": w.id}
