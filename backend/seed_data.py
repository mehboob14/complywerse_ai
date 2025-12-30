from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from models import SessionLocal, Control, RequiredEvidence, init_db, engine

def seed_database():
    init_db()
    
    with engine.connect() as conn:
        result = conn.execute(text("SELECT COUNT(*) FROM controls"))
        count = result.scalar()
        if count > 0:
            print(f"Database already has {count} controls. Skipping seed...")
            return
    
    db = SessionLocal()
    
    try:
        controls_data = [
            {
                "name": "Firewall Configuration",
                "description": "Install and maintain a firewall configuration to protect cardholder data. Firewalls are devices that control computer traffic allowed between an entity's networks and untrusted networks.",
                "pci_requirement": "PCI DSS 1.1",
                "evidence": [
                    {"name": "Firewall Policy Document", "type": "policy_doc"},
                    {"name": "Firewall Configuration Snapshot", "type": "config_snapshot"},
                    {"name": "Network Diagram", "type": "diagram"},
                ]
            },
            {
                "name": "Data Encryption",
                "description": "Protect stored cardholder data using strong cryptography. Encryption is a critical component of cardholder data protection.",
                "pci_requirement": "PCI DSS 3.4",
                "evidence": [
                    {"name": "Encryption Policy Document", "type": "policy_doc"},
                    {"name": "Encryption Key Management Procedure", "type": "procedure_doc"},
                    {"name": "TLS/SSL Certificate Evidence", "type": "certificate"},
                ]
            },
            {
                "name": "Security Logging",
                "description": "Track and monitor all access to network resources and cardholder data. Logging mechanisms enable thorough tracking of user activities.",
                "pci_requirement": "PCI DSS 10.1",
                "evidence": [
                    {"name": "Log Retention Policy", "type": "policy_doc"},
                    {"name": "Sample Audit Logs", "type": "log_sample"},
                    {"name": "SIEM Configuration Screenshot", "type": "config_snapshot"},
                ]
            },
            {
                "name": "Antivirus Protection",
                "description": "Use and regularly update anti-virus software or programs. Malicious software poses a constant threat to systems processing cardholder data.",
                "pci_requirement": "PCI DSS 5.1",
                "evidence": [
                    {"name": "Antivirus Policy Document", "type": "policy_doc"},
                    {"name": "Antivirus Scan Report", "type": "scan_report"},
                    {"name": "Antivirus Update Logs", "type": "log_sample"},
                ]
            },
            {
                "name": "Access Control",
                "description": "Restrict access to cardholder data by business need-to-know. Access rights are granted only to the least amount of data and privileges needed.",
                "pci_requirement": "PCI DSS 7.1",
                "evidence": [
                    {"name": "Access Control Policy", "type": "policy_doc"},
                    {"name": "User Access Matrix", "type": "spreadsheet"},
                    {"name": "Access Review Log", "type": "log_sample"},
                    {"name": "Role-Based Access Configuration", "type": "config_snapshot"},
                ]
            },
        ]
        
        for control_data in controls_data:
            control = Control(
                name=control_data["name"],
                description=control_data["description"],
                pci_requirement=control_data["pci_requirement"]
            )
            db.add(control)
            db.flush()
            
            for evidence_data in control_data["evidence"]:
                evidence = RequiredEvidence(
                    control_id=control.id,
                    evidence_name=evidence_data["name"],
                    evidence_type=evidence_data["type"]
                )
                db.add(evidence)
        
        db.commit()
        print("Database seeded successfully with 5 controls and 16 evidence items!")
    except IntegrityError:
        db.rollback()
        print("Database already seeded (integrity constraint). Skipping...")
    finally:
        db.close()


if __name__ == "__main__":
    seed_database()
