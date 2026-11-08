// The strip of tabs under the head of every Evidence Management page: Library, Insights, Requirements, Audit packages, Settings. Which tab is lit is decided here, from where the
// person is (the path, and on /evidence the view and the section), so `node --test` can pin it (tabsModel.test.ts). The strip is page-local navigation, not a layout: the record
// page /evidence/[id] has its own head.
export const EVIDENCE_TABS = [
  { key: 'library', label: 'Library', href: '/evidence' },
  { key: 'insights', label: 'Insights', href: '/evidence?view=insights' },
  { key: 'requirements', label: 'Requirements', href: '/evidence-requirements' },
  { key: 'packages', label: 'Audit packages', href: '/evidence/audit-packages' },
  { key: 'settings', label: 'Settings', href: '/evidence?section=settings' },
] as const;

export type EvidenceTab = (typeof EVIDENCE_TABS)[number]['key'];

/** The tab a page lights: /evidence is the Library, Insights (?view=insights) or Settings (?section=settings); the other two pages are their own. null for any other path. */
export function tabOf(pathname: string, view: string = 'list', section: string = 'records'): EvidenceTab | null {
  const path = pathname.replace(/\/+$/, '') || '/';
  if (path === '/evidence-requirements') return 'requirements';
  if (path === '/evidence/audit-packages') return 'packages';
  if (path !== '/evidence') return null;
  if (section === 'settings') return 'settings';
  return view === 'insights' ? 'insights' : 'library';
}
