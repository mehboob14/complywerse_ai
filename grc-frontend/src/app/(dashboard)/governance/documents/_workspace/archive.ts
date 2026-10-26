// Archived documents in the library (they are archived, never deleted): kept out of the working list, listed when the Status filter
// is set to Archived.

type Doc = { status?: string | null };

export const isArchived = (d: Doc) => d.status === 'archived';

/** The documents a list shows: archived ones only when the Status filter asks for them (it then keeps only those). The filter is one
 *  status or, in the multi-choice library, the list of them. */
export function unlessArchivedAsked<T extends Doc>(docs: T[], statusFilter: string | readonly string[]): T[] {
  const asked = typeof statusFilter === 'string' ? statusFilter === 'archived' : statusFilter.includes('archived');
  return asked ? docs : docs.filter((d) => !isArchived(d));
}

/** What archiving does, as its confirmation says it (the document page and the library's row Archive). */
export const ARCHIVE_LINE = 'It is no longer in force, so staff stop reading it, and the reviews, approvals and acknowledgements still waiting '
  + 'are cancelled. Every version, signature and the history are kept; the library lists it under Archived, where its editors can '
  + 'restore it as a draft.';

/** The register's bulk bar: the Archived list offers Restore only (the server refuses changing archived documents). Never Approve: a
 *  document is approved by its approvers signing it in its review. */
export function bulkActionIds(showingArchived: boolean): string[] {
  return showingArchived ? ['restore'] : ['publish', 'assign-owner', 'set-review', 'archive'];
}

/** The register's "total": the working library leaves archived documents out; the Archived list counts only those. */
export function libraryCounts(docs: Doc[]): { all: number; archived: number } {
  const out = { all: 0, archived: 0 };
  for (const d of docs) {
    if (isArchived(d)) out.archived += 1;
    else out.all += 1;
  }
  return out;
}
