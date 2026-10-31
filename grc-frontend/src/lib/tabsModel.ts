// Tabs as pure functions, apart from React so `node --test` can pin them (tabsModel.test.ts): where a key press moves to, which tab an address
// asks for (old ?tab= links from emails, tasks and bookmarks keep working), how the address changes when a tab is picked, the count badge,
// the ids that tie a tab to its panel, and how far a scrolling strip must move to show the picked tab.
// The components are components/ui/ds/Tabs.tsx and components/ui/ds/useTabParam.ts.

export interface TabLike { key: string; disabled?: boolean; hidden?: boolean }

/** The keys a person can move to, in order: shown and not disabled. */
export function reachableKeys(tabs: readonly TabLike[]): string[] {
  return tabs.filter((t) => !t.hidden && !t.disabled).map((t) => t.key);
}

/** Where a key pressed on tab `current` moves to. ArrowRight / ArrowLeft step with a wrap, Home / End jump; any other key is null. `keys` are the
 *  reachable keys in order (`reachableKeys`). A `current` that is not among them (it cannot be focused, but be safe) starts from before the first. */
export function nextTab(keys: readonly string[], current: string, key: string): string | null {
  if (keys.length === 0) return null;
  const at = keys.indexOf(current);
  switch (key) {
    case 'ArrowRight': return keys[(at + 1) % keys.length];
    case 'ArrowLeft': return keys[(at <= 0 ? keys.length : at) - 1];
    case 'Home': return keys[0];
    case 'End': return keys[keys.length - 1];
    default: return null;
  }
}

const norm = (s: string): string => s.trim().toLowerCase();

/** The tab an address asks for: the value of `paramName` in `search` ("?tab=lifecycle&x=1"), matched to `keys` ignoring case and spaces, then
 *  through `aliases` (old names that still arrive from emails, tasks and bookmarks: `{ lifecycle: 'approvals' }`), else `fallback`. An alias that
 *  leads to a tab that is not in `keys` (it is hidden today) is no tab. Same rules as `viewOf` in governance/documents/_view/docRoute.ts. */
export function resolveTab(
  search: string,
  paramName: string,
  keys: readonly string[],
  aliases: Readonly<Record<string, string>>,
  fallback: string,
): string {
  const raw = new URLSearchParams(search).get(paramName);
  if (raw == null) return fallback;
  const want = norm(raw);
  const canonical = (name: string): string | undefined => keys.find((k) => norm(k) === name);
  const direct = canonical(want);
  if (direct !== undefined) return direct;
  const alias = Object.keys(aliases).find((a) => norm(a) === want);            // own keys only: ?tab=constructor is no tab
  return (alias === undefined ? undefined : canonical(norm(aliases[alias]))) ?? fallback;
}

/** `search` with `paramName` set to `key` and every other param kept as it was, in its place. The param is dropped when `key` is `fallback` (the
 *  default tab has the plain address). Returns the query string without the "?". */
export function withTab(search: string, paramName: string, key: string, fallback?: string): string {
  const next = new URLSearchParams(search);
  if (fallback !== undefined && key === fallback) next.delete(paramName);
  else next.set(paramName, key);
  return next.toString();
}

/** The badge beside a tab's name: the count, "99+" from 100 up; '' when there is no count (missing or not a number). 0 is a count. */
export function countLabel(count: number | null | undefined): string {
  if (typeof count !== 'number' || !Number.isFinite(count)) return '';
  const n = Math.max(0, Math.floor(count));
  return n > 99 ? '99+' : String(n);
}

/** Element ids that tie a tab to its panel (aria-controls, aria-labelledby). `base` is unique per Tabs (React's useId); a key may hold any character. */
export const tabId = (base: string, key: string): string => `${base}-tab-${encodeURIComponent(key)}`;
export const panelId = (base: string, key: string): string => `${base}-panel-${encodeURIComponent(key)}`;

/** How far to scroll a horizontally scrolling strip to show an item: negative to the left, positive to the right, 0 when it shows already.
 *  Positions share one coordinate system (viewport pixels); `pad` is the room kept beside the item. An item wider than the strip is lined up
 *  with its start. Used instead of scrollIntoView, which would also scroll the page up or down to reach the strip. */
export function scrollDelta(view: { start: number; end: number }, item: { start: number; end: number }, pad: number = 8): number {
  const toStart = item.start - pad - view.start;
  if (item.end - item.start + 2 * pad > view.end - view.start) return toStart;
  if (toStart < 0) return toStart;
  const toEnd = item.end + pad - view.end;
  return toEnd > 0 ? toEnd : 0;
}
