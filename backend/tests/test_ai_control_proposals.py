"""P5 review flow — generate → accept / reject, hermetic (fake model client).

Load-bearing properties: (1) generation writes PROPOSALS only — zero
VulnerabilityControlLink rows; (2) accept is the ONE path that links, and it
records the approver; (3) reject after accept unwinds only the AI-created link;
(4) a re-run refreshes `proposed` rows but NEVER overrides a human decision;
(5) inventory findings are counted, never sent.
"""
import json
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

import re
from grc.models import (Vulnerability, ITAsset, VulnerabilityAssetLink, NormalizedControl,
                        VulnerabilityControlLink, AiControlProposal, AiControlProposalRun,
                        ParsedFrameworkControl, UploadedFramework)
from grc.services import ai_control_proposals as svc

TENANT = 1


class _Fake:
    """Scripted model: maps by title keyword → control CODES we seeded. Answers with
    the PROMPT-LOCAL id of each code (parsed from the candidate line), exactly as
    the real model must. Counts calls so tests can prove reason-once."""
    def __init__(self, table): self.t = table; self.calls = 0
    @property
    def chat(self):
        outer = self
        class _C:
            class completions:
                @staticmethod
                def create(**kw):
                    outer.calls += 1
                    user = kw["messages"][1]["content"]
                    def local_id(code):
                        m = re.search(r"^\s*(\d+) \| [^|]* \| " + re.escape(code) + r" \|", user, re.M)
                        return int(m.group(1)) if m else None
                    for key, codes in outer.t.items():
                        if key in user:
                            ids = [local_id(c) for c in codes]
                            payload = {"suggestions": [{"control_id": i, "confidence": "high",
                                                        "reason": f"addresses {key}", "driven_by": "cwe"}
                                                       for i in ids if i is not None]}
                            break
                    else:
                        payload = {"suggestions": [], "no_specific_control_reason": "informational"}
                    class _R:
                        choices = [type("m", (), {"message": type("x", (), {"content": json.dumps(payload)})()})()]
                    return _R()
        return _C()


@pytest.fixture
def db():
    e = create_engine("sqlite://")
    for m in (Vulnerability, ITAsset, VulnerabilityAssetLink, NormalizedControl,
              VulnerabilityControlLink, AiControlProposal, AiControlProposalRun,
              UploadedFramework, ParsedFrameworkControl):
        m.__table__.create(e)
    s = sessionmaker(bind=e)()
    s.add(ITAsset(id=1, tenant_id=TENANT, name="DESKTOP-CE3EFJB", host_name="DESKTOP-CE3EFJB",
                  asset_type="infrastructure", status="active"))
    s.add_all([
        Vulnerability(id=10, tenant_id=TENANT, vuln_id="NS-A", title="TLS Version 1.1 Protocol Detection",
                      severity="info", status="open", cwe_id="CWE-327"),
        Vulnerability(id=11, tenant_id=TENANT, vuln_id="NS-B", title="OS Identification",     # inventory
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
    s.commit()
    yield s
    s.close()


FAKE = _Fake({"TLS Version 1.1": ["ULV2-00906"]})


def test_generate_writes_proposals_only_never_links(db):
    r = svc.generate_proposals(db, TENANT, client=FAKE, model="fake")
    db.commit()
    assert r["findings_total"] == 2 and r["findings_inventory"] == 1 and r["findings_sent"] == 1
    assert r["proposals_created"] == 1 and r["model_errors"] == 0
    assert db.query(AiControlProposal).count() == 1
    assert db.query(VulnerabilityControlLink).count() == 0            # THE property: no links
    p = db.query(AiControlProposal).one()
    assert p.status == "proposed" and p.normalized_control_id == 7370 and p.prompt_inputs and p.raw_output


def test_accept_is_the_only_path_that_links_and_records_approver(db):
    svc.generate_proposals(db, TENANT, client=FAKE, model="fake"); db.commit()
    p = db.query(AiControlProposal).one()
    out = svc.accept_proposal(db, TENANT, p.id, user_id=42, note="looks right"); db.commit()
    assert out["status"] == "accepted" and out["created"] is True
    link = db.query(VulnerabilityControlLink).one()
    assert link.vulnerability_id == 10 and link.normalized_control_id == 7370
    assert link.created_by == 42 and (link.notes or "").startswith("ai_suggested:")
    db.refresh(p)
    assert p.status == "accepted" and p.decided_by == 42 and p.control_link_id == link.id
    # idempotent
    again = svc.accept_proposal(db, TENANT, p.id, user_id=42); db.commit()
    assert again["created"] is False and db.query(VulnerabilityControlLink).count() == 1


def test_reject_after_accept_unwinds_only_the_ai_link(db):
    svc.generate_proposals(db, TENANT, client=FAKE, model="fake"); db.commit()
    p = db.query(AiControlProposal).one()
    svc.accept_proposal(db, TENANT, p.id, user_id=42); db.commit()
    # a HUMAN-made link on the same finding must survive a reject
    db.add(VulnerabilityControlLink(vulnerability_id=10, normalized_control_id=7660, notes="manual", created_by=7)); db.commit()
    out = svc.reject_proposal(db, TENANT, p.id, user_id=42, note="not applicable"); db.commit()
    assert out["status"] == "rejected" and out["unlinked"] is True
    remaining = db.query(VulnerabilityControlLink).all()
    assert len(remaining) == 1 and remaining[0].notes == "manual"        # human link intact
    db.refresh(p)
    assert p.status == "rejected" and p.control_link_id is None


def test_rerun_refreshes_proposed_but_never_overrides_a_human_decision(db):
    svc.generate_proposals(db, TENANT, client=FAKE, model="fake"); db.commit()
    p = db.query(AiControlProposal).one()
    svc.reject_proposal(db, TENANT, p.id, user_id=42); db.commit()
    r2 = svc.generate_proposals(db, TENANT, client=FAKE, model="fake"); db.commit()
    assert r2["proposals_created"] == 0 and r2["proposals_updated"] == 0     # rejected row untouched
    db.refresh(p)
    assert p.status == "rejected"                                            # decision stands
    assert db.query(AiControlProposal).count() == 1                          # no duplicate


def test_scope_filter_and_empty_scope(db):
    r = svc.generate_proposals(db, TENANT, vulnerability_ids=[11], client=FAKE, model="fake"); db.commit()
    assert r["findings_total"] == 1 and r["findings_inventory"] == 1 and r["findings_sent"] == 0
    r0 = svc.generate_proposals(db, TENANT, vulnerability_ids=[], client=FAKE, model="fake"); db.commit()
    assert r0["findings_total"] == 0


def test_list_proposals_shape(db):
    svc.generate_proposals(db, TENANT, client=FAKE, model="fake"); db.commit()
    items = svc.list_proposals(db, TENANT)
    assert len(items) == 1
    it = items[0]
    assert it["control"]["code"] == "ULV2-00906" and it["vulnerability"]["vuln_id"] == "NS-A"
    assert it["status"] == "proposed" and it["confidence"] == "high"


# ── reason once, apply many ──────────────────────────────────────────────────

def test_human_accept_on_a_cwe_is_reused_for_later_findings_without_a_model_call(db):
    fake = _Fake({"TLS Version 1.1": ["ULV2-00906"]})
    svc.generate_proposals(db, TENANT, client=fake, model="fake"); db.commit()
    p = db.query(AiControlProposal).one()
    svc.accept_proposal(db, TENANT, p.id, user_id=42); db.commit()
    calls_before = fake.calls
    # a NEW finding arrives with the SAME weakness key (CWE-327)
    db.add(Vulnerability(id=12, tenant_id=TENANT, vuln_id="NS-C", title="TLS Version 1.0 Protocol Detection",
                         severity="info", status="open", cwe_id="CWE-327"))
    db.add(VulnerabilityAssetLink(vulnerability_id=12, asset_id=1)); db.commit()
    r = svc.generate_proposals(db, TENANT, vulnerability_ids=[12], client=fake, model="fake"); db.commit()
    assert fake.calls == calls_before, "a human-decided CWE must NOT be re-asked to the model"
    assert r["findings_reused"] == 1 and r["proposals_reused"] == 1 and r["findings_sent"] == 0
    q = db.query(AiControlProposal).filter(AiControlProposal.vulnerability_id == 12).one()
    assert q.status == "accepted" and q.provenance == "reused" and q.decided_by == 42   # the ORIGINAL approver
    link = db.query(VulnerabilityControlLink).filter(VulnerabilityControlLink.vulnerability_id == 12).one()
    assert link.normalized_control_id == 7370 and (link.notes or "").startswith("ai_reused:")
    assert q.control_link_id == link.id


def test_human_reject_on_a_cwe_is_never_reproposed_for_later_findings(db):
    fake = _Fake({"TLS Version 1.1": ["ULV2-00906"]})
    svc.generate_proposals(db, TENANT, client=fake, model="fake"); db.commit()
    p = db.query(AiControlProposal).one()
    svc.reject_proposal(db, TENANT, p.id, user_id=42); db.commit()
    db.add(Vulnerability(id=12, tenant_id=TENANT, vuln_id="NS-C", title="TLS Version 1.1 Protocol Detection (again)",
                         severity="info", status="open", cwe_id="CWE-327"))
    db.add(VulnerabilityAssetLink(vulnerability_id=12, asset_id=1)); db.commit()
    calls_before = fake.calls
    r = svc.generate_proposals(db, TENANT, vulnerability_ids=[12], client=fake, model="fake"); db.commit()
    assert fake.calls == calls_before and r["findings_sent"] == 0       # decided key → no model call
    assert db.query(AiControlProposal).filter(AiControlProposal.vulnerability_id == 12).count() == 0
    assert db.query(VulnerabilityControlLink).filter(VulnerabilityControlLink.vulnerability_id == 12).count() == 0


def test_reject_a_reused_proposal_unwinds_its_link(db):
    fake = _Fake({"TLS Version 1.1": ["ULV2-00906"]})
    svc.generate_proposals(db, TENANT, client=fake, model="fake"); db.commit()
    p = db.query(AiControlProposal).one()
    svc.accept_proposal(db, TENANT, p.id, user_id=42); db.commit()
    db.add(Vulnerability(id=12, tenant_id=TENANT, vuln_id="NS-C", title="TLS Version 1.0 Protocol Detection",
                         severity="info", status="open", cwe_id="CWE-327"))
    db.add(VulnerabilityAssetLink(vulnerability_id=12, asset_id=1)); db.commit()
    svc.generate_proposals(db, TENANT, vulnerability_ids=[12], client=fake, model="fake"); db.commit()
    q = db.query(AiControlProposal).filter(AiControlProposal.vulnerability_id == 12).one()
    out = svc.reject_proposal(db, TENANT, q.id, user_id=43, note="not on this box"); db.commit()
    assert out["unlinked"] is True
    assert db.query(VulnerabilityControlLink).filter(VulnerabilityControlLink.vulnerability_id == 12).count() == 0
