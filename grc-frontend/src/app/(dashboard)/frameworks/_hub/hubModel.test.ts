// node --test "src/app/(dashboard)/frameworks/_hub/hubModel.test.ts"
// The rules of the Frameworks hub: the library that is listed, the join of a framework to its journey and its onboarding, the ONE state of a row, the quick views and their counts,
// who needs attention, the order of a list, the search, the board, the one next step of a row and the figures of the posture tiles (which are the journey model's, golden here).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { targetState } from '../../../../lib/journeyModel.ts';
import {
  boardColumns, canStartAnother, compareKinds, dueText, todayDay, currentJourney, dedupeFrameworks, authorityOf, frameworkIdOf, haystack, headMeta, hubTiles, inQuick, journeyRows, kindLabel, kindOf, libraryRows, listedLibrary,
  needsAttention, nextSort, nextStep, quickCounts, searchTerms, sortFor, sortRows, stageOf, stripCertificationPostfix, typeLabel, DEFAULT_SORT,
  type HubRow, type JourneyItem, type LibraryItem, type OnboardingRow,
} from './hubModel.ts';

const TODAY = new Date(2026, 10, 8);                                        // 8 Nov 2026

/** A journey payload the way the journey function sends it: `implemented_count` already holds the verified ones. */
const progress = (total: number, implemented: number, approved: number, extra: Record<string, number> = {}) => ({
  total_controls: total, implemented_count: implemented, verified_count: 0, in_progress_count: 0, not_started_count: total - implemented,
  not_applicable_count: 0, approved_evidence_controls: approved, ...extra,
});
const journey = (id: number, fw: number, status: string, over: Partial<JourneyItem> = {}): JourneyItem => ({
  id, uploaded_framework_id: fw, name: `Framework ${fw} Certification`, status, started_at: `2026-0${id}-01T09:00:00`, target_date: null, progress: progress(100, 50, 40), ...over,
});
const fw = (id: number, name: string, over: Partial<LibraryItem> = {}): LibraryItem => ({
  id, name, version: '1', framework_type: 'iso', upload_status: 'classified', classification: 'certification', certification_body: 'BSI', parsed_controls_count: 93, ...over,
});
const ob = (id: number, state: OnboardingRow['state'], over: Partial<OnboardingRow> = {}): OnboardingRow => ({ uploaded_framework_id: id, onboarding_id: state === 'not_started' ? null : id * 10, state, progress: null, ...over });

const LIB = [fw(1, 'ISO 27001 Certification'), fw(2, 'PCI DSS', { classification: 'compliance', regulatory_authority: 'PCI SSC', certification_body: null, framework_type: 'pci_dss' }), fw(3, 'NCA ECC', { classification: 'compliance', regulatory_authority: 'NCA', framework_type: 'other' }), fw(4, 'SOC 2'), fw(5, 'GDPR', { classification: null, certification_body: null })];

test('names: the library says "ISO 27001 Certification", the hub says "ISO 27001"; kind, type and authority are read the way the pages always read them', () => {
  assert.equal(stripCertificationPostfix('ISO 27001 Certification'), 'ISO 27001');
  assert.equal(stripCertificationPostfix('  Certification of Origin '), 'Certification of Origin', 'only a trailing word');
  assert.deepEqual(['certification', 'Compliance', null, '', ' Regulatory '].map(kindOf), ['certification', 'compliance', 'other', 'other', 'regulatory']);
  assert.deepEqual(['certification', 'regulatory', 'other'].map(kindLabel), ['Certification', 'Regulatory', 'Not classified'], 'the other classifications of the library are named, not lumped together');
  assert.deepEqual(['other', 'voluntary', 'compliance', 'certification', 'regulatory'].sort(compareKinds), ['certification', 'compliance', 'regulatory', 'voluntary', 'other']);
  assert.equal(typeLabel('pci_dss'), 'PCI DSS');
  assert.equal(typeLabel('weird_thing'), 'Weird thing');
  assert.equal(typeLabel('regulatory'), 'Regulatory', 'a type the platform has no acronym for is said as a word, not shouted');
  assert.equal(authorityOf(fw(1, 'A')), 'BSI', 'a certification: its body');
  assert.equal(authorityOf(fw(2, 'B', { classification: 'compliance', regulatory_authority: 'NCA', certification_body: 'BSI' })), 'NCA', 'a compliance framework: its regulator');
  assert.equal(authorityOf(fw(3, 'C', { certification_body: null })), null, 'neither recorded: not recorded');
});

test('the library that is listed: one framework per name and version (the better-read copy wins), the ones not read yet are counted and left out', () => {
  const copies = [fw(1, 'ISO 27001 Certification', { upload_status: 'parsed' }), fw(9, 'ISO 27001', { upload_status: 'classified' }), fw(2, 'PCI DSS', { upload_status: 'draft' }), fw(3, 'NCA ECC', { upload_status: 'classifying' })];
  assert.deepEqual(dedupeFrameworks(copies).map((f) => f.id).sort(), [2, 3, 9], 'classified beats parsed');
  const { listed, notReady } = listedLibrary(copies);
  assert.deepEqual(listed.map((f) => f.id), [9]);
  assert.equal(notReady, 2, 'said on the page: "2 frameworks are not read yet"');
  const same = dedupeFrameworks([fw(1, 'A', { created_at: '2026-01-01' }), fw(2, 'A', { created_at: '2026-02-01' })]);
  assert.deepEqual(same.map((f) => f.id), [2], 'equally read: the newer one');
});

test('a journey belongs to the framework it was started from; the one that stands for a framework is the newest with work in it, else the newest of all', () => {
  assert.equal(frameworkIdOf({ uploaded_framework_id: 7, framework_id: 3 }), 7);
  assert.equal(frameworkIdOf({ uploaded_framework_id: null, framework_id: 3 }), 3);
  assert.equal(frameworkIdOf({}), null);
  const done = journey(1, 1, 'completed');
  const live = journey(2, 1, 'in_progress');
  const held = journey(3, 1, 'on_hold');
  assert.equal(currentJourney([done, live, held])?.id, 3, 'two with work in them: the newest');
  assert.equal(currentJourney([done, journey(4, 1, 'cancelled')])?.id, 4, 'none with work: the newest');
  assert.equal(currentJourney([]), null);
});

test('Journeys: a row per journey (every one of them: nothing is deduplicated), with the facts of its framework and the figures of the journey function', () => {
  const rows = journeyRows([journey(1, 1, 'in_progress', { target_date: '2026-11-20T00:00:00' }), journey(2, 1, 'completed'), journey(3, 99, 'in_progress')], LIB, TODAY);
  assert.equal(rows.length, 3, 'two journeys of one framework are two rows');
  const a = rows[0];
  assert.deepEqual([a.scope, a.name, a.kind, a.authority, a.requirements, a.inLibrary, a.state], ['journeys', 'Framework 1', 'certification', 'BSI', 93, true, 'in_progress']);
  assert.equal(a.numbers?.readyPct, 40);
  assert.equal(a.numbers?.implementedPct, 50);
  assert.equal(a.target.state, 'soon');
  const orphan = rows[2];
  assert.deepEqual([orphan.inLibrary, orphan.kind, orphan.authority, orphan.requirements], [false, 'other', null, null], 'a framework the library did not list: unknown, not invented');
  const noFigures = journeyRows([journey(5, 1, 'in_progress', { progress: undefined })], LIB, TODAY)[0];
  assert.equal(noFigures.numbers, null, 'a payload without progress has no figures: never zeros');
});

test('the stage of a framework without a journey is the stage of its onboarding; an unreadable register is "not known", never "no journey yet"', () => {
  assert.deepEqual(stageOf(null, true), { state: 'idle', note: null });
  assert.deepEqual(stageOf(ob(1, 'not_started'), true), { state: 'idle', note: null });
  assert.deepEqual(stageOf(ob(1, 'draft', { progress: { done: 4, total: 9 } }), true), { state: 'onboarding', note: '4 of 9 required answers' });
  assert.deepEqual(stageOf(ob(1, 'draft'), true), { state: 'onboarding', note: 'Draft' });
  assert.deepEqual(stageOf(ob(1, 'ready'), true), { state: 'onboarding', note: 'Waiting for approval' });
  assert.deepEqual(stageOf(ob(1, 'complete'), true), { state: 'ready', note: 'Onboarding approved' });
  assert.deepEqual(stageOf(ob(1, 'underway'), true), { state: 'ready', note: 'Marked as already underway' });
  assert.deepEqual(stageOf(undefined, false), { state: 'unknown', note: null });
});

test('Library: a row per framework, joined to the journey that stands for it and to its onboarding; a framework with a journey has its journey\'s state', () => {
  const journeys = [journey(1, 1, 'in_progress'), journey(2, 4, 'completed')];
  const register = [ob(2, 'draft', { progress: { done: 1, total: 4 } }), ob(3, 'ready'), ob(5, 'complete')];
  const rows = libraryRows(LIB, journeys, register, TODAY);
  assert.deepEqual(rows.map((r) => [r.id, r.state]), [[1, 'in_progress'], [2, 'onboarding'], [3, 'onboarding'], [4, 'completed'], [5, 'ready']]);
  assert.equal(rows[0].numbers?.readyPct, 40);
  assert.equal(rows[1].numbers, null, 'no journey: no figures');
  assert.equal(rows[1].stateNote, '1 of 4 required answers');
  assert.equal(rows[0].name, 'ISO 27001');
  assert.deepEqual(libraryRows(LIB, [], null, TODAY).map((r) => r.state), ['unknown', 'unknown', 'unknown', 'unknown', 'unknown'], 'the register failed: not known');
  assert.deepEqual(libraryRows(LIB, [journey(1, 1, 'in_progress')], null, TODAY).slice(0, 2).map((r) => r.state), ['in_progress', 'unknown'], 'a journey is a fact the register is not needed for');
});

test('quick views and their counts: what a chip says is what pressing it shows', () => {
  const journeys = [
    journey(1, 1, 'in_progress', { target_date: '2026-11-01T00:00:00' }),                 // overdue
    journey(2, 2, 'in_progress', { target_date: '2027-06-01T00:00:00' }),
    journey(3, 3, 'on_hold'),
    journey(4, 4, 'completed', { target_date: '2026-01-01T00:00:00' }),                   // finished: late does not matter
    journey(5, 5, 'not_started', { target_date: '2026-12-01T00:00:00' }),                 // due within 30 days
  ];
  const rows = journeyRows(journeys, LIB, TODAY);
  assert.deepEqual(quickCounts(rows, 'journeys'), { all: 5, attention: 3, in_progress: 2, not_started: 1, on_hold: 1, completed: 1 });
  assert.deepEqual(rows.filter((r) => needsAttention(r)).map((r) => r.id), [1, 3, 5], 'overdue, on hold, due within 30 days; never a finished one');
  const lib = libraryRows(LIB, [journey(1, 1, 'in_progress'), journey(2, 4, 'completed')], [ob(2, 'draft'), ob(3, 'complete')], TODAY);
  assert.deepEqual(quickCounts(lib, 'library'), { all: 5, idle: 1, onboarding: 1, ready: 1, running: 1, completed: 1 });
  assert.equal(lib.filter((r) => inQuick('running', r)).length, lib.filter((r) => ['in_progress', 'not_started', 'on_hold'].includes(r.state)).length);
});

test('sorting: "needs attention first" is late, due soon, on hold, working, finished (the least ready first inside a group); a row without the value goes last either way', () => {
  const journeys = [
    journey(1, 1, 'in_progress', { progress: progress(100, 90, 90) }),
    journey(2, 2, 'in_progress', { target_date: '2026-11-01T00:00:00', progress: progress(100, 60, 60) }),
    journey(3, 3, 'on_hold'),
    journey(4, 4, 'completed'),
    journey(5, 5, 'in_progress', { progress: progress(100, 10, 10) }),
    journey(6, 1, 'in_progress', { target_date: '2026-11-20T00:00:00' }),
  ];
  const rows = journeyRows(journeys, LIB, TODAY);
  assert.deepEqual(sortRows(rows, DEFAULT_SORT.journeys).map((r) => r.id), [2, 6, 3, 5, 1, 4]);
  const twoSoon = journeyRows([journey(1, 1, 'in_progress', { target_date: '2026-11-29T00:00:00' }), journey(2, 2, 'in_progress', { target_date: '2026-11-12T00:00:00', progress: progress(100, 90, 90) })], LIB, TODAY);
  assert.deepEqual(sortRows(twoSoon, DEFAULT_SORT.journeys).map((r) => r.id), [2, 1], 'both due soon: the nearer date first, whatever their readiness');
  const byReady = sortRows(rows, { key: 'ready', dir: 'asc' }).map((r) => r.id);
  assert.equal(byReady[0], 5, 'least ready first');
  assert.deepEqual(byReady.slice(1, 3).sort(), [3, 6], 'equally ready: by name');
  assert.deepEqual(sortRows(rows, { key: 'target', dir: 'asc' }).map((r) => r.id).slice(0, 2), [2, 6], 'soonest first');
  const noTarget = sortRows(rows, { key: 'target', dir: 'desc' }).map((r) => r.id);
  assert.deepEqual(noTarget.slice(-4).sort(), [1, 3, 4, 5], 'the rows without a target date are last whichever way the column runs');
  const lib = libraryRows(LIB, [], [ob(1, 'complete'), ob(2, 'draft')], TODAY);
  assert.deepEqual(sortRows(lib, DEFAULT_SORT.library).map((r) => r.name), ['GDPR', 'ISO 27001', 'NCA ECC', 'PCI DSS', 'SOC 2']);
  assert.deepEqual(sortRows(lib, { key: 'state', dir: 'asc' }).map((r) => r.state).slice(0, 2), ['ready', 'onboarding'], 'by state: furthest on the way first');
});

test('a header turns the order round, and a second turn goes back to the register\'s own; a sort of the other register is no sort here', () => {
  const d = DEFAULT_SORT.journeys;
  assert.deepEqual(nextSort('journeys', d, 'ready'), { key: 'ready', dir: 'asc' });
  assert.deepEqual(nextSort('journeys', { key: 'ready', dir: 'asc' }, 'ready'), { key: 'ready', dir: 'desc' });
  assert.deepEqual(nextSort('journeys', { key: 'ready', dir: 'desc' }, 'ready'), d);
  assert.deepEqual(nextSort('journeys', d, 'started'), { key: 'started', dir: 'desc' }, 'dates start newest first');
  assert.deepEqual(sortFor('library', { key: 'ready', dir: 'asc' }), DEFAULT_SORT.library);
  assert.deepEqual(sortFor('library', { key: 'authority', dir: 'desc' }), { key: 'authority', dir: 'desc' });
  assert.deepEqual(sortFor('journeys', null), DEFAULT_SORT.journeys);
});

test('search looks at the name, type, kind, authority, version and the state in words; every word must be found', () => {
  const rows = libraryRows(LIB, [journey(1, 1, 'in_progress')], [ob(3, 'complete')], TODAY);
  const find = (q: string) => rows.filter((r) => searchTerms(q).every((t) => haystack(r).includes(t))).map((r) => r.id);
  assert.deepEqual(find('pci'), [2]);
  assert.deepEqual(find('bsi'), [1, 4], 'authority');
  assert.deepEqual(find('ready to start'), [3], 'the state as the person reads it');
  assert.deepEqual(find('certification bsi'), [1, 4]);
  assert.deepEqual(find('nothing like this'), []);
});

test('the board has the columns of the register; a column nobody is in appears only when it is a core one', () => {
  const journeys = [journey(1, 1, 'in_progress'), journey(2, 2, 'in_progress'), journey(3, 3, 'on_hold'), journey(4, 4, 'cancelled')];
  const board = boardColumns('journeys', journeyRows(journeys, LIB, TODAY));
  assert.deepEqual(board.map((c) => [c.id, c.rows.length]), [['not_started', 0], ['in_progress', 2], ['on_hold', 1], ['completed', 0], ['cancelled', 1]]);
  const lib = boardColumns('library', libraryRows(LIB, [journey(1, 1, 'in_progress')], null, TODAY));
  assert.deepEqual(lib.map((c) => c.id), ['idle', 'onboarding', 'ready', 'running', 'completed', 'unknown']);
  assert.equal(lib.find((c) => c.id === 'running')?.rows.length, 1);
  assert.equal(lib.find((c) => c.id === 'unknown')?.rows.length, 4);
  assert.equal(lib.reduce((n, c) => n + c.rows.length, 0), 5, 'every row is on the board');
});

test('the one next step of a row follows the gate: start the onboarding, continue it, open it, start the journey, or open the journey', () => {
  const lib = libraryRows(LIB, [journey(1, 1, 'in_progress'), journey(4, 4, 'completed')], [ob(2, 'draft'), ob(3, 'ready'), ob(5, 'underway')], TODAY);
  const step = (id: number) => nextStep(lib.find((r) => r.id === id) as HubRow);
  assert.deepEqual(step(1), { kind: 'open', label: 'Open journey', href: '/frameworks/1' });
  assert.deepEqual(step(2), { kind: 'onboarding', label: 'Continue onboarding', frameworkId: 2, onboardingId: 20, href: '/frameworks/onboarding/20' });
  assert.deepEqual(step(3), { kind: 'onboarding', label: 'Open onboarding', frameworkId: 3, onboardingId: 30, href: '/frameworks/onboarding/30' });
  assert.deepEqual(step(5), { kind: 'start', label: 'Start journey', frameworkId: 5 });
  assert.deepEqual(step(4), { kind: 'open', label: 'Open journey', href: '/frameworks/4' }, 'a finished journey opens');
  const idle = libraryRows([fw(8, 'New')], [], [], TODAY)[0];
  assert.deepEqual(nextStep(idle), { kind: 'onboarding', label: 'Start onboarding', frameworkId: 8, onboardingId: null, href: null });
  const unknown = libraryRows([fw(8, 'New')], [], null, TODAY)[0];
  assert.deepEqual(nextStep(unknown), { kind: 'start', label: 'Start journey', frameworkId: 8 }, 'the register could not be read: the server decides at Start');
  assert.deepEqual(nextStep(journeyRows([journey(7, 1, 'on_hold')], LIB, TODAY)[0]), { kind: 'open', label: 'Open journey', href: '/frameworks/7' });
  assert.equal(canStartAnother(lib.find((r) => r.id === 4) as HubRow), true, 'a finished journey: a new certification cycle may start');
  assert.equal(canStartAnother(lib.find((r) => r.id === 1) as HubRow), false);
  assert.equal(canStartAnother(journeyRows([journey(9, 1, 'completed')], LIB, TODAY)[0]), false, 'only on the Library');
});

test('posture tiles are the journey model\'s figures over the journeys with work in them: verified counted once, completed ones left out, missing payloads said and not counted', () => {
  const journeys = [
    journey(1, 1, 'in_progress', { progress: progress(100, 50, 40) }),
    journey(2, 2, 'in_progress', { progress: { ...progress(100, 30, 20), verified_count: 30, not_applicable_count: 20, not_started_count: 50 }, target_date: '2026-11-01T00:00:00' }),
    journey(3, 3, 'completed', { progress: progress(100, 100, 100) }),
    journey(4, 4, 'on_hold', { progress: undefined, target_date: '2026-11-25T00:00:00' }),
  ];
  const t = hubTiles(journeys, TODAY);
  assert.equal(t.counted, 2);
  assert.equal(t.missing, 1, 'the on-hold journey has no figures: said, not zero');
  assert.equal(t.completed, 1);
  assert.equal(t.applicable, 180, '100 + (100 - 20 out of scope)');
  assert.equal(t.implemented, 80, 'verified are already in implemented: never added');
  assert.equal(t.implementedPct, 44.4);
  assert.equal(t.readyPct, 33.3, '60 of 180 requirements have approved evidence');
  assert.equal(t.approved, 60);
  assert.equal(t.band, 'early', '33.3 is under the 50 line of Building and over the 25 line of Early');
  assert.equal(t.open, 100, 'requirements still to do on the counted journeys: 50 + 50 not started, none in progress');
  assert.deepEqual([t.dueSoon, t.overdue], [2, 1], 'overdue and due within 30 days among the journeys with work in them (a missing payload still has a date)');
  const none = hubTiles([], TODAY);
  assert.deepEqual([none.counted, none.readyPct, none.band], [0, 0, 'start']);
});

test('the line under the heading is true totals', () => {
  assert.equal(headMeta(7, 35), '7 journeys · 35 in the library');
  assert.equal(headMeta(1, 1), '1 journey · 1 in the library');
  assert.equal(headMeta(null, 35), '35 in the library');
  assert.equal(headMeta(0, null), '0 journeys');
});

test('the target date in words, and today as a calendar day of the viewer', () => {
  const t = (day: string | null, status = 'in_progress') => targetState(day, status, TODAY);
  assert.equal(dueText(t('2026-11-05')), 'Overdue by 3 days');
  assert.equal(dueText(t('2026-11-07')), 'Overdue by 1 day');
  assert.equal(dueText(t('2026-11-08')), 'Due today');
  assert.equal(dueText(t('2026-11-09')), 'Due in 1 day');
  assert.equal(dueText(t('2026-12-08')), 'Due in 30 days');
  assert.equal(dueText(t('2027-02-01')), null, 'far off: the date alone');
  assert.equal(dueText(t(null)), null);
  assert.equal(dueText(t('2026-01-01', 'completed')), null, 'a finished journey is never late');
  assert.equal(todayDay(new Date(2026, 10, 8, 23, 59)), '2026-11-08');
  assert.equal(todayDay(new Date(2026, 0, 3, 0, 1)), '2026-01-03');
});
