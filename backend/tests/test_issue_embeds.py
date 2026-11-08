"""Issues on a record (Issue & Incident Management, the shared embeds): ``POST /issue-management/issues/from-source`` and ``GET /issue-management/by-source/...``.

Neither route had a test. Held here: every source type the route declares is either implemented or refused in plain words (it used to read the six newer ones as a control), what the person
linked in the form is written with the issue and never twice, owner / assignee / root cause / due date are kept, the totals of a record's issues are counts of ALL its issues (not of the
first ``limit`` link rows), ``total_closed`` is always there, the counts route says what the list routes say, an incident can be a source, and a tenant never sees another's issues.
"""
import importlib
from datetime import datetime, timedelta

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import grc.models as m
from grc.routers.auth_router import require_auth

auto_create = importlib.import_module("grc.modules.issue_management.routers.auto_create")
by_source = importlib.import_module("grc.modules.issue_management.routers.by_source")
issues_router = importlib.import_module("grc.modules.issue_management.routers.issues")

ME = 1


@pytest.fixture
def http(monkeypatch):
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    m.Base.metadata.create_all(engine)
    db = sessionmaker(bind=engine)()
    db.add_all([m.Tenant(id=1, name="CFSB", slug="cfsb"), m.Tenant(id=2, name="Acme", slug="acme")])
    for uid, name in [(1, "Olivia Owner"), (2, "Rana Reviewer")]:
        db.add(m.GRCUser(id=uid, username=name.split()[0].lower(), email=f"{name.split()[0].lower()}@cfsb.test", display_name=name))
    db.commit()
    for module in (auto_create, by_source, issues_router):
        monkeypatch.setattr(module, "get_user_tenants", lambda user, session: [1])
        monkeypatch.setattr(module, "get_user_primary_tenant", lambda user, session: 1, raising=False)
    app = FastAPI()
    app.include_router(auto_create.router)
    app.include_router(issues_router.router)
    app.include_router(by_source.router)
    app.dependency_overrides[m.get_db] = lambda: db
    app.dependency_overrides[require_auth] = lambda: db.get(m.GRCUser, ME)
    for gate in (auto_create._require_create, by_source._require_view, issues_router._require_create):
        app.dependency_overrides[gate] = lambda: True
    client = TestClient(app)
    client.db = db
    yield client
    db.close()


def fixtures(db):
    """One of each source, in tenant 1, and a risk in tenant 2."""
    risk = m.Risk(tenant_id=1, title="Payments outage", category="operational")
    other = m.Risk(tenant_id=2, title="Not ours", category="operational")
    asset = m.ITAsset(tenant_id=1, name="Core switch", asset_type="network", criticality="high")
    asset2 = m.ITAsset(tenant_id=1, name="Edge router", asset_type="network")
    vuln = m.Vulnerability(tenant_id=1, vuln_id="CVE-1", title="Weak TLS", severity="high")
    control = m.InternalControl(tenant_id=1, control_id="IC-1", name="Patching")
    project = m.ISProject(tenant_id=1, name="SOC build")
    doc = m.GovernanceDocument(tenant_id=1, title="Access policy", doc_type="policy")
    db.add_all([risk, other, asset, asset2, vuln, control, project, doc])
    db.flush()
    stmt = m.PolicyStatement(tenant_id=1, document_id=doc.id, statement_text="Review access every quarter")
    incident = m.RiskIncident(tenant_id=1, title="Card data exposed", incident_date=datetime.utcnow(), severity="critical", risk_id=risk.id, description="Exposure on the portal")
    db.add_all([stmt, incident])
    db.flush()
    db.add_all([m.IncidentAssetLink(incident_id=incident.id, asset_id=asset.id), m.IncidentVulnerabilityLink(incident_id=incident.id, vulnerability_id=vuln.id)])
    db.commit()
    return dict(risk=risk, other=other, asset=asset, asset2=asset2, vuln=vuln, control=control, project=project, doc=doc, stmt=stmt, incident=incident)


def raise_issue(http, source_type, source_id, **body):
    return http.post("/issues/from-source", json={"source_type": source_type, "source_id": source_id, **body})


def by(http, source_type, source_id, **params):
    r = http.get(f"/by-source/{source_type}/{source_id}", params=params)
    assert r.status_code == 200, r.text
    return r.json()


def add_issue(db, link, *, state="new", severity="medium", target=None, title="Issue", created=None, assignee=None, tenant=1, **fields):
    """An issue linked to one record by the link row ``link(issue_id)``."""
    i = m.Issue(tenant_id=tenant, title=title, severity=severity, workflow_state=state, status="open", target_closure_date=target,
                created_at=created or datetime.utcnow(), assignee_id=assignee, **fields)
    db.add(i)
    db.flush()
    db.add(link(i.id))
    db.commit()
    return i


# ── from-source: the declared source types ───────────────────────────────────────────────────────────────────────────────────────────────
def test_every_declared_source_type_is_implemented_or_refused_in_plain_words(http):
    f = fixtures(http.db)
    ids = {"vulnerability": f["vuln"].id, "risk": f["risk"].id, "asset": f["asset"].id, "control_internal": f["control"].id, "governance_document": f["doc"].id,
           "policy_statement": f["stmt"].id, "is_project": f["project"].id, "risk_incident": f["incident"].id}
    assert set(ids) | auto_create.EVENT_SOURCES >= auto_create.SUPPORTED_SOURCES - {"control_framework", "control_parsed", "control_normalized"}
    for source_type, source_id in ids.items():
        r = raise_issue(http, source_type, source_id)
        assert r.status_code == 201, (source_type, r.text)
        issue = http.db.get(m.Issue, r.json()["id"])
        assert issue.source_id == source_id and issue.title and issue.category and issue.issue_type and issue.severity
        assert issue.source_type == ("control_test" if source_type.startswith("control_") else source_type)
        assert by(http, source_type, source_id)["total_open"] == 1, f"{source_type}: the issue is found from its record"
    for source_type in sorted(auto_create.EVENT_SOURCES):
        before = http.db.query(m.Issue).count()
        r = raise_issue(http, source_type, 1)
        assert r.status_code == 400 and "raised by the platform itself" in r.json()["detail"], source_type
        assert http.db.query(m.Issue).count() == before, "nothing is created, and no control is linked by mistake"
    assert http.db.query(m.IssueControlLink).count() == 1, "the control source wrote its one link; the event types wrote none"


def test_an_unknown_source_a_missing_record_and_another_tenants_record_are_refused(http):
    f = fixtures(http.db)
    assert raise_issue(http, "spaceship", 1).status_code == 400
    assert raise_issue(http, "risk", 0).status_code == 400
    assert raise_issue(http, "risk", "abc").status_code == 400
    assert raise_issue(http, "risk", 9999).status_code == 404
    assert raise_issue(http, "risk", f["other"].id).status_code == 404, "a risk of tenant 2"
    for source_type in ("governance_document", "policy_statement", "is_project", "risk_incident"):
        assert raise_issue(http, source_type, 9999).status_code == 404, source_type
    assert http.db.query(m.Issue).count() == 0


def test_the_document_and_statement_sources_do_not_read_the_title_of_a_record_the_person_may_not_open(http):
    f = fixtures(http.db)
    r = raise_issue(http, "governance_document", f["doc"].id)
    assert "Access policy" not in r.json()["title"], "who may see a document's title is Governance's rule"
    r = raise_issue(http, "governance_document", f["doc"].id, title="Policy gap found in the audit")
    assert r.json()["title"] == "Policy gap found in the audit"


# ── from-source: what the person linked, and who owns it ─────────────────────────────────────────────────────────────────────────────────
def test_what_was_linked_in_the_form_is_written_with_the_issue_and_never_twice(http):
    f = fixtures(http.db)
    r = raise_issue(http, "risk", f["risk"].id, linked_risk_ids=[f["risk"].id], linked_asset_ids=[f["asset"].id, f["asset"].id, 999999],
                    linked_vulnerability_ids=[f["vuln"].id], linked_internal_control_ids=[f["control"].id], linked_is_project_ids=[f["project"].id],
                    linked_governance_document_ids=[f["doc"].id], linked_policy_statement_ids=[f["stmt"].id])
    assert r.status_code == 201, r.text
    iid = r.json()["id"]
    db = http.db
    assert db.query(m.IssueRiskLink).filter_by(issue_id=iid).count() == 1, "the source risk is linked once, though the form listed it too"
    assert [l.asset_id for l in db.query(m.IssueAssetLink).filter_by(issue_id=iid)] == [f["asset"].id], "a repeated and an unknown id are dropped"
    assert db.query(m.IssueVulnerabilityLink).filter_by(issue_id=iid).count() == 1
    assert [l.internal_control_id for l in db.query(m.IssueControlLink).filter_by(issue_id=iid)] == [f["control"].id]
    assert db.query(m.IssueISProjectLink).filter_by(issue_id=iid).count() == 1
    gov = db.query(m.IssueGovernanceLink).filter_by(issue_id=iid).all()
    assert sorted((g.governance_document_id, g.policy_statement_id) for g in gov if g.governance_document_id) == [(f["doc"].id, None)]
    assert [g.policy_statement_id for g in gov if g.policy_statement_id] == [f["stmt"].id]
    assert r.json()["linked"]["assets"] == 1 and "risks" not in r.json()["linked"]
    activity = db.query(m.IssueActivity).filter_by(issue_id=iid, type="linked_on_create").one()
    assert activity.payload["assets"] == 1
    # a source's own link is not written again from the form: asset source + the same asset in the form
    again = raise_issue(http, "asset", f["asset"].id, linked_asset_ids=[f["asset"].id, f["asset2"].id]).json()["id"]
    assert sorted(l.asset_id for l in db.query(m.IssueAssetLink).filter_by(issue_id=again)) == sorted([f["asset"].id, f["asset2"].id])
    # a control source + the same control in the form (the polymorphic list as well)
    c = raise_issue(http, "control_internal", f["control"].id, linked_internal_control_ids=[f["control"].id], linked_controls=[{"target_type": "internal", "control_id": f["control"].id}]).json()["id"]
    assert db.query(m.IssueControlLink).filter_by(issue_id=c).count() == 1


def test_a_vulnerability_brings_its_assets_and_the_form_may_name_the_same_ones(http):
    f = fixtures(http.db)
    http.db.add(m.VulnerabilityAssetLink(vulnerability_id=f["vuln"].id, asset_id=f["asset"].id))
    http.db.commit()
    iid = raise_issue(http, "vulnerability", f["vuln"].id, linked_asset_ids=[f["asset"].id, f["asset2"].id]).json()["id"]
    assert sorted(l.asset_id for l in http.db.query(m.IssueAssetLink).filter_by(issue_id=iid)) == sorted([f["asset"].id, f["asset2"].id])


def test_owner_assignee_root_cause_and_due_date_are_kept(http):
    f = fixtures(http.db)
    r = raise_issue(http, "risk", f["risk"].id, owner_id=2, assignee_id=2, root_cause="No peer review", due_date="2026-12-01", title=" Fix the outage ")
    assert r.status_code == 201, r.text
    i = http.db.get(m.Issue, r.json()["id"])
    assert (i.owner_id, i.assignee_id, i.root_cause, i.due_date, i.title, i.reporter_id) == (2, 2, "No peer review", datetime(2026, 12, 1), "Fix the outage", ME)
    assert http.db.query(m.IssueAction).filter_by(issue_id=i.id).one().assignee_id == 2, "the first action starts with the assignee"
    assert raise_issue(http, "risk", f["risk"].id, root_cause="x" * 256).status_code == 400
    assert raise_issue(http, "risk", f["risk"].id, due_date="next week").status_code == 400
    assert raise_issue(http, "risk", f["risk"].id, severity_override="critical").status_code == 400, "an override says why"
    ok = raise_issue(http, "risk", f["risk"].id, title="T" * 400)
    assert len(ok.json()["title"]) == 255, "the title column holds 255"


def test_an_incident_brings_its_risk_assets_and_vulnerabilities_and_is_found_by_source(http):
    f = fixtures(http.db)
    r = raise_issue(http, "risk_incident", f["incident"].id)
    assert r.status_code == 201, r.text
    i = http.db.get(m.Issue, r.json()["id"])
    assert i.title == "Incident: Card data exposed" and i.description == "Exposure on the portal" and i.impact == "high" and (i.issue_type, i.category) == ("incident", "operations")
    assert [l.risk_id for l in http.db.query(m.IssueRiskLink).filter_by(issue_id=i.id)] == [f["risk"].id]
    assert [l.asset_id for l in http.db.query(m.IssueAssetLink).filter_by(issue_id=i.id)] == [f["asset"].id]
    assert [l.vulnerability_id for l in http.db.query(m.IssueVulnerabilityLink).filter_by(issue_id=i.id)] == [f["vuln"].id]
    got = by(http, "risk_incident", f["incident"].id)
    assert [x["id"] for x in got["open"]] == [i.id] and by(http, "risk", f["risk"].id)["total_open"] == 1 and by(http, "asset", f["asset"].id)["total_open"] == 1


def test_a_post_issues_with_a_linked_control_no_longer_fails(http):
    """_apply_inline_linkages passed a ``target_type`` the link table does not have: any create with a linked control was a 500."""
    f = fixtures(http.db)
    r = http.post("/issues", json={"title": "Gap", "impact": "high", "urgency": "high", "linked_internal_control_ids": [f["control"].id],
                                   "linked_controls": [{"target_type": "internal", "control_id": f["control"].id}]})
    assert r.status_code == 201, r.text
    assert http.db.query(m.IssueControlLink).filter_by(issue_id=r.json()["id"]).count() == 2


# ── by-source: true totals ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
def test_the_totals_count_every_linked_issue_not_the_first_rows_and_total_closed_is_always_there(http):
    f = fixtures(http.db)
    link = lambda iid: m.IssueRiskLink(issue_id=iid, risk_id=f["risk"].id)       # noqa: E731
    now = datetime.utcnow()
    for n in range(7):
        add_issue(http.db, link, title=f"Low {n}", severity="low", created=now - timedelta(days=30 - n))
    crit = add_issue(http.db, link, title="Critical late", severity="critical", state="closure_review", created=now)   # closure review is still open
    add_issue(http.db, link, title="Done", state="closed", severity="high")
    add_issue(http.db, link, title="Dropped", state="cancelled")
    add_issue(http.db, lambda iid: m.IssueRiskLink(issue_id=iid, risk_id=f["other"].id), title="Elsewhere")
    got = by(http, "risk", f["risk"].id, limit=3)
    assert (got["total_open"], got["critical_open"], got["total_closed"]) == (8, 1, 2), "counts of all, whatever the limit"
    assert len(got["open"]) == 3 and got["open"][0]["id"] == crit.id, "the cut keeps the critical one first"
    assert [x["title"] for x in got["open"][1:]] == ["Low 0", "Low 1"], "then the oldest first, as the page has always listed them"
    assert got["closed"] == [], "the closed ROWS wait for include_closed"
    full = by(http, "risk", f["risk"].id, include_closed=True)
    assert {x["title"] for x in full["closed"]} == {"Done", "Dropped"} and full["total_closed"] == 2


def test_a_row_says_who_has_it_and_whether_it_is_late(http):
    f = fixtures(http.db)
    link = lambda iid: m.IssueAssetLink(issue_id=iid, asset_id=f["asset"].id)    # noqa: E731
    now = datetime.utcnow()
    late = add_issue(http.db, link, title="Late", target=now - timedelta(days=3), assignee=2, sla_breached=False)
    add_issue(http.db, link, title="Fine", target=now + timedelta(days=3))
    add_issue(http.db, link, title="Closed late", state="closed", target=now - timedelta(days=9))
    add_issue(http.db, link, title="Old row", state=None, target=now - timedelta(days=1))              # no workflow state = a new one
    got = by(http, "asset", f["asset"].id, include_closed=True)
    rows = {x["title"]: x for x in got["open"] + got["closed"]}
    assert rows["Late"]["overdue"] is True and rows["Late"]["sla_breached"] is False and rows["Late"]["assignee_name"] == "Rana Reviewer"
    assert rows["Fine"]["overdue"] is False and rows["Fine"]["assignee_name"] is None
    assert rows["Closed late"]["overdue"] is False, "a closed issue is not late"
    assert rows["Old row"]["workflow_state"] == "new" and rows["Old row"] in got["open"] and rows["Old row"]["overdue"] is True
    assert late.id == rows["Late"]["id"]


def test_by_source_never_shows_another_tenants_issue_or_an_unknown_type(http):
    f = fixtures(http.db)
    other = m.Issue(tenant_id=2, title="Theirs", severity="high", workflow_state="new", status="open")
    http.db.add(other)
    http.db.flush()
    http.db.add(m.IssueRiskLink(issue_id=other.id, risk_id=f["risk"].id))
    http.db.commit()
    assert by(http, "risk", f["risk"].id)["total_open"] == 0
    assert http.get("/by-source/spaceship/1").status_code == 400


# ── by-source/counts ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
def test_the_counts_route_says_what_the_list_route_says_for_every_record_asked(http):
    f = fixtures(http.db)
    for risk, n in ((f["risk"], 3), (f["other"], 1)):
        for k in range(n):
            add_issue(http.db, lambda iid, r=risk: m.IssueRiskLink(issue_id=iid, risk_id=r.id), severity="critical" if k == 0 else "low", tenant=risk.tenant_id)
    add_issue(http.db, lambda iid: m.IssueRiskLink(issue_id=iid, risk_id=f["risk"].id), state="closed")
    asked = [f["risk"].id, f["other"].id, 4242]
    r = http.get("/by-source/counts", params={"type": "risk", "ids": ",".join(str(i) for i in asked)})
    assert r.status_code == 200, r.text
    counts = r.json()["counts"]
    assert set(counts) == {str(i) for i in asked}, "an entry for every id asked, even for a record with none"
    assert counts["4242"] == {"total_open": 0, "critical_open": 0, "total_closed": 0}
    for rid in (f["risk"].id, f["other"].id):
        listed = by(http, "risk", rid)
        assert counts[str(rid)] == {"total_open": listed["total_open"], "critical_open": listed["critical_open"], "total_closed": listed["total_closed"]}
    assert counts[str(f["risk"].id)] == {"total_open": 3, "critical_open": 1, "total_closed": 1}
    assert counts[str(f["other"].id)]["total_open"] == 0, "tenant 2's risk: its issue is not ours to count"


def test_the_counts_route_reads_incidents_and_refuses_bad_asks(http):
    f = fixtures(http.db)
    raise_issue(http, "risk_incident", f["incident"].id)
    got = http.get("/by-source/counts", params={"type": "risk_incident", "ids": str(f["incident"].id)}).json()["counts"]
    assert got[str(f["incident"].id)]["total_open"] == 1
    assert http.get("/by-source/counts", params={"type": "spaceship", "ids": "1"}).status_code == 400
    assert http.get("/by-source/counts", params={"type": "risk", "ids": "a,b,0,-3"}).status_code == 400
    assert http.get("/by-source/counts", params={"type": "risk", "ids": ",".join(str(i) for i in range(1, 202))}).status_code == 400
    assert http.get("/by-source/counts", params={"type": "risk", "ids": ",".join(str(i) for i in range(1, 201))}).status_code == 200
    assert http.get("/by-source/counts", params={"type": "risk"}).status_code == 422
