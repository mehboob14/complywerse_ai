"""Comply analyses beyond the numbers: insurance cover, the AI's write-up, the overview.

With the supplier's cover recorded, the simulation says how often a year's loss
exceeds it and how far the one-in-twenty year falls short. The AI writes the
result up from the figures alone, into fixed fields; an answer it cannot keep to
them is refused, and a write-up says when the inputs have moved since. The
overview counts the analyses and lists the largest and the under-insured.
"""
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from grc.models import Base, GRCUser, Tenant, TPRAFairAnalysis, Vendor, get_db
from grc.modules.vendor_risk.tpra import fair, rbac
from grc.routers.auth_router import require_auth
from grc.services import assessment_evidence_ai


def _inputs(**kw):
    base = {"tef": [2, 2, 2], "vulnerability": [1, 1, 1], "primary": {"response": [1000, 1000, 1000]},
            "secondary": {}, "iterations": 20000}
    base.update(kw)
    return fair.clean(base)


def test_the_cover_is_set_against_the_simulated_years():
    short = fair.simulate(_inputs(), 1, cover=2000)["cover"]
    assert 0.25 < short["chance_exceeded"] < 0.40                   # Poisson(2) × 1,000 is over 2,000 in about 32% of years
    assert short["covers_one_in_twenty"] is False and short["gap_one_in_twenty"] == fair.simulate(_inputs(), 1)["annual"]["p95"] - 2000
    ample = fair.simulate(_inputs(), 1, cover=1_000_000)["cover"]
    assert ample["chance_exceeded"] == 0 and ample["covers_one_in_twenty"] and ample["gap_one_in_twenty"] == 0
    assert fair.simulate(_inputs(), 1)["cover"] is None


@pytest.fixture()
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    s = sessionmaker(bind=engine)()
    s.add(Tenant(id=1, name="Acme", slug="acme"))
    s.add(GRCUser(id=7, username="analyst", email="a@acme.test", display_name="Ana Lyst", is_active=True))
    s.add(Vendor(id=1, tenant_id=1, name="Payroll Co", status="active", tier="critical", owner_id=7))
    s.commit()
    yield s
    s.close()


@pytest.fixture()
def http(db, monkeypatch):
    monkeypatch.setattr(rbac, "require_write", lambda *a, **k: None)
    monkeypatch.setattr(fair, "get_user_tenants", lambda user, db: [1])
    app = FastAPI()
    app.include_router(fair.router)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[require_auth] = lambda: db.get(GRCUser, 7)
    return TestClient(app)


REPLY = ('{"risk_level": "high", "confidence": "medium", "summary": "A bad year costs about 3,000.",'
         ' "reasons": ["Losses happen in most years"], "actions": ["Cap liability at 5,000", ""],'
         ' "insurance": "The cover falls short of the one-in-twenty year."}')


def test_the_ai_writes_the_result_up_and_says_when_it_is_out_of_date(db, http, monkeypatch):
    made = http.post("/fair", json={"vendor_id": 1, "name": "Payroll breach", "inputs": _inputs(),
                                    "insurance_cover": 2000}).json()
    assert made["result"]["cover"]["amount"] == 2000 and made["insurance_cover"] == 2000
    asked = []
    monkeypatch.setattr(assessment_evidence_ai, "openai_complete", lambda messages, **kw: asked.append(messages) or REPLY)
    written = http.post(f"/fair/{made['id']}/write-up").json()
    review = written["ai_review"]
    assert (review["risk_level"], review["confidence"], review["actions"]) == ("high", "medium", ["Cap liability at 5,000"])
    assert review["by"] == "Ana Lyst" and written["ai_review_stale"] is False
    sent = asked[0][1]["content"]
    assert "Supplier's cyber insurance cover: 2,000" in sent and "One year in twenty" in sent
    moved = http.put(f"/fair/{made['id']}", json={"insurance_cover": None}).json()
    assert moved["insurance_cover"] is None and moved["result"]["cover"] is None and moved["ai_review_stale"] is True
    monkeypatch.setattr(assessment_evidence_ai, "openai_complete", lambda messages, **kw: '{"risk_level": "dreadful"}')
    assert http.post(f"/fair/{made['id']}/write-up").status_code == 502      # not a write-up it can keep to the fields


def test_the_overview_counts_and_finds_the_largest_and_the_under_insured(db, http):
    http.post("/fair", json={"vendor_id": 1, "name": "Small", "inputs": _inputs(), "insurance_cover": 1_000_000})
    big = http.post("/fair", json={"vendor_id": 1, "name": "Big", "status": "final", "insurance_cover": 5000,
                                   "inputs": _inputs(primary={"response": [9000, 9000, 9000]})}).json()
    got = http.get("/fair/overview").json()
    assert (got["count"], got["finals"], got["drafts"], got["suppliers"], got["no_cover"]) == (2, 1, 1, 1, 0)
    assert [x["name"] for x in got["largest"]] == ["Big", "Small"]
    assert [x["name"] for x in got["under_insured"]] == ["Big"] and got["average_year"] == big["annual"]["mean"]
    assert db.query(TPRAFairAnalysis).count() == 2
