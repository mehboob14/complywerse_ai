"""A governance document is mapped against its own frameworks by default, the
applicable and linked ones it was created with, and against any others picked
later on its Mappings tab.

The extra frameworks are kept on the document, so the Mappings tab, the
coverage panel, later runs and re-parses all use the same scope; and when
several frameworks are in scope, each gets its share of the candidates the
model judges, so one large catalogue cannot crowd out a small one.
"""
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

import grc.models as m
from grc.models import get_db
from grc.modules.governance import statement_auto_map as engine_mod
from grc.routers.auth_router import require_auth

BASE = "/governance/mappings/document"


@pytest.fixture
def client(monkeypatch):
    from grc.main import app

    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    m.Base.metadata.create_all(engine)
    db = Session(engine)
    db.add(m.Tenant(id=1, name="Demo Bank", slug="demo"))
    user = m.GRCUser(id=7, username="owner", email="owner@bank.example", display_name="Owner")
    db.add(user)
    db.flush()
    for fid, name in ((1, "ISO/IEC 27001:2022"), (2, "NIST Cybersecurity Framework"), (3, "SOC 2 Type II")):
        db.add(m.UploadedFramework(id=fid, tenant_id=1, name=name, file_name=f"{fid}.pdf", file_path="x",
                                   file_type="pdf", uploaded_by=7, upload_status="parsed", is_active=True))
    db.flush()
    db.add_all([
        m.ParsedFrameworkControl(uploaded_framework_id=1, control_id="A.5.15", title="Access control",
                                 description="Rules to control access to information are established."),
        m.ParsedFrameworkControl(uploaded_framework_id=2, control_id="PR.AA-01", title="Identities managed",
                                 description="Identities and credentials for users are managed."),
        m.ParsedFrameworkControl(uploaded_framework_id=3, control_id="CC6.1", title="Logical access",
                                 description="The entity restricts logical access to information assets."),
    ])
    doc = m.GovernanceDocument(id=11, tenant_id=1, title="Access Management Policy", doc_type="policy",
                               framework_ids=[1], applicable_framework_ids=[2])
    db.add(doc)
    db.flush()
    db.add(m.PolicyStatement(tenant_id=1, document_id=11, statement_code="PS-0011-001", status="active",
                             statement_text="Access to information systems is granted on least privilege."))
    db.commit()

    # The model itself is stood in for: it picks every candidate it is shown.
    monkeypatch.setattr(engine_mod, "_ai_available", lambda: True)
    seen = []

    def fake_match(stmt, kind, cands):
        seen.append(sorted(c.uploaded_framework_id for c in cands))
        return [(c, 0.9, "full", "fits") for c in cands]

    monkeypatch.setattr(engine_mod, "_ai_match", fake_match)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[require_auth] = lambda: user
    yield TestClient(app), db, seen
    app.dependency_overrides.clear()
    db.close()


def test_the_scope_is_applicable_and_linked_plus_what_the_mappings_tab_adds():
    doc = m.GovernanceDocument(framework_ids=[1, "2"], applicable_framework_ids=[2], mapping_framework_ids=[2, 3])
    assert engine_mod.framework_scope(doc) == {"applicable": [2], "linked": [1, 2], "extra": [3], "all": [1, 2, 3]}
    assert engine_mod.framework_scope(m.GovernanceDocument())["all"] == []


def test_by_default_it_maps_against_the_frameworks_the_document_was_created_with(client):
    http, db, seen = client
    body = http.get(f"{BASE}/11").json()
    assert body["framework_scope_ids"] == [1, 2]
    assert body["framework_scope"]["applicable"] == [{"id": 2, "name": "NIST Cybersecurity Framework"}]
    assert body["framework_scope"]["linked"] == [{"id": 1, "name": "ISO/IEC 27001:2022"}]

    run = http.post(f"{BASE}/11/run", json={}).json()
    assert run["status"] == "completed" and run["framework_scope_ids"] == [1, 2]
    assert seen == [[1, 2]]                                   # SOC 2 was not asked about
    names = {r["framework_name"] for r in http.get(f"{BASE}/11").json()["recommended_controls"]}
    assert names == {"ISO/IEC 27001:2022", "NIST Cybersecurity Framework"}


def test_another_framework_picked_on_the_mappings_tab_is_mapped_and_kept(client):
    http, db, seen = client
    run = http.post(f"{BASE}/11/run", json={"extra_framework_ids": [3, 2]}).json()
    assert run["framework_scope_ids"] == [1, 2, 3]
    assert db.get(m.GovernanceDocument, 11).mapping_framework_ids == [3]    # 2 is already applicable

    body = http.get(f"{BASE}/11").json()
    assert body["framework_scope"]["extra"] == [{"id": 3, "name": "SOC 2 Type II"}]
    assert "SOC 2 Type II" in {r["framework_name"] for r in body["recommended_controls"]}
    coverage = http.get(f"{BASE}/11/coverage").json()
    assert sorted(f["framework_id"] for f in coverage["frameworks"]) == [1, 2, 3]

    http.post(f"{BASE}/11/run", json={"extra_framework_ids": []})                # dropped again
    assert db.get(m.GovernanceDocument, 11).mapping_framework_ids == []
    assert "SOC 2 Type II" not in {r["framework_name"] for r in http.get(f"{BASE}/11").json()["recommended_controls"]}


def test_a_run_says_why_it_cannot_start(client, monkeypatch):
    http, db, _ = client
    assert http.post(f"{BASE}/11/run", json={"extra_framework_ids": [99]}).status_code == 400

    doc = db.get(m.GovernanceDocument, 11)
    doc.framework_ids, doc.applicable_framework_ids = [], []
    db.commit()
    nothing = http.post(f"{BASE}/11/run", json={})
    assert nothing.status_code == 400 and "at least one framework" in nothing.json()["detail"]

    db.query(m.PolicyStatement).delete()
    db.commit()
    unparsed = http.post(f"{BASE}/11/run", json={"extra_framework_ids": [3]})
    assert unparsed.status_code == 400 and "Parse it" in unparsed.json()["detail"]

    db.add(m.PolicyStatement(tenant_id=1, document_id=11, statement_text="Access is reviewed.", status="active"))
    db.commit()
    monkeypatch.setattr(engine_mod, "_ai_available", lambda: False)
    assert http.post(f"{BASE}/11/run", json={"extra_framework_ids": [3]}).status_code == 503
    assert http.get(f"{BASE}/11/run-status").json() == {"status": "idle"}


def test_each_framework_in_scope_gets_its_share_of_the_candidates():
    rows = [m.ParsedFrameworkControl(uploaded_framework_id=1, control_id=f"B{i}", title="access control access",
                                     description="access") for i in range(60)]
    rows.append(m.ParsedFrameworkControl(uploaded_framework_id=2, control_id="S1", title="logging",
                                         description="audit logs are kept"))
    picked = engine_mod._narrow("access control for systems", "parsed", rows, per_framework=True)
    assert {c.uploaded_framework_id for c in picked} == {1, 2}
    assert len(engine_mod._narrow("access control", "parsed", rows)) == 25              # unscoped: as before
    assert {c.uploaded_framework_id for c in engine_mod._narrow("access control", "parsed", rows)} == {1}
