"""TPRM hardening, piece F2 (2026-10-29): alert rules, offboarding closes the door, the
duplicate check, the register's next action, and the engagement hand-over items.

A tenant with no alert rules gets exactly what a signal always set off; its rules add
to that, in order. Offboarding stops every portal link of the supplier and expires its
unanswered questionnaires however it starts, and completing it archives the supplier.
A duplicate is found through case, punctuation, legal forms and www., archived ones
included and said so. The register gives each supplier one next action. A hand edit
of a split supplier's tier is General's, and reminders, the queue and the action plan
name the engagement they are about. In-memory SQLite.
"""
import io
from datetime import datetime, time, timedelta

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from grc.models import (
    Base, Evidence, GRCUser, Role, Tenant, TPRAActionItem, TPRAAlertRule, TPRAAuditLog, TPRAEngagement,
    TPRAEvidenceLink, TPRAPortalToken, TPRAReminder, UserRole, Vendor, VendorAssessment, VendorQuestionnaireResponse,
    VendorQuestionnaireTemplate, get_db,
)
from grc.modules.vendor_risk.routers import lifecycle, monitoring as monitoring_routes, vendors as vendor_routes
from grc.modules.vendor_risk.tpra import (
    action_plans, alert_rules, attention, contacts, engagements, intake, monitoring, onboarding, reminders, service,
)
from grc.modules.vendor_risk.tpra.bootstrap import DEFAULT_TIERING_CONFIG
from grc.modules.vendor_risk.tpra.engine_tiering import FACTOR_KEYS
from grc.routers.auth_router import require_auth

OWNER, ADMIN, CISO, RISK, NOBODY = 7, 70, 71, 72, 90
TODAY = datetime.utcnow().date()
POLICY = {**DEFAULT_TIERING_CONFIG["reminder_policy"], "enabled": True}


@pytest.fixture()
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    s = sessionmaker(bind=engine)()
    s.add(Tenant(id=1, name="Acme Bank", slug="acme"))
    s.add_all([Role(id=1, name="Administrator"), Role(id=2, name="Risk team")])
    s.add_all([GRCUser(id=uid, username=f"u{uid}", email=f"u{uid}@acme.test", is_active=True)
               for uid in (OWNER, ADMIN, CISO, RISK, NOBODY)])
    s.add_all([UserRole(user_id=ADMIN, role_id=1, tenant_id=1), UserRole(user_id=RISK, role_id=2, tenant_id=1)])
    s.commit()
    yield s
    s.close()


@pytest.fixture()
def told(monkeypatch):
    """People an alert rule tells, recorded instead of sent: (user, subject)."""
    box = []
    monkeypatch.setattr(alert_rules, "deliver", lambda db, tid, uid, subject, message: box.append((uid, subject)))
    return box


def _user(db, uid):
    return db.get(GRCUser, uid)


def _vendor(db, name="Payroll Co", **kw):
    v = Vendor(**{"tenant_id": 1, "name": name, "tier": "high", "status": "active", "owner_id": OWNER,
                  "data_access_level": "internal", **kw})
    db.add(v)
    db.commit()
    return v


def _rule(db, **kw):
    return alert_rules.create_rule(alert_rules.RuleIn(**kw), db=db, user=_user(db, ADMIN))


def _signal(db, v, kind="sla", severity="medium", **kw):
    sig, triggered, _ = monitoring.record_signal(db, v, signal_type=kind, severity=severity,
                                                 title=kw.pop("title", f"{kind} on {v.name}"), actor_id=ADMIN, **kw)
    db.commit()
    return sig, triggered


def _versions(db, v, engagement=None):
    q = db.query(VendorAssessment).filter(VendorAssessment.vendor_id == v.id)
    q = q.filter(VendorAssessment.engagement_id == engagement.id) if engagement else q.filter(
        VendorAssessment.engagement_id.is_(None))
    return sorted(a.version_no for a in q)


def _fired(db):
    return [(r.entity_id, r.to_value) for r in db.query(TPRAAuditLog).filter(
        TPRAAuditLog.entity == "alert_rule", TPRAAuditLog.action == "fire").order_by(TPRAAuditLog.id)]


# ── 1. alert rules ───────────────────────────────────────────────────────────

def test_with_no_rules_a_signal_does_what_it_always_did(db, told):
    v = _vendor(db, tier="high")                                       # a high tier reopens from high
    service.ensure_active_assessment(db, v, actor_id=ADMIN)
    db.commit()
    _signal(db, v, severity="medium")
    assert _versions(db, v) == [1]
    _, triggered = _signal(db, v, severity="high")
    assert _versions(db, v) == [1, 2] and triggered == db.query(VendorAssessment).filter_by(version_no=2).one().id
    assert told == [] and _fired(db) == [] and db.query(TPRAActionItem).count() == 0

    listed = alert_rules.list_rules(db=db, user=_user(db, NOBODY))
    assert listed["items"] == []
    email, reopen = listed["builtin"]
    assert (email["action"], email["min_severity"], email["targets"]) == ("notify", "high", [])
    assert reopen["reassess_on"] == {"low": "critical", "medium": "high", "high": "high", "critical": "medium"}
    assert reopen["always"] == ["breach"]


def test_a_rule_reopens_where_the_tier_alone_would_not(db, told):
    low = _vendor(db, "Print Co", tier="low")                          # a low tier reopens only from critical
    service.ensure_active_assessment(db, low, actor_id=ADMIN)
    db.commit()
    _signal(db, low, kind="sla", severity="medium")
    assert _versions(db, low) == [1]
    rule = _rule(db, name="Missed SLAs reopen low suppliers", action="open_reassessment", tiers=["low"],
                 signal_kinds=["sla"], min_severity="medium")
    _signal(db, low, kind="adverse_media", severity="medium")         # another kind: not this rule's
    assert _versions(db, low) == [1]
    _signal(db, low, kind="sla", severity="medium")
    assert _versions(db, low) == [1, 2]
    opened = db.query(TPRAAuditLog).filter_by(entity="assessment", action="create").order_by(TPRAAuditLog.id.desc()).first()
    assert opened.reason == "Alert rule “Missed SLAs reopen low suppliers”: sla signal"
    _signal(db, low, kind="sla", severity="high")                     # one already open is joined, not restarted
    assert _versions(db, low) == [1, 2]
    assert _fired(db) == [(rule["id"], "open_reassessment")] * 2


def test_a_signal_reopens_by_the_tier_policy_the_assessment_was_tiered_under(db, told):
    """The reopen threshold follows the scope's own policy snapshot (F1), not today's settings."""
    held = _vendor(db, "Held Co", tier="low")                          # today's policy: low reopens only from critical
    a = service.ensure_active_assessment(db, held, actor_id=ADMIN)
    a.policy_snapshot = {"tier_policy": {"low": {"reassess_on": "medium"}}}   # tiered when medium was enough
    live = _vendor(db, "Live Co", tier="low")
    service.ensure_active_assessment(db, live, actor_id=ADMIN)
    db.commit()
    _signal(db, held, kind="sla", severity="medium")
    _signal(db, live, kind="sla", severity="medium")
    assert (_versions(db, held), _versions(db, live)) == ([1, 2], [1])


def test_bringing_forward_moves_the_date_to_today_and_opens_nothing(db, told):
    later = datetime.utcnow() + timedelta(days=200)
    v = _vendor(db, tier="medium", next_reassessment_date=later)       # a medium tier reopens from high
    service.ensure_active_assessment(db, v, actor_id=ADMIN)
    v.next_reassessment_date = later
    db.commit()
    _rule(db, name="Look again soon", action="bring_forward_reassessment", min_severity="medium")
    _signal(db, v, severity="medium")
    db.refresh(v)
    assert v.next_reassessment_date.date() == TODAY and _versions(db, v) == [1]
    moved = db.query(TPRAAuditLog).filter_by(entity="reassessment", action="bring_forward").one()
    assert (moved.from_value, moved.to_value) == (later.date().isoformat(), TODAY.isoformat())
    _signal(db, v, severity="medium", title="again")                  # already due today: nothing moves
    assert db.query(TPRAAuditLog).filter_by(entity="reassessment", action="bring_forward").count() == 1

    _signal(db, v, severity="high", title="serious")                  # reopened: the new cycle keeps its own date
    db.refresh(v)
    assert _versions(db, v) == [1, 2] and v.next_reassessment_date.date() > TODAY


def test_telling_people_reaches_the_owner_the_named_and_the_roles_once(db, told):
    v = _vendor(db, tier="high")
    _rule(db, name="Tell the CISO", action="notify", min_severity="high", notify_user_ids=[CISO],
          notify_roles=["Risk team"])
    _rule(db, name="Tell the CISO again", action="notify", min_severity="medium", notify_user_ids=[CISO])
    sig, _ = _signal(db, v, kind="breach", severity="high", title="Customer data exposed")
    assert sorted(uid for uid, _ in told) == [OWNER, CISO, RISK]       # once each, whichever rule told them
    assert told[0][1] == "New high alert on Payroll Co: Customer data exposed"
    assert db.query(TPRAReminder).filter_by(kind="alert_new", subject_id=sig.id).count() == 3

    swept = []                                                         # the daily alert email skips them
    out = reminders.run(db, 1, POLICY, today=TODAY, deliver=lambda db, tid, uid, s, m: swept.append(uid))
    assert OWNER not in swept and out["already_sent"] >= 1

    _signal(db, v, severity="low", title="minor")                     # below both rules
    assert len(told) == 3


def test_a_to_do_is_planned_for_the_people_named_or_the_owner(db, told):
    v = _vendor(db, tier="high")
    _rule(db, name="Breaches get a to-do", action="create_task", signal_kinds=["breach"], min_severity="low",
          notify_user_ids=[CISO])
    _signal(db, v, kind="sla", severity="critical")
    assert db.query(TPRAActionItem).count() == 0
    _signal(db, v, kind="breach", severity="medium", title="Laptop stolen", detail="Unencrypted disk.")
    todo = db.query(TPRAActionItem).one()
    assert (todo.kind, todo.status, todo.due_on, todo.assignee_ids, todo.title) == (
        "todo", "scheduled", TODAY, [CISO], "Look into: Laptop stolen")
    assert "Breaches get a to-do" in todo.note and "Unencrypted disk." in todo.note
    item = next(i for i in attention.open_items(db, 1, TODAY, POLICY) if i["condition"] == "action_due")
    assert item["people"] == [CISO]


def test_rules_go_by_each_engagements_tier_and_skip_what_they_are_not_for(db, told):
    v = _vendor(db, tier="medium")
    payroll = db.get(TPRAEngagement, engagements.create_engagement(
        v.id, engagements.EngagementIn(name="Payroll"), db=db, user=_user(db, ADMIN))["id"])
    payroll.tier = "critical"
    db.commit()
    rule = _rule(db, name="Critical use", action="notify", tiers=["critical"], min_severity="medium")
    _signal(db, v, severity="medium")                                 # General is medium, Payroll critical
    assert [uid for uid, _ in told] == [OWNER]

    alert_rules.update_rule(rule["id"], alert_rules.RuleIn(enabled=False), db=db, user=_user(db, ADMIN))
    _signal(db, v, severity="high", title="off")
    _signal(db, v, severity="critical", title="unverified", verification={"verified": False})
    assert len(told) == 1

    alert_rules.update_rule(rule["id"], alert_rules.RuleIn(enabled=True), db=db, user=_user(db, ADMIN))
    v.status = "offboarded"                                            # a supplier out of use sets nothing off
    db.commit()
    _signal(db, v, severity="critical", title="after")
    assert len(told) == 1


def test_rules_act_in_their_order_which_can_be_changed(db, told):
    v = _vendor(db)
    first = _rule(db, name="To-do", action="create_task", min_severity="medium")
    second = _rule(db, name="Tell", action="notify", min_severity="medium")
    _signal(db, v, severity="medium")
    assert [rid for rid, _ in _fired(db)] == [first["id"], second["id"]]
    listed = alert_rules.reorder_rules(alert_rules.OrderIn(ids=[second["id"], first["id"]]), db=db, user=_user(db, ADMIN))
    assert [r["name"] for r in listed["items"]] == ["Tell", "To-do"]
    _signal(db, v, severity="medium", title="again")
    assert [rid for rid, _ in _fired(db)][2:] == [second["id"], first["id"]]


def test_rules_are_checked_and_need_the_settings_right(db):
    with pytest.raises(HTTPException) as kind:
        _rule(db, name="x", action="notify", signal_kinds=["weather"])
    with pytest.raises(HTTPException) as role:
        _rule(db, name="x", action="notify", notify_roles=["Nobody's role"])
    with pytest.raises(HTTPException) as person:
        _rule(db, name="x", action="notify", notify_user_ids=[999])
    with pytest.raises(HTTPException) as nothing:
        _rule(db, name="x")
    with pytest.raises(HTTPException) as denied:
        alert_rules.create_rule(alert_rules.RuleIn(name="x", action="notify"), db=db, user=_user(db, NOBODY))
    assert [e.value.status_code for e in (kind, role, person, nothing, denied)] == [400, 400, 400, 400, 403]
    one = _rule(db, action="notify", min_severity="critical")
    assert (one["name"], one["position"], one["tiers"], one["enabled"]) == ("Tell people from critical", 1, [], True)
    with pytest.raises(HTTPException) as partial:
        alert_rules.reorder_rules(alert_rules.OrderIn(ids=[]), db=db, user=_user(db, ADMIN))
    assert partial.value.status_code == 400
    assert db.query(TPRAAuditLog).filter_by(entity="alert_rule", action="create").count() == 1


# ── 2. offboarding closes the door ───────────────────────────────────────────

def _door(db, v):
    """A contact with two live links, and questionnaires in every state."""
    c = contacts.add(db, v, ADMIN, name="Sam Lee", email="sam@payroll.test")
    contacts.issue(db, c, "invite", ADMIN)
    contacts.issue(db, c, "reminder", ADMIN)
    now = datetime.utcnow()
    qrs = {status: VendorQuestionnaireResponse(tenant_id=1, vendor_id=v.id, token=f"t-{v.id}-{status}", status=status,
                                               expires_at=now + timedelta(days=20))
           for status in ("pending", "in_progress", "returned", "submitted")}
    qrs["lapsed"] = VendorQuestionnaireResponse(tenant_id=1, vendor_id=v.id, token=f"t-{v.id}-lapsed", status="pending",
                                                expires_at=now - timedelta(days=3))
    db.add_all(qrs.values())
    db.commit()
    return qrs


def _live_links(db, v):
    return db.query(TPRAPortalToken).filter(TPRAPortalToken.vendor_id == v.id,
                                            TPRAPortalToken.revoked_at.is_(None)).count()


def test_starting_offboarding_stops_the_links_and_expires_what_is_unanswered(db):
    v = _vendor(db)
    qrs = _door(db, v)
    lapsed_at = qrs["lapsed"].expires_at
    out = lifecycle.begin_offboarding(v.id, lifecycle.OffboardIn(reason="Contract ended"), db=db,
                                      current_user=_user(db, ADMIN))
    db.expire_all()
    now = datetime.utcnow()
    assert v.status == "offboarded" and _live_links(db, v) == 0
    assert out["links_revoked"] == 2 and out["started"] is True
    assert sorted(out["questionnaires_expired"]) == sorted(qrs[s].id for s in ("pending", "in_progress", "returned"))
    assert all(qrs[s].expires_at <= now for s in ("pending", "in_progress", "returned"))
    assert qrs["submitted"].expires_at > now and qrs["lapsed"].expires_at == lapsed_at
    assert [i["item"] for i in out["items"]] == lifecycle.OFFBOARDING_CHECKLIST
    assert lifecycle.CONTRACTS_CLOSED in lifecycle.OFFBOARDING_CHECKLIST
    trail = {(r.entity, r.action) for r in db.query(TPRAAuditLog).filter_by(vendor_id=v.id)}
    assert {("portal_link", "revoke_all"), ("questionnaire", "expire"), ("vendor", "offboard")} <= trail


def test_offboarding_cancels_open_requests_and_the_portal_stays_shut(db):
    """Integration of F2's offboarding with C1's requests and C0's portal: an open request is
    cancelled (a finished one is left), a link issued after the start is refused, and asking
    for a new link by email issues nothing."""
    from starlette.background import BackgroundTasks
    from starlette.requests import Request
    from grc.models import TPRASupplierRequest
    from grc.modules.vendor_risk.tpra import supplier_portal

    v = _vendor(db)
    c = contacts.add(db, v, ADMIN, name="Sam Lee", email="sam@payroll.test")
    live = TPRASupplierRequest(tenant_id=1, vendor_id=v.id, kind="document", title="ISO certificate", status="open")
    done = TPRASupplierRequest(tenant_id=1, vendor_id=v.id, kind="document", title="Old report", status="accepted")
    db.add_all([live, done])
    db.commit()
    out = lifecycle.begin_offboarding(v.id, lifecycle.OffboardIn(reason="Contract ended"), db=db,
                                      current_user=_user(db, ADMIN))
    db.expire_all()
    assert out["requests_cancelled"] == [live.id] and (live.status, done.status) == ("cancelled", "accepted")
    assert ("supplier_request", "cancel") in {(r.entity, r.action) for r in db.query(TPRAAuditLog).filter_by(vendor_id=v.id)}

    ask = Request({"type": "http", "method": "POST", "path": "/", "headers": [], "client": ("203.0.113.9", 5000)})
    raw_token, _ = contacts.issue(db, c, "invite", ADMIN)
    db.commit()
    with pytest.raises(HTTPException) as shut:
        supplier_portal.resolve(db, raw_token, ask)
    assert shut.value.status_code == 410
    before = db.query(TPRAPortalToken).count()
    supplier_portal.request_link(supplier_portal.LinkRequest(email="sam@payroll.test"), ask, BackgroundTasks(), db=db)
    assert db.query(TPRAPortalToken).count() == before


def test_setting_the_status_to_offboarded_closes_the_door_too(db):
    v = _vendor(db)
    _door(db, v)
    vendor_routes.update_vendor(v.id, vendor_routes.VendorUpdate(status="offboarded"), db=db,
                                current_user=_user(db, ADMIN))
    db.expire_all()
    assert v.status == "offboarded" and _live_links(db, v) == 0
    offboard = db.query(TPRAAuditLog).filter_by(entity="vendor", action="offboard").one()
    assert (offboard.from_value, offboard.to_value) == ("active", "offboarded")
    assert lifecycle.CONTRACTS_CLOSED in [i["item"] for i in v.offboarding_checklist]


def test_completing_offboarding_archives_the_supplier_once_every_step_is_done(db):
    v = _vendor(db)
    admin = _user(db, ADMIN)
    with pytest.raises(HTTPException) as early:
        lifecycle.complete_offboarding(v.id, db=db, current_user=admin)
    lifecycle.begin_offboarding(v.id, lifecycle.OffboardIn(), db=db, current_user=admin)
    with pytest.raises(HTTPException) as open_steps:
        lifecycle.complete_offboarding(v.id, db=db, current_user=admin)
    assert (early.value.status_code, open_steps.value.status_code) == (400, 409)
    assert lifecycle.CONTRACTS_CLOSED in open_steps.value.detail["open"]
    items = lifecycle.get_offboarding(v.id, db=db, current_user=admin)["items"]
    lifecycle.update_offboarding(v.id, lifecycle.OffboardingUpdate(items=[{**i, "done": True} for i in items]),
                                 db=db, current_user=admin)
    with pytest.raises(HTTPException) as denied:
        lifecycle.complete_offboarding(v.id, db=db, current_user=_user(db, NOBODY))
    assert denied.value.status_code == 403
    out = lifecycle.complete_offboarding(v.id, db=db, current_user=admin)
    assert out["archived_at"] is not None
    archive = db.query(TPRAAuditLog).filter_by(entity="vendor", action="archive").one()
    assert archive.reason == "Offboarding complete"


def test_ending_an_engagement_leaves_the_suppliers_links_alone(db):
    v = _vendor(db)
    _door(db, v)
    payroll = engagements.create_engagement(v.id, engagements.EngagementIn(name="Payroll"), db=db, user=_user(db, ADMIN))
    engagements.end_engagement(payroll["id"], engagements.EndIn(reason="Moved in house"), db=db, user=_user(db, ADMIN))
    assert _live_links(db, v) == 2 and v.status == "active"


# ── 3. the duplicate check ───────────────────────────────────────────────────

def test_names_are_compared_without_case_punctuation_or_legal_form():
    same = [("Acme, Inc.", "ACME Ltd"), ("Acme Limited", "acme"), ("A.C.M.E. Pvt. Ltd.", "Acme Private Limited"),
            ("Gulf Logistics FZ-LLC", "gulf logistics fz"), ("Oman Telecom SAOG", "Oman Telecom"),
            ("Acme-Corp", "Acme corp."), ("Deutsche Daten GmbH", "Deutsche Daten AG")]
    assert all(intake.name_key(a) == intake.name_key(b) for a, b in same)
    assert intake.name_key("Acme Cloud") != intake.name_key("Acme")
    assert intake.name_key("Co") == "co"                               # a name that is only a legal form stays


def test_adding_a_supplier_finds_one_on_record_by_name_or_website_archived_too(db):
    _vendor(db, "Acme Ltd", website="https://www.acme.com/about")
    _vendor(db, "Old Co PJSC", deleted_at=datetime.utcnow())
    admin = _user(db, ADMIN)

    def add(name, website=None, **kw):
        try:
            return vendor_routes.create_vendor(vendor_routes.VendorCreate(name=name, website=website, **kw),
                                               db=db, current_user=admin)
        except HTTPException as exc:
            return exc

    assert "already exists" in add("ACME, Inc.").detail
    assert "already exists" in add("Something else", website="acme.com").detail
    assert "is archived" in add("old co").detail
    assert add("Acme Cloud", website="cloud.acme.io")["name"] == "Acme Cloud"
    assert add("ACME Ltd.", allow_duplicate=True)["id"]                # a genuine second relationship


def test_a_request_finds_one_on_record_and_says_when_it_is_archived(db):
    _vendor(db, "Acme Ltd", website="https://www.acme.com")
    _vendor(db, "Old Co", deleted_at=datetime.utcnow())
    with pytest.raises(HTTPException) as live:
        onboarding.create_request(onboarding.NewRequest(name="ACME limited"), db=db, user=_user(db, ADMIN))
    with pytest.raises(HTTPException) as site:
        onboarding.create_request(onboarding.NewRequest(name="Other", website="http://acme.com/x"), db=db,
                                  user=_user(db, ADMIN))
    with pytest.raises(HTTPException) as archived:
        onboarding.create_request(onboarding.NewRequest(name="Old Co LLC"), db=db, user=_user(db, ADMIN))
    assert "open it instead" in live.value.detail and "open it instead" in site.value.detail
    assert "archived" in archived.value.detail and "restore it" in archived.value.detail


# ── 4. the register: one next action, and open engagements ─────────────────

def test_the_register_gives_each_supplier_the_first_next_action_that_holds(db):
    past, soon, later = (datetime.utcnow() + timedelta(days=d) for d in (-5, 10, 90))
    tiered = {"inherent_risk_score": 50.0, "next_reassessment_date": later}
    rows = {
        "suspended": _vendor(db, "S", status="suspended", next_reassessment_date=past),
        "reassessment_overdue": _vendor(db, "O", next_reassessment_date=past),           # untiered too
        "not_tiered": _vendor(db, "T"),
        "awaiting_approval": _vendor(db, "A", **tiered),
        "response_to_review": _vendor(db, "R", **tiered),
        "documents_expired": _vendor(db, "D", **tiered),
        "weak_grade": _vendor(db, "W", **tiered),
        "no_owner": _vendor(db, "N", **{**tiered, "owner_id": None}),
        "reassessment_due": _vendor(db, "U", **{**tiered, "next_reassessment_date": soon}),
        "offboarding": _vendor(db, "F", status="offboarded", next_reassessment_date=past),
        None: _vendor(db, "Fine", **tiered),
    }
    db.add_all([
        VendorAssessment(tenant_id=1, vendor_id=rows["awaiting_approval"].id, status="in_progress",
                         lifecycle_status="active", current_stage="approval", rating_grade="F", version_no=1),
        VendorAssessment(tenant_id=1, vendor_id=rows["weak_grade"].id, status="in_progress",
                         lifecycle_status="active", current_stage="monitoring", rating_grade="E", version_no=1),
        VendorQuestionnaireResponse(tenant_id=1, vendor_id=rows["response_to_review"].id, token="q1", status="submitted"),
    ])
    ev = Evidence(tenant_id=1, name="SOC 2", expiry_date=datetime.utcnow() - timedelta(days=1), status="approved")
    db.add(ev)
    db.flush()
    db.add(TPRAEvidenceLink(tenant_id=1, vendor_id=rows["documents_expired"].id, evidence_id=ev.id))
    db.commit()

    notes = vendor_routes.register_notes(db, list(rows.values()))
    got = {code: (notes[v.id]["next_action"] or {}).get("code") for code, v in rows.items()}
    assert got == {code: code for code in rows}
    assert notes[rows["weak_grade"].id]["next_action"]["label"] == "Weak grade E"
    assert notes[rows["documents_expired"].id]["next_action"]["link"] == f"/vendor-risk/vendors/{rows['documents_expired'].id}?tab=paperwork"
    assert notes[rows["no_owner"].id]["next_action"]["link"] == f"/vendor-risk/vendors/{rows['no_owner'].id}"


def test_the_register_counts_open_engagements_and_points_at_an_engagements_review(db):
    v = _vendor(db, inherent_risk_score=50.0, next_reassessment_date=datetime.utcnow() + timedelta(days=200))
    admin = _user(db, ADMIN)
    payroll = engagements.create_engagement(v.id, engagements.EngagementIn(name="Payroll"), db=db, user=admin)
    ended = engagements.create_engagement(v.id, engagements.EngagementIn(name="Old use"), db=db, user=admin)
    engagements.end_engagement(ended["id"], engagements.EndIn(reason="Done with it"), db=db, user=admin)
    db.get(TPRAEngagement, payroll["id"]).next_reassessment_date = datetime.utcnow() - timedelta(days=2)
    archived = _vendor(db, "Gone", deleted_at=datetime.utcnow())
    draft = _vendor(db, "Asked for", status="requested", intake_status="draft")
    db.commit()
    notes = vendor_routes.register_notes(db, [v, archived, draft])
    assert notes[v.id]["open_engagements"] == 1
    assert notes[v.id]["next_action"] == {
        "code": "reassessment_overdue", "label": "Reassessment overdue",
        "link": f"/vendor-risk/vendors/{v.id}?stage=reassessment&engagement={payroll['id']}"}
    assert notes[archived.id]["next_action"] is None and notes[draft.id]["next_action"] is None


@pytest.fixture()
def api(db):
    app = FastAPI()
    app.include_router(vendor_routes.router, prefix="/vendor-risk")
    app.include_router(onboarding.router, prefix="/vendor-risk")
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[require_auth] = lambda: db.get(GRCUser, ADMIN)
    return TestClient(app)


def test_the_register_payload_gains_the_next_action_engagements_and_active_assessment(db, api):
    v = _vendor(db)
    a = service.ensure_active_assessment(db, v, actor_id=ADMIN)
    db.commit()
    row = api.get("/vendor-risk/vendors").json()["items"][0]
    assert (row["active_assessment_id"], row["open_engagements"], row["next_action"]["code"]) == (a.id, 0, "not_tiered")
    assert api.get(f"/vendor-risk/vendors/{v.id}").json()["active_assessment_id"] == a.id


# ── 5. the engagement hand-over ──────────────────────────────────────────────

def test_a_hand_edit_of_a_split_suppliers_tier_and_scores_is_generals(db):
    v = _vendor(db, tier="medium")
    engagements.create_engagement(v.id, engagements.EngagementIn(name="Payroll"), db=db, user=_user(db, ADMIN))
    vendor_routes.update_vendor(v.id, vendor_routes.VendorUpdate(tier="high", residual_risk_score=30.0,
                                                                 risk_rating="medium"),
                                db=db, current_user=_user(db, ADMIN))
    general = service.general_row(db, v)
    assert (general.tier, general.residual_risk_score, general.risk_rating) == ("high", 30.0, "medium")
    service.recache(db, v)                                             # the next lifecycle write keeps the edit
    assert (v.tier, v.residual_risk_score, v.risk_rating) == ("high", 30.0, "medium")


def test_an_import_sets_generals_tier_and_can_offboard(db, api):
    v = _vendor(db, "Acme Cloud", tier="medium")
    _door(db, v)
    engagements.create_engagement(v.id, engagements.EngagementIn(name="Payroll"), db=db, user=_user(db, ADMIN))
    sheet = io.BytesIO(b"name,tier,status\r\nAcme Cloud,critical,offboarded\r\n")
    r = api.post("/vendor-risk/vendors/import", params={"dry_run": False}, files={"file": ("s.csv", sheet, "text/csv")})
    assert r.status_code == 200, r.text
    db.expire_all()
    assert (service.general_row(db, v).tier, v.tier, v.status) == ("critical", "critical", "offboarded")
    assert _live_links(db, v) == 0


def _engaged(db):
    """A supplier with a Payroll engagement whose assessment was tiered on its facts."""
    v = _vendor(db, tier="medium")
    e = db.get(TPRAEngagement, engagements.create_engagement(
        v.id, engagements.EngagementIn(name="Payroll", data_access_level="confidential"), db=db,
        user=_user(db, ADMIN))["id"])
    a = service.ensure_active_assessment(db, v, actor_id=ADMIN, engagement=e)
    service.run_tiering(db, v, a, actor_id=ADMIN, factors={k: 2 for k in FACTOR_KEYS})
    db.commit()
    return v, e, a


def test_retier_items_and_reminders_name_the_engagement_and_open_it(db):
    v, e, a = _engaged(db)
    e.data_access_level = "restricted"                                  # the engagement's facts moved
    service.record_tier_override(db, v, a, "critical", "The board said so", ADMIN)
    db.commit()
    items = {i["condition"]: i for i in attention.open_items(db, 1, TODAY, POLICY) if i["record_id"] == a.id}
    link = f"/vendor-risk/vendors/{v.id}?stage=tiering&engagement={e.id}"
    assert items["retier_needed"]["link"] == link and items["retier_needed"]["title"].startswith("Payroll Co — Payroll may")
    assert items["tier_overridden"]["link"] == link and items["tier_overridden"]["title"].startswith("Payroll Co — Payroll's tier")
    notice = next(n for n in reminders.due_notices(db, 1, TODAY, POLICY) if n.kind == "retier_needed")
    assert notice.link == link and notice.title.startswith("Payroll Co — Payroll may need re-tiering")


def test_a_planned_reassessment_or_questionnaire_goes_to_its_engagement(db):
    v, e, a = _engaged(db)
    v.primary_contact_email, v.primary_contact_name = "sam@payroll.test", "Sam Lee"
    template = VendorQuestionnaireTemplate(tenant_id=1, name="Security", questions=[])
    db.add(template)
    db.commit()
    admin = _user(db, ADMIN)
    reassess = action_plans.plan(v.id, action_plans.ActionIn(kind="reassessment", due_on=TODAY, engagement_id=e.id),
                                 db=db, user=admin)
    send = action_plans.plan(v.id, action_plans.ActionIn(kind="questionnaire", due_on=TODAY, template_id=template.id,
                                                         engagement_id=e.id), db=db, user=admin)
    todo = action_plans.plan(v.id, action_plans.ActionIn(kind="todo", title="Call", due_on=TODAY, engagement_id=e.id),
                             db=db, user=admin)
    assert reassess["engagement"] == {"id": e.id, "name": "Payroll"} and todo["engagement"] is None
    sent = []
    assert action_plans.fire_due(db, 1, TODAY, invite=lambda db, qr: sent.append(qr)) == {"done": 2, "failed": 0}
    assert _versions(db, v, e) == [1, 2] and _versions(db, v) == []      # General untouched
    assert db.get(VendorAssessment, sent[0].assessment_id).engagement_id == e.id
    assert db.get(TPRAActionItem, reassess["id"]).result_link.endswith(f"&engagement={e.id}")

    engagements.end_engagement(e.id, engagements.EndIn(reason="Moved in house"), db=db, user=admin)
    with pytest.raises(HTTPException) as ended:
        action_plans.plan(v.id, action_plans.ActionIn(kind="reassessment", due_on=TODAY, engagement_id=e.id),
                          db=db, user=admin)
    assert ended.value.status_code == 400
    late = TPRAActionItem(tenant_id=1, vendor_id=v.id, kind="reassessment", title="Again", due_on=TODAY,
                          status="scheduled", engagement_id=e.id)
    db.add(late)
    db.commit()
    action_plans.fire_due(db, 1, TODAY)
    assert (late.status, late.result) == ("failed", "This could not happen: the engagement “Payroll” has ended.")


# ── 6. bugs along the way ────────────────────────────────────────────────────

def test_an_archived_suppliers_monitoring_is_read_but_never_written(db):
    v = _vendor(db, deleted_at=datetime.utcnow())
    admin = _user(db, ADMIN)
    with pytest.raises(HTTPException) as sla:
        monitoring_routes.create_sla_record(v.id, monitoring_routes.SLARecordCreate(sla_metric="Uptime"), db=db,
                                            current_user=admin)
    with pytest.raises(HTTPException) as incident:
        monitoring_routes.create_incident(v.id, monitoring_routes.IncidentCreate(title="Outage"), db=db,
                                          current_user=admin)
    assert (sla.value.status_code, incident.value.status_code) == (409, 409)
    listed = monitoring_routes.list_sla_records(v.id, measurement_period=None, is_compliant=None, skip=0, limit=100,
                                                db=db, current_user=admin)
    assert listed["items"] == []
