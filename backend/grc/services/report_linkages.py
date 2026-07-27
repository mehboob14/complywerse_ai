"""Cross-module linkage enrichment for the Report Builder.

Each base dataset can optionally include linked entities from other modules
(e.g. assets + linked vulnerabilities/risks/controls). Enrichment adds
flattened columns such as counts and name lists so users can pivot/filter
across module boundaries without leaving /reports.
"""
from __future__ import annotations

from collections import defaultdict
from typing import Any, Dict, List, Optional, Set, Tuple

from sqlalchemy.orm import Session

from ..models import (
    AssetControlLink, AssetEvidenceLink, AssetFrameworkControlLink,
    AssetInternalControlLink, Evidence, EvidenceControlMapping, EvidenceIncidentLink,
    FrameworkControl, IncidentAssetLink, IncidentRiskLink, IncidentVulnerabilityLink,
    InternalControl, Issue, IssueAssetLink, IssueControlLink, IssueEvidenceLink,
    IssueRiskLink, IssueVendorLink, IssueVulnerabilityLink, ITAsset, NormalizedControl,
    Risk, RiskAssetLink, RiskControlLink, RiskEvidenceLink, RiskFrameworkControlLink,
    RiskIncident, RiskGovernanceLink, Vendor, Vulnerability, VulnerabilityAssetLink,
    VulnerabilityControlLink,
)

_SEV_RANK = {"critical": 4, "high": 3, "medium": 2, "low": 1, "informational": 0, "info": 0}
_OPEN_STATUS = {
    "open", "new", "triage", "in_progress", "investigating", "mitigating",
    "resolution", "closure_review", "partial", "partially_complied",
}


def _max_sev(current: Optional[str], candidate: Optional[str]) -> Optional[str]:
    if not candidate:
        return current
    if not current:
        return candidate
    return candidate if _SEV_RANK.get(str(candidate).lower(), 0) > _SEV_RANK.get(str(current).lower(), 0) else current


def _names(items: List[str], limit: int = 8) -> str:
    clean = [s.strip() for s in items if s and str(s).strip()]
    if not clean:
        return ""
    if len(clean) <= limit:
        return "; ".join(clean)
    return "; ".join(clean[:limit]) + f"; +{len(clean) - limit} more"


def _field_defs(link_key: str, label: str, *, with_severity: bool = False, with_open: bool = False) -> List[Dict[str, Any]]:
    prefix = f"link_{link_key}"
    fields: List[Dict[str, Any]] = [
        {"key": f"{prefix}_count", "label": f"{label} (count)", "type": "number", "agg": "sum"},
        {"key": f"{prefix}_names", "label": f"Linked {label.lower()}", "type": "text"},
    ]
    if with_severity:
        fields.append({"key": f"{prefix}_max_severity", "label": f"Max {label.lower()} severity", "type": "badge"})
    if with_open:
        fields.append({"key": f"{prefix}_open_count", "label": f"Open {label.lower()} (count)", "type": "number", "agg": "sum"})
    return fields


# Catalog: dataset key -> linkable modules (shown in the builder UI).
LINKAGE_CATALOG: Dict[str, List[Dict[str, Any]]] = {
    "assets": [
        {"key": "vulnerabilities", "label": "Vulnerabilities", "module": "Vulnerabilities",
         "fields": _field_defs("vulnerabilities", "Vulnerabilities", with_severity=True, with_open=True)},
        {"key": "risks", "label": "Risks", "module": "Risk Management",
         "fields": _field_defs("risks", "Risks", with_open=True)},
        {"key": "controls", "label": "Controls", "module": "Controls",
         "fields": _field_defs("controls", "Controls")},
        {"key": "evidence", "label": "Evidence", "module": "Evidence",
         "fields": _field_defs("evidence", "Evidence")},
        {"key": "issues", "label": "Issues", "module": "Issue Management",
         "fields": _field_defs("issues", "Issues", with_severity=True, with_open=True)},
        {"key": "incidents", "label": "Incidents", "module": "ERM Incidents",
         "fields": _field_defs("incidents", "Incidents", with_severity=True, with_open=True)},
    ],
    "risks": [
        {"key": "assets", "label": "Assets", "module": "IT Assets", "fields": _field_defs("assets", "Assets")},
        {"key": "controls", "label": "Controls", "module": "Controls", "fields": _field_defs("controls", "Controls")},
        {"key": "evidence", "label": "Evidence", "module": "Evidence", "fields": _field_defs("evidence", "Evidence")},
        {"key": "framework_controls", "label": "Framework Controls", "module": "Compliance",
         "fields": _field_defs("framework_controls", "Framework controls")},
        {"key": "incidents", "label": "Incidents", "module": "ERM Incidents",
         "fields": _field_defs("incidents", "Incidents", with_severity=True, with_open=True)},
        {"key": "issues", "label": "Issues", "module": "Issue Management",
         "fields": _field_defs("issues", "Issues", with_severity=True, with_open=True)},
    ],
    "vulnerabilities": [
        {"key": "assets", "label": "Assets", "module": "IT Assets", "fields": _field_defs("assets", "Assets")},
        {"key": "controls", "label": "Controls", "module": "Controls", "fields": _field_defs("controls", "Controls")},
        {"key": "issues", "label": "Issues", "module": "Issue Management",
         "fields": _field_defs("issues", "Issues", with_severity=True, with_open=True)},
        {"key": "risks", "label": "Risks", "module": "Risk Management",
         "fields": _field_defs("risks", "Risks", with_open=True)},
    ],
    "evidence": [
        {"key": "risks", "label": "Risks", "module": "Risk Management",
         "fields": _field_defs("risks", "Risks", with_open=True)},
        {"key": "controls", "label": "Controls", "module": "Controls", "fields": _field_defs("controls", "Controls")},
        {"key": "assets", "label": "Assets", "module": "IT Assets", "fields": _field_defs("assets", "Assets")},
        {"key": "incidents", "label": "Incidents", "module": "ERM Incidents",
         "fields": _field_defs("incidents", "Incidents", with_severity=True, with_open=True)},
    ],
    "controls": [
        {"key": "risks", "label": "Risks", "module": "Risk Management",
         "fields": _field_defs("risks", "Risks", with_open=True)},
        {"key": "assets", "label": "Assets", "module": "IT Assets", "fields": _field_defs("assets", "Assets")},
        {"key": "vulnerabilities", "label": "Vulnerabilities", "module": "Vulnerabilities",
         "fields": _field_defs("vulnerabilities", "Vulnerabilities", with_severity=True, with_open=True)},
        {"key": "evidence", "label": "Evidence", "module": "Evidence", "fields": _field_defs("evidence", "Evidence")},
    ],
    "issues": [
        {"key": "vulnerabilities", "label": "Vulnerabilities", "module": "Vulnerabilities",
         "fields": _field_defs("vulnerabilities", "Vulnerabilities", with_severity=True, with_open=True)},
        {"key": "risks", "label": "Risks", "module": "Risk Management",
         "fields": _field_defs("risks", "Risks", with_open=True)},
        {"key": "assets", "label": "Assets", "module": "IT Assets", "fields": _field_defs("assets", "Assets")},
        {"key": "controls", "label": "Controls", "module": "Controls", "fields": _field_defs("controls", "Controls")},
        {"key": "evidence", "label": "Evidence", "module": "Evidence", "fields": _field_defs("evidence", "Evidence")},
        {"key": "vendors", "label": "Vendors", "module": "Vendor Risk", "fields": _field_defs("vendors", "Vendors")},
    ],
    "incidents": [
        {"key": "risks", "label": "Risks", "module": "Risk Management",
         "fields": _field_defs("risks", "Risks", with_open=True)},
        {"key": "assets", "label": "Assets", "module": "IT Assets", "fields": _field_defs("assets", "Assets")},
        {"key": "vulnerabilities", "label": "Vulnerabilities", "module": "Vulnerabilities",
         "fields": _field_defs("vulnerabilities", "Vulnerabilities", with_severity=True, with_open=True)},
        {"key": "evidence", "label": "Evidence", "module": "Evidence", "fields": _field_defs("evidence", "Evidence")},
    ],
    "vendors": [
        {"key": "issues", "label": "Issues", "module": "Issue Management",
         "fields": _field_defs("issues", "Issues", with_severity=True, with_open=True)},
        {"key": "risks", "label": "Risks", "module": "Risk Management",
         "fields": _field_defs("risks", "Risks", with_open=True)},
    ],
    "journeys": [],
    "gov_documents": [
        {"key": "risks", "label": "Risks", "module": "Risk Management",
         "fields": _field_defs("risks", "Risks", with_open=True)},
        {"key": "controls", "label": "Controls", "module": "Controls", "fields": _field_defs("controls", "Controls")},
    ],
}


def get_linkage_catalog(dataset: str) -> List[Dict[str, Any]]:
    return LINKAGE_CATALOG.get(dataset, [])


def _bucket() -> Dict[str, Any]:
    return {"names": [], "count": 0, "open": 0, "max_severity": None}


def _apply(bucket: Dict[str, Any], name: Optional[str], *, severity: Optional[str] = None, is_open: bool = False) -> None:
    bucket["count"] += 1
    if name:
        bucket["names"].append(str(name))
    if is_open:
        bucket["open"] += 1
    if severity:
        bucket["max_severity"] = _max_sev(bucket.get("max_severity"), severity)


def _merge_buckets(target: Dict[int, Dict[str, Dict[str, Any]]], base_id: int, link_key: str, bucket: Dict[str, Any]) -> None:
    if base_id not in target:
        target[base_id] = {}
    target[base_id][link_key] = bucket


def _flatten_link(base_id: int, link_key: str, bucket: Dict[str, Any]) -> Dict[str, Any]:
    prefix = f"link_{link_key}"
    out: Dict[str, Any] = {
        f"{prefix}_count": bucket.get("count", 0),
        f"{prefix}_names": _names(bucket.get("names") or []),
    }
    if bucket.get("max_severity"):
        out[f"{prefix}_max_severity"] = bucket["max_severity"]
    if "open" in bucket:
        out[f"{prefix}_open_count"] = bucket.get("open", 0)
    return out


def _is_open_status(status: Optional[str]) -> bool:
    if not status:
        return True
    s = str(status).lower().replace(" ", "_")
    return s not in {"closed", "resolved", "mitigated", "completed", "verified", "cancelled", "complied", "approved"}


# ── Per-dataset enrichers ────────────────────────────────────────────────────

def _enrich_assets(db: Session, ids: List[int], includes: Set[str]) -> Dict[int, Dict[str, Dict[str, Any]]]:
    out: Dict[int, Dict[str, Dict[str, Any]]] = {}
    if not ids:
        return out

    if "vulnerabilities" in includes:
        rows = (
            db.query(VulnerabilityAssetLink.asset_id, Vulnerability.title, Vulnerability.severity, Vulnerability.status)
            .join(Vulnerability, Vulnerability.id == VulnerabilityAssetLink.vulnerability_id)
            .filter(VulnerabilityAssetLink.asset_id.in_(ids))
            .all()
        )
        for aid, title, sev, st in rows:
            b = out.setdefault(aid, {}).setdefault("vulnerabilities", _bucket())
            _apply(b, title or "Vulnerability", severity=sev, is_open=_is_open_status(st))

    if "risks" in includes:
        rows = (
            db.query(RiskAssetLink.asset_id, Risk.title, Risk.closure_status)
            .join(Risk, Risk.id == RiskAssetLink.risk_id)
            .filter(RiskAssetLink.asset_id.in_(ids))
            .all()
        )
        for aid, title, st in rows:
            b = out.setdefault(aid, {}).setdefault("risks", _bucket())
            _apply(b, title, is_open=_is_open_status(st))

    if "controls" in includes:
        for aid in ids:
            out.setdefault(aid, {}).setdefault("controls", _bucket())
        rows_nc = (
            db.query(AssetControlLink.asset_id, NormalizedControl.name)
            .join(NormalizedControl, NormalizedControl.id == AssetControlLink.normalized_control_id)
            .filter(AssetControlLink.asset_id.in_(ids))
            .all()
        )
        for aid, name in rows_nc:
            _apply(out[aid]["controls"], name)
        rows_ic = (
            db.query(AssetInternalControlLink.asset_id, InternalControl.name)
            .join(InternalControl, InternalControl.id == AssetInternalControlLink.internal_control_id)
            .filter(AssetInternalControlLink.asset_id.in_(ids))
            .all()
        )
        for aid, name in rows_ic:
            _apply(out[aid]["controls"], name)
        rows_fc = (
            db.query(AssetFrameworkControlLink.asset_id, FrameworkControl.name)
            .join(FrameworkControl, FrameworkControl.id == AssetFrameworkControlLink.framework_control_id)
            .filter(AssetFrameworkControlLink.asset_id.in_(ids))
            .all()
        )
        for aid, title in rows_fc:
            _apply(out[aid]["controls"], title)

    if "evidence" in includes:
        rows = (
            db.query(AssetEvidenceLink.asset_id, Evidence.name)
            .join(Evidence, Evidence.id == AssetEvidenceLink.evidence_id)
            .filter(AssetEvidenceLink.asset_id.in_(ids))
            .all()
        )
        for aid, name in rows:
            b = out.setdefault(aid, {}).setdefault("evidence", _bucket())
            _apply(b, name)

    if "issues" in includes:
        rows = (
            db.query(IssueAssetLink.asset_id, Issue.title, Issue.severity, Issue.workflow_state)
            .join(Issue, Issue.id == IssueAssetLink.issue_id)
            .filter(IssueAssetLink.asset_id.in_(ids))
            .all()
        )
        for aid, title, sev, st in rows:
            b = out.setdefault(aid, {}).setdefault("issues", _bucket())
            _apply(b, title, severity=sev, is_open=_is_open_status(st))

    if "incidents" in includes:
        rows = (
            db.query(IncidentAssetLink.asset_id, RiskIncident.title, RiskIncident.severity, RiskIncident.status)
            .join(RiskIncident, RiskIncident.id == IncidentAssetLink.incident_id)
            .filter(IncidentAssetLink.asset_id.in_(ids))
            .all()
        )
        for aid, title, sev, st in rows:
            b = out.setdefault(aid, {}).setdefault("incidents", _bucket())
            _apply(b, title, severity=sev, is_open=_is_open_status(st))

    return out


def _enrich_risks(db: Session, ids: List[int], includes: Set[str]) -> Dict[int, Dict[str, Dict[str, Any]]]:
    out: Dict[int, Dict[str, Dict[str, Any]]] = {}
    if not ids:
        return out

    if "assets" in includes:
        rows = (
            db.query(RiskAssetLink.risk_id, ITAsset.name)
            .join(ITAsset, ITAsset.id == RiskAssetLink.asset_id)
            .filter(RiskAssetLink.risk_id.in_(ids))
            .all()
        )
        for rid, name in rows:
            b = out.setdefault(rid, {}).setdefault("assets", _bucket())
            _apply(b, name)

    if "controls" in includes:
        rows = (
            db.query(RiskControlLink.risk_id, NormalizedControl.name)
            .join(NormalizedControl, NormalizedControl.id == RiskControlLink.normalized_control_id)
            .filter(RiskControlLink.risk_id.in_(ids))
            .all()
        )
        for rid, name in rows:
            b = out.setdefault(rid, {}).setdefault("controls", _bucket())
            _apply(b, name)

    if "evidence" in includes:
        rows = (
            db.query(RiskEvidenceLink.risk_id, Evidence.name)
            .join(Evidence, Evidence.id == RiskEvidenceLink.evidence_id)
            .filter(RiskEvidenceLink.risk_id.in_(ids))
            .all()
        )
        for rid, name in rows:
            b = out.setdefault(rid, {}).setdefault("evidence", _bucket())
            _apply(b, name)

    if "framework_controls" in includes:
        rows = (
            db.query(RiskFrameworkControlLink.risk_id, FrameworkControl.name)
            .join(FrameworkControl, FrameworkControl.id == RiskFrameworkControlLink.framework_control_id)
            .filter(RiskFrameworkControlLink.risk_id.in_(ids))
            .all()
        )
        for rid, title in rows:
            b = out.setdefault(rid, {}).setdefault("framework_controls", _bucket())
            _apply(b, title)

    if "incidents" in includes:
        rows = (
            db.query(IncidentRiskLink.risk_id, RiskIncident.title, RiskIncident.severity, RiskIncident.status)
            .join(RiskIncident, RiskIncident.id == IncidentRiskLink.incident_id)
            .filter(IncidentRiskLink.risk_id.in_(ids))
            .all()
        )
        for rid, title, sev, st in rows:
            b = out.setdefault(rid, {}).setdefault("incidents", _bucket())
            _apply(b, title, severity=sev, is_open=_is_open_status(st))
        # Primary FK on incident.risk_id
        rows2 = (
            db.query(RiskIncident.risk_id, RiskIncident.title, RiskIncident.severity, RiskIncident.status)
            .filter(RiskIncident.risk_id.in_(ids))
            .all()
        )
        for rid, title, sev, st in rows2:
            if rid is None:
                continue
            b = out.setdefault(rid, {}).setdefault("incidents", _bucket())
            _apply(b, title, severity=sev, is_open=_is_open_status(st))

    if "issues" in includes:
        rows = (
            db.query(IssueRiskLink.risk_id, Issue.title, Issue.severity, Issue.workflow_state)
            .join(Issue, Issue.id == IssueRiskLink.issue_id)
            .filter(IssueRiskLink.risk_id.in_(ids))
            .all()
        )
        for rid, title, sev, st in rows:
            b = out.setdefault(rid, {}).setdefault("issues", _bucket())
            _apply(b, title, severity=sev, is_open=_is_open_status(st))

    return out


def _enrich_vulnerabilities(db: Session, ids: List[int], includes: Set[str]) -> Dict[int, Dict[str, Dict[str, Any]]]:
    out: Dict[int, Dict[str, Dict[str, Any]]] = {}
    if not ids:
        return out

    if "assets" in includes:
        rows = (
            db.query(VulnerabilityAssetLink.vulnerability_id, ITAsset.name)
            .join(ITAsset, ITAsset.id == VulnerabilityAssetLink.asset_id)
            .filter(VulnerabilityAssetLink.vulnerability_id.in_(ids))
            .all()
        )
        for vid, name in rows:
            b = out.setdefault(vid, {}).setdefault("assets", _bucket())
            _apply(b, name)

    if "controls" in includes:
        rows = (
            db.query(VulnerabilityControlLink.vulnerability_id, NormalizedControl.name, FrameworkControl.name)
            .outerjoin(NormalizedControl, NormalizedControl.id == VulnerabilityControlLink.normalized_control_id)
            .outerjoin(FrameworkControl, FrameworkControl.id == VulnerabilityControlLink.framework_control_id)
            .filter(VulnerabilityControlLink.vulnerability_id.in_(ids))
            .all()
        )
        for vid, nc_name, fc_title in rows:
            b = out.setdefault(vid, {}).setdefault("controls", _bucket())
            _apply(b, nc_name or fc_title)

    if "issues" in includes:
        rows = (
            db.query(IssueVulnerabilityLink.vulnerability_id, Issue.title, Issue.severity, Issue.workflow_state)
            .join(Issue, Issue.id == IssueVulnerabilityLink.issue_id)
            .filter(IssueVulnerabilityLink.vulnerability_id.in_(ids))
            .all()
        )
        for vid, title, sev, st in rows:
            b = out.setdefault(vid, {}).setdefault("issues", _bucket())
            _apply(b, title, severity=sev, is_open=_is_open_status(st))

    if "risks" in includes:
        # Risks linked via issues that link this vuln — indirect but useful
        rows = (
            db.query(IssueVulnerabilityLink.vulnerability_id, Risk.title, Risk.closure_status)
            .join(IssueRiskLink, IssueRiskLink.issue_id == IssueVulnerabilityLink.issue_id)
            .join(Risk, Risk.id == IssueRiskLink.risk_id)
            .filter(IssueVulnerabilityLink.vulnerability_id.in_(ids))
            .all()
        )
        for vid, title, st in rows:
            b = out.setdefault(vid, {}).setdefault("risks", _bucket())
            _apply(b, title, is_open=_is_open_status(st))

    return out


def _enrich_evidence(db: Session, ids: List[int], includes: Set[str]) -> Dict[int, Dict[str, Dict[str, Any]]]:
    out: Dict[int, Dict[str, Dict[str, Any]]] = {}
    if not ids:
        return out

    if "risks" in includes:
        rows = (
            db.query(RiskEvidenceLink.evidence_id, Risk.title, Risk.closure_status)
            .join(Risk, Risk.id == RiskEvidenceLink.risk_id)
            .filter(RiskEvidenceLink.evidence_id.in_(ids))
            .all()
        )
        for eid, title, st in rows:
            b = out.setdefault(eid, {}).setdefault("risks", _bucket())
            _apply(b, title, is_open=_is_open_status(st))

    if "controls" in includes:
        rows = (
            db.query(EvidenceControlMapping.evidence_id, NormalizedControl.name, FrameworkControl.name)
            .outerjoin(NormalizedControl, NormalizedControl.id == EvidenceControlMapping.normalized_control_id)
            .outerjoin(FrameworkControl, FrameworkControl.id == EvidenceControlMapping.framework_control_id)
            .filter(EvidenceControlMapping.evidence_id.in_(ids))
            .all()
        )
        for eid, nc_name, fc_title in rows:
            b = out.setdefault(eid, {}).setdefault("controls", _bucket())
            _apply(b, nc_name or fc_title)

    if "assets" in includes:
        rows = (
            db.query(AssetEvidenceLink.evidence_id, ITAsset.name)
            .join(ITAsset, ITAsset.id == AssetEvidenceLink.asset_id)
            .filter(AssetEvidenceLink.evidence_id.in_(ids))
            .all()
        )
        for eid, name in rows:
            b = out.setdefault(eid, {}).setdefault("assets", _bucket())
            _apply(b, name)

    if "incidents" in includes:
        rows = (
            db.query(EvidenceIncidentLink.evidence_id, RiskIncident.title, RiskIncident.severity, RiskIncident.status)
            .join(RiskIncident, RiskIncident.id == EvidenceIncidentLink.incident_id)
            .filter(EvidenceIncidentLink.evidence_id.in_(ids))
            .all()
        )
        for eid, title, sev, st in rows:
            b = out.setdefault(eid, {}).setdefault("incidents", _bucket())
            _apply(b, title, severity=sev, is_open=_is_open_status(st))

    return out


def _enrich_controls(db: Session, ids: List[int], includes: Set[str]) -> Dict[int, Dict[str, Dict[str, Any]]]:
    out: Dict[int, Dict[str, Dict[str, Any]]] = {}
    if not ids:
        return out

    if "risks" in includes:
        rows = (
            db.query(RiskControlLink.normalized_control_id, Risk.title, Risk.closure_status)
            .join(Risk, Risk.id == RiskControlLink.risk_id)
            .filter(RiskControlLink.normalized_control_id.in_(ids))
            .all()
        )
        for cid, title, st in rows:
            b = out.setdefault(cid, {}).setdefault("risks", _bucket())
            _apply(b, title, is_open=_is_open_status(st))

    if "assets" in includes:
        rows = (
            db.query(AssetControlLink.normalized_control_id, ITAsset.name)
            .join(ITAsset, ITAsset.id == AssetControlLink.asset_id)
            .filter(AssetControlLink.normalized_control_id.in_(ids))
            .all()
        )
        for cid, name in rows:
            b = out.setdefault(cid, {}).setdefault("assets", _bucket())
            _apply(b, name)

    if "vulnerabilities" in includes:
        rows = (
            db.query(VulnerabilityControlLink.normalized_control_id, Vulnerability.title, Vulnerability.severity, Vulnerability.status)
            .join(Vulnerability, Vulnerability.id == VulnerabilityControlLink.vulnerability_id)
            .filter(VulnerabilityControlLink.normalized_control_id.in_(ids))
            .all()
        )
        for cid, title, sev, st in rows:
            b = out.setdefault(cid, {}).setdefault("vulnerabilities", _bucket())
            _apply(b, title, severity=sev, is_open=_is_open_status(st))

    if "evidence" in includes:
        rows = (
            db.query(EvidenceControlMapping.normalized_control_id, Evidence.name)
            .join(Evidence, Evidence.id == EvidenceControlMapping.evidence_id)
            .filter(EvidenceControlMapping.normalized_control_id.in_(ids))
            .all()
        )
        for cid, name in rows:
            b = out.setdefault(cid, {}).setdefault("evidence", _bucket())
            _apply(b, name)

    return out


def _enrich_issues(db: Session, ids: List[int], includes: Set[str]) -> Dict[int, Dict[str, Dict[str, Any]]]:
    out: Dict[int, Dict[str, Dict[str, Any]]] = {}
    if not ids:
        return out

    if "vulnerabilities" in includes:
        rows = (
            db.query(IssueVulnerabilityLink.issue_id, Vulnerability.title, Vulnerability.severity, Vulnerability.status)
            .join(Vulnerability, Vulnerability.id == IssueVulnerabilityLink.vulnerability_id)
            .filter(IssueVulnerabilityLink.issue_id.in_(ids))
            .all()
        )
        for iid, title, sev, st in rows:
            b = out.setdefault(iid, {}).setdefault("vulnerabilities", _bucket())
            _apply(b, title, severity=sev, is_open=_is_open_status(st))

    if "risks" in includes:
        rows = (
            db.query(IssueRiskLink.issue_id, Risk.title, Risk.closure_status)
            .join(Risk, Risk.id == IssueRiskLink.risk_id)
            .filter(IssueRiskLink.issue_id.in_(ids))
            .all()
        )
        for iid, title, st in rows:
            b = out.setdefault(iid, {}).setdefault("risks", _bucket())
            _apply(b, title, is_open=_is_open_status(st))

    if "assets" in includes:
        rows = (
            db.query(IssueAssetLink.issue_id, ITAsset.name)
            .join(ITAsset, ITAsset.id == IssueAssetLink.asset_id)
            .filter(IssueAssetLink.issue_id.in_(ids))
            .all()
        )
        for iid, name in rows:
            b = out.setdefault(iid, {}).setdefault("assets", _bucket())
            _apply(b, name)

    if "controls" in includes:
        rows = (
            db.query(
                IssueControlLink.issue_id,
                NormalizedControl.name,
                FrameworkControl.name,
                InternalControl.name,
            )
            .outerjoin(NormalizedControl, NormalizedControl.id == IssueControlLink.normalized_control_id)
            .outerjoin(FrameworkControl, FrameworkControl.id == IssueControlLink.framework_control_id)
            .outerjoin(InternalControl, InternalControl.id == IssueControlLink.internal_control_id)
            .filter(IssueControlLink.issue_id.in_(ids))
            .all()
        )
        for iid, nc_name, fc_title, ic_name in rows:
            b = out.setdefault(iid, {}).setdefault("controls", _bucket())
            _apply(b, nc_name or fc_title or ic_name)

    if "evidence" in includes:
        rows = (
            db.query(IssueEvidenceLink.issue_id, Evidence.name)
            .join(Evidence, Evidence.id == IssueEvidenceLink.evidence_id)
            .filter(IssueEvidenceLink.issue_id.in_(ids))
            .all()
        )
        for iid, name in rows:
            b = out.setdefault(iid, {}).setdefault("evidence", _bucket())
            _apply(b, name)

    if "vendors" in includes:
        rows = (
            db.query(IssueVendorLink.issue_id, Vendor.name)
            .join(Vendor, Vendor.id == IssueVendorLink.vendor_id)
            .filter(IssueVendorLink.issue_id.in_(ids))
            .all()
        )
        for iid, name in rows:
            b = out.setdefault(iid, {}).setdefault("vendors", _bucket())
            _apply(b, name)

    return out


def _enrich_incidents(db: Session, ids: List[int], includes: Set[str]) -> Dict[int, Dict[str, Dict[str, Any]]]:
    out: Dict[int, Dict[str, Dict[str, Any]]] = {}
    if not ids:
        return out

    if "risks" in includes:
        rows = (
            db.query(IncidentRiskLink.incident_id, Risk.title, Risk.closure_status)
            .join(Risk, Risk.id == IncidentRiskLink.risk_id)
            .filter(IncidentRiskLink.incident_id.in_(ids))
            .all()
        )
        for iid, title, st in rows:
            b = out.setdefault(iid, {}).setdefault("risks", _bucket())
            _apply(b, title, is_open=_is_open_status(st))
        rows2 = db.query(RiskIncident.id, Risk.title, Risk.closure_status).join(
            Risk, Risk.id == RiskIncident.risk_id,
        ).filter(RiskIncident.id.in_(ids)).all()
        for inc_id, title, st in rows2:
            b = out.setdefault(inc_id, {}).setdefault("risks", _bucket())
            _apply(b, title, is_open=_is_open_status(st))

    if "assets" in includes:
        rows = (
            db.query(IncidentAssetLink.incident_id, ITAsset.name)
            .join(ITAsset, ITAsset.id == IncidentAssetLink.asset_id)
            .filter(IncidentAssetLink.incident_id.in_(ids))
            .all()
        )
        for iid, name in rows:
            b = out.setdefault(iid, {}).setdefault("assets", _bucket())
            _apply(b, name)

    if "vulnerabilities" in includes:
        rows = (
            db.query(IncidentVulnerabilityLink.incident_id, Vulnerability.title, Vulnerability.severity, Vulnerability.status)
            .join(Vulnerability, Vulnerability.id == IncidentVulnerabilityLink.vulnerability_id)
            .filter(IncidentVulnerabilityLink.incident_id.in_(ids))
            .all()
        )
        for iid, title, sev, st in rows:
            b = out.setdefault(iid, {}).setdefault("vulnerabilities", _bucket())
            _apply(b, title, severity=sev, is_open=_is_open_status(st))

    if "evidence" in includes:
        rows = (
            db.query(EvidenceIncidentLink.incident_id, Evidence.name)
            .join(Evidence, Evidence.id == EvidenceIncidentLink.evidence_id)
            .filter(EvidenceIncidentLink.incident_id.in_(ids))
            .all()
        )
        for iid, name in rows:
            b = out.setdefault(iid, {}).setdefault("evidence", _bucket())
            _apply(b, name)

    return out


_ENRICHERS = {
    "assets": _enrich_assets,
    "risks": _enrich_risks,
    "vulnerabilities": _enrich_vulnerabilities,
    "evidence": _enrich_evidence,
    "controls": _enrich_controls,
    "issues": _enrich_issues,
    "incidents": _enrich_incidents,
}


def enrich_rows(
    db: Session,
    *,
    dataset: str,
    rows: List[Dict[str, Any]],
    includes: List[str],
) -> List[Dict[str, Any]]:
    """Merge linkage columns into report rows. Safe to call with empty includes."""
    if not rows or not includes:
        return rows

    catalog_keys = {e["key"] for e in get_linkage_catalog(dataset)}
    valid = [i for i in includes if i in catalog_keys]
    if not valid:
        return rows

    ids: List[int] = []
    for r in rows:
        try:
            ids.append(int(r.get("id")))
        except (TypeError, ValueError):
            continue
    if not ids:
        return rows

    enricher = _ENRICHERS.get(dataset)
    if enricher is None:
        return rows

    buckets = enricher(db, ids, set(valid))
    merged: List[Dict[str, Any]] = []
    for r in rows:
        try:
            rid = int(r.get("id"))
        except (TypeError, ValueError):
            merged.append(r)
            continue
        row = dict(r)
        for link_key, bucket in (buckets.get(rid) or {}).items():
            row.update(_flatten_link(rid, link_key, bucket))
        # Zero-fill requested includes with no links
        for link_key in valid:
            prefix = f"link_{link_key}"
            row.setdefault(f"{prefix}_count", 0)
            row.setdefault(f"{prefix}_names", "")
            row.setdefault(f"{prefix}_open_count", 0)
        merged.append(row)
    return merged
