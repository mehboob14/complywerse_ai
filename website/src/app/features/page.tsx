import { 
  Library, FileCheck, AlertTriangle, Building2, Bug, Bell,
  CheckCircle, ArrowRight
} from 'lucide-react';
import Link from 'next/link';

const modules = [
  {
    icon: Library,
    title: 'Unified Control Library',
    description: 'AI-powered cross-framework mapping that automatically aligns controls across multiple compliance standards, eliminating redundancy and providing a single source of truth.',
    capabilities: [
      'Support for 11+ regulatory frameworks',
      'AI-driven control mapping and alignment',
      'Gap analysis and coverage reports',
      'Custom framework import via PDF/Excel',
      'Cross-framework requirement deduplication',
      'Control inheritance and hierarchy management',
    ],
  },
  {
    icon: FileCheck,
    title: 'Evidence Management',
    description: 'Automated evidence collection with AI-powered assessment that validates compliance artifacts and identifies gaps before auditors do.',
    capabilities: [
      'Automated evidence collection workflows',
      'AI-powered evidence assessment',
      'Evidence-to-control linking',
      'Audit package generation',
      'Evidence lifecycle management',
      'OCR for document processing',
    ],
  },
  {
    icon: AlertTriangle,
    title: 'Risk Management',
    description: 'Complete Enterprise Risk Management capabilities including Risk Control Self-Assessments (RCSA), Key Risk Indicators (KRIs), and comprehensive risk workflows.',
    capabilities: [
      'Risk register with scoring matrices',
      'RCSA campaigns and templates',
      'Key Risk Indicators (KRI) tracking',
      'Risk appetite and tolerance settings',
      'Mitigation action tracking',
      'Risk review and approval workflows',
    ],
  },
  {
    icon: Building2,
    title: 'Governance Hub',
    description: 'Centralized governance for policies, committees, attestations, and regulatory tracking with complete audit trails.',
    capabilities: [
      'Policy lifecycle management',
      'Committee meeting management',
      'Attestation campaigns',
      'Document version control',
      'Approval workflows',
      'Regulatory change tracking',
    ],
  },
  {
    icon: Bug,
    title: 'Vulnerability Management',
    description: 'Track, prioritize, and remediate security vulnerabilities with integrated workflows and SLA management.',
    capabilities: [
      'Vulnerability tracking and scoring',
      'Department-based assignments',
      'SLA monitoring and escalations',
      'Remediation workflows',
      'Exception management',
      'Integration with security scanners',
    ],
  },
  {
    icon: Bell,
    title: 'Regulatory Intelligence',
    description: 'Stay ahead of regulatory changes with automated monitoring, impact analysis, and proactive compliance updates.',
    capabilities: [
      'Regulatory feed monitoring',
      'Change impact analysis',
      'Framework update notifications',
      'Compliance calendar',
      'Regulatory mapping to controls',
      'Automated compliance updates',
    ],
  },
];

export default function FeaturesPage() {
  return (
    <div className="min-h-screen py-20">
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mb-20">
        <div className="text-center max-w-3xl mx-auto">
          <h1 className="text-4xl sm:text-5xl font-bold text-white mb-6">
            Powerful Features for{' '}
            <span className="gradient-text">Complete GRC</span>
          </h1>
          <p className="text-lg text-slate-300">
            Six integrated modules working together to deliver comprehensive governance, risk, and compliance management.
          </p>
        </div>
      </section>

      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="space-y-20">
          {modules.map((module, index) => (
            <div
              key={module.title}
              className={`grid lg:grid-cols-2 gap-12 items-center ${
                index % 2 === 1 ? 'lg:flex-row-reverse' : ''
              }`}
            >
              <div className={index % 2 === 1 ? 'lg:order-2' : ''}>
                <div className="w-16 h-16 bg-indigo-500/20 rounded-xl flex items-center justify-center mb-6">
                  <module.icon className="h-8 w-8 text-indigo-400" />
                </div>
                <h2 className="text-3xl font-bold text-white mb-4">{module.title}</h2>
                <p className="text-slate-300 mb-6">{module.description}</p>
                <ul className="space-y-3">
                  {module.capabilities.map((capability) => (
                    <li key={capability} className="flex items-start gap-3">
                      <CheckCircle className="h-5 w-5 text-indigo-400 flex-shrink-0 mt-0.5" />
                      <span className="text-slate-400">{capability}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className={`bg-slate-800 rounded-2xl p-8 border border-slate-700 ${index % 2 === 1 ? 'lg:order-1' : ''}`}>
                <div className="aspect-video bg-slate-700/50 rounded-lg flex items-center justify-center">
                  <module.icon className="h-24 w-24 text-slate-600" />
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-20 py-20 bg-gradient-to-br from-indigo-600 to-purple-700">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4">
            See All Features in Action
          </h2>
          <p className="text-indigo-100 mb-8 max-w-2xl mx-auto">
            Schedule a personalized demo to explore how ComplyVerse can transform your compliance operations.
          </p>
          <Link
            href="/demo"
            className="inline-flex items-center gap-2 bg-white text-indigo-600 px-8 py-3 rounded-lg font-medium hover:bg-indigo-50 transition-colors"
          >
            Explore Demo
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>
    </div>
  );
}
