"""Framework onboarding over HTTP: the organisation profile, one onboarding per framework from draft to approved, the gate on both ways a
journey is made, "already underway", the legacy backfill, who may do what, and the AI helpers' fallbacks. Real tokens, in-memory SQLite,
the router mounted on a small app (like the department rights tests); the certification router is mounted to prove the gate."""
import os

os.environ.setdefault("SESSION_SECRET", "unit-test-secret")

from datetime import datetime  # noqa: E402
from types import SimpleNamespace  # noqa: E402

import pytest  # noqa: E402
from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402

import grc.models as m  # noqa: E402
from _fwonb_world import Sampler, answers_for, profile_values  # noqa: E402
from grc.modules.framework_onboarding import ai, catalog, gate, service  # noqa: E402
from grc.modules.framework_onboarding.router import router  # noqa: E402
from grc.routers.auth_router import create_access_token  # noqa: E402
from grc.routers.certification_router import router as cert_router  # noqa: E402

PLAIN, EDITOR, ADMIN, APPROVER, OVERRIDER = 1, 2, 3, 4, 5
P = "/compliance/org-profile"
O = "/compliance/framework-onboarding"
ISO, SOC2, CUSTOM, PCI = 31, 32, 33, 34


@pytest.fixture
def w():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    m.Base.metadata.create_all(engine)
    db = sessionmaker(bind=engine)()
    db.add(m.Tenant(id=1, name="Acme", slug="acme", primary_contact_email="boss@acme.test"))
    for uid, name in [(PLAIN, "plain"), (EDITOR, "edith"), (ADMIN, "ada"), (APPROVER, "appo"), (OVERRIDER, "ovo"), (7, "sana"), (8, "omar"), (9, "amina")]:
        db.add(m.GRCUser(id=uid, username=name, email=f"{name}@acme.test", display_name=name.title()))
    db.add(m.Role(id=1, tenant_id=1, name="Administrator"))
    for rid, role, perm in [(2, "Framework editors", "compliance:frameworks:edit"), (3, "Approvers", "compliance:framework_onboarding:approve"),
                            (4, "Overriders", "compliance:framework_onboarding:override")]:
        db.add(m.Role(id=rid, tenant_id=1, name=role))
        db.add(m.Permission(id=rid, name=perm, resource=perm.rsplit(":", 1)[0], action=perm.rsplit(":", 1)[1]))
        db.add(m.RolePermission(role_id=rid, permission_id=rid))
    for uid, rid in [(ADMIN, 1), (EDITOR, 2), (APPROVER, 3), (OVERRIDER, 4)]:
        db.add(m.UserRole(user_id=uid, role_id=rid, tenant_id=1))
    db.add(m.ITAsset(id=5, tenant_id=1, name="Core banking", asset_type="application", criticality="critical", status="active"))
    for fid, name, slug in [(ISO, "ISO/IEC 27001:2022", "iso_27001"), (SOC2, "SOC 2 Type II", "soc2"), (CUSTOM, "My Internal Standard", None), (PCI, "PCI DSS v4.0.1", "pci_dss")]:
        db.add(m.UploadedFramework(id=fid, tenant_id=1, name=name, slug=slug, file_name="f.pdf", file_path="/f.pdf", file_type="pdf", upload_status="parsed",
                                   is_active=True, uploaded_by=ADMIN, created_at=datetime(2026, 1, 1)))
    db.commit()
    app = FastAPI()
    app.include_router(router)
    app.include_router(cert_router)
    app.dependency_overrides[m.get_db] = lambda: db
    http = TestClient(app)

    def as_(uid):
        http.headers["Authorization"] = "Bearer " + create_access_token({"sub": db.get(m.GRCUser, uid).username, "tenant_slug": "acme", "tenant_id": 1})
        return http

    yield db, as_, http
    db.close()


def counts(db):
    return tuple(db.query(t).count() for t in (m.FrameworkOrgProfile, m.FrameworkOnboarding, m.FrameworkOnboardingEvent))


def fill_profile(http):
    r = http.put(P, json={"values": profile_values()})
    assert r.status_code == 200, r.text
    return r.json()


def rows_of(profile):
    v = profile["values"]
    rows = lambda group, key: [r["id"] for r in (v.get(group) or {}).get(key) or []]   # noqa: E731 - a list the profile never got is empty
    return {"entities": rows("entities_sites", "legal_entities"), "sites": rows("entities_sites", "sites"),
            "third_parties": rows("data_systems", "third_parties"), "data_types": rows("data_systems", "data_types")}


def fill_onboarding(http, ob_id, slug, profile, overrides=None):
    answers = answers_for(slug, Sampler(org_rows=rows_of(profile), systems=[5]))
    for step, vals in (overrides or {}).items():
        answers.setdefault(step, {}).update(vals)
    last = None
    for step, vals in answers.items():
        last = http.put(f"{O}/{ob_id}/answers", json={"step": step, "values": vals})
        assert last.status_code == 200, (step, last.text)
    return last.json()


ISO_DATES = {}                                    # the catalog asks no dates before work starts


def selected_parts(prof):
    """Answers that narrow a framework to part of the organisation and pick one site of the profile: the scope questions then apply."""
    return {"applicability": {"reach": "Selected parts only"}, "scope": {"locations": rows_of(prof)["sites"][:1]}}


def ready_iso(http, selected=True):
    prof = fill_profile(http)
    ob = http.post(O, json={"uploaded_framework_id": ISO}).json()
    view = fill_onboarding(http, ob["id"], "iso_27001", prof, selected_parts(prof) if selected else ISO_DATES)
    return ob["id"], view


# ---------------------------------------------------------------- who may do what
def test_reads_need_only_a_sign_in_and_a_get_writes_nothing(w):
    db, as_, http = w
    http = as_(PLAIN)
    for path in (f"{P}/catalog", P, O, f"{O}/families/iso_27001", f"{O}/gate/{ISO}"):
        r = http.get(path)
        assert r.status_code == 200, (path, r.text)
    assert counts(db) == (0, 0, 0)
    db.expire_all()
    http.headers.pop("Authorization")
    assert http.get(P).status_code == 401


def test_writes_need_the_matching_grant_and_a_framework_editor_may_edit_both(w):
    db, as_, http = w
    plain = as_(PLAIN)
    assert plain.put(P, json={"values": {"entities_sites.headcount": 5}}).status_code == 403
    assert plain.post(O, json={"uploaded_framework_id": ISO}).status_code == 403
    edit = as_(EDITOR)
    assert edit.put(P, json={"values": {"entities_sites.headcount": 5}}).status_code == 200
    ob = edit.post(O, json={"uploaded_framework_id": ISO}).json()
    assert edit.put(f"{O}/{ob['id']}/answers", json={"step": "objective", "values": {"goal": "Internal assessment"}}).status_code == 200
    # approving and overriding are their own grants: editing frameworks does not give them
    assert edit.post(f"{O}/{ob['id']}/approve", json={}).status_code == 403
    assert edit.post(f"{O}/{ob['id']}/reopen", json={"reason": "a good enough reason"}).status_code == 403
    assert edit.post(f"{O}/{ob['id']}/underway", json={"kind": "Other", "reason": "x" * 25}).status_code == 403
    assert as_(OVERRIDER).post(f"{O}/{ob['id']}/underway", json={"kind": "Other", "reason": "x" * 25}).status_code == 200
    assert as_(ADMIN).post(f"{O}/{ob['id']}/reopen", json={"reason": "reopened by an administrator"}).status_code == 409   # underway cannot be reopened


# ---------------------------------------------------------------- the organisation profile
def test_the_profile_saves_only_the_keys_sent_writes_five_facts_to_the_tenant_and_keeps_row_ids(w):
    db, as_, http = w
    http = as_(EDITOR)
    r = http.put(P, json={"values": {"entities_sites.legal_entity": "Acme Bank Ltd", "entities_sites.industry": "Banking", "entities_sites.headcount": "250",
                                     "entities_sites.sites": [{"name": "Karachi HQ", "kind": "Head office", "country": "Pakistan"}]}})
    assert r.status_code == 200, r.text
    body = r.json()
    t = db.get(m.Tenant, 1)
    db.refresh(t)
    assert (t.legal_entity, t.industry) == ("Acme Bank Ltd", "Banking")                      # one source of truth: the Tenant row
    row = db.query(m.FrameworkOrgProfile).one()
    assert "legal_entity" not in (row.values.get("entities_sites") or {}) and row.values["entities_sites"]["headcount"] == 250
    assert body["values"]["entities_sites"]["legal_entity"] == "Acme Bank Ltd"
    site_id = body["values"]["entities_sites"]["sites"][0]["id"]
    # a second save of another key leaves the first alone; the same row sent back keeps its id
    again = http.put(P, json={"values": {"data_systems.classification_scheme": "Public / Internal / Confidential",
                                          "entities_sites.sites": [{"id": site_id, "name": "Karachi HQ", "kind": "Head office", "country": "Pakistan", "city": "Karachi"}]}}).json()
    assert again["values"]["entities_sites"]["sites"][0]["id"] == site_id and again["values"]["entities_sites"]["headcount"] == 250
    assert again["values"]["entities_sites"]["sites"][0]["city"] == "Karachi"
    # the departments of the tree come back as the units
    db.add(m.GRCDepartment(id=1, tenant_id=1, name="Finance", code="FIN"))
    db.commit()
    assert http.get(P).json()["values"]["entities_sites"]["units"] == [1]


def test_a_refused_key_says_which_and_saves_nothing(w):
    db, as_, http = w
    http = as_(EDITOR)
    r = http.put(P, json={"values": {"entities_sites.headcount": 0, "data_systems.hosting": ["Mars"], "nope.field": 1, "entities_sites.units": [1],
                                     "risk_people.sponsor": {"user_id": 999}, "entities_sites.legal_entity": "ok"}})
    assert r.status_code == 422
    errors = {e["field"] for e in r.json()["detail"]["errors"]}
    assert errors == {"entities_sites.headcount", "data_systems.hosting", "nope.field", "entities_sites.units", "risk_people.sponsor"}
    db.expire_all()
    assert counts(db)[0] == 0 and db.get(m.Tenant, 1).legal_entity is None


def test_the_profile_is_complete_when_the_required_items_and_the_none_ticks_are_there_and_a_review_lasts_until_the_stage_is_edited(w):
    db, as_, http = w
    http = as_(EDITOR)
    empty = http.get(P).json()["evaluation"]
    assert not empty["complete"] and empty["groups"]["data_systems"]["required_ok"] == 0
    done = fill_profile(http)["evaluation"]
    assert done["complete"], done["missing"]
    assert http.post(f"{P}/groups/data_systems/review").json()["evaluation"]["groups"]["data_systems"]["reviewed"]
    assert http.post(f"{P}/groups/nope/review").status_code == 404
    after = http.put(P, json={"values": {"data_systems.data_flow_ref": "Flow diagram v3"}}).json()["evaluation"]
    assert not after["groups"]["data_systems"]["reviewed"]
    # a list left empty is a gap until the organisation says there is none
    http.put(P, json={"values": {"regulators_obligations.regulators": []}})
    assert not http.get(P).json()["evaluation"]["complete"]
    http.put(P, json={"values": {"regulators_obligations.no_regulator": True}})
    assert http.get(P).json()["evaluation"]["complete"]


def test_a_row_a_completed_onboarding_picked_cannot_be_removed(w):
    db, as_, http = w
    http = as_(ADMIN)
    ob_id, view = ready_iso(http)
    assert view["readiness"]["ready"], [c for c in view["readiness"]["checks"] if c["required"] and not c["ok"]]
    assert http.post(f"{O}/{ob_id}/submit").status_code == 200 and http.post(f"{O}/{ob_id}/approve", json={}).status_code == 200
    sites = http.get(P).json()["values"]["entities_sites"]["sites"]
    r = http.put(P, json={"values": {"entities_sites.sites": []}})
    assert r.status_code == 409 and r.json()["detail"]["used_by"] == ["ISO/IEC 27001:2022"]
    # a row nobody picked can go; a new one can be added
    extra = http.put(P, json={"values": {"entities_sites.sites": sites + [{"name": "Lahore", "kind": "Branch", "country": "Pakistan"}]}})
    assert extra.status_code == 200
    gone = http.put(P, json={"values": {"entities_sites.sites": sites}})
    assert gone.status_code == 200 and len(gone.json()["values"]["entities_sites"]["sites"]) == len(sites)


# ---------------------------------------------------------------- the register and the catalog
def test_the_register_lists_the_tenants_frameworks_with_their_family_and_state(w):
    db, as_, http = w
    http = as_(EDITOR)
    reg = http.get(O).json()
    rows = {r["uploaded_framework_id"]: r for r in reg["frameworks"]}
    assert rows[ISO]["family"] == "iso_management" and rows[ISO]["state"] == "not_started" and rows[ISO]["slug"] == "iso_27001"
    assert rows[CUSTOM]["family"] == "general" and rows[PCI]["family"] == "payments"
    assert reg["counts"]["not_started"] == 4
    ob = http.post(O, json={"uploaded_framework_id": ISO}).json()
    again = http.post(O, json={"uploaded_framework_id": ISO}).json()
    assert ob["id"] == again["id"] and db.query(m.FrameworkOnboarding).count() == 1                    # starting twice is one onboarding
    row = {r["uploaded_framework_id"]: r for r in http.get(O).json()["frameworks"]}[ISO]
    assert row["state"] == "draft" and row["progress"]["total"] > row["progress"]["done"] >= 0
    assert http.post(O, json={"uploaded_framework_id": 999}).status_code == 404


# ---------------------------------------------------------------- one onboarding, draft to approved
def test_an_onboarding_is_saved_per_step_submitted_approved_and_locked(w):
    db, as_, http = w
    http = as_(ADMIN)
    prof = fill_profile(http)
    ob = http.post(O, json={"uploaded_framework_id": ISO}).json()
    assert ob["state"] == "draft" and ob["framework"]["family"] == "iso_management" and [s["key"] for s in ob["steps"]][:5] == ["objective", "applicability", "scope", "existing", "ownership"]
    # nothing is ready, and submitting says what is open
    r = http.post(f"{O}/{ob['id']}/submit")
    assert r.status_code == 422 and r.json()["detail"]["checks"]
    # a wrong answer says which field
    bad = http.put(f"{O}/{ob['id']}/answers", json={"step": "objective", "values": {"goal": "Whenever", "nope": 1}})
    assert bad.status_code == 422 and {e["field"] for e in bad.json()["detail"]["errors"]} == {"objective.goal", "objective.nope"}
    assert http.put(f"{O}/{ob['id']}/answers", json={"step": "nowhere", "values": {}}).status_code == 422
    view = fill_onboarding(http, ob["id"], "iso_27001", prof, selected_parts(prof))
    assert view["readiness"]["ready"], [c for c in view["readiness"]["checks"] if c["required"] and not c["ok"]]
    assert view["state"] == "draft" and "objective.required_by" in view["readiness"]["hidden"]      # asked only of a regulatory or customer objective
    # submit, then editing sends it back to draft, then submit and approve
    assert http.post(f"{O}/{ob['id']}/submit").json()["state"] == "ready"
    edit = http.put(f"{O}/{ob['id']}/answers", json={"step": "ownership", "values": {"assessor": "Internal audit"}}).json()
    assert edit["state"] == "draft"
    assert http.post(f"{O}/{ob['id']}/submit").json()["state"] == "ready"
    done = http.post(f"{O}/{ob['id']}/approve", json={"note": "Scope agreed with the sponsor"}).json()
    assert done["state"] == "complete" and done["locked"] and done["approved_by"] == "Ada" and done["approval_note"] == "Scope agreed with the sponsor"
    row = db.query(m.FrameworkOnboarding).one()
    db.refresh(row)
    assert row.snapshot["answers"]["applicability"]["reach"] == "Selected parts only" and row.snapshot["org_rows"]["sites"] and row.snapshot["catalog_version"] == catalog.catalog_version()
    locked = http.put(f"{O}/{ob['id']}/answers", json={"step": "scope", "values": {"statement": "changed"}})
    assert locked.status_code == 409 and locked.json()["detail"]["locked"] == ["scope.statement"]
    # reopening needs a reason and goes back to draft; the history says what happened
    assert as_(ADMIN).post(f"{O}/{ob['id']}/reopen", json={"reason": "short"}).status_code == 422
    back = http.post(f"{O}/{ob['id']}/reopen", json={"reason": "The scope changes after the merger"}).json()
    assert back["state"] == "draft" and back["reopened_count"] == 1 and not back["locked"]
    kinds = [e["kind"] for e in http.get(f"{O}/{ob['id']}").json()["events"]]
    assert kinds[:3] == ["reopened", "approved", "submitted"] and kinds[-1] == "created"


def test_an_org_row_that_is_not_in_the_profile_cannot_be_picked(w):
    db, as_, http = w
    http = as_(ADMIN)
    fill_profile(http)
    ob = http.post(O, json={"uploaded_framework_id": ISO}).json()
    r = http.put(f"{O}/{ob['id']}/answers", json={"step": "scope", "values": {"locations": ["r-not-there"], "systems": [999]}})
    assert r.status_code == 422 and {e["field"] for e in r.json()["detail"]["errors"]} == {"scope.locations", "scope.systems"}


def test_the_scope_questions_are_asked_only_of_a_framework_that_covers_part_of_the_organisation(w):
    db, as_, http = w
    http = as_(ADMIN)
    prof = fill_profile(http)
    ob = http.post(O, json={"uploaded_framework_id": ISO}).json()
    whole = fill_onboarding(http, ob["id"], "iso_27001", prof, ISO_DATES)
    assert {"scope.departments", "scope.processes", "scope.systems", "scope.locations"} <= set(whole["readiness"]["hidden"]) and whole["readiness"]["ready"]
    assert "scope_named" not in {c["key"] for c in whole["readiness"]["checks"]}
    part = http.put(f"{O}/{ob['id']}/answers", json={"step": "applicability", "values": {"reach": "Selected parts only"}}).json()
    assert not part["readiness"]["hidden"] or "scope.locations" not in part["readiness"]["hidden"]
    named = next(c for c in part["readiness"]["checks"] if c["key"] == "scope_named")
    assert not named["ok"] and named["required"] and not part["readiness"]["ready"]                 # something must be named
    done = http.put(f"{O}/{ob['id']}/answers", json={"step": "scope", "values": {"locations": rows_of(prof)["sites"][:1]}}).json()
    assert done["readiness"]["ready"]


def test_a_custom_framework_gets_the_common_steps_and_nothing_else(w):
    db, as_, http = w
    http = as_(ADMIN)
    prof = fill_profile(http)
    ob = http.post(O, json={"uploaded_framework_id": CUSTOM}).json()
    assert ob["framework"]["family"] == "general" and [s["key"] for s in ob["steps"]] == ["objective", "applicability", "scope", "existing", "ownership"]
    view = fill_onboarding(http, ob["id"], None, prof)
    assert view["readiness"]["ready"], [c for c in view["readiness"]["checks"] if c["required"] and not c["ok"]]


# ---------------------------------------------------------------- already underway
def test_a_running_framework_is_marked_underway_with_a_reason_and_can_be_completed_later(w):
    db, as_, http = w
    http = as_(ADMIN)
    ob = http.post(O, json={"uploaded_framework_id": SOC2}).json()
    no_reason = http.post(f"{O}/{ob['id']}/underway", json={"kind": "Other", "reason": "too short"})
    assert no_reason.status_code == 422 and {e["field"] for e in no_reason.json()["detail"]["errors"]} == {"reason"}
    wrong_kind = http.post(f"{O}/{ob['id']}/underway", json={"kind": "Because", "reason": "The SOC 2 window opened in January"})
    assert wrong_kind.status_code == 422 and {e["field"] for e in wrong_kind.json()["detail"]["errors"]} == {"kind"}
    done = http.post(f"{O}/{ob['id']}/underway", json={"kind": "Certified or attested outside the platform", "reason": "The SOC 2 window opened in January"}).json()
    assert done["state"] == "underway" and done["underway"]["reason"] == "The SOC 2 window opened in January" and done["underway_by"] == "Ada"
    assert http.post(f"{O}/{ob['id']}/underway", json={"kind": "Other", "reason": "x" * 30}).status_code == 409
    # the gaps are still listed, and the gate lets a journey start
    assert done["readiness"]["counts"]["required_total"] > done["readiness"]["counts"]["required_ok"]
    assert http.get(f"{O}/gate/{SOC2}").json()["allowed"] is True
    r = http.post("/certifications", json={"framework_id": SOC2, "name": "SOC 2 journey"})
    assert r.status_code == 201, r.text
    # underway is not approval: approving still needs everything done
    assert http.post(f"{O}/{ob['id']}/approve", json={}).status_code == 422


# ---------------------------------------------------------------- the gate
def test_a_journey_is_refused_until_the_onboarding_is_complete(w):
    db, as_, http = w
    http = as_(ADMIN)
    r = http.post("/certifications", json={"framework_id": ISO, "name": "ISO journey"})
    assert r.status_code == 409
    d = r.json()["detail"]
    assert d["code"] == "onboarding_required" and d["state"] == "not_started" and d["onboarding_id"] is None and d["unmet"][0]["key"] == "onboarding"
    assert db.query(m.CertificationJourney).count() == 0
    ob_id, view = ready_iso(http)
    r = http.post("/certifications", json={"framework_id": ISO, "name": "ISO journey"})
    d = r.json()["detail"]
    assert r.status_code == 409 and d["state"] == "draft" and d["onboarding_id"] == ob_id and d["unmet"] == []     # ready to submit, not yet approved
    kinds = [e["kind"] for e in http.get(f"{O}/{ob_id}").json()["events"]]
    assert "journey_blocked" in kinds
    http.post(f"{O}/{ob_id}/submit")
    http.post(f"{O}/{ob_id}/approve", json={})
    r = http.post("/certifications", json={"framework_id": ISO, "name": "ISO journey"})
    assert r.status_code == 201 and db.query(m.CertificationJourney).count() == 1
    assert "journey_started" in [e["kind"] for e in http.get(f"{O}/{ob_id}").json()["events"]]


def test_the_refusal_names_what_is_open_for_a_draft(w):
    db, as_, http = w
    http = as_(ADMIN)
    ob = http.post(O, json={"uploaded_framework_id": PCI}).json()
    d = http.post("/certifications", json={"framework_id": PCI, "name": "PCI"}).json()["detail"]
    assert d["state"] == "draft" and d["onboarding_id"] == ob["id"] and len(d["unmet"]) > 3
    g = http.get(f"{O}/gate/{PCI}").json()
    assert g["allowed"] is False and g["framework"] == "PCI DSS v4.0.1" and g["unmet"] == d["unmet"]


def test_a_framework_that_already_has_a_journey_is_never_blocked(w):
    db, as_, http = w
    db.add(m.CertificationJourney(id=1, tenant_id=1, uploaded_framework_id=ISO, name="Running", status="in_progress"))
    db.commit()
    http = as_(EDITOR)
    assert http.get(f"{O}/gate/{ISO}").json()["allowed"] is True
    r = http.post("/certifications", json={"framework_id": ISO, "name": "Running"})
    assert r.status_code == 201 and db.query(m.CertificationJourney).count() == 1               # the existing journey is returned


def test_adding_a_framework_to_the_automation_scope_blocks_only_its_journey(w):
    from grc.modules.scf import scope_service

    db, as_, http = w
    scope = SimpleNamespace(framework_slugs=["iso_27001", "soc2"], tenant_id=1, id=1)
    user = db.get(m.GRCUser, ADMIN)
    out = scope_service.sync_journeys_for_scope(db, 1, user, scope)
    assert out["created"] == [] and [b["slug"] for b in out["blocked"]] == ["iso_27001", "soc2"] and out["blocked"][0]["state"] == "not_started"
    ob = service.create(db, 1, user, db.get(m.UploadedFramework, SOC2))
    service.mark_underway(db, ob, user, "Other", "The attestation window is already open")
    out = scope_service.sync_journeys_for_scope(db, 1, user, scope)
    assert [c["slug"] for c in out["created"]] == ["soc2"] and [b["slug"] for b in out["blocked"]] == ["iso_27001"]
    assert db.query(m.CertificationJourney).count() == 1
    out = scope_service.sync_journeys_for_scope(db, 1, user, scope)                              # asking again changes nothing
    assert out["created"] == [] and [e["slug"] for e in out["existing"]] == ["soc2"]


# ---------------------------------------------------------------- the legacy backfill
def test_every_running_journey_becomes_underway_once_and_nothing_else_is_touched(w):
    from grc.modules.compliance import schema_migrations as sm

    db, as_, http = w
    db.add_all([m.CertificationJourney(id=1, tenant_id=1, uploaded_framework_id=ISO, name="ISO", status="in_progress"),
                m.CertificationJourney(id=2, tenant_id=1, uploaded_framework_id=SOC2, name="SOC 2", status="completed"),
                m.CertificationJourney(id=3, tenant_id=1, uploaded_framework_id=SOC2, name="SOC 2 again", status="in_progress")])
    db.commit()
    engine = db.get_bind()
    sm._backfill_framework_onboarding_legacy(engine)
    db.expire_all()
    rows = db.query(m.FrameworkOnboarding).order_by(m.FrameworkOnboarding.uploaded_framework_id).all()
    assert [(r.uploaded_framework_id, r.state, r.underway_source, r.framework_slug) for r in rows] == [(ISO, "underway", "legacy", "iso_27001"), (SOC2, "underway", "legacy", "soc2")]
    assert rows[0].underway_reason == service.LEGACY_REASON and db.query(m.FrameworkOnboardingEvent).count() == 2
    sm._backfill_framework_onboarding_legacy(engine)                                             # again: nothing new
    assert db.query(m.FrameworkOnboarding).count() == 2 and db.query(m.FrameworkOnboardingEvent).count() == 2
    # the register shows them as underway, and a framework without a journey is left alone
    http = as_(PLAIN)
    reg = {r["uploaded_framework_id"]: r for r in http.get(O).json()["frameworks"]}
    assert reg[ISO]["state"] == "underway" and reg[ISO]["underway"]["legacy"] and reg[PCI]["state"] == "not_started"
    # a tenant with a handmade onboarding already: the journey does not overwrite it
    assert service.backfill_legacy(db) == 0


# ---------------------------------------------------------------- AI help
def test_ai_help_answers_from_rules_when_ai_is_not_available_and_says_so(w, monkeypatch):
    db, as_, http = w
    http = as_(ADMIN)
    prof = fill_profile(http)
    ob = http.post(O, json={"uploaded_framework_id": ISO}).json()
    fill_onboarding(http, ob["id"], "iso_27001", prof, ISO_DATES)
    monkeypatch.setattr("grc.services.openai_client.check_ai_available", lambda: False)
    for kind in ai.KINDS:
        r = http.post(f"{O}/{ob['id']}/ai/{kind}", json={})
        assert r.status_code == 200 and r.json()["by"] == "rules" and r.json()["kind"] == kind, (kind, r.text)
    scope = http.post(f"{O}/{ob['id']}/ai/scope_draft", json={}).json()["suggestion"]["statement"]
    assert scope.startswith("The ISO/IEC 27001:2022 scope covers") and "Sample" in scope
    assert http.post(f"{O}/{ob['id']}/ai/nonsense", json={}).status_code == 404
    assert as_(PLAIN).post(f"{O}/{ob['id']}/ai/gap_review", json={}).status_code == 403            # needs the right to edit
    db.expire_all()
    assert db.get(m.FrameworkOnboarding, ob["id"]).state == "draft"                                 # a suggestion is never saved


def test_ai_answers_are_checked_before_they_are_shown(w, monkeypatch):
    db, as_, http = w
    http = as_(ADMIN)
    prof = fill_profile(http)
    http.put(P, json={"values": {"entities_sites.sites": prof["values"]["entities_sites"]["sites"] + [{"name": "Lahore", "kind": "Branch", "country": "Pakistan"}]}})
    ob = http.post(O, json={"uploaded_framework_id": ISO}).json()
    fill_onboarding(http, ob["id"], "iso_27001", http.get(P).json(), ISO_DATES)
    monkeypatch.setattr(ai, "_ask_json", lambda prompt: {"exclusions": [{"item": "Lahore", "reason": "Closed in 2025"}, {"item": "Atlantis", "reason": "invented"}],
                                                         "questions": [{"item": "Lahore", "why": "Is any data processed there?"}, {"item": "Mars", "why": "invented"}]})
    out = http.post(f"{O}/{ob['id']}/ai/exclusions_check", json={}).json()
    assert out["by"] == "ai" and out["suggestion"]["exclusions"] == [{"item": "Lahore", "reason": "Closed in 2025"}]
    assert out["suggestion"]["questions"] == [{"item": "Lahore", "why": "Is any data processed there?"}]       # a site that is not in the profile is dropped
    monkeypatch.setattr(ai, "_ask_json", lambda prompt: (_ for _ in ()).throw(ai.AIUnusable("cut off")))
    assert http.post(f"{O}/{ob['id']}/ai/exclusions_check", json={}).json()["by"] == "rules"
    monkeypatch.setattr(ai, "_ask_json", lambda prompt: {"questions": [{"field": "scope.statement", "question": "What does the statement leave out?"}, {"field": "made.up", "question": "x"}]})
    gap = http.post(f"{O}/{ob['id']}/ai/gap_review", json={}).json()
    assert gap["by"] == "ai" and gap["suggestion"]["questions"] == [{"field": "scope.statement", "question": "What does the statement leave out?"}]


# ---------------------------------------------------------------- PostgreSQL enforces column lengths, SQLite does not
def test_every_word_the_server_stores_fits_its_column():
    """The scratch PostgreSQL run caught "Certified or attested outside the platform" (42) in a varchar(40): SQLite never would."""
    cols = m.FrameworkOnboarding.__table__.c
    for kind in service.UNDERWAY_KINDS:
        assert len(kind) <= cols.underway_kind.type.length, kind
    assert all(len(s) <= cols.state.type.length for s in service.STATES)
    assert max(len(slug) for fam in catalog.families().values() for fw in fam["frameworks"] for slug in [fw["slug"]]) <= cols.framework_slug.type.length
    assert max(len(k) for k in catalog.families()) <= cols.family.type.length
    kinds = ["created", "saved", "submitted", "approved", "reopened", "marked_underway", "journey_started", "journey_blocked"]
    assert max(len(k) for k in kinds) <= m.FrameworkOnboardingEvent.__table__.c.kind.type.length


# ---------------------------------------------------------------- the organisation profile gates nothing
def test_a_framework_is_approved_without_the_rest_of_the_organisation_profile(w):
    """ISO 27001 needs its own scope answers and the sites it picks from the profile: not regulators, certifications, audits, risk appetite or people."""
    db, as_, http = w
    http = as_(ADMIN)
    prof = http.put(P, json={"values": {"entities_sites.sites": [{"name": "Karachi HQ", "kind": "Head office", "country": "Pakistan"}]}}).json()
    assert not prof["evaluation"]["complete"] and prof["evaluation"]["groups"]["regulators_obligations"]["required_ok"] == 0
    ob = http.post(O, json={"uploaded_framework_id": ISO}).json()
    view = fill_onboarding(http, ob["id"], "iso_27001", prof, ISO_DATES)
    assert view["readiness"]["ready"] and view["readiness"]["org_checks"] == [], view["readiness"]["checks"]
    assert http.post(f"{O}/{ob['id']}/submit").json()["state"] == "ready"
    assert http.post(f"{O}/{ob['id']}/approve", json={}).json()["state"] == "complete"
    assert http.post("/certifications", json={"framework_id": ISO, "name": "ISO journey"}).status_code == 201
    assert "org" not in http.get(O).json()                                  # the register no longer reports the profile's completeness


def test_a_framework_that_picks_from_an_empty_list_waits_for_that_list_only(w):
    db, as_, http = w
    http = as_(ADMIN)
    ob = http.post(O, json={"uploaded_framework_id": ISO}).json()
    view = http.put(f"{O}/{ob['id']}/answers", json={"step": "applicability", "values": {"reach": "Selected parts only"}}).json()
    open_now = {c["key"] for c in view["readiness"]["checks"] if c["required"] and not c["ok"]}
    assert "scope_named" in open_now and "objective.goal" in open_now        # its own questions, and something to pick from an empty profile...
    assert not any(k.startswith("org.") for k in open_now)                   # ...and nothing the organisation profile asks
    assert view["requires_org"] == [] and view["readiness"]["org_checks"] == []


def test_a_new_onboarding_starts_with_what_the_organisation_already_told_us(w):
    db, as_, http = w
    http = as_(ADMIN)
    http.put(P, json={"values": {"entities_sites.legal_entity": "Acme Bank Ltd", "regulators_obligations.jurisdictions": ["Pakistan"],
                                 "risk_people.compliance_lead": {"user_id": 7}, "risk_people.sponsor": {"user_id": 8}}})
    ob = http.post(O, json={"uploaded_framework_id": ISO}).json()
    assert ob["answers"]["applicability"] == {"entity": "Acme Bank Ltd", "jurisdictions": ["Pakistan"]}
    assert ob["answers"]["ownership"] == {"owner": {"user_id": 7}, "approver": {"user_id": 8}}
    again = http.post(O, json={"uploaded_framework_id": ISO}).json()
    assert again["id"] == ob["id"] and again["answers"] == ob["answers"]                                 # starting twice changes nothing
    bare = http.post(O, json={"uploaded_framework_id": SOC2}).json()
    assert bare["answers"]["applicability"]["entity"] == "Acme Bank Ltd"


def test_an_organisation_administrator_may_edit_the_profile_that_now_lives_in_administration(w):
    db, as_, http = w
    perm = m.Permission(id=9, name="admin:organization:edit", resource="admin:organization", action="edit")
    db.add_all([perm, m.Role(id=9, tenant_id=1, name="Organisation editors"), m.RolePermission(role_id=9, permission_id=9), m.UserRole(user_id=PLAIN, role_id=9, tenant_id=1)])
    db.commit()
    assert as_(PLAIN).put(P, json={"values": {"entities_sites.headcount": 40}}).status_code == 200


# ---------------------------------------------------------------- documents on an answer
def test_a_document_is_uploaded_kept_in_evidence_attached_to_an_answer_and_read_back(w, monkeypatch, tmp_path):
    import grc.modules.evidence.routers.evidence as evidence_router
    monkeypatch.setattr(evidence_router, "EVIDENCE_UPLOAD_DIR", str(tmp_path))
    db, as_, http = w
    http = as_(EDITOR)
    ob = http.post(O, json={"uploaded_framework_id": ISO}).json()
    assert "iso.soa_file" in ob["readiness"]["hidden"]                               # asked only after a yes
    up = http.post(f"{O}/files", files={"file": ("soa.pdf", b"%PDF-1.4 the statement", "application/pdf")})
    assert up.status_code == 201, up.text
    doc = up.json()
    assert doc["name"] == "soa.pdf"
    view = http.put(f"{O}/{ob['id']}/answers", json={"step": "iso", "values": {"soa": "Yes", "soa_file": [doc]}}).json()
    assert view["answers"]["iso"]["soa_file"] == [{"id": doc["id"], "name": "soa.pdf"}]
    assert "iso.soa_file" not in view["readiness"]["hidden"]
    row = db.get(m.Evidence, doc["id"])
    assert (row.tenant_id, row.source_system, row.uploaded_by) == (1, "Framework onboarding", EDITOR) and os.path.isfile(row.file_path)
    got = as_(PLAIN).get(f"{O}/files/{doc['id']}")                                    # reading needs a sign-in only, like the rest
    assert got.status_code == 200 and got.content == b"%PDF-1.4 the statement" and "attachment" in got.headers["content-disposition"]
    assert "soa_file" not in as_(EDITOR).put(f"{O}/{ob['id']}/answers", json={"step": "iso", "values": {"soa_file": []}}).json()["answers"].get("iso", {})   # taken off the answer


def test_an_upload_needs_the_edit_grant_a_known_file_type_and_a_file(w, monkeypatch, tmp_path):
    import grc.modules.evidence.routers.evidence as evidence_router
    monkeypatch.setattr(evidence_router, "EVIDENCE_UPLOAD_DIR", str(tmp_path))
    db, as_, http = w
    pdf = {"file": ("a.pdf", b"x", "application/pdf")}
    assert as_(PLAIN).post(f"{O}/files", files=pdf).status_code == 403
    edit = as_(EDITOR)
    assert edit.post(f"{O}/files", files={"file": ("run.exe", b"MZ", "application/octet-stream")}).status_code == 400
    assert edit.post(f"{O}/files", files={"file": ("empty.pdf", b"", "application/pdf")}).status_code == 400
    assert db.query(m.Evidence).count() == 0 and list(tmp_path.iterdir()) == []


def test_only_documents_uploaded_here_by_this_organisation_can_be_attached_or_read(w):
    db, as_, http = w
    db.add(m.Tenant(id=2, name="Other", slug="other", primary_contact_email="x@other.test"))
    db.add_all([m.Evidence(id=70, tenant_id=1, name="Policy.pdf", file_name="Policy.pdf", evidence_type="document", status="draft"),            # evidence, not uploaded here
                m.Evidence(id=71, tenant_id=2, name="Theirs.pdf", file_name="Theirs.pdf", source_system="Framework onboarding", status="draft")])  # another organisation's
    db.commit()
    http = as_(EDITOR)
    ob = http.post(O, json={"uploaded_framework_id": ISO}).json()
    for evidence_id in (70, 71, 999):
        r = http.put(f"{O}/{ob['id']}/answers", json={"step": "iso", "values": {"soa": "Yes", "soa_file": [{"id": evidence_id}]}})
        assert r.status_code == 422 and r.json()["detail"]["errors"][0]["field"] == "iso.soa_file", (evidence_id, r.text)
        assert http.get(f"{O}/files/{evidence_id}").status_code == 404
