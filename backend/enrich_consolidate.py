"""Additive, AI-verified consolidation enrichment for run #18.

Finds same-requirement controls still sitting in the STANDALONE pool (because the
split-only build never merged across run-#15 buckets) and promotes the AI-CONFIRMED
ones into NEW unified controls. Never touches the existing 266 unified controls.
Every candidate cluster is verified by N._verify_clusters (same objective) AND must
span >=2 distinct frameworks. Fully reversible: new NC ids + flipped pids -> rollback JSON.
"""
import os, re, json
from collections import defaultdict
from dotenv import load_dotenv; load_dotenv(".env")
from sqlalchemy import create_engine, text as sqltext
from sqlalchemy.orm import sessionmaker
base=os.environ["POSTGRES_ADMIN_URL"].rsplit("/",1)[0]
db=sessionmaker(bind=create_engine(base+"/grc_complyverse"))()
from grc.modules.control_library.services import normalization as N
from grc.modules.control_library.routers.groups import get_openai_client
client=get_openai_client()
RUN=18

fwn={r[0]:r[1] for r in db.execute(sqltext("SELECT id,name FROM grc_uploaded_frameworks")).fetchall()}
dgroup={r[1]:r[0] for r in db.execute(sqltext(f"SELECT id,domain FROM grc_common_control_groups WHERE run_id={RUN}")).fetchall()}

std=db.execute(sqltext(f"""
 SELECT m.parsed_control_id, p.uploaded_framework_id, p.title, p.original_reference,
        COALESCE(p.description,p.full_text,''), g.domain, g.id
 FROM grc_common_control_group_mappings m
 JOIN grc_common_control_groups g ON g.id=m.group_id
 JOIN grc_parsed_framework_controls p ON p.id=m.parsed_control_id
 WHERE g.run_id={RUN} AND m.mapping_source='standalone' AND m.parsed_control_id IS NOT NULL""")).fetchall()
std=[{"pid":r[0],"fwid":r[1],"framework":fwn.get(r[1],"?"),"title":(r[2] or ""),
      "code":(r[3] or ""),"text":(r[4] or "")[:300],"domain":r[5] or "?","gid":r[6]} for r in std]
print(f"standalone pool: {len(std)}", flush=True)

STOP=set("the of and to for a an in on or by with as is are be this that it its which from at into under over per any all each must shall should may will not no within across between control controls policy procedure procedures requirement requirements management process processes system systems information security cyber data".split())
def toks(s): return {w for w in re.findall(r"[a-z0-9]+", s.lower()) if w not in STOP and len(w)>2}
for s in std: s["tok"]=toks(s["title"])
def jac(a,b): return len(a&b)/len(a|b) if (a or b) else 0.0

# greedy single-link clustering within each domain (loose threshold; AI trims)
TH=0.5
defs=[]
by_dom=defaultdict(list)
for s in std: by_dom[s["domain"]].append(s)
for dom,items in by_dom.items():
    used=set()
    for i in range(len(items)):
        if items[i]["pid"] in used or not items[i]["tok"]: continue
        grp=[items[i]]; used.add(items[i]["pid"])
        for j in range(i+1,len(items)):
            if items[j]["pid"] in used or not items[j]["tok"]: continue
            if jac(items[i]["tok"],items[j]["tok"])>=TH:
                grp.append(items[j]); used.add(items[j]["pid"])
        if len(grp)>=2 and len({g["fwid"] for g in grp})>=2:
            # representative name = medoid title (max total similarity to peers)
            best=max(grp,key=lambda g:sum(jac(g["tok"],h["tok"]) for h in grp))
            defs.append({"name":best["title"][:120],"domain":dom,"statement":"",
                         "refs":[{"ref_id":g["pid"],"pid":g["pid"],"fwid":g["fwid"],
                                  "framework":g["framework"],"code":g["code"],
                                  "name":g["title"][:200],"text":g["text"]} for g in grp]})
print(f"candidate clusters (>=2 ctrls, >=2 fw, Jaccard>={TH}): {len(defs)} covering {sum(len(d['refs']) for d in defs)} standalone", flush=True)

# AI VERIFY — keep only members that truly share the requirement
verified=N._verify_clusters(client, "enrichment", defs)
print(f"after AI verify: {len(verified)} clusters survive", flush=True)

# enforce >=2 DISTINCT frameworks (the rule _verify_clusters omits)
final=[d for d in verified if len({r["fwid"] for r in d["refs"]})>=2]
print(f"after >=2-framework enforcement: {len(final)} new unified controls", flush=True)

# next NCF sequence
mx=0
for (code,) in db.execute(sqltext(f"SELECT code FROM grc_normalized_controls WHERE run_id={RUN}")).fetchall():
    m=re.match(r"^NCF(\d+)$", code or "")
    if m: mx=max(mx,int(m.group(1)))
seq=mx
from grc.models import NormalizedControl, NormalizedControlLink, CommonControlGroupMapping
rollback={"new_nc_ids":[], "flipped_pids":[]}
created=0; members=0
for d in final:
    gid=dgroup.get(d["domain"])
    if not gid: continue
    seq+=1; created+=1
    nc=NormalizedControl(code=f"NCF{seq:04d}", name=d["name"][:250], source="ai_normalized",
                         run_id=RUN, domain=d["domain"], maturity_level=0, review_status="pending")
    db.add(nc); db.flush(); rollback["new_nc_ids"].append(nc.id)
    db.add(CommonControlGroupMapping(group_id=gid, normalized_control_id=nc.id,
                                     mapping_source="domain", mapping_confidence=1.0))
    for r in d["refs"]:
        pid=r["pid"]
        db.add(NormalizedControlLink(normalized_control_id=nc.id, parsed_control_id=pid, mapping_type="direct"))
        db.execute(sqltext("UPDATE grc_common_control_group_mappings SET mapping_source='domain' WHERE group_id=:g AND parsed_control_id=:p AND mapping_source='standalone'"),{"g":gid,"p":pid})
        rollback["flipped_pids"].append({"pid":pid,"gid":gid,"nc_id":nc.id})
        members+=1
db.commit()
json.dump(rollback, open("./enrich_rollback.json","w"), indent=0)
print(f"CREATED {created} new unified controls from {members} standalone (rollback: enrich_rollback.json)", flush=True)

# regenerate evidence for the new (NULL) controls
ev=N._precompute_nc_evidence(db, client, run_id=RUN)
print(f"evidence consolidated for {ev} controls", flush=True)

# ---- INTEGRITY ----
n_uni=db.execute(sqltext(f"SELECT count(*) FROM grc_normalized_controls WHERE run_id={RUN}")).scalar()
viol=db.execute(sqltext(f"""SELECT count(*) FROM (SELECT nc.id FROM grc_normalized_controls nc
  JOIN grc_normalized_control_links l ON l.normalized_control_id=nc.id
  JOIN grc_parsed_framework_controls p ON p.id=l.parsed_control_id
  WHERE nc.run_id={RUN} GROUP BY nc.id HAVING count(DISTINCT p.uploaded_framework_id)<2) x""")).scalar()
tot=db.execute(sqltext("SELECT count(*) FROM grc_parsed_framework_controls")).scalar()
inlib=db.execute(sqltext(f"SELECT count(DISTINCT parsed_control_id) FROM grc_common_control_group_mappings WHERE parsed_control_id IS NOT NULL AND group_id IN (SELECT id FROM grc_common_control_groups WHERE run_id={RUN})")).scalar()
nstd=db.execute(sqltext(f"SELECT count(*) FROM grc_common_control_group_mappings m JOIN grc_common_control_groups g ON g.id=m.group_id WHERE g.run_id={RUN} AND m.mapping_source='standalone' AND m.parsed_control_id IS NOT NULL")).scalar()
print(f"\nFINAL: unified {n_uni} | single-fw violations {viol} (must be 0) | standalone {nstd} | library {inlib}/{tot}", flush=True)
print("ENRICHDONE", flush=True)
db.close()
