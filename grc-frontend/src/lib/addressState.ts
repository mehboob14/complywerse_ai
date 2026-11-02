// The state of a page that lives in its address (?q=policy&status=draft,approved&sort=title:asc), as pure functions apart from React so `node --test`
// can pin them (addressState.test.ts): which names belong to the page (a schema), what a name's values mean (every occurrence, in order; junk is the
// default), how a state is written back (the plain address for the defaults, every other param left alone) and when two states are the same address.
// The hook that keeps a page in step with its address is components/ui/ds/useAddressState.ts.
//
//   const SCHEMA = { q: text(), status: listOf(['draft', 'approved']), mine: flag(), sort: sortOf(['title', 'updated'], { key: 'updated', dir: 'desc' }) };
//   readAddress(SCHEMA, '?status=approved,draft,junk&sort=title:asc')   // { q: '', status: ['approved', 'draft'], mine: false, sort: { key: 'title', dir: 'asc' } }
//   writeAddress(SCHEMA, '?id=7&mine=1', { ...state, mine: false })     // 'id=7'  (the defaults have the plain address; `id` is not the page's, so it stays)

/** What one name of the address means. */
export interface ParamSpec<T> {
  /** the value when the address has nothing usable for this name */
  default: T;
  /** What the address's values for this name mean: every occurrence, in order (an empty list when the name is absent). undefined: none of it is usable, so the default. */
  read: (values: readonly string[]) => T | undefined;
  /** The values to write for `value`. None leaves the name out of the address, so a value that is the default has the plain address. */
  write: (value: T) => string[];
}

// the schema's value types are different for each name, which `any` says without losing them (AddressState reads each one back out)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Schema = Record<string, ParamSpec<any>>;
export type AddressState<S extends Schema> = { [K in keyof S]: S[K] extends ParamSpec<infer T> ? T : never };

const has = (schema: Schema, name: string): boolean => Object.prototype.hasOwnProperty.call(schema, name);       // own names only: ?constructor= is nobody's param

/** The state an address stands for. A name the schema does not list is ignored, and a value that is not usable for its name is that name's default:
 *  an address can never put the page in a state it cannot be in. `search` is the query string, with or without the "?". */
export function readAddress<S extends Schema>(schema: S, search: string): AddressState<S> {
  const query = new URLSearchParams(search);
  const state: Record<string, unknown> = {};
  for (const name of Object.keys(schema)) {
    const value = schema[name].read(query.getAll(name));
    state[name] = value === undefined ? schema[name].default : value;
  }
  return state as AddressState<S>;
}

/** The address of a state: `search` with every name of the schema replaced by the state's values (a default is left out) and every other param kept
 *  as it was, in its place. The schema's own params come after, in the schema's order, so one state is always one address. Returns the query string
 *  without the "?" ('' when there is nothing). */
export function writeAddress<S extends Schema>(schema: S, search: string, state: AddressState<S>): string {
  const out = new URLSearchParams();
  new URLSearchParams(search).forEach((value, key) => { if (!has(schema, key)) out.append(key, value); });
  for (const name of Object.keys(schema)) for (const value of schema[name].write(state[name])) out.append(name, value);
  return out.toString();
}

/** Whether two states are the same address (so "policy " typed in a search box and "policy" read back from the address are one state). */
export function sameAddressState<S extends Schema>(schema: S, a: AddressState<S>, b: AddressState<S>): boolean {
  return writeAddress(schema, '', a) === writeAddress(schema, '', b);
}

// ── the kinds of param ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** One of `options` (any case, spaces ignored): `?tab=Overdue` is 'overdue'. Written as the option. When a name is repeated the first one decides, as
 *  URLSearchParams.get does; one that is not an option is the default. */
export function oneOf<T extends string>(options: readonly T[], fallback: T): ParamSpec<T> {
  return {
    default: fallback,
    read: ([first]) => {
      const wanted = (first ?? '').trim().toLowerCase();
      return options.find((option) => option.toLowerCase() === wanted);
    },
    write: (value) => (value === fallback ? [] : [value]),
  };
}

/** Free text (a search box): the first value as it is; written trimmed, and nothing when it is blank. The default is ''. */
export function text(): ParamSpec<string> {
  return {
    default: '',
    read: ([first]) => first,
    write: (value) => (value.trim() === '' ? [] : [value.trim()]),
  };
}

/** A list: every occurrence of the name and every comma-separated piece in it, trimmed, without blanks or repeats, in the order first seen
 *  (`?s=a,b&s=b,c` is a, b, c). With `options` anything else is dropped. Written as ONE comma-separated value. The default is the empty list. */
export function listOf(options?: readonly string[]): ParamSpec<string[]> {
  return {
    default: [],
    read: (values) => {
      const all = values.flatMap((value) => value.split(',')).map((piece) => piece.trim()).filter(Boolean);
      return all.filter((piece, i) => all.indexOf(piece) === i && (!options || options.includes(piece)));
    },
    write: (value) => (value.length > 0 ? [value.join(',')] : []),
  };
}

/** On or off: `1` or `true` is on; anything else, and a missing name, is off. Written as `1`, and nothing when off. */
export function flag(): ParamSpec<boolean> {
  return {
    default: false,
    read: ([first]) => ['1', 'true'].includes((first ?? '').trim().toLowerCase()),
    write: (value) => (value ? ['1'] : []),
  };
}

/** A whole number (a page, an open record). Digits only (an optional minus sign): "2.5" and "12abc" are not numbers, and neither is one outside
 *  `min` to `max`; those are the default. Written when it is not the default. */
export function integer(fallback: number, { min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER }: { min?: number; max?: number } = {}): ParamSpec<number> {
  return {
    default: fallback,
    read: ([first]) => {
      const raw = (first ?? '').trim();
      if (!/^-?\d+$/.test(raw)) return undefined;
      const n = Number(raw);
      return Number.isSafeInteger(n) && n >= min && n <= max ? n : undefined;
    },
    write: (value) => (value === fallback ? [] : [String(value)]),
  };
}

export type SortValue = { key: string; dir: 'asc' | 'desc' } | null;

/** A sort, as `key:dir` (`?sort=title:asc`): the key must be one of `keys` and the direction asc or desc. `none` is "no sort" (it is how a page that
 *  sorts by default says the person cleared it). Written when it is not the default. Has the shape of the kit's SortState. */
export function sortOf(keys: readonly string[], fallback: SortValue): ParamSpec<SortValue> {
  const same = (a: SortValue, b: SortValue): boolean => (a === null || b === null ? a === b : a.key === b.key && a.dir === b.dir);
  return {
    default: fallback,
    read: ([first]) => {
      const raw = (first ?? '').trim().toLowerCase();
      if (raw === 'none') return null;
      const [key, dir, ...rest] = raw.split(':');
      const hit = keys.find((k) => k.toLowerCase() === key);
      return rest.length === 0 && hit !== undefined && (dir === 'asc' || dir === 'desc') ? { key: hit, dir } : undefined;
    },
    write: (value) => (same(value, fallback) ? [] : [value === null ? 'none' : `${value.key}:${value.dir}`]),
  };
}
