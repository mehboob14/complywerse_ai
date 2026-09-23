"""The rule library: what each new check fires on, and the framework filter.

The library used to offer four hardcoded regulations. It now answers "which of
my rules evidence NCA ECC, and against which clauses" from the tenant's own SCF
crosswalk, and five more checks run on data the connectors already pull.
"""
from datetime import datetime, timedelta
from types import SimpleNamespace

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

import grc.models as m
from grc.modules.access_review import collectors
from grc.modules.access_review import rule_catalog as rules
from grc.modules.access_review._ingest import ingest

SOC2, ECC = "aicpa_tsc_soc2", "emea_saudi_arabia_ecc_1_2018"


@pytest.fixture
def db():
    engine = create_engine("sqlite://")
    m.Base.metadata.create_all(engine)
    with Session(engine) as session:
        session.add(m.Tenant(id=1, name="Demo Bank", slug="demo"))
        session.commit()
        yield session


def _item(email, roles, **kw):
    base = dict(email=email, roles_snapshot=roles, account_enabled=True, department="IT",
                user_id=1, is_privileged=False, termination_date=None,
                last_sign_in=None, mfa_enabled=None)
    return SimpleNamespace(**{**base, **kw})


def _ctx(**kw):
    return {"now": datetime.utcnow(), "terminated_locals": set(), "last_certified": {}, **kw}


# -- the five checks that became runnable ------------------------------------

def test_an_outsider_holding_standing_access_is_reported():
    ctx = _ctx()
    guest = _item("consultant@partner.example", ["Slack: guest (multi-channel)"])
    assert rules._chk_guest_access(guest, ctx)[0]["finding_type"] == "guest_access"
    # a guest whose account is already off is not standing access
    assert rules._chk_guest_access(_item("x@p.example", ["Guest"], account_enabled=False), ctx) == []
    assert rules._chk_guest_access(_item("dana@bank.example", ["Staff"]), ctx) == []


def test_admin_of_the_code_platform_is_reported_but_a_committer_is_not():
    ctx = _ctx()
    assert rules._chk_repo_admin(_item("dana@bank.example", ["GitHub: org owner"]), ctx)
    assert rules._chk_repo_admin(_item("ali@bank.example", ["GitLab: maintainer on payments"]), ctx)
    assert rules._chk_repo_admin(_item("sam@bank.example", ["GitHub: write on payments"]), ctx) == []
    # "admin" somewhere that is not a code platform belongs to other rules
    assert rules._chk_repo_admin(_item("ops@bank.example", ["Jira: admin"]), ctx) == []


def test_privileged_without_mfa_is_critical_and_unknown_mfa_is_not_a_finding():
    ctx = _ctx()
    bad = _item("root@bank.example", ["Administrator"], is_privileged=True, mfa_enabled=False)
    assert rules._chk_priv_no_mfa(bad, ctx)[0]["severity"] == "critical"
    # a source that cannot report MFA leaves it None - never guessed as missing
    unknown = _item("root2@bank.example", ["Administrator"], is_privileged=True, mfa_enabled=None)
    assert rules._chk_priv_no_mfa(unknown, ctx) == []
    ok = _item("root3@bank.example", ["Administrator"], is_privileged=True, mfa_enabled=True)
    assert rules._chk_priv_no_mfa(ok, ctx) == []


def test_a_seat_that_was_never_taken_up_is_reported():
    ctx = _ctx()
    assert rules._chk_pending_invite(_item("new@bank.example", ["Okta: invitation pending"]), ctx)
    assert rules._chk_pending_invite(_item("dana@bank.example", ["Okta: active"]), ctx) == []


def test_a_lapsed_certification_is_overdue_but_a_first_review_is_not():
    old = datetime.utcnow() - timedelta(days=rules.RECERT_DAYS + 40)
    recent = datetime.utcnow() - timedelta(days=30)
    dana = _item("dana@bank.example", ["Staff"])
    assert rules._chk_recert_overdue(dana, _ctx(last_certified={1: old}))[0]["severity"] == "medium"
    assert rules._chk_recert_overdue(dana, _ctx(last_certified={1: recent})) == []
    # never certified before: this review is the first, not a lapse
    assert rules._chk_recert_overdue(dana, _ctx()) == []


def test_every_rule_that_claims_to_run_has_a_check_and_names_its_scf_controls():
    mismatched = [r["id"] for r in rules.RULE_CATALOG
                  if (r["status"] == rules.RUNNABLE) != (r["check"] is not None)]
    assert mismatched == []
    assert [r["id"] for r in rules.RULE_CATALOG if not r.get("scf")] == []
    for new in ("SAAS-01", "DEV-02", "PRIV-05", "AUTH-04", "CERT-01"):
        assert rules.CATALOG_BY_ID[new]["status"] == rules.RUNNABLE


# -- the framework filter ----------------------------------------------------

def _crosswalk(db):
    db.add_all([
        m.SCFSource(release_id=1, source_key="k1", source_slug=SOC2,
                    display_name="AICPA TSC 2017:2022 (used for SOC 2)"),
        m.SCFSource(release_id=1, source_key="k2", source_slug=ECC,
                    display_name="EMEA Saudi Arabia ECC-1 2018"),
        # AUTH-01 answers both; PRIV-05 answers SOC 2 only.
        m.SCFMapping(release_id=1, scf_id="IAC-06", source_slug=SOC2, requirement_code="CC6.6"),
        m.SCFMapping(release_id=1, scf_id="IAC-06", source_slug=ECC, requirement_code="2-2-3-2"),
        m.SCFMapping(release_id=1, scf_id="IAC-06.1", source_slug=SOC2, requirement_code="CC6.1"),
    ])
    db.commit()


def test_the_library_filters_to_one_framework_and_shows_its_own_clauses(db):
    _crosswalk(db)
    everything = rules.catalog_view(db, 1)
    assert everything["summary"]["total"] == len(rules.RULE_CATALOG)
    assert {f["slug"] for f in everything["frameworks"]} == {SOC2, ECC}

    ecc = rules.catalog_view(db, 1, framework=ECC)
    shown = [r for d in ecc["domains"] for r in d["rules"]]
    ids = [r["id"] for r in shown]
    assert "AUTH-01" in ids                      # IAC-06 is crosswalked to ECC
    assert "PRIV-05" not in ids                  # its controls answer SOC 2 only
    assert ecc["summary"]["total"] == len(ids) < len(rules.RULE_CATALOG)
    assert ecc["summary"]["catalog_total"] == len(rules.RULE_CATALOG)
    # every rule shown carries that framework's own clause, and only that one
    assert all(r["frameworks"] == [{"slug": ECC, "name": "EMEA Saudi Arabia ECC-1 2018",
                                    "codes": ["2-2-3-2"]}] for r in shown)
    # the picker keeps every framework, so the filter is not a one-way door
    assert {f["slug"] for f in ecc["frameworks"]} == {SOC2, ECC}
    assert ecc["summary"]["frameworks_covered"] == 2
    # a framework nobody evidences empties the list instead of raising
    assert [r for d in rules.catalog_view(db, 1, framework="nope")["domains"] for r in d["rules"]] == []


def test_an_unmapped_tenant_still_gets_the_whole_catalog(db):
    """A tenant with no SCF release loaded sees every rule, no frameworks."""
    view = rules.catalog_view(db, 1)
    assert view["summary"]["total"] == len(rules.RULE_CATALOG)
    assert view["frameworks"] == [] and view["summary"]["frameworks_covered"] == 0


# -- what the collectors now carry into the rules ----------------------------

def test_mfa_and_last_sign_in_from_a_connector_reach_the_identity(db):
    """PRIV-05 and IDM-04 read columns on the user row, so a collector that
    reports MFA or a last login has to write them, not just the entitlement."""
    spec = collectors.PEOPLE["google_workspace"]
    row = {"email": "dana@bank.example", "twoStepEnrolled": False, "admin": True}
    mapped = collectors.map_person(row, spec, "google_workspace")
    assert mapped["mfa"] is False

    ingest(db, tenant_id=1, records=[row],
           map_fn=lambda r: collectors.map_person(r, spec, "google_workspace"),
           provider_tag="google_workspace")
    user = db.query(m.GRCUser).filter_by(email="dana@bank.example").one()
    assert user.mfa_enabled is False

    # a later sync that reports MFA switched on updates the row
    ingest(db, tenant_id=1, records=[{**row, "twoStepEnrolled": True}],
           map_fn=lambda r: collectors.map_person(r, spec, "google_workspace"),
           provider_tag="google_workspace")
    db.refresh(user)
    assert user.mfa_enabled is True

    # a source with no MFA field never overwrites what another one knew
    slack = collectors.PEOPLE["slack"]
    ingest(db, tenant_id=1, records=[{"email": "dana@bank.example", "name": "dana"}],
           map_fn=lambda r: collectors.map_person(r, slack, "slack"), provider_tag="slack")
    db.refresh(user)
    assert user.mfa_enabled is True


def test_a_last_login_from_a_connector_lands_where_the_dormancy_rule_reads_it(db):
    spec = collectors.PEOPLE["onelogin"]
    stale = (datetime.utcnow() - timedelta(days=200)).isoformat() + "Z"
    ingest(db, tenant_id=1,
           records=[{"id": 9, "email": "sam@bank.example", "username": "sam", "last_login": stale}],
           map_fn=lambda r: collectors.map_person(r, spec, "onelogin"), provider_tag="onelogin")
    user = db.query(m.GRCUser).filter_by(email="sam@bank.example").one()
    assert user.entra_last_sign_in is not None
    item = _item("sam@bank.example", ["OneLogin: user"], last_sign_in=user.entra_last_sign_in)
    assert rules._chk_stale(item, _ctx())[0]["finding_type"] == "stale_account"
