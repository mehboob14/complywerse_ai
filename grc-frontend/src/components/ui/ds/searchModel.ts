// What a DebouncedSearch decides, apart from React so `node --test` can pin it (searchModel.test.ts): how long the person must stop typing before the list is
// asked, which text counts as a query, when a typed draft is worth asking for at all, and when a change of the page's own query (a "Clear filters" button, a
// link with a query in its address) must overwrite what is in the box. The component is DebouncedSearch.tsx.

/** Quiet time before the list is asked, in ms: long enough that "retention" is one request, not nine; short enough to feel immediate. */
export const SEARCH_DELAY = 300;

/** The text a query is made of: what was typed without the spaces at either end ("  retention " asks for "retention"). The box keeps what was typed. */
export function queryOf(draft: string): string {
  return draft.trim();
}

/** Whether the draft is worth asking the list for: it differs from the query the list was last asked with. Typing a space after a word, or typing and
 *  deleting back to the same text, asks nothing. */
export function shouldAsk(draft: string, asked: string): boolean {
  return queryOf(draft) !== queryOf(asked);
}

/** Whether the page changed its query by itself (cleared the filters, followed a link): the query the page holds is not the one this box last asked for, so
 *  the box must show it. A query that is just the answer to this box's own ask is NOT a change: the person may already be typing the next letters. */
export function pageChangedQuery(value: string, asked: string): boolean {
  return queryOf(value) !== queryOf(asked);
}

/** What Escape does in the box: with text in it, it clears the box and asks for everything (and the key is taken, so a panel around the box stays open);
 *  with nothing in it, it is not the box's key at all. */
export function escapeClears(draft: string): boolean {
  return draft.length > 0;
}

/** The words that name the clear button for a screen reader. */
export function clearName(label: string): string {
  const what = label.trim();
  return what ? `Clear ${what.charAt(0).toLowerCase()}${what.slice(1)}` : 'Clear search';
}
