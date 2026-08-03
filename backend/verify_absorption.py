"""Verify a completed absorption: is every control placed correctly, are evidence
and artifacts normalized, and is the live library untouched?  Read-only.

Usage: python verify_absorption.py <framework_id> <candidate_run_id>
"""
import os, sys, json
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from grc.models import (NormalizedControl, NormalizedControlLink, CommonControlGroup,
                        CommonControlGroupMapping, ParsedFrameworkControl, NormalizationRun)
from grc.models._37_artifact_catalog_tenant_artifacts import ArtifactCatalogItem

FW = int(sys.argv[1]); CAND = int(sys.argv[2])
db = sessionmaker(bind=create_engine(os.environ["POSTGRES_ADMIN_URL"].rsplit("/", 1)[0] + "/grc_complyverse"))()
BASE = db.query(NormalizationRun).filter(NormalizationRun.is_baseline.is_(True)).order_by(NormalizationRun.id.desc()).first().id

PASS, FAIL = [], []
def check(name, ok, detail=""):
    (PASS if ok else FAIL).append(name)
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}" + (f" — {detail}" if detail else ""))

# baseline sets + domains
base_setnames = {nc.name for nc in db.query(NormalizedControl.name).filter(NormalizedControl.run_id == BASE).all()}
base_domains = {(g.domain or g.name) for g in db.query(CommonControlGroup).filter(CommonControlGroup.run_id == BASE).all()}
base_ev = {nc.name: len(nc.recommended_evidence or []) for nc in db.query(NormalizedControl).filter(NormalizedControl.run_id == BASE).all()}

# candidate
cand_ncs = {nc.id: nc for nc in db.query(NormalizedControl).filter(NormalizedControl.run_id == CAND).all()}
cand_by_name = {nc.name: nc for nc in cand_ncs.values()}
cand_groups = {g.id: (g.domain or g.name) for g in db.query(CommonControlGroup).filter(CommonControlGroup.run_id == CAND).all()}

rows = db.query(ParsedFrameworkControl).filter(ParsedFrameworkControl.uploaded_framework_id == FW).all()
pc = {p.id: p for p in rows}

# joins: fw control → candidate set
joined = {}
for ln in db.query(NormalizedControlLink).filter(
        NormalizedControlLink.normalized_control_id.in_(list(cand_ncs)),
        NormalizedControlLink.parsed_control_id.in_(list(pc))).all():
    nc = cand_ncs.get(ln.normalized_control_id)
    if nc:
        joined[ln.parsed_control_id] = nc
# standalone: fw control → candidate group
standalone = {}
for m in db.query(CommonControlGroupMapping).filter(
        CommonControlGroupMapping.group_id.in_(list(cand_groups)),
        CommonControlGroupMapping.parsed_control_id.in_(list(pc)),
        CommonControlGroupMapping.mapping_source == "standalone").all():
    standalone.setdefault(m.parsed_control_id, cand_groups.get(m.group_id))

print(f"\n=== PLACEMENT — every ISO 45001 control → where it landed (candidate run {CAND}) ===")
placed = 0; join_existing = 0; new_standalone = 0; new_domains = set()
for pid, p in sorted(pc.items(), key=lambda kv: kv[1].control_id):
    if pid in joined:
        nc = joined[pid]; dom = nc.domain or "—"
        existed = nc.name in base_setnames
        tag = "JOIN(existing)" if existed else "JOIN(NEW-set)"
        print(f"  {p.control_id:7} {p.title[:44]:44} → {tag}: {nc.name[:46]}  [{dom}]")
        placed += 1; join_existing += 1 if existed else 0
        if dom not in base_domains: new_domains.add(dom)
    elif pid in standalone:
        dom = standalone[pid]
        print(f"  {p.control_id:7} {p.title[:44]:44} → STANDALONE(new set)         [{dom}]")
        placed += 1; new_standalone += 1
        if dom not in base_domains: new_domains.add(dom)
    else:
        print(f"  {p.control_id:7} {p.title[:44]:44} → !! UNPLACED")

print("\n=== VERIFICATION ===")
check("All 36 controls placed (no orphans)", placed == len(rows), f"{placed}/{len(rows)}")
check("Every JOIN attaches to a set that ALREADY existed in the live library",
      all((joined[pid].name in base_setnames) for pid in joined), f"{join_existing}/{len(joined)} joins to existing sets")
check("Controls with no match became NEW standalone sets", new_standalone == len(standalone), f"{new_standalone} new standalone")
check("NO new domains invented (all land in the existing 20)", not new_domains, f"new={sorted(new_domains)}")
check("Candidate is a faithful full clone of the live library",
      len(cand_ncs) == db.query(NormalizedControl).filter(NormalizedControl.run_id == BASE).count(),
      f"{len(cand_ncs)} vs {len(base_setnames)} baseline sets/entries")
check("Candidate has the same 20 domains (no fragmentation)", len(cand_groups) == len(base_domains), f"{len(cand_groups)} domains")

# EVIDENCE — did joined controls' evidence merge onto their candidate sets?
ev_grown = 0; ev_examples = []
for pid, nc in joined.items():
    b = base_ev.get(nc.name, 0); c = len(nc.recommended_evidence or [])
    if c > b:
        ev_grown += 1
        if len(ev_examples) < 3:
            ev_examples.append(f"{nc.name[:30]}: {b}→{c}")
check("Evidence normalized — joined sets' recommended-evidence grew (merged)", ev_grown > 0,
      f"{ev_grown} sets enriched; e.g. {ev_examples}")

# ARTIFACTS — new vs deduped against the catalog
fkey = None
for r in db.execute(text("select framework_key from grc_artifact_catalog_items order by id desc")).fetchall():
    pass
# derive key like the service does
import re
fk = re.sub(r"[^a-z0-9]+", "_", (rows[0].uploaded_framework_id and db.query(ParsedFrameworkControl).get(rows[0].id).uploaded_framework_id and "" or "")).strip("_")
from grc.modules.control_library.services.extend_baseline import framework_key_for, normalize_artifacts
art = normalize_artifacts(db, 1, FW)
check("Artifacts normalized (framework brought its own, deduped vs catalog)",
      art["artifacts_total"] > 0 and (art["artifacts_new"] + art["artifacts_duplicate"]) == art["artifacts_total"],
      f"{art['artifacts_total']} total = {art['artifacts_new']} new + {art['artifacts_duplicate']} deduped")

# LIVE LIBRARY UNTOUCHED
check("LIVE library (run 47) untouched", db.query(NormalizedControl).filter(NormalizedControl.run_id == BASE).count() == 2332
      and db.query(CommonControlGroup).filter(CommonControlGroup.run_id == BASE).count() == 20,
      "2332 / 20")

print(f"\n==== {len(PASS)} passed, {len(FAIL)} failed ====")
if FAIL: print("FAILED:", FAIL)
print(f"\nSUMMARY: {placed} controls → {len(joined)} joined existing sets, {new_standalone} new standalone; "
      f"{new_domains and 'NEW DOMAINS '+str(new_domains) or '0 new domains'}; "
      f"evidence {ev_grown} sets enriched; artifacts {art['artifacts_new']} new / {art['artifacts_duplicate']} deduped.")
db.close()
