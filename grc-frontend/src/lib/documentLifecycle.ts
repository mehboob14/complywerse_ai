// What GET /governance/documents/{id}/lifecycle answers (backend: governance/doc_lifecycle.py) and the words and dates used to show it,
// shared by the document's "Approvals & Acknowledgements" tab and the hover card in the document library.
import { parseUtc } from '@/lib/serverTime';

export interface LifecycleRow {
  /** changes: the author is asked to make the changes someone asked for (an approval route on hold) */
  id: number; kind: 'review' | 'approval' | 'acknowledgement' | 'changes'; user_id: number; user: string | null;
  /** delegated: handed to someone else; held: waiting while changes are made; changes_requested: this person asked for changes */
  status: 'pending' | 'done' | 'rejected' | 'cancelled' | 'delegated' | 'held' | 'changes_requested'; version: string | null; requested_at: string | null;
  due_date: string | null; done_at: string | null; comment: string | null; overdue: boolean; escalation_level: number;
}
export interface LifecycleEvent { at: string | null; kind: string; actor: string | null; detail: string | null }
export interface DocumentLifecycle {
  enabled: true;
  document: { id: number; title: string; status: string; version: string; owner: string | null; author: string | null };
  approvals: LifecycleRow[];
  acknowledgements: {
    total: number; done: number; pending: number; overdue: number; percent: number; people: LifecycleRow[];
    /** acknowledgements given before each person's newest row (1.0 once 2.0 asks again), with their e-signatures; a server from
     *  before it was added leaves it out */
    history?: LifecycleRow[];        // acknowledgements of earlier versions (a major version asks again)
  };
  mine: LifecycleRow[];
  /** who is asking (a server from before it was added does not send it) */
  me?: { id: number };
  timeline: LifecycleEvent[];
}
/** An organisation without the life cycle feature is answered `{ enabled: false }` and nothing else. */
export type LifecycleReply = DocumentLifecycle | { enabled: false };

export const LIFECYCLE_KIND_LABEL = { review: 'Review', approval: 'Approval', acknowledgement: 'Acknowledgement', changes: 'Changes asked for' } as const;
export const LIFECYCLE_EVENT_LABEL: Record<string, string> = {
  sent_for_review: 'Sent for review', sent_for_approval: 'Sent for approval', signed: 'Signed', rejected: 'Rejected', published: 'Published',
  acknowledged: 'Acknowledged', escalated: 'Escalated', status_changed: 'Status changed', version_created: 'New version',
  statements_written_to_document: 'Statements written into the document', review_requested: 'Review requested',
  statements_updated_from_document: 'Statements updated from the document',
  approval_requested: 'Approval requested', acknowledgement_requested: 'Acknowledgement requested', file_uploaded: 'File uploaded',
  restored: 'Restored from the archive', changes_requested: 'Changes requested', resubmitted: 'Resubmitted', withdrawn: 'Withdrawn from review',
  delegated: 'Delegated', route_set: 'Approval route set',
  review_again_requested: 'Asked again after changes',
  // changes to the document's statements
  statement_added: 'Statement added', statement_edited: 'Statement edited', statement_deleted: 'Statement removed',
  statement_rolled_back: 'Statement rolled back', statements_reparsed: 'Statements re-read from the document',
  statement_corrected_to_file: "Statement matched to the document's wording", statement_out_of_document: 'Statement edit no longer in the document',
  statement_changed_by_fix: 'Statement changed by a gap fix', statement_fix_undone: 'Gap fix on a statement undone',
};
export const eventLabel = (kind: string) => LIFECYCLE_EVENT_LABEL[kind] || (kind.charAt(0).toUpperCase() + kind.slice(1)).replace(/_/g, ' ');

/** A date with no time ("2026-12-01") is that calendar day wherever it is read; a moment is shown in the reader's own time zone. */
export const day = (v: string | null) => parseUtc(v)?.toLocaleDateString(undefined, {
  day: 'numeric', month: 'short', year: 'numeric', ...(v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? { timeZone: 'UTC' } : {}),
}) ?? '-';
export const dateTime = (v: string | null) => parseUtc(v)?.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) ?? '-';
