// "Group by" of the Governance → Documents library (the Workspace), without React, so `node --test` checks it (libraryGroups.test.ts): which group a document is in for each way of
// grouping, the groups in a sensible order, and what a group header says about its documents (how many, how many reviews are overdue, how many people have acknowledged, how
// many have no owner). Used by the grouped List (GroupedRows.tsx).
//
// What a number means is the library's own and is USED here, not copied: a review is overdue by libraryModel.reviewState (the rule of the Review filter, the folders and the
// Governance overview); a document's frameworks are library.shownFrameworkIds; the attestation of a document is what the server sent with it (`attestation`, the coverage map's
// numbers) and a group's "Acknowledged" is those numbers added up (people who acknowledged / people asked, over the documents that have an acknowledgement request) and rounded by
// libraryKpisLogic.percent (never 0% or 100% unless it is). No percentage is invented: a group none of whose documents has a request has none.
//
// A document with several frameworks is in each of them (counted under each); every other grouping puts a document in exactly one group. Inside a group the documents keep the
// order they were given in (the page sorts first).
import { buildTree, treeEntries, type TreeDoc, type TreeEntry } from './docTree.ts';
import { shownFrameworkIds } from './library.ts';
import { percent } from './libraryKpisLogic.ts';
import { monthIndex, monthLabel } from './libraryCalendar.ts';
import { OPEN_UP_TO, shownLimit } from './libraryFolders.ts';
import {
  NO_DEPARTMENT, NO_FRAMEWORK, NO_OWNER, STAGE_ORDER, frameworkChip, reviewState, statusLabel, typeLabel,
  type Filters, type GroupKey, type LibDoc, type Lookups,
} from './libraryModel.ts';
import { isCut } from './libraryNumbers.ts';
import { formatCount } from '../../../../../lib/format.ts';

// ─── Words ───────────────────────────────────────────────────────────────────────────────────────────────────────────────

export const GROUP_LABEL: Record<GroupKey, string> = {
  none: 'None', department: 'Department', status: 'Status', owner: 'Owner', classification: 'Classification', type: 'Type', framework: 'Framework', review: 'Review month',
};
/** The order the Group by menu lists them. */
export const GROUP_MENU: readonly GroupKey[] = ['none', 'department', 'status', 'owner', 'classification', 'type', 'framework', 'review'];

/** The menu button: "Group: Department". */
export const groupButtonLabel = (key: GroupKey): string => `Group: ${GROUP_LABEL[key]}`;

/** The (i) beside the grouped list: what the two figures on a group's line are, and what is special about the grouping chosen. */
export function groupNote(key: GroupKey): string {
  const base = 'Overdue counts the reviews past their date. Acknowledged is the people who confirmed out of the people asked, over the documents that have an acknowledgement request.';
  if (key === 'framework') return `${base} A document with several frameworks is counted under each of them.`;
  if (key === 'review') return `${base} Documents with no review owed (drafts, expired and archived ones) are in Not published.`;
  return base;
}

// ─── What the rules read ─────────────────────────────────────────────────────────────────────────────────────────────────

/** A document as grouping reads it (GovDoc satisfies it): a lean row carries the document's attestation. */
export type GroupDoc = LibDoc & { attestation?: { pct: number; done: number; total: number } | null };

/** What grouping needs beyond the document: the names (Lookups) and, for an older server that sends no `attestation` on the rows, the coverage map's counts. */
export type GroupLookups = Pick<Lookups, 'departments' | 'frameworks'> & Partial<Pick<Lookups, 'departmentPaths'>> & { counts?: Record<number, { done: number; total: number }> };

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

/** How many people a document's acknowledgement request asked and how many have acknowledged; null: no request (never read as 0 of 0). */
export function attestationOf(d: GroupDoc, lk: Pick<GroupLookups, 'counts'> = {}): { done: number; total: number } | null {
  const a = d.attestation;
  if (a && finite(a.done) && finite(a.total) && a.total > 0) return { done: a.done, total: a.total };
  const c = lk.counts?.[d.id];
  return c && finite(c.done) && finite(c.total) && c.total > 0 ? { done: c.done, total: c.total } : null;
}

// ─── Which group a document is in ────────────────────────────────────────────────────────────────────────────────────────

export interface GroupTag {
  /** the value inside its grouping: a department's id, a status, `2026-11`, `none` */
  id: string;
  label: string;
  /** the longer name, for a tooltip (a framework's full name, a department's path) */
  title?: string;
  /** the group of the documents that have none ("No owner"): always last */
  none: boolean;
  /** where it sorts among the others of its grouping, when the order is not by size (the life cycle, public to restricted, the calendar) */
  rank: number | null;
}

const CLASS_ORDER = ['public', 'internal', 'confidential', 'restricted'];
const STATUS_AFTER = ['expired', 'exception_applied', 'review_required', 'archived'];
const statusRank = (s: string): number => {
  const i = (STAGE_ORDER as readonly string[]).indexOf(s);
  if (i >= 0) return i;
  const j = STATUS_AFTER.indexOf(s);
  return j >= 0 ? STAGE_ORDER.length + j : STAGE_ORDER.length + STATUS_AFTER.length;
};
const cap = (s: string): string => (s ? s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' ') : s);

/**
 * The group(s) of one document for a grouping: one, except for frameworks (a document is in each of its frameworks, or in "No framework"). `none` has no groups: the list is flat.
 * A department the lookups do not know is "No department" (the Folders view does the same); `now` is the instant the review month is read at.
 */
export function groupOf(d: GroupDoc, key: GroupKey, lk: Pick<GroupLookups, 'departments' | 'frameworks' | 'departmentPaths'>, now: Date = new Date()): GroupTag[] {
  switch (key) {
    case 'none': return [];
    case 'department': {
      const id = d.department_id != null ? String(d.department_id) : null;
      const name = id != null ? lk.departments[id] : undefined;
      if (id == null || !name) return [{ id: NO_DEPARTMENT, label: 'No department', none: true, rank: null }];
      const path = lk.departmentPaths?.[id];
      return [{ id, label: path || name, title: path && path !== name ? path : undefined, none: false, rank: null }];
    }
    case 'status': { const w = statusLabel(d.status); return [{ id: d.status, label: w.charAt(0).toUpperCase() + w.slice(1), none: false, rank: statusRank(d.status) }]; }      // a status the library has no word for reads "review required": a header starts with a capital
    case 'owner':
      return d.owner_id == null
        ? [{ id: NO_OWNER, label: 'No owner', none: true, rank: null }]
        : [{ id: String(d.owner_id), label: d.owner_name?.trim() || 'Unnamed owner', none: false, rank: null }];
    case 'classification': {
      const c = (d.classification ?? '').trim().toLowerCase();
      if (!c) return [{ id: 'none', label: 'No classification', none: true, rank: null }];
      const i = CLASS_ORDER.indexOf(c);
      return [{ id: c, label: cap(c), none: false, rank: i >= 0 ? i : CLASS_ORDER.length }];
    }
    case 'type': return [{ id: d.doc_type || 'none', label: d.doc_type ? typeLabel(d.doc_type) : 'No type', none: !d.doc_type, rank: null }];
    case 'framework': {
      const ids = Array.from(new Set(shownFrameworkIds(d)));
      if (ids.length === 0) return [{ id: NO_FRAMEWORK, label: 'No framework', none: true, rank: null }];
      return ids.map((id) => {
        const c = frameworkChip(id, lk.frameworks);
        return { id: String(id), label: c.known ? c.label : 'Unnamed framework', title: c.known && c.name !== c.label ? c.name : undefined, none: false, rank: null };
      });
    }
    case 'review': {
      const s = reviewState(d, now);
      if (!s.bucket) return [{ id: 'not-in-force', label: 'Not published', none: true, rank: 1 }];
      if (!s.due) return [{ id: 'none', label: 'No review date', none: true, rank: 0 }];
      const y = s.due.getUTCFullYear();
      const m = s.due.getUTCMonth();
      return [{ id: `${y}-${String(m + 1).padStart(2, '0')}`, label: monthLabel(y, m), none: false, rank: monthIndex(s.due) }];
    }
  }
}

// ─── The groups ──────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface Acknowledged {
  /** whole percent, by libraryKpisLogic.percent */
  pct: number;
  done: number;
  total: number;
  /** how many of the group's documents have an acknowledgement request */
  documents: number;
}

export interface DocGroup<D> {
  /** unique across groupings and stable: `owner:5`, `review:2026-11`, `department:none`: what a header's open / closed state is kept under */
  key: string;
  /** the value inside its grouping (see GroupTag.id): what "Show all" filters on */
  id: string;
  label: string;
  title?: string;
  none: boolean;
  docs: D[];
  /** documents in the group (a document with several frameworks counts in each) */
  count: number;
  /** reviews that are overdue (libraryModel.reviewState) */
  overdue: number;
  /** null: no document of the group has an acknowledgement request */
  acknowledged: Acknowledged | null;
  withoutOwner: number;
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/** The documents in their groups, in a sensible order: statuses in life-cycle order, classifications public to restricted, months by the calendar, everything else the largest group first
 *  and then by name; the group of "none of these" ("No owner") last. `none`: no groups. */
export function groupDocs<D extends GroupDoc>(docs: readonly D[], key: GroupKey, lk: GroupLookups, now: Date = new Date()): DocGroup<D>[] {
  if (key === 'none') return [];
  const found = new Map<string, { tag: GroupTag; docs: D[] }>();
  for (const d of docs) {
    for (const tag of groupOf(d, key, lk, now)) {
      const hit = found.get(tag.id);
      if (hit) hit.docs.push(d);
      else found.set(tag.id, { tag, docs: [d] });
    }
  }
  const ranked = key === 'status' || key === 'classification' || key === 'review';
  const made = Array.from(found.values()).map(({ tag, docs: inGroup }) => {
    let overdue = 0;
    let withoutOwner = 0;
    let done = 0;
    let total = 0;
    let withRequest = 0;
    for (const d of inGroup) {
      if (reviewState(d, now).bucket === 'overdue') overdue += 1;
      if (d.owner_id == null) withoutOwner += 1;
      const a = attestationOf(d, lk);
      if (a) { done += a.done; total += a.total; withRequest += 1; }
    }
    const group: DocGroup<D> = {
      key: `${key}:${tag.id}`, id: tag.id, label: tag.label, title: tag.title, none: tag.none, docs: inGroup, count: inGroup.length, overdue, withoutOwner,
      acknowledged: total > 0 ? { pct: percent(done, total), done, total, documents: withRequest } : null,
    };
    return { group, rank: tag.rank ?? 0 };
  });
  made.sort((a, b) => {
    if (a.group.none !== b.group.none) return a.group.none ? 1 : -1;
    if (ranked || a.group.none) {
      if (a.rank !== b.rank) return a.rank - b.rank;
    } else if (a.group.count !== b.group.count) return b.group.count - a.group.count;
    return collator.compare(a.group.label, b.group.label);
  });
  return made.map((m) => m.group);
}

/** The line a group's header is read as: "Operations, 12 documents, 3 overdue, 80% acknowledged, 2 without an owner". */
export function groupAria(g: Pick<DocGroup<unknown>, 'label' | 'count' | 'overdue' | 'acknowledged' | 'withoutOwner'>): string {
  const parts = [g.label, `${g.count} ${g.count === 1 ? 'document' : 'documents'}`];
  if (g.overdue > 0) parts.push(`${g.overdue} overdue`);
  if (g.acknowledged) parts.push(`${g.acknowledged.pct}% acknowledged`);
  if (g.withoutOwner > 0) parts.push(`${g.withoutOwner} without an owner`);
  return parts.join(', ');
}

/** The count beside the grouped list's controls: "6 groups · 128 documents"; cut, "… in the 1,000 loaded". `documents` counts each document once. */
export function groupsLine({ groups, documents, loaded, total }: { groups: number; documents: number; loaded: number; total: number | null | undefined }): string {
  const docsWord = `${formatCount(documents)} ${documents === 1 ? 'document' : 'documents'}`;
  return `${formatCount(groups)} ${groups === 1 ? 'group' : 'groups'} · ${docsWord}${isCut(loaded, total) ? ` in the ${formatCount(loaded)} loaded` : ''}`;
}

/** What "Show all" on a group sets in the library's own filters (it replaces that facet), or null where the filters cannot say it: a classification that is not recorded, a month,
 *  "Not published". A department takes in the departments under it, as the Department filter always does. */
export function showAllPatch(key: GroupKey, g: Pick<DocGroup<unknown>, 'id' | 'none'>): Partial<Filters> | null {
  switch (key) {
    case 'none': return null;
    case 'department': return { departments: [g.none ? NO_DEPARTMENT : g.id] };
    case 'status': return { statuses: [g.id] };
    case 'owner': return { owners: [g.none ? NO_OWNER : g.id] };
    case 'classification': return g.none ? null : { classifications: [g.id] };
    case 'type': return g.none ? null : { types: [g.id] };
    case 'framework': return { frameworks: [g.none ? NO_FRAMEWORK : g.id] };
    case 'review': return g.id === 'none' ? { review: ['unscheduled'] } : null;
  }
}

/** The documents of the groups in the order they are shown, each once (a document of two frameworks is listed in the first): what the CSV and the details panel's next / previous follow. */
export function groupedOrder<D extends { id: number }>(groups: readonly Pick<DocGroup<D>, 'docs'>[]): D[] {
  const seen = new Set<number>();
  const out: D[] = [];
  for (const g of groups) for (const d of g.docs) if (!seen.has(d.id)) { seen.add(d.id); out.push(d); }
  return out;
}

// ─── Open and closed ─────────────────────────────────────────────────────────────────────────────────────────────────────

/** What the person opened or closed (group key); kept by the page for as long as it is open. A group nobody chose is open when the library is short (libraryFolders.OPEN_UP_TO) and closed when
 *  it is long: the headers alone are then a table of the groups' figures. */
export interface GroupFold { open: ReadonlySet<string>; shut: ReadonlySet<string> }
export const NO_FOLD: GroupFold = { open: new Set(), shut: new Set() };

export function groupIsOpen(f: GroupFold, key: string, docCount: number): boolean {
  if (f.open.has(key)) return true;
  if (f.shut.has(key)) return false;
  return docCount <= OPEN_UP_TO;
}
export function flipGroup(f: GroupFold, key: string, docCount: number): GroupFold {
  const open = new Set(f.open);
  const shut = new Set(f.shut);
  if (groupIsOpen(f, key, docCount)) { open.delete(key); shut.add(key); } else { shut.delete(key); open.add(key); }
  return { open, shut };
}
/** Expand all / Collapse all over the groups shown. */
export const setAllGroups = (keys: readonly string[], open: boolean): GroupFold => ({ open: new Set(open ? keys : []), shut: new Set(open ? [] : keys) });

// ─── What is drawn ───────────────────────────────────────────────────────────────────────────────────────────────────────

export interface GroupTree<D extends TreeDoc> {
  /** the documents whose row is drawn in this group, at the top of their tree (documents nest under their parent where both are in the group) */
  top: D[];
  entries: TreeEntry<D>[];
  at: Map<number, TreeEntry<D>>;
  /** documents the group counts but whose row is drawn under an earlier group (a document with several frameworks has ONE row, in the first of them): a slim line says where */
  also: { doc: D; home: string }[];
}

/**
 * The trees of the groups: each document gets its full row (the one with a tick box, a menu and the documents under it) in the FIRST group it is in, so a row's id is never on the page
 * twice; the other groups that count it (frameworks only) list it as a slim line that says where its row is.
 */
export function groupTrees<D extends GroupDoc & TreeDoc>(groups: readonly DocGroup<D>[]): Map<string, GroupTree<D>> {
  const home = new Map<number, string>();
  for (const g of groups) for (const d of g.docs) if (!home.has(d.id)) home.set(d.id, g.key);
  const label = new Map(groups.map((g) => [g.key, g.label]));
  const out = new Map<string, GroupTree<D>>();
  for (const g of groups) {
    const mine = g.docs.filter((d) => home.get(d.id) === g.key);
    const roots = buildTree(mine, null);
    const entries = treeEntries(roots);
    out.set(g.key, {
      top: roots.map((n) => n.doc), entries, at: new Map(entries.map((e) => [e.doc.id, e])),
      also: g.docs.filter((d) => home.get(d.id) !== g.key).map((d) => ({ doc: d, home: label.get(home.get(d.id) as string) ?? '' })),
    });
  }
  return out;
}

export type GroupPlan<D extends TreeDoc, R> =
  | { kind: 'group'; group: DocGroup<D>; open: boolean }
  | { kind: 'docs'; group: DocGroup<D>; tree: GroupTree<D>; rows: R[]; also: { doc: D; home: string }[]; /** top-level lines not listed yet */ remaining: number };

/**
 * The groups in the order they are drawn: a group's header, then (when it is open) its documents: the first `limit` lines (a full row for each document at the top of the group, then the
 * slim lines), with "Show N more" for the rest. `rowsOf` gives the table's rows (with the documents under the open ones) for the top-level documents it is handed.
 */
export function planGroups<D extends GroupDoc & TreeDoc, R>(groups: readonly DocGroup<D>[], trees: ReadonlyMap<string, GroupTree<D>>, o: {
  isOpen: (g: DocGroup<D>) => boolean;
  extra: Record<string, number>;
  rowsOf: (g: DocGroup<D>, top: readonly D[]) => R[];
}): GroupPlan<D, R>[] {
  const out: GroupPlan<D, R>[] = [];
  for (const g of groups) {
    const open = o.isOpen(g);
    out.push({ kind: 'group', group: g, open });
    const tree = trees.get(g.key);
    if (!open || !tree) continue;
    const lines = tree.top.length + tree.also.length;
    if (lines === 0) continue;
    const limit = shownLimit(o.extra[g.key]);
    const fullShown = tree.top.slice(0, limit);
    out.push({
      kind: 'docs', group: g, tree, rows: o.rowsOf(g, fullShown), also: tree.also.slice(0, Math.max(0, limit - tree.top.length)), remaining: Math.max(0, lines - limit),
    });
  }
  return out;
}

