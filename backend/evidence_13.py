"""Consolidate AI-merged evidence for the current baseline (run #13)."""
import os
from dotenv import load_dotenv; load_dotenv(".env")
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from datetime import datetime
base=os.environ["POSTGRES_ADMIN_URL"].rsplit("/",1)[0]
db=sessionmaker(bind=create_engine(base+"/grc_complyverse"))()
from grc.models import NormalizedControl, NormalizationRun
from grc.modules.control_library.services import normalization as N
from grc.modules.control_library.routers.groups import get_openai_client
client=get_openai_client()
run=db.query(NormalizationRun).order_by(NormalizationRun.id.desc()).first(); RUN=run.id
n=db.query(NormalizedControl).filter(NormalizedControl.run_id==RUN).count()
print(f"consolidating evidence for run #{RUN} ({n} controls)...", flush=True)
done=N._precompute_nc_evidence(db, client, run_id=RUN)
ev=db.query(NormalizedControl).filter(NormalizedControl.run_id==RUN, NormalizedControl.recommended_evidence.isnot(None)).count()
run.summary={**(run.summary or {}), "unified_controls":n, "evidence_consolidated":ev}
run.completed_at=datetime.utcnow(); db.commit()
print(f"EVIDENCEDONE {ev}/{n} controls have consolidated evidence", flush=True)
db.close()
