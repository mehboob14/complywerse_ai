"""A tenant's own status levels, SLA days and extra fields.

Status vocabularies were Python constants in fifteen places, so nobody could add
"Awaiting regulator" without a release, and every user-defined-field mechanism in
the repo stored whatever it was handed. Both are settled here: the settings are
data, and values are validated before they land.
"""
from datetime import datetime, timedelta

import pytest

from grc.services import module_settings as ms


def _settings(**overrides):
    """The shipped statutory-audit defaults, with sections swapped in."""
    base = ms.get_settings.__wrapped__ if hasattr(ms.get_settings, "__wrapped__") else None
    assert base is None  # get_settings needs a session; tests build the doc directly
    doc = {
        "statuses": [dict(s) for s in ms.MODULES["statutory_audit"]["defaults"]["statuses"]],
        "sla": dict(ms.MODULES["statutory_audit"]["defaults"]["sla"]),
        "fields": [],
    }
    doc.update(overrides)
    return doc


# ── status levels ────────────────────────────────────────────────────────────

def test_shipped_statuses_match_what_the_records_already_use():
    keys = ms.status_keys(_settings())
    assert keys == ["open", "in_progress", "complied", "closed", "cancelled"]
    assert ms.is_terminal(_settings(), "closed")
    assert not ms.is_terminal(_settings(), "open")


def test_a_status_list_must_have_a_closing_level():
    with pytest.raises(ValueError, match="closing the record"):
        ms._clean_statuses([{"key": "open", "label": "Open"}])


def test_status_keys_are_checked_and_deduplicated():
    with pytest.raises(ValueError, match="lower case"):
        ms._clean_statuses([{"key": "Awaiting Regulator", "label": "x", "terminal": True}])
    with pytest.raises(ValueError, match="listed twice"):
        ms._clean_statuses([
            {"key": "open", "label": "Open"},
            {"key": "open", "label": "Open again", "terminal": True},
        ])


def test_a_tenant_can_add_a_level_with_its_own_escalation_days():
    cleaned = ms._clean_statuses([
        {"key": "open", "label": "Open", "order": 1, "escalate_after_days": 5},
        {"key": "awaiting_regulator", "label": "Awaiting regulator", "order": 2, "tone": "violet"},
        {"key": "closed", "label": "Closed", "order": 3, "terminal": True},
    ])
    assert [s["key"] for s in cleaned] == ["open", "awaiting_regulator", "closed"]
    assert cleaned[0]["escalate_after_days"] == 5
    assert cleaned[1]["tone"] == "violet"


# ── the clock ────────────────────────────────────────────────────────────────

NOW = datetime(2026, 9, 23, 12, 0)


def test_a_closed_record_has_no_sla_state():
    state = ms.sla_state(_settings(), status="closed", due_date=NOW - timedelta(days=100),
                         priority="critical", now=NOW)
    assert state["state"] == "closed"
    assert state["days_overdue"] is None


@pytest.mark.parametrize("days_out,expected", [(30, "on_track"), (3, "due_soon"), (0, "due_soon"), (-5, "breached")])
def test_due_dates_land_in_the_right_state(days_out, expected):
    state = ms.sla_state(_settings(), status="open", due_date=NOW + timedelta(days=days_out),
                         priority="high", now=NOW)
    assert state["state"] == expected


def test_a_record_with_no_due_date_gets_one_implied_from_its_priority():
    state = ms.sla_state(_settings(), status="open", due_date=None, priority="critical",
                         opened_at=NOW - timedelta(days=40), now=NOW)
    assert state["implied_due_date"] is True      # critical allows 30 days
    assert state["state"] == "breached"
    assert state["days_overdue"] == 10


def test_no_due_date_and_no_priority_is_stated_not_guessed():
    state = ms.sla_state(_settings(), status="open", due_date=None, priority=None, now=NOW)
    assert state["state"] == "no_due_date"


def test_escalation_uses_the_status_level_before_the_module_default():
    settings = _settings()
    settings["sla"]["escalate_after_days"] = 60
    # "open" ships with 14 days, so it escalates first.
    state = ms.sla_state(settings, status="open", due_date=NOW - timedelta(days=20),
                         priority="high", now=NOW)
    assert (state["escalate_after_days"], state["escalated"]) == (14, True)
    state = ms.sla_state(settings, status="complied", due_date=NOW - timedelta(days=20),
                         priority="high", now=NOW)
    assert (state["escalate_after_days"], state["escalated"]) == (60, False)


# ── SLA settings validation ──────────────────────────────────────────────────

def test_sla_days_are_bounded_and_priorities_checked():
    module = ms.MODULES["statutory_audit"]
    current = dict(module["defaults"]["sla"])
    with pytest.raises(ValueError, match="Unknown priority"):
        ms._clean_sla({"by_priority": {"urgent": 5}}, module, current)
    with pytest.raises(ValueError, match="between 0 and 3650"):
        ms._clean_sla({"by_priority": {"high": 99999}}, module, current)
    with pytest.raises(ValueError, match="Unknown SLA setting"):
        ms._clean_sla({"escalate_after_hours": 4}, module, current)
    saved = ms._clean_sla({"by_priority": {"high": 45}, "escalate_to": ["role:Head of Audit"]},
                          module, current)
    assert saved["by_priority"]["high"] == 45
    assert saved["by_priority"]["low"] == current["by_priority"]["low"]   # untouched


def test_escalation_targets_name_a_role_or_a_user():
    module = ms.MODULES["statutory_audit"]
    with pytest.raises(ValueError, match="must start with"):
        ms._clean_sla({"escalate_to": ["the audit committee"]}, module, dict(module["defaults"]["sla"]))


# ── extra fields ─────────────────────────────────────────────────────────────

FIELDS = [
    {"key": "root_cause", "label": "Root cause", "type": "text", "required": True},
    {"key": "recurrence", "label": "Recurrence", "type": "select", "options": ["First", "Repeat"]},
    {"key": "fine_amount", "label": "Fine amount", "type": "number"},
    {"key": "committee_date", "label": "Committee date", "type": "date"},
]


def test_a_select_field_needs_options():
    with pytest.raises(ValueError, match="at least one option"):
        ms._clean_fields([{"key": "recurrence", "label": "Recurrence", "type": "select"}], [])


def test_removing_a_field_archives_it_so_recorded_values_survive():
    existing = ms._clean_fields(FIELDS, [])
    after = ms._clean_fields([f for f in FIELDS if f["key"] != "fine_amount"], existing)
    archived = [f for f in after if f["key"] == "fine_amount"]
    assert archived and archived[0]["archived"] is True
    assert "fine_amount" not in [f["key"] for f in ms.active_fields({"fields": after})]


def test_values_are_validated_against_their_field():
    settings = _settings(fields=ms._clean_fields(FIELDS, []))
    cleaned = ms.validate_custom_values(settings, {
        "root_cause": "  Access review not performed  ", "recurrence": "Repeat",
        "fine_amount": "2500", "committee_date": "2026-10-01",
    })
    assert cleaned["root_cause"] == "Access review not performed"
    assert cleaned["fine_amount"] == 2500
    assert cleaned["committee_date"] == "2026-10-01"

    with pytest.raises(ValueError, match="must be one of"):
        ms.validate_custom_values(settings, {"root_cause": "x", "recurrence": "Third time"})
    with pytest.raises(ValueError, match="must be a number"):
        ms.validate_custom_values(settings, {"root_cause": "x", "fine_amount": "a lot"})
    with pytest.raises(ValueError, match="must be a date"):
        ms.validate_custom_values(settings, {"root_cause": "x", "committee_date": "01/10/2026"})
    with pytest.raises(ValueError, match="not a field on this record"):
        ms.validate_custom_values(settings, {"root_cause": "x", "invented": "y"})


def test_a_required_field_is_enforced_on_a_full_save_only():
    settings = _settings(fields=ms._clean_fields(FIELDS, []))
    with pytest.raises(ValueError, match="is required"):
        ms.validate_custom_values(settings, {"recurrence": "First"})
    # a patch of one field must not demand the others
    assert ms.validate_custom_values(settings, {"recurrence": "First"}, partial=True) == {
        "recurrence": "First"}


def test_an_archived_field_cannot_be_written_again():
    fields = ms._clean_fields([f for f in FIELDS if f["key"] != "fine_amount"],
                              ms._clean_fields(FIELDS, []))
    settings = _settings(fields=fields)
    with pytest.raises(ValueError, match="has been removed"):
        ms.validate_custom_values(settings, {"root_cause": "x", "fine_amount": 10}, partial=True)


def test_unknown_module_and_unknown_section_are_refused():
    with pytest.raises(ValueError, match="Unknown module"):
        ms.spec("not_a_module")


# ── dropdown lists ───────────────────────────────────────────────────────────

def _lists(module_key):
    return {k: dict(v) for k, v in ms.MODULES[module_key]["lists"].items()}


def test_a_fixed_list_keys_new_options_by_slug_and_archives_the_ones_taken_out():
    saved = ms._clean_lists({"environment": [{"label": "Production"}, {"label": "Pre-prod"}]},
                            ms.MODULES["assets"], _lists("assets"))
    by_value = {o["value"]: o for o in saved["environment"]}
    assert by_value["pre_prod"]["label"] == "Pre-prod" and not by_value["pre_prod"]["archived"]
    assert by_value["staging"]["archived"] is True       # records holding it keep its name
    assert saved["location"] == ms.MODULES["assets"]["lists"]["location"]["options"]   # untouched


def test_a_free_text_list_keeps_the_label_as_the_value():
    saved = ms._clean_lists({"location": ["Karachi DC"]}, ms.MODULES["assets"], _lists("assets"))
    assert saved["location"][0] == {"value": "Karachi DC", "label": "Karachi DC", "archived": False}


@pytest.mark.parametrize("raw,message", [
    ({"environment": [{"label": "Prod"}, {"label": "prod"}]}, "listed twice"),
    ({"environment": [{"label": "Production", "archived": True}]}, "at least one option in use"),
    ({"environment": []}, "at least one option"),
    ({"colour": ["Red"]}, "not a dropdown you can change here"),
])
def test_bad_lists_are_refused(raw, message):
    with pytest.raises(ValueError, match=message):
        ms._clean_lists(raw, ms.MODULES["assets"], _lists("assets"))


def test_archived_options_are_hidden_from_new_records_only():
    settings = {"lists": {"environment": {"options": [
        {"value": "production", "label": "Production", "archived": False},
        {"value": "dr", "label": "DR", "archived": True}]}}}
    assert [o["value"] for o in ms.list_options(settings, "environment")] == ["production"]
    assert len(ms.list_options(settings, "environment", include_archived=True)) == 2


# ── the clock, per status and per property ───────────────────────────────────

def test_a_paused_status_stops_the_clock_even_past_the_due_date():
    statuses = ms._clean_statuses([
        {"key": "open", "label": "Open"},
        {"key": "awaiting_regulator", "label": "Awaiting regulator", "clock": "paused"},
        {"key": "closed", "label": "Closed", "terminal": True},
    ])
    state = ms.sla_state(_settings(statuses=statuses), status="awaiting_regulator",
                         due_date=NOW - timedelta(days=30), priority="high", now=NOW)
    assert state["state"] == "paused"
    with pytest.raises(ValueError, match="SLA clock"):
        ms._clean_statuses([{"key": "closed", "label": "Closed", "terminal": True, "clock": "sometimes"}])


def test_per_priority_targets_carry_their_own_reminder_and_escalation():
    module = ms.MODULES["statutory_audit"]
    sla = ms._clean_sla({"targets": {"high": {"days": 20, "notify_before": 5, "escalate_after": 2}}},
                        module, dict(module["defaults"]["sla"]))
    assert sla["by_priority"]["high"] == 20            # kept in step for older readers
    settings = _settings(sla=sla)
    # "complied" has no escalation of its own, so the target row's 2 days apply
    state = ms.sla_state(settings, status="complied", due_date=NOW - timedelta(days=3), priority="high", now=NOW)
    assert (state["escalate_after_days"], state["escalated"], state["remind_before_due"]) == (2, True, 5)
    with pytest.raises(ValueError, match="not a value the SLA follows"):
        ms._clean_sla({"targets": {"urgent": {"days": 1}}}, module, dict(module["defaults"]["sla"]))


# ── against a database: sections, drivers, record values ─────────────────────

from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402

from grc.models import (  # noqa: E402
    AuditLog, Base, GRCUser, ITAsset, ModuleSettings, Tenant, Vulnerability, VulnerabilityAssetLink,
    VulnerabilityControlLink, VulnerabilitySLAConfig,
)


@pytest.fixture()
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    tables = [Tenant, GRCUser, ModuleSettings, AuditLog, Vulnerability, VulnerabilitySLAConfig,
              VulnerabilityAssetLink, VulnerabilityControlLink, ITAsset]
    Base.metadata.create_all(engine, tables=[m.__table__ for m in tables])
    s = sessionmaker(bind=engine)()
    s.add(Tenant(id=1, name="Bank", slug="bank"))
    s.add(GRCUser(id=7, username="officer", display_name="Officer", email="officer@bank.test", is_active=True))
    s.commit()
    yield s
    s.close()


IMPACT = {"key": "business_impact", "label": "Business impact", "type": "select", "options": ["Tier 1", "Tier 2"]}


def test_a_module_only_takes_the_sections_it_offers(db):
    with pytest.raises(ValueError, match="has no 'sla' settings"):
        ms.save_settings(db, 1, "assets", {"sla": {"due_soon_days": 3}})
    saved = ms.save_settings(db, 1, "assets", {"lists": {"vendor": ["Temenos", "Microsoft"]}})
    assert [o["value"] for o in ms.list_options(saved, "vendor")] == ["Temenos", "Microsoft"]
    assert "sla" not in saved and saved["module"]["sections"] == ["fields", "lists"]


def test_the_sla_can_follow_a_tenant_dropdown_and_that_field_cannot_be_retired(db):
    ms.save_settings(db, 1, "statutory_audit", {"fields": [IMPACT]})
    saved = ms.save_settings(db, 1, "statutory_audit", {"sla": {
        "driver": "field:business_impact", "targets": {"Tier 1": {"days": 5, "escalate_after": 3}}}})
    state = ms.sla_state(saved, status="complied", due_date=None, opened_at=NOW - timedelta(days=10),
                         values={"business_impact": "Tier 1"}, now=NOW)
    assert (state["target_days"], state["state"], state["escalated"]) == (5, "breached", True)
    with pytest.raises(ValueError, match="cannot follow it"):
        ms.save_settings(db, 1, "statutory_audit", {"fields": []})
    # back to priority: the per-tier days mean nothing there, so they go
    saved = ms.save_settings(db, 1, "statutory_audit", {"sla": {"driver": "priority"}})
    assert saved["sla"]["targets"] == {}


def test_record_values_are_left_alone_by_callers_that_send_none(db):
    ms.save_settings(db, 1, "vulnerabilities", {"fields": [
        {"key": "owner_team", "label": "Owner team", "type": "text", "required": True}, IMPACT]})
    assert ms.clean_record_values(db, 1, "vulnerabilities", None, {"owner_team": "NOC"}, creating=False) == {
        "owner_team": "NOC"}
    with pytest.raises(ValueError, match="is required"):
        ms.clean_record_values(db, 1, "vulnerabilities", {"business_impact": "Tier 1"}, creating=True)
    merged = ms.clean_record_values(db, 1, "vulnerabilities", {"business_impact": "Tier 2"},
                                    {"owner_team": "NOC"}, creating=False)
    assert merged == {"owner_team": "NOC", "business_impact": "Tier 2"}


# ── over HTTP ────────────────────────────────────────────────────────────────

import importlib  # noqa: E402

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from grc.models import get_db  # noqa: E402
from grc.routers.auth_router import require_auth  # noqa: E402

# the module itself: grc.routers re-exports its APIRouter under the same name
settings_router = importlib.import_module("grc.routers.module_settings_router")


def _app(db, *routers):
    app = FastAPI()
    for router in routers:
        app.include_router(router)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[require_auth] = lambda: db.get(GRCUser, 7)
    for route in app.routes:          # route-level permission checks: granted here
        for dep in getattr(getattr(route, "dependant", None), "dependencies", []):
            if getattr(dep.call, "__name__", "") == "permission_checker":
                app.dependency_overrides[dep.call] = lambda: True
    return TestClient(app)


def test_each_module_is_gated_on_its_own_permission(db, monkeypatch):
    asked = []
    monkeypatch.setattr(settings_router, "require_tenant_permission",
                        lambda name: (asked.append(name), lambda **_: True)[1])
    http = _app(db, settings_router.router)
    assert http.get("/module-settings/assets").status_code == 200
    r = http.put("/module-settings/assets", json={"lists": {"environment": ["Production", "Pre-prod"]}})
    assert r.status_code == 200, r.text
    assert asked == ["assets:asset_inventory:view", "assets:asset_inventory:edit"]
    assert http.put("/module-settings/assets", json={"statuses": []}).status_code == 400
    assert http.get("/module-settings/payroll").status_code == 404
    # a "person" field names people for anyone who can see the form
    assert http.get("/module-settings/risks/people").json() == [{"id": 7, "display_name": "Officer"}]
    assert asked[-1] == "erm:risks:view"


def test_a_vulnerability_carries_its_custom_values(db):
    from grc.modules.vuln_management.routers import vulnerabilities
    ms.save_settings(db, 1, "vulnerabilities", {"fields": [IMPACT]})
    http = _app(db, vulnerabilities.router)
    bad = http.post("/vulnerabilities", json={"title": "Open SMB", "severity": "high",
                                              "custom_values": {"business_impact": "Tier 9"}})
    assert bad.status_code == 400 and "must be one of" in bad.json()["detail"]
    made = http.post("/vulnerabilities", json={"title": "Open SMB", "severity": "high",
                                               "custom_values": {"business_impact": "Tier 1"}})
    assert made.status_code == 201, made.text
    assert made.json()["custom_values"] == {"business_impact": "Tier 1"}
    vid = made.json()["id"]
    changed = http.put(f"/vulnerabilities/{vid}", json={"custom_values": {"business_impact": "Tier 2"}})
    assert changed.status_code == 200, changed.text
    assert db.get(Vulnerability, vid).custom_values == {"business_impact": "Tier 2"}
