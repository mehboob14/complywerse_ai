"""Master Control List — Stage 2: dedup master list -> map 1240 controls onto it
-> verify -> persist -> RIGOROUSLY verify (0 fragmentation, accuracy, integrity)."""
import os, json
from dotenv import load_dotenv; load_dotenv(".env")
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from datetime import datetime
base = os.environ["POSTGRES_ADMIN_URL"].rsplit("/", 1)[0]
db = sessionmaker(bind=create_engine(base + "/grc_complyverse"))()
from grc.models import (NormalizationRun, NormalizedControl, NormalizedControlLink,
                        ParsedFrameworkControl, UploadedFramework, CommonControlGroupMapping)
from grc.modules.control_library.services import normalization as N
from grc.modules.control_library.routers.groups import get_openai_client
from grc.config import get_openai_model
import re
client = get_openai_client()
FW = [11, 18, 3, 19, 27, 28, 8, 9, 4, 16, 6, 15, 7, 10, 29]
fwn = {f.id: f.name for f in db.query(UploadedFramework).all()}

masters = json.load(open("/tmp/master_list.json"))["masters"]
names = [m["name"] for m in masters]
print(f"loaded {len(names)} masters", flush=True)

# STEP 0 — dedup the master list (strict: merge only obvious duplicate NAMES)
SYS = "You dedupe a control master list. Merge ONLY entries that are the SAME control (synonyms). NEVER merge different lifecycle stages or distinct actions."
prompt = ("Merge duplicate master controls in this list. Two entries merge ONLY if they are "
 "the same control (e.g. 'Awareness Training'='Security Awareness Training', 'Risk "
 "Assessment'='Risk Analysis'='ICT Risk Assessment'). KEEP separate: lifecycle stages, "
 "policy vs operation, adjacent actions. Return the FINAL list — each final control with "
 "name + the input indices it absorbs.\n\n"
 + "\n".join(f"[{i}] {n}" for i, n in enumerate(names)) +
 '\n\nJSON: {"final":[{"name":"...","absorbs":[0]}]}')
r = client.chat.completions.create(model=get_openai_model(), messages=[{"role":"system","content":SYS},{"role":"user","content":prompt}], response_format={"type":"json_object"}, temperature=0.0)
final = json.loads(r.choices[0].message.content or "{}").get("final", [])
final_names = [f["name"] for f in final]
print(f"after dedup: {len(final_names)} master controls (merged {len(names)-len(final_names)})", flush=True)

# STEP 1 — map every control onto the FINAL master list (fixed taxonomy)
rows = db.query(ParsedFrameworkControl).filter(ParsedFrameworkControl.uploaded_framework_id.in_(FW)).all()
members = [{"ref":"parsed","ref_id":p.id,"framework":fwn.get(p.uploaded_framework_id,'?'),
            "code":p.original_reference or '',"name":(p.title or '')[:200],
            "text":(p.description or p.full_text or '')[:300]} for p in rows]
members = N._interleave_by_framework(members)
print(f"mapping {len(members)} controls onto {len(final_names)} masters...", flush=True)
tags = N._classify_to_taxonomy(client, members, final_names)

# group by master
from collections import defaultdict
by_master = defaultdict(list)
for m, t in zip(members, tags):
    if t: by_master[t].append(m)

# STEP 2 — persist (>=2 frameworks, <=1 per framework), tag run
# clean slate
for sql in ['DELETE FROM grc_evidence_control_mappings WHERE normalized_control_id IS NOT NULL','DELETE FROM grc_ai_evidence_recommendations WHERE normalized_control_id IS NOT NULL','DELETE FROM grc_common_control_group_mappings','DELETE FROM grc_normalized_control_links','DELETE FROM grc_normalized_controls','DELETE FROM grc_common_control_groups','DELETE FROM grc_normalization_runs']:
    db.execute(__import__('sqlalchemy').text(sql))
db.commit()
run = NormalizationRun(tenant_id=1, label="15-fw MASTER-LIST test", scope="custom", framework_ids=FW, status="running", started_at=datetime.utcnow())
db.add(run); db.commit()
# build defs (one per framework), then VERIFY (drop mis-mapped members)
defs = []
for master, mems in by_master.items():
    seen = {}; kept = []
    for m in mems:
        if m["framework"] not in seen:
            seen[m["framework"]] = True
            kept.append({"ref":"parsed","ref_id":m["ref_id"],"framework":m["framework"],
                         "code":m["code"],"name":m["name"],"text":m["text"]})
    if len({k["framework"] for k in kept}) >= 2:
        defs.append({"name": master, "statement": "", "refs": kept})
print(f"verifying {len(defs)} master groups (drop mis-mapped controls)...", flush=True)
defs = N._verify_clusters(client, "master", defs)
seq = 0; created = 0
for d in defs:
    refs = d["refs"]
    if len({r["framework"] for r in refs}) < 2:
        continue
    seq += 1
    nc = NormalizedControl(code=f"NC-{seq:04d}", name=d["name"], source="ai_normalized", run_id=run.id, maturity_level=0)
    db.add(nc); db.flush()
    for r in refs:
        db.add(NormalizedControlLink(normalized_control_id=nc.id, parsed_control_id=r["ref_id"], mapping_type="direct"))
    created += 1
db.commit()
run.status="completed"; run.completed_at=datetime.utcnow(); run.summary={"unified_controls":created}; db.commit()
print(f"\nPERSISTED: {created} unified controls (run #{run.id})", flush=True)

# STEP 3 — RIGOROUS VERIFY
ncs = db.query(NormalizedControl).filter(NormalizedControl.run_id==run.id).all()
# fragmentation check: any two controls with same canonical-ish topic?
norm = lambda s: re.sub(r"[^a-z0-9]+"," ",(s or "").lower()).strip()
nm = [nc.name for nc in ncs]
dupe = len(nm) - len(set(norm(x) for x in nm))
print(f"\n=== VERIFY ===", flush=True)
print(f"  exact-name duplicates: {dupe} (must be 0)", flush=True)
import psycopg2
cn=psycopg2.connect(base+'/grc_complyverse'); cc=cn.cursor()
cc.execute(f"SELECT count(*) FROM (SELECT l.normalized_control_id,p.uploaded_framework_id FROM grc_normalized_control_links l JOIN grc_parsed_framework_controls p ON p.id=l.parsed_control_id JOIN grc_normalized_controls nc ON nc.id=l.normalized_control_id WHERE nc.run_id={run.id} GROUP BY 1,2 HAVING count(*)>1) x")
print(f"  same-framework-twice: {cc.fetchone()[0]} (must be 0)", flush=True)
cc.execute(f"SELECT count(*) FROM (SELECT parsed_control_id FROM grc_normalized_control_links l JOIN grc_normalized_controls nc ON nc.id=l.normalized_control_id WHERE nc.run_id={run.id} GROUP BY parsed_control_id HAVING count(DISTINCT l.normalized_control_id)>1) x")
print(f"  control in >1 unified: {cc.fetchone()[0]} (must be 0)", flush=True)
cn.close()
# spans
spans=[]
for nc in ncs:
    fws=set()
    for ln in db.query(NormalizedControlLink).filter(NormalizedControlLink.normalized_control_id==nc.id).all():
        p=db.query(ParsedFrameworkControl).filter(ParsedFrameworkControl.id==ln.parsed_control_id).first()
        if p: fws.add(p.uploaded_framework_id)
    spans.append(len(fws))
print(f"  avg framework span: {round(sum(spans)/max(1,len(spans)),1)}, max {max(spans) if spans else 0}", flush=True)
print("\n  audit/risk/awareness fragmentation check (should be ONE each):", flush=True)
for kw in ["audit","risk","awareness","backup","incident"]:
    hits=[nc.name for nc in ncs if kw in nc.name.lower()]
    print(f"    '{kw}': {hits}", flush=True)
print("STAGE2DONE", flush=True)
db.close()
