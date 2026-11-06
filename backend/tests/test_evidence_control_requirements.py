"""Each common control linked to a piece of evidence says which framework requirements it fulfils.

The Links & coverage panel lists the common controls an evidence file is linked to. A control covers
requirements of the frameworks the organisation is assessed against, and the person looking at the file wants
to know what linking it is worth, so every linked control carries those requirements (framework label and
codes) — the same set the control's own page lists, custom controls included, read from the crosswalk once.
"""
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

import grc.models as m
from grc.models import get_db
from grc.routers.auth_router import require_auth


@pytest.fixture
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    m.Base.metadata.create_all(engine)
    s = Session(engine)
    s.add(m.Tenant(id=1, name="Demo Bank", slug="demo"))
    s.add(m.GRCUser(id=7, username="auditor", email="auditor@bank.example", display_name="Auditor"))
    rel = m.SCFRelease(version="2026.2", import_status="ready", is_current=True)
    s.add(rel)
    s.flush()
    s.add(m.SCFScope(tenant_id=1, name="Default", release_id=rel.id, framework_slugs=["soc2", "iso_27001"], is_default=True,
                     framework_obligations={}, baseline_keys=[], esp_level=0))
    # IAC-06 discharges two SOC 2 criteria and one ISO clause; a third framework is not in scope; IAC-15 one criterion.
    for scf_id, slug, code in (("IAC-06", "soc2", "CC6.1"), ("IAC-06", "soc2", "CC6.10"), ("IAC-06", "soc2", "CC6.2"),
                               ("IAC-06", "iso_27001", "A.8.5"), ("IAC-06", "pci_dss", "8.4"), ("IAC-15", "soc2", "CC6.2")):
        s.add(m.SCFMapping(release_id=rel.id, scf_id=scf_id, source_slug=slug, requirement_code=code, provenance="resolver"))
    for nid, scf_id, name in ((1, "IAC-06", "Multi-Factor Authentication"), (2, "IAC-15", "Account Management"), (3, "IAC-99", "Not mapped")):
        s.add(m.NormalizedControl(id=nid, code=f"SCF-{scf_id}", scf_id=scf_id, name=name, statement="s"))
    s.add(m.Evidence(id=5, tenant_id=1, name="MFA policy", file_name="mfa.pdf", status="draft"))
    for nid in (1, 2, 3):
        s.add(m.EvidenceControlMapping(evidence_id=5, normalized_control_id=nid, clause_reference="MFA policy", coverage_type="full"))
    s.commit()
    yield s
    s.close()


@pytest.fixture
def http(db):
    from grc.main import app

    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[require_auth] = lambda: db.get(m.GRCUser, 7)
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.clear()


def _controls(http):
    r = http.get("/evidence-mgmt/links/5/controls")
    assert r.status_code == 200, r.text
    return {c["normalized_control"]["scf_id"]: c["normalized_control"]["requirements"] for c in r.json()["normalized_controls"]}


def test_each_linked_control_lists_the_requirements_it_fulfils_in_the_frameworks_in_scope(http):
    by_control = _controls(http)
    labels = {g["key"]: g for g in by_control["IAC-06"]}
    assert set(labels) == {"soc2", "iso_27001"}                          # PCI DSS is not in scope, so it is not counted
    assert labels["soc2"]["codes"] == ["CC6.1", "CC6.2", "CC6.10"]       # in the order a person reads them, not as text
    assert labels["iso_27001"]["codes"] == ["A.8.5"] and labels["soc2"]["label"] == "SOC 2"
    assert [g["codes"] for g in by_control["IAC-15"]] == [["CC6.2"]]


def test_a_control_with_nothing_mapped_still_loads_with_an_empty_list(http):
    assert _controls(http)["IAC-99"] == []


def test_no_framework_in_scope_means_no_requirements_but_the_list_still_loads(http, db):
    db.query(m.SCFScope).update({"framework_slugs": []})
    db.commit()
    assert _controls(http) == {"IAC-06": [], "IAC-15": [], "IAC-99": []}


def test_a_failure_working_out_the_requirements_does_not_take_the_list_down(http, monkeypatch):
    from grc.modules.evidence.routers import control_links

    def boom(*a, **k):
        raise RuntimeError("crosswalk unavailable")

    monkeypatch.setattr(control_links, "_requirements_fulfilled", boom)
    r = http.get("/evidence-mgmt/links/5/controls")
    assert r.status_code == 200 and len(r.json()["normalized_controls"]) == 3


def test_the_single_control_lookup_gives_what_it_gave_before(db):
    """in_scope_codes now reads many controls at once; asking for one must not change."""
    from grc.modules.automation import router as automation

    rel = db.query(m.SCFRelease).first()
    codes = automation.in_scope_codes(db, rel.id, "IAC-06", ["soc2", "iso_27001"], set(), {})
    assert {k: sorted(v) for k, v in codes.items()} == {"soc2": ["CC6.1", "CC6.10", "CC6.2"], "iso_27001": ["A.8.5"]}
    assert not automation.in_scope_codes(db, rel.id, "IAC-99", ["soc2"], set(), {})
    assert not automation.in_scope_codes(db, rel.id, "IAC-06", [], set(), {})
