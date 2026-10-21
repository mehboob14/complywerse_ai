// Which document view a URL opens. Old ?tab= links (emails, tasks, bookmarks) keep working.

export type DocView = 'document' | 'approvals' | 'proposals' | 'discussion' | 'statements' | 'mappings' | 'gaps' | 'versions';

export const VIEWS: { key: DocView; label: string }[] = [
  { key: 'document', label: 'Document' },
  { key: 'approvals', label: 'Approvals' },
  { key: 'proposals', label: 'Proposed changes' },   // changes by others than the owner or author, waiting for their decision (shown once there is one)
  { key: 'discussion', label: 'Discussion' },
  { key: 'statements', label: 'Statements' },
  { key: 'mappings', label: 'Mappings' },
  { key: 'gaps', label: 'Gap analysis' },
  { key: 'versions', label: 'Change log' },          // every version and change, who and when, the approvals; exports
];

/** The views that work on the library (its statements, framework mappings and gap analyses): for people who read the library. */
export const LIBRARY_VIEWS: ReadonlySet<DocView> = new Set<DocView>(['statements', 'mappings', 'gaps']);

const ALIASES: Record<string, DocView> = {
  document: 'document',
  viewer: 'document',
  approvals: 'approvals',
  lifecycle: 'approvals',
  'sign-off': 'approvals',
  discussion: 'discussion',
  comments: 'discussion',
  remarks: 'discussion',
  'review-history': 'approvals',
  proposals: 'proposals',
  proposal: 'proposals',
  proposed: 'proposals',
  'proposed-changes': 'proposals',
  statements: 'statements',
  mappings: 'mappings',
  controls: 'mappings',
  gaps: 'gaps',
  'gap-analysis': 'gaps',
  versions: 'versions',
  chain: 'versions',
  'change-log': 'versions',
  changelog: 'versions',
  log: 'versions',
  history: 'versions',
};

/** The studio view is on for this tenant. There is no way to the classic page (the user, 2026-10-17): ?classic=1 is ignored, and
 * links to its Statements and Gap Analysis tabs open the studio's own views (`viewOf`). */
export function inStudio(enabled: boolean | undefined): boolean {
  return enabled === true;
}

export function viewOf(tab: string | null | undefined): DocView {
  const key = (tab ?? '').trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(ALIASES, key) ? ALIASES[key] : 'document';
}

/** React Query `retry` for what the document view reads: a refusal (403) or a missing document (404) is the answer, not asked again;
 *  anything else up to three times. */
export function retryUnlessRefused(failures: number, error: unknown): boolean {
  const status = (error as { response?: { status?: number } } | null)?.response?.status;
  return status !== 403 && status !== 404 && failures < 3;
}
