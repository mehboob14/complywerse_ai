'use client';

// The filters that are on, as chips that come off one by one, with the count they leave ("12 of 48 documents"), "Clear all" and, when the page has a place to keep them, "Save as view".
// A chip is words and an X button named for what it removes, never colour alone; a long chip is cut and keeps its whole text as its title.
import { X } from 'lucide-react';
import { Button } from '@/components/ui/ds';

export interface AppliedChip {
  key: string;
  label: string;
}

export interface AppliedFiltersProps {
  chips: AppliedChip[];
  /** "12 of 48 documents": what is left of what, said once, and read out when it changes */
  summary: string;
  onRemove: (key: string) => void;
  onClear: () => void;
  /** with it, "Save as view" is offered */
  onSave?: () => void;
}

export function AppliedFilters({ chips, summary, onRemove, onClear, onSave }: AppliedFiltersProps) {
  if (chips.length === 0) return null;
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-[8px] gap-y-[6px]" role="group" aria-label="Filters applied">
      <span role="status" className="text-ds-body font-[600] tabular-nums text-ds-fg">{summary}</span>
      {chips.map((c) => (
        <span key={c.key} className="inline-flex max-w-full items-center rounded-full border border-ds-primary bg-ds-primary-soft pl-[10px] text-ds-label text-ds-primary-text">
          <span className="min-w-0 truncate" title={c.label}>{c.label}</span>
          <button
            type="button"
            aria-label={`Remove filter ${c.label}`}
            onClick={() => onRemove(c.key)}
            className="inline-flex aspect-square h-ds-control-sm shrink-0 items-center justify-center rounded-full text-ds-primary-text hover:bg-ds-surface-hover focus-visible:outline-none focus-visible:shadow-ds-ring"
          >
            <X aria-hidden className="h-[12px] w-[12px]" strokeWidth={2} />
          </button>
        </span>
      ))}
      <Button variant="link" size="sm" onClick={onClear}>Clear all</Button>
      {onSave && <Button variant="link" size="sm" onClick={onSave}>Save as view</Button>}
    </div>
  );
}
