// Navigation-registry entries of the Regulatory Changes and Feeds (URLs under /governance, menu group Compliance Management) pages (see navPages/index.ts for the contract). Owned by the builder of this group; nobody else edits it.
// `ownHeading: true` goes on a page the moment it draws the kit's page head (PageHeader variant="page"): the top bar then names only its section.
// The sub-page /governance/regulatory-changes/:id is declared in navRegistry.ts with the other Governance routes (its page draws the kit head with the change's own title; the flag would have to be set there). R-REG (2026-11-01) added the names the two leaves are searched by.
// Stage 4 (2026-11-08): both pages draw the kit's page head and are one family, Overview . Changes . Feed. The Overview and Changes are tabs of /governance/regulatory-changes (?tab=changes); Feed is /governance/regulatory-feeds,
// kept as its own address and reached through the strip, so the sidebar has ONE leaf (Regulatory Changes, which also lights for the Feed) and the Feed is a page under it.
import type { PageSpec, RouteExtra } from '../navRegistry.ts';

export const LEAVES: Record<string, RouteExtra> = {
  '/governance/regulatory-changes': { ownHeading: true, section: 'Compliance Management', keywords: ['Regulatory updates', 'Circulars', 'Regulator circulars', 'Regulatory overview'] },
};

export const PAGES: PageSpec[] = [
  // area 'governance' like the leaf it hangs under (the URL is under /governance); the top bar names the menu group, Compliance Management
  { path: '/governance/regulatory-feeds', label: 'Regulatory Feeds', area: 'governance', parent: '/governance/regulatory-changes', hidden: 'the Feed tab of Regulatory Changes, beside Overview and Changes', ownHeading: true, section: 'Compliance Management', keywords: ['Regulator feeds', 'News feeds', 'Regulatory feed'] },
];
