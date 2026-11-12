'use client';

/**
 * Shared pieces of the Risk Management Overview (Overview v2): how a request's state reads on a tile or a card (loading, failed with Retry, "No access", nothing yet: a failed
 * or refused request is never drawn as a figure or a chart of zeros) and the Module health sheet (the ten sections and the math behind them, the weights for the people who could
 * always adjust them), which "How is it scored?" opens.
 */
import { useState } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { Button, Sheet, StatusPill } from '@/components/ui/ds';
import type { ChartState } from '@/components/overview/charts';
import { canRetry, errorMessage, statusOf } from '@/components/ui/ds/reportOutcome';
import { SectionDetailModal, type OverviewSection } from '@/components/dashboard/score-kit';
import { SectionWeightTuner } from '@/components/dashboard/score-tuning';
import { SCORECARD_QUERY_KEYS } from '@/components/dashboard/scorecard-query-keys';
import { GRADE_LABEL, sectionBand, type Grade } from './overviewModel';

/** What a request looks like to a card: its state and, when it failed, the way to ask again. A useQuery result is a Feed. */
export interface Feed { isPending: boolean; isError: boolean; error: unknown; refetch: () => unknown; data?: unknown }

/** The first request of these that failed with nothing to show (an error with older data is still the data). */
const failedOf = (feeds: readonly Feed[]): Feed | undefined => feeds.find((f) => f.isError && f.data === undefined);

export interface TileStatus { loading: boolean; denied: boolean; error: { title: string; message?: string; onRetry?: () => void } | null }

/** The state of a figure that rests on these requests: loading while any is asked, "No access" when the server refused, a failure with Retry otherwise. */
export function tileStatus(subject: string, feeds: readonly Feed[]): TileStatus {
  const failed = failedOf(feeds);
  if (failed && statusOf(failed.error) === 403) return { loading: false, denied: true, error: null };
  if (failed) {
    return {
      loading: false, denied: false,
      error: { title: `Couldn't load ${subject}`, message: errorMessage(failed.error), onRetry: canRetry(failed.error) ? () => { feeds.forEach((f) => { if (f.isError) void f.refetch(); }); } : undefined },
    };
  }
  return { loading: !failed && feeds.some((f) => f.isPending), denied: false, error: null };
}

/** The ChartCard props for a chart that rests on these requests (`empty`: they answered with nothing to draw). */
export function cardStatus(subject: string, feeds: readonly Feed[], empty: boolean): { state: ChartState; error?: { title: string; message?: string; onRetry?: () => void }; deniedText?: string } {
  const t = tileStatus(subject, feeds);
  if (t.denied) return { state: 'denied', deniedText: `Your role cannot see ${subject}.` };
  if (t.error) return { state: 'error', error: t.error };
  if (t.loading) return { state: 'loading' };
  return { state: empty ? 'empty' : 'ready' };
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
      <Sheet open={open} onClose={close} title="How it is scored" subtitle={score == null ? 'No score yet' : `Score ${score}${grade ? ` · ${GRADE_LABEL[grade]}` : ''}`} width="md">
        {adjusting ? (
          <SectionWeightTuner sections={sections} configBase={tuning.configBase} invalidateKey={tuning.invalidateKey} onClose={() => setAdjusting(false)} />
        ) : (
          <>
            <ul className="m-0 list-none p-0">
              {sections.map((s) => {
                const b = sectionBand(s.score);
                return (
                  <li key={s.key} className="flex min-h-ds-control items-center gap-[8px] border-b border-ds-border py-[4px] last:border-b-0">
                    <button type="button" onClick={() => setSection(s)} className="min-w-0 flex-1 rounded-ds-control text-left hover:underline focus-visible:outline-none focus-visible:shadow-ds-ring">
                      <span className="block truncate text-ds-body font-[500] text-ds-fg" title={s.label}>{s.label}</span>
                      <span className="text-ds-label text-ds-fg-muted">{Math.round(s.weight * 100)}% weight</span>
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

