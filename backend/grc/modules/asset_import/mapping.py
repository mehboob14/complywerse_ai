"""Column-mapping intelligence for the asset import wizard — accept ANY sheet.

Pure functions, no DB, no FastAPI. Given the raw grid of an uploaded sheet it:
  1. finds the REAL header row (clients put a title/logo/blank rows above it),
  2. guesses which of THEIR columns maps to each of OUR canonical fields — by
     header synonyms first, then by looking at the actual values (a column full
     of IPs is the IP column even if it is labelled "Address"),
  3. normalizes messy values into our enums ("H" / "1" / "Critical" -> "critical").

Dependency-free and self-tested (`python -m grc.modules.asset_import.mapping`
or `python mapping.py`) so the logic can be verified without the app running.

ponytail: synonym dictionary + value sniffing, no ML. AI-assisted mapping for
truly bizarre files is a later enhancement; this covers the real-world 95%.
"""
from __future__ import annotations

import re
from datetime import date, datetime
from typing import Any, Dict, List, Optional

# Our target fields. `syn` = header aliases; `required` only on name.
CANONICAL_FIELDS: Dict[str, Dict[str, Any]] = {
    "name":            {"label": "Asset name",  "required": True,
                        "syn": ["name", "asset", "asset name", "device", "device name", "title",
                                "system", "system name", "node", "label", "asset id", "tag", "item"]},
    "host_name":       {"label": "Hostname",
                        "syn": ["hostname", "host", "host name", "fqdn", "computer", "computer name",
                                "machine", "machine name", "dns", "dns name", "netbios"]},
    "ip_address":      {"label": "IP address",
                        "syn": ["ip", "ip address", "ipv4", "ip addr", "address", "primary ip",
                                "management ip", "mgmt ip", "ip4"]},
    "mac_address":     {"label": "MAC address",
                        "syn": ["mac", "mac address", "hardware address", "physical address", "ether"]},
    "asset_type":      {"label": "Asset type",
                        "syn": ["type", "asset type", "category", "class", "kind", "asset category",
                                "asset class", "device type"]},
    "criticality":     {"label": "Criticality",
                        "syn": ["criticality", "priority", "importance", "business criticality",
                                "tier", "rating", "risk rating"]},
    "environment":     {"label": "Environment",
                        "syn": ["environment", "env", "stage", "deployment", "zone"]},
    "os_family":       {"label": "Operating system",
                        "syn": ["os", "operating system", "platform", "os family", "os name",
                                "os version", "firmware"]},
    "data_classification": {"label": "Data classification",
                        "syn": ["data classification", "classification", "data class", "sensitivity",
                                "confidentiality level", "info class", "data sensitivity"]},
    "owner":           {"label": "Owner",
                        "syn": ["owner", "asset owner", "responsible", "custodian", "contact",
                                "owner email", "poc", "steward"]},
    "location":        {"label": "Location",
                        "syn": ["location", "site", "datacenter", "data center", "region",
                                "facility", "building", "rack"]},
    "business_function": {"label": "Business function",
                        "syn": ["business function", "function", "business unit",
                                "service", "role", "application role"]},
    "confidentiality": {"label": "Confidentiality (C)",
                        "syn": ["confidentiality", "conf", "cia c", "c rating"]},
    "integrity":       {"label": "Integrity (I)",
                        "syn": ["integrity", "cia i", "i rating"]},
    "availability":    {"label": "Availability (A)",
                        "syn": ["availability", "avail", "cia a", "a rating", "uptime tier"]},
    "status":          {"label": "Status",
                        "syn": ["status", "state", "operational status"]},
    "lifecycle_state": {"label": "Lifecycle",
                        "syn": ["lifecycle", "lifecycle state", "lifecycle stage", "phase",
                                "stage of life"]},
    # ── ITAM parity: hardware / procurement / org (all real ITAsset columns) ──
    "serial_number":   {"label": "Serial number",
                        "syn": ["serial", "serial number", "serial no", "sn", "service tag", "serial #"]},
    "manufacturer":    {"label": "Manufacturer",
                        "syn": ["manufacturer", "make", "brand", "oem"]},
    "model":           {"label": "Model",
                        "syn": ["model", "model number", "model name", "model no"]},
    "vendor":          {"label": "Vendor",
                        "syn": ["vendor", "supplier", "provider", "reseller"]},
    "department":      {"label": "Department",
                        "syn": ["department", "dept", "division", "org unit", "organizational unit", "cost center"]},
    "assigned_user":   {"label": "Assigned user",
                        "syn": ["assigned user", "assigned to", "end user", "primary user", "used by", "assignee", "user"]},
    "owning_team":     {"label": "Owning team",
                        "syn": ["owning team", "team", "support group", "group", "managed by", "responsible team"]},
    "purchase_cost":   {"label": "Purchase cost",
                        "syn": ["purchase cost", "cost", "price", "purchase price", "acquisition cost", "capex", "unit cost"]},
    "valuation":       {"label": "Asset value",
                        "syn": ["valuation", "asset value", "value", "replacement cost", "book value"]},
    "purchase_date":   {"label": "Purchase date",
                        "syn": ["purchase date", "purchased", "purchased on", "acquired", "acquisition date",
                                "buy date", "po date", "date purchased"]},
    "warranty_expiry": {"label": "Warranty expiry",
                        "syn": ["warranty expiry", "warranty", "warranty expiration", "warranty end",
                                "warranty until", "warranty date"]},
    "eol_date":        {"label": "End-of-life date",
                        "syn": ["eol", "eol date", "end of life", "end of support", "eos",
                                "decommission date", "retirement date"]},
    "cpu_cores":       {"label": "CPU cores",
                        "syn": ["cpu cores", "cores", "cpu", "vcpu", "vcpus", "processors", "cpu count", "core count"]},
    "memory_gb":       {"label": "Memory (GB)",
                        "syn": ["memory gb", "memory", "ram", "ram gb", "memory (gb)", "ram (gb)"]},
    "storage_gb":      {"label": "Storage (GB)",
                        "syn": ["storage gb", "storage", "disk", "disk gb", "disk size", "storage (gb)",
                                "hdd", "ssd", "capacity gb"]},
    "description":     {"label": "Description / notes",
                        "syn": ["description", "notes", "comment", "comments", "details",
                                "remarks", "note"]},
}

# ── Vulnerability import fields (Phase 2) ────────────────────────────────────
VULN_FIELDS: Dict[str, Dict[str, Any]] = {
    "title":       {"label": "Title", "required": True,
                    "syn": ["title", "name", "vulnerability", "vuln", "finding", "issue",
                            "summary", "plugin name", "vulnerability name", "vuln title"]},
    "severity":    {"label": "Severity", "required": True,
                    "syn": ["severity", "risk", "risk level", "threat level", "priority", "rating"]},
    "cvss_score":  {"label": "CVSS score",
                    "syn": ["cvss", "cvss score", "cvss base score", "base score", "cvss3", "cvss v3"]},
    "cve_id":      {"label": "CVE",
                    "syn": ["cve", "cve id", "cve number", "cve reference"]},
    "cwe_id":      {"label": "CWE",
                    "syn": ["cwe", "cwe id", "weakness"]},
    "affected_host": {"label": "Affected host / asset",
                    "syn": ["host", "hostname", "host name", "affected host", "ip", "ip address",
                            "asset", "affected asset", "target", "device", "affected system", "fqdn"]},
    "affected_component": {"label": "Component / port / URL",
                    "syn": ["component", "affected component", "service", "port", "url", "endpoint", "location"]},
    "description": {"label": "Description",
                    "syn": ["description", "details", "synopsis", "finding description", "summary",
                            "notes", "note", "comment", "comments", "observation", "finding details"]},
    "recommendation": {"label": "Recommendation / remediation",
                    "syn": ["recommendation", "remediation", "solution", "fix", "mitigation", "resolution"]},
}

FIELD_SETS = {"asset": CANONICAL_FIELDS, "vuln": VULN_FIELDS}


def fields_for(kind: str) -> Dict[str, Dict[str, Any]]:
    return FIELD_SETS.get(kind or "asset", CANONICAL_FIELDS)


_IPV4 = re.compile(r"^\s*(\d{1,3}\.){3}\d{1,3}\s*$")
_MAC = re.compile(r"^\s*([0-9a-fA-F]{2}[:\-]){5}[0-9a-fA-F]{2}\s*$")
_EMAIL = re.compile(r"[^@\s]+@[^@\s]+\.[^@\s]+")


def _norm(s: Any) -> str:
    """lowercase, strip, collapse every non-alphanumeric run to one space."""
    return re.sub(r"[^a-z0-9]+", " ", str(s if s is not None else "").lower()).strip()


# reverse index: normalized synonym -> canonical field, per field-set (cached)
_SYN_CACHE: Dict[int, Dict[str, str]] = {}


def _syn_index(fields: Dict[str, Dict[str, Any]]) -> Dict[str, str]:
    got = _SYN_CACHE.get(id(fields))
    if got is None:
        got = {}
        for _f, _spec in fields.items():
            got.setdefault(_norm(_f), _f)
            for _s in _spec["syn"]:
                got.setdefault(_norm(_s), _f)
        _SYN_CACHE[id(fields)] = got
    return got


def detect_header_row(grid: List[List[Any]], scan: int = 15,
                      fields: Optional[Dict[str, Dict[str, Any]]] = None) -> int:
    """Index of the row most likely to be the header. Clients prepend titles /
    logos / blank rows, so header != row 0 in the real world. We score each of
    the first `scan` rows by how many cells look like known field names."""
    idx = _syn_index(fields or CANONICAL_FIELDS)
    best_i, best_score = 0, -1.0
    for i, row in enumerate(grid[:scan]):
        cells = [c for c in row if str(c if c is not None else "").strip()]
        if not cells:
            continue
        known = sum(1 for c in row if _norm(c) in idx)
        shortish = sum(1 for c in cells if len(str(c)) <= 40)
        # known-field cells dominate; a fuller, short-text row breaks ties
        score = known * 3 + len(cells) * 0.1 + shortish * 0.05
        if score > best_score:
            best_score, best_i = score, i
    return best_i


def _infer_from_values(values: List[Any]) -> Optional[str]:
    """When the header is ambiguous, sniff the column's actual values."""
    vals = [str(v).strip() for v in values if str(v if v is not None else "").strip()]
    if not vals:
        return None

    def frac(pred) -> float:
        return sum(1 for v in vals if pred(v)) / len(vals)

    if frac(lambda v: bool(_IPV4.match(v))) >= 0.6:
        return "ip_address"
    if frac(lambda v: bool(_MAC.match(v))) >= 0.6:
        return "mac_address"
    if frac(lambda v: bool(_EMAIL.search(v))) >= 0.6:
        return "owner"
    crit = {"low", "medium", "high", "critical", "l", "m", "h", "c", "med", "crit"}
    if frac(lambda v: v.lower() in crit) >= 0.7:
        return "criticality"
    os_kw = ("windows", "linux", "ubuntu", "debian", "centos", "red hat", "rhel",
             "macos", "mac os", "server 20", "esxi", "android", "ios ")
    if frac(lambda v: any(k in v.lower() for k in os_kw)) >= 0.5:
        return "os_family"
    return None


def guess_mapping(headers: List[Any], columns: Optional[List[List[Any]]] = None,
                  fields: Optional[Dict[str, Dict[str, Any]]] = None) -> Dict[str, Dict[str, Any]]:
    """{source_header: {field, confidence 0..1, why}} — field=None means unmapped."""
    fields = fields or CANONICAL_FIELDS
    idx = _syn_index(fields)
    columns = columns or [[] for _ in headers]
    out: Dict[str, Dict[str, Any]] = {}
    taken: Dict[str, float] = {}  # field -> best confidence already assigned
    for i, h in enumerate(headers):
        key = str(h)
        nh = _norm(h)
        field, conf, why = None, 0.0, "no match — set manually"
        if not nh:
            out[key] = {"field": None, "confidence": 0.0, "why": "blank header"}
            continue
        if nh in idx:
            field, conf, why = idx[nh], 0.98, "exact header match"
        else:
            best_f, best_ov = None, 0.0
            htok = set(nh.split())
            for syn, f in idx.items():
                stok = set(syn.split())
                if not stok:
                    continue
                ov = len(htok & stok) / len(stok)
                if ov > best_ov:
                    best_ov, best_f = ov, f
            if best_f and best_ov >= 0.5:
                field, conf, why = best_f, round(0.5 + 0.3 * best_ov, 2), "header keyword match"
            else:
                inferred = _infer_from_values(columns[i] if i < len(columns) else [])
                if inferred and inferred in fields:   # only accept an inferred field valid for this kind
                    field, conf, why = inferred, 0.55, "matched by column values"
        # if two columns claim the same field, keep the stronger one mapped
        if field and taken.get(field, 0.0) >= conf:
            field, conf, why = None, 0.0, "duplicate of a stronger column — set manually"
        elif field:
            taken[field] = conf
        out[key] = {"field": field, "confidence": conf, "why": why}
    return out


_CRIT = {
    "critical": "critical", "crit": "critical", "c": "critical", "4": "critical", "5": "critical",
    "very high": "critical", "vhigh": "critical",
    "high": "high", "h": "high", "3": "high",
    "medium": "medium", "med": "medium", "m": "medium", "moderate": "medium", "2": "medium",
    "low": "low", "l": "low", "minimal": "low", "1": "low",
}
_TYPE_SYN = {
    "application": ["application", "app", "software", "service", "system", "web app", "api", "portal", "saas app"],
    "infrastructure": ["infrastructure", "infra", "server", "network", "hardware", "device", "endpoint",
                        "workstation", "laptop", "desktop", "vm", "virtual machine", "host", "switch",
                        "router", "firewall", "storage", "appliance", "printer"],
    "data": ["data", "database", "db", "datastore", "data store", "dataset", "warehouse"],
    "cloud": ["cloud", "saas", "iaas", "paas", "aws", "azure", "gcp", "cloud service"],
    "third_party": ["third party", "3rd party", "vendor", "external", "supplier", "partner"],
}
_TYPE = {}
for _canon, _aliases in _TYPE_SYN.items():
    for _a in _aliases:
        _TYPE[_norm(_a)] = _canon


def _parse_date(raw: Any) -> Optional[datetime]:
    """Best-effort date parse. openpyxl (data_only) already yields datetime for
    real date cells; CSV strings go through numeric + month-name formats.
    ponytail: all-≤12 numeric dates are assumed DD/MM (intl); real Excel date
    cells arrive as datetime and skip the ambiguity entirely."""
    if isinstance(raw, datetime):
        return raw
    if isinstance(raw, date):
        return datetime(raw.year, raw.month, raw.day)
    s = str(raw).strip()
    if not s:
        return None
    s = re.sub(r"[ T]\d{1,2}:\d{2}(:\d{2})?.*$", "", s).strip()  # drop a trailing time only
    parts = re.split(r"[/\-.]", s)
    if len(parts) == 3 and all(p.isdigit() for p in parts):
        a, b, c = (int(p) for p in parts)
        if a >= 1000:                              # YYYY-MM-DD
            y, m, d = a, b, c
        else:
            y = c if c >= 1000 else (2000 + c if c < 100 else c)
            if a > 12 and b <= 12:   d, m = a, b   # unambiguous DD/MM
            elif b > 12 and a <= 12: m, d = a, b   # unambiguous MM/DD
            else:                    d, m = a, b   # ambiguous -> DD/MM
        try:
            return datetime(y, m, d)
        except ValueError:
            return None
    for fmt in ("%d %b %Y", "%d %B %Y", "%b %d %Y", "%b %d, %Y", "%B %d, %Y",
                "%d-%b-%Y", "%d %b, %Y", "%B %d %Y"):
        try:
            return datetime.strptime(s, fmt)
        except ValueError:
            continue
    return None


def normalize_value(field: str, raw: Any) -> Any:
    """Coerce a raw cell into our canonical value. Unknown enum -> None so the
    row's validation can flag it rather than smuggling garbage into the DB."""
    if raw is None:
        return None
    s = str(raw).strip()
    if s == "":
        return None
    if field == "criticality":
        return _CRIT.get(s.lower())
    if field == "severity":
        return {"critical": "critical", "crit": "critical", "c": "critical", "4": "critical",
                "5": "critical", "high": "high", "h": "high", "3": "high", "medium": "medium",
                "med": "medium", "m": "medium", "moderate": "medium", "2": "medium",
                "low": "low", "l": "low", "1": "low", "info": "info", "informational": "info",
                "information": "info", "none": "info", "0": "info"}.get(s.lower())
    if field == "cvss_score":
        try:
            return round(float(str(s).split()[0]), 1)
        except (ValueError, TypeError):
            return None
    if field == "asset_type":
        n = _norm(s)
        if n in _TYPE:
            return _TYPE[n]
        # token match so "SQL Database" -> data, "Web Server" -> infrastructure;
        # check specific types before infrastructure (the catch-all). Whole-token
        # match avoids substring traps like "db" inside "sandbox".
        toks = set(n.split())
        for canon in ("data", "cloud", "third_party", "application", "infrastructure"):
            for alias in _TYPE_SYN[canon]:
                aw = _norm(alias).split()
                if aw and all(w in toks for w in aw):
                    return canon
        return None  # unrecognised; commit defaults it to infrastructure
    if field in ("confidentiality", "integrity", "availability"):
        try:
            return max(1, min(5, int(float(s))))
        except (ValueError, TypeError):
            return None
    if field == "data_classification":
        return {"public": "public", "internal": "internal", "confidential": "confidential",
                "restricted": "restricted", "sensitive": "confidential", "pii": "confidential",
                "private": "confidential", "secret": "restricted", "top secret": "restricted"}.get(s.lower())
    if field == "status":
        return {"active": "active", "in use": "active", "running": "active", "live": "active",
                "production": "active", "operational": "active",
                "inactive": "inactive", "offline": "inactive", "disabled": "inactive",
                "decommissioned": "decommissioned", "retired": "decommissioned",
                "disposed": "decommissioned"}.get(s.lower())  # unknown -> None -> model default
    if field == "lifecycle_state":
        return {"planned": "planned", "active": "active", "in service": "active",
                "maintenance": "maintenance", "decommissioned": "decommissioned",
                "retired": "retired", "disposed": "retired"}.get(s.lower())
    if field == "environment":
        return s.lower()  # free-ish text; keep normalized case
    if field in ("purchase_cost", "valuation"):
        m = re.search(r"-?\d[\d,]*\.?\d*", s.replace(" ", ""))
        try:
            return float(m.group(0).replace(",", "")) if m else None
        except ValueError:
            return None
    if field in ("cpu_cores", "memory_gb", "storage_gb"):
        m = re.search(r"\d[\d,]*\.?\d*", s)
        try:
            return int(round(float(m.group(0).replace(",", "")))) if m else None
        except ValueError:
            return None
    if field in ("purchase_date", "warranty_expiry", "eol_date"):
        return _parse_date(raw)
    return s


def apply_mapping(headers: List[Any], row: List[Any], field_by_col: Dict[str, str]) -> Dict[str, Any]:
    """Turn one raw row into a canonical {field: value} dict using the map."""
    rec: Dict[str, Any] = {}
    for i, h in enumerate(headers):
        f = field_by_col.get(str(h))
        if not f:
            continue
        val = normalize_value(f, row[i] if i < len(row) else None)
        if val is not None:
            rec[f] = val
    return rec


def _demo() -> None:
    """Runnable self-check: a deliberately messy sheet must map correctly."""
    grid = [
        ["Acme Corp — Asset Register (confidential)", None, None, None, None],   # title row
        [None, None, None, None, None],                                          # blank row
        ["Device Name", "Host", "Address", "Business Criticality", "OS"],        # real header @ idx 2
        ["Payroll DB", "pay-db01", "10.0.0.5", "High", "Ubuntu 22.04"],
        ["Web Front", "web01", "10.0.0.6", "critical", "Windows Server 2019"],
    ]
    hidx = detect_header_row(grid)
    assert hidx == 2, f"header row wrong: {hidx}"
    headers = grid[hidx]
    cols = [[r[i] for r in grid[hidx + 1:]] for i in range(len(headers))]
    m = guess_mapping(headers, cols)
    got = {h: m[h]["field"] for h in map(str, headers)}
    assert got["Device Name"] == "name", got
    assert got["Host"] == "host_name", got
    assert got["Address"] == "ip_address", got           # inferred from IP values, header is vague
    assert got["Business Criticality"] == "criticality", got
    assert got["OS"] == "os_family", got
    # value normalization
    assert normalize_value("criticality", "H") == "high"
    assert normalize_value("criticality", "1") == "low"
    assert normalize_value("asset_type", "SQL Database") == "data"
    assert normalize_value("asset_type", "Laptop") == "infrastructure"
    assert normalize_value("confidentiality", "5") == 5
    rec = apply_mapping(headers, grid[4], {h: m[h]["field"] for h in map(str, headers)})
    assert rec["name"] == "Web Front" and rec["ip_address"] == "10.0.0.6" and rec["criticality"] == "critical", rec
    # ── vuln field-set ──
    vh = ["Finding", "Risk", "CVE Number", "CVSS", "Affected IP", "Remediation"]
    vcols = [["SQLi"], ["High"], ["CVE-2024-1"], ["9.8"], ["10.0.0.5"], ["patch it"]]
    vg = {h: guess_mapping(vh, vcols, fields=VULN_FIELDS)[h]["field"] for h in vh}
    assert vg == {"Finding": "title", "Risk": "severity", "CVE Number": "cve_id",
                  "CVSS": "cvss_score", "Affected IP": "affected_host", "Remediation": "recommendation"}, vg
    assert normalize_value("severity", "Informational") == "info"
    assert normalize_value("severity", "H") == "high"
    assert normalize_value("cvss_score", "9.8") == 9.8
    # ── ITAM fields: header mapping + number/date normalization ──
    ah = ["Serial No", "RAM (GB)", "Disk", "vCPUs", "Purchase Date", "Vendor", "Assigned To", "Cost"]
    ag = {h: guess_mapping(ah, fields=CANONICAL_FIELDS)[h]["field"] for h in ah}
    assert ag == {"Serial No": "serial_number", "RAM (GB)": "memory_gb", "Disk": "storage_gb",
                  "vCPUs": "cpu_cores", "Purchase Date": "purchase_date", "Vendor": "vendor",
                  "Assigned To": "assigned_user", "Cost": "purchase_cost"}, ag
    assert normalize_value("purchase_cost", "$1,250.50") == 1250.5
    assert normalize_value("memory_gb", "16 GB") == 16
    assert normalize_value("cpu_cores", "8 vCPU") == 8
    assert normalize_value("purchase_date", "2023-06-15") == datetime(2023, 6, 15)
    assert normalize_value("warranty_expiry", "15/06/2023") == datetime(2023, 6, 15)  # DD/MM
    assert normalize_value("eol_date", "12/31/2025") == datetime(2025, 12, 31)        # MM/DD (day>12)
    assert normalize_value("purchase_date", "Jun 15, 2023") == datetime(2023, 6, 15)
    print("mapping self-check OK (asset + vuln + ITAM)")


if __name__ == "__main__":
    _demo()
