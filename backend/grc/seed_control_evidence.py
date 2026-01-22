"""
Generates unique evidence requirements for each framework control based on control names and statements.
Uses control name pattern matching FIRST to ensure specific, relevant evidence for every control.
"""

from .models import SessionLocal, FrameworkControl, CuratedEvidenceItem

# CONTROL NAME EVIDENCE - Maps control NAME patterns to specific evidence
# This is checked FIRST before keyword matching to ensure relevant evidence
CONTROL_NAME_EVIDENCE = {
    # === ISO 27001 SPECIFIC CONTROLS ===
    "threat intelligence": [
        {"title": "Threat Intelligence Feed Configuration", "description": "Configuration of threat intelligence sources and feeds", "artifact_type": "configuration", "format_guidance": "SIEM/SOAR threat feed settings", "frequency": "quarterly"},
        {"title": "Threat Intelligence Reports", "description": "Reports from threat intelligence analysis", "artifact_type": "report", "format_guidance": "Threat analysis reports", "frequency": "monthly"},
        {"title": "IOC Database/Repository", "description": "Indicators of Compromise database or repository", "artifact_type": "configuration", "format_guidance": "IOC management system export", "frequency": "monthly"},
        {"title": "Threat Intelligence Sharing Agreements", "description": "Agreements for sharing threat intelligence with partners", "artifact_type": "record", "format_guidance": "Signed agreements or MoUs", "frequency": "annual"},
    ],
    "information transfer": [
        {"title": "Data Transfer Policy", "description": "Policy governing secure data transfers", "artifact_type": "policy", "format_guidance": "Approved policy document", "frequency": "annual"},
        {"title": "Data Transfer Log", "description": "Log of data transfers with recipients", "artifact_type": "log", "format_guidance": "Transfer tracking system export", "frequency": "monthly"},
        {"title": "Encryption in Transit Configuration", "description": "Configuration of encryption for data in transit", "artifact_type": "configuration", "format_guidance": "TLS/encryption settings", "frequency": "quarterly"},
    ],
    "collection of evidence": [
        {"title": "Digital Forensics Procedure", "description": "Procedure for collecting and preserving digital evidence", "artifact_type": "policy", "format_guidance": "Forensics procedure document", "frequency": "annual"},
        {"title": "Chain of Custody Forms", "description": "Forms documenting evidence handling", "artifact_type": "record", "format_guidance": "Completed chain of custody forms", "frequency": "as_needed"},
        {"title": "Forensic Tool Inventory", "description": "List of approved forensic tools", "artifact_type": "record", "format_guidance": "Tool inventory with versions", "frequency": "annual"},
    ],
    "classification of information": [
        {"title": "Data Classification Policy", "description": "Policy defining data classification levels", "artifact_type": "policy", "format_guidance": "Classification policy document", "frequency": "annual"},
        {"title": "Data Classification Matrix", "description": "Matrix showing data types and their classifications", "artifact_type": "record", "format_guidance": "Classification matrix spreadsheet", "frequency": "annual"},
        {"title": "Data Classification Training Records", "description": "Records of staff training on data classification", "artifact_type": "record", "format_guidance": "Training completion records", "frequency": "annual"},
    ],
    "labelling": [
        {"title": "Data Labeling Procedure", "description": "Procedure for labeling classified information", "artifact_type": "policy", "format_guidance": "Labeling procedure document", "frequency": "annual"},
        {"title": "Labeling Samples", "description": "Examples of properly labeled documents/data", "artifact_type": "record", "format_guidance": "Sample labeled documents", "frequency": "quarterly"},
        {"title": "Labeling Compliance Check", "description": "Verification that labeling is applied correctly", "artifact_type": "report", "format_guidance": "Labeling audit results", "frequency": "quarterly"},
    ],
    "identity management": [
        {"title": "Identity Lifecycle Policy", "description": "Policy for managing user identities through their lifecycle", "artifact_type": "policy", "format_guidance": "Identity management policy", "frequency": "annual"},
        {"title": "Identity Provisioning Procedure", "description": "Procedure for creating and managing identities", "artifact_type": "policy", "format_guidance": "Provisioning procedure document", "frequency": "annual"},
        {"title": "Identity Audit Report", "description": "Audit of user identities and their status", "artifact_type": "report", "format_guidance": "Identity management system report", "frequency": "quarterly"},
    ],
    "access rights": [
        {"title": "Access Rights Review Report", "description": "Report of periodic access rights review", "artifact_type": "report", "format_guidance": "Access review tool export", "frequency": "quarterly"},
        {"title": "Access Modification Log", "description": "Log of access rights changes", "artifact_type": "log", "format_guidance": "IAM system change log", "frequency": "monthly"},
        {"title": "Access Request Forms", "description": "Sample access request and approval forms", "artifact_type": "record", "format_guidance": "Completed request forms", "frequency": "quarterly"},
    ],
    "cloud services": [
        {"title": "Cloud Security Policy", "description": "Policy for secure use of cloud services", "artifact_type": "policy", "format_guidance": "Cloud security policy document", "frequency": "annual"},
        {"title": "Cloud Provider Assessment", "description": "Security assessment of cloud service providers", "artifact_type": "report", "format_guidance": "Cloud security assessment report", "frequency": "annual"},
        {"title": "Cloud Configuration Review", "description": "Review of cloud security configurations", "artifact_type": "report", "format_guidance": "Cloud security posture report", "frequency": "quarterly"},
        {"title": "Cloud Service Inventory", "description": "Inventory of cloud services in use", "artifact_type": "record", "format_guidance": "Cloud service catalog", "frequency": "quarterly"},
    ],
    "ict readiness": [
        {"title": "ICT Continuity Plan", "description": "Plan for ICT service continuity", "artifact_type": "policy", "format_guidance": "ICT continuity plan document", "frequency": "annual"},
        {"title": "ICT Recovery Test Results", "description": "Results of ICT recovery testing", "artifact_type": "report", "format_guidance": "Test results report", "frequency": "annual"},
        {"title": "RTO/RPO Documentation", "description": "Recovery time and point objectives", "artifact_type": "record", "format_guidance": "RTO/RPO matrix", "frequency": "annual"},
    ],
    "legal, statutory": [
        {"title": "Legal Requirements Register", "description": "Register of applicable legal and regulatory requirements", "artifact_type": "record", "format_guidance": "Requirements register spreadsheet", "frequency": "annual"},
        {"title": "Compliance Assessment Report", "description": "Assessment of compliance with legal requirements", "artifact_type": "report", "format_guidance": "Compliance assessment report", "frequency": "annual"},
        {"title": "Legal Review Records", "description": "Records of legal compliance reviews", "artifact_type": "record", "format_guidance": "Review documentation", "frequency": "annual"},
    ],
    "intellectual property": [
        {"title": "IP Protection Policy", "description": "Policy for protecting intellectual property", "artifact_type": "policy", "format_guidance": "IP policy document", "frequency": "annual"},
        {"title": "IP Asset Register", "description": "Register of intellectual property assets", "artifact_type": "record", "format_guidance": "IP asset inventory", "frequency": "annual"},
        {"title": "IP Compliance Training Records", "description": "Training on IP compliance", "artifact_type": "record", "format_guidance": "Training completion records", "frequency": "annual"},
    ],
    "protection of records": [
        {"title": "Records Management Policy", "description": "Policy for managing and protecting records", "artifact_type": "policy", "format_guidance": "Records policy document", "frequency": "annual"},
        {"title": "Records Retention Schedule", "description": "Schedule for records retention and disposal", "artifact_type": "record", "format_guidance": "Retention schedule", "frequency": "annual"},
        {"title": "Records Access Controls", "description": "Evidence of access controls on records", "artifact_type": "configuration", "format_guidance": "Access control settings", "frequency": "quarterly"},
    ],
    "privacy": [
        {"title": "Privacy Policy", "description": "Privacy policy for PII handling", "artifact_type": "policy", "format_guidance": "Privacy policy document", "frequency": "annual"},
        {"title": "PII Inventory", "description": "Inventory of personal data processed", "artifact_type": "record", "format_guidance": "Data inventory spreadsheet", "frequency": "annual"},
        {"title": "Privacy Impact Assessment", "description": "Assessment of privacy risks", "artifact_type": "report", "format_guidance": "PIA report", "frequency": "as_needed"},
    ],
    "pii": [
        {"title": "PII Handling Policy", "description": "Policy for handling personally identifiable information", "artifact_type": "policy", "format_guidance": "PII policy document", "frequency": "annual"},
        {"title": "PII Data Inventory", "description": "Inventory of PII data elements", "artifact_type": "record", "format_guidance": "PII inventory spreadsheet", "frequency": "annual"},
        {"title": "PII Access Log", "description": "Log of access to PII data", "artifact_type": "log", "format_guidance": "Access log export", "frequency": "monthly"},
    ],
    "independent review": [
        {"title": "Independent Audit Report", "description": "Results of independent security review", "artifact_type": "report", "format_guidance": "External audit report", "frequency": "annual"},
        {"title": "Audit Remediation Tracking", "description": "Tracking of audit finding remediation", "artifact_type": "record", "format_guidance": "Remediation tracker", "frequency": "quarterly"},
        {"title": "Audit Schedule", "description": "Schedule of planned independent reviews", "artifact_type": "record", "format_guidance": "Audit calendar", "frequency": "annual"},
    ],
    "screening": [
        {"title": "Background Check Policy", "description": "Policy for employee background screening", "artifact_type": "policy", "format_guidance": "Screening policy document", "frequency": "annual"},
        {"title": "Background Check Records", "description": "Records of completed background checks", "artifact_type": "record", "format_guidance": "Screening completion records (redacted)", "frequency": "as_needed"},
        {"title": "Screening Criteria Documentation", "description": "Criteria for background screening", "artifact_type": "policy", "format_guidance": "Screening criteria document", "frequency": "annual"},
    ],
    "terms and conditions of employment": [
        {"title": "Employment Agreement Template", "description": "Standard employment agreement with security clauses", "artifact_type": "record", "format_guidance": "Agreement template with security terms", "frequency": "annual"},
        {"title": "NDA/Confidentiality Agreement", "description": "Standard NDA template", "artifact_type": "record", "format_guidance": "NDA template", "frequency": "annual"},
        {"title": "Security Clause Evidence", "description": "Evidence of security clauses in contracts", "artifact_type": "record", "format_guidance": "Sample contract excerpts", "frequency": "annual"},
    ],
    "remote working": [
        {"title": "Remote Work Security Policy", "description": "Policy for secure remote working", "artifact_type": "policy", "format_guidance": "Remote work policy document", "frequency": "annual"},
        {"title": "Remote Access Configuration", "description": "VPN/remote access security configuration", "artifact_type": "configuration", "format_guidance": "VPN settings export", "frequency": "quarterly"},
        {"title": "Remote Device Security Requirements", "description": "Requirements for remote devices", "artifact_type": "policy", "format_guidance": "Device requirements document", "frequency": "annual"},
    ],
    "security event reporting": [
        {"title": "Security Event Reporting Procedure", "description": "Procedure for reporting security events", "artifact_type": "policy", "format_guidance": "Reporting procedure document", "frequency": "annual"},
        {"title": "Security Event Report Template", "description": "Template for security event reports", "artifact_type": "record", "format_guidance": "Report template", "frequency": "annual"},
        {"title": "Security Event Log", "description": "Log of reported security events", "artifact_type": "log", "format_guidance": "Event tracking system export", "frequency": "monthly"},
    ],
    "physical security perimeter": [
        {"title": "Physical Security Policy", "description": "Policy for physical security controls", "artifact_type": "policy", "format_guidance": "Physical security policy", "frequency": "annual"},
        {"title": "Facility Security Map", "description": "Map showing security zones and perimeters", "artifact_type": "record", "format_guidance": "Facility security diagram", "frequency": "annual"},
        {"title": "Physical Access Control Log", "description": "Log of physical access to secure areas", "artifact_type": "log", "format_guidance": "Access control system log", "frequency": "monthly"},
    ],
    "physical entry": [
        {"title": "Entry Control Procedure", "description": "Procedure for controlling physical entry", "artifact_type": "policy", "format_guidance": "Entry control procedure", "frequency": "annual"},
        {"title": "Badge/Access Card System Configuration", "description": "Configuration of physical access system", "artifact_type": "configuration", "format_guidance": "Access control system settings", "frequency": "quarterly"},
        {"title": "Visitor Management Log", "description": "Log of visitor entries and escorts", "artifact_type": "log", "format_guidance": "Visitor log export", "frequency": "monthly"},
    ],
    "securing offices": [
        {"title": "Office Security Standards", "description": "Standards for securing office spaces", "artifact_type": "policy", "format_guidance": "Office security standards document", "frequency": "annual"},
        {"title": "Office Security Checklist", "description": "Completed security checklists for offices", "artifact_type": "record", "format_guidance": "Completed checklists", "frequency": "quarterly"},
    ],
    "physical security monitoring": [
        {"title": "CCTV/Surveillance Configuration", "description": "Configuration of physical security monitoring systems", "artifact_type": "configuration", "format_guidance": "CCTV system settings", "frequency": "quarterly"},
        {"title": "Monitoring Coverage Map", "description": "Map showing surveillance coverage", "artifact_type": "record", "format_guidance": "Coverage diagram", "frequency": "annual"},
        {"title": "Security Monitoring Log", "description": "Log of security monitoring activities", "artifact_type": "log", "format_guidance": "Monitoring activity log", "frequency": "monthly"},
    ],
    "environmental threat": [
        {"title": "Environmental Controls Documentation", "description": "Documentation of environmental protection controls", "artifact_type": "record", "format_guidance": "Environmental controls inventory", "frequency": "annual"},
        {"title": "Environmental Monitoring Configuration", "description": "Configuration of environmental sensors", "artifact_type": "configuration", "format_guidance": "Sensor configuration settings", "frequency": "quarterly"},
        {"title": "Environmental Incident Log", "description": "Log of environmental events/incidents", "artifact_type": "log", "format_guidance": "Incident log", "frequency": "quarterly"},
    ],
    "working in secure areas": [
        {"title": "Secure Area Procedures", "description": "Procedures for working in secure areas", "artifact_type": "policy", "format_guidance": "Secure area procedures document", "frequency": "annual"},
        {"title": "Secure Area Access List", "description": "List of personnel authorized for secure areas", "artifact_type": "record", "format_guidance": "Authorized personnel list", "frequency": "quarterly"},
    ],
    "clear desk": [
        {"title": "Clear Desk Policy", "description": "Policy for clear desk and clear screen", "artifact_type": "policy", "format_guidance": "Clear desk policy document", "frequency": "annual"},
        {"title": "Clear Desk Audit Results", "description": "Results of clear desk audits", "artifact_type": "report", "format_guidance": "Audit results report", "frequency": "quarterly"},
    ],
    "equipment siting": [
        {"title": "Equipment Siting Standards", "description": "Standards for equipment placement and protection", "artifact_type": "policy", "format_guidance": "Siting standards document", "frequency": "annual"},
        {"title": "Equipment Location Inventory", "description": "Inventory of equipment locations", "artifact_type": "record", "format_guidance": "Equipment location matrix", "frequency": "annual"},
    ],
    "assets off-premises": [
        {"title": "Off-Premises Asset Policy", "description": "Policy for managing assets outside facilities", "artifact_type": "policy", "format_guidance": "Off-premises policy document", "frequency": "annual"},
        {"title": "Off-Premises Asset Register", "description": "Register of assets taken off-premises", "artifact_type": "record", "format_guidance": "Asset register with locations", "frequency": "quarterly"},
    ],
    "storage media": [
        {"title": "Media Handling Policy", "description": "Policy for handling storage media", "artifact_type": "policy", "format_guidance": "Media handling policy", "frequency": "annual"},
        {"title": "Media Inventory", "description": "Inventory of storage media", "artifact_type": "record", "format_guidance": "Media inventory spreadsheet", "frequency": "quarterly"},
        {"title": "Media Disposal Records", "description": "Records of media destruction/disposal", "artifact_type": "record", "format_guidance": "Destruction certificates", "frequency": "as_needed"},
    ],
    "cabling security": [
        {"title": "Cabling Standards Document", "description": "Standards for secure cabling", "artifact_type": "policy", "format_guidance": "Cabling standards document", "frequency": "annual"},
        {"title": "Cabling Diagram", "description": "Diagram of cabling infrastructure", "artifact_type": "configuration", "format_guidance": "Infrastructure diagram", "frequency": "annual"},
    ],
    "supporting utilities": [
        {"title": "UPS/Power Backup Configuration", "description": "Configuration of power backup systems", "artifact_type": "configuration", "format_guidance": "UPS configuration settings", "frequency": "quarterly"},
        {"title": "Utility Redundancy Documentation", "description": "Documentation of utility redundancy", "artifact_type": "record", "format_guidance": "Redundancy documentation", "frequency": "annual"},
        {"title": "Utility Maintenance Records", "description": "Maintenance records for supporting utilities", "artifact_type": "log", "format_guidance": "Maintenance log", "frequency": "quarterly"},
    ],
    "equipment maintenance": [
        {"title": "Equipment Maintenance Schedule", "description": "Schedule for equipment maintenance", "artifact_type": "record", "format_guidance": "Maintenance schedule", "frequency": "annual"},
        {"title": "Maintenance Records", "description": "Records of maintenance activities", "artifact_type": "log", "format_guidance": "Maintenance log", "frequency": "quarterly"},
        {"title": "Maintenance Procedure", "description": "Procedure for equipment maintenance", "artifact_type": "policy", "format_guidance": "Maintenance procedure document", "frequency": "annual"},
    ],
    "secure disposal": [
        {"title": "Disposal Policy", "description": "Policy for secure disposal of equipment", "artifact_type": "policy", "format_guidance": "Disposal policy document", "frequency": "annual"},
        {"title": "Disposal Certificates", "description": "Certificates of secure disposal", "artifact_type": "certificate", "format_guidance": "Destruction certificates", "frequency": "as_needed"},
        {"title": "Disposal Log", "description": "Log of disposed equipment", "artifact_type": "log", "format_guidance": "Disposal tracking log", "frequency": "quarterly"},
    ],
    "contact with authorities": [
        {"title": "Authorities Contact List", "description": "List of relevant authorities and contacts", "artifact_type": "record", "format_guidance": "Contact list document", "frequency": "annual"},
        {"title": "Authority Reporting Procedure", "description": "Procedure for reporting to authorities", "artifact_type": "policy", "format_guidance": "Reporting procedure", "frequency": "annual"},
    ],
    "special interest groups": [
        {"title": "Security Community Memberships", "description": "List of security community memberships", "artifact_type": "record", "format_guidance": "Membership documentation", "frequency": "annual"},
        {"title": "Information Sharing Records", "description": "Records of threat info sharing with groups", "artifact_type": "log", "format_guidance": "Sharing activity log", "frequency": "quarterly"},
    ],
    "project management": [
        {"title": "Secure Project Management Procedure", "description": "Procedure for security in project management", "artifact_type": "policy", "format_guidance": "Procedure document", "frequency": "annual"},
        {"title": "Security Gate Review Checklist", "description": "Security checklist for project gates", "artifact_type": "record", "format_guidance": "Completed checklists", "frequency": "as_needed"},
        {"title": "Project Security Requirements", "description": "Security requirements for projects", "artifact_type": "record", "format_guidance": "Security requirements template", "frequency": "annual"},
    ],
    "segregation of duties": [
        {"title": "Segregation of Duties Matrix", "description": "Matrix showing incompatible roles", "artifact_type": "record", "format_guidance": "SoD matrix spreadsheet", "frequency": "annual"},
        {"title": "SoD Violation Report", "description": "Report of segregation violations", "artifact_type": "report", "format_guidance": "SoD analysis report", "frequency": "quarterly"},
        {"title": "Role Conflict Analysis", "description": "Analysis of potential role conflicts", "artifact_type": "report", "format_guidance": "Conflict analysis document", "frequency": "annual"},
    ],
    "management responsibilities": [
        {"title": "Management Security Responsibilities", "description": "Documentation of management security responsibilities", "artifact_type": "policy", "format_guidance": "Responsibilities document", "frequency": "annual"},
        {"title": "Management Attestation", "description": "Management attestation of security responsibilities", "artifact_type": "record", "format_guidance": "Signed attestation", "frequency": "annual"},
    ],
    "return of assets": [
        {"title": "Asset Return Procedure", "description": "Procedure for asset return upon termination", "artifact_type": "policy", "format_guidance": "Return procedure document", "frequency": "annual"},
        {"title": "Asset Return Checklists", "description": "Completed asset return checklists", "artifact_type": "record", "format_guidance": "Completed checklists", "frequency": "quarterly"},
    ],
    "confidentiality": [
        {"title": "NDA Template", "description": "Standard non-disclosure agreement template", "artifact_type": "record", "format_guidance": "NDA template document", "frequency": "annual"},
        {"title": "Signed NDAs Register", "description": "Register of signed confidentiality agreements", "artifact_type": "record", "format_guidance": "NDA tracking spreadsheet", "frequency": "quarterly"},
    ],
    "non-disclosure": [
        {"title": "NDA Policy", "description": "Policy for non-disclosure agreements", "artifact_type": "policy", "format_guidance": "NDA policy document", "frequency": "annual"},
        {"title": "NDA Template", "description": "Standard NDA template", "artifact_type": "record", "format_guidance": "NDA template", "frequency": "annual"},
        {"title": "NDA Registry", "description": "Registry of signed NDAs", "artifact_type": "record", "format_guidance": "NDA tracking register", "frequency": "quarterly"},
    ],
    "disciplinary": [
        {"title": "Disciplinary Policy", "description": "Policy for security-related disciplinary actions", "artifact_type": "policy", "format_guidance": "Disciplinary policy document", "frequency": "annual"},
        {"title": "Disciplinary Procedure", "description": "Procedure for handling security violations", "artifact_type": "policy", "format_guidance": "Procedure document", "frequency": "annual"},
    ],
    "termination": [
        {"title": "Termination Procedure", "description": "Procedure for employee termination security", "artifact_type": "policy", "format_guidance": "Termination procedure document", "frequency": "annual"},
        {"title": "Termination Checklist", "description": "Security checklist for terminations", "artifact_type": "record", "format_guidance": "Completed checklists", "frequency": "quarterly"},
        {"title": "Access Revocation Log", "description": "Log of access revocation for terminated users", "artifact_type": "log", "format_guidance": "IAM revocation log", "frequency": "monthly"},
    ],
    "documented operating procedures": [
        {"title": "Standard Operating Procedures", "description": "Documented operating procedures", "artifact_type": "policy", "format_guidance": "SOP documents", "frequency": "annual"},
        {"title": "Procedure Review Records", "description": "Records of procedure reviews", "artifact_type": "record", "format_guidance": "Review sign-off records", "frequency": "annual"},
        {"title": "Procedure Version Control", "description": "Version control of procedures", "artifact_type": "record", "format_guidance": "Version history log", "frequency": "quarterly"},
    ],
    "acceptable use": [
        {"title": "Acceptable Use Policy", "description": "Policy defining acceptable use of IT resources", "artifact_type": "policy", "format_guidance": "AUP document", "frequency": "annual"},
        {"title": "AUP Acknowledgment Records", "description": "Records of user AUP acknowledgment", "artifact_type": "record", "format_guidance": "Signed acknowledgments", "frequency": "annual"},
    ],
    "inventory of information": [
        {"title": "Information Asset Inventory", "description": "Inventory of information assets", "artifact_type": "record", "format_guidance": "Asset inventory spreadsheet", "frequency": "quarterly"},
        {"title": "Asset Classification Records", "description": "Classification of information assets", "artifact_type": "record", "format_guidance": "Classification matrix", "frequency": "annual"},
        {"title": "Asset Owner Assignments", "description": "Documentation of asset ownership", "artifact_type": "record", "format_guidance": "Ownership assignment records", "frequency": "annual"},
    ],
    "during disruption": [
        {"title": "Security Continuity Plan", "description": "Plan for maintaining security during disruptions", "artifact_type": "policy", "format_guidance": "Security continuity plan", "frequency": "annual"},
        {"title": "Disruption Response Procedure", "description": "Procedure for security response during disruptions", "artifact_type": "policy", "format_guidance": "Response procedure document", "frequency": "annual"},
    ],
    "compliance with policies": [
        {"title": "Compliance Review Report", "description": "Report of policy compliance review", "artifact_type": "report", "format_guidance": "Compliance review report", "frequency": "annual"},
        {"title": "Non-Compliance Tracking", "description": "Tracking of compliance gaps and remediation", "artifact_type": "record", "format_guidance": "Gap tracking spreadsheet", "frequency": "quarterly"},
    ],
    "supplier relationships": [
        {"title": "Supplier Security Policy", "description": "Policy for supplier security requirements", "artifact_type": "policy", "format_guidance": "Supplier security policy", "frequency": "annual"},
        {"title": "Supplier Security Assessments", "description": "Security assessments of suppliers", "artifact_type": "report", "format_guidance": "Assessment reports", "frequency": "annual"},
        {"title": "Supplier Contracts with Security Clauses", "description": "Contracts showing security requirements", "artifact_type": "record", "format_guidance": "Contract excerpts", "frequency": "annual"},
    ],
    "supplier agreements": [
        {"title": "Supplier Agreement Template", "description": "Template with security requirements", "artifact_type": "record", "format_guidance": "Agreement template", "frequency": "annual"},
        {"title": "Signed Supplier Agreements", "description": "Sample signed agreements", "artifact_type": "record", "format_guidance": "Redacted agreement samples", "frequency": "annual"},
    ],
    "supply chain": [
        {"title": "Supply Chain Security Policy", "description": "Policy for ICT supply chain security", "artifact_type": "policy", "format_guidance": "Supply chain policy", "frequency": "annual"},
        {"title": "Supply Chain Risk Assessment", "description": "Risk assessment of supply chain", "artifact_type": "report", "format_guidance": "Risk assessment report", "frequency": "annual"},
        {"title": "Supplier Tier Classification", "description": "Classification of suppliers by risk", "artifact_type": "record", "format_guidance": "Supplier classification matrix", "frequency": "annual"},
    ],
    "monitoring, review and change management of supplier": [
        {"title": "Supplier Monitoring Procedure", "description": "Procedure for monitoring supplier performance", "artifact_type": "policy", "format_guidance": "Monitoring procedure", "frequency": "annual"},
        {"title": "Supplier Performance Reports", "description": "Reports on supplier performance", "artifact_type": "report", "format_guidance": "Performance review reports", "frequency": "quarterly"},
        {"title": "Supplier Change Log", "description": "Log of changes to supplier services", "artifact_type": "log", "format_guidance": "Change tracking log", "frequency": "monthly"},
    ],
    "incident management planning": [
        {"title": "Incident Response Plan", "description": "Plan for incident management", "artifact_type": "policy", "format_guidance": "IR plan document", "frequency": "annual"},
        {"title": "Incident Response Playbooks", "description": "Playbooks for incident types", "artifact_type": "policy", "format_guidance": "Playbook documents", "frequency": "annual"},
        {"title": "IR Team Contact List", "description": "Incident response team contacts", "artifact_type": "record", "format_guidance": "Contact list", "frequency": "quarterly"},
    ],
    "assessment and decision on information security events": [
        {"title": "Event Assessment Procedure", "description": "Procedure for assessing security events", "artifact_type": "policy", "format_guidance": "Assessment procedure", "frequency": "annual"},
        {"title": "Event Classification Criteria", "description": "Criteria for classifying events", "artifact_type": "record", "format_guidance": "Classification matrix", "frequency": "annual"},
        {"title": "Event Assessment Log", "description": "Log of event assessments", "artifact_type": "log", "format_guidance": "Assessment tracking log", "frequency": "monthly"},
    ],
    "response to information security incidents": [
        {"title": "Incident Response Procedure", "description": "Procedure for responding to incidents", "artifact_type": "policy", "format_guidance": "Response procedure", "frequency": "annual"},
        {"title": "Incident Response Log", "description": "Log of incident responses", "artifact_type": "log", "format_guidance": "Incident tracking system export", "frequency": "monthly"},
        {"title": "Incident Report Samples", "description": "Sample completed incident reports", "artifact_type": "record", "format_guidance": "Redacted incident reports", "frequency": "quarterly"},
    ],
    "learning from information security incidents": [
        {"title": "Lessons Learned Procedure", "description": "Procedure for capturing lessons learned", "artifact_type": "policy", "format_guidance": "Lessons learned procedure", "frequency": "annual"},
        {"title": "Lessons Learned Reports", "description": "Reports from incident post-mortems", "artifact_type": "report", "format_guidance": "Post-incident review reports", "frequency": "quarterly"},
        {"title": "Control Improvement Log", "description": "Log of improvements from incidents", "artifact_type": "log", "format_guidance": "Improvement tracking log", "frequency": "quarterly"},
    ],
    "authentication information": [
        {"title": "Authentication Policy", "description": "Policy for authentication management", "artifact_type": "policy", "format_guidance": "Authentication policy document", "frequency": "annual"},
        {"title": "Password Policy Configuration", "description": "System password policy settings", "artifact_type": "configuration", "format_guidance": "GPO or IAM settings", "frequency": "quarterly"},
        {"title": "Authentication Audit Log", "description": "Log of authentication events", "artifact_type": "log", "format_guidance": "Authentication log export", "frequency": "monthly"},
    ],
    "access control": [
        {"title": "Access Control Policy", "description": "Policy for access control", "artifact_type": "policy", "format_guidance": "Access control policy", "frequency": "annual"},
        {"title": "Access Control Matrix", "description": "Matrix of access permissions", "artifact_type": "record", "format_guidance": "Access matrix spreadsheet", "frequency": "quarterly"},
        {"title": "Access Review Report", "description": "Report of access reviews", "artifact_type": "report", "format_guidance": "Access review attestations", "frequency": "quarterly"},
    ],
    "roles and responsibilities": [
        {"title": "Security Roles Document", "description": "Documentation of security roles and responsibilities", "artifact_type": "policy", "format_guidance": "RACI matrix or roles document", "frequency": "annual"},
        {"title": "Role Assignment Records", "description": "Records of role assignments", "artifact_type": "record", "format_guidance": "Role assignment log", "frequency": "quarterly"},
    ],
    "policies for information security": [
        {"title": "Information Security Policy", "description": "Master information security policy", "artifact_type": "policy", "format_guidance": "Approved policy document", "frequency": "annual"},
        {"title": "Policy Approval Records", "description": "Records of policy approvals", "artifact_type": "record", "format_guidance": "Approval signatures", "frequency": "annual"},
        {"title": "Policy Distribution Evidence", "description": "Evidence of policy distribution", "artifact_type": "record", "format_guidance": "Distribution records", "frequency": "annual"},
    ],
    "review of the policies": [
        {"title": "Policy Review Schedule", "description": "Schedule for policy reviews", "artifact_type": "record", "format_guidance": "Review calendar", "frequency": "annual"},
        {"title": "Policy Review Records", "description": "Records of policy reviews conducted", "artifact_type": "record", "format_guidance": "Review meeting minutes", "frequency": "annual"},
        {"title": "Policy Update Log", "description": "Log of policy updates", "artifact_type": "log", "format_guidance": "Version history", "frequency": "annual"},
    ],
    "awareness, education and training": [
        {"title": "Security Awareness Program", "description": "Security awareness training program", "artifact_type": "policy", "format_guidance": "Program document with curriculum", "frequency": "annual"},
        {"title": "Training Completion Records", "description": "Records of training completion", "artifact_type": "report", "format_guidance": "LMS completion report", "frequency": "quarterly"},
        {"title": "Training Materials", "description": "Sample training materials", "artifact_type": "record", "format_guidance": "Training slides/content", "frequency": "annual"},
    ],
    # === NIST CSF SPECIFIC CONTROLS ===
    "mission understood": [
        {"title": "Mission Statement", "description": "Organizational mission statement", "artifact_type": "record", "format_guidance": "Mission statement document", "frequency": "annual"},
        {"title": "Mission-Risk Alignment Document", "description": "Document showing mission informs risk management", "artifact_type": "record", "format_guidance": "Alignment documentation", "frequency": "annual"},
    ],
    "stakeholders understood": [
        {"title": "Stakeholder Analysis", "description": "Analysis of internal/external stakeholders", "artifact_type": "record", "format_guidance": "Stakeholder analysis document", "frequency": "annual"},
        {"title": "Stakeholder Communication Records", "description": "Records of stakeholder communications", "artifact_type": "record", "format_guidance": "Communication log", "frequency": "quarterly"},
    ],
    "legal requirements understood": [
        {"title": "Legal Requirements Register", "description": "Register of legal and regulatory requirements", "artifact_type": "record", "format_guidance": "Requirements register", "frequency": "annual"},
        {"title": "Regulatory Compliance Matrix", "description": "Matrix showing compliance status", "artifact_type": "record", "format_guidance": "Compliance matrix", "frequency": "quarterly"},
    ],
    "critical objectives determined": [
        {"title": "Critical Objectives Documentation", "description": "Documentation of critical objectives", "artifact_type": "record", "format_guidance": "Objectives document", "frequency": "annual"},
        {"title": "Business Impact Analysis", "description": "BIA identifying critical functions", "artifact_type": "report", "format_guidance": "BIA report", "frequency": "annual"},
    ],
    "outcomes prioritized": [
        {"title": "Prioritization Framework", "description": "Framework for prioritizing outcomes", "artifact_type": "record", "format_guidance": "Prioritization matrix", "frequency": "annual"},
        {"title": "Priority Decision Records", "description": "Records of priority decisions", "artifact_type": "record", "format_guidance": "Decision documentation", "frequency": "quarterly"},
    ],
    "risk management objectives": [
        {"title": "Risk Management Objectives", "description": "Documented risk management objectives", "artifact_type": "policy", "format_guidance": "Objectives document", "frequency": "annual"},
        {"title": "Risk Management Charter", "description": "Charter for risk management program", "artifact_type": "policy", "format_guidance": "Program charter", "frequency": "annual"},
    ],
    "risk appetite": [
        {"title": "Risk Appetite Statement", "description": "Statement of risk appetite", "artifact_type": "policy", "format_guidance": "Risk appetite document", "frequency": "annual"},
        {"title": "Risk Tolerance Thresholds", "description": "Defined risk tolerance thresholds", "artifact_type": "record", "format_guidance": "Tolerance matrix", "frequency": "annual"},
    ],
    "risk management strategy": [
        {"title": "Risk Management Strategy", "description": "Strategic risk management approach", "artifact_type": "policy", "format_guidance": "Strategy document", "frequency": "annual"},
        {"title": "Risk Management Framework", "description": "Framework for managing risks", "artifact_type": "policy", "format_guidance": "Framework document", "frequency": "annual"},
    ],
    "strategic direction": [
        {"title": "Cybersecurity Strategic Plan", "description": "Strategic plan for cybersecurity", "artifact_type": "policy", "format_guidance": "Strategic plan document", "frequency": "annual"},
        {"title": "Strategy Communication Records", "description": "Records of strategy communication", "artifact_type": "record", "format_guidance": "Communication evidence", "frequency": "annual"},
    ],
    "leaders accountable": [
        {"title": "Leadership Accountability Matrix", "description": "Matrix of leadership accountability", "artifact_type": "record", "format_guidance": "Accountability document", "frequency": "annual"},
        {"title": "Leadership Attestations", "description": "Signed leadership attestations", "artifact_type": "record", "format_guidance": "Signed attestations", "frequency": "annual"},
    ],
    "roles established": [
        {"title": "Cybersecurity Organization Chart", "description": "Organization chart for cybersecurity", "artifact_type": "record", "format_guidance": "Org chart", "frequency": "annual"},
        {"title": "Role Descriptions", "description": "Descriptions of cybersecurity roles", "artifact_type": "record", "format_guidance": "Job descriptions", "frequency": "annual"},
    ],
    "resources allocated": [
        {"title": "Cybersecurity Budget", "description": "Budget for cybersecurity resources", "artifact_type": "record", "format_guidance": "Budget document", "frequency": "annual"},
        {"title": "Resource Allocation Records", "description": "Records of resource allocation", "artifact_type": "record", "format_guidance": "Allocation documentation", "frequency": "quarterly"},
    ],
    "cybersecurity in hr": [
        {"title": "HR Security Integration Policy", "description": "Policy for cybersecurity in HR practices", "artifact_type": "policy", "format_guidance": "Policy document", "frequency": "annual"},
        {"title": "HR Security Checklist", "description": "Security checklist for HR processes", "artifact_type": "record", "format_guidance": "Checklist document", "frequency": "annual"},
    ],
    "policy established": [
        {"title": "Cybersecurity Policy", "description": "Established cybersecurity policy", "artifact_type": "policy", "format_guidance": "Policy document", "frequency": "annual"},
        {"title": "Policy Approval Evidence", "description": "Evidence of policy approval", "artifact_type": "record", "format_guidance": "Approval signatures", "frequency": "annual"},
    ],
    "policy communicated": [
        {"title": "Policy Communication Plan", "description": "Plan for communicating policy", "artifact_type": "record", "format_guidance": "Communication plan", "frequency": "annual"},
        {"title": "Policy Acknowledgment Records", "description": "Records of policy acknowledgment", "artifact_type": "record", "format_guidance": "Signed acknowledgments", "frequency": "annual"},
    ],
    "strategy reviewed": [
        {"title": "Strategy Review Report", "description": "Report of strategy review", "artifact_type": "report", "format_guidance": "Review report", "frequency": "annual"},
        {"title": "Strategy Review Meeting Minutes", "description": "Minutes from strategy reviews", "artifact_type": "record", "format_guidance": "Meeting minutes", "frequency": "quarterly"},
    ],
    "strategy adjusted": [
        {"title": "Strategy Adjustment Log", "description": "Log of strategy adjustments", "artifact_type": "log", "format_guidance": "Adjustment tracking log", "frequency": "quarterly"},
        {"title": "Strategy Update Records", "description": "Records of strategy updates", "artifact_type": "record", "format_guidance": "Update documentation", "frequency": "quarterly"},
    ],
    "supply chain risk program": [
        {"title": "Supply Chain Risk Program Charter", "description": "Charter for supply chain risk program", "artifact_type": "policy", "format_guidance": "Program charter", "frequency": "annual"},
        {"title": "Supply Chain Risk Assessments", "description": "Risk assessments of supply chain", "artifact_type": "report", "format_guidance": "Assessment reports", "frequency": "annual"},
    ],
    "suppliers identified": [
        {"title": "Supplier Inventory", "description": "Inventory of critical suppliers", "artifact_type": "record", "format_guidance": "Supplier registry", "frequency": "quarterly"},
        {"title": "Supplier Responsibility Matrix", "description": "Matrix of supplier responsibilities", "artifact_type": "record", "format_guidance": "Responsibility matrix", "frequency": "annual"},
    ],
    "suppliers assessed": [
        {"title": "Supplier Assessment Reports", "description": "Security assessments of suppliers", "artifact_type": "report", "format_guidance": "Assessment reports", "frequency": "annual"},
        {"title": "Supplier Risk Ratings", "description": "Risk ratings for suppliers", "artifact_type": "record", "format_guidance": "Risk rating matrix", "frequency": "annual"},
    ],
    "contracts include requirements": [
        {"title": "Contract Security Requirements", "description": "Security requirements in contracts", "artifact_type": "record", "format_guidance": "Contract excerpts", "frequency": "annual"},
        {"title": "Contract Review Checklist", "description": "Checklist for contract security review", "artifact_type": "record", "format_guidance": "Review checklist", "frequency": "annual"},
    ],
    "hardware inventoried": [
        {"title": "Hardware Asset Inventory", "description": "Inventory of hardware assets", "artifact_type": "record", "format_guidance": "CMDB export", "frequency": "quarterly"},
        {"title": "Hardware Discovery Scan", "description": "Results of hardware discovery", "artifact_type": "report", "format_guidance": "Discovery scan results", "frequency": "monthly"},
    ],
    "software inventoried": [
        {"title": "Software Asset Inventory", "description": "Inventory of software assets", "artifact_type": "record", "format_guidance": "Software inventory spreadsheet", "frequency": "quarterly"},
        {"title": "Software Discovery Scan", "description": "Results of software discovery", "artifact_type": "report", "format_guidance": "Discovery scan results", "frequency": "monthly"},
    ],
    "data mapped": [
        {"title": "Data Flow Diagram", "description": "Diagram of data flows", "artifact_type": "configuration", "format_guidance": "Data flow diagram", "frequency": "annual"},
        {"title": "Data Inventory", "description": "Inventory of data assets", "artifact_type": "record", "format_guidance": "Data inventory spreadsheet", "frequency": "quarterly"},
    ],
    # === PCI DSS SPECIFIC CONTROLS ===
    "security policies and procedures defined": [
        {"title": "Security Policy Document", "description": "Documented security policies and procedures", "artifact_type": "policy", "format_guidance": "Policy document with version", "frequency": "annual"},
        {"title": "Policy Communication Evidence", "description": "Evidence of policy communication to staff", "artifact_type": "record", "format_guidance": "Distribution records", "frequency": "annual"},
    ],
    "roles and responsibilities assigned": [
        {"title": "RACI Matrix", "description": "Roles and responsibilities matrix", "artifact_type": "record", "format_guidance": "RACI spreadsheet", "frequency": "annual"},
        {"title": "Role Assignment Evidence", "description": "Evidence of role assignments", "artifact_type": "record", "format_guidance": "Assignment records", "frequency": "quarterly"},
    ],
    "configuration standards": [
        {"title": "Configuration Standards Document", "description": "Standards for system configurations", "artifact_type": "policy", "format_guidance": "Standards document", "frequency": "annual"},
        {"title": "Configuration Compliance Report", "description": "Report of configuration compliance", "artifact_type": "report", "format_guidance": "Compliance scan results", "frequency": "quarterly"},
    ],
    "network diagram": [
        {"title": "Network Architecture Diagram", "description": "Current network diagram", "artifact_type": "configuration", "format_guidance": "Network diagram with CDE boundaries", "frequency": "quarterly"},
        {"title": "Network Diagram Review Evidence", "description": "Evidence of diagram review and update", "artifact_type": "record", "format_guidance": "Review records", "frequency": "quarterly"},
    ],
    "data-flow diagram": [
        {"title": "Data Flow Diagram", "description": "Current data flow diagram", "artifact_type": "configuration", "format_guidance": "Data flow diagram", "frequency": "quarterly"},
        {"title": "Data Flow Review Evidence", "description": "Evidence of data flow review", "artifact_type": "record", "format_guidance": "Review records", "frequency": "quarterly"},
    ],
    "services and ports": [
        {"title": "Port Justification Matrix", "description": "Matrix of allowed ports with justification", "artifact_type": "record", "format_guidance": "Port matrix spreadsheet", "frequency": "quarterly"},
        {"title": "Port Scan Results", "description": "Results of port scanning", "artifact_type": "report", "format_guidance": "Port scan report", "frequency": "quarterly"},
    ],
    "nsc configurations reviewed": [
        {"title": "NSC Review Report", "description": "Report of NSC configuration review", "artifact_type": "report", "format_guidance": "Firewall review report", "frequency": "semi-annual"},
        {"title": "NSC Configuration Export", "description": "Export of NSC configurations", "artifact_type": "configuration", "format_guidance": "Firewall rule export", "frequency": "quarterly"},
    ],
    "pan masked": [
        {"title": "PAN Masking Configuration", "description": "Configuration of PAN masking", "artifact_type": "configuration", "format_guidance": "Masking settings", "frequency": "quarterly"},
        {"title": "PAN Masking Verification", "description": "Verification of PAN masking", "artifact_type": "screenshot", "format_guidance": "Screenshots showing masking", "frequency": "quarterly"},
    ],
    "pan rendered unreadable": [
        {"title": "PAN Encryption Configuration", "description": "Configuration of PAN encryption", "artifact_type": "configuration", "format_guidance": "Encryption settings", "frequency": "quarterly"},
        {"title": "Encryption Verification Evidence", "description": "Evidence of PAN encryption", "artifact_type": "report", "format_guidance": "Encryption status report", "frequency": "quarterly"},
    ],
    "disk-level encryption": [
        {"title": "Disk Encryption Configuration", "description": "Configuration of disk encryption", "artifact_type": "configuration", "format_guidance": "Encryption settings", "frequency": "quarterly"},
        {"title": "Disk Encryption Status Report", "description": "Report of disk encryption status", "artifact_type": "report", "format_guidance": "BitLocker/LUKS status", "frequency": "monthly"},
    ],
    "key management": [
        {"title": "Key Management Policy", "description": "Policy for cryptographic key management", "artifact_type": "policy", "format_guidance": "Key management policy", "frequency": "annual"},
        {"title": "Key Inventory", "description": "Inventory of cryptographic keys", "artifact_type": "record", "format_guidance": "Key inventory spreadsheet", "frequency": "quarterly"},
        {"title": "Key Custodian Assignments", "description": "Assignments of key custodians", "artifact_type": "record", "format_guidance": "Custodian assignment records", "frequency": "annual"},
    ],
    "anti-malware": [
        {"title": "Anti-Malware Policy", "description": "Policy for anti-malware protection", "artifact_type": "policy", "format_guidance": "Anti-malware policy", "frequency": "annual"},
        {"title": "Anti-Malware Deployment Status", "description": "Status of anti-malware deployment", "artifact_type": "report", "format_guidance": "AV console report", "frequency": "monthly"},
        {"title": "Malware Scan Log", "description": "Log of malware scans", "artifact_type": "log", "format_guidance": "Scan log export", "frequency": "monthly"},
    ],
    "anti-phishing": [
        {"title": "Anti-Phishing Controls", "description": "Documentation of anti-phishing controls", "artifact_type": "configuration", "format_guidance": "Email security settings", "frequency": "quarterly"},
        {"title": "Phishing Awareness Training", "description": "Phishing awareness training records", "artifact_type": "record", "format_guidance": "Training completion records", "frequency": "quarterly"},
        {"title": "Phishing Simulation Results", "description": "Results of phishing simulations", "artifact_type": "report", "format_guidance": "Simulation results", "frequency": "quarterly"},
    ],
    # === SWIFT CSP SPECIFIC CONTROLS ===
    "swift environment protection": [
        {"title": "SWIFT Environment Security Architecture", "description": "Architecture of SWIFT environment security", "artifact_type": "configuration", "format_guidance": "Architecture diagram", "frequency": "annual"},
        {"title": "SWIFT Zone Segmentation Evidence", "description": "Evidence of SWIFT zone segmentation", "artifact_type": "configuration", "format_guidance": "Firewall rules for SWIFT zone", "frequency": "quarterly"},
        {"title": "SWIFT Environment Inventory", "description": "Inventory of SWIFT environment components", "artifact_type": "record", "format_guidance": "Component inventory", "frequency": "quarterly"},
    ],
    "operating system privileged account": [
        {"title": "Privileged Account Inventory", "description": "Inventory of OS privileged accounts", "artifact_type": "record", "format_guidance": "Account inventory", "frequency": "quarterly"},
        {"title": "Privileged Access Control Configuration", "description": "Configuration of privileged access controls", "artifact_type": "configuration", "format_guidance": "PAM settings", "frequency": "quarterly"},
    ],
    "virtualisation platform protection": [
        {"title": "Virtualization Security Configuration", "description": "Security configuration of virtualization platform", "artifact_type": "configuration", "format_guidance": "Hypervisor security settings", "frequency": "quarterly"},
        {"title": "VM Security Baseline", "description": "Security baseline for VMs", "artifact_type": "policy", "format_guidance": "VM hardening standard", "frequency": "annual"},
    ],
    "restriction of internet access": [
        {"title": "Internet Access Restriction Policy", "description": "Policy for restricting internet access", "artifact_type": "policy", "format_guidance": "Policy document", "frequency": "annual"},
        {"title": "Internet Access Firewall Rules", "description": "Firewall rules restricting internet access", "artifact_type": "configuration", "format_guidance": "Firewall rules export", "frequency": "quarterly"},
    ],
    "customer connector protection": [
        {"title": "Connector Security Configuration", "description": "Security configuration of customer connector", "artifact_type": "configuration", "format_guidance": "Connector security settings", "frequency": "quarterly"},
        {"title": "Connector Access Controls", "description": "Access controls for customer connector", "artifact_type": "configuration", "format_guidance": "Access control settings", "frequency": "quarterly"},
    ],
    "internal data flow security": [
        {"title": "Internal Data Flow Encryption", "description": "Encryption of internal data flows", "artifact_type": "configuration", "format_guidance": "Encryption settings", "frequency": "quarterly"},
        {"title": "Data Flow Integrity Controls", "description": "Integrity controls for data flows", "artifact_type": "configuration", "format_guidance": "Integrity verification settings", "frequency": "quarterly"},
    ],
    "security updates": [
        {"title": "Patch Management Policy", "description": "Policy for security updates", "artifact_type": "policy", "format_guidance": "Patch policy document", "frequency": "annual"},
        {"title": "Patch Compliance Report", "description": "Report of patch compliance", "artifact_type": "report", "format_guidance": "Patch status report", "frequency": "monthly"},
    ],
    "system hardening": [
        {"title": "System Hardening Standards", "description": "Standards for system hardening", "artifact_type": "policy", "format_guidance": "Hardening standards document", "frequency": "annual"},
        {"title": "Hardening Compliance Report", "description": "Report of hardening compliance", "artifact_type": "report", "format_guidance": "Configuration scan results", "frequency": "quarterly"},
    ],
    "back office data flow security": [
        {"title": "Back Office Data Flow Documentation", "description": "Documentation of back office data flows", "artifact_type": "configuration", "format_guidance": "Data flow diagram", "frequency": "annual"},
        {"title": "Back Office Encryption Configuration", "description": "Encryption configuration for back office", "artifact_type": "configuration", "format_guidance": "Encryption settings", "frequency": "quarterly"},
    ],
    "operator session": [
        {"title": "Operator Session Security Configuration", "description": "Configuration for secure operator sessions", "artifact_type": "configuration", "format_guidance": "Session security settings", "frequency": "quarterly"},
        {"title": "Session Encryption Evidence", "description": "Evidence of session encryption", "artifact_type": "configuration", "format_guidance": "TLS/encryption settings", "frequency": "quarterly"},
    ],
    "vulnerability scanning": [
        {"title": "Vulnerability Scan Report", "description": "Results of vulnerability scanning", "artifact_type": "report", "format_guidance": "Scanner tool output", "frequency": "quarterly"},
        {"title": "Vulnerability Remediation Tracking", "description": "Tracking of vulnerability remediation", "artifact_type": "record", "format_guidance": "Remediation tracker", "frequency": "monthly"},
    ],
    "critical activity outsourcing": [
        {"title": "Outsourcing Risk Assessment", "description": "Risk assessment of outsourced activities", "artifact_type": "report", "format_guidance": "Risk assessment report", "frequency": "annual"},
        {"title": "Outsourcing Contracts", "description": "Contracts with security requirements", "artifact_type": "record", "format_guidance": "Contract excerpts", "frequency": "annual"},
    ],
    "transaction business controls": [
        {"title": "Transaction Control Policy", "description": "Policy for transaction controls", "artifact_type": "policy", "format_guidance": "Policy document", "frequency": "annual"},
        {"title": "Transaction Validation Configuration", "description": "Configuration of transaction validation", "artifact_type": "configuration", "format_guidance": "Validation settings", "frequency": "quarterly"},
    ],
    "physical security": [
        {"title": "Physical Security Policy", "description": "Policy for physical security", "artifact_type": "policy", "format_guidance": "Physical security policy", "frequency": "annual"},
        {"title": "Physical Access Log", "description": "Log of physical access events", "artifact_type": "log", "format_guidance": "Access log export", "frequency": "monthly"},
        {"title": "Physical Security Assessment", "description": "Assessment of physical security", "artifact_type": "report", "format_guidance": "Assessment report", "frequency": "annual"},
    ],
    "password policy": [
        {"title": "Password Policy Document", "description": "Password policy document", "artifact_type": "policy", "format_guidance": "Password policy", "frequency": "annual"},
        {"title": "Password Configuration Settings", "description": "System password configuration", "artifact_type": "configuration", "format_guidance": "GPO/system settings", "frequency": "quarterly"},
    ],
    "multi-factor authentication": [
        {"title": "MFA Policy", "description": "Policy for multi-factor authentication", "artifact_type": "policy", "format_guidance": "MFA policy document", "frequency": "annual"},
        {"title": "MFA Configuration", "description": "Configuration of MFA", "artifact_type": "configuration", "format_guidance": "MFA system settings", "frequency": "quarterly"},
        {"title": "MFA Enrollment Report", "description": "Report of MFA enrollment status", "artifact_type": "report", "format_guidance": "Enrollment status report", "frequency": "monthly"},
    ],
    "logical access control": [
        {"title": "Logical Access Control Policy", "description": "Policy for logical access control", "artifact_type": "policy", "format_guidance": "Access control policy", "frequency": "annual"},
        {"title": "Access Control Configuration", "description": "Configuration of access controls", "artifact_type": "configuration", "format_guidance": "IAM settings", "frequency": "quarterly"},
        {"title": "Access Review Report", "description": "Report of access reviews", "artifact_type": "report", "format_guidance": "Access review results", "frequency": "quarterly"},
    ],
    "token management": [
        {"title": "Token Management Policy", "description": "Policy for token management", "artifact_type": "policy", "format_guidance": "Token policy document", "frequency": "annual"},
        {"title": "Token Inventory", "description": "Inventory of authentication tokens", "artifact_type": "record", "format_guidance": "Token inventory", "frequency": "quarterly"},
    ],
    "personnel vetting": [
        {"title": "Vetting Policy", "description": "Policy for personnel vetting", "artifact_type": "policy", "format_guidance": "Vetting policy document", "frequency": "annual"},
        {"title": "Vetting Records", "description": "Records of personnel vetting", "artifact_type": "record", "format_guidance": "Vetting completion records", "frequency": "as_needed"},
    ],
    "password storage": [
        {"title": "Password Storage Standards", "description": "Standards for password storage", "artifact_type": "policy", "format_guidance": "Storage standards document", "frequency": "annual"},
        {"title": "Password Vault Configuration", "description": "Configuration of password vault", "artifact_type": "configuration", "format_guidance": "Vault settings", "frequency": "quarterly"},
    ],
    "malware protection": [
        {"title": "Malware Protection Policy", "description": "Policy for malware protection", "artifact_type": "policy", "format_guidance": "Policy document", "frequency": "annual"},
        {"title": "Malware Protection Deployment", "description": "Status of malware protection deployment", "artifact_type": "report", "format_guidance": "AV deployment report", "frequency": "monthly"},
    ],
    "software integrity": [
        {"title": "Software Integrity Policy", "description": "Policy for software integrity", "artifact_type": "policy", "format_guidance": "Integrity policy document", "frequency": "annual"},
        {"title": "Integrity Verification Evidence", "description": "Evidence of integrity verification", "artifact_type": "report", "format_guidance": "Integrity check results", "frequency": "quarterly"},
    ],
    "database integrity": [
        {"title": "Database Integrity Policy", "description": "Policy for database integrity", "artifact_type": "policy", "format_guidance": "Integrity policy document", "frequency": "annual"},
        {"title": "Database Integrity Monitoring", "description": "Configuration of database integrity monitoring", "artifact_type": "configuration", "format_guidance": "Monitoring settings", "frequency": "quarterly"},
    ],
    "logging and monitoring": [
        {"title": "Logging Policy", "description": "Policy for security logging", "artifact_type": "policy", "format_guidance": "Logging policy document", "frequency": "annual"},
        {"title": "Log Configuration", "description": "Configuration of security logging", "artifact_type": "configuration", "format_guidance": "SIEM/log settings", "frequency": "quarterly"},
        {"title": "Monitoring Dashboard", "description": "Screenshot of monitoring dashboard", "artifact_type": "screenshot", "format_guidance": "Dashboard screenshot", "frequency": "monthly"},
    ],
    "intrusion detection": [
        {"title": "IDS/IPS Policy", "description": "Policy for intrusion detection", "artifact_type": "policy", "format_guidance": "IDS policy document", "frequency": "annual"},
        {"title": "IDS Configuration", "description": "Configuration of IDS/IPS", "artifact_type": "configuration", "format_guidance": "IDS rule configuration", "frequency": "quarterly"},
        {"title": "IDS Alert Log", "description": "Log of IDS alerts", "artifact_type": "log", "format_guidance": "Alert log export", "frequency": "monthly"},
    ],
    "cyber incident response planning": [
        {"title": "Cyber Incident Response Plan", "description": "Plan for cyber incident response", "artifact_type": "policy", "format_guidance": "IR plan document", "frequency": "annual"},
        {"title": "IR Plan Test Results", "description": "Results of IR plan testing", "artifact_type": "report", "format_guidance": "Test report", "frequency": "annual"},
    ],
    "security training and awareness": [
        {"title": "Security Training Program", "description": "Security training program documentation", "artifact_type": "policy", "format_guidance": "Training program document", "frequency": "annual"},
        {"title": "Training Completion Records", "description": "Records of training completion", "artifact_type": "report", "format_guidance": "Completion report", "frequency": "quarterly"},
    ],
    "penetration testing": [
        {"title": "Penetration Test Report", "description": "Report from penetration testing", "artifact_type": "report", "format_guidance": "Pen test report", "frequency": "annual"},
        {"title": "Penetration Test Remediation", "description": "Remediation of pen test findings", "artifact_type": "record", "format_guidance": "Remediation tracking", "frequency": "quarterly"},
    ],
    "scenario-based risk assessment": [
        {"title": "Scenario-Based Risk Assessment", "description": "Risk assessment based on attack scenarios", "artifact_type": "report", "format_guidance": "Scenario assessment report", "frequency": "annual"},
        {"title": "Scenario Testing Results", "description": "Results of scenario testing", "artifact_type": "report", "format_guidance": "Test results report", "frequency": "annual"},
    ],
    # === GENERIC CONTROLS (for fallback coverage) ===
    "governance framework": [
        {"title": "Governance Framework Document", "description": "Documentation of governance framework", "artifact_type": "policy", "format_guidance": "Framework document", "frequency": "annual"},
        {"title": "Governance Meeting Minutes", "description": "Minutes from governance meetings", "artifact_type": "record", "format_guidance": "Meeting minutes", "frequency": "quarterly"},
    ],
    "board oversight": [
        {"title": "Board Security Charter", "description": "Charter for board security oversight", "artifact_type": "policy", "format_guidance": "Charter document", "frequency": "annual"},
        {"title": "Board Security Briefings", "description": "Records of security briefings to board", "artifact_type": "record", "format_guidance": "Briefing materials", "frequency": "quarterly"},
    ],
    "ciso": [
        {"title": "CISO Job Description", "description": "Job description for CISO role", "artifact_type": "record", "format_guidance": "Job description document", "frequency": "annual"},
        {"title": "CISO Reporting Structure", "description": "Documentation of CISO reporting", "artifact_type": "record", "format_guidance": "Org chart", "frequency": "annual"},
    ],
    "security team": [
        {"title": "Security Team Structure", "description": "Documentation of security team", "artifact_type": "record", "format_guidance": "Team org chart", "frequency": "annual"},
        {"title": "Security Team Skills Matrix", "description": "Skills matrix for security team", "artifact_type": "record", "format_guidance": "Skills matrix", "frequency": "annual"},
    ],
    "risk assessment": [
        {"title": "Risk Assessment Report", "description": "Completed risk assessment", "artifact_type": "report", "format_guidance": "Risk assessment report", "frequency": "annual"},
        {"title": "Risk Register", "description": "Register of identified risks", "artifact_type": "record", "format_guidance": "Risk register spreadsheet", "frequency": "quarterly"},
    ],
    "risk treatment": [
        {"title": "Risk Treatment Plan", "description": "Plan for treating identified risks", "artifact_type": "record", "format_guidance": "Treatment plan document", "frequency": "quarterly"},
        {"title": "Risk Treatment Status", "description": "Status of risk treatment activities", "artifact_type": "report", "format_guidance": "Status report", "frequency": "quarterly"},
    ],
    "risk monitoring": [
        {"title": "Risk Monitoring Procedure", "description": "Procedure for monitoring risks", "artifact_type": "policy", "format_guidance": "Monitoring procedure", "frequency": "annual"},
        {"title": "Risk Monitoring Report", "description": "Report of risk monitoring activities", "artifact_type": "report", "format_guidance": "Monitoring report", "frequency": "quarterly"},
    ],
    "compliance program": [
        {"title": "Compliance Program Charter", "description": "Charter for compliance program", "artifact_type": "policy", "format_guidance": "Program charter", "frequency": "annual"},
        {"title": "Compliance Status Report", "description": "Report of compliance status", "artifact_type": "report", "format_guidance": "Status report", "frequency": "quarterly"},
    ],
    "regulatory reporting": [
        {"title": "Regulatory Reporting Procedure", "description": "Procedure for regulatory reporting", "artifact_type": "policy", "format_guidance": "Reporting procedure", "frequency": "annual"},
        {"title": "Regulatory Report Samples", "description": "Samples of regulatory reports submitted", "artifact_type": "record", "format_guidance": "Report samples", "frequency": "quarterly"},
    ],
    "asset inventory": [
        {"title": "IT Asset Inventory", "description": "Complete inventory of IT assets", "artifact_type": "record", "format_guidance": "CMDB export", "frequency": "quarterly"},
        {"title": "Asset Discovery Report", "description": "Results of asset discovery", "artifact_type": "report", "format_guidance": "Discovery report", "frequency": "monthly"},
    ],
    "asset classification": [
        {"title": "Asset Classification Policy", "description": "Policy for asset classification", "artifact_type": "policy", "format_guidance": "Classification policy", "frequency": "annual"},
        {"title": "Asset Classification Matrix", "description": "Classification of assets", "artifact_type": "record", "format_guidance": "Classification matrix", "frequency": "annual"},
    ],
    "data classification": [
        {"title": "Data Classification Policy", "description": "Policy for data classification", "artifact_type": "policy", "format_guidance": "Classification policy", "frequency": "annual"},
        {"title": "Data Classification Inventory", "description": "Inventory with data classifications", "artifact_type": "record", "format_guidance": "Classification inventory", "frequency": "quarterly"},
    ],
    "access management": [
        {"title": "Access Management Policy", "description": "Policy for access management", "artifact_type": "policy", "format_guidance": "Access policy document", "frequency": "annual"},
        {"title": "Access Management Process", "description": "Documentation of access management process", "artifact_type": "policy", "format_guidance": "Process document", "frequency": "annual"},
    ],
    "user access management": [
        {"title": "User Access Policy", "description": "Policy for user access management", "artifact_type": "policy", "format_guidance": "Access policy", "frequency": "annual"},
        {"title": "User Access Review", "description": "Results of user access review", "artifact_type": "report", "format_guidance": "Review report", "frequency": "quarterly"},
    ],
    "privileged access": [
        {"title": "Privileged Access Policy", "description": "Policy for privileged access", "artifact_type": "policy", "format_guidance": "PAM policy", "frequency": "annual"},
        {"title": "Privileged Account Inventory", "description": "Inventory of privileged accounts", "artifact_type": "record", "format_guidance": "Account inventory", "frequency": "quarterly"},
    ],
    "authentication": [
        {"title": "Authentication Policy", "description": "Policy for authentication", "artifact_type": "policy", "format_guidance": "Authentication policy", "frequency": "annual"},
        {"title": "Authentication Configuration", "description": "Configuration of authentication", "artifact_type": "configuration", "format_guidance": "Authentication settings", "frequency": "quarterly"},
    ],
    "authorization": [
        {"title": "Authorization Policy", "description": "Policy for authorization", "artifact_type": "policy", "format_guidance": "Authorization policy", "frequency": "annual"},
        {"title": "Authorization Matrix", "description": "Matrix of authorizations", "artifact_type": "record", "format_guidance": "Authorization matrix", "frequency": "quarterly"},
    ],
    "secure development": [
        {"title": "Secure Development Policy", "description": "Policy for secure development", "artifact_type": "policy", "format_guidance": "SDLC policy", "frequency": "annual"},
        {"title": "Security Code Review Records", "description": "Records of security code reviews", "artifact_type": "record", "format_guidance": "Review records", "frequency": "quarterly"},
    ],
    "application testing": [
        {"title": "Application Security Testing Policy", "description": "Policy for application testing", "artifact_type": "policy", "format_guidance": "Testing policy", "frequency": "annual"},
        {"title": "Application Test Results", "description": "Results of application security tests", "artifact_type": "report", "format_guidance": "Test results", "frequency": "quarterly"},
    ],
    "data protection": [
        {"title": "Data Protection Policy", "description": "Policy for data protection", "artifact_type": "policy", "format_guidance": "Data protection policy", "frequency": "annual"},
        {"title": "Data Protection Controls", "description": "Documentation of data protection controls", "artifact_type": "record", "format_guidance": "Controls documentation", "frequency": "annual"},
    ],
    "encryption": [
        {"title": "Encryption Policy", "description": "Policy for encryption", "artifact_type": "policy", "format_guidance": "Encryption policy", "frequency": "annual"},
        {"title": "Encryption Configuration", "description": "Configuration of encryption", "artifact_type": "configuration", "format_guidance": "Encryption settings", "frequency": "quarterly"},
    ],
    "network segmentation": [
        {"title": "Network Segmentation Design", "description": "Design of network segmentation", "artifact_type": "configuration", "format_guidance": "Segmentation diagram", "frequency": "annual"},
        {"title": "Segmentation Test Results", "description": "Results of segmentation testing", "artifact_type": "report", "format_guidance": "Test report", "frequency": "annual"},
    ],
    "perimeter security": [
        {"title": "Perimeter Security Policy", "description": "Policy for perimeter security", "artifact_type": "policy", "format_guidance": "Perimeter policy", "frequency": "annual"},
        {"title": "Perimeter Firewall Configuration", "description": "Configuration of perimeter firewall", "artifact_type": "configuration", "format_guidance": "Firewall rules", "frequency": "quarterly"},
    ],
    "third party assessment": [
        {"title": "Third Party Assessment Reports", "description": "Security assessments of third parties", "artifact_type": "report", "format_guidance": "Assessment reports", "frequency": "annual"},
        {"title": "Third Party Risk Ratings", "description": "Risk ratings for third parties", "artifact_type": "record", "format_guidance": "Risk rating matrix", "frequency": "annual"},
    ],
    "contractual requirements": [
        {"title": "Security Contract Requirements", "description": "Security requirements in contracts", "artifact_type": "record", "format_guidance": "Contract excerpts", "frequency": "annual"},
        {"title": "Contract Review Checklist", "description": "Checklist for contract review", "artifact_type": "record", "format_guidance": "Review checklist", "frequency": "annual"},
    ],
    "third party monitoring": [
        {"title": "Third Party Monitoring Procedure", "description": "Procedure for third party monitoring", "artifact_type": "policy", "format_guidance": "Monitoring procedure", "frequency": "annual"},
        {"title": "Third Party Performance Reports", "description": "Performance reports for third parties", "artifact_type": "report", "format_guidance": "Performance reports", "frequency": "quarterly"},
    ],
    "security monitoring": [
        {"title": "Security Monitoring Policy", "description": "Policy for security monitoring", "artifact_type": "policy", "format_guidance": "Monitoring policy", "frequency": "annual"},
        {"title": "Monitoring Dashboard Screenshot", "description": "Screenshot of monitoring dashboard", "artifact_type": "screenshot", "format_guidance": "Dashboard screenshot", "frequency": "monthly"},
    ],
    "vulnerability management": [
        {"title": "Vulnerability Management Policy", "description": "Policy for vulnerability management", "artifact_type": "policy", "format_guidance": "VM policy", "frequency": "annual"},
        {"title": "Vulnerability Scan Reports", "description": "Reports from vulnerability scans", "artifact_type": "report", "format_guidance": "Scan reports", "frequency": "quarterly"},
    ],
    "patch management": [
        {"title": "Patch Management Policy", "description": "Policy for patch management", "artifact_type": "policy", "format_guidance": "Patch policy", "frequency": "annual"},
        {"title": "Patch Compliance Report", "description": "Report of patch compliance", "artifact_type": "report", "format_guidance": "Compliance report", "frequency": "monthly"},
    ],
    "incident response plan": [
        {"title": "Incident Response Plan", "description": "Plan for incident response", "artifact_type": "policy", "format_guidance": "IR plan document", "frequency": "annual"},
        {"title": "IR Plan Test Results", "description": "Results of IR plan testing", "artifact_type": "report", "format_guidance": "Test results", "frequency": "annual"},
    ],
    "incident detection": [
        {"title": "Incident Detection Procedures", "description": "Procedures for detecting incidents", "artifact_type": "policy", "format_guidance": "Detection procedures", "frequency": "annual"},
        {"title": "Detection Rule Configuration", "description": "Configuration of detection rules", "artifact_type": "configuration", "format_guidance": "SIEM rule export", "frequency": "quarterly"},
    ],
    "incident reporting": [
        {"title": "Incident Reporting Procedure", "description": "Procedure for incident reporting", "artifact_type": "policy", "format_guidance": "Reporting procedure", "frequency": "annual"},
        {"title": "Incident Reports Sample", "description": "Sample incident reports", "artifact_type": "record", "format_guidance": "Redacted reports", "frequency": "quarterly"},
    ],
    "incident response testing": [
        {"title": "IR Testing Procedure", "description": "Procedure for IR testing", "artifact_type": "policy", "format_guidance": "Testing procedure", "frequency": "annual"},
        {"title": "IR Test Results", "description": "Results of IR testing", "artifact_type": "report", "format_guidance": "Test report", "frequency": "annual"},
    ],
    "change management": [
        {"title": "Change Management Policy", "description": "Policy for change management", "artifact_type": "policy", "format_guidance": "Change policy", "frequency": "annual"},
        {"title": "Change Request Samples", "description": "Sample change requests", "artifact_type": "record", "format_guidance": "Change tickets", "frequency": "quarterly"},
    ],
    "incident management": [
        {"title": "Incident Management Policy", "description": "Policy for incident management", "artifact_type": "policy", "format_guidance": "IM policy", "frequency": "annual"},
        {"title": "Incident Log", "description": "Log of incidents", "artifact_type": "log", "format_guidance": "Incident log export", "frequency": "monthly"},
    ],
    "problem management": [
        {"title": "Problem Management Policy", "description": "Policy for problem management", "artifact_type": "policy", "format_guidance": "PM policy", "frequency": "annual"},
        {"title": "Problem Log", "description": "Log of problems", "artifact_type": "log", "format_guidance": "Problem log export", "frequency": "quarterly"},
    ],
    "backup procedures": [
        {"title": "Backup Policy", "description": "Policy for backups", "artifact_type": "policy", "format_guidance": "Backup policy", "frequency": "annual"},
        {"title": "Backup Schedule", "description": "Configuration of backup schedules", "artifact_type": "configuration", "format_guidance": "Backup schedule", "frequency": "quarterly"},
        {"title": "Backup Status Report", "description": "Report of backup status", "artifact_type": "report", "format_guidance": "Backup status", "frequency": "monthly"},
    ],
    "recovery testing": [
        {"title": "Recovery Testing Procedure", "description": "Procedure for recovery testing", "artifact_type": "policy", "format_guidance": "Testing procedure", "frequency": "annual"},
        {"title": "Recovery Test Results", "description": "Results of recovery tests", "artifact_type": "report", "format_guidance": "Test results", "frequency": "annual"},
    ],
    "bcp": [
        {"title": "Business Continuity Plan", "description": "Business continuity plan", "artifact_type": "policy", "format_guidance": "BCP document", "frequency": "annual"},
        {"title": "BCP Test Results", "description": "Results of BCP testing", "artifact_type": "report", "format_guidance": "Test results", "frequency": "annual"},
    ],
    "disaster recovery": [
        {"title": "Disaster Recovery Plan", "description": "Disaster recovery plan", "artifact_type": "policy", "format_guidance": "DR plan", "frequency": "annual"},
        {"title": "DR Test Results", "description": "Results of DR testing", "artifact_type": "report", "format_guidance": "Test results", "frequency": "annual"},
    ],
    "outsourcing": [
        {"title": "Outsourcing Policy", "description": "Policy for IT outsourcing", "artifact_type": "policy", "format_guidance": "Outsourcing policy", "frequency": "annual"},
        {"title": "Outsourcing Risk Assessment", "description": "Risk assessment of outsourcing", "artifact_type": "report", "format_guidance": "Risk assessment", "frequency": "annual"},
    ],
    "vendor assessment": [
        {"title": "Vendor Assessment Procedure", "description": "Procedure for vendor assessment", "artifact_type": "policy", "format_guidance": "Assessment procedure", "frequency": "annual"},
        {"title": "Vendor Assessment Reports", "description": "Reports from vendor assessments", "artifact_type": "report", "format_guidance": "Assessment reports", "frequency": "annual"},
    ],
    "vendor monitoring": [
        {"title": "Vendor Monitoring Procedure", "description": "Procedure for vendor monitoring", "artifact_type": "policy", "format_guidance": "Monitoring procedure", "frequency": "annual"},
        {"title": "Vendor Performance Reports", "description": "Reports on vendor performance", "artifact_type": "report", "format_guidance": "Performance reports", "frequency": "quarterly"},
    ],
    "it governance": [
        {"title": "IT Governance Framework", "description": "IT governance framework documentation", "artifact_type": "policy", "format_guidance": "Framework document", "frequency": "annual"},
        {"title": "IT Governance Meeting Minutes", "description": "Minutes from IT governance meetings", "artifact_type": "record", "format_guidance": "Meeting minutes", "frequency": "quarterly"},
    ],
    "it strategy": [
        {"title": "IT Strategy Document", "description": "IT strategic plan", "artifact_type": "policy", "format_guidance": "Strategy document", "frequency": "annual"},
        {"title": "IT Strategy Review Records", "description": "Records of strategy reviews", "artifact_type": "record", "format_guidance": "Review records", "frequency": "annual"},
    ],
    "it policies": [
        {"title": "IT Policy Document", "description": "IT policies and procedures", "artifact_type": "policy", "format_guidance": "Policy document", "frequency": "annual"},
        {"title": "Policy Distribution Records", "description": "Records of policy distribution", "artifact_type": "record", "format_guidance": "Distribution records", "frequency": "annual"},
    ],
    "security policy": [
        {"title": "Information Security Policy", "description": "Information security policy", "artifact_type": "policy", "format_guidance": "Security policy", "frequency": "annual"},
        {"title": "Policy Approval Evidence", "description": "Evidence of policy approval", "artifact_type": "record", "format_guidance": "Approval records", "frequency": "annual"},
    ],
    "security organization": [
        {"title": "Security Organization Structure", "description": "Structure of security organization", "artifact_type": "record", "format_guidance": "Org chart", "frequency": "annual"},
        {"title": "Security Roles Documentation", "description": "Documentation of security roles", "artifact_type": "record", "format_guidance": "Role descriptions", "frequency": "annual"},
    ],
    "security awareness": [
        {"title": "Security Awareness Program", "description": "Security awareness program", "artifact_type": "policy", "format_guidance": "Program document", "frequency": "annual"},
        {"title": "Awareness Training Records", "description": "Records of awareness training", "artifact_type": "record", "format_guidance": "Training records", "frequency": "quarterly"},
    ],
    "user management": [
        {"title": "User Management Policy", "description": "Policy for user management", "artifact_type": "policy", "format_guidance": "User policy", "frequency": "annual"},
        {"title": "User Access Review", "description": "Results of user access review", "artifact_type": "report", "format_guidance": "Review report", "frequency": "quarterly"},
    ],
    # === ISO 20000 / SERVICE MANAGEMENT CONTROLS ===
    "determine external and internal issues": [
        {"title": "Context Analysis Document", "description": "Analysis of external and internal issues", "artifact_type": "record", "format_guidance": "Context analysis", "frequency": "annual"},
        {"title": "SWOT Analysis", "description": "SWOT analysis for the organization", "artifact_type": "record", "format_guidance": "SWOT document", "frequency": "annual"},
    ],
    "identify interested parties": [
        {"title": "Interested Parties Register", "description": "Register of interested parties", "artifact_type": "record", "format_guidance": "Stakeholder register", "frequency": "annual"},
        {"title": "Stakeholder Requirements", "description": "Requirements from interested parties", "artifact_type": "record", "format_guidance": "Requirements document", "frequency": "annual"},
    ],
    "define sms scope": [
        {"title": "SMS Scope Document", "description": "Scope of the SMS", "artifact_type": "policy", "format_guidance": "Scope statement", "frequency": "annual"},
        {"title": "Scope Boundaries Documentation", "description": "Documentation of scope boundaries", "artifact_type": "record", "format_guidance": "Boundaries document", "frequency": "annual"},
    ],
    "establish sms": [
        {"title": "SMS Documentation", "description": "Documentation of the SMS", "artifact_type": "policy", "format_guidance": "SMS manual", "frequency": "annual"},
        {"title": "SMS Process Documentation", "description": "Documented SMS processes", "artifact_type": "policy", "format_guidance": "Process documents", "frequency": "annual"},
    ],
    "demonstrate leadership": [
        {"title": "Leadership Commitment Evidence", "description": "Evidence of leadership commitment", "artifact_type": "record", "format_guidance": "Commitment statements", "frequency": "annual"},
        {"title": "Management Review Minutes", "description": "Minutes from management reviews", "artifact_type": "record", "format_guidance": "Review minutes", "frequency": "quarterly"},
    ],
    "service management policy": [
        {"title": "Service Management Policy", "description": "Service management policy", "artifact_type": "policy", "format_guidance": "Policy document", "frequency": "annual"},
        {"title": "Policy Communication Evidence", "description": "Evidence of policy communication", "artifact_type": "record", "format_guidance": "Communication records", "frequency": "annual"},
    ],
    "assign roles": [
        {"title": "Role Assignment Documentation", "description": "Documentation of role assignments", "artifact_type": "record", "format_guidance": "Assignment records", "frequency": "annual"},
        {"title": "Authority Matrix", "description": "Matrix of authorities", "artifact_type": "record", "format_guidance": "Authority matrix", "frequency": "annual"},
    ],
    "address risks and opportunities": [
        {"title": "Risk and Opportunity Register", "description": "Register of risks and opportunities", "artifact_type": "record", "format_guidance": "Risk register", "frequency": "quarterly"},
        {"title": "Risk Treatment Actions", "description": "Actions to address risks", "artifact_type": "record", "format_guidance": "Action plans", "frequency": "quarterly"},
    ],
    "establish objectives": [
        {"title": "Service Management Objectives", "description": "Documented objectives", "artifact_type": "record", "format_guidance": "Objectives document", "frequency": "annual"},
        {"title": "Objective Measurement Plan", "description": "Plan for measuring objectives", "artifact_type": "record", "format_guidance": "Measurement plan", "frequency": "annual"},
    ],
    "plan the sms": [
        {"title": "SMS Planning Document", "description": "Planning documentation for SMS", "artifact_type": "policy", "format_guidance": "Planning document", "frequency": "annual"},
        {"title": "Resource Plan", "description": "Resource planning for SMS", "artifact_type": "record", "format_guidance": "Resource plan", "frequency": "annual"},
    ],
    "determine resources": [
        {"title": "Resource Requirements", "description": "Documentation of resource requirements", "artifact_type": "record", "format_guidance": "Requirements document", "frequency": "annual"},
        {"title": "Resource Allocation Records", "description": "Records of resource allocation", "artifact_type": "record", "format_guidance": "Allocation records", "frequency": "quarterly"},
    ],
    "personnel competence": [
        {"title": "Competence Requirements", "description": "Documentation of competence requirements", "artifact_type": "record", "format_guidance": "Competence matrix", "frequency": "annual"},
        {"title": "Training Records", "description": "Records of training and competence", "artifact_type": "record", "format_guidance": "Training records", "frequency": "quarterly"},
    ],
    "awareness": [
        {"title": "Awareness Program", "description": "Awareness program documentation", "artifact_type": "policy", "format_guidance": "Program document", "frequency": "annual"},
        {"title": "Awareness Evidence", "description": "Evidence of awareness activities", "artifact_type": "record", "format_guidance": "Awareness records", "frequency": "quarterly"},
    ],
    "communications": [
        {"title": "Communication Procedure", "description": "Procedure for communications", "artifact_type": "policy", "format_guidance": "Communication procedure", "frequency": "annual"},
        {"title": "Communication Records", "description": "Records of communications", "artifact_type": "record", "format_guidance": "Communication log", "frequency": "quarterly"},
    ],
    "documentation": [
        {"title": "Documentation Control Procedure", "description": "Procedure for documentation control", "artifact_type": "policy", "format_guidance": "Control procedure", "frequency": "annual"},
        {"title": "Document Register", "description": "Register of controlled documents", "artifact_type": "record", "format_guidance": "Document register", "frequency": "quarterly"},
    ],
    "knowledge management": [
        {"title": "Knowledge Management Procedure", "description": "Procedure for knowledge management", "artifact_type": "policy", "format_guidance": "KM procedure", "frequency": "annual"},
        {"title": "Knowledge Base Records", "description": "Records of knowledge base content", "artifact_type": "record", "format_guidance": "KB export", "frequency": "quarterly"},
    ],
    "plan and control operations": [
        {"title": "Operational Planning Document", "description": "Operational planning documentation", "artifact_type": "policy", "format_guidance": "Planning document", "frequency": "annual"},
        {"title": "Operational Control Evidence", "description": "Evidence of operational controls", "artifact_type": "record", "format_guidance": "Control records", "frequency": "quarterly"},
    ],
    "service portfolio": [
        {"title": "Service Portfolio", "description": "Service portfolio documentation", "artifact_type": "record", "format_guidance": "Service catalog", "frequency": "quarterly"},
        {"title": "Service Portfolio Review", "description": "Review of service portfolio", "artifact_type": "record", "format_guidance": "Review records", "frequency": "quarterly"},
    ],
    "business relationship management": [
        {"title": "Customer Relationship Procedure", "description": "Procedure for managing customer relationships", "artifact_type": "policy", "format_guidance": "BRM procedure", "frequency": "annual"},
        {"title": "Customer Satisfaction Survey", "description": "Results of customer satisfaction surveys", "artifact_type": "report", "format_guidance": "Survey results", "frequency": "quarterly"},
    ],
    "service level management": [
        {"title": "Service Level Agreements", "description": "Sample SLAs", "artifact_type": "record", "format_guidance": "SLA documents", "frequency": "annual"},
        {"title": "SLA Performance Report", "description": "Report on SLA performance", "artifact_type": "report", "format_guidance": "Performance report", "frequency": "monthly"},
    ],
    "supplier management": [
        {"title": "Supplier Management Procedure", "description": "Procedure for supplier management", "artifact_type": "policy", "format_guidance": "SM procedure", "frequency": "annual"},
        {"title": "Supplier Performance Report", "description": "Report on supplier performance", "artifact_type": "report", "format_guidance": "Performance report", "frequency": "quarterly"},
    ],
    "budgeting and accounting": [
        {"title": "IT Budget", "description": "IT budget documentation", "artifact_type": "record", "format_guidance": "Budget document", "frequency": "annual"},
        {"title": "IT Cost Report", "description": "Report of IT costs", "artifact_type": "report", "format_guidance": "Cost report", "frequency": "quarterly"},
    ],
    "demand management": [
        {"title": "Demand Management Procedure", "description": "Procedure for demand management", "artifact_type": "policy", "format_guidance": "DM procedure", "frequency": "annual"},
        {"title": "Demand Forecast", "description": "Demand forecasting documentation", "artifact_type": "record", "format_guidance": "Forecast document", "frequency": "quarterly"},
    ],
    "capacity management": [
        {"title": "Capacity Management Procedure", "description": "Procedure for capacity management", "artifact_type": "policy", "format_guidance": "CM procedure", "frequency": "annual"},
        {"title": "Capacity Report", "description": "Report on capacity utilization", "artifact_type": "report", "format_guidance": "Capacity report", "frequency": "quarterly"},
    ],
    "service design and transition": [
        {"title": "Service Design Procedure", "description": "Procedure for service design", "artifact_type": "policy", "format_guidance": "Design procedure", "frequency": "annual"},
        {"title": "Service Design Package", "description": "Sample service design package", "artifact_type": "record", "format_guidance": "SDP document", "frequency": "as_needed"},
    ],
    "release and deployment": [
        {"title": "Release Management Procedure", "description": "Procedure for release management", "artifact_type": "policy", "format_guidance": "Release procedure", "frequency": "annual"},
        {"title": "Release Records", "description": "Records of releases deployed", "artifact_type": "log", "format_guidance": "Release log", "frequency": "monthly"},
    ],
    "service request management": [
        {"title": "Service Request Procedure", "description": "Procedure for service requests", "artifact_type": "policy", "format_guidance": "SR procedure", "frequency": "annual"},
        {"title": "Service Request Log", "description": "Log of service requests", "artifact_type": "log", "format_guidance": "SR log export", "frequency": "monthly"},
    ],
    "service availability": [
        {"title": "Availability Management Procedure", "description": "Procedure for availability management", "artifact_type": "policy", "format_guidance": "AM procedure", "frequency": "annual"},
        {"title": "Availability Report", "description": "Report on service availability", "artifact_type": "report", "format_guidance": "Availability report", "frequency": "monthly"},
    ],
    "service continuity": [
        {"title": "Service Continuity Plan", "description": "Plan for service continuity", "artifact_type": "policy", "format_guidance": "Continuity plan", "frequency": "annual"},
        {"title": "Continuity Test Results", "description": "Results of continuity testing", "artifact_type": "report", "format_guidance": "Test results", "frequency": "annual"},
    ],
    "information security management": [
        {"title": "Information Security Management System", "description": "ISMS documentation", "artifact_type": "policy", "format_guidance": "ISMS manual", "frequency": "annual"},
        {"title": "Security Controls Assessment", "description": "Assessment of security controls", "artifact_type": "report", "format_guidance": "Control assessment", "frequency": "annual"},
    ],
    "monitor and measure": [
        {"title": "Monitoring Procedure", "description": "Procedure for monitoring and measurement", "artifact_type": "policy", "format_guidance": "Monitoring procedure", "frequency": "annual"},
        {"title": "Measurement Results", "description": "Results of measurements", "artifact_type": "report", "format_guidance": "Measurement report", "frequency": "quarterly"},
    ],
    "internal audit": [
        {"title": "Internal Audit Procedure", "description": "Procedure for internal audits", "artifact_type": "policy", "format_guidance": "Audit procedure", "frequency": "annual"},
        {"title": "Internal Audit Report", "description": "Report from internal audits", "artifact_type": "report", "format_guidance": "Audit report", "frequency": "annual"},
    ],
    "management review": [
        {"title": "Management Review Procedure", "description": "Procedure for management reviews", "artifact_type": "policy", "format_guidance": "Review procedure", "frequency": "annual"},
        {"title": "Management Review Minutes", "description": "Minutes from management reviews", "artifact_type": "record", "format_guidance": "Review minutes", "frequency": "quarterly"},
    ],
    "service reports": [
        {"title": "Service Reporting Procedure", "description": "Procedure for service reporting", "artifact_type": "policy", "format_guidance": "Reporting procedure", "frequency": "annual"},
        {"title": "Service Report Samples", "description": "Sample service reports", "artifact_type": "report", "format_guidance": "Report samples", "frequency": "monthly"},
    ],
    "manage nonconformities": [
        {"title": "Nonconformity Procedure", "description": "Procedure for managing nonconformities", "artifact_type": "policy", "format_guidance": "NC procedure", "frequency": "annual"},
        {"title": "Nonconformity Log", "description": "Log of nonconformities", "artifact_type": "log", "format_guidance": "NC log", "frequency": "quarterly"},
    ],
    "continual improvement": [
        {"title": "Continual Improvement Procedure", "description": "Procedure for continual improvement", "artifact_type": "policy", "format_guidance": "CI procedure", "frequency": "annual"},
        {"title": "Improvement Register", "description": "Register of improvements", "artifact_type": "record", "format_guidance": "Improvement log", "frequency": "quarterly"},
    ],
    # === PCI DSS SPECIFIC CONTROLS ===
    "inbound traffic": [
        {"title": "Inbound Firewall Rules", "description": "Firewall rules controlling inbound traffic", "artifact_type": "configuration", "format_guidance": "Firewall inbound rules export", "frequency": "quarterly"},
        {"title": "Inbound Traffic Policy", "description": "Policy for inbound traffic control", "artifact_type": "policy", "format_guidance": "Network policy document", "frequency": "annual"},
    ],
    "outbound traffic": [
        {"title": "Outbound Firewall Rules", "description": "Firewall rules controlling outbound traffic", "artifact_type": "configuration", "format_guidance": "Firewall outbound rules export", "frequency": "quarterly"},
        {"title": "Outbound Traffic Policy", "description": "Policy for outbound traffic control", "artifact_type": "policy", "format_guidance": "Network policy document", "frequency": "annual"},
    ],
    "nscs between": [
        {"title": "Network Segmentation Configuration", "description": "NSC configuration between network zones", "artifact_type": "configuration", "format_guidance": "Firewall/segmentation rules", "frequency": "quarterly"},
        {"title": "Network Segmentation Diagram", "description": "Diagram showing NSC placement", "artifact_type": "configuration", "format_guidance": "Network diagram", "frequency": "annual"},
    ],
    "anti-spoofing": [
        {"title": "Anti-Spoofing Configuration", "description": "Configuration of anti-spoofing controls", "artifact_type": "configuration", "format_guidance": "Firewall anti-spoofing settings", "frequency": "quarterly"},
        {"title": "Anti-Spoofing Test Results", "description": "Test results verifying anti-spoofing", "artifact_type": "report", "format_guidance": "Test results", "frequency": "annual"},
    ],
    "system components isolated": [
        {"title": "CDE Isolation Configuration", "description": "Configuration showing CDE isolation", "artifact_type": "configuration", "format_guidance": "Network segmentation rules", "frequency": "quarterly"},
        {"title": "Isolation Verification Report", "description": "Report verifying CDE isolation", "artifact_type": "report", "format_guidance": "Penetration test or scan results", "frequency": "annual"},
    ],
    "internal ip addresses": [
        {"title": "NAT Configuration", "description": "NAT/PAT configuration hiding internal IPs", "artifact_type": "configuration", "format_guidance": "NAT configuration export", "frequency": "quarterly"},
        {"title": "IP Address Protection Policy", "description": "Policy for protecting internal IPs", "artifact_type": "policy", "format_guidance": "Network policy document", "frequency": "annual"},
    ],
    "security policies defined": [
        {"title": "Security Policy Document", "description": "Documented security policies and procedures", "artifact_type": "policy", "format_guidance": "Policy document with version", "frequency": "annual"},
        {"title": "Policy Communication Evidence", "description": "Evidence of policy communication to staff", "artifact_type": "record", "format_guidance": "Distribution records", "frequency": "annual"},
        {"title": "Policy Review Records", "description": "Records of policy review", "artifact_type": "record", "format_guidance": "Review meeting minutes", "frequency": "annual"},
    ],
    "roles assigned": [
        {"title": "Role Assignment Matrix", "description": "Matrix of security role assignments", "artifact_type": "record", "format_guidance": "RACI or role matrix", "frequency": "annual"},
        {"title": "Role Assignment Evidence", "description": "Evidence of role assignments", "artifact_type": "record", "format_guidance": "Assignment documentation", "frequency": "quarterly"},
    ],
    "primary functions separated": [
        {"title": "Function Separation Documentation", "description": "Documentation of function separation", "artifact_type": "record", "format_guidance": "Separation matrix", "frequency": "annual"},
        {"title": "Server/VM Configuration", "description": "Configuration showing separated functions", "artifact_type": "configuration", "format_guidance": "System configuration", "frequency": "quarterly"},
    ],
    "only necessary services": [
        {"title": "Running Services Audit", "description": "Audit of running services on systems", "artifact_type": "report", "format_guidance": "Service audit report", "frequency": "quarterly"},
        {"title": "Service Justification Matrix", "description": "Justification for enabled services", "artifact_type": "record", "format_guidance": "Service matrix with justification", "frequency": "annual"},
    ],
    "insecure services secured": [
        {"title": "Insecure Service Mitigation", "description": "Mitigation controls for insecure services", "artifact_type": "configuration", "format_guidance": "Security configuration", "frequency": "quarterly"},
        {"title": "Insecure Service Risk Assessment", "description": "Risk assessment for insecure services", "artifact_type": "report", "format_guidance": "Risk assessment document", "frequency": "annual"},
    ],
    "system security parameters": [
        {"title": "Security Parameter Configuration", "description": "Configuration of security parameters", "artifact_type": "configuration", "format_guidance": "System settings export", "frequency": "quarterly"},
        {"title": "Security Baseline Compliance", "description": "Compliance with security baseline", "artifact_type": "report", "format_guidance": "Baseline compliance report", "frequency": "quarterly"},
    ],
    "data retention": [
        {"title": "Data Retention Policy", "description": "Policy for data retention", "artifact_type": "policy", "format_guidance": "Retention policy document", "frequency": "annual"},
        {"title": "Data Retention Schedule", "description": "Schedule for data retention", "artifact_type": "record", "format_guidance": "Retention schedule", "frequency": "annual"},
        {"title": "Data Purge Records", "description": "Records of data purging", "artifact_type": "log", "format_guidance": "Purge log", "frequency": "quarterly"},
    ],
    "technical controls for masking": [
        {"title": "PAN Masking Configuration", "description": "Technical configuration of PAN masking", "artifact_type": "configuration", "format_guidance": "Masking settings", "frequency": "quarterly"},
        {"title": "Masking Verification Evidence", "description": "Evidence that masking is working", "artifact_type": "screenshot", "format_guidance": "Screenshots showing masked PAN", "frequency": "quarterly"},
    ],
    "retention schedules": [
        {"title": "Data Retention Schedule", "description": "Schedule for data retention periods", "artifact_type": "record", "format_guidance": "Retention schedule document", "frequency": "annual"},
        {"title": "Retention Policy", "description": "Policy governing data retention", "artifact_type": "policy", "format_guidance": "Retention policy", "frequency": "annual"},
    ],
    "secure deletion": [
        {"title": "Secure Deletion Procedure", "description": "Procedure for secure data deletion", "artifact_type": "policy", "format_guidance": "Deletion procedure", "frequency": "annual"},
        {"title": "Secure Deletion Evidence", "description": "Evidence of secure deletion", "artifact_type": "record", "format_guidance": "Deletion certificates", "frequency": "quarterly"},
    ],
    "strong cryptography used": [
        {"title": "Cryptography Configuration", "description": "Configuration of strong cryptography", "artifact_type": "configuration", "format_guidance": "TLS/encryption settings", "frequency": "quarterly"},
        {"title": "Cryptography Standards", "description": "Standards for cryptography", "artifact_type": "policy", "format_guidance": "Cryptography policy", "frequency": "annual"},
    ],
    "developers trained": [
        {"title": "Developer Security Training", "description": "Security training for developers", "artifact_type": "record", "format_guidance": "Training completion records", "frequency": "annual"},
        {"title": "Secure Coding Training Materials", "description": "Training materials for secure coding", "artifact_type": "record", "format_guidance": "Training curriculum", "frequency": "annual"},
    ],
    "public-facing apps protected": [
        {"title": "WAF Configuration", "description": "Web application firewall configuration", "artifact_type": "configuration", "format_guidance": "WAF settings", "frequency": "quarterly"},
        {"title": "Application Security Test Results", "description": "Security test results for public apps", "artifact_type": "report", "format_guidance": "Pen test or DAST results", "frequency": "annual"},
    ],
    "payment page scripts": [
        {"title": "Payment Page Script Inventory", "description": "Inventory of scripts on payment pages", "artifact_type": "record", "format_guidance": "Script inventory", "frequency": "quarterly"},
        {"title": "Script Authorization Records", "description": "Authorization for payment page scripts", "artifact_type": "record", "format_guidance": "Authorization records", "frequency": "quarterly"},
    ],
    "changes controlled": [
        {"title": "Change Control Procedure", "description": "Procedure for change control", "artifact_type": "policy", "format_guidance": "Change procedure document", "frequency": "annual"},
        {"title": "Change Request Log", "description": "Log of change requests", "artifact_type": "log", "format_guidance": "Change management log", "frequency": "monthly"},
    ],
    "significant changes tested": [
        {"title": "Change Testing Records", "description": "Records of testing for significant changes", "artifact_type": "record", "format_guidance": "Test results", "frequency": "quarterly"},
        {"title": "Testing Procedure", "description": "Procedure for change testing", "artifact_type": "policy", "format_guidance": "Testing procedure", "frequency": "annual"},
    ],
    "separation of duties": [
        {"title": "SoD Matrix", "description": "Segregation of duties matrix", "artifact_type": "record", "format_guidance": "SoD matrix spreadsheet", "frequency": "annual"},
        {"title": "SoD Enforcement Evidence", "description": "Evidence of SoD enforcement", "artifact_type": "configuration", "format_guidance": "Access control settings", "frequency": "quarterly"},
    ],
    "live pans not used": [
        {"title": "Test Data Policy", "description": "Policy for test data usage", "artifact_type": "policy", "format_guidance": "Test data policy", "frequency": "annual"},
        {"title": "Test Environment Verification", "description": "Verification that live PANs not in test", "artifact_type": "report", "format_guidance": "Environment scan results", "frequency": "quarterly"},
    ],
    "test data removed": [
        {"title": "Test Data Removal Procedure", "description": "Procedure for removing test data", "artifact_type": "policy", "format_guidance": "Removal procedure", "frequency": "annual"},
        {"title": "Test Data Removal Evidence", "description": "Evidence of test data removal", "artifact_type": "record", "format_guidance": "Removal records", "frequency": "quarterly"},
    ],
    "access assigned based on job": [
        {"title": "Role-Based Access Control Matrix", "description": "RBAC matrix for access assignments", "artifact_type": "record", "format_guidance": "RBAC matrix", "frequency": "annual"},
        {"title": "Access Assignment Procedure", "description": "Procedure for access assignment", "artifact_type": "policy", "format_guidance": "Assignment procedure", "frequency": "annual"},
    ],
    "privileges assigned by authorized": [
        {"title": "Authorization Workflow", "description": "Workflow for privilege authorization", "artifact_type": "policy", "format_guidance": "Workflow documentation", "frequency": "annual"},
        {"title": "Authorization Records", "description": "Records of privilege authorization", "artifact_type": "record", "format_guidance": "Approval records", "frequency": "quarterly"},
    ],
    "least privilege": [
        {"title": "Least Privilege Policy", "description": "Policy for least privilege access", "artifact_type": "policy", "format_guidance": "Least privilege policy", "frequency": "annual"},
        {"title": "Least Privilege Review", "description": "Review of least privilege compliance", "artifact_type": "report", "format_guidance": "Access review report", "frequency": "quarterly"},
    ],
    "unique ids assigned": [
        {"title": "Unique ID Policy", "description": "Policy for unique user identifiers", "artifact_type": "policy", "format_guidance": "ID policy document", "frequency": "annual"},
        {"title": "User ID Inventory", "description": "Inventory of user IDs", "artifact_type": "record", "format_guidance": "User ID listing", "frequency": "quarterly"},
    ],
    "shared accounts managed": [
        {"title": "Shared Account Policy", "description": "Policy for shared account management", "artifact_type": "policy", "format_guidance": "Shared account policy", "frequency": "annual"},
        {"title": "Shared Account Inventory", "description": "Inventory of shared accounts", "artifact_type": "record", "format_guidance": "Account inventory", "frequency": "quarterly"},
    ],
    "service accounts managed": [
        {"title": "Service Account Policy", "description": "Policy for service account management", "artifact_type": "policy", "format_guidance": "Service account policy", "frequency": "annual"},
        {"title": "Service Account Inventory", "description": "Inventory of service accounts", "artifact_type": "record", "format_guidance": "Account inventory", "frequency": "quarterly"},
    ],
    "user lifecycle managed": [
        {"title": "User Lifecycle Policy", "description": "Policy for user lifecycle management", "artifact_type": "policy", "format_guidance": "Lifecycle policy", "frequency": "annual"},
        {"title": "Lifecycle Management Evidence", "description": "Evidence of lifecycle management", "artifact_type": "record", "format_guidance": "Joiner/mover/leaver records", "frequency": "quarterly"},
    ],
    "terminated access revoked": [
        {"title": "Termination Access Procedure", "description": "Procedure for revoking terminated access", "artifact_type": "policy", "format_guidance": "Revocation procedure", "frequency": "annual"},
        {"title": "Access Revocation Log", "description": "Log of access revocations", "artifact_type": "log", "format_guidance": "IAM revocation log", "frequency": "monthly"},
    ],
    "inactive accounts removed": [
        {"title": "Inactive Account Policy", "description": "Policy for inactive account management", "artifact_type": "policy", "format_guidance": "Account policy", "frequency": "annual"},
        {"title": "Inactive Account Review", "description": "Review of inactive accounts", "artifact_type": "report", "format_guidance": "Account review report", "frequency": "quarterly"},
    ],
    "inactive session timeout": [
        {"title": "Session Timeout Configuration", "description": "Configuration of session timeouts", "artifact_type": "configuration", "format_guidance": "Session settings", "frequency": "quarterly"},
        {"title": "Session Policy", "description": "Policy for session management", "artifact_type": "policy", "format_guidance": "Session policy", "frequency": "annual"},
    ],
    "interactive login restricted": [
        {"title": "Interactive Login Policy", "description": "Policy for interactive login restrictions", "artifact_type": "policy", "format_guidance": "Login policy", "frequency": "annual"},
        {"title": "Login Restriction Configuration", "description": "Configuration of login restrictions", "artifact_type": "configuration", "format_guidance": "Login settings", "frequency": "quarterly"},
    ],
    "visitors managed": [
        {"title": "Visitor Management Policy", "description": "Policy for visitor management", "artifact_type": "policy", "format_guidance": "Visitor policy", "frequency": "annual"},
        {"title": "Visitor Log", "description": "Log of visitor access", "artifact_type": "log", "format_guidance": "Visitor log", "frequency": "monthly"},
    ],
    "visitor badges": [
        {"title": "Visitor Badge Procedure", "description": "Procedure for visitor badges", "artifact_type": "policy", "format_guidance": "Badge procedure", "frequency": "annual"},
        {"title": "Badge Sample", "description": "Sample visitor badge", "artifact_type": "record", "format_guidance": "Badge image", "frequency": "annual"},
    ],
    "physical access to cde": [
        {"title": "CDE Physical Access Controls", "description": "Controls for physical access to CDE", "artifact_type": "configuration", "format_guidance": "Access control configuration", "frequency": "quarterly"},
        {"title": "CDE Access Log", "description": "Log of physical access to CDE", "artifact_type": "log", "format_guidance": "Access log", "frequency": "monthly"},
    ],
    "identification for personnel": [
        {"title": "Personnel Identification Policy", "description": "Policy for personnel identification", "artifact_type": "policy", "format_guidance": "ID policy", "frequency": "annual"},
        {"title": "Badge System Configuration", "description": "Configuration of badge system", "artifact_type": "configuration", "format_guidance": "Badge system settings", "frequency": "quarterly"},
    ],
    "physical access revoked": [
        {"title": "Physical Access Revocation Procedure", "description": "Procedure for revoking physical access", "artifact_type": "policy", "format_guidance": "Revocation procedure", "frequency": "annual"},
        {"title": "Physical Access Revocation Log", "description": "Log of access revocations", "artifact_type": "log", "format_guidance": "Revocation log", "frequency": "monthly"},
    ],
    "media physically secured": [
        {"title": "Media Security Policy", "description": "Policy for media physical security", "artifact_type": "policy", "format_guidance": "Media policy", "frequency": "annual"},
        {"title": "Secure Storage Evidence", "description": "Evidence of secure media storage", "artifact_type": "record", "format_guidance": "Storage documentation", "frequency": "quarterly"},
    ],
    "media classified": [
        {"title": "Media Classification Procedure", "description": "Procedure for classifying media", "artifact_type": "policy", "format_guidance": "Classification procedure", "frequency": "annual"},
        {"title": "Media Classification Records", "description": "Records of media classification", "artifact_type": "record", "format_guidance": "Classification records", "frequency": "quarterly"},
    ],
    "media sent via secured courier": [
        {"title": "Media Transport Policy", "description": "Policy for secure media transport", "artifact_type": "policy", "format_guidance": "Transport policy", "frequency": "annual"},
        {"title": "Courier Service Documentation", "description": "Documentation of secure courier service", "artifact_type": "record", "format_guidance": "Courier contracts", "frequency": "annual"},
    ],
    "media requiring destruction tracked": [
        {"title": "Media Destruction Tracking", "description": "Tracking of media requiring destruction", "artifact_type": "log", "format_guidance": "Destruction tracking log", "frequency": "quarterly"},
        {"title": "Destruction Procedure", "description": "Procedure for media destruction", "artifact_type": "policy", "format_guidance": "Destruction procedure", "frequency": "annual"},
    ],
    "electronic media destroyed": [
        {"title": "Electronic Media Destruction Records", "description": "Records of electronic media destruction", "artifact_type": "record", "format_guidance": "Destruction certificates", "frequency": "quarterly"},
        {"title": "Destruction Method Documentation", "description": "Documentation of destruction methods", "artifact_type": "policy", "format_guidance": "Method documentation", "frequency": "annual"},
    ],
    "hardcopy media destroyed": [
        {"title": "Hardcopy Destruction Records", "description": "Records of hardcopy destruction", "artifact_type": "record", "format_guidance": "Destruction certificates", "frequency": "quarterly"},
        {"title": "Shredding Policy", "description": "Policy for document shredding", "artifact_type": "policy", "format_guidance": "Shredding policy", "frequency": "annual"},
    ],
    "poi devices inventoried": [
        {"title": "POI Device Inventory", "description": "Inventory of POI devices", "artifact_type": "record", "format_guidance": "Device inventory", "frequency": "quarterly"},
        {"title": "POI Device Policy", "description": "Policy for POI device management", "artifact_type": "policy", "format_guidance": "Device policy", "frequency": "annual"},
    ],
    "poi devices inspected": [
        {"title": "POI Inspection Procedure", "description": "Procedure for POI device inspection", "artifact_type": "policy", "format_guidance": "Inspection procedure", "frequency": "annual"},
        {"title": "POI Inspection Log", "description": "Log of POI device inspections", "artifact_type": "log", "format_guidance": "Inspection log", "frequency": "monthly"},
    ],
    "training on poi tampering": [
        {"title": "POI Tampering Training", "description": "Training on detecting POI tampering", "artifact_type": "record", "format_guidance": "Training records", "frequency": "annual"},
        {"title": "POI Training Materials", "description": "Training materials for POI awareness", "artifact_type": "record", "format_guidance": "Training materials", "frequency": "annual"},
    ],
    "daily log review": [
        {"title": "Daily Log Review Procedure", "description": "Procedure for daily log review", "artifact_type": "policy", "format_guidance": "Review procedure", "frequency": "annual"},
        {"title": "Daily Log Review Evidence", "description": "Evidence of daily log reviews", "artifact_type": "log", "format_guidance": "Review attestations", "frequency": "weekly"},
    ],
    "periodic log review": [
        {"title": "Periodic Log Review Procedure", "description": "Procedure for periodic log review", "artifact_type": "policy", "format_guidance": "Review procedure", "frequency": "annual"},
        {"title": "Log Review Reports", "description": "Reports from log reviews", "artifact_type": "report", "format_guidance": "Review reports", "frequency": "quarterly"},
    ],
    "exceptions followed up": [
        {"title": "Exception Follow-up Procedure", "description": "Procedure for following up exceptions", "artifact_type": "policy", "format_guidance": "Follow-up procedure", "frequency": "annual"},
        {"title": "Exception Follow-up Log", "description": "Log of exception follow-ups", "artifact_type": "log", "format_guidance": "Follow-up log", "frequency": "monthly"},
    ],
    "system clocks synchronized": [
        {"title": "Time Synchronization Configuration", "description": "Configuration of time synchronization", "artifact_type": "configuration", "format_guidance": "NTP settings", "frequency": "quarterly"},
        {"title": "Time Sync Policy", "description": "Policy for time synchronization", "artifact_type": "policy", "format_guidance": "Time policy", "frequency": "annual"},
    ],
    "time data protected": [
        {"title": "Time Source Protection", "description": "Protection of time sources", "artifact_type": "configuration", "format_guidance": "Time server security", "frequency": "quarterly"},
        {"title": "Time Data Access Controls", "description": "Access controls for time data", "artifact_type": "configuration", "format_guidance": "Access control settings", "frequency": "quarterly"},
    ],
    "time settings protected": [
        {"title": "Time Settings Security", "description": "Security of time settings", "artifact_type": "configuration", "format_guidance": "System time security", "frequency": "quarterly"},
        {"title": "Time Change Log", "description": "Log of time setting changes", "artifact_type": "log", "format_guidance": "Audit log", "frequency": "monthly"},
    ],
    "failures detected": [
        {"title": "Failure Detection Configuration", "description": "Configuration of failure detection", "artifact_type": "configuration", "format_guidance": "Monitoring settings", "frequency": "quarterly"},
        {"title": "Failure Alert Procedure", "description": "Procedure for failure alerts", "artifact_type": "policy", "format_guidance": "Alert procedure", "frequency": "annual"},
    ],
    "security control failures addressed": [
        {"title": "Control Failure Response Procedure", "description": "Procedure for addressing control failures", "artifact_type": "policy", "format_guidance": "Response procedure", "frequency": "annual"},
        {"title": "Control Failure Log", "description": "Log of control failures and responses", "artifact_type": "log", "format_guidance": "Failure log", "frequency": "monthly"},
    ],
    "authorized wireless aps identified": [
        {"title": "Wireless AP Inventory", "description": "Inventory of authorized wireless APs", "artifact_type": "record", "format_guidance": "AP inventory", "frequency": "quarterly"},
        {"title": "Wireless Policy", "description": "Policy for wireless networks", "artifact_type": "policy", "format_guidance": "Wireless policy", "frequency": "annual"},
    ],
    "wireless scanning performed": [
        {"title": "Wireless Scan Results", "description": "Results of wireless scanning", "artifact_type": "report", "format_guidance": "Scan results", "frequency": "quarterly"},
        {"title": "Wireless Scanning Procedure", "description": "Procedure for wireless scanning", "artifact_type": "policy", "format_guidance": "Scanning procedure", "frequency": "annual"},
    ],
    "scans after significant changes": [
        {"title": "Post-Change Scan Results", "description": "Scan results after significant changes", "artifact_type": "report", "format_guidance": "Scan results", "frequency": "as_needed"},
        {"title": "Post-Change Scan Procedure", "description": "Procedure for post-change scanning", "artifact_type": "policy", "format_guidance": "Scan procedure", "frequency": "annual"},
    ],
    "segmentation testing performed": [
        {"title": "Segmentation Test Results", "description": "Results of segmentation testing", "artifact_type": "report", "format_guidance": "Penetration test results", "frequency": "annual"},
        {"title": "Segmentation Test Procedure", "description": "Procedure for segmentation testing", "artifact_type": "policy", "format_guidance": "Test procedure", "frequency": "annual"},
    ],
    "ids/ips deployed": [
        {"title": "IDS/IPS Configuration", "description": "Configuration of IDS/IPS", "artifact_type": "configuration", "format_guidance": "IDS settings", "frequency": "quarterly"},
        {"title": "IDS/IPS Deployment Documentation", "description": "Documentation of IDS/IPS deployment", "artifact_type": "record", "format_guidance": "Deployment documentation", "frequency": "annual"},
    ],
    "change-detection mechanism": [
        {"title": "Change Detection Configuration", "description": "Configuration of change detection", "artifact_type": "configuration", "format_guidance": "FIM settings", "frequency": "quarterly"},
        {"title": "Change Detection Alerts", "description": "Sample change detection alerts", "artifact_type": "log", "format_guidance": "Alert samples", "frequency": "monthly"},
    ],
    "payment page monitoring": [
        {"title": "Payment Page Monitoring Configuration", "description": "Configuration of payment page monitoring", "artifact_type": "configuration", "format_guidance": "Monitoring settings", "frequency": "quarterly"},
        {"title": "Payment Page Change Log", "description": "Log of payment page changes", "artifact_type": "log", "format_guidance": "Change log", "frequency": "monthly"},
    ],
    "hardware/software technologies reviewed": [
        {"title": "Technology Review Report", "description": "Review of hardware/software technologies", "artifact_type": "report", "format_guidance": "Technology review", "frequency": "annual"},
        {"title": "Technology Inventory", "description": "Inventory of technologies in use", "artifact_type": "record", "format_guidance": "Technology inventory", "frequency": "quarterly"},
    ],
    "responsibility for compliance assigned": [
        {"title": "Compliance Responsibility Matrix", "description": "Matrix of compliance responsibilities", "artifact_type": "record", "format_guidance": "RACI matrix", "frequency": "annual"},
        {"title": "Compliance Role Assignments", "description": "Assignments of compliance roles", "artifact_type": "record", "format_guidance": "Assignment records", "frequency": "annual"},
    ],
    "compliance reviews performed": [
        {"title": "Compliance Review Report", "description": "Report of compliance reviews", "artifact_type": "report", "format_guidance": "Review report", "frequency": "quarterly"},
        {"title": "Compliance Review Schedule", "description": "Schedule of compliance reviews", "artifact_type": "record", "format_guidance": "Review schedule", "frequency": "annual"},
    ],
    "pci dss scope documented": [
        {"title": "PCI DSS Scope Document", "description": "Documentation of PCI DSS scope", "artifact_type": "record", "format_guidance": "Scope document", "frequency": "annual"},
        {"title": "CDE Inventory", "description": "Inventory of CDE components", "artifact_type": "record", "format_guidance": "CDE inventory", "frequency": "quarterly"},
    ],
    "scope validated annually": [
        {"title": "Annual Scope Validation", "description": "Annual validation of PCI scope", "artifact_type": "report", "format_guidance": "Validation report", "frequency": "annual"},
        {"title": "Scope Validation Procedure", "description": "Procedure for scope validation", "artifact_type": "policy", "format_guidance": "Validation procedure", "frequency": "annual"},
    ],
    "scope validated after significant change": [
        {"title": "Post-Change Scope Validation", "description": "Scope validation after changes", "artifact_type": "report", "format_guidance": "Validation report", "frequency": "as_needed"},
        {"title": "Change Impact Assessment", "description": "Assessment of change impact on scope", "artifact_type": "record", "format_guidance": "Impact assessment", "frequency": "as_needed"},
    ],
    "personnel acknowledge policies": [
        {"title": "Policy Acknowledgment Records", "description": "Records of personnel acknowledging policies", "artifact_type": "record", "format_guidance": "Signed acknowledgments", "frequency": "annual"},
        {"title": "Acknowledgment Tracking", "description": "Tracking of policy acknowledgments", "artifact_type": "record", "format_guidance": "Tracking spreadsheet", "frequency": "annual"},
    ],
    "background checks performed": [
        {"title": "Background Check Policy", "description": "Policy for background checks", "artifact_type": "policy", "format_guidance": "Background check policy", "frequency": "annual"},
        {"title": "Background Check Records", "description": "Records of background checks", "artifact_type": "record", "format_guidance": "Check completion records", "frequency": "as_needed"},
    ],
    "tpsp agreements maintained": [
        {"title": "TPSP Agreement Inventory", "description": "Inventory of TPSP agreements", "artifact_type": "record", "format_guidance": "Agreement registry", "frequency": "annual"},
        {"title": "TPSP Agreement Samples", "description": "Sample TPSP agreements", "artifact_type": "record", "format_guidance": "Agreement excerpts", "frequency": "annual"},
    ],
    "tpsp engagement process": [
        {"title": "TPSP Engagement Procedure", "description": "Procedure for TPSP engagement", "artifact_type": "policy", "format_guidance": "Engagement procedure", "frequency": "annual"},
        {"title": "TPSP Due Diligence Records", "description": "Due diligence records for TPSPs", "artifact_type": "record", "format_guidance": "Due diligence forms", "frequency": "annual"},
    ],
    "tpsp compliance monitored": [
        {"title": "TPSP Compliance Monitoring", "description": "Monitoring of TPSP compliance", "artifact_type": "report", "format_guidance": "Monitoring reports", "frequency": "annual"},
        {"title": "TPSP AOC Registry", "description": "Registry of TPSP AOCs", "artifact_type": "record", "format_guidance": "AOC registry", "frequency": "annual"},
    ],
    "tpsp responsibility documented": [
        {"title": "TPSP Responsibility Matrix", "description": "Matrix of TPSP responsibilities", "artifact_type": "record", "format_guidance": "Responsibility matrix", "frequency": "annual"},
        {"title": "TPSP Responsibility Agreements", "description": "Documented TPSP responsibilities", "artifact_type": "record", "format_guidance": "Agreement excerpts", "frequency": "annual"},
    ],
    "tpsp provides aoc": [
        {"title": "TPSP AOC Collection", "description": "Collection of TPSP AOCs", "artifact_type": "record", "format_guidance": "AOC documents", "frequency": "annual"},
        {"title": "AOC Review Records", "description": "Records of AOC review", "artifact_type": "record", "format_guidance": "Review records", "frequency": "annual"},
    ],
    # === NIST CSF SPECIFIC CONTROLS ===
    "stakeholders notified": [
        {"title": "Stakeholder Notification Procedure", "description": "Procedure for notifying stakeholders", "artifact_type": "policy", "format_guidance": "Notification procedure", "frequency": "annual"},
        {"title": "Stakeholder Notification Records", "description": "Records of stakeholder notifications", "artifact_type": "record", "format_guidance": "Notification log", "frequency": "quarterly"},
    ],
    "external systems catalogued": [
        {"title": "External Systems Inventory", "description": "Inventory of external systems", "artifact_type": "record", "format_guidance": "System inventory", "frequency": "quarterly"},
        {"title": "External Connection Documentation", "description": "Documentation of external connections", "artifact_type": "record", "format_guidance": "Connection documentation", "frequency": "annual"},
    ],
    "resources prioritized": [
        {"title": "Resource Prioritization Matrix", "description": "Matrix for prioritizing resources", "artifact_type": "record", "format_guidance": "Prioritization matrix", "frequency": "annual"},
        {"title": "Critical Asset List", "description": "List of critical assets", "artifact_type": "record", "format_guidance": "Asset priority list", "frequency": "annual"},
    ],
    "data lifecycle managed": [
        {"title": "Data Lifecycle Policy", "description": "Policy for data lifecycle management", "artifact_type": "policy", "format_guidance": "Lifecycle policy", "frequency": "annual"},
        {"title": "Data Lifecycle Procedures", "description": "Procedures for data lifecycle stages", "artifact_type": "policy", "format_guidance": "Lifecycle procedures", "frequency": "annual"},
    ],
    "systems resilience requirements": [
        {"title": "Resilience Requirements Document", "description": "Requirements for system resilience", "artifact_type": "record", "format_guidance": "Requirements document", "frequency": "annual"},
        {"title": "Resilience Architecture", "description": "Architecture for system resilience", "artifact_type": "configuration", "format_guidance": "Architecture document", "frequency": "annual"},
    ],
    "threats identified": [
        {"title": "Threat Assessment Report", "description": "Report identifying threats", "artifact_type": "report", "format_guidance": "Threat assessment", "frequency": "annual"},
        {"title": "Threat Register", "description": "Register of identified threats", "artifact_type": "record", "format_guidance": "Threat register", "frequency": "quarterly"},
    ],
    "impacts identified": [
        {"title": "Impact Analysis Report", "description": "Analysis of potential impacts", "artifact_type": "report", "format_guidance": "Impact analysis", "frequency": "annual"},
        {"title": "Business Impact Assessment", "description": "Business impact assessment", "artifact_type": "report", "format_guidance": "BIA report", "frequency": "annual"},
    ],
    "risk responses identified": [
        {"title": "Risk Response Plan", "description": "Plan for responding to risks", "artifact_type": "record", "format_guidance": "Response plan", "frequency": "annual"},
        {"title": "Risk Response Matrix", "description": "Matrix of risk responses", "artifact_type": "record", "format_guidance": "Response matrix", "frequency": "quarterly"},
    ],
    "improvements identified": [
        {"title": "Improvement Identification Records", "description": "Records of identified improvements", "artifact_type": "record", "format_guidance": "Improvement log", "frequency": "quarterly"},
        {"title": "Improvement Assessment", "description": "Assessment of potential improvements", "artifact_type": "report", "format_guidance": "Assessment report", "frequency": "annual"},
    ],
    "improvements planned": [
        {"title": "Improvement Plan", "description": "Plan for implementing improvements", "artifact_type": "record", "format_guidance": "Improvement plan", "frequency": "quarterly"},
        {"title": "Improvement Roadmap", "description": "Roadmap for improvements", "artifact_type": "record", "format_guidance": "Roadmap document", "frequency": "annual"},
    ],
    "improvements implemented": [
        {"title": "Improvement Implementation Records", "description": "Records of implemented improvements", "artifact_type": "record", "format_guidance": "Implementation records", "frequency": "quarterly"},
        {"title": "Improvement Effectiveness Assessment", "description": "Assessment of improvement effectiveness", "artifact_type": "report", "format_guidance": "Effectiveness report", "frequency": "annual"},
    ],
    "identity assertions managed": [
        {"title": "Identity Assertion Policy", "description": "Policy for managing identity assertions", "artifact_type": "policy", "format_guidance": "Assertion policy", "frequency": "annual"},
        {"title": "Identity Federation Configuration", "description": "Configuration of identity federation", "artifact_type": "configuration", "format_guidance": "Federation settings", "frequency": "quarterly"},
    ],
    "access to physical assets managed": [
        {"title": "Physical Asset Access Policy", "description": "Policy for physical asset access", "artifact_type": "policy", "format_guidance": "Access policy", "frequency": "annual"},
        {"title": "Physical Access Log", "description": "Log of physical asset access", "artifact_type": "log", "format_guidance": "Access log", "frequency": "monthly"},
    ],
    "training provided": [
        {"title": "Training Program Documentation", "description": "Documentation of training program", "artifact_type": "policy", "format_guidance": "Training program", "frequency": "annual"},
        {"title": "Training Completion Records", "description": "Records of training completion", "artifact_type": "record", "format_guidance": "Completion records", "frequency": "quarterly"},
    ],
    "privileged users trained": [
        {"title": "Privileged User Training", "description": "Training for privileged users", "artifact_type": "record", "format_guidance": "Training records", "frequency": "annual"},
        {"title": "Privileged Access Training Materials", "description": "Training materials for privileged access", "artifact_type": "record", "format_guidance": "Training materials", "frequency": "annual"},
    ],
    "data-at-rest protected": [
        {"title": "Data-at-Rest Encryption Configuration", "description": "Configuration of data-at-rest encryption", "artifact_type": "configuration", "format_guidance": "Encryption settings", "frequency": "quarterly"},
        {"title": "Data-at-Rest Protection Policy", "description": "Policy for protecting data at rest", "artifact_type": "policy", "format_guidance": "Protection policy", "frequency": "annual"},
    ],
    "data-in-transit protected": [
        {"title": "Data-in-Transit Encryption Configuration", "description": "Configuration of data-in-transit encryption", "artifact_type": "configuration", "format_guidance": "TLS settings", "frequency": "quarterly"},
        {"title": "Transit Protection Policy", "description": "Policy for protecting data in transit", "artifact_type": "policy", "format_guidance": "Protection policy", "frequency": "annual"},
    ],
    "data-in-use protected": [
        {"title": "Data-in-Use Protection Controls", "description": "Controls for protecting data in use", "artifact_type": "configuration", "format_guidance": "Protection controls", "frequency": "quarterly"},
        {"title": "Data-in-Use Security Policy", "description": "Policy for data-in-use security", "artifact_type": "policy", "format_guidance": "Security policy", "frequency": "annual"},
    ],
    "configurations managed": [
        {"title": "Configuration Management Policy", "description": "Policy for configuration management", "artifact_type": "policy", "format_guidance": "CM policy", "frequency": "annual"},
        {"title": "Configuration Baseline", "description": "Baseline configurations", "artifact_type": "configuration", "format_guidance": "Baseline documentation", "frequency": "quarterly"},
    ],
    "software maintained": [
        {"title": "Software Maintenance Policy", "description": "Policy for software maintenance", "artifact_type": "policy", "format_guidance": "Maintenance policy", "frequency": "annual"},
        {"title": "Software Maintenance Records", "description": "Records of software maintenance", "artifact_type": "record", "format_guidance": "Maintenance log", "frequency": "quarterly"},
    ],
    "hardware maintained": [
        {"title": "Hardware Maintenance Policy", "description": "Policy for hardware maintenance", "artifact_type": "policy", "format_guidance": "Maintenance policy", "frequency": "annual"},
        {"title": "Hardware Maintenance Records", "description": "Records of hardware maintenance", "artifact_type": "record", "format_guidance": "Maintenance log", "frequency": "quarterly"},
    ],
    "log records generated": [
        {"title": "Log Generation Configuration", "description": "Configuration of log generation", "artifact_type": "configuration", "format_guidance": "Logging settings", "frequency": "quarterly"},
        {"title": "Log Sample", "description": "Sample log records", "artifact_type": "log", "format_guidance": "Sample logs", "frequency": "monthly"},
    ],
    "installation and execution managed": [
        {"title": "Software Installation Policy", "description": "Policy for software installation", "artifact_type": "policy", "format_guidance": "Installation policy", "frequency": "annual"},
        {"title": "Application Whitelisting Configuration", "description": "Configuration of application whitelisting", "artifact_type": "configuration", "format_guidance": "Whitelist settings", "frequency": "quarterly"},
    ],
    "networks protected": [
        {"title": "Network Protection Controls", "description": "Controls for network protection", "artifact_type": "configuration", "format_guidance": "Network security settings", "frequency": "quarterly"},
        {"title": "Network Security Policy", "description": "Policy for network security", "artifact_type": "policy", "format_guidance": "Network policy", "frequency": "annual"},
    ],
    "architecture reflects strategy": [
        {"title": "Security Architecture Document", "description": "Security architecture documentation", "artifact_type": "configuration", "format_guidance": "Architecture document", "frequency": "annual"},
        {"title": "Architecture Review Records", "description": "Records of architecture reviews", "artifact_type": "record", "format_guidance": "Review records", "frequency": "annual"},
    ],
    "mechanisms operating": [
        {"title": "Security Mechanism Status", "description": "Status of security mechanisms", "artifact_type": "report", "format_guidance": "Status report", "frequency": "quarterly"},
        {"title": "Mechanism Operational Verification", "description": "Verification of mechanism operation", "artifact_type": "record", "format_guidance": "Verification records", "frequency": "quarterly"},
    ],
    "networks monitored": [
        {"title": "Network Monitoring Configuration", "description": "Configuration of network monitoring", "artifact_type": "configuration", "format_guidance": "Monitoring settings", "frequency": "quarterly"},
        {"title": "Network Monitoring Dashboard", "description": "Screenshot of monitoring dashboard", "artifact_type": "screenshot", "format_guidance": "Dashboard screenshot", "frequency": "monthly"},
    ],
    "environment monitored": [
        {"title": "Environment Monitoring Configuration", "description": "Configuration of environment monitoring", "artifact_type": "configuration", "format_guidance": "Monitoring settings", "frequency": "quarterly"},
        {"title": "Environmental Alerts", "description": "Sample environmental alerts", "artifact_type": "log", "format_guidance": "Alert samples", "frequency": "monthly"},
    ],
    "personnel activity monitored": [
        {"title": "User Activity Monitoring Policy", "description": "Policy for monitoring user activity", "artifact_type": "policy", "format_guidance": "Monitoring policy", "frequency": "annual"},
        {"title": "Activity Monitoring Configuration", "description": "Configuration of activity monitoring", "artifact_type": "configuration", "format_guidance": "Monitoring settings", "frequency": "quarterly"},
    ],
    "hardware/software monitored": [
        {"title": "Asset Monitoring Configuration", "description": "Configuration of asset monitoring", "artifact_type": "configuration", "format_guidance": "Monitoring settings", "frequency": "quarterly"},
        {"title": "Asset Monitoring Report", "description": "Report from asset monitoring", "artifact_type": "report", "format_guidance": "Monitoring report", "frequency": "quarterly"},
    ],
    "events analyzed": [
        {"title": "Event Analysis Procedure", "description": "Procedure for event analysis", "artifact_type": "policy", "format_guidance": "Analysis procedure", "frequency": "annual"},
        {"title": "Event Analysis Reports", "description": "Reports from event analysis", "artifact_type": "report", "format_guidance": "Analysis reports", "frequency": "quarterly"},
    ],
    "information correlated": [
        {"title": "Event Correlation Configuration", "description": "Configuration of event correlation", "artifact_type": "configuration", "format_guidance": "SIEM correlation rules", "frequency": "quarterly"},
        {"title": "Correlation Alert Samples", "description": "Sample correlation alerts", "artifact_type": "log", "format_guidance": "Alert samples", "frequency": "monthly"},
    ],
    "impact estimated": [
        {"title": "Impact Estimation Procedure", "description": "Procedure for estimating impact", "artifact_type": "policy", "format_guidance": "Estimation procedure", "frequency": "annual"},
        {"title": "Impact Assessment Records", "description": "Records of impact assessments", "artifact_type": "record", "format_guidance": "Assessment records", "frequency": "quarterly"},
    ],
    "anomalies declared incidents": [
        {"title": "Incident Declaration Criteria", "description": "Criteria for declaring incidents", "artifact_type": "policy", "format_guidance": "Declaration criteria", "frequency": "annual"},
        {"title": "Incident Declaration Log", "description": "Log of incident declarations", "artifact_type": "log", "format_guidance": "Declaration log", "frequency": "quarterly"},
    ],
    "reports triaged": [
        {"title": "Report Triage Procedure", "description": "Procedure for triaging reports", "artifact_type": "policy", "format_guidance": "Triage procedure", "frequency": "annual"},
        {"title": "Triage Log", "description": "Log of report triage", "artifact_type": "log", "format_guidance": "Triage log", "frequency": "monthly"},
    ],
    "incidents categorized": [
        {"title": "Incident Categorization Criteria", "description": "Criteria for categorizing incidents", "artifact_type": "policy", "format_guidance": "Categorization criteria", "frequency": "annual"},
        {"title": "Incident Categorization Log", "description": "Log of incident categorization", "artifact_type": "log", "format_guidance": "Categorization log", "frequency": "monthly"},
    ],
    "incidents escalated": [
        {"title": "Incident Escalation Procedure", "description": "Procedure for incident escalation", "artifact_type": "policy", "format_guidance": "Escalation procedure", "frequency": "annual"},
        {"title": "Escalation Matrix", "description": "Matrix for incident escalation", "artifact_type": "record", "format_guidance": "Escalation matrix", "frequency": "annual"},
    ],
    "analysis performed": [
        {"title": "Analysis Procedure", "description": "Procedure for performing analysis", "artifact_type": "policy", "format_guidance": "Analysis procedure", "frequency": "annual"},
        {"title": "Analysis Reports", "description": "Reports from analysis activities", "artifact_type": "report", "format_guidance": "Analysis reports", "frequency": "quarterly"},
    ],
    "artifact collected": [
        {"title": "Artifact Collection Procedure", "description": "Procedure for collecting artifacts", "artifact_type": "policy", "format_guidance": "Collection procedure", "frequency": "annual"},
        {"title": "Artifact Collection Log", "description": "Log of collected artifacts", "artifact_type": "log", "format_guidance": "Collection log", "frequency": "quarterly"},
    ],
    "information shared": [
        {"title": "Information Sharing Policy", "description": "Policy for information sharing", "artifact_type": "policy", "format_guidance": "Sharing policy", "frequency": "annual"},
        {"title": "Information Sharing Records", "description": "Records of information sharing", "artifact_type": "record", "format_guidance": "Sharing log", "frequency": "quarterly"},
    ],
    "incidents contained": [
        {"title": "Incident Containment Procedure", "description": "Procedure for containing incidents", "artifact_type": "policy", "format_guidance": "Containment procedure", "frequency": "annual"},
        {"title": "Containment Actions Log", "description": "Log of containment actions", "artifact_type": "log", "format_guidance": "Action log", "frequency": "quarterly"},
    ],
    "incidents eradicated": [
        {"title": "Incident Eradication Procedure", "description": "Procedure for eradicating incidents", "artifact_type": "policy", "format_guidance": "Eradication procedure", "frequency": "annual"},
        {"title": "Eradication Actions Log", "description": "Log of eradication actions", "artifact_type": "log", "format_guidance": "Action log", "frequency": "quarterly"},
    ],
    "recovery plan executed": [
        {"title": "Recovery Plan", "description": "Plan for recovery", "artifact_type": "policy", "format_guidance": "Recovery plan", "frequency": "annual"},
        {"title": "Recovery Execution Log", "description": "Log of recovery execution", "artifact_type": "log", "format_guidance": "Execution log", "frequency": "quarterly"},
    ],
    "recovery verified": [
        {"title": "Recovery Verification Procedure", "description": "Procedure for verifying recovery", "artifact_type": "policy", "format_guidance": "Verification procedure", "frequency": "annual"},
        {"title": "Recovery Verification Records", "description": "Records of recovery verification", "artifact_type": "record", "format_guidance": "Verification records", "frequency": "quarterly"},
    ],
    "critical functions restored": [
        {"title": "Function Restoration Procedure", "description": "Procedure for restoring functions", "artifact_type": "policy", "format_guidance": "Restoration procedure", "frequency": "annual"},
        {"title": "Restoration Records", "description": "Records of function restoration", "artifact_type": "record", "format_guidance": "Restoration log", "frequency": "quarterly"},
    ],
    "data integrity restored": [
        {"title": "Data Integrity Restoration Procedure", "description": "Procedure for restoring data integrity", "artifact_type": "policy", "format_guidance": "Restoration procedure", "frequency": "annual"},
        {"title": "Integrity Restoration Records", "description": "Records of integrity restoration", "artifact_type": "record", "format_guidance": "Restoration log", "frequency": "quarterly"},
    ],
    "stakeholders informed": [
        {"title": "Stakeholder Communication Procedure", "description": "Procedure for informing stakeholders", "artifact_type": "policy", "format_guidance": "Communication procedure", "frequency": "annual"},
        {"title": "Stakeholder Communication Records", "description": "Records of stakeholder communications", "artifact_type": "record", "format_guidance": "Communication log", "frequency": "quarterly"},
    ],
    "public updates": [
        {"title": "Public Communication Procedure", "description": "Procedure for public updates", "artifact_type": "policy", "format_guidance": "Communication procedure", "frequency": "annual"},
        {"title": "Public Communication Records", "description": "Records of public communications", "artifact_type": "record", "format_guidance": "Communication samples", "frequency": "as_needed"},
    ],
    # === ISO 27001 A.8.x CONTROLS ===
    "segregation of networks": [
        {"title": "Network Segmentation Design", "description": "Design of network segregation", "artifact_type": "configuration", "format_guidance": "Segmentation diagram", "frequency": "annual"},
        {"title": "Segmentation Rules", "description": "Rules for network segregation", "artifact_type": "configuration", "format_guidance": "Firewall rules", "frequency": "quarterly"},
    ],
    "user endpoint devices": [
        {"title": "Endpoint Security Policy", "description": "Policy for endpoint device security", "artifact_type": "policy", "format_guidance": "Endpoint policy", "frequency": "annual"},
        {"title": "Endpoint Configuration Standards", "description": "Standards for endpoint configuration", "artifact_type": "policy", "format_guidance": "Configuration standards", "frequency": "annual"},
        {"title": "Endpoint Security Status", "description": "Status of endpoint security controls", "artifact_type": "report", "format_guidance": "EDR/AV status report", "frequency": "monthly"},
    ],
    "access to source code": [
        {"title": "Source Code Access Policy", "description": "Policy for source code access", "artifact_type": "policy", "format_guidance": "Access policy", "frequency": "annual"},
        {"title": "Source Code Access Controls", "description": "Configuration of source code access controls", "artifact_type": "configuration", "format_guidance": "Repository access settings", "frequency": "quarterly"},
    ],
    "configuration management": [
        {"title": "Configuration Management Policy", "description": "Policy for configuration management", "artifact_type": "policy", "format_guidance": "CM policy", "frequency": "annual"},
        {"title": "Configuration Baseline", "description": "Baseline configuration documentation", "artifact_type": "configuration", "format_guidance": "Baseline standards", "frequency": "annual"},
        {"title": "Configuration Change Log", "description": "Log of configuration changes", "artifact_type": "log", "format_guidance": "Change log", "frequency": "monthly"},
    ],
    "data leakage prevention": [
        {"title": "DLP Policy", "description": "Policy for data leakage prevention", "artifact_type": "policy", "format_guidance": "DLP policy", "frequency": "annual"},
        {"title": "DLP Configuration", "description": "Configuration of DLP controls", "artifact_type": "configuration", "format_guidance": "DLP settings", "frequency": "quarterly"},
        {"title": "DLP Alert Report", "description": "Report of DLP alerts", "artifact_type": "report", "format_guidance": "Alert report", "frequency": "monthly"},
    ],
    "redundancy of information processing": [
        {"title": "Redundancy Design", "description": "Design of processing redundancy", "artifact_type": "configuration", "format_guidance": "Architecture document", "frequency": "annual"},
        {"title": "Redundancy Test Results", "description": "Results of redundancy testing", "artifact_type": "report", "format_guidance": "Test results", "frequency": "annual"},
    ],
    "clock synchronization": [
        {"title": "Time Synchronization Configuration", "description": "Configuration of time synchronization", "artifact_type": "configuration", "format_guidance": "NTP settings", "frequency": "quarterly"},
        {"title": "Time Sync Monitoring", "description": "Monitoring of time synchronization", "artifact_type": "report", "format_guidance": "Sync status report", "frequency": "monthly"},
    ],
    "use of privileged utility programs": [
        {"title": "Privileged Utility Policy", "description": "Policy for privileged utility use", "artifact_type": "policy", "format_guidance": "Utility policy", "frequency": "annual"},
        {"title": "Utility Access Controls", "description": "Access controls for privileged utilities", "artifact_type": "configuration", "format_guidance": "Access settings", "frequency": "quarterly"},
    ],
    "installation of software on operational systems": [
        {"title": "Software Installation Policy", "description": "Policy for software installation", "artifact_type": "policy", "format_guidance": "Installation policy", "frequency": "annual"},
        {"title": "Approved Software List", "description": "List of approved software", "artifact_type": "record", "format_guidance": "Software whitelist", "frequency": "quarterly"},
    ],
    "networks security": [
        {"title": "Network Security Policy", "description": "Policy for network security", "artifact_type": "policy", "format_guidance": "Network policy", "frequency": "annual"},
        {"title": "Network Security Configuration", "description": "Configuration of network security", "artifact_type": "configuration", "format_guidance": "Security settings", "frequency": "quarterly"},
    ],
    "security of network services": [
        {"title": "Network Service Security Requirements", "description": "Security requirements for network services", "artifact_type": "record", "format_guidance": "Requirements document", "frequency": "annual"},
        {"title": "Network Service Agreements", "description": "Agreements for network services", "artifact_type": "record", "format_guidance": "Service agreements", "frequency": "annual"},
    ],
    "web filtering": [
        {"title": "Web Filtering Policy", "description": "Policy for web filtering", "artifact_type": "policy", "format_guidance": "Filtering policy", "frequency": "annual"},
        {"title": "Web Filter Configuration", "description": "Configuration of web filtering", "artifact_type": "configuration", "format_guidance": "Filter settings", "frequency": "quarterly"},
    ],
    "application security requirements": [
        {"title": "Application Security Requirements", "description": "Security requirements for applications", "artifact_type": "record", "format_guidance": "Requirements document", "frequency": "annual"},
        {"title": "Application Security Checklist", "description": "Checklist for application security", "artifact_type": "record", "format_guidance": "Security checklist", "frequency": "as_needed"},
    ],
    "secure system architecture": [
        {"title": "Secure Architecture Standards", "description": "Standards for secure system architecture", "artifact_type": "policy", "format_guidance": "Architecture standards", "frequency": "annual"},
        {"title": "Architecture Review Records", "description": "Records of architecture reviews", "artifact_type": "record", "format_guidance": "Review records", "frequency": "quarterly"},
    ],
    "secure coding": [
        {"title": "Secure Coding Standards", "description": "Standards for secure coding", "artifact_type": "policy", "format_guidance": "Coding standards", "frequency": "annual"},
        {"title": "Code Review Records", "description": "Records of security code reviews", "artifact_type": "record", "format_guidance": "Review records", "frequency": "quarterly"},
    ],
    "separation of development, test and production": [
        {"title": "Environment Separation Policy", "description": "Policy for environment separation", "artifact_type": "policy", "format_guidance": "Separation policy", "frequency": "annual"},
        {"title": "Environment Separation Evidence", "description": "Evidence of environment separation", "artifact_type": "configuration", "format_guidance": "Environment configuration", "frequency": "quarterly"},
    ],
    "test information": [
        {"title": "Test Data Policy", "description": "Policy for test data management", "artifact_type": "policy", "format_guidance": "Test data policy", "frequency": "annual"},
        {"title": "Test Data Protection Evidence", "description": "Evidence of test data protection", "artifact_type": "record", "format_guidance": "Data masking records", "frequency": "quarterly"},
    ],
    "protection of information systems during audit": [
        {"title": "Audit Protection Procedure", "description": "Procedure for protecting systems during audits", "artifact_type": "policy", "format_guidance": "Protection procedure", "frequency": "annual"},
        {"title": "Audit Access Controls", "description": "Access controls for audit activities", "artifact_type": "record", "format_guidance": "Access records", "frequency": "as_needed"},
    ],
    "cybersecurity strategy": [
        {"title": "Cybersecurity Strategy Document", "description": "Documented cybersecurity strategy", "artifact_type": "policy", "format_guidance": "Strategy document", "frequency": "annual"},
        {"title": "Strategy Implementation Plan", "description": "Plan for strategy implementation", "artifact_type": "record", "format_guidance": "Implementation plan", "frequency": "annual"},
    ],
    "security policies": [
        {"title": "Security Policy Suite", "description": "Suite of security policies", "artifact_type": "policy", "format_guidance": "Policy documents", "frequency": "annual"},
        {"title": "Policy Approval Records", "description": "Records of policy approvals", "artifact_type": "record", "format_guidance": "Approval records", "frequency": "annual"},
    ],
    # === ADDITIONAL FALLBACK PATTERNS ===
    "automated technical solution": [
        {"title": "Automated Solution Configuration", "description": "Configuration of automated technical solution", "artifact_type": "configuration", "format_guidance": "Solution settings", "frequency": "quarterly"},
        {"title": "Solution Operation Evidence", "description": "Evidence of solution operation", "artifact_type": "report", "format_guidance": "Operational report", "frequency": "monthly"},
    ],
    "pan secured via end-user messaging": [
        {"title": "Messaging Security Policy", "description": "Policy for securing PAN in messaging", "artifact_type": "policy", "format_guidance": "Messaging policy", "frequency": "annual"},
        {"title": "Messaging Encryption Evidence", "description": "Evidence of messaging encryption", "artifact_type": "configuration", "format_guidance": "Encryption settings", "frequency": "quarterly"},
    ],
    "changes to network connections reviewed": [
        {"title": "Network Change Review Procedure", "description": "Procedure for reviewing network changes", "artifact_type": "policy", "format_guidance": "Review procedure", "frequency": "annual"},
        {"title": "Network Change Log", "description": "Log of network connection changes", "artifact_type": "log", "format_guidance": "Change log", "frequency": "monthly"},
    ],
    "security features documented": [
        {"title": "Security Features Documentation", "description": "Documentation of security features", "artifact_type": "record", "format_guidance": "Features documentation", "frequency": "annual"},
        {"title": "Security Feature Configuration", "description": "Configuration of security features", "artifact_type": "configuration", "format_guidance": "Feature settings", "frequency": "quarterly"},
    ],
    "configuration files secured": [
        {"title": "Configuration File Security Policy", "description": "Policy for securing configuration files", "artifact_type": "policy", "format_guidance": "Security policy", "frequency": "annual"},
        {"title": "Configuration File Access Controls", "description": "Access controls for configuration files", "artifact_type": "configuration", "format_guidance": "Access settings", "frequency": "quarterly"},
    ],
    "responsibility matrix provided": [
        {"title": "TPSP Responsibility Matrix", "description": "Matrix of TPSP PCI DSS responsibilities", "artifact_type": "record", "format_guidance": "Responsibility matrix document", "frequency": "annual"},
        {"title": "TPSP Responsibility Documentation", "description": "Documentation of TPSP responsibilities", "artifact_type": "record", "format_guidance": "TPSP documentation", "frequency": "annual"},
    ],
}

# HIGH PRIORITY PATTERNS - checked after name matching but before generic patterns
HIGH_PRIORITY_PATTERNS = {
    "incident_response": {
        "keywords": ["incident response", "incident management", "incident handling", "security incident", "incident procedure", "incident plan", "respond to incident", "incident escalat"],
        "evidence": [
            {"title": "Incident Response Plan", "description": "Comprehensive incident response plan document with roles and procedures", "artifact_type": "policy", "format_guidance": "IR plan with roles, procedures, and escalation paths", "frequency": "annual"},
            {"title": "Incident Response Playbooks", "description": "Playbooks for common incident types (ransomware, data breach, etc.)", "artifact_type": "policy", "format_guidance": "Runbook documents for each incident type", "frequency": "annual"},
            {"title": "IR Team Contact List", "description": "Current incident response team contact information and escalation paths", "artifact_type": "record", "format_guidance": "Contact list with escalation order", "frequency": "quarterly"},
            {"title": "Incident Log", "description": "Log of security incidents and responses taken", "artifact_type": "log", "format_guidance": "Incident tracking system export", "frequency": "quarterly"},
        ]
    },
    "encryption_data": {
        "keywords": ["encryption", "encrypt", "cryptographic", "cipher", "encrypted", "disk-level encryption", "full disk encryption", "data encryption"],
        "evidence": [
            {"title": "Encryption Policy", "description": "Policy defining encryption requirements for data at rest and in transit", "artifact_type": "policy", "format_guidance": "Approved encryption policy document", "frequency": "annual"},
            {"title": "Encryption Key Inventory", "description": "Inventory of all encryption keys with classifications and expiration", "artifact_type": "record", "format_guidance": "Key inventory spreadsheet", "frequency": "quarterly"},
            {"title": "TDE/Disk Encryption Configuration", "description": "Configuration showing TDE and disk encryption status", "artifact_type": "configuration", "format_guidance": "Database and disk encryption status report", "frequency": "quarterly"},
        ]
    },
    "vendor_third_party": {
        "keywords": ["vendor", "third party", "third-party", "outsource", "external provider", "service provider", "supplier", "subcontractor"],
        "evidence": [
            {"title": "Vendor Inventory", "description": "Complete inventory of third-party vendors with risk classifications", "artifact_type": "record", "format_guidance": "Vendor registry with risk ratings", "frequency": "quarterly"},
            {"title": "Vendor Risk Assessment", "description": "Risk assessments conducted for critical vendors", "artifact_type": "report", "format_guidance": "Completed vendor risk assessment forms", "frequency": "annual"},
            {"title": "Vendor Security Contract Clauses", "description": "Contract excerpts showing security and compliance requirements", "artifact_type": "record", "format_guidance": "Relevant contract sections", "frequency": "annual"},
        ]
    },
    "backup_recovery": {
        "keywords": ["backup", "data backup", "backup copy", "backup procedure", "backup system", "backup storage"],
        "evidence": [
            {"title": "Backup Policy", "description": "Policy defining backup requirements, schedules, and retention", "artifact_type": "policy", "format_guidance": "Approved backup policy document", "frequency": "annual"},
            {"title": "Backup Schedule Configuration", "description": "Configuration showing backup schedules for all systems", "artifact_type": "configuration", "format_guidance": "Backup software schedule export", "frequency": "quarterly"},
            {"title": "Backup Completion Report", "description": "Report showing successful backup completion status", "artifact_type": "report", "format_guidance": "Backup system success/failure report", "frequency": "monthly"},
        ]
    },
    "access_management": {
        "keywords": ["access control", "access management", "user access", "authorization", "access rights", "access permission", "role-based access", "rbac"],
        "evidence": [
            {"title": "Access Control Policy", "description": "Policy defining access control requirements and principles", "artifact_type": "policy", "format_guidance": "Approved access control policy", "frequency": "annual"},
            {"title": "User Access Matrix", "description": "Matrix showing users/roles and their access permissions", "artifact_type": "record", "format_guidance": "Access matrix spreadsheet", "frequency": "quarterly"},
            {"title": "Access Review Report", "description": "Results of periodic user access reviews and certifications", "artifact_type": "report", "format_guidance": "Access review attestations", "frequency": "quarterly"},
        ]
    },
    "vulnerability_management": {
        "keywords": ["vulnerability", "vulnerabilities", "vulnerability scan", "vulnerability assessment", "security weakness", "vuln scan"],
        "evidence": [
            {"title": "Vulnerability Scan Report", "description": "Full vulnerability scan report with findings and severity", "artifact_type": "report", "format_guidance": "Scanner tool export (Nessus, Qualys, etc.)", "frequency": "quarterly"},
            {"title": "Vulnerability Remediation Tracking", "description": "Tracking of vulnerability remediation progress", "artifact_type": "record", "format_guidance": "Remediation tracker spreadsheet", "frequency": "monthly"},
            {"title": "Vulnerability Management Policy", "description": "Policy defining vulnerability management requirements", "artifact_type": "policy", "format_guidance": "Approved vulnerability policy", "frequency": "annual"},
        ]
    },
    "audit_logging": {
        "keywords": ["audit trail", "audit log", "audit logs", "logging", "log retention", "security log", "event log", "audit record"],
        "evidence": [
            {"title": "Audit Log Policy", "description": "Policy defining audit logging requirements", "artifact_type": "policy", "format_guidance": "Approved logging policy", "frequency": "annual"},
            {"title": "Log Retention Configuration", "description": "Configuration showing log retention settings", "artifact_type": "configuration", "format_guidance": "SIEM/log management retention config", "frequency": "quarterly"},
            {"title": "Sample Audit Logs", "description": "Sample logs demonstrating required events are captured", "artifact_type": "log", "format_guidance": "Log sample with timestamps", "frequency": "monthly"},
        ]
    },
    "security_training": {
        "keywords": ["security awareness", "security training", "user training", "awareness program", "employee training", "staff training", "training program"],
        "evidence": [
            {"title": "Security Awareness Program", "description": "Documentation of security awareness training program", "artifact_type": "policy", "format_guidance": "Program document with curriculum", "frequency": "annual"},
            {"title": "Training Completion Records", "description": "Records showing training completion by employees", "artifact_type": "report", "format_guidance": "LMS completion report", "frequency": "quarterly"},
            {"title": "Phishing Test Results", "description": "Results of phishing simulation exercises", "artifact_type": "report", "format_guidance": "Phishing campaign results", "frequency": "quarterly"},
        ]
    },
    "change_control": {
        "keywords": ["change management", "change control", "change request", "change advisory", "cab", "change process"],
        "evidence": [
            {"title": "Change Management Policy", "description": "Policy defining change management process", "artifact_type": "policy", "format_guidance": "Approved change policy", "frequency": "annual"},
            {"title": "Change Request Forms", "description": "Sample completed change requests with approvals", "artifact_type": "record", "format_guidance": "Change tickets from ITSM", "frequency": "quarterly"},
            {"title": "Change Log", "description": "Log of all changes implemented", "artifact_type": "log", "format_guidance": "Change management system export", "frequency": "monthly"},
        ]
    },
    "risk_management": {
        "keywords": ["risk assessment", "risk management", "risk analysis", "threat assessment", "risk identification", "risk evaluation"],
        "evidence": [
            {"title": "Risk Assessment Report", "description": "Completed risk assessment with findings", "artifact_type": "report", "format_guidance": "Risk assessment document", "frequency": "annual"},
            {"title": "Risk Register", "description": "Register of identified risks with ratings", "artifact_type": "record", "format_guidance": "Risk register spreadsheet", "frequency": "quarterly"},
            {"title": "Risk Treatment Plan", "description": "Plan for addressing identified risks", "artifact_type": "record", "format_guidance": "Treatment plan with timelines", "frequency": "quarterly"},
        ]
    },
    "network_security": {
        "keywords": ["network security", "network protection", "network control", "network perimeter", "network defense", "secure network", "firewall"],
        "evidence": [
            {"title": "Network Security Policy", "description": "Policy defining network security requirements", "artifact_type": "policy", "format_guidance": "Approved network security policy", "frequency": "annual"},
            {"title": "Network Architecture Diagram", "description": "Current network architecture showing security zones", "artifact_type": "configuration", "format_guidance": "Network diagram with security annotations", "frequency": "quarterly"},
            {"title": "Firewall Rules Export", "description": "Export of current firewall rules and configurations", "artifact_type": "configuration", "format_guidance": "Firewall rule export", "frequency": "quarterly"},
        ]
    },
    "malware_protection": {
        "keywords": ["malware", "anti-malware", "antivirus", "virus protection", "malicious software", "malicious code", "endpoint protection"],
        "evidence": [
            {"title": "Antivirus Policy", "description": "Policy defining antivirus requirements", "artifact_type": "policy", "format_guidance": "Approved AV policy", "frequency": "annual"},
            {"title": "AV Deployment Report", "description": "Report showing antivirus deployment across endpoints", "artifact_type": "report", "format_guidance": "AV management console report", "frequency": "monthly"},
            {"title": "Definition Update Log", "description": "Log showing antivirus definition updates", "artifact_type": "log", "format_guidance": "AV update history", "frequency": "weekly"},
        ]
    },
    "patch_management_pattern": {
        "keywords": ["patch", "patching", "system update", "security update", "hotfix", "software update"],
        "evidence": [
            {"title": "Patch Management Policy", "description": "Policy defining patching timelines and procedures", "artifact_type": "policy", "format_guidance": "Approved patch policy", "frequency": "annual"},
            {"title": "Patch Deployment Log", "description": "Log of patches deployed with dates", "artifact_type": "log", "format_guidance": "Patch management system log", "frequency": "monthly"},
            {"title": "Patch Compliance Report", "description": "Report showing patch compliance status", "artifact_type": "report", "format_guidance": "Patch compliance dashboard", "frequency": "monthly"},
        ]
    },
}

# EVIDENCE PATTERNS - additional patterns for backup matching
EVIDENCE_PATTERNS = {
    "password_authentication": {
        "keywords": ["password", "credential", "authentication", "password complexity", "password policy"],
        "evidence": [
            {"title": "Password Policy Document", "description": "Policy defining password requirements", "artifact_type": "policy", "format_guidance": "Approved password policy", "frequency": "annual"},
            {"title": "Password Configuration Settings", "description": "System password policy configuration", "artifact_type": "configuration", "format_guidance": "GPO or system password settings", "frequency": "quarterly"},
        ]
    },
    "mfa_authentication": {
        "keywords": ["multi-factor", "mfa", "two-factor", "2fa", "additional authentication factor"],
        "evidence": [
            {"title": "MFA Configuration", "description": "Multi-factor authentication configuration", "artifact_type": "configuration", "format_guidance": "MFA system configuration export", "frequency": "quarterly"},
            {"title": "MFA Enrollment Report", "description": "Report showing MFA enrollment status", "artifact_type": "report", "format_guidance": "MFA enrollment dashboard", "frequency": "monthly"},
        ]
    },
    "penetration_testing": {
        "keywords": ["penetration test", "pen test", "security test", "ethical hacking", "red team"],
        "evidence": [
            {"title": "Penetration Test Report", "description": "Full penetration test report from qualified assessor", "artifact_type": "report", "format_guidance": "PDF report with methodology, findings, and remediation", "frequency": "annual"},
            {"title": "Penetration Test Remediation Evidence", "description": "Evidence of remediation of penetration test findings", "artifact_type": "record", "format_guidance": "Remediation status with screenshots", "frequency": "quarterly"},
        ]
    },
    "policy_governance": {
        "keywords": ["information security policy", "policy review", "policy approval", "documented policy", "policies and procedures"],
        "evidence": [
            {"title": "Policy Document", "description": "Approved policy document with signatures", "artifact_type": "policy", "format_guidance": "PDF policy with approval signatures", "frequency": "annual"},
            {"title": "Policy Approval Records", "description": "Records of policy approval by management", "artifact_type": "record", "format_guidance": "Signed approval pages", "frequency": "annual"},
            {"title": "Policy Distribution Records", "description": "Records showing policy communication to staff", "artifact_type": "record", "format_guidance": "Distribution acknowledgments", "frequency": "annual"},
        ]
    },
}


def match_control_name(name: str) -> list:
    """Match control name against CONTROL_NAME_EVIDENCE patterns and return evidence."""
    name_lower = name.lower()
    
    # Check each pattern key
    for pattern_key, evidence_list in CONTROL_NAME_EVIDENCE.items():
        if pattern_key in name_lower:
            # Validate evidence_list is actually a list (not a string from typo)
            if isinstance(evidence_list, list) and len(evidence_list) > 0:
                # Validate first item is a dict
                if isinstance(evidence_list[0], dict):
                    return evidence_list
    
    return []


def analyze_control_text(code: str, name: str, statement: str) -> list:
    """Analyze control text to determine matching evidence patterns."""
    text = f"{code} {name} {statement}".lower()
    matched_patterns = []
    
    # Check HIGH PRIORITY patterns first
    for pattern_name, pattern_data in HIGH_PRIORITY_PATTERNS.items():
        for keyword in pattern_data["keywords"]:
            if keyword.lower() in text:
                matched_patterns.append(f"high_priority_{pattern_name}")
                break
    
    if matched_patterns:
        return matched_patterns
    
    # Check regular evidence patterns
    for pattern_name, pattern_data in EVIDENCE_PATTERNS.items():
        for keyword in pattern_data["keywords"]:
            if keyword.lower() in text:
                matched_patterns.append(pattern_name)
                break
    
    return matched_patterns


def generate_evidence_for_control(control: FrameworkControl) -> list:
    """Generate unique evidence items for a control based on its name and content."""
    code = control.code or ""
    name = control.name or ""
    statement = control.statement or ""
    
    evidence_items = []
    seen_titles = set()
    
    # STEP 1: Try to match control NAME against CONTROL_NAME_EVIDENCE (most specific)
    name_matched_evidence = match_control_name(name)
    if name_matched_evidence:
        for ev in name_matched_evidence[:5]:  # Limit to 5 items
            if isinstance(ev, dict) and "title" in ev:
                control_specific_title = f"{ev['title']} - {code}"
                if control_specific_title not in seen_titles:
                    seen_titles.add(control_specific_title)
                    evidence_items.append({
                        "title": ev["title"],
                        "description": f"{ev.get('description', 'Evidence')} for control {code}: {name}",
                        "artifact_type": ev.get("artifact_type", "record"),
                        "format_guidance": ev.get("format_guidance", "Relevant documentation"),
                        "frequency": ev.get("frequency", "annual"),
                        "is_required": True
                    })
        if evidence_items:
            return evidence_items
    
    # STEP 2: Try statement and code matching against CONTROL_NAME_EVIDENCE
    combined_text = f"{code} {name} {statement}".lower()
    for pattern_key, evidence_list in CONTROL_NAME_EVIDENCE.items():
        if pattern_key in combined_text:
            if isinstance(evidence_list, list):
                for ev in evidence_list[:5]:
                    if isinstance(ev, dict) and "title" in ev:
                        control_specific_title = f"{ev['title']} - {code}"
                        if control_specific_title not in seen_titles:
                            seen_titles.add(control_specific_title)
                            evidence_items.append({
                                "title": ev["title"],
                                "description": f"{ev.get('description', 'Evidence')} for control {code}: {name}",
                                "artifact_type": ev.get("artifact_type", "record"),
                                "format_guidance": ev.get("format_guidance", "Relevant documentation"),
                                "frequency": ev.get("frequency", "annual"),
                                "is_required": True
                            })
                if evidence_items:
                    return evidence_items
    
    # STEP 3: Fall back to keyword pattern matching
    matched_patterns = analyze_control_text(code, name, statement)
    
    for pattern_name in matched_patterns:
        if pattern_name.startswith("high_priority_"):
            pattern_key = pattern_name.replace("high_priority_", "")
            pattern_data = HIGH_PRIORITY_PATTERNS.get(pattern_key, {})
        else:
            pattern_data = EVIDENCE_PATTERNS.get(pattern_name, {})
        
        for ev in pattern_data.get("evidence", []):
            control_specific_title = f"{ev['title']} - {code}"
            if control_specific_title not in seen_titles and len(evidence_items) < 5:
                seen_titles.add(control_specific_title)
                evidence_items.append({
                    "title": ev["title"],
                    "description": f"{ev['description']} for control {code}: {name}",
                    "artifact_type": ev["artifact_type"],
                    "format_guidance": ev["format_guidance"],
                    "frequency": ev["frequency"],
                    "is_required": True
                })
    
    # STEP 4: Create specific evidence based on control name components
    if len(evidence_items) < 3:
        # Extract key terms from control name for specific evidence
        name_parts = name.lower().split()
        key_terms = [p for p in name_parts if len(p) > 3 and p not in ['shall', 'should', 'must', 'with', 'from', 'into', 'upon', 'that', 'this', 'have', 'been', 'being', 'were', 'are', 'will', 'would', 'could', 'the', 'and', 'for']]
        
        if key_terms:
            # Create policy evidence
            if len(evidence_items) < 3:
                policy_title = f"{name.title()} Policy"
                if policy_title not in seen_titles:
                    evidence_items.append({
                        "title": policy_title,
                        "description": f"Policy document for {name}",
                        "artifact_type": "policy",
                        "format_guidance": "Approved policy document",
                        "frequency": "annual",
                        "is_required": True
                    })
                    seen_titles.add(policy_title)
            
            # Create procedure/implementation evidence
            if len(evidence_items) < 3:
                proc_title = f"{name.title()} Procedure"
                if proc_title not in seen_titles:
                    evidence_items.append({
                        "title": proc_title,
                        "description": f"Procedure for implementing {name}",
                        "artifact_type": "policy",
                        "format_guidance": "Documented procedure",
                        "frequency": "annual",
                        "is_required": True
                    })
                    seen_titles.add(proc_title)
            
            # Create evidence/records
            if len(evidence_items) < 3:
                record_title = f"{name.title()} Records"
                if record_title not in seen_titles:
                    evidence_items.append({
                        "title": record_title,
                        "description": f"Records demonstrating implementation of {name}",
                        "artifact_type": "record",
                        "format_guidance": "Implementation records or logs",
                        "frequency": "quarterly",
                        "is_required": True
                    })
                    seen_titles.add(record_title)
    
    # Ensure minimum 3 evidence items - create based on control specifics
    if len(evidence_items) < 3:
        base_evidence = [
            {"title": f"{name.title()} - Policy Document", "description": f"Policy governing {name}", "artifact_type": "policy", "format_guidance": "Approved policy document", "frequency": "annual", "is_required": True},
            {"title": f"{name.title()} - Implementation Evidence", "description": f"Evidence demonstrating implementation of {name}", "artifact_type": "record", "format_guidance": "Configuration, screenshot, or documentation", "frequency": "quarterly", "is_required": True},
            {"title": f"{name.title()} - Review Records", "description": f"Records of periodic review for {name}", "artifact_type": "report", "format_guidance": "Review report or attestation", "frequency": "quarterly", "is_required": False},
        ]
        for ev in base_evidence:
            if ev["title"] not in seen_titles and len(evidence_items) < 3:
                evidence_items.append(ev)
                seen_titles.add(ev["title"])
    
    return evidence_items


def seed_control_evidence(force_reseed: bool = False):
    """Generate and seed unique evidence requirements for all framework controls."""
    db = SessionLocal()
    try:
        existing_count = db.query(CuratedEvidenceItem).filter(
            CuratedEvidenceItem.framework_control_id.isnot(None)
        ).count()
        
        if existing_count > 0 and not force_reseed:
            print(f"Control evidence already seeded ({existing_count} items), skipping...")
            return
        
        if force_reseed and existing_count > 0:
            print(f"Force reseeding: clearing {existing_count} existing control evidence items...")
            db.query(CuratedEvidenceItem).filter(
                CuratedEvidenceItem.framework_control_id.isnot(None)
            ).delete()
            db.commit()
        
        print("Seeding unique evidence requirements for framework controls...")
        
        controls = db.query(FrameworkControl).all()
        print(f"Found {len(controls)} framework controls")
        
        total_evidence = 0
        name_matched = 0
        keyword_matched = 0
        fallback_used = 0
        
        for control in controls:
            evidence_items = generate_evidence_for_control(control)
            
            # Track matching method
            name_check = match_control_name(control.name or "")
            if name_check:
                name_matched += 1
            elif analyze_control_text(control.code or "", control.name or "", control.statement or ""):
                keyword_matched += 1
            else:
                fallback_used += 1
            
            for ev in evidence_items:
                curated_item = CuratedEvidenceItem(
                    framework_control_id=control.id,
                    sub_control_id=None,
                    title=ev["title"],
                    description=ev["description"],
                    artifact_type=ev["artifact_type"],
                    format_guidance=ev["format_guidance"],
                    frequency=ev["frequency"],
                    is_required=ev["is_required"]
                )
                db.add(curated_item)
                total_evidence += 1
        
        db.commit()
        print(f"Successfully seeded {total_evidence} evidence items for {len(controls)} controls")
        if len(controls) > 0:
            print(f"\nMatching summary:")
            print(f"  - Name pattern matched: {name_matched} controls ({100*name_matched/len(controls):.1f}%)")
            print(f"  - Keyword pattern matched: {keyword_matched} controls ({100*keyword_matched/len(controls):.1f}%)")
            print(f"  - Fallback used: {fallback_used} controls ({100*fallback_used/len(controls):.1f}%)")
        
    except Exception as e:
        db.rollback()
        print(f"Error seeding control evidence: {e}")
        raise
    finally:
        db.close()


if __name__ == "__main__":
    seed_control_evidence(force_reseed=True)
