'use client';

/**
 * Compact cross-module summary for the evidence detail page: a row of count
 * chips (Controls / Risks / Assets / Incidents / Policy statements) derived
 * from the already-loaded controls + all-links data. Each chip is an in-page
 * anchor to the relevant detail section below.
 *
 * Presentational only. Charter: single teal brand (primary-*), category tints
 * only as markers, hairline borders, no gradients, lucide strokeWidth 1.75.
 */

import { Shield, AlertTriangle, Building2, AlertCircle, FileText, Link2 } from 'lucide-react';

export default function EvidenceCrossMap({
  controls,
  risks,
  assets,
  incidents,
  policyStatements,
  controlsHref = '#linked-controls',
  crossLinksHref = '#cross-module',
}: {
  controls: number;
  risks: number;
  assets: number;
  incidents: number;
  policyStatements: number;
  controlsHref?: string;
  crossLinksHref?: string;
}) {
  const chips: Array<{
    key: string;
    label: string;
    count: number;
    icon: typeof Shield;
    color: string;
    href: string;
  }> = [
    { key: 'controls', label: 'Controls', count: controls, icon: Shield, color: 'text-primary-600', href: controlsHref },
    { key: 'risks', label: 'Risks', count: risks, icon: AlertTriangle, color: 'text-rose-600', href: crossLinksHref },
    { key: 'assets', label: 'Assets', count: assets, icon: Building2, color: 'text-primary-600', href: crossLinksHref },
    { key: 'incidents', label: 'Incidents', count: incidents, icon: AlertCircle, color: 'text-orange-600', href: crossLinksHref },
    { key: 'policy', label: 'Policy statements', count: policyStatements, icon: FileText, color: 'text-primary-600', href: crossLinksHref },
  ];

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-800">
        <Link2 className="h-4 w-4 text-primary-600" strokeWidth={1.75} />
        Linked across the platform
      </h3>
      <div className="flex flex-wrap gap-2">
        {chips.map(({ key, label, count, icon: Icon, color, href }) => (
          <a
            key={key}
            href={href}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 transition-colors hover:border-primary-300 hover:bg-primary-50"
          >
            <Icon className={`h-4 w-4 ${color}`} strokeWidth={1.75} />
            <span className="font-semibold text-slate-900">{count}</span>
            <span className="text-slate-500">{label}</span>
          </a>
        ))}
      </div>
    </div>
  );
}
