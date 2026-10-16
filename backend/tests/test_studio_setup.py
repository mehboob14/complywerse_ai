"""Setting up a new document before Comply Agent writes it: the person picks from lists (the organisation's own data first) what it
covers and which rules it follows; the answers are instructions that the web research, the questions and the draft all follow."""
import json

import grc.models as m
from grc.modules.governance.studio import prompts, setup

from test_studio_draft import drafts, finished, new_policy, script          # noqa: F401  (drafts is a fixture)
from test_studio_flow import world                                          # noqa: F401  (world is a fixture)

SETUP = {"entity_type": "Commercial bank", "country": "Pakistan", "regulators": ["State Bank of Pakistan (SBP)", "State Bank of Pakistan (SBP)", " "],
         "regulations": ["BPRD Circular No. 05 of 2017"], "domains": ["Asset management", "Access control and identity"],
         "departments": ["IT Operations"], "audience": "All staff", "length": "short", "classification": "Confidential", "review_cycle": "Every two years"}


def test_the_lists_start_with_what_the_platform_knows_about_the_organisation(world):
    db = world.db
    db.get(m.Tenant, 1).geography = "Pakistan"
    db.add(m.GRCDepartment(tenant_id=1, name="IT Operations", code="IT-OPS", is_active=True))
    db.add(m.GRCDepartment(tenant_id=1, name="Closed Unit", code="OLD", is_active=False))
    db.add(m.BusinessUnit(tenant_id=1, name="Retail Banking"))
    db.add(m.RegulatoryFeedSource(tenant_id=1, name="SBP circulars", source_url="https://www.sbp.org.pk/rss", country="Pakistan", regulator="State Bank of Pakistan", is_active=True))
    db.add(m.RegulatoryChange(tenant_id=1, title="Enterprise Technology Governance & Risk Management Framework", source="SBP", regulation_reference="BPRD Circular No. 05 of 2017"))
    db.commit()
    s = world.http.post(world.api("/sessions"), json={"kind": "new", "title": "Asset Management Policy", "doc_type": "policy"}).json()
    world.http.post(world.api(f"/sessions/{s['id']}/references"), json={"kind": "framework", "source_id": 1, "scope": {"mode": "all"}})
    out = world.http.get(world.api(f"/sessions/{s['id']}/setup")).json()
    assert out["departments"] == ["IT Operations", "Retail Banking"]                                      # active departments, then business units
    assert out["regulators_followed"] == [{"label": "State Bank of Pakistan", "country": "Pakistan"}]
    assert out["regulations"] == [{"label": "Enterprise Technology Governance & Risk Management Framework (BPRD Circular No. 05 of 2017)", "detail": "SBP"}]
    assert out["frameworks"] == [{"id": 1, "label": "ISO/IEC 27001 (2022)", "attached": True}]
    assert out["country_from_profile"] == "Pakistan" and "State Bank of Pakistan (SBP)" in out["regulators"]["Pakistan"]
    assert [x["value"] for x in out["lengths"]] == ["short", "standard", "comprehensive"] and "Every two years" in out["review_cycles"]


def test_the_setup_is_kept_as_instructions_and_read_by_every_call(world):
    s = world.http.post(world.api("/sessions"), json={"kind": "new", "title": "Asset Management Policy", "doc_type": "policy"}).json()
    saved = world.http.patch(world.api(f"/sessions/{s['id']}"), json={"instructions": SETUP}).json()["instructions"]
    assert saved["regulators"] == ["State Bank of Pakistan (SBP)"]                                         # each once, no blanks
    text = prompts.instructions_text(saved)
    for line in ("Type of organisation: Commercial bank", "Country: Pakistan", "Regulators it answers to: State Bank of Pakistan (SBP)",
                 "Laws, regulations and circulars it must follow: BPRD Circular No. 05 of 2017",
                 "Subject areas it must cover: Asset management; Access control and identity", "Departments and units it applies to: IT Operations",
                 "Length: Short: the essentials, about 1 to 3 pages", "Classification: Confidential", "Review cycle: Every two years", "Audience: All staff"):
        assert line in text, line
    assert setup.length_factor(saved) == 0.4 and setup.review_months(saved) == 24 and setup.length_factor({}) == 1.0


def test_the_research_and_the_questions_follow_the_setup(drafts):
    calls = []
    drafts.respond(script(calls))
    s = new_policy(drafts)
    drafts.http.patch(drafts.api(f"/sessions/{s['id']}"), json={"instructions": SETUP})
    first = drafts.http.post(drafts.api(f"/sessions/{s['id']}/messages"), json={"text": "Write the complete policy."}).json()
    finished(drafts, s["id"], first["id"])
    research = json.dumps(calls[0]["body"]["messages"])
    assert "What the person set the document up with" in research and "Country: Pakistan" in research and "State Bank of Pakistan (SBP)" in research
    scope = calls[1]
    assert "Regulators it answers to: State Bank of Pakistan (SBP)" in json.dumps(scope["body"]["messages"])
    assert "are settled: do not ask about them again" in scope["task"]


def test_the_length_the_type_of_organisation_and_the_review_cycle_shape_the_draft(drafts):
    calls = []
    drafts.respond(script(calls))
    s = new_policy(drafts)
    drafts.http.patch(drafts.api(f"/sessions/{s['id']}"), json={"instructions": dict(SETUP, entity_type="Insurance or takaful company")})
    done = finished(drafts, s["id"], drafts.http.post(drafts.api(f"/sessions/{s['id']}/draft"), json={}).json()["id"])
    plan = calls[0]
    assert "words (target length, 120 to 260" in plan["task"]                                       # 300-650 words an area, at 0.4
    purpose = next(c["task"] for c in calls if 'heading="Purpose"' in c["task"])
    assert "About " in purpose and int(purpose.split("About ")[1].split(" words")[0]) < 200           # a short document's sections are short
    assert "the Insurer" in json.dumps(plan["body"]["system"])                                       # written as an insurer, not a bank
    content = drafts.http.get(drafts.api(f"/sessions/{s['id']}")).json()["content"]
    assert "| Next Review Date | Within 24 months of the effective date" in content and "| Document Classification | Confidential |" in content
    assert done["status"] == "done"
