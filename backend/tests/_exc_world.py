"""A small organisation for the exception tests (DECISIONS D58, D62): the people, roles and rights of ``test_exception_approval_rules.py``, plus
implementers, assets, a risk-register entry, evidence and documents of several types in the units of a department tree. Over HTTP through the
whole governance router with real tokens on in-memory SQLite (foreign keys on, a session that does not flush by itself).

    Operations (owner OPS) > Support (owner SUP) > Helpdesk (no owner);  Finance (no owner);  Old unit (switched off)
    documents: 1 policy in Support, 2 standard in Finance, 3 policy in no unit, 4 policy in Helpdesk, 5 procedure in Support, 6 guideline in Finance
"""
import os

os.environ.setdefault("SESSION_SECRET", "unit-test-secret")
os.environ.setdefault("OPENAI_API_KEY", "dummy")

from datetime import datetime, timedelta  # noqa: E402
from types import SimpleNamespace  # noqa: E402

import pytest  # noqa: E402
from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import create_engine, event  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402

import grc.models as m  # noqa: E402
from grc.modules.governance import exception_approvals as svc  # noqa: E402
from grc.modules.governance.router import router as governance_router  # noqa: E402
from grc.routers.auth_router import create_access_token  # noqa: E402

(PLAIN, ADMIN, REQ, REV1, REV2, APP1, APP2, APP3, OPS, SUP, SETTER, EXCADMIN, IMPL1, IMPL2, OTHER) = range(1, 16)
EX = "/governance/policy-exceptions"
RULES = "/governance/exception-approval-rules"
SEEN = []          # the alerts the tests ask about: (user ids, subject)


@pytest.fixture(scope="module")
def _schema():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    m.Base.metadata.create_all(engine)
    yield engine
    engine.dispose()


@pytest.fixture
def w(_schema, monkeypatch):
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    event.listen(engine, "connect", lambda conn, _record: conn.execute("PRAGMA foreign_keys=ON"))
    _schema.raw_connection().driver_connection.backup(engine.raw_connection().driver_connection)
    db = sessionmaker(bind=engine, autoflush=False)()
    db.add(m.Tenant(id=1, name="Acme", slug="acme", primary_contact_email="boss@acme.test"))
    db.add(m.Tenant(id=2, name="Other", slug="other"))
    names = {PLAIN: "plain", ADMIN: "ada", REQ: "rita", REV1: "rev1", REV2: "rev2", APP1: "app1", APP2: "app2", APP3: "app3", OPS: "ops",
             SUP: "sup", SETTER: "setter", EXCADMIN: "eve", IMPL1: "impl1", IMPL2: "impl2", OTHER: "other"}
    for uid, name in names.items():
        db.add(m.GRCUser(id=uid, username=name, email=f"{name}@acme.test", display_name=name.title()))
    roles = {1: "Administrator", 2: "Requesters", 3: "Approvers", 4: "Settings editors", 5: "Risk committee", 6: "Exception admins", 7: "Implementers"}
    for rid, name in roles.items():
        db.add(m.Role(id=rid, tenant_id=1, name=name))
    db.add(m.Role(id=9, tenant_id=2, name="Somebody else's role"))
    for pid, perm in enumerate(["governance:policy_exceptions:create", "governance:policy_exceptions:approve",
                                "governance:settings:edit", "governance:policy_exceptions:edit"], start=1):
        db.add(m.Permission(id=pid, name=perm, resource=perm.rsplit(":", 1)[0], action=perm.rsplit(":", 1)[1]))
    for rid, pid in [(2, 1), (3, 2), (4, 3), (6, 4), (6, 2)]:
        db.add(m.RolePermission(role_id=rid, permission_id=pid))
    for uid, rid in [(ADMIN, 1), (REQ, 2), (APP1, 3), (APP2, 3), (APP3, 3), (SETTER, 4), (REV1, 5), (REV2, 5), (EXCADMIN, 6), (IMPL1, 7), (IMPL2, 7)]:
        db.add(m.UserRole(user_id=uid, role_id=rid, tenant_id=1, source=None))
    db.add(m.GRCDepartment(id=10, tenant_id=1, name="Operations", code="OPS", department_head_user_id=OPS))
    db.add(m.GRCDepartment(id=11, tenant_id=1, name="Support", code="SUP", parent_department_id=10, department_head_user_id=SUP))
    db.add(m.GRCDepartment(id=12, tenant_id=1, name="Helpdesk", code="HELP", parent_department_id=11))
    db.add(m.GRCDepartment(id=13, tenant_id=1, name="Finance", code="FIN"))
    db.add(m.GRCDepartment(id=14, tenant_id=1, name="Old unit", code="OLD", is_active=False))
    db.add(m.GRCDepartment(id=90, tenant_id=2, name="Elsewhere", code="ELSE"))
    for did, dept, kind in [(1, 11, "policy"), (2, 13, "standard"), (3, None, "policy"), (4, 12, "policy"), (5, 11, "procedure"), (6, 13, "guideline")]:
        db.add(m.GovernanceDocument(id=did, tenant_id=1, title=f"Doc {did}", doc_type=kind, status="published", current_version="1.0",
                                    published_version="1.0", owner_id=REQ, department_id=dept, document_code=f"DOC-{did}"))
    for aid, name, crit in [(1, "Core banking", "critical"), (2, "Intranet", "low"), (3, "Payments hub", "high")]:
        db.add(m.ITAsset(id=aid, tenant_id=1, name=name, asset_type="application", criticality=crit, confidentiality_rating=3, integrity_rating=3,
                         availability_rating=3, status="active"))
    db.add(m.ITAsset(id=50, tenant_id=2, name="Elsewhere asset", asset_type="application", criticality="low", status="active"))
    db.add(m.Risk(id=5, tenant_id=1, title="Register risk", category="compliance", status="open"))
    db.add(m.Risk(id=90, tenant_id=2, title="Other tenant's risk", category="compliance", status="open"))
    db.add(m.Evidence(id=1, tenant_id=1, name="Penetration test summary"))
    db.add(m.Evidence(id=90, tenant_id=2, name="Other tenant's evidence"))
    db.commit()
    app = FastAPI()
    app.include_router(governance_router)
    app.dependency_overrides[m.get_db] = lambda: db
    SEEN.clear()
    monkeypatch.setattr(svc, "_alert", lambda db_, tenant, user_ids, subject, message, exception_id: SEEN.append((sorted({int(u) for u in user_ids if u}), subject)))

    def as_(uid):
        token = create_access_token({"sub": db.get(m.GRCUser, uid).username, "tenant_slug": "acme", "tenant_id": 1})
        return TestClient(app, headers={"Authorization": "Bearer " + token})

    yield SimpleNamespace(db=db, as_=as_)
    db.close()


# ── helpers ──────────────────────────────────────────────────────────────────
def step(kind="approval", people=None, **kw):
    return {"kind": kind, "people": people if people is not None else [{"type": "user", "id": APP1}], **kw}


def implementer(people=None, **kw):
    return {"people": people if people is not None else [{"type": "user", "id": IMPL1}], **kw}


def make_rule(w, name="Rule", steps=None, as_user=SETTER, **kw):
    body = {"name": name, "steps": steps if steps is not None else [step()], **kw}
    r = w.as_(as_user).post(RULES, json=body)
    assert r.status_code == 201, r.text
    return r.json()


def raise_exception(w, document_id=1, priority="medium", as_user=REQ, **kw):
    r = w.as_(as_user).post(EX, json={"title": "Skip backups", "justification": "Legacy box", "document_id": document_id, "priority": priority, **kw})
    assert r.status_code == 201, r.text
    return r.json()


def submit(w, eid, as_user=REQ):
    return w.as_(as_user).post(f"{EX}/{eid}/submit")


def get(w, eid, as_user=ADMIN):
    r = w.as_(as_user).get(f"{EX}/{eid}")
    assert r.status_code == 200, r.text
    return r.json()


def assess(w, eid, who, **body):
    """What a reviewer or an approver records at their step: by default that they found none."""
    return w.as_(who).post(f"{EX}/{eid}/risks", json=body or {"none_identified": True})


def record(w, eid, who, title="Backups could fail unnoticed", likelihood=3, impact=4, **kw):
    r = w.as_(who).post(f"{EX}/{eid}/risks", json={"title": title, "likelihood": likelihood, "impact": impact, **kw})
    assert r.status_code == 201, r.text
    return r.json()


def decide(w, eid, who, what="approve", assessed=True, **body):
    if what == "approve" and assessed:
        assess(w, eid, who)
    path = {"approve": "approve", "reject": "reject", "changes": "request-changes"}[what]
    return w.as_(who).post(f"{EX}/{eid}/{path}", json=body)


def approved(w, rule_kw=None, document_id=1, **kw):
    """An exception submitted under a one-step rule (approver APP1) and approved: its id."""
    make_rule(w, **(rule_kw or {}))
    eid = raise_exception(w, document_id=document_id, **kw)["id"]
    assert submit(w, eid).status_code == 200
    r = decide(w, eid, APP1)
    assert r.status_code == 200, r.text
    return eid


def choose_implementer(w, eid, impl=None, as_user=REQ):
    """What the requester does in the form: the exception names who carries it out (IMPL1 unless said otherwise)."""
    r = w.as_(as_user).put(f"{EX}/{eid}", json={"implementer": impl if impl is not None else implementer()})
    assert r.status_code == 200, r.text
    return r.json()


def implementing(w, impl=None, document_id=1, **kw):
    """An exception approved under a rule, which its requester said IMPL1 (unless said otherwise) carries out: its id, the approver's potential risk recorded."""
    make_rule(w)
    eid = raise_exception(w, document_id=document_id, implementer=impl if impl is not None else implementer(), **kw)["id"]
    assert submit(w, eid).status_code == 200
    risk = record(w, eid, APP1)
    r = w.as_(APP1).post(f"{EX}/{eid}/approve", json={})
    assert r.status_code == 200, r.text
    return eid, risk
