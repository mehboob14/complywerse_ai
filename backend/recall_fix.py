"""Recall fix: re-map all 3419 controls onto the master list, allowing MULTIPLE
controls per framework under a master (all genuinely belong to that requirement).
Keep masters with >=2 DISTINCT frameworks. Measure coverage jump."""
import os, json
from dotenv import load_dotenv; load_dotenv(".env")
from sqlalchemy import create_engine, text as sqltext
from sqlalchemy.orm import sessionmaker
from datetime import datetime
base = os.environ["POSTGRES_ADMIN_URL"].rsplit("/", 1)[0]
db = sessionmaker(bind=create_engine(base + "/grc_complyverse"))()
from grc.models import (NormalizationRun, NormalizedControl, NormalizedControlLink,
                        ParsedFrameworkControl, UploadedFramework)
from grc.modules.control_library.services import normalization as N
from grc.modules.control_library.routers.groups import get_openai_client
client = get_openai_client()
fwn = {f.id: f.name for f in db.query(UploadedFramework).all()}
final = json.load(open("/tmp/full_masterlist.json"))["final"]
print(f"master list: {len(final)}", flush=True)

rows = db.query(ParsedFrameworkControl).all()
members = [{"ref":"parsed","ref_id":p.id,"framework":fwn.get(p.uploaded_framework_id,'?'),
            "fwid":p.uploaded_framework_id,"code":p.original_reference or '',
            "name":(p.title or '')[:200],"text":(p.description or p.full_text or '')[:300]} for p in rows]
members = N._interleave_by_framework(members)
print(f"classifying {len(members)} controls onto masters...", flush=True)
tags = N._classify_to_taxonomy(client, members, final)
from collections import defaultdict
by_master = defaultdict(list)
for m, t in zip(members, tags):
    if t: by_master[t].append(m)
mapped = sum(len(v) for v in by_master.values())
print(f"  mapped: {mapped}/{len(members)} ({100*mapped//len(members)}%)", flush=True)

# clean slate — this recall-fixed run replaces the prior baseline
for sql in ['DELETE FROM grc_evidence_control_mappings WHERE normalized_control_id IS NOT NULL','DELETE FROM grc_ai_evidence_recommendations WHERE normalized_control_id IS NOT NULL','DELETE FROM grc_common_control_group_mappings','DELETE FROM grc_normalized_control_links','DELETE FROM grc_normalized_controls','DELETE FROM grc_common_control_groups','DELETE FROM grc_normalization_runs']:
    db.execute(sqltext(sql))
db.commit()
run = NormalizationRun(tenant_id=1, label="Baseline (recall-fixed, all frameworks)", scope="full", is_baseline=True, status="running", started_at=datetime.utcnow())
db.add(run); db.commit()
seq = 0; created = 0; covered = 0
for master, mems in by_master.items():
    fws = {m["fwid"] for m in mems}
    if len(fws) < 2:           # must be shared across >=2 DISTINCT frameworks
        continue
    seq += 1
    nc = NormalizedControl(code=f"NC-{seq:04d}", name=master, source="ai_normalized", run_id=run.id, maturity_level=0)
    db.add(nc); db.flush()
    for m in mems:             # link ALL (multiple per framework allowed)
        db.add(NormalizedControlLink(normalized_control_id=nc.id, parsed_control_id=m["ref_id"], mapping_type="direct"))
        covered += 1
    created += 1
db.commit()
run.status="completed"; run.completed_at=datetime.utcnow(); run.summary={"unified_controls":created,"controls_covered":covered}; db.commit()
print(f"\nPERSISTED {created} unified controls, {covered} source controls linked (run #{run.id})", flush=True)
print(f"COVERAGE: {covered}/{len(members)} ({100*covered//len(members)}%) — was 20%", flush=True)
# spans (distinct frameworks per control)
spans=[]
for nc in db.query(NormalizedControl).filter(NormalizedControl.run_id==run.id).all():
    fws=set()
    for ln in db.query(NormalizedControlLink).filter(NormalizedControlLink.normalized_control_id==nc.id).all():
        p=db.query(ParsedFrameworkControl).filter(ParsedFrameworkControl.id==ln.parsed_control_id).first()
        if p: fws.add(p.uploaded_framework_id)
    spans.append(len(fws))
print(f"avg distinct-framework span: {round(sum(spans)/max(1,len(spans)),1)}, max {max(spans) if spans else 0}", flush=True)
print("RECALLDONE", flush=True)
db.close()
