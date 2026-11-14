"""Guard: a finding with a severity but NO numeric CVSS must still raise the
effective-risk score (the pentest/scanner finding shape). Before the fix,
cvss_score=None scored 0.0, so scanner findings showed on the Vulnerabilities
subpage but never lifted the asset risk score."""
from grc.modules.risk_posture.service import _SEVERITY_CVSS_FLOOR
from grc.modules.risk_posture.effective_risk import RiskInputs, compute_effective_risk


def test_severity_floor_lifts_score_without_cvss():
    # High-severity finding, no CVSS/EPSS/KEV, no asset signals.
    floor = _SEVERITY_CVSS_FLOOR["high"]
    assert floor and floor > 0
    out = compute_effective_risk(RiskInputs(cvss_score=floor))
    assert out.score > 0.0, "severity-only high finding must contribute to risk"


def test_info_floor_stays_zero():
    out = compute_effective_risk(RiskInputs(cvss_score=_SEVERITY_CVSS_FLOOR["info"]))
    assert out.score == 0.0


def test_critical_outranks_medium():
    crit = compute_effective_risk(RiskInputs(cvss_score=_SEVERITY_CVSS_FLOOR["critical"])).score
    med = compute_effective_risk(RiskInputs(cvss_score=_SEVERITY_CVSS_FLOOR["medium"])).score
    assert crit > med > 0.0
