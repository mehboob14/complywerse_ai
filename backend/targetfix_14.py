"""Delete only the genuine catch-all masters from run #14 (consensus BAD over 2
grading passes). Keep all good high-recall clusters intact."""
import os, json
from dotenv import load_dotenv; load_dotenv(".env")
from sqlalchemy import create_engine, text as sqltext
from sqlalchemy.orm import sessionmaker
base=os.environ["POSTGRES_ADMIN_URL"].rsplit("/",1)[0]
db=sessionmaker(bind=create_engine(base+"/grc_complyverse"))()
from grc.models import NormalizedControl, NormalizedControlLink, ParsedFrameworkControl, UploadedFramework, NormalizationRun
from grc.modules.control_library.routers.groups import get_openai_client
from grc.config import get_openai_model
client=get_openai_client(); M=get_openai_model()
fwn={f.id:f.name for f in db.query(UploadedFramework).all()}
RUN=db.query(NormalizationRun).order_by(NormalizationRun.id.desc()).first().id
ncs=db.query(NormalizedControl).filter(NormalizedControl.run_id==RUN).all()
defs=[]
for nc in ncs:
    refs=[]
    for ln in db.query(NormalizedControlLink).filter(NormalizedControlLink.normalized_control_id==nc.id).limit(12).all():
        p=db.query(ParsedFrameworkControl).filter(ParsedFrameworkControl.id==ln.parsed_control_id).first()
        if p: refs.append({"fw":fwn.get(p.uploaded_framework_id,'?'),"code":p.original_reference or '',"name":p.title or ''})
    defs.append({"nc_id":nc.id,"name":nc.name,"refs":refs})
JUDGE=("Strict GRC auditor detecting CATCH-ALL buckets. Grade BAD ONLY if the unified "
 "control lumps together clearly UNRELATED requirements (no single dominant obligation). "
 "Grade GOOD if most members share one core requirement. MIXED if a minority are off-topic.")
def gp(b): return ("Grade each GOOD/MIXED/BAD.\n\n"+"\n\n".join(f"N{ci}: \"{d['name']}\"\n"+"\n".join(f"  ({m['fw'][:8]} {m['code']}) {m['name'][:28]}" for m in d['refs']) for ci,d in enumerate(b))+'\n\nJSON {"grades":[{"n":0,"verdict":"GOOD"}]}')
def grade_all():
    g={}
    for s in range(0,len(defs),6):
        r=client.chat.completions.create(model=M,messages=[{"role":"system","content":JUDGE},{"role":"user","content":gp(defs[s:s+6])}],response_format={"type":"json_object"},temperature=0)
        for x in json.loads(r.choices[0].message.content or "{}").get("grades",[]):
            try: g[s+int(x["n"])]=(x.get("verdict") or "?").upper()
            except: pass
    return g
g1=grade_all(); g2=grade_all()
bad=[i for i in range(len(defs)) if g1.get(i)=="BAD" and g2.get(i)=="BAD"]
print(f"consensus-BAD catch-all masters: {len(bad)}", flush=True)
for i in bad: print("   DELETE:", defs[i]["name"], flush=True)
for i in bad:
    ncid=defs[i]["nc_id"]
    for sql in [f'DELETE FROM grc_evidence_control_mappings WHERE normalized_control_id={ncid}',
                f'DELETE FROM grc_ai_evidence_recommendations WHERE normalized_control_id={ncid}',
                f'DELETE FROM grc_common_control_group_mappings WHERE normalized_control_id={ncid}',
                f'DELETE FROM grc_normalized_control_links WHERE normalized_control_id={ncid}',
                f'DELETE FROM grc_normalized_controls WHERE id={ncid}']:
        db.execute(sqltext(sql))
db.commit()
import psycopg2
cn=psycopg2.connect(base+'/grc_complyverse');c=cn.cursor()
c.execute(f"SELECT count(*) FROM grc_normalized_controls WHERE run_id={RUN}");n=c.fetchone()[0]
c.execute(f"SELECT count(DISTINCT parsed_control_id) FROM grc_normalized_control_links l JOIN grc_normalized_controls nc ON nc.id=l.normalized_control_id WHERE nc.run_id={RUN}");cov=c.fetchone()[0]
cn.close()
print(f"TARGETDONE controls={n} coverage={cov}/3419 ({100*cov//3419}%)", flush=True)
db.close()
