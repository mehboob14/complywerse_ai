// node --test "src/app/(dashboard)/governance/documents/_workspace/libraryTrackerKit.test.ts"
// The guard of the Tracker's files (TrackerView, NeedsYou, HowItWorks, PlainTerm and the models behind them), read from the sources like libraryKit.test.ts does for the rest of the folder:
// the kit's token rules (no named size, palette colour, hex, named shadow or radius, nothing under 12px), no bare <p>/<h2>/<h3>/<td>/<th> (the platform CSS gives those 11.5px), the room
// decides the layout (no breakpoint variant, no viewport height), no control that appears only on hover, no native dialog, no model or vendor name, and the strip and the cards make no
// request of their own (the strip reads the inbox, the cards read the library's rows).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { findViolations } from '../../../../../components/ui/ds/kitRules.ts';

const DIR = new URL('./', import.meta.url);
const read = (name: string) => readFileSync(new URL(name, DIR), 'utf8');
const VIEWS = ['TrackerView.tsx', 'NeedsYou.tsx', 'HowItWorks.tsx', 'PlainTerm.tsx'];
const MODELS = ['libraryTracker.ts', 'libraryNeedsYou.ts', 'glossary.ts'];
const code = (line: string) => line.replace(/(^|\s)\/\/\s.*$/, '$1').replace(/^\s*(\*|\/\*)/, '');

test('the Tracker files hold the kit\'s token rules', () => {
  const found: string[] = [];
  for (const name of [...VIEWS, ...MODELS]) for (const v of findViolations(read(name))) found.push(`${name}:${v.line} ${v.rule} ${v.text}`);
  assert.deepEqual(found, []);
});

test('no bare <p>, <h2>, <h3>, <td> or <th>: each names a text size (a constant it uses may carry it)', () => {
  const found: string[] = [];
  for (const name of VIEWS) {
    const src = read(name);
    for (const m of Array.from(src.matchAll(/<(p|h2|h3|td|th)\b([^>]*)>/g))) {
      const attrs = m[2];
      const named = /\{([A-Z_]+)\}/.exec(attrs);
      const text = named ? new RegExp(`const ${named[1]} = '([^']*)'`).exec(src)?.[1] ?? '' : attrs;
      if (!/text-ds-(title|section|body|label)/.test(text)) found.push(`${name}: <${m[1]}${attrs.slice(0, 60)}`);
    }
  }
  assert.deepEqual(found, []);
});

test('the room decides, not the window: no breakpoint variant and no viewport height; nothing is opacity-0 until hovered; no native dialog', () => {
  const found: string[] = [];
  for (const name of VIEWS) {
    read(name).split(/\r?\n/).forEach((line, i) => {
      const c = code(line);
      if (/(^|[\s"'`])(max-)?(sm|md|lg|xl|2xl):/.test(c)) found.push(`${name}:${i + 1} breakpoint variant`);
      if (/\b\d*(d|s|l)?vh\b|calc\(100v/.test(c)) found.push(`${name}:${i + 1} viewport height`);
      if (/opacity-0\b[^'"`]*group-(hover|focus)|group-(hover|focus)[^'"`]*opacity-(100|[1-9]\d)/.test(c)) found.push(`${name}:${i + 1} hover-only`);
      if (/\bwindow\.(confirm|alert|prompt)\s*\(/.test(c)) found.push(`${name}:${i + 1} native dialog`);
    });
  }
  assert.deepEqual(found, []);
});

test('no screen names a model or a vendor, and the strip and the cards read what the inbox and the library already hold: no request of their own', () => {
  for (const name of [...VIEWS, ...MODELS]) {
    assert.ok(!/\b(gpt|openai|anthropic)\b/i.test(read(name)), name);
    assert.ok(!/useQuery|apiClient|\bfetch\(/.test(read(name)), name);
  }
});

test('every card is one link: the title is a real link stretched over the card, the (i) notes and the owner sit above it', () => {
  const view = read('TrackerView.tsx');
  assert.ok(view.includes('after:absolute after:inset-0') && view.includes('href={env.hrefOf(doc.id)}') && view.includes('plainClick(e)'));
  assert.ok(view.includes('data-record-row={doc.id}'));
  assert.equal((view.match(/<Link\b/g) ?? []).length, 1);                               // one link, so one tab stop for each card
  assert.ok(view.includes('relative z-[1]'));
  // the steps are never colour alone: every step has a word for a screen reader and a mark
  assert.ok(view.includes('aria-current={s.state ===') && view.includes('sr-only'));
});

test('every state of the strip is drawn: loading, failed (with Retry), empty, content, and a source that could not be refreshed', () => {
  const strip = read('NeedsYou.tsx');
  for (const word of ["work.state === 'loading'", "work.state === 'unavailable'", "work.state === 'empty'", "work.state === 'content'", '<ErrorState compact', 'Nothing needs you', 'onRetry', 'could not be refreshed']) assert.ok(strip.includes(word), word);
});
