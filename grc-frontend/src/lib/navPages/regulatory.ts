// Navigation-registry entries of the Regulatory Changes and Feeds (URLs under /governance, menu group Compliance Management) pages (see navPages/index.ts for the contract). Owned by the builder of this group; nobody else edits it.
// `ownHeading: true` goes on a page the moment it draws the kit's page head (PageHeader variant="page"): the top bar then names only its section.
// The sub-page /governance/regulatory-changes/:id is declared in navRegistry.ts with the other Governance routes. R-REG (2026-11-01) added the names the two leaves are searched by.
import type { PageSpec, RouteExtra } from '../navRegistry.ts';

// Uncomment an entry when its page moves to the kit; the builder confirms (or corrects) each label, parent and `hidden` sentence against the code.
export const LEAVES: Record<string, RouteExtra> = {
  // '/governance/regulatory-changes': { ownHeading: true, section: 'Compliance Management' },
  // '/governance/regulatory-feeds': { ownHeading: true, section: 'Compliance Management' },
  '/governance/regulatory-changes': { keywords: ['Regulatory updates', 'Circulars', 'Regulator circulars'] },
  '/governance/regulatory-feeds': { keywords: ['Regulator feeds', 'News feeds'] },
};

export const PAGES: PageSpec[] = [
];
