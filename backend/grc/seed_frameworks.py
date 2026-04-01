"""
Framework Seeder for GRC Platform

This module provides functionality to seed frameworks from JSON files into the database.
It supports both the new UploadedFramework/ParsedFrameworkControl models (for uploaded frameworks)
and the legacy Framework hierarchy models.

Usage:
    from grc.seed_frameworks import seed_uploaded_frameworks, seed_frameworks
    
    # Seed from JSON files (recommended)
    seed_uploaded_frameworks()
    
    # Legacy seeding (deprecated)
    seed_frameworks()
"""

import json
import os
from datetime import datetime
from typing import Optional, List, Dict, Any

from .models import (
    SessionLocal, Framework, FrameworkDomain, ControlObjective,
    FrameworkControl, FrameworkSubControl, NormalizedControl,
    ControlMapping, GRCRequiredEvidence,
    UploadedFramework, ParsedFrameworkControl, Tenant,
    ControlEvidenceRequirement
)


def _determine_control_attributes(control_name, control_statement):
    """Determine risk_category, evidence_type, and control_objective based on control content."""
    name_lower = control_name.lower() if control_name else ""
    statement_lower = control_statement.lower() if control_statement else ""
    combined = f"{name_lower} {statement_lower}"
    
    risk_category = "security"
    evidence_type = "policy"
    control_objective = control_statement[:200] if control_statement else f"Ensure {control_name} requirements are met"
    
    if any(kw in combined for kw in ["access control", "access management", "authentication", "mfa", "multi-factor", 
                                      "identity", "password", "privileged", "user id", "user access", "rbac", "iam"]):
        risk_category = "security"
        evidence_type = "configuration"
        control_objective = "Control access to systems and data through authentication and authorization mechanisms"
    
    elif any(kw in combined for kw in ["encryption", "cryptograph", "key management", "tls", "ssl", "cipher", "hashing"]):
        risk_category = "security"
        evidence_type = "configuration"
        control_objective = "Protect data confidentiality through cryptographic controls"
    
    elif any(kw in combined for kw in ["firewall", "network security", "network segment", "ids", "ips", "intrusion", 
                                        "perimeter", "traffic", "network control"]):
        risk_category = "security"
        evidence_type = "configuration"
        control_objective = "Protect network infrastructure from unauthorized access and attacks"
    
    elif any(kw in combined for kw in ["log", "monitor", "audit trail", "siem", "detect", "alert", "event"]):
        risk_category = "operational"
        evidence_type = "log"
        control_objective = "Detect security events through monitoring and logging"
    
    elif any(kw in combined for kw in ["incident", "response", "breach", "csirt", "forensic"]):
        risk_category = "operational"
        evidence_type = "procedure"
        control_objective = "Respond effectively to security incidents"
    
    elif any(kw in combined for kw in ["backup", "recovery", "disaster", "business continuity", "bcp", "dr ", "restore"]):
        risk_category = "operational"
        evidence_type = "procedure"
        control_objective = "Ensure business continuity and recovery capabilities"
    
    elif any(kw in combined for kw in ["vulnerability", "scan", "patch", "pentest", "penetration test"]):
        risk_category = "security"
        evidence_type = "report"
        control_objective = "Identify and remediate security vulnerabilities"
    
    elif any(kw in combined for kw in ["policy", "policies", "procedure", "governance", "strategy", "framework"]):
        risk_category = "compliance"
        evidence_type = "policy"
        control_objective = "Establish governance and policy framework"
    
    elif any(kw in combined for kw in ["training", "awareness", "education"]):
        risk_category = "compliance"
        evidence_type = "record"
        control_objective = "Ensure personnel understand security responsibilities"
    
    elif any(kw in combined for kw in ["vendor", "supplier", "third party", "outsource", "contract"]):
        risk_category = "strategic"
        evidence_type = "report"
        control_objective = "Manage third-party and vendor security risks"
    
    elif any(kw in combined for kw in ["physical", "facility", "entry", "badge", "cctv", "environment"]):
        risk_category = "security"
        evidence_type = "record"
        control_objective = "Protect physical assets and facilities"
    
    elif any(kw in combined for kw in ["malware", "antivirus", "anti-malware", "endpoint"]):
        risk_category = "security"
        evidence_type = "configuration"
        control_objective = "Protect systems from malicious software"
    
    elif any(kw in combined for kw in ["configuration", "hardening", "baseline", "standard"]):
        risk_category = "security"
        evidence_type = "configuration"
        control_objective = "Ensure secure system configurations"
    
    elif any(kw in combined for kw in ["change management", "change control"]):
        risk_category = "operational"
        evidence_type = "record"
        control_objective = "Control and document system changes"
    
    elif any(kw in combined for kw in ["asset", "inventory", "classification", "cmdb"]):
        risk_category = "operational"
        evidence_type = "record"
        control_objective = "Maintain accurate asset inventory and classification"
    
    elif any(kw in combined for kw in ["risk", "assessment", "treatment"]):
        risk_category = "strategic"
        evidence_type = "report"
        control_objective = "Identify and manage security risks"
    
    elif any(kw in combined for kw in ["compliance", "audit", "review", "regulatory"]):
        risk_category = "compliance"
        evidence_type = "report"
        control_objective = "Ensure regulatory and standards compliance"
    
    elif any(kw in combined for kw in ["development", "sdlc", "code", "application"]):
        risk_category = "security"
        evidence_type = "procedure"
        control_objective = "Ensure secure software development practices"
    
    elif any(kw in combined for kw in ["board", "ciso", "committee", "management"]):
        risk_category = "strategic"
        evidence_type = "record"
        control_objective = "Establish security leadership and oversight"
    
    elif any(kw in combined for kw in ["data", "pii", "privacy", "retention", "disposal"]):
        risk_category = "compliance"
        evidence_type = "procedure"
        control_objective = "Protect sensitive data throughout its lifecycle"
    
    return risk_category, evidence_type, control_objective


def seed_frameworks():
    """
    DEPRECATED: Pre-seeded frameworks have been removed from the system.
    Users should now upload their own framework documents via the Framework Upload feature.
    """
    print("Pre-seeded frameworks disabled. Use Framework Upload to add frameworks.")
    return
    
    # Legacy code below - kept for reference but never executed
    db = SessionLocal()
    try:
        existing = db.query(Framework).first()
        if existing:
            print("Frameworks already seeded, skipping...")
            return
        
        print("Seeding regulatory frameworks...")
        
        normalized_controls = _seed_normalized_controls(db)
        
        framework_controls = {}
        
        framework_controls["PCI_DSS"] = _seed_pci_dss(db)
        framework_controls["ISO_27001"] = _seed_iso_27001(db)
        framework_controls["ISO_20000"] = _seed_iso_20000(db)
        framework_controls["NIST_CSF"] = _seed_nist_csf(db)
        framework_controls["SWIFT_CSF"] = _seed_swift_csp(db)
        framework_controls["CBB"] = _seed_cbb(db)
        framework_controls["SAMA"] = _seed_sama(db)
        framework_controls["SBP"] = _seed_sbp(db)
        
        _seed_control_mappings(db, normalized_controls, framework_controls)
        
        _seed_required_evidence(db, normalized_controls)
        
        db.commit()
        print("Successfully seeded all frameworks and controls!")
        
    except Exception as e:
        db.rollback()
        print(f"Error seeding frameworks: {e}")
        raise
    finally:
        db.close()


def _seed_normalized_controls(db):
    """Create normalized controls that map across frameworks."""
    controls_data = [
        {
            "code": "NC-AC-001",
            "name": "Access Control Policy",
            "statement": "Establish and maintain an access control policy that addresses purpose, scope, roles, responsibilities, and compliance.",
            "objective": "Ensure access to systems and data is controlled based on business and security requirements.",
            "control_owner": "Information Security",
            "implementation_guidance": "Define access control requirements, document the policy, obtain management approval, and communicate to all personnel.",
            "testing_guidance": "Review policy documentation, verify approval signatures, confirm distribution to relevant stakeholders."
        },
        {
            "code": "NC-AC-002",
            "name": "User Access Provisioning",
            "statement": "Implement a formal user registration and de-registration process to enable assignment of access rights.",
            "objective": "Ensure only authorized users have access to systems and information.",
            "control_owner": "IT Operations",
            "implementation_guidance": "Establish access request workflow, approval process, and access provisioning procedures.",
            "testing_guidance": "Sample access requests and verify proper authorization and documentation."
        },
        {
            "code": "NC-AC-003",
            "name": "Privileged Access Management",
            "statement": "Restrict and control allocation and use of privileged access rights.",
            "objective": "Minimize risk from misuse of privileged accounts.",
            "control_owner": "Information Security",
            "implementation_guidance": "Implement PAM solution, require approval for privileged access, log all privileged activities.",
            "testing_guidance": "Review privileged account inventory, test approval workflow, examine activity logs."
        },
        {
            "code": "NC-AC-004",
            "name": "Authentication Management",
            "statement": "Implement strong authentication mechanisms including multi-factor authentication for sensitive systems.",
            "objective": "Verify user identity before granting access.",
            "control_owner": "Information Security",
            "implementation_guidance": "Deploy MFA for remote access, privileged accounts, and sensitive systems. Enforce password complexity.",
            "testing_guidance": "Test MFA functionality, review authentication logs, verify password policies."
        },
        {
            "code": "NC-CM-001",
            "name": "Configuration Management",
            "statement": "Establish and maintain configuration baselines for all IT systems.",
            "objective": "Ensure systems are configured securely and consistently.",
            "control_owner": "IT Operations",
            "implementation_guidance": "Define hardening standards, implement configuration management tools, document baselines.",
            "testing_guidance": "Compare live configurations against baselines, review change records."
        },
        {
            "code": "NC-CM-002",
            "name": "Change Management",
            "statement": "Implement formal change management processes for all IT systems.",
            "objective": "Ensure changes are authorized, documented, and do not adversely affect security.",
            "control_owner": "IT Operations",
            "implementation_guidance": "Establish CAB, define change categories, implement approval workflow, maintain change log.",
            "testing_guidance": "Review change records, verify approvals, test rollback procedures."
        },
        {
            "code": "NC-DP-001",
            "name": "Data Classification",
            "statement": "Classify information according to sensitivity and criticality.",
            "objective": "Ensure appropriate protection is applied based on data sensitivity.",
            "control_owner": "Information Security",
            "implementation_guidance": "Define classification levels, create labeling procedures, train personnel.",
            "testing_guidance": "Review classification scheme, verify labeling compliance, test handling procedures."
        },
        {
            "code": "NC-DP-002",
            "name": "Data Encryption",
            "statement": "Encrypt sensitive data at rest and in transit using approved cryptographic methods.",
            "objective": "Protect data confidentiality from unauthorized disclosure.",
            "control_owner": "Information Security",
            "implementation_guidance": "Implement TLS 1.2+, AES-256 for data at rest, manage encryption keys securely.",
            "testing_guidance": "Verify encryption implementation, test certificate validity, review key management."
        },
        {
            "code": "NC-DP-003",
            "name": "Data Loss Prevention",
            "statement": "Implement controls to prevent unauthorized disclosure of sensitive information.",
            "objective": "Detect and prevent data exfiltration attempts.",
            "control_owner": "Information Security",
            "implementation_guidance": "Deploy DLP tools, define sensitive data patterns, configure alerting and blocking.",
            "testing_guidance": "Test DLP rules, review blocked transmissions, verify alert effectiveness."
        },
        {
            "code": "NC-NS-001",
            "name": "Network Segmentation",
            "statement": "Segment networks to limit scope of compromise and control data flows.",
            "objective": "Reduce attack surface and contain security incidents.",
            "control_owner": "Network Security",
            "implementation_guidance": "Define network zones, implement firewalls, document allowed traffic flows.",
            "testing_guidance": "Review network diagrams, test firewall rules, verify segmentation effectiveness."
        },
        {
            "code": "NC-NS-002",
            "name": "Firewall Management",
            "statement": "Implement and manage firewalls to control network traffic.",
            "objective": "Prevent unauthorized network access.",
            "control_owner": "Network Security",
            "implementation_guidance": "Deploy perimeter and internal firewalls, implement deny-by-default, review rules quarterly.",
            "testing_guidance": "Review firewall rule sets, test rule effectiveness, verify logging."
        },
        {
            "code": "NC-VM-001",
            "name": "Vulnerability Management",
            "statement": "Identify, assess, and remediate vulnerabilities in a timely manner.",
            "objective": "Reduce exposure to known vulnerabilities.",
            "control_owner": "Information Security",
            "implementation_guidance": "Conduct regular scans, prioritize by risk, track remediation, verify fixes.",
            "testing_guidance": "Review scan reports, verify patch status, test remediation effectiveness."
        },
        {
            "code": "NC-VM-002",
            "name": "Patch Management",
            "statement": "Apply security patches within defined timeframes based on criticality.",
            "objective": "Keep systems protected against known vulnerabilities.",
            "control_owner": "IT Operations",
            "implementation_guidance": "Define patching SLAs, test patches before deployment, maintain patch inventory.",
            "testing_guidance": "Review patch compliance reports, verify deployment timeframes."
        },
        {
            "code": "NC-IR-001",
            "name": "Incident Response Plan",
            "statement": "Establish and maintain an incident response capability.",
            "objective": "Effectively detect, respond to, and recover from security incidents.",
            "control_owner": "Information Security",
            "implementation_guidance": "Define incident categories, establish response team, document procedures, conduct exercises.",
            "testing_guidance": "Review IR plan, verify team training, evaluate exercise results."
        },
        {
            "code": "NC-IR-002",
            "name": "Security Monitoring",
            "statement": "Implement security monitoring to detect security events.",
            "objective": "Identify security events and anomalies promptly.",
            "control_owner": "Security Operations",
            "implementation_guidance": "Deploy SIEM, define use cases, configure alerting, establish 24/7 monitoring.",
            "testing_guidance": "Review SIEM coverage, test detection rules, verify alert response times."
        },
        {
            "code": "NC-BC-001",
            "name": "Business Continuity Planning",
            "statement": "Develop and maintain business continuity plans for critical functions.",
            "objective": "Ensure continuation of critical business operations during disruption.",
            "control_owner": "Business Continuity",
            "implementation_guidance": "Conduct BIA, develop recovery strategies, document BCP, test annually.",
            "testing_guidance": "Review BCP documentation, verify test results, assess recovery capabilities."
        },
        {
            "code": "NC-BC-002",
            "name": "Backup and Recovery",
            "statement": "Implement backup procedures and test recovery capabilities.",
            "objective": "Ensure data can be restored when needed.",
            "control_owner": "IT Operations",
            "implementation_guidance": "Define backup schedules, implement 3-2-1 rule, test restores regularly.",
            "testing_guidance": "Review backup logs, test recovery procedures, verify RTO/RPO compliance."
        },
        {
            "code": "NC-TP-001",
            "name": "Third Party Risk Management",
            "statement": "Assess and monitor security risks from third party providers.",
            "objective": "Ensure third parties meet security requirements.",
            "control_owner": "Vendor Management",
            "implementation_guidance": "Conduct vendor assessments, include security in contracts, monitor continuously.",
            "testing_guidance": "Review vendor assessments, verify contractual requirements, evaluate monitoring."
        },
        {
            "code": "NC-SA-001",
            "name": "Security Awareness Training",
            "statement": "Provide security awareness training to all personnel.",
            "objective": "Ensure personnel understand security responsibilities.",
            "control_owner": "Information Security",
            "implementation_guidance": "Develop training program, conduct annual training, track completion, test effectiveness.",
            "testing_guidance": "Review training materials, verify completion rates, assess knowledge retention."
        },
        {
            "code": "NC-GV-001",
            "name": "Security Governance",
            "statement": "Establish security governance structure with defined roles and responsibilities.",
            "objective": "Ensure accountability for information security.",
            "control_owner": "CISO",
            "implementation_guidance": "Define governance structure, establish security committee, assign roles, report to board.",
            "testing_guidance": "Review governance charter, verify meeting minutes, assess escalation procedures."
        }
    ]
    
    normalized = {}
    for data in controls_data:
        nc = NormalizedControl(**data)
        db.add(nc)
        db.flush()
        normalized[data["code"]] = nc
    
    return normalized


def _seed_pci_dss(db):
    """Seed PCI DSS v4.0 framework."""
    framework = Framework(
        name="Payment Card Industry Data Security Standard",
        short_code="PCI_DSS",
        regulator="PCI Security Standards Council",
        jurisdiction="Global",
        region="Global",
        version="4.0",
        description="The PCI DSS provides a framework for developing a robust payment card data security process including prevention, detection and appropriate reaction to security incidents.",
        is_mandatory=True,
        enforcement_type="Contractual/Regulatory",
        is_active=True,
        is_custom=False
    )
    db.add(framework)
    db.flush()
    
    controls = {}
    
    domains_data = [
        {
            "code": "D1",
            "name": "Build and Maintain a Secure Network and Systems",
            "description": "Requirements for network security and system configuration",
            "order": 1,
            "objectives": [
                {
                    "code": "1",
                    "name": "Install and Maintain Network Security Controls",
                    "description": "Network security controls restrict traffic between trusted and untrusted networks",
                    "order": 1,
                    "controls": [
                        {"code": "1.1.1", "name": "Define Security Policies", "statement": "All security policies and operational procedures for network security controls are documented, kept current, in use, and known to all affected parties.", "is_mandatory": True, "implementation_guidance": "Document network security policies, procedures, and standards. Ensure regular review and updates.", "testing_guidance": "Review documentation for completeness and currency. Interview personnel to verify awareness."},
                        {"code": "1.2.1", "name": "Define Inbound Traffic Rules", "statement": "Inbound traffic rules are defined, approved, and implemented to restrict traffic to only authorized services.", "is_mandatory": True, "implementation_guidance": "Configure firewalls with explicit deny-all and allow-by-exception rules.", "testing_guidance": "Review firewall configuration, verify rule justification documentation."},
                        {"code": "1.2.8", "name": "Network Security Control Configuration", "statement": "Configuration files for network security controls are secured and synchronized.", "is_mandatory": True, "implementation_guidance": "Implement secure storage for config files, implement version control.", "testing_guidance": "Verify config file access controls, review synchronization procedures."},
                        {"code": "1.3.1", "name": "CDE Network Segmentation", "statement": "Cardholder data flows are identified and network segmentation is implemented.", "is_mandatory": True, "implementation_guidance": "Document all CDE data flows, implement network segmentation.", "testing_guidance": "Review network diagrams, test segmentation controls.", "sub_controls": [
                            {"code": "1.3.1.a", "name": "Document CDE Boundaries", "statement": "CDE boundaries are clearly defined and documented.", "order": 1},
                            {"code": "1.3.1.b", "name": "Implement Segmentation Controls", "statement": "Technical controls enforce CDE segmentation.", "order": 2}
                        ]}
                    ]
                },
                {
                    "code": "2",
                    "name": "Apply Secure Configurations",
                    "description": "Apply secure configurations to all system components",
                    "order": 2,
                    "controls": [
                        {"code": "2.1.1", "name": "Security Hardening Policies", "statement": "Processes and mechanisms for secure configurations are documented, maintained, and followed.", "is_mandatory": True, "implementation_guidance": "Develop hardening standards based on CIS benchmarks.", "testing_guidance": "Review hardening documentation, verify implementation."},
                        {"code": "2.2.1", "name": "Configuration Standards", "statement": "Configuration standards are developed, implemented, and maintained for all system components.", "is_mandatory": True, "implementation_guidance": "Create baseline configurations for all system types.", "testing_guidance": "Compare live systems against baseline configurations."},
                        {"code": "2.2.7", "name": "Encrypt Non-Console Access", "statement": "All non-console administrative access is encrypted using strong cryptography.", "is_mandatory": True, "implementation_guidance": "Implement SSH, TLS for all remote administration.", "testing_guidance": "Verify encryption protocols in use."}
                    ]
                }
            ]
        },
        {
            "code": "D2",
            "name": "Protect Account Data",
            "description": "Requirements for protecting stored and transmitted cardholder data",
            "order": 2,
            "objectives": [
                {
                    "code": "3",
                    "name": "Protect Stored Account Data",
                    "description": "Protection methods such as encryption, truncation, masking, and hashing",
                    "order": 1,
                    "controls": [
                        {"code": "3.1.1", "name": "Data Retention Policies", "statement": "All processes and mechanisms for protecting stored account data are defined and documented.", "is_mandatory": True, "implementation_guidance": "Define data retention periods, document disposal procedures.", "testing_guidance": "Review retention policies, verify disposal evidence."},
                        {"code": "3.4.1", "name": "PAN Rendering Unreadable", "statement": "PAN is rendered unreadable anywhere it is stored using any of the specified methods.", "is_mandatory": True, "implementation_guidance": "Implement tokenization, encryption, or one-way hashing.", "testing_guidance": "Verify PAN protection mechanisms in databases and files.", "sub_controls": [
                            {"code": "3.4.1.a", "name": "Encryption Implementation", "statement": "Strong cryptography with associated key management is implemented.", "order": 1},
                            {"code": "3.4.1.b", "name": "Key Management", "statement": "Cryptographic keys are managed securely.", "order": 2}
                        ]},
                        {"code": "3.5.1", "name": "Secure Key Storage", "statement": "PAN is secured with strong cryptography wherever it is stored.", "is_mandatory": True, "implementation_guidance": "Implement HSM or secure key storage.", "testing_guidance": "Review key management procedures and storage."}
                    ]
                },
                {
                    "code": "4",
                    "name": "Protect Cardholder Data in Transit",
                    "description": "Encrypt transmission over open, public networks",
                    "order": 2,
                    "controls": [
                        {"code": "4.1.1", "name": "Transmission Encryption Policies", "statement": "Processes and mechanisms for protecting cardholder data in transit are defined and documented.", "is_mandatory": True, "implementation_guidance": "Document encryption requirements for all transmission channels.", "testing_guidance": "Review documentation, verify encryption in transit."},
                        {"code": "4.2.1", "name": "Strong Cryptography for Transit", "statement": "Strong cryptography is used during transmission of PAN over open, public networks.", "is_mandatory": True, "implementation_guidance": "Implement TLS 1.2 or higher, disable weak ciphers.", "testing_guidance": "Scan for encryption protocols, verify cipher suites."},
                        {"code": "4.2.2", "name": "Secure Wireless Networks", "statement": "PAN is secured with strong cryptography whenever transmitted wirelessly.", "is_mandatory": True, "implementation_guidance": "Implement WPA3 or WPA2 with AES.", "testing_guidance": "Review wireless configurations, test encryption."}
                    ]
                }
            ]
        },
        {
            "code": "D3",
            "name": "Maintain a Vulnerability Management Program",
            "description": "Requirements for anti-malware and secure development",
            "order": 3,
            "objectives": [
                {
                    "code": "5",
                    "name": "Protect All Systems from Malicious Software",
                    "description": "Deploy anti-malware mechanisms",
                    "order": 1,
                    "controls": [
                        {"code": "5.2.1", "name": "Anti-malware Deployment", "statement": "An anti-malware solution is deployed on all system components except those identified as not commonly targeted.", "is_mandatory": True, "implementation_guidance": "Deploy enterprise antivirus on all endpoints and servers.", "testing_guidance": "Verify anti-malware installation and update status."},
                        {"code": "5.2.2", "name": "Anti-malware Updates", "statement": "Anti-malware solution is kept current via automatic updates.", "is_mandatory": True, "implementation_guidance": "Configure automatic signature updates.", "testing_guidance": "Review update logs and current signatures."},
                        {"code": "5.3.1", "name": "Anti-malware Mechanisms Active", "statement": "Anti-malware mechanisms are actively running and cannot be disabled.", "is_mandatory": True, "implementation_guidance": "Configure tamper protection, prevent user disablement.", "testing_guidance": "Test tamper protection, verify continuous operation."}
                    ]
                },
                {
                    "code": "6",
                    "name": "Develop and Maintain Secure Systems",
                    "description": "Develop applications securely and address vulnerabilities",
                    "order": 2,
                    "controls": [
                        {"code": "6.2.1", "name": "Secure Development Lifecycle", "statement": "Bespoke and custom software is developed securely.", "is_mandatory": True, "implementation_guidance": "Implement SDLC with security gates, code review, SAST/DAST.", "testing_guidance": "Review SDLC documentation, verify security testing."},
                        {"code": "6.3.1", "name": "Vulnerability Identification", "statement": "Security vulnerabilities are identified and managed.", "is_mandatory": True, "implementation_guidance": "Conduct regular vulnerability scans, track remediation.", "testing_guidance": "Review scan reports and remediation evidence.", "sub_controls": [
                            {"code": "6.3.1.a", "name": "Internal Scans", "statement": "Internal vulnerability scans are performed quarterly.", "order": 1},
                            {"code": "6.3.1.b", "name": "External Scans", "statement": "External vulnerability scans are performed by ASV quarterly.", "order": 2}
                        ]},
                        {"code": "6.4.1", "name": "Secure Public-Facing Applications", "statement": "Public-facing web applications are protected against attacks.", "is_mandatory": True, "implementation_guidance": "Deploy WAF, conduct annual penetration testing.", "testing_guidance": "Review WAF configuration, penetration test reports."}
                    ]
                }
            ]
        },
        {
            "code": "D4",
            "name": "Implement Strong Access Control Measures",
            "description": "Requirements for access control and authentication",
            "order": 4,
            "objectives": [
                {
                    "code": "7",
                    "name": "Restrict Access by Business Need",
                    "description": "Limit access to system components and cardholder data",
                    "order": 1,
                    "controls": [
                        {"code": "7.1.1", "name": "Access Control Policies", "statement": "Policies and processes for restricting access to system components are defined and implemented.", "is_mandatory": True, "implementation_guidance": "Define role-based access control policies.", "testing_guidance": "Review access policies, verify implementation."},
                        {"code": "7.2.1", "name": "Need-to-Know Access", "statement": "Access is limited to only the resources necessary for job function.", "is_mandatory": True, "implementation_guidance": "Implement RBAC, define job-role matrices.", "testing_guidance": "Review access rights against job descriptions."},
                        {"code": "7.2.5", "name": "Access Reviews", "statement": "Access to system components is reviewed at least every six months.", "is_mandatory": True, "implementation_guidance": "Establish quarterly/semi-annual access review process.", "testing_guidance": "Review access review documentation and evidence."}
                    ]
                },
                {
                    "code": "8",
                    "name": "Identify Users and Authenticate Access",
                    "description": "Assign unique ID and implement strong authentication",
                    "order": 2,
                    "controls": [
                        {"code": "8.2.1", "name": "Unique User IDs", "statement": "All users are assigned a unique ID before allowing them to access system components.", "is_mandatory": True, "implementation_guidance": "Prohibit shared accounts, implement unique identifiers.", "testing_guidance": "Review user lists for shared or generic accounts."},
                        {"code": "8.3.1", "name": "Strong Authentication", "statement": "All user access is authenticated using at least one of the following factors.", "is_mandatory": True, "implementation_guidance": "Implement strong password policies and MFA.", "testing_guidance": "Review authentication configurations."},
                        {"code": "8.4.2", "name": "MFA for CDE Access", "statement": "MFA is implemented for all access into the CDE.", "is_mandatory": True, "implementation_guidance": "Deploy MFA for all CDE system access.", "testing_guidance": "Test MFA enforcement for CDE access.", "sub_controls": [
                            {"code": "8.4.2.a", "name": "MFA for Console Access", "statement": "MFA is implemented for console access to CDE.", "order": 1},
                            {"code": "8.4.2.b", "name": "MFA for Remote Access", "statement": "MFA is implemented for all remote access to CDE.", "order": 2}
                        ]}
                    ]
                }
            ]
        },
        {
            "code": "D5",
            "name": "Monitor and Test Networks",
            "description": "Requirements for logging, monitoring, and testing",
            "order": 5,
            "objectives": [
                {
                    "code": "10",
                    "name": "Log and Monitor All Access",
                    "description": "Track and monitor all access to network resources and cardholder data",
                    "order": 1,
                    "controls": [
                        {"code": "10.1.1", "name": "Logging Policies", "statement": "Policies and procedures for logging access are defined, documented, and followed.", "is_mandatory": True, "implementation_guidance": "Define logging requirements, retention periods.", "testing_guidance": "Review logging policies and configurations."},
                        {"code": "10.2.1", "name": "Audit Log Events", "statement": "Audit logs are enabled and active for all system components.", "is_mandatory": True, "implementation_guidance": "Enable logging on all in-scope systems, configure SIEM.", "testing_guidance": "Verify logging is active, review sample logs."},
                        {"code": "10.4.1", "name": "Timely Log Review", "statement": "Audit logs are reviewed at least daily.", "is_mandatory": True, "implementation_guidance": "Implement automated log analysis, define review procedures.", "testing_guidance": "Review log analysis records, verify daily reviews."}
                    ]
                },
                {
                    "code": "11",
                    "name": "Test Security Systems Regularly",
                    "description": "Regularly test security systems and processes",
                    "order": 2,
                    "controls": [
                        {"code": "11.3.1", "name": "Internal Vulnerability Scans", "statement": "Internal vulnerability scans are performed at least quarterly.", "is_mandatory": True, "implementation_guidance": "Schedule quarterly internal scans, track remediation.", "testing_guidance": "Review scan reports, verify remediation timelines."},
                        {"code": "11.4.1", "name": "Penetration Testing", "statement": "Penetration testing is performed at least annually and after significant changes.", "is_mandatory": True, "implementation_guidance": "Engage qualified penetration testers, define scope.", "testing_guidance": "Review penetration test reports, verify remediation."},
                        {"code": "11.5.1", "name": "Intrusion Detection", "statement": "Intrusion detection and/or prevention techniques are used to detect and/or prevent intrusions.", "is_mandatory": True, "implementation_guidance": "Deploy IDS/IPS at network perimeter and critical segments.", "testing_guidance": "Review IDS/IPS configurations, test detection capability."}
                    ]
                }
            ]
        },
        {
            "code": "D6",
            "name": "Maintain an Information Security Policy",
            "description": "Requirements for security policies and procedures",
            "order": 6,
            "objectives": [
                {
                    "code": "12",
                    "name": "Support Information Security",
                    "description": "Maintain a policy that addresses information security for all personnel",
                    "order": 1,
                    "controls": [
                        {"code": "12.1.1", "name": "Information Security Policy", "statement": "An overall information security policy is established, published, maintained, and disseminated.", "is_mandatory": True, "implementation_guidance": "Develop comprehensive security policy, obtain management approval.", "testing_guidance": "Review policy documentation, verify distribution."},
                        {"code": "12.6.1", "name": "Security Awareness Program", "statement": "A formal security awareness program is implemented to make all personnel aware of security responsibilities.", "is_mandatory": True, "implementation_guidance": "Develop training program, conduct annual training.", "testing_guidance": "Review training materials, verify completion records."},
                        {"code": "12.10.1", "name": "Incident Response Plan", "statement": "An incident response plan exists and is ready to be activated.", "is_mandatory": True, "implementation_guidance": "Develop IR plan, train team, conduct exercises.", "testing_guidance": "Review IR plan, verify team training, review exercise results."}
                    ]
                }
            ]
        }
    ]
    
    controls = _create_framework_structure(db, framework, domains_data)
    return controls


def _seed_iso_27001(db):
    """Seed ISO 27001:2022 framework."""
    framework = Framework(
        name="ISO/IEC 27001:2022 Information Security Management System",
        short_code="ISO_27001",
        regulator="International Organization for Standardization",
        jurisdiction="Global",
        region="Global",
        version="2022",
        description="ISO/IEC 27001 is an international standard for managing information security. It specifies requirements for establishing, implementing, maintaining and continually improving an information security management system.",
        is_mandatory=False,
        enforcement_type="Certification",
        is_active=True,
        is_custom=False
    )
    db.add(framework)
    db.flush()
    
    domains_data = [
        {
            "code": "A.5",
            "name": "Organizational Controls",
            "description": "Controls related to organizational aspects of information security",
            "order": 1,
            "objectives": [
                {
                    "code": "A.5.1",
                    "name": "Policies for Information Security",
                    "description": "Management direction for information security",
                    "order": 1,
                    "controls": [
                        {"code": "A.5.1.1", "name": "Information Security Policy", "statement": "Information security policy and topic-specific policies shall be defined, approved by management, published, communicated to and acknowledged by relevant personnel and interested parties, and reviewed at planned intervals.", "is_mandatory": True, "implementation_guidance": "Develop security policy aligned with business objectives, obtain board approval.", "testing_guidance": "Review policy documentation, verify approval and communication records."},
                        {"code": "A.5.1.2", "name": "Review of Policies", "statement": "The information security policy shall be reviewed at planned intervals or if significant changes occur.", "is_mandatory": True, "implementation_guidance": "Establish annual review cycle, document review process.", "testing_guidance": "Review revision history, verify review meeting minutes."}
                    ]
                },
                {
                    "code": "A.5.2",
                    "name": "Information Security Roles",
                    "description": "Assignment of information security responsibilities",
                    "order": 2,
                    "controls": [
                        {"code": "A.5.2.1", "name": "Roles and Responsibilities", "statement": "Information security roles and responsibilities shall be defined and allocated.", "is_mandatory": True, "implementation_guidance": "Define RACI matrix for security responsibilities.", "testing_guidance": "Review role definitions, verify assignment records."},
                        {"code": "A.5.2.2", "name": "Segregation of Duties", "statement": "Conflicting duties and areas of responsibility shall be segregated.", "is_mandatory": True, "implementation_guidance": "Identify conflicting duties, implement separation.", "testing_guidance": "Review access matrices, verify segregation."}
                    ]
                },
                {
                    "code": "A.5.3",
                    "name": "Threat Intelligence",
                    "description": "Collection and analysis of threat information",
                    "order": 3,
                    "controls": [
                        {"code": "A.5.7", "name": "Threat Intelligence", "statement": "Information relating to information security threats shall be collected and analysed to produce threat intelligence.", "is_mandatory": True, "implementation_guidance": "Subscribe to threat feeds, establish analysis process.", "testing_guidance": "Review threat intelligence sources, verify analysis outputs."},
                        {"code": "A.5.8", "name": "Project Security", "statement": "Information security shall be integrated into project management.", "is_mandatory": True, "implementation_guidance": "Include security gates in project methodology.", "testing_guidance": "Review project documentation for security requirements."}
                    ]
                }
            ]
        },
        {
            "code": "A.6",
            "name": "People Controls",
            "description": "Controls related to human resources security",
            "order": 2,
            "objectives": [
                {
                    "code": "A.6.1",
                    "name": "Screening",
                    "description": "Pre-employment verification",
                    "order": 1,
                    "controls": [
                        {"code": "A.6.1.1", "name": "Background Verification", "statement": "Background verification checks on all candidates shall be carried out prior to joining.", "is_mandatory": True, "implementation_guidance": "Define screening requirements, engage verification services.", "testing_guidance": "Review screening records, verify completion."},
                        {"code": "A.6.1.2", "name": "Terms of Employment", "statement": "Employment agreements shall state personnel and organization responsibilities for information security.", "is_mandatory": True, "implementation_guidance": "Include security clauses in employment contracts.", "testing_guidance": "Review contract templates, verify signed agreements."}
                    ]
                },
                {
                    "code": "A.6.2",
                    "name": "Awareness and Training",
                    "description": "Information security awareness, education and training",
                    "order": 2,
                    "controls": [
                        {"code": "A.6.3", "name": "Security Awareness", "statement": "Personnel shall receive appropriate awareness education and training.", "is_mandatory": True, "implementation_guidance": "Develop awareness program, deliver annual training.", "testing_guidance": "Review training materials, verify completion rates."},
                        {"code": "A.6.4", "name": "Disciplinary Process", "statement": "A disciplinary process shall be formalized and communicated for violations.", "is_mandatory": True, "implementation_guidance": "Define disciplinary procedures, communicate to personnel.", "testing_guidance": "Review policy documentation, verify communication."}
                    ]
                }
            ]
        },
        {
            "code": "A.7",
            "name": "Physical Controls",
            "description": "Controls for physical and environmental security",
            "order": 3,
            "objectives": [
                {
                    "code": "A.7.1",
                    "name": "Secure Areas",
                    "description": "Physical security perimeters and entry controls",
                    "order": 1,
                    "controls": [
                        {"code": "A.7.1.1", "name": "Physical Security Perimeters", "statement": "Security perimeters shall be defined and used to protect areas containing information and assets.", "is_mandatory": True, "implementation_guidance": "Define facility zones, implement physical barriers.", "testing_guidance": "Review zone definitions, inspect physical controls."},
                        {"code": "A.7.2", "name": "Physical Entry", "statement": "Secure areas shall be protected by appropriate entry controls.", "is_mandatory": True, "implementation_guidance": "Implement access control systems, visitor procedures.", "testing_guidance": "Review access logs, test entry controls.", "sub_controls": [
                            {"code": "A.7.2.a", "name": "Access Card Systems", "statement": "Electronic access control systems shall be implemented.", "order": 1},
                            {"code": "A.7.2.b", "name": "Visitor Management", "statement": "Visitor access shall be controlled and logged.", "order": 2}
                        ]},
                        {"code": "A.7.3", "name": "Offices and Rooms", "statement": "Physical security for offices, rooms and facilities shall be designed and implemented.", "is_mandatory": True, "implementation_guidance": "Assess security requirements, implement appropriate controls.", "testing_guidance": "Review security assessments, inspect facilities."}
                    ]
                },
                {
                    "code": "A.7.2",
                    "name": "Equipment Security",
                    "description": "Protection of equipment",
                    "order": 2,
                    "controls": [
                        {"code": "A.7.8", "name": "Equipment Siting", "statement": "Equipment shall be sited and protected to reduce risks.", "is_mandatory": True, "implementation_guidance": "Position equipment away from hazards, secure mounting.", "testing_guidance": "Inspect equipment placement, review risk assessments."},
                        {"code": "A.7.10", "name": "Storage Media", "statement": "Storage media shall be managed through their lifecycle.", "is_mandatory": True, "implementation_guidance": "Implement media handling procedures, secure disposal.", "testing_guidance": "Review media inventory, verify disposal records."}
                    ]
                }
            ]
        },
        {
            "code": "A.8",
            "name": "Technological Controls",
            "description": "Controls for technology-based security",
            "order": 4,
            "objectives": [
                {
                    "code": "A.8.1",
                    "name": "User Endpoint Devices",
                    "description": "Security of user devices",
                    "order": 1,
                    "controls": [
                        {"code": "A.8.1.1", "name": "User Endpoint Security", "statement": "Information stored on, processed by or accessible via user endpoint devices shall be protected.", "is_mandatory": True, "implementation_guidance": "Deploy endpoint protection, implement MDM.", "testing_guidance": "Review endpoint configurations, verify protection status."},
                        {"code": "A.8.2", "name": "Privileged Access Rights", "statement": "The allocation and use of privileged access rights shall be restricted and managed.", "is_mandatory": True, "implementation_guidance": "Implement PAM solution, require approval workflows.", "testing_guidance": "Review privileged accounts, verify approval records."},
                        {"code": "A.8.3", "name": "Information Access Restriction", "statement": "Access to information and application system functions shall be restricted.", "is_mandatory": True, "implementation_guidance": "Implement RBAC, enforce least privilege.", "testing_guidance": "Review access configurations, test restrictions."}
                    ]
                },
                {
                    "code": "A.8.2",
                    "name": "Authentication and Cryptography",
                    "description": "Secure authentication and encryption controls",
                    "order": 2,
                    "controls": [
                        {"code": "A.8.5", "name": "Secure Authentication", "statement": "Secure authentication technologies and procedures shall be implemented.", "is_mandatory": True, "implementation_guidance": "Implement MFA, enforce password policies.", "testing_guidance": "Test authentication mechanisms, review configurations."},
                        {"code": "A.8.24", "name": "Use of Cryptography", "statement": "Rules for effective use of cryptography shall be defined and implemented.", "is_mandatory": True, "implementation_guidance": "Define cryptography policy, implement approved algorithms.", "testing_guidance": "Review cryptography usage, verify key management.", "sub_controls": [
                            {"code": "A.8.24.a", "name": "Encryption Standards", "statement": "Approved encryption algorithms shall be used.", "order": 1},
                            {"code": "A.8.24.b", "name": "Key Management", "statement": "Cryptographic keys shall be managed securely.", "order": 2}
                        ]}
                    ]
                },
                {
                    "code": "A.8.3",
                    "name": "Network Security",
                    "description": "Security of networks and network services",
                    "order": 3,
                    "controls": [
                        {"code": "A.8.20", "name": "Network Security", "statement": "Networks and network devices shall be secured, managed and controlled.", "is_mandatory": True, "implementation_guidance": "Implement network security controls, segment networks.", "testing_guidance": "Review network configurations, test segmentation."},
                        {"code": "A.8.21", "name": "Security of Network Services", "statement": "Security mechanisms, service levels and requirements for network services shall be identified.", "is_mandatory": True, "implementation_guidance": "Define network service requirements, implement SLAs.", "testing_guidance": "Review service agreements, verify security controls."},
                        {"code": "A.8.22", "name": "Segregation of Networks", "statement": "Groups of information services, users and systems shall be segregated in networks.", "is_mandatory": True, "implementation_guidance": "Implement VLANs, define network zones.", "testing_guidance": "Review network architecture, test segmentation."}
                    ]
                }
            ]
        }
    ]
    
    return _create_framework_structure(db, framework, domains_data)


def _seed_iso_20000(db):
    """Seed ISO 20000-1:2018 framework."""
    framework = Framework(
        name="ISO/IEC 20000-1:2018 IT Service Management",
        short_code="ISO_20000",
        regulator="International Organization for Standardization",
        jurisdiction="Global",
        region="Global",
        version="2018",
        description="ISO/IEC 20000-1 specifies requirements for an organization to establish, implement, maintain and continually improve a service management system (SMS).",
        is_mandatory=False,
        enforcement_type="Certification",
        is_active=True,
        is_custom=False
    )
    db.add(framework)
    db.flush()
    
    domains_data = [
        {
            "code": "4",
            "name": "Context of the Organization",
            "description": "Understanding the organization and its context",
            "order": 1,
            "objectives": [
                {
                    "code": "4.1",
                    "name": "Understanding Context",
                    "description": "Determine internal and external issues",
                    "order": 1,
                    "controls": [
                        {"code": "4.1.1", "name": "Context Analysis", "statement": "The organization shall determine external and internal issues relevant to its purpose.", "is_mandatory": True, "implementation_guidance": "Conduct PESTLE and SWOT analysis.", "testing_guidance": "Review context documentation."},
                        {"code": "4.2.1", "name": "Stakeholder Requirements", "statement": "Determine interested parties and their requirements.", "is_mandatory": True, "implementation_guidance": "Identify stakeholders, document requirements.", "testing_guidance": "Review stakeholder analysis."}
                    ]
                }
            ]
        },
        {
            "code": "5",
            "name": "Leadership",
            "description": "Leadership and commitment requirements",
            "order": 2,
            "objectives": [
                {
                    "code": "5.1",
                    "name": "Leadership and Commitment",
                    "description": "Top management commitment to the SMS",
                    "order": 1,
                    "controls": [
                        {"code": "5.1.1", "name": "Management Commitment", "statement": "Top management shall demonstrate leadership and commitment.", "is_mandatory": True, "implementation_guidance": "Document management commitment, allocate resources.", "testing_guidance": "Review commitment evidence, interview management."},
                        {"code": "5.2.1", "name": "Service Management Policy", "statement": "Establish and maintain a service management policy.", "is_mandatory": True, "implementation_guidance": "Develop SMS policy aligned with strategy.", "testing_guidance": "Review policy documentation."}
                    ]
                }
            ]
        },
        {
            "code": "6",
            "name": "Planning",
            "description": "Planning for the service management system",
            "order": 3,
            "objectives": [
                {
                    "code": "6.1",
                    "name": "Risk and Opportunity",
                    "description": "Actions to address risks and opportunities",
                    "order": 1,
                    "controls": [
                        {"code": "6.1.1", "name": "Risk Assessment", "statement": "Determine risks and opportunities that need to be addressed.", "is_mandatory": True, "implementation_guidance": "Conduct risk assessment, define treatment plans.", "testing_guidance": "Review risk register and treatment plans."},
                        {"code": "6.2.1", "name": "SMS Objectives", "statement": "Establish service management objectives.", "is_mandatory": True, "implementation_guidance": "Define SMART objectives aligned with policy.", "testing_guidance": "Review objectives and measurement criteria."}
                    ]
                }
            ]
        },
        {
            "code": "7",
            "name": "Support",
            "description": "Support resources and capabilities",
            "order": 4,
            "objectives": [
                {
                    "code": "7.1",
                    "name": "Resources",
                    "description": "Determine and provide resources",
                    "order": 1,
                    "controls": [
                        {"code": "7.1.1", "name": "Resource Management", "statement": "Determine and provide resources needed for the SMS.", "is_mandatory": True, "implementation_guidance": "Assess resource needs, allocate appropriately.", "testing_guidance": "Review resource allocation records."},
                        {"code": "7.2.1", "name": "Competence", "statement": "Determine necessary competence and ensure personnel are competent.", "is_mandatory": True, "implementation_guidance": "Define competence requirements, provide training.", "testing_guidance": "Review training records, competency assessments."},
                        {"code": "7.5.1", "name": "Documented Information", "statement": "The SMS shall include documented information.", "is_mandatory": True, "implementation_guidance": "Establish document control procedures.", "testing_guidance": "Review document management system."}
                    ]
                }
            ]
        },
        {
            "code": "8",
            "name": "Operation",
            "description": "Operational planning and control",
            "order": 5,
            "objectives": [
                {
                    "code": "8.2",
                    "name": "Service Portfolio",
                    "description": "Service portfolio management",
                    "order": 1,
                    "controls": [
                        {"code": "8.2.1", "name": "Service Catalogue", "statement": "Maintain a service catalogue.", "is_mandatory": True, "implementation_guidance": "Document services, publish catalogue.", "testing_guidance": "Review service catalogue accuracy."},
                        {"code": "8.3.1", "name": "Relationship Management", "statement": "Manage relationships with interested parties.", "is_mandatory": True, "implementation_guidance": "Define relationship management processes.", "testing_guidance": "Review relationship records."}
                    ]
                },
                {
                    "code": "8.5",
                    "name": "Service Design and Transition",
                    "description": "Service design, build and transition",
                    "order": 2,
                    "controls": [
                        {"code": "8.5.1", "name": "Change Management", "statement": "Changes shall be controlled.", "is_mandatory": True, "implementation_guidance": "Implement change management process.", "testing_guidance": "Review change records and approvals.", "sub_controls": [
                            {"code": "8.5.1.a", "name": "Change Assessment", "statement": "Changes shall be assessed for impact.", "order": 1},
                            {"code": "8.5.1.b", "name": "Change Authorization", "statement": "Changes shall be authorized before implementation.", "order": 2}
                        ]},
                        {"code": "8.5.2", "name": "Release Management", "statement": "Plan, build, test and deploy releases.", "is_mandatory": True, "implementation_guidance": "Implement release process with testing gates.", "testing_guidance": "Review release records."},
                        {"code": "8.5.3", "name": "Configuration Management", "statement": "Information about CIs shall be managed.", "is_mandatory": True, "implementation_guidance": "Implement CMDB, define CI attributes.", "testing_guidance": "Review CMDB accuracy."}
                    ]
                },
                {
                    "code": "8.6",
                    "name": "Service Assurance",
                    "description": "Service level management and assurance",
                    "order": 3,
                    "controls": [
                        {"code": "8.6.1", "name": "Service Level Management", "statement": "Determine, agree and manage service levels.", "is_mandatory": True, "implementation_guidance": "Define SLAs, monitor performance.", "testing_guidance": "Review SLAs and performance reports."},
                        {"code": "8.6.2", "name": "Service Reporting", "statement": "Produce service reports.", "is_mandatory": True, "implementation_guidance": "Define reporting requirements, automate reports.", "testing_guidance": "Review service reports."},
                        {"code": "8.6.3", "name": "Service Continuity", "statement": "Ensure services can be continued in the event of a major failure.", "is_mandatory": True, "implementation_guidance": "Develop continuity plans, test annually.", "testing_guidance": "Review continuity plans and test results."}
                    ]
                }
            ]
        },
        {
            "code": "9",
            "name": "Performance Evaluation",
            "description": "Monitoring, measurement, analysis and evaluation",
            "order": 6,
            "objectives": [
                {
                    "code": "9.1",
                    "name": "Monitoring and Measurement",
                    "description": "Performance monitoring and measurement",
                    "order": 1,
                    "controls": [
                        {"code": "9.1.1", "name": "Performance Monitoring", "statement": "Determine what needs to be monitored and measured.", "is_mandatory": True, "implementation_guidance": "Define KPIs, implement monitoring.", "testing_guidance": "Review monitoring dashboards."},
                        {"code": "9.2.1", "name": "Internal Audit", "statement": "Conduct internal audits at planned intervals.", "is_mandatory": True, "implementation_guidance": "Establish audit program, train auditors.", "testing_guidance": "Review audit reports and findings."},
                        {"code": "9.3.1", "name": "Management Review", "statement": "Review the SMS at planned intervals.", "is_mandatory": True, "implementation_guidance": "Schedule management reviews, document outputs.", "testing_guidance": "Review management review minutes."}
                    ]
                }
            ]
        }
    ]
    
    return _create_framework_structure(db, framework, domains_data)


def _seed_nist_csf(db):
    """Seed NIST Cybersecurity Framework 2.0."""
    framework = Framework(
        name="NIST Cybersecurity Framework",
        short_code="NIST_CSF",
        regulator="National Institute of Standards and Technology",
        jurisdiction="United States",
        region="USA",
        version="2.0",
        description="The NIST Cybersecurity Framework provides a policy framework of computer security guidance for how organizations can assess and improve their ability to prevent, detect, and respond to cyber attacks.",
        is_mandatory=False,
        enforcement_type="Voluntary/Best Practice",
        is_active=True,
        is_custom=False
    )
    db.add(framework)
    db.flush()
    
    domains_data = [
        {
            "code": "GV",
            "name": "Govern",
            "description": "Establish and monitor the organization's cybersecurity risk management strategy, expectations, and policy",
            "order": 1,
            "objectives": [
                {
                    "code": "GV.OC",
                    "name": "Organizational Context",
                    "description": "Understanding of organizational mission, stakeholders, and legal requirements",
                    "order": 1,
                    "controls": [
                        {"code": "GV.OC-01", "name": "Mission Understanding", "statement": "The organizational mission is understood and informs cybersecurity risk management.", "is_mandatory": True, "implementation_guidance": "Document mission, align security strategy.", "testing_guidance": "Review strategic alignment documentation."},
                        {"code": "GV.OC-02", "name": "Stakeholder Requirements", "statement": "Internal and external stakeholders are understood, and their needs are used to inform cybersecurity strategy.", "is_mandatory": True, "implementation_guidance": "Identify stakeholders, document requirements.", "testing_guidance": "Review stakeholder analysis."}
                    ]
                },
                {
                    "code": "GV.RM",
                    "name": "Risk Management Strategy",
                    "description": "Priorities, constraints, and risk tolerance are established",
                    "order": 2,
                    "controls": [
                        {"code": "GV.RM-01", "name": "Risk Appetite", "statement": "Risk management objectives are established and agreed to by organizational stakeholders.", "is_mandatory": True, "implementation_guidance": "Define risk appetite, obtain board approval.", "testing_guidance": "Review risk appetite statement."},
                        {"code": "GV.RM-02", "name": "Risk Tolerance", "statement": "Risk appetite and risk tolerance statements are established and communicated.", "is_mandatory": True, "implementation_guidance": "Document tolerances, communicate broadly.", "testing_guidance": "Review tolerance documentation."},
                        {"code": "GV.RM-07", "name": "Strategic Opportunities", "statement": "Strategic opportunities are characterized and considered alongside cybersecurity risk.", "is_mandatory": True, "implementation_guidance": "Integrate risk into strategic planning.", "testing_guidance": "Review strategic planning outputs."}
                    ]
                }
            ]
        },
        {
            "code": "ID",
            "name": "Identify",
            "description": "Help determine the current cybersecurity risk to the organization",
            "order": 2,
            "objectives": [
                {
                    "code": "ID.AM",
                    "name": "Asset Management",
                    "description": "Assets that enable the organization to achieve business purposes are identified and managed",
                    "order": 1,
                    "controls": [
                        {"code": "ID.AM-01", "name": "Hardware Inventory", "statement": "Inventories of hardware managed by the organization are maintained.", "is_mandatory": True, "implementation_guidance": "Implement asset discovery, maintain CMDB.", "testing_guidance": "Review asset inventory accuracy."},
                        {"code": "ID.AM-02", "name": "Software Inventory", "statement": "Inventories of software, services, and systems managed by the organization are maintained.", "is_mandatory": True, "implementation_guidance": "Implement software inventory tools.", "testing_guidance": "Review software inventory.", "sub_controls": [
                            {"code": "ID.AM-02.a", "name": "Application Inventory", "statement": "Business applications are inventoried.", "order": 1},
                            {"code": "ID.AM-02.b", "name": "License Management", "statement": "Software licenses are tracked and managed.", "order": 2}
                        ]},
                        {"code": "ID.AM-03", "name": "Data Flow Mapping", "statement": "Representations of the organization's authorized network communication and data flows are maintained.", "is_mandatory": True, "implementation_guidance": "Document network topology, data flows.", "testing_guidance": "Review network diagrams."}
                    ]
                },
                {
                    "code": "ID.RA",
                    "name": "Risk Assessment",
                    "description": "The organization understands the cybersecurity risk to organizational operations",
                    "order": 2,
                    "controls": [
                        {"code": "ID.RA-01", "name": "Vulnerability Identification", "statement": "Vulnerabilities in assets are identified, validated, and recorded.", "is_mandatory": True, "implementation_guidance": "Conduct vulnerability scans, validate findings.", "testing_guidance": "Review vulnerability management program."},
                        {"code": "ID.RA-02", "name": "Threat Intelligence", "statement": "Cyber threat intelligence is received from information sharing forums and sources.", "is_mandatory": True, "implementation_guidance": "Subscribe to threat feeds, participate in ISACs.", "testing_guidance": "Review threat intelligence sources."},
                        {"code": "ID.RA-06", "name": "Risk Responses", "statement": "Risk responses are chosen, prioritized, and implemented.", "is_mandatory": True, "implementation_guidance": "Define treatment options, prioritize by risk.", "testing_guidance": "Review risk treatment plans."}
                    ]
                }
            ]
        },
        {
            "code": "PR",
            "name": "Protect",
            "description": "Use safeguards to prevent or reduce cybersecurity risk",
            "order": 3,
            "objectives": [
                {
                    "code": "PR.AA",
                    "name": "Identity Management and Access Control",
                    "description": "Access to physical and logical assets is limited to authorized users",
                    "order": 1,
                    "controls": [
                        {"code": "PR.AA-01", "name": "Identity Management", "statement": "Identities and credentials for authorized users, services, and hardware are managed.", "is_mandatory": True, "implementation_guidance": "Implement identity management, lifecycle management.", "testing_guidance": "Review identity management processes."},
                        {"code": "PR.AA-02", "name": "Identities Proofed", "statement": "Identities are proofed and bound to credentials based on context.", "is_mandatory": True, "implementation_guidance": "Implement identity proofing procedures.", "testing_guidance": "Review proofing records."},
                        {"code": "PR.AA-05", "name": "Access Permissions", "statement": "Access permissions, entitlements, and authorizations are defined.", "is_mandatory": True, "implementation_guidance": "Implement RBAC, document access matrix.", "testing_guidance": "Review access configurations."}
                    ]
                },
                {
                    "code": "PR.DS",
                    "name": "Data Security",
                    "description": "Data is managed consistent with risk strategy to protect confidentiality, integrity, and availability",
                    "order": 2,
                    "controls": [
                        {"code": "PR.DS-01", "name": "Data-at-Rest Protection", "statement": "The confidentiality, integrity, and availability of data-at-rest are protected.", "is_mandatory": True, "implementation_guidance": "Implement encryption, access controls.", "testing_guidance": "Verify data protection controls."},
                        {"code": "PR.DS-02", "name": "Data-in-Transit Protection", "statement": "The confidentiality, integrity, and availability of data-in-transit are protected.", "is_mandatory": True, "implementation_guidance": "Implement TLS, secure protocols.", "testing_guidance": "Test encryption in transit."},
                        {"code": "PR.DS-10", "name": "Data Integrity", "statement": "The integrity of data is protected in storage and in transit.", "is_mandatory": True, "implementation_guidance": "Implement integrity checking, checksums.", "testing_guidance": "Review integrity controls."}
                    ]
                }
            ]
        },
        {
            "code": "DE",
            "name": "Detect",
            "description": "Find and analyze possible cybersecurity attacks and compromises",
            "order": 4,
            "objectives": [
                {
                    "code": "DE.CM",
                    "name": "Continuous Monitoring",
                    "description": "Assets are monitored to find anomalies, indicators of compromise, and other potentially adverse events",
                    "order": 1,
                    "controls": [
                        {"code": "DE.CM-01", "name": "Network Monitoring", "statement": "Networks and network services are monitored to find potentially adverse events.", "is_mandatory": True, "implementation_guidance": "Deploy SIEM, define monitoring use cases.", "testing_guidance": "Review monitoring coverage."},
                        {"code": "DE.CM-02", "name": "Physical Environment Monitoring", "statement": "The physical environment is monitored.", "is_mandatory": True, "implementation_guidance": "Implement physical security monitoring.", "testing_guidance": "Review physical security logs."},
                        {"code": "DE.CM-03", "name": "Personnel Activity Monitoring", "statement": "Personnel activity and technology usage are monitored.", "is_mandatory": True, "implementation_guidance": "Implement user activity monitoring.", "testing_guidance": "Review activity logs.", "sub_controls": [
                            {"code": "DE.CM-03.a", "name": "User Behavior Analytics", "statement": "User behavior analytics are implemented.", "order": 1}
                        ]}
                    ]
                },
                {
                    "code": "DE.AE",
                    "name": "Adverse Event Analysis",
                    "description": "Anomalies, indicators of compromise, and other potentially adverse events are analyzed",
                    "order": 2,
                    "controls": [
                        {"code": "DE.AE-02", "name": "Event Analysis", "statement": "Potentially adverse events are analyzed to better understand associated activities.", "is_mandatory": True, "implementation_guidance": "Establish analysis procedures, train analysts.", "testing_guidance": "Review analysis processes."},
                        {"code": "DE.AE-04", "name": "Impact Estimation", "statement": "Information on adverse events is provided to authorized staff and tools.", "is_mandatory": True, "implementation_guidance": "Define escalation procedures.", "testing_guidance": "Review escalation records."}
                    ]
                }
            ]
        },
        {
            "code": "RS",
            "name": "Respond",
            "description": "Take action regarding a detected cybersecurity incident",
            "order": 5,
            "objectives": [
                {
                    "code": "RS.MA",
                    "name": "Incident Management",
                    "description": "Responses to detected cybersecurity incidents are managed",
                    "order": 1,
                    "controls": [
                        {"code": "RS.MA-01", "name": "Incident Response Plan", "statement": "The incident response plan is executed in coordination with relevant third parties.", "is_mandatory": True, "implementation_guidance": "Develop IR plan, train response team.", "testing_guidance": "Review IR plan, test results."},
                        {"code": "RS.MA-02", "name": "Incident Triage", "statement": "Incident reports are triaged and validated.", "is_mandatory": True, "implementation_guidance": "Define triage procedures, severity levels.", "testing_guidance": "Review incident records."},
                        {"code": "RS.MA-04", "name": "Incident Escalation", "statement": "Incidents are escalated or elevated as needed.", "is_mandatory": True, "implementation_guidance": "Define escalation matrix.", "testing_guidance": "Review escalation records."}
                    ]
                }
            ]
        },
        {
            "code": "RC",
            "name": "Recover",
            "description": "Restore assets and operations that were impacted by a cybersecurity incident",
            "order": 6,
            "objectives": [
                {
                    "code": "RC.RP",
                    "name": "Incident Recovery Plan Execution",
                    "description": "Recovery activities are performed to ensure operational availability of systems and services",
                    "order": 1,
                    "controls": [
                        {"code": "RC.RP-01", "name": "Recovery Plan Execution", "statement": "The recovery portion of the incident response plan is executed once initiated.", "is_mandatory": True, "implementation_guidance": "Develop recovery playbooks, test annually.", "testing_guidance": "Review recovery tests."},
                        {"code": "RC.RP-03", "name": "Recovery Verification", "statement": "The integrity of recovered assets is verified.", "is_mandatory": True, "implementation_guidance": "Define verification procedures.", "testing_guidance": "Review verification records."},
                        {"code": "RC.RP-05", "name": "Post-Incident Review", "statement": "The integrity of restored assets is verified, the incident is declared over, and recovery documentation is updated.", "is_mandatory": True, "implementation_guidance": "Conduct post-incident reviews.", "testing_guidance": "Review post-incident reports."}
                    ]
                }
            ]
        }
    ]
    
    return _create_framework_structure(db, framework, domains_data)


def _seed_swift_csp(db):
    """Seed SWIFT Customer Security Programme framework."""
    framework = Framework(
        name="SWIFT Customer Security Programme",
        short_code="SWIFT_CSF",
        regulator="SWIFT",
        jurisdiction="Global",
        region="Global",
        version="2024",
        description="The SWIFT Customer Security Programme (CSP) establishes a common set of security controls for the user community. It is designed to address evolving cyber threats and help customers reinforce their security measures.",
        is_mandatory=True,
        enforcement_type="Contractual",
        is_active=True,
        is_custom=False
    )
    db.add(framework)
    db.flush()
    
    domains_data = [
        {
            "code": "1",
            "name": "Secure Your Environment",
            "description": "Restrict Internet Access and Protect Critical Systems from General IT Environment",
            "order": 1,
            "objectives": [
                {
                    "code": "1.1",
                    "name": "Environment Protection",
                    "description": "Protect the SWIFT infrastructure",
                    "order": 1,
                    "controls": [
                        {"code": "1.1", "name": "SWIFT Environment Protection", "statement": "Ensure the protection of the user's SWIFT infrastructure from potentially compromised elements of the general IT environment.", "is_mandatory": True, "implementation_guidance": "Implement network segmentation, dedicated SWIFT zone.", "testing_guidance": "Review network architecture, test segmentation."},
                        {"code": "1.2", "name": "Operating System Control", "statement": "Restrict and control the allocation and usage of administrator-level operating system accounts.", "is_mandatory": True, "implementation_guidance": "Implement PAM for admin accounts.", "testing_guidance": "Review admin account usage."},
                        {"code": "1.3", "name": "Virtualisation Platform Protection", "statement": "Secure the virtualisation platform and virtual machines hosting SWIFT-related components.", "is_mandatory": False, "implementation_guidance": "Harden hypervisor, implement isolation.", "testing_guidance": "Review virtualisation configurations."}
                    ]
                }
            ]
        },
        {
            "code": "2",
            "name": "Know and Limit Access",
            "description": "Prevent compromise of credentials and manage identities",
            "order": 2,
            "objectives": [
                {
                    "code": "2.1",
                    "name": "Access Control",
                    "description": "Control access to SWIFT systems",
                    "order": 1,
                    "controls": [
                        {"code": "2.1", "name": "Internal Data Flow Security", "statement": "Ensure the confidentiality, integrity, and authenticity of data flows between the user's internal systems.", "is_mandatory": True, "implementation_guidance": "Implement secure channels, encrypt internal traffic.", "testing_guidance": "Review data flow security.", "sub_controls": [
                            {"code": "2.1.a", "name": "Encryption", "statement": "Encrypt SWIFT-related data in transit.", "order": 1},
                            {"code": "2.1.b", "name": "Integrity Protection", "statement": "Implement integrity controls for data in transit.", "order": 2}
                        ]},
                        {"code": "2.2", "name": "Security Updates", "statement": "Minimise the occurrence of known technical vulnerabilities on operator PCs and within the SWIFT infrastructure.", "is_mandatory": True, "implementation_guidance": "Implement patch management for SWIFT systems.", "testing_guidance": "Review patch status."},
                        {"code": "2.3", "name": "System Hardening", "statement": "Reduce the cyber attack surface of SWIFT-related components.", "is_mandatory": True, "implementation_guidance": "Apply hardening standards.", "testing_guidance": "Review system configurations."}
                    ]
                },
                {
                    "code": "2.2",
                    "name": "Identity Management",
                    "description": "Manage identities and access rights",
                    "order": 2,
                    "controls": [
                        {"code": "2.4A", "name": "Back-Office Data Flow Security", "statement": "Ensure the confidentiality, integrity, and mutual authenticity of data flows between back-office applications and SWIFT infrastructure.", "is_mandatory": True, "implementation_guidance": "Secure back-office integrations.", "testing_guidance": "Review integration security."},
                        {"code": "2.5A", "name": "External Transmission Data Protection", "statement": "Protect the confidentiality of SWIFT-related data transmitted or stored outside the secure zone.", "is_mandatory": True, "implementation_guidance": "Encrypt data leaving secure zone.", "testing_guidance": "Verify encryption."},
                        {"code": "2.6", "name": "Operator Session Confidentiality", "statement": "Protect the confidentiality and integrity of interactive operator sessions.", "is_mandatory": True, "implementation_guidance": "Implement secure session protocols.", "testing_guidance": "Review session security."}
                    ]
                }
            ]
        },
        {
            "code": "3",
            "name": "Detect and Respond",
            "description": "Detect anomalous activity and plan for incident response",
            "order": 3,
            "objectives": [
                {
                    "code": "3.1",
                    "name": "Detect",
                    "description": "Detect anomalous activity",
                    "order": 1,
                    "controls": [
                        {"code": "3.1", "name": "Physical Security", "statement": "Prevent unauthorised physical access to sensitive equipment, hosting sites, and storage.", "is_mandatory": True, "implementation_guidance": "Implement physical access controls.", "testing_guidance": "Review physical security measures."},
                        {"code": "3.2", "name": "Logical Access Control", "statement": "Enforce multi-factor authentication (MFA) for interactive access to SWIFT-related applications.", "is_mandatory": True, "implementation_guidance": "Deploy MFA for all SWIFT access.", "testing_guidance": "Test MFA enforcement.", "sub_controls": [
                            {"code": "3.2.a", "name": "Token-Based MFA", "statement": "Implement hardware or software tokens.", "order": 1}
                        ]},
                        {"code": "3.3", "name": "Password Management", "statement": "Ensure that passwords are sufficiently resistant against common password attacks.", "is_mandatory": True, "implementation_guidance": "Implement strong password policies.", "testing_guidance": "Review password configurations."}
                    ]
                },
                {
                    "code": "3.2",
                    "name": "Respond",
                    "description": "Plan and prepare for incident response",
                    "order": 2,
                    "controls": [
                        {"code": "4.1", "name": "Personnel Vetting", "statement": "Ensure the trustworthiness of staff operating the SWIFT infrastructure.", "is_mandatory": True, "implementation_guidance": "Conduct background checks.", "testing_guidance": "Review vetting records."},
                        {"code": "5.1", "name": "Logging and Monitoring", "statement": "Record and monitor security events, detect and respond to anomalous behaviour.", "is_mandatory": True, "implementation_guidance": "Implement SIEM, define alerts.", "testing_guidance": "Review monitoring coverage."},
                        {"code": "6.1", "name": "Cyber Incident Response Planning", "statement": "Ensure a consistent and effective approach for the management of cyber incidents.", "is_mandatory": True, "implementation_guidance": "Develop IR plan, conduct exercises.", "testing_guidance": "Review IR plan and exercises."}
                    ]
                }
            ]
        }
    ]
    
    return _create_framework_structure(db, framework, domains_data)


def _seed_cbb(db):
    """Seed Central Bank of Bahrain framework."""
    framework = Framework(
        name="Central Bank of Bahrain Cyber Security Framework",
        short_code="CBB",
        regulator="Central Bank of Bahrain",
        jurisdiction="Bahrain",
        region="Middle East",
        version="2023",
        description="The CBB Cyber Security Framework establishes minimum requirements for cybersecurity risk management for licensed financial institutions in the Kingdom of Bahrain.",
        is_mandatory=True,
        enforcement_type="Regulatory",
        is_active=True,
        is_custom=False
    )
    db.add(framework)
    db.flush()
    
    domains_data = [
        {
            "code": "CS-1",
            "name": "Governance and Oversight",
            "description": "Board and senior management oversight of cybersecurity",
            "order": 1,
            "objectives": [
                {
                    "code": "CS-1.1",
                    "name": "Cybersecurity Governance",
                    "description": "Establish cybersecurity governance structure",
                    "order": 1,
                    "controls": [
                        {"code": "CS-1.1.1", "name": "Board Oversight", "statement": "The Board of Directors shall have oversight of the cybersecurity program.", "is_mandatory": True, "implementation_guidance": "Establish board reporting, define responsibilities.", "testing_guidance": "Review board minutes, cybersecurity reports."},
                        {"code": "CS-1.1.2", "name": "Cybersecurity Strategy", "statement": "A comprehensive cybersecurity strategy shall be established and approved by the Board.", "is_mandatory": True, "implementation_guidance": "Develop multi-year strategy, align with business.", "testing_guidance": "Review strategy documentation."},
                        {"code": "CS-1.1.3", "name": "CISO Appointment", "statement": "A Chief Information Security Officer shall be appointed with adequate authority.", "is_mandatory": True, "implementation_guidance": "Appoint CISO, define reporting lines.", "testing_guidance": "Review appointment, organization chart."}
                    ]
                },
                {
                    "code": "CS-1.2",
                    "name": "Policies and Procedures",
                    "description": "Cybersecurity policies and procedures",
                    "order": 2,
                    "controls": [
                        {"code": "CS-1.2.1", "name": "Security Policies", "statement": "Comprehensive cybersecurity policies shall be established and maintained.", "is_mandatory": True, "implementation_guidance": "Develop policy framework, review annually.", "testing_guidance": "Review policies, approval records."},
                        {"code": "CS-1.2.2", "name": "Policy Communication", "statement": "Security policies shall be communicated to all relevant personnel.", "is_mandatory": True, "implementation_guidance": "Publish policies, obtain acknowledgment.", "testing_guidance": "Review communication records."}
                    ]
                }
            ]
        },
        {
            "code": "CS-2",
            "name": "Risk Management",
            "description": "Cybersecurity risk assessment and management",
            "order": 2,
            "objectives": [
                {
                    "code": "CS-2.1",
                    "name": "Risk Assessment",
                    "description": "Cybersecurity risk assessment processes",
                    "order": 1,
                    "controls": [
                        {"code": "CS-2.1.1", "name": "Risk Assessment Process", "statement": "A formal cybersecurity risk assessment process shall be established.", "is_mandatory": True, "implementation_guidance": "Define methodology, conduct annual assessments.", "testing_guidance": "Review assessment reports.", "sub_controls": [
                            {"code": "CS-2.1.1.a", "name": "Asset Identification", "statement": "Critical assets shall be identified.", "order": 1},
                            {"code": "CS-2.1.1.b", "name": "Threat Assessment", "statement": "Threats shall be assessed and documented.", "order": 2}
                        ]},
                        {"code": "CS-2.1.2", "name": "Risk Treatment", "statement": "Identified risks shall be treated according to defined criteria.", "is_mandatory": True, "implementation_guidance": "Develop treatment plans, track remediation.", "testing_guidance": "Review risk register and treatment."},
                        {"code": "CS-2.1.3", "name": "Risk Reporting", "statement": "Cybersecurity risks shall be reported to senior management and Board.", "is_mandatory": True, "implementation_guidance": "Establish risk reporting cadence.", "testing_guidance": "Review risk reports."}
                    ]
                }
            ]
        },
        {
            "code": "CS-3",
            "name": "Security Operations",
            "description": "Day-to-day security operations",
            "order": 3,
            "objectives": [
                {
                    "code": "CS-3.1",
                    "name": "Asset Management",
                    "description": "IT asset inventory and management",
                    "order": 1,
                    "controls": [
                        {"code": "CS-3.1.1", "name": "Asset Inventory", "statement": "Maintain complete inventory of IT assets.", "is_mandatory": True, "implementation_guidance": "Implement asset discovery, maintain CMDB.", "testing_guidance": "Review asset inventory."},
                        {"code": "CS-3.1.2", "name": "Asset Classification", "statement": "Assets shall be classified based on criticality.", "is_mandatory": True, "implementation_guidance": "Define classification scheme, label assets.", "testing_guidance": "Review classification records."}
                    ]
                },
                {
                    "code": "CS-3.2",
                    "name": "Access Control",
                    "description": "Logical access control measures",
                    "order": 2,
                    "controls": [
                        {"code": "CS-3.2.1", "name": "Access Management", "statement": "Implement formal access management processes.", "is_mandatory": True, "implementation_guidance": "Define access request workflow.", "testing_guidance": "Review access management records."},
                        {"code": "CS-3.2.2", "name": "Multi-Factor Authentication", "statement": "MFA shall be implemented for remote access and privileged users.", "is_mandatory": True, "implementation_guidance": "Deploy MFA solution.", "testing_guidance": "Verify MFA implementation."},
                        {"code": "CS-3.2.3", "name": "Privileged Access", "statement": "Privileged access shall be strictly controlled and monitored.", "is_mandatory": True, "implementation_guidance": "Implement PAM solution.", "testing_guidance": "Review privileged access logs."}
                    ]
                }
            ]
        },
        {
            "code": "CS-4",
            "name": "Incident Response",
            "description": "Cybersecurity incident management",
            "order": 4,
            "objectives": [
                {
                    "code": "CS-4.1",
                    "name": "Incident Management",
                    "description": "Incident detection and response",
                    "order": 1,
                    "controls": [
                        {"code": "CS-4.1.1", "name": "Incident Response Plan", "statement": "A cybersecurity incident response plan shall be established.", "is_mandatory": True, "implementation_guidance": "Develop IR plan, establish CSIRT.", "testing_guidance": "Review IR plan documentation."},
                        {"code": "CS-4.1.2", "name": "Incident Reporting", "statement": "Significant incidents shall be reported to CBB within prescribed timeframes.", "is_mandatory": True, "implementation_guidance": "Define reporting criteria, establish process.", "testing_guidance": "Review incident reports."},
                        {"code": "CS-4.1.3", "name": "IR Testing", "statement": "Incident response capabilities shall be tested regularly.", "is_mandatory": True, "implementation_guidance": "Conduct tabletop and simulation exercises.", "testing_guidance": "Review exercise reports."}
                    ]
                }
            ]
        }
    ]
    
    return _create_framework_structure(db, framework, domains_data)


def _seed_sama(db):
    """Seed SAMA Cybersecurity Framework."""
    framework = Framework(
        name="SAMA Cyber Security Framework",
        short_code="SAMA",
        regulator="Saudi Arabian Monetary Authority",
        jurisdiction="Saudi Arabia",
        region="Middle East",
        version="1.0",
        description="The SAMA Cyber Security Framework provides requirements for member organizations to protect their information assets from cyber threats and ensure secure operations.",
        is_mandatory=True,
        enforcement_type="Regulatory",
        is_active=True,
        is_custom=False
    )
    db.add(framework)
    db.flush()
    
    domains_data = [
        {
            "code": "1",
            "name": "Cyber Security Leadership and Governance",
            "description": "Establishment of cybersecurity governance, strategy, and organization",
            "order": 1,
            "objectives": [
                {
                    "code": "1.1",
                    "name": "Cyber Security Strategy",
                    "description": "Development and maintenance of cybersecurity strategy",
                    "order": 1,
                    "controls": [
                        {"code": "1.1.1", "name": "Strategy Development", "statement": "The organization shall develop a cybersecurity strategy aligned with business objectives.", "is_mandatory": True, "implementation_guidance": "Align security strategy with business goals, obtain board approval.", "testing_guidance": "Review strategy documentation."},
                        {"code": "1.1.2", "name": "Strategy Review", "statement": "The cybersecurity strategy shall be reviewed and updated annually.", "is_mandatory": True, "implementation_guidance": "Establish annual review cycle.", "testing_guidance": "Review revision history."},
                        {"code": "1.1.3", "name": "Resource Allocation", "statement": "Adequate resources shall be allocated for cybersecurity.", "is_mandatory": True, "implementation_guidance": "Define budget, allocate personnel.", "testing_guidance": "Review budget allocations."}
                    ]
                },
                {
                    "code": "1.2",
                    "name": "Governance Structure",
                    "description": "Cybersecurity organization and responsibilities",
                    "order": 2,
                    "controls": [
                        {"code": "1.2.1", "name": "CISO Role", "statement": "A qualified CISO shall be appointed with defined responsibilities.", "is_mandatory": True, "implementation_guidance": "Appoint CISO, define job description.", "testing_guidance": "Review CISO appointment."},
                        {"code": "1.2.2", "name": "Security Committee", "statement": "A cybersecurity steering committee shall be established.", "is_mandatory": True, "implementation_guidance": "Form committee, define charter.", "testing_guidance": "Review committee minutes.", "sub_controls": [
                            {"code": "1.2.2.a", "name": "Committee Charter", "statement": "Committee charter shall be documented.", "order": 1},
                            {"code": "1.2.2.b", "name": "Regular Meetings", "statement": "Committee shall meet at least quarterly.", "order": 2}
                        ]},
                        {"code": "1.2.3", "name": "Board Reporting", "statement": "Cybersecurity status shall be reported to the Board regularly.", "is_mandatory": True, "implementation_guidance": "Establish quarterly board reporting.", "testing_guidance": "Review board presentations."}
                    ]
                }
            ]
        },
        {
            "code": "2",
            "name": "Cyber Security Risk Management and Compliance",
            "description": "Risk management and regulatory compliance",
            "order": 2,
            "objectives": [
                {
                    "code": "2.1",
                    "name": "Risk Management",
                    "description": "Cybersecurity risk assessment and treatment",
                    "order": 1,
                    "controls": [
                        {"code": "2.1.1", "name": "Risk Framework", "statement": "A cybersecurity risk management framework shall be established.", "is_mandatory": True, "implementation_guidance": "Adopt risk methodology, define appetite.", "testing_guidance": "Review risk framework."},
                        {"code": "2.1.2", "name": "Risk Assessment", "statement": "Cybersecurity risk assessments shall be conducted periodically.", "is_mandatory": True, "implementation_guidance": "Conduct annual assessments.", "testing_guidance": "Review assessment reports."},
                        {"code": "2.1.3", "name": "Risk Treatment", "statement": "Identified risks shall be treated appropriately.", "is_mandatory": True, "implementation_guidance": "Develop treatment plans.", "testing_guidance": "Review risk register."}
                    ]
                },
                {
                    "code": "2.2",
                    "name": "Compliance",
                    "description": "Regulatory and standards compliance",
                    "order": 2,
                    "controls": [
                        {"code": "2.2.1", "name": "Compliance Monitoring", "statement": "Compliance with regulations shall be monitored continuously.", "is_mandatory": True, "implementation_guidance": "Track regulatory requirements.", "testing_guidance": "Review compliance status."},
                        {"code": "2.2.2", "name": "Audit Program", "statement": "Regular security audits shall be conducted.", "is_mandatory": True, "implementation_guidance": "Establish audit program.", "testing_guidance": "Review audit reports."}
                    ]
                }
            ]
        },
        {
            "code": "3",
            "name": "Cyber Security Operations and Technology",
            "description": "Security controls and technology implementation",
            "order": 3,
            "objectives": [
                {
                    "code": "3.1",
                    "name": "Security Controls",
                    "description": "Implementation of security controls",
                    "order": 1,
                    "controls": [
                        {"code": "3.1.1", "name": "Access Control", "statement": "Implement comprehensive access control mechanisms.", "is_mandatory": True, "implementation_guidance": "Implement IAM solution.", "testing_guidance": "Review access configurations."},
                        {"code": "3.1.2", "name": "Network Security", "statement": "Implement network security controls.", "is_mandatory": True, "implementation_guidance": "Deploy firewalls, IDS/IPS.", "testing_guidance": "Review network security.", "sub_controls": [
                            {"code": "3.1.2.a", "name": "Perimeter Security", "statement": "Implement perimeter defenses.", "order": 1},
                            {"code": "3.1.2.b", "name": "Network Segmentation", "statement": "Segment networks appropriately.", "order": 2}
                        ]},
                        {"code": "3.1.3", "name": "Endpoint Security", "statement": "Implement endpoint protection.", "is_mandatory": True, "implementation_guidance": "Deploy EDR solution.", "testing_guidance": "Review endpoint protection."},
                        {"code": "3.1.4", "name": "Data Protection", "statement": "Implement data protection controls.", "is_mandatory": True, "implementation_guidance": "Implement encryption, DLP.", "testing_guidance": "Review data protection."}
                    ]
                },
                {
                    "code": "3.2",
                    "name": "Vulnerability Management",
                    "description": "Vulnerability identification and remediation",
                    "order": 2,
                    "controls": [
                        {"code": "3.2.1", "name": "Vulnerability Scanning", "statement": "Conduct regular vulnerability assessments.", "is_mandatory": True, "implementation_guidance": "Schedule quarterly scans.", "testing_guidance": "Review scan reports."},
                        {"code": "3.2.2", "name": "Patch Management", "statement": "Implement timely patch management.", "is_mandatory": True, "implementation_guidance": "Define patching SLAs.", "testing_guidance": "Review patch compliance."},
                        {"code": "3.2.3", "name": "Penetration Testing", "statement": "Conduct annual penetration testing.", "is_mandatory": True, "implementation_guidance": "Engage qualified testers.", "testing_guidance": "Review pentest reports."}
                    ]
                }
            ]
        },
        {
            "code": "4",
            "name": "Third Party Cyber Security",
            "description": "Third party and vendor security management",
            "order": 4,
            "objectives": [
                {
                    "code": "4.1",
                    "name": "Vendor Management",
                    "description": "Third party security assessment and monitoring",
                    "order": 1,
                    "controls": [
                        {"code": "4.1.1", "name": "Vendor Assessment", "statement": "Conduct security assessments of third parties.", "is_mandatory": True, "implementation_guidance": "Define assessment criteria.", "testing_guidance": "Review vendor assessments."},
                        {"code": "4.1.2", "name": "Contractual Requirements", "statement": "Include security requirements in contracts.", "is_mandatory": True, "implementation_guidance": "Define standard clauses.", "testing_guidance": "Review contracts."},
                        {"code": "4.1.3", "name": "Vendor Monitoring", "statement": "Monitor third party security posture.", "is_mandatory": True, "implementation_guidance": "Establish monitoring program.", "testing_guidance": "Review monitoring records."}
                    ]
                }
            ]
        }
    ]
    
    return _create_framework_structure(db, framework, domains_data)


def _seed_sbp(db):
    """Seed State Bank of Pakistan IT/IS Security framework."""
    framework = Framework(
        name="SBP IT/IS Security Guidelines",
        short_code="SBP",
        regulator="State Bank of Pakistan",
        jurisdiction="Pakistan",
        region="South Asia",
        version="2023",
        description="The State Bank of Pakistan IT/IS Security Guidelines provide minimum requirements for information technology and information security controls in the banking sector.",
        is_mandatory=True,
        enforcement_type="Regulatory",
        is_active=True,
        is_custom=False
    )
    db.add(framework)
    db.flush()
    
    domains_data = [
        {
            "code": "GOV",
            "name": "IT/IS Governance",
            "description": "IT governance and oversight requirements",
            "order": 1,
            "objectives": [
                {
                    "code": "GOV-1",
                    "name": "Board Oversight",
                    "description": "Board level IT/IS governance",
                    "order": 1,
                    "controls": [
                        {"code": "GOV-1.1", "name": "Board IT Committee", "statement": "The Board shall establish an IT Committee with appropriate oversight responsibilities.", "is_mandatory": True, "implementation_guidance": "Form committee, define charter and membership.", "testing_guidance": "Review committee charter and minutes."},
                        {"code": "GOV-1.2", "name": "IT Strategy", "statement": "An IT strategy aligned with business strategy shall be developed and approved.", "is_mandatory": True, "implementation_guidance": "Develop multi-year IT strategy.", "testing_guidance": "Review strategy documentation."},
                        {"code": "GOV-1.3", "name": "IS Policy Framework", "statement": "A comprehensive information security policy framework shall be established.", "is_mandatory": True, "implementation_guidance": "Develop policy hierarchy, obtain approval.", "testing_guidance": "Review policy documentation.", "sub_controls": [
                            {"code": "GOV-1.3.a", "name": "Policy Approval", "statement": "Policies shall be approved by senior management.", "order": 1},
                            {"code": "GOV-1.3.b", "name": "Policy Review", "statement": "Policies shall be reviewed annually.", "order": 2}
                        ]}
                    ]
                },
                {
                    "code": "GOV-2",
                    "name": "Security Organization",
                    "description": "Information security organization structure",
                    "order": 2,
                    "controls": [
                        {"code": "GOV-2.1", "name": "CISO Appointment", "statement": "A qualified CISO shall be appointed with independence and authority.", "is_mandatory": True, "implementation_guidance": "Appoint CISO with direct reporting to senior management.", "testing_guidance": "Review CISO appointment and reporting."},
                        {"code": "GOV-2.2", "name": "Security Team", "statement": "Adequate information security resources shall be allocated.", "is_mandatory": True, "implementation_guidance": "Build security team with appropriate skills.", "testing_guidance": "Review team structure and skills."}
                    ]
                }
            ]
        },
        {
            "code": "OPS",
            "name": "IT Operations Security",
            "description": "Security requirements for IT operations",
            "order": 2,
            "objectives": [
                {
                    "code": "OPS-1",
                    "name": "Data Center Security",
                    "description": "Physical and environmental security for data centers",
                    "order": 1,
                    "controls": [
                        {"code": "OPS-1.1", "name": "DC Physical Security", "statement": "Data centers shall have appropriate physical security controls.", "is_mandatory": True, "implementation_guidance": "Implement access controls, surveillance, environmental monitoring.", "testing_guidance": "Review physical security measures."},
                        {"code": "OPS-1.2", "name": "Environmental Controls", "statement": "Environmental controls shall protect IT equipment.", "is_mandatory": True, "implementation_guidance": "Implement HVAC, fire suppression, power backup.", "testing_guidance": "Review environmental systems."},
                        {"code": "OPS-1.3", "name": "DC Access Control", "statement": "Access to data center shall be strictly controlled.", "is_mandatory": True, "implementation_guidance": "Implement biometric access, visitor logs.", "testing_guidance": "Review access logs."}
                    ]
                },
                {
                    "code": "OPS-2",
                    "name": "Network Operations",
                    "description": "Network security and operations",
                    "order": 2,
                    "controls": [
                        {"code": "OPS-2.1", "name": "Network Security", "statement": "Implement comprehensive network security controls.", "is_mandatory": True, "implementation_guidance": "Deploy firewalls, IDS/IPS, implement segmentation.", "testing_guidance": "Review network security architecture."},
                        {"code": "OPS-2.2", "name": "Internet Security", "statement": "Internet connectivity shall be secured.", "is_mandatory": True, "implementation_guidance": "Implement proxy, content filtering, DDoS protection.", "testing_guidance": "Review internet security controls."},
                        {"code": "OPS-2.3", "name": "Wireless Security", "statement": "Wireless networks shall be secured.", "is_mandatory": True, "implementation_guidance": "Implement WPA2/3, network isolation.", "testing_guidance": "Review wireless configurations."}
                    ]
                },
                {
                    "code": "OPS-3",
                    "name": "Change Management",
                    "description": "IT change management processes",
                    "order": 3,
                    "controls": [
                        {"code": "OPS-3.1", "name": "Change Control", "statement": "All IT changes shall follow formal change management process.", "is_mandatory": True, "implementation_guidance": "Define change categories, implement CAB.", "testing_guidance": "Review change records.", "sub_controls": [
                            {"code": "OPS-3.1.a", "name": "Change Assessment", "statement": "Changes shall be assessed for risk.", "order": 1},
                            {"code": "OPS-3.1.b", "name": "Change Approval", "statement": "Changes shall be formally approved.", "order": 2}
                        ]},
                        {"code": "OPS-3.2", "name": "Emergency Changes", "statement": "Emergency change procedures shall be defined.", "is_mandatory": True, "implementation_guidance": "Define emergency change process.", "testing_guidance": "Review emergency change records."}
                    ]
                }
            ]
        },
        {
            "code": "SEC",
            "name": "Security Controls",
            "description": "Technical and operational security controls",
            "order": 3,
            "objectives": [
                {
                    "code": "SEC-1",
                    "name": "Access Control",
                    "description": "Logical access control requirements",
                    "order": 1,
                    "controls": [
                        {"code": "SEC-1.1", "name": "User Access Management", "statement": "Formal user access management processes shall be implemented.", "is_mandatory": True, "implementation_guidance": "Define access request, approval, and revocation processes.", "testing_guidance": "Review access management records."},
                        {"code": "SEC-1.2", "name": "Authentication", "statement": "Strong authentication shall be implemented.", "is_mandatory": True, "implementation_guidance": "Implement MFA for sensitive systems.", "testing_guidance": "Verify authentication mechanisms."},
                        {"code": "SEC-1.3", "name": "Privileged Access", "statement": "Privileged access shall be strictly controlled.", "is_mandatory": True, "implementation_guidance": "Implement PAM, session monitoring.", "testing_guidance": "Review privileged access controls."},
                        {"code": "SEC-1.4", "name": "Access Reviews", "statement": "Access rights shall be reviewed periodically.", "is_mandatory": True, "implementation_guidance": "Conduct quarterly access reviews.", "testing_guidance": "Review access review records."}
                    ]
                },
                {
                    "code": "SEC-2",
                    "name": "Cryptography",
                    "description": "Cryptographic controls",
                    "order": 2,
                    "controls": [
                        {"code": "SEC-2.1", "name": "Encryption Policy", "statement": "A cryptographic policy shall be established.", "is_mandatory": True, "implementation_guidance": "Define approved algorithms, key lengths.", "testing_guidance": "Review cryptographic policy."},
                        {"code": "SEC-2.2", "name": "Data Encryption", "statement": "Sensitive data shall be encrypted.", "is_mandatory": True, "implementation_guidance": "Implement encryption for data at rest and in transit.", "testing_guidance": "Verify encryption implementation."},
                        {"code": "SEC-2.3", "name": "Key Management", "statement": "Cryptographic keys shall be managed securely.", "is_mandatory": True, "implementation_guidance": "Implement key management procedures.", "testing_guidance": "Review key management."}
                    ]
                },
                {
                    "code": "SEC-3",
                    "name": "Security Monitoring",
                    "description": "Security event monitoring and logging",
                    "order": 3,
                    "controls": [
                        {"code": "SEC-3.1", "name": "Logging", "statement": "Security events shall be logged.", "is_mandatory": True, "implementation_guidance": "Define logging requirements, centralize logs.", "testing_guidance": "Review logging configurations."},
                        {"code": "SEC-3.2", "name": "SIEM", "statement": "Security monitoring shall be implemented.", "is_mandatory": True, "implementation_guidance": "Deploy SIEM, define use cases.", "testing_guidance": "Review SIEM implementation."},
                        {"code": "SEC-3.3", "name": "Incident Response", "statement": "Incident response procedures shall be established.", "is_mandatory": True, "implementation_guidance": "Develop IR plan, train team.", "testing_guidance": "Review IR plan and exercises."}
                    ]
                }
            ]
        }
    ]
    
    return _create_framework_structure(db, framework, domains_data)


def _create_framework_structure(db, framework, domains_data):
    """Helper to create framework domains, objectives, controls, and sub-controls."""
    controls = {}
    
    for domain_data in domains_data:
        domain = FrameworkDomain(
            framework_id=framework.id,
            code=domain_data["code"],
            name=domain_data["name"],
            description=domain_data.get("description"),
            order=domain_data.get("order", 0)
        )
        db.add(domain)
        db.flush()
        
        for obj_data in domain_data.get("objectives", []):
            objective = ControlObjective(
                domain_id=domain.id,
                code=obj_data["code"],
                name=obj_data["name"],
                description=obj_data.get("description"),
                order=obj_data.get("order", 0)
            )
            db.add(objective)
            db.flush()
            
            for ctrl_data in obj_data.get("controls", []):
                risk_cat, ev_type, ctrl_obj = _determine_control_attributes(
                    ctrl_data.get("name"), ctrl_data.get("statement")
                )
                
                control = FrameworkControl(
                    objective_id=objective.id,
                    code=ctrl_data["code"],
                    name=ctrl_data["name"],
                    statement=ctrl_data.get("statement"),
                    control_objective=ctrl_data.get("control_objective", ctrl_obj),
                    is_mandatory=ctrl_data.get("is_mandatory", True),
                    risk_category=ctrl_data.get("risk_category", risk_cat),
                    evidence_type=ctrl_data.get("evidence_type", ev_type),
                    implementation_guidance=ctrl_data.get("implementation_guidance"),
                    testing_guidance=ctrl_data.get("testing_guidance"),
                    order=ctrl_data.get("order", 0)
                )
                db.add(control)
                db.flush()
                
                controls[ctrl_data["code"]] = control
                
                for sub_data in ctrl_data.get("sub_controls", []):
                    sub_control = FrameworkSubControl(
                        control_id=control.id,
                        code=sub_data["code"],
                        name=sub_data["name"],
                        statement=sub_data.get("statement"),
                        order=sub_data.get("order", 0)
                    )
                    db.add(sub_control)
    
    return controls


def _seed_control_mappings(db, normalized_controls, framework_controls):
    """Create mappings between normalized controls and framework controls."""
    mappings = [
        ("NC-AC-001", ["7.1.1", "A.5.1.1", "5.2.1", "GV.OC-01", "1.1", "CS-1.2.1", "1.1.1", "GOV-1.3"], "direct"),
        ("NC-AC-002", ["7.2.1", "A.8.3", "7.2.1", "PR.AA-01", "2.1", "CS-3.2.1", "3.1.1", "SEC-1.1"], "direct"),
        ("NC-AC-003", ["8.4.2", "A.8.2", "7.2.1", "PR.AA-02", "3.2", "CS-3.2.3", "3.1.1", "SEC-1.3"], "direct"),
        ("NC-AC-004", ["8.3.1", "A.8.5", "7.2.1", "PR.AA-05", "3.2", "CS-3.2.2", "3.1.2", "SEC-1.2"], "direct"),
        ("NC-CM-001", ["2.2.1", "A.8.1.1", "8.5.3", "ID.AM-01", "2.3", "CS-3.1.1", "3.1.1", "OPS-3.1"], "direct"),
        ("NC-CM-002", ["6.2.1", "A.8.24", "8.5.1", "ID.AM-02", "2.2", "CS-3.1.2", "3.1.3", "OPS-3.1"], "direct"),
        ("NC-DP-001", ["3.1.1", "A.5.1.2", "7.5.1", "PR.DS-01", "2.5A", "CS-3.1.2", "3.1.4", "SEC-2.1"], "direct"),
        ("NC-DP-002", ["3.4.1", "A.8.24", "8.5.2", "PR.DS-02", "2.1", "CS-3.1.2", "3.1.4", "SEC-2.2"], "direct"),
        ("NC-DP-003", ["4.2.1", "A.8.22", "8.6.1", "PR.DS-10", "2.6", "CS-3.1.2", "3.1.4", "SEC-2.2"], "partial"),
        ("NC-NS-001", ["1.3.1", "A.8.22", "8.5.3", "PR.AA-05", "1.1", "CS-3.1.2", "3.1.2", "OPS-2.1"], "direct"),
        ("NC-NS-002", ["1.2.1", "A.8.20", "8.5.3", "PR.AA-05", "1.1", "CS-3.1.2", "3.1.2", "OPS-2.1"], "direct"),
        ("NC-VM-001", ["6.3.1", "A.5.7", "9.1.1", "ID.RA-01", "2.2", "CS-3.2.1", "3.2.1", "SEC-3.2"], "direct"),
        ("NC-VM-002", ["5.2.2", "A.8.21", "8.5.2", "ID.RA-06", "2.2", "CS-3.2.2", "3.2.2", "SEC-3.2"], "direct"),
        ("NC-IR-001", ["12.10.1", "A.5.8", "8.6.3", "RS.MA-01", "6.1", "CS-4.1.1", "3.2.3", "SEC-3.3"], "direct"),
        ("NC-IR-002", ["10.2.1", "A.5.7", "9.1.1", "DE.CM-01", "5.1", "CS-4.1.2", "3.2.1", "SEC-3.1"], "direct"),
        ("NC-BC-001", ["12.10.1", "A.5.8", "8.6.3", "RC.RP-01", "6.1", "CS-4.1.3", "3.2.3", "OPS-1.2"], "partial"),
        ("NC-BC-002", ["3.5.1", "A.7.10", "8.5.2", "RC.RP-03", "2.4A", "CS-3.1.2", "3.1.4", "OPS-1.2"], "direct"),
        ("NC-TP-001", ["12.1.1", "A.5.2.2", "8.3.1", "GV.RM-02", "4.1", "CS-2.1.3", "4.1.1", "GOV-2.2"], "direct"),
        ("NC-SA-001", ["12.6.1", "A.6.3", "7.2.1", "PR.AA-01", "4.1", "CS-1.2.2", "1.2.1", "GOV-2.2"], "direct"),
        ("NC-GV-001", ["12.1.1", "A.5.1.1", "5.1.1", "GV.OC-01", "1.1", "CS-1.1.1", "1.1.1", "GOV-1.1"], "direct"),
    ]
    
    for nc_code, fw_codes, mapping_type in mappings:
        if nc_code not in normalized_controls:
            continue
            
        nc = normalized_controls[nc_code]
        
        for fw_code in fw_codes:
            for fw_short_code, controls_dict in framework_controls.items():
                if fw_code in controls_dict:
                    fc = controls_dict[fw_code]
                    mapping = ControlMapping(
                        normalized_control_id=nc.id,
                        framework_control_id=fc.id,
                        mapping_type=mapping_type
                    )
                    db.add(mapping)
                    break


def _seed_required_evidence(db, normalized_controls):
    """Create required evidence items for normalized controls."""
    evidence_data = [
        ("NC-AC-001", [
            {"name": "Access Control Policy", "description": "Approved access control policy document", "evidence_type": "policy", "validation_criteria": "Must be approved by senior management, reviewed annually"},
            {"name": "Policy Distribution Records", "description": "Evidence of policy communication to personnel", "evidence_type": "documentation", "validation_criteria": "Signed acknowledgments or training completion records"},
        ]),
        ("NC-AC-002", [
            {"name": "Access Request Forms", "description": "Sample access request and approval documentation", "evidence_type": "documentation", "validation_criteria": "Must show proper authorization workflow"},
            {"name": "User Provisioning Logs", "description": "System logs showing access provisioning", "evidence_type": "system_log", "validation_criteria": "Logs must correlate with approved requests"},
            {"name": "Joiner/Mover/Leaver Process", "description": "Documented JML procedures", "evidence_type": "procedure", "validation_criteria": "Must cover all access lifecycle stages"},
        ]),
        ("NC-AC-003", [
            {"name": "PAM Solution Configuration", "description": "Privileged access management tool settings", "evidence_type": "configuration", "validation_criteria": "Must show session recording, approval workflow"},
            {"name": "Privileged Account Inventory", "description": "List of privileged accounts with justification", "evidence_type": "documentation", "validation_criteria": "All accounts must have documented business need"},
            {"name": "Privileged Access Logs", "description": "Logs of privileged access sessions", "evidence_type": "system_log", "validation_criteria": "Complete audit trail of privileged activities"},
        ]),
        ("NC-AC-004", [
            {"name": "MFA Configuration", "description": "Multi-factor authentication system configuration", "evidence_type": "configuration", "validation_criteria": "MFA enabled for all in-scope systems"},
            {"name": "Password Policy Configuration", "description": "System password policy settings", "evidence_type": "configuration", "validation_criteria": "Must meet complexity, length, age requirements"},
        ]),
        ("NC-CM-001", [
            {"name": "Configuration Baseline Documents", "description": "Approved hardening standards", "evidence_type": "documentation", "validation_criteria": "Based on CIS or vendor guidelines"},
            {"name": "Configuration Scan Reports", "description": "Automated configuration compliance scans", "evidence_type": "report", "validation_criteria": "Recent scan showing compliance percentage"},
        ]),
        ("NC-CM-002", [
            {"name": "Change Management Policy", "description": "Formal change management procedure", "evidence_type": "policy", "validation_criteria": "Must define CAB, categories, approvals"},
            {"name": "Change Records Sample", "description": "Sample of change tickets with approvals", "evidence_type": "documentation", "validation_criteria": "Must show complete change lifecycle"},
            {"name": "CAB Meeting Minutes", "description": "Change Advisory Board meeting records", "evidence_type": "documentation", "validation_criteria": "Regular meeting evidence with attendees"},
        ]),
        ("NC-DP-001", [
            {"name": "Data Classification Policy", "description": "Data classification scheme document", "evidence_type": "policy", "validation_criteria": "Must define classification levels and handling"},
            {"name": "Data Inventory", "description": "Inventory of classified data assets", "evidence_type": "documentation", "validation_criteria": "All sensitive data identified and labeled"},
        ]),
        ("NC-DP-002", [
            {"name": "Encryption Standards", "description": "Approved cryptographic standards document", "evidence_type": "policy", "validation_criteria": "Must specify approved algorithms and key lengths"},
            {"name": "Encryption Implementation Evidence", "description": "Configuration showing encryption in use", "evidence_type": "configuration", "validation_criteria": "TLS 1.2+ for transit, AES-256 for rest"},
            {"name": "Key Management Procedures", "description": "Cryptographic key management documentation", "evidence_type": "procedure", "validation_criteria": "Complete key lifecycle management"},
        ]),
        ("NC-DP-003", [
            {"name": "DLP Policy Configuration", "description": "Data loss prevention tool policies", "evidence_type": "configuration", "validation_criteria": "Policies covering sensitive data patterns"},
            {"name": "DLP Incident Reports", "description": "Sample DLP alerts and investigations", "evidence_type": "report", "validation_criteria": "Evidence of effective detection"},
        ]),
        ("NC-NS-001", [
            {"name": "Network Architecture Diagram", "description": "Current network topology showing segmentation", "evidence_type": "documentation", "validation_criteria": "Must show security zones and boundaries"},
            {"name": "Firewall Rule Set", "description": "Firewall rules implementing segmentation", "evidence_type": "configuration", "validation_criteria": "Rules align with documented architecture"},
        ]),
        ("NC-NS-002", [
            {"name": "Firewall Management Policy", "description": "Firewall administration procedures", "evidence_type": "policy", "validation_criteria": "Must cover rule change process, reviews"},
            {"name": "Firewall Rule Review Evidence", "description": "Quarterly firewall rule review records", "evidence_type": "documentation", "validation_criteria": "All rules justified and approved"},
        ]),
        ("NC-VM-001", [
            {"name": "Vulnerability Scan Reports", "description": "Recent internal and external scan results", "evidence_type": "report", "validation_criteria": "Scans within last 90 days"},
            {"name": "Vulnerability Remediation Tracking", "description": "Remediation status and timelines", "evidence_type": "documentation", "validation_criteria": "SLA compliance for critical/high findings"},
        ]),
        ("NC-VM-002", [
            {"name": "Patch Management Policy", "description": "Patching procedures and SLAs", "evidence_type": "policy", "validation_criteria": "Defined timelines by severity"},
            {"name": "Patch Compliance Reports", "description": "System patch status reports", "evidence_type": "report", "validation_criteria": "Compliance percentage meets target"},
        ]),
        ("NC-IR-001", [
            {"name": "Incident Response Plan", "description": "Documented incident response procedures", "evidence_type": "policy", "validation_criteria": "Must cover detection, containment, recovery"},
            {"name": "IR Team Roster", "description": "Incident response team members and contacts", "evidence_type": "documentation", "validation_criteria": "Current team with defined roles"},
            {"name": "IR Exercise Results", "description": "Tabletop or simulation exercise reports", "evidence_type": "report", "validation_criteria": "Annual exercise with lessons learned"},
        ]),
        ("NC-IR-002", [
            {"name": "SIEM Configuration", "description": "Security monitoring tool setup", "evidence_type": "configuration", "validation_criteria": "Must show log sources, use cases, alerts"},
            {"name": "Alert Handling Procedures", "description": "SOC alert triage and escalation procedures", "evidence_type": "procedure", "validation_criteria": "Defined response times and escalation"},
            {"name": "Monitoring Coverage Report", "description": "Log source inventory and coverage analysis", "evidence_type": "report", "validation_criteria": "All critical systems in scope"},
        ]),
        ("NC-BC-001", [
            {"name": "Business Impact Analysis", "description": "BIA identifying critical functions", "evidence_type": "documentation", "validation_criteria": "Defines RTO/RPO for critical systems"},
            {"name": "Business Continuity Plan", "description": "BC procedures for critical functions", "evidence_type": "policy", "validation_criteria": "Aligned with BIA findings"},
            {"name": "BC Test Results", "description": "Annual BC test documentation", "evidence_type": "report", "validation_criteria": "Successful test within last 12 months"},
        ]),
        ("NC-BC-002", [
            {"name": "Backup Policy", "description": "Backup procedures and schedules", "evidence_type": "policy", "validation_criteria": "Defined schedules, retention, offsite storage"},
            {"name": "Backup Logs", "description": "System backup completion logs", "evidence_type": "system_log", "validation_criteria": "Successful backup evidence"},
            {"name": "Recovery Test Results", "description": "Restore test documentation", "evidence_type": "report", "validation_criteria": "Successful restore within RTO"},
        ]),
        ("NC-TP-001", [
            {"name": "Vendor Risk Assessment", "description": "Third party security assessment results", "evidence_type": "report", "validation_criteria": "Assessment within last 12 months"},
            {"name": "Vendor Contracts", "description": "Contracts with security requirements", "evidence_type": "documentation", "validation_criteria": "Security clauses included"},
            {"name": "Vendor Monitoring Records", "description": "Ongoing vendor security monitoring", "evidence_type": "documentation", "validation_criteria": "Regular security status reviews"},
        ]),
        ("NC-SA-001", [
            {"name": "Security Awareness Program", "description": "Training program documentation", "evidence_type": "documentation", "validation_criteria": "Covers key security topics"},
            {"name": "Training Completion Records", "description": "Employee training completion evidence", "evidence_type": "report", "validation_criteria": "High completion rate (>95%)"},
            {"name": "Phishing Test Results", "description": "Phishing simulation results", "evidence_type": "report", "validation_criteria": "Click rates and improvement trends"},
        ]),
        ("NC-GV-001", [
            {"name": "Security Governance Charter", "description": "Security committee charter and structure", "evidence_type": "documentation", "validation_criteria": "Defined roles, responsibilities, reporting"},
            {"name": "Governance Meeting Minutes", "description": "Security committee meeting records", "evidence_type": "documentation", "validation_criteria": "Regular meetings with documented decisions"},
            {"name": "Board Security Reports", "description": "Security status reports to board", "evidence_type": "report", "validation_criteria": "Regular reporting cadence"},
        ]),
    ]
    
    for nc_code, evidences in evidence_data:
        if nc_code not in normalized_controls:
            continue
            
        nc = normalized_controls[nc_code]
        
        for ev_data in evidences:
            evidence = GRCRequiredEvidence(
                normalized_control_id=nc.id,
                name=ev_data["name"],
                description=ev_data["description"],
                evidence_type=ev_data["evidence_type"],
                validation_criteria=ev_data["validation_criteria"]
            )
            db.add(evidence)



# =============================================================================
# New Framework Seeder - Seeds from JSON files
# =============================================================================

def get_seed_data_dir() -> str:
    """Get the path to the seed data frameworks directory."""
    return os.path.join(
        os.path.dirname(os.path.abspath(__file__)),
        "seed_data", "frameworks"
    )


def load_framework_json(file_path: str) -> Optional[Dict[str, Any]]:
    """
    Load a framework JSON file.
    
    Args:
        file_path: Path to the JSON file
        
    Returns:
        Parsed JSON data or None if file cannot be loaded
    """
    try:
        with open(file_path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        print(f"Error loading {file_path}: {e}")
        return None


def framework_exists(db, name: str, tenant_id: int = None) -> bool:
    """
    Check if a framework with the given name already exists.
    
    Args:
        db: Database session
        name: Framework name to check
        tenant_id: Optional tenant ID to scope the check
        
    Returns:
        True if framework exists, False otherwise
    """
    query = db.query(UploadedFramework).filter(UploadedFramework.name == name)
    if tenant_id:
        query = query.filter(UploadedFramework.tenant_id == tenant_id)
    return query.first() is not None


def deactivate_existing_frameworks(db, name: str, tenant_id: int = None) -> int:
    """Soft-hide existing frameworks with the same name so replacements stay clean."""
    query = db.query(UploadedFramework).filter(UploadedFramework.name == name)
    if tenant_id:
        query = query.filter(UploadedFramework.tenant_id == tenant_id)
    updated = query.update({"is_active": False}, synchronize_session=False)
    if updated:
        print(f"Deactivated {updated} existing framework(s) named '{name}'")
    return updated


def get_default_tenant(db) -> Optional[int]:
    """Get the default tenant ID (first tenant or create one)."""
    tenant = db.query(Tenant).first()
    if tenant:
        return tenant.id
    return None


def seed_framework_from_json(db, data: Dict[str, Any], tenant_id: int = None, 
                              uploaded_by: int = 1, force: bool = False) -> Optional[UploadedFramework]:
    """
    Seed a single framework from JSON data.
    
    Args:
        db: Database session
        data: Parsed JSON data containing metadata and controls
        tenant_id: Tenant ID to associate the framework with
        uploaded_by: User ID who uploaded the framework (defaults to 1)
        force: If True, skip existence check
        
    Returns:
        Created UploadedFramework or None if skipped
    """
    metadata = data.get("metadata", {})
    controls = data.get("controls", [])
    
    name = metadata.get("name")
    if not name:
        print("Framework JSON missing 'name' in metadata")
        return None
    
    if force:
        deactivate_existing_frameworks(db, name, tenant_id)
    
    # Check if framework already exists (idempotent)
    if not force and framework_exists(db, name, tenant_id):
        print(f"Framework '{name}' already exists, skipping...")
        return None
    
    # Parse dates
    effective_date = None
    if metadata.get("effective_date"):
        try:
            effective_date = datetime.fromisoformat(metadata["effective_date"].replace("Z", "+00:00"))
        except (ValueError, TypeError):
            pass
    
    compliance_deadline = None
    if metadata.get("compliance_deadline"):
        try:
            compliance_deadline = datetime.fromisoformat(metadata["compliance_deadline"].replace("Z", "+00:00"))
        except (ValueError, TypeError):
            pass
    
    # Create the UploadedFramework record
    framework = UploadedFramework(
        tenant_id=tenant_id,
        name=name,
        description=metadata.get("description"),
        file_name=f"{name.lower().replace(' ', '_')}_seeded.json",
        file_path=f"seed_data/frameworks/{name.lower().replace(' ', '_')}.json",
        file_size=0,
        file_type="json",
        upload_status="parsed",
        parsed_at=datetime.utcnow(),
        
        # Classification fields
        classification=metadata.get("classification", "compliance"),
        classification_confidence=metadata.get("classification_confidence"),
        classification_reasoning=metadata.get("classification_reasoning"),
        
        # Basic metadata
        framework_type=metadata.get("framework_type", "regulatory"),
        source_organization=metadata.get("source_organization"),
        version=metadata.get("version"),
        effective_date=effective_date,
        
        # Pre-processing overview
        framework_purpose=metadata.get("framework_purpose"),
        framework_scope=metadata.get("framework_scope"),
        framework_objectives=metadata.get("framework_objectives"),
        target_audience=metadata.get("target_audience"),
        
        # Certification-specific fields
        certification_body=metadata.get("certification_body"),
        certification_validity_period=metadata.get("certification_validity_period"),
        certification_levels=metadata.get("certification_levels"),
        certification_lifecycle=metadata.get("certification_lifecycle"),
        required_artifacts=metadata.get("required_artifacts"),
        
        # Compliance-specific fields
        regulatory_authority=metadata.get("regulatory_authority"),
        compliance_deadline=compliance_deadline,
        penalty_for_non_compliance=metadata.get("penalty_for_non_compliance"),
        adoption_approach=metadata.get("adoption_approach"),
        
        # Structure
        hierarchy_structure=metadata.get("hierarchy_structure"),
        document_structure=metadata.get("document_structure"),
        
        # Sharing and status
        is_shared=True,  # Make seeded frameworks available to all tenants
        is_active=True,
        uploaded_by=uploaded_by
    )
    
    db.add(framework)
    db.flush()  # Get the framework ID
    
    # Create ParsedFrameworkControl records for each control
    evidence_req_count = 0
    for control_data in controls:
        control = ParsedFrameworkControl(
            uploaded_framework_id=framework.id,
            control_id=control_data.get("control_id", ""),
            original_reference=control_data.get("original_reference"),
            title=control_data.get("title", ""),
            description=control_data.get("description"),
            full_text=control_data.get("full_text"),
            domain=control_data.get("domain"),
            category=control_data.get("category"),
            is_mandatory=control_data.get("is_mandatory", True),
            priority=control_data.get("priority", "medium"),
            section_number=control_data.get("section_number"),
            parent_section=control_data.get("parent_section"),
            ai_confidence=control_data.get("ai_confidence"),
            ai_notes=control_data.get("ai_notes"),
            evidence_requirements=control_data.get("evidence_requirements", []),
            is_verified=False
        )
        db.add(control)
        db.flush()  # Get the control ID
        
        # Create ControlEvidenceRequirement records from the embedded evidence_requirements
        evidence_reqs = control_data.get("evidence_requirements", [])
        for idx, ev_req in enumerate(evidence_reqs):
            # Handle both string and dict formats
            if isinstance(ev_req, str):
                # Simple string format - convert to full record
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
                    priority=control_data.get("priority", "medium"),
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
                    priority=ev_req.get("priority", control_data.get("priority", "medium")),
                    display_order=idx + 1,
                    is_mandatory=ev_req.get("is_mandatory", True),
                    is_active=True
                )
            else:
                continue
            
            db.add(evidence_record)
            evidence_req_count += 1
    
    print(f"Seeded framework '{name}' with {len(controls)} controls and {evidence_req_count} evidence requirements")
    return framework


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


def seed_uploaded_frameworks(seed_dir: str = None, tenant_id: int = None, 
                              uploaded_by: int = 1, force: bool = False) -> List[UploadedFramework]:
    """
    Seed all frameworks from JSON files in the seed directory.
    
    This function is idempotent - it will skip frameworks that already exist
    (by name) unless force=True.
    
    Args:
        seed_dir: Directory containing JSON files (defaults to seed_data/frameworks)
        tenant_id: Tenant ID to associate frameworks with (defaults to first tenant)
        uploaded_by: User ID for the uploaded_by field
        force: If True, re-seed even if frameworks exist
        
    Returns:
        List of created UploadedFramework objects
    """
    if seed_dir is None:
        seed_dir = get_seed_data_dir()
    
    if not os.path.exists(seed_dir):
        print(f"Seed directory not found: {seed_dir}")
        return []
    
    # Find all JSON files
    json_files = [f for f in os.listdir(seed_dir) if f.endswith(".json")]
    
    if not json_files:
        print(f"No JSON files found in {seed_dir}")
        return []
    
    print(f"Found {len(json_files)} framework JSON file(s) to seed")
    
    db = SessionLocal()
    seeded_frameworks = []
    
    try:
        # Get default tenant if not specified
        if tenant_id is None:
            tenant_id = get_default_tenant(db)
        
        for json_file in json_files:
            file_path = os.path.join(seed_dir, json_file)
            data = load_framework_json(file_path)
            
            if data is None:
                continue
            
            framework = seed_framework_from_json(
                db, data, tenant_id=tenant_id, 
                uploaded_by=uploaded_by, force=force
            )
            
            if framework:
                seeded_frameworks.append(framework)
        
        db.commit()
        print(f"\nSuccessfully seeded {len(seeded_frameworks)} framework(s)")
        
    except Exception as e:
        db.rollback()
        print(f"Error seeding frameworks: {e}")
        raise
    finally:
        db.close()
    
    return seeded_frameworks


def seed_single_framework(json_path: str, tenant_id: int = None, 
                           uploaded_by: int = 1, force: bool = False) -> Optional[UploadedFramework]:
    """
    Seed a single framework from a specific JSON file.
    
    Args:
        json_path: Path to the JSON file
        tenant_id: Tenant ID to associate with
        uploaded_by: User ID for uploaded_by field
        force: If True, re-seed even if framework exists
        
    Returns:
        Created UploadedFramework or None
    """
    data = load_framework_json(json_path)
    if data is None:
        return None
    
    db = SessionLocal()
    try:
        if tenant_id is None:
            tenant_id = get_default_tenant(db)
        
        framework = seed_framework_from_json(
            db, data, tenant_id=tenant_id,
            uploaded_by=uploaded_by, force=force
        )
        
        db.commit()
        return framework
        
    except Exception as e:
        db.rollback()
        print(f"Error seeding framework: {e}")
        raise
    finally:
        db.close()


# CLI support
if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(description="Seed GRC frameworks from JSON files")
    parser.add_argument(
        "--seed-dir",
        type=str,
        default=None,
        help="Directory containing JSON files to seed"
    )
    parser.add_argument(
        "--json-file",
        type=str,
        default=None,
        help="Single JSON file to seed"
    )
    parser.add_argument(
        "--tenant-id",
        type=int,
        default=None,
        help="Tenant ID to associate frameworks with"
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Force re-seeding even if frameworks exist"
    )
    
    args = parser.parse_args()
    
    if args.json_file:
        seed_single_framework(args.json_file, args.tenant_id, force=args.force)
    else:
        seed_uploaded_frameworks(args.seed_dir, args.tenant_id, force=args.force)
