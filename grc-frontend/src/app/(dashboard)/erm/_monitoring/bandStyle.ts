// The look of a score band, once, for the heat map's cells and tiles and the aggregation chart: the platform's priority tones (the same four as the severity words), so a band is
// the same colour wherever it is drawn. Colour never carries a band alone: every use also writes the word or the range (lib/erm/band.ts BAND_LABEL, BAND_RANGE).
import { TONE, type Tone } from '../../../../lib/status.ts';
import type { Band } from '../../../../lib/erm/band.ts';

export const BAND_TONE: Readonly<Record<Band, Tone>> = { critical: 'danger', high: 'warning', medium: 'progress', low: 'neutral' };
export const bandColors = (band: Band) => TONE[BAND_TONE[band]];

/** Chart tokens as hex (an SVG attribute cannot read a class): --ds-fg-muted, --ds-border, --ds-surface-hover, --ds-fg. */
export const INK = '#586472';
export const GRID = '#e1e6eb';
export const HOVER = '#f3f6f8';
export const TIP = { fontSize: 12, border: '1px solid #e1e6eb', borderRadius: 8, boxShadow: '0 8px 24px rgba(15, 23, 42, 0.14)', color: '#1f2933' };
