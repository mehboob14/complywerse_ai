// The Questionnaires page's three tabs and the Library's address, apart from React (`hubModel.test.ts`). One page, `/vendor-risk/questionnaires`, with Library / Sent / Shared in `?tab=`:
// the builder lives at /questionnaires/<id>/builder and the supplier's legacy link at /questionnaires/<token>, so a tab is a query, not a path. Each tab keeps ITS OWN params (the Sent
// register's `q` and facets must not leak into the Library, and the other way round), so a tab picked from the strip starts clean: the address is `?tab=<key>` and nothing else.
import { flag, oneOf, text } from '../../../../../lib/addressState.ts';
import { resolveTab } from '../../../../../lib/tabsModel.ts';
import type { Template } from './types.ts';

export const TAB_KEYS = ['library', 'sent', 'shared'] as const;
export type TabKey = (typeof TAB_KEYS)[number];
export const TAB_LABEL: Record<TabKey, string> = { library: 'Library', sent: 'Sent', shared: 'Shared' };
/** Names the address used to carry for the same thing: the exchange page answered to /exchange, the Sent table had no tab. */
export const TAB_ALIASES: Readonly<Record<string, TabKey>> = { exchange: 'shared', responses: 'sent' };

export const tabOf = (search: string): TabKey => resolveTab(search, 'tab', TAB_KEYS, TAB_ALIASES, 'library') as TabKey;
/** The address of a tab: the Library is the plain address; the others carry only their name. */
export const tabHref = (pathname: string, key: TabKey): string => (key === 'library' ? pathname : `${pathname}?tab=${key}`);

/** The query the old Exchange address goes with: the Shared tab, and every param it came with (an unknown one is harmless). */
export function exchangeQuery(search: string): string {
  const query = new URLSearchParams(search);
  query.set('tab', 'shared');
  return query.toString();
}
export const exchangeForward = (search: string): string => `/vendor-risk/questionnaires?${exchangeQuery(search)}`;

// ── the Library's own address ────────────────────────────────────────────────────────────────────────────────────────────

export const KINDS = ['due_diligence', 'tiering'] as const;
export type Kind = (typeof KINDS)[number];
export const VIEWS = ['cards', 'list'] as const;
export type View = (typeof VIEWS)[number];
/** `purpose` and `archived` are the names the page always wrote (an old link opens the same list). */
export const LIBRARY_SCHEMA = { purpose: oneOf(KINDS, 'due_diligence'), view: oneOf(VIEWS, 'cards'), archived: flag(), q: text() };

/** What the Library shows: a search over the name, the category and the description; archived ones only when asked for. Order is the server's (newest first). */
export function visibleTemplates(templates: readonly Template[], { q, archived }: { q: string; archived: boolean }): Template[] {
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
  return templates.filter((t) => {
    if (!archived && t.archived_at) return false;
    if (terms.length === 0) return true;
    const hay = `${t.name} ${t.category || ''} ${t.description || ''}`.toLowerCase();
    return terms.every((term) => hay.includes(term));
  });
}

/** "12 questionnaires · 2 archived": the live ones and how many are put away. */
export function libraryHead(templates: readonly Template[]): string {
  const live = templates.filter((t) => !t.archived_at).length;
  const away = templates.length - live;
  const bits = [`${live.toLocaleString('en-GB')} ${live === 1 ? 'questionnaire' : 'questionnaires'}`];
  if (away > 0) bits.push(`${away.toLocaleString('en-GB')} archived`);
  return bits.join(' · ');
}

/** How many the server holds beyond what came back (0 when it all came): the page says so instead of pretending the list is whole. */
export const beyond = (total: number | undefined, shown: number): number => (total !== undefined && total > shown ? total - shown : 0);

export type TemplateAction = 'edit' | 'open' | 'preview' | 'send' | 'duplicate' | 'default_tiers' | 'archive' | 'restore' | 'delete';

/** What a person may do to one questionnaire, by the rights the server checks (routers/questionnaires.py): create (copy), edit (change, default tiers, archive), delete (only one never sent), send (assessments:create). */
export function templateActions(
  t: Pick<Template, 'archived_at' | 'question_count' | 'used'>,
  can: { create: boolean; edit: boolean; remove: boolean; send: boolean; config?: boolean },
): TemplateAction[] {
  const archived = !!t.archived_at;
  const out: TemplateAction[] = [can.edit && !archived ? 'edit' : 'open'];
  if (can.send && !archived && t.question_count > 0) out.push('send');
  if (t.question_count > 0) out.push('preview');
  if (can.create) out.push('duplicate');
  if (can.edit && !archived) out.push('default_tiers');
  if (can.edit) out.push(archived ? 'restore' : 'archive');
  if (can.remove && !t.used) out.push('delete');
  return out;
}
