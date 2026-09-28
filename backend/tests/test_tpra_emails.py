"""The emails third-party risk sends, in the tenant's own words.

Wording is checked before it is kept: only an email's own placeholders, and a
supplier email keeps its link. Values are escaped in HTML and links made
clickable. The built-in wording says what was sent before; a tenant's change is
used by the reminder sweep and the questionnaire invitation alike, and a reset
goes back.
"""
from datetime import date, datetime, timedelta

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from grc.models import (
    Base, GRCUser, Tenant, TPRAAuditLog, TPRAContract, TPRAEmailTemplate, Vendor, VendorQuestionnaireResponse, get_db,
)
from grc.modules.vendor_risk.tpra import emails, rbac, reminders
from grc.modules.workflow_engine.services import email_service
from grc.routers.auth_router import require_auth


def test_wording_is_checked_before_it_is_kept():
    assert emails.check("reminder", "  Due:\n {title} ", "{title}\r\n\r\nOpen: {link}") == ("Due: {title}", "{title}\n\nOpen: {link}")
    with pytest.raises(ValueError, match=r"\{vendr\} is not one of"):
        emails.check("reminder", "{vendr}", "x")
    with pytest.raises(ValueError, match=r"keep \{link\}"):
        emails.check("questionnaire_invite", "Hello", "Please fill it in.")
    with pytest.raises(ValueError):
        emails.check("reminder", "", "x")
    with pytest.raises(ValueError):
        emails.check("reminder", "x", "y" * 5001)


def test_values_are_escaped_and_links_made_clickable():
    html = emails.to_html("Hello {vendor},\n\nOpen: {link}\nThanks", {"vendor": "<b>Evil</b> & Co", "link": "https://grc.test/q/a?x=1&y=2"})
    assert html == ('<p>Hello &lt;b&gt;Evil&lt;/b&gt; &amp; Co,</p>'
                    '<p>Open: <a href="https://grc.test/q/a?x=1&amp;y=2">https://grc.test/q/a?x=1&amp;y=2</a><br>Thanks</p>')
    assert emails.fill("{title} {unknown}", "{title}", {"title": "T"})[0] == "T {unknown}"


def test_the_built_in_wording_is_what_went_out_before():
    t, link = "Contract 'MSA' with Acme is due in 10 days", "https://grc.test/c"
    s, body, _ = emails.fill(emails.CATALOGUE["reminder"]["subject"], emails.CATALOGUE["reminder"]["body"], {"title": t, "link": link})
    assert (s, body) == (t, f"{t}.\n\nOpen: {link}")
    s, _, _ = emails.fill(emails.CATALOGUE["escalation"]["subject"], emails.CATALOGUE["escalation"]["body"], {"title": t})
    assert s == f"Escalation: {t}"
    s, body, _ = emails.fill(emails.CATALOGUE["questionnaire_reminder"]["subject"], emails.CATALOGUE["questionnaire_reminder"]["body"],
                             {"title": "Reminder: the questionnaire for Acme, due in 5 days", "link": link})
    assert s.startswith("Reminder: the questionnaire for Acme") and body.endswith(f"Open the questionnaire: {link}")
    for key, spec in emails.CATALOGUE.items():                             # the defaults pass their own check
        assert emails.check(key, spec["subject"], spec["body"])


@pytest.fixture()
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    s = sessionmaker(bind=engine)()
    s.add(Tenant(id=1, name="Acme Bank", slug="acme"))
    s.add(GRCUser(id=7, username="admin", email="admin@acme.test", display_name="Ada Admin", is_active=True))
    s.add(Vendor(id=1, tenant_id=1, name="Payroll Co", status="active", tier="high", owner_id=7))
    s.commit()
    yield s
    s.close()


@pytest.fixture()
def client(db, monkeypatch):
    monkeypatch.setattr(rbac, "require_write", lambda *a, **k: None)
    app = FastAPI()
    app.include_router(emails.router)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[require_auth] = lambda: db.get(GRCUser, 7)
    return TestClient(app)


def test_a_tenant_changes_previews_tests_and_resets_its_wording(db, client, monkeypatch):
    listed = client.get("/email-templates").json()["items"]
    assert [t["key"] for t in listed] == list(emails.CATALOGUE) and not any(t["changed"] for t in listed)
    preview = client.post("/email-templates/questionnaire_invite/preview",
                          json={"subject": "Your {vendor} review", "body": "Dear {vendor},\n\n{link}"}).json()
    assert preview["subject"] == "Your Payroll Co review" and "<a href=" in preview["html"]
    assert client.post("/email-templates/reminder/preview", json={"subject": "{nope}", "body": "x"}).status_code == 400
    saved = client.put("/email-templates/reminder", json={"subject": "Action needed: {title}", "body": "{title}\n\nGo to {link}"}).json()
    assert saved["changed"] and saved["updated_by"] == "Ada Admin"
    assert emails.render(db, 1, "reminder", {"title": "T", "link": "L"})[:2] == ("Action needed: T", "T\n\nGo to L")
    sent = []
    monkeypatch.setattr(email_service, "send_email", lambda db, tid, to, subject, html, text: sent.append((to, subject)) or {"success": True})
    assert client.post("/email-templates/reminder/test").json() == {"sent_to": "admin@acme.test"}
    assert sent == [("admin@acme.test", "[Test] Action needed: Contract 'MSA' with Payroll Co is due in 14 days (10 Oct 2026)")]
    assert not client.delete("/email-templates/reminder").json()["changed"]
    assert db.query(TPRAEmailTemplate).count() == 0
    assert {r.action for r in db.query(TPRAAuditLog).filter_by(entity="email_template")} == {"update", "reset"}
    assert client.get("/email-templates/nothing").status_code in (404, 405)
    assert client.put("/email-templates/nothing", json={"subject": "a", "body": "b"}).status_code == 404


def test_the_reminder_sweep_and_the_invitation_use_the_tenants_wording(db, monkeypatch):
    db.add(TPRAEmailTemplate(tenant_id=1, key="reminder", subject="[TPRM] {title}", body="{title}\n\n{link}"))
    db.add(TPRAContract(tenant_id=1, vendor_id=1, title="MSA", status="active", renewal_date=datetime(2026, 10, 3)))
    db.commit()
    got = []
    reminders.run(db, 1, {"remind_before_days": 14}, today=date(2026, 9, 23),
                  deliver=lambda db, tid, uid, subject, message: got.append((subject, message)))
    assert got and got[0][0].startswith("[TPRM] Contract 'MSA' with Payroll Co") and got[0][1].endswith("/vendor-risk/contracts?contract=1")

    db.add(TPRAEmailTemplate(tenant_id=1, key="questionnaire_invite", subject="{organisation}: questions for {vendor}",
                             body="Please answer by {due}: {link}"))
    db.add(VendorQuestionnaireResponse(id=5, tenant_id=1, vendor_id=1, token="tok", respondent_email="sam@payroll.test",
                                       status="pending", due_date=datetime(2026, 10, 30)))
    db.commit()
    sent = []
    monkeypatch.setattr(email_service, "send_email", lambda db, tid, to, subject, html, text: sent.append((to, subject, text)) or {"success": True})
    from grc.tasks import tprm
    tprm.send_questionnaire_invite.run("acme", 5, base_url="https://grc.test", db=db)
    assert sent == [("sam@payroll.test", "Acme Bank: questions for Payroll Co",
                     "Please answer by on 30 Oct 2026: https://grc.test/vendor-risk/questionnaires/tok")]
