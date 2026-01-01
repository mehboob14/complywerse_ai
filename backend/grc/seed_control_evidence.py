"""
Generates unique evidence requirements for each framework control based on control statements.
Uses keyword/pattern matching to create specific, actionable evidence items.
"""

from .models import SessionLocal, FrameworkControl, CuratedEvidenceItem

# HIGH PRIORITY PATTERNS - checked first to override generic matches
HIGH_PRIORITY_PATTERNS = {
    "supplier_services": {
        "keywords": ["supplier service", "supplier management", "third party service", "vendor service", "outsourcing", "service provider management", "supplier relationship", "supplier performance", "supplier risk"],
        "evidence": [
            {"title": "Supplier Performance Review Report", "description": "Periodic review of supplier service delivery against SLAs", "artifact_type": "report", "format_guidance": "Quarterly performance review with metrics", "frequency": "quarterly"},
            {"title": "Supplier SLA Compliance Records", "description": "Records showing supplier compliance with service level agreements", "artifact_type": "record", "format_guidance": "SLA tracking spreadsheet or dashboard export", "frequency": "monthly"},
            {"title": "Supplier Security Assessment Report", "description": "Security assessment or audit of supplier's controls", "artifact_type": "report", "format_guidance": "Third-party assessment or questionnaire results", "frequency": "annual"},
            {"title": "Supplier Change Request Records", "description": "Records of changes to supplier services and approvals", "artifact_type": "record", "format_guidance": "Change management records for supplier changes", "frequency": "quarterly"},
            {"title": "Supplier Risk Assessment", "description": "Risk assessment for critical suppliers", "artifact_type": "report", "format_guidance": "Completed risk assessment with risk ratings", "frequency": "annual"},
            {"title": "Supplier Contract with Security Clauses", "description": "Contract excerpts showing security and compliance requirements", "artifact_type": "record", "format_guidance": "Relevant contract sections", "frequency": "annual"},
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
}

EVIDENCE_PATTERNS = {
    "network_diagram": {
        "keywords": ["network diagram", "network topology", "cardholder data flow", "data flow diagram", "network documentation"],
        "evidence": [
            {"title": "Current Network Topology Diagram", "description": "Complete network architecture diagram showing all network segments, firewalls, routers, and connections", "artifact_type": "configuration", "format_guidance": "Visio, draw.io, or Lucidchart export with date stamp", "frequency": "quarterly"},
            {"title": "Cardholder Data Flow Diagram", "description": "Diagram showing all paths where cardholder data is transmitted, processed, or stored", "artifact_type": "configuration", "format_guidance": "PDF diagram with annotations for each data flow path", "frequency": "annual"},
            {"title": "Network Segmentation Diagram", "description": "Visual representation of network zones and segmentation boundaries", "artifact_type": "configuration", "format_guidance": "Architecture diagram with clear zone demarcations", "frequency": "quarterly"},
        ]
    },
    "firewall": {
        "keywords": ["firewall", "network security control", "traffic filtering", "stateful inspection", "packet filtering"],
        "evidence": [
            {"title": "Firewall Rule Export", "description": "Complete export of all firewall rules with justifications and approvals", "artifact_type": "configuration", "format_guidance": "CSV/text export from firewall management console", "frequency": "quarterly"},
            {"title": "Firewall Change Log", "description": "Log of all firewall rule changes with approval records", "artifact_type": "log", "format_guidance": "Change management system export", "frequency": "monthly"},
            {"title": "Firewall Rule Review Report", "description": "Documented review of firewall rules against security policy", "artifact_type": "report", "format_guidance": "PDF report with reviewer signature and date", "frequency": "semi-annual"},
            {"title": "Firewall Configuration Baseline", "description": "Documented baseline configuration standards for firewalls", "artifact_type": "policy", "format_guidance": "Configuration standard document", "frequency": "annual"},
        ]
    },
    "router_switch": {
        "keywords": ["router", "switch", "routing", "network device", "layer 3", "layer 2"],
        "evidence": [
            {"title": "Router Configuration Export", "description": "Running configuration from all routers in the environment", "artifact_type": "configuration", "format_guidance": "show running-config output", "frequency": "quarterly"},
            {"title": "Switch VLAN Configuration", "description": "VLAN configuration showing network segmentation", "artifact_type": "configuration", "format_guidance": "show vlan command output", "frequency": "quarterly"},
            {"title": "Routing Table Export", "description": "Current routing tables from core network devices", "artifact_type": "configuration", "format_guidance": "show ip route output", "frequency": "monthly"},
        ]
    },
    "password": {
        "keywords": ["password", "credential", "authentication strength", "password complexity", "password policy", "strong authentication"],
        "evidence": [
            {"title": "Password Policy Document", "description": "Formal password policy defining complexity, length, and rotation requirements", "artifact_type": "policy", "format_guidance": "PDF policy document with approval signatures", "frequency": "annual"},
            {"title": "Password Policy GPO Export", "description": "Active Directory Group Policy password settings export", "artifact_type": "configuration", "format_guidance": "GPO export or screenshot of password policy settings", "frequency": "quarterly"},
            {"title": "Password Compliance Report", "description": "Report showing password policy compliance across all systems", "artifact_type": "report", "format_guidance": "Compliance report from identity management system", "frequency": "monthly"},
            {"title": "Password Age Report", "description": "Report showing password ages and last change dates for all accounts", "artifact_type": "report", "format_guidance": "Export from identity management or AD", "frequency": "quarterly"},
        ]
    },
    "mfa": {
        "keywords": ["multi-factor", "mfa", "two-factor", "2fa", "additional authentication", "strong authentication factor"],
        "evidence": [
            {"title": "MFA Configuration Screenshot", "description": "Screenshot showing MFA configuration and enforcement settings", "artifact_type": "screenshot", "format_guidance": "Screenshot from identity provider/MFA system", "frequency": "quarterly"},
            {"title": "MFA Enrollment Report", "description": "Report showing MFA enrollment status for all required users", "artifact_type": "report", "format_guidance": "Export from MFA/identity provider", "frequency": "monthly"},
            {"title": "MFA Policy Document", "description": "Policy defining MFA requirements for different access scenarios", "artifact_type": "policy", "format_guidance": "Approved policy document", "frequency": "annual"},
            {"title": "MFA Exception List", "description": "Documented list of any MFA exceptions with business justification", "artifact_type": "record", "format_guidance": "Spreadsheet with approvals", "frequency": "quarterly"},
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
        "keywords": ["encryption at rest", "disk encryption", "database encryption", "tde", "storage encryption", "data at rest"],
        "evidence": [
            {"title": "Database TDE Configuration", "description": "Transparent Data Encryption configuration for databases", "artifact_type": "configuration", "format_guidance": "Database encryption status query output", "frequency": "quarterly"},
            {"title": "Disk Encryption Status Report", "description": "BitLocker or equivalent disk encryption status for all systems", "artifact_type": "report", "format_guidance": "Encryption management tool report", "frequency": "monthly"},
            {"title": "Encryption Key Management Procedure", "description": "Documented procedures for encryption key lifecycle management", "artifact_type": "policy", "format_guidance": "Procedure document with key custodian information", "frequency": "annual"},
            {"title": "Storage Encryption Audit", "description": "Audit report validating encryption for all data at rest locations", "artifact_type": "report", "format_guidance": "Internal audit report", "frequency": "annual"},
        ]
    },
    "key_management": {
        "keywords": ["key management", "cryptographic key", "key rotation", "key custodian", "key storage", "hsm"],
        "evidence": [
            {"title": "Key Management Policy", "description": "Policy defining cryptographic key lifecycle management", "artifact_type": "policy", "format_guidance": "Approved policy document", "frequency": "annual"},
            {"title": "Key Custodian Assignments", "description": "Documentation of key custodian roles and split knowledge", "artifact_type": "record", "format_guidance": "Role assignment document with signatures", "frequency": "annual"},
            {"title": "Key Rotation Log", "description": "Log of cryptographic key rotations performed", "artifact_type": "log", "format_guidance": "Key management system log", "frequency": "quarterly"},
            {"title": "HSM Configuration", "description": "Hardware Security Module configuration and access controls", "artifact_type": "configuration", "format_guidance": "HSM admin console export", "frequency": "quarterly"},
        ]
    },
    "access_control": {
        "keywords": ["access control", "authorization", "user access", "access rights", "permissions", "privilege", "least privilege"],
        "evidence": [
            {"title": "User Access Matrix", "description": "Matrix showing user roles and their associated access permissions", "artifact_type": "record", "format_guidance": "Spreadsheet with role-to-permission mapping", "frequency": "quarterly"},
            {"title": "Access Control Policy", "description": "Policy defining access control requirements and principles", "artifact_type": "policy", "format_guidance": "Approved policy document", "frequency": "annual"},
            {"title": "Quarterly Access Review Report", "description": "Results of periodic user access reviews with certifications", "artifact_type": "report", "format_guidance": "Access review tool export or signed attestations", "frequency": "quarterly"},
            {"title": "Privilege Assignment Log", "description": "Log of privileged access assignments and approvals", "artifact_type": "log", "format_guidance": "IAM system log export", "frequency": "monthly"},
        ]
    },
    "privileged_access": {
        "keywords": ["privileged access", "admin access", "administrative", "root access", "elevated", "pam", "privileged account"],
        "evidence": [
            {"title": "Privileged Account Inventory", "description": "Complete inventory of all privileged accounts across systems", "artifact_type": "record", "format_guidance": "PAM system export or spreadsheet", "frequency": "monthly"},
            {"title": "PAM Configuration Screenshot", "description": "Privileged Access Management system configuration", "artifact_type": "screenshot", "format_guidance": "Screenshots of PAM policy configurations", "frequency": "quarterly"},
            {"title": "Privileged Session Recording Log", "description": "Log of privileged session recordings and reviews", "artifact_type": "log", "format_guidance": "PAM system session log", "frequency": "monthly"},
            {"title": "Privileged Access Request Forms", "description": "Sample approved privileged access request forms", "artifact_type": "record", "format_guidance": "Completed request forms with approvals", "frequency": "quarterly"},
        ]
    },
    "user_provisioning": {
        "keywords": ["user provisioning", "onboarding", "account creation", "user registration", "new user", "identity lifecycle"],
        "evidence": [
            {"title": "User Provisioning Procedure", "description": "Documented procedure for new user account creation", "artifact_type": "policy", "format_guidance": "Procedure document with workflow steps", "frequency": "annual"},
            {"title": "Sample Access Request Forms", "description": "Sample completed new user access request forms", "artifact_type": "record", "format_guidance": "Completed forms with all required approvals", "frequency": "quarterly"},
            {"title": "User Account Creation Log", "description": "Log of new accounts created with authorization records", "artifact_type": "log", "format_guidance": "Identity management system log", "frequency": "monthly"},
            {"title": "New Hire Access Checklist", "description": "Checklist used for new employee access provisioning", "artifact_type": "record", "format_guidance": "Completed checklists with HR/manager sign-off", "frequency": "quarterly"},
        ]
    },
    "user_termination": {
        "keywords": ["termination", "deprovisioning", "offboarding", "revoke access", "account disable", "user removal"],
        "evidence": [
            {"title": "Termination Procedure", "description": "Procedure for revoking access upon employee termination", "artifact_type": "policy", "format_guidance": "Procedure document", "frequency": "annual"},
            {"title": "Terminated User Access Removal Log", "description": "Log showing timely access removal for terminated users", "artifact_type": "log", "format_guidance": "Identity management log with timestamps", "frequency": "monthly"},
            {"title": "Termination Checklist", "description": "Completed termination checklists with IT sign-off", "artifact_type": "record", "format_guidance": "Sample completed checklists", "frequency": "quarterly"},
            {"title": "Terminated User Audit Report", "description": "Audit of terminated users to ensure no lingering access", "artifact_type": "report", "format_guidance": "Audit report with findings", "frequency": "quarterly"},
        ]
    },
    "logging": {
        "keywords": ["logging", "log", "audit trail", "audit log", "event log", "security log", "system log"],
        "evidence": [
            {"title": "Logging Policy", "description": "Policy defining logging requirements and retention periods", "artifact_type": "policy", "format_guidance": "Approved policy document", "frequency": "annual"},
            {"title": "Log Configuration Export", "description": "System logging configuration showing events captured", "artifact_type": "configuration", "format_guidance": "Audit policy export or configuration file", "frequency": "quarterly"},
            {"title": "Log Sample", "description": "Sample logs demonstrating required events are captured", "artifact_type": "log", "format_guidance": "Log file sample with timestamps", "frequency": "monthly"},
            {"title": "Log Storage Configuration", "description": "Configuration showing log centralization and storage", "artifact_type": "configuration", "format_guidance": "SIEM or log management configuration", "frequency": "quarterly"},
        ]
    },
    "monitoring": {
        "keywords": ["monitoring", "siem", "security monitoring", "continuous monitoring", "surveillance", "detection"],
        "evidence": [
            {"title": "SIEM Dashboard Screenshot", "description": "Screenshot of SIEM dashboard showing active monitoring", "artifact_type": "screenshot", "format_guidance": "Screenshot with timestamp", "frequency": "monthly"},
            {"title": "Security Monitoring Procedure", "description": "Procedure for security event monitoring and response", "artifact_type": "policy", "format_guidance": "Procedure document", "frequency": "annual"},
            {"title": "Alert Configuration Export", "description": "Configuration of security alerts and thresholds", "artifact_type": "configuration", "format_guidance": "SIEM alert rule export", "frequency": "quarterly"},
            {"title": "Monitoring Coverage Report", "description": "Report showing systems covered by security monitoring", "artifact_type": "report", "format_guidance": "Inventory of monitored systems", "frequency": "quarterly"},
        ]
    },
    "log_retention": {
        "keywords": ["log retention", "retain logs", "log storage", "log archive", "audit trail retention"],
        "evidence": [
            {"title": "Log Retention Policy", "description": "Policy defining log retention periods by log type", "artifact_type": "policy", "format_guidance": "Approved policy document", "frequency": "annual"},
            {"title": "Log Retention Configuration", "description": "System configuration showing log retention settings", "artifact_type": "configuration", "format_guidance": "SIEM/log management retention settings", "frequency": "quarterly"},
            {"title": "Log Archive Verification", "description": "Evidence of log availability for required retention period", "artifact_type": "report", "format_guidance": "Sample historical log retrieval", "frequency": "annual"},
        ]
    },
    "vulnerability_scan": {
        "keywords": ["vulnerability scan", "vulnerability assessment", "security scan", "weakness identification", "vuln scan"],
        "evidence": [
            {"title": "Vulnerability Scan Report", "description": "Full vulnerability scan report with findings and severity ratings", "artifact_type": "report", "format_guidance": "Scanner tool export (Nessus, Qualys, etc.)", "frequency": "quarterly"},
            {"title": "Vulnerability Scanning Schedule", "description": "Documented schedule for vulnerability scanning", "artifact_type": "record", "format_guidance": "Scanning schedule document", "frequency": "annual"},
            {"title": "Scan Coverage Report", "description": "Report showing all systems included in vulnerability scanning", "artifact_type": "report", "format_guidance": "Asset inventory with scan coverage", "frequency": "quarterly"},
            {"title": "Vulnerability Trend Report", "description": "Trend analysis of vulnerabilities over time", "artifact_type": "report", "format_guidance": "Trend report with graphs", "frequency": "quarterly"},
        ]
    },
    "penetration_test": {
        "keywords": ["penetration test", "pentest", "ethical hacking", "security testing", "offensive security"],
        "evidence": [
            {"title": "Penetration Test Report", "description": "Full penetration test report from qualified assessor", "artifact_type": "report", "format_guidance": "PDF report with methodology, findings, and remediation", "frequency": "annual"},
            {"title": "Penetration Test Scope Document", "description": "Documented scope and rules of engagement for penetration test", "artifact_type": "record", "format_guidance": "Signed scope document", "frequency": "annual"},
            {"title": "Penetration Test Remediation Tracker", "description": "Tracking of penetration test finding remediation", "artifact_type": "record", "format_guidance": "Tracker with status and dates", "frequency": "quarterly"},
        ]
    },
    "patch_management": {
        "keywords": ["patch", "patching", "update", "security update", "hotfix", "software update"],
        "evidence": [
            {"title": "Patch Management Policy", "description": "Policy defining patching timelines and procedures", "artifact_type": "policy", "format_guidance": "Approved policy document", "frequency": "annual"},
            {"title": "Patch Compliance Report", "description": "Report showing patch compliance across all systems", "artifact_type": "report", "format_guidance": "Patch management tool report", "frequency": "monthly"},
            {"title": "Critical Patch Deployment Log", "description": "Log of critical patch deployments with dates", "artifact_type": "log", "format_guidance": "Patch management system log", "frequency": "monthly"},
            {"title": "Patch Testing Procedure", "description": "Procedure for testing patches before deployment", "artifact_type": "policy", "format_guidance": "Testing procedure document", "frequency": "annual"},
        ]
    },
    "antivirus": {
        "keywords": ["antivirus", "anti-virus", "anti-malware", "malware protection", "endpoint protection", "av"],
        "evidence": [
            {"title": "Antivirus Policy", "description": "Policy defining antivirus requirements and configuration", "artifact_type": "policy", "format_guidance": "Approved policy document", "frequency": "annual"},
            {"title": "AV Deployment Report", "description": "Report showing antivirus deployment across all endpoints", "artifact_type": "report", "format_guidance": "AV management console report", "frequency": "monthly"},
            {"title": "AV Definition Update Log", "description": "Log showing antivirus definition updates", "artifact_type": "log", "format_guidance": "AV management system log", "frequency": "weekly"},
            {"title": "AV Scan Results", "description": "Sample antivirus scan results and detection logs", "artifact_type": "log", "format_guidance": "AV console export", "frequency": "monthly"},
        ]
    },
    "change_management": {
        "keywords": ["change management", "change control", "change request", "cab", "change advisory", "change process"],
        "evidence": [
            {"title": "Change Management Policy", "description": "Policy defining change management process and requirements", "artifact_type": "policy", "format_guidance": "Approved policy document", "frequency": "annual"},
            {"title": "Sample Change Requests", "description": "Sample completed change requests with all approvals", "artifact_type": "record", "format_guidance": "Change tickets from ITSM system", "frequency": "quarterly"},
            {"title": "CAB Meeting Minutes", "description": "Change Advisory Board meeting minutes", "artifact_type": "record", "format_guidance": "Meeting minutes with attendees and decisions", "frequency": "monthly"},
            {"title": "Emergency Change Log", "description": "Log of emergency changes with post-hoc approvals", "artifact_type": "log", "format_guidance": "ITSM system export", "frequency": "quarterly"},
        ]
    },
    "configuration_management": {
        "keywords": ["configuration management", "baseline configuration", "hardening", "system configuration", "secure configuration"],
        "evidence": [
            {"title": "Configuration Baseline Standards", "description": "Documented secure configuration baselines for all system types", "artifact_type": "policy", "format_guidance": "CIS benchmark or equivalent standards document", "frequency": "annual"},
            {"title": "Configuration Compliance Scan", "description": "Scan results comparing systems against baselines", "artifact_type": "report", "format_guidance": "Configuration scanner report", "frequency": "quarterly"},
            {"title": "Hardening Checklist", "description": "Completed system hardening checklists", "artifact_type": "record", "format_guidance": "Signed checklists for sample systems", "frequency": "quarterly"},
            {"title": "Configuration Deviation Report", "description": "Report of configuration deviations with justifications", "artifact_type": "report", "format_guidance": "Exception report with approvals", "frequency": "quarterly"},
        ]
    },
    "backup": {
        "keywords": ["backup", "data backup", "backup copy", "data recovery", "backup procedure"],
        "evidence": [
            {"title": "Backup Policy", "description": "Policy defining backup requirements and schedules", "artifact_type": "policy", "format_guidance": "Approved policy document", "frequency": "annual"},
            {"title": "Backup Configuration", "description": "Backup system configuration and schedules", "artifact_type": "configuration", "format_guidance": "Backup software configuration export", "frequency": "quarterly"},
            {"title": "Backup Success Log", "description": "Log showing successful backup completions", "artifact_type": "log", "format_guidance": "Backup system log", "frequency": "monthly"},
            {"title": "Backup Failure Report", "description": "Report of backup failures and remediation actions", "artifact_type": "report", "format_guidance": "Failure analysis with resolution", "frequency": "monthly"},
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
    "incident_response": {
        "keywords": ["incident response", "incident management", "security incident", "incident handling", "ir plan"],
        "evidence": [
            {"title": "Incident Response Plan", "description": "Comprehensive incident response plan document", "artifact_type": "policy", "format_guidance": "IR plan with roles, procedures, and escalation paths", "frequency": "annual"},
            {"title": "IR Team Contact List", "description": "Current incident response team contact information", "artifact_type": "record", "format_guidance": "Contact list with escalation order", "frequency": "quarterly"},
            {"title": "Incident Response Playbooks", "description": "Playbooks for common incident types", "artifact_type": "policy", "format_guidance": "Runbook documents for each incident type", "frequency": "annual"},
            {"title": "Incident Log", "description": "Log of security incidents and responses", "artifact_type": "log", "format_guidance": "Incident tracking system export", "frequency": "quarterly"},
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
    "business_continuity": {
        "keywords": ["business continuity", "bcp", "continuity plan", "disaster recovery", "dr plan", "recovery time"],
        "evidence": [
            {"title": "Business Continuity Plan", "description": "Comprehensive BCP document", "artifact_type": "policy", "format_guidance": "BCP document with recovery procedures", "frequency": "annual"},
            {"title": "BCP Test Results", "description": "Results of business continuity plan testing", "artifact_type": "report", "format_guidance": "Test report with findings", "frequency": "annual"},
            {"title": "Recovery Time Objectives", "description": "Documented RTOs and RPOs for critical systems", "artifact_type": "record", "format_guidance": "RTO/RPO matrix", "frequency": "annual"},
            {"title": "DR Site Configuration", "description": "Disaster recovery site configuration and readiness", "artifact_type": "configuration", "format_guidance": "DR infrastructure documentation", "frequency": "quarterly"},
        ]
    },
    "physical_security": {
        "keywords": ["physical security", "physical access", "facility security", "building security", "premises"],
        "evidence": [
            {"title": "Physical Security Policy", "description": "Policy defining physical security requirements", "artifact_type": "policy", "format_guidance": "Approved policy document", "frequency": "annual"},
            {"title": "Physical Access Log", "description": "Log of physical access to secure areas", "artifact_type": "log", "format_guidance": "Access control system log", "frequency": "monthly"},
            {"title": "Physical Access List", "description": "List of personnel authorized for physical access", "artifact_type": "record", "format_guidance": "Current access list with approvals", "frequency": "quarterly"},
            {"title": "Physical Security Assessment", "description": "Assessment of physical security controls", "artifact_type": "report", "format_guidance": "Assessment report", "frequency": "annual"},
        ]
    },
    "visitor_management": {
        "keywords": ["visitor", "escort", "guest access", "visitor log", "visitor management"],
        "evidence": [
            {"title": "Visitor Policy", "description": "Policy for visitor management and escort requirements", "artifact_type": "policy", "format_guidance": "Approved policy document", "frequency": "annual"},
            {"title": "Visitor Log", "description": "Log of visitor entries with escort information", "artifact_type": "log", "format_guidance": "Visitor management system log", "frequency": "monthly"},
            {"title": "Visitor Badge Sample", "description": "Sample visitor badge showing identification", "artifact_type": "record", "format_guidance": "Photo or sample of visitor badge", "frequency": "one_time"},
        ]
    },
    "cctv": {
        "keywords": ["cctv", "surveillance", "camera", "video monitoring", "video surveillance"],
        "evidence": [
            {"title": "CCTV Coverage Map", "description": "Map showing camera locations and coverage areas", "artifact_type": "record", "format_guidance": "Facility diagram with camera placement", "frequency": "annual"},
            {"title": "CCTV Retention Configuration", "description": "Configuration showing video retention settings", "artifact_type": "configuration", "format_guidance": "CCTV system configuration", "frequency": "quarterly"},
            {"title": "CCTV Sample Footage", "description": "Sample footage demonstrating recording quality", "artifact_type": "record", "format_guidance": "Short video clip sample", "frequency": "quarterly"},
        ]
    },
    "asset_inventory": {
        "keywords": ["asset inventory", "hardware inventory", "asset register", "asset management", "it inventory"],
        "evidence": [
            {"title": "IT Asset Inventory", "description": "Complete inventory of IT assets with classification", "artifact_type": "record", "format_guidance": "CMDB export or asset spreadsheet", "frequency": "quarterly"},
            {"title": "Asset Management Policy", "description": "Policy for IT asset management", "artifact_type": "policy", "format_guidance": "Approved policy document", "frequency": "annual"},
            {"title": "Asset Discovery Scan Results", "description": "Results of automated asset discovery", "artifact_type": "report", "format_guidance": "Discovery tool output", "frequency": "monthly"},
        ]
    },
    "data_classification": {
        "keywords": ["data classification", "information classification", "data labeling", "sensitivity", "classification scheme"],
        "evidence": [
            {"title": "Data Classification Policy", "description": "Policy defining data classification levels and handling", "artifact_type": "policy", "format_guidance": "Approved policy document", "frequency": "annual"},
            {"title": "Data Classification Matrix", "description": "Matrix showing data types and their classifications", "artifact_type": "record", "format_guidance": "Classification matrix document", "frequency": "annual"},
            {"title": "Data Classification Training Records", "description": "Records of staff training on data classification", "artifact_type": "record", "format_guidance": "Training completion records", "frequency": "annual"},
        ]
    },
    "data_retention": {
        "keywords": ["data retention", "data disposal", "retention schedule", "data destruction", "retention period"],
        "evidence": [
            {"title": "Data Retention Policy", "description": "Policy defining data retention requirements", "artifact_type": "policy", "format_guidance": "Approved policy document", "frequency": "annual"},
            {"title": "Retention Schedule", "description": "Schedule showing retention periods by data type", "artifact_type": "record", "format_guidance": "Retention schedule document", "frequency": "annual"},
            {"title": "Data Destruction Certificate", "description": "Certificates for secure data destruction", "artifact_type": "certificate", "format_guidance": "Destruction certificates from vendor", "frequency": "as_needed"},
        ]
    },
    "dlp": {
        "keywords": ["data loss prevention", "dlp", "data leakage", "exfiltration prevention", "data protection"],
        "evidence": [
            {"title": "DLP Policy Configuration", "description": "Configuration of DLP policies and rules", "artifact_type": "configuration", "format_guidance": "DLP system policy export", "frequency": "quarterly"},
            {"title": "DLP Incident Report", "description": "Report of DLP incidents and responses", "artifact_type": "report", "format_guidance": "DLP system incident log", "frequency": "monthly"},
            {"title": "DLP Coverage Report", "description": "Report showing systems covered by DLP", "artifact_type": "report", "format_guidance": "DLP deployment status", "frequency": "quarterly"},
        ]
    },
    "vendor_management": {
        "keywords": ["vendor", "third party", "supplier", "service provider", "outsourcing", "vendor risk"],
        "evidence": [
            {"title": "Vendor Management Policy", "description": "Policy for managing third-party vendors", "artifact_type": "policy", "format_guidance": "Approved policy document", "frequency": "annual"},
            {"title": "Vendor Inventory", "description": "Inventory of vendors with risk classifications", "artifact_type": "record", "format_guidance": "Vendor registry spreadsheet", "frequency": "quarterly"},
            {"title": "Vendor Risk Assessment", "description": "Risk assessments for critical vendors", "artifact_type": "report", "format_guidance": "Completed vendor assessments", "frequency": "annual"},
            {"title": "Vendor Contracts with Security Terms", "description": "Sample contracts showing security requirements", "artifact_type": "record", "format_guidance": "Contract excerpts with security clauses", "frequency": "annual"},
        ]
    },
    "security_awareness": {
        "keywords": ["security awareness", "training", "user awareness", "security training", "employee training"],
        "evidence": [
            {"title": "Security Awareness Program", "description": "Documentation of security awareness program", "artifact_type": "policy", "format_guidance": "Program document with curriculum", "frequency": "annual"},
            {"title": "Training Completion Report", "description": "Report showing training completion rates", "artifact_type": "report", "format_guidance": "LMS training completion export", "frequency": "quarterly"},
            {"title": "Training Materials", "description": "Sample security awareness training materials", "artifact_type": "record", "format_guidance": "Training slides or module screenshots", "frequency": "annual"},
            {"title": "Phishing Test Results", "description": "Results of phishing simulation tests", "artifact_type": "report", "format_guidance": "Phishing campaign results", "frequency": "quarterly"},
        ]
    },
    "policy_review": {
        "keywords": ["policy review", "annual review", "policy update", "document review"],
        "evidence": [
            {"title": "Policy Review Schedule", "description": "Schedule for policy reviews", "artifact_type": "record", "format_guidance": "Review calendar", "frequency": "annual"},
            {"title": "Policy Version History", "description": "Version history showing policy updates", "artifact_type": "record", "format_guidance": "Document management system export", "frequency": "annual"},
            {"title": "Policy Approval Records", "description": "Records of policy approvals by management", "artifact_type": "record", "format_guidance": "Signed approval pages", "frequency": "annual"},
        ]
    },
    "risk_assessment": {
        "keywords": ["risk assessment", "risk analysis", "threat assessment", "risk identification", "risk evaluation"],
        "evidence": [
            {"title": "Risk Assessment Report", "description": "Completed risk assessment with findings", "artifact_type": "report", "format_guidance": "Risk assessment document", "frequency": "annual"},
            {"title": "Risk Register", "description": "Register of identified risks with ratings", "artifact_type": "record", "format_guidance": "Risk register spreadsheet", "frequency": "quarterly"},
            {"title": "Risk Assessment Methodology", "description": "Documented methodology for risk assessments", "artifact_type": "policy", "format_guidance": "Methodology document", "frequency": "annual"},
            {"title": "Risk Treatment Plan", "description": "Plan for addressing identified risks", "artifact_type": "record", "format_guidance": "Treatment plan with timelines", "frequency": "quarterly"},
        ]
    },
    "secure_coding": {
        "keywords": ["secure coding", "secure development", "code review", "application security", "sdlc", "software development"],
        "evidence": [
            {"title": "Secure Coding Standards", "description": "Standards for secure software development", "artifact_type": "policy", "format_guidance": "Coding standards document", "frequency": "annual"},
            {"title": "Code Review Records", "description": "Records of security code reviews", "artifact_type": "record", "format_guidance": "Code review tool export", "frequency": "quarterly"},
            {"title": "Static Analysis Results", "description": "Results of static code analysis scans", "artifact_type": "report", "format_guidance": "SAST tool output", "frequency": "quarterly"},
            {"title": "Developer Security Training", "description": "Records of developer security training", "artifact_type": "record", "format_guidance": "Training completion records", "frequency": "annual"},
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
    "wireless": {
        "keywords": ["wireless", "wifi", "wlan", "802.11", "wireless network"],
        "evidence": [
            {"title": "Wireless Security Policy", "description": "Policy for wireless network security", "artifact_type": "policy", "format_guidance": "Approved policy document", "frequency": "annual"},
            {"title": "Wireless Configuration Export", "description": "Wireless controller configuration", "artifact_type": "configuration", "format_guidance": "Wireless controller export", "frequency": "quarterly"},
            {"title": "Rogue AP Scan Results", "description": "Results of rogue access point scanning", "artifact_type": "report", "format_guidance": "WIPS or wireless scanner report", "frequency": "quarterly"},
            {"title": "Wireless Network Inventory", "description": "Inventory of authorized wireless networks", "artifact_type": "record", "format_guidance": "SSID inventory with settings", "frequency": "quarterly"},
        ]
    },
    "remote_access": {
        "keywords": ["remote access", "vpn", "remote connection", "telecommute", "remote work"],
        "evidence": [
            {"title": "Remote Access Policy", "description": "Policy for remote access to corporate resources", "artifact_type": "policy", "format_guidance": "Approved policy document", "frequency": "annual"},
            {"title": "VPN Configuration", "description": "VPN gateway configuration and settings", "artifact_type": "configuration", "format_guidance": "VPN system configuration export", "frequency": "quarterly"},
            {"title": "Remote Access User List", "description": "List of users with remote access privileges", "artifact_type": "record", "format_guidance": "VPN user list export", "frequency": "monthly"},
            {"title": "Remote Access Log", "description": "Log of remote access connections", "artifact_type": "log", "format_guidance": "VPN connection log", "frequency": "monthly"},
        ]
    },
    "ids_ips": {
        "keywords": ["intrusion detection", "ids", "ips", "intrusion prevention", "network intrusion"],
        "evidence": [
            {"title": "IDS/IPS Configuration", "description": "Configuration of intrusion detection/prevention systems", "artifact_type": "configuration", "format_guidance": "IDS/IPS policy export", "frequency": "quarterly"},
            {"title": "IDS Alert Log", "description": "Log of IDS/IPS alerts and responses", "artifact_type": "log", "format_guidance": "IDS system alert log", "frequency": "monthly"},
            {"title": "IDS Signature Update Log", "description": "Log of signature and rule updates", "artifact_type": "log", "format_guidance": "Update history from IDS console", "frequency": "monthly"},
            {"title": "IDS Coverage Report", "description": "Report showing network coverage of IDS sensors", "artifact_type": "report", "format_guidance": "Sensor deployment documentation", "frequency": "quarterly"},
        ]
    },
    "file_integrity": {
        "keywords": ["file integrity", "fim", "file monitoring", "integrity monitoring", "change detection"],
        "evidence": [
            {"title": "FIM Configuration", "description": "File integrity monitoring configuration", "artifact_type": "configuration", "format_guidance": "FIM tool configuration export", "frequency": "quarterly"},
            {"title": "FIM Alert Log", "description": "Log of file integrity alerts", "artifact_type": "log", "format_guidance": "FIM system alert log", "frequency": "monthly"},
            {"title": "Critical File Baseline", "description": "Baseline of critical system files monitored", "artifact_type": "record", "format_guidance": "List of monitored files/directories", "frequency": "quarterly"},
        ]
    },
    "time_sync": {
        "keywords": ["time synchronization", "ntp", "time server", "clock", "time source"],
        "evidence": [
            {"title": "NTP Configuration", "description": "Time synchronization configuration for systems", "artifact_type": "configuration", "format_guidance": "NTP server configuration", "frequency": "quarterly"},
            {"title": "Time Source Documentation", "description": "Documentation of authoritative time sources", "artifact_type": "record", "format_guidance": "Time architecture document", "frequency": "annual"},
            {"title": "Time Sync Status Report", "description": "Report showing time synchronization status", "artifact_type": "report", "format_guidance": "NTP monitoring tool output", "frequency": "quarterly"},
        ]
    },
    "service_account": {
        "keywords": ["service account", "system account", "application account", "non-human", "bot account"],
        "evidence": [
            {"title": "Service Account Inventory", "description": "Inventory of all service accounts with owners", "artifact_type": "record", "format_guidance": "Account inventory spreadsheet", "frequency": "quarterly"},
            {"title": "Service Account Policy", "description": "Policy for service account management", "artifact_type": "policy", "format_guidance": "Approved policy document", "frequency": "annual"},
            {"title": "Service Account Review", "description": "Periodic review of service accounts", "artifact_type": "report", "format_guidance": "Review report with attestations", "frequency": "quarterly"},
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
    "media_handling": {
        "keywords": ["media", "removable media", "usb", "portable storage", "media disposal"],
        "evidence": [
            {"title": "Removable Media Policy", "description": "Policy for removable media usage and handling", "artifact_type": "policy", "format_guidance": "Approved policy document", "frequency": "annual"},
            {"title": "USB Blocking Configuration", "description": "Configuration showing USB device controls", "artifact_type": "configuration", "format_guidance": "Endpoint protection USB policy", "frequency": "quarterly"},
            {"title": "Media Disposal Log", "description": "Log of secure media disposal", "artifact_type": "log", "format_guidance": "Destruction log with certificates", "frequency": "quarterly"},
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
        "keywords": ["secure disposal", "sanitization", "data destruction", "wiping", "degaussing"],
        "evidence": [
            {"title": "Data Disposal Policy", "description": "Policy for secure data and media disposal", "artifact_type": "policy", "format_guidance": "Approved policy document", "frequency": "annual"},
            {"title": "Disposal Procedure", "description": "Procedure for secure disposal of equipment", "artifact_type": "policy", "format_guidance": "Procedure document", "frequency": "annual"},
            {"title": "Disposal Certificates", "description": "Certificates of destruction from disposal vendor", "artifact_type": "certificate", "format_guidance": "Vendor destruction certificates", "frequency": "as_needed"},
            {"title": "Disposal Log", "description": "Log of disposed equipment and data", "artifact_type": "log", "format_guidance": "Disposal tracking log", "frequency": "quarterly"},
        ]
    },
    "pos_terminal": {
        "keywords": ["pos", "point of sale", "payment terminal", "card reader", "payment device"],
        "evidence": [
            {"title": "POS Terminal Inventory", "description": "Inventory of all POS terminals", "artifact_type": "record", "format_guidance": "Terminal inventory with locations", "frequency": "quarterly"},
            {"title": "POS Security Configuration", "description": "Security configuration for POS terminals", "artifact_type": "configuration", "format_guidance": "Terminal configuration documentation", "frequency": "quarterly"},
            {"title": "POS Inspection Log", "description": "Log of POS terminal physical inspections", "artifact_type": "log", "format_guidance": "Inspection checklist log", "frequency": "monthly"},
        ]
    },
    "web_application": {
        "keywords": ["web application", "web security", "application firewall", "waf", "web vulnerability"],
        "evidence": [
            {"title": "Web Application Security Policy", "description": "Policy for web application security", "artifact_type": "policy", "format_guidance": "Approved policy document", "frequency": "annual"},
            {"title": "WAF Configuration", "description": "Web Application Firewall configuration", "artifact_type": "configuration", "format_guidance": "WAF rule set export", "frequency": "quarterly"},
            {"title": "Web Application Scan Results", "description": "Dynamic application security test results", "artifact_type": "report", "format_guidance": "DAST tool report", "frequency": "quarterly"},
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
    "cloud_security": {
        "keywords": ["cloud", "cloud security", "iaas", "paas", "saas", "cloud provider"],
        "evidence": [
            {"title": "Cloud Security Policy", "description": "Policy for cloud service security", "artifact_type": "policy", "format_guidance": "Approved policy document", "frequency": "annual"},
            {"title": "Cloud Configuration Audit", "description": "Audit of cloud security configuration", "artifact_type": "report", "format_guidance": "Cloud security posture report", "frequency": "quarterly"},
            {"title": "Cloud Access Configuration", "description": "IAM and access configuration for cloud", "artifact_type": "configuration", "format_guidance": "Cloud IAM policy export", "frequency": "quarterly"},
        ]
    },
    "mobile_device": {
        "keywords": ["mobile device", "mdm", "byod", "mobile security", "smartphone", "tablet"],
        "evidence": [
            {"title": "Mobile Device Policy", "description": "Policy for mobile device security", "artifact_type": "policy", "format_guidance": "Approved policy document", "frequency": "annual"},
            {"title": "MDM Configuration", "description": "Mobile device management configuration", "artifact_type": "configuration", "format_guidance": "MDM policy export", "frequency": "quarterly"},
            {"title": "Mobile Device Inventory", "description": "Inventory of managed mobile devices", "artifact_type": "record", "format_guidance": "MDM device inventory", "frequency": "monthly"},
            {"title": "Mobile Device Compliance Report", "description": "Report of mobile device compliance status", "artifact_type": "report", "format_guidance": "MDM compliance dashboard", "frequency": "monthly"},
        ]
    },
    "email_security": {
        "keywords": ["email security", "email filtering", "spam", "phishing protection", "email gateway"],
        "evidence": [
            {"title": "Email Security Policy", "description": "Policy for email security", "artifact_type": "policy", "format_guidance": "Approved policy document", "frequency": "annual"},
            {"title": "Email Gateway Configuration", "description": "Email security gateway configuration", "artifact_type": "configuration", "format_guidance": "Email gateway policy export", "frequency": "quarterly"},
            {"title": "Email Security Report", "description": "Report of email threats blocked", "artifact_type": "report", "format_guidance": "Email security dashboard report", "frequency": "monthly"},
        ]
    },
    "dns_security": {
        "keywords": ["dns", "domain name", "dns security", "dnssec"],
        "evidence": [
            {"title": "DNS Configuration", "description": "DNS server security configuration", "artifact_type": "configuration", "format_guidance": "DNS server configuration", "frequency": "quarterly"},
            {"title": "DNS Security Settings", "description": "DNSSEC and security settings", "artifact_type": "configuration", "format_guidance": "DNS security configuration", "frequency": "quarterly"},
        ]
    },
    "default_credentials": {
        "keywords": ["default password", "default credential", "vendor default", "factory default"],
        "evidence": [
            {"title": "Default Password Change Procedure", "description": "Procedure for changing default passwords", "artifact_type": "policy", "format_guidance": "Procedure document", "frequency": "annual"},
            {"title": "Default Password Scan Results", "description": "Scan for systems with default credentials", "artifact_type": "report", "format_guidance": "Vulnerability scan for defaults", "frequency": "quarterly"},
            {"title": "System Deployment Checklist", "description": "Checklist ensuring defaults are changed", "artifact_type": "record", "format_guidance": "Completed deployment checklists", "frequency": "quarterly"},
        ]
    },
    "segregation_duties": {
        "keywords": ["segregation of duties", "separation of duties", "sod", "duty separation", "conflicting duties"],
        "evidence": [
            {"title": "Segregation of Duties Matrix", "description": "Matrix showing duty separation requirements", "artifact_type": "record", "format_guidance": "SoD matrix document", "frequency": "annual"},
            {"title": "SoD Policy", "description": "Policy for segregation of duties", "artifact_type": "policy", "format_guidance": "Approved policy document", "frequency": "annual"},
            {"title": "SoD Conflict Report", "description": "Report of SoD conflicts and resolutions", "artifact_type": "report", "format_guidance": "SoD analysis report", "frequency": "quarterly"},
        ]
    },
    "sla": {
        "keywords": ["service level", "sla", "service agreement", "performance metrics"],
        "evidence": [
            {"title": "Service Level Agreements", "description": "SLAs with service providers", "artifact_type": "record", "format_guidance": "SLA documentation", "frequency": "annual"},
            {"title": "SLA Performance Report", "description": "Report of SLA performance metrics", "artifact_type": "report", "format_guidance": "Performance dashboard", "frequency": "monthly"},
        ]
    },
    "compliance_monitoring": {
        "keywords": ["compliance monitoring", "compliance review", "regulatory compliance", "compliance audit"],
        "evidence": [
            {"title": "Compliance Monitoring Program", "description": "Program for ongoing compliance monitoring", "artifact_type": "policy", "format_guidance": "Program documentation", "frequency": "annual"},
            {"title": "Compliance Status Report", "description": "Current compliance status report", "artifact_type": "report", "format_guidance": "Compliance dashboard", "frequency": "quarterly"},
            {"title": "Compliance Review Records", "description": "Records of compliance reviews", "artifact_type": "record", "format_guidance": "Review documentation", "frequency": "quarterly"},
        ]
    }
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
        for control in controls:
            evidence_items = generate_evidence_for_control(control)
            
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
        
    except Exception as e:
        db.rollback()
        print(f"Error seeding control evidence: {e}")
        raise
    finally:
        db.close()


if __name__ == "__main__":
    seed_control_evidence()
