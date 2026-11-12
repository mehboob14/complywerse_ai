// What useReturnToPlace decides, apart from React so `node --test` can pin it (returnToPlaceModel.test.ts): the key a page's scroll position is kept under, how
// often it is written, which arrivals count as "coming back" (Back/Forward, a reload, a link to the very address the person left), how an old or damaged record
// is read, and how far down the page can be put back while it is still growing. Nothing here touches the window.

/** The one sessionStorage key all places live under (a map of address -> place). */
export const STORE_KEY = 'overview:places';
/** A place is forgotten after this long (six hours: a working session, not a week). */
export const KEEP_MS = 6 * 60 * 60 * 1000;
/** How many addresses keep a place (the newest ones). */
export const KEEP_COUNT = 24;
/** The scroll position is written at most this often while the person scrolls (and once more when they stop). */
export const SAVE_EVERY_MS = 150;
/** After the page is shown again it is put back and kept there, while its charts measure themselves, for this long, unless the person scrolls first. */
export const SETTLE_MS = 2500;
/** How often it checks. */
export const POLL_MS = 100;
/** A Back/Forward press is "this arrival" for this long; after it, a stray one is forgotten (a Back to a page that has no such hook must not leak into a later visit). */
export const POP_WINDOW_MS = 15000;
/** A document that was loaded (not navigated to inside the app) this recently may have been reloaded or opened with Back. */
export const LOAD_WINDOW_MS = 60000;
/** Where the Navigation API is missing, a page that looks freshly opened waits this long before it is believed: the browser's `popstate` for a Back press can arrive AFTER
 *  the router has already mounted the cached page (measured: 60ms later in Edge, when the main thread was busy). */
export const DECIDE_LATE_MS = 250;
/** A new page that has not been scrolled by the person is not allowed to overwrite a kept place with "the top" for this long (a return that went unrecognised must not
 *  also destroy the place it should have used). */
export const KEEP_TOP_MS = 3000;

/** The key of a page: its path and its whole query, no hash, no empty "?", no trailing slash (except the root). The query is the page's view, so two views of one page
 *  are two places. */
export function placeKey(pathname: string, search: string): string {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') || '/' : pathname || '/';
  const query = search.replace(/^\?/, '').replace(/#.*$/, '');
  return query ? `${path}?${query}` : path;
}

/** The key an address (a link's href) leads to, when it is a page of this origin; null for another origin or something that is not an address. */
export function keyOfHref(href: string, base: string): string | null {
  try {
    const to = new URL(href, base);
    const here = new URL(base);
    return to.origin === here.origin ? placeKey(to.pathname, to.search) : null;
  } catch {
    return null;
  }
}

export interface Place { y: number; t: number }
export type Places = Record<string, Place>;

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

/** The map from what sessionStorage held: anything that is not a map of {y, t} is an empty one (a damaged record is never an error). */
export function parsePlaces(raw: string | null | undefined): Places {
  if (!raw) return {};
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const out: Places = {};
    for (const [key, p] of Object.entries(value as Record<string, unknown>)) {
      const place = p as Partial<Place> | null;
      if (place && finite(place.y) && finite(place.t) && place.y >= 0) out[key] = { y: place.y, t: place.t };
    }
    return out;
  } catch {
    return {};
  }
}

/** Where the page was when the person left it: null when nothing is kept, or what is kept is older than KEEP_MS. */
export function placeOf(places: Places, key: string, now: number): number | null {
  const p = places[key];
  return p && now - p.t <= KEEP_MS && p.t <= now + 1000 ? p.y : null;
}

/** The map with `y` kept for `key` (rounded), the old ones dropped and only the newest KEEP_COUNT left. A position of 0 is kept too: "at the top" is a place. */
export function withPlace(places: Places, key: string, y: number, now: number): Places {
  const fresh = Object.entries({ ...places, [key]: { y: Math.max(0, Math.round(y)), t: now } })
    .filter(([, p]) => now - p.t <= KEEP_MS)
    .sort((a, b) => b[1].t - a[1].t)
    .slice(0, KEEP_COUNT);
  return Object.fromEntries(fresh);
}

/** How long to wait before the next write: 0 when it is time, else the rest of the interval. */
export function saveDelay(now: number, lastWrite: number, every: number = SAVE_EVERY_MS): number {
  return Math.max(0, every - (now - lastWrite));
}

export interface Arrival {
  /** a Back/Forward press happened, and when (ms) */
  poppedAt: number | null;
  /** the address of the last link the person pressed (its key) */
  intent: string | null;
  /** this document was loaded as 'reload' / 'back_forward' / 'navigate', from which address (its key) and how long ago (ms); null when the browser does not say */
  load: { type: string; ageMs: number; key: string } | null;
}

/** Is the page being shown again, rather than opened? Yes after a Back/Forward press (a recent one), after a link to the very address that was left (the
 *  module's own "back to the overview"), and for the page a reloaded or history-loaded document was loaded AT (its own address, soon after loading: a document
 *  that was reloaded on another page and later reaches this one by a menu click is not a return). A menu entry, a card on another page and a fresh address are not
 *  returns: they start at the top. */
export function isReturn(arrival: Arrival, key: string, now: number): boolean {
  if (arrival.poppedAt !== null && now - arrival.poppedAt >= 0 && now - arrival.poppedAt <= POP_WINDOW_MS) return true;
  if (arrival.intent !== null && arrival.intent === key) return true;
  const load = arrival.load;
  return !!load && (load.type === 'back_forward' || load.type === 'reload') && load.key === key && load.ageMs <= LOAD_WINDOW_MS;
}

/** Is this a history traversal (the Navigation API's `navigate` event says so for Back, Forward and `history.go`)? It fires before `popstate` and does not depend
 *  on the order in which the app's own listeners were registered. */
export const isTraverse = (navigationType: unknown): boolean => navigationType === 'traverse';

/** May the position be written now? A place of "the top" is not written over a kept place by a page that is a few seconds old and that nobody has scrolled or
 *  touched: it may be a return that was not recognised, and the kept place is worth more than a guess at the top. Anything else is written. */
export function mayWrite({ y, touched, sinceMountMs, kept }: { y: number; touched: boolean; sinceMountMs: number; kept: number | null }): boolean {
  return !(y < 1 && !touched && sinceMountMs < KEEP_TOP_MS && kept !== null && kept >= 1);
}

/** The position to put the page at while it is still growing: where it was, or as far down as it reaches so far (a page that is not tall enough yet is put as low
 *  as it goes and asked again). */
export function restoreTarget(saved: number, maxScroll: number): number {
  return Math.max(0, Math.min(saved, Math.max(0, maxScroll)));
}

/** Is it where it should be (a pixel of slack for sub-pixel scrolling)? */
export const reached = (current: number, target: number): boolean => Math.abs(current - target) <= 1;
