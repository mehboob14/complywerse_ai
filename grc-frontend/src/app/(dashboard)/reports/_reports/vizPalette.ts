// Chart tokens for the report builder.
//
// The categorical series order below is VALIDATED, not chosen by eye — it was run
// through the dataviz palette validator against this app's white chart surface:
//   all checks PASS · worst adjacent CVD ΔE 10.7 (protan) · normal-vision ΔE 19.6
// The ORDER is the colourblind-safety mechanism, not decoration. Do not reorder,
// and never generate a 9th hue — past 8 series we cap and point at the table view
// (see PivotChart). Two slots (magenta #e87ba4, yellow #eda100) sit below 3:1 on
// white, which is allowed here only because every chart ships a legend and has a
// full table-view twin (the pivot table) — that's the "relief rule".

export const SERIES = [
  '#0f9e84', // 1 teal (brand step — #1ed4b0 is too light for a white surface)
  '#eb6834', // 2 orange
  '#4a3aa7', // 3 violet
  '#e34948', // 4 red
  '#2a78d6', // 5 blue
  '#008300', // 6 green
  '#e87ba4', // 7 magenta
  '#eda100', // 8 yellow
];

export const MAX_SERIES = 8;   // hard ceiling — fold/cap past this, never cycle
export const MAX_SLICES = 6;   // pie: part-to-whole at a glance only
export const OTHER = '#94a3b8'; // slate-400 for a folded tail — never a 9th hue

/** Chart chrome. Text always wears ink tokens — never a series colour. */
export const INK = {
  primary: '#0f172a',   // slate-900
  secondary: '#475569', // slate-600
  muted: '#94a3b8',     // slate-400 — axis/tick labels
  grid: '#e2e8f0',      // slate-200 — hairline, solid (never dashed)
  surface: '#ffffff',
};

/** Colour follows the ENTITY, not its rank: the slot comes from the series' index
 *  in the unfiltered domain, so filtering never repaints the survivors. */
export function seriesColor(name: string, domain: string[]): string {
  const i = domain.indexOf(name);
  return i >= 0 && i < MAX_SERIES ? SERIES[i] : OTHER;
}

/** Sequential blue ramp (light → dark), from the dataviz palette — one hue, more
 *  = darker, for magnitude encodings (heatmap cells). Never a rainbow. */
export const SEQ = ['#e8f1fd', '#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#256abf', '#184f95', '#0d366b'];
export function heatColor(t: number): string {
  if (!Number.isFinite(t)) return '#f1f5f9';   // no value → neutral
  const i = Math.max(0, Math.min(SEQ.length - 1, Math.round(t * (SEQ.length - 1))));
  return SEQ[i];
}
/** Legible ink for text sitting on a heat cell of intensity `t`. */
export function heatInk(t: number): string {
  return Number.isFinite(t) && t > 0.5 ? '#ffffff' : INK.primary;
}
