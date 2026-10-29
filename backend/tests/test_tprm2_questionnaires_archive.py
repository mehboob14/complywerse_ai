"""A questionnaire is archived, not deleted, once it has been used; it can be copied and made the default for tiers
(TPRM parity, piece B7, rule R12).

An archived questionnaire is hidden unless asked for, cannot be sent or edited, and leaves the tiers it was the default of;
questionnaires already sent keep working. One that was ever sent can never be deleted. A copy is an ordinary editable
questionnaire. "Default for these tiers" is the tier policy's own list (what Settings edits), shown and set from the
questionnaire. In-memory SQLite.
"""
from datetime import datetime, timedelta

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from grc.models import (
    Base, GRCUser, Tenant, TPRAActionItem, TPRAAuditLog, TPRAQuestion, TPRATieringConfig, Vendor, VendorAssessment,
    VendorQuestionnaireResponse, VendorQuestionnaireTemplate, get_db,
)
from grc.modules.vendor_risk.routers import questionnaires as routes
from grc.modules.vendor_risk.tpra import follow_ups, rbac, tier_policy, versions
from grc.modules.vendor_risk.tpra.builtin_templates import TIER_SUGGESTED_TEMPLATES
from grc.routers.auth_router import require_auth

BASE = "/vendor-risk/questionnaire-templates"
QUESTIONS = [
    {"id": "mfa", "text": "Is MFA enforced?", "type": "yes_no", "required": True, "section": "Access"},
    {"id": "mfa_how", "text": "How?", "type": "text", "section": "access ", "show_if": {"question": "mfa", "in": ["yes"]}},
    {"id": "enc", "text": "Is data encrypted?", "type": "yes_no", "domain": "data_privacy"},
    {"id": "free", "text": "Anything else?", "type": "text"},
]


@pytest.fixture()
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    s = sessionmaker(bind=engine)()
    s.add(Tenant(id=1, name="Acme", slug="acme"))
    s.add_all([GRCUser(id=7, username="ana", email="ana@x.test", display_name="Ana Lyst", is_active=True),
               GRCUser(id=8, username="bo", email="bo@x.test", display_name="Bo Editor", is_active=True)])
    s.commit()
    yield s
    s.close()


@pytest.fixture()
def can(monkeypatch):
    """The rights the signed-in user holds ('*' for all). A TPRA write needs `vendor_risk:<resource>:<action>`."""
    rights = {"*"}
    monkeypatch.setattr(rbac, "user_has_any_permission",
                        lambda db, user, names: "*" in rights or bool(rights & set(names)))
    return rights


@pytest.fixture()
def http(db, can, monkeypatch):
    monkeypatch.setattr(routes, "_email_link", lambda *a, **k: None)
    app = FastAPI()
    app.include_router(routes.router, prefix="/vendor-risk")
    who = {"id": 7}
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[require_auth] = lambda: db.get(GRCUser, who["id"])
    client = TestClient(app)
    client.who = who
    return client


def make(db, name="Security", questions=None, **kw):
    t = VendorQuestionnaireTemplate(tenant_id=1, name=name, category="security", **kw,
                                    questions=[dict(q) for q in (QUESTIONS if questions is None else questions)])
    db.add(t)
    db.commit()
    return t


def sent(db, template):
    """The questionnaire went to a supplier, on a link of its own."""
    v = Vendor(tenant_id=1, name="Acme Cloud", status="active", primary_contact_email="sam@supplier.test",
               primary_contact_name="Sam")
    db.add(v)
    db.flush()
    version = versions.publish(db, template)
    qr = VendorQuestionnaireResponse(tenant_id=1, vendor_id=v.id, template_id=template.id, template_version_id=version.id,
                                     respondent_name="Sam", respondent_email="sam@supplier.test", token="t-1",
                                     status="pending")
    db.add(qr)
    db.commit()
    return v, qr


def stored(db):
    row = db.query(TPRATieringConfig).first()
    return (row.tier_policy if row else None) or {}


def listed(http, **params):
    return {t["id"]: t for t in http.get(BASE, params=params).json()["items"]}


# ── what the list says ───────────────────────────────────────────────────────

def test_the_list_says_what_a_card_shows(db, http):
    t = make(db, created_by=7)
    got = listed(http)[t.id]
    assert got["archived_at"] is None and got["used"] is False and got["default_tiers"] == []
    assert got["section_count"] == 3                  # "Access" and "access " are one section, then Data privacy, General
    assert got["question_count"] == 4 and got["updated_by_name"] == "Ana Lyst"      # never edited: its author


def test_who_changed_it_last_is_named_once_someone_has(db, http, can):
    t = make(db, created_by=7, created_at=datetime.utcnow() - timedelta(days=3),
             updated_at=datetime.utcnow() - timedelta(days=2))
    assert listed(http)[t.id]["updated_by_name"] is None            # edited before we kept the name: not guessed
    http.who["id"] = 8
    assert http.put(f"{BASE}/{t.id}", json={"description": "Edited"}).status_code == 200
    assert listed(http)[t.id]["updated_by_name"] == "Bo Editor"


def test_a_questionnaire_is_used_once_it_has_been_sent(db, http):
    a, b = make(db, "Sent"), make(db, "Never sent")
    sent(db, a)
    got = listed(http)
    assert got[a.id]["used"] is True and got[a.id]["latest_version"] == 1 and got[b.id]["used"] is False


def test_one_questionnaire_can_be_read_whether_or_not_it_is_archived(db, http):
    t = make(db)
    assert http.get(f"{BASE}/{t.id}").json()["id"] == t.id
    http.post(f"{BASE}/{t.id}/archive")
    assert http.get(f"{BASE}/{t.id}").json()["archived_at"] is not None
    assert http.get(f"{BASE}/999").status_code == 404


# ── archive and restore ──────────────────────────────────────────────────────

def test_archived_ones_are_hidden_unless_asked_for(db, http):
    live, gone = make(db, "Live"), make(db, "Gone")
    assert http.post(f"{BASE}/{gone.id}/archive").status_code == 200
    assert set(listed(http)) == {live.id}
    assert set(listed(http, include_archived=True)) == {live.id, gone.id}
    assert http.get(BASE, params={"include_archived": True}).json()["total"] == 2
    assert http.get(BASE).json()["total"] == 1
    back = http.post(f"{BASE}/{gone.id}/restore").json()
    assert back["archived_at"] is None and set(listed(http)) == {live.id, gone.id}


def test_archiving_is_audited_and_repeating_it_changes_nothing(db, http):
    t = make(db)
    first = http.post(f"{BASE}/{t.id}/archive").json()["archived_at"]
    assert http.post(f"{BASE}/{t.id}/archive").json()["archived_at"] == first
    http.post(f"{BASE}/{t.id}/restore")
    rows = db.query(TPRAAuditLog).filter_by(entity="questionnaire_template", entity_id=t.id).order_by(TPRAAuditLog.id).all()
    assert [r.action for r in rows] == ["archive", "restore"]


def test_an_archived_questionnaire_cannot_be_sent_until_it_is_restored(db, http):
    t = make(db)
    v = Vendor(tenant_id=1, name="Acme Cloud", status="active", primary_contact_email="sam@supplier.test")
    db.add(v)
    db.commit()
    http.post(f"{BASE}/{t.id}/archive")
    refused = http.post("/vendor-risk/questionnaires/send", json={"vendor_id": v.id, "template_id": t.id})
    assert refused.status_code == 409 and "archived" in refused.json()["detail"]
    http.post(f"{BASE}/{t.id}/restore")
    assert http.post("/vendor-risk/questionnaires/send", json={"vendor_id": v.id, "template_id": t.id}).status_code == 201


def test_one_already_sent_can_still_be_sent_again_after_the_questionnaire_is_archived(db, http):
    t = make(db)
    _, qr = sent(db, t)
    http.post(f"{BASE}/{t.id}/archive")
    again = http.post(f"/vendor-risk/questionnaire-responses/{qr.id}/resend")
    assert again.status_code == 200, again.text
    assert versions.questions_for(db, qr)[0]["text"] == "Is MFA enforced?"       # the version it was sent on, untouched


def test_an_archived_questionnaire_is_read_only(db, http):
    t = make(db)
    http.post(f"{BASE}/{t.id}/archive")
    for change in ({"name": "New name"}, {"description": "x"}, {"questions": []}, {"category": "privacy"}):
        refused = http.put(f"{BASE}/{t.id}", json=change)
        assert refused.status_code == 409 and "Restore" in refused.json()["detail"], change
    assert http.put(f"{BASE}/{t.id}", json={"default_tiers": ["high"]}).status_code == 409
    db.refresh(t)
    assert t.name == "Security" and len(t.questions) == 4


def test_a_follow_up_to_an_archived_questionnaire_is_not_sent(db):
    parent = make(db, "Parent", questions=[{"id": "q", "text": "Q?", "type": "yes_no",
                                            "follow_up": {"when": ["yes"], "template_id": 0}}])
    child = make(db, "Child")
    parent.questions = [{**parent.questions[0], "follow_up": {"when": ["yes"], "template_id": child.id}}]
    _, qr = sent(db, parent)
    qr.responses = {"q": "yes"}
    child.archived_at = datetime.utcnow()
    db.commit()
    assert follow_ups.send(db, qr, parent.questions, 7) == []
    child.archived_at = None
    db.commit()
    assert len(follow_ups.send(db, qr, parent.questions, 7)) == 1


def test_a_planned_send_of_an_archived_questionnaire_is_refused(db, http):
    from grc.modules.vendor_risk.tpra import action_plans

    t = make(db)
    t.archived_at = datetime.utcnow()
    db.commit()
    with pytest.raises(Exception, match="archived"):
        action_plans._template(db, 1, t.id)


# ── delete ───────────────────────────────────────────────────────────────────

def test_one_that_was_ever_sent_can_only_be_archived(db, http):
    used, unused = make(db, "Used"), make(db, "Unused")
    sent(db, used)
    refused = http.delete(f"{BASE}/{used.id}")
    assert refused.status_code == 409 and "Archive" in refused.json()["detail"]
    assert http.delete(f"{BASE}/{unused.id}").status_code == 200
    assert db.get(VendorQuestionnaireTemplate, used.id) is not None and db.get(VendorQuestionnaireTemplate, unused.id) is None


def test_one_an_assessment_or_the_scoring_records_point_at_is_not_deleted_either(db, http):
    chosen, scored, planned = make(db, "Chosen"), make(db, "Scored"), make(db, "Planned")
    v = Vendor(tenant_id=1, name="Acme Cloud", status="active")
    db.add(v)
    db.flush()
    db.add(VendorAssessment(tenant_id=1, vendor_id=v.id, template_id=chosen.id, status="draft"))
    db.add(TPRAQuestion(tenant_id=1, template_id=scored.id, question_key="mfa", text="MFA?", domain="cybersecurity",
                        qtype="yes_no"))
    db.add(TPRAActionItem(tenant_id=1, vendor_id=v.id, kind="questionnaire", title="Send it",
                          due_on=datetime.utcnow().date(), template_id=planned.id))
    db.commit()
    for t in (chosen, scored, planned):
        assert http.delete(f"{BASE}/{t.id}").status_code == 409, t.name


def test_deleting_one_takes_it_out_of_the_tiers_that_listed_it(db, http):
    t = make(db)
    db.add(TPRATieringConfig(tenant_id=1, config_key="default", is_active=True,
                             tier_policy={"high": {"template_ids": [t.id, 99]}}))
    db.commit()
    assert http.delete(f"{BASE}/{t.id}").status_code == 200
    assert stored(db)["high"]["template_ids"] == [99]


# ── copy ─────────────────────────────────────────────────────────────────────

def test_a_copy_is_an_editable_questionnaire_of_its_own(db, http):
    t = make(db, description="For banks")
    sent(db, t)
    http.post(f"{BASE}/{t.id}/archive")
    got = http.post(f"{BASE}/{t.id}/duplicate")
    assert got.status_code == 201, got.text
    copy = got.json()
    assert copy["name"] == "Security (copy)" and copy["description"] == "For banks" and copy["archived_at"] is None
    assert copy["id"] != t.id and copy["used"] is False and copy["default_tiers"] == [] and copy["question_count"] == 4
    assert http.put(f"{BASE}/{copy['id']}", json={"questions": copy["questions"][:2]}).status_code == 200
    db.refresh(t)
    assert len(t.questions) == 4                                    # the original is not touched
    assert http.delete(f"{BASE}/{copy['id']}").status_code == 200   # never sent: it can go


def test_a_copy_of_a_long_name_still_fits(db, http):
    t = make(db, "N" * 255)
    assert len(http.post(f"{BASE}/{t.id}/duplicate").json()["name"]) == 255


def test_a_copy_does_not_take_the_original_s_tiers(db, http):
    t = make(db)
    assert http.put(f"{BASE}/{t.id}", json={"default_tiers": ["high"]}).status_code == 200
    assert http.post(f"{BASE}/{t.id}/duplicate").json()["default_tiers"] == []


# ── default for these tiers ──────────────────────────────────────────────────

def test_default_tiers_are_the_tier_policys_own_list(db, http):
    a, b = make(db, "A"), make(db, "B")
    db.add(TPRATieringConfig(tenant_id=1, config_key="default", is_active=True,
                             tier_policy={"high": {"template_ids": [b.id]}}))
    db.commit()
    got = http.put(f"{BASE}/{a.id}", json={"default_tiers": ["critical", "high"]})
    assert got.status_code == 200, got.text
    assert got.json()["default_tiers"] == ["critical", "high"]                 # severity order
    assert stored(db)["critical"]["template_ids"] == [a.id]
    assert stored(db)["high"]["template_ids"] == [b.id, a.id]                  # beside the one already chosen, not instead of it
    assert [t.id for t in tier_policy.templates_for(db, 1, "high", tier_policy.merged(stored(db)))] == [b.id, a.id]
    assert listed(http)[b.id]["default_tiers"] == ["high"]

    assert http.put(f"{BASE}/{a.id}", json={"default_tiers": ["critical"]}).json()["default_tiers"] == ["critical"]
    assert stored(db)["high"]["template_ids"] == [b.id]
    assert http.put(f"{BASE}/{a.id}", json={"default_tiers": []}).json()["default_tiers"] == []
    assert stored(db)["critical"]["template_ids"] == []


def test_a_tier_that_has_none_chosen_shows_the_built_in_suggestion(db, http):
    suggested, other = make(db, "SIG Lite"), make(db, "Mine")
    assert TIER_SUGGESTED_TEMPLATES["low"] == ["SIG Lite"] and "SIG Lite" in TIER_SUGGESTED_TEMPLATES["medium"]
    got = listed(http)
    assert got[suggested.id]["default_tiers"] == ["medium", "low"] and got[other.id]["default_tiers"] == []
    # asking for another one beside it keeps the suggestion: the tier's list is written out in full
    http.put(f"{BASE}/{other.id}", json={"default_tiers": ["low"]})
    assert stored(db)["low"]["template_ids"] == [suggested.id, other.id]
    assert listed(http)[suggested.id]["default_tiers"] == ["medium", "low"]


def test_a_tier_must_be_a_tier(db, http):
    t = make(db)
    assert http.put(f"{BASE}/{t.id}", json={"default_tiers": ["urgent"]}).status_code == 400
    assert http.put(f"{BASE}/{t.id}", json={"default_tiers": ["high", "high"]}).json()["default_tiers"] == ["high"]


def test_changing_the_tiers_needs_the_right_to_change_the_settings_they_live_in(db, http, can):
    t = make(db)
    can.clear()
    can.add("vendor_risk:templates:edit")
    ok = http.put(f"{BASE}/{t.id}", json={"name": "Renamed"})
    assert ok.status_code == 200                                      # no tier change asked for: no settings right needed
    same = http.put(f"{BASE}/{t.id}", json={"name": "Renamed again", "default_tiers": []})
    assert same.status_code == 200                                    # the tiers it already has
    refused = http.put(f"{BASE}/{t.id}", json={"default_tiers": ["high"]})
    assert refused.status_code == 403 and "config" in refused.json()["detail"]
    can.add("vendor_risk:config:edit")
    assert http.put(f"{BASE}/{t.id}", json={"default_tiers": ["high"]}).status_code == 200


def test_archiving_takes_a_questionnaire_out_of_its_tiers(db, http):
    t, keep = make(db, "A"), make(db, "B")
    db.add(TPRATieringConfig(tenant_id=1, config_key="default", is_active=True,
                             tier_policy={"high": {"template_ids": [t.id, keep.id]}, "low": {"template_ids": [t.id]}}))
    db.commit()
    assert http.post(f"{BASE}/{t.id}/archive").json()["default_tiers"] == []
    assert stored(db)["high"]["template_ids"] == [keep.id] and stored(db)["low"]["template_ids"] == []
    http.post(f"{BASE}/{t.id}/restore")
    assert listed(http)[t.id]["default_tiers"] == []                 # restoring does not give the tiers back


def test_the_built_in_suggestion_never_offers_an_archived_questionnaire(db):
    t = make(db, TIER_SUGGESTED_TEMPLATES["low"][0])
    policy = tier_policy.merged({})
    assert [x.id for x in tier_policy.templates_for(db, 1, "low", policy)] == [t.id]
    t.archived_at = datetime.utcnow()
    db.commit()
    assert tier_policy.templates_for(db, 1, "low", policy) == []
    policy = tier_policy.merged({"low": {"template_ids": [t.id]}})
    assert tier_policy.templates_for(db, 1, "low", policy) == []


# ── the guards ───────────────────────────────────────────────────────────────

def test_each_new_write_asks_for_its_right(db, http, can):
    t = make(db)
    can.clear()
    for method, url in (("post", f"{BASE}/{t.id}/archive"), ("post", f"{BASE}/{t.id}/restore"),
                        ("post", f"{BASE}/{t.id}/duplicate")):
        assert getattr(http, method)(url).status_code == 403, url
    can.add("vendor_risk:templates:edit")
    assert http.post(f"{BASE}/{t.id}/archive").status_code == 200
    assert http.post(f"{BASE}/{t.id}/duplicate").status_code == 403              # a copy is a create
    can.add("vendor_risk:templates:create")
    assert http.post(f"{BASE}/{t.id}/duplicate").status_code == 201


def test_another_tenants_questionnaire_is_not_found(db, http):
    db.add(Tenant(id=2, name="Other", slug="other"))
    db.commit()
    other = VendorQuestionnaireTemplate(tenant_id=2, name="Theirs", questions=[])
    db.add(other)
    db.commit()
    # the one-tenant-per-database rule means the user's tenant list is [1]; a template of tenant 2 is out of reach
    for method, url in (("get", f"{BASE}/{other.id}"), ("post", f"{BASE}/{other.id}/archive"),
                        ("post", f"{BASE}/{other.id}/duplicate")):
        assert getattr(http, method)(url).status_code == 404, url
