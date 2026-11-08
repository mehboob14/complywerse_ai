'use client';

// The facts of a type, in one strip: a few figures with what each rests on behind an (i). The workspace's heading already holds the score and the gaps, so a lens adds only what is
// particular to its type, in a row that is one card high (not a card per figure) and leaves the list in view.
import { ProgressBar } from '@/components/ui/ds';
import { InfoTip } from '@/components/ui/InfoTip';
import type { Tile, Tone } from './profiles';

const TONE: Record<Tone, string> = { default: 'text-ds-fg', success: 'text-ds-success', warning: 'text-ds-warning', danger: 'text-ds-danger' };

export function LensFigures({ figures, label = 'Figures of this type' }: { figures: readonly Tile[]; label?: string }) {
  if (figures.length === 0) return null;
  return (
    <section aria-label={label} className="rounded-ds-card border border-ds-border bg-ds-surface px-[16px] py-[12px]">
      <dl className="grid grid-cols-2 gap-x-[16px] gap-y-[12px] lg:grid-cols-4">
        {figures.map((f) => (
          <div key={f.label} className="min-w-0">
            <dt className="flex items-center gap-[4px] text-ds-label font-normal text-ds-fg-muted">{f.label}{f.info && <InfoTip text={f.info} />}</dt>
            <dd className="mt-[2px] min-w-0">
              <span className={`text-ds-section font-[600] tabular-nums ${TONE[f.tone ?? 'default']}`}>{f.value}</span>
              {f.unit && <span className="ml-[4px] text-ds-label text-ds-fg-muted">{f.unit}</span>}
              {f.progress != null && <ProgressBar value={f.progress} label={`${f.label} share`} showValue={false} className="mt-[4px]" />}
              {f.note && <span className="block text-ds-label text-ds-fg-muted">{f.note}</span>}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
