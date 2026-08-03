"""Decides whether a given CIS plugin's benchmark string is applicable
to a given asset's detected OS.

Without this, scan_all sends every Windows-family rule against every
Windows-family host — so a Windows-11 laptop gets Server-2022 rules,
Server-2019 rules, Windows-Server-2008-R2 rules, etc. The vast majority
of those silently mark "fail" because the registry path, service name,
or audit policy simply doesn't exist on the wrong product. Result:
inflated fail counts, garbage Risk Posture scores, useless evidence.

This matcher is the second filter (after runner_type) that scan_all
applies. Output is a simple bool: does this benchmark target this OS?
The lookup is regex-driven, keyed off the normalised OS string emitted
by `os_detector.normalise_*`. Unknown benchmark = conservative skip;
unknown asset OS = permissive (we don't have enough info to filter so
we let the runner-type gate decide alone).
"""
from __future__ import annotations

import re
from typing import Optional


# ─── Benchmark → OS-key patterns ───────────────────────────────────────
#
# Each row is (regex over benchmark name, normalised OS key it targets).
# Order matters only for documentation — first hit wins. Multiple keys
# allowed per benchmark when a single rule-set covers several products
# (e.g. AWS Foundations applies to any aws-* asset).

# Build-version regex pulled out of a CIS benchmark name. Returns a tuple
# (parent_family_key, build_specific_key). Example:
#   "CIS_Microsoft_Windows_10_Enterprise_Benchmark_v4.0.0"
#     → parent "windows-10", build_key "windows-10-22H2" (v4 maps to 22H2)
#   "CIS_Cisco_IOS_XE_17.9_Benchmark_v2.0.0"
#     → parent "cisco-ios-xe-17", build_key "cisco-ios-xe-17.9"

# Maps CIS benchmark major-version → Windows build (per Microsoft cycle).
# Empirically: Win11 v4=22H2, v5=23H2, v6=24H2; Win10 v1=1809, v2=20H2/21H1,
# v3=21H2 LTSC, v4=22H2 (final).
WINDOWS_BENCHMARK_BUILD_MAP: dict[tuple[str, str], str] = {
    ("windows-11", "v6"): "windows-11-24H2",
    ("windows-11", "v5"): "windows-11-23H2",
    ("windows-11", "v4"): "windows-11-22H2",
    ("windows-11", "v3"): "windows-11-22H2",
    ("windows-11", "v2"): "windows-11-21H2",
    ("windows-11", "v1"): "windows-11-21H2",
    ("windows-10", "v4"): "windows-10-22H2",
    ("windows-10", "v3"): "windows-10-21H2",
    ("windows-10", "v2"): "windows-10-21H1",
    ("windows-10", "v1"): "windows-10-1909",
}


def _extract_benchmark_major_version(benchmark: str) -> str | None:
    """Pull "v4" out of "..._Benchmark_v4.0.0". None if absent."""
    m = re.search(r"_Benchmark_(v\d+)", benchmark)
    return m.group(1).lower() if m else None


def _extract_cisco_minor(benchmark: str) -> str | None:
    """Pull "17.9" out of "CIS_Cisco_IOS_XE_17.9_Benchmark_..."."""
    m = re.search(r"Cisco_IOS_XE_(\d+\.\d+)", benchmark, re.I)
    return m.group(1) if m else None


BENCHMARK_PATTERNS: list[tuple[re.Pattern[str], tuple[str, ...]]] = [
    # ─── Windows desktop / server ──────────────────────────────────
    (re.compile(r"CIS_Microsoft_Windows_11", re.I),               ("windows-11",)),
    (re.compile(r"CIS_Microsoft_Windows_10", re.I),               ("windows-10",)),
    (re.compile(r"CIS_Microsoft_Windows_8\.1", re.I),             ("windows-8.1",)),
    (re.compile(r"CIS_Microsoft_Windows_8(?!_)", re.I),           ("windows-8",)),
    (re.compile(r"CIS_Microsoft_Windows_7", re.I),                ("windows-7",)),
    (re.compile(r"CIS_Microsoft_Windows_Server_2022", re.I),      ("windows-server-2022",)),
    (re.compile(r"CIS_Microsoft_Windows_Server_2019", re.I),      ("windows-server-2019",)),
    (re.compile(r"CIS_Microsoft_Windows_Server_2016", re.I),      ("windows-server-2016",)),
    (re.compile(r"CIS_Microsoft_Windows_Server_2012_R2", re.I),   ("windows-server-2012-r2",)),
    (re.compile(r"CIS_Microsoft_Windows_Server_2012", re.I),      ("windows-server-2012",)),
    (re.compile(r"CIS_Microsoft_Windows_Server_2008_R2", re.I),   ("windows-server-2008-r2",)),
    (re.compile(r"CIS_Microsoft_Windows_Server_2008", re.I),      ("windows-server-2008",)),
    (re.compile(r"CIS_Microsoft_Windows_Server_2003", re.I),      ("windows-server-2003",)),
    # ─── Linux distros ──────────────────────────────────────────────
    (re.compile(r"CIS_Ubuntu_Linux_24\.04", re.I),                ("ubuntu-24.04",)),
    (re.compile(r"CIS_Ubuntu_Linux_22\.04", re.I),                ("ubuntu-22.04",)),
    (re.compile(r"CIS_Ubuntu_Linux_20\.04", re.I),                ("ubuntu-20.04",)),
    (re.compile(r"CIS_Debian_Linux_12", re.I),                    ("debian-12",)),
    (re.compile(r"CIS_Debian_Linux_11", re.I),                    ("debian-11",)),
    (re.compile(r"CIS_AlmaLinux_OS_9", re.I),                     ("almalinux-9",)),
    (re.compile(r"CIS_AlmaLinux_OS_8", re.I),                     ("almalinux-8",)),
    (re.compile(r"CIS_Oracle_Linux_9", re.I),                     ("oraclelinux-9",)),
    (re.compile(r"CIS_Oracle_Linux_8", re.I),                     ("oraclelinux-8",)),
    (re.compile(r"CIS_Amazon_Linux_2023", re.I),                  ("amazonlinux-2023",)),
    (re.compile(r"CIS_Amazon_Linux_2(?!\d)", re.I),               ("amazonlinux-2",)),
    (re.compile(r"CIS_Red_Hat_Enterprise_Linux_9", re.I),         ("rhel-9",)),
    (re.compile(r"CIS_Red_Hat_Enterprise_Linux_8", re.I),         ("rhel-8",)),
    # ─── Cisco network devices ─────────────────────────────────────
    (re.compile(r"CIS_Cisco_IOS_XE_17", re.I),                    ("cisco-ios-xe-17",)),
    (re.compile(r"CIS_Cisco_IOS_XE_16", re.I),                    ("cisco-ios-xe-16",)),
    (re.compile(r"CIS_Cisco_IOS_XE", re.I),                       ("cisco-ios-xe", "cisco-ios-xe-17", "cisco-ios-xe-16")),
    (re.compile(r"CIS_Cisco_NX-?OS", re.I),                       ("cisco-nxos",)),
    (re.compile(r"CIS_Cisco_ASA", re.I),                          ("cisco-asa",)),
    (re.compile(r"CIS_Cisco_Firepower", re.I),                    ("cisco-firepower",)),
    # ─── AWS — any aws-* asset matches every AWS benchmark family ──
    (re.compile(r"CIS_Amazon_Web_Services|CIS_AWS", re.I),        ("aws-account",)),
    # ─── Oracle databases ──────────────────────────────────────────
    (re.compile(r"CIS_Oracle_Database_23ai", re.I),               ("oracle-db-23ai",)),
    (re.compile(r"CIS_Oracle_Database_19c", re.I),                ("oracle-db-19c",)),
    (re.compile(r"CIS_Oracle_Database", re.I),                    ("oracle-db",)),
    # ─── Other databases (Block G) ─────────────────────────────────
    (re.compile(r"CIS_Microsoft_SQL_Server_2022", re.I),          ("mssql-2022", "mssql")),
    (re.compile(r"CIS_Microsoft_SQL_Server_2019", re.I),          ("mssql-2019", "mssql")),
    (re.compile(r"CIS_Microsoft_SQL_Server", re.I),               ("mssql",)),
    (re.compile(r"CIS_PostgreSQL_17", re.I),                      ("postgres-17", "postgres")),
    (re.compile(r"CIS_PostgreSQL_16", re.I),                      ("postgres-16", "postgres")),
    (re.compile(r"CIS_PostgreSQL", re.I),                         ("postgres",)),
    (re.compile(r"CIS_MySQL.*?8", re.I),                          ("mysql-8", "mysql")),
    (re.compile(r"CIS_MySQL", re.I),                              ("mysql",)),
    (re.compile(r"CIS_MongoDB.*?7", re.I),                        ("mongodb-7", "mongodb")),
    (re.compile(r"CIS_MongoDB", re.I),                            ("mongodb",)),
    # ─── Containers / orchestration (Block G) ──────────────────────
    (re.compile(r"CIS_Kubernetes.*?1\.29", re.I),                 ("kubernetes-1.29", "kubernetes")),
    (re.compile(r"CIS_Kubernetes.*?1\.28", re.I),                 ("kubernetes-1.28", "kubernetes")),
    (re.compile(r"CIS_Kubernetes", re.I),                         ("kubernetes",)),
    (re.compile(r"CIS_(RedHat_)?OpenShift", re.I),                ("openshift",)),
    (re.compile(r"CIS_Docker", re.I),                             ("docker-ce",)),
    (re.compile(r"CIS_Amazon_EKS", re.I),                         ("eks",)),
    (re.compile(r"CIS_Azure_AKS", re.I),                          ("azure-aks",)),
    (re.compile(r"CIS_Google_GKE", re.I),                         ("gke",)),
    # ─── Other cloud (Block G) ─────────────────────────────────────
    (re.compile(r"CIS_Microsoft_Azure", re.I),                    ("azure-tenant",)),
    (re.compile(r"CIS_Google_Cloud_Platform", re.I),              ("gcp-project",)),
    # ─── Virtualisation (Block G) ──────────────────────────────────
    (re.compile(r"CIS_VMware_vCenter_8", re.I),                   ("vmware-vcenter-8", "vmware-vcenter")),
    (re.compile(r"CIS_VMware_vCenter_7", re.I),                   ("vmware-vcenter-7", "vmware-vcenter")),
    (re.compile(r"CIS_VMware", re.I),                             ("vmware-vcenter",)),
    # ─── Network gear non-Cisco (Block G) ──────────────────────────
    (re.compile(r"CIS_F5_BIG-?IP", re.I),                         ("f5-bigip",)),
    (re.compile(r"CIS_Palo[\s_]*Alto", re.I),                     ("paloalto-panos",)),
    (re.compile(r"CIS_Fortinet", re.I),                           ("fortinet-fortios",)),
]

# Extra OS keys the AI router is allowed to return when a benchmark has
# no regex pattern yet. These don't auto-tag anything via regex — they're
# just part of the AI's controlled vocabulary so it can classify newer /
# bespoke CIS imports (e.g. Kubernetes, containers, RDS) without us
# needing to hand-author the regex first.
EXTRA_AI_OS_KEYS: tuple[str, ...] = (
    # Build-specific Windows keys (also seeded into grc_os_versions)
    "windows-11-24H2", "windows-11-23H2", "windows-11-22H2", "windows-11-21H2",
    "windows-10-22H2", "windows-10-21H2", "windows-10-21H1", "windows-10-20H2", "windows-10-1909",
    "windows-server-2022-r2",
    "cisco-ios-xe-17.9", "cisco-ios-xe-17.6",
    "azure-tenant", "gcp-project",
    # Containers / orchestration (no regex pattern yet — AI-only vocab)
    "kubernetes", "kubernetes-1.27", "kubernetes-1.28", "kubernetes-1.29",
    "docker-ce", "openshift", "azure-aks", "gke", "eks",
)


def benchmark_target_keys(benchmark: Optional[str]) -> tuple[str, ...]:
    """Return the OS-normalised keys a benchmark targets, or ()
    if unrecognised. Now build-aware — for Windows / Cisco benchmarks
    we also append the most specific build key when extractable.

      "CIS_Microsoft_Windows_10_Enterprise_Benchmark_v4.0.0"
        → ("windows-10", "windows-10-22H2")

      "CIS_Cisco_IOS_XE_17.9_Benchmark_v2.0.0"
        → ("cisco-ios-xe-17", "cisco-ios-xe-17.9")

    Returning BOTH lets the asset matcher accept either the family-level
    asset (os_normalized="windows-10") OR the build-level asset
    (os_normalized="windows-10-22H2") — strictness opts in.
    """
    if not benchmark:
        return ()
    base_keys: tuple[str, ...] = ()
    for pat, keys in BENCHMARK_PATTERNS:
        if pat.search(benchmark):
            base_keys = keys
            break
    if not base_keys:
        return ()

    extra: list[str] = []
    # Windows: benchmark "_v4" → 22H2 etc.
    family_key = base_keys[0]
    if family_key in ("windows-10", "windows-11"):
        bv = _extract_benchmark_major_version(benchmark)
        if bv:
            mapped = WINDOWS_BENCHMARK_BUILD_MAP.get((family_key, bv))
            if mapped:
                extra.append(mapped)
    # Cisco IOS XE minor (17.9 etc.)
    if family_key == "cisco-ios-xe-17":
        minor = _extract_cisco_minor(benchmark)
        if minor:
            extra.append(f"cisco-ios-xe-{minor}")
    return tuple(list(base_keys) + extra)


def benchmark_applies_to_asset(benchmark: Optional[str], asset_os_normalized: Optional[str]) -> bool:
    """Yes/no — does this plugin's benchmark apply to this asset's OS?

    Stage 1 is PERMISSIVE on family — precision happens at Stage 2 (AI).
    Reasoning:
      • Stage 1 is a fast deterministic gate. It only needs to answer:
        "is this benchmark in the same OS FAMILY as the asset?"
      • If yes → let Stage 2 AI pick the right edition / build.
      • If no → reject cheap.

    Why we don't enforce build-strict here anymore:
      • A newer build (e.g. Windows 11 25H2) that doesn't have its OWN
        CIS benchmark must still match the LATEST family benchmark (v5
        for Win 11 today). Strict build-strict would reject it and the
        host would have ZERO applicable rules — exactly the bug Hassan
        saw on mehboob.
      • Stage 2 AI sees the full os_version string and the candidate
        benchmark names — it can distinguish "this is for 22H2" from
        "this is for 23H2" with high accuracy.

    Matching rules:
      asset_os = None              → permit (probe failed, runner-type gates)
      benchmark unknown            → permit (custom import, trust operator)
      asset key in target_keys     → permit (exact match)
      asset family in target_keys  → permit (family fallback, e.g. 25H2 → windows-11)
      otherwise                    → reject
    """
    if not asset_os_normalized:
        return True
    target_keys = benchmark_target_keys(benchmark)
    if not target_keys:
        return True

    # Exact key match wins immediately
    if asset_os_normalized in target_keys:
        return True

    # Family fallback — asset has a specific build (windows-11-23H2 etc.)
    # but rule only knows about the family. Permit it; Stage 2 AI will
    # decide if this specific benchmark is the right edition.
    if "-" in asset_os_normalized:
        # Try walking up the hierarchy by stripping the last segment
        # (windows-11-25H2 → windows-11; cisco-ios-xe-17.9 → cisco-ios-xe-17 → cisco-ios-xe)
        parts = asset_os_normalized.split("-")
        for i in range(len(parts) - 1, 0, -1):
            ancestor = "-".join(parts[:i])
            if ancestor in target_keys:
                return True
    return False
