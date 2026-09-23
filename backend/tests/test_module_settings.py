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
