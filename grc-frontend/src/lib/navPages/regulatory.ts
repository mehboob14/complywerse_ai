// Navigation-registry entries of the Regulatory Changes and Feeds (URLs under /governance, menu group Compliance Management) pages (see navPages/index.ts for the contract). Owned by the builder of this group; nobody else edits it.
// `ownHeading: true` goes on a page the moment it draws the kit's page head (PageHeader variant="page"): the top bar then names only its section.
// The sub-page /governance/regulatory-changes/:id is declared in navRegistry.ts with the other Governance routes (its page draws the kit head with the change's own title; the flag would have to be set there). R-REG (2026-11-01) added the names the two leaves are searched by.
// Stage 4 (2026-11-08): both pages draw the kit's page head and are one family, Overview . Changes . Feed. The Overview and Changes are tabs of /governance/regulatory-changes (?tab=changes); Feed is /governance/regulatory-feeds,
// kept as its own address. The sidebar entry for the Feed can go (the strip is the way to it): the parent edits navAccess.ts.
import type { PageSpec, RouteExtra } from '../navRegistry.ts';

export const LEAVES: Record<string, RouteExtra> = {
  '/governance/regulatory-changes': { ownHeading: true, section: 'Compliance Management', keywords: ['Regulatory updates', 'Circulars', 'Regulator circulars', 'Regulatory overview'] },
  '/governance/regulatory-feeds': { ownHeading: true, section: 'Compliance Management', keywords: ['Regulator feeds', 'News feeds', 'Regulatory feed'] },
};

export const PAGES: PageSpec[] = [
];
