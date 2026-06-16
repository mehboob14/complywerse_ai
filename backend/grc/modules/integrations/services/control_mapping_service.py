from ....config import get_openai_api_key
import json
import logging
import os
from datetime import datetime
from typing import Any, Dict, List, Optional

from sqlalchemy.orm import Session

from grc.models import (
    FrameworkControl,
    NormalizedControl,
    Vulnerability,
    VulnerabilityControlLink,
)

from .analytics_service import SCANNER_SOURCES

logger = logging.getLogger(__name__)

CATEGORY_CONTROL_RULES = {
    "authentication": ["access control", "authentication", "identity"],
    "encryption": ["cryptography", "encryption", "data protection"],
    "network": ["network security", "firewall", "network"],
    "patch": ["patch management", "system maintenance", "vulnerability management"],
    "access": ["access control", "authorization", "privilege"],
    "configuration": ["configuration management", "hardening", "baseline"],
    "web": ["application security", "web security", "input validation"],
    "database": ["database security", "data protection", "information security"],
    "injection": ["input validation", "application security", "secure coding"],
    "xss": ["input validation", "application security", "output encoding"],
    "ssl": ["cryptography", "transport security", "certificate"],
    "tls": ["cryptography", "transport security", "certificate"],
    "ssh": ["access control", "remote access", "secure communication"],
    "privilege": ["access control", "privilege management", "least privilege"],
    "backup": ["backup", "business continuity", "disaster recovery"],
    "logging": ["logging", "monitoring", "audit trail"],
    "malware": ["malware protection", "antivirus", "endpoint security"],
}


class ControlMappingService:

    @staticmethod
    def rule_based_mapping(
        db: Session,
        vulnerability_id: int,
        tenant_id: int,
    ) -> List[Dict[str, Any]]:
        vuln = db.query(Vulnerability).filter(
            Vulnerability.id == vulnerability_id,
            Vulnerability.tenant_id == tenant_id,
        ).first()
        if not vuln:
            raise ValueError("Vulnerability not found")

        search_terms = set()
        categories = vuln.categories or []
        for cat in categories:
            cat_lower = cat.lower() if isinstance(cat, str) else ""
            for keyword, control_terms in CATEGORY_CONTROL_RULES.items():
                if keyword in cat_lower:
                    search_terms.update(control_terms)

        title_lower = (vuln.title or "").lower()
        desc_lower = (vuln.description or "").lower()
        combined = f"{title_lower} {desc_lower}"
        for keyword, control_terms in CATEGORY_CONTROL_RULES.items():
            if keyword in combined:
                search_terms.update(control_terms)

        if not search_terms:
            search_terms = {"vulnerability management", "security assessment"}

        matched_controls = []
        for term in search_terms:
            controls = db.query(FrameworkControl).filter(
                FrameworkControl.tenant_id == tenant_id,
                FrameworkControl.control_text.ilike(f"%{term}%"),
            ).limit(5).all()
            matched_controls.extend(controls)

        seen_ids = set()
        unique_controls = []
        for ctrl in matched_controls:
            if ctrl.id not in seen_ids:
                seen_ids.add(ctrl.id)
                unique_controls.append(ctrl)

        created_links = []
        for ctrl in unique_controls[:10]:
            existing = db.query(VulnerabilityControlLink).filter(
                VulnerabilityControlLink.vulnerability_id == vulnerability_id,
                VulnerabilityControlLink.framework_control_id == ctrl.id,
            ).first()
            if existing:
                continue

            confidence = 0.6
            if any(kw in (ctrl.control_text or "").lower() for kw in ["vulnerability", "patch", "remediation"]):
                confidence = 0.75

            link = VulnerabilityControlLink(
                vulnerability_id=vulnerability_id,
                framework_control_id=ctrl.id,
                compliance_impact="at_risk",
                mapping_source="rule",
                confidence_score=confidence,
                is_active=True,
                created_at=datetime.utcnow(),
            )
            db.add(link)
            created_links.append({
                "framework_control_id": ctrl.id,
                "control_id": ctrl.control_id,
                "control_text": (ctrl.control_text or "")[:200],
                "confidence": confidence,
                "source": "rule",
            })

        db.commit()
        return created_links

    @staticmethod
    def ai_based_mapping(
        db: Session,
        vulnerability_id: int,
        tenant_id: int,
    ) -> List[Dict[str, Any]]:
        vuln = db.query(Vulnerability).filter(
            Vulnerability.id == vulnerability_id,
            Vulnerability.tenant_id == tenant_id,
        ).first()
        if not vuln:
            raise ValueError("Vulnerability not found")

        api_key = get_openai_api_key()
        base_url = os.environ.get("AI_INTEGRATIONS_OPENAI_BASE_URL")

        if not api_key or len(api_key) < 20:
            logger.warning("OpenAI API key not available, falling back to rule-based mapping")
            return ControlMappingService.rule_based_mapping(db, vulnerability_id, tenant_id)

        try:
            import openai
        except ImportError:
            logger.error("openai package not installed")
            return ControlMappingService.rule_based_mapping(db, vulnerability_id, tenant_id)

        controls = db.query(FrameworkControl).filter(
            FrameworkControl.tenant_id == tenant_id,
        ).limit(200).all()

        if not controls:
            return []

        controls_text = "\n".join([
            f"ID:{c.id} | {c.control_id} | {(c.control_text or '')[:150]}"
            for c in controls
        ])

        vuln_info = (
            f"Title: {vuln.title}\n"
            f"Description: {(vuln.description or '')[:500]}\n"
            f"CVEs: {', '.join(vuln.cve_ids or [])}\n"
            f"Categories: {', '.join(vuln.categories or [])}\n"
            f"Severity: {vuln.compliverse_severity or vuln.severity}\n"
            f"CVSS: {vuln.cvss_v3_score or vuln.cvss_score or 'N/A'}"
        )

        prompt = f"""You are a Senior GRC Compliance Expert. Analyze this vulnerability and identify which framework controls it impacts.

VULNERABILITY:
{vuln_info}

AVAILABLE CONTROLS (ID | Control ID | Description):
{controls_text}

INSTRUCTIONS:
1. Identify controls that this vulnerability directly or indirectly impacts
2. For each matched control, assess the compliance impact
3. Return ONLY a valid JSON array

Return format:
[
  {{"control_db_id": <integer ID>, "compliance_impact": "<non_compliant|partial|at_risk>", "confidence": <0.5-1.0>, "reasoning": "<brief reason>"}}
]

CRITICAL: Only use control IDs from the list above. Return an empty array [] if no controls match. Maximum 10 mappings."""

        try:
            client_kwargs = {"api_key": api_key}
            if base_url:
                client_kwargs["base_url"] = base_url

            client = openai.OpenAI(**client_kwargs)
            response = client.chat.completions.create(
                model="gpt-4o",
                messages=[{"role": "user", "content": prompt}],
                temperature=0.2,
                max_tokens=2000,
            )

            content = response.choices[0].message.content.strip()
            if content.startswith("```"):
                content = content.split("```")[1]
                if content.startswith("json"):
                    content = content[4:]
                content = content.strip()

            mappings = json.loads(content)
            if not isinstance(mappings, list):
                mappings = []

        except Exception as e:
            logger.error(f"AI mapping failed: {e}")
            return ControlMappingService.rule_based_mapping(db, vulnerability_id, tenant_id)

        valid_control_ids = {c.id for c in controls}
        created_links = []

        for mapping in mappings[:10]:
            ctrl_id = mapping.get("control_db_id")
            if ctrl_id not in valid_control_ids:
                continue

            existing = db.query(VulnerabilityControlLink).filter(
                VulnerabilityControlLink.vulnerability_id == vulnerability_id,
                VulnerabilityControlLink.framework_control_id == ctrl_id,
            ).first()
            if existing:
                if existing.mapping_source == "rule":
                    existing.mapping_source = "ai"
                    existing.confidence_score = mapping.get("confidence", 0.7)
                    existing.compliance_impact = mapping.get("compliance_impact", "at_risk")
                    existing.notes = mapping.get("reasoning", "")[:500]
                    existing.is_active = True
                continue

            ctrl = db.query(FrameworkControl).filter(FrameworkControl.id == ctrl_id).first()

            link = VulnerabilityControlLink(
                vulnerability_id=vulnerability_id,
                framework_control_id=ctrl_id,
                compliance_impact=mapping.get("compliance_impact", "at_risk"),
                mapping_source="ai",
                confidence_score=mapping.get("confidence", 0.7),
                notes=mapping.get("reasoning", "")[:500],
                is_active=True,
                created_at=datetime.utcnow(),
            )
            db.add(link)
            created_links.append({
                "framework_control_id": ctrl_id,
                "control_id": ctrl.control_id if ctrl else str(ctrl_id),
                "compliance_impact": mapping.get("compliance_impact", "at_risk"),
                "confidence": mapping.get("confidence", 0.7),
                "reasoning": mapping.get("reasoning", ""),
                "source": "ai",
            })

        db.commit()
        return created_links

    @staticmethod
    def auto_map_vulnerability(
        db: Session,
        vulnerability_id: int,
        tenant_id: int,
        use_ai: bool = True,
    ) -> Dict[str, Any]:
        rule_results = ControlMappingService.rule_based_mapping(db, vulnerability_id, tenant_id)

        ai_results = []
        if use_ai and len(rule_results) < 3:
            ai_results = ControlMappingService.ai_based_mapping(db, vulnerability_id, tenant_id)

        return {
            "vulnerability_id": vulnerability_id,
            "rule_mappings": len(rule_results),
            "ai_mappings": len(ai_results),
            "total_mappings": len(rule_results) + len(ai_results),
            "rule_results": rule_results,
            "ai_results": ai_results,
        }

    @staticmethod
    def batch_auto_map(
        db: Session,
        tenant_id: int,
        connection_id: Optional[int] = None,
        use_ai: bool = False,
        limit: int = 50,
    ) -> Dict[str, Any]:
        from sqlalchemy import func

        mapped_vuln_ids = db.query(VulnerabilityControlLink.vulnerability_id).distinct().subquery()

        query = db.query(Vulnerability).filter(
            Vulnerability.tenant_id == tenant_id,
            Vulnerability.source.in_(SCANNER_SOURCES),
            ~Vulnerability.id.in_(mapped_vuln_ids),
        )
        if connection_id:
            query = query.filter(Vulnerability.connection_id == connection_id)

        unmapped = query.limit(limit).all()
        total_mapped = 0
        errors = 0

        for vuln in unmapped:
            try:
                result = ControlMappingService.auto_map_vulnerability(
                    db, vuln.id, tenant_id, use_ai=use_ai,
                )
                total_mapped += result["total_mappings"]
            except Exception as e:
                logger.error(f"Error mapping vuln {vuln.id}: {e}")
                errors += 1

        return {
            "vulns_processed": len(unmapped),
            "total_mappings_created": total_mapped,
            "errors": errors,
        }
