// What the library remembers for one person on one browser: which columns, how dense, how many rows a page, and the views they saved.
// A convenience, never state that matters: storage can be missing, blocked or full, so every read and write is guarded and the page
// works the same without it. Pure (the store is passed in), so `node --test` runs libraryPrefs.test.ts against it.
import { DEFAULT_STATE, fromParams, toParams, type SavedView } from './libraryModel.ts';

export type Density = 'comfortable' | 'compact';
export interface Prefs { hidden: string[]; density: Density; pageSize: number }

/** The columns a person may switch off (the title and the actions are always there). */
export const OPTIONAL_COLUMNS = ['type', 'lifecycle', 'owner', 'department', 'frameworks', 'attestation', 'review', 'version', 'updated'] as const;
export const PAGE_SIZES = [10, 25, 50, 100];
/** What is off by default: the department (shown under the owner), the version (shown under the title) and the last update: they are
 *  there for whoever wants a column of their own, and the table fits a laptop without them. */
export const DEFAULT_PREFS: Prefs = { hidden: ['department', 'version', 'updated'], density: 'comfortable', pageSize: 25 };

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** The browser's local storage, or null where there is none (a private window, blocked site data, the server). */
export function browserStore(): KeyValueStore | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

const PREFS_KEY = 'gov-docs-library:prefs:v1';
const VIEWS_KEY = 'gov-docs-library:views:v1';
export const prefsKey = (userId: number | null | undefined) => `${PREFS_KEY}:${userId ?? 'anon'}`;
export const viewsKey = (userId: number | null | undefined) => `${VIEWS_KEY}:${userId ?? 'anon'}`;

function read(store: KeyValueStore | null, key: string): unknown {
  try {
    const raw = store?.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
function write(store: KeyValueStore | null, key: string, value: unknown): void {
  try {
    store?.setItem(key, JSON.stringify(value));
  } catch {
    /* full or blocked: the choice lasts until the page is left */
  }
}

export function loadPrefs(store: KeyValueStore | null, key: string): Prefs {
  const raw = read(store, key) as Partial<Prefs> | null;
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_PREFS };
  const known = OPTIONAL_COLUMNS as readonly string[];
  return {
    hidden: Array.isArray(raw.hidden) ? raw.hidden.filter((c): c is string => typeof c === 'string' && known.includes(c)) : [...DEFAULT_PREFS.hidden],
    density: raw.density === 'compact' ? 'compact' : 'comfortable',
    pageSize: PAGE_SIZES.includes(Number(raw.pageSize)) ? Number(raw.pageSize) : DEFAULT_PREFS.pageSize,
  };
}
export const savePrefs = (store: KeyValueStore | null, key: string, prefs: Prefs) => write(store, key, prefs);

/** The person's own saved views; each state is read back through the address format, so a view saved by an older version of the
 *  page, or edited by hand, still loads as something this page understands. */
export function loadViews(store: KeyValueStore | null, key: string): SavedView[] {
  const raw = read(store, key);
  if (!Array.isArray(raw)) return [];
  const out: SavedView[] = [];
  for (const v of raw) {
    if (!v || typeof v.id !== 'string' || typeof v.name !== 'string' || !v.name.trim()) continue;
    const params = typeof v.query === 'string' ? new URLSearchParams(v.query) : toParams(DEFAULT_STATE);
    out.push({ id: v.id, name: v.name.trim(), state: fromParams(params) });
  }
  return out;
}
export function saveViews(store: KeyValueStore | null, key: string, views: readonly SavedView[]): void {
  write(store, key, views.filter((v) => !v.builtIn).map((v) => ({ id: v.id, name: v.name, query: toParams(v.state).toString() })));
}

/** A view's id: the name plus a counter, so a view saved twice under one name is still two. */
export function newViewId(existing: readonly SavedView[]): string {
  const taken = new Set(existing.map((v) => v.id));
  let i = existing.length + 1;
  while (taken.has(`mine-${i}`)) i += 1;
  return `mine-${i}`;
}
