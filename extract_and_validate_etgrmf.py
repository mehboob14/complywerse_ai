#!/usr/bin/env python3
"""
SBPL ETGRMF Framework Extraction and Validation Script

Extracts control details from the PDF, compares against seed JSON, 
and identifies all mismatches in titles, descriptions, full text, and evidence requirements.
"""

import json
import re
import sys
from pathlib import Path
from typing import Dict, List, Any, Tuple

try:
    import fitz  # PyMuPDF
    PDF_AVAILABLE = True
except ImportError:
    try:
        from PyPDF2 import PdfReader
        PDF_AVAILABLE = True
    except ImportError:
        PDF_AVAILABLE = False
        print("⚠️ PDF libraries not available. Attempting to install...")
        import subprocess
        subprocess.check_call([sys.executable, "-m", "pip", "install", "PyMuPDF"])
        import fitz
        PDF_AVAILABLE = True


def extract_pdf_text(pdf_path: str) -> str:
    """Extract all text from PDF using PyMuPDF."""
    try:
        doc = fitz.open(pdf_path)
        text = ""
        for page_num in range(len(doc)):
            page = doc[page_num]
            text += page.get_text()
        return text
    except Exception as e:
        print(f"❌ Error extracting PDF: {e}")
        return ""


def parse_controls_from_text(text: str) -> Dict[str, Dict[str, str]]:
    """
    Parse controls from PDF text.
    Expects format like:
    1.1.a Title here
    Full text description...
    
    1.1.b Title here
    Full text description...
    """
    controls = {}
    
    # Split by control patterns: X.Y.Z or X.Y.Z[.a-z]
    # Match patterns like: 1.1.a, 1.1.b, 1.2.a, 2.1.x, etc.
    control_pattern = r'(\d+\.\d+(?:\.\d+)?(?:[a-z])?)\s*([^\n]+)\n(.*?)(?=\n(?:\d+\.\d+(?:\.\d+)?(?:[a-z])?)\s|$)'
    
    matches = re.finditer(control_pattern, text, re.DOTALL | re.IGNORECASE)
    
    for match in matches:
        control_id = match.group(1).strip()
        title = match.group(2).strip()
        full_text = match.group(3).strip()
        
        # Clean up full text
        full_text = re.sub(r'\s+', ' ', full_text)[:2000]  # Limit to 2000 chars
        
        if control_id and title:
            controls[control_id] = {
                "title": title,
                "full_text": full_text[:1000] if full_text else "",
                "description": full_text[:200] if full_text else ""
            }
    
    return controls


def load_json_controls(json_path: str) -> Dict[str, Dict[str, str]]:
    """Load controls from seed JSON file."""
    try:
        with open(json_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        
        controls = {}
        for control in data.get("controls", []):
            control_id = control.get("control_id", "")
            if control_id:
                controls[control_id] = control
        
        return controls
    except Exception as e:
        print(f"❌ Error loading JSON: {e}")
        return {}


def compare_controls(pdf_controls: Dict, json_controls: Dict) -> Tuple[Dict, List]:
    """
    Compare PDF-extracted controls with JSON controls.
    Returns (mismatches, missing_evidence).
    """
    mismatches = {}
    missing_evidence = []
    
    # Check all JSON controls against PDF
    for control_id, json_control in json_controls.items():
        if control_id not in pdf_controls:
            mismatches[control_id] = {
                "issue": "CONTROL_NOT_FOUND_IN_PDF",
                "json": json_control
            }
            continue
        
        pdf_control = pdf_controls[control_id]
        control_issues = {}
        
        # Compare fields
        json_title = json_control.get("title", "").strip()
        pdf_title = pdf_control.get("title", "").strip()
        
        if json_title.lower() != pdf_title.lower():
            control_issues["title_mismatch"] = {
                "json": json_title,
                "pdf": pdf_title
            }
        
        json_desc = json_control.get("description", "").strip()
        pdf_desc = pdf_control.get("description", "").strip()
        
        if json_desc.lower() != pdf_desc.lower():
            control_issues["description_mismatch"] = {
                "json": json_desc[:100],
                "pdf": pdf_desc[:100]
            }
        
        json_full = json_control.get("full_text", "").strip()
        pdf_full = pdf_control.get("full_text", "").strip()
        
        if json_full.lower() != pdf_full.lower():
            control_issues["full_text_mismatch"] = {
                "json": json_full[:100],
                "pdf": pdf_full[:100]
            }
        
        # Check evidence requirements
        evidence = json_control.get("evidence_requirements", [])
        if not evidence or len(evidence) == 0:
            missing_evidence.append({
                "control_id": control_id,
                "title": json_title,
                "issue": "NO_EVIDENCE_REQUIREMENTS"
            })
        
        if control_issues:
            mismatches[control_id] = {
                "issues": control_issues,
                "json": json_control,
                "pdf": pdf_control
            }
    
    # Check for controls in PDF but not in JSON
    for control_id in pdf_controls:
        if control_id not in json_controls:
            mismatches[control_id] = {
                "issue": "MISSING_IN_JSON",
                "pdf": pdf_controls[control_id]
            }
    
    return mismatches, missing_evidence


def generate_report(mismatches: Dict, missing_evidence: List) -> str:
    """Generate a detailed comparison report."""
    report = []
    report.append("=" * 80)
    report.append("SBPL ETGRMF FRAMEWORK VALIDATION REPORT")
    report.append("=" * 80)
    report.append("")
    
    # Summary
    report.append(f"Total Mismatches Found: {len(mismatches)}")
    report.append(f"Controls Missing Evidence: {len(missing_evidence)}")
    report.append("")
    
    # Detailed mismatches
    if mismatches:
        report.append("DETAILED MISMATCHES:")
        report.append("-" * 80)
        for control_id, details in sorted(mismatches.items()):
            report.append(f"\n🔴 Control ID: {control_id}")
            if "issue" in details:
                report.append(f"   Issue: {details['issue']}")
            elif "issues" in details:
                for issue_type, issue_data in details["issues"].items():
                    report.append(f"   ❌ {issue_type}")
                    if isinstance(issue_data, dict):
                        report.append(f"      JSON: {issue_data.get('json', 'N/A')[:80]}")
                        report.append(f"      PDF:  {issue_data.get('pdf', 'N/A')[:80]}")
    
    # Missing evidence
    if missing_evidence:
        report.append("\n" + "=" * 80)
        report.append("CONTROLS WITH MISSING EVIDENCE REQUIREMENTS:")
        report.append("-" * 80)
        for item in missing_evidence:
            report.append(f"\n⚠️  {item['control_id']}: {item['title']}")
            report.append(f"    Issue: {item['issue']}")
    
    report.append("\n" + "=" * 80)
    return "\n".join(report)


def main():
    """Main execution."""
    # File paths
    pdf_path = r"c:\Users\Admin\Documents\GRC-Tenant\backend\grc\seed_data\frameworks\SBP ETGRMF.pdf"
    json_path = r"c:\Users\Admin\Documents\GRC-Tenant\backend\grc\seed_data\frameworks\sbp_etgrmf.json"
    
    print("🔍 Starting SBPL ETGRMF Framework Validation...\n")
    
    # Step 1: Extract from PDF
    print(f"📄 Extracting text from PDF: {pdf_path}")
    pdf_text = extract_pdf_text(pdf_path)
    print(f"✅ Extracted {len(pdf_text)} characters from PDF\n")
    
    # Step 2: Parse controls from PDF
    print("🔨 Parsing controls from PDF text...")
    pdf_controls = parse_controls_from_text(pdf_text)
    print(f"✅ Found {len(pdf_controls)} controls in PDF\n")
    
    # Step 3: Load JSON controls
    print(f"📋 Loading controls from JSON: {json_path}")
    json_controls = load_json_controls(json_path)
    print(f"✅ Found {len(json_controls)} controls in JSON\n")
    
    # Step 4: Compare
    print("⚖️  Comparing controls...")
    mismatches, missing_evidence = compare_controls(pdf_controls, json_controls)
    print(f"✅ Comparison complete\n")
    
    # Step 5: Generate report
    report = generate_report(mismatches, missing_evidence)
    print(report)
    
    # Save report
    report_path = r"c:\Users\Admin\Documents\GRC-Tenant\ETGRMF_VALIDATION_REPORT.txt"
    with open(report_path, 'w', encoding='utf-8') as f:
        f.write(report)
    print(f"\n📊 Report saved to: {report_path}")
    
    # Export details as JSON for detailed analysis
    details = {
        "summary": {
            "total_mismatches": len(mismatches),
            "missing_evidence_count": len(missing_evidence),
            "pdf_controls_count": len(pdf_controls),
            "json_controls_count": len(json_controls)
        },
        "mismatches": mismatches,
        "missing_evidence": missing_evidence,
        "pdf_controls_sample": {k: v for k, v in list(pdf_controls.items())[:3]}
    }
    
    details_path = r"c:\Users\Admin\Documents\GRC-Tenant\ETGRMF_VALIDATION_DETAILS.json"
    with open(details_path, 'w', encoding='utf-8') as f:
        json.dump(details, f, indent=2, ensure_ascii=False)
    print(f"📋 Details saved to: {details_path}\n")
    
    print("✨ Validation complete!")


if __name__ == "__main__":
    main()
