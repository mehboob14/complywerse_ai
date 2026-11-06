"""Scope, predicates, temporal ops, joins and aggregation.

These are the shapes the engine could not express: a population selected before
it is judged, an age threshold, an ordering, and a join across two systems. The
cases worth writing down are the ones where a plausible implementation is
silently wrong rather than loudly broken.
"""
from datetime import datetime, timedelta, timezone

import pytest

from grc.modules.compliance_plugins.runners.assertions import (
    SpecError,
    aggregate,
    evaluate_op,
    evaluate_predicate,
    join_rows,
    parse_duration,
    parse_time,
    select,
)

NOW = datetime(2026, 9, 9, 12, 0, tzinfo=timezone.utc)


def ago(days):
    return (NOW - timedelta(days=days)).isoformat()


# ── durations and timestamps ─────────────────────────────────────────────────

def test_durations_are_written_the_way_a_control_writes_them():
    assert parse_duration("15d") == timedelta(days=15)
    assert parse_duration("90d") == timedelta(days=90)
    assert parse_duration("12mo") == timedelta(days=360)
    assert parse_duration("1y") == timedelta(days=365)
    assert parse_duration("36h") == timedelta(days=1.5)


def test_an_unparseable_duration_is_none_not_zero():
    # Zero would make every age breach the window and fail the whole population.
    assert parse_duration("soon") is None
    assert parse_duration(None) is None


def test_naive_timestamps_are_assumed_utc_rather_than_rejected():
    assert parse_time("2026-09-09T12:00:00").tzinfo is not None


def test_z_suffix_and_epoch_both_parse():
    assert parse_time("2026-09-09T12:00:00Z") == NOW
    assert parse_time(NOW.timestamp()) == NOW


def test_an_unparseable_timestamp_is_unknown_not_ancient():
    # The dangerous failure: garbage parsed as 1970 makes everything overdue.
    assert parse_time("last tuesday") is None
    assert evaluate_op("last tuesday", "older_than", "1d", now=NOW) is False


# ── operators ────────────────────────────────────────────────────────────────

def test_the_comparison_operators_the_engine_was_missing():
    assert evaluate_op(14, "gte", 14) and evaluate_op(15, "gte", 14)
    assert not evaluate_op(13, "gte", 14)
    assert evaluate_op(8, "lte", 12)
    assert evaluate_op("TLS1.2", "matches", r"TLS1\.[23]")
    assert not evaluate_op("TLS1.0", "matches", r"TLS1\.[23]")


def test_a_bad_regex_is_false_not_an_exception():
    assert evaluate_op("x", "matches", "[unclosed") is False


def test_comparing_none_never_raises_and_never_passes():
    for op in ("gt", "gte", "lt", "lte"):
        assert evaluate_op(None, op, 5) is False


def test_temporal_age_thresholds():
    assert evaluate_op(ago(3), "within", "15d", now=NOW)
    assert not evaluate_op(ago(20), "within", "15d", now=NOW)
    assert evaluate_op(ago(20), "older_than", "15d", now=NOW)


def test_temporal_ordering_is_what_approval_before_merge_needs():
    approved, merged = ago(2), ago(1)
    assert evaluate_op(approved, "before", merged, now=NOW)
    assert not evaluate_op(merged, "before", approved, now=NOW)
    assert evaluate_op(merged, "after", approved, now=NOW)


# ── predicates ───────────────────────────────────────────────────────────────

def test_a_predicate_tree_expresses_a_real_population():
    row = {"state": "active", "kind": "human", "mfa": False}
    pred = {"and": [["state", "eq", "active"], {"not": ["kind", "eq", "service"]}]}
    assert evaluate_predicate(pred, row)


def test_exists_quantifies_over_a_nested_list():
    row = {"user": "a", "factors": [{"type": "sms"}, {"type": "webauthn"}]}
    assert evaluate_predicate(
        {"exists": {"in": "factors", "where": ["type", "eq", "webauthn"]}}, row)
    assert not evaluate_predicate(
        {"exists": {"in": "factors", "where": ["type", "eq", "yubikey"]}}, row)


def test_a_row_can_be_compared_against_its_joined_counterpart():
    # Scenario 4: the approval must exist BEFORE the merge, and the reviewer must
    # not be the author. Both facts live on opposite sides of a join.
    pr = {"merged_at": ago(1), "author": "alice",
          "_joined": {"approved_at": ago(2), "reviewer": "bob"}}
    assert evaluate_predicate(
        ["joined:date:approved_at", "before", "{{self.merged_at}}"], pr)
    assert evaluate_predicate(["joined:reviewer", "ne", "{{self.author}}"], pr)

    self_approved = {**pr, "_joined": {"approved_at": ago(2), "reviewer": "alice"}}
    assert not evaluate_predicate(["joined:reviewer", "ne", "{{self.author}}"], self_approved)

    merged_first = {**pr, "_joined": {"approved_at": ago(0), "reviewer": "bob"}}
    assert not evaluate_predicate(
        ["joined:date:approved_at", "before", "{{self.merged_at}}"], merged_first)


@pytest.mark.parametrize("bad", [
    [["nested", "truthy"]],          # a leaf wrapped in a list
    ["only_one"],                    # too short
    {"unknown_node": 1},             # not a known combinator
    {},                              # empty
    "a string",                      # not a node at all
])
def test_a_malformed_predicate_raises_rather_than_failing_every_row(bad):
    # This is the footgun that matters: False for every row marks the entire
    # population as offending, which is indistinguishable from a real total
    # failure and would be believed.
    with pytest.raises(SpecError):
        evaluate_predicate(bad, {"x": 1})


# ── scope ────────────────────────────────────────────────────────────────────

def test_scope_selects_the_population_before_anything_is_judged():
    devices = [
        {"n": "mac", "type": "laptop", "own": "corporate"},
        {"n": "srv", "type": "server", "own": "corporate"},
        {"n": "byo", "type": "laptop", "own": "personal"},
    ]
    scoped = select(devices, {"and": [["type", "eq", "laptop"], ["own", "eq", "corporate"]]})
    assert [d["n"] for d in scoped] == ["mac"]


def test_no_scope_means_everything():
    rows = [{"a": 1}, {"a": 2}]
    assert select(rows, None) == rows


# ── joins ────────────────────────────────────────────────────────────────────

def test_join_finds_the_rows_with_no_counterpart():
    inv = [{"serial": "A1"}, {"serial": "B2"}, {"serial": "C3"}]
    agents = [{"dev": "a1"}, {"dev": "B2"}]
    matched, unmatched = join_rows(inv, agents, ("serial", "dev"))
    assert [m["serial"] for m in matched] == ["A1", "B2"]
    assert [u["serial"] for u in unmatched] == ["C3"]


def test_join_keys_normalize_across_systems_that_disagree_on_case():
    matched, unmatched = join_rows(
        [{"e": "Jo@Example.com"}], [{"e2": "jo@example.com"}], ("e", "e2"))
    assert len(matched) == 1 and not unmatched


def test_a_blank_key_never_matches_another_blank_key():
    # Two rows missing the join key are not the same entity, and treating them as
    # matched would quietly mark an unmanaged device as covered.
    matched, unmatched = join_rows([{"k": None}], [{"k2": ""}], ("k", "k2"))
    assert not matched and len(unmatched) == 1


# ── aggregation ──────────────────────────────────────────────────────────────

ROWS = [{"n": 1, "ok": True}, {"n": 2, "ok": False}, {"n": 3, "ok": True}]


def test_all_any_none():
    assert aggregate(ROWS, {"all": ["ok", "truthy"]}).status == "fail"
    assert aggregate(ROWS, {"any": ["ok", "truthy"]}).status == "pass"
    assert aggregate(ROWS, {"none": ["ok", "falsy"]}).status == "fail"
    assert aggregate([r for r in ROWS if r["ok"]], {"all": ["ok", "truthy"]}).status == "pass"


def test_count_and_ratio_thresholds():
    assert aggregate(ROWS, {"count": ["lte", 5, ["ok", "truthy"]]}).status == "pass"
    assert aggregate(ROWS, {"count": ["gte", 3, ["ok", "truthy"]]}).status == "fail"
    assert aggregate(ROWS, {"ratio": ["gte", 0.6, ["ok", "truthy"]]}).status == "pass"
    assert aggregate(ROWS, {"ratio": ["gte", 0.9, ["ok", "truthy"]]}).status == "fail"


def test_the_empty_population_verdict_belongs_to_the_author():
    # "no public buckets" over zero buckets is not_applicable; "at least one
    # backup exists" over zero backups is a fail. Only the check knows which, so
    # the engine must not guess.
    assert aggregate([], {"none": ["public", "truthy"]}).status == "not_applicable"
    assert aggregate([], {"any": ["ok", "truthy"]}, empty="fail").status == "fail"


def test_a_verdict_carries_the_arithmetic_behind_it():
    v = aggregate(ROWS, {"all": ["ok", "truthy"]}, population=10)
    assert (v.population, v.tested, len(v.offenders)) == (10, 3, 1)


def test_no_aggregation_declared_is_not_a_pass():
    assert aggregate(ROWS, {}).status == "not_run"
