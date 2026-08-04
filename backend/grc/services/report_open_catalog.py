"""Open-ended report linkages — any module's columns on any report.

The UI catalogs every other dataset's fields as ``xmod_<dataset>__<field>``.
Enrichment resolves related entity IDs via known join edges, then projects the
requested fields (semicolon-joined for 1:N). Modules without a join edge still
appear in the catalog; their cells are left empty / zero-filled.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime
from typing import Any, Callable, Dict, List, Optional, Set, Tuple

from sqlalchemy.orm import Session

from ..models import (
    AssetControlLink, AssetEvidenceLink, BcmDrill, BcmPlan, CertificationJourney,
    CriticalTask, DiscoveryCampaign, DocumentAssetLink, DocumentControlLink,
    DocumentRiskLink, Evidence, EvidenceControlMapping, EvidenceIncidentLink,
    Framework, FrameworkControl, GovernanceCommittee, GovernanceDocument,
    IncidentAssetLink, IncidentRiskLink, IncidentVulnerabilityLink,
    InfoSystemCriticalityItem, InfraAssetCriticalityItem,
    ISProject, Issue, IssueAssetLink, IssueControlLink, IssueEvidenceLink,
    IssueRiskLink, IssueVendorLink, IssueVulnerabilityLink, ITAsset,
    NormalizedControl, PolicyException, RegulatoryChange, Risk, RiskAssetLink,
    RiskControlLink, RiskEvidenceLink, RiskFrameworkControlLink, RiskIncident,
    RiskKRI, Vendor, Vulnerability, VulnerabilityAssetLink, VulnerabilityControlLink,
)
# Expanded reporting datasets (Wave 2) — entities + their junctions/FKs to the hubs.
from ..models import (
    AIRiskAssessmentEntry, AuditPackage, AuditPackageEvidence, InternalControl,
    InternalControlEvidence, InternalControlFrameworkLink, InternalControlRiskLink,
    OversightAction, PolicyStatement, RCSAFinding, RiskAssessment, RiskAssessmentRisk,
    RiskReview, VendorAssessment,
)
# Wave 4 — new edges for curated LINKAGE_CATALOG pairs that had no resolver, +
# the RCSA campaign / TPRA finding FE datasets.
from ..models import (
    BcmBiaRecord, BcmFinding, ControlImplementation, ControlObjective,
    DiscoveryObservation, DiscoveryRun, FrameworkDomain, ImplementationEvidence,
    MeetingAgendaItem, RCSACampaign, RegulatoryImplementationTask, TPRAFinding,
)
from ..models import CommitteeMeeting, ControlMapping, IssueGovernanceLink, IssueISProjectLink, RegulatoryImpactAssessment

EdgeFn = Callable[[Session, List[int]], Dict[int, List[int]]]


def _pair_map(rows: List[Tuple[Any, Any]]) -> Dict[int, List[int]]:
    out: Dict[int, List[int]] = defaultdict(list)
    for left, right in rows:
        if left is None or right is None:
            continue
        try:
            lid, rid = int(left), int(right)
        except (TypeError, ValueError):
            continue
        if rid not in out[lid]:
            out[lid].append(rid)
    return dict(out)


# ── Generic edge factories (DRY resolvers for direct-FK / junction links) ──────
def _fwd(model, fk):
    """base row → its direct FK target: base.id in ids, follow base.fk → target id."""
    def fn(db: Session, ids: List[int]) -> Dict[int, List[int]]:
        return _pair_map(db.query(model.id, fk).filter(model.id.in_(ids), fk.isnot(None)).all())
    return fn


def _rev(model, fk):
    """reverse of _fwd: target ids in ids → base rows whose fk points at them."""
    def fn(db: Session, ids: List[int]) -> Dict[int, List[int]]:
        return _pair_map(db.query(fk, model.id).filter(fk.in_(ids)).all())
    return fn


def _jn(base_col, target_col):
    """junction table: rows where base_col in ids → target_col."""
    def fn(db: Session, ids: List[int]) -> Dict[int, List[int]]:
        return _pair_map(db.query(base_col, target_col).filter(base_col.in_(ids)).all())
    return fn


# ── Edge resolvers: base dataset → target dataset → {base_id: [target_ids]} ──

def _assets_vulnerabilities(db: Session, ids: List[int]) -> Dict[int, List[int]]:
    rows = db.query(VulnerabilityAssetLink.asset_id, VulnerabilityAssetLink.vulnerability_id).filter(
        VulnerabilityAssetLink.asset_id.in_(ids)
    ).all()
    return _pair_map(rows)


def _assets_risks(db: Session, ids: List[int]) -> Dict[int, List[int]]:
    rows = db.query(RiskAssetLink.asset_id, RiskAssetLink.risk_id).filter(RiskAssetLink.asset_id.in_(ids)).all()
    return _pair_map(rows)


def _assets_controls(db: Session, ids: List[int]) -> Dict[int, List[int]]:
    rows = db.query(AssetControlLink.asset_id, AssetControlLink.normalized_control_id).filter(
        AssetControlLink.asset_id.in_(ids)
    ).all()
    return _pair_map(rows)


def _assets_evidence(db: Session, ids: List[int]) -> Dict[int, List[int]]:
    rows = db.query(AssetEvidenceLink.asset_id, AssetEvidenceLink.evidence_id).filter(
        AssetEvidenceLink.asset_id.in_(ids)
    ).all()
    return _pair_map(rows)


def _assets_issues(db: Session, ids: List[int]) -> Dict[int, List[int]]:
    rows = db.query(IssueAssetLink.asset_id, IssueAssetLink.issue_id).filter(IssueAssetLink.asset_id.in_(ids)).all()
    return _pair_map(rows)


def _assets_incidents(db: Session, ids: List[int]) -> Dict[int, List[int]]:
    rows = db.query(IncidentAssetLink.asset_id, IncidentAssetLink.incident_id).filter(
        IncidentAssetLink.asset_id.in_(ids)
    ).all()
    return _pair_map(rows)


def _risks_assets(db: Session, ids: List[int]) -> Dict[int, List[int]]:
    rows = db.query(RiskAssetLink.risk_id, RiskAssetLink.asset_id).filter(RiskAssetLink.risk_id.in_(ids)).all()
    return _pair_map(rows)


def _risks_controls(db: Session, ids: List[int]) -> Dict[int, List[int]]:
    rows = db.query(RiskControlLink.risk_id, RiskControlLink.normalized_control_id).filter(
        RiskControlLink.risk_id.in_(ids)
    ).all()
    return _pair_map(rows)


def _risks_evidence(db: Session, ids: List[int]) -> Dict[int, List[int]]:
    rows = db.query(RiskEvidenceLink.risk_id, RiskEvidenceLink.evidence_id).filter(
        RiskEvidenceLink.risk_id.in_(ids)
    ).all()
    return _pair_map(rows)


def _risks_issues(db: Session, ids: List[int]) -> Dict[int, List[int]]:
    rows = db.query(IssueRiskLink.risk_id, IssueRiskLink.issue_id).filter(IssueRiskLink.risk_id.in_(ids)).all()
    return _pair_map(rows)


def _risks_incidents(db: Session, ids: List[int]) -> Dict[int, List[int]]:
    rows = db.query(IncidentRiskLink.risk_id, IncidentRiskLink.incident_id).filter(
        IncidentRiskLink.risk_id.in_(ids)
    ).all()
    out = _pair_map(rows)
    # Also primary risk on RiskIncident
    for inc_id, risk_id in db.query(RiskIncident.id, RiskIncident.risk_id).filter(RiskIncident.risk_id.in_(ids)).all():
        if risk_id is None or inc_id is None:
            continue
        out.setdefault(int(risk_id), [])
        if int(inc_id) not in out[int(risk_id)]:
            out[int(risk_id)].append(int(inc_id))
    return out


def _risks_framework_controls(db: Session, ids: List[int]) -> Dict[int, List[int]]:
    rows = db.query(RiskFrameworkControlLink.risk_id, RiskFrameworkControlLink.framework_control_id).filter(
        RiskFrameworkControlLink.risk_id.in_(ids)
    ).all()
    return _pair_map(rows)


def _vulns_assets(db: Session, ids: List[int]) -> Dict[int, List[int]]:
    rows = db.query(VulnerabilityAssetLink.vulnerability_id, VulnerabilityAssetLink.asset_id).filter(
        VulnerabilityAssetLink.vulnerability_id.in_(ids)
    ).all()
    return _pair_map(rows)


def _vulns_controls(db: Session, ids: List[int]) -> Dict[int, List[int]]:
    rows = db.query(VulnerabilityControlLink.vulnerability_id, VulnerabilityControlLink.normalized_control_id).filter(
        VulnerabilityControlLink.vulnerability_id.in_(ids)
    ).all()
    return _pair_map(rows)


def _vulns_issues(db: Session, ids: List[int]) -> Dict[int, List[int]]:
    rows = db.query(IssueVulnerabilityLink.vulnerability_id, IssueVulnerabilityLink.issue_id).filter(
        IssueVulnerabilityLink.vulnerability_id.in_(ids)
    ).all()
    return _pair_map(rows)


def _evidence_risks(db: Session, ids: List[int]) -> Dict[int, List[int]]:
    rows = db.query(RiskEvidenceLink.evidence_id, RiskEvidenceLink.risk_id).filter(
        RiskEvidenceLink.evidence_id.in_(ids)
    ).all()
    return _pair_map(rows)


def _evidence_controls(db: Session, ids: List[int]) -> Dict[int, List[int]]:
    rows = db.query(EvidenceControlMapping.evidence_id, EvidenceControlMapping.normalized_control_id).filter(
        EvidenceControlMapping.evidence_id.in_(ids)
    ).all()
    return _pair_map(rows)


def _evidence_assets(db: Session, ids: List[int]) -> Dict[int, List[int]]:
    rows = db.query(AssetEvidenceLink.evidence_id, AssetEvidenceLink.asset_id).filter(
        AssetEvidenceLink.evidence_id.in_(ids)
    ).all()
    return _pair_map(rows)


def _evidence_incidents(db: Session, ids: List[int]) -> Dict[int, List[int]]:
    rows = db.query(EvidenceIncidentLink.evidence_id, EvidenceIncidentLink.incident_id).filter(
        EvidenceIncidentLink.evidence_id.in_(ids)
    ).all()
    return _pair_map(rows)


def _controls_risks(db: Session, ids: List[int]) -> Dict[int, List[int]]:
    rows = db.query(RiskControlLink.normalized_control_id, RiskControlLink.risk_id).filter(
        RiskControlLink.normalized_control_id.in_(ids)
    ).all()
    return _pair_map(rows)


def _controls_assets(db: Session, ids: List[int]) -> Dict[int, List[int]]:
    rows = db.query(AssetControlLink.normalized_control_id, AssetControlLink.asset_id).filter(
        AssetControlLink.normalized_control_id.in_(ids)
    ).all()
    return _pair_map(rows)


def _controls_vulns(db: Session, ids: List[int]) -> Dict[int, List[int]]:
    rows = db.query(VulnerabilityControlLink.normalized_control_id, VulnerabilityControlLink.vulnerability_id).filter(
        VulnerabilityControlLink.normalized_control_id.in_(ids)
    ).all()
    return _pair_map(rows)


def _controls_evidence(db: Session, ids: List[int]) -> Dict[int, List[int]]:
    rows = db.query(EvidenceControlMapping.normalized_control_id, EvidenceControlMapping.evidence_id).filter(
        EvidenceControlMapping.normalized_control_id.in_(ids)
    ).all()
    return _pair_map(rows)


def _issues_vulns(db: Session, ids: List[int]) -> Dict[int, List[int]]:
    rows = db.query(IssueVulnerabilityLink.issue_id, IssueVulnerabilityLink.vulnerability_id).filter(
        IssueVulnerabilityLink.issue_id.in_(ids)
    ).all()
    return _pair_map(rows)


def _issues_risks(db: Session, ids: List[int]) -> Dict[int, List[int]]:
    rows = db.query(IssueRiskLink.issue_id, IssueRiskLink.risk_id).filter(IssueRiskLink.issue_id.in_(ids)).all()
    return _pair_map(rows)


def _issues_assets(db: Session, ids: List[int]) -> Dict[int, List[int]]:
    rows = db.query(IssueAssetLink.issue_id, IssueAssetLink.asset_id).filter(IssueAssetLink.issue_id.in_(ids)).all()
    return _pair_map(rows)


def _issues_controls(db: Session, ids: List[int]) -> Dict[int, List[int]]:
    rows = db.query(IssueControlLink.issue_id, IssueControlLink.normalized_control_id).filter(
        IssueControlLink.issue_id.in_(ids),
        IssueControlLink.normalized_control_id.isnot(None),
    ).all()
    return _pair_map(rows)


def _issues_evidence(db: Session, ids: List[int]) -> Dict[int, List[int]]:
    rows = db.query(IssueEvidenceLink.issue_id, IssueEvidenceLink.evidence_id).filter(
        IssueEvidenceLink.issue_id.in_(ids)
    ).all()
    return _pair_map(rows)


def _issues_vendors(db: Session, ids: List[int]) -> Dict[int, List[int]]:
    rows = db.query(IssueVendorLink.issue_id, IssueVendorLink.vendor_id).filter(IssueVendorLink.issue_id.in_(ids)).all()
    return _pair_map(rows)


def _vendors_issues(db: Session, ids: List[int]) -> Dict[int, List[int]]:
    rows = db.query(IssueVendorLink.vendor_id, IssueVendorLink.issue_id).filter(IssueVendorLink.vendor_id.in_(ids)).all()
    return _pair_map(rows)


def _vendors_risks(db: Session, ids: List[int]) -> Dict[int, List[int]]:
    rows = (
        db.query(IssueVendorLink.vendor_id, IssueRiskLink.risk_id)
        .join(IssueRiskLink, IssueRiskLink.issue_id == IssueVendorLink.issue_id)
        .filter(IssueVendorLink.vendor_id.in_(ids))
        .all()
    )
    return _pair_map(rows)


def _gov_docs_risks(db: Session, ids: List[int]) -> Dict[int, List[int]]:
    rows = db.query(DocumentRiskLink.document_id, DocumentRiskLink.risk_id).filter(
        DocumentRiskLink.document_id.in_(ids)
    ).all()
    return _pair_map(rows)


def _gov_docs_controls(db: Session, ids: List[int]) -> Dict[int, List[int]]:
    rows = db.query(DocumentControlLink.document_id, DocumentControlLink.normalized_control_id).filter(
        DocumentControlLink.document_id.in_(ids)
    ).all()
    return _pair_map(rows)


def _gov_docs_assets(db: Session, ids: List[int]) -> Dict[int, List[int]]:
    rows = db.query(DocumentAssetLink.document_id, DocumentAssetLink.asset_id).filter(
        DocumentAssetLink.document_id.in_(ids)
    ).all()
    return _pair_map(rows)


def _incidents_risks(db: Session, ids: List[int]) -> Dict[int, List[int]]:
    rows = db.query(IncidentRiskLink.incident_id, IncidentRiskLink.risk_id).filter(
        IncidentRiskLink.incident_id.in_(ids)
    ).all()
    out = _pair_map(rows)
    for inc_id, risk_id in db.query(RiskIncident.id, RiskIncident.risk_id).filter(RiskIncident.id.in_(ids)).all():
        if risk_id is None:
            continue
        out.setdefault(int(inc_id), [])
        if int(risk_id) not in out[int(inc_id)]:
            out[int(inc_id)].append(int(risk_id))
    return out


def _incidents_assets(db: Session, ids: List[int]) -> Dict[int, List[int]]:
    rows = db.query(IncidentAssetLink.incident_id, IncidentAssetLink.asset_id).filter(
        IncidentAssetLink.incident_id.in_(ids)
    ).all()
    return _pair_map(rows)


def _incidents_vulns(db: Session, ids: List[int]) -> Dict[int, List[int]]:
    rows = db.query(IncidentVulnerabilityLink.incident_id, IncidentVulnerabilityLink.vulnerability_id).filter(
        IncidentVulnerabilityLink.incident_id.in_(ids)
    ).all()
    return _pair_map(rows)


def _incidents_evidence(db: Session, ids: List[int]) -> Dict[int, List[int]]:
    rows = db.query(EvidenceIncidentLink.incident_id, EvidenceIncidentLink.evidence_id).filter(
        EvidenceIncidentLink.incident_id.in_(ids)
    ).all()
    return _pair_map(rows)


def _tasks_risks(db: Session, ids: List[int]) -> Dict[int, List[int]]:
    rows = db.query(CriticalTask.id, CriticalTask.linked_risk_id).filter(
        CriticalTask.id.in_(ids), CriticalTask.linked_risk_id.isnot(None)
    ).all()
    return _pair_map(rows)


def _tasks_issues(db: Session, ids: List[int]) -> Dict[int, List[int]]:
    rows = db.query(CriticalTask.id, CriticalTask.linked_issue_id).filter(
        CriticalTask.id.in_(ids), CriticalTask.linked_issue_id.isnot(None)
    ).all()
    return _pair_map(rows)


def _tasks_vulns(db: Session, ids: List[int]) -> Dict[int, List[int]]:
    rows = db.query(CriticalTask.id, CriticalTask.linked_vulnerability_id).filter(
        CriticalTask.id.in_(ids), CriticalTask.linked_vulnerability_id.isnot(None)
    ).all()
    return _pair_map(rows)


def _tasks_assets(db: Session, ids: List[int]) -> Dict[int, List[int]]:
    out: Dict[int, List[int]] = {}
    for t in db.query(CriticalTask).filter(CriticalTask.id.in_(ids)).all():
        if not t.source_entity_id:
            continue
        stype = str(t.source_entity_type or "").lower().replace(" ", "_")
        if stype not in {"asset", "it_asset", "itasset"}:
            continue
        out.setdefault(int(t.id), [])
        aid = int(t.source_entity_id)
        if aid not in out[int(t.id)]:
            out[int(t.id)].append(aid)
    return out


def _kris_risks(db: Session, ids: List[int]) -> Dict[int, List[int]]:
    rows = db.query(RiskKRI.id, RiskKRI.risk_id).filter(RiskKRI.id.in_(ids), RiskKRI.risk_id.isnot(None)).all()
    return _pair_map(rows)


def _is_projects_risks(db: Session, ids: List[int]) -> Dict[int, List[int]]:
    out: Dict[int, List[int]] = {}
    for p in db.query(ISProject).filter(ISProject.id.in_(ids)).all():
        for rid in (p.linked_risks or []):
            try:
                out.setdefault(int(p.id), []).append(int(rid))
            except (TypeError, ValueError):
                continue
    return out


def _is_projects_controls(db: Session, ids: List[int]) -> Dict[int, List[int]]:
    out: Dict[int, List[int]] = {}
    for p in db.query(ISProject).filter(ISProject.id.in_(ids)).all():
        for cid in (p.linked_controls or []):
            try:
                out.setdefault(int(p.id), []).append(int(cid))
            except (TypeError, ValueError):
                continue
    return out


def _criticality_info_assets(db: Session, ids: List[int]) -> Dict[int, List[int]]:
    rows = db.query(InfoSystemCriticalityItem.id, InfoSystemCriticalityItem.linked_asset_id).filter(
        InfoSystemCriticalityItem.id.in_(ids),
        InfoSystemCriticalityItem.linked_asset_id.isnot(None),
    ).all()
    return _pair_map(rows)


def _criticality_infra_assets(db: Session, ids: List[int]) -> Dict[int, List[int]]:
    rows = db.query(InfraAssetCriticalityItem.id, InfraAssetCriticalityItem.linked_asset_id).filter(
        InfraAssetCriticalityItem.id.in_(ids),
        InfraAssetCriticalityItem.linked_asset_id.isnot(None),
    ).all()
    return _pair_map(rows)


def _vulns_risks(db: Session, ids: List[int]) -> Dict[int, List[int]]:
    """No direct FK — risks reach a vulnerability only through the issue that
    links both (mirrors report_linkages._enrich_vulnerabilities's "risks")."""
    rows = (
        db.query(IssueVulnerabilityLink.vulnerability_id, IssueRiskLink.risk_id)
        .join(IssueRiskLink, IssueRiskLink.issue_id == IssueVulnerabilityLink.issue_id)
        .filter(IssueVulnerabilityLink.vulnerability_id.in_(ids))
        .all()
    )
    return _pair_map(rows)


def _journeys_controls(db: Session, ids: List[int]) -> Dict[int, List[int]]:
    """journey -> control_implementations.framework_control_id -> ControlMapping
    -> normalized_control_id, so the target ids line up with the "controls"
    dataset (NormalizedControl) like every other `*_controls` edge."""
    rows = (
        db.query(ControlImplementation.journey_id, ControlMapping.normalized_control_id)
        .join(ControlMapping, ControlMapping.framework_control_id == ControlImplementation.framework_control_id)
        .filter(ControlImplementation.journey_id.in_(ids))
        .all()
    )
    return _pair_map(rows)


def _journeys_evidence(db: Session, ids: List[int]) -> Dict[int, List[int]]:
    rows = (
        db.query(ControlImplementation.journey_id, ImplementationEvidence.evidence_id)
        .join(ImplementationEvidence, ImplementationEvidence.implementation_id == ControlImplementation.id)
        .filter(ControlImplementation.journey_id.in_(ids), ImplementationEvidence.evidence_id.isnot(None))
        .all()
    )
    return _pair_map(rows)


def _journeys_risks(db: Session, ids: List[int]) -> Dict[int, List[int]]:
    """journey -> control_implementations.framework_control_id -> risks mapped
    onto that same framework control via RiskFrameworkControlLink."""
    rows = (
        db.query(ControlImplementation.journey_id, RiskFrameworkControlLink.risk_id)
        .join(
            RiskFrameworkControlLink,
            RiskFrameworkControlLink.framework_control_id == ControlImplementation.framework_control_id,
        )
        .filter(ControlImplementation.journey_id.in_(ids))
        .all()
    )
    return _pair_map(rows)


def _gov_docs_issues(db: Session, ids: List[int]) -> Dict[int, List[int]]:
    rows = db.query(IssueGovernanceLink.governance_document_id, IssueGovernanceLink.issue_id).filter(
        IssueGovernanceLink.governance_document_id.in_(ids)
    ).all()
    return _pair_map(rows)



def _bcm_plans_risks(db: Session, ids: List[int]) -> Dict[int, List[int]]:
    rows = db.query(BcmBiaRecord.plan_id, BcmBiaRecord.linked_risk_id).filter(
        BcmBiaRecord.plan_id.in_(ids), BcmBiaRecord.linked_risk_id.isnot(None)
    ).all()
    return _pair_map(rows)


def _bcm_plans_assets(db: Session, ids: List[int]) -> Dict[int, List[int]]:
    """BIA records carry a JSON list of dependent asset ids (no junction table)."""
    out: Dict[int, List[int]] = {}
    for rec in db.query(BcmBiaRecord).filter(BcmBiaRecord.plan_id.in_(ids)).all():
        for raw_id in (rec.linked_asset_ids or []):
            try:
                aid = int(raw_id)
            except (TypeError, ValueError):
                continue
            bucket = out.setdefault(int(rec.plan_id), [])
            if aid not in bucket:
                bucket.append(aid)
    return out


def _bcm_plans_incidents(db: Session, ids: List[int]) -> Dict[int, List[int]]:
    rows = db.query(BcmDrill.plan_id, BcmDrill.linked_incident_id).filter(
        BcmDrill.plan_id.in_(ids), BcmDrill.linked_incident_id.isnot(None)
    ).all()
    return _pair_map(rows)


def _bcm_drills_risks(db: Session, ids: List[int]) -> Dict[int, List[int]]:
    rows = db.query(BcmFinding.drill_id, BcmFinding.linked_risk_id).filter(
        BcmFinding.drill_id.in_(ids), BcmFinding.linked_risk_id.isnot(None)
    ).all()
    return _pair_map(rows)


def _bcm_drills_issues(db: Session, ids: List[int]) -> Dict[int, List[int]]:
    rows = db.query(BcmFinding.drill_id, BcmFinding.linked_issue_id).filter(
        BcmFinding.drill_id.in_(ids), BcmFinding.linked_issue_id.isnot(None)
    ).all()
    return _pair_map(rows)


def _is_projects_issues(db: Session, ids: List[int]) -> Dict[int, List[int]]:
    rows = db.query(IssueISProjectLink.is_project_id, IssueISProjectLink.issue_id).filter(
        IssueISProjectLink.is_project_id.in_(ids)
    ).all()
    return _pair_map(rows)


def _criticality_info_risks(db: Session, ids: List[int]) -> Dict[int, List[int]]:
    """Direct FK — set when an ISCA item is promoted to the risk register."""
    rows = db.query(InfoSystemCriticalityItem.id, InfoSystemCriticalityItem.linked_risk_id).filter(
        InfoSystemCriticalityItem.id.in_(ids), InfoSystemCriticalityItem.linked_risk_id.isnot(None)
    ).all()
    return _pair_map(rows)


def _criticality_infra_vulns(db: Session, ids: List[int]) -> Dict[int, List[int]]:
    """No direct FK — reached via the item's linked_asset_id's vulnerabilities."""
    rows = (
        db.query(InfraAssetCriticalityItem.id, VulnerabilityAssetLink.vulnerability_id)
        .join(VulnerabilityAssetLink, VulnerabilityAssetLink.asset_id == InfraAssetCriticalityItem.linked_asset_id)
        .filter(InfraAssetCriticalityItem.id.in_(ids))
        .all()
    )
    return _pair_map(rows)


def _discovery_campaigns_assets(db: Session, ids: List[int]) -> Dict[int, List[int]]:
    """campaign -> runs -> observations resolved to a canonical IT asset."""
    rows = (
        db.query(DiscoveryRun.campaign_id, DiscoveryObservation.resolved_asset_id)
        .join(DiscoveryObservation, DiscoveryObservation.run_id == DiscoveryRun.id)
        .filter(DiscoveryRun.campaign_id.in_(ids), DiscoveryObservation.resolved_asset_id.isnot(None))
        .all()
    )
    return _pair_map(rows)


def _regulatory_changes_controls(db: Session, ids: List[int]) -> Dict[int, List[int]]:
    rows = (
        db.query(RegulatoryImplementationTask.regulatory_change_id, RegulatoryImplementationTask.linked_control_id)
        .filter(
            RegulatoryImplementationTask.regulatory_change_id.in_(ids),
            RegulatoryImplementationTask.linked_control_id.isnot(None),
        )
        .all()
    )
    return _pair_map(rows)



def _exceptions_risks(db: Session, ids: List[int]) -> Dict[int, List[int]]:
    """Direct FK — set once an exception's risk is promoted to the register."""
    rows = db.query(PolicyException.id, PolicyException.promoted_risk_id).filter(
        PolicyException.id.in_(ids), PolicyException.promoted_risk_id.isnot(None)
    ).all()
    return _pair_map(rows)



def _committees_risks(db: Session, ids: List[int]) -> Dict[int, List[int]]:
    """committee -> oversight_actions.linked_risk_id, plus committee ->
    meetings -> agenda_items.linked_risk_id (two independent risk touchpoints)."""
    out = _pair_map(
        db.query(OversightAction.committee_id, OversightAction.linked_risk_id)
        .filter(OversightAction.committee_id.in_(ids), OversightAction.linked_risk_id.isnot(None))
        .all()
    )
    rows2 = (
        db.query(CommitteeMeeting.committee_id, MeetingAgendaItem.linked_risk_id)
        .join(MeetingAgendaItem, MeetingAgendaItem.meeting_id == CommitteeMeeting.id)
        .filter(CommitteeMeeting.committee_id.in_(ids), MeetingAgendaItem.linked_risk_id.isnot(None))
        .all()
    )
    for cid, rid in rows2:
        if cid is None or rid is None:
            continue
        bucket = out.setdefault(int(cid), [])
        if int(rid) not in bucket:
            bucket.append(int(rid))
    return out



def _frameworks_controls(db: Session, ids: List[int]) -> Dict[int, List[int]]:
    """framework -> domains -> objectives -> framework_controls -> ControlMapping
    -> normalized_control_id, matching the "controls" dataset (NormalizedControl)."""
    rows = (
        db.query(FrameworkDomain.framework_id, ControlMapping.normalized_control_id)
        .join(ControlObjective, ControlObjective.domain_id == FrameworkDomain.id)
        .join(FrameworkControl, FrameworkControl.objective_id == ControlObjective.id)
        .join(ControlMapping, ControlMapping.framework_control_id == FrameworkControl.id)
        .filter(FrameworkDomain.framework_id.in_(ids))
        .all()
    )
    return _pair_map(rows)


def _frameworks_evidence(db: Session, ids: List[int]) -> Dict[int, List[int]]:
    rows = (
        db.query(FrameworkDomain.framework_id, EvidenceControlMapping.evidence_id)
        .join(ControlObjective, ControlObjective.domain_id == FrameworkDomain.id)
        .join(FrameworkControl, FrameworkControl.objective_id == ControlObjective.id)
        .join(EvidenceControlMapping, EvidenceControlMapping.framework_control_id == FrameworkControl.id)
        .filter(FrameworkDomain.framework_id.in_(ids), EvidenceControlMapping.evidence_id.isnot(None))
        .all()
    )
    return _pair_map(rows)


def _gov_docs_evidence(db: Session, ids: List[int]) -> Dict[int, List[int]]:
    """gov_documents → evidence via DocumentControlLink → EvidenceControlMapping."""
    rows = (
        db.query(DocumentControlLink.document_id, EvidenceControlMapping.evidence_id)
        .join(EvidenceControlMapping, EvidenceControlMapping.normalized_control_id == DocumentControlLink.normalized_control_id)
        .filter(DocumentControlLink.document_id.in_(ids), EvidenceControlMapping.evidence_id.isnot(None))
        .all()
    )
    return _pair_map(rows)


def _regulatory_changes_risks(db: Session, ids: List[int]) -> Dict[int, List[int]]:
    """regulatory_changes → risks via RegulatoryImpactAssessment where impacted_item_type='risk'."""
    rows = (
        db.query(RegulatoryImpactAssessment.regulatory_change_id, RegulatoryImpactAssessment.impacted_item_id)
        .filter(
            RegulatoryImpactAssessment.regulatory_change_id.in_(ids),
            RegulatoryImpactAssessment.impacted_item_type == "risk",
            RegulatoryImpactAssessment.impacted_item_id.isnot(None),
        )
        .all()
    )
    return _pair_map(rows)


def _regulatory_changes_issues(db: Session, ids: List[int]) -> Dict[int, List[int]]:
    """regulatory_changes → issues via RegulatoryImpactAssessment where impacted_item_type='issue'."""
    rows = (
        db.query(RegulatoryImpactAssessment.regulatory_change_id, RegulatoryImpactAssessment.impacted_item_id)
        .filter(
            RegulatoryImpactAssessment.regulatory_change_id.in_(ids),
            RegulatoryImpactAssessment.impacted_item_type == "issue",
            RegulatoryImpactAssessment.impacted_item_id.isnot(None),
        )
        .all()
    )
    return _pair_map(rows)


def _exceptions_controls(db: Session, ids: List[int]) -> Dict[int, List[int]]:
    """exceptions (PolicyException) → controls via document → DocumentControlLink."""
    rows = (
        db.query(PolicyException.id, DocumentControlLink.normalized_control_id)
        .join(DocumentControlLink, DocumentControlLink.document_id == PolicyException.document_id)
        .filter(
            PolicyException.id.in_(ids),
            PolicyException.document_id.isnot(None),
        )
        .all()
    )
    return _pair_map(rows)


def _committees_issues(db: Session, ids: List[int]) -> Dict[int, List[int]]:
    """committees → issues via meetings → agenda_items → document → IssueGovernanceLink."""
    rows = (
        db.query(CommitteeMeeting.committee_id, IssueGovernanceLink.issue_id)
        .join(MeetingAgendaItem, MeetingAgendaItem.meeting_id == CommitteeMeeting.id)
        .join(IssueGovernanceLink, IssueGovernanceLink.governance_document_id == MeetingAgendaItem.linked_document_id)
        .filter(
            CommitteeMeeting.committee_id.in_(ids),
            MeetingAgendaItem.linked_document_id.isnot(None),
        )
        .all()
    )
    return _pair_map(rows)


EDGE_RESOLVERS: Dict[Tuple[str, str], EdgeFn] = {
    ("assets", "vulnerabilities"): _assets_vulnerabilities,
    ("assets", "risks"): _assets_risks,
    ("assets", "controls"): _assets_controls,
    ("assets", "evidence"): _assets_evidence,
    ("assets", "issues"): _assets_issues,
    ("assets", "incidents"): _assets_incidents,
    ("risks", "assets"): _risks_assets,
    ("risks", "controls"): _risks_controls,
    ("risks", "evidence"): _risks_evidence,
    ("risks", "issues"): _risks_issues,
    ("risks", "incidents"): _risks_incidents,
    ("risks", "framework_controls"): _risks_framework_controls,
    ("vulnerabilities", "assets"): _vulns_assets,
    ("vulnerabilities", "controls"): _vulns_controls,
    ("vulnerabilities", "issues"): _vulns_issues,
    ("evidence", "risks"): _evidence_risks,
    ("evidence", "controls"): _evidence_controls,
    ("evidence", "assets"): _evidence_assets,
    ("evidence", "incidents"): _evidence_incidents,
    ("controls", "risks"): _controls_risks,
    ("controls", "assets"): _controls_assets,
    ("controls", "vulnerabilities"): _controls_vulns,
    ("controls", "evidence"): _controls_evidence,
    ("issues", "vulnerabilities"): _issues_vulns,
    ("issues", "risks"): _issues_risks,
    ("issues", "assets"): _issues_assets,
    ("issues", "controls"): _issues_controls,
    ("issues", "evidence"): _issues_evidence,
    ("issues", "vendors"): _issues_vendors,
    ("vendors", "issues"): _vendors_issues,
    ("vendors", "risks"): _vendors_risks,
    ("gov_documents", "risks"): _gov_docs_risks,
    ("gov_documents", "controls"): _gov_docs_controls,
    ("gov_documents", "assets"): _gov_docs_assets,
    ("incidents", "risks"): _incidents_risks,
    ("incidents", "assets"): _incidents_assets,
    ("incidents", "vulnerabilities"): _incidents_vulns,
    ("incidents", "evidence"): _incidents_evidence,
    ("tasks", "risks"): _tasks_risks,
    ("tasks", "issues"): _tasks_issues,
    ("tasks", "vulnerabilities"): _tasks_vulns,
    ("tasks", "assets"): _tasks_assets,
    ("kris", "risks"): _kris_risks,
    ("is_projects", "risks"): _is_projects_risks,
    ("is_projects", "controls"): _is_projects_controls,
    ("criticality_info", "assets"): _criticality_info_assets,
    ("criticality_infra", "assets"): _criticality_infra_assets,
    # ── Expanded datasets (Wave 2) — new registers linked to the hubs ──────────
    ("internal_controls", "risks"): _jn(InternalControlRiskLink.control_id, InternalControlRiskLink.risk_id),
    ("internal_controls", "evidence"): _jn(InternalControlEvidence.internal_control_id, InternalControlEvidence.evidence_id),
    ("internal_controls", "framework_controls"): _jn(InternalControlFrameworkLink.internal_control_id, InternalControlFrameworkLink.framework_control_id),
    ("risks", "internal_controls"): _jn(InternalControlRiskLink.risk_id, InternalControlRiskLink.control_id),
    ("evidence", "internal_controls"): _jn(InternalControlEvidence.evidence_id, InternalControlEvidence.internal_control_id),
    ("risk_assessments", "risks"): _jn(RiskAssessmentRisk.assessment_id, RiskAssessmentRisk.risk_id),
    ("risks", "risk_assessments"): _jn(RiskAssessmentRisk.risk_id, RiskAssessmentRisk.assessment_id),
    ("risk_assessments", "frameworks"): _fwd(RiskAssessment, RiskAssessment.framework_id),
    ("risk_reviews", "risks"): _fwd(RiskReview, RiskReview.risk_id),
    ("risks", "risk_reviews"): _rev(RiskReview, RiskReview.risk_id),
    ("rcsa_findings", "risks"): _fwd(RCSAFinding, RCSAFinding.linked_risk_id),
    ("rcsa_findings", "internal_controls"): _fwd(RCSAFinding, RCSAFinding.linked_internal_control_id),
    ("risks", "rcsa_findings"): _rev(RCSAFinding, RCSAFinding.linked_risk_id),
    ("internal_controls", "rcsa_findings"): _rev(RCSAFinding, RCSAFinding.linked_internal_control_id),
    ("policy_statements", "gov_documents"): _fwd(PolicyStatement, PolicyStatement.document_id),
    ("gov_documents", "policy_statements"): _rev(PolicyStatement, PolicyStatement.document_id),
    ("audit_packages", "evidence"): _jn(AuditPackageEvidence.package_id, AuditPackageEvidence.evidence_id),
    ("evidence", "audit_packages"): _jn(AuditPackageEvidence.evidence_id, AuditPackageEvidence.package_id),
    ("audit_packages", "frameworks"): _fwd(AuditPackage, AuditPackage.framework_id),
    ("vendor_assessments", "vendors"): _fwd(VendorAssessment, VendorAssessment.vendor_id),
    ("vendor_assessments", "risks"): _fwd(VendorAssessment, VendorAssessment.linked_risk_id),
    ("vendors", "vendor_assessments"): _rev(VendorAssessment, VendorAssessment.vendor_id),
    ("oversight_actions", "risks"): _fwd(OversightAction, OversightAction.linked_risk_id),
    ("oversight_actions", "committees"): _fwd(OversightAction, OversightAction.committee_id),
    ("committees", "oversight_actions"): _rev(OversightAction, OversightAction.committee_id),
    ("risks", "oversight_actions"): _rev(OversightAction, OversightAction.linked_risk_id),
    ("ai_risk_assessments", "risks"): _fwd(AIRiskAssessmentEntry, AIRiskAssessmentEntry.bridged_risk_id),
    ("risks", "ai_risk_assessments"): _rev(AIRiskAssessmentEntry, AIRiskAssessmentEntry.bridged_risk_id),
    # ── Wave 4 — curated LINKAGE_CATALOG pairs that previously had no resolver ──
    ("vulnerabilities", "risks"): _vulns_risks,
    ("journeys", "controls"): _journeys_controls,
    ("journeys", "evidence"): _journeys_evidence,
    ("journeys", "risks"): _journeys_risks,
    ("gov_documents", "issues"): _gov_docs_issues,
    ("bcm_plans", "risks"): _bcm_plans_risks,
    ("bcm_plans", "assets"): _bcm_plans_assets,
    ("bcm_plans", "incidents"): _bcm_plans_incidents,
    ("bcm_drills", "risks"): _bcm_drills_risks,
    ("bcm_drills", "issues"): _bcm_drills_issues,
    ("is_projects", "issues"): _is_projects_issues,
    ("criticality_info", "risks"): _criticality_info_risks,
    ("criticality_infra", "vulnerabilities"): _criticality_infra_vulns,
    ("discovery_campaigns", "assets"): _discovery_campaigns_assets,
    ("regulatory_changes", "controls"): _regulatory_changes_controls,
    ("exceptions", "risks"): _exceptions_risks,
    ("committees", "risks"): _committees_risks,
    ("frameworks", "controls"): _frameworks_controls,
    ("frameworks", "evidence"): _frameworks_evidence,
    # ── Wave 5 — previously catalog-only edges now resolved ─────────────────
    ("gov_documents", "evidence"): _gov_docs_evidence,
    ("regulatory_changes", "risks"): _regulatory_changes_risks,
    ("regulatory_changes", "issues"): _regulatory_changes_issues,
    ("exceptions", "controls"): _exceptions_controls,
    ("committees", "issues"): _committees_issues,
}

# Reverse edges for free browsing when only one direction was registered are
# defined explicitly above (assets↔risks, issues↔vendors, etc.).


DATASET_MODELS: Dict[str, Any] = {
    "risks": Risk,
    "controls": NormalizedControl,
    "evidence": Evidence,
    "journeys": CertificationJourney,
    "gov_documents": GovernanceDocument,
    "assets": ITAsset,
    "vendors": Vendor,
    "vulnerabilities": Vulnerability,
    "issues": Issue,
    "incidents": RiskIncident,
    "tasks": CriticalTask,
    "kris": RiskKRI,
    "bcm_plans": BcmPlan,
    "bcm_drills": BcmDrill,
    "is_projects": ISProject,
    "criticality_info": InfoSystemCriticalityItem,
    "criticality_infra": InfraAssetCriticalityItem,
    "discovery_campaigns": DiscoveryCampaign,
    "regulatory_changes": RegulatoryChange,
    "exceptions": PolicyException,
    "committees": GovernanceCommittee,
    "frameworks": Framework,
    "framework_controls": FrameworkControl,
    # Expanded datasets (Wave 2)
    "internal_controls": InternalControl,
    "risk_assessments": RiskAssessment,
    "risk_reviews": RiskReview,
    "rcsa_findings": RCSAFinding,
    "policy_statements": PolicyStatement,
    "audit_packages": AuditPackage,
    "vendor_assessments": VendorAssessment,
    "oversight_actions": OversightAction,
    "ai_risk_assessments": AIRiskAssessmentEntry,
    # Wave 4 — FE report datasets with a real SQLAlchemy model backing them.
    "rcsa_campaigns": RCSACampaign,
    "tpra_findings": TPRAFinding,
}


def parse_xmod_key(key: str) -> Optional[Tuple[str, str]]:
    if not key.startswith("xmod_"):
        return None
    rest = key[5:]
    ds, sep, field = rest.partition("__")
    if not sep or not ds or not field:
        return None
    return ds, field


def _fmt_cell(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, bool):
        return "Yes" if value else "No"
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, (list, tuple, set)):
        parts = [_fmt_cell(v) for v in value]
        return "; ".join(p for p in parts if p)
    if isinstance(value, dict):
        return str(value)
    return str(value)


def _join_values(values: List[Any], *, limit: int = 12) -> Any:
    clean = [v for v in (_fmt_cell(v) for v in values) if v != ""]
    if not clean:
        return ""
    # Preserve numeric if all numeric and single value
    if len(clean) == 1:
        raw = values[0]
        if isinstance(raw, bool):
            return raw
        if isinstance(raw, (int, float)) and not isinstance(raw, bool):
            return raw
        return clean[0]
    if len(clean) <= limit:
        return "; ".join(clean)
    return "; ".join(clean[:limit]) + f"; +{len(clean) - limit} more"


def resolve_related_ids(db: Session, base: str, target: str, ids: List[int]) -> Dict[int, List[int]]:
    fn = EDGE_RESOLVERS.get((base, target))
    if fn is None or not ids:
        return {}
    try:
        return fn(db, ids) or {}
    except Exception:  # noqa: BLE001 — never fail the whole report
        return {}


def enrich_xmod_fields(
    db: Session,
    *,
    dataset: str,
    rows: List[Dict[str, Any]],
    includes: List[str],
    project: Optional[List[str]] = None,
) -> List[Dict[str, Any]]:
    """Project open cross-module fields onto base rows."""
    if not rows or not includes:
        return rows

    project_keys = [k for k in (project or []) if parse_xmod_key(k)]
    # If caller didn't pass project, fill nothing beyond zero stubs for known includes
    by_target: Dict[str, List[str]] = defaultdict(list)
    for key in project_keys:
        parsed = parse_xmod_key(key)
        if not parsed:
            continue
        target, _field = parsed
        if target in includes:
            by_target[target].append(key)

    base_ids: List[int] = []
    for r in rows:
        try:
            base_ids.append(int(r.get("id")))
        except (TypeError, ValueError):
            continue

    related_cache: Dict[str, Dict[int, List[int]]] = {}
    entity_cache: Dict[str, Dict[int, Any]] = {}

    for target in includes:
        related_cache[target] = resolve_related_ids(db, dataset, target, base_ids) if base_ids else {}
        model = DATASET_MODELS.get(target)
        if model is None:
            entity_cache[target] = {}
            continue
        all_rel: Set[int] = set()
        for rels in related_cache[target].values():
            all_rel.update(rels)
        if not all_rel:
            entity_cache[target] = {}
            continue
        try:
            entity_cache[target] = {
                int(e.id): e for e in db.query(model).filter(model.id.in_(list(all_rel))).all()
            }
        except Exception:  # noqa: BLE001
            entity_cache[target] = {}

    merged: List[Dict[str, Any]] = []
    for r in rows:
        row = dict(r)
        try:
            rid = int(r.get("id"))
        except (TypeError, ValueError):
            rid = None

        for target in includes:
            fields = by_target.get(target) or []
            rel_ids = related_cache.get(target, {}).get(rid or -1, []) if rid is not None else []
            entities = [entity_cache.get(target, {}).get(i) for i in rel_ids]
            entities = [e for e in entities if e is not None]

            for key in fields:
                parsed = parse_xmod_key(key)
                if not parsed:
                    continue
                _ds, field = parsed
                if not entities:
                    row.setdefault(key, "" if field != "id" else None)
                    continue
                values = [getattr(e, field, None) for e in entities]
                row[key] = _join_values(values)

            # Always ensure aggregate stubs exist when module is included
            row.setdefault(f"link_{target}_count", len(rel_ids))
            if f"link_{target}_names" not in row and entities:
                name_attr = "title" if hasattr(entities[0], "title") else "name"
                names = [_fmt_cell(getattr(e, name_attr, None)) for e in entities]
                row[f"link_{target}_names"] = _join_values(names)
            row.setdefault(f"link_{target}_names", "")
            row.setdefault(f"link_{target}_open_count", row.get(f"link_{target}_open_count", 0))

        merged.append(row)
    return merged
