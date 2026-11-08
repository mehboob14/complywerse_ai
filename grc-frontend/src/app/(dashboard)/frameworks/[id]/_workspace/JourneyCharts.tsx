'use client';

// The journey's charts (Overview tab): the figures of the posture, the requirement status, the automation assurance, maturity by domain and the
// trend. Data: GET /certifications/{id}/charts, which only READS (it used to record today's point on every call and the tab polled it each minute;
// the trend gains a point when someone captures a snapshot). Every chart has its numbers beside it in words, so none depends on colour alone.
import { useQuery } from '@tanstack/react-query';
import {
  ResponsiveContainer, PieChart, Pie, Cell, Tooltip, AreaChart, Area, XAxis, YAxis, CartesianGrid, RadarChart, PolarGrid, PolarAngleAxis, Radar,
} from 'recharts';
import { certificationsApi } from '@/lib/api';
import { ErrorState, SectionCard, SkeletonRows, StatTile } from '@/components/ui/ds';
import LabelledBar from './LabelledBar';
import { apiErrorText, safeDetail } from '@/lib/apiError';
import { formatCount, formatPercent } from '@/lib/format';
import { TONE } from '@/lib/status';
import { requirementState } from '@/lib/statuses/frameworkJourney';

type ChartsData = {
  gauge: { completion_pct: number; readiness_pct: number; evidence_coverage_pct: number };
  stats: { total_in_scope: number; applicable: number; not_applicable: number; implemented: number; ready_to_audit: number; with_evidence: number; automated: number; automated_passed: number };
  status_donut: Array<{ key: string; label: string; value: number; color: string }>;
  automation_donut: Array<{ label: string; value: number; color: string }>;
  maturity: Array<{ label: string; value: number; maxValue: number }>;
  trend: Array<{ label: string; completion: number; readiness: number }>;
};

// The platform's tone colours, by the word of the slice (not the hex the server sends).
const SLICE: Record<string, string> = {
  not_started: TONE.neutral.dot, in_progress: TONE.warning.dot, implemented: TONE.progress.dot, verified: TONE.success.dot, not_applicable: TONE.neutral.border,
};
const AUTOMATION = [TONE.success.dot, TONE.warning.dot, TONE.neutral.border];
const AXIS = { fontSize: 12, fill: TONE.neutral.text };

export default function JourneyCharts({ journeyId }: { journeyId: number }) {
  const { data, isLoading, error, refetch } = useQuery<ChartsData>({
    queryKey: ['journey-charts', journeyId],
    queryFn: async () => (await certificationsApi.getCharts(journeyId)).data as ChartsData,
  });

  if (isLoading) return <SkeletonRows rows={5} />;
  if (error || !data) {
    return <ErrorState title="Couldn't load the charts" message={safeDetail(apiErrorText(error, 'Please try again.'))} onRetry={() => { void refetch(); }} />;
  }
  const { gauge, stats, status_donut, automation_donut, maturity, trend } = data;

  return (
    <div className="space-y-[16px]">
      <div className="grid grid-cols-1 gap-[12px] sm:grid-cols-3">
        <StatTile label="Requirements in scope" value={formatCount(stats.applicable)} note={stats.not_applicable ? `${formatCount(stats.not_applicable)} out of scope, not counted` : undefined} />
        <StatTile label="Automated" value={`${formatCount(stats.automated)} of ${formatCount(stats.applicable)}`} note={stats.automated ? `${formatCount(stats.automated_passed)} passing` : 'None linked to a plugin yet'} />
        <StatTile label="Ready to audit" value={`${formatCount(stats.ready_to_audit)} of ${formatCount(stats.applicable)}`} note="approved evidence" />
      </div>

      <div className="grid grid-cols-1 gap-[16px] lg:grid-cols-2">
        <SectionCard id="posture" title="Overall compliance" meta={`${formatCount(stats.implemented)} of ${formatCount(stats.applicable)} implemented`}>
          <div className="space-y-[12px]">
            <LabelledBar label="Implemented" value={gauge.completion_pct} />
            <LabelledBar label="Ready (approved evidence)" value={gauge.readiness_pct} />
            <LabelledBar label="Evidence coverage" value={gauge.evidence_coverage_pct} />
          </div>
        </SectionCard>

        <SectionCard id="status" title="Requirement status">
          {status_donut.length > 0 ? (
            <Donut data={status_donut.map((d) => ({ label: d.label, value: d.value, color: SLICE[d.key] ?? TONE.neutral.dot }))} center={formatCount(stats.applicable)} centerLabel="in scope" />
          ) : <p className="text-ds-body text-ds-fg-muted">No requirement status to show yet.</p>}
        </SectionCard>

        <SectionCard id="automation" title="Automated controls assurance">
          {automation_donut.some((d) => d.value > 0) ? (
            <Donut data={automation_donut.map((d, i) => ({ label: d.label, value: d.value, color: AUTOMATION[i % AUTOMATION.length] }))} center={formatCount(stats.automated)} centerLabel="automated" />
          ) : <p className="text-ds-body text-ds-fg-muted">No requirement is linked to a compliance plugin yet. Map plugins to controls to fill this in.</p>}
        </SectionCard>

        <SectionCard id="maturity" title="Completion by domain">
          {maturity.length >= 3 ? (
            <div className="grid items-center gap-[12px] sm:grid-cols-[1fr_minmax(0,14rem)]">
              <div role="img" aria-label={`Completion by domain: ${maturity.map((m) => `${m.label} ${Math.round(m.value)}%`).join(', ')}`}>
                <ResponsiveContainer width="100%" height={240}>
                  <RadarChart data={maturity} outerRadius="68%">
                    <PolarGrid stroke={TONE.neutral.border} />
                    <PolarAngleAxis dataKey="label" tick={AXIS} />
                    <Radar dataKey="value" stroke={TONE.success.dot} fill={TONE.success.dot} fillOpacity={0.3} />
                    <Tooltip formatter={(v: any) => [`${v}%`, 'Completion']} />
                  </RadarChart>
                </ResponsiveContainer>
              </div>
              <ul className="space-y-[4px]">
                {maturity.map((m) => (
                  <li key={m.label} className="flex items-baseline justify-between gap-[8px] text-ds-body text-ds-fg-body">
                    <span className="min-w-0 truncate" title={m.label}>{m.label}</span>
                    <span className="shrink-0 tabular-nums text-ds-fg">{formatPercent(m.value)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <ul className="space-y-[4px]">
              {maturity.length === 0 ? <li className="text-ds-body text-ds-fg-muted">No domains to show yet.</li> : maturity.map((m) => (
                <li key={m.label} className="flex items-baseline justify-between gap-[8px] text-ds-body text-ds-fg-body"><span>{m.label}</span><span className="tabular-nums text-ds-fg">{formatPercent(m.value)}</span></li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>

      <SectionCard id="trend" title="Compliance trend" info="A point is added each day someone captures a snapshot (the Capture snapshot button). Opening this page adds nothing.">
        {trend.length >= 2 ? (
          <div role="img" aria-label={`Trend over ${trend.length} snapshots, from ${trend[0].label} (${trend[0].completion}% implemented, ${trend[0].readiness}% ready) to ${trend[trend.length - 1].label} (${trend[trend.length - 1].completion}% implemented, ${trend[trend.length - 1].readiness}% ready)`}>
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={trend} margin={{ top: 8, right: 12, left: -8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={TONE.neutral.border} />
                <XAxis dataKey="label" tick={AXIS} />
                <YAxis domain={[0, 100]} tick={AXIS} unit="%" />
                <Tooltip formatter={(v: any, n: any) => [`${v}%`, n === 'completion' ? 'Implemented' : 'Ready']} />
                <Area type="monotone" dataKey="completion" stroke={TONE.progress.dot} strokeWidth={2} fill={TONE.progress.tint} />
                <Area type="monotone" dataKey="readiness" stroke={TONE.success.dot} strokeWidth={2} fill="none" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <p className="text-ds-body text-ds-fg-muted">
            {trend.length === 0 ? 'No snapshot has been captured yet.' : 'One snapshot so far.'} Capture a snapshot from the buttons at the top to add a point; the trend appears from two.
          </p>
        )}
      </SectionCard>
    </div>
  );
}

function Donut({ data, center, centerLabel }: { data: Array<{ label: string; value: number; color: string }>; center: string; centerLabel: string }) {
  const shown = data.filter((d) => d.value > 0);
  return (
    <div className="grid items-center gap-[12px] sm:grid-cols-[180px_1fr]">
      <div className="relative h-[180px]" role="img" aria-label={shown.map((d) => `${d.label} ${d.value}`).join(', ')}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={shown} dataKey="value" nameKey="label" cx="50%" cy="50%" innerRadius={56} outerRadius={84} paddingAngle={2} stroke="#fff" strokeWidth={2}>
              {shown.map((d, i) => <Cell key={i} fill={d.color} />)}
            </Pie>
            <Tooltip />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-[24px] font-[600] leading-[32px] tabular-nums text-ds-fg">{center}</span>
          <span className="text-ds-label text-ds-fg-muted">{centerLabel}</span>
        </div>
      </div>
      <ul className="space-y-[6px]">
        {shown.map((d, i) => (
          <li key={i} className="flex items-center gap-[8px] text-ds-body text-ds-fg-body">
            <span aria-hidden className="h-[10px] w-[10px] shrink-0 rounded-full" style={{ backgroundColor: d.color }} />
            <span className="flex-1">{d.label}</span>
            <span className="tabular-nums text-ds-fg">{formatCount(d.value)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
