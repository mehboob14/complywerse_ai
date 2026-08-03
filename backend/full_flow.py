"""Run the FULL Auto-Group pipeline exactly like the button does:
grouping (Stage 1) -> normalization (Stage 2, pure-AI) -> evidence consolidation.
"""
import os
from dotenv import load_dotenv; load_dotenv(".env")
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
base = os.environ["POSTGRES_ADMIN_URL"].rsplit("/", 1)[0]
db = sessionmaker(bind=create_engine(base + "/grc_complyverse"))()

import grc.modules.control_library.routers.groups as G
from grc.modules.control_library.services.normalization import run_normalization

TENANT = 1

def pg(done, total, msg=""):
    print(f"  [grouping {done}/{total}]", flush=True)

print("STAGE 1 — grouping all controls into domains…", flush=True)
controls = G._fetch_controls_for_grouping(db, TENANT)
print(f"  fetched {len(controls)} controls", flush=True)
ai_groups = G.ai_auto_group_controls(controls, progress_cb=None)
print(f"  AI produced {len(ai_groups)} domain groups", flush=True)
summary = G.persist_ai_groups(db, TENANT, None, ai_groups)
print(f"  persisted: {summary.get('created_count')} groups", flush=True)

print("\nSTAGE 2 — normalization (pure-AI) + evidence consolidation…", flush=True)
def pn(p, t, msg=""):
    print(f"  [{p}%] {msg}", flush=True)
res = run_normalization(db, TENANT, None, progress_cb=pn, should_cancel=None)
print("\nDONE:", res, flush=True)
db.close()
