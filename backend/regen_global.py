"""Regenerate the unified library with a GLOBAL view — no chunked clustering.

Phase 1 (the grouping schema): ONE call feeds the AI ALL 3,419 control names at once
(gpt-4o, 128K ctx) -> a single canonical control-family list. Because every control is
visible together, equivalents across frameworks are recognised as one family.
Phase 2: each control is tagged against that FIXED global family list (the full list is
in every call, so no chunk boundary can separate equivalents).
Group by family -> unified (>=2 frameworks) / standalone, into a NEW run. The live
baseline (#18) is NOT touched; compare, then swap only if better.
"""
import os, re, json
from collections import defaultdict, Counter
from dotenv import load_dotenv; load_dotenv(".env")
os.environ["OPENAI_MODEL"] = "gpt-4o"
os.environ["AI_INTEGRATIONS_OPENAI_MODEL"] = "gpt-4o"
from sqlalchemy import create_engine, text as sqltext
from sqlalchemy.orm import sessionmaker
base=os.environ["POSTGRES_ADMIN_URL"].rsplit("/",1)[0]
db=sessionmaker(bind=create_engine(base+"/grc_complyverse"))()
from grc.models import (NormalizedControl, NormalizedControlLink, CommonControlGroup,
                        CommonControlGroupMapping, ParsedFrameworkControl, UploadedFramework, NormalizationRun)
from grc.modules.control_library.services import normalization as N
from grc.modules.control_library.routers.groups import get_openai_client
client=get_openai_client()
N._TAG_BATCH = 120
BASE=18

fwn={f.id:f.name for f in db.query(UploadedFramework).all()}
bg=[g.id for g in db.query(CommonControlGroup).filter(CommonControlGroup.run_id==BASE).all()]
gid_dom={g.id:(g.domain or g.name or "Other / Uncategorized") for g in db.query(CommonControlGroup).filter(CommonControlGroup.run_id==BASE).all()}
pid_domain={}
for m in db.query(CommonControlGroupMapping).filter(CommonControlGroupMapping.parsed_control_id.isnot(None),
                                                    CommonControlGroupMapping.group_id.in_(bg)).all():
    pid_domain.setdefault(m.parsed_control_id, gid_dom.get(m.group_id, "Other / Uncategorized"))

parsed=db.query(ParsedFrameworkControl).all()
members=[{"ref_id":p.id,"fwid":p.uploaded_framework_id,"framework":fwn.get(p.uploaded_framework_id,"?"),
          "name":(p.title or "")[:160],"text":(p.description or p.full_text or "")[:200]} for p in parsed]
members=N._interleave_by_framework(members)
print(f"loaded {len(members)} controls across {len({m['fwid'] for m in members})} frameworks", flush=True)

SYS=("You are a GRC taxonomist. You will see EVERY control from ALL frameworks at once. "
     "Produce the canonical list of SPECIFIC control-family names that these controls collapse into. "
     "Each family = ONE specific requirement (e.g. 'Privileged Access Management', 'Data Encryption "
     "at Rest', 'Change Management', 'Vulnerability Scanning'), NOT a broad domain. Controls that "
     "impose the SAME requirement across different frameworks/wording belong to the SAME family. "
     "Aim for tight, specific families (expect a few hundred).")
def names_block(ms): return "\n".join(f"({m['framework'][:18]}) {m['name']}" for m in ms)
def build_taxonomy(ms):
    prompt=("Here are ALL "+str(len(ms))+" controls across every framework. Return the canonical "
            "SPECIFIC control-family list they map to.\n\nControls:\n"+names_block(ms)+
            '\n\nRespond ONLY JSON: {"families":["...","..."]}')
    r=client.chat.completions.create(model="gpt-4o", temperature=0,
        messages=[{"role":"system","content":SYS},{"role":"user","content":prompt}],
        response_format={"type":"json_object"})
    return [f.strip() for f in json.loads(r.choices[0].message.content or "{}").get("families",[]) if f and f.strip()]

try:
    taxonomy=build_taxonomy(members)
    print(f"PHASE 1: single global call -> {len(taxonomy)} canonical families", flush=True)
except Exception as e:
    print("phase1 single-call failed, falling back to accumulating builder:", repr(e)[:160], flush=True)
    taxonomy=N._build_taxonomy(client, members)
    print(f"PHASE 1 (fallback): {len(taxonomy)} families", flush=True)

tags=N._classify_to_taxonomy(client, members, taxonomy)
print(f"PHASE 2: tagged {sum(1 for t in tags if t)}/{len(members)} controls to a family", flush=True)

fam=defaultdict(list)
for m,t in zip(members,tags):
    if t: fam[t].append(m)
uni_fams=[(f,ms) for f,ms in fam.items() if len({m['fwid'] for m in ms})>=2]
print(f"families spanning >=2 frameworks (-> unified): {len(uni_fams)}", flush=True)

run=NormalizationRun(tenant_id=1, label="Regenerated — global tagging (gpt-4o)", scope="full",
                     is_baseline=False, status="running")
db.add(run); db.flush(); RUN=run.id
groups={}
def group_for(dom):
    dom=dom or "Other / Uncategorized"
    if dom not in groups:
        seq=len(groups)+1
        g=CommonControlGroup(tenant_id=1, run_id=RUN, code=f"FDOM-{seq:02d}", name=dom, domain=dom, category=dom)
        db.add(g); db.flush(); groups[dom]=g.id
    return groups[dom]

claimed=set(); seq=0; n_uni=0; n_std=0
for family,ms in uni_fams:
    dom=Counter(pid_domain.get(m["ref_id"],"Other / Uncategorized") for m in ms).most_common(1)[0][0]
    gid=group_for(dom); seq+=1; n_uni+=1
    nc=NormalizedControl(code=f"NCF{seq:04d}", name=family[:250], source="ai_normalized",
                         run_id=RUN, domain=dom, maturity_level=0, review_status="pending")
    db.add(nc); db.flush()
    db.add(CommonControlGroupMapping(group_id=gid, normalized_control_id=nc.id, mapping_source="domain", mapping_confidence=1.0))
    for m in ms:
        db.add(NormalizedControlLink(normalized_control_id=nc.id, parsed_control_id=m["ref_id"], mapping_type="direct"))
        db.add(CommonControlGroupMapping(group_id=gid, parsed_control_id=m["ref_id"], mapping_source="domain", mapping_confidence=1.0))
        claimed.add(m["ref_id"])
for m in members:
    if m["ref_id"] in claimed: continue
    gid=group_for(pid_domain.get(m["ref_id"],"Other / Uncategorized"))
    db.add(CommonControlGroupMapping(group_id=gid, parsed_control_id=m["ref_id"], mapping_source="standalone", mapping_confidence=1.0))
    n_std+=1
run.status="completed"; run.summary={"unified_controls":n_uni,"standalone":n_std,"domains":len(groups)}
db.commit()
print(f"BUILT run #{RUN}: {n_uni} unified · {n_std} standalone · {len(groups)} domains", flush=True)

def span_stats(rid):
    fc=[r[0] for r in db.execute(sqltext(f'''SELECT count(DISTINCT p.uploaded_framework_id) FROM grc_normalized_control_links l
      JOIN grc_normalized_controls nc ON nc.id=l.normalized_control_id JOIN grc_parsed_framework_controls p ON p.id=l.parsed_control_id
      WHERE nc.run_id={rid} GROUP BY nc.id''')).fetchall()]
    c=Counter(fc); return (len(fc), round(sum(fc)/len(fc),2) if fc else 0, max(fc) if fc else 0, c[2], sum(v for k,v in c.items() if k>=6))
viol=db.execute(sqltext(f"""SELECT count(*) FROM (SELECT nc.id FROM grc_normalized_controls nc
  JOIN grc_normalized_control_links l ON l.normalized_control_id=nc.id JOIN grc_parsed_framework_controls p ON p.id=l.parsed_control_id
  WHERE nc.run_id={RUN} GROUP BY nc.id HAVING count(DISTINCT p.uploaded_framework_id)<2) x""")).scalar()
inlib=db.execute(sqltext(f"SELECT count(DISTINCT parsed_control_id) FROM grc_common_control_group_mappings WHERE parsed_control_id IS NOT NULL AND group_id IN (SELECT id FROM grc_common_control_groups WHERE run_id={RUN})")).scalar()
nu,na,nm,n2,n6=span_stats(RUN); bu,ba,bm,b2,b6=span_stats(BASE)
over=db.execute(sqltext(f'''SELECT count(*) FROM (SELECT nc.id FROM grc_normalized_controls nc JOIN grc_normalized_control_links l ON l.normalized_control_id=nc.id
     JOIN grc_parsed_framework_controls p ON p.id=l.parsed_control_id WHERE nc.run_id={RUN}
     GROUP BY nc.id, p.uploaded_framework_id HAVING count(*)>=20) x''')).scalar()
print("\n================ COMPARISON ================", flush=True)
print(f"  LIVE baseline #18 : {bu} unified | avg span {ba} | max {bm} | 2fw={b2} | 6+fw={b6}", flush=True)
print(f"  NEW run     #{RUN} : {nu} unified | avg span {na} | max {nm} | 2fw={n2} | 6+fw={n6}", flush=True)
print(f"  NEW integrity: single-fw violations={viol} (must=0) | coverage {inlib}/{len(members)} | over-consolidation(>=20 from 1fw)={over}", flush=True)
print(f"\nNEW run #{RUN} built, NOT promoted. Swap is a separate step after you review.", flush=True)
print("REGENDONE", flush=True)
db.close()
