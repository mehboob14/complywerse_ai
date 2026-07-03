"""Robust global regeneration (no chunked clustering).
 Phase A  discover candidate families in batches (accumulating, reuse existing).
 Phase B  ONE global MERGE call: consolidate ALL candidate families -> ~400 canonical
          SPECIFIC families (this is the global step — every family name seen at once,
          synonyms across the whole corpus collapsed).
 Phase C  classify every control against that FIXED canonical list (full list in every
          call -> no chunk boundary can separate equivalents).
 Group by family -> unified(>=2 fw)/standalone, into a NEW run. Baseline #18 untouched.
"""
import os, re, json, time
from collections import defaultdict, Counter
from dotenv import load_dotenv; load_dotenv(".env")
from sqlalchemy import create_engine, text as sqltext
from sqlalchemy.orm import sessionmaker
from openai import OpenAI
base=os.environ["POSTGRES_ADMIN_URL"].rsplit("/",1)[0]
db=sessionmaker(bind=create_engine(base+"/grc_complyverse"))()
from grc.models import (NormalizedControl, NormalizedControlLink, CommonControlGroup,
                        CommonControlGroupMapping, ParsedFrameworkControl, UploadedFramework, NormalizationRun)
MODEL="gpt-4o"
client=OpenAI(api_key=os.environ["OPENAI_API_KEY"], timeout=180.0, max_retries=2)
BASE=18

def ai_json(sys, user, timeout=180):
    for attempt in range(3):
        try:
            r=client.chat.completions.create(model=MODEL, temperature=0, timeout=timeout,
                messages=[{"role":"system","content":sys},{"role":"user","content":user}],
                response_format={"type":"json_object"})
            return json.loads(r.choices[0].message.content or "{}")
        except Exception as e:
            print(f"    ai retry {attempt+1}: {repr(e)[:90]}", flush=True); time.sleep(3)
    return {}

fwn={f.id:f.name for f in db.query(UploadedFramework).all()}
bg=[g.id for g in db.query(CommonControlGroup).filter(CommonControlGroup.run_id==BASE).all()]
gid_dom={g.id:(g.domain or g.name or "Other / Uncategorized") for g in db.query(CommonControlGroup).filter(CommonControlGroup.run_id==BASE).all()}
pid_domain={}
for m in db.query(CommonControlGroupMapping).filter(CommonControlGroupMapping.parsed_control_id.isnot(None),
                                                    CommonControlGroupMapping.group_id.in_(bg)).all():
    pid_domain.setdefault(m.parsed_control_id, gid_dom.get(m.group_id,"Other / Uncategorized"))
parsed=db.query(ParsedFrameworkControl).all()
members=[{"ref_id":p.id,"fwid":p.uploaded_framework_id,"framework":fwn.get(p.uploaded_framework_id,"?"),
          "name":(p.title or "")[:140],"text":(p.description or p.full_text or "")[:140]} for p in parsed]
# interleave by framework so families form evenly
byf=defaultdict(list)
for m in members: byf[m["fwid"]].append(m)
inter=[]; i=0
while any(byf.values()):
    for fid in list(byf):
        if byf[fid]: inter.append(byf[fid].pop(0))
members=inter
print(f"loaded {len(members)} controls / {len({m['fwid'] for m in members})} frameworks", flush=True)

# ---- Phase A: discover candidate families ----
SYSA=("You are a GRC taxonomist. Extract canonical SPECIFIC control-family names from these "
      "controls (e.g. 'Privileged Access Management','Data Encryption at Rest','Change Management'). "
      "Reuse an existing family verbatim when one fits; only add genuinely new specific families.")
fams={}  # canon-> display
B=70
for s in range(0,len(members),B):
    batch=members[s:s+B]
    existing=("\nExisting families (reuse verbatim when fitting):\n"+"\n".join(sorted(fams.values())[:400])) if fams else ""
    lines="\n".join(f"({m['framework'][:16]}) {m['name']}: {m['text'][:90]}" for m in batch)
    d=ai_json(SYSA, "Controls:\n"+lines+existing+'\n\nJSON: {"families":["..."]}')
    for f in d.get("families",[]) or []:
        f=(f or "").strip()
        if f: fams.setdefault(re.sub(r"[^a-z0-9]+"," ",f.lower()).strip(), f)
    if (s//B)%10==0: print(f"  phaseA {s+len(batch)}/{len(members)} controls, {len(fams)} families", flush=True)
raw=sorted(fams.values())
print(f"Phase A: {len(raw)} candidate families", flush=True)

# ---- Phase B: GLOBAL merge -> canonical specific families ----
SYSB=("You are a GRC taxonomist. Consolidate this candidate control-family list by merging "
      "SYNONYMS and near-duplicates that mean the SAME specific requirement into ONE canonical "
      "family. Keep families SPECIFIC (do NOT collapse different requirements into a broad domain). "
      "Return the final canonical list.")
canon=[]
for s in range(0,len(raw),900):   # merge in big passes if huge, accumulating
    chunk=raw[s:s+900]
    d=ai_json(SYSB, "Candidate families"+(" (plus already-canonical below, reuse them)" if canon else "")+":\n"+
              "\n".join(chunk)+("\n\nAlready canonical:\n"+"\n".join(canon) if canon else "")+
              '\n\nJSON: {"families":["..."]}', timeout=240)
    got=[f.strip() for f in d.get("families",[]) if f and f.strip()]
    # keep union (merge passes refine)
    seen={re.sub(r"[^a-z0-9]+"," ",c.lower()).strip() for c in canon}
    for f in got:
        k=re.sub(r"[^a-z0-9]+"," ",f.lower()).strip()
        if k not in seen: seen.add(k); canon.append(f)
print(f"Phase B: {len(canon)} canonical families", flush=True)

# ---- Phase C: classify each control against the FIXED canonical list ----
SYSC="You assign each control to EXACTLY ONE family from the fixed list (verbatim), or NONE."
taxblock="\n".join(f"- {c}" for c in canon)
canon_key={re.sub(r'[^a-z0-9]+',' ',c.lower()).strip():c for c in canon}
tags=[None]*len(members)
for s in range(0,len(members),B):
    batch=members[s:s+B]
    lines="\n".join(f"[{i}] ({m['framework'][:16]}) {m['name']}: {m['text'][:90]}" for i,m in enumerate(batch))
    d=ai_json(SYSC, "FAMILIES:\n"+taxblock+"\n\nControls:\n"+lines+'\n\nJSON: {"tags":[{"i":0,"family":"..."}]}')
    for t in d.get("tags",[]) or []:
        try: i=int(t.get("i"))
        except: continue
        f=(t.get("family") or "").strip()
        if not f or f.upper()=="NONE" or not(0<=i<len(batch)): continue
        tags[s+i]=canon_key.get(re.sub(r'[^a-z0-9]+',' ',f.lower()).strip(), f)
print(f"Phase C: tagged {sum(1 for t in tags if t)}/{len(members)}", flush=True)

fam=defaultdict(list)
for m,t in zip(members,tags):
    if t: fam[t].append(m)
uni=[(f,ms) for f,ms in fam.items() if len({m['fwid'] for m in ms})>=2]
print(f"unified families (>=2 fw): {len(uni)}", flush=True)

# ---- build new run (UNIQUE group codes) ----
run=NormalizationRun(tenant_id=1, label="Regenerated v2 — global merge (gpt-4o)", scope="full",
                     is_baseline=False, status="running"); db.add(run); db.flush(); RUN=run.id
groups={}
def group_for(dom):
    dom=dom or "Other / Uncategorized"
    if dom not in groups:
        g=CommonControlGroup(tenant_id=1, run_id=RUN, code=f"RDOM-{RUN}-{len(groups)+1:02d}", name=dom, domain=dom, category=dom)
        db.add(g); db.flush(); groups[dom]=g.id
    return groups[dom]
claimed=set(); seq=0; n_uni=0; n_std=0
for family,ms in uni:
    dom=Counter(pid_domain.get(m["ref_id"],"Other / Uncategorized") for m in ms).most_common(1)[0][0]
    gid=group_for(dom); seq+=1; n_uni+=1
    nc=NormalizedControl(code=f"NCS{RUN}-{seq:04d}", name=family[:250], source="ai_normalized",
                         run_id=RUN, domain=dom, maturity_level=0, review_status="pending"); db.add(nc); db.flush()
    db.add(CommonControlGroupMapping(group_id=gid, normalized_control_id=nc.id, mapping_source="domain", mapping_confidence=1.0))
    for m in ms:
        db.add(NormalizedControlLink(normalized_control_id=nc.id, parsed_control_id=m["ref_id"], mapping_type="direct"))
        db.add(CommonControlGroupMapping(group_id=gid, parsed_control_id=m["ref_id"], mapping_source="domain", mapping_confidence=1.0))
        claimed.add(m["ref_id"])
for m in members:
    if m["ref_id"] in claimed: continue
    gid=group_for(pid_domain.get(m["ref_id"],"Other / Uncategorized"))
    db.add(CommonControlGroupMapping(group_id=gid, parsed_control_id=m["ref_id"], mapping_source="standalone", mapping_confidence=1.0)); n_std+=1
run.status="completed"; run.summary={"unified_controls":n_uni,"standalone":n_std,"domains":len(groups)}; db.commit()
print(f"BUILT run #{RUN}: {n_uni} unified · {n_std} standalone · {len(groups)} domains", flush=True)

def span(rid):
    fc=[r[0] for r in db.execute(sqltext(f'''SELECT count(DISTINCT p.uploaded_framework_id) FROM grc_normalized_control_links l
      JOIN grc_normalized_controls nc ON nc.id=l.normalized_control_id JOIN grc_parsed_framework_controls p ON p.id=l.parsed_control_id
      WHERE nc.run_id={rid} GROUP BY nc.id''')).fetchall()]
    c=Counter(fc); return (len(fc), round(sum(fc)/len(fc),2) if fc else 0, max(fc) if fc else 0, c[2], sum(v for k,v in c.items() if k>=6))
viol=db.execute(sqltext(f"SELECT count(*) FROM (SELECT nc.id FROM grc_normalized_controls nc JOIN grc_normalized_control_links l ON l.normalized_control_id=nc.id JOIN grc_parsed_framework_controls p ON p.id=l.parsed_control_id WHERE nc.run_id={RUN} GROUP BY nc.id HAVING count(DISTINCT p.uploaded_framework_id)<2) x")).scalar()
over=db.execute(sqltext(f"SELECT count(*) FROM (SELECT nc.id FROM grc_normalized_controls nc JOIN grc_normalized_control_links l ON l.normalized_control_id=nc.id JOIN grc_parsed_framework_controls p ON p.id=l.parsed_control_id WHERE nc.run_id={RUN} GROUP BY nc.id, p.uploaded_framework_id HAVING count(*)>=20) x")).scalar()
inlib=db.execute(sqltext(f"SELECT count(DISTINCT parsed_control_id) FROM grc_common_control_group_mappings WHERE parsed_control_id IS NOT NULL AND group_id IN (SELECT id FROM grc_common_control_groups WHERE run_id={RUN})")).scalar()
nu,na,nm,n2,n6=span(RUN); bu,ba,bm,b2,b6=span(BASE)
print("\n========= COMPARISON =========", flush=True)
print(f"  LIVE #18 : {bu} unified | avg {ba} | max {bm} | 2fw={b2} | 6+fw={b6}", flush=True)
print(f"  NEW  #{RUN} : {nu} unified | avg {na} | max {nm} | 2fw={n2} | 6+fw={n6}", flush=True)
print(f"  NEW integrity: <2fw violations={viol} (must=0) | over-consol(>=20/1fw)={over} | coverage {inlib}/{len(members)}", flush=True)
print(f"NEW run #{RUN} built, NOT promoted.", flush=True)
print("REGENV2DONE", flush=True)
db.close()
