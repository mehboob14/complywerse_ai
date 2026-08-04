"""
Seed sub-controls with evidence recommendations for all framework controls.
Generates 2-5 sub-controls per control with appropriate evidence types and AI keywords.
"""

from .models import SessionLocal, Framework, FrameworkControl, FrameworkSubControl

EVIDENCE_TYPES = [
    "policy_document",
    "procedure_document",
    "screenshot",
    "audit_log",
    "configuration_export",
    "training_record",
    "risk_assessment",
    "penetration_test_report",
    "vulnerability_scan",
    "access_review",
    "change_request",
    "incident_report",
    "backup_log",
    "encryption_certificate"
]

FRAMEWORK_SUBCONTROL_TEMPLATES = {
    "PCI_DSS": {
        "categories": {
            "network": {
                "sub_controls": [
                    {"suffix": "a", "name": "Document network security requirements", "description": "Create and maintain documentation defining network security requirements, boundaries, and configurations.", "evidence": ["policy_document", "procedure_document", "configuration_export"], "keywords": ["network", "firewall", "documentation", "policy", "segmentation"]},
                    {"suffix": "b", "name": "Implement network segmentation controls", "description": "Deploy and configure network segmentation to isolate the cardholder data environment from other networks.", "evidence": ["configuration_export", "screenshot", "audit_log"], "keywords": ["segmentation", "VLAN", "firewall", "ACL", "network zones"]},
                    {"suffix": "c", "name": "Monitor network security events", "description": "Implement continuous monitoring of network security controls and events.", "evidence": ["audit_log", "screenshot", "configuration_export"], "keywords": ["monitoring", "SIEM", "alerts", "network traffic", "IDS"]},
                    {"suffix": "d", "name": "Review network security configurations", "description": "Perform periodic review of network security configurations against standards.", "evidence": ["configuration_export", "audit_log", "change_request"], "keywords": ["review", "configuration", "baseline", "compliance"]}
                ]
            },
            "access": {
                "sub_controls": [
                    {"suffix": "a", "name": "Define access control policies", "description": "Establish and document access control policies covering user provisioning, authentication, and authorization.", "evidence": ["policy_document", "procedure_document"], "keywords": ["access control", "policy", "authorization", "user management"]},
                    {"suffix": "b", "name": "Implement user provisioning procedures", "description": "Deploy formal user registration and de-registration processes with approval workflows.", "evidence": ["procedure_document", "access_review", "audit_log"], "keywords": ["provisioning", "user account", "access request", "approval"]},
                    {"suffix": "c", "name": "Enforce authentication requirements", "description": "Configure and maintain strong authentication mechanisms including password policies and MFA.", "evidence": ["configuration_export", "screenshot", "audit_log"], "keywords": ["authentication", "MFA", "password", "login", "identity"]},
                    {"suffix": "d", "name": "Conduct periodic access reviews", "description": "Perform regular reviews of user access rights and permissions.", "evidence": ["access_review", "audit_log", "procedure_document"], "keywords": ["access review", "recertification", "permissions", "user access"]}
                ]
            },
            "encryption": {
                "sub_controls": [
                    {"suffix": "a", "name": "Document encryption requirements", "description": "Define and document cryptographic requirements for protecting cardholder data.", "evidence": ["policy_document", "procedure_document"], "keywords": ["encryption", "cryptography", "policy", "data protection"]},
                    {"suffix": "b", "name": "Implement data encryption at rest", "description": "Deploy encryption for stored cardholder data using strong cryptographic algorithms.", "evidence": ["configuration_export", "screenshot", "encryption_certificate"], "keywords": ["encryption at rest", "AES", "database encryption", "disk encryption"]},
                    {"suffix": "c", "name": "Implement data encryption in transit", "description": "Configure TLS/SSL for all transmissions of cardholder data.", "evidence": ["configuration_export", "screenshot", "encryption_certificate"], "keywords": ["TLS", "SSL", "encryption in transit", "HTTPS", "certificate"]},
                    {"suffix": "d", "name": "Manage cryptographic keys", "description": "Implement secure key management procedures including generation, storage, rotation, and destruction.", "evidence": ["procedure_document", "audit_log", "configuration_export"], "keywords": ["key management", "HSM", "key rotation", "cryptographic keys"]}
                ]
            },
            "vulnerability": {
                "sub_controls": [
                    {"suffix": "a", "name": "Define vulnerability management procedures", "description": "Document vulnerability identification, assessment, and remediation procedures.", "evidence": ["policy_document", "procedure_document"], "keywords": ["vulnerability management", "policy", "remediation", "scanning"]},
                    {"suffix": "b", "name": "Perform vulnerability scans", "description": "Conduct regular internal and external vulnerability scans.", "evidence": ["vulnerability_scan", "audit_log"], "keywords": ["vulnerability scan", "ASV", "internal scan", "CVE"]},
                    {"suffix": "c", "name": "Remediate identified vulnerabilities", "description": "Track and remediate vulnerabilities within defined SLAs based on severity.", "evidence": ["vulnerability_scan", "change_request", "audit_log"], "keywords": ["remediation", "patching", "vulnerability fix", "SLA"]},
                    {"suffix": "d", "name": "Conduct penetration testing", "description": "Perform annual penetration testing of network and application layers.", "evidence": ["penetration_test_report", "audit_log"], "keywords": ["penetration test", "pentest", "security assessment", "ethical hacking"]}
                ]
            },
            "monitoring": {
                "sub_controls": [
                    {"suffix": "a", "name": "Define logging requirements", "description": "Document logging requirements for all systems in the cardholder data environment.", "evidence": ["policy_document", "procedure_document"], "keywords": ["logging", "audit trail", "event logging", "policy"]},
                    {"suffix": "b", "name": "Implement audit logging", "description": "Configure systems to generate and store audit logs for security-relevant events.", "evidence": ["configuration_export", "screenshot", "audit_log"], "keywords": ["audit log", "SIEM", "log collection", "event correlation"]},
                    {"suffix": "c", "name": "Protect log integrity", "description": "Implement controls to prevent unauthorized modification or deletion of logs.", "evidence": ["configuration_export", "screenshot", "audit_log"], "keywords": ["log integrity", "tamper protection", "write-once", "log archive"]},
                    {"suffix": "d", "name": "Review security events", "description": "Conduct daily review of security logs and alerts.", "evidence": ["audit_log", "procedure_document", "incident_report"], "keywords": ["log review", "security monitoring", "alert analysis", "SOC"]}
                ]
            },
            "policy": {
                "sub_controls": [
                    {"suffix": "a", "name": "Develop security policies", "description": "Create comprehensive security policies addressing all PCI DSS requirements.", "evidence": ["policy_document"], "keywords": ["security policy", "information security", "governance", "standards"]},
                    {"suffix": "b", "name": "Communicate policies to personnel", "description": "Ensure all relevant personnel acknowledge and understand security policies.", "evidence": ["training_record", "policy_document", "audit_log"], "keywords": ["policy communication", "acknowledgment", "awareness", "training"]},
                    {"suffix": "c", "name": "Review and update policies", "description": "Conduct annual review of security policies and update as needed.", "evidence": ["policy_document", "change_request", "audit_log"], "keywords": ["policy review", "annual review", "update", "revision"]}
                ]
            },
            "incident": {
                "sub_controls": [
                    {"suffix": "a", "name": "Define incident response procedures", "description": "Establish and document incident response plan with roles and responsibilities.", "evidence": ["policy_document", "procedure_document"], "keywords": ["incident response", "IRP", "security incident", "breach"]},
                    {"suffix": "b", "name": "Train incident response team", "description": "Provide training to incident response team members.", "evidence": ["training_record", "procedure_document"], "keywords": ["IR training", "incident handling", "response team", "tabletop"]},
                    {"suffix": "c", "name": "Test incident response capabilities", "description": "Conduct annual testing of incident response procedures.", "evidence": ["incident_report", "training_record", "audit_log"], "keywords": ["IR test", "simulation", "exercise", "drill"]}
                ]
            },
            "antimalware": {
                "sub_controls": [
                    {"suffix": "a", "name": "Deploy anti-malware solution", "description": "Install and configure enterprise anti-malware on all applicable systems.", "evidence": ["configuration_export", "screenshot"], "keywords": ["antivirus", "anti-malware", "endpoint protection", "EDR"]},
                    {"suffix": "b", "name": "Maintain anti-malware updates", "description": "Configure automatic updates for anti-malware signatures.", "evidence": ["screenshot", "audit_log", "configuration_export"], "keywords": ["signature update", "malware definition", "auto-update"]},
                    {"suffix": "c", "name": "Monitor anti-malware alerts", "description": "Review and respond to anti-malware alerts and detections.", "evidence": ["audit_log", "incident_report"], "keywords": ["malware detection", "alert", "quarantine", "threat"]}
                ]
            }
        }
    },
    "ISO_27001": {
        "categories": {
            "governance": {
                "sub_controls": [
                    {"suffix": "a", "name": "Establish information security governance", "description": "Define and implement information security management framework with clear roles and responsibilities.", "evidence": ["policy_document", "procedure_document"], "keywords": ["governance", "ISMS", "management framework", "security committee"]},
                    {"suffix": "b", "name": "Assign security responsibilities", "description": "Document and communicate information security responsibilities across the organization.", "evidence": ["policy_document", "procedure_document", "training_record"], "keywords": ["responsibilities", "RACI", "security roles", "accountability"]},
                    {"suffix": "c", "name": "Conduct management reviews", "description": "Perform regular management reviews of the ISMS effectiveness.", "evidence": ["audit_log", "policy_document"], "keywords": ["management review", "ISMS review", "effectiveness", "improvement"]}
                ]
            },
            "risk": {
                "sub_controls": [
                    {"suffix": "a", "name": "Establish risk assessment methodology", "description": "Define and document information security risk assessment methodology.", "evidence": ["policy_document", "procedure_document", "risk_assessment"], "keywords": ["risk methodology", "risk framework", "assessment criteria"]},
                    {"suffix": "b", "name": "Conduct risk assessments", "description": "Perform systematic information security risk assessments.", "evidence": ["risk_assessment", "audit_log"], "keywords": ["risk assessment", "threat analysis", "vulnerability analysis", "risk register"]},
                    {"suffix": "c", "name": "Implement risk treatment", "description": "Develop and implement risk treatment plans for identified risks.", "evidence": ["risk_assessment", "procedure_document", "change_request"], "keywords": ["risk treatment", "mitigation", "risk acceptance", "controls"]},
                    {"suffix": "d", "name": "Monitor and review risks", "description": "Continuously monitor risk status and effectiveness of treatments.", "evidence": ["risk_assessment", "audit_log"], "keywords": ["risk monitoring", "KRI", "risk review", "residual risk"]}
                ]
            },
            "asset": {
                "sub_controls": [
                    {"suffix": "a", "name": "Maintain asset inventory", "description": "Create and maintain inventory of information assets.", "evidence": ["procedure_document", "configuration_export", "audit_log"], "keywords": ["asset inventory", "asset register", "CMDB", "asset management"]},
                    {"suffix": "b", "name": "Classify information assets", "description": "Apply classification scheme to information assets based on sensitivity.", "evidence": ["policy_document", "procedure_document"], "keywords": ["classification", "data classification", "sensitivity", "labeling"]},
                    {"suffix": "c", "name": "Assign asset ownership", "description": "Designate owners for all information assets.", "evidence": ["procedure_document", "audit_log"], "keywords": ["asset owner", "ownership", "custodian", "accountability"]}
                ]
            },
            "access_control": {
                "sub_controls": [
                    {"suffix": "a", "name": "Define access control policy", "description": "Establish access control policy based on business and security requirements.", "evidence": ["policy_document"], "keywords": ["access policy", "authorization", "access rights", "least privilege"]},
                    {"suffix": "b", "name": "Implement access provisioning", "description": "Deploy formal user access provisioning and de-provisioning procedures.", "evidence": ["procedure_document", "access_review", "audit_log"], "keywords": ["provisioning", "access request", "joiner mover leaver", "account creation"]},
                    {"suffix": "c", "name": "Manage privileged access", "description": "Control and monitor the use of privileged access rights.", "evidence": ["access_review", "audit_log", "configuration_export"], "keywords": ["privileged access", "admin rights", "PAM", "elevated privileges"]},
                    {"suffix": "d", "name": "Review user access rights", "description": "Conduct periodic reviews of user access rights.", "evidence": ["access_review", "audit_log"], "keywords": ["access review", "recertification", "access audit", "permissions review"]}
                ]
            },
            "cryptography": {
                "sub_controls": [
                    {"suffix": "a", "name": "Define cryptographic policy", "description": "Establish policy on the use of cryptographic controls.", "evidence": ["policy_document"], "keywords": ["cryptography policy", "encryption standards", "key management"]},
                    {"suffix": "b", "name": "Implement encryption controls", "description": "Deploy encryption for sensitive data protection.", "evidence": ["configuration_export", "screenshot", "encryption_certificate"], "keywords": ["encryption", "data protection", "cryptographic controls"]},
                    {"suffix": "c", "name": "Manage cryptographic keys", "description": "Implement key management throughout the key lifecycle.", "evidence": ["procedure_document", "audit_log"], "keywords": ["key management", "key lifecycle", "key rotation", "HSM"]}
                ]
            },
            "physical": {
                "sub_controls": [
                    {"suffix": "a", "name": "Define physical security perimeter", "description": "Establish physical security perimeters to protect information facilities.", "evidence": ["policy_document", "procedure_document"], "keywords": ["physical security", "perimeter", "secure areas", "access zones"]},
                    {"suffix": "b", "name": "Implement physical entry controls", "description": "Deploy physical entry controls for secure areas.", "evidence": ["procedure_document", "audit_log", "screenshot"], "keywords": ["entry controls", "badge access", "visitor management", "physical access"]},
                    {"suffix": "c", "name": "Protect against environmental threats", "description": "Implement protection against environmental threats.", "evidence": ["procedure_document", "configuration_export"], "keywords": ["environmental controls", "fire protection", "flood protection", "climate control"]}
                ]
            },
            "operations": {
                "sub_controls": [
                    {"suffix": "a", "name": "Document operating procedures", "description": "Document and maintain operational procedures.", "evidence": ["procedure_document"], "keywords": ["operating procedures", "SOP", "runbook", "operational documentation"]},
                    {"suffix": "b", "name": "Implement change management", "description": "Control changes to systems and applications.", "evidence": ["procedure_document", "change_request", "audit_log"], "keywords": ["change management", "change control", "CAB", "change process"]},
                    {"suffix": "c", "name": "Separate development environments", "description": "Separate development, testing, and production environments.", "evidence": ["configuration_export", "procedure_document"], "keywords": ["environment separation", "DTAP", "production isolation", "test environment"]}
                ]
            },
            "communications": {
                "sub_controls": [
                    {"suffix": "a", "name": "Implement network controls", "description": "Manage and control networks to protect information.", "evidence": ["configuration_export", "screenshot"], "keywords": ["network security", "network controls", "segmentation", "firewall"]},
                    {"suffix": "b", "name": "Secure information transfer", "description": "Protect information in transit.", "evidence": ["configuration_export", "encryption_certificate"], "keywords": ["data transfer", "secure transmission", "TLS", "email security"]},
                    {"suffix": "c", "name": "Protect electronic messaging", "description": "Protect information in electronic messaging.", "evidence": ["configuration_export", "policy_document"], "keywords": ["email security", "messaging", "electronic communications"]}
                ]
            },
            "supplier": {
                "sub_controls": [
                    {"suffix": "a", "name": "Define supplier security policy", "description": "Define information security requirements for suppliers.", "evidence": ["policy_document", "procedure_document"], "keywords": ["supplier security", "vendor policy", "third party", "outsourcing"]},
                    {"suffix": "b", "name": "Assess supplier security", "description": "Assess security risks of supplier relationships.", "evidence": ["risk_assessment", "audit_log"], "keywords": ["vendor assessment", "supplier audit", "due diligence", "third party risk"]},
                    {"suffix": "c", "name": "Monitor supplier services", "description": "Monitor and review supplier service delivery.", "evidence": ["audit_log", "procedure_document"], "keywords": ["vendor monitoring", "SLA review", "supplier performance", "contract compliance"]}
                ]
            },
            "incident_mgmt": {
                "sub_controls": [
                    {"suffix": "a", "name": "Define incident management procedures", "description": "Establish responsibilities and procedures for incident management.", "evidence": ["policy_document", "procedure_document"], "keywords": ["incident management", "security incident", "response procedures"]},
                    {"suffix": "b", "name": "Report security events", "description": "Implement security event reporting procedures.", "evidence": ["procedure_document", "incident_report"], "keywords": ["incident reporting", "security events", "escalation", "notification"]},
                    {"suffix": "c", "name": "Respond to security incidents", "description": "Respond to security incidents according to documented procedures.", "evidence": ["incident_report", "audit_log"], "keywords": ["incident response", "containment", "eradication", "recovery"]},
                    {"suffix": "d", "name": "Learn from security incidents", "description": "Use knowledge from incidents to improve security.", "evidence": ["incident_report", "procedure_document"], "keywords": ["lessons learned", "post-incident", "improvement", "root cause"]}
                ]
            },
            "continuity": {
                "sub_controls": [
                    {"suffix": "a", "name": "Plan information security continuity", "description": "Establish requirements for information security continuity.", "evidence": ["policy_document", "procedure_document"], "keywords": ["business continuity", "security continuity", "disaster recovery", "BCP"]},
                    {"suffix": "b", "name": "Implement continuity controls", "description": "Implement controls to ensure continuity of information security.", "evidence": ["procedure_document", "backup_log", "configuration_export"], "keywords": ["DR controls", "redundancy", "failover", "backup"]},
                    {"suffix": "c", "name": "Test continuity arrangements", "description": "Test information security continuity arrangements.", "evidence": ["audit_log", "procedure_document"], "keywords": ["BCP test", "DR test", "continuity exercise", "recovery test"]}
                ]
            },
            "compliance": {
                "sub_controls": [
                    {"suffix": "a", "name": "Identify legal requirements", "description": "Identify and document applicable legal, regulatory, and contractual requirements.", "evidence": ["policy_document", "procedure_document"], "keywords": ["legal requirements", "regulatory compliance", "contractual obligations"]},
                    {"suffix": "b", "name": "Protect records", "description": "Protect records from loss, destruction, and falsification.", "evidence": ["procedure_document", "audit_log"], "keywords": ["records management", "record retention", "data protection", "archive"]},
                    {"suffix": "c", "name": "Conduct independent audits", "description": "Conduct independent reviews of information security.", "evidence": ["audit_log", "procedure_document"], "keywords": ["internal audit", "security audit", "independent review", "assessment"]}
                ]
            }
        }
    },
    "ISO_20000": {
        "categories": {
            "service_mgmt": {
                "sub_controls": [
                    {"suffix": "a", "name": "Define service management policy", "description": "Establish service management policy and objectives.", "evidence": ["policy_document"], "keywords": ["service management", "SMS", "ITSM", "service policy"]},
                    {"suffix": "b", "name": "Implement service management system", "description": "Implement and maintain service management system.", "evidence": ["procedure_document", "audit_log"], "keywords": ["SMS implementation", "service processes", "ITIL", "service framework"]},
                    {"suffix": "c", "name": "Review service management performance", "description": "Monitor and review SMS performance.", "evidence": ["audit_log", "procedure_document"], "keywords": ["SMS review", "performance metrics", "KPI", "service improvement"]}
                ]
            },
            "service_design": {
                "sub_controls": [
                    {"suffix": "a", "name": "Define service requirements", "description": "Document service requirements and specifications.", "evidence": ["procedure_document", "policy_document"], "keywords": ["service requirements", "SLA", "service specification", "design"]},
                    {"suffix": "b", "name": "Design services", "description": "Design services to meet requirements.", "evidence": ["procedure_document", "change_request"], "keywords": ["service design", "architecture", "capacity", "availability"]},
                    {"suffix": "c", "name": "Transition services", "description": "Plan and manage service transitions.", "evidence": ["change_request", "procedure_document", "audit_log"], "keywords": ["service transition", "deployment", "release", "go-live"]}
                ]
            },
            "relationship": {
                "sub_controls": [
                    {"suffix": "a", "name": "Manage business relationships", "description": "Establish and maintain business relationships.", "evidence": ["procedure_document", "audit_log"], "keywords": ["business relationship", "stakeholder", "customer management"]},
                    {"suffix": "b", "name": "Manage supplier relationships", "description": "Manage suppliers and their services.", "evidence": ["procedure_document", "audit_log", "policy_document"], "keywords": ["supplier management", "vendor", "contract", "third party"]},
                    {"suffix": "c", "name": "Review relationships", "description": "Monitor and review relationship performance.", "evidence": ["audit_log", "procedure_document"], "keywords": ["relationship review", "satisfaction", "feedback", "improvement"]}
                ]
            },
            "capacity": {
                "sub_controls": [
                    {"suffix": "a", "name": "Plan service capacity", "description": "Plan and monitor service capacity.", "evidence": ["procedure_document", "configuration_export"], "keywords": ["capacity planning", "resource management", "scalability", "performance"]},
                    {"suffix": "b", "name": "Monitor capacity utilization", "description": "Monitor and report on capacity utilization.", "evidence": ["screenshot", "audit_log", "configuration_export"], "keywords": ["utilization", "capacity monitoring", "trending", "threshold"]},
                    {"suffix": "c", "name": "Manage capacity changes", "description": "Manage capacity-related changes.", "evidence": ["change_request", "audit_log"], "keywords": ["capacity change", "scaling", "optimization", "upgrade"]}
                ]
            },
            "availability": {
                "sub_controls": [
                    {"suffix": "a", "name": "Define availability requirements", "description": "Document service availability requirements.", "evidence": ["policy_document", "procedure_document"], "keywords": ["availability requirements", "SLA", "uptime", "service level"]},
                    {"suffix": "b", "name": "Monitor availability", "description": "Monitor and report on service availability.", "evidence": ["screenshot", "audit_log"], "keywords": ["availability monitoring", "uptime", "outage", "performance"]},
                    {"suffix": "c", "name": "Improve availability", "description": "Implement availability improvement actions.", "evidence": ["change_request", "procedure_document"], "keywords": ["availability improvement", "resilience", "redundancy", "failover"]}
                ]
            },
            "continuity": {
                "sub_controls": [
                    {"suffix": "a", "name": "Define continuity requirements", "description": "Establish service continuity requirements.", "evidence": ["policy_document", "procedure_document"], "keywords": ["continuity requirements", "BCP", "disaster recovery", "RTO RPO"]},
                    {"suffix": "b", "name": "Implement continuity plans", "description": "Develop and implement service continuity plans.", "evidence": ["procedure_document", "backup_log"], "keywords": ["continuity plan", "DR plan", "recovery procedures", "backup"]},
                    {"suffix": "c", "name": "Test continuity plans", "description": "Test and maintain service continuity plans.", "evidence": ["audit_log", "procedure_document"], "keywords": ["continuity test", "DR test", "exercise", "recovery test"]}
                ]
            },
            "incident": {
                "sub_controls": [
                    {"suffix": "a", "name": "Define incident management process", "description": "Establish incident management process.", "evidence": ["procedure_document", "policy_document"], "keywords": ["incident process", "ticket", "classification", "priority"]},
                    {"suffix": "b", "name": "Record and classify incidents", "description": "Record, classify, and prioritize incidents.", "evidence": ["audit_log", "incident_report"], "keywords": ["incident logging", "classification", "categorization", "priority"]},
                    {"suffix": "c", "name": "Resolve incidents", "description": "Investigate and resolve incidents.", "evidence": ["incident_report", "audit_log"], "keywords": ["incident resolution", "troubleshooting", "workaround", "fix"]},
                    {"suffix": "d", "name": "Close and review incidents", "description": "Close incidents and conduct reviews.", "evidence": ["incident_report", "audit_log"], "keywords": ["incident closure", "review", "lessons learned", "improvement"]}
                ]
            },
            "problem": {
                "sub_controls": [
                    {"suffix": "a", "name": "Identify problems", "description": "Identify and log problems.", "evidence": ["procedure_document", "incident_report"], "keywords": ["problem identification", "trend analysis", "root cause", "known error"]},
                    {"suffix": "b", "name": "Analyze problems", "description": "Analyze and diagnose problems.", "evidence": ["incident_report", "audit_log"], "keywords": ["root cause analysis", "diagnosis", "investigation", "RCA"]},
                    {"suffix": "c", "name": "Resolve problems", "description": "Resolve problems and prevent recurrence.", "evidence": ["change_request", "incident_report"], "keywords": ["problem resolution", "permanent fix", "prevention", "improvement"]}
                ]
            },
            "change": {
                "sub_controls": [
                    {"suffix": "a", "name": "Define change management policy", "description": "Establish change management policy and process.", "evidence": ["policy_document", "procedure_document"], "keywords": ["change policy", "change process", "CAB", "RFC"]},
                    {"suffix": "b", "name": "Record and assess changes", "description": "Record, categorize, and assess changes.", "evidence": ["change_request", "audit_log"], "keywords": ["change request", "impact assessment", "risk assessment", "approval"]},
                    {"suffix": "c", "name": "Approve and implement changes", "description": "Approve, schedule, and implement changes.", "evidence": ["change_request", "audit_log"], "keywords": ["change approval", "implementation", "deployment", "CAB"]},
                    {"suffix": "d", "name": "Review and close changes", "description": "Review and close changes after implementation.", "evidence": ["change_request", "audit_log"], "keywords": ["PIR", "post implementation", "change closure", "review"]}
                ]
            },
            "release": {
                "sub_controls": [
                    {"suffix": "a", "name": "Plan releases", "description": "Plan and schedule releases.", "evidence": ["procedure_document", "change_request"], "keywords": ["release planning", "deployment", "schedule", "rollout"]},
                    {"suffix": "b", "name": "Build and test releases", "description": "Build, test, and validate releases.", "evidence": ["procedure_document", "audit_log"], "keywords": ["release build", "testing", "QA", "validation"]},
                    {"suffix": "c", "name": "Deploy releases", "description": "Deploy releases to production.", "evidence": ["change_request", "audit_log"], "keywords": ["deployment", "go-live", "rollout", "production"]}
                ]
            },
            "configuration": {
                "sub_controls": [
                    {"suffix": "a", "name": "Define configuration management", "description": "Establish configuration management process.", "evidence": ["procedure_document", "policy_document"], "keywords": ["configuration management", "CMDB", "CI", "asset"]},
                    {"suffix": "b", "name": "Identify configuration items", "description": "Identify and record configuration items.", "evidence": ["configuration_export", "procedure_document"], "keywords": ["CI identification", "asset register", "inventory", "baseline"]},
                    {"suffix": "c", "name": "Maintain configuration information", "description": "Maintain accurate configuration information.", "evidence": ["configuration_export", "audit_log"], "keywords": ["CMDB maintenance", "accuracy", "update", "verification"]}
                ]
            }
        }
    },
    "NIST_CSF": {
        "categories": {
            "identify": {
                "sub_controls": [
                    {"suffix": "a", "name": "Inventory assets", "description": "Identify and inventory physical devices, systems, and software.", "evidence": ["configuration_export", "procedure_document"], "keywords": ["asset inventory", "hardware", "software", "systems"]},
                    {"suffix": "b", "name": "Establish governance", "description": "Establish cybersecurity governance program.", "evidence": ["policy_document", "procedure_document"], "keywords": ["governance", "cybersecurity program", "policy", "strategy"]},
                    {"suffix": "c", "name": "Assess risks", "description": "Identify and assess cybersecurity risks.", "evidence": ["risk_assessment", "procedure_document"], "keywords": ["risk assessment", "threat", "vulnerability", "risk register"]},
                    {"suffix": "d", "name": "Define risk strategy", "description": "Define organizational risk management strategy.", "evidence": ["policy_document", "risk_assessment"], "keywords": ["risk strategy", "risk tolerance", "risk appetite", "priorities"]}
                ]
            },
            "protect": {
                "sub_controls": [
                    {"suffix": "a", "name": "Manage identities", "description": "Manage identities and credentials for authorized devices, users, and processes.", "evidence": ["procedure_document", "access_review", "configuration_export"], "keywords": ["identity management", "credentials", "authentication", "access"]},
                    {"suffix": "b", "name": "Implement access control", "description": "Implement access control mechanisms.", "evidence": ["configuration_export", "access_review", "audit_log"], "keywords": ["access control", "authorization", "least privilege", "RBAC"]},
                    {"suffix": "c", "name": "Provide awareness training", "description": "Provide cybersecurity awareness and training.", "evidence": ["training_record", "procedure_document"], "keywords": ["awareness", "training", "education", "security culture"]},
                    {"suffix": "d", "name": "Protect data", "description": "Protect data security throughout the lifecycle.", "evidence": ["configuration_export", "encryption_certificate", "policy_document"], "keywords": ["data protection", "encryption", "DLP", "data security"]},
                    {"suffix": "e", "name": "Implement protective technology", "description": "Deploy technical security solutions.", "evidence": ["configuration_export", "screenshot"], "keywords": ["security controls", "firewall", "endpoint", "network security"]}
                ]
            },
            "detect": {
                "sub_controls": [
                    {"suffix": "a", "name": "Deploy detection systems", "description": "Deploy anomaly and event detection systems.", "evidence": ["configuration_export", "screenshot"], "keywords": ["detection", "SIEM", "IDS", "monitoring"]},
                    {"suffix": "b", "name": "Implement continuous monitoring", "description": "Implement continuous security monitoring.", "evidence": ["audit_log", "configuration_export"], "keywords": ["continuous monitoring", "real-time", "security operations", "SOC"]},
                    {"suffix": "c", "name": "Analyze detection events", "description": "Analyze detection events for anomalies.", "evidence": ["audit_log", "incident_report"], "keywords": ["event analysis", "correlation", "triage", "investigation"]}
                ]
            },
            "respond": {
                "sub_controls": [
                    {"suffix": "a", "name": "Plan response activities", "description": "Plan incident response activities.", "evidence": ["policy_document", "procedure_document"], "keywords": ["response planning", "incident plan", "playbook", "procedures"]},
                    {"suffix": "b", "name": "Communicate during incidents", "description": "Coordinate communications during incidents.", "evidence": ["procedure_document", "incident_report"], "keywords": ["incident communication", "notification", "stakeholder", "reporting"]},
                    {"suffix": "c", "name": "Analyze incidents", "description": "Analyze incidents to support response.", "evidence": ["incident_report", "audit_log"], "keywords": ["incident analysis", "forensics", "investigation", "root cause"]},
                    {"suffix": "d", "name": "Mitigate incidents", "description": "Contain and mitigate incidents.", "evidence": ["incident_report", "audit_log"], "keywords": ["containment", "mitigation", "eradication", "remediation"]},
                    {"suffix": "e", "name": "Improve response", "description": "Improve response based on lessons learned.", "evidence": ["incident_report", "procedure_document"], "keywords": ["lessons learned", "improvement", "post-incident", "enhancement"]}
                ]
            },
            "recover": {
                "sub_controls": [
                    {"suffix": "a", "name": "Plan recovery activities", "description": "Plan recovery activities.", "evidence": ["procedure_document", "policy_document"], "keywords": ["recovery planning", "restoration", "business recovery", "DR"]},
                    {"suffix": "b", "name": "Implement improvements", "description": "Implement improvements based on lessons learned.", "evidence": ["procedure_document", "change_request"], "keywords": ["improvement", "enhancement", "lessons learned", "update"]},
                    {"suffix": "c", "name": "Communicate recovery", "description": "Coordinate recovery communications.", "evidence": ["procedure_document", "audit_log"], "keywords": ["recovery communication", "status", "stakeholder", "notification"]}
                ]
            }
        }
    },
    "SWIFT_CSF": {
        "categories": {
            "environment": {
                "sub_controls": [
                    {"suffix": "a", "name": "Document SWIFT environment", "description": "Document the SWIFT infrastructure and its components.", "evidence": ["procedure_document", "configuration_export"], "keywords": ["SWIFT", "infrastructure", "documentation", "architecture"]},
                    {"suffix": "b", "name": "Restrict internet access", "description": "Restrict and control internet access from SWIFT environment.", "evidence": ["configuration_export", "screenshot"], "keywords": ["internet restriction", "network isolation", "SWIFT security", "firewall"]},
                    {"suffix": "c", "name": "Protect SWIFT data", "description": "Protect SWIFT-related data and transactions.", "evidence": ["configuration_export", "encryption_certificate"], "keywords": ["data protection", "encryption", "SWIFT data", "transaction security"]},
                    {"suffix": "d", "name": "Segment SWIFT network", "description": "Implement network segmentation for SWIFT environment.", "evidence": ["configuration_export", "screenshot"], "keywords": ["segmentation", "network zones", "SWIFT isolation", "DMZ"]}
                ]
            },
            "access": {
                "sub_controls": [
                    {"suffix": "a", "name": "Implement multi-factor authentication", "description": "Implement MFA for SWIFT access.", "evidence": ["configuration_export", "screenshot", "audit_log"], "keywords": ["MFA", "two-factor", "authentication", "SWIFT access"]},
                    {"suffix": "b", "name": "Manage SWIFT credentials", "description": "Securely manage SWIFT operator credentials.", "evidence": ["procedure_document", "access_review"], "keywords": ["credentials", "password", "operator", "access management"]},
                    {"suffix": "c", "name": "Control privileged access", "description": "Control privileged access to SWIFT systems.", "evidence": ["access_review", "audit_log", "configuration_export"], "keywords": ["privileged access", "admin", "elevated rights", "PAM"]},
                    {"suffix": "d", "name": "Review access rights", "description": "Periodically review SWIFT access rights.", "evidence": ["access_review", "audit_log"], "keywords": ["access review", "recertification", "user access", "permissions"]}
                ]
            },
            "detection": {
                "sub_controls": [
                    {"suffix": "a", "name": "Detect anomalous activity", "description": "Implement detection of anomalous SWIFT transactions.", "evidence": ["configuration_export", "audit_log"], "keywords": ["anomaly detection", "fraud detection", "transaction monitoring", "SWIFT alerts"]},
                    {"suffix": "b", "name": "Log SWIFT transactions", "description": "Maintain comprehensive SWIFT transaction logs.", "evidence": ["audit_log", "configuration_export"], "keywords": ["transaction logging", "audit trail", "SWIFT logs", "monitoring"]},
                    {"suffix": "c", "name": "Monitor security events", "description": "Monitor security events in SWIFT environment.", "evidence": ["audit_log", "screenshot"], "keywords": ["security monitoring", "SIEM", "event correlation", "alerting"]}
                ]
            },
            "response": {
                "sub_controls": [
                    {"suffix": "a", "name": "Define incident response for SWIFT", "description": "Establish SWIFT-specific incident response procedures.", "evidence": ["procedure_document", "policy_document"], "keywords": ["incident response", "SWIFT incidents", "breach response", "escalation"]},
                    {"suffix": "b", "name": "Test incident response", "description": "Conduct SWIFT incident response exercises.", "evidence": ["audit_log", "training_record"], "keywords": ["IR exercise", "tabletop", "drill", "simulation"]},
                    {"suffix": "c", "name": "Report to SWIFT", "description": "Establish procedures for reporting to SWIFT.", "evidence": ["procedure_document", "incident_report"], "keywords": ["SWIFT reporting", "incident notification", "breach reporting", "communication"]}
                ]
            },
            "sharing": {
                "sub_controls": [
                    {"suffix": "a", "name": "Participate in information sharing", "description": "Participate in SWIFT security information sharing.", "evidence": ["procedure_document", "audit_log"], "keywords": ["information sharing", "threat intelligence", "ISAC", "collaboration"]},
                    {"suffix": "b", "name": "Consume threat intelligence", "description": "Consume and act on SWIFT threat intelligence.", "evidence": ["procedure_document", "audit_log"], "keywords": ["threat intelligence", "indicators", "IOC", "threat feeds"]}
                ]
            }
        }
    },
    "CBB": {
        "categories": {
            "governance": {
                "sub_controls": [
                    {"suffix": "a", "name": "Establish IT governance", "description": "Establish IT governance framework aligned with business objectives.", "evidence": ["policy_document", "procedure_document"], "keywords": ["IT governance", "oversight", "committee", "accountability"]},
                    {"suffix": "b", "name": "Define IT strategy", "description": "Define and maintain IT strategy.", "evidence": ["policy_document"], "keywords": ["IT strategy", "roadmap", "planning", "alignment"]},
                    {"suffix": "c", "name": "Report to board", "description": "Provide regular IT and security reporting to board.", "evidence": ["audit_log", "procedure_document"], "keywords": ["board reporting", "executive reporting", "metrics", "dashboard"]}
                ]
            },
            "risk_management": {
                "sub_controls": [
                    {"suffix": "a", "name": "Define risk management framework", "description": "Establish IT risk management framework.", "evidence": ["policy_document", "procedure_document"], "keywords": ["risk framework", "IT risk", "risk methodology", "assessment"]},
                    {"suffix": "b", "name": "Conduct IT risk assessments", "description": "Perform regular IT risk assessments.", "evidence": ["risk_assessment", "audit_log"], "keywords": ["risk assessment", "IT risk", "threat", "vulnerability"]},
                    {"suffix": "c", "name": "Implement risk treatments", "description": "Implement and monitor risk treatment plans.", "evidence": ["risk_assessment", "change_request"], "keywords": ["risk treatment", "mitigation", "controls", "residual risk"]},
                    {"suffix": "d", "name": "Monitor emerging risks", "description": "Monitor emerging IT and cyber risks.", "evidence": ["risk_assessment", "audit_log"], "keywords": ["emerging risks", "threat landscape", "cyber risks", "monitoring"]}
                ]
            },
            "security": {
                "sub_controls": [
                    {"suffix": "a", "name": "Define security policies", "description": "Establish comprehensive security policies.", "evidence": ["policy_document"], "keywords": ["security policy", "information security", "standards", "guidelines"]},
                    {"suffix": "b", "name": "Implement security controls", "description": "Implement technical and administrative security controls.", "evidence": ["configuration_export", "screenshot", "procedure_document"], "keywords": ["security controls", "technical controls", "administrative controls"]},
                    {"suffix": "c", "name": "Conduct security testing", "description": "Perform regular security testing and assessments.", "evidence": ["penetration_test_report", "vulnerability_scan"], "keywords": ["security testing", "penetration test", "vulnerability assessment", "audit"]},
                    {"suffix": "d", "name": "Monitor security posture", "description": "Continuously monitor security posture.", "evidence": ["audit_log", "screenshot"], "keywords": ["security monitoring", "SOC", "SIEM", "threat detection"]}
                ]
            },
            "operations": {
                "sub_controls": [
                    {"suffix": "a", "name": "Define IT operations procedures", "description": "Establish IT operations policies and procedures.", "evidence": ["procedure_document", "policy_document"], "keywords": ["IT operations", "procedures", "SOP", "runbook"]},
                    {"suffix": "b", "name": "Manage IT assets", "description": "Maintain IT asset inventory and management.", "evidence": ["configuration_export", "procedure_document"], "keywords": ["asset management", "inventory", "CMDB", "lifecycle"]},
                    {"suffix": "c", "name": "Implement change management", "description": "Implement IT change management processes.", "evidence": ["change_request", "procedure_document", "audit_log"], "keywords": ["change management", "CAB", "change control", "RFC"]},
                    {"suffix": "d", "name": "Manage incidents", "description": "Implement IT incident management processes.", "evidence": ["incident_report", "procedure_document", "audit_log"], "keywords": ["incident management", "service desk", "resolution", "escalation"]}
                ]
            },
            "third_party": {
                "sub_controls": [
                    {"suffix": "a", "name": "Define outsourcing policy", "description": "Establish outsourcing and third-party policy.", "evidence": ["policy_document", "procedure_document"], "keywords": ["outsourcing", "third party", "vendor policy", "supplier"]},
                    {"suffix": "b", "name": "Assess third parties", "description": "Conduct third-party risk assessments.", "evidence": ["risk_assessment", "audit_log"], "keywords": ["vendor assessment", "due diligence", "third party risk", "evaluation"]},
                    {"suffix": "c", "name": "Monitor third parties", "description": "Monitor third-party performance and compliance.", "evidence": ["audit_log", "procedure_document"], "keywords": ["vendor monitoring", "SLA", "contract compliance", "oversight"]}
                ]
            },
            "continuity": {
                "sub_controls": [
                    {"suffix": "a", "name": "Define BCP requirements", "description": "Establish business continuity requirements.", "evidence": ["policy_document", "procedure_document"], "keywords": ["BCP", "continuity requirements", "RTO", "RPO"]},
                    {"suffix": "b", "name": "Develop continuity plans", "description": "Develop and maintain business continuity plans.", "evidence": ["procedure_document", "backup_log"], "keywords": ["continuity plan", "disaster recovery", "recovery procedures", "backup"]},
                    {"suffix": "c", "name": "Test continuity arrangements", "description": "Test business continuity arrangements.", "evidence": ["audit_log", "procedure_document"], "keywords": ["BCP test", "DR test", "exercise", "simulation"]}
                ]
            }
        }
    },
    "SAMA": {
        "categories": {
            "governance": {
                "sub_controls": [
                    {"suffix": "a", "name": "Establish cybersecurity governance", "description": "Establish cybersecurity governance structure.", "evidence": ["policy_document", "procedure_document"], "keywords": ["governance", "cybersecurity", "committee", "oversight"]},
                    {"suffix": "b", "name": "Define roles and responsibilities", "description": "Define cybersecurity roles and responsibilities.", "evidence": ["policy_document", "procedure_document"], "keywords": ["roles", "responsibilities", "RACI", "accountability"]},
                    {"suffix": "c", "name": "Report to management", "description": "Provide regular cybersecurity reporting to management.", "evidence": ["audit_log", "procedure_document"], "keywords": ["reporting", "management", "metrics", "KPI"]}
                ]
            },
            "compliance": {
                "sub_controls": [
                    {"suffix": "a", "name": "Identify regulatory requirements", "description": "Identify applicable regulatory requirements.", "evidence": ["policy_document", "procedure_document"], "keywords": ["regulatory", "compliance", "requirements", "obligations"]},
                    {"suffix": "b", "name": "Assess compliance status", "description": "Assess compliance against requirements.", "evidence": ["audit_log", "procedure_document"], "keywords": ["compliance assessment", "gap analysis", "audit", "review"]},
                    {"suffix": "c", "name": "Remediate compliance gaps", "description": "Address identified compliance gaps.", "evidence": ["change_request", "audit_log"], "keywords": ["remediation", "gap closure", "corrective action", "improvement"]}
                ]
            },
            "risk_management": {
                "sub_controls": [
                    {"suffix": "a", "name": "Define risk methodology", "description": "Establish cybersecurity risk assessment methodology.", "evidence": ["policy_document", "procedure_document", "risk_assessment"], "keywords": ["risk methodology", "assessment", "framework", "criteria"]},
                    {"suffix": "b", "name": "Conduct risk assessments", "description": "Perform cybersecurity risk assessments.", "evidence": ["risk_assessment", "audit_log"], "keywords": ["risk assessment", "threat", "vulnerability", "impact"]},
                    {"suffix": "c", "name": "Treat identified risks", "description": "Implement risk treatment measures.", "evidence": ["risk_assessment", "change_request"], "keywords": ["risk treatment", "mitigation", "controls", "acceptance"]},
                    {"suffix": "d", "name": "Monitor risks", "description": "Monitor and report on risk status.", "evidence": ["risk_assessment", "audit_log"], "keywords": ["risk monitoring", "KRI", "dashboard", "reporting"]}
                ]
            },
            "asset_management": {
                "sub_controls": [
                    {"suffix": "a", "name": "Maintain asset inventory", "description": "Maintain comprehensive IT asset inventory.", "evidence": ["configuration_export", "procedure_document"], "keywords": ["asset inventory", "CMDB", "hardware", "software"]},
                    {"suffix": "b", "name": "Classify assets", "description": "Classify assets based on criticality.", "evidence": ["procedure_document", "configuration_export"], "keywords": ["classification", "criticality", "sensitivity", "labeling"]},
                    {"suffix": "c", "name": "Protect assets", "description": "Implement asset protection measures.", "evidence": ["configuration_export", "procedure_document"], "keywords": ["asset protection", "security controls", "safeguards", "hardening"]}
                ]
            },
            "identity_access": {
                "sub_controls": [
                    {"suffix": "a", "name": "Define access control policy", "description": "Establish identity and access control policy.", "evidence": ["policy_document"], "keywords": ["access policy", "identity", "authorization", "authentication"]},
                    {"suffix": "b", "name": "Implement identity management", "description": "Implement identity lifecycle management.", "evidence": ["procedure_document", "access_review", "configuration_export"], "keywords": ["identity management", "provisioning", "deprovisioning", "lifecycle"]},
                    {"suffix": "c", "name": "Manage privileged access", "description": "Control and monitor privileged access.", "evidence": ["access_review", "audit_log", "configuration_export"], "keywords": ["privileged access", "PAM", "admin", "elevated rights"]},
                    {"suffix": "d", "name": "Review access rights", "description": "Conduct periodic access reviews.", "evidence": ["access_review", "audit_log"], "keywords": ["access review", "recertification", "audit", "compliance"]}
                ]
            },
            "security_operations": {
                "sub_controls": [
                    {"suffix": "a", "name": "Deploy security monitoring", "description": "Deploy security monitoring capabilities.", "evidence": ["configuration_export", "screenshot"], "keywords": ["security monitoring", "SIEM", "SOC", "detection"]},
                    {"suffix": "b", "name": "Manage vulnerabilities", "description": "Implement vulnerability management program.", "evidence": ["vulnerability_scan", "procedure_document"], "keywords": ["vulnerability management", "scanning", "patching", "remediation"]},
                    {"suffix": "c", "name": "Manage security incidents", "description": "Implement security incident management.", "evidence": ["incident_report", "procedure_document", "audit_log"], "keywords": ["incident management", "response", "handling", "escalation"]},
                    {"suffix": "d", "name": "Conduct security testing", "description": "Perform security testing activities.", "evidence": ["penetration_test_report", "vulnerability_scan"], "keywords": ["security testing", "pentest", "assessment", "audit"]}
                ]
            },
            "third_party": {
                "sub_controls": [
                    {"suffix": "a", "name": "Assess third-party risks", "description": "Assess cybersecurity risks from third parties.", "evidence": ["risk_assessment", "procedure_document"], "keywords": ["third party risk", "vendor assessment", "due diligence", "evaluation"]},
                    {"suffix": "b", "name": "Manage third-party security", "description": "Manage third-party security requirements.", "evidence": ["procedure_document", "audit_log"], "keywords": ["vendor management", "contract", "SLA", "compliance"]},
                    {"suffix": "c", "name": "Monitor third parties", "description": "Monitor third-party security compliance.", "evidence": ["audit_log", "procedure_document"], "keywords": ["vendor monitoring", "oversight", "review", "performance"]}
                ]
            },
            "resilience": {
                "sub_controls": [
                    {"suffix": "a", "name": "Define resilience requirements", "description": "Establish cyber resilience requirements.", "evidence": ["policy_document", "procedure_document"], "keywords": ["resilience", "recovery", "continuity", "availability"]},
                    {"suffix": "b", "name": "Implement backup procedures", "description": "Implement data backup and recovery procedures.", "evidence": ["backup_log", "procedure_document"], "keywords": ["backup", "recovery", "restore", "data protection"]},
                    {"suffix": "c", "name": "Test recovery capabilities", "description": "Test cyber recovery capabilities.", "evidence": ["audit_log", "procedure_document"], "keywords": ["recovery test", "DR test", "exercise", "validation"]}
                ]
            }
        }
    },
    "SBP": {
        "categories": {
            "governance": {
                "sub_controls": [
                    {"suffix": "a", "name": "Establish IT governance framework", "description": "Establish IT governance and oversight framework.", "evidence": ["policy_document", "procedure_document"], "keywords": ["governance", "IT oversight", "committee", "accountability"]},
                    {"suffix": "b", "name": "Define IT policies", "description": "Define comprehensive IT policies.", "evidence": ["policy_document"], "keywords": ["IT policy", "standards", "guidelines", "procedures"]},
                    {"suffix": "c", "name": "Report to board", "description": "Provide IT reporting to board and management.", "evidence": ["audit_log", "procedure_document"], "keywords": ["board reporting", "management reporting", "metrics", "dashboard"]}
                ]
            },
            "risk_management": {
                "sub_controls": [
                    {"suffix": "a", "name": "Establish risk framework", "description": "Establish IT risk management framework.", "evidence": ["policy_document", "procedure_document"], "keywords": ["risk framework", "IT risk", "methodology", "process"]},
                    {"suffix": "b", "name": "Perform risk assessments", "description": "Conduct IT risk assessments.", "evidence": ["risk_assessment", "audit_log"], "keywords": ["risk assessment", "IT risk", "analysis", "evaluation"]},
                    {"suffix": "c", "name": "Implement risk controls", "description": "Implement risk mitigation controls.", "evidence": ["risk_assessment", "change_request"], "keywords": ["risk controls", "mitigation", "treatment", "safeguards"]},
                    {"suffix": "d", "name": "Monitor risk status", "description": "Monitor and report risk status.", "evidence": ["risk_assessment", "audit_log"], "keywords": ["risk monitoring", "status", "reporting", "KRI"]}
                ]
            },
            "security": {
                "sub_controls": [
                    {"suffix": "a", "name": "Define security framework", "description": "Establish information security framework.", "evidence": ["policy_document", "procedure_document"], "keywords": ["security framework", "information security", "policy", "standards"]},
                    {"suffix": "b", "name": "Implement security controls", "description": "Deploy security controls.", "evidence": ["configuration_export", "screenshot", "procedure_document"], "keywords": ["security controls", "technical controls", "safeguards", "protection"]},
                    {"suffix": "c", "name": "Monitor security", "description": "Monitor security posture.", "evidence": ["audit_log", "screenshot"], "keywords": ["security monitoring", "SOC", "detection", "alerting"]},
                    {"suffix": "d", "name": "Test security", "description": "Conduct security testing.", "evidence": ["penetration_test_report", "vulnerability_scan"], "keywords": ["security testing", "assessment", "audit", "evaluation"]}
                ]
            },
            "operations": {
                "sub_controls": [
                    {"suffix": "a", "name": "Define operational procedures", "description": "Establish IT operational procedures.", "evidence": ["procedure_document", "policy_document"], "keywords": ["IT operations", "procedures", "SOP", "runbook"]},
                    {"suffix": "b", "name": "Manage IT assets", "description": "Implement IT asset management.", "evidence": ["configuration_export", "procedure_document"], "keywords": ["asset management", "inventory", "CMDB", "lifecycle"]},
                    {"suffix": "c", "name": "Implement change control", "description": "Implement change management process.", "evidence": ["change_request", "procedure_document", "audit_log"], "keywords": ["change management", "change control", "CAB", "approval"]},
                    {"suffix": "d", "name": "Manage incidents", "description": "Implement incident management.", "evidence": ["incident_report", "procedure_document", "audit_log"], "keywords": ["incident management", "service desk", "resolution", "handling"]}
                ]
            },
            "access_control": {
                "sub_controls": [
                    {"suffix": "a", "name": "Define access policies", "description": "Establish access control policies.", "evidence": ["policy_document"], "keywords": ["access policy", "authorization", "authentication", "identity"]},
                    {"suffix": "b", "name": "Manage user access", "description": "Implement user access management.", "evidence": ["procedure_document", "access_review", "audit_log"], "keywords": ["user access", "provisioning", "deprovisioning", "lifecycle"]},
                    {"suffix": "c", "name": "Control privileged access", "description": "Manage privileged access.", "evidence": ["access_review", "audit_log", "configuration_export"], "keywords": ["privileged access", "admin", "PAM", "elevated"]},
                    {"suffix": "d", "name": "Review access", "description": "Conduct access reviews.", "evidence": ["access_review", "audit_log"], "keywords": ["access review", "recertification", "audit", "verification"]}
                ]
            },
            "third_party": {
                "sub_controls": [
                    {"suffix": "a", "name": "Define outsourcing policy", "description": "Establish outsourcing policy.", "evidence": ["policy_document", "procedure_document"], "keywords": ["outsourcing", "third party", "vendor policy", "supplier"]},
                    {"suffix": "b", "name": "Assess vendors", "description": "Conduct vendor risk assessments.", "evidence": ["risk_assessment", "audit_log"], "keywords": ["vendor assessment", "due diligence", "evaluation", "risk"]},
                    {"suffix": "c", "name": "Monitor vendors", "description": "Monitor vendor performance and compliance.", "evidence": ["audit_log", "procedure_document"], "keywords": ["vendor monitoring", "SLA", "compliance", "oversight"]}
                ]
            },
            "continuity": {
                "sub_controls": [
                    {"suffix": "a", "name": "Establish BCP framework", "description": "Establish business continuity framework.", "evidence": ["policy_document", "procedure_document"], "keywords": ["BCP", "continuity", "disaster recovery", "framework"]},
                    {"suffix": "b", "name": "Develop recovery plans", "description": "Develop IT recovery plans.", "evidence": ["procedure_document", "backup_log"], "keywords": ["recovery plan", "DR", "backup", "restoration"]},
                    {"suffix": "c", "name": "Test continuity plans", "description": "Test business continuity plans.", "evidence": ["audit_log", "procedure_document"], "keywords": ["BCP test", "DR test", "exercise", "simulation"]}
                ]
            }
        }
    }
}

CONTROL_KEYWORD_MAPPING = {
    "network": ["network", "firewall", "segmentation", "traffic", "NSC", "DMZ", "VLAN"],
    "access": ["access", "authentication", "authorization", "user", "identity", "privilege", "MFA", "password"],
    "encryption": ["encrypt", "cryptograph", "key", "TLS", "SSL", "certificate", "hash"],
    "vulnerability": ["vulnerab", "patch", "scan", "CVE", "security assessment"],
    "monitoring": ["monitor", "log", "audit", "SIEM", "detect", "alert", "event"],
    "policy": ["policy", "procedure", "document", "standard", "guideline"],
    "incident": ["incident", "response", "breach", "event", "alert"],
    "antimalware": ["malware", "antivirus", "virus", "threat", "endpoint"],
    "governance": ["governance", "oversight", "committee", "board", "management"],
    "risk": ["risk", "threat", "assessment", "mitigation", "treatment"],
    "asset": ["asset", "inventory", "CMDB", "configuration"],
    "continuity": ["continuity", "disaster", "recovery", "backup", "BCP", "DR"],
    "service": ["service", "SLA", "ITSM", "ITIL"],
    "change": ["change", "CAB", "RFC", "release"],
    "supplier": ["supplier", "vendor", "third party", "outsourc"],
    "physical": ["physical", "environment", "facility", "data center"],
    "data": ["data", "information", "classification", "protection"]
}


def get_category_for_control(control_name, control_statement):
    """Determine the best category for a control based on its content."""
    text = f"{control_name} {control_statement}".lower()
    
    scores = {}
    for category, keywords in CONTROL_KEYWORD_MAPPING.items():
        score = sum(1 for kw in keywords if kw.lower() in text)
        if score > 0:
            scores[category] = score
    
    if scores:
        return max(scores, key=scores.get)
    return "policy"


def seed_subcontrols():
    """Seed sub-controls for all framework controls."""
    db = SessionLocal()
    try:
        existing = db.query(FrameworkSubControl).first()
        if existing:
            print("Sub-controls already seeded, checking for updates...")
            existing_count = db.query(FrameworkSubControl).count()
            print(f"Found {existing_count} existing sub-controls")
            return
        
        print("Seeding sub-controls for all frameworks...")
        
        frameworks = db.query(Framework).all()
        total_subcontrols = 0
        
        for framework in frameworks:
            print(f"\nProcessing framework: {framework.short_code}")
            framework_templates = FRAMEWORK_SUBCONTROL_TEMPLATES.get(framework.short_code, {})
            categories = framework_templates.get("categories", {})
            
            controls = db.query(FrameworkControl).join(
                FrameworkControl.objective
            ).join(
                FrameworkControl.objective.property.mapper.class_.domain
            ).filter(
                FrameworkControl.objective.property.mapper.class_.domain.property.mapper.class_.framework_id == framework.id
            ).all()
            
            print(f"  Found {len(controls)} controls")
            
            for control in controls:
                category = get_category_for_control(control.name, control.statement or "")
                
                if category in categories:
                    templates = categories[category]["sub_controls"]
                elif categories:
                    first_category = list(categories.keys())[0]
                    templates = categories[first_category]["sub_controls"]
                else:
                    templates = generate_default_subcontrols(control)
                
                for idx, template in enumerate(templates):
                    sub_control_code = f"{control.code}.{template['suffix']}"
                    
                    sub_control = FrameworkSubControl(
                        control_id=control.id,
                        code=sub_control_code,
                        name=template["name"],
                        statement=template.get("description", ""),
                        description=template.get("description", ""),
                        order=idx + 1,
                        evidence_recommendations=template.get("evidence", ["policy_document", "procedure_document"]),
                        ai_matching_keywords=template.get("keywords", [category])
                    )
                    db.add(sub_control)
                    total_subcontrols += 1
        
        db.commit()
        print(f"\nSuccessfully seeded {total_subcontrols} sub-controls across {len(frameworks)} frameworks!")
        
    except Exception as e:
        db.rollback()
        print(f"Error seeding sub-controls: {e}")
        raise
    finally:
        db.close()


def generate_default_subcontrols(control):
    """Generate default sub-controls for controls without specific templates."""
    base_name = control.name or "Control requirement"
    
    return [
        {
            "suffix": "a",
            "name": f"Document {base_name.lower()} requirements",
            "description": f"Create and maintain documentation for {base_name.lower()} requirements and procedures.",
            "evidence": ["policy_document", "procedure_document"],
            "keywords": ["documentation", "policy", "procedure", "requirements"]
        },
        {
            "suffix": "b",
            "name": f"Implement {base_name.lower()} controls",
            "description": f"Deploy and configure controls to address {base_name.lower()} requirements.",
            "evidence": ["configuration_export", "screenshot", "procedure_document"],
            "keywords": ["implementation", "controls", "configuration", "deployment"]
        },
        {
            "suffix": "c",
            "name": f"Monitor and review {base_name.lower()}",
            "description": f"Continuously monitor and periodically review {base_name.lower()} effectiveness.",
            "evidence": ["audit_log", "procedure_document"],
            "keywords": ["monitoring", "review", "audit", "assessment"]
        }
    ]


def reseed_subcontrols():
    """Delete all existing sub-controls and reseed."""
    db = SessionLocal()
    try:
        print("Deleting existing sub-controls...")
        db.query(FrameworkSubControl).delete()
        db.commit()
        print("Existing sub-controls deleted.")
        
        seed_subcontrols()
        
    except Exception as e:
        db.rollback()
        print(f"Error reseeding sub-controls: {e}")
        raise
    finally:
        db.close()


if __name__ == "__main__":
    seed_subcontrols()
