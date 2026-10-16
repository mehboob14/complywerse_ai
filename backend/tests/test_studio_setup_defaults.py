"""The Instructions lists fill themselves in: what "Fill in from your organisation" sets, a library document's own facts (shown, copied
into its draft, never written back), its frameworks marked, and each followed regulator offered once."""
import grc.models as m
from grc.modules.governance.studio import setup

from test_studio_flow import world                                          # noqa: F401  (world is a fixture)


def test_the_organisation_fills_in_the_country_its_type_and_its_regulators_once(world):
    db = world.db
    t = db.get(m.Tenant, 1)
    t.industry, t.geography = "Islamic Banking", "Middle East"                     # not a country: the one country of its feeds is used
    for name in ("SBP circulars", "SBP press releases"):
        db.add(m.RegulatoryFeedSource(tenant_id=1, name=name, source_url=f"https://www.sbp.org.pk/{name[-4:]}", country="Pakistan", regulator="State Bank of Pakistan", is_active=True))
    db.commit()
    s = world.http.post(world.api("/sessions"), json={"kind": "new", "title": "Asset Management Policy", "doc_type": "policy"}).json()
    out = world.http.get(world.api(f"/sessions/{s['id']}/setup")).json()
    assert out["regulators_followed"] == [{"label": "State Bank of Pakistan (SBP)", "country": "Pakistan"}]      # folded into the list's name, once
    assert out["defaults"] == {"country": "Pakistan", "entity_type": "Islamic bank", "regulators": ["State Bank of Pakistan (SBP)"]}
    assert out["entity_names"] == [t.legal_entity, "CFSB"] and out["document"] is None
    assert out["review_cycles"][0] == "Every 6 months" and setup.review_months({"review_cycle": "Every 6 months"}) == 6
    assert {"entity_types", "countries", "country_from_profile", "regulators", "regulations", "frameworks", "domains", "departments",
            "audiences", "lengths", "classifications"} <= set(out)                                      # the older lists stay


def test_a_library_document_shows_its_own_facts_and_frameworks(world):
    db = world.db
    db.add(m.GRCDepartment(id=5, tenant_id=1, name="IT Operations", code="IT-OPS", is_active=True))
    doc = db.get(m.GovernanceDocument, 11)
    doc.classification, doc.review_cycle_months, doc.department_id = "confidential", 24, 5
    doc.regulatory_scope, doc.applicable_framework_ids = ["BPRD Circular No. 05 of 2017", 7], [1]
    db.commit()
    s = world.http.post(world.api("/sessions"), json={"kind": "library", "document_id": 11}).json()
    out = world.http.get(world.api(f"/sessions/{s['id']}/setup")).json()
    assert out["document"] == {"classification": "Confidential", "review_cycle": "Every two years", "owner": "Olivia Owner", "department": "IT Operations"}
    assert out["frameworks"] == [{"id": 1, "label": "ISO/IEC 27001 (2022)", "attached": False, "of_document": True}]   # marked, not attached
    assert setup.from_document(db, doc) == {"classification": "Confidential", "review_cycle": "Every two years", "departments": ["IT Operations"],
                                            "regulations": ["BPRD Circular No. 05 of 2017"]}
    doc.review_cycle_months = 18                                                     # no list entry: left unset rather than guessed
    assert "review_cycle" not in setup.from_document(db, doc)
