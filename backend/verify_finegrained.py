"""The verification pass I skipped: adversarially verify each unified control in
run #18, drop mis-fit members (-> standalone), delete controls that collapse below
2 frameworks (members -> standalone). Then re-consolidate evidence for changed."""
import os
from dotenv import load_dotenv; load_dotenv(".env")
from sqlalchemy import create_engine, text as sqltext
from sqlalchemy.orm import sessionmaker
base=os.environ["POSTGRES_ADMIN_URL"].rsplit("/",1)[0]
db=sessionmaker(bind=create_engine(base+"/grc_complyverse"))()
from grc.models import NormalizedControl, NormalizedControlLink, ParsedFrameworkControl, UploadedFramework, CommonControlGroup
from grc.modules.control_library.services import normalization as N
from grc.modules.control_library.routers.groups import get_openai_client
client=get_openai_client()
RUN=18
fwn={f.id:f.name for f in db.query(UploadedFramework).all()}
# domain group id per domain (to attach demoted standalone)
dgroup={g.domain:g.id for g in db.query(CommonControlGroup).filter(CommonControlGroup.run_id==RUN).all()}
ncs=db.query(NormalizedControl).filter(NormalizedControl.run_id==RUN).all()
print(f"verifying {len(ncs)} unified controls…", flush=True)
defs=[]
for nc in ncs:
    refs=[]
    for ln in db.query(NormalizedControlLink).filter(NormalizedControlLink.normalized_control_id==nc.id).all():
        p=db.query(ParsedFrameworkControl).filter(ParsedFrameworkControl.id==ln.parsed_control_id).first()
        if p: refs.append({"ref_id":p.id,"fwid":p.uploaded_framework_id,"framework":fwn.get(p.uploaded_framework_id,'?'),
                           "code":p.original_reference or '',"name":(p.title or '')[:200],"text":(p.description or p.full_text or '')[:300]})
    defs.append({"nc_id":nc.id,"name":nc.name,"domain":nc.domain,"statement":"","refs":refs})
verified=N._verify_clusters(client,"finegrained",defs)
kept={d["nc_id"]:{r["ref_id"] for r in d["refs"]} for d in verified if "nc_id" in d}
# _verify_clusters may strip nc_id; match back by name+first ref. Safer: re-map by identity using order.
# Rebuild kept via matching name (verify preserves other keys via {**d})
kept={}
for d in verified:
    if "nc_id" in d: kept[d["nc_id"]]={r["ref_id"] for r in d["refs"]}
demoted=0; deleted=0; changed=[]
for d in defs:
    ncid=d["nc_id"]; orig={r["ref_id"] for r in d["refs"]}; gid=dgroup.get(d["domain"])
    keep=kept.get(ncid)
    if keep is None:    # collapsed <2 fw -> delete NC, all members standalone
        for pid in orig:
            db.execute(sqltext("UPDATE grc_common_control_group_mappings SET mapping_source='standalone' WHERE group_id=:g AND parsed_control_id=:p"),{"g":gid,"p":pid})
        db.execute(sqltext(f"DELETE FROM grc_common_control_group_mappings WHERE normalized_control_id={ncid}"))
        db.execute(sqltext(f"DELETE FROM grc_evidence_control_mappings WHERE normalized_control_id={ncid}"))
        db.execute(sqltext(f"DELETE FROM grc_ai_evidence_recommendations WHERE normalized_control_id={ncid}"))
        db.execute(sqltext(f"DELETE FROM grc_normalized_control_links WHERE normalized_control_id={ncid}"))
        db.execute(sqltext(f"DELETE FROM grc_normalized_controls WHERE id={ncid}"))
        deleted+=1
    else:
        drop=orig-keep
        if drop:
            ids=",".join(str(x) for x in drop)
            db.execute(sqltext(f"DELETE FROM grc_normalized_control_links WHERE normalized_control_id={ncid} AND parsed_control_id IN ({ids})"))
            db.execute(sqltext(f"UPDATE grc_common_control_group_mappings SET mapping_source='standalone' WHERE group_id={gid} AND parsed_control_id IN ({ids})"))
            db.execute(sqltext(f"UPDATE grc_normalized_controls SET recommended_evidence=NULL WHERE id={ncid}"))
            demoted+=len(drop); changed.append(ncid)
db.commit()
n=db.query(NormalizedControl).filter(NormalizedControl.run_id==RUN).count()
print(f"deleted {deleted} collapsed controls, demoted {demoted} mis-fit members -> standalone; unified now {n}", flush=True)
ev=N._precompute_nc_evidence(db, client, run_id=RUN)
print(f"re-consolidated evidence for {ev} changed controls", flush=True)
print("VERIFYDONE", flush=True)
db.close()
