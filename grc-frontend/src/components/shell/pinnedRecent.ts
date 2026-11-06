// Pinned pages and recent items of the shell, kept PER BROWSER (localStorage; no server, no new capability), as pure logic over an injected storage
// (`node --test src/components/shell/pinnedRecent.test.ts`). Every read and write is in try/catch: storage can be missing or throw (a private window,
// blocked site data, a full quota) and then the shell simply remembers nothing, it never fails. What comes out of storage is not trusted: a shortcut
// is a short label and an in-app path (`appPath`), anything else is dropped, so a tampered value can open no other site.
// The keys carry the tenant and the person ("cw-shell-pins:cfsb:7"): one browser used by two people keeps two lists. The login page clears the whole
// storage at every sign-in (app/login/page.tsx), so these live until the next sign-in; that is a decision for the owner, not something hidden here.
import { appPath } from '../layout/headerLinks.ts';

export interface Shortcut {
  /** what the person reads (a page's name, a record's title) */
  label: string;
  /** a path of this app, with its query ("/governance/documents?status=draft") */
  href: string;
  /** a second line: the module of a page, the kind of a record */
  sub?: string;
}

export const PINS_MAX = 12;
export const RECENT_MAX = 8;
export const LABEL_MAX = 160;
export const SUB_MAX = 60;

export type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const PINS = 'cw-shell-pins';
const RECENT = 'cw-shell-recent';

/** Who the lists belong to: the tenant and the person, from /auth/me; null while nobody is known (then nothing is read or written). */
export function scopeOf(me: unknown): string | null {
  const m = me as { authenticated?: boolean; user?: { id?: unknown; primary_tenant_id?: unknown } | null; tenant?: { slug?: unknown } | null } | null;
  const user = m?.authenticated ? m.user : null;
  if (!user || (typeof user.id !== 'number' && typeof user.id !== 'string')) return null;
  const tenant = typeof m?.tenant?.slug === 'string' && m.tenant.slug ? m.tenant.slug : String(user.primary_tenant_id ?? 'x');
  return `${tenant}:${user.id}`.replace(/[^\w:.-]/g, '_');
}

export const pinsKey = (scope: string): string => `${PINS}:${scope}`;
export const recentKey = (scope: string): string => `${RECENT}:${scope}`;

/** One stored value as a shortcut, or null when it is not one. */
export function cleanShortcut(raw: unknown): Shortcut | null {
  if (!raw || typeof raw !== 'object') return null;
  const { label, href, sub } = raw as Record<string, unknown>;
  if (typeof label !== 'string' || typeof href !== 'string') return null;
  const path = appPath(href);
  const text = label.replace(/\s+/g, ' ').trim();
  if (!path || !text) return null;
  const out: Shortcut = { label: text.length > LABEL_MAX ? `${text.slice(0, LABEL_MAX - 1)}…` : text, href: path };
  if (typeof sub === 'string' && sub.trim()) out.sub = sub.replace(/\s+/g, ' ').trim().slice(0, SUB_MAX);
  return out;
}

/** The list kept under a key: valid shortcuts only, no repeated href, at most `max`. [] for a missing, broken or unreadable value. */
export function readList(store: Store | undefined, key: string, max: number): Shortcut[] {
  try {
    const raw = (store ?? window.localStorage).getItem(key);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    const seen = new Set<string>();
    const out: Shortcut[] = [];
    for (const item of parsed) {
      const s = cleanShortcut(item);
      if (s && !seen.has(s.href)) { seen.add(s.href); out.push(s); }
      if (out.length >= max) break;
    }
    return out;
  } catch { return []; }
}

/** Keeps the list under a key; an empty list removes it. Returns whether it was kept (false: not remembered, the shell goes on). */
export function writeList(store: Store | undefined, key: string, list: readonly Shortcut[]): boolean {
  try {
    const s = store ?? window.localStorage;
    if (list.length === 0) s.removeItem(key); else s.setItem(key, JSON.stringify(list));
    return true;
  } catch { return false; }
}

/** The page just opened goes first; opening it again moves it up instead of repeating it; the oldest fall off. A value that is not a shortcut changes nothing. */
export function pushRecent(list: readonly Shortcut[], entry: unknown, max: number = RECENT_MAX): Shortcut[] {
  const s = cleanShortcut(entry);
  if (!s) return list.slice();
  return [s].concat(list.filter((x) => x.href !== s.href)).slice(0, max);
}

export function isPinned(list: readonly Shortcut[], href: string): boolean {
  const path = appPath(href);
  return !!path && list.some((x) => x.href === path);
}

/** Pins the page, or unpins it when it is pinned. A new pin goes first; at the cap the oldest pin is dropped (the person is told by the panel's count, and can unpin to choose). */
export function togglePin(list: readonly Shortcut[], entry: unknown, max: number = PINS_MAX): { list: Shortcut[]; pinned: boolean } {
  const s = cleanShortcut(entry);
  if (!s) return { list: list.slice(), pinned: false };
  if (list.some((x) => x.href === s.href)) return { list: list.filter((x) => x.href !== s.href), pinned: false };
  return { list: [s].concat(list).slice(0, max), pinned: true };
}

export function unpin(list: readonly Shortcut[], href: string): Shortcut[] {
  return list.filter((x) => x.href !== href);
}
