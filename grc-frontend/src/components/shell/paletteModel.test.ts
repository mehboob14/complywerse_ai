// node --test src/components/shell/paletteModel.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { LIMITS, highlightParts, matchTier, moveOption, paletteView, type ActionDef, type PaletteInput, type RecordHit, type RecordSource } from './paletteModel.ts';

const none: RecordSource = { status: 'ready', hits: [] };
const doc = (n: number, title = `Document ${n}`): RecordHit => ({ id: `d${n}`, label: title, sub: 'Policy v1.0', href: `/governance/documents/${n}`, kind: 'document' });
const ACTIONS: ActionDef[] = [
  { id: 'new-document', label: 'New document', sub: 'Governance · Library', icon: 'plus' },
  { id: 'ai-draft', label: 'AI Draft', sub: 'Governance · Comply AI Studio', icon: 'sparkles' },
  { id: 'pin-page', label: 'Pin this page', sub: 'Shortcut', icon: 'pin' },
  { id: 'mark-read', label: 'Mark all notifications read', sub: 'Notifications', icon: 'check' },
  { id: 'guide', label: 'Toggle guide markers', sub: 'Help', icon: 'help' },
  { id: 'ask', label: 'Ask Comply Agent', sub: 'AI assistant', icon: 'sparkles' },
];
const base = (over: Partial<PaletteInput> = {}): PaletteInput => ({
  query: '', pages: [], records: { documents: none, committees: none, meetings: none }, pending: [], acknowledgements: 0, pins: [], recent: [], actions: ACTIONS, ...over,
});
const names = (v: ReturnType<typeof paletteView>) => v.groups.map((g) => `${g.name}:${g.options.length}`);

test('nothing typed: the queue (3 items and the acknowledgements), what is pinned, what was opened last, a few actions without "Ask"', () => {
  const pending = [1, 2, 3, 4, 5].map((i) => ({ key: `k${i}`, title: `Approve ${i}`, sub: 'To approve · Due in 2 d', href: `/governance/documents/${i}` }));
  const pins = [1, 2, 3, 4, 5, 6].map((i) => ({ label: `Pin ${i}`, href: `/p/${i}` }));
  const recent = [1, 2, 3, 4, 5, 6, 7].map((i) => ({ label: `Recent ${i}`, href: `/r/${i}`, sub: 'Document' }));
  const v = paletteView(base({ pending, acknowledgements: 150, pins, recent }));
  assert.deepEqual(names(v), [`Needs my action:${LIMITS.pending + 1}`, `Pinned:${LIMITS.pins}`, `Recent:${LIMITS.recent}`, `Actions:${LIMITS.emptyActions}`]);
  assert.equal(v.groups[0].options[LIMITS.pending].label, 'To acknowledge: 150');
  assert.equal(v.groups[0].options[LIMITS.pending].href, '/needs-my-action?section=ack');
  assert.ok(!v.options.some((o) => o.action === 'ask'), 'with no question there is nothing to ask');
  assert.equal(new Set(v.options.map((o) => o.id)).size, v.options.length, 'ids are unique');
  assert.deepEqual(v.options.map((o) => o.id), v.options.map((_, i) => `po-${i}`), 'in screen order');
});

test('nothing typed and nothing to show: an empty palette still offers the actions', () => {
  const v = paletteView(base());
  assert.deepEqual(names(v), [`Actions:${LIMITS.emptyActions}`]);
  assert.equal(paletteView(base({ actions: [] })).options.length, 0);
});

test('a query: pages and records (the better match first), the queue items that match, and the actions with "Ask Comply Agent" last', () => {
  const pages = [{ path: '/governance/documents', label: 'Documents', sub: 'Governance' }, { path: '/governance/reviews', label: 'Document Reviews', sub: 'Governance' }];
  const records = { documents: { status: 'ready' as const, hits: [doc(1, 'Remote Work Policy'), doc(2, 'Remote Access Standard')], total: 2 }, committees: none, meetings: none };
  const pending = [{ key: 'a', title: 'Remote Work Policy', sub: 'To approve · Overdue 2 d', href: '/x/1' }, { key: 'b', title: 'Vendor Standard', sub: 'To review', href: '/x/2' }];
  const v = paletteView(base({ query: 'remote work', pages, records, pending }));
  assert.deepEqual(names(v), ['Needs my action:1', 'Records:2', 'Pages:2', 'Actions:1'], 'the document that is the query comes before the pages that only share a word');
  assert.equal(v.groups[0].options[0].label, 'Remote Work Policy');
  const actions = v.groups.find((g) => g.name === 'Actions')!.options;
  assert.equal(actions[actions.length - 1].label, 'Ask Comply Agent: “remote work”');
  assert.equal(actions[actions.length - 1].action, 'ask');
  // typing the name of a page puts the pages above the records that merely contain it
  const p = paletteView(base({ query: 'documents', pages, records: { documents: { status: 'ready', hits: [doc(3, 'Third-party Documents Register')], total: 1 }, committees: none, meetings: none } }));
  assert.deepEqual(p.groups.map((g) => g.name), ['Pages', 'Records', 'Actions']);
  // typing a document's name puts the document first
  const r = paletteView(base({ query: 'remote work policy', pages: [{ path: '/erm/risks', label: 'Risk Register', sub: 'Risk' }], records }));
  assert.deepEqual(r.groups.map((g) => g.name), ['Records', 'Pages', 'Actions']);
});

test('actions are matched on their words; "Ask Comply Agent" is always there when it is offered, and absent when the person cannot use it', () => {
  const v = paletteView(base({ query: 'pin' }));
  assert.deepEqual(v.groups.find((g) => g.name === 'Actions')!.options.map((o) => o.action), ['pin-page', 'ask']);
  const v2 = paletteView(base({ query: 'new doc' }));
  assert.deepEqual(v2.groups.find((g) => g.name === 'Actions')!.options.map((o) => o.action), ['new-document', 'ask']);
  const noAsk = paletteView(base({ query: 'pin', actions: ACTIONS.filter((a) => a.id !== 'ask') }));
  assert.deepEqual(noAsk.groups.find((g) => g.name === 'Actions')!.options.map((o) => o.action), ['pin-page']);
  assert.deepEqual(paletteView(base({ query: 'zzzz', actions: ACTIONS.filter((a) => a.id !== 'ask') })).options, [], 'nothing matches, nothing is listed: the view says so');
});

test('each record source fails or loads alone: the pages and the other sources keep working', () => {
  const pages = [{ path: '/governance/committees', label: 'Committees', sub: 'Governance' }];
  const failed = paletteView(base({ query: 'audit', pages, records: { documents: { status: 'failed', hits: [] }, committees: { status: 'ready', hits: [{ id: 'c1', label: 'Audit Committee', sub: 'Board committee', href: '/governance/committees/1', kind: 'committee' }] }, meetings: none } }));
  assert.deepEqual(failed.notices, [{ source: 'documents', text: 'Documents could not be searched.' }]);
  assert.deepEqual(failed.groups.map((g) => g.name), ['Records', 'Pages', 'Actions'], 'the committee record and the page are still listed');
  assert.equal(failed.searching, false);
  const loading = paletteView(base({ query: 'audit', pages, records: { documents: { status: 'loading', hits: [] }, committees: none, meetings: { status: 'loading', hits: [] } } }));
  assert.equal(loading.searching, true);
  assert.equal(loading.groups.find((g) => g.name === 'Records')?.note, 'Searching…');
  assert.ok(loading.groups.find((g) => g.name === 'Pages'), 'the page is listed while the records load');
  const idle = paletteView(base({ query: '', records: { documents: { status: 'failed', hits: [] }, committees: none, meetings: none } }));
  assert.deepEqual(idle.notices, [], 'nothing was asked with nothing typed');
});

test('the documents that match are counted when more match than are listed', () => {
  const hits = [1, 2, 3, 4, 5].map((i) => doc(i, `Policy ${i}`));
  const v = paletteView(base({ query: 'policy', records: { documents: { status: 'ready', hits, total: 1248 }, committees: none, meetings: none } }));
  assert.equal(v.documentsTotal, 1248);
  assert.equal(v.groups.find((g) => g.name === 'Records')!.options.length, 3, 'three documents are listed, the rest sit behind the library link');
  assert.equal(paletteView(base({ query: 'policy' })).documentsTotal, 0);
});

test('matchTier: equal, starts with, a word starts with, inside, no; accents and case do not matter', () => {
  assert.equal(matchTier('Remote Work Policy', 'remote work policy'), 0);
  assert.equal(matchTier('Remote Work Policy', 'remote'), 1);
  assert.equal(matchTier('Remote Work Policy', 'work'), 2);
  assert.equal(matchTier('Remote Work Policy', 'ork'), 3);
  assert.equal(matchTier('Remote Work Policy', 'zebra'), 4);
  assert.equal(matchTier('Café Zürich', 'cafe'), 1);
  assert.equal(matchTier('anything', '   '), 4);
});

test('highlightParts marks exactly what matched, by the label as written; no match or no query marks nothing', () => {
  assert.deepEqual(highlightParts('Remote Work Policy', 'work'), [{ text: 'Remote ', hit: false }, { text: 'Work', hit: true }, { text: ' Policy', hit: false }]);
  assert.deepEqual(highlightParts('Remote Work Policy', 'remote'), [{ text: 'Remote', hit: true }, { text: ' Work Policy', hit: false }]);
  assert.deepEqual(highlightParts('Remote Work Policy', 'policy'), [{ text: 'Remote Work ', hit: false }, { text: 'Policy', hit: true }]);
  assert.deepEqual(highlightParts('Café Zürich', 'zuri'), [{ text: 'Café ', hit: false }, { text: 'Züri', hit: true }, { text: 'ch', hit: false }]);
  assert.deepEqual(highlightParts('Remote', ''), [{ text: 'Remote', hit: false }]);
  assert.deepEqual(highlightParts('Remote', 'zzz'), [{ text: 'Remote', hit: false }]);
  assert.equal(highlightParts('الْمَخَاطِر', 'المخاطر').map((p) => p.text).join(''), 'الْمَخَاطِر', 'the label is never altered, whatever the folding did');
  assert.equal(highlightParts('x'.repeat(300), 'x').map((p) => p.text).join('').length, 300);
});

test('the arrow keys wrap, Home and End go to the ends, other keys are not the list\'s', () => {
  assert.equal(moveOption(5, -1, 'ArrowDown'), 0);
  assert.equal(moveOption(5, 4, 'ArrowDown'), 0);
  assert.equal(moveOption(5, 0, 'ArrowUp'), 4);
  assert.equal(moveOption(5, -1, 'ArrowUp'), 4);
  assert.equal(moveOption(5, 2, 'Home'), 0);
  assert.equal(moveOption(5, 2, 'End'), 4);
  assert.equal(moveOption(5, 2, 'a'), null);
  assert.equal(moveOption(0, 0, 'ArrowDown'), null);
});
