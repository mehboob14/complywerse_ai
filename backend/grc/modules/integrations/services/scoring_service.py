import logging
from datetime import datetime
from typing import Any, Dict, List, Optional

from sqlalchemy.orm import Session

from grc.models import (
    ITAsset,
    Vulnerability,
    VulnerabilityControlLink,
)
from ..adapters.transformer import Rapid7Transformer, _compute_compliverse_severity
from ..adapters.nessus_transformer import NessusTransformer
from .analytics_service import SCANNER_SOURCES

logger = logging.getLogger(__name__)

CRITICALITY_SCORES = {
    "critical": 10.0,
    "high": 8.0,
    "medium": 5.0,
    "low": 3.0,
    "info": 1.0,
    "none": 5.0,
}


class ScoringService:

    @staticmethod
    def recalculate_vulnerability_score(
        db: Session,
        vulnerability_id: int,
        tenant_id: int,
    ) -> Dict[str, Any]:
        vuln = db.query(Vulnerability).filter(
            Vulnerability.id == vulnerability_id,
            Vulnerability.tenant_id == tenant_id,
        ).first()
        if not vuln:
            raise ValueError("Vulnerability not found")

        asset_criticality = ScoringService._get_asset_criticality(db, vuln)
        framework_impact = ScoringService._get_framework_impact(db, vuln)

        best_cvss = vuln.cvss_v3_score or vuln.cvss_v2_score or vuln.cvss_score or 0.0
        nexpose_risk = vuln.nexpose_risk_score or 0.0
        exploit_count = vuln.exploit_count or 0
        first_detected = vuln.first_detected or vuln.discovered_at

        is_nessus = getattr(vuln, 'source', '') == 'nessus'
        if is_nessus:
            scanner_severity_int = {"critical": 4, "high": 3, "medium": 2, "low": 1, "info": 0}.get(
                (vuln.scanner_severity or "").lower(), 0
            )
            composite = NessusTransformer.compute_composite_risk(
                cvss_score=best_cvss,
                nessus_severity=scanner_severity_int,
                asset_criticality=asset_criticality,
                framework_impact=framework_impact,
                exploit_count=exploit_count,
                first_detected=first_detected,
            )
        else:
            composite = Rapid7Transformer.compute_composite_risk(
                cvss_score=best_cvss,
                nexpose_risk=nexpose_risk,
                asset_criticality=asset_criticality,
                framework_impact=framework_impact,
                exploit_count=exploit_count,
                first_detected=first_detected,
            )

        old_score = vuln.compliverse_risk_score
        old_severity = vuln.compliverse_severity

        vuln.compliverse_risk_score = composite
        vuln.compliverse_severity = _compute_compliverse_severity(composite)
        vuln.updated_at = datetime.utcnow()
        db.commit()

        return {
            "vulnerability_id": vuln.id,
            "vuln_id": vuln.vuln_id,
            "old_score": old_score,
            "new_score": composite,
            "old_severity": old_severity,
            "new_severity": vuln.compliverse_severity,
            "factors": {
                "cvss": best_cvss,
                "nexpose_risk": nexpose_risk,
                "asset_criticality": asset_criticality,
                "framework_impact": framework_impact,
                "exploit_count": exploit_count,
                "first_detected": first_detected.isoformat() if first_detected else None,
            },
        }

    @staticmethod
    def batch_recalculate(
        db: Session,
        tenant_id: int,
        connection_id: Optional[int] = None,
    ) -> Dict[str, Any]:
        query = db.query(Vulnerability).filter(
            Vulnerability.tenant_id == tenant_id,
            Vulnerability.source.in_(SCANNER_SOURCES),
        )
        if connection_id:
            query = query.filter(Vulnerability.connection_id == connection_id)

        vulns = query.all()
        updated = 0
        errors = 0

        for vuln in vulns:
            try:
                asset_criticality = ScoringService._get_asset_criticality(db, vuln)
                framework_impact = ScoringService._get_framework_impact(db, vuln)

                best_cvss = vuln.cvss_v3_score or vuln.cvss_v2_score or vuln.cvss_score or 0.0
                is_nessus_vuln = getattr(vuln, 'source', '') == 'nessus'
                if is_nessus_vuln:
                    sev_int = {"critical": 4, "high": 3, "medium": 2, "low": 1, "info": 0}.get(
                        (vuln.scanner_severity or "").lower(), 0
                    )
                    composite = NessusTransformer.compute_composite_risk(
                        cvss_score=best_cvss,
                        nessus_severity=sev_int,
                        asset_criticality=asset_criticality,
                        framework_impact=framework_impact,
                        exploit_count=vuln.exploit_count or 0,
                        first_detected=vuln.first_detected or vuln.discovered_at,
                    )
                else:
                    composite = Rapid7Transformer.compute_composite_risk(
                        cvss_score=best_cvss,
                        nexpose_risk=vuln.nexpose_risk_score or 0.0,
                        asset_criticality=asset_criticality,
                        framework_impact=framework_impact,
                        exploit_count=vuln.exploit_count or 0,
                        first_detected=vuln.first_detected or vuln.discovered_at,
                    )

                if vuln.compliverse_risk_score != composite:
                    vuln.compliverse_risk_score = composite
                    vuln.compliverse_severity = _compute_compliverse_severity(composite)
                    vuln.updated_at = datetime.utcnow()
                    updated += 1
            except Exception as e:
                logger.error(f"Error recalculating score for vuln {vuln.id}: {e}")
                errors += 1

        db.commit()
        return {"total": len(vulns), "updated": updated, "errors": errors}

    @staticmethod
    def _get_asset_criticality(db: Session, vuln: Vulnerability) -> float:
        if vuln.affected_host:
            asset = db.query(ITAsset).filter(
                ITAsset.tenant_id == vuln.tenant_id,
                ITAsset.external_asset_id == vuln.affected_host,
            ).first()
            if asset and asset.criticality:
                return CRITICALITY_SCORES.get(asset.criticality.lower(), 5.0)
        return 5.0

    @staticmethod
    def _get_framework_impact(db: Session, vuln: Vulnerability) -> float:
        links = db.query(VulnerabilityControlLink).filter(
            VulnerabilityControlLink.vulnerability_id == vuln.id,
            VulnerabilityControlLink.is_active == True,
        ).all()

        if not links:
            return 5.0

        impact_scores = []
        for link in links:
            impact = link.compliance_impact
            if impact == "non_compliant":
                impact_scores.append(10.0)
            elif impact == "partial":
                impact_scores.append(7.0)
            elif impact == "at_risk":
                impact_scores.append(5.0)
            else:
                impact_scores.append(6.0)

        count_factor = min(len(links) * 0.5, 2.0)
        avg_impact = sum(impact_scores) / len(impact_scores)
        return min(avg_impact + count_factor, 10.0)
