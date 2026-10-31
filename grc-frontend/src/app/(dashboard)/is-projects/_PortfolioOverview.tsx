'use client';

// The portfolio Overview: what the Projects page opens on, and what /is-projects/dashboard shows alone. Same three requests as ever (the dashboard, the
// enhanced analytics, the health trend), now in two sections that load and fail on their own: the summary (tiles, status, category, budget, milestones) waits for the
// dashboard; the analytics (health trend, burn rate, heatmap, alignment) wait for the enhanced analytics. A failure is said where its numbers would be, in the server's
// words and with Retry, and never reads as zeros or as a missing card (the old page dropped the four analytics cards without a word). Every number is text; the two
// pictures (the status ring, the health bars) say the same numbers in words (role="img" + aria-label from _model.ts). The calculations are _model.ts's, unchanged.
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CalendarClock, PieChart, Shield, Users } from 'lucide-react';
import Link from 'next/link';
import { isProjectsApi } from '@/lib/api';
import { EmptyState, ErrorState, SectionCard, Skeleton, StatusPill, Table, TableFrame, TBody, Td, Th, THead, Tr } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { formatCount, formatDate, formatPercent } from '@/lib/format';
import { TONE, type Tone } from '@/lib/status';
import { projectHealth } from '@/lib/projectStatus';
import {
  LOAD_LEGEND, FRAMEWORK_LEGEND, alignmentOf, burnRows, burnTone, categorySummary, clampPercent, estimateText, frameworkTone, healthScore, heatmapOf, loadPercent,
  loadTone, money, scoreTone, statusSlices, statusSummary, trendSummary, utilizationTone, type Slice, type TrendPoint,
} from './_model';
import { QueryError, Stat, retryRead } from './_ui';

interface MilestoneRow { id: number; name: string; project_name: string; project_id: number; target_date: string }
interface Dashboard {
  total_projects: number;
  status_distribution: Slice[];
  category_distribution: Slice[];
  health_counts: Record<string, number>;
  budget: { total_estimated: number; total_actual: number; utilization: number };
  upcoming_milestones: MilestoneRow[];
  overdue_milestones: MilestoneRow[];
}
interface Enhanced {
  health_distribution: Record<string, number>;
  budget_overview: Array<{ project_id: number; project_name: string; burn_rate_pct: number; budget_estimated: number; budget_actual: number; status: string }>;
  team_utilization: Array<{ name: string; total_projects: number; projects: Array<{ project_name: string; role: string }> }>;
  framework_alignment: Record<string, Array<{ project_id: number; project_name: string; status: string }>>;
}

const HEALTH_WORDS = ['On Track', 'At Risk', 'Off Track'];
const SCORE_WORD: Record<string, string> = { success: 'On Track', warning: 'At Risk', danger: 'Off Track' };
const BAR = 'h-[8px] overflow-hidden rounded-full bg-ds-border';
const ROW_LINK = 'flex min-w-0 items-center gap-[12px] rounded-ds-control px-[8px] py-[8px] hover:bg-ds-surface-hover focus-visible:outline-none focus-visible:shadow-ds-ring';

/** One bar segment, sized by a number of 0-100: in a tone's colour, or in the brand's when it carries no meaning of its own (the categories). */
const Fill = ({ pct, tone }: { pct: number; tone?: Tone }) => (
  <div className={tone ? 'h-full rounded-full' : 'h-full rounded-full bg-ds-primary'} style={{ width: `${clampPercent(pct)}%`, ...(tone ? { background: TONE[tone].dot } : {}) }} />
);

/** A square of a tone with a letter in it (the heatmap and the alignment matrix): the tone's words on its tint, a border of its own, and the full meaning in the label. */
function Cell({ tone, letter, label }: { tone: Tone; letter: string; label: string }) {
  const c = TONE[tone];
  return (
    <span role="img" aria-label={label} title={label} className="mx-auto grid h-[28px] w-[28px] place-items-center rounded-ds-control border text-ds-label font-[600]" style={{ background: c.tint, color: c.text, borderColor: c.border }}>
      <span aria-hidden>{letter}</span>
    </span>
  );
}

const Legend = ({ items }: { items: Array<{ label: string; tone: Tone }> }) => (
  <ul className="mt-[12px] flex flex-wrap items-center gap-x-[12px] gap-y-[4px] text-ds-label text-ds-fg-muted">
    {items.map((i) => (
      <li key={i.label} className="inline-flex items-center gap-[4px]"><span aria-hidden className="h-[10px] w-[10px] rounded-[2px]" style={{ background: TONE[i.tone].dot }} />{i.label}</li>
    ))}
  </ul>
);

/** The ring of the status card, drawn as SVG arcs (one per status, a small gap between them) in the tone of each status. */
function Ring({ slices, total }: { slices: ReturnType<typeof statusSlices>; total: number }) {
  const R = 52;
  const C = 2 * Math.PI * R;
  const shown = slices.filter((s) => s.value > 0);
  const gap = shown.length > 1 ? 3 : 0;
  let done = 0;
  return (
    <div className="relative h-[140px] w-[140px] shrink-0">
      <svg viewBox="0 0 140 140" className="h-[140px] w-[140px]" aria-hidden focusable="false">
        <circle cx="70" cy="70" r={R} fill="none" stroke={TONE.neutral.tint} strokeWidth="18" />
        {shown.map((s) => {
          const len = Math.max(0, (s.value / total) * C - gap);
          const arc = <circle key={s.key} cx="70" cy="70" r={R} fill="none" stroke={TONE[s.tone].dot} strokeWidth="18" strokeDasharray={`${len} ${C - len}`} strokeDashoffset={-done} transform="rotate(-90 70 70)" />;
          done += (s.value / total) * C;
          return arc;
        })}
      </svg>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-[20px] font-[600] leading-[24px] tabular-nums text-ds-fg">{formatCount(total)}</span>
        <span className="text-ds-label text-ds-fg-muted">total</span>
      </div>
    </div>
  );
}

function SummarySkeleton() {
  return (
    <div role="status" aria-busy="true" className="flex flex-col gap-[16px]">
      <span className="sr-only">Loading the overview</span>
      <div className="grid grid-cols-2 gap-[12px] md:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[84px] w-full" />)}</div>
      <div className="grid grid-cols-1 gap-[16px] md:grid-cols-2 xl:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-[200px] w-full" />)}</div>
      <div className="grid grid-cols-1 gap-[16px] md:grid-cols-2">{[0, 1].map((i) => <Skeleton key={i} className="h-[160px] w-full" />)}</div>
    </div>
  );
}

function MilestoneList({ id, title, info, rows, overdue }: { id: string; title: string; info: string; rows: MilestoneRow[]; overdue: boolean }) {
  return (
    <SectionCard id={id} title={title} info={info} meta={rows.length > 0 ? `${formatCount(rows.length)} shown` : undefined}>
      {rows.length === 0 ? (
        <EmptyState kind="firstUse" bare icon={overdue ? AlertTriangle : CalendarClock} title={overdue ? 'No overdue milestones' : 'No upcoming milestones'} className="!py-[24px]" />
      ) : (
        <ul className="flex flex-col gap-[4px]">
          {rows.map((m) => (
            <li key={m.id}>
              <Link href={`/is-projects/${m.project_id}`} className={`${ROW_LINK} ${overdue ? 'border border-ds-danger-border bg-ds-danger-soft' : ''}`}>
                <span aria-hidden className={`grid h-[32px] w-[32px] shrink-0 place-items-center rounded-ds-control ${overdue ? 'bg-ds-danger-soft text-ds-danger' : 'bg-ds-primary-soft text-ds-primary-text'}`}>
                  {overdue ? <AlertTriangle className="h-[16px] w-[16px]" strokeWidth={1.75} /> : <CalendarClock className="h-[16px] w-[16px]" strokeWidth={1.75} />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-ds-body font-[600] text-ds-fg" title={m.name}>{m.name}</span>
                  <span className="block truncate text-ds-label text-ds-fg-muted" title={m.project_name}>{m.project_name}</span>
                </span>
                <span className={`shrink-0 text-ds-label tabular-nums ${overdue ? 'font-[600] text-ds-danger' : 'text-ds-fg-muted'}`}>
                  {overdue ? 'Due ' : ''}{formatDate(m.target_date, { calendar: true })}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

function Summary({ data }: { data: Dashboard }) {
  const slices = statusSlices(data.status_distribution);
  const sliceTotal = slices.reduce((a, s) => a + s.value, 0);
  const categories = data.category_distribution ?? [];
  const max = Math.max(...categories.map((c) => c.value), 1);
  const health = data.health_counts ?? {};
  const budget = data.budget ?? { total_estimated: 0, total_actual: 0, utilization: 0 };
  const util = budget.utilization || 0;
  const estimated = budget.total_estimated > 0;
  return (
    <>
      <div className="grid grid-cols-2 gap-[12px] md:grid-cols-4">
        <Stat label="Total projects"><p className="mt-[4px] text-[24px] font-[600] leading-[32px] tabular-nums text-ds-fg">{formatCount(data.total_projects ?? 0)}</p></Stat>
        {HEALTH_WORDS.map((w) => (
          <Stat key={w} label={projectHealth.label(w)} dot={TONE[projectHealth.tone(w)].dot}>
            <p className="mt-[4px] text-[24px] font-[600] leading-[32px] tabular-nums text-ds-fg">{formatCount(health[w] ?? 0)}</p>
          </Stat>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-[16px] md:grid-cols-2 xl:grid-cols-3">
        <SectionCard id="by-status" title="Projects by status">
          {slices.length === 0 ? (
            <EmptyState kind="firstUse" bare icon={PieChart} title="No projects yet" className="!py-[24px]" />
          ) : (
            <div className="flex flex-wrap items-center gap-[16px]">
              <div role="img" aria-label={statusSummary(data.status_distribution)}><Ring slices={slices} total={sliceTotal || 1} /></div>
              <ul className="flex min-w-[10rem] flex-1 flex-col gap-[6px]">
                {slices.map((s) => (
                  <li key={s.key} className="flex items-center gap-[8px] text-ds-body">
                    <span aria-hidden className="h-[10px] w-[10px] shrink-0 rounded-full" style={{ background: TONE[s.tone].dot }} />
                    <span className="min-w-0 flex-1 truncate text-ds-fg-body" title={s.label}>{s.label}</span>
                    <span className="font-[600] tabular-nums text-ds-fg">{formatCount(s.value)}</span>
                    <span className="w-[40px] text-right text-ds-label tabular-nums text-ds-fg-muted">{s.percent}%</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </SectionCard>

        <SectionCard id="by-category" title="Projects by category">
          {categories.length === 0 ? (
            <EmptyState kind="firstUse" bare icon={PieChart} title="No projects yet" className="!py-[24px]" />
          ) : (
            <ul aria-label={categorySummary(categories)} className="flex flex-col gap-[10px]">
              {categories.map((c) => (
                <li key={c.name} className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)_auto] items-center gap-[8px] text-ds-body">
                  <span className="truncate text-ds-fg-body" title={c.name}>{c.name}</span>
                  <span aria-hidden className={BAR}><Fill pct={(c.value / max) * 100} /></span>
                  <span className="min-w-[24px] text-right font-[600] tabular-nums text-ds-fg">{formatCount(c.value)}</span>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <SectionCard id="budget" title="Budget utilization">
          <p className="text-center text-[24px] font-[600] leading-[32px] tabular-nums text-ds-fg">{estimated ? formatPercent(util) : '—'}</p>
          <p className="text-center text-ds-label text-ds-fg-muted">{estimated ? 'of the estimated budget spent' : 'No budget has been estimated yet'}</p>
          <div role="progressbar" aria-label="Budget used" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(clampPercent(util))} className={`mt-[12px] ${BAR} !h-[10px]`}>
            <Fill pct={util} tone={utilizationTone(util)} />
          </div>
          <div className="mt-[12px] flex justify-between gap-[8px] text-ds-label text-ds-fg-muted">
            <span>Actual: <span className="tabular-nums text-ds-fg-body">{money(budget.total_actual)}</span></span>
            <span>Estimated: <span className="tabular-nums text-ds-fg-body">{estimateText(budget.total_estimated)}</span></span>
          </div>
        </SectionCard>
      </div>

      <div className="grid grid-cols-1 gap-[16px] md:grid-cols-2">
        <MilestoneList id="upcoming" title="Upcoming milestones" info="The next 10 milestones that are not completed, soonest first." rows={data.upcoming_milestones ?? []} overdue={false} />
        <MilestoneList id="overdue" title="Overdue milestones" info="The 10 milestones that are furthest past their date and not completed, oldest first." rows={data.overdue_milestones ?? []} overdue />
      </div>
    </>
  );
}

function TrendCard({ enhanced, trendQuery }: { enhanced: Enhanced; trendQuery: { data?: { trend?: TrendPoint[] }; isError: boolean; error: unknown; refetch: () => unknown } }) {
  const hd = enhanced.health_distribution ?? {};
  const total = Object.keys(hd).reduce((a, k) => a + (hd[k] || 0), 0) || 1;
  const score = healthScore(hd);
  const tone = scoreTone(score);
  const trend = trendQuery.data?.trend ?? [];
  const maxTotal = Math.max(...trend.map((t) => t.total), 1);
  return (
    <SectionCard id="health-trend" title="Project health trend">
      <div className="grid grid-cols-1 gap-[24px] md:grid-cols-3">
        <div>
          <div className="mb-[12px] flex items-center justify-between gap-[8px]">
            <span className="text-ds-label text-ds-fg-muted">Health score</span>
            <span className="inline-flex items-center gap-[8px]">
              <span className="text-[24px] font-[600] leading-[32px] tabular-nums text-ds-fg">{score}%</span>
              <StatusPill size="sm" tone={tone} label={projectHealth.label(SCORE_WORD[tone])} />
            </span>
          </div>
          <div role="img" aria-label={HEALTH_WORDS.map((w) => `${projectHealth.label(w)} ${formatCount(hd[w] || 0)}`).join(', ')} className="flex h-[12px] overflow-hidden rounded-full bg-ds-border">
            {HEALTH_WORDS.map((w) => (hd[w] ? <div key={w} className="h-full" style={{ width: `${(hd[w] / total) * 100}%`, background: TONE[projectHealth.tone(w)].dot }} /> : null))}
          </div>
          <div className="mt-[12px] grid grid-cols-3 gap-[8px]">
            {HEALTH_WORDS.map((w) => {
              const c = TONE[projectHealth.tone(w)];
              return (
                <div key={w} className="rounded-ds-card px-[8px] py-[8px] text-center" style={{ background: c.tint }}>
                  <p className="text-[20px] font-[600] leading-[24px] tabular-nums" style={{ color: c.text }}>{formatCount(hd[w] || 0)}</p>
                  <p className="text-ds-label text-ds-fg-muted">{projectHealth.label(w)}</p>
                </div>
              );
            })}
          </div>
        </div>
        <div className="md:col-span-2">
          <p className="mb-[8px] text-ds-label text-ds-fg-muted">Health score over time{trend.length > 1 ? ` (${formatCount(trend.length)} snapshots)` : ''}</p>
          {trendQuery.isError && !trendQuery.data ? (
            <QueryError title="Couldn't load the health trend" error={trendQuery.error} onRetry={() => { void trendQuery.refetch(); }} />
          ) : trend.length <= 1 ? (
            <div className="grid h-[128px] place-items-center rounded-ds-card bg-ds-surface-subtle px-[16px] text-center text-ds-label text-ds-fg-muted">Health trend data will populate as daily snapshots are captured</div>
          ) : (
            <div>
              <div role="img" aria-label={trendSummary(trend)} className="flex h-[128px] items-end gap-[1px]">
                {trend.map((p, i) => (
                  <div key={i} className="flex h-full min-w-0 flex-1 flex-col justify-end" title={`${formatDate(p.date, { calendar: true })}: ${p.health_score}%`}>
                    <div className="rounded-t-[2px]" style={{ height: `${(p.on_track / maxTotal) * 100}%`, minHeight: p.on_track ? '2px' : 0, background: TONE.success.dot }} />
                    <div style={{ height: `${(p.at_risk / maxTotal) * 100}%`, minHeight: p.at_risk ? '2px' : 0, background: TONE.warning.dot }} />
                    <div className="rounded-b-[2px]" style={{ height: `${(p.off_track / maxTotal) * 100}%`, minHeight: p.off_track ? '2px' : 0, background: TONE.danger.dot }} />
                  </div>
                ))}
              </div>
              <div className="mt-[4px] flex justify-between text-ds-label tabular-nums text-ds-fg-muted">
                <span>{formatDate(trend[0].date, { calendar: true })}</span>
                <span>{formatDate(trend[trend.length - 1].date, { calendar: true })}</span>
              </div>
            </div>
          )}
          <Legend items={HEALTH_WORDS.map((w) => ({ label: projectHealth.label(w), tone: projectHealth.tone(w) }))} />
        </div>
      </div>
    </SectionCard>
  );
}

function Analytics({ enhanced, trendQuery }: { enhanced: Enhanced; trendQuery: Parameters<typeof TrendCard>[0]['trendQuery'] }) {
  const burn = burnRows(enhanced.budget_overview);
  const { members, columns } = heatmapOf(enhanced.team_utilization);
  const matrix = alignmentOf(enhanced.framework_alignment);
  return (
    <>
      <TrendCard enhanced={enhanced} trendQuery={trendQuery} />
      <div className="grid grid-cols-1 gap-[16px] md:grid-cols-2 xl:grid-cols-3">
        <SectionCard id="burn" title="Budget burn rate" info="The share of each project's estimate that has been spent: the first 8 projects.">
          {burn.length === 0 ? (
            <EmptyState kind="firstUse" bare title="No budget data" className="!py-[24px]" />
          ) : (
            <ul className="flex flex-col gap-[4px]">
              {burn.map((b) => (
                <li key={b.project_id}>
                  <Link href={`/is-projects/${b.project_id}`} className={`${ROW_LINK} flex-col !items-stretch !gap-[4px]`}>
                    <span className="flex items-center justify-between gap-[8px] text-ds-body">
                      <span className="min-w-0 truncate text-ds-fg" title={b.project_name}>{b.project_name}</span>
                      {b.budget_estimated > 0
                        ? <span className="shrink-0 font-[600] tabular-nums" style={{ color: TONE[burnTone(b.burn_rate_pct)].text }}>{formatPercent(b.burn_rate_pct)}</span>
                        : <span className="shrink-0 text-ds-label text-ds-fg-muted">No estimate</span>}
                    </span>
                    <span aria-hidden className={BAR}><Fill pct={b.budget_estimated > 0 ? b.burn_rate_pct : 0} tone={burnTone(b.burn_rate_pct)} /></span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <SectionCard id="heatmap" title="Resource utilization" info="Each member's projects and role (the letter), and a load of 25 points per project, up to 100: the first 10 members and 6 projects.">
          {members.length === 0 ? (
            <EmptyState kind="firstUse" bare icon={Users} title="No team data" className="!py-[24px]" />
          ) : (
            <>
              <TableFrame aria-label="Resource utilization by member and project">
                <Table caption="Each member's role on each project, and their load">
                  <THead>
                    <Tr>
                      <Th>Member</Th>
                      {columns.map((c) => <Th key={c} align="center"><span className="block max-w-[72px] truncate" title={c}>{c}</span></Th>)}
                      <Th align="center">Load</Th>
                    </Tr>
                  </THead>
                  <TBody>
                    {members.map((m) => {
                      const load = loadPercent(m.total_projects);
                      const tone = loadTone(load);
                      return (
                        <Tr key={m.name}>
                          <Td><span className="block max-w-[120px] truncate font-[500] text-ds-fg" title={m.name}>{m.name}</span></Td>
                          {columns.map((c) => {
                            const a = m.projects.find((p) => p.project_name === c);
                            return <Td key={c} align="center">{a ? <Cell tone={tone} letter={a.role.charAt(0)} label={`${m.name}: ${a.role} on ${c}`} /> : <span className="text-ds-fg-muted" aria-label="Not on this project">—</span>}</Td>;
                          })}
                          <Td align="center">
                            <span className="inline-flex items-center gap-[6px]">
                              <span aria-hidden className={`block w-[48px] ${BAR}`}><Fill pct={load} tone={tone} /></span>
                              <span className="text-ds-label tabular-nums text-ds-fg-body">{load}%</span>
                            </span>
                          </Td>
                        </Tr>
                      );
                    })}
                  </TBody>
                </Table>
              </TableFrame>
              <Legend items={LOAD_LEGEND} />
            </>
          )}
        </SectionCard>

        <SectionCard id="alignment" title="Regulatory alignment" info="The frameworks each project is linked to, and the project's status: the first 8 projects.">
          {matrix.frameworks.length === 0 ? (
            <EmptyState kind="firstUse" bare icon={Shield} title="No framework data" className="!py-[24px]" />
          ) : (
            <>
              <TableFrame aria-label="Regulatory alignment by project and framework">
                <Table caption="Each project's status against each linked framework">
                  <THead>
                    <Tr>
                      <Th>Project</Th>
                      {matrix.frameworks.map((f) => <Th key={f} align="center"><span className="block max-w-[72px] truncate" title={f}>{f}</span></Th>)}
                    </Tr>
                  </THead>
                  <TBody>
                    {matrix.rows.map((r) => (
                      <Tr key={r.id}>
                        <Td><Link href={`/is-projects/${r.id}`} className="block max-w-[120px] truncate rounded-ds-control py-[2px] font-[500] text-ds-fg hover:underline focus-visible:outline-none focus-visible:shadow-ds-ring" title={r.name}>{r.name}</Link></Td>
                        {matrix.frameworks.map((f) => (
                          <Td key={f} align="center">
                            {r.cells[f] ? <Cell tone={frameworkTone(r.cells[f])} letter={r.cells[f].charAt(0).toUpperCase()} label={`${f}: ${r.cells[f]}`} /> : <span className="text-ds-fg-muted" aria-label={`Not linked to ${f}`}>—</span>}
                          </Td>
                        ))}
                      </Tr>
                    ))}
                  </TBody>
                </Table>
              </TableFrame>
              <Legend items={FRAMEWORK_LEGEND} />
            </>
          )}
        </SectionCard>
      </div>
    </>
  );
}

function SectionError({ title, error, onRetry }: { title: string; error: unknown; onRetry: () => void }) {
  return <ErrorState title={title} message={errorMessage(error)} onRetry={canRetry(error) ? onRetry : undefined} />;
}

export function PortfolioOverview() {
  const dash = useQuery({ queryKey: ['is-projects-dashboard'], queryFn: async () => (await isProjectsApi.getDashboard()).data as Dashboard, retry: retryRead });
  const enhanced = useQuery({ queryKey: ['is-projects-enhanced-analytics'], queryFn: async () => (await isProjectsApi.getEnhancedAnalytics()).data as Enhanced, retry: retryRead });
  const trend = useQuery({ queryKey: ['is-projects-health-trend'], queryFn: async () => (await isProjectsApi.getHealthTrend()).data as { trend?: TrendPoint[] }, retry: retryRead });

  return (
    <div className="flex flex-col gap-[16px]">
      {dash.isLoading ? <SummarySkeleton /> : dash.isError || !dash.data ? (
        <SectionError title="Couldn't load the overview" error={dash.error} onRetry={() => { void dash.refetch(); }} />
      ) : <Summary data={dash.data} />}

      {enhanced.isLoading ? (
        <div role="status" aria-busy="true" className="flex flex-col gap-[16px]"><span className="sr-only">Loading the analytics</span><Skeleton className="h-[220px] w-full" /><div className="grid grid-cols-1 gap-[16px] md:grid-cols-2 xl:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-[220px] w-full" />)}</div></div>
      ) : enhanced.isError || !enhanced.data ? (
        <SectionError title="Couldn't load the project analytics" error={enhanced.error} onRetry={() => { void enhanced.refetch(); void trend.refetch(); }} />
      ) : <Analytics enhanced={enhanced.data} trendQuery={trend} />}
    </div>
  );
}

