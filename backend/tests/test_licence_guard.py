"""SCF text must never reach a language model.

The Secure Controls Framework is CC BY-ND and its guidebook (GEN-FAQ-006)
prohibits using AI on SCF content to generate procedures, policies, metrics,
risks or threats. NOTICE.md says no SCF prose reaches a model. When checked on
2026-09-16 that was false in seven places, all reading `NormalizedControl`
text without looking at `source`, and every tenant's library is SCF.

These tests pin both layers:
  * the choke point inside the OpenAI shim refuses SCF prose, whoever built
    the prompt — so a new feature cannot quietly reopen the leak;
  * it does not refuse text that merely shares wording SCF quoted from its
    public-domain sources, or our own consolidated evidence text — so the guard
    cannot silently break legitimate features either.

DB-free. The shim test replaces the SDK's transport, so nothing is sent.
"""
import json
from pathlib import Path
from types import SimpleNamespace

import pytest

import grc.config  # noqa: F401 — installs the shim under test
from grc.services import licence_guard as guard

SEED = Path(guard.__file__).resolve().parent.parent / "seed_data"


def _scf_control(scf_id: str) -> dict:
    data = json.loads((SEED / "scf" / "controls.json").read_text(encoding="utf-8"))
    controls = data if isinstance(data, list) else data["controls"]
    return next(c for c in controls if c["scf_id"] == scf_id)


def _scf_objective() -> str:
    data = json.loads((SEED / "scf" / "objectives.json").read_text(encoding="utf-8"))
    objectives = data if isinstance(data, list) else data["objectives"]
    return next(o["objective"] for o in objectives if len(o["objective"].split()) > 20)


def _refused(text: str) -> bool:
    try:
        guard.assert_llm_safe([{"role": "user", "content": text}])
    except guard.LicenceRestrictedContent:
        return True
    return False


# ── what must be refused ────────────────────────────────────────────────────
def test_scf_control_description_is_refused():
    c = _scf_control("IAC-06")
    assert _refused(f"Control: {c['name']}\n{c['description']}\n\nSuggest evidence.")


def test_truncated_quote_is_refused():
    """Prompt builders cap text (`text[:200]`); a cut-off quote is still SCF prose."""
    c = _scf_control("IAC-06")
    assert _refused(f"[0] IAC-06 | {c['name']} | {c['description'][:200]}")


def test_assessment_objective_is_refused():
    assert _refused(f"Write test steps for: {_scf_objective()}")


def test_prose_inside_a_multipart_message_is_refused():
    c = _scf_control("IAC-06")
    msg = {"role": "user", "content": [{"type": "text", "text": c["description"]}]}
    with pytest.raises(guard.LicenceRestrictedContent):
        guard.assert_llm_safe([msg])


def test_short_scf_sentences_are_refused():
    """93 controls' descriptions and questions are under 12 words, so the
    windowed fingerprint alone let a single-control prompt for them through.
    Every control's own wording must now be refused."""
    data = json.loads((SEED / "scf" / "controls.json").read_text(encoding="utf-8"))
    controls = data if isinstance(data, list) else data["controls"]
    missed = [c["scf_id"] for c in controls
              if not _refused(" | ".join((f"Title: {c['name']}", f"Statement: {c['description']}",
                                          f"Question: {c.get('control_question') or ''}")))]
    assert not missed, missed[:10]


def test_domain_principles_are_refused():
    """SCF domain groups store the domain's principles as their description."""
    data = json.loads((SEED / "scf" / "domains.json").read_text(encoding="utf-8"))
    domains = data if isinstance(data, list) else next(v for v in data.values() if isinstance(v, list))
    d = next(d for d in domains if isinstance(d.get("principles"), str) and len(d["principles"].split()) > 12)
    assert _refused(f"Summarise this control group: {d['principles']}")


# ── what must NOT be refused ────────────────────────────────────────────────
def test_our_consolidated_evidence_text_is_allowed():
    """NOTICE.md records this as our text; the workbench and recommenders now
    send it in place of the control's own wording. All 8,880 artifacts."""
    sets = json.loads((SEED / "scf" / "evidence_consolidated.json").read_text(encoding="utf-8"))["controls"]
    refused = [(scf_id, a["name"]) for scf_id, c in sets.items() for a in c.get("artifacts", [])
               if guard.find_restricted(f"- {a['name']}: {a['description']}")]
    assert not refused, refused[:5]


def test_a_title_with_an_acronym_is_not_a_sentence():
    """'ST&E' tokenises to 'st' and 'e'; counting those as words once refused
    our own artifact title as an SCF sentence."""
    assert not _refused("Security Testing and Evaluation (ST&E) Plan and Testing Schedule")


def test_framework_text_scf_quotes_from_its_sources_is_allowed():
    """SCF quotes NIST SP 800-53 (public domain) and others verbatim. Those
    shared runs are dropped from the fingerprint, or legitimate prompts over
    framework text would be refused for wording that isn't SCF's."""
    refused = []
    for path in sorted((SEED / "frameworks").glob("nist_800_53*.json")):
        data = json.loads(path.read_text(encoding="utf-8"))
        for c in data.get("controls", []):
            for field in ("full_text", "description", "statement"):
                if isinstance(c.get(field), str) and guard.find_restricted(c[field]):
                    refused.append((path.name, c.get("control_id"), field))
    assert not refused, refused[:5]


def test_a_control_name_alone_is_not_prose():
    """Names are phrases anyone writes; the call-site guards handle them."""
    assert not _refused("Multi-Factor Authentication (MFA)")


# ── the choke point is actually wired into the SDK ──────────────────────────
def test_the_openai_shim_refuses_before_anything_is_sent(monkeypatch):
    from openai import OpenAI

    client = OpenAI(api_key="sk-test", base_url="http://127.0.0.1:9/v1", max_retries=0)
    sent = []
    # Replace the transport underneath the patched `create`: if the guard lets the
    # call through, this records it instead of touching the network.
    monkeypatch.setattr(client.chat.completions, "_post", lambda *a, **k: sent.append(a) or None)

    c = _scf_control("IAC-06")
    with pytest.raises(guard.LicenceRestrictedContent):
        client.chat.completions.create(
            model="gpt-4o", messages=[{"role": "user", "content": c["description"]}],
        )
    assert sent == []


# ── call-site helpers ───────────────────────────────────────────────────────
@pytest.mark.parametrize("source,restricted", [
    ("scf", True), ("SCF", True), (" scf ", True), (None, False), ("custom", False), ("", False),
])
def test_is_restricted_control(source, restricted):
    assert guard.is_restricted_control(SimpleNamespace(source=source)) is restricted


def test_exclude_restricted_keeps_rows_with_no_source():
    """`source NOT IN ('scf')` is NULL-unsafe in SQL; tenant-authored rows with
    no source must stay available to AI features."""
    from sqlalchemy.dialects import postgresql
    from sqlalchemy.orm import Query

    from grc.models import NormalizedControl

    sql = str(
        guard.exclude_restricted(Query(NormalizedControl), NormalizedControl)
        .statement.compile(dialect=postgresql.dialect(), compile_kwargs={"literal_binds": True})
    )
    assert "source IS NULL" in sql
    assert "NOT IN ('scf')" in sql


def test_consolidated_recommendations_carry_no_scf_prose():
    recs = guard.consolidated_recommendations("IAC-06")
    assert recs, "IAC-06 has a consolidated evidence set"
    for r in recs:
        assert set(r) >= {"evidence_type", "description", "priority", "confidence", "reasoning"}
        assert r["confidence"] is None  # not a model's confidence — nothing was generated
        assert not _refused(f"{r['evidence_type']}: {r['description']}")


def test_consolidated_recommendations_for_unknown_control_is_empty():
    assert guard.consolidated_recommendations("NOPE-99") == []
    assert guard.consolidated_recommendations(None) == []
