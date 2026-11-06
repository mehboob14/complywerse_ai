// The design tokens as the style guide lists them, and the contrast rows it prints. Pure, so tokens.test.ts can check them against styles/tokens.css:
// every --ds-* token must be on the page, and every pair keeps its ratio. The values themselves are read live from the page's CSS (TokensSection),
// so the guide cannot show a colour the app does not use.
import { contrast } from '../../../../../lib/contrast.ts';
import { CONTROL, TEXT, TOKEN_PAIRS } from '../../../../../lib/dsTokenPairs.ts';

export interface Swatch { token: string; use: string }
export interface SwatchGroup { title: string; swatches: Swatch[] }

export const SWATCH_GROUPS: SwatchGroup[] = [
  {
    title: 'Brand',
    swatches: [
      { token: 'ds-primary', use: 'Filled buttons, the open tab\'s line, checked boxes' },
      { token: 'ds-primary-hover', use: 'A filled button under the pointer' },
      { token: 'ds-primary-active', use: 'A filled button while pressed' },
      { token: 'ds-on-primary', use: 'Words on a filled button' },
      { token: 'ds-primary-soft', use: 'The chosen row, link hover, the badge on the open tab' },
      { token: 'ds-primary-text', use: 'Teal words and icons on a light surface' },
      { token: 'ds-focus', use: 'The focus ring' },
    ],
  },
  {
    title: 'Neutrals',
    swatches: [
      { token: 'ds-bg', use: 'The page behind the cards' },
      { token: 'ds-surface', use: 'Cards, tables, inputs, dialogs' },
      { token: 'ds-surface-subtle', use: 'A table header, a read-only box' },
      { token: 'ds-surface-hover', use: 'A row or item under the pointer' },
      { token: 'ds-fg', use: 'Titles and values' },
      { token: 'ds-fg-body', use: 'Running text and cell text' },
      { token: 'ds-fg-muted', use: 'Help, labels, secondary words' },
      { token: 'ds-border', use: 'Hairlines between rows and around cards' },
      { token: 'ds-border-strong', use: 'The outline of a button' },
      { token: 'ds-border-control', use: 'The outline of an input (3:1 on its surface)' },
    ],
  },
  {
    title: 'Meaning',
    swatches: [
      { token: 'ds-danger', use: 'Errors and the destructive step' },
      { token: 'ds-danger-hover', use: 'A danger button under the pointer' },
      { token: 'ds-danger-soft', use: 'The tint behind an error' },
      { token: 'ds-danger-border', use: 'The outline of a danger button or bar' },
      { token: 'ds-on-danger', use: 'Words on a danger button' },
      { token: 'ds-warning', use: 'Needs a look' },
      { token: 'ds-warning-soft', use: 'The tint behind a warning' },
      { token: 'ds-success', use: 'Done, in force' },
      { token: 'ds-success-soft', use: 'The tint behind a success' },
      { token: 'ds-info', use: 'A note that is only for information' },
      { token: 'ds-info-soft', use: 'The tint behind a note' },
    ],
  },
  { title: 'Overlay', swatches: [{ token: 'ds-scrim', use: 'The dim layer behind a dialog' }] },
];

/** Tokens that are not colours: shown as the type scale, the shape, the sizes, the shadow and the ring. */
export const LAYOUT_TOKENS = [
  'ds-text-title', 'ds-text-section', 'ds-text-body', 'ds-text-label',
  'ds-leading-title', 'ds-leading-section', 'ds-leading-body', 'ds-leading-label',
  'ds-radius-control', 'ds-radius-card', 'ds-control-h', 'ds-control-h-sm', 'ds-shadow-pop', 'ds-ring',
];

export const ALL_SHOWN = SWATCH_GROUPS.flatMap((g) => g.swatches.map((s) => s.token)).concat(LAYOUT_TOKENS);

export interface PairRow {
  fg: string;
  bg: string;
  min: number;
  kind: 'words' | 'control';
  /** null while a value is missing or is not a hex colour */
  ratio: number | null;
  pass: boolean | null;
}

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/** Every pair of the contrast list with its ratio from the live token values (`values`: token name -> CSS value). */
export function pairRows(values: Readonly<Record<string, string>>, pairs: ReadonlyArray<readonly [string, string, number]> = TOKEN_PAIRS): PairRow[] {
  return pairs.map(([fg, bg, min]) => {
    const a = (values[fg] ?? '').trim();
    const b = (values[bg] ?? '').trim();
    const ratio = HEX.test(a) && HEX.test(b) ? contrast(a, b) : null;
    return { fg, bg, min, kind: min >= TEXT ? 'words' : 'control', ratio, pass: ratio === null ? null : ratio >= min };
  });
}

/** "14.1:1": cut, never rounded up, so 4.49 reads 4.4 and does not look like a pass. */
export function formatRatio(ratio: number | null): string {
  return ratio === null ? '—' : `${(Math.floor(ratio * 10) / 10).toFixed(1)}:1`;
}

export const needs = (min: number): string => `${min === CONTROL ? '3' : '4.5'}:1`;

/** The first pair a token takes part in, so its card can say what it is checked against; null for a decorative token. */
export function partnerOf(token: string, pairs: ReadonlyArray<readonly [string, string, number]> = TOKEN_PAIRS): { fg: string; bg: string; min: number } | null {
  const hit = pairs.find(([fg]) => fg === token) ?? pairs.find(([, bg]) => bg === token);
  return hit ? { fg: hit[0], bg: hit[1], min: hit[2] } : null;
}
