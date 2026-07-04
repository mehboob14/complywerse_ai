"""Phase A — fine-grained split of every over-consolidated unified control (>8
members). AI sees ALL members of a bucket at once. Each member assigned to exactly
ONE sub-control; concise specific names. Cached to /tmp/splits.json (resumable)."""
import os, json
from dotenv import load_dotenv; load_dotenv(".env")
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
base=os.environ["POSTGRES_ADMIN_URL"].rsplit("/",1)[0]
db=sessionmaker(bind=create_engine(base+"/grc_complyverse"))()
from grc.models import NormalizedControl, NormalizedControlLink, ParsedFrameworkControl, UploadedFramework
from grc.modules.control_library.routers.groups import get_openai_client
from grc.config import get_openai_model
client=get_openai_client(); M=get_openai_model()
RUN=15; THRESH=8
fwn={f.id:f.name for f in db.query(UploadedFramework).all()}
CACHE="/tmp/splits.json"
splits=json.load(open(CACHE)) if os.path.exists(CACHE) else {}

SYS=("You are a GRC taxonomist fixing an over-broad unified control that lumps DIFFERENT "
 "requirements together. Split its members into SPECIFIC unified controls — each groups ONLY "
 "members imposing the SAME specific obligation.")
def split_prompt(bucket, mems):
    lines=[f"[{i}] ({m['fw'][:10]} {m['code']}) {m['name'][:60]} :: {m['text'][:80]}" for i,m in enumerate(mems)]
    return ("Over-broad control \""+bucket+"\" lumps these "+str(len(mems))+" controls. Split into "
     "SPECIFIC unified controls.\nRULES:\n"
     "- One specific obligation each. CONCISE name (3-6 words), NO 'X for Y' verbosity.\n"
     "- KEEP SEPARATE distinct requirements (e.g. transfer adequacy vs safeguards vs derogations), "
     "lifecycle stages, policy vs operation.\n"
     "- Assign EACH member to EXACTLY ONE sub-control (no member in two).\n"
     "- Cover ALL members.\n\nControls:\n"+"\n".join(lines)+
     '\n\nJSON: {"controls":[{"name":"...","members":[0,1]}]}')

ncs=db.query(NormalizedControl).filter(NormalizedControl.run_id==RUN).order_by(NormalizedControl.code).all()
print(f"{len(ncs)} broad controls; splitting those with >{THRESH} members", flush=True)
done=0
for nc in ncs:
    if nc.name in splits: continue
    mems=[]
    for ln in db.query(NormalizedControlLink).filter(NormalizedControlLink.normalized_control_id==nc.id).all():
        p=db.query(ParsedFrameworkControl).filter(ParsedFrameworkControl.id==ln.parsed_control_id).first()
        if p: mems.append({"ref_id":p.id,"fw":fwn.get(p.uploaded_framework_id,'?'),"fwid":p.uploaded_framework_id,
                           "code":p.original_reference or '',"name":p.title or '',"text":(p.description or p.full_text or '')[:200]})
    rec={"domain":nc.domain,"members":mems}
    if len(mems)<=THRESH:
        rec["subs"]=[{"name":nc.name,"members":list(range(len(mems)))}]   # already tight, keep
    else:
        try:
            r=client.chat.completions.create(model=M,messages=[{"role":"system","content":SYS},{"role":"user","content":split_prompt(nc.name,mems)}],response_format={"type":"json_object"},temperature=0)
            subs=json.loads(r.choices[0].message.content or "{}").get("controls",[])
            # enforce 1-per-member: first claim wins; unclaimed -> own bucket later
            seen=set(); clean=[]
            for s in subs:
                idxs=[i for i in s.get("members",[]) if isinstance(i,int) and 0<=i<len(mems) and i not in seen]
                for i in idxs: seen.add(i)
                if idxs: clean.append({"name":(s.get("name") or "").strip()[:120] or nc.name,"members":idxs})
            unclaimed=[i for i in range(len(mems)) if i not in seen]
            if unclaimed: clean.append({"name":nc.name,"members":unclaimed})
            rec["subs"]=clean
        except Exception as e:
            print("  split error",nc.name,e,flush=True); rec["subs"]=[{"name":nc.name,"members":list(range(len(mems)))}]
    splits[nc.name]=rec; done+=1
    if done%10==0:
        json.dump(splits,open(CACHE,"w")); print(f"  split {done} buckets…",flush=True)
json.dump(splits,open(CACHE,"w"))
tot_sub=sum(len(v["subs"]) for v in splits.values())
print(f"SPLITALLDONE {len(splits)} buckets -> {tot_sub} sub-controls (cached)", flush=True)
db.close()
