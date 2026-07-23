'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { BarChart3, Workflow, Target, ArrowRight } from 'lucide-react';
import { ermApi } from '@/lib/api';
import type {
  AttentionItem,
  HeatmapData,
  Metric,
  ModulePerformance,
  Section,
  TopRisk,
} from '@/components/dashboard/erm/types';
import ModulePerformanceCard from '@/components/dashboard/erm/ModulePerformanceCard';
import AttentionQueue from '@/components/dashboard/erm/AttentionQueue';
import SectionCard from '@/components/dashboard/erm/SectionCard';
import SectionWaterfallCard from '@/components/dashboard/erm/SectionWaterfallCard';
import SectionDotMatrixCard from '@/components/dashboard/erm/SectionDotMatrixCard';
import FixFirstCard from '@/components/dashboard/erm/FixFirstCard';
import RiskHeatmap from '@/components/dashboard/erm/RiskHeatmap';
import TopRisks from '@/components/dashboard/erm/TopRisks';
import SectionDetailModal from '@/components/dashboard/erm/SectionDetailModal';
import { SCORECARD_QUERY_KEYS } from '@/components/dashboard/scorecard-query-keys';

// The three approved chart families cycle across the section cards so the
// grid mixes all of them: area profile → waterfall → dot matrix.
const CARD_VARIANTS = [SectionCard, SectionWaterfallCard, SectionDotMatrixCard];

// The ten target sections; live ones come from the backend, the rest render as
// muted "arriving" ghost tiles so the grid stays full and tells the roadmap.
const SECTION_ORDER = ['register', 'assessments', 'rcsa', 'controls', 'vendor_risk',
  'kris', 'appetite', 'mitigation', 'reviews', 'incidents'];
const TOTAL_SECTIONS = SECTION_ORDER.length;

const UPCOMING_SECTIONS: Array<{ key: string; label: string; weight: number }> = [
  { key: 'kris', label: 'Key Risk Indicators', weight: 0.09 },
  { key: 'appetite', label: 'Risk Appetite', weight: 0.09 },
  { key: 'mitigation', label: 'Mitigation Actions', weight: 0.10 },
  { key: 'reviews', label: 'Risk Reviews', weight: 0.09 },
  { key: 'incidents', label: 'Incidents', weight: 0.05 },
];

// Attention queue keys → labels + the page that clears them + tile rail color.
const ATTENTION_META: Array<{ key: string; label: string; href: string; color: string }> = [
  { key: 'critical_open_risks', label: 'Critical open risks', href: '/erm/risks/list', color: '#dc2626' },
  { key: 'unscored_active_risks', label: 'Unscored active risks', href: '/erm/risks/list', color: '#d97706' },
  { key: 'blocked_questions', label: 'Blocked framework questions', href: '/erm/risk-assessments/framework', color: '#8b5cf6' },
  { key: 'overdue_ai_reviews', label: 'Overdue AI reviews', href: '/erm/risk-assessments/ai-risk-assessment', color: '#2563eb' },
  { key: 'rcsa_open_findings', label: 'RCSA open findings', href: '/erm/rcsa/findings', color: '#ea580c' },
  { key: 'controls_tests_overdue', label: 'Control tests overdue', href: '/erm/internal-controls', color: '#0891b2' },
  { key: 'vendor_overdue_reassessments', label: 'Vendor overdue reassessments', href: '/vendor-risk/vendors', color: '#c026d3' },
  { key: 'vendor_critical_findings', label: 'Vendor critical findings', href: '/vendor-risk/findings', color: '#e11d48' },
  { key: 'vendor_overdue_remediations', label: 'Vendor overdue remediations', href: '/vendor-risk/findings', color: '#0d9488' },
  { key: 'red_kris', label: 'Red KRIs', href: '/erm/kris', color: '#f43f5e' },
  { key: 'appetite_breaches', label: 'Appetite breaches', href: '/erm/appetite', color: '#9333ea' },
  { key: 'overdue_mitigation_actions', label: 'Overdue mitigation actions', href: '/erm/mitigation-actions', color: '#f59e0b' },
  { key: 'overdue_risk_reviews', label: 'Overdue risk reviews', href: '/erm/reviews', color: '#0284c7' },
  { key: 'open_critical_incidents', label: 'Open critical incidents', href: '/erm/incidents', color: '#b91c1c' },
];

interface SectionsOverviewPayload {
  sections: Record<string, {
    key: string;
    label: string;
    weight: number;
    score: number | null;
    metrics: Array<{
      key: string;
      label: string;
      weight: number;
      score: number | null;
      numerator: number;
      denominator: number;
      formula: string;
    }>;
  }>;
  attention_queue: Record<string, number>;
  performance: { score: number | null; grade: string | null };
}

interface HeatmapCell {
  likelihood: number;
  impact: number;
  count: number;
}

function toMatrix(cells: HeatmapCell[] | undefined): number[][] {
  // Rows: likelihood 5→1 (top→bottom) · Columns: impact 1→5 (left→right)
  const matrix = Array.from({ length: 5 }, () => Array(5).fill(0));
  (cells || []).forEach((c) => {
    if (c.likelihood >= 1 && c.likelihood <= 5 && c.impact >= 1 && c.impact <= 5) {
      matrix[5 - c.likelihood][c.impact - 1] = c.count;
    }
  });
  return matrix;
}

export default function ERMOverviewPage() {
  const [openKey, setOpenKey] = useState<string | null>(null);

  const { data: overview, isLoading } = useQuery({
    queryKey: [...SCORECARD_QUERY_KEYS.erm],
    queryFn: async () => {
      const response = await ermApi.dashboard.getSectionsOverview();
      return response.data as SectionsOverviewPayload;
    },
  });

  const { data: risksData } = useQuery({
    queryKey: ['erm-risks-all'],
    queryFn: async () => {
      const response = await ermApi.risks.getAll();
      return response.data;
    },
  });

  const { data: inherentCells } = useQuery({
    queryKey: ['erm-heatmap', 'inherent'],
    queryFn: async () => (await ermApi.risks.getHeatmap('inherent')).data as HeatmapCell[],
  });

  const { data: residualCells } = useQuery({
    queryKey: ['erm-heatmap', 'residual'],
    queryFn: async () => (await ermApi.risks.getHeatmap('residual')).data as HeatmapCell[],
  });

  // ── live payload → the design system's data shapes ──
  const sections: Section[] = useMemo(() => {
    return SECTION_ORDER
      .map((key) => overview?.sections?.[key])
      .filter((s): s is NonNullable<typeof s> => Boolean(s))
      .map((s) => ({
        key: s.key,
        label: s.label,
        weight: s.weight,
        score: s.score,
        metrics: s.metrics.map((m): Metric => ({
          key: m.key,
          label: m.label,
          score: m.score,
          weight: m.weight,
          count: m.denominator ? `${m.numerator}/${m.denominator}` : '—',
          formula: m.formula,
        })),
      }));
  }, [overview]);

  const modulePerformance: ModulePerformance = useMemo(() => {
    const raw = overview?.performance;
    const grade = raw?.grade ? raw.grade.charAt(0).toUpperCase() + raw.grade.slice(1) : 'No data';
    return {
      score: raw?.score == null ? 0 : Math.round(raw.score),
      grade,
      upcomingSections: TOTAL_SECTIONS - sections.length,
    };
  }, [overview, sections.length]);

  const attentionItems: AttentionItem[] = useMemo(
    () => ATTENTION_META.map((meta) => ({
      ...meta,
      count: overview?.attention_queue?.[meta.key] ?? 0,
    })),
    [overview],
  );
  const attentionTotal = overview?.attention_queue?.total
    ?? attentionItems.reduce((sum, i) => sum + i.count, 0);

  const heatmap: HeatmapData = useMemo(
    () => ({ inherent: toMatrix(inherentCells), residual: toMatrix(residualCells) }),
    [inherentCells, residualCells],
  );

  const topRisks: TopRisk[] = useMemo(() => {
    if (!risksData) return [];
    return [...risksData]
      .filter((r: any) => (r.residual_score ?? r.inherent_score ?? 0) > 0)
      .sort((a: any, b: any) =>
        (b.residual_score ?? b.inherent_score ?? 0) - (a.residual_score ?? a.inherent_score ?? 0))
      .slice(0, 10)
      .map((r: any): TopRisk => ({
        id: String(r.id),
        title: (r.name || r.title || '').replace(/^\[DEMO\]\s*/, ''),
        inherent: Math.round(r.inherent_score ?? 0),
        residual: Math.round(r.residual_score ?? r.inherent_score ?? 0),
      }));
  }, [risksData]);

  const openSection = useMemo(
    () => (openKey && openKey !== 'module' ? sections.find((s) => s.key === openKey) ?? null : null),
    [openKey, sections],
  );

  if (isLoading) {
    return (
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.35fr_1fr]">
          <div className="skeleton h-64 rounded-2xl" />
          <div className="skeleton h-64 rounded-2xl" />
        </div>
        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="skeleton h-56 rounded-2xl" />
          ))}
        </div>
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <div className="skeleton h-80 rounded-2xl" />
          <div className="skeleton h-80 rounded-2xl" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Hero: performance + attention */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.35fr_1fr]">
        <ModulePerformanceCard
          perf={modulePerformance}
          sections={sections}
          onClick={() => setOpenKey('module')}
        />
        <AttentionQueue items={attentionItems} total={attentionTotal} />
      </div>

      {/* Module sections — area-profile cards */}
      <section>
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
          <div className="flex items-center gap-2">
            <BarChart3 className="h-[17px] w-[17px] text-rose-600" />
            <h2 className="text-[15px] font-semibold text-slate-900">Module Sections</h2>
            <span className="text-[11px] text-slate-400">
              — each card profiles its metrics against the 85 target line · click for the math
            </span>
          </div>
          <div className="flex items-center gap-3.5 text-[10.5px] text-slate-500">
            <LegendDot color="#059669" label="Strong" />
            <LegendDot color="#d97706" label="Fair" />
            <LegendDot color="#e11d48" label="Weak" />
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-0 w-3.5 border-t-2 border-dashed border-slate-600" />
              85 target
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
          {sections.map((s, index) => {
            const Variant = CARD_VARIANTS[index % CARD_VARIANTS.length];
            return <Variant key={s.key} section={s} onClick={() => setOpenKey(s.key)} />;
          })}
          {sections.length > 0 && (
            <FixFirstCard
              sections={sections}
              onOpenSection={(key) => setOpenKey(key)}
              className="sm:col-span-2"
            />
          )}
          {UPCOMING_SECTIONS.filter((u) => !sections.some((s) => s.key === u.key)).map((u) => (
            <div
              key={u.key}
              className="flex min-h-[210px] flex-col overflow-hidden rounded-2xl border border-dashed border-slate-200 bg-slate-50/60"
            >
              <div className="h-[3px] w-full bg-slate-200" />
              <div className="flex flex-1 flex-col p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="truncate text-sm font-semibold text-slate-400">{u.label}</h3>
                    <p className="mt-0.5 text-[10.5px] text-slate-300">
                      {Math.round(u.weight * 100)}% of module score
                    </p>
                  </div>
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-slate-400">
                    Arriving
                  </span>
                </div>
                <div className="flex flex-1 items-center justify-center">
                  <p className="text-[10.5px] text-slate-300">formulas being wired up</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Heatmap + top risks */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.05fr_0.95fr]">
        <RiskHeatmap data={heatmap} />
        <TopRisks risks={topRisks} />
      </div>

      {/* Risk analysis tools — Bow-Tie & Scenario, surfaced here as well as the sidebar */}
      <section>
        <div className="mb-3 flex items-center gap-2">
          <Workflow className="h-[17px] w-[17px] text-blue-600" />
          <h2 className="text-[15px] font-semibold text-slate-900">Risk analysis tools</h2>
          <span className="text-[11px] text-slate-400">— model and visualize your risks</span>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {[
            { title: 'Bow-Tie Analysis', href: '/erm/analytics/bowtie', icon: Workflow,
              desc: 'Cause-and-effect view: threats → preventive controls → risk event → mitigating controls → consequences.',
              tint: 'from-blue-500/15 to-cyan-500/15', ic: 'text-blue-600' },
            { title: 'Scenario Analysis', href: '/erm/analytics/scenario', icon: Target,
              desc: 'Model what-if scenarios by adjusting likelihood and impact to understand portfolio exposure.',
              tint: 'from-purple-500/15 to-pink-500/15', ic: 'text-purple-600' },
          ].map((c) => {
            const Icon = c.icon;
            return (
              <Link key={c.href} href={c.href}
                className="group flex items-start gap-4 rounded-2xl border border-slate-200 bg-white p-5 transition-all hover:border-slate-300 hover:shadow-md">
                <span className={`rounded-lg bg-gradient-to-br ${c.tint} p-3`}><Icon className={`h-6 w-6 ${c.ic}`} /></span>
                <div className="min-w-0 flex-1">
                  <h3 className="flex items-center gap-2 text-[15px] font-semibold text-slate-900 group-hover:text-blue-600">
                    {c.title}<ArrowRight className="h-4 w-4 opacity-0 transition-opacity group-hover:opacity-100" />
                  </h3>
                  <p className="mt-1 text-[13px] leading-relaxed text-slate-600">{c.desc}</p>
                </div>
              </Link>
            );
          })}
        </div>
      </section>

      <SectionDetailModal
        open={openKey !== null}
        onClose={() => setOpenKey(null)}
        section={openSection}
        module={openKey === 'module' ? { perf: modulePerformance, sections } : null}
      />
    </div>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: color }} />
      {label}
    </span>
  );
}
