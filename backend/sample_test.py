"""Run several SMALL framework-sample sessions (fast) instead of one 40-min full
run. Each sample is its own session, saved incrementally as the pipeline commits.
"""
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

# framework_id samples with known cross-framework overlap
SAMPLES = [
    ("Core Security (ISO27001 + NIST CSF + CIS)", [11, 18, 3]),
    ("Healthcare (HIPAA + HITRUST + Abu Dhabi)",  [8, 9, 1]),
    ("Privacy (GDPR + KSA PDPL + Data Transfer)", [7, 14, 60]),
    ("Audit (PCI + SOC2 + SOX + ISO27001)",       [19, 27, 28, 11]),
]

for label, fw_ids in SAMPLES:
    run = NormalizationRun(tenant_id=TENANT, label=label, scope="custom",
                           framework_ids=fw_ids, status="running",
                           started_at=datetime.utcnow())
    db.add(run); db.commit()
    print(f"\n=== SESSION '{label}' (run #{run.id}, frameworks {fw_ids}) ===", flush=True)
    def pg(p, t, msg=""):
        if p % 20 < 2: print(f"   [{p}%] {msg}", flush=True)
    res = run_normalization(db, TENANT, None, run_id=run.id, framework_ids=fw_ids,
                            progress_cb=pg, should_cancel=None)
    # quick result summary
    ncs = db.query(NormalizedControl).filter(NormalizedControl.source=='ai_normalized',
                                             NormalizedControl.run_id==run.id).all()
    spans = []
    for nc in ncs:
        fws = set()
        for ln in db.query(NormalizedControlLink).filter(NormalizedControlLink.normalized_control_id==nc.id).all():
            p = db.query(ParsedFrameworkControl).filter(ParsedFrameworkControl.id==ln.parsed_control_id).first()
            if p: fws.add(p.uploaded_framework_id)
        spans.append(len(fws))
    run.status = "completed"; run.completed_at = datetime.utcnow()
    run.summary = {"unified_controls": len(ncs), "avg_framework_span": round(sum(spans)/max(1,len(spans)),1)}
    db.commit()
    print(f"   RESULT: {len(ncs)} unified controls, avg span {run.summary['avg_framework_span']} frameworks", flush=True)
    # show a few
    for nc in sorted(ncs, key=lambda n: 0)[:5]:
        fws=set()
        for ln in db.query(NormalizedControlLink).filter(NormalizedControlLink.normalized_control_id==nc.id).all():
            p=db.query(ParsedFrameworkControl).filter(ParsedFrameworkControl.id==ln.parsed_control_id).first()
            if p: fws.add(fwn.get(p.uploaded_framework_id,'?')[:10])
        print(f"      • {nc.name[:40]:40} [{', '.join(sorted(fws))}]", flush=True)

print("\nALL SAMPLES DONE", flush=True)
db.close()
