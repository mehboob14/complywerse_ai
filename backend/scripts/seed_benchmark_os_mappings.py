"""Seed the ``grc_benchmark_os_mappings`` table so every os_normalized key the
OS normaliser / live probes can emit resolves to the BEST available CIS
benchmark.

Why this exists
---------------
``strict_matcher.pick_benchmark_for_os()`` maps an asset's ``os_normalized``
to a benchmark via operator-owned rows in ``grc_benchmark_os_mappings``
(longest os_pattern wins; lower ``priority`` breaks ties). When no row matches
it falls back to a fuzzy ``os_keys`` family-walk, which mis-resolves (e.g.
``windows-server-2019`` → an archived Windows 11 stand-alone benchmark) or
returns nothing (RHEL/Rocky/ESXi/macOS). This script lays down precise,
normaliser-aligned patterns so mapping is correct and complete.

Design decisions
----------------
* **Best available, executable preferred.** Each pattern lists candidate
  benchmark names in priority order; the first one that actually exists in the
  tenant (enabled + approved) wins. Executable benchmarks (real runner) are
  listed first; RHEL-family v9 maps to the binary-compatible AlmaLinux 9
  EXECUTABLE benchmark so those hosts are genuinely scannable. Where no
  executable benchmark exists (RHEL 8, Server 2016/2019/2022, Rocky, SUSE,
  macOS, ESXi, k8s, cloud) the newest non-archived MANUAL benchmark is used —
  so the asset still surfaces its applicable (attestation) rules instead of
  resolving to nothing.
* **Never archived.** Archived benchmarks are never a mapping target.
* **Idempotent + non-destructive.** A pattern that already has an active row
  pointing at an available benchmark is left untouched (respects operator
  edits + the pre-existing 17). Only gaps are filled. Rows are global
  (``tenant_id IS NULL``) within each tenant DB, matching the existing convention.

Usage:
    python -m scripts.seed_benchmark_os_mappings --tenant layeronon --dry-run
    python -m scripts.seed_benchmark_os_mappings --all-tenants
"""
from __future__ import annotations

import argparse
import os
import sys
from datetime import datetime
from typing import Dict, List, Tuple

from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

from grc.db import open_tenant_session  # noqa: E402
from grc.models import BenchmarkOsMapping, CompliancePlugin, Tenant, SessionLocal  # noqa: E402

# (os_pattern, [candidate benchmark names — first available wins], priority)
# Patterns are aligned to what os_detector.normalize_os_string / detect_*()
# emit. Lower priority = preferred when multiple patterns match.
MAPPINGS: List[Tuple[str, List[str], int]] = [
    # ── Windows desktop ──
    ("windows-11", ["CIS_Microsoft_Windows_11_Enterprise_Benchmark_v5.0.1"], 50),
    ("windows-10", ["CIS_Microsoft_Windows_11_Enterprise_Benchmark_v5.0.1"], 150),
    # ── Windows Server (2008/2012 executable; 2016/2019/2022 manual) ──
    ("windows-server-2008", ["CIS_Microsoft_Windows_Server_2008_non-R2_Benchmark_v3.0.0"], 50),
    ("windows-server-2012", ["CIS_Microsoft_Windows_Server_2012_non-R2_Benchmark_v2.0.0"], 50),
    ("windows-server-2016", ["CIS_Microsoft_Windows_Server_2016_Benchmark_v4.0.0"], 50),
    ("windows-server-2019", ["CIS_Microsoft_Windows_Server_2019_Benchmark_v5.0.0"], 50),
    ("windows-server-2022", ["CIS_Microsoft_Windows_Server_2022_Benchmark_v5.0.0"], 50),
    ("windows-server", ["CIS_Microsoft_Windows_Server_2022_Benchmark_v5.0.0"], 200),
    ("windows", ["CIS_Microsoft_Windows_11_Enterprise_Benchmark_v5.0.1"], 250),
    # ── Ubuntu / Debian ──
    ("ubuntu-24.04", ["CIS_Ubuntu_Linux_24.04_LTS_Benchmark_v1.0.0"], 50),
    ("ubuntu-22.04", ["CIS_Ubuntu_Linux_22.04_LTS_Benchmark_v3.0.0"], 50),
    ("ubuntu-20.04", ["CIS_Ubuntu_Linux_22.04_LTS_Benchmark_v3.0.0"], 150),
    ("ubuntu", ["CIS_Ubuntu_Linux_22.04_LTS_Benchmark_v3.0.0"], 200),
    ("debian-12", ["CIS_Debian_Linux_12_Benchmark_v1.1.0"], 50),
    ("debian-11", ["CIS_Debian_Linux_11_Benchmark_v2.0.0"], 50),
    ("debian", ["CIS_Debian_Linux_12_Benchmark_v1.1.0"], 200),
    # ── RHEL family (v9 → AlmaLinux 9 executable proxy; else native manual) ──
    ("rhel-9", ["CIS_AlmaLinux_OS_9_Benchmark_v2.0.0", "CIS_Red_Hat_Enterprise_Linux_9_Benchmark_v2.0.0"], 50),
    ("rhel-8", ["CIS_Red_Hat_Enterprise_Linux_8_Benchmark_v4.0.0"], 50),
    ("rhel-10", ["CIS_Red_Hat_Enterprise_Linux_10_Benchmark_v1.0.1"], 50),
    ("rhel", ["CIS_AlmaLinux_OS_9_Benchmark_v2.0.0"], 200),
    ("almalinux-9", ["CIS_AlmaLinux_OS_9_Benchmark_v2.0.0"], 50),
    ("almalinux-8", ["CIS_Red_Hat_Enterprise_Linux_8_Benchmark_v4.0.0"], 80),
    ("oraclelinux-9", ["CIS_Oracle_Linux_9_Benchmark_v2.0.0"], 50),
    ("oraclelinux-8", ["CIS_Red_Hat_Enterprise_Linux_8_Benchmark_v4.0.0"], 80),
    ("rockylinux-9", ["CIS_AlmaLinux_OS_9_Benchmark_v2.0.0", "CIS_Rocky_Linux_9_Benchmark_v2.0.0"], 50),
    ("rockylinux-8", ["CIS_Rocky_Linux_8_Benchmark_v3.0.0"], 50),
    ("rockylinux-10", ["CIS_Rocky_Linux_10_Benchmark_v1.0.0"], 50),
    # ── Amazon Linux / SUSE ──
    ("amazonlinux-2023", ["CIS_Amazon_Linux_2023_Benchmark_v1.0.0"], 50),
    ("amazonlinux-2", ["CIS_Amazon_Linux_2023_Benchmark_v1.0.0"], 150),
    ("sles-15", ["CIS_SUSE_Linux_Enterprise_15_Benchmark_v2.0.1"], 50),
    ("sles-12", ["CIS_SUSE_Linux_Enterprise_12_Benchmark_v3.2.1"], 50),
    ("sles", ["CIS_SUSE_Linux_Enterprise_15_Benchmark_v2.0.1"], 80),
    # ── macOS ──
    ("macos-15", ["CIS_Apple_macOS_15.0_Sequoia_Benchmark_v2.1.0"], 50),
    ("macos-14", ["CIS_Apple_macOS_14.0_Sonoma_Benchmark_v3.1.0"], 50),
    ("macos-13", ["CIS_Apple_macOS_13.0_Ventura_Benchmark_v4.0.0"], 50),
    ("macos-12", ["CIS_Apple_macOS_12.0_Monterey_Benchmark_v4.0.0"], 50),
    ("macos", ["CIS_Apple_macOS_15.0_Sequoia_Benchmark_v2.1.0"], 200),
    # ── VMware ESXi ──
    ("vmware-esxi-8.0", ["CIS_VMware_ESXi_8.0_Benchmark_v1.3.0"], 50),
    ("vmware-esxi-7.0", ["CIS_VMware_ESXi_7.0_Benchmark_v1.5.0"], 50),
    ("vmware-esxi", ["CIS_VMware_ESXi_8.0_Benchmark_v1.3.0"], 200),
    # ── Network devices ──
    ("cisco-ios-xe", ["CIS_Cisco_IOS_XE_17.x_Benchmark_v2.2.1"], 80),
    ("cisco-nxos", ["CIS_Cisco_NX-OS_Benchmark_v1.2.0"], 50),
    ("cisco-asa", ["CIS_Cisco_ASA_9.x_Firewall_Benchmark_v1.1.0"], 80),
    ("cisco-firepower", ["CIS_Cisco_Firepower_Threat_Defense_Benchmark_v1.0.0"], 50),
    ("cisco-ios", ["CIS_Cisco_IOS_XE_17.x_Benchmark_v2.2.1"], 150),
    ("juniper-junos", ["CIS_Juniper_OS_Benchmark_v2.1.0"], 80),
    ("fortinet-fortios", ["CIS_FortiGate_7.4.x_Benchmark_v1.0.1"], 80),
    ("paloalto-panos", ["CIS_Palo_Alto_Firewall_11_Benchmark_v1.2.0"], 80),
    ("aruba-aos", ["CIS_HPE_Aruba_Networking_CX_Switch_Benchmark_v1.0.1"], 80),
    ("checkpoint-gaia", ["CIS_Check_Point_Firewall_Benchmark_v1.1.0"], 80),
    # ── Cloud / orchestration ──
    ("aws-account", ["CIS_Amazon_Web_Services_Foundations_Benchmark_v7.0.0"], 50),
    ("azure-subscription", ["CIS_Microsoft_Azure_Foundations_Benchmark_v6.0.0"], 50),
    ("kubernetes", ["CIS_Kubernetes_Benchmark_v2.0.1"], 80),
    # ── Oracle DB (executable) ──
    ("oracle-db-19c", ["CIS_Oracle_Database_19c_Benchmark_v2.0.0"], 50),
    ("oracle-db-23ai", ["CIS_Oracle_Database_23ai_Benchmark_v1.1.0"], 50),
]


def seed_tenant(slug: str, dry_run: bool) -> Dict[str, int]:
    db = open_tenant_session(slug)
    stats = {"inserted": 0, "skipped_present": 0, "no_benchmark": 0}
    try:
        available = {
            b for (b,) in db.query(CompliancePlugin.benchmark)
            .filter(CompliancePlugin.enabled.is_(True))
            .filter(CompliancePlugin.review_status.in_(("approved", "auto_approved")))
            .distinct().all()
        }
        # Patterns that already have an active row pointing at an available
        # benchmark — leave those alone (operator/pre-existing choices win).
        existing_ok = {
            m.os_pattern for m in db.query(BenchmarkOsMapping)
            .filter(BenchmarkOsMapping.is_active.is_(True)).all()
            if m.benchmark_name in available
        }
        now = datetime.utcnow()
        for pattern, candidates, priority in MAPPINGS:
            if pattern in existing_ok:
                stats["skipped_present"] += 1
                continue
            chosen = next((c for c in candidates if c in available), None)
            if not chosen:
                stats["no_benchmark"] += 1
                if dry_run:
                    print(f"    ! {slug}: '{pattern}' — no candidate benchmark present ({candidates[0]}...)")
                continue
            if not dry_run:
                db.add(BenchmarkOsMapping(
                    tenant_id=None, os_pattern=pattern, benchmark_name=chosen,
                    priority=priority, is_active=True,
                    notes="seeded by seed_benchmark_os_mappings",
                    created_at=now, updated_at=now,
                ))
            stats["inserted"] += 1
            if dry_run:
                print(f"    + {slug}: {pattern:<22} -> {chosen}")
        if not dry_run:
            db.commit()
        print(f"  {slug}: inserted {stats['inserted']}, kept {stats['skipped_present']}, "
              f"no-benchmark {stats['no_benchmark']}")
        return stats
    finally:
        db.close()


def main() -> int:
    ap = argparse.ArgumentParser(description="Seed grc_benchmark_os_mappings")
    ap.add_argument("--tenant")
    ap.add_argument("--all-tenants", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    if not args.tenant and not args.all_tenants:
        ap.error("specify --tenant SLUG or --all-tenants")

    if args.all_tenants:
        m = SessionLocal()
        try:
            slugs = [t.slug for t in m.query(Tenant).all()
                     if getattr(t, "slug", None) and getattr(t, "is_active", True)]
        finally:
            m.close()
    else:
        slugs = [args.tenant]

    print(f"Benchmark-OS mapping seed — dry_run={args.dry_run} tenants={slugs}")
    total = 0
    for s in slugs:
        try:
            total += seed_tenant(s, args.dry_run)["inserted"]
        except Exception as exc:  # noqa: BLE001
            print(f"  ! {s}: FAILED — {exc}")
    print(f"Done. mappings {'(planned)' if args.dry_run else 'inserted'}: {total}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
