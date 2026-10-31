'use client';

// The score breakdown (collapsed until asked for, as it always was) and the Performance Score dialog. Both draw what the server computed: every score,
// weight, target and formula comes from /governance/dashboard/documents-overview; nothing here scores anything. The breakdown cards are built from the
// kit and the tone table (the shared ScoreBreakdownCard, with its own paper palette and serif numerals, stays for the other modules); the dialogs keep
// score-kit's SectionDetailModal and the weight tuner, which other modules share.
import { useState } from 'react';
import { ChevronDown, SlidersHorizontal } from 'lucide-react';
import { AnimatedModal } from '@/components/ui/AnimatedModal';
import { Button, SectionCard, Skeleton, StatusPill } from '@/components/ui/ds';
import { EMPTY, statusLabel } from '@/lib/format';
import { TONE } from '@/lib/status';
import { ScoreRing, scoreBand, type OverviewMetric, type OverviewSection } from '@/components/dashboard/score-kit';
import { SectionWeightTuner } from '@/components/dashboard/score-tuning';
import { BAND_TONE, breakdownSections, performanceTile, scoreText, type Scorecard } from './overviewModel';
import { FOCUS, FeedError, type Feed } from './parts';

/** The payload as the page reads it: the model's Scorecard with the sections typed as score-kit's (the detail dialog takes more than the model does). */
export type OverviewCard = Scorecard & { sections?: Record<string, OverviewSection> };

const bandOf = (score: number | null | undefined) => {
  const band = scoreBand(score);
  return { tone: BAND_TONE[band.label], label: statusLabel(band.label) };
};

function Bar({ score }: { score: number | null }) {
  return (
    <span aria-hidden className="mt-[4px] block h-[6px] rounded-full bg-ds-border">
      <span className="block h-[6px] rounded-full" style={{ width: `${score === null ? 0 : Math.max(score === 0 ? 2 : 0, Math.min(100, score))}%`, background: TONE[bandOf(score).tone].dot }} />
    </span>
  );
}

function MetricLine({ metric }: { metric: OverviewMetric }) {
  return (
    <span className="block">
      <span className="flex items-baseline justify-between gap-[8px] text-ds-body">
        <span className="min-w-0 break-words text-ds-fg-body">{metric.label}</span>
        <span className="shrink-0 tabular-nums text-ds-fg-muted">{scoreText(metric.score)}</span>
      </span>
      <Bar score={metric.score} />
    </span>
  );
}

function SectionScoreCard({ section, onOpen }: { section: OverviewSection; onOpen: () => void }) {
  const band = bandOf(section.score);
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-haspopup="dialog"
      aria-label={`${section.label}: score ${section.score === null ? 'not available' : Math.round(section.score)}, ${band.label}. Opens its formulas.`}
      className={`flex min-w-0 flex-[1_1_240px] flex-col rounded-ds-card border border-ds-border bg-ds-surface p-[16px] text-left hover:bg-ds-surface-hover ${FOCUS}`}
    >
      <span className="flex items-start justify-between gap-[8px]">
        <span className="min-w-0">
          <span className="block break-words text-ds-section text-ds-fg">{section.label}</span>
          <span className="block text-ds-label text-ds-fg-muted">{Math.round(section.weight * 100)}% of the score</span>
        </span>
        <span className="flex shrink-0 flex-col items-end gap-[4px]">
          <span className="text-[24px] leading-[32px] font-[600] tabular-nums" style={{ color: TONE[band.tone].text }}>{section.score === null ? EMPTY : Math.round(section.score)}</span>
          <StatusPill size="sm" tone={band.tone} label={band.label} />
        </span>
      </span>
      <span className="mt-[12px] block space-y-[8px]">
        {section.metrics.map((m) => <MetricLine key={m.key} metric={m} />)}
      </span>
    </button>
  );
}

export function ScoreBreakdown({ feed, onOpenSection }: { feed: Feed<OverviewCard>; onOpenSection: (section: OverviewSection) => void }) {
  const [open, setOpen] = useState(false);
  const sections = breakdownSections(feed.data);
  if (feed.load === 'ready' && sections.length === 0) return null;          // nothing to expand: the radar and the tiles already say there is no score yet
  return (
    <SectionCard
      id="breakdown"
      title="Score breakdown"
      info="Each area is scored by its own formulas. Select a card to see its formulas and its weight."
      meta={feed.load === 'ready' ? `${sections.length} sections` : undefined}
      actions={feed.load === 'ready' ? (
        <Button size="sm" aria-expanded={open} aria-controls="breakdown-panel" rightIcon={<ChevronDown aria-hidden className={open ? 'rotate-180' : ''} />} onClick={() => setOpen((v) => !v)}>
          {open ? 'Hide' : 'Show'}
        </Button>
      ) : undefined}
    >
      {feed.load === 'loading' ? <Skeleton className="h-[28px] w-[60%]" /> : null}
      {feed.load === 'error' ? <FeedError title="Couldn't load the score breakdown" feed={feed} /> : null}
      {feed.load === 'ready' && open ? (
        <div id="breakdown-panel" className="flex flex-wrap gap-[12px]">
          {sections.map((section) => <SectionScoreCard key={section.key} section={section} onOpen={() => onOpenSection(section)} />)}
        </div>
      ) : null}
    </SectionCard>
  );
}

/** "Performance Score": how the number is made, and (for the people who could always) the weights. The weight tuner is the shared one. */
export function PerformanceDialog({ open, onClose, card, tuning }: { open: boolean; onClose: () => void; card: OverviewCard | undefined; tuning: { configBase: string; invalidateKey: unknown[] } }) {
  const [adjusting, setAdjusting] = useState(false);
  const close = () => { setAdjusting(false); onClose(); };
  const perf = performanceTile(card);
  const components = card?.performance?.components ?? [];
  const sections = breakdownSections(card);
  const grade = perf.grade ? { label: statusLabel(perf.grade), tone: bandOf(perf.score).tone } : null;
  const terms = components.filter((c) => c.score !== null).map((c) => `${c.label} × ${Math.round(c.weight * 100)}%`).join(' + ');
  return (
    <AnimatedModal isOpen={open} onClose={close} size="lg" title="Performance Score" subtitle="Weighted mean of the module's section scores">
      <div className="p-[20px]">
        <div className="mb-[16px] flex items-center gap-[16px] rounded-ds-card bg-ds-surface-subtle p-[16px]">
          <ScoreRing score={perf.score} size={72} />
          <div className="min-w-0 flex-1">
            {grade && <StatusPill tone={grade.tone} label={grade.label} />}
            <p className="mt-[6px] text-ds-body text-ds-fg-muted">
              Each section is scored by its own formulas, then blended by weight. Sections with no data are excluded and the remaining weights re-normalize.
            </p>
          </div>
          {!adjusting && sections.length > 0 && (
            <Button size="sm" className="self-start" leftIcon={<SlidersHorizontal aria-hidden />} onClick={() => setAdjusting(true)}>Adjust weights</Button>
          )}
        </div>

        {adjusting ? (
          <SectionWeightTuner sections={sections} configBase={tuning.configBase} invalidateKey={tuning.invalidateKey} onClose={() => setAdjusting(false)} />
        ) : (
          <>
            <ul className="divide-y divide-ds-border rounded-ds-card border border-ds-border">
              {components.map((c) => (
                <li key={c.key} className="px-[16px] py-[12px]">
                  <div className="flex items-center justify-between gap-[12px]">
                    <span className="flex min-w-0 items-center gap-[8px]">
                      <span className="min-w-0 break-words text-ds-body font-[500] text-ds-fg">{c.label}</span>
                      <span className="shrink-0 rounded-ds-control bg-ds-surface-subtle px-[6px] text-ds-label text-ds-fg-muted">Weight {Math.round(c.weight * 100)}%</span>
                    </span>
                    <span className="flex shrink-0 items-baseline gap-[8px]">
                      <span className="text-ds-label tabular-nums text-ds-fg-muted">{c.score === null ? '' : `+${(c.score * c.weight).toFixed(1)} pts`}</span>
                      <span className="text-ds-body font-[600] tabular-nums" style={{ color: TONE[bandOf(c.score).tone].text }}>{scoreText(c.score)}</span>
                    </span>
                  </div>
                  <Bar score={c.score} />
                </li>
              ))}
            </ul>
            <div className="mt-[16px] rounded-ds-card border border-ds-border bg-ds-surface-subtle px-[12px] py-[10px]">
              <p className="text-ds-label text-ds-fg-body">
                <span className="font-[600]">Performance score</span>{' = '}{terms}{' = '}
                <span className="font-[600]">{perf.score === null ? EMPTY : Math.round(perf.score)}</span>
              </p>
            </div>
          </>
        )}
      </div>
    </AnimatedModal>
  );
}
