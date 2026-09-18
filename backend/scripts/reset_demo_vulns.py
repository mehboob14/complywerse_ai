"""Reset the demo: DROP every vulnerability (and all FK-dependent rows) plus CTEM
scopes/cycles in ONE tenant, then re-seed the clean manual CVE demo set.

    python scripts/reset_demo_vulns.py <tenant_slug>      # e.g. complyverse

Destructive — wipes the tenant's whole vuln register + CTEM (re-run a CTEM cycle
after). The drop runs in one transaction (all-or-nothing); the re-seed follows via
seed_known_cves. Defaults to 'complyverse' if no slug is given.
"""
import os, sys
_B = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, _B)
try:
    from dotenv import load_dotenv; load_dotenv(os.path.join(_B, ".env"))
except Exception:
    pass
from sqlalchemy import create_engine, text
import seed_known_cves

TMPL = os.environ["TENANT_DB_URL_TEMPLATE"]
slug = sys.argv[1] if len(sys.argv) > 1 else "complyverse"


def fk_children(c, parent):
    return c.execute(text("""
        SELECT DISTINCT tc.table_name, kcu.column_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
        JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name
        WHERE tc.constraint_type = 'FOREIGN KEY' AND ccu.table_name = :p
    """), {"p": parent}).fetchall()


def main():
    engine = create_engine(TMPL.format(slug=slug))
    with engine.begin() as c:
        nv = c.execute(text("SELECT count(*) FROM grc_vulnerabilities")).scalar()
        print(f"tenant={slug}: dropping {nv} vulnerabilities + CTEM ...")
        # reachability steps first (grandchild: steps -> snapshots -> vulns)
        c.execute(text("DELETE FROM grc_reachability_steps WHERE snapshot_id IN "
                       "(SELECT id FROM grc_reachability_snapshots)"))
        # every direct FK-child of grc_vulnerabilities, row-scoped to the vulns we drop
        for tbl, col in fk_children(c, "grc_vulnerabilities"):
            c.execute(text(f"DELETE FROM {tbl} WHERE {col} IN (SELECT id FROM grc_vulnerabilities)"))
        c.execute(text("DELETE FROM grc_vulnerabilities"))
        # CTEM — dropped on purpose (user re-runs a cycle). cycles before scopes.
        for parent in ("grc_ctem_cycles", "grc_ctem_scopes"):
            for tbl, _col in fk_children(c, parent):
                c.execute(text(f"DELETE FROM {tbl}"))
            c.execute(text(f"DELETE FROM {parent}"))
        print("  dropped. re-seeding clean CVE demo set ...")

    # re-seed the SAME tenant (force the slug so the seed can't auto-detect a different one)
    sys.argv = [sys.argv[0], slug]
    seed_known_cves.main()


if __name__ == "__main__":
    main()
