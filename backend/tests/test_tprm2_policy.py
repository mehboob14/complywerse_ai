"""TPRM parity, piece P0 (2026-10-29): the vendor policy.

The policy page's settings: bands and cadence (as before), days to fix a finding by severity, the stages each tier
skips, and the roster roles each tier needs as reviewers, with approver roles read and written beside them. Each has
a default (what the module always did) and a tenant's values go over it; a change is checked, audited and read back by
GET /vendor-risk/policy; the old /tpra/config keeps working on the same row. An assessment keeps the settings it was
tiered under (policy_snapshot), and the new ones drive the finding due date, the stages tiering skips, the reviewers
planning asks for and the attention queue's SLA. Scheduling a reassessment with no cadence goes by Settings. In-memory
SQLite.
"""
import json
from datetime import datetime, timedelta

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from grc.models import (
    Base, GRCUser, Permission, Role, RolePermission, Tenant, TPRAAuditLog, TPRAFinding, TPRATieringConfig, UserRole,
    Vendor, get_db,
)
from grc.modules.vendor_risk.routers import lifecycle
from grc.modules.vendor_risk.tpra import api, attention, policy, roster, service, tier_policy
from grc.modules.vendor_risk.tpra.bootstrap import DEFAULT_TIERING_CONFIG, get_tiering_config
from grc.modules.vendor_risk.tpra.engine_tiering import FACTOR_KEYS
from grc.modules.vendor_risk.tpra.stages import (
    DEFAULT_CADENCE_DAYS, DEFAULT_REMEDIATION_SLA_DAYS, TIER_REQUIRED_REVIEWERS, TIER_SKIPPABLE_STAGES,
)
from grc.routers.auth_router import require_auth

ADMIN, EDITOR, READER, ALICE, BOB = 1, 2, 3, 4, 5
TODAY = datetime.utcnow().date()
REMINDERS = dict(DEFAULT_TIERING_CONFIG["reminder_policy"])
LOW, MEDIUM, HIGH, CRITICAL = ({k: n for k in FACTOR_KEYS} for n in (0, 1, 2, 3))      # 0, 25, 50, 75 on the default bands


@pytest.fixture()
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    s = sessionmaker(bind=engine)()
    s.add(Tenant(id=1, name="Acme Bank", slug="acme"))
    s.add_all([Role(id=1, name="Administrator"), Role(id=2, name="Policy editor"), Role(id=3, name="CISO"),
               Permission(id=1, name="vendor_risk:config:edit", resource="vendor_risk", action="edit"),
               RolePermission(role_id=2, permission_id=1)])
    s.add_all([GRCUser(id=uid, username=f"u{uid}", display_name=f"User {uid}", email=f"u{uid}@acme.test", is_active=True)
               for uid in (ADMIN, EDITOR, READER, ALICE, BOB)])
    s.add_all([UserRole(user_id=ADMIN, role_id=1, tenant_id=1), UserRole(user_id=EDITOR, role_id=2, tenant_id=1)])
    s.commit()
    yield s
    s.close()


def _user(db, uid=ADMIN):
    return db.get(GRCUser, uid)


def put(db, uid=ADMIN, **settings):
    return policy.put_policy(policy.PolicyIn(**settings), db=db, user=_user(db, uid))


def get(db, uid=ADMIN):
    return policy.get_policy(db=db, user=_user(db, uid))


def _vendor(db, name="Acme Cloud", **kw):
    v = Vendor(**{"tenant_id": 1, "name": name, "tier": "medium", "status": "active", "owner_id": ADMIN,
                  "data_access_level": "confidential", **kw})
    db.add(v)
    db.commit()
    return v


def _tiered(db, v, factors):
    """The supplier's assessment, tiered on these factors: it takes the policy as it stands now."""
    a = service.ensure_active_assessment(db, v, actor_id=ADMIN)
    service.run_tiering(db, v, a, actor_id=ADMIN, factors=factors)
    db.commit()
    return a


def _skipped(db, a):
    return sorted(s.stage_key for s in service.get_stage_instances(db, a.id) if s.status == "skipped")


# ── the settings ─────────────────────────────────────────────────────────────

def test_the_policy_starts_at_what_the_module_always_did(db):
    got = get(db, READER)
    assert got["thresholds"] == {"critical": 75.0, "high": 50.0, "medium": 25.0}
    assert got["cadence_days"] == {"critical": 180, "high": 365, "medium": 730, "low": 1095} == DEFAULT_CADENCE_DAYS
    assert got["remediation_days"] == {"critical": 7, "high": 30, "medium": 90, "low": 180} == DEFAULT_REMEDIATION_SLA_DAYS
    assert got["skip_matrix"] == {"critical": [], "high": [], "medium": ["dd_planning"],
                                  "low": ["dd_planning", "questionnaire", "scoring", "findings"]}
    assert got["skip_matrix"] == {t: s for t, s in TIER_SKIPPABLE_STAGES.items()}
    assert got["required_reviewers"] == {"critical": ["security", "privacy", "legal"], "high": ["security", "privacy"],
                                         "medium": ["security"], "low": []}
    assert got["required_reviewers"] == TIER_REQUIRED_REVIEWERS
    assert got["approver_roles"] == {"critical": None, "high": None, "medium": None, "low": None}
    assert got["customised"] is False and got["can_edit"] is False
    assert {k: got[k] for k in got["defaults"]} == got["defaults"]
    assert set(got["defaults"]) == {"thresholds", "cadence_days", "remediation_days", "skip_matrix",
                                    "required_reviewers", "approver_roles"}
    # nothing was written by reading it
    assert db.query(TPRATieringConfig).count() == 0 and db.query(TPRAAuditLog).count() == 0


def test_the_page_is_told_the_tiers_stages_and_roles_to_offer(db):
    meta = get(db)["meta"]
    assert meta["tiers"] == meta["severities"] == ["critical", "high", "medium", "low"]
    stages = {s["key"]: s["skippable"] for s in meta["stages"]}
    assert list(stages) == ["intake", "tiering", "dd_planning", "questionnaire", "scoring", "findings", "contracting",
                            "approval", "onboarding", "monitoring", "reassessment"]
    # never intake, tiering or approval (the gates among them); nor the in-life stages, where a supplier lives
    assert [k for k, ok in stages.items() if not ok] == ["intake", "tiering", "approval", "monitoring", "reassessment"]
    assert [r["key"] for r in meta["roles"]] == ["tprm_lead", "tprm_analyst", "security", "privacy", "legal",
                                                 "procurement", "exec_approver", "it"]
    assert meta["roles"][-1] == {"key": "it", "label": "IT / Operations"}


def test_the_providers_read_a_config_or_a_snapshot():
    assert policy.remediation_days(None, "critical") == 7 and policy.remediation_days({}, "low") == 180
    assert policy.skip_matrix({}) == TIER_SKIPPABLE_STAGES
    assert policy.required_reviewers({}, "critical") == ["security", "privacy", "legal"]
    cfg = {"remediation_days": {"critical": 2}, "skip_matrix": {"high": ["findings"]},
           "required_reviewers": {"low": ["legal"]}}
    assert (policy.remediation_days(cfg, "critical"), policy.remediation_days(cfg, "high")) == (2, 30)
    assert policy.skip_matrix(cfg)["high"] == ["findings"] and policy.skip_matrix(cfg)["low"] == TIER_SKIPPABLE_STAGES["low"]
    assert policy.required_reviewers(cfg, "low") == ["legal"] and policy.required_reviewers(cfg, "medium") == ["security"]
    assert policy.reviewer_seats(cfg) == {"security", "privacy", "legal"}
    # a row edited by hand cannot skip a gate or the stages a supplier lives in
    assert policy.skip_matrix({"skip_matrix": {"low": ["approval", "scoring", "monitoring"]}})["low"] == ["scoring"]


def test_a_change_leaves_every_other_setting_and_is_audited(db):
    out = put(db, remediation_days={"critical": 3}, cadence_days={"critical": 90}, thresholds={"high": 60})
    assert out["remediation_days"] == {"critical": 3, "high": 30, "medium": 90, "low": 180}
    assert out["cadence_days"] == {"critical": 90, "high": 365, "medium": 730, "low": 1095}
    assert out["thresholds"] == {"critical": 75.0, "high": 60.0, "medium": 25.0}
    assert out["customised"] is True and out["defaults"]["remediation_days"]["critical"] == 7
    assert out == get(db)
    trail = db.query(TPRAAuditLog).filter_by(entity="policy", action="update").one()
    assert (trail.actor_id, sorted(json.loads(trail.to_value))) == (ADMIN, ["cadence_days", "remediation_days", "thresholds"])
    assert json.loads(trail.from_value)["remediation_days"]["critical"] == 7
    assert json.loads(trail.to_value)["remediation_days"]["critical"] == 3

    put(db, remediation_days={"critical": 3})                           # nothing changes: nothing is written
    assert db.query(TPRAAuditLog).filter_by(entity="policy").count() == 1

    put(db, remediation_days={"critical": 7, "high": 30})               # back to the defaults, tier by tier
    assert get(db)["remediation_days"] == DEFAULT_REMEDIATION_SLA_DAYS


def test_the_skips_and_reviewers_are_set_tier_by_tier_in_lifecycle_order(db):
    out = put(db, skip_matrix={"high": ["findings", "scoring", "scoring"], "low": []},
              required_reviewers={"medium": ["legal", "security", "legal"]})
    assert out["skip_matrix"]["high"] == ["scoring", "findings"] and out["skip_matrix"]["low"] == []
    assert out["skip_matrix"]["medium"] == ["dd_planning"] and out["skip_matrix"]["critical"] == []
    assert out["required_reviewers"]["medium"] == ["legal", "security"]
    assert out["required_reviewers"]["critical"] == ["security", "privacy", "legal"]


def test_approver_roles_are_set_here_and_the_rest_of_the_tier_policy_stays(db):
    before = tier_policy.merged(get_tiering_config(db, 1)["tier_policy"])
    out = put(db, approver_roles={"critical": "CISO"})
    assert out["approver_roles"] == {"critical": "CISO", "high": None, "medium": None, "low": None}
    after = tier_policy.merged(get_tiering_config(db, 1)["tier_policy"])
    assert after["critical"]["approver_role"] == "CISO" and after["critical"]["reassess_on"] == before["critical"]["reassess_on"]
    assert put(db, approver_roles={"critical": None})["approver_roles"]["critical"] is None


def test_the_reopen_thresholds_are_saved_with_the_rest_in_one_request_and_one_audit_row(db):
    before = tier_policy.merged(get_tiering_config(db, 1)["tier_policy"])
    put(db, remediation_days={"critical": 3}, reassess_on={"critical": "high", "low": "medium"}, approver_roles={"high": "CISO"})
    after = tier_policy.merged(get_tiering_config(db, 1)["tier_policy"])
    assert (after["critical"]["reassess_on"], after["low"]["reassess_on"]) == ("high", "medium")
    assert after["high"]["reassess_on"] == before["high"]["reassess_on"] and after["high"]["approver_role"] == "CISO"
    assert get(db)["remediation_days"]["critical"] == 3
    rows = db.query(TPRAAuditLog).filter(TPRAAuditLog.entity == "policy").all()
    assert len(rows) == 1                                                  # ONE audit row for the one save
    sent = json.loads(rows[0].to_value)
    assert sent["reassess_on"]["critical"] == "high" and json.loads(rows[0].from_value)["reassess_on"]["critical"] == before["critical"]["reassess_on"]
    count = db.query(TPRAAuditLog).count()
    put(db, reassess_on={"critical": "high"})                              # nothing changed: nothing written
    assert db.query(TPRAAuditLog).count() == count


def test_a_bad_reopen_threshold_saves_nothing_and_needs_the_same_right_as_the_config(db):
    with pytest.raises(HTTPException) as bad:
        put(db, remediation_days={"critical": 3}, reassess_on={"critical": "urgent"})
    assert bad.value.status_code == 400 and "Reassess on must be one of" in bad.value.detail
    assert get(db)["remediation_days"]["critical"] == 7 and db.query(TPRATieringConfig).count() == 0
    with pytest.raises(HTTPException) as bad_tier:
        put(db, reassess_on={"huge": "high"})
    assert bad_tier.value.status_code == 400
    with pytest.raises(HTTPException) as denied:
        put(db, READER, reassess_on={"low": "high"})
    assert denied.value.status_code == 403
    assert put(db, EDITOR, reassess_on={"low": "high"})                    # the config:edit holder may
    assert tier_policy.merged(get_tiering_config(db, 1)["tier_policy"])["low"]["reassess_on"] == "high"


def test_the_old_settings_api_keeps_working_on_the_same_row(db):
    admin = _user(db)
    put(db, remediation_days={"critical": 3}, cadence_days={"critical": 90})
    cfg = api.get_config(db=db, user=admin)
    assert cfg["cadence_days"]["critical"] == 90 and cfg["thresholds"] == DEFAULT_TIERING_CONFIG["thresholds"]
    assert "remediation_days" in cfg["defaults"]
    api.put_config(api.ConfigIn(cadence_days={"critical": 120}), db=db, user=admin)
    assert get(db)["cadence_days"]["critical"] == 120 and get(db)["remediation_days"]["critical"] == 3
    assert db.query(TPRATieringConfig).count() == 1


# ── checking a change ────────────────────────────────────────────────────────

@pytest.mark.parametrize("body, words", [
    ({"thresholds": {"critical": 50, "high": 50}}, "have to fall"),
    ({"thresholds": {"medium": 80}}, "have to fall"),
    ({"thresholds": {"critical": 101}}, "0 to 100"),
    ({"thresholds": {"medium": -1}}, "0 to 100"),
    ({"thresholds": {"high": True}}, "0 to 100"),
    ({"thresholds": {"low": 10}}, "Low has no band"),
    ({"cadence_days": {"critical": 29}}, "between 30 days"),
    ({"cadence_days": {"low": 1826}}, "between 30 days"),
    ({"cadence_days": {"high": "90"}}, "between 30 days"),
    ({"cadence_days": {"high": 90.5}}, "between 30 days"),
    ({"cadence_days": {"high": float("inf")}}, "between 30 days"),
    ({"cadence_days": {"urgent": 90}}, "no tier"),
    ({"remediation_days": {"critical": 0}}, "between 1 and 365"),
    ({"remediation_days": {"low": 366}}, "between 1 and 365"),
    ({"remediation_days": {"high": True}}, "between 1 and 365"),
    ({"skip_matrix": {"low": ["intake"]}}, "cannot be skipped"),
    ({"skip_matrix": {"low": ["tiering"]}}, "cannot be skipped"),
    ({"skip_matrix": {"low": ["approval"]}}, "cannot be skipped"),
    ({"skip_matrix": {"high": ["monitoring"]}}, "cannot be skipped"),
    ({"skip_matrix": {"high": ["reassessment"]}}, "cannot be skipped"),
    ({"skip_matrix": {"low": ["lunch"]}}, "no stage"),
    ({"skip_matrix": {"low": "scoring"}}, "list of stage keys"),
    ({"skip_matrix": {"huge": []}}, "no tier"),
    ({"required_reviewers": {"high": ["janitor"]}}, "not a roster role"),
    ({"required_reviewers": {"high": ["business_owner"]}}, "not a roster role"),
    ({"required_reviewers": {"high": "security"}}, "list of roster roles"),
    ({"approver_roles": {"critical": "Nobody"}}, "no role named"),
    ({"approver_roles": {"extreme": "CISO"}}, "tier"),
])
def test_a_bad_change_is_refused_with_a_reason_and_changes_nothing(db, body, words):
    good = {"cadence_days": {"medium": 100}} if "remediation_days" in body else {"remediation_days": {"critical": 2}}
    with pytest.raises(HTTPException) as bad:
        put(db, **good, **body)                                         # a good setting beside it is not kept either
    assert bad.value.status_code == 400 and words in bad.value.detail
    assert get(db)["remediation_days"]["critical"] == 7 and get(db)["cadence_days"]["medium"] == 730
    assert db.query(TPRATieringConfig).count() == 0 and db.query(TPRAAuditLog).count() == 0


def test_only_someone_with_the_config_right_changes_the_policy(db):
    with pytest.raises(HTTPException) as denied:
        put(db, READER, remediation_days={"low": 100})
    assert denied.value.status_code == 403
    assert put(db, EDITOR, remediation_days={"low": 100})["remediation_days"]["low"] == 100
    assert get(db, EDITOR)["can_edit"] is True and get(db, READER)["can_edit"] is False


def test_a_key_that_is_not_a_setting_is_refused(db):
    app = FastAPI()
    app.include_router(policy.router, prefix="/vendor-risk")
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[require_auth] = lambda: _user(db)
    web = TestClient(app)
    assert web.put("/vendor-risk/policy", json={"remedation_days": {"critical": 3}}).status_code == 422
    ok = web.put("/vendor-risk/policy", json={"remediation_days": {"critical": 3}})
    assert ok.status_code == 200 and ok.json()["remediation_days"]["critical"] == 3
    assert web.get("/vendor-risk/policy").json()["customised"] is True


# ── what the settings drive ──────────────────────────────────────────────────

def test_the_snapshot_holds_the_new_settings_and_work_under_way_keeps_them(db):
    old = _tiered(db, _vendor(db, "Old Co"), MEDIUM)
    assert old.policy_snapshot["remediation_days"] == DEFAULT_REMEDIATION_SLA_DAYS
    assert old.policy_snapshot["skip_matrix"]["medium"] == ["dd_planning"]
    assert old.policy_snapshot["required_reviewers"]["medium"] == ["security"]

    put(db, remediation_days={"critical": 3}, skip_matrix={"medium": []}, required_reviewers={"medium": ["legal"]})
    new = _tiered(db, _vendor(db, "New Co"), MEDIUM)
    held, fresh = service.config_for(db, old), service.config_for(db, new)
    assert policy.remediation_days(held, "critical") == 7 and policy.remediation_days(fresh, "critical") == 3
    assert policy.skip_matrix(held)["medium"] == ["dd_planning"] and policy.skip_matrix(fresh)["medium"] == []
    assert policy.required_reviewers(held, "medium") == ["security"]
    assert policy.required_reviewers(fresh, "medium") == ["legal"]
    # a snapshot copy is its own: a later change never reaches into it
    assert new.policy_snapshot["remediation_days"]["critical"] == 3

    service.run_tiering(db, db.get(Vendor, old.vendor_id), old, actor_id=ADMIN, factors=MEDIUM)   # a re-tier takes today's
    assert policy.remediation_days(service.config_for(db, old), "critical") == 3


def test_an_assessment_tiered_before_these_settings_existed_was_held_to_their_defaults(db):
    v = _vendor(db)
    a = service.ensure_active_assessment(db, v, actor_id=ADMIN)
    a.policy_snapshot = {"thresholds": dict(DEFAULT_TIERING_CONFIG["thresholds"]), "tier_policy": {}, "at": "2026-01-01"}
    b = service.ensure_active_assessment(db, _vendor(db, "No Snapshot"), actor_id=ADMIN)
    db.commit()
    put(db, remediation_days={"critical": 3}, skip_matrix={"medium": []}, required_reviewers={"medium": ["legal"]})
    held, live = service.config_for(db, a), service.config_for(db, b)
    assert policy.remediation_days(held, "critical") == 7 and policy.skip_matrix(held)["medium"] == ["dd_planning"]
    assert policy.required_reviewers(held, "medium") == ["security"]
    assert policy.remediation_days(live, "critical") == 3          # never tiered: it follows the settings


def test_the_skip_matrix_drives_the_stages_tiering_skips(db):
    default = _tiered(db, _vendor(db, "Default Co"), MEDIUM)
    assert _skipped(db, default) == ["dd_planning"]                 # what it has always done
    low = _tiered(db, _vendor(db, "Low Co"), LOW)
    assert _skipped(db, low) == ["dd_planning", "findings", "questionnaire", "scoring"]

    put(db, skip_matrix={"medium": ["dd_planning", "questionnaire"], "high": ["findings"], "low": ["contracting"]})
    medium = _tiered(db, _vendor(db, "Medium Co"), MEDIUM)
    high = _tiered(db, _vendor(db, "High Co"), HIGH)
    low2 = _tiered(db, _vendor(db, "Low Two"), LOW)
    assert _skipped(db, medium) == ["dd_planning", "questionnaire"]
    assert _skipped(db, high) == ["findings"]
    assert _skipped(db, low2) == ["contracting"]
    assert _skipped(db, default) == ["dd_planning"]                 # already tiered: left as it was


def test_a_manual_skip_goes_by_the_policy_the_assessment_is_held_to(db):
    v = _vendor(db)
    a = _tiered(db, v, MEDIUM)
    with pytest.raises(ValueError):
        service.skip_stage(db, v, a, "questionnaire", ADMIN, "not needed")
    put(db, skip_matrix={"medium": ["dd_planning", "questionnaire"]})
    with pytest.raises(ValueError):                                 # tiered before: the old rule still holds
        service.skip_stage(db, v, a, "questionnaire", ADMIN, "not needed")
    service.run_tiering(db, v, a, actor_id=ADMIN, factors=MEDIUM)   # re-tiered: today's rule, applied on the spot
    assert _skipped(db, a) == ["dd_planning", "questionnaire"]
    with pytest.raises(ValueError):                                 # and a stage that may never be skipped
        service.skip_stage(db, v, a, "approval", ADMIN, "no")


def test_the_reviewers_a_tier_needs_are_the_policys_and_the_rosters_fill_the_seats(db):
    admin = _user(db)
    put(db, required_reviewers={"medium": ["legal"]})
    v = _vendor(db)
    a = _tiered(db, v, MEDIUM)
    ctx = service.build_stage_context(db, v, a, "dd_planning")
    assert (ctx["reviewer_roles"], ctx["required_reviewers"], ctx["reviewers_assigned"]) == (["legal"], 1, 0)
    blockers = service.evaluate_current(db, v, a, "dd_planning")["blockers"]
    assert any("Legal" in b and "0 named" in b for b in blockers)

    roster.add_member("legal", roster.MemberIn(user_id=ALICE), db=db, user=admin)
    assert service.build_stage_context(db, v, a, "dd_planning")["reviewers_assigned"] == 1   # the roster's person
    assert service.conflicts(db, a).get(ALICE) == "reviewer"                                  # who cannot approve it
    a.team_roster = {"legal": BOB}                                                            # the supplier's own seat wins
    db.commit()
    assert service.build_stage_context(db, v, a, "dd_planning")["reviewers_assigned"] == 1
    assert service.conflicts(db, a).get(BOB) == "reviewer" and ALICE not in service.conflicts(db, a)


def test_the_reviewing_seats_follow_the_policy_an_assessment_was_tiered_under(db):
    before = _tiered(db, _vendor(db, "Before Co"), MEDIUM)          # security reviews, at some tier
    put(db, required_reviewers={"critical": [], "high": [], "medium": ["legal"]})
    after = _tiered(db, _vendor(db, "After Co"), MEDIUM)            # now only legal does
    for a in (before, after):
        a.team_roster = {"security": BOB}
    db.commit()
    assert (service.reviewers_assigned(db, before), service.reviewers_assigned(db, after)) == (1, 0)
    assert service.conflicts(db, before).get(BOB) == "reviewer" and BOB not in service.conflicts(db, after)


def test_the_days_to_fix_a_finding_set_the_remediation_due_date_from_the_assessments_policy(db):
    admin = _user(db)
    old = _tiered(db, _vendor(db, "Old Co"), MEDIUM)
    put(db, remediation_days={"critical": 3, "low": 365})
    new = _tiered(db, _vendor(db, "New Co"), MEDIUM)

    def due(a, severity, **kw):
        f = TPRAFinding(tenant_id=1, vendor_id=a.vendor_id, assessment_id=a.id, severity=severity, title="Gap", status="open")
        db.add(f)
        db.commit()
        r = api.create_remediation(f.id, api.RemediationIn(title="Fix it", **kw), db=db, user=admin)
        return (r["due_date"] - datetime.utcnow()).total_seconds() / 86400

    assert 6.9 < due(old, "critical") < 7.1                       # tiered under 7 days
    assert 2.9 < due(new, "critical") < 3.1                       # tiered under 3
    assert 29.9 < due(new, "high") < 30.1                         # a window not changed
    assert 364.9 < due(new, "low") < 365.1
    day = datetime.utcnow() + timedelta(days=11)
    assert due(new, "critical", due_date=day) == pytest.approx(11, abs=0.01)     # a date chosen is kept


def test_the_attention_queue_flags_a_critical_finding_past_the_window_its_assessment_was_tiered_under(db):
    old = _tiered(db, _vendor(db, "Old Co"), MEDIUM)
    put(db, remediation_days={"critical": 3})
    new = _tiered(db, _vendor(db, "New Co"), MEDIUM)
    for a in (old, new):
        db.add(TPRAFinding(tenant_id=1, vendor_id=a.vendor_id, assessment_id=a.id, severity="critical", status="open",
                           title="Gap", created_at=datetime.utcnow() - timedelta(days=5)))
    db.commit()
    flagged = {i["vendor_id"]: i for i in attention.open_items(db, 1, TODAY, REMINDERS)
               if i["condition"] == "critical_finding_past_sla"}
    assert set(flagged) == {new.vendor_id}                         # 5 days is past 3, not past 7
    assert "3-day SLA" in flagged[new.vendor_id]["title"]


def test_scheduling_a_reassessment_without_a_cadence_goes_by_settings_not_the_old_table(db):
    admin = _user(db)
    v = _vendor(db, tier="critical")
    lifecycle.schedule_reassessment(v.id, lifecycle.ScheduleReassessmentIn(), db=db, current_user=admin)
    assert v.reassessment_cadence_days == 180                       # Settings' critical, not the old table's 365
    assert (v.next_reassessment_date.date() - TODAY).days == 180
    api.put_config(api.ConfigIn(cadence_days={"critical": 90}), db=db, user=admin)
    lifecycle.schedule_reassessment(v.id, lifecycle.ScheduleReassessmentIn(), db=db, current_user=admin)
    assert v.reassessment_cadence_days == 90
    put(db, cadence_days={"critical": 120})
    lifecycle.schedule_reassessment(v.id, lifecycle.ScheduleReassessmentIn(), db=db, current_user=admin)
    assert v.reassessment_cadence_days == 120
    lifecycle.schedule_reassessment(v.id, lifecycle.ScheduleReassessmentIn(cadence_days=45), db=db, current_user=admin)
    assert v.reassessment_cadence_days == 45                        # one given still wins
