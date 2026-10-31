'use client';

// The three cards above the register: the status mix, the open exceptions by age, and how many were closed on time. Every number is the server's count over
// ALL the organisation's exceptions (GET /policy-exceptions/analytics), not a count of the rows that were loaded: the list is cut at 100 and these must
// not be. Each chart keeps its library (recharts) and is also said in words (role="img" + aria-label, and the legend beside the donut), with labels at
// the 12px floor. Colours are the status tones (lib/status TONE), so a status is the same colour here as on its pill.
import { Cell, Bar, BarChart, CartesianGrid, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatCount, formatPercent } from '@/lib/format';
import { TONE } from '@/lib/status';
import { ErrorState, SectionCard, SkeletonLines } from '@/components/ui/ds';
import { errorMessage } from '@/components/ui/ds/reportOutcome';
import { agingBars, chartAlt, closedOnTimeTone, statusSlices } from './_logic';
import type { ExceptionAnalytics } from './_types';

const TIP = { fontSize: 12, borderRadius: 6, border: '1px solid var(--ds-border)' };
const GRID = 'grid grid-cols-1 gap-[16px] lg:grid-cols-3';

export function Summary({ query }: { query: { data?: ExceptionAnalytics; isLoading: boolean; isError: boolean; error: unknown; refetch: () => unknown } }) {
  const a = query.data;
  if (query.isLoading) {
    return (
      <div className={GRID}>
        {['Status', 'Open by age', 'Closed on time'].map((t) => (
          <SectionCard key={t} id={`summary-${t.toLowerCase().replace(/\s+/g, '-')}`} title={t}><SkeletonLines lines={4} label={`Loading ${t.toLowerCase()}`} /></SectionCard>
        ))}
      </div>
    );
  }
  if (!a) {
    if (!query.isError) return null;
    return (
      <SectionCard id="summary" title="Summary">
        <ErrorState compact title="Couldn't load the summary" message={errorMessage(query.error)} onRetry={() => { void query.refetch(); }} />
      </SectionCard>
    );
  }
  if (a.total === 0) return null;

  const slices = statusSlices(a.by_status);
  const bars = agingBars(a.aging_buckets);
  const tone = closedOnTimeTone(a.closed_on_time_pct);

  return (
    <div className={GRID}>
      <SectionCard id="summary-status" title="Status">
        <div className="flex items-center gap-[12px]">
          <div role="img" aria-label={chartAlt('Status', slices)} className="h-[110px] w-[110px] shrink-0">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart accessibilityLayer={false}>
                <Pie data={slices} cx="50%" cy="50%" innerRadius={30} outerRadius={48} dataKey="value" nameKey="label" paddingAngle={2} rootTabIndex={-1}>
                  {slices.map((s) => <Cell key={s.key} fill={TONE[s.tone].dot} />)}
                </Pie>
                <Tooltip contentStyle={TIP} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <ul className="min-w-0 flex-1 space-y-[6px]">
            {slices.map((s) => (
              <li key={s.key} className="flex items-center gap-2 text-ds-label">
                <span aria-hidden className="h-[10px] w-[10px] shrink-0 rounded-full" style={{ background: TONE[s.tone].dot }} />
                <span className="min-w-0 flex-1 text-ds-fg-muted">{s.label}</span>
                <span className="font-[600] tabular-nums text-ds-fg">{formatCount(s.value)}</span>
              </li>
            ))}
          </ul>
        </div>
      </SectionCard>

      <SectionCard id="summary-open-by-age" title="Open by age">
        <div role="img" aria-label={chartAlt('Open by age', bars)} className="h-[130px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={bars} margin={{ top: 4, right: 6, left: -18, bottom: 0 }} accessibilityLayer={false}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--ds-border)" />
              <XAxis dataKey="label" interval={0} tick={{ fontSize: 12, fill: 'var(--ds-fg-muted)' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 12, fill: 'var(--ds-fg-muted)' }} axisLine={false} tickLine={false} allowDecimals={false} />
              <Tooltip contentStyle={TIP} />
              <Bar dataKey="value" name="Open" radius={[3, 3, 0, 0]}>
                {bars.map((b) => <Cell key={b.key} fill={TONE[b.tone].dot} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </SectionCard>

      <SectionCard id="summary-closed-on-time" title="Closed on time">
        <div className="flex items-center gap-[16px]">
          <span className="text-[24px] font-[600] leading-[32px] tabular-nums" style={{ color: TONE[tone].text }}>{formatPercent(a.closed_on_time_pct)}</span>
          <dl className="min-w-0 flex-1 space-y-[6px] text-ds-label">
            <div className="flex items-center justify-between gap-2"><dt className="text-ds-fg-muted">Open</dt><dd className="font-[600] tabular-nums text-ds-fg">{formatCount(a.open)}</dd></div>
            <div className="flex items-center justify-between gap-2">
              <dt className="text-ds-fg-muted">Overdue</dt>
              <dd className={`font-[600] tabular-nums ${a.overdue ? 'text-ds-danger' : 'text-ds-fg'}`}>{formatCount(a.overdue)}</dd>
            </div>
            <div className="flex items-center justify-between gap-2"><dt className="text-ds-fg-muted">Resolved</dt><dd className="font-[600] tabular-nums text-ds-fg">{formatCount(a.resolved)}</dd></div>
          </dl>
        </div>
        {a.closed_on_time_pct == null && <span className="sr-only">Not measured yet: nothing has been resolved</span>}
      </SectionCard>
    </div>
  );
}
