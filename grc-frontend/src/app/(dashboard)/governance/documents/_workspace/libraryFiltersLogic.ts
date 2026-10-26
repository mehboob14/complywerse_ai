// The words and rules of the library's filter bar, without React, so `node --test` checks them (libraryFiltersLogic.test.ts): the
// chips that say what is being filtered on and how each is taken off, whether a view's name is acceptable, and the lines the bar
// writes ("12 of 48 documents"). LibraryFilters.tsx only draws what this decides; what each filter MEANS lives in libraryModel.ts.
import {
  ATTESTATION_LABEL, REVIEW_BUCKET_LABEL, nextStatuses,
  type FacetKey, type Filters, type Option,
} from './libraryModel.ts';

/** What the dropdowns offer (and what the chips read their words from). */
export interface FilterOptions {
  types: Option[];
  statuses: Option[];
  owners: Option[];
  departments: Option[];
  frameworks: Option[];
  classifications: Option[];
}

export interface FilterChip {
  /** unique among the chips shown */
  key: string;
  facet: FacetKey | 'search' | 'mine';
  /** the one value this chip stands for (the search text for the search chip) */
  value: string;
  /** "Type: Policy", "Search: “data”", "My documents" */
  label: string;
}

// Lookups are Maps: a value comes from the address (?type=constructor) and must not find something on Object.prototype.
const labels = (options: readonly Option[]) => new Map(options.map((o) => [o.value, o.label]));
const fixed = (record: Record<string, string>) => new Map(Object.entries(record));

/** The chips, in the order the filters sit in the bar (then the search, then "My documents"). */
export function filterChips(filters: Filters, options: FilterOptions): FilterChip[] {
  const facets: [FacetKey, string, Map<string, string>][] = [
    ['types', 'Type', labels(options.types)],
    ['statuses', 'Status', labels(options.statuses)],
    ['owners', 'Owner', labels(options.owners)],
    ['departments', 'Department', labels(options.departments)],
    ['frameworks', 'Framework', labels(options.frameworks)],
    ['review', 'Review', fixed(REVIEW_BUCKET_LABEL)],
    ['attestation', 'Attestation', fixed(ATTESTATION_LABEL)],
    ['classifications', 'Classification', labels(options.classifications)],
  ];
  const chips: FilterChip[] = [];
  for (const [facet, noun, words] of facets) {
    for (const value of filters[facet] as string[]) {
      chips.push({ key: `${facet}:${value}`, facet, value, label: `${noun}: ${words.get(value) ?? value}` });
    }
  }
  const query = filters.search.trim();
  if (query) chips.push({ key: 'search', facet: 'search', value: filters.search, label: `Search: “${query}”` });
  if (filters.mine) chips.push({ key: 'mine', facet: 'mine', value: 'mine', label: 'My documents' });
  return chips;
}

/** The filters without the value one chip stands for (the status list keeps the rule that Archived stands alone). */
export function removeChip(filters: Filters, chip: FilterChip): Filters {
  if (chip.facet === 'search') return { ...filters, search: '' };
  if (chip.facet === 'mine') return { ...filters, mine: false };
  const left = (filters[chip.facet] as string[]).filter((v) => v !== chip.value);
  if (chip.facet === 'statuses') return { ...filters, statuses: nextStatuses(filters.statuses, left) };
  return { ...filters, [chip.facet]: left } as Filters;
}

export const VIEW_NAME_MAX = 40;

/** Why a name cannot be given to a saved view; null when it can. `existingNames`: the person's own views (case does not tell two apart). */
export function validViewName(name: string, existingNames: readonly string[]): string | null {
  const wanted = name.trim();
  if (!wanted) return 'Give the view a name.';
  if (wanted.length > VIEW_NAME_MAX) return `Use ${VIEW_NAME_MAX} characters or fewer.`;
  if (existingNames.some((n) => n.trim().toLowerCase() === wanted.toLowerCase())) return 'You already have a view with this name.';
  return null;
}

const count = (n: number) => n.toLocaleString('en-US');
const documents = (n: number) => `${count(n)} ${n === 1 ? 'document' : 'documents'}`;

/** The line above the table: "48 documents", or "12 of 48 documents" while filtering. */
export function resultText(shown: number, total: number, filtering: boolean): string {
  return filtering ? `${count(shown)} of ${documents(total)}` : documents(shown);
}

/** What the Export CSV button says it does. */
export function exportTitle(shown: number, canExport: boolean): string {
  return canExport ? `Exports the ${documents(shown)} shown` : 'Nothing to export';
}
