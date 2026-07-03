"""Add the 963 single-framework-unique controls to the library under their domains,
so the Control Library is COMPLETE (all 3,419 controls). Each unique is classified
onto one of the existing domains and attached to that domain group as a framework
control (not 'unified' — it has no cross-framework match). No NormalizedControl is
created for them; the domain's 'Normalized' filter still shows only the unified ones."""
import os
from collections import defaultdict, Counter
from dotenv import load_dotenv; load_dotenv(".env")
from sqlalchemy import create_engine, text as sqltext
from sqlalchemy.orm import sessionmaker
base=os.environ["POSTGRES_ADMIN_URL"].rsplit("/",1)[0]
db=sessionmaker(bind=create_engine(base+"/grc_complyverse"))()
from grc.models import CommonControlGroup, CommonControlGroupMapping, ParsedFrameworkControl, UploadedFramework
from grc.modules.control_library.services import normalization as N
from grc.modules.control_library.routers.groups import get_openai_client
client=get_openai_client()
RUN=15
fwn={f.id:f.name for f in db.query(UploadedFramework).all()}
# domain groups: name -> id
groups={g.name:g.id for g in db.query(CommonControlGroup).filter(CommonControlGroup.run_id==RUN).all()}
domain_names=list(groups.keys())
print(f"{len(domain_names)} domains")
# uncovered controls
covered={r[0] for r in db.execute(sqltext(f"SELECT DISTINCT parsed_control_id FROM grc_normalized_control_links l JOIN grc_normalized_controls nc ON nc.id=l.normalized_control_id WHERE nc.run_id={RUN}")).fetchall()}
rows=db.query(ParsedFrameworkControl).all()
unc=[p for p in rows if p.id not in covered]
print(f"uncovered to place: {len(unc)}")
mem=[{"ref_id":p.id,"framework":fwn.get(p.uploaded_framework_id,'?'),"name":(p.title or '')[:200],
      "text":(p.description or p.full_text or '')[:300]} for p in unc]
mem=N._interleave_by_framework(mem)
tags=N._classify_to_taxonomy(client, mem, domain_names)
# ensure an Other group for no-fits
if "Other / Uncategorized" not in groups:
    g=CommonControlGroup(tenant_id=1, run_id=RUN, code="DOM-99", name="Other / Uncategorized",
                         domain="Other / Uncategorized", category="Other / Uncategorized")
    db.add(g); db.flush(); groups["Other / Uncategorized"]=g.id
added=0; cnt=Counter()
for m,t in zip(mem,tags):
    dom=t if t in groups else "Other / Uncategorized"
    gid=groups[dom]
    ex=db.execute(sqltext(f"SELECT 1 FROM grc_common_control_group_mappings WHERE group_id={gid} AND parsed_control_id={m['ref_id']}")).fetchone()
    if not ex:
        db.add(CommonControlGroupMapping(group_id=gid, parsed_control_id=m["ref_id"], mapping_source="standalone", mapping_confidence=1.0))
        added+=1; cnt[dom]+=1
db.commit()
print(f"added {added} standalone controls into domains:")
for d,c in cnt.most_common(): print(f"  +{c:4d}  {d}")
# final totals
tot=db.execute(sqltext("SELECT count(*) FROM grc_parsed_framework_controls")).scalar()
inlib=db.execute(sqltext(f"SELECT count(DISTINCT parsed_control_id) FROM grc_common_control_group_mappings WHERE parsed_control_id IS NOT NULL AND group_id IN (SELECT id FROM grc_common_control_groups WHERE run_id={RUN})")).scalar()
print(f"\nLIBRARY NOW: {inlib}/{tot} controls present ({100*inlib//tot}%)")
print("UNIQUESDONE")
db.close()
