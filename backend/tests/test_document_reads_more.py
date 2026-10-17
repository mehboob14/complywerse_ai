"""More places a governance document is read or linked (review of 2026-10-17): a statement's history only through its own
document, the policy-exception search and suggestions from what the person reads, the governance-actions lists for library
readers without drafts never published, links to records by who may change the document or the record, the version a campaign
names, and an email's link when the app's address is not set."""
from datetime import datetime

import pytest

import grc.models as m
from grc.modules.governance import permissions
from grc.modules.governance.routers import mappings

from test_document_read_access import NEW, VIEWER, as_, publish_then_revise, reads  # noqa: F401  (reads is a fixture)
from test_governance_permissions import ADMIN, EDITOR, OWNER, SAM, TEXT, _grant, doc, world  # noqa: F401  (world is a fixture)

RISKY = 15                                        # may change risks (the risk page's right), no governance right


def test_a_statements_history_is_read_only_through_its_own_document(reads):
    db = reads.db
    db.add_all([m.PolicyStatementVersion(id=11, tenant_id=1, statement_id=2, version_number=1, statement_text="TOPSECRET a"),
                m.PolicyStatementVersion(id=12, tenant_id=1, statement_id=2, version_number=2, statement_text="TOPSECRET b"),
                m.PolicyStatementVersion(id=13, tenant_id=1, statement_id=1, version_number=1, statement_text="Every year."),
                m.PolicyStatementVersion(id=14, tenant_id=1, statement_id=1, version_number=2, statement_text="Every month.")])
    db.commit()
    publish_then_revise(reads)
    http = as_(reads, VIEWER)                     # reads 5 (published), not 6 (Sam's draft, which holds statement 2)
    r = http.get("/governance/documents/5/statements/2/diff", params={"version_a": 11, "version_b": 12})
    assert r.status_code == 404 and "TOPSECRET" not in r.text
    ok = http.get("/governance/documents/5/statements/1/diff", params={"version_a": 13, "version_b": 14})
    assert ok.status_code == 200 and ok.json()["total_changes"] == 1


def test_the_policy_exception_search_and_suggestions_use_what_the_person_reads(reads, monkeypatch):
    from grc.routers import policy_exception_router as pe

    db = reads.db
    publish_then_revise(reads)
    d = doc(reads)
    d.content = "# Access policy\n\nAccess is reviewed every quarter.\n"            # 1.1 no longer says "every year"
    db.commit()

    def docs_found(who, q):
        res = as_(reads, who).get("/governance/policy-exceptions/search-policies", params={"q": q}).json()["results"]
        return [(x["document_id"], x["snippet"]) for x in res if x["match_field"] == "content"]

    assert docs_found(VIEWER, "every quarter") == []                                      # not in the version in force
    assert [i for i, s in docs_found(VIEWER, "every year") if "every year" in s] == [5]  # the version in force
    assert [i for i, s in docs_found(OWNER, "every quarter") if "every quarter" in s] == [5]
    assert docs_found(OWNER, "every year") == []

    seen = {}
    monkeypatch.setattr(pe, "_generate_candidate_exceptions",
                        lambda documents, focus, limit: seen.update(ids=[x.id for x in documents], focus=focus and focus.content)
                        or {"source": "template", "candidates": []})
    http = as_(reads, SAM)
    r = http.get("/governance/policy-exceptions/suggest-candidates", params={"document_id": 6})
    assert r.status_code == 200 and seen["focus"] == "# Backup policy\n"                  # his own draft
    d6 = db.get(m.GovernanceDocument, 6)
    d6.owner_id = OWNER                                                                     # now someone else's draft, never published
    db.commit()
    r = http.get("/governance/policy-exceptions/suggest-candidates", params={"document_id": 6})
    assert r.status_code == 403 and r.json()["detail"] == permissions.READ_REFUSED
    r = http.post("/governance/policy-exceptions/suggest-content", json={"title": "Skip backups", "document_id": 6})
    assert r.status_code == 403
    http.get("/governance/policy-exceptions/suggest-candidates")
    assert seen["ids"] == []                                                                # the scan leaves out what he may not read
    as_(reads, VIEWER).get("/governance/policy-exceptions/suggest-candidates", params={"document_id": 5})
    assert "every year" in seen["focus"]                                                    # the version in force
    as_(reads, VIEWER).get("/governance/policy-exceptions/suggest-candidates")
    assert seen["ids"] == [5]


def test_the_governance_actions_are_for_library_readers_and_hide_drafts_never_published(reads):
    db = reads.db
    publish_then_revise(reads)                                                              # 5 published; 6 a draft never published
    for i, (kind, eid) in enumerate([("governance_document", 5), ("governance_document", 6), ("policy_statement", 1),
                                     ("policy_statement", 2), ("policy_gap_finding", 1), ("risk", 3)], start=1):
        db.add(m.GovernanceActionReview(id=i, tenant_id=1, action_type="x", action_description=f"{kind} {eid}", entity_type=kind,
                                        entity_id=eid, action_user_id=OWNER, action_date=datetime.utcnow(), review_status="pending_review"))
    db.commit()
    http = as_(reads, SAM)
    for r in (http.get("/governance/reviews/governance-actions"), http.get("/governance/reviews/governance-actions/pending"),
              http.put("/governance/reviews/governance-actions/1", json={"review_status": "approved"})):
        assert r.status_code == 403 and r.json()["detail"] == permissions.LIBRARY_REFUSED
    ids = lambda who, path: sorted(i["id"] for i in as_(reads, who).get(path).json()["items"])  # noqa: E731
    for path in ("/governance/reviews/governance-actions", "/governance/reviews/governance-actions/pending"):
        assert ids(VIEWER, path) == [1, 3, 5, 6], path
        assert ids(ADMIN, path) == [1, 2, 3, 4, 5, 6], path


@pytest.fixture
def links(reads):
    db = reads.db
    db.add(m.GRCUser(id=RISKY, username="rita", email="rita@cfsb.test", display_name="Rita Risk"))
    db.add(m.Risk(id=1, tenant_id=1, title="Data loss", category="operational"))
    db.commit()
    _grant(db, RISKY, "risks:risk_register:edit", rid=42)
    return reads


def test_a_document_is_linked_to_a_risk_by_who_may_change_the_document_or_the_risk(links):
    link = lambda who, did=5: as_(links, who).post("/governance/mappings/risk", json={"document_id": did, "risk_id": 1})  # noqa: E731
    r = link(SAM)
    assert r.status_code == 403 and r.json()["detail"] == mappings.LINK_REFUSED              # neither right
    r = link(VIEWER)
    assert r.status_code == 403 and r.json()["detail"] == mappings.LINK_REFUSED              # reads it, may change neither
    r = link(RISKY)
    assert r.status_code == 403 and r.json()["detail"] == permissions.READ_REFUSED            # a draft never published
    assert link(EDITOR, 6).status_code == 201                                                  # may change any document
    publish_then_revise(links)
    made = link(RISKY)
    assert made.status_code == 201                                                              # the risk's right, a version in force
    assert as_(links, SAM).delete(f"/governance/mappings/risk/{made.json()['id']}").status_code == 403
    assert as_(links, RISKY).delete(f"/governance/mappings/risk/{made.json()['id']}").status_code == 204
    other = links.db.query(m.DocumentRiskLink).filter_by(document_id=6).one()
    assert as_(links, RISKY).delete(f"/governance/mappings/risk/{other.id}").status_code == 403  # 6: still a draft he may not read


def test_a_wildcard_right_counts_and_moving_a_control_needs_a_right_on_the_document_it_leaves(links):
    db = links.db
    _grant(db, SAM, "controls:*:*", rid=43)                                                     # may change controls
    db.add(m.InternalControl(id=1, tenant_id=1, control_id="IC-1", name="Access reviews", source_document_id=5))
    db.commit()
    move = lambda: as_(links, SAM).post("/governance/mappings/control",  # noqa: E731
                                        json={"document_id": 6, "internal_control_id": 1, "force_relink": True})
    r = move()                                                                                  # 6 is his; 5 a draft he may not read
    assert r.status_code == 403 and r.json()["detail"] == permissions.READ_REFUSED
    publish_then_revise(links)
    assert move().status_code == 201
    db.expire_all()
    assert db.get(m.InternalControl, 1).source_document_id == 6


def test_a_campaign_names_the_version_in_force(reads):
    from grc.modules.governance.routers.document_attestations import _serialize_campaign

    db = reads.db
    publish_then_revise(reads)
    c = m.DocumentAttestationCampaign(tenant_id=1, document_id=5, name="Read it", public_token="t")
    db.add(c)
    db.commit()
    assert _serialize_campaign(db, c)["document_version"] == "1.0"                               # 1.1 is still on its way
    d = doc(reads)
    d.status = "archived"
    db.commit()
    assert _serialize_campaign(db, c)["document_version"] == "1.1"                               # nothing in force: its own


def test_an_email_names_the_page_as_text_when_the_apps_address_is_not_set(world, monkeypatch):
    from grc.modules.workflow_engine.services import notification_service as ns

    sent = []
    monkeypatch.setattr(ns, "send_email", lambda db, **kw: sent.append(kw) or {"sent": True})
    for name in ("FRONTEND_URL", "NEXT_PUBLIC_APP_URL"):
        monkeypatch.delenv(name, raising=False)
    send = lambda: ns.send_workflow_notification(world.db, tenant_id=1, subject="Please review", message="A document waits.",  # noqa: E731
                                                 workflow_instance_id=None, user_ids=[OWNER], channels=["email"],
                                                 link="/governance/documents/5?tab=lifecycle")
    send()
    assert "href" not in sent[-1]["body_html"] and "In the app: /governance/documents/5?tab=lifecycle" in sent[-1]["body_html"]
    assert sent[-1]["body_text"].endswith("In the app: /governance/documents/5?tab=lifecycle")
    monkeypatch.setenv("FRONTEND_URL", "https://cfsb.example.test/")
    send()
    assert 'href="https://cfsb.example.test/governance/documents/5?tab=lifecycle"' in sent[-1]["body_html"]
    assert "In the app" not in sent[-1]["body_html"] and sent[-1]["body_text"] == "A document waits."
