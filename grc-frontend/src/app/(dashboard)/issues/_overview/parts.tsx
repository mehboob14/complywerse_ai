'use client';

/**
 * The parts of the Issue & Incident Overview the page hands to the cockpit frame (components/overview): "My work" (the person's own prioritised work, one button a row, grouped Overdue /
 * This week / To do), the score card (the module score the server computed, as a ring, its three sections, the target it was scored against) and the Module score sheet (the math, the
 * weights for the people who could always adjust them). The charts are visuals.tsx. Each part loads, fails and has nothing on its own: a failed request is said where its numbers would be,
 * never read as a score or a count of 0.
 */
import { useState, type ReactNode } from 'react';
import { CheckCircle2, RotateCw, SlidersHorizontal } from 'lucide-react';
import { Button, ErrorState, Notice, ProgressBar, SectionCard, Sheet, SkeletonRows, StatusPill, WorkRow } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { ScoreRing } from '@/components/overview/charts';
import { SectionDetailModal, type OverviewSection } from '@/components/dashboard/score-kit';
import { SectionWeightTuner } from '@/components/dashboard/score-tuning';
import { SCORECARD_QUERY_KEYS } from '@/components/dashboard/scorecard-query-keys';
import { EMPTY, formatCount } from '@/lib/format';
import { statusPill } from '@/lib/status';
import { gradeStatus } from '@/lib/statuses/dashboard';
import { URGENCY_LABEL, WORK_KIND, actLabel, groupWork, type Grade, type Posture, type SectionRow, type WorkAct, type WorkItem } from './overviewModel';

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

/** The ring's colour is the server's grade (excellent and good green, fair amber, poor red); with none it is the neutral blue. */
const RING_TONE: Record<Grade | 'none', 'good' | 'warn' | 'bad' | 'progress'> = { excellent: 'good', good: 'good', fair: 'warn', poor: 'bad', none: 'progress' };

export function ScoreCard({ id, feed, posture, sections, onOpen }: ScoreCardProps) {
  return (
    <SectionCard id={id} title="Issue and incident score" info="The weighted mean of three sections (issues, incidents and corrective actions), worked out by the server from the whole register. The target is the one your organisation scores against.">
      <FeedBody feed={feed} what="the score" rows={3}>
        {posture.score === null && sections.length === 0 ? (
          <p className="m-0 text-ds-body text-ds-fg-muted">No score yet. It appears once there are issues, incidents or corrective actions to score.</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-x-[16px] gap-y-[8px]">
              <ScoreRing
                value={posture.score} target={posture.target} tone={RING_TONE[posture.grade ?? 'none']} caption="Issue and incident score" size={116}
                below={(
                  <div className="flex flex-wrap items-center justify-center gap-[6px]">
                    {posture.grade && <StatusPill {...statusPill(gradeStatus, posture.grade)} />}
                    {posture.target !== null && posture.score !== null && <span className="text-ds-label text-ds-fg-muted">{`Target ${posture.target}`}</span>}
                    {posture.customized && <span className="text-ds-label text-ds-fg-muted">· Weights adjusted</span>}
                  </div>
                )}
              />
              <Button leftIcon={<SlidersHorizontal aria-hidden />} onClick={onOpen}>How is it scored?</Button>
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

export { FeedBody };
