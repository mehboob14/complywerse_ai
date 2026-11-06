"""An uploaded file is judged against the one thing it was attached to.

The Evidence library's own AI assessment answers a different question — which
framework clauses does this file map to — so before this, a file could be attached
to an assessment item, flip that item to Pass, and nothing ever asked whether it
proves the item.
"""
import json
from types import SimpleNamespace

from grc.services import evidence_quality as q

TARGET = q.QualityTarget(
    kind="assessment_item", ref="42", label="V2.1.1 — Authentication",
    requirement="Verify that multi-factor authentication is enforced for administrators.",
)


def _evidence(text="MFA is enforced for all administrators via Okta. Screenshot dated 2026-09-01."):
    return SimpleNamespace(id=1, name="Okta MFA policy", file_name="okta.pdf",
                           evidence_type="screenshot", ocr_content=text)


def test_the_requirement_and_the_file_text_both_reach_the_prompt():
    prompt = q._prompt(TARGET, _evidence(), "MFA is enforced for administrators")
    assert "multi-factor authentication is enforced" in prompt
    assert "MFA is enforced for administrators" in prompt
    assert TARGET.basis == "requirement_text"


def test_licensed_wording_never_reaches_the_prompt():
    target = q.QualityTarget(kind="control", ref="IAC-06", label="Multi-Factor Authentication",
                             requirement="SCF's own description of this control", restricted=True)
    prompt = q._prompt(target, _evidence(), "text")
    assert "SCF's own description" not in prompt
    assert "IAC-06" in prompt and "indicative" in prompt
    assert target.basis == "identifier_only"


def test_a_verdict_is_parsed_and_scores_are_clamped():
    answer = json.dumps({
        "covers": "partial", "score": 140, "confidence": -5,
        "verdict": "Shows MFA for admins but not for service accounts.",
        "strengths": ["Okta admin MFA policy screenshot"], "gaps": ["service accounts"],
        "improvements": ["Export the service-account authentication policy"], "as_of": "2026-09-01",
    })
    result = q.check(_evidence(), TARGET, complete=lambda messages: answer)
    assert result["status"] == "ok"
    assert result["covers"] == "partial"
    assert (result["score"], result["confidence"]) == (100, 0)
    assert result["detail"]["gaps"] == ["service accounts"]
    assert result["detail"]["as_of"] == "2026-09-01"
    assert result["basis"] == "requirement_text"


def test_coverage_is_derived_when_the_model_omits_it():
    assert q.check(_evidence(), TARGET, complete=lambda m: json.dumps({"score": 85}))["covers"] == "full"
    assert q.check(_evidence(), TARGET, complete=lambda m: json.dumps({"score": 50}))["covers"] == "partial"
    assert q.check(_evidence(), TARGET, complete=lambda m: json.dumps({"score": 10}))["covers"] == "none"


def test_a_file_with_no_text_says_so_rather_than_scoring_it():
    result = q.check(_evidence(text=""), TARGET, complete=lambda m: "never called")
    assert result["status"] == "no_text"
    assert result.get("score") is None


def test_a_licence_refusal_is_a_status_not_a_crash():
    class LicenceRestrictedContent(Exception):
        pass

    def refuse(messages):
        raise LicenceRestrictedContent("licensed content")

    assert q.check(_evidence(), TARGET, complete=refuse)["status"] == "licence_restricted"


def test_a_provider_failure_never_breaks_the_upload():
    def boom(messages):
        raise RuntimeError("502 from the provider")

    result = q.check(_evidence(), TARGET, complete=boom)
    assert result["status"] == "failed"
    assert result["note"]
