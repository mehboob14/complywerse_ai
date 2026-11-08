// The strip of tabs under the head of the three Assessments pages: Overview, All assessments, Types. Which tab is lit is decided here, from where the person is. The strip is page-local
// navigation, not a layout: an assessment (/assessments/a/<id>) has its own head with a link back. Every tab needs the right the sidebar's Assessments entries ask for, so a tab for a part
// of the module the person may not read is not drawn. `node --test` pins it (tabsModel.test.ts).
export const ASSESSMENT_TABS = [
  { key: 'overview', label: 'Overview', href: '/assessments', right: 'compliance:assessments:*' },
  { key: 'register', label: 'All assessments', href: '/assessments/register', right: 'compliance:assessments:*' },
  { key: 'types', label: 'Types', href: '/assessments/types', right: 'compliance:assessments:*' },
] as const;

export type AssessmentTab = (typeof ASSESSMENT_TABS)[number]['key'];

/** The tab a page lights; null for an assessment's own page or any other path. */
export function tabOf(pathname: string): AssessmentTab | null {
  const path = pathname.replace(/\/+$/, '') || '/';
  return ASSESSMENT_TABS.find((t) => t.href === path)?.key ?? null;
}

/** The tabs to draw: those whose right the person holds. The one being looked at is always drawn (a person who followed a link keeps their place on the strip). */
export function tabsFor(has: (right: string) => boolean, current: AssessmentTab | null): Array<(typeof ASSESSMENT_TABS)[number]> {
  return ASSESSMENT_TABS.filter((t) => t.key === current || has(t.right));
}

/** What the three pages call the area in their head: the sidebar's group, "Assessments"; the strip says which part the person is in. */
export const AREA = 'Assessments';
