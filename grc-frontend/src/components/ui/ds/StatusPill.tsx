'use client';

// A status: a dot and a word on a soft tint. The word is always drawn, the colour only backs it up (a person who cannot tell the tones apart
// loses nothing). Pick the tone and the word from a registry: <StatusPill {...statusPill(documentStatus, doc.status)} /> (src/lib/status.ts).
// The colours come from the tone table as hex (the same six families as the vendor kit, words on their tint at 4.5:1); the rest is tokens.
import { clsx } from 'clsx';
import { EMPTY } from '@/lib/format';
import { TONE, type Tone } from '@/lib/status';
import { useClipped } from './useClipped';

export interface StatusPillProps {
  tone: Tone;
  /** what the person reads; never left out (a blank one is drawn as the dash, so the pill is never a dot alone) */
  label: string;
  /** `sm` for a dense table cell */
  size?: 'sm' | 'md';
  className?: string;
}

const SIZE = {
  sm: 'gap-[4px] px-[6px] py-[1px]',
  md: 'gap-[6px] px-[8px] py-[2px]',
};

export function StatusPill({ tone, label, size = 'md', className }: StatusPillProps) {
  const c = TONE[tone] ?? TONE.neutral;
  const text = label.trim() || EMPTY;
  const [word, clipped] = useClipped<HTMLSpanElement>();
  return (
    <span
      title={clipped ? text : undefined}
      style={{ background: c.tint, color: c.text, borderColor: c.border }}
      className={clsx('inline-flex max-w-full items-center rounded-full border text-ds-label', SIZE[size], className)}
    >
      <span aria-hidden className="h-[6px] w-[6px] shrink-0 rounded-full" style={{ background: c.dot }} />
      <span ref={word} className="min-w-0 truncate">{text}</span>
    </span>
  );
}
