"""Fix B — reduce fragmentation: within each domain, MERGE unified controls that
represent the SAME specific requirement (the lexical rebuild split them into 2-fw
pairs). Conservative + AI-judged + reversible. Never merges different requirements;
caps merged size to avoid re-introducing over-consolidation. Rollback: merge_rollback.json.
"""
import os, json
from collections import defaultdict
from dotenv import load_dotenv; load_dotenv(".env")
from sqlalchemy import create_engine, text as sqltext
from sqlalchemy.orm import sessionmaker
base=os.environ["POSTGRES_ADMIN_URL"].rsplit("/",1)[0]
db=sessionmaker(bind=create_engine(base+"/grc_complyverse"))()
from grc.models import NormalizedControl, NormalizedControlLink, CommonControlGroupMapping
from grc.modules.control_library.routers.groups import get_openai_client
from grc.config import get_openai_model
client=get_openai_client(); M=get_openai_model()
RUN=18
CAP=25  # never build a merged control bigger than this (over-consolidation guard)

# load unified controls + members, grouped by domain
ncs=db.query(NormalizedControl).filter(NormalizedControl.run_id==RUN).all()
info={}
for nc in ncs:
    mems=[l.parsed_control_id for l in db.query(NormalizedControlLink).filter(
        NormalizedControlLink.normalized_control_id==nc.id).all()]
    info[nc.id]={"id":nc.id,"name":nc.name,"domain":nc.domain or "?","mems":mems}
# framework per pid
pid_fw={r[0]:r[1] for r in db.execute(sqltext(
    "SELECT id, uploaded_framework_id FROM grc_parsed_framework_controls")).fetchall()}
for d in info.values():
    d["fws"]=set(pid_fw.get(p) for p in d["mems"])

by_dom=defaultdict(list)
for d in info.values(): by_dom[d["domain"]].append(d)
print(f"loaded {len(info)} unified controls across {len(by_dom)} domains", flush=True)

SYS=("You are a GRC taxonomist. You are given the names of UNIFIED controls that already "
     "exist in ONE domain. Some are fragments of the SAME specific requirement that should be "
     "ONE control (e.g. 'Access Control Policy' + 'Access Control' + 'Logical Access Control'). "
     "Identify ONLY groups that impose the SAME specific obligation and should merge. NEVER merge "
     "different requirements (e.g. 'Access Control' vs 'Access Review', 'Backup' vs 'Recovery "
     "Testing', policy-vs-operation). Be conservative — when unsure, do NOT merge.")
def merge_prompt(items):
    lines="\n".join(f"[{i}] {it['name']}" for i,it in enumerate(items))
    return ("Unified controls in this domain:\n"+lines+
            '\n\nReturn ONLY JSON: {"merge": [[indices that are the same requirement], ...]}. '
            'Omit singletons. Only include groups you are confident are the same specific requirement.')

rollback={"merges":[]}
merged_away=0; groups_merged=0
for dom, items in by_dom.items():
    if len(items)<2: continue
    try:
        r=client.chat.completions.create(model=M, temperature=0,
            messages=[{"role":"system","content":SYS},{"role":"user","content":merge_prompt(items)}],
            response_format={"type":"json_object"})
        groups=json.loads(r.choices[0].message.content or "{}").get("merge",[])
    except Exception as e:
        print("  AI error in",dom,e,flush=True); continue
    for grp in groups:
        idxs=[i for i in grp if isinstance(i,int) and 0<=i<len(items)]
        idxs=list(dict.fromkeys(idxs))
        if len(idxs)<2: continue
        cand=[items[i] for i in idxs]
        all_mems=[]; seen=set()
        for c in cand:
            for p in c["mems"]:
                if p not in seen: seen.add(p); all_mems.append(p)
        if len(all_mems)>CAP:   # guard against over-consolidation
            print(f"  [skip cap] {dom}: {[c['name'] for c in cand]} -> {len(all_mems)} members", flush=True)
            continue
        # keep the control with the most members; merge the rest into it
        cand.sort(key=lambda c:-len(c["mems"]))
        keep=cand[0]; drop=cand[1:]
        existing=set(keep["mems"])
        for c in drop:
            for p in c["mems"]:
                if p not in existing:
                    db.add(NormalizedControlLink(normalized_control_id=keep["id"], parsed_control_id=p, mapping_type="direct"))
                    existing.add(p)
            # remove the dropped NC's links + its normalized_control_id group mapping + the NC
            db.execute(sqltext(f"DELETE FROM grc_normalized_control_links WHERE normalized_control_id={c['id']}"))
            db.execute(sqltext(f"DELETE FROM grc_common_control_group_mappings WHERE normalized_control_id={c['id']}"))
            db.execute(sqltext(f"DELETE FROM grc_evidence_control_mappings WHERE normalized_control_id={c['id']}"))
            db.execute(sqltext(f"DELETE FROM grc_ai_evidence_recommendations WHERE normalized_control_id={c['id']}"))
            db.execute(sqltext(f"DELETE FROM grc_normalized_controls WHERE id={c['id']}"))
            merged_away+=1
        # stale evidence on the kept control -> regen
        db.execute(sqltext(f"UPDATE grc_normalized_controls SET recommended_evidence=NULL WHERE id={keep['id']}"))
        rollback["merges"].append({"kept":keep["id"],"dropped":[c["id"] for c in drop],
                                   "members":list(existing),"domain":dom})
        groups_merged+=1
db.commit()
json.dump(rollback, open("./merge_rollback.json","w"), indent=0)
print(f"\nMERGED {groups_merged} groups, removed {merged_away} duplicate unified controls (rollback: merge_rollback.json)", flush=True)

# regenerate evidence for the merged (NULL) controls
from grc.modules.control_library.services import normalization as N
ev=N._precompute_nc_evidence(db, client, run_id=RUN)
print(f"evidence reconsolidated for {ev} controls", flush=True)

# verify
q=lambda s: db.execute(sqltext(s)).scalar()
from collections import Counter
fc=[r[0] for r in db.execute(sqltext(f'''SELECT count(DISTINCT p.uploaded_framework_id) FROM grc_normalized_control_links l
  JOIN grc_normalized_controls nc ON nc.id=l.normalized_control_id JOIN grc_parsed_framework_controls p ON p.id=l.parsed_control_id
  WHERE nc.run_id={RUN} GROUP BY nc.id''')).fetchall()]
c=Counter(fc)
print(f"\nunified now: {q(f'SELECT count(*) FROM grc_normalized_controls WHERE run_id={RUN}')}")
print(f"framework-span: avg {sum(fc)/len(fc):.2f}, max {max(fc)} | 2fw={c[2]}, 3fw={c[3]}, 4-5fw={c[4]+c[5]}, 6+fw={sum(v for k,v in c.items() if k>=6)}")
print(f"single-fw violations: {q(f'''SELECT count(*) FROM (SELECT nc.id FROM grc_normalized_controls nc JOIN grc_normalized_control_links l ON l.normalized_control_id=nc.id JOIN grc_parsed_framework_controls p ON p.id=l.parsed_control_id WHERE nc.run_id={RUN} GROUP BY nc.id HAVING count(DISTINCT p.uploaded_framework_id)<2) x''')}")
print(f"NULL evidence: {q(f'SELECT count(*) FROM grc_normalized_controls WHERE run_id={RUN} AND recommended_evidence IS NULL')}")
print(f"coverage: {q(f'SELECT count(DISTINCT parsed_control_id) FROM grc_common_control_group_mappings WHERE parsed_control_id IS NOT NULL AND group_id IN (SELECT id FROM grc_common_control_groups WHERE run_id={RUN})')}/3419")
print("MERGEDONE", flush=True)
db.close()
