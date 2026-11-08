'use client';

// AI usage > Tokens: the organisation's own ledger of AI use, as the Token usage page always showed it and with the same figures (the server computes the shares, the budget
// use, the 85 percent alert and the month-end projection; nothing is recomputed here). Tiles for the headline figures, usage over time stacked by module (a module can be
// switched off to isolate another), budget use per module, usage by module with its features, and the heaviest users, each linked to their own usage. The page refreshes by
// itself every 15 seconds while it is live (Pause stops it) and again when the tab comes back into view.
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Download, RefreshCw, Search } from 'lucide-react';
import { adminApi, type TokenUsageOverview } from '@/lib/api';
import { formatCount } from '@/lib/format';
import { statusPill } from '@/lib/status';
import { budgetUse } from '@/lib/statuses/adminAuditAi';
import {
  Avatar, Button, EmptyState, ErrorState, Notice, ProgressBar, RegisterTable, SectionCard, SegmentedControl, SkeletonLines, StatTile, StatusPill, TextInput, useNotify, ChartFrame,
  type RegisterColumn,
} from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { axisLabel, budgetBand, chartRows, fmtTokens, money, quotaTone, RANGES, rangeLabel, rangeStart, searchModules, stackTotals, trendOf, type RangeKey } from './usageModel';

type Module = TokenUsageOverview['modules'][number];
const LIVE_MS = 15000;
const GRID = 'grid gap-[12px]';
const BAND_TONE = { ok: 'success', watch: 'warning', over: 'danger' } as const;

const Trend = ({ pct }: { pct: number }) => {
  const t = trendOf(pct);
  return <span className={t.direction === 'more' ? 'text-ds-danger' : t.direction === 'less' ? 'text-ds-success' : 'text-ds-fg-muted'}>{t.text}</span>;
};

function Share({ share, color }: { share: number; color: string }) {
  return (
    <span className="flex min-w-[120px] items-center gap-[8px]">
      <span aria-hidden className="h-[6px] flex-1 overflow-hidden rounded-full bg-ds-border"><span className="block h-full rounded-full" style={{ width: `${Math.min(100, share)}%`, background: color }} /></span>
      <span className="w-[44px] text-right text-ds-label tabular-nums text-ds-fg-muted">{share.toFixed(1)}%</span>
    </span>
  );
}

export function TokensView({ range, onRange, onBudgets }: { range: RangeKey; onRange: (r: RangeKey) => void; onBudgets: () => void }) {
  const notify = useNotify();
  const [live, setLive] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [hidden, setHidden] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<string[] | null>(null);

  const usage = useQuery({
    queryKey: ['admin-token-usage', range],
    queryFn: async () => (await adminApi.getTokenUsageOverview(range)).data,
    placeholderData: keepPreviousData,
    refetchInterval: live ? LIVE_MS : false,
  });
  const { refetch } = usage;
  useEffect(() => {                                                // coming back to the tab refreshes it
    const back = () => { if (!document.hidden) void refetch(); };
    document.addEventListener('visibilitychange', back);
    return () => document.removeEventListener('visibilitychange', back);
  }, [refetch]);

  const data = usage.data;
  const filtered = useMemo(() => (data ? searchModules(data.modules, query) : []), [data, query]);
  const visibleKeys = useMemo(() => (data ? data.modules.filter((m) => !hidden.includes(m.module_key)).map((m) => m.module_key) : []), [data, hidden]);
  const stack = useMemo(() => (data ? stackTotals(data.series, visibleKeys) : { totals: [], max: 1 }), [data, visibleKeys]);
  const open = query.trim() ? filtered.map((m) => m.module_key) : (expanded ?? (data?.modules[0] ? [data.modules[0].module_key] : []));

  const exportCsv = async () => {
    setExporting(true);
    try {
      const res = await adminApi.exportAIUsage({ date_from: rangeStart(range, new Date()).toISOString() });
      const url = URL.createObjectURL(res.data as Blob);
      const a = document.createElement('a');
      a.href = url; a.download = `ai-usage-${range}.csv`; document.body.appendChild(a); a.click(); a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      notify.success('The usage was saved as a spreadsheet');
    } catch (e) {
      notify.error(e, { title: 'The export did not finish', fallback: 'Nothing was saved. Try again.', retry: canRetry(e) ? () => { void exportCsv(); } : undefined });
    } finally {
      setExporting(false);
    }
  };

  if (usage.isError && !data) {
    return <ErrorState title="Couldn't load the token usage" message={errorMessage(usage.error)} onRetry={canRetry(usage.error) ? () => { void refetch(); } : undefined} />;
  }

  const costOn = !!data?.cost_configured;
  const columns: RegisterColumn<Module>[] = [
    {
      key: 'module', header: 'Module', isRowHeader: true,
      cell: (m) => (
        <span className="flex min-w-0 flex-nowrap items-center gap-x-[8px]">
          <span aria-hidden className="h-[10px] w-[10px] shrink-0 rounded-[3px]" style={{ background: m.color }} />
          <span className="min-w-0 truncate font-[600] text-ds-fg">{m.label}</span>
          {m.budget_pct != null && budgetBand(m.budget_pct) !== 'ok' && <StatusPill size="sm" {...statusPill(budgetUse, budgetBand(m.budget_pct))} label={`${m.budget_pct.toFixed(0)}% of budget`} />}
        </span>
      ),
    },
    { key: 'tokens', header: 'Tokens', align: 'right', card: 'meta', cell: (m) => <span className="tabular-nums">{fmtTokens(m.tokens)}</span> },
    { key: 'cost', header: 'Cost', align: 'right', priority: 2, card: 'meta', cell: (m) => <span className="tabular-nums text-ds-fg-muted">{costOn ? money(m.cost) : '—'}</span> },
    { key: 'share', header: 'Share of total', priority: 2, card: 'meta', cell: (m) => <Share share={m.share} color={m.color} />, cardCell: (m) => `${m.share.toFixed(1)}%` },
    { key: 'trend', header: 'Change', priority: 2, card: 'meta', cell: (m) => <Trend pct={m.trend} />, cardCell: (m) => trendOf(m.trend).text },
  ];

  return (
    <div className="flex flex-col gap-[16px]">
      <div className="flex flex-wrap items-center justify-between gap-x-[12px] gap-y-[8px]">
        <SegmentedControl label="Period" name="usage-range" options={RANGES} value={range} onChange={onRange} />
        <div className="flex flex-wrap items-center gap-[8px]">
          <span role="status" className="text-ds-label text-ds-fg-muted">
            {usage.isFetching ? 'Refreshing…' : live ? `Live · updated ${usage.dataUpdatedAt ? new Date(usage.dataUpdatedAt).toTimeString().slice(0, 5) : '—'}` : 'Paused'}
          </span>
          <Button size="sm" onClick={() => setLive((v) => !v)}>{live ? 'Pause' : 'Resume'}</Button>
          <Button size="sm" leftIcon={<RefreshCw aria-hidden />} onClick={() => { void refetch(); }}>Refresh</Button>
          <Button onClick={onBudgets}>Budgets</Button>
          <Button leftIcon={<Download aria-hidden />} loading={exporting} onClick={() => { void exportCsv(); }}>Export</Button>
        </div>
      </div>

      {usage.isError && data && (
        <Notice tone="warning" title="The figures could not be refreshed" action={<Button size="sm" onClick={() => { void refetch(); }}>Try again</Button>}>
          What you see was loaded a moment ago.
        </Notice>
      )}
      {data?.alert && (
        <Notice tone="danger" title={data.alert.text} action={<Button size="sm" onClick={onBudgets}>Review budgets</Button>}>
          Use of the monthly budget is close to the limit.
        </Notice>
      )}

      <div className={`${GRID} grid-cols-1 sm:grid-cols-2 lg:grid-cols-4`}>
        <StatTile
          label="Tokens used" value={data ? fmtTokens(data.summary.total_tokens) : null} loading={!data}
          progress={data ? Math.min(100, data.quota.cycle_pct) : null}
          note={data ? `${data.quota.cycle_pct}% of the ${fmtTokens(data.quota.monthly_quota)} monthly quota` : undefined}
          tone={data && quotaTone(data.quota.cycle_pct) === 'danger' ? 'danger' : 'default'}
        />
        <StatTile
          label="Estimated cost" value={data && costOn ? money(data.summary.total_cost) : null} loading={!data}
          info={costOn ? undefined : 'No rate is set yet. Set one in Budgets to see the estimated cost.'}
          note={data && costOn ? `At ${money(data.blended_rate_per_million)} per million tokens` : undefined}
        />
        <StatTile
          label="Daily average" value={data ? fmtTokens(data.summary.daily_average) : null} loading={!data}
          note={data ? (trendOf(data.summary.trend_pct).direction === 'same' ? 'No change from the period before' : <><Trend pct={data.summary.trend_pct} /> than the period before</>) : undefined}
        />
        <StatTile
          label="Top module" value={data ? (data.top_module ? data.top_module.label : 'No use yet') : null} loading={!data}
          note={data?.top_module ? `${fmtTokens(data.top_module.tokens)} tokens · ${data.top_module.share}% of all use` : undefined}
        />
      </div>

      <div className="grid gap-[16px] lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <SectionCard id="over-time" title="Usage over time" info="Each bar is the tokens used in that hour or day, stacked by module. Press a module to show or hide it.">
          {!data ? <SkeletonLines lines={5} label="Loading the chart" /> : data.series.length === 0 ? (
            <EmptyState bare kind="firstUse" title="No use in this period" description="Pick a longer period." />
          ) : (
            <>
              <ChartFrame
                title={`Tokens per ${data.granularity === 'hour' ? 'hour' : 'day'}, ${rangeLabel(range).toLowerCase()}`}
                data={{ columns: [data.granularity === 'hour' ? 'Hour' : 'Day', 'Tokens'], rows: chartRows(data.series, visibleKeys, data.granularity) }}
                height={180}
              >
                <div className={`flex h-full items-end ${data.series.length > 40 ? 'gap-[1px]' : 'gap-[3px]'}`}>
                  {data.series.map((pt, i) => {
                    const total = stack.totals[i];
                    return (
                      <div key={pt.date} className="flex h-full flex-1 flex-col justify-end" title={`${axisLabel(pt.date, data.granularity)} · ${formatCount(total)} tokens`}>
                        <div className="flex flex-col-reverse" style={{ height: `${(total / stack.max) * 100}%`, minHeight: total ? 2 : 0 }}>
                          {data.modules.filter((m) => visibleKeys.includes(m.module_key)).map((m) => {
                            const v = pt.values[m.module_key] || 0;
                            return v ? <div key={m.module_key} style={{ height: `${(v / total) * 100}%`, background: m.color }} /> : null;
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </ChartFrame>
              <div aria-hidden className="mt-[4px] flex justify-between text-ds-label text-ds-fg-muted">
                <span>{axisLabel(data.series[0].date, data.granularity)}</span>
                <span>{axisLabel(data.series[Math.floor(data.series.length / 2)].date, data.granularity)}</span>
                <span>{axisLabel(data.series[data.series.length - 1].date, data.granularity)}</span>
              </div>
              <div role="group" aria-label="Modules shown in the chart" className="mt-[12px] flex flex-wrap gap-[6px]">
                {data.modules.map((m) => {
                  const off = hidden.includes(m.module_key);
                  return (
                    <button
                      key={m.module_key} type="button" aria-pressed={!off}
                      onClick={() => setHidden((h) => (h.includes(m.module_key) ? h.filter((k) => k !== m.module_key) : [...h, m.module_key]))}
                      className={`inline-flex min-h-ds-control-sm items-center gap-[6px] rounded-full border border-ds-border-strong px-[10px] text-ds-label focus-visible:outline-none focus-visible:shadow-ds-ring ${off ? 'text-ds-fg-muted line-through' : 'text-ds-fg-body'}`}
                    >
                      <span aria-hidden className="h-[8px] w-[8px] rounded-[2px]" style={{ background: off ? 'var(--ds-border-strong)' : m.color }} />
                      {m.label}
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </SectionCard>

        <SectionCard id="budget-use" title="Budget use" actions={<Button size="sm" onClick={onBudgets}>Budgets</Button>}>
          {!data ? <SkeletonLines lines={4} label="Loading the budgets" /> : (
            <div className="flex flex-col gap-[12px]">
              {data.utilization.length === 0 ? (
                <p className="m-0 text-ds-body text-ds-fg-muted">No module budgets are set. Set one in Budgets to see how much is used.</p>
              ) : data.utilization.map((u) => {
                const band = budgetBand(u.pct);
                return (
                  <div key={u.module_key} className="flex flex-col gap-[4px]">
                    <div className="flex flex-wrap items-center justify-between gap-x-[8px] gap-y-[2px]">
                      <span className="flex items-center gap-[8px] text-ds-body text-ds-fg"><span aria-hidden className="h-[8px] w-[8px] rounded-full" style={{ background: u.color }} />{u.label}</span>
                      <span className="text-ds-label tabular-nums text-ds-fg-muted">{fmtTokens(u.used)} of {fmtTokens(u.budget)}</span>
                    </div>
                    <ProgressBar value={Math.min(100, u.pct)} label={`${u.label} budget used`} valueText={`${u.pct.toFixed(0)}%`} tone={BAND_TONE[band]} />
                    {band !== 'ok' && <span><StatusPill size="sm" {...statusPill(budgetUse, band)} /></span>}
                  </div>
                );
              })}
              <p className="m-0 border-t border-ds-border pt-[10px] text-ds-body text-ds-fg-muted">
                Projected for the month: <span className={data.projection_note.over ? 'font-[600] text-ds-danger' : 'font-[600] text-ds-fg'}>{fmtTokens(data.projection_note.value)}</span> of {fmtTokens(data.projection_note.quota)}
                {data.projection_note.over ? ' — over the quota' : ''}
              </p>
            </div>
          )}
        </SectionCard>
      </div>

      <div className="grid gap-[16px] lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <SectionCard
          id="by-module" title="Use by module" meta={data ? `${data.modules.length} ${data.modules.length === 1 ? 'module' : 'modules'}` : undefined}
          actions={(
            <>
              <TextInput aria-label="Search modules and features" placeholder="Search modules" className="w-[200px]" leftAdornment={<Search aria-hidden size={14} />} value={query} onChange={(e) => setQuery(e.target.value)} />
              <Button size="sm" onClick={() => setExpanded(data ? data.modules.map((m) => m.module_key) : [])}>Open all</Button>
              <Button size="sm" onClick={() => setExpanded([])}>Close all</Button>
            </>
          )}
        >
          <RegisterTable
            caption="Token use by module"
            columns={columns}
            rows={filtered}
            getRowId={(m) => m.module_key}
            loading={!data}
            cardTitle={(m) => <span className="font-[600] text-ds-fg">{m.label}</span>}
            expand={{
              open,
              onChange: (next) => setExpanded(next as string[]),
              label: (m) => `Details of ${m.label}`,
              render: (m) => (
                <ul className="m-0 flex list-none flex-col p-0">
                  {m.features.length === 0 ? <li className="py-[6px] text-ds-body text-ds-fg-muted">No feature has used AI yet.</li> : m.features.map((f) => (
                    <li key={f.feature_key} className="flex flex-wrap items-center justify-between gap-x-[12px] gap-y-[2px] border-t border-ds-border py-[6px] first:border-t-0">
                      <span className="min-w-0 flex-1 basis-[160px] truncate text-ds-body text-ds-fg-body">{f.label}</span>
                      <span className="text-ds-label tabular-nums text-ds-fg">{fmtTokens(f.tokens)} tokens</span>
                      <span className="text-ds-label tabular-nums text-ds-fg-muted">{costOn ? money(f.cost) : '—'}</span>
                      <span className="text-ds-label tabular-nums text-ds-fg-muted">{f.share.toFixed(1)}%</span>
                      <span className="text-ds-label"><Trend pct={f.trend} /></span>
                    </li>
                  ))}
                </ul>
              ),
            }}
            empty={<EmptyState bare kind={query.trim() ? 'noMatches' : 'firstUse'} title={query.trim() ? 'No module or feature matches' : 'No AI use recorded yet'} onClearFilters={query.trim() ? () => setQuery('') : undefined} />}
          />
        </SectionCard>

        <SectionCard id="consumers" title="Heaviest users" info="The people whose AI use was highest in this period.">
          {!data ? <SkeletonLines lines={4} label="Loading the heaviest users" /> : data.consumers.length === 0 ? (
            <p className="m-0 text-ds-body text-ds-fg-muted">No one has used AI in this period.</p>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-[10px] p-0">
              {data.consumers.map((c, i) => {
                const top = data.consumers[0].tokens || 1;
                const who = c.user_id ? (
                  <Link href={`/admin/ai-usage?view=people&person=${c.user_id}`} className="truncate text-ds-body font-[600] text-ds-primary-text hover:underline focus-visible:outline-none focus-visible:shadow-ds-ring">{c.display_name}</Link>
                ) : <span className="truncate text-ds-body font-[600] text-ds-fg">{c.display_name}</span>;
                return (
                  <li key={`${c.username}-${i}`} className="flex items-center gap-[10px]">
                    <Avatar name={c.display_name} size={32} decorative />
                    <span className="flex min-w-0 flex-1 flex-col">{who}<span className="truncate text-ds-label text-ds-fg-muted">{c.department || '—'}</span></span>
                    <span className="flex w-[84px] shrink-0 flex-col items-end gap-[4px]">
                      <span className="text-ds-label tabular-nums text-ds-fg">{fmtTokens(c.tokens)}</span>
                      <span aria-hidden className="h-[4px] w-full overflow-hidden rounded-full bg-ds-border"><span className="block h-full rounded-full bg-ds-primary" style={{ width: `${(c.tokens / top) * 100}%` }} /></span>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
          {data && <p className="m-0 mt-[10px] text-ds-body text-ds-fg-muted">{formatCount(data.active_user_count)} {data.active_user_count === 1 ? 'person' : 'people'} used AI in this period.</p>}
        </SectionCard>
      </div>
    </div>
  );
}
