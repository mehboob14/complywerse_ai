'use client';

/**
 * The parts of the Issue & Incident Overview the page hands to the cockpit frame (components/overview): "My work" (the person's own prioritised work, one button a row, grouped Overdue /
 * This week / To do), the score card (the module score the server computed, its three sections, the target it was scored against), the Module score sheet (the math, the weights for the
 * people who could always adjust them) and the breakdowns of the whole register. Each part loads, fails and has nothing on its own: a failed request is said where its numbers would be,
 * never read as a score or a count of 0. Every row of every breakdown opens the register filtered to what it counts.
 */
import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import { CheckCircle2, RotateCw, SlidersHorizontal } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import {
  Button, ChartFrame, CountRow, ErrorState, Notice, ProgressBar, RowHeaderCell, SectionCard, Sheet, SkeletonRows, StatusPill, TBody, Table, TableFrame, Td, Th, THead, Tr, WorkRow,
} from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { SectionDetailModal, type OverviewSection } from '@/components/dashboard/score-kit';
import { SectionWeightTuner } from '@/components/dashboard/score-tuning';
import { SCORECARD_QUERY_KEYS } from '@/components/dashboard/scorecard-query-keys';
import { EMPTY, formatCount } from '@/lib/format';
import { statusPill } from '@/lib/status';
import { gradeStatus } from '@/lib/statuses/dashboard';
import { useClosing } from './data';
import {
  AGE_BUCKETS, URGENCY_LABEL, WORK_KIND, actLabel, closingRows, groupWork, reopenLine, type AgeMatrix, type Posture, type SectionRow, type Slice, type TrendWeek, type WorkAct, type WorkItem,
} from './overviewModel';

/** What a part needs to know about a request: waiting, failed (with no data to show), the words of the failure and how to ask again. */
export interface FeedStatus { isPending: boolean; isError: boolean; hasData: boolean; error: unknown; refetch: () => unknown }
const retryOf = (f: FeedStatus) => (canRetry(f.error) ? () => { void f.refetch(); } : undefined);

/** A card's body while its request is on the way or has failed; the content once there is some. */
function FeedBody({ feed, what, rows = 4, children }: { feed: FeedStatus; what: string; rows?: number; children: ReactNode }) {
  if (!feed.hasData && feed.isPending) return <SkeletonRows rows={rows} columns={2} label={`Loading ${what}`} />;
  if (!feed.hasData && feed.isError) return <ErrorState compact title={`Couldn't load ${what}`} message={errorMessage(feed.error)} onRetry={retryOf(feed)} />;
  return <>{children}</>;
}

// ── My work ──────────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface WorkCardProps {
  id: string;
  items: WorkItem[];
  now: Date;
  /** the lists that feed it, each with its own state */
  sources: Array<{ label: string; feed: FeedStatus }>;
  limit: number;
  run: (act: WorkAct) => void;
  busy: (key: string) => boolean;
}

export function WorkCard({ id, items, now, sources, limit, run, busy }: WorkCardProps) {
  const [shown, setShown] = useState(limit);
  const failed = sources.filter((s) => s.feed.isError && !s.feed.hasData);
  const loading = sources.some((s) => !s.feed.hasData && s.feed.isPending);
  const overdue = items.filter((i) => i.overdue).length;
  const groups = groupWork(items, now, shown);
  return (
    <SectionCard
      id={id}
      title="My work"
      info="What waits for you: issues assigned to you, issues waiting for a closure approval (if you can edit issues), your corrective actions and your incidents. Most urgent first. The button on a row takes the next step."
      meta={(loading || failed.length > 0) && items.length === 0 ? undefined : <>{`${formatCount(items.length)} ${items.length === 1 ? 'item' : 'items'}`}{overdue > 0 && <> · <span className="font-[600] text-ds-danger">{`${formatCount(overdue)} overdue`}</span></>}</>}
    >
      {failed.map((s) => (
        <Notice key={s.label} tone="warning" title={`${s.label} could not be loaded`} className="mb-[8px]"
          action={canRetry(s.feed.error) ? <Button leftIcon={<RotateCw aria-hidden />} onClick={() => { void s.feed.refetch(); }}>Retry</Button> : undefined}>
          {errorMessage(s.feed.error)} What it holds is not in this list.
        </Notice>
      ))}
      {loading && items.length === 0 && <SkeletonRows rows={Math.min(limit, 5)} columns={3} label="Loading your work" />}
      {!loading && failed.length === 0 && items.length === 0 && (
        <p className="flex items-center gap-[8px] px-[4px] py-[8px] text-ds-body text-ds-fg-muted">
          <CheckCircle2 aria-hidden className="h-[16px] w-[16px] shrink-0 text-ds-success" strokeWidth={1.75} />
          You&apos;re all caught up. Issues, actions and incidents assigned to you appear here.
        </p>
      )}
      {groups.map((g) => (
        <section key={g.group} aria-label={URGENCY_LABEL[g.group]}>
          <h3 className="m-0 px-[8px] pb-[2px] pt-[8px] !text-ds-label !font-[600] !text-ds-fg-muted">{URGENCY_LABEL[g.group]}</h3>
          <ul className="m-0 list-none p-0">
            {g.items.map((it) => (
              <WorkRow
                key={it.key}
                kind={WORK_KIND[it.kind]}
                title={it.title}
                href={it.href}
                context={it.context}
                due={it.due ?? undefined}
                calendar={it.calendar}
                overdue={it.due ? it.overdue : undefined}
                action={it.act.type === 'link'
                  ? { label: it.act.label, href: it.act.href }
                  : { label: actLabel(it.act), onClick: () => run(it.act), loading: busy(it.key), variant: 'primary' }}
              />
            ))}
          </ul>
        </section>
      ))}
      {items.length > shown && (
        <div className="mt-[4px] flex flex-wrap items-center justify-between gap-[8px] border-t border-ds-border px-[8px] pt-[8px] text-ds-label text-ds-fg-muted">
          <span role="status">{`Showing ${formatCount(shown)} of ${formatCount(items.length)}`}</span>
          <Button variant="link" size="sm" onClick={() => setShown((n) => n + 25)}>Show more</Button>
        </div>
      )}
    </SectionCard>
  );
}

// ── the score ────────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface ScoreCardProps {
  id: string;
  feed: FeedStatus;
  posture: Posture;
  sections: SectionRow[];
  onOpen: () => void;
}

export function ScoreCard({ id, feed, posture, sections, onOpen }: ScoreCardProps) {
  return (
    <SectionCard id={id} title="Issue and incident score" info="The weighted mean of three sections (issues, incidents and corrective actions), worked out by the server from the whole register. The target is the one your organisation scores against.">
      <FeedBody feed={feed} what="the score" rows={3}>
        {posture.score === null && sections.length === 0 ? (
          <p className="m-0 text-ds-body text-ds-fg-muted">No score yet. It appears once there are issues, incidents or corrective actions to score.</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-x-[16px] gap-y-[8px]">
              <div>
                <div className="text-[32px] font-[600] leading-none tabular-nums text-ds-fg">{posture.score ?? EMPTY}<span className="ml-[4px] text-ds-body font-normal text-ds-fg-muted">{posture.score === null ? 'no score' : '/ 100'}</span></div>
                <div className="mt-[6px] flex flex-wrap items-center gap-[6px]">
                  {posture.grade && <StatusPill {...statusPill(gradeStatus, posture.grade)} />}
                  {posture.target !== null && posture.score !== null && <span className="text-ds-label text-ds-fg-muted">{`Target ${posture.target}`}</span>}
                  {posture.customized && <span className="text-ds-label text-ds-fg-muted">· Weights adjusted</span>}
                </div>
              </div>
              <Button className="ml-auto" leftIcon={<SlidersHorizontal aria-hidden />} onClick={onOpen}>How is it scored?</Button>
            </div>
            <ul className="m-0 mt-[12px] list-none border-t border-ds-border p-0 pt-[4px]">
              {sections.map((s) => (
                <li key={s.key} className="flex min-h-ds-control items-center gap-[8px] border-b border-ds-border py-[4px] last:border-b-0">
                  <span className="min-w-0 flex-1 truncate text-ds-body text-ds-fg-body" title={s.label}>{s.label}</span>
                  <ProgressBar className="w-[72px] shrink-0" value={s.score} label={`${s.label} score`} showValue={false} tone={s.grade === 'poor' ? 'danger' : s.grade === 'fair' ? 'warning' : 'success'} />
                  <span className="w-[3ch] shrink-0 text-right tabular-nums text-ds-body text-ds-fg">{s.score === null ? EMPTY : Math.round(s.score)}</span>
                  {s.grade ? <StatusPill size="sm" {...statusPill(gradeStatus, s.grade)} /> : <StatusPill size="sm" tone="neutral" label="No data" />}
                </li>
              ))}
            </ul>
          </>
        )}
      </FeedBody>
    </SectionCard>
  );
}

const TUNING = { configBase: '/issue-management/dashboard', invalidateKey: [...SCORECARD_QUERY_KEYS.issues] as unknown[] };

/** The three sections behind the score, each with its weight and the math one press away (the shared formulas dialog, with the per-metric weights); the section weights and the target are adjusted here. */
export function ScoreSheet({ open, onClose, sections, posture }: { open: boolean; onClose: () => void; sections: OverviewSection[]; posture: Posture }) {
  const [section, setSection] = useState<OverviewSection | null>(null);
  const [adjusting, setAdjusting] = useState(false);
  const close = () => { setAdjusting(false); onClose(); };
  return (
    <>
      <Sheet open={open} onClose={close} title="How the score is worked out" subtitle={posture.score === null ? 'No score yet' : `Score ${posture.score}${posture.grade ? ` · ${gradeStatus.label(posture.grade)}` : ''}`} width="md">
        {adjusting ? (
          <SectionWeightTuner sections={sections} configBase={TUNING.configBase} invalidateKey={TUNING.invalidateKey} onClose={() => setAdjusting(false)} />
        ) : (
          <>
            <p className="mb-[8px] mt-0 text-ds-body text-ds-fg-muted">The score is the weighted mean of the sections that have data. Press a section for its metrics and formulas.</p>
            <ul className="m-0 list-none p-0">
              {sections.map((s) => (
                <li key={s.key} className="flex min-h-ds-control items-center gap-[8px] border-b border-ds-border py-[4px] last:border-b-0">
                  <button type="button" onClick={() => setSection(s)} className="min-w-0 flex-1 rounded-ds-control text-left hover:underline focus-visible:outline-none focus-visible:shadow-ds-ring">
                    <span className="block truncate text-ds-body font-[500] text-ds-fg" title={s.label}>{s.label}</span>
                    <span className="text-ds-label text-ds-fg-muted">{Math.round(s.weight * 100)}% of the score</span>
                  </button>
                  <span className="tabular-nums text-ds-body text-ds-fg">{s.score === null ? EMPTY : Math.round(s.score)}</span>
                </li>
              ))}
            </ul>
            <div className="mt-[12px]"><Button leftIcon={<SlidersHorizontal aria-hidden />} onClick={() => setAdjusting(true)}>Adjust section weights</Button></div>
          </>
        )}
      </Sheet>
      <SectionDetailModal section={section} onClose={() => setSection(null)} tuning={TUNING} />
    </>
  );
}

// ── the breakdowns ───────────────────────────────────────────────────────────────────────────────────────────────────────

export function SliceList({ slices, empty, more }: { slices: Slice[]; empty: string; more: string }) {
  if (slices.length === 0) return <p className="m-0 text-ds-body text-ds-fg-muted">{empty}</p>;
  return (
    <ul className="m-0 list-none p-0">
      {slices.slice(0, 8).map((s) => (
        <CountRow key={s.key} label={`${s.label}${s.critical + s.high > 0 ? ` · ${s.critical} critical, ${s.high} high` : ''}`} count={s.total} href={s.href} tone={s.tone} />
      ))}
      {slices.length > 8 && <li className="px-[8px] pt-[4px] text-ds-label text-ds-fg-muted">{`${slices.length - 8} more in ${more}`}</li>}
    </ul>
  );
}

const GRID = '#e1e6eb';          // --ds-border
const INK = '#586472';           // --ds-fg-muted
const BRAND = '#0f766e';         // --ds-primary
const TIP = { fontSize: 12, border: '1px solid #e1e6eb', borderRadius: 8, boxShadow: '0 8px 24px rgba(15, 23, 42, 0.14)', color: '#1f2933' };

export function TrendChart({ weeks }: { weeks: TrendWeek[] }) {
  const opened = weeks.reduce((a, w) => a + w.opened, 0);
  const closed = weeks.reduce((a, w) => a + w.closed, 0);
  if (opened + closed === 0) return <p className="m-0 text-ds-body text-ds-fg-muted">Nothing was raised or closed in the last 12 weeks.</p>;
  return (
    <ChartFrame
      title="Issues raised and closed, by week"
      note={`Weeks start on Monday. ${formatCount(opened)} raised and ${formatCount(closed)} closed in 12 weeks.`}
      height={200}
      data={{ columns: ['Week of', 'Raised', 'Closed'], rows: weeks.map((w) => [w.label, w.opened, w.closed]) }}
    >
      {(focusOff) => (
        <ResponsiveContainer width="100%" height="100%" minHeight={160}>
          <BarChart data={weeks.map((w) => ({ label: w.label, Raised: w.opened, Closed: w.closed }))} margin={{ top: 8, right: 8, left: -18, bottom: 0 }} barGap={2} {...focusOff}>
            <CartesianGrid strokeDasharray="2 2" stroke={GRID} vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 12, fill: INK }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
            <YAxis tick={{ fontSize: 12, fill: INK }} axisLine={false} tickLine={false} allowDecimals={false} />
            <Tooltip contentStyle={TIP} cursor={{ fill: 'rgba(88, 100, 114, 0.08)' }} />
            <Bar dataKey="Raised" fill={INK} radius={[2, 2, 0, 0]} isAnimationActive={false} />
            <Bar dataKey="Closed" fill={BRAND} radius={[2, 2, 0, 0]} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </ChartFrame>
  );
}

const AGE_SHORT = ['0–7 d', '8–30 d', '31–90 d', '90+ d'] as const;
const LINK = 'rounded-ds-control text-ds-fg underline-offset-2 hover:underline focus-visible:outline-none focus-visible:shadow-ds-ring';

export function AgeTable({ matrix }: { matrix: AgeMatrix }) {
  if (matrix.total === 0) return <p className="m-0 text-ds-body text-ds-fg-muted">No open issues.</p>;
  return (
    <TableFrame aria-label="Open issues by severity and age">
      <Table caption={`Open issues by severity and how long ago they were raised: ${AGE_BUCKETS.join(', ')}`}>
        <THead>
          <Tr>
            <Th>Severity</Th>
            {AGE_SHORT.map((l, i) => <Th key={l} align="right"><span title={AGE_BUCKETS[i]}>{l}</span></Th>)}
            <Th align="right">Total</Th>
          </Tr>
        </THead>
        <TBody>
          {matrix.rows.map((r) => (
            <Tr key={r.severity}>
              <RowHeaderCell><Link href={`/issues/register?quick=open&severity=${r.severity}`} className={LINK}>{r.label}</Link></RowHeaderCell>
              {r.cells.map((c, i) => (
                <Td key={i} align="right" className={`tabular-nums ${c > 0 && i === 3 && (r.severity === 'critical' || r.severity === 'high') ? '!font-[600] !text-ds-danger' : ''}`}>{formatCount(c)}</Td>
              ))}
              <Td align="right" className="tabular-nums !font-[600]">{formatCount(r.total)}</Td>
            </Tr>
          ))}
        </TBody>
      </Table>
    </TableFrame>
  );
}

/** "How well issues close": from the server's aggregate, asked for only while this card is on screen. */
export function ClosingCard() {
  const q = useClosing();
  const feed: FeedStatus = { isPending: q.isPending, isError: q.isError, hasData: !!q.data, error: q.error, refetch: q.refetch };
  const rows = closingRows(q.data);
  const reopen = reopenLine(q.data?.reopen_stats);
  return (
    <FeedBody feed={feed} what="how issues close">
      {rows.length === 0 ? (
        <p className="m-0 text-ds-body text-ds-fg-muted">No issue has been closed yet.</p>
      ) : (
        <>
          <TableFrame aria-label="How well issues close, by severity">
            <Table caption="Issues closed in the last 90 days, the average days they took, and the share closed by their target date">
              <THead>
                <Tr><Th>Severity</Th><Th align="right">Closed in 90 days</Th><Th align="right">Average days to close</Th><Th align="right">Closed by the target date</Th></Tr>
              </THead>
              <TBody>
                {rows.map((r) => (
                  <Tr key={r.severity}>
                    <RowHeaderCell>{r.label}</RowHeaderCell>
                    <Td align="right" className="tabular-nums">{formatCount(r.closed)}</Td>
                    <Td align="right" className="tabular-nums">{r.meanDays === null ? EMPTY : r.meanDays}</Td>
                    <Td align="right" className="tabular-nums">{r.onTimePct === null ? EMPTY : `${r.onTimePct}% of ${formatCount(r.onTimeOf)}`}</Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          </TableFrame>
          <p className="m-0 mt-[8px] text-ds-label text-ds-fg-muted">{[reopen ? `${reopen}.` : null, 'Only issues closed with a closing date are counted.'].filter(Boolean).join(' ')}</p>
        </>
      )}
    </FeedBody>
  );
}

export { FeedBody };
