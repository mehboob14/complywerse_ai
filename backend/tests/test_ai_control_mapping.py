"""P5 — AI control mapping: the properties the 3-iteration battery proved,
pinned hermetically. A FAKE model client stands in for OpenAI (no API spend),
so what's tested is OUR logic: the bucket classifier, the shortlist builder
(the part that failed in iterations 1–2), the never-trust-an-unlisted-id guard,
and the never-raise contract. Control names are the tenant's REAL library
values (copied from the DB), seeded only in the throwaway in-memory SQLite.
"""
import json
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from grc.models import Vulnerability, NormalizedControl, ParsedFrameworkControl, UploadedFramework
from grc.services import ai_control_mapping as m


def _pid(cands, ref_id, kind="normalized_control"):
    """The prompt-local id the model must answer with for a real control row."""
    for c in cands:
        if c["kind"] == kind and c["ref_id"] == ref_id:
            return c["id"]
    raise AssertionError(f"{kind}:{ref_id} not in shortlist {[(c['kind'], c['ref_id']) for c in cands]}")

TENANT = 1


class _Row:
    def __init__(self, **kw): self.__dict__.update(kw)


def _v(**kw):
    base = dict(id=1, tenant_id=TENANT, title="", description="", cve_id=None, cwe_id=None,
                cvss_vector=None, severity="info", epss_score=None, kev_flag=False)
    base.update(kw); return _Row(**base)


# ── bucket classifier (no DB, no model) ──────────────────────────────────────
def test_classifier_three_buckets():
    assert m.classify_finding(_v(cve_id="CVE-2026-2003"))[0] == "cve"
    assert m.classify_finding(_v(cwe_id="CWE-327"))[0] == "cve"
    # described weakness, no CVE
    assert m.classify_finding(_v(title="Microsoft Windows SMB Registry Remotely Accessible"))[0] == "described_weakness"
    assert m.classify_finding(_v(title="SSL Self-Signed Certificate"))[0] == "described_weakness"
    # inventory notes — never sent
    for t in ["OS Identification", "PostgreSQL Server Installed (Windows)",
              "Microsoft Windows Logged On Users", "WordPad History", "Netstat Connection Information"]:
        assert m.classify_finding(_v(title=t))[0] == "inventory", t


def test_classifier_never_hides_a_real_weakness_as_inventory():
    # the safety property: a title with a weakness word wins over an inventory word
    for t in ["TLS Version 1.1 Protocol Detection",            # 'detection' but weak TLS
              "Microsoft Windows Print Spooler Service Enabled",
              "SSL Certificate Cannot Be Trusted",
              "Microsoft Windows Unquoted Service Path Enumeration"]:  # 'enumeration' but a real flaw
        assert m.classify_finding(_v(title=t))[0] != "inventory", t


# ── shortlist builder against a real-shaped library ──────────────────────────
@pytest.fixture
def db():
    engine = create_engine("sqlite://")
    for mm in (Vulnerability, NormalizedControl, UploadedFramework, ParsedFrameworkControl):
        mm.__table__.create(engine)
    s = sessionmaker(bind=engine)()
    # an uploaded framework (ISO 27001:2022 shape) — the SECOND retrieval source
    s.add(UploadedFramework(id=100, tenant_id=TENANT, name="ISO/IEC 27001:2022", file_name="iso.xlsx",
                            file_path="/tmp/iso.xlsx", file_type="xlsx",
                            uploaded_by=1, is_active=True, is_shared=False))
    s.add_all([
        ParsedFrameworkControl(id=1001, uploaded_framework_id=100, control_id="A.8.24", original_reference="A.8.24",
                               title="Use of cryptography", domain="Technological",
                               description="Rules for the effective use of cryptography, including cryptographic key management, shall be defined and implemented."),
        ParsedFrameworkControl(id=1002, uploaded_framework_id=100, control_id="A.8.9", original_reference="A.8.9",
                               title="Configuration management", domain="Technological",
                               description="Configurations, including security configurations, of hardware, software, services and networks shall be established, documented, implemented, monitored and reviewed."),
        ParsedFrameworkControl(id=1003, uploaded_framework_id=100, control_id="A.5.1", original_reference="A.5.1",
                               title="Policies for information security", domain="Organizational",
                               description="Information security policy and topic-specific policies shall be defined."),
    ])
    # REAL control names/codes from the tenant library (see DB), plus decoys
    s.add_all([
        NormalizedControl(id=7551, code="ULV2-01097", name="Ensure authenticity and integrity of application messages",
                          domain="Application & Software Security", statement="Verify signatures / integrity of messages and software."),
        NormalizedControl(id=4915, code="NCS25-0128", name="Application Whitelisting", domain="Endpoint", statement="Allow only trusted software to run."),
        NormalizedControl(id=5150, code="NCS25-0286", name="Input Data Validation", domain="Application & Software Security", statement="Validate all input data types and lengths."),
        NormalizedControl(id=7370, code="ULV2-00906", name="Document and Review Cryptographic Cipher Suites and Protocols",
                          domain="Cryptography", statement="Review TLS cipher suites and protocol versions regularly."),
        NormalizedControl(id=7660, code="ULV2-01196", name="Configure systems for least functionality by disabling unnecessary services",
                          domain="Secure Configuration", statement="Disable services, ports and protocols not required."),
        NormalizedControl(id=4862, code="NCS25-0075", name="System Hardening Standards", domain="Secure Configuration", statement="Apply hardening baselines."),
        # decoys — MFA/password controls that FLOODED the shortlist in iteration 2
        NormalizedControl(id=6942, code="ULV2-00488", name="Require multi-factor authentication for application access", domain="Access", statement="MFA."),
        NormalizedControl(id=6968, code="ULV2-00514", name="Use unique passwords for each user account", domain="Access", statement="Password uniqueness."),
        NormalizedControl(id=4962, code="NCS25-0175", name="Password Policy", domain="Access", statement="Password rules."),
        NormalizedControl(id=9001, code="X-1", name="Board oversight of cybersecurity", domain="Governance", statement="Governance."),
    ])
    s.commit()
    yield s
    s.close()


def test_shortlist_surfaces_signature_control_over_auth_decoys(db):
    """Iteration-2 root cause pinned: WinVerifyTrust (CWE-347) has 'authentication'
    in its DESCRIPTION; that must NOT flood the shortlist with MFA/password controls
    and push the code-signing/integrity control out. The CWE's concept dominates."""
    v = _v(title="WinVerifyTrust Signature Validation CVE-2013-3900 Mitigation",
           cve_id="CVE-2013-3900", cwe_id="CWE-347",
           description="WinVerifyTrust does not properly validate signatures; authentication of the binary can be bypassed.")
    cands = m.build_candidates(db, v, cwe_name="Improper Verification of Cryptographic Signature", max_candidates=3)
    ids = [c["ref_id"] for c in cands if c["kind"] == "normalized_control"]
    assert 7551 in ids, ids                       # the integrity control makes the top-3
    assert cands[0]["ref_id"] in (7551, 4915)     # ranked above the password/MFA decoys


def test_shortlist_for_tls_and_spooler(db):
    tls = m.build_candidates(db, _v(title="TLS Version 1.1 Protocol Detection", cwe_id="CWE-327"),
                             cwe_name="Use of a Broken or Risky Cryptographic Algorithm", max_candidates=3)
    kinds_refs = [(c["kind"], c["ref_id"]) for c in tls]
    assert ("normalized_control", 7370) in kinds_refs, kinds_refs
    # the FRAMEWORK source is live: ISO A.8.24 "Use of cryptography" competes for the same weakness
    assert ("parsed_framework_control", 1001) in kinds_refs, kinds_refs
    sp = m.build_candidates(db, _v(title="Microsoft Windows Print Spooler Service Enabled"), max_candidates=2)
    assert sp[0]["ref_id"] in (7660, 4862, 1002)


# ── the model boundary: fake client, real validation ─────────────────────────
class _FakeClient:
    """Returns whatever JSON we script — lets us test OUR post-processing."""
    def __init__(self, payload): self._p = payload
    class _Choices:
        def __init__(self, content): self.message = _Row(content=content)
    class _Resp:
        def __init__(self, content): self.choices = [_FakeClient._Choices(content)]
    @property
    def chat(self):
        outer = self
        class _C:
            class completions:
                @staticmethod
                def create(**kw): return _FakeClient._Resp(outer._p)
        return _C()


def test_unlisted_control_id_is_dropped_never_trusted(db):
    """THE guard: the model names an id we never offered → dropped + recorded,
    never returned as a suggestion."""
    v = _v(title="TLS Version 1.1 Protocol Detection", cwe_id="CWE-327")
    cands = m.build_candidates(db, v, cwe_name="Use of a Broken or Risky Cryptographic Algorithm", tenant_id=TENANT)
    ok_ucl = _pid(cands, 7370)                                # a real UCL control, by its PROMPT-LOCAL id
    ok_fw = _pid(cands, 1001, "parsed_framework_control")     # a real ISO control, ditto
    payload = json.dumps({"suggestions": [
        {"control_id": ok_ucl, "confidence": "high", "reason": "TLS review", "driven_by": "cwe"},
        {"control_id": ok_fw, "confidence": "high", "reason": "ISO crypto rules", "driven_by": "cwe"},
        {"control_id": 999999, "confidence": "high", "reason": "made up", "driven_by": "cwe"},
    ]})
    r = m.suggest_controls(db, v, cwe_name="Use of a Broken or Risky Cryptographic Algorithm",
                           client=_FakeClient(payload), model="fake")
    got = {(x["kind"], x["control_id"]) for x in r["suggestions"]}
    # prompt-local ids are mapped BACK to the real row of the right kind — never leak, never collide
    assert got == {("normalized_control", 7370), ("parsed_framework_control", 1001)}, got
    assert r["dropped_invalid_ids"] == [999999]


def test_inventory_never_calls_the_model(db):
    class _Boom:
        @property
        def chat(self): raise AssertionError("model must not be called for inventory")
    r = m.suggest_controls(db, _v(title="OS Identification"), client=_Boom(), model="fake")
    assert r["bucket"] == "inventory" and r["suggestions"] == [] and r["candidates"] == 0


def test_model_empty_answer_is_valid_and_reason_kept(db):
    # a finding that IS sent (has candidates) but the model returns an empty list
    v = _v(title="TLS Version 1.1 Protocol Detection", cwe_id="CWE-327")
    payload = json.dumps({"suggestions": [], "no_specific_control_reason": "pure inventory note"})
    r = m.suggest_controls(db, v, client=_FakeClient(payload), model="fake")
    assert r["suggestions"] == [] and r["no_specific_control_reason"] == "pure inventory note"


def test_no_candidates_short_circuits_without_calling_model(db):
    """If the shortlist is empty there is nothing the model may choose from —
    so it is not called (no cost, no chance to hallucinate) and the reason says why."""
    class _Boom:
        @property
        def chat(self): raise AssertionError("model must not be called with no candidates")
    r = m.suggest_controls(db, _v(title="Microsoft Windows ARP Table"), client=_Boom(), model="fake")
    assert r["bucket"] == "described_weakness" and r["candidates"] == 0
    assert r["suggestions"] == [] and "no relevant candidates" in r["no_specific_control_reason"]


def test_model_failure_never_raises(db):
    class _Broken:
        @property
        def chat(self): raise RuntimeError("network down")
    r = m.suggest_controls(db, _v(title="TLS Version 1.1 Protocol Detection", cwe_id="CWE-327"),
                           client=_Broken(), model="fake")
    assert "error" in r and r["suggestions"] == []


def test_prompt_contains_only_offered_candidates_and_the_rules(db):
    v = _v(title="TLS Version 1.1 Protocol Detection", cwe_id="CWE-327")
    r = m.suggest_controls(db, v, client=_FakeClient('{"suggestions":[]}'), model="fake")
    p = r["prompt"]["user"]
    assert "CANDIDATE CONTROLS" in p and "ULV2-00906" in p and "A.8.24" in p   # both sources are offered
    assert "Do NOT suggest them" in r["prompt"]["system"]        # patch-mgmt exclusion
    assert "HARDENING weakness" in r["prompt"]["system"]         # iteration-2 hardening rule
    assert r["prompt_version"] == m.PROMPT_VERSION


# ── the coverage gap the audit measured: 12 of the tenant's 18 CWEs are outside
# the 25-row hand table. For each, with the REAL finding title from the DB, the
# corpus retrieval must offer candidates (else the model is never asked and the
# finding stays generic-only forever). Titles are real; expectations are only
# "non-empty and id-valid" — the semantic pick is the model's, verified in the
# live battery, not here.
_UNCOVERED = [
    ("CWE-20",   "Improper Input Validation",                 "pnpm < 10.34.2 / 11.x < 11.5.3 Multiple Vulnerabilities"),
    ("CWE-122",  "Heap-based Buffer Overflow",                "RARLAB WinRAR < 7.23 Heap-Based Buffer Overflow (CVE-2026-14191)"),
    ("CWE-129",  "Improper Validation of Array Index",        "Node.js module vulnerability (array index)"),
    ("CWE-289",  "Authentication Bypass by Alternate Name",   "Node.js Module node-tar Authentication Bypass"),
    ("CWE-346",  "Origin Validation Error",                   "Node.js Module Origin Validation"),
    ("CWE-347",  "Improper Verification of Cryptographic Signature", "WinVerifyTrust Signature Validation CVE-2013-3900 Mitigation"),
    ("CWE-359",  "Exposure of Private Personal Information",  "Node.js Module Information Exposure"),
    ("CWE-400",  "Uncontrolled Resource Consumption",         "Node.js Module Denial of Service"),
    ("CWE-428",  "Unquoted Search Path or Element",           "Microsoft Windows Unquoted Service Path Enumeration"),
    ("CWE-441",  "Unintended Proxy or Intermediary",          "Node.js Module Proxy Vulnerability"),
    ("CWE-1287", "Improper Validation of Specified Type of Input", "Node.js Module Type Confusion"),
    ("CWE-1321", "Improperly Controlled Modification of Object Prototype Attributes", "Node.js Module Prototype Pollution"),
]


@pytest.mark.parametrize("cwe,cwe_name,title", _UNCOVERED, ids=[u[0] for u in _UNCOVERED])
def test_uncovered_cwe_reaches_the_model_with_valid_candidates(db, cwe, cwe_name, title):
    v = _v(title=title, cwe_id=cwe, cve_id="CVE-2026-0001")
    cands = m.build_candidates(db, v, cwe_name=cwe_name, tenant_id=TENANT)
    assert cands, f"{cwe} produced NO candidates — it would never reach the model"
    # every candidate is a real row of a known kind, with a prompt-local id 1..N
    assert all(c["kind"] in ("normalized_control", "parsed_framework_control") for c in cands)
    assert [c["id"] for c in cands] == list(range(1, len(cands) + 1))
    # a fake model choosing the top candidate must map back to a real ref of the same kind
    top = cands[0]
    r = m.suggest_controls(db, v, cwe_name=cwe_name, model="fake",
                           client=_FakeClient(json.dumps({"suggestions": [
                               {"control_id": top["id"], "confidence": "medium", "reason": "x", "driven_by": "cwe"}]})))
    assert r["suggestions"] and (r["suggestions"][0]["kind"], r["suggestions"][0]["control_id"]) == (top["kind"], top["ref_id"])
