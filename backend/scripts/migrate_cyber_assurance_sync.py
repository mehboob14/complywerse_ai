"""Schema catch-up for the Cybersecurity Assurance sync, for every tenant DB.

Tenant DBs are built with ``Base.metadata.create_all``, which creates missing TABLES
but never adds columns to an existing table or widens a column. This script brings
every tenant's cyber tables up to the models, and only ever ADDS or WIDENS:

  * creates the tables the sync introduced (help desk, advisories, licenses,
    report schedules, pentest runs, asset risk snapshots, ...) when missing;
  * ``ALTER TABLE .. ADD COLUMN IF NOT EXISTS`` for every model column a table
    lacks — nullable, with the model's scalar default (if any) so existing rows
    get it too;
  * widens ``VARCHAR(n)`` to a longer ``VARCHAR`` or to ``TEXT`` where the model
    asks for it. Any other type difference is reported, never changed.

Nothing is dropped, renamed or narrowed. Run it twice: the second run has nothing
to do. Tenants come from grc_master's grc_tenants registry (inactive ones too);
if the registry can't be read, from every ``grc_%`` database except grc_master.

Usage (from backend/, with backend/.env pointing at the right server):
    python scripts/migrate_cyber_assurance_sync.py --dry-run        # print the plan
    python scripts/migrate_cyber_assurance_sync.py                  # apply, all tenants
    python scripts/migrate_cyber_assurance_sync.py --tenant cfsb    # one tenant
    python scripts/migrate_cyber_assurance_sync.py --all-tables     # every mapped table, not just cyber
"""
from __future__ import annotations

import argparse
import logging
import os
import sys
from typing import Iterable, List, Optional, Tuple

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BACKEND)

from dotenv import load_dotenv  # noqa: E402

load_dotenv(os.path.join(BACKEND, ".env"))

from sqlalchemy import JSON, String, Text, create_engine, inspect, text  # noqa: E402
from sqlalchemy.dialects import postgresql  # noqa: E402

import grc.models  # noqa: E402,F401  registers the platform models (+ help desk, advisories)
from grc.db import master_engine, tenant_db_url  # noqa: E402
from grc.models._00_base import Base  # noqa: E402

# Feature modules whose models are not imported by grc.models.
for _mod in ("grc.modules.license_management.models", "grc.modules.report_scheduler.models",
             "grc.modules.connectors.models", "grc.modules.advisories.models"):
    try:
        __import__(_mod)
    except ModuleNotFoundError:
        pass

log = logging.getLogger("migrate_cyber_assurance_sync")

# Python modules whose mapped tables this sync owns or changed.
SCOPE = (
    "grc.models._14_it_asset_inventory",
    "grc.models._22_vulnerability_management_module",
    "grc.models._37_artifact_catalog_tenant_artifacts",
    "grc.models._47_asset_discovery_models",
    "grc.models._60_helpdesk_native_models",
    "grc.models._61_helpdesk_mail_models",
    "grc.models._62_helpdesk_itsm_models",
    "grc.models._asset_risk_snapshot",
    "grc.models._pentest_",
    "grc.modules.advisories",
    "grc.modules.license_management",
    "grc.modules.report_scheduler",
    "grc.modules.connectors",
    "grc.modules.pentest",
)
PG = postgresql.dialect()


def scoped_tables(all_tables: bool = False) -> list:
    tables = {}
    for mapper in Base.registry.mappers:
        if all_tables or mapper.class_.__module__.startswith(SCOPE):
            for t in mapper.tables:
                tables[t.name] = t
    return [tables[k] for k in sorted(tables)]


def tenant_slugs(only: Optional[str]) -> List[Tuple[str, str]]:
    """(slug, url) per tenant DB; grc_master is never one."""
    if only:
        return [(only, tenant_db_url(only))]
    try:
        with master_engine.connect() as c:
            slugs = [r[0] for r in c.execute(text("SELECT slug FROM grc_tenants ORDER BY id")) if r[0]]
        return [(s, tenant_db_url(s)) for s in slugs]
    except Exception:  # noqa: BLE001 — registry unreadable: fall back to the database list
        log.warning("grc_tenants unreadable; falling back to pg_database grc_%%", exc_info=True)
        base = str(master_engine.url).rsplit("/", 1)[0]
        with master_engine.connect() as c:
            names = [r[0] for r in c.execute(text(
                "SELECT datname FROM pg_database WHERE datname LIKE 'grc\\_%' AND datname <> 'grc_master' ORDER BY 1"))]
        return [(n, f"{base}/{n}") for n in names]


def _literal_default(col) -> Optional[str]:
    d = col.default
    if d is None or not getattr(d, "is_scalar", False):
        return None
    v = d.arg
    if isinstance(v, bool):
        return "TRUE" if v else "FALSE"
    if isinstance(v, (int, float)):
        return repr(v)
    if isinstance(v, str):
        return "'" + v.replace("'", "''") + "'"
    return None


def _server_default(col) -> Optional[str]:
    arg = getattr(col.server_default, "arg", None)
    if arg is None:
        return None
    if hasattr(arg, "text"):  # server_default=text("now()") / text("false")
        return arg.text
    return "'" + str(arg).replace("'", "''") + "'"


def _varchar_len(db_type) -> Optional[int]:
    return getattr(db_type, "length", None) if type(db_type).__name__.upper() in ("VARCHAR", "STRING") else None


def plan_tenant(engine, tables: Iterable) -> Tuple[list, List[str], List[str]]:
    insp = inspect(engine)
    existing = set(insp.get_table_names())
    missing_tables, stmts, notes = [], [], []
    for t in tables:
        if t.name not in existing:
            missing_tables.append(t)
            continue
        db_cols = {c["name"]: c for c in insp.get_columns(t.name)}
        for col in t.columns:
            if col.name not in db_cols:
                ddl = f'ALTER TABLE "{t.name}" ADD COLUMN IF NOT EXISTS "{col.name}" {col.type.compile(dialect=PG)}'
                default = _server_default(col) or _literal_default(col)
                if default:
                    ddl += f" DEFAULT {default}"
                stmts.append(ddl)
                continue
            have = db_cols[col.name]["type"]
            have_len = _varchar_len(have)
            if have_len is None:
                continue
            if isinstance(col.type, Text) or (isinstance(col.type, String) and col.type.length is None
                                               and not isinstance(col.type, JSON)):
                stmts.append(f'ALTER TABLE "{t.name}" ALTER COLUMN "{col.name}" TYPE TEXT')
            elif isinstance(col.type, String) and col.type.length and col.type.length > have_len:
                stmts.append(f'ALTER TABLE "{t.name}" ALTER COLUMN "{col.name}" TYPE VARCHAR({col.type.length})')
            elif isinstance(col.type, String) and col.type.length and col.type.length < have_len:
                notes.append(f"{t.name}.{col.name}: DB VARCHAR({have_len}) wider than model {col.type.length} — left")
    return missing_tables, stmts, notes


def migrate(slug: str, url: str, tables: list, dry_run: bool) -> Tuple[int, int, int]:
    engine = create_engine(url, future=True)
    try:
        missing, stmts, notes = plan_tenant(engine, tables)
        for t in missing:
            print(f"  [{slug}] CREATE TABLE {t.name}")
        for s in stmts:
            print(f"  [{slug}] {s}")
        for n in notes:
            print(f"  [{slug}] note: {n}")
        failed = 0
        if not dry_run:
            if missing:
                Base.metadata.create_all(engine, tables=missing, checkfirst=True)
            for s in stmts:
                try:
                    with engine.begin() as c:
                        c.execute(text(s))
                except Exception as e:  # noqa: BLE001 — one bad column must not stop the rest
                    failed += 1
                    print(f"  [{slug}] FAILED: {s}\n      {e.__class__.__name__}: {str(e).splitlines()[0]}")
        return len(missing), len(stmts), failed
    finally:
        engine.dispose()


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--dry-run", action="store_true", help="print the plan, change nothing")
    ap.add_argument("--tenant", help="one tenant slug instead of all")
    ap.add_argument("--all-tables", action="store_true",
                    help="same add-only/widen-only rules for EVERY mapped table, not just the cyber ones "
                         "(catches columns other modules added since a tenant DB was built)")
    args = ap.parse_args()
    logging.basicConfig(level=logging.WARNING)

    tables = scoped_tables(args.all_tables)
    print(f"{len(tables)} {'mapped' if args.all_tables else 'cyber'} tables in scope; {'DRY RUN' if args.dry_run else 'APPLYING'}")
    total_failed = 0
    for slug, url in tenant_slugs(args.tenant):
        if url.rsplit("/", 1)[-1] == "grc_master":
            continue
        try:
            created, altered, failed = migrate(slug, url, tables, args.dry_run)
        except Exception as e:  # noqa: BLE001 — an unreachable tenant DB is reported, not fatal
            print(f"[{slug}] SKIPPED: {e.__class__.__name__}: {str(e).splitlines()[0]}")
            total_failed += 1
            continue
        total_failed += failed
        print(f"[{slug}] tables created {created}, column changes {altered}, failed {failed}")
    return 1 if total_failed else 0


if __name__ == "__main__":
    sys.exit(main())
