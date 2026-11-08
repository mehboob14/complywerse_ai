'use client';

/**
 * Control Assurance: how well the controls are tested, scored by weighted section over the Catalog's testing work: Coverage, Effectiveness and Testing quality. A performance card (the score and its grade,
 * each area's score against the 85 target, "Adjust weights"), a posture radar, what needs attention, and one card per area whose formulas open in a dialog. The score, its bands and the dialogs are the
 * shared score-kit / score-tuning pieces, unchanged; this file is the page's own layout on the design-system tokens. A read that fails is an error with Retry (it used to be drawn as a score of nothing).
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ClipboardCheck, FlaskConical, Radar as RadarIcon, ShieldCheck, SlidersHorizontal } from 'lucide-react';
import {
  ResponsiveContainer, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar, Tooltip as RTooltip, BarChart, Bar, Cell, XAxis, YAxis, ReferenceArea, ReferenceLine,
} from 'recharts';
import apiClient from '@/lib/api';
import { Button, CountRow, ErrorState, SectionCard, Skeleton, StatusPill } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { formatCount } from '@/lib/format';
import { TONE, type Tone } from '@/lib/status';
import { type OverviewSection, scoreBand, ScoreRing, SectionDetailModal } from '@/components/dashboard/score-kit';
import { SectionWeightTunerModal } from '@/components/dashboard/score-tuning';
import { SCORECARD_QUERY_KEYS } from '@/components/dashboard/scorecard-query-keys';

const ASSURANCE_TUNING = { configBase: '/control-library/assurance', invalidateKey: [...SCORECARD_QUERY_KEYS.assurance] as unknown[] };

type Payload = {
  as_of: string;
  sections: Record<string, OverviewSection>;
  attention_queue: Record<string, number>;
  performance: { score: number | null; grade: string | null };
};

const SECTION_META: Record<string, { icon: React.ElementType; short: string }> = {
  coverage: { icon: ClipboardCheck, short: 'Coverage' },
  effectiveness: { icon: ShieldCheck, short: 'Effectiveness' },
  quality: { icon: FlaskConical, short: 'Quality' },
};

const ATTENTION_META: Array<{ key: string; label: string; href: string; tone: Tone }> = [
  { key: 'controls_untested', label: 'Controls not tested', href: '/control-library', tone: 'progress' },
  { key: 'overdue_control_tests', label: 'Overdue control tests', href: '/control-library', tone: 'warning' },
  { key: 'ineffective_key_controls', label: 'Key controls not effective', href: '/control-library', tone: 'danger' },
];

const TARGET = 85;
const bandTone = (label: string): Tone => (label === 'strong' ? 'success' : label === 'fair' ? 'warning' : label === 'weak' ? 'danger' : 'neutral');
const bandWords = (label: string): string => (label === 'strong' ? 'Strong' : label === 'fair' ? 'Fair' : label === 'weak' ? 'Weak' : 'No data');
const TIP = { fontSize: 12, border: '1px solid var(--ds-border)', borderRadius: 8, color: 'var(--ds-fg)' } as const;

/** One column per metric over tinted weak / fair / strong bands, with the dashed target line. */
function ZoneColumns({ metrics }: { metrics: OverviewSection['metrics'] }) {
  const data = metrics.map((m) => ({ key: m.key, label: m.label, score: m.score == null ? 0 : Math.round(m.score), hasData: m.score != null, fill: scoreBand(m.score).hex }));
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 8, right: 6, bottom: 0, left: 6 }} barCategoryGap="26%">
        <YAxis type="number" domain={[0, 100]} hide />
        <XAxis dataKey="key" hide />
        <ReferenceArea y1={0} y2={60} fill={TONE.danger.dot} fillOpacity={0.06} />
        <ReferenceArea y1={60} y2={80} fill={TONE.warning.dot} fillOpacity={0.07} />
        <ReferenceArea y1={80} y2={100} fill={TONE.success.dot} fillOpacity={0.07} />
        <ReferenceLine y={TARGET} stroke={TONE.neutral.dot} strokeDasharray="4 3" strokeWidth={1} />
        <RTooltip cursor={{ fill: 'rgba(148,163,184,0.08)' }} contentStyle={TIP} formatter={(v, _n, entry) => [`${v}%`, (entry?.payload as { label?: string })?.label ?? '']} labelFormatter={() => ''} />
        <Bar dataKey="score" radius={[3, 3, 0, 0]} isAnimationActive={false} minPointSize={2}>
          {data.map((d) => <Cell key={d.key} fill={d.hasData ? d.fill : TONE.neutral.border} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function SectionButton({ section, onOpen }: { section: OverviewSection; onOpen: () => void }) {
  const band = scoreBand(section.score);
  const Icon = SECTION_META[section.key]?.icon ?? ClipboardCheck;
  const score = section.score == null ? 'no score yet' : `score ${Math.round(section.score)}`;
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`${section.label}, ${score}. Show the ${section.metrics.length} formulas`}
      className="flex w-full flex-col gap-[8px] rounded-ds-card border border-ds-border bg-ds-surface p-[16px] text-left hover:bg-ds-surface-hover focus-visible:outline-none focus-visible:shadow-ds-ring"
    >
      <span className="flex items-start justify-between gap-[8px]">
        <span className="flex min-w-0 items-center gap-[8px]">
          <Icon aria-hidden className="h-[16px] w-[16px] shrink-0 text-ds-fg-muted" strokeWidth={1.75} />
          <span className="min-w-0">
            <span className="block truncate text-ds-body font-[600] text-ds-fg">{section.label}</span>
            <span className="text-ds-label text-ds-fg-muted">{`${Math.round(section.weight * 100)}% of the assurance score`}</span>
          </span>
        </span>
        <span className="flex shrink-0 flex-col items-end gap-[4px]">
          <span className="text-ds-title tabular-nums text-ds-fg">{section.score == null ? '—' : Math.round(section.score)}</span>
          <StatusPill size="sm" tone={bandTone(band.label)} label={bandWords(band.label)} />
        </span>
      </span>
      <span className="block h-[132px] w-full"><ZoneColumns metrics={section.metrics} /></span>
      <span className="text-center text-ds-label text-ds-fg-muted">{`Show the ${section.metrics.length} formulas`}</span>
    </button>
  );
}

export default function ControlAssuranceOverviewCards() {
  const [openSection, setOpenSection] = useState<OverviewSection | null>(null);
  const [tuning, setTuning] = useState(false);
  const q = useQuery({
    queryKey: [...SCORECARD_QUERY_KEYS.assurance],
    queryFn: async () => (await apiClient.get('/control-library/assurance/sections-overview')).data as Payload,
    retry: (failures, e) => failures < 2 && canRetry(e),
  });

  if (q.isError && !q.data) {
    return <ErrorState title="Couldn’t load the control assurance" message={errorMessage(q.error)} onRetry={canRetry(q.error) ? () => { void q.refetch(); } : undefined} />;
  }
  if (q.isPending || !q.data) {
    return (
      <div aria-busy="true" className="flex flex-col gap-[12px]">
        <div className="grid grid-cols-1 gap-[12px] xl:grid-cols-3">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-[256px] w-full" />)}</div>
        <div className="grid grid-cols-1 gap-[12px] sm:grid-cols-2 xl:grid-cols-3">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-[224px] w-full" />)}</div>
      </div>
    );
  }

  const payload = q.data;
  const score = payload.performance.score == null ? null : Math.round(payload.performance.score);
  const band = scoreBand(score);
  const order = ['coverage', 'effectiveness', 'quality'] as const;
  const sections = order.map((k) => payload.sections[k]).filter((s): s is OverviewSection => Boolean(s));
  const attention = ATTENTION_META.map((m) => ({ ...m, count: payload.attention_queue?.[m.key] ?? 0 }));
  const attentionTotal = payload.attention_queue?.total ?? 0;
  const controlsUnderAssurance = (payload.sections?.coverage as { counts?: { active?: number } })?.counts?.active ?? 0;
  const radarData = order.map((key) => {
    const s = payload.sections[key];
    return { axis: SECTION_META[key]?.short ?? s?.label ?? key, score: s?.score != null ? Math.round(s.score) : 0, target: TARGET };
  });

  return (
    <div className="flex flex-col gap-[12px]">
      <div className="grid grid-cols-1 gap-[12px] xl:grid-cols-[0.85fr_1.1fr_0.95fr]">
        <section aria-labelledby="perf-title" className="flex flex-col justify-between gap-[16px] rounded-ds-card border border-ds-border bg-ds-surface p-[16px]">
          <div className="flex flex-wrap items-start justify-between gap-x-[12px] gap-y-[8px]">
            <div className="flex min-w-0 items-center gap-[16px]">
              <ScoreRing score={score} size={84} />
              <div className="min-w-0">
                <h2 id="perf-title" className="m-0 !text-ds-body !font-[600] !text-ds-fg">Control testing and assurance</h2>
                {payload.performance.grade && <div className="mt-[6px]"><StatusPill size="sm" tone={bandTone(band.label)} label={payload.performance.grade} /></div>}
                <p className="m-0 mt-[6px] text-ds-label text-ds-fg-muted">{`${formatCount(controlsUnderAssurance)} ${controlsUnderAssurance === 1 ? 'control' : 'controls'} under assurance · ${formatCount(sections.length)} weighted areas`}</p>
              </div>
            </div>
            {!tuning && <Button size="sm" leftIcon={<SlidersHorizontal aria-hidden />} onClick={() => setTuning(true)}>Adjust weights</Button>}
          </div>
          <ul className="m-0 flex list-none flex-col gap-[8px] p-0">
            {sections.map((s) => {
              const b = scoreBand(s.score);
              return (
                <li key={s.key} className="flex items-center gap-[8px]">
                  <span className="w-[96px] shrink-0 truncate text-ds-label text-ds-fg-body">{SECTION_META[s.key]?.short ?? s.label}</span>
                  <span role="img" aria-label={`${SECTION_META[s.key]?.short ?? s.label}: ${s.score == null ? 'no score' : Math.round(s.score)} against a target of ${TARGET}`} className="relative h-[8px] flex-1 rounded-full bg-ds-surface-hover">
                    <span className="block h-[8px] rounded-full" style={{ width: `${s.score ?? 0}%`, backgroundColor: b.hex }} />
                    <span className="absolute inset-y-[-2px] w-px bg-ds-border-strong" style={{ left: `${TARGET}%` }} />
                  </span>
                  <span className="w-[32px] shrink-0 text-right text-ds-label font-[600] tabular-nums text-ds-fg">{s.score == null ? '—' : Math.round(s.score)}</span>
                </li>
              );
            })}
          </ul>
        </section>

        <section aria-labelledby="radar-title" className="rounded-ds-card border border-ds-border bg-ds-surface p-[16px]">
          <div className="mb-[4px] flex items-center gap-[8px]">
            <RadarIcon aria-hidden className="h-[16px] w-[16px] text-ds-primary-text" strokeWidth={1.75} />
            <h2 id="radar-title" className="m-0 !text-ds-body !font-[600] !text-ds-fg">Posture radar</h2>
            <span className="ml-auto text-ds-label text-ds-fg-muted">{`score against the ${TARGET} target`}</span>
          </div>
          <div role="img" aria-label={`Posture radar: ${radarData.map((r) => `${r.axis} ${r.score}`).join(', ')}`}>
            <ResponsiveContainer width="100%" height={210}>
              <RadarChart data={radarData} outerRadius="72%">
                <PolarGrid stroke={TONE.neutral.border} />
                <PolarAngleAxis dataKey="axis" tick={{ fontSize: 12, fill: 'var(--ds-fg-body)' }} />
                <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
                <Radar name="Target" dataKey="target" stroke={TONE.neutral.dot} fill="none" strokeDasharray="4 3" strokeWidth={1.2} />
                <Radar name="Score" dataKey="score" stroke={band.hex} fill={band.hex} fillOpacity={0.22} strokeWidth={2} />
                <RTooltip contentStyle={TIP} />
              </RadarChart>
            </ResponsiveContainer>
          </div>
        </section>

        <SectionCard id="attention" title="Needs attention" meta={`${formatCount(attentionTotal)} in all`}>
          <ul className="m-0 list-none divide-y divide-ds-border p-0">
            {attention.map((a) => <CountRow key={a.key} as="li" label={a.label} count={a.count} href={a.href} tone={a.count > 0 ? a.tone : 'neutral'} />)}
          </ul>
          {attentionTotal === 0 && <p className="m-0 mt-[8px] inline-flex items-center gap-[6px] text-ds-label text-ds-success"><AlertTriangle aria-hidden className="h-[12px] w-[12px]" />Nothing needs attention right now.</p>}
        </SectionCard>
      </div>

      <div className="grid grid-cols-1 gap-[12px] sm:grid-cols-2 xl:grid-cols-3">
        {sections.map((s) => <SectionButton key={s.key} section={s} onOpen={() => setOpenSection(s)} />)}
      </div>

      {tuning && <SectionWeightTunerModal sections={sections} configBase={ASSURANCE_TUNING.configBase} invalidateKey={ASSURANCE_TUNING.invalidateKey} onClose={() => setTuning(false)} />}
      <SectionDetailModal section={openSection} onClose={() => setOpenSection(null)} tuning={ASSURANCE_TUNING} />
    </div>
  );
}
