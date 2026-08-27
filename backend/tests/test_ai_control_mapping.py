"""Context-based control mapping — hermetic tests (fake client, no API spend).

Pinned properties of the approved design (docs/CTEM_CONTEXT_MAPPING_BUILD_PLAN.md):
  * the corpus is the LOCKED baseline library + standalone leftovers — junk
    sessions and absorbed raw controls are excluded;
  * chapters cover the WHOLE corpus, in order, and every chapter is scanned;
  * a chapter may only flag its own lines; the judge may only pick flagged ids;
    anything else is dropped and recorded;
  * a chapter failure aborts the finding with an error — a partial library scan
    is never silently accepted;
  * empty answers are valid and keep the model's reason; failures never raise.
"""
import json
import re
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from grc.models import (Vulnerability, NormalizedControl, NormalizedControlLink,
                        NormalizationRun, ParsedFrameworkControl, UploadedFramework)
from grc.services import ai_control_mapping as m

TENANT = 1


class _Row:
    def __init__(self, **kw): self.__dict__.update(kw)


def _v(**kw):
    base = dict(id=1, tenant_id=TENANT, title="", description="", cve_id=None, cwe_id=None,
                cvss_vector=None, severity="info", epss_score=None, kev_flag=False)
    base.update(kw); return _Row(**base)


def _lid(corpus, ref_id, kind="normalized_control"):
    for c in corpus:
        if c["kind"] == kind and c["ref_id"] == ref_id:
            return c["id"]
    raise AssertionError(f"{kind}:{ref_id} not in corpus")


@pytest.fixture
def db():
    engine = create_engine("sqlite://")
    for mm in (Vulnerability, NormalizedControl, NormalizedControlLink, NormalizationRun,
               UploadedFramework, ParsedFrameworkControl):
        mm.__table__.create(engine)
    s = sessionmaker(bind=engine)()
    # the LOCKED baseline session + a junk (non-baseline) session
    s.add(NormalizationRun(id=47, tenant_id=TENANT, scope="full", status="completed", is_baseline=True))
    s.add(NormalizationRun(id=71, tenant_id=TENANT, scope="full", status="completed", is_baseline=False))
    # library controls — baseline run 47 (real names from the tenant DB)
    s.add_all([
        NormalizedControl(id=7370, run_id=47, code="ULV2-00906", name="Document and Review Cryptographic Cipher Suites and Protocols",
                          domain="Cryptography", statement="Review TLS cipher suites and protocol versions regularly."),
        NormalizedControl(id=7660, run_id=47, code="ULV2-01196", name="Configure systems for least functionality by disabling unnecessary services",
                          domain="Secure Configuration", statement="Disable services, ports and protocols not required."),
        NormalizedControl(id=6942, run_id=47, code="ULV2-00488", name="Require multi-factor authentication for application access",
                          domain="Access", statement="Require MFA for application access."),
    ])
    # JUNK: a duplicate-session copy that must NOT be searchable
    s.add(NormalizedControl(id=9910, run_id=71, code="EXT71-00906", name="Document and Review Cryptographic Cipher Suites and Protocols",
                            domain="Cryptography", statement="Duplicate session copy."))
    # an uploaded framework: one original ABSORBED by 7370, two standalone leftovers
    s.add(UploadedFramework(id=100, tenant_id=TENANT, name="ISO/IEC 27001:2022", file_name="iso.xlsx",
                            file_path="/tmp/iso.xlsx", file_type="xlsx",
                            uploaded_by=1, is_active=True, is_shared=False))
    s.add_all([
        ParsedFrameworkControl(id=1001, uploaded_framework_id=100, control_id="A.8.24", original_reference="A.8.24",
                               title="Use of cryptography", domain="Technological",
                               description="Rules for the effective use of cryptography shall be defined."),
        ParsedFrameworkControl(id=1002, uploaded_framework_id=100, control_id="A.8.9", original_reference="A.8.9",
                               title="Configuration management", domain="Technological",
                               description="Security configurations shall be established and reviewed."),
        ParsedFrameworkControl(id=1003, uploaded_framework_id=100, control_id="A.5.1", original_reference="A.5.1",
                               title="Policies for information security", domain="Organizational",
                               description="Information security policies shall be defined."),
    ])
    s.add(NormalizedControlLink(normalized_control_id=7370, parsed_control_id=1001))
    s.commit()
    yield s
    s.close()


# ── corpus ────────────────────────────────────────────────────────────────────
def test_corpus_is_baseline_plus_standalone_leftovers_only(db):
    corpus = m.load_corpus(db, TENANT)
    got = {(c["kind"], c["ref_id"]) for c in corpus}
    assert ("normalized_control", 7370) in got
    assert ("normalized_control", 9910) not in got, "junk session leaked into the corpus"
    assert ("parsed_framework_control", 1001) not in got, "absorbed original must not appear twice"
    assert ("parsed_framework_control", 1002) in got and ("parsed_framework_control", 1003) in got
    # local ids are 1..N in deterministic order; group size recorded
    assert [c["id"] for c in corpus] == list(range(1, len(corpus) + 1))
    assert next(c for c in corpus if c["ref_id"] == 7370)["members"] == 1


def test_corpus_without_baseline_run_includes_everything(db):
    db.query(NormalizationRun).delete(); db.commit()
    corpus = m.load_corpus(db, TENANT)
    got = {(c["kind"], c["ref_id"]) for c in corpus}
    assert ("normalized_control", 7370) in got and ("normalized_control", 9910) in got


def test_chapters_cover_the_whole_corpus_in_order(db, monkeypatch):
    monkeypatch.setattr(m, "_CHAPTER_BUDGET", 250)      # force several chapters
    corpus = m.load_corpus(db, TENANT)
    chapters = m._chapters(corpus)
    assert len(chapters) > 1
    flat = [c["id"] for ch in chapters for c in ch]
    assert flat == [c["id"] for c in corpus]            # nothing lost, order kept


# ── fake client speaking the two-round protocol ───────────────────────────────
class _TwoRound:
    """ROUND 1 (system mentions candidate_ids): flag every line whose text contains
    any of `flag_terms`. ROUND 2: return the scripted payload. Counts calls."""
    def __init__(self, flag_terms, final_payload):
        self.flag_terms = flag_terms; self.final = final_payload
        self.scan_calls = 0; self.judge_calls = 0
    @property
    def chat(self):
        outer = self
        class _C:
            class completions:
                @staticmethod
                def create(**kw):
                    system = kw["messages"][0]["content"]; user = kw["messages"][1]["content"]
                    if "candidate_ids" in system:
                        outer.scan_calls += 1
                        ids = []
                        for line in user.splitlines():
                            mm = re.match(r"^\s*(\d+) \|", line)
                            if mm and any(t.lower() in line.lower() for t in outer.flag_terms):
                                ids.append(int(mm.group(1)))
                        payload = json.dumps({"candidate_ids": ids})
                    else:
                        outer.judge_calls += 1
                        payload = outer.final if isinstance(outer.final, str) else json.dumps(outer.final)
                    class _R:
                        choices = [type("m", (), {"message": type("x", (), {"content": payload})()})()]
                    return _R()
        return _C()


def test_two_rounds_flag_then_judge_maps_back_to_real_refs(db, monkeypatch):
    monkeypatch.setattr(m, "_CHAPTER_BUDGET", 250)
    corpus = m.load_corpus(db, TENANT)
    tls_lid = _lid(corpus, 7370)
    client = _TwoRound(["Cryptographic", "cryptography"], {
        "suggestions": [{"control_id": tls_lid, "confidence": "high",
                         "reason": "weak TLS — cipher review", "driven_by": "cwe"}]})
    r = m.suggest_controls(db, _v(title="TLS Version 1.1 Protocol Detection", cwe_id="CWE-327"),
                           client=client, model="fake")
    assert client.scan_calls == len(m._chapters(corpus)), "every chapter must be scanned"
    assert client.judge_calls == 1
    assert r["candidates"] >= 1 and r["corpus_size"] == len(corpus)
    s = r["suggestions"][0]
    assert (s["kind"], s["control_id"]) == ("normalized_control", 7370)   # local id mapped back
    assert r["prompt"]["round1"]["chapters"] == client.scan_calls
    assert r["prompt_version"] == m.PROMPT_VERSION


def test_judge_may_only_pick_flagged_ids(db):
    corpus = m.load_corpus(db, TENANT)
    mfa_lid = _lid(corpus, 6942)
    # scan flags ONLY crypto lines; judge tries to sneak in the unflagged MFA control + a made-up id
    client = _TwoRound(["cryptography", "Cryptographic"], {
        "suggestions": [{"control_id": mfa_lid, "confidence": "high", "reason": "sneak", "driven_by": "cwe"},
                        {"control_id": 999999, "confidence": "high", "reason": "made up", "driven_by": "cwe"}]})
    r = m.suggest_controls(db, _v(title="TLS 1.0 enabled", cwe_id="CWE-327"), client=client, model="fake")
    assert r["suggestions"] == []
    assert sorted(r["dropped_invalid_ids"]) == [mfa_lid, 999999]


def test_scan_flags_only_its_own_chapter_lines(db, monkeypatch):
    monkeypatch.setattr(m, "_CHAPTER_BUDGET", 250)
    class _Rogue(_TwoRound):
        @property
        def chat(self):
            outer = self
            class _C:
                class completions:
                    @staticmethod
                    def create(**kw):
                        system = kw["messages"][0]["content"]
                        if "candidate_ids" in system:
                            outer.scan_calls += 1
                            payload = json.dumps({"candidate_ids": [999999]})   # never a real line
                        else:
                            outer.judge_calls += 1
                            payload = json.dumps({"suggestions": [],
                                                  "no_specific_control_reason": "nothing matched"})
                        class _R:
                            choices = [type("m", (), {"message": type("x", (), {"content": payload})()})()]
                        return _R()
            return _C()
    client = _Rogue([], "{}")
    r = m.suggest_controls(db, _v(title="anything"), client=client, model="fake")
    assert r["candidates"] == 0 and r["suggestions"] == []
    assert r["no_specific_control_reason"] == "nothing matched"


def test_chapter_failure_aborts_with_error_never_raises(db, monkeypatch):
    monkeypatch.setattr(m, "_CHAPTER_BUDGET", 250)
    class _Boom:
        @property
        def chat(self):
            class _C:
                class completions:
                    @staticmethod
                    def create(**kw):
                        raise RuntimeError("network down")
            return _C()
    r = m.suggest_controls(db, _v(title="TLS 1.0 enabled", cwe_id="CWE-327"), client=_Boom(), model="fake")
    assert "error" in r and "chapter" in r["error"] and r["suggestions"] == []


def test_empty_answer_is_valid_and_reason_kept(db):
    client = _TwoRound(["cryptography", "Cryptographic"],
                       {"suggestions": [], "no_specific_control_reason": "pure inventory note"})
    r = m.suggest_controls(db, _v(title="Some finding"), client=client, model="fake")
    assert r["suggestions"] == [] and r["no_specific_control_reason"] == "pure inventory note"


def test_bucket_is_a_column_check_not_regex(db):
    assert m.bucket_for(_v(cve_id="CVE-2026-1")) == "cve"
    assert m.bucket_for(_v(cwe_id="CWE-327")) == "cve"
    assert m.bucket_for(_v(title="OS Identification")) == "described_weakness"


def test_judge_prompt_carries_rules_and_flagged_lines_only(db):
    client = _TwoRound(["cryptography", "Cryptographic"], {"suggestions": []})
    r = m.suggest_controls(db, _v(title="TLS 1.0", cwe_id="CWE-327"), client=client, model="fake")
    p = r["prompt"]
    assert "FLAGGED CANDIDATE CONTROLS" in p["user"] and "ULV2-00906" in p["user"]
    assert "ULV2-00488" not in p["user"], "unflagged controls must not reach the judge"
    assert "do NOT select them" in p["system"]                 # patch-mgmt exclusion
    assert "HARDENING weakness" in p["system"]
    assert "pure inventory note" in p["system"]
