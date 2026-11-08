// Navigation-registry entries of the Frameworks pages and the Organisation Profile (see navPages/index.ts for the contract). Owned by the builder of this group; nobody else edits it.
// `ownHeading: true` goes on a page the moment it draws the kit's page head (PageHeader variant="page" or the kit's PageHeading): the top bar then names only its section.
//
// THE HUB (2026-11-08): /frameworks is ONE page with the strip Journeys | Library | Onboarding (Journeys and Library are `?tab=` of /frameworks, Onboarding is its own page). The sidebar's Frameworks entry
// still points at /frameworks/manage (navAccess.ts is the parent's), which now forwards to /frameworks, so the entry below is a leaf that draws nothing and /frameworks is the page it lands on, named
// the same ("Frameworks"). When the menu points at /frameworks: move the `/frameworks` line from PAGES to LEAVES (`ownHeading: true`), drop `parent`, and make `/frameworks/manage` a PAGES entry
// with `aliasOf: '/frameworks'`.
import type { PageSpec, RouteExtra } from '../navRegistry.ts';

const AREA = 'compliance-management';
const MANAGE = '/frameworks/manage';

export const LEAVES: Record<string, RouteExtra> = {
  // the sidebar's entry: a forward to /frameworks (it draws no head, so it carries no flag)
  [MANAGE]: { keywords: ['Manage Frameworks', 'Framework library', 'Certification journeys', 'Compliance Frameworks', 'Dashboard'] },
  // Compliance Management > Organisation Profile: its page draws the kit's head ("Organisation Profile", the sidebar's name)
  '/compliance/organisation': { keywords: ['Organization profile', 'Organisation profile', 'Company profile'], ownHeading: true },
};

export const PAGES: PageSpec[] = [
  { path: '/frameworks', label: 'Frameworks', area: AREA, parent: MANAGE, hidden: 'the Frameworks entry of the menu opens it (through /frameworks/manage, which forwards here), and the Frameworks card of the Compliance overview', keywords: ['Frameworks dashboard', 'Compliance posture', 'Journeys', 'Framework library', 'Start a journey'], ownHeading: true },
  { path: '/frameworks/:id', label: 'Framework', area: AREA, parent: MANAGE, hidden: 'opens from a journey row of Frameworks, the Compliance overview, My Work and the evidence pages', ownHeading: true },
  { path: '/frameworks/overview/:id', label: 'Framework overview', area: AREA, parent: MANAGE, hidden: 'an old address that opens the details of that framework in the Library of Frameworks; stored links and bookmarks carry it' },
  // Framework onboarding (D66): the third tab of Frameworks, and the workspace of one framework's onboarding.
  { path: '/frameworks/onboarding', label: 'Onboarding', area: AREA, parent: MANAGE, hidden: 'the third tab of Frameworks, beside Journeys and Library, and the "Framework onboarding" link of the Organisation Profile', keywords: ['Framework onboarding', 'Certification journey', 'Framework journey'], ownHeading: true },
  { path: '/frameworks/onboarding/:id', label: 'Framework onboarding', area: AREA, parent: '/frameworks/onboarding', hidden: 'opens from a framework of the onboarding register and from the Library', ownHeading: true },
];
