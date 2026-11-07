"""IT Asset Inventory — Overview: estate composition (read-only, pure).

Buckets every in-inventory asset  External | Internal  ->  class  ->  subtype  from
the real signals it already carries, and rolls up per-class coverage (seen <=30d,
owner, CIS, criticality mix, end-of-life). Fixed buckets and counts only — never a
per-asset list — so the payload is the same size at 5 or 5,000 assets.

Signals, strongest first:
  provenance       internet_facing / origin_source='easm' / last_seen_source='external'
                   (the register's own External rule, so both views agree)
  typed collector  platform_kind database|network|cluster|cloud|identity  ('server' is
                   only the placeholder for ANY agentless OS host — never a role)
  OS               os_family, then os_version / os_normalized (Windows Server vs client)
  hardware         manufacturer / model (notebook, PowerEdge, FortiGate, Synology, ...)
  discovery        fingerprint / discovery_classification device_type + open ports
  role evidence    installed database-server products (asset_signals._is_db)
  outside-in probe platform_properties.external_probe (live HTTP, title, content type,
                   CDN/WAF, ASN, DNS resolution, TLS)
No signal -> 'Unidentified'. Nothing is guessed, sampled or invented.

Self-check (no DB):  python -m grc.modules.estate_overview.service   (run from backend/)
"""
from __future__ import annotations

import html
import ipaddress
import re
from collections import Counter
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Iterable, List, Optional, Set, Tuple

from . import asset_signals as signals
from .asset_signals import db_label

EXTERNAL = ("Web application", "API", "Remote / admin service", "Domain / subdomain", "Unidentified")
INTERNAL = ("Server", "Workstation / endpoint", "Database", "Network device",
            "Virtualization", "Storage", "Printer / IoT", "Other", "Unidentified")
# Windows is split by edition: a Server and a 10/11 client are different risk classes.
OS_FAMILIES = ("Windows Server", "Windows client", "Windows (edition unknown)", "Linux", "macOS",
               "Network OS", "Other OS", "OS not visible")
HOSTING = ("CDN / WAF-fronted", "Cloud-hosted", "Hosting provider / ISP", "Hosting unknown", "Not yet probed")
VERIFICATION = ("Live web service", "Open non-web ports", "No web response", "Doesn't resolve", "Not yet probed")
CRITS = ("critical", "high", "medium", "low", "unrated")
# Buckets that mean "we don't know yet" — the UI greys them instead of colouring them.
GAPS = {"Unidentified", "OS not visible", "Not yet probed", "Hosting unknown",
        "No identifying signal", "No outside-in evidence"}
SUBTYPE_CAP = 6  # longer tails fold into one "Other …" bucket
SAMPLE_CAP = 50  # named assets carried per group (class / OS family) for the drill-down modal;
                 # beyond it the UI links "view all N in register". Bounded by the fixed taxonomy
                 # (classes/OS families × SUBTYPE_CAP), so the payload stays flat at any estate size.
ROOTS_CAP = 8    # top registrable domains the external surface hangs off

# ---------- estate-wide governance / coverage enums (additive rollups) ----------
# Fixed taxonomies a reader expects; counts only, so the payload stays flat at any size.
ENVIRONMENTS = ("production", "staging", "development", "test", "dr")
DATA_CLASSES = ("restricted", "confidential", "internal", "public")  # most → least sensitive
REGULATED = ("pci", "phi", "pii", "financial", "multiple")           # 'none' counted apart
ORIGIN_LABELS = (("easm", "External discovery"), ("network_sweep", "Network sweep"),
                 ("connect", "Credentialed connect"), ("agent", "Endpoint agent"),
                 ("import", "Imported register"), ("manual", "Manual entry"))
# Security-relevant software families (security_posture.categories), counted as the
# number of assets that run one — never product/engine names (de-branded).
SEC_FAMILIES = (("edr", "Endpoint detection (EDR)"), ("antivirus", "Antivirus"),
                ("backup", "Backup"), ("remote_access", "Remote access"), ("vpn", "VPN"),
                ("database", "Database engine"), ("web_server", "Web server"),
                ("container", "Container runtime"), ("monitoring", "Monitoring"))

# ---------- OS ----------
_NETOS = ((r"nx-?os", "Cisco NX-OS"), (r"ios[ -]?xe", "Cisco IOS XE"), (r"ios[ -]?xr", "Cisco IOS XR"),
          (r"cisco ios|cisco internetwork", "Cisco IOS"), (r"\basa\b|firepower|\bftd\b", "Cisco ASA / FTD"),
          (r"junos", "Junos"), (r"fortios|fortigate", "FortiOS"), (r"pan-?os", "PAN-OS"),
          (r"routeros|mikrotik", "RouterOS"), (r"arista", "Arista EOS"), (r"aruba ?os|arubaos", "ArubaOS"),
          (r"comware", "Comware"), (r"sonicos", "SonicOS"), (r"gaia|check ?point", "Check Point Gaia"),
          (r"vyos|edgeos", "VyOS / EdgeOS"), (r"pfsense|opnsense", "pfSense / OPNsense"))
_LINUX_RX = re.compile(r"linux|ubuntu|debian|red ?hat|rhel|centos|rocky|alma|suse|sles|fedora|alpine|kali")
_DISTROS = (("ubuntu", "Ubuntu"), ("red hat", "RHEL"), ("rhel", "RHEL"), ("centos", "CentOS"),
            ("debian", "Debian"), ("rocky", "Rocky Linux"), ("alma", "AlmaLinux"), ("sles", "SUSE"),
            ("suse", "SUSE"), ("amazon linux", "Amazon Linux"), ("oracle linux", "Oracle Linux"),
            ("fedora", "Fedora"), ("alpine", "Alpine"), ("kali", "Kali"))


def _os_text(a) -> str:
    return " ".join(str(getattr(a, k, None) or "") for k in ("os_family", "os_version", "os_normalized")).lower().strip()


def _netos(s: str) -> Optional[str]:
    return next((label for rx, label in _NETOS if re.search(rx, s)), None)


def os_of(a, fp: Dict[str, Any]) -> Tuple[str, str]:
    """(family, line) from the profiled OS; a discovery os_guess counts only for the
    family (version not profiled). No OS at all -> 'OS not visible'."""
    s = _os_text(a)
    if not s:
        g = str(fp.get("os_guess") or "").lower()
        fam = {"windows": "Windows", "linux": "Linux", "macos": "macOS"}.get(g)
        return (fam, f"{fam} (version not profiled)") if fam else ("OS not visible", "OS not visible")
    if re.search(r"windows|win32|win64|microsoft", s):
        m = re.search(r"windows[ -]?server\D*(\d{4})(\s*r2)?", s)
        if m:
            return "Windows", f"Windows Server {m.group(1)}{' R2' if m.group(2) else ''}"
        if "server" in s:
            return "Windows", "Windows Server"
        m = re.search(r"windows[ -]?(11|10|8\.1|8|7|vista|xp)\b", s)
        return "Windows", (f"Windows {m.group(1).upper() if m.group(1) == 'xp' else m.group(1).title()}"
                           if m else "Windows (version unknown)")
    if re.search(r"mac ?os|darwin|os ?x\b|\bosx\b", s):
        m = re.search(r"(?:mac ?os|os ?x)\D*(10\.\d+|\d{2})", s)
        return "macOS", f"macOS {m.group(1)}" if m else "macOS"
    net = _netos(s)
    if net:
        return "Network OS", net
    if _LINUX_RX.search(s):
        for key, name in _DISTROS:
            i = s.find(key)
            if i >= 0:
                rest = s[i + len(key):]
                m = re.search(r"(\d{2}\.\d{2})" if key == "ubuntu" else r"(\d+)", rest[:40])
                return "Linux", f"{name} {m.group(1)}" if m else name
        return "Linux", "Linux (other distribution)"
    return "Other OS", "Other OS"


def is_win_server(line: str) -> bool:
    return line.startswith("Windows Server")


def os_bucket(fam: str, line: str) -> str:
    """The OS row an asset counts under (OS_FAMILIES): Windows split by edition."""
    if fam != "Windows":
        return fam
    if is_win_server(line):
        return "Windows Server"
    return "Windows client" if re.fullmatch(r"Windows (11|10|8\.1|8|7|Vista|XP)", line) else "Windows (edition unknown)"


# ---------- hardware / vendor evidence ----------
_ENDPOINT_HW = re.compile(r"notebook|laptop|elitebook|probook|zbook|thinkpad|latitude|inspiron|vostro|\bxps\b|"
                          r"optiplex|elitedesk|prodesk|thinkcentre|ideapad|surface|macbook|imac|mac mini|"
                          r"chromebook|all-in-one|desktop")
_SERVER_HW = re.compile(r"proliant|poweredge|thinksystem|system x|\bucs\b|primergy|supermicro|superserver|"
                        r"\brack\b|blade|\bserver\b")
_HYPERVISOR = re.compile(r"esxi|vsphere|proxmox|xenserver|xcp-ng|hyper-v server|nutanix|\bahv\b|ovirt")
_NET_VENDOR = re.compile(r"cisco|juniper|fortinet|fortigate|palo alto|mikrotik|aruba|ubiquiti|netgear|tp-link|"
                         r"sonicwall|check ?point|arista|extreme networks|ruckus|meraki|watchguard|zyxel|"
                         r"d-link|huawei|f5 networks|barracuda")
_STORAGE_VENDOR = re.compile(r"synology|qnap|netapp|truenas|freenas|\bemc\b|isilon|pure storage|nimble|drobo|"
                             r"asustor|terramaster|unraid|openmediavault")
_PRINTER_HW = re.compile(r"laserjet|officejet|deskjet|pagewide|imagerunner|bizhub|workcentre|ecosys|\bmfp\b|printer")
_NET_KIND = (("Firewall", r"firewall|fortigate|fortios|\basa\b|firepower|pa-\d|palo alto|pan-?os|sonicwall|"
                          r"check ?point|gaia|watchguard|pfsense|opnsense|\bsrx"),
             ("Wireless", r"wireless|aironet|access point|\bwlc\b|\bap\d|ruckus|meraki mr|instant on"),
             ("Switch", r"switch|catalyst|nexus|nx-?os|procurve|comware|powerconnect|arista|meraki ms"),
             ("Router", r"router|routeros|mikrotik|\bisr\b|\basr\b|edgerouter|vyos|junos|ios[ -]?x[er]|cisco ios"))
_IOT_KIND = {"printer": "Printer", "camera": "IP camera / NVR", "voip": "VoIP phone / PBX",
             "ups": "UPS / power", "appliance": "Embedded appliance"}
_HOST_FAMS = {"Windows", "Linux", "macOS"}
_DB_PORT_LABEL = {"postgres": "PostgreSQL", "mysql": "MySQL", "mssql": "SQL Server", "oracle": "Oracle",
                  "mongodb": "MongoDB", "redis": "Redis", "elasticsearch": "Elasticsearch"}
_ASSET_TYPE = (("Database", r"database|\bdb\b"), ("Network device", r"network|router|switch|firewall"),
               ("Storage", r"storage|\bnas\b|\bsan\b"), ("Virtualization", r"hypervisor|virtuali[sz]ation"),
               ("Printer / IoT", r"printer|\biot\b|camera"), ("Workstation / endpoint", r"workstation|laptop|desktop|endpoint"),
               ("Server", r"server"))


def _hw_text(a, fp: Dict[str, Any]) -> str:
    return " ".join(str(x or "") for x in (getattr(a, "manufacturer", None), getattr(a, "model", None),
                                          fp.get("vendor"), fp.get("product"))).lower()


def _first(options, text: str, default: str) -> str:
    return next((label for label, rx in options if re.search(rx, text)), default)


def _db_engine(a, fp: Dict[str, Any]) -> str:
    eng = signals._db_engines(a)
    if eng:
        return db_label(eng[0][0])
    return _DB_PORT_LABEL.get(str(fp.get("product") or "").lower(), "Engine not identified")


def classify_internal(a, dt: Optional[str], fp: Dict[str, Any]) -> Tuple[str, str]:
    """(class, subtype) for an internal asset."""
    pk = (getattr(a, "platform_kind", None) or "").lower()
    fam, line = os_of(a, fp)
    hw = _hw_text(a, fp)
    ostext = _os_text(a)
    if pk == "database":
        return "Database", _db_engine(a, fp)
    if pk == "network":
        return "Network device", _first(_NET_KIND, f"{hw} {ostext}", "Other network gear")
    if pk == "cluster":
        return "Virtualization", "Container cluster"
    if pk == "cloud":
        return "Other", "Cloud account"
    if pk == "identity":
        return "Other", "Identity platform"
    if dt == "hypervisor" or _HYPERVISOR.search(f"{ostext} {hw}"):
        return "Virtualization", "Hypervisor host"
    if fam == "Network OS" or dt in ("network_device", "router", "switch", "firewall") or (
            _NET_VENDOR.search(hw) and fam not in _HOST_FAMS and not _SERVER_HW.search(hw)):
        return "Network device", _first(_NET_KIND, f"{hw} {ostext}", "Other network gear")
    if dt == "storage" or (_STORAGE_VENDOR.search(hw) and fam not in _HOST_FAMS):
        return "Storage", "NAS / storage array"
    if dt in _IOT_KIND:
        return "Printer / IoT", _IOT_KIND[dt]
    if _PRINTER_HW.search(hw):
        return "Printer / IoT", "Printer"
    if dt in ("directory", "dns_server"):
        return "Other", "Directory / DNS"
    if fam == "Windows" and not line.endswith("(version not profiled)"):
        return ("Server", line) if is_win_server(line) else ("Workstation / endpoint", line)
    if fam == "macOS":
        return "Workstation / endpoint", line
    if fam in ("Linux", "Other OS") and ostext:
        if _ENDPOINT_HW.search(hw) or "desktop" in ostext:
            return "Workstation / endpoint", line
        return "Server", line
    if dt == "database":
        return "Database", _db_engine(a, fp)
    if _ENDPOINT_HW.search(hw):
        return "Workstation / endpoint", line if fam != "OS not visible" else "OS not profiled"
    if _SERVER_HW.search(hw):
        return "Server", line if fam != "OS not visible" else "OS not profiled"
    at = (getattr(a, "asset_type", None) or "").lower()
    typed = _first(_ASSET_TYPE, at, "")
    if typed:
        return typed, "Set on the register"
    if (getattr(a, "asset_role", None) or "").lower() == "application" or re.search(r"application|\bapp\b|\bweb\b", at):
        return "Other", "Application"
    if dt == "host" or fam != "OS not visible":
        return "Unidentified", "Host, OS & role unknown" if fam == "OS not visible" else f"{fam} host, role unknown"
    return "Unidentified", "No identifying signal"


def refine_server(a, fp: Dict[str, Any]) -> Optional[Tuple[str, str]]:
    """A server-class host with an installed database-server product IS a database
    server (asset_signals role evidence). Needs its software/services loaded."""
    return ("Database", _db_engine(a, fp)) if signals._is_db(a) == "Yes" else None


# ---------- external ----------
_EXPOSED = {  # port -> exposed-service category (display categories, never product names)
    **dict.fromkeys((22, 23, 3389, 5900, 5901, 5985, 5986), "Remote access (SSH / RDP / VNC)"),
    **dict.fromkeys((1433, 1521, 3306, 5432, 6379, 9200, 11211, 27017, 5984), "Database port"),
    **dict.fromkeys((2082, 2083, 2086, 2087, 2095, 2096, 8006, 10000), "Admin panel / console"),
    **dict.fromkeys((21, 139, 445, 2049, 873), "File transfer / sharing"),
    **dict.fromkeys((161, 623, 2375, 2376, 6443, 10250), "Management interface"),
}
_EXPOSED_ORDER = ("Remote access (SSH / RDP / VNC)", "Database port", "Admin panel / console",
                  "Management interface", "File transfer / sharing")
_ADMIN_TITLE = re.compile(r"cpanel|\bwhm\b|webmin|plesk|phpmyadmin|directadmin|adminer|esxi|vsphere|proxmox|"
                          r"fortigate|pfsense|opnsense|sonicwall|\bidrac\b|\bilo\b|jenkins|grafana|kibana|portainer|"
                          r"router login|admin(istrator)? (login|panel|console)")
_API_LABEL = re.compile(r"^(api|apis|graphql|gateway|apigw|rest)([-\d]|$)")
_CDN = re.compile(r"cloudflare|akamai|fastly|incapsula|imperva|sucuri|cloudfront|edgecast|stackpath|bunny")
_CLOUD = re.compile(r"amazon|\baws\b|google|microsoft|azure|digitalocean|linode|oracle|alibaba|tencent|"
                    r"hetzner|\bovh|vultr|\bibm\b|scaleway")


def _dns_name(a) -> str:
    return str(getattr(a, "fqdn", None) or getattr(a, "host_name", None) or getattr(a, "name", None) or "").lower().rstrip(".")


def _is_fqdn(n: str) -> bool:
    try:
        ipaddress.ip_address(n)
        return False
    except ValueError:
        return "." in n and bool(re.search(r"[a-z]", n))


def _disp(a) -> str:
    """A human name for an asset sample — the register's own display name."""
    for k in ("name", "host_name", "fqdn"):
        v = getattr(a, k, None)
        if v:
            return str(v).strip()
    return f"asset {getattr(a, 'id', '?')}"


# Registrable-domain grouping is the SAME canonical rule the dashboards and the
# Asset Register use — one registrable (apex) domain = one external asset — so
# every "external" count reconciles. It lives in grc.modules.it_assets.asset_rollup;
# this thin wrapper only keeps the "never return empty for a real name" contract
# the roots counter below relies on (it is only ever called on an _is_fqdn name).
from grc.modules.it_assets.asset_rollup import (
    registrable_domain as _registrable_domain,
    is_external as _canon_is_external,
)


def _registrable(name: str) -> str:
    """Registrable domain (eTLD+1) for grouping the external surface, via the
    shared canonical helper; falls back to the name itself for the rare input
    the canonical rule can't group (keeps the roots counter total-preserving)."""
    return _registrable_domain(name) or name


def hosting(ep: Dict[str, Any]) -> str:
    org = str(ep.get("asn_org") or "").lower()
    if ep.get("cdn_waf") or _CDN.search(f"{str(ep.get('server') or '').lower()} {org}"):
        return "CDN / WAF-fronted"
    if _CLOUD.search(org):
        return "Cloud-hosted"
    return "Hosting provider / ISP" if org else "Hosting unknown"


def classify_external(a, ports: Set[int]) -> Tuple[str, str]:
    """(class, subtype) for an external asset. The riskiest proven fact wins:
    an exposed remote/admin port, then an API, a web application, a bare name."""
    hits = {_EXPOSED[p] for p in ports if p in _EXPOSED}
    if hits:
        return "Remote / admin service", next(k for k in _EXPOSED_ORDER if k in hits)
    ep = signals._ep(a)
    title = html.unescape(html.unescape(str(ep.get("title") or ""))).lower()
    if ep.get("live") and _ADMIN_TITLE.search(title):
        return "Remote / admin service", "Admin panel / console"
    ctype = str(ep.get("content_type") or "").lower()
    label = _dns_name(a).split(".")[0]
    if ep.get("live") and ("json" in ctype or "graphql" in ctype or (_API_LABEL.match(label) and "html" not in ctype)):
        return "API", hosting(ep)
    if signals._ext_web(a):
        return "Web application", hosting(ep)
    if not ep and not ports and not _is_fqdn(_dns_name(a)):
        return "Unidentified", "No outside-in evidence"
    return "Domain / subdomain", probe_status(a, ports)


_WEB_PORTS = {80, 443, 8080, 8443}


def probe_status(a, ports: Set[int] = frozenset()) -> str:
    """What outside-in evidence proved about the name (VERIFICATION): a live web
    service, other listening ports (enrichment), a resolving-but-silent name, a
    name that no longer resolves, or nothing checked yet."""
    ep = signals._ep(a)
    if signals._ext_web(a):
        return "Live web service"
    if ports - _WEB_PORTS:
        return "Open non-web ports"
    if not ep:
        return "Not yet probed"
    if not ep.get("ip") and not ep.get("dns_a"):
        return "Doesn't resolve"
    return "No web response"


def is_external(a) -> bool:
    """The register's rule so Overview and register agree — the ONE canonical
    classifier (grc.modules.it_assets.asset_rollup.is_external)."""
    return _canon_is_external(a)


def fingerprint(a) -> Dict[str, Any]:
    pp = getattr(a, "platform_properties", None) or {}
    for key in ("fingerprint", "discovery_classification"):
        v = pp.get(key) if isinstance(pp, dict) else None
        if isinstance(v, dict) and (v.get("device_type") or v.get("os_guess") or v.get("vendor")):
            return v
    return {}


# ---------- software (estate-wide top products) ----------
TOP_SOFTWARE = 12                          # estate panel cap; the UI shows "+N more"
_SW_PAREN = re.compile(r"\s*\([^)]*\)")    # strip "(64-bit)", "(x64)" … from a display name
_SW_MAJOR = re.compile(r"\d+(?:\.\d+)?")   # first major[.minor] token in a version string


def _sw_name(name: Any) -> str:
    return _SW_PAREN.sub("", str(name or "")).strip()


def _sw_key(entry: Dict[str, Any], name: str) -> str:
    """Canonical product key — the stored software_key (mssql-2022, google-chrome) so
    name-spelling variants and patch builds of ONE product collapse to a single row; a
    pre-enrichment row with no key falls back to a slug of the display name."""
    k = str(entry.get("software_key") or "").strip().lower()
    return k or (re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:48] or "app")


def _sw_short_version(v: Any) -> str:
    m = _SW_MAJOR.search(str(v or ""))
    return m.group(0) if m else ""


# An internet-facing asset carries no installed-software list — its tech stack shows
# only in the HTTP Server banner ("nginx/1.24.0", "Microsoft-IIS/10.0", "cloudflare").
_SERVER_LABELS = {"microsoft-iis": "IIS", "apache-coyote": "Apache Tomcat", "openresty": "OpenResty",
                  "litespeed": "LiteSpeed", "cloudflare": "Cloudflare", "cloudfront": "CloudFront",
                  "apache": "Apache", "nginx": "nginx", "caddy": "Caddy", "jetty": "Jetty",
                  "gunicorn": "Gunicorn", "kestrel": "Kestrel", "tengine": "Tengine", "lighttpd": "lighttpd"}


def _server_tech(server: Any) -> Optional[Tuple[str, str]]:
    """(product, short version) parsed from an HTTP Server banner, or None. The banner
    is claimed outside-in (not an installed-software fact), so the UI labels it as such."""
    s = str(server or "").strip()
    if not s:
        return None
    prod, _, ver = s.split()[0].partition("/")  # "nginx/1.24.0 (Ubuntu)" -> nginx , 1.24.0
    prod = prod.strip().lower()
    return (_SERVER_LABELS.get(prod, prod), _sw_short_version(ver)) if prod else None


def _top_products(count: Counter, names: Dict[str, Counter], vers: Dict[str, Counter], cap: int) -> Dict[str, Any]:
    """Shared product+version rollup: most common first, readable label (the display name
    seen most often), a short version (dropped when the label already carries it), count."""
    rows = []
    for k, n in count.most_common(cap):
        lbl = names[k].most_common(1)[0][0] if k in names else k
        ver = vers[k].most_common(1)[0][0] if k in vers else ""
        rows.append({"key": k, "n": n, "label": lbl, "version": "" if ver and ver in lbl else ver})
    return {"top": rows, "more": max(0, len(count) - cap)}


# ---------- roll-up ----------
def _bucket() -> Dict[str, Any]:
    return {"n": 0, "sub": Counter(), "seen_30d": 0, "owner": 0, "cis": 0,
            "crit": dict.fromkeys(CRITS, 0), "eol_past": 0, "eol_soon": 0, "eol_known": 0,
            "samples": []}


def _subs(c: Counter) -> List[Dict[str, Any]]:
    top = c.most_common()
    if len(top) > SUBTYPE_CAP:
        rest = top[SUBTYPE_CAP - 1:]
        top = top[:SUBTYPE_CAP - 1] + [(f"Other ({len(rest)} kinds)", sum(n for _, n in rest))]
    return [{"label": k, "n": n, "gap": k in GAPS or k.endswith("unknown") or "not profiled" in k} for k, n in top]


def summarize(assets: Iterable[Any], cis_ids: Set[int], ports: Dict[int, Set[int]],
              dtypes: Dict[int, Optional[str]], now: datetime) -> Dict[str, Any]:
    """assets: objects with the ITAsset attributes this module reads (platform_properties
    limited to fingerprint / discovery_classification / external_probe / engine, plus
    detected_software_json + services for server-class hosts) · cis_ids: assets with a CIS
    run · ports / dtypes: latest discovery open ports + device type per asset id."""
    sides = {"external": {c: _bucket() for c in EXTERNAL}, "internal": {c: _bucket() for c in INTERNAL}}
    os_fam = {f: Counter() for f in OS_FAMILIES}
    os_samples: Dict[str, List[Dict[str, Any]]] = {f: [] for f in OS_FAMILIES}  # named hosts per OS family
    ext, ext_host, ext_ver, roots = Counter(), Counter(), Counter(), Counter()
    life = Counter()
    soon, stale_before = now + timedelta(days=90), now - timedelta(days=30)
    total = 0
    # ── additive estate-wide rollups (counts only; constant payload at 5 or 5,000) ──
    env_c, dclass_c, origin_c, team_c = Counter(), Counter(), Counter(), Counter()
    reg_c, scope_c, sec_fam = Counter(), Counter(), Counter()
    disc = {"managed": 0, "discovered": 0, "baseline": 0}
    team_n = cde_n = ephi_n = in_scope_n = lifecycle_set = env_set = int_hw = 0
    fresh = {"d7": 0, "d30": 0, "d90": 0, "old": 0, "never": 0}
    sec = {"scope": 0, "posture": 0, "av": 0, "edr": 0, "edr_stopped": 0, "protected": 0,
           "packages": 0, "inventoried": 0}
    cap = {"vcpu": 0, "ram": 0, "disk": 0, "hosts": 0, "val_sum": 0.0, "val_n": 0,
           "cost_sum": 0.0, "cost_n": 0}
    # ── version-level detail (the exec drill-down) ──
    os_eol_past: Counter = Counter()        # OS version line -> internal hosts past vendor end-of-life
    sw_count: Counter = Counter()           # software_key -> internal hosts running it
    sw_names: Dict[str, Counter] = {}       # software_key -> Counter(display name)
    sw_vers: Dict[str, Counter] = {}        # software_key -> Counter(short version)
    tech_count: Counter = Counter()         # external service product -> internet-facing sites running it
    tech_names: Dict[str, Counter] = {}
    tech_vers: Dict[str, Counter] = {}
    sw_hosts = tech_sites = 0
    for a in assets:
        total += 1
        fp = fingerprint(a)
        dt = (fp.get("device_type") or dtypes.get(a.id) or "").lower() or None
        eol = signals._eol(a)
        if is_external(a):
            side = "external"
            cls, sub = classify_external(a, ports.get(a.id, set()))
            nm = _dns_name(a)
            if _is_fqdn(nm):                         # surface concentration: names per registrable domain
                roots[_registrable(nm)] += 1
            else:
                ext["nonfqdn_units"] += 1            # a bare IP / single-label external host = its own unit
            ep = signals._ep(a)
            h = hosting(ep) if ep else "Not yet probed"
            ext_host[h] += 1
            ext_ver[probe_status(a, ports.get(a.id, set()))] += 1
            if ep:
                ext["probed"] += 1
                days = ep.get("tls_days_to_expiry")
                ext["tls_expired"] += bool(ep.get("tls_expired"))
                ext["tls_expiring_30d"] += bool(not ep.get("tls_expired") and isinstance(days, (int, float)) and 0 <= days <= 30)
                ext["cdn_waf"] += h == "CDN / WAF-fronted"
                ext["cloud"] += h == "Cloud-hosted"
                tech = _server_tech(ep.get("server"))   # web/app tech stack, outside-in
                if tech:
                    tlbl, tver = tech
                    tk = tlbl.lower()
                    tech_count[tk] += 1
                    tech_names.setdefault(tk, Counter())[tlbl] += 1
                    if tver:
                        tech_vers.setdefault(tk, Counter())[tver] += 1
                    tech_sites += 1
            ext["live"] += signals._ext_web(a)
        else:
            side = "internal"
            cls, sub = classify_internal(a, dt, fp)
            if cls == "Server":
                cls, sub = refine_server(a, fp) or (cls, sub)
            fam, line = os_of(a, fp)
            fb = os_bucket(fam, line)
            os_fam[fb][line] += 1
            if len(os_samples[fb]) < SAMPLE_CAP:     # named hosts for the OS-family drill-down modal
                cr = (getattr(a, "criticality", None) or "").lower()
                os_samples[fb].append({"id": getattr(a, "id", None), "name": _disp(a), "sub": line,
                                       "crit": cr if cr in CRITS and cr != "unrated" else ""})
            if eol and eol <= now:          # which OS versions are the obsolescence exposure
                os_eol_past[line] += 1
        b = sides[side][cls]
        b["n"] += 1
        b["sub"][sub] += 1
        seen = getattr(a, "last_seen_at", None)
        b["seen_30d"] += bool(seen and seen >= stale_before)
        b["owner"] += bool(getattr(a, "owner_id", None) or getattr(a, "primary_owner_id", None))
        b["cis"] += a.id in cis_ids
        c = (getattr(a, "criticality", None) or "").lower()
        b["crit"][c if c in CRITS else "unrated"] += 1
        if len(b["samples"]) < SAMPLE_CAP:           # named assets for the drill-down modal (grouped by sub)
            b["samples"].append({"id": getattr(a, "id", None), "name": _disp(a), "sub": sub,
                                 "crit": c if c in CRITS and c != "unrated" else ""})
        if eol:
            b["eol_known"] += 1
            b["eol_past"] += eol <= now
            b["eol_soon"] += now < eol <= soon
        life[(getattr(a, "lifecycle_state", None) or getattr(a, "status", None) or "unset").lower()] += 1

        # ── governance ──
        e = (getattr(a, "environment", None) or "").strip().lower()
        if e in ENVIRONMENTS:
            env_c[e] += 1; env_set += 1
        elif e:
            env_c["other"] += 1; env_set += 1
        else:
            env_c["unset"] += 1
        dc = (getattr(a, "data_classification", None) or "").strip().lower()
        dclass_c[dc if dc in DATA_CLASSES else "unset"] += 1
        if getattr(a, "lifecycle_state", None):
            lifecycle_set += 1
        # ── provenance ──
        o = (getattr(a, "origin_source", None) or "").strip().lower()
        origin_c[o if any(o == k for k, _ in ORIGIN_LABELS) else "unknown"] += 1
        dstate = (getattr(a, "discovery_state", None) or "").strip().lower()
        disc["managed" if dstate == "managed" else "discovered" if dstate == "discovered" else "baseline"] += 1
        # ── ownership (team / department) ──
        team = getattr(a, "owning_team", None) or getattr(a, "department", None)
        if team:
            team_c[str(team).strip()] += 1; team_n += 1
        # ── compliance / regulated data ──
        cde = bool(getattr(a, "cde_environment", None))
        ephi = bool(getattr(a, "ephi_environment", None))
        rd = (getattr(a, "regulated_data_type", None) or "none").strip().lower()
        if rd in REGULATED:
            reg_c[rd] += 1
        sc = getattr(a, "compliance_scope", None) or []
        if isinstance(sc, (list, tuple)):
            for s in sc:
                if s:
                    scope_c[str(s).strip()] += 1
        cde_n += cde
        ephi_n += ephi
        if cde or ephi or rd != "none" or (isinstance(sc, (list, tuple)) and len(sc) > 0):
            in_scope_n += 1
        # ── freshness (last seen) ──
        if not seen:
            fresh["never"] += 1
        else:
            dd = (now - seen).days
            fresh["d7" if dd <= 7 else "d30" if dd <= 30 else "d90" if dd <= 90 else "old"] += 1
        # ── capacity (hardware telemetry, where it was collected) ──
        cc, mg, sg = getattr(a, "cpu_cores", None), getattr(a, "memory_gb", None), getattr(a, "storage_gb", None)
        if cc or mg or sg:
            cap["hosts"] += 1
            cap["vcpu"] += int(cc or 0); cap["ram"] += int(mg or 0); cap["disk"] += int(sg or 0)
        val = getattr(a, "valuation", None)
        if isinstance(val, (int, float)) and val:
            cap["val_sum"] += float(val); cap["val_n"] += 1
        pcost = getattr(a, "purchase_cost", None)
        if isinstance(pcost, (int, float)) and pcost:
            cap["cost_sum"] += float(pcost); cap["cost_n"] += 1
        # ── endpoint security posture — internal hosts only (never seen outside-in).
        # security_posture is NULL = never read (unknown), which we keep distinct from
        # a read host that scored endpoint_protected=False. ──
        if side == "internal":
            sec["scope"] += 1
            if cc or mg:
                int_hw += 1
            # installed software → estate-wide product+version rollup (deduped per host
            # by canonical software_key so patch builds / name variants collapse to one row)
            sw_list = getattr(a, "detected_software_json", None)
            if isinstance(sw_list, list) and sw_list:
                here: Set[str] = set()
                for ent in sw_list:
                    if not isinstance(ent, dict):
                        continue
                    nm = _sw_name(ent.get("name"))
                    if not nm:
                        continue
                    k = _sw_key(ent, nm)
                    if k in here:
                        continue
                    here.add(k)
                    sw_count[k] += 1
                    sw_names.setdefault(k, Counter())[nm] += 1
                    sv = _sw_short_version(ent.get("version"))
                    if sv:
                        sw_vers.setdefault(k, Counter())[sv] += 1
                if here:
                    sw_hosts += 1
            sp = getattr(a, "security_posture", None)
            if isinstance(sp, dict) and sp:
                sec["posture"] += 1
                sec["av"] += bool(sp.get("has_antivirus"))
                sec["edr"] += bool(sp.get("has_edr"))
                sec["edr_stopped"] += bool(sp.get("edr_stopped"))
                sec["protected"] += bool(sp.get("endpoint_protected"))
                st = sp.get("software_total")
                if isinstance(st, (int, float)) and st > 0:
                    sec["packages"] += int(st); sec["inventoried"] += 1
                cats = sp.get("categories")
                if isinstance(cats, dict):
                    for fam, _lbl in SEC_FAMILIES:
                        if cats.get(fam):
                            sec_fam[fam] += 1

    def side_out(name: str, order) -> Dict[str, Any]:
        classes = []
        for cls in order:
            b = sides[name][cls]
            classes.append({
                "label": cls, "n": b["n"], "gap": cls in GAPS, "subtypes": _subs(b["sub"]),
                "samples": b["samples"],
                "seen_30d": b["seen_30d"], "owner": b["owner"], "crit": b["crit"],
                # Host benchmarks and OS end-of-life can't be observed outside-in: n/a, not 0.
                "cis": b["cis"] if name == "internal" else None,
                "eol": {"past": b["eol_past"], "soon": b["eol_soon"], "known": b["eol_known"]} if name == "internal" else None,
            })
        return {"total": sum(c["n"] for c in classes), "classes": classes}

    out_ext, out_int = side_out("external", EXTERNAL), side_out("internal", INTERNAL)
    out_ext["facets"] = {k: ext[k] for k in ("probed", "live", "cdn_waf", "cloud", "tls_expired", "tls_expiring_30d")}
    out_ext["hosting"] = [{"label": h, "n": ext_host[h], "gap": h in GAPS} for h in HOSTING]
    out_ext["verification"] = [{"label": v, "n": ext_ver[v], "gap": v in GAPS} for v in VERIFICATION]
    # Where the internet-facing surface concentrates: names grouped by registrable domain.
    out_ext["roots"] = {"distinct": len(roots), "named": sum(roots.values()),
                        "top": [{"label": k, "n": n} for k, n in roots.most_common(ROOTS_CAP)],
                        "more": max(0, len(roots) - ROOTS_CAP)}
    # Canonical rolled-up external count: one registrable (apex) domain = ONE asset
    # (subdomains folded in), plus any non-groupable external host (bare IP / single
    # label) as its own unit. This is the number dashboards + the register reconcile
    # against — NOT out_ext["total"], which is the flat per-name count.
    out_ext["units"] = len(roots) + ext["nonfqdn_units"]
    def _os_rows() -> List[Dict[str, Any]]:
        """OS family → version drill-down, each version tagged with how many of its hosts
        are past vendor end-of-life (the obsolescence exposure that version detail is for)."""
        rows = []
        for f in OS_FAMILIES:
            c = os_fam[f]
            top = c.most_common()
            folded: Set[str] = set()
            if len(top) > SUBTYPE_CAP:
                rest = top[SUBTYPE_CAP - 1:]
                folded = {k for k, _ in rest}
                top = top[:SUBTYPE_CAP - 1] + [(f"Other ({len(rest)} kinds)", sum(n for _, n in rest))]
            subs = []
            for k, n in top:
                past = sum(os_eol_past[x] for x in folded) if k.startswith("Other (") else os_eol_past.get(k, 0)
                subs.append({"label": k, "n": n, "eol_past": past,
                             "gap": k in GAPS or k.endswith("unknown") or "not profiled" in k})
            rows.append({"label": f, "n": sum(c.values()), "gap": f in GAPS,
                         "eol_past": sum(os_eol_past[x] for x in c), "subtypes": subs,
                         "samples": os_samples.get(f, [])})
        return rows
    out_int["os"] = _os_rows()
    out_int["facets"] = {"os_profiled": sum(o["n"] for o in out_int["os"] if o["label"] != "OS not visible")}
    allc = out_ext["classes"] + out_int["classes"]
    cov_seen = sum(c["seen_30d"] for c in allc)
    cov_owner = sum(c["owner"] for c in allc)
    cov_cis = sum(c["cis"] or 0 for c in out_int["classes"])
    crit_all = {k: sum(c["crit"][k] for c in allc) for k in CRITS}
    os_profiled = out_int["facets"]["os_profiled"]
    int_total = out_int["total"]
    unidentified = sides["external"]["Unidentified"]["n"] + sides["internal"]["Unidentified"]["n"]

    governance = {
        "criticality": crit_all,
        "environment": [{"label": e.title(), "n": env_c.get(e, 0)} for e in ENVIRONMENTS]
        + ([{"label": "Other", "n": env_c["other"]}] if env_c.get("other") else [])
        + [{"label": "Not set", "n": env_c.get("unset", 0), "gap": True}],
        "data_classification": [{"label": d.title(), "n": dclass_c.get(d, 0)} for d in DATA_CLASSES]
        + [{"label": "Not set", "n": dclass_c.get("unset", 0), "gap": True}],
    }
    provenance = {
        "origin": [{"label": lbl, "n": origin_c.get(k, 0)} for k, lbl in ORIGIN_LABELS]
        + ([{"label": "Unknown", "n": origin_c["unknown"], "gap": True}] if origin_c.get("unknown") else []),
        "managed": disc["managed"], "discovered": disc["discovered"], "baseline": disc["baseline"],
    }
    ownership = {
        "owned": cov_owner, "unowned": total - cov_owner, "with_team": team_n,
        "teams": [{"label": k, "n": n} for k, n in team_c.most_common(6)],
    }
    security = {
        "scope": sec["scope"], "posture": sec["posture"], "antivirus": sec["av"], "edr": sec["edr"],
        "edr_stopped": sec["edr_stopped"], "protected": sec["protected"], "packages": sec["packages"],
        "inventoried": sec["inventoried"],
        "families": [{"label": lbl, "n": sec_fam.get(k, 0)} for k, lbl in SEC_FAMILIES if sec_fam.get(k)],
    }
    compliance = {
        "cde": cde_n, "ephi": ephi_n, "in_scope": in_scope_n,
        "regulated": [{"label": r.upper() if r in ("pci", "phi", "pii") else r.title(), "n": reg_c.get(r, 0)}
                      for r in REGULATED],
        "regulated_none": total - sum(reg_c.values()),
        "scopes": [{"label": k, "n": n} for k, n in scope_c.most_common(8)],
    }
    freshness = {
        "buckets": [
            {"label": "Seen ≤7 days", "n": fresh["d7"]},
            {"label": "8–30 days", "n": fresh["d30"]},
            {"label": "31–90 days", "n": fresh["d90"]},
            {"label": "Over 90 days", "n": fresh["old"], "gap": True},
            {"label": "Never seen", "n": fresh["never"], "gap": True},
        ],
        "stale": fresh["d90"] + fresh["old"] + fresh["never"],
    }
    completeness = {
        "total": total,
        # n = assets we hold this signal for; of = assets it can apply to (host-only
        # signals scope to the internal estate — an outside-in asset can't carry them).
        "dims": [
            {"key": "classified", "label": "Classified", "n": total - unidentified, "of": total, "scope": "all"},
            {"key": "owner", "label": "Owner assigned", "n": cov_owner, "of": total, "scope": "all"},
            {"key": "criticality", "label": "Criticality rated", "n": total - crit_all["unrated"], "of": total, "scope": "all"},
            {"key": "lifecycle", "label": "Lifecycle set", "n": lifecycle_set, "of": total, "scope": "all"},
            {"key": "environment", "label": "Environment tagged", "n": env_set, "of": total, "scope": "all"},
            {"key": "seen30", "label": "Seen ≤30 days", "n": cov_seen, "of": total, "scope": "all"},
            {"key": "os", "label": "OS profiled", "n": os_profiled, "of": int_total, "scope": "internal"},
            {"key": "hardware", "label": "Hardware profiled", "n": int_hw, "of": int_total, "scope": "internal"},
            {"key": "security", "label": "Endpoint posture read", "n": sec["posture"], "of": int_total, "scope": "internal"},
            {"key": "cis", "label": "CIS benchmarked", "n": cov_cis, "of": int_total, "scope": "internal"},
        ],
    }
    capacity = {
        "hosts": cap["hosts"], "vcpu": cap["vcpu"], "ram_gb": cap["ram"], "disk_gb": cap["disk"],
        "valuation_sum": round(cap["val_sum"], 2), "valuation_n": cap["val_n"],
        "purchase_sum": round(cap["cost_sum"], 2), "purchase_n": cap["cost_n"],
    }
    # Estate-wide software & platform versions: internal installed products (DB engines,
    # web/app servers, apps — carries its own version) + internet-facing service banners.
    software = {
        "hosts_reporting": sw_hosts, "products": len(sw_count), "installs": sum(sw_count.values()),
        **_top_products(sw_count, sw_names, sw_vers, TOP_SOFTWARE),
        "external": {"sites": tech_sites, "products": len(tech_count),
                     **_top_products(tech_count, tech_names, tech_vers, TOP_SOFTWARE)},
    }
    return {
        "as_of": datetime.now(timezone.utc).isoformat(),
        "total": total,
        # Reconciled, roll-up counts (one apex domain = one external asset). `total`
        # above stays the flat per-row count for the composition breakdowns; these are
        # the numbers the Performance dashboard + register headline reconcile against.
        "rolled_external": out_ext["units"],
        "rolled_total": out_int["total"] + out_ext["units"],
        "external": out_ext,
        "internal": out_int,
        "coverage": {"seen_30d": cov_seen, "owner": cov_owner, "cis": cov_cis},
        "eol": {k: sum(c["eol"][k] for c in out_int["classes"]) for k in ("past", "soon", "known")},
        "lifecycle": [{"label": k, "n": n} for k, n in life.most_common()],
        "unidentified": unidentified,
        # ── additive estate dimensions (back-compatible; existing keys unchanged) ──
        "governance": governance,
        "provenance": provenance,
        "ownership": ownership,
        "security": security,
        "compliance": compliance,
        "freshness": freshness,
        "completeness": completeness,
        "capacity": capacity,
        "software": software,
    }


if __name__ == "__main__":  # self-check on synthetic assets — no DB needed
    from types import SimpleNamespace as NS

    now = datetime(2026, 9, 28, 12, 0)

    def A(i, **kw):
        base = dict(id=i, name=f"a{i}", fqdn=None, host_name=None, asset_type="infrastructure", asset_role=None,
                    platform_kind=None, origin_source=None, internet_facing=False, last_seen_source=None,
                    status="active", lifecycle_state=None, os_family=None, os_version=None, os_normalized=None,
                    os_build=None, manufacturer=None, model=None, owner_id=None, primary_owner_id=None,
                    criticality=None, last_seen_at=now - timedelta(days=2), eol_date=None,
                    platform_properties={}, detected_software_json=None,
                    environment=None, data_classification=None, department=None, owning_team=None,
                    discovery_state=None, cde_environment=False, ephi_environment=False,
                    regulated_data_type="none", compliance_scope=None, valuation=None, purchase_cost=None,
                    cpu_cores=None, memory_gb=None, storage_gb=None, security_posture=None)
        base.update(kw)
        return NS(**base)

    laptop = A(1, platform_kind="server", os_family="windows", os_version="Microsoft Windows 11 Pro 25H2",
               manufacturer="HP", model="HP EliteBook 840 G8 Notebook PC",
               detected_software_json=[{"name": "PostgreSQL 18", "version": "18.0"}])
    winsrv = A(2, platform_kind="server", os_family="windows", os_version="Microsoft Windows Server 2012 R2 Standard",
               environment="production", data_classification="confidential", lifecycle_state="active",
               owning_team="Platform Ops", discovery_state="managed", origin_source="connect",
               cpu_cores=8, memory_gb=32, storage_gb=512, regulated_data_type="pci", cde_environment=True,
               compliance_scope=["PCI-DSS"],
               security_posture={"has_antivirus": True, "antivirus_products": ["Defender"], "has_edr": True,
                                 "edr_products": ["Falcon"], "edr_stopped": [], "endpoint_protected": True,
                                 "software_total": 42, "categories": {"antivirus": 1, "edr": 1, "database": 1}})
    dbsrv = A(3, os_family="linux", os_version="Ubuntu 22.04.4 LTS",
              detected_software_json=[{"name": "postgresql-16", "version": "16.2"}])
    fw = A(4, manufacturer="Fortinet", model="FortiGate 60F")
    esx = A(5, os_version="VMware ESXi 7.0.3")
    nas = A(6, platform_properties={"fingerprint": {"device_type": "storage", "vendor": "synology"}})
    blank = A(7)
    portdb = A(8)  # only a discovery observation: 5432 listening
    web = A(9, name="shop.example.com", origin_source="easm", internet_facing=True, platform_properties={"external_probe": {
        "live": True, "status_code": 200, "scheme": "https", "title": "Shop", "server": "cloudflare",
        "cdn_waf": "Cloudflare", "ip": "1.2.3.4", "content_type": "text/html", "tls_days_to_expiry": 12}})
    api = A(10, name="api.example.com", origin_source="easm", internet_facing=True, platform_properties={"external_probe": {
        "live": True, "status_code": 200, "scheme": "https", "content_type": "application/json", "asn_org": "AMAZON-02",
        "server": "nginx/1.25.3", "ip": "5.6.7.8"}})
    rdp = A(11, name="vpn.example.com", origin_source="easm", internet_facing=True)
    unprobed = A(12, name="mail.example.com", origin_source="easm", internet_facing=True)
    dangling = A(13, name="old.example.com", origin_source="easm", internet_facing=True,
                 platform_properties={"external_probe": {"live": False, "ip": None, "dns_a": []}})
    bareip = A(14, name="203.0.113.9", internet_facing=True)

    assert classify_internal(laptop, "host", {}) == ("Workstation / endpoint", "Windows 11")  # 'server' kind is a placeholder
    assert refine_server(laptop, {}) is not None  # has a DB product...
    assert classify_internal(winsrv, None, {}) == ("Server", "Windows Server 2012 R2")
    assert classify_internal(dbsrv, None, {}) == ("Server", "Ubuntu 22.04") and refine_server(dbsrv, {}) == ("Database", "PostgreSQL")
    assert classify_internal(fw, None, {}) == ("Network device", "Firewall")
    assert classify_internal(esx, None, {}) == ("Virtualization", "Hypervisor host")
    assert classify_internal(nas, None, fingerprint(nas)) == ("Storage", "NAS / storage array")
    assert classify_internal(blank, None, {}) == ("Unidentified", "No identifying signal")
    assert classify_internal(portdb, "database", {"product": "postgres"}) == ("Database", "PostgreSQL")
    assert classify_external(web, set()) == ("Web application", "CDN / WAF-fronted")
    assert classify_external(api, set()) == ("API", "Cloud-hosted")
    assert classify_external(rdp, {443, 3389}) == ("Remote / admin service", "Remote access (SSH / RDP / VNC)")
    assert classify_external(unprobed, set()) == ("Domain / subdomain", "Not yet probed")
    assert classify_external(dangling, set()) == ("Domain / subdomain", "Doesn't resolve")
    assert classify_external(bareip, set()) == ("Unidentified", "No outside-in evidence")

    out = summarize([laptop, winsrv, dbsrv, fw, esx, nas, blank, portdb, web, api, rdp, unprobed, dangling, bareip],
                    cis_ids={2}, ports={11: {443, 3389}}, dtypes={1: "host", 8: "database"}, now=now)
    by = {c["label"]: c for c in out["internal"]["classes"]}
    assert out["total"] == 14 and out["external"]["total"] == 6 and out["internal"]["total"] == 8
    assert by["Workstation / endpoint"]["n"] == 1 and by["Server"]["n"] == 1 and by["Database"]["n"] == 2  # laptop stays an endpoint
    assert by["Server"]["cis"] == 1 and by["Server"]["eol"]["past"] == 1  # 2012 R2 extended support ended 2023-10-10
    assert [c["label"] for c in out["external"]["classes"]] == list(EXTERNAL)  # fixed buckets, zeros kept
    assert out["external"]["classes"][0]["cis"] is None and out["external"]["facets"]["tls_expiring_30d"] == 1
    os_rows = {o["label"]: o for o in out["internal"]["os"]}
    assert out["unidentified"] == 2 and os_rows["Windows Server"]["n"] == 1 and os_rows["Windows client"]["n"] == 1
    assert os_rows["Windows client"]["subtypes"][0]["label"] == "Windows 11" and os_rows["Linux"]["subtypes"][0]["label"] == "Ubuntu 22.04"
    assert {h["label"]: h["n"] for h in out["external"]["hosting"]} == {
        "CDN / WAF-fronted": 1, "Cloud-hosted": 1, "Hosting provider / ISP": 0, "Hosting unknown": 1, "Not yet probed": 3}
    assert {v["label"]: v["n"] for v in out["external"]["verification"]} == {
        "Live web service": 2, "Open non-web ports": 1, "No web response": 0, "Doesn't resolve": 1, "Not yet probed": 2}
    assert os_bucket("Windows", "Windows (version not profiled)") == "Windows (edition unknown)"

    # additive estate rollups
    gov = out["governance"]
    assert sum(gov["criticality"][k] for k in CRITS) == out["total"]
    assert {r["label"]: r["n"] for r in gov["environment"]}["Production"] == 1
    assert {r["label"]: r["n"] for r in gov["data_classification"]}["Confidential"] == 1
    prov = out["provenance"]
    assert prov["managed"] == 1 and {r["label"]: r["n"] for r in prov["origin"]}["Credentialed connect"] == 1
    assert out["ownership"]["with_team"] == 1 and out["ownership"]["teams"][0]["label"] == "Platform Ops"
    s = out["security"]
    assert s["scope"] == out["internal"]["total"] and s["posture"] == 1
    assert s["antivirus"] == 1 and s["edr"] == 1 and s["protected"] == 1 and s["packages"] == 42
    assert {r["label"]: r["n"] for r in s["families"]}.get("Database engine") == 1
    comp = out["compliance"]
    assert comp["cde"] == 1 and comp["in_scope"] == 1 and {r["label"]: r["n"] for r in comp["regulated"]}["PCI"] == 1
    fr = out["freshness"]
    assert sum(b["n"] for b in fr["buckets"]) == out["total"] and fr["buckets"][-1]["n"] == 0  # none never-seen
    cm = out["completeness"]
    assert len(cm["dims"]) == 10 and cm["dims"][0]["n"] == out["total"] - out["unidentified"]
    assert out["capacity"]["vcpu"] == 8 and out["capacity"]["hosts"] == 1

    # ── version-level detail (the exec drill-down) ──
    # OS family → version, each version carrying its obsolescence exposure.
    assert os_rows["Windows Server"]["subtypes"][0]["label"] == "Windows Server 2012 R2"
    assert os_rows["Windows Server"]["subtypes"][0]["eol_past"] == 1 and os_rows["Windows Server"]["eol_past"] == 1
    assert os_rows["Windows client"]["subtypes"][0]["eol_past"] == 0  # Windows 11 is still supported
    # Internal installed software → product + version + host count, deduped by software_key.
    sw = out["software"]
    assert sw["hosts_reporting"] == 2 and sw["products"] == 2 and sw["more"] == 0
    swk = {r["key"]: r for r in sw["top"]}
    assert set(swk) == {"postgresql-18", "postgresql-16"}
    assert swk["postgresql-18"]["n"] == 1 and swk["postgresql-18"]["version"] == "18.0" and swk["postgresql-18"]["label"] == "PostgreSQL 18"
    assert swk["postgresql-16"]["version"] == "16.2"
    # Internet-facing service banners → web/app-server tech + version.
    et = sw["external"]
    assert et["sites"] == 2 and et["products"] == 2
    etk = {r["key"]: r for r in et["top"]}
    assert etk["nginx"]["version"] == "1.25" and etk["cloudflare"]["version"] == ""

    # ── surface concentration + named drill-down samples ──
    rt = out["external"]["roots"]
    assert rt["distinct"] == 1 and rt["named"] == 5 and rt["top"][0] == {"label": "example.com", "n": 5}
    # Rolled-up external = 1 registrable domain (example.com, 5 names) + 1 bare-IP unit (203.0.113.9).
    assert out["external"]["units"] == 2 and out["rolled_external"] == 2
    assert out["rolled_total"] == out["internal"]["total"] + 2
    assert _registrable("a.b.co.uk") == "b.co.uk" and _registrable("x.example.com") == "example.com"
    # Named assets per class (modal key content): id for the detail link, sub = the sub-kind it groups under.
    assert by["Server"]["samples"][0] == {"id": 2, "name": "a2", "sub": "Windows Server 2012 R2", "crit": ""}
    assert by["Database"]["samples"][0]["sub"] == "PostgreSQL"  # refined server + port-only DB both land named here
    assert len(out["external"]["classes"][3]["samples"]) <= SAMPLE_CAP  # Domain/subdomain peek stays bounded
    # Named assets per OS FAMILY too (finer than class → the OS drill-down modal groups them by version).
    assert os_rows["Windows client"]["samples"][0] == {"id": 1, "name": "a1", "sub": "Windows 11", "crit": ""}
    assert os_rows["Windows Server"]["samples"][0]["name"] == "a2" and os_rows["Windows Server"]["samples"][0]["sub"] == "Windows Server 2012 R2"

    empty = summarize([], set(), {}, {}, now)
    assert empty["total"] == 0 and len(empty["completeness"]["dims"]) == 10 and empty["ownership"]["teams"] == []
    assert empty["external"]["roots"] == {"distinct": 0, "named": 0, "top": [], "more": 0}
    assert empty["software"]["top"] == [] and empty["software"]["hosts_reporting"] == 0 and empty["software"]["external"]["top"] == []
    print("estate_overview self-check OK")
