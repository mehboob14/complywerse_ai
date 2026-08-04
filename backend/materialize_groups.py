"""Materialize run #14's 130 NormalizedControls into the CommonControlGroup layer
that the Control Library page lists. One group per normalized control, mapped to
the NC + all its parsed framework members."""
import os
from dotenv import load_dotenv; load_dotenv(".env")
from sqlalchemy import create_engine, text as sqltext
from sqlalchemy.orm import sessionmaker
base=os.environ["POSTGRES_ADMIN_URL"].rsplit("/",1)[0]
db=sessionmaker(bind=create_engine(base+"/grc_complyverse"))()
from grc.models import (NormalizedControl, NormalizedControlLink, NormalizationRun,
                        CommonControlGroup, CommonControlGroupMapping)
RUN=db.query(NormalizationRun).order_by(NormalizationRun.id.desc()).first().id
# clean any stale groups for this tenant first (was 0, but be safe)
db.execute(sqltext("DELETE FROM grc_common_control_group_mappings"))
db.execute(sqltext("DELETE FROM grc_common_control_groups WHERE tenant_id=1"))
db.commit()
ncs=db.query(NormalizedControl).filter(NormalizedControl.run_id==RUN).order_by(NormalizedControl.code).all()
seq=0; gmaps=0
for nc in ncs:
    seq+=1
    g=CommonControlGroup(tenant_id=1, run_id=RUN, code=f"CCG-{seq:04d}", name=nc.name,
                         description=nc.statement or None, created_by=None)
    db.add(g); db.flush()
    db.add(CommonControlGroupMapping(group_id=g.id, normalized_control_id=nc.id,
                                     mapping_source="ai_normalized", mapping_confidence=1.0))
    gmaps+=1
    for ln in db.query(NormalizedControlLink).filter(NormalizedControlLink.normalized_control_id==nc.id).all():
        if ln.parsed_control_id:
            db.add(CommonControlGroupMapping(group_id=g.id, parsed_control_id=ln.parsed_control_id,
                                             mapping_source="ai_normalized", mapping_confidence=1.0))
            gmaps+=1
db.commit()
ng=db.query(CommonControlGroup).filter(CommonControlGroup.tenant_id==1).count()
print(f"MATERIALIZED {ng} groups, {gmaps} mappings (run #{RUN})")
db.close()
