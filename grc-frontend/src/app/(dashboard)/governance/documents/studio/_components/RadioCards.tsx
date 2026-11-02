'use client';

// A choice of one among a few options, each as a card with a name and a line under it: the version a minor or a major change makes, the export
// format. Native radio buttons in a fieldset (so the arrow keys, the group and its name come from the browser); the card around each is its label,
// so the whole card is the target. Written with the design-system tokens only. The kit has no radio card (SegmentedControl is for short words with no
// second line): the Studio's own, listed as a kit gap in the audit.
import { useId, type ReactNode } from 'react';
import { clsx } from 'clsx';
import { InfoTip } from '@/components/ui/InfoTip';

export interface RadioCardOption<V extends string> {
  value: V;
  label: ReactNode;
  /** the line under the name */
  hint?: ReactNode;
}

export function RadioCards<V extends string>({ legend, info, options, value, onChange, className }: {
  /** names the group: read out, and drawn as its label */
  legend: string;
  /** what the (i) beside the label says */
  info?: string;
  options: readonly RadioCardOption<V>[];
  /** null: none chosen yet (the person decides; nothing is chosen for them) */
  value: V | null;
  onChange: (value: V) => void;
  className?: string;
}) {
  const name = useId();
  return (
    <fieldset className={clsx('min-w-0', className)}>
      <legend className="sr-only">{legend}</legend>
      <div className="flex items-center gap-[4px] text-ds-label text-ds-fg"><span aria-hidden>{legend}</span>{info && <InfoTip label={`About ${legend.toLowerCase()}`} text={info} />}</div>
      <div className="mt-[6px] grid gap-[8px] sm:grid-cols-2">
        {options.map((o) => {
          const on = value === o.value;
          return (
            <label
              key={o.value}
              className={clsx(
                'flex min-w-0 cursor-pointer items-start gap-[8px] rounded-ds-control border p-[10px] has-[:focus-visible]:shadow-ds-ring',
                on ? 'border-ds-primary bg-ds-primary-soft' : 'border-ds-border-strong bg-ds-surface hover:bg-ds-surface-hover',
              )}
            >
              <input type="radio" name={name} checked={on} onChange={() => onChange(o.value)} className="mt-[2px] h-[16px] w-[16px] shrink-0 cursor-pointer accent-ds-primary focus-visible:outline-none" />
              <span className="min-w-0">
                <span className="block break-words text-ds-body font-[600] text-ds-fg">{o.label}</span>
                {o.hint && <span className="mt-[2px] block text-ds-label text-ds-fg-muted">{o.hint}</span>}
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
