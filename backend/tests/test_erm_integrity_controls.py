"""One source of truth for risk–control links (Risk Management wave 5, integrity). In-memory SQLite.

grc_risk_controls is the only risk–control link that is written and read. Every screen that links or unlinks a control (the
register's two routers, the internal-control register, the Control Library workbench, the framework library, the SCF
control page and its record links) writes it through risk_control_links, and every reader (the risk detail, the risk
record, the internal control, the workbench, the SCF pages, reports, dashboards, FAIR) reads it. The five older link
tables are left as they are and never written; their rows are copied in once per database, so a link removed later never
comes back.
"""
import importlib

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import grc.models as m
from grc.models import get_db
from grc.modules.control_library.routers import workbench
from grc.modules.erm.quantification.service import build_control_effects
from grc.modules.erm.router import router as erm_router
from grc.modules.erm.services.risk_control_links import copy_legacy_links, copy_legacy_links_for_engine, risk_control_links
from grc.modules.scf import record_links
from grc.modules.scf import risk_links as scf
from grc.routers.auth_router import create_access_token, require_auth
from grc.services import report_linkages
from grc.services import report_open_catalog as catalog

OFFICER = 7
SCF_ID = "IAC-01"
OLD = (m.InternalControlRiskLink, m.ControlWorkRiskLink, m.RiskControlLink, m.RiskFrameworkControlLink,
       m.RiskFrameworkRequirementLink)
CONTROL = {"normalized": 31, "internal": 21, "catalog": 41, "framework": 51}


@pytest.fixture()
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    m.Base.metadata.create_all(engine)
    s = sessionmaker(bind=engine)()
    s.add_all([m.Tenant(id=1, name="Bank", slug="bank"), m.Tenant(id=2, name="Other", slug="other")])
    s.add(m.Role(id=1, name="Administrator"))
    s.add(m.GRCUser(id=OFFICER, username="officer", display_name="Officer", email="officer@bank.test", is_active=True))
    s.add(m.UserRole(user_id=OFFICER, role_id=1, tenant_id=1))
    s.add_all([m.Risk(id=1, tenant_id=1, title="Wire fraud", category="operational", status="open"),
               m.Risk(id=3, tenant_id=2, title="Someone else's risk", category="operational", status="open")])
    s.add_all([
        m.InternalControl(id=21, tenant_id=1, control_id="IC-021", name="Call-back on new payees", control_type="preventive"),
        m.NormalizedControl(id=31, code="LIB-31", name="Payment limits", scf_id=SCF_ID, source="custom"),
        m.FrameworkControl(id=41, objective_id=1, code="FC-41", name="Segregation of duties"),
        m.UploadedFramework(id=1, tenant_id=1, name="UAE IA", file_name="uae.pdf", file_path="/x", file_type="pdf", uploaded_by=OFFICER,
                            is_active=True),
        m.ParsedFrameworkControl(id=51, uploaded_framework_id=1, control_id="M2.3.1", title="Access reviews"),
        m.ControlWorkItem(id=61, tenant_id=1, source_type="normalized", source_id=31, name="Payment limits"),
        m.ControlWorkItem(id=62, tenant_id=1, source_type="framework", source_id=51, name="Access reviews"),
        m.ControlWorkItem(id=63, tenant_id=1, source_type="internal", source_id=21, name="Call-back on new payees"),
    ])
    s.commit()
    yield s
    s.close()


def client(db):
    app = FastAPI()
    app.include_router(erm_router)
    app.include_router(workbench.router)
    app.include_router(importlib.import_module("grc.routers.risks_router").router)     # what the risk page calls
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[require_auth] = lambda: db.get(m.GRCUser, OFFICER)
    http = TestClient(app)
    http.headers["Authorization"] = "Bearer " + create_access_token({"sub": "officer"})
    return http


def link_of(db, source, risk_id=1):
    return db.query(m.RiskControl).filter_by(risk_id=risk_id, control_source=source,
                                             control_id=CONTROL[source]).one_or_none()


def old_rows(db):
    return sum(db.query(model).count() for model in OLD)


def readers(db, http, source):
    """Every place the risk's link to CONTROL[source] shows: {reader: shown?}."""
    cid = CONTROL[source]
    key, field = {"normalized": ("linked_controls", "control_id"), "internal": ("linked_internal_controls", "id"),
                  "catalog": ("linked_framework_controls", "framework_control_id"),
                  "framework": ("linked_framework_requirements", "parsed_control_id")}[source]
    seen = {
        "helper": any((c["source"], c["control_id"]) == (source, cid) for c in risk_control_links(db, [1])[1]),
        "risk record": any((c["source"], c["control_id"]) == (source, cid)
                           for c in http.get("/erm/internal-controls/risk-links/1").json()),
        "risk detail": any(c[field] == cid for c in http.get("/risks/1/detail").json()[key]),
        "erm risk detail": any(c[field] == cid for c in http.get("/erm/risks/1/detail").json()[key]),
        "dashboard": http.get("/erm/dashboard/sections-overview").json()["sections"]["register"]["counts"]["linked"] == 1,
    }
    if source != "catalog":
        seen["workbench"] = [r["risk_id"] for r in http.get(f"/workbench/controls/{source}/{cid}").json()["risk_links"]] == [1]
    if source == "internal":
        seen["control's risks"] = [r["risk_id"] for r in http.get("/erm/internal-controls/21/risks").json()] == [1]
        seen["control detail"] = [r["risk_id"] for r in http.get("/erm/internal-controls/21").json()["risk_links"]] == [1]
        seen["report"] = catalog.EDGE_RESOLVERS[("risks", "internal_controls")](db, [1]).get(1) == [cid]
    if source == "normalized":
        seen["legacy risk"] = http.get("/risks/1").json()["linked_controls"] == [cid]
        seen["SCF page"] = [r["risk_id"] for r in scf.list_risks_for_control(db, 1, SCF_ID)] == [1]
        seen["record links"] = [(r["type"], r["id"]) for r in record_links.list_links(db, 1, cid)] == [("risk", 1)]
        seen["report"] = catalog.EDGE_RESOLVERS[("risks", "controls")](db, [1]).get(1) == [cid]
        seen["report back"] = catalog.EDGE_RESOLVERS[("controls", "risks")](db, [cid]).get(cid) == [1]
        seen["linkages"] = "controls" in report_linkages._enrich_risks(db, [1], {"controls"}).get(1, {})
    if source == "catalog":
        seen["report"] = catalog.EDGE_RESOLVERS[("risks", "framework_controls")](db, [1]).get(1) == [cid]
        seen["linkages"] = "framework_controls" in report_linkages._enrich_risks(db, [1], {"framework_controls"}).get(1, {})
    return seen


def _scf_link(http, db):
    scf.link_risk(db, 1, SCF_ID, 1, OFFICER)
    db.commit()


def _record_link(http, db):
    record_links.link_record(db, 1, db.get(m.NormalizedControl, 31), "risk", 1, OFFICER)
    db.commit()


LINKS = {
    "register (legacy router)": ("normalized", lambda h, db: h.post("/risks/1/controls", json={"normalized_control_id": 31})),
    "register (erm router)": ("normalized", lambda h, db: h.post("/erm/risks/1/controls", json={"normalized_control_id": 31})),
    "workbench library control": ("normalized", lambda h, db: h.post("/workbench/items/61/risks", json={"risk_id": 1})),
    "SCF control page": ("normalized", _scf_link),
    "SCF record links": ("normalized", _record_link),
    "catalog (legacy router)": ("catalog", lambda h, db: h.post("/risks/1/link-framework-control",
                                                                json={"framework_control_id": 41, "mitigation_effectiveness": "full"})),
    "catalog (erm router)": ("catalog", lambda h, db: h.post("/erm/risks/1/link-framework-control",
                                                             json={"framework_control_id": 41, "mitigation_effectiveness": "full"})),
    "framework library": ("framework", lambda h, db: h.post("/erm/risks/1/framework-requirements",
                                                            json={"framework_id": 1, "control_ids": [51]})),
    "workbench framework control": ("framework", lambda h, db: h.post("/workbench/items/62/risks", json={"risk_id": 1})),
    "internal control register": ("internal", lambda h, db: h.post("/erm/internal-controls/21/risks", json={"risk_id": 1})),
    "workbench internal control": ("internal", lambda h, db: h.post("/workbench/items/63/risks", json={"risk_id": 1})),
}
FIRST = {"normalized": "register (legacy router)", "catalog": "catalog (legacy router)", "framework": "framework library",
         "internal": "internal control register"}


def _ok(response):
    if response is not None:
        assert response.status_code in (200, 201, 204), response.text


@pytest.mark.parametrize("entry", sorted(LINKS))
def test_a_link_made_anywhere_shows_in_every_reader_and_writes_no_old_table(db, entry):
    source, make = LINKS[entry]
    http = client(db)
    assert not any(readers(db, http, source).values())
    _ok(make(http, db))
    assert link_of(db, source) is not None
    assert readers(db, http, source) == {k: True for k in readers(db, http, source)}
    assert old_rows(db) == 0                                      # the old tables are read-only now


def _scf_unlink(http, db, link_id):
    scf.unlink_risk(db, 1, SCF_ID, link_id, OFFICER)
    db.commit()


def _record_unlink(http, db, link_id):
    record_links.unlink_record(db, 1, db.get(m.NormalizedControl, 31), "risk", 1, OFFICER)
    db.commit()


UNLINKS = [
    ("normalized", "register (legacy router)", lambda h, db, i: h.delete(f"/risks/1/controls/{i}")),
    ("normalized", "register (erm router)", lambda h, db, i: h.delete(f"/erm/risks/1/controls/{i}")),
    ("normalized", "SCF control page", _scf_unlink),
    ("normalized", "SCF record links", _record_unlink),
    ("catalog", "register (legacy router)", lambda h, db, i: h.delete(f"/risks/1/link-framework-control/{i}")),
    ("catalog", "register (erm router)", lambda h, db, i: h.delete(f"/erm/risks/1/link-framework-control/{i}")),
    ("framework", "framework library", lambda h, db, i: h.delete(f"/erm/risks/1/framework-requirements/{i}")),
    ("internal", "internal control register", lambda h, db, i: h.delete(f"/erm/internal-controls/21/risks/{i}")),
    *[(s, "workbench", lambda h, db, i: h.delete(f"/workbench/risks/rc-{i}")) for s in ("normalized", "framework", "internal")],
    *[(s, "risk record", lambda h, db, i: h.delete(f"/erm/internal-controls/risk-links/1/{i}")) for s in CONTROL],
]


@pytest.mark.parametrize("source,where,unlink", UNLINKS, ids=[f"{s}-{w}" for s, w, _ in UNLINKS])
def test_an_unlink_anywhere_disappears_everywhere_and_does_not_come_back(db, source, where, unlink):
    http = client(db)
    _ok(LINKS[FIRST[source]][1](http, db))
    _ok(unlink(http, db, link_of(db, source).id))
    assert link_of(db, source) is None
    assert not any(readers(db, http, source).values())
    copy_legacy_links(db)                                         # the copy has nothing left to bring back
    assert link_of(db, source) is None and not any(readers(db, http, source).values())


def test_a_link_made_twice_is_refused_or_kept_once(db):
    http = client(db)
    assert http.post("/risks/1/controls", json={"normalized_control_id": 31}).status_code == 201
    assert http.post("/erm/risks/1/controls", json={"normalized_control_id": 31}).status_code == 400
    assert http.post("/erm/internal-controls/21/risks", json={"risk_id": 1}).status_code == 201
    assert http.post("/erm/internal-controls/21/risks", json={"risk_id": 1}).status_code == 400
    assert http.post("/workbench/items/61/risks", json={"risk_id": 1}).status_code == 200
    assert db.query(m.RiskControl).filter_by(risk_id=1).count() == 2


def test_another_tenants_risk_cannot_be_linked_or_unlinked_by_id(db):
    http = client(db)
    assert http.post("/risks/3/controls", json={"normalized_control_id": 31}).status_code == 404
    theirs = m.RiskControl(tenant_id=2, risk_id=3, control_source="normalized", control_id=31)
    db.add(theirs)
    db.commit()
    assert http.delete(f"/risks/1/controls/{theirs.id}").status_code == 404
    assert http.delete(f"/workbench/risks/rc-{theirs.id}").status_code == 404
    with pytest.raises(ValueError):
        scf.unlink_risk(db, 1, SCF_ID, theirs.id, OFFICER)
    assert db.get(m.RiskControl, theirs.id) is not None


# ── the one-time copy ────────────────────────────────────────────────────────

def seed_old_rows(db):
    """One row in each old table, as an older release wrote them; the catalog link was already copied by wave 4."""
    db.add_all([
        m.InternalControlRiskLink(id=1, control_id=21, risk_id=1, link_type="monitors", effectiveness_rating="high"),
        m.ControlWorkRiskLink(id=5, work_item_id=62, tenant_id=1, risk_id=1),
        m.RiskControlLink(id=7, risk_id=1, normalized_control_id=31, freq_reduction_min_pct=10, freq_reduction_ml_pct=30,
                          freq_reduction_max_pct=50, effect_rationale="Limits cap a single payment"),
        m.RiskFrameworkControlLink(id=1, risk_id=1, framework_control_id=41, mitigation_effectiveness="minimal"),
        m.RiskFrameworkRequirementLink(id=1, risk_id=1, uploaded_framework_id=1, parsed_control_id=51,
                                       control_code="M2.3.1", mitigation_effectiveness="full"),
        m.RiskControl(tenant_id=1, risk_id=1, control_source="catalog", control_id=41, legacy_table="grc_risk_framework_control_links",
                      legacy_id=1),
    ])
    db.commit()


def test_the_old_rows_are_copied_once_with_what_each_link_said(db):
    seed_old_rows(db)
    assert copy_legacy_links(db) == 3                    # the work-item row and the requirement row name the same link
    assert copy_legacy_links(db) == 0
    assert {r.legacy_table for r in db.query(m.RiskControlLegacyCopy)} == {
        "grc_internal_control_risk_links", "grc_control_work_risk_links", "grc_risk_control_links",
        "grc_risk_framework_control_links", "grc_risk_framework_requirement_links"}
    internal, library = link_of(db, "internal"), link_of(db, "normalized")
    assert (internal.link_type, internal.effectiveness_rating) == ("monitors", "high")
    assert (library.freq_reduction_ml_pct, library.effect_rationale) == (30, "Limits cap a single payment")
    assert link_of(db, "catalog").mitigation_effectiveness == "minimal"     # filled on the row wave 4 had copied
    assert link_of(db, "framework").mitigation_effectiveness == "full"
    assert old_rows(db) == 5                                                 # the old rows stay as they were


def test_a_link_removed_after_the_copy_does_not_come_back_and_reads_no_longer_copy(db):
    seed_old_rows(db)
    copy_legacy_links(db)
    http = client(db)
    assert http.delete(f"/erm/internal-controls/risk-links/1/{link_of(db, 'internal').id}").status_code == 204
    copy_legacy_links(db)
    risk_control_links(db, [1])
    assert link_of(db, "internal") is None
    # a row an older screen writes after the copy is not picked up on read
    db.query(m.InternalControlRiskLink).delete()
    db.add(m.InternalControlRiskLink(id=2, control_id=21, risk_id=1))
    db.commit()
    assert [c for c in risk_control_links(db, [1])[1] if c["source"] == "internal"] == []


def test_the_copy_runs_from_the_engine_hook(db):
    seed_old_rows(db)
    assert copy_legacy_links_for_engine(db.get_bind()) == 3
    assert copy_legacy_links_for_engine(db.get_bind()) == 0
    db.expire_all()
    assert link_of(db, "internal") is not None


def test_old_ids_still_unlink_in_the_workbench_and_the_register(db):
    seed_old_rows(db)
    copy_legacy_links(db)
    http = client(db)
    assert http.delete("/workbench/risks/5").status_code == 200              # the old work-item link id
    assert link_of(db, "framework") is None
    assert http.delete("/workbench/risks/7").status_code == 200              # the old library link id
    assert link_of(db, "normalized") is None
    assert http.delete("/erm/internal-controls/21/risks/1").status_code == 204   # the old internal-control link id
    assert link_of(db, "internal") is None
    assert http.delete("/workbench/risks/999").status_code == 404


# ── FAIR reads and writes the control effect on the one link ─────────────────

def test_fair_models_the_effect_on_the_link_the_risk_detail_lists(db):
    seed_old_rows(db)
    copy_legacy_links(db)
    http = client(db)
    listed = http.get("/risks/1/detail").json()["linked_controls"]
    assert [c["id"] for c in listed] == [link_of(db, "normalized").id]
    effect = build_control_effects(db, 1, [listed[0]["id"]])
    assert effect[0]["freq"] == (10, 30, 50) and effect[0]["label"] == "Payment limits"     # carried by the copy
    saved = http.put(f"/erm/quantification/control-links/{listed[0]['id']}/effect",
                     json={"freq_reduction": None, "mag_reduction": {"min": 5, "ml": 10, "max": 20}, "rationale": "Caps"})
    assert saved.status_code == 200, saved.text
    effect = build_control_effects(db, 1, [listed[0]["id"]])
    assert (effect[0]["freq"], effect[0]["mag"]) == (None, (5, 10, 20))
    assert db.get(m.RiskControlLink, 7).mag_reduction_ml_pct is None                       # the old row is not written


# ── the bow-tie narrative is told what was saved ─────────────────────────────

def test_the_bow_tie_narrative_is_told_the_saved_causes_and_consequences(db, monkeypatch):
    from types import SimpleNamespace
    http = client(db)
    assert http.post("/erm/analytics/bowtie/1/items", json={"side": "cause", "title": "Manual keying"}).status_code == 201
    assert http.post("/erm/analytics/bowtie/1/items",
                     json={"side": "consequence", "title": "Funds lost", "impact_category": "financial"}).status_code == 201
    prompts = []

    def create(**kw):
        prompts.append(kw["messages"][-1]["content"])
        return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content="narrative"))])

    monkeypatch.setattr("openai.OpenAI", lambda **kw: SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create))))
    assert http.post("/erm/analytics/bowtie/1/ai-narrative").status_code == 200
    assert "Manual keying" in prompts[0] and "Funds lost (financial)" in prompts[0]
    assert "Potential operational threat" not in prompts[0] and "Business impact" not in prompts[0]
