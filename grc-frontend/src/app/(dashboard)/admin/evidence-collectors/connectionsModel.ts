// What the Connections page decides, apart from React so `node --test` pins it (connectionsModel.test.ts): which connectors are active, which are failing, what a search and a category leave, how a
// connector reads in a row (connected and collecting, connected and failing, not connected, not available yet), the counts of the tabs and the page's state in the address. The catalogue is
// GET /automation/soc2/catalog: every connector this platform knows (the wired ones can collect evidence; the rest are listed so nobody has to ask whether one exists).
import { oneOf, text } from '../../../../lib/addressState.ts';

export interface Connector {
  id: string;
  name: string;
  category: string;
  categories: string[];
  provider: string | null;
  supported: boolean;
  connected: boolean;
  connection_id: number | null;
  last_run: { status: string; started_at?: string | null } | null;
  needs_key_id?: boolean;
  needs_region?: boolean;
}

export type Show = 'active' | 'failing' | 'all';
export const SHOWS: readonly Show[] = ['active', 'failing', 'all'];
export const SHOW_LABEL: Record<Show, string> = { active: 'Active', failing: 'Failing', all: 'All' };

/** How a connector reads in a row. `health` is a word of lib/statuses/controls.ts collectionHealth for a connected connector (the last collection failed: failing; none yet: never_run; else healthy). */
export type Reading =
  | { kind: 'unavailable' }
  | { kind: 'not_connected' }
  | { kind: 'connected'; health: 'healthy' | 'failing' | 'never_run' };

export function readingOf(c: Connector): Reading {
  if (!c.supported) return { kind: 'unavailable' };
  if (!c.connected) return { kind: 'not_connected' };
  const run = c.last_run;
  if (!run) return { kind: 'connected', health: 'never_run' };
  return { kind: 'connected', health: run.status === 'error' ? 'failing' : 'healthy' };
}

export const isActive = (c: Connector): boolean => c.supported && c.connected;
export const isFailing = (c: Connector): boolean => { const r = readingOf(c); return r.kind === 'connected' && r.health === 'failing'; };

export function countsOf(connectors: readonly Connector[]): { active: number; failing: number; all: number; wired: number } {
  return {
    active: connectors.filter(isActive).length,
    failing: connectors.filter(isFailing).length,
    all: connectors.length,
    wired: connectors.filter((c) => c.supported).length,
  };
}

/** The tab shown when the address names none: Active once anything is connected (it is the useful one), else everything. */
export const defaultShow = (connectors: readonly Connector[]): Show => (connectors.some(isActive) ? 'active' : 'all');

export interface View { show: Show; query: string; category: string }

const fold = (s: string): string => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** The connectors a tab, a search and a category leave: the wired ones first within the tab "All" (the others are only listed), then by name. */
export function visibleConnectors(connectors: readonly Connector[], v: View): Connector[] {
  const q = fold(v.query.trim());
  return connectors
    .filter((c) => (v.show === 'active' ? isActive(c) : v.show === 'failing' ? isFailing(c) : true)
      && (!v.category || c.category === v.category || c.categories.includes(v.category))
      && (!q || fold(c.name).includes(q) || fold(c.id).includes(q)))
    .sort((a, b) => Number(b.supported) - Number(a.supported) || Number(b.connected) - Number(a.connected) || a.name.localeCompare(b.name));
}

export const categoriesOf = (connectors: readonly Connector[]): string[] => Array.from(new Set(connectors.map((c) => c.category).filter(Boolean))).sort((a, b) => a.localeCompare(b));

/** "Last collected 8 Nov 2026" / "Never collected" for a connected connector. */
export function lastCollected(c: Connector, format: (iso: string) => string): string | null {
  if (!isActive(c)) return null;
  return c.last_run?.started_at ? `Last collected ${format(c.last_run.started_at)}` : 'Never collected';
}

/** The state of the page in its address: ?show=failing&q=okta&category=Identity, and the two links that already exist (?connector=<id> opens that connector, ?return=<path> says where Back goes). */
export const CONNECTIONS_SCHEMA = {
  show: oneOf(['auto', ...SHOWS] as const, 'auto'),
  q: text(),
  category: text(),
  connector: text(),
  return: text(),
};

/** Only a path on this site is followed back: "/automation/soc2-controls/IAC-06" yes, "//evil.example" and "https://evil.example" no. */
export function safeReturn(raw: string | null | undefined): string | null {
  const v = (raw ?? '').trim();
  return v.startsWith('/') && !v.startsWith('//') && !v.includes('\\') ? v : null;
}

/** "IAC-06" from "/automation/soc2-controls/IAC-06?tab=tests": the last part of the path, so "Back to IAC-06" says where it goes. */
export function returnLabel(path: string | null): string | null {
  if (!path) return null;
  const last = path.split('?')[0].split('/').filter(Boolean).pop();
  if (!last) return null;
  try { return decodeURIComponent(last); } catch { return last; }
}
