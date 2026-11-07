"""Deploy-time reconciliation: enforce the Phase 2 CIS benchmark-mapping fixes
on ANY tenant DB, regardless of how it was populated (code-seeded, cloned from
the canonical source, or restored from a snapshot).

Why this exists alongside the seed fixes
----------------------------------------
The corrected targets now live in ``scripts/seed_benchmark_os_mappings.py``
(mappings) and ``seed.py`` (the retired-benchmark skip). But:
  * ``grc_benchmark_os_mappings`` is neither cloned by
    ``sync_global_plugins_from_source`` nor seeded by tenant provisioning, and
    121/155 of the canonical rows have untracked provenance (``wired from
    os_keys``/``catalog post-reorganize``).
  * A snapshot-restored DB carries whatever state the snapshot had.
So this script is the belt-and-suspenders enforcement: idempotent, safe to run
on every deploy. It only ever narrows/repoints toward the correct state and is
a no-op once a DB already matches.

Fixes enforced (Phase 2):
  F1  deactivate the bare ``linux`` -> CIS_UBUNTU_22_04_v2.0 landmine mapping.
  F3  repoint rhel-9 / almalinux-8 / oraclelinux-8 to their OWN benchmark
      (only when the dedicated benchmark is present + runnable in this DB).
  F4  repoint amazonlinux-2 to its own AL2 benchmark (same guard).
  F2  disable the redundant duplicate benchmark CIS_UBUNTU_22_04_v2.0 (only
      when every runnable oscap rule_id also exists in the canonical v3.0.0
      benchmark -> zero coverage loss).

Only global rows (``tenant_id IS NULL``) are touched — operator-authored
tenant-scoped overrides are left alone. Repoints fire only from the KNOWN OLD
target, so an operator's deliberate re-mapping is never clobbered.

Usage:
    python -m scripts.reconcile_benchmark_mappings --tenant complyverse --dry-run
    python -m scripts.reconcile_benchmark_mappings --tenant complyverse --apply
    python -m scripts.reconcile_benchmark_mappings --all-tenants --apply
"""
from __future__ import annotations

import argparse
import os
import sys

from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

from grc.db import open_tenant_session  # noqa: E402
from grc.models import BenchmarkOsMapping, CompliancePlugin, Tenant, SessionLocal  # noqa: E402
from sqlalchemy import cast, String, func  # noqa: E402

# (os_pattern, old_benchmark, new_benchmark) — repoint only from the old target.
REMAPS = [
    ("rhel-9",        "CIS_AlmaLinux_OS_9_Benchmark_v2.0.0",             "CIS_Red_Hat_Enterprise_Linux_9_Benchmark_v2.0.0"),
    # Bare `rhel` catch-all (version-unknown RHEL host) was left on AlmaLinux-9 —
    # a different distro's benchmark, even though real RHEL 9 (293 rules) is
    # loaded. Mirror the rhel-9 repoint so a RHEL host never shows an AlmaLinux
    # benchmark. (rockylinux-9 stays on Alma 9 — true RHEL-9 clone, no separate
    # Rocky benchmark loaded.)
    ("rhel",          "CIS_AlmaLinux_OS_9_Benchmark_v2.0.0",             "CIS_Red_Hat_Enterprise_Linux_9_Benchmark_v2.0.0"),
    ("almalinux-8",   "CIS_Red_Hat_Enterprise_Linux_8_Benchmark_v4.0.0", "CIS_ALMALINUX_OS_8_v4.0.0"),
    ("oraclelinux-8", "CIS_Red_Hat_Enterprise_Linux_8_Benchmark_v4.0.0", "CIS_Oracle_Linux_8_Benchmark_v4.0.0"),
    ("amazonlinux-2", "CIS_Amazon_Linux_2023_Benchmark_v1.0.0",          "CIS_AMAZON_LINUX_2_v4.0.0"),
    # aws-account pointed at the all-placeholder AWS Foundations v7 (0 usable
    # rules); repoint to v3.0, the real benchmark (18 automated checks).
    ("aws-account",   "CIS_Amazon_Web_Services_Foundations_Benchmark_v7.0.0", "CIS_AWS_FOUNDATIONS_v3.0"),
    # Archive-mapping review: bare/generic patterns wrongly pinned to an EOL
    # archive -> repoint to the current version. (Version-pinned EOL patterns
    # like mongodb-3/mssql-2016/postgresql-12 are left alone — the archive is
    # the correct version-specific coverage there.)
    ("mongodb",       "CIS_MongoDB_Benchmark_v1.0.0_ARCHIVE",                        "CIS_MongoDB8_Benchmark_v1.0.0"),
    ("mysql",         "CIS_Oracle_MySQL_Community_Server_5.7_Benchmark_v2.0.0_ARCHIVE", "CIS_Oracle_MySQL_Community_Server_8.4_Benchmark_v1.1.0"),
    ("oracle-db",     "CIS_Oracle_Database_Server_11_-_11g_R2_Benchmark_v1.0.0_ARCHIVE", "CIS_Oracle_Database_19c_Benchmark_v2.0.0"),
    # Optional (same OS, newer point release — safe):
    ("solaris-11",    "CIS_Oracle_Solaris_11_Benchmark_v1.1.0_Archive",   "CIS_Oracle_Solaris_11.4_Benchmark_v1.1.0"),
    ("solaris-11.1",  "CIS_Oracle_Solaris_11.1_Benchmark_v1.0.0_Archive", "CIS_Oracle_Solaris_11.4_Benchmark_v1.1.0"),
    ("oracle-db-18",  "CIS_Oracle_Database_18c_Benchmark_v1.1.0_ARCHIVE", "CIS_Oracle_Database_19c_Benchmark_v2.0.0"),
    # Win10 assets were pinned to the Windows 11 benchmark (Hassan's Win10->Win11
    # report). Win10 Enterprise v4.0.0 now exists in the catalog (450 runnable
    # rules) — repoint so Win10 hosts stop being scanned with Win11 rules.
    ("windows-10",    "CIS_Microsoft_Windows_11_Enterprise_Benchmark_v5.0.1", "CIS_Microsoft_Windows_10_Enterprise_Benchmark_v4.0.0"),
]
# (pattern, benchmark) mappings to deactivate — dead/ancient or too-generic.
# NOTE: only deactivate patterns with NO generic catch-all above them. windows-xp
# / windows-server-2003 are intentionally NOT here: a bare `windows`(→Win11) and
# `windows-server`(→2022) pattern exist, so deactivating the specific EOL mapping
# routes those assets to the WRONG modern benchmark instead of out of scope —
# worse than leaving them on their own version-correct archive.
DEACTIVATE = [
    ("linux",                "CIS_UBUNTU_22_04_v2.0"),                                       # F1 landmine (no generic `linux` catch-all remains)
    ("db",                   "CIS_Oracle_Database_Server_11_-_11g_R2_Benchmark_v1.0.0_ARCHIVE"),  # over-generic catch-all; falls through to None
]
DEDUP_BENCH = "CIS_UBUNTU_22_04_v2.0"                   # F2
CANON_BENCH = "CIS_Ubuntu_Linux_22.04_LTS_Benchmark_v3.0.0"


def _runnable_count(db, benchmark: str) -> int:
    """Enabled, non-manual, well-formed (no TODO/kind:any/dangling-pipe) rules."""
    cdef = cast(CompliancePlugin.check_definition, String)
    cmd = func.coalesce(func.json_extract_path_text(CompliancePlugin.check_definition, "command"), "")
    return (
        db.query(CompliancePlugin)
        .filter(
            CompliancePlugin.benchmark == benchmark,
            CompliancePlugin.enabled.is_(True),
            CompliancePlugin.runner_type != "manual",
            ~cdef.ilike("%TODO%"),
            ~cdef.ilike('%%"kind": "any"%%'),
            ~cdef.ilike('%%"kind":"any"%%'),
            cmd.op("!~")(r"\|\s*$"),
        )
        .count()
    )


def _dup_orphan_rule_ids(db) -> int:
    """Count runnable-oscap rule_ids in the dup benchmark that are NOT in the
    canonical benchmark. Must be 0 before F2 disables the dup."""
    def ids(bench):
        rows = db.query(CompliancePlugin.check_definition).filter(
            CompliancePlugin.benchmark == bench
        ).all()
        out = set()
        for (cd,) in rows:
            if isinstance(cd, dict):
                rid = (cd.get("oscap") or {}).get("rule_id") if isinstance(cd.get("oscap"), dict) else None
                if rid:
                    out.add(rid)
        return out
    return len(ids(DEDUP_BENCH) - ids(CANON_BENCH))


def reconcile(slug: str, apply: bool) -> int:
    db = open_tenant_session(slug)
    changed = 0
    try:
        G = BenchmarkOsMapping.tenant_id.is_(None)

        # Deactivate dead/ancient/too-generic mappings (landmine + archive review).
        for pat, bench in DEACTIVATE:
            rows = db.query(BenchmarkOsMapping).filter(
                G, BenchmarkOsMapping.os_pattern == pat,
                BenchmarkOsMapping.benchmark_name == bench,
                BenchmarkOsMapping.is_active.is_(True),
            ).all()
            for r in rows:
                print(f"  [{slug}] deactivate {pat!r} -> {bench}")
                if apply:
                    r.is_active = False
                changed += 1

        # F3/F4 — repoint from the known old target, only if new target is real.
        for pat, old, new in REMAPS:
            rows = db.query(BenchmarkOsMapping).filter(
                G, BenchmarkOsMapping.os_pattern == pat,
                BenchmarkOsMapping.benchmark_name == old,
            ).all()
            if not rows:
                continue
            if _runnable_count(db, new) == 0:
                print(f"  [{slug}] F3/F4 SKIP {pat!r}: target {new} absent/empty here — left at {old}")
                continue
            for r in rows:
                print(f"  [{slug}] F3/F4 repoint {pat!r} {old} -> {new}")
                if apply:
                    r.benchmark_name = new
                changed += 1

        # F2 — disable the redundant duplicate benchmark (zero-orphan guarded).
        dup_enabled = db.query(CompliancePlugin).filter(
            CompliancePlugin.benchmark == DEDUP_BENCH, CompliancePlugin.enabled.is_(True)
        ).count()
        if dup_enabled:
            orphans = _dup_orphan_rule_ids(db)
            if orphans:
                print(f"  [{slug}] F2 SKIP: {orphans} rule_ids only in {DEDUP_BENCH} — not safe to disable")
            else:
                print(f"  [{slug}] F2 disable {dup_enabled} enabled rows of {DEDUP_BENCH} (0 orphans)")
                if apply:
                    db.query(CompliancePlugin).filter(
                        CompliancePlugin.benchmark == DEDUP_BENCH, CompliancePlugin.enabled.is_(True)
                    ).update({"enabled": False})
                changed += 1  # count as one logical change

        if apply:
            db.commit()
        print(f"  [{slug}] {'applied' if apply else 'pending'}: {changed} change group(s)"
              + ("" if changed else " — already reconciled"))
        return changed
    finally:
        db.close()


def main() -> int:
    ap = argparse.ArgumentParser(description="Reconcile Phase 2 CIS mapping fixes")
    ap.add_argument("--tenant")
    ap.add_argument("--all-tenants", action="store_true")
    ap.add_argument("--apply", action="store_true", help="commit (default: dry-run)")
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

    print(f"Reconcile benchmark mappings — {'APPLY' if args.apply else 'DRY-RUN'} tenants={slugs}")
    total = 0
    for s in slugs:
        try:
            total += reconcile(s, args.apply)
        except Exception as exc:  # noqa: BLE001
            print(f"  ! {s}: FAILED — {exc}")
    print(f"Done. change groups {'applied' if args.apply else 'pending'}: {total}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
