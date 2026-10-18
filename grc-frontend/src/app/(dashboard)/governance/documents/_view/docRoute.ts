// Which document view a URL opens. Old ?tab= links (emails, tasks, bookmarks) keep working.

export type DocView = 'document' | 'approvals' | 'statements' | 'mappings' | 'gaps' | 'versions';

export const VIEWS: { key: DocView; label: string }[] = [
  { key: 'document', label: 'Document' },
  { key: 'approvals', label: 'Approvals' },
  { key: 'statements', label: 'Statements' },
  { key: 'mappings', label: 'Mappings' },
  { key: 'gaps', label: 'Gap analysis' },
  { key: 'versions', label: 'Versions' },
];

/** The views that work on the library (its statements, framework mappings and gap analyses): for people who read the library. */
export const LIBRARY_VIEWS: ReadonlySet<DocView> = new Set<DocView>(['statements', 'mappings', 'gaps']);

const ALIASES: Record<string, DocView> = {
  document: 'document',
  viewer: 'document',
  approvals: 'approvals',
  lifecycle: 'approvals',
  'sign-off': 'approvals',
  discussion: 'approvals',
  'review-history': 'approvals',
  statements: 'statements',
  mappings: 'mappings',
  controls: 'mappings',
  gaps: 'gaps',
  'gap-analysis': 'gaps',
  versions: 'versions',
  chain: 'versions',
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
