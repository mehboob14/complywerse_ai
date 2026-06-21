#!python
# -*- coding: utf-8 -*-
"""Give single-statement specs ONE assessment criterion (= the requirement).

80 assessable NDMO specs have no numbered sub-points, so they had no criteria
checklist and could only be scored via status (stuck at 0%, dragging the total).
This sets their assessment_criteria to a single item = the requirement statement,
so every assessable spec (all 191) has a tickable checklist and scores uniformly
(met ÷ total). DS / NCA rows are left out (excluded from NDMO scoring). Idempotent.
"""
from __future__ import annotations
import os, sys, json
from dotenv import load_dotenv
HERE = os.path.dirname(os.path.abspath(__file__))
load_dotenv(os.path.join(HERE, ".env"))
sys.path.insert(0, HERE)

from sqlalchemy import text
from grc.db import open_tenant_session

JSON_PATH = os.path.join(HERE, "grc", "seed_data", "frameworks",
                         "NDMO_Data_Management_Standardsv1.5.json")


def main():
    db = open_tenant_session("complyverse")
    try:
        rows = db.execute(text("""
            SELECT control_id, full_text, description, assessment_criteria
            FROM grc_parsed_framework_controls
            WHERE uploaded_framework_id = 14 AND priority_level IN ('P1','P2','P3')
        """)).fetchall()

        updates = {}  # control_id -> [single criterion]
        for cid, ft, desc, ac in rows:
            n = len(ac) if isinstance(ac, list) else (len(json.loads(ac)) if ac else 0)
            if n > 0:
                continue  # already has criteria
            stmt = ' '.join((ft or desc or '').split()).strip()
            if stmt:
                updates[cid] = [stmt]

        for cid, crit in updates.items():
            db.execute(text("""
                UPDATE grc_parsed_framework_controls SET assessment_criteria = :c
                WHERE uploaded_framework_id = 14 AND control_id = :cid
            """), {"c": json.dumps(crit), "cid": cid})
        db.commit()
        print(f"DB: added a single criterion to {len(updates)} single-statement specs")

        # verify full coverage now
        miss = db.execute(text("""
            SELECT count(*) FROM grc_parsed_framework_controls
            WHERE uploaded_framework_id=14 AND priority_level IN ('P1','P2','P3')
              AND (assessment_criteria IS NULL OR json_array_length(assessment_criteria)=0)
        """)).scalar()
        tot = db.execute(text("""
            SELECT count(*) FROM grc_parsed_framework_controls
            WHERE uploaded_framework_id=14 AND priority_level IN ('P1','P2','P3')
        """)).scalar()
        print(f"Coverage: {tot - miss}/{tot} assessable specs now have >=1 criterion (missing={miss})")
    finally:
        db.close()

    # patch JSON
    with open(JSON_PATH, encoding="utf-8") as fh:
        data = json.load(fh)
    patched = 0
    for c in data.get("controls", []):
        cid = c.get("control_id")
        if cid in updates:
            c["assessment_criteria"] = updates[cid]
            patched += 1
    with open(JSON_PATH, "w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, indent=2)
    print(f"JSON: patched {patched} single-statement controls")


if __name__ == "__main__":
    main()
