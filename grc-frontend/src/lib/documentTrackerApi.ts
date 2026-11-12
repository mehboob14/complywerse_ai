// What the library's Tracker layout reads from the server, and every call it makes (all GETs). The Tracker sorts a whole library into groups with ONE answer of ids (`sets`),
// draws the compact lines of the page it shows with ONE answer for up to 100 documents (`lines`; both: backend modules/governance/routers/document_tracker.py), and loads a
// document's workflow only when its row is opened, from the endpoints the document's own page uses (the sign-off route, the lifecycle, the proposed changes, the attestation
// campaigns, the exceptions). The axios client is loaded when a call is made, so the rules that read these types also run under node --test.
import type { RouteView } from './approvalRoutes';
import type { DocumentLifecycle, LifecycleReply } from './documentLifecycle';
import type { ProposalList } from './proposals';

const http = async () => (await import('@/lib/api')).default;

// ── the sets: which documents are stuck, on hold, late, waiting over a week ... (ids) ────
export const SET_KEYS = ['stuck', 'on_hold', 'late_approvals', 'late_acknowledgements', 'changes_requested', 'proposals_waiting', 'waiting_week'] as const;
export type SetKey = (typeof SET_KEYS)[number];
export type TrackerSets = Record<SetKey, number[]> & { as_of: string };

/** The Tracker's groups when the answer is not here (yet): nothing is stuck, held or waiting; never a claim that something is. */
export const NO_SETS: Record<SetKey, ReadonlySet<number>> = {
  stuck: new Set(), on_hold: new Set(), late_approvals: new Set(), late_acknowledgements: new Set(), changes_requested: new Set(), proposals_waiting: new Set(), waiting_week: new Set(),
};

export async function fetchTrackerSets(): Promise<TrackerSets> {
  return (await (await http()).get('/governance/document-tracker/sets')).data as TrackerSets;
}

// ── the lines: one compact line for each document of a page ──────────────────
export interface WhoLine { names: string[]; more: number }
export interface TrackerLine {
  id: number;
  /** the stage a document in review or approval is at: the default route's Review / Approval, or the name of a stage of its own */
  stage: { name: string; kind: string } | null;
  /** the review or approval requests that wait: who (the first two and how many more), how many people, since when, how many are late, the soonest due date */
  waiting: (WhoLine & { kind: 'review' | 'approval'; count: number; since: string | null; overdue: number; next_due: string | null }) | null;
  /** the route is held: changes were asked for, or a proposed change waits for the owner */
  hold: { kind: 'changes' | 'proposal'; by: string | null; since: string | null; stage: string | null } | null;
  /** who is asked to act on the hold: the author to make the changes, the owner to decide on a proposed change, a proposer to revise it */
  asked: (WhoLine & { kind: 'changes' | 'decide' | 'revise'; since: string | null }) | null;
  /** proposed changes (any proposal that waits, held or not): how many, since when, by whom */
  proposals: (WhoLine & { count: number; since: string | null }) | null;
  versions: { count: number; previous: string | null } | null;
  flags: string[];
}
export interface TrackerLines { as_of: string; items: TrackerLine[] }

export async function fetchTrackerLines(ids: readonly number[]): Promise<TrackerLines> {
  return (await (await http()).get('/governance/document-tracker/lines', { params: { ids: ids.join(',') } })).data as TrackerLines;
}

// ── one document's workflow, when its row is opened ──────────────────────────
/** GET /governance/documents/{id}/signoff, the parts the Tracker reads (the document's page reads the same answer under the same key). */
export interface TrackerSignoff {
  status: string;
  round_started_at: string | null;
  version: string;
  participants: Record<'prepared_by' | 'reviewer' | 'approver', { display: string; target_type: string }[]>;
  signatures: { role_type: string; signer_name: string | null; decision: string; signed_at: string | null; stage_position: number | null; this_round: boolean; comment: string | null }[];
  route: RouteView;
  decide: { count: number; first_id: number } | null;
}
export const signoffKey = (id: number) => ['doc-signoff', id] as const;
export async function fetchSignoff(id: number): Promise<TrackerSignoff> {
  return (await (await http()).get(`/governance/documents/${id}/signoff`)).data as TrackerSignoff;
}

export const lifecycleKey = (id: number) => ['document-lifecycle', String(id)] as const;
export async function fetchLifecycle(id: number): Promise<LifecycleReply> {
  return (await (await http()).get(`/governance/documents/${id}/lifecycle`)).data as LifecycleReply;
}
export type { DocumentLifecycle, LifecycleReply, ProposalList };

/** One attestation campaign of a document, as GET /governance/document-attestations/campaigns?document_id= lists it (the parts the Tracker reads). */
export interface TrackerCampaign {
  id: number; document_id: number; name: string; status: string; due_date: string | null; created_at: string | null;
  acknowledgment_count: number; active_domain_users: number; attestation_percent: number | null;
}
export const campaignsKey = (id: number) => ['document-campaigns', id] as const;
export async function fetchCampaigns(id: number): Promise<TrackerCampaign[]> {
  const data = (await (await http()).get('/governance/document-attestations/campaigns', { params: { document_id: id } })).data as { items?: TrackerCampaign[] } | TrackerCampaign[];
  return Array.isArray(data) ? data : data.items ?? [];
}

/** An exception applied to a document (GET /governance/policy-exceptions?document_id=): the parts the Tracker reads. */
export interface TrackerException { id: number; title?: string | null; status: string; effective_date?: string | null; expiry_date?: string | null; exception_type_label?: string | null }
export const exceptionsKey = (id: number) => ['document-exceptions', id] as const;
export async function fetchExceptions(id: number): Promise<TrackerException[]> {
  const data = (await (await http()).get('/governance/policy-exceptions', { params: { document_id: id, limit: 20 } })).data as TrackerException[] | { items?: TrackerException[] };
  return Array.isArray(data) ? data : data.items ?? [];
}
