"""Build the SBP inventory row for an asset (derive what Ava collects, merge the
stored overrides), save stored fields, and export the whole tenant as the SBP
template .xlsx. No writes to ITAsset — stored values live in SbpAssetInventory.
"""
from __future__ import annotations

import io
import re
from datetime import datetime
from typing import Any, Dict, List, Optional

from sqlalchemy.orm import Session

from grc.models import ITAsset, Vulnerability, VulnerabilityAssetLink
from . import registry as R
from .models import SbpAssetInventory

_YN = lambda b: "Yes" if b else "No"


def ensure_table(db: Session) -> None:
    SbpAssetInventory.__table__.create(bind=db.get_bind(), checkfirst=True)


def _d(dt) -> str:
    return dt.strftime("%Y-%m-%d") if isinstance(dt, datetime) else ""


def _subnet(ip: Optional[str]) -> str:
    if not ip:
        return ""
    try:
        o = int(str(ip).split(".")[0])
    except (ValueError, IndexError):
        return ""
    if 1 <= o <= 126: return "A"
    if 128 <= o <= 191: return "B"
    if 192 <= o <= 223: return "C"
    if 224 <= o <= 239: return "D"
    return "E"


def _os(a: ITAsset) -> str:
    v = getattr(a, "os_version", None)
    if v:
        return str(v)
    fam = getattr(a, "os_family", None) or ""
    build = getattr(a, "os_build", None) or ""
    return (f"{fam} {build}").strip()


def _dbms(a: ITAsset) -> str:
    if getattr(a, "platform_kind", None) != "database":
        return ""
    pp = getattr(a, "platform_properties", None) or {}
    if isinstance(pp, dict):
        for k in ("version", "db_version", "engine_version", "server_version", "dbms_version"):
            if pp.get(k):
                return str(pp[k])
    return ""


def _edr(a: ITAsset) -> str:
    sp = getattr(a, "security_posture", None)
    if not isinstance(sp, dict) or "has_edr" not in sp:
        return ""  # unknown — never fabricate a "No"
    return _YN(bool(sp.get("has_edr")))


# Host-installed agent signatures — the SAME host-software signal EDR already uses.
# "Yes" when a known agent is in the collected inventory, "No" when inventory
# exists but none found, "" when there is no software inventory to judge from.
_DLP_SIGS = ("forcepoint", "digital guardian", "symantec dlp", "mcafee dlp",
             "trellix dlp", "netskope", "code42", "safetica", "endpoint dlp",
             "gtb inspector", "teramind", "zscaler")
_SIEM_SIGS = ("splunk", "universalforwarder", "splunkforwarder", "wazuh",
              "winlogbeat", "filebeat", "elastic agent", "elastic-agent", "nxlog",
              "syslog-ng", "rsyslog", "wincollect", "logrhythm", "arcsight",
              "fluentd", "fluent-bit", "cribl", "datadog agent",
              "microsoft monitoring agent", "azure monitor agent")
_DAM_SIGS = ("imperva", "guardium", "datasunrise", "dbprotect", "jsonar",
             "mcafee database", "trellix database")
# WAF / IPS / virtual-patching agents. Trend Micro Deep Security ("ds_agent") is
# the canonical host virtual-patching product; the rest are WAF/IPS agents that
# shield an unpatched app. Specific product tokens only — no bare "waf"/"asm".
_VPATCH_SIGS = ("modsecurity", "mod_security", "imperva", "securesphere",
                "big-ip", "bigip", "f5 networks", "fortiweb", "cloudflare",
                "akamai", "kona site defender", "deep security", "ds_agent",
                "tippingpoint", "signal sciences", "nginx app protect",
                "app protect", "barracuda web", "citrix adc", "netscaler",
                "snort", "suricata")


def _software_names(a: ITAsset) -> list:
    names = []
    sw = getattr(a, "detected_software_json", None) or []
    if isinstance(sw, list):
        for s in sw:
            n = s.get("name") if isinstance(s, dict) else s
            if n:
                names.append(str(n).lower())
    sp = getattr(a, "security_posture", None)
    if isinstance(sp, dict):
        for t in (sp.get("security_tools") or []):
            names.append(str(t).lower())
    return names


def _detect(a: ITAsset, sigs) -> str:
    names = _software_names(a)
    if not names:
        return ""  # no inventory collected -> unknown, leave for a human
    return "Yes" if any(any(sig in n for sig in sigs) for n in names) else "No"


def _server_desc(a: ITAsset) -> str:
    """Compose a factual server description from real hardware/OS/model columns."""
    parts = []
    osv = _os(a)
    if osv:
        parts.append(osv)
    mk = " ".join(str(x) for x in (getattr(a, "manufacturer", None), getattr(a, "model", None)) if x)
    if mk:
        parts.append(mk)
    hw = []
    if getattr(a, "cpu_cores", None):
        hw.append(f"{a.cpu_cores} vCPU")
    if getattr(a, "memory_gb", None):
        hw.append(f"{a.memory_gb} GB RAM")
    if getattr(a, "storage_gb", None):
        hw.append(f"{a.storage_gb} GB disk")
    if hw:
        parts.append(", ".join(hw))
    return " · ".join(parts)


def _obsolescence_timeline(a: ITAsset) -> str:
    eol = getattr(a, "eol_date", None)
    if not eol:
        return ""
    now = datetime.utcnow()
    if eol <= now:
        return f"Obsolete since {eol.strftime('%Y-%m-%d')}"
    return f"EOL {eol.strftime('%Y-%m-%d')} ({(eol - now).days} days remaining)"


def _va_block(db: Session, tenant_id: int, asset_id: int) -> Dict[str, Any]:
    rows = (
        db.query(Vulnerability.severity, Vulnerability.status, Vulnerability.discovered_at)
        .join(VulnerabilityAssetLink, VulnerabilityAssetLink.vulnerability_id == Vulnerability.id)
        .filter(VulnerabilityAssetLink.asset_id == asset_id, Vulnerability.tenant_id == tenant_id)
        .all()
    )
    now = datetime.utcnow()
    seen = [r.discovered_at for r in rows if r.discovered_at]
    crit = [r.discovered_at for r in rows if (r.severity or "").lower() == "critical" and (r.status or "open") == "open"]
    high = [r.discovered_at for r in rows if (r.severity or "").lower() == "high" and (r.status or "open") == "open"]
    days = lambda ds: (now - min(d for d in ds if d)).days if any(ds) else ""
    return {
        "last_va_date": _d(max(seen)) if seen else "",
        "va_open_critical": len(crit),
        "va_days_critical_open": days(crit),
        "va_open_high": len(high),
        "va_days_high_open": days(high),
    }


def _pt_block(db: Session, tenant_id: int, asset_id: int) -> Dict[str, Any]:
    """The PT columns, from penetration-test-sourced findings ONLY (the pentest
    module stamps its asset link `impact_on_asset='AI pentest scan'`). Returns all
    blank (UNKNOWN — never 0) when no pen-test has produced findings for this asset,
    so we never assert '0 open' for a test that was never run. Auto-populates the
    moment a pen-test writes findings."""
    rows = (
        db.query(Vulnerability.severity, Vulnerability.status, Vulnerability.discovered_at)
        .join(VulnerabilityAssetLink, VulnerabilityAssetLink.vulnerability_id == Vulnerability.id)
        .filter(VulnerabilityAssetLink.asset_id == asset_id,
                Vulnerability.tenant_id == tenant_id,
                VulnerabilityAssetLink.impact_on_asset.ilike("%pentest%"))
        .all()
    )
    if not rows:
        return {"last_pt_date": "", "pt_open_critical": "", "pt_days_critical_open": "",
                "pt_open_high": "", "pt_days_high_open": ""}
    now = datetime.utcnow()
    seen = [r.discovered_at for r in rows if r.discovered_at]
    crit = [r.discovered_at for r in rows if (r.severity or "").lower() == "critical" and (r.status or "open") == "open"]
    high = [r.discovered_at for r in rows if (r.severity or "").lower() == "high" and (r.status or "open") == "open"]
    days = lambda ds: (now - min(d for d in ds if d)).days if any(ds) else ""
    return {"last_pt_date": _d(max(seen)) if seen else "",
            "pt_open_critical": len(crit), "pt_days_critical_open": days(crit),
            "pt_open_high": len(high), "pt_days_high_open": days(high)}


def _required_patch(db: Session, tenant_id: int, asset_id: int, kind: str, a: ITAsset = None) -> str:
    """Latest patch the host still NEEDS, from the KB/patch references a credentialed
    scanner attaches to its findings (`Vulnerability.patch_references`). kind='os' →
    newest KB-type reference; kind='db' → newest reference on a database host. ''
    when no finding carries a patch reference (e.g. info-only scans) — Ava holds no
    vendor patch catalog, so this fills only from real scan data, never invented."""
    if kind == "db" and getattr(a, "platform_kind", None) != "database":
        return ""
    rows = (
        db.query(Vulnerability.patch_references)
        .join(VulnerabilityAssetLink, VulnerabilityAssetLink.vulnerability_id == Vulnerability.id)
        .filter(VulnerabilityAssetLink.asset_id == asset_id, Vulnerability.tenant_id == tenant_id)
        .all()
    )
    ids = []
    for (pr,) in rows:
        if not isinstance(pr, list):
            continue
        for ref in pr:
            if not isinstance(ref, dict) or not ref.get("id"):
                continue
            if kind == "os" and str(ref.get("type", "")).lower() != "kb":
                continue
            ids.append(str(ref["id"]))
    if not ids:
        return ""
    num = lambda x: int(re.search(r"\d+", x).group()) if re.search(r"\d+", x) else 0
    return max(set(ids), key=num)  # highest KB/patch number ≈ the newest one needed


def _norm_date(s: Any) -> str:
    """Best-effort normalise a captured date string to YYYY-MM-DD. Keeps the raw
    string if it can't be parsed — never fabricates a date."""
    raw = str(s or "").strip()
    if not raw:
        return ""
    core = raw.split(" ")[0].split("T")[0]  # drop any time component
    for fmt in ("%m/%d/%Y", "%Y-%m-%d", "%d/%m/%Y", "%m/%d/%y", "%d-%m-%Y"):
        try:
            return datetime.strptime(core, fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    return raw


def _win_last_patch(a: ITAsset) -> tuple:
    """(kb, install_date) of the most-recently INSTALLED Windows update, from the
    deep scan's Get-HotFix output on platform_properties.windows_update. Returns
    ('','') for a non-Windows host or when no patch history was collected.
    NB: the date is the INSTALL date (a real captured fact); the vendor's release
    date is not held by Ava, so an analyst confirms before submission."""
    pp = getattr(a, "platform_properties", None) or {}
    if not isinstance(pp, dict):
        return "", ""
    wu = pp.get("windows_update")
    data = wu.get("data") if isinstance(wu, dict) else None
    if not isinstance(data, dict):
        return "", ""
    kb = data.get("last_hotfix")
    date = data.get("last_installed")
    if not kb or not date:
        recent = data.get("recent_hotfixes") or []
        if isinstance(recent, list) and recent and isinstance(recent[0], dict):
            kb = kb or recent[0].get("id")
            date = date or recent[0].get("installed")
    return (str(kb) if kb else ""), _norm_date(date)


def _db_patch(a: ITAsset) -> str:
    """The APPLIED database patch/build level the typed collector read from the
    engine (MSSQL product_level + build; the version string is the patch level
    for the others). '' for a non-database asset. The vendor's LATEST patch and
    the patch DATE are not held by Ava, so those columns stay manual."""
    if getattr(a, "platform_kind", None) != "database":
        return ""
    pp = getattr(a, "platform_properties", None) or {}
    if not isinstance(pp, dict):
        return ""
    ver = _dbms(a)
    lvl = pp.get("product_level")  # MSSQL only: RTM / SPn / CUn — a real patch level
    if lvl and ver:
        return f"{lvl} · {ver}"
    return str(lvl or ver or "")


def _integrated_bmc(a: ITAsset) -> str:
    """Yes/No. Ava has no BMC/CMDB asset-sync connector (the only BMC provider,
    bmc_remedy, is ticketing-only and never stamps assets), so the truthful value
    is 'No' for every asset — unless one was explicitly sourced from a BMC system
    (future-proofs the Yes case without ever asserting a false Yes today)."""
    src = " ".join(str(getattr(a, c, "") or "")
                   for c in ("source_system", "last_seen_source", "origin_source")).lower()
    return "Yes" if ("bmc" in src or "remedy" in src) else "No"


_DR_TOKENS = ("dr", "standby", "replica", "secondary", "failover", "passive")


def _primary_dr(a: ITAsset) -> str:
    """'DR' only when clearly indicated — environment == dr, a name/fqdn token
    (dr/standby/replica/secondary/failover/passive), or a database reporting a
    standby/replica role. Never blanket-assumes 'Primary'; blank otherwise."""
    if str(getattr(a, "environment", "") or "").lower() == "dr":
        return "DR"
    hay = " ".join(str(getattr(a, c, "") or "")
                   for c in ("name", "host_name", "fqdn")).lower()
    for tok in _DR_TOKENS:
        if re.search(r'(?<![a-z])' + tok + r'(?![a-z])', hay):
            return "DR"
    pp = getattr(a, "platform_properties", None) or {}
    if isinstance(pp, dict):
        for sec in ("replication", "high_availability", "instance"):
            blk = pp.get(sec)
            data = blk.get("data") if isinstance(blk, dict) else None
            if isinstance(data, dict):
                role = str(data.get("role") or data.get("database_role") or "").lower()
                if any(w in role for w in ("standby", "replica", "recovery")):
                    return "DR"
    return ""


# Deterministic justification drafts — emitted ONLY when the DETECTED gap is real
# (the gating control derived "No"/exposed). Factual + editable; never an invented
# business excuse. Blank when the control is present or genuinely unknown.
_REASON_TEXT = {
    "reason_obsolete_os":         "Operating system is past its end-of-life/support date per Ava's obsolescence data — upgrade/replacement plan to be confirmed by the asset owner.",
    "reason_not_bmc":             "Asset is not integrated with a BMC/CMDB system — no BMC asset-sync connector is configured in Ava; integration status to be confirmed by the asset owner.",
    "reason_no_virtual_patching": "No virtual-patching (WAF/IPS) agent was detected in the latest software inventory — status to be confirmed by the asset owner.",
    "reason_no_xdr_edr":          "No XDR/EDR agent was detected in the latest software inventory — status to be confirmed by the asset owner.",
    "reason_dlp":                 "No DLP agent was detected in the latest software inventory — status to be confirmed by the asset owner.",
    "reason_public_dmz":          "Asset resolves to a public / internet-facing address in Ava's scan data — DMZ placement and exposure to be confirmed by the asset owner.",
    "reason_db_monitoring":       "No database-activity-monitoring agent was detected on this database host — status to be confirmed by the asset owner.",
    "reason_siem":                "No SIEM log-forwarding agent was detected in the latest software inventory — status to be confirmed by the asset owner.",
    "reason_web_app":             "Classified as a Web/Application server from its detected platform role and installed software — classification to be confirmed by the asset owner.",
    "reason_db_server":           "Classified as a Database server from its detected database platform — classification to be confirmed by the asset owner.",
}


def _reason_value(key: str, a: ITAsset, va: Optional[Dict[str, Any]] = None) -> str:
    """The gap-tied draft note, or '' when the control is present/unknown."""
    # patch-currency reasons are dynamic — they carry the real open-finding count
    if key in ("reason_os_patch", "reason_db_patch"):
        if key == "reason_db_patch" and getattr(a, "platform_kind", None) != "database":
            return ""
        v = va or {}
        try:
            n = int(v.get("va_open_critical") or 0) + int(v.get("va_open_high") or 0)
        except (TypeError, ValueError):
            n = 0
        if not n:
            return ""
        scope = "database" if key == "reason_db_patch" else "OS/software"
        return (f"Patch-currency review recommended — {n} open critical/high "
                f"vulnerabilit{'y' if n == 1 else 'ies'} in the latest scan; {scope} "
                f"patch status to be confirmed by the asset owner.")
    if key == "reason_obsolete_os":
        eol = getattr(a, "eol_date", None)
        gap = bool(eol and eol <= datetime.utcnow())
    elif key == "reason_not_bmc":
        gap = _integrated_bmc(a) == "No"
    elif key == "reason_no_virtual_patching":
        gap = _detect(a, _VPATCH_SIGS) == "No"
    elif key == "reason_no_xdr_edr":
        gap = _edr(a) == "No"
    elif key == "reason_dlp":
        gap = _detect(a, _DLP_SIGS) == "No"
    elif key == "reason_public_dmz":
        gap = bool(getattr(a, "internet_facing", False))
    elif key == "reason_db_monitoring":
        gap = getattr(a, "platform_kind", None) == "database" and _detect(a, _DAM_SIGS) == "No"
    elif key == "reason_siem":
        gap = _detect(a, _SIEM_SIGS) == "No"
    elif key == "reason_web_app":
        gap = getattr(a, "platform_kind", None) == "server"
    elif key == "reason_db_server":
        gap = getattr(a, "platform_kind", None) == "database"
    else:
        return ""
    return _REASON_TEXT.get(key, "") if gap else ""


def _base_value(key: str, a: ITAsset, va: Dict[str, Any]) -> Any:
    """The auto value BEFORE any stored override, for one field key."""
    # asset-column fields
    direct = {"asset_name": "name", "application_description": "description",
              "ip_address": "ip_address", "environment": "environment"}
    if key in direct:
        return getattr(a, direct[key], None) or ""
    if key == "subnet":            return _subnet(getattr(a, "ip_address", None))
    if key == "public_facing_dmz": return _YN(bool(getattr(a, "internet_facing", False)))
    if key == "os_with_version":   return _os(a)
    if key == "dbms_version":      return _dbms(a)
    if key == "xdr_edr":           return _edr(a)
    if key == "server_description": return _server_desc(a)
    if key == "classification":
        c = getattr(a, "criticality", None)
        return str(c).title() if c else ""
    if key == "dlp":               return _detect(a, _DLP_SIGS)
    if key == "siem_coverage":     return _detect(a, _SIEM_SIGS)
    if key == "db_monitoring":
        return _detect(a, _DAM_SIGS) if getattr(a, "platform_kind", None) == "database" else ""
    if key == "obsolescence_timeline": return _obsolescence_timeline(a)
    if key == "database_server":
        pk = getattr(a, "platform_kind", None)
        return "Yes" if pk == "database" else ("No" if pk else "")
    if key == "web_app_server":
        pk = getattr(a, "platform_kind", None)
        return "Yes" if pk in ("server",) else ("No" if pk == "database" else "")
    if key == "obsolescence_status":
        eol = getattr(a, "eol_date", None)
        return "" if not eol else ("Y" if eol <= datetime.utcnow() else "N")
    if key == "obsolete_since_days":
        eol = getattr(a, "eol_date", None)
        return (datetime.utcnow() - eol).days if (eol and eol <= datetime.utcnow()) else ""
    if key == "virtual_patching":  return _detect(a, _VPATCH_SIGS)
    if key == "integrated_bmc":    return _integrated_bmc(a)
    if key == "primary_dr":        return _primary_dr(a)
    if key == "last_os_patch":     return _win_last_patch(a)[0]
    if key == "last_os_patch_date": return _win_last_patch(a)[1]
    if key == "last_db_patch":     return _db_patch(a)
    if key.startswith("reason_"):  return _reason_value(key, a, va)
    if key in va:
        return va[key]
    return ""  # everything else is stored/reason -> no auto value


def get_stored(db: Session, tenant_id: int, asset_id: int) -> Dict[str, Any]:
    ensure_table(db)
    row = db.query(SbpAssetInventory).filter_by(tenant_id=tenant_id, asset_id=asset_id).first()
    return dict(row.data or {}) if row else {}


def build_row(db: Session, tenant_id: int, asset: ITAsset) -> List[Dict[str, Any]]:
    va = _va_block(db, tenant_id, asset.id)
    va.update(_pt_block(db, tenant_id, asset.id))
    va["latest_os_patch"] = _required_patch(db, tenant_id, asset.id, "os")
    va["latest_db_patch"] = _required_patch(db, tenant_id, asset.id, "db", asset)
    stored = get_stored(db, tenant_id, asset.id)
    out: List[Dict[str, Any]] = []
    for (key, letter, label, group, src) in R.FIELDS:
        base = "" if src == "reason" else _base_value(key, asset, va)
        ov = stored.get(key)
        overridden = ov is not None and str(ov) != ""
        out.append({
            "key": key, "letter": letter, "label": label, "group": group, "src": src,
            "editable": key in R.STORABLE_KEYS,
            "value": ov if overridden else base,
            "auto_value": base,
            "overridden": overridden,
        })
    return out


def set_stored(db: Session, tenant_id: int, asset_id: int,
               values: Dict[str, Any], user: Optional[str] = None) -> Dict[str, Any]:
    ensure_table(db)
    row = db.query(SbpAssetInventory).filter_by(tenant_id=tenant_id, asset_id=asset_id).first()
    data = dict(row.data or {}) if row else {}
    for k, v in (values or {}).items():
        if k in R.STORABLE_KEYS:      # ignore anything not user-writable
            data[k] = v
    if row is None:
        row = SbpAssetInventory(tenant_id=tenant_id, asset_id=asset_id, data=data, updated_by=user)
        db.add(row)
    else:
        row.data = data
        row.updated_by = user
    db.commit()
    return data


def export_rows(db: Session, tenant_id: int) -> List[List[Any]]:
    assets = db.query(ITAsset).filter(ITAsset.tenant_id == tenant_id).order_by(ITAsset.id).all()
    rows = []
    for a in assets:
        by_key = {f["key"]: f["value"] for f in build_row(db, tenant_id, a)}
        rows.append([by_key.get(k, "") for (k, *_r) in R.FIELDS])
    return rows


def export_xlsx(db: Session, tenant_id: int) -> bytes:
    from openpyxl import Workbook
    wb = Workbook(); ws = wb.active; ws.title = "Asset Inventory"
    ws.append(R.HEADERS)
    for r in export_rows(db, tenant_id):
        ws.append(r)
    buf = io.BytesIO(); wb.save(buf); return buf.getvalue()


def _selftest() -> None:
    """Pure-logic checks for the derivations (no DB). Asserts real values are
    produced AND that unknown inputs never yield a false 'Yes'/reason."""
    from types import SimpleNamespace as NS

    def A(**kw):
        base = dict(platform_kind=None, platform_properties=None,
                    detected_software_json=None, security_posture=None,
                    eol_date=None, internet_facing=False, environment=None,
                    name="", host_name="", fqdn="", source_system="discovery",
                    last_seen_source="cidr", origin_source="easm")
        base.update(kw)
        return NS(**base)

    # Windows host with a Get-HotFix history → last OS patch + normalised date.
    win = A(platform_properties={"windows_update": {"status": "discovered", "data": {
        "last_hotfix": "KB5129195", "last_installed": "09/15/2026 00:00:00",
        "recent_hotfixes": [{"id": "KB5129195", "installed": "09/15/2026 00:00:00"}]}}},
        security_posture={"has_edr": False}, detected_software_json=[{"name": "7-Zip"}])
    assert _win_last_patch(win) == ("KB5129195", "2026-09-15"), _win_last_patch(win)
    assert _base_value("last_os_patch", win, {}) == "KB5129195"
    assert _base_value("last_os_patch_date", win, {}) == "2026-09-15"
    # has_edr False + inventory present → No, and the reason fires.
    assert _edr(win) == "No"
    assert _reason_value("reason_no_xdr_edr", win) == _REASON_TEXT["reason_no_xdr_edr"]
    assert _reason_value("reason_dlp", win)        # no DLP in inventory → fires
    assert _reason_value("reason_not_bmc", win)    # no BMC connector → fires

    # EASM host: no software, empty posture → every control UNKNOWN, no false gap.
    easm = A(internet_facing=True, security_posture={}, detected_software_json=[],
             name="adfs.superior.edu.pk")
    assert _edr(easm) == "" and _detect(easm, _DLP_SIGS) == "" and _detect(easm, _VPATCH_SIGS) == ""
    assert _reason_value("reason_no_xdr_edr", easm) == ""   # unknown ≠ No
    assert _reason_value("reason_dlp", easm) == ""
    assert _reason_value("reason_no_virtual_patching", easm) == ""
    assert _reason_value("reason_public_dmz", easm)          # public IP → fires
    assert _integrated_bmc(easm) == "No"

    # BMC-sourced asset → Yes (future case).
    assert _integrated_bmc(A(source_system="bmc_helix")) == "Yes"

    # primary_dr: only when clearly indicated.
    assert _primary_dr(A(name="DESKTOP-EQ55Q8H")) == ""
    assert _primary_dr(A(name="sql-standby-02")) == "DR"
    assert _primary_dr(A(host_name="web-dr-01")) == "DR"
    assert _primary_dr(A(environment="dr")) == "DR"
    assert _primary_dr(A(platform_kind="database", platform_properties={
        "replication": {"data": {"role": "Replica (in recovery)"}}})) == "DR"

    # DB patch level (MSSQL product_level + build; blank for non-DB).
    mssql = A(platform_kind="database",
              platform_properties={"engine": "Microsoft SQL Server",
                                   "version": "15.0.4326.1", "product_level": "RTM"})
    assert _db_patch(mssql) == "RTM · 15.0.4326.1", _db_patch(mssql)
    pg = A(platform_kind="database", platform_properties={"engine": "PostgreSQL", "version": "16.2"})
    assert _db_patch(pg) == "16.2"
    assert _db_patch(win) == ""  # a Windows server is not a database

    # virtual patching detection.
    assert _detect(A(detected_software_json=[{"name": "Trend Micro Deep Security Agent"}]), _VPATCH_SIGS) == "Yes"

    # classification reason drafts (web/app + database)
    assert _reason_value("reason_web_app", A(platform_kind="server"))
    assert _reason_value("reason_web_app", A(platform_kind=None)) == ""
    assert _reason_value("reason_db_server", A(platform_kind="database"))
    # dynamic patch-currency reason: fires only on a real open critical/high count
    assert _reason_value("reason_os_patch", A(), {"va_open_critical": 2, "va_open_high": 1})
    assert _reason_value("reason_os_patch", A(), {"va_open_critical": 0, "va_open_high": 0}) == ""
    assert _reason_value("reason_db_patch", A(platform_kind="server"), {"va_open_high": 5}) == ""  # non-DB

    # field-count invariant: automation increased the auto set.
    auto = sum(1 for f in R.FIELDS if f[4].startswith("asset") or f[4] == "derived")
    assert auto == 49, auto
    # every newly-wired field is still analyst-editable.
    for k in ("last_os_patch", "integrated_bmc", "primary_dr", "virtual_patching",
              "last_db_patch", "reason_no_xdr_edr", "reason_public_dmz",
              "latest_os_patch", "latest_db_patch", "last_pt_date", "pt_open_critical",
              "reason_web_app", "reason_db_server", "reason_os_patch", "reason_db_patch"):
        assert k in R.STORABLE_KEYS, k
    print(f"sbp_inventory selftest OK — {auto}/52 auto")


if __name__ == "__main__":
    _selftest()
