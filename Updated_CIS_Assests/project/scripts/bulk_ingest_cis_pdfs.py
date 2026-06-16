"""Bulk-ingest every CIS PDF in a folder through the pipeline.

Usage:
    python scripts/bulk_ingest_cis_pdfs.py "C:/Users/HP/Downloads/CIS BENCHMARKS"

Reads every *.pdf in the folder (non-recursive), feeds it through
grc.modules.compliance_plugins.pdf_ingest.pipeline.ingest_pdf, writes
progress to stdout, persists results to the platform DB. Skips PDFs
that have already been ingested (matched by sha256) unless --force
is passed.

The script is idempotent — re-running it skips already-ingested PDFs.
Designed for the 200+ PDF bank library import.
"""
from __future__ import annotations

import argparse
import hashlib
import os
import sys
import time
from pathlib import Path

# Make backend importable
sys.path.insert(
    0,
    str(Path(__file__).resolve().parents[1] / ".migration-backup" / "backend")
)

from dotenv import load_dotenv  # noqa: E402

load_dotenv(
    Path(__file__).resolve().parents[1]
    / ".migration-backup"
    / "backend"
    / ".env"
)

from grc.models import SessionLocal, CisIngestJob  # noqa: E402
from grc.modules.compliance_plugins.pdf_ingest.pipeline import ingest_pdf  # noqa: E402


def already_ingested(db, sha256_hex: str) -> bool:
    return (
        db.query(CisIngestJob)
        .filter(CisIngestJob.sha256 == sha256_hex)
        .filter(CisIngestJob.status == "completed")
        .first()
        is not None
    )


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("folder", help="Folder containing .pdf files")
    parser.add_argument("--tenant-id", type=int, default=None,
                        help="Tenant scope (None = global library)")
    parser.add_argument("--uploaded-by", type=int, default=12,
                        help="User id stamped as uploader")
    parser.add_argument("--force", action="store_true",
                        help="Re-ingest even if sha256 matches an existing job")
    parser.add_argument("--limit", type=int, default=None,
                        help="Process at most N PDFs (smoke test)")
    args = parser.parse_args()

    folder = Path(args.folder)
    if not folder.is_dir():
        sys.exit(f"Not a directory: {folder}")

    pdfs = sorted(folder.glob("*.pdf")) + sorted(folder.glob("*.PDF"))
    pdfs = list(dict.fromkeys(pdfs))  # de-dupe case-insensitive
    if args.limit:
        pdfs = pdfs[: args.limit]

    print(f"Found {len(pdfs)} PDF files in {folder}")
    print()

    db = SessionLocal()
    try:
        stats = {
            "total": len(pdfs),
            "ingested_ok": 0,
            "skipped_already": 0,
            "failed": 0,
            "total_rules_inserted": 0,
        }
        for i, pdf_path in enumerate(pdfs, 1):
            try:
                pdf_bytes = pdf_path.read_bytes()
                sha = hashlib.sha256(pdf_bytes).hexdigest()
                if not args.force and already_ingested(db, sha):
                    print(f"[{i:>3}/{stats['total']}] SKIP {pdf_path.name}  "
                          f"(already ingested)")
                    stats["skipped_already"] += 1
                    continue
                t0 = time.time()
                job = ingest_pdf(
                    db,
                    pdf_bytes,
                    pdf_path.name,
                    tenant_id=args.tenant_id,
                    uploaded_by=args.uploaded_by,
                )
                dt = time.time() - t0
                status = job.status
                inserted = getattr(job, "rules_inserted", 0) or 0
                updated = getattr(job, "rules_updated", 0) or 0
                flagged = getattr(job, "rules_flagged", 0) or 0
                bench = getattr(job, "benchmark_label", "?") or "?"
                if status == "completed":
                    stats["ingested_ok"] += 1
                    stats["total_rules_inserted"] += inserted
                    print(f"[{i:>3}/{stats['total']}] OK   {pdf_path.name[:60]:<60} "
                          f"{dt:>5.1f}s  "
                          f"+{inserted:>4} ins  +{updated:>4} upd  "
                          f"~{flagged:>3} flag  "
                          f"bench={bench[:55]}")
                else:
                    stats["failed"] += 1
                    err = getattr(job, "error_text", "")
                    print(f"[{i:>3}/{stats['total']}] FAIL {pdf_path.name}  "
                          f"{dt:>5.1f}s  status={status}  err={err[:120]}")
            except Exception as exc:  # noqa: BLE001
                stats["failed"] += 1
                print(f"[{i:>3}/{stats['total']}] CRASH {pdf_path.name}  "
                      f"{type(exc).__name__}: {exc}")
                # Rollback any partial work for this file and continue with the next
                try:
                    db.rollback()
                except Exception:
                    pass
        print()
        print("-" * 70)
        print(f"Total PDFs:           {stats['total']}")
        print(f"Newly ingested:       {stats['ingested_ok']}")
        print(f"Skipped (already):    {stats['skipped_already']}")
        print(f"Failed:               {stats['failed']}")
        print(f"Total rules inserted: {stats['total_rules_inserted']}")
    finally:
        db.close()


if __name__ == "__main__":
    main()
