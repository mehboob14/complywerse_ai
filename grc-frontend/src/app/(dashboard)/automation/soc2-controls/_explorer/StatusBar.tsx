'use client';

// A proportional bar of how a set of controls stands: one segment per kind, in the colour of its tone (lib/status.ts TONE), read out as words ("12 failing, 40 passing"), never as colour alone.
// The Controls explorer's By domain view and the Overview's posture card draw it; the segments are given, so the bar can show the same figures as the list beside it.
import { clsx } from 'clsx';
import { formatCount } from '@/lib/format';
import { TONE, type Tone } from '@/lib/status';

export interface BarPart { key: string; label: string; value: number; tone: Tone }

export function StatusBar({ parts, total, label, className }: { parts: readonly BarPart[]; total: number; label: string; className?: string }) {
  const shown = parts.filter((p) => p.value > 0);
  const words = shown.map((p) => `${formatCount(p.value)} ${p.label.toLowerCase()}`).join(', ');
  return (
    <div role="img" aria-label={`${label}: ${words || 'none'}`} className={clsx('flex h-[8px] w-full overflow-hidden rounded-full bg-ds-surface-hover', className)}>
      {total > 0 && shown.map((p) => (
        <span key={p.key} title={`${formatCount(p.value)} ${p.label.toLowerCase()}`} style={{ width: `${(p.value / total) * 100}%`, background: TONE[p.tone].dot }} />
      ))}
    </div>
  );
}
