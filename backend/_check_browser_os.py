#!python
# -*- coding: utf-8 -*-
"""Check what browser-related entries exist in the OS Knowledge Registry
and whether the plugin library has any CIS browser benchmark plugins."""
import os, sys
from dotenv import load_dotenv
HERE = os.path.dirname(os.path.abspath(__file__))
load_dotenv(os.path.join(HERE, ".env"))
sys.path.insert(0, HERE)
from sqlalchemy import text
from grc.db import open_tenant_session, master_engine

SLUG = "liztek-1"


def main():
    db = open_tenant_session(SLUG)
    try:
        # OS registry entries
        print("=== grc_os_versions entries matching browser keywords ===")
        rows = db.execute(text("""
            SELECT id, family, product, build, normalized_key, display_name, is_supported
            FROM grc_os_versions
            WHERE LOWER(family) LIKE '%browser%'
               OR LOWER(family) LIKE '%firefox%'
               OR LOWER(family) LIKE '%edge%'
               OR LOWER(family) LIKE '%chrome%'
               OR LOWER(product) LIKE '%firefox%'
               OR LOWER(product) LIKE '%edge%'
               OR LOWER(product) LIKE '%chrome%'
               OR LOWER(normalized_key) LIKE '%firefox%'
               OR LOWER(normalized_key) LIKE '%edge%'
               OR LOWER(normalized_key) LIKE '%chrome%'
            ORDER BY family, normalized_key
        """)).all()
        if not rows:
            print("  None. Browsers are NOT in the OS Knowledge Registry yet.")
        else:
            for r in rows:
                print(f"  id={r[0]} family={r[1]} product={r[2]} build={r[3]} "
                      f"normalized_key={r[4]} display={r[5]} supported={r[6]}")

        # Compliance plugins with browser os_keys
        print()
        print("=== grc_compliance_plugins with browser-ish os_keys ===")
        from sqlalchemy.dialects.postgresql import JSONB
        rows = db.execute(text("""
            SELECT DISTINCT benchmark, COUNT(*) AS n_rules
            FROM grc_compliance_plugins
            WHERE enabled = TRUE
              AND review_status IN ('approved', 'auto_approved')
              AND (
                LOWER(benchmark) LIKE '%firefox%'
                OR LOWER(benchmark) LIKE '%edge%'
                OR LOWER(benchmark) LIKE '%chrome%'
                OR LOWER(benchmark) LIKE '%browser%'
              )
            GROUP BY benchmark
            ORDER BY n_rules DESC
        """)).all()
        if not rows:
            print("  None. No browser CIS plugins in the library.")
        else:
            for r in rows:
                print(f"  {r[0]:<60}  {r[1]} rules")

        # Also try the os_keys JSON array path
        print()
        print("=== Plugins whose os_keys array mentions a browser ===")
        rows = db.execute(text("""
            SELECT DISTINCT benchmark, COUNT(*) AS n_rules
            FROM grc_compliance_plugins p
            WHERE enabled = TRUE
              AND review_status IN ('approved', 'auto_approved')
              AND (
                CAST(os_keys AS JSONB) ?? 'firefox'
                OR CAST(os_keys AS JSONB) ?? 'edge'
                OR CAST(os_keys AS JSONB) ?? 'chrome'
              )
            GROUP BY benchmark
            ORDER BY n_rules DESC
            LIMIT 20
        """)).all()
        if not rows:
            print("  None. No plugins with os_keys=firefox/edge/chrome.")
        else:
            for r in rows:
                print(f"  {r[0]:<60}  {r[1]} rules")

    finally:
        db.close()


if __name__ == "__main__":
    main()
