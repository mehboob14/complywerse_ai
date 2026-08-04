"""
Curated evidence items for all framework sub-controls.
Provides specific, actionable evidence requirements with meaningful titles and descriptions.
"""

from .models import SessionLocal, Framework, FrameworkDomain, ControlObjective, FrameworkControl, FrameworkSubControl, CuratedEvidenceItem

CURATED_EVIDENCE_DATA = {
    "PCI_DSS": {
        "network": {
            "Document network security requirements": [
                {"title": "Network Security Policy", "description": "Formal policy document defining network security requirements, firewall rules, and segmentation principles for the cardholder data environment", "artifact_type": "policy", "format_guidance": "PDF document with version control, approval signatures, and annual review dates", "frequency": "annual", "is_required": True},
                {"title": "Network Architecture Diagram", "description": "Current network topology diagram showing all connections to and from the CDE, including firewalls, routers, and segmentation points", "artifact_type": "configuration", "format_guidance": "Visio or draw.io export with date stamp and version number", "frequency": "quarterly", "is_required": True},
                {"title": "CDE Data Flow Diagram", "description": "Diagram showing how cardholder data flows through the network including all storage, processing, and transmission points", "artifact_type": "configuration", "format_guidance": "PDF or image with annotations explaining each data flow path", "frequency": "annual", "is_required": True},
            ],
            "Implement network segmentation controls": [
                {"title": "Firewall Rule Export - Perimeter", "description": "Complete export of all firewall rules from perimeter firewalls showing inbound and outbound traffic controls", "artifact_type": "configuration", "format_guidance": "CSV or text export from firewall management console (Palo Alto, Fortinet, Cisco ASA)", "frequency": "quarterly", "is_required": True},
                {"title": "Firewall Rule Export - Internal Segmentation", "description": "Export of internal firewall rules showing CDE segmentation from corporate network", "artifact_type": "configuration", "format_guidance": "CSV export from internal firewalls with rule descriptions and justifications", "frequency": "quarterly", "is_required": True},
                {"title": "VLAN Configuration Export", "description": "Switch VLAN configuration showing network segmentation implementation", "artifact_type": "configuration", "format_guidance": "show vlan or equivalent command output from core switches", "frequency": "quarterly", "is_required": True},
                {"title": "Segmentation Test Results", "description": "Penetration test results validating that segmentation controls are effective", "artifact_type": "report", "format_guidance": "PDF report from qualified security assessor showing test methodology and results", "frequency": "annual", "is_required": True},
            ],
            "Monitor network security events": [
                {"title": "SIEM Dashboard Screenshot - Network Alerts", "description": "Screenshot of SIEM dashboard showing network security monitoring configuration and recent alerts", "artifact_type": "screenshot", "format_guidance": "Screenshot with timestamp showing active monitoring dashboards and alert rules", "frequency": "monthly", "is_required": True},
                {"title": "Network IDS/IPS Alert Log Sample", "description": "Sample of intrusion detection/prevention alerts showing the system is actively monitoring", "artifact_type": "log", "format_guidance": "Export from IDS/IPS system showing recent 30 days of alerts", "frequency": "monthly", "is_required": True},
                {"title": "Firewall Log Sample", "description": "Sample firewall logs showing denied connections and security events", "artifact_type": "log", "format_guidance": "Log export showing blocked traffic and rule hits for CDE-related rules", "frequency": "monthly", "is_required": True},
            ],
            "Review network security configurations": [
                {"title": "Quarterly Network Configuration Review Report", "description": "Documented review of network security configurations against baseline standards", "artifact_type": "report", "format_guidance": "PDF report with reviewer name, date, findings, and remediation actions", "frequency": "quarterly", "is_required": True},
                {"title": "Firewall Rule Change Log", "description": "Log of all firewall rule changes with approvals and justifications", "artifact_type": "log", "format_guidance": "Change management system export or spreadsheet tracking all rule changes", "frequency": "monthly", "is_required": True},
            ],
        },
        "access": {
            "Define access control policies": [
                {"title": "Logical Access Control Policy", "description": "Formal policy document defining user access requirements, least privilege principles, role-based access, and authorization procedures", "artifact_type": "policy", "format_guidance": "PDF document with version control, approval signatures, and reference to PCI DSS requirements", "frequency": "annual", "is_required": True},
                {"title": "Access Request Form Template", "description": "Standardized form template for requesting access with approval workflow and manager sign-off", "artifact_type": "record", "format_guidance": "Blank form template showing required fields: user, access requested, business justification, approvals", "frequency": "one_time", "is_required": True},
                {"title": "Role Definition Matrix", "description": "Matrix defining all system roles, their permissions, and which job functions can be assigned each role", "artifact_type": "record", "format_guidance": "Spreadsheet or PDF showing role names, permissions, and authorized job titles", "frequency": "annual", "is_required": True},
            ],
            "Implement user provisioning procedures": [
                {"title": "User Provisioning Procedure", "description": "Documented procedure for creating, modifying, and removing user accounts", "artifact_type": "policy", "format_guidance": "Step-by-step procedure document with approval requirements and SLA timelines", "frequency": "annual", "is_required": True},
                {"title": "Sample Access Request with Approvals", "description": "Completed access request form showing proper approval workflow was followed", "artifact_type": "record", "format_guidance": "Completed form with all signatures/approvals and date stamps", "frequency": "quarterly", "is_required": True},
                {"title": "User Termination Checklist", "description": "Checklist used for terminated employees ensuring all access is revoked", "artifact_type": "record", "format_guidance": "Completed termination checklist with all system access revocations checked", "frequency": "quarterly", "is_required": True},
            ],
            "Enforce authentication requirements": [
                {"title": "Password Policy GPO Export", "description": "Active Directory Group Policy Object export showing password complexity, length, history, and expiration settings", "artifact_type": "configuration", "format_guidance": "GPO export from Group Policy Management Console showing all password-related settings", "frequency": "quarterly", "is_required": True},
                {"title": "MFA Enrollment Report", "description": "Report showing all users with access to CDE are enrolled in multi-factor authentication", "artifact_type": "report", "format_guidance": "Export from MFA provider (Duo, Azure MFA, RSA) showing enrollment status for all CDE users", "frequency": "monthly", "is_required": True},
                {"title": "Authentication Failure Log Sample", "description": "Sample SIEM or system export showing failed login attempts and account lockout events", "artifact_type": "log", "format_guidance": "Log export showing failed authentication events, lockouts, and source IPs", "frequency": "monthly", "is_required": True},
                {"title": "Service Account Inventory", "description": "Inventory of all service accounts with access to CDE systems including password rotation dates", "artifact_type": "record", "format_guidance": "Spreadsheet listing service account name, purpose, owner, last password change", "frequency": "quarterly", "is_required": True},
            ],
            "Conduct periodic access reviews": [
                {"title": "Quarterly User Access Review Report", "description": "Documented review of all user access to CDE systems with manager attestation", "artifact_type": "report", "format_guidance": "PDF report or spreadsheet with user list, access rights, and manager sign-off for each user", "frequency": "quarterly", "is_required": True},
                {"title": "Privileged Access Review", "description": "Specific review of all users with administrative or elevated privileges to CDE systems", "artifact_type": "report", "format_guidance": "Spreadsheet listing all privileged accounts with justification and manager approval", "frequency": "quarterly", "is_required": True},
                {"title": "Terminated User Access Audit", "description": "Audit comparing terminated employees list against active user accounts", "artifact_type": "report", "format_guidance": "Report showing comparison of HR termination list against active accounts with any discrepancies noted", "frequency": "monthly", "is_required": True},
            ],
        },
        "encryption": {
            "Document encryption requirements": [
                {"title": "Data Encryption Policy", "description": "Policy defining encryption requirements for cardholder data at rest and in transit, including approved algorithms and key lengths", "artifact_type": "policy", "format_guidance": "PDF policy document referencing PCI DSS encryption requirements (AES-256, TLS 1.2+)", "frequency": "annual", "is_required": True},
                {"title": "Cryptographic Key Management Policy", "description": "Policy defining key generation, distribution, storage, rotation, and destruction procedures", "artifact_type": "policy", "format_guidance": "PDF document covering full key lifecycle management procedures", "frequency": "annual", "is_required": True},
            ],
            "Implement data encryption at rest": [
                {"title": "Database TDE Configuration Export", "description": "Transparent Data Encryption configuration from database showing encryption algorithm and certificate details", "artifact_type": "configuration", "format_guidance": "SQL query output or database console screenshot showing TDE status and encryption algorithm", "frequency": "quarterly", "is_required": True},
                {"title": "Disk Encryption Status Report", "description": "BitLocker, LUKS, or equivalent disk encryption status for all servers storing cardholder data", "artifact_type": "report", "format_guidance": "Report from disk encryption management tool or PowerShell output showing encryption status", "frequency": "quarterly", "is_required": True},
                {"title": "Encrypted Storage Volume Inventory", "description": "Inventory of all storage volumes containing cardholder data with encryption status", "artifact_type": "record", "format_guidance": "Spreadsheet listing server, volume, encryption type, key custodian", "frequency": "quarterly", "is_required": True},
            ],
            "Implement data encryption in transit": [
                {"title": "TLS Certificate Inventory", "description": "Inventory of all TLS certificates used to protect cardholder data in transit", "artifact_type": "record", "format_guidance": "Spreadsheet with certificate CN, issuer, expiration date, key length, and TLS versions supported", "frequency": "quarterly", "is_required": True},
                {"title": "SSL/TLS Configuration Scan Results", "description": "Results from SSL Labs or equivalent scan showing TLS configuration strength", "artifact_type": "report", "format_guidance": "PDF or screenshot of SSL scan results showing A or A+ rating", "frequency": "quarterly", "is_required": True},
                {"title": "Web Server TLS Configuration Export", "description": "Configuration export showing TLS settings (protocols, ciphers) from web servers handling cardholder data", "artifact_type": "configuration", "format_guidance": "nginx.conf, Apache ssl.conf, or IIS binding export showing TLS configuration", "frequency": "quarterly", "is_required": True},
            ],
            "Manage cryptographic keys": [
                {"title": "Key Custodian Acknowledgment Forms", "description": "Signed acknowledgment forms from key custodians confirming their responsibilities", "artifact_type": "record", "format_guidance": "Signed PDF forms from each key custodian acknowledging their role and responsibilities", "frequency": "annual", "is_required": True},
                {"title": "Key Rotation Log", "description": "Log of cryptographic key rotation events showing old key destruction and new key generation", "artifact_type": "log", "format_guidance": "Log or spreadsheet showing key identifier, rotation date, authorized personnel involved", "frequency": "annual", "is_required": True},
                {"title": "HSM Configuration Report", "description": "Hardware Security Module configuration showing key storage and access controls", "artifact_type": "configuration", "format_guidance": "HSM management console export or audit report showing key inventory and access logs", "frequency": "quarterly", "is_required": True},
            ],
        },
        "vulnerability": {
            "Define vulnerability management procedures": [
                {"title": "Vulnerability Management Policy", "description": "Policy defining vulnerability scanning requirements, remediation SLAs, and escalation procedures", "artifact_type": "policy", "format_guidance": "PDF policy with SLA definitions (critical: 24hrs, high: 7 days, medium: 30 days, low: 90 days)", "frequency": "annual", "is_required": True},
                {"title": "Vulnerability Remediation Procedure", "description": "Step-by-step procedure for tracking and remediating identified vulnerabilities", "artifact_type": "policy", "format_guidance": "Procedure document with workflow from identification through verification of fix", "frequency": "annual", "is_required": True},
            ],
            "Perform vulnerability scans": [
                {"title": "Internal Vulnerability Scan Report", "description": "Quarterly internal vulnerability scan results covering all in-scope systems", "artifact_type": "report", "format_guidance": "PDF report from vulnerability scanner (Nessus, Qualys, Rapid7) with executive summary and findings", "frequency": "quarterly", "is_required": True},
                {"title": "ASV Scan Attestation", "description": "Passing Approved Scanning Vendor (ASV) scan attestation for external-facing systems", "artifact_type": "certificate", "format_guidance": "Official ASV scan report with passing attestation from PCI SSC approved vendor", "frequency": "quarterly", "is_required": True},
                {"title": "Scan Coverage Report", "description": "Report confirming all in-scope systems were included in vulnerability scans", "artifact_type": "report", "format_guidance": "Report listing all scanned IP addresses/hosts matched against in-scope system inventory", "frequency": "quarterly", "is_required": True},
            ],
            "Remediate identified vulnerabilities": [
                {"title": "Vulnerability Remediation Tracker", "description": "Spreadsheet or system tracking vulnerability findings, severity, owners, and remediation status", "artifact_type": "record", "format_guidance": "Excel or ticket system export showing all open/closed vulnerabilities with remediation dates", "frequency": "monthly", "is_required": True},
                {"title": "Critical Vulnerability Remediation Evidence", "description": "Evidence showing critical and high vulnerabilities were remediated within SLA", "artifact_type": "report", "format_guidance": "Before/after scan comparison or patch installation confirmation for critical findings", "frequency": "quarterly", "is_required": True},
                {"title": "False Positive Documentation", "description": "Documentation for any vulnerabilities marked as false positives with technical justification", "artifact_type": "record", "format_guidance": "Document explaining why each false positive is not a real vulnerability with technical evidence", "frequency": "quarterly", "is_required": False},
            ],
            "Conduct penetration testing": [
                {"title": "Annual Penetration Test Report", "description": "External penetration test report from qualified security assessor testing network and application layers", "artifact_type": "report", "format_guidance": "PDF report including methodology, tools used, findings, and recommendations from QSA or qualified pentester", "frequency": "annual", "is_required": True},
                {"title": "Penetration Test Remediation Tracker", "description": "Tracking document showing status of penetration test finding remediation", "artifact_type": "record", "format_guidance": "Spreadsheet tracking each finding, severity, owner, status, and verification date", "frequency": "annual", "is_required": True},
                {"title": "Segmentation Validation Test Results", "description": "Penetration test specifically validating CDE segmentation controls", "artifact_type": "report", "format_guidance": "Test report confirming segmentation controls prevent access from out-of-scope networks", "frequency": "annual", "is_required": True},
            ],
        },
        "monitoring": {
            "Define logging requirements": [
                {"title": "Logging and Monitoring Policy", "description": "Policy defining what events must be logged, log retention periods, and monitoring requirements", "artifact_type": "policy", "format_guidance": "PDF policy document specifying log sources, retention (1 year), and review requirements", "frequency": "annual", "is_required": True},
                {"title": "Audit Log Requirements Matrix", "description": "Matrix defining required log events by system type aligned with PCI DSS requirements", "artifact_type": "record", "format_guidance": "Spreadsheet mapping PCI DSS log requirements to specific system log configurations", "frequency": "annual", "is_required": True},
            ],
            "Implement audit logging": [
                {"title": "SIEM Configuration Export", "description": "Configuration showing SIEM is collecting logs from all in-scope systems", "artifact_type": "configuration", "format_guidance": "Export from SIEM showing configured log sources and data collection status", "frequency": "quarterly", "is_required": True},
                {"title": "System Audit Configuration - Windows", "description": "Windows audit policy configuration showing required events are being logged", "artifact_type": "configuration", "format_guidance": "auditpol /get /category:* output or GPO export showing audit configuration", "frequency": "quarterly", "is_required": True},
                {"title": "System Audit Configuration - Linux", "description": "Linux auditd configuration showing required events are being logged", "artifact_type": "configuration", "format_guidance": "auditd.conf and audit.rules file export showing configured audit rules", "frequency": "quarterly", "is_required": True},
                {"title": "Database Audit Trail Configuration", "description": "Database audit configuration showing access to cardholder data is being logged", "artifact_type": "configuration", "format_guidance": "Database audit configuration export showing monitored objects and events", "frequency": "quarterly", "is_required": True},
            ],
            "Protect log integrity": [
                {"title": "Log Storage Access Controls", "description": "Evidence showing log storage is protected from unauthorized modification", "artifact_type": "configuration", "format_guidance": "ACL or permission configuration from log servers/SIEM showing restricted access", "frequency": "quarterly", "is_required": True},
                {"title": "Log Backup and Retention Report", "description": "Evidence that logs are backed up and retained for required period (1 year minimum)", "artifact_type": "report", "format_guidance": "Report showing log archive locations, retention dates, and oldest available logs", "frequency": "quarterly", "is_required": True},
                {"title": "NTP Configuration", "description": "Time synchronization configuration ensuring accurate timestamps across all systems", "artifact_type": "configuration", "format_guidance": "NTP configuration showing synchronization to authoritative time source", "frequency": "quarterly", "is_required": True},
            ],
            "Review security events": [
                {"title": "Daily Log Review Procedure", "description": "Documented procedure for daily security log review activities", "artifact_type": "policy", "format_guidance": "Procedure document defining what to review, escalation criteria, and documentation requirements", "frequency": "annual", "is_required": True},
                {"title": "Daily Log Review Checklist Samples", "description": "Completed daily log review checklists showing consistent review process", "artifact_type": "record", "format_guidance": "Sample completed checklists from random dates showing reviewer, date, findings", "frequency": "monthly", "is_required": True},
                {"title": "Security Alert Response Documentation", "description": "Documentation of security alerts received and response actions taken", "artifact_type": "log", "format_guidance": "Ticket system export or log showing alerts, investigation, and resolution", "frequency": "monthly", "is_required": True},
            ],
        },
        "policy": {
            "Develop security policies": [
                {"title": "Information Security Policy", "description": "Comprehensive information security policy addressing all PCI DSS requirements", "artifact_type": "policy", "format_guidance": "PDF policy document with executive approval, version control, and annual review date", "frequency": "annual", "is_required": True},
                {"title": "Acceptable Use Policy", "description": "Policy defining acceptable use of technology resources and cardholder data", "artifact_type": "policy", "format_guidance": "PDF policy document that users acknowledge during onboarding", "frequency": "annual", "is_required": True},
                {"title": "Policy Exception Request Process", "description": "Documented process for requesting exceptions to security policies", "artifact_type": "policy", "format_guidance": "Procedure document with exception request form, approval workflow, and tracking", "frequency": "annual", "is_required": True},
            ],
            "Communicate policies to personnel": [
                {"title": "Security Awareness Training Records", "description": "Records showing all personnel have completed annual security awareness training", "artifact_type": "record", "format_guidance": "LMS export or spreadsheet showing employee name, training completed, date, score", "frequency": "annual", "is_required": True},
                {"title": "Policy Acknowledgment Records", "description": "Signed acknowledgments from employees confirming they have read and understand security policies", "artifact_type": "record", "format_guidance": "Signed acknowledgment forms or electronic signature records from all employees", "frequency": "annual", "is_required": True},
                {"title": "New Hire Security Training Completion", "description": "Evidence that new hires complete security training before accessing cardholder data", "artifact_type": "record", "format_guidance": "Training completion records for recent hires with dates before system access was granted", "frequency": "quarterly", "is_required": True},
            ],
            "Review and update policies": [
                {"title": "Annual Policy Review Documentation", "description": "Documentation showing annual review of all security policies was completed", "artifact_type": "record", "format_guidance": "Meeting minutes or checklist showing each policy was reviewed with any changes noted", "frequency": "annual", "is_required": True},
                {"title": "Policy Version History", "description": "Version history showing policy updates and changes over time", "artifact_type": "record", "format_guidance": "Document control log or policy header showing version numbers and revision dates", "frequency": "annual", "is_required": True},
            ],
        },
        "incident": {
            "Define incident response procedures": [
                {"title": "Incident Response Plan", "description": "Formal incident response plan covering detection, containment, eradication, recovery, and lessons learned", "artifact_type": "policy", "format_guidance": "PDF document with roles, responsibilities, escalation procedures, and contact information", "frequency": "annual", "is_required": True},
                {"title": "Incident Classification Matrix", "description": "Matrix defining incident severity levels and corresponding response procedures", "artifact_type": "record", "format_guidance": "Table showing severity levels, criteria, response times, and escalation requirements", "frequency": "annual", "is_required": True},
                {"title": "Incident Response Contact List", "description": "Current contact list for incident response team members and external parties", "artifact_type": "record", "format_guidance": "Contact list with names, roles, phone numbers, and email addresses", "frequency": "quarterly", "is_required": True},
            ],
            "Train incident response team": [
                {"title": "IR Team Training Records", "description": "Training completion records for incident response team members", "artifact_type": "record", "format_guidance": "Training certificates or completion records for IR-specific training", "frequency": "annual", "is_required": True},
                {"title": "IR Team Roles and Responsibilities", "description": "Document defining roles and responsibilities for each IR team member", "artifact_type": "record", "format_guidance": "RACI matrix or role document for incident response team", "frequency": "annual", "is_required": True},
            ],
            "Test incident response capabilities": [
                {"title": "Annual IR Tabletop Exercise Report", "description": "Report from annual incident response tabletop exercise", "artifact_type": "report", "format_guidance": "PDF report showing exercise scenario, participants, decisions made, and lessons learned", "frequency": "annual", "is_required": True},
                {"title": "IR Test Action Items", "description": "Tracking document for action items identified during IR testing", "artifact_type": "record", "format_guidance": "Spreadsheet tracking improvements identified, owners, and completion status", "frequency": "annual", "is_required": True},
                {"title": "Previous Incident Post-Mortem Reports", "description": "Post-incident reports from actual security incidents (if applicable)", "artifact_type": "report", "format_guidance": "Report documenting incident timeline, root cause, and corrective actions", "frequency": "as_needed", "is_required": False},
            ],
        },
        "antimalware": {
            "Deploy anti-malware solution": [
                {"title": "Endpoint Protection Deployment Report", "description": "Report showing anti-malware is deployed on all in-scope systems", "artifact_type": "report", "format_guidance": "Export from EPP/EDR console showing all protected endpoints and deployment status", "frequency": "quarterly", "is_required": True},
                {"title": "Anti-Malware Configuration Standards", "description": "Documented configuration standards for anti-malware software", "artifact_type": "configuration", "format_guidance": "Configuration policy from EPP console showing scan schedules, exclusions, and protection settings", "frequency": "annual", "is_required": True},
                {"title": "Systems Without Anti-Malware Justification", "description": "Documentation for any systems where anti-malware cannot be installed with compensating controls", "artifact_type": "record", "format_guidance": "Exception document with business justification and alternative controls implemented", "frequency": "annual", "is_required": False},
            ],
            "Maintain anti-malware updates": [
                {"title": "Anti-Malware Definition Update Status", "description": "Report showing anti-malware definitions are current across all endpoints", "artifact_type": "report", "format_guidance": "EPP console export showing last update date for each endpoint (should be within 24 hours)", "frequency": "monthly", "is_required": True},
                {"title": "Anti-Malware Version Report", "description": "Report showing anti-malware software version deployed across endpoints", "artifact_type": "report", "format_guidance": "Export showing software versions to confirm no outdated agents", "frequency": "quarterly", "is_required": True},
            ],
            "Monitor anti-malware alerts": [
                {"title": "Malware Detection Log", "description": "Log of malware detections and response actions taken", "artifact_type": "log", "format_guidance": "Export from EPP console showing detections, affected systems, and remediation status", "frequency": "monthly", "is_required": True},
                {"title": "Anti-Malware Alert Review Procedure", "description": "Procedure for reviewing and responding to anti-malware alerts", "artifact_type": "policy", "format_guidance": "Procedure document defining alert triage, investigation, and escalation steps", "frequency": "annual", "is_required": True},
            ],
        },
    },
    "ISO_27001": {
        "governance": {
            "Establish information security governance": [
                {"title": "Information Security Management System (ISMS) Policy", "description": "Top-level policy establishing the ISMS scope, objectives, and management commitment", "artifact_type": "policy", "format_guidance": "PDF policy document signed by senior management with scope statement", "frequency": "annual", "is_required": True},
                {"title": "Information Security Steering Committee Charter", "description": "Charter defining the security governance committee structure, membership, and responsibilities", "artifact_type": "policy", "format_guidance": "Document defining committee purpose, membership, meeting frequency, and decision authority", "frequency": "annual", "is_required": True},
                {"title": "ISMS Scope Statement", "description": "Document defining the boundaries and applicability of the ISMS", "artifact_type": "record", "format_guidance": "Scope document listing included locations, systems, processes, and organizational units", "frequency": "annual", "is_required": True},
            ],
            "Assign security responsibilities": [
                {"title": "Information Security Roles and Responsibilities Matrix", "description": "RACI matrix defining security responsibilities across the organization", "artifact_type": "record", "format_guidance": "Spreadsheet or document showing roles, responsibilities, and accountabilities", "frequency": "annual", "is_required": True},
                {"title": "CISO/Security Manager Job Description", "description": "Formal job description for the information security leadership role", "artifact_type": "record", "format_guidance": "HR-approved job description with security-specific duties and qualifications", "frequency": "annual", "is_required": True},
                {"title": "Security Responsibility Acknowledgments", "description": "Signed acknowledgments from key personnel accepting their security responsibilities", "artifact_type": "record", "format_guidance": "Signed forms from asset owners, process owners, and security team members", "frequency": "annual", "is_required": True},
            ],
            "Conduct management reviews": [
                {"title": "Management Review Meeting Minutes", "description": "Minutes from periodic management review of ISMS effectiveness", "artifact_type": "record", "format_guidance": "Meeting minutes with attendees, agenda items, decisions, and action items", "frequency": "quarterly", "is_required": True},
                {"title": "ISMS Performance Dashboard", "description": "Dashboard or report showing key security metrics for management review", "artifact_type": "report", "format_guidance": "Report with KPIs including incidents, compliance status, audit findings, training completion", "frequency": "quarterly", "is_required": True},
                {"title": "Continual Improvement Log", "description": "Log tracking ISMS improvements identified and implemented", "artifact_type": "record", "format_guidance": "Spreadsheet tracking improvement opportunities, actions taken, and effectiveness", "frequency": "quarterly", "is_required": True},
            ],
        },
        "risk": {
            "Establish risk assessment methodology": [
                {"title": "Information Security Risk Assessment Methodology", "description": "Document defining the risk assessment approach, criteria, and scoring methodology", "artifact_type": "policy", "format_guidance": "PDF document with risk criteria, likelihood/impact scales, and risk acceptance thresholds", "frequency": "annual", "is_required": True},
                {"title": "Risk Acceptance Criteria", "description": "Documented criteria for accepting, mitigating, transferring, or avoiding risks", "artifact_type": "policy", "format_guidance": "Document defining risk tolerance levels and approval requirements for risk acceptance", "frequency": "annual", "is_required": True},
            ],
            "Conduct risk assessments": [
                {"title": "Information Security Risk Register", "description": "Comprehensive register of identified information security risks", "artifact_type": "record", "format_guidance": "Spreadsheet with risk ID, description, likelihood, impact, inherent risk, controls, residual risk", "frequency": "quarterly", "is_required": True},
                {"title": "Annual Risk Assessment Report", "description": "Report summarizing annual risk assessment activities and findings", "artifact_type": "report", "format_guidance": "PDF report with methodology used, risks identified, and risk profile summary", "frequency": "annual", "is_required": True},
                {"title": "Threat and Vulnerability Assessment", "description": "Assessment of relevant threats and vulnerabilities to the organization", "artifact_type": "report", "format_guidance": "Document analyzing threat landscape and organizational vulnerabilities", "frequency": "annual", "is_required": True},
            ],
            "Implement risk treatment": [
                {"title": "Risk Treatment Plan", "description": "Plan documenting how each unacceptable risk will be treated", "artifact_type": "record", "format_guidance": "Document or spreadsheet showing risk ID, treatment option, controls, owner, timeline", "frequency": "quarterly", "is_required": True},
                {"title": "Statement of Applicability (SoA)", "description": "Statement documenting which controls are applicable and their implementation status", "artifact_type": "record", "format_guidance": "Spreadsheet mapping ISO 27001 Annex A controls to implementation status with justifications", "frequency": "annual", "is_required": True},
                {"title": "Risk Acceptance Records", "description": "Formal documentation of risks accepted by management", "artifact_type": "record", "format_guidance": "Signed risk acceptance forms for risks above acceptable threshold", "frequency": "as_needed", "is_required": True},
            ],
            "Monitor and review risks": [
                {"title": "Risk Monitoring Report", "description": "Periodic report on risk status changes and treatment progress", "artifact_type": "report", "format_guidance": "Report showing risk movements, new risks, closed risks, and treatment status", "frequency": "quarterly", "is_required": True},
                {"title": "Key Risk Indicators (KRI) Dashboard", "description": "Dashboard tracking key risk indicators", "artifact_type": "report", "format_guidance": "Report or dashboard showing KRI trends and threshold breaches", "frequency": "monthly", "is_required": True},
            ],
        },
        "asset": {
            "Maintain asset inventory": [
                {"title": "Information Asset Inventory", "description": "Comprehensive inventory of information assets including data, systems, and infrastructure", "artifact_type": "record", "format_guidance": "Spreadsheet or CMDB export with asset name, type, owner, location, classification", "frequency": "quarterly", "is_required": True},
                {"title": "Asset Management Procedure", "description": "Procedure for identifying, classifying, and managing information assets", "artifact_type": "policy", "format_guidance": "Procedure document covering asset lifecycle from acquisition to disposal", "frequency": "annual", "is_required": True},
            ],
            "Classify information assets": [
                {"title": "Data Classification Policy", "description": "Policy defining data classification levels and handling requirements", "artifact_type": "policy", "format_guidance": "Policy document with classification levels (Public, Internal, Confidential, Restricted) and handling rules", "frequency": "annual", "is_required": True},
                {"title": "Data Classification Matrix", "description": "Matrix showing handling requirements for each classification level", "artifact_type": "record", "format_guidance": "Table showing storage, transmission, retention, and disposal requirements per classification", "frequency": "annual", "is_required": True},
                {"title": "Classified Asset List", "description": "List of assets with their assigned classification levels", "artifact_type": "record", "format_guidance": "Asset inventory with classification column populated for all assets", "frequency": "quarterly", "is_required": True},
            ],
            "Assign asset ownership": [
                {"title": "Asset Owner Register", "description": "Register of asset owners with acknowledgment of their responsibilities", "artifact_type": "record", "format_guidance": "Spreadsheet linking assets to named owners with acceptance date", "frequency": "quarterly", "is_required": True},
                {"title": "Asset Owner Responsibilities Document", "description": "Document defining asset owner responsibilities", "artifact_type": "policy", "format_guidance": "Document outlining owner duties: classification, access control, incident reporting", "frequency": "annual", "is_required": True},
            ],
        },
        "access_control": {
            "Define access control policy": [
                {"title": "Access Control Policy", "description": "Policy defining access control principles including need-to-know and least privilege", "artifact_type": "policy", "format_guidance": "PDF policy covering user access, privileged access, and remote access requirements", "frequency": "annual", "is_required": True},
                {"title": "User Access Management Procedure", "description": "Procedure for user registration, modification, and de-registration", "artifact_type": "policy", "format_guidance": "Step-by-step procedure with approval workflows and timelines", "frequency": "annual", "is_required": True},
            ],
            "Implement access provisioning": [
                {"title": "User Provisioning Records", "description": "Records of user access provisioning with approvals", "artifact_type": "record", "format_guidance": "Ticket system export or forms showing access requests and manager approvals", "frequency": "quarterly", "is_required": True},
                {"title": "Joiners-Movers-Leavers Process Evidence", "description": "Evidence that JML process is functioning correctly", "artifact_type": "record", "format_guidance": "Sample records showing proper access changes for recent joiners, movers, and leavers", "frequency": "quarterly", "is_required": True},
            ],
            "Manage privileged access": [
                {"title": "Privileged Access Inventory", "description": "Inventory of all users with privileged access rights", "artifact_type": "record", "format_guidance": "Spreadsheet listing privileged accounts, users, justification, and last review date", "frequency": "quarterly", "is_required": True},
                {"title": "Privileged Access Management (PAM) Configuration", "description": "Configuration of privileged access management controls", "artifact_type": "configuration", "format_guidance": "PAM tool configuration or policy showing session recording, approval workflows", "frequency": "quarterly", "is_required": True},
                {"title": "Privileged Activity Logs", "description": "Logs of privileged user activities", "artifact_type": "log", "format_guidance": "Log export showing privileged user sessions and commands executed", "frequency": "monthly", "is_required": True},
            ],
            "Review user access rights": [
                {"title": "User Access Review Report", "description": "Documented review of user access rights with manager attestation", "artifact_type": "report", "format_guidance": "Report with user list, access rights, and manager sign-off", "frequency": "quarterly", "is_required": True},
                {"title": "Access Review Findings and Remediation", "description": "Documentation of access review findings and corrective actions", "artifact_type": "record", "format_guidance": "Document tracking access violations found and remediation completed", "frequency": "quarterly", "is_required": True},
            ],
        },
        "cryptography": {
            "Define cryptographic policy": [
                {"title": "Cryptographic Policy", "description": "Policy on the use of cryptographic controls for information protection", "artifact_type": "policy", "format_guidance": "Policy specifying approved algorithms, key lengths, and use cases", "frequency": "annual", "is_required": True},
                {"title": "Key Management Procedure", "description": "Procedure for cryptographic key lifecycle management", "artifact_type": "policy", "format_guidance": "Procedure covering key generation, distribution, storage, rotation, and destruction", "frequency": "annual", "is_required": True},
            ],
            "Implement encryption controls": [
                {"title": "Encryption Implementation Report", "description": "Report on encryption implementation across systems and data", "artifact_type": "report", "format_guidance": "Report showing what data is encrypted, algorithms used, and coverage gaps", "frequency": "quarterly", "is_required": True},
                {"title": "TLS/SSL Certificate Inventory", "description": "Inventory of digital certificates with expiration tracking", "artifact_type": "record", "format_guidance": "Spreadsheet with certificate CN, issuer, expiration, and key strength", "frequency": "quarterly", "is_required": True},
            ],
            "Manage cryptographic keys": [
                {"title": "Key Inventory", "description": "Inventory of cryptographic keys in use", "artifact_type": "record", "format_guidance": "Register of keys including purpose, algorithm, custodian, and expiration", "frequency": "quarterly", "is_required": True},
                {"title": "Key Ceremony Records", "description": "Documentation of key generation and rotation ceremonies", "artifact_type": "record", "format_guidance": "Signed records of key ceremonies with participants and procedures followed", "frequency": "annual", "is_required": True},
            ],
        },
        "physical": {
            "Define physical security perimeter": [
                {"title": "Physical Security Policy", "description": "Policy defining physical security requirements for secure areas", "artifact_type": "policy", "format_guidance": "Policy document covering secure areas, access controls, and visitor management", "frequency": "annual", "is_required": True},
                {"title": "Secure Area Definitions", "description": "Document defining physical security zones and their requirements", "artifact_type": "record", "format_guidance": "Document or floor plan showing security zones and access restrictions", "frequency": "annual", "is_required": True},
            ],
            "Implement physical entry controls": [
                {"title": "Physical Access Control System Configuration", "description": "Configuration of badge/card access system for secure areas", "artifact_type": "configuration", "format_guidance": "Export from physical access control system showing zone definitions and access groups", "frequency": "quarterly", "is_required": True},
                {"title": "Physical Access Log Sample", "description": "Log of physical access events to secure areas", "artifact_type": "log", "format_guidance": "Access log export showing entries to data center and secure areas", "frequency": "monthly", "is_required": True},
                {"title": "Visitor Log Sample", "description": "Log of visitor access to secure areas", "artifact_type": "log", "format_guidance": "Visitor sign-in log or system export with escort information", "frequency": "monthly", "is_required": True},
            ],
            "Protect against environmental threats": [
                {"title": "Environmental Controls Documentation", "description": "Documentation of environmental protection controls (fire, flood, temperature)", "artifact_type": "configuration", "format_guidance": "Configuration or specification documents for HVAC, fire suppression, water detection", "frequency": "annual", "is_required": True},
                {"title": "Environmental Monitoring Logs", "description": "Logs from environmental monitoring systems", "artifact_type": "log", "format_guidance": "BMS or environmental monitoring system logs showing temperature, humidity readings", "frequency": "monthly", "is_required": True},
                {"title": "Fire Suppression System Test Records", "description": "Records of fire suppression system testing and maintenance", "artifact_type": "record", "format_guidance": "Maintenance records and test certificates from qualified vendor", "frequency": "annual", "is_required": True},
            ],
        },
        "operations": {
            "Document operating procedures": [
                {"title": "IT Operations Procedures Manual", "description": "Documented procedures for IT operations activities", "artifact_type": "policy", "format_guidance": "Collection of SOPs covering routine IT operations tasks", "frequency": "annual", "is_required": True},
                {"title": "System Administration Runbooks", "description": "Runbooks for common system administration tasks", "artifact_type": "policy", "format_guidance": "Step-by-step guides for routine and emergency procedures", "frequency": "annual", "is_required": True},
            ],
            "Implement change management": [
                {"title": "Change Management Policy", "description": "Policy defining change management requirements and process", "artifact_type": "policy", "format_guidance": "Policy document covering change types, approval requirements, and testing", "frequency": "annual", "is_required": True},
                {"title": "Change Advisory Board (CAB) Meeting Minutes", "description": "Minutes from CAB meetings reviewing and approving changes", "artifact_type": "record", "format_guidance": "Meeting minutes showing changes reviewed, decisions made, and attendees", "frequency": "monthly", "is_required": True},
                {"title": "Sample Change Requests with Approvals", "description": "Sample change requests showing proper approval workflow", "artifact_type": "record", "format_guidance": "Change tickets showing request, impact assessment, approvals, and test results", "frequency": "quarterly", "is_required": True},
            ],
            "Separate development environments": [
                {"title": "Environment Separation Documentation", "description": "Documentation showing separation of dev, test, and production environments", "artifact_type": "configuration", "format_guidance": "Network diagram or configuration showing environment isolation", "frequency": "annual", "is_required": True},
                {"title": "Production Data Masking Procedure", "description": "Procedure for masking production data used in non-production environments", "artifact_type": "policy", "format_guidance": "Procedure document covering data masking requirements and techniques", "frequency": "annual", "is_required": True},
            ],
        },
        "communications": {
            "Implement network controls": [
                {"title": "Network Security Architecture Document", "description": "Document describing network security controls and architecture", "artifact_type": "configuration", "format_guidance": "Architecture document with network diagrams and security control descriptions", "frequency": "annual", "is_required": True},
                {"title": "Firewall Rule Configuration", "description": "Firewall rule configuration for network segmentation", "artifact_type": "configuration", "format_guidance": "Firewall rule export with descriptions and business justifications", "frequency": "quarterly", "is_required": True},
            ],
            "Secure information transfer": [
                {"title": "Secure File Transfer Configuration", "description": "Configuration of secure file transfer mechanisms", "artifact_type": "configuration", "format_guidance": "SFTP, FTPS, or managed file transfer system configuration", "frequency": "quarterly", "is_required": True},
                {"title": "Email Security Configuration", "description": "Email security configuration including encryption and DLP", "artifact_type": "configuration", "format_guidance": "Email gateway configuration showing TLS, encryption, and content filtering", "frequency": "quarterly", "is_required": True},
            ],
            "Protect electronic messaging": [
                {"title": "Email Security Policy", "description": "Policy covering email security and acceptable use", "artifact_type": "policy", "format_guidance": "Policy document covering email encryption, attachments, and phishing awareness", "frequency": "annual", "is_required": True},
                {"title": "Collaboration Tool Security Configuration", "description": "Security configuration for messaging and collaboration tools", "artifact_type": "configuration", "format_guidance": "Configuration export from Teams, Slack, or equivalent showing security settings", "frequency": "quarterly", "is_required": True},
            ],
        },
        "supplier": {
            "Define supplier security policy": [
                {"title": "Supplier Security Policy", "description": "Policy defining security requirements for suppliers and third parties", "artifact_type": "policy", "format_guidance": "Policy covering supplier selection, contracts, and ongoing monitoring", "frequency": "annual", "is_required": True},
                {"title": "Supplier Security Requirements Checklist", "description": "Checklist of security requirements for supplier contracts", "artifact_type": "record", "format_guidance": "Checklist of security clauses to include in supplier agreements", "frequency": "annual", "is_required": True},
            ],
            "Assess supplier security": [
                {"title": "Supplier Risk Assessment Template", "description": "Template used for assessing supplier security risks", "artifact_type": "record", "format_guidance": "Assessment questionnaire or scoring template for supplier evaluation", "frequency": "annual", "is_required": True},
                {"title": "Critical Supplier Risk Assessments", "description": "Completed risk assessments for critical suppliers", "artifact_type": "report", "format_guidance": "Assessment reports for top suppliers showing risk scores and findings", "frequency": "annual", "is_required": True},
            ],
            "Monitor supplier services": [
                {"title": "Supplier Performance Reports", "description": "Reports on supplier service performance against SLAs", "artifact_type": "report", "format_guidance": "Periodic reports showing supplier performance metrics and SLA compliance", "frequency": "quarterly", "is_required": True},
                {"title": "Supplier Security Incident Log", "description": "Log of security incidents involving suppliers", "artifact_type": "log", "format_guidance": "Log or register of supplier-related security incidents and resolutions", "frequency": "quarterly", "is_required": False},
            ],
        },
        "incident_mgmt": {
            "Define incident management procedures": [
                {"title": "Information Security Incident Management Policy", "description": "Policy defining incident management roles, responsibilities, and procedures", "artifact_type": "policy", "format_guidance": "Policy covering incident definition, classification, and response requirements", "frequency": "annual", "is_required": True},
                {"title": "Incident Response Procedure", "description": "Detailed procedure for responding to security incidents", "artifact_type": "policy", "format_guidance": "Step-by-step procedure covering detection through closure", "frequency": "annual", "is_required": True},
            ],
            "Report security events": [
                {"title": "Security Incident Reporting Procedure", "description": "Procedure for employees to report security events", "artifact_type": "policy", "format_guidance": "User-facing procedure explaining how to report incidents", "frequency": "annual", "is_required": True},
                {"title": "Incident Reporting Form Template", "description": "Form template for reporting security incidents", "artifact_type": "record", "format_guidance": "Blank form showing required information for incident reporting", "frequency": "one_time", "is_required": True},
            ],
            "Respond to security incidents": [
                {"title": "Security Incident Log", "description": "Log of security incidents with response actions", "artifact_type": "log", "format_guidance": "Ticket system export or log showing incidents, classification, and resolution", "frequency": "monthly", "is_required": True},
                {"title": "Sample Incident Response Documentation", "description": "Documentation from actual incident responses (sanitized)", "artifact_type": "record", "format_guidance": "Sample incident tickets showing proper response procedures were followed", "frequency": "quarterly", "is_required": True},
            ],
            "Learn from security incidents": [
                {"title": "Post-Incident Review Reports", "description": "Reports from post-incident reviews identifying lessons learned", "artifact_type": "report", "format_guidance": "Post-mortem reports with root cause, timeline, and improvement recommendations", "frequency": "as_needed", "is_required": True},
                {"title": "Incident Trend Analysis", "description": "Analysis of incident trends to identify patterns", "artifact_type": "report", "format_guidance": "Report showing incident volumes, types, and trends over time", "frequency": "quarterly", "is_required": True},
            ],
        },
        "continuity": {
            "Plan information security continuity": [
                {"title": "Business Continuity Policy", "description": "Policy establishing business continuity requirements", "artifact_type": "policy", "format_guidance": "Policy covering BCP scope, roles, and recovery objectives", "frequency": "annual", "is_required": True},
                {"title": "Business Impact Analysis (BIA)", "description": "Analysis identifying critical business processes and their requirements", "artifact_type": "report", "format_guidance": "BIA report with RTOs, RPOs, and critical dependencies", "frequency": "annual", "is_required": True},
            ],
            "Implement continuity controls": [
                {"title": "Business Continuity Plan", "description": "Plan for maintaining operations during disruptions", "artifact_type": "policy", "format_guidance": "BCP document with recovery procedures and contact information", "frequency": "annual", "is_required": True},
                {"title": "Disaster Recovery Plan", "description": "Plan for recovering IT systems and data", "artifact_type": "policy", "format_guidance": "DRP with recovery procedures, system priorities, and failover steps", "frequency": "annual", "is_required": True},
                {"title": "Backup Verification Reports", "description": "Reports verifying backup success and recoverability", "artifact_type": "report", "format_guidance": "Backup system reports showing success rates and restore tests", "frequency": "monthly", "is_required": True},
            ],
            "Test continuity arrangements": [
                {"title": "BCP/DRP Test Report", "description": "Report from business continuity/disaster recovery testing", "artifact_type": "report", "format_guidance": "Test report with scenario, participants, results, and improvements", "frequency": "annual", "is_required": True},
                {"title": "Backup Restoration Test Records", "description": "Records of backup restoration testing", "artifact_type": "record", "format_guidance": "Test records showing successful restoration of critical systems", "frequency": "quarterly", "is_required": True},
            ],
        },
        "compliance": {
            "Identify legal requirements": [
                {"title": "Legal and Regulatory Requirements Register", "description": "Register of applicable legal, regulatory, and contractual requirements", "artifact_type": "record", "format_guidance": "Spreadsheet listing requirements, sources, applicability, and responsible owners", "frequency": "annual", "is_required": True},
                {"title": "Privacy Impact Assessment", "description": "Assessment of privacy requirements and compliance measures", "artifact_type": "report", "format_guidance": "PIA document covering data protection requirements (GDPR, etc.)", "frequency": "annual", "is_required": True},
            ],
            "Protect records": [
                {"title": "Records Retention Policy", "description": "Policy defining retention periods for different record types", "artifact_type": "policy", "format_guidance": "Policy with retention schedule by record type and legal basis", "frequency": "annual", "is_required": True},
                {"title": "Records Inventory", "description": "Inventory of records with retention periods and storage locations", "artifact_type": "record", "format_guidance": "Spreadsheet listing record types, retention periods, and storage", "frequency": "annual", "is_required": True},
            ],
            "Conduct independent audits": [
                {"title": "Internal Audit Schedule", "description": "Schedule of planned internal security audits", "artifact_type": "record", "format_guidance": "Audit calendar showing planned audits for the year", "frequency": "annual", "is_required": True},
                {"title": "Internal Audit Reports", "description": "Reports from internal security audits", "artifact_type": "report", "format_guidance": "Audit reports with scope, findings, and recommendations", "frequency": "annual", "is_required": True},
                {"title": "Audit Finding Remediation Tracker", "description": "Tracking of audit finding remediation", "artifact_type": "record", "format_guidance": "Spreadsheet tracking findings, owners, status, and completion dates", "frequency": "quarterly", "is_required": True},
            ],
        },
    },
    "NIST_CSF": {
        "identify": {
            "Inventory assets": [
                {"title": "Hardware Asset Inventory", "description": "Inventory of physical devices and systems", "artifact_type": "record", "format_guidance": "CMDB export or spreadsheet with hardware assets, owners, and locations", "frequency": "quarterly", "is_required": True},
                {"title": "Software Asset Inventory", "description": "Inventory of software and applications", "artifact_type": "record", "format_guidance": "Software inventory with versions, licenses, and owners", "frequency": "quarterly", "is_required": True},
                {"title": "Data Asset Inventory", "description": "Inventory of data assets and their classifications", "artifact_type": "record", "format_guidance": "Data inventory with types, classifications, and storage locations", "frequency": "quarterly", "is_required": True},
            ],
            "Establish governance": [
                {"title": "Cybersecurity Program Charter", "description": "Charter establishing the cybersecurity program", "artifact_type": "policy", "format_guidance": "Document defining program scope, governance, and leadership", "frequency": "annual", "is_required": True},
                {"title": "Cybersecurity Policy Framework", "description": "Framework of cybersecurity policies and standards", "artifact_type": "policy", "format_guidance": "Policy hierarchy document with all security policies listed", "frequency": "annual", "is_required": True},
            ],
            "Assess risks": [
                {"title": "Cybersecurity Risk Assessment", "description": "Assessment of cybersecurity risks to the organization", "artifact_type": "report", "format_guidance": "Risk assessment report with methodology, findings, and recommendations", "frequency": "annual", "is_required": True},
                {"title": "Risk Register", "description": "Register of identified cybersecurity risks", "artifact_type": "record", "format_guidance": "Spreadsheet with risks, likelihood, impact, and treatment plans", "frequency": "quarterly", "is_required": True},
            ],
            "Define risk strategy": [
                {"title": "Risk Management Strategy", "description": "Document defining organizational approach to risk management", "artifact_type": "policy", "format_guidance": "Strategy document with risk tolerance and treatment approaches", "frequency": "annual", "is_required": True},
                {"title": "Risk Appetite Statement", "description": "Statement defining acceptable risk levels", "artifact_type": "policy", "format_guidance": "Board-approved statement of risk appetite by risk category", "frequency": "annual", "is_required": True},
            ],
        },
        "protect": {
            "Manage identities": [
                {"title": "Identity Management Policy", "description": "Policy for identity and credential management", "artifact_type": "policy", "format_guidance": "Policy covering identity lifecycle, authentication, and credentials", "frequency": "annual", "is_required": True},
                {"title": "Identity Provider Configuration", "description": "Configuration of identity management systems", "artifact_type": "configuration", "format_guidance": "IdP configuration export showing authentication policies", "frequency": "quarterly", "is_required": True},
            ],
            "Implement access control": [
                {"title": "Access Control Configuration", "description": "Configuration of access control mechanisms", "artifact_type": "configuration", "format_guidance": "Access control system exports showing permissions and roles", "frequency": "quarterly", "is_required": True},
                {"title": "Network Access Control Configuration", "description": "NAC configuration for network access control", "artifact_type": "configuration", "format_guidance": "NAC policy configuration showing access rules", "frequency": "quarterly", "is_required": True},
            ],
            "Provide awareness training": [
                {"title": "Security Awareness Training Program", "description": "Documentation of security awareness training program", "artifact_type": "policy", "format_guidance": "Program document with curriculum, schedule, and delivery methods", "frequency": "annual", "is_required": True},
                {"title": "Training Completion Records", "description": "Records of employee training completion", "artifact_type": "record", "format_guidance": "LMS export showing completion rates and scores", "frequency": "annual", "is_required": True},
                {"title": "Phishing Simulation Results", "description": "Results from phishing awareness simulations", "artifact_type": "report", "format_guidance": "Report showing click rates, reporting rates, and trends", "frequency": "quarterly", "is_required": True},
            ],
            "Protect data": [
                {"title": "Data Protection Policy", "description": "Policy for protecting data at rest and in transit", "artifact_type": "policy", "format_guidance": "Policy covering encryption, DLP, and data handling", "frequency": "annual", "is_required": True},
                {"title": "DLP Configuration", "description": "Data Loss Prevention tool configuration", "artifact_type": "configuration", "format_guidance": "DLP rule configuration and policy settings", "frequency": "quarterly", "is_required": True},
            ],
            "Implement protective technology": [
                {"title": "Endpoint Protection Configuration", "description": "Endpoint security tool configuration", "artifact_type": "configuration", "format_guidance": "EPP/EDR configuration showing protection settings", "frequency": "quarterly", "is_required": True},
                {"title": "Email Security Gateway Configuration", "description": "Email security configuration", "artifact_type": "configuration", "format_guidance": "Email gateway configuration showing filtering and protection", "frequency": "quarterly", "is_required": True},
                {"title": "Web Filtering Configuration", "description": "Web proxy/filter configuration", "artifact_type": "configuration", "format_guidance": "Web filter rules and category blocking settings", "frequency": "quarterly", "is_required": True},
            ],
        },
        "detect": {
            "Deploy detection systems": [
                {"title": "SIEM Architecture and Configuration", "description": "SIEM system architecture and configuration", "artifact_type": "configuration", "format_guidance": "SIEM configuration showing log sources and correlation rules", "frequency": "quarterly", "is_required": True},
                {"title": "IDS/IPS Configuration", "description": "Intrusion detection/prevention system configuration", "artifact_type": "configuration", "format_guidance": "IDS/IPS rule configuration and signature settings", "frequency": "quarterly", "is_required": True},
            ],
            "Implement continuous monitoring": [
                {"title": "Security Monitoring Procedure", "description": "Procedure for continuous security monitoring", "artifact_type": "policy", "format_guidance": "Procedure covering monitoring scope, alerts, and response", "frequency": "annual", "is_required": True},
                {"title": "SOC Dashboard Screenshots", "description": "Screenshots of security monitoring dashboards", "artifact_type": "screenshot", "format_guidance": "Dashboard screenshots showing active monitoring", "frequency": "monthly", "is_required": True},
                {"title": "Alert Correlation Rules", "description": "Documentation of alert correlation rules", "artifact_type": "configuration", "format_guidance": "SIEM correlation rules with descriptions and thresholds", "frequency": "quarterly", "is_required": True},
            ],
            "Analyze detection events": [
                {"title": "Alert Triage Procedure", "description": "Procedure for triaging and analyzing security alerts", "artifact_type": "policy", "format_guidance": "Procedure with classification criteria and response actions", "frequency": "annual", "is_required": True},
                {"title": "Alert Analysis Log", "description": "Log of analyzed security alerts", "artifact_type": "log", "format_guidance": "Ticket or SIEM export showing alert analysis and disposition", "frequency": "monthly", "is_required": True},
            ],
        },
        "respond": {
            "Plan response activities": [
                {"title": "Incident Response Plan", "description": "Plan for responding to cybersecurity incidents", "artifact_type": "policy", "format_guidance": "IR plan with phases, roles, and procedures", "frequency": "annual", "is_required": True},
                {"title": "Incident Response Playbooks", "description": "Playbooks for specific incident types", "artifact_type": "policy", "format_guidance": "Playbooks for ransomware, phishing, data breach, etc.", "frequency": "annual", "is_required": True},
            ],
            "Communicate during incidents": [
                {"title": "Incident Communication Plan", "description": "Plan for internal and external communications during incidents", "artifact_type": "policy", "format_guidance": "Communication templates and escalation contacts", "frequency": "annual", "is_required": True},
                {"title": "Stakeholder Notification Matrix", "description": "Matrix defining who to notify for different incident types", "artifact_type": "record", "format_guidance": "Matrix showing stakeholders, contact info, and notification triggers", "frequency": "annual", "is_required": True},
            ],
            "Analyze incidents": [
                {"title": "Incident Investigation Procedure", "description": "Procedure for investigating security incidents", "artifact_type": "policy", "format_guidance": "Procedure covering evidence collection, analysis, and documentation", "frequency": "annual", "is_required": True},
                {"title": "Sample Incident Investigation Report", "description": "Sample investigation report from an incident", "artifact_type": "report", "format_guidance": "Investigation report with timeline, findings, and root cause", "frequency": "as_needed", "is_required": True},
            ],
            "Mitigate incidents": [
                {"title": "Incident Containment Procedures", "description": "Procedures for containing security incidents", "artifact_type": "policy", "format_guidance": "Containment procedures for different incident types", "frequency": "annual", "is_required": True},
                {"title": "Incident Metrics Report", "description": "Metrics on incident response performance", "artifact_type": "report", "format_guidance": "Report with MTTD, MTTR, and incident volumes", "frequency": "quarterly", "is_required": True},
            ],
            "Improve response": [
                {"title": "Post-Incident Review Process", "description": "Process for conducting post-incident reviews", "artifact_type": "policy", "format_guidance": "Procedure for lessons learned and improvement identification", "frequency": "annual", "is_required": True},
                {"title": "Lessons Learned Log", "description": "Log of lessons learned from incidents", "artifact_type": "record", "format_guidance": "Log with lessons, improvements made, and dates", "frequency": "quarterly", "is_required": True},
            ],
        },
        "recover": {
            "Plan recovery activities": [
                {"title": "Recovery Planning Documentation", "description": "Documentation of recovery planning activities", "artifact_type": "policy", "format_guidance": "Recovery plans for critical systems and processes", "frequency": "annual", "is_required": True},
                {"title": "System Recovery Procedures", "description": "Procedures for recovering critical systems", "artifact_type": "policy", "format_guidance": "Step-by-step recovery procedures by system", "frequency": "annual", "is_required": True},
            ],
            "Implement improvements": [
                {"title": "Recovery Improvement Plan", "description": "Plan for improving recovery capabilities based on lessons learned", "artifact_type": "record", "format_guidance": "Improvement plan with actions, owners, and timelines", "frequency": "annual", "is_required": True},
                {"title": "Improvement Implementation Evidence", "description": "Evidence of recovery improvements implemented", "artifact_type": "record", "format_guidance": "Documentation showing improvements completed", "frequency": "annual", "is_required": True},
            ],
            "Communicate recovery": [
                {"title": "Recovery Communication Plan", "description": "Plan for communications during recovery activities", "artifact_type": "policy", "format_guidance": "Templates and procedures for recovery communications", "frequency": "annual", "is_required": True},
                {"title": "Recovery Status Report Template", "description": "Template for recovery status reporting", "artifact_type": "record", "format_guidance": "Template for reporting recovery progress to stakeholders", "frequency": "one_time", "is_required": True},
            ],
        },
    },
    "SWIFT_CSP": {
        "environment": {
            "Document SWIFT environment": [
                {"title": "SWIFT Infrastructure Architecture Document", "description": "Documentation of SWIFT infrastructure components and their interconnections", "artifact_type": "configuration", "format_guidance": "Architecture document with diagrams showing all SWIFT components", "frequency": "annual", "is_required": True},
                {"title": "SWIFT Zone Diagram", "description": "Diagram showing SWIFT secure zone boundaries", "artifact_type": "configuration", "format_guidance": "Network diagram showing SWIFT secure zone isolation", "frequency": "annual", "is_required": True},
            ],
            "Restrict internet access": [
                {"title": "SWIFT Zone Firewall Rules", "description": "Firewall rules restricting SWIFT zone internet access", "artifact_type": "configuration", "format_guidance": "Firewall rule export showing internet restrictions for SWIFT zone", "frequency": "quarterly", "is_required": True},
                {"title": "Jump Server Configuration", "description": "Configuration of jump servers for SWIFT zone access", "artifact_type": "configuration", "format_guidance": "Jump server configuration showing access controls", "frequency": "quarterly", "is_required": True},
            ],
            "Protect SWIFT data": [
                {"title": "SWIFT Data Encryption Configuration", "description": "Encryption configuration for SWIFT data at rest", "artifact_type": "configuration", "format_guidance": "Encryption settings for SWIFT databases and file storage", "frequency": "quarterly", "is_required": True},
                {"title": "SWIFT Message Integrity Controls", "description": "Controls ensuring SWIFT message integrity", "artifact_type": "configuration", "format_guidance": "Configuration showing message signing and validation", "frequency": "quarterly", "is_required": True},
            ],
            "Segment SWIFT network": [
                {"title": "SWIFT Network Segmentation Evidence", "description": "Evidence of SWIFT zone network segmentation", "artifact_type": "configuration", "format_guidance": "VLAN and firewall configuration showing SWIFT isolation", "frequency": "quarterly", "is_required": True},
                {"title": "SWIFT Segmentation Test Results", "description": "Results from SWIFT network segmentation testing", "artifact_type": "report", "format_guidance": "Penetration test results validating SWIFT zone isolation", "frequency": "annual", "is_required": True},
            ],
        },
        "access": {
            "Implement multi-factor authentication": [
                {"title": "SWIFT MFA Configuration", "description": "Multi-factor authentication configuration for SWIFT access", "artifact_type": "configuration", "format_guidance": "MFA configuration showing SWIFT operator authentication requirements", "frequency": "quarterly", "is_required": True},
                {"title": "SWIFT Operator MFA Enrollment Report", "description": "Report showing SWIFT operator MFA enrollment status", "artifact_type": "report", "format_guidance": "Report listing all SWIFT operators and their MFA status", "frequency": "monthly", "is_required": True},
            ],
            "Manage SWIFT credentials": [
                {"title": "SWIFT Operator Account Inventory", "description": "Inventory of SWIFT operator accounts", "artifact_type": "record", "format_guidance": "Spreadsheet listing operators, roles, and last credential change", "frequency": "quarterly", "is_required": True},
                {"title": "SWIFT Password Policy Configuration", "description": "Password policy configuration for SWIFT accounts", "artifact_type": "configuration", "format_guidance": "Password policy export showing complexity and rotation requirements", "frequency": "quarterly", "is_required": True},
            ],
            "Control privileged access": [
                {"title": "SWIFT Privileged Account Inventory", "description": "Inventory of privileged SWIFT accounts", "artifact_type": "record", "format_guidance": "List of all admin and privileged SWIFT accounts with justifications", "frequency": "quarterly", "is_required": True},
                {"title": "SWIFT Privileged Access Logs", "description": "Logs of privileged access to SWIFT systems", "artifact_type": "log", "format_guidance": "Log export showing admin sessions and activities", "frequency": "monthly", "is_required": True},
            ],
            "Review access rights": [
                {"title": "SWIFT Operator Access Review", "description": "Periodic review of SWIFT operator access rights", "artifact_type": "report", "format_guidance": "Access review report with manager attestations", "frequency": "quarterly", "is_required": True},
                {"title": "SWIFT User Recertification Records", "description": "Records of SWIFT user access recertification", "artifact_type": "record", "format_guidance": "Signed recertification records for each SWIFT operator", "frequency": "quarterly", "is_required": True},
            ],
        },
        "detection": {
            "Detect anomalous activity": [
                {"title": "SWIFT Transaction Monitoring Configuration", "description": "Configuration of SWIFT transaction anomaly detection", "artifact_type": "configuration", "format_guidance": "Monitoring rules and thresholds for detecting anomalous transactions", "frequency": "quarterly", "is_required": True},
                {"title": "SWIFT Fraud Detection Alert Log", "description": "Log of fraud detection alerts from SWIFT monitoring", "artifact_type": "log", "format_guidance": "Alert log showing triggered fraud detection rules", "frequency": "monthly", "is_required": True},
            ],
            "Log SWIFT transactions": [
                {"title": "SWIFT Audit Log Configuration", "description": "Configuration of SWIFT transaction and event logging", "artifact_type": "configuration", "format_guidance": "Logging configuration showing what events are captured", "frequency": "quarterly", "is_required": True},
                {"title": "SWIFT Transaction Log Sample", "description": "Sample of SWIFT transaction logs", "artifact_type": "log", "format_guidance": "Sample logs showing transaction details and operator actions", "frequency": "monthly", "is_required": True},
            ],
            "Monitor security events": [
                {"title": "SWIFT Security Monitoring Dashboard", "description": "Screenshot of SWIFT security monitoring dashboard", "artifact_type": "screenshot", "format_guidance": "Dashboard screenshot showing real-time SWIFT monitoring", "frequency": "monthly", "is_required": True},
                {"title": "SWIFT Security Event Log", "description": "Log of security events in SWIFT environment", "artifact_type": "log", "format_guidance": "SIEM export of SWIFT-related security events", "frequency": "monthly", "is_required": True},
            ],
        },
        "response": {
            "Define incident response for SWIFT": [
                {"title": "SWIFT Incident Response Plan", "description": "Incident response plan specific to SWIFT environment", "artifact_type": "policy", "format_guidance": "IR plan with SWIFT-specific procedures and contacts", "frequency": "annual", "is_required": True},
                {"title": "SWIFT Incident Escalation Matrix", "description": "Escalation matrix for SWIFT security incidents", "artifact_type": "record", "format_guidance": "Matrix showing escalation paths and SWIFT contacts", "frequency": "annual", "is_required": True},
            ],
            "Test incident response": [
                {"title": "SWIFT IR Exercise Report", "description": "Report from SWIFT incident response exercise", "artifact_type": "report", "format_guidance": "Exercise report with scenario, participants, and lessons learned", "frequency": "annual", "is_required": True},
                {"title": "SWIFT IR Test Improvements", "description": "Improvements identified from SWIFT IR testing", "artifact_type": "record", "format_guidance": "Action items and improvements from IR exercises", "frequency": "annual", "is_required": True},
            ],
            "Report to SWIFT": [
                {"title": "SWIFT Reporting Procedure", "description": "Procedure for mandatory reporting to SWIFT", "artifact_type": "policy", "format_guidance": "Procedure outlining when and how to report to SWIFT", "frequency": "annual", "is_required": True},
                {"title": "SWIFT Communication Records", "description": "Records of communications with SWIFT (if applicable)", "artifact_type": "record", "format_guidance": "Documentation of any mandatory reports or communications", "frequency": "as_needed", "is_required": False},
            ],
        },
        "sharing": {
            "Participate in information sharing": [
                {"title": "SWIFT ISAC Participation Evidence", "description": "Evidence of participation in SWIFT information sharing", "artifact_type": "record", "format_guidance": "Membership confirmation or participation records", "frequency": "annual", "is_required": True},
            ],
            "Consume threat intelligence": [
                {"title": "SWIFT Threat Intelligence Integration", "description": "Evidence of SWIFT threat intelligence consumption", "artifact_type": "configuration", "format_guidance": "Configuration showing threat feed integration", "frequency": "quarterly", "is_required": True},
                {"title": "Threat Intelligence Action Log", "description": "Log of actions taken based on threat intelligence", "artifact_type": "log", "format_guidance": "Log showing threat intel received and defensive actions taken", "frequency": "monthly", "is_required": True},
            ],
        },
    },
}

def seed_curated_evidence_items():
    """Seed curated evidence items for all framework sub-controls."""
    db = SessionLocal()
    
    try:
        existing_count = db.query(CuratedEvidenceItem).count()
        if existing_count > 0:
            print(f"Curated evidence items already seeded ({existing_count} items). Skipping...")
            return
        
        print("Seeding curated evidence items...")
        items_created = 0
        
        for framework_code, categories in CURATED_EVIDENCE_DATA.items():
            framework = db.query(Framework).filter(Framework.short_code == framework_code).first()
            if not framework:
                print(f"  Framework {framework_code} not found, skipping...")
                continue
            
            domains = db.query(FrameworkDomain).filter(FrameworkDomain.framework_id == framework.id).all()
            
            for category_name, sub_control_evidence in categories.items():
                for domain in domains:
                    objectives = db.query(ControlObjective).filter(ControlObjective.domain_id == domain.id).all()
                    
                    for objective in objectives:
                        controls = db.query(FrameworkControl).filter(FrameworkControl.objective_id == objective.id).all()
                        
                        for control in controls:
                            sub_controls = db.query(FrameworkSubControl).filter(FrameworkSubControl.control_id == control.id).all()
                            
                            for sub_control in sub_controls:
                                if sub_control.name in sub_control_evidence:
                                    evidence_items = sub_control_evidence[sub_control.name]
                                    
                                    for item_data in evidence_items:
                                        evidence_item = CuratedEvidenceItem(
                                            sub_control_id=sub_control.id,
                                            title=item_data["title"],
                                            description=item_data["description"],
                                            artifact_type=item_data["artifact_type"],
                                            format_guidance=item_data.get("format_guidance"),
                                            frequency=item_data.get("frequency", "annual"),
                                            is_required=item_data.get("is_required", True)
                                        )
                                        db.add(evidence_item)
                                        items_created += 1
        
        db.commit()
        print(f"Seeded {items_created} curated evidence items successfully.")
        
    except Exception as e:
        db.rollback()
        print(f"Error seeding curated evidence items: {e}")
        raise
    finally:
        db.close()
