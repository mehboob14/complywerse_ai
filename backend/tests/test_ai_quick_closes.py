"""Small closes of AI data exposure found in the census: the ambient dashboard insights send labels, not titles;
pages say "AI", not a model name; and no part of an API key is logged."""
import importlib
import json
import re
from datetime import datetime, timedelta
from pathlib import Path
from types import SimpleNamespace

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

import grc.models as m

# grc.routers re-exports the APIRouter objects under these names, so import the modules themselves
risk_ai = importlib.import_module("grc.routers.ai_risk_assessment_router")
dashboard_router = importlib.import_module("grc.routers.dashboard_router")

RISK, OTHER_RISK = "Project Falcon data breach", "Ransomware at the data centre"
EVIDENCE, ACTION = "Acme-Q3-audit-confidential.pdf", "Rotate the Acme VPN keys"


@pytest.fixture
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    m.Base.metadata.create_all(engine)
    with Session(engine) as session:
        now = datetime.utcnow()
        session.add(m.Tenant(id=1, name="Demo Bank", slug="demo"))
        session.add(m.Risk(id=1, tenant_id=1, title=RISK, category="operational", status="open", inherent_score=18))
        session.add(m.Risk(id=2, tenant_id=1, title=OTHER_RISK, category="operational", status="open", inherent_score=12))
        session.add(m.RiskMitigationAction(id=1, risk_id=2, title=ACTION, status="not_started", due_date=now - timedelta(days=9)))
        session.add(m.Evidence(id=1, tenant_id=1, name=EVIDENCE, expiry_date=now + timedelta(days=10)))
        session.add(m.RCSAAssessment(id=1, tenant_id=1, campaign_id=1, business_unit_id=1, status="in_progress"))
        session.commit()
        yield session


def test_dashboard_insights_send_labels_not_titles_and_the_answer_gets_the_real_names_back(db, monkeypatch):
    sent = {}

    def create(**kwargs):
        sent["prompt"] = "\n".join(msg["content"] for msg in kwargs["messages"])
        answer = [{"title": "Add controls to Risk #1", "severity": "high", "category": "risk", "action_link": "/erm/risks",
                   "rationale": "Risk #1 is open, Evidence #1 expires soon and Mitigation action #1 is late; Risk #11 is unrelated.",
                   "action_text": "Open Risk #1"}]
        return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=json.dumps(answer)))])

    client = SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create)))
    monkeypatch.setattr(dashboard_router, "get_openai_client", lambda: client)
    monkeypatch.setattr(dashboard_router, "get_user_tenants", lambda user, session: [1])

    out = dashboard_router.get_ai_insights(tenant_id=None, db=db, current_user=SimpleNamespace(id=3))

    prompt = sent["prompt"]
    assert not any(secret in prompt for secret in (RISK, OTHER_RISK, EVIDENCE, ACTION)), "a title or file name reached the model"
    assert all(label in prompt for label in ("Risk #1", "Evidence #1", "Mitigation action #1", "RCSA assessment #1"))
    rec = out["recommendations"][0]
    assert rec["title"] == f"Add controls to {RISK}" and rec["action_text"] == f"Open {RISK}"
    assert f"Risk {RISK}" not in rec["rationale"] and EVIDENCE in rec["rationale"] and ACTION in rec["rationale"]
    assert "Risk #11" in rec["rationale"]            # a label that is not ours is left alone, not half-replaced
    assert out["signals"]["risks_without_controls"][0]["title"] == RISK     # the page's own payload is unchanged


def test_a_page_never_gets_a_model_name():
    assert risk_ai._public_ai_model("gpt-4o-mini") == "AI" and risk_ai._public_ai_model("claude-sonnet") == "AI"
    assert risk_ai._public_ai_model("rules.v1") == "rules.v1" and risk_ai._public_ai_model(None) is None


def test_no_part_of_the_api_key_is_logged():
    source = (Path(risk_ai.__file__).parents[1] / "modules/chatbot/complychat/complychat/grc_sql_agent.py").read_text(encoding="utf-8")
    assert "api_key_preview" not in source and not re.search(r"OPENAI_API_KEY\[", source)
