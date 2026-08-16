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

from grc.models import Vulnerability, NormalizedControl
from grc.services import ai_control_mapping as m

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
    for mm in (Vulnerability, NormalizedControl):
        mm.__table__.create(engine)
    s = sessionmaker(bind=engine)()
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
    ids = [c["id"] for c in cands]
    assert 7551 in ids, ids                       # the integrity control makes the top-3
    assert ids[0] in (7551, 4915)                 # ranked above the password/MFA decoys


def test_shortlist_for_tls_and_spooler(db):
    tls = m.build_candidates(db, _v(title="TLS Version 1.1 Protocol Detection", cwe_id="CWE-327"),
                             cwe_name="Use of a Broken or Risky Cryptographic Algorithm", max_candidates=2)
    assert tls[0]["id"] == 7370
    sp = m.build_candidates(db, _v(title="Microsoft Windows Print Spooler Service Enabled"), max_candidates=2)
    assert sp[0]["id"] in (7660, 4862)


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
    payload = json.dumps({"suggestions": [
        {"control_id": 7370, "confidence": "high", "reason": "TLS review", "driven_by": "cwe"},
        {"control_id": 999999, "confidence": "high", "reason": "made up", "driven_by": "cwe"},
    ]})
    r = m.suggest_controls(db, v, client=_FakeClient(payload), model="fake")
    assert [s["control_id"] for s in r["suggestions"]] == [7370]
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
    assert "CANDIDATE CONTROLS" in p and "7370" in p
    assert "Do NOT suggest them" in r["prompt"]["system"]        # patch-mgmt exclusion
    assert "HARDENING weakness" in r["prompt"]["system"]         # iteration-2 hardening rule
    assert r["prompt_version"] == m.PROMPT_VERSION
