// The colours of every chart on an Overview, in one place. A chart is SVG, which cannot read a class, so each is the hex of a --ds token or of lib/status.ts TONE
// (the same colours the pills use). A dark theme, if the platform gets one, changes this file and nothing else.
//
//   SERIES      the eight categorical hues of the dataviz method, in its fixed order and never cycled (a ninth is folded into "Other"). Validated with
//               scripts/validate_palette.js (light, adjacent pairs: every gate passes; the three light hues under 3:1 on white carry a visible legend or label
//               and a table, which every chart here has). Use SERIES[0] when ONE series is the point and BRAND when a single series is the platform's own.
//   STATUS      a state is never a categorical hue: good / bad / warn / progress / pending / neutral are the tone dots of the status pills. A chart that
//               shows a state (done, overdue, breached) uses these, always with its word beside it.
//   RAMP        one hue, light to dark, for magnitude (a heatmap cell, a share of a whole): 5 steps of the brand teal.
import { TONE } from '../../../lib/status.ts';

export const INK = '#586472';            // --ds-fg-muted
export const INK_STRONG = '#1f2933';     // --ds-fg
export const GRID = '#e1e6eb';           // --ds-border
export const TRACK = '#e1e6eb';          // an empty bar: --ds-border
export const HOVER = '#f3f6f8';          // --ds-surface-hover
export const SURFACE = '#ffffff';        // --ds-surface
export const BRAND = '#0f766e';          // --ds-primary

export const SERIES = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'] as const;
/** The tail a chart folds into "Other", and anything with no hue of its own. */
export const OTHER = '#94a3b8';

export const STATUS = {
  good: TONE.success.dot,
  bad: TONE.danger.dot,
  warn: TONE.warning.dot,
  progress: TONE.progress.dot,
  pending: TONE.pending.dot,
  neutral: TONE.neutral.dot,
} as const;
export type StatusColor = keyof typeof STATUS;

/** Light to dark; the last two are dark enough for white text. */
export const RAMP = ['#e6f6f3', '#a9ddd4', '#5db6a9', '#0f766e', '#134e4a'] as const;

/** The categorical hue of the i-th series (never cycled: past the eighth it is OTHER). */
export const seriesColor = (index: number): string => (index >= 0 && index < SERIES.length ? SERIES[index] : OTHER);

/** The tooltip box every recharts chart uses (12px, the kit's border, radius and shadow). */
export const TIP = { fontSize: 12, border: '1px solid #e1e6eb', borderRadius: 8, boxShadow: '0 8px 24px rgba(15, 23, 42, 0.14)', color: '#1f2933' } as const;
/** The axis tick every recharts chart uses: 12px muted ink. */
export const AXIS = { fontSize: 12, fill: INK } as const;
