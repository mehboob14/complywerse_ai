// Which document view a URL opens. Old ?tab= links (emails, tasks, bookmarks) keep working.

export type DocView = 'document' | 'approvals' | 'mappings' | 'versions';

export const VIEWS: { key: DocView; label: string }[] = [
  { key: 'document', label: 'Document' },
  { key: 'approvals', label: 'Approvals' },
  { key: 'mappings', label: 'Mappings' },
  { key: 'versions', label: 'Versions' },
];

const ALIASES: Record<string, DocView> = {
  document: 'document',
  viewer: 'document',
  approvals: 'approvals',
  lifecycle: 'approvals',
  'sign-off': 'approvals',
  discussion: 'approvals',
  'review-history': 'approvals',
  mappings: 'mappings',
  controls: 'mappings',
  statements: 'mappings',
  'gap-analysis': 'mappings',
  gaps: 'mappings',
  versions: 'versions',
  chain: 'versions',
};

/** The studio view is on for this tenant. There is no way to the classic page (the user, 2026-10-17): links to statements or gap
 * analysis open the Mappings view (`viewOf`), and ?classic=1 is ignored. */
export function inStudio(enabled: boolean | undefined): boolean {
  return enabled === true;
}

export function viewOf(tab: string | null | undefined): DocView {
  const key = (tab ?? '').trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(ALIASES, key) ? ALIASES[key] : 'document';
}
