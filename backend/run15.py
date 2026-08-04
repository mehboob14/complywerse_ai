"""Run ONE session over 15 well-known frameworks and report results."""
import os
from dotenv import load_dotenv; load_dotenv(".env")
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from datetime import datetime
base = os.environ["POSTGRES_ADMIN_URL"].rsplit("/", 1)[0]
db = sessionmaker(bind=create_engine(base + "/grc_complyverse"))()
from grc.models import NormalizationRun, NormalizedControl, NormalizedControlLink, ParsedFrameworkControl, UploadedFramework
from grc.modules.control_library.services.normalization import run_normalization

TENANT = 1
fwn = {f.id: f.name for f in db.query(UploadedFramework).all()}
# 15 frameworks: security + audit + privacy + resilience
FW = [11, 18, 3, 19, 27, 28, 8, 9, 4, 16, 6, 15, 7, 10, 29]
print("15 frameworks:", [fwn.get(i, i)[:18] for i in FW], flush=True)
nctrl = db.query(ParsedFrameworkControl).filter(ParsedFrameworkControl.uploaded_framework_id.in_(FW)).count()
print(f"controls in scope: {nctrl}", flush=True)

run = NormalizationRun(tenant_id=TENANT, label="15-framework test", scope="custom",
                       framework_ids=FW, status="running", started_at=datetime.utcnow())
db.add(run); db.commit()
print(f"session #{run.id} started", flush=True)
def pg(p, t, msg=""):
    if p % 10 < 2: print(f"  [{p}%] {msg}", flush=True)
res = run_normalization(db, TENANT, None, run_id=run.id, framework_ids=FW, progress_cb=pg, should_cancel=None)

ncs = db.query(NormalizedControl).filter(NormalizedControl.source=='ai_normalized', NormalizedControl.run_id==run.id).all()
spans = []
for nc in ncs:
    fws = set()
    for ln in db.query(NormalizedControlLink).filter(NormalizedControlLink.normalized_control_id==nc.id).all():
        p = db.query(ParsedFrameworkControl).filter(ParsedFrameworkControl.id==ln.parsed_control_id).first()
        if p: fws.add(p.uploaded_framework_id)
    spans.append(len(fws))
run.status = "completed"; run.completed_at = datetime.utcnow()
run.summary = {"unified_controls": len(ncs), "avg_framework_span": round(sum(spans)/max(1,len(spans)),1),
               "max_span": max(spans) if spans else 0}
db.commit()
print(f"\nRESULT: {len(ncs)} unified controls | avg span {run.summary['avg_framework_span']} | max {run.summary['max_span']} frameworks", flush=True)
# top multi-framework
top = sorted(ncs, key=lambda n: -sum(1 for _ in db.query(NormalizedControlLink).filter(NormalizedControlLink.normalized_control_id==n.id)))[:10]
for nc in top:
    fws=set()
    for ln in db.query(NormalizedControlLink).filter(NormalizedControlLink.normalized_control_id==nc.id).all():
        p=db.query(ParsedFrameworkControl).filter(ParsedFrameworkControl.id==ln.parsed_control_id).first()
        if p: fws.add(fwn.get(p.uploaded_framework_id,'?'))
    print(f"   • {nc.name[:40]:40} {len(fws)} frameworks", flush=True)
print("DONE15", flush=True)
db.close()
