'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { BarChart3, Workflow, Target, ArrowRight } from 'lucide-react';
import { ermApi } from '@/lib/api';
import type { ModulePerformance, Section } from '@/components/dashboard/erm/types';
import ModulePerformanceCard from '@/components/dashboard/erm/ModulePerformanceCard';
import SectionCard from '@/components/dashboard/erm/SectionCard';
import SectionWaterfallCard from '@/components/dashboard/erm/SectionWaterfallCard';
import SectionDotMatrixCard from '@/components/dashboard/erm/SectionDotMatrixCard';
import FixFirstCard from '@/components/dashboard/erm/FixFirstCard';
import SectionDetailModal from '@/components/dashboard/erm/SectionDetailModal';
import { SCORECARD_QUERY_KEYS } from '@/components/dashboard/scorecard-query-keys';
import { useMyUserId } from '@/components/governance/DocumentTaskActions';
import { usePermissions } from '@/hooks/usePermissions';
import AudienceRows from './_components/AudienceRows';
import {
  AUDIENCE_VIEWS, RISK_TEAM_PERMISSIONS, TOTAL_SECTIONS, type AudiencePayload, type AudienceView,
  browserStorage, initialView, readStoredView, storeView, toSections,
} from './_components/audienceModel';

// The three approved chart families cycle across the section cards so the
// grid mixes all of them: area profile → waterfall → dot matrix.
const CARD_VARIANTS = [SectionCard, SectionWaterfallCard, SectionDotMatrixCard];

export default function ERMOverviewPage() {
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [picked, setPicked] = useState<AudienceView | null>(null);
  const { hasAnyPermission, isLoading: permissionsLoading } = usePermissions();
  const userId = useMyUserId();

  // The person's last choice, else the risk team view for the risk team and the owner view for everyone else.
  // Decided once permissions are in (after mount), so the server render and the first client render agree.
  const view: AudienceView | null = picked ?? (permissionsLoading ? null
    : initialView(readStoredView(browserStorage(), userId), hasAnyPermission(RISK_TEAM_PERMISSIONS)));
  const choose = (next: AudienceView) => {
    setPicked(next);
    storeView(browserStorage(), userId, next);
  };

  // Under the scorecard key, so weight tuning in the section popup refreshes this view too.
  const { data, isLoading, isError } = useQuery({
    queryKey: [...SCORECARD_QUERY_KEYS.erm, 'audience', view],
    queryFn: async () => (await ermApi.dashboard.getAudience(view as AudienceView)).data as AudiencePayload,
    enabled: view !== null,
  });

  const sections: Section[] = useMemo(() => toSections(data?.programme), [data]);
  const modulePerformance: ModulePerformance = useMemo(() => {
    const raw = data?.programme?.performance;
    const grade = raw?.grade ? raw.grade.charAt(0).toUpperCase() + raw.grade.slice(1) : 'No data';
    return { score: raw?.score == null ? 0 : Math.round(raw.score), grade, upcomingSections: TOTAL_SECTIONS - sections.length };
  }, [data, sections.length]);
  const openSection = useMemo(
    () => (openKey && openKey !== 'module' ? sections.find((s) => s.key === openKey) ?? null : null),
    [openKey, sections],
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-0.5 rounded-lg bg-slate-100 p-0.5" role="group" aria-label="Dashboard for">
          {AUDIENCE_VIEWS.map((v) => (
            <button
              key={v.value}
              type="button"
              aria-pressed={view === v.value}
              onClick={() => choose(v.value)}
              className={`rounded-md px-3 py-1.5 text-[12px] font-semibold transition-all ${
                view === v.value ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {v.label}
            </button>
          ))}
        </div>
        {data?.as_of && <span className="text-[11px] text-slate-400">As of {new Date(data.as_of).toLocaleString()}</span>}
      </div>

      {view === null || isLoading ? (
        <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-2">
          {[1, 2, 3, 4].map((i) => <div key={i} className="skeleton h-48 rounded-2xl" />)}
        </div>
      ) : isError || !data ? (
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">
          This dashboard could not be loaded. Refresh the page to try again.
        </div>
      ) : (
        <AudienceRows
          questions={data.questions}
          perf={modulePerformance}
          sections={sections}
          onOpenProgramme={() => setOpenKey('module')}
        />
      )}

      {/* The risk team keeps the Overview's programme score and section cards beneath its measures. */}
      {view === 'team' && data?.programme && (
        <>
          <section>
            <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
              <div className="flex items-center gap-2">
                <BarChart3 className="h-[17px] w-[17px] text-rose-600" />
                <h2 className="text-[15px] font-semibold text-slate-900">Programme score and sections</h2>
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
            <div className="mb-3.5">
              <ModulePerformanceCard perf={modulePerformance} sections={sections} onClick={() => setOpenKey('module')} />
            </div>
            <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
              {sections.map((s, index) => {
                const Variant = CARD_VARIANTS[index % CARD_VARIANTS.length];
                return <Variant key={s.key} section={s} onClick={() => setOpenKey(s.key)} />;
              })}
              {sections.length > 0 && (
                <FixFirstCard sections={sections} onOpenSection={(key) => setOpenKey(key)} className="sm:col-span-2" />
              )}
            </div>
          </section>

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
        </>
      )}

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
