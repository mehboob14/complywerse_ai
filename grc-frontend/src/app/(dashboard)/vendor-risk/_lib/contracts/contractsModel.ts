// What the Contracts page works out from the register the server gives (GET /vendor-risk/contracts: every contract with its state, the counts, the annual value in force): which are the
// inbox ("needs a decision"), the four views and what each keeps, the type and the search, the order a header asks for, and the page's address (view, type, q, contract, sort). Pure, so
// `node --test` runs contractsModel.test.ts against it. The states are the server's (a contract is lapsed, decide, ending, in force, draft or ended); the page never works one out again.
import { integer, oneOf, sortOf, text, type Schema } from '../../../../../lib/addressState.ts';
import { parseUtc } from '../../../../../lib/serverTime.ts';
import type { ContractRow, ContractState } from './shared.ts';

/** What needs a person now: past its date, notice due, or ending within the inbox window. */
export const INBOX: readonly ContractState[] = ['lapsed', 'decide', 'ending'];
const ORDER: readonly ContractState[] = ['lapsed', 'decide', 'ending', 'in_force', 'draft', 'ended'];

export type ViewKey = 'current' | 'draft' | 'ended' | 'all';
export const VIEWS: ReadonlyArray<{ key: ViewKey; label: string; states: readonly ContractState[] }> = [
  { key: 'current', label: 'In force', states: ['lapsed', 'decide', 'ending', 'in_force'] },
  { key: 'draft', label: 'Drafts', states: ['draft'] },
  { key: 'ended', label: 'Ended', states: ['ended'] },
  { key: 'all', label: 'All', states: ORDER },
];

export const SORT_KEYS = ['supplier', 'contract', 'started', 'ends', 'notice', 'value', 'state'] as const;

/** The page's address: `?view=draft&type=dpa&q=acme&contract=7&sort=ends:asc`. `contract` opens one contract (reminders and the attention queue link straight to it). */
export const CONTRACT_SCHEMA: Schema = {
  view: oneOf(VIEWS.map((v) => v.key), 'current'),
  type: text(),
  q: text(),
  contract: integer(0, { min: 1 }),
  sort: sortOf(SORT_KEYS, null),
};

export interface Query { view: ViewKey; type: string; q: string }

/** The contracts of the inbox, in the order the server sent them. */
export const inboxOf = (items: readonly ContractRow[]): ContractRow[] => items.filter((c) => INBOX.includes(c.state));

const hay = (c: ContractRow): string[] => [c.vendor.name, c.title, c.reference, c.type_label].map((x) => (x || '').toLowerCase());

/** The contracts a view, a type and a search keep. */
export function filterContracts(items: readonly ContractRow[], { view, type, q }: Query): ContractRow[] {
  const states = (VIEWS.find((v) => v.key === view) ?? VIEWS[0]).states;
  const needle = q.trim().toLowerCase();
  return items.filter((c) => states.includes(c.state) && (!type || c.contract_type === type) && (!needle || hay(c).some((x) => x.includes(needle))));
}

/** The contract types that are in use, in order. */
export const typesOf = (items: readonly ContractRow[]): string[] => Array.from(new Set(items.map((c) => c.contract_type))).sort();

/** How many contracts each view holds (from the server's counts, so the number is the truth, not the length of what is loaded). */
export function viewCounts(counts: Record<ContractState, number> | undefined): Record<ViewKey, number> | null {
  if (!counts) return null;
  const sum = (states: readonly ContractState[]) => states.reduce((n, s) => n + (counts[s] ?? 0), 0);
  return Object.fromEntries(VIEWS.map((v) => [v.key, sum(v.states)])) as Record<ViewKey, number>;
}

const ms = (iso?: string | null): number | null => parseUtc(iso)?.getTime() ?? null;

/** What a column holds for sorting. */
export function sortValue(c: ContractRow, key: string): string | number | null {
  switch (key) {
    case 'supplier': return c.vendor.name;
    case 'contract': return c.title || c.type_label;
    case 'started': return ms(c.effective_date);
    case 'ends': return ms(c.ends_on);
    case 'notice': return ms(c.act_by);
    case 'value': return c.annual_value;
    case 'state': return ORDER.indexOf(c.state);
    default: return null;
  }
}
