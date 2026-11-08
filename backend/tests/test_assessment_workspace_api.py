"""The assessments API as the revamped workspace, register and overview use it (Stage 4, group assess-backend).

Each test pins one fix of the audit (ux-revamp-reports/G10_compliance_assessments_audit.md): the JSON body of the item and assessment edits,
the lowercase remediation words that stamp a close date, `/points` counting what `/overview` counts, a read that never writes, the work list,
the list's search and summary switch, the approvals' trail and the re-upload preview.
"""
import ast
import os
import sys
from datetime import datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

import grc.models as m
from grc.models import get_db
from grc.routers.auth_router import require_auth

BASE = "/compliance/assessments"
ME = 7
NOW = datetime.utcnow()


def build_world() -> Session:
    """One tenant's assessments: A (ASVS of an application, in progress), B (the ASVS questionnaire A was made from), C (an ASVS draft
    being scoped, owned by ME), D (an answered maturity questionnaire), E (a plain upload), G (a PDPL toolkit); F belongs to another tenant."""
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    m.Base.metadata.create_all(engine)
    s = Session(engine)
    s.add(m.Tenant(id=1, name="Demo Bank", slug="demo"))
    s.add(m.Tenant(id=2, name="Other Bank", slug="other"))
    s.add_all([m.GRCUser(id=7, username="assessor", email="a@bank.example", display_name="Assessor Person"),
               m.GRCUser(id=8, username="amina", email="amina@bank.example", display_name="Amina Khan"),
               m.GRCUser(id=9, username="omar", email="omar@bank.example", display_name="Omar Sheikh")])
    s.add(m.Team(id=2, tenant_id=1, name="Security Operations"))
    s.add(m.TeamMember(team_id=2, user_id=ME))
    s.add_all([m.ITAsset(id=5, tenant_id=1, name="Digital Banking Web", asset_type="application", status="active", last_seen_at=NOW),
               m.ITAsset(id=6, tenant_id=1, name="Payments API", asset_type="application", status="active", last_seen_at=NOW - timedelta(days=90))])

    def doc(i, name, fmt, tenant=1, **kw):
        s.add(m.ComplianceAssessmentDocument(id=i, tenant_id=tenant, name=name, assessment_type="gap_assessment", assessment_format=fmt, **kw))

    def item(i, aid, number, status="in_progress", tenant=1, **kw):
        s.add(m.ComplianceAssessmentDocumentItem(id=i, assessment_id=aid, tenant_id=tenant, item_number=number, area_domain=kw.pop("area_domain", "Authentication"),
                                                 control_description=kw.pop("control_description", f"Requirement {number}"), compliance_status=status,
                                                 remarks=kw.pop("remarks", "ASVS Level: 1"), **kw))

    doc(10, "ASVS - Digital Banking Web", "asvs_checklist", scope_model="asset", phase="in_progress", owner_id=8, primary_asset_id=5, status="in_progress",
        total_items=4, complied_count=1, not_complied_count=2, in_progress_count=1, overall_score=25.0, assessor="Omar Sheikh")
    item(100, 10, "V1", "complied")
    item(101, 10, "V2", "not_complied", priority="high", assignees=[{"type": "user", "id": ME}], target_date=NOW - timedelta(days=40))
    item(102, 10, "V3", "not_complied", priority="medium", assignees=[{"type": "team", "id": 2}], target_date=NOW + timedelta(days=300))
    item(103, 10, "V4", "in_progress", assignees=[{"type": "user", "id": 9}])
    doc(11, "OWASP ASVS", "asvs_checklist", total_items=2, in_progress_count=2)                  # the questionnaire A was made from, never answered
    item(110, 11, "V1", assignees=[{"type": "user", "id": ME}])
    item(111, 11, "V2")
    doc(12, "ASVS - Payments API", "asvs_checklist", scope_model="asset", phase="scoping", owner_id=ME, primary_asset_id=6, status="draft")
    doc(13, "Incident Management Maturity", "incident_maturity", total_items=2, complied_count=2, status="in_progress")
    item(130, 13, "IM-1", "complied", remarks="Weighting: 1")
    item(131, 13, "IM-2", "complied", remarks="Weighting: 1")
    doc(14, "Uploaded workbook", "standard", total_items=1)
    item(140, 14, "S-1", assignees=[{"type": "user", "id": ME}])
    doc(15, "Elsewhere ASVS", "asvs_checklist", tenant=2, scope_model="asset", phase="in_progress", total_items=1)
    item(150, 15, "V1", "not_complied", tenant=2, assignees=[{"type": "user", "id": ME}])
    doc(16, "Privacy toolkit", "pdpl_assessment_toolkit", total_items=0)

    # the evidence of item 101 waits for ME (tier 1), the evidence of item 102 for somebody else
    s.add_all([m.AssessmentEvidenceApprovalWorkflow(id=1, tenant_id=1, name="Mine"), m.AssessmentEvidenceApprovalWorkflow(id=2, tenant_id=1, name="Theirs")])
    s.add_all([m.AssessmentEvidenceApprovalTier(workflow_id=1, tier_order=1, tier_name="Compliance lead", approver_type="user", approver_user_id=ME),
               m.AssessmentEvidenceApprovalTier(workflow_id=2, tier_order=1, tier_name="CISO", approver_type="user", approver_user_id=9)])
    s.add_all([m.AssessmentItemEvidence(id=1, assessment_item_id=101, tenant_id=1, workflow_id=1, current_tier=1, status="pending_review", submitted_by=8, submitted_at=NOW),
               m.AssessmentItemEvidence(id=2, assessment_item_id=102, tenant_id=1, workflow_id=2, current_tier=1, status="pending_review", submitted_by=8, submitted_at=NOW),
               m.AssessmentItemEvidence(id=3, assessment_item_id=100, tenant_id=1, status="approved", submitted_by=8, submitted_at=NOW)])      # item 100 has one piece of evidence
    s.add(m.AssessmentEvidenceApprovalHistory(assessment_item_evidence_id=1, action="submitted", tier_number=0, performed_by=8, comments="Please check", performed_at=NOW))
    s.commit()
    return s


@pytest.fixture
def db():
    s = build_world()
    yield s
    s.close()


@pytest.fixture
def http(db):
    from grc.main import app

    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[require_auth] = lambda: db.get(m.GRCUser, ME)
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.clear()


# ── the item edit: a JSON body, the lowercase words, the close date ───────────────────────────────────────────────────────────────────────────

def test_an_item_is_edited_by_a_json_body_and_the_answer_carries_the_new_totals(http):
    r = http.put(f"{BASE}/items/101", json={"gaps_identified": "x" * 3000, "priority": "critical", "compliance_status": "partially_complied"})
    assert r.status_code == 200, r.text
    out = r.json()
    assert (out["priority"], out["compliance_status"], len(out["gaps_identified"])) == ("critical", "partially_complied", 3000)
    assert out["assessment"] == {"id": 10, "total_items": 4, "complied_count": 1, "partially_complied_count": 1, "not_complied_count": 1, "in_progress_count": 1,
                                 "na_count": 0, "overall_score": out["assessment"]["overall_score"]}


def test_the_query_form_still_works_and_the_body_wins_over_it(http):
    assert http.put(f"{BASE}/items/101?priority=low&timeline=Q3").json()["priority"] == "low"
    out = http.put(f"{BASE}/items/101?priority=low", json={"priority": "critical"}).json()
    assert (out["priority"], out["timeline"]) == ("critical", "Q3")                          # the body changed one field; the other stayed


def test_a_field_the_server_does_not_know_is_refused_not_ignored(http):
    r = http.put(f"{BASE}/items/101", json={"priority": "high", "colour": "red"})
    assert r.status_code == 422
    assert http.put(f"{BASE}/items/101", json={"remediation_status": "x" * 31}).status_code == 422       # the column is 30 long


def test_remediation_is_stored_in_the_words_the_server_counts_and_a_closed_gap_has_a_close_date(http, db):
    put = lambda **body: http.put(f"{BASE}/items/101", json=body).json()           # noqa: E731
    out = put(remediation_status="In Progress")
    assert (out["remediation_status"], out["closed_at"]) == ("in_progress", None)
    out = put(remediation_status="Closed")
    assert out["remediation_status"] == "closed" and out["closed_at"]                # the SLA score now sees it closed
    first = out["closed_at"]
    assert put(remediation_status="closed")["closed_at"] == first                    # asking again does not move the date
    out = put(remediation_status=None)                                               # null clears
    assert (out["remediation_status"], out["closed_at"]) == (None, None)
    out = http.put(f"{BASE}/items/101", params={"remediation_status": "Closed"}).json()       # the old query form
    assert out["remediation_status"] == "closed" and out["closed_at"]
    assert put(compliance_status="complied", remediation_status="open")["closed_at"]        # complied is closed whatever the remediation says
    assert put(compliance_status="not_complied")["closed_at"] is None


def test_a_legacy_row_written_as_Closed_gets_its_close_date_with_the_next_save(http, db):
    db.get(m.ComplianceAssessmentDocumentItem, 102).remediation_status = "Closed"
    db.commit()
    out = http.put(f"{BASE}/items/102", json={"priority": "high"}).json()
    assert out["closed_at"] and out["remediation_status"] == "Closed"                 # stamped; the stored word is left until somebody sets it


def test_the_remediation_plan_patch_normalises_and_stamps_too(http):
    out = http.patch(f"{BASE}/remediation-items/101", json={"remediation_status": "In Progress"}).json()
    assert out == {"id": 101, "remediation_status": "in_progress", "closed_at": None}
    out = http.patch(f"{BASE}/remediation-items/101", json={"remediation_status": "Closed"}).json()
    assert out["remediation_status"] == "closed" and out["closed_at"]
    assert http.patch(f"{BASE}/remediation-items/101", json={"remediation_status": "open"}).json()["closed_at"] is None
    assert http.patch(f"{BASE}/remediation-items/101", json={"remediation_status": "bogus"}).status_code == 400


def test_maturity_null_in_the_body_clears_the_score_and_a_bad_date_is_refused_only_there(http, db):
    http.put(f"{BASE}/items/130", json={"maturity_score": 1})
    assert db.get(m.ComplianceAssessmentDocumentItem, 130).compliance_status == "partially_complied"
    out = http.put(f"{BASE}/items/130", json={"maturity_score": None}).json()
    assert (out["maturity_score"], out["compliance_status"]) == (None, "in_progress")
    r = http.put(f"{BASE}/items/101", json={"target_date": "not a date"})
    assert r.status_code == 400 and "2026-12-31" in r.json()["detail"]
    assert http.put(f"{BASE}/items/101", params={"target_date": "not a date"}).status_code == 200      # the query form ignores it, as it always did
    assert http.put(f"{BASE}/items/101", json={"target_date": "2026-12-31"}).json()["target_date"].startswith("2026-12-31")
    assert http.put(f"{BASE}/items/101", json={"target_date": None}).json()["target_date"] is None


# ── the assessment edit ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

def test_an_assessment_is_edited_by_a_json_body_and_an_unknown_one_is_a_404(http):
    out = http.put(f"{BASE}/10", json={"status": "completed", "due_date": "2026-12-31", "assessor": "Amina Khan", "name": "ASVS 2026"}).json()
    assert (out["status"], out["assessor"], out["name"], out["due_date"][:10]) == ("completed", "Amina Khan", "ASVS 2026", "2026-12-31")
    assert http.put(f"{BASE}/10", json={"due_date": None}).json()["due_date"] is None
    assert http.put(f"{BASE}/10", json={"due_date": "soon"}).status_code == 400
    assert http.put(f"{BASE}/10", json={"colour": "red"}).status_code == 422
    assert http.put(f"{BASE}/10", json={"name": ""}).status_code == 422
    assert http.put(f"{BASE}/10?status=in_review").json()["status"] == "in_review"            # the query form
    assert http.put(f"{BASE}/9999", json={"status": "completed"}).status_code == 404            # it used to be a 500


def test_the_assessment_read_can_leave_the_regrouped_copy_out(http):
    full = http.get(f"{BASE}/10").json()
    assert len(full["items"]) == 4 and list(full["items_by_domain"]) == ["Authentication"]
    slim = http.get(f"{BASE}/10?grouped=0").json()
    assert len(slim["items"]) == 4 and slim["items_by_domain"] == {}


# ── the board: /points counts what /overview counts ──────────────────────────────────────────────────────────────────────────────────────────

def test_points_and_overview_speak_of_the_same_assessments(http):
    board = http.get(f"{BASE}/overview").json()
    on_board = sorted(a["id"] for c in board["categories"] for a in c["assessments"])
    assert on_board == [10, 13, 16]                  # not B (a questionnaire A was made from), C (a draft), E (a plain upload), F (another tenant); G has no questions yet, it is "not started"
    points = http.get(f"{BASE}/points").json()
    assert sorted({p["assessment_id"] for p in points["points"]}) == [10, 13] and points["total"] == len(points["points"]) == 6
    assert sorted(p["id"] for p in points["points"]) == [100, 101, 102, 103, 130, 131]
    only = http.get(f"{BASE}/points", params={"assessment_id": 13}).json()
    assert [p["id"] for p in only["points"]] == [130, 131]
    assert http.get(f"{BASE}/points", params={"assessment_id": 11}).json()["points"] == []        # an assessment the board does not count has no points
    # the numbers the panel and the board show are the same ones: open gaps of A = its not-complied items
    sla = next(a for c in board["categories"] for a in c["assessments"] if a["id"] == 10)["sla_counts"]
    gaps = [p for p in points["points"] if p["assessment_id"] == 10 and p["compliance_status"] == "not_complied"]
    assert (sla["gaps"], sla["open"]) == (len(gaps), len(gaps))


def test_the_overview_can_score_one_assessment_alone(http):
    one = http.get(f"{BASE}/overview", params={"assessment_id": 10}).json()
    assert [(c["category"], [a["id"] for a in c["assessments"]]) for c in one["categories"]] == [("Cyber Security", [10])]
    full = next(a for c in http.get(f"{BASE}/overview").json()["categories"] for a in c["assessments"] if a["id"] == 10)
    assert one["categories"][0]["assessments"][0] == full and one["performance"]["assessments"] == 1                    # the same numbers, not rescaled
    none = http.get(f"{BASE}/overview", params={"assessment_id": 11}).json()                                              # a questionnaire the board does not count
    assert none["categories"] == [] and none["performance"] == {"score": None, "grade": None, "assessments": 0}


def test_the_overview_scores_with_the_evidence_it_counts_in_one_pass(http):
    a = next(a for c in http.get(f"{BASE}/overview").json()["categories"] for a in c["assessments"] if a["id"] == 10)
    evidence = next(x for x in a["metrics"] if x["key"] == "evidence")
    assert (evidence["numerator"], evidence["denominator"]) == (1, 1)                # item 100 is complied and has evidence
    assert a["n_items"] == 4 and a["sla_counts"]["overdue"] == 1                      # item 101's own deadline passed 40 days ago


# ── a read never writes ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

def _containers(db):
    return db.query(m.ComplianceAssessmentDocument).filter_by(assessment_format="nca_container").count()


def test_reading_the_nca_container_does_not_make_it(http, db):
    out = http.get("/compliance/nca/container").json()
    assert (out["id"], out["exists"], out["name"], out["assessment_format"]) == (None, False, "NCA Cybersecurity Workspace", "nca_container")
    assert _containers(db) == 0
    made = http.post("/compliance/nca/container").json()
    assert made["exists"] is True and made["id"] and _containers(db) == 1
    assert http.post("/compliance/nca/container").json()["id"] == made["id"] and _containers(db) == 1     # asking twice makes one
    assert http.get("/compliance/nca/container").json() == made
    assert http.get(BASE).json()["total"] == 5                                                           # the container never shows in the list


def test_reading_the_live_kpis_does_not_keep_snapshots_and_the_post_does(http, db):
    snaps = lambda: db.query(m.MetricSnapshot).filter(m.MetricSnapshot.metric.like("kpi_%")).count()        # noqa: E731
    out = http.get(f"{BASE}/kpi-live").json()
    assert "asset_monitoring" in out["metrics"] and snaps() == 0
    history = out["metrics"]["asset_monitoring"]["history"]
    assert [h["date"] for h in history] == [NOW.date().isoformat()] and history[0]["value"] == out["metrics"]["asset_monitoring"]["actual"]    # today, in memory
    kept = http.post(f"{BASE}/kpi-live/snapshot").json()
    assert kept["written"] >= 1 and snaps() == kept["written"]
    assert http.post(f"{BASE}/kpi-live/snapshot").json()["written"] == kept["written"] and snaps() == kept["written"]       # one row per KPI and day
    again = http.get(f"{BASE}/kpi-live").json()["metrics"]["asset_monitoring"]["history"]
    assert [h["date"] for h in again] == [NOW.date().isoformat()]                      # kept, and not added a second time


def test_reading_an_older_maturity_workbook_serves_the_reparse_without_storing_it(http, db, monkeypatch, tmp_path):
    router = sys.modules["grc.routers.compliance_assessments_router"]
    workbook = tmp_path / "maturity.xlsx"
    workbook.write_bytes(b"x")
    db.add(m.ComplianceAssessmentDocument(id=20, tenant_id=1, name="Digital maturity", assessment_type="gap_assessment", assessment_format="xlsx_maturity",
                                          file_path=str(workbook), xlsx_data={"sheets": {}}))
    db.commit()
    fresh = {"sheets": {"csf_summary": {"categories": [{"name": "Govern"}]}, "maturity_levels": {"rows": [{"level": 1}]}}}
    monkeypatch.setattr(router, "parse_xlsx_maturity_tool", lambda content: fresh)
    assert http.get(f"{BASE}/20/xlsx-data").json() == fresh                      # the page gets the complete sheets...
    db.expire_all()
    assert db.get(m.ComplianceAssessmentDocument, 20).xlsx_data == {"sheets": {}}      # ...and the stored copy is left alone


def test_no_get_handler_of_the_assessment_routers_writes():
    """AGENTS rule 8: a GET never commits or mutates. Read the routers' source, so a new handler cannot slip one in."""
    root = os.path.join(os.path.dirname(__file__), "..", "grc")
    files = ["routers/compliance_assessments_router.py", "routers/nca_container_router.py", "routers/dcc_router.py", "routers/audit_plan_router.py",
             "modules/assessments/scope_router.py"]
    offenders = []
    for rel in files:
        path = os.path.join(root, rel)
        with open(path, encoding="utf-8") as fh:
            source = fh.read()
        for node in ast.walk(ast.parse(source)):
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and any(
                    isinstance(d, ast.Call) and getattr(d.func, "attr", "") == "get" for d in node.decorator_list):
                body = ast.get_source_segment(source, node) or ""
                offenders += [f"{rel}:{node.name}" for w in (".commit(", "db.add(", "db.delete(", ".flush(") if w in body]
    assert offenders == []


# ── the list: search, the summary switch, the category ───────────────────────────────────────────────────────────────────────────────────────

def test_the_list_searches_name_owner_and_application_and_a_percent_is_only_a_percent(http):
    names = lambda **p: sorted(a["id"] for a in http.get(BASE, params=p).json()["assessments"])      # noqa: E731
    assert names() == [10, 11, 12, 13, 14]                                                           # the toolkit is hidden by default, another tenant's never shows
    assert names(all_formats=1) == [10, 11, 12, 13, 14, 16]
    assert names(q="amina") == [10]                                                                  # its owner
    assert names(q="BANKING") == [10]                                                                # its application (and its name), whatever the case
    assert names(q="omar") == [10]                                                                   # its assessor
    assert names(q="payments") == [12]
    assert names(q="100%") == []                                                                     # not a pattern
    assert names(q="maturity", assessment_format="incident_maturity") == [13]


def test_the_list_can_leave_the_summary_out_and_always_counts_the_true_total(http):
    full = http.get(BASE, params={"limit": 2}).json()
    assert full["total"] == 5 and len(full["assessments"]) == 2 and full["summary"]["total_assessments"] == 5
    assert full["summary"]["by_phase"] == {"in_progress": 1, "scoping": 1, "none": 3}
    lean = http.get(BASE, params={"limit": 2, "summary": 0}).json()
    assert lean["total"] == 5 and len(lean["assessments"]) == 2 and lean["summary"] == {}
    row = next(a for a in http.get(BASE).json()["assessments"] if a["id"] == 10)
    assert (row["category"], row["owner_name"], row["primary_asset_name"], row["phase"]) == ("Cyber Security", "Amina Khan", "Digital Banking Web", "in_progress")
    cats = {a["id"]: a["category"] for a in http.get(BASE, params={"all_formats": 1}).json()["assessments"]}
    assert cats == {10: "Cyber Security", 11: "Cyber Security", 12: "Cyber Security", 13: "Cyber Security", 14: "Other", 16: "Privacy & Data"}


# ── my work ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

def test_my_work_lists_what_is_assigned_owned_or_waiting_for_me(http):
    out = http.get(f"{BASE}/my-work").json()
    assert out["counts"] == {"assigned": 2, "overdue": 1, "to_scope": 1, "to_approve": 1, "can_decide": 1}
    assert [(r["item_id"], r["via"], r["overdue"]) for r in out["assigned_items"]] == [(101, "user", True), (102, "team", False)]     # overdue first
    first = out["assigned_items"][0]
    assert (first["assessment_id"], first["assessment_name"], first["category"], first["item_number"]) == (10, "ASVS - Digital Banking Web", "Cyber Security", "V2")
    # not 110 (a questionnaire nobody answered), 140 (a plain upload), 150 (another tenant), 103 (somebody else's)
    assert [(s["id"], s["primary_asset_name"]) for s in out["scoping"]] == [(12, "Payments API")]
    assert [(a["id"], a["item_id"], a["addressed_to_me"]) for a in out["approvals"]] == [(1, 101, True)]


def test_my_work_leaves_out_what_is_done_and_cuts_the_lists_not_the_counts(http, db):
    db.get(m.ComplianceAssessmentDocumentItem, 101).compliance_status = "complied"
    db.get(m.ComplianceAssessmentDocumentItem, 102).closed_at = NOW
    db.commit()
    assert http.get(f"{BASE}/my-work").json()["counts"]["assigned"] == 0
    db.get(m.ComplianceAssessmentDocumentItem, 101).compliance_status = "not_complied"
    db.get(m.ComplianceAssessmentDocumentItem, 102).closed_at = None
    db.commit()
    out = http.get(f"{BASE}/my-work", params={"limit": 1}).json()
    assert out["counts"]["assigned"] == 2 and len(out["assigned_items"]) == 1


# ── the approvals ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

def test_the_pending_approvals_carry_their_trail_and_keep_every_old_field(http):
    rows = http.get(f"{BASE}/pending-approvals").json()
    assert rows["total"] == 1                                                                         # ME is the approver of the first only
    row = rows["pending_approvals"][0]
    for key in ("id", "evidence_id", "evidence_name", "evidence_file_name", "assessment_id", "assessment_name", "item_number", "control_description",
                "current_tier", "status", "workflow_name", "can_approve", "addressed_to_me", "submitted_by_name", "submitted_at"):
        assert key in row, key
    assert (row["can_approve"], row["addressed_to_me"], row["item_id"], row["assessment_format"]) == (True, True, 101, "asvs_checklist")
    assert [(h["action"], h["performed_by"], h["comments"]) for h in row["approval_history"]] == [("submitted", "Amina Khan", "Please check")]
    one = http.get(f"{BASE}/evidence/1/approval-history").json()                                       # the single-item trail is unchanged
    assert [(h["action"], h["tier_name"], h["performed_by"]) for h in one["history"]] == [("submitted", None, "Amina Khan")]


# ── the re-upload preview ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

def test_a_reupload_can_be_previewed_and_then_applied(http, db, monkeypatch, tmp_path):
    router = sys.modules["grc.routers.compliance_assessments_router"]       # the package re-exports the APIRouter under the same name

    rows = [{"item_number": "V1", "control_description": "Requirement V1", "compliance_status": "complied", "gaps_identified": ""},          # nothing new
            {"item_number": "V2", "compliance_status": "not_complied", "gaps_identified": "Passwords are too short"},                        # one new value
            {"item_number": "V9", "control_description": "A new requirement", "compliance_status": "in_progress"}]                          # not there yet
    monkeypatch.setattr(router, "_parse_assessment_file", lambda content, name: (rows, "asvs_checklist", None))
    monkeypatch.setattr(router, "UPLOAD_DIR", str(tmp_path))
    files = {"file": ("asvs.xlsx", b"x", "application/octet-stream")}

    preview = http.post(f"{BASE}/10/reupload", params={"dry_run": 1}, files=files).json()
    assert preview["dry_run"] is True
    assert (preview["updated_count"], preview["changed_count"], preview["unchanged_count"], preview["added_count"]) == (2, 1, 1, 1)
    assert preview["changed_controls"] == [{"item_number": "V2", "fields": ["gaps_identified"]}] and preview["added_controls"] == ["V9"]
    assert "1 controls would change" in preview["message"]
    assert db.query(m.ComplianceAssessmentDocumentItem).filter_by(assessment_id=10).count() == 4 and os.listdir(tmp_path) == []        # nothing saved, no file kept
    assert db.get(m.ComplianceAssessmentDocumentItem, 101).gaps_identified is None

    done = http.post(f"{BASE}/10/reupload", files=files).json()
    assert (done["updated_count"], done["changed_count"], done["added_count"]) == (2, 1, 1) and "dry_run" not in done
    db.expire_all()
    assert db.get(m.ComplianceAssessmentDocumentItem, 101).gaps_identified == "Passwords are too short"
    assert db.query(m.ComplianceAssessmentDocumentItem).filter_by(assessment_id=10).count() == 5 and len(os.listdir(tmp_path)) == 1
    again = http.post(f"{BASE}/10/reupload", params={"dry_run": 1}, files=files).json()
    assert (again["changed_count"], again["added_count"]) == (0, 0)                                         # applied: nothing left to change


def test_a_reupload_of_the_wrong_kind_of_workbook_is_refused_in_the_preview_too(http, monkeypatch, tmp_path):
    router = sys.modules["grc.routers.compliance_assessments_router"]       # the package re-exports the APIRouter under the same name

    monkeypatch.setattr(router, "_parse_assessment_file", lambda content, name: ([{"item_number": "1"}], "pdpl_assessment_toolkit", None))
    monkeypatch.setattr(router, "UPLOAD_DIR", str(tmp_path))
    r = http.post(f"{BASE}/10/reupload", params={"dry_run": 1}, files={"file": ("p.xlsx", b"x", "application/octet-stream")})
    assert r.status_code == 400 and "matching" in r.json()["detail"]
