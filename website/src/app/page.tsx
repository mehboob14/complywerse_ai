import Link from 'next/link';
import { 
  Shield, Library, FileCheck, AlertTriangle, Building2, Bug, Bell,
  Landmark, HeartPulse, Cpu, Zap, ArrowRight, Play, CheckCircle
} from 'lucide-react';

const features = [
  {
    icon: Library,
    title: 'Unified Control Library',
    description: 'AI-powered cross-framework mapping that automatically aligns controls across multiple compliance standards.',
  },
  {
    icon: FileCheck,
    title: 'Evidence Management',
    description: 'Automated evidence collection with AI-powered assessment and gap identification.',
  },
  {
    icon: AlertTriangle,
    title: 'Risk Management',
    description: 'Complete ERM capabilities including RCSA, KRIs, and comprehensive risk assessment workflows.',
  },
  {
    icon: Building2,
    title: 'Governance Hub',
    description: 'Centralized management for policies, committees, attestations, and regulatory tracking.',
  },
  {
    icon: Bug,
    title: 'Vulnerability Management',
    description: 'Track, prioritize, and remediate security vulnerabilities with integrated workflows.',
  },
  {
    icon: Bell,
    title: 'Regulatory Intelligence',
    description: 'Stay ahead of regulatory changes with automated monitoring and impact analysis.',
  },
];

const steps = [
  { step: 1, title: 'Connect Frameworks', description: 'Import your compliance frameworks or choose from our library' },
  { step: 2, title: 'Map Controls', description: 'AI automatically maps controls across frameworks' },
  { step: 3, title: 'Collect Evidence', description: 'Automate evidence gathering and assessment' },
];

const useCases = [
  { 
    icon: Landmark, 
    title: 'Financial Services', 
    frameworks: ['PCI-DSS', 'SOX', 'GDPR', 'Basel III'],
    description: 'Meet stringent financial regulations with comprehensive compliance coverage.'
  },
  { 
    icon: HeartPulse, 
    title: 'Healthcare', 
    frameworks: ['HIPAA', 'HITRUST', 'SOC 2'],
    description: 'Protect patient data while maintaining regulatory compliance.'
  },
  { 
    icon: Cpu, 
    title: 'Technology', 
    frameworks: ['SOC 2', 'ISO 27001', 'NIST CSF'],
    description: 'Scale your compliance program alongside your growing tech stack.'
  },
  { 
    icon: Zap, 
    title: 'Energy & Utilities', 
    frameworks: ['NERC CIP', 'IEC 62443', 'NIST'],
    description: 'Secure critical infrastructure with industry-specific controls.'
  },
];

const stats = [
  { value: '11', label: 'Frameworks' },
  { value: '673+', label: 'Controls' },
  { value: '385+', label: 'Mappings' },
  { value: '99.9%', label: 'Uptime' },
];

export default function HomePage() {
  return (
    <div className="min-h-screen">
      <section className="relative overflow-hidden py-20 sm:py-32">
        <div className="absolute inset-0 bg-gradient-to-br from-indigo-500/10 via-purple-500/5 to-transparent" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-indigo-500/20 rounded-full blur-3xl" />
        
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-4xl mx-auto">
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-white mb-6">
              Simplify Compliance.{' '}
              <span className="gradient-text">Amplify Confidence.</span>
            </h1>
            <p className="text-lg sm:text-xl text-slate-300 mb-8 max-w-2xl mx-auto">
              The intelligent GRC platform that unifies frameworks, automates evidence, and delivers real-time compliance visibility.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Link
                href="/contact"
                className="bg-indigo-600 hover:bg-indigo-500 text-white px-8 py-3 rounded-lg font-medium transition-colors flex items-center justify-center gap-2"
              >
                Request Demo
                <ArrowRight className="h-4 w-4" />
              </Link>
              <button className="border border-slate-600 hover:border-slate-500 text-white px-8 py-3 rounded-lg font-medium transition-colors flex items-center justify-center gap-2">
                <Play className="h-4 w-4" />
                Watch Video
              </button>
            </div>
          </div>
        </div>
      </section>

      <section className="py-20 bg-slate-800/50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4">
              Everything you need to master compliance
            </h2>
            <p className="text-slate-400 max-w-2xl mx-auto">
              A comprehensive platform designed to streamline your GRC operations from start to finish.
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
            {features.map((feature) => (
              <div
                key={feature.title}
                className="bg-slate-800 p-6 rounded-xl border border-slate-700 hover:border-indigo-500/50 transition-colors group"
              >
                <div className="w-12 h-12 bg-indigo-500/20 rounded-lg flex items-center justify-center mb-4 group-hover:bg-indigo-500/30 transition-colors">
                  <feature.icon className="h-6 w-6 text-indigo-400" />
                </div>
                <h3 className="text-xl font-semibold text-white mb-2">{feature.title}</h3>
                <p className="text-slate-400">{feature.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4">
              How It Works
            </h2>
            <p className="text-slate-400 max-w-2xl mx-auto">
              Get started in minutes with our streamlined onboarding process.
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-8">
            {steps.map((step, index) => (
              <div key={step.step} className="relative">
                <div className="bg-slate-800 p-8 rounded-xl border border-slate-700 text-center h-full">
                  <div className="w-16 h-16 bg-indigo-600 rounded-full flex items-center justify-center mx-auto mb-6 text-2xl font-bold text-white">
                    {step.step}
                  </div>
                  <h3 className="text-xl font-semibold text-white mb-2">{step.title}</h3>
                  <p className="text-slate-400">{step.description}</p>
                </div>
                {index < steps.length - 1 && (
                  <div className="hidden md:block absolute top-1/2 -right-4 transform -translate-y-1/2">
                    <ArrowRight className="h-8 w-8 text-indigo-500" />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="use-cases" className="py-20 bg-slate-800/50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4">
              Built for Every Industry
            </h2>
            <p className="text-slate-400 max-w-2xl mx-auto">
              Tailored compliance solutions for your specific regulatory requirements.
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
            {useCases.map((useCase) => (
              <div
                key={useCase.title}
                className="bg-slate-800 p-6 rounded-xl border border-slate-700 hover:border-indigo-500/50 transition-colors"
              >
                <div className="w-12 h-12 bg-indigo-500/20 rounded-lg flex items-center justify-center mb-4">
                  <useCase.icon className="h-6 w-6 text-indigo-400" />
                </div>
                <h3 className="text-lg font-semibold text-white mb-2">{useCase.title}</h3>
                <p className="text-slate-400 text-sm mb-4">{useCase.description}</p>
                <div className="flex flex-wrap gap-2">
                  {useCase.frameworks.map((framework) => (
                    <span
                      key={framework}
                      className="text-xs bg-slate-700 text-slate-300 px-2 py-1 rounded"
                    >
                      {framework}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
            {stats.map((stat) => (
              <div key={stat.label} className="text-center">
                <div className="text-4xl sm:text-5xl font-bold text-indigo-400 mb-2">{stat.value}</div>
                <div className="text-slate-400">{stat.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-20 bg-gradient-to-br from-indigo-600 to-purple-700">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4">
            Ready to transform your GRC operations?
          </h2>
          <p className="text-indigo-100 mb-8 max-w-2xl mx-auto">
            Join leading enterprises who trust ComplyVerse to manage their compliance programs.
          </p>
          <Link
            href="/contact"
            className="inline-flex items-center gap-2 bg-white text-indigo-600 px-8 py-3 rounded-lg font-medium hover:bg-indigo-50 transition-colors"
          >
            Request Demo
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>
    </div>
  );
}
