from .models import SessionLocal, CertificationPhase, Framework

CERTIFICATION_PHASES = {
    "PCI_DSS": [
        {
            "phase_number": 1,
            "name": "Scope Definition",
            "description": "Define the cardholder data environment (CDE) scope and boundaries",
            "key_tasks": [
                "Identify all systems that store, process, or transmit cardholder data",
                "Map data flows for cardholder data",
                "Document network segmentation",
                "Identify connected systems and third parties"
            ],
            "deliverables": [
                "CDE scope document",
                "Network diagram",
                "Data flow diagram",
                "Asset inventory"
            ]
        },
        {
            "phase_number": 2,
            "name": "Gap Assessment",
            "description": "Compare current security state against PCI DSS requirements",
            "key_tasks": [
                "Assess current controls against all PCI DSS requirements",
                "Document compliance gaps",
                "Identify missing or weak controls",
                "Review previous assessment findings"
            ],
            "deliverables": [
                "Gap analysis report",
                "Current compliance status",
                "Risk prioritization matrix"
            ]
        },
        {
            "phase_number": 3,
            "name": "Remediation Planning",
            "description": "Create prioritized roadmap to address identified gaps",
            "key_tasks": [
                "Prioritize gaps based on risk and effort",
                "Develop remediation timelines",
                "Allocate resources and budget",
                "Define milestones and checkpoints"
            ],
            "deliverables": [
                "Remediation roadmap",
                "Project plan with timelines",
                "Resource allocation plan",
                "Budget estimates"
            ]
        },
        {
            "phase_number": 4,
            "name": "Implementation",
            "description": "Implement controls and fix identified gaps",
            "key_tasks": [
                "Deploy required security controls",
                "Update policies and procedures",
                "Configure systems per PCI requirements",
                "Implement encryption and access controls"
            ],
            "deliverables": [
                "Updated security policies",
                "Control implementation evidence",
                "Configuration documentation",
                "Change management records"
            ]
        },
        {
            "phase_number": 5,
            "name": "Validation Testing",
            "description": "Perform required security testing and scans",
            "key_tasks": [
                "Conduct quarterly ASV vulnerability scans",
                "Perform annual penetration testing",
                "Execute internal vulnerability scans",
                "Test segmentation controls"
            ],
            "deliverables": [
                "ASV scan reports (passing)",
                "Penetration test report",
                "Vulnerability scan results",
                "Segmentation test results"
            ]
        },
        {
            "phase_number": 6,
            "name": "SAQ/ROC Documentation",
            "description": "Complete Self-Assessment Questionnaire or Report on Compliance",
            "key_tasks": [
                "Determine appropriate SAQ type or ROC requirement",
                "Document all control implementations",
                "Gather supporting evidence",
                "Complete all required sections"
            ],
            "deliverables": [
                "Completed SAQ or ROC",
                "Supporting evidence package",
                "Control documentation",
                "Interview records"
            ]
        },
        {
            "phase_number": 7,
            "name": "Attestation of Compliance",
            "description": "Submit final AOC and achieve certification",
            "key_tasks": [
                "Review final documentation with QSA (if applicable)",
                "Sign Attestation of Compliance",
                "Submit to payment brands/acquirer",
                "Establish ongoing compliance program"
            ],
            "deliverables": [
                "Signed AOC",
                "Final compliance package",
                "Ongoing compliance calendar",
                "Monitoring procedures"
            ]
        }
    ],
    "ISO_27001": [
        {
            "phase_number": 1,
            "name": "ISMS Scoping",
            "description": "Define scope and boundaries of the Information Security Management System",
            "key_tasks": [
                "Define ISMS scope and boundaries",
                "Identify information assets in scope",
                "Document organizational context",
                "Determine interested parties and requirements"
            ],
            "deliverables": [
                "ISMS scope statement",
                "Context of organization document",
                "Interested parties register",
                "Scope exclusion justifications"
            ]
        },
        {
            "phase_number": 2,
            "name": "Context of Organization",
            "description": "Understand internal and external context affecting information security",
            "key_tasks": [
                "Analyze internal factors (culture, structure, capabilities)",
                "Analyze external factors (legal, regulatory, market)",
                "Identify interested party requirements",
                "Document organizational context"
            ],
            "deliverables": [
                "Internal/external issues register",
                "Interested parties requirements",
                "Legal and regulatory register",
                "Strategic context analysis"
            ]
        },
        {
            "phase_number": 3,
            "name": "Risk Assessment & Treatment",
            "description": "Identify, assess, and treat information security risks",
            "key_tasks": [
                "Establish risk assessment methodology",
                "Identify information security risks",
                "Analyze and evaluate risks",
                "Develop risk treatment plan"
            ],
            "deliverables": [
                "Risk assessment methodology",
                "Risk register",
                "Risk treatment plan",
                "Residual risk acceptance"
            ]
        },
        {
            "phase_number": 4,
            "name": "Statement of Applicability",
            "description": "Define applicable controls from Annex A",
            "key_tasks": [
                "Review all Annex A controls",
                "Determine control applicability",
                "Justify exclusions",
                "Map controls to risk treatment"
            ],
            "deliverables": [
                "Statement of Applicability (SoA)",
                "Control justification documentation",
                "Control mapping to risks",
                "Implementation status tracker"
            ]
        },
        {
            "phase_number": 5,
            "name": "Control Implementation",
            "description": "Implement required Annex A controls",
            "key_tasks": [
                "Implement technical controls",
                "Develop policies and procedures",
                "Deploy physical security measures",
                "Establish operational processes"
            ],
            "deliverables": [
                "Implemented controls evidence",
                "Information security policies",
                "Operational procedures",
                "Technical configuration records"
            ]
        },
        {
            "phase_number": 6,
            "name": "Training & Awareness",
            "description": "Train staff on ISMS requirements and security awareness",
            "key_tasks": [
                "Develop security awareness program",
                "Conduct role-based training",
                "Train ISMS team on procedures",
                "Establish ongoing awareness activities"
            ],
            "deliverables": [
                "Training program documentation",
                "Training records",
                "Awareness materials",
                "Competence records"
            ]
        },
        {
            "phase_number": 7,
            "name": "Internal Audit",
            "description": "Conduct internal audit of the ISMS",
            "key_tasks": [
                "Plan internal audit program",
                "Conduct ISMS internal audit",
                "Document findings and nonconformities",
                "Track corrective actions"
            ],
            "deliverables": [
                "Internal audit plan",
                "Audit reports",
                "Nonconformity reports",
                "Corrective action records"
            ]
        },
        {
            "phase_number": 8,
            "name": "Management Review",
            "description": "Conduct management review of ISMS effectiveness",
            "key_tasks": [
                "Prepare management review inputs",
                "Present ISMS performance metrics",
                "Review audit results and incidents",
                "Document decisions and actions"
            ],
            "deliverables": [
                "Management review agenda",
                "Management review minutes",
                "Decision records",
                "Resource allocation decisions"
            ]
        },
        {
            "phase_number": 9,
            "name": "Certification Audit",
            "description": "Complete Stage 1 and Stage 2 external certification audits",
            "key_tasks": [
                "Prepare for Stage 1 documentation review",
                "Address Stage 1 findings",
                "Complete Stage 2 implementation audit",
                "Resolve any nonconformities"
            ],
            "deliverables": [
                "Stage 1 audit report",
                "Stage 2 audit report",
                "Corrective action closure",
                "ISO 27001 certificate"
            ]
        }
    ],
    "NIST_CSF": [
        {
            "phase_number": 1,
            "name": "Prioritize and Scope",
            "description": "Identify business objectives and organizational priorities",
            "key_tasks": [
                "Identify business/mission objectives",
                "Determine cybersecurity priorities",
                "Define scope of assessment",
                "Identify key stakeholders"
            ],
            "deliverables": [
                "Business objectives documentation",
                "Scope statement",
                "Stakeholder register",
                "Priority matrix"
            ]
        },
        {
            "phase_number": 2,
            "name": "Orient",
            "description": "Understand systems, assets, and data within scope",
            "key_tasks": [
                "Identify critical systems and assets",
                "Map data flows and dependencies",
                "Identify regulatory requirements",
                "Document risk tolerance"
            ],
            "deliverables": [
                "Asset inventory",
                "System dependency map",
                "Regulatory requirements list",
                "Risk tolerance statement"
            ]
        },
        {
            "phase_number": 3,
            "name": "Create Current Profile",
            "description": "Document current cybersecurity state using CSF categories",
            "key_tasks": [
                "Assess current practices against CSF",
                "Document current implementation tiers",
                "Identify existing controls",
                "Rate current capabilities"
            ],
            "deliverables": [
                "Current state profile",
                "Implementation tier assessment",
                "Control inventory",
                "Capability ratings"
            ]
        },
        {
            "phase_number": 4,
            "name": "Conduct Risk Assessment",
            "description": "Identify and analyze cybersecurity risks",
            "key_tasks": [
                "Identify threats and vulnerabilities",
                "Assess likelihood and impact",
                "Determine risk levels",
                "Prioritize risks"
            ],
            "deliverables": [
                "Threat assessment",
                "Vulnerability analysis",
                "Risk register",
                "Risk prioritization"
            ]
        },
        {
            "phase_number": 5,
            "name": "Create Target Profile",
            "description": "Define desired cybersecurity outcomes and target state",
            "key_tasks": [
                "Define target outcomes for each CSF category",
                "Set target implementation tiers",
                "Align with business objectives",
                "Document target capabilities"
            ],
            "deliverables": [
                "Target state profile",
                "Target tier definitions",
                "Outcome objectives",
                "Success metrics"
            ]
        },
        {
            "phase_number": 6,
            "name": "Gap Analysis",
            "description": "Determine gaps between current and target profiles",
            "key_tasks": [
                "Compare current vs target profiles",
                "Identify capability gaps",
                "Prioritize gaps based on risk",
                "Estimate remediation effort"
            ],
            "deliverables": [
                "Gap analysis report",
                "Prioritized gap list",
                "Effort estimates",
                "Quick wins identification"
            ]
        },
        {
            "phase_number": 7,
            "name": "Implement Action Plan",
            "description": "Prioritize and implement improvements to close gaps",
            "key_tasks": [
                "Develop action plan with priorities",
                "Implement improvements",
                "Monitor progress",
                "Measure effectiveness"
            ],
            "deliverables": [
                "Action plan",
                "Implementation evidence",
                "Progress reports",
                "Effectiveness metrics"
            ]
        }
    ],
    "SWIFT_CSF": [
        {
            "phase_number": 1,
            "name": "Assessment Scope",
            "description": "Define SWIFT infrastructure scope and architecture type",
            "key_tasks": [
                "Identify SWIFT architecture type (A1, A2, A3, B)",
                "Document SWIFT infrastructure components",
                "Map data flows and connections",
                "Identify secure zone boundaries"
            ],
            "deliverables": [
                "Architecture type declaration",
                "Infrastructure diagram",
                "Secure zone documentation",
                "Component inventory"
            ]
        },
        {
            "phase_number": 2,
            "name": "Mandatory Controls",
            "description": "Implement all mandatory CSCF security controls",
            "key_tasks": [
                "Assess current state against mandatory controls",
                "Implement required security controls",
                "Document control implementation",
                "Gather compliance evidence"
            ],
            "deliverables": [
                "Mandatory control checklist",
                "Implementation evidence",
                "Configuration documentation",
                "Control testing results"
            ]
        },
        {
            "phase_number": 3,
            "name": "Advisory Controls",
            "description": "Assess and implement advisory controls as appropriate",
            "key_tasks": [
                "Review advisory control requirements",
                "Assess applicability and risk",
                "Implement selected advisory controls",
                "Document decisions and rationale"
            ],
            "deliverables": [
                "Advisory control assessment",
                "Implementation decisions",
                "Additional control evidence",
                "Risk acceptance documentation"
            ]
        },
        {
            "phase_number": 4,
            "name": "Independent Assessment",
            "description": "Conduct independent security assessment of SWIFT environment",
            "key_tasks": [
                "Engage qualified assessor",
                "Complete assessment against CSCF",
                "Address assessment findings",
                "Obtain assessment report"
            ],
            "deliverables": [
                "Independent assessment report",
                "Finding remediation evidence",
                "Assessor credentials",
                "Assessment methodology"
            ]
        },
        {
            "phase_number": 5,
            "name": "KYC-SA Attestation",
            "description": "Complete attestation in KYC Security Attestation application",
            "key_tasks": [
                "Complete self-attestation in KYC-SA",
                "Upload required evidence",
                "Submit attestation by deadline",
                "Share attestation with counterparties"
            ],
            "deliverables": [
                "Completed KYC-SA attestation",
                "Uploaded evidence package",
                "Submission confirmation",
                "Counterparty sharing records"
            ]
        }
    ],
    "ISO_20000": [
        {
            "phase_number": 1,
            "name": "SMS Scoping",
            "description": "Define Service Management System scope and boundaries",
            "key_tasks": [
                "Define SMS scope and boundaries",
                "Identify services in scope",
                "Document organizational context",
                "Determine interested parties"
            ],
            "deliverables": [
                "SMS scope statement",
                "Service scope definition",
                "Context documentation",
                "Interested parties register"
            ]
        },
        {
            "phase_number": 2,
            "name": "Service Catalogue",
            "description": "Document services and service level agreements",
            "key_tasks": [
                "Document all services in scope",
                "Define service levels and SLAs",
                "Establish service descriptions",
                "Create service catalogue"
            ],
            "deliverables": [
                "Service catalogue",
                "Service level agreements",
                "Service descriptions",
                "OLA documentation"
            ]
        },
        {
            "phase_number": 3,
            "name": "Process Implementation",
            "description": "Implement ITIL-aligned service management processes",
            "key_tasks": [
                "Implement incident management",
                "Establish change management",
                "Deploy problem management",
                "Implement service request management"
            ],
            "deliverables": [
                "Process documentation",
                "RACI matrices",
                "Process workflows",
                "Tool configurations"
            ]
        },
        {
            "phase_number": 4,
            "name": "Resource Planning",
            "description": "Plan resources and competencies for service delivery",
            "key_tasks": [
                "Identify resource requirements",
                "Define competency needs",
                "Plan capacity and availability",
                "Establish training programs"
            ],
            "deliverables": [
                "Resource plan",
                "Competency matrix",
                "Capacity plan",
                "Training records"
            ]
        },
        {
            "phase_number": 5,
            "name": "Operational Controls",
            "description": "Implement service delivery and operational controls",
            "key_tasks": [
                "Implement service delivery procedures",
                "Establish monitoring and measurement",
                "Deploy service continuity",
                "Implement information security controls"
            ],
            "deliverables": [
                "Operational procedures",
                "Monitoring dashboards",
                "Continuity plans",
                "Security controls documentation"
            ]
        },
        {
            "phase_number": 6,
            "name": "Performance Measurement",
            "description": "Define and implement KPIs and metrics",
            "key_tasks": [
                "Define service KPIs",
                "Implement measurement systems",
                "Establish reporting procedures",
                "Create management dashboards"
            ],
            "deliverables": [
                "KPI definitions",
                "Measurement procedures",
                "Performance reports",
                "Management dashboards"
            ]
        },
        {
            "phase_number": 7,
            "name": "Internal Audit",
            "description": "Conduct internal SMS audit",
            "key_tasks": [
                "Plan internal audit program",
                "Conduct SMS internal audit",
                "Document findings",
                "Track corrective actions"
            ],
            "deliverables": [
                "Internal audit plan",
                "Audit reports",
                "Nonconformity reports",
                "Corrective action records"
            ]
        },
        {
            "phase_number": 8,
            "name": "Certification Audit",
            "description": "Complete external certification audit",
            "key_tasks": [
                "Prepare for certification audit",
                "Complete Stage 1 and Stage 2 audits",
                "Address audit findings",
                "Achieve certification"
            ],
            "deliverables": [
                "Audit preparation checklist",
                "Audit reports",
                "Corrective action closure",
                "ISO 20000-1 certificate"
            ]
        }
    ],
    "CBB": [
        {
            "phase_number": 1,
            "name": "Regulatory Gap Assessment",
            "description": "Compare current state against CBB Cyber Security requirements",
            "key_tasks": [
                "Review CBB Operational Risk Management Module",
                "Assess current controls against requirements",
                "Identify compliance gaps",
                "Document current state"
            ],
            "deliverables": [
                "Gap assessment report",
                "Current state documentation",
                "Compliance status matrix",
                "Priority risk areas"
            ]
        },
        {
            "phase_number": 2,
            "name": "Risk Assessment",
            "description": "Conduct comprehensive cyber risk assessment",
            "key_tasks": [
                "Identify cyber threats and vulnerabilities",
                "Assess risk impact and likelihood",
                "Prioritize risks",
                "Develop risk treatment plan"
            ],
            "deliverables": [
                "Risk assessment report",
                "Risk register",
                "Risk treatment plan",
                "Risk appetite statement"
            ]
        },
        {
            "phase_number": 3,
            "name": "Control Implementation",
            "description": "Implement required cybersecurity controls",
            "key_tasks": [
                "Implement technical security controls",
                "Develop required policies and procedures",
                "Deploy access management controls",
                "Establish security monitoring"
            ],
            "deliverables": [
                "Control implementation evidence",
                "Security policies",
                "Technical configurations",
                "Monitoring procedures"
            ]
        },
        {
            "phase_number": 4,
            "name": "Evidence Collection",
            "description": "Collect and organize compliance evidence",
            "key_tasks": [
                "Gather control effectiveness evidence",
                "Document policy implementations",
                "Collect testing results",
                "Organize evidence repository"
            ],
            "deliverables": [
                "Evidence package",
                "Control testing results",
                "Policy documentation",
                "Training records"
            ]
        },
        {
            "phase_number": 5,
            "name": "Internal Review",
            "description": "Conduct internal compliance review",
            "key_tasks": [
                "Review control effectiveness",
                "Verify evidence completeness",
                "Conduct internal assessment",
                "Address any gaps"
            ],
            "deliverables": [
                "Internal review report",
                "Gap remediation evidence",
                "Compliance checklist",
                "Management sign-off"
            ]
        },
        {
            "phase_number": 6,
            "name": "Regulatory Reporting",
            "description": "Submit compliance reports to CBB",
            "key_tasks": [
                "Prepare regulatory submission",
                "Complete required reporting templates",
                "Submit to CBB",
                "Address any CBB feedback"
            ],
            "deliverables": [
                "CBB compliance report",
                "Regulatory submission confirmation",
                "Correspondence records",
                "Ongoing reporting schedule"
            ]
        }
    ],
    "SAMA": [
        {
            "phase_number": 1,
            "name": "Framework Assessment",
            "description": "Assess current state against SAMA Cybersecurity Framework",
            "key_tasks": [
                "Review SAMA CSF requirements",
                "Assess current security posture",
                "Identify compliance gaps",
                "Determine maturity levels"
            ],
            "deliverables": [
                "Gap assessment report",
                "Maturity assessment",
                "Compliance status matrix",
                "Prioritized action items"
            ]
        },
        {
            "phase_number": 2,
            "name": "Risk Management",
            "description": "Implement cybersecurity risk management framework",
            "key_tasks": [
                "Establish risk management methodology",
                "Conduct risk assessments",
                "Develop risk treatment plans",
                "Implement risk monitoring"
            ],
            "deliverables": [
                "Risk management framework",
                "Risk register",
                "Risk treatment plans",
                "Risk monitoring procedures"
            ]
        },
        {
            "phase_number": 3,
            "name": "Control Implementation",
            "description": "Implement SAMA-required cybersecurity controls",
            "key_tasks": [
                "Implement access controls",
                "Deploy network security controls",
                "Establish data protection measures",
                "Implement security monitoring"
            ],
            "deliverables": [
                "Control implementation evidence",
                "Security architecture documentation",
                "Configuration standards",
                "Testing results"
            ]
        },
        {
            "phase_number": 4,
            "name": "Third-Party Management",
            "description": "Assess and manage third-party cyber risks",
            "key_tasks": [
                "Identify critical third parties",
                "Conduct vendor risk assessments",
                "Implement vendor management controls",
                "Establish ongoing monitoring"
            ],
            "deliverables": [
                "Third-party inventory",
                "Vendor risk assessments",
                "Contractual security requirements",
                "Vendor monitoring procedures"
            ]
        },
        {
            "phase_number": 5,
            "name": "Incident Response",
            "description": "Establish cybersecurity incident response capability",
            "key_tasks": [
                "Develop incident response plan",
                "Establish incident response team",
                "Implement detection capabilities",
                "Conduct incident response exercises"
            ],
            "deliverables": [
                "Incident response plan",
                "IR team structure",
                "Detection and alerting procedures",
                "Exercise records"
            ]
        },
        {
            "phase_number": 6,
            "name": "Compliance Reporting",
            "description": "Submit compliance reports to SAMA",
            "key_tasks": [
                "Prepare compliance documentation",
                "Complete SAMA reporting requirements",
                "Submit required reports",
                "Address SAMA feedback"
            ],
            "deliverables": [
                "SAMA compliance report",
                "Self-assessment results",
                "Evidence package",
                "Regulatory correspondence"
            ]
        }
    ],
    "SBP": [
        {
            "phase_number": 1,
            "name": "Regulatory Assessment",
            "description": "Assess against SBP IT/IS requirements and circulars",
            "key_tasks": [
                "Review applicable SBP circulars",
                "Assess current IT/IS posture",
                "Identify compliance gaps",
                "Document current state"
            ],
            "deliverables": [
                "Gap assessment report",
                "Circular compliance matrix",
                "Current state documentation",
                "Priority areas"
            ]
        },
        {
            "phase_number": 2,
            "name": "Policy Development",
            "description": "Develop required IT/IS policies and procedures",
            "key_tasks": [
                "Develop information security policy",
                "Create IT operational policies",
                "Establish security procedures",
                "Document standards and guidelines"
            ],
            "deliverables": [
                "Information security policy",
                "IT policies",
                "Operational procedures",
                "Standards documentation"
            ]
        },
        {
            "phase_number": 3,
            "name": "Control Implementation",
            "description": "Implement required technical and operational controls",
            "key_tasks": [
                "Implement access controls",
                "Deploy network security",
                "Establish change management",
                "Implement audit logging"
            ],
            "deliverables": [
                "Control implementation evidence",
                "Technical configurations",
                "Procedure documentation",
                "Testing results"
            ]
        },
        {
            "phase_number": 4,
            "name": "Business Continuity",
            "description": "Establish Business Continuity and Disaster Recovery plans",
            "key_tasks": [
                "Develop business impact analysis",
                "Create BCP/DRP documentation",
                "Establish recovery procedures",
                "Test continuity plans"
            ],
            "deliverables": [
                "Business impact analysis",
                "Business continuity plan",
                "Disaster recovery plan",
                "Test results and reports"
            ]
        },
        {
            "phase_number": 5,
            "name": "Audit & Review",
            "description": "Conduct internal IT/IS audit and review",
            "key_tasks": [
                "Plan IT/IS audit program",
                "Conduct internal audits",
                "Review control effectiveness",
                "Track findings remediation"
            ],
            "deliverables": [
                "Audit program",
                "Audit reports",
                "Finding tracker",
                "Remediation evidence"
            ]
        },
        {
            "phase_number": 6,
            "name": "Regulatory Submission",
            "description": "Submit compliance documentation to SBP",
            "key_tasks": [
                "Prepare regulatory submission package",
                "Complete required reporting",
                "Submit to SBP",
                "Address any SBP queries"
            ],
            "deliverables": [
                "SBP compliance report",
                "Submission package",
                "Regulatory correspondence",
                "Ongoing reporting calendar"
            ]
        }
    ]
}


def seed_certification_phases():
    db = SessionLocal()
    try:
        existing_count = db.query(CertificationPhase).count()
        if existing_count > 0:
            print(f"Certification phases already seeded ({existing_count} phases exist). Skipping.")
            return
        
        frameworks = db.query(Framework).all()
        framework_map = {f.short_code: f.id for f in frameworks}
        
        phases_created = 0
        for short_code, phases in CERTIFICATION_PHASES.items():
            if short_code not in framework_map:
                print(f"Framework {short_code} not found in database. Skipping phases.")
                continue
            
            framework_id = framework_map[short_code]
            
            for phase_data in phases:
                phase = CertificationPhase(
                    framework_id=framework_id,
                    phase_number=phase_data["phase_number"],
                    name=phase_data["name"],
                    description=phase_data["description"],
                    key_tasks=phase_data["key_tasks"],
                    deliverables=phase_data["deliverables"]
                )
                db.add(phase)
                phases_created += 1
        
        db.commit()
        print(f"Successfully seeded {phases_created} certification phases.")
    except Exception as e:
        db.rollback()
        print(f"Error seeding certification phases: {e}")
        raise
    finally:
        db.close()


if __name__ == "__main__":
    seed_certification_phases()
