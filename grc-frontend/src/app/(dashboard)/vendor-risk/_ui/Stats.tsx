'use client';

// Numbers, status and risk as the Vendors pages show them: a stat tile, tier / severity / grade chips, a status pill, a person.
// Tier and severity share Compliverse's SEV_HEX ramp; statuses use Verity's six families (tones.ts). Colours are inline hex: the
// platform CSS repaints slate/green/blue utilities inside the shell (PITFALLS 100), and "Approved" must not turn mint.
import Link from 'next/link';
import { clsx } from 'clsx';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { SEV_HEX } from '../_lib/tprmShared';
import { avatarIndex, initials } from './people';
import { NOT_TIERED, SOFT, onColor, tierColor, tierKey, tierLabel } from './tiers';
import { TONE, tones, type Tone } from './tones';

const FOCUS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f766e]';

/** A headline number with its label and, usually, a way in. A zero never wears an alarm colour: "0 overdue" is good news. */
export function StatTile({ label, value, icon: Icon, tone = 'neutral', caption, href }: {
  label: string;
  value: number | string;
  icon?: LucideIcon;
  tone?: 'warning' | 'danger' | 'neutral' | 'success' | 'progress';
  /** one short line under the label ("1 overdue") */
  caption?: string;
  /** makes the whole tile a link (to the list it counts) */
  href?: string;
}) {
  const quiet = value === 0 || value === '0';
  const colors = TONE[quiet ? 'neutral' : tone];
  const body = (
    <>
      {Icon && (
        <span aria-hidden className="grid h-10 w-10 shrink-0 place-items-center rounded-lg" style={{ background: colors.tint, color: colors.text }}>
          <Icon className="h-5 w-5" strokeWidth={1.75} />
        </span>
      )}
      <span className="min-w-0">
        <span className="block text-[24px] font-semibold leading-7 tabular-nums" style={{ color: quiet || tone === 'neutral' ? '#1f2933' : colors.text }}>
          {typeof value === 'number' ? value.toLocaleString('en-US') : value}
        </span>
        <span className="line-clamp-2 break-words text-[13px] leading-5 text-[#586472]">{label}</span>
        {caption && <span className="block truncate text-[12px] leading-4 text-[#64707e]">{caption}</span>}
      </span>
    </>
  );
  const frame = 'flex items-center gap-3.5 rounded-xl border border-[#d5dbe1] bg-[#fff] p-4 text-left';
  return href ? (
    <Link href={href} className={clsx(frame, 'transition-colors hover:border-[#99d5cf] hover:bg-[#fbfefd]', FOCUS)}>{body}</Link>
  ) : (
    <div className={frame}>{body}</div>
  );
}

/** A vendor's tier. `solid` is the chip (a column of them reads at a glance); `dot` is the quiet version for dense rows. A vendor
 *  with no tier says "Not tiered" in grey, never a default tier. `suffix="tier"` makes "Critical tier". White ink only on the red:
 *  the other fills are too bright for it (tiers.ts). */
export function TierBadge({ tier, variant = 'solid', suffix }: { tier?: string | null; variant?: 'solid' | 'dot'; suffix?: string }) {
  const key = tierKey(tier);
  const text = key && suffix ? `${tierLabel(tier)} ${suffix}` : tierLabel(tier);
  if (variant === 'dot') {
    return (
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-[13px] leading-5 text-[#26323d]">
        <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ background: tierColor(tier) }} />
        {text}
      </span>
    );
  }
  const fill = key ? SEV_HEX[key] : NOT_TIERED.fill;
  return (
    <span className="inline-flex items-center whitespace-nowrap rounded-md px-[7px] py-[3px] text-[11px] font-extrabold leading-none" style={{ background: fill, color: onColor(fill) }}>
      {text}
    </span>
  );
}

/** A status: a dot and a word on a soft tint (`pill`), or the dot and the word alone for dense cells (`inline`). The word always
 *  says it; the colour never has to. Pick the tone with `tones.<kind>(status)`. */
export function StatusPill({ tone, children, title, variant = 'pill' }: {
  tone: Tone;
  children: ReactNode;
  title?: string;
  /** `inline`: no tint or outline, for a table cell (added to the contract) */
  variant?: 'pill' | 'inline';
}) {
  const c = TONE[tone];
  const dot = <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: c.dot }} />;
  return variant === 'inline' ? (
    <span title={title} className="inline-flex items-center gap-1.5 whitespace-nowrap text-[12px] font-semibold leading-4" style={{ color: c.text }}>
      {dot}
      {children}
    </span>
  ) : (
    <span
      title={title}
      className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-[3px] text-[12px] font-semibold leading-4"
      style={{ background: c.tint, color: c.text, borderColor: c.border }}
    >
      {dot}
      {children}
    </span>
  );
}

/** A residual grade: A and B green, C blue, D amber, E and F red. "B 42" with a score; "Not scored" without a grade. */
export function GradePill({ grade, score, prefix }: {
  grade?: string | null;
  score?: number | null;
  /** a word in front ("Grade B"), for a record header (added to the contract) */
  prefix?: string;
}) {
  const letter = String(grade ?? '').trim().toUpperCase();
  if (!letter) return <span className="whitespace-nowrap text-[13px] leading-5 text-[#64707e]">Not scored</span>;
  const hasScore = typeof score === 'number' && Number.isFinite(score);
  const shown = [prefix, letter, hasScore ? String(Math.round(score * 10) / 10) : null].filter(Boolean).join(' ');
  return <StatusPill tone={tones.grade(letter)} title={hasScore ? `Residual score ${Math.round(score * 10) / 10}` : undefined}>{shown}</StatusPill>;
}

/** A finding's or signal's severity on the same ramp as a tier: `solid` (default) the chip, `solid={false}` the soft one. */
export function SeverityChip({ severity, solid = true }: { severity?: string | null; solid?: boolean }) {
  const key = tierKey(severity);
  const info = String(severity ?? '').trim().toLowerCase() === 'info';
  const label = key ? tierLabel(key) : info ? 'Info' : 'Unrated';
  const hue = key ? SEV_HEX[key] : info ? SEV_HEX.info : NOT_TIERED.dot;
  if (solid) {
    const fill = key || info ? hue : NOT_TIERED.fill;
    return (
      <span className="inline-flex items-center whitespace-nowrap rounded-md px-[7px] py-[3px] text-[11px] font-extrabold leading-none" style={{ background: fill, color: onColor(fill) }}>
        {label}
      </span>
    );
  }
  const soft = SOFT[key ?? 'none'];
  return (
    <span
      className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-semibold leading-4"
      style={{ background: soft.tint, color: soft.text, borderColor: soft.border }}
    >
      <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: hue }} />
      {label}
    </span>
  );
}

// An avatar's slot: a tint and the ink that reads on it, from the six status families and the brand teal.
const AVATARS = [TONE.progress, TONE.pending, TONE.warning, TONE.danger, TONE.success, { tint: '#E6F6F3', text: '#0F766E' }];

/** A person: round initials in a colour that is theirs everywhere, then the name. No name: the amber `emptyLabel`. */
export function PersonChip({ name, emptyLabel = 'Unassigned', size = 'md' }: { name?: string | null; emptyLabel?: string; size?: 'sm' | 'md' }) {
  const who = String(name ?? '').trim();
  if (!who) return <span className="whitespace-nowrap text-[13px] font-medium leading-5" style={{ color: TONE.warning.text }}>{emptyLabel}</span>;
  const px = size === 'sm' ? 20 : 28;
  const c = AVATARS[avatarIndex(who, AVATARS.length)];
  return (
    <span className="inline-flex min-w-0 items-center gap-2">
      <span
        aria-hidden
        className="grid shrink-0 place-items-center rounded-full font-semibold leading-none"
        style={{ width: px, height: px, fontSize: size === 'sm' ? 9 : 11, background: c.tint, color: c.text }}
      >
        {initials(who)}
      </span>
      <span className="truncate text-[13px] leading-5 text-[#26323d]">{who}</span>
    </span>
  );
}
