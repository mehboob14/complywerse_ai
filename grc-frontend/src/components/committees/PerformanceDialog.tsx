'use client';

// Performance and progress: how the committees' score is made (five measures, their weights, their counts and the exact formula, or why one has no data), six months of
// progress and the people who close the most actions. Lifted from the old Committees page, where these were tiles and panels, into the dialog the pulse opens ("How it
// is calculated"). The score and its formulas are the server's (committees.py, GET /overview); this only says how far the data behind them goes.
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from 'recharts';
import { Trophy } from 'lucide-react';
import { InfoTip } from '@/components/ui/InfoTip';
import { AnimatedModal } from '@/components/ui/AnimatedModal';
import { ScoreRing, scoreBand } from '@/components/dashboard/score-kit';
import { PersonChip, SectionCard, StatusPill } from '@/components/ui/ds';
import { formatCount, formatPercent } from '@/lib/format';
import { TONE } from '@/lib/status';
import {
  NOT_RECORDED, gradeTone, measureHasData, measureReason, meetingsHeldReading, performanceReading, type Overview, type OverviewMetric, type OverviewMonth,
} from '@/lib/committees';

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthLabel = (key: string): string => MONTH_ABBR[(parseInt(key.split('-')[1], 10) || 1) - 1] || key;
const SR_CELL = 'text-[12px] text-ds-fg';                       // a bare <th>/<td> gets 11.5px from the platform CSS, even in a table only a screen reader reads

function MeasureRow({ m }: { m: OverviewMetric }) {
  const has = measureHasData(m);
  const band = scoreBand(m.score);
  return (
    <li className="px-[16px] py-[12px]">
      <div className="flex flex-wrap items-baseline justify-between gap-x-[12px] gap-y-[4px]">
        <span className="min-w-0 text-ds-body font-medium text-ds-fg">
          {m.label}
          <span className="ml-[8px] text-ds-label font-normal text-ds-fg-muted">weight {Math.round(m.weight * 100)}%</span>
        </span>
        <span className="flex items-baseline gap-[8px]">
          {has && <span className="text-ds-label tabular-nums text-ds-fg-muted">{formatCount(m.numerator)} of {formatCount(m.denominator)}</span>}
          {has ? <span className="text-ds-body font-[600] tabular-nums text-ds-fg">{formatPercent(m.score)}</span> : <span className="text-ds-body text-ds-fg-muted">{NOT_RECORDED}</span>}
        </span>
      </div>
      <div aria-hidden className="mt-[8px] h-[8px] overflow-hidden rounded-full bg-ds-border">
        {has && <div className="h-full rounded-full" style={{ width: `${Math.max(m.score === 0 ? 3 : 0, Math.min(100, m.score as number))}%`, background: band.hex }} />}
      </div>
      <p className="mt-[6px] text-ds-label font-normal text-ds-fg-muted">{has ? `= ${m.formula}` : measureReason(m)}</p>
    </li>
  );
}

function PerformanceDetail({ kpis }: { kpis: Overview['kpis'] }) {
  const perf = performanceReading(kpis.performance);
  const metrics = kpis.performance?.metrics ?? [];
  if (!kpis.performance) return <p className="p-[20px] text-ds-body text-ds-fg-muted">{NOT_RECORDED}</p>;
  return (
    <div className="space-y-[16px] p-[20px]">
      <div className="flex items-center gap-[16px] rounded-ds-card border border-ds-border bg-ds-surface-subtle p-[16px]">
        {perf.score == null ? <span className="text-ds-body text-ds-fg-muted">{NOT_RECORDED}</span> : <ScoreRing score={perf.score} size={72} />}
        <div className="min-w-0">
          {perf.grade && perf.score != null && <StatusPill tone={gradeTone(perf.grade)} label={perf.grade.charAt(0).toUpperCase() + perf.grade.slice(1)} />}
          <p className="mt-[6px] text-ds-label font-normal text-ds-fg-muted">
            {perf.score == null ? perf.why : `${perf.note || 'Every measure has data.'} A measure with no data is left out and the weights of the others are re-scaled.`}
          </p>
        </div>
      </div>
      <ul className="divide-y divide-ds-border rounded-ds-card border border-ds-border">
        {metrics.map((m) => <MeasureRow key={m.key} m={m} />)}
      </ul>
      {perf.score != null && (
        <p className="rounded-ds-card border border-ds-border bg-ds-surface-subtle px-[14px] py-[10px] text-ds-label font-normal text-ds-fg-body">
          <span className="font-[600]">Score</span> = {metrics.filter((m) => m.score != null).map((m) => `${Math.round(m.score as number)}×${Math.round(m.weight * 100)}%`).join(' + ')} = <span className="font-[600]">{Math.round(perf.score)}</span>
        </p>
      )}
    </div>
  );
}

function ProgressChart({ data, held }: { data: OverviewMonth[]; held: { recorded: boolean; why: string } }) {
  const anyActivity = data.some((d) => d.actions_completed > 0 || (held.recorded && d.meetings_held > 0));
  const rows = data.map((d) => ({ month: monthLabel(d.month), 'Meetings held': d.meetings_held, 'Actions completed': d.actions_completed }));
  return (
    <SectionCard
      id="progress"
      title="Progress over time"
      meta="Organisation-wide, last 6 months"
      actions={!held.recorded ? <span className="inline-flex items-center gap-[4px] text-ds-body text-ds-fg-muted">Meetings held: {NOT_RECORDED}<InfoTip text={held.why} label="Why meetings held is not recorded" /></span> : undefined}
    >
      {!anyActivity ? (
        <p className="py-[16px] text-center text-ds-body text-ds-fg-muted">{held.recorded ? 'No meetings or completed actions recorded yet.' : 'No completed actions recorded yet.'}</p>
      ) : (
        <>
          <div aria-hidden="true" className="h-[200px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={rows} margin={{ top: 8, right: 12, left: -14, bottom: 0 }}>
                <CartesianGrid strokeDasharray="2 2" stroke="#e5e8ec" vertical={false} />
                <XAxis dataKey="month" tick={{ fontSize: 12, fill: '#586472' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 12, fill: '#586472' }} axisLine={false} tickLine={false} allowDecimals={false} />
                <RTooltip contentStyle={{ fontSize: 12, border: '1px solid #d1d7df', borderRadius: 8, color: '#1a1a1a' }} />
                {held.recorded && <Area type="monotone" dataKey="Meetings held" stroke={TONE.progress.dot} strokeWidth={2} fill={TONE.progress.tint} dot={{ r: 3, strokeWidth: 2, fill: '#fff' }} />}
                <Area type="monotone" dataKey="Actions completed" stroke={TONE.success.dot} strokeWidth={2} fill={TONE.success.tint} dot={{ r: 3, strokeWidth: 2, fill: '#fff' }} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          {/* the same numbers for a screen reader: the chart is a picture of this table. The table sits INSIDE the clipped box rather than being it: the platform
              CSS makes every table 100% wide, which beat sr-only's 1px and made the absolutely placed table push the whole page sideways (a horizontal scrollbar
              at every width) */}
          <div className="sr-only">
            <table>
              <caption>Progress over time, last 6 months</caption>
              <thead><tr><th scope="col" className={SR_CELL}>Month</th>{held.recorded && <th scope="col" className={SR_CELL}>Meetings held</th>}<th scope="col" className={SR_CELL}>Actions completed</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.month}>
                    <th scope="row" className={SR_CELL}>{r.month}</th>
                    {held.recorded && <td className={SR_CELL}>{r['Meetings held']}</td>}
                    <td className={SR_CELL}>{r['Actions completed']}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-[8px] flex flex-wrap items-center gap-x-[16px] gap-y-[4px] text-ds-label font-normal text-ds-fg-muted">
            <span className="inline-flex items-center gap-[6px]"><span aria-hidden className="h-[8px] w-[8px] rounded-full" style={{ background: TONE.success.dot }} />Actions completed</span>
            {held.recorded && <span className="inline-flex items-center gap-[6px]"><span aria-hidden className="h-[8px] w-[8px] rounded-full" style={{ background: TONE.progress.dot }} />Meetings held</span>}
          </p>
        </>
      )}
    </SectionCard>
  );
}

function TopPerformers({ rows }: { rows: Overview['top_performers'] }) {
  return (
    <SectionCard id="top-performers" title="Top performers" meta="By action completion" actions={<Trophy aria-hidden className="h-[16px] w-[16px] text-ds-fg-muted" strokeWidth={1.75} />}>
      {rows.length === 0 ? (
        <p className="py-[16px] text-center text-ds-body text-ds-fg-muted">No action assignments yet.</p>
      ) : (
        <ol className="space-y-[12px]">
          {rows.map((r, i) => (
            <li key={r.user_id} className="flex items-start gap-[12px]">
              <span aria-hidden className="mt-[2px] grid h-[24px] w-[24px] shrink-0 place-items-center rounded-full bg-ds-surface-hover text-ds-label tabular-nums text-ds-fg-body">{i + 1}</span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-[8px]">
                  <PersonChip name={r.name} size={24} />
                  <span className="shrink-0 text-ds-body font-[600] tabular-nums text-ds-fg">{formatPercent(r.completion_pct)}</span>
                </div>
                <div aria-hidden className="mt-[6px] h-[6px] overflow-hidden rounded-full bg-ds-border"><div className="h-full rounded-full bg-ds-primary" style={{ width: `${Math.min(100, r.completion_pct)}%` }} /></div>
                <span className="mt-[4px] block text-ds-label font-normal text-ds-fg-muted">{formatCount(r.completed)} of {formatCount(r.assigned)} done · {formatCount(r.on_time)} on time</span>
              </div>
            </li>
          ))}
        </ol>
      )}
    </SectionCard>
  );
}

/** The dialog: the five measures, six months of progress, the top performers. `overview` is GET /committees/overview (already loaded by the page). */
export function PerformanceDialog({ open, onClose, overview }: { open: boolean; onClose: () => void; overview: Overview }) {
  const k = overview.kpis;
  return (
    <AnimatedModal isOpen={open} onClose={onClose} size="lg" title="Performance and progress" subtitle="Weighted mean of five formulas: the same score as the Governance overview">
      <div className="space-y-[16px] p-[20px]">
        <PerformanceDetail kpis={k} />
        <ProgressChart data={overview.progress_over_time} held={meetingsHeldReading(k)} />
        <TopPerformers rows={overview.top_performers} />
      </div>
    </AnimatedModal>
  );
}
