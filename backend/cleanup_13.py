"""Surgical accuracy cleanup for run #13: grade all clusters, re-verify members of
MIXED/BAD ones (drop mis-mapped members; delete clusters that collapse <2 fw),
then re-consolidate evidence for changed clusters."""
import os, json
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
RUN=db.query(NormalizationRun).order_by(NormalizationRun.id.desc()).first().id

# build full defs
ncs=db.query(NormalizedControl).filter(NormalizedControl.run_id==RUN).all()
defs=[]
for nc in ncs:
    refs=[]
    for ln in db.query(NormalizedControlLink).filter(NormalizedControlLink.normalized_control_id==nc.id).all():
        p=db.query(ParsedFrameworkControl).filter(ParsedFrameworkControl.id==ln.parsed_control_id).first()
        if p: refs.append({"ref_id":p.id,"framework":fwn.get(p.uploaded_framework_id,'?'),"fwid":p.uploaded_framework_id,
                           "code":p.original_reference or '',"name":(p.title or '')[:200],"text":(p.description or p.full_text or '')[:300]})
    defs.append({"nc_id":nc.id,"name":nc.name,"refs":refs})
print(f"grading {len(defs)} clusters...", flush=True)

# STEP 1 grade all (sample up to 12 members shown per cluster)
JUDGE="Strict GRC auditor. Grade a unified control GOOD if MOST members impose the same core requirement, MIXED if a sizable minority are off-topic, BAD if it is a catch-all of unrelated requirements."
def gp(b):
    return ("Grade each GOOD/MIXED/BAD.\n\n"+"\n\n".join(
        f"N{ci}: \"{d['name']}\"\n"+"\n".join(f"  ({m['framework'][:8]} {m['code']}) {m['name'][:30]}" for m in d['refs'][:12])
        for ci,d in enumerate(b))+'\n\nJSON {"grades":[{"n":0,"verdict":"GOOD"}]}')
grade={}
for s in range(0,len(defs),6):
    b=defs[s:s+6]
    r=client.chat.completions.create(model=M,messages=[{"role":"system","content":JUDGE},{"role":"user","content":gp(b)}],response_format={"type":"json_object"},temperature=0)
    for g in json.loads(r.choices[0].message.content or "{}").get("grades",[]):
        try: grade[s+int(g["n"])]=(g.get("verdict") or "?").upper()
        except: pass
from collections import Counter
gc=Counter(grade.values())
print(f"  grades: {dict(gc)}", flush=True)
suspect=[i for i in range(len(defs)) if grade.get(i) in ("MIXED","BAD")]
print(f"  re-verifying members of {len(suspect)} MIXED/BAD clusters...", flush=True)

# STEP 2 member-verify suspect clusters
sus_defs=[{"name":defs[i]["name"],"statement":"","refs":defs[i]["refs"],"_i":i} for i in suspect]
verified=N._verify_clusters(client,"cleanup",sus_defs)
kept_by_i={d["_i"]:{r["ref_id"] for r in d["refs"]} for d in verified}

# STEP 3 apply: drop mis-mapped links; delete collapsed clusters
deleted=0; trimmed=0; changed_ncids=[]
for i in suspect:
    d=defs[i]; ncid=d["nc_id"]
    kept=kept_by_i.get(i)            # None => cluster collapsed (<2 fw) => delete
    if kept is None:
        for sql in [f'DELETE FROM grc_evidence_control_mappings WHERE normalized_control_id={ncid}',
                    f'DELETE FROM grc_ai_evidence_recommendations WHERE normalized_control_id={ncid}',
                    f'DELETE FROM grc_common_control_group_mappings WHERE normalized_control_id={ncid}',
                    f'DELETE FROM grc_normalized_control_links WHERE normalized_control_id={ncid}',
                    f'DELETE FROM grc_normalized_controls WHERE id={ncid}']:
            db.execute(sqltext(sql))
        deleted+=1; continue
    drop=[m["ref_id"] for m in d["refs"] if m["ref_id"] not in kept]
    if drop:
        db.execute(sqltext(f"DELETE FROM grc_normalized_control_links WHERE normalized_control_id={ncid} AND parsed_control_id IN ({','.join(str(x) for x in drop)})"))
        db.execute(sqltext(f"UPDATE grc_normalized_controls SET recommended_evidence=NULL WHERE id={ncid}"))
        trimmed+=1; changed_ncids.append(ncid)
db.commit()
print(f"  deleted {deleted} collapsed clusters, trimmed members on {trimmed}", flush=True)

# STEP 4 re-consolidate evidence for changed (now-NULL) clusters
done=N._precompute_nc_evidence(db, client, run_id=RUN)
n=db.query(NormalizedControl).filter(NormalizedControl.run_id==RUN).count()
import psycopg2
cn=psycopg2.connect(base+'/grc_complyverse');cc=cn.cursor()
cc.execute(f"SELECT count(DISTINCT parsed_control_id) FROM grc_normalized_control_links l JOIN grc_normalized_controls nc ON nc.id=l.normalized_control_id WHERE nc.run_id={RUN}");cov=cc.fetchone()[0]
cc.execute("SELECT count(*) FROM grc_parsed_framework_controls");tot=cc.fetchone()[0]
cc.execute(f"SELECT count(*) FROM grc_normalized_controls WHERE run_id={RUN} AND recommended_evidence IS NOT NULL");ev=cc.fetchone()[0]
cn.close()
run=db.query(NormalizationRun).filter(NormalizationRun.id==RUN).first()
run.summary={**(run.summary or {}),"unified_controls":n,"controls_covered":cov,"evidence_consolidated":ev};db.commit()
print(f"CLEANUPDONE controls={n} coverage={cov}/{tot} ({100*cov//tot}%) evidence={ev}/{n}", flush=True)
db.close()
