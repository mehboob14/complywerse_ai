"""Framework version management for onboarding (docs/framework-version-management.md): the baseline an approval takes, the detection of a changed framework
version or catalog, what it makes stale (exactly), the notification to the program owner, the register and the review outcomes. In-memory SQLite and real
tokens, like the onboarding API tests, whose fixture and helpers are reused. A version change flags and asks: every test that changes something checks that the
answers, the approved snapshot, the assessments and the evidence stayed as they were."""
import copy
import json
import os
import re

os.environ.setdefault("SESSION_SECRET", "unit-test-secret")

from datetime import datetime  # noqa: E402

import grc.models as m  # noqa: E402
from grc.modules.framework_onboarding import catalog, engine, versioning  # noqa: E402
from test_framework_onboarding_api import ADMIN, APPROVER, EDITOR, ISO, O, OVERRIDER, PLAIN, fill_onboarding, fill_profile, ready_iso, w  # noqa: E402,F401  (w is the fixture)

NIST171, ECC = 35, 36
SOURCE_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


# ---------------------------------------------------------------- helpers
def edit_catalog(monkeypatch, change):
    """Serve a changed copy of the shipped catalog: ``change(data)`` edits {"profile", "common", "families"} in place."""
    data = copy.deepcopy(catalog._load())
    change(data)
    monkeypatch.setattr(catalog, "_load", lambda: data)
    return data


def field_of(data, step, key, family=None):
    steps = (data["families"][family] if family else data["common"])["steps"]
    return next(f for s in steps if s["key"] == step for f in s["fields"] if f["key"] == key)


def drop_field(data, step, key):
    for s in data["common"]["steps"]:
        if s["key"] == step:
            s["fields"] = [f for f in s["fields"] if f["key"] != key]


def approved_iso(db, as_, version="2022"):
    """An approved ISO 27001 onboarding (selected parts, one site picked, a product named), on a library row that holds ``version``."""
    db.get(m.UploadedFramework, ISO).version = version
    db.commit()
    http = as_(ADMIN)
    ob_id, _ = ready_iso(http)
    assert http.put(f"{O}/{ob_id}/answers", json={"step": "applicability", "values": {"products": "Core banking"}}).status_code == 200
    assert http.post(f"{O}/{ob_id}/submit").status_code == 200
    assert http.post(f"{O}/{ob_id}/approve", json={}).json()["state"] == "complete"
    return ob_id


def frozen(db, ob_id):
    """What a version change may never touch: the answers, the approved snapshot, the state."""
    db.expire_all()
    ob = db.get(m.FrameworkOnboarding, ob_id)
    return json.dumps([ob.answers, ob.snapshot, ob.state, ob.approved_by], sort_keys=True, default=str)


def refs(rows):
    return sorted(r["ref"] for r in rows)


def codes(row):
    return sorted(r["code"] for r in row["reasons"])


# ---------------------------------------------------------------- the version of a framework in the catalog
def test_the_shipped_catalog_is_clean_with_its_version_blocks():
    assert catalog.validate() == []
    nist = catalog.resolve("nist_800_171")["versions"]
    assert nist["answer"] == "basis.revision" and [v["key"] for v in nist["list"]] == ["rev2", "rev3"]
    assert nist["list"][0]["confidence"] == "verified" and nist["list"][1]["confidence"] == "unverified"       # only Rev 2 is what the library holds
    assert catalog.resolve("nca_ecc")["versions"]["list"][0]["confidence"] == "unverified"
    assert catalog.resolve("iso_27001")["versions"] is None                                                     # nothing invented where the catalog knows nothing


def test_the_library_versions_the_catalog_names_are_the_ones_the_library_holds():
    """``library`` strings of a versions block are checked against the library file itself: nothing is listed from memory."""
    reg = json.load(open(catalog.REGISTRY_PATH, encoding="utf-8"))["frameworks"]
    files = {f["slug"]: f["file"] for f in reg}
    seen = 0
    for fam in catalog.families().values():
        for e in fam["frameworks"]:
            for v in (e.get("versions") or {}).get("list", []):
                for held in v["library"]:
                    meta = json.load(open(os.path.join(os.path.dirname(catalog.REGISTRY_PATH), "..", "frameworks", files[e["slug"]]), encoding="utf-8"))["metadata"]
                    assert catalog._vnorm(held) == catalog._vnorm(meta["version"]), (e["slug"], held, meta["version"])
                    seen += 1
    assert seen >= 1


def test_version_key_prefers_the_answer_then_the_library_and_never_guesses():
    vs = catalog.resolve("nist_800_171")["versions"]
    assert catalog.version_key(vs, "Rev 3", "Rev 2") == "rev3"                  # the organisation's declared version wins
    assert catalog.version_key(vs, "Contract does not say", "Rev 2") == "rev2"   # no usable answer: the library's
    assert catalog.version_key(vs, None, "  rev 2 ") == "rev2"
    assert catalog.version_key(vs, None, "Rev 4") is None                        # a version the entry does not list is none
    assert catalog.version_key(None, "Rev 3", "Rev 2") is None
    assert catalog._vnorm("v4.0.1") == catalog._vnorm("4.0.1")


def test_questions_that_apply_to_a_version_are_asked_only_for_it():
    res = catalog.resolve("nist_800_171")
    base = {"basis": {"revision": "Rev 2"}}
    assert "basis.odp" in engine.evaluate(res, base, {}, library_version="Rev 2")["hidden"]
    ok = engine.evaluate(res, {"basis": {"revision": "Rev 3"}}, {}, library_version="Rev 2")
    assert "basis.odp" not in ok["hidden"] and ok["version_key"] == "rev3"
    # no answer: the library's version decides; the library holding Rev 3 (it does not today) would ask it
    assert "basis.odp" not in engine.evaluate(res, {}, {}, library_version="Rev 3")["hidden"]
    assert "basis.odp" in engine.evaluate(res, {}, {}, library_version="Rev 2")["hidden"]
    ecc = catalog.resolve("nca_ecc")
    assert "regime.ecc_move" not in engine.evaluate(ecc, {"regime": {"ecc_version": "ECC-1:2018"}}, {})["hidden"]
    assert "regime.ecc_move" in engine.evaluate(ecc, {"regime": {"ecc_version": "ECC-2:2024"}}, {})["hidden"]
    assert "regime.ecc_move" in engine.evaluate(ecc, {"regime": {"ecc_version": "Not sure"}}, {})["hidden"]      # an unknown version asks no version-specific question


def test_the_validator_refuses_a_version_condition_it_cannot_resolve(monkeypatch):
    def break_it(data):
        fam = data["families"]["control_frameworks"]
        next(e for e in fam["frameworks"] if e["slug"] == "nist_800_171")["versions"]["list"][1]["answer"] = "Rev 9"          # not an option of the answer
        field_of(data, "basis", "odp", "control_frameworks")["when"] = {"field": "fw.version", "eq": "rev9"}                    # not a key
        f = field_of(data, "basis", "cui", "control_frameworks")
        f["when"] = {"field": "fw.version", "eq": "rev2"}                                                                        # applies_to nist_800_171 only: that one is fine
        field_of(data, "basis", "ig", "control_frameworks")["when"] = {"field": "fw.version", "eq": "rev2"}                     # cis_controls has no versions block
    edit_catalog(monkeypatch, break_it)
    errs = "\n".join(catalog.validate())
    assert "answer 'Rev 9' is not an option" in errs and "fw.version value 'rev9' is not a version key" in errs
    assert re.search(r"ig: 'when' on fw.version needs applies_to frameworks that all have a versions block", errs)
    assert "basis.cui" not in errs


# ---------------------------------------------------------------- what a change makes stale, exactly (pure)
def sigs(monkeypatch=None, change=None, slug="iso_27001"):
    old = versioning.signature(catalog.resolve(slug))
    if change:
        edit_catalog(monkeypatch, change)
    return old, versioning.signature(catalog.resolve(slug))


ANSWERS = {"applicability": {"reach": "Selected parts only", "products": "Core banking", "entity": "Acme"}, "scope": {"locations": ["r1"], "defined": "Yes"},
           "objective": {"goal": "Certification", "required_by": "A customer contract"}}


def test_an_option_that_is_gone_makes_that_answer_and_its_decision_stale_and_nothing_else(monkeypatch):
    def change(d):
        field_of(d, "applicability", "reach")["options"] = ["Whole organisation", "Selected business units"]
    old, new = sigs(monkeypatch, change)
    out = versioning.stale(ANSWERS, old, new, {}, None, None)
    assert refs(out["answers"]) == ["applicability.reach"] and codes(out["answers"][0]) == ["option"]
    assert "Selected parts only is no longer one of the choices" in out["answers"][0]["reasons"][0]["text"]
    assert refs(out["decisions"]) == ["applicability.reach"]
    assert out["new_questions"] == []


def test_a_removed_question_makes_its_answer_stale_and_a_removed_applicability_answer_a_decision_too(monkeypatch):
    old, new = sigs(monkeypatch, lambda d: drop_field(d, "objective", "required_by"))
    out = versioning.stale(ANSWERS, old, new, {}, None, None)
    assert refs(out["answers"]) == ["objective.required_by"] and codes(out["answers"][0]) == ["removed"]
    assert out["decisions"] == []                                                # nothing else depends on it, and it is not an applicability answer
    old, new = sigs(monkeypatch, lambda d: drop_field(d, "applicability", "products"))
    out = versioning.stale(ANSWERS, old, new, {}, None, None)
    assert refs(out["answers"]) == refs(out["decisions"]) == ["applicability.products"]      # everything the Applicability step asks is an applicability decision


def test_a_changed_kind_of_answer_makes_it_stale(monkeypatch):
    def change(d):
        f = field_of(d, "applicability", "products")
        f["type"] = "number"
    old, new = sigs(monkeypatch, change)
    out = versioning.stale(ANSWERS, old, new, {}, None, None)
    assert refs(out["answers"]) == ["applicability.products"] and codes(out["answers"][0]) == ["type"]


def test_a_when_that_no_longer_holds_hides_the_answer_and_the_decision_it_hung_on_asks_differently(monkeypatch):
    def change(d):
        field_of(d, "scope", "locations")["when"] = {"field": "applicability.reach", "eq": "Whole organisation"}
    old, new = sigs(monkeypatch, change)
    out = versioning.stale(ANSWERS, old, new, {}, None, None)
    assert refs(out["answers"]) == ["scope.locations"] and codes(out["answers"][0]) == ["not_asked"]
    assert "asked only when" in out["answers"][0]["reasons"][0]["text"] and "Whole organisation" in out["answers"][0]["reasons"][0]["text"]
    [reach] = out["decisions"]
    assert reach["ref"] == "applicability.reach" and codes(reach) == ["asks_differently"]
    assert [(a["label"], a["now"]) for a in reach["affects"]] == [("Locations", "not asked")]


def test_an_unchanged_catalog_makes_nothing_stale_and_a_reordering_is_not_a_change():
    old = versioning.signature(catalog.resolve("iso_27001"))
    assert versioning.diff(old, old) == {k: [] for k in ("removed", "added", "type", "options", "when", "level", "shape", "gate")}
    out = versioning.stale(ANSWERS, old, old, {}, None, None)
    assert out == {"answers": [], "decisions": [], "new_questions": []}
    flipped = copy.deepcopy(old)
    opts = flipped["fields"]["applicability.reach"]["options"]
    flipped["fields"]["applicability.reach"]["options"] = list(reversed(opts))
    assert versioning.diff(old, flipped)["options"] == []


def test_new_questions_are_listed_required_first_and_only_when_asked_and_unanswered(monkeypatch):
    def change(d):
        d["common"]["steps"][1]["fields"].append({"key": "extra_adv", "label": "Extra advised", "type": "text", "level": "advised", "note": "n",
                                                  "source": {"ref": "r", "asked_by": "a", "confidence": "verified"}})
        d["common"]["steps"][1]["fields"].append({"key": "extra_req", "label": "Extra required", "type": "text", "level": "required", "note": "n",
                                                  "source": {"ref": "r", "asked_by": "a", "confidence": "verified"}})
    old, new = sigs(monkeypatch, change)
    out = versioning.stale({"applicability": {"extra_adv": "answered already"}}, old, new, {}, None, None)
    assert [(q["label"], q["level"]) for q in out["new_questions"]] == [("Extra required", "required")]
    assert versioning.stale({}, old, new, {}, None, None)["new_questions"][0]["why"] == "New question."


def test_the_version_in_use_is_a_decision_and_a_declared_version_the_library_left_behind_is_another(monkeypatch):
    res_old = catalog.resolve("nist_800_171")
    old = versioning.signature(res_old)
    answers = {"basis": {"revision": "Rev 2"}}
    declared = {"ref": "basis.revision", "label": "NIST revision", "answer": "Rev 2", "text": "The answer says Rev 2; the library now holds Rev 3."}
    out = versioning.stale(answers, old, old, {}, "rev2", "rev3", declared)
    assert [d["ref"] for d in out["decisions"]] == ["fw.version", "basis.revision"]
    assert out["decisions"][0]["reasons"][0]["text"] == "The version in use changed from Rev 2 to Rev 3."
    assert [a["label"] for a in out["decisions"][0]["affects"]] == ["Set parameters"]                          # the question that now appears... as asked
    assert out["decisions"][0]["affects"][0]["now"] == "asked"


# ---------------------------------------------------------------- the baseline
def test_an_approval_takes_a_baseline_and_a_draft_is_not_tracked(w):
    db, as_, http = w
    http = as_(ADMIN)
    prof = fill_profile(http)
    draft = http.post(O, json={"uploaded_framework_id": ISO}).json()
    assert draft["version"]["state"] == "not_tracked" and db.query(m.FrameworkVersionBaseline).count() == 0
    ob_id = approved_iso(db, as_)
    base = db.query(m.FrameworkVersionBaseline).one()
    assert (base.onboarding_id, base.source, base.library_version, base.framework_id) == (ob_id, "approval", "2022", ISO)
    assert base.signature["fields"]["applicability.reach"]["options"] == ["Whole organisation", "Selected parts only"] and base.controls == {}
    view = http.get(f"{O}/{ob_id}").json()
    assert view["version"]["state"] == "current" and view["version"]["tracking"]["source"] == "approval" and view["framework_version"] == "2022"
    assert prof                                                                                                  # (the profile was filled for the scope pick)


def test_a_get_never_writes(w):
    db, as_, http = w
    ob_id = approved_iso(db, as_)
    before = (db.query(m.FrameworkVersionBaseline).count(), db.query(m.FrameworkOnboardingEvent).count(), db.query(m.WorkflowNotification).count())
    http = as_(PLAIN)
    for path in (O, f"{O}/{ob_id}"):
        assert http.get(path).status_code == 200
    db.expire_all()
    assert before == (db.query(m.FrameworkVersionBaseline).count(), db.query(m.FrameworkOnboardingEvent).count(), db.query(m.WorkflowNotification).count())


# ---------------------------------------------------------------- a changed catalog, end to end
def test_a_changed_catalog_flags_exactly_what_is_stale_tells_the_owner_once_and_changes_nothing(w, monkeypatch):
    db, as_, http = w
    ob_id = approved_iso(db, as_)
    before = frozen(db, ob_id)

    def change(d):
        field_of(d, "applicability", "reach")["options"] = ["Whole organisation", "Selected business units"]
        drop_field(d, "applicability", "products")
    edit_catalog(monkeypatch, change)

    view = as_(PLAIN).get(f"{O}/{ob_id}").json()
    v = view["version"]
    assert v["state"] == "needs_review"
    assert refs(v["stale"]["answers"]) == ["applicability.products", "applicability.reach"]
    assert refs(v["stale"]["decisions"]) == ["applicability.products", "applicability.reach"]            # the Applicability step's answers are the decisions
    assert [r["code"] for r in v["reasons"]] == ["questions"]
    assert v["impact"]["journeys"] == [] and v["impact"]["kept"] == {"snapshots": 0, "evidence_files": 0}
    assert frozen(db, ob_id) == before                                         # the read changed nothing

    # the register says so, from the last check: none has run yet, so it still says current
    assert [r["review"]["state"] for r in as_(PLAIN).get(O).json()["frameworks"] if r["onboarding_id"] == ob_id] == ["current"]

    assert as_(PLAIN).post(f"{O}/version-check").status_code == 403            # a check writes and tells people: editing rights
    got = as_(EDITOR).post(f"{O}/version-check").json()
    assert got == {"checked": 1, "started": 0, "needs_review": 1, "notified": 1}
    owner = db.get(m.FrameworkOnboarding, ob_id).answers["ownership"]["owner"]["user_id"]
    [note] = db.query(m.WorkflowNotification).filter_by(user_id=owner).all()
    assert note.link == f"/frameworks/onboarding/{ob_id}" and note.notification_type == "warning"
    assert "needs a review" in note.subject and "questions this framework asks changed" in note.message and "were not changed" in note.message
    ev = [e for e in db.query(m.FrameworkOnboardingEvent).filter_by(onboarding_id=ob_id) if e.kind == "version_change"]
    assert len(ev) == 1 and ev[0].detail["told"] and not ev[0].detail["nobody_told"]

    again = as_(EDITOR).post(f"{O}/version-check").json()                      # the same change: nobody is told twice
    assert again["notified"] == 0 and db.query(m.WorkflowNotification).filter_by(user_id=owner).count() == 1
    assert [r["review"]["state"] for r in as_(PLAIN).get(O).json()["frameworks"] if r["onboarding_id"] == ob_id] == ["needs_review"]
    assert as_(PLAIN).get(O).json()["counts"]["needs_review"] == 1
    assert frozen(db, ob_id) == before


def test_a_change_that_only_adds_an_advised_question_does_not_flag_it(w, monkeypatch):
    db, as_, http = w
    ob_id = approved_iso(db, as_)

    def change(d):
        d["common"]["steps"][1]["fields"].append({"key": "extra_adv", "label": "Extra advised", "type": "text", "level": "advised", "note": "n",
                                                  "source": {"ref": "r", "asked_by": "a", "confidence": "verified"}})
    edit_catalog(monkeypatch, change)
    v = as_(PLAIN).get(f"{O}/{ob_id}").json()["version"]
    assert v["state"] == "current" and v["minor"] == ["1 new advised question."] and v["reasons"] == []
    assert as_(EDITOR).post(f"{O}/version-check").json()["notified"] == 0


def test_an_onboarding_approved_before_tracking_gets_a_starting_point_and_no_alarm(w, monkeypatch):
    db, as_, http = w
    ob_id = approved_iso(db, as_)
    db.query(m.FrameworkVersionBaseline).delete()
    db.commit()
    edit_catalog(monkeypatch, lambda d: drop_field(d, "applicability", "products"))                         # a change that happened before the first check
    assert as_(PLAIN).get(f"{O}/{ob_id}").json()["version"]["tracking"]["pending"] is True
    assert as_(EDITOR).post(f"{O}/version-check").json() == {"checked": 1, "started": 1, "needs_review": 0, "notified": 0}
    v = as_(PLAIN).get(f"{O}/{ob_id}").json()["version"]
    assert v["state"] == "current" and v["tracking"]["source"] == "first_check" and v["tracking"]["since"]
    assert db.query(m.WorkflowNotification).count() == 0
    assert [e.kind for e in db.query(m.FrameworkOnboardingEvent).filter_by(onboarding_id=ob_id)][-1] == "tracking_started"


def test_a_starting_point_is_how_things_stand_now_even_when_a_later_entry_already_exists(w):
    db, as_, http = w
    ob_id = approved_iso(db, as_)
    replace_iso(db)
    db.query(m.FrameworkVersionBaseline).delete()
    db.commit()
    assert as_(EDITOR).post(f"{O}/version-check").json() == {"checked": 1, "started": 1, "needs_review": 0, "notified": 0}
    base = db.query(m.FrameworkVersionBaseline).one()
    assert (base.source, base.framework_id, base.library_version) == ("first_check", 41, "2022 (amended)")
    assert as_(PLAIN).get(f"{O}/{ob_id}").json()["version"]["state"] == "current"


def test_with_no_platform_owner_the_people_who_approved_it_are_told(w, monkeypatch):
    db, as_, http = w
    ob_id = approved_iso(db, as_)
    ob = db.get(m.FrameworkOnboarding, ob_id)
    answers = copy.deepcopy(ob.answers)
    answers["ownership"] = {"owner": {"name": "An outside consultant", "email": "c@x.test"}}                  # nobody on the platform is named
    ob.answers = answers
    db.commit()
    edit_catalog(monkeypatch, lambda d: drop_field(d, "applicability", "products"))
    assert as_(EDITOR).post(f"{O}/version-check").json()["notified"] == 1
    told = {n.user_id for n in db.query(m.WorkflowNotification)}
    assert told == {ADMIN}                                                      # the approver (the admin here); an outside person cannot be told in the platform


# ---------------------------------------------------------------- the review
def stale_iso(w, monkeypatch):
    db, as_, http = w
    ob_id = approved_iso(db, as_)
    edit_catalog(monkeypatch, lambda d: drop_field(d, "applicability", "products"))
    as_(EDITOR).post(f"{O}/version-check")
    return db, as_, ob_id


def test_confirming_moves_the_baseline_and_records_why_and_touches_nothing_else(w, monkeypatch):
    db, as_, ob_id = stale_iso(w, monkeypatch)
    before = frozen(db, ob_id)
    r = f"{O}/{ob_id}/version-review"
    assert as_(EDITOR).post(r, json={"outcome": "confirmed", "note": "It still holds for us."}).status_code == 403          # confirming is an approval
    assert as_(APPROVER).post(r, json={"outcome": "confirmed", "note": "short"}).status_code == 422
    assert as_(APPROVER).post(r, json={"outcome": "nonsense", "note": "A long enough note."}).status_code == 422
    done = as_(APPROVER).post(r, json={"outcome": "confirmed", "note": "The product list is gone; our answer still stands."})
    assert done.status_code == 200 and done.json()["version"]["state"] == "current" and done.json()["version"]["tracking"]["source"] == "review"
    assert frozen(db, ob_id) == before
    ev = [e for e in db.query(m.FrameworkOnboardingEvent).filter_by(onboarding_id=ob_id) if e.kind == "version_reviewed"]
    assert len(ev) == 1 and ev[0].actor_id == APPROVER and ev[0].detail["outcome"] == "confirmed" and "still stands" in ev[0].detail["note"]
    base = db.query(m.FrameworkVersionBaseline).one()
    assert [h["source"] for h in base.history] == ["approval"] and base.notified_change_id is None
    assert as_(APPROVER).post(r, json={"outcome": "confirmed", "note": "Nothing left to confirm."}).status_code == 409   # nothing to review any more


def test_reopening_to_change_keeps_the_flag_until_it_is_approved_again(w, monkeypatch):
    db, as_, ob_id = stale_iso(w, monkeypatch)
    r = f"{O}/{ob_id}/version-review"
    snapshot = db.get(m.FrameworkOnboarding, ob_id).snapshot
    assert as_(APPROVER).post(r, json={"outcome": "changes_needed", "note": "Product list moved: rework."}).status_code == 403   # the reopen right
    out = as_(OVERRIDER).post(r, json={"outcome": "changes_needed", "note": "Product list moved: rework."}).json()
    assert out["state"] == "draft" and out["version"]["state"] == "needs_review" and out["version"]["review_state"] == "changes_needed"
    assert refs(out["version"]["stale"]["answers"]) == ["applicability.products"]
    kinds = [e.kind for e in db.query(m.FrameworkOnboardingEvent).filter_by(onboarding_id=ob_id)]
    assert kinds[-2:] == ["version_reviewed", "reopened"]
    assert db.get(m.FrameworkOnboarding, ob_id).snapshot == snapshot                       # the old approval stays until the next one replaces it
    # editing the stale answer: the list shrinks (the question is gone, so the answer cannot be edited away: only a new approval clears it)
    http = as_(ADMIN)
    assert http.post(f"{O}/{ob_id}/submit").json()["state"] == "ready"
    done = http.post(f"{O}/{ob_id}/approve", json={}).json()
    assert done["state"] == "complete" and done["version"]["state"] == "current" and done["version"]["tracking"]["source"] == "approval"
    assert db.query(m.FrameworkVersionBaseline).one().history[-1]["source"] == "approval"


# ---------------------------------------------------------------- the library itself: a replaced row, changed controls, a successor onboarding
def add_controls(db, framework_id, items):
    for cid, title, text in items:
        db.add(m.ParsedFrameworkControl(uploaded_framework_id=framework_id, control_id=cid, original_reference=f"A.{cid}", title=title, full_text=text))
    db.commit()


def replace_iso(db, version="2022 (amended)", controls=None):
    """What re-seeding the library does: the old row is deactivated and a new row added (journeys and the onboarding stay on the old one)."""
    db.get(m.UploadedFramework, ISO).is_active = False
    db.add(m.UploadedFramework(id=41, tenant_id=1, name="ISO/IEC 27001:2022", slug="iso_27001", version=version, file_name="f.pdf", file_path="/f.pdf", file_type="pdf",
                               upload_status="parsed", is_active=True, is_shared=False, uploaded_by=ADMIN, created_at=datetime(2026, 6, 1)))
    db.commit()
    add_controls(db, 41, controls or [])


def test_a_replaced_library_row_is_a_successor_with_named_controls_and_the_old_onboarding_stays_listed(w):
    db, as_, http = w
    db.get(m.UploadedFramework, ISO).version = "2022"
    db.commit()
    add_controls(db, ISO, [("C1", "Policies", "Have policies."), ("C2", "Roles", "Define roles."), ("C3", "Backups", "Back up data.")])
    ob_id = approved_iso(db, as_)
    assert len(db.query(m.FrameworkVersionBaseline).one().controls) == 3
    before = frozen(db, ob_id)
    replace_iso(db, controls=[("C1", "Policies", "Have policies."), ("C2", "Roles", "Define and document roles."), ("C4", "Logging", "Log events.")])
    v = as_(PLAIN).get(f"{O}/{ob_id}").json()["version"]
    assert v["state"] == "needs_review"
    assert [r["code"] for r in v["reasons"]] == ["replaced", "library_version", "controls"]
    assert v["reasons"][0]["text"] == "The library replaced this entry with a newer one (version 2022 (amended))."
    assert v["successor"]["framework_id"] == 41 and v["now"]["version"] == "2022 (amended)"
    assert (v["controls"]["added"], v["controls"]["removed"], v["controls"]["changed"]) == (1, 1, 1)
    assert [c["title"] for c in v["controls"]["sample"]["added"]] == ["Logging"] and [c["title"] for c in v["controls"]["sample"]["removed"]] == ["Backups"]
    assert [c["title"] for c in v["controls"]["sample"]["changed"]] == ["Roles"]
    assert "id" not in json.dumps(v["controls"]["sample"]).replace('"title"', "")                                # names and clauses, never ids
    # the replaced row used to drop out of the register: it stays, with the new row beside it
    rows = {r["uploaded_framework_id"]: r for r in as_(PLAIN).get(O).json()["frameworks"]}
    assert rows[ISO]["onboarding_id"] == ob_id and rows[ISO]["state"] == "complete" and rows[41]["state"] == "not_started"
    assert frozen(db, ob_id) == before


def test_the_impact_names_the_programs_and_the_work_that_sits_on_changed_controls(w):
    db, as_, http = w
    db.get(m.UploadedFramework, ISO).version = "2022"
    db.commit()
    add_controls(db, ISO, [("C1", "Policies", "Have policies."), ("C2", "Roles", "Define roles.")])
    ob_id = approved_iso(db, as_)
    j = m.CertificationJourney(tenant_id=1, uploaded_framework_id=ISO, name="ISO 27001 programme", status="in_progress")
    db.add(j)
    db.flush()
    c1, c2 = (db.query(m.ParsedFrameworkControl).filter_by(uploaded_framework_id=ISO, control_id=c).one() for c in ("C1", "C2"))
    i1 = m.ControlImplementation(journey_id=j.id, parsed_control_id=c1.id, status="compliant")
    i2 = m.ControlImplementation(journey_id=j.id, parsed_control_id=c2.id, status="in_progress")
    db.add_all([i1, i2])
    db.flush()
    db.add_all([m.ImplementationEvidence(implementation_id=i2.id, file_name="roles.pdf", uploaded_by=ADMIN), m.ImplementationEvidence(implementation_id=i1.id, file_name="pol.pdf", uploaded_by=ADMIN)])
    db.add(m.ComplianceSnapshot(journey_id=j.id, tenant_id=1, year=2026, label="2026"))
    db.commit()
    replace_iso(db, controls=[("C1", "Policies", "Have policies."), ("C2", "Roles", "Define and document roles.")])
    rows_before = [db.query(t).count() for t in (m.ControlImplementation, m.ImplementationEvidence, m.ComplianceSnapshot)]
    imp = as_(PLAIN).get(f"{O}/{ob_id}").json()["version"]["impact"]
    assert imp["journeys"] == [{"id": j.id, "name": "ISO 27001 programme", "status": "in_progress", "controls": 2, "affected": 1, "by_status": {"in_progress": 1}, "evidence_files": 1}]
    assert imp["kept"] == {"snapshots": 1, "evidence_files": 2}
    assert [db.query(t).count() for t in (m.ControlImplementation, m.ImplementationEvidence, m.ComplianceSnapshot)] == rows_before
    db.expire_all()
    assert db.query(m.ControlImplementation).filter_by(id=i1.id).one().status == "compliant"                      # an assessment is never rewritten


def test_starting_for_the_new_version_carries_what_fits_and_lists_what_does_not(w):
    db, as_, http = w
    ob_id = approved_iso(db, as_)
    before = frozen(db, ob_id)
    replace_iso(db)
    r = f"{O}/{ob_id}/version-review"
    assert as_(PLAIN).post(r, json={"outcome": "start_new_version", "note": "Moving to the amended edition."}).status_code == 403
    assert as_(EDITOR).post(r, json={"outcome": "start_new_version", "note": "short"}).status_code == 422
    out = as_(EDITOR).post(r, json={"outcome": "start_new_version", "note": "Moving to the amended edition."}).json()
    new_id = out["started_onboarding_id"]
    assert out["version"]["state"] == "superseded" and out["version"]["successor"]["onboarding_id"] == new_id and out["state"] == "complete"
    new = db.get(m.FrameworkOnboarding, new_id)
    assert new.uploaded_framework_id == 41 and new.state == "draft"
    old = db.get(m.FrameworkOnboarding, ob_id)
    assert new.answers["applicability"]["reach"] == old.answers["applicability"]["reach"] and new.answers["applicability"]["products"] == "Core banking"
    assert new.answers["ownership"]["owner"] == old.answers["ownership"]["owner"]
    assert frozen(db, ob_id) == before                                          # the old onboarding is exactly as approved
    kinds = lambda i: [e.kind for e in db.query(m.FrameworkOnboardingEvent).filter_by(onboarding_id=i)]               # noqa: E731
    assert kinds(ob_id)[-1] == "version_reviewed" and kinds(new_id)[-1] == "version_migrated"
    assert as_(EDITOR).post(r, json={"outcome": "start_new_version", "note": "Again, to be sure."}).status_code == 409
    assert as_(APPROVER).post(r, json={"outcome": "confirmed", "note": "Nothing more to confirm."}).status_code == 409
    row = next(x for x in as_(PLAIN).get(O).json()["frameworks"] if x["onboarding_id"] == ob_id)
    assert row["review"]["state"] == "superseded" and row["review"]["successor_onboarding_id"] == new_id


def test_carry_forward_keeps_only_an_answer_that_still_fits_the_new_questions(monkeypatch):
    kn = engine.Known()
    old = catalog.resolve("iso_27001")
    answers = {"applicability": {"reach": "Selected parts only", "products": "Core banking"}, "objective": {"goal": "Certification"}}

    def change(d):
        field_of(d, "applicability", "reach")["options"] = ["Whole organisation", "Selected business units"]
        drop_field(d, "applicability", "products")
    edit_catalog(monkeypatch, change)
    carried, dropped = versioning.carry_forward(answers, old, catalog.resolve("iso_27001"), kn)
    assert carried == {"objective": {"goal": "Certification"}}
    assert {d["label"] for d in dropped} == {"Applies to", "Products"} or len(dropped) == 2
    assert any("not asked for the new version" in d["why"] for d in dropped)


# ---------------------------------------------------------------- a version-specific onboarding end to end
def test_a_library_that_moves_to_another_version_asks_the_version_questions_and_flags_a_declared_one(w):
    db, as_, http = w
    db.add(m.UploadedFramework(id=NIST171, tenant_id=1, name="NIST SP 800-171 Rev 2 (Protecting CUI)", slug="nist_800_171", version="Rev 2", file_name="f.pdf",
                               file_path="/f.pdf", file_type="pdf", upload_status="parsed", is_active=True, uploaded_by=ADMIN, created_at=datetime(2026, 1, 1)))
    db.commit()
    http = as_(ADMIN)
    prof = fill_profile(http)
    ob = http.post(O, json={"uploaded_framework_id": NIST171}).json()
    fill_onboarding(http, ob["id"], "nist_800_171", prof, {"basis": {"revision": "Rev 2"}})
    assert http.post(f"{O}/{ob['id']}/submit").status_code == 200
    assert http.post(f"{O}/{ob['id']}/approve", json={}).json()["state"] == "complete"
    base = db.query(m.FrameworkVersionBaseline).one()
    assert (base.library_version, base.library_key, base.version_key, base.declared_answer) == ("Rev 2", "rev2", "rev2", "Rev 2")
    assert http.get(f"{O}/{ob['id']}").json()["version"]["state"] == "current"
    db.get(m.UploadedFramework, NIST171).version = "Rev 3"                                                          # the library moves to Rev 3 (edited in place)
    db.commit()
    v = http.get(f"{O}/{ob['id']}").json()["version"]
    assert v["state"] == "needs_review" and [r["code"] for r in v["reasons"]] == ["library_version"]
    assert [d["ref"] for d in v["stale"]["decisions"]] == ["basis.revision"]                                        # the declared Rev 2 is now a decision to take
    assert v["stale"]["decisions"][0]["reasons"][0]["text"] == "The answer says Rev 2; the library now holds Rev 3."
    assert v["stale"]["answers"] == [] and v["counts"]["answers"] == 0
    # the organisation answered Rev 2, so the version in use stays Rev 2 and no Rev 3 question appears yet
    assert "basis.odp" not in [q["ref"] for q in v["stale"]["new_questions"]]
    ans = copy.deepcopy(db.get(m.FrameworkOnboarding, ob["id"]).answers)
    ans["basis"]["revision"] = "Contract does not say"                                                              # with no declared version the library's decides
    db.get(m.FrameworkOnboarding, ob["id"]).answers = ans
    db.commit()
    v2 = http.get(f"{O}/{ob['id']}").json()["version"]
    assert "version_in_use" in [r["code"] for r in v2["reasons"]]
    assert "basis.odp" in [q["ref"] for q in v2["stale"]["new_questions"]]
    assert next(q for q in v2["stale"]["new_questions"] if q["ref"] == "basis.odp")["why"].startswith("Now asked: it applies when the framework version is")


# ---------------------------------------------------------------- what is not ours to break
def test_every_word_the_version_tables_store_fits_its_column():
    cols = m.FrameworkVersionBaseline.__table__.c
    assert all(len(s) <= cols.source.type.length for s in ("approval", "first_check", "review"))
    assert all(len(s) <= cols.review_state.type.length for s in ("changes_needed", "migrated"))
    assert all(len(k) <= m.FrameworkOnboardingEvent.__table__.c.kind.type.length for k in ("version_change", "version_reviewed", "version_migrated", "tracking_started"))
    assert all(len(k["key"]) <= cols.version_key.type.length for fam in catalog.families().values() for e in fam["frameworks"] for k in (e.get("versions") or {}).get("list", []))
    assert len(versioning.signature(catalog.resolve("iso_27001"))["fields"]) > 20


def test_the_library_flow_and_catalog_versions_agree_except_the_one_recorded():
    """Flow versions are display text on the journey; the library row is the authority. After dropping the wording ("v", "EU", "Jan"), every digit group a flow shows
    must be in the library's version. NIST CSF is the one recorded contradiction (library 2.0, flow 1.1): fix the flow's phases with its number, not the number alone."""
    flows_ts = open(os.path.join(SOURCE_ROOT, "..", "grc-frontend", "src", "app", "(dashboard)", "frameworks", "[id]", "_data", "frameworkFlows.ts"), encoding="utf-8").read()
    flow_version = {mm.group(1): mm.group(2) for mm in re.finditer(r'\n    "id": "([^"]+)",\n    "name": "[^"]*",\n    "version": "([^"]+)"', flows_ts)}
    registry = {f["slug"]: f["file"] for f in json.load(open(catalog.REGISTRY_PATH, encoding="utf-8"))["frameworks"]}
    frameworks = os.path.join(os.path.dirname(catalog.REGISTRY_PATH), "..", "frameworks")
    digits = lambda s: re.findall(r"\d+", s)                                                                         # noqa: E731
    off = set()
    checked = 0
    for fam in catalog.families().values():
        for e in fam["frameworks"]:
            fid, path = e.get("flow_id"), os.path.join(frameworks, registry.get(e["slug"], "-"))
            if not fid or fid not in flow_version or not os.path.isfile(path):
                continue
            checked += 1
            lib = json.load(open(path, encoding="utf-8"))["metadata"]["version"]
            if not set(digits(flow_version[fid])) <= set(digits(lib)):
                off.add(e["slug"])
    assert checked >= 30
    assert off == {"nist_csf"}, off
