// The strip of tabs under the head of every Business Continuity list page: Overview, Plans, Drills, Findings. Which tab is lit is decided here, from where the person is, and which tabs are
// offered follows the rights the three sidebar leaves used (a tab for a part of the module the person may not read is not drawn). The strip is page-local navigation, not a layout: a plan
// and a drill have their own head with a link back to their list. `node --test` pins it (tabsModel.test.ts).
export const BCM_TABS = [
  { key: 'overview', label: 'Overview', href: '/bcm', right: 'bcm:dashboard:*' },
  { key: 'plans', label: 'Plans', href: '/bcm/plans', right: 'bcm:plans:*' },
  { key: 'drills', label: 'Drills', href: '/bcm/drills', right: 'bcm:drills:*' },
  { key: 'findings', label: 'Findings', href: '/bcm/findings', right: 'bcm:findings:*' },
] as const;

export type BcmTab = (typeof BCM_TABS)[number]['key'];

/** The tab a list page lights; null for a plan, a drill or any other path. */
export function tabOf(pathname: string): BcmTab | null {
  const path = pathname.replace(/\/+$/, '') || '/';
  return BCM_TABS.find((t) => t.href === path)?.key ?? null;
}

/** The tabs to draw: those whose right the person holds. The one being looked at is always drawn (a person who followed a link to a page keeps their place on the strip). */
export function tabsFor(has: (right: string) => boolean, current: BcmTab | null): Array<(typeof BCM_TABS)[number]> {
  return BCM_TABS.filter((t) => t.key === current || has(t.right));
}

/** What the list pages call the area in their head: the sidebar will have ONE entry for it, the strip says which part the person is in. */
export const AREA = 'Business Continuity';
