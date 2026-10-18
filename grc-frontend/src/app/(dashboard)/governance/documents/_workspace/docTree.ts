// The library's Tree view: documents nested under their parent (parent_document_id), as rows with depth and connector lines.
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

export interface TreeRow<T extends TreeDoc> {
  doc: T;
  match: boolean;
  depth: number;
  /** one per ancestor at depth 1..depth-1: true when that ancestor has a later sibling, so its line runs through this row */
  rails: boolean[];
  /** the last of its siblings: the connector turns (└) instead of running on (├) */
  last: boolean;
  childCount: number;
  expanded: boolean;
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

/** The visible rows, depth first: the children of a document in `collapsed` are left out. */
export function flattenTree<T extends TreeDoc>(roots: readonly TreeNode<T>[], collapsed: ReadonlySet<number>): TreeRow<T>[] {
  const out: TreeRow<T>[] = [];
  const walk = (list: readonly TreeNode<T>[], depth: number, rails: boolean[]) => {
    list.forEach((n, i) => {
      const last = i === list.length - 1;
      const expanded = n.children.length > 0 && !collapsed.has(n.doc.id);
      out.push({ doc: n.doc, match: n.match, depth, rails, last, childCount: n.children.length, expanded });
      // top-level documents have no connector, so their children draw no rail for them
      if (expanded) walk(n.children, depth + 1, depth === 0 ? [] : [...rails, !last]);
    });
  };
  walk(roots, 0, []);
  return out;
}

/** The documents that have documents under them (what "Collapse all" folds). */
export function parentIds<T extends TreeDoc>(roots: readonly TreeNode<T>[]): number[] {
  return flattenTree(roots, new Set()).filter((r) => r.childCount > 0).map((r) => r.doc.id);
}
