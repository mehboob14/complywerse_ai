'use client';

// AI usage > Activity: the call-by-call view of AI use, read from the external tracing the platform can be set up with (it replaces the Usage Monitoring page, which never
// worked: its address was answered by another handler). Where the tracing is not set up the view says so in plain words; the server's own message names the service and a
// setting, so it is never shown. The totals and the list are for everyone who may open the view; what each call asked and answered is shown only to people who hold the AI
// governance payload right (the server lets `admin:organization:view` read it: recorded as a gap, nothing widened).
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { adminApi } from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';
import { formatCount, formatDateTime } from '@/lib/format';
import { statusPill } from '@/lib/status';
import { aiCall } from '@/lib/statuses/adminAuditAi';
import { Button, EmptyState, ErrorState, Notice, RegisterTable, SectionCard, Select, SkeletonLines, StatTile, StatusPill, type RegisterColumn } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { ACTIVITY_DAYS, ACTIVITY_OFF, fmtTokens, mayReadRunText, money, periodRange, runText, seconds } from './usageModel';

type Overview = Awaited<ReturnType<typeof adminApi.getAiUsageOverview>>['data'];
type Runs = Awaited<ReturnType<typeof adminApi.getAiUsageRuns>>['data'];
type Run = Runs['runs'][number];

function Text({ label, value }: { label: string; value: unknown }) {
  const text = runText(value);
  return (
    <div className="min-w-0">
      <p className="m-0 mb-[4px] text-ds-label text-ds-fg-muted">{label}</p>
      {text == null ? <p className="m-0 text-ds-body text-ds-fg-muted">None recorded</p> : (
        <pre className="m-0 max-h-[260px] overflow-auto whitespace-pre-wrap break-words rounded-ds-card border border-ds-border bg-ds-surface-hover p-[12px] text-[12px] text-ds-fg">{text}</pre>
      )}
    </div>
  );
}

export function ActivityView() {
  const { hasPermission, isAdmin } = usePermissions();
  const mayRead = mayReadRunText({ hasPermission, isAdmin });
  const [days, setDays] = useState<number>(30);
  const range = useMemo(() => periodRange(days, new Date()), [days]);                 // the days of this visit; Refresh and the period move it on
  const [stamp, setStamp] = useState(0);
  const key = `${days}-${stamp}`;
  const overview = useQuery({ queryKey: ['admin-ai-activity', key], queryFn: async () => (await adminApi.getAiUsageOverview(range)).data as Overview });
  const on = overview.data?.configured === true;
  const runs = useQuery({ queryKey: ['admin-ai-activity-runs', key], enabled: on, queryFn: async () => (await adminApi.getAiUsageRuns({ ...range, limit: 50 })).data as Runs });
  const [open, setOpen] = useState<string[]>([]);
  const o = overview.data;

  if (overview.isError) return <ErrorState title="Couldn't load the activity" message={errorMessage(overview.error)} onRetry={canRetry(overview.error) ? () => { void overview.refetch(); } : undefined} />;
  if (overview.isLoading) return <SkeletonLines lines={6} label="Loading the activity" />;
  if (!o || !o.configured) return <EmptyState kind="firstUse" title={ACTIVITY_OFF.title} description={ACTIVITY_OFF.message} />;

  const maxFeature = Math.max(1, ...o.by_feature.map((r) => r.total_tokens));
  const maxDay = Math.max(1, ...o.by_day.map((r) => r.total_tokens));
  const columns: RegisterColumn<Run>[] = [
    { key: 'feature', header: 'What it was used for', isRowHeader: true, cell: (r) => <span className="font-[600] text-ds-fg">{r.feature}</span> },
    { key: 'when', header: 'When', card: 'meta', cell: (r) => <span className="whitespace-nowrap">{formatDateTime(r.started_at)}</span> },
    { key: 'result', header: 'Result', card: 'meta', cell: (r) => <StatusPill size="sm" {...statusPill(aiCall, r.status)} /> },
    { key: 'tokens', header: 'Tokens', align: 'right', priority: 2, card: 'meta', cell: (r) => fmtTokens(r.total_tokens) },
    { key: 'cost', header: 'Estimated cost', align: 'right', priority: 3, card: 'meta', cell: (r) => money(r.estimated_cost_usd, { fine: true }) },
    { key: 'time', header: 'Took', align: 'right', priority: 3, card: 'meta', cell: (r) => seconds(r.latency_ms) },
  ];

  return (
    <div className="flex flex-col gap-[16px]">
      <div className="flex flex-wrap items-center gap-[8px]">
        <Select aria-label="Period" className="w-[160px]" value={String(days)} onChange={(e) => setDays(Number(e.target.value))}>
          {ACTIVITY_DAYS.map((n) => <option key={n} value={n}>Last {n} days</option>)}
        </Select>
        <Button size="sm" onClick={() => setStamp((s) => s + 1)}>Refresh</Button>
      </div>

      {o.plain_english && <Notice tone="info" title="At a glance">{o.plain_english}</Notice>}

      <div className="grid grid-cols-1 gap-[12px] sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="AI uses" value={formatCount(o.summary.total_runs)} note={`${formatCount(o.summary.successful_runs)} succeeded · ${formatCount(o.summary.failed_runs)} failed`} tone={o.summary.failed_runs ? 'warning' : 'default'} />
        <StatTile label="Tokens used" value={fmtTokens(o.summary.total_tokens)} note={`${fmtTokens(o.summary.prompt_tokens)} sent · ${fmtTokens(o.summary.completion_tokens)} returned`} />
        <StatTile label="Estimated cost" value={money(o.summary.estimated_cost_usd, { fine: true })} info="An estimate from average rates, not an invoice." />
        <StatTile label="Average response time" value={o.summary.avg_latency_ms != null ? seconds(o.summary.avg_latency_ms) : null} />
      </div>

      <div className="grid gap-[16px] lg:grid-cols-2">
        <SectionCard id="where" title="Where AI was used" info="The features that used the most tokens in this period.">
          {o.by_feature.length === 0 ? <p className="m-0 text-ds-body text-ds-fg-muted">No AI use in this period.</p> : (
            <ul className="m-0 flex list-none flex-col gap-[10px] p-0">
              {o.by_feature.map((row) => (
                <li key={row.feature} className="flex flex-col gap-[4px]">
                  <span className="flex flex-wrap items-baseline justify-between gap-x-[8px] text-ds-body">
                    <span className="min-w-0 truncate font-[600] text-ds-fg">{row.feature}</span>
                    <span className="text-ds-label text-ds-fg-muted">{formatCount(row.runs)} {row.runs === 1 ? 'use' : 'uses'} · {fmtTokens(row.total_tokens)} · {money(row.estimated_cost_usd, { fine: true })}</span>
                  </span>
                  <span aria-hidden className="h-[6px] overflow-hidden rounded-full bg-ds-border"><span className="block h-full rounded-full bg-ds-primary" style={{ width: `${Math.round((row.total_tokens / maxFeature) * 100)}%` }} /></span>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
        <SectionCard id="daily" title="Day by day" info="Tokens used on each day of the period.">
          {o.by_day.length === 0 ? <p className="m-0 text-ds-body text-ds-fg-muted">No days to show yet.</p> : (
            <ul aria-label="Tokens used each day" className="m-0 flex h-[150px] list-none items-end gap-[3px] p-0">
              {o.by_day.map((d) => (
                <li key={d.date} className="flex h-full flex-1 flex-col justify-end" title={`${formatDateTime(d.date, { calendar: true })}: ${fmtTokens(d.total_tokens)} tokens`}>
                  <span className="block w-full rounded-t-[2px] bg-ds-primary" style={{ height: `${Math.max(3, Math.round((d.total_tokens / maxDay) * 100))}%` }} />
                  <span className="sr-only">{formatDateTime(d.date, { calendar: true })}: {fmtTokens(d.total_tokens)} tokens</span>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>

      <SectionCard id="calls" title="Calls" meta={runs.data ? `${formatCount(runs.data.runs.length)} of ${formatCount(runs.data.total)}` : undefined}>
        <RegisterTable
          caption="AI calls"
          columns={columns}
          rows={runs.data?.runs ?? []}
          getRowId={(r) => r.id}
          loading={runs.isLoading}
          error={runs.isError ? { message: errorMessage(runs.error, 'The calls could not be loaded.'), onRetry: canRetry(runs.error) ? () => { void runs.refetch(); } : undefined } : null}
          cardTitle={(r) => <span className="font-[600] text-ds-fg">{r.feature}</span>}
          expand={{
            open, onChange: (next) => setOpen(next as string[]), label: (r) => `Details of ${r.feature}`,
            render: (r) => (
              <div className="flex flex-col gap-[12px] py-[8px]">
                {mayRead && r.error && <Notice tone="danger" title="This call failed">{r.error}</Notice>}
                {mayRead ? (
                  <div className="grid gap-[12px] lg:grid-cols-2">
                    <Text label="What was asked" value={r.inputs} />
                    <Text label="What came back" value={r.outputs} />
                  </div>
                ) : (
                  <p className="m-0 text-ds-body text-ds-fg-muted">What each call asked and answered is shown to people with the AI governance rights.</p>
                )}
              </div>
            ),
          }}
          empty={<EmptyState bare kind="firstUse" title="No calls in this period" description="Pick a longer period." />}
        />
      </SectionCard>
    </div>
  );
}
