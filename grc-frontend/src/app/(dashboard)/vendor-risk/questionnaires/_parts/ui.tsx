'use client';

// The few form pieces the questionnaire screens share. Explicit hex on purpose: inside the dashboard shell the platform CSS
// repaints slate/white utilities and sizes bare inputs and buttons (PITFALLS 100); portal dialogs escape it, so the same classes
// read the same in both. Named text sizes only on inputs and buttons (the shell ignores an arbitrary one).
import type { ReactNode } from 'react';
import { clsx } from 'clsx';
import { InfoTip } from '@/components/ui/InfoTip';

const FOCUS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f766e]';

export const FIELD = `block w-full rounded-lg border border-[#c3ccd5] bg-[#fff] px-3 text-sm text-[#1f2933] placeholder:text-[#64707e] disabled:bg-[#f3f6f8] disabled:text-[#64707e] ${FOCUS}`;
export const INPUT = `${FIELD} h-9`;
export const AREA = `${FIELD} py-2 leading-5`;
export const LABEL = 'mb-1 block text-[13px] font-medium leading-5 text-[#26323d]';
export const NOTE = 'text-[12px] leading-4 text-[#64707e]';

/** A label over its field, with an optional (i) for the explanation (D41: explanations live in notes, not in sentences). */
export function Field({ label, htmlFor, info, children, className }: {
  label: string; htmlFor?: string; info?: string; children: ReactNode; className?: string;
}) {
  return (
    <div className={className}>
      <div className="mb-1 flex items-center gap-1">
        <label htmlFor={htmlFor} className="text-[13px] font-medium leading-5 text-[#26323d]">{label}</label>
        {info && <InfoTip text={info} label={`About ${label}`} />}
      </div>
      {children}
    </div>
  );
}

/** An on / off switch. */
export function Switch({ checked, onChange, label, disabled }: {
  checked: boolean; onChange: (next: boolean) => void; label: string; disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={clsx('relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        FOCUS, checked ? 'border-[#0f766e] bg-[#0f766e]' : 'border-[#9aa5b1] bg-[#d5dbe1]')}
    >
      <span aria-hidden className={clsx('inline-block h-3.5 w-3.5 rounded-full bg-[#fff] shadow transition-transform', checked ? 'translate-x-[18px]' : 'translate-x-[2px]')} />
    </button>
  );
}

/** A row with a switch and its words: "Required — must be answered to finish". */
export function ToggleRow({ label, note, checked, onChange, disabled }: {
  label: string; note?: string; checked: boolean; onChange: (next: boolean) => void; disabled?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="min-w-0">
        <span className="block text-[13px] font-medium leading-5 text-[#26323d]">{label}</span>
        {note && <span className={clsx('block', NOTE)}>{note}</span>}
      </span>
      <Switch checked={checked} onChange={onChange} label={label} disabled={disabled} />
    </div>
  );
}

/** A tick box with its words. */
export function Check({ checked, onChange, children, disabled, className }: {
  checked: boolean; onChange: (next: boolean) => void; children: ReactNode; disabled?: boolean; className?: string;
}) {
  return (
    <label className={clsx('flex cursor-pointer items-center gap-2 text-sm leading-5 text-[#26323d]', disabled && 'cursor-not-allowed opacity-60', className)}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 shrink-0 rounded border-[#9aa5b1] accent-[#0f766e]"
      />
      <span className="min-w-0">{children}</span>
    </label>
  );
}

/** A small label chip. Tones follow the kit's: accent = teal, danger = red, warn = amber. */
export function Chip({ tone = 'neutral', children, title }: {
  tone?: 'neutral' | 'accent' | 'danger' | 'warn'; children: ReactNode; title?: string;
}) {
  const colours = {
    neutral: 'bg-[#f0f2f5] text-[#4a5563]',
    accent: 'bg-[#e6f6f3] text-[#0f766e]',
    danger: 'bg-[#fdeef1] text-[#c01741]',
    warn: 'bg-[#fbf1e4] text-[#9a5007]',
  }[tone];
  return (
    <span title={title} className={clsx('inline-flex items-center gap-1 whitespace-nowrap rounded px-1.5 py-0.5 text-[12px] font-medium leading-4', colours)}>
      {children}
    </span>
  );
}
