"""Recall-recovery for run #14: re-classify the uncovered controls onto the 130
masters across 3 passes; recover a control only if >=2 passes agree on the SAME
master (consensus = precision). Link recovered controls into the normalized layer
AND the page's CommonControlGroup layer. Mark affected masters for evidence re-merge."""
import os
from collections import Counter, defaultdict
from dotenv import load_dotenv; load_dotenv(".env")
from sqlalchemy import create_engine, text as sqltext
from sqlalchemy.orm import sessionmaker
base=os.environ["POSTGRES_ADMIN_URL"].rsplit("/",1)[0]
db=sessionmaker(bind=create_engine(base+"/grc_complyverse"))()
from grc.models import (NormalizedControl, NormalizedControlLink, NormalizationRun,
                        ParsedFrameworkControl, UploadedFramework,
                        CommonControlGroup, CommonControlGroupMapping)
from grc.modules.control_library.services import normalization as N
from grc.modules.control_library.routers.groups import get_openai_client
client=get_openai_client()
fwn={f.id:f.name for f in db.query(UploadedFramework).all()}
RUN=db.query(NormalizationRun).order_by(NormalizationRun.id.desc()).first().id
ncs=db.query(NormalizedControl).filter(NormalizedControl.run_id==RUN).all()
name2nc={nc.name:nc for nc in ncs}
master_names=list(name2nc.keys())
# nc_id -> group_id (via the normalized_control_id mapping created in materialize)
nc2group={}
for gm in db.query(CommonControlGroupMapping).filter(CommonControlGroupMapping.normalized_control_id.isnot(None)).all():
    nc2group[gm.normalized_control_id]=gm.group_id

# uncovered controls
covered_ids={r[0] for r in db.execute(sqltext(f"SELECT DISTINCT parsed_control_id FROM grc_normalized_control_links l JOIN grc_normalized_controls nc ON nc.id=l.normalized_control_id WHERE nc.run_id={RUN}")).fetchall()}
rows=db.query(ParsedFrameworkControl).all()
unc=[p for p in rows if p.id not in covered_ids]
mem=[{"ref":"p","ref_id":p.id,"framework":fwn.get(p.uploaded_framework_id,'?'),"fwid":p.uploaded_framework_id,
      "code":p.original_reference or '',"name":(p.title or '')[:200],"text":(p.description or p.full_text or '')[:300]} for p in unc]
mem=N._interleave_by_framework(mem)
print(f"uncovered to recover: {len(mem)}; 3-pass consensus classify onto {len(master_names)} masters...", flush=True)
votes=defaultdict(list)
for pno in range(3):
    tags=N._classify_to_taxonomy(client, mem, master_names)
    for m,t in zip(mem,tags):
        if t and t in name2nc: votes[m["ref_id"]].append(t)
    got=sum(1 for v in votes.values() if v)
    print(f"  pass {pno+1}: {got} controls have >=1 vote so far", flush=True)

# consensus: master that got >=2 of 3 votes
recovered=defaultdict(list)   # master_name -> [member dicts]
mem_by_id={m["ref_id"]:m for m in mem}
for rid,vs in votes.items():
    if not vs: continue
    top,cnt=Counter(vs).most_common(1)[0]
    if cnt>=2:
        recovered[top].append(mem_by_id[rid])
nrec=sum(len(v) for v in recovered.values())
print(f"  consensus-recovered: {nrec} controls into {len(recovered)} masters", flush=True)

# link recovered into normalized layer + group layer; mark masters for evidence remerge
changed_ncids=set(); added=0
for master,mems in recovered.items():
    nc=name2nc[master]; gid=nc2group.get(nc.id)
    for m in mems:
        # guard against dup link
        ex=db.query(NormalizedControlLink).filter(NormalizedControlLink.normalized_control_id==nc.id, NormalizedControlLink.parsed_control_id==m["ref_id"]).first()
        if ex: continue
        db.add(NormalizedControlLink(normalized_control_id=nc.id, parsed_control_id=m["ref_id"], mapping_type="direct"))
        if gid:
            db.add(CommonControlGroupMapping(group_id=gid, parsed_control_id=m["ref_id"], mapping_source="ai_recall", mapping_confidence=0.9))
        changed_ncids.add(nc.id); added+=1
# null-out evidence for changed masters so it re-merges with new members
if changed_ncids:
    db.execute(sqltext(f"UPDATE grc_normalized_controls SET recommended_evidence=NULL WHERE id IN ({','.join(str(x) for x in changed_ncids)})"))
db.commit()
cov=len(db.execute(sqltext(f"SELECT DISTINCT parsed_control_id FROM grc_normalized_control_links l JOIN grc_normalized_controls nc ON nc.id=l.normalized_control_id WHERE nc.run_id={RUN}")).fetchall())
print(f"RECOVERDONE added {added} links into {len(changed_ncids)} masters; coverage now {cov}/3419 ({100*cov//3419}%)", flush=True)
db.close()
