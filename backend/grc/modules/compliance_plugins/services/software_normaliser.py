"""Software inventory → software_key → CIS benchmark mapping.

The agent reports raw software names ("Microsoft SQL Server 2022 (64-bit)",
"Apache Tomcat 9.0.85", windows_role "Web-Server"). This module maps each
to a canonical software_key at the SAME level-2 convention as os_normalized
(mssql-2022, tomcat-9.0) so the strict matcher and library tree treat
application children exactly like OS hosts.

Pure regex — no AI, deterministic, same philosophy as the OS detector.
"""
from __future__ import annotations

import re
from typing import Any, Optional

from sqlalchemy import or_
from sqlalchemy.orm import Session


def _truncate2(version: str) -> str:
    if not version:
        return version
    parts = version.split(".")
    return ".".join(parts[:2]) if len(parts) >= 2 else version


# (regex on raw name, key builder). First match wins — order by specificity.
# Builders receive the regex match + version string and return a level-2 key.
_SOFTWARE_PATTERNS: list[tuple[re.Pattern, Any]] = [
    # ── Databases ──────────────────────────────────────────────────────
    (re.compile(r"SQL\s*Server\s*(\d{4})", re.I),
     lambda m, v: f"mssql-{m.group(1)}"),
    (re.compile(r"PostgreSQL\s*(\d+)", re.I),
     lambda m, v: f"postgresql-{m.group(1)}"),
    # Bare process name ("postgres" from the listening layer, no version
    # knowable) → unversioned family key; rstrip below cleans the dash.
    (re.compile(r"\bpostgres(?:ql)?(?:-(\d+))?\b", re.I),
     lambda m, v: f"postgresql-{m.group(1) or (v or '').split('.')[0]}"),
    (re.compile(r"MySQL\s*(?:Server\s*)?(\d+\.\d+)?", re.I),
     lambda m, v: f"mysql-{_truncate2(m.group(1) or v or '8.0')}"),
    (re.compile(r"MariaDB\s*(\d+\.\d+)?", re.I),
     lambda m, v: f"mariadb-{_truncate2(m.group(1) or v or '')}".rstrip("-")),
    (re.compile(r"MongoDB\s*(?:Server\s*)?(\d+)?", re.I),
     lambda m, v: f"mongodb-{m.group(1) or (v or '').split('.')[0]}"),
    (re.compile(r"Cassandra\s*(\d+\.\d+)?", re.I),
     lambda m, v: f"cassandra-{_truncate2(m.group(1) or v or '')}".rstrip("-")),
    (re.compile(r"Oracle\s*Database\s*(\d+\w*)", re.I),
     lambda m, v: f"oracle-db-{m.group(1)}"),
    (re.compile(r"\bredis(?:-server)?\b", re.I), lambda m, v: "redis"),
    (re.compile(r"elasticsearch", re.I), lambda m, v: "elasticsearch"),
    (re.compile(r"IBM\s*DB2", re.I), lambda m, v: "ibm-db2"),
    # ── Web / app servers ──────────────────────────────────────────────
    (re.compile(r"Apache\s*Tomcat\s*(\d+(?:\.\d+)?)?", re.I),
     lambda m, v: f"tomcat-{_truncate2(m.group(1) or v or '')}".rstrip("-") or "tomcat"),
    (re.compile(r"Apache\s*HTTP\s*Server\s*(\d+\.\d+)?|^httpd$|^apache2$", re.I),
     lambda m, v: f"apache-httpd-{_truncate2((m.group(1) if m.lastindex else None) or v or '2.4')}"),
    (re.compile(r"\bnginx\b", re.I), lambda m, v: "nginx"),
    (re.compile(r"^Web-Server$|^IIS\b|Internet Information Services", re.I),
     lambda m, v: "iis-10"),
    (re.compile(r"WebSphere", re.I), lambda m, v: "websphere"),
    (re.compile(r"\btomcat\d*\b", re.I),
     lambda m, v: f"tomcat-{_truncate2(v or '')}".rstrip("-") or "tomcat"),
    # ── Windows Server roles (Layer 1 names from Get-WindowsFeature) ──
    (re.compile(r"^AD-Domain-Services$", re.I), lambda m, v: "windows-role-adds"),
    (re.compile(r"^DNS$", re.I), lambda m, v: "windows-role-dns"),
    (re.compile(r"^DHCP$", re.I), lambda m, v: "windows-role-dhcp"),
    (re.compile(r"^FileAndStorage-Services$|^File-Services$", re.I), lambda m, v: "windows-role-fileserver"),
    (re.compile(r"^Hyper-V$", re.I), lambda m, v: "hyper-v"),
    (re.compile(r"^Remote-Desktop-Services$", re.I), lambda m, v: "windows-role-rds"),
    (re.compile(r"^Web-Application-Proxy$", re.I), lambda m, v: "windows-role-wap"),
    (re.compile(r"^ADCS|Certificate", re.I), lambda m, v: "windows-role-adcs"),
    # ── Messaging / cache / queue ──────────────────────────────────────
    (re.compile(r"RabbitMQ", re.I), lambda m, v: "rabbitmq"),
    (re.compile(r"\bkafka\b", re.I), lambda m, v: "kafka"),
    # ── Container / orchestration ──────────────────────────────────────
    (re.compile(r"\bdocker\b", re.I), lambda m, v: "docker"),
    (re.compile(r"kubelet|kubernetes", re.I), lambda m, v: "kubernetes"),
    (re.compile(r"containerd", re.I), lambda m, v: "docker"),
    # ── Collaboration / mail ───────────────────────────────────────────
    (re.compile(r"Exchange\s*Server\s*(\d{4})?", re.I),
     lambda m, v: "microsoft-exchange"),
    (re.compile(r"SharePoint", re.I), lambda m, v: "sharepoint"),
    # ── Security-relevant infra ────────────────────────────────────────
    (re.compile(r"openssh-server|^sshd$", re.I), lambda m, v: "openssh"),
    (re.compile(r"bind9|^named$", re.I), lambda m, v: "bind9"),
    (re.compile(r"haproxy", re.I), lambda m, v: "haproxy"),
    (re.compile(r"squid", re.I), lambda m, v: "squid"),
]

# True noise we never surface at all: OS runtimes, redistributables,
# drivers, patch/update components, and the multi-row sub-packages a single
# product registers (Python's "Test Suite", Office "Click-to-Run", …).
# NOTE: this is deliberately NARROWER than before — real end-user apps
# (Chrome, Git, 7-Zip, Office, VS Code) are NO LONGER dropped; they surface
# as addable "other software" even when no CIS benchmark exists for them.
_NOISE_RE = re.compile(
    r"redistributable|redist|\bruntime\b|\bdriver(s)?\b|update for|hotfix|"
    r"\bkb\d{6,}\b|security update|visual c\+\+|\.net framework|\.net runtime|"
    r"directx|vcredist|webview2|edge ?update|silverlight|java \d+ update|"
    r"language pack|\bodbc\b|\bjdbc\b|npgsql|pgjdbc|update health|"
    r"machine-wide installer|meeting add-?in|\badd-?in\b|"
    # multi-row sub-packages that aren't standalone apps
    r"documentation|test suite|standard library|development librar|"
    r"add to path|tcl/?tk|utility scripts|pip bootstrap|core interpreter|"
    r"\bexecutables\b|licensing component|extensibility component|click-to-run",
    re.I,
)
# Back-compat alias (older imports referenced _IGNORE_RE).
_IGNORE_RE = _NOISE_RE

# Windows system / service-host processes from the listening layer — never
# real "applications", so we drop them from the unrecognized tier.
_SYS_PROC = frozenset({
    "system", "services", "svchost", "lsass", "wininit", "csrss", "smss",
    "spoolsv", "dwm", "fontdrvhost", "registry", "idle", "taskhostw",
    "sihost", "ctfmon", "explorer", "searchhost", "runtimebroker",
    "searchindexer", "wmiprvse", "dllhost", "conhost",
})


def _slug(name: str) -> str:
    """Canonical key for software with no benchmark pattern — so 'Google
    Chrome' and a 'chrome' process dedupe to the same addable entry."""
    s = re.sub(r"\s*\(.*?\)\s*", " ", name or "")   # strip "(64-bit x64)" etc.
    s = re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")
    return (s[:48].rstrip("-")) or "app"


def normalise_software(name: str, version: Optional[str] = None) -> Optional[str]:
    """Map a raw software name to a canonical software_key, or None when
    the entry is noise / not security-relevant."""
    if not name or _IGNORE_RE.search(name):
        return None
    for pat, builder in _SOFTWARE_PATTERNS:
        m = pat.search(name)
        if m:
            try:
                key = builder(m, version or "")
                return key.lower().rstrip("-.") if key else None
            except Exception:  # noqa: BLE001
                return None
    return None


def benchmark_for_software_key(db: Session, software_key: str) -> Optional[str]:
    """Return the benchmark name whose plugins carry this software_key in
    os_keys, or None. Tries the exact key first, then walks UP the version
    suffix ('postgresql-18' → 'postgresql') — the agent often detects a
    newer version than the library's latest benchmark, and the closest
    family benchmark is far more useful than nothing."""
    if not software_key:
        return None
    from grc.models import CompliancePlugin
    from sqlalchemy.dialects.postgresql import JSONB

    def _lookup(key: str) -> Optional[str]:
        row = (
            db.query(CompliancePlugin.benchmark)
            .filter(
                CompliancePlugin.enabled.is_(True),
                CompliancePlugin.os_keys.isnot(None),
                CompliancePlugin.os_keys.cast(JSONB).contains([key]),
            )
            .first()
        )
        return row[0] if row else None

    # Exact, then progressively strip trailing -<segment> pieces:
    # tomcat-9.0 → tomcat;  postgresql-18 → postgresql
    candidate = software_key
    while candidate:
        hit = _lookup(candidate)
        if hit:
            return hit
        if "-" not in candidate:
            return None
        candidate = candidate.rsplit("-", 1)[0]
    return None


def enrich_inventory(db: Session, raw_items: list) -> list:
    """Take the raw inventory and stamp each entry with software_key +
    benchmark availability.

    Surfaces ALL real software, not just benchmark-backed:
      • recognized + benchmark  → scannable (promotable, gets its own rules)
      • recognized, no benchmark → addable asset (e.g. redis)
      • unrecognized but real    → addable asset under a slug key (git, chrome,
                                    office, vscode, …)
    Only true noise (runtimes, redistributables, drivers, patch components,
    multi-row sub-packages) and bare system processes are dropped.
    """
    staged: list = []
    seen_keys: set = set()
    for item in raw_items or []:
        name = (item.get("name") or "").strip()
        if not name or _NOISE_RE.search(name):
            continue
        version = item.get("version")
        source = item.get("source")
        # Bare system / service-host processes aren't applications.
        if source == "listening_process" and name.lower() in _SYS_PROC:
            continue
        key = normalise_software(name, version)   # benchmark-pattern key or None
        recognized = key is not None
        if not recognized:
            # Unknown listening processes are too noisy to surface; everything
            # installed (registry/dpkg/rpm) is a real app the operator may want.
            if source == "listening_process":
                continue
            key = _slug(name)
        if not key or key in seen_keys:
            continue  # registry + listening often double-report
        seen_keys.add(key)
        staged.append({"name": name, "version": version, "source": source,
                       "software_key": key, "recognized": recognized})
    # Prefix dedup: when both 'postgresql-18' (registry, versioned) and
    # 'postgresql' (bare listening process) survive, keep only the
    # versioned one — they're the same product detected by two layers.
    keys = {e["software_key"] for e in staged}
    deduped = [
        e for e in staged
        if not any(k != e["software_key"] and k.startswith(e["software_key"] + "-")
                   for k in keys)
    ]
    enriched: list = []
    for e in deduped:
        bench = benchmark_for_software_key(db, e["software_key"]) if e["recognized"] else None
        enriched.append({
            "name": e["name"], "version": e["version"], "source": e["source"],
            "software_key": e["software_key"],
            "benchmark_available": bench is not None,
            "benchmark_name": bench,
            "promoted_asset_id": None,  # filled by assets_router when promoted
        })
    return enriched
