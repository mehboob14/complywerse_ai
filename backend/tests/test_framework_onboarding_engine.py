"""The pure rules of framework onboarding (no database): what a saved value may be, when a field counts as filled, and how readiness is worked out
from the catalog: conditional fields, the gate checks, what the organisation profile must hold. Plus a sweep that every framework of the catalog
can be filled and evaluated without an error."""
import pytest

from _fwonb_world import Sampler, answers_for, profile_values
from grc.modules.framework_onboarding import catalog, engine

F = engine.FieldError


def fld(type_, **more):
    return {"key": "x", "label": "X", "type": type_, "level": "required", **more}


# ---------------------------------------------------------------- what may be saved
def test_numbers_dates_and_choices_are_checked_and_a_blank_clears():
    assert engine.normalise(fld("number", min=1), "12") == 12 and engine.normalise(fld("number"), 2.5) == 2.5
    with pytest.raises(F):
        engine.normalise(fld("number", min=1), 0)
    with pytest.raises(F):
        engine.normalise(fld("number"), True)
    assert engine.normalise(fld("date"), "2026-03-01T10:00:00") == "2026-03-01"
    with pytest.raises(F):
        engine.normalise(fld("date"), "01/03/2026")
    c = fld("choice", options=["A", "B"])
    assert engine.normalise(c, "A") == "A" and engine.normalise(c, "") is None
    with pytest.raises(F):
        engine.normalise(c, "C")
    m = fld("multichoice", options=["A", "B", "C"])
    assert engine.normalise(m, ["C", "A"]) == ["A", "C"]
    with pytest.raises(F):
        engine.normalise(m, ["Z"])
    assert engine.normalise(fld("bool"), False) is False and engine.normalise(fld("bool"), None) is None
    with pytest.raises(F):
        engine.normalise(fld("bool"), "yes")


def test_a_person_is_a_user_of_the_organisation_or_an_outside_party_with_a_name():
    kn = engine.Known(users={7})
    assert engine.normalise(fld("person"), {"user_id": "7"}, kn) == {"user_id": 7}
    with pytest.raises(F):
        engine.normalise(fld("person"), {"user_id": 99}, kn)
    assert engine.normalise(fld("person"), {"name": " Sana ", "email": "s@x.test", "extra": 1}) == {"name": "Sana", "email": "s@x.test"}
    with pytest.raises(F):
        engine.normalise(fld("person"), {"email": "s@x.test"})


def test_table_rows_keep_their_ids_lose_empty_rows_and_never_share_an_id():
    t = fld("table", columns=[{"key": "name", "label": "Name", "type": "text", "required": True}, {"key": "n", "label": "N", "type": "number"}])
    rows = engine.normalise(t, [{"id": "r1", "name": "A", "n": "3", "junk": 1}, {"name": ""}, {"id": "r1", "name": "B"}, {"name": "C"}])
    assert [r["name"] for r in rows] == ["A", "B", "C"] and rows[0]["id"] == "r1" and rows[0]["n"] == 3 and "junk" not in rows[0]
    assert len({r["id"] for r in rows}) == 3 and all(r["id"] for r in rows)
    with pytest.raises(F, match="N"):
        engine.normalise(t, [{"name": "A", "n": "many"}])


def test_picks_must_come_from_the_organisation():
    kn = engine.Known(assets={5}, departments={2}, row_ids={"sites": {"r1"}})
    assert engine.normalise(fld("org_pick", of="sites"), ["r1"], kn) == ["r1"]
    with pytest.raises(F):
        engine.normalise(fld("org_pick", of="sites"), ["r9"], kn)
    assert engine.normalise(fld("org_pick", of="systems"), [5], kn) == [5]
    with pytest.raises(F):
        engine.normalise(fld("org_pick", of="departments"), [3], kn)
    with pytest.raises(F):
        engine.normalise(fld("departments_derived"), [2], kn)


# ---------------------------------------------------------------- filled
def test_a_yes_or_no_is_answered_when_it_is_either_and_a_tick_holds_only_when_ticked():
    b = fld("bool")
    assert engine.answered(b, False) and engine.answered(b, True) and not engine.answered(b, None)
    assert engine.has_value(b, True) and not engine.has_value(b, False)


def test_a_list_needs_its_minimum_of_complete_rows():
    t = fld("table", min_rows=2, columns=[{"key": "name", "label": "Name", "type": "text", "required": True}, {"key": "o", "label": "O", "type": "text"}])
    assert not engine.answered(t, [{"name": "A"}]) and not engine.answered(t, [{"name": "A"}, {"o": "only optional"}])
    assert engine.answered(t, [{"name": "A"}, {"name": "B"}])
    assert not engine.answered(fld("org_pick", of="sites", min_rows=1), []) and engine.answered(fld("org_pick", of="sites"), ["r1"])


def test_the_same_person_is_the_same_user_or_the_same_email():
    assert engine.same_person({"user_id": 1}, {"user_id": 1}) and not engine.same_person({"user_id": 1}, {"user_id": 2})
    assert engine.same_person({"name": "A", "email": "A@x.test"}, {"name": "B", "email": "a@x.test"})
    assert engine.same_person({"name": "Sana"}, {"name": " sana "}) and not engine.same_person({"user_id": 1}, {"name": "Sana"})


# ---------------------------------------------------------------- readiness on a small catalog
MINI = {
    "slug": "mini",
    "steps": [
        {"key": "route", "label": "Route", "fields": [
            fld("choice", key="goal", label="Goal", options=["Certify", "Align"]),
            fld("text", key="body", label="Body", when={"field": "route.goal", "eq": "Certify"}),
            fld("date", key="start", label="Start", level="advised"),
            fld("date", key="end", label="End", level="advised"),
            fld("multichoice", key="cats", label="Cats", options=["Security", "Privacy"]),
            fld("text", key="privacy_note", label="Privacy note", when={"field": "route.cats", "includes": "Privacy"}),
        ]},
        {"key": "people", "label": "People", "fields": [
            fld("person", key="owner", label="Owner"), fld("person", key="approver", label="Approver", level="advised"),
            fld("table", key="provs", label="Providers", level="advised", columns=[
                {"key": "method", "label": "Method", "type": "choice", "options": ["Carve-out", "Inclusive"]},
                {"key": "report", "label": "Report", "type": "choice", "options": ["None", "SOC 2"]}]),
        ]},
    ],
    "gate": [
        {"key": "order", "label": "Start before end", "level": "required", "check": {"type": "before", "first": "route.start", "second": "route.end"}, "hint": "h"},
        {"key": "span", "label": "At least 90 days", "level": "advised", "check": {"type": "span_at_least_days", "first": "route.start", "second": "route.end", "days": 90}, "hint": "h"},
        {"key": "who", "label": "Different people", "level": "required", "check": {"type": "distinct", "fields": ["people.owner", "people.approver"]}, "hint": "h"},
        {"key": "sec", "label": "Security chosen", "level": "required", "check": {"type": "includes", "field": "route.cats", "value": "Security"}, "hint": "h"},
        {"key": "carve", "label": "Carve-outs have a report", "level": "required", "check": {"type": "table_rule", "field": "people.provs", "when_column": "method", "equals": "Carve-out", "then_column": "report", "not_equals": "None"}, "hint": "h"},
        {"key": "certonly", "label": "Body named", "level": "required", "when": {"field": "route.goal", "eq": "Certify"}, "check": {"type": "filled", "field": "route.body"}, "hint": "h"},
    ],
}


def ev(answers, org=None):
    return engine.evaluate(MINI, answers, org or {})


def by_key(r):
    return {c["key"]: c for c in r["checks"]}


def test_an_empty_draft_lists_what_is_missing_and_a_conditional_field_waits_for_its_condition():
    r = ev({})
    k = by_key(r)
    assert not k["route.goal"]["ok"] and k["route.goal"]["required"] and not k["people.owner"]["ok"]
    assert "route.body" not in k and "route.privacy_note" not in k and set(r["hidden"]) == {"route.body", "route.privacy_note"}
    assert [(s["key"], s["required_total"], s["required_ok"]) for s in r["steps"]] == [("route", 2, 0), ("people", 1, 0)]
    r = ev({"route": {"goal": "Certify", "cats": ["Security", "Privacy"]}})
    k = by_key(r)
    assert not k["route.body"]["ok"] and not k["route.privacy_note"]["ok"] and r["hidden"] == []
    assert not k["certonly"]["ok"] and k["sec"]["ok"]


def test_a_stale_answer_to_a_question_that_is_hidden_again_is_ignored():
    r = ev({"route": {"goal": "Align", "body": "left over from before", "cats": ["Security"]}})
    assert "route.body" not in by_key(r) and "certonly" not in by_key(r)


def test_date_order_and_different_people_pass_until_there_is_something_to_compare():
    k = by_key(ev({"route": {"start": "2026-01-01"}}))
    assert k["order"]["ok"] and k["span"]["ok"] and k["who"]["ok"]
    k = by_key(ev({"route": {"start": "2026-01-01", "end": "2026-01-01"}}))
    assert not k["order"]["ok"] and not k["span"]["ok"]
    k = by_key(ev({"route": {"start": "2026-01-01", "end": "2026-06-30"}}))
    assert k["order"]["ok"] and k["span"]["ok"]
    same = {"people": {"owner": {"user_id": 7}, "approver": {"user_id": 7}}}
    assert not by_key(ev(same))["who"]["ok"]
    assert by_key(ev({"people": {"owner": {"user_id": 7}, "approver": {"user_id": 8}}}))["who"]["ok"]


def test_a_table_rule_fails_on_the_row_that_breaks_it():
    bad = {"people": {"provs": [{"id": "r1", "method": "Carve-out", "report": "None"}]}}
    good = {"people": {"provs": [{"id": "r1", "method": "Carve-out", "report": "SOC 2"}, {"id": "r2", "method": "Inclusive", "report": "None"}]}}
    unfilled = {"people": {"provs": [{"id": "r1", "method": "Carve-out"}]}}
    assert not by_key(ev(bad))["carve"]["ok"] and by_key(ev(good))["carve"]["ok"] and not by_key(ev(unfilled))["carve"]["ok"]


def test_advice_never_blocks_and_the_organisation_profile_gates_nothing():
    done = {"route": {"goal": "Align", "cats": ["Security"]}, "people": {"owner": {"user_id": 7}}}
    r = ev(done)                                                        # no organisation profile at all
    assert r["ready"] and r["org_checks"] == []
    assert [c["key"] for c in r["checks"] if c["required"] and not c["ok"]] == []
    assert r["counts"]["advised_open"] >= 1 and r["counts"]["required_ok"] == r["counts"]["required_total"]


def test_the_profile_counts_a_list_as_answered_when_the_none_tick_is_set_and_asks_for_it_otherwise():
    base = {k: v for k, v in profile_values().items() if not k.startswith("regulators_obligations.regulators")}
    org = {}
    for key, v in base.items():
        g, k = key.split(".")
        org.setdefault(g, {})[k] = engine.normalise(catalog.profile_fields()[key], v)
    ev0 = engine.evaluate_org(org)
    assert not ev0["complete"] and {"group": "regulators_obligations", "field": "regulators", "label": "Regulators"} in ev0["missing"]
    org["regulators_obligations"]["no_regulator"] = True
    ev1 = engine.evaluate_org(org)
    assert ev1["groups"]["regulators_obligations"]["complete"] and ev1["complete"], ev1["missing"]


# ---------------------------------------------------------------- every framework of the catalog
ALL_SLUGS = sorted({fw["slug"] for fam in catalog.families().values() for fw in fam["frameworks"]})


@pytest.mark.parametrize("slug", ALL_SLUGS)
def test_every_framework_can_be_filled_and_evaluated(slug):
    """A filled draft normalises without an error and evaluates; an empty one has required checks (the sweep that finds an engine gap)."""
    res = catalog.resolve(slug)
    assert res["steps"], slug
    empty = engine.evaluate(res, {}, {})
    assert empty["counts"]["required_total"] > 0 and not empty["ready"]
    sampler = Sampler(org_rows={"entities": ["e1"], "sites": ["s1"], "third_parties": ["t1"], "data_types": ["d1"]})
    answers = answers_for(slug, sampler, levels=("required", "advised"))
    kn = engine.Known(assets={5}, departments=set(), users={7, 8, 9}, row_ids={"entities": {"e1"}, "sites": {"s1"}, "third_parties": {"t1"}, "data_types": {"d1"}})
    for st in res["steps"]:
        for f in st["fields"]:
            if st["key"] in answers and f["key"] in answers[st["key"]]:
                answers[st["key"]][f["key"]] = engine.normalise(f, answers[st["key"]][f["key"]], kn)
    r = engine.evaluate(res, answers, {})
    open_fields = [c["key"] for c in r["checks"] if c["kind"] == "field" and c["required"] and not c["ok"]]
    assert open_fields == [], open_fields
    assert all(isinstance(c["ok"], bool) for c in r["checks"])


# ---------------------------------------------------------------- gaps the independent review found
def test_a_minimum_of_zero_rows_asks_for_nothing_and_a_number_may_have_a_ceiling():
    assert engine.answered(fld("org_pick", of="sites", min_rows=0), []) and not engine.answered(fld("org_pick", of="sites"), [])
    score = fld("number", min=0, max=3)
    assert engine.normalise(score, "3") == 3
    with pytest.raises(F, match="3 or less"):
        engine.normalise(score, 4)


def test_a_rule_names_the_step_of_the_first_answer_it_reads_so_the_screen_can_open_it():
    k = by_key(ev({}))
    assert k["order"]["step"] == "route" and k["who"]["step"] == "people" and k["carve"]["step"] == "people"
    assert by_key(ev({"route": {"goal": "Certify"}}))["certonly"]["step"] == "route"
    org = engine.evaluate_org({})
    assert all("step" not in c for c in org["checks"])                 # the profile's own checks belong to no step


# ---------------------------------------------------------------- documents on an answer
def test_a_document_is_one_the_organisation_uploaded_and_an_answer_holds_at_most_three():
    f = fld("files", level="advised")
    kn = engine.Known(files={7: "soa.pdf", 8: "scope.docx", 9: "a.pdf", 10: "b.pdf"})
    assert engine.normalise(f, [{"id": 7, "name": "anything"}, 8], kn) == [{"id": 7, "name": "soa.pdf"}, {"id": 8, "name": "scope.docx"}]   # the name is the server's
    assert engine.normalise(f, [{"id": 7}, {"id": 7}], kn) == [{"id": 7, "name": "soa.pdf"}] and engine.normalise(f, [], kn) is None
    for bad in ("soa.pdf", [{"id": 99}], [{"name": "no id"}], [{"id": "x"}]):
        with pytest.raises(F):
            engine.normalise(f, bad, kn)
    with pytest.raises(F):
        engine.normalise(f, [7, 8, 9, 10], kn)
    assert engine.has_value(f, [{"id": 7, "name": "soa.pdf"}]) and not engine.has_value(f, [])
