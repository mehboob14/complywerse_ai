// node --test "src/lib/auditorPortal/portalModel.test.ts"
// The Auditor Portal's models: the front door lists the journeys with the most waiting first and says where each count opens; a journey with no files has no
// "0% decided"; the journey page lives in its address and the three old tab names still land somewhere; the queue's chips are the server's counts; the Summary
// reads the same numbers as the Frameworks page; the queue links into Frameworks and copies none of its tabs.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { readAddress, writeAddress } from '../addressState.ts';
import {
  ADDRESS, controlLine, counterTarget, decidedShare, fileSize, frameworksHref, journeyHref, lastPage, matchJourneys, noun, openKey, orderJourneys, parseOpen, queueChips,
  openObservations, rowHref, skipFor, summaryFigures, upgradeLegacyAddress, waitingOf, waitingTotal, type JourneyCard, type QueueCounts,
} from './portalModel.ts';

const card = (id: number, name: string, filesPending: number, scopePending: number, extra: Partial<JourneyCard> = {}): JourneyCard => ({
  id, name, status: 'in_progress', framework: null, version: null,
  files: { pending: filesPending, approved: 0, rejected: 0, total: filesPending }, scope: { pending: scopePending, approved: 0, rejected: 0, total: scopePending },
  controls_total: 10, no_request: 0, ...extra,
});

test('the journeys with the most waiting come first; a finished journey sinks below a running one with the same load; then by name', () => {
  const list = orderJourneys([card(1, 'PCI DSS', 2, 0), card(2, 'ISO 27001', 9, 3), card(3, 'Old audit', 2, 0, { status: 'completed' }), card(4, 'Another', 2, 0)]);
  assert.deepEqual(list.map((c) => c.name), ['ISO 27001', 'Another', 'PCI DSS', 'Old audit']);
  assert.equal(waitingOf(card(1, 'x', 4, 2)), 6);
});

test('the search finds a journey by its name or its framework and ignores case', () => {
  const list = [card(1, 'Annual certification', 0, 0, { framework: 'ISO 27001' }), card(2, 'PDPL transfer', 0, 0)];
  assert.deepEqual(matchJourneys(list, ' iso ').map((c) => c.id), [1]);
  assert.deepEqual(matchJourneys(list, '').map((c) => c.id), [1, 2]);
  assert.deepEqual(matchJourneys(list, 'zzz'), []);
});

test('a journey with no files has no decided share, not 0%', () => {
  assert.equal(decidedShare({ files: { pending: 0, approved: 0, rejected: 0, total: 0 } }), null);
  assert.equal(decidedShare({ files: { pending: 5, approved: 3, rejected: 2, total: 10 } }), 50);
});

test('a count opens the queue of the one journey that has such work, else the list of journeys', () => {
  const one = [card(7, 'ISO', 3, 0), card(8, 'PCI', 0, 2)];
  assert.equal(counterTarget('files', one), '/auditor-portal/7');
  assert.equal(counterTarget('scope', one), '/auditor-portal/8?kind=scope');
  assert.equal(counterTarget('files', [card(1, 'a', 1, 0), card(2, 'b', 1, 0)]), '#journeys');
  assert.equal(counterTarget('files', [card(1, 'a', 0, 0)]), '#journeys');
});

test('a row of "Do now" opens its journey at the right list with its sheet open', () => {
  assert.equal(rowHref({ journey_id: 4, kind: 'file', id: 21 }), '/auditor-portal/4?open=file-21');
  assert.equal(rowHref({ journey_id: 4, kind: 'scope', id: 9 }), '/auditor-portal/4?kind=scope&open=scope-9');
  assert.equal(journeyHref(4, { tab: 'decisions' }), '/auditor-portal/4?tab=decisions');
  assert.equal(journeyHref(4), '/auditor-portal/4');
});

test('the open sheet is kept in the address and a made-up one is nothing', () => {
  assert.deepEqual(parseOpen(openKey('scope', 12)), { type: 'scope', id: 12 });
  assert.equal(parseOpen('file-x'), null);
  assert.equal(parseOpen('../../etc'), null);
  assert.equal(parseOpen(undefined), null);
});

test('the journey page reads and writes its state in the address, and the plain address is the Queue of files', () => {
  assert.deepEqual(readAddress(ADDRESS, ''), { tab: 'queue', kind: 'files', q: '', result: 'all', page: 1, open: '' });
  assert.equal(writeAddress(ADDRESS, '', readAddress(ADDRESS, '')), '');
  const s = readAddress(ADDRESS, '?tab=decisions&result=rejected&page=3&q=policy');
  assert.deepEqual([s.tab, s.result, s.page, s.q], ['decisions', 'rejected', 3, 'policy']);
  assert.equal(readAddress(ADDRESS, '?tab=nonsense&kind=everything&page=-4').tab, 'queue');
  assert.equal(readAddress(ADDRESS, '?page=-4').page, 1);
});

test('the three tabs the page had before still land: overview is the Summary, controls the scope requests, evidence the files', () => {
  assert.equal(upgradeLegacyAddress('?tab=overview'), 'tab=summary');
  assert.equal(upgradeLegacyAddress('?tab=controls'), 'kind=scope');
  assert.equal(upgradeLegacyAddress('?tab=evidence&q=mfa'), 'q=mfa');
  assert.equal(upgradeLegacyAddress('?tab=decisions'), null, 'a current tab needs no change');
  assert.equal(upgradeLegacyAddress(''), null);
  assert.equal(upgradeLegacyAddress('?tab=constructor'), null);
});

test('the chips are the server\'s counts, and what waits is files plus requests (not the requirements nobody asked about)', () => {
  const counts: QueueCounts = {
    files: { pending: 12, approved: 5, rejected: 2, total: 19 }, scope: { pending: 4, approved: 3, rejected: 1, total: 8, in_scope: 2, out_of_scope: 1 },
    untouched: 37, untouched_manual: 6, decided: 11,
  };
  assert.deepEqual(queueChips(counts).map((c) => [c.kind, c.count]), [['files', 12], ['scope', 4], ['untouched', 37]]);
  assert.equal(waitingTotal(counts), 16);
  assert.equal(waitingTotal(null), 0);
  assert.deepEqual(queueChips(null).map((c) => c.count), [0, 0, 0]);
});

test('the Summary reads the same numbers as the Frameworks page and does not count a missing answer as zero', () => {
  const counts: QueueCounts = {
    files: { pending: 1, approved: 3, rejected: 0, total: 4 }, scope: { pending: 0, approved: 0, rejected: 0, total: 0, in_scope: 0, out_of_scope: 0 }, untouched: 5, untouched_manual: 0, decided: 3,
  };
  const f = summaryFigures(counts, { total_controls: 100, implemented_count: 40, verified_count: 10, not_applicable_count: 20, approved_evidence_controls: 60 });
  assert.equal(f.journey?.applicable, 80);
  assert.equal(f.journey?.implementedPct, 50, 'implemented already holds the verified ones: 40 of 80, not 50 of 80');
  assert.equal(f.journey?.readyPct, 75);
  assert.equal(f.band, 'strong');
  assert.equal(f.filesApproved, 75);
  assert.equal(f.scopeDecided, null, 'no requests is no share');
  assert.equal(f.waiting, 1);
  const waiting = summaryFigures(counts, null);
  assert.equal(waiting.journey, null);
  assert.equal(waiting.band, null);
});

test('the queue links into the Frameworks workspace by the journey id and the journey\'s own requirement row; it has no tabs of its own for them', () => {
  assert.equal(frameworksHref(5), '/frameworks/5');
  assert.equal(frameworksHref(5, 'scope'), '/frameworks/5?tab=scope');
  assert.equal(frameworksHref(5, 'controls', 88), '/frameworks/5?tab=controls&req=88');
  assert.equal(frameworksHref(5, 'artifacts', null), '/frameworks/5?tab=artifacts');
});

test('small sentences: the requirement as one line, a file size, paging arithmetic', () => {
  assert.equal(controlLine({ ref: 'A.8.2', title: 'Privileged access rights' }), 'A.8.2 Privileged access rights');
  assert.equal(controlLine({ ref: null, title: 'Only a title' }), 'Only a title');
  assert.equal(controlLine(null), 'A requirement');
  assert.deepEqual([fileSize(512), fileSize(2048), fileSize(5 * 1024 * 1024), fileSize(null)], ['512 B', '2.0 KB', '5.0 MB', '—']);
  assert.deepEqual([skipFor(1, 50), skipFor(3, 50), skipFor(0, 50), lastPage(101, 50), lastPage(0, 50)], [0, 100, 0, 3, 1]);
  assert.deepEqual([noun(1, 'file', 'files'), noun(1240, 'file', 'files')], ['1 file', '1,240 files']);
});

test('open observations are the ones not in a final status of the tenant own settings; no counts is no answer, not zero', () => {
  const levels = [{ key: 'open' }, { key: 'in_progress' }, { key: 'complied' }, { key: 'closed', terminal: true }, { key: 'cancelled', terminal: true }];
  assert.equal(openObservations({ counts_by_status: { open: 4, in_progress: 2, complied: 1, closed: 30, cancelled: 3 }, status_levels: levels }), 7);
  assert.equal(openObservations({ counts_by_status: { under_review: 5, closed: 2 }, status_levels: levels }), 5, 'a status the tenant added counts as open until it is made final');
  assert.equal(openObservations({ counts_by_status: {}, status_levels: levels }), 0, 'an empty register has none open');
  assert.equal(openObservations({}), null);
  assert.equal(openObservations(null), null);
});
