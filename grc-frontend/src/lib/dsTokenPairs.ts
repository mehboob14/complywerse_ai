// The colour pairs the kit can draw and the contrast each must keep: [words or mark, what they sit on, minimum ratio], by token name (styles/tokens.css, --ds-*).
// One list for two readers: dsTokens.test.ts asserts every pair against the token file, and the style guide (/admin/ui-kit) prints each ratio with a
// pass or a fail, so what the guide shows is exactly what the test holds.
export const TEXT = 4.5;      // words
export const CONTROL = 3;     // control outlines, the focus ring, a filled button against its surface

export const TOKEN_PAIRS: Array<[string, string, number]> = [
  ['ds-fg', 'ds-surface', TEXT], ['ds-fg', 'ds-bg', TEXT], ['ds-fg', 'ds-surface-subtle', TEXT], ['ds-fg', 'ds-surface-hover', TEXT],
  ['ds-fg-body', 'ds-surface', TEXT], ['ds-fg-body', 'ds-bg', TEXT], ['ds-fg-body', 'ds-surface-hover', TEXT],
  ['ds-fg-muted', 'ds-surface', TEXT], ['ds-fg-muted', 'ds-bg', TEXT], ['ds-fg-muted', 'ds-surface-subtle', TEXT], ['ds-fg-muted', 'ds-surface-hover', TEXT], ['ds-fg-muted', 'ds-border', TEXT],
  ['ds-on-primary', 'ds-primary', TEXT], ['ds-on-primary', 'ds-primary-hover', TEXT], ['ds-on-primary', 'ds-primary-active', TEXT],
  ['ds-primary-text', 'ds-surface', TEXT], ['ds-primary-text', 'ds-primary-soft', TEXT], ['ds-primary-text', 'ds-surface-hover', TEXT], ['ds-primary-text', 'ds-bg', TEXT],
  ['ds-danger', 'ds-surface', TEXT], ['ds-danger', 'ds-danger-soft', TEXT], ['ds-on-danger', 'ds-danger', TEXT], ['ds-on-danger', 'ds-danger-hover', TEXT],
  ['ds-warning', 'ds-surface', TEXT], ['ds-warning', 'ds-warning-soft', TEXT],
  ['ds-success', 'ds-surface', TEXT], ['ds-success', 'ds-success-soft', TEXT],
  ['ds-info', 'ds-surface', TEXT], ['ds-info', 'ds-info-soft', TEXT],
  // controls: an input's outline, the focus ring and a filled button must be seen against what they sit on
  ['ds-border-control', 'ds-surface', CONTROL], ['ds-border-control', 'ds-bg', CONTROL],
  ['ds-focus', 'ds-surface', CONTROL], ['ds-focus', 'ds-bg', CONTROL],
  ['ds-primary', 'ds-surface', CONTROL], ['ds-primary', 'ds-bg', CONTROL],
];
