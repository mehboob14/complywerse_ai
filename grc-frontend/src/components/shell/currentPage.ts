// The page the person is on as a shortcut (for "Pin this page" and Recent), as a pure function (`node --test src/components/shell/currentPage.test.ts`).
// A page with a name of its own is kept by that name and its address (the view in the query stays: a library filtered by status is a view worth coming back to); a RECORD page
// (a document, a committee) is kept by the record's own name, which only the page knows (its heading), and is not kept at all while that is unknown, because "Document" would
// say nothing. What a link adds to be opened in a certain way (`from`, `act`, `item`) is not part of where the page is, and is dropped.
import { areaName, routeFor } from '../../lib/navRegistry.ts';
import type { Shortcut } from './pinnedRecent.ts';

/** The query parameters that say how a page was opened, not what it shows. */
export const TRANSIENT = ['from', 'act', 'item', 'new', 'prefill', 'step'] as const;
const NOT_KEPT = new Set(['/dashboard', '/needs-my-action']);
const QUERY_MAX = 200;

export function cleanQuery(search: string | null | undefined): string {
  const params = new URLSearchParams(search ?? '');
  TRANSIENT.forEach((key) => params.delete(key));
  const text = params.toString();
  return text && text.length <= QUERY_MAX ? `?${text}` : '';
}

/** `heading`: the page's own h1 text, if it has one by now. null when this page is not something to keep. */
export function shortcutFor(pathname: string | null | undefined, search: string | null | undefined, heading: string | null | undefined): Shortcut | null {
  const route = routeFor(pathname);
  if (!pathname || !route) return null;
  const path = pathname.split(/[?#]/)[0].replace(/\/+$/, '') || '/';
  if (NOT_KEPT.has(path) || route.aliasOf) return null;
  const record = route.path.indexOf(':') >= 0;
  const label = record ? (heading ?? '').replace(/\s+/g, ' ').trim() : route.title ?? route.label;
  if (!label) return null;
  const area = areaName(route.area);
  const sub = record ? route.label : area && area !== label ? area : undefined;       // a page named like its area ("Administration" in Administration) says it once
  return { label, href: `${path}${record ? '' : cleanQuery(search)}`, sub };
}
