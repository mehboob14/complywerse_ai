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

/** The studio view is on for this tenant and the URL did not ask for the classic page (?classic=1). */
export function inStudio(enabled: boolean | undefined, params: { get(key: string): string | null }): boolean {
  // Statements and Gap Analysis stay on the classic page (the user's decision): links to them keep opening it
  const tab = (params.get('tab') ?? '').trim().toLowerCase();
  return enabled === true && params.get('classic') !== '1' && !CLASSIC_TABS.includes(tab);
}

/** The tabs only the classic page has. */
export const CLASSIC_TABS = ['statements', 'gap-analysis', 'gaps'];

export function viewOf(tab: string | null | undefined): DocView {
  const key = (tab ?? '').trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(ALIASES, key) ? ALIASES[key] : 'document';
}
