"""
Reseed frameworks with comprehensive control data.
Run with: python -m grc.reseed_frameworks
"""
from .models import (
    SessionLocal, Framework, FrameworkDomain, ControlObjective,
    FrameworkControl, FrameworkSubControl, GRCRequiredEvidence, NormalizedControl, ControlMapping,
    CertificationJourney, ControlImplementation, ImplementationEvidence, Base, engine
)
from .expanded_seed_data import PCI_DSS_V4_DATA


def reseed_frameworks():
    """Delete existing frameworks and reseed with comprehensive data."""
    db = SessionLocal()
    try:
        print("Deleting existing framework data...")
        
        db.query(ImplementationEvidence).delete()
        db.query(ControlImplementation).delete()
        db.query(CertificationJourney).delete()
        db.query(GRCRequiredEvidence).delete()
        db.query(ControlMapping).delete()
        db.query(FrameworkSubControl).delete()
        db.query(FrameworkControl).delete()
        db.query(ControlObjective).delete()
        db.query(FrameworkDomain).delete()
        db.query(Framework).delete()
        db.query(NormalizedControl).delete()
        db.commit()
        
        print("Seeding PCI DSS v4.0...")
        seed_framework_from_data(db, PCI_DSS_V4_DATA)
        
        print("Seeding ISO 27001:2022...")
        seed_iso_27001(db)
        
        print("Seeding ISO 20000-1:2018...")
        seed_iso_20000(db)
        
        print("Seeding SWIFT CSP 2024...")
        seed_swift_csp(db)
        
        print("Seeding NIST CSF 2.0...")
        seed_nist_csf(db)
        
        print("Seeding CBB 2023...")
        seed_cbb(db)
        
        print("Seeding SAMA 1.0...")
        seed_sama(db)
        
        print("Seeding SBP 2023...")
        seed_sbp(db)
        
        db.commit()
        print("Reseed complete!")
        
        print("\n=== Framework Summary ===")
        for f in db.query(Framework).all():
            domains = db.query(FrameworkDomain).filter(FrameworkDomain.framework_id == f.id).count()
            objectives = db.query(ControlObjective).join(FrameworkDomain).filter(FrameworkDomain.framework_id == f.id).count()
            controls = db.query(FrameworkControl).join(ControlObjective).join(FrameworkDomain).filter(FrameworkDomain.framework_id == f.id).count()
            print(f'{f.short_code}: {domains} domains, {objectives} objectives, {controls} controls')
        
    except Exception as e:
        db.rollback()
        print(f"Error reseeding: {e}")
        raise
    finally:
        db.close()


def seed_framework_from_data(db, data):
    """Seed a framework from the expanded data format."""
    framework = Framework(
        name=data["name"],
        short_code=data["short_code"],
        regulator=data.get("regulator"),
        jurisdiction=data.get("jurisdiction"),
        version=data.get("version"),
        description=data.get("description"),
        is_mandatory=data.get("is_mandatory", False),
        enforcement_type=data.get("enforcement_type")
    )
    db.add(framework)
    db.flush()
    
    for domain_data in data.get("domains", []):
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
                control = FrameworkControl(
                    objective_id=objective.id,
                    code=ctrl_data["code"],
                    name=ctrl_data["name"],
                    statement=ctrl_data.get("statement"),
                    is_mandatory=ctrl_data.get("is_mandatory", True),
                    implementation_guidance=ctrl_data.get("implementation_guidance"),
                    testing_guidance=ctrl_data.get("testing_guidance"),
                    order=ctrl_data.get("order", 0)
                )
                db.add(control)
                db.flush()
                
                for sub_data in ctrl_data.get("sub_controls", []):
                    sub = FrameworkSubControl(
                        control_id=control.id,
                        code=sub_data["code"],
                        name=sub_data["name"],
                        statement=sub_data.get("statement"),
                        order=sub_data.get("order", 0)
                    )
                    db.add(sub)


def seed_iso_27001(db):
    """Seed ISO 27001:2022 with all Annex A controls."""
    framework = Framework(
        name="ISO/IEC 27001:2022",
        short_code="ISO_27001",
        regulator="International Organization for Standardization",
        jurisdiction="Global",
        version="2022",
        description="Information Security Management System",
        is_mandatory=False,
        enforcement_type="Certification"
    )
    db.add(framework)
    db.flush()
    
    domains = [
        {
            "code": "A.5",
            "name": "Organizational Controls",
            "description": "Organizational security controls",
            "order": 1,
            "objectives": [
                {"code": "A.5.1", "name": "Policies for information security", "controls": [
                    {"code": "A.5.1.1", "name": "Policies for information security", "statement": "Information security policy and topic-specific policies shall be defined, approved by management, published, communicated to and acknowledged by relevant personnel and relevant interested parties, and reviewed at planned intervals."},
                    {"code": "A.5.1.2", "name": "Review of the policies", "statement": "The policies for information security shall be reviewed at planned intervals or if significant changes occur."},
                ]},
                {"code": "A.5.2", "name": "Information security roles and responsibilities", "controls": [
                    {"code": "A.5.2.1", "name": "Information security roles and responsibilities", "statement": "Information security roles and responsibilities shall be defined and allocated according to the organization needs."},
                ]},
                {"code": "A.5.3", "name": "Segregation of duties", "controls": [
                    {"code": "A.5.3.1", "name": "Segregation of duties", "statement": "Conflicting duties and conflicting areas of responsibility shall be segregated."},
                ]},
                {"code": "A.5.4", "name": "Management responsibilities", "controls": [
                    {"code": "A.5.4.1", "name": "Management responsibilities", "statement": "Management shall require all personnel to apply information security in accordance with the established policies, procedures and requirements."},
                ]},
                {"code": "A.5.5", "name": "Contact with authorities", "controls": [
                    {"code": "A.5.5.1", "name": "Contact with authorities", "statement": "Appropriate contacts with relevant authorities shall be maintained."},
                ]},
                {"code": "A.5.6", "name": "Contact with special interest groups", "controls": [
                    {"code": "A.5.6.1", "name": "Contact with special interest groups", "statement": "Appropriate contacts with special interest groups or other specialist security forums and professional associations shall be maintained."},
                ]},
                {"code": "A.5.7", "name": "Threat intelligence", "controls": [
                    {"code": "A.5.7.1", "name": "Threat intelligence", "statement": "Information relating to information security threats shall be collected and analysed to produce threat intelligence."},
                ]},
                {"code": "A.5.8", "name": "Information security in project management", "controls": [
                    {"code": "A.5.8.1", "name": "Information security in project management", "statement": "Information security shall be integrated into project management."},
                ]},
                {"code": "A.5.9", "name": "Inventory of information and other associated assets", "controls": [
                    {"code": "A.5.9.1", "name": "Inventory of information and other associated assets", "statement": "An inventory of information and other associated assets shall be developed and maintained."},
                ]},
                {"code": "A.5.10", "name": "Acceptable use of information and other associated assets", "controls": [
                    {"code": "A.5.10.1", "name": "Acceptable use of information and other associated assets", "statement": "Rules for the acceptable use and procedures for handling information and other associated assets shall be identified, documented and implemented."},
                ]},
                {"code": "A.5.11", "name": "Return of assets", "controls": [
                    {"code": "A.5.11.1", "name": "Return of assets", "statement": "Personnel and other interested parties shall return all organizational assets in their possession upon change or termination."},
                ]},
                {"code": "A.5.12", "name": "Classification of information", "controls": [
                    {"code": "A.5.12.1", "name": "Classification of information", "statement": "Information shall be classified according to the information security needs of the organization."},
                ]},
                {"code": "A.5.13", "name": "Labelling of information", "controls": [
                    {"code": "A.5.13.1", "name": "Labelling of information", "statement": "An appropriate set of procedures for information labelling shall be developed and implemented."},
                ]},
                {"code": "A.5.14", "name": "Information transfer", "controls": [
                    {"code": "A.5.14.1", "name": "Information transfer", "statement": "Information transfer rules, procedures, or agreements shall be in place for all types of transfer facilities."},
                ]},
                {"code": "A.5.15", "name": "Access control", "controls": [
                    {"code": "A.5.15.1", "name": "Access control", "statement": "Rules to control physical and logical access to information and other associated assets shall be established and implemented."},
                ]},
                {"code": "A.5.16", "name": "Identity management", "controls": [
                    {"code": "A.5.16.1", "name": "Identity management", "statement": "The full lifecycle of identities shall be managed."},
                ]},
                {"code": "A.5.17", "name": "Authentication information", "controls": [
                    {"code": "A.5.17.1", "name": "Authentication information", "statement": "Allocation and management of authentication information shall be controlled."},
                ]},
                {"code": "A.5.18", "name": "Access rights", "controls": [
                    {"code": "A.5.18.1", "name": "Access rights", "statement": "Access rights to information and other associated assets shall be provisioned, reviewed, modified and removed."},
                ]},
                {"code": "A.5.19", "name": "Information security in supplier relationships", "controls": [
                    {"code": "A.5.19.1", "name": "Information security in supplier relationships", "statement": "Processes and procedures shall be defined and implemented to manage the information security risks associated with suppliers."},
                ]},
                {"code": "A.5.20", "name": "Addressing information security within supplier agreements", "controls": [
                    {"code": "A.5.20.1", "name": "Addressing information security within supplier agreements", "statement": "Relevant information security requirements shall be established and agreed with each supplier."},
                ]},
                {"code": "A.5.21", "name": "Managing information security in the ICT supply chain", "controls": [
                    {"code": "A.5.21.1", "name": "Managing information security in the ICT supply chain", "statement": "Processes and procedures shall be defined and implemented to manage information security risks associated with the ICT products and services supply chain."},
                ]},
                {"code": "A.5.22", "name": "Monitoring, review and change management of supplier services", "controls": [
                    {"code": "A.5.22.1", "name": "Monitoring, review and change management of supplier services", "statement": "The organization shall regularly monitor, review, evaluate and manage change in supplier information security practices and service delivery."},
                ]},
                {"code": "A.5.23", "name": "Information security for use of cloud services", "controls": [
                    {"code": "A.5.23.1", "name": "Information security for use of cloud services", "statement": "Processes for acquisition, use, management and exit from cloud services shall be established."},
                ]},
                {"code": "A.5.24", "name": "Information security incident management planning and preparation", "controls": [
                    {"code": "A.5.24.1", "name": "Information security incident management planning and preparation", "statement": "The organization shall plan and prepare for managing information security incidents."},
                ]},
                {"code": "A.5.25", "name": "Assessment and decision on information security events", "controls": [
                    {"code": "A.5.25.1", "name": "Assessment and decision on information security events", "statement": "The organization shall assess information security events and decide if they are to be categorized as information security incidents."},
                ]},
                {"code": "A.5.26", "name": "Response to information security incidents", "controls": [
                    {"code": "A.5.26.1", "name": "Response to information security incidents", "statement": "Information security incidents shall be responded to in accordance with documented procedures."},
                ]},
                {"code": "A.5.27", "name": "Learning from information security incidents", "controls": [
                    {"code": "A.5.27.1", "name": "Learning from information security incidents", "statement": "Knowledge gained from information security incidents shall be used to strengthen and improve controls."},
                ]},
                {"code": "A.5.28", "name": "Collection of evidence", "controls": [
                    {"code": "A.5.28.1", "name": "Collection of evidence", "statement": "The organization shall establish and implement procedures for the identification, collection, acquisition and preservation of evidence."},
                ]},
                {"code": "A.5.29", "name": "Information security during disruption", "controls": [
                    {"code": "A.5.29.1", "name": "Information security during disruption", "statement": "The organization shall plan how to maintain information security at an appropriate level during disruption."},
                ]},
                {"code": "A.5.30", "name": "ICT readiness for business continuity", "controls": [
                    {"code": "A.5.30.1", "name": "ICT readiness for business continuity", "statement": "ICT readiness shall be planned, implemented, maintained and tested."},
                ]},
                {"code": "A.5.31", "name": "Legal, statutory, regulatory and contractual requirements", "controls": [
                    {"code": "A.5.31.1", "name": "Legal, statutory, regulatory and contractual requirements", "statement": "Legal, statutory, regulatory and contractual requirements relevant to information security shall be identified, documented and kept up to date."},
                ]},
                {"code": "A.5.32", "name": "Intellectual property rights", "controls": [
                    {"code": "A.5.32.1", "name": "Intellectual property rights", "statement": "The organization shall implement appropriate procedures to protect intellectual property rights."},
                ]},
                {"code": "A.5.33", "name": "Protection of records", "controls": [
                    {"code": "A.5.33.1", "name": "Protection of records", "statement": "Records shall be protected from loss, destruction, falsification, unauthorized access and unauthorized release."},
                ]},
                {"code": "A.5.34", "name": "Privacy and protection of PII", "controls": [
                    {"code": "A.5.34.1", "name": "Privacy and protection of PII", "statement": "The organization shall identify and meet the requirements regarding privacy and protection of PII."},
                ]},
                {"code": "A.5.35", "name": "Independent review of information security", "controls": [
                    {"code": "A.5.35.1", "name": "Independent review of information security", "statement": "The organization's approach to managing information security shall be independently reviewed at planned intervals."},
                ]},
                {"code": "A.5.36", "name": "Compliance with policies, rules and standards for information security", "controls": [
                    {"code": "A.5.36.1", "name": "Compliance with policies, rules and standards for information security", "statement": "Compliance with the organization's information security policy, topic-specific policies, rules and standards shall be regularly reviewed."},
                ]},
                {"code": "A.5.37", "name": "Documented operating procedures", "controls": [
                    {"code": "A.5.37.1", "name": "Documented operating procedures", "statement": "Operating procedures for information processing facilities shall be documented and made available to personnel who need them."},
                ]},
            ]
        },
        {
            "code": "A.6",
            "name": "People Controls",
            "description": "People-related security controls",
            "order": 2,
            "objectives": [
                {"code": "A.6.1", "name": "Screening", "controls": [
                    {"code": "A.6.1.1", "name": "Screening", "statement": "Background verification checks on all candidates shall be carried out prior to joining the organization."},
                ]},
                {"code": "A.6.2", "name": "Terms and conditions of employment", "controls": [
                    {"code": "A.6.2.1", "name": "Terms and conditions of employment", "statement": "The employment contractual agreements shall state the personnel's and the organization's responsibilities for information security."},
                ]},
                {"code": "A.6.3", "name": "Information security awareness, education and training", "controls": [
                    {"code": "A.6.3.1", "name": "Information security awareness, education and training", "statement": "Personnel and relevant interested parties shall receive appropriate information security awareness, education and training."},
                ]},
                {"code": "A.6.4", "name": "Disciplinary process", "controls": [
                    {"code": "A.6.4.1", "name": "Disciplinary process", "statement": "A disciplinary process shall be formalized and communicated to take actions against personnel who have committed an information security policy violation."},
                ]},
                {"code": "A.6.5", "name": "Responsibilities after termination or change of employment", "controls": [
                    {"code": "A.6.5.1", "name": "Responsibilities after termination or change of employment", "statement": "Information security responsibilities and duties that remain valid after termination or change of employment shall be defined, enforced and communicated."},
                ]},
                {"code": "A.6.6", "name": "Confidentiality or non-disclosure agreements", "controls": [
                    {"code": "A.6.6.1", "name": "Confidentiality or non-disclosure agreements", "statement": "Confidentiality or non-disclosure agreements reflecting the organization's needs for the protection of information shall be identified, documented, regularly reviewed and signed."},
                ]},
                {"code": "A.6.7", "name": "Remote working", "controls": [
                    {"code": "A.6.7.1", "name": "Remote working", "statement": "Security measures shall be implemented when personnel are working remotely to protect information accessed, processed or stored outside the organization's premises."},
                ]},
                {"code": "A.6.8", "name": "Information security event reporting", "controls": [
                    {"code": "A.6.8.1", "name": "Information security event reporting", "statement": "The organization shall provide a mechanism for personnel to report observed or suspected information security events through appropriate channels in a timely manner."},
                ]},
            ]
        },
        {
            "code": "A.7",
            "name": "Physical Controls",
            "description": "Physical security controls",
            "order": 3,
            "objectives": [
                {"code": "A.7.1", "name": "Physical security perimeters", "controls": [
                    {"code": "A.7.1.1", "name": "Physical security perimeters", "statement": "Security perimeters shall be defined and used to protect areas that contain information and other associated assets."},
                ]},
                {"code": "A.7.2", "name": "Physical entry", "controls": [
                    {"code": "A.7.2.1", "name": "Physical entry", "statement": "Secure areas shall be protected by appropriate entry controls and access points."},
                ]},
                {"code": "A.7.3", "name": "Securing offices, rooms and facilities", "controls": [
                    {"code": "A.7.3.1", "name": "Securing offices, rooms and facilities", "statement": "Physical security for offices, rooms and facilities shall be designed and implemented."},
                ]},
                {"code": "A.7.4", "name": "Physical security monitoring", "controls": [
                    {"code": "A.7.4.1", "name": "Physical security monitoring", "statement": "Premises shall be continuously monitored for unauthorized physical access."},
                ]},
                {"code": "A.7.5", "name": "Protecting against physical and environmental threats", "controls": [
                    {"code": "A.7.5.1", "name": "Protecting against physical and environmental threats", "statement": "Protection against physical and environmental threats, such as natural disasters and other intentional or unintentional physical threats to infrastructure shall be designed and implemented."},
                ]},
                {"code": "A.7.6", "name": "Working in secure areas", "controls": [
                    {"code": "A.7.6.1", "name": "Working in secure areas", "statement": "Security measures for working in secure areas shall be designed and implemented."},
                ]},
                {"code": "A.7.7", "name": "Clear desk and clear screen", "controls": [
                    {"code": "A.7.7.1", "name": "Clear desk and clear screen", "statement": "Clear desk rules for papers and removable storage media and clear screen rules for information processing facilities shall be defined and appropriately enforced."},
                ]},
                {"code": "A.7.8", "name": "Equipment siting and protection", "controls": [
                    {"code": "A.7.8.1", "name": "Equipment siting and protection", "statement": "Equipment shall be sited securely and protected."},
                ]},
                {"code": "A.7.9", "name": "Security of assets off-premises", "controls": [
                    {"code": "A.7.9.1", "name": "Security of assets off-premises", "statement": "Off-site assets shall be protected."},
                ]},
                {"code": "A.7.10", "name": "Storage media", "controls": [
                    {"code": "A.7.10.1", "name": "Storage media", "statement": "Storage media shall be managed through their lifecycle of acquisition, use, transportation and disposal."},
                ]},
                {"code": "A.7.11", "name": "Supporting utilities", "controls": [
                    {"code": "A.7.11.1", "name": "Supporting utilities", "statement": "Information processing facilities shall be protected from power failures and other disruptions caused by failures in supporting utilities."},
                ]},
                {"code": "A.7.12", "name": "Cabling security", "controls": [
                    {"code": "A.7.12.1", "name": "Cabling security", "statement": "Cables carrying power, data or supporting information services shall be protected from interception, interference or damage."},
                ]},
                {"code": "A.7.13", "name": "Equipment maintenance", "controls": [
                    {"code": "A.7.13.1", "name": "Equipment maintenance", "statement": "Equipment shall be maintained correctly to ensure availability, integrity and continued confidentiality of information."},
                ]},
                {"code": "A.7.14", "name": "Secure disposal or re-use of equipment", "controls": [
                    {"code": "A.7.14.1", "name": "Secure disposal or re-use of equipment", "statement": "Items of equipment containing storage media shall be verified to ensure that any sensitive data and licensed software has been removed or securely overwritten prior to disposal or re-use."},
                ]},
            ]
        },
        {
            "code": "A.8",
            "name": "Technological Controls",
            "description": "Technology-related security controls",
            "order": 4,
            "objectives": [
                {"code": "A.8.1", "name": "User endpoint devices", "controls": [
                    {"code": "A.8.1.1", "name": "User endpoint devices", "statement": "Information stored on, processed by or accessible via user endpoint devices shall be protected."},
                ]},
                {"code": "A.8.2", "name": "Privileged access rights", "controls": [
                    {"code": "A.8.2.1", "name": "Privileged access rights", "statement": "The allocation and use of privileged access rights shall be restricted and managed."},
                ]},
                {"code": "A.8.3", "name": "Information access restriction", "controls": [
                    {"code": "A.8.3.1", "name": "Information access restriction", "statement": "Access to information and other associated assets shall be restricted in accordance with the established topic-specific policy on access control."},
                ]},
                {"code": "A.8.4", "name": "Access to source code", "controls": [
                    {"code": "A.8.4.1", "name": "Access to source code", "statement": "Read and write access to source code, development tools and software libraries shall be appropriately managed."},
                ]},
                {"code": "A.8.5", "name": "Secure authentication", "controls": [
                    {"code": "A.8.5.1", "name": "Secure authentication", "statement": "Secure authentication technologies and procedures shall be implemented based on information access restrictions and the topic-specific policy on access control."},
                ]},
                {"code": "A.8.6", "name": "Capacity management", "controls": [
                    {"code": "A.8.6.1", "name": "Capacity management", "statement": "The use of resources shall be monitored and adjusted in line with current and expected capacity requirements."},
                ]},
                {"code": "A.8.7", "name": "Protection against malware", "controls": [
                    {"code": "A.8.7.1", "name": "Protection against malware", "statement": "Protection against malware shall be implemented and supported by appropriate user awareness."},
                ]},
                {"code": "A.8.8", "name": "Management of technical vulnerabilities", "controls": [
                    {"code": "A.8.8.1", "name": "Management of technical vulnerabilities", "statement": "Information about technical vulnerabilities of information systems in use shall be obtained, the organization's exposure to such vulnerabilities shall be evaluated and appropriate measures shall be taken."},
                ]},
                {"code": "A.8.9", "name": "Configuration management", "controls": [
                    {"code": "A.8.9.1", "name": "Configuration management", "statement": "Configurations, including security configurations, of hardware, software, services and networks shall be established, documented, implemented, monitored and reviewed."},
                ]},
                {"code": "A.8.10", "name": "Information deletion", "controls": [
                    {"code": "A.8.10.1", "name": "Information deletion", "statement": "Information stored in information systems, devices or in any other storage media shall be deleted when no longer required."},
                ]},
                {"code": "A.8.11", "name": "Data masking", "controls": [
                    {"code": "A.8.11.1", "name": "Data masking", "statement": "Data masking shall be used in accordance with the organization's topic-specific policy on access control and other related topic-specific policies, and business requirements, taking applicable legislation into consideration."},
                ]},
                {"code": "A.8.12", "name": "Data leakage prevention", "controls": [
                    {"code": "A.8.12.1", "name": "Data leakage prevention", "statement": "Data leakage prevention measures shall be applied to systems, networks and any other devices that process, store or transmit sensitive information."},
                ]},
                {"code": "A.8.13", "name": "Information backup", "controls": [
                    {"code": "A.8.13.1", "name": "Information backup", "statement": "Backup copies of information, software and systems shall be maintained and regularly tested in accordance with the agreed topic-specific policy on backup."},
                ]},
                {"code": "A.8.14", "name": "Redundancy of information processing facilities", "controls": [
                    {"code": "A.8.14.1", "name": "Redundancy of information processing facilities", "statement": "Information processing facilities shall be implemented with redundancy sufficient to meet availability requirements."},
                ]},
                {"code": "A.8.15", "name": "Logging", "controls": [
                    {"code": "A.8.15.1", "name": "Logging", "statement": "Logs that record activities, exceptions, faults and other relevant events shall be produced, stored, protected and analysed."},
                ]},
                {"code": "A.8.16", "name": "Monitoring activities", "controls": [
                    {"code": "A.8.16.1", "name": "Monitoring activities", "statement": "Networks, systems and applications shall be monitored for anomalous behaviour and appropriate actions taken to evaluate potential information security incidents."},
                ]},
                {"code": "A.8.17", "name": "Clock synchronization", "controls": [
                    {"code": "A.8.17.1", "name": "Clock synchronization", "statement": "The clocks of information processing systems used by the organization shall be synchronized to approved time sources."},
                ]},
                {"code": "A.8.18", "name": "Use of privileged utility programs", "controls": [
                    {"code": "A.8.18.1", "name": "Use of privileged utility programs", "statement": "The use of utility programs that might be capable of overriding system and application controls shall be restricted and tightly controlled."},
                ]},
                {"code": "A.8.19", "name": "Installation of software on operational systems", "controls": [
                    {"code": "A.8.19.1", "name": "Installation of software on operational systems", "statement": "Procedures and measures shall be implemented to securely manage software installation on operational systems."},
                ]},
                {"code": "A.8.20", "name": "Networks security", "controls": [
                    {"code": "A.8.20.1", "name": "Networks security", "statement": "Networks and network devices shall be secured, managed and controlled to protect information in systems and applications."},
                ]},
                {"code": "A.8.21", "name": "Security of network services", "controls": [
                    {"code": "A.8.21.1", "name": "Security of network services", "statement": "Security mechanisms, service levels and service requirements of network services shall be identified, implemented and monitored."},
                ]},
                {"code": "A.8.22", "name": "Segregation of networks", "controls": [
                    {"code": "A.8.22.1", "name": "Segregation of networks", "statement": "Groups of information services, users and information systems shall be segregated in the organization's networks."},
                ]},
                {"code": "A.8.23", "name": "Web filtering", "controls": [
                    {"code": "A.8.23.1", "name": "Web filtering", "statement": "Access to external websites shall be managed to reduce exposure to malicious content."},
                ]},
                {"code": "A.8.24", "name": "Use of cryptography", "controls": [
                    {"code": "A.8.24.1", "name": "Use of cryptography", "statement": "Rules for the effective use of cryptography, including cryptographic key management, shall be defined and implemented."},
                ]},
                {"code": "A.8.25", "name": "Secure development life cycle", "controls": [
                    {"code": "A.8.25.1", "name": "Secure development life cycle", "statement": "Rules for the secure development of software and systems shall be established and applied."},
                ]},
                {"code": "A.8.26", "name": "Application security requirements", "controls": [
                    {"code": "A.8.26.1", "name": "Application security requirements", "statement": "Information security requirements shall be identified, specified and approved when developing or acquiring applications."},
                ]},
                {"code": "A.8.27", "name": "Secure system architecture and engineering principles", "controls": [
                    {"code": "A.8.27.1", "name": "Secure system architecture and engineering principles", "statement": "Principles for engineering secure systems shall be established, documented, maintained and applied to any information system development activities."},
                ]},
                {"code": "A.8.28", "name": "Secure coding", "controls": [
                    {"code": "A.8.28.1", "name": "Secure coding", "statement": "Secure coding principles shall be applied to software development."},
                ]},
                {"code": "A.8.29", "name": "Security testing in development and acceptance", "controls": [
                    {"code": "A.8.29.1", "name": "Security testing in development and acceptance", "statement": "Security testing processes shall be defined and implemented in the development life cycle."},
                ]},
                {"code": "A.8.30", "name": "Outsourced development", "controls": [
                    {"code": "A.8.30.1", "name": "Outsourced development", "statement": "The organization shall direct, monitor and review the activities related to outsourced system development."},
                ]},
                {"code": "A.8.31", "name": "Separation of development, test and production environments", "controls": [
                    {"code": "A.8.31.1", "name": "Separation of development, test and production environments", "statement": "Development, testing and production environments shall be separated and secured."},
                ]},
                {"code": "A.8.32", "name": "Change management", "controls": [
                    {"code": "A.8.32.1", "name": "Change management", "statement": "Changes to information processing facilities and information systems shall be subject to change management procedures."},
                ]},
                {"code": "A.8.33", "name": "Test information", "controls": [
                    {"code": "A.8.33.1", "name": "Test information", "statement": "Test information shall be appropriately selected, protected and managed."},
                ]},
                {"code": "A.8.34", "name": "Protection of information systems during audit testing", "controls": [
                    {"code": "A.8.34.1", "name": "Protection of information systems during audit testing", "statement": "Audit tests and other assurance activities involving assessment of operational systems shall be planned and agreed between the tester and appropriate management."},
                ]},
            ]
        }
    ]
    
    for domain_data in domains:
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
                order=0
            )
            db.add(objective)
            db.flush()
            
            for ctrl_data in obj_data.get("controls", []):
                control = FrameworkControl(
                    objective_id=objective.id,
                    code=ctrl_data["code"],
                    name=ctrl_data["name"],
                    statement=ctrl_data.get("statement"),
                    is_mandatory=True,
                    order=0
                )
                db.add(control)


def seed_iso_20000(db):
    """Seed ISO 20000-1:2018 IT Service Management."""
    framework = Framework(
        name="ISO/IEC 20000-1:2018",
        short_code="ISO_20000",
        regulator="International Organization for Standardization",
        jurisdiction="Global",
        version="2018",
        description="IT Service Management System",
        is_mandatory=False,
        enforcement_type="Certification"
    )
    db.add(framework)
    db.flush()
    
    domains = [
        {"code": "4", "name": "Context of the organization", "order": 1, "objectives": [
            {"code": "4.1", "name": "Understanding the organization and its context", "controls": [
                {"code": "4.1.1", "name": "Determine external and internal issues", "statement": "The organization shall determine external and internal issues relevant to its purpose."},
            ]},
            {"code": "4.2", "name": "Understanding the needs and expectations of interested parties", "controls": [
                {"code": "4.2.1", "name": "Identify interested parties", "statement": "The organization shall determine interested parties and their requirements."},
            ]},
            {"code": "4.3", "name": "Determining the scope of the SMS", "controls": [
                {"code": "4.3.1", "name": "Define SMS scope", "statement": "The organization shall determine the boundaries and applicability of the SMS."},
            ]},
            {"code": "4.4", "name": "Service management system", "controls": [
                {"code": "4.4.1", "name": "Establish SMS", "statement": "The organization shall establish, implement, maintain and continually improve an SMS."},
            ]},
        ]},
        {"code": "5", "name": "Leadership", "order": 2, "objectives": [
            {"code": "5.1", "name": "Leadership and commitment", "controls": [
                {"code": "5.1.1", "name": "Demonstrate leadership", "statement": "Top management shall demonstrate leadership and commitment to the SMS."},
            ]},
            {"code": "5.2", "name": "Policy", "controls": [
                {"code": "5.2.1", "name": "Service management policy", "statement": "Top management shall establish a service management policy."},
            ]},
            {"code": "5.3", "name": "Organizational roles, responsibilities and authorities", "controls": [
                {"code": "5.3.1", "name": "Assign roles", "statement": "Top management shall ensure responsibilities and authorities are assigned and communicated."},
            ]},
        ]},
        {"code": "6", "name": "Planning", "order": 3, "objectives": [
            {"code": "6.1", "name": "Actions to address risks and opportunities", "controls": [
                {"code": "6.1.1", "name": "Address risks and opportunities", "statement": "The organization shall determine risks and opportunities to ensure the SMS can achieve its intended outcomes."},
            ]},
            {"code": "6.2", "name": "Service management objectives and planning", "controls": [
                {"code": "6.2.1", "name": "Establish objectives", "statement": "The organization shall establish service management objectives."},
            ]},
            {"code": "6.3", "name": "Plan the service management system", "controls": [
                {"code": "6.3.1", "name": "Plan the SMS", "statement": "The organization shall plan the SMS including activities, resources, and responsibilities."},
            ]},
        ]},
        {"code": "7", "name": "Support of the SMS", "order": 4, "objectives": [
            {"code": "7.1", "name": "Resources", "controls": [
                {"code": "7.1.1", "name": "Determine resources", "statement": "The organization shall determine and provide resources needed for the SMS."},
            ]},
            {"code": "7.2", "name": "Competence", "controls": [
                {"code": "7.2.1", "name": "Personnel competence", "statement": "The organization shall determine necessary competence of personnel."},
            ]},
            {"code": "7.3", "name": "Awareness", "controls": [
                {"code": "7.3.1", "name": "Awareness", "statement": "Personnel shall be aware of the service management policy."},
            ]},
            {"code": "7.4", "name": "Communication", "controls": [
                {"code": "7.4.1", "name": "Communications", "statement": "The organization shall determine internal and external communications relevant to the SMS."},
            ]},
            {"code": "7.5", "name": "Documented information", "controls": [
                {"code": "7.5.1", "name": "Documentation", "statement": "The SMS shall include documented information required by this standard."},
            ]},
            {"code": "7.6", "name": "Knowledge", "controls": [
                {"code": "7.6.1", "name": "Knowledge management", "statement": "The organization shall determine the knowledge necessary for the SMS."},
            ]},
        ]},
        {"code": "8", "name": "Operation of the SMS", "order": 5, "objectives": [
            {"code": "8.1", "name": "Operational planning and control", "controls": [
                {"code": "8.1.1", "name": "Plan and control operations", "statement": "The organization shall plan, implement and control processes to meet requirements."},
            ]},
            {"code": "8.2", "name": "Service portfolio", "controls": [
                {"code": "8.2.1", "name": "Service portfolio management", "statement": "The organization shall determine and maintain information about services."},
            ]},
            {"code": "8.3", "name": "Relationship and agreement", "controls": [
                {"code": "8.3.1", "name": "Business relationship management", "statement": "The organization shall manage relationships with customers."},
                {"code": "8.3.2", "name": "Service level management", "statement": "The organization shall agree services to be provided with the customer."},
                {"code": "8.3.3", "name": "Supplier management", "statement": "The organization shall manage suppliers providing services."},
            ]},
            {"code": "8.4", "name": "Supply and demand", "controls": [
                {"code": "8.4.1", "name": "Budgeting and accounting for services", "statement": "The organization shall budget and account for services."},
                {"code": "8.4.2", "name": "Demand management", "statement": "The organization shall manage demand for services."},
                {"code": "8.4.3", "name": "Capacity management", "statement": "The organization shall determine and manage capacity to meet demand."},
            ]},
            {"code": "8.5", "name": "Service design, build and transition", "controls": [
                {"code": "8.5.1", "name": "Change management", "statement": "Changes shall be assessed, approved, scheduled and reviewed."},
                {"code": "8.5.2", "name": "Service design and transition", "statement": "New or changed services shall be designed and transitioned."},
                {"code": "8.5.3", "name": "Release and deployment management", "statement": "Releases shall be planned and deployed."},
            ]},
            {"code": "8.6", "name": "Resolution and fulfilment", "controls": [
                {"code": "8.6.1", "name": "Incident management", "statement": "Incidents shall be logged, prioritized, classified and resolved."},
                {"code": "8.6.2", "name": "Service request management", "statement": "Service requests shall be logged and fulfilled."},
                {"code": "8.6.3", "name": "Problem management", "statement": "Problems shall be identified, logged and managed."},
            ]},
            {"code": "8.7", "name": "Service assurance", "controls": [
                {"code": "8.7.1", "name": "Service availability management", "statement": "The organization shall determine and manage service availability."},
                {"code": "8.7.2", "name": "Service continuity management", "statement": "The organization shall manage risks to service continuity."},
                {"code": "8.7.3", "name": "Information security management", "statement": "Information security shall be managed for all services."},
            ]},
        ]},
        {"code": "9", "name": "Performance evaluation", "order": 6, "objectives": [
            {"code": "9.1", "name": "Monitoring, measurement, analysis and evaluation", "controls": [
                {"code": "9.1.1", "name": "Monitor and measure", "statement": "The organization shall determine what needs to be monitored and measured."},
            ]},
            {"code": "9.2", "name": "Internal audit", "controls": [
                {"code": "9.2.1", "name": "Internal audit", "statement": "The organization shall conduct internal audits at planned intervals."},
            ]},
            {"code": "9.3", "name": "Management review", "controls": [
                {"code": "9.3.1", "name": "Management review", "statement": "Top management shall review the SMS at planned intervals."},
            ]},
            {"code": "9.4", "name": "Service reporting", "controls": [
                {"code": "9.4.1", "name": "Service reports", "statement": "The organization shall produce service reports."},
            ]},
        ]},
        {"code": "10", "name": "Improvement", "order": 7, "objectives": [
            {"code": "10.1", "name": "Nonconformity and corrective action", "controls": [
                {"code": "10.1.1", "name": "Manage nonconformities", "statement": "The organization shall react to nonconformities and take corrective action."},
            ]},
            {"code": "10.2", "name": "Continual improvement", "controls": [
                {"code": "10.2.1", "name": "Continual improvement", "statement": "The organization shall continually improve the suitability, adequacy and effectiveness of the SMS."},
            ]},
        ]},
    ]
    
    for domain_data in domains:
        domain = FrameworkDomain(
            framework_id=framework.id,
            code=domain_data["code"],
            name=domain_data["name"],
            order=domain_data.get("order", 0)
        )
        db.add(domain)
        db.flush()
        
        for obj_data in domain_data.get("objectives", []):
            objective = ControlObjective(
                domain_id=domain.id,
                code=obj_data["code"],
                name=obj_data["name"],
                order=0
            )
            db.add(objective)
            db.flush()
            
            for ctrl_data in obj_data.get("controls", []):
                control = FrameworkControl(
                    objective_id=objective.id,
                    code=ctrl_data["code"],
                    name=ctrl_data["name"],
                    statement=ctrl_data.get("statement"),
                    is_mandatory=True,
                    order=0
                )
                db.add(control)


def seed_swift_csp(db):
    """Seed SWIFT Customer Security Programme 2024."""
    framework = Framework(
        name="SWIFT Customer Security Programme",
        short_code="SWIFT_CSF",
        regulator="SWIFT",
        jurisdiction="Global",
        version="2024",
        description="Customer Security Programme Framework",
        is_mandatory=True,
        enforcement_type="Contractual"
    )
    db.add(framework)
    db.flush()
    
    domains = [
        {"code": "1", "name": "Secure Your Environment", "order": 1, "objectives": [
            {"code": "1.1", "name": "SWIFT Environment Protection", "controls": [
                {"code": "1.1", "name": "SWIFT Environment Protection", "statement": "Ensure the protection of the user's local SWIFT infrastructure from potentially compromised elements of the general IT environment and external environment.", "is_mandatory": True},
                {"code": "1.2", "name": "Operating System Privileged Account Control", "statement": "Restrict and control the allocation and usage of administrator-level operating system accounts.", "is_mandatory": True},
                {"code": "1.3", "name": "Virtualisation Platform Protection", "statement": "Secure the virtualisation platform and virtual machines (VMs) hosting SWIFT-related components.", "is_mandatory": True},
                {"code": "1.4", "name": "Restriction of Internet Access", "statement": "Restrict access to the internet from the secure zone and from operator PCs.", "is_mandatory": True},
                {"code": "1.5", "name": "Customer Connector Protection", "statement": "Ensure protection of customer connector from potential compromise.", "is_mandatory": False},
            ]},
            {"code": "1.2", "name": "Reduce Attack Surface and Vulnerabilities", "controls": [
                {"code": "2.1", "name": "Internal Data Flow Security", "statement": "Ensure the confidentiality, integrity, and authenticity of data flows between SWIFT-related local applications.", "is_mandatory": True},
                {"code": "2.2", "name": "Security Updates", "statement": "Minimise the occurrence of known technical vulnerabilities within the local SWIFT infrastructure.", "is_mandatory": True},
                {"code": "2.3", "name": "System Hardening", "statement": "Reduce the attack surface of SWIFT-related components by performing system hardening.", "is_mandatory": True},
                {"code": "2.4", "name": "Back Office Data Flow Security", "statement": "Ensure the confidentiality, integrity, and mutual authenticity of data flows between the secure zone and the back office.", "is_mandatory": False},
                {"code": "2.5", "name": "External Transmission Data Protection", "statement": "Protect the confidentiality of SWIFT-related data exchanged with external parties.", "is_mandatory": False},
                {"code": "2.6", "name": "Operator Session Confidentiality and Integrity", "statement": "Protect the confidentiality and integrity of interactive operator sessions connecting to the local SWIFT infrastructure.", "is_mandatory": True},
                {"code": "2.7", "name": "Vulnerability Scanning", "statement": "Identify known vulnerabilities within the local SWIFT environment by implementing a vulnerability scanning process.", "is_mandatory": False},
                {"code": "2.8", "name": "Critical Activity Outsourcing", "statement": "Ensure the protection of the local SWIFT infrastructure from risks exposed through outsourcing of critical activities.", "is_mandatory": False},
                {"code": "2.9", "name": "Transaction Business Controls", "statement": "Restrict transaction activity to validated and approved counterparties through operator confirmation.", "is_mandatory": False},
            ]},
        ]},
        {"code": "2", "name": "Know and Limit Access", "order": 2, "objectives": [
            {"code": "2.1", "name": "Prevent Compromise of Credentials", "controls": [
                {"code": "3.1", "name": "Physical Security", "statement": "Prevent unauthorised physical access to sensitive equipment and environments.", "is_mandatory": True},
                {"code": "4.1", "name": "Password Policy", "statement": "Ensure passwords are sufficiently resistant against common password attacks.", "is_mandatory": True},
                {"code": "4.2", "name": "Multi-factor Authentication", "statement": "Prevent compromise of credentials from a local operator PC to protect against access to the local SWIFT infrastructure.", "is_mandatory": True},
            ]},
            {"code": "2.2", "name": "Manage Identities and Segregate Privileges", "controls": [
                {"code": "5.1", "name": "Logical Access Control", "statement": "Enforce segregation of duties and limit access to SWIFT-related applications to only authorised individuals.", "is_mandatory": True},
                {"code": "5.2", "name": "Token Management", "statement": "Ensure good management of authentication tokens.", "is_mandatory": True},
                {"code": "5.3", "name": "Personnel Vetting Process", "statement": "Ensure trustworthiness of staff operating the local SWIFT infrastructure.", "is_mandatory": False},
                {"code": "5.4", "name": "Physical and Logical Password Storage", "statement": "Protect physically and logically recorded passwords.", "is_mandatory": True},
            ]},
        ]},
        {"code": "3", "name": "Detect and Respond", "order": 3, "objectives": [
            {"code": "3.1", "name": "Detect Anomalous Activity", "controls": [
                {"code": "6.1", "name": "Malware Protection", "statement": "Ensure protection against malware on the systems hosting the local SWIFT infrastructure.", "is_mandatory": True},
                {"code": "6.2", "name": "Software Integrity", "statement": "Ensure software integrity of SWIFT-related application software.", "is_mandatory": True},
                {"code": "6.3", "name": "Database Integrity", "statement": "Ensure integrity of SWIFT-related database records.", "is_mandatory": True},
                {"code": "6.4", "name": "Logging and Monitoring", "statement": "Record security events and detect anomalous actions and operations within the local SWIFT environment.", "is_mandatory": True},
                {"code": "6.5", "name": "Intrusion Detection", "statement": "Detect and prevent anomalous network activity into and within the local SWIFT environment.", "is_mandatory": False},
            ]},
            {"code": "3.2", "name": "Plan for Incident Response and Information Sharing", "controls": [
                {"code": "7.1", "name": "Cyber Incident Response Planning", "statement": "Ensure a consistent and effective approach for managing cyber incidents.", "is_mandatory": True},
                {"code": "7.2", "name": "Security Training and Awareness", "statement": "Ensure all staff are aware of security risks and take appropriate action.", "is_mandatory": True},
                {"code": "7.3", "name": "Penetration Testing", "statement": "Validate the operational security configuration through independent penetration testing.", "is_mandatory": False},
                {"code": "7.4", "name": "Scenario-Based Risk Assessment", "statement": "Evaluate risk and readiness of the organisation based on plausible cyber attack scenarios.", "is_mandatory": False},
            ]},
        ]},
    ]
    
    for domain_data in domains:
        domain = FrameworkDomain(
            framework_id=framework.id,
            code=domain_data["code"],
            name=domain_data["name"],
            order=domain_data.get("order", 0)
        )
        db.add(domain)
        db.flush()
        
        for obj_data in domain_data.get("objectives", []):
            objective = ControlObjective(
                domain_id=domain.id,
                code=obj_data["code"],
                name=obj_data["name"],
                order=0
            )
            db.add(objective)
            db.flush()
            
            for ctrl_data in obj_data.get("controls", []):
                control = FrameworkControl(
                    objective_id=objective.id,
                    code=ctrl_data["code"],
                    name=ctrl_data["name"],
                    statement=ctrl_data.get("statement"),
                    is_mandatory=ctrl_data.get("is_mandatory", True),
                    order=0
                )
                db.add(control)


def seed_nist_csf(db):
    """Seed NIST Cybersecurity Framework 2.0."""
    framework = Framework(
        name="NIST Cybersecurity Framework",
        short_code="NIST_CSF",
        regulator="National Institute of Standards and Technology",
        jurisdiction="United States",
        version="2.0",
        description="NIST Cybersecurity Framework",
        is_mandatory=False,
        enforcement_type="Guidance"
    )
    db.add(framework)
    db.flush()
    
    domains = [
        {"code": "GV", "name": "GOVERN", "order": 1, "objectives": [
            {"code": "GV.OC", "name": "Organizational Context", "controls": [
                {"code": "GV.OC-01", "name": "Mission understood", "statement": "The organizational mission is understood and informs cybersecurity risk management."},
                {"code": "GV.OC-02", "name": "Internal stakeholders understood", "statement": "Internal stakeholders understand and support cybersecurity risk management."},
                {"code": "GV.OC-03", "name": "Legal requirements understood", "statement": "Legal, regulatory, and contractual requirements are understood and managed."},
                {"code": "GV.OC-04", "name": "Critical objectives determined", "statement": "Critical objectives, capabilities, and services are determined."},
                {"code": "GV.OC-05", "name": "Outcomes prioritized", "statement": "Outcomes, capabilities, and services are prioritized."},
            ]},
            {"code": "GV.RM", "name": "Risk Management Strategy", "controls": [
                {"code": "GV.RM-01", "name": "Risk management objectives established", "statement": "Risk management objectives are established and agreed upon."},
                {"code": "GV.RM-02", "name": "Risk appetite established", "statement": "Risk appetite and risk tolerance statements are established."},
                {"code": "GV.RM-03", "name": "Risk management strategy established", "statement": "Cybersecurity risk management activities are included in organizational strategy."},
                {"code": "GV.RM-04", "name": "Strategic direction determined", "statement": "Strategic direction for cybersecurity is communicated."},
            ]},
            {"code": "GV.RR", "name": "Roles, Responsibilities, and Authorities", "controls": [
                {"code": "GV.RR-01", "name": "Leaders accountable", "statement": "Organizational leaders are responsible and accountable for cybersecurity risk."},
                {"code": "GV.RR-02", "name": "Roles established", "statement": "Roles, responsibilities, and authorities for cybersecurity are established."},
                {"code": "GV.RR-03", "name": "Resources allocated", "statement": "Adequate resources are allocated for cybersecurity."},
                {"code": "GV.RR-04", "name": "Cybersecurity in HR", "statement": "Cybersecurity is included in human resources practices."},
            ]},
            {"code": "GV.PO", "name": "Policy", "controls": [
                {"code": "GV.PO-01", "name": "Policy established", "statement": "Cybersecurity policy is established based on organizational context."},
                {"code": "GV.PO-02", "name": "Policy communicated", "statement": "Cybersecurity policy is communicated and enforced."},
            ]},
            {"code": "GV.OV", "name": "Oversight", "controls": [
                {"code": "GV.OV-01", "name": "Strategy reviewed", "statement": "Cybersecurity risk management strategy outcomes are reviewed to inform adjustments."},
                {"code": "GV.OV-02", "name": "Strategy adjusted", "statement": "Cybersecurity risk management strategy is adjusted based on reviews."},
            ]},
            {"code": "GV.SC", "name": "Cybersecurity Supply Chain Risk Management", "controls": [
                {"code": "GV.SC-01", "name": "Supply chain risk program established", "statement": "A cybersecurity supply chain risk management program is established."},
                {"code": "GV.SC-02", "name": "Suppliers identified", "statement": "Cybersecurity roles and responsibilities for suppliers are established."},
                {"code": "GV.SC-03", "name": "Supply chain risks identified", "statement": "Cybersecurity supply chain risks are identified, prioritized, and managed."},
                {"code": "GV.SC-04", "name": "Suppliers assessed", "statement": "Suppliers are assessed based on cybersecurity risk criteria."},
                {"code": "GV.SC-05", "name": "Contracts include requirements", "statement": "Supplier agreements include cybersecurity requirements."},
            ]},
        ]},
        {"code": "ID", "name": "IDENTIFY", "order": 2, "objectives": [
            {"code": "ID.AM", "name": "Asset Management", "controls": [
                {"code": "ID.AM-01", "name": "Hardware inventoried", "statement": "Hardware assets are inventoried."},
                {"code": "ID.AM-02", "name": "Software inventoried", "statement": "Software platforms and applications are inventoried."},
                {"code": "ID.AM-03", "name": "Data mapped", "statement": "Organizational data and information are mapped."},
                {"code": "ID.AM-04", "name": "External systems catalogued", "statement": "External information systems are catalogued."},
                {"code": "ID.AM-05", "name": "Resources prioritized", "statement": "Resources are prioritized based on classification and business value."},
                {"code": "ID.AM-07", "name": "Data lifecycle managed", "statement": "The data lifecycle is managed."},
                {"code": "ID.AM-08", "name": "Systems resilience requirements", "statement": "Systems of record are identified and resilience requirements determined."},
            ]},
            {"code": "ID.RA", "name": "Risk Assessment", "controls": [
                {"code": "ID.RA-01", "name": "Vulnerabilities identified", "statement": "Vulnerabilities in assets are identified, validated, and recorded."},
                {"code": "ID.RA-02", "name": "Threat intelligence received", "statement": "Cyber threat intelligence is received from information sharing forums."},
                {"code": "ID.RA-03", "name": "Threats identified", "statement": "Internal and external threats are identified and recorded."},
                {"code": "ID.RA-04", "name": "Impacts identified", "statement": "Potential impacts and likelihoods of threats are identified."},
                {"code": "ID.RA-05", "name": "Risks determined", "statement": "Threats, vulnerabilities, likelihoods, and impacts are used to determine risk."},
                {"code": "ID.RA-06", "name": "Risk responses identified", "statement": "Risk responses are identified and prioritized."},
            ]},
            {"code": "ID.IM", "name": "Improvement", "controls": [
                {"code": "ID.IM-01", "name": "Improvements identified", "statement": "Improvements are identified from reviews and assessments."},
                {"code": "ID.IM-02", "name": "Improvements planned", "statement": "Improvements to cybersecurity practices are planned."},
                {"code": "ID.IM-03", "name": "Improvements implemented", "statement": "Improvements are implemented and evaluated."},
            ]},
        ]},
        {"code": "PR", "name": "PROTECT", "order": 3, "objectives": [
            {"code": "PR.AA", "name": "Identity Management, Authentication, and Access Control", "controls": [
                {"code": "PR.AA-01", "name": "Identities managed", "statement": "Identities and credentials are managed for authorized users, services, and hardware."},
                {"code": "PR.AA-02", "name": "Identities proofed", "statement": "Identities are proofed and bound to credentials."},
                {"code": "PR.AA-03", "name": "Access permissions managed", "statement": "Access permissions, entitlements, and authorizations are managed."},
                {"code": "PR.AA-04", "name": "Identity assertions managed", "statement": "Identity assertions are protected when transmitted."},
                {"code": "PR.AA-05", "name": "Access to physical assets managed", "statement": "Access to physical assets is managed, monitored, and enforced."},
            ]},
            {"code": "PR.AT", "name": "Awareness and Training", "controls": [
                {"code": "PR.AT-01", "name": "Training provided", "statement": "All users are informed and trained."},
                {"code": "PR.AT-02", "name": "Privileged users trained", "statement": "Individuals in privileged roles are trained."},
            ]},
            {"code": "PR.DS", "name": "Data Security", "controls": [
                {"code": "PR.DS-01", "name": "Data-at-rest protected", "statement": "Data-at-rest is protected."},
                {"code": "PR.DS-02", "name": "Data-in-transit protected", "statement": "Data-in-transit is protected."},
                {"code": "PR.DS-10", "name": "Data-in-use protected", "statement": "Data-in-use is protected."},
                {"code": "PR.DS-11", "name": "Backups maintained", "statement": "Backups of data are created, protected, maintained, and tested."},
            ]},
            {"code": "PR.PS", "name": "Platform Security", "controls": [
                {"code": "PR.PS-01", "name": "Configurations managed", "statement": "Configuration management practices are established."},
                {"code": "PR.PS-02", "name": "Software maintained", "statement": "Software is maintained, replaced, and removed."},
                {"code": "PR.PS-03", "name": "Hardware maintained", "statement": "Hardware is maintained, replaced, and removed."},
                {"code": "PR.PS-04", "name": "Log records generated", "statement": "Log records are generated and made available."},
                {"code": "PR.PS-05", "name": "Installation and execution managed", "statement": "Installation and execution of unauthorized software is prevented."},
                {"code": "PR.PS-06", "name": "Secure development practiced", "statement": "Secure software development practices are employed."},
            ]},
            {"code": "PR.IR", "name": "Technology Infrastructure Resilience", "controls": [
                {"code": "PR.IR-01", "name": "Networks protected", "statement": "Networks and environments are protected."},
                {"code": "PR.IR-02", "name": "Architecture reflects strategy", "statement": "Technology infrastructure resilience meets organizational strategy."},
                {"code": "PR.IR-03", "name": "Mechanisms operating", "statement": "Technology infrastructure resilience mechanisms are operating as intended."},
            ]},
        ]},
        {"code": "DE", "name": "DETECT", "order": 4, "objectives": [
            {"code": "DE.CM", "name": "Continuous Monitoring", "controls": [
                {"code": "DE.CM-01", "name": "Networks monitored", "statement": "Networks and network services are monitored for adverse events."},
                {"code": "DE.CM-02", "name": "Environment monitored", "statement": "The physical environment is monitored for adverse events."},
                {"code": "DE.CM-03", "name": "Personnel activity monitored", "statement": "Personnel activity is monitored."},
                {"code": "DE.CM-06", "name": "Service providers monitored", "statement": "External service provider activity is monitored."},
                {"code": "DE.CM-09", "name": "Hardware/software monitored", "statement": "Computing hardware and software are monitored for integrity."},
            ]},
            {"code": "DE.AE", "name": "Adverse Event Analysis", "controls": [
                {"code": "DE.AE-02", "name": "Events analyzed", "statement": "Potentially adverse events are analyzed to understand attack methods."},
                {"code": "DE.AE-03", "name": "Information correlated", "statement": "Information is correlated from multiple sources."},
                {"code": "DE.AE-04", "name": "Impact estimated", "statement": "Estimated impact and scope of adverse events are understood."},
                {"code": "DE.AE-06", "name": "Anomalies declared incidents", "statement": "Information on adverse events is provided to authorized parties."},
                {"code": "DE.AE-07", "name": "Threat intelligence integrated", "statement": "Cyber threat intelligence and vulnerability information are integrated."},
            ]},
        ]},
        {"code": "RS", "name": "RESPOND", "order": 5, "objectives": [
            {"code": "RS.MA", "name": "Incident Management", "controls": [
                {"code": "RS.MA-01", "name": "Response plan executed", "statement": "The incident response plan is executed."},
                {"code": "RS.MA-02", "name": "Reports triaged", "statement": "Incident reports are triaged and validated."},
                {"code": "RS.MA-03", "name": "Incidents categorized", "statement": "Incidents are categorized and prioritized."},
                {"code": "RS.MA-04", "name": "Incidents escalated", "statement": "Incidents are escalated or elevated as needed."},
            ]},
            {"code": "RS.AN", "name": "Incident Analysis", "controls": [
                {"code": "RS.AN-03", "name": "Analysis performed", "statement": "Analysis is performed to establish root cause."},
                {"code": "RS.AN-06", "name": "Actions recorded", "statement": "Actions performed during incident response are recorded."},
                {"code": "RS.AN-07", "name": "Artifact collected", "statement": "Incident data and artifacts are collected and preserved."},
            ]},
            {"code": "RS.CO", "name": "Incident Response Reporting and Communication", "controls": [
                {"code": "RS.CO-02", "name": "Stakeholders notified", "statement": "Internal and external stakeholders are notified."},
                {"code": "RS.CO-03", "name": "Information shared", "statement": "Information is shared with designated parties."},
            ]},
            {"code": "RS.MI", "name": "Incident Mitigation", "controls": [
                {"code": "RS.MI-01", "name": "Incidents contained", "statement": "Incidents are contained."},
                {"code": "RS.MI-02", "name": "Incidents eradicated", "statement": "Incidents are eradicated."},
            ]},
        ]},
        {"code": "RC", "name": "RECOVER", "order": 6, "objectives": [
            {"code": "RC.RP", "name": "Incident Recovery Plan Execution", "controls": [
                {"code": "RC.RP-01", "name": "Recovery plan executed", "statement": "The recovery plan is executed."},
                {"code": "RC.RP-02", "name": "Recovery verified", "statement": "Recovery actions are verified."},
                {"code": "RC.RP-03", "name": "Backups verified", "statement": "The integrity of backups is verified before use."},
                {"code": "RC.RP-04", "name": "Critical functions restored", "statement": "Critical mission functions are prioritized and restored."},
                {"code": "RC.RP-05", "name": "Data integrity restored", "statement": "The integrity of affected data is verified."},
            ]},
            {"code": "RC.CO", "name": "Incident Recovery Communication", "controls": [
                {"code": "RC.CO-03", "name": "Stakeholders informed", "statement": "Recovery activities and progress are communicated to stakeholders."},
                {"code": "RC.CO-04", "name": "Public updates", "statement": "Public updates are shared about incident and recovery."},
            ]},
        ]},
    ]
    
    for domain_data in domains:
        domain = FrameworkDomain(
            framework_id=framework.id,
            code=domain_data["code"],
            name=domain_data["name"],
            order=domain_data.get("order", 0)
        )
        db.add(domain)
        db.flush()
        
        for obj_data in domain_data.get("objectives", []):
            objective = ControlObjective(
                domain_id=domain.id,
                code=obj_data["code"],
                name=obj_data["name"],
                order=0
            )
            db.add(objective)
            db.flush()
            
            for ctrl_data in obj_data.get("controls", []):
                control = FrameworkControl(
                    objective_id=objective.id,
                    code=ctrl_data["code"],
                    name=ctrl_data["name"],
                    statement=ctrl_data.get("statement"),
                    is_mandatory=True,
                    order=0
                )
                db.add(control)


def seed_cbb(db):
    """Seed CBB 2023 Cyber Security Framework."""
    framework = Framework(
        name="CBB Cyber Security Framework",
        short_code="CBB",
        regulator="Central Bank of Bahrain",
        jurisdiction="Bahrain",
        version="2023",
        description="Central Bank of Bahrain Cyber Security Framework",
        is_mandatory=True,
        enforcement_type="Regulatory"
    )
    db.add(framework)
    db.flush()
    
    domains = [
        {"code": "CS-1", "name": "Cybersecurity Governance", "order": 1, "objectives": [
            {"code": "CS-1.1", "name": "Governance Framework", "controls": [
                {"code": "CS-1.1.1", "name": "Board oversight", "statement": "The Board shall approve the cybersecurity strategy and provide oversight."},
                {"code": "CS-1.1.2", "name": "CISO appointment", "statement": "A qualified CISO shall be appointed with defined responsibilities."},
                {"code": "CS-1.1.3", "name": "Security policies", "statement": "Cybersecurity policies shall be established and approved by management."},
                {"code": "CS-1.1.4", "name": "Risk appetite", "statement": "Cyber risk appetite shall be defined and communicated."},
            ]},
        ]},
        {"code": "CS-2", "name": "Risk Management", "order": 2, "objectives": [
            {"code": "CS-2.1", "name": "Risk Assessment", "controls": [
                {"code": "CS-2.1.1", "name": "Risk assessment", "statement": "Regular cybersecurity risk assessments shall be conducted."},
                {"code": "CS-2.1.2", "name": "Threat intelligence", "statement": "Threat intelligence shall be gathered and analyzed."},
                {"code": "CS-2.1.3", "name": "Risk treatment", "statement": "Risk treatment plans shall be developed and implemented."},
            ]},
        ]},
        {"code": "CS-3", "name": "Asset Management", "order": 3, "objectives": [
            {"code": "CS-3.1", "name": "Asset Inventory", "controls": [
                {"code": "CS-3.1.1", "name": "Asset inventory", "statement": "A comprehensive IT asset inventory shall be maintained."},
                {"code": "CS-3.1.2", "name": "Asset classification", "statement": "Assets shall be classified based on criticality."},
                {"code": "CS-3.1.3", "name": "Data classification", "statement": "Data shall be classified and labeled appropriately."},
            ]},
        ]},
        {"code": "CS-4", "name": "Access Control", "order": 4, "objectives": [
            {"code": "CS-4.1", "name": "Identity and Access Management", "controls": [
                {"code": "CS-4.1.1", "name": "Access control policy", "statement": "An access control policy shall be established."},
                {"code": "CS-4.1.2", "name": "User access management", "statement": "User access shall be managed through the lifecycle."},
                {"code": "CS-4.1.3", "name": "Privileged access", "statement": "Privileged access shall be restricted and monitored."},
                {"code": "CS-4.1.4", "name": "Multi-factor authentication", "statement": "MFA shall be implemented for critical systems."},
            ]},
        ]},
        {"code": "CS-5", "name": "Security Operations", "order": 5, "objectives": [
            {"code": "CS-5.1", "name": "Security Monitoring", "controls": [
                {"code": "CS-5.1.1", "name": "Security monitoring", "statement": "Continuous security monitoring shall be implemented."},
                {"code": "CS-5.1.2", "name": "Vulnerability management", "statement": "A vulnerability management program shall be established."},
                {"code": "CS-5.1.3", "name": "Patch management", "statement": "Timely patching of systems shall be performed."},
                {"code": "CS-5.1.4", "name": "Malware protection", "statement": "Malware protection shall be deployed on all endpoints."},
            ]},
        ]},
        {"code": "CS-6", "name": "Incident Response", "order": 6, "objectives": [
            {"code": "CS-6.1", "name": "Incident Management", "controls": [
                {"code": "CS-6.1.1", "name": "Incident response plan", "statement": "An incident response plan shall be established."},
                {"code": "CS-6.1.2", "name": "Incident detection", "statement": "Incident detection capabilities shall be implemented."},
                {"code": "CS-6.1.3", "name": "Incident reporting", "statement": "Cyber incidents shall be reported to the CBB."},
                {"code": "CS-6.1.4", "name": "Incident response testing", "statement": "Incident response plans shall be tested regularly."},
            ]},
        ]},
    ]
    
    for domain_data in domains:
        domain = FrameworkDomain(
            framework_id=framework.id,
            code=domain_data["code"],
            name=domain_data["name"],
            order=domain_data.get("order", 0)
        )
        db.add(domain)
        db.flush()
        
        for obj_data in domain_data.get("objectives", []):
            objective = ControlObjective(
                domain_id=domain.id,
                code=obj_data["code"],
                name=obj_data["name"],
                order=0
            )
            db.add(objective)
            db.flush()
            
            for ctrl_data in obj_data.get("controls", []):
                control = FrameworkControl(
                    objective_id=objective.id,
                    code=ctrl_data["code"],
                    name=ctrl_data["name"],
                    statement=ctrl_data.get("statement"),
                    is_mandatory=True,
                    order=0
                )
                db.add(control)


def seed_sama(db):
    """Seed SAMA Cybersecurity Framework."""
    framework = Framework(
        name="SAMA Cybersecurity Framework",
        short_code="SAMA",
        regulator="Saudi Arabian Monetary Authority",
        jurisdiction="Saudi Arabia",
        version="1.0",
        description="SAMA Cybersecurity Framework for Financial Institutions",
        is_mandatory=True,
        enforcement_type="Regulatory"
    )
    db.add(framework)
    db.flush()
    
    domains = [
        {"code": "1", "name": "Cybersecurity Leadership and Governance", "order": 1, "objectives": [
            {"code": "1.1", "name": "Strategy and Framework", "controls": [
                {"code": "1.1.1", "name": "Cybersecurity strategy", "statement": "A cybersecurity strategy aligned with business objectives shall be established."},
                {"code": "1.1.2", "name": "Governance framework", "statement": "A cybersecurity governance framework shall be established."},
                {"code": "1.1.3", "name": "Board oversight", "statement": "The Board shall provide oversight of cybersecurity."},
            ]},
            {"code": "1.2", "name": "Organization Structure", "controls": [
                {"code": "1.2.1", "name": "CISO role", "statement": "A CISO shall be appointed with appropriate authority."},
                {"code": "1.2.2", "name": "Security team", "statement": "An adequate cybersecurity team shall be established."},
                {"code": "1.2.3", "name": "Roles and responsibilities", "statement": "Cybersecurity roles and responsibilities shall be defined."},
            ]},
        ]},
        {"code": "2", "name": "Cybersecurity Risk Management and Compliance", "order": 2, "objectives": [
            {"code": "2.1", "name": "Risk Management", "controls": [
                {"code": "2.1.1", "name": "Risk assessment", "statement": "Regular cybersecurity risk assessments shall be conducted."},
                {"code": "2.1.2", "name": "Risk treatment", "statement": "Risk treatment plans shall be developed."},
                {"code": "2.1.3", "name": "Risk monitoring", "statement": "Cybersecurity risks shall be continuously monitored."},
            ]},
            {"code": "2.2", "name": "Regulatory Compliance", "controls": [
                {"code": "2.2.1", "name": "Compliance program", "statement": "A compliance program shall be established."},
                {"code": "2.2.2", "name": "Regulatory reporting", "statement": "Regulatory reporting requirements shall be met."},
            ]},
        ]},
        {"code": "3", "name": "Cybersecurity Operations and Technology", "order": 3, "objectives": [
            {"code": "3.1", "name": "Asset Management", "controls": [
                {"code": "3.1.1", "name": "Asset inventory", "statement": "IT assets shall be inventoried and managed."},
                {"code": "3.1.2", "name": "Asset classification", "statement": "Assets shall be classified by criticality."},
            ]},
            {"code": "3.2", "name": "Access Control", "controls": [
                {"code": "3.2.1", "name": "Access management", "statement": "Access to systems shall be controlled."},
                {"code": "3.2.2", "name": "Privileged access", "statement": "Privileged access shall be restricted."},
                {"code": "3.2.3", "name": "Authentication", "statement": "Strong authentication shall be implemented."},
            ]},
            {"code": "3.3", "name": "Application Security", "controls": [
                {"code": "3.3.1", "name": "Secure development", "statement": "Applications shall be developed securely."},
                {"code": "3.3.2", "name": "Application testing", "statement": "Applications shall be tested for security."},
            ]},
            {"code": "3.4", "name": "Data Protection", "controls": [
                {"code": "3.4.1", "name": "Data classification", "statement": "Data shall be classified and protected."},
                {"code": "3.4.2", "name": "Encryption", "statement": "Sensitive data shall be encrypted."},
            ]},
            {"code": "3.5", "name": "Network Security", "controls": [
                {"code": "3.5.1", "name": "Network segmentation", "statement": "Networks shall be segmented."},
                {"code": "3.5.2", "name": "Perimeter security", "statement": "Network perimeters shall be protected."},
            ]},
        ]},
        {"code": "4", "name": "Third Party Cybersecurity", "order": 4, "objectives": [
            {"code": "4.1", "name": "Third Party Risk Management", "controls": [
                {"code": "4.1.1", "name": "Third party assessment", "statement": "Third parties shall be assessed for cybersecurity."},
                {"code": "4.1.2", "name": "Contractual requirements", "statement": "Contracts shall include cybersecurity requirements."},
                {"code": "4.1.3", "name": "Third party monitoring", "statement": "Third party cybersecurity shall be monitored."},
            ]},
        ]},
    ]
    
    for domain_data in domains:
        domain = FrameworkDomain(
            framework_id=framework.id,
            code=domain_data["code"],
            name=domain_data["name"],
            order=domain_data.get("order", 0)
        )
        db.add(domain)
        db.flush()
        
        for obj_data in domain_data.get("objectives", []):
            objective = ControlObjective(
                domain_id=domain.id,
                code=obj_data["code"],
                name=obj_data["name"],
                order=0
            )
            db.add(objective)
            db.flush()
            
            for ctrl_data in obj_data.get("controls", []):
                control = FrameworkControl(
                    objective_id=objective.id,
                    code=ctrl_data["code"],
                    name=ctrl_data["name"],
                    statement=ctrl_data.get("statement"),
                    is_mandatory=True,
                    order=0
                )
                db.add(control)


def seed_sbp(db):
    """Seed SBP IT/IS Guidelines."""
    framework = Framework(
        name="SBP IT/IS Risk Guidelines",
        short_code="SBP",
        regulator="State Bank of Pakistan",
        jurisdiction="Pakistan",
        version="2023",
        description="IT/IS Risk Guidelines for Financial Institutions",
        is_mandatory=True,
        enforcement_type="Regulatory"
    )
    db.add(framework)
    db.flush()
    
    domains = [
        {"code": "1", "name": "IT Governance", "order": 1, "objectives": [
            {"code": "1.1", "name": "Governance Structure", "controls": [
                {"code": "1.1.1", "name": "IT governance framework", "statement": "An IT governance framework shall be established."},
                {"code": "1.1.2", "name": "IT strategy", "statement": "An IT strategy aligned with business shall be developed."},
                {"code": "1.1.3", "name": "IT policies", "statement": "IT policies and procedures shall be documented."},
            ]},
        ]},
        {"code": "2", "name": "Information Security", "order": 2, "objectives": [
            {"code": "2.1", "name": "Security Management", "controls": [
                {"code": "2.1.1", "name": "Security policy", "statement": "An information security policy shall be established."},
                {"code": "2.1.2", "name": "Security organization", "statement": "An information security organization shall be established."},
                {"code": "2.1.3", "name": "Security awareness", "statement": "Security awareness training shall be provided."},
            ]},
            {"code": "2.2", "name": "Access Control", "controls": [
                {"code": "2.2.1", "name": "User management", "statement": "User access shall be managed throughout the lifecycle."},
                {"code": "2.2.2", "name": "Authentication", "statement": "Strong authentication shall be implemented."},
                {"code": "2.2.3", "name": "Authorization", "statement": "Access shall be granted based on need-to-know."},
            ]},
        ]},
        {"code": "3", "name": "IT Operations", "order": 3, "objectives": [
            {"code": "3.1", "name": "Operations Management", "controls": [
                {"code": "3.1.1", "name": "Change management", "statement": "A change management process shall be established."},
                {"code": "3.1.2", "name": "Incident management", "statement": "An incident management process shall be established."},
                {"code": "3.1.3", "name": "Problem management", "statement": "A problem management process shall be established."},
            ]},
            {"code": "3.2", "name": "Backup and Recovery", "controls": [
                {"code": "3.2.1", "name": "Backup procedures", "statement": "Backup procedures shall be established."},
                {"code": "3.2.2", "name": "Recovery testing", "statement": "Recovery procedures shall be tested regularly."},
            ]},
        ]},
        {"code": "4", "name": "Business Continuity", "order": 4, "objectives": [
            {"code": "4.1", "name": "BCM Framework", "controls": [
                {"code": "4.1.1", "name": "BCP development", "statement": "Business continuity plans shall be developed."},
                {"code": "4.1.2", "name": "BCP testing", "statement": "Business continuity plans shall be tested regularly."},
                {"code": "4.1.3", "name": "Disaster recovery", "statement": "Disaster recovery capabilities shall be established."},
            ]},
        ]},
        {"code": "5", "name": "Outsourcing", "order": 5, "objectives": [
            {"code": "5.1", "name": "Outsourcing Management", "controls": [
                {"code": "5.1.1", "name": "Outsourcing policy", "statement": "An IT outsourcing policy shall be established."},
                {"code": "5.1.2", "name": "Vendor assessment", "statement": "Vendors shall be assessed before engagement."},
                {"code": "5.1.3", "name": "Vendor monitoring", "statement": "Vendor performance shall be monitored."},
            ]},
        ]},
    ]
    
    for domain_data in domains:
        domain = FrameworkDomain(
            framework_id=framework.id,
            code=domain_data["code"],
            name=domain_data["name"],
            order=domain_data.get("order", 0)
        )
        db.add(domain)
        db.flush()
        
        for obj_data in domain_data.get("objectives", []):
            objective = ControlObjective(
                domain_id=domain.id,
                code=obj_data["code"],
                name=obj_data["name"],
                order=0
            )
            db.add(objective)
            db.flush()
            
            for ctrl_data in obj_data.get("controls", []):
                control = FrameworkControl(
                    objective_id=objective.id,
                    code=ctrl_data["code"],
                    name=ctrl_data["name"],
                    statement=ctrl_data.get("statement"),
                    is_mandatory=True,
                    order=0
                )
                db.add(control)


if __name__ == "__main__":
    reseed_frameworks()
