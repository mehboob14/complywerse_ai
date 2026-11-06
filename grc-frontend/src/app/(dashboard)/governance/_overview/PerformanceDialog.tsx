'use client';

// The Performance Score dialog: how the overall number is made (each section's score and weight, the formula) and, for the people who could always, the
// weights (the shared tuner). It draws what the server computed: every score, weight, target and formula comes from /governance/dashboard/documents-overview;
// nothing here scores anything. The dialog and the section weight tuner are the shared ones; the Overview's posture card opens it from "How is it scored?".
import { useState } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { AnimatedModal } from '@/components/ui/AnimatedModal';
import { Button, StatusPill } from '@/components/ui/ds';
import { EMPTY } from '@/lib/format';
import { TONE } from '@/lib/status';
import type { OverviewSection } from '@/components/dashboard/score-kit';
import { SectionWeightTuner } from '@/components/dashboard/score-tuning';
import { breakdownSections, performanceTile, scoreText, type Scorecard } from './overviewModel';
import { Ring } from './Posture';
import { bandOf, postureHead } from './postureModel';

/** The payload as the page reads it: the model's Scorecard with the sections typed as score-kit's (the detail dialog takes more than the model does). */
export type OverviewCard = Scorecard & { sections?: Record<string, OverviewSection> };

function Bar({ score }: { score: number | null }) {
  return (
    <span aria-hidden className="mt-[4px] block h-[6px] rounded-full bg-ds-border">
      <span className="block h-[6px] rounded-full" style={{ width: `${score === null ? 0 : Math.max(score === 0 ? 2 : 0, Math.min(100, score))}%`, background: TONE[bandOf(score).tone].dot }} />
    </span>
  );
}

/** "Performance Score": how the number is made, and (for the people who could always) the weights. The weight tuner is the shared one. */
export function PerformanceDialog({ open, onClose, card, tuning }: { open: boolean; onClose: () => void; card: OverviewCard | undefined; tuning: { configBase: string; invalidateKey: unknown[] } }) {
  const [adjusting, setAdjusting] = useState(false);
  const close = () => { setAdjusting(false); onClose(); };
  const perf = performanceTile(card);
  const components = card?.performance?.components ?? [];
  const sections = breakdownSections(card);
  const grade = postureHead(card).grade;                       // the server's word and the tone that goes with that word, as the posture card's ring shows them
  const terms = components.filter((c) => c.score !== null).map((c) => `${c.label} × ${Math.round(c.weight * 100)}%`).join(' + ');
  return (
    <AnimatedModal isOpen={open} onClose={close} size="lg" title="Performance Score" subtitle="Weighted mean of the module's section scores">
      <div className="p-[20px]">
        <div className="mb-[16px] flex items-center gap-[16px] rounded-ds-card bg-ds-surface-subtle p-[16px]">
          <Ring score={perf.score} tone={grade?.tone ?? 'neutral'} size={72} />
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
