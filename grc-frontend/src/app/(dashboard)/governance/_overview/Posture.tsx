'use client';

// The posture card: how the Governance programme is doing, compactly. The head is the overall score (a ring, the server's own grade word, how the score
// moved since last month in words, a sparkline of the months so far), then one row for each of the ten sections: its name, a bar against the target (the
// tick), its score with the number beside the bar, and an arrow to the page that lists what it counts. A section's name opens it IN PLACE: how its score is
// made (each metric with its weight, what it counts and the server's own formula), the section's own counts, and the doors: its page, and "Adjust weights"
// (the shared dialog with the weight tuner). Nothing here scores anything; the words and bands are postureModel.ts. The radar of the old page is gone:
// the same numbers as bars, with the number beside every bar and nothing that needs a hover.
import { useState } from 'react';
import Link from 'next/link';
import { ArrowRight, ArrowUpRight, ChevronRight, SlidersHorizontal, TrendingDown, TrendingUp } from 'lucide-react';
import { Button, EmptyState, Fact, FactList, SectionCard, Skeleton, StatusPill } from '@/components/ui/ds';
import { TONE, type Tone } from '@/lib/status';
import type { Scorecard } from './overviewModel';
import { FOCUS, FeedError, type Feed } from './parts';
import { postureHead, scoredWords, sectionName, sectionRows, trendAlt, type PostureHead, type SectionRow, type TrendPoint } from './postureModel';

const BRAND = '#0f766e';                  // --ds-primary: an SVG attribute cannot read a class

export function Ring({ score, tone, size = 64 }: { score: number | null; tone: Tone; size?: number }) {
  const stroke = 6;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const arc = score === null ? 0 : score === 0 ? c * 0.06 : (Math.max(0, Math.min(100, score)) / 100) * c;       // a real 0 still draws a sliver: "weak" is not "no data"
  const colour = TONE[tone];
  return (
    <span role="img" aria-label={score === null ? 'Performance score: not available' : `Performance score ${Math.round(score)} of 100`} className="relative inline-grid shrink-0 place-items-center" style={{ width: size, height: size }}>
      <svg aria-hidden width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={colour.tint} strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={colour.dot} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={`${arc} ${c}`} />
      </svg>
      <span aria-hidden className="absolute text-ds-title font-[600] tabular-nums" style={{ color: colour.text }}>{score === null ? '—' : Math.round(score)}</span>
    </span>
  );
}

function Trend({ points, down }: { points: TrendPoint[]; down: boolean }) {
  const w = 104;
  const h = 32;
  const values = points.map((p) => p.value);
  const lo = Math.min(...values);
  const span = Math.max(...values) - lo || 1;
  const x = (i: number) => 4 + (i * (w - 8)) / (points.length - 1);
  const y = (v: number) => h - 5 - ((v - lo) / span) * (h - 10);
  const colour = down ? TONE.danger.dot : BRAND;
  return (
    <svg role="img" aria-label={trendAlt(points)} width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="shrink-0">
      <polyline points={points.map((p, i) => `${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ')} fill="none" stroke={colour} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      {points.map((p, i) => <circle key={i} cx={x(i)} cy={y(p.value)} r={i === points.length - 1 ? 3 : 2} fill={i === points.length - 1 ? colour : '#ffffff'} stroke={colour} strokeWidth={1.5} />)}
    </svg>
  );
}

/** A bar against a target: the fill in the band's colour, a tick at the target. The number is always beside it; the bar is a picture. */
function ScoreBar({ score, tone, target }: { score: number | null; tone: Tone; target?: number }) {
  const width = score === null ? 0 : Math.max(score === 0 ? 2 : 0, Math.min(100, score));
  return (
    <span aria-hidden className="relative block h-[6px] w-full rounded-full bg-ds-border">
      <span className="absolute inset-y-0 left-0 block rounded-full" style={{ width: `${width}%`, background: TONE[tone].dot }} />
      {target !== undefined && <span className="absolute -top-[2px] block h-[10px] w-[2px] rounded-full bg-ds-fg-muted" style={{ left: `${target}%` }} />}
    </span>
  );
}

function Head({ head }: { head: PostureHead }) {
  const down = head.delta !== null && head.delta.value < 0;
  return (
    <div className="mb-[8px] flex flex-wrap items-center gap-x-[12px] gap-y-[8px] border-b border-ds-border pb-[12px]">
      <Ring score={head.score} tone={head.grade?.tone ?? 'neutral'} />
      <div className="min-w-0 flex-1 basis-[10rem]">
        <div className="flex flex-wrap items-center gap-x-[8px] gap-y-[4px]">
          {head.grade && <StatusPill tone={head.grade.tone} label={head.grade.label} />}
          {head.delta && (
            <span className={`inline-flex items-center gap-[4px] text-ds-label ${down ? 'text-ds-danger' : head.delta.value > 0 ? 'text-ds-success' : 'text-ds-fg-muted'}`}>
              {head.delta.value !== 0 && (down ? <TrendingDown aria-hidden className="h-[14px] w-[14px]" strokeWidth={2} /> : <TrendingUp aria-hidden className="h-[14px] w-[14px]" strokeWidth={2} />)}
              {head.delta.words}
            </span>
          )}
        </div>
        <p className="mt-[2px] text-ds-label text-ds-fg-muted">{scoredWords(head)}</p>
      </div>
      {head.trend.length > 1 && <Trend points={head.trend} down={down} />}
    </div>
  );
}

function Details({ row, panelId, onAdjust }: { row: SectionRow; panelId: string; onAdjust: () => void }) {
  return (
    <div id={panelId} className="mb-[8px] ml-[4px] mr-[4px] rounded-ds-card bg-ds-surface-subtle px-[12px] py-[10px]">
      {row.metrics.length > 0 ? (
        <ul className="space-y-[10px]">
          {row.metrics.map((m) => (
            <li key={m.key}>
              <div className="flex flex-wrap items-baseline justify-between gap-x-[8px] gap-y-[2px]">
                <span className="min-w-0 break-words text-ds-body font-[500] text-ds-fg">
                  {m.label}
                  <span className="ml-[6px] text-ds-label font-normal text-ds-fg-muted">{`${m.weightPct}% of the score`}</span>
                </span>
                <span className="shrink-0 text-ds-body tabular-nums text-ds-fg">
                  {m.detail && <span className="mr-[8px] text-ds-label text-ds-fg-muted">{m.detail}</span>}
                  <span className="font-[600]">{m.scoreText}</span>
                </span>
              </div>
              <div className="mt-[4px]"><ScoreBar score={m.score} tone={m.band.tone} /></div>
              <p className="mt-[4px] break-words text-ds-label text-ds-fg-muted">{m.score === null && !m.detail ? 'No records in this area yet, so the section is scored without it.' : m.formula}</p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-ds-body text-ds-fg-muted">Nothing to score in this section yet.</p>
      )}
      {row.facts.length > 0 && (
        <div className="mt-[12px] border-t border-ds-border pt-[10px]">
          <FactList min={110}>{row.facts.map((f) => <Fact key={f.label} label={f.label}>{f.value}</Fact>)}</FactList>
        </div>
      )}
      <div className="mt-[12px] flex flex-wrap items-center gap-[8px]">
        <Button size="sm" href={row.page} rightIcon={<ArrowRight aria-hidden />}>{`Open ${row.label}`}</Button>
        {row.metrics.length > 0 && <Button size="sm" aria-haspopup="dialog" leftIcon={<SlidersHorizontal aria-hidden />} onClick={onAdjust}>Adjust weights</Button>}
      </div>
    </div>
  );
}

function SectionItem({ row, target, open, onToggle, onAdjust }: { row: SectionRow; target: number; open: boolean; onToggle: () => void; onAdjust: () => void }) {
  const panelId = `posture-${row.key}-panel`;
  return (
    <li className="min-w-0 border-t border-ds-border first:border-t-0">
      <div className="grid min-h-ds-control grid-cols-[minmax(0,1fr)_minmax(56px,112px)_36px_var(--ds-control-h)] items-center gap-x-[12px] rounded-ds-control hover:bg-ds-surface-hover max-sm:grid-cols-[minmax(0,1fr)_64px_32px_var(--ds-control-h)]">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          aria-label={`${sectionName(row)}. ${open ? 'Hides' : 'Shows'} how it is scored.`}
          onClick={onToggle}
          className={`flex min-h-ds-control min-w-0 items-center gap-[6px] rounded-ds-control px-[4px] text-left text-ds-body text-ds-fg ${FOCUS}`}
        >
          <ChevronRight aria-hidden className={`h-[14px] w-[14px] shrink-0 text-ds-fg-muted transition-transform ${open ? 'rotate-90' : ''}`} strokeWidth={2} />
          <span className="min-w-0 break-words">{row.label}</span>
        </button>
        <ScoreBar score={row.score} tone={row.band.tone} target={target} />
        <span className="text-right text-ds-body font-[600] tabular-nums text-ds-fg">{row.scoreText}</span>
        <Link href={row.page} aria-label={`Open ${row.label}`} className={`grid h-ds-control w-[var(--ds-control-h)] place-items-center rounded-ds-control text-ds-fg-muted hover:bg-ds-surface-hover hover:text-ds-fg ${FOCUS}`}>
          <ArrowUpRight aria-hidden className="h-[16px] w-[16px]" strokeWidth={1.75} />
        </Link>
      </div>
      {open && <Details row={row} panelId={panelId} onAdjust={onAdjust} />}
    </li>
  );
}

export function PostureCard({ feed, wide, onOpenScore, onAdjust }: {
  feed: Feed<Scorecard>;
  /** the card has the width of the page (the worklist is a short strip): the sections run in two columns */
  wide: boolean;
  onOpenScore: () => void;
  /** open the shared dialog of a section, which holds the weight tuner */
  onAdjust: (sectionKey: string) => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const head = postureHead(feed.data);
  const rows = sectionRows(feed.data);
  return (
    <SectionCard
      id="posture"
      title="Programme posture"
      info="Each section's score against its target (the tick). Select a section to see how its score is made, or the arrow to open its page."
      actions={feed.load === 'ready' && rows.length > 0 ? <Button size="sm" aria-haspopup="dialog" onClick={onOpenScore}>How is it scored?</Button> : undefined}
    >
      {feed.load === 'loading' && (
        <div role="status" aria-busy="true">
          <span className="sr-only">Loading the posture</span>
          <div className="mb-[12px] flex items-center gap-[12px]"><Skeleton className="h-[64px] w-[64px] rounded-full" /><div className="space-y-[8px]"><Skeleton className="h-[20px] w-[120px]" /><Skeleton className="h-[14px] w-[180px]" /></div></div>
          {Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="mb-[10px] h-[16px] w-full" />)}
        </div>
      )}
      {feed.load === 'error' && <FeedError title="Couldn't load the posture" feed={feed} />}
      {feed.load === 'ready' && rows.length === 0 && (
        <EmptyState kind="firstUse" bare title="No section scores yet" description="Scores appear here once there are documents, reviews or approvals to measure." />
      )}
      {feed.load === 'ready' && rows.length > 0 && (
        <>
          <Head head={head} />
          <ul id="breakdown" aria-label={`Section scores, target ${head.target}`} className={`m-0 grid list-none items-start p-0 ${wide ? 'md:grid-cols-2 md:gap-x-[24px]' : ''}`}>
            {rows.map((row) => (
              <SectionItem key={row.key} row={row} target={head.target} open={open === row.key} onToggle={() => setOpen(open === row.key ? null : row.key)} onAdjust={() => onAdjust(row.key)} />
            ))}
          </ul>
        </>
      )}
    </SectionCard>
  );
}
