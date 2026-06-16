"""End-to-end PDF → CompliancePlugin rows pipeline.

Idempotent on (benchmark, rule_id): re-uploading the same PDF (or a newer
revision) updates existing rows in place rather than duplicating.
"""
from __future__ import annotations

import hashlib
import logging
import re
from datetime import datetime
from typing import Any

from sqlalchemy.orm import Session

from grc.models import CisIngestJob, CompliancePlugin

from .extract_pages import extract_all_pages
from .parse_rules import depth_of, parent_of, split_into_rules_with_log
from .parse_fields import assemble_plugin_fields
from .gen_check import synthesise

logger = logging.getLogger(__name__)


def _infer_benchmark_label(filename: str, head_text: str) -> str:
    """Pick a stable benchmark slug from the title page or filename."""
    # Try the first ~3 KB of the document — CIS title pages always include
    # something like "CIS Amazon Web Services Foundations Benchmark v3.0.0"
    head = (head_text or "")[:3000]
    m = re.search(
        r"CIS\s+([A-Za-z0-9 .&/-]{3,80}?)\s+Benchmark\s*(?:v?(\d+(?:\.\d+){0,2}))?",
        head,
        flags=re.IGNORECASE,
    )
    if m:
        product = re.sub(r"\s+", "_", m.group(1).strip()).upper()
        ver = m.group(2) or "vUNKNOWN"
        return f"CIS_{product}_v{ver}"
    # Fallback to filename stem
    base = re.sub(r"\.[Pp][Dd][Ff]$", "", filename)
    return re.sub(r"[^A-Za-z0-9_.-]+", "_", base)[:200] or "CIS_UNKNOWN"


def ingest_pdf(
    db: Session,
    pdf_bytes: bytes,
    original_filename: str,
    *,
    tenant_id: int | None,
    uploaded_by: int | None,
    reuse_job: CisIngestJob | None = None,
) -> CisIngestJob:
    """Run the whole pipeline and return the persisted job row.

    If ``reuse_job`` is provided, the pipeline runs against that existing
    job row instead of creating a new one — used by the "Re-parse"
    endpoint so a single upload can be rerun across parser fixes
    without duplicating CisIngestJob rows or re-uploading bytes.
    """
    sha = hashlib.sha256(pdf_bytes).hexdigest()
    if reuse_job is not None:
        job = reuse_job
        # Reset the counters / log so the re-parsed numbers are not
        # additive on top of the previous run.
        job.status = "running"
        job.started_at = datetime.utcnow()
        job.completed_at = None
        job.error_text = None
        job.page_count = None
        job.ocr_pages = 0
        job.rules_extracted = 0
        job.rules_inserted = 0
        job.rules_updated = 0
        job.rules_flagged = 0
        job.rules_toc_rejected = 0
        job.benchmark_label = None
        job.extraction_log = []
        job.sha256 = sha
        job.pdf_bytes = pdf_bytes
        db.commit()
        db.refresh(job)
    else:
        job = CisIngestJob(
            tenant_id=tenant_id,
            uploaded_by=uploaded_by,
            original_filename=original_filename,
            sha256=sha,
            status="running",
            started_at=datetime.utcnow(),
            extraction_log=[],
            pdf_bytes=pdf_bytes,
        )
        db.add(job)
        db.commit()
        db.refresh(job)

    log: list[dict[str, Any]] = []

    try:
        # Stage 1 — extract pages (with streaming progress updates so the
        # UI can show a real progress bar while OCR runs).
        pages: list[dict] = []
        ocr_pages = 0
        for idx, page in enumerate(extract_all_pages(pdf_bytes)):
            pages.append(page)
            if page.get("ocr_used"):
                ocr_pages += 1
            # Flush progress every 25 pages so the polling UI sees a
            # moving bar instead of an opaque "Processing..." for two
            # whole minutes. Wrapped in try/except — failed commit here
            # must NOT abort the ingest.
            if (idx + 1) % 25 == 0:
                try:
                    job.page_count = (idx + 1)  # rolling, will be overwritten at end
                    job.ocr_pages = ocr_pages
                    job.extraction_log = log + [{"stage": "extracting", "current_page": idx + 1}]
                    db.commit()
                    db.refresh(job)
                except Exception:
                    db.rollback()
        full_text = "\n".join(p["text"] for p in pages)
        job.page_count = len(pages)
        job.ocr_pages = ocr_pages
        log.append({"stage": "extract", "pages": len(pages), "ocr_pages": ocr_pages})
        db.commit()

        # Stage 2 — derive benchmark slug from the title-page text
        benchmark_label = _infer_benchmark_label(original_filename, full_text)
        job.benchmark_label = benchmark_label
        log.append({"stage": "infer_benchmark", "benchmark": benchmark_label})
        db.commit()

        # Stage 3 — split into rules, assemble fields. The splitter also
        # returns a per-reason rejection breakdown (TOC dot-leaders, bare
        # section headers, quoted-value-only headings, …) so the user can
        # see how much noise was filtered out before review.
        raw_rules, rejected_reasons = split_into_rules_with_log(full_text)
        toc_rejected = sum(rejected_reasons.values())
        log.append(
            {
                "stage": "split_rules",
                "count": len(raw_rules),
                "rejected": toc_rejected,
                "rejected_breakdown": rejected_reasons,
            }
        )
        job.rules_extracted = len(raw_rules)
        job.rules_toc_rejected = toc_rejected
        if not raw_rules:
            job.status = "failed"
            job.error_text = (
                "No rule headings detected. The PDF may be image-only "
                "(OCR fired on every page) and OCR quality was insufficient, "
                "or the document is not a CIS-style benchmark."
            )
            job.completed_at = datetime.utcnow()
            job.extraction_log = log
            db.commit()
            return job

        # Stage 4 — upsert rules; first pass without parent linkage so we
        # have IDs for every rule, then a second pass to wire parents.
        inserted = 0
        updated = 0
        flagged = 0
        rule_id_to_pk: dict[str, int] = {}
        total_rules = len(raw_rules)
        for rule_idx, r in enumerate(raw_rules):
            # Flush progress every 25 rules so the UI shows synthesis progress
            if rule_idx > 0 and rule_idx % 25 == 0:
                try:
                    job.rules_inserted = inserted
                    job.rules_updated = updated
                    job.rules_flagged = flagged
                    job.extraction_log = log + [{
                        "stage": "synthesizing_checks",
                        "current_rule": rule_idx,
                        "total_rules": total_rules,
                    }]
                    db.commit()
                    db.refresh(job)
                except Exception:
                    db.rollback()
            fields = assemble_plugin_fields(r, benchmark_label)
            # CIS audit text often says "Navigate to UI Path articulated in the
            # Remediation section..." — the actual registry path/value is then
            # in Remediation (and sometimes the Default Value section). To
            # boost executable-check coverage from ~60% to ~90%, pass the
            # combined text so the synthesiser can pick up registry patterns
            # from any of those sections.
            secs = r["sections"]
            combined_audit = (
                (secs.get("Audit") or "")
                + "\n\n---REMEDIATION---\n"
                + (secs.get("Remediation") or "")
                + "\n\n---DEFAULT_VALUE---\n"
                + (secs.get("Default Value") or "")
            )
            check_def, auto_gen = synthesise(
                combined_audit,
                fields["runner_type"],
                rule_id=r.get("rule_id"),
                title=r.get("title"),
            )
            if fields["review_status"] == "pending_review":
                flagged += 1

            tenant_filter = (
                CompliancePlugin.tenant_id.is_(None)
                if tenant_id is None
                else CompliancePlugin.tenant_id == tenant_id
            )
            existing = (
                db.query(CompliancePlugin)
                .filter(tenant_filter, CompliancePlugin.plugin_key == fields["plugin_key"])
                .first()
            )
            # Auto-generated checks USED to force pending_review here
            # regardless of confidence, on the theory that synthesised
            # PowerShell could be wrong. Removed per operator feedback:
            # high-confidence rules with auto-generated checks have proven
            # accurate (100% concrete extraction across both Windows
            # benchmarks today), so we honour the confidence threshold
            # from parse_fields (≥0.6 → auto_approved). Low-confidence
            # rules still go to the queue.
            pass
            # `enabled` mirrors review_status: an auto_approved rule is
            # ready to scan; a pending_review rule must be approved first.
            # Without this link, Scan All silently no-ops on freshly
            # uploaded rules because the filter requires enabled=True.
            initial_enabled = fields["review_status"] == "auto_approved"
            if existing is None:
                row = CompliancePlugin(
                    tenant_id=tenant_id,
                    is_builtin=tenant_id is None,
                    enabled=initial_enabled,
                    check_definition=check_def,
                    auto_generated_check=auto_gen,
                    source_ingest_job_id=job.id,
                    depth=depth_of(r["rule_id"]),
                    **fields,
                )
                db.add(row)
                db.flush()
                inserted += 1
                rule_id_to_pk[r["rule_id"]] = row.id
            else:
                for k, v in fields.items():
                    setattr(existing, k, v)
                existing.check_definition = check_def
                existing.auto_generated_check = auto_gen
                existing.source_ingest_job_id = job.id
                existing.depth = depth_of(r["rule_id"])
                # Re-ingest forces re-review of any auto-generated check so a
                # PDF re-upload can never silently re-enable executable rules.
                if auto_gen or fields["review_status"] == "pending_review":
                    existing.enabled = False
                    existing.review_status = "pending_review"
                updated += 1
                rule_id_to_pk[r["rule_id"]] = existing.id

        # Stage 5 — second pass: wire parent_plugin_id from numeric prefix.
        # Always assign (including None) so re-ingest cannot leave stale parents.
        for rid, pk in rule_id_to_pk.items():
            parent_rid = parent_of(rid)
            new_parent_pk = rule_id_to_pk.get(parent_rid) if parent_rid else None
            row = db.query(CompliancePlugin).get(pk)
            if row is not None:
                row.parent_plugin_id = new_parent_pk

        job.rules_inserted = inserted
        job.rules_updated = updated
        job.rules_flagged = flagged
        job.status = "completed"
        job.completed_at = datetime.utcnow()
        log.append({"stage": "upsert", "inserted": inserted, "updated": updated, "flagged": flagged})
        job.extraction_log = log
        db.commit()

        # Stage 5 — sibling DETECTION (read-only, never modifies anything).
        # We DO NOT auto-archive older versions or auto-flip OS→benchmark
        # mappings — operator policy decision per Hassan: a bank may keep
        # production assets pinned to v5.0.1 for audit-trail reasons while
        # piloting v5.0.2 in lab. Same-label re-ingests are idempotent via
        # the existing UPSERT; different-version PDFs co-exist in the
        # library hierarchically. Promotion (archive old + flip mapping)
        # is exposed as a separate operator-driven admin action — see
        # `benchmark_supersession.promote_to_supersede` (manual call).
        try:
            from .benchmark_supersession import detect_superseded_siblings
            detection = detect_superseded_siblings(
                db, benchmark_label, tenant_id=tenant_id,
            )
            if detection["older_siblings"] or detection["newer_siblings"]:
                log.append({
                    "stage": "version_detection",
                    "new_label": benchmark_label,
                    "older_siblings": detection["older_siblings"],
                    "newer_siblings": detection["newer_siblings"],
                    "active_mapping_rows": detection["active_mapping_rows"],
                    "note": "Variants co-exist in library. Use admin "
                            "'Promote benchmark' action to flip mappings.",
                })
                fresh = db.query(CisIngestJob).get(job.id)  # type: ignore[assignment]
                if fresh is not None:
                    fresh.extraction_log = log
                    db.commit()
                    job = fresh
        except Exception:  # noqa: BLE001
            # Detection is purely informational. Don't let it fail the
            # ingest under any circumstance.
            logger.exception("sibling detection failed for %s", benchmark_label)
        return job
    except Exception as exc:  # noqa: BLE001
        logger.exception("CIS ingest failed: %s", exc)
        db.rollback()
        # Reload job — rollback wiped pending changes
        job = db.query(CisIngestJob).get(job.id)  # type: ignore[assignment]
        job.status = "failed"
        job.error_text = f"{type(exc).__name__}: {exc}"
        job.completed_at = datetime.utcnow()
        job.extraction_log = log
        db.commit()
        return job
