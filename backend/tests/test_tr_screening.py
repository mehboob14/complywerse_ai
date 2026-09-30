"""World-Check One screening (Phase 1): vendors + key people, analyst resolution,
findings / gate behaviour, sync-back, auto-screen hook isolation, RBAC.

SQLite-backed like the TPRA integration suite; the simulated provider stands in
for World-Check One, and httpx.MockTransport for the live v2 API.
"""
import json

import httpx
import pytest
from cryptography.fernet import Fernet
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from grc.models import (
    Base, Tenant, GRCUser, Role, Permission, RolePermission, UserRole, Risk,
    Vendor, VendorAssessment, VendorQuestionnaireTemplate, VendorQuestionnaireResponse,
    TPRAStageInstance, TPRAQuestion, TPRAQuestionResponse, TPRAFinding, TPRARemediation,
    TPRARiskAcceptance, TPRAContract, TPRAControlObligation, TPRAApproval, TPRAMonitoringSignal,
    TPRAAuditLog, TPRATieringConfig, TPRARiskDomain, TPRAEvidenceLink, TPRARiskSnapshot,
    TRProviderConnection, TPRAVendorPerson, TPRAScreeningSubject, TPRAScreeningMatch,
    TPRAEnrichmentReport, TR_PROVIDER_WC1,
)
from grc.integrations_tr import connections, http as trhttp
from grc.modules.vendor_risk.tpra import service, screening, screening_api

_TABLES = [
    Tenant, GRCUser, Role, Permission, RolePermission, UserRole, Risk,
    Vendor, VendorAssessment, VendorQuestionnaireTemplate, VendorQuestionnaireResponse,
    TPRAStageInstance, TPRAQuestion, TPRAQuestionResponse, TPRAFinding, TPRARemediation,
    TPRARiskAcceptance, TPRAContract, TPRAControlObligation, TPRAApproval, TPRAMonitoringSignal,
    TPRAAuditLog, TPRATieringConfig, TPRARiskDomain, TPRAEvidenceLink, TPRARiskSnapshot,
    TRProviderConnection, TPRAVendorPerson, TPRAScreeningSubject, TPRAScreeningMatch,
    TPRAEnrichmentReport,
]


@pytest.fixture()
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine, tables=[m.__table__ for m in _TABLES])
    s = sessionmaker(bind=engine)()
    s.add(Tenant(id=1, name="Acme", slug="acme"))
    s.commit()
    yield s
    s.close()


@pytest.fixture(autouse=True)
def _reset_transport():
    yield
    trhttp.set_transport(None)


def _sim(db, **cfg):
    conn = connections.upsert_connection(db, 1, TR_PROVIDER_WC1, mode="simulated", config_in=cfg or None)
    db.commit()
    return conn


def _vendor(db, name="Kestrel Maritime Holdings", tier="high", **kw):
    d = dict(tenant_id=1, name=name, tier=tier, status="active", owner_id=7,
             data_access_level="confidential", data_types_accessed=["PII"])
    d.update(kw)
    v = Vendor(**d)
    db.add(v)
    db.commit()
    return v


def _person(db, v, name, **kw):
    p = TPRAVendorPerson(tenant_id=1, vendor_id=v.id, full_name=name, role="director", **kw)
    db.add(p)
    db.commit()
    return p


def _user(db, uid, admin=False, perms=()):
    u = GRCUser(id=uid, username=f"u{uid}", email=f"u{uid}@acme.test")
    db.add(u)
    db.flush()
    if admin or perms:
        role = Role(name="Administrator" if admin else f"r{uid}")
        db.add(role)
        db.flush()
        db.add(UserRole(user_id=uid, role_id=role.id, tenant_id=1))
        for name in perms:
            perm = Permission(name=name, resource=name.rsplit(":", 1)[0], action=name.rsplit(":", 1)[1])
            db.add(perm)
            db.flush()
            db.add(RolePermission(role_id=role.id, permission_id=perm.id))
    db.commit()
    return u


def _matches(db, v, **filters):
    q = db.query(TPRAScreeningMatch).filter(TPRAScreeningMatch.vendor_id == v.id)
    for k, val in filters.items():
        q = q.filter(getattr(TPRAScreeningMatch, k) == val)
    return q.all()


# ── screening ────────────────────────────────────────────────────────────────

def test_not_configured_raises(db):
    v = _vendor(db)
    with pytest.raises(connections.NotConfigured):
        screening.screen_vendor(db, v)


def test_screens_vendor_and_key_people(db):
    _sim(db)
    v = _vendor(db)
    _person(db, v, "Doralee Pepper", nationality="LTV", date_of_birth="1970-02-03")
    _person(db, v, "Excluded Person", include_in_screening=False)
    out = screening.screen_vendor(db, v, actor_id=1)
    db.commit()
    assert out["screened"] == 2 and out["simulated"] is True and out["errors"] == 0
    subjects = db.query(TPRAScreeningSubject).filter(TPRAScreeningSubject.deleted_at.is_(None)).all()
    assert {s.entity_type for s in subjects} == {"ORGANISATION", "INDIVIDUAL"}
    assert all(s.status == "potential_matches" and s.simulated for s in subjects)
    # high tier is in the default ongoing tiers (decision E) → ongoing enabled.
    assert all(s.ongoing_screening for s in subjects)
    person_subject = [s for s in subjects if s.entity_type == "INDIVIDUAL"][0]
    assert {"typeId": "SFCT_2", "dateTimeValue": "1970-02-03"} in person_subject.secondary_fields
    classes = {m.hit_class for m in _matches(db, v)}
    assert {"sanctions", "pep"} <= classes
    sanc = _matches(db, v, hit_class="sanctions")[0]
    assert sanc.match_strength == "EXACT" and sanc.resolution_status == "unresolved" and sanc.simulated


def test_ongoing_not_enabled_for_low_tier(db):
    _sim(db)
    v = _vendor(db, tier="low")
    screening.screen_vendor(db, v)
    assert not any(s.ongoing_screening for s in db.query(TPRAScreeningSubject).all())


def test_rescreen_is_idempotent_and_keeps_resolution(db):
    _sim(db)
    v = _vendor(db)
    screening.screen_vendor(db, v)
    m = _matches(db, v, hit_class="sanctions")[0]
    screening.resolve_match(db, m, status="possible", actor_id=1)
    n_before = len(_matches(db, v))
    out = screening.screen_vendor(db, v)
    assert out["new_matches"] == 0 and len(_matches(db, v)) == n_before
    assert db.get(TPRAScreeningMatch, m.id).resolution_status == "possible"


def test_identity_change_resets_case(db):
    _sim(db)
    v = _vendor(db)
    screening.screen_vendor(db, v)
    s = db.query(TPRAScreeningSubject).filter(TPRAScreeningSubject.person_id.is_(None)).one()
    assert s.external_case_id
    v.name = "Renamed Vendor Ltd"
    screening.sync_subjects(db, v)
    assert s.external_case_id is None and s.status == "not_screened"


def test_removed_person_subject_retired(db):
    _sim(db)
    v = _vendor(db)
    p = _person(db, v, "Doralee Pepper")
    screening.screen_vendor(db, v)
    p.include_in_screening = False
    active = screening.sync_subjects(db, v)
    assert len(active) == 1
    assert db.query(TPRAScreeningSubject).filter(TPRAScreeningSubject.person_id == p.id).one().deleted_at


# ── resolution → findings → gates ────────────────────────────────────────────

def test_positive_sanctions_creates_blocking_critical_finding(db):
    _sim(db)
    v = _vendor(db)
    screening.screen_vendor(db, v)
    m = _matches(db, v, hit_class="sanctions")[0]
    out = screening.resolve_match(db, m, status="positive", actor_id=1, risk_level="high",
                                  reason="Full match", remark="Registry and address confirmed")
    db.commit()
    f = db.get(TPRAFinding, out["finding_id"])
    assert f.severity == "critical" and f.domain == "compliance" and f.is_critical_control_fail
    assert "SIMULATED" in f.description
    a = service.get_active_assessment(db, v)
    assert service.count_open_critical(db, a.id) == 1
    assert service.evaluate_current(db, v, a, "findings")["passed"] is False
    assert m.sync_status == "synced" and out["synced"] is True
    s = db.get(TPRAScreeningSubject, m.subject_id)
    assert s.status == "confirmed_hit"
    # Re-resolving positive again does not duplicate the finding.
    again = screening.resolve_match(db, m, status="positive", actor_id=1, remark="still true")
    assert again["finding_id"] == f.id


def test_reresolve_false_closes_finding_and_unblocks(db):
    _sim(db)
    v = _vendor(db)
    screening.screen_vendor(db, v)
    m = _matches(db, v, hit_class="sanctions")[0]
    fid = screening.resolve_match(db, m, status="positive", actor_id=1, remark="yes")["finding_id"]
    screening.resolve_match(db, m, status="false", actor_id=1, remark="Different registration number")
    db.commit()
    f = db.get(TPRAFinding, fid)
    assert f.status == "closed"
    a = service.get_active_assessment(db, v)
    assert service.count_open_critical(db, a.id) == 0
    audit = db.query(TPRAAuditLog).filter(TPRAAuditLog.entity == "finding", TPRAAuditLog.to_value == "closed").one()
    assert "re-resolved as FALSE" in audit.reason


def test_remark_required_for_positive_and_false(db):
    _sim(db)
    v = _vendor(db)
    screening.screen_vendor(db, v)
    m = _matches(db, v)[0]
    with pytest.raises(screening.ScreeningError):
        screening.resolve_match(db, m, status="positive", actor_id=1)
    with pytest.raises(screening.ScreeningError):
        screening.resolve_match(db, m, status="bogus", actor_id=1, remark="x")


def test_pep_positive_is_high_and_not_blocking(db):
    _sim(db)
    v = _vendor(db, name="Neutral Supplies Ltd")
    _person(db, v, "Doralee Pepper")
    screening.screen_vendor(db, v)
    m = _matches(db, v, hit_class="pep")[0]
    fid = screening.resolve_match(db, m, status="positive", actor_id=1, remark="PEP confirmed")["finding_id"]
    f = db.get(TPRAFinding, fid)
    assert f.severity == "high" and not f.is_critical_control_fail
    assert service.count_open_critical(db, service.get_active_assessment(db, v).id) == 0


def test_finding_map_override_from_settings(db):
    _sim(db, finding_map={"pep": {"severity": "critical", "domain": "reputational"}})
    v = _vendor(db, name="Neutral Supplies Ltd")
    _person(db, v, "Doralee Pepper")
    screening.screen_vendor(db, v)
    m = _matches(db, v, hit_class="pep")[0]
    f = db.get(TPRAFinding, screening.resolve_match(db, m, status="positive", actor_id=1, remark="x")["finding_id"])
    assert (f.severity, f.domain) == ("critical", "reputational")


def test_unresolved_matches_do_not_block_gates(db):
    _sim(db)
    v = _vendor(db)
    screening.screen_vendor(db, v)
    a = service.ensure_active_assessment(db, v)
    assert _matches(db, v, resolution_status="unresolved")
    assert service.count_open_critical(db, a.id) == 0


def test_positive_sanctions_suspends_onboarded_vendor(db):
    _sim(db)
    v = _vendor(db)
    a = service.ensure_active_assessment(db, v)
    a.current_stage = "monitoring"  # already past the approval gate
    db.commit()
    screening.screen_vendor(db, v)
    m = _matches(db, v, hit_class="sanctions")[0]
    screening.resolve_match(db, m, status="positive", actor_id=1, remark="confirmed")
    assert v.status == "suspended"
    screening.resolve_match(db, m, status="false", actor_id=1, remark="wrong entity")
    assert v.status == "active"


# ── live client: sync failure + retry ────────────────────────────────────────

def _live_conn(db, monkeypatch):
    monkeypatch.setenv("CONNECTOR_MASTER_KEY", Fernet.generate_key().decode())
    conn = connections.upsert_connection(
        db, 1, TR_PROVIDER_WC1, mode="live", base_url_value="https://wc1.test/v2",
        credentials_in={"api_key": "K", "api_secret": "S"}, config_in={"group_id": "grp-1"},
    )
    db.commit()
    return conn


def _wc1_handler(state):
    def handler(req):
        path, method = req.url.path, req.method
        assert req.headers["Authorization"].startswith('Signature keyId="K"')
        if method == "POST" and path == "/v2/cases/screeningRequest":
            body = json.loads(req.content)
            assert body["groupId"] == "grp-1"
            return httpx.Response(200, json={"caseSystemId": "case-1", "results": [{
                "resultId": "res-1", "referenceId": "e-1", "matchStrength": "STRONG",
                "matchedTerm": "Kestrel Maritime", "categories": ["Sanctions"], "providerType": "WATCHLIST",
                "countryLinks": [{"country": {"code": "FRE", "name": "Freedonia"}}],
            }]})
        if method == "PUT" and path == "/v2/cases/case-1/ongoingScreening":
            return httpx.Response(204)
        if method == "GET" and path == "/v2/groups/grp-1/resolutionToolkit":
            return httpx.Response(200, json={"resolutionFields": {
                "statuses": [{"id": "st-pos", "label": "Positive", "type": "POSITIVE"},
                             {"id": "st-false", "label": "False", "type": "FALSE"}],
                "risks": [{"id": "rk-h", "label": "High", "type": "HIGH"}],
                "reasons": [{"id": "rs-full", "label": "Full match"}]}})
        if method == "PUT" and path == "/v2/cases/case-1/results/resolution":
            if state.get("fail_resolve"):
                return httpx.Response(400, text="bad resolution")
            state["resolved"] = json.loads(req.content)
            return httpx.Response(204)
        return httpx.Response(404)
    return handler


def test_live_screen_and_resolution_sync_with_retry(db, monkeypatch):
    _live_conn(db, monkeypatch)
    state = {"fail_resolve": True}
    trhttp.set_transport(httpx.MockTransport(_wc1_handler(state)))
    monkeypatch.setattr("grc.integrations_tr.wc1._LIMITER", trhttp.RateLimiter(rate_per_sec=1000, burst=1000))
    v = _vendor(db)
    out = screening.screen_vendor(db, v)
    assert out["simulated"] is False and out["screened"] == 1
    m = _matches(db, v)[0]
    assert (m.hit_class, m.countries, m.simulated) == ("sanctions", ["Freedonia"], False)
    res = screening.resolve_match(db, m, status="positive", actor_id=1, risk_level="high",
                                  reason="Full match", remark="confirmed")
    assert res["synced"] is False and m.sync_status == "failed" and "bad resolution" in m.sync_error
    # The local decision still stands (finding raised) even though sync failed.
    assert res["finding_id"] is not None
    state["fail_resolve"] = False
    assert screening.retry_failed_syncs(db, 1) == 1
    assert m.sync_status == "synced"
    assert state["resolved"] == {"resultIds": ["res-1"], "statusId": "st-pos", "riskId": "rk-h",
                                 "reasonId": "rs-full", "resolutionRemark": "confirmed"}


# ── auto-screen hook ─────────────────────────────────────────────────────────

def _to_dd_planning(db, v):
    a = service.ensure_active_assessment(db, v, actor_id=1)
    service.run_tiering(db, v, a, actor_id=1)
    service.advance_stage(db, v, a, actor_id=1)          # intake → tiering
    res = service.advance_stage(db, v, a, actor_id=1)    # tiering → dd_planning
    db.commit()
    return res


def test_auto_screen_on_entering_dd_planning(db):
    _sim(db)
    v = _vendor(db)
    res = _to_dd_planning(db, v)
    assert res["to"] == "dd_planning"
    assert db.query(TPRAScreeningSubject).count() == 1 and _matches(db, v)


def test_auto_screen_disabled_by_setting(db):
    _sim(db, auto_screen_at_dd=False)
    v = _vendor(db)
    _to_dd_planning(db, v)
    assert db.query(TPRAScreeningSubject).count() == 0


def test_transition_survives_screening_failure(db, monkeypatch):
    _sim(db)
    v = _vendor(db)

    def boom(*a, **k):
        raise RuntimeError("provider exploded")

    monkeypatch.setattr(screening, "screen_vendor", boom)
    res = _to_dd_planning(db, v)
    assert res["advanced"] and res["to"] == "dd_planning"
    assert service.get_active_assessment(db, v).current_stage == "dd_planning"


def test_transition_unaffected_without_connection(db):
    v = _vendor(db)
    res = _to_dd_planning(db, v)
    assert res["advanced"] and db.query(TPRAScreeningSubject).count() == 0


# ── API / RBAC ───────────────────────────────────────────────────────────────

def test_resolve_requires_dedicated_permission(db):
    _sim(db)
    v = _vendor(db)
    screening.screen_vendor(db, v)
    m = _matches(db, v)[0]
    erm_editor = _user(db, 30, perms=["erm:risks:edit"])
    with pytest.raises(HTTPException) as ei:
        screening_api.resolve_match(m.id, screening_api.ResolutionIn(status="false", remark="x"), db=db, user=erm_editor)
    assert ei.value.status_code == 403
    resolver = _user(db, 31, perms=["vendor_risk:screening:resolve"])
    out = screening_api.resolve_match(m.id, screening_api.ResolutionIn(status="false", remark="not them"),
                                      db=db, user=resolver)
    assert out["match"]["resolution_status"] == "false"


def test_view_requires_permission(db):
    v = _vendor(db)
    nobody = _user(db, 40)
    with pytest.raises(HTTPException) as ei:
        screening_api.vendor_screening(v.id, db=db, user=nobody)
    assert ei.value.status_code == 403


def test_api_run_without_connection_is_409(db):
    admin = _user(db, 41, admin=True)
    v = _vendor(db)
    with pytest.raises(HTTPException) as ei:
        screening_api.run_screening(v.id, screening_api.RunIn(), db=db, user=admin)
    assert ei.value.status_code == 409


def test_api_people_crud_and_validation(db):
    admin = _user(db, 42, admin=True)
    v = _vendor(db)
    with pytest.raises(HTTPException) as ei:
        screening_api.create_person(v.id, screening_api.PersonIn(full_name="A", date_of_birth="03/02/1970"),
                                    db=db, user=admin)
    assert ei.value.status_code == 400
    with pytest.raises(HTTPException):
        screening_api.create_person(v.id, screening_api.PersonIn(full_name="A", nationality="UK"), db=db, user=admin)
    p = screening_api.create_person(v.id, screening_api.PersonIn(full_name="Ann Other", nationality="gbr",
                                                                   role="ubo", ownership_pct=40), db=db, user=admin)
    assert p["nationality"] == "GBR"
    upd = screening_api.update_person(p["id"], screening_api.PersonUpdate(role="director", row_version=1),
                                      db=db, user=admin)
    assert upd["role"] == "director" and upd["row_version"] == 2
    with pytest.raises(HTTPException) as ei:
        screening_api.update_person(p["id"], screening_api.PersonUpdate(role="ubo", row_version=1), db=db, user=admin)
    assert ei.value.status_code == 409
    screening_api.delete_person(p["id"], db=db, user=admin)
    assert screening_api.list_people(v.id, db=db, user=admin)["total"] == 0
    screening_api.restore_person(p["id"], db=db, user=admin)
    assert screening_api.list_people(v.id, db=db, user=admin)["total"] == 1


def test_api_vendor_screening_and_queue(db):
    _sim(db)
    admin = _user(db, 43, admin=True)
    v = _vendor(db)
    run = screening_api.run_screening(v.id, screening_api.RunIn(), db=db, user=admin)
    assert run["screened"] == 1
    view = screening_api.vendor_screening(v.id, db=db, user=admin)
    assert view["connection"]["mode"] == "simulated" and view["summary"]["unresolved"] >= 1
    q = screening_api.list_matches(resolution_status="unresolved", hit_class=None, vendor_id=None,
                                   sync_status=None, skip=0, limit=50, db=db, user=admin)
    assert q["total"] >= 1 and q["items"][0]["vendor_name"] == v.name
    summ = screening_api.screening_summary(db=db, user=admin)
    assert summ["by_status"]["unresolved"] >= 1
    opts = screening_api.resolution_options(db=db, user=admin)
    assert any(o["type"] == "POSITIVE" for o in opts["statuses"])
    detail = screening_api.get_match(q["items"][0]["id"], profile=True, db=db, user=admin)
    assert detail["profile"]["simulated"] is True
