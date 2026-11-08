// An address that moved forwards to its new home and keeps what the visitor came with (?framework=12, ?fw=SOC): the query string is carried over as it arrived. Used by the pages that are only a
// forward (the retired Catalog Workbench and Overview, the Library pages nobody linked). Pure, so `node --test` pins it (forwardTo.test.ts); the page calls Next's redirect() with the result.
export type SearchParams = Record<string, string | string[] | undefined>;

/** `/controls` + the query the visitor arrived with: repeated names stay repeated, a name with no value stays, and nothing is added when there was no query. */
export function forwardTo(path: string, searchParams?: SearchParams | null): string {
  const query = new URLSearchParams();
  for (const [name, value] of Object.entries(searchParams ?? {})) {
    if (value === undefined) continue;
    for (const v of Array.isArray(value) ? value : [value]) query.append(name, v);
  }
  const text = query.toString();
  return text ? `${path}?${text}` : path;
}
