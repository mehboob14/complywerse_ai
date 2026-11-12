"""The hand-off from an approved onboarding into a compliance programme (docs/framework-onboarding-programme-handoff.md).

Over HTTP on in-memory SQLite, like test_framework_onboarding_api.py (its world and helpers are reused). What these pin:
it starts only from an approved or underway onboarding; it starts and proposes and never marks anything assessed, applicable or compliant; it carries the scope,
the people and the "What exists" items; a second run changes nothing and records nothing; an existing journey is linked, never edited."""
import os

os.environ.setdefault("SESSION_SECRET", "unit-test-secret")

import grc.models as m  # noqa: E402
from grc.modules.framework_onboarding import programme  # noqa: E402
from test_framework_onboarding_api import (ADMIN, APPROVER, EDITOR, ISO, O, OVERRIDER, PLAIN, SOC2, fill_onboarding, fill_profile, rows_of,  # noqa: E402,F401
                                           selected_parts, w)

OWNER, APPROVES, THIRD = 7, 8, 9


def tallies(db):
    """Every table the hand-off could touch, counted: what must not move when it is run again."""
    return tuple(db.query(t).count() for t in (m.FrameworkProgramme, m.CertificationJourney, m.ControlImplementation, m.ImplementationEvidence, m.Evidence,
                                                m.FrameworkOnboardingEvent))


def kinds(http, ob_id):
    return [e["kind"] for e in http.get(f"{O}/{ob_id}").json()["events"]]


def world(db):
    """Three controls to load, two departments, and the documents a person kept in Evidence."""
    for i in (1, 2, 3):
        db.add(m.ParsedFrameworkControl(uploaded_framework_id=ISO, control_id=f"A.5.{i}", title=f"Control {i}"))
    db.add(m.GRCDepartment(id=1, tenant_id=1, name="Finance", code="FIN"))
    db.add(m.GRCDepartment(id=2, tenant_id=1, name="Information Technology", code="IT"))
    db.add(m.Evidence(id=71, tenant_id=1, name="Certificate.pdf", file_name="Certificate.pdf", source_system="Framework onboarding", status="draft"))
    db.commit()


def approved_iso(as_, db):
    """An ISO 27001 onboarding filled with a chosen scope, named people and two items of "What exists", approved by someone who may."""
    world(db)
    http = as_(ADMIN)
    prof = fill_profile(http)
    ob_id = http.post(O, json={"uploaded_framework_id": ISO}).json()["id"]
    over = selected_parts(prof)
    over["objective"] = {"target_date": "2027-03-31"}
    over["scope"].update({"departments": [1], "systems": [5], "hosting": ["AWS"], "statement": "Head office and the core banking platform.",
                          "exclusions": [{"item": "Legacy kiosks", "reason": "Retired in the second quarter"}]})
    over["ownership"] = {"owner": {"user_id": OWNER}, "coordinator": {"name": "Zed Auditor", "email": "zed@audit.test"}, "approver": {"user_id": APPROVES},
                         "teams": [1, 2], "assessor": "External assessor"}
    over["existing"] = {"status": "Yes"}
    fill_onboarding(http, ob_id, "iso_27001", prof, over)
    editor = as_(EDITOR)
    cert = editor.post(f"{O}/{ob_id}/existing", json={"assessment_type": "External certification", "assessor_or_issuer": "BSI", "assessment_date": "2026-03-01",
                                                      "valid_until": "2027-03-01", "evidence_ids": [71]})
    assert cert.status_code == 201, cert.text
    editor.post(f"{O}/{ob_id}/existing", json={"assessment_type": "Internal audit results"})
    assert as_(EDITOR).post(f"{O}/{ob_id}/submit").status_code == 200
    assert as_(APPROVER).post(f"{O}/{ob_id}/approve", json={}).status_code == 200
    return ob_id


# ---------------------------------------------------------------- when it may start
def test_it_starts_only_from_an_approved_or_underway_onboarding_and_reading_it_writes_nothing(w):
    db, as_, http = w
    http = as_(ADMIN)
    ob_id = http.post(O, json={"uploaded_framework_id": ISO}).json()["id"]
    before = tallies(db)
    r = http.post(f"{O}/{ob_id}/programme")
    assert r.status_code == 409 and r.json()["detail"]["message"] == programme.NOT_YET
    got = http.get(f"{O}/{ob_id}/programme").json()
    assert got["started"] is False and got["can_start"] is False and got["journey"] is None and got["candidates"] == []
    assert tallies(db) == before
    assert as_(PLAIN).get(f"{O}/{ob_id}/programme").status_code == 200                    # a sign-in reads
    assert as_(PLAIN).post(f"{O}/{ob_id}/programme").status_code == 403                    # the edit right starts
    assert as_(PLAIN).post(f"{O}/{ob_id}/programme/owners").status_code == 403
    assert as_(EDITOR).post(f"{O}/{ob_id}/programme/owners").status_code == 409            # nothing to apply before it started


# ---------------------------------------------------------------- the hand-off
def test_the_hand_off_starts_the_journey_carries_the_choices_and_marks_nothing(w):
    db, as_, http = w
    ob_id = approved_iso(as_, db)
    editor = as_(EDITOR)
    ev_before = db.get(m.Evidence, 71).status
    r = editor.post(f"{O}/{ob_id}/programme")
    assert r.status_code == 200, r.text
    p = r.json()
    assert p["started"] and p["changed"] is True

    # STARTED: the journey, its three controls loaded and nothing assessed; the target date of a journey made here
    j = db.query(m.CertificationJourney).one()
    assert p["journey"] == {"id": j.id, "name": j.name, "status": "in_progress", "target_date": "2027-03-31", "made_here": True}
    assert p["controls"] == {"total": 3, "not_started": 3, "begun": 0, "without_owner": 3}
    assert {c.status for c in db.query(m.ControlImplementation)} == {"not_started"} and all(c.is_applicable is not False for c in db.query(m.ControlImplementation))
    assert db.query(m.ImplementationEvidence).count() == 0 and db.get(m.Evidence, 71).status == ev_before          # nothing was attached or accepted

    # STARTED: the scope as written out (names, not ids), exclusions with their reasons
    s = p["scope"]
    assert s["reach"] == "Selected parts only" and s["whole_organisation"] is False and s["target_date"] == "2027-03-31"
    assert s["departments"] == [{"id": 1, "name": "Finance"}] and [x["name"] for x in s["systems"]] == ["Core banking"] and s["hosting"] == ["AWS"]
    assert len(s["locations"]) == 1 and s["locations"][0]["name"]
    assert s["exclusions"] == [{"item": "Legacy kiosks", "reason": "Retired in the second quarter"}] and s["statement"].startswith("Head office")

    # PROPOSED: the people (a person without an account is named, not assigned), the teams; nobody was assigned
    people = {x["role"]: x for x in p["proposals"]["people"]}
    assert people["Programme owner"] == {"role": "Programme owner", "user_id": OWNER, "name": "Sana", "account": True}
    assert people["Coordinator"]["account"] is False and people["Coordinator"]["name"] == "Zed Auditor" and people["Coordinator"]["user_id"] is None
    assert people["Approver"]["user_id"] == APPROVES
    assert [t["name"] for t in p["proposals"]["teams"]] == ["Finance", "Information Technology"] and p["proposals"]["assessor"] == "External assessor"
    assert p["proposals"]["control_owner"] == OWNER and p["owner"] == {"name": "Sana", "can_apply": True, "without_owner": 3, "why_not": None}
    assert not any(c.assigned_user_ids or c.assigned_to_user_id for c in db.query(m.ControlImplementation))

    # OFFERED: both items as claims with their source, dates and how far anyone has checked them
    c = {x["assessment_type"]: x for x in p["candidates"]}
    cert = c["External certification"]
    assert (cert["source"], cert["verification_status"], cert["valid_until"], cert["expired"], cert["has_document"]) == ("Declared in onboarding", "evidence_received", "2027-03-01", False, True)
    assert cert["files"] == [{"id": 71, "name": "Certificate.pdf"}] and cert["assessor_or_issuer"] == "BSI"
    assert (c["Internal audit results"]["verification_status"], c["Internal audit results"]["has_document"]) == ("declared", False)

    # recorded on the onboarding's history
    assert kinds(http, ob_id).count("programme_started") == 1 and kinds(http, ob_id).count("journey_started") == 1


def test_a_second_run_changes_nothing_and_a_new_fact_is_recorded_once(w):
    db, as_, http = w
    ob_id = approved_iso(as_, db)
    editor = as_(EDITOR)
    editor.post(f"{O}/{ob_id}/programme")
    after_first = tallies(db)
    again = editor.post(f"{O}/{ob_id}/programme")
    assert again.status_code == 200 and again.json()["changed"] is False
    assert tallies(db) == after_first                                                        # no row, no event, no second journey
    # a person who may approve verifies the certificate: the next run offers it as verified, still only a claim
    as_(APPROVER).post(f"{O}/{ob_id}/existing/{[x for x in editor.get(f'{O}/{ob_id}').json()['existing']['records'] if x['files']][0]['id']}/verify", json={"status": "verified"})
    n_events = db.query(m.FrameworkOnboardingEvent).count()
    third = as_(EDITOR).post(f"{O}/{ob_id}/programme").json()
    assert third["changed"] is True and db.query(m.FrameworkOnboardingEvent).count() == n_events + 1
    updated = [e for e in as_(EDITOR).get(f"{O}/{ob_id}").json()["events"] if e["kind"] == "programme_updated"]
    assert len(updated) == 1 and updated[0]["detail"] == {"changed": ["evidence"]}
    assert {x["verification_status"] for x in third["candidates"]} == {"verified", "declared"}
    assert {c.status for c in db.query(m.ControlImplementation)} == {"not_started"}          # a verified certificate is not a compliant control
    assert as_(EDITOR).post(f"{O}/{ob_id}/programme").json()["changed"] is False


def test_the_programme_owner_is_applied_only_to_controls_nobody_owns_and_only_when_asked(w):
    db, as_, http = w
    ob_id = approved_iso(as_, db)
    editor = as_(EDITOR)
    editor.post(f"{O}/{ob_id}/programme")
    first, second, third = db.query(m.ControlImplementation).order_by(m.ControlImplementation.id).all()
    first.assigned_user_ids, first.assigned_to_user_id = [THIRD], THIRD                      # already owned: kept
    third.is_applicable = False                                                                # out of scope by someone's decision: left alone
    db.commit()
    done = editor.post(f"{O}/{ob_id}/programme/owners")
    assert done.status_code == 200 and done.json()["changed"] == 1, done.text
    for c in db.query(m.ControlImplementation):
        db.refresh(c)
    assert (first.assigned_user_ids, second.assigned_user_ids, second.assigned_to_user_id, third.assigned_user_ids) == ([THIRD], [OWNER], OWNER, [])
    assert [e["detail"] for e in editor.get(f"{O}/{ob_id}").json()["events"] if e["kind"] == "owners_applied"] == [{"controls": 1, "owner": "Sana"}]
    n = tallies(db)
    assert editor.post(f"{O}/{ob_id}/programme/owners").json()["changed"] == 0 and tallies(db) == n
    assert {c.status for c in db.query(m.ControlImplementation)} == {"not_started"}


def test_a_programme_owner_without_an_account_cannot_be_applied(w):
    db, as_, http = w
    world(db)
    http = as_(ADMIN)
    ob_id = http.post(O, json={"uploaded_framework_id": SOC2}).json()["id"]
    assert as_(OVERRIDER).post(f"{O}/{ob_id}/underway", json={"kind": "Other", "reason": "The attestation window is already open."}).status_code == 200
    assert as_(ADMIN).put(f"{O}/{ob_id}/answers", json={"step": "ownership", "values": {"owner": {"name": "An outside consultant"}}}).status_code == 200
    got = as_(EDITOR).post(f"{O}/{ob_id}/programme").json()
    assert got["proposals"]["control_owner"] is None and got["owner"]["can_apply"] is False and "no account" in got["owner"]["why_not"]
    r = as_(EDITOR).post(f"{O}/{ob_id}/programme/owners")
    assert r.status_code == 422


# ---------------------------------------------------------------- what is already there
def test_an_existing_journey_is_linked_whatever_its_status_and_never_edited(w):
    db, as_, http = w
    world(db)
    http = as_(ADMIN)
    ob_id = http.post(O, json={"uploaded_framework_id": ISO}).json()["id"]
    assert as_(OVERRIDER).post(f"{O}/{ob_id}/underway", json={"kind": "Running before onboarding existed", "reason": "The journey has run since last spring."}).status_code == 200
    j = http.post("/certifications", json={"framework_id": ISO, "name": "Running since spring"}).json()
    first = db.query(m.ControlImplementation).order_by(m.ControlImplementation.id).first()
    first.status, first.assigned_user_ids, first.assigned_to_user_id = "implemented", [THIRD], THIRD
    jr = db.get(m.CertificationJourney, j["id"])
    jr.status = "completed"                                                                    # not in progress: still the journey of this framework
    db.commit()
    before = tallies(db)
    p = as_(EDITOR).post(f"{O}/{ob_id}/programme").json()
    assert p["journey"]["id"] == j["id"] and p["journey"]["made_here"] is False and p["journey"]["status"] == "completed" and p["journey"]["name"] == "Running since spring"
    assert db.query(m.CertificationJourney).count() == 1 and db.query(m.ControlImplementation).count() == before[2]
    db.refresh(first)
    db.refresh(jr)
    assert (first.status, first.assigned_user_ids, jr.target_date) == ("implemented", [THIRD], None)       # what people did is untouched
    assert p["controls"]["begun"] == 1 and p["scope"]["reach"] is None and p["scope"]["whole_organisation"] is False        # nothing answered: nothing invented
    assert kinds(http, ob_id).count("journey_started") == 1 and kinds(http, ob_id).count("programme_started") == 1             # linked, not started again


def test_a_deleted_journey_is_made_again_and_the_change_is_recorded(w):
    db, as_, http = w
    ob_id = approved_iso(as_, db)
    editor = as_(EDITOR)
    editor.post(f"{O}/{ob_id}/programme")
    jr = db.query(m.CertificationJourney).one()
    gone = jr.id
    db.delete(jr)
    db.commit()
    seen = editor.get(f"{O}/{ob_id}/programme").json()
    assert seen["started"] and seen["journey"] is None and "deleted" in seen["note"]
    again = editor.post(f"{O}/{ob_id}/programme").json()
    assert again["changed"] is True and again["journey"]["made_here"] is True and again["controls"]["total"] == 3         # (SQLite may hand the new journey the old number)
    assert gone and db.query(m.CertificationJourney).count() == 1
    assert [e["detail"] for e in editor.get(f"{O}/{ob_id}").json()["events"] if e["kind"] == "programme_updated"] == [{"changed": ["journey"]}]
    assert db.query(m.FrameworkProgramme).count() == 1


def test_the_words_the_hand_off_stores_fit_their_columns():
    ev = m.FrameworkOnboardingEvent.__table__.c.kind.type.length
    assert max(len(k) for k in ("programme_started", "programme_updated", "owners_applied")) <= ev
