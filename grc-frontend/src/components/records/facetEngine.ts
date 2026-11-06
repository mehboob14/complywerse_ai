// The live counts of a facet explorer, and which records pass, as one pure pass (no React, so `node --test` checks it: facetEngine.test.ts).
//
// A FACET is one dimension of a record (status, department, framework ...). A record has VALUES in it: one (its status), several (its frameworks) or the
// "none" value a facet may offer. The person CHOOSES values in some facets; inside one facet a record passes when it has ANY chosen value (or the facet has
// nothing chosen), and the facets all have to pass. On top of the facets there is the RULE: the search terms and any other filter that is not a facet (mine,
// waiting for me ...), which every record must pass for every count.
//
// The number beside an option is the number of records that WOULD BE SHOWN if the option were chosen with the other facets as they are: the records that pass
// every OTHER facet and the rule, and have that value (the "disjunctive facet" counts every shop uses). So a facet's own choice never empties its own list, a
// zero stays visible and says so, and the counts equal what choosing the option would show: one pass over the records gives them all, because a record that
// fails exactly one facet counts toward that facet only, and a record that fails none counts toward every facet and is a match.
//
// Building the index (`indexRows`: each record's values, its folded search text) is the costly part and is done when the records or what the rules read change,
// not on a keystroke; `evaluate` and `countMatching` are then tight loops (10,000 records and eight facets are a few milliseconds).

export interface FacetSpec<R> {
  /** names the facet in the chosen values and in the counts */
  key: string;
  /** the values this record has in the facet, as the option values it counts under ([] when it has none and the facet offers no "none" option) */
  values: (row: R) => readonly string[];
  /** with nothing chosen in the facet, does the record pass? (default yes). The status facet keeps an archived record out until 'archived' is chosen. */
  passesUnchosen?: (row: R) => boolean;
}

/** Facet key -> the values chosen in it (absent or empty: nothing chosen). */
export type Chosen = Readonly<Record<string, readonly string[]>>;

export interface FacetIndex<R> {
  rows: readonly R[];
  specs: readonly FacetSpec<R>[];
  /** values[row][facet] */
  values: string[][][];
  /** the folded search text of each record ('' when the explorer has no search) */
  text: string[];
}

export function indexRows<R>(rows: readonly R[], specs: readonly FacetSpec<R>[], text?: (row: R) => string): FacetIndex<R> {
  return {
    rows,
    specs,
    values: rows.map((row) => specs.map((s) => { const v = Array.from(s.values(row)); return v.length > 1 ? Array.from(new Set(v)) : v; })),       // a record counts once under a value, however often it has it
    text: rows.map((row) => (text ? text(row) : '')),
  };
}

/** What every record must pass besides the facets. */
export interface Rule<R> {
  /** every term must be a substring of the record's folded text */
  terms?: readonly string[];
  /** any other filter that is not a facet; `i` is the record's position in the index */
  extra?: (row: R, i: number) => boolean;
}

export interface Evaluated<R> {
  /** the records that pass everything, in the order of the index */
  matches: R[];
  /** their positions in the index (parallel to `matches`) */
  at: number[];
  /** per facet: option value -> the records that would be shown if it were chosen. A value no record has is absent (read it as 0). */
  counts: Record<string, Map<string, number>>;
}

function setsOf<R>(index: FacetIndex<R>, chosen: Chosen): (ReadonlySet<string> | null)[] {
  return index.specs.map((s) => { const v = chosen[s.key]; return v && v.length > 0 ? new Set(v) : null; });
}

function passesRule<R>(index: FacetIndex<R>, i: number, rule: Rule<R>): boolean {
  const terms = rule.terms;
  if (terms && terms.length > 0) {
    const text = index.text[i];
    for (const t of terms) if (!text.includes(t)) return false;
  }
  return !rule.extra || rule.extra(index.rows[i], i);
}

export function evaluate<R>(index: FacetIndex<R>, chosen: Chosen, rule: Rule<R> = {}): Evaluated<R> {
  const { specs, rows } = index;
  const sets = setsOf(index, chosen);
  const counts: Record<string, Map<string, number>> = {};
  specs.forEach((s) => { counts[s.key] = new Map(); });
  const matches: R[] = [];
  const at: number[] = [];
  for (let i = 0; i < rows.length; i++) {
    if (!passesRule(index, i, rule)) continue;
    const vals = index.values[i];
    let failed = -1;
    let fails = 0;
    for (let f = 0; f < specs.length; f++) {
      const chosenHere = sets[f];
      let pass: boolean;
      if (chosenHere) {
        pass = false;
        for (const v of vals[f]) if (chosenHere.has(v)) { pass = true; break; }
      } else {
        pass = specs[f].passesUnchosen ? specs[f].passesUnchosen!(rows[i]) : true;
      }
      if (!pass) { fails++; failed = f; if (fails > 1) break; }
    }
    if (fails > 1) continue;
    if (fails === 0) { matches.push(rows[i]); at.push(i); }
    for (let f = 0; f < specs.length; f++) {
      if (fails === 1 && f !== failed) continue;
      const map = counts[specs[f].key];
      for (const v of vals[f]) map.set(v, (map.get(v) ?? 0) + 1);
    }
  }
  return { matches, at, counts };
}

/** How many records pass everything (no counts): the number on a saved view's chip. */
export function countMatching<R>(index: FacetIndex<R>, chosen: Chosen, rule: Rule<R> = {}): number {
  const { specs, rows } = index;
  const sets = setsOf(index, chosen);
  let n = 0;
  for (let i = 0; i < rows.length; i++) {
    if (!passesRule(index, i, rule)) continue;
    const vals = index.values[i];
    let ok = true;
    for (let f = 0; f < specs.length && ok; f++) {
      const chosenHere = sets[f];
      if (chosenHere) {
        ok = false;
        for (const v of vals[f]) if (chosenHere.has(v)) { ok = true; break; }
      } else if (specs[f].passesUnchosen) ok = specs[f].passesUnchosen!(rows[i]);
    }
    if (ok) n++;
  }
  return n;
}

/** The count of one option (0 when no record has the value). */
export const countOf = (counts: Record<string, Map<string, number>>, key: string, value: string): number => counts[key]?.get(value) ?? 0;
