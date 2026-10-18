// Archived documents in the library (they are archived, never deleted): kept out of the working lists and the tree, listed under
// the library's Archived entry, which is the Status filter set to Archived, so they show the same way in every view.

type Doc = { status?: string | null; owner_id?: number | null };

export const isArchived = (d: Doc) => d.status === 'archived';

/** The documents a list shows: archived ones only when the Status filter asks for them (it then keeps only those). */
export function unlessArchivedAsked<T extends Doc>(docs: T[], statusFilter: string): T[] {
  return statusFilter === 'archived' ? docs : docs.filter((d) => !isArchived(d));
}

/** The hierarchy without archived documents; the documents under one take its place, so they stay reachable. */
export function withoutArchived<T extends Doc & { children?: T[] }>(nodes: T[]): T[] {
  return nodes.flatMap((n) => {
    const children = withoutArchived(n.children ?? []);
    return isArchived(n) ? children : [{ ...n, children }];
  });
}

/** What the library's entries count: All documents and My documents (the person owns it) leave archived ones out. */
export function libraryCounts(docs: Doc[], me?: number | null): { all: number; mine: number; archived: number } {
  const out = { all: 0, mine: 0, archived: 0 };
  for (const d of docs) {
    if (isArchived(d)) out.archived += 1;
    else {
      out.all += 1;
      if (me != null && d.owner_id === me) out.mine += 1;
    }
  }
  return out;
}
