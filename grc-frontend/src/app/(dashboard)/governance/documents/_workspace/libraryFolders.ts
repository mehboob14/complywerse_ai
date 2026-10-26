// The Folders view of the Governance → Documents library: the documents grouped into a folder for each department (a department under
// another one is a folder inside it), what a folder counts, which folders are open, and what "Move to…" does. Pure (no React), so
// `node --test` runs libraryFolders.test.ts against it. The table's rules stay where they are and are USED here, not copied: which
// documents match is libraryModel.matchesFilters (the page passes the ids), how documents nest under each other is docTree.buildTree
// (once per folder), when a review is overdue is libraryModel.reviewState. This file decides which folders there are, what is in
// them and how they count.
import { buildTree, treeEntries, type TreeDoc, type TreeEntry } from './docTree.ts';
import { fold, reviewState, type LibDoc, type LibraryViewId } from './libraryModel.ts';
import type { DrawnRow } from './libraryTableLogic.ts';

export type FolderDoc = LibDoc & TreeDoc;

/** The fields of a department these rules read (GET /admin/departments sends more). */
export interface FolderDepartment {
  id: number;
  name: string;
  parent_department_id?: number | null;
  is_active?: boolean;
}

// ─── Counting ────────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface FolderCounts {
  /** documents that match the search and filters (a parent shown only for the documents under it is not counted) */
  docs: number;
  draft: number;
  /** pending_review + pending_approval */
  inReview: number;
  approved: number;
  published: number;
  expired: number;
  archived: number;
  /** an exception applied, or a status this page does not know */
  other: number;
  /** a review is owed and its date has passed: libraryModel.reviewState's rule, the one the library's Review filter uses */
  overdue: number;
}

const noCounts = (): FolderCounts => ({ docs: 0, draft: 0, inReview: 0, approved: 0, published: 0, expired: 0, archived: 0, other: 0, overdue: 0 });
const plus = (a: FolderCounts, b: FolderCounts): FolderCounts => ({
  docs: a.docs + b.docs, draft: a.draft + b.draft, inReview: a.inReview + b.inReview, approved: a.approved + b.approved,
  published: a.published + b.published, expired: a.expired + b.expired, archived: a.archived + b.archived, other: a.other + b.other,
  overdue: a.overdue + b.overdue,
});

function tally(c: FolderCounts, d: LibDoc, now: Date): void {
  c.docs += 1;
  switch (d.status) {
    case 'draft': c.draft += 1; break;
    case 'pending_review': case 'pending_approval': c.inReview += 1; break;
    case 'approved': c.approved += 1; break;
    case 'published': c.published += 1; break;
    case 'expired': c.expired += 1; break;
    case 'archived': c.archived += 1; break;
    default: c.other += 1;
  }
  if (reviewState(d, now).bucket === 'overdue') c.overdue += 1;
}

const STATUS_WORDS: [Exclude<keyof FolderCounts, 'docs' | 'overdue'>, string][] = [
  ['published', 'published'], ['approved', 'approved'], ['inReview', 'in review'], ['draft', 'draft'], ['expired', 'expired'],
  ['archived', 'archived'], ['other', 'other'],
];

/** ["3 published", "2 draft"]: the statuses a folder holds, most settled first; none where it holds none. */
const statusParts = (c: FolderCounts): string[] => STATUS_WORDS.filter(([key]) => c[key] > 0).map(([key, word]) => `${c[key]} ${word}`);

/** "3 published · 2 draft" */
export const statusSummary = (c: FolderCounts): string => statusParts(c).join(' · ');

const documents = (n: number) => `${n} ${n === 1 ? 'document' : 'documents'}`;

// ─── The folders ─────────────────────────────────────────────────────────────────────────────────────────────────────────

export const NO_DEPARTMENT_KEY = 'none';
export const NO_DEPARTMENT_NAME = 'No department';
/** A folder's key: stable across reloads (it is what the person's open/closed choices are remembered under). */
export const folderKey = (departmentId: number | null): string => (departmentId == null ? NO_DEPARTMENT_KEY : `d${departmentId}`);

export interface FolderNode<T extends FolderDoc = FolderDoc> {
  /** `d12` for a department, `none` for the documents that sit in no department */
  key: string;
  id: number | null;
  name: string;
  /** the department is switched off (a folder is shown for it only while a document is in it) */
  inactive: boolean;
  /** 0 at the top; a sub-folder is one deeper than the folder it is in */
  depth: number;
  /** the folders inside this one, A to Z */
  folders: FolderNode<T>[];
  /** this folder's own documents at the top of its tree (the order given); the ones under them are in `entries` */
  top: T[];
  /** this folder's own documents, depth first, each with its depth and the documents under it (docTree.treeEntries) */
  entries: TreeEntry<T>[];
  /** this folder's own documents that match */
  own: FolderCounts;
  /** `own` and everything in the folders inside it */
  total: FolderCounts;
}

const byName = (a: FolderDepartment, b: FolderDepartment): number =>
  (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base', numeric: true }) || a.id - b.id;

interface Index {
  byId: Map<number, FolderDepartment>;
  /** A to Z, accents and case aside, ties by id */
  sorted: FolderDepartment[];
  /** department id -> the department it sits in (a missing parent, itself, and one link of every loop are left out) */
  parent: Map<number, number>;
  /** department id -> the departments directly in it, A to Z */
  kids: Map<number, FolderDepartment[]>;
}

function indexDepartments(departments: readonly FolderDepartment[] | null | undefined): Index {
  const byId = new Map<number, FolderDepartment>();
  (departments ?? []).forEach((d) => { if (!byId.has(d.id)) byId.set(d.id, d); });
  const sorted = Array.from(byId.values()).sort(byName);
  const parent = new Map<number, number>();
  sorted.forEach((d) => {
    const p = d.parent_department_id;
    if (p != null && p !== d.id && byId.has(p)) parent.set(d.id, p);
  });
  // A loop (A in B in A) has no top: its first member by name is lifted to the top, whichever of them the walk meets first.
  const rank = new Map(sorted.map((d, i) => [d.id, i] as [number, number]));
  const settled = new Set<number>();
  sorted.forEach((d) => {
    const path: number[] = [];
    const walking = new Set<number>();
    let at: number | undefined = d.id;
    while (at !== undefined && !settled.has(at)) {
      if (walking.has(at)) {
        const loop = path.slice(path.indexOf(at));
        parent.delete(loop.reduce((first, id) => (rank.get(id)! < rank.get(first)! ? id : first)));
        break;
      }
      walking.add(at);
      path.push(at);
      at = parent.get(at);
    }
    path.forEach((id) => settled.add(id));
  });
  const kids = new Map<number, FolderDepartment[]>();
  sorted.forEach((d) => {
    const p = parent.get(d.id);
    if (p !== undefined) kids.set(p, [...(kids.get(p) ?? []), d]);
  });
  return { byId, sorted, parent, kids };
}

export interface BuildInput<T extends FolderDoc> {
  /** every document the library is drawn from (the table's archived-aware scope), in the order they are to be listed inside a folder */
  scope: readonly T[];
  /** the ids of those that match the search and filters */
  matches: ReadonlySet<number>;
  departments: readonly FolderDepartment[] | null | undefined;
  /** a search or filter is on: a folder with nothing in it is left out */
  filtering: boolean;
  now: Date;
}

/**
 * The folders: one for each department (a department with a parent that exists sits inside that one), A to Z, and last "No department"
 * for the documents with no department or one the list does not know. Inside a folder the documents are nested by docTree.buildTree
 * with the same `match` rule as the table (a parent that does not match is kept, greyed, for the documents under it). Counts follow the
 * filters. Left out: a folder with no document that matches while a search or filter is on, a switched-off department with none at
 * any time, and an empty "No department". When a folder is left out, the folders inside it that stay move up to its place.
 */
export function buildFolders<T extends FolderDoc>({ scope, matches, departments, filtering, now }: BuildInput<T>): FolderNode<T>[] {
  const { byId, sorted, parent, kids } = indexDepartments(departments);

  const bucket = new Map<string, T[]>();
  for (const d of scope) {
    const key = folderKey(d.department_id != null && byId.has(d.department_id) ? d.department_id : null);
    const list = bucket.get(key);
    if (list) list.push(d); else bucket.set(key, [d]);
  }

  const make = (dept: FolderDepartment | null): FolderNode<T> => {
    const key = folderKey(dept ? dept.id : null);
    const docs = bucket.get(key) ?? [];
    const here = new Set<number>();
    docs.forEach((d) => { if (matches.has(d.id)) here.add(d.id); });
    const roots = buildTree(docs, here);
    const entries = treeEntries(roots);
    const own = noCounts();
    entries.forEach((e) => { if (e.match) tally(own, e.doc, now); });
    const folders = dept ? (kids.get(dept.id) ?? []).map(make) : [];
    return {
      key, id: dept ? dept.id : null, name: dept ? dept.name : NO_DEPARTMENT_NAME, inactive: !!dept && dept.is_active === false, depth: 0,
      folders, top: roots.map((n) => n.doc), entries, own, total: folders.reduce((sum, f) => plus(sum, f.total), own),
    };
  };

  const shown = (n: FolderNode<T>): FolderNode<T>[] => {
    n.folders = n.folders.reduce<FolderNode<T>[]>((all, f) => all.concat(shown(f)), []);
    return n.total.docs > 0 || (!filtering && !n.inactive) ? [n] : n.folders;
  };
  const place = (list: FolderNode<T>[], depth: number): FolderNode<T>[] => {
    list.forEach((n) => { n.depth = depth; place(n.folders, depth + 1); });
    return list;
  };

  const top = sorted.filter((d) => !parent.has(d.id)).reduce<FolderNode<T>[]>((all, d) => all.concat(shown(make(d))), []);
  const none = make(null);
  return place(none.total.docs > 0 ? [...top, none] : top, 0);
}

/** Every folder shown, depth first, in the order they are drawn. */
export function allFolders<T extends FolderDoc>(nodes: readonly FolderNode<T>[]): FolderNode<T>[] {
  const out: FolderNode<T>[] = [];
  const walk = (list: readonly FolderNode<T>[]) => list.forEach((n) => { out.push(n); walk(n.folders); });
  walk(nodes);
  return out;
}

/** Something to open: documents or folders inside. An empty folder has nothing to show. */
export const expandable = (n: FolderNode): boolean => n.top.length > 0 || n.folders.length > 0;

/** The ids of the documents of a folder, sub-folders included, that match: what its tick box ticks. */
export function matchedIds<T extends FolderDoc>(n: FolderNode<T>): number[] {
  const out: number[] = [];
  const walk = (x: FolderNode<T>) => {
    x.folders.forEach(walk);
    x.entries.forEach((e) => { if (e.match) out.push(e.doc.id); });
  };
  walk(n);
  return out;
}

/** The documents that match, in the order the folders show them (folders A to Z, the ones inside a folder before its own documents):
 *  what the CSV and the drawer's next / previous follow. */
export function displayOrder<T extends FolderDoc>(nodes: readonly FolderNode<T>[]): T[] {
  const out: T[] = [];
  const walk = (list: readonly FolderNode<T>[]) => list.forEach((n) => {
    walk(n.folders);
    n.entries.forEach((e) => { if (e.match) out.push(e.doc); });
  });
  walk(nodes);
  return out;
}

/** Every document of the folders shown, matches and the parents shown for them, as the tree entries the table's row rules read. */
export function folderEntries<T extends FolderDoc>(nodes: readonly FolderNode<T>[]): TreeEntry<T>[] {
  return allFolders(nodes).reduce<TreeEntry<T>[]>((all, n) => all.concat(n.entries), []);
}

/** What a screen reader hears for a folder's button: "Operations, 12 documents, 8 published, 4 draft, 2 overdue, inactive". */
export function folderAria(n: FolderNode): string {
  const parts = [n.name, n.total.docs === 0 ? 'empty' : documents(n.total.docs), ...statusParts(n.total)];
  if (n.total.overdue > 0) parts.push(`${n.total.overdue} overdue`);
  if (n.inactive) parts.push('inactive');
  return parts.join(', ');
}

// ─── Open and closed ─────────────────────────────────────────────────────────────────────────────────────────────────────

/** A library of up to this many documents (after the filters) opens its folders the first time; a longer one starts closed. */
export const OPEN_UP_TO = 40;
/** Documents a folder lists before "Show N more", and how many more one click shows. */
export const FIRST_SHOWN = 15;
export const SHOW_STEP = 50;

export interface FoldView {
  /** what the person chose before (folder key -> open): remembered in their browser */
  saved: Readonly<Record<string, boolean>>;
  /** folders the person closed while a search or filter was on: for that set of matches only, never remembered */
  shut: ReadonlySet<string>;
  filtering: boolean;
  /** documents that match: a short library opens its folders when the person has not chosen yet */
  docCount: number;
}
export interface FoldChange { saved: Record<string, boolean>; shut: Set<string> }

const chosen = (saved: Readonly<Record<string, boolean>>, key: string): boolean | undefined =>
  Object.prototype.hasOwnProperty.call(saved, key) && typeof saved[key] === 'boolean' ? saved[key] : undefined;

/** Whether a folder is open. While a search or filter is on, every folder with a match is open (it matches inside it) unless the person
 *  closed it since; otherwise their remembered choice, else open for a short library and closed for a long one. */
export function folderIsOpen(v: FoldView, key: string): boolean {
  if (v.filtering) return !v.shut.has(key);
  return chosen(v.saved, key) ?? v.docCount <= OPEN_UP_TO;
}

/** The state after the person flips one folder: remembered, except while a search or filter is on (that lasts for those matches only). */
export function flipFolder(v: FoldView, key: string): FoldChange {
  const open = folderIsOpen(v, key);
  const shut = new Set(v.shut);
  if (v.filtering) {
    if (open) shut.add(key); else shut.delete(key);
    return { saved: { ...v.saved }, shut };
  }
  return { saved: { ...v.saved, [key]: !open }, shut };
}

/** Expand all / Collapse all over the folders shown. */
export function setAllFolders(v: FoldView, keys: readonly string[], open: boolean): FoldChange {
  if (v.filtering) return { saved: { ...v.saved }, shut: open ? new Set<string>() : new Set(keys) };
  const saved = { ...v.saved };
  keys.forEach((key) => { saved[key] = open; });
  return { saved, shut: new Set(v.shut) };
}

/** Documents a folder lists now: the first ones, and those the person asked for with "Show N more". */
export const shownLimit = (extra: number | undefined): number => FIRST_SHOWN + Math.max(0, extra ?? 0);
/** What one click on "Show N more" adds, given how many are still hidden. */
export const showMoreStep = (remaining: number): number => Math.min(Math.max(0, remaining), SHOW_STEP);

// ─── What is drawn ───────────────────────────────────────────────────────────────────────────────────────────────────────

export type PlanItem<T extends FolderDoc> =
  | { kind: 'folder'; node: FolderNode<T>; open: boolean }
  | { kind: 'docs'; node: FolderNode<T>; rows: DrawnRow<T>[]; /** top-level documents not listed yet */ remaining: number };

/**
 * The folders in the order they are drawn: a folder's header, then (when it is open) the folders inside it, then its own documents.
 * A closed folder draws nothing below its header. `rowsOf` gives the table's rows (with the documents under them) for the first
 * `limit` top-level documents of a folder.
 */
export function planFolders<T extends FolderDoc>(nodes: readonly FolderNode<T>[], o: {
  isOpen: (n: FolderNode<T>) => boolean;
  limit: (n: FolderNode<T>) => number;
  rowsOf: (n: FolderNode<T>, limit: number) => DrawnRow<T>[];
}): PlanItem<T>[] {
  const out: PlanItem<T>[] = [];
  const walk = (list: readonly FolderNode<T>[]) => list.forEach((n) => {
    const open = o.isOpen(n);
    out.push({ kind: 'folder', node: n, open });
    if (!open) return;
    walk(n.folders);
    if (n.top.length > 0) {
      const limit = o.limit(n);
      out.push({ kind: 'docs', node: n, rows: o.rowsOf(n, limit), remaining: Math.max(0, n.top.length - limit) });
    }
  });
  walk(nodes);
  return out;
}

// ─── Which layout ────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Folders where there is at least one department in use, else the table the library always had. */
export const defaultView = (departments: readonly FolderDepartment[] | null | undefined): LibraryViewId =>
  (departments ?? []).some((d) => d.is_active !== false) ? 'folders' : 'table';

/** The layout: what the address says, else what the person chose before, else the default. */
export function chooseView(o: {
  address: LibraryViewId | null;
  remembered: LibraryViewId | null;
  departments: readonly FolderDepartment[] | null | undefined;
}): LibraryViewId {
  return o.address ?? o.remembered ?? defaultView(o.departments);
}

// ─── Move to… ────────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface MoveTarget {
  /** the department; null: no department */
  id: number | null;
  /** "Operations", or "Operations › Security" for a department inside another */
  label: string;
}

/** Where a document can be moved: the departments in use by their full name, A to Z, then "No department". A switched-off one is not
 *  offered (the server refuses it). */
export function moveTargets(departments: readonly FolderDepartment[] | null | undefined): MoveTarget[] {
  const { byId, sorted, parent } = indexDepartments(departments);
  const label = (d: FolderDepartment): string => {
    const names = [d.name];
    for (let p = parent.get(d.id); p !== undefined; p = parent.get(p)) names.unshift(byId.get(p)!.name);
    return names.join(' › ');
  };
  const rows = sorted.filter((d) => d.is_active !== false).map((d) => ({ id: d.id as number | null, label: label(d) }));
  rows.sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base', numeric: true }));
  return [...rows, { id: null, label: NO_DEPARTMENT_NAME }];
}

/** The targets whose name has every word that was typed (accents and case aside). */
export function filterTargets(targets: readonly MoveTarget[], query: string): MoveTarget[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  return words.length === 0 ? [...targets] : targets.filter((t) => words.every((w) => fold(t.label).includes(w)));
}

/** The department every one of these documents is in; undefined when they differ (or there are none). null: all in none. */
export function commonDepartment(docs: readonly { department_id?: number | null }[]): number | null | undefined {
  if (docs.length === 0) return undefined;
  const first = docs[0].department_id ?? null;
  return docs.every((d) => (d.department_id ?? null) === first) ? first : undefined;
}

export interface MoveOutcome {
  moved: number[];
  /** already in that department: nothing was sent for them */
  same: number[];
  failed: { id: number; reason: string }[];
}

/** Moves the documents one after the other (the server checks each one: who may change it, an archived one, a department switched off)
 *  and reports every outcome; a refusal does not stop the rest. */
export async function moveAll(
  ids: readonly number[],
  to: number | null,
  o: {
    departmentOf: (id: number) => number | null | undefined;
    move: (id: number, to: number | null) => Promise<unknown>;
    reason: (error: unknown) => string;
  },
): Promise<MoveOutcome> {
  const out: MoveOutcome = { moved: [], same: [], failed: [] };
  for (const id of ids) {
    if ((o.departmentOf(id) ?? null) === to) { out.same.push(id); continue; }
    try {
      await o.move(id, to);
      out.moved.push(id);
    } catch (error) {
      out.failed.push({ id, reason: o.reason(error) });
    }
  }
  return out;
}

/** The one toast after a move: "Moved 5 documents to Operations", or "Moved 4 · 1 could not be moved" with the first reason. */
export function moveMessage(o: MoveOutcome, target: string): { title: string; message?: string; type: 'success' | 'info' | 'warning' | 'error' } {
  if (o.failed.length === 0) {
    return o.moved.length > 0 ? { title: `Moved ${documents(o.moved.length)} to ${target}`, type: 'success' } : { title: `Already in ${target}`, type: 'info' };
  }
  const message = o.failed[0].reason || undefined;
  return o.moved.length > 0
    ? { title: `Moved ${o.moved.length} · ${o.failed.length} could not be moved`, message, type: 'warning' }
    : { title: o.failed.length === 1 ? 'Not moved' : `${o.failed.length} not moved`, message, type: 'error' };
}
