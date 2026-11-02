// Navigation-registry entries of the pages that belong to no module folder of their own (see navPages/index.ts for the contract). Written by R-REG, 2026-11-01.
import type { PageSpec, RouteExtra } from '../navRegistry.ts';

export const LEAVES: Record<string, RouteExtra> = {};

export const PAGES: PageSpec[] = [
  // The first Document Library, before Governance > Documents: a page of its own that no link opens. It is a Governance page (its sidebar twin is in the Governance group), so the top bar
  // names it from the registry like every Governance page; it guards nothing, like them (navRegistry.test.ts pins the list).
  { path: '/documents', label: 'Document Library', area: 'governance', parent: '/governance/documents', duplicateOf: '/governance/documents', hidden: 'the older Document Library (the sidebar lists Governance > Documents); no link opens it: reached by a typed or saved address' },
];
