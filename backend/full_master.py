"""FULL one-time baseline: Master Control List over ALL 30 frameworks / 3,419 controls.
harvest -> build master list -> dedup -> map all -> verify -> persist -> evidence."""
import os, json, re
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
from grc.config import get_openai_model
client = get_openai_client()
M = get_openai_model()
fwn = {f.id: f.name for f in db.query(UploadedFramework).all()}

rows = db.query(ParsedFrameworkControl).all()   # ALL frameworks
members = [{"ref":"parsed","ref_id":p.id,"framework":fwn.get(p.uploaded_framework_id,'?'),
            "code":p.original_reference or '',"name":(p.title or '')[:200],
            "text":(p.description or p.full_text or '')[:300]} for p in rows]
members = N._interleave_by_framework(members)
print(f"ALL frameworks: {len(set(m['framework'] for m in members))}, controls: {len(members)}", flush=True)

# STEP 1 harvest (cached so re-runs skip the expensive tagging)
if os.path.exists("/tmp/full_harvest.json"):
    h=json.load(open("/tmp/full_harvest.json")); families=h["families"]; fam_ex=h["fam_ex"]
    print(f"STEP 1 harvest: loaded cached {len(families)} families", flush=True)
else:
    print("STEP 1 harvest...", flush=True)
    tags = N._ai_tag_controls(client, members)
    fam_ex = {}
    for m,t in zip(members,tags):
        if t:
            fam_ex.setdefault(t,[])
            if len(fam_ex[t])<3: fam_ex[t].append(m["name"][:40])
    families = sorted(fam_ex)
    json.dump({"families":families,"fam_ex":fam_ex}, open("/tmp/full_harvest.json","w"))
    print(f"  {len(families)} families", flush=True)

# STEP 2 build master list — BATCHED + dedup (robust at any family count)
print("STEP 2 build master list...", flush=True)
SYS=("You are a GRC taxonomist de-duplicating a harvested control-family list with "
 "drift duplicates. Merge ONLY drift-duplicates; preserve every genuinely distinct control.")
def build_chunk(fams_idx, existing):
    lines=[f"[{i}] {families[i]} (ex: {', '.join(fam_ex[families[i]])})" for i in fams_idx]
    ev=("\nAlready-canonical master names (REUSE verbatim if a family is the same):\n  "+
        "\n  ".join(existing)) if existing else ""
    p=("From the families below, output the canonical master controls. Merge a family into "
     "a master only if SAME action+object. KEEP separate: lifecycle stages (detect/report/"
     "respond/test/train; grant/review/revoke), policy vs operation, adjacent actions "
     "(logging vs retention; backup vs disposal; scan vs patch)."+ev+
     "\n\nFamilies:\n"+"\n".join(lines)+'\n\nJSON {"masters":["name1","name2"]}')
    try:
        r=client.chat.completions.create(model=M,messages=[{"role":"system","content":SYS},{"role":"user","content":p}],response_format={"type":"json_object"},temperature=0.0)
        return [x for x in json.loads(r.choices[0].message.content or "{}").get("masters",[]) if isinstance(x,str) and x.strip()]
    except Exception as e:
        print("  build chunk error:",e,flush=True); return []
master_names=[]
B=70
for s in range(0,len(families),B):
    got=build_chunk(range(s,min(s+B,len(families))), master_names)
    for nm in got:
        key=re.sub(r"[^a-z0-9]+"," ",nm.lower()).strip()
        if key and key not in {re.sub(r"[^a-z0-9]+"," ",x.lower()).strip() for x in master_names}:
            master_names.append(nm)
print(f"  after batched build: {len(master_names)} candidate masters", flush=True)
# dedup pass (final merge of synonyms across the whole list)
SYS3="Dedupe a control master list. Merge ONLY same-control synonyms. NEVER merge lifecycle stages/distinct actions."
p3=("Merge duplicate masters (e.g. 'Awareness Training'='Security Awareness Training', "
 "'Risk Assessment'='Risk Analysis'). Keep lifecycle/distinct separate. Return the kept names.\n\n"
 +"\n".join(f"[{i}] {n}" for i,n in enumerate(master_names))+'\n\nJSON {"final":["name1","name2"]}')
try:
    r=client.chat.completions.create(model=M,messages=[{"role":"system","content":SYS3},{"role":"user","content":p3}],response_format={"type":"json_object"},temperature=0.0)
    final=[x for x in json.loads(r.choices[0].message.content or "{}").get("final",[]) if isinstance(x,str) and x.strip()]
except Exception as e:
    print("  dedup error:",e,flush=True); final=[]
if len(final) < len(master_names)//2:   # dedup collapsed → fall back to candidates
    print(f"  dedup collapsed ({len(final)}) — using candidates", flush=True); final=master_names
print(f"  master list: {len(final)} controls", flush=True)
json.dump({"final":final}, open("/tmp/full_masterlist.json","w"))

# STEP 3 map all controls onto the fixed master list
print("STEP 3 map all controls...", flush=True)
mtags = N._classify_to_taxonomy(client, members, final)
from collections import defaultdict
by_master=defaultdict(list)
for m,t in zip(members,mtags):
    if t: by_master[t].append(m)

# clean slate + new baseline run
for sql in ['DELETE FROM grc_evidence_control_mappings WHERE normalized_control_id IS NOT NULL','DELETE FROM grc_ai_evidence_recommendations WHERE normalized_control_id IS NOT NULL','DELETE FROM grc_common_control_group_mappings','DELETE FROM grc_normalized_control_links','DELETE FROM grc_normalized_controls','DELETE FROM grc_common_control_groups','DELETE FROM grc_normalization_runs']:
    db.execute(sqltext(sql))
db.commit()
run=NormalizationRun(tenant_id=1,label="Full baseline (all 30 frameworks)",scope="full",is_baseline=True,status="running",started_at=datetime.utcnow())
db.add(run); db.commit()

# STEP 4 verify each master group, persist
print("STEP 4 verify + persist...", flush=True)
defs=[]
for master,mems in by_master.items():
    seen={}; kept=[]
    for m in mems:
        if m["framework"] not in seen:
            seen[m["framework"]]=True
            kept.append({"ref":"parsed","ref_id":m["ref_id"],"framework":m["framework"],"code":m["code"],"name":m["name"],"text":m["text"]})
    if len({k["framework"] for k in kept})>=2:
        defs.append({"name":master,"statement":"","refs":kept})
defs=N._verify_clusters(client,"master",defs)
seq=0;created=0
for d in defs:
    refs=d["refs"]
    if len({r["framework"] for r in refs})<2: continue
    seq+=1
    nc=NormalizedControl(code=f"NC-{seq:04d}",name=d["name"],source="ai_normalized",run_id=run.id,maturity_level=0)
    db.add(nc); db.flush()
    for r in refs:
        db.add(NormalizedControlLink(normalized_control_id=nc.id,parsed_control_id=r["ref_id"],mapping_type="direct"))
    created+=1
db.commit()
print(f"PERSISTED {created} unified controls (run #{run.id})", flush=True)

# STEP 5 — evidence normalization (bake AI-consolidated evidence into the baseline)
print("STEP 5 consolidate evidence per control...", flush=True)
ev_done = N._precompute_nc_evidence(db, client, run_id=run.id)
print(f"  evidence consolidated for {ev_done} controls", flush=True)
run.status="completed";run.completed_at=datetime.utcnow()
run.summary={"unified_controls":created,"evidence_consolidated":ev_done};db.commit()

# verify
ncs=db.query(NormalizedControl).filter(NormalizedControl.run_id==run.id).all()
spans=[]
for nc in ncs:
    fws=set()
    for ln in db.query(NormalizedControlLink).filter(NormalizedControlLink.normalized_control_id==nc.id).all():
        p=db.query(ParsedFrameworkControl).filter(ParsedFrameworkControl.id==ln.parsed_control_id).first()
        if p: fws.add(p.uploaded_framework_id)
    spans.append(len(fws))
import psycopg2
cn=psycopg2.connect(base+'/grc_complyverse');cc=cn.cursor()
cc.execute(f"SELECT count(*) FROM (SELECT l.normalized_control_id,p.uploaded_framework_id FROM grc_normalized_control_links l JOIN grc_parsed_framework_controls p ON p.id=l.parsed_control_id JOIN grc_normalized_controls nc ON nc.id=l.normalized_control_id WHERE nc.run_id={run.id} GROUP BY 1,2 HAVING count(*)>1) x")
sf=cc.fetchone()[0]; cn.close()
print(f"=== VERIFY: {created} controls | avg span {round(sum(spans)/max(1,len(spans)),1)} max {max(spans) if spans else 0} | same-fw-dupes {sf}", flush=True)
print("FULLDONE", flush=True)
db.close()
