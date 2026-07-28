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
    AssetInternalControlLink, CriticalTask, DocumentAssetLink, DocumentControlLink,
    DocumentRiskLink, Evidence, EvidenceControlMapping, EvidenceIncidentLink,
    FrameworkControl, IncidentAssetLink, IncidentRiskLink, IncidentVulnerabilityLink,
    InternalControl, Issue, IssueAssetLink, IssueControlLink, IssueEvidenceLink,
    IssueRiskLink, IssueVendorLink, IssueVulnerabilityLink, ISProject, ITAsset,
    NormalizedControl, Risk, RiskAssetLink, RiskControlLink, RiskEvidenceLink,
    RiskFrameworkControlLink, RiskIncident, RiskGovernanceLink, RiskKRI, Vendor,
    Vulnerability, VulnerabilityAssetLink, VulnerabilityControlLink,
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
    "journeys": [
        {"key": "controls", "label": "Controls", "module": "Controls",
         "fields": _field_defs("controls", "Controls")},
        {"key": "evidence", "label": "Evidence", "module": "Evidence",
         "fields": _field_defs("evidence", "Evidence")},
        {"key": "risks", "label": "Risks", "module": "Risk Management",
         "fields": _field_defs("risks", "Risks", with_open=True)},
    ],
    "gov_documents": [
        {"key": "risks", "label": "Risks", "module": "Risk Management",
         "fields": _field_defs("risks", "Risks", with_open=True)},
        {"key": "controls", "label": "Controls", "module": "Controls", "fields": _field_defs("controls", "Controls")},
        {"key": "assets", "label": "Assets", "module": "IT Assets", "fields": _field_defs("assets", "Assets")},
        {"key": "evidence", "label": "Evidence", "module": "Evidence",
         "fields": _field_defs("evidence", "Evidence")},
        {"key": "issues", "label": "Issues", "module": "Issue Management",
         "fields": _field_defs("issues", "Issues", with_severity=True, with_open=True)},
    ],
    # Newer datasets — catalog entries enable the column picker; enrichers
    # fill values when a backend join exists. Missing enrichers still show
    # zero-filled link columns rather than hiding the option.
    "tasks": [
        {"key": "assets", "label": "Assets", "module": "IT Assets", "fields": _field_defs("assets", "Assets")},
        {"key": "risks", "label": "Risks", "module": "Risk Management",
         "fields": _field_defs("risks", "Risks", with_open=True)},
        {"key": "issues", "label": "Issues", "module": "Issue Management",
         "fields": _field_defs("issues", "Issues", with_severity=True, with_open=True)},
        {"key": "vulnerabilities", "label": "Vulnerabilities", "module": "Vulnerabilities",
         "fields": _field_defs("vulnerabilities", "Vulnerabilities", with_severity=True, with_open=True)},
    ],
    "kris": [
        {"key": "risks", "label": "Risks", "module": "Risk Management",
         "fields": _field_defs("risks", "Risks", with_open=True)},
    ],
    "bcm_plans": [
        {"key": "risks", "label": "Risks", "module": "Risk Management",
         "fields": _field_defs("risks", "Risks", with_open=True)},
        {"key": "assets", "label": "Assets", "module": "IT Assets", "fields": _field_defs("assets", "Assets")},
        {"key": "incidents", "label": "Incidents", "module": "ERM Incidents",
         "fields": _field_defs("incidents", "Incidents", with_severity=True, with_open=True)},
    ],
    "bcm_drills": [
        {"key": "risks", "label": "Risks", "module": "Risk Management",
         "fields": _field_defs("risks", "Risks", with_open=True)},
        {"key": "issues", "label": "Issues", "module": "Issue Management",
         "fields": _field_defs("issues", "Issues", with_severity=True, with_open=True)},
    ],
    "is_projects": [
        {"key": "risks", "label": "Risks", "module": "Risk Management",
         "fields": _field_defs("risks", "Risks", with_open=True)},
        {"key": "issues", "label": "Issues", "module": "Issue Management",
         "fields": _field_defs("issues", "Issues", with_severity=True, with_open=True)},
        {"key": "controls", "label": "Controls", "module": "Controls",
         "fields": _field_defs("controls", "Controls")},
    ],
    "criticality_info": [
        {"key": "assets", "label": "Assets", "module": "IT Assets", "fields": _field_defs("assets", "Assets")},
        {"key": "risks", "label": "Risks", "module": "Risk Management",
         "fields": _field_defs("risks", "Risks", with_open=True)},
    ],
    "criticality_infra": [
        {"key": "assets", "label": "Assets", "module": "IT Assets", "fields": _field_defs("assets", "Assets")},
        {"key": "vulnerabilities", "label": "Vulnerabilities", "module": "Vulnerabilities",
         "fields": _field_defs("vulnerabilities", "Vulnerabilities", with_severity=True, with_open=True)},
    ],
    "discovery_campaigns": [
        {"key": "assets", "label": "Assets", "module": "IT Assets", "fields": _field_defs("assets", "Assets")},
    ],
    "regulatory_changes": [
        {"key": "risks", "label": "Risks", "module": "Risk Management",
         "fields": _field_defs("risks", "Risks", with_open=True)},
        {"key": "controls", "label": "Controls", "module": "Controls",
         "fields": _field_defs("controls", "Controls")},
        {"key": "issues", "label": "Issues", "module": "Issue Management",
         "fields": _field_defs("issues", "Issues", with_severity=True, with_open=True)},
    ],
    "exceptions": [
        {"key": "risks", "label": "Risks", "module": "Risk Management",
         "fields": _field_defs("risks", "Risks", with_open=True)},
        {"key": "controls", "label": "Controls", "module": "Controls",
         "fields": _field_defs("controls", "Controls")},
    ],
    "committees": [
        {"key": "risks", "label": "Risks", "module": "Risk Management",
         "fields": _field_defs("risks", "Risks", with_open=True)},
        {"key": "issues", "label": "Issues", "module": "Issue Management",
         "fields": _field_defs("issues", "Issues", with_severity=True, with_open=True)},
    ],
    "frameworks": [
        {"key": "controls", "label": "Controls", "module": "Controls",
         "fields": _field_defs("controls", "Controls")},
        {"key": "evidence", "label": "Evidence", "module": "Evidence",
         "fields": _field_defs("evidence", "Evidence")},
    ],
}


def get_linkage_catalog(dataset: str) -> List[Dict[str, Any]]:
    """Open catalog: every other known module, with aggregate + field stubs.

    The frontend builds a richer catalog from its DATASETS registry (full column
    labels). This backend catalog remains as a fallback / merge source.
    """
    from .report_open_catalog import DATASET_MODELS, EDGE_RESOLVERS

    # Prefer curated entries when present (richer aggregate field defs)
    curated = {e["key"]: e for e in LINKAGE_CATALOG.get(dataset, [])}
    out: List[Dict[str, Any]] = []
    for key in DATASET_MODELS:
        if key == dataset:
            continue
        if key in curated:
            out.append(curated[key])
            continue
        label = key.replace("_", " ").title()
        fields = _field_defs(key, label, with_open=True)
        # Marker that open xmod fields are expected from the client catalog
        out.append({
            "key": key,
            "label": label,
            "module": label,
            "fields": fields,
            "has_edge": (dataset, key) in EDGE_RESOLVERS,
        })
    # Include curated-only keys not in DATASET_MODELS (e.g. framework_controls)
    for key, entry in curated.items():
        if not any(e["key"] == key for e in out):
            out.append(entry)
    return out


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


def _enrich_vendors(db: Session, ids: List[int], includes: Set[str]) -> Dict[int, Dict[str, Dict[str, Any]]]:
    out: Dict[int, Dict[str, Dict[str, Any]]] = {}
    if not ids:
        return out

    if "issues" in includes:
        rows = (
            db.query(IssueVendorLink.vendor_id, Issue.title, Issue.severity, Issue.workflow_state)
            .join(Issue, Issue.id == IssueVendorLink.issue_id)
            .filter(IssueVendorLink.vendor_id.in_(ids))
            .all()
        )
        for vid, title, sev, st in rows:
            b = out.setdefault(vid, {}).setdefault("issues", _bucket())
            _apply(b, title, severity=sev, is_open=_is_open_status(st))

    # Vendors ↔ risks is often via issues; expose risk counts through that path.
    if "risks" in includes:
        rows = (
            db.query(IssueVendorLink.vendor_id, Risk.title, Risk.closure_status)
            .join(IssueRiskLink, IssueRiskLink.issue_id == IssueVendorLink.issue_id)
            .join(Risk, Risk.id == IssueRiskLink.risk_id)
            .filter(IssueVendorLink.vendor_id.in_(ids))
            .all()
        )
        for vid, title, st in rows:
            b = out.setdefault(vid, {}).setdefault("risks", _bucket())
            _apply(b, title, is_open=_is_open_status(st))

    return out


def _enrich_gov_documents(db: Session, ids: List[int], includes: Set[str]) -> Dict[int, Dict[str, Dict[str, Any]]]:
    out: Dict[int, Dict[str, Dict[str, Any]]] = {}
    if not ids:
        return out

    if "risks" in includes:
        rows = (
            db.query(DocumentRiskLink.document_id, Risk.title, Risk.closure_status)
            .join(Risk, Risk.id == DocumentRiskLink.risk_id)
            .filter(DocumentRiskLink.document_id.in_(ids))
            .all()
        )
        for did, title, st in rows:
            b = out.setdefault(did, {}).setdefault("risks", _bucket())
            _apply(b, title, is_open=_is_open_status(st))

    if "controls" in includes:
        rows = (
            db.query(DocumentControlLink.document_id, NormalizedControl.name)
            .join(NormalizedControl, NormalizedControl.id == DocumentControlLink.normalized_control_id)
            .filter(DocumentControlLink.document_id.in_(ids))
            .all()
        )
        for did, name in rows:
            b = out.setdefault(did, {}).setdefault("controls", _bucket())
            _apply(b, name)

    if "assets" in includes:
        rows = (
            db.query(DocumentAssetLink.document_id, ITAsset.name)
            .join(ITAsset, ITAsset.id == DocumentAssetLink.asset_id)
            .filter(DocumentAssetLink.document_id.in_(ids))
            .all()
        )
        for did, name in rows:
            b = out.setdefault(did, {}).setdefault("assets", _bucket())
            _apply(b, name)

    return out


def _enrich_tasks(db: Session, ids: List[int], includes: Set[str]) -> Dict[int, Dict[str, Dict[str, Any]]]:
    out: Dict[int, Dict[str, Dict[str, Any]]] = {}
    if not ids:
        return out

    tasks = db.query(CriticalTask).filter(CriticalTask.id.in_(ids)).all()
    risk_ids = {t.linked_risk_id for t in tasks if t.linked_risk_id}
    vuln_ids = {t.linked_vulnerability_id for t in tasks if t.linked_vulnerability_id}
    issue_ids = {t.linked_issue_id for t in tasks if t.linked_issue_id}
    asset_ids = {
        t.source_entity_id for t in tasks
        if t.source_entity_id and str(t.source_entity_type or "").lower() in {"asset", "it_asset", "itasset"}
    }

    risks_by_id = {
        r.id: r for r in db.query(Risk).filter(Risk.id.in_(risk_ids)).all()
    } if risk_ids and "risks" in includes else {}
    vulns_by_id = {
        v.id: v for v in db.query(Vulnerability).filter(Vulnerability.id.in_(vuln_ids)).all()
    } if vuln_ids and "vulnerabilities" in includes else {}
    issues_by_id = {
        i.id: i for i in db.query(Issue).filter(Issue.id.in_(issue_ids)).all()
    } if issue_ids and "issues" in includes else {}
    assets_by_id = {
        a.id: a for a in db.query(ITAsset).filter(ITAsset.id.in_(asset_ids)).all()
    } if asset_ids and "assets" in includes else {}

    for t in tasks:
        if "risks" in includes and t.linked_risk_id and t.linked_risk_id in risks_by_id:
            r = risks_by_id[t.linked_risk_id]
            b = out.setdefault(t.id, {}).setdefault("risks", _bucket())
            _apply(b, r.title, is_open=_is_open_status(r.closure_status))
        if "vulnerabilities" in includes and t.linked_vulnerability_id and t.linked_vulnerability_id in vulns_by_id:
            v = vulns_by_id[t.linked_vulnerability_id]
            b = out.setdefault(t.id, {}).setdefault("vulnerabilities", _bucket())
            _apply(b, v.title, severity=v.severity, is_open=_is_open_status(v.status))
        if "issues" in includes and t.linked_issue_id and t.linked_issue_id in issues_by_id:
            i = issues_by_id[t.linked_issue_id]
            b = out.setdefault(t.id, {}).setdefault("issues", _bucket())
            _apply(b, i.title, severity=getattr(i, "severity", None), is_open=_is_open_status(getattr(i, "workflow_state", None)))
        if "assets" in includes and t.source_entity_id and t.source_entity_id in assets_by_id:
            a = assets_by_id[t.source_entity_id]
            b = out.setdefault(t.id, {}).setdefault("assets", _bucket())
            _apply(b, a.name)

    return out


def _enrich_kris(db: Session, ids: List[int], includes: Set[str]) -> Dict[int, Dict[str, Dict[str, Any]]]:
    out: Dict[int, Dict[str, Dict[str, Any]]] = {}
    if not ids or "risks" not in includes:
        return out

    rows = (
        db.query(RiskKRI.id, Risk.title, Risk.closure_status)
        .join(Risk, Risk.id == RiskKRI.risk_id)
        .filter(RiskKRI.id.in_(ids), RiskKRI.risk_id.isnot(None))
        .all()
    )
    for kid, title, st in rows:
        b = out.setdefault(kid, {}).setdefault("risks", _bucket())
        _apply(b, title, is_open=_is_open_status(st))
    return out


def _enrich_is_projects(db: Session, ids: List[int], includes: Set[str]) -> Dict[int, Dict[str, Dict[str, Any]]]:
    out: Dict[int, Dict[str, Dict[str, Any]]] = {}
    if not ids:
        return out

    projects = db.query(ISProject).filter(ISProject.id.in_(ids)).all()
    if "risks" in includes:
        risk_ids: Set[int] = set()
        for p in projects:
            for rid in (p.linked_risks or []):
                try:
                    risk_ids.add(int(rid))
                except (TypeError, ValueError):
                    continue
        risks_by_id = {
            r.id: r for r in db.query(Risk).filter(Risk.id.in_(risk_ids)).all()
        } if risk_ids else {}
        for p in projects:
            for rid in (p.linked_risks or []):
                try:
                    risk = risks_by_id.get(int(rid))
                except (TypeError, ValueError):
                    continue
                if not risk:
                    continue
                b = out.setdefault(p.id, {}).setdefault("risks", _bucket())
                _apply(b, risk.title, is_open=_is_open_status(risk.closure_status))

    if "controls" in includes:
        control_ids: Set[int] = set()
        for p in projects:
            for cid in (p.linked_controls or []):
                try:
                    control_ids.add(int(cid))
                except (TypeError, ValueError):
                    continue
        controls_by_id = {
            c.id: c for c in db.query(NormalizedControl).filter(NormalizedControl.id.in_(control_ids)).all()
        } if control_ids else {}
        for p in projects:
            for cid in (p.linked_controls or []):
                try:
                    ctrl = controls_by_id.get(int(cid))
                except (TypeError, ValueError):
                    continue
                if not ctrl:
                    continue
                b = out.setdefault(p.id, {}).setdefault("controls", _bucket())
                _apply(b, ctrl.name)

    return out


_ENRICHERS = {
    "assets": _enrich_assets,
    "risks": _enrich_risks,
    "vulnerabilities": _enrich_vulnerabilities,
    "evidence": _enrich_evidence,
    "controls": _enrich_controls,
    "issues": _enrich_issues,
    "incidents": _enrich_incidents,
    "vendors": _enrich_vendors,
    "gov_documents": _enrich_gov_documents,
    "tasks": _enrich_tasks,
    "kris": _enrich_kris,
    "is_projects": _enrich_is_projects,
}


def enrich_rows(
    db: Session,
    *,
    dataset: str,
    rows: List[Dict[str, Any]],
    includes: List[str],
    project: Optional[List[str]] = None,
) -> List[Dict[str, Any]]:
    """Merge linkage columns into report rows. Safe to call with empty includes."""
    if not rows or not includes:
        return rows

    # Accept any include key (open catalog) — not only the legacy LINKAGE_CATALOG.
    from .report_open_catalog import enrich_xmod_fields

    seen: Set[str] = set()
    valid: List[str] = []
    for i in includes:
        if not i or i == dataset or i in seen:
            continue
        seen.add(i)
        valid.append(i)
    if not valid:
        return rows

    enricher = _ENRICHERS.get(dataset)
    buckets: Dict[int, Dict[str, Dict[str, Any]]] = {}
    if enricher is not None:
        ids: List[int] = []
        for r in rows:
            try:
                ids.append(int(r.get("id")))
            except (TypeError, ValueError):
                continue
        catalog_keys = {e["key"] for e in get_linkage_catalog(dataset)}
        legacy_includes = [i for i in valid if i in catalog_keys]
        if ids and legacy_includes:
            try:
                buckets = enricher(db, ids, set(legacy_includes))
            except Exception:  # noqa: BLE001
                buckets = {}

    merged: List[Dict[str, Any]] = []
    for r in rows:
        try:
            rid = int(r.get("id"))
        except (TypeError, ValueError):
            row = dict(r)
            for link_key in valid:
                prefix = f"link_{link_key}"
                row.setdefault(f"{prefix}_count", 0)
                row.setdefault(f"{prefix}_names", "")
                row.setdefault(f"{prefix}_open_count", 0)
            merged.append(row)
            continue
        row = dict(r)
        for link_key, bucket in (buckets.get(rid) or {}).items():
            row.update(_flatten_link(rid, link_key, bucket))
        for link_key in valid:
            prefix = f"link_{link_key}"
            row.setdefault(f"{prefix}_count", 0)
            row.setdefault(f"{prefix}_names", "")
            row.setdefault(f"{prefix}_open_count", 0)
        merged.append(row)

    # Open-ended field projection (any column from any linked module)
    return enrich_xmod_fields(
        db, dataset=dataset, rows=merged, includes=valid, project=project,
    )