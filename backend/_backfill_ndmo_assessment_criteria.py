#!python
# -*- coding: utf-8 -*-
"""Decompose each NDMO specification's Control Specification text into discrete
assessment criteria (the numbered "…shall include, at minimum: 1… 2…" items).

This does NOT re-gather data — it parses the `full_text` already stored on every
ParsedFrameworkControl. Top-level numbered items become the criteria; nested
sub-points (1a, 1b, …) stay inside their parent criterion. Specs with no list
get an empty criteria array (the requirement itself is the single binary check).

Position-based splitting handles the source-PDF numbering glitches (e.g. DG.1.3
prints "1. 2. 1." where the last item should be "3."). Idempotent. Writes the
live shared framework (id=14) and the seed JSON.
"""
from __future__ import annotations
import os, sys, re, json
from dotenv import load_dotenv
HERE = os.path.dirname(os.path.abspath(__file__))
load_dotenv(os.path.join(HERE, ".env"))
sys.path.insert(0, HERE)

from sqlalchemy import text
from grc.db import open_tenant_session

JSON_PATH = os.path.join(HERE, "grc", "seed_data", "frameworks",
                         "NDMO_Data_Management_Standardsv1.5.json")

# Top-level enumerator: "1. " or "1 - " preceded by a non-word char (so codes
# like DG.1.3 and decimals are skipped) and NOT a lettered sub-point (1a.).
MARK = re.compile(r'(?<![\w.])(\d{1,2})\s*[\.\-]\s+')


def parse_criteria(full_text: str) -> list[str]:
    ft = ' '.join((full_text or '').split())
    marks = list(MARK.finditer(ft))
    nums = [int(m.group(1)) for m in marks]
    # Only treat as a real list if it actually enumerates (has a 1 and a 2).
    if not (1 in nums and 2 in nums):
        return []
    crits = []
    for i, m in enumerate(marks):
        s = m.end()
        e = marks[i + 1].start() if i + 1 < len(marks) else len(ft)
        item = ft[s:e].strip().rstrip(';').strip()
        if item:
            crits.append(item)
    return crits


def main():
    db = open_tenant_session("complyverse")
    try:
        rows = db.execute(text(
            "SELECT id, control_id, full_text FROM grc_parsed_framework_controls "
            "WHERE uploaded_framework_id=14 ORDER BY id"
        )).fetchall()

        parsed = {}          # control_id -> list[str]
        with_list = single = 0
        for _id, cid, ft in rows:
            crits = parse_criteria(ft)
            parsed[cid] = crits
            if crits:
                with_list += 1
            else:
                single += 1

        # Write DB (fw14)
        changed = 0
        for cid, crits in parsed.items():
            r = db.execute(text(
                "UPDATE grc_parsed_framework_controls SET assessment_criteria = :c "
                "WHERE uploaded_framework_id=14 AND control_id=:cid"
            ), {"c": json.dumps(crits), "cid": cid})
            changed += r.rowcount
        db.commit()
        print(f"DB fw14: set assessment_criteria on {changed} rows "
              f"({with_list} with criteria, {single} single-statement)")

        total = sum(len(v) for v in parsed.values())
        print(f"Total criteria extracted: {total}")
    finally:
        db.close()

    # Patch seed JSON (keyed by control_id)
    with open(JSON_PATH, encoding="utf-8") as fh:
        data = json.load(fh)
    patched = 0
    for c in data.get("controls", []):
        cid = c.get("control_id")
        if cid in parsed:
            c["assessment_criteria"] = parsed[cid]
            patched += 1
    with open(JSON_PATH, "w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, indent=2)
    print(f"JSON: set assessment_criteria on {patched} controls")


if __name__ == "__main__":
    main()
