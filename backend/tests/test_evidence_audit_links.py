"""Evidence ↔ audit observations and common controls.

Two things an evidence page has to get right. Every number in "Links & coverage" must have a record
behind it, so audit observations of every kind are listed, linked and unlinked from the evidence side
exactly as they are from the observation's own page. And an upload has to say which common controls
it can stand for, without a model (SCF's licence does not allow AI to be given its text).
"""
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

import grc.models as m
from grc.models import get_db
from grc.modules.automation.evidence_match import EvidenceDoc
from grc.modules.evidence import common_control_match as ccm
from grc.modules.evidence.routers import ai_assessment as ai, cross_links
from grc.routers.auth_router import require_auth

CONTROLS = {
    "IAC-01": {"artifacts": [{"name": "Access Control Policy", "description": "Who may access what"},
                             {"name": "User Access Review Records"}]},
    "IAC-02": {"artifacts": [{"name": "Access Control Policy"}]},
    "IAC-03": {"artifacts": [{"name": "Access Control Policy"}]},
    "IAC-04": {"artifacts": [{"name": "Access Control Policy"}]},
    "IAC-05": {"artifacts": [{"name": "Access Control Policy"}]},
    "IAC-06": {"artifacts": [{"name": "Access Control Policy"}]},
    "BCD-01": {"artifacts": [{"name": "Business Continuity Plan"}, {"name": "Information Security Policy"}]},
    "GOV-01": {"artifacts": [{"name": "Information Security Policy"}]},
    "VPM-06": {"artifacts": [{"name": "Penetration Test Report"}]},
    "TPM-01": {"artifacts": [{"name": "Policy"}]},
}
NAMES = {"IAC-01": "Identity & Access Management", "IAC-02": "Authenticate", "IAC-03": "Role-Based Access",
         "BCD-01": "Business Continuity Management", "GOV-01": "Information Security Governance",
         "VPM-06": "Penetration Testing"}


def _doc(name, typ="document", description="", **kw):
    return EvidenceDoc(id=1, name=name, file_name=name, evidence_type=typ, description=description, **kw)


def _recs(doc, **kw):
    return ccm.recommend(doc, ccm.artifact_index(CONTROLS), **kw)["recommendations"]


# ── the matcher, with no database ───────────────────────────────────────────
def test_a_document_is_matched_to_the_controls_that_ask_for_a_document_like_it():
    got = _recs(_doc("Q2 Penetration Test Report.pdf", "report"))
    assert [r["scf_id"] for r in got] == ["VPM-06"]
    assert got[0]["artifact"] == "Penetration Test Report" and got[0]["score"] >= ccm.MIN_SCORE
    assert "matches" in got[0]["reason"] and "penetration" in got[0]["reason"]


def test_words_every_artifact_uses_do_not_match_by_themselves():
    assert _recs(_doc("Policy.docx")) == []                       # "Policy" alone names no document
    assert _recs(_doc("screenshot_1234.png", "screenshot")) == []


def test_an_artifact_made_only_of_common_words_is_matched_on_the_whole_phrase():
    got = _recs(_doc("Information Security Policy v3.pdf"))
    assert {r["scf_id"] for r in got} == {"BCD-01", "GOV-01"}
    assert {r["artifact"] for r in got} == {"Information Security Policy"}
    assert _recs(_doc("Backup policy.pdf")) == []                 # one word of three is not the phrase


def test_scope_linked_controls_and_the_cap_shape_the_list():
    doc = _doc("Access Control Policy 2026.pdf", "policy")
    everything = _recs(doc)
    assert len(everything) == ccm.PER_ARTIFACT == 4              # six controls ask for it; a few of each are shown
    scoped = _recs(doc, applicable={"IAC-05", "IAC-06"})
    assert [r["scf_id"] for r in scoped] == ["IAC-05", "IAC-06"]
    left = _recs(doc, applicable={"IAC-05", "IAC-06"}, linked_controls={"IAC-05"})
    assert [r["scf_id"] for r in left] == ["IAC-06"]              # already linked there: never recommended again
    found = ccm.recommend(doc, ccm.artifact_index(CONTROLS))
    assert found["candidate_count"] == 6 and found["recommendations"][0]["also_asked_by"] == 5


def test_a_file_already_linked_as_an_artifact_is_offered_to_every_control_asking_for_it():
    doc = _doc("scan_0042.pdf", "document")                      # a name that says nothing
    assert _recs(doc) == []
    key = ccm.artifact_key("Access Control Policy")
    got = _recs(doc, linked_artifacts={key: ["IAC-01"]}, linked_controls={"IAC-01"})
    assert all(r["signal"] == "same_artifact" and r["score"] == ccm.SAME_ARTIFACT_SCORE for r in got)
    assert "IAC-01" not in {r["scf_id"] for r in got} and got
    assert got[0]["reason"].startswith("Already linked as 'Access Control Policy' on IAC-01")


def test_a_control_whose_own_name_fits_the_file_comes_first_among_equals():
    doc = _doc("Access Control Policy - role based access.pdf", "policy")
    plain = [r["scf_id"] for r in _recs(doc)]
    named = [r["scf_id"] for r in _recs(doc, names=NAMES)]
    assert named[0] == "IAC-03" and plain[0] != "IAC-03"        # "Role-Based Access" over the one that sorts first


# ── the endpoints ───────────────────────────────────────────────────────────
@pytest.fixture
def api(monkeypatch):
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    m.Base.metadata.create_all(engine)
    db = Session(engine)
    db.add(m.Tenant(id=1, name="Demo Bank", slug="demo"))
    user = m.GRCUser(id=7, username="owner", email="owner@bank.example", display_name="Owner")
    db.add(user)
    db.add(m.Evidence(id=10, tenant_id=1, name="Penetration test report Q2", file_name="pentest-q2.pdf",
                      evidence_type="report", description="External penetration test of the web estate"))
    db.add_all([
        m.AuditObservation(id=1, tenant_id=1, code="SAO-1", title="Penetration testing is not performed annually",
                           observation_type="finding", regulator_source="SBP", status="open", priority="high"),
        m.AuditObservation(id=2, tenant_id=1, title="Cancelled observation", status="cancelled"),
        m.Issue(id=21, tenant_id=1, code="ISS-21", title="Penetration test findings not remediated", severity="high",
                issue_type="audit_finding", workflow_state="in_progress"),
        m.Issue(id=22, tenant_id=1, code="ISS-22", title="Penetration test of the login page", severity="low",
                issue_type="vulnerability", workflow_state="new"),                 # not an audit finding
        m.Issue(id=23, tenant_id=1, code="ISS-23", title="Backup restore not tested", severity="medium",
                workflow_state="new"),                                              # an audit-register row (profile below)
    ])
    db.flush()
    db.add(m.AuditIssueProfile(tenant_id=1, issue_id=23, source="regulator", type_of_audit="OCC exam",
                               risk_rating="Moderate", issue_text="Backups are not restored on a schedule"))
    db.add(m.NormalizedControl(id=5, scf_id="VPM-06", code="SCF-VPM-06", name="Penetration Testing"))
    db.add(m.NormalizedControl(id=6, scf_id="IAC-01", code="SCF-IAC-01", name="Identity & Access Management"))
    for i, scf in enumerate(("IAC-02", "IAC-03", "IAC-04", "IAC-05", "IAC-06", "BCD-01", "GOV-01"), start=7):
        db.add(m.NormalizedControl(id=i, scf_id=scf, code=f"SCF-{scf}", name=NAMES.get(scf, scf)))     # every SCF control has one
    db.add(m.EvidenceControlMapping(id=90, evidence_id=10, framework_name="Legacy", control_code="X-1"))   # resolves to nothing
    db.commit()
    from grc.main import app
    monkeypatch.setattr(ai, "get_openai_client", lambda: (_ for _ in ()).throw(ai.HTTPException(status_code=503)))
    monkeypatch.setattr(ai, "_COMMON_INDEX", ccm.artifact_index(CONTROLS))
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[require_auth] = lambda: user
    app.dependency_overrides[cross_links._require_issue_edit] = lambda: True
    yield TestClient(app), db
    app.dependency_overrides.clear()
    db.close()


def test_audit_observations_of_every_kind_are_recommended_without_a_model(api):
    http, _db = api
    got = http.post("/evidence-mgmt/ai/10/recommend-links", params={"target": "audit_observations"})
    assert got.status_code == 200, got.text
    by_code = {r["code"]: r for r in got.json()["recommendations"]}
    assert set(by_code) == {"SAO-1", "ISS-21", "ISS-23"} or {"SAO-1", "ISS-21"} <= set(by_code)
    assert "ISS-22" not in by_code and not any(r["title"] == "Cancelled observation" for r in by_code.values())
    assert by_code["SAO-1"]["meta"] == {"kind": "statutory", "record_id": 1} and by_code["SAO-1"]["id"] == 1
    assert by_code["ISS-21"]["meta"] == {"kind": "issue", "record_id": 21} and by_code["ISS-21"]["id"] == -21   # never collides
    assert "Statutory audit finding" in by_code["SAO-1"]["subtitle"] and "SBP" in by_code["SAO-1"]["subtitle"]


def test_an_observation_is_linked_listed_and_unlinked_from_the_evidence_side(api):
    http, db = api
    made = http.post("/evidence-mgmt/cross-links/10/audit-observations", json={"observation_ids": [1, 999]})
    assert made.status_code == 201 and made.json()["created_count"] == 1
    assert made.json()["skipped"][0]["reason"].startswith("Observation not found")
    again = http.post("/evidence-mgmt/cross-links/10/audit-observations", json={"observation_ids": [1]})
    assert again.json()["created_count"] == 0 and again.json()["skipped"][0]["reason"] == "Link already exists"
    assert [a.activity_type for a in db.query(m.AuditObservationActivity).all()] == ["link"]   # same trail as its own page

    issues = http.post("/evidence-mgmt/cross-links/10/audit-issues", json={"issue_ids": [21, 23], "link_type": "remediation"})
    assert issues.json()["created_count"] == 2
    links = http.get("/evidence-mgmt/cross-links/10/all-links").json()["audit_observations"]
    assert links["total"] == 3
    rows = {(r["kind"], r["record_id"]): r for r in links["links"]}
    assert rows[("statutory", 1)]["source"] == "Statutory audit · SBP" and rows[("statutory", 1)]["link_type"] == "proof"
    assert rows[("issue", 21)]["link_type"] == "remediation" and rows[("issue", 21)]["source"].startswith("Audit finding")
    assert rows[("issue", 23)]["source"] == "Audit register · OCC exam" and rows[("issue", 23)]["priority"] == "Moderate"

    # the recommendations no longer offer what is linked
    left = {r["code"] for r in http.post("/evidence-mgmt/ai/10/recommend-links",
                                         params={"target": "audit_observations"}).json()["recommendations"]}
    assert not left & {"SAO-1", "ISS-21", "ISS-23"}

    assert http.delete(f"/evidence-mgmt/cross-links/10/audit-observations/{rows[('statutory', 1)]['id']}").status_code == 200
    assert http.delete(f"/evidence-mgmt/cross-links/10/audit-issues/{rows[('issue', 21)]['id']}").status_code == 200
    assert http.delete("/evidence-mgmt/cross-links/10/audit-issues/9999").status_code == 404
    assert http.get("/evidence-mgmt/cross-links/10/all-links").json()["audit_observations"]["total"] == 1
    assert {a.activity_type for a in db.query(m.AuditObservationActivity)} == {"link", "unlink"}
    assert {a.type for a in db.query(m.IssueActivity)} == {"linked", "unlinked"}


def test_every_control_mapping_is_listed_so_the_count_always_has_something_behind_it(api):
    http, db = api
    db.add(m.EvidenceControlMapping(id=91, evidence_id=10, normalized_control_id=6, framework_name="SCF",
                                    control_code="IAC-01", artifact_key="access control policy",
                                    clause_reference="Access Control Policy", coverage_type="partial"))
    db.commit()
    got = http.get("/evidence-mgmt/links/10/controls").json()
    assert got["total_mappings"] == 2
    row = got["normalized_controls"][0]           # what the pill shows: the artifact, how fully, and whether it can be removed
    assert (row["clause_reference"], row["coverage_type"], row["is_locked"]) == ("Access Control Policy", "partial", False)
    assert [(c["normalized_control"]["scf_id"], c["normalized_control"]["code"]) for c in got["normalized_controls"]] == [("IAC-01", "SCF-IAC-01")]
    assert [(u["id"], u["control_code"], u["framework_name"]) for u in got["unresolved"]] == [(90, "Legacy", "X-1")[0:1] + ("X-1", "Legacy")]


def test_common_controls_are_recommended_on_upload_by_rule_not_by_model(api):
    http, db = api
    ev = db.get(m.Evidence, 10)
    ev.name, ev.description = "Access Control Policy 2026", "Who may access which systems"
    db.commit()
    got = http.post("/evidence-mgmt/ai/10/recommend-links", params={"target": "common_controls"})
    assert got.status_code == 200, got.text
    body = got.json()
    assert body["model_free"] is True and body["ai_available"] is False
    top = body["recommendations"][0]
    assert top["code"] == "IAC-01" and top["id"] == 6 and top["title"] == "Identity & Access Management"
    assert top["link_source"] == "rule" and top["meta"]["artifact_name"] == "Access Control Policy"
    assert "Asks for" in top["subtitle"] and "also asked by 5 other controls" in top["subtitle"]
    assert 0.4 <= top["confidence"] <= 1.0 and "Name or summary matches" in top["rationale"]

    # linked to a control as that artifact: the others asking for it are now offered at the top, and it is not offered again
    db.add(m.EvidenceControlMapping(evidence_id=10, normalized_control_id=6, framework_name="SCF", control_code="IAC-01",
                                    artifact_key="access control policy"))
    db.get(m.Evidence, 10).name = "scan_0042"
    db.commit()
    after = http.post("/evidence-mgmt/ai/10/recommend-links", params={"target": "common_controls"}).json()["recommendations"]
    assert after and all(r["meta"]["signal"] == "same_artifact" for r in after)
    assert "IAC-01" not in {r["code"] for r in after}


def test_the_manual_pickers_reach_every_common_control_and_every_unlinked_observation(api):
    http, _db = api
    controls = http.get("/evidence-mgmt/links/common-control-options").json()["controls"]
    assert [c["scf_id"] for c in controls] == sorted(c["scf_id"] for c in controls) and len(controls) == 9   # not capped at 50
    assert {"id": 5, "scf_id": "VPM-06", "code": "SCF-VPM-06", "name": "Penetration Testing"} in controls

    opts = http.get("/evidence-mgmt/cross-links/10/audit-observation-options").json()["options"]
    by_code = {o["code"]: o for o in opts}
    assert {"SAO-1", "ISS-21", "ISS-23"} <= set(by_code) and "ISS-22" not in by_code
    assert by_code["SAO-1"]["kind"] == "statutory" and by_code["ISS-21"]["record_id"] == 21
    http.post("/evidence-mgmt/cross-links/10/audit-observations", json={"observation_ids": [1]})
    assert "SAO-1" not in {o["code"] for o in http.get("/evidence-mgmt/cross-links/10/audit-observation-options").json()["options"]}
    assert http.get("/evidence-mgmt/cross-links/999/audit-observation-options").status_code == 404


def test_a_test_sample_cannot_be_unlinked_from_the_evidence_page(api):
    http, db = api
    db.add(m.EvidenceControlMapping(id=92, evidence_id=10, normalized_control_id=6, framework_name="SCF",
                                    control_code="IAC-01", artifact_key="access control policy", is_locked=True))
    db.add(m.EvidenceControlMapping(id=93, evidence_id=10, normalized_control_id=7, framework_name="SCF", control_code="IAC-02"))
    db.commit()
    blocked = http.delete("/evidence-mgmt/links/10/controls/92")
    assert blocked.status_code == 409 and "test sample" in blocked.json()["detail"]
    assert db.get(m.EvidenceControlMapping, 92) is not None
    assert http.delete("/evidence-mgmt/links/10/controls/93").status_code == 200
    assert http.delete("/evidence-mgmt/links/10/controls/90").status_code == 200      # the unresolved legacy row can go
