// node --test "src/app/(dashboard)/governance/documents/_workspace/libraryNumbers.test.ts"
// The words the library uses for how many documents it has: whole, they are what they have always been; cut (the server holds more than the 1,000 that were
// loaded), every one of them says what it is over and none implies the whole library was processed.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { exportTitle, resultText } from './libraryFiltersLogic.ts';
import {
  csvName, exportWords, foldersLine, headCount, isCut, loadedNotice, missingOpen, noMatch, pagerNoun, resultLine, shownOf, tileNoun, tilesNote,
} from './libraryNumbers.ts';

test('cut means the server holds more than came back; a total that is equal, smaller or unknown is not cut', () => {
  assert.equal(isCut(1000, 1240), true);
  assert.equal(isCut(1000, 1001), true);
  assert.equal(isCut(1000, 1000), false);
  assert.equal(isCut(41, 41), false);
  assert.equal(isCut(41, 12), false);
  assert.equal(isCut(41, null), false);
  assert.equal(isCut(41, undefined), false);
  assert.equal(isCut(41, Number.NaN), false);
  assert.equal(isCut(0, 0), false);
});

test('the notice above a cut library: what is shown out of what there is, and what the browser can and cannot do with it', () => {
  assert.equal(loadedNotice(41, 41), null);
  assert.equal(loadedNotice(41, undefined), null);
  const notice = loadedNotice(1000, 1240);
  assert.ok(notice);
  assert.equal(notice.title, 'Showing 1,000 of 1,240 documents');
  assert.equal(notice.detail, 'The library loads the 1,000 most recently updated documents. Search, filters, sorting, the summary figures and the CSV export work on these; '
    + 'the other 240 documents are not loaded, so they are not searched, counted or exported here.');
  assert.equal(loadedNotice(1000, 1001)?.detail.endsWith('the other document is not loaded, so it is not searched, counted or exported here.'), true);      // one left over
  assert.equal(loadedNotice(1000, 12_345)?.title, 'Showing 1,000 of 12,345 documents');
});

test('the facts after the page name: the count of the list as it was, and cut, what is loaded out of what exists', () => {
  assert.equal(headCount({ inList: 41, loaded: 45, total: 45 }), '41 documents');
  assert.equal(headCount({ inList: 1, loaded: 1, total: 1 }), '1 document');
  assert.equal(headCount({ inList: 0, loaded: 0, total: 0 }), '0 documents');
  assert.equal(headCount({ inList: 932, loaded: 1000, total: 1240 }), '1,000 of 1,240 documents loaded');
  assert.equal(headCount({ inList: 3, loaded: 1000, total: 1001 }), '1,000 of 1,001 documents loaded');
});

test('"12 of 48": not cut it is the line the filter bar always had; cut it names the loaded documents and the real total', () => {
  for (const [shown, scope, filtering] of [[12, 48, true], [48, 48, false], [1, 1, false], [0, 48, true]] as const) {
    assert.equal(resultLine({ shown, scope, filtering, loaded: 48, total: 48 }), resultText(shown, scope, filtering));
  }
  assert.equal(resultLine({ shown: 12, scope: 932, filtering: true, loaded: 1000, total: 1240 }), '12 of 932 documents in the 1,000 loaded (1,240 in all)');
  assert.equal(resultLine({ shown: 932, scope: 932, filtering: false, loaded: 1000, total: 1240 }), '932 documents in the 1,000 loaded (1,240 in all)');
  assert.equal(shownOf({ shown: 12, scope: 48, loaded: 48, total: 48 }), '12 of 48');
  assert.equal(shownOf({ shown: 1234, scope: 1500, loaded: 1500, total: 1500 }), '1,234 of 1,500');
  assert.equal(shownOf({ shown: 12, scope: 932, loaded: 1000, total: 1240 }), '12 of 932 in the 1,000 loaded');
});

test('the summary tiles and the pager name what they count only when the list is cut', () => {
  assert.equal(tilesNote(41, 41), null);
  assert.equal(tilesNote(1000, 1240), 'Counts cover the 1,000 loaded documents.');
  assert.equal(tileNoun(false), 'documents');
  assert.equal(tileNoun(true), 'loaded documents');
  assert.equal(pagerNoun(false), 'documents');
  assert.equal(pagerNoun(true), 'loaded documents');
  assert.equal(foldersLine({ folders: 6, documents: 128, loaded: 140, total: 140 }), '6 folders · 128 documents');
  assert.equal(foldersLine({ folders: 1, documents: 1, loaded: 1, total: 1 }), '1 folder · 1 document');
  assert.equal(foldersLine({ folders: 6, documents: 128, loaded: 1000, total: 1240 }), '6 folders · 128 documents in the 1,000 loaded');
});

test('the export button says how many documents go into the file out of how many there are, and the file name says it too', () => {
  assert.deepEqual(exportWords({ shown: 48, loaded: 48, total: 48, canExport: true }), { label: 'Export CSV', title: exportTitle(48, true) });
  assert.deepEqual(exportWords({ shown: 0, loaded: 48, total: 48, canExport: false }), { label: 'Export CSV', title: 'Nothing to export' });
  const cut = exportWords({ shown: 932, loaded: 1000, total: 1240, canExport: true });
  assert.equal(cut.label, 'Export 932 loaded of 1,240');
  assert.equal(cut.title, 'Exports the 932 documents shown, from the 1,000 loaded. The other 240 documents are not loaded, so they are not in the file.');
  assert.equal(exportWords({ shown: 1, loaded: 1000, total: 1001, canExport: true }).title, 'Exports the 1 document shown, from the 1,000 loaded. The other document is not loaded, so it is not in the file.');
  assert.deepEqual(exportWords({ shown: 0, loaded: 1000, total: 1240, canExport: false }), { label: 'Export loaded documents', title: 'Nothing to export' });
  assert.equal(csvName({ date: '2026-11-01', shown: 48, loaded: 48, total: 48 }), 'document-library-2026-11-01.csv');             // the name it always had
  assert.equal(csvName({ date: '2026-11-01', shown: 932, loaded: 1000, total: 1240 }), 'document-library-2026-11-01-932-loaded-of-1240.csv');
});

test('an empty result says "No match", and cut it says the documents that were not loaded were not searched', () => {
  assert.deepEqual(noMatch(41, 41), { title: 'No match' });
  assert.deepEqual(noMatch(1000, 1240), { title: 'No match in the 1,000 loaded documents', description: 'The other 240 documents are not loaded, so they are not searched.' });
  assert.equal(noMatch(1000, 1001).description, 'The other document is not loaded, so it is not searched.');
});

test('a link to a document the list does not hold is never silent: it says whether the list was cut', () => {
  assert.deepEqual(missingOpen({ id: 4021, loaded: 1000, total: 1240 }), { title: 'Document 4021 is not among the 1,000 loaded', detail: 'The library shows the 1,000 most recently updated of 1,240 documents. Open it on its own page.' });
  assert.deepEqual(missingOpen({ id: 7, loaded: 45, total: 45 }), { title: 'Document 7 is not in the library', detail: 'It may have been removed, or it is not one you can read.' });
  assert.deepEqual(missingOpen({ id: 7, loaded: 45, total: undefined }), { title: 'Document 7 is not in the library', detail: 'It may have been removed, or it is not one you can read.' });
});
