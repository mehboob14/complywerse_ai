"""What a finding looks related to — proposed with its reason, never auto-linked.

Controls are scored on the server because the control library is SCF, whose
licence forbids running AI over its content. These tests run with no API key, so
the risk side falls back to the same local scoring.
"""
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

import grc.models as m
from grc.modules.issue_management.audit_register import suggestions as S


@pytest.fixture
def db(monkeypatch):
    monkeypatch.setattr(S, "get_openai_api_key", lambda: None)   # no model calls in tests
    engine = create_engine("sqlite://")
    m.Base.metadata.create_all(engine)
    with Session(engine) as session:
        session.add(m.Tenant(id=1, name="CFSB", slug="cfsb"))
        session.add(m.Issue(id=5, tenant_id=1, title="Multi-factor authentication missing for admins",
                            description="Administrators reach the payment console with a password alone."))
        session.add(m.AuditIssueProfile(
            id=1, tenant_id=1, issue_id=5, source="ey", record_type="issue",
            issue_text="Administrators reach the payment console with a password alone.",
            recommendation="Enforce multi-factor authentication for every administrator."))
        session.add(m.NormalizedControl(
            id=41, tenant_id=1, code="IAC-06", name="Multi-Factor Authentication",
            statement="Authentication for administrator accounts uses multiple factors.",
            domain="Identity & Access Management", source="scf"))
        session.add(m.NormalizedControl(
            id=42, tenant_id=1, code="BCD-08", name="Data Backup Separation",
            statement="Backups are kept away from the primary storage site.",
            domain="Business Continuity", source="scf"))
        session.add(m.Risk(id=61, tenant_id=1, category="operational",
                           title="Unauthorised access to payment systems",
                           description="Weak administrator authentication on payment consoles."))
        session.add(m.Risk(id=62, tenant_id=1, category="operational",
                           title="Flooding at the branch office",
                           description="Premises damage from severe weather."))
        session.commit()
        yield session


def _finding(db):
    return db.get(m.Issue, 5), db.get(m.AuditIssueProfile, 1)


def test_the_control_that_shares_the_finding_s_wording_comes_first(db):
    issue, profile = _finding(db)

    controls = S.suggest_controls(db, 1, issue, profile)

    assert controls, "expected at least one suggestion"
    assert controls[0]["code"] == "IAC-06"
    assert "authentication" in controls[0]["why"]
    assert "BCD-08" not in [c["code"] for c in controls]     # nothing in common, not offered


def test_risks_are_ranked_by_the_same_reading(db):
    issue, profile = _finding(db)

    risks = S.suggest_risks(db, 1, issue, profile)

    assert risks[0]["risk_id"] == 61
    assert risks[0]["by"] == "wording"                       # no key configured, no model call
    assert 62 not in [r["risk_id"] for r in risks]


def test_a_finding_with_nothing_in_common_suggests_nothing(db):
    issue, profile = _finding(db)
    issue.title = "Signage in the lobby is out of date"
    issue.description = None
    profile.issue_text = profile.recommendation = None

    assert S.suggest_controls(db, 1, issue, profile) == []


def test_suggestions_come_back_together_for_the_panel(db):
    issue, profile = _finding(db)

    both = S.suggestions_for(db, 1, issue, profile)

    assert set(both) == {"controls", "risks"}
    assert both["controls"][0]["normalized_control_id"] == 41
