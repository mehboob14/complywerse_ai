// The Documents library's configuration of the facet explorer (components/records): which facets there are, what value(s) a document has in each, which options the rail
// lists, and how the filters of libraryModel.ts become the explorer's choice and rule. Pure (no React), so `node --test` checks it (libraryFacets.test.ts).
//
// The rule is libraryModel.matchesFilters: the facet engine decides the same documents (the test holds the two together for every facet and value of a 150-document corpus),
// and gives the live counts the rail shows: the number beside an option is what choosing it would show with the other filters as they are.
import { indexRows, type Chosen, type FacetIndex, type FacetSpec, type Rule } from '../../../../../components/records/facetEngine.ts';
import { departmentPickItems, departmentTree } from '../../../../../lib/departments.ts';
import { NO_DEPARTMENT, shownFrameworkIds } from './library.ts';
import {
  ATTESTATION_BUCKETS, ATTESTATION_LABEL, NO_FRAMEWORK, NO_OWNER, REVIEW_BUCKETS, REVIEW_BUCKET_LABEL, STAGE_ORDER,
  attestationBucket, classificationOptions, expiringSoon, frameworkOptions, haystack, reviewState, searchTerms, statusLabel, typeLabel,
  type FacetKey, type Filters, type FrameworkInfo, type LibDoc, type MatchContext, type Option,
} from './libraryModel.ts';

/** The facets in the order the rail lists them. */
export const RAIL_ORDER: readonly FacetKey[] = ['statuses', 'review', 'types', 'departments', 'frameworks', 'owners', 'attestation', 'classifications'];

export const FACET_TITLE: Record<FacetKey, string> = {
  statuses: 'Status', review: 'Review', types: 'Type', departments: 'Department', frameworks: 'Framework', owners: 'Owner', attestation: 'Attestation', classifications: 'Classification',
};

/** The facets that open with the rail (the others are one press away); the ones with many options get a search box. */
export const OPEN_AT_FIRST: readonly FacetKey[] = ['statuses', 'review', 'departments', 'frameworks'];
export const SEARCHABLE: readonly FacetKey[] = ['departments', 'frameworks', 'owners'];

/** department id (text) -> that department's own id and every department above it, as text. A document in a unit has the unit, its sub-department and its department as values,
 *  so choosing a department keeps everything under it (matchesDepartment's scope, read the other way round; the test holds the two together). */
export function departmentsAbove(departments: readonly { id: number; name: string; parent_department_id?: number | null }[] | null | undefined): Record<string, readonly string[]> {
  const all = departments ?? [];
  const tree = departmentTree(all);
  const out: Record<string, readonly string[]> = {};
  all.forEach((d) => { out[String(d.id)] = tree.path(d.id).map((p) => String(p.id)); });
  return out;
}

export interface FacetContext {
  now: Date;
  /** document id -> attestation % (the lean rows carry it) */
  coverage: Record<number, number>;
  /** departmentsAbove(...) */
  above: Record<string, readonly string[]>;
}

export function documentSpecs(ctx: FacetContext): FacetSpec<LibDoc>[] {
  const owned: Record<FacetKey, FacetSpec<LibDoc>> = {
    statuses: { key: 'statuses', values: (d) => [d.status], passesUnchosen: (d) => d.status !== 'archived' },                     // archived stands alone: out until chosen
    review: { key: 'review', values: (d) => { const b = reviewState(d, ctx.now).bucket; return b ? [b] : []; } },
    types: { key: 'types', values: (d) => [d.doc_type] },
    departments: {
      key: 'departments',
      values: (d) => (d.department_id == null ? [NO_DEPARTMENT] : (ctx.above[String(d.department_id)] ?? [String(d.department_id)])),
    },
    frameworks: { key: 'frameworks', values: (d) => { const ids = shownFrameworkIds(d); return ids.length ? ids.map(String) : [NO_FRAMEWORK]; } },
    owners: { key: 'owners', values: (d) => [d.owner_id == null ? NO_OWNER : String(d.owner_id)] },
    attestation: { key: 'attestation', values: (d) => [attestationBucket(ctx.coverage[d.id])] },
    classifications: { key: 'classifications', values: (d) => [(d.classification ?? '').toLowerCase()] },
  };
  return RAIL_ORDER.map((k) => owned[k]);
}

/** What the person chose in the facets. */
export function chosenOf(f: Filters): Chosen {
  return {
    statuses: f.statuses, review: f.review, types: f.types, departments: f.departments, frameworks: f.frameworks, owners: f.owners, attestation: f.attestation, classifications: f.classifications,
  };
}

/** The filters that are not facets, as the rule every document must pass: the search, mine, expiring, the server's attention list, and the documents waiting for the person. */
export function ruleOf(f: Filters, ctx: Pick<MatchContext, 'now' | 'me' | 'attention' | 'waiting'>): Rule<LibDoc> {
  const flags = f.mine || f.expiring || !!f.attention || f.waiting;
  return {
    terms: searchTerms(f.search),
    extra: flags
      ? (d) => {
          if (f.expiring && !expiringSoon(d, ctx.now)) return false;
          if (f.attention && !ctx.attention?.has(d.id)) return false;
          if (f.waiting && !ctx.waiting?.has(d.id)) return false;
          if (f.mine && !(ctx.me != null && (d.owner_id === ctx.me || d.author_id === ctx.me))) return false;
          return true;
        }
      : undefined,
  };
}

/** The index of the documents: each one's values in every facet and its folded search text. Built when the documents or the names they read change, never on a keystroke. */
export function indexDocuments(docs: readonly LibDoc[], ctx: FacetContext, lookups: MatchContext): FacetIndex<LibDoc> {
  return indexRows(docs, documentSpecs(ctx), (d) => haystack(d, lookups));
}

// ─── The options the rail lists ──────────────────────────────────────────────────────────────────────────────────────────

export interface RailOption extends Option {
  /** levels of indentation (the department tree) */
  indent?: number;
  /** the whole name when the label is cut to its own part */
  title?: string;
}

export interface RailInput {
  docs: readonly LibDoc[];
  /** every person who can own a document (the list the owner filter always had) */
  people: readonly { id: number; display_name: string; email?: string }[];
  departments: readonly { id: number; name: string; parent_department_id?: number | null; is_active?: boolean }[] | null | undefined;
  levelNames?: readonly string[];
  frameworks: Record<string, FrameworkInfo>;
}

const STATUS_FIRST: readonly string[] = [...STAGE_ORDER, 'expired'];
const KNOWN_TYPES = ['policy', 'standard', 'procedure', 'guideline', 'charter', 'framework'];

export function railOptions(input: RailInput): Record<FacetKey, RailOption[]> {
  const { docs, people, departments, frameworks } = input;
  const present = (pick: (d: LibDoc) => string | null | undefined) => Array.from(new Set(docs.map(pick).filter((v): v is string => !!v)));
  const otherStatuses = present((d) => d.status).filter((s) => !STATUS_FIRST.includes(s) && s !== 'archived').sort();
  const otherTypes = present((d) => d.doc_type).filter((t) => !KNOWN_TYPES.includes(t)).sort();
  const known = new Set(people.map((p) => String(p.id)));
  const missingOwners = new Map<string, string>();
  docs.forEach((d) => { if (d.owner_id != null && !known.has(String(d.owner_id)) && !missingOwners.has(String(d.owner_id))) missingOwners.set(String(d.owner_id), d.owner_name || `Person ${d.owner_id}`); });
  const tree = departmentTree(departments ?? []);
  const departmentItems = departmentPickItems(departments ?? [], { labels: input.levelNames, keep: docs.map((d) => d.department_id) });
  return {
    statuses: [...STATUS_FIRST, ...otherStatuses, 'archived'].map((v) => ({ value: v, label: statusLabel(v), title: v === 'archived' ? 'Archived documents are shown on their own' : undefined })),
    review: REVIEW_BUCKETS.map((v) => ({ value: v, label: REVIEW_BUCKET_LABEL[v] })),
    types: [...KNOWN_TYPES, ...otherTypes].map((v) => ({ value: v, label: typeLabel(v) })),
    departments: [
      { value: NO_DEPARTMENT, label: 'No department' },
      ...departmentItems.map((item) => {
        const path = item.label.split(' › ');
        return { value: item.value, label: path[path.length - 1], title: item.label, subLabel: item.subLabel, indent: Math.max(0, tree.level(Number(item.value)) - 1) };
      }),
    ],
    frameworks: frameworkOptions(docs, frameworks).map((o) => ({ ...o, title: o.subLabel && o.subLabel !== o.label ? o.subLabel : undefined })),
    owners: [
      { value: NO_OWNER, label: 'No owner' },
      ...people.map((p) => ({ value: String(p.id), label: p.display_name || p.email || `Person ${p.id}`, subLabel: p.email })),
      ...Array.from(missingOwners, ([value, label]) => ({ value, label })),
    ],
    attestation: ATTESTATION_BUCKETS.map((v) => ({ value: v, label: ATTESTATION_LABEL[v] })),
    classifications: classificationOptions(docs),
  };
}

/** The values a facet's option list may be ordered by: the person's choices first, then (for long lists) the most documents, then the name; "none" last. The tree and the
 *  short lists keep their own order. */
export function orderedOptions(facet: FacetKey, options: readonly RailOption[], chosen: readonly string[], count: (value: string) => number): RailOption[] {
  if (facet !== 'frameworks' && facet !== 'owners') return options.slice();
  const none = new Set([NO_FRAMEWORK, NO_OWNER]);
  const rank = (o: RailOption) => (chosen.includes(o.value) ? 0 : none.has(o.value) ? 2 : 1);
  return options.slice().sort((a, b) => rank(a) - rank(b) || count(b.value) - count(a.value) || a.label.localeCompare(b.label, undefined, { sensitivity: 'base', numeric: true }));
}
