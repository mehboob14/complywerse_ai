#!python
# -*- coding: utf-8 -*-
"""Seed browser support in tenant_liztek-1:
  1. grc_os_versions entries for Firefox / Edge / Chrome (browser family
     OSes the OS-Profile picker shows in the manual Add-Asset form).
  2. Mock CIS plugin packs (Mock_CIS_Mozilla_Firefox / Mock_CIS_Microsoft_Edge
     / Mock_CIS_Google_Chrome) — same mock_pass runner pattern as the
     mssql / postgres mocks so they execute without a real browser probe.

Re-runnable: matches by normalized_key (OS) and by benchmark prefix
(plugins). Won't duplicate if you run it twice.

Run:
    python _seed_browsers.py        # seed
    python _seed_browsers.py cleanup  # remove (deletes everything we added)
"""
from __future__ import annotations
import os, sys
from dotenv import load_dotenv
HERE = os.path.dirname(os.path.abspath(__file__))
load_dotenv(os.path.join(HERE, ".env"))
sys.path.insert(0, HERE)

from sqlalchemy import text
from grc.db import open_tenant_session
from grc.models import Tenant, CompliancePlugin, CompliancePluginRun

SLUG = "liztek-1"

# (normalized_key, family, product, build, display_name, eol_year)
BROWSER_OS_VERSIONS = [
    # Firefox — keep two: a versioned current + an unversioned family fallback
    ("firefox-128",  "firefox",        "firefox",  "128",   "Mozilla Firefox 128 ESR", 2026),
    ("firefox",      "firefox",        "firefox",  None,    "Mozilla Firefox (any)", None),
    # Edge — stable channel + family
    ("edge-stable",  "edge",           "edge",     "stable","Microsoft Edge (Stable)", 2027),
    ("edge",         "edge",           "edge",     None,    "Microsoft Edge (any)", None),
    # Chrome — stable channel + family
    ("chrome-stable","chrome",         "chrome",   "stable","Google Chrome (Stable)", 2027),
    ("chrome",       "chrome",         "chrome",   None,    "Google Chrome (any)", None),
]

# (benchmark_name, os_key, plugin_count)
BROWSER_BENCHMARKS = [
    ("Mock_CIS_Mozilla_Firefox_v128_v1.0", "firefox-128",  90),
    ("Mock_CIS_Microsoft_Edge_v1.0",       "edge-stable",  60),
    ("Mock_CIS_Google_Chrome_v1.0",        "chrome-stable",80),
]


def cleanup(session) -> int:
    """Remove the browser OS registry entries + mock CIS browser plugins."""
    total = 0
    # Plugin runs first (FK)
    bench_names = [b[0] for b in BROWSER_BENCHMARKS]
    plugin_ids = [
        p.id for p in session.query(CompliancePlugin).filter(
            CompliancePlugin.benchmark.in_(bench_names)
        ).all()
    ]
    if plugin_ids:
        run_count = session.query(CompliancePluginRun).filter(
            CompliancePluginRun.plugin_id.in_(plugin_ids)
        ).delete(synchronize_session=False)
        total += run_count
        print(f"  deleted {run_count} runs against browser mock plugins")
    plug_count = session.query(CompliancePlugin).filter(
        CompliancePlugin.benchmark.in_(bench_names)
    ).delete(synchronize_session=False)
    total += plug_count
    print(f"  deleted {plug_count} mock browser CIS plugins")

    os_keys = [v[0] for v in BROWSER_OS_VERSIONS]
    res = session.execute(
        text("DELETE FROM grc_os_versions WHERE normalized_key = ANY(:keys)"),
        {"keys": os_keys},
    )
    total += res.rowcount
    print(f"  deleted {res.rowcount} OS-registry entries for browsers")

    session.commit()
    return total


def seed(session) -> dict:
    tenant = session.query(Tenant).filter(Tenant.slug == SLUG).first()
    tid = tenant.id
    print(f"tenant_id={tid} (slug={SLUG})")

    # ── OS registry ────────────────────────────────────────────────────
    inserted_os = 0
    for normalized_key, family, product, build, display_name, eol_year in BROWSER_OS_VERSIONS:
        existing = session.execute(
            text("SELECT id FROM grc_os_versions WHERE normalized_key = :k"),
            {"k": normalized_key},
        ).first()
        if existing:
            print(f"  os_versions[{normalized_key}] already present, skipping")
            continue
        session.execute(text("""
            INSERT INTO grc_os_versions
                (family, product, build, normalized_key, display_name,
                 is_supported, eol_year, parent_key, benchmark_hint)
            VALUES
                (:family, :product, :build, :normalized_key, :display_name,
                 TRUE, :eol_year, :parent_key, :benchmark_hint)
        """), {
            "family": family,
            "product": product,
            "build": build,
            "normalized_key": normalized_key,
            "display_name": display_name,
            "eol_year": eol_year,
            "parent_key": family if build else None,
            "benchmark_hint": next(
                (b[0] for b in BROWSER_BENCHMARKS if b[1] == normalized_key),
                None,
            ),
        })
        inserted_os += 1
        print(f"  + os_versions[{normalized_key}] ({display_name})")

    # ── Mock CIS browser plugins ──────────────────────────────────────
    inserted_plugins = 0
    for bench_name, os_key, plugin_count in BROWSER_BENCHMARKS:
        existing_n = session.query(CompliancePlugin).filter(
            CompliancePlugin.benchmark == bench_name
        ).count()
        if existing_n >= plugin_count:
            print(f"  benchmark {bench_name!r}: {existing_n} plugins already present, skipping")
            continue
        # Wipe partial
        if existing_n > 0:
            session.query(CompliancePlugin).filter(
                CompliancePlugin.benchmark == bench_name
            ).delete(synchronize_session=False)
            session.flush()
        for n in range(1, plugin_count + 1):
            session.add(CompliancePlugin(
                tenant_id=tid,
                plugin_key=f"{bench_name}::rule-{n:03d}",
                benchmark=bench_name,
                rule_id=f"{(n // 10) + 1}.{n}",
                title=f"{bench_name} rule {n}",
                description=f"Synthetic CIS browser-hardening check #{n}.",
                severity="medium",
                runner_type="mock_pass",
                check_definition={"mock": True, "browser": os_key},
                enabled=True,
                is_builtin=False,
                review_status="approved",
                os_keys=[os_key],
                classification_source="seed",
            ))
            inserted_plugins += 1
        print(f"  + {plugin_count} plugins under benchmark {bench_name!r} (os_key={os_key})")

    session.commit()
    return {
        "os_versions_inserted": inserted_os,
        "plugins_inserted": inserted_plugins,
    }


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else "seed"
    print(f"[seed_browsers] mode={mode}")
    session = open_tenant_session(SLUG)
    try:
        if mode == "cleanup":
            cleanup(session)
        elif mode == "seed":
            result = seed(session)
            print()
            print(f"=== Seed complete ===")
            print(f"  OS-registry entries added: {result['os_versions_inserted']}")
            print(f"  Mock CIS plugins added:    {result['plugins_inserted']}")
            print()
            print("Try it: Add Asset → set Vendor='Mozilla' (or Google / Microsoft Edge),")
            print("set OS Profile to 'Mozilla Firefox 128 ESR' (or similar) — Compliance tab")
            print("will resolve to Mock_CIS_Mozilla_Firefox_v128_v1.0 with 90 mock rules.")
        else:
            print(f"unknown mode {mode!r} — use 'seed' or 'cleanup'")
            sys.exit(2)
    finally:
        session.close()


if __name__ == "__main__":
    main()
