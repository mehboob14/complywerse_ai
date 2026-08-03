'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { AlertTriangle, Boxes, FileStack, Library, Shield, ShieldCheck, Gavel, Radar as RadarIcon, SlidersHorizontal } from 'lucide-react';
import {
  ResponsiveContainer, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  Radar, Tooltip as RTooltip,
  BarChart, Bar, Cell, XAxis, YAxis, ReferenceArea, ReferenceLine,
} from 'recharts';
import { complianceApi } from '@/lib/api';
import {
  type OverviewSection,
  scoreBand,
  ScoreRing,
  SectionDetailModal,
  SCORECARD_SECTION_GRID,
} from '@/components/dashboard/score-kit';
import { SectionWeightTunerModal } from '@/components/dashboard/score-tuning';

import { SCORECARD_QUERY_KEYS } from '@/components/dashboard/scorecard-query-keys';

const COMPLIANCE_TUNING = { configBase: '/compliance/policies/dashboard', invalidateKey: [...SCORECARD_QUERY_KEYS.compliance] as unknown[] };

/**
 * Compliance module board dashboard — board-level and graphical, in the spirit
 * of the Governance overview: a performance hero, a compliance-posture RADAR
 * across the four compliance pages, and section detail cards (zone-column charts:
 * every metric a column over tinted weak/fair/strong bands with the dashed 85
 * target) whose formulas open in the shared popup. One scored section per
 * Compliance nav page: Frameworks · Controls · Evidence · Control Library.
 */

type Payload = {
  as_of: string;
  sections: Record<string, OverviewSection>;
  attention_queue: Record<string, number>;
  performance: { score: number | null; grade: string | null };
};

const SECTION_META: Record<string, { icon: React.ElementType; href: string; short: string }> = {
  frameworks: { icon: Boxes, href: '/frameworks', short: 'Frameworks' },
  controls: { icon: Shield, href: '/controls', short: 'Controls' },
  effectiveness: { icon: ShieldCheck, href: '/control-library', short: 'Effectiveness' },
  evidence: { icon: FileStack, href: '/evidence', short: 'Evidence' },
  control_library: { icon: Library, href: '/control-library', short: 'Library' },
  regulatory: { icon: Gavel, href: '/governance/regulatory-changes', short: 'Regulatory' },
};

const ATTENTION_META: Array<{ key: string; label: string; href: string; color: string }> = [
  { key: 'frameworks_unpublished', label: 'Frameworks not published', href: '/framework-upload', color: '#f59e0b' },
  { key: 'controls_without_evidence', label: 'Controls without evidence', href: '/controls', color: '#64748b' },
  { key: 'controls_unverified', label: 'Controls unverified', href: '/controls', color: '#8b5cf6' },
  { key: 'controls_untested', label: 'Controls not tested', href: '/control-library', color: '#0ea5e9' },
  { key: 'overdue_control_tests', label: 'Overdue control tests', href: '/control-library', color: '#f97316' },
  { key: 'evidence_stale', label: 'Stale evidence', href: '/evidence', color: '#e11d48' },
];

/** Zone columns — one column per metric over tinted weak/fair/strong bands with
 *  the dashed 85 target. The shortfall below the line IS the story at a glance. */
function ZoneColumns({ metrics }: { metrics: OverviewSection['metrics'] }) {
  const data = metrics.map((m) => ({
    key: m.key, label: m.label,
    score: m.score == null ? 0 : Math.round(m.score),
    hasData: m.score != null,
    fill: scoreBand(m.score).hex,
  }));
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 8, right: 6, bottom: 0, left: 6 }} barCategoryGap="26%">
        <YAxis type="number" domain={[0, 100]} hide />
        <XAxis dataKey="key" hide />
        {/* performance zones: weak / fair / strong */}
        <ReferenceArea y1={0} y2={60} fill="#e11d48" fillOpacity={0.05} />
        <ReferenceArea y1={60} y2={80} fill="#d97706" fillOpacity={0.06} />
        <ReferenceArea y1={80} y2={100} fill="#059669" fillOpacity={0.06} />
        <ReferenceLine y={85} stroke="#475569" strokeDasharray="4 3" strokeWidth={1} />
        <RTooltip
          cursor={{ fill: 'rgba(148,163,184,0.08)' }}
          contentStyle={{ fontSize: 12, border: '1px solid #e2e8f0', borderRadius: 8, color: '#1e293b' }}
          formatter={(v, _n, entry) => [`${v}%`, (entry?.payload as { label?: string })?.label ?? '']}
          labelFormatter={() => ''}
        />
        <Bar dataKey="score" radius={[3, 3, 0, 0]} isAnimationActive={false} minPointSize={2}>
          {data.map((d) => (
            <Cell key={d.key} fill={d.hasData ? d.fill : '#e2e8f0'} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function SectionCard({ section, onOpen }: { section: OverviewSection; onOpen: () => void }) {
  const band = scoreBand(section.score);
  const Icon = SECTION_META[section.key]?.icon ?? Boxes;
  return (
    <button type="button" onClick={onOpen}
      className="group flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white text-left shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/30">
      <div className="h-[3px] w-full" style={{ backgroundColor: band.hex }} />
      <div className="flex flex-1 flex-col p-4">
        <div className="mb-2 flex items-start justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg" style={{ backgroundColor: `${band.hex}14` }}>
              <Icon className="h-4 w-4" style={{ color: band.hex }} />
            </span>
            <div className="min-w-0">
              <h3 className="truncate text-sm font-semibold text-slate-800">{section.label}</h3>
              <p className="text-[10px] text-slate-400">{Math.round(section.weight * 100)}% of compliance score</p>
            </div>
          </div>
          <div className="flex flex-shrink-0 flex-col items-end gap-1">
            <span className="text-2xl font-bold leading-none" style={{ color: band.hex }}>
              {section.score == null ? '—' : Math.round(section.score)}
            </span>
            <span className="rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide"
              style={{ backgroundColor: `${band.hex}14`, color: band.hex }}>
              {band.label}
            </span>
          </div>
        </div>
        <div className="mt-auto h-[132px] w-full pb-1">
          <ZoneColumns metrics={section.metrics} />
        </div>
        <p className="mt-1 text-center text-[10px] text-slate-400 opacity-0 transition-opacity group-hover:opacity-100">
          click for the {section.metrics.length} formulas
        </p>
      </div>
    </button>
  );
}

export default function ComplianceOverviewCards() {
  const [openSection, setOpenSection] = useState<OverviewSection | null>(null);
  const [tuning, setTuning] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: [...SCORECARD_QUERY_KEYS.compliance],
    queryFn: async () => {
      try {
        const res = await complianceApi.dashboard.getSectionsOverview();
        return res.data as Payload;
      } catch {
        return null;
      }
    },
  });

  if (isLoading) {
    return (
      <div className="space-y-3">
        <div className="grid grid-cols-1 gap-3.5 xl:grid-cols-[1fr_1.1fr_1fr]">
          {[1, 2, 3].map((i) => <div key={i} className="skeleton h-64 rounded-2xl" />)}
        </div>
        <div className={SCORECARD_SECTION_GRID}>
          {[1, 2, 3, 4].map((i) => <div key={i} className="skeleton h-56 rounded-2xl" />)}
        </div>
      </div>
    );
  }

  const payload = data ?? {
    as_of: new Date().toISOString(),
    sections: {},
    attention_queue: { total: 0 },
    performance: { score: null, grade: null },
  } as Payload;

  const score = payload.performance.score == null ? null : Math.round(payload.performance.score);
  const band = scoreBand(score);
  const order = ['frameworks', 'controls', 'effectiveness', 'evidence', 'control_library', 'regulatory'] as const;
  const sections = order.map((k) => payload.sections[k]).filter((s): s is OverviewSection => Boolean(s));
  const attention = ATTENTION_META.map((m) => ({ ...m, count: payload.attention_queue?.[m.key] ?? 0 }));
  const attentionTotal = payload.attention_queue?.total ?? 0;

  const radarData = order.map((key) => {
    const s = payload.sections[key];
    const label = SECTION_META[key]?.short ?? s?.label ?? key;
    const hasData = s?.score != null;
    return {
      axis: label,
      score: hasData ? Math.round(s!.score as number) : 0,
      target: 85,
      hasData,
    };
  });

  return (
    <div className="space-y-3.5">
      {/* Hero row: performance · posture radar · attention */}
      <div className="grid grid-cols-1 gap-3.5 xl:grid-cols-[0.85fr_1.1fr_0.95fr]">
        {/* Performance */}
        <div className="flex flex-col justify-between rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
            <div className="flex min-w-0 items-center gap-4">
              <ScoreRing score={score} size={84} />
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Compliance Score</p>
                {payload.performance.grade && (
                  <span className="mt-1.5 inline-block rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide"
                    style={{ backgroundColor: `${band.hex}14`, color: band.hex }}>
                    {payload.performance.grade}
                  </span>
                )}
                <p className="mt-1.5 text-[11px] text-slate-400">{sections.length} weighted areas · target 85</p>
              </div>
            </div>
            {!tuning && (
              <button type="button" onClick={() => setTuning(true)}
                className="inline-flex flex-shrink-0 items-center gap-1 whitespace-nowrap rounded-md border border-slate-200 px-2 py-1 text-[10.5px] font-medium text-slate-500 transition-colors hover:border-slate-300 hover:text-slate-700">
                <SlidersHorizontal className="h-3 w-3" /> Adjust weights
              </button>
            )}
          </div>
          {/* section standings mini-bars */}
          <div className="mt-4 space-y-2">
            {sections.map((s) => {
              const b = scoreBand(s.score);
              return (
                <div key={s.key} className="flex items-center gap-2">
                  <span className="w-16 flex-shrink-0 truncate text-[10.5px] text-slate-500">{SECTION_META[s.key]?.short ?? s.label}</span>
                  <span className="relative h-1.5 flex-1 rounded-full bg-slate-100">
                    <span className="block h-1.5 rounded-full" style={{ width: `${s.score ?? 0}%`, backgroundColor: b.hex }} />
                    <span className="absolute inset-y-0 w-px bg-slate-300" style={{ left: '85%' }} />
                  </span>
                  <span className="w-7 flex-shrink-0 text-right text-[10.5px] font-semibold" style={{ color: b.hex }}>
                    {s.score == null ? '—' : Math.round(s.score)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Posture radar */}
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-1 flex items-center gap-2">
            <RadarIcon className="h-4 w-4 text-blue-600" />
            <span className="text-sm font-semibold text-slate-800">Posture Radar</span>
            <span className="ml-auto text-[10.5px] text-slate-400">score vs 85 target</span>
          </div>
          <ResponsiveContainer width="100%" height={210}>
            {radarData.length > 0 ? (
            <RadarChart data={radarData} outerRadius="72%">
              <PolarGrid stroke="#e2e8f0" />
              <PolarAngleAxis dataKey="axis" tick={{ fontSize: 11, fill: '#475569' }} />
              <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
              <Radar name="Target" dataKey="target" stroke="#94a3b8" fill="none" strokeDasharray="4 3" strokeWidth={1.2} />
              <Radar name="Score" dataKey="score" stroke={band.hex} fill={band.hex} fillOpacity={0.22} strokeWidth={2} />
              <RTooltip contentStyle={{ fontSize: 12, border: '1px solid #e2e8f0', borderRadius: 8, color: '#1e293b' }} />
            </RadarChart>
            ) : (
              <div className="flex h-full items-center justify-center text-xs text-slate-400">No scored areas yet</div>
            )}
          </ResponsiveContainer>
        </div>

        {/* Attention */}
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-2 flex items-center justify-between">
            <span className="flex items-center gap-2 text-sm font-semibold text-slate-800">
              <AlertTriangle className="h-4 w-4 text-amber-500" /> Needs Attention
            </span>
            <span className="rounded-full bg-amber-500 px-2 py-0.5 text-[11px] font-bold text-white">{attentionTotal}</span>
          </div>
          <div className="divide-y divide-slate-50">
            {attention.map((i) => (
              <Link key={i.key} href={i.href}
                className="flex items-center justify-between py-2 text-[11.5px] text-slate-600 hover:text-slate-900">
                <span className="flex items-center gap-2 truncate">
                  <span className="h-2.5 w-2.5 flex-shrink-0 rounded-full" style={{ backgroundColor: i.count > 0 ? i.color : '#e2e8f0' }} />
                  {i.label}
                </span>
                <span className={`ml-2 text-sm font-bold tabular-nums ${i.count > 0 ? 'text-slate-900' : 'text-slate-300'}`}>{i.count}</span>
              </Link>
            ))}
          </div>
        </div>
      </div>

      {/* Section detail cards */}
      <div className={SCORECARD_SECTION_GRID}>
        {sections.map((s) => <SectionCard key={s.key} section={s} onOpen={() => setOpenSection(s)} />)}
      </div>

      {tuning && (
        <SectionWeightTunerModal sections={sections} configBase={COMPLIANCE_TUNING.configBase} invalidateKey={COMPLIANCE_TUNING.invalidateKey} onClose={() => setTuning(false)} />
      )}
      <SectionDetailModal section={openSection} onClose={() => setOpenSection(null)} tuning={COMPLIANCE_TUNING} />
    </div>
  );
}
