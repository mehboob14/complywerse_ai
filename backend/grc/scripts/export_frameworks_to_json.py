#!/usr/bin/env python3
"""
Export Script for GRC Frameworks

Exports already-parsed frameworks from the database to JSON files
that can be used for seeding new environments.

Usage:
    python -m backend.grc.scripts.export_frameworks_to_json
    
    # Or from the backend directory:
    cd backend && python -m grc.scripts.export_frameworks_to_json
"""

import json
import os
import sys
from datetime import datetime
from typing import Optional

# Add the parent directories to path for imports
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from grc.models import SessionLocal, UploadedFramework, ParsedFrameworkControl


def export_framework_to_json(framework_id: int, output_dir: str = None) -> Optional[str]:
    """
    Export a single framework and its controls to a JSON file.
    
    Args:
        framework_id: The ID of the UploadedFramework to export
        output_dir: Directory to save the JSON file (defaults to seed_data/frameworks)
        
    Returns:
        Path to the created JSON file, or None if framework not found
    """
    if output_dir is None:
        output_dir = os.path.join(
            os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
            "seed_data", "frameworks"
        )
    
    os.makedirs(output_dir, exist_ok=True)
    
    db = SessionLocal()
    try:
        framework = db.query(UploadedFramework).filter(
            UploadedFramework.id == framework_id
        ).first()
        
        if not framework:
            print(f"Framework with ID {framework_id} not found")
            return None
        
        controls = db.query(ParsedFrameworkControl).filter(
            ParsedFrameworkControl.uploaded_framework_id == framework_id
        ).order_by(ParsedFrameworkControl.id).all()
        
        # Build the export data structure
        export_data = {
            "metadata": {
                "name": framework.name,
                "description": framework.description,
                "version": framework.version,
                "source_organization": framework.source_organization,
                "effective_date": framework.effective_date.isoformat() if framework.effective_date else None,
                
                # Classification fields
                "classification": framework.classification or "compliance",
                "framework_type": framework.framework_type or "regulatory",
                "classification_confidence": framework.classification_confidence,
                "classification_reasoning": framework.classification_reasoning,
                
                # Pre-processing overview
                "framework_purpose": framework.framework_purpose,
                "framework_scope": framework.framework_scope,
                "framework_objectives": framework.framework_objectives,
                "target_audience": framework.target_audience,
                
                # Certification-specific fields
                "certification_body": framework.certification_body,
                "certification_validity_period": framework.certification_validity_period,
                "certification_levels": framework.certification_levels,
                "certification_lifecycle": framework.certification_lifecycle,
                "required_artifacts": framework.required_artifacts,
                
                # Compliance-specific fields
                "regulatory_authority": framework.regulatory_authority,
                "compliance_deadline": framework.compliance_deadline.isoformat() if framework.compliance_deadline else None,
                "penalty_for_non_compliance": framework.penalty_for_non_compliance,
                "adoption_approach": framework.adoption_approach,
                
                # Structure
                "hierarchy_structure": framework.hierarchy_structure,
                "document_structure": framework.document_structure,
                
                # Export metadata
                "exported_at": datetime.utcnow().isoformat(),
                "source_framework_id": framework.id,
                "total_controls": len(controls)
            },
            "controls": []
        }
        
        # Export each control
        for control in controls:
            control_data = {
                "control_id": control.control_id,
                "original_reference": control.original_reference,
                "title": control.title,
                "description": control.description,
                "full_text": control.full_text,
                "domain": control.domain,
                "category": control.category,
                "is_mandatory": control.is_mandatory,
                "priority": control.priority,
                "section_number": control.section_number,
                "parent_section": control.parent_section,
                "ai_confidence": control.ai_confidence,
                "ai_notes": control.ai_notes,
                "evidence_requirements": control.evidence_requirements or []
            }
            export_data["controls"].append(control_data)
        
        # Generate filename from framework name
        safe_name = framework.name.lower().replace(" ", "_").replace("-", "_")
        safe_name = "".join(c for c in safe_name if c.isalnum() or c == "_")
        output_file = os.path.join(output_dir, f"{safe_name}.json")
        
        with open(output_file, "w", encoding="utf-8") as f:
            json.dump(export_data, f, indent=2, ensure_ascii=False)
        
        print(f"Exported framework '{framework.name}' with {len(controls)} controls to {output_file}")
        return output_file
        
    except Exception as e:
        print(f"Error exporting framework {framework_id}: {e}")
        raise
    finally:
        db.close()


def export_all_frameworks(output_dir: str = None) -> list:
    """
    Export all parsed frameworks to JSON files.
    
    Args:
        output_dir: Directory to save the JSON files
        
    Returns:
        List of paths to created JSON files
    """
    if output_dir is None:
        output_dir = os.path.join(
            os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
            "seed_data", "frameworks"
        )
    
    db = SessionLocal()
    try:
        frameworks = db.query(UploadedFramework).filter(
            UploadedFramework.upload_status == "parsed"
        ).all()
        
        print(f"Found {len(frameworks)} parsed frameworks to export")
        
        exported_files = []
        for framework in frameworks:
            file_path = export_framework_to_json(framework.id, output_dir)
            if file_path:
                exported_files.append(file_path)
        
        return exported_files
        
    finally:
        db.close()


def export_specific_frameworks(framework_ids: list, output_dir: str = None) -> list:
    """
    Export specific frameworks by their IDs.
    
    Args:
        framework_ids: List of framework IDs to export
        output_dir: Directory to save the JSON files
        
    Returns:
        List of paths to created JSON files
    """
    exported_files = []
    for framework_id in framework_ids:
        file_path = export_framework_to_json(framework_id, output_dir)
        if file_path:
            exported_files.append(file_path)
    return exported_files


if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(description="Export GRC frameworks to JSON files")
    parser.add_argument(
        "--framework-ids",
        type=int,
        nargs="+",
        help="Specific framework IDs to export (exports all if not specified)"
    )
    parser.add_argument(
        "--output-dir",
        type=str,
        default=None,
        help="Output directory for JSON files (defaults to seed_data/frameworks)"
    )
    
    args = parser.parse_args()
    
    if args.framework_ids:
        files = export_specific_frameworks(args.framework_ids, args.output_dir)
    else:
        files = export_all_frameworks(args.output_dir)
    
    print(f"\nExported {len(files)} framework(s)")
    for f in files:
        print(f"  - {f}")
