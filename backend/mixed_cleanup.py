"""Phase 1 master-list correctness pass: grade all baseline clusters, then on the
MIXED ones trim ONLY clearly off-topic members (conservative adversarial verify).
GOOD clusters are never touched. A trim that would drop a cluster below 2
frameworks is skipped (cluster left intact). Re-consolidate evidence for changed
clusters. Reports GOOD/MIXED/BAD + coverage before vs after."""
import os, json
from collections import Counter
from dotenv import load_dotenv; load_dotenv(".env")
from sqlalchemy import create_engine, text as sqltext
from sqlalchemy.orm import sessionmaker
base=os.environ["POSTGRES_ADMIN_URL"].rsplit("/",1)[0]
db=sessionmaker(bind=create_engine(base+"/grc_complyverse"))()
from grc.models import NormalizedControl, NormalizedControlLink, ParsedFrameworkControl, UploadedFramework, NormalizationRun
from grc.modules.control_library.services import normalization as N
from grc.modules.control_library.routers.groups import get_openai_client
from grc.config import get_openai_model
client=get_openai_client(); M=get_openai_model()
fwn={f.id:f.name for f in db.query(UploadedFramework).all()}
RUN=db.query(NormalizationRun).filter(NormalizationRun.is_baseline==True).order_by(NormalizationRun.id.desc()).first().id

def load_defs():
    defs=[]
    for nc in db.query(NormalizedControl).filter(NormalizedControl.run_id==RUN).all():
        refs=[]
        for ln in db.query(NormalizedControlLink).filter(NormalizedControlLink.normalized_control_id==nc.id).all():
            p=db.query(ParsedFrameworkControl).filter(ParsedFrameworkControl.id==ln.parsed_control_id).first()
            if p: refs.append({"ref_id":p.id,"framework":fwn.get(p.uploaded_framework_id,'?'),"fwid":p.uploaded_framework_id,
                               "code":p.original_reference or '',"name":(p.title or '')[:200],"text":(p.description or p.full_text or '')[:300]})
        defs.append({"nc_id":nc.id,"name":nc.name,"refs":refs})
    return defs

JUDGE="Strict auditor. Grade GOOD if MOST members impose the same core requirement, MIXED if a minority are off-topic, BAD if a catch-all of unrelated requirements."
def grade_all(defs):
    g={}
    for s in range(0,len(defs),6):
        b=defs[s:s+6]
        prompt="Grade each GOOD/MIXED/BAD.\n\n"+"\n\n".join(f"N{ci}: \"{d['name']}\"\n"+"\n".join(f"  ({m['framework'][:8]} {m['code']}) {m['name'][:30]}" for m in d['refs'][:12]) for ci,d in enumerate(b))+'\n\nJSON {"grades":[{"n":0,"verdict":"GOOD"}]}'
        r=client.chat.completions.create(model=M,messages=[{"role":"system","content":JUDGE},{"role":"user","content":prompt}],response_format={"type":"json_object"},temperature=0)
        for x in json.loads(r.choices[0].message.content or "{}").get("grades",[]):
            try: g[s+int(x["n"])]=(x.get("verdict") or "?").upper()
            except: pass
    return g

defs=load_defs()
g_before=grade_all(defs)
def tally(g): 
    c=Counter(g.values()); n=sum(c.values()); return c,n
cb,nb=tally(g_before)
cov_before=db.execute(sqltext(f"SELECT count(DISTINCT parsed_control_id) FROM grc_normalized_control_links l JOIN grc_normalized_controls nc ON nc.id=l.normalized_control_id WHERE nc.run_id={RUN}")).scalar()
print(f"BEFORE: GOOD={cb.get('GOOD',0)} MIXED={cb.get('MIXED',0)} BAD={cb.get('BAD',0)} | coverage={cov_before}", flush=True)

mixed_idx=[i for i in range(len(defs)) if g_before.get(i)=="MIXED"]
print(f"trimming members on {len(mixed_idx)} MIXED clusters (conservative)...", flush=True)
CONS="Conservative reviewer. KEEP every member that plausibly concerns the control's core requirement. Drop ONLY members clearly about a DIFFERENT requirement. When unsure, KEEP."
# reuse _verify_clusters but with conservative system prompt
orig_sys=N._VERIFY_SYSTEM
N._VERIFY_SYSTEM=CONS
sus=[{"name":defs[i]["name"],"statement":"","refs":defs[i]["refs"][:30],"_i":i} for i in mixed_idx]
verified=N._verify_clusters(client,"mixedclean",sus)
N._VERIFY_SYSTEM=orig_sys
kept_by_i={d["_i"]:{r["ref_id"] for r in d["refs"]} for d in verified}

changed=[]; trimmed_links=0
for i in mixed_idx:
    d=defs[i]; ncid=d["nc_id"]
    kept=kept_by_i.get(i)
    capped_ids={m["ref_id"] for m in d["refs"][:30]}
    if kept is None:           # verifier collapsed it -> skip trim, keep intact
        continue
    # members beyond the 30 cap are always kept
    keep_ids=kept | {m["ref_id"] for m in d["refs"][30:]}
    drop=[m["ref_id"] for m in d["refs"] if m["ref_id"] not in keep_ids]
    if not drop: continue
    # safety: don't drop below 2 frameworks
    remain_fw={m["fwid"] for m in d["refs"] if m["ref_id"] in keep_ids}
    if len(remain_fw)<2: continue
    db.execute(sqltext(f"DELETE FROM grc_normalized_control_links WHERE normalized_control_id={ncid} AND parsed_control_id IN ({','.join(str(x) for x in drop)})"))
    db.execute(sqltext(f"DELETE FROM grc_common_control_group_mappings WHERE parsed_control_id IN ({','.join(str(x) for x in drop)}) AND group_id IN (SELECT id FROM grc_common_control_groups WHERE run_id={RUN} AND name=:nm)"), {"nm":d["name"]})
    db.execute(sqltext(f"UPDATE grc_normalized_controls SET recommended_evidence=NULL WHERE id={ncid}"))
    changed.append(ncid); trimmed_links+=len(drop)
db.commit()
print(f"trimmed {trimmed_links} off-topic members across {len(changed)} clusters", flush=True)
# re-consolidate evidence for changed
N._precompute_nc_evidence(db, client, run_id=RUN)
# re-grade
defs2=load_defs()
g_after=grade_all(defs2)
ca,na=tally(g_after)
cov_after=db.execute(sqltext(f"SELECT count(DISTINCT parsed_control_id) FROM grc_normalized_control_links l JOIN grc_normalized_controls nc ON nc.id=l.normalized_control_id WHERE nc.run_id={RUN}")).scalar()
ev=db.execute(sqltext(f"SELECT count(*) FROM grc_normalized_controls WHERE run_id={RUN} AND recommended_evidence IS NOT NULL")).scalar()
ncn=db.execute(sqltext(f"SELECT count(*) FROM grc_normalized_controls WHERE run_id={RUN}")).scalar()
print(f"AFTER:  GOOD={ca.get('GOOD',0)} MIXED={ca.get('MIXED',0)} BAD={ca.get('BAD',0)} | coverage={cov_after} | evidence={ev}/{ncn}", flush=True)
print(f"DELTA: GOOD {cb.get('GOOD',0)}->{ca.get('GOOD',0)}  coverage {cov_before}->{cov_after} ({cov_after-cov_before})", flush=True)
print("MIXEDCLEANDONE", flush=True)
db.close()
