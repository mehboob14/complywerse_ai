'use client';

// SegmentedControl: a short list of choices, one of them chosen, drawn as joined segments ("In-app | Email | Both | Off"). It is a native radio group, so
// it needs no keyboard code of its own: Tab enters and leaves the group once, the arrow keys move the choice, and a screen reader says "2 of 4".
//
//   <SegmentedControl label="Reminder: where it goes" name="notify-reminder" options={CHANNELS} value={channel} onChange={setChannel} />
//
// `label` names the group (it is read out, not drawn). A `quiet` option reads grey when chosen, for the choice that means "nothing" ("Off"). A disabled
// group keeps its chosen segment readable (a view-only page still has to show the value) and only stops answering presses. The options wrap onto more lines
// when there is not room for them in one.
import { clsx } from 'clsx';

export interface SegmentedOption<V extends string = string> {
  value: V;
  label: string;
  /** reads grey, not teal, while chosen */
  quiet?: boolean;
}

export interface SegmentedControlProps<V extends string = string> {
  /** what the group is called for a screen reader */
  label: string;
  /** the radio group's name: unique on the page */
  name: string;
  options: readonly SegmentedOption<V>[];
  value: V;
  onChange: (value: V) => void;
  disabled?: boolean;
  /** layout only (margin, alignment) */
  className?: string;
}

const GROUP = 'inline-flex max-w-full flex-wrap gap-[2px] rounded-ds-control border border-ds-border-strong bg-ds-surface p-[2px]';
const SEGMENT = 'flex min-h-ds-control-sm select-none items-center rounded-[4px] px-[10px] text-ds-label text-ds-fg-muted peer-focus-visible:shadow-ds-ring';
const CHOSEN = 'peer-checked:bg-ds-primary peer-checked:text-ds-on-primary';
const CHOSEN_QUIET = 'peer-checked:bg-ds-border peer-checked:text-ds-fg';

export function SegmentedControl<V extends string = string>({ label, name, options, value, onChange, disabled = false, className }: SegmentedControlProps<V>) {
  return (
    <div role="radiogroup" aria-label={label} className={clsx(GROUP, className)}>
      {options.map((o) => (
        <label key={o.value} className="relative">
          <input type="radio" name={name} value={o.value} checked={o.value === value} disabled={disabled} onChange={() => onChange(o.value)} className="peer sr-only" />
          <span className={clsx(SEGMENT, o.quiet ? CHOSEN_QUIET : CHOSEN, disabled ? 'cursor-default' : 'cursor-pointer hover:text-ds-fg')}>{o.label}</span>
        </label>
      ))}
    </div>
  );
}
