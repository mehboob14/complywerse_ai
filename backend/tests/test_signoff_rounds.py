"""Review rounds: a document that changes after it was signed (a save over an approved or published one, a restore, a status
set by hand, a new send) is signed again by the same people, the earlier signatures stay in the trail but no longer count,
and a decision made on a version that has moved on is refused. With nobody to sign, the document is a draft again."""
import pytest
from fastapi import HTTPException

import grc.models as m
from grc.modules.governance import doc_lifecycle
from grc.modules.governance.routers import document_signoff as signoff
from grc.modules.governance.routers import versions as version_routes

from test_esignature import _png, _request, _user, db          # noqa: F401  (db is a fixture)


@pytest.fixture(autouse=True)
def _tenants(monkeypatch):
    monkeypatch.setattr(signoff, "get_user_tenants", lambda user, session: [1])
    monkeypatch.setattr(version_routes, "get_user_tenants", lambda user, session: [1])


def _sign(db, version="1.2"):
    return signoff.sign_document(document_id=5, body=signoff.SignRequest(signature_image=_png(), version=version), request=_request(),
                                 db=db, current_user=_user(db))


def _view(db):
    return signoff.get_signoff(document_id=5, db=db, current_user=_user(db))


def test_a_changed_document_is_signed_again_and_a_stale_decision_is_refused(db):
    assert _sign(db)["status"] == "approved"
    doc = db.get(m.GovernanceDocument, 5)
    doc.status = "published"
    db.commit()
    doc.status = "pending_review"                                            # what a studio save over a published document does
    doc_lifecycle.on_status_changed(db, doc, "published", "pending_review", 3)
    db.commit()
    view = _view(db)
    assert doc.status == "pending_approval"                                  # approvers only: it goes to them, as Send would
    assert view["my_actionable_role"] == "approver" and view["progress"]["approver"] == {"required": 1, "signed": 0}
    assert [s["this_round"] for s in view["signatures"]] == [False] and view["round_started_at"]
    with pytest.raises(HTTPException) as stale:
        _sign(db, version="1.1")
    assert stale.value.status_code == 409 and db.get(m.GovernanceDocument, 5).status == "pending_approval"
    assert _sign(db, version=doc.current_version)["status"] == "approved"   # signed again in the new round


def test_sending_again_after_a_rejection_starts_a_new_round(db):
    _sign(db)
    doc = db.get(m.GovernanceDocument, 5)
    doc.status = "draft"                                                     # rejected later, or set back by hand
    db.commit()
    out = signoff.send_for_review(document_id=5, db=db, current_user=_user(db))
    assert out["status"] == "pending_approval" and out["my_actionable_role"] == "approver"


def test_with_nobody_to_sign_a_changed_document_is_a_draft_again(db):
    db.query(m.DocumentSignoffAssignment).delete()
    doc = db.get(m.GovernanceDocument, 5)
    doc.status = "pending_review"
    doc_lifecycle.on_status_changed(db, doc, "approved", "pending_review", 3)
    db.commit()
    assert doc.status == "draft" and doc.signoff_round_at is not None
    row = db.query(m.DocumentAuditLog).filter_by(document_id=5, action="status_changed").one()
    assert (row.old_value, row.new_value) == ("pending_review", "draft") and "send it for review" in row.action_details


def test_restoring_an_earlier_text_of_an_approved_document_sends_it_back_to_review(db):
    doc = db.get(m.GovernanceDocument, 5)
    earlier = m.GovernanceDocumentVersion(document_id=5, version_number="1.0", change_type="major", title=doc.title, content="# Access policy\n\nOld text.",
                                          status="superseded", created_by=3)
    db.add(earlier)
    doc.status = "approved"
    db.commit()
    out = version_routes.rollback_to_version(document_id=5, version_id=earlier.id, rollback_data=None, db=db, current_user=_user(db))
    assert out["status"] == "pending_approval" and db.get(m.GovernanceDocument, 5).content == "# Access policy\n\nOld text."


def test_a_co_signer_is_not_refused_because_the_first_signature_stamped_a_new_version(db):
    db.add(m.GRCUser(id=4, username="omar", email="omar@bank.example", display_name="Omar Shah"))
    db.add(m.DocumentSignoffAssignment(tenant_id=1, document_id=5, role_type="approver", target_type="user", target_id=4, added_by=3))
    db.commit()
    assert _sign(db, version="1.2")["status"] == "pending_approval"            # Sara signs: her stamp makes version 1.3
    assert db.get(m.GovernanceDocument, 5).current_version == "1.3"
    omar = db.get(m.GRCUser, 4)
    out = signoff.sign_document(document_id=5, body=signoff.SignRequest(signature_image=_png(), version="1.2"), request=_request(), db=db, current_user=omar)
    assert out["status"] == "approved"                                         # Omar read 1.2: only a sign-off stamp came since


def test_any_way_into_review_starts_a_round_and_a_stage_with_nobody_goes_to_the_other(db):
    doc = db.get(m.GovernanceDocument, 5)
    doc.status = "approved"
    db.commit()
    before = doc.signoff_round_at                                              # stamped when it was made, already in approval
    doc.status = "pending_approval"                                            # e.g. a gap fix, or the older approvals engine
    assert doc.signoff_round_at is not None and doc.signoff_round_at != before
    db.rollback()
    db.query(m.DocumentSignoffAssignment).update({"role_type": "reviewer"})       # reviewers only, asked for approval
    doc = db.get(m.GovernanceDocument, 5)
    doc.status = "pending_approval"
    doc_lifecycle.on_status_changed(db, doc, "draft", "pending_approval", 3)
    assert doc.status == "pending_review"
    assert db.query(m.DocumentAuditLog).filter_by(document_id=5, new_value="pending_review").one().action_details.startswith("No approvers are set")


def test_back_from_approval_to_review_asks_the_reviewers_again(db):
    db.add(m.GRCUser(id=4, username="rana", email="rana@bank.example", display_name="Rana Reviewer"))
    db.add(m.DocumentSignoffAssignment(tenant_id=1, document_id=5, role_type="reviewer", target_type="user", target_id=4, added_by=3))
    doc = db.get(m.GovernanceDocument, 5)
    doc.status = "pending_review"
    db.commit()
    rana = db.get(m.GRCUser, 4)
    signoff.sign_document(document_id=5, body=signoff.SignRequest(signature_image=_png()), request=_request(), db=db, current_user=rana)
    assert db.get(m.GovernanceDocument, 5).status == "pending_approval"
    doc = db.get(m.GovernanceDocument, 5)
    doc.status = "pending_review"                                               # sent back to its reviewers
    db.commit()
    assert signoff.get_signoff(document_id=5, db=db, current_user=rana)["my_actionable_role"] == "reviewer"


def test_a_new_version_while_in_approval_is_signed_again_by_the_same_people(db):
    db.add(m.GRCUser(id=4, username="omar", email="omar@bank.example", display_name="Omar Shah"))
    db.add(m.DocumentSignoffAssignment(tenant_id=1, document_id=5, role_type="approver", target_type="user", target_id=4, added_by=3))
    db.commit()
    _sign(db)                                                                  # Sara approves the text she read; Omar has not yet
    doc = db.get(m.GovernanceDocument, 5)
    assert doc.status == "pending_approval" and _view(db)["my_actionable_role"] is None
    doc.content += "\nA new clause."                                           # e.g. Save to library from the AI Studio
    sent = doc_lifecycle.changed_after_review(db, doc, "pending_approval", 3, "Edited in the AI Studio (version 1.4), so it needs approving again")
    db.commit()
    assert sent and doc.status == "pending_approval"                           # nobody reviews it: straight back to its approvers
    assert _view(db)["my_actionable_role"] == "approver" and _view(db)["progress"]["approver"] == {"required": 2, "signed": 0}
    assert not doc_lifecycle.changed_after_review(db, db.get(m.GovernanceDocument, 5), "draft", 3, "a draft stays a draft")


def test_the_history_says_what_a_new_version_did_to_the_review():
    out = doc_lifecycle.outcome
    assert out("pending_review", "pending_review") == "; signed again from the start by its reviewers"
    assert out("pending_review", "pending_approval") == "; signed again from the start by its approvers"
    assert out("pending_approval", "pending_approval") == "; signed again from the start by its approvers"
    assert out("published", "pending_review") == "; sent back to its reviewers"
    assert out("approved", "pending_approval") == "; sent back to its approvers"
    assert out("published", "draft") == "; it is a draft again" and out("draft", "draft") == ""


def test_a_gap_fix_while_in_review_starts_a_new_round_and_asks_every_reviewer_again(db, monkeypatch):
    from datetime import datetime, timedelta

    from grc.modules.governance.routers import gap_analysis as gaps

    monkeypatch.setattr(gaps, "get_user_tenants", lambda user, session: [1])
    for uid, name in ((4, "rana"), (6, "omar")):
        db.add(m.GRCUser(id=uid, username=name, email=f"{name}@bank.example", display_name=name.title()))
        db.add(m.DocumentSignoffAssignment(tenant_id=1, document_id=5, role_type="reviewer", target_type="user", target_id=uid, added_by=3))
    doc = db.get(m.GovernanceDocument, 5)
    doc.owner_id, doc.status = 3, "pending_review"
    db.commit()
    doc.signoff_round_at = datetime.utcnow() - timedelta(hours=1)
    db.commit()
    signoff.sign_document(document_id=5, body=signoff.SignRequest(signature_image=_png()), request=_request(), db=db, current_user=db.get(m.GRCUser, 4))
    db.query(m.DocumentSignature).update({"signed_at": datetime.utcnow() - timedelta(minutes=1)})     # Rana signed; Omar has not yet
    db.commit()
    assert db.get(m.GovernanceDocument, 5).status == "pending_review" and len(signoff._signatures(db, 5)) == 1
    db.add(m.PolicyGapAnalysisRun(id=1, tenant_id=1, document_id=5))
    db.add(m.PolicyGapFinding(id=1, tenant_id=1, analysis_run_id=1, document_id=5, framework_name="ISO/IEC 27001", clause_reference="A.5.15"))
    db.commit()
    out = gaps.apply_finding_fix(finding_id=1, body=gaps.ApplyFixRequest(proposed_text="Access rights are reviewed every quarter."), db=db, current_user=_user(db))
    assert out["document_status"] == "pending_review"                          # not straight to approval: Omar has not reviewed it
    assert signoff._signatures(db, 5) == []                                    # Rana's signature was on the text before the fix
    asked = db.query(m.DocumentObligation).filter_by(document_id=5, kind="review", status="pending").all()
    assert sorted(o.user_id for o in asked) == [4, 6]
    assert db.query(m.DocumentAuditLog).filter_by(document_id=5, action="status_changed", new_value="pending_review").count() == 1
