#!python
# -*- coding: utf-8 -*-
"""Re-seed the NDMO framework into the live tenant with native fidelity.

Ensures the new `priority_level` / `dependencies` columns exist on the tenant
DB (idempotent ALTER), then force re-seeds NDMO from its JSON so every
Specification carries its P1/P2/P3 tier and control-level dependency graph.
"""
from __future__ import annotations
import os, sys
from dotenv import load_dotenv
HERE = os.path.dirname(os.path.abspath(__file__))
load_dotenv(os.path.join(HERE, ".env"))
sys.path.insert(0, HERE)

from sqlalchemy import inspect, text
from grc.db import open_tenant_session
from grc.models import Tenant, UploadedFramework, ParsedFrameworkControl
from grc.seed_frameworks import load_framework_json, seed_framework_from_json

SLUG = os.environ.get("VERIFY_SLUG", "complyverse")
JSON_PATH = os.path.join(
    HERE, "grc", "seed_data", "frameworks", "NDMO_Data_Management_Standardsv1.5.json"
)
TABLE = "grc_parsed_framework_controls"
NEW_COLS = [("priority_level", "VARCHAR(10)"),
            ("dependencies", "JSON DEFAULT '[]'::json")]


def ensure_cols(db):
    eng = db.get_bind()
    insp = inspect(eng)
    existing = {c["name"] for c in insp.get_columns(TABLE)}
    for col, ddl in NEW_COLS:
        if col in existing:
            print(f"  column {TABLE}.{col} already present")
            continue
        with eng.begin() as conn:
            conn.execute(text(f"ALTER TABLE {TABLE} ADD COLUMN {col} {ddl}"))
        print(f"  + added {TABLE}.{col} {ddl}")


def main():
    db = open_tenant_session(SLUG)
    try:
        tid = db.query(Tenant).filter(Tenant.slug == SLUG).first().id
        print(f"Tenant {SLUG} (id={tid})")
        ensure_cols(db)
        db.commit()

        data = load_framework_json(JSON_PATH)
        name = (data.get("metadata") or {}).get("name") or "NDMO"
        print(f"\nForce re-seeding framework: {name!r}")
        fw = seed_framework_from_json(db, data, tenant_id=tid, uploaded_by=1, force=True)
        db.commit()

        # Verify
        total = db.query(ParsedFrameworkControl).filter(
            ParsedFrameworkControl.uploaded_framework_id == fw.id).count()
        from sqlalchemy import func
        by_pl = db.query(ParsedFrameworkControl.priority_level, func.count()).filter(
            ParsedFrameworkControl.uploaded_framework_id == fw.id
        ).group_by(ParsedFrameworkControl.priority_level).all()
        with_deps = db.query(ParsedFrameworkControl).filter(
            ParsedFrameworkControl.uploaded_framework_id == fw.id,
            func.json_array_length(ParsedFrameworkControl.dependencies) > 0,
        ).count()

        print(f"\n=== Seeded framework id={fw.id} '{fw.name}' ===")
        print(f"  total specifications: {total}")
        print(f"  priority_level breakdown: {dict(by_pl)}")
        print(f"  specs with >=1 dependency: {with_deps}")
        sample = db.query(ParsedFrameworkControl).filter(
            ParsedFrameworkControl.uploaded_framework_id == fw.id,
            ParsedFrameworkControl.control_id == "DG.2.1",
        ).first()
        if sample:
            print(f"  sample DG.2.1: priority={sample.priority!r} "
                  f"priority_level={sample.priority_level!r} "
                  f"parent_section={sample.parent_section!r} "
                  f"dependencies={sample.dependencies!r}")
    finally:
        db.close()


if __name__ == "__main__":
    main()
