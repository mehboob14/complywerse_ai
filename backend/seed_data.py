from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from datetime import datetime, timedelta
from models import (SessionLocal, Phase, PhaseTask, PhaseDeliverable, 
                   Requirement, SubRequirement, RequiredEvidence,
                   SecurityScan, ComplianceAssessment, CDESystem,
                   User, UserRole,
                   init_db, engine)
import bcrypt

def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')


def seed_users():
    """Seed default users for testing"""
    db = SessionLocal()
    try:
        user_count = db.query(User).count()
        if user_count > 0:
            print(f"Users already seeded ({user_count} records). Skipping...")
            db.close()
            return
        
        default_users = [
            {"username": "admin", "email": "admin@pci.local", "password": "admin123", "role": "admin", "display_name": "System Administrator"},
            {"username": "infosec", "email": "infosec@pci.local", "password": "infosec123", "role": "infosec_team", "display_name": "Infosec Team Lead"},
            {"username": "auditor", "email": "auditor@pci.local", "password": "auditor123", "role": "qsa_auditor", "display_name": "QSA Auditor"},
            {"username": "business", "email": "business@pci.local", "password": "business123", "role": "business_owner", "display_name": "Business Owner"},
            {"username": "itsec", "email": "itsec@pci.local", "password": "itsec123", "role": "it_security", "display_name": "IT Security Analyst"},
        ]
        
        for user_data in default_users:
            user = User(
                username=user_data["username"],
                email=user_data["email"],
                password_hash=hash_password(user_data["password"]),
                role=user_data["role"],
                display_name=user_data["display_name"]
            )
            db.add(user)
        
        db.commit()
        print("Seeded default users!")
        print("Default accounts: admin/admin123, infosec/infosec123, auditor/auditor123, business/business123, itsec/itsec123")
    except Exception as e:
        db.rollback()
        print(f"Error seeding users: {e}")
    finally:
        db.close()

def seed_new_tables():
    """Seed the new tables (CDE systems, security scans, assessments) if they're empty"""
    db = SessionLocal()
    try:
        cde_count = db.query(CDESystem).count()
        if cde_count > 0:
            print(f"CDE systems already seeded ({cde_count} records). Skipping...")
            db.close()
            return
        
        cde_systems = [
            {"name": "Payment Gateway Server", "system_type": "server", "description": "Primary payment processing server", "ip_address": "10.0.1.10", "location": "Data Center A", "owner": "IT Operations"},
            {"name": "Card Data Database", "system_type": "database", "description": "Encrypted cardholder data storage", "ip_address": "10.0.1.20", "location": "Data Center A", "owner": "DBA Team"},
            {"name": "POS Terminal Network", "system_type": "network", "description": "Point of sale terminal network segment", "ip_address": "10.0.2.0/24", "location": "Retail Locations", "owner": "Network Team"},
            {"name": "E-commerce Application", "system_type": "application", "description": "Online payment processing application", "ip_address": "10.0.1.30", "location": "Data Center A", "owner": "Development Team"},
            {"name": "Payment API Gateway", "system_type": "application", "description": "REST API for payment processing", "ip_address": "10.0.1.31", "location": "Data Center A", "owner": "Development Team"},
            {"name": "Tokenization Server", "system_type": "server", "description": "Card data tokenization service", "ip_address": "10.0.1.40", "location": "Data Center A", "owner": "Security Team"},
            {"name": "HSM Cluster", "system_type": "server", "description": "Hardware security modules for key management", "ip_address": "10.0.1.50", "location": "Data Center A", "owner": "Security Team"},
            {"name": "Backup Server", "system_type": "server", "description": "Encrypted backup storage", "ip_address": "10.0.1.60", "location": "Data Center B", "owner": "IT Operations"},
            {"name": "Log Aggregator", "system_type": "server", "description": "Centralized logging and SIEM", "ip_address": "10.0.3.10", "location": "Data Center A", "owner": "Security Team"},
            {"name": "Admin Workstations", "system_type": "server", "description": "CDE administrative access workstations", "ip_address": "10.0.4.0/24", "location": "Corporate Office", "owner": "IT Operations"},
            {"name": "Firewall Cluster", "system_type": "network", "description": "CDE perimeter firewalls", "ip_address": "10.0.0.1", "location": "Data Center A", "owner": "Network Team"},
            {"name": "IDS/IPS System", "system_type": "network", "description": "Intrusion detection and prevention", "ip_address": "10.0.0.5", "location": "Data Center A", "owner": "Security Team"},
            {"name": "VPN Gateway", "system_type": "network", "description": "Remote access VPN for CDE", "ip_address": "10.0.0.10", "location": "Data Center A", "owner": "Network Team"},
            {"name": "Anti-malware Server", "system_type": "server", "description": "Centralized anti-malware management", "ip_address": "10.0.3.20", "location": "Data Center A", "owner": "Security Team"},
            {"name": "Patch Management Server", "system_type": "server", "description": "CDE patch deployment system", "ip_address": "10.0.3.30", "location": "Data Center A", "owner": "IT Operations"},
            {"name": "NTP Server", "system_type": "server", "description": "Time synchronization for CDE", "ip_address": "10.0.3.40", "location": "Data Center A", "owner": "IT Operations"},
            {"name": "DNS Server", "system_type": "server", "description": "Internal DNS for CDE", "ip_address": "10.0.3.50", "location": "Data Center A", "owner": "IT Operations"},
            {"name": "Wireless Controller", "system_type": "network", "description": "Wireless network controller", "ip_address": "10.0.0.20", "location": "Corporate Office", "owner": "Network Team"},
            {"name": "File Integrity Monitor", "system_type": "application", "description": "FIM for critical system files", "ip_address": "10.0.3.60", "location": "Data Center A", "owner": "Security Team"},
            {"name": "Vulnerability Scanner", "system_type": "application", "description": "Internal vulnerability scanning", "ip_address": "10.0.3.70", "location": "Data Center A", "owner": "Security Team"},
            {"name": "Development Environment", "system_type": "server", "description": "Secure development environment", "ip_address": "10.0.5.0/24", "location": "Data Center A", "owner": "Development Team"},
            {"name": "QA Environment", "system_type": "server", "description": "Quality assurance testing environment", "ip_address": "10.0.6.0/24", "location": "Data Center A", "owner": "QA Team"},
            {"name": "Load Balancer", "system_type": "network", "description": "Application load balancer", "ip_address": "10.0.1.5", "location": "Data Center A", "owner": "Network Team"},
            {"name": "Secrets Manager", "system_type": "application", "description": "Credential and secrets management", "ip_address": "10.0.3.80", "location": "Data Center A", "owner": "Security Team"},
        ]
        
        for sys_data in cde_systems:
            system = CDESystem(**sys_data)
            db.add(system)
        
        security_scans = [
            {"scan_type": "asv_scan", "name": "Q1 2025 ASV Scan", "status": "scheduled", "scheduled_date": datetime.now() + timedelta(days=30)},
            {"scan_type": "pen_test", "name": "Annual External Penetration Test", "status": "scheduled", "scheduled_date": datetime.now() + timedelta(days=60)},
            {"scan_type": "pen_test", "name": "Annual Internal Penetration Test", "status": "scheduled", "scheduled_date": datetime.now() + timedelta(days=75)},
            {"scan_type": "vulnerability_scan", "name": "Weekly Internal Vulnerability Scan", "status": "scheduled", "scheduled_date": datetime.now() + timedelta(days=7)},
        ]
        
        for scan_data in security_scans:
            scan = SecurityScan(**scan_data)
            db.add(scan)
        
        assessment = ComplianceAssessment(
            assessment_type="self_assessment",
            status="in_progress",
            started_at=datetime.now(),
            assessor_name="Internal Compliance Team",
            notes="Annual PCI DSS v4.0 self-assessment in progress"
        )
        db.add(assessment)
        
        db.commit()
        print("Seeded CDE systems, security scans, and assessment data!")
    except Exception as e:
        db.rollback()
        print(f"Error seeding new tables: {e}")
    finally:
        db.close()


def seed_database():
    init_db()
    
    seed_users()
    seed_new_tables()
    
    with engine.connect() as conn:
        result = conn.execute(text("SELECT COUNT(*) FROM phases"))
        count = result.scalar()
        if count > 0:
            print(f"Database already has {count} phases. Skipping seed...")
            return
    
    db = SessionLocal()
    
    try:
        phases_data = [
            {
                "phase_number": 1,
                "name": "PCI Scope Definition",
                "description": "Define the Cardholder Data Environment and connected systems",
                "status": "complete",
                "is_current": False,
                "tasks": ["Identify CDE systems", "Map data flows", "Identify connected systems", "Validate network segmentation", "Document scope reduction"],
                "deliverables": ["CDE Inventory", "Data Flow Diagram", "Segmentation Validation"]
            },
            {
                "phase_number": 2,
                "name": "Gap Assessment",
                "description": "Assess current state against PCI DSS v4.x requirements",
                "status": "in_progress",
                "is_current": True,
                "tasks": ["Review all 12 requirements", "Assess current controls", "Identify gaps", "Prioritize remediation"],
                "deliverables": ["Gap Assessment Report", "Remediation Plan"]
            },
            {
                "phase_number": 3,
                "name": "Control Implementation",
                "description": "Implement required PCI DSS controls",
                "status": "not_started",
                "is_current": False,
                "tasks": ["Implement technical controls", "Implement administrative controls", "Configure security settings", "Deploy monitoring tools"],
                "deliverables": ["Control Documentation", "Configuration Standards"]
            },
            {
                "phase_number": 4,
                "name": "Evidence Collection",
                "description": "Collect and organize compliance evidence",
                "status": "not_started",
                "is_current": False,
                "tasks": ["Gather policies and procedures", "Collect configurations", "Capture screenshots", "Generate reports"],
                "deliverables": ["Evidence Repository", "Documentation Index"]
            },
            {
                "phase_number": 5,
                "name": "Vulnerability & Penetration Testing",
                "description": "Conduct required security testing",
                "status": "not_started",
                "is_current": False,
                "tasks": ["Quarterly ASV scans", "Internal vulnerability scans", "External penetration test", "Internal penetration test", "Segmentation testing"],
                "deliverables": ["ASV Scan Reports", "Penetration Test Report", "Remediation Evidence"]
            },
            {
                "phase_number": 6,
                "name": "Compliance Validation",
                "description": "QSA assessment and attestation",
                "status": "not_started",
                "is_current": False,
                "tasks": ["QSA engagement", "Evidence review", "On-site assessment", "Report on Compliance"],
                "deliverables": ["ROC", "AOC"]
            },
            {
                "phase_number": 7,
                "name": "Continuous Compliance",
                "description": "Maintain ongoing PCI DSS compliance",
                "status": "not_started",
                "is_current": False,
                "tasks": ["Quarterly reviews", "Change management", "Continuous monitoring", "Annual reassessment"],
                "deliverables": ["Quarterly Reports", "Change Impact Assessments"]
            }
        ]
        
        for phase_data in phases_data:
            phase = Phase(
                phase_number=phase_data["phase_number"],
                name=phase_data["name"],
                description=phase_data["description"],
                status=phase_data["status"],
                is_current=phase_data["is_current"]
            )
            db.add(phase)
            db.flush()
            
            for task_name in phase_data["tasks"]:
                task = PhaseTask(phase_id=phase.id, name=task_name, is_complete=phase_data["status"] == "complete")
                db.add(task)
            
            for deliverable_name in phase_data["deliverables"]:
                deliverable = PhaseDeliverable(phase_id=phase.id, name=deliverable_name)
                db.add(deliverable)
        
        requirements_data = [
            {
                "req_number": 1,
                "name": "Install and maintain network security controls",
                "description": "Network security controls (NSCs), such as firewalls and other network security technologies, are network policy enforcement points.",
                "sub_reqs": [
                    {"number": "1.1", "name": "Processes and mechanisms for installing and maintaining network security controls are defined and understood", 
                     "evidence": [{"name": "Network Security Policy", "type": "policy", "desc": "Documented network security policy with roles and responsibilities"},
                                  {"name": "NSC Configuration Standards", "type": "document", "desc": "Standards for configuring network security controls"}]},
                    {"number": "1.2", "name": "Network security controls (NSCs) are configured and maintained",
                     "evidence": [{"name": "Firewall Ruleset", "type": "configuration", "desc": "Current firewall rules and configurations"},
                                  {"name": "Change Management Records", "type": "log", "desc": "Records of NSC changes with approvals"}]},
                    {"number": "1.3", "name": "Network access to and from the cardholder data environment is restricted",
                     "evidence": [{"name": "Network Diagram", "type": "diagram", "desc": "Current network diagram showing CDE boundaries"},
                                  {"name": "Access Control Lists", "type": "configuration", "desc": "ACLs restricting CDE access"}]},
                    {"number": "1.4", "name": "Network connections between trusted and untrusted networks are controlled",
                     "evidence": [{"name": "DMZ Configuration", "type": "configuration", "desc": "DMZ architecture and configuration"},
                                  {"name": "Traffic Flow Rules", "type": "configuration", "desc": "Rules controlling traffic between network zones"}]},
                    {"number": "1.5", "name": "Risks to the CDE from computing devices that connect to both untrusted networks and the CDE are mitigated",
                     "evidence": [{"name": "Mobile Device Policy", "type": "policy", "desc": "Policy for devices connecting to untrusted networks"},
                                  {"name": "Endpoint Protection Evidence", "type": "screenshot", "desc": "Evidence of endpoint security controls"}]}
                ]
            },
            {
                "req_number": 2,
                "name": "Apply secure configurations to all system components",
                "description": "Malicious individuals often use default passwords and other vendor default settings to compromise systems.",
                "sub_reqs": [
                    {"number": "2.1", "name": "Processes and mechanisms for applying secure configurations are defined and understood",
                     "evidence": [{"name": "Configuration Management Policy", "type": "policy", "desc": "Policy for managing system configurations"},
                                  {"name": "Hardening Standards", "type": "document", "desc": "Security hardening standards for all system types"}]},
                    {"number": "2.2", "name": "System components are configured and managed securely",
                     "evidence": [{"name": "Server Hardening Evidence", "type": "configuration", "desc": "Evidence of server hardening applied"},
                                  {"name": "Default Account Removal", "type": "screenshot", "desc": "Evidence that default accounts are removed/disabled"},
                                  {"name": "Service Configuration", "type": "configuration", "desc": "Evidence of unnecessary services disabled"}]},
                    {"number": "2.3", "name": "Wireless environments are configured and managed securely",
                     "evidence": [{"name": "Wireless Security Policy", "type": "policy", "desc": "Wireless network security policy"},
                                  {"name": "Wireless Configuration", "type": "configuration", "desc": "Wireless encryption and authentication settings"}]}
                ]
            },
            {
                "req_number": 3,
                "name": "Protect stored account data",
                "description": "Protection methods such as encryption, truncation, masking, and hashing are critical components of cardholder data protection.",
                "sub_reqs": [
                    {"number": "3.1", "name": "Processes and mechanisms for protecting stored account data are defined and understood",
                     "evidence": [{"name": "Data Protection Policy", "type": "policy", "desc": "Policy for protecting stored cardholder data"},
                                  {"name": "Data Retention Policy", "type": "policy", "desc": "Data retention and disposal policy"}]},
                    {"number": "3.2", "name": "Storage of account data is kept to a minimum",
                     "evidence": [{"name": "Data Inventory", "type": "document", "desc": "Inventory of all cardholder data storage locations"},
                                  {"name": "Retention Evidence", "type": "log", "desc": "Evidence of data disposal per retention policy"}]},
                    {"number": "3.3", "name": "Sensitive authentication data (SAD) is not stored after authorization",
                     "evidence": [{"name": "SAD Storage Scan", "type": "report", "desc": "Scan results showing no SAD storage"},
                                  {"name": "Application Review", "type": "document", "desc": "Review confirming SAD not stored"}]},
                    {"number": "3.4", "name": "Access to displays of full PAN and ability to copy cardholder data are restricted",
                     "evidence": [{"name": "Data Masking Configuration", "type": "configuration", "desc": "Configuration showing PAN masking"},
                                  {"name": "Access Control Evidence", "type": "screenshot", "desc": "Evidence of restricted PAN access"}]},
                    {"number": "3.5", "name": "Primary account number (PAN) is secured wherever it is stored",
                     "evidence": [{"name": "Encryption Configuration", "type": "configuration", "desc": "PAN encryption configuration"},
                                  {"name": "Encryption Certificates", "type": "document", "desc": "Encryption certificate details"}]},
                    {"number": "3.6", "name": "Cryptographic keys used to protect stored account data are secured",
                     "evidence": [{"name": "Key Management Policy", "type": "policy", "desc": "Cryptographic key management policy"},
                                  {"name": "Key Storage Evidence", "type": "configuration", "desc": "Evidence of secure key storage"}]},
                    {"number": "3.7", "name": "Where cryptography is used to protect stored account data, key management processes are defined",
                     "evidence": [{"name": "Key Rotation Evidence", "type": "log", "desc": "Evidence of key rotation per policy"},
                                  {"name": "Key Custodian Acknowledgments", "type": "document", "desc": "Signed key custodian forms"}]}
                ]
            },
            {
                "req_number": 4,
                "name": "Protect cardholder data with strong cryptography during transmission",
                "description": "Sensitive information must be encrypted during transmission over networks that are easily accessed by malicious individuals.",
                "sub_reqs": [
                    {"number": "4.1", "name": "Processes and mechanisms for protecting cardholder data with strong cryptography during transmission are defined",
                     "evidence": [{"name": "Transmission Security Policy", "type": "policy", "desc": "Policy for encrypting data in transit"},
                                  {"name": "Approved Protocols List", "type": "document", "desc": "List of approved encryption protocols"}]},
                    {"number": "4.2", "name": "PAN is protected with strong cryptography during transmission",
                     "evidence": [{"name": "TLS Configuration", "type": "configuration", "desc": "TLS/SSL configuration evidence"},
                                  {"name": "Certificate Inventory", "type": "document", "desc": "Inventory of encryption certificates"}]}
                ]
            },
            {
                "req_number": 5,
                "name": "Protect all systems and networks from malicious software",
                "description": "Malicious software poses a constant threat to systems processing payment card data.",
                "sub_reqs": [
                    {"number": "5.1", "name": "Processes and mechanisms for protecting systems from malicious software are defined",
                     "evidence": [{"name": "Anti-Malware Policy", "type": "policy", "desc": "Policy for malware protection"},
                                  {"name": "AV Deployment Standards", "type": "document", "desc": "Anti-virus deployment standards"}]},
                    {"number": "5.2", "name": "Malicious software is prevented, or detected and addressed",
                     "evidence": [{"name": "AV Deployment Evidence", "type": "screenshot", "desc": "Evidence of AV deployed on all systems"},
                                  {"name": "Malware Detection Logs", "type": "log", "desc": "Recent malware detection and response logs"}]},
                    {"number": "5.3", "name": "Anti-malware mechanisms and processes are active, maintained, and monitored",
                     "evidence": [{"name": "AV Update Evidence", "type": "screenshot", "desc": "Evidence of current AV signatures"},
                                  {"name": "AV Monitoring Dashboard", "type": "screenshot", "desc": "Central AV monitoring console"}]},
                    {"number": "5.4", "name": "Anti-phishing mechanisms protect users against phishing attacks",
                     "evidence": [{"name": "Email Security Configuration", "type": "configuration", "desc": "Email anti-phishing configuration"},
                                  {"name": "Phishing Awareness Training", "type": "document", "desc": "Phishing training completion records"}]}
                ]
            },
            {
                "req_number": 6,
                "name": "Develop and maintain secure systems and software",
                "description": "Security vulnerabilities in systems and software may allow criminals to gain access to payment card data.",
                "sub_reqs": [
                    {"number": "6.1", "name": "Processes for developing and maintaining secure systems and software are defined",
                     "evidence": [{"name": "SDLC Policy", "type": "policy", "desc": "Secure software development lifecycle policy"},
                                  {"name": "Security Training Records", "type": "document", "desc": "Developer security training records"}]},
                    {"number": "6.2", "name": "Bespoke and custom software are developed securely",
                     "evidence": [{"name": "Code Review Process", "type": "document", "desc": "Code review procedures and evidence"},
                                  {"name": "Security Testing Results", "type": "report", "desc": "Application security testing results"}]},
                    {"number": "6.3", "name": "Security vulnerabilities are identified and addressed",
                     "evidence": [{"name": "Vulnerability Management Policy", "type": "policy", "desc": "Vulnerability management policy"},
                                  {"name": "Patch Management Records", "type": "log", "desc": "Patch installation records"}]},
                    {"number": "6.4", "name": "Public-facing web applications are protected against attacks",
                     "evidence": [{"name": "WAF Configuration", "type": "configuration", "desc": "Web application firewall configuration"},
                                  {"name": "Web App Scan Results", "type": "report", "desc": "Web application vulnerability scan results"}]},
                    {"number": "6.5", "name": "Changes to all system components are managed securely",
                     "evidence": [{"name": "Change Management Policy", "type": "policy", "desc": "Change management policy and procedures"},
                                  {"name": "Change Records", "type": "log", "desc": "Recent change request records with approvals"}]}
                ]
            },
            {
                "req_number": 7,
                "name": "Restrict access to cardholder data by business need to know",
                "description": "Systems and processes must limit access to system components and cardholder data to only those whose job requires such access.",
                "sub_reqs": [
                    {"number": "7.1", "name": "Processes for restricting access to cardholder data by business need to know are defined",
                     "evidence": [{"name": "Access Control Policy", "type": "policy", "desc": "Access control policy with need-to-know basis"},
                                  {"name": "Role Definitions", "type": "document", "desc": "Job role access level definitions"}]},
                    {"number": "7.2", "name": "Access to system components and data is appropriately defined and assigned",
                     "evidence": [{"name": "Access Matrix", "type": "document", "desc": "Access control matrix for CDE systems"},
                                  {"name": "User Access Review", "type": "log", "desc": "Recent user access review records"}]},
                    {"number": "7.3", "name": "Access to system components and data is managed via an access control system",
                     "evidence": [{"name": "RBAC Configuration", "type": "configuration", "desc": "Role-based access control configuration"},
                                  {"name": "Access Denied Logs", "type": "log", "desc": "Logs showing denied access attempts"}]}
                ]
            },
            {
                "req_number": 8,
                "name": "Identify users and authenticate access to system components",
                "description": "Two fundamental principles: establish identity and prove/verify the user is who they claim to be.",
                "sub_reqs": [
                    {"number": "8.1", "name": "Processes for identifying users and authenticating access are defined",
                     "evidence": [{"name": "Authentication Policy", "type": "policy", "desc": "User authentication policy"},
                                  {"name": "Identity Management Procedures", "type": "document", "desc": "Identity management procedures"}]},
                    {"number": "8.2", "name": "User identification and related accounts are strictly managed",
                     "evidence": [{"name": "User Account Inventory", "type": "document", "desc": "Inventory of all user accounts"},
                                  {"name": "Account Review Evidence", "type": "log", "desc": "Periodic account review records"}]},
                    {"number": "8.3", "name": "Strong authentication for users and administrators is established and managed",
                     "evidence": [{"name": "Password Policy Configuration", "type": "configuration", "desc": "Password complexity settings"},
                                  {"name": "Password Policy Document", "type": "policy", "desc": "Password policy requirements"}]},
                    {"number": "8.4", "name": "Multi-factor authentication (MFA) is implemented",
                     "evidence": [{"name": "MFA Configuration", "type": "configuration", "desc": "MFA setup and configuration"},
                                  {"name": "MFA Deployment Evidence", "type": "screenshot", "desc": "Evidence of MFA for CDE access"}]},
                    {"number": "8.5", "name": "Multi-factor authentication systems are configured to prevent misuse",
                     "evidence": [{"name": "MFA Lockout Settings", "type": "configuration", "desc": "MFA lockout and retry configuration"},
                                  {"name": "MFA Monitoring Logs", "type": "log", "desc": "MFA authentication attempt logs"}]},
                    {"number": "8.6", "name": "Use of application and system accounts is strictly managed",
                     "evidence": [{"name": "Service Account Inventory", "type": "document", "desc": "Inventory of service/system accounts"},
                                  {"name": "Service Account Review", "type": "log", "desc": "Service account periodic review"}]}
                ]
            },
            {
                "req_number": 9,
                "name": "Restrict physical access to cardholder data",
                "description": "Any physical access to cardholder data provides opportunity for individuals to access and/or remove systems.",
                "sub_reqs": [
                    {"number": "9.1", "name": "Processes for restricting physical access to cardholder data are defined",
                     "evidence": [{"name": "Physical Security Policy", "type": "policy", "desc": "Physical security policy"},
                                  {"name": "Facility Security Plan", "type": "document", "desc": "Facility security procedures"}]},
                    {"number": "9.2", "name": "Physical access controls manage entry into facilities and systems containing cardholder data",
                     "evidence": [{"name": "Badge System Configuration", "type": "configuration", "desc": "Access badge system settings"},
                                  {"name": "Access Control Evidence", "type": "screenshot", "desc": "Evidence of physical access controls"}]},
                    {"number": "9.3", "name": "Physical access for personnel and visitors is authorized and managed",
                     "evidence": [{"name": "Visitor Log", "type": "log", "desc": "Visitor access log samples"},
                                  {"name": "Badge Assignment Records", "type": "document", "desc": "Employee badge assignment records"}]},
                    {"number": "9.4", "name": "Media with cardholder data is securely stored, accessed, distributed, and destroyed",
                     "evidence": [{"name": "Media Handling Policy", "type": "policy", "desc": "Media handling and destruction policy"},
                                  {"name": "Media Destruction Records", "type": "log", "desc": "Media destruction certificates"}]},
                    {"number": "9.5", "name": "POI devices are protected from tampering and unauthorized substitution",
                     "evidence": [{"name": "POI Device Inventory", "type": "document", "desc": "Point of interaction device inventory"},
                                  {"name": "POI Inspection Records", "type": "log", "desc": "POI device inspection logs"}]}
                ]
            },
            {
                "req_number": 10,
                "name": "Log and monitor all access to system components and cardholder data",
                "description": "Logging mechanisms and the ability to track user activities are critical for effective forensics.",
                "sub_reqs": [
                    {"number": "10.1", "name": "Processes for logging and monitoring all access are defined",
                     "evidence": [{"name": "Logging Policy", "type": "policy", "desc": "Security logging policy"},
                                  {"name": "Log Retention Policy", "type": "policy", "desc": "Log retention requirements"}]},
                    {"number": "10.2", "name": "Audit logs are implemented to support detection of anomalies",
                     "evidence": [{"name": "Log Configuration", "type": "configuration", "desc": "Audit log configuration settings"},
                                  {"name": "Sample Audit Logs", "type": "log", "desc": "Sample audit log entries"}]},
                    {"number": "10.3", "name": "Audit logs are protected from destruction and unauthorized modifications",
                     "evidence": [{"name": "Log Protection Configuration", "type": "configuration", "desc": "Log file protection settings"},
                                  {"name": "Log Access Controls", "type": "screenshot", "desc": "Evidence of restricted log access"}]},
                    {"number": "10.4", "name": "Audit logs are reviewed to identify anomalies or suspicious activity",
                     "evidence": [{"name": "Log Review Procedure", "type": "document", "desc": "Log review procedures"},
                                  {"name": "Log Review Records", "type": "log", "desc": "Evidence of regular log reviews"}]},
                    {"number": "10.5", "name": "Audit log history is retained and available for analysis",
                     "evidence": [{"name": "Log Archive Evidence", "type": "screenshot", "desc": "Evidence of log retention"},
                                  {"name": "Log Retrieval Test", "type": "document", "desc": "Log retrieval test results"}]},
                    {"number": "10.6", "name": "Time-synchronization mechanisms support consistent time settings",
                     "evidence": [{"name": "NTP Configuration", "type": "configuration", "desc": "Time synchronization configuration"},
                                  {"name": "Time Sync Evidence", "type": "screenshot", "desc": "Evidence of synchronized time"}]},
                    {"number": "10.7", "name": "Failures of critical security control systems are detected and responded to promptly",
                     "evidence": [{"name": "Alert Configuration", "type": "configuration", "desc": "Security control failure alerting"},
                                  {"name": "Incident Response Records", "type": "log", "desc": "Security control failure response records"}]}
                ]
            },
            {
                "req_number": 11,
                "name": "Test security of systems and networks regularly",
                "description": "Vulnerabilities are being discovered continually by malicious individuals and researchers.",
                "sub_reqs": [
                    {"number": "11.1", "name": "Processes for regularly testing security are defined",
                     "evidence": [{"name": "Security Testing Policy", "type": "policy", "desc": "Security testing policy"},
                                  {"name": "Testing Schedule", "type": "document", "desc": "Security testing schedule"}]},
                    {"number": "11.2", "name": "Wireless access points are identified and monitored",
                     "evidence": [{"name": "Wireless AP Inventory", "type": "document", "desc": "Authorized wireless access point list"},
                                  {"name": "Rogue AP Scan Results", "type": "report", "desc": "Rogue wireless detection scan results"}]},
                    {"number": "11.3", "name": "External and internal vulnerabilities are regularly identified and addressed",
                     "evidence": [{"name": "ASV Scan Reports", "type": "report", "desc": "Quarterly ASV scan reports"},
                                  {"name": "Internal Scan Reports", "type": "report", "desc": "Internal vulnerability scan reports"},
                                  {"name": "Remediation Evidence", "type": "log", "desc": "Vulnerability remediation records"}]},
                    {"number": "11.4", "name": "External and internal penetration testing is regularly performed",
                     "evidence": [{"name": "Penetration Test Report", "type": "report", "desc": "Annual penetration test report"},
                                  {"name": "Pentest Remediation", "type": "log", "desc": "Penetration test finding remediation"},
                                  {"name": "Segmentation Test Results", "type": "report", "desc": "Network segmentation test results"}]},
                    {"number": "11.5", "name": "Network intrusions and unexpected file changes are detected and responded to",
                     "evidence": [{"name": "IDS/IPS Configuration", "type": "configuration", "desc": "Intrusion detection system configuration"},
                                  {"name": "FIM Configuration", "type": "configuration", "desc": "File integrity monitoring configuration"}]},
                    {"number": "11.6", "name": "Unauthorized changes on payment pages are detected and responded to",
                     "evidence": [{"name": "Payment Page Monitoring", "type": "configuration", "desc": "Payment page change detection configuration"},
                                  {"name": "Script Integrity Evidence", "type": "screenshot", "desc": "Evidence of script integrity monitoring"}]}
                ]
            },
            {
                "req_number": 12,
                "name": "Support information security with organizational policies and programs",
                "description": "A strong security policy sets the tone for the whole entity and informs personnel what is expected.",
                "sub_reqs": [
                    {"number": "12.1", "name": "A comprehensive information security policy is known and current",
                     "evidence": [{"name": "Information Security Policy", "type": "policy", "desc": "Master information security policy"},
                                  {"name": "Policy Review Records", "type": "log", "desc": "Annual policy review records"}]},
                    {"number": "12.2", "name": "Acceptable use policies for end-user technologies are defined and implemented",
                     "evidence": [{"name": "Acceptable Use Policy", "type": "policy", "desc": "Acceptable use policy"},
                                  {"name": "Policy Acknowledgments", "type": "document", "desc": "User policy acknowledgment records"}]},
                    {"number": "12.3", "name": "Risks to the cardholder data environment are formally identified and managed",
                     "evidence": [{"name": "Risk Assessment", "type": "report", "desc": "Annual risk assessment report"},
                                  {"name": "Risk Register", "type": "document", "desc": "Current risk register"}]},
                    {"number": "12.4", "name": "PCI DSS compliance is managed",
                     "evidence": [{"name": "Compliance Program Charter", "type": "document", "desc": "PCI DSS compliance program charter"},
                                  {"name": "Responsibility Matrix", "type": "document", "desc": "PCI DSS responsibility assignment"}]},
                    {"number": "12.5", "name": "PCI DSS scope is documented and validated",
                     "evidence": [{"name": "Scope Document", "type": "document", "desc": "PCI DSS scope documentation"},
                                  {"name": "Scope Validation", "type": "report", "desc": "Scope validation results"}]},
                    {"number": "12.6", "name": "Security awareness education is an ongoing activity",
                     "evidence": [{"name": "Security Awareness Program", "type": "document", "desc": "Security awareness program description"},
                                  {"name": "Training Completion Records", "type": "log", "desc": "Security training completion records"}]},
                    {"number": "12.7", "name": "Personnel are screened to reduce risks from insider threats",
                     "evidence": [{"name": "Background Check Policy", "type": "policy", "desc": "Background screening policy"},
                                  {"name": "Screening Records", "type": "document", "desc": "Background check completion records"}]},
                    {"number": "12.8", "name": "Risk to information assets from third-party service providers is managed",
                     "evidence": [{"name": "TPSP Inventory", "type": "document", "desc": "Third-party service provider inventory"},
                                  {"name": "TPSP Agreements", "type": "document", "desc": "Service provider agreements with security requirements"},
                                  {"name": "TPSP Monitoring Records", "type": "log", "desc": "Third-party compliance monitoring records"}]},
                    {"number": "12.9", "name": "Third-party service providers support PCI DSS compliance",
                     "evidence": [{"name": "TPSP AOC", "type": "document", "desc": "Service provider attestations of compliance"},
                                  {"name": "Responsibility Matrix", "type": "document", "desc": "TPSP responsibility matrix"}]},
                    {"number": "12.10", "name": "Suspected and confirmed security incidents are immediately addressed",
                     "evidence": [{"name": "Incident Response Plan", "type": "policy", "desc": "Security incident response plan"},
                                  {"name": "IR Test Records", "type": "log", "desc": "Incident response testing records"}]}
                ]
            }
        ]
        
        for req_data in requirements_data:
            requirement = Requirement(
                req_number=req_data["req_number"],
                name=req_data["name"],
                description=req_data["description"]
            )
            db.add(requirement)
            db.flush()
            
            for sub_req in req_data["sub_reqs"]:
                sub_requirement = SubRequirement(
                    requirement_id=requirement.id,
                    sub_req_number=sub_req["number"],
                    name=sub_req["name"]
                )
                db.add(sub_requirement)
                db.flush()
                
                for ev in sub_req.get("evidence", []):
                    evidence = RequiredEvidence(
                        sub_requirement_id=sub_requirement.id,
                        name=ev["name"],
                        description=ev.get("desc", ""),
                        evidence_type=ev["type"]
                    )
                    db.add(evidence)
        
        db.commit()
        print("Database seeded with 7 phases, 12 requirements, and evidence items!")
    except IntegrityError as e:
        db.rollback()
        print(f"Database already seeded (integrity constraint). Skipping... {e}")
    finally:
        db.close()


if __name__ == "__main__":
    seed_database()
