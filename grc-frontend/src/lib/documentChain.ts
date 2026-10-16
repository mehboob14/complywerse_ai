/**
 * The change chain of a governance document: every version with who changed what, from what to what, on whose request and
 * from which sources, the approvals between the versions, the document as a redline against an earlier version, and the
 * whole chain as Excel / PDF / CSV. Backend: governance/change_chain.py, routers/change_chain.py.
 */
import apiClient from '@/lib/api';

export interface ChainSource {
  ref: string;
  kind: string;
  title: string;
  source_id?: number | null;
  /** where in the source (a clause number, a control id, a heading) */
  locator: string;
  /** the words the AI quoted from the source */
  quote: string;
  how?: string;
  basis: 'reference' | 'general_knowledge' | 'instruction';
  /** whether the quoted words were found in the source (null: not a quote from a supplied source) */
  verified: boolean | null;
  versions?: string[];
}

/** Where one change came from. */
export interface ChangeBy {
  origin: string;
  by: string;
  by_id: number | null;
  at: string | null;
  version: string | null;
  request: string;
  reason: string;
  sources: ChainSource[];
  /** share of the new text this origin wrote; below 1 the text was edited afterwards */
  coverage: number;
  ref?: { session_id?: number; message_id?: number; op_id?: string; kind?: string };
}

export interface ChainItem {
  n: number;
  status: 'inserted' | 'deleted' | 'modified';
  section: string;
  locked: boolean;
  blocks: number;
  words_added: number;
  words_removed: number;
  format_only: boolean;
  /** how the outline changed ("Heading 2 → Heading 3", "List level 1 → 2", "Renumbered 3 → 4"); absent on older versions */
  structure?: string[];
  before_text: string;
  after_text: string;
  truncated: boolean;
  origin: string;
  by: string;
  by_id: number | null;
  at: string | null;
  request: string;
  reason: string;
  sources: ChainSource[];
  coverage: number;
}

export interface ChainVersion {
  id: number;
  number: string;
  kind: string | null;
  status: string | null;
  at: string | null;
  by: string;
  by_id: number | null;
  stage: string;
  stage_label: string;
  origin: string;
  origin_label: string;
  summary: string;
  reason: string;
  /** false: the version is a file whose text could not be read, so it is not compared with the one before */
  comparable: boolean;
  has_file: boolean;
  /** the name of the version's file, when the version is a file (an uploaded Word or PDF) */
  file_name?: string;
  title: string;
  items: ChainItem[];
  sources: ChainSource[];
  words_added: number;
  words_removed: number;
  changes: number;
  approved_by: string | null;
  approved_at: string | null;
  session_id: number | null;
  /** a take back: what it took back */
  reverts?: { since_version: string; changes: number } | null;
  /** a restore: the version it went back to */
  restored_from?: string | null;
}

export interface ChainEvent {
  at: string | null;
  kind: string;
  actor: string | null;
  actor_id: number | null;
  detail: string;
  from: string | null;
  to: string | null;
  stage: string;
}

export interface DocumentChain {
  enabled: boolean;
  document?: {
    id: number; title: string; code: string | null; version: string | null; status: string; stage_label: string; owner: string | null;
    author: string | null; approved_by: string | null; approved_at: string | null; doc_type: string; is_file: boolean; file_type: string | null;
  };
  versions: ChainVersion[];
  events: ChainEvent[];
  sources: ChainSource[];
  summary: { versions: number; changes: number; people: number; ai_assisted: number; sources: number; words_added: number; words_removed: number };
}

export interface ChainHunk {
  id: number;
  status: 'inserted' | 'deleted' | 'modified';
  section: string;
  locked: boolean;
  blocks: number;
  words_added: number;
  words_removed: number;
  format_only: boolean;
  structure?: string[];
  before_text: string;
  after_text: string;
  by: ChangeBy | null;
  /** the id to take it back by, against the document as it is now (differs from `id` when a version's own changes are shown) */
  current_id?: number | null;
  /** whether this change can be taken back from here (it may have been changed again by a later version) */
  can_revert?: boolean;
}

export interface BaselineVersion {
  id: number;
  number: string;
  at: string | null;
  by: string | null;
  status: string | null;
  kind: string | null;
  summary: string;
  approved_at: string | null;
}

export type ExportFormat = 'xlsx' | 'pdf' | 'csv';

export const ORIGIN_LABEL: Record<string, string> = {
  ai: 'Comply Agent', manual: 'Edited by hand', mixed: 'Comply Agent and edited by hand', revert: 'Taken back', restore: 'Earlier version restored',
  signoff: 'Sign-off stamp', initial: 'The original', file: 'File replaced', import: 'Imported', unknown: 'Changed', nochange: 'No change to the text',
};

/** "Comply Agent · accepted by Olivia", "Edited by Sara", "Taken back by Khalid": who and how, in a few words. */
export function byLine(origin: string, by: string, coverage = 1): string {
  const who = by || 'someone';
  switch (origin) {
    case 'ai': return coverage < 1 ? `Comply Agent draft, edited since · accepted by ${who}` : `Comply Agent · accepted by ${who}`;
    case 'manual': return `Edited by ${who}`;
    case 'revert': return `Taken back by ${who}`;
    case 'restore': return `Earlier version restored by ${who}`;
    case 'signoff': return `Sign-off stamp · ${who}`;
    case 'initial': return 'The original';
    default: return who ? `Changed by ${who}` : 'Changed';
  }
}

/** What a change did when no word changed: how the outline changed ("Heading 2 → Heading 3"), else "Formatting only". Null when words changed. */
export const shapeOf = (c: { structure?: string[]; format_only: boolean; words_added: number; words_removed: number }): string | null =>
  c.words_added || c.words_removed ? null : c.structure?.length ? c.structure.join(' · ') : c.format_only ? 'Formatting only' : null;

const filenameOf = (disposition: string | undefined, fallback: string): string => {
  const m = /filename="?([^";]+)"?/i.exec(disposition || '');
  return m ? decodeURIComponent(m[1]) : fallback;
};

export const documentChainApi = {
  chain: async (id: number): Promise<DocumentChain> => (await apiClient.get(`/governance/documents/${id}/change-chain`)).data,
  redline: async (id: number, from: number, to?: number | null) =>
    (await apiClient.get(`/governance/documents/${id}/change-chain/redline`, { params: { from, ...(to ? { to } : {}) } })).data as {
      enabled: boolean;
      from: { id: number; number: string };
      to: { id: number; number: string } | null;
      rows: import('@/lib/studio/api').RedlineRow[];
      hunks: ChainHunk[];
      stats: import('@/lib/studio/api').Stats;
      hash: string;
      /** the fingerprint of the document as it is now: what a take back is checked against */
      current_hash?: string;
      can_revert: boolean;
      why_not: string | null;
      versions: BaselineVersion[];
    },
  revert: async (id: number, body: { from_version_id: number; hunks: number[]; hash?: string; reason?: string }) =>
    (await apiClient.post(`/governance/documents/${id}/change-chain/revert`, body)).data as { version: string; status: string; changes_taken_back: number; notes?: string[] },
  exportFile: async (id: number, format: ExportFormat): Promise<{ blob: Blob; filename: string }> => {
    const res = await apiClient.get(`/governance/documents/${id}/change-chain/export`, { params: { format }, responseType: 'blob' });
    return { blob: res.data as Blob, filename: filenameOf(res.headers?.['content-disposition'], `change-chain.${format}`) };
  },
  /** the file of one version (the original upload, or a later file), named with its version: "policy v1.0.docx" */
  versionFile: async (id: number, versionId: number, name: string, number: string): Promise<{ blob: Blob; filename: string }> => {
    const res = await apiClient.get(`/governance/documents/${id}/download-file`, { params: { version_id: versionId }, responseType: 'blob' });
    const dot = name.lastIndexOf('.');
    return { blob: res.data as Blob, filename: dot > 0 ? `${name.slice(0, dot)} v${number}${name.slice(dot)}` : `${name || 'document'} v${number}` };
  },
};
