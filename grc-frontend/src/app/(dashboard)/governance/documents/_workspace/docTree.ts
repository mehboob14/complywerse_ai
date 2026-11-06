// The library table's hierarchy: documents nested under their parent (parent_document_id), and what the person opened in it.
// Pure (no React), so `node --test` runs docTree.test.ts against it.

export interface TreeDoc {
  id: number;
  parent_document_id: number | null;
}

export interface TreeNode<T extends TreeDoc> {
  doc: T;
  /** false: shown only because a document under it matches the search and filters (the row is greyed) */
  match: boolean;
  children: TreeNode<T>[];
}

/** One document of the tree: how deep it sits and the documents directly under it. */
export interface TreeEntry<T extends TreeDoc> {
  doc: T;
  match: boolean;
  depth: number;
  children: T[];
}

/**
 * Nest `scope` by parent. Only the documents in `matches` (all when null) are kept, with their ancestors inside `scope`
 * (those flagged `match: false`). A document whose parent is not in `scope` (filtered out by the library scope, or missing)
 * is at the top. Siblings keep the order of `scope`. A parent loop in the data is cut, never dropped.
 */
export function buildTree<T extends TreeDoc>(scope: readonly T[], matches: ReadonlySet<number> | null): TreeNode<T>[] {
  const byId = new Map(scope.map((d) => [d.id, d]));
  const keep = new Map<number, boolean>();
  for (const d of scope) if (!matches || matches.has(d.id)) keep.set(d.id, true);
  for (const id of Array.from(keep.keys())) {
    let p = byId.get(id)!.parent_document_id;
    while (p != null && byId.has(p) && !keep.has(p)) {    // an ancestor already kept has had its own ancestors walked
      keep.set(p, false);
      p = byId.get(p)!.parent_document_id;
    }
  }

  const nodes = new Map<number, TreeNode<T>>();
  for (const d of scope) if (keep.has(d.id)) nodes.set(d.id, { doc: d, match: keep.get(d.id)!, children: [] });
  const parentOf = (n: TreeNode<T>) => {
    const p = n.doc.parent_document_id;
    return p != null && p !== n.doc.id ? nodes.get(p) : undefined;
  };
  const roots: TreeNode<T>[] = [];
  nodes.forEach((n) => {
    const parent = parentOf(n);
    if (parent) parent.children.push(n);
    else roots.push(n);
  });

  // a loop (A under B under A) has no way up to a top-level document: lift its first member to the top
  const reached = new Set<number>();
  const mark = (n: TreeNode<T>) => { reached.add(n.doc.id); n.children.forEach(mark); };
  roots.forEach(mark);
  nodes.forEach((n) => {
    if (reached.has(n.doc.id)) return;
    const parent = parentOf(n)!;
    parent.children = parent.children.filter((c) => c !== n);
    roots.push(n);
    mark(n);
  });
  return roots;
}

/** Every document of the tree, depth first, with its depth and the documents directly under it. */
export function treeEntries<T extends TreeDoc>(roots: readonly TreeNode<T>[]): TreeEntry<T>[] {
  const out: TreeEntry<T>[] = [];
  const walk = (list: readonly TreeNode<T>[], depth: number) => list.forEach((n) => {
    out.push({ doc: n.doc, match: n.match, depth, children: n.children.map((c) => c.doc) });
    walk(n.children, depth + 1);
  });
  walk(roots, 0);
  return out;
}

/** What the person opened in the table: `open` all the way (a document's versions and the documents under it), `shut` closed by
 *  them, `all` Expand all (every document shows the documents under it). */
export interface Fold {
  open: ReadonlySet<number>;
  shut: ReadonlySet<number>;
  all: boolean;
}

export const NOTHING_OPEN: Fold = { open: new Set(), shut: new Set(), all: false };

/** How far a row is open: 'all' when the person opened it; 'docs' (the documents under it, not its versions, so nothing is read) under
 *  Expand all or, while a search or filter is on, on the way to a match, unless the person closed it; null when it is closed. */
export function openness(fold: Fold, id: number, hasChildren: boolean, filtering: boolean): 'all' | 'docs' | null {
  if (fold.open.has(id)) return 'all';
  return hasChildren && !fold.shut.has(id) && (fold.all || filtering) ? 'docs' : null;
}

/** A row's arrow: an open row closes, a closed one opens all the way. */
export function flip(fold: Fold, id: number, isOpen: boolean): Fold {
  const open = new Set(fold.open);
  const shut = new Set(fold.shut);
  if (isOpen) { open.delete(id); shut.add(id); } else { open.add(id); shut.delete(id); }
  return { ...fold, open, shut };
}

/** Expand all opens the documents under every document (the rows opened all the way stay so); Collapse all closes everything, the way
 *  to a match too (until the next search). */
export const expandAll = (fold: Fold): Fold => ({ open: fold.open, shut: new Set(), all: true });
export const collapseAll = (parents: Iterable<number>): Fold => ({ open: new Set(), shut: new Set(parents), all: false });
