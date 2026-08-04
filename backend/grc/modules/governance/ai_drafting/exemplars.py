"""Few-shot exemplar bank for AI drafting.

Provides short tone/depth anchors the LLM sees during Stage B section
expansion. Snippets are intentionally short (<200 words each) so they
don't crowd out the citation slice in the prompt, and they're generic
enough to apply across tenants — no organisation-specific identifiers
inside them.

Each exemplar is keyed by topic so the pipeline can hand the section
the most relevant tone reference.
"""
from __future__ import annotations

from typing import Dict, Optional


# A bank-grade tone reference per topic. Each is a redacted, anonymised
# fragment in the voice the pipeline expects the LLM to match.
EXEMPLARS: Dict[str, str] = {
    "access_control": (
        "4.3.1 All user access to information systems shall be granted on the "
        "principle of least privilege and segregation of duties, in line with "
        "the role-based access control matrix maintained by the Information "
        "Security Function [ISO/IEC 27001:2022, clause A.5.15]. "
        "4.3.2 User access requests shall be raised by the line manager via the "
        "approved identity workflow and shall be authorised by both the data "
        "owner and the Information Security Function before provisioning. "
        "4.3.3 Privileged accounts shall be issued only to named personnel, "
        "logged in real time to the security event monitoring system, and "
        "reviewed by Internal Audit on a quarterly cadence [PCI DSS v4.0, "
        "clause 7.2.5]. "
        "4.3.4 Access rights shall be reviewed by the asset owner at least "
        "every ninety (90) days, and on every joiner-mover-leaver event, with "
        "evidence retained for two (2) years."
    ),
    "password_policy": (
        "4.7.1 All authentication credentials shall meet the minimum complexity "
        "standard set by the Information Security Function. Passwords shall be "
        "no fewer than the configured minimum length, contain at least one "
        "character from each of the upper-case, lower-case, numeric, and "
        "special-character classes, and shall not match the user's identifier "
        "or any of the last N passwords [PCI DSS v4.0, clause 8.3.6]. "
        "4.7.2 Failed authentication attempts shall be subject to account "
        "lockout after the configured threshold. Locked accounts shall remain "
        "locked for the configured duration or until reset by the service desk "
        "following identity verification. "
        "4.7.3 Inactive interactive sessions shall be terminated after the "
        "configured idle-timeout period. Authentication credentials shall be "
        "rotated at the configured rotation cadence at minimum, and "
        "immediately upon suspected compromise."
    ),
    "incident_management": (
        "4.12.1 Information security incidents shall be reported to the "
        "Information Security Function within one (1) hour of detection, "
        "regardless of source, using the channels published in the Incident "
        "Reporting Procedure. "
        "4.12.2 Incidents shall be classified on first response according to "
        "the published severity matrix. Severity 1 and Severity 2 incidents "
        "shall be escalated to the Chief Information Security Officer and the "
        "Crisis Management Team within thirty (30) minutes of classification. "
        "4.12.3 A post-incident review shall be conducted within fifteen (15) "
        "working days of incident closure for all Severity 1 and Severity 2 "
        "incidents. Findings and remediation actions shall be tabled at the "
        "next Information Security Steering Committee meeting and tracked to "
        "closure in the corrective action register."
    ),
    "third_party_management": (
        "4.18.1 Engagements with third parties that process, store, or "
        "transmit information assets shall undergo a security risk assessment "
        "performed by the Information Security Function prior to contract "
        "signature, with findings approved by the Procurement Committee. "
        "4.18.2 Contracts with third parties shall include the right to audit, "
        "obligations on incident notification within twenty-four (24) hours, "
        "data return and destruction clauses on termination, and adherence to "
        "the organisation's information security policies. "
        "4.18.3 Third-party security posture shall be reassessed annually, or "
        "more frequently for parties handling assets classified Confidential "
        "or above, with reassessment evidence retained in the third-party "
        "register."
    ),
    "data_protection": (
        "4.21.1 Information assets shall be classified by the asset owner in "
        "accordance with the Information Classification Standard on creation "
        "and reclassified on every material change in business sensitivity. "
        "4.21.2 Assets classified Confidential and above shall be encrypted at "
        "rest using an approved cipher and in transit using TLS 1.2 or higher, "
        "with key management performed by the Information Security Function "
        "and rotation in line with the Cryptographic Standard. "
        "4.21.3 Retention periods for information assets shall be defined in "
        "the Records Retention Schedule. Assets shall be securely disposed of "
        "at the end of retention using the methods set out in the Media "
        "Disposal Procedure, with evidence of disposal retained for five (5) "
        "years."
    ),
    "governance_oversight": (
        "5.1 The Information Security Steering Committee, chaired by the Chief "
        "Information Security Officer and meeting on a monthly cadence, shall "
        "be accountable for the operational stewardship of this policy. The "
        "Committee shall review compliance metrics, exception register, open "
        "remediation items, and material risks at each meeting, escalating "
        "items requiring Board-level attention to the Risk Management "
        "Committee. "
        "5.2 The Risk Management Committee, meeting on a quarterly cadence, "
        "shall be accountable for endorsing material amendments to this "
        "policy, approving exceptions whose residual risk exceeds the "
        "tolerance set in the Risk Appetite Statement, and tabling unresolved "
        "issues to the Board Risk Committee."
    ),
}


def get_exemplar(topic: Optional[str]) -> Optional[str]:
    """Return the exemplar snippet for `topic`, or a governance default."""
    if not topic:
        return EXEMPLARS.get("governance_oversight")
    return EXEMPLARS.get(topic) or EXEMPLARS.get("governance_oversight")
