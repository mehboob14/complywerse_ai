'use client';

/**
 * The parts of the Risk Management Overview the page hands to the cockpit frame (components/overview): "My work" (the person's own prioritised work, one action a row, grouped Overdue /
 * This week / To do), the posture card (the module score the server computed, the register's residual matrix with every cell a link, the weakest sections), the breakdowns of the whole
 * register, and the Module health sheet (the ten sections and the math behind them, the weights for the people who could always adjust them). Each part loads, fails and has nothing on
 * its own: a failed request is said where its numbers would be, never read as a score of 0.
 */
import { useState } from 'react';
import Link from 'next/link';
import { CheckCircle2, RotateCw, SlidersHorizontal } from 'lucide-react';
import {
  Button, CountRow, ErrorState, Notice, SectionCard, Sheet, SkeletonRows, StatusPill, TitleLink, WorkRow,
} from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { SectionDetailModal, type OverviewSection } from '@/components/dashboard/score-kit';
import { SectionWeightTuner } from '@/components/dashboard/score-tuning';
import { SCORECARD_QUERY_KEYS } from '@/components/dashboard/scorecard-query-keys';
import { formatCount } from '@/lib/format';
import { TONE } from '@/lib/status';
import { riskLevel } from '@/lib/statuses/risk';
import { LevelCell } from '../risks/_register/RiskRows';
import { cellBand, type RiskRow } from '../risks/_register/riskModel';
import { matrixRows, placedCount } from '../risks/_register/riskInsights';
import {
  GRADE_LABEL, GRADE_TONE, URGENCY_LABEL, WORK_KIND, groupWork, sectionBand, weakest, type Grade, type SectionRow, type Slice, type WorkItem,
} from './overviewModel';

export interface Feed { isPending: boolean; isError: boolean; error: unknown; refetch: () => unknown }
export const feedOf = (q: Feed): Feed => q;

// ── My work ──────────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface WorkCardProps {
  id: string;
  items: WorkItem[];
  now: Date;
  /** the sources that feed it, each with its own state */
  sources: Array<{ label: string; feed: Feed }>;
  limit: number;
}

export function WorkCard({ id, items, now, sources, limit }: WorkCardProps) {
  const [shown, setShown] = useState(limit);
  const failed = sources.filter((s) => s.feed.isError);
  const loading = sources.some((s) => s.feed.isPending);
  const overdue = items.filter((i) => i.overdue).length;
  const groups = groupWork(items, now, shown);
  return (
    <SectionCard
      id={id}
      title="My work"
      info="What waits for you: risks you hold that need scoring or treating, reviews you carry out, mitigation actions you own that are overdue, indicators to report and incidents assigned to you. Most urgent first."
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
        <p className="flex items-center gap-[8px] px-[4px] py-[8px] text-ds-body text-ds-fg-muted">
          <CheckCircle2 aria-hidden className="h-[16px] w-[16px] shrink-0 text-ds-success" strokeWidth={1.75} />
          You&apos;re all caught up. Risks, reviews and actions that need you appear here.
        </p>
      )}
      {groups.map((g) => (
        <section key={g.group} aria-label={URGENCY_LABEL[g.group]}>
          <h3 className="m-0 px-[8px] pb-[2px] pt-[8px] !text-ds-label !font-[600] !text-ds-fg-muted">{URGENCY_LABEL[g.group]}</h3>
          <ul className="m-0 list-none p-0">
            {g.items.map((it) => (
              <WorkRow key={it.key} kind={WORK_KIND[it.kind]} title={it.title} href={it.href} context={it.context} due={it.due ?? undefined} overdue={it.due ? it.overdue : undefined} action={{ label: it.action.label, href: it.action.href }} />
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

// ── Posture ──────────────────────────────────────────────────────────────────────────────────────────────────────────────

const BAND_TONE = { critical: 'danger', high: 'warning', medium: 'progress', low: 'success', none: 'neutral' } as const;

export interface PostureCardProps {
  id: string;
  /** the server's answer for the module score and sections */
  sections: Feed;
  score: number | null;
  grade: Grade | null;
  target: number | null;
  rows: readonly RiskRow[];
  rowsFeed: Feed;
  weak: SectionRow[];
  onOpenSections: () => void;
}

function MiniMatrix({ rows }: { rows: readonly RiskRow[] }) {
  const cells = matrixRows(rows, 'residual');
  return (
    <div>
      <div role="grid" aria-label="Residual risk matrix: likelihood down, impact across" className="grid grid-cols-5 gap-[3px]">
        {cells.map((row) => row.map((c) => {
          const tone = TONE[BAND_TONE[cellBand(c.l, c.i)]];
          const label = `Likelihood ${c.l}, impact ${c.i}, ${riskLevel.label(cellBand(c.l, c.i)).toLowerCase()}: ${formatCount(c.count)} ${c.count === 1 ? 'risk' : 'risks'}`;
          return c.count > 0 ? (
            <Link key={`${c.l}-${c.i}`} role="gridcell" href={`/erm/risks?cell=${c.l}-${c.i}&basis=residual&view=list`} aria-label={label} title={label}
              style={{ background: tone.tint, borderColor: tone.border }} className="flex min-h-[40px] items-center justify-center rounded-ds-control border text-ds-body font-[600] tabular-nums text-ds-fg hover:brightness-95 focus-visible:outline-none focus-visible:shadow-ds-ring">
              {formatCount(c.count)}
            </Link>
          ) : <span key={`${c.l}-${c.i}`} role="gridcell" aria-label={label} className="flex min-h-[40px] items-center justify-center rounded-ds-control bg-ds-surface-subtle text-ds-label text-ds-fg-muted"><span aria-hidden>·</span></span>;
        }))}
      </div>
      <div aria-hidden className="mt-[2px] flex justify-between text-ds-label text-ds-fg-muted"><span>Impact 1</span><span>Likelihood 5 at the top</span><span>Impact 5</span></div>
    </div>
  );
}

export function PostureCard({ id, sections, score, grade, target, rows, rowsFeed, weak, onOpenSections }: PostureCardProps) {
  const placed = placedCount(matrixRows(rows, 'residual'));
  return (
    <SectionCard id={id} title="Risk posture" info="The module score is the weighted mean of its sections, worked out by the server. The matrix places each risk by its residual likelihood and impact; press a cell to see its risks.">
      {sections.isPending && <SkeletonRows rows={3} columns={2} label="Loading the module score" />}
      {sections.isError && !sections.isPending && <ErrorState compact title="Couldn't load the module score" message={errorMessage(sections.error)} onRetry={canRetry(sections.error) ? () => { void sections.refetch(); } : undefined} />}
      {!sections.isPending && !sections.isError && (
        <div className="flex flex-wrap items-center gap-x-[16px] gap-y-[8px]">
          <div>
            <div className="text-[32px] font-[600] leading-none tabular-nums text-ds-fg">{score ?? '—'}<span className="ml-[4px] text-ds-body font-normal text-ds-fg-muted">{score == null ? 'no data' : '/ 100'}</span></div>
            <div className="mt-[6px] flex flex-wrap items-center gap-[6px]">
              {grade && <StatusPill tone={GRADE_TONE[grade]} label={GRADE_LABEL[grade]} />}
              {target != null && score != null && <span className="text-ds-label text-ds-fg-muted">Target {target}</span>}
            </div>
          </div>
          <Button className="ml-auto" leftIcon={<SlidersHorizontal aria-hidden />} onClick={onOpenSections}>How is it scored?</Button>
        </div>
      )}
      {!sections.isPending && !sections.isError && weak.length > 0 && (
        <div className="mt-[12px] border-t border-ds-border pt-[8px]">
          <h3 className="m-0 !text-ds-label !font-[600] !text-ds-fg-muted">Weakest sections</h3>
          <ul className="m-0 list-none p-0">
            {weak.map((w) => {
              const b = sectionBand(w.score);
              return (
                <li key={w.key} className="flex min-h-ds-control items-center gap-[8px]">
                  <span className="min-w-0 flex-1 truncate text-ds-body text-ds-fg-body" title={w.label}>{w.label}</span>
                  <span className="tabular-nums text-ds-body text-ds-fg">{Math.round(w.score as number)}</span>
                  <StatusPill size="sm" tone={b.tone} label={b.word} />
                </li>
              );
            })}
          </ul>
        </div>
      )}
      <div className="mt-[12px] border-t border-ds-border pt-[8px]">
        <h3 className="m-0 mb-[6px] !text-ds-label !font-[600] !text-ds-fg-muted">Residual matrix{!rowsFeed.isPending && !rowsFeed.isError ? ` · ${formatCount(placed)} placed` : ''}</h3>
        {rowsFeed.isPending && <SkeletonRows rows={3} columns={5} label="Loading the matrix" />}
        {rowsFeed.isError && !rowsFeed.isPending && <ErrorState compact title="Couldn't load the risks" message={errorMessage(rowsFeed.error)} onRetry={canRetry(rowsFeed.error) ? () => { void rowsFeed.refetch(); } : undefined} />}
        {!rowsFeed.isPending && !rowsFeed.isError && <MiniMatrix rows={rows} />}
      </div>
    </SectionCard>
  );
}

// ── Breakdowns ───────────────────────────────────────────────────────────────────────────────────────────────────────────

export function SliceList({ slices, empty }: { slices: Slice[]; empty: string }) {
  if (slices.length === 0) return <p className="m-0 text-ds-body text-ds-fg-muted">{empty}</p>;
  return (
    <ul className="m-0 list-none p-0">
      {slices.slice(0, 8).map((s) => (
        <CountRow key={s.key} label={`${s.label}${s.critical + s.high > 0 ? ` · ${s.critical} critical, ${s.high} high` : ''}`} count={s.total} href={s.href} tone={s.critical > 0 ? 'danger' : s.high > 0 ? 'warning' : 'neutral'} />
      ))}
      {slices.length > 8 && <li className="px-[8px] pt-[4px] text-ds-label text-ds-fg-muted">{`${slices.length - 8} more in the register's filters`}</li>}
    </ul>
  );
}

export function TopRisksList({ risks }: { risks: RiskRow[] }) {
  if (risks.length === 0) return <p className="m-0 text-ds-body text-ds-fg-muted">No scored risks yet.</p>;
  return (
    <ol className="m-0 list-none p-0">
      {risks.map((r) => (
        <li key={r.id} className="flex min-h-[44px] items-center gap-[8px] border-b border-ds-border py-[4px] last:border-b-0">
          <div className="min-w-0 flex-1"><TitleLink href={`/erm/risks/${r.id}`} title={r.title} lines={2} tone="title" size="body" /></div>
          <LevelCell row={r} />
        </li>
      ))}
    </ol>
  );
}

// ── Module health ────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface ModuleHealthProps {
  open: boolean;
  onClose: () => void;
  sections: Array<OverviewSection>;
  score: number | null;
  grade: Grade | null;
}

/** The ten sections behind the module score, each with its weight and the math one press away (the shared section dialog, with the per-metric weights for the people who could always set them). */
export function ModuleHealth({ open, onClose, sections, score, grade }: ModuleHealthProps) {
  const [section, setSection] = useState<OverviewSection | null>(null);
  const [adjusting, setAdjusting] = useState(false);
  const tuning = { configBase: '/erm/dashboard', invalidateKey: [...SCORECARD_QUERY_KEYS.erm] as unknown[] };
  const close = () => { setAdjusting(false); onClose(); };
  return (
    <>
      <Sheet open={open} onClose={close} title="Module health" subtitle={score == null ? 'No score yet' : `Score ${score}${grade ? ` · ${GRADE_LABEL[grade]}` : ''}`} width="md">
        {adjusting ? (
          <SectionWeightTuner sections={sections} configBase={tuning.configBase} invalidateKey={tuning.invalidateKey} onClose={() => setAdjusting(false)} />
        ) : (
          <>
            <p className="mt-0 text-ds-body text-ds-fg-muted">The score is the weighted mean of the sections that have data. Press a section for its metrics and formulas.</p>
            <ul className="m-0 list-none p-0">
              {sections.map((s) => {
                const b = sectionBand(s.score);
                return (
                  <li key={s.key} className="flex min-h-ds-control items-center gap-[8px] border-b border-ds-border py-[4px] last:border-b-0">
                    <button type="button" onClick={() => setSection(s)} className="min-w-0 flex-1 rounded-ds-control text-left hover:underline focus-visible:outline-none focus-visible:shadow-ds-ring">
                      <span className="block truncate text-ds-body font-[500] text-ds-fg" title={s.label}>{s.label}</span>
                      <span className="text-ds-label text-ds-fg-muted">{Math.round(s.weight * 100)}% of the score</span>
                    </button>
                    <span className="tabular-nums text-ds-body text-ds-fg">{s.score == null ? '—' : Math.round(s.score)}</span>
                    <StatusPill size="sm" tone={b.tone} label={b.word} />
                  </li>
                );
              })}
            </ul>
            <div className="mt-[12px]"><Button leftIcon={<SlidersHorizontal aria-hidden />} onClick={() => setAdjusting(true)}>Adjust section weights</Button></div>
          </>
        )}
      </Sheet>
      <SectionDetailModal section={section} onClose={() => setSection(null)} tuning={tuning} />
    </>
  );
}

