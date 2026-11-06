"""Who may read a governance document everywhere else it is read (the user's decisions of 2026-10-17, "rights or asked"): the
mappings, gap analysis, statements, reports, reviews, attestations, the older approvals, the dashboard, the compliance statements,
the NCA template comparison, the policy-exception search, the AI Studio and ComplyChat. Writes that had no guard need the right to
change the document. The AI Studio reads another library document as the person reads it: staff the version in force while a newer
one is on its way. And a walk over every route with a {document_id}: each has a document guard or is a listed exception."""
from datetime import datetime, timedelta
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from fastapi.routing import APIRoute

import grc.models as m
from grc.modules.governance import permissions
from grc.modules.governance.studio import auto_refs

from test_governance_permissions import ADMIN, OWNER, SAM, TEXT, _grant, doc, world  # noqa: F401  (world is a fixture)

VIEWER = 14                                       # governance:policies:view only: reads the library, sees no never-published draft
NEW = TEXT + "\n## 2. Changes\n\nAccess is reviewed every quarter.\n"
R, E, L = permissions.READ_REFUSED, permissions.EDIT_REFUSED, permissions.LIBRARY_REFUSED


@pytest.fixture
def reads(world, monkeypatch):
    import importlib

    from grc.modules.compliance import compliance_router

    nca = importlib.import_module("grc.routers.nca_templates_router")      # the package exports the router under the module's name
    db = world.db
    db.add(m.GRCUser(id=VIEWER, username="vera", email="vera@cfsb.test", display_name="Vera Viewer"))
    db.commit()
    _grant(db, VIEWER, "governance:policies:view", rid=41)
    db.add(m.PolicyStatement(id=1, tenant_id=1, document_id=5, statement_code="PS-1", statement_text="Access is reviewed every year."))
    db.add(m.PolicyStatement(id=2, tenant_id=1, document_id=6, statement_code="PS-2", statement_text="Backups are kept for a year."))
    db.get(m.PolicyGapFinding, 1).compliance_status = "not_addressed"
    db.commit()
    world.http.app.include_router(compliance_router)
    world.http.app.include_router(nca.router)
    monkeypatch.setattr(nca, "_find_template", lambda tid: {"id": tid, "title": "NCA policy", "category": "policies"})
    monkeypatch.setattr(nca, "_extract_template_text", lambda tid: "# NCA policy\n")
    monkeypatch.setattr(nca, "OPENAI_API_KEY", None)
    return world


def publish_then_revise(world, did=5):
    """Document ``did`` published as 1.0 (its text kept in a version row), then a new version 1.1 on its way."""
    db = world.db
    d = doc(world, did)
    d.status, d.published_at = "published", datetime.utcnow()
    db.commit()
    db.add(m.GovernanceDocumentVersion(document_id=did, version_number="1.0", title=d.title, content=d.content, status="superseded"))
    d.content, d.current_version, d.status = NEW, "1.1", "pending_review"
    db.commit()


def as_(world, who):
    world.me["id"] = who
    return world.http


# every route of these packages that reads document 5 (with what it needs to get past the guard)
READS = [
    ("get", "/governance/mappings/document/5", {}),
    ("get", "/governance/mappings/document/5/coverage", {}),
    ("get", "/governance/mappings/document/5/run-status", {}),
    ("get", "/governance/gap-analysis/runs/5", {}),
    ("get", "/governance/gap-analysis/findings/document/5", {}),
    ("get", "/governance/gap-analysis/findings/1", {}),                          # the findings of run 1, on document 5
    ("get", "/governance/gap-analysis/compliance-summary/5", {}),
    ("get", "/governance/gap-analysis/document/5/recommended-controls", {}),
    ("get", "/governance/gap-analysis/export/5", {}),
    ("get", "/governance/documents/5/parse-status", {}),
    ("get", "/governance/documents/5/policy-statements", {}),
    ("get", "/governance/documents/5/statements/1/versions", {}),
    ("get", "/governance/documents/5/statements/1/diff", {"params": {"version_a": 1, "version_b": 2}}),
    ("get", "/governance/documents/5/reparse-proposals", {}),
    ("get", "/governance/documents/5/document-sync", {}),
    ("get", "/governance/reports/gap-analysis/1/csv", {}),
    ("get", "/governance/reports/policy-statements/5/csv", {}),
    ("get", "/governance/reviews/5/history", {}),
    ("get", "/governance/attestations/document/5", {}),
    ("get", "/governance/workflows/documents/5/steps", {}),
    ("get", "/governance/workflows/documents/5/history", {}),
    ("get", "/governance/workflows/documents/5/status", {}),
    ("get", "/governance/documents/5/workflow", {}),
    ("get", "/compliance/policies/statements/by-document/5", {}),
    ("get", "/compliance/policies/statements/1", {}),
    ("get", "/compliance/policies/statements/1/linkage", {}),
    ("post", "/governance/nca-templates/t1/compare", {"json": {"document_id": 5}}),
]
# writes that had no guard: they need the right to change document 5
WRITES = [
    ("post", "/governance/mappings/document/5/run", {"json": {}}),
    ("post", "/governance/mappings/document/5/recommended-controls/link", {"json": {"control_kind": "parsed"}}),
    ("post", "/governance/gap-analysis/document/5/recommended-controls/link", {"json": {"control_kind": "internal", "control_id": 1}}),
    ("post", "/governance/gap-analysis/findings/1/generate-fix", {}),
    ("put", "/governance/gap-analysis/findings/1", {"json": {"remediation_status": "closed"}}),
    ("put", "/governance/gap-analysis/findings/1/override", {"json": {"override_status": "not_applicable", "override_justification": "x"}}),
    ("put", "/governance/gap-analysis/findings/1/accept-risk", {"json": {"risk_acceptance_justification": "x"}}),
    ("post", "/governance/documents/5/parse-policy", {}),
    ("post", "/governance/documents/5/statements", {"json": {"statement_text": "A new rule."}}),
    ("put", "/governance/documents/5/statements/1", {"json": {"statement_text": "Changed."}}),
    ("post", "/governance/documents/5/statements/1/rollback", {"json": {"version_number": 1}}),
    ("delete", "/governance/documents/5/statements/1", {}),
    ("post", "/governance/documents/5/statements/convert-to-controls", {"json": {"statement_ids": [1]}}),
    ("post", "/governance/documents/5/reparse-proposals/apply", {"json": {"decisions": []}}),
    ("post", "/governance/documents/5/document-sync/check", {}),
    ("put", "/compliance/policies/statements/1", {"json": {"priority": "high"}}),
    ("put", "/compliance/policies/statements/1/compliance", {"json": {"compliance_status": "compliant"}}),
    ("post", "/compliance/policies/statements/1/evidence", {"json": {"evidence_ids": [1]}}),
    ("patch", "/compliance/policies/statements/1/assign", {"json": {"assigned_to_user_id": SAM}}),
]
# views over the whole library
LIBRARY = ["/governance/dashboard/summary", "/governance/dashboard/recently-published", "/governance/dashboard/documents-overview",
           "/governance/reviews/upcoming", "/governance/reviews/overdue", "/governance/reviews/calendar", "/governance/reviews/statistics",
           "/governance/mappings/statistics", "/governance/attestations/coverage-map", "/governance/attestations/stats",
           "/governance/workflows/pending", "/governance/workflows/dashboard", "/governance/workflows/overdue",
           "/governance/reports/compliance-summary/csv", "/governance/reports/audit-log/csv"]


def _call(http, method, path, kw):
    return getattr(http, method)(path, **kw)


def test_someone_without_the_library_right_who_is_not_asked_reads_nothing_of_the_document_and_changes_nothing(reads):
    http = as_(reads, SAM)
    for method, path, kw in READS:
        r = _call(http, method, path, kw)
        assert r.status_code == 403 and r.json()["detail"] == R, (path, r.status_code, r.text)
    for method, path, kw in WRITES:
        r = _call(http, method, path, kw)
        assert r.status_code == 403 and r.json()["detail"] == E, (path, r.status_code, r.text)
    for path in LIBRARY:
        r = http.get(path)
        assert r.status_code == 403 and r.json()["detail"] == L, (path, r.status_code, r.text)
    assert http.get("/governance/mappings/document/404").status_code == 404                # a missing document first
    assert http.get("/governance/gap-analysis/findings/document/6").status_code == 200       # his own document
    db = reads.db
    db.expire_all()
    assert db.get(m.PolicyStatement, 1).statement_text == "Access is reviewed every year." and db.get(m.PolicyStatement, 1).status == "active"
    assert db.get(m.PolicyGapFinding, 1).remediation_status in (None, "open") and db.query(m.Risk).count() == 0


def test_the_gap_analysis_run_needs_the_right_to_change_the_document(reads):
    from grc.modules.governance.routers import gap_analysis as gap

    db = reads.db
    request = SimpleNamespace(state=SimpleNamespace(tenant_slug="cfsb"))
    for who in (SAM, VIEWER):
        with pytest.raises(HTTPException) as refused:
            gap.run_gap_analysis(gap.GapAnalysisRunRequest(document_id=5, run_all=True), request, db, db.get(m.GRCUser, who))
        assert (refused.value.status_code, refused.value.detail) == (403, E)
    assert db.query(m.PolicyGapAnalysisRun).count() == 1


def test_a_library_reader_reads_a_published_document_everywhere_but_may_not_change_it(reads):
    publish_then_revise(reads)
    http = as_(reads, VIEWER)
    for method, path, kw in READS:
        r = _call(http, method, path, kw)
        assert r.status_code not in (401, 403), (path, r.status_code, r.text)
    for method, path, kw in WRITES:
        r = _call(http, method, path, kw)
        assert r.status_code == 403 and r.json()["detail"] == E, (path, r.status_code, r.text)
    for path in LIBRARY:
        assert http.get(path).status_code == 200, path
    # the NCA comparison reads the version in force, not the draft on its way
    assert http.post("/governance/nca-templates/t1/compare", json={"document_id": 5}).json()["document"]["content"] == TEXT.strip()
    as_(reads, OWNER)
    assert reads.http.post("/governance/nca-templates/t1/compare", json={"document_id": 5}).json()["document"]["content"] == NEW.strip()


def test_lists_show_only_what_the_person_may_read_and_never_published_drafts_only_to_who_may_see_them(reads):
    db = reads.db
    soon = datetime.utcnow() + timedelta(days=10)
    for did in (5, 6):
        db.get(m.GovernanceDocument, did).next_review_date = soon
    db.commit()

    def seen(who):
        http = as_(reads, who)
        return {"picker": sorted(d["id"] for d in http.get("/governance/studio/documents").json()["items"]),
                "statements": sorted(s["document_id"] for s in http.get("/compliance/policies/statements").json()["statements"]),
                "search": sorted({x["document_id"] for x in http.get("/governance/policy-exceptions/search-policies", params={"q": "policy"}).json()["results"]})}

    assert seen(SAM) == {"picker": [6], "statements": [6], "search": [6]}                     # his own, not the other
    assert seen(VIEWER) == {"picker": [], "statements": [], "search": []}                     # both are drafts never published
    assert seen(ADMIN) == {"picker": [5, 6], "statements": [5, 6], "search": [5, 6]}
    upcoming = lambda who: sorted(i["id"] for i in as_(reads, who).get("/governance/reviews/upcoming").json()["items"])  # noqa: E731
    assert upcoming(VIEWER) == [] and upcoming(ADMIN) == [5, 6]
    publish_then_revise(reads)                                                                 # 1.0 is in force now
    assert seen(VIEWER) == {"picker": [5], "statements": [5], "search": [5]} and upcoming(VIEWER) == [5]


def test_the_library_views_leave_out_drafts_never_published_for_staff(reads):
    db = reads.db
    now = datetime.utcnow()
    draft, approved = db.get(m.GovernanceDocument, 5), db.get(m.GovernanceDocument, 6)
    draft.next_review_date, draft.expiry_date = now + timedelta(days=10), now + timedelta(days=20)
    approved.next_review_date, approved.status = now - timedelta(days=3), "approved"          # approved, never published
    db.add(m.DocumentObligation(tenant_id=1, document_id=5, kind="approval", user_id=OWNER, status="pending"))     # waiting for Olivia
    db.commit()

    def views(who):
        http = as_(reads, who)
        return [len(http.get("/governance/reviews/overdue").json()["items"]),
                http.get("/governance/reviews/calendar", params={"year": draft.next_review_date.year}).json()["summary"]["total_reviews"],
                http.get("/governance/reviews/statistics").json()["total_documents"],
                http.get("/governance/dashboard/expiring-soon").json()["count"],
                http.get("/governance/dashboard/pending-approvals").json()["count"],
                len(http.get("/governance/dashboard/upcoming-reviews").json()["upcoming"]),
                http.get("/governance/dashboard/overdue-reviews").json()["count"]]

    assert views(VIEWER) == [0, 0, 0, 0, 0, 0, 0]
    assert views(ADMIN) == [1, 2, 2, 1, 1, 2, 1]


def test_the_dashboard_counts_a_document_whose_new_version_is_on_its_way_as_published(reads):
    publish_then_revise(reads)
    http = as_(reads, ADMIN)
    assert [d["id"] for d in http.get("/governance/dashboard/recently-published").json()["documents"]] == [5]
    overview = http.get("/governance/dashboard/documents-overview").json()
    assert overview["sections"]["documents"]["counts"]["published"] == 1
    d = doc(reads)
    d.status = "archived"                                                                      # withdrawn: nothing in force
    reads.db.commit()
    assert http.get("/governance/dashboard/recently-published").json()["documents"] == []


def test_the_studio_never_opens_attaches_or_compares_a_document_the_person_may_not_read(reads):
    db = reads.db
    http = as_(reads, SAM)
    api = lambda p: f"/governance/studio{p}"  # noqa: E731
    r = http.post(api("/sessions"), json={"kind": "library", "document_id": 5})
    assert r.status_code == 403 and r.json()["detail"] == R
    sid = http.post(api("/sessions"), json={"kind": "new", "title": "Sam's notes"}).json()["id"]
    for path, body in [(f"/sessions/{sid}/references", {"kind": "document", "source_id": 5}),
                       (f"/sessions/{sid}/compare", {"document_id": 5})]:
        r = http.post(api(path), json=body)
        assert r.status_code == 403 and r.json()["detail"] == R, path
    s = db.get(m.StudioSession, sid)
    assert auto_refs.attach_named(db, s, "Write it as the Access policy says") == []          # not even named in a note
    attached = auto_refs.attach_named(db, s, "Write it as the Backup policy says")             # his own document is attached
    assert [a["title"] for a in attached] == ["Backup policy"]
    assert db.query(m.StudioReference).filter_by(session_id=sid).count() == 1


def test_the_studio_reads_another_library_document_as_the_person_reads_it(reads):
    publish_then_revise(reads)
    api = lambda p: f"/governance/studio{p}"  # noqa: E731
    http = as_(reads, VIEWER)                                                                  # staff: the version in force
    mine = http.post(api("/sessions"), json={"kind": "library", "document_id": 5}).json()
    assert (mine["content"], mine["base_label"]) == (TEXT, "Access policy v1.0") and mine["may_save"] is False
    assert (mine["document_version"], mine["document_version_in_force"]) == ("1.1", "1.0")
    notes = http.post(api("/sessions"), json={"kind": "new", "title": "Notes"}).json()["id"]
    ref = http.post(api(f"/sessions/{notes}/references"), json={"kind": "document", "source_id": 5}).json()
    assert "v1.0" in ref["label"] and reads.db.get(m.StudioReference, ref["id"]).text == TEXT
    http.put(api(f"/sessions/{notes}/content"), json={"content": TEXT, "base_revision": 1})
    assert http.post(api(f"/sessions/{notes}/compare"), json={"document_id": 5}).json()["stats"]["inserted"] == 0
    http = as_(reads, OWNER)                                                                   # who may change it: the newest
    theirs = http.post(api("/sessions"), json={"kind": "library", "document_id": 5}).json()
    assert (theirs["content"], theirs["base_label"], theirs["document_version_in_force"]) == (NEW, "Access policy v1.1", "1.0")
    other = http.post(api("/sessions"), json={"kind": "new", "title": "Other"}).json()["id"]
    assert "v1.1" in http.post(api(f"/sessions/{other}/references"), json={"kind": "document", "source_id": 5}).json()["label"]


def test_complychat_leaves_governance_documents_out_for_someone_outside_the_library():
    from grc.modules.chatbot import router as chat

    hits = [{"payload": {"source_type": t}} for t in ("governance_document", "governance_document_version", "policy_statement",
                                                       "policy_statement_version", "risk_assessment", "evidence_file")]
    assert chat._readable_hits(hits, True) == hits
    assert [h["payload"]["source_type"] for h in chat._readable_hits(hits, False)] == ["risk_assessment", "evidence_file"]
    for sql in ("SELECT title, content FROM grc_governance_documents", 'SELECT * FROM "grc_policy_statements" s',
                "select d.title from grc_risks r join public.grc_document_obligations o on o.user_id = r.owner_id",
                "SELECT * FROM GRC_STUDIO_SESSIONS", "select * from grc_governance_document_versions"):
        assert chat._touches_documents(sql), sql
    assert not chat._touches_documents("SELECT title FROM grc_risks WHERE status = 'open'")


# ── every route with a {document_id} has a document guard ───────────────────
GUARDS = {permissions.require_doc_reader, permissions.require_doc_editor, permissions.require_doc_publisher,
          permissions.require_doc_deleter, permissions.require_library_reader,
          permissions.require_doc_changer}                                  # require_doc_editor, and not while archived
EXCEPTIONS = {   # path, method: why it needs no document guard
    ("/governance/documents/{document_id}/workflow/advance", "POST"): "decided by the workflow step's approver (its own check)",
    ("/governance/documents/{document_id}/workflow/reject", "POST"): "decided by the workflow step's approver (its own check)",
    ("/governance/workflows/documents/{document_id}/advance", "POST"): "decided by the workflow step's approver (its own check)",
    ("/governance/studio/documents/{document_id}/draft", "POST"): "require_doc_editor in its body (it locks the row first)",
}


def _calls(dependant):
    for d in dependant.dependencies:
        yield d.call
        yield from _calls(d)


def test_every_route_with_a_document_id_has_a_document_guard_or_is_a_listed_exception():
    from grc.modules.compliance import compliance_router
    from grc.modules.governance.router import router as governance_router

    missing, seen = [], set()
    for route in list(governance_router.routes) + list(compliance_router.routes):
        if not isinstance(route, APIRoute) or "{document_id}" not in route.path:
            continue
        for method in route.methods:
            seen.add((route.path, method))
            if (route.path, method) not in EXCEPTIONS and not GUARDS & set(_calls(route.dependant)):
                missing.append(f"{method} {route.path}")
    assert not missing, "routes with no document guard:\n" + "\n".join(sorted(missing))
    assert set(EXCEPTIONS) <= seen                                                             # no stale exception
