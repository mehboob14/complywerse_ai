"""Evidence-library suggestions for a control's required artifacts.

A suggestion is shown to an assessor as "you may already have this". A wrong
one costs a click; a right one saves an upload. What must never happen is a
confident wrong one: boilerplate that every compliance document shares
("policy", "approved", "annual review") lifting an unrelated file to the top.

DB-free: the matcher is pure functions over plain dataclasses.
"""
from grc.modules.automation.evidence_match import (
    EvidenceDoc, artifact_key, document_frequencies, rank, text_score, tokenize,
)

BCP = ("Business Continuity Plan",
       "The enterprise business continuity plan covering recovery objectives, alternate sites and invocation.")


def _library():
    return [
        EvidenceDoc(1, name="BCP 2026 v3", summary="Business continuity plan with recovery time objectives and alternate site arrangements.",
                    status="approved"),
        EvidenceDoc(2, name="Information Security Policy", summary="Approved annual information security policy.",
                    status="approved"),
        EvidenceDoc(3, name="Access review Q2", summary="Quarterly user access review sign-off.", status="approved"),
        EvidenceDoc(4, name="scan.pdf", text="This document sets out the business continuity arrangements "
                                              "and the continuity plan invocation criteria.", status="approved"),
    ]


def test_artifact_key_is_stable_across_spellings():
    assert artifact_key("Business Continuity Plan") == artifact_key("business  continuity-plan")
    assert artifact_key(None) == ""


def test_plurals_meet_halfway():
    assert tokenize("Access Reviews and Policies") == tokenize("access review and policy")


def test_the_right_document_ranks_first():
    lib = _library()
    got = rank(*BCP, lib)
    assert [s.evidence_id for s in got][:2] == [1, 4]


def test_boilerplate_alone_never_suggests_an_unrelated_file():
    """The information security policy shares 'plan'-adjacent generic words
    with nothing distinctive; it must not be offered for the BCP."""
    got = rank(*BCP, _library(), limit=10)
    assert 2 not in {s.evidence_id for s in got}
    assert 3 not in {s.evidence_id for s in got}


def test_a_match_found_only_in_extracted_text_says_so():
    lib = _library()
    doc = next(d for d in lib if d.id == 4)
    score, terms, text_only = text_score(*BCP, doc, document_frequencies(lib), len(lib))
    assert score > 0 and text_only
    s = next(s for s in rank(*BCP, lib) if s.evidence_id == 4)
    assert s.reasons[0].startswith("Document text mentions")


def test_same_artifact_link_outranks_any_text_match():
    """A person already linked this file as the BCP on another control."""
    lib = _library() + [EvidenceDoc(9, name="continuity.docx", status="approved")]
    got = rank(*BCP, lib, same_artifact={9: ["BCD-01.7", "BCD-02"]})
    assert got[0].evidence_id == 9
    assert got[0].signal == "same_artifact"
    assert "BCD-01.7" in got[0].reasons[0]


def test_crosswalk_link_ranks_between_reuse_and_text():
    lib = _library() + [EvidenceDoc(8, name="dr-runbook.pdf", status="approved")]
    got = rank(*BCP, lib, crosswalk={8: ["ISO 22301 8.4"]}, limit=5)
    order = [s.evidence_id for s in got]
    assert order.index(8) < order.index(4)


def test_already_linked_and_rejected_files_are_not_suggested():
    lib = _library()
    lib[3].status = "rejected"
    got = rank(*BCP, lib, exclude=[1], limit=10)
    assert {s.evidence_id for s in got}.isdisjoint({1, 4})


def test_expired_evidence_ranks_below_current_and_says_why():
    lib = [
        EvidenceDoc(1, name="Business Continuity Plan 2024", status="approved", expired=True),
        EvidenceDoc(2, name="Business Continuity Plan 2026", status="approved"),
    ]
    got = rank(*BCP, lib)
    assert [s.evidence_id for s in got] == [2, 1]
    assert any("Expired" in r for r in got[1].reasons)


def test_empty_library_and_empty_artifact_are_quiet():
    assert rank(*BCP, []) == []
    assert rank("", "", _library()) == []


def test_score_is_comparable_across_artifact_lengths():
    """Normalised to 0–100 against the best possible match, so a short artifact
    name is not structurally out-scored by a long description."""
    lib = [EvidenceDoc(1, name="Encryption Key Inventory", status="approved"),
           EvidenceDoc(2, name="Other", status="approved")]
    s = rank("Encryption Key Inventory", "", lib)
    assert s and 0 < s[0].score <= 100


def test_a_two_letter_acronym_in_passing_is_not_a_match():
    """Real case: an encryption policy's summary said "Unable to parse AI
    response", and it was the top suggestion for "AI Policy"."""
    lib = [EvidenceDoc(1, name="acceptable_encryption_policy.pdf", summary="Unable to parse AI response",
                       status="draft"),
           EvidenceDoc(2, name="AI Acceptable Use Policy", status="approved")]
    got = rank("AI Policy", "The organisation's policy governing use of artificial intelligence.", lib, limit=5)
    assert [s.evidence_id for s in got] == [2]
