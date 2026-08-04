"""Phase-0 pilot: split the worst over-consolidated unified controls into tight
sub-controls. AI sees ALL members of a bucket at once (no embeddings). DISPLAY ONLY
— commits nothing."""
import os, json
from dotenv import load_dotenv; load_dotenv(".env")
from sqlalchemy import create_engine, text as sqltext
from sqlalchemy.orm import sessionmaker
base=os.environ["POSTGRES_ADMIN_URL"].rsplit("/",1)[0]
db=sessionmaker(bind=create_engine(base+"/grc_complyverse"))()
from grc.models import NormalizedControl, NormalizedControlLink, ParsedFrameworkControl, UploadedFramework
from grc.modules.control_library.routers.groups import get_openai_client
from grc.config import get_openai_model
client=get_openai_client(); M=get_openai_model()
RUN=15
fwn={f.id:f.name for f in db.query(UploadedFramework).all()}
TARGETS=["Audit Logging","Access Control Policy Management","Data Transfer Compliance"]

SYS=("You are a GRC taxonomist FIXING an over-broad unified control. It wrongly lumps many "
 "DIFFERENT requirements together. Split its members into SPECIFIC unified controls, each "
 "grouping ONLY members that impose the SAME specific obligation.")
def split_prompt(bucket, mems):
    lines=[f"[{i}] ({m['fw'][:10]} {m['code']}) {m['name'][:60]} :: {m['text'][:90]}" for i,m in enumerate(mems)]
    return ("Bucket: \""+bucket+"\" currently lumps these "+str(len(mems))+" controls.\n\n"
     "Split into SPECIFIC unified controls. RULES:\n"
     "- One specific obligation each (action + object + qualifier). e.g. 'Audit Log Retention', "
     "not 'Audit Logging'.\n"
     "- KEEP SEPARATE: distinct requirements (e.g. GDPR adequacy vs safeguards vs derogations are "
     "3 controls), lifecycle stages, policy vs operation.\n"
     "- Each sub-control should ideally span >=2 frameworks. Members that are truly unique go in "
     "'standalone'.\n\nControls:\n"+"\n".join(lines)+
     '\n\nJSON: {"controls":[{"name":"...","members":[0,1]}],"standalone":[9]}')

for bucket in TARGETS:
    nc=db.query(NormalizedControl).filter(NormalizedControl.run_id==RUN, NormalizedControl.name==bucket).first()
    if not nc:
        print(f"\n### {bucket}: NOT FOUND"); continue
    mems=[]
    for ln in db.query(NormalizedControlLink).filter(NormalizedControlLink.normalized_control_id==nc.id).all():
        p=db.query(ParsedFrameworkControl).filter(ParsedFrameworkControl.id==ln.parsed_control_id).first()
        if p: mems.append({"fw":fwn.get(p.uploaded_framework_id,'?'),"code":p.original_reference or '',
                           "name":p.title or '',"text":(p.description or p.full_text or '')})
    r=client.chat.completions.create(model=M,messages=[{"role":"system","content":SYS},{"role":"user","content":split_prompt(bucket,mems)}],response_format={"type":"json_object"},temperature=0)
    data=json.loads(r.choices[0].message.content or "{}")
    subs=data.get("controls",[]); stand=data.get("standalone",[])
    print(f"\n{'='*70}\nBEFORE: 1 control '{bucket}' with {len(mems)} members")
    print(f"AFTER: {len(subs)} tight controls + {len(stand)} standalone")
    for s in subs:
        idxs=[i for i in s.get("members",[]) if 0<=i<len(mems)]
        fws=sorted({mems[i]['fw'][:8] for i in idxs})
        print(f"  • {s.get('name','?')}  ({len(idxs)} members / {len(fws)} frameworks)")
        for i in idxs[:4]: print(f"       - {mems[i]['fw'][:10]} {mems[i]['code']} {mems[i]['name'][:42]}")
        if len(idxs)>4: print(f"       … +{len(idxs)-4} more")
    if stand: print(f"  [standalone: {len(stand)} single-framework controls]")
print("\nPILOTDONE")
db.close()
