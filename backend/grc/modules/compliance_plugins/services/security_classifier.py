"""Software classification + endpoint security posture.

Collection (agent heartbeat, agentless WinRM/SSH probe) gives us a flat list of
installed software per host. On its own that is just names — it does not answer
the questions an operator actually asks: *does this box have antivirus? an EDR?
what is it running?* This module turns the raw inventory into that insight.

Two outputs:
  * classify(name)         → a category + AV/EDR flags for one software entry
  * summarize_posture(list) → a per-asset security posture: which AV/EDR products
                              are present, and a category breakdown of everything
                              installed.

The signatures are real product families (not a demo list). They are matched as
case-insensitive substrings against the software name AND its normalized key, so
"Windows Defender", "Microsoft Defender Antivirus" and a "windows-defender" key
all resolve. Matching is deliberately generous on the vendor/product token — an
inventory string is messy — and specific enough not to cross families.

Adding a product is a one-line signature edit; nothing else changes.
"""
from __future__ import annotations

import re
from datetime import datetime
from functools import lru_cache
from typing import Any, Dict, List, Optional


# Category → list of lowercase substrings that identify a product in that family.
# Order matters only for display; a name can match one category (first hit wins
# in classify()). EDR is checked before antivirus because several EDR products
# also ship an AV engine and we want the stronger label.
_SIGNATURES: List[tuple] = [
    # ── Endpoint Detection & Response (EDR / XDR) ──────────────────────────
    ("edr", [
        "crowdstrike", "falcon sensor", "sentinelone", "sentinel agent",
        "carbon black", "cb defense", "cortex xdr", "traps",           # Palo Alto
        "defender for endpoint", "mde", "microsoft monitoring agent",
        "cylance", "tanium", "trellix", "fireeye", "hx agent",
        "elastic endpoint", "elastic agent", "huntress", "red canary",
        "cybereason", "sophos intercept x", "trend micro apex",
        "defender atp", "wdatp", "limacharlie",
    ]),
    # ── Antivirus / anti-malware ───────────────────────────────────────────
    ("antivirus", [
        "windows defender", "microsoft defender antivirus", "defender antivirus",
        "mcafee", "trellix endpoint security", "symantec", "norton",
        "sophos", "eset", "nod32", "bitdefender", "kaspersky", "avast",
        " avg ", "avg antivirus", "malwarebytes", "webroot", "f-secure",
        "panda", "trend micro", "clamav", "clamwin", "immunet",
        "vipre", "comodo", "gdata", "g data", "totaldefense",
    ]),
    # ── Backup / recovery ──────────────────────────────────────────────────
    ("backup", [
        "veeam", "commvault", "veritas", "netbackup", "backup exec",
        "acronis", "rubrik", "cohesity", "arcserve", "bacula", "restic",
        "duplicati", "windows server backup",
    ]),
    # ── Remote access ──────────────────────────────────────────────────────
    ("remote_access", [
        "teamviewer", "anydesk", "vnc", "realvnc", "tightvnc", "ultravnc",
        "logmein", "gotomypc", "splashtop", "remote desktop", "rustdesk",
        "screenconnect", "connectwise control", "dameware",
    ]),
    # ── VPN / secure access ────────────────────────────────────────────────
    ("vpn", [
        "openvpn", "wireguard", "anyconnect", "cisco secure client",
        "globalprotect", "pulse secure", "ivanti secure", "forticlient",
        "nordlayer", "tailscale", "zscaler",
    ]),
    # ── Databases ──────────────────────────────────────────────────────────
    ("database", [
        "postgresql", "postgres", "mysql", "mariadb", "sql server",
        "mssql", "oracle database", "mongodb", "redis", "elasticsearch",
        "cassandra", "db2", "cockroachdb", "influxdb", "couchbase",
    ]),
    # ── Web / application servers ───────────────────────────────────────────
    ("web_server", [
        "internet information services", "iis", "apache http", "apache2",
        "httpd", "nginx", "tomcat", "jboss", "wildfly", "websphere",
        "weblogic", "node.js", "gunicorn", "caddy",
    ]),
    # ── Containers / orchestration ──────────────────────────────────────────
    ("container", [
        "docker", "containerd", "kubernetes", "kubelet", "podman",
        "cri-o", "rancher", "openshift",
    ]),
    # ── Monitoring / logging agents ─────────────────────────────────────────
    ("monitoring", [
        "nagios", "zabbix", "datadog", "splunk", "splunkforwarder",
        "wazuh", "ossec", "new relic", "prometheus", "grafana agent",
        "elastic beats", "filebeat", "winlogbeat", "telegraf",
        "solarwinds", "site24x7",
    ]),
]

# Flattened for a quick "which category does this belong to" lookup.
_CATEGORY_ORDER = [cat for cat, _ in _SIGNATURES]


def _haystack(entry: Dict[str, Any]) -> str:
    return f" {(entry.get('name') or '')} {(entry.get('software_key') or '')} ".lower()


@lru_cache(maxsize=1024)
def _needle_re(needle: str) -> "re.Pattern[str]":
    # Match on alphanumeric boundaries so a short acronym needle like "mde" hits
    # the token "mde" but NOT the middle of another word. The old plain-substring
    # match read "libheif-plugin-aomdec" as "mde" (= Microsoft Defender for
    # Endpoint) and mislabelled a HEIF codec as an EDR. Hyphens/spaces/dots are
    # boundaries; this keeps every real multi-word product name matching.
    return re.compile(r"(?<![a-z0-9])" + re.escape(needle.strip().lower()) + r"(?![a-z0-9])")


def _matches(needle: str, hay: str) -> bool:
    return bool(_needle_re(needle).search(hay))


def classify(entry: Dict[str, Any]) -> Optional[str]:
    """Return the category for one software entry, or None if it matches no
    known family (ordinary application). First matching family wins; EDR is
    listed before antivirus so a product that is both reads as EDR."""
    hay = _haystack(entry)
    for category, needles in _SIGNATURES:
        for needle in needles:
            if _matches(needle, hay):
                return category
    return None


def _product_label(entry: Dict[str, Any]) -> str:
    name = (entry.get("name") or "").strip()
    return name or (entry.get("software_key") or "unknown")


_EDR_NEEDLES = dict(_SIGNATURES)["edr"]


def _edr_family(text: str) -> Optional[str]:
    """The EDR signature a name hits — lines a software-list entry up with the
    deep scan's service read of the same product."""
    hay = f" {text} ".lower()
    return next((n for n in _EDR_NEEDLES if _matches(n, hay)), None)


def _deep(platform_properties: Any, section: str) -> Dict[str, Any]:
    """platform_properties[section]['data'] from the Windows deep scan, or {}."""
    blk = platform_properties.get(section) if isinstance(platform_properties, dict) else None
    data = blk.get("data") if isinstance(blk, dict) else None
    return data if isinstance(data, dict) else {}


def summarize_posture(detected_software: Optional[List[Dict[str, Any]]],
                      platform_properties: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Roll a detected-software list up into a security posture.

    Returns has_antivirus / has_edr plus the product names behind each, and a
    count of every recognised category. Unrecognised software is counted under
    'application' so the totals still add up to what's installed.

    `platform_properties` adds the Windows deep scan's own security read
    (SecurityCenter2, Get-MpComputerStatus, EDR service state). Defender and the
    MDE sensor are OS components — never in the installed-programs list — so the
    software signatures alone report a Defender-only host as unprotected.
    """
    items = detected_software or []
    antivirus: List[str] = []
    edr: List[str] = []
    categories: Dict[str, int] = {}

    sec = _deep(platform_properties, "security_products")
    agents = [e for e in (sec.get("edr_xdr") or []) if isinstance(e, dict) and e.get("product")]
    # An EDR protects only while its service runs. Installed-but-stopped is
    # recorded, and overrides a software-list hit for the same product.
    edr_stopped = [e["product"] for e in agents if not e.get("running")]
    dead = {_edr_family(p) for p in edr_stopped} - {None}

    seen_av: set = set()
    seen_edr: set = set()
    for entry in items:
        if not isinstance(entry, dict):
            continue
        cat = classify(entry) or "application"
        categories[cat] = categories.get(cat, 0) + 1
        label = _product_label(entry)
        if cat == "antivirus" and label.lower() not in seen_av:
            antivirus.append(label)
            seen_av.add(label.lower())
        elif cat == "edr" and label.lower() not in seen_edr and _edr_family(_haystack(entry)) not in dead:
            edr.append(label)
            seen_edr.add(label.lower())

    deep_av = [a["name"] for a in (sec.get("antivirus") or [])
               if isinstance(a, dict) and a.get("enabled") and a.get("name")]
    if _deep(platform_properties, "defender").get("antivirus_enabled") \
            and not any("defender" in n.lower() for n in deep_av + antivirus):
        deep_av.append("Microsoft Defender Antivirus")
    for name in deep_av:
        if name.lower() not in seen_av:
            antivirus.append(name)
            seen_av.add(name.lower())
    for e in agents:
        if e.get("running") and e["product"].lower() not in seen_edr:
            edr.append(e["product"])
            seen_edr.add(e["product"].lower())

    return {
        "has_antivirus": bool(antivirus),
        "antivirus_products": antivirus,
        "has_edr": bool(edr),
        "edr_products": edr,
        "edr_stopped": edr_stopped,
        # A host with neither AV nor EDR is the finding an operator wants to see.
        "endpoint_protected": bool(antivirus or edr),
        "security_tools": antivirus + edr,
        "categories": categories,
        "software_total": len(items),
        "computed_at": datetime.utcnow().isoformat(),
    }


def apply_posture(asset) -> Dict[str, Any]:
    """Compute the posture from an asset's detected_software_json (+ its deep
    scan's security sections) and store it on asset.security_posture. Returns
    the posture. Called by every collection path after it writes the software
    inventory, so agent and agentless hosts get the same treatment."""
    posture = summarize_posture(getattr(asset, "detected_software_json", None),
                                getattr(asset, "platform_properties", None))
    try:
        asset.security_posture = posture
    except Exception:
        pass
    return posture
