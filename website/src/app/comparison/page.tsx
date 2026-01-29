import { Check, X, Minus, ArrowRight } from 'lucide-react';
import Link from 'next/link';

const features = [
  { name: 'Framework Support', complyverse: '11+ Frameworks', servicenow: '8 Frameworks', archer: '6 Frameworks', onetrust: '10 Frameworks', logicgate: '5 Frameworks' },
  { name: 'AI Control Mapping', complyverse: true, servicenow: false, archer: false, onetrust: 'Limited', logicgate: false },
  { name: 'Evidence AI Assessment', complyverse: true, servicenow: false, archer: false, onetrust: false, logicgate: false },
  { name: 'Multi-Tenancy', complyverse: true, servicenow: true, archer: true, onetrust: true, logicgate: false },
  { name: 'API Access', complyverse: 'Full REST API', servicenow: 'Enterprise Only', archer: 'Limited', onetrust: 'Full REST API', logicgate: 'REST API' },
  { name: 'RCSA Campaigns', complyverse: true, servicenow: true, archer: true, onetrust: false, logicgate: true },
  { name: 'Custom Framework Import', complyverse: true, servicenow: 'Manual Only', archer: 'Manual Only', onetrust: true, logicgate: false },
  { name: 'Regulatory Intelligence', complyverse: true, servicenow: 'Add-on', archer: false, onetrust: true, logicgate: false },
  { name: 'Implementation Time', complyverse: '2-4 Weeks', servicenow: '3-6 Months', archer: '4-8 Months', onetrust: '4-8 Weeks', logicgate: '4-6 Weeks' },
  { name: 'Starting Price', complyverse: 'Contact Us', servicenow: '$100k+/year', archer: '$150k+/year', onetrust: '$50k+/year', logicgate: '$30k+/year' },
];

const competitors = [
  { key: 'complyverse', name: 'ComplyVerse', highlight: true },
  { key: 'servicenow', name: 'ServiceNow GRC', highlight: false },
  { key: 'archer', name: 'Archer', highlight: false },
  { key: 'onetrust', name: 'OneTrust', highlight: false },
  { key: 'logicgate', name: 'LogicGate', highlight: false },
];

function renderValue(value: boolean | string) {
  if (value === true) return <Check className="h-5 w-5 text-green-400 mx-auto" />;
  if (value === false) return <X className="h-5 w-5 text-red-400 mx-auto" />;
  if (value === 'Limited') return <Minus className="h-5 w-5 text-yellow-400 mx-auto" />;
  return <span className="text-sm">{value}</span>;
}

export default function ComparisonPage() {
  return (
    <div className="min-h-screen py-20">
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mb-16">
        <div className="text-center max-w-3xl mx-auto">
          <h1 className="text-4xl sm:text-5xl font-bold text-white mb-6">
            How We <span className="gradient-text">Compare</span>
          </h1>
          <p className="text-lg text-slate-300">
            See how ComplyVerse stacks up against traditional GRC platforms in key capabilities.
          </p>
        </div>
      </section>

      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mb-20">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[800px]">
            <thead>
              <tr className="border-b border-slate-700">
                <th className="text-left py-4 px-4 text-slate-400 font-medium">Feature</th>
                {competitors.map((competitor) => (
                  <th
                    key={competitor.key}
                    className={`py-4 px-4 text-center ${
                      competitor.highlight
                        ? 'bg-indigo-600/20 text-indigo-400 font-semibold'
                        : 'text-slate-400 font-medium'
                    }`}
                  >
                    {competitor.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {features.map((feature, index) => (
                <tr key={feature.name} className={index % 2 === 0 ? 'bg-slate-800/30' : ''}>
                  <td className="py-4 px-4 text-white font-medium">{feature.name}</td>
                  <td className="py-4 px-4 text-center bg-indigo-600/10 text-white">
                    {renderValue(feature.complyverse)}
                  </td>
                  <td className="py-4 px-4 text-center text-slate-400">
                    {renderValue(feature.servicenow)}
                  </td>
                  <td className="py-4 px-4 text-center text-slate-400">
                    {renderValue(feature.archer)}
                  </td>
                  <td className="py-4 px-4 text-center text-slate-400">
                    {renderValue(feature.onetrust)}
                  </td>
                  <td className="py-4 px-4 text-center text-slate-400">
                    {renderValue(feature.logicgate)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mb-20">
        <div className="grid md:grid-cols-3 gap-8">
          <div className="bg-slate-800 p-6 rounded-xl border border-slate-700">
            <h3 className="text-xl font-semibold text-white mb-3">AI-First Approach</h3>
            <p className="text-slate-400">
              Unlike legacy platforms, ComplyVerse was built from the ground up with AI at its core, enabling automated control mapping and evidence assessment.
            </p>
          </div>
          <div className="bg-slate-800 p-6 rounded-xl border border-slate-700">
            <h3 className="text-xl font-semibold text-white mb-3">Faster Implementation</h3>
            <p className="text-slate-400">
              Get up and running in weeks, not months. Our modern architecture and pre-built integrations dramatically reduce time to value.
            </p>
          </div>
          <div className="bg-slate-800 p-6 rounded-xl border border-slate-700">
            <h3 className="text-xl font-semibold text-white mb-3">True Multi-Framework</h3>
            <p className="text-slate-400">
              Native support for cross-framework mapping eliminates duplicate work and provides unified compliance visibility across all standards.
            </p>
          </div>
        </div>
      </section>

      <section className="py-20 bg-gradient-to-br from-indigo-600 to-purple-700">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4">
            Ready to Switch to a Modern GRC Platform?
          </h2>
          <p className="text-indigo-100 mb-8 max-w-2xl mx-auto">
            Let us show you how ComplyVerse can modernize your compliance operations.
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
