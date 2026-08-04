"""DISASTER RECOVERY — rebuild run #18's unified-control layer that a stale Celery
worker deleted. Deterministic, NO AI. Sources:
  (1) enrich_rollback.json  -> the 88 enrichment groupings (exact member sets)
  (2) the surviving group mappings: parsed controls still tagged mapping_source='domain'
      ARE the known unified-members; re-cluster the non-enrichment ones lexically.
Members that don't form a >=2-framework cluster revert to standalone. Cleans up the
killed job's 56 orphan controls + stray links + 'ai_normalized' mappings.
"""
import os, re, json
from collections import defaultdict
from dotenv import load_dotenv; load_dotenv(".env")
from sqlalchemy import create_engine, text as sqltext
from sqlalchemy.orm import sessionmaker
base=os.environ["POSTGRES_ADMIN_URL"].rsplit("/",1)[0]
db=sessionmaker(bind=create_engine(base+"/grc_complyverse"))()
from grc.models import NormalizedControl, NormalizedControlLink, CommonControlGroupMapping
RUN=18
fwn={r[0]:r[1] for r in db.execute(sqltext("SELECT id,name FROM grc_uploaded_frameworks")).fetchall()}

# ---- 0) CLEAN UP the killed job's artifacts ----
db.execute(sqltext("DELETE FROM grc_normalized_control_links WHERE normalized_control_id IN (SELECT id FROM grc_normalized_controls WHERE run_id IS NULL)"))
db.execute(sqltext("DELETE FROM grc_common_control_group_mappings WHERE normalized_control_id IN (SELECT id FROM grc_normalized_controls WHERE run_id IS NULL)"))
db.execute(sqltext("DELETE FROM grc_normalized_controls WHERE run_id IS NULL"))
# any leftover NormalizedControls for run 18 (and their links) from the partial state -> clear, we rebuild fresh
db.execute(sqltext(f"DELETE FROM grc_normalized_control_links WHERE normalized_control_id IN (SELECT id FROM grc_normalized_controls WHERE run_id={RUN})"))
db.execute(sqltext(f"DELETE FROM grc_common_control_group_mappings WHERE normalized_control_id IS NOT NULL AND group_id IN (SELECT id FROM grc_common_control_groups WHERE run_id={RUN})"))
db.execute(sqltext(f"DELETE FROM grc_normalized_controls WHERE run_id={RUN}"))
# normalize any stray 'ai_normalized' parsed mappings back to a clean state: treat as 'domain' members (they were unified members)
db.execute(sqltext(f"UPDATE grc_common_control_group_mappings SET mapping_source='domain' WHERE mapping_source='ai_normalized' AND group_id IN (SELECT id FROM grc_common_control_groups WHERE run_id={RUN})"))
db.commit()

# ---- 1) load the surviving unified-MEMBER parsed controls (mapping_source='domain') ----
rows=db.execute(sqltext(f"""
 SELECT m.parsed_control_id, m.group_id, p.uploaded_framework_id, p.title, p.original_reference, g.domain
 FROM grc_common_control_group_mappings m
 JOIN grc_common_control_groups g ON g.id=m.group_id
 JOIN grc_parsed_framework_controls p ON p.id=m.parsed_control_id
 WHERE g.run_id={RUN} AND m.mapping_source='domain' AND m.parsed_control_id IS NOT NULL""")).fetchall()
mem={r[0]:{"pid":r[0],"gid":r[1],"fwid":r[2],"title":(r[3] or ""),"code":(r[4] or ""),"domain":r[5] or "?"} for r in rows}
print(f"surviving unified-member parsed controls: {len(mem)}", flush=True)

# ---- 2) restore the 88 enrichment groupings EXACTLY ----
rb=json.load(open("./enrich_rollback.json"))
groups_by_old_nc=defaultdict(list)
for fp in rb.get("flipped_pids",[]):
    if fp["pid"] in mem: groups_by_old_nc[fp["nc_id"]].append(fp["pid"])
clusters=[]   # each: (gid, [pids])
claimed=set()
for old_nc, pids in groups_by_old_nc.items():
    pids=[p for p in pids if p in mem and p not in claimed]
    fws={mem[p]["fwid"] for p in pids}
    if len(pids)>=2 and len(fws)>=2:
        gid=mem[pids[0]]["gid"]
        clusters.append((gid, pids, "enrich"))
        claimed.update(pids)
print(f"restored {len(clusters)} enrichment clusters ({len(claimed)} members)", flush=True)

# ---- 3) re-cluster the REMAINING members lexically (strict, deterministic, no AI) ----
STOP=set("the of and to for a an in on or by with as is are be this that it its which from at into under over per any all each must shall should may will not no within across between control controls policy procedure procedures requirement requirements management process processes system systems information security cyber data".split())
def toks(s): return {w for w in re.findall(r"[a-z0-9]+", s.lower()) if w not in STOP and len(w)>2}
def jac(a,b): return len(a&b)/len(a|b) if (a or b) else 0.0
TH=0.6
rest=[m for pid,m in mem.items() if pid not in claimed]
for m in rest: m["tok"]=toks(m["title"])
by_dom=defaultdict(list)
for m in rest: by_dom[(m["gid"],m["domain"])].append(m)
for (gid,dom),items in by_dom.items():
    used=set()
    for i in range(len(items)):
        if items[i]["pid"] in used or not items[i]["tok"]: continue
        grp=[items[i]]; used.add(items[i]["pid"])
        for j in range(i+1,len(items)):
            if items[j]["pid"] in used or not items[j]["tok"]: continue
            if jac(items[i]["tok"],items[j]["tok"])>=TH:
                grp.append(items[j]); used.add(items[j]["pid"])
        fws={g["fwid"] for g in grp}
        if len(grp)>=2 and len(fws)>=2:
            clusters.append((gid,[g["pid"] for g in grp],"lexical")); claimed.update(g["pid"] for g in grp)

# ---- 4) members that didn't cluster -> revert to standalone ----
orphan_members=[pid for pid in mem if pid not in claimed]
for pid in orphan_members:
    db.execute(sqltext(f"UPDATE grc_common_control_group_mappings SET mapping_source='standalone' WHERE group_id={mem[pid]['gid']} AND parsed_control_id={pid}"))
print(f"total clusters to create: {len(clusters)} | members reverting to standalone: {len(orphan_members)}", flush=True)

# ---- 5) create the unified controls ----
def medoid_name(pids):
    cand=[mem[p] for p in pids]
    for c in cand: c.setdefault("tok", toks(c["title"]))
    best=max(cand, key=lambda c:sum(jac(c["tok"],d["tok"]) for d in cand))
    return best["title"][:120] or "Unified Control"
seq=0
for gid,pids,kind in clusters:
    seq+=1
    nc=NormalizedControl(code=f"NCF{seq:04d}", name=medoid_name(pids), source="ai_normalized",
                         run_id=RUN, domain=mem[pids[0]]["domain"], maturity_level=0, review_status="pending")
    db.add(nc); db.flush()
    db.add(CommonControlGroupMapping(group_id=gid, normalized_control_id=nc.id, mapping_source="domain", mapping_confidence=1.0))
    for pid in pids:
        db.add(NormalizedControlLink(normalized_control_id=nc.id, parsed_control_id=pid, mapping_type="direct"))
        # ensure the member mapping is 'domain' (it already is)
        db.execute(sqltext(f"UPDATE grc_common_control_group_mappings SET mapping_source='domain' WHERE group_id={gid} AND parsed_control_id={pid}"))
db.commit()

# ---- 6) verify ----
q=lambda s: db.execute(sqltext(s)).scalar()
n_uni=q(f"SELECT count(*) FROM grc_normalized_controls WHERE run_id={RUN}")
viol=q(f"""SELECT count(*) FROM (SELECT nc.id FROM grc_normalized_controls nc
  JOIN grc_normalized_control_links l ON l.normalized_control_id=nc.id
  JOIN grc_parsed_framework_controls p ON p.id=l.parsed_control_id
  WHERE nc.run_id={RUN} GROUP BY nc.id HAVING count(DISTINCT p.uploaded_framework_id)<2) x""")
tot=q("SELECT count(*) FROM grc_parsed_framework_controls")
inlib=q(f"SELECT count(DISTINCT parsed_control_id) FROM grc_common_control_group_mappings WHERE parsed_control_id IS NOT NULL AND group_id IN (SELECT id FROM grc_common_control_groups WHERE run_id={RUN})")
nstd=q(f"SELECT count(*) FROM grc_common_control_group_mappings m JOIN grc_common_control_groups g ON g.id=m.group_id WHERE g.run_id={RUN} AND m.mapping_source='standalone' AND m.parsed_control_id IS NOT NULL")
print(f"\nRECONSTRUCTED: unified {n_uni} | single-fw violations {viol} (must=0) | standalone {nstd} | library {inlib}/{tot}", flush=True)
print("RECONSTRUCTDONE", flush=True)
db.close()
