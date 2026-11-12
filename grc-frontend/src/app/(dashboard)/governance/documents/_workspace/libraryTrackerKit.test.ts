// node --test "src/app/(dashboard)/governance/documents/_workspace/libraryTrackerKit.test.ts"
// The guard of the Tracker's files (TrackerView, tracker/*, NeedsYou, HowItWorks, PlainTerm and the models behind them), read from the sources like libraryKit.test.ts does for the rest of the
// folder: the kit's token rules (no named size, palette colour, hex, named shadow or radius, nothing under 12px), no bare <p>/<h2>/<h3>/<td>/<th> (the platform CSS gives those 11.5px), the room
// decides the layout (no breakpoint variant, no viewport height), no control that appears only on hover, no native dialog, no model or vendor name; and what makes the Tracker cheap for a
// library of thousands: every group and every row is a disclosure button (aria-expanded), a group is closed until pressed, a page of rows asks for its own lines, a document's detail is mounted
// (and asks the server) only while its row is open, there is no "open every document", and the requests are made in ONE place (tracker/useTrackerData.ts), never by a view.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { findViolations } from '../../../../../components/ui/ds/kitRules.ts';

const DIR = new URL('./', import.meta.url);
const read = (name: string) => readFileSync(new URL(name, DIR), 'utf8');
const VIEWS = ['TrackerView.tsx', 'NeedsYou.tsx', 'HowItWorks.tsx', 'PlainTerm.tsx', 'tracker/TrackerGroup.tsx', 'tracker/TrackerRow.tsx', 'tracker/TrackerDetail.tsx', 'tracker/TrackerStepper.tsx'];
const MODELS = ['libraryTracker.ts', 'libraryNeedsYou.ts', 'glossary.ts', 'tracker/lineModel.ts', 'tracker/detailModel.ts'];
const DATA = ['tracker/useTrackerData.ts'];
const code = (line: string) => line.replace(/(^|\s)\/\/\s.*$/, '$1').replace(/^\s*(\*|\/\*)/, '');

test('the Tracker files hold the kit\'s token rules', () => {
  const found: string[] = [];
  for (const name of [...VIEWS, ...MODELS, ...DATA]) for (const v of findViolations(read(name))) found.push(`${name}:${v.line} ${v.rule} ${v.text}`);
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

test('no screen names a model or a vendor, says "in force", or shows an id; a view makes no request of its own: the requests are in tracker/useTrackerData.ts', () => {
  for (const name of [...VIEWS, ...MODELS, ...DATA]) {
    const src = read(name).split(/\r?\n/).map(code).join('\n');
    assert.ok(!/\b(gpt|openai|anthropic)\b/i.test(src), name);
    assert.ok(!/(['"`>])[^'"`<]*\bin force\b/i.test(src), `${name} says "in force"`);
  }
  for (const name of [...VIEWS, ...MODELS]) assert.ok(!/useQuery|apiClient|\bfetch\(|useMutation/.test(read(name)), name);
  const data = read(DATA[0]);
  assert.ok(data.includes('useQuery') && !/useMutation|\.post\(|\.put\(|\.delete\(|\.patch\(/.test(data), 'the Tracker only reads');
  assert.ok(!/\.(post|put|delete|patch)\(/.test(read('../../../../../lib/documentTrackerApi.ts')), 'every call of the Tracker is a GET');
});

test('closed by default and built for a library of thousands: groups and rows are disclosure buttons, a page of rows asks for its own lines, the detail is mounted (and asks) only while its row is open', () => {
  const view = read('TrackerView.tsx'), group = read('tracker/TrackerGroup.tsx'), row = read('tracker/TrackerRow.tsx'), data = read('tracker/useTrackerData.ts');
  assert.ok(view.includes('useState<ReadonlySet<GroupId>>(() => new Set())') && view.includes('useState<ReadonlySet<number>>(() => new Set())'), 'nothing is open at first');
  assert.ok(group.includes('aria-expanded={open}') && row.includes('aria-expanded={open}'), 'a group and a row say whether they are open');
  assert.ok(group.includes('<h3') && group.includes('<button') && group.includes('aria-controls'), 'the group header is a button inside a heading');
  assert.ok(group.includes('open ? pagesOf(group.docs, shown) : []'), 'a closed group draws no row');
  assert.ok(group.includes('RowsPage') && group.includes('useTrackerLines(ids)'), 'a page of rows asks for its own lines, once');
  assert.ok(group.includes('ROWS_AT_A_TIME') && group.includes('Show ${formatCount(more)} more'), 'rows come a page at a time with "Show more"');
  assert.ok(row.includes('{open && (') && row.includes('<TrackerDetail'), 'the detail exists only while the row is open');
  assert.ok(data.includes('enabled: open') && data.includes('enabled: open && attests') && data.includes("enabled: open && doc.status === 'exception_applied'"), 'a document\'s detail is asked only while open, and only the parts that apply');
  assert.ok(data.includes('enabled: ids.length > 0') && data.includes("queryKey: ['gov-tracker-sets']"), 'one answer of sets for the whole library');
  // groups can be opened all together; documents never: there is no "open every document"
  assert.ok(view.includes('Open all groups') && view.includes('Close all groups'));
  for (const name of VIEWS) assert.ok(!/Expand all|Open all documents|Open all rows/i.test(read(name)), name);
  assert.ok(!/setOpenRows\(\(s\) => new Set\(docs/.test(view) && !/setOpenRows\(new Set\(/.test(view), 'no control opens every row');
});

test('the person’s own work stays first: the strip is the inbox\'s, capped at five; the Tracker keeps the library\'s filters, search and sort (it is given the documents that match)', () => {
  const view = read('TrackerView.tsx');
  assert.ok(view.includes('docs: readonly GovDoc[]') && view.includes('buildGroups(docs, ctx)'));
  assert.ok(read('libraryNeedsYou.ts').includes('NEEDS_YOU_LIMIT = 5'));
});

test('every state of the strip is drawn: loading, failed (with Retry), empty, content, and a source that could not be refreshed', () => {
  const strip = read('NeedsYou.tsx');
  for (const word of ["work.state === 'loading'", "work.state === 'unavailable'", "work.state === 'empty'", "work.state === 'content'", '<ErrorState compact', 'Nothing needs you', 'onRetry', 'could not be refreshed']) assert.ok(strip.includes(word), word);
});

test('every state of the Tracker is drawn: sorting while the sets load, a notice with Retry when they could not be read, a page of lines that could not be read (with Retry), a detail part that is loading or failed', () => {
  const view = read('TrackerView.tsx'), group = read('tracker/TrackerGroup.tsx'), detail = read('tracker/TrackerDetail.tsx'), row = read('tracker/TrackerRow.tsx');
  assert.ok(view.includes('SkeletonRows') && view.includes('Holds and proposed changes could not be loaded') && view.includes('sets.refetch()'));
  assert.ok(group.includes("Couldn't load who these wait on") && group.includes('q.refetch()'));
  assert.ok(row.includes('lineState') && row.includes('<Skeleton'));
  assert.ok(detail.includes("Couldn't load ${SOURCE_WORDS") && detail.includes('retry[f.source') && detail.includes('Loading'));
});

test('the stepper is never colour alone: a mark, a word for a screen reader, and aria-current on the step the document is at', () => {
  const stepper = read('tracker/TrackerStepper.tsx');
  assert.ok(stepper.includes("aria-current={i === firstHere ? 'step' : undefined}") && stepper.includes('sr-only') && stepper.includes('AlertTriangle') && stepper.includes('Check'));
  assert.ok(stepper.includes('aria-label={label}'));
});
