// The Comply AI Studio home's lists: what the library pickers offer and say about a document, and what can be done with a
// piece of work in "Your work".

export interface PickDoc {
  id: number;
  code: string | null;
  doc_type: string;
  status: string;
  version: string;
  has_file: boolean;
  has_text: boolean;
  may_edit?: boolean;
}

/** "review_required" -> "Review required": a value no label names is never shown raw. */
export function humanize(value: string | null | undefined): string {
  const t = (value || '').replace(/_/g, ' ').trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** "POL-1 · Policy · v1.0 · In review", from the app's own type and status labels. */
export function docLine(d: PickDoc, types: Record<string, string>, statuses: Record<string, { label: string }>): string {
  return [d.code, types[d.doc_type] ?? humanize(d.doc_type), d.version ? `v${d.version}` : '', statuses[d.status]?.label ?? humanize(d.status)]
    .filter(Boolean).join(' · ');
}

/** The documents a picker offers: those with a text or a file, not already chosen; to edit, only those the person may edit. */
export function pickable<T extends PickDoc>(rows: T[], { exclude = [], editable = false }: { exclude?: number[]; editable?: boolean } = {}): T[] {
  return rows.filter((d) => !exclude.includes(d.id) && (d.has_text || d.has_file) && (!editable || d.may_edit !== false));
}

/** A draft never in the library is discarded; a library document the person may not save (a reader's comparison) is removed
 *  from their work; their work on a document they may change stays (it is archived in the library). */
export function workAction(s: { document_id: number | null; may_save?: boolean }): 'discard' | 'remove' | null {
  if (!s.document_id) return 'discard';
  return s.may_save === false ? 'remove' : null;
}
