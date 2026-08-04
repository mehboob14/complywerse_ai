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
    """Pick a stable benchmark slug from the title page or filename.

    HARDENED 2026-06-10: previous regex caught generic English words like
    "Provides" or "Security" when they appeared in body text before the
    word "Benchmark" — producing junk labels like CIS_PROVIDES_vvUNKNOWN.
    We now:
      1. PREFER the filename if it starts with CIS_ and contains "Benchmark"
         (filenames are operator-curated and never have parser misfires)
      2. Validate the regex capture against a blacklist of generic words
         that signal a misfire
      3. Require the capture to look like a product (contain at least one
         capitalized noun or version digit)
    """
    # Generic English words that NEVER appear as the start of a real CIS
    # product name. If our regex captures one, it's a parser misfire on
    # body text rather than the title.
    _GENERIC_NOUN_BLACKLIST = {
        "provides", "security", "this", "the", "an", "a",
        "benchmark", "guidance", "control", "controls", "configuration",
        "version", "document", "guide", "best", "practice", "practices",
        "policy", "policies", "and", "to", "for", "with",
    }

    # 1. Try filename first — it's the highest-quality signal because
    # CIS preserves the canonical product+version in the file name itself.
    fbase = re.sub(r"\.[Pp][Dd][Ff]$", "", filename or "")
    if fbase.upper().startswith(("CIS_", "CIS ")) and "BENCHMARK" in fbase.upper():
        return re.sub(r"[^A-Za-z0-9_.-]+", "_", fbase)[:200]

    # 2. Title-page regex — but validate the result against the blacklist.
    head = (head_text or "")[:3000]
    m = re.search(
        r"CIS\s+([A-Za-z0-9 .&/-]{3,80}?)\s+Benchmark\s*(?:v?(\d+(?:\.\d+){0,2}))?",
        head,
        flags=re.IGNORECASE,
    )
    if m:
        raw_product = m.group(1).strip()
        # Reject if the first captured word is a generic noun (parser
        # misfire on a body sentence like "CIS provides ... Benchmark").
        first_word = raw_product.split()[0].lower() if raw_product else ""
        if first_word in _GENERIC_NOUN_BLACKLIST or len(raw_product) < 4:
            pass  # fall through to filename
        else:
            product = re.sub(r"\s+", "_", raw_product).upper()
            ver = m.group(2) or "UNKNOWN"
            return f"CIS_{product}_v{ver}"

    # 3. Fallback to filename stem (sanitised).
    return re.sub(r"[^A-Za-z0-9_.-]+", "_", fbase)[:200] or "CIS_UNKNOWN"


def _truncate_to_second_level(version: str) -> str:
    """Mirror of the agent's helper — keep major.minor only."""
    if not version:
        return version
    parts = version.split('.')
    return '.'.join(parts[:2]) if len(parts) >= 2 else version


# ── Benchmark label → CIS-os-key mapping ──────────────────────────────────
# When we ingest a PDF we infer ONE or more os_keys per plugin so the
# OS-matcher can pick the right plugins for an asset without operators
# needing to maintain a separate grc_benchmark_os_mappings row per
# benchmark. Mappings here mirror our level-2 normalization convention.
#
# (pattern_in_label, os_keys_returned)
# - patterns are case-insensitive substrings
# - the FIRST match wins; order matters for specificity (Windows 11 before
#   Windows 10 etc.)
_BENCHMARK_OS_PATTERNS: list[tuple[re.Pattern, list[str]]] = [
    # Windows family
    (re.compile(r"WINDOWS[_ ]?11", re.I), ["windows-11"]),
    (re.compile(r"WINDOWS[_ ]?10", re.I), ["windows-10"]),
    (re.compile(r"WINDOWS[_ ]?SERVER[_ ]?2025", re.I), ["windows-server-2025"]),
    (re.compile(r"WINDOWS[_ ]?SERVER[_ ]?2022", re.I), ["windows-server-2022"]),
    (re.compile(r"WINDOWS[_ ]?SERVER[_ ]?2019", re.I), ["windows-server-2019"]),
    (re.compile(r"WINDOWS[_ ]?SERVER[_ ]?2016", re.I), ["windows-server-2016"]),
    (re.compile(r"WINDOWS[_ ]?SERVER[_ ]?2012[_ ]?R2", re.I), ["windows-server-2012-r2"]),
    # macOS — capture explicit version like "macOS_14.0" or "Sonoma" name
    (re.compile(r"macOS[_ ]?(\d+)(?:\.(\d+))?", re.I),
     lambda m: [f"macos-{m.group(1)}.{m.group(2) or '0'}"]),
    (re.compile(r"Sequoia", re.I), ["macos-15.0"]),
    (re.compile(r"Sonoma",  re.I), ["macos-14.0"]),
    (re.compile(r"Ventura", re.I), ["macos-13.0"]),
    (re.compile(r"Monterey", re.I), ["macos-12.0"]),
    # Linux distros — explicit version capture
    (re.compile(r"UBUNTU[_ ]?LINUX[_ ]?(\d+)(?:[._](\d+))?", re.I),
     lambda m: [f"ubuntu-{m.group(1)}.{m.group(2) or '04'}"]),
    (re.compile(r"UBUNTU[_ ]?(\d+)(?:[._](\d+))?", re.I),
     lambda m: [f"ubuntu-{m.group(1)}.{m.group(2) or '04'}"]),
    (re.compile(r"DEBIAN[_ ]?LINUX[_ ]?(\d+)", re.I),
     lambda m: [f"debian-{m.group(1)}"]),
    (re.compile(r"ALMALINUX[_ ]?OS[_ ]?(\d+)", re.I),
     lambda m: [f"almalinux-{m.group(1)}"]),
    (re.compile(r"ROCKY[_ ]?LINUX[_ ]?(\d+)", re.I),
     lambda m: [f"rocky-{m.group(1)}"]),
    (re.compile(r"AMAZON[_ ]?LINUX[_ ]?(2023|2|\d+)", re.I),
     lambda m: [f"amazonlinux-{m.group(1)}"]),
    (re.compile(r"ORACLE[_ ]?LINUX[_ ]?(\d+)", re.I),
     lambda m: [f"oraclelinux-{m.group(1)}"]),
    (re.compile(r"RED[_ ]?HAT[_ ]?ENTERPRISE[_ ]?LINUX[_ ]?(\d+)", re.I),
     lambda m: [f"rhel-{m.group(1)}"]),
    (re.compile(r"RHEL[_ ]?(\d+)", re.I), lambda m: [f"rhel-{m.group(1)}"]),
    (re.compile(r"CENTOS[_ ]?(\d+)", re.I), lambda m: [f"rhel-{m.group(1)}"]),
    (re.compile(r"SUSE[_ ]?LINUX[_ ]?ENTERPRISE[_ ]?(\d+)", re.I),
     lambda m: [f"sles-{m.group(1)}"]),
    # Network / firewalls
    (re.compile(r"CISCO[_ ]?IOS[_ ]?XE[_ ]?(\d+)(?:[._](\d+))?", re.I),
     lambda m: [f"cisco-ios-xe-{m.group(1)}.{m.group(2) or '0'}"]),
    (re.compile(r"CISCO[_ ]?IOS[_ ]?XR", re.I), ["cisco-ios-xr"]),
    (re.compile(r"CISCO[_ ]?NX[_ ]?-?OS", re.I), ["cisco-nx-os"]),
    (re.compile(r"CISCO[_ ]?ASA", re.I), ["cisco-asa"]),
    (re.compile(r"CISCO[_ ]?FIREPOWER", re.I), ["cisco-firepower"]),
    (re.compile(r"CISCO[_ ]?FIREWALL", re.I), ["cisco-firewall"]),
    (re.compile(r"pfSENSE", re.I), ["pfsense"]),
    # Databases
    (re.compile(r"ORACLE[_ ]?DATABASE[_ ]?(\d+)", re.I),
     lambda m: [f"oracle-db-{m.group(1)}"]),
    (re.compile(r"MICROSOFT[_ ]?SQL[_ ]?SERVER[_ ]?(\d+)", re.I),
     lambda m: [f"mssql-{m.group(1)}"]),
    (re.compile(r"MYSQL[_ ]?ENTERPRISE[_ ]?EDITION[_ ]?(\d+)(?:[._](\d+))?", re.I),
     lambda m: [f"mysql-{m.group(1)}.{m.group(2) or '0'}"]),
    (re.compile(r"POSTGRESQL[_ ]?(\d+)", re.I),
     lambda m: [f"postgresql-{m.group(1)}"]),
    (re.compile(r"MONGODB[_ ]?(\d+)", re.I), lambda m: [f"mongodb-{m.group(1)}"]),
    (re.compile(r"CASSANDRA[_ ]?(\d+)(?:[._](\d+))?", re.I),
     lambda m: [f"cassandra-{m.group(1)}.{m.group(2) or '0'}"]),
    # Web / app servers
    (re.compile(r"APACHE[_ ]?HTTP[_ ]?SERVER[_ ]?(\d+)(?:[._](\d+))?", re.I),
     lambda m: [f"apache-httpd-{m.group(1)}.{m.group(2) or '0'}"]),
    (re.compile(r"APACHE[_ ]?TOMCAT[_ ]?(\d+)(?:[._](\d+))?", re.I),
     lambda m: [f"tomcat-{m.group(1)}.{m.group(2) or '0'}"]),
    (re.compile(r"NGINX", re.I), ["nginx"]),
    (re.compile(r"IIS[_ ]?(\d+)", re.I), lambda m: [f"iis-{m.group(1)}"]),
    # Containers / orchestration
    (re.compile(r"DOCKER", re.I), ["docker"]),
    (re.compile(r"KUBERNETES", re.I), ["kubernetes"]),
    (re.compile(r"ESXi[_ ]?(\d+)(?:[._](\d+))?", re.I),
     lambda m: [f"vmware-esxi-{m.group(1)}.{m.group(2) or '0'}"]),
    # Cloud foundations
    (re.compile(r"AMAZON[_ ]?WEB[_ ]?SERVICES[_ ]?FOUNDATIONS", re.I), ["aws"]),
    (re.compile(r"AZURE[_ ]?FOUNDATIONS", re.I), ["azure"]),
    (re.compile(r"GOOGLE[_ ]?CLOUD[_ ]?PLATFORM[_ ]?FOUNDATION", re.I), ["gcp"]),
    (re.compile(r"ALIBABA[_ ]?CLOUD[_ ]?FOUNDATION", re.I), ["alibaba"]),
]


def infer_os_keys_from_benchmark(benchmark_label: str, filename: str = "") -> list[str]:
    """Return a list of normalized os_keys (level-2) for a given benchmark
    label or filename. Matches the first applicable pattern.

    Returned keys are ALWAYS at the level-2 convention:
       ubuntu-24.04  (not ubuntu-24.04.2)
       macos-14.0    (not macos-14)
       rhel-9        (no version split needed for single-level distros)

    Returns [] when no pattern matches — operator must add a mapping
    manually (which is rare and only happens for genuinely new OS families).
    """
    haystack = f"{benchmark_label or ''} {filename or ''}"
    for pat, val in _BENCHMARK_OS_PATTERNS:
        m = pat.search(haystack)
        if m:
            keys = val(m) if callable(val) else val
            # Truncate each key's version portion to level-2 for safety.
            out: list[str] = []
            for k in keys:
                # Split distro-version like "ubuntu-24.04.2" → "ubuntu-24.04"
                bits = k.rsplit('-', 1)
                if len(bits) == 2 and re.match(r'^[\d.]+$', bits[1]):
                    bits[1] = _truncate_to_second_level(bits[1])
                    out.append('-'.join(bits))
                else:
                    out.append(k)
            return out
    return []


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
            # Compute level-2 normalised os_keys ONCE per benchmark, share
            # across every plugin in this PDF. This is what the OS→benchmark
            # matcher reads — without it operators have to maintain manual
            # mappings in grc_benchmark_os_mappings for every new PDF.
            inferred_os_keys = infer_os_keys_from_benchmark(
                benchmark_label, original_filename
            )
            if existing is None:
                row = CompliancePlugin(
                    tenant_id=tenant_id,
                    is_builtin=tenant_id is None,
                    enabled=initial_enabled,
                    check_definition=check_def,
                    auto_generated_check=auto_gen,
                    source_ingest_job_id=job.id,
                    depth=depth_of(r["rule_id"]),
                    os_keys=inferred_os_keys or None,
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
                # Update os_keys on re-ingest so improvements to the
                # inference logic get applied retroactively.
                if inferred_os_keys:
                    existing.os_keys = inferred_os_keys
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
