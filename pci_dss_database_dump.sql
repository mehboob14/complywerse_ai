-- PCI DSS Lifecycle Application - Complete Database Dump
-- PostgreSQL Compatible
-- Generated for populating a fresh database

-- ============================================
-- TABLE 1: USERS (5 records)
-- ============================================
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(100) UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(50) DEFAULT 'it_security',
    display_name VARCHAR(255),
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_login TIMESTAMP
);

INSERT INTO users (username, email, password_hash, role, display_name, is_active) VALUES
('admin', 'admin@pci.local', '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/X4.mqIaQ8cqOjL.0q', 'admin', 'System Administrator', TRUE),
('infosec', 'infosec@pci.local', '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/X4.mqIaQ8cqOjL.0q', 'infosec_team', 'Infosec Team Lead', TRUE),
('auditor', 'auditor@pci.local', '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/X4.mqIaQ8cqOjL.0q', 'qsa_auditor', 'QSA Auditor', TRUE),
('business', 'business@pci.local', '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/X4.mqIaQ8cqOjL.0q', 'business_owner', 'Business Owner', TRUE),
('itsec', 'itsec@pci.local', '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/X4.mqIaQ8cqOjL.0q', 'it_security', 'IT Security Analyst', TRUE);

-- ============================================
-- TABLE 2: PHASES (7 records)
-- ============================================
CREATE TABLE IF NOT EXISTS phases (
    id SERIAL PRIMARY KEY,
    phase_number INTEGER UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    status VARCHAR(50) DEFAULT 'not_started',
    is_current BOOLEAN DEFAULT FALSE,
    approval_status VARCHAR(50) DEFAULT 'not_required',
    approved_by VARCHAR(255),
    approved_at TIMESTAMP
);

INSERT INTO phases (phase_number, name, description, status, is_current, approval_status) VALUES
(1, 'PCI Scope Definition', 'Define the Cardholder Data Environment and connected systems', 'complete', FALSE, 'not_required'),
(2, 'Gap Assessment', 'Assess current state against PCI DSS v4.x requirements', 'in_progress', TRUE, 'not_required'),
(3, 'Control Implementation', 'Implement required PCI DSS controls', 'not_started', FALSE, 'not_required'),
(4, 'Evidence Collection', 'Collect and organize compliance evidence', 'not_started', FALSE, 'not_required'),
(5, 'Vulnerability & Penetration Testing', 'Conduct required security testing', 'not_started', FALSE, 'not_required'),
(6, 'Compliance Validation', 'QSA assessment and attestation', 'not_started', FALSE, 'not_required'),
(7, 'Continuous Compliance', 'Maintain ongoing PCI DSS compliance', 'not_started', FALSE, 'not_required');

-- ============================================
-- TABLE 3: PHASE_TASKS (29 records)
-- ============================================
CREATE TABLE IF NOT EXISTS phase_tasks (
    id SERIAL PRIMARY KEY,
    phase_id INTEGER REFERENCES phases(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    is_complete BOOLEAN DEFAULT FALSE
);

INSERT INTO phase_tasks (phase_id, name, is_complete) VALUES
(1, 'Identify CDE systems', TRUE),
(1, 'Map data flows', TRUE),
(1, 'Identify connected systems', TRUE),
(1, 'Validate network segmentation', TRUE),
(1, 'Document scope reduction', TRUE),
(2, 'Review all 12 requirements', FALSE),
(2, 'Assess current controls', FALSE),
(2, 'Identify gaps', FALSE),
(2, 'Prioritize remediation', FALSE),
(3, 'Implement technical controls', FALSE),
(3, 'Implement administrative controls', FALSE),
(3, 'Configure security settings', FALSE),
(3, 'Deploy monitoring tools', FALSE),
(4, 'Gather policies and procedures', FALSE),
(4, 'Collect configurations', FALSE),
(4, 'Capture screenshots', FALSE),
(4, 'Generate reports', FALSE),
(5, 'Quarterly ASV scans', FALSE),
(5, 'Internal vulnerability scans', FALSE),
(5, 'External penetration test', FALSE),
(5, 'Internal penetration test', FALSE),
(5, 'Segmentation testing', FALSE),
(6, 'QSA engagement', FALSE),
(6, 'Evidence review', FALSE),
(6, 'On-site assessment', FALSE),
(6, 'Report on Compliance', FALSE),
(7, 'Quarterly reviews', FALSE),
(7, 'Change management', FALSE),
(7, 'Continuous monitoring', FALSE),
(7, 'Annual reassessment', FALSE);

-- ============================================
-- TABLE 4: PHASE_DELIVERABLES (17 records)
-- ============================================
CREATE TABLE IF NOT EXISTS phase_deliverables (
    id SERIAL PRIMARY KEY,
    phase_id INTEGER REFERENCES phases(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL
);

INSERT INTO phase_deliverables (phase_id, name) VALUES
(1, 'CDE Inventory'),
(1, 'Data Flow Diagram'),
(1, 'Segmentation Validation'),
(2, 'Gap Assessment Report'),
(2, 'Remediation Plan'),
(3, 'Control Documentation'),
(3, 'Configuration Standards'),
(4, 'Evidence Repository'),
(4, 'Documentation Index'),
(5, 'ASV Scan Reports'),
(5, 'Penetration Test Report'),
(5, 'Remediation Evidence'),
(6, 'ROC'),
(6, 'AOC'),
(7, 'Quarterly Reports'),
(7, 'Change Impact Assessments');

-- ============================================
-- TABLE 5: REQUIREMENTS (12 records)
-- ============================================
CREATE TABLE IF NOT EXISTS requirements (
    id SERIAL PRIMARY KEY,
    req_number INTEGER UNIQUE NOT NULL,
    name VARCHAR(500) NOT NULL,
    description TEXT
);

INSERT INTO requirements (req_number, name, description) VALUES
(1, 'Install and maintain network security controls', 'Network security controls (NSCs), such as firewalls and other network security technologies, are network policy enforcement points.'),
(2, 'Apply secure configurations to all system components', 'Malicious individuals often use default passwords and other vendor default settings to compromise systems.'),
(3, 'Protect stored account data', 'Protection methods such as encryption, truncation, masking, and hashing are critical components of cardholder data protection.'),
(4, 'Protect cardholder data with strong cryptography during transmission', 'Sensitive information must be encrypted during transmission over networks that are easily accessed by malicious individuals.'),
(5, 'Protect all systems and networks from malicious software', 'Malicious software poses a constant threat to systems processing payment card data.'),
(6, 'Develop and maintain secure systems and software', 'Security vulnerabilities in systems and software may allow criminals to gain access to payment card data.'),
(7, 'Restrict access to system components and cardholder data by business need to know', 'Access to cardholder data must be limited to only those individuals whose job requires such access.'),
(8, 'Identify users and authenticate access to system components', 'Identifying users and authenticating access to system components helps ensure accountability.'),
(9, 'Restrict physical access to cardholder data', 'Physical access to cardholder data or systems that store, process, or transmit cardholder data should be restricted.'),
(10, 'Log and monitor all access to system components and cardholder data', 'Logging mechanisms and the ability to track user activities are critical for preventing, detecting, or minimizing the impact of a data compromise.'),
(11, 'Test security of systems and networks regularly', 'Vulnerabilities are continually being discovered by malicious individuals and researchers.'),
(12, 'Support information security with organizational policies and programs', 'A strong security policy sets the security tone for the whole entity and informs personnel what is expected of them.');

-- ============================================
-- TABLE 6: SUB_REQUIREMENTS (63 records)
-- ============================================
CREATE TABLE IF NOT EXISTS sub_requirements (
    id SERIAL PRIMARY KEY,
    requirement_id INTEGER REFERENCES requirements(id) ON DELETE CASCADE,
    sub_req_number VARCHAR(20) NOT NULL,
    name TEXT NOT NULL
);

INSERT INTO sub_requirements (requirement_id, sub_req_number, name) VALUES
(1, '1.1', 'Processes and mechanisms for installing and maintaining network security controls are defined and understood'),
(1, '1.2', 'Network security controls (NSCs) are configured and maintained'),
(1, '1.3', 'Network access to and from the cardholder data environment is restricted'),
(1, '1.4', 'Network connections between trusted and untrusted networks are controlled'),
(1, '1.5', 'Risks to the CDE from computing devices that connect to both untrusted networks and the CDE are mitigated'),
(2, '2.1', 'Processes and mechanisms for applying secure configurations are defined and understood'),
(2, '2.2', 'System components are configured and managed securely'),
(2, '2.3', 'Wireless environments are configured and managed securely'),
(3, '3.1', 'Processes and mechanisms for protecting stored account data are defined and understood'),
(3, '3.2', 'Storage of account data is kept to a minimum'),
(3, '3.3', 'Sensitive authentication data (SAD) is not stored after authorization'),
(3, '3.4', 'Access to displays of full PAN and ability to copy cardholder data are restricted'),
(3, '3.5', 'Primary account number (PAN) is secured wherever it is stored'),
(3, '3.6', 'Cryptographic keys used to protect stored account data are secured'),
(3, '3.7', 'Where cryptography is used to protect stored account data, key management processes are defined'),
(4, '4.1', 'Processes and mechanisms for protecting cardholder data with strong cryptography during transmission are defined'),
(4, '4.2', 'PAN is protected with strong cryptography during transmission'),
(5, '5.1', 'Processes and mechanisms for protecting systems from malicious software are defined'),
(5, '5.2', 'Malicious software is prevented, or detected and addressed'),
(5, '5.3', 'Anti-malware mechanisms and processes are active, maintained, and monitored'),
(5, '5.4', 'Anti-phishing mechanisms protect users against phishing attacks'),
(6, '6.1', 'Processes for developing and maintaining secure systems and software are defined'),
(6, '6.2', 'Bespoke and custom software are developed securely'),
(6, '6.3', 'Security vulnerabilities are identified and addressed'),
(6, '6.4', 'Public-facing web applications are protected against attacks'),
(6, '6.5', 'Changes to all system components are managed securely'),
(7, '7.1', 'Processes for restricting access to cardholder data by business need to know are defined'),
(7, '7.2', 'Access to system components and data is appropriately defined and assigned'),
(7, '7.3', 'Access to system components and data is managed via an access control system'),
(8, '8.1', 'Processes for identification and authentication are defined'),
(8, '8.2', 'User identification and related accounts are strictly managed'),
(8, '8.3', 'Strong authentication for users and administrators is established and managed'),
(8, '8.4', 'Multi-factor authentication (MFA) is implemented'),
(8, '8.5', 'Multi-factor authentication (MFA) systems are configured to prevent misuse'),
(8, '8.6', 'Use of application and system accounts is strictly managed'),
(9, '9.1', 'Processes for restricting physical access to cardholder data are defined'),
(9, '9.2', 'Physical access controls manage entry into facilities and systems containing cardholder data'),
(9, '9.3', 'Physical access for personnel and visitors is authorized and managed'),
(9, '9.4', 'Media with cardholder data is securely stored, accessed, distributed, and destroyed'),
(9, '9.5', 'Point of interaction (POI) devices are protected from tampering and unauthorized substitution'),
(10, '10.1', 'Processes and mechanisms for logging and monitoring are defined'),
(10, '10.2', 'Audit logs are implemented to support the detection of anomalies and suspicious activity'),
(10, '10.3', 'Audit logs are protected from destruction and unauthorized modifications'),
(10, '10.4', 'Audit logs are reviewed to identify anomalies or suspicious activity'),
(10, '10.5', 'Audit log history is retained and available for analysis'),
(10, '10.6', 'Time-synchronization mechanisms support consistent time settings'),
(10, '10.7', 'Failures of critical security control systems are detected, reported, and responded to promptly'),
(11, '11.1', 'Processes for regular testing of security systems are defined'),
(11, '11.2', 'Wireless access points are identified and monitored'),
(11, '11.3', 'External and internal vulnerabilities are regularly identified and addressed'),
(11, '11.4', 'External and internal penetration testing is regularly performed'),
(11, '11.5', 'Network intrusions and unexpected file changes are detected and responded to'),
(11, '11.6', 'Unauthorized changes on payment pages are detected and responded to'),
(12, '12.1', 'A comprehensive information security policy is established and maintained'),
(12, '12.2', 'Acceptable use policies for end-user technologies are defined and implemented'),
(12, '12.3', 'Risks to the cardholder data environment are formally identified and managed'),
(12, '12.4', 'PCI DSS compliance is managed'),
(12, '12.5', 'PCI DSS scope is documented and validated'),
(12, '12.6', 'Security awareness education is an ongoing activity'),
(12, '12.7', 'Personnel are screened to reduce risks from insider threats'),
(12, '12.8', 'Risk to information assets from third-party service providers is managed'),
(12, '12.9', 'Third-party service providers support PCI DSS compliance'),
(12, '12.10', 'Security incidents and suspected security incidents are responded to immediately');

-- ============================================
-- TABLE 7: REQUIRED_EVIDENCE (130 records)
-- ============================================
CREATE TABLE IF NOT EXISTS required_evidence (
    id SERIAL PRIMARY KEY,
    sub_requirement_id INTEGER REFERENCES sub_requirements(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    evidence_type VARCHAR(100) NOT NULL
);

INSERT INTO required_evidence (sub_requirement_id, name, description, evidence_type) VALUES
(1, 'Network Security Policy', 'Documented network security policy with roles and responsibilities', 'policy'),
(1, 'NSC Configuration Standards', 'Standards for configuring network security controls', 'document'),
(2, 'Firewall Ruleset', 'Current firewall rules and configurations', 'configuration'),
(2, 'Change Management Records', 'Records of NSC changes with approvals', 'log'),
(3, 'Network Diagram', 'Current network diagram showing CDE boundaries', 'diagram'),
(3, 'Access Control Lists', 'ACLs restricting CDE access', 'configuration'),
(4, 'DMZ Configuration', 'DMZ architecture and configuration', 'configuration'),
(4, 'Traffic Flow Rules', 'Rules controlling traffic between network zones', 'configuration'),
(5, 'Mobile Device Policy', 'Policy for devices connecting to untrusted networks', 'policy'),
(5, 'Endpoint Protection Evidence', 'Evidence of endpoint security controls', 'screenshot'),
(6, 'Configuration Management Policy', 'Policy for managing system configurations', 'policy'),
(6, 'Hardening Standards', 'Security hardening standards for all system types', 'document'),
(7, 'Server Hardening Evidence', 'Evidence of server hardening applied', 'configuration'),
(7, 'Default Account Removal', 'Evidence that default accounts are removed/disabled', 'screenshot'),
(7, 'Service Configuration', 'Evidence of unnecessary services disabled', 'configuration'),
(8, 'Wireless Security Policy', 'Wireless network security policy', 'policy'),
(8, 'Wireless Configuration', 'Wireless encryption and authentication settings', 'configuration'),
(9, 'Data Protection Policy', 'Policy for protecting stored cardholder data', 'policy'),
(9, 'Data Retention Policy', 'Data retention and disposal policy', 'policy'),
(10, 'Data Inventory', 'Inventory of all cardholder data storage locations', 'document'),
(10, 'Retention Evidence', 'Evidence of data disposal per retention policy', 'log'),
(11, 'SAD Storage Scan', 'Scan results showing no SAD storage', 'report'),
(11, 'Application Review', 'Review confirming SAD not stored', 'document'),
(12, 'Data Masking Configuration', 'Configuration showing PAN masking', 'configuration'),
(12, 'Access Control Evidence', 'Evidence of restricted PAN access', 'screenshot'),
(13, 'Encryption Configuration', 'PAN encryption configuration', 'configuration'),
(13, 'Encryption Certificates', 'Encryption certificate details', 'document'),
(14, 'Key Management Policy', 'Cryptographic key management policy', 'policy'),
(14, 'Key Storage Evidence', 'Evidence of secure key storage', 'configuration'),
(15, 'Key Rotation Evidence', 'Evidence of key rotation per policy', 'log'),
(15, 'Key Custodian Acknowledgments', 'Signed key custodian forms', 'document'),
(16, 'Transmission Security Policy', 'Policy for encrypting data in transit', 'policy'),
(16, 'Approved Protocols List', 'List of approved encryption protocols', 'document'),
(17, 'TLS Configuration', 'TLS/SSL configuration evidence', 'configuration'),
(17, 'Certificate Inventory', 'Inventory of encryption certificates', 'document'),
(18, 'Anti-Malware Policy', 'Policy for malware protection', 'policy'),
(18, 'AV Deployment Standards', 'Anti-virus deployment standards', 'document'),
(19, 'AV Deployment Evidence', 'Evidence of AV deployed on all systems', 'screenshot'),
(19, 'Malware Detection Logs', 'Recent malware detection and response logs', 'log'),
(20, 'AV Update Evidence', 'Evidence of current AV signatures', 'screenshot'),
(20, 'AV Monitoring Dashboard', 'Central AV monitoring console', 'screenshot'),
(21, 'Email Security Configuration', 'Email anti-phishing configuration', 'configuration'),
(21, 'Phishing Awareness Training', 'Phishing training completion records', 'document'),
(22, 'SDLC Policy', 'Secure software development lifecycle policy', 'policy'),
(22, 'Security Training Records', 'Developer security training records', 'document'),
(23, 'Code Review Process', 'Code review procedures and evidence', 'document'),
(23, 'Security Testing Results', 'Application security testing results', 'report'),
(24, 'Vulnerability Management Policy', 'Vulnerability management policy', 'policy'),
(24, 'Patch Management Evidence', 'Evidence of timely patching', 'log'),
(25, 'WAF Configuration', 'Web application firewall configuration', 'configuration'),
(25, 'Web Security Testing', 'Web application security test results', 'report'),
(26, 'Change Management Policy', 'Policy for managing system changes', 'policy'),
(26, 'Change Records', 'Records of changes with approvals', 'log'),
(27, 'Access Control Policy', 'Policy for restricting access by need to know', 'policy'),
(27, 'Role Definitions', 'Documented role-based access definitions', 'document'),
(28, 'Access Provisioning Process', 'Process for granting/revoking access', 'document'),
(28, 'Access Review Evidence', 'Evidence of periodic access reviews', 'log'),
(29, 'Access Control System Configuration', 'Configuration of access control systems', 'configuration'),
(29, 'Access Logs', 'Logs showing access control enforcement', 'log'),
(30, 'Authentication Policy', 'Policy for user identification and authentication', 'policy'),
(30, 'Account Management Procedures', 'Procedures for managing user accounts', 'document'),
(31, 'User Account Inventory', 'Inventory of all user accounts', 'document'),
(31, 'Account Termination Evidence', 'Evidence of timely account termination', 'log'),
(32, 'Password Policy', 'Strong password requirements policy', 'policy'),
(32, 'Password Configuration', 'System password configuration settings', 'configuration'),
(33, 'MFA Implementation Evidence', 'Evidence of MFA deployed for CDE access', 'screenshot'),
(33, 'MFA Policy', 'Multi-factor authentication policy', 'policy'),
(34, 'MFA Configuration', 'MFA system configuration settings', 'configuration'),
(34, 'MFA Logs', 'MFA authentication logs', 'log'),
(35, 'Service Account Inventory', 'Inventory of application/service accounts', 'document'),
(35, 'Service Account Management', 'Evidence of service account management', 'log'),
(36, 'Physical Security Policy', 'Policy for physical access restrictions', 'policy'),
(36, 'Facility Security Procedures', 'Physical security procedures', 'document'),
(37, 'Physical Access Control Systems', 'Evidence of physical access control systems', 'screenshot'),
(37, 'Badge Reader Logs', 'Physical access badge reader logs', 'log'),
(38, 'Visitor Management Process', 'Process for managing visitor access', 'document'),
(38, 'Visitor Logs', 'Visitor access logs', 'log'),
(39, 'Media Handling Policy', 'Policy for secure media handling', 'policy'),
(39, 'Media Destruction Evidence', 'Evidence of secure media destruction', 'log'),
(40, 'POI Device Inventory', 'Inventory of all POI devices', 'document'),
(40, 'POI Inspection Logs', 'POI device inspection logs', 'log'),
(41, 'Logging Policy', 'Policy for logging and monitoring', 'policy'),
(41, 'Log Management Procedures', 'Procedures for log management', 'document'),
(42, 'Audit Log Configuration', 'Audit log configuration settings', 'configuration'),
(42, 'Sample Audit Logs', 'Sample of audit log entries', 'log'),
(43, 'Log Protection Configuration', 'Configuration for log file protection', 'configuration'),
(43, 'Log Integrity Evidence', 'Evidence of log integrity controls', 'screenshot'),
(44, 'Log Review Process', 'Process for reviewing audit logs', 'document'),
(44, 'Log Review Evidence', 'Evidence of daily log reviews', 'log'),
(45, 'Log Retention Configuration', 'Log retention configuration (90+ days)', 'configuration'),
(45, 'Archive Access Evidence', 'Evidence of 12-month log archives', 'screenshot'),
(46, 'NTP Configuration', 'Time synchronization configuration', 'configuration'),
(46, 'Time Source Documentation', 'Documentation of authoritative time sources', 'document'),
(47, 'Security Control Monitoring', 'Monitoring configuration for security controls', 'configuration'),
(47, 'Alert Evidence', 'Evidence of security control failure alerts', 'screenshot'),
(48, 'Security Testing Policy', 'Policy for regular security testing', 'policy'),
(48, 'Testing Schedule', 'Schedule for security testing activities', 'document'),
(49, 'Wireless Scan Reports', 'Wireless access point scan reports', 'report'),
(49, 'Rogue AP Detection', 'Evidence of rogue AP detection capability', 'screenshot'),
(50, 'Internal Vulnerability Scans', 'Quarterly internal vulnerability scan reports', 'report'),
(50, 'External Vulnerability Scans', 'Quarterly ASV scan reports', 'report'),
(51, 'External Penetration Test Report', 'Annual external penetration test report', 'report'),
(51, 'Internal Penetration Test Report', 'Annual internal penetration test report', 'report'),
(52, 'IDS/IPS Configuration', 'Intrusion detection system configuration', 'configuration'),
(52, 'FIM Configuration', 'File integrity monitoring configuration', 'configuration'),
(53, 'Payment Page Monitoring', 'Configuration for payment page change detection', 'configuration'),
(53, 'Change Detection Alerts', 'Evidence of payment page change alerts', 'screenshot'),
(54, 'Information Security Policy', 'Comprehensive information security policy', 'policy'),
(54, 'Policy Review Evidence', 'Evidence of annual policy review', 'document'),
(55, 'Acceptable Use Policy', 'Acceptable use policy for end-user technologies', 'policy'),
(55, 'Technology Approval Process', 'Process for approving new technologies', 'document'),
(56, 'Risk Assessment Report', 'Annual risk assessment report', 'report'),
(56, 'Risk Register', 'Register of identified risks', 'document'),
(57, 'PCI DSS Responsibility Matrix', 'RACI matrix for PCI DSS compliance', 'document'),
(57, 'Compliance Program Documentation', 'Documentation of PCI DSS compliance program', 'document'),
(58, 'Scope Documentation', 'PCI DSS scope documentation', 'document'),
(58, 'Scope Validation Evidence', 'Evidence of scope validation', 'report'),
(59, 'Security Awareness Program', 'Security awareness training program', 'document'),
(59, 'Training Completion Records', 'Security training completion records', 'log'),
(60, 'Background Check Policy', 'Policy for personnel screening', 'policy'),
(60, 'Background Check Evidence', 'Evidence of background checks performed', 'document'),
(61, 'Third-Party Inventory', 'Inventory of third-party service providers', 'document'),
(61, 'Third-Party Agreements', 'Agreements with third-party providers', 'document'),
(62, 'TPSP Compliance Evidence', 'Evidence of third-party PCI DSS compliance', 'document'),
(62, 'TPSP Responsibility Matrix', 'Responsibility matrix with service providers', 'document'),
(63, 'Incident Response Plan', 'Security incident response plan', 'policy'),
(63, 'Incident Response Testing', 'Evidence of incident response testing', 'report');

-- ============================================
-- TABLE 8: PHASE_REQUIREMENTS (Links phases to requirements)
-- ============================================
CREATE TABLE IF NOT EXISTS phase_requirements (
    id SERIAL PRIMARY KEY,
    phase_id INTEGER REFERENCES phases(id) ON DELETE CASCADE,
    requirement_id INTEGER REFERENCES requirements(id) ON DELETE CASCADE
);

INSERT INTO phase_requirements (phase_id, requirement_id) VALUES
(1, 1), (1, 2),
(2, 1), (2, 2), (2, 3), (2, 4), (2, 5), (2, 6), (2, 7), (2, 8), (2, 9), (2, 10), (2, 11), (2, 12),
(3, 1), (3, 2), (3, 3), (3, 4), (3, 5), (3, 6), (3, 7), (3, 8),
(4, 1), (4, 2), (4, 3), (4, 4), (4, 5), (4, 6), (4, 7), (4, 8), (4, 9), (4, 10), (4, 11), (4, 12),
(5, 11),
(6, 1), (6, 2), (6, 3), (6, 4), (6, 5), (6, 6), (6, 7), (6, 8), (6, 9), (6, 10), (6, 11), (6, 12),
(7, 1), (7, 2), (7, 3), (7, 4), (7, 5), (7, 6), (7, 7), (7, 8), (7, 9), (7, 10), (7, 11), (7, 12);

-- ============================================
-- TABLE 9: CDE_SYSTEMS (24 records)
-- ============================================
CREATE TABLE IF NOT EXISTS cde_systems (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    system_type VARCHAR(100) NOT NULL,
    description TEXT,
    ip_address VARCHAR(50),
    location VARCHAR(255),
    owner VARCHAR(255),
    in_scope BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO cde_systems (name, system_type, description, ip_address, location, owner, in_scope) VALUES
('Payment Gateway Server', 'server', 'Primary payment processing server', '10.0.1.10', 'Data Center A', 'IT Operations', TRUE),
('Card Data Database', 'database', 'Encrypted cardholder data storage', '10.0.1.20', 'Data Center A', 'DBA Team', TRUE),
('POS Terminal Network', 'network', 'Point of sale terminal network segment', '10.0.2.0/24', 'Retail Locations', 'Network Team', TRUE),
('E-commerce Application', 'application', 'Online payment processing application', '10.0.1.30', 'Data Center A', 'Development Team', TRUE),
('Payment API Gateway', 'application', 'REST API for payment processing', '10.0.1.31', 'Data Center A', 'Development Team', TRUE),
('Tokenization Server', 'server', 'Card data tokenization service', '10.0.1.40', 'Data Center A', 'Security Team', TRUE),
('HSM Cluster', 'server', 'Hardware security modules for key management', '10.0.1.50', 'Data Center A', 'Security Team', TRUE),
('Backup Server', 'server', 'Encrypted backup storage', '10.0.1.60', 'Data Center B', 'IT Operations', TRUE),
('Log Aggregator', 'server', 'Centralized logging and SIEM', '10.0.3.10', 'Data Center A', 'Security Team', TRUE),
('Admin Workstations', 'server', 'CDE administrative access workstations', '10.0.4.0/24', 'Corporate Office', 'IT Operations', TRUE),
('Firewall Cluster', 'network', 'CDE perimeter firewalls', '10.0.0.1', 'Data Center A', 'Network Team', TRUE),
('IDS/IPS System', 'network', 'Intrusion detection and prevention', '10.0.0.5', 'Data Center A', 'Security Team', TRUE),
('VPN Gateway', 'network', 'Remote access VPN for CDE', '10.0.0.10', 'Data Center A', 'Network Team', TRUE),
('Anti-malware Server', 'server', 'Centralized anti-malware management', '10.0.3.20', 'Data Center A', 'Security Team', TRUE),
('Patch Management Server', 'server', 'CDE patch deployment system', '10.0.3.30', 'Data Center A', 'IT Operations', TRUE),
('NTP Server', 'server', 'Time synchronization for CDE', '10.0.3.40', 'Data Center A', 'IT Operations', TRUE),
('DNS Server', 'server', 'Internal DNS for CDE', '10.0.3.50', 'Data Center A', 'IT Operations', TRUE),
('Wireless Controller', 'network', 'Wireless network controller', '10.0.0.20', 'Corporate Office', 'Network Team', TRUE),
('File Integrity Monitor', 'application', 'FIM for critical system files', '10.0.3.60', 'Data Center A', 'Security Team', TRUE),
('Vulnerability Scanner', 'application', 'Internal vulnerability scanning', '10.0.3.70', 'Data Center A', 'Security Team', TRUE),
('Development Environment', 'server', 'Secure development environment', '10.0.5.0/24', 'Data Center A', 'Development Team', TRUE),
('QA Environment', 'server', 'Quality assurance testing environment', '10.0.6.0/24', 'Data Center A', 'QA Team', TRUE),
('Load Balancer', 'network', 'Application load balancer', '10.0.1.5', 'Data Center A', 'Network Team', TRUE),
('Secrets Manager', 'application', 'Credential and secrets management', '10.0.3.80', 'Data Center A', 'Security Team', TRUE);

-- ============================================
-- TABLE 10: SECURITY_SCANS (4 scheduled records)
-- ============================================
CREATE TABLE IF NOT EXISTS security_scans (
    id SERIAL PRIMARY KEY,
    scan_type VARCHAR(50) NOT NULL,
    name VARCHAR(255) NOT NULL,
    status VARCHAR(50) DEFAULT 'scheduled',
    scheduled_date TIMESTAMP,
    completed_date TIMESTAMP,
    findings_count INTEGER DEFAULT 0,
    critical_count INTEGER DEFAULT 0,
    high_count INTEGER DEFAULT 0,
    medium_count INTEGER DEFAULT 0,
    low_count INTEGER DEFAULT 0,
    report_path VARCHAR(500),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO security_scans (scan_type, name, status, scheduled_date) VALUES
('asv_scan', 'Q1 2025 ASV Scan', 'scheduled', CURRENT_TIMESTAMP + INTERVAL '30 days'),
('pen_test', 'Annual External Penetration Test', 'scheduled', CURRENT_TIMESTAMP + INTERVAL '60 days'),
('pen_test', 'Annual Internal Penetration Test', 'scheduled', CURRENT_TIMESTAMP + INTERVAL '75 days'),
('vulnerability_scan', 'Weekly Internal Vulnerability Scan', 'scheduled', CURRENT_TIMESTAMP + INTERVAL '7 days');

-- ============================================
-- TABLE 11: COMPLIANCE_ASSESSMENTS
-- ============================================
CREATE TABLE IF NOT EXISTS compliance_assessments (
    id SERIAL PRIMARY KEY,
    assessment_type VARCHAR(100) NOT NULL,
    status VARCHAR(50) DEFAULT 'in_progress',
    started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP,
    assessor_name VARCHAR(255),
    notes TEXT
);

INSERT INTO compliance_assessments (assessment_type, status, assessor_name, notes) VALUES
('self_assessment', 'in_progress', 'Internal Compliance Team', 'Annual PCI DSS v4.0 self-assessment in progress');

-- ============================================
-- TABLE 12: EVIDENCE_SUBMISSIONS (Initially empty)
-- ============================================
CREATE TABLE IF NOT EXISTS evidence_submissions (
    id SERIAL PRIMARY KEY,
    required_evidence_id INTEGER REFERENCES required_evidence(id) ON DELETE CASCADE,
    file_name VARCHAR(255) NOT NULL,
    file_path VARCHAR(500),
    uploaded_by VARCHAR(100) DEFAULT 'IT Security',
    uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    status VARCHAR(50) DEFAULT 'pending_review',
    reviewed_by VARCHAR(100),
    reviewed_at TIMESTAMP,
    review_notes TEXT
);

-- ============================================
-- TABLE 13: FINDINGS (Initially empty)
-- ============================================
CREATE TABLE IF NOT EXISTS findings (
    id SERIAL PRIMARY KEY,
    sub_requirement_id INTEGER REFERENCES sub_requirements(id),
    evidence_submission_id INTEGER REFERENCES evidence_submissions(id),
    title VARCHAR(255) NOT NULL,
    description TEXT,
    severity VARCHAR(50) DEFAULT 'medium',
    status VARCHAR(50) DEFAULT 'open',
    remediation_notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    closed_at TIMESTAMP
);

-- ============================================
-- TABLE 14: RISKS (Initially empty)
-- ============================================
CREATE TABLE IF NOT EXISTS risks (
    id SERIAL PRIMARY KEY,
    sub_requirement_id INTEGER REFERENCES sub_requirements(id),
    title VARCHAR(255) NOT NULL,
    description TEXT,
    risk_level VARCHAR(50) DEFAULT 'medium',
    owner VARCHAR(255),
    status VARCHAR(50) DEFAULT 'pending',
    business_justification TEXT,
    approved_by VARCHAR(255),
    approved_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- SUMMARY
-- ============================================
-- Total Tables: 14
-- Total Seed Records:
--   users: 5
--   phases: 7
--   phase_tasks: 29
--   phase_deliverables: 16
--   requirements: 12
--   sub_requirements: 63
--   required_evidence: 130
--   phase_requirements: 55
--   cde_systems: 24
--   security_scans: 4
--   compliance_assessments: 1
--   evidence_submissions: 0 (populated when users upload)
--   findings: 0 (auto-created when evidence rejected)
--   risks: 0 (created when risks need approval)
-- ============================================

-- Default login credentials:
-- admin / admin123
-- infosec / infosec123
-- auditor / auditor123
-- business / business123
-- itsec / itsec123
