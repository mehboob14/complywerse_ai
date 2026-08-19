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
from sqlalchemy import func
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


def _benchmark_version_tuple(name: str) -> tuple:
    """Parse a trailing vX.Y.Z out of a benchmark name for comparison.
    Unparseable names sort lowest so a properly-versioned benchmark wins."""
    import re as _re
    m = _re.search(r"[_-]v(\d+)(?:\.(\d+))?(?:\.(\d+))?", name or "")
    if not m:
        return (0, 0, 0)
    return tuple(int(g) if g else 0 for g in m.groups())


def _is_unusable_benchmark(name: str) -> bool:
    """ARCHIVE / parser-junk names must never be offered as 'set up' targets."""
    upper = (name or "").upper()
    if "ARCHIVE" in upper:
        return True
    return any(t in upper for t in ("VVUNKNOWN", "QUARANTINE", "COMMERCIAL_USE"))


def _rank_benchmarks(candidates: list) -> list:
    """Rank (benchmark_name, rule_count) best-first.

    Preference order, strongest first:
      1. Highest version.
      2. Most rules (a fuller benchmark is the better match at equal version).
      3. Name, purely so the result is deterministic across runs.

    ARCHIVE / junk candidates are dropped entirely — sorting them last still
    let them win when they were the only hit (WSL → Windows XP ARCHIVE).
    """
    usable = [(n, c) for n, c in candidates if n and not _is_unusable_benchmark(n)]
    def _key(item):
        name, count = item
        return (tuple(-v for v in _benchmark_version_tuple(name)), -count, name)
    return [name for name, _ in sorted(usable, key=_key)]


# Catalog / OS family roots — never a valid software→benchmark walk target.
# Letting the suffix walk reach these is what mapped
# windows-subsystem-for-linux → windows → Windows XP, and similar false hits.
_BARE_FAMILY_TOKENS = frozenset({
    "windows", "linux", "macos", "cisco", "cloud", "container", "db",
    "network", "app", "unix", "hypervisor", "endpoint", "other",
})

# Trailing segment that is a version (18, 9.0, 2012, 19c, 23ai) — the only
# kind of suffix we strip when walking postgresql-18 → postgresql.
# Matches plain versions (18, 9.0, 2022, 18a) AND Windows feature-release IDs
# (22H2, 23H2, 24H2, 25H2 — digits+H+digit). Without the latter,
# windows-11-25H2 never walked up to windows-11 and every modern Windows
# 10/11 asset showed 0 CIS rules whenever the operator mapping was absent.
_VERSION_SEGMENT = re.compile(r"^\d+(?:\.\d+)*[a-z]*$|^\d{2}h\d$", re.I)


def _version_parent(software_key: str) -> Optional[str]:
    """Strip one trailing version segment, or None if the tail isn't a version.

    postgresql-18 → postgresql, tomcat-9.0 → tomcat, mssql-2022 → mssql.
    windows-subsystem-for-linux → None (linux is not a version).
    github-cli → None (cli is not a version).
    """
    if not software_key or "-" not in software_key:
        return None
    stem, tail = software_key.rsplit("-", 1)
    if not stem or not _VERSION_SEGMENT.match(tail):
        return None
    return stem


def _is_runnable_check(check_definition) -> bool:
    """Same exclusions the detected-software API uses for rule_count."""
    if not isinstance(check_definition, dict):
        return False
    text = str(check_definition)
    if "TODO" in text:
        return False
    expect = check_definition.get("expect") or {}
    if isinstance(expect, dict) and expect.get("kind") == "any":
        return False
    return True


def benchmark_for_software_key(db: Session, software_key: str) -> Optional[str]:
    """Return the benchmark name whose plugins carry this software_key in
    os_keys, or None.

    Lookup rules (tightened after WSL/GitHub-CLI false positives):
      1. Try the exact key, then walk UP only through *version* suffixes
         (postgresql-18 → postgresql). Never strip product tokens
         (windows-subsystem-for-linux must not become windows).
      2. Never match bare OS-family tokens (windows/linux/…).
      3. Ignore ARCHIVE / parser-junk benchmark names.
      4. Require at least one runnable (non-manual, non-hollow) rule —
         hollow matches must not light up "set up".
    """
    if not software_key:
        return None
    from grc.models import CompliancePlugin
    from sqlalchemy.dialects.postgresql import JSONB

    def _lookup(key: str) -> Optional[str]:
        if not key or key in _BARE_FAMILY_TOKENS:
            return None
        rows = (
            db.query(
                CompliancePlugin.benchmark,
                CompliancePlugin.runner_type,
                CompliancePlugin.check_definition,
            )
            .filter(
                CompliancePlugin.enabled.is_(True),
                # NOTE: rows storing JSON 'null' (not SQL NULL) pass this
                # isnot() check — harmless ONLY because the contains() below
                # can never match JSON null. The column is none_as_null now
                # and legacy 'null' rows were normalised, but keep the
                # contains() adjacent to this filter if you ever edit it.
                CompliancePlugin.os_keys.isnot(None),
                CompliancePlugin.os_keys.cast(JSONB).contains([key]),
            )
            .all()
        )
        # Count runnable rules per benchmark (manual/hollow excluded).
        counts: dict[str, int] = {}
        for bench, runner, cdef in rows:
            if not bench or _is_unusable_benchmark(bench):
                continue
            if (runner or "").lower() == "manual":
                continue
            if not _is_runnable_check(cdef if isinstance(cdef, dict) else {}):
                continue
            counts[bench] = counts.get(bench, 0) + 1
        usable = [(b, n) for b, n in counts.items() if n > 0]
        if not usable:
            return None
        ranked = _rank_benchmarks(usable)
        return ranked[0] if ranked else None

    candidate: Optional[str] = software_key
    seen: set[str] = set()
    while candidate and candidate not in seen:
        seen.add(candidate)
        hit = _lookup(candidate)
        if hit:
            return hit
        candidate = _version_parent(candidate)
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
                       "publisher": (item.get("publisher") or "").strip() or None,
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
            "publisher": e.get("publisher"),
            "software_key": e["software_key"],
            "benchmark_available": bench is not None,
            "benchmark_name": bench,
            "promoted_asset_id": None,  # filled by assets_router when promoted
        })
    return enriched


def preserve_promotions(previous: Optional[list], enriched: list) -> list:
    """Carry `promoted_asset_id` links across a re-inventory.

    Every collection path rewrites `asset.detected_software_json` wholesale, so
    without this a re-probe forgets which detected apps were already promoted to
    child assets and the operator is asked to promote them all over again.

    Shared by the two collectors that produce an inventory — the agent heartbeat
    (modules/agents/router.py) and the agentless probe
    (services/agentless_inventory.py) — so the rule cannot drift between them.
    Matched on `software_key`, which is stable across probes; `enriched` is
    mutated in place and returned for convenience.
    """
    prev = {
        e.get("software_key"): e.get("promoted_asset_id")
        for e in (previous or [])
        if isinstance(e, dict) and e.get("promoted_asset_id")
    }
    if not prev:
        return enriched
    for e in enriched:
        linked = prev.get(e.get("software_key"))
        if linked:
            e["promoted_asset_id"] = linked
    return enriched
