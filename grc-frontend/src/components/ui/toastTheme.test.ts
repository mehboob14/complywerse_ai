// node --test src/components/ui/toastTheme.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { TOAST_TEXT, TOAST_TONES } from './toastTheme.ts';

// WCAG 2.x contrast ratio of two #rrggbb colours.
function contrast(a: string, b: string): number {
  const lum = (hex: string) => {
    const [r, g, bl] = [1, 3, 5].map((i) => {
      const c = parseInt(hex.slice(i, i + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const hexes = (cls: string) => Array.from(cls.matchAll(/\[(#[0-9a-fA-F]{6})\]/g), (m) => m[1]);

test('every toast type has an opaque card colour', () => {
  assert.deepEqual(Object.keys(TOAST_TONES).sort(), ['error', 'info', 'success', 'warning']);
  for (const [type, tone] of Object.entries(TOAST_TONES)) {
    assert.equal(hexes(tone.bg).length, 1, `${type}: card needs one solid arbitrary colour`);
  }
});

test('title, message and close button meet WCAG AA (4.5:1) on every card; icons 3:1', () => {
  const text = [...hexes(TOAST_TEXT.title), ...hexes(TOAST_TEXT.message), ...hexes(TOAST_TEXT.close)];
  assert.equal(text.length, 4);
  for (const [type, tone] of Object.entries(TOAST_TONES)) {
    const [bg] = hexes(tone.bg);
    for (const fg of text) {
      assert.ok(contrast(fg, bg) >= 4.5, `${type}: ${fg} on ${bg} is ${contrast(fg, bg).toFixed(2)}:1`);
    }
    const [icon] = hexes(tone.iconColor);
    assert.ok(contrast(icon, bg) >= 3, `${type}: icon ${icon} on ${bg} is ${contrast(icon, bg).toFixed(2)}:1`);
  }
});

test('the toast uses no colour class the platform CSS repaints', () => {
  // globals.css forces these with !important: text-white -> #fff, bg-white -> #fff, text-slate/gray -> muted.
  const repainted = /(?:^|[\s'"])(?:hover:)?(?:text-white|bg-white|text-(?:slate|gray)-\d|bg-(?:slate|gray)-\d)/;
  const sources = [
    readFileSync(new URL('./Toast.tsx', import.meta.url), 'utf8'),
    readFileSync(new URL('../../cyber-assurance/components/ui/Toast.tsx', import.meta.url), 'utf8'),
    JSON.stringify({ TOAST_TEXT, TOAST_TONES }),
  ];
  for (const src of sources) assert.doesNotMatch(src, repainted);
});
