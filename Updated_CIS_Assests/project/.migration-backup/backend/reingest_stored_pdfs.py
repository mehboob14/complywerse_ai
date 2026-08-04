"""Re-ingest both stored CIS PDFs through the enhanced pipeline.

The bytes are already in grc_cis_ingest_jobs.pdf_bytes — no need to
re-upload the original files. We call ingest_pdf(reuse_job=...) which:
  • Idempotent-upserts (benchmark, rule_id) → existing rules get refreshed
  • Runs the new OCR preprocessing + post-correction on every page that
    falls back to OCR
  • Re-synthesizes check_definition for each rule using the latest
    gen_check.py (which means the message-clarity improvements + the
    catalog-based handlers also get applied during this single pass).
"""
from __future__ import annotations
import os, time
from dotenv import load_dotenv
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

load_dotenv()
eng = create_engine(os.environ["DATABASE_URL"])
Session = sessionmaker(bind=eng)

from grc.models import CisIngestJob
from grc.modules.compliance_plugins.pdf_ingest import ingest_pdf

sess = Session()
try:
    jobs = sess.query(CisIngestJob).order_by(CisIngestJob.id).all()
    print(f"Found {len(jobs)} stored PDF jobs to re-ingest.\n")
    for j in jobs:
        if not j.pdf_bytes:
            print(f"  [{j.id}] {j.original_filename}: no bytes stored, skipping")
            continue
        print(f"=== Re-ingesting [{j.id}] {j.original_filename} ===")
        print(f"  benchmark: {j.benchmark_label}")
        print(f"  size:      {len(j.pdf_bytes) / 1024 / 1024:.2f} MB")
        t0 = time.time()
        result = ingest_pdf(
            sess, j.pdf_bytes, j.original_filename,
            tenant_id=None, uploaded_by=None, reuse_job=j,
        )
        sess.commit()
        elapsed = time.time() - t0
        print(f"  status:    {result.status}")
        print(f"  rules:     extracted={result.rules_extracted}, inserted={result.rules_inserted}, updated={result.rules_updated}")
        print(f"  ocr pages: {result.ocr_pages} of {result.page_count}")
        print(f"  elapsed:   {elapsed:.1f}s\n")
finally:
    sess.close()
