"""
Generates unique evidence requirements for each framework control based on control statements.
Uses keyword/pattern matching to create specific, actionable evidence items.
"""

from .models import SessionLocal, FrameworkControl, CuratedEvidenceItem

# HIGH PRIORITY PATTERNS - checked first to override generic matches
# These patterns are more specific and take precedence over EVIDENCE_PATTERNS
HIGH_PRIORITY_PATTERNS = {
    "incident_response": {
        "keywords": ["incident response", "incident management", "incident handling", "security incident", "incident procedure", "incident plan", "respond to incident", "incident escalat"],
        "evidence": [
            {"title": "Incident Response Plan", "description": "Comprehensive incident response plan document with roles and procedures", "artifact_type": "policy", "format_guidance": "IR plan with roles, procedures, and escalation paths", "frequency": "annual"},
            {"title": "Incident Response Playbooks", "description": "Playbooks for common incident types (ransomware, data breach, etc.)", "artifact_type": "policy", "format_guidance": "Runbook documents for each incident type", "frequency": "annual"},
            {"title": "IR Team Contact List", "description": "Current incident response team contact information and escalation paths", "artifact_type": "record", "format_guidance": "Contact list with escalation order", "frequency": "quarterly"},
            {"title": "Incident Log", "description": "Log of security incidents and responses taken", "artifact_type": "log", "format_guidance": "Incident tracking system export", "frequency": "quarterly"},
            {"title": "Incident Report Template", "description": "Template used for documenting incident details and response actions", "artifact_type": "record", "format_guidance": "Sample completed incident reports", "frequency": "quarterly"},
        ]
    },
    "incident_detection": {
        "keywords": ["incident detection", "detect incident", "anomaly detection", "threat detection", "security detection", "detect security event", "detection capabilit"],
        "evidence": [
            {"title": "Detection Rule Configuration", "description": "Configuration of detection rules and correlation logic", "artifact_type": "configuration", "format_guidance": "SIEM detection rule export", "frequency": "quarterly"},
            {"title": "Alert Threshold Configuration", "description": "Configured alert thresholds and trigger conditions", "artifact_type": "configuration", "format_guidance": "Alert configuration documentation", "frequency": "quarterly"},
            {"title": "Detection Coverage Report", "description": "Report showing detection coverage across systems and attack vectors", "artifact_type": "report", "format_guidance": "Detection coverage matrix", "frequency": "quarterly"},
            {"title": "Alert Triage Procedure", "description": "Procedure for triaging and investigating security alerts", "artifact_type": "policy", "format_guidance": "Triage procedure document", "frequency": "annual"},
        ]
    },
    "encryption_data": {
        "keywords": ["encryption", "encrypt", "cryptographic", "cipher", "encrypted", "disk-level encryption", "full disk encryption", "data encryption"],
        "evidence": [
            {"title": "Encryption Policy", "description": "Policy defining encryption requirements for data at rest and in transit", "artifact_type": "policy", "format_guidance": "Approved encryption policy document", "frequency": "annual"},
            {"title": "Encryption Key Inventory", "description": "Inventory of all encryption keys with classifications and expiration", "artifact_type": "record", "format_guidance": "Key inventory spreadsheet", "frequency": "quarterly"},
            {"title": "TDE/Disk Encryption Configuration", "description": "Configuration showing TDE and disk encryption status", "artifact_type": "configuration", "format_guidance": "Database and disk encryption status report", "frequency": "quarterly"},
            {"title": "Disk Encryption Status Report", "description": "Report showing encryption status for all storage devices", "artifact_type": "report", "format_guidance": "BitLocker/LUKS status report", "frequency": "monthly"},
            {"title": "Encryption Algorithm Documentation", "description": "Documentation of approved encryption algorithms and key lengths", "artifact_type": "record", "format_guidance": "Cryptographic standards document", "frequency": "annual"},
        ]
    },
    "vendor_third_party": {
        "keywords": ["vendor", "third party", "third-party", "outsource", "external provider", "service provider", "supplier", "subcontractor", "contractor"],
        "evidence": [
            {"title": "Vendor Inventory", "description": "Complete inventory of third-party vendors with risk classifications", "artifact_type": "record", "format_guidance": "Vendor registry with risk ratings", "frequency": "quarterly"},
            {"title": "Vendor Risk Assessment", "description": "Risk assessments conducted for critical vendors", "artifact_type": "report", "format_guidance": "Completed vendor risk assessment forms", "frequency": "annual"},
            {"title": "Vendor Security Contract Clauses", "description": "Contract excerpts showing security and compliance requirements", "artifact_type": "record", "format_guidance": "Relevant contract sections", "frequency": "annual"},
            {"title": "Vendor Due Diligence Records", "description": "Due diligence documentation for vendor selection", "artifact_type": "record", "format_guidance": "Due diligence checklist and findings", "frequency": "annual"},
            {"title": "Vendor Performance Review", "description": "Periodic review of vendor performance and security posture", "artifact_type": "report", "format_guidance": "Vendor scorecard or review report", "frequency": "quarterly"},
        ]
    },
    "backup_recovery": {
        "keywords": ["backup", "data backup", "backup copy", "backup procedure", "backup system", "backup storage", "backup media"],
        "evidence": [
            {"title": "Backup Policy", "description": "Policy defining backup requirements, schedules, and retention", "artifact_type": "policy", "format_guidance": "Approved backup policy document", "frequency": "annual"},
            {"title": "Backup Schedule Configuration", "description": "Configuration showing backup schedules for all systems", "artifact_type": "configuration", "format_guidance": "Backup software schedule export", "frequency": "quarterly"},
            {"title": "Backup Completion Report", "description": "Report showing successful backup completion status", "artifact_type": "report", "format_guidance": "Backup system success/failure report", "frequency": "monthly"},
            {"title": "Backup Verification Test Results", "description": "Results of backup integrity and restoration testing", "artifact_type": "report", "format_guidance": "Restore test documentation", "frequency": "quarterly"},
            {"title": "Backup Storage Location Documentation", "description": "Documentation of backup storage locations and security", "artifact_type": "record", "format_guidance": "Backup architecture diagram", "frequency": "annual"},
        ]
    },
    "disaster_recovery": {
        "keywords": ["disaster recovery", "dr plan", "recovery plan", "business continuity", "continuity plan", "rto", "rpo", "failover", "recovery site"],
        "evidence": [
            {"title": "Disaster Recovery Plan", "description": "Comprehensive DR plan with recovery procedures", "artifact_type": "policy", "format_guidance": "DR plan document with recovery steps", "frequency": "annual"},
            {"title": "DR Test Results", "description": "Results of disaster recovery testing and exercises", "artifact_type": "report", "format_guidance": "DR test report with findings", "frequency": "annual"},
            {"title": "RTO/RPO Documentation", "description": "Documented recovery time and point objectives for critical systems", "artifact_type": "record", "format_guidance": "RTO/RPO matrix", "frequency": "annual"},
            {"title": "Recovery Procedures", "description": "Step-by-step recovery procedures for critical systems", "artifact_type": "policy", "format_guidance": "Recovery runbooks", "frequency": "annual"},
            {"title": "DR Site Configuration", "description": "Configuration and readiness status of DR site", "artifact_type": "configuration", "format_guidance": "DR infrastructure documentation", "frequency": "quarterly"},
        ]
    },
    "access_management": {
        "keywords": ["access control", "access management", "user access", "authorization", "access rights", "access permission", "role-based access", "rbac", "access grant"],
        "evidence": [
            {"title": "Access Control Policy", "description": "Policy defining access control requirements and principles", "artifact_type": "policy", "format_guidance": "Approved access control policy", "frequency": "annual"},
            {"title": "User Access Matrix", "description": "Matrix showing users/roles and their access permissions", "artifact_type": "record", "format_guidance": "Access matrix spreadsheet", "frequency": "quarterly"},
            {"title": "Access Review Report", "description": "Results of periodic user access reviews and certifications", "artifact_type": "report", "format_guidance": "Access review attestations", "frequency": "quarterly"},
            {"title": "Role Definitions Document", "description": "Documentation of roles and associated access rights", "artifact_type": "record", "format_guidance": "Role definition document", "frequency": "annual"},
            {"title": "Access Request Workflow", "description": "Sample approved access requests showing workflow", "artifact_type": "record", "format_guidance": "Completed access request forms", "frequency": "quarterly"},
        ]
    },
    "physical_access": {
        "keywords": ["physical access", "facility", "data center", "physical security", "building access", "secure area", "restricted area", "physical entry"],
        "evidence": [
            {"title": "Physical Access Policy", "description": "Policy defining physical access control requirements", "artifact_type": "policy", "format_guidance": "Approved physical security policy", "frequency": "annual"},
            {"title": "Access Card/Badge Log", "description": "Log of physical access events from badge readers", "artifact_type": "log", "format_guidance": "Access control system log export", "frequency": "monthly"},
            {"title": "Visitor Log", "description": "Log of visitor entries with escort information", "artifact_type": "log", "format_guidance": "Visitor management system export", "frequency": "monthly"},
            {"title": "Physical Security Assessment", "description": "Assessment of physical security controls effectiveness", "artifact_type": "report", "format_guidance": "Physical security audit report", "frequency": "annual"},
            {"title": "Physical Access Authorization List", "description": "List of personnel authorized for physical access", "artifact_type": "record", "format_guidance": "Current access authorization list", "frequency": "quarterly"},
        ]
    },
    "network_security": {
        "keywords": ["network security", "network protection", "network control", "network perimeter", "network defense", "secure network", "network connections", "nsc configuration", "nsc ruleset", "services and ports", "protocols and ports"],
        "evidence": [
            {"title": "Network Security Policy", "description": "Policy defining network security requirements", "artifact_type": "policy", "format_guidance": "Approved network security policy", "frequency": "annual"},
            {"title": "Network Architecture Diagram", "description": "Current network architecture showing security zones", "artifact_type": "configuration", "format_guidance": "Network diagram with security annotations", "frequency": "quarterly"},
            {"title": "Firewall Rules Export", "description": "Export of current firewall rules and configurations", "artifact_type": "configuration", "format_guidance": "Firewall rule export", "frequency": "quarterly"},
            {"title": "Network Security Scan Results", "description": "Results of network security scanning and testing", "artifact_type": "report", "format_guidance": "Network scan report", "frequency": "quarterly"},
            {"title": "Network Segmentation Documentation", "description": "Documentation of network segmentation controls", "artifact_type": "record", "format_guidance": "Segmentation design document", "frequency": "annual"},
        ]
    },
    "vulnerability_management": {
        "keywords": ["vulnerability", "vulnerabilities", "vulnerability scan", "vulnerability assessment", "security weakness", "vuln scan", "vulnerability management", "known vulnerabilities", "protected from known"],
        "evidence": [
            {"title": "Vulnerability Scan Report", "description": "Full vulnerability scan report with findings and severity", "artifact_type": "report", "format_guidance": "Scanner tool export (Nessus, Qualys, etc.)", "frequency": "quarterly"},
            {"title": "Vulnerability Remediation Tracking", "description": "Tracking of vulnerability remediation progress", "artifact_type": "record", "format_guidance": "Remediation tracker spreadsheet", "frequency": "monthly"},
            {"title": "Vulnerability Management Policy", "description": "Policy defining vulnerability management requirements", "artifact_type": "policy", "format_guidance": "Approved vulnerability policy", "frequency": "annual"},
            {"title": "Vulnerability Trend Analysis", "description": "Trend analysis of vulnerabilities over time", "artifact_type": "report", "format_guidance": "Trend report with graphs", "frequency": "quarterly"},
            {"title": "Vulnerability Scan Schedule", "description": "Documented schedule for vulnerability scanning", "artifact_type": "record", "format_guidance": "Scanning schedule document", "frequency": "annual"},
        ]
    },
    "penetration_testing": {
        "keywords": ["penetration test", "pen test", "security test", "ethical hacking", "offensive security", "red team"],
        "evidence": [
            {"title": "Penetration Test Report", "description": "Full penetration test report from qualified assessor", "artifact_type": "report", "format_guidance": "PDF report with methodology, findings, and remediation", "frequency": "annual"},
            {"title": "Penetration Test Remediation Evidence", "description": "Evidence of remediation of penetration test findings", "artifact_type": "record", "format_guidance": "Remediation status with screenshots", "frequency": "quarterly"},
            {"title": "Penetration Test Retest Results", "description": "Retest results confirming remediation effectiveness", "artifact_type": "report", "format_guidance": "Retest report", "frequency": "annual"},
            {"title": "Penetration Test Scope Document", "description": "Documented scope and rules of engagement", "artifact_type": "record", "format_guidance": "Signed scope document", "frequency": "annual"},
        ]
    },
    "audit_logging": {
        "keywords": ["audit trail", "audit log", "audit logs", "logging", "log retention", "security log", "event log", "audit record", "logs enabled", "logs capture", "log access", "logs protected", "generates log"],
        "evidence": [
            {"title": "Audit Log Policy", "description": "Policy defining audit logging requirements", "artifact_type": "policy", "format_guidance": "Approved logging policy", "frequency": "annual"},
            {"title": "Log Retention Configuration", "description": "Configuration showing log retention settings", "artifact_type": "configuration", "format_guidance": "SIEM/log management retention config", "frequency": "quarterly"},
            {"title": "Sample Audit Logs", "description": "Sample logs demonstrating required events are captured", "artifact_type": "log", "format_guidance": "Log sample with timestamps", "frequency": "monthly"},
            {"title": "Log Review Procedure", "description": "Procedure for reviewing and analyzing audit logs", "artifact_type": "policy", "format_guidance": "Log review procedure document", "frequency": "annual"},
            {"title": "Audit Log Integrity Controls", "description": "Configuration showing log integrity protection", "artifact_type": "configuration", "format_guidance": "Log integrity settings", "frequency": "quarterly"},
        ]
    },
    "security_training": {
        "keywords": ["security awareness", "security training", "user training", "awareness program", "employee training", "staff training", "training program", "trained to be aware", "personnel are trained", "awareness training"],
        "evidence": [
            {"title": "Security Awareness Program", "description": "Documentation of security awareness training program", "artifact_type": "policy", "format_guidance": "Program document with curriculum", "frequency": "annual"},
            {"title": "Training Completion Records", "description": "Records showing training completion by employees", "artifact_type": "report", "format_guidance": "LMS completion report", "frequency": "quarterly"},
            {"title": "Training Materials", "description": "Sample security awareness training materials", "artifact_type": "record", "format_guidance": "Training slides or module content", "frequency": "annual"},
            {"title": "Phishing Test Results", "description": "Results of phishing simulation exercises", "artifact_type": "report", "format_guidance": "Phishing campaign results", "frequency": "quarterly"},
            {"title": "Training Attendance Records", "description": "Attendance records for security training sessions", "artifact_type": "record", "format_guidance": "Sign-in sheets or attendance log", "frequency": "quarterly"},
        ]
    },
    "change_control": {
        "keywords": ["change management", "change control", "change request", "change advisory", "cab", "change process", "change approval"],
        "evidence": [
            {"title": "Change Management Policy", "description": "Policy defining change management process", "artifact_type": "policy", "format_guidance": "Approved change policy", "frequency": "annual"},
            {"title": "Change Request Forms", "description": "Sample completed change requests with approvals", "artifact_type": "record", "format_guidance": "Change tickets from ITSM", "frequency": "quarterly"},
            {"title": "CAB Meeting Minutes", "description": "Change Advisory Board meeting minutes", "artifact_type": "record", "format_guidance": "Meeting minutes with decisions", "frequency": "monthly"},
            {"title": "Change Log", "description": "Log of all changes implemented", "artifact_type": "log", "format_guidance": "Change management system export", "frequency": "monthly"},
            {"title": "Emergency Change Procedure", "description": "Procedure for emergency changes", "artifact_type": "policy", "format_guidance": "Emergency change procedure", "frequency": "annual"},
        ]
    },
    "asset_management": {
        "keywords": ["asset inventory", "asset management", "hardware inventory", "it asset", "asset register", "asset tracking"],
        "evidence": [
            {"title": "IT Asset Inventory", "description": "Complete inventory of IT assets", "artifact_type": "record", "format_guidance": "CMDB export or spreadsheet", "frequency": "quarterly"},
            {"title": "Asset Classification Records", "description": "Records showing asset classification and ownership", "artifact_type": "record", "format_guidance": "Asset classification matrix", "frequency": "annual"},
            {"title": "Asset Register", "description": "Register of all information assets", "artifact_type": "record", "format_guidance": "Asset register spreadsheet", "frequency": "quarterly"},
            {"title": "Asset Management Policy", "description": "Policy for IT asset management", "artifact_type": "policy", "format_guidance": "Approved asset policy", "frequency": "annual"},
            {"title": "Asset Discovery Scan", "description": "Results of automated asset discovery", "artifact_type": "report", "format_guidance": "Discovery tool output", "frequency": "monthly"},
        ]
    },
    "data_protection": {
        "keywords": ["data protection", "data handling", "data classification", "sensitive data", "personal data", "data privacy", "data security"],
        "evidence": [
            {"title": "Data Classification Policy", "description": "Policy defining data classification levels", "artifact_type": "policy", "format_guidance": "Approved classification policy", "frequency": "annual"},
            {"title": "Data Handling Procedures", "description": "Procedures for handling different data types", "artifact_type": "policy", "format_guidance": "Data handling procedure document", "frequency": "annual"},
            {"title": "Data Inventory", "description": "Inventory of data assets with classifications", "artifact_type": "record", "format_guidance": "Data inventory spreadsheet", "frequency": "quarterly"},
            {"title": "Data Protection Controls", "description": "Documentation of data protection controls", "artifact_type": "record", "format_guidance": "Control documentation", "frequency": "annual"},
            {"title": "Data Retention Schedule", "description": "Schedule showing data retention periods", "artifact_type": "record", "format_guidance": "Retention schedule document", "frequency": "annual"},
        ]
    },
    "malware_protection": {
        "keywords": ["malware", "anti-malware", "antivirus", "virus protection", "malicious software", "malicious code", "endpoint protection"],
        "evidence": [
            {"title": "Antivirus Policy", "description": "Policy defining antivirus requirements", "artifact_type": "policy", "format_guidance": "Approved AV policy", "frequency": "annual"},
            {"title": "AV Deployment Report", "description": "Report showing antivirus deployment across endpoints", "artifact_type": "report", "format_guidance": "AV management console report", "frequency": "monthly"},
            {"title": "Malware Scan Results", "description": "Sample antivirus scan results and detections", "artifact_type": "log", "format_guidance": "AV console export", "frequency": "monthly"},
            {"title": "Definition Update Log", "description": "Log showing antivirus definition updates", "artifact_type": "log", "format_guidance": "AV update history", "frequency": "weekly"},
            {"title": "Malware Incident Records", "description": "Records of malware detections and response", "artifact_type": "record", "format_guidance": "Incident tickets for malware", "frequency": "quarterly"},
        ]
    },
    "patch_management": {
        "keywords": ["patch", "patching", "patch management", "system update", "security update", "hotfix", "software update"],
        "evidence": [
            {"title": "Patch Management Policy", "description": "Policy defining patching timelines and procedures", "artifact_type": "policy", "format_guidance": "Approved patch policy", "frequency": "annual"},
            {"title": "Patch Deployment Log", "description": "Log of patches deployed with dates", "artifact_type": "log", "format_guidance": "Patch management system log", "frequency": "monthly"},
            {"title": "Patch Compliance Report", "description": "Report showing patch compliance status", "artifact_type": "report", "format_guidance": "Patch compliance dashboard", "frequency": "monthly"},
            {"title": "Critical Patch Timeline", "description": "Documentation of critical patch deployment timelines", "artifact_type": "record", "format_guidance": "Patch SLA documentation", "frequency": "annual"},
            {"title": "Patch Testing Procedure", "description": "Procedure for testing patches before deployment", "artifact_type": "policy", "format_guidance": "Testing procedure document", "frequency": "annual"},
        ]
    },
    "cryptographic_key": {
        "keywords": ["key management", "cryptographic key", "encryption key", "key rotation", "key custodian", "key lifecycle", "hsm"],
        "evidence": [
            {"title": "Key Management Policy", "description": "Policy defining cryptographic key lifecycle", "artifact_type": "policy", "format_guidance": "Approved key management policy", "frequency": "annual"},
            {"title": "Key Custodian List", "description": "Documentation of key custodian assignments", "artifact_type": "record", "format_guidance": "Custodian assignment document", "frequency": "annual"},
            {"title": "Key Rotation Log", "description": "Log of key rotations performed", "artifact_type": "log", "format_guidance": "Key management system log", "frequency": "quarterly"},
            {"title": "HSM Configuration", "description": "Hardware Security Module configuration", "artifact_type": "configuration", "format_guidance": "HSM admin console export", "frequency": "quarterly"},
            {"title": "Key Inventory", "description": "Inventory of all cryptographic keys", "artifact_type": "record", "format_guidance": "Key inventory with expiration dates", "frequency": "quarterly"},
        ]
    },
    "supplier_services": {
        "keywords": ["supplier service", "supplier management", "third party service", "vendor service", "outsourcing", "service provider management", "supplier relationship", "supplier performance", "supplier risk"],
        "evidence": [
            {"title": "Supplier Performance Review Report", "description": "Periodic review of supplier service delivery against SLAs", "artifact_type": "report", "format_guidance": "Quarterly performance review with metrics", "frequency": "quarterly"},
            {"title": "Supplier SLA Compliance Records", "description": "Records showing supplier compliance with service level agreements", "artifact_type": "record", "format_guidance": "SLA tracking spreadsheet or dashboard export", "frequency": "monthly"},
            {"title": "Supplier Security Assessment Report", "description": "Security assessment or audit of supplier's controls", "artifact_type": "report", "format_guidance": "Third-party assessment or questionnaire results", "frequency": "annual"},
            {"title": "Supplier Change Request Records", "description": "Records of changes to supplier services and approvals", "artifact_type": "record", "format_guidance": "Change management records for supplier changes", "frequency": "quarterly"},
            {"title": "Supplier Risk Assessment", "description": "Risk assessment for critical suppliers", "artifact_type": "report", "format_guidance": "Completed risk assessment with risk ratings", "frequency": "annual"},
        ]
    },
    "supplier_monitoring": {
        "keywords": ["monitoring of supplier", "monitor supplier", "supplier monitoring", "review of supplier", "evaluate supplier", "supplier review", "change management of supplier"],
        "evidence": [
            {"title": "Supplier Performance Dashboard", "description": "Dashboard showing supplier performance metrics and KPIs", "artifact_type": "screenshot", "format_guidance": "Screenshot of monitoring dashboard", "frequency": "monthly"},
            {"title": "Supplier Review Meeting Minutes", "description": "Minutes from periodic supplier review meetings", "artifact_type": "record", "format_guidance": "Meeting notes with attendees and action items", "frequency": "quarterly"},
            {"title": "Supplier Incident Log", "description": "Log of incidents or issues with supplier services", "artifact_type": "log", "format_guidance": "Incident tracking system export", "frequency": "monthly"},
            {"title": "Supplier Change Impact Assessment", "description": "Assessment of changes to supplier services", "artifact_type": "report", "format_guidance": "Change impact analysis document", "frequency": "as_needed"},
            {"title": "Supplier Compliance Attestation", "description": "Attestation from supplier confirming compliance", "artifact_type": "certificate", "format_guidance": "SOC 2 report, ISO certificate, or compliance attestation", "frequency": "annual"},
        ]
    },
    "risk_management": {
        "keywords": ["risk assessment", "risk management", "risk analysis", "threat assessment", "risk identification", "risk evaluation", "risk treatment"],
        "evidence": [
            {"title": "Risk Assessment Report", "description": "Completed risk assessment with findings", "artifact_type": "report", "format_guidance": "Risk assessment document", "frequency": "annual"},
            {"title": "Risk Register", "description": "Register of identified risks with ratings", "artifact_type": "record", "format_guidance": "Risk register spreadsheet", "frequency": "quarterly"},
            {"title": "Risk Assessment Methodology", "description": "Documented risk assessment methodology", "artifact_type": "policy", "format_guidance": "Methodology document", "frequency": "annual"},
            {"title": "Risk Treatment Plan", "description": "Plan for addressing identified risks", "artifact_type": "record", "format_guidance": "Treatment plan with timelines", "frequency": "quarterly"},
            {"title": "Risk Acceptance Records", "description": "Records of formally accepted risks", "artifact_type": "record", "format_guidance": "Signed risk acceptance forms", "frequency": "quarterly"},
        ]
    },
    "password_authentication": {
        "keywords": ["password", "credential", "authentication", "password complexity", "password policy", "strong authentication", "password change", "password reset"],
        "evidence": [
            {"title": "Password Policy Document", "description": "Policy defining password requirements", "artifact_type": "policy", "format_guidance": "Approved password policy", "frequency": "annual"},
            {"title": "Password Configuration Settings", "description": "System password policy configuration", "artifact_type": "configuration", "format_guidance": "GPO or system password settings", "frequency": "quarterly"},
            {"title": "Password Compliance Report", "description": "Report showing password policy compliance", "artifact_type": "report", "format_guidance": "Compliance report from IAM", "frequency": "monthly"},
            {"title": "Password Age Report", "description": "Report of password ages across accounts", "artifact_type": "report", "format_guidance": "Identity management export", "frequency": "quarterly"},
        ]
    },
    "mfa_authentication": {
        "keywords": ["multi-factor", "mfa", "two-factor", "2fa", "additional authentication factor", "second factor"],
        "evidence": [
            {"title": "MFA Configuration", "description": "Multi-factor authentication configuration", "artifact_type": "configuration", "format_guidance": "MFA system configuration export", "frequency": "quarterly"},
            {"title": "MFA Enrollment Report", "description": "Report showing MFA enrollment status", "artifact_type": "report", "format_guidance": "MFA enrollment dashboard", "frequency": "monthly"},
            {"title": "MFA Policy", "description": "Policy defining MFA requirements", "artifact_type": "policy", "format_guidance": "Approved MFA policy", "frequency": "annual"},
            {"title": "MFA Exception List", "description": "List of MFA exceptions with justification", "artifact_type": "record", "format_guidance": "Exception spreadsheet with approvals", "frequency": "quarterly"},
        ]
    },
    "privileged_access": {
        "keywords": ["privileged access", "admin access", "administrative access", "root access", "elevated privilege", "pam", "privileged account", "superuser"],
        "evidence": [
            {"title": "Privileged Account Inventory", "description": "Inventory of all privileged accounts", "artifact_type": "record", "format_guidance": "PAM system export", "frequency": "monthly"},
            {"title": "PAM Configuration", "description": "Privileged Access Management configuration", "artifact_type": "configuration", "format_guidance": "PAM policy configuration", "frequency": "quarterly"},
            {"title": "Privileged Session Recording", "description": "Log of privileged session recordings", "artifact_type": "log", "format_guidance": "PAM session log", "frequency": "monthly"},
            {"title": "Privileged Access Request Forms", "description": "Sample approved privileged access requests", "artifact_type": "record", "format_guidance": "Request forms with approvals", "frequency": "quarterly"},
            {"title": "Privileged Access Review", "description": "Periodic review of privileged access", "artifact_type": "report", "format_guidance": "Access review report", "frequency": "quarterly"},
        ]
    },
    "network_monitoring": {
        "keywords": ["network monitoring", "siem", "security monitoring", "continuous monitoring", "network surveillance", "security event monitoring"],
        "evidence": [
            {"title": "SIEM Dashboard Screenshot", "description": "Screenshot of SIEM dashboard showing monitoring", "artifact_type": "screenshot", "format_guidance": "Screenshot with timestamp", "frequency": "monthly"},
            {"title": "Security Monitoring Procedure", "description": "Procedure for security event monitoring", "artifact_type": "policy", "format_guidance": "Monitoring procedure document", "frequency": "annual"},
            {"title": "Alert Configuration", "description": "Configuration of security alerts", "artifact_type": "configuration", "format_guidance": "SIEM alert rule export", "frequency": "quarterly"},
            {"title": "Monitoring Coverage Report", "description": "Report of systems under monitoring", "artifact_type": "report", "format_guidance": "Monitoring coverage matrix", "frequency": "quarterly"},
        ]
    },
    "secure_development": {
        "keywords": ["secure coding", "secure development", "code review", "application security", "sdlc", "software development", "secure software"],
        "evidence": [
            {"title": "Secure Coding Standards", "description": "Standards for secure software development", "artifact_type": "policy", "format_guidance": "Coding standards document", "frequency": "annual"},
            {"title": "Code Review Records", "description": "Records of security code reviews", "artifact_type": "record", "format_guidance": "Code review tool export", "frequency": "quarterly"},
            {"title": "Static Analysis Results", "description": "Results of static code analysis", "artifact_type": "report", "format_guidance": "SAST tool output", "frequency": "quarterly"},
            {"title": "Developer Security Training", "description": "Records of developer security training", "artifact_type": "record", "format_guidance": "Training completion records", "frequency": "annual"},
        ]
    },
    "user_provisioning": {
        "keywords": ["user provisioning", "onboarding", "account creation", "user registration", "new user", "identity lifecycle", "joiner", "unique id", "unique ids", "user id assigned"],
        "evidence": [
            {"title": "User Provisioning Procedure", "description": "Procedure for new user account creation", "artifact_type": "policy", "format_guidance": "Provisioning procedure document", "frequency": "annual"},
            {"title": "Access Request Forms", "description": "Sample completed access request forms", "artifact_type": "record", "format_guidance": "Forms with approvals", "frequency": "quarterly"},
            {"title": "Account Creation Log", "description": "Log of new accounts created", "artifact_type": "log", "format_guidance": "IAM system log", "frequency": "monthly"},
            {"title": "New Hire Access Checklist", "description": "Checklist for new employee access", "artifact_type": "record", "format_guidance": "Completed checklists", "frequency": "quarterly"},
        ]
    },
    "user_termination": {
        "keywords": ["termination", "deprovisioning", "offboarding", "revoke access", "account disable", "user removal", "leaver", "access revocation"],
        "evidence": [
            {"title": "Termination Procedure", "description": "Procedure for access revocation on termination", "artifact_type": "policy", "format_guidance": "Offboarding procedure", "frequency": "annual"},
            {"title": "Access Removal Log", "description": "Log of access removal for terminated users", "artifact_type": "log", "format_guidance": "IAM system log with timestamps", "frequency": "monthly"},
            {"title": "Termination Checklist", "description": "Completed termination checklists", "artifact_type": "record", "format_guidance": "Sample checklists with sign-off", "frequency": "quarterly"},
            {"title": "Terminated User Audit", "description": "Audit of terminated users for lingering access", "artifact_type": "report", "format_guidance": "Audit report with findings", "frequency": "quarterly"},
        ]
    },
    "firewall_management": {
        "keywords": ["firewall", "network security control", "traffic filtering", "firewall rule", "firewall policy", "perimeter security"],
        "evidence": [
            {"title": "Firewall Rule Export", "description": "Export of all firewall rules", "artifact_type": "configuration", "format_guidance": "Firewall management console export", "frequency": "quarterly"},
            {"title": "Firewall Change Log", "description": "Log of firewall rule changes", "artifact_type": "log", "format_guidance": "Change management export", "frequency": "monthly"},
            {"title": "Firewall Rule Review", "description": "Review of firewall rules against policy", "artifact_type": "report", "format_guidance": "Rule review report", "frequency": "semi-annual"},
            {"title": "Firewall Configuration Baseline", "description": "Baseline configuration standards for firewalls", "artifact_type": "policy", "format_guidance": "Configuration standard", "frequency": "annual"},
        ]
    },
    "configuration_hardening": {
        "keywords": ["configuration management", "baseline configuration", "hardening", "system configuration", "secure configuration", "system hardening", "configuration standard", "configuration files", "secure from unauthorized"],
        "evidence": [
            {"title": "Configuration Baseline Standards", "description": "Secure configuration baselines for systems", "artifact_type": "policy", "format_guidance": "CIS benchmark or equivalent", "frequency": "annual"},
            {"title": "Configuration Compliance Scan", "description": "Scan results against baselines", "artifact_type": "report", "format_guidance": "Configuration scanner report", "frequency": "quarterly"},
            {"title": "Hardening Checklist", "description": "Completed system hardening checklists", "artifact_type": "record", "format_guidance": "Signed checklists", "frequency": "quarterly"},
            {"title": "Configuration Deviation Report", "description": "Report of configuration deviations", "artifact_type": "report", "format_guidance": "Exception report", "frequency": "quarterly"},
        ]
    },
    "intrusion_detection": {
        "keywords": ["intrusion detection", "intrusion prevention", "network intrusion", "host intrusion", "ids/ips", "ids sensor", "ips sensor"],
        "evidence": [
            {"title": "IDS/IPS Configuration", "description": "Intrusion detection system configuration", "artifact_type": "configuration", "format_guidance": "IDS policy export", "frequency": "quarterly"},
            {"title": "IDS Alert Log", "description": "Log of IDS/IPS alerts", "artifact_type": "log", "format_guidance": "IDS alert log", "frequency": "monthly"},
            {"title": "IDS Signature Updates", "description": "Log of signature and rule updates", "artifact_type": "log", "format_guidance": "Update history", "frequency": "monthly"},
            {"title": "IDS Coverage Report", "description": "Report of IDS sensor coverage", "artifact_type": "report", "format_guidance": "Coverage documentation", "frequency": "quarterly"},
        ]
    },
    "media_handling": {
        "keywords": ["media", "removable media", "usb", "portable storage", "media disposal", "removable device"],
        "evidence": [
            {"title": "Removable Media Policy", "description": "Policy for removable media usage", "artifact_type": "policy", "format_guidance": "Approved media policy", "frequency": "annual"},
            {"title": "USB Device Control Configuration", "description": "Configuration showing USB device controls", "artifact_type": "configuration", "format_guidance": "Endpoint protection USB policy", "frequency": "quarterly"},
            {"title": "Media Disposal Log", "description": "Log of secure media disposal", "artifact_type": "log", "format_guidance": "Disposal log with certificates", "frequency": "quarterly"},
            {"title": "Media Encryption Status", "description": "Status of encryption on removable media", "artifact_type": "report", "format_guidance": "Encryption compliance report", "frequency": "quarterly"},
        ]
    },
    "wireless_security": {
        "keywords": ["wireless", "wifi", "wlan", "802.11", "wireless network", "wireless security"],
        "evidence": [
            {"title": "Wireless Security Policy", "description": "Policy for wireless network security", "artifact_type": "policy", "format_guidance": "Approved wireless policy", "frequency": "annual"},
            {"title": "Wireless Configuration", "description": "Wireless controller configuration", "artifact_type": "configuration", "format_guidance": "Controller export", "frequency": "quarterly"},
            {"title": "Rogue AP Scan Results", "description": "Scan for rogue access points", "artifact_type": "report", "format_guidance": "Wireless scanner report", "frequency": "quarterly"},
            {"title": "Wireless Network Inventory", "description": "Inventory of authorized wireless networks", "artifact_type": "record", "format_guidance": "SSID inventory", "frequency": "quarterly"},
        ]
    },
    "remote_access_security": {
        "keywords": ["remote access", "vpn", "remote connection", "telecommute", "remote work", "virtual private network"],
        "evidence": [
            {"title": "Remote Access Policy", "description": "Policy for remote access", "artifact_type": "policy", "format_guidance": "Approved remote access policy", "frequency": "annual"},
            {"title": "VPN Configuration", "description": "VPN gateway configuration", "artifact_type": "configuration", "format_guidance": "VPN configuration export", "frequency": "quarterly"},
            {"title": "Remote Access User List", "description": "List of users with remote access", "artifact_type": "record", "format_guidance": "VPN user list", "frequency": "monthly"},
            {"title": "Remote Access Log", "description": "Log of remote access connections", "artifact_type": "log", "format_guidance": "VPN connection log", "frequency": "monthly"},
        ]
    },
    "mobile_device_security": {
        "keywords": ["mobile device", "mdm", "byod", "mobile security", "smartphone", "tablet", "mobile management"],
        "evidence": [
            {"title": "Mobile Device Policy", "description": "Policy for mobile device security", "artifact_type": "policy", "format_guidance": "Approved mobile policy", "frequency": "annual"},
            {"title": "MDM Configuration", "description": "Mobile device management configuration", "artifact_type": "configuration", "format_guidance": "MDM policy export", "frequency": "quarterly"},
            {"title": "Mobile Device Inventory", "description": "Inventory of managed mobile devices", "artifact_type": "record", "format_guidance": "MDM device inventory", "frequency": "monthly"},
            {"title": "Mobile Device Compliance Report", "description": "Mobile device compliance status", "artifact_type": "report", "format_guidance": "MDM compliance dashboard", "frequency": "monthly"},
        ]
    },
    "cloud_security": {
        "keywords": ["cloud", "cloud security", "iaas", "paas", "saas", "cloud provider", "cloud environment"],
        "evidence": [
            {"title": "Cloud Security Policy", "description": "Policy for cloud service security", "artifact_type": "policy", "format_guidance": "Approved cloud policy", "frequency": "annual"},
            {"title": "Cloud Configuration Audit", "description": "Audit of cloud security configuration", "artifact_type": "report", "format_guidance": "Cloud security posture report", "frequency": "quarterly"},
            {"title": "Cloud Access Configuration", "description": "IAM configuration for cloud", "artifact_type": "configuration", "format_guidance": "Cloud IAM policy export", "frequency": "quarterly"},
            {"title": "Cloud Service Inventory", "description": "Inventory of cloud services in use", "artifact_type": "record", "format_guidance": "Cloud service registry", "frequency": "quarterly"},
        ]
    },
    "data_retention_disposal": {
        "keywords": ["data retention", "data disposal", "retention schedule", "data destruction", "retention period", "data deletion"],
        "evidence": [
            {"title": "Data Retention Policy", "description": "Policy defining data retention requirements", "artifact_type": "policy", "format_guidance": "Approved retention policy", "frequency": "annual"},
            {"title": "Retention Schedule", "description": "Schedule of retention periods by data type", "artifact_type": "record", "format_guidance": "Retention schedule document", "frequency": "annual"},
            {"title": "Data Destruction Certificates", "description": "Certificates for secure data destruction", "artifact_type": "certificate", "format_guidance": "Destruction certificates", "frequency": "as_needed"},
            {"title": "Disposal Procedure Records", "description": "Records of data disposal activities", "artifact_type": "log", "format_guidance": "Disposal log", "frequency": "quarterly"},
        ]
    },
    "business_impact": {
        "keywords": ["business impact", "bia", "criticality", "impact analysis", "critical system", "critical asset"],
        "evidence": [
            {"title": "Business Impact Analysis", "description": "BIA documenting critical business processes", "artifact_type": "report", "format_guidance": "BIA report", "frequency": "annual"},
            {"title": "Critical Systems Inventory", "description": "Inventory of critical systems and assets", "artifact_type": "record", "format_guidance": "Critical systems list", "frequency": "annual"},
            {"title": "Recovery Priorities", "description": "Prioritized list for recovery", "artifact_type": "record", "format_guidance": "Recovery priority matrix", "frequency": "annual"},
            {"title": "BIA Review Records", "description": "Records of BIA review and updates", "artifact_type": "record", "format_guidance": "Review documentation", "frequency": "annual"},
        ]
    },
    "segregation_duties": {
        "keywords": ["segregation of duties", "separation of duties", "sod", "duty separation", "conflicting duties", "incompatible functions"],
        "evidence": [
            {"title": "Segregation of Duties Matrix", "description": "Matrix showing duty separation requirements", "artifact_type": "record", "format_guidance": "SoD matrix document", "frequency": "annual"},
            {"title": "SoD Policy", "description": "Policy for segregation of duties", "artifact_type": "policy", "format_guidance": "Approved SoD policy", "frequency": "annual"},
            {"title": "SoD Conflict Report", "description": "Report of SoD conflicts and resolutions", "artifact_type": "report", "format_guidance": "SoD analysis report", "frequency": "quarterly"},
            {"title": "Role Assignment Review", "description": "Review of role assignments for conflicts", "artifact_type": "report", "format_guidance": "Role review report", "frequency": "quarterly"},
        ]
    },
    "time_synchronization": {
        "keywords": ["time synchronization", "ntp", "time server", "clock", "time source", "time sync"],
        "evidence": [
            {"title": "NTP Configuration", "description": "Time synchronization configuration", "artifact_type": "configuration", "format_guidance": "NTP server configuration", "frequency": "quarterly"},
            {"title": "Time Source Documentation", "description": "Documentation of authoritative time sources", "artifact_type": "record", "format_guidance": "Time architecture document", "frequency": "annual"},
            {"title": "Time Sync Status Report", "description": "Report of time synchronization status", "artifact_type": "report", "format_guidance": "NTP monitoring output", "frequency": "quarterly"},
        ]
    },
    "service_account_management": {
        "keywords": ["service account", "system account", "application account", "non-human", "bot account", "shared account"],
        "evidence": [
            {"title": "Service Account Inventory", "description": "Inventory of all service accounts", "artifact_type": "record", "format_guidance": "Account inventory spreadsheet", "frequency": "quarterly"},
            {"title": "Service Account Policy", "description": "Policy for service account management", "artifact_type": "policy", "format_guidance": "Approved policy document", "frequency": "annual"},
            {"title": "Service Account Review", "description": "Periodic review of service accounts", "artifact_type": "report", "format_guidance": "Review report with attestations", "frequency": "quarterly"},
            {"title": "Service Account Ownership", "description": "Documentation of service account owners", "artifact_type": "record", "format_guidance": "Ownership assignment records", "frequency": "quarterly"},
        ]
    },
    "web_application_security": {
        "keywords": ["web application", "web security", "application firewall", "waf", "web vulnerability", "web app"],
        "evidence": [
            {"title": "Web Application Security Policy", "description": "Policy for web application security", "artifact_type": "policy", "format_guidance": "Approved web app policy", "frequency": "annual"},
            {"title": "WAF Configuration", "description": "Web Application Firewall configuration", "artifact_type": "configuration", "format_guidance": "WAF rule set export", "frequency": "quarterly"},
            {"title": "Web Application Scan Results", "description": "Dynamic application security test results", "artifact_type": "report", "format_guidance": "DAST tool report", "frequency": "quarterly"},
            {"title": "Web App Inventory", "description": "Inventory of web applications", "artifact_type": "record", "format_guidance": "Application inventory", "frequency": "quarterly"},
        ]
    },
    "compliance_monitoring": {
        "keywords": ["compliance monitoring", "compliance review", "regulatory compliance", "compliance audit", "compliance status"],
        "evidence": [
            {"title": "Compliance Monitoring Program", "description": "Program for ongoing compliance monitoring", "artifact_type": "policy", "format_guidance": "Program documentation", "frequency": "annual"},
            {"title": "Compliance Status Report", "description": "Current compliance status report", "artifact_type": "report", "format_guidance": "Compliance dashboard", "frequency": "quarterly"},
            {"title": "Compliance Review Records", "description": "Records of compliance reviews", "artifact_type": "record", "format_guidance": "Review documentation", "frequency": "quarterly"},
            {"title": "Regulatory Requirement Mapping", "description": "Mapping of controls to regulations", "artifact_type": "record", "format_guidance": "Compliance mapping matrix", "frequency": "annual"},
        ]
    },
    "dlp_data_leakage": {
        "keywords": ["data loss prevention", "dlp", "data leakage", "exfiltration prevention", "data egress"],
        "evidence": [
            {"title": "DLP Policy Configuration", "description": "DLP policies and rules configuration", "artifact_type": "configuration", "format_guidance": "DLP system policy export", "frequency": "quarterly"},
            {"title": "DLP Incident Report", "description": "Report of DLP incidents and responses", "artifact_type": "report", "format_guidance": "DLP system incident log", "frequency": "monthly"},
            {"title": "DLP Coverage Report", "description": "Report of systems covered by DLP", "artifact_type": "report", "format_guidance": "DLP deployment status", "frequency": "quarterly"},
            {"title": "DLP Rule Review", "description": "Review of DLP rules effectiveness", "artifact_type": "report", "format_guidance": "Rule review documentation", "frequency": "quarterly"},
        ]
    },
    "cctv_surveillance": {
        "keywords": ["cctv", "surveillance", "camera", "video monitoring", "video surveillance", "security camera"],
        "evidence": [
            {"title": "CCTV Coverage Map", "description": "Map showing camera locations and coverage", "artifact_type": "record", "format_guidance": "Facility diagram with camera placement", "frequency": "annual"},
            {"title": "CCTV Retention Configuration", "description": "Video retention settings configuration", "artifact_type": "configuration", "format_guidance": "CCTV system configuration", "frequency": "quarterly"},
            {"title": "CCTV Sample Footage", "description": "Sample footage demonstrating quality", "artifact_type": "record", "format_guidance": "Short video clip sample", "frequency": "quarterly"},
            {"title": "CCTV Maintenance Records", "description": "Records of CCTV system maintenance", "artifact_type": "record", "format_guidance": "Maintenance log", "frequency": "monthly"},
        ]
    },
    "email_security": {
        "keywords": ["email security", "email filtering", "spam", "phishing protection", "email gateway", "email protection"],
        "evidence": [
            {"title": "Email Security Policy", "description": "Policy for email security", "artifact_type": "policy", "format_guidance": "Approved email policy", "frequency": "annual"},
            {"title": "Email Gateway Configuration", "description": "Email security gateway configuration", "artifact_type": "configuration", "format_guidance": "Email gateway policy export", "frequency": "quarterly"},
            {"title": "Email Security Report", "description": "Report of email threats blocked", "artifact_type": "report", "format_guidance": "Email security dashboard", "frequency": "monthly"},
            {"title": "Anti-Phishing Controls", "description": "Configuration of anti-phishing controls", "artifact_type": "configuration", "format_guidance": "Anti-phishing settings", "frequency": "quarterly"},
        ]
    },
    "default_credentials": {
        "keywords": ["default password", "default credential", "vendor default", "factory default", "default account"],
        "evidence": [
            {"title": "Default Password Change Procedure", "description": "Procedure for changing default passwords", "artifact_type": "policy", "format_guidance": "Procedure document", "frequency": "annual"},
            {"title": "Default Password Scan Results", "description": "Scan for systems with default credentials", "artifact_type": "report", "format_guidance": "Vulnerability scan for defaults", "frequency": "quarterly"},
            {"title": "System Deployment Checklist", "description": "Checklist ensuring defaults are changed", "artifact_type": "record", "format_guidance": "Completed deployment checklists", "frequency": "quarterly"},
        ]
    },
    "pos_terminal_security": {
        "keywords": ["pos", "point of sale", "payment terminal", "card reader", "payment device", "pos terminal"],
        "evidence": [
            {"title": "POS Terminal Inventory", "description": "Inventory of all POS terminals", "artifact_type": "record", "format_guidance": "Terminal inventory with locations", "frequency": "quarterly"},
            {"title": "POS Security Configuration", "description": "Security configuration for POS terminals", "artifact_type": "configuration", "format_guidance": "Terminal configuration", "frequency": "quarterly"},
            {"title": "POS Inspection Log", "description": "Log of POS terminal physical inspections", "artifact_type": "log", "format_guidance": "Inspection checklist log", "frequency": "monthly"},
            {"title": "POS Tamper Evidence", "description": "Evidence of tamper detection controls", "artifact_type": "record", "format_guidance": "Tamper inspection records", "frequency": "monthly"},
        ]
    },
    "network_diagram": {
        "keywords": ["network diagram", "network topology", "cardholder data flow", "data flow diagram", "network documentation", "data-flow diagram", "accurate data-flow", "account data flows"],
        "evidence": [
            {"title": "Current Network Topology Diagram", "description": "Complete network architecture diagram", "artifact_type": "configuration", "format_guidance": "Visio or draw.io export with date", "frequency": "quarterly"},
            {"title": "Cardholder Data Flow Diagram", "description": "Diagram showing cardholder data flows", "artifact_type": "configuration", "format_guidance": "PDF diagram with annotations", "frequency": "annual"},
            {"title": "Network Segmentation Diagram", "description": "Network zones and segmentation boundaries", "artifact_type": "configuration", "format_guidance": "Architecture diagram", "frequency": "quarterly"},
            {"title": "Network Documentation Review", "description": "Review and update of network diagrams", "artifact_type": "record", "format_guidance": "Review records with sign-off", "frequency": "quarterly"},
        ]
    },
    "file_integrity": {
        "keywords": ["file integrity", "fim", "file monitoring", "integrity monitoring", "change detection", "critical file"],
        "evidence": [
            {"title": "FIM Configuration", "description": "File integrity monitoring configuration", "artifact_type": "configuration", "format_guidance": "FIM tool configuration export", "frequency": "quarterly"},
            {"title": "FIM Alert Log", "description": "Log of file integrity alerts", "artifact_type": "log", "format_guidance": "FIM system alert log", "frequency": "monthly"},
            {"title": "Critical File Baseline", "description": "Baseline of monitored critical files", "artifact_type": "record", "format_guidance": "List of monitored files/directories", "frequency": "quarterly"},
            {"title": "FIM Coverage Report", "description": "Report of systems with FIM coverage", "artifact_type": "report", "format_guidance": "FIM deployment status", "frequency": "quarterly"},
        ]
    },
}

# EVIDENCE_PATTERNS are checked after HIGH_PRIORITY_PATTERNS
EVIDENCE_PATTERNS = {
    "router_switch": {
        "keywords": ["router", "switch", "routing", "network device", "layer 3", "layer 2"],
        "evidence": [
            {"title": "Router Configuration Export", "description": "Running configuration from all routers in the environment", "artifact_type": "configuration", "format_guidance": "show running-config output", "frequency": "quarterly"},
            {"title": "Switch VLAN Configuration", "description": "VLAN configuration showing network segmentation", "artifact_type": "configuration", "format_guidance": "show vlan command output", "frequency": "quarterly"},
            {"title": "Routing Table Export", "description": "Current routing tables from core network devices", "artifact_type": "configuration", "format_guidance": "show ip route output", "frequency": "monthly"},
        ]
    },
    "encryption_transit": {
        "keywords": ["encryption in transit", "tls", "ssl", "transport layer", "encrypted transmission", "secure transmission", "data in transit"],
        "evidence": [
            {"title": "TLS Configuration Report", "description": "SSL/TLS configuration showing supported protocols and cipher suites", "artifact_type": "configuration", "format_guidance": "SSL Labs scan or similar tool output", "frequency": "quarterly"},
            {"title": "Certificate Inventory", "description": "Inventory of all TLS certificates with expiration dates", "artifact_type": "record", "format_guidance": "Certificate management system export", "frequency": "monthly"},
            {"title": "Encryption Standards Document", "description": "Document defining approved encryption protocols and ciphers", "artifact_type": "policy", "format_guidance": "Standards document with version control", "frequency": "annual"},
            {"title": "Network Traffic Encryption Scan", "description": "Scan results showing encrypted vs unencrypted traffic", "artifact_type": "report", "format_guidance": "Network security tool output", "frequency": "quarterly"},
        ]
    },
    "encryption_rest": {
        "keywords": ["encryption at rest", "database encryption", "tde", "storage encryption", "data at rest"],
        "evidence": [
            {"title": "Database TDE Configuration", "description": "Transparent Data Encryption configuration for databases", "artifact_type": "configuration", "format_guidance": "Database encryption status query output", "frequency": "quarterly"},
            {"title": "Disk Encryption Status Report", "description": "BitLocker or equivalent disk encryption status for all systems", "artifact_type": "report", "format_guidance": "Encryption management tool report", "frequency": "monthly"},
            {"title": "Encryption Key Management Procedure", "description": "Documented procedures for encryption key lifecycle management", "artifact_type": "policy", "format_guidance": "Procedure document with key custodian information", "frequency": "annual"},
            {"title": "Storage Encryption Audit", "description": "Audit report validating encryption for all data at rest locations", "artifact_type": "report", "format_guidance": "Internal audit report", "frequency": "annual"},
        ]
    },
    "restore_test": {
        "keywords": ["restore test", "recovery test", "backup test", "restoration", "data restoration"],
        "evidence": [
            {"title": "Restore Test Procedure", "description": "Procedure for performing backup restore tests", "artifact_type": "policy", "format_guidance": "Documented procedure", "frequency": "annual"},
            {"title": "Restore Test Results", "description": "Results of backup restoration testing", "artifact_type": "report", "format_guidance": "Test report with success/failure status", "frequency": "quarterly"},
            {"title": "Restore Test Schedule", "description": "Schedule for periodic restore testing", "artifact_type": "record", "format_guidance": "Testing schedule document", "frequency": "annual"},
        ]
    },
    "incident_test": {
        "keywords": ["incident test", "tabletop exercise", "ir drill", "incident simulation", "ir exercise"],
        "evidence": [
            {"title": "Tabletop Exercise Report", "description": "Results of incident response tabletop exercise", "artifact_type": "report", "format_guidance": "Exercise report with lessons learned", "frequency": "annual"},
            {"title": "IR Drill Schedule", "description": "Schedule of incident response drills and exercises", "artifact_type": "record", "format_guidance": "Annual testing schedule", "frequency": "annual"},
            {"title": "Exercise Attendance Record", "description": "Attendance records for IR exercises", "artifact_type": "record", "format_guidance": "Sign-in sheet or attendance log", "frequency": "annual"},
        ]
    },
    "sla": {
        "keywords": ["service level", "sla", "service agreement", "performance metrics"],
        "evidence": [
            {"title": "Service Level Agreements", "description": "SLAs with service providers", "artifact_type": "record", "format_guidance": "SLA documentation", "frequency": "annual"},
            {"title": "SLA Performance Report", "description": "Report of SLA performance metrics", "artifact_type": "report", "format_guidance": "Performance dashboard", "frequency": "monthly"},
        ]
    },
    "session_management": {
        "keywords": ["session", "timeout", "idle", "session management", "session timeout"],
        "evidence": [
            {"title": "Session Timeout Configuration", "description": "Configuration showing session timeout settings", "artifact_type": "configuration", "format_guidance": "System configuration exports", "frequency": "quarterly"},
            {"title": "Session Management Policy", "description": "Policy for session management requirements", "artifact_type": "policy", "format_guidance": "Security policy section", "frequency": "annual"},
            {"title": "Session Timeout Test Results", "description": "Test results validating timeout functionality", "artifact_type": "report", "format_guidance": "Testing documentation", "frequency": "quarterly"},
        ]
    },
    "network_access_control": {
        "keywords": ["network access control", "nac", "802.1x", "port security", "network admission"],
        "evidence": [
            {"title": "NAC Configuration", "description": "Network access control configuration", "artifact_type": "configuration", "format_guidance": "NAC system configuration export", "frequency": "quarterly"},
            {"title": "NAC Policy", "description": "Policy for network access control", "artifact_type": "policy", "format_guidance": "Approved policy document", "frequency": "annual"},
            {"title": "NAC Enforcement Report", "description": "Report of NAC enforcement actions", "artifact_type": "report", "format_guidance": "NAC system log", "frequency": "monthly"},
        ]
    },
    "secure_disposal": {
        "keywords": ["secure disposal", "sanitization", "wiping", "degaussing"],
        "evidence": [
            {"title": "Data Disposal Policy", "description": "Policy for secure data and media disposal", "artifact_type": "policy", "format_guidance": "Approved policy document", "frequency": "annual"},
            {"title": "Disposal Procedure", "description": "Procedure for secure disposal of equipment", "artifact_type": "policy", "format_guidance": "Procedure document", "frequency": "annual"},
            {"title": "Disposal Certificates", "description": "Certificates of destruction from disposal vendor", "artifact_type": "certificate", "format_guidance": "Vendor destruction certificates", "frequency": "as_needed"},
            {"title": "Disposal Log", "description": "Log of disposed equipment and data", "artifact_type": "log", "format_guidance": "Disposal tracking log", "frequency": "quarterly"},
        ]
    },
    "api_security": {
        "keywords": ["api", "application programming interface", "api security", "api gateway"],
        "evidence": [
            {"title": "API Security Standards", "description": "Standards for API security implementation", "artifact_type": "policy", "format_guidance": "API security guidelines document", "frequency": "annual"},
            {"title": "API Gateway Configuration", "description": "API gateway security configuration", "artifact_type": "configuration", "format_guidance": "Gateway configuration export", "frequency": "quarterly"},
            {"title": "API Security Test Results", "description": "Results of API security testing", "artifact_type": "report", "format_guidance": "API security scan report", "frequency": "quarterly"},
        ]
    },
    "dns_security": {
        "keywords": ["dns", "domain name", "dns security", "dnssec"],
        "evidence": [
            {"title": "DNS Configuration", "description": "DNS server security configuration", "artifact_type": "configuration", "format_guidance": "DNS server configuration", "frequency": "quarterly"},
            {"title": "DNS Security Settings", "description": "DNSSEC and security settings", "artifact_type": "configuration", "format_guidance": "DNS security configuration", "frequency": "quarterly"},
        ]
    },
    "network_segmentation": {
        "keywords": ["network segmentation", "network isolation", "segment", "zone", "microsegmentation"],
        "evidence": [
            {"title": "Network Segmentation Design", "description": "Design document for network segmentation", "artifact_type": "configuration", "format_guidance": "Architecture document", "frequency": "annual"},
            {"title": "Segmentation Test Results", "description": "Results of segmentation testing", "artifact_type": "report", "format_guidance": "Penetration test or segmentation test report", "frequency": "annual"},
            {"title": "VLAN Configuration", "description": "VLAN configuration showing segmentation", "artifact_type": "configuration", "format_guidance": "Switch VLAN export", "frequency": "quarterly"},
        ]
    },
    "policy_governance": {
        "keywords": ["information security policy", "policy review", "policy approval", "documented policy", "policies and procedures", "security policies", "organizational policies"],
        "evidence": [
            {"title": "Policy Document", "description": "Approved policy document with signatures", "artifact_type": "policy", "format_guidance": "PDF policy with approval signatures", "frequency": "annual"},
            {"title": "Policy Approval Records", "description": "Records of policy approval by management", "artifact_type": "record", "format_guidance": "Signed approval pages", "frequency": "annual"},
            {"title": "Policy Version History", "description": "Version history showing policy updates", "artifact_type": "record", "format_guidance": "Document management version log", "frequency": "annual"},
            {"title": "Policy Review Schedule", "description": "Schedule for periodic policy reviews", "artifact_type": "record", "format_guidance": "Review calendar", "frequency": "annual"},
            {"title": "Policy Distribution Records", "description": "Records showing policy communication to staff", "artifact_type": "record", "format_guidance": "Distribution acknowledgments", "frequency": "annual"},
        ]
    },
}

GENERIC_PATTERNS = {
    "policy": {
        "keywords": ["policy", "policies", "procedures", "standard", "guideline"],
        "evidence": [
            {"title": "Related Policy Document", "description": "Policy document governing this control area", "artifact_type": "policy", "format_guidance": "Approved policy with signatures", "frequency": "annual"},
            {"title": "Procedure Document", "description": "Operational procedures for this control", "artifact_type": "policy", "format_guidance": "Documented procedure", "frequency": "annual"},
        ]
    },
    "documentation": {
        "keywords": ["document", "documentation", "documented", "record", "maintain"],
        "evidence": [
            {"title": "Control Documentation", "description": "Documentation supporting this control requirement", "artifact_type": "record", "format_guidance": "Relevant documentation", "frequency": "annual"},
            {"title": "Process Documentation", "description": "Documented process for this control area", "artifact_type": "record", "format_guidance": "Process document", "frequency": "annual"},
        ]
    },
    "review": {
        "keywords": ["review", "assess", "evaluate", "audit", "verify", "validate"],
        "evidence": [
            {"title": "Review Report", "description": "Results of periodic review for this control", "artifact_type": "report", "format_guidance": "Review report with findings", "frequency": "quarterly"},
            {"title": "Assessment Records", "description": "Records of control assessments", "artifact_type": "record", "format_guidance": "Assessment documentation", "frequency": "quarterly"},
        ]
    },
    "testing": {
        "keywords": ["test", "testing", "verify", "validate", "confirm"],
        "evidence": [
            {"title": "Test Results", "description": "Results of testing for this control", "artifact_type": "report", "format_guidance": "Test report", "frequency": "quarterly"},
            {"title": "Testing Procedure", "description": "Procedure for testing this control", "artifact_type": "policy", "format_guidance": "Test procedure document", "frequency": "annual"},
        ]
    },
    "implementation": {
        "keywords": ["implement", "deploy", "install", "configure", "establish"],
        "evidence": [
            {"title": "Implementation Evidence", "description": "Evidence of control implementation", "artifact_type": "configuration", "format_guidance": "Configuration or deployment evidence", "frequency": "quarterly"},
            {"title": "Implementation Documentation", "description": "Documentation of implementation", "artifact_type": "record", "format_guidance": "Implementation records", "frequency": "annual"},
        ]
    }
}


def analyze_control_text(code: str, name: str, statement: str) -> list:
    """Analyze control text to determine matching evidence patterns."""
    text = f"{code} {name} {statement}".lower()
    matched_patterns = []
    
    # Check HIGH PRIORITY patterns first - these override generic matches
    for pattern_name, pattern_data in HIGH_PRIORITY_PATTERNS.items():
        for keyword in pattern_data["keywords"]:
            if keyword.lower() in text:
                matched_patterns.append(f"high_priority_{pattern_name}")
                break
    
    # If high priority patterns matched, return them (skip generic patterns)
    if matched_patterns:
        return matched_patterns
    
    # Check regular evidence patterns
    for pattern_name, pattern_data in EVIDENCE_PATTERNS.items():
        for keyword in pattern_data["keywords"]:
            if keyword.lower() in text:
                matched_patterns.append(pattern_name)
                break
    
    if not matched_patterns:
        for pattern_name, pattern_data in GENERIC_PATTERNS.items():
            for keyword in pattern_data["keywords"]:
                if keyword.lower() in text:
                    matched_patterns.append(f"generic_{pattern_name}")
                    break
    
    return matched_patterns


def generate_evidence_for_control(control: FrameworkControl) -> list:
    """Generate unique evidence items for a control based on its content."""
    code = control.code or ""
    name = control.name or ""
    statement = control.statement or ""
    
    matched_patterns = analyze_control_text(code, name, statement)
    
    evidence_items = []
    seen_titles = set()
    
    for pattern_name in matched_patterns:
        if pattern_name.startswith("high_priority_"):
            pattern_key = pattern_name.replace("high_priority_", "")
            pattern_data = HIGH_PRIORITY_PATTERNS.get(pattern_key, {})
        elif pattern_name.startswith("generic_"):
            pattern_key = pattern_name.replace("generic_", "")
            pattern_data = GENERIC_PATTERNS.get(pattern_key, {})
        else:
            pattern_data = EVIDENCE_PATTERNS.get(pattern_name, {})
        
        for ev in pattern_data.get("evidence", []):
            control_specific_title = f"{ev['title']} - {control.code}"
            if control_specific_title not in seen_titles and len(evidence_items) < 6:
                seen_titles.add(control_specific_title)
                evidence_items.append({
                    "title": ev["title"],
                    "description": f"{ev['description']} for control {control.code}: {control.name}",
                    "artifact_type": ev["artifact_type"],
                    "format_guidance": ev["format_guidance"],
                    "frequency": ev["frequency"],
                    "is_required": True
                })
    
    if len(evidence_items) < 3:
        additional_evidence = [
            {"title": f"{control.code} - Implementation Evidence", "description": f"Evidence demonstrating implementation of {control.name}", "artifact_type": "record", "format_guidance": "Configuration, screenshot, or documentation", "frequency": "quarterly", "is_required": True},
            {"title": f"{control.code} - Compliance Documentation", "description": f"Documentation showing compliance with {control.name}", "artifact_type": "record", "format_guidance": "Relevant compliance documentation", "frequency": "annual", "is_required": True},
            {"title": f"{control.code} - Review Records", "description": f"Records of periodic review for {control.name}", "artifact_type": "report", "format_guidance": "Review report or attestation", "frequency": "quarterly", "is_required": False},
        ]
        for ev in additional_evidence:
            if ev["title"] not in seen_titles and len(evidence_items) < 4:
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
        pattern_counts = {}
        for control in controls:
            evidence_items = generate_evidence_for_control(control)
            
            # Track pattern usage for verification
            matched_patterns = analyze_control_text(control.code or "", control.name or "", control.statement or "")
            for pattern in matched_patterns:
                pattern_counts[pattern] = pattern_counts.get(pattern, 0) + 1
            
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
        print(f"\nPattern matching summary ({len(pattern_counts)} unique patterns matched):")
        for pattern, count in sorted(pattern_counts.items(), key=lambda x: -x[1])[:25]:
            print(f"  - {pattern}: {count} controls")
        
    except Exception as e:
        db.rollback()
        print(f"Error seeding control evidence: {e}")
        raise
    finally:
        db.close()


if __name__ == "__main__":
    seed_control_evidence()
