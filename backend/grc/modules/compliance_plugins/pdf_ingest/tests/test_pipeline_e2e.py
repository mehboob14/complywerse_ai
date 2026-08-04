"""End-to-end ingest_pdf pipeline test.

This is the integration counterpart to ``test_parse_and_classify.py`` —
it builds a synthetic CIS-shaped PDF in memory with reportlab, runs the
real ``ingest_pdf`` against the live database session, and asserts the
persisted job row + plugin row look correct end-to-end.

Why an integration test on the real DB rather than sqlite-in-memory:
``grc.models`` runs ``_add_missing_columns()`` against the configured
``DATABASE_URL`` at import time, so we can't cleanly point it at a
throwaway engine. Instead we use a uniquely-named test benchmark and a
strictly-scoped teardown that only deletes rows whose
``source_ingest_job_id`` equals the job this test created (never a
``LIKE`` on benchmark name — that could nuke real catalog rows on a
shared dev DB).
"""
from __future__ import annotations

import io
from typing import Iterator

import pytest

from grc.models import CisIngestJob, CompliancePlugin, SessionLocal
from grc.modules.compliance_plugins.pdf_ingest.pipeline import ingest_pdf

# Distinctive marker so the inferred benchmark slug can never collide with
# a real CIS benchmark already in the catalog. The "TEST_E2E" token is
# carried into the title page below and survives the slug normaliser.
TEST_FILENAME = "CIS_Visual_Studio_Code_GPO_TEST_E2E_v1.0.0.pdf"
TEST_BENCHMARK_SLUG = "CIS_VISUAL_STUDIO_CODE_GPO_TEST_E2E_v1.0.0"


def _build_synthetic_cis_pdf() -> bytes:
    """Render a one-rule CIS-style benchmark PDF with reportlab.

    Page 1 is the title page (so ``_infer_benchmark_label`` picks up the
    "CIS Visual Studio Code GPO Benchmark v1.0.0" string and produces
    ``CIS_VISUAL_STUDIO_CODE_GPO_v1.0.0`` — the slug the classifier maps
    to ``windows_winrm``). Page 2 holds a table-of-contents row with
    dot-leaders + page number (must be filtered out by the rule splitter)
    and one full rule with all four section labels populated (so the
    confidence score lands at 1.0).
    """
    from reportlab.lib.pagesizes import LETTER
    from reportlab.pdfgen import canvas

    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=LETTER)

    # Title page
    c.setFont("Helvetica-Bold", 18)
    # "TEST_E2E" sits between the product and "Benchmark" so the slug
    # inferer (`_infer_benchmark_label`) folds it into the product token,
    # producing CIS_VISUAL_STUDIO_CODE_GPO_TEST_E2E_v1.0.0 — uniquely
    # ours, can't collide with a real catalog row.
    c.drawString(72, 720, "CIS Visual Studio Code GPO TEST E2E Benchmark v1.0.0")
    c.setFont("Helvetica", 10)
    c.drawString(72, 700, "Center for Internet Security — Group Policy Object")
    c.showPage()

    # Body page — TOC dot-leader row first, then the real rule.
    c.setFont("Courier", 9)
    y = 750
    body_lines = [
        "Table of Contents",
        # The bug screenshot showed dot-leader rows like this leaking into
        # the rule list. The TOC filter must reject it.
        "1.1.1 Ensure 'ChatMCP' is set to 'Disabled' (Automated) ........................ 13",
        "",
        "1.1.1 Ensure 'ChatMCP' is set to 'Disabled' (Automated)",
        "Profile Applicability:",
        "- Level 1",
        "Description:",
        "The ChatMCP integration permits Visual Studio Code to call out to",
        "remote Model Context Protocol servers. Disabling it prevents data",
        "exfiltration through unsanctioned model providers.",
        "Rationale:",
        "Allowing arbitrary MCP endpoints means workspace contents can be",
        "transmitted to third-party services without explicit user consent.",
        "Audit:",
        "Open the Group Policy Editor (gpedit.msc) and confirm the registry",
        "value HKLM\\Software\\Policies\\Microsoft\\VisualStudioCode\\ChatMCP",
        "is set to 0.",
        "Remediation:",
        "Set the policy 'Disable ChatMCP' to Enabled via gpedit.msc, then run",
        "gpupdate /force.",
        "Default Value: Enabled",
        "References:",
        "1. https://code.visualstudio.com/docs/policies",
        "CIS Controls:",
        "Controls Version 8",
    ]
    for line in body_lines:
        c.drawString(54, y, line)
        y -= 12
        if y < 60:
            c.showPage()
            c.setFont("Courier", 9)
            y = 750
    c.showPage()
    c.save()
    return buf.getvalue()


@pytest.fixture()
def created_job_ids() -> Iterator[list[int]]:
    """Tracks job IDs created during the test so teardown only touches them.

    Cleanup is strictly job-scoped: we delete every CompliancePlugin whose
    ``source_ingest_job_id`` is one we recorded here, then the matching
    CisIngestJob rows by primary key. No ``LIKE`` queries, no benchmark
    name globs — running this test against a shared dev DB cannot delete
    catalog rows it didn't create.
    """
    ids: list[int] = []
    yield ids
    if not ids:
        return
    cleanup = SessionLocal()
    try:
        cleanup.query(CompliancePlugin).filter(
            CompliancePlugin.source_ingest_job_id.in_(ids)
        ).delete(synchronize_session=False)
        cleanup.query(CisIngestJob).filter(
            CisIngestJob.id.in_(ids)
        ).delete(synchronize_session=False)
        cleanup.commit()
    finally:
        cleanup.close()


@pytest.fixture()
def db_session() -> Iterator:
    """Plain SQLAlchemy session bound to the live engine."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def test_ingest_pdf_end_to_end_vscode_gpo(db_session, created_job_ids):
    """Full pipeline: synthetic VS Code GPO PDF → exactly one persisted rule.

    Asserts the four bug-report symptoms are gone:
      * the TOC dot-leader row is rejected (rules_extracted == 1, not 2)
      * rules_toc_rejected > 0 (the new counter is wired through)
      * the surviving rule's runner_type is windows_winrm (not linux_ssh)
      * confidence_score is non-zero (sections were actually parsed)
    """
    pdf_bytes = _build_synthetic_cis_pdf()
    job = ingest_pdf(
        db_session,
        pdf_bytes,
        TEST_FILENAME,
        tenant_id=None,  # shared catalog — keeps the test isolated from real tenants
        uploaded_by=None,
    )
    # Register the job for teardown FIRST — even if the asserts below blow
    # up the fixture must still be able to clean up.
    created_job_ids.append(job.id)

    assert job.status == "completed", (job.status, job.error_text, job.extraction_log)
    assert job.benchmark_label == TEST_BENCHMARK_SLUG, job.benchmark_label
    assert job.rules_extracted == 1, (
        job.rules_extracted,
        job.extraction_log,
    )
    assert job.rules_inserted == 1
    assert job.rules_toc_rejected >= 1, (
        "TOC dot-leader row must have been rejected — "
        f"got rejected={job.rules_toc_rejected}, log={job.extraction_log!r}"
    )

    plugins = (
        db_session.query(CompliancePlugin)
        .filter(CompliancePlugin.source_ingest_job_id == job.id)
        .all()
    )
    assert len(plugins) == 1, [p.rule_id for p in plugins]
    p = plugins[0]
    assert p.rule_id == "1.1.1"
    assert "ChatMCP" in (p.title or "")
    # The whole point of the bug fix: benchmark name pins the runner type.
    assert p.runner_type == "windows_winrm", p.runner_type
    # Sections were actually parsed → confidence is non-zero (was 0% before).
    assert (p.confidence_score or 0) > 0, p.confidence_score
    # Auto-generated checks always force review regardless of confidence.
    assert p.review_status == "pending_review"
    assert p.enabled is False
