"""
Migration script to populate ControlEvidenceRequirement records from existing ParsedFrameworkControl data.

This script reads the evidence_requirements JSON field from each control and creates
corresponding ControlEvidenceRequirement records in the dedicated table.

Run with: cd backend && python -m grc.scripts.populate_evidence_requirements
"""

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from grc.models import (
    SessionLocal, UploadedFramework, ParsedFrameworkControl, 
    ControlEvidenceRequirement
)
from datetime import datetime


def _infer_evidence_type(evidence_text: str) -> str:
    """Infer evidence type from description text."""
    text_lower = evidence_text.lower()
    if any(kw in text_lower for kw in ["policy", "policies"]):
        return "policy"
    elif any(kw in text_lower for kw in ["procedure", "process", "sop"]):
        return "procedure"
    elif any(kw in text_lower for kw in ["log", "logs", "audit trail"]):
        return "log"
    elif any(kw in text_lower for kw in ["screenshot", "screen capture"]):
        return "screenshot"
    elif any(kw in text_lower for kw in ["config", "configuration", "settings"]):
        return "configuration"
    elif any(kw in text_lower for kw in ["report", "assessment", "review"]):
        return "report"
    elif any(kw in text_lower for kw in ["contract", "agreement", "sla"]):
        return "contract"
    elif any(kw in text_lower for kw in ["attestation", "sign", "acknowledge"]):
        return "attestation"
    elif any(kw in text_lower for kw in ["certificate", "certification"]):
        return "certificate"
    elif any(kw in text_lower for kw in ["training", "awareness"]):
        return "training"
    else:
        return "document"


def _infer_collection_frequency(evidence_text: str) -> str:
    """Infer collection frequency from description text."""
    text_lower = evidence_text.lower()
    if any(kw in text_lower for kw in ["annual", "yearly"]):
        return "annually"
    elif any(kw in text_lower for kw in ["quarter", "quarterly"]):
        return "quarterly"
    elif any(kw in text_lower for kw in ["month", "monthly"]):
        return "monthly"
    elif any(kw in text_lower for kw in ["daily", "continuous"]):
        return "continuous"
    elif any(kw in text_lower for kw in ["change", "update", "modify"]):
        return "on-change"
    else:
        return "annually"


def populate_evidence_requirements():
    """Populate ControlEvidenceRequirement table from existing control data."""
    db = SessionLocal()
    
    try:
        # Get all frameworks
        frameworks = db.query(UploadedFramework).all()
        print(f"Found {len(frameworks)} frameworks")
        
        total_created = 0
        
        for framework in frameworks:
            # Check if this framework already has evidence requirements
            existing_count = db.query(ControlEvidenceRequirement).filter(
                ControlEvidenceRequirement.framework_id == framework.id
            ).count()
            
            if existing_count > 0:
                print(f"  {framework.name}: Already has {existing_count} evidence requirements, skipping...")
                continue
            
            # Get all controls for this framework
            controls = db.query(ParsedFrameworkControl).filter(
                ParsedFrameworkControl.uploaded_framework_id == framework.id
            ).all()
            
            framework_evidence_count = 0
            
            for control in controls:
                evidence_reqs = control.evidence_requirements or []
                
                for idx, ev_req in enumerate(evidence_reqs):
                    if isinstance(ev_req, str):
                        # Simple string format
                        evidence_record = ControlEvidenceRequirement(
                            framework_id=framework.id,
                            parsed_control_id=control.id,
                            evidence_title=ev_req[:500] if len(ev_req) > 500 else ev_req,
                            evidence_description=ev_req,
                            evidence_type=_infer_evidence_type(ev_req),
                            evidence_format="document",
                            exact_requirements=[ev_req],
                            acceptance_criteria=["Document is current and complete", "Properly approved/signed as required"],
                            collection_guidance="Collect from relevant system or department",
                            collection_frequency=_infer_collection_frequency(ev_req),
                            retention_period="3 years",
                            ai_confidence=0.85,
                            ai_reasoning="Generated from framework seeding",
                            status="draft",
                            priority=control.priority or "medium",
                            display_order=idx + 1,
                            is_mandatory=True,
                            is_active=True
                        )
                    elif isinstance(ev_req, dict):
                        # Dict format with full details
                        evidence_record = ControlEvidenceRequirement(
                            framework_id=framework.id,
                            parsed_control_id=control.id,
                            evidence_title=ev_req.get("title", ev_req.get("evidence_title", "Evidence Required"))[:500],
                            evidence_description=ev_req.get("description", ev_req.get("evidence_description", "")),
                            evidence_type=ev_req.get("type", ev_req.get("evidence_type", "document")),
                            evidence_format=ev_req.get("format", ev_req.get("evidence_format", "document")),
                            exact_requirements=ev_req.get("exact_requirements", []),
                            acceptance_criteria=ev_req.get("acceptance_criteria", []),
                            sample_evidence=ev_req.get("sample_evidence"),
                            collection_guidance=ev_req.get("collection_guidance"),
                            collection_frequency=ev_req.get("collection_frequency", "annually"),
                            retention_period=ev_req.get("retention_period", "3 years"),
                            ai_confidence=ev_req.get("ai_confidence", 0.85),
                            ai_reasoning=ev_req.get("ai_reasoning", "Generated from framework seeding"),
                            status="draft",
                            priority=ev_req.get("priority", control.priority or "medium"),
                            display_order=idx + 1,
                            is_mandatory=ev_req.get("is_mandatory", True),
                            is_active=True
                        )
                    else:
                        continue
                    
                    db.add(evidence_record)
                    framework_evidence_count += 1
            
            print(f"  {framework.name}: Created {framework_evidence_count} evidence requirements")
            total_created += framework_evidence_count
        
        db.commit()
        print(f"\nTotal evidence requirements created: {total_created}")
        
    except Exception as e:
        db.rollback()
        print(f"Error: {e}")
        raise
    finally:
        db.close()


if __name__ == "__main__":
    print("=" * 60)
    print("Populating Evidence Requirements from Control Data")
    print("=" * 60)
    populate_evidence_requirements()
    print("\nDone!")
