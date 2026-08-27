"""External attack-surface discovery — the outside-in collector (EASM).

Everything else in asset_discovery is inside-out: you hand it a CIDR you already
own and it sweeps hosts you can already reach. This is the inverse. It starts
from nothing but a domain you own and finds the internet-facing names and
addresses that carry it — including the ones nobody put on a list.

Keyless baseline source: Certificate Transparency (crt.sh). Every TLS certificate
issued for a subdomain is logged publicly and permanently; querying that log is
the single richest zero-credential way to enumerate a domain's public names. No
API key, no packet sent to the target.

Stage 4 adds keyed passive sources (Shodan / Censys / SecurityTrails), each
gated behind a connector-managed API key and UNIONed in on top of crt.sh with
port/service/CPE enrichment. They run only when creds are supplied, so the
keyless crt.sh path stays byte-identical when none are configured. Still to
come: an active httpx/nuclei probe.

The split below is deliberate and load-bearing for testing:
  * parse_crtsh_names()  — PURE: crt.sh JSON -> clean in-scope hostname set. No I/O.
  * fetch_crtsh()        — thin HTTP wrapper around crt.sh.
  * resolve_a()          — thin DNS wrapper (A records).
  * collect_domain()     — orchestrates the three into observation-shaped dicts.
Only the pure function can be wrong without a network, so only it needs a test
(see _selfcheck at the bottom — run this file directly to exercise it).

What collect_domain returns is NOT written here. Each dict is shaped to become a
DiscoveryObservation; the executor wiring + the resolver carve-out that turns
these into internet_facing, evidence-only ITAssets land in Stage 2.
"""
from __future__ import annotations

import logging
import time
from typing import Any, Dict, List, Optional, Set

import requests

logger = logging.getLogger(__name__)

CRTSH_URL = "https://crt.sh/"
# crt.sh can be slow under load; a network sweep already tolerates minute-scale
# waits, so a generous read timeout is fine. Retry/backoff is a Stage 2 concern.
DEFAULT_TIMEOUT = 30
# Cap names processed per run so one very large domain can't write unbounded
# observation rows or hold the executor's DB transaction open through a long
# sequential DNS pass. Not silent — collect_domain logs when it truncates.
DEFAULT_MAX_NAMES = 2000
_HEADERS = {"User-Agent": "complywerse-easm/1.0 (+asset-discovery)"}


def _norm_domain(domain: str) -> str:
    """Reduce whatever was passed to a bare registrable name: no scheme, no path,
    no leading wildcard or dot. The router already validates saved scopes, but
    this function is also called directly (CLI/tests), so it defends itself."""
    d = (domain or "").strip().lower()
    if "://" in d:
        d = d.split("://", 1)[1]
    d = d.split("/", 1)[0].lstrip(".")
    if d.startswith("*."):
        d = d[2:]
    return d


def _norm_name(name: str) -> str:
    """Normalize one candidate hostname the way crt.sh names are normalized:
    lowercase, strip surrounding whitespace, drop a trailing dot and a leading
    wildcard label. Returns "" for junk. Shared by every source so a name from
    Shodan/Censys/SecurityTrails is folded on the same key as its crt.sh twin."""
    n = (name or "").strip().lower().rstrip(".")
    if n.startswith("*."):
        n = n[2:]
    return n


def _in_scope(name: str, domain: str) -> bool:
    """True if `name` is the apex `domain` itself or a true subdomain of it.
    The dotted-suffix check stops "notexample.com" matching "example.com". This
    is the hard scope boundary applied to EVERY source's names, so no passive
    source (which may return names for co-hosted or shared-cert domains) can
    ever widen the surface past the seed."""
    return name == domain or name.endswith("." + domain)


def parse_crtsh_names(rows: List[Dict[str, Any]], domain: str) -> Set[str]:
    """crt.sh JSON rows -> the set of hostnames at or under `domain`.

    Handles the three shapes crt.sh actually emits: `common_name` (one name) and
    `name_value` (newline-separated SANs), wildcards (`*.api.x` -> `api.x`, a real
    zone that exists), and trailing dots / mixed case. Anything outside the seed
    domain — a SAN for an unrelated org sharing a cert — is dropped, so the seed
    is a hard scope boundary, not a hint."""
    domain = _norm_domain(domain)
    out: Set[str] = set()
    for row in rows or []:
        candidates: List[str] = []
        cn = row.get("common_name")
        if cn:
            candidates.append(cn)
        nv = row.get("name_value")
        if nv:
            candidates.extend(nv.split("\n"))
        for name in candidates:
            n = _norm_name(name)
            if not n:
                continue
            if _in_scope(n, domain):
                out.add(n)
    return out


def fetch_crtsh(domain: str, *, timeout: int = DEFAULT_TIMEOUT,
                retries: int = 2) -> List[Dict[str, Any]]:
    """Query crt.sh for every certificate naming a subdomain of `domain`.
    Returns the raw JSON rows (parse them with parse_crtsh_names).

    crt.sh is frequently overloaded and 502/503s on a perfectly valid query, so
    retry a couple of times with a short backoff before giving up — otherwise a
    transient blip fails an entire keyless run. A hard failure still raises, which
    collect_domain turns into an honest job failure, not a silent empty result."""
    domain = _norm_domain(domain)
    last_exc: Optional[Exception] = None
    for attempt in range(retries + 1):
        try:
            resp = requests.get(
                CRTSH_URL,
                params={"q": f"%.{domain}", "output": "json"},
                headers=_HEADERS,
                timeout=timeout,
            )
            resp.raise_for_status()
            return resp.json()
        except Exception as exc:  # 502/503/timeout/malformed JSON — all retryable
            last_exc = exc
            if attempt < retries:
                time.sleep(2 * (attempt + 1))  # 2s, then 4s
    raise last_exc


def fetch_certspotter(domain: str, *, timeout: int = DEFAULT_TIMEOUT) -> List[str]:
    """KEYLESS fallback for crt.sh (which 502s constantly). Returns a flat list of
    FULL FQDNs pooled across every issuance — already qualified, no label-join
    needed (unlike SecurityTrails); scope/normalize happens downstream in
    _merge_names like every other source.

    `GET /v1/issuances?domain=…&include_subdomains=true&expand=dns_names`. Keyless,
    so the free tier is rate-limited to ~tens/hour — one page only, no paging.
    Raises on a hard failure, same contract as fetch_crtsh, so collect_domain can
    fall through to an honest failure when both keyless CT sources are down."""
    domain = _norm_domain(domain)
    resp = requests.get(
        "https://api.certspotter.com/v1/issuances",
        params={"domain": domain, "include_subdomains": "true", "expand": "dns_names"},
        headers=_HEADERS,
        timeout=timeout,
    )
    resp.raise_for_status()
    return [name for issuance in (resp.json() or [])
            for name in (issuance.get("dns_names") or [])]


# ─── Keyed passive sources (Stage 4) ────────────────────────────────
# Each returns a flat list of candidate records shaped for _merge_names:
#   {"name": str, "ips": [...], "open_ports": [...], "services": [...], "cpes": [...]}
# Only "name" is required; enrichment keys are optional. No scoping/normalizing
# here — _merge_names applies _norm_name + _in_scope uniformly to every source.
# Thin `requests` wrappers only, no new SDK deps. They raise on a hard failure;
# collect_domain isolates each call so one dead provider can't sink the others.

def fetch_shodan(domain: str, api_key: Optional[str], *,
                 timeout: int = DEFAULT_TIMEOUT) -> List[Dict[str, Any]]:
    """Shodan passive DNS (subdomains) + optional host-search enrichment.

    `GET /dns/domain/{domain}` yields the name list (`subdomains[]` bare labels
    and `data[].subdomain`); `GET /shodan/host/search?query=hostname:{domain}`
    adds open ports / product / CPE per match that carries an in-scope hostname.
    The enrichment call is isolated so its failure never loses the names."""
    domain = _norm_domain(domain)
    if not api_key:
        raise RuntimeError("Shodan API key missing")
    records: List[Dict[str, Any]] = []

    resp = requests.get(f"https://api.shodan.io/dns/domain/{domain}",
                        params={"key": api_key}, headers=_HEADERS, timeout=timeout)
    resp.raise_for_status()
    body = resp.json() or {}
    for label in body.get("subdomains") or []:
        records.append({"name": f"{label}.{domain}" if label else domain})
    for entry in body.get("data") or []:
        sub = (entry.get("subdomain") or "").strip()
        rec: Dict[str, Any] = {"name": f"{sub}.{domain}" if sub else domain}
        if entry.get("type") in ("A", "AAAA") and entry.get("value"):
            rec["ips"] = [entry["value"]]
        records.append(rec)

    try:
        resp2 = requests.get("https://api.shodan.io/shodan/host/search",
                             params={"key": api_key, "query": f"hostname:{domain}"},
                             headers=_HEADERS, timeout=timeout)
        resp2.raise_for_status()
        for m in (resp2.json() or {}).get("matches") or []:
            hostnames = m.get("hostnames") or []
            if not hostnames:
                continue  # can't key enrichment without a name
            svc = {k: m.get(k) for k in ("port", "transport", "product", "version")
                   if m.get(k) is not None}
            for h in hostnames:
                records.append({
                    "name": h,
                    "ips": [m["ip_str"]] if m.get("ip_str") else [],
                    "open_ports": [m["port"]] if m.get("port") is not None else [],
                    "services": [svc] if svc else [],
                    "cpes": list(m.get("cpe23") or m.get("cpe") or []),
                })
    except Exception:
        logger.warning("external_collect: shodan host/search enrichment failed for %s",
                       domain, exc_info=True)
    return records


def fetch_censys(domain: str, api_id: Optional[str], api_secret: Optional[str], *,
                 timeout: int = DEFAULT_TIMEOUT) -> List[Dict[str, Any]]:
    """Censys hosts search. Each hit is one host (ip) carrying `names[]`; its
    `services[]` give open ports, service names and software CPEs
    (`software[].uniform_resource_identifier`), attached to every in-scope name
    on that hit."""
    domain = _norm_domain(domain)
    if not (api_id and api_secret):
        raise RuntimeError("Censys API id/secret missing")
    resp = requests.get("https://search.censys.io/api/v2/hosts/search",
                        params={"q": f"names:{domain}"},
                        auth=(api_id, api_secret), headers=_HEADERS, timeout=timeout)
    resp.raise_for_status()
    hits = ((resp.json() or {}).get("result") or {}).get("hits") or []
    records: List[Dict[str, Any]] = []
    for hit in hits:
        ip = hit.get("ip")
        ports: Set[int] = set()
        services: List[Dict[str, Any]] = []
        cpes: Set[str] = set()
        for s in hit.get("services") or []:
            port = s.get("port")
            if port is not None:
                ports.add(port)
            services.append({"port": port, "service_name": s.get("service_name")})
            for soft in s.get("software") or []:
                uri = soft.get("uniform_resource_identifier")
                if uri:
                    cpes.add(uri)
        for name in hit.get("names") or []:
            records.append({
                "name": name,
                "ips": [ip] if ip else [],
                "open_ports": sorted(ports),
                "services": services,
                "cpes": sorted(cpes),
            })
    return records


def fetch_securitytrails(domain: str, api_key: Optional[str], *,
                         timeout: int = DEFAULT_TIMEOUT) -> List[Dict[str, Any]]:
    """SecurityTrails subdomain enumeration (no enrichment).

    CRITICAL: `/domain/{domain}/subdomains` returns BARE LABELS ("www",
    "mail.corp"), NOT FQDNs — each must be joined to the seed domain. A label
    can be multi-level, which the join handles as-is."""
    domain = _norm_domain(domain)
    if not api_key:
        raise RuntimeError("SecurityTrails API key missing")
    resp = requests.get(f"https://api.securitytrails.com/v1/domain/{domain}/subdomains",
                        headers={**_HEADERS, "APIKEY": api_key}, timeout=timeout)
    resp.raise_for_status()
    labels = (resp.json() or {}).get("subdomains") or []
    return [{"name": f"{label}.{domain}"} for label in labels if label]


def resolve_a(hostname: str, *, timeout: float = 5.0) -> List[str]:
    """A records for a hostname, or [] if it does not resolve. A name that was in
    a cert but no longer resolves is still evidence (it existed) — the caller
    keeps it, flagged unresolved, rather than dropping it. dnspython is already a
    project dependency; imported lazily so the pure parser needs nothing installed."""
    try:
        import dns.resolver  # lazy: keeps parse_crtsh_names import-light for tests
        r = dns.resolver.Resolver()
        r.lifetime = timeout
        return sorted({rdata.address for rdata in r.resolve(hostname, "A")})
    except Exception:
        # NXDOMAIN, timeout, no A record, or dnspython missing — all "no address".
        return []


def _observation(fqdn: str, ips: List[str], *,
                 evidence: Optional[List[str]] = None,
                 open_ports: Optional[List[int]] = None,
                 services: Optional[List[Dict[str, Any]]] = None,
                 cpes: Optional[List[str]] = None) -> Dict[str, Any]:
    """Shape one discovered name as a DiscoveryObservation-ready dict. For EASM
    the NAME is the identity (external_id=fqdn): you can't log in to confirm a
    serial or MAC from the outside, so the fqdn is the stable key the resolver
    dedupes on. internet_facing is asserted here because that is the one thing an
    outside-in find proves — we reached it from the public internet.

    `evidence` lists which sources named this host (defaults to crt.sh — the
    keyless Stage-1 baseline). The keyed enrichment keys (open_ports/services/
    cpes) are added to `raw` ONLY when non-empty, so a crt.sh-only row keeps the
    exact Stage-1 shape and nothing downstream sees new keys it didn't before."""
    raw: Dict[str, Any] = {
        "source_system": "external",
        "external_id": fqdn,
        "evidence": evidence or ["crt.sh"],
        "internet_facing": True,
        "ip_addresses": ips,
        "resolved": bool(ips),
    }
    if open_ports:
        raw["open_ports"] = open_ports
    if services:
        raw["services"] = services
    if cpes:
        raw["cpes"] = cpes
    return {
        "source": "external",
        "fqdn": fqdn,
        "host_name": fqdn,
        "ip_address": ips[0] if ips else None,
        "mac_address": None,
        "raw": raw,
    }


def _merge_names(domain: str, sourced: List[Any]) -> Dict[str, Dict[str, Any]]:
    """PURE (no I/O) core of collect_domain: fold every source's candidate
    records into one per-FQDN accumulator. `sourced` is a list of
    (evidence_tag, records), each record `{name, ips?, open_ports?, services?,
    cpes?}`. `_norm_name` + `_in_scope` are applied to EVERY name, so sources
    dedupe onto a shared key and none can widen the scope past the seed.

    Returns `{fqdn: {evidence:set, ips:set, open_ports:set, services:list,
    cpes:set}}`. Kept separate from the network fetch so it can be asserted
    offline (see _selfcheck)."""
    domain = _norm_domain(domain)
    merged: Dict[str, Dict[str, Any]] = {}
    for tag, records in sourced:
        for rec in records or []:
            name = _norm_name(rec.get("name", ""))
            if not name or not _in_scope(name, domain):
                continue
            b = merged.setdefault(name, {
                "evidence": set(), "ips": set(),
                "open_ports": set(), "services": [], "cpes": set(),
            })
            b["evidence"].add(tag)
            b["ips"].update(rec.get("ips") or [])
            b["open_ports"].update(rec.get("open_ports") or [])
            b["services"].extend(rec.get("services") or [])
            b["cpes"].update(rec.get("cpes") or [])
    return merged


def collect_domain(domain: str, *, resolve: bool = True,
                   timeout: int = DEFAULT_TIMEOUT,
                   max_names: int = DEFAULT_MAX_NAMES,
                   sources: Optional[Dict[str, Dict[str, str]]] = None
                   ) -> List[Dict[str, Any]]:
    """One domain seed -> observation-shaped dicts, one per in-scope name.

    crt.sh always runs (keyless — the Stage-1 baseline). `sources` is
    `{provider: creds}` for the keyed passive sources (shodan / censys /
    securitytrails); each named provider is queried and its names are UNIONed in
    while its ports/services/CPEs enrich the matching host. `None`/`{}` →
    crt.sh-only, byte-identical to Stage 1.

    `resolve=False` skips DNS (faster; leaves ip_address None). `max_names`
    bounds the surface, applied once to the merged set (see DEFAULT_MAX_NAMES).

    Error isolation: each source runs in its own try/except and a failure is
    logged and skipped — one dead source never kills the others or the run.
    """
    domain = _norm_domain(domain)
    sources = sources or {}
    sourced: List[Any] = []
    attempted = 0

    # Keyless CT — ONE attempted source, two providers. crt.sh is primary; when it
    # fails (it 502s constantly) fall back to Certspotter before giving up, so a
    # single crt.sh outage no longer sinks the whole keyless run. Either provider
    # succeeding keeps `sourced` non-empty and satisfies the honesty guard below.
    attempted += 1
    try:
        rows = fetch_crtsh(domain, timeout=timeout)
        sourced.append(("crt.sh", [{"name": n} for n in parse_crtsh_names(rows, domain)]))
    except Exception:
        logger.warning("external_collect: crt.sh source failed for %s; trying certspotter",
                       domain, exc_info=True)
        try:
            names = fetch_certspotter(domain, timeout=timeout)
            sourced.append(("certspotter", [{"name": n} for n in names]))
        except Exception:
            logger.warning("external_collect: certspotter fallback failed for %s",
                           domain, exc_info=True)

    # Keyed passive sources — each runs only if its creds were supplied.
    if "shodan" in sources:
        attempted += 1
        try:
            sourced.append(("shodan", fetch_shodan(
                domain, sources["shodan"].get("api_key"), timeout=timeout)))
        except Exception:
            logger.warning("external_collect: shodan source failed for %s", domain, exc_info=True)
    if "censys" in sources:
        attempted += 1
        try:
            c = sources["censys"]
            sourced.append(("censys", fetch_censys(
                domain, c.get("api_id"), c.get("api_secret"), timeout=timeout)))
        except Exception:
            logger.warning("external_collect: censys source failed for %s", domain, exc_info=True)
    if "securitytrails" in sources:
        attempted += 1
        try:
            sourced.append(("securitytrails", fetch_securitytrails(
                domain, sources["securitytrails"].get("api_key"), timeout=timeout)))
        except Exception:
            logger.warning("external_collect: securitytrails source failed for %s", domain, exc_info=True)

    # Every source we tried errored → this is a scan FAILURE, not an empty
    # surface. Raise so the per-job except in execute_run marks the job failed,
    # rather than reporting a misleading "succeeded, 0 findings" — a false
    # negative that in a security tool reads as "you have no external surface"
    # when really the scanner couldn't reach its data. A source that succeeds
    # with zero names (a genuinely empty result) appends (tag, []), keeping
    # `sourced` non-empty, and does NOT trip this.
    if attempted and not sourced:
        raise RuntimeError(
            f"all {attempted} external source(s) failed for {domain!r}; see logs")

    merged = _merge_names(domain, sourced)
    names = sorted(merged)
    if len(names) > max_names:
        # No silent truncation: cap a very large domain and say so. Deterministic
        # slice (names are sorted) so a re-scan is stable; raise the cap or page
        # through the sources in a later stage if a real domain needs more.
        logger.warning("external_collect: %s returned %d names; capping at %d",
                       domain, len(names), max_names)
        names = names[:max_names]

    observations: List[Dict[str, Any]] = []
    # ponytail: sequential DNS resolve, O(names). Fine for a bounded run; move DNS
    # out of the executor's transaction or parallelize it (ThreadPoolExecutor,
    # like the CIDR sweep) before this runs on a large domain unattended.
    for fqdn in names:
        b = merged[fqdn]
        ips = set(b["ips"])            # IPs a source already gave us…
        if resolve:
            ips.update(resolve_a(fqdn))  # …unioned with a live A-record check.
        observations.append(_observation(
            fqdn, sorted(ips),
            evidence=sorted(b["evidence"]),
            open_ports=sorted(b["open_ports"]) or None,
            services=b["services"] or None,
            cpes=sorted(b["cpes"]) or None,
        ))
    return observations


def _selfcheck() -> None:
    """Offline check of the only logic that can be wrong without a network: crt.sh
    parsing, scope filtering, wildcard/dot/case normalization, dedup. Run with:
        python grc/modules/asset_discovery/services/external_collect.py
    """
    rows = [
        {"common_name": "www.Example.com",
         "name_value": "example.com\nwww.example.com\n*.api.example.com"},
        {"common_name": "mail.example.com.",              # trailing dot
         "name_value": "mail.example.com"},               # dup of common_name
        {"common_name": "evil.attacker.com",              # out of scope -> drop
         "name_value": "cdn.example.com\nnotours.org"},   # keep cdn, drop notours
        {"common_name": "notexample.com"},                # suffix trap -> drop
    ]
    got = parse_crtsh_names(rows, "Example.com")
    expect = {"example.com", "www.example.com", "api.example.com",
              "mail.example.com", "cdn.example.com"}
    assert got == expect, f"crt.sh parse mismatch:\n got={sorted(got)}\n exp={sorted(expect)}"

    # Apex-only cert still yields the apex; junk/empty is safe.
    assert parse_crtsh_names([{"name_value": "example.com"}], "example.com") == {"example.com"}
    assert parse_crtsh_names([], "example.com") == set()
    assert parse_crtsh_names([{"name_value": ""}], "example.com") == set()

    # URL / wildcard paste normalizes to a bare domain.
    assert _norm_domain("https://Sub.Example.com/path") == "sub.example.com"
    assert _norm_domain("*.example.com") == "example.com"

    # The observation shape carries the identity + internet_facing assertion.
    obs = _observation("api.example.com", ["203.0.113.9"])
    assert obs["fqdn"] == "api.example.com"
    assert obs["raw"]["external_id"] == "api.example.com"
    assert obs["raw"]["internet_facing"] is True
    assert obs["ip_address"] == "203.0.113.9"

    print(f"external_collect self-check OK — {len(expect)} in-scope names parsed, "
          "out-of-scope + suffix-trap dropped, observation shape verified.")

    # ── Stage 4: the keyed-source merge is pure; assert it offline. ──────────
    # Three sources naming overlapping + distinct hosts, with enrichment, plus
    # an out-of-scope name that must be dropped whichever source emits it.
    sourced = [
        ("crt.sh", [{"name": "www.example.com"}, {"name": "API.Example.com"}]),
        ("shodan", [
            {"name": "www.example.com", "open_ports": [443], "cpes": ["cpe:/a:nginx:nginx"]},
            {"name": "vpn.example.com", "ips": ["203.0.113.7"], "open_ports": [443]},
            {"name": "evil.attacker.com", "open_ports": [22]},   # out of scope -> drop
        ]),
        ("securitytrails", [{"name": "vpn.example.com"}]),
    ]
    merged = _merge_names("example.com", sourced)
    # Union + dedup + normalization (API.Example.com -> api.example.com).
    assert set(merged) == {"www.example.com", "api.example.com", "vpn.example.com"}, sorted(merged)
    assert "evil.attacker.com" not in merged  # _in_scope filtered a source's out-of-scope name
    # Evidence tags accumulate across sources for a shared name.
    assert merged["www.example.com"]["evidence"] == {"crt.sh", "shodan"}
    assert merged["vpn.example.com"]["evidence"] == {"shodan", "securitytrails"}
    assert merged["api.example.com"]["evidence"] == {"crt.sh"}
    # Enrichment merged onto the right host.
    assert merged["www.example.com"]["open_ports"] == {443}
    assert merged["www.example.com"]["cpes"] == {"cpe:/a:nginx:nginx"}
    assert merged["vpn.example.com"]["ips"] == {"203.0.113.7"}

    # crt.sh-only rows keep the EXACT Stage-1 observation shape — no enrichment
    # keys leak in when a name came from crt.sh alone.
    base_raw = _observation("api.example.com", [], evidence=["crt.sh"])["raw"]
    assert set(base_raw) == {"source_system", "external_id", "evidence",
                             "internet_facing", "ip_addresses", "resolved"}, sorted(base_raw)
    # An enriched row DOES carry the extra keys, but only the non-empty ones.
    rich_raw = _observation("www.example.com", ["203.0.113.9"],
                            evidence=["crt.sh", "shodan"], open_ports=[443],
                            cpes=["cpe:/a:nginx:nginx"])["raw"]
    assert rich_raw["open_ports"] == [443] and rich_raw["cpes"] == ["cpe:/a:nginx:nginx"]
    assert "services" not in rich_raw  # empty enrichment stays absent

    print("external_collect Stage-4 self-check OK — multi-source merge, scope "
          "filtering, evidence union, and crt.sh-only shape verified.")


if __name__ == "__main__":
    _selfcheck()
