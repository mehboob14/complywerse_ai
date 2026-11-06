"""Shadow SaaS: apps in use that no one assessed, scored, and decided once.

Exports are read whatever their columns are called; apps already on the
register are reported, not added; a decision survives the next import. An
onboarded app becomes a request pre-answered only where discovery gives a
reason; a denied one can be blocked at the web gateway and is unblocked if
reopened.
"""
import io
from datetime import datetime

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from grc.models import Base, GRCUser, Tenant, TPRAAuditLog, TPRAShadowApp, Vendor, get_db
from grc.modules.connectors.providers import saas_governance as gov
from grc.modules.vendor_risk.tpra import graph, rbac, shadow_saas
from grc.routers.auth_router import require_auth


def test_rows_are_read_whatever_the_tool_calls_its_columns():
    row = shadow_saas.from_row({"Application Name": " Notion ", "App URL": "https://www.notion.so/login", "Users Count": "1,204",
                                "MFA Supported": "No", "Upload Bytes": "2.5 GB", "Breaches in 3 years": "1",
                                "Risk Types": "data leakage; account takeover", "Business Owner": "Dana", "Ignored": "x"})
    assert (row["name"], row["domain"], row["users"], row["owner_name"]) == ("Notion", "notion.so", 1204, "Dana")
    assert row["facts"] == {"mfa": False, "upload_bytes": int(2.5 * 1024 ** 3), "breaches_3y": 1,
                            "risk_types": ["data leakage", "account takeover"]}
    assert shadow_saas.from_row({"url": "x.test"}) is None                     # no name, no app
    grip = shadow_saas.from_grip({"id": 42, "name": "Miro", "url": "https://miro.com", "gripData": {
        "category": "Collaboration", "riskScore": 71, "numberOfUsers": 58, "SSOPercentage": 20, "mfaSupported": True,
        "oauthScopes": {"high": {"count": 3}}, "aiDepth": {"level": "Moderate"}, "primaryContact": {"email": "Pat@acme.test"}}})
    assert (grip["external_id"], grip["source_risk"], grip["owner_email"]) == ("42", 71, "pat@acme.test")
    assert grip["facts"] == {"mfa": True, "sso_pct": 20, "oauth_high": 3, "ai": "Moderate"}


def test_the_score_explains_itself():
    risk, why = shadow_saas.score(1204, {"mfa": False, "upload_bytes": 3 * 1024 ** 3, "oauth_high": 2, "breaches_3y": 3})
    assert risk == 20 + 15 + 15 + 15 + 20 and shadow_saas.level(risk) == "high"
    assert why[0] == "1204 of our people use it" and "3.0 GB uploaded to it" in why
    assert shadow_saas.score(None, {}) == (5, ["Multi-factor sign-in not known"])


@pytest.fixture()
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    s = sessionmaker(bind=engine)()
    s.add(Tenant(id=1, name="Acme", slug="acme"))
    s.add_all([GRCUser(id=7, username="it", email="it@acme.test", is_active=True),
               GRCUser(id=9, username="dana", email="dana@acme.test", is_active=True)])
    s.add(Vendor(id=1, tenant_id=1, name="Slack Technologies", status="active", website="https://slack.com", owner_id=7))
    s.commit()
    yield s
    s.close()


@pytest.fixture()
def client(db, monkeypatch):
    monkeypatch.setattr(rbac, "require_write", lambda *a, **k: None)
    monkeypatch.setattr(graph, "shadow_suppliers", lambda db, tid, limit=100: [
        {"name": "Dropbox", "asset_count": 4, "products": ["Dropbox client"], "sources": ["installed software"]}])
    app = FastAPI()
    app.include_router(shadow_saas.router)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[require_auth] = lambda: db.get(GRCUser, 7)
    return TestClient(app)


CSV = ("name,domain,users,mfa,owner email,file sharing,description\n"
       "Notion,notion.so,120,no,dana@acme.test,yes,Team wiki\n"
       "Slack,slack.com,300,yes,,,Chat\n"
       "Canva,canva.com,12,,,,Design\n")


def _upload(client, text, dry_run):
    return client.post("/shadow-saas/import", params={"dry_run": dry_run},
                       files={"file": ("apps.csv", io.BytesIO(text.encode()), "text/csv")}).json()


def test_import_previews_then_brings_apps_in_and_keeps_decisions(db, client):
    preview = _upload(client, CSV, True)
    assert (preview["new"], preview["updated"], preview["suppliers"][0]["supplier"]) == (2, 0, "Slack Technologies")
    assert db.query(TPRAShadowApp).count() == 0
    done = _upload(client, CSV, False)
    assert done["new"] == 2 and db.query(TPRAShadowApp).count() == 2
    board = client.get("/shadow-saas").json()
    assert [r["name"] for r in board["items"]] == ["Notion", "Canva"] and board["counts"]["pending"] == 2
    assert board["people_on_pending"] == 132 and board["records"][0]["name"] == "Dropbox"
    canva = next(r for r in board["items"] if r["name"] == "Canva")
    assert client.post(f"/shadow-saas/{canva['id']}/dismiss", json={"note": "no"}).status_code == 400
    client.post(f"/shadow-saas/{canva['id']}/dismiss", json={"note": "Free trial, one person, removed"})
    again = _upload(client, CSV.replace("Canva,canva.com,12", "Canva,canva.com,40"), False)
    assert (again["new"], again["updated"]) == (0, 2)
    canva_row = db.get(TPRAShadowApp, canva["id"])
    assert (canva_row.status, canva_row.users) == ("dismissed", 40)          # the decision stands, the facts refresh


def test_onboarding_makes_a_request_pre_answered_only_where_discovery_says_why(db, client):
    _upload(client, CSV, False)
    notion = db.query(TPRAShadowApp).filter_by(name="Notion").one()
    made = client.post(f"/shadow-saas/{notion.id}/onboard", json={}).json()
    v = db.get(Vendor, made["request_id"])
    assert (v.status, v.intake_status, v.owner_id, v.website) == ("requested", "draft", 9, "https://notion.so")
    answers = v.intake["answers"]
    assert answers["engagement_type"] == "saas" and answers["users_count"] == 120 and answers["hosts_data"] == "yes"
    assert "upload or share files" in v.intake["justifications"]["hosts_data"] and "confidential_data" not in answers
    assert client.post(f"/shadow-saas/{notion.id}/onboard", json={}).status_code == 400       # decided once
    db.add(TPRAShadowApp(id=50, tenant_id=1, name="Slack", domain="slack.com", status="pending", source="csv"))
    db.commit()
    assert client.post("/shadow-saas/50/onboard", json={}).status_code == 409                # already a supplier


class _Gateway:
    calls = []

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def block(self, domain):
        self.calls.append(("block", domain))

    def allow(self, domain):
        self.calls.append(("allow", domain))


def test_deny_blocks_at_the_gateway_and_reopening_unblocks(db, client, monkeypatch):
    _upload(client, CSV, False)
    notion = db.query(TPRAShadowApp).filter_by(name="Notion").one()
    no_gateway = client.post(f"/shadow-saas/{notion.id}/deny", json={"note": "Use Confluence instead", "block": True}).json()
    assert no_gateway["status"] == "denied" and "Connect Zscaler" in no_gateway["block_error"] and not no_gateway["blocked"]
    client.post(f"/shadow-saas/{notion.id}/reopen")
    monkeypatch.setattr(shadow_saas, "_gateway", lambda db, tid: _Gateway)
    blocked = client.post(f"/shadow-saas/{notion.id}/deny", json={"note": "Use Confluence instead", "block": True}).json()
    assert blocked["blocked"] and blocked["block_error"] is None
    reopened = client.post(f"/shadow-saas/{notion.id}/reopen").json()
    assert reopened["status"] == "pending" and not reopened["blocked"]
    assert _Gateway.calls == [("block", "notion.so"), ("allow", "notion.so")]
    assert {r.action for r in db.query(TPRAAuditLog).filter_by(entity="shadow_app")} >= {"decide", "block", "unblock", "reopen"}


def test_a_supplier_our_records_name_can_be_brought_in(db, client):
    made = client.post("/shadow-saas/from-records", json={"name": "dropbox"})
    assert made.status_code == 201 and made.json()["source"] == "records" and "4 asset" in made.json()["description"]
    assert client.post("/shadow-saas/from-records", json={"name": "Unheard Of"}).status_code == 404


def test_zscaler_obfuscates_the_key_and_activates_what_it_changes():
    assert gov._obfuscate("abcdefghijklmnopqrstuvwxyz0123456789", 1700000123456) == (1700000123456, "bcdefgcidjek")
    sent = []

    class Http:
        def _r(self, body=None):
            return type("R", (), {"raise_for_status": lambda s: None, "json": lambda s: body or {}})()

        def post(self, url, **kw):
            sent.append(("POST", url.rsplit("/api/v1", 1)[1], kw.get("json", {}).keys() if kw.get("json") else None))
            return self._r()

        def get(self, url, **kw):
            sent.append(("GET", url.rsplit("/api/v1", 1)[1], None))
            return self._r({"id": 5, "configuredName": "Denied SaaS", "customCategory": True, "urls": ["old.test"]})

        def put(self, url, **kw):
            sent.append(("PUT", url.rsplit("/api/v1", 1)[1], (kw["params"]["action"], kw["json"]["urls"])))
            return self._r()

        def delete(self, url, **kw):
            sent.append(("DELETE", url.rsplit("/api/v1", 1)[1], None))
            return self._r()

    creds = {"username": "u", "password": "p", "api_key": "abcdefghijklmnopqrstuvwxyz0123456789", "category_id": "5"}
    with gov.ZscalerSession(creds, http=Http()) as z:
        z.block("notion.so")
    assert [s[:2] for s in sent] == [("POST", "/authenticatedSession"), ("GET", "/urlCategories/5"),
                                     ("PUT", "/urlCategories/5"), ("POST", "/status/activate"),
                                     ("DELETE", "/authenticatedSession")]
    assert set(sent[0][2]) == {"apiKey", "username", "password", "timestamp"}
    assert sent[2][2] == ("ADD_TO_LIST", ["notion.so"])                       # only this domain, added to the list


def test_grip_is_read_page_by_page():
    pages = iter([[{"id": 1, "name": "A"}, {"id": 2, "name": "B"}], [{"id": 3, "name": "C"}]])
    seen = []

    def get(url, params=None, headers=None, timeout=None):
        seen.append((params["offset"], headers["access-token"]))
        return type("R", (), {"raise_for_status": lambda s: None, "json": lambda s, p=next(pages): p})()

    apps = gov.grip_apps("https://acme.dep.grip.security/public/saas", "tok", get=get, page=2)
    assert [a["name"] for a in apps] == ["A", "B", "C"] and seen == [(0, "tok"), (2, "tok")]
