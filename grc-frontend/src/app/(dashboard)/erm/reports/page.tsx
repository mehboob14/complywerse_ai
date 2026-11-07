'use client';

// Risk Management > Reports & Analytics: four views of the programme (executive, board, by category, audit) on the kit, drawn from the shapes the server actually sends (GET /erm/reports/
// executive-dashboard, /board-summary, /aggregated): the old page read keys the server never sent (`summary`, `risk_profile_summary`), so every figure read 0 and two lists came from addresses
// that do not exist. Each tab asks only for what it shows, loads, fails (with Retry) and has nothing on its own: a figure the server did not give is "Not recorded", never a 0, and a
// failed request is never drawn as an empty list. Every risk named is a link to it. The audit export keeps what it did (it creates the audit report on the server) and now says so.
import { useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { PageHeader } from '@/components/ui';
import { Button, EmptyState, ErrorState, SectionCard, SkeletonRows, StatTile, StatusPill, Tabs, TabPanel, TitleLink, useReportedMutation, useTabParam, type TabItem } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { ermApi } from '@/lib/api';
import { formatCount, formatDate, statusLabel } from '@/lib/format';
import { routeFor } from '@/lib/navRegistry';
import { statusPill } from '@/lib/status';
import { riskLevel, riskStatus } from '@/lib/statuses/risk';
import type { ReportType } from '@/types';
import { bandOf, categoryLabel } from '../risks/_register/riskModel';

const TABS = ['executive', 'board', 'department', 'audit'] as const;
type Tab = (typeof TABS)[number];
const TAB_ITEMS: TabItem[] = [{ key: 'executive', label: 'Executive' }, { key: 'board', label: 'Board' }, { key: 'department', label: 'By category' }, { key: 'audit', label: 'Audit' }];
const retry = (failures: number, e: unknown) => failures < 3 && canRetry(e);

const num = (v: number | null | undefined, digits = 0): string | null => (typeof v === 'number' && Number.isFinite(v) ? (digits ? v.toFixed(digits) : formatCount(v)) : null);
const key = (c: unknown): string => String(c ?? '').toLowerCase().replace(/[\s-]+/g, '_');
const list = <T,>(x: T[] | null | undefined): T[] => (Array.isArray(x) ? x : []);

function Panel<T>({ q, label, children }: { q: { data: T | undefined; isPending: boolean; isError: boolean; error: unknown; refetch: () => unknown }; label: string; children: (data: T) => React.ReactNode }) {
  if (q.isPending) return <SkeletonRows rows={5} columns={3} label={`Loading ${label}`} />;
  if (q.isError && !q.data) return <ErrorState title={`Couldn't load ${label}`} message={errorMessage(q.error)} onRetry={canRetry(q.error) ? () => { void q.refetch(); } : undefined} />;
  return <>{children(q.data as T)}</>;
}

const ROW = 'flex min-h-[44px] flex-wrap items-center gap-x-[12px] gap-y-[2px] border-b border-ds-border py-[6px] last:border-b-0';
const NONE = 'm-0 text-ds-body text-ds-fg-muted';

/** A risk a report names: a link to it, with its category under it. */
function RiskLine({ id, title, category, children }: { id: number; title: string; category?: string | null; children?: React.ReactNode }) {
  return (
    <li className={ROW}>
      <div className="min-w-[180px] flex-1"><TitleLink href={`/erm/risks/${id}`} title={title} lines={2} tone="title" size="body" />{category && <span className="text-ds-label text-ds-fg-muted">{categoryLabel(key(category))}</span>}</div>
      {children}
    </li>
  );
}

function ScoreWords({ score }: { score: number | null | undefined }) {
  return <span className="inline-flex items-center gap-[6px]"><span className="tabular-nums text-ds-body font-[600] text-ds-fg">{score ?? '—'}</span><StatusPill size="sm" {...statusPill(riskLevel, bandOf(score))} /></span>;
}

export default function ReportsPage() {
  const [tab, setTab] = useTabParam<Tab>('tab', TABS, { fallback: 'executive' });

  // the executive report feeds two tabs (the audit tab lists its appetite breaches): one request, one key
  const executive = useQuery({ queryKey: ['erm-executive-dashboard'], queryFn: async () => (await ermApi.reports.getExecutiveDashboard()).data as any, enabled: tab === 'executive' || tab === 'audit', retry });
  const board = useQuery({ queryKey: ['erm-board-summary'], queryFn: async () => (await ermApi.reports.getBoardSummary()).data as any, enabled: tab === 'board', retry });
  const byCategory = useQuery({ queryKey: ['erm-aggregated-view'], queryFn: async () => (await ermApi.reports.getAggregatedView('category')).data as any[], enabled: tab === 'department', retry });

  const generate = useReportedMutation({
    mutationFn: (data: { name: string; report_type: ReportType }) => ermApi.reports.generate(data),
    success: { title: 'Audit report created', message: 'The audit report was generated on the server.' },
    failure: "Couldn't create the audit report",
    invalidate: [['erm-reports']],
  });

  const title = routeFor('/erm/reports')?.label ?? 'Reports & Analytics';
  return (
    <div className="flex flex-col gap-[16px]">
      <PageHeader variant="page" title={title} info="Executive, board, category and audit views of the risk programme." />
      <Tabs tabs={TAB_ITEMS} value={tab} onChange={setTab} ariaLabel="Report views">
        <TabPanel tabKey="executive" lazy>
          <Panel q={executive} label="the executive report">
            {(d) => (
              <div className="flex flex-col gap-[16px]">
                <div className="grid gap-[12px] sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
                  <StatTile label="Total risks" value={num(d?.total_risks)} />
                  <StatTile label="Critical risks" value={num(d?.risks_by_score_band?.critical)} tone={d?.risks_by_score_band?.critical > 0 ? 'danger' : undefined} />
                  <StatTile label="High risks" value={num(d?.risks_by_score_band?.high)} tone={d?.risks_by_score_band?.high > 0 ? 'warning' : undefined} />
                  <StatTile label="Appetite breaches" value={num(Array.isArray(d?.appetite_breaches) ? d.appetite_breaches.length : null)} tone={list(d?.appetite_breaches).length > 0 ? 'warning' : undefined} />
                  <StatTile label="Pending reviews" value={num(d?.pending_reviews)} />
                  <StatTile label="Overdue reviews" value={num(d?.overdue_reviews)} tone={d?.overdue_reviews > 0 ? 'danger' : undefined} />
                </div>
                <div className="grid gap-[16px] lg:grid-cols-2">
                  <SectionCard id="top-risks" title="Top risks" info="By residual score, else inherent.">
                    {list(d?.top_risks).length === 0 ? <p className={NONE}>No scored risks yet.</p> : (
                      <ul className="m-0 list-none p-0">{list<any>(d.top_risks).slice(0, 10).map((r) => <RiskLine key={r.id} id={r.id} title={r.title} category={r.category}><ScoreWords score={r.score} />{r.status && <StatusPill size="sm" {...statusPill(riskStatus, r.status)} />}</RiskLine>)}</ul>
                    )}
                  </SectionCard>
                  <div className="flex flex-col gap-[16px]">
                    <SectionCard id="kri-alerts" title="KRI alerts">
                      {list(d?.kri_alerts).length === 0 ? <p className={NONE}>No indicators are in alert.</p> : (
                        <ul className="m-0 list-none p-0">
                          {list<any>(d.kri_alerts).slice(0, 8).map((a) => (
                            <li key={a.kri_id ?? a.id} className={ROW}>
                              <span className="min-w-0 flex-1 break-words text-ds-body text-ds-fg-body">{a.name}</span>
                              <StatusPill size="sm" tone={a.status === 'red' ? 'danger' : 'warning'} label={`${a.value ?? '—'} · ${a.status === 'red' ? 'Red' : 'Amber'}`} />
                            </li>
                          ))}
                        </ul>
                      )}
                    </SectionCard>
                    <SectionCard id="incidents" title="Recent incidents">
                      {list(d?.recent_incidents).length === 0 ? <p className={NONE}>No recent incidents.</p> : (
                        <ul className="m-0 list-none p-0">
                          {list<any>(d.recent_incidents).slice(0, 5).map((i) => (
                            <li key={i.id} className={ROW}>
                              <span className="min-w-0 flex-1 break-words text-ds-body text-ds-fg-body">{i.title}</span>
                              <span className="text-ds-label text-ds-fg-muted">{[statusLabel(i.severity), i.date ? formatDate(i.date) : ''].filter(Boolean).join(' · ')}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </SectionCard>
                  </div>
                </div>
              </div>
            )}
          </Panel>
        </TabPanel>

        <TabPanel tabKey="board" lazy>
          <Panel q={board} label="the board summary">
            {(d) => (
              <div className="flex flex-col gap-[16px]">
                <SectionCard id="summary" title="Summary" meta={d?.report_period ? `Period: ${d.report_period}` : undefined}>
                  {d?.executive_summary ? <p className="mb-[12px] mt-0 text-ds-body text-ds-fg-body">{d.executive_summary}</p> : null}
                  <div className="grid gap-[12px] sm:grid-cols-3 lg:grid-cols-6">
                    <StatTile label="Total risks" value={num(d?.risk_overview?.total_risks)} />
                    <StatTile label="Average inherent score" value={num(d?.risk_overview?.avg_inherent_score, 1)} />
                    <StatTile label="Average residual score" value={num(d?.risk_overview?.avg_residual_score, 1)} />
                    <StatTile label="Incidents" value={num(d?.incidents_summary?.total_incidents)} />
                    <StatTile label="Open incidents" value={num(d?.incidents_summary?.open_incidents)} tone={d?.incidents_summary?.open_incidents > 0 ? 'warning' : undefined} />
                    <StatTile label="Financial impact" value={num(d?.incidents_summary?.total_financial_impact)} />
                  </div>
                </SectionCard>
                <div className="grid gap-[16px] lg:grid-cols-2">
                  <SectionCard id="appetite" title="Appetite by category">
                    {list(d?.appetite_status).length === 0 ? <p className={NONE}>No appetite is set for any category.</p> : (
                      <ul className="m-0 list-none p-0">
                        {list<any>(d.appetite_status).map((a) => (
                          <li key={a.category} className={ROW}>
                            <span className="min-w-[120px] flex-1 text-ds-body font-[600] text-ds-fg">{categoryLabel(key(a.category))}</span>
                            <span className="text-ds-body text-ds-fg-muted">{formatCount(a.total_risks)} risks</span>
                            <span className={`text-ds-body ${a.breaching_appetite > 0 ? 'font-[600] text-ds-danger' : 'text-ds-fg-body'}`}>{formatCount(a.breaching_appetite)} above appetite</span>
                            <span className="text-ds-label text-ds-fg-muted">{[a.appetite_level ? statusLabel(a.appetite_level) : '', a.max_score != null ? `limit ${a.max_score}` : ''].filter(Boolean).join(' · ')}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </SectionCard>
                  <SectionCard id="board-top" title="Top risks">
                    {list(d?.top_risks).length === 0 ? <p className={NONE}>No scored risks yet.</p> : (
                      <ul className="m-0 list-none p-0">{list<any>(d.top_risks).slice(0, 10).map((r) => <RiskLine key={r.id} id={r.id} title={r.title} category={r.category}><ScoreWords score={r.score} /></RiskLine>)}</ul>
                    )}
                  </SectionCard>
                </div>
                {list(d?.recommendations).length > 0 && (
                  <SectionCard id="recommendations" title="Recommendations">
                    <ul className="m-0 list-disc pl-[20px] text-ds-body text-ds-fg-body">{list<string>(d.recommendations).map((r) => <li key={r}>{r}</li>)}</ul>
                  </SectionCard>
                )}
              </div>
            )}
          </Panel>
        </TabPanel>

        <TabPanel tabKey="department" lazy>
          <Panel q={byCategory} label="the category view">
            {(rows) => (
              <SectionCard id="by-category" title="Risk by category" meta={`${formatCount(list(rows).length)} ${list(rows).length === 1 ? 'category' : 'categories'}`}>
                {list(rows).length === 0 ? <EmptyState kind="firstUse" bare title="No risks to group yet" /> : (
                  <ul className="m-0 list-none p-0">
                    {list<any>(rows).map((v) => (
                      <li key={v.group_value} className={ROW}>
                        <TitleLink href={`/erm/risks?cat=${encodeURIComponent(key(v.group_value))}`} title={categoryLabel(key(v.group_value))} lines={1} tone="title" size="body" className="min-w-[140px] flex-1" />
                        <span className="text-ds-body text-ds-fg-muted">{formatCount(v.total_risks)} {v.total_risks === 1 ? 'risk' : 'risks'}</span>
                        <span className="text-ds-body text-ds-fg-body">{formatCount(v.critical_count)} critical, {formatCount(v.high_count)} high</span>
                        <span className="text-ds-body text-ds-fg-body">Average inherent <b className="tabular-nums">{num(v.avg_inherent_score, 1) ?? '—'}</b></span>
                        <span className="text-ds-body text-ds-fg-body">Average residual <b className="tabular-nums">{num(v.avg_residual_score, 1) ?? '—'}</b></span>
                      </li>
                    ))}
                  </ul>
                )}
              </SectionCard>
            )}
          </Panel>
        </TabPanel>

        <TabPanel tabKey="audit" lazy>
          <Panel q={executive} label="the appetite breaches">
            {(d) => (
              <SectionCard
                id="breaches" title="Appetite breaches" meta={`${formatCount(list(d?.appetite_breaches).length)} ${list(d?.appetite_breaches).length === 1 ? 'risk' : 'risks'}`}
                info="Risks whose residual score is above the limit set for their category."
                actions={<Button variant="primary" leftIcon={<Download aria-hidden />} loading={generate.isPending} onClick={() => generate.mutate({ name: `Audit Export ${new Date().toISOString().slice(0, 10)}`, report_type: 'audit' })}>Export audit report</Button>}
              >
                {list(d?.appetite_breaches).length === 0 ? <p className={NONE}>No risk is above its appetite.</p> : (
                  <ul className="m-0 list-none p-0">
                    {list<any>(d.appetite_breaches).map((b) => (
                      <RiskLine key={b.risk_id} id={b.risk_id} title={b.risk_title} category={b.category}>
                        <span className="text-ds-body font-[600] text-ds-danger">{`+${Math.round((b.score ?? 0) - (b.threshold ?? 0))} over the limit`}</span>
                        <span className="text-ds-label text-ds-fg-muted">{`score ${b.score}, limit ${b.threshold}`}</span>
                      </RiskLine>
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
