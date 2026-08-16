"""CTEM command center — the per-scope aggregator, hermetic.

The load-bearing property is SCOPE ISOLATION: every one of the four cards must
count only this scope's findings. So each fixture plants a matching in-scope row
AND an out-of-scope twin, and asserts the twin is excluded — the identity-map
lesson applied to a cross-module rollup. The money card is asserted to be the
PORTFOLIO run (risks aren't scope-linked), not a faked per-scope figure.
"""
import pytest
from datetime import datetime
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from grc.models import (
    ITAsset, Vulnerability, VulnerabilityAssetLink, ReachabilitySnapshot,
    VulnerabilityControlLink, ControlEffectivenessEvidence, VulnTicketLink,
    RiskSimulationRun, ParsedFrameworkControl, UploadedFramework, Risk,
)
from grc.services import ctem_scopes as svc
from grc.services.choke_points import coverage

TENANT = 1
NET = "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H"


class _Scope:
    """command_center only reads .membership_rule — no need to persist a row."""
    membership_rule = {"departments": ["Payments"]}


@pytest.fixture
def db():
    engine = create_engine("sqlite://")
    for m in (ITAsset, Vulnerability, VulnerabilityAssetLink, ReachabilitySnapshot,
              VulnerabilityControlLink, ControlEffectivenessEvidence, VulnTicketLink,
              RiskSimulationRun, UploadedFramework, ParsedFrameworkControl, Risk):
        m.__table__.create(engine)
    s = sessionmaker(bind=engine)()
    _seed(s)
    yield s
    s.close()


_sid = [0]
def _snap(db, vuln, asset, verdict):
    _sid[0] += 1
    db.add(ReachabilitySnapshot(id=_sid[0], tenant_id=TENANT, vulnerability_id=vuln,
                                asset_id=asset, verdict=verdict, content_hash=f"h{_sid[0]}"))


def _seed(db):
    _sid[0] = 0
    # asset 1 in scope (Payments), asset 2 out (HR)
    db.add_all([
        ITAsset(id=1, tenant_id=TENANT, name="pay-1", host_name="pay-1",
                department="Payments", asset_type="server", status="active"),
        ITAsset(id=2, tenant_id=TENANT, name="hr-1", host_name="hr-1",
                department="HR", asset_type="server", status="active"),
    ])
    # in-scope findings on asset 1: 10 viable, 11 undeterminable, 12 chainless
    db.add_all([
        Vulnerability(id=10, tenant_id=TENANT, vuln_id="V-10", title="viable",
                      severity="high", status="open", cwe_id="CWE-89", cvss_vector=NET),
        Vulnerability(id=11, tenant_id=TENANT, vuln_id="V-11", title="undet",
                      severity="info", status="open", cwe_id=None, cvss_vector=None),
        Vulnerability(id=12, tenant_id=TENANT, vuln_id="V-12", title="nochain",
                      severity="low", status="open", cwe_id="CWE-79", cvss_vector=NET),
        # out-of-scope twin on asset 2 — viable, but must never be counted
        Vulnerability(id=20, tenant_id=TENANT, vuln_id="V-20", title="out",
                      severity="high", status="open", cwe_id="CWE-89", cvss_vector=NET),
    ])
    db.add_all([
        VulnerabilityAssetLink(vulnerability_id=10, asset_id=1),
        VulnerabilityAssetLink(vulnerability_id=11, asset_id=1),
        VulnerabilityAssetLink(vulnerability_id=12, asset_id=1),
        VulnerabilityAssetLink(vulnerability_id=20, asset_id=2),
    ])
    _snap(db, 10, 1, "possible")   # viable → ranked
    _snap(db, 11, 1, "unlikely")   # unviable, no basis → undeterminable
    _snap(db, 20, 2, "possible")   # out of scope viable → excluded
    # validate: control linked to in-scope vuln 10, with a genuine passing test
    db.add(VulnerabilityControlLink(vulnerability_id=10, framework_control_id=5))
    db.add(VulnerabilityControlLink(vulnerability_id=20, framework_control_id=9))  # out
    # …and a NAMED parsed-framework control (the path the CWE crosswalk writes),
    # covering BOTH in-scope findings 10 and 11 — asserted listed with its
    # framework name + findings_covered=2, and only-claimed (no evidence).
    db.add(UploadedFramework(id=1, tenant_id=TENANT, name="ISO/IEC 27001:2022",
                             file_name="iso.pdf", file_path="/x/iso.pdf", file_type="pdf",
                             uploaded_by=1))
    db.add(ParsedFrameworkControl(id=1010, uploaded_framework_id=1, control_id="A.8.8",
                                  title="Management of Technical Vulnerabilities"))
    db.add(VulnerabilityControlLink(vulnerability_id=10, parsed_framework_control_id=1010))
    db.add(VulnerabilityControlLink(vulnerability_id=11, parsed_framework_control_id=1010))
    now = datetime.utcnow()
    db.add(ControlEffectivenessEvidence(
        tenant_id=TENANT, framework_control_id=5, vulnerability_id=10,
        source_type="retest", result="pass", tested_at=now))
    db.add(ControlEffectivenessEvidence(   # out-of-scope control evidence
        tenant_id=TENANT, framework_control_id=9, vulnerability_id=20,
        source_type="retest", result="pass", tested_at=now))
    # mobilise: a live ticket on in-scope vuln 10, and one on out-of-scope vuln 20
    db.add(VulnTicketLink(tenant_id=TENANT, vulnerability_id=10, connection_id=1,
                          external_ticket_id="INC1", resolved_at=None))
    db.add(VulnTicketLink(tenant_id=TENANT, vulnerability_id=20, connection_id=1,
                          external_ticket_id="INC2", resolved_at=None))  # out
    # quantify: a completed portfolio run
    db.add(RiskSimulationRun(tenant_id=TENANT, scope="portfolio", status="completed",
                             trigger="manual", iterations=100, seed=1, engine_version="test",
                             ale_mean=1_200_000.0, p95=4_800_000.0, currency="USD"))
    db.commit()


def test_command_center_is_scope_isolated(db):
    cc = svc.command_center(db, TENANT, _Scope())

    # scope resolves to asset 1 → its 3 findings only (the HR twin excluded)
    assert cc["member_assets"] == 1
    assert cc["scope_findings"] == 3

    pcov = cc["prioritise"]["coverage"]
    assert pcov["total_findings"] == 3
    assert pcov["findings_ranked"] == 1            # only vuln 10 viable in scope
    assert pcov["findings_chainless"] == 1         # vuln 12 (no snapshot)
    assert pcov["findings_undeterminable"] == 1    # vuln 11 (no CWE/vector)
    assert pcov["findings_severed"] == 0
    assert cc["prioritise"]["top"] == [{"vulnerability_id": 10, "chain_count": 1}]

    # validate: the in-scope controls (framework_control 5 + parsed 1010; the
    # out-of-scope 9 excluded). The genuine pass on 5 = effective; 1010 has no
    # evidence = only claimed. And the parsed one is LISTED with its real
    # framework name + how many scope findings it covers (10 and 11 → 2).
    assert cc["validate"]["controls"] == 2
    assert cc["validate"]["tiers"].get("tested_effective") == 1
    assert cc["validate"]["tiers"].get("attested_only") == 1
    listed = {i["code"]: i for i in cc["validate"]["items"]}
    assert listed["A.8.8"]["framework"] == "ISO/IEC 27001:2022"
    assert listed["A.8.8"]["title"] == "Management of Technical Vulnerabilities"
    assert listed["A.8.8"]["findings_covered"] == 2
    assert listed["A.8.8"]["tier"] == "attested_only"
    assert cc["validate"]["by_framework"]["ISO/IEC 27001:2022"] == 1

    # mobilise: only the in-scope ticket
    assert cc["mobilise"] == {"tickets": 1, "open": 1, "resolved": 0, "plans_applied": 0}

    # quantify: the portfolio run, labelled portfolio — NOT a faked scope figure.
    # No Risk rows seeded → not demo-only (there is simply nothing to flag).
    assert cc["quantify"]["scope"] == "portfolio"
    assert cc["quantify"]["ale"] == 1_200_000.0
    assert cc["quantify"]["p95"] == 4_800_000.0
    assert cc["quantify"]["demo_only"] is False


def test_quantify_flags_demo_only_inputs(db):
    """HARD RULE: a simulation whose inputs are ALL [DEMO] risks must be flagged
    demo_only so the UI never shows its dollar figure as the user's real cost."""
    db.add_all([
        Risk(tenant_id=TENANT, title="[DEMO] Ransomware attack on core systems", category="technology"),
        Risk(tenant_id=TENANT, title="[DEMO] Cloud provider outage", category="technology"),
    ])
    db.commit()
    q = svc.command_center(db, TENANT, _Scope())["quantify"]
    assert q["risks_total"] == 2 and q["risks_demo"] == 2
    assert q["demo_only"] is True
    # one REAL risk alongside the demos → no longer demo-only
    db.add(Risk(tenant_id=TENANT, title="Unpatched PostgreSQL on payment host", category="technology"))
    db.commit()
    assert svc.command_center(db, TENANT, _Scope())["quantify"]["demo_only"] is False


def test_coverage_scope_filter_vs_tenant_wide(db):
    # tenant-wide sees all 4 findings and both viable ones (10 and 20)…
    whole = coverage(db, TENANT)
    assert whole["total_findings"] == 4
    assert whole["findings_ranked"] == 2
    # …scoped to asset 1's findings, only vuln 10 is ranked.
    scoped = coverage(db, TENANT, vulnerability_ids=[10, 11, 12])
    assert scoped["total_findings"] == 3
    assert scoped["findings_ranked"] == 1
    # empty scope is a real "no findings", never silently the whole tenant
    assert coverage(db, TENANT, vulnerability_ids=[])["total_findings"] == 0


def test_portfolio_shape_matches_design_contract(db):
    """The redesign's Scope[] contract, one call for all scopes. Built from the
    same services; fields with no real source (per-scope FAIR, owner) are NULL,
    never invented."""
    from grc.models import CtemScope, CtemCycle
    CtemScope.__table__.create(db.get_bind()); CtemCycle.__table__.create(db.get_bind())
    sc = CtemScope(id=1, tenant_id=TENANT, name="Payments", cadence="quarterly",
                   membership_rule={"departments": ["Payments"]})
    db.add(sc); db.commit()
    db.add(CtemCycle(id=1, tenant_id=TENANT, scope_id=1, status="open")); db.commit()
    p = svc.portfolio(db, TENANT)
    assert len(p["scopes"]) == 1
    s = p["scopes"][0]
    # direct maps
    assert s["name"] == "Payments" and s["membership"] == "dept in Payments"
    assert s["assets"] == 1 and s["findings"] == 3 and s["dangerous"] == 1
    assert s["buckets"] == {"ranked": 1, "undeterminable": 1, "chainless": 1, "severed": 0}
    assert s["controls"] == 2 and s["tested"] == 1 and s["claimed"] == 1
    assert s["fixes"] == 1 and s["fixesOpen"] == 1
    assert s["cycleOpen"] is True and s["cycleNo"] == 1 and s["cycleId"] == 1
    # crosswalk rows carry the REAL framework name; top[] is the ranked finding
    assert any(c["fw"] == "ISO/IEC 27001:2022" and c["code"] == "A.8.8" for c in s["cw"])
    assert s["top"][0]["id"] == 10 and s["top"][0]["breaks"] == "1 path"
    # honest nulls — no real source
    assert s["owner"] is None and s["ale"] is None and s["p95"] is None
    # trend: no closed cycles yet → just the live point (real, short)
    assert s["tFind"] == [3] and s["tDang"] == [1] and s["prevFind"] is None
