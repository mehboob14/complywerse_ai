'use client';

/**
 * Regulatory Changes > Overview, a worklist-first cockpit (the frame of components/overview, the same as the Governance and Risk Overviews): what needs attention across the module as a band of
 * counters (each opens the changes it counts), the person's own prioritised work beside one compact posture card, and the breakdowns of the whole register below (by regulator, what takes
 * effect, the changes that matter most). The numbers are the server's, counted over every change being worked on; each part loads, fails and has nothing on its own, and a request that
 * failed is said where its numbers would be: it never reads as 0.
 */
import { useMemo, useState } from 'react';
import { CheckCircle2, RotateCw } from 'lucide-react';
import { Cockpit, SkipToWork, type Breakdown } from '@/components/overview/Cockpit';
import { CounterBand, type BandCounter } from '@/components/overview/CounterBand';
import { layoutOf, workRowLimit } from '@/components/overview/cockpitModel';
import { useNarrow } from '@/components/overview/useNarrow';
import { Button, CountRow, ErrorState, Notice, ProgressBar, SectionCard, SkeletonRows, StatusPill, TitleLink, WorkRow } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { formatCount, formatDate } from '@/lib/format';
import { priority, statusPill } from '@/lib/status';
import { changeStatus } from '@/lib/statuses/regulatory';
import { useChanges, useMyWork, useOverview } from '../_lib/data';
import { dueWords, regulatorName } from '../_lib/regulatoryModel';
import type { ChangeRow } from '../_lib/types';
import {
  COUNTERS, MINE, URGENCY_LABEL, WORK_KIND, attentionTotal, buildWork, byRegulator, changeHref, complianceSlices, counterFrom, groupWork, metShare, stageSlices, takesEffect, topPriority,
} from './overviewModel';

interface Feed { isPending: boolean; isError: boolean; error: unknown; refetch: () => unknown }

function WorkCard({ items, today, sources, limit }: { items: ReturnType<typeof buildWork>; today: Date; sources: Array<{ label: string; feed: Feed }>; limit: number }) {
  const [shown, setShown] = useState(limit);
  const failed = sources.filter((s) => s.feed.isError);
  const loading = sources.some((s) => s.feed.isPending);
  const overdue = items.filter((i) => i.overdue).length;
  const groups = groupWork(items, today, shown);
  return (
    <SectionCard
      id="work"
      title="My work"
      info="What waits for you: tasks you are on, obligations you own that nobody has assessed, changes assigned to you, and new items in the feeds you watch. Most urgent first."
      meta={loading && items.length === 0 ? undefined : <>{`${formatCount(items.length)} ${items.length === 1 ? 'item' : 'items'}`}{overdue > 0 && <> · <span className="font-[600] text-ds-danger">{`${formatCount(overdue)} overdue`}</span></>}</>}
    >
      {failed.map((s) => (
        <Notice key={s.label} tone="warning" title={`${s.label} could not be loaded`} className="mb-[8px]"
          action={canRetry(s.feed.error) ? <Button leftIcon={<RotateCw aria-hidden />} onClick={() => { void s.feed.refetch(); }}>Retry</Button> : undefined}>
          {errorMessage(s.feed.error)} What it holds is not in this list.
        </Notice>
      ))}
      {loading && items.length === 0 && <SkeletonRows rows={Math.min(limit, 5)} columns={3} label="Loading your work" />}
      {!loading && failed.length === 0 && items.length === 0 && (
        <p className="m-0 flex items-center gap-[8px] px-[4px] py-[8px] text-ds-body text-ds-fg-muted">
          <CheckCircle2 aria-hidden className="h-[16px] w-[16px] shrink-0 text-ds-success" strokeWidth={1.75} />
          You&apos;re all caught up. Tasks, obligations and changes that need you appear here.
        </p>
      )}
      {groups.map((g) => (
        <section key={g.group} aria-label={URGENCY_LABEL[g.group]}>
          <h3 className="m-0 px-[8px] pb-[2px] pt-[8px] !text-ds-label !font-[600] !text-ds-fg-muted">{URGENCY_LABEL[g.group]}</h3>
          <ul className="m-0 list-none p-0">
            {g.items.map((it) => (
              <WorkRow key={it.key} kind={WORK_KIND[it.kind]} title={it.title} href={it.href} context={it.context} due={it.due ?? undefined} calendar overdue={it.due ? it.overdue : undefined} action={it.action} />
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

function PostureCard({ overview }: { overview: ReturnType<typeof useOverview> }) {
  const share = metShare(overview.data);
  const slices = complianceSlices(overview.data);
  const stages = stageSlices(overview.data);
  return (
    <SectionCard id="posture" title="Where it stands" info="Counted over every change that is identified, under assessment or in implementation: the obligations a confirmed control meets, how they stand against compliance, and how many changes are at each stage.">
      {overview.isPending && <SkeletonRows rows={3} columns={2} label="Loading the posture" />}
      {overview.isError && !overview.data && <ErrorState compact title="Couldn't load the posture" message={errorMessage(overview.error)} onRetry={canRetry(overview.error) ? () => { void overview.refetch(); } : undefined} />}
      {overview.data && (
        <>
          {share ? (
            <div>
              <p className="m-0 text-ds-body text-ds-fg"><span className="text-[24px] font-[600] tabular-nums leading-none">{formatCount(share.met)}</span><span className="text-ds-fg-muted">{` of ${formatCount(share.total)} obligations are met by a control`}</span></p>
              <ProgressBar className="mt-[6px]" value={share.pct} label="Obligations met by a control" valueText={`${share.pct}% met`} tone={share.pct >= 80 ? 'success' : share.pct >= 50 ? 'warning' : 'danger'} />
            </div>
          ) : <p className="m-0 text-ds-body text-ds-fg-muted">No obligations are being worked on yet.</p>}
          {slices.length > 0 && (
            <div className="mt-[12px] border-t border-ds-border pt-[8px]">
              <h3 className="m-0 !text-ds-label !font-[600] !text-ds-fg-muted">Compliance of those obligations</h3>
              <ul className="m-0 list-none p-0">{slices.map((s) => <CountRow key={s.key} label={s.label} count={s.count} tone={s.tone} href={s.href} />)}</ul>
            </div>
          )}
          <div className="mt-[12px] border-t border-ds-border pt-[8px]">
            <h3 className="m-0 !text-ds-label !font-[600] !text-ds-fg-muted">Changes by stage</h3>
            <ul className="m-0 list-none p-0">{stages.map((s) => <CountRow key={s.key} label={s.label} count={s.count} tone={s.tone} href={s.href} />)}</ul>
          </div>
        </>
      )}
    </SectionCard>
  );
}

function ChangeList({ rows, empty, note }: { rows: ChangeRow[]; empty: string; note: (c: ChangeRow) => string }) {
  if (rows.length === 0) return <p className="m-0 text-ds-body text-ds-fg-muted">{empty}</p>;
  return (
    <ol className="m-0 list-none p-0">
      {rows.map((c) => (
        <li key={c.id} className="flex min-h-[44px] items-center gap-[8px] border-b border-ds-border py-[4px] last:border-b-0">
          <div className="min-w-0 flex-1">
            <TitleLink href={changeHref(c.id)} title={c.title} lines={2} tone="title" size="body" />
            <span className="block text-ds-label text-ds-fg-muted">{regulatorName(c.source)} · {note(c)}</span>
          </div>
          <StatusPill size="sm" {...statusPill(changeStatus, c.status)} />
        </li>
      ))}
    </ol>
  );
}

export function RegulatoryOverview() {
  const narrow = useNarrow();
  const overview = useOverview();
  const work = useMyWork();
  const changes = useChanges();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const today = useMemo(() => new Date(), [work.data, overview.data]);
  const items = useMemo(() => buildWork(work.data, today), [work.data, today]);

  const payload = overview.data;
  const failedAll = overview.isError && !payload;
  const counters: BandCounter[] = COUNTERS.map((def) => {
    const c = counterFrom(payload ? def.pick(payload, work.data) : undefined, overview.isPending, failedAll);
    return { key: def.key, label: def.label, href: def.href, tone: def.tone, state: c.state, value: c.value, onRetry: c.state === 'error' && canRetry(overview.error) ? () => { void overview.refetch(); } : undefined };
  });
  const mine = counterFrom(work.data?.changes_total, work.isPending, work.isError && !work.data);
  const mineCounter: BandCounter = { ...MINE, state: mine.state, value: mine.value, onRetry: mine.state === 'error' ? () => { void work.refetch(); } : undefined };
  const total = attentionTotal(payload);

  const mode = layoutOf({ refused: false, workCount: work.isPending ? null : items.length });
  const limit = workRowLimit(mode, narrow);
  const rows = changes.rows;
  const regulators = byRegulator(rows);
  const soon = takesEffect(rows, today);
  const top = topPriority(rows);
  const rowsReady = !changes.isPending && !changes.isError;
  const rowsProblem = changes.isError && !changes.data
    ? <ErrorState compact title="Couldn't load the changes" message={errorMessage(changes.error)} onRetry={canRetry(changes.error) ? () => { void changes.refetch(); } : undefined} />
    : changes.isPending ? <SkeletonRows rows={3} columns={2} label="Loading the changes" /> : null;

  const breakdowns: Breakdown[] = [
    {
      id: 'by-regulator', title: 'By regulator', info: 'Changes in progress by regulator, the one with the most late tasks first. Each opens the register on that regulator.',
      meta: rowsReady ? `${formatCount(regulators.length)} ${regulators.length === 1 ? 'regulator' : 'regulators'}` : undefined,
      children: rowsProblem ?? (regulators.length === 0 ? <p className="m-0 text-ds-body text-ds-fg-muted">No changes in progress.</p> : (
        <ul className="m-0 list-none p-0">
          {regulators.slice(0, 8).map((r) => <CountRow key={r.key} label={`${r.label}${r.late > 0 ? ` · ${r.late} late` : ''}`} count={r.total} href={r.href} tone={r.late > 0 ? 'danger' : 'neutral'} />)}
        </ul>
      )),
    },
    {
      id: 'takes-effect', title: 'Takes effect', info: 'Changes in progress that have an effective date: the ones already in force first, then the next to take effect.',
      children: rowsProblem ?? <ChangeList rows={soon} empty="No change in progress has an effective date." note={(c) => { const d = dueWords(c.effective_date, today); return d ? (d.late ? `in force since ${formatDate(c.effective_date, { calendar: true })}` : `${formatDate(c.effective_date, { calendar: true })} (${d.text})`) : ''; }} />,
    },
    {
      id: 'top-priority', title: 'Highest priority', info: 'Critical and high priority changes in progress, critical first.',
      children: rowsProblem ?? <ChangeList rows={top} empty="No critical or high priority change is in progress." note={(c) => `${priority.label(c.priority)} priority`} />,
    },
  ];

  return (
    <>
      <SkipToWork />
      <Cockpit
        mode={mode}
        narrow={narrow}
        band={(
          <CounterBand
            id="attention"
            title="Needs attention"
            info="Each count opens the changes it counts, or the page that lists them. They are counted over every change that is identified, under assessment or in implementation."
            total={total != null ? `${formatCount(total)} in total` : undefined}
            counters={[mineCounter, ...counters]}
            narrow={narrow}
            failure={failedAll ? { title: "Couldn't load the counters", message: errorMessage(overview.error), onRetry: canRetry(overview.error) ? () => { void overview.refetch(); } : undefined } : undefined}
          />
        )}
        work={<WorkCard items={items} today={today} sources={[{ label: 'Your work', feed: work }]} limit={limit} />}
        posture={<PostureCard overview={overview} />}
        breakdowns={breakdowns}
      />
    </>
  );
}
