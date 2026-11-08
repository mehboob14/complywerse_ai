// Navigation-registry entries of the Frameworks pages and the Organisation Profile (see navPages/index.ts for the contract). Owned by the builder of this group; nobody else edits it.
// `ownHeading: true` goes on a page the moment it draws the kit's page head (PageHeader variant="page" or the kit's PageHeading): the top bar then names only its section.
//
// THE HUB (2026-11-08): /frameworks is ONE page with the strip Journeys | Library | Onboarding (Journeys and Library are `?tab=` of /frameworks, Onboarding is its own page). It is the sidebar's Frameworks
// leaf (the menu points at it since Stage 4); /frameworks/manage is the old address of the leaf and forwards to it.
import type { PageSpec, RouteExtra } from '../navRegistry.ts';

const AREA = 'compliance-management';
const HUB = '/frameworks';

export const LEAVES: Record<string, RouteExtra> = {
  // the sidebar's entry and the hub it opens: the page draws the kit's head ("Frameworks", the sidebar's name)
  [HUB]: { ownHeading: true, keywords: ['Manage Frameworks', 'Framework library', 'Certification journeys', 'Compliance Frameworks', 'Dashboard', 'Frameworks dashboard', 'Compliance posture', 'Journeys', 'Start a journey'] },
};

export const PAGES: PageSpec[] = [
  // the menu's old address: a server redirect to the hub that keeps the query
  { path: '/frameworks/manage', label: 'Frameworks', area: AREA, aliasOf: HUB },
  { path: '/frameworks/:id', label: 'Framework', area: AREA, parent: HUB, hidden: 'opens from a journey row of Frameworks, the Compliance overview, My Work and the evidence pages', ownHeading: true },
  { path: '/frameworks/overview/:id', label: 'Framework overview', area: AREA, parent: HUB, hidden: 'an old address that opens the details of that framework in the Library of Frameworks; stored links and bookmarks carry it' },
  // Framework onboarding (D66): the third tab of Frameworks, and the workspace of one framework's onboarding.
  { path: '/frameworks/onboarding', label: 'Onboarding', area: AREA, parent: HUB, hidden: 'the third tab of Frameworks, beside Journeys and Library, and the "Framework onboarding" link of the Organisation Profile', keywords: ['Framework onboarding', 'Certification journey', 'Framework journey'], ownHeading: true },
  { path: '/frameworks/onboarding/:id', label: 'Framework onboarding', area: AREA, parent: '/frameworks/onboarding', hidden: 'opens from a framework of the onboarding register and from the Library', ownHeading: true },
];
