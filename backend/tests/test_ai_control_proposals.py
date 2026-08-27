"""Context-mapping review flow — generate → (confidence gate) → accept / reject,
hermetic (fake two-round client).

Load-bearing properties (docs/CTEM_CONTEXT_MAPPING_BUILD_PLAN.md):
  (1) STICKER RULE — a finding with any stored answer is skipped on re-runs
      (zero model calls); `force=True` re-maps but never overrides decisions;
  (2) the confidence gate — at/above the floor auto-links (note `ai_auto:`),
      below lands `proposed`; gate OFF links nothing;
  (3) GROUP FAN-OUT — linking a library control also links its original
      framework controls (`ai_family:p<id>`), and one Reject unwinds the family;
  (4) every analysed finding gets a stored answer (proposal, marker, or link) —
      never a silent blank; the AI's own "pure inventory note" verdict is stored;
  (5) reuse: a human decision on a weakness type applies to later findings
      without a model call; a reject is never re-proposed.
"""
import json
import re
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from grc.models import (Vulnerability, ITAsset, VulnerabilityAssetLink, NormalizedControl,
                        NormalizedControlLink, VulnerabilityControlLink, AiControlProposal,
                        AiControlProposalRun, ParsedFrameworkControl, UploadedFramework)
from grc.services import ai_control_proposals as svc

TENANT = 1


class _Fake:
    """Two-round scripted client. ROUND 1 (system mentions candidate_ids): flag every
    line in the chapter — the judge decides. ROUND 2: if a table key appears in the
    finding, answer with the prompt-local ids of its codes; else empty + reason.
    `calls` counts JUDGE calls (the reason-once assertions key on it)."""
    def __init__(self, table, conf=None, empty_reason="no candidate control addresses this weakness"):
        self.t = table; self.conf = conf or {}; self.empty_reason = empty_reason
        self.calls = 0; self.scan_calls = 0
    @property
    def chat(self):
        outer = self
        class _C:
            class completions:
                @staticmethod
                def create(**kw):
                    system = kw["messages"][0]["content"]; user = kw["messages"][1]["content"]
                    if "candidate_ids" in system:                     # round 1: flag everything
                        outer.scan_calls += 1
                        ids = [int(mm.group(1)) for line in user.splitlines()
                               if (mm := re.match(r"^\s*(\d+) \|", line))]
                        payload = {"candidate_ids": ids}
                    else:                                             # round 2: judge
                        outer.calls += 1
                        def local_id(code):
                            mm = re.search(r"^\s*(\d+) \| " + re.escape(code) + r" \|", user, re.M)
                            return int(mm.group(1)) if mm else None
                        for key, codes in outer.t.items():
                            if key in user:
                                ids = [local_id(c) for c in codes]
                                payload = {"suggestions": [{"control_id": i, "confidence": outer.conf.get(key, "high"),
                                                            "reason": f"addresses {key}", "driven_by": "cwe"}
                                                           for i in ids if i is not None]}
                                break
                        else:
                            payload = {"suggestions": [], "no_specific_control_reason": outer.empty_reason}
                    class _R:
                        choices = [type("m", (), {"message": type("x", (), {"content": json.dumps(payload)})()})()]
                    return _R()
        return _C()


@pytest.fixture(autouse=True)
def _gate_off(monkeypatch):
    """Default the confidence gate OFF so the review-flow tests exercise the human
    path (every suggestion lands `proposed`). Gate tests set a floor explicitly."""
    monkeypatch.setenv("AI_AUTOLINK_MIN_CONFIDENCE", "off")


@pytest.fixture
def db():
    e = create_engine("sqlite://")
    for m in (Vulnerability, ITAsset, VulnerabilityAssetLink, NormalizedControl,
              NormalizedControlLink, VulnerabilityControlLink, AiControlProposal,
              AiControlProposalRun, UploadedFramework, ParsedFrameworkControl):
        m.__table__.create(e)
    s = sessionmaker(bind=e)()
    s.add(ITAsset(id=1, tenant_id=TENANT, name="DESKTOP-CE3EFJB", host_name="DESKTOP-CE3EFJB",
                  asset_type="infrastructure", status="active"))
    s.add_all([
        Vulnerability(id=10, tenant_id=TENANT, vuln_id="NS-A", title="TLS Version 1.1 Protocol Detection",
                      severity="info", status="open", cwe_id="CWE-327"),
        Vulnerability(id=11, tenant_id=TENANT, vuln_id="NS-B", title="OS Identification",
                      severity="info", status="open"),
    ])
    s.add_all([VulnerabilityAssetLink(vulnerability_id=10, asset_id=1),
               VulnerabilityAssetLink(vulnerability_id=11, asset_id=1)])
    s.add_all([  # REAL library names
        NormalizedControl(id=7370, code="ULV2-00906", name="Document and Review Cryptographic Cipher Suites and Protocols",
                          domain="Cryptography", statement="Review TLS cipher suites and protocol versions."),
        NormalizedControl(id=7660, code="ULV2-01196", name="Configure systems for least functionality by disabling unnecessary services",
                          domain="Secure Configuration", statement="Disable services not required."),
    ])
    # 7370 is a GROUP: it wraps two original framework controls (the fan-out family)
    s.add(UploadedFramework(id=300, tenant_id=TENANT, name="PCI Data Security Standard", file_name="pci.xlsx",
                            file_path="/tmp/pci.xlsx", file_type="xlsx", uploaded_by=1,
                            is_active=True, is_shared=False))
    s.add_all([
        ParsedFrameworkControl(id=2001, uploaded_framework_id=300, control_id="4.1", original_reference="4.1",
                               title="Use strong cryptography for transmission", domain="Crypto",
                               description="Strong cryptography during transmission over open networks."),
        ParsedFrameworkControl(id=2002, uploaded_framework_id=300, control_id="2.2.5", original_reference="2.2.5",
                               title="Configure security parameters", domain="Config",
                               description="Configure system security parameters to prevent misuse."),
    ])
    s.add_all([NormalizedControlLink(normalized_control_id=7370, parsed_control_id=2001),
               NormalizedControlLink(normalized_control_id=7370, parsed_control_id=2002)])
    s.commit()
    yield s
    s.close()


FAKE = _Fake({"TLS Version 1.1": ["ULV2-00906"]})


# ── gate ──────────────────────────────────────────────────────────────────────
def test_gate_off_writes_proposals_only_never_links(db):
    r = svc.generate_proposals(db, TENANT, vulnerability_ids=[10], client=FAKE, model="fake")
    db.commit()
    assert r["findings_total"] == 1 and r["findings_sent"] == 1 and r["model_errors"] == 0
    assert r["proposals_created"] == 1
    assert db.query(VulnerabilityControlLink).count() == 0            # gate off → no links
    p = db.query(AiControlProposal).one()
    assert p.status == "proposed" and p.normalized_control_id == 7370 and p.prompt_inputs and p.raw_output


def test_gate_autolinks_and_fans_out_the_group(db, monkeypatch):
    monkeypatch.setenv("AI_AUTOLINK_MIN_CONFIDENCE", "medium")   # high clears it
    svc.generate_proposals(db, TENANT, vulnerability_ids=[10], triggered_by=99,
                           client=_Fake({"TLS Version 1.1": ["ULV2-00906"]}), model="fake"); db.commit()
    p = db.query(AiControlProposal).one()
    assert p.status == "accepted" and p.provenance == "model" and p.decided_by == 99
    links = db.query(VulnerabilityControlLink).all()
    by_note = {(l.normalized_control_id, l.parsed_framework_control_id): (l.notes or "") for l in links}
    assert (7370, None) in by_note and by_note[(7370, None)].startswith("ai_auto:")
    # THE GROUP RULE: the two original framework controls linked too, tagged to this proposal
    assert (None, 2001) in by_note and by_note[(None, 2001)].startswith(f"ai_family:p{p.id} ")
    assert (None, 2002) in by_note and by_note[(None, 2002)].startswith(f"ai_family:p{p.id} ")
    assert len(links) == 3


def test_gate_holds_low_confidence_for_review(db, monkeypatch):
    monkeypatch.setenv("AI_AUTOLINK_MIN_CONFIDENCE", "medium")
    low = _Fake({"TLS Version 1.1": ["ULV2-00906"]}, conf={"TLS Version 1.1": "low"})
    svc.generate_proposals(db, TENANT, vulnerability_ids=[10], client=low, model="fake"); db.commit()
    p = db.query(AiControlProposal).one()
    assert p.status == "proposed"                                # weak guess waits for a human
    assert db.query(VulnerabilityControlLink).count() == 0


def test_reject_unwinds_the_whole_family(db, monkeypatch):
    monkeypatch.setenv("AI_AUTOLINK_MIN_CONFIDENCE", "high")
    svc.generate_proposals(db, TENANT, vulnerability_ids=[10], triggered_by=99,
                           client=_Fake({"TLS Version 1.1": ["ULV2-00906"]}), model="fake"); db.commit()
    assert db.query(VulnerabilityControlLink).count() == 3       # main + 2 family
    p = db.query(AiControlProposal).one()
    out = svc.reject_proposal(db, TENANT, p.id, user_id=42, note="not applicable"); db.commit()
    assert out["unlinked"] is True and out["family_links_removed"] == 2
    assert db.query(VulnerabilityControlLink).count() == 0       # one Reject → whole family gone
    db.refresh(p); assert p.status == "rejected" and p.control_link_id is None


# ── every finding gets an answer, no regex ────────────────────────────────────
def test_every_finding_gets_a_stored_answer(db):
    fake = _Fake({"TLS Version 1.1": ["ULV2-00906"]},
                 empty_reason="This finding is a pure inventory note with no identified weaknesses.")
    r = svc.generate_proposals(db, TENANT, client=fake, model="fake"); db.commit()
    assert r["findings_sent"] == 2                               # BOTH went to the AI — no regex skip
    p10 = db.query(AiControlProposal).filter(AiControlProposal.vulnerability_id == 10).one()
    p11 = db.query(AiControlProposal).filter(AiControlProposal.vulnerability_id == 11).one()
    assert p10.status == "proposed" and p10.normalized_control_id == 7370
    # the AI's own inventory verdict is the stored answer — marker, bucket inventory
    assert p11.status == "no_control" and p11.bucket == "inventory"
    assert p11.normalized_control_id is None and p11.parsed_framework_control_id is None


def test_no_specific_vs_patch_only_markers(db):
    db.add(Vulnerability(id=20, tenant_id=TENANT, vuln_id="NS-CVE", title="Rando finding",
                         severity="high", status="open", cve_id="CVE-2024-9999"))
    db.add(VulnerabilityAssetLink(vulnerability_id=20, asset_id=1)); db.commit()
    empty = _Fake({})   # finds nothing, reason has no "inventory" wording
    svc.generate_proposals(db, TENANT, vulnerability_ids=[10, 20], client=empty, model="fake"); db.commit()
    m10 = db.query(AiControlProposal).filter(AiControlProposal.vulnerability_id == 10).one()
    m20 = db.query(AiControlProposal).filter(AiControlProposal.vulnerability_id == 20).one()
    assert m10.status == "no_control" and m10.bucket == "no_specific"   # CWE, no CVE, no control
    assert m20.status == "no_control" and m20.bucket == "patch_only"    # has a CVE → the fix is to patch
    assert db.query(VulnerabilityControlLink).count() == 0
    assert len(svc.list_proposals(db, TENANT)) == 0              # markers never enter the review list


# ── the sticker rule ──────────────────────────────────────────────────────────
def test_second_run_skips_answered_findings_zero_model_calls(db):
    fake = _Fake({"TLS Version 1.1": ["ULV2-00906"]})
    svc.generate_proposals(db, TENANT, client=fake, model="fake"); db.commit()
    judge_before, scan_before = fake.calls, fake.scan_calls
    r2 = svc.generate_proposals(db, TENANT, client=fake, model="fake"); db.commit()
    assert fake.calls == judge_before and fake.scan_calls == scan_before, "answered findings must cost nothing"
    assert r2["findings_skipped_existing"] == 2 and r2["findings_sent"] == 0
    assert db.query(AiControlProposal).count() == 2              # nothing duplicated


def test_force_rerun_refreshes_a_marker_when_a_control_is_later_found(db):
    empty = _Fake({})
    svc.generate_proposals(db, TENANT, vulnerability_ids=[10], client=empty, model="fake"); db.commit()
    assert db.query(AiControlProposal).filter(AiControlProposal.status == "no_control").count() == 1
    # normal re-run: sticker → skipped, marker stays
    r = svc.generate_proposals(db, TENANT, vulnerability_ids=[10], client=FAKE, model="fake"); db.commit()
    assert r["findings_skipped_existing"] == 1
    # forced re-run: the model now finds a control → marker cleared, proposal written
    svc.generate_proposals(db, TENANT, vulnerability_ids=[10], client=FAKE, model="fake", force=True); db.commit()
    assert db.query(AiControlProposal).filter(AiControlProposal.status == "no_control").count() == 0
    assert db.query(AiControlProposal).filter(AiControlProposal.vulnerability_id == 10).one().status == "proposed"


# ── human decisions ───────────────────────────────────────────────────────────
def test_accept_links_records_approver_and_fans_out(db):
    svc.generate_proposals(db, TENANT, vulnerability_ids=[10], client=FAKE, model="fake"); db.commit()
    p = db.query(AiControlProposal).one()
    out = svc.accept_proposal(db, TENANT, p.id, user_id=42, note="looks right"); db.commit()
    assert out["status"] == "accepted" and out["created"] is True and out["family_links_created"] == 2
    links = db.query(VulnerabilityControlLink).all()
    main = next(l for l in links if l.normalized_control_id == 7370)
    assert main.created_by == 42 and (main.notes or "").startswith("ai_suggested:")
    assert len(links) == 3                                        # group accept → family linked
    db.refresh(p)
    assert p.status == "accepted" and p.decided_by == 42 and p.control_link_id == main.id
    again = svc.accept_proposal(db, TENANT, p.id, user_id=42); db.commit()
    assert again["created"] is False and db.query(VulnerabilityControlLink).count() == 3   # idempotent


def test_reject_after_accept_spares_the_human_link(db):
    svc.generate_proposals(db, TENANT, vulnerability_ids=[10], client=FAKE, model="fake"); db.commit()
    p = db.query(AiControlProposal).one()
    svc.accept_proposal(db, TENANT, p.id, user_id=42); db.commit()
    db.add(VulnerabilityControlLink(vulnerability_id=10, normalized_control_id=7660, notes="manual", created_by=7)); db.commit()
    out = svc.reject_proposal(db, TENANT, p.id, user_id=42, note="not applicable"); db.commit()
    assert out["status"] == "rejected" and out["unlinked"] is True and out["family_links_removed"] == 2
    remaining = db.query(VulnerabilityControlLink).all()
    assert len(remaining) == 1 and remaining[0].notes == "manual"        # human link intact
    db.refresh(p)
    assert p.status == "rejected" and p.control_link_id is None


def test_scope_filter_and_empty_scope(db):
    fake = _Fake({}, empty_reason="pure inventory note")
    r = svc.generate_proposals(db, TENANT, vulnerability_ids=[11], client=fake, model="fake"); db.commit()
    assert r["findings_total"] == 1 and r["findings_sent"] == 1          # sent — the AI is the classifier now
    assert db.query(AiControlProposal).filter(AiControlProposal.vulnerability_id == 11).one().bucket == "inventory"
    r0 = svc.generate_proposals(db, TENANT, vulnerability_ids=[], client=fake, model="fake"); db.commit()
    assert r0["findings_total"] == 0


def test_list_proposals_shape(db):
    svc.generate_proposals(db, TENANT, vulnerability_ids=[10], client=FAKE, model="fake"); db.commit()
    items = svc.list_proposals(db, TENANT)
    assert len(items) == 1
    it = items[0]
    assert it["control"]["code"] == "ULV2-00906" and it["vulnerability"]["vuln_id"] == "NS-A"
    assert it["status"] == "proposed" and it["confidence"] == "high"


# ── reason once, apply many ──────────────────────────────────────────────────
def test_human_accept_on_a_cwe_is_reused_with_family_no_model_call(db):
    fake = _Fake({"TLS Version 1.1": ["ULV2-00906"]})
    svc.generate_proposals(db, TENANT, vulnerability_ids=[10], client=fake, model="fake"); db.commit()
    p = db.query(AiControlProposal).one()
    svc.accept_proposal(db, TENANT, p.id, user_id=42); db.commit()
    judge_before = fake.calls
    db.add(Vulnerability(id=12, tenant_id=TENANT, vuln_id="NS-C", title="TLS Version 1.0 Protocol Detection",
                         severity="info", status="open", cwe_id="CWE-327"))
    db.add(VulnerabilityAssetLink(vulnerability_id=12, asset_id=1)); db.commit()
    r = svc.generate_proposals(db, TENANT, vulnerability_ids=[12], client=fake, model="fake"); db.commit()
    assert fake.calls == judge_before, "a human-decided CWE must NOT be re-asked to the model"
    assert r["proposals_reused"] == 1 and r["findings_sent"] == 0
    q = db.query(AiControlProposal).filter(AiControlProposal.vulnerability_id == 12).one()
    assert q.status == "accepted" and q.provenance == "reused" and q.decided_by == 42
    links12 = db.query(VulnerabilityControlLink).filter(VulnerabilityControlLink.vulnerability_id == 12).all()
    notes = sorted((l.notes or "")[:12] for l in links12)
    assert len(links12) == 3                                     # reuse links the family too
    assert any(n.startswith("ai_reused:") for n in notes) and sum(n.startswith("ai_family:") for n in notes) == 2


def test_human_reject_on_a_cwe_is_never_reproposed(db):
    fake = _Fake({"TLS Version 1.1": ["ULV2-00906"]})
    svc.generate_proposals(db, TENANT, vulnerability_ids=[10], client=fake, model="fake"); db.commit()
    p = db.query(AiControlProposal).one()
    svc.reject_proposal(db, TENANT, p.id, user_id=42); db.commit()
    db.add(Vulnerability(id=12, tenant_id=TENANT, vuln_id="NS-C", title="TLS Version 1.1 Protocol Detection (again)",
                         severity="info", status="open", cwe_id="CWE-327"))
    db.add(VulnerabilityAssetLink(vulnerability_id=12, asset_id=1)); db.commit()
    judge_before = fake.calls
    r = svc.generate_proposals(db, TENANT, vulnerability_ids=[12], client=fake, model="fake"); db.commit()
    assert fake.calls == judge_before and r["findings_sent"] == 0        # decided key → no model call
    assert db.query(AiControlProposal).filter(AiControlProposal.vulnerability_id == 12).count() == 0
    assert db.query(VulnerabilityControlLink).filter(VulnerabilityControlLink.vulnerability_id == 12).count() == 0


def test_reject_a_reused_proposal_unwinds_link_and_family(db):
    fake = _Fake({"TLS Version 1.1": ["ULV2-00906"]})
    svc.generate_proposals(db, TENANT, vulnerability_ids=[10], client=fake, model="fake"); db.commit()
    p = db.query(AiControlProposal).one()
    svc.accept_proposal(db, TENANT, p.id, user_id=42); db.commit()
    db.add(Vulnerability(id=12, tenant_id=TENANT, vuln_id="NS-C", title="TLS Version 1.0 Protocol Detection",
                         severity="info", status="open", cwe_id="CWE-327"))
    db.add(VulnerabilityAssetLink(vulnerability_id=12, asset_id=1)); db.commit()
    svc.generate_proposals(db, TENANT, vulnerability_ids=[12], client=fake, model="fake"); db.commit()
    q = db.query(AiControlProposal).filter(AiControlProposal.vulnerability_id == 12).one()
    out = svc.reject_proposal(db, TENANT, q.id, user_id=43, note="not on this box"); db.commit()
    assert out["unlinked"] is True and out["family_links_removed"] == 2
    assert db.query(VulnerabilityControlLink).filter(VulnerabilityControlLink.vulnerability_id == 12).count() == 0


# ── pipeline counts ───────────────────────────────────────────────────────────
def test_validate_pipeline_counts_every_finding_once(db):
    from grc.services.ctem_scopes import _validate_pipeline
    db.add(Vulnerability(id=20, tenant_id=TENANT, vuln_id="NS-CVE", title="Rando finding",
                         severity="high", status="open", cve_id="CVE-2024-9999"))
    db.add(VulnerabilityAssetLink(vulnerability_id=20, asset_id=1)); db.commit()
    inv = _Fake({}, empty_reason="pure inventory note")
    empty = _Fake({})
    svc.generate_proposals(db, TENANT, vulnerability_ids=[10], client=inv, model="fake")
    svc.generate_proposals(db, TENANT, vulnerability_ids=[20], client=empty, model="fake"); db.commit()
    p = _validate_pipeline(db, [10, 11, 20])
    # v10 → informational (AI verdict) · v20 → analysed + patch_only · v11 → not yet mapped
    assert p["informational"] == 1 and p["patch_only"] == 1 and p["unmapped"] == 1
    assert p["analysed"] == 1 and p["linked"] == 0 and p["no_specific"] == 0
    assert p["analysed"] + p["informational"] + p["unmapped"] == 3   # every finding counted exactly once
