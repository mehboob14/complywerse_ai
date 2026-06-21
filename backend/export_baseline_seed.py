"""Export the live master baseline to a PORTABLE JSON seed committed to the repo,
so a fresh clone gets the exact unified library WITHOUT re-running AI.

Members are referenced by (framework_name, original_reference, title) — NOT by DB
primary keys — so the loader maps them onto whatever parsed-control ids exist in the
target DB after the framework seed runs. Captures: domains, unified controls (+ their
domain + consolidated recommended_evidence), members, and standalone controls.
"""
import os, json
from dotenv import load_dotenv; load_dotenv(".env")
from sqlalchemy import create_engine, text as sqltext
from sqlalchemy.orm import sessionmaker
base=os.environ["POSTGRES_ADMIN_URL"].rsplit("/",1)[0]
db=sessionmaker(bind=create_engine(base+"/grc_complyverse"))()
from grc.models import NormalizationRun

RUN=db.query(NormalizationRun).filter(NormalizationRun.is_baseline==True).order_by(NormalizationRun.id.desc()).first().id
print(f"exporting baseline run #{RUN}")
fwn={r[0]:r[1] for r in db.execute(sqltext("SELECT id,name FROM grc_uploaded_frameworks")).fetchall()}
# parsed control -> portable key
pc={r[0]:{"framework":fwn.get(r[1],"?"),"ref":r[2] or "","title":(r[3] or "")[:200]}
    for r in db.execute(sqltext("SELECT id,uploaded_framework_id,original_reference,title FROM grc_parsed_framework_controls")).fetchall()}

# domain groups (in order)
groups={r[0]:r[1] for r in db.execute(sqltext(
    f"SELECT id, domain FROM grc_common_control_groups WHERE run_id={RUN} ORDER BY code")).fetchall()}
domains=[d for d in dict.fromkeys(groups.values())]

# unified controls + members + evidence
unified=[]
ncs=db.execute(sqltext(f"SELECT id,name,domain,recommended_evidence FROM grc_normalized_controls WHERE run_id={RUN} ORDER BY code")).fetchall()
for ncid,name,dom,ev in ncs:
    mems=[]
    for (pid,) in db.execute(sqltext(f"SELECT parsed_control_id FROM grc_normalized_control_links WHERE normalized_control_id={ncid}")).fetchall():
        if pid in pc: mems.append(pc[pid])
    if len(mems)>=2:
        unified.append({"name":name,"domain":dom or "Other / Uncategorized",
                        "evidence":ev, "members":mems})

# standalone controls (with their domain)
standalone=[]
for r in db.execute(sqltext(f"""SELECT m.parsed_control_id, g.domain FROM grc_common_control_group_mappings m
    JOIN grc_common_control_groups g ON g.id=m.group_id
    WHERE g.run_id={RUN} AND m.mapping_source='standalone' AND m.parsed_control_id IS NOT NULL""")).fetchall():
    pid,dom=r
    if pid in pc:
        e=dict(pc[pid]); e["domain"]=dom or "Other / Uncategorized"
        standalone.append(e)

seed={"version":1, "label":"Master baseline",
      "domains":domains, "unified":unified, "standalone":standalone,
      "counts":{"domains":len(domains),"unified":len(unified),"standalone":len(standalone),
                "members":sum(len(u["members"]) for u in unified)}}
out="grc/seed_data/normalization_baseline.json"
json.dump(seed, open(out,"w",encoding="utf-8"), ensure_ascii=False, separators=(",",":"))
sz=os.path.getsize(out)
print(f"WROTE {out} ({sz//1024} KB)")
print("counts:", seed["counts"])
db.close()
