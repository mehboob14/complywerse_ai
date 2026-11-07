"""Asset signals the inventory Overview reads: database-server role, endpoint class,
external web exposure, OS end-of-life and DB engine labels.

Pure functions over an ITAsset's stored telemetry (no DB writes, no network).
Lifted from the cyber product's SBP inventory service, which is deliberately not
part of ComplyVerse; only these read-only classifiers are kept.
"""
import re
from datetime import datetime
from typing import Any, Dict, List, Optional

from grc.models import ITAsset

_DB_PRODUCTS = [("postgresql", "postgresql", "PostgreSQL"), ("mariadb", "mariadb", "MariaDB"),
                ("mysql", "mysql", "MySQL"), ("redis", "redis", "Redis"),
                ("mongodb", "mongodb", "MongoDB"), ("sql server", "mssqlserver", "SQL Server"),
                ("oracle database", "oracle-database", "Oracle Database")]


def db_label(name: str) -> str:
    """Engine family for an installed DB product name ('MariaDB 12.3 (x64)' ->
    'MariaDB'); the name itself when it isn't a tracked engine."""
    n = name.lower()
    return next((label for key, _slug, label in _DB_PRODUCTS if key in n), name)


def _os(a: ITAsset) -> str:
    v = getattr(a, "os_version", None)
    if v:
        return str(v)
    fam = getattr(a, "os_family", None) or ""
    build = getattr(a, "os_build", None) or ""
    return (f"{fam} {build}").strip()


_DB_RX = re.compile(
    r"^(postgresql([- ]\d+(\.\d+)?|\d*-server|-x64-\d+)?$|mysql[- ]server|mysql\d*$|"
    r"mariadb([- ]server|[- ]\d|$)|microsoft sql server 20\d\d( r2)? \(64-bit\)$|"
    r"sql server \(|mssqlserver$|mssql\$|oracle database|oracleservice|"
    r"mongodb([- ]org[- ]server|[- ]server|[- ]\d|$)|mongod$|"
    r"redis([- ]server| on windows|[- ]\d|$)|ibm db2|db2 server|sybase)")


def _software(a: ITAsset) -> list:
    """[(name, version)] from the collected software inventory, original case."""
    out = []
    for s in (getattr(a, "detected_software_json", None) or []):
        n = s.get("name") if isinstance(s, dict) else s
        if n:
            out.append((str(n), str(s.get("version") or "") if isinstance(s, dict) else ""))
    return out


def _services(a: ITAsset) -> list:
    """Windows service names + display names from the deep scan."""
    pp = getattr(a, "platform_properties", None) or {}
    blk = pp.get("services") if isinstance(pp, dict) else None
    data = blk.get("data") if isinstance(blk, dict) else None
    return [str(s[k]) for s in (data if isinstance(data, list) else [])
            if isinstance(s, dict) for k in ("name", "display_name") if s.get(k)]


def _role_evidence(a: ITAsset, rx) -> list:
    """Products proving a server role: software names, else service names."""
    hit = lambda names: list(dict.fromkeys(n for n in names if rx.search(n.lower().strip())))
    return hit(n for n, _v in _software(a)) or hit(_services(a))


def _role(a: ITAsset, rx, kind: Optional[str] = None) -> str:
    """'Yes' when a server product of this role is installed/registered (or a
    typed collector connected the asset as one), 'No' when an inventory exists
    and none is, '' when nothing is known (left for a human)."""
    if (kind and getattr(a, "platform_kind", None) == kind) or _role_evidence(a, rx):
        return "Yes"
    return "No" if (_software(a) or _services(a)) else ""


def _is_db(a: ITAsset) -> str:
    return _role(a, _DB_RX, "database")


def _ep(a: ITAsset) -> Dict[str, Any]:
    """The external (outside-in / EASM) probe facts stored on an internet-facing
    asset — server header, page title, WAF/CDN, TLS, hosting — or {}. This is the
    ONLY host evidence an external asset has (no credentialed software/OS read)."""
    pp = getattr(a, "platform_properties", None) or {}
    ep = pp.get("external_probe") if isinstance(pp, dict) else None
    return ep if isinstance(ep, dict) else {}


def _ext_web(a: ITAsset) -> bool:
    """True when the probe shows the host actually SERVED HTTP(S) — a live
    web/application server proven from outside (not merely a resolvable name)."""
    ep = _ep(a)
    return bool(ep.get("live") and (ep.get("status_code") or ep.get("server")
                                    or ep.get("scheme") or ep.get("title")))


_VER_KEYS = ("version", "db_version", "engine_version", "server_version", "dbms_version")


def _db_engines(a: ITAsset) -> list:
    """[(name, version)] of the host's database engines: installed software, or
    the engine a typed DB collector connected to."""
    eng = [(n, v) for n, v in _software(a) if _DB_RX.search(n.lower().strip())]
    pp = getattr(a, "platform_properties", None) or {}
    if not eng and getattr(a, "platform_kind", None) == "database" and isinstance(pp, dict):
        ver = next((str(pp[k]) for k in _VER_KEYS if pp.get(k)), "")
        eng = [(str(pp.get("engine") or "Database engine"), ver)]
    return eng


_WIN11 = {  # version: (Home/Pro, Enterprise/Education)
    "21h2": ("2023-10-10", "2024-10-08"), "22h2": ("2024-10-08", "2025-10-14"),
    "23h2": ("2025-11-11", "2026-11-10"), "24h2": ("2026-10-13", "2027-10-12"),
    "25h2": ("2027-10-12", "2028-10-10")}


_WIN10 = {
    "1809": ("2020-11-10", "2021-05-11"), "1903": ("2020-12-08", "2020-12-08"),
    "1909": ("2021-05-11", "2022-05-10"), "2004": ("2021-12-14", "2021-12-14"),
    "20h2": ("2022-05-10", "2023-05-09"), "21h1": ("2022-12-13", "2022-12-13"),
    "21h2": ("2023-06-13", "2024-06-11"), "22h2": ("2025-10-14", "2025-10-14")}


_WIN10_LTSC = {"2015": "2025-10-14", "2016": "2026-10-13",
               "2019": "2029-01-09", "2021": "2027-01-12"}


_WIN_SERVER = {"2003": "2015-07-14", "2008": "2020-01-14", "2012": "2023-10-10",
               "2016": "2027-01-12", "2019": "2029-01-09", "2022": "2031-10-14",
               "2025": "2034-11-14"}  # extended-support end; an R2 shares its base year


_EOL_RX = [  # checked in order — specific before general
    (r"windows xp", "2014-04-08"), (r"windows 7\b", "2020-01-14"),
    (r"windows 8\.1", "2023-01-10"), (r"windows 8\b", "2016-01-12"),
    (r"(red hat enterprise linux|rhel)\D*6\b", "2020-11-30"),
    (r"(red hat enterprise linux|rhel)\D*7\b", "2024-06-30"),
    (r"(red hat enterprise linux|rhel)\D*8\b", "2029-05-31"),
    (r"(red hat enterprise linux|rhel)\D*9\b", "2032-05-31"),
    (r"centos stream\D*8\b", "2024-05-31"),
    (r"centos\D*6\b", "2020-11-30"), (r"centos\D*7\b", "2024-06-30"),
    (r"centos(?! stream)\D*8\b", "2021-12-31"),
    (r"ubuntu\D*16\.04", "2021-04-30"), (r"ubuntu\D*18\.04", "2023-05-31"),
    (r"ubuntu\D*20\.04", "2025-05-31"),
    (r"debian\D*9\b", "2022-06-30"), (r"debian\D*10\b", "2024-06-30"),
    (r"debian\D*11\b", "2026-08-31"), (r"debian\D*12\b", "2028-06-30"),
]


def _vendor_eol(os_s: str) -> Optional[datetime]:
    """Vendor end-of-support date for an OS string, or None when not in the table."""
    s = (os_s or "").lower()
    d = None
    m = re.search(r"windows server (\d{4})", s)
    if m:
        d = _WIN_SERVER.get(m.group(1))
    elif re.search(r"windows 1[01]\b", s):
        if "ltsc" in s or "ltsb" in s:  # long-term channel runs on its own dates
            y = re.search(r"lts[bc]\D*(\d{4})", s)
            y = y.group(1) if y else None
            if "windows 10" in s:  # (Windows 11 LTSC isn't tabled -> stays blank)
                d = "2032-01-13" if (y == "2021" and "iot" in s) else _WIN10_LTSC.get(y)
        else:
            v = re.search(r"\b(1809|1903|1909|2004|2[0-5]h[12])\b", s)
            pair = (_WIN11 if "windows 11" in s else _WIN10).get(v.group(1)) if v else None
            if pair:
                d = pair[1 if re.search(r"enterprise|education", s) else 0]
    else:
        d = next((dd for rx, dd in _EOL_RX if re.search(rx, s)), None)
    return datetime.strptime(d, "%Y-%m-%d") if d else None


def _eol(a: ITAsset) -> Optional[datetime]:
    """End of vendor support: the asset's own eol_date when an analyst set one,
    else the vendor date for its detected OS; None when neither is known."""
    return getattr(a, "eol_date", None) or _vendor_eol(
        f"{_os(a)} {getattr(a, 'os_build', None) or ''}")


