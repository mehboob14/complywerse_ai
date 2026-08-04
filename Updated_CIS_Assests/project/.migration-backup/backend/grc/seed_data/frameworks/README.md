# Pre-Seeded Framework Data

This directory contains JSON files with pre-parsed regulatory framework data. These frameworks are automatically loaded into the database on application startup.

## Framework Classifications

### Certification Frameworks (require formal audit/certificate)
- swift_cscf.json - SWIFT Customer Security Controls Framework
- pci_dss.json - Payment Card Industry Data Security Standard

### Compliance Frameworks (regulatory requirements)
- sama_csf.json - SAMA Cyber Security Framework
- sbp_cloud.json - SBP Cloud Outsourcing Framework
- sbp_internet_banking.json - SBP Internet Banking Framework
- sabic_cybertrust.json - SABIC CyberTrust Guidelines
- aramco_ccc.json - ARAMCO Cybersecurity Compliance Certification
- gdpr.json - General Data Protection Regulation
- nist_csf.json - NIST Cybersecurity Framework

## JSON Structure

Each framework JSON file contains:
```json
{
  "metadata": {
    "name": "Framework Name",
    "version": "1.0",
    "classification": "certification|compliance",
    "framework_type": "certification|regulatory",
    "source_organization": "Issuing Body",
    "effective_date": "2024-01-01",
    
    // For certification frameworks
    "certification_body": "Certifying Organization",
    "certification_validity_period": "3 years",
    "certification_levels": ["Level 1", "Level 2"],
    "certification_lifecycle": ["Gap Assessment", "Implementation", "Audit", "Certification"],
    "required_artifacts": ["Policies", "Procedures", "Evidence"],
    
    // For compliance frameworks
    "regulatory_authority": "Regulatory Body",
    "compliance_deadline": "2025-01-01",
    "adoption_approach": "Phased implementation",
    
    // Common metadata
    "framework_purpose": "Purpose description",
    "framework_scope": "Scope description",
    "framework_objectives": "Objectives description",
    "target_audience": "Target audience"
  },
  "controls": [
    {
      "control_id": "1.1",
      "original_reference": "Section 1.1",
      "title": "Control Title",
      "description": "Control description",
      "full_text": "Full requirement text",
      "domain": "Domain Name",
      "category": "Category Name",
      "section_number": "1.1",
      "parent_section": "1",
      "is_mandatory": true,
      "priority": "high|medium|low",
      "evidence_requirements": ["Evidence 1", "Evidence 2"]
    }
  ]
}
```

## Generating JSON Files

To generate JSON files from uploaded frameworks:
1. Upload the framework PDF through the UI
2. Parse the framework using the AI parser
3. Run the export script: `python backend/grc/scripts/export_frameworks_to_json.py`

The export script will create JSON files in this directory.
