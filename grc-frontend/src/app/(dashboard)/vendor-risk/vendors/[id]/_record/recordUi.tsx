'use client';

// The small pieces the record's panels use, with the names and props they have always passed, drawn by the kit: a centred Dialog is the kit's Sheet (a sheet from the right on a desktop, a
// bottom sheet on a phone, focus kept, Escape closing one layer), the pills are the kit's StatusPill on the vendor words (lib/statuses/vendor.ts: a word is always said, never a colour alone),
// the empty state is the kit's. A panel moves to the kit by changing one import; the module's own `_ui` is not touched.
import { Children, type ReactNode } from 'react';
import { EmptyState as KitEmptyState, SegmentedControl, Sheet, StatusPill as KitStatusPill } from '@/components/ui/ds';
import { buttonClasses } from '@/components/ui/ds/buttonStyles';
import { statusPill, type Tone } from '@/lib/status';
import { vendorGrade, vendorTier } from '@/lib/statuses/vendor';
import type { LucideIcon } from 'lucide-react';

const textOf = (children: ReactNode): string => Children.toArray(children).map((c) => (typeof c === 'string' || typeof c === 'number' ? String(c) : '')).join('').trim();

/** A status: a dot and a word on a soft tint. Pick the tone with `statusPill(vendorX, word)`. */
export function StatusPill({ tone, children, title }: { tone: Tone; children: ReactNode; title?: string; variant?: 'pill' | 'inline' }) {
  const word = textOf(children);
  return title ? <span title={title}><KitStatusPill tone={tone} label={word} size="sm" /></span> : <KitStatusPill tone={tone} label={word} size="sm" />;
}

const TIERS = ['critical', 'high', 'medium', 'low'];
const tierWord = (tier?: string | null): string | null => { const w = String(tier ?? '').trim().toLowerCase(); return TIERS.includes(w) ? w : null; };

/** A vendor's tier; a vendor with no tier says "Not tiered", never a default tier. `suffix="tier"` makes "Critical tier". */
export function TierBadge({ tier, suffix }: { tier?: string | null; variant?: 'solid' | 'dot'; suffix?: string }) {
  const key = tierWord(tier);
  const label = key ? `${vendorTier.label(key)}${suffix ? ` ${suffix}` : ''}` : 'Not tiered';
  return <KitStatusPill {...statusPill(vendorTier, key ?? 'not_tiered')} label={label} size="sm" />;
}

/** A residual grade: "Grade B", "Grade B 42" with a score; "Not scored" without a grade. */
export function GradePill({ grade, score, prefix }: { grade?: string | null; score?: number | null; prefix?: string }) {
  const letter = String(grade ?? '').trim().toUpperCase();
  if (!letter) return <span className="whitespace-nowrap text-[13px] leading-5 text-ds-fg-muted">Not scored</span>;
  const hasScore = typeof score === 'number' && Number.isFinite(score);
  const shown = [prefix, letter, hasScore ? String(Math.round(score * 10) / 10) : null].filter(Boolean).join(' ');
  return <KitStatusPill tone={statusPill(vendorGrade, letter).tone} label={shown} size="sm" />;
}

/** A finding's or signal's severity on the same ramp and in the same words as a tier. */
export function SeverityChip({ severity }: { severity?: string | null; solid?: boolean }) {
  const key = tierWord(severity);
  if (key) return <KitStatusPill {...statusPill(vendorTier, key)} size="sm" />;
  const info = String(severity ?? '').trim().toLowerCase() === 'info';
  return <KitStatusPill tone="neutral" label={info ? 'Info' : 'Unrated'} size="sm" />;
}

/** A role or a choice that is on or off: a button that says so ("pressed") and says it in words. */
export function ToggleChip({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={buttonClasses({ variant: on ? 'primary' : 'secondary', size: 'sm' })}
    >
      {children}
    </button>
  );
}

const WIDTH = { 480: 'md', 600: 'lg', 720: 'lg', 1080: 'lg' } as const;

/** What a centred dialog was: now the kit's sheet. `data-autofocus` on an element of `children` is where focus starts. */
export function Dialog({ open, onClose, title, description, size = 480, footer, children, flush = false }: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  size?: 480 | 600 | 720 | 1080;
  footer?: ReactNode;
  children: ReactNode;
  flush?: boolean;
}) {
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={title}
      subtitle={description}
      width={WIDTH[size]}
      padded={!flush}
      footer={footer ? <div className="flex flex-wrap items-center justify-end gap-[8px]">{footer}</div> : undefined}
    >
      {children}
    </Sheet>
  );
}

/** Nothing here yet: a few words and the one button that fills it. */
export function EmptyState({ title, hint, action, icon, bare = false }: { title: string; hint?: string; action?: ReactNode; icon?: LucideIcon; bare?: boolean }) {
  return <KitEmptyState kind="firstUse" title={title} description={hint} action={action} icon={icon} bare={bare} />;
}

/** One of a few choices, as radio buttons drawn as a segmented control (the options' own `tone` is not used: the kit has one look). */
export function Segmented({ label, value, options, onChange }: { label: string; value: string; options: ReadonlyArray<{ value: string; label: string }>; onChange: (v: string) => void }) {
  return <SegmentedControl label={label} name={`segmented-${label.replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase()}`} options={options.map((o) => ({ value: o.value, label: o.label }))} value={value} onChange={onChange} />;
}
