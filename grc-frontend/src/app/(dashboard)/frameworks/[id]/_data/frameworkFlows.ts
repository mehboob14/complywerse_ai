// AUTO-GENERATED from the compliance-framework-flows reference (34 frameworks).
// Do not hand-edit; regenerate via scratchpad/gen_flows.py.
//
// Each flow is the canonical end-to-end compliance journey for a framework:
// ordered phases (internal work vs. external audit/certifier/regulator steps),
// the clauses/domains each phase covers, the deliverables and evidence/artifacts
// produced, the owner, and the continual-improvement loop-back cycle.

export interface FrameworkPhase {
  n: number;
  name: string;
  coverage: string;
  deliverables: string[];
  evidence: string[];
  owner: string;
  ext: boolean; // true = external audit / certifier / regulator step
}

export interface FrameworkLoopback {
  label: string;
  from: number; // phase number the cycle departs from
  to: number;   // phase number the cycle returns to
}

export interface FrameworkFlow {
  id: string;
  name: string;
  version: string;
  controls: number;
  group: string;
  region: string;
  authority: string;
  assessmentType: string;
  cycle: string;
  phases: FrameworkPhase[];
  loopback: FrameworkLoopback;
  match: string[]; // normalized substrings that identify this framework by name
}

export const FRAMEWORK_FLOWS: FrameworkFlow[] = [
  {
    "id": "iso27001",
    "name": "ISO/IEC 27001:2022 — Information Security (ISMS)",
    "version": "2022",
    "controls": 93,
    "group": "ISO & Governance",
    "region": "International",
    "authority": "ISO/IEC; accredited certification bodies (UKAS, ANAB, etc.)",
    "assessmentType": "Accredited 3rd-party certification (Stage 1 + Stage 2)",
    "cycle": "3-yr certificate + annual surveillance; PDCA",
    "phases": [
      {
        "n": 1,
        "name": "Context, Scope & ISMS Initiation",
        "coverage": "Clause 4 (context, interested parties, ISMS scope) + Clause 5 (leadership, policy, roles)",
        "deliverables": [
          "ISMS scope statement",
          "Information security policy",
          "Interested-parties register",
          "Roles & responsibilities (RACI)"
        ],
        "evidence": [
          "Documented scope boundaries",
          "Signed policy",
          "Top-management commitment records"
        ],
        "owner": "Top Management / CISO",
        "ext": false
      },
      {
        "n": 2,
        "name": "Risk Assessment & Treatment Planning",
        "coverage": "Clause 6: 6.1.2 risk assessment, 6.1.3 risk treatment & Annex A control selection, 6.2 objectives",
        "deliverables": [
          "Risk assessment methodology",
          "Risk register",
          "Risk Treatment Plan (RTP)",
          "Statement of Applicability (SoA)"
        ],
        "evidence": [
          "Risk criteria & methodology",
          "SoA justifying all 93 Annex A controls",
          "Risk-owner acceptance sign-off"
        ],
        "owner": "Risk Owner / ISMS Manager",
        "ext": false
      },
      {
        "n": 3,
        "name": "Support & Resourcing",
        "coverage": "Clause 7: competence, awareness, communication, documented information",
        "deliverables": [
          "Competence & training records",
          "Awareness programme",
          "Document control procedure"
        ],
        "evidence": [
          "Training completion logs",
          "Competence matrix",
          "Version-controlled ISMS docs"
        ],
        "owner": "ISMS Manager / HR",
        "ext": false
      },
      {
        "n": 4,
        "name": "Annex A Controls Implementation",
        "coverage": "Clause 8 operation across 4 themes: A.5 Organizational (37), A.6 People (8), A.7 Physical (14), A.8 Technological (34)",
        "deliverables": [
          "Access control policy",
          "Cryptography & key mgmt procedures",
          "Supplier security agreements",
          "Secure development & change mgmt"
        ],
        "evidence": [
          "Configured technical controls (logging, access reviews, encryption)",
          "Physical access records",
          "Implementation mapped to SoA"
        ],
        "owner": "Control Owners / IT Security",
        "ext": false
      },
      {
        "n": 5,
        "name": "Monitoring, Internal Audit & Mgmt Review",
        "coverage": "Clause 9: 9.1 monitoring/measurement, 9.2 internal audit, 9.3 management review",
        "deliverables": [
          "Security KPI dashboard",
          "Internal audit programme & reports",
          "Management review minutes"
        ],
        "evidence": [
          "Measurement vs objectives",
          "Internal audit nonconformity records",
          "Management review decisions"
        ],
        "owner": "Internal Auditor / Top Management",
        "ext": false
      },
      {
        "n": 6,
        "name": "Certification Audit (Stage 1 + Stage 2)",
        "coverage": "Accredited certification of full ISMS (Clauses 4-10 + Annex A via SoA); Stage 1 readiness, Stage 2 effectiveness",
        "deliverables": [
          "Stage 1 readiness report",
          "Stage 2 audit report",
          "ISO/IEC 27001 certificate (3-yr)"
        ],
        "evidence": [
          "SoA vs implemented controls walkthrough",
          "Evidence sampling across sites",
          "Nonconformity closure"
        ],
        "owner": "External Accredited Certification Body",
        "ext": true
      },
      {
        "n": 7,
        "name": "Improvement & Surveillance",
        "coverage": "Clause 10: continual improvement, nonconformity & corrective action; annual surveillance + recertification",
        "deliverables": [
          "Corrective action plans (CAPA)",
          "Updated risk register & SoA",
          "Surveillance audit reports"
        ],
        "evidence": [
          "Closed corrective actions with root cause",
          "Continual improvement evidence",
          "Surveillance sampling results"
        ],
        "owner": "ISMS Manager / Certification Body",
        "ext": false
      }
    ],
    "loopback": {
      "label": "PDCA — Act (continual improvement)",
      "from": 7,
      "to": 2
    },
    "match": [
      "27001"
    ]
  },
  {
    "id": "iso42001",
    "name": "ISO/IEC 42001:2023 — AI Management System (AIMS)",
    "version": "2023",
    "controls": 70,
    "group": "ISO & Governance",
    "region": "International",
    "authority": "ISO/IEC; accredited certification bodies (emerging)",
    "assessmentType": "Accredited 3rd-party certification (Stage 1 + Stage 2), SoA-based",
    "cycle": "3-yr certificate + annual surveillance; PDCA across AI lifecycle",
    "phases": [
      {
        "n": 1,
        "name": "AI Context & AIMS Establishment",
        "coverage": "Clause 4-5 + Annex A.2 Policies, A.3 Internal organization; AIMS scope & AI policy",
        "deliverables": [
          "AIMS scope statement",
          "AI policy (A.2)",
          "AI roles & accountability (A.3)",
          "Interested-parties register"
        ],
        "evidence": [
          "Documented AIMS scope over AI systems",
          "Approved AI policy",
          "Issue-escalation process"
        ],
        "owner": "Top Management / AI Governance Lead",
        "ext": false
      },
      {
        "n": 2,
        "name": "AI Risk & Impact Assessment",
        "coverage": "Clause 6: 6.1.2 AI risk assessment, 6.1.4 AI system impact assessment (A.5), risk treatment, SoA",
        "deliverables": [
          "AI risk register",
          "AI System Impact Assessment report",
          "AI Risk Treatment Plan",
          "Statement of Applicability"
        ],
        "evidence": [
          "Impact assessment (individuals & society)",
          "SoA over the 38 Annex A controls",
          "Risk acceptance sign-off"
        ],
        "owner": "AI Risk Owner / AIMS Manager",
        "ext": false
      },
      {
        "n": 3,
        "name": "Support, Resources & Competence",
        "coverage": "Clause 7 + Annex A.4 Resources for AI (data, tooling, compute, human expertise)",
        "deliverables": [
          "AI resources inventory",
          "AI competence & training records",
          "AIMS documentation set"
        ],
        "evidence": [
          "Resource allocation records",
          "AI competence/awareness records",
          "Version-controlled docs"
        ],
        "owner": "AIMS Manager / Data & ML Leads",
        "ext": false
      },
      {
        "n": 4,
        "name": "AI Lifecycle & Data Controls",
        "coverage": "Clause 8 + A.6 AI lifecycle, A.7 Data for AI, A.8 Information to interested parties, A.9 Responsible use",
        "deliverables": [
          "AI lifecycle & dev procedures (A.6)",
          "Data quality & provenance procedures (A.7)",
          "Transparency notices (A.8)",
          "Intended-use guidance (A.9)"
        ],
        "evidence": [
          "Model dev, test & validation records",
          "Data provenance controls",
          "Deployment monitoring & human oversight"
        ],
        "owner": "AI Dev & Ops Team",
        "ext": false
      },
      {
        "n": 5,
        "name": "3rd-Party Governance, Monitoring & Audit",
        "coverage": "Clause 9 monitoring/internal audit/mgmt review + A.10 Third-party & customer relationships",
        "deliverables": [
          "AI supplier due-diligence (A.10)",
          "AI performance metrics",
          "Internal audit reports",
          "Management review minutes"
        ],
        "evidence": [
          "Supplier agreements allocating AI responsibilities",
          "Monitoring vs objectives",
          "Internal audit outputs"
        ],
        "owner": "Internal Auditor / Vendor Mgmt",
        "ext": false
      },
      {
        "n": 6,
        "name": "Certification Audit (Stage 1 + Stage 2)",
        "coverage": "Accredited certification of AIMS (Clauses 4-10 + Annex A via SoA)",
        "deliverables": [
          "Stage 1 documentation report",
          "Stage 2 audit report",
          "ISO/IEC 42001 certificate"
        ],
        "evidence": [
          "SoA-to-control walkthrough",
          "Impact assessment reviewed",
          "Lifecycle & data evidence sampled"
        ],
        "owner": "External Accredited Certification Body",
        "ext": true
      },
      {
        "n": 7,
        "name": "Improvement & Surveillance",
        "coverage": "Clause 10 continual improvement & corrective action; annual surveillance + recertification",
        "deliverables": [
          "Corrective action plans",
          "Updated impact assessments & SoA",
          "Surveillance reports"
        ],
        "evidence": [
          "Closed corrective actions",
          "Re-assessed AI impacts after changes",
          "Surveillance results"
        ],
        "owner": "AIMS Manager / Certification Body",
        "ext": false
      }
    ],
    "loopback": {
      "label": "PDCA — Act (continual improvement)",
      "from": 7,
      "to": 2
    },
    "match": [
      "42001"
    ]
  },
  {
    "id": "iso22301",
    "name": "ISO 22301:2019 — Business Continuity (BCMS)",
    "version": "2019",
    "controls": 40,
    "group": "ISO & Governance",
    "region": "International",
    "authority": "ISO; accredited certification bodies",
    "assessmentType": "Accredited 3rd-party certification (Stage 1 + Stage 2)",
    "cycle": "3-yr certificate + annual surveillance; PDCA",
    "phases": [
      {
        "n": 1,
        "name": "Context, Leadership & BCMS Scope",
        "coverage": "Clause 4-5: context, legal/regulatory needs, BCMS scope, BC policy, roles",
        "deliverables": [
          "BCMS scope statement",
          "Business continuity policy",
          "Legal/regulatory requirements register",
          "BCMS roles"
        ],
        "evidence": [
          "Documented prioritized activities",
          "Approved BC policy",
          "Management commitment"
        ],
        "owner": "Top Management / BC Manager",
        "ext": false
      },
      {
        "n": 2,
        "name": "Planning & BC Objectives",
        "coverage": "Clause 6: actions for risks & opportunities, BC objectives, planning changes",
        "deliverables": [
          "BCMS risk & opportunity plan",
          "BC objectives",
          "BCMS change plan"
        ],
        "evidence": [
          "Documented objectives at relevant functions",
          "Planned actions"
        ],
        "owner": "Business Continuity Manager",
        "ext": false
      },
      {
        "n": 3,
        "name": "Business Impact Analysis & Risk Assessment",
        "coverage": "Clause 8.2: BIA (8.2.2) & Risk Assessment (8.2.3); determine RTO, RPO, MTPD",
        "deliverables": [
          "BIA report",
          "Prioritized activities with RTO/RPO/MTPD",
          "Risk assessment report"
        ],
        "evidence": [
          "BIA methodology & results",
          "Defined recovery objectives",
          "Disruption risk analysis"
        ],
        "owner": "BC Manager / Process Owners",
        "ext": false
      },
      {
        "n": 4,
        "name": "BC Strategy, Solutions & Plans",
        "coverage": "Clause 8.3 strategies & solutions; 8.4 BC plans, incident response, comms, recovery",
        "deliverables": [
          "Business continuity strategy",
          "Business Continuity Plans (BCP)",
          "Incident response procedures",
          "Comms & recovery procedures"
        ],
        "evidence": [
          "Pre/during/post-disruption strategies",
          "Approved BCPs with resources",
          "Defined response teams"
        ],
        "owner": "BC Manager / Recovery Teams",
        "ext": false
      },
      {
        "n": 5,
        "name": "Exercising, Testing & Evaluation",
        "coverage": "Clause 8.5-8.6 exercises & evaluation; Clause 9 monitoring, internal audit, mgmt review",
        "deliverables": [
          "Exercise & test schedule",
          "Post-exercise review reports",
          "Internal audit reports",
          "Management review minutes"
        ],
        "evidence": [
          "Tabletop/simulation exercise records",
          "Post-incident analysis",
          "Internal audit findings"
        ],
        "owner": "BC Manager / Internal Auditor",
        "ext": false
      },
      {
        "n": 6,
        "name": "Certification Audit (Stage 1 + Stage 2)",
        "coverage": "Accredited certification of BCMS (Clauses 4-10); Stage 1 docs, Stage 2 capability & test evidence",
        "deliverables": [
          "Stage 1 readiness report",
          "Stage 2 audit report",
          "ISO 22301 certificate"
        ],
        "evidence": [
          "BIA, RA, strategy & BCP walkthrough",
          "Exercise/test evidence",
          "Nonconformity closure"
        ],
        "owner": "External Accredited Certification Body",
        "ext": true
      },
      {
        "n": 7,
        "name": "Improvement & Surveillance",
        "coverage": "Clause 10 corrective action & continual improvement; annual surveillance + recertification",
        "deliverables": [
          "Corrective action plans",
          "Updated BIA/BCPs",
          "Surveillance reports"
        ],
        "evidence": [
          "Closed corrective actions",
          "Improvement after exercises/incidents",
          "Surveillance results"
        ],
        "owner": "BC Manager / Certification Body",
        "ext": false
      }
    ],
    "loopback": {
      "label": "PDCA — Act (continual improvement)",
      "from": 7,
      "to": 3
    },
    "match": [
      "22301"
    ]
  },
  {
    "id": "iso45001",
    "name": "ISO 45001:2018 — Occupational Health & Safety (OHSMS)",
    "version": "2018",
    "controls": 36,
    "group": "ISO & Governance",
    "region": "International",
    "authority": "ISO; accredited certification bodies",
    "assessmentType": "Accredited 3rd-party certification (Stage 1 + Stage 2)",
    "cycle": "3-yr certificate + annual surveillance; PDCA",
    "phases": [
      {
        "n": 1,
        "name": "Context, Leadership & Worker Participation",
        "coverage": "Clause 4-5: context, OHSMS scope, OH&S policy, 5.4 consultation & participation of workers",
        "deliverables": [
          "OHSMS scope statement",
          "OH&S policy",
          "Worker consultation / H&S committee",
          "OH&S roles"
        ],
        "evidence": [
          "Approved OH&S policy",
          "Worker consultation records",
          "Management commitment"
        ],
        "owner": "Top Management / HSE Manager",
        "ext": false
      },
      {
        "n": 2,
        "name": "Hazard Identification & Risk Assessment (HIRA)",
        "coverage": "Clause 6.1.2: hazard identification, assessment of OH&S risks, OH&S opportunities",
        "deliverables": [
          "HIRA register",
          "OH&S risk & opportunity register",
          "Hierarchy-of-controls decisions"
        ],
        "evidence": [
          "Hazard ID methodology & results",
          "Risk ratings with controls",
          "Worker input"
        ],
        "owner": "OH&S Manager / Supervisors",
        "ext": false
      },
      {
        "n": 3,
        "name": "Legal & Other Requirements + Objectives",
        "coverage": "Clause 6.1.3 legal & other requirements; 6.2 OH&S objectives & plans",
        "deliverables": [
          "Legal & other requirements register",
          "OH&S objectives with targets",
          "Compliance evaluation plan"
        ],
        "evidence": [
          "Up-to-date legal register",
          "Documented objectives",
          "Action plans with owners"
        ],
        "owner": "OH&S Manager / Compliance",
        "ext": false
      },
      {
        "n": 4,
        "name": "Support & Operational Controls",
        "coverage": "Clause 7 support; Clause 8 operation incl. mgmt of change, 8.1.4 procurement/contractors, 8.2 emergency preparedness",
        "deliverables": [
          "Safe work procedures",
          "Competence & training records",
          "Contractor OH&S controls",
          "Emergency response plans"
        ],
        "evidence": [
          "Operational controls per hierarchy",
          "Training records",
          "Emergency drill records"
        ],
        "owner": "OH&S Manager / Operations",
        "ext": false
      },
      {
        "n": 5,
        "name": "Monitoring, Investigation, Audit & Review",
        "coverage": "Clause 9 monitoring, compliance evaluation, internal audit, mgmt review; 10.2 incident investigation",
        "deliverables": [
          "OH&S metrics (leading/lagging)",
          "Compliance evaluation records",
          "Incident investigation reports",
          "Internal audit & mgmt review"
        ],
        "evidence": [
          "Monitoring results",
          "Compliance evaluations",
          "Incident root-cause investigations"
        ],
        "owner": "OH&S Manager / Internal Auditor",
        "ext": false
      },
      {
        "n": 6,
        "name": "Certification Audit (Stage 1 + Stage 2)",
        "coverage": "Accredited certification of OHSMS (Clauses 4-10)",
        "deliverables": [
          "Stage 1 readiness report",
          "Stage 2 audit report",
          "ISO 45001 certificate"
        ],
        "evidence": [
          "HIRA, legal register & objectives walkthrough",
          "Operational & emergency control sampling",
          "Worker consultation evidence"
        ],
        "owner": "External Accredited Certification Body",
        "ext": true
      },
      {
        "n": 7,
        "name": "Improvement & Surveillance",
        "coverage": "Clause 10 incident/nonconformity & continual improvement; annual surveillance + recertification",
        "deliverables": [
          "Corrective action plans (CAPA)",
          "Updated HIRA & legal register",
          "Surveillance reports"
        ],
        "evidence": [
          "Closed corrective actions",
          "Improved OH&S performance",
          "Surveillance results"
        ],
        "owner": "OH&S Manager / Certification Body",
        "ext": false
      }
    ],
    "loopback": {
      "label": "PDCA — Act (continual improvement)",
      "from": 7,
      "to": 2
    },
    "match": [
      "45001"
    ]
  },
  {
    "id": "cobit2019",
    "name": "COBIT 2019 — IT Governance (ISACA)",
    "version": "2019",
    "controls": 40,
    "group": "ISO & Governance",
    "region": "International",
    "authority": "ISACA; assessed via ISACA/accredited assessors (capability, not pass/fail cert)",
    "assessmentType": "Maturity/capability assessment (CMMI-based scale)",
    "cycle": "7-phase implementation lifecycle; iterative re-assessment",
    "phases": [
      {
        "n": 1,
        "name": "Understand Context & Governance Drivers",
        "coverage": "EDM framing; stakeholder needs, pain points, 'what are the drivers?' phase",
        "deliverables": [
          "Governance case / drivers document",
          "Stakeholder needs analysis",
          "Governance program mandate"
        ],
        "evidence": [
          "Documented strategy & governance objectives",
          "Executive sponsorship"
        ],
        "owner": "Board / Executive Sponsor",
        "ext": false
      },
      {
        "n": 2,
        "name": "Design Factor Analysis",
        "coverage": "Analyse the 11 design factors: strategy, goals, risk profile, IT issues, threat landscape, compliance, role of IT, sourcing, methods, tech adoption, size",
        "deliverables": [
          "Design factor worksheet",
          "Goals cascade mapping",
          "Weighted design-factor inputs"
        ],
        "evidence": [
          "Design-factor scoring",
          "Context-to-priority rationale"
        ],
        "owner": "IT Governance Lead / Practitioner",
        "ext": false
      },
      {
        "n": 3,
        "name": "Governance System Design & Tailoring",
        "coverage": "Design Guide: select priority objectives from the 40 (5 EDM, 14 APO, 11 BAI, 6 DSS, 4 MEA), set target capability levels",
        "deliverables": [
          "Design Guide report",
          "Prioritized governance & mgmt objectives",
          "Target capability levels"
        ],
        "evidence": [
          "Tailored governance system design",
          "Documented priority objectives"
        ],
        "owner": "COBIT Practitioner / IT Gov Committee",
        "ext": false
      },
      {
        "n": 4,
        "name": "Baseline Capability Assessment",
        "coverage": "Assess current capability across EDM/APO/BAI/DSS/MEA on the 0-5 CMMI-based scale",
        "deliverables": [
          "Current-state capability report",
          "Gap analysis (current vs target)",
          "Practice inventory"
        ],
        "evidence": [
          "Assessed capability levels",
          "Evidence of practices, activities & work products"
        ],
        "owner": "COBIT Assessor / Process Owners",
        "ext": false
      },
      {
        "n": 5,
        "name": "Roadmap & Implementation of Practices",
        "coverage": "Define roadmap & implement governance/mgmt practices — oversight (EDM), planning (APO), delivery (BAI, DSS)",
        "deliverables": [
          "Improvement roadmap / program plan",
          "Policies, processes, RACI, work products",
          "Change-enablement plan"
        ],
        "evidence": [
          "Operating practices",
          "Populated work products",
          "Change mgmt records"
        ],
        "owner": "Program Manager / Process Owners",
        "ext": false
      },
      {
        "n": 6,
        "name": "Performance Monitoring & Benefits",
        "coverage": "MEA domain: MEA01 performance, MEA02 internal control, MEA03 external compliance; realize benefits",
        "deliverables": [
          "Governance scorecard",
          "MEA monitoring & compliance reports",
          "Benefits realization report"
        ],
        "evidence": [
          "Performance & conformance results",
          "Internal control monitoring",
          "Realized benefits vs goals cascade"
        ],
        "owner": "MEA Function / Governance Committee",
        "ext": false
      },
      {
        "n": 7,
        "name": "Review Effectiveness & Improve",
        "coverage": "'Review effectiveness' phase — reassess capability, sustain momentum, iterate as design factors change",
        "deliverables": [
          "Updated capability report",
          "Lessons-learned & sustainability plan",
          "Updated governance design"
        ],
        "evidence": [
          "Capability improvement trend",
          "Updated design-factor analysis",
          "Improvement decisions"
        ],
        "owner": "Governance Committee / Practitioner",
        "ext": false
      }
    ],
    "loopback": {
      "label": "Implementation lifecycle — continual improvement",
      "from": 7,
      "to": 2
    },
    "match": [
      "cobit"
    ]
  },
  {
    "id": "nistcsf",
    "name": "NIST Cybersecurity Framework (CSF)",
    "version": "1.1",
    "controls": 46,
    "group": "NIST — US Federal",
    "region": "United States",
    "authority": "NIST (voluntary; adopted by regulators)",
    "assessmentType": "Self-assessment vs Current/Target Profile; no formal cert body",
    "cycle": "Continuous improvement; profiles re-baselined periodically",
    "phases": [
      {
        "n": 1,
        "name": "Prioritize & Scope",
        "coverage": "Set mission objectives, priorities, risk tolerance; scope systems/assets/business lines; choose target Implementation Tier (1-4)",
        "deliverables": [
          "Program scope statement",
          "Risk-tolerance statement",
          "Target Implementation Tier"
        ],
        "evidence": [
          "Executive risk appetite / charter",
          "System & process inventory",
          "Regulatory drivers"
        ],
        "owner": "Senior Leadership",
        "ext": false
      },
      {
        "n": 2,
        "name": "Orient",
        "coverage": "Identify systems, assets, regulatory requirements, threats & vulnerabilities (ID.AM, ID.GV)",
        "deliverables": [
          "Asset & data inventory",
          "Regulatory/standards register",
          "Threat & vulnerability catalog"
        ],
        "evidence": [
          "Asset management records",
          "Threat intelligence sources",
          "Compliance requirements"
        ],
        "owner": "Risk owners / Security architects",
        "ext": false
      },
      {
        "n": 3,
        "name": "Create Current Profile",
        "coverage": "Rate which of the 5 Functions / 23 Categories / 108 Subcategories are currently achieved",
        "deliverables": [
          "Current Profile (as-is)",
          "Current Implementation Tier rating"
        ],
        "evidence": [
          "Existing control documentation",
          "Prior assessments mapped to CSF",
          "Per-Subcategory maturity"
        ],
        "owner": "CISO / Security team",
        "ext": false
      },
      {
        "n": 4,
        "name": "Conduct Risk Assessment",
        "coverage": "Analyze likelihood & impact of cyber events (ID.RA, ID.RM)",
        "deliverables": [
          "Cyber risk assessment report",
          "Risk register (likelihood/impact)"
        ],
        "evidence": [
          "Threat/vulnerability analysis",
          "Impact & likelihood determinations"
        ],
        "owner": "Risk management / CISO",
        "ext": false
      },
      {
        "n": 5,
        "name": "Create Target Profile",
        "coverage": "Define desired outcomes across Categories/Subcategories; align to target Tier",
        "deliverables": [
          "Target Profile (to-be)",
          "Target Implementation Tier"
        ],
        "evidence": [
          "Desired-state Subcategory outcomes",
          "Partner requirements",
          "Sector reference profiles"
        ],
        "owner": "Executive + Business/Process",
        "ext": false
      },
      {
        "n": 6,
        "name": "Determine, Analyze & Prioritize Gaps",
        "coverage": "Compare Current vs Target Profile; build prioritized, cost-informed action plan",
        "deliverables": [
          "Gap analysis (Current vs Target)",
          "Prioritized remediation roadmap"
        ],
        "evidence": [
          "Profile delta matrix",
          "Cost & resource estimates",
          "Prioritization rationale"
        ],
        "owner": "CISO / PMO",
        "ext": false
      },
      {
        "n": 7,
        "name": "Implement Action Plan",
        "coverage": "Adjust/implement controls to reach Target Profile; monitor (DE.CM); informative refs 800-53/ISO/CIS",
        "deliverables": [
          "Implemented control/process changes",
          "Updated Current Profile",
          "Metrics & dashboards"
        ],
        "evidence": [
          "Control implementation records",
          "Continuous monitoring outputs",
          "Achieved Tier evidence"
        ],
        "owner": "System owners / Security engineers",
        "ext": false
      }
    ],
    "loopback": {
      "label": "Continuous improvement — re-baseline profile",
      "from": 7,
      "to": 3
    },
    "match": [
      "nistcybersecurity"
    ]
  },
  {
    "id": "nist80053",
    "name": "NIST SP 800-53 Rev 5 — Security & Privacy Controls",
    "version": "Rev 5",
    "controls": 148,
    "group": "NIST — US Federal",
    "region": "United States",
    "authority": "NIST catalog; FISMA via agency Authorizing Officials; RMF (SP 800-37)",
    "assessmentType": "RMF authorization (ATO) via independent assessment (SP 800-53A); FedRAMP for cloud",
    "cycle": "Ongoing authorization via continuous monitoring; reauthorization on change",
    "phases": [
      {
        "n": 1,
        "name": "Prepare (RMF Step 1)",
        "coverage": "Org & system prep: roles, risk strategy, risk tolerance, common controls, system boundary",
        "deliverables": [
          "Risk management strategy",
          "Defined roles (AO, ISSO, System Owner)",
          "Common control catalog",
          "System boundary"
        ],
        "evidence": [
          "Risk tolerance statements",
          "Enterprise architecture & inheritance",
          "Categorization prerequisites"
        ],
        "owner": "Risk Executive / System Owner",
        "ext": false
      },
      {
        "n": 2,
        "name": "Categorize (RMF Step 2)",
        "coverage": "Categorize system & information per FIPS 199 / SP 800-60 (Low/Mod/High for C-I-A)",
        "deliverables": [
          "FIPS 199 categorization",
          "Information types inventory",
          "System description in SSP"
        ],
        "evidence": [
          "Impact-level determinations",
          "Data flow & info-type analysis"
        ],
        "owner": "System Owner / Information Owner",
        "ext": false
      },
      {
        "n": 3,
        "name": "Select (RMF Step 3)",
        "coverage": "Select baseline (Low/Mod/High per SP 800-53B) from 20 families (AC,AU,CM,IA,IR,RA,SC,SI,SR,PT...); tailor & add overlays",
        "deliverables": [
          "Tailored control set",
          "Control allocation & inheritance",
          "Draft SSP",
          "Continuous monitoring strategy"
        ],
        "evidence": [
          "Baseline selection rationale",
          "Tailoring/overlay decisions",
          "Privacy control selection (PT/PL)"
        ],
        "owner": "System Owner / ISSO",
        "ext": false
      },
      {
        "n": 4,
        "name": "Implement (RMF Step 4)",
        "coverage": "Implement selected controls; document implementation in the SSP",
        "deliverables": [
          "Completed SSP with implementation statements",
          "Configuration/implementation docs"
        ],
        "evidence": [
          "Control implementation descriptions",
          "Architecture artifacts",
          "Baseline config records"
        ],
        "owner": "System Owner / ISSO",
        "ext": false
      },
      {
        "n": 5,
        "name": "Assess (RMF Step 5)",
        "coverage": "Independent assessor evaluates controls per SP 800-53A (Examine/Interview/Test)",
        "deliverables": [
          "Security Assessment Plan (SAP)",
          "Security Assessment Report (SAR)",
          "Initial POA&M"
        ],
        "evidence": [
          "Examine/Interview/Test results",
          "Control effectiveness evidence",
          "Findings & severity"
        ],
        "owner": "Independent Assessor (SCA)",
        "ext": true
      },
      {
        "n": 6,
        "name": "Authorize (RMF Step 6)",
        "coverage": "Authorizing Official reviews package & makes risk-based decision; accept residual risk",
        "deliverables": [
          "Authorization package (SSP+SAR+POA&M)",
          "Risk determination",
          "Authorization to Operate (ATO) letter"
        ],
        "evidence": [
          "Residual risk analysis",
          "POA&M with milestones",
          "Risk-acceptance rationale"
        ],
        "owner": "Authorizing Official (AO)",
        "ext": false
      },
      {
        "n": 7,
        "name": "Monitor (RMF Step 7)",
        "coverage": "Continuous monitoring of control effectiveness, changes & posture (ISCM); ongoing authorization",
        "deliverables": [
          "Continuous monitoring reports",
          "Updated SSP & POA&M",
          "Security status reports"
        ],
        "evidence": [
          "Automated control monitoring/scans",
          "Change & config records",
          "Recurring reassessments"
        ],
        "owner": "System Owner / ISSO / ConMon team",
        "ext": false
      }
    ],
    "loopback": {
      "label": "Continuous monitoring / reauthorization",
      "from": 7,
      "to": 2
    },
    "match": [
      "80053"
    ]
  },
  {
    "id": "nist800171",
    "name": "NIST SP 800-171 Rev 2 — Protecting CUI",
    "version": "Rev 2",
    "controls": 110,
    "group": "NIST — US Federal",
    "region": "United States",
    "authority": "NIST; DoD (DFARS 7012/7019/7020, CMMC); NARA/OSC for CUI",
    "assessmentType": "DoD self-assessment scored in SPRS; CMMC L2 via C3PAO (or self)",
    "cycle": "Annual affirmation; SPRS score valid 3 yrs; CMMC L2 every 3 yrs; POA&M close in 180 days",
    "phases": [
      {
        "n": 1,
        "name": "Scope CUI Environment",
        "coverage": "Identify CUI/FCI flows; define boundary of covered systems processing/storing/transmitting CUI",
        "deliverables": [
          "CUI/FCI data flow diagrams",
          "Asset inventory & CMMC categorization",
          "Defined enclave boundary"
        ],
        "evidence": [
          "Contract/DFARS CUI markings",
          "Network & data flow docs",
          "Asset categorization"
        ],
        "owner": "System Owner / Compliance lead",
        "ext": false
      },
      {
        "n": 2,
        "name": "Develop System Security Plan (SSP)",
        "coverage": "Document how each of the 110 requirements across 14 families (AC,AT,AU,CM,IA,IR,MA,MP,PS,PE,RA,CA,SC,SI) is implemented",
        "deliverables": [
          "System Security Plan (SSP)",
          "Security policies & procedures",
          "Network diagram & boundary"
        ],
        "evidence": [
          "Implementation narratives per requirement",
          "Referenced policies",
          "Roles & responsibilities"
        ],
        "owner": "System Owner / ISSO",
        "ext": false
      },
      {
        "n": 3,
        "name": "Assess Against 110 Requirements (800-171A)",
        "coverage": "Assess implementation using SP 800-171A objectives (Examine/Interview/Test); Met/Not Met/N-A",
        "deliverables": [
          "Assessment results per requirement",
          "Evidence package mapped to 800-171A"
        ],
        "evidence": [
          "Config evidence, screenshots, logs",
          "Interviews & test outputs",
          "Objective-level determinations"
        ],
        "owner": "Assessor (internal) / ISSO",
        "ext": false
      },
      {
        "n": 4,
        "name": "Calculate & Submit SPRS Score",
        "coverage": "DoD Assessment Methodology (start 110; subtract weighted 1/3/5; range -203..+110); submit to SPRS",
        "deliverables": [
          "SPRS score (Basic assessment)",
          "Assessment date & scope in SPRS",
          "Score computation worksheet"
        ],
        "evidence": [
          "Weighted deduction worksheet",
          "SSP version referenced",
          "SPRS submission confirmation"
        ],
        "owner": "Contractor / System Owner",
        "ext": false
      },
      {
        "n": 5,
        "name": "Develop POA&M & Remediate",
        "coverage": "Document unmet requirements with milestones; remediate (CMMC L2 POA&M-eligible items close in 180 days)",
        "deliverables": [
          "Plan of Action & Milestones (POA&M)",
          "Remediation evidence & updated score"
        ],
        "evidence": [
          "Milestone tracking & completion",
          "Re-tested control results",
          "Updated SPRS score"
        ],
        "owner": "System Owner / Remediation owners",
        "ext": false
      },
      {
        "n": 6,
        "name": "Annual Affirmation & Monitoring",
        "coverage": "Maintain continuous compliance; annually affirm status in SPRS; monitor & update SSP/POA&M",
        "deliverables": [
          "Annual SPRS affirmation",
          "Updated SSP/POA&M",
          "Continuous monitoring records"
        ],
        "evidence": [
          "Change & config records",
          "Recurring self-assessment",
          "Affirming-official attestation"
        ],
        "owner": "Affirming Official / Senior official",
        "ext": false
      },
      {
        "n": 7,
        "name": "CMMC Level 2 C3PAO Assessment",
        "coverage": "For CMMC L2 contracts: 3rd-party assessment by a C3PAO vs all 110; Conditional then Final cert",
        "deliverables": [
          "C3PAO assessment report",
          "CMMC L2 certification",
          "Results in CMMC eMASS / SPRS"
        ],
        "evidence": [
          "Independent Examine/Interview/Test",
          "POA&M closure in 180 days",
          "Certified score & certificate"
        ],
        "owner": "C3PAO Certified Assessor",
        "ext": true
      }
    ],
    "loopback": {
      "label": "Annual affirmation + 3-yr reassessment",
      "from": 7,
      "to": 1
    },
    "match": [
      "800171"
    ]
  },
  {
    "id": "nistairmf",
    "name": "NIST AI Risk Management Framework (AI RMF)",
    "version": "1.0",
    "controls": 72,
    "group": "NIST — US Federal",
    "region": "United States",
    "authority": "NIST (voluntary; AI RMF Playbook & AIRC)",
    "assessmentType": "Voluntary self-assessment vs the 4 Functions & AI RMF Profiles",
    "cycle": "Continuous & iterative across the AI lifecycle",
    "phases": [
      {
        "n": 1,
        "name": "GOVERN (cross-cutting)",
        "coverage": "Culture of AI risk mgmt: policies, accountability, roles, legal/regulatory compliance, third-party oversight; infused throughout Map/Measure/Manage",
        "deliverables": [
          "AI governance policies & strategy",
          "Accountability / roles structure",
          "Third-party risk policy",
          "Risk tolerance definitions"
        ],
        "evidence": [
          "Documented AI policies",
          "AI roles org chart",
          "Legal/regulatory mapping"
        ],
        "owner": "Senior leadership / AI governance",
        "ext": false
      },
      {
        "n": 2,
        "name": "MAP — Establish Context",
        "coverage": "Frame purpose, setting, stakeholders; categorize the AI system; establish requirements & interdependencies",
        "deliverables": [
          "AI system context & use-case docs",
          "Stakeholder & impact mapping",
          "Capabilities/limitations inventory",
          "Initial risk identification"
        ],
        "evidence": [
          "Intended-purpose statements",
          "Stakeholder analysis",
          "Data provenance & interdependencies"
        ],
        "owner": "AI design/dev teams; TEVV actors",
        "ext": false
      },
      {
        "n": 3,
        "name": "MEASURE — Analyze & Assess",
        "coverage": "Quantitative/qualitative analysis of trustworthiness (valid, safe, secure, accountable, explainable, privacy-enhanced, fair)",
        "deliverables": [
          "Metrics & measurement methods",
          "Trustworthiness evaluation results",
          "TEVV / test reports"
        ],
        "evidence": [
          "Model evaluation & validation",
          "Bias/fairness & safety tests",
          "Performance & monitoring metrics"
        ],
        "owner": "TEVV / evaluation teams",
        "ext": false
      },
      {
        "n": 4,
        "name": "MANAGE — Prioritize & Respond",
        "coverage": "Allocate resources to treat mapped/measured risks; prioritize, respond, recover; manage third-party risk; document residual risk",
        "deliverables": [
          "Risk treatment/response plans",
          "Residual risk documentation",
          "Incident response & recovery plans",
          "Monitoring plan"
        ],
        "evidence": [
          "Risk response & mitigation records",
          "Residual risk sign-off",
          "Incident/response logs"
        ],
        "owner": "AI deployment/ops; risk owners",
        "ext": false
      },
      {
        "n": 5,
        "name": "Develop AI RMF Profile",
        "coverage": "Create Current & Target Profiles across Govern/Map/Measure/Manage; gap analysis to prioritize",
        "deliverables": [
          "Current AI RMF Profile",
          "Target AI RMF Profile",
          "Gap analysis & improvement plan"
        ],
        "evidence": [
          "Selected/tailored outcomes",
          "Profile delta analysis",
          "Use-case reference profiles"
        ],
        "owner": "AI governance + program leads",
        "ext": false
      },
      {
        "n": 6,
        "name": "Implement, Monitor & Iterate",
        "coverage": "Implement prioritized actions (AI RMF Playbook); continuously monitor; re-run Map/Measure/Manage as context evolves",
        "deliverables": [
          "Implemented actions per Playbook",
          "Continuous monitoring records",
          "Updated Profiles & docs"
        ],
        "evidence": [
          "Deployment & monitoring evidence",
          "Stakeholder feedback & incident data",
          "Updated measurements"
        ],
        "owner": "Operations / deployment AI actors",
        "ext": false
      }
    ],
    "loopback": {
      "label": "Iterate across AI lifecycle (Govern throughout)",
      "from": 6,
      "to": 2
    },
    "match": [
      "airmf",
      "airiskmanagement"
    ]
  },
  {
    "id": "soc2",
    "name": "SOC 2 Type II (AICPA TSC)",
    "version": "2017/2022",
    "controls": 65,
    "group": "US Regulatory & Audit",
    "region": "United States",
    "authority": "AICPA; independent licensed CPA firm (service auditor)",
    "assessmentType": "Type II attestation over a period (design + operating effectiveness)",
    "cycle": "Annual, over a 3-12 month observation period",
    "phases": [
      {
        "n": 1,
        "name": "Scoping & TSC Selection",
        "coverage": "Select Trust Services Categories: Security/Common Criteria (CC1-CC9, mandatory) + optional Availability, Processing Integrity, Confidentiality, Privacy; define boundaries & subservice orgs",
        "deliverables": [
          "System scope definition",
          "Selected TSC memo",
          "System Description (Section III) draft",
          "Carve-out/inclusive determination"
        ],
        "evidence": [
          "Data flow diagrams",
          "In-scope apps/infra/third parties",
          "CUECs list"
        ],
        "owner": "Compliance/Security lead",
        "ext": false
      },
      {
        "n": 2,
        "name": "Readiness / Gap Assessment",
        "coverage": "Map controls to CC1 Control Env, CC2 Comms, CC3 Risk, CC4 Monitoring, CC5 Control Activities, CC6 Access, CC7 Operations, CC8 Change, CC9 Risk Mitigation + selected criteria",
        "deliverables": [
          "Readiness/gap report",
          "Remediation roadmap",
          "Control-to-criteria matrix"
        ],
        "evidence": [
          "Current policy inventory",
          "Preliminary walkthroughs",
          "Control ownership"
        ],
        "owner": "GRC team / readiness advisor",
        "ext": false
      },
      {
        "n": 3,
        "name": "Control Implementation & Remediation",
        "coverage": "Operationalize controls: CC6 (MFA, least-privilege, encryption), CC7 (monitoring, IR, vuln mgmt), CC8 (change/SDLC) + category controls",
        "deliverables": [
          "Policies (Infosec, Access, Change, IR, BCP/DR, Vendor)",
          "Configured security tooling",
          "Vendor/subservice risk assessments"
        ],
        "evidence": [
          "Onboarding/offboarding records",
          "MFA & access configs",
          "Change tickets",
          "Risk register"
        ],
        "owner": "Control owners / IT & Eng",
        "ext": false
      },
      {
        "n": 4,
        "name": "Observation Period",
        "coverage": "Controls operate consistently across the review period (3/6/12 months) for all in-scope TSC",
        "deliverables": [
          "Continuous evidence repository",
          "Control operation logs",
          "Exception/incident tracking"
        ],
        "evidence": [
          "Access reviews performed",
          "Change tickets & approvals",
          "Backup/DR test records",
          "Security-committee minutes"
        ],
        "owner": "Control owners (evidence custodians)",
        "ext": false
      },
      {
        "n": 5,
        "name": "Auditor Fieldwork & Testing",
        "coverage": "Service auditor tests design AND operating effectiveness via inquiry, observation, inspection, re-performance across CC1-CC9 + categories",
        "deliverables": [
          "Auditor test plan & sample selections",
          "PBC evidence request lists",
          "Walkthrough & test workpapers"
        ],
        "evidence": [
          "Sampled tickets, access reviews, logs, configs",
          "Inquiry responses",
          "Population listings"
        ],
        "owner": "Independent CPA firm (service auditor)",
        "ext": true
      },
      {
        "n": 6,
        "name": "Reporting & Opinion Issuance",
        "coverage": "Opinion on suitable design & operating effectiveness vs applicable TSC over the period; document exceptions",
        "deliverables": [
          "SOC 2 Type II report (Sections I-V)",
          "List of exceptions / qualified or unqualified opinion"
        ],
        "evidence": [
          "Management assertion",
          "Documented deviations & responses",
          "Bridge/gap letter (optional)"
        ],
        "owner": "Service auditor / Management asserts",
        "ext": true
      },
      {
        "n": 7,
        "name": "Continuous Monitoring & Annual Renewal",
        "coverage": "Operate all TSC controls, remediate exceptions, prepare next consecutive period for uninterrupted coverage",
        "deliverables": [
          "Remediation plan for exceptions",
          "Updated System Description & matrix",
          "Next-period evidence schedule"
        ],
        "evidence": [
          "Continuous monitoring dashboards",
          "Recurring access reviews & risk assessments",
          "Updated policies"
        ],
        "owner": "GRC/Compliance team",
        "ext": false
      }
    ],
    "loopback": {
      "label": "Annual re-examination (consecutive periods)",
      "from": 7,
      "to": 4
    },
    "match": [
      "soc2"
    ]
  },
  {
    "id": "soxitgc",
    "name": "SOX IT General Controls (SEC/PCAOB)",
    "version": "2024",
    "controls": 54,
    "group": "US Regulatory & Audit",
    "region": "United States",
    "authority": "SEC & PCAOB (AS 2201); management (404a) + external audit firm (404b)",
    "assessmentType": "Management assessment of ICFR + independent external auditor opinion (integrated audit)",
    "cycle": "Annual (fiscal-year aligned); interim + year-end roll-forward",
    "phases": [
      {
        "n": 1,
        "name": "Scoping & Risk Assessment (Top-Down)",
        "coverage": "Identify significant accounts/assertions; scope in-scope apps/DB/OS/infra; map to 4 ITGC domains: Access, Change, Development, Operations",
        "deliverables": [
          "ICFR scoping memo",
          "In-scope systems inventory",
          "Materiality & risk assessment",
          "IT risk-and-control matrix (skeleton)"
        ],
        "evidence": [
          "FS-to-IT-system mapping",
          "Application-to-account (IPE) linkage",
          "Entity-level control inventory"
        ],
        "owner": "SOX PMO / Internal Audit",
        "ext": false
      },
      {
        "n": 2,
        "name": "Control Documentation (RCM & Narratives)",
        "coverage": "Document ITGCs across all 4 domains (provisioning/deprovisioning, privileged access, access reviews, SoD, change mgmt, SDLC, job scheduling/backups)",
        "deliverables": [
          "Risk & Control Matrix (RCM)",
          "ITGC narratives & flowcharts",
          "ELC narratives",
          "Segregation-of-Duties matrix"
        ],
        "evidence": [
          "Walkthrough documentation",
          "Control descriptions with owner/frequency",
          "IPE completeness & accuracy docs"
        ],
        "owner": "Process/control owners & SOX PMO",
        "ext": false
      },
      {
        "n": 3,
        "name": "Design Effectiveness Testing",
        "coverage": "Walkthroughs/test-of-one to confirm each ITGC is designed to prevent/detect misstatement; validate IPE reliability",
        "deliverables": [
          "Walkthrough workpapers",
          "Design effectiveness conclusions",
          "Design-deficiency log"
        ],
        "evidence": [
          "Single-instance samples (one change, one access grant, one backup)",
          "Config screenshots",
          "Approval trails"
        ],
        "owner": "Internal Audit / SOX testing",
        "ext": false
      },
      {
        "n": 4,
        "name": "Operating Effectiveness Testing",
        "coverage": "Sample-based period testing: access reviews & terminations, change approvals/testing, dev sign-offs, batch/backup logs; automated-control benchmarking",
        "deliverables": [
          "Test-of-controls workpapers",
          "Interim + year-end roll-forward results",
          "Benchmarking documentation"
        ],
        "evidence": [
          "Sampled change tickets & approvals",
          "Access review attestations",
          "Privileged-access logs",
          "Backup success reports"
        ],
        "owner": "Internal Audit / SOX testing",
        "ext": false
      },
      {
        "n": 5,
        "name": "Deficiency Evaluation & Remediation",
        "coverage": "Classify exceptions (Deficiency / Significant Deficiency / Material Weakness); assess aggregation; remediate & retest",
        "deliverables": [
          "Deficiency & severity assessment",
          "Remediation plans & retest results",
          "Management deficiency summary"
        ],
        "evidence": [
          "Root-cause analysis",
          "Compensating-control evidence",
          "Retest workpapers"
        ],
        "owner": "SOX PMO / control owners",
        "ext": false
      },
      {
        "n": 6,
        "name": "Management Assertion (302/404a)",
        "coverage": "Management concludes on ICFR effectiveness; CEO/CFO certify quarterly (302) & annually (404a)",
        "deliverables": [
          "Management's Report on ICFR (10-K)",
          "302 quarterly certifications",
          "404a annual assessment"
        ],
        "evidence": [
          "Sub-certifications from process owners",
          "Consolidated testing & deficiency conclusions",
          "Representation letter"
        ],
        "owner": "CEO & CFO (Audit Committee oversight)",
        "ext": false
      },
      {
        "n": 7,
        "name": "External Auditor Integrated Audit (404b)",
        "coverage": "Registered firm performs integrated audit (AS 2201): independently tests ELCs & ITGCs, evaluates reliance, issues ICFR opinion",
        "deliverables": [
          "External auditor ICFR opinion (10-K)",
          "Financial statement audit report",
          "Deficiency communication to Audit Committee"
        ],
        "evidence": [
          "Independent re-performance & sampling",
          "Review of management testing",
          "Reliance-decision workpapers"
        ],
        "owner": "Independent external auditor (PCAOB)",
        "ext": true
      }
    ],
    "loopback": {
      "label": "Annual ICFR cycle (interim + roll-forward)",
      "from": 7,
      "to": 1
    },
    "match": [
      "sox"
    ]
  },
  {
    "id": "hipaa",
    "name": "HIPAA Security & Privacy Rule (HHS)",
    "version": "2024",
    "controls": 67,
    "group": "US Regulatory & Audit",
    "region": "United States",
    "authority": "HHS Office for Civil Rights (OCR)",
    "assessmentType": "Regulatory obligation; self-assessment with OCR enforcement/audit (no periodic certificate)",
    "cycle": "Continuous; risk analysis updated on material change; breach reporting deadlines",
    "phases": [
      {
        "n": 1,
        "name": "Risk Analysis & Risk Management",
        "coverage": "164.308(a)(1) Security Management Process: accurate/thorough risk analysis of all ePHI; risk management; assign Security & Privacy Officials",
        "deliverables": [
          "Security Risk Analysis (SRA) report",
          "Risk management plan",
          "ePHI asset inventory & data flow map",
          "Designated Security/Privacy Officials"
        ],
        "evidence": [
          "Threat & vulnerability register",
          "ePHI system inventory",
          "Prior assessments & remediation"
        ],
        "owner": "Security Official / Privacy Official",
        "ext": false
      },
      {
        "n": 2,
        "name": "Administrative Safeguards (164.308)",
        "coverage": "Workforce security, information access mgmt, awareness & training, incident procedures, contingency plan, periodic evaluation",
        "deliverables": [
          "Administrative safeguards policies",
          "Workforce sanction policy",
          "Awareness training program",
          "Contingency/DR & backup plan",
          "Incident response procedures"
        ],
        "evidence": [
          "Training completion records",
          "Access authorization & sanction records",
          "Contingency plan test results"
        ],
        "owner": "Security Official / HR / Compliance",
        "ext": false
      },
      {
        "n": 3,
        "name": "Physical & Technical Safeguards (164.310/312)",
        "coverage": "Physical: facility access, workstation, device & media controls. Technical: access control (unique ID, auto logoff, encryption), audit controls, integrity, authentication, transmission security",
        "deliverables": [
          "Facility security plan",
          "Device & media disposal policy",
          "Access control & authentication config",
          "Audit logging & encryption standards"
        ],
        "evidence": [
          "Badge/facility access logs",
          "Audit log samples",
          "Encryption configs (rest/transit)",
          "Media sanitization records"
        ],
        "owner": "IT Security / Facilities",
        "ext": false
      },
      {
        "n": 4,
        "name": "Privacy Rule, Documentation & BAAs",
        "coverage": "164.500-534 Privacy Rule: NPP, minimum-necessary, individual rights; 164.316 documentation (6-yr retention); 164.314 Business Associate Agreements",
        "deliverables": [
          "Notice of Privacy Practices (NPP)",
          "Executed Business Associate Agreements",
          "Privacy & minimum-necessary procedures",
          "6-year documentation retention"
        ],
        "evidence": [
          "Signed BAAs with associates/subcontractors",
          "Patient rights request logs",
          "Authorization forms"
        ],
        "owner": "Privacy Official / Legal",
        "ext": false
      },
      {
        "n": 5,
        "name": "Breach Notification (Subpart D)",
        "coverage": "164.402 4-factor breach risk assessment; individual notice (164.404) & HHS/media notice within 60 days for >=500; annual log for <500; BA notice to CE",
        "deliverables": [
          "Breach risk assessment",
          "Individual notification letters",
          "HHS OCR breach report",
          "Media notice (>=500); annual log (<500)"
        ],
        "evidence": [
          "4-factor risk assessment",
          "Notification logs & timestamps",
          "OCR portal submission confirmation"
        ],
        "owner": "Privacy Official / Incident Response",
        "ext": false
      },
      {
        "n": 6,
        "name": "Ongoing Evaluation & Monitoring",
        "coverage": "164.308(a)(8) periodic technical/non-technical evaluation on change; ongoing training, access reviews, audit-log monitoring",
        "deliverables": [
          "Periodic evaluation reports",
          "Updated risk analysis",
          "Corrective action plans",
          "Refreshed training records"
        ],
        "evidence": [
          "Audit log reviews",
          "Access recertifications",
          "Vulnerability scan/pentest results"
        ],
        "owner": "Security & Privacy Officials",
        "ext": false
      },
      {
        "n": 7,
        "name": "OCR Audit / Enforcement Response",
        "coverage": "Respond to OCR compliance reviews, HIPAA Audit Program, or breach investigations; negotiate Resolution Agreement / CAP if violations found",
        "deliverables": [
          "OCR request responses",
          "Compliance attestation package",
          "Resolution Agreement & Corrective Action Plan (if applicable)"
        ],
        "evidence": [
          "Risk analysis & safeguards produced to OCR",
          "Policies, training, BAAs, breach records",
          "Evidence of remediation under CAP"
        ],
        "owner": "Compliance / Legal / Security Official",
        "ext": true
      }
    ],
    "loopback": {
      "label": "Continuous compliance — periodic re-evaluation",
      "from": 7,
      "to": 1
    },
    "match": [
      "hipaa"
    ]
  },
  {
    "id": "pcidss",
    "name": "PCI DSS — Payment Card Data Security",
    "version": "4.0.1",
    "controls": 205,
    "group": "US Regulatory & Audit",
    "region": "United States (global card brands)",
    "authority": "PCI SSC (standard) & acquiring bank / card brands; QSA or ISA validation",
    "assessmentType": "Report on Compliance (RoC) by QSA (L1) or SAQ (self); plus Attestation of Compliance (AoC)",
    "cycle": "Annual validation + quarterly ASV scans; periodic activities via Targeted Risk Analysis",
    "phases": [
      {
        "n": 1,
        "name": "Scope the Cardholder Data Environment",
        "coverage": "Req 12.5.2: identify all systems/people/processes storing/processing/transmitting CHD or SAD + connected systems; set level & SAQ type",
        "deliverables": [
          "Documented CDE scope",
          "Data flow diagrams (CHD flows)",
          "Network segmentation docs",
          "Level & SAQ-type selection"
        ],
        "evidence": [
          "Cardholder data inventory",
          "Network diagrams",
          "Segmentation validation (pentest)"
        ],
        "owner": "Security/Compliance lead (with QSA)",
        "ext": false
      },
      {
        "n": 2,
        "name": "Gap Analysis vs the 12 Requirements",
        "coverage": "Assess vs 12 requirements in 6 goals: Secure Networks (1-2), Protect Account Data (3-4), Vuln Mgmt (5-6), Access Control (7-9), Monitor & Test (10-11), Security Policy (12)",
        "deliverables": [
          "Gap assessment report",
          "Remediation roadmap",
          "Requirement-to-control mapping",
          "Targeted Risk Analyses (12.3.1)"
        ],
        "evidence": [
          "Current configs vs requirements",
          "Existing policies",
          "Prior scan history"
        ],
        "owner": "Security/GRC team (with QSA readiness)",
        "ext": false
      },
      {
        "n": 3,
        "name": "Implement & Remediate Controls",
        "coverage": "Network security & config (1-2), encryption at rest/in transit (3-4), anti-malware & secure software (5-6), MFA & physical access (7-9), logging (10-11), governance (12); new 4.x items (payment-page scripts, expanded MFA)",
        "deliverables": [
          "Information security policy set (Req 12)",
          "Configuration standards",
          "Key mgmt & encryption",
          "MFA deployment",
          "Payment-page change detection"
        ],
        "evidence": [
          "Config baselines",
          "Encryption & key mgmt records",
          "Access & MFA settings",
          "Patch & anti-malware records"
        ],
        "owner": "IT/Security engineering",
        "ext": false
      },
      {
        "n": 4,
        "name": "Ongoing Testing — ASV Scans & Pentest",
        "coverage": "Req 11.3.2 quarterly external ASV scans (passing); internal scans (11.3.1); annual & post-change pentest (11.4) + segmentation testing",
        "deliverables": [
          "Passing quarterly ASV scan reports",
          "Internal scan reports",
          "Penetration test reports",
          "Segmentation test results"
        ],
        "evidence": [
          "4 consecutive passing quarters",
          "Remediation/rescan records",
          "Pentest findings & remediation"
        ],
        "owner": "Security ops / ASV / pentest provider",
        "ext": false
      },
      {
        "n": 5,
        "name": "Formal Assessment — RoC (QSA) or SAQ",
        "coverage": "L1: on-site/remote QSA assessment producing RoC over all 12 reqs; L2-4: applicable SAQ; each req marked In Place / N-A / Not Tested / Not in Place",
        "deliverables": [
          "Report on Compliance (RoC) — QSA",
          "Self-Assessment Questionnaire (SAQ)",
          "Evidence sampling workpapers"
        ],
        "evidence": [
          "Sampled configs, logs, tickets, policies",
          "Interviews & observations",
          "Screenshots supporting each control"
        ],
        "owner": "QSA/ISA (RoC) or merchant (SAQ)",
        "ext": true
      },
      {
        "n": 6,
        "name": "Attestation of Compliance & Submission",
        "coverage": "Sign AoC confirming status across 12 reqs; submit RoC/SAQ + AoC + ASV scans to acquirer / card brands",
        "deliverables": [
          "Signed Attestation of Compliance (AoC)",
          "Submission package to acquirer",
          "Executive compliance summary"
        ],
        "evidence": [
          "Final RoC/SAQ",
          "Passing ASV attestation",
          "Merchant/QSA signatures"
        ],
        "owner": "Executive sponsor + QSA (co-sign)",
        "ext": false
      },
      {
        "n": 7,
        "name": "Business-as-Usual & Annual Revalidation",
        "coverage": "Maintain BAU (Req 12); periodic access/log reviews (TRA frequencies); continue quarterly ASV; re-scope & re-validate annually",
        "deliverables": [
          "Annual scope reconfirmation",
          "Quarterly ASV cadence",
          "Updated policies & TRAs",
          "Next-cycle RoC/SAQ + AoC"
        ],
        "evidence": [
          "Continuous monitoring logs",
          "Periodic access & firewall reviews",
          "Recurring training & scans"
        ],
        "owner": "Security/Compliance team",
        "ext": false
      }
    ],
    "loopback": {
      "label": "Annual revalidation + BAU (quarterly ASV)",
      "from": 7,
      "to": 1
    },
    "match": [
      "pcidss",
      "pcidata",
      "paymentcard"
    ]
  },
  {
    "id": "gdpr",
    "name": "GDPR — General Data Protection Regulation",
    "version": "2016/679",
    "controls": 41,
    "group": "European Union",
    "region": "European Union",
    "authority": "National Data Protection Authorities; EDPB; lead DPA (one-stop-shop)",
    "assessmentType": "Regulatory compliance / DPA enforcement (accountability-based)",
    "cycle": "Ongoing",
    "phases": [
      {
        "n": 1,
        "name": "Data Mapping & Lawful Basis",
        "coverage": "Art.5 principles; Art.6 lawful basis; Art.9 special categories; Art.7 consent conditions",
        "deliverables": [
          "Data inventory / data flow maps",
          "Lawful basis register per activity",
          "Consent records & design",
          "Legitimate Interests Assessment (LIA)"
        ],
        "evidence": [
          "Data mapping spreadsheets",
          "Lawful-basis justification memos",
          "Consent capture logs"
        ],
        "owner": "Data Protection Officer (DPO)",
        "ext": false
      },
      {
        "n": 2,
        "name": "Records of Processing (Art.30) & Governance",
        "coverage": "Art.30 ROPA (controller & processor); Art.37-39 DPO; Art.24 controller responsibility; Art.26 joint controllers",
        "deliverables": [
          "Records of Processing Activities (ROPA)",
          "DPO appointment & mandate",
          "Privacy governance / RACI",
          "Data retention schedule"
        ],
        "evidence": [
          "Completed Art.30 register",
          "DPO appointment published to DPA",
          "Retention policy"
        ],
        "owner": "Data Protection Officer (DPO)",
        "ext": false
      },
      {
        "n": 3,
        "name": "Risk Assessment & DPIA (Art.35)",
        "coverage": "Art.35 DPIA for high-risk; Art.36 prior consultation with DPA; Art.25 data protection by design & default; Art.32 security",
        "deliverables": [
          "DPIA reports",
          "Data protection by design & default controls",
          "Prior consultation request (residual high risk)",
          "TOMs register"
        ],
        "evidence": [
          "Signed DPIA outcomes",
          "Risk treatment plans",
          "Prior consultation correspondence"
        ],
        "owner": "DPO with process owners",
        "ext": false
      },
      {
        "n": 4,
        "name": "International Transfers & Processor Governance",
        "coverage": "Chapter V Art.44-49; Art.45 adequacy; Art.46 SCCs/BCRs; Transfer Impact Assessment (Schrems II); Art.28 processor DPAs",
        "deliverables": [
          "Standard Contractual Clauses / BCRs",
          "Transfer Impact Assessments (TIAs)",
          "Art.28 Data Processing Agreements",
          "Sub-processor register"
        ],
        "evidence": [
          "Executed SCCs & TIA docs",
          "Signed DPAs",
          "Adequacy mapping per country"
        ],
        "owner": "DPO / Legal & Procurement",
        "ext": false
      },
      {
        "n": 5,
        "name": "Data Subject Rights & Transparency",
        "coverage": "Art.12-22 rights (access, rectification, erasure, restriction, portability, objection, automated decisions); Art.13-14 privacy notices",
        "deliverables": [
          "DSAR handling workflow (1-month SLA)",
          "Privacy notices (Art.13/14)",
          "Cookie / consent banner",
          "Rights request log"
        ],
        "evidence": [
          "DSAR responses within deadline",
          "Published privacy notices",
          "Rights fulfilment audit trail"
        ],
        "owner": "DPO / Privacy Operations",
        "ext": false
      },
      {
        "n": 6,
        "name": "Breach Detection & Notification (Art.33/34)",
        "coverage": "Art.33 notify Supervisory Authority within 72h; Art.34 communicate to data subjects (high-risk); Art.33(5) internal documentation",
        "deliverables": [
          "Personal data breach register",
          "72-hour DPA notification template",
          "Data-subject breach communication",
          "Incident/breach playbook"
        ],
        "evidence": [
          "Breach register entries",
          "Timestamped DPA notifications",
          "Root cause & remediation reports"
        ],
        "owner": "DPO / CISO / Incident Response",
        "ext": true
      },
      {
        "n": 7,
        "name": "Ongoing Monitoring, Audit & Accountability",
        "coverage": "Art.5(2)/24 accountability; Art.32 ongoing testing; Art.39 DPO monitoring & DPIA review; Art.40 codes / Art.42 certification",
        "deliverables": [
          "Annual privacy audit report",
          "DPIA & ROPA review updates",
          "Training & awareness records",
          "Management accountability report"
        ],
        "evidence": [
          "Audit findings & corrective actions",
          "Updated ROPA/DPIA versions",
          "Training completion logs"
        ],
        "owner": "DPO / Internal Audit",
        "ext": false
      }
    ],
    "loopback": {
      "label": "Continuous accountability & re-assessment",
      "from": 7,
      "to": 1
    },
    "match": [
      "gdpr",
      "generaldataprotection"
    ]
  },
  {
    "id": "dora",
    "name": "DORA — Digital Operational Resilience Act",
    "version": "EU 2022/2554",
    "controls": 54,
    "group": "European Union",
    "region": "European Union",
    "authority": "ESAs (EBA/ESMA/EIOPA) & national competent authorities; Oversight of critical ICT third-party providers",
    "assessmentType": "Supervisory oversight; RTS/ITS conformance; Register of Information; TLPT attestation",
    "cycle": "Ongoing; TLPT every 3 years",
    "phases": [
      {
        "n": 1,
        "name": "ICT Risk Management Framework (Pillar 1)",
        "coverage": "Art.5-16: management-body accountability; ICT risk framework, protection, detection, response & recovery, backup, learning",
        "deliverables": [
          "ICT risk management framework",
          "ICT asset & dependency inventory",
          "Business impact analysis",
          "ICT BC & disaster recovery policy"
        ],
        "evidence": [
          "Board-approved framework",
          "Risk appetite statement",
          "BCP/DR plans"
        ],
        "owner": "Management body / ICT risk function",
        "ext": false
      },
      {
        "n": 2,
        "name": "ICT Third-Party Risk & Register (Pillar 4)",
        "coverage": "Art.28-30: Register of Information (ITS template); concentration risk; mandatory contract clauses (Art.30); critical-function mapping; CTPP oversight",
        "deliverables": [
          "Register of Information (ITS-templated)",
          "ICT third-party risk policy",
          "Contract clauses per Art.30",
          "Exit strategies & concentration assessments"
        ],
        "evidence": [
          "Submitted Register of Information",
          "Signed contracts with DORA clauses",
          "Vendor due-diligence records"
        ],
        "owner": "ICT risk function / Third-Party Risk",
        "ext": false
      },
      {
        "n": 3,
        "name": "Protection & Operational Controls",
        "coverage": "Art.9 protection/prevention; Art.10 detection; Art.11-12 response, recovery & backup; IAM, encryption, vuln mgmt (RTS)",
        "deliverables": [
          "ICT security policies",
          "Access & identity management design",
          "Backup, restoration & redundancy",
          "Vulnerability & patch management"
        ],
        "evidence": [
          "Config & control records",
          "Backup/restore test logs",
          "Vulnerability scan reports"
        ],
        "owner": "CISO / ICT operations",
        "ext": false
      },
      {
        "n": 4,
        "name": "Incident Management & Reporting (Pillar 2)",
        "coverage": "Art.17-23: classification criteria (clients affected, loss, duration, spread, data loss, criticality); NCA reporting — initial, intermediate, final",
        "deliverables": [
          "ICT incident management process",
          "Classification matrix (major vs non-major)",
          "Initial / intermediate / final report templates",
          "Cyber-threat voluntary notification"
        ],
        "evidence": [
          "Incident register",
          "Timestamped NCA submissions (initial ~24h, intermediate ~72h, final ~1 month)",
          "Root cause reports"
        ],
        "owner": "CISO / Incident response",
        "ext": true
      },
      {
        "n": 5,
        "name": "Resilience Testing & TLPT (Pillar 3)",
        "coverage": "Art.24-27: basic testing (VA, pentest, scenario) + advanced Threat-Led Penetration Testing every 3 years (TIBER-EU-aligned)",
        "deliverables": [
          "Resilience testing programme & plan",
          "TLPT scope & red-team engagement",
          "Test results & remediation",
          "TLPT attestation"
        ],
        "evidence": [
          "Pen/vuln test reports",
          "TLPT final report & CA attestation",
          "Remediation tracking"
        ],
        "owner": "CISO / TLPT team (external red team)",
        "ext": true
      },
      {
        "n": 6,
        "name": "Information & Intelligence Sharing (Pillar 5)",
        "coverage": "Art.45: voluntary cyber-threat intelligence exchange within trusted communities; integrate CTI into risk framework",
        "deliverables": [
          "Threat-intelligence sharing arrangement",
          "CTI integration into risk process",
          "Information-sharing governance"
        ],
        "evidence": [
          "Sharing agreement records",
          "CTI feeds & analysis logs",
          "Trusted-community participation"
        ],
        "owner": "CISO / Threat Intelligence",
        "ext": false
      },
      {
        "n": 7,
        "name": "Supervisory Review & Improvement",
        "coverage": "Art.5-6 management oversight & annual review; Art.13 learning & evolving; supervisory dialogue with NCAs/ESAs",
        "deliverables": [
          "Annual framework review report",
          "Management-body resilience report",
          "Lessons-learned register",
          "Updated Register of Information"
        ],
        "evidence": [
          "Board review minutes",
          "Supervisory correspondence",
          "Updated framework versions"
        ],
        "owner": "Management body / ICT risk function",
        "ext": false
      }
    ],
    "loopback": {
      "label": "Continuous ICT risk monitoring & lessons learned",
      "from": 7,
      "to": 1
    },
    "match": [
      "dora",
      "digitaloperationalresilience"
    ]
  },
  {
    "id": "nis2",
    "name": "NIS2 Directive",
    "version": "EU 2022/2555",
    "controls": 47,
    "group": "European Union",
    "region": "European Union",
    "authority": "National competent authorities & CSIRTs; ENISA; national transposition laws",
    "assessmentType": "Regulatory compliance / supervision (ex-ante essential, ex-post important)",
    "cycle": "Ongoing",
    "phases": [
      {
        "n": 1,
        "name": "Entity Classification & Registration",
        "coverage": "Annex I & II sectors; size-cap rule; essential vs important (Art.3); registration duties (Art.27) to competent authority / ENISA",
        "deliverables": [
          "Entity scoping & classification",
          "Registration submission (Art.3/27)",
          "Sector & criticality mapping"
        ],
        "evidence": [
          "Classification memo",
          "Registration confirmation",
          "Scope of in-scope services"
        ],
        "owner": "CISO / Compliance & Legal",
        "ext": false
      },
      {
        "n": 2,
        "name": "Governance & Management Accountability",
        "coverage": "Art.20: management bodies approve & oversee risk measures and can be held liable; mandatory cyber training for management",
        "deliverables": [
          "Management approval of risk measures",
          "Governance charter & RACI",
          "Management cyber training records"
        ],
        "evidence": [
          "Signed management approval",
          "Training completion logs",
          "Accountability documentation"
        ],
        "owner": "Management body / Board with CISO",
        "ext": false
      },
      {
        "n": 3,
        "name": "Risk Assessment & Art.21 Measures",
        "coverage": "Art.21(2) 10 measures: risk analysis & policies; incident handling; BC/backup/crisis; supply chain; secure acquisition/dev & vuln disclosure; effectiveness assessment; cyber hygiene & training; cryptography; HR/access/asset; MFA & secure comms",
        "deliverables": [
          "Risk assessment & ISMS-style policies",
          "BC & crisis management plan",
          "Supply chain security policy",
          "Access, cryptography & MFA controls"
        ],
        "evidence": [
          "Risk register & treatment",
          "Implemented control records",
          "Supply-chain assessments"
        ],
        "owner": "CISO / Security & Risk",
        "ext": false
      },
      {
        "n": 4,
        "name": "Incident Detection & Reporting (Art.23)",
        "coverage": "Art.23 significant-incident reporting to CSIRT/authority: early warning 24h, notification 72h, final report 1 month; recipient notification",
        "deliverables": [
          "Incident detection capability",
          "24h / 72h / 1-month report templates",
          "Significant-incident criteria",
          "Recipient notification process"
        ],
        "evidence": [
          "Incident register",
          "Timestamped CSIRT submissions",
          "Final report with root cause"
        ],
        "owner": "CISO / SOC / Incident Response",
        "ext": true
      },
      {
        "n": 5,
        "name": "Supply Chain & Third-Party Security",
        "coverage": "Art.21(2)(d) supply chain security; Art.22 EU-coordinated risk assessments of critical supply chains; vuln handling in procurement",
        "deliverables": [
          "Supplier security requirements & clauses",
          "Third-party risk assessments",
          "Coordinated supply-chain considerations"
        ],
        "evidence": [
          "Vendor assessment records",
          "Contractual security clauses",
          "Supplier monitoring"
        ],
        "owner": "CISO / Procurement",
        "ext": false
      },
      {
        "n": 6,
        "name": "Supervision, Audits & Enforcement",
        "coverage": "Art.31-37: essential entities ex-ante (audits, inspections, scans), important ex-post; enforcement measures; Art.34 fines",
        "deliverables": [
          "Compliance evidence package",
          "Security audit / assessment reports",
          "Corrective action plans"
        ],
        "evidence": [
          "Audit & inspection outcomes",
          "Remediation tracking",
          "Supervisory correspondence"
        ],
        "owner": "CISO / Internal Audit",
        "ext": true
      },
      {
        "n": 7,
        "name": "Continuous Monitoring & Improvement",
        "coverage": "Art.21(1) all-hazards & proportionality; ongoing effectiveness assessment (21(2)(f)); policy review & training refresh",
        "deliverables": [
          "Effectiveness assessment reports",
          "Updated policies & measures",
          "Ongoing awareness training"
        ],
        "evidence": [
          "Control effectiveness metrics",
          "Updated policy versions",
          "Monitoring dashboards"
        ],
        "owner": "CISO / Security & Risk",
        "ext": false
      }
    ],
    "loopback": {
      "label": "All-hazards continuous risk management",
      "from": 7,
      "to": 3
    },
    "match": [
      "nis2"
    ]
  },
  {
    "id": "cisv8",
    "name": "CIS Critical Security Controls v8",
    "version": "8.0",
    "controls": 153,
    "group": "Cross-Industry Cyber / Cloud",
    "region": "International",
    "authority": "Center for Internet Security (voluntary); self-assessment via CSAT",
    "assessmentType": "Self-assessment (IG1/IG2/IG3; CSAT scoring; optional 3rd-party gap assessment)",
    "cycle": "Ongoing",
    "phases": [
      {
        "n": 1,
        "name": "Implementation Group Selection & Scoping",
        "coverage": "IG1 (56 foundational safeguards), IG2 (up to 130), IG3 (all 153); risk profile, resources & data sensitivity set the tier",
        "deliverables": [
          "IG1/IG2/IG3 determination",
          "Scope & applicability statement",
          "Risk-profile assessment"
        ],
        "evidence": [
          "Documented IG rationale",
          "Enterprise risk & resource assessment"
        ],
        "owner": "CISO / Security program lead",
        "ext": false
      },
      {
        "n": 2,
        "name": "Asset & Data Inventory (Controls 1-3)",
        "coverage": "Control 1 Enterprise Assets; Control 2 Software Assets; Control 3 Data Protection (inventory, classification, retention)",
        "deliverables": [
          "Hardware asset inventory",
          "Software inventory & allowlisting",
          "Data classification & handling",
          "Data management process"
        ],
        "evidence": [
          "Asset discovery scans",
          "Software inventory reports",
          "Data classification records"
        ],
        "owner": "IT Operations / Security",
        "ext": false
      },
      {
        "n": 3,
        "name": "Baseline Config & Access (Controls 4-6)",
        "coverage": "Control 4 Secure Configuration (CIS Benchmarks); Control 5 Account Management; Control 6 Access Control (MFA, least privilege)",
        "deliverables": [
          "Secure configuration baselines",
          "Account management process",
          "Access control & MFA policy",
          "Privileged access management"
        ],
        "evidence": [
          "Config compliance vs Benchmarks",
          "Account & access review logs",
          "MFA enforcement records"
        ],
        "owner": "IT / IAM team",
        "ext": false
      },
      {
        "n": 4,
        "name": "Protective Controls (Controls 7-15)",
        "coverage": "7 Vuln Mgmt; 8 Audit Logs; 9 Email/Web; 10 Malware; 11 Data Recovery; 12 Network Infra; 13 Network Monitoring; 14 Awareness Training; 15 Service Provider Mgmt",
        "deliverables": [
          "Vulnerability management program",
          "Centralized audit logging",
          "Malware & email/web protections",
          "Backup & data recovery",
          "Awareness training",
          "Service-provider inventory"
        ],
        "evidence": [
          "Vuln scan & remediation logs",
          "Log retention records",
          "Backup/restore tests",
          "Training records"
        ],
        "owner": "Security operations / IT",
        "ext": false
      },
      {
        "n": 5,
        "name": "Detection & Response (Controls 16-18)",
        "coverage": "Control 16 Application Software Security; Control 17 Incident Response; Control 18 Penetration Testing",
        "deliverables": [
          "Secure SDLC / AppSec process",
          "Incident response plan & personnel",
          "Penetration testing program"
        ],
        "evidence": [
          "AppSec/secure SDLC records",
          "IR tabletop results",
          "Pentest reports & remediation"
        ],
        "owner": "CISO / AppSec & IR teams",
        "ext": false
      },
      {
        "n": 6,
        "name": "Safeguard Measurement & Scoring",
        "coverage": "Per-safeguard scoring across the 153 safeguards using CIS CSAT & Controls Assessment Specification; map to target IG",
        "deliverables": [
          "Safeguard mapping & scorecard",
          "CSAT assessment results",
          "Gap analysis vs target IG",
          "Prioritized remediation roadmap"
        ],
        "evidence": [
          "CSAT scoring reports",
          "Safeguard-level evidence",
          "Gap register"
        ],
        "owner": "Security program lead / GRC",
        "ext": false
      },
      {
        "n": 7,
        "name": "Continuous Monitoring & Maturation",
        "coverage": "Ongoing metrics; periodic reassessment; progress IG1->IG2->IG3; map to NIST CSF/ISO 27001",
        "deliverables": [
          "Periodic CSAT reassessment",
          "Metrics & KPI dashboard",
          "Updated roadmap",
          "Cross-framework mapping"
        ],
        "evidence": [
          "Maturity trend reports",
          "Reassessment scorecards",
          "Monitoring evidence"
        ],
        "owner": "CISO / GRC & Security ops",
        "ext": false
      }
    ],
    "loopback": {
      "label": "Continuous measurement & IG progression",
      "from": 7,
      "to": 2
    },
    "match": [
      "ciscritical",
      "criticalsecuritycontrols"
    ]
  },
  {
    "id": "csaccm",
    "name": "CSA Cloud Controls Matrix (CCM)",
    "version": "4.0",
    "controls": 197,
    "group": "Cross-Industry Cyber / Cloud",
    "region": "International",
    "authority": "Cloud Security Alliance; STAR Registry; STAR L2 via accredited assessors",
    "assessmentType": "Self-assessment (STAR L1 CAIQ) + 3rd-party audit (STAR L2 Certification vs ISO 27001 or Attestation vs SOC 2)",
    "cycle": "Ongoing; annual surveillance/renewal",
    "phases": [
      {
        "n": 1,
        "name": "Scoping & Shared Responsibility Mapping",
        "coverage": "17 CCM domains (A&A, AIS, IAM, GRC, DSP, TVM...); cloud service/deployment model scoping; Shared Security Responsibility Model (SSRM)",
        "deliverables": [
          "Cloud service scope",
          "SSRM matrix",
          "Applicability mapping across 17 domains"
        ],
        "evidence": [
          "Scope & architecture docs",
          "SSRM allocation per control",
          "Service/deployment inventory"
        ],
        "owner": "CISO / Cloud security architect",
        "ext": false
      },
      {
        "n": 2,
        "name": "Control Implementation (17 Domains)",
        "coverage": "Implement 197 control specs across all 17 domains; CCM Implementation & Auditing Guidelines; ownership per SSRM",
        "deliverables": [
          "Control implementation records per domain",
          "Policies mapped to CCM",
          "Cloud security architecture"
        ],
        "evidence": [
          "Implemented configurations",
          "Policy documentation",
          "Control ownership register"
        ],
        "owner": "CISO / Cloud engineering & GRC",
        "ext": false
      },
      {
        "n": 3,
        "name": "CAIQ Self-Assessment",
        "coverage": "Consensus Assessment Initiative Questionnaire (CAIQ v4) mapped 1:1 to CCM controls; document implementation & SSRM per question",
        "deliverables": [
          "Completed CAIQ v4",
          "Control gap analysis",
          "Remediation plan"
        ],
        "evidence": [
          "CAIQ responses with justifications",
          "Gap register",
          "Supporting evidence per answer"
        ],
        "owner": "GRC / Compliance lead",
        "ext": false
      },
      {
        "n": 4,
        "name": "STAR Level 1 Submission",
        "coverage": "STAR Program L1 (self-assessment): publish completed CAIQ to the public CSA STAR Registry",
        "deliverables": [
          "STAR L1 registry submission (CAIQ)",
          "Public STAR Registry entry",
          "Self-assessment attestation"
        ],
        "evidence": [
          "STAR Registry listing",
          "Submitted CAIQ",
          "Internal sign-off"
        ],
        "owner": "GRC / Compliance lead",
        "ext": false
      },
      {
        "n": 5,
        "name": "STAR Level 2 3rd-Party Assessment",
        "coverage": "STAR L2: STAR Certification (ISO 27001 + CCM maturity) or STAR Attestation (SOC 2 + CCM) or C-STAR; independent auditor validates effectiveness",
        "deliverables": [
          "Audit-ready evidence package",
          "STAR Certification / Attestation report",
          "Maturity scoring",
          "L2 STAR Registry entry"
        ],
        "evidence": [
          "Third-party audit report",
          "Auditor certificate/attestation",
          "Nonconformity & corrective actions"
        ],
        "owner": "External accredited assessor (cert body / CPA)",
        "ext": true
      },
      {
        "n": 6,
        "name": "Registry Publication & Customer Assurance",
        "coverage": "Publish to STAR Registry (L1/L2); enable customer due diligence; CCM/CAIQ used in vendor risk assessments",
        "deliverables": [
          "Public STAR Registry listing",
          "Customer-facing assurance package",
          "Vendor assessment responses"
        ],
        "evidence": [
          "STAR Registry public entry",
          "Shared CAIQ/audit reports",
          "Trust portal artifacts"
        ],
        "owner": "GRC / Trust & Compliance",
        "ext": false
      },
      {
        "n": 7,
        "name": "Continuous Monitoring & Renewal",
        "coverage": "Ongoing monitoring; STAR Continuous (where adopted); annual surveillance & recertification; CCM/CAIQ version updates",
        "deliverables": [
          "Surveillance/renewal audit reports",
          "Updated CAIQ & mappings",
          "Continuous monitoring metrics",
          "Recertification"
        ],
        "evidence": [
          "Surveillance outcomes",
          "Updated STAR entry",
          "Monitoring dashboards"
        ],
        "owner": "CISO / GRC",
        "ext": false
      }
    ],
    "loopback": {
      "label": "Ongoing monitoring & STAR renewal",
      "from": 7,
      "to": 2
    },
    "match": [
      "csacloud",
      "cloudcontrolsmatrix",
      "csaccm"
    ]
  },
  {
    "id": "hitrust",
    "name": "HITRUST CSF",
    "version": "11.4.0",
    "controls": 156,
    "group": "Cross-Industry Cyber / Cloud",
    "region": "International",
    "authority": "HITRUST Alliance; Authorized External Assessors; HITRUST QA",
    "assessmentType": "Validated assessment + certification via MyCSF (e1 1-yr, i1 1-yr, r2 2-yr); PRISMA 1-5 maturity",
    "cycle": "e1/i1 annual; r2 2-year with interim",
    "phases": [
      {
        "n": 1,
        "name": "Scoping, Factors & Inheritance",
        "coverage": "Define boundary; answer org/system/regulatory/geographic factors tailoring requirements across 19 domains; configure inheritance from certified providers",
        "deliverables": [
          "Assessment scope statement",
          "Selected tier (e1/i1/r2)",
          "Factor questionnaire responses",
          "Inheritance mapping"
        ],
        "evidence": [
          "Network/data-flow diagrams",
          "Asset & system inventory",
          "Shared-responsibility agreements"
        ],
        "owner": "Compliance / Security Lead",
        "ext": false
      },
      {
        "n": 2,
        "name": "MyCSF Assessment Object",
        "coverage": "MyCSF generates tailored set: e1 = 44 requirement statements, i1 = 182, r2 = risk-based, mapped to 19 domains / 156 CSF control references",
        "deliverables": [
          "MyCSF assessment object",
          "Tailored requirement list",
          "Mapping to authoritative sources (NIST/ISO/HIPAA/PCI)"
        ],
        "evidence": [
          "Requirement-to-control cross-reference"
        ],
        "owner": "HITRUST Program Owner",
        "ext": false
      },
      {
        "n": 3,
        "name": "Readiness / Gap Assessment",
        "coverage": "Self-assess maturity per requirement; for r2 score 5 PRISMA levels (Policy, Process, Implemented, Measured, Managed); find gaps below threshold",
        "deliverables": [
          "Readiness (gap) results",
          "Corrective Action Plans (CAPs)"
        ],
        "evidence": [
          "Draft policies & procedures",
          "Preliminary control evidence"
        ],
        "owner": "Program Owner (+ optional assessor)",
        "ext": false
      },
      {
        "n": 4,
        "name": "Remediation & Evidence Collection",
        "coverage": "Close gaps; collect & upload evidence per requirement statement across all applicable domains",
        "deliverables": [
          "Completed CAPs",
          "Uploaded evidence set",
          "Finalized control documentation"
        ],
        "evidence": [
          "Approved policies/procedures",
          "Config screenshots, logs, tickets, scans, training"
        ],
        "owner": "Control Owners / IT & Security",
        "ext": false
      },
      {
        "n": 5,
        "name": "Validated Assessment by External Assessor",
        "coverage": "Authorized External Assessor independently tests & validates each requirement, samples evidence, applies scoring in MyCSF",
        "deliverables": [
          "Validated MyCSF submission",
          "Assessor testing workpapers",
          "Assessor-validated scores"
        ],
        "evidence": [
          "Assessor test & sampling records",
          "Validated evidence artifacts"
        ],
        "owner": "HITRUST Authorized External Assessor",
        "ext": true
      },
      {
        "n": 6,
        "name": "HITRUST QA Review",
        "coverage": "HITRUST central QA checks scoring integrity, evidence sufficiency & consistency; may issue rework before finalizing",
        "deliverables": [
          "QA feedback / clarification requests",
          "Finalized scoring"
        ],
        "evidence": [
          "QA responses & supplemental evidence"
        ],
        "owner": "HITRUST QA Team",
        "ext": true
      },
      {
        "n": 7,
        "name": "Certification / Report Issuance",
        "coverage": "HITRUST issues e1 (1-yr), i1 (1-yr) or r2 (2-yr) certification with Letter of Certification & validated report",
        "deliverables": [
          "HITRUST Certification (e1/i1/r2)",
          "Validated Assessment Report",
          "Letter of Certification"
        ],
        "evidence": [
          "Final scored MyCSF object",
          "Certification letter"
        ],
        "owner": "HITRUST Alliance",
        "ext": true
      },
      {
        "n": 8,
        "name": "Monitoring, Interim & Re-certification",
        "coverage": "Maintain 19-domain controls; r2 interim assessment at ~12 months; re-certify (e1/i1 annual, r2 every 2 yrs)",
        "deliverables": [
          "r2 interim assessment",
          "Re-certification MyCSF object",
          "Updated CAPs"
        ],
        "evidence": [
          "Ongoing monitoring records",
          "Refreshed evidence"
        ],
        "owner": "HITRUST Program Owner",
        "ext": false
      }
    ],
    "loopback": {
      "label": "Interim (r2 yr-1) & re-certification",
      "from": 8,
      "to": 1
    },
    "match": [
      "hitrust"
    ]
  },
  {
    "id": "swift",
    "name": "SWIFT Customer Security Controls Framework (CSCF)",
    "version": "2024",
    "controls": 31,
    "group": "Cross-Industry Cyber / Cloud",
    "region": "International",
    "authority": "SWIFT Customer Security Programme (CSP); KYC-SA portal; independent assessors",
    "assessmentType": "Annual attestation + mandatory independent assessment, scoped by architecture type",
    "cycle": "Annual re-attestation (Jul-Dec window)",
    "phases": [
      {
        "n": 1,
        "name": "Architecture Type Determination & Scoping",
        "coverage": "Classify footprint: A1 (own messaging+comms), A2 (own messaging), A3 (SWIFT connector), A4 (customer connector), B (no local footprint); define secure zone",
        "deliverables": [
          "Architecture type (A1/A2/A3/A4/B)",
          "Defined SWIFT secure zone / scope diagram"
        ],
        "evidence": [
          "Network & data-flow diagrams of SWIFT components",
          "Connectivity inventory"
        ],
        "owner": "SWIFT / Payments Security Lead",
        "ext": false
      },
      {
        "n": 2,
        "name": "Applicable Controls Mapping",
        "coverage": "Map applicable mandatory + advisory controls (3 objectives, 7 principles): 1.x restrict access, 2.x reduce attack surface, 5.x manage identities, 6.x detect anomalies, 7.x incident response",
        "deliverables": [
          "Applicability matrix (controls per architecture)",
          "Control-to-scope mapping"
        ],
        "evidence": [
          "Documented applicability rationale"
        ],
        "owner": "CISO / SWIFT Security Officer",
        "ext": false
      },
      {
        "n": 3,
        "name": "Control Implementation & Remediation",
        "coverage": "Implement across 3 objectives (Secure Environment; Know & Limit Access; Detect & Respond); remediate vs mandatory baseline",
        "deliverables": [
          "Implemented controls",
          "Remediation plan"
        ],
        "evidence": [
          "Hardening, MFA/PAM, segmentation, logging/monitoring, IR plan"
        ],
        "owner": "IT / Security Operations",
        "ext": false
      },
      {
        "n": 4,
        "name": "Independent Assessment",
        "coverage": "Mandatory independent assessment of in-scope controls by internal 2nd/3rd line or external provider (Independent Assessment Framework)",
        "deliverables": [
          "Independent assessment report",
          "Control test results",
          "Assessment completion letter"
        ],
        "evidence": [
          "Assessor workpapers, sampling & testing per control"
        ],
        "owner": "Independent Assessor",
        "ext": true
      },
      {
        "n": 5,
        "name": "Attestation on KYC-SA",
        "coverage": "Complete annual compliance attestation per control on the KYC-Security Attestation (KYC-SA) app, referencing the independent assessment",
        "deliverables": [
          "Completed CSCF attestation on KYC-SA",
          "Attestation signed by senior management"
        ],
        "evidence": [
          "KYC-SA attestation record",
          "Independent assessment reference"
        ],
        "owner": "Senior Management / CSO",
        "ext": false
      },
      {
        "n": 6,
        "name": "Submission & Sharing with Counterparties",
        "coverage": "Publish attestation via KYC-SA and grant read access to counterparties/correspondents",
        "deliverables": [
          "Submitted attestation",
          "Granted counterparty access requests"
        ],
        "evidence": [
          "KYC-SA sharing/grant records",
          "Counterparty acknowledgements"
        ],
        "owner": "Compliance / Relationship Mgmt",
        "ext": false
      },
      {
        "n": 7,
        "name": "Annual Re-attestation & Continuous Compliance",
        "coverage": "Maintain controls year-round; monitor CSCF changes; re-scope on footprint change; re-attest annually with fresh independent assessment",
        "deliverables": [
          "Annual re-attestation",
          "Updated independent assessment",
          "Gap remediation for new controls"
        ],
        "evidence": [
          "Continuous monitoring records",
          "CSCF version gap analysis"
        ],
        "owner": "SWIFT Security Officer / Compliance",
        "ext": false
      }
    ],
    "loopback": {
      "label": "Annual re-attestation (Jul-Dec)",
      "from": 7,
      "to": 1
    },
    "match": [
      "swift"
    ]
  },
  {
    "id": "gcrf",
    "name": "Global Cyber Resilience Framework (GCRF)",
    "version": "1.0",
    "controls": 75,
    "group": "Cross-Industry Cyber / Cloud",
    "region": "International",
    "authority": "GCRF governing body; self-assessment + independent assessor validation/certification",
    "assessmentType": "Resilience maturity assessment + certification (Govern/Anticipate, Protect, Detect, Respond, Recover, Adapt)",
    "cycle": "~1-2 yr certification + annual surveillance",
    "phases": [
      {
        "n": 1,
        "name": "Scoping & Resilience Context",
        "coverage": "Define critical business services & assets; set impact tolerances; establish boundary across resilience domains",
        "deliverables": [
          "Resilience scope statement",
          "Critical service & asset inventory",
          "Impact tolerance definitions"
        ],
        "evidence": [
          "Business impact analysis",
          "Asset/service dependency maps"
        ],
        "owner": "Chief Resilience Officer / CISO",
        "ext": false
      },
      {
        "n": 2,
        "name": "Control Applicability Mapping (75 controls)",
        "coverage": "Map the 75 controls across resilience lifecycle: governance & risk, threat anticipation/intel, protection, detection, response, recovery/continuity, adaptive improvement",
        "deliverables": [
          "Control applicability matrix (75)",
          "Control ownership assignment"
        ],
        "evidence": [
          "Control-to-domain mapping"
        ],
        "owner": "GCRF Program Lead",
        "ext": false
      },
      {
        "n": 3,
        "name": "Maturity / Gap Assessment",
        "coverage": "Self-assess each of 75 controls vs capability-maturity scale; identify gaps vs target resilience level",
        "deliverables": [
          "Resilience maturity baseline",
          "Gap analysis & remediation roadmap"
        ],
        "evidence": [
          "Draft policies, resilience playbooks, self-assessment records"
        ],
        "owner": "GCRF Program Lead / Risk",
        "ext": false
      },
      {
        "n": 4,
        "name": "Implementation & Remediation",
        "coverage": "Uplift protect/detect/respond/recover; embed anticipate (threat intel) & adapt (lessons learned); close gaps",
        "deliverables": [
          "Remediated control set",
          "Resilience/continuity & IR plans",
          "Recovery runbooks"
        ],
        "evidence": [
          "Config, SOC setup, IR/BCP-DR plans, training"
        ],
        "owner": "Security & Resilience Operations",
        "ext": false
      },
      {
        "n": 5,
        "name": "Resilience Testing & Validation",
        "coverage": "Validate through tabletop, scenario/threat-led testing & recovery drills — prove withstand/recover/adapt",
        "deliverables": [
          "Exercise & test reports",
          "Recovery test results",
          "Post-exercise improvement actions"
        ],
        "evidence": [
          "Tabletop/scenario records",
          "DR/BCP test evidence"
        ],
        "owner": "Resilience Testing Team",
        "ext": false
      },
      {
        "n": 6,
        "name": "Independent Assessment / Certification",
        "coverage": "Independent assessor evaluates all 75 controls, tests evidence, scores maturity & determines conformity",
        "deliverables": [
          "Independent assessment report",
          "GCRF certificate",
          "Resilience maturity scorecard"
        ],
        "evidence": [
          "Assessor workpapers",
          "Validated evidence set"
        ],
        "owner": "Independent GCRF Assessor",
        "ext": true
      },
      {
        "n": 7,
        "name": "Continuous Monitoring & Re-certification",
        "coverage": "Continuous monitoring & Adapt domain (lessons learned, evolving threats); annual surveillance & re-certify",
        "deliverables": [
          "Surveillance assessment",
          "Updated maturity scorecard",
          "Re-certification"
        ],
        "evidence": [
          "Monitoring metrics",
          "Incident/exercise lessons learned"
        ],
        "owner": "Chief Resilience Officer / CISO",
        "ext": false
      }
    ],
    "loopback": {
      "label": "Surveillance + re-certification (Adapt)",
      "from": 7,
      "to": 1
    },
    "match": [
      "gcrf",
      "globalcyberresilience"
    ]
  },
  {
    "id": "sama",
    "name": "SAMA Cyber Security Framework",
    "version": "2023",
    "controls": 170,
    "group": "Saudi Arabia",
    "region": "Saudi Arabia",
    "authority": "Saudi Central Bank (SAMA) — mandatory for Member Organizations",
    "assessmentType": "Maturity self-assessment (levels 0-5) + regulator review; min target Level 3",
    "cycle": "Periodic (annual) self-assessment & reporting to SAMA",
    "phases": [
      {
        "n": 1,
        "name": "Governance Setup & Scope",
        "coverage": "Domain 1 Leadership & Governance: CISO role, strategy, policy, steering committee; scope of assets, applications & third-party connections",
        "deliverables": [
          "Cyber security governance charter & strategy",
          "Cyber security policy",
          "Scope of in-scope assets & services"
        ],
        "evidence": [
          "Board/committee approvals",
          "Approved policy",
          "Asset & service inventory"
        ],
        "owner": "CISO / Executive Management",
        "ext": false
      },
      {
        "n": 2,
        "name": "Control Domain Mapping (4 Domains)",
        "coverage": "Map controls across 4 domains: 1) Leadership & Governance, 2) Risk Management & Compliance, 3) Operations & Technology, 4) Third Party",
        "deliverables": [
          "Control applicability matrix across 4 domains",
          "Control ownership assignments"
        ],
        "evidence": [
          "Domain-to-control mapping"
        ],
        "owner": "Cyber Security / GRC",
        "ext": false
      },
      {
        "n": 3,
        "name": "Maturity Baseline Self-Assessment",
        "coverage": "Assess maturity per control on SAMA model (0 Non-existent -> 1 Ad-hoc -> 2 Repeatable -> 3 Defined -> 4 Managed -> 5 Adaptive)",
        "deliverables": [
          "Baseline maturity assessment",
          "Gap analysis vs target Level 3"
        ],
        "evidence": [
          "Completed SAMA self-assessment tool",
          "Supporting control documentation"
        ],
        "owner": "GRC / Internal Audit",
        "ext": false
      },
      {
        "n": 4,
        "name": "Roadmap & Remediation to Level 3",
        "coverage": "Execute roadmap to raise all 4 domains to at least Level 3 (Defined); remediate risk, operations & third-party gaps",
        "deliverables": [
          "Roadmap to Level 3+",
          "Corrective action / remediation plans"
        ],
        "evidence": [
          "Implemented policies, procedures, technical controls",
          "Third-party assessments & contracts"
        ],
        "owner": "Control Owners / IT & Security",
        "ext": false
      },
      {
        "n": 5,
        "name": "Independent Review / Validation",
        "coverage": "Validate self-assessment via internal audit and/or independent external review before submission",
        "deliverables": [
          "Internal audit / validation report",
          "Validated maturity scores"
        ],
        "evidence": [
          "Audit workpapers & test results",
          "Validated evidence per control"
        ],
        "owner": "Internal Audit / Independent Reviewer",
        "ext": false
      },
      {
        "n": 6,
        "name": "Submission to SAMA & Regulator Review",
        "coverage": "Submit maturity self-assessment (all 4 domains) to SAMA via prescribed tool; SAMA reviews, challenges & directs remediation to Level 3",
        "deliverables": [
          "SAMA self-assessment submission",
          "Regulator feedback / directives"
        ],
        "evidence": [
          "Submitted assessment package",
          "SAMA correspondence"
        ],
        "owner": "CISO / Compliance (SAMA-supervised)",
        "ext": true
      },
      {
        "n": 7,
        "name": "Continuous Improvement & Re-assessment",
        "coverage": "Sustain & improve maturity across all domains; monitor KPIs/KRIs; annual re-assessment & re-submission; progress to Levels 4-5",
        "deliverables": [
          "Periodic re-assessment",
          "Updated maturity scorecard & roadmap",
          "Re-submission to SAMA"
        ],
        "evidence": [
          "Monitoring metrics",
          "Refreshed evidence & improvement records"
        ],
        "owner": "CISO / GRC",
        "ext": false
      }
    ],
    "loopback": {
      "label": "Annual maturity re-assessment & SAMA re-submission",
      "from": 7,
      "to": 3
    },
    "match": [
      "sama"
    ]
  },
  {
    "id": "ndmo",
    "name": "KSA NDMO — Data Management & Personal Data Protection Standards",
    "version": "1.5",
    "controls": 202,
    "group": "Saudi Arabia",
    "region": "Saudi Arabia",
    "authority": "National Data Management Office (NDMO), a unit of SDAIA",
    "assessmentType": "Compliance & maturity assessment vs 15 domains + PDP; report to NDMO/SDAIA",
    "cycle": "Periodic assessment & maturity reporting; continuous data governance",
    "phases": [
      {
        "n": 1,
        "name": "Data Governance Office Establishment",
        "coverage": "Stand up Data Governance: appoint CDO / Data Office, governance committee, roles & data policies mandated by NDMO",
        "deliverables": [
          "Data governance charter & operating model",
          "CDO / Data Office appointment",
          "Data management & PDP policies"
        ],
        "evidence": [
          "Committee mandate & approvals",
          "Approved data policies"
        ],
        "owner": "Chief Data Officer (CDO)",
        "ext": false
      },
      {
        "n": 2,
        "name": "Domain Scoping (15 Domains + PDP)",
        "coverage": "Map controls across 15 domains (Governance; Catalog & Metadata; Quality; Operations; Content Mgmt; Architecture; Reference & Master Data; BI & Analytics; Data Sharing; Value Realization; Open Data; Freedom of Information; Classification; Personal Data Protection; Data Security) in 5 control areas",
        "deliverables": [
          "Domain applicability matrix (15 + PDP)",
          "Control ownership map across 5 control areas"
        ],
        "evidence": [
          "Domain-to-control mapping"
        ],
        "owner": "Data Governance Office",
        "ext": false
      },
      {
        "n": 3,
        "name": "Data Discovery, Cataloging & RoPA",
        "coverage": "Build data catalog & metadata; classify data; inventory personal data & produce RoPA (PDPL); map flows & cross-border transfers (data resident in KSA where required)",
        "deliverables": [
          "Enterprise data catalog",
          "Metadata repository",
          "Data classification register",
          "Record of Processing Activities (RoPA)",
          "Cross-border transfer inventory"
        ],
        "evidence": [
          "Catalog exports, classification labels",
          "Personal data inventory / RoPA"
        ],
        "owner": "Data Stewards / DPO",
        "ext": false
      },
      {
        "n": 4,
        "name": "Maturity Baseline / Gap Assessment",
        "coverage": "Assess maturity of each control spec across all domains + PDP vs NDMO maturity model; identify gaps vs target",
        "deliverables": [
          "NDMO maturity assessment (baseline)",
          "Gap analysis & remediation roadmap"
        ],
        "evidence": [
          "Control self-assessment workbook",
          "Supporting documentation per spec"
        ],
        "owner": "Data Governance Office / GRC",
        "ext": false
      },
      {
        "n": 5,
        "name": "Implementation & Remediation",
        "coverage": "Uplift data quality, master/reference data, data sharing agreements, data security & PDP safeguards (consent, DSR, breach)",
        "deliverables": [
          "Remediated controls & specs",
          "Data sharing agreements",
          "Data quality & security controls",
          "PDP procedures (consent, DSR, breach)"
        ],
        "evidence": [
          "Implemented tooling & policies",
          "Data quality reports, access controls, consent records"
        ],
        "owner": "Data Stewards / IT / DPO",
        "ext": false
      },
      {
        "n": 6,
        "name": "Compliance Assessment & Validation",
        "coverage": "Conduct NDMO compliance assessment across 15 domains + PDP; validate effectiveness & maturity (internal audit / independent review)",
        "deliverables": [
          "NDMO compliance assessment report",
          "Validated maturity scorecard",
          "Corrective action plans"
        ],
        "evidence": [
          "Assessment workpapers & evidence",
          "Validated compliance results"
        ],
        "owner": "Internal Audit / Data Governance Office",
        "ext": false
      },
      {
        "n": 7,
        "name": "Reporting to NDMO / SDAIA",
        "coverage": "Report maturity & compliance results to NDMO/SDAIA per cadence; respond to regulator feedback & directives",
        "deliverables": [
          "NDMO/SDAIA compliance & maturity report",
          "Regulator feedback / directives"
        ],
        "evidence": [
          "Submitted report package",
          "NDMO/SDAIA correspondence"
        ],
        "owner": "CDO / Data Governance Office",
        "ext": true
      },
      {
        "n": 8,
        "name": "Continuous Data Governance & Re-assessment",
        "coverage": "Operate ongoing data governance; monitor quality/KPIs & PDP compliance; periodically re-assess & re-report",
        "deliverables": [
          "Periodic re-assessment",
          "Updated scorecard & roadmap",
          "Re-report to NDMO/SDAIA"
        ],
        "evidence": [
          "Monitoring & data quality metrics",
          "Refreshed RoPA & evidence"
        ],
        "owner": "Data Governance Office / DPO",
        "ext": false
      }
    ],
    "loopback": {
      "label": "Periodic NDMO re-assessment & continuous governance",
      "from": 8,
      "to": 4
    },
    "match": [
      "ndmo",
      "nationaldatamanagement"
    ]
  },
  {
    "id": "sdaia",
    "name": "SDAIA — Personal Data Transfer Outside the Kingdom",
    "version": "2.0",
    "controls": 21,
    "group": "Saudi Arabia",
    "region": "Saudi Arabia",
    "authority": "SDAIA — competent authority under the PDPL",
    "assessmentType": "Regulatory compliance / cross-border Transfer Risk Assessment (self-executed)",
    "cycle": "Per-transfer; TRA reviewed & re-assessed on change",
    "phases": [
      {
        "n": 1,
        "name": "Lawful Basis, Purpose & Kingdom-Interest Check",
        "coverage": "Confirm legitimate purpose not prejudicing national security / vital interests; verify PDPL lawful basis; check Exempt Cases (Art.29 conditions)",
        "deliverables": [
          "Purpose & lawful-basis justification",
          "National-security / vital-interest screening",
          "RoPA transfer entry"
        ],
        "evidence": [
          "Purpose statement mapped to Art.29",
          "Legal basis documentation",
          "Data-mapping justification"
        ],
        "owner": "Data Controller / DPO",
        "ext": false
      },
      {
        "n": 2,
        "name": "Transfer Mechanism — Adequacy vs Safeguards",
        "coverage": "Check destination on SDAIA adequacy list; if not adequate select Appropriate Safeguard: Saudi SCCs, BCRs, or approved certification",
        "deliverables": [
          "Adequacy determination",
          "Selected safeguard (SCCs / BCRs / certification)",
          "Executed SCCs / approved BCR docs"
        ],
        "evidence": [
          "Adequate-country list check",
          "Signed SCCs / approved BCR package",
          "Certification where relied on"
        ],
        "owner": "Data Controller / Legal & Privacy",
        "ext": false
      },
      {
        "n": 3,
        "name": "Conduct Transfer Risk Assessment (TRA)",
        "coverage": "Assess legal/technical/organizational risks in destination & recipient per SDAIA Risk Assessment Guideline (Feb 2025); decide proceed / add measures / halt",
        "deliverables": [
          "Transfer Risk Assessment report",
          "Risk rating & mitigation plan",
          "Proceed / supplement / halt decision"
        ],
        "evidence": [
          "Completed TRA (SDAIA methodology)",
          "Destination legal analysis",
          "Recipient security due diligence"
        ],
        "owner": "DPO / Risk & Compliance",
        "ext": false
      },
      {
        "n": 4,
        "name": "Apply Minimum-Data Principle",
        "coverage": "Limit transferred data to the minimum necessary for the purpose; pseudonymize/anonymize where possible; avoid sensitive-data over-collection",
        "deliverables": [
          "Minimum-necessary scope determination",
          "Field-level data inventory",
          "Pseudonymization / minimization measures"
        ],
        "evidence": [
          "Data-minimization mapping",
          "Dataset scoping",
          "Technical minimization controls"
        ],
        "owner": "Data Controller / Business owner",
        "ext": false
      },
      {
        "n": 5,
        "name": "Implement Safeguards, Contracts & Obligations",
        "coverage": "Bind recipient via SCCs/BCRs; impose confidentiality, security, breach-notification, onward-transfer & audit obligations",
        "deliverables": [
          "Executed transfer agreement / SCC annexes",
          "Recipient security & breach commitments",
          "Onward-transfer controls"
        ],
        "evidence": [
          "Signed contracts with mandated clauses",
          "Processor/sub-processor obligations",
          "TOMs schedule"
        ],
        "owner": "Legal / Procurement / DPO",
        "ext": false
      },
      {
        "n": 6,
        "name": "Documentation & Accountability",
        "coverage": "Retain records of justification, safeguards, TRA outcomes & approvals; readiness for SDAIA inspection",
        "deliverables": [
          "Transfer register / accountability file",
          "Retained TRA & safeguard evidence",
          "SDAIA notification where required"
        ],
        "evidence": [
          "Audit trail of the decision",
          "Retained instruments",
          "Governance sign-off"
        ],
        "owner": "DPO / Compliance",
        "ext": false
      },
      {
        "n": 7,
        "name": "Continual Monitoring & Suspension",
        "coverage": "Monitor destination legal environment & recipient compliance; re-run TRA on change; suspend/terminate where protection cannot be guaranteed",
        "deliverables": [
          "Ongoing monitoring log",
          "Periodic TRA re-assessment",
          "Suspension/remediation decisions"
        ],
        "evidence": [
          "Monitoring & review records",
          "Updated risk assessments",
          "Suspension records"
        ],
        "owner": "DPO / Risk & Compliance",
        "ext": false
      }
    ],
    "loopback": {
      "label": "Continuous monitoring & periodic TRA re-assessment",
      "from": 7,
      "to": 3
    },
    "match": [
      "sdaia",
      "personaldatatransfer"
    ]
  },
  {
    "id": "aramco",
    "name": "ARAMCO Cybersecurity Compliance Certification (CCC) — SACS-002",
    "version": "2024",
    "controls": 35,
    "group": "Saudi Arabia",
    "region": "Saudi Arabia",
    "authority": "Saudi Aramco — Third Party Cybersecurity (SACS-002)",
    "assessmentType": "CCC/CCC+ certification via Aramco-Authorized Audit Firm",
    "cycle": "Certificate valid 2 years; renew before expiry / on classification change",
    "phases": [
      {
        "n": 1,
        "name": "Registration & Requirements Prep",
        "coverage": "Register on the CCC Portal; obtain CCC General Requirements; understand SACS-002 scope",
        "deliverables": [
          "CCC Portal registration",
          "CCC General Requirements acknowledgment"
        ],
        "evidence": [
          "Portal account",
          "SACS-002 applicability confirmation"
        ],
        "owner": "Third-Party Vendor (security lead)",
        "ext": false
      },
      {
        "n": 2,
        "name": "Classification & Scoping by Tier",
        "coverage": "Aramco proponent completes Classification Template to set tier: General / Outsourced Infrastructure / Customized Software / Cloud (-> CCC) or Network Connectivity / Critical Data Processor (-> CCC+); if both apply, CCC+ prevails",
        "deliverables": [
          "Third Party Classification Template",
          "Classification Confirmation Letter",
          "Certificate type (CCC vs CCC+) & scoped controls"
        ],
        "evidence": [
          "Signed confirmation letter",
          "Scoping from Aramco proponent"
        ],
        "owner": "Aramco Proponent + Vendor",
        "ext": false
      },
      {
        "n": 3,
        "name": "Implement Scoped SACS-002 Controls",
        "coverage": "Implement all applicable controls in the Third Party Cybersecurity Controls Guideline for the assigned classification(s)",
        "deliverables": [
          "Implemented control environment",
          "Internal control documentation & configs"
        ],
        "evidence": [
          "Time-stamped screenshots, policies, config evidence",
          "Media sanitization / segregation proofs"
        ],
        "owner": "Third-Party Vendor (IT/Security)",
        "ext": false
      },
      {
        "n": 4,
        "name": "Self-Compliance Assessment & Report",
        "coverage": "Complete the Third Party Cybersecurity Compliance Report vs scoped controls with time-stamped evidence tied to the third party",
        "deliverables": [
          "Completed Compliance Report (self-assessment)"
        ],
        "evidence": [
          "Supporting documentation per control",
          "Proof of relation to the third party"
        ],
        "owner": "Third-Party Vendor",
        "ext": false
      },
      {
        "n": 5,
        "name": "Authorized Audit Firm Verification",
        "coverage": "Contract an Aramco-Authorized Audit Firm via CCC Portal; CCC = remote validation, CCC+ = on-site assessment",
        "deliverables": [
          "Contract with Authorized Audit Firm",
          "Remote validation (CCC) or on-site outcome (CCC+)"
        ],
        "evidence": [
          "Audit firm verification workpapers",
          "On-site findings (CCC+)"
        ],
        "owner": "Authorized Audit Firm + Vendor",
        "ext": true
      },
      {
        "n": 6,
        "name": "Certificate Issuance & Submission",
        "coverage": "Audit firm issues the Cybersecurity Compliance Certificate (CCC/CCC+); vendor submits certificate & report to Aramco via e-Marketplace",
        "deliverables": [
          "SACS-002 Compliance Certificate (CCC/CCC+)",
          "Final Compliance Report"
        ],
        "evidence": [
          "Issued CCC certificate",
          "e-Marketplace submission confirmation"
        ],
        "owner": "Authorized Audit Firm + Vendor",
        "ext": true
      },
      {
        "n": 7,
        "name": "Validity Maintenance & Renewal",
        "coverage": "Certificate valid 2 years if classification unchanged; new/expanded certificate if a new contract adds a classification; renew before expiry",
        "deliverables": [
          "Renewed CCC/CCC+ certificate",
          "Additional assessment for new classification"
        ],
        "evidence": [
          "Renewal submission record",
          "Updated scoped assessment"
        ],
        "owner": "Third-Party Vendor",
        "ext": false
      }
    ],
    "loopback": {
      "label": "Renew every 2 years / re-certify on classification change",
      "from": 7,
      "to": 2
    },
    "match": [
      "aramco"
    ]
  },
  {
    "id": "sabic",
    "name": "SABIC CyberTrust Guidelines",
    "version": "1.0",
    "controls": 35,
    "group": "Saudi Arabia",
    "region": "Saudi Arabia",
    "authority": "SABIC — Third-Party CyberTrust Program (Supplier Portal)",
    "assessmentType": "Supplier self-assessment validated by audit firm; 100% compliance required",
    "cycle": "Certificate valid 2 years; renew on expiry / on change",
    "phases": [
      {
        "n": 1,
        "name": "Applicability & Registration",
        "coverage": "Any supplier with access to SABIC data must register in the CyberTrust Program via the Supplier Portal; obtain Standard & Guidelines",
        "deliverables": [
          "CyberTrust Program registration",
          "Access to CyberTrust Standard & Guidelines"
        ],
        "evidence": [
          "Supplier Portal enrollment",
          "Applicability confirmation"
        ],
        "owner": "Supplier (security lead)",
        "ext": false
      },
      {
        "n": 2,
        "name": "Classification & Control Scope",
        "coverage": "Classify supplier by engagement & data/system access; define applicable CyberTrust controls for that classification",
        "deliverables": [
          "Supplier classification",
          "Scoped CyberTrust control set"
        ],
        "evidence": [
          "Classification record",
          "Scope-of-controls mapping"
        ],
        "owner": "SABIC + Supplier",
        "ext": false
      },
      {
        "n": 3,
        "name": "Implement CyberTrust Controls",
        "coverage": "Implement applicable controls (governance, access control, data protection, secure operations, data handling)",
        "deliverables": [
          "Implemented control environment",
          "Supporting policies & configs"
        ],
        "evidence": [
          "Control implementation evidence",
          "Policy & technical artifacts"
        ],
        "owner": "Supplier (IT/Security)",
        "ext": false
      },
      {
        "n": 4,
        "name": "Self-Assessment Report",
        "coverage": "Conduct self-assessment vs scoped controls; compile CyberTrust Self-Assessment Report with evidence",
        "deliverables": [
          "CyberTrust Self-Assessment Report"
        ],
        "evidence": [
          "Completed self-assessment",
          "Attached control evidence"
        ],
        "owner": "Supplier",
        "ext": false
      },
      {
        "n": 5,
        "name": "Audit-Firm Validation & Remediation",
        "coverage": "Submit report to audit firm; firm verifies & generates CyberTrust Audit Summary Report; non-compliance triggers remediation & resubmission (100% required)",
        "deliverables": [
          "CyberTrust Audit Summary Report",
          "Non-compliance report + remediation plan",
          "Re-validated report"
        ],
        "evidence": [
          "Audit validation workpapers",
          "Remediation evidence",
          "Re-validation confirmation"
        ],
        "owner": "Authorized Audit Firm + Supplier",
        "ext": true
      },
      {
        "n": 6,
        "name": "Attestation & Certificate Issuance",
        "coverage": "At 100% compliance, supplier attests & CyberTrust certificate is issued and recorded to supplier profile",
        "deliverables": [
          "SABIC CyberTrust Certificate",
          "Supplier attestation"
        ],
        "evidence": [
          "Issued certificate",
          "Attestation record on Supplier Portal"
        ],
        "owner": "Authorized Audit Firm + Supplier",
        "ext": true
      },
      {
        "n": 7,
        "name": "Maintenance & Renewal",
        "coverage": "Maintain compliance for 2-yr validity; renew before expiry; re-assess on scope/classification/data-access change",
        "deliverables": [
          "Renewed CyberTrust certificate",
          "Updated self-assessment on change"
        ],
        "evidence": [
          "Renewal submission",
          "Change-driven re-assessment"
        ],
        "owner": "Supplier",
        "ext": false
      }
    ],
    "loopback": {
      "label": "Remediate to 100% / renew every 2 years",
      "from": 5,
      "to": 3
    },
    "match": [
      "sabic"
    ]
  },
  {
    "id": "adhics",
    "name": "ADHICS — Abu Dhabi Healthcare Info & Cyber Security Standard",
    "version": "0.9",
    "controls": 162,
    "group": "UAE & Qatar",
    "region": "United Arab Emirates",
    "authority": "Department of Health – Abu Dhabi (DOH)",
    "assessmentType": "Compliance assessment (gap -> implement -> self-assess) with reporting to DOH",
    "cycle": "Basic within 6 months, Advanced within 12 months; periodic review & re-submission",
    "phases": [
      {
        "n": 1,
        "name": "Scoping & Applicability",
        "coverage": "Confirm DOH-regulated healthcare entity; determine control category — Basic / Transitional / Advanced — by risk, information value & maturity",
        "deliverables": [
          "Applicability & scope determination",
          "Control category classification"
        ],
        "evidence": [
          "Asset & information-value assessment",
          "Maturity/risk-tier determination"
        ],
        "owner": "Healthcare Entity — CISO",
        "ext": false
      },
      {
        "n": 2,
        "name": "Information Security Governance",
        "coverage": "Establish IS Program: leadership sponsorship, IS Governance Committee, policies, roles, risk framework across 6 control domains (Governance, Asset, HR, Physical, Access, Operations, Acquisition, Incident, Third-Party)",
        "deliverables": [
          "IS Governance Committee charter",
          "ADHICS policy set & risk framework",
          "Roles & responsibilities matrix"
        ],
        "evidence": [
          "Approved governance policies",
          "Committee minutes",
          "Risk register"
        ],
        "owner": "Executive Management / IS Governance Committee",
        "ext": false
      },
      {
        "n": 3,
        "name": "Gap Assessment vs ADHICS Controls",
        "coverage": "Assess current state vs ADHICS controls across all domains (asset, access, operations, health info protection, BCM); identify gaps by category",
        "deliverables": [
          "ADHICS gap assessment report",
          "Prioritized remediation roadmap"
        ],
        "evidence": [
          "Control-by-control gap analysis",
          "Evidence inventory of existing controls"
        ],
        "owner": "CISO / assessor",
        "ext": false
      },
      {
        "n": 4,
        "name": "Implementation & Remediation",
        "coverage": "Implement Basic controls within 6 months, Advanced within 12; deploy technical/admin/physical safeguards; asset inventory, access, encryption, IR, BCM; enable Malaffi (HIE)",
        "deliverables": [
          "Implemented ADHICS controls",
          "Asset inventory",
          "Incident response & BCM plans"
        ],
        "evidence": [
          "Implementation records per category",
          "Config & policy artifacts",
          "Training records"
        ],
        "owner": "IT / Security / Business owners",
        "ext": false
      },
      {
        "n": 5,
        "name": "Compliance Assessment & Internal Audit",
        "coverage": "Internal compliance self-assessment vs ADHICS; validate effectiveness; internal audit & management review of residual risk",
        "deliverables": [
          "ADHICS compliance self-assessment",
          "Internal audit report",
          "Residual risk acceptance"
        ],
        "evidence": [
          "Control-effectiveness testing",
          "Internal audit workpapers",
          "Management review minutes"
        ],
        "owner": "Internal Audit / CISO",
        "ext": false
      },
      {
        "n": 6,
        "name": "Compliance Submission & Reporting to DOH",
        "coverage": "Submit ADHICS implementation & compliance report to DOH; demonstrate adherence for licensing & HIE participation",
        "deliverables": [
          "ADHICS implementation & compliance report to DOH",
          "Attestation of compliance"
        ],
        "evidence": [
          "Submitted compliance report",
          "DOH acknowledgment"
        ],
        "owner": "CISO / Compliance (reporting to DOH)",
        "ext": true
      },
      {
        "n": 7,
        "name": "Continuous Monitoring & Re-attestation",
        "coverage": "Maintain & improve the IS Program; monitor controls, manage incidents, periodic (annual) reassessment & re-submission to DOH",
        "deliverables": [
          "Periodic compliance review",
          "Updated risk register & remediation",
          "Re-attestation to DOH"
        ],
        "evidence": [
          "Monitoring & metrics reports",
          "Incident logs",
          "Reassessment records"
        ],
        "owner": "CISO / IS Governance Committee",
        "ext": false
      }
    ],
    "loopback": {
      "label": "Annual re-assessment & compliance reporting to DOH",
      "from": 7,
      "to": 3
    },
    "match": [
      "adhics",
      "healthcareinformation"
    ]
  },
  {
    "id": "adhie",
    "name": "DOH ADHIE Policy — Abu Dhabi Health Information Exchange (Malaffi)",
    "version": "1.1",
    "controls": 195,
    "group": "UAE & Qatar",
    "region": "United Arab Emirates",
    "authority": "DOH – Abu Dhabi; operated via Abu Dhabi Health Data Services (Malaffi)",
    "assessmentType": "HIE onboarding & participation compliance (agreement, declaration, security assessment)",
    "cycle": "One-time onboarding (licensing pre-requisite) + ongoing participation & periodic reassessment",
    "phases": [
      {
        "n": 1,
        "name": "Applicability & Mandatory Participation",
        "coverage": "Confirm the facility must connect to Malaffi (all DOH-licensed facilities holding patient info); onboarding is a licence pre-requisite",
        "deliverables": [
          "Participation applicability determination",
          "Facility connection commitment"
        ],
        "evidence": [
          "DOH facility licence status",
          "Required-to-connect confirmation"
        ],
        "owner": "Facility executive/clinical leadership",
        "ext": false
      },
      {
        "n": 2,
        "name": "Participation Agreement & Governance",
        "coverage": "Execute ADHIE Participation Agreement & Facility Declaration; accept obligations on data contribution, permitted use, roles & accountability",
        "deliverables": [
          "Signed ADHIE Participation Agreement",
          "Facility Declaration"
        ],
        "evidence": [
          "Executed participation agreement",
          "Declaration of systems & data scope"
        ],
        "owner": "Facility management + DOH/Malaffi",
        "ext": true
      },
      {
        "n": 3,
        "name": "Privacy, Consent & Permitted-Use",
        "coverage": "Implement DOH Standard on Patient Healthcare Data Privacy & ADHIE consent/permitted-use — consent/opt-out, break-glass, minimum-necessary, purpose limitation",
        "deliverables": [
          "Consent & opt-out procedures",
          "Permitted-use / access-control policy",
          "Privacy notice & data-security measures"
        ],
        "evidence": [
          "Consent management records",
          "Role-based access policy",
          "Privacy standard conformance"
        ],
        "owner": "Facility Privacy Officer / DPO",
        "ext": false
      },
      {
        "n": 4,
        "name": "Security Assessment & Questionnaires",
        "coverage": "Complete Malaffi security assessments & questionnaires; demonstrate alignment with ADHICS safeguards protecting exchanged data",
        "deliverables": [
          "Completed Malaffi security questionnaire",
          "Security assessment results",
          "ADHICS-alignment evidence"
        ],
        "evidence": [
          "Questionnaire submission",
          "ADHICS control evidence",
          "Gap remediation"
        ],
        "owner": "Facility CISO / IT Security",
        "ext": true
      },
      {
        "n": 5,
        "name": "Technical Integration & Interoperability",
        "coverage": "Integrate EMR with Malaffi using DOH interoperability & coding standards (HL7/FHIR, SNOMED CT); establish bi-directional contribution & query",
        "deliverables": [
          "EMR-to-Malaffi integration",
          "Interoperability & coding conformance",
          "Data-mapping to mandated code sets"
        ],
        "evidence": [
          "Integration test results",
          "Interface/message validation",
          "Code-set mapping records"
        ],
        "owner": "Facility IT + Malaffi integration team",
        "ext": false
      },
      {
        "n": 6,
        "name": "Go-Live, Data Contribution & Enablement",
        "coverage": "Activate live data contribution & access; train users on the Malaffi Provider Portal; enforce access governance & audit logging",
        "deliverables": [
          "Go-live authorization",
          "Trained/enabled clinical users",
          "Access & audit-logging controls"
        ],
        "evidence": [
          "Go-live sign-off",
          "User training records",
          "Access & audit logs"
        ],
        "owner": "Facility operations + Malaffi",
        "ext": true
      },
      {
        "n": 7,
        "name": "Ongoing Participation & Reassessment",
        "coverage": "Maintain quality data contribution & policy compliance; periodic security/privacy reassessment; incident reporting; renewal tied to licence",
        "deliverables": [
          "Ongoing compliance monitoring",
          "Periodic reassessment & data-quality reporting",
          "Licence-renewal attestation"
        ],
        "evidence": [
          "Data-quality & contribution metrics",
          "Reassessment records",
          "Incident & audit reports"
        ],
        "owner": "Facility compliance/IT (reporting to DOH/Malaffi)",
        "ext": false
      }
    ],
    "loopback": {
      "label": "Ongoing participation & periodic reassessment (licence renewal)",
      "from": 7,
      "to": 3
    },
    "match": [
      "adhie",
      "healthinformationexchange"
    ]
  },
  {
    "id": "qcb",
    "name": "QCB — Qatar Central Bank Technology Risks Circular",
    "version": "Jan 2018",
    "controls": 516,
    "group": "UAE & Qatar",
    "region": "Qatar",
    "authority": "Qatar Central Bank (QCB)",
    "assessmentType": "Regulatory examination / supervisory compliance (self-assessment + independent audit + QCB inspection)",
    "cycle": "Continuous; periodic audit; QCB examination; incident reporting within 1 hour",
    "phases": [
      {
        "n": 1,
        "name": "Governance & Organization",
        "coverage": "Board-level oversight of technology/cyber risk; dedicated IS organization; CISO appointment; integrate IS into strategy; policies & accountability",
        "deliverables": [
          "Board-approved technology & cyber risk framework",
          "CISO appointment & IS organization",
          "IS policy suite"
        ],
        "evidence": [
          "Board/committee charters & minutes",
          "Org structure & CISO mandate",
          "Approved policies"
        ],
        "owner": "Bank Board / Senior Mgmt / CISO",
        "ext": false
      },
      {
        "n": 2,
        "name": "IT & Technology Risk Assessment",
        "coverage": "Risk-assessment process across networks, hardware, software, applications, systems & operations; classify assets & data; assess residual risk",
        "deliverables": [
          "Technology risk assessment",
          "Asset & data classification",
          "Risk register & treatment plan"
        ],
        "evidence": [
          "Risk methodology & results",
          "Asset inventory",
          "Risk treatment records"
        ],
        "owner": "Bank Risk / IS function",
        "ext": false
      },
      {
        "n": 3,
        "name": "Security Architecture & Controls",
        "coverage": "Network security, 24/7 SOC, two-factor authentication for critical systems, data protection/encryption, secure architecture, in-Qatar data residency",
        "deliverables": [
          "Security architecture & controls",
          "24/7 SOC",
          "MFA & encryption",
          "In-Qatar data-centre arrangement"
        ],
        "evidence": [
          "Architecture documentation",
          "SOC operations records",
          "Control config evidence"
        ],
        "owner": "Bank Information Security / IT",
        "ext": false
      },
      {
        "n": 4,
        "name": "IT Operations, Change & Projects",
        "coverage": "Change/patch management, incident handling, logging/monitoring, capacity, access; secure SDLC & e-banking/payment security (end-to-end encryption, authN/authZ)",
        "deliverables": [
          "IT operations & change procedures",
          "Secure SDLC / project controls",
          "E-banking & payment security controls"
        ],
        "evidence": [
          "Change/patch/incident logs",
          "Capacity & monitoring reports",
          "Payment-security evidence"
        ],
        "owner": "Bank IT Operations / Development",
        "ext": false
      },
      {
        "n": 5,
        "name": "Business Continuity & Incident Management",
        "coverage": "BCM (BCP/DR), incident response & reporting; report significant incidents to QCB within one hour; test BCP/DR",
        "deliverables": [
          "BCM / BCP-DR plans",
          "Incident response plan",
          "QCB incident-notification process"
        ],
        "evidence": [
          "BCP/DR test results",
          "Incident reports to QCB",
          "RTO/RPO objectives"
        ],
        "owner": "Bank BCM / Incident Response",
        "ext": false
      },
      {
        "n": 6,
        "name": "Outsourcing & Cloud Risk Management",
        "coverage": "Manage outsourcing/cloud with retained accountability; obtain QCB approval before cloud or significant outsourcing; impose security/audit/data obligations",
        "deliverables": [
          "Outsourcing/cloud risk assessments",
          "QCB approval requests & approvals",
          "Provider security & audit clauses"
        ],
        "evidence": [
          "QCB approval records",
          "Due-diligence & contracts",
          "Provider oversight reports"
        ],
        "owner": "Bank Procurement / Risk / CISO",
        "ext": true
      },
      {
        "n": 7,
        "name": "Independent Audit & Self-Assessment",
        "coverage": "Regular internal/independent audit & self-assessment vs the QCB control set; validate effectiveness & remediate",
        "deliverables": [
          "Internal/independent audit report",
          "Self-assessment vs QCB controls",
          "Remediation plan"
        ],
        "evidence": [
          "Audit workpapers & findings",
          "Self-assessment results",
          "Remediation tracking"
        ],
        "owner": "Bank Internal Audit / Compliance",
        "ext": false
      },
      {
        "n": 8,
        "name": "QCB Supervisory Examination & Reporting",
        "coverage": "Undergo QCB examination/inspection; submit regulatory reporting; address supervisory findings & directives",
        "deliverables": [
          "QCB examination readiness package",
          "Regulatory reports to QCB",
          "Corrective action plan for findings"
        ],
        "evidence": [
          "QCB inspection responses",
          "Submitted regulatory reports",
          "Closure evidence for findings"
        ],
        "owner": "Bank Compliance / CISO (QCB-supervised)",
        "ext": true
      }
    ],
    "loopback": {
      "label": "Continuous compliance with periodic audit & QCB examination",
      "from": 8,
      "to": 2
    },
    "match": [
      "qcb",
      "qatarcentralbank"
    ]
  },
  {
    "id": "mastrm",
    "name": "MAS TRM — Technology Risk Management Guidelines",
    "version": "2021",
    "controls": 236,
    "group": "Asia — SG / PK / LK",
    "region": "Singapore",
    "authority": "Monetary Authority of Singapore (MAS)",
    "assessmentType": "Supervisory guidelines (examinable): FI self-assessment + MAS review/inspection",
    "cycle": "Continuous with at least annual review; ongoing MAS supervision",
    "phases": [
      {
        "n": 1,
        "name": "Technology Risk Governance & Oversight",
        "coverage": "Board & senior management accountability; roles of CIO/CTO & CISO; technology risk appetite; board tech/cyber competency",
        "deliverables": [
          "Board-approved tech risk appetite",
          "Governance structure (CIO/CTO/CISO)",
          "Tech risk policies & standards",
          "Senior-mgmt oversight reporting"
        ],
        "evidence": [
          "Board & committee minutes on tech risk",
          "CIO/CISO appointment & competency records",
          "Approved risk appetite & policies"
        ],
        "owner": "Board of Directors & Senior Mgmt",
        "ext": false
      },
      {
        "n": 2,
        "name": "Technology Risk Management Framework",
        "coverage": "Identify information assets & system criticality; risk identification/assessment/treatment/monitoring; third-party & interconnected risk",
        "deliverables": [
          "Technology Risk Management Framework",
          "Asset & system criticality inventory",
          "Risk register with treatment",
          "Third-party risk procedures"
        ],
        "evidence": [
          "Risk assessment reports",
          "Risk register with residual ratings",
          "Vendor risk assessments"
        ],
        "owner": "Head of Technology Risk / CISO",
        "ext": false
      },
      {
        "n": 3,
        "name": "Project Mgmt, Security-by-Design & Development",
        "coverage": "IT project management, systems acquisition & development (security-by-design, secure coding, DevSecOps), software application development",
        "deliverables": [
          "Security-by-design in SDLC",
          "Secure coding & code-review procedures",
          "Project risk assessments & gates",
          "SAST/DAST results"
        ],
        "evidence": [
          "Project security assessments",
          "Code review & secure-coding trails",
          "App pentest reports",
          "Change/release approvals"
        ],
        "owner": "CIO / Head of Technology (CISO sign-off)",
        "ext": false
      },
      {
        "n": 4,
        "name": "Service Mgmt, Resilience & Data/Infra Security",
        "coverage": "IT service management (change/incident/problem/capacity); IT resilience (availability, DR, BCM, RTO/RPO); data & infra security (DLP, network); cryptography & key management",
        "deliverables": [
          "Change & incident procedures",
          "IT DR & BC plans with RTO/RPO",
          "Data protection & DLP controls",
          "Cryptographic key management policy"
        ],
        "evidence": [
          "DR/BCP test results",
          "Availability & uptime metrics",
          "Change logs",
          "Encryption & key mgmt records"
        ],
        "owner": "Head of IT Operations / CIO",
        "ext": false
      },
      {
        "n": 5,
        "name": "Access Control",
        "coverage": "User & privileged access management, least-privilege, remote & physical access, MFA for privileged & remote users",
        "deliverables": [
          "Access control policy (least privilege)",
          "Privileged access management (PAM)",
          "Periodic access recertification",
          "MFA for privileged/remote access"
        ],
        "evidence": [
          "Access recertification reports",
          "Privileged access logs & reviews",
          "MFA config evidence",
          "Data-centre physical access records"
        ],
        "owner": "CISO / Head of Information Security",
        "ext": false
      },
      {
        "n": 6,
        "name": "Cyber Security Operations & Surveillance",
        "coverage": "Threat intelligence, continuous monitoring (SOC), VA/PT, threat hunting, red teaming / adversarial attack simulation, patch management",
        "deliverables": [
          "24x7 SOC / cyber surveillance",
          "Threat intel & hunting programme",
          "VA/PT schedule",
          "Adversarial attack simulation / red team"
        ],
        "evidence": [
          "SOC logs & alerts",
          "VA/PT & red-team reports",
          "Threat intel & hunting reports",
          "Patch compliance metrics"
        ],
        "owner": "CISO / Head of Cyber Security Ops",
        "ext": false
      },
      {
        "n": 7,
        "name": "Incident Management & Online Financial Services",
        "coverage": "IT & cyber incident management (report to MAS within 1 hour of discovery); online/mobile financial-services security; fraud monitoring",
        "deliverables": [
          "Cyber IR plan with MAS 1-hour notification",
          "Online financial-services security controls",
          "Fraud monitoring & detection",
          "Post-incident review reports"
        ],
        "evidence": [
          "Incident logs & MAS notifications",
          "IR tabletop records",
          "Online banking control evidence",
          "Fraud alerts & case files"
        ],
        "owner": "CISO / Head of Incident Response",
        "ext": false
      },
      {
        "n": 8,
        "name": "IT Audit & Supervisory Review",
        "coverage": "Independent internal IT audit of the TRM framework; findings remediation; plus MAS supervisory inspection & thematic reviews",
        "deliverables": [
          "IT audit plan & reports",
          "Self-assessment vs TRM Guidelines",
          "Remediation tracking of audit & MAS findings",
          "Board reporting of assurance"
        ],
        "evidence": [
          "Internal IT audit reports",
          "Self-assessment gap analysis",
          "MAS inspection responses",
          "Audit committee minutes"
        ],
        "owner": "Head of Internal Audit / Board Audit Committee",
        "ext": true
      }
    ],
    "loopback": {
      "label": "Annual framework review & continuous MAS supervision",
      "from": 8,
      "to": 1
    },
    "match": [
      "mastrm",
      "mastechnology"
    ]
  },
  {
    "id": "sbpetgrmf",
    "name": "SBP ETGRMF — Enterprise Tech Governance & Risk Mgmt",
    "version": "2022",
    "controls": 262,
    "group": "Asia — SG / PK / LK",
    "region": "Pakistan",
    "authority": "State Bank of Pakistan (SBP)",
    "assessmentType": "Regulatory framework: FI gap analysis + board-approved time-bound plan to SBP; SBP inspection",
    "cycle": "Gap assessment on SBP timelines, then continuous/annual review + inspection",
    "phases": [
      {
        "n": 1,
        "name": "Enterprise Technology Governance",
        "coverage": "Board & senior management responsibility; IT strategy alignment; IT Steering Committee; CIO/CISO roles; segregation of duties",
        "deliverables": [
          "Board-approved IT governance policy & strategy",
          "IT Steering Committee charter",
          "CIO/CISO roles & reporting",
          "Technology risk governance structure"
        ],
        "evidence": [
          "Board & ITSC minutes",
          "Approved IT strategy & policies",
          "Org charts & role definitions"
        ],
        "owner": "Board of Directors & IT Steering Committee",
        "ext": false
      },
      {
        "n": 2,
        "name": "Technology Risk Management",
        "coverage": "Technology risk identification, assessment, treatment & monitoring; risk appetite; ERM integration; KRIs",
        "deliverables": [
          "Technology/enterprise risk framework",
          "Technology risk register",
          "Risk appetite & KRI dashboards",
          "Risk treatment plans"
        ],
        "evidence": [
          "Risk assessment reports",
          "Risk register with residual ratings",
          "KRI monitoring reports"
        ],
        "owner": "Head of Technology Risk / CISO",
        "ext": false
      },
      {
        "n": 3,
        "name": "Information Security",
        "coverage": "IS policy, access control, cryptography, network & endpoint security, data classification/protection, monitoring, cyber IR & SBP incident reporting",
        "deliverables": [
          "Information security policy & standards",
          "Access control & cryptographic key controls",
          "Security monitoring / SOC",
          "Cyber IR & SBP reporting procedures"
        ],
        "evidence": [
          "Access review records",
          "Security monitoring logs",
          "VA/PT reports",
          "Incident logs & SBP notifications"
        ],
        "owner": "Chief Information Security Officer (CISO)",
        "ext": false
      },
      {
        "n": 4,
        "name": "IT Operations & Service Delivery",
        "coverage": "Data-centre operations, change & configuration management, capacity/performance, IT asset management, patching, backups",
        "deliverables": [
          "IT operations & change procedures",
          "Capacity & performance monitoring",
          "IT asset inventory",
          "Backup & patch management"
        ],
        "evidence": [
          "Change logs",
          "Capacity/uptime reports",
          "Backup & restore tests",
          "Patch compliance reports"
        ],
        "owner": "Head of IT Operations / CIO",
        "ext": false
      },
      {
        "n": 5,
        "name": "System Acquisition, Development & Projects",
        "coverage": "SDLC controls, secure development, testing/UAT, project governance, software acquisition & vendor evaluation",
        "deliverables": [
          "SDLC & secure development standards",
          "Project governance & approval gates",
          "Testing/UAT sign-off",
          "Software acquisition due diligence"
        ],
        "evidence": [
          "Project approval records",
          "UAT & security test results",
          "Code review evidence",
          "Acquisition evaluation records"
        ],
        "owner": "CIO / Head of Application Development",
        "ext": false
      },
      {
        "n": 6,
        "name": "Business Continuity & Disaster Recovery",
        "coverage": "BCP/DR plans, business impact analysis, RTO/RPO, alternate/DR site, resilience testing",
        "deliverables": [
          "BC & DR plans",
          "BIA with RTO/RPO",
          "DR site arrangements",
          "BCP/DR test programme"
        ],
        "evidence": [
          "BIA documentation",
          "DR test reports",
          "BCP invocation drills",
          "Resilience metrics"
        ],
        "owner": "Head of BCP / CIO",
        "ext": false
      },
      {
        "n": 7,
        "name": "Outsourcing & Third-Party / Cloud Risk",
        "coverage": "Outsourcing policy, vendor due diligence, SLAs, ongoing oversight, cloud outsourcing (SBP Cloud Framework), exit planning",
        "deliverables": [
          "Board-approved outsourcing policy",
          "Vendor due diligence & risk assessments",
          "Outsourcing SLAs & oversight",
          "Exit & contingency plans"
        ],
        "evidence": [
          "Due diligence reports",
          "SLA & contract records",
          "Oversight reports",
          "SBP outsourcing notifications"
        ],
        "owner": "Head of Outsourcing / Operational Risk",
        "ext": false
      },
      {
        "n": 8,
        "name": "Gap Assessment, IT Audit & SBP Compliance",
        "coverage": "Gap analysis vs framework; board-approved time-bound action plan to SBP; independent IT audit; remediation & SBP inspection",
        "deliverables": [
          "Gap analysis report",
          "Board-approved action plan to SBP",
          "Independent IT audit reports",
          "Remediation & progress reporting to SBP"
        ],
        "evidence": [
          "Gap assessment matrix",
          "Board-approved plan & SBP submission",
          "IT audit reports",
          "SBP inspection responses"
        ],
        "owner": "Head of Internal Audit / Board with CIO",
        "ext": true
      }
    ],
    "loopback": {
      "label": "Continuous review with IT audit & SBP inspection",
      "from": 8,
      "to": 1
    },
    "match": [
      "etgrmf"
    ]
  },
  {
    "id": "sbpcloud",
    "name": "SBP Cloud Outsourcing / Adoption Framework",
    "version": "2023",
    "controls": 58,
    "group": "Asia — SG / PK / LK",
    "region": "Pakistan",
    "authority": "State Bank of Pakistan (SBP)",
    "assessmentType": "Regulatory framework: risk-based cloud governance; SBP approval/notification for material workloads",
    "cycle": "Per-arrangement lifecycle; annual contingency test; biennial CSP audit for material workloads",
    "phases": [
      {
        "n": 1,
        "name": "Cloud Outsourcing Governance",
        "coverage": "Board-approved cloud policy; materiality assessment (material vs non-material); onshore/offshore permissibility; ITSC delegation; ERM update",
        "deliverables": [
          "Board-approved cloud outsourcing policy",
          "Materiality assessment of workloads",
          "Updated ERM framework for cloud",
          "ITSC ToRs amended for cloud"
        ],
        "evidence": [
          "Board approval of cloud policy",
          "Materiality classification records",
          "ITSC minutes",
          "Legally vetted SLAs (preferably Pakistan law)"
        ],
        "owner": "Board of Directors & IT Steering Committee",
        "ext": false
      },
      {
        "n": 2,
        "name": "CSP Due Diligence & Risk Assessment",
        "coverage": "CSP financial strength, track record (min 5 yrs), Tier III data centres, certifications, data residency, sub-contracting risk; TVA of data centres for material workloads",
        "deliverables": [
          "CSP due diligence report",
          "Cloud outsourcing risk assessment",
          "Data residency assessment",
          "Threat & Vulnerability Assessment of data centres"
        ],
        "evidence": [
          "CSP certifications & Tier III attestations",
          "SOC reports reviewed by IA & IS",
          "TVA reports",
          "Sub-contracting risk assessment"
        ],
        "owner": "Head of IT Risk / IS with Internal Audit",
        "ext": false
      },
      {
        "n": 3,
        "name": "SBP Approval / Notification & Contracting",
        "coverage": "SBP approval for material offshore workloads (to BPRD or PSP&OD); one-month prior notification for material workloads; SLA covering data location, access/audit, sub-contracting, exit",
        "deliverables": [
          "SBP approval request (material offshore)",
          "One-month prior notification to SBP",
          "Executed SLA (Appendix-I areas)",
          "Governing-law & data-location clauses"
        ],
        "evidence": [
          "SBP approval/notification correspondence",
          "Signed SLA with access/audit & portability clauses",
          "Legal vetting records"
        ],
        "owner": "Head of Compliance / Legal with CIO",
        "ext": true
      },
      {
        "n": 4,
        "name": "Security Controls Implementation",
        "coverage": "IAM & MFA, change/config mgmt, incident mgmt (SIRT), data security (encryption, PII, backups w/ ransomware protection), RE-owned keys/HSM, tokenization, network (segmentation, IDS/IPS, WAF, DDoS, VPN), annual VA/PT, SIEM & 24x7 SOC",
        "deliverables": [
          "Cloud access controls with MFA & IP restrictions",
          "Encryption & RE-managed key/HSM controls",
          "Network segmentation & perimeter security",
          "Cloud-integrated SIEM & 24x7 SOC"
        ],
        "evidence": [
          "Access & MFA config records",
          "Encryption/key mgmt evidence",
          "Firewall/segmentation config",
          "Annual VA/PT & SIEM logs"
        ],
        "owner": "Chief Information Security Officer (CISO)",
        "ext": false
      },
      {
        "n": 5,
        "name": "Ongoing Oversight & Audit",
        "coverage": "Monitor CSP performance/SLAs, KPIs/KRIs, sub-contracting & control changes; review CSP SOC reports; comprehensive CSP audit at least every 2 years (material); RE/SBP/auditor access rights",
        "deliverables": [
          "Ongoing oversight & performance reports",
          "Review of CSP SOC/audit reports",
          "Biennial comprehensive CSP audit",
          "IA certification to Board on compliance"
        ],
        "evidence": [
          "Oversight & KPI/KRI reports",
          "CSP audit & SOC reviews",
          "Biennial audit reports",
          "IA certification to Board"
        ],
        "owner": "IT Steering Committee / Internal Audit",
        "ext": false
      },
      {
        "n": 6,
        "name": "Contingency Planning & Resilience Testing",
        "coverage": "Redundancy by design, high availability, redundant connectivity; defined activation roles; at least annual contingency plan testing (CSP unavailability); collaborative CSP testing",
        "deliverables": [
          "Cloud contingency plan (trigger events & roles)",
          "High-availability / redundancy architecture",
          "Annual contingency test results",
          "Corrective action tracking"
        ],
        "evidence": [
          "Contingency plan document",
          "Annual test reports",
          "HA/health-check records",
          "Remediation logs"
        ],
        "owner": "Head of IT Operations / BCP",
        "ext": false
      },
      {
        "n": 7,
        "name": "Exit Planning & Data Purging",
        "coverage": "Exit plan for stressed/non-stressed scenarios; defined triggers & transition; no lock-in; termination rights; complete data deletion (incl. logs) on exit; sub-contracting visibility",
        "deliverables": [
          "Cloud exit plan (stressed & non-stressed)",
          "Escrow/continuity arrangements",
          "Data purging confirmation on exit",
          "Sub-contractor list & controls"
        ],
        "evidence": [
          "Exit plan & test records",
          "Termination & no-lock-in clauses",
          "Written data-deletion confirmation",
          "Sub-contractor register"
        ],
        "owner": "CIO / Head of Outsourcing",
        "ext": false
      }
    ],
    "loopback": {
      "label": "Ongoing oversight, annual contingency test, biennial CSP audit",
      "from": 5,
      "to": 1
    },
    "match": [
      "sbpcloud",
      "cloudoutsourcing"
    ]
  },
  {
    "id": "sbpib",
    "name": "SBP Internet Banking Security Framework",
    "version": "2023",
    "controls": 66,
    "group": "Asia — SG / PK / LK",
    "region": "Pakistan",
    "authority": "State Bank of Pakistan (SBP) — Banking Supervision Dept (BSD)",
    "assessmentType": "Regulatory directive: CEO-approved plan with monthly milestones to BSD; monthly reporting",
    "cycle": "Implementation by deadline with monthly reporting; then continuous fraud monitoring",
    "phases": [
      {
        "n": 1,
        "name": "Governance & Implementation Planning",
        "coverage": "CEO-approved implementation plan with monthly milestones; submit to BSD within 30 days; monthly progress within 10 days of month-end; board accountability for digital fraud",
        "deliverables": [
          "CEO-approved plan with monthly milestones",
          "Submission to BSD within 30 days",
          "Monthly progress reports to BSD",
          "Digital fraud governance structure"
        ],
        "evidence": [
          "CEO-approved plan & BSD acknowledgement",
          "Monthly progress submissions",
          "Board/management minutes"
        ],
        "owner": "Chief Executive Officer / Board",
        "ext": false
      },
      {
        "n": 2,
        "name": "Customer Authentication & 2FA/MFA",
        "coverage": "Mandatory 2FA/MFA for login & transactions; strong customer authentication; secure enrolment; device binding & biometric where applicable",
        "deliverables": [
          "2FA/MFA on login & transactions",
          "Strong customer authentication",
          "Secure device registration/binding",
          "Step-up authentication for high-risk"
        ],
        "evidence": [
          "Authentication config records",
          "OTP/token/biometric evidence",
          "Device-binding logs"
        ],
        "owner": "Head of Digital Banking / CISO",
        "ext": false
      },
      {
        "n": 3,
        "name": "Transaction Security & Controls",
        "coverage": "Transaction limits; two-hour restriction on outflows from incoming transfers; beneficiary controls; transaction signing/verification; secure alerts",
        "deliverables": [
          "Transaction limit & velocity controls",
          "Two-hour restriction on outflows",
          "Beneficiary cooling-off controls",
          "Real-time transaction alerts"
        ],
        "evidence": [
          "Transaction limit config",
          "Cooling-off rule evidence",
          "Beneficiary control logs",
          "Customer alert records"
        ],
        "owner": "Head of Digital Banking / Payments",
        "ext": false
      },
      {
        "n": 4,
        "name": "Session Management & Application Security",
        "coverage": "Session time-outs, logon-attempt limits & lockout, secure session handling, app hardening (internet & mobile), TLS",
        "deliverables": [
          "Session time-out & auto-logout",
          "Failed-logon limits & lockout",
          "Mobile/internet app hardening",
          "Secure channels (TLS)"
        ],
        "evidence": [
          "Session config records",
          "Lockout policy evidence",
          "App security test results",
          "Channel encryption evidence"
        ],
        "owner": "Head of Application Security / CISO",
        "ext": false
      },
      {
        "n": 5,
        "name": "Real-Time Fraud Monitoring & Detection",
        "coverage": "Board/CEO-approved real-time digital fraud prevention policy; fraud monitoring engine, behavioural analytics, risk scoring, block/hold suspicious transactions; continuous refinement",
        "deliverables": [
          "Real-time fraud prevention policy",
          "Real-time fraud monitoring system",
          "Transaction risk-scoring & rules engine",
          "Fraud analytics & alerting"
        ],
        "evidence": [
          "Fraud monitoring logs & alerts",
          "Fraud policy document",
          "Risk-scoring config",
          "Blocked/held transaction records"
        ],
        "owner": "Head of Fraud Risk Management",
        "ext": false
      },
      {
        "n": 6,
        "name": "Customer Complaint Handling & Compensation",
        "coverage": "Robust complaint handling; timely remediation; mandatory compensation within 3 working days where controls not implemented in time; root-cause analysis",
        "deliverables": [
          "Enhanced complaint handling mechanism",
          "Fraud complaint escalation workflow",
          "Customer compensation process",
          "Root-cause analysis of fraud"
        ],
        "evidence": [
          "Complaint records & turnaround metrics",
          "Compensation records",
          "Remediation & root-cause reports"
        ],
        "owner": "Head of Customer Experience / Operations",
        "ext": false
      },
      {
        "n": 7,
        "name": "Customer Awareness & Education",
        "coverage": "Ongoing customer education on digital fraud, phishing & social engineering; security tips & warnings across channels",
        "deliverables": [
          "Customer awareness programme",
          "Anti-fraud / anti-phishing campaigns",
          "Security guidance across channels",
          "Awareness effectiveness tracking"
        ],
        "evidence": [
          "Campaign records",
          "Customer communication samples",
          "Reach/effectiveness metrics"
        ],
        "owner": "Head of Marketing / Digital Banking with CISO",
        "ext": false
      },
      {
        "n": 8,
        "name": "Monitoring, Reporting & SBP Supervision",
        "coverage": "Monthly progress reporting to BSD until full implementation; incident reporting to SBP; continuous control review; SBP supervision & enforcement",
        "deliverables": [
          "Monthly progress reports to BSD",
          "Incident & fraud reporting to SBP",
          "Continuous control review",
          "Remediation of SBP findings"
        ],
        "evidence": [
          "Monthly BSD submissions",
          "Incident/fraud reports to SBP",
          "Control review records",
          "SBP correspondence"
        ],
        "owner": "Chief Compliance Officer / CISO",
        "ext": true
      }
    ],
    "loopback": {
      "label": "Continuous fraud monitoring & ongoing SBP reporting",
      "from": 8,
      "to": 5
    },
    "match": [
      "internetbanking"
    ]
  },
  {
    "id": "cbslbss",
    "name": "Sri Lanka Baseline Security Standard (BSS) — CBSL",
    "version": "1.0",
    "controls": 79,
    "group": "Asia — SG / PK / LK",
    "region": "Sri Lanka",
    "authority": "Central Bank of Sri Lanka (CBSL) — Bank Supervision (with FinCSIRT)",
    "assessmentType": "Mandatory baseline: FI self-assessment/gap analysis + board oversight + CBSL reporting",
    "cycle": "Risk-based; at least annual self-assessment & CBSL reporting (ISO 27005-based)",
    "phases": [
      {
        "n": 1,
        "name": "Information Security Governance & Policy",
        "coverage": "IS policy & organisation (ISO 27001-aligned): board-endorsed policy, governance structure, roles, segregation of duties, minimum acceptable baseline",
        "deliverables": [
          "Board-approved IS policy",
          "IS organisation & governance structure",
          "Roles, responsibilities & SoD",
          "BSS scope & applicability statement"
        ],
        "evidence": [
          "Approved IS policy",
          "Governance/committee ToRs",
          "Board endorsement records"
        ],
        "owner": "Board / Senior Mgmt with CISO",
        "ext": false
      },
      {
        "n": 2,
        "name": "Risk Assessment & Treatment (ISO 27005)",
        "coverage": "Identify information assets; risk identification/analysis/evaluation & treatment (ISO 27005); map risks to all BSS controls; SoA",
        "deliverables": [
          "Information asset inventory & classification",
          "Risk assessment & treatment plan (ISO 27005)",
          "Mapping of risks to BSS controls",
          "Risk treatment / acceptance records"
        ],
        "evidence": [
          "Risk assessment reports",
          "Asset register",
          "Risk treatment plan & residual decisions"
        ],
        "owner": "CISO / IS Risk Function",
        "ext": false
      },
      {
        "n": 3,
        "name": "Access Control & HR Security",
        "coverage": "User & privileged access management, least privilege, authentication, teleworking/mobile; personnel screening, awareness & training, acceptable use",
        "deliverables": [
          "Access control & user management",
          "Privileged access & authentication",
          "HR security (screening, on/offboarding)",
          "Awareness & training programme"
        ],
        "evidence": [
          "Access review records",
          "Privileged access logs",
          "Training attendance records",
          "HR security evidence"
        ],
        "owner": "CISO with HR / IT",
        "ext": false
      },
      {
        "n": 4,
        "name": "Network, Comms & Cryptographic Security",
        "coverage": "Network security & segmentation, firewalls, secure communications, cryptographic controls & key management, physical & environmental security",
        "deliverables": [
          "Network security architecture",
          "Cryptographic controls & key management",
          "Physical & environmental security",
          "Secure communications config"
        ],
        "evidence": [
          "Network/firewall config records",
          "Encryption & key mgmt evidence",
          "Data-centre physical/environmental records"
        ],
        "owner": "Head of IT Infrastructure / CISO",
        "ext": false
      },
      {
        "n": 5,
        "name": "Operations, Endpoint & System Security",
        "coverage": "Endpoint protection, malware defence, logging & monitoring, patch & vulnerability management, secure development, change management, capacity & backup",
        "deliverables": [
          "Endpoint & anti-malware controls",
          "Logging, monitoring & vuln/patch mgmt",
          "Secure development & change management",
          "Backup & capacity management"
        ],
        "evidence": [
          "Endpoint/anti-malware records",
          "Patch & vuln scan reports",
          "Change logs",
          "Backup & restore tests"
        ],
        "owner": "Head of IT Operations / CISO",
        "ext": false
      },
      {
        "n": 6,
        "name": "Incident Mgmt & Third-Party Security",
        "coverage": "Incident detection/reporting/response, event & weakness reporting, evidence collection, coordination with FinCSIRT/CERT; third-party & outsourcing controls",
        "deliverables": [
          "Incident management policy & response",
          "Incident reporting workflow (FinCSIRT/CBSL)",
          "Supplier/third-party security controls",
          "Post-incident review process"
        ],
        "evidence": [
          "Incident logs & reports",
          "FinCSIRT/CBSL notifications",
          "Vendor security assessments",
          "Post-incident reviews"
        ],
        "owner": "CISO / Incident Response Team",
        "ext": false
      },
      {
        "n": 7,
        "name": "Business Continuity & Compliance",
        "coverage": "BCP/DR planning, BIA, redundancy, resilience testing; legal/regulatory compliance, records protection, compliance with CBSL directions",
        "deliverables": [
          "BC & DR plans",
          "BIA with RTO/RPO",
          "Compliance register (legal/regulatory)",
          "BCP/DR test programme"
        ],
        "evidence": [
          "BCP/DR plans & test reports",
          "BIA documentation",
          "Compliance monitoring records"
        ],
        "owner": "Head of BCP / Compliance with CISO",
        "ext": false
      },
      {
        "n": 8,
        "name": "Self-Assessment, Audit & CBSL Reporting",
        "coverage": "Periodic self-assessment/gap analysis vs BSS; independent IS audit; remediation; compliance reporting to CBSL; FinCSIRT-supported monitoring",
        "deliverables": [
          "BSS self-assessment / gap analysis",
          "Independent IS audit reports",
          "Remediation action plan",
          "Compliance status reporting to CBSL"
        ],
        "evidence": [
          "Self-assessment gap matrix",
          "Audit reports",
          "Remediation tracking",
          "CBSL/FinCSIRT submissions"
        ],
        "owner": "Internal Audit / CISO with Board oversight",
        "ext": true
      }
    ],
    "loopback": {
      "label": "At least annual self-assessment & CBSL reporting (ISO 27005)",
      "from": 8,
      "to": 2
    },
    "match": [
      "cbsl",
      "srilanka",
      "baselinesecurity"
    ]
  }
];

/** Lowercase + strip everything but a-z0-9, for tolerant name matching. */
export function normalizeFwName(name: string): string {
  return (name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Resolve a platform framework name (e.g. "ISO/IEC 27001:2022",
 * "PCI Data Security Standard", "SAMA Cyber Security Framework") to its flow.
 * Returns the most specific match (longest matched token) or null.
 */
export function matchFrameworkFlow(name: string | null | undefined): FrameworkFlow | null {
  const norm = normalizeFwName(name || '');
  if (!norm) return null;
  let best: FrameworkFlow | null = null;
  let bestLen = 0;
  for (const flow of FRAMEWORK_FLOWS) {
    for (const token of flow.match) {
      if (token && norm.includes(token) && token.length > bestLen) {
        best = flow;
        bestLen = token.length;
      }
    }
  }
  return best;
}
