'use client';

/**
 * JourneyMeta — the shared identity band for a framework's compliance journey:
 * name + group/region/version chips, at-a-glance stats, Authority / Assessment /
 * Cadence, and the internal/external/loop legend. Rendered above both the Map and
 * List views; `right` is a slot for the view toggle.
 */

import { useMemo } from 'react';
import { Landmark, Repeat, Route, ShieldCheck } from 'lucide-react';
import type { FrameworkFlow } from '../_data/frameworkFlows';

interface Props {
  flow: FrameworkFlow;
  liveControls?: number;
  right?: React.ReactNode;
}

export default function JourneyMeta({ flow, liveControls, right }: Props) {
  const stats = useMemo(() => {
    const external = flow.phases.filter((p) => p.ext).length;
    const deliverables = flow.phases.reduce((s, p) => s + (p.deliverables?.length || 0), 0);
    const artifacts = flow.phases.reduce((s, p) => s + (p.evidence?.length || 0), 0);
    return { stages: flow.phases.length, external, deliverables, artifacts };
  }, [flow]);

  return (
    <div className="cw-card overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-100 p-5">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-primary-700">
            <Route className="h-4 w-4" strokeWidth={1.75} />
            End-to-end compliance journey
          </div>
          <h2 className="mt-1.5 text-lg font-bold leading-snug text-slate-900">{flow.name}</h2>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <MetaChip>{flow.group}</MetaChip>
            <MetaChip>{flow.region}</MetaChip>
            <MetaChip>v{flow.version}</MetaChip>
          </div>
        </div>
        <div className="flex flex-col items-stretch gap-3 sm:items-end">
          {right && <div className="flex justify-end">{right}</div>}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="Stages" value={stats.stages} />
            <Stat label="External checks" value={stats.external} tone="amber" />
            <Stat label="Deliverables" value={stats.deliverables} />
            <Stat label="Artifacts" value={stats.artifacts} />
          </div>
        </div>
      </div>

      <dl className="grid grid-cols-1 divide-y divide-slate-100 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        <DefItem icon={<Landmark className="h-4 w-4" strokeWidth={1.75} />} term="Authority">
          {flow.authority}
        </DefItem>
        <DefItem icon={<ShieldCheck className="h-4 w-4" strokeWidth={1.75} />} term="Assessment">
          {flow.assessmentType}
        </DefItem>
        <DefItem icon={<Repeat className="h-4 w-4" strokeWidth={1.75} />} term="Cadence">
          {flow.cycle}
        </DefItem>
      </dl>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-slate-100 bg-slate-50/60 px-5 py-3 text-xs text-slate-500">
        <LegendItem swatch="teal" label="Your compliance work (internal)" />
        <LegendItem swatch="amber" label="External audit / certifier / regulator" />
        <span className="flex items-center gap-1.5">
          <Repeat className="h-3.5 w-3.5 text-primary-600" strokeWidth={2} />
          {flow.loopback.label}
        </span>
        {typeof liveControls === 'number' && liveControls > 0 && (
          <span className="ml-auto text-slate-400">{liveControls} requirements in this workspace</span>
        )}
      </div>
    </div>
  );
}

function MetaChip({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-[11px] font-medium text-slate-600">
      {children}
    </span>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'amber' }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50/70 px-3 py-1.5 text-center">
      <div className={`text-lg font-bold leading-none ${tone === 'amber' ? 'text-amber-600' : 'text-primary-700'}`}>
        {value}
      </div>
      <div className="mt-1 text-[10px] font-medium uppercase tracking-wide text-slate-400">{label}</div>
    </div>
  );
}

function DefItem({ icon, term, children }: { icon: React.ReactNode; term: string; children: React.ReactNode }) {
  return (
    <div className="px-5 py-3.5">
      <dt className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
        <span className="text-primary-600">{icon}</span>
        {term}
      </dt>
      <dd className="text-xs leading-relaxed text-slate-700">{children}</dd>
    </div>
  );
}

function LegendItem({ swatch, label }: { swatch: 'teal' | 'amber'; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={`inline-block h-2.5 w-2.5 rounded-sm ${swatch === 'teal' ? 'bg-primary-500' : 'bg-amber-400'}`} />
      {label}
    </span>
  );
}
