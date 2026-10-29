// Tier and severity: one ramp (Compliverse's SEV_HEX), the words, and which ink reads on which fill.
// Pure, so `node --test` runs tiers.test.ts against it.
import { SEV_HEX, TIER_ORDER } from '../_lib/tprmShared.ts';

export type TierKey = (typeof TIER_ORDER)[number];

/** A tier that has not been set is never a default tier: it gets its own quiet grey. */
export const NOT_TIERED = { label: 'Not tiered', fill: '#D0D5DD', dot: '#98A2B3' };

const INK_DARK = '#1F2933';
const INK_LIGHT = '#FFFFFF';

const channel = (v: number): number => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
function luminance(hex: string): number {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.replace(/./g, '$&$&') : h, 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}

/** WCAG contrast ratio of two #rrggbb colours (1 to 21). */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** The ink (white or near-black) that reads better on a fill. SEV_HEX is bright: white on its yellow is 1.9:1, so only the red takes white. */
export function onColor(fill: string): string {
  return contrast(fill, INK_LIGHT) >= contrast(fill, INK_DARK) ? INK_LIGHT : INK_DARK;
}

/** "critical" -> 'critical'; null, "untiered", anything unknown -> null (not tiered). */
export function tierKey(tier?: string | null): TierKey | null {
  const key = String(tier ?? '').trim().toLowerCase();
  return (TIER_ORDER as readonly string[]).includes(key) ? (key as TierKey) : null;
}

export const tierLabel = (tier?: string | null): string => {
  const key = tierKey(tier);
  return key ? key[0].toUpperCase() + key.slice(1) : NOT_TIERED.label;
};

/** The colour of a tier on a chart or a bar: its SEV_HEX, or the grey of "not tiered". */
export const tierColor = (tier?: string | null): string => {
  const key = tierKey(tier);
  return key ? SEV_HEX[key] : NOT_TIERED.dot;
};

export interface Soft { tint: string; text: string; border: string }

/** The soft chip of a severity: the ramp's own hues at 50 / 700 / 200 (words on the tint read at 4.5:1 or better). */
export const SOFT: Record<TierKey | 'none', Soft> = {
  critical: { tint: '#FEF2F2', text: '#B91C1C', border: '#FECACA' },
  high: { tint: '#FFF7ED', text: '#C2410C', border: '#FED7AA' },
  medium: { tint: '#FEFCE8', text: '#A16207', border: '#FDE68A' },
  low: { tint: '#F0FDF4', text: '#15803D', border: '#BBF7D0' },
  none: { tint: '#F0F2F5', text: '#566072', border: '#D1D7DF' },
};
