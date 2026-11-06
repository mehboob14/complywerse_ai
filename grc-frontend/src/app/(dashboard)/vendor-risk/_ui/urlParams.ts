// A change to a page's query string, as a pure function: `node --test` runs urlParams.test.ts against it; useUrlParams.ts calls it.

/** A value sets the key; an array sets it once per item (`?tier=a&tier=b`); null, undefined, '' and [] remove it. */
export type ParamPatch = Record<string, string | string[] | null | undefined>;

/** `search` ("?a=1" or "a=1") with `patch` applied; the keys the patch does not name stay as they are, in their order.
 *  Returns the new query string without the "?". */
export function applyParamsPatch(search: string, patch: ParamPatch): string {
  const next = new URLSearchParams(search);
  for (const [key, value] of Object.entries(patch)) {
    const values = (Array.isArray(value) ? value : value == null ? [] : [value]).filter((v) => v !== '');
    if (!Array.isArray(value) && values.length === 1) {
      next.set(key, values[0]);
      continue;
    }
    next.delete(key);
    values.forEach((v) => next.append(key, v));
  }
  return next.toString();
}
