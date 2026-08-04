"""Rebuild the library as DOMAIN groups: each CommonControlGroup = one domain that
contains MANY normalized controls (+ their framework controls). The detail page's
'Normalized' filter then shows the domain's unified-control count (e.g. 21), not 1.
Keeps the 126 NormalizedControls + their links intact."""
import os
from collections import defaultdict
from dotenv import load_dotenv; load_dotenv(".env")
from sqlalchemy import create_engine, text as sqltext
from sqlalchemy.orm import sessionmaker
base=os.environ["POSTGRES_ADMIN_URL"].rsplit("/",1)[0]
db=sessionmaker(bind=create_engine(base+"/grc_complyverse"))()
from grc.models import NormalizedControl, NormalizedControlLink, CommonControlGroup, CommonControlGroupMapping
RUN=15
# drop existing groups+mappings for the run (NormalizedControls + links untouched)
db.execute(sqltext(f"DELETE FROM grc_common_control_group_mappings WHERE group_id IN (SELECT id FROM grc_common_control_groups WHERE run_id={RUN})"))
db.execute(sqltext(f"DELETE FROM grc_common_control_groups WHERE run_id={RUN}"))
db.commit()
ncs=db.query(NormalizedControl).filter(NormalizedControl.run_id==RUN).all()
by_dom=defaultdict(list)
for nc in ncs: by_dom[nc.domain or "Uncategorized"].append(nc)
seq=0; total_norm=0; total_fw=0
for dom, members in sorted(by_dom.items(), key=lambda x:-len(x[1])):
    seq+=1
    grp=CommonControlGroup(tenant_id=1, run_id=RUN, code=f"DOM-{seq:02d}", name=dom, domain=dom, category=dom, created_by=None)
    db.add(grp); db.flush()
    # point each member control's common_group_id at this domain group
    for nc in members:
        nc.common_group_id=grp.id
        db.add(CommonControlGroupMapping(group_id=grp.id, normalized_control_id=nc.id, mapping_source="domain", mapping_confidence=1.0))
        total_norm+=1
        for ln in db.query(NormalizedControlLink).filter(NormalizedControlLink.normalized_control_id==nc.id).all():
            if ln.parsed_control_id:
                db.add(CommonControlGroupMapping(group_id=grp.id, parsed_control_id=ln.parsed_control_id, mapping_source="domain", mapping_confidence=1.0))
                total_fw+=1
    print(f"  {grp.code}  {dom[:38]:38}  {len(members)} unified controls")
db.commit()
print(f"\nrebuilt {seq} DOMAIN groups | {total_norm} normalized mappings | {total_fw} framework mappings")
print("DOMAINGROUPSDONE")
db.close()
