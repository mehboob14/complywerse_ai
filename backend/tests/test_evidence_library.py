"""The Evidence Library's server side (UX revamp, Stage 4): the lean complete load (``GET /evidence-mgmt/items?lean=1``), freshness worked out when the
evidence is READ (nothing marks a file stale on a schedule), the summary's new figures, the coverage page's stricter reading, and the audit-package
download that the export always promised (the export answered with an address and nothing served it).

Over HTTP through the whole evidence router, on in-memory SQLite. The old list is frozen where it matters: its envelope and its keys.
"""
import os
import zipfile
from datetime import datetime, timedelta
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import grc.models as m
from grc.routers.auth_router import require_auth

NOW = datetime.utcnow()
DAY = timedelta(days=1)
ME = 1


def seed(db):
    db.add(m.Tenant(id=1, name="CFSB", slug="cfsb"))
    for uid, name in [(1, "Ayesha Khan"), (2, "Bilal Ahmed"), (3, "Carla Díaz")]:
        db.add(m.GRCUser(id=uid, username=f"u{uid}", email=f"u{uid}@cfsb.test", display_name=name))
    fw = m.Framework(id=1, name="ISO 27001", short_code="ISO27001")
    db.add(fw)
    db.add(m.FrameworkDomain(id=1, framework_id=1, code="A", name="Domain"))
    db.add(m.ControlObjective(id=1, domain_id=1, code="A.5", name="Objective"))
    for cid in (1, 2, 3):
        db.add(m.FrameworkControl(id=cid, objective_id=1, code=f"A.5.{cid}", name=f"Control {cid}"))
    db.add(m.UploadedFramework(id=7, tenant_id=1, name="NCA ECC", file_name="f.pdf", file_path="f.pdf", file_type="pdf", uploaded_by=1))
    db.add(m.ParsedFrameworkControl(id=70, uploaded_framework_id=7, control_id="NCA-1", title="A parsed control"))
    db.flush()

    def ev(i, name, status="approved", expiry=None, stale=False, **kw):
        db.add(m.Evidence(id=i, tenant_id=1, name=name, status=status, evidence_type=kw.pop("evidence_type", "policy"), expiry_date=expiry, is_stale=stale,
                          uploaded_by=kw.pop("uploaded_by", 1), uploaded_at=kw.pop("uploaded_at", NOW - i * DAY), file_path=kw.pop("file_path", f"uploads/{i}.pdf"),
                          ocr_content=kw.pop("ocr_content", "X" * 5000), description="a long description", **kw))

    ev(1, "In force", expiry=NOW + 200 * DAY, quality_score=0.9, owner_id=2)
    ev(2, "Approved but past its date", expiry=NOW - 3 * DAY)                      # the flag nobody sets is still False
    ev(3, "Flagged by hand", expiry=NOW + 90 * DAY, stale=True)
    ev(4, "Draft, expiring soon", status="draft", expiry=NOW + 10 * DAY)
    ev(5, "Pending", status="pending_review")
    ev(6, "Expired by hand", status="expired", expiry=NOW + 400 * DAY)
    ev(7, "Archived and past its date", status="archived", expiry=NOW - 30 * DAY, stale=True)
    ev(8, "No expiry at all", file_path=None)
    ev(9, "Returned", status="draft", review_comments="R" * 900)
    db.flush()
    # links: evidence 1 answers a framework control (ISO), a parsed control (NCA), a common control and a written name; evidence 2 only a risk
    db.add(m.NormalizedControl(id=5, code="SCF-IAC-01", scf_id="IAC-01", name="Identity"))
    db.flush()
    db.add_all([
        m.EvidenceControlMapping(evidence_id=1, framework_control_id=1),
        m.EvidenceControlMapping(evidence_id=1, framework_control_id=2),
        m.EvidenceControlMapping(evidence_id=1, parsed_control_id=70),
        m.EvidenceControlMapping(evidence_id=1, normalized_control_id=5),
        m.EvidenceControlMapping(evidence_id=3, framework_name="  SOC 2  "),
        m.EvidenceControlMapping(evidence_id=2, framework_control_id=3),
    ])
    db.commit()


def make_world():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    m.Base.metadata.create_all(engine)
    db = sessionmaker(bind=engine, autoflush=False)()
    seed(db)
    from grc.modules.evidence.router import router

    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[m.get_db] = lambda: db
    app.dependency_overrides[require_auth] = lambda: db.get(m.GRCUser, ME)
    count = {"n": 0}

    @event.listens_for(engine, "before_cursor_execute")
    def _count(conn, cursor, statement, parameters, context, executemany):
        count["n"] += 1

    return SimpleNamespace(db=db, engine=engine, http=TestClient(app), count=count)


@pytest.fixture(autouse=True)
def _secret(monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", "unit-test-secret")


@pytest.fixture()
def world():
    w = make_world()
    yield w
    w.db.close()


def names(r):
    return [row["name"] for row in r.json()["items"]]


# ── freshness on read ────────────────────────────────────────────────────────
def test_lapsed_is_worked_out_when_read_and_archived_files_never_lapse(world):
    rows = {r["id"]: r for r in world.http.get("/evidence-mgmt/items?lean=1").json()["items"]}
    assert {i for i, r in rows.items() if r["lapsed"]} == {2, 3, 6}, "past its date, flagged by hand, expired by hand"
    assert rows[7]["lapsed"] is False and rows[7]["is_stale"] is False, "an archived file is out of play"
    assert rows[1]["lapsed"] is False and rows[8]["lapsed"] is False, "in date, and no expiry is not lapsed"
    assert all(r["is_stale"] == r["lapsed"] for r in rows.values())
    assert world.db.get(m.Evidence, 2).is_stale in (False, None), "reading never writes"


def test_the_standard_list_reports_the_same_freshness_and_keeps_its_shape(world):
    r = world.http.get("/evidence-mgmt/items")
    body = r.json()
    assert set(body) == {"items", "total", "skip", "limit"}, "the envelope of the old list is unchanged"
    row = next(x for x in body["items"] if x["id"] == 2)
    assert row["is_stale"] is True and row["lapsed"] is True and row["status"] == "approved", "approved stays approved; it also reads as lapsed"
    assert "control_mappings_count" in row and "description" in row and "content_summary" in row, "the full serializer still carries the text"


def test_the_stale_filters_follow_the_same_rule(world):
    stale = world.http.get("/evidence-mgmt/items?status=stale&limit=100")
    assert sorted(x["id"] for x in stale.json()["items"]) == [2, 3, 6]
    fresh = world.http.get("/evidence-mgmt/items?is_stale=false&limit=100")
    assert 2 not in [x["id"] for x in fresh.json()["items"]] and 1 in [x["id"] for x in fresh.json()["items"]]
    listed = world.http.get("/evidence-mgmt/lifecycle/stale")
    assert sorted(x["id"] for x in listed.json()["items"]) == [2, 3, 6] and listed.json()["total"] == 3


def test_the_summary_counts_what_lapsed_and_what_is_in_force(world):
    s = world.http.get("/evidence-mgmt/items/dashboard/summary").json()
    assert s["total_count"] == 9
    assert s["lapsed_count"] == 3 and s["stale_count"] == 3
    assert s["in_force_count"] == 2, "approved and in date: the first file and the one with no expiry"
    assert s["by_status"]["approved"] == 4, "what approved means is not changed: the status column is counted as it always was"
    assert s["expiring_soon_count"] == 1, "the 30-day window is unchanged: only the draft ten days out"
    assert s["pending_review_count"] == 1


# ── the lean load ────────────────────────────────────────────────────────────
LEAN_KEYS = {
    "id", "tenant_id", "name", "file_name", "file_type", "has_file", "version", "uploaded_by", "uploader_name", "owner_id", "owner_name", "uploaded_at", "status",
    "ocr_status", "ocr_processed_at", "evidence_type", "collection_date", "validity_period_days", "expiry_date", "is_stale", "lapsed", "source_system",
    "quality_score", "submitted_by", "submitted_at", "reviewed_by", "reviewed_at", "review_comments", "approved_by", "approved_at", "ai_review",
    "control_mappings_count", "links_count", "frameworks",
}


def test_a_lean_row_has_the_keys_the_library_reads_and_none_of_the_weight(world):
    r = world.http.get("/evidence-mgmt/items?lean=1")
    assert r.status_code == 200
    body = r.json()
    assert set(body) == {"items", "total", "skip", "limit", "truncated"}
    assert body["total"] == 9 and body["truncated"] is False and body["limit"] == 100
    assert all(set(row) == LEAN_KEYS for row in body["items"])
    assert not any(k in row for row in body["items"] for k in ("description", "content_summary", "ocr_content", "custom_values", "file_path"))
    assert names(r)[0] == "In force" and names(r)[-1] == "Returned", "newest first"
    first = body["items"][0]
    assert first["owner_name"] == "Bilal Ahmed" and first["uploader_name"] == "Ayesha Khan" and first["has_file"] is True
    assert next(x for x in body["items"] if x["id"] == 8)["has_file"] is False


def test_lean_rows_carry_the_counts_and_the_framework_names_by_the_record_pages_rule(world):
    rows = {x["id"]: x for x in world.http.get("/evidence-mgmt/items?lean=1").json()["items"]}
    assert rows[1]["control_mappings_count"] == 4 and rows[1]["links_count"] == 4
    assert rows[1]["frameworks"] == ["ISO 27001", "NCA ECC"], "a framework control's framework, a parsed control's uploaded framework; a common control names none"
    assert rows[3]["frameworks"] == ["SOC 2"], "a link that resolves to nothing keeps the name written on it, trimmed"
    assert rows[2]["frameworks"] == ["ISO 27001"] and rows[5]["frameworks"] == [] and rows[5]["links_count"] == 0


def test_a_review_comment_is_cut_for_the_list_and_the_filters_still_apply(world):
    rows = {x["id"]: x for x in world.http.get("/evidence-mgmt/items?lean=1").json()["items"]}
    assert len(rows[9]["review_comments"]) == 400 and rows[1]["review_comments"] is None
    only = world.http.get("/evidence-mgmt/items?lean=1&status=draft")
    assert names(only) == ["Draft, expiring soon", "Returned"] and only.json()["total"] == 2
    assert names(world.http.get("/evidence-mgmt/items?lean=1&search=hand")) == ["Flagged by hand", "Expired by hand"]


def test_lean_limit_is_clamped_and_truncation_is_said_with_the_true_total(world):
    r = world.http.get("/evidence-mgmt/items?lean=1&limit=4").json()
    assert len(r["items"]) == 4 and r["total"] == 9 and r["truncated"] is True and r["limit"] == 4
    big = world.http.get("/evidence-mgmt/items?lean=1&limit=999999").json()
    assert big["limit"] == 5000 and len(big["items"]) == 9 and big["truncated"] is False


def test_the_lean_load_costs_the_same_number_of_statements_for_9_files_and_for_300(world):
    world.count["n"] = 0
    assert world.http.get("/evidence-mgmt/items?lean=1").status_code == 200
    small = world.count["n"]
    for i in range(100, 400):
        world.db.add(m.Evidence(id=i, tenant_id=1, name=f"Filler {i}", status="approved", uploaded_by=1, owner_id=2, uploaded_at=NOW - i * DAY))
        world.db.add(m.EvidenceControlMapping(evidence_id=i, framework_control_id=1))
    world.db.commit()
    world.count["n"] = 0
    r = world.http.get("/evidence-mgmt/items?lean=1&limit=1000")
    assert r.json()["total"] == 309 and len(r.json()["items"]) == 309
    assert world.count["n"] <= small + 3, (small, world.count["n"])
    assert world.count["n"] < 25


# ── the coverage page's stricter reading ─────────────────────────────────────
def test_coverage_keeps_its_numbers_and_adds_the_in_force_reading(world):
    r = world.http.get("/evidence-mgmt/links/coverage").json()
    assert r["total_controls"] == 3 and r["controls_with_evidence"] == 3 and r["coverage_percentage"] == 100.0, "any link of any file, as before"
    # control 1 and 2 are linked to the file that is in force; control 3 only to the approved file past its date
    assert r["controls_with_approved_evidence"] == 2 and r["in_force_percentage"] == 66.7
    fw = r["frameworks"][0]
    assert fw["controls_with_approved_evidence"] == 2 and fw["in_force_percentage"] == 66.7


# ── the audit-package download ───────────────────────────────────────────────
@pytest.fixture()
def packages(world, tmp_path, monkeypatch):
    from grc.modules.evidence.routers import audit_packages

    monkeypatch.setattr(audit_packages, "AUDIT_PACKAGES_UPLOAD_DIR", str(tmp_path))
    return world


def make_package(w, status="draft"):
    w.db.add(m.AuditPackage(id=1, tenant_id=1, name="FY26 audit", status=status, created_by=ME))
    w.db.commit()


def test_a_package_cannot_be_downloaded_before_it_is_exported(packages):
    make_package(packages)
    r = packages.http.get("/evidence-mgmt/audit-packages/1/download")
    assert r.status_code == 400 and "Export it first" in r.json()["detail"]


def test_the_export_is_served_and_every_download_is_in_the_access_log(packages, tmp_path):
    make_package(packages, "finalized")
    evidence_file = tmp_path / "e1.pdf"
    evidence_file.write_bytes(b"%PDF fake")
    packages.db.get(m.Evidence, 1).file_path = str(evidence_file)
    packages.db.add(m.AuditPackageEvidence(package_id=1, evidence_id=1, sequence=1))
    packages.db.commit()
    done = packages.http.post("/evidence-mgmt/audit-packages/1/export")
    assert done.status_code == 200 and done.json()["download_url"].endswith("/audit-packages/1/download")
    r = packages.http.get("/evidence-mgmt/audit-packages/1/download")
    assert r.status_code == 200 and r.headers["content-type"] == "application/zip"
    assert "audit-package-1.zip" in r.headers["content-disposition"]
    out = tmp_path / "got.zip"
    out.write_bytes(r.content)
    with zipfile.ZipFile(out) as z:
        assert {"metadata.json", "evidence_index.csv"} <= set(z.namelist()) and any(n.startswith("evidence_files/001_") for n in z.namelist())
    packages.http.get("/evidence-mgmt/audit-packages/1/download")
    log = packages.db.query(m.AuditPackageAccessLog).filter_by(package_id=1, action="downloaded").count()
    assert log == 2, "one row for each download"


def test_a_missing_or_foreign_file_is_a_plain_sentence_not_a_path(packages, tmp_path):
    make_package(packages, "exported")
    pkg = packages.db.get(m.AuditPackage, 1)
    pkg.export_path = str(tmp_path / "gone.zip")
    packages.db.commit()
    gone = packages.http.get("/evidence-mgmt/audit-packages/1/download")
    assert gone.status_code == 404 and "Export the package again" in gone.json()["detail"] and str(tmp_path) not in gone.json()["detail"]
    outside = tmp_path.parent / "elsewhere.zip"
    outside.write_bytes(b"PK")
    pkg.export_path = str(outside)
    packages.db.commit()
    assert packages.http.get("/evidence-mgmt/audit-packages/1/download").status_code == 404, "only a file inside the packages folder is ever sent"
    assert os.path.exists(outside)
