'use client';

import Link from 'next/link';
import {
  BarChart3,
  Target,
  GitBranch,
  Layers,
  Activity,
  AlertTriangle,
  ArrowRight,
  TrendingUp,
} from 'lucide-react';

const analyticsModules = [
  {
    title: 'Interactive Heat Maps',
    description: 'Visualize risk distribution across likelihood and impact dimensions with drill-down capability. Filter by category, business unit, and treatment plan.',
    href: '/erm/analytics/heatmap',
    icon: BarChart3,
    color: 'from-red-500 to-orange-500',
    features: ['Inherent vs Residual toggle', 'Category filtering', 'Drill-down on cells', 'Risk detail popover'],
  },
  {
    title: 'Bow-Tie Analysis',
    description: 'Comprehensive cause-and-effect visualization showing threats, preventive controls, risk event, mitigating controls, and consequences for any risk.',
    href: '/erm/analytics/bowtie',
    icon: GitBranch,
    color: 'from-blue-500 to-cyan-500',
    features: ['Threat identification', 'Preventive controls', 'Mitigating controls', 'Consequence mapping'],
  },
  {
    title: 'Scenario Analysis',
    description: 'Model what-if scenarios by adjusting risk likelihood and impact. Use preset scenarios or create custom ones to understand portfolio impact.',
    href: '/erm/analytics/scenario',
    icon: Target,
    color: 'from-purple-500 to-pink-500',
    features: ['Preset scenarios', 'Custom adjustments', 'Portfolio impact', 'Before/after comparison'],
  },
  {
    title: 'Risk Aggregation',
    description: 'Enterprise-wide risk aggregation across categories, business units, and status. Track total risk exposure and reduction effectiveness.',
    href: '/erm/analytics/aggregation',
    icon: Layers,
    color: 'from-emerald-500 to-teal-500',
    features: ['Enterprise summary', 'Category breakdown', 'Business unit view', 'Risk reduction tracking'],
  },
  {
    title: 'Automated KRI Triggers',
    description: 'Monitor Key Risk Indicators in real-time with automated threshold breach detection. View alerts by severity with recommended corrective actions.',
    href: '/erm/analytics/kri-triggers',
    icon: Activity,
    color: 'from-amber-500 to-yellow-500',
    features: ['Threshold monitoring', 'Breach alerts', 'Severity classification', 'Recommended actions'],
  },
];

export default function AnalyticsPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-3">
            <TrendingUp className="h-7 w-7 text-blue-400" />
            Advanced Risk Analytics
          </h1>
          <p className="text-slate-600 mt-1">
            Comprehensive risk analysis tools for enterprise risk intelligence
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {analyticsModules.map((module) => (
          <Link
            key={module.href}
            href={module.href}
            className="group bg-white border border-slate-200 rounded-xl p-6 hover:border-slate-300 transition-all hover:shadow-lg hover:shadow-blue-500/5"
          >
            <div className="flex items-start gap-4">
              <div className={`p-3 rounded-lg bg-gradient-to-br ${module.color} bg-opacity-20`}>
                <module.icon className="h-6 w-6 text-slate-900" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-lg font-semibold text-slate-900 group-hover:text-blue-400 transition-colors flex items-center gap-2">
                  {module.title}
                  <ArrowRight className="h-4 w-4 opacity-0 group-hover:opacity-100 transition-opacity" />
                </h3>
                <p className="text-sm text-slate-600 mt-1 line-clamp-2">
                  {module.description}
                </p>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              {module.features.map((feature) => (
                <span
                  key={feature}
                  className="text-xs px-2 py-1 rounded-full bg-slate-100/50 text-slate-700"
                >
                  {feature}
                </span>
              ))}
            </div>
          </Link>
        ))}
      </div>

      <div className="bg-white/50 border border-slate-200 rounded-xl p-6">
        <div className="flex items-center gap-3 mb-3">
          <AlertTriangle className="h-5 w-5 text-amber-400" />
          <h3 className="text-lg font-semibold text-slate-900">Quick Access</h3>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {analyticsModules.map((module) => (
            <Link
              key={module.href}
              href={module.href}
              className="flex items-center gap-2 px-3 py-2 bg-slate-100/30 rounded-lg hover:bg-slate-100/60 transition-colors text-sm text-slate-700 hover:text-slate-900"
            >
              <module.icon className="h-4 w-4" />
              {module.title.split(' ').slice(0, 2).join(' ')}
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
