// The tools of the Advanced Analytics page, in the order of its strip. Each keeps the address it always had (the strip is links, so a bookmark, the sidebar's deep links and Back all
// land where they did); the first tool is also the page's home, /erm/analytics. Dependencies is a tool here and no longer a page of its own (/erm/dependencies forwards to it).
// Pure, `node --test src/app/(dashboard)/erm/analytics/_frame/tools.test.ts` pins the order, the addresses and which tool an address belongs to.

export interface Tool { key: string; label: string; href: string; /** other addresses that show the same tool */ also?: string[]; blurb: string }

export const TOOLS: readonly Tool[] = [
  { key: 'heatmap', label: 'Heat map', href: '/erm/analytics', also: ['/erm/analytics/heatmap'], blurb: 'Where the open risks sit on the likelihood and impact grid. Click a cell to see its risks.' },
  { key: 'aggregation', label: 'Aggregation', href: '/erm/analytics/aggregation', blurb: 'The register added up: by category, by business unit and by status.' },
  { key: 'scenario', label: 'Scenario', href: '/erm/analytics/scenario', blurb: 'What if conditions change: move the likelihood or impact of chosen risks and see the scores.' },
  { key: 'bowtie', label: 'Bow-tie', href: '/erm/analytics/bowtie', blurb: 'One risk with the incidents behind it, its controls and its actions, built from the register.' },
  { key: 'kri-triggers', label: 'KRI triggers', href: '/erm/analytics/kri-triggers', blurb: 'The KRIs that are past a threshold now, and by how much.' },
  { key: 'dependencies', label: 'Dependencies', href: '/erm/analytics/dependencies', also: ['/erm/dependencies'], blurb: 'Which risks cause or amplify others, and what a risk sets off downstream.' },
];

const trim = (path: string): string => (path.length > 1 ? path.replace(/\/+$/, '') : path);

/** The tool an address belongs to (null for an address outside the family). */
export function toolFor(pathname: string | null | undefined): Tool | null {
  const path = trim(pathname ?? '');
  return TOOLS.find((t) => t.href === path || (t.also ?? []).includes(path)) ?? null;
}
