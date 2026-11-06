// The questions the old editor loaded by category ("Load Security Defaults"), kept as sets the library picker and the
// "New questionnaire" dialog offer. Moved here as they were; the wording is the organisation's to change after adding them.
import type { LibrarySet, Question } from './types.ts';

const DEFAULT_QUESTIONS: Record<string, Question[]> = {
  security: [
    { id: 's1', text: 'Does your organization encrypt data at rest and in transit using industry-standard encryption (e.g., AES-256, TLS 1.2+)?', type: 'yes_no', required: true, evidence_required: true, weight: 5, options: [] },
    { id: 's2', text: 'Do you enforce multi-factor authentication (MFA) for all system access?', type: 'yes_no', required: true, evidence_required: false, weight: 4, options: [] },
    { id: 's3', text: 'Describe your access control policies (RBAC, least privilege, access reviews).', type: 'text', required: true, evidence_required: true, weight: 4, options: [] },
    { id: 's4', text: 'Do you have a documented incident response plan that is tested at least annually?', type: 'yes_no', required: true, evidence_required: true, weight: 5, options: [] },
    { id: 's5', text: 'How frequently do you perform vulnerability scanning on your systems?', type: 'multiple_choice', required: true, evidence_required: false, weight: 4, options: ['Continuous', 'Weekly', 'Monthly', 'Quarterly', 'Annually', 'Never'] },
    { id: 's6', text: 'When was your last third-party penetration test conducted? Provide the executive summary.', type: 'text', required: true, evidence_required: true, weight: 5, options: [] },
    { id: 's7', text: 'Is your network segmented to isolate sensitive data and critical systems?', type: 'yes_no', required: true, evidence_required: false, weight: 3, options: [] },
    { id: 's8', text: 'What endpoint protection solution do you use across your fleet?', type: 'text', required: true, evidence_required: false, weight: 3, options: [] },
    { id: 's9', text: 'Do you conduct security awareness training for all employees? How frequently?', type: 'multiple_choice', required: true, evidence_required: true, weight: 3, options: ['Quarterly', 'Semi-annually', 'Annually', 'At onboarding only', 'No training program'] },
    { id: 's10', text: 'What is your average patch management SLA for critical vulnerabilities?', type: 'multiple_choice', required: true, evidence_required: false, weight: 4, options: ['Within 24 hours', 'Within 72 hours', 'Within 7 days', 'Within 30 days', 'No formal SLA'] },
  ],
  privacy: [
    { id: 'p1', text: 'Do you have a signed Data Processing Agreement (DPA) or equivalent data protection addendum?', type: 'yes_no', required: true, evidence_required: true, weight: 5, options: [] },
    { id: 'p2', text: 'Describe your data retention and deletion policy. What are the retention periods?', type: 'text', required: true, evidence_required: true, weight: 4, options: [] },
    { id: 'p3', text: 'How do you handle data subject access requests (DSARs) and right-to-erasure requests?', type: 'text', required: true, evidence_required: false, weight: 4, options: [] },
    { id: 'p4', text: 'Do you transfer personal data across international borders? If yes, what transfer mechanisms are in place?', type: 'text', required: true, evidence_required: true, weight: 5, options: [] },
    { id: 'p5', text: 'Do you conduct Privacy Impact Assessments (PIAs) for new processing activities?', type: 'yes_no', required: true, evidence_required: true, weight: 4, options: [] },
    { id: 'p6', text: 'What is your data breach notification timeline to affected parties and regulators?', type: 'multiple_choice', required: true, evidence_required: false, weight: 5, options: ['Within 24 hours', 'Within 48 hours', 'Within 72 hours', 'Within 7 days', 'No defined timeline'] },
    { id: 'p7', text: 'Describe your data minimization practices. How do you ensure only necessary data is collected?', type: 'text', required: true, evidence_required: false, weight: 3, options: [] },
    { id: 'p8', text: 'Do you use sub-processors? If yes, provide a list and explain oversight mechanisms.', type: 'text', required: true, evidence_required: true, weight: 4, options: [] },
  ],
  compliance: [
    { id: 'c1', text: 'Which security certifications does your organization currently hold?', type: 'multiple_choice', required: true, evidence_required: true, weight: 5, options: ['SOC 2 Type II', 'ISO 27001', 'PCI DSS', 'HIPAA', 'FedRAMP', 'CSA STAR', 'None'] },
    { id: 'c2', text: 'When was your most recent external audit completed? Share the audit report or certification.', type: 'text', required: true, evidence_required: true, weight: 5, options: [] },
    { id: 'c3', text: 'How do you monitor and respond to changes in regulatory requirements relevant to your services?', type: 'text', required: true, evidence_required: false, weight: 3, options: [] },
    { id: 'c4', text: 'Do you provide compliance training to employees? How often?', type: 'multiple_choice', required: true, evidence_required: false, weight: 3, options: ['Quarterly', 'Semi-annually', 'Annually', 'At onboarding only', 'No training'] },
    { id: 'c5', text: 'Do you screen against sanctions lists (OFAC, EU sanctions) for your customers and partners?', type: 'yes_no', required: true, evidence_required: false, weight: 4, options: [] },
    { id: 'c6', text: 'Do you have an anti-bribery and anti-corruption policy in place?', type: 'yes_no', required: true, evidence_required: true, weight: 3, options: [] },
  ],
  operational: [
    { id: 'o1', text: 'Do you have a documented Business Continuity Plan (BCP) and Disaster Recovery (DR) plan?', type: 'yes_no', required: true, evidence_required: true, weight: 5, options: [] },
    { id: 'o2', text: 'What are your Recovery Time Objective (RTO) and Recovery Point Objective (RPO) targets?', type: 'text', required: true, evidence_required: false, weight: 4, options: [] },
    { id: 'o3', text: 'Describe your change management process for production systems.', type: 'text', required: true, evidence_required: true, weight: 4, options: [] },
    { id: 'o4', text: 'How do you monitor SLA compliance and system uptime? What is your guaranteed uptime?', type: 'text', required: true, evidence_required: false, weight: 4, options: [] },
    { id: 'o5', text: 'Describe your incident escalation process and communication plan during outages.', type: 'text', required: true, evidence_required: true, weight: 3, options: [] },
    { id: 'o6', text: 'What measures do you take to ensure staff continuity and knowledge transfer?', type: 'text', required: true, evidence_required: false, weight: 3, options: [] },
  ],
  financial: [
    { id: 'f1', text: 'Can you provide audited financial statements or evidence of financial stability?', type: 'yes_no', required: true, evidence_required: true, weight: 5, options: [] },
    { id: 'f2', text: 'What types of insurance coverage do you maintain (cyber liability, E&O, general liability)?', type: 'text', required: true, evidence_required: true, weight: 4, options: [] },
    { id: 'f3', text: 'Describe your billing practices and payment terms.', type: 'text', required: true, evidence_required: false, weight: 2, options: [] },
    { id: 'f4', text: 'What are the terms for contract termination, including data return and transition assistance?', type: 'text', required: true, evidence_required: false, weight: 3, options: [] },
    { id: 'f5', text: 'Do you provide regular financial performance reports to clients upon request?', type: 'yes_no', required: false, evidence_required: false, weight: 2, options: [] },
  ],
};

const NAMES: Record<string, string> = {
  security: 'Security basics', privacy: 'Privacy basics', compliance: 'Compliance basics',
  operational: 'Operational basics', financial: 'Financial basics',
};
const upper = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// Each question lands in a section named for its set, so the reviewers-per-section split has something to split on.
export const STARTER_SETS: LibrarySet[] = Object.entries(DEFAULT_QUESTIONS).map(([category, questions]) => ({
  key: `starter-${category}`,
  name: NAMES[category] ?? category,
  description: null,
  source: 'starter' as const,
  questions: questions.map((q) => ({ ...q, section: upper(category) })),
}));
