'use client';

// FrameworkDeepDive
// ─────────────────────────────────────────────────────────────────────────
// Per-framework drill-down panel on /frameworks. Lets the operator pick ONE
// active journey and see deep KPIs (readiness, completion, evidence
// coverage), status mix, per-domain progress, and the live gap analysis —
// without having to leave the dashboard for the journey detail page.

import { useMemo, useState, useEffect } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  ResponsiveContainer, RadialBarChart, RadialBar, PolarAngleAxis,
} from 'recharts';
import {
  Target, ShieldCheck, FileBadge, Calendar,
  CheckCircle2, Clock, FileSearch, ChevronDown,
  Sparkles, ArrowUpRight, Activity,
} from 'lucide-react';
import { certificationsApi } from '@/lib/api';
import type { CertificationJourney, ProgressSummary } from '@/types';

// ─── Helpers ────────────────────────────────────────────────────────────

function toneFor(pct: number): { ring: string; text: string; soft: string } {
  if (pct >= 75) return { ring: '#10b981', text: 'text-emerald-700', soft: 'bg-emerald-50' };
  if (pct >= 50) return { ring: '#1ed4b0', text: 'text-primary-700', soft: 'bg-primary-50' };
  if (pct >= 25) return { ring: '#f59e0b', text: 'text-amber-700', soft: 'bg-amber-50' };
  return { ring: '#f43f5e', text: 'text-rose-700', soft: 'bg-rose-50' };
}

function resolveName(j: CertificationJourney): string {
  return j.framework?.name || j.framework_name || j.name || 'Untitled framework';
}

function daysFromNow(iso?: string | null): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return Math.ceil((d.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
}

// ─── Mini Gauge ─────────────────────────────────────────────────────────
function MiniGauge({
  label, pct, icon: Icon, sublabel,
}: { label: string; pct: number; icon: React.ComponentType<{ className?: string }>; sublabel?: string }) {
  const t = toneFor(pct);
  return (
    <div className={`relative rounded-xl border border-slate-200 ${t.soft} p-3 shadow-sm`}>
      <div className="flex items-center gap-2 mb-2">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-white shadow-sm ring-1 ring-slate-200">
          <Icon className="h-3.5 w-3.5 text-slate-700" />
        </div>
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 truncate">{label}</p>
          {sublabel && <p className="text-[10px] text-slate-500 truncate">{sublabel}</p>}
        </div>
      </div>
      <div className="flex items-center gap-3">
        <div className="relative h-[88px] w-[88px] shrink-0">
          <ResponsiveContainer width="100%" height="100%">
            <RadialBarChart
              innerRadius="74%"
              outerRadius="100%"
              data={[{ value: pct, fill: t.ring }]}
              startAngle={90}
              endAngle={-270}
            >
              <PolarAngleAxis type="number" domain={[0, 100]} angleAxisId={0} tick={false} />
              <RadialBar dataKey="value" cornerRadius={8} fill={t.ring} background={{ fill: '#f1f5f9' }} />
            </RadialBarChart>
          </ResponsiveContainer>
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
            <span className={`text-xl font-bold tabular-nums ${t.text}`}>{Math.round(pct)}%</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Framework picker dropdown ─────────────────────────────────────────
function JourneyPicker({
  journeys, selectedId, onSelect,
}: { journeys: CertificationJourney[]; selectedId: number | null; onSelect: (id: number) => void }) {
  const [open, setOpen] = useState(false);
  const selected = journeys.find((j) => j.id === selectedId);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('[data-journey-picker]')) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  return (
    <div className="relative" data-journey-picker>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm transition-colors hover:border-slate-300 hover:bg-slate-50 min-w-[260px]"
      >
        <ShieldCheck className="h-4 w-4 text-primary-600 shrink-0" strokeWidth={1.75} />
        <span className="truncate flex-1 text-left">
          {selected ? resolveName(selected) : 'Select framework…'}
        </span>
        {selected?.framework?.short_code && (
          <span className="rounded border border-slate-200 bg-slate-50 px-1.5 py-px text-[10px] font-medium text-slate-600 shrink-0">
            {selected.framework.short_code}
          </span>
        )}
        <ChevronDown className={`h-4 w-4 text-slate-400 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute left-0 top-full z-30 mt-1 w-[320px] rounded-xl border border-slate-200 bg-white p-1 shadow-lg max-h-[360px] overflow-y-auto">
          {journeys.length === 0 ? (
            <p className="p-3 text-xs text-slate-500">No active journeys.</p>
          ) : (
            journeys.map((j) => {
              const isActive = j.id === selectedId;
              const code = j.framework?.short_code || '';
              return (
                <button
                  key={j.id}
                  onClick={() => { onSelect(j.id); setOpen(false); }}
                  className={`w-full flex items-center gap-2 rounded-lg px-3 py-2 text-left transition-colors ${
                    isActive ? 'bg-primary-50 text-primary-700' : 'text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  <ShieldCheck className={`h-3.5 w-3.5 shrink-0 ${isActive ? 'text-primary-600' : 'text-slate-400'}`} strokeWidth={1.75} />
                  <span className="flex-1 text-xs font-medium truncate">{resolveName(j)}</span>
                  {code && (
                    <span className="rounded border border-slate-200 bg-white px-1.5 py-px text-[10px] font-medium text-slate-500 shrink-0">
                      {code}
                    </span>
                  )}
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main ───────────────────────────────────────────────────────────────
export function FrameworkDeepDive({ journeys }: { journeys: CertificationJourney[] }) {
  // Filter to journeys that have actually started — finished/cancelled
  // journeys can still be inspected but we default the picker to an active
  // one so the operator lands on something live.
  const activeJourneys = useMemo(
    () => journeys.filter((j) => j.status === 'in_progress' || j.status === 'not_started'),
    [journeys],
  );
  const pickable = activeJourneys.length > 0 ? activeJourneys : journeys;

  const [selectedId, setSelectedId] = useState<number | null>(pickable[0]?.id ?? null);

  // Keep the selection valid if the journeys list changes (e.g. a journey
  // completes mid-session). Re-pick the first available when ours drops out.
  useEffect(() => {
    if (selectedId && !pickable.find((j) => j.id === selectedId)) {
      setSelectedId(pickable[0]?.id ?? null);
    } else if (!selectedId && pickable.length > 0) {
      setSelectedId(pickable[0].id);
    }
  }, [pickable, selectedId]);

  const selected = pickable.find((j) => j.id === selectedId) || null;

  const { data: progress, isLoading: progressLoading } = useQuery({
    queryKey: ['certification-progress', selectedId],
    queryFn: async () => {
      const r = await certificationsApi.getProgress(selectedId as number);
      return r.data as ProgressSummary;
    },
    enabled: !!selectedId,
    staleTime: 30_000,
  });

  // Empty state — page-level. If there are zero journeys we hide entirely
  // since the existing ComplianceDashboard already shows the start-a-journey
  // empty state.
  if (journeys.length === 0) return null;

  const dueDays = daysFromNow(selected?.target_date as string | undefined);
  const isOverdue = dueDays !== null && dueDays < 0;
  const isUrgent = dueDays !== null && dueDays >= 0 && dueDays <= 30;

  return (
    <section className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      {/* Header strip */}
      <div className="border-b border-slate-200 bg-slate-50 px-4 py-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-50 ring-1 ring-primary-100">
              <FileSearch className="h-4 w-4 text-primary-600" strokeWidth={1.75} />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-slate-900">Framework Snapshot</h2>
              <p className="text-[11px] text-slate-500">Readiness, completion &amp; evidence at a glance — open the framework for full charts.</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <JourneyPicker journeys={pickable} selectedId={selectedId} onSelect={setSelectedId} />
            {selected && (
              <Link
                href={`/frameworks/${selected.id}`}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 shadow-sm transition-colors hover:border-primary-300 hover:text-primary-700"
              >
                Open full detail
                <ArrowUpRight className="h-3.5 w-3.5" strokeWidth={1.75} />
              </Link>
            )}
          </div>
        </div>

        {/* Sub-header chips for the selected journey */}
        {selected && (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px]">
            <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-medium ${
              selected.status === 'in_progress'
                ? 'border-primary-200 bg-primary-50 text-primary-700'
                : selected.status === 'not_started'
                  ? 'border-slate-200 bg-slate-50 text-slate-600'
                  : selected.status === 'completed'
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                    : 'border-slate-200 bg-slate-50 text-slate-600'
            }`}>
              <Activity className="h-3 w-3" />
              {(selected.status || 'in_progress').replace(/_/g, ' ')}
            </span>
            {isOverdue && (
              <span className="inline-flex items-center gap-1 rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 font-medium text-rose-700">
                <Calendar className="h-3 w-3" />
                Overdue by {Math.abs(dueDays as number)}d
              </span>
            )}
            {isUrgent && (
              <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 font-medium text-amber-700">
                <Calendar className="h-3 w-3" />
                Due in {dueDays}d
              </span>
            )}
            {selected.target_date && !isOverdue && !isUrgent && (
              <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 font-medium text-slate-600">
                <Calendar className="h-3 w-3" />
                Target {new Date(selected.target_date).toLocaleDateString()}
              </span>
            )}
            {selected.started_at && (
              <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 font-medium text-slate-600">
                <Clock className="h-3 w-3" />
                Started {new Date(selected.started_at).toLocaleDateString()}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Body */}
      {!selected ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <Sparkles className="mb-2 h-7 w-7 text-slate-300" />
          <p className="text-xs text-slate-500">Pick a framework above to load its KPIs.</p>
        </div>
      ) : progressLoading || !progress ? (
        <div className="grid gap-3 p-4 md:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-[180px] animate-pulse rounded-xl bg-slate-100" />
          ))}
        </div>
      ) : (
        <div className="space-y-4 p-4">
          {/* Hero gauges row */}
          <div className="grid gap-3 sm:grid-cols-3">
            <MiniGauge
              label="Readiness"
              pct={progress.readiness_percentage}
              icon={Target}
              sublabel="Verified + evidenced"
            />
            <MiniGauge
              label="Completion"
              pct={progress.completion_percentage}
              icon={CheckCircle2}
              sublabel={`${progress.implemented_count + progress.verified_count}/${progress.total_controls} done`}
            />
            <MiniGauge
              label="Evidence Coverage"
              pct={progress.evidence_coverage_percentage}
              icon={FileBadge}
              sublabel={`${progress.with_evidence_count} of ${progress.total_controls}`}
            />
          </div>

        </div>
      )}
    </section>
  );
}
