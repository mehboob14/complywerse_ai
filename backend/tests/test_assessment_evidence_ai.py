"""AI evidence recommendations for an assessment item (Cyber Security hub and
every other compliance assessment).

Recommendations fit the kind of item; library records are shortlisted by the
words they share with the item, the model may only pick from that shortlist,
records already linked are left out; the endpoint keeps the result on the item
and says plainly when AI is not set up.
"""
import json

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

import grc.models as m
from grc.models import get_db
from grc.routers.auth_router import require_auth
from grc.services import assessment_evidence_ai as advisor


@pytest.fixture
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    m.Base.metadata.create_all(engine)
    session = Session(engine)
    session.add(m.Tenant(id=1, name="Demo Bank", slug="demo"))
    session.add(m.GRCUser(id=7, username="assessor", email="assessor@bank.example", display_name="Assessor"))
    session.add(m.ComplianceAssessmentDocument(id=3, tenant_id=1, name="OWASP ASVS 4.0.3", assessment_type="checklist",
                                               assessment_format="asvs_checklist"))
    session.add(m.ComplianceAssessmentDocumentItem(
        id=30, assessment_id=3, tenant_id=1, item_number="V2.1.1", area_domain="Authentication",
        subdomain_name="Password Security", compliance_status="in_progress",
        control_description="Verify that user set passwords are at least 12 characters in length.",
        remarks="ASVS Level: 1 | CWE: 521 | NIST: 5.1.1.2"))
    session.add_all([
        m.Evidence(id=101, tenant_id=1, name="Password policy", evidence_type="Policy",
                   description="Corporate password policy: minimum length 12 characters, complexity"),
        m.Evidence(id=102, tenant_id=1, name="IdP password settings export", evidence_type="Configuration",
                   content_summary="Okta password policy minimum length 12"),
        m.Evidence(id=103, tenant_id=1, name="Firewall rule review", evidence_type="Report",
                   description="Quarterly firewall review"),
        m.Evidence(id=104, tenant_id=1, name="Old password standard", status="rejected",
                   description="password length 8 characters"),
    ])
    session.commit()
    yield session
    session.close()


def _item(db):
    return db.get(m.ComplianceAssessmentDocumentItem, 30)


def test_the_library_shortlist_fits_the_item_and_skips_linked_and_rejected_records(db):
    ids = [ev.id for ev in advisor.shortlist_existing(db, _item(db))]
    assert 101 in ids and 102 in ids
    assert 103 not in ids                        # shares nothing with a password-length requirement
    assert 104 not in ids                        # rejected
    db.add(m.AssessmentItemEvidence(assessment_item_id=30, tenant_id=1, evidence_id=101, status="draft"))
    db.commit()
    assert 101 not in [ev.id for ev in advisor.shortlist_existing(db, _item(db))]


def test_recommendations_are_cleaned_and_only_shortlisted_records_can_match(db):
    seen = {}

    def model(messages):
        seen["prompt"] = messages[1]["content"]
        return "```json\n" + json.dumps({
            "summary": "Show the enforced minimum length.",
            "recommendations": [
                {"evidence_type": "IdP password policy export", "description": "Minimum length 12 enforced",
                 "how_to_collect": "Okta Admin > Security > Authenticators > Password > export", "priority": "HIGH",
                 "example_files": ["okta-password-policy.json"]},
                {"evidence_type": "Signup test", "description": "An 11-character password is refused",
                 "priority": "urgent"},
                "not a recommendation",
            ],
            "matches": [
                {"evidence_id": 102, "reason": "Shows the IdP minimum length", "confidence": 1.4},
                {"evidence_id": 101, "reason": "Policy states 12 characters", "confidence": 0.7},
                {"evidence_id": 999, "reason": "invented", "confidence": 0.9},
                {"evidence_id": 103, "reason": "not shortlisted", "confidence": 0.9},
            ],
        }) + "\n```"

    result = advisor.recommend_evidence(db, _item(db), complete=model)
    assert "OWASP ASVS verification requirement" in seen["prompt"]          # written for its kind of item
    assert "V2.1.1" in seen["prompt"] and "ASVS Level: 1" in seen["prompt"]
    assert "- 101 | Password policy" in seen["prompt"] and "Firewall" not in seen["prompt"]

    assert [r["priority"] for r in result["recommendations"]] == ["high", "medium"]
    assert result["recommendations"][0]["how_to_collect"].startswith("Okta Admin")
    assert [x["evidence_id"] for x in result["matches"]] == [102, 101]       # invented and unlisted dropped
    assert result["matches"][0]["confidence"] == 1.0 and result["matches"][0]["name"] == "IdP password settings export"
    assert result["library_checked"] == 2


def test_the_endpoint_keeps_the_result_and_says_when_ai_is_not_set_up(db, monkeypatch):
    from grc.main import app

    user = db.get(m.GRCUser, 7)
    real_complete = advisor.openai_complete
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[require_auth] = lambda: user
    try:
        http = TestClient(app)
        base = "/compliance/assessments/3/items/30/ai-recommendation"
        monkeypatch.setattr(advisor, "openai_complete", lambda messages: json.dumps({
            "summary": "s", "recommendations": [{"evidence_type": "Policy", "description": "d", "priority": "low"}],
            "matches": [{"evidence_id": 102, "reason": "fits", "confidence": 0.8}]}))
        made = http.post(base)
        assert made.status_code == 200, made.text
        assert made.json()["recommendation"]["matches"][0]["evidence_id"] == 102
        kept = http.get(base).json()
        assert kept["recommendation"]["recommendations"][0]["evidence_type"] == "Policy" and kept["generated_at"]

        monkeypatch.setattr(advisor, "openai_complete", real_complete)       # the real call, with no key
        monkeypatch.setattr(advisor, "_configured_key", lambda: None)
        refused = http.post(base)
        assert refused.status_code == 503 and "no AI key" in refused.json()["detail"]
        assert http.get(base).json()["recommendation"]["summary"] == "s"     # the last good one is kept

        monkeypatch.setattr(advisor, "openai_complete", lambda messages: (_ for _ in ()).throw(RuntimeError("down")))
        down = http.post(base)
        assert down.status_code == 502 and "did not answer" in down.json()["detail"]
    finally:
        app.dependency_overrides.clear()
