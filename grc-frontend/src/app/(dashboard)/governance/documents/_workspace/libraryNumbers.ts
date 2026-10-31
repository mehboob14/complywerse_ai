// What the library says about how many documents it has, and over which ones. Pure (no React), so `node --test` runs libraryNumbers.test.ts against it.
//
// The library is one request for the 1,000 most recently updated documents (DocumentsWorkspace: fetchDocuments); the server reports the true total next to them.
// While that total is more than came back the list is CUT, and everything the browser works out from it (search, filters, sorts, the summary tiles, the folders, the
// CSV) covers the documents that were loaded and no others. Every number the page states says which it is over, and none implies that the whole library was
// processed. Not cut, the words are exactly what they have always been.
import { formatCount } from '../../../../../lib/format.ts';
import { exportTitle, resultText } from './libraryFiltersLogic.ts';

const n = formatCount;
const docs = (count: number): string => `${n(count)} ${count === 1 ? 'document' : 'documents'}`;
const rest = (loaded: number, total: number): number => Math.max(0, total - loaded);

/** The server holds more documents than came back: what the browser sorts, filters, counts and exports is only part of the library. */
export function isCut(loaded: number, total: number | null | undefined): total is number {
  return typeof total === 'number' && Number.isFinite(total) && total > loaded;
}

/** "the other 240 documents are not loaded, so they are not …" / "the other document is not loaded, so it is not …" */
function theOthers(loaded: number, total: number, what: string): string {
  const r = rest(loaded, total);
  return r === 1 ? `the other document is not loaded, so it is not ${what}` : `the other ${n(r)} documents are not loaded, so they are not ${what}`;
}

export interface Notice { title: string; detail: string }

/** The notice above the library when it is cut; null when everything is loaded (or the total is not known). */
export function loadedNotice(loaded: number, total: number | null | undefined): Notice | null {
  if (!isCut(loaded, total)) return null;
  return {
    title: `Showing ${n(loaded)} of ${docs(total)}`,
    detail: `The library loads the ${n(loaded)} most recently updated documents. Search, filters, sorting, the summary figures and the CSV export work on these; `
      + `${theOthers(loaded, total, 'searched, counted or exported here')}.`,
  };
}

/** The facts after the page's name: "41 documents"; cut, "1,000 of 1,240 documents loaded" (what is loaded, out of what exists). */
export function headCount({ inList, loaded, total }: { inList: number; loaded: number; total: number | null | undefined }): string {
  return isCut(loaded, total) ? `${n(loaded)} of ${docs(total)} loaded` : docs(inList);
}

/** What the filter bar says to a screen reader: "12 of 48 documents"; cut, "12 of 932 documents in the 1,000 loaded (1,240 in all)". */
export function resultLine({ shown, scope, filtering, loaded, total }: { shown: number; scope: number; filtering: boolean; loaded: number; total: number | null | undefined }): string {
  if (!isCut(loaded, total)) return resultText(shown, scope, filtering);
  return `${filtering ? `${n(shown)} of ` : ''}${docs(scope)} in the ${n(loaded)} loaded (${n(total)} in all)`;
}

/** The "12 of 48" beside the filter chips; cut, "12 of 932 in the 1,000 loaded". */
export function shownOf({ shown, scope, loaded, total }: { shown: number; scope: number; loaded: number; total: number | null | undefined }): string {
  return `${n(shown)} of ${n(scope)}${isCut(loaded, total) ? ` in the ${n(loaded)} loaded` : ''}`;
}

/** What the summary tiles count, named once under them when the list is cut. */
export function tilesNote(loaded: number, total: number | null | undefined): string | null {
  return isCut(loaded, total) ? `Counts cover the ${n(loaded)} loaded documents.` : null;
}
/** The noun a tile's accessible name counts: "41 documents" / "41 loaded documents". */
export const tileNoun = (cut: boolean): string => (cut ? 'loaded documents' : 'documents');

/** The noun after the pager's range: "1–25 of 112 documents" / "1–25 of 112 loaded documents". */
export const pagerNoun = (cut: boolean): string => (cut ? 'loaded documents' : 'documents');

/** The count beside the Folders view's controls: "6 folders · 128 documents"; cut, "… in the 1,000 loaded". */
export function foldersLine({ folders, documents, loaded, total }: { folders: number; documents: number; loaded: number; total: number | null | undefined }): string {
  const f = `${n(folders)} ${folders === 1 ? 'folder' : 'folders'}`;
  return `${f} · ${docs(documents)}${isCut(loaded, total) ? ` in the ${n(loaded)} loaded` : ''}`;
}

/** The export button: its words, and what it promises in full. Not cut: "Export CSV", "Exports the 48 documents shown" (as before). Cut: it names how many
 *  documents go into the file out of how many there are, and says the rest are not in it. */
export function exportWords({ shown, loaded, total, canExport }: { shown: number; loaded: number; total: number | null | undefined; canExport: boolean }): { label: string; title: string } {
  if (!isCut(loaded, total)) return { label: 'Export CSV', title: exportTitle(shown, canExport) };
  if (!canExport) return { label: 'Export loaded documents', title: 'Nothing to export' };
  return {
    label: `Export ${n(shown)} loaded of ${n(total)}`,
    title: `Exports the ${docs(shown)} shown, from the ${n(loaded)} loaded. ${theOthers(loaded, total, 'in the file').replace(/^the/, 'The')}.`,
  };
}

/** The file's name: `document-library-2026-11-01.csv`; cut, it says so: `document-library-2026-11-01-932-loaded-of-1240.csv` (a first line of notes would break the table). */
export function csvName({ date, shown, loaded, total }: { date: string; shown: number; loaded: number; total: number | null | undefined }): string {
  return isCut(loaded, total) ? `document-library-${date}-${shown}-loaded-of-${total}.csv` : `document-library-${date}.csv`;
}

/** What the register says when nothing matches. Cut, it says the search did not reach the documents that were not loaded. */
export function noMatch(loaded: number, total: number | null | undefined): { title: string; description?: string } {
  if (!isCut(loaded, total)) return { title: 'No match' };
  const r = rest(loaded, total);
  return {
    title: `No match in the ${n(loaded)} loaded documents`,
    description: `${r === 1 ? 'The other document is' : `The other ${n(r)} documents are`} not loaded, so ${r === 1 ? 'it is' : 'they are'} not searched.`,
  };
}

/** A link to `?open=<id>` that names a document the list does not hold. Never silent: say whether it is because the list was cut. */
export function missingOpen({ id, loaded, total }: { id: number; loaded: number; total: number | null | undefined }): Notice {
  return isCut(loaded, total)
    ? { title: `Document ${id} is not among the ${n(loaded)} loaded`, detail: `The library shows the ${n(loaded)} most recently updated of ${docs(total)}. Open it on its own page.` }
    : { title: `Document ${id} is not in the library`, detail: 'It may have been removed, or it is not one you can read.' };
}
