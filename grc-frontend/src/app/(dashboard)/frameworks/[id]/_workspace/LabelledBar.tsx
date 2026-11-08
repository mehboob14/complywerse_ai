'use client';

// A bar with its name and figure drawn above it. The kit's ProgressBar names the bar for a screen reader only (its `label` is never drawn), so
// a list of bars needs the words as well: this is that line (a kit gap, reported).
import { ProgressBar, type ProgressTone } from '@/components/ui/ds';
import { formatPercent } from '@/lib/format';

export default function LabelledBar({ label, value, valueText, tone }: { label: string; value: number | null | undefined; valueText?: string; tone?: ProgressTone }) {
  const words = valueText ?? formatPercent(value);
  return (
    <div>
      <div className="mb-[4px] flex items-baseline justify-between gap-[8px] text-ds-body text-ds-fg-body">
        <span className="min-w-0 truncate" title={label}>{label}</span>
        <span className="shrink-0 tabular-nums text-ds-fg">{words}</span>
      </div>
      <ProgressBar value={value} label={label} valueText={words} showValue={false} tone={tone} />
    </div>
  );
}
