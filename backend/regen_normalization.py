"""Regenerate all normalized controls with the current (tuned) prompts.

Runs run_normalization directly against every existing domain group for the
complyverse tenant — idempotent per group (clears + rebuilds), so it refreshes
the whole normalized library end-to-end without needing the Celery worker.
"""
import os
from dotenv import load_dotenv; load_dotenv(".env")
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

base = os.environ["POSTGRES_ADMIN_URL"].rsplit("/", 1)[0]
db = sessionmaker(bind=create_engine(base + "/grc_complyverse"))()

from grc.modules.control_library.services.normalization import run_normalization

TENANT_ID = 1

def progress(done, total, msg):
    print(f"  [{done+1}/{total}] {msg}", flush=True)

print("Regenerating normalized controls with tuned prompts...\n", flush=True)
summary = run_normalization(db, TENANT_ID, None, progress_cb=progress, should_cancel=None)
print("\nDONE:", summary, flush=True)
db.close()
