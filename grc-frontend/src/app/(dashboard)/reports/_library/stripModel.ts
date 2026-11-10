// The strip across the top of the Reports area (Reports | Dashboards | Trends | Analytics): which tabs a person is offered, which one is open, and the pages that have no strip. Pure
// (stripModel.test.ts). The rights are the ones each page already guards itself with (navAccess: the Reports leaf, PAGE_PERMISSIONS for dashboards and trends, the Analytics leaf): the strip
// offers a tab to the people its page lets in, so a person with only the dashboards right finally has a door to Dashboards.

export interface StripTab { key: 'reports' | 'dashboards' | 'trends' | 'analytics'; href: string; label: string; rights: readonly string[] }

export const STRIP_TABS: readonly StripTab[] = [
  { key: 'reports', href: '/reports', label: 'Reports', rights: ['reports:reports:*'] },
  { key: 'dashboards', href: '/reports/dashboards', label: 'Dashboards', rights: ['reports:dashboards:*'] },
  { key: 'trends', href: '/reports/trends', label: 'Trends', rights: ['reports:reports:*', 'reports:dashboards:*', 'reports:analytics:*'] },
  { key: 'analytics', href: '/reports/analytics', label: 'Analytics', rights: ['reports:analytics:*'] },
];

const clean = (pathname: string | null | undefined): string => {
  const p = (pathname ?? '').split(/[?#]/)[0].replace(/\/+$/, '');
  return p === '' ? '/' : p;
};

/** The tab a page belongs to; null for a page that has no strip (the builder, the print view, an unknown page). */
export function stripTabOf(pathname: string | null | undefined): StripTab['key'] | null {
  const p = clean(pathname);
  return STRIP_TABS.find((t) => t.href === p)?.key ?? null;
}

/** Whether the page shows the strip: the four pages of the area. The builder is a workspace that needs the whole window, and the print view is chrome-free. */
export const showsStrip = (pathname: string | null | undefined): boolean => stripTabOf(pathname) !== null;

/** The tabs a person is offered: those whose page they may open. `has` answers for one right. */
export function visibleTabs(has: (right: string) => boolean): StripTab[] {
  return STRIP_TABS.filter((t) => t.rights.some(has));
}
