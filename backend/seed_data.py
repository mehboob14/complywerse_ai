from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from models import (SessionLocal, Phase, PhaseTask, PhaseDeliverable, 
                   Requirement, SubRequirement, EvidenceItem, Finding, Risk,
                   init_db, engine)

def seed_database():
    init_db()
    
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
                "description": "Network security controls (NSCs), such as firewalls and other network security technologies, are network policy enforcement points that typically control network traffic between two or more logical or physical network segments.",
                "sub_reqs": [
                    {"number": "1.1", "name": "Processes and mechanisms for installing and maintaining network security controls are defined and understood", "status": "compliant", "evidence_needed": 0},
                    {"number": "1.2", "name": "Network security controls (NSCs) are configured and maintained", "status": "partial", "evidence_needed": 1},
                    {"number": "1.3", "name": "Network access to and from the cardholder data environment is restricted", "status": "partial", "evidence_needed": 1},
                    {"number": "1.4", "name": "Network connections between trusted and untrusted networks are controlled", "status": "compliant", "evidence_needed": 0},
                    {"number": "1.5", "name": "Risks to the CDE from computing devices that connect to both untrusted networks and the CDE are mitigated", "status": "not_started", "evidence_needed": 2}
                ]
            },
            {
                "req_number": 2,
                "name": "Apply secure configurations to all system components",
                "description": "Malicious individuals, both internal and external, often use default passwords and other vendor default settings to compromise systems.",
                "sub_reqs": [
                    {"number": "2.1", "name": "Processes and mechanisms for applying secure configurations are defined and understood", "status": "compliant", "evidence_needed": 0},
                    {"number": "2.2", "name": "System components are configured and managed securely", "status": "partial", "evidence_needed": 1},
                    {"number": "2.3", "name": "Wireless environments are configured and managed securely", "status": "compliant", "evidence_needed": 0}
                ]
            },
            {
                "req_number": 3,
                "name": "Protect stored account data",
                "description": "Protection methods such as encryption, truncation, masking, and hashing are critical components of cardholder data protection.",
                "sub_reqs": [
                    {"number": "3.1", "name": "Processes and mechanisms for protecting stored account data are defined and understood", "status": "compliant", "evidence_needed": 0},
                    {"number": "3.2", "name": "Storage of account data is kept to a minimum", "status": "compliant", "evidence_needed": 0},
                    {"number": "3.3", "name": "Sensitive authentication data (SAD) is not stored after authorization", "status": "compliant", "evidence_needed": 0},
                    {"number": "3.4", "name": "Access to displays of full PAN and ability to copy cardholder data are restricted", "status": "partial", "evidence_needed": 1},
                    {"number": "3.5", "name": "Primary account number (PAN) is secured wherever it is stored", "status": "compliant", "evidence_needed": 0},
                    {"number": "3.6", "name": "Cryptographic keys used to protect stored account data are secured", "status": "partial", "evidence_needed": 2},
                    {"number": "3.7", "name": "Where cryptography is used to protect stored account data, key management processes are defined and implemented", "status": "partial", "evidence_needed": 1}
                ]
            },
            {
                "req_number": 4,
                "name": "Protect cardholder data with strong cryptography during transmission",
                "description": "Sensitive information must be encrypted during transmission over networks that are easily accessed by malicious individuals.",
                "sub_reqs": [
                    {"number": "4.1", "name": "Processes and mechanisms for protecting cardholder data with strong cryptography during transmission are defined and understood", "status": "compliant", "evidence_needed": 0},
                    {"number": "4.2", "name": "PAN is protected with strong cryptography during transmission", "status": "compliant", "evidence_needed": 0}
                ]
            },
            {
                "req_number": 5,
                "name": "Protect all systems and networks from malicious software",
                "description": "Malicious software, commonly referred to as malware, poses a constant threat to systems processing payment card data.",
                "sub_reqs": [
                    {"number": "5.1", "name": "Processes and mechanisms for protecting all systems and networks from malicious software are defined and understood", "status": "compliant", "evidence_needed": 0},
                    {"number": "5.2", "name": "Malicious software is prevented, or detected and addressed", "status": "partial", "evidence_needed": 1},
                    {"number": "5.3", "name": "Anti-malware mechanisms and processes are active, maintained, and monitored", "status": "compliant", "evidence_needed": 0},
                    {"number": "5.4", "name": "Anti-phishing mechanisms protect users against phishing attacks", "status": "not_started", "evidence_needed": 2}
                ]
            },
            {
                "req_number": 6,
                "name": "Develop and maintain secure systems and software",
                "description": "Security vulnerabilities in systems and software may allow criminals to gain access to payment card data.",
                "sub_reqs": [
                    {"number": "6.1", "name": "Processes and mechanisms for developing and maintaining secure systems and software are defined and understood", "status": "compliant", "evidence_needed": 0},
                    {"number": "6.2", "name": "Bespoke and custom software are developed securely", "status": "partial", "evidence_needed": 2},
                    {"number": "6.3", "name": "Security vulnerabilities are identified and addressed", "status": "compliant", "evidence_needed": 0},
                    {"number": "6.4", "name": "Public-facing web applications are protected against attacks", "status": "partial", "evidence_needed": 1},
                    {"number": "6.5", "name": "Changes to all system components are managed securely", "status": "compliant", "evidence_needed": 0}
                ]
            },
            {
                "req_number": 7,
                "name": "Restrict access to cardholder data by business need to know",
                "description": "Systems and processes must limit access to system components and cardholder data to only those whose job requires such access.",
                "sub_reqs": [
                    {"number": "7.1", "name": "Processes and mechanisms for restricting access to cardholder data by business need to know are defined and understood", "status": "compliant", "evidence_needed": 0},
                    {"number": "7.2", "name": "Access to system components and data is appropriately defined and assigned", "status": "partial", "evidence_needed": 1},
                    {"number": "7.3", "name": "Access to system components and data is managed via an access control system(s)", "status": "compliant", "evidence_needed": 0}
                ]
            },
            {
                "req_number": 8,
                "name": "Identify users and authenticate access to system components",
                "description": "Two fundamental principles of identifying and authenticating users are to 1) establish the identity of an individual or process on a computer system, and 2) prove or verify the user associated with the identity is who the user claims to be.",
                "sub_reqs": [
                    {"number": "8.1", "name": "Processes and mechanisms for identifying users and authenticating access to system components are defined and understood", "status": "compliant", "evidence_needed": 0},
                    {"number": "8.2", "name": "User identification and related accounts for users and administrators are strictly managed", "status": "compliant", "evidence_needed": 0},
                    {"number": "8.3", "name": "Strong authentication for users and administrators is established and managed", "status": "partial", "evidence_needed": 2},
                    {"number": "8.4", "name": "Multi-factor authentication (MFA) is implemented", "status": "partial", "evidence_needed": 1},
                    {"number": "8.5", "name": "Multi-factor authentication (MFA) systems are configured to prevent misuse", "status": "not_started", "evidence_needed": 2},
                    {"number": "8.6", "name": "Use of application and system accounts and associated authentication factors is strictly managed", "status": "compliant", "evidence_needed": 0}
                ]
            },
            {
                "req_number": 9,
                "name": "Restrict physical access to cardholder data",
                "description": "Any physical access to cardholder data or systems that store, process, or transmit cardholder data provides the opportunity for individuals to access and/or remove systems or hardcopies containing cardholder data.",
                "sub_reqs": [
                    {"number": "9.1", "name": "Processes and mechanisms for restricting physical access to cardholder data are defined and understood", "status": "compliant", "evidence_needed": 0},
                    {"number": "9.2", "name": "Physical access controls manage entry into facilities and systems containing cardholder data", "status": "compliant", "evidence_needed": 0},
                    {"number": "9.3", "name": "Physical access for personnel and visitors is authorized and managed", "status": "partial", "evidence_needed": 1},
                    {"number": "9.4", "name": "Media with cardholder data is securely stored, accessed, distributed, and destroyed", "status": "compliant", "evidence_needed": 0},
                    {"number": "9.5", "name": "POI devices are protected from tampering and unauthorized substitution", "status": "compliant", "evidence_needed": 0}
                ]
            },
            {
                "req_number": 10,
                "name": "Log and monitor all access to system components and cardholder data",
                "description": "Logging mechanisms and the ability to track user activities are critical for effective forensics and vulnerability management.",
                "sub_reqs": [
                    {"number": "10.1", "name": "Processes and mechanisms for logging and monitoring all access to system components and cardholder data are defined and understood", "status": "compliant", "evidence_needed": 0},
                    {"number": "10.2", "name": "Audit logs are implemented to support the detection of anomalies and suspicious activity", "status": "compliant", "evidence_needed": 0},
                    {"number": "10.3", "name": "Audit logs are protected from destruction and unauthorized modifications", "status": "partial", "evidence_needed": 1},
                    {"number": "10.4", "name": "Audit logs are reviewed to identify anomalies or suspicious activity", "status": "partial", "evidence_needed": 1},
                    {"number": "10.5", "name": "Audit log history is retained and available for analysis", "status": "compliant", "evidence_needed": 0},
                    {"number": "10.6", "name": "Time-synchronization mechanisms support consistent time settings across all systems", "status": "compliant", "evidence_needed": 0},
                    {"number": "10.7", "name": "Failures of critical security control systems are detected, reported, and responded to promptly", "status": "partial", "evidence_needed": 1}
                ]
            },
            {
                "req_number": 11,
                "name": "Test security of systems and networks regularly",
                "description": "Vulnerabilities are being discovered continually by malicious individuals and researchers, and being introduced by new software.",
                "sub_reqs": [
                    {"number": "11.1", "name": "Processes and mechanisms for regularly testing security of systems and networks are defined and understood", "status": "compliant", "evidence_needed": 0},
                    {"number": "11.2", "name": "Wireless access points are identified and monitored, and unauthorized wireless access points are addressed", "status": "compliant", "evidence_needed": 0},
                    {"number": "11.3", "name": "External and internal vulnerabilities are regularly identified, prioritized, and addressed", "status": "partial", "evidence_needed": 2},
                    {"number": "11.4", "name": "External and internal penetration testing is regularly performed", "status": "not_started", "evidence_needed": 3},
                    {"number": "11.5", "name": "Network intrusions and unexpected file changes are detected and responded to", "status": "partial", "evidence_needed": 1},
                    {"number": "11.6", "name": "Unauthorized changes on payment pages are detected and responded to", "status": "compliant", "evidence_needed": 0}
                ]
            },
            {
                "req_number": 12,
                "name": "Support information security with organizational policies and programs",
                "description": "A strong security policy sets the tone for the whole entity and informs personnel what is expected of them.",
                "sub_reqs": [
                    {"number": "12.1", "name": "A comprehensive information security policy is known and current", "status": "compliant", "evidence_needed": 0},
                    {"number": "12.2", "name": "Acceptable use policies for end-user technologies are defined and implemented", "status": "compliant", "evidence_needed": 0},
                    {"number": "12.3", "name": "Risks to the cardholder data environment are formally identified, evaluated, and managed", "status": "partial", "evidence_needed": 1},
                    {"number": "12.4", "name": "PCI DSS compliance is managed", "status": "compliant", "evidence_needed": 0},
                    {"number": "12.5", "name": "PCI DSS scope is documented and validated", "status": "compliant", "evidence_needed": 0},
                    {"number": "12.6", "name": "Security awareness education is an ongoing activity", "status": "partial", "evidence_needed": 1},
                    {"number": "12.7", "name": "Personnel are screened to reduce risks from insider threats", "status": "compliant", "evidence_needed": 0},
                    {"number": "12.8", "name": "Risk to information assets associated with third-party service provider relationships is managed", "status": "partial", "evidence_needed": 2},
                    {"number": "12.9", "name": "Third-party service providers support PCI DSS compliance", "status": "compliant", "evidence_needed": 0},
                    {"number": "12.10", "name": "Suspected and confirmed security incidents are immediately addressed", "status": "partial", "evidence_needed": 1}
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
                    name=sub_req["name"],
                    status=sub_req["status"],
                    evidence_needed=sub_req["evidence_needed"]
                )
                db.add(sub_requirement)
        
        db.commit()
        print("Database seeded with 7 phases and 12 PCI DSS requirements!")
    except IntegrityError as e:
        db.rollback()
        print(f"Database already seeded (integrity constraint). Skipping... {e}")
    finally:
        db.close()


if __name__ == "__main__":
    seed_database()
