// What the Regulatory Feed decides, apart from React so `node --test` pins it (feedModel.test.ts): the tabs and their true counts, what a person may do with an item in each state, the plain
// text of an item, what a source says about itself, and the assignees. Nothing here changes what a status means: New, Analyzed and Processed are the server's; "Not relevant" is `ignored`.
import type { FeedAnalysis, FeedAssignee, FeedCounts, FeedItem, FeedSource } from '../../regulatory-changes/_lib/types.ts';

export type FeedTab = 'new' | 'analyzed' | 'processed' | 'ignored' | 'all';
export const FEED_TABS: ReadonlyArray<{ value: FeedTab; label: string }> = [
  { value: 'new', label: 'New' }, { value: 'analyzed', label: 'Analyzed' }, { value: 'processed', label: 'Converted' }, { value: 'ignored', label: 'Not relevant' }, { value: 'all', label: 'All' },
];
/** The status the request asks for ('' = every item). */
export const statusOfTab = (tab: FeedTab): string => (tab === 'all' ? '' : tab);
export const isFeedTab = (v: string): v is FeedTab => FEED_TABS.some((t) => t.value === v);

/** The number beside a tab: the server's true count, not the length of the page on screen. null while the counts are not known. */
export function tabCount(counts: FeedCounts | undefined, tab: FeedTab): number | null {
  if (!counts) return null;
  return tab === 'all' ? counts.total : counts[tab];
}

/** The tab to open first: New when there is anything new, else the first tab that has something, else New. */
export function firstTab(counts: FeedCounts | undefined): FeedTab {
  if (!counts || counts.new > 0) return 'new';
  return (['analyzed', 'processed', 'ignored'] as const).find((t) => counts[t] > 0) ?? 'new';
}

// ── an item ──────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** An item's description as one plain paragraph: the feed's markup and entities taken out. */
export function plainText(raw: string | null | undefined): string {
  return String(raw ?? '')
    .replace(/<(?:script|style)\b[\s\S]*?<\/(?:script|style)>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&#0?39;|&apos;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}
export const descriptionOf = (item: Pick<FeedItem, 'description' | 'content'>): string => plainText(item.description) || plainText(item.content);

/** The AI answered but the answer could not be used (it said so in `error`): the item is "analyzed" to the server, but there is nothing to read. */
export const analysisFailed = (item: Pick<FeedItem, 'ai_analysis'>): boolean => !!item.ai_analysis && !!item.ai_analysis.error;
export const analysisOf = (item: Pick<FeedItem, 'ai_analysis'>): FeedAnalysis | null => (item.ai_analysis && !item.ai_analysis.error ? item.ai_analysis : null);

export interface ItemActions { analyze: 'analyze' | 'again' | null; convert: boolean; dismiss: boolean; restore: boolean; openChange: boolean }

/** What a person can do with an item. Analyze reads it (again after a failed reading); Convert makes a regulatory change from an analyzed item; Not relevant takes it out of New and Analyzed
 *  (never one that already became a change); Restore brings it back. A converted item opens its change. */
export function actionsOf(item: Pick<FeedItem, 'status' | 'ai_analysis' | 'regulatory_change_id'>): ItemActions {
  const converted = !!item.regulatory_change_id;
  return {
    analyze: item.status === 'new' ? 'analyze' : item.status === 'analyzed' && analysisFailed(item) ? 'again' : null,
    convert: item.status === 'analyzed' && !converted,
    dismiss: (item.status === 'new' || item.status === 'analyzed') && !converted,
    restore: item.status === 'ignored',
    openChange: converted,
  };
}

/** The sentence a convert says it did. */
export const convertedWords = (): { title: string; message: string } => ({ title: 'Regulatory change created', message: 'It is in Changes with the tasks the AI suggested.' });

// ── a source ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

export const parseAssignee = (value: string): FeedAssignee | null => {
  const [type, idText] = value.split(':');
  const id = Number(idText);
  return (type === 'user' || type === 'role') && Number.isFinite(id) && id > 0 ? { type, id } : null;
};
export const assigneeKey = (a: Pick<FeedAssignee, 'type' | 'id'>): string => `${a.type}:${a.id}`;

/** "Ayesha, Bilal +2" / "Unassigned". */
export function assigneeLabel(source: Pick<FeedSource, 'assignees'>): string {
  const list = source.assignees ?? [];
  if (list.length === 0) return 'Unassigned';
  const names = list.slice(0, 2).map((a) => a.name || (a.type === 'role' ? 'A role' : 'A person'));
  return `${names.join(', ')}${list.length > 2 ? ` +${list.length - 2}` : ''}`;
}

export const CATEGORIES = [
  { value: 'general', label: 'General' }, { value: 'press_releases', label: 'Press releases' }, { value: 'regulatory_policy', label: 'Regulatory policy' }, { value: 'notices', label: 'Notices' },
  { value: 'monetary_policy', label: 'Monetary policy' }, { value: 'enforcement', label: 'Enforcement' }, { value: 'guidance', label: 'Guidance' },
] as const;
export const categoryLabel = (v: string | null | undefined): string => CATEGORIES.find((c) => c.value === v)?.label ?? (v ? v.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()) : '—');

/** A feed URL a person typed: http(s) only, with a host. */
export function validFeedUrl(text: string): boolean {
  try { const u = new URL(text.trim()); return (u.protocol === 'https:' || u.protocol === 'http:') && !!u.hostname; } catch { return false; }
}

/** Why the Add feed form cannot be saved yet; '' when it can. */
export function feedFormProblem(f: { name: string; source_url: string; poll_interval_hours: number }): string {
  if (!f.name.trim()) return 'Give the feed a name.';
  if (!validFeedUrl(f.source_url)) return 'Enter the feed\'s address, starting with https://';
  if (!Number.isInteger(f.poll_interval_hours) || f.poll_interval_hours < 1 || f.poll_interval_hours > 168) return 'Check it every 1 to 168 hours.';
  return '';
}
