"""Semantic fragment-merge: merge unified controls that are the SAME requirement
but got split apart by tagging drift. Pure AI. Tests on run #6 in-place."""
import os, json
from dotenv import load_dotenv; load_dotenv(".env")
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
base=os.environ["POSTGRES_ADMIN_URL"].rsplit("/",1)[0]
db=sessionmaker(bind=create_engine(base+"/grc_complyverse"))()
from grc.models import NormalizedControl, NormalizedControlLink, ParsedFrameworkControl, UploadedFramework, CommonControlGroupMapping
from grc.modules.control_library.routers.groups import get_openai_client
from grc.config import get_openai_model
client=get_openai_client()
fwn={f.id:f.name for f in db.query(UploadedFramework).all()}
RUN=6

ncs=db.query(NormalizedControl).filter(NormalizedControl.source=='ai_normalized', NormalizedControl.run_id==RUN).order_by(NormalizedControl.id).all()
items=[]
for nc in ncs:
    fws=set()
    for ln in db.query(NormalizedControlLink).filter(NormalizedControlLink.normalized_control_id==nc.id).all():
        p=db.query(ParsedFrameworkControl).filter(ParsedFrameworkControl.id==ln.parsed_control_id).first()
        if p: fws.add(fwn.get(p.uploaded_framework_id,'?'))
    items.append({"id":nc.id,"name":nc.name,"stmt":(nc.statement or '')[:100],"fws":sorted(fws)})

print(f"BEFORE: {len(items)} unified controls")

SYS=("You merge fragmented unified controls. Some entries below are the SAME core "
 "requirement split apart (e.g. 'Audit Logging' vs 'Audit Record Management'). "
 "Cluster them. CRITICAL: keep genuinely different requirements separate — "
 "different lifecycle stages (incident DETECTION vs RESPONSE vs RECOVERY; access "
 "GRANT vs REVOKE), and policy vs operation, are NOT the same and must NOT merge.")
def prompt(b):
    lines=[f"[{i}] {it['name']} — {it['stmt']}" for i,it in enumerate(b)]
    return ("Cluster these unified controls. Each cluster = entries that are the SAME "
      "requirement. Singletons map to themselves. Return ONLY clusters with >1 member.\n\n"
      +"\n".join(lines)+'\n\nJSON: {"clusters":[{"name":"best name","members":[0,5,9]}]}')
resp=client.chat.completions.create(model=get_openai_model(),messages=[{"role":"system","content":SYS},{"role":"user","content":prompt(items)}],response_format={"type":"json_object"},temperature=0.0)
data=json.loads(resp.choices[0].message.content or "{}")

merged=0
for cl in data.get("clusters",[]) or []:
    idxs=[int(x) for x in cl.get("members",[]) if isinstance(x,int) or str(x).isdigit()]
    idxs=[i for i in idxs if 0<=i<len(items)]
    if len(idxs)<2: continue
    primary=items[idxs[0]]["id"]
    # collect frameworks already on primary
    seen={}
    for ln in db.query(NormalizedControlLink).filter(NormalizedControlLink.normalized_control_id==primary).all():
        p=db.query(ParsedFrameworkControl).filter(ParsedFrameworkControl.id==ln.parsed_control_id).first()
        if p: seen[p.uploaded_framework_id]=True
    # move links from others, keep <=1 per framework
    for j in idxs[1:]:
        dup=items[j]["id"]
        for ln in db.query(NormalizedControlLink).filter(NormalizedControlLink.normalized_control_id==dup).all():
            p=db.query(ParsedFrameworkControl).filter(ParsedFrameworkControl.id==ln.parsed_control_id).first()
            if p and p.uploaded_framework_id not in seen:
                seen[p.uploaded_framework_id]=True
                ln.normalized_control_id=primary
            else:
                db.delete(ln)
        db.query(CommonControlGroupMapping).filter(CommonControlGroupMapping.normalized_control_id==dup).delete(synchronize_session=False)
        db.query(NormalizedControl).filter(NormalizedControl.id==dup).delete(synchronize_session=False)
        merged+=1
    # rename primary to the cluster's best name
    nm=(cl.get("name") or "").strip()
    if nm: db.query(NormalizedControl).filter(NormalizedControl.id==primary).update({"name":nm[:255]})
db.commit()

rem=db.query(NormalizedControl).filter(NormalizedControl.source=='ai_normalized', NormalizedControl.run_id==RUN).all()
spans=[]
for nc in rem:
    fws=set()
    for ln in db.query(NormalizedControlLink).filter(NormalizedControlLink.normalized_control_id==nc.id).all():
        p=db.query(ParsedFrameworkControl).filter(ParsedFrameworkControl.id==ln.parsed_control_id).first()
        if p: fws.add(p.uploaded_framework_id)
    spans.append(len(fws))
print(f"\nAFTER fragment-merge: {len(rem)} unified controls (merged away {merged})")
print(f"  avg framework span: {round(sum(spans)/max(1,len(spans)),1)} (was 3.2), max {max(spans)}")
print("\nwidest after merge:")
for nc,sp in sorted(zip(rem,spans),key=lambda x:-x[1])[:8]:
    print(f"   • {nc.name[:42]:42} {sp} frameworks")
db.close()
