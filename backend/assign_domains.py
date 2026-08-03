"""Assign each unified control a top-level DOMAIN so the library nests
Domain -> Unified control -> Framework controls. AI sees all 126 names at once
and maps each to ONE fixed domain (no drift)."""
import os, json
from dotenv import load_dotenv; load_dotenv(".env")
from sqlalchemy import create_engine, text as sqltext
from sqlalchemy.orm import sessionmaker
base=os.environ["POSTGRES_ADMIN_URL"].rsplit("/",1)[0]
db=sessionmaker(bind=create_engine(base+"/grc_complyverse"))()
from grc.models import NormalizedControl, CommonControlGroup
from grc.modules.control_library.routers.groups import get_openai_client
from grc.config import get_openai_model
client=get_openai_client(); M=get_openai_model()
RUN=15
DOMAINS=[
 "Governance, Risk & Compliance","Access Control & Identity Management","Asset Management",
 "Cryptography & Key Management","Network Security","Application & Software Security",
 "Data Protection & Privacy","Logging, Monitoring & Detection","Incident Management",
 "Business Continuity & Resilience","Physical & Environmental Security","Human Resources Security",
 "Third-Party & Supply Chain Risk","Audit & Assurance","Configuration & Change Management",
 "Vulnerability & Threat Management","Cloud & Outsourcing Security","Awareness & Training",
]
ncs=db.query(NormalizedControl).filter(NormalizedControl.run_id==RUN).order_by(NormalizedControl.code).all()
names=[nc.name for nc in ncs]
SYS="You are a GRC taxonomist. Assign each unified control to EXACTLY ONE domain from the fixed list (copy the domain name verbatim)."
prompt=("Assign each control below to ONE domain from this fixed list:\n"+"\n".join(f"- {d}" for d in DOMAINS)+
 "\n\nControls:\n"+"\n".join(f"[{i}] {n}" for i,n in enumerate(names))+
 '\n\nRespond ONLY JSON: {"assign":[{"i":0,"domain":"..."}]}')
import re
canon={re.sub(r"[^a-z0-9]+"," ",d.lower()).strip():d for d in DOMAINS}
r=client.chat.completions.create(model=M,messages=[{"role":"system","content":SYS},{"role":"user","content":prompt}],response_format={"type":"json_object"},temperature=0)
assign={}
for a in json.loads(r.choices[0].message.content or "{}").get("assign",[]):
    try:
        i=int(a["i"]); d=canon.get(re.sub(r"[^a-z0-9]+"," ",(a.get("domain") or "").lower()).strip())
        if d and 0<=i<len(names): assign[i]=d
    except: pass
from collections import Counter
cnt=Counter()
for i,nc in enumerate(ncs):
    dom=assign.get(i,"Governance, Risk & Compliance")
    nc.domain=dom
    grp=db.query(CommonControlGroup).filter(CommonControlGroup.run_id==RUN, CommonControlGroup.name==nc.name).first()
    if grp: grp.domain=dom; grp.category=dom
    cnt[dom]+=1
db.commit()
print(f"assigned domains to {len(ncs)} controls across {len(cnt)} domains:")
for d,c in cnt.most_common(): print(f"  {c:3d}  {d}")
print("DOMAINSDONE")
db.close()
