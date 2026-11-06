// node --test "src/lib/addressState.test.ts"
// The state of a page that lives in its address: what a name's values mean, what a state writes back, and what the hook promises. The rules are pure and
// tested here (repeated names, blanks, junk, unknown names, other params kept); the hook is read from source (there is no React renderer in this repo),
// and was checked in a browser on the style guide.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  flag, integer, listOf, oneOf, readAddress, sameAddressState, sortOf, text, writeAddress,
  type AddressState, type ParamSpec,
} from './addressState.ts';
import { parseLocation } from '../app/(dashboard)/governance/reviews/reviewsModel.ts';
import { monthKey, parseDay, parseMonth } from '../app/(dashboard)/governance/reviews/calendarModel.ts';

const STATUSES = ['draft', 'pending_review', 'approved'] as const;
const SCHEMA = {
  q: text(),
  status: oneOf(['all', 'draft', 'approved'], 'all'),
  tags: listOf(['policy', 'standard', 'procedure']),
  owners: listOf(),
  mine: flag(),
  page: integer(1, { min: 1 }),
  sort: sortOf(['title', 'updated'], { key: 'updated', dir: 'desc' }),
};
type State = AddressState<typeof SCHEMA>;
const DEFAULTS: State = { q: '', status: 'all', tags: [], owners: [], mine: false, page: 1, sort: { key: 'updated', dir: 'desc' } };
const read = (search: string): State => readAddress(SCHEMA, search);

// ── reading ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

test('an empty address, a bare "?" and a missing name are every name\'s default', () => {
  assert.deepEqual(read(''), DEFAULTS);
  assert.deepEqual(read('?'), DEFAULTS);
  assert.deepEqual(read('?unrelated=1'), DEFAULTS);
});

test('every kind of param reads what it means', () => {
  assert.deepEqual(read('?q=policy&status=draft&tags=policy,standard&owners=3,4&mine=1&page=3&sort=title:asc'), {
    q: 'policy', status: 'draft', tags: ['policy', 'standard'], owners: ['3', '4'], mine: true, page: 3, sort: { key: 'title', dir: 'asc' },
  });
});

test('junk is never a state the page cannot be in: it is the default', () => {
  assert.equal(read('?status=zzz').status, 'all');
  assert.equal(read('?status=').status, 'all');
  assert.equal(read('?page=abc').page, 1);
  assert.equal(read('?page=2.5').page, 1);
  assert.equal(read('?page=12abc').page, 1);
  assert.equal(read('?page=0').page, 1);                                              // below the minimum
  assert.equal(read('?page=-4').page, 1);
  assert.equal(read('?page=').page, 1);
  assert.equal(read('?page=99999999999999999999').page, 1);                           // not a safe integer
  assert.equal(read('?mine=maybe').mine, false);
  assert.deepEqual(read('?sort=title').sort, DEFAULTS.sort);                          // no direction
  assert.deepEqual(read('?sort=title:up').sort, DEFAULTS.sort);
  assert.deepEqual(read('?sort=owner:asc').sort, DEFAULTS.sort);                      // not a sortable key
  assert.deepEqual(read('?sort=title:asc:extra').sort, DEFAULTS.sort);
  assert.deepEqual(read('?sort=').sort, DEFAULTS.sort);
});

test('oneOf: any case and spaces, and the option as it is written in the schema', () => {
  assert.equal(read('?status=DRAFT').status, 'draft');
  assert.equal(read('?status=%20Approved%20').status, 'approved');
});

test('a repeated name: for a single value the first occurrence decides, as URLSearchParams.get does', () => {
  assert.equal(read('?status=draft&status=approved').status, 'draft');
  assert.equal(read('?status=zzz&status=approved').status, 'all');                    // the first is junk: the default, not the second
  assert.equal(read('?page=2&page=5').page, 2);
  assert.equal(read('?q=one&q=two').q, 'one');
  assert.equal(read('?mine=0&mine=1').mine, false);
});

test('a list: commas, repeated names, blanks and repeats are all one clean list in the order first seen', () => {
  assert.deepEqual(read('?owners=3,4').owners, ['3', '4']);
  assert.deepEqual(read('?owners=3&owners=4').owners, ['3', '4']);
  assert.deepEqual(read('?owners=3,4&owners=4,5').owners, ['3', '4', '5']);
  assert.deepEqual(read('?owners=%203%20,,4,').owners, ['3', '4']);                   // spaces trimmed, empty pieces dropped
  assert.deepEqual(read('?owners=a,a,b,a').owners, ['a', 'b']);
  assert.deepEqual(read('?owners=').owners, []);
  assert.deepEqual(read('?owners=,,,').owners, []);
});

test('a list with options keeps only the options', () => {
  assert.deepEqual(read('?tags=policy,junk,standard').tags, ['policy', 'standard']);
  assert.deepEqual(read('?tags=junk').tags, []);
  assert.deepEqual(read('?tags=Policy').tags, []);                                    // exact, like the ids a filter holds
});

test('a flag: 1 or true, any case; anything else is off', () => {
  for (const on of ['1', 'true', 'TRUE', ' 1 ']) assert.equal(read(`?mine=${encodeURIComponent(on)}`).mine, true, on);
  for (const off of ['0', 'false', '', 'yes', 'on', '2']) assert.equal(read(`?mine=${off}`).mine, false, off);
});

test('a sort: key and direction, any case; none is "no sort"', () => {
  assert.deepEqual(read('?sort=Title:ASC').sort, { key: 'title', dir: 'asc' });
  assert.deepEqual(read('?sort=updated:asc').sort, { key: 'updated', dir: 'asc' });
  assert.equal(read('?sort=none').sort, null);
});

test('free text is read as it is, spaces and all (the box shows what was typed)', () => {
  assert.equal(read('?q=data%20retention%20').q, 'data retention ');
  assert.equal(read('?q=a%26b%3Dc').q, 'a&b=c');
});

test('names the schema does not list are ignored, whatever they are called', () => {
  assert.deepEqual(read('?constructor=x&__proto__=y&toString=z&hasOwnProperty=1&open=7'), DEFAULTS);
  const prototype = readAddress({ a: text() }, '?__proto__=polluted');
  assert.equal(Object.keys(prototype).join(), 'a');
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
});

// ── writing ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

const write = (search: string, patch: Partial<State> = {}): string => writeAddress(SCHEMA, search, { ...read(search), ...patch });

test('the defaults have the plain address', () => {
  assert.equal(writeAddress(SCHEMA, '', DEFAULTS), '');
  assert.equal(write('?status=draft&page=3&mine=1', { status: 'all', page: 1, mine: false }), '');
});

test('a state writes only what is not the default, in the schema\'s order', () => {
  assert.equal(writeAddress(SCHEMA, '', { ...DEFAULTS, sort: { key: 'title', dir: 'asc' }, q: 'policy', mine: true }), 'q=policy&mine=1&sort=title%3Aasc');
  assert.equal(writeAddress(SCHEMA, '', { ...DEFAULTS, tags: ['policy', 'standard'], owners: ['3', '4'] }), 'tags=policy%2Cstandard&owners=3%2C4');
  assert.equal(writeAddress(SCHEMA, '', { ...DEFAULTS, page: 4, status: 'approved' }), 'status=approved&page=4');
});

test('every other param is kept, in its place, and a name the schema owns is replaced (never doubled)', () => {
  assert.equal(write('?id=7&status=draft&open=9', { status: 'approved' }), 'id=7&open=9&status=approved');
  assert.equal(write('?status=draft&status=approved&q=a&q=b', { q: 'c' }), 'q=c&status=draft');         // the repeats collapse into the one the state holds, in the schema's order
  assert.equal(write('?x=1&x=2&y=3', {}), 'x=1&x=2&y=3');                                                  // the page's names were defaults: only the others remain, repeats and all
});

test('free text is written trimmed, and a blank is nothing', () => {
  assert.equal(write('', { q: '  data retention  ' }), 'q=data+retention');
  assert.equal(write('?q=old', { q: '   ' }), '');
  assert.equal(write('?q=old', { q: '' }), '');
});

test('a value is encoded, so what is typed cannot break the address', () => {
  const search = write('', { q: 'a&b=c#d' });
  assert.equal(search, 'q=a%26b%3Dc%23d');
  assert.equal(read(search).q, 'a&b=c#d');
});

test('a sort that was cleared on a page that sorts by default is written as "none", and one that is the default is not written', () => {
  assert.equal(write('', { sort: null }), 'sort=none');
  assert.equal(write('?sort=title:asc', { sort: { key: 'updated', dir: 'desc' } }), '');
  const unsorted = { s: sortOf(['title'], null) };
  assert.equal(writeAddress(unsorted, '', { s: null }), '');                         // no sort is the default there
  assert.equal(writeAddress(unsorted, '', { s: { key: 'title', dir: 'desc' } }), 's=title%3Adesc');
  assert.equal(readAddress(unsorted, '').s, null);
});

test('a state read from an address and written back is the same state (round trip), whatever the address looked like', () => {
  for (const search of [
    '', '?q=policy', '?status=draft&page=2', '?tags=policy,standard&owners=3,4,5&mine=1&sort=title:asc', '?sort=none', '?q=a%20b&status=APPROVED&page=7',
    '?owners=3&owners=4&tags=standard', '?status=zzz&page=junk&mine=maybe',
  ]) {
    const state = read(search);
    assert.deepEqual(read(writeAddress(SCHEMA, '', state)), state, search);
  }
});

test('writing twice is writing once (one state, one address)', () => {
  const once = write('?id=7&mine=1&status=draft');
  assert.equal(writeAddress(SCHEMA, once, read(once)), once);
});

// ── the same state ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

test('two states are the same when they write the same address: what is typed with a trailing space is what the address keeps', () => {
  assert.equal(sameAddressState(SCHEMA, { ...DEFAULTS, q: 'policy ' }, { ...DEFAULTS, q: 'policy' }), true);
  assert.equal(sameAddressState(SCHEMA, { ...DEFAULTS, q: '  ' }, DEFAULTS), true);
  assert.equal(sameAddressState(SCHEMA, { ...DEFAULTS, page: 2 }, DEFAULTS), false);
  assert.equal(sameAddressState(SCHEMA, { ...DEFAULTS, tags: ['policy', 'standard'] }, { ...DEFAULTS, tags: ['standard', 'policy'] }), false);   // the order of a list is part of it
  assert.equal(sameAddressState(SCHEMA, read('?status=draft&q=a'), read('?q=a&status=DRAFT')), true);
});

// ── a custom param, and parity with the page that had its own hook ──────────────────────────────────────────────────────────────────────

test('a page can write its own param: a ParamSpec is just a default, a read and a write', () => {
  const day: ParamSpec<string | null> = { default: null, read: ([first]) => (first && /^\d{4}-\d{2}-\d{2}$/.test(first) ? first : undefined), write: (value) => (value ? [value] : []) };
  const schema = { day };
  assert.equal(readAddress(schema, '?day=2026-11-12').day, '2026-11-12');
  assert.equal(readAddress(schema, '?day=tomorrow').day, null);
  assert.equal(writeAddress(schema, '?a=1', { day: '2026-11-12' }), 'a=1&day=2026-11-12');
  assert.equal(writeAddress(schema, '?day=2026-11-12', { day: null }), '');
});

// The Reviews page keeps five params through its own hook (reviews/_useReviewsLocation.ts, not edited here). The kit's schema reads every address the same way, so that
// hook can be replaced by useAddressState when the pages are cleaned up. (How it WRITES depends on the door path and on the view: that stays the page's.)
test('the Reviews page\'s five params, read through a schema, mean what its own parser says', () => {
  const month: ParamSpec<{ year: number; month: number } | null> = {
    default: null,
    read: ([first]) => parseMonth(first ?? null) ?? undefined,
    write: (value) => (value ? [monthKey(value)] : []),
  };
  const day: ParamSpec<string | null> = { default: null, read: ([first]) => (parseDay(first ?? null) ? (first as string) : undefined), write: (value) => (value ? [value] : []) };
  const schema = {
    section: oneOf(['documents', 'actions'], 'documents'),
    view: oneOf(['list', 'calendar'], 'list'),
    tab: oneOf(['overdue', 'upcoming', 'all'], 'overdue'),
    month,
    day,
  };
  for (const search of [
    '', '?section=actions', '?view=calendar', '?view=CALENDAR&tab=Upcoming', '?tab=all&month=2026-11&day=2026-11-12', '?month=2026-13', '?month=junk&day=2026-02-30',
    '?section=nope&view=nope&tab=nope', '?tab=all&tab=upcoming', '?view=calendar&month=2026-02&day=2026-02-03&tab=overdue&extra=1',
  ]) {
    const mine = readAddress(schema, search);
    const theirs = parseLocation('/governance/reviews', search);
    assert.deepEqual(mine, { section: theirs.section, view: theirs.view, tab: theirs.tab, month: theirs.month, day: theirs.day }, search);
  }
});

// ── the hook ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

const hook = readFileSync('src/components/ui/ds/useAddressState.ts', 'utf8').replace(/\r\n/g, '\n').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');

test('the hook replaces the address (no history entry, null state so Next folds it into useSearchParams) unless it is asked to push', () => {
  assert.match(hook, /if \(options\?\.push\) window\.history\.pushState\(null, '', url\);\n\s*else window\.history\.replaceState\(null, '', url\);/);
  assert.doesNotMatch(hook, /router\.|useRouter/, 'no navigation: a filter change is not a page change');
});

test('the hook writes from the address as it is now, keeps the hash, and does nothing when the address would not change', () => {
  assert.match(hook, /writeAddress\(schema, window\.location\.search, next\)/);
  assert.match(hook, /window\.location\.pathname \+ \(query \? `\?\$\{query\}` : ''\) \+ window\.location\.hash/);
  assert.match(hook, /if \(url === window\.location\.pathname \+ window\.location\.search \+ window\.location\.hash\) return;/);
});

test('two changes in one event compose, and the address is the truth again only when it says something else than the page holds', () => {
  assert.match(hook, /const latest = useRef\(fromAddress\);/);
  assert.match(hook, /const next = \{ \.\.\.latest\.current, \.\.\.patch \};\n\s*latest\.current = next;\n\s*setState\(next\);/);        // shown at once, before the address is written
  assert.match(hook, /if \(sameAddressState\(schema, fromAddress, latest\.current\)\) return;/);
  assert.match(hook, /latest\.current = fromAddress;\n\s*setState\(fromAddress\);/);
});

test('it is exported from the kit index and the ui barrel, and the Tabs onChange is typed by its value so a typed setter needs no cast', () => {
  assert.match(readFileSync('src/components/ui/ds/index.ts', 'utf8'), /export \{ useAddressState, type AddressStateOptions \} from '\.\/useAddressState';/);
  assert.match(readFileSync('src/components/ui/index.ts', 'utf8'), /export \{ useAddressState, type AddressStateOptions \} from '\.\/ds\/useAddressState';/);
  const tabs = readFileSync('src/components/ui/ds/Tabs.tsx', 'utf8').replace(/\r\n/g, '\n');
  assert.match(tabs, /export interface TabsProps<K extends string = string> \{/);
  assert.match(tabs, /value: K;\n\s*\/\*\*[^\n]*\n\s*onChange: \(key: K\) => void;/);
  assert.match(tabs, /export function Tabs<K extends string = string>\(\{ tabs, value, onChange, ariaLabel, children, className \}: TabsProps<K>\)/);
  assert.match(readFileSync('src/components/ui/ds/useTabParam.ts', 'utf8'), /\): \[K, \(key: K\) => void\] \{/);                            // what useTabParam hands out
});

test('the statuses used above are what the schema takes (a typo in a schema option is a type error, not a silent default)', () => {
  const schema = { s: oneOf(STATUSES, 'draft') };
  assert.equal(readAddress(schema, '?s=approved').s, 'approved');
  assert.equal(readAddress(schema, '?s=expired').s, 'draft');
});
