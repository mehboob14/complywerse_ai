'use client';

/**
 * The parts of the Compliance Overview the page hands to the cockpit frame (components/overview): the posture card (the score the server computed, the areas that pull it down, the
 * journeys in one line), "How is it scored?" (the six areas with their formulas one press away, the weights for the people who may set them), one row per framework journey, the
 * Coverage card and the Onboarding card. Each part loads, fails and has nothing on its own: a failed request is said where its numbers would be, never read as 0. Every figure of
 * a journey is lib/journeyModel.ts's (through overviewModel.ts).
 */
import { useState } from 'react';
import Link from 'next/link';
import { CheckCircle2, SlidersHorizontal } from 'lucide-react';
import { Button, CountRow, ErrorState, SectionCard, Sheet, SkeletonRows, StatusPill, TitleLink } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { SectionDetailModal, type OverviewSection } from '@/components/dashboard/score-kit';
import { SectionWeightTuner } from '@/components/dashboard/score-tuning';
import { SCORECARD_QUERY_KEYS } from '@/components/dashboard/scorecard-query-keys';
import { formatCount, formatDate } from '@/lib/format';
import { journeyStatus, readinessBandWords } from '@/lib/statuses/frameworkJourney';
import { areaBand } from '@/lib/statuses/complianceStatements';
import {
  GRADE_LABEL, GRADE_TONE, SECTION_HREF, areaWord, type CoverageRow, type Grade, type JourneyRow, type OnboardingView, type PortfolioLine, type SectionRow,
} from './overviewModel';

/** A request as a card sees it. */
export interface QueryView { isPending: boolean; isError: boolean; error: unknown; refetch: () => unknown }

const FOCUS = 'focus-visible:outline-none focus-visible:shadow-ds-ring';
const plural = (n: number, one: string, many: string) => `${formatCount(n)} ${n === 1 ? one : many}`;

function Failed({ title, q }: { title: string; q: QueryView }) {
  return <ErrorState compact title={title} message={errorMessage(q.error)} onRetry={canRetry(q.error) ? () => { void q.refetch(); } : undefined} />;
}

// ── posture ──────────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface PostureCardProps {
  id: string;
  scorecard: QueryView;
  score: number | null;
  grade: Grade | null;
  target: number | null;
  weak: SectionRow[];
  journeys: QueryView;
  portfolio: PortfolioLine;
  onOpenAreas: () => void;
}

export function PostureCard({ id, scorecard, score, grade, target, weak, journeys, portfolio, onOpenAreas }: PostureCardProps) {
  return (
    <SectionCard id={id} title="Compliance posture" info="The score is the weighted mean of six areas, worked out by the server. Ready is the share of requirements whose approved evidence reaches what they ask for; Implemented the share that are implemented; both leave out requirements put out of scope.">
      {scorecard.isPending && <SkeletonRows rows={3} columns={2} label="Loading the compliance score" />}
      {scorecard.isError && !scorecard.isPending && <Failed title="Couldn't load the compliance score" q={scorecard} />}
      {!scorecard.isPending && !scorecard.isError && (
        <>
          <div className="flex flex-wrap items-center gap-x-[16px] gap-y-[8px]">
            <div>
              <div className="text-[32px] font-[600] leading-none tabular-nums text-ds-fg">
                {score ?? '—'}<span className="ml-[4px] text-ds-body font-normal text-ds-fg-muted">{score == null ? 'no score yet' : '/ 100'}</span>
              </div>
              <div className="mt-[6px] flex flex-wrap items-center gap-[6px]">
                {grade && <StatusPill tone={GRADE_TONE[grade]} label={GRADE_LABEL[grade]} />}
                {target != null && score != null && <span className="text-ds-label text-ds-fg-muted">{`Target ${target}`}</span>}
              </div>
            </div>
            <Button className="ml-auto" leftIcon={<SlidersHorizontal aria-hidden />} aria-haspopup="dialog" onClick={onOpenAreas}>How is it scored?</Button>
          </div>
          {weak.length > 0 && (
            <div className="mt-[12px] border-t border-ds-border pt-[8px]">
              <h3 className="m-0 !text-ds-label !font-[600] !text-ds-fg-muted">Weakest areas</h3>
              <ul className="m-0 list-none p-0">
                {weak.map((w) => (
                  <li key={w.key} className="flex min-h-ds-control items-center gap-[8px]">
                    <TitleLink href={SECTION_HREF[w.key] ?? '/compliance'} title={w.label} lines={1} size="body" className="min-w-0 flex-1" />
                    <span className="tabular-nums text-ds-body text-ds-fg">{Math.round(w.score as number)}</span>
                    <StatusPill size="sm" tone={areaBand.tone(areaWord(w.score))} label={areaBand.label(areaWord(w.score))} />
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
      <div className="mt-[12px] border-t border-ds-border pt-[8px]">
        <h3 className="m-0 mb-[2px] !text-ds-label !font-[600] !text-ds-fg-muted">Framework journeys</h3>
        {journeys.isPending && <SkeletonRows rows={1} columns={2} label="Loading the framework journeys" />}
        {journeys.isError && !journeys.isPending && <Failed title="Couldn't load the framework journeys" q={journeys} />}
        {!journeys.isPending && !journeys.isError && (
          portfolio.journeys === 0 && portfolio.missing === 0 ? (
            <p className="m-0 text-ds-body text-ds-fg-muted">
              {portfolio.completed > 0 ? `${plural(portfolio.completed, 'journey is', 'journeys are')} finished and none is active.` : 'No framework journey has started yet.'}{' '}
              <Link href="/frameworks" className={`font-[500] text-ds-primary-text hover:underline ${FOCUS}`}>Start one</Link>
            </p>
          ) : (
            <p className="m-0 text-ds-body text-ds-fg-body">
              <span className="font-[600] text-ds-fg">{plural(portfolio.journeys, 'active journey', 'active journeys')}</span>
              {portfolio.journeys > 0 && <>{`: Ready ${portfolio.ready}%, Implemented ${portfolio.implemented}%`}</>}
              {portfolio.missing > 0 && <span className="text-ds-fg-muted">{` · ${plural(portfolio.missing, 'journey', 'journeys')} not counted (no progress sent)`}</span>}
            </p>
          )
        )}
      </div>
    </SectionCard>
  );
}

// ── how is it scored ─────────────────────────────────────────────────────────────────────────────────────────────────────

const TUNING = { configBase: '/compliance/policies/dashboard', invalidateKey: [...SCORECARD_QUERY_KEYS.compliance] as unknown[] };

export interface AreasSheetProps {
  open: boolean;
  onClose: () => void;
  sections: OverviewSection[];
  score: number | null;
  grade: Grade | null;
  /** administrators only: the server lets any signed-in person move the weights, the screen offers them to the people who run the programme */
  canTune: boolean;
}

/** The six areas behind the score, each with its weight and its formulas one press away; the page each is worked on is one press more. */
export function AreasSheet({ open, onClose, sections, score, grade, canTune }: AreasSheetProps) {
  const [section, setSection] = useState<OverviewSection | null>(null);
  const [adjusting, setAdjusting] = useState(false);
  const close = () => { setAdjusting(false); onClose(); };
  return (
    <>
      <Sheet open={open} onClose={close} title="How the score is made" subtitle={score == null ? 'No score yet' : `Score ${score}${grade ? ` · ${GRADE_LABEL[grade]}` : ''}`} width="md">
        {adjusting ? (
          <SectionWeightTuner sections={sections} configBase={TUNING.configBase} invalidateKey={TUNING.invalidateKey} onClose={() => setAdjusting(false)} />
        ) : (
          <>
            <p className="mt-0 text-ds-body text-ds-fg-muted">The score is the weighted mean of the areas that have data. Press an area for its formulas.</p>
            <ul className="m-0 list-none p-0">
              {sections.map((s) => {
                const word = areaWord(s.score);
                return (
                  <li key={s.key} className="flex min-h-ds-control items-center gap-[8px] border-b border-ds-border py-[4px] last:border-b-0">
                    <button type="button" onClick={() => setSection(s)} className={`min-w-0 flex-1 rounded-ds-control text-left hover:underline ${FOCUS}`}>
                      <span className="block truncate text-ds-body font-[500] text-ds-fg" title={s.label}>{s.label}</span>
                      <span className="text-ds-label text-ds-fg-muted">{`${Math.round(s.weight * 100)}% of the score`}</span>
                    </button>
                    <span className="tabular-nums text-ds-body text-ds-fg">{s.score == null ? '—' : Math.round(s.score)}</span>
                    <StatusPill size="sm" tone={areaBand.tone(word)} label={areaBand.label(word)} />
                    <Button size="sm" href={SECTION_HREF[s.key] ?? '/compliance'} aria-label={`Open ${s.label}`}>Open</Button>
                  </li>
                );
              })}
            </ul>
            {canTune && <div className="mt-[12px]"><Button leftIcon={<SlidersHorizontal aria-hidden />} onClick={() => setAdjusting(true)}>Adjust section weights</Button></div>}
          </>
        )}
      </Sheet>
      <SectionDetailModal section={section} onClose={() => setSection(null)} tuning={canTune ? TUNING : undefined} />
    </>
  );
}

// ── one row per framework journey ────────────────────────────────────────────────────────────────────────────────────────

// framework | status | ready | implemented | target (a phone keeps the framework and its Ready; the rest is a line under the name)
const GRID = 'grid items-center gap-x-[8px] px-[4px] [grid-template-columns:minmax(0,1fr)_104px_132px_84px_120px] max-sm:[grid-template-columns:minmax(0,1fr)_56px]';
const WIDE = 'max-sm:hidden';
const NUM = 'text-right text-ds-body tabular-nums text-ds-fg';

function targetWords(t: JourneyRow['target']): { date: string; note: string | null; late: boolean } {
  if (t.state === 'none' || !t.day) return { date: 'Not set', note: null, late: false };
  const date = formatDate(t.day, { calendar: true });
  const n = Math.abs(t.days ?? 0);
  if (t.state === 'overdue') return { date, note: `${plural(n, 'day', 'days')} late`, late: true };
  if (t.state === 'soon') return { date, note: t.days === 0 ? 'Today' : `${plural(n, 'day', 'days')} left`, late: false };
  return { date, note: null, late: false };
}

function JourneyLine({ r }: { r: JourneyRow }) {
  const t = targetWords(r.target);
  const band = r.band ? readinessBandWords : null;
  return (
    <div role="row" className={`${GRID} min-h-[40px] border-t border-ds-border py-[2px] first:border-t-0 hover:bg-ds-surface-hover`}>
      <div role="rowheader" className="min-w-0">
        <TitleLink href={r.href} title={r.name} lines={2} size="body" />
        <p className="m-0 text-ds-label text-ds-fg-muted sm:hidden">
          {[journeyStatus.label(r.status), r.implemented === null ? null : `Implemented ${r.implemented}%`, t.date === 'Not set' ? null : `Target ${t.date}`].filter(Boolean).join(' · ')}
        </p>
      </div>
      <div role="cell" className={WIDE}><StatusPill size="sm" tone={journeyStatus.tone(r.status)} label={journeyStatus.label(r.status)} /></div>
      <div role="cell" className="flex items-center justify-end gap-[6px]">
        {r.ready === null ? (
          <span className="text-ds-body text-ds-fg-muted" title="The list sent no progress for this journey">—</span>
        ) : (
          <>
            <span className={NUM}>{`${r.ready}%`}</span>
            {band && r.band && <span className={WIDE}><StatusPill size="sm" tone={band.tone(r.band)} label={band.label(r.band)} /></span>}
          </>
        )}
      </div>
      <div role="cell" className={`${NUM} ${WIDE}`}>{r.implemented === null ? '—' : `${r.implemented}%`}</div>
      <div role="cell" className={`text-right text-ds-body ${WIDE}`}>
        <span className={t.date === 'Not set' ? 'text-ds-fg-muted' : 'text-ds-fg'}>{t.date}</span>
        {t.note && <span className={`block text-ds-label ${t.late ? 'font-[600] text-ds-danger' : 'text-ds-fg-muted'}`}>{t.note}</span>}
      </div>
    </div>
  );
}

export interface FrameworkRowsProps { q: QueryView; rows: JourneyRow[]; shown: number; onMore: () => void }

export function FrameworkRows({ q, rows, shown, onMore }: FrameworkRowsProps) {
  if (q.isPending) return <div role="status" aria-busy="true"><span className="sr-only">Loading the framework journeys</span><SkeletonRows rows={4} columns={4} label="Loading the framework journeys" /></div>;
  if (q.isError) return <Failed title="Couldn't load the framework journeys" q={q} />;
  if (rows.length === 0) {
    return (
      <p className="m-0 text-ds-body text-ds-fg-muted">
        No framework journey has started yet.{' '}
        <Link href="/frameworks" className={`font-[500] text-ds-primary-text hover:underline ${FOCUS}`}>Choose a framework to start</Link>
      </p>
    );
  }
  const list = rows.slice(0, shown);
  return (
    <div>
      <div role="table" aria-label="Framework journeys, the most urgent first">
        <div role="row" className={`${GRID} pb-[4px] text-ds-label text-ds-fg-muted`}>
          <div role="columnheader">Framework</div>
          <div role="columnheader" className={WIDE}>Status</div>
          <div role="columnheader" className="text-right">Ready</div>
          <div role="columnheader" className={`text-right ${WIDE}`}>Implemented</div>
          <div role="columnheader" className={`text-right ${WIDE}`}>Target</div>
        </div>
        {list.map((r) => <JourneyLine key={r.id} r={r} />)}
      </div>
      <div className="mt-[4px] flex flex-wrap items-center justify-between gap-x-[12px] gap-y-[4px] border-t border-ds-border px-[4px] pt-[8px] text-ds-label text-ds-fg-muted">
        <span role="status">{list.length < rows.length ? `Showing ${formatCount(list.length)} of ${formatCount(rows.length)}` : plural(rows.length, 'journey', 'journeys')}</span>
        {list.length < rows.length && <Button size="sm" onClick={onMore}>{`Show all ${formatCount(rows.length)}`}</Button>}
      </div>
    </div>
  );
}

// ── coverage ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

export function CoverageBody({ rows, retry }: { rows: CoverageRow[]; retry: { scorecard: () => void; evidence: () => void } }) {
  return (
    <ul className="m-0 list-none p-0">
      {rows.map((r) => (
        <CountRow
          key={r.key}
          label={r.label}
          href={r.href}
          tone={r.tone}
          count={r.state === 'ready' ? r.value ?? null : null}
          loading={r.state === 'loading'}
          error={r.state === 'error' ? { onRetry: r.key.startsWith('evidence') ? retry.evidence : retry.scorecard } : null}
        />
      ))}
    </ul>
  );
}

// ── onboarding ───────────────────────────────────────────────────────────────────────────────────────────────────────────

export function OnboardingBody({ q, view }: { q: QueryView; view: OnboardingView | null }) {
  if (q.isPending) return <SkeletonRows rows={3} columns={2} label="Loading framework onboarding" />;
  if (q.isError) return <Failed title="Couldn't load framework onboarding" q={q} />;
  if (!view) return <p className="m-0 text-ds-body text-ds-fg-muted">Framework onboarding has no frameworks to show yet.</p>;
  return (
    <ul className="m-0 list-none p-0">
      <CountRow label="Being onboarded" href="/frameworks/onboarding" count={view.inProgress} />
      <CountRow label="Ready to start a journey" href="/frameworks/onboarding" count={view.ready} tone={view.ready > 0 ? 'success' : 'neutral'} />
      <li className="border-b border-ds-border last:border-b-0">
        <Link href="/admin?tab=profile" className={`flex min-h-ds-control items-center gap-[8px] rounded-ds-control px-[8px] py-[4px] text-ds-body text-ds-fg hover:bg-ds-surface-hover ${FOCUS}`}>
          <span className="min-w-0 flex-1">Organisation profile</span>
          {view.profileComplete === null ? <span className="text-ds-fg-muted">—</span> : view.profileComplete ? (
            <span className="inline-flex items-center gap-[4px]"><CheckCircle2 aria-hidden className="h-[14px] w-[14px] text-ds-success" strokeWidth={1.75} /><StatusPill size="sm" tone="success" label="Complete" /></span>
          ) : <StatusPill size="sm" tone="warning" label="Needs answers" />}
        </Link>
      </li>
    </ul>
  );
}
