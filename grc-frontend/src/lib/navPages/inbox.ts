// Navigation-registry entries of Needs my action (see navPages/index.ts for the contract). Owned by the builder of this group; nobody else edits it.
// `ownHeading: true` goes on a page the moment it draws the kit's page head (PageHeader variant="page"): the top bar then names only the section.
import type { PageSpec, RouteExtra } from '../navRegistry.ts';

// /needs-my-action is a sidebar leaf (navAccess.ts: the first entry, shown to everyone who is signed in). It is a global destination, not a part of Governance: its area is its own name and the top
// bar says nothing over its page (the section is the page's own name: sectionOfEntry returns ''). The page has no sub-pages: the three sections are one page.
export const LEAVES: Record<string, RouteExtra> = {
  '/needs-my-action': { ownHeading: true, keywords: ['approvals', 'my approvals', 'pending approvals', 'to do', 'inbox'] },
};

// /governance/approvals was the menu entry "My Approvals" (Governance). Stored notifications, task buttons and e-mails still carry it, so the page stays for ever and forwards (a server redirect):
// an alias of the queue, as the registry models a forward (no `hidden`: a forward is reached from the stored links that carry it).
// Its old code is kept beside it (_LegacyApprovalsPage.tsx): the action-review log it showed has no new home yet.
export const PAGES: PageSpec[] = [
  { path: '/governance/approvals', label: 'Needs my action', area: 'needs-my-action', aliasOf: '/needs-my-action', keywords: ['Pending Approvals'] },
];
