"""Phase B — build fine-grained run from /tmp/splits.json. Multi-framework subs ->
unified controls; single-framework subs + the originally-standalone -> standalone.
Built as a NON-baseline run; swapped in only after it passes verification."""
import os, json
from dotenv import load_dotenv; load_dotenv(".env")
from sqlalchemy import create_engine, text as sqltext
from sqlalchemy.orm import sessionmaker
from datetime import datetime
base=os.environ["POSTGRES_ADMIN_URL"].rsplit("/",1)[0]
db=sessionmaker(bind=create_engine(base+"/grc_complyverse"))()
from grc.models import (NormalizationRun, NormalizedControl, NormalizedControlLink,
                        CommonControlGroup, CommonControlGroupMapping)
splits=json.load(open("/tmp/splits.json")); OLD=15
# domains of the 963 originally-standalone (from run 15 standalone mappings)
rows=db.execute(sqltext(f"""SELECT m.parsed_control_id, g.domain FROM grc_common_control_group_mappings m
  JOIN grc_common_control_groups g ON g.id=m.group_id
  WHERE g.run_id={OLD} AND m.mapping_source='standalone' AND m.parsed_control_id IS NOT NULL""")).fetchall()
orig_standalone={r[0]:(r[1] or "Other / Uncategorized") for r in rows}
print(f"orig standalone carried over: {len(orig_standalone)}", flush=True)
# wipe any half-built non-baseline runs from prior attempts
for rid in [r[0] for r in db.execute(sqltext("SELECT id FROM grc_normalization_runs WHERE is_baseline=false AND scope='full'")).fetchall()]:
    for q in [f"DELETE FROM grc_common_control_group_mappings WHERE group_id IN (SELECT id FROM grc_common_control_groups WHERE run_id={rid})",
              f"DELETE FROM grc_common_control_groups WHERE run_id={rid}",
              f"DELETE FROM grc_normalized_control_links WHERE normalized_control_id IN (SELECT id FROM grc_normalized_controls WHERE run_id={rid})",
              f"DELETE FROM grc_normalized_controls WHERE run_id={rid}",
              f"DELETE FROM grc_normalization_runs WHERE id={rid}"]:
        db.execute(sqltext(q))
db.commit()
run=NormalizationRun(tenant_id=1, label="Fine-grained baseline (all frameworks)", scope="full",
                     is_baseline=False, status="running", started_at=datetime.utcnow())
db.add(run); db.flush(); RUN=run.id
groups={}
def group_for(dom):
    dom=dom or "Other / Uncategorized"
    if dom not in groups:
        seq=len(groups)+1
        g=CommonControlGroup(tenant_id=1, run_id=RUN, code=f"FDOM-{seq:02d}", name=dom, domain=dom, category=dom)
        db.add(g); db.flush(); groups[dom]=g.id
    return groups[dom]
seq=0; n_uni=0; n_std=0
for bucket,rec in splits.items():
    dom=rec["domain"]; mems=rec["members"]; gid=group_for(dom)
    for sub in rec["subs"]:
        idxs=sub["members"]; fwids={mems[i]["fwid"] for i in idxs}
        if len(fwids)>=2:
            seq+=1
            nc=NormalizedControl(code=f"NCF{seq:04d}", name=sub["name"][:250], source="ai_normalized",
                                 run_id=RUN, domain=dom, maturity_level=0, review_status="pending")
            db.add(nc); db.flush()
            db.add(CommonControlGroupMapping(group_id=gid, normalized_control_id=nc.id, mapping_source="domain", mapping_confidence=1.0))
            for i in idxs:
                db.add(NormalizedControlLink(normalized_control_id=nc.id, parsed_control_id=mems[i]["ref_id"], mapping_type="direct"))
                db.add(CommonControlGroupMapping(group_id=gid, parsed_control_id=mems[i]["ref_id"], mapping_source="domain", mapping_confidence=1.0))
            n_uni+=1
        else:
            for i in idxs:
                db.add(CommonControlGroupMapping(group_id=gid, parsed_control_id=mems[i]["ref_id"], mapping_source="standalone", mapping_confidence=1.0))
                n_std+=1
for pid,dom in orig_standalone.items():
    gid=group_for(dom)
    db.add(CommonControlGroupMapping(group_id=gid, parsed_control_id=pid, mapping_source="standalone", mapping_confidence=1.0))
    n_std+=1
db.commit()
run.status="completed"; run.completed_at=datetime.utcnow()
run.summary={"unified_controls":n_uni,"standalone":n_std,"domains":len(groups)}; db.commit()
# accounting
tot=db.execute(sqltext("SELECT count(*) FROM grc_parsed_framework_controls")).scalar()
inlib=db.execute(sqltext(f"SELECT count(DISTINCT parsed_control_id) FROM grc_common_control_group_mappings WHERE parsed_control_id IS NOT NULL AND group_id IN (SELECT id FROM grc_common_control_groups WHERE run_id={RUN})")).scalar()
print(f"BUILT run #{RUN}: {n_uni} unified · {n_std} standalone · {len(groups)} domains", flush=True)
print(f"coverage: {inlib}/{tot} controls in library", flush=True)
print("BUILDDONE", flush=True)
db.close()
