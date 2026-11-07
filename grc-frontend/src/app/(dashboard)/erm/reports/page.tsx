'use client';

// Risk Management > Reports & Analytics: four views of the programme (executive, board, by category, audit) on the kit. Each tab asks only for what it shows, loads, fails (with Retry)
// and has nothing on its own: a figure the server did not give is "Not recorded", never a 0, and a failed request is never drawn as an empty list. Every risk named is a link to it.
// The audit export keeps what it did (it creates the audit report on the server) and now says so. The old page also asked for the 90-day trend and never drew it; that request is gone.
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Download, TrendingDown, TrendingUp } from 'lucide-react';
import { PageHeader } from '@/components/ui';
import { Button, EmptyState, ErrorState, SectionCard, SkeletonRows, StatTile, StatusPill, Tabs, TabPanel, TitleLink, useReportedMutation, useTabParam, type TabItem } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { ermApi } from '@/lib/api';
import { formatCount } from '@/lib/format';
import { routeFor } from '@/lib/navRegistry';
import type { ReportType } from '@/types';
import { categoryLabel } from '../risks/_register/riskModel';

const TABS = ['executive', 'board', 'department', 'audit'] as const;
type Tab = (typeof TABS)[number];
const TAB_ITEMS: TabItem[] = [{ key: 'executive', label: 'Executive' }, { key: 'board', label: 'Board' }, { key: 'department', label: 'By category' }, { key: 'audit', label: 'Audit' }];
const retry = (failures: number, e: unknown) => failures < 3 && canRetry(e);

const num = (v: number | null | undefined, digits = 0): string | null => (typeof v === 'number' && Number.isFinite(v) ? (digits ? v.toFixed(digits) : formatCount(v)) : null);
const key = (c: unknown): string => String(c ?? '').toLowerCase().replace(/[\s-]+/g, '_');

function Panel<T>({ q, label, children }: { q: { data: T | undefined; isPending: boolean; isError: boolean; error: unknown; refetch: () => unknown }; label: string; children: (data: T) => React.ReactNode }) {
  if (q.isPending) return <SkeletonRows rows={5} columns={3} label={`Loading ${label}`} />;
  if (q.isError && !q.data) return <ErrorState title={`Couldn't load ${label}`} message={errorMessage(q.error)} onRetry={canRetry(q.error) ? () => { void q.refetch(); } : undefined} />;
  return <>{children(q.data as T)}</>;
}

export default function ReportsPage() {
  const [tab, setTab] = useTabParam<Tab>('tab', TABS, { fallback: 'executive' });

  const executive = useQuery({ queryKey: ['erm-executive-dashboard'], queryFn: async () => (await ermApi.reports.getExecutiveDashboard()).data as any, enabled: tab === 'executive', retry });
  const board = useQuery({ queryKey: ['erm-board-summary'], queryFn: async () => (await ermApi.reports.getBoardSummary()).data as any, enabled: tab === 'board', retry });
  const byCategory = useQuery({ queryKey: ['erm-aggregated-view'], queryFn: async () => (await ermApi.reports.getAggregatedView('category')).data as any[], enabled: tab === 'department', retry });
  const breaches = useQuery({ queryKey: ['erm-appetite-breaches'], queryFn: async () => (await ermApi.reports.getAppetiteBreaches()).data as any[], enabled: tab === 'audit', retry });

  const generate = useReportedMutation({
    mutationFn: (data: { name: string; report_type: ReportType }) => ermApi.reports.generate(data),
    success: { title: 'Audit report created', message: 'The audit report was generated on the server.' },
    failure: "Couldn't create the audit report",
    invalidate: [['erm-reports']],
  });

  const title = routeFor('/erm/reports')?.label ?? 'Reports & Analytics';
  const card = 'rounded-ds-card border border-ds-border bg-ds-surface p-[16px]';
  return (
    <div className="flex flex-col gap-[16px]">
      <PageHeader variant="page" title={title} info="Executive, board, category and audit views of the risk programme." />
      <Tabs tabs={TAB_ITEMS} value={tab} onChange={setTab} ariaLabel="Report views">
        <TabPanel tabKey="executive" lazy>
          <Panel q={executive} label="the executive report">
            {(d) => (
              <div className="flex flex-col gap-[16px]">
                <div className="grid gap-[12px] sm:grid-cols-2 lg:grid-cols-4">
                  <StatTile label="Total risks" value={num(d?.summary?.total_risks)} />
                  <StatTile label="Critical risks" value={num(d?.summary?.critical_risks)} tone={d?.summary?.critical_risks > 0 ? 'danger' : undefined} />
                  <StatTile label="Average risk score" value={num(d?.summary?.avg_risk_score, 1)} />
                  <StatTile label="Appetite breaches" value={num(d?.summary?.risks_exceeding_appetite)} tone={d?.summary?.risks_exceeding_appetite > 0 ? 'warning' : undefined} />
                </div>
                <div className="grid gap-[16px] lg:grid-cols-2">
                  <SectionCard id="top-risks" title="Top risks">
                    {(d?.top_risks ?? []).length === 0 ? <p className="m-0 text-ds-body text-ds-fg-muted">No risks to show.</p> : (
                      <ul className="m-0 list-none p-0">
                        {d.top_risks.slice(0, 5).map((r: any) => (
                          <li key={r.id} className="flex min-h-[44px] items-center gap-[8px] border-b border-ds-border py-[4px] last:border-b-0">
                            <div className="min-w-0 flex-1"><TitleLink href={`/erm/risks/${r.id}`} title={r.title} lines={2} tone="title" size="body" /></div>
                            <span className="tabular-nums text-ds-body font-[600] text-ds-fg">{r.score}</span>
                            {r.trend === 'up' ? <span className="inline-flex items-center gap-[2px] text-ds-label text-ds-danger"><TrendingUp aria-hidden className="h-[16px] w-[16px]" />Rising</span> : r.trend === 'down' ? <span className="inline-flex items-center gap-[2px] text-ds-label text-ds-success"><TrendingDown aria-hidden className="h-[16px] w-[16px]" />Falling</span> : null}
                          </li>
                        ))}
                      </ul>
                    )}
                  </SectionCard>
                  <SectionCard id="kri-alerts" title="KRI alerts">
                    {(d?.kri_alerts ?? []).length === 0 ? <p className="m-0 text-ds-body text-ds-fg-muted">No indicators are in alert.</p> : (
                      <ul className="m-0 list-none p-0">
                        {d.kri_alerts.slice(0, 5).map((a: any) => (
                          <li key={a.id} className="flex min-h-[44px] items-center gap-[8px] border-b border-ds-border py-[4px] last:border-b-0">
                            <span className="min-w-0 flex-1 break-words text-ds-body text-ds-fg-body">{a.name}</span>
                            <StatusPill size="sm" tone={a.status === 'red' ? 'danger' : 'warning'} label={`${a.value} · ${a.status === 'red' ? 'Red' : 'Amber'}`} />
                          </li>
                        ))}
                      </ul>
                    )}
                  </SectionCard>
                </div>
              </div>
            )}
          </Panel>
        </TabPanel>

        <TabPanel tabKey="board" lazy>
          <Panel q={board} label="the board summary">
            {(d) => (
              <div className="flex flex-col gap-[16px]">
                <SectionCard id="profile" title="Risk profile" meta={`Period: ${d?.period || 'Current quarter'}`}>
                  <div className="grid gap-[12px] sm:grid-cols-3">
                    <StatTile label="Total risks" value={num(d?.risk_profile_summary?.total_risks)} />
                    <StatTile label="New risks" value={num(d?.risk_profile_summary?.new_risks)} tone="warning" />
                    <StatTile label="Closed risks" value={num(d?.risk_profile_summary?.closed_risks)} tone="success" />
                  </div>
                </SectionCard>
                <SectionCard id="changes" title="Key risk changes">
                  {(d?.key_risk_changes ?? []).length === 0 ? <p className="m-0 text-ds-body text-ds-fg-muted">No risk changed enough to report.</p> : (
                    <ul className="m-0 list-none p-0">
                      {d.key_risk_changes.map((c: any) => (
                        <li key={c.risk_id} className="flex min-h-[44px] items-center gap-[8px] border-b border-ds-border py-[4px] last:border-b-0">
                          <div className="min-w-0 flex-1"><TitleLink href={`/erm/risks/${c.risk_id}`} title={c.title} lines={2} tone="title" size="body" /></div>
                          <span className="tabular-nums text-ds-body text-ds-fg-muted">{c.previous_score}</span>
                          <ArrowRight aria-hidden className="h-[16px] w-[16px] text-ds-fg-muted" />
                          <span className={`tabular-nums text-ds-body font-[600] ${c.change > 0 ? 'text-ds-danger' : 'text-ds-success'}`}>{c.current_score}<span className="sr-only">{c.change > 0 ? ', higher' : ', lower'}</span></span>
                        </li>
                      ))}
                    </ul>
                  )}
                </SectionCard>
              </div>
            )}
          </Panel>
        </TabPanel>

        <TabPanel tabKey="department" lazy>
          <Panel q={byCategory} label="the category view">
            {(rows) => (
              <div className={card}>
                <h2 className="m-0 mb-[8px] !text-ds-section !text-ds-fg">Risk by category</h2>
                {(rows ?? []).length === 0 ? <EmptyState kind="firstUse" bare title="No risks to group yet" /> : (
                  <ul className="m-0 list-none p-0">
                    {rows.map((v: any) => (
                      <li key={v.category} className="flex flex-wrap items-center gap-x-[16px] gap-y-[2px] border-b border-ds-border py-[8px] last:border-b-0">
                        <TitleLink href={`/erm/risks?cat=${encodeURIComponent(key(v.category))}`} title={categoryLabel(key(v.category))} lines={1} tone="title" size="body" className="min-w-[140px] flex-1" />
                        <span className="text-ds-body text-ds-fg-muted">{formatCount(v.total_count)} {v.total_count === 1 ? 'risk' : 'risks'}</span>
                        <span className="text-ds-body text-ds-fg-body">Average inherent <b className="tabular-nums">{num(v.avg_inherent_score, 1) ?? '—'}</b></span>
                        <span className="text-ds-body text-ds-fg-body">Average residual <b className="tabular-nums">{num(v.avg_residual_score, 1) ?? '—'}</b></span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </Panel>
        </TabPanel>

        <TabPanel tabKey="audit" lazy>
          <Panel q={breaches} label="the appetite breaches">
            {(rows) => (
              <SectionCard
                id="breaches" title="Appetite breaches" meta={`${formatCount((rows ?? []).length)} ${(rows ?? []).length === 1 ? 'risk' : 'risks'}`}
                actions={<Button variant="primary" leftIcon={<Download aria-hidden />} loading={generate.isPending} onClick={() => generate.mutate({ name: `Audit Export ${new Date().toISOString().slice(0, 10)}`, report_type: 'audit' })}>Export audit report</Button>}
              >
                {(rows ?? []).length === 0 ? <p className="m-0 text-ds-body text-ds-fg-muted">No risk is above its appetite.</p> : (
                  <ul className="m-0 list-none p-0">
                    {rows.map((b: any) => (
                      <li key={b.risk_id} className="flex flex-wrap items-center gap-x-[12px] gap-y-[2px] border-b border-ds-border py-[8px] last:border-b-0">
                        <div className="min-w-[200px] flex-1"><TitleLink href={`/erm/risks/${b.risk_id}`} title={b.risk_title} lines={2} tone="title" size="body" /><span className="text-ds-label text-ds-fg-muted">{categoryLabel(key(b.category))}</span></div>
                        <span className="text-ds-body font-[600] text-ds-danger">+{Number(b.breach_percentage).toFixed(0)}% over appetite</span>
                        <span className="text-ds-label text-ds-fg-muted">{b.days_in_breach} days in breach</span>
                      </li>
                    ))}
                  </ul>
                )}
              </SectionCard>
            )}
          </Panel>
        </TabPanel>
      </Tabs>
    </div>
  );
}
