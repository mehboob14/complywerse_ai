// node --test "src/lib/navRegistry.test.ts"
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { activeTab, breadcrumbFor, isInArea, ownHeadingSection, registryNamesPage, routeFor, routes, sectionOfEntry, subtitleFor, tabsFor, titleFor, type RouteEntry } from './navRegistry.ts';
import { flattenLeaves, isGroup, navigation, navPermissions, type NavEntry } from '../components/layout/navAccess.ts';
import { activeNavHref } from '../components/layout/navActive.ts';

const APP = fileURLToPath(new URL('../app/', import.meta.url));
const SRC = fileURLToPath(new URL('../', import.meta.url));
const entry = (path: string): RouteEntry => {
  const found = routes.find((e) => e.path === path);
  assert.ok(found, `no entry for ${path}`);
  return found;
};
const example = (path: string) => path.replace(/:[A-Za-z]+/g, '7');                  // a pattern as a real URL
const isStatic = (path: string) => !path.includes(':');
/** The destinations that end a trail without being a leaf of the sidebar: the Administration menu is pinned at the foot of the sidebar (not an entry of `navigation`), User Management and ComplyChat are links of the top bar, and the public acknowledgement page has no shell. */
const ROOTS_OUTSIDE_THE_MENU = ['/admin', '/users', '/complychat', '/attest/:token'];

// ---- the registry and the app's folders ----

/** `governance/documents/[id]/page.tsx` -> `/governance/documents/:id` for every page of a folder of the app. */
function pagesOf(folder: string, base: string): string[] {
  return (readdirSync(`${APP}${folder}`, { recursive: true }) as string[])
    .map((file) => file.replace(/\\/g, '/'))
    .filter((file) => file === 'page.tsx' || file.endsWith('/page.tsx'))
    .map((file) => `${base}${file.slice(0, -'page.tsx'.length).replace(/\/$/, '').replace(/^(?=.)/, '/')}`.replace(/\[([A-Za-z]+)\]/g, ':$1'));
}

const subfolders = (at: string) => readdirSync(at, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
/** Whether Next would find a page for these URL segments under a folder: a folder by name, else a [param] folder; a (route group) folder is transparent. */
function hasPage(at: string, segments: string[]): boolean {
  if (segments.length === 0 && existsSync(`${at}/page.tsx`)) return true;
  return subfolders(at).some((name) => (/^\(.+\)$/.test(name) ? hasPage(`${at}/${name}`, segments)
    : segments.length > 0 && (name === segments[0] || /^\[[^\]]+\]$/.test(name)) && hasPage(`${at}/${name}`, segments.slice(1))));
}

test('every page of the Governance folder is exactly one entry, and every Governance URL of the registry is a page', () => {
  const pages = pagesOf('(dashboard)/governance', '/governance');
  assert.equal(pages.length, 27, 'the folder holds the 26 pages of the URL contract and the Documents Overview');
  for (const page of pages) assert.equal(routes.filter((e) => e.path === page).length, 1, page);
  for (const e of routes.filter((r) => r.path.startsWith('/governance'))) assert.ok(pages.includes(e.path), `${e.path} has no page.tsx`);
});

test('every entry of the registry is a page of the app: no sidebar link and no Governance entry points nowhere', () => {
  for (const e of routes) assert.ok(hasPage(APP, e.path.split('/').filter(Boolean)), `${e.path} has no page in src/app`);
  assert.ok(!hasPage(APP, ['governance', 'nowhere']), 'the check can say no');
});

test('the other pages of the Governance sidebar group and their sub-pages are entries too', () => {
  for (const base of ['erm/kris', 'is-projects']) {
    for (const page of pagesOf(`(dashboard)/${base}`, `/${base}`)) assert.ok(routes.some((e) => e.path === page), page);
  }
});

// ---- one entry per sidebar leaf, named as the sidebar names it, needing what the sidebar says ----

test('every sidebar leaf has an entry: its name is the label, its rights are the sidebar\'s, its groups are the menu groups', () => {
  const trail = (entries: NavEntry[], path: string[] = []): Array<[string, string[]]> => entries.flatMap((e) => (isGroup(e) ? trail(e.items, [...path, e.name]) : [[e.href, path] as [string, string[]]]));
  const groupsOf = Object.fromEntries(trail(navigation));
  for (const leaf of flattenLeaves(navigation)) {
    const e = entry(leaf.href);
    assert.equal(e.label, leaf.name, leaf.href);
    assert.deepEqual(e.permissions ?? [], navPermissions(leaf.href), `${leaf.name}: rights`);      // null: none (Needs my action is open to anyone signed in)
    assert.deepEqual(e.groups.map((g) => g.label), groupsOf[leaf.href], `${leaf.name}: groups`);
    assert.equal(e.hidden, undefined, `${leaf.name} is in the menu`);
  }
});

test("the rights of a page without a menu entry are those of the page it hangs under: the registry adds no guard, and navAccess still says where there is none", () => {
  const leafPaths = flattenLeaves(navigation).map((l) => l.href);
  const rightsOf = (e: RouteEntry): RouteEntry => { let at = e; while (at.aliasOf || at.parent) at = entry((at.aliasOf ?? at.parent) as string); return at; };
  for (const e of routes.filter((r) => !leafPaths.includes(r.path) && navPermissions(r.path).length === 0)) {
    // a Governance page: no page of it gates itself, so it is offered to whoever is offered the page it hangs under (a root with no rights: everyone)
    // (except the pages made for the owner of a department who reads no library - `ownerDoor`, At a glance: they take no right, pinned in the At a glance test below)
    if (e.area === 'governance' && !e.tab?.ownerDoor) assert.deepEqual(e.permissions, rightsOf(e).permissions, e.path);
  }
  // the Governance pages that guard nothing today (any signed-in user opens them by URL; navAccess lists no right for them); G3_permission_matrix lists which of their APIs are open too
  const unguarded = routes.filter((e) => e.area === 'governance' && !leafPaths.includes(e.path) && navPermissions(e.path).length === 0).map((e) => e.path);
  assert.deepEqual(unguarded, [
    '/governance/documents/:id', '/governance/documents/overview', '/governance/documents/studio', '/governance/documents/studio/:sessionId', '/governance/documents/attestation',
    '/governance/attestations', '/governance/attestations/campaigns', '/governance/attestations/campaigns/:id', '/governance/attestations/my',
    '/governance/attestations/complete/:id', '/governance/exceptions', '/governance/settings', '/governance/reviews', '/governance/reviews/calendar',
    '/governance/mappings', '/governance/workflows', '/governance/committees/:id', '/governance/committees/meetings/:id', '/governance/committees/actions',
    '/governance/regulatory-changes/:id', '/is-projects/dashboard', '/is-projects/my-projects', '/is-projects/:id', '/attest/:token', '/documents',
  ]);
});

// ---- identity, trail, forwards ----

test('paths are unique, and so are the tabs of a strip (by id and by place)', () => {
  const paths = routes.map((e) => e.path);
  assert.deepEqual(paths.filter((p, i) => paths.indexOf(p) !== i), []);
  const tabs = routes.flatMap((e) => (e.tab ? [e.tab] : []));
  for (const area of Array.from(new Set(tabs.map((t) => t.area)))) {
    const own = tabs.filter((t) => t.area === area);
    assert.equal(new Set(own.map((t) => t.id)).size, own.length, `${area}: tab ids`);
    assert.equal(new Set(own.map((t) => t.order)).size, own.length, `${area}: tab places`);
  }
});

test('the trail of every entry reaches a root without a cycle, through static pages that are entries', () => {
  for (const e of routes) {
    const seen: string[] = [];
    for (let at: RouteEntry | undefined = e.aliasOf ? entry(e.aliasOf) : e; at; at = at.parent ? routes.find((r) => r.path === at!.parent) : undefined) {
      assert.ok(!seen.includes(at.path), `${e.path}: cycle at ${at.path}`);
      seen.push(at.path);
      if (at.parent) {
        assert.ok(isStatic(at.parent), `${at.path}: its parent ${at.parent} has a :param, which a URL cannot fill in`);
        assert.ok(routes.some((r) => r.path === at!.parent), `${at.path}: no entry for its parent ${at.parent}`);
      }
    }
    const root = routes.find((r) => r.path === seen[seen.length - 1]) as RouteEntry;
    assert.ok(root.groups.length > 0 || flattenLeaves(navigation).some((l) => l.href === root.path) || ROOTS_OUTSIDE_THE_MENU.includes(root.path), `${e.path}: root ${root.path} is not a menu entry`);
  }
});

test('a forward is another URL of an entry that is a page of its own, under the same name', () => {
  const aliases = routes.filter((e) => e.aliasOf);
  assert.deepEqual(aliases.map((e) => [e.path, e.aliasOf]), [
    ['/governance/attestations', '/governance/documents/attestation'],
    ['/governance/reviews/calendar', '/governance/reviews'],                // not a forward: the same page opened on its calendar view
    ['/governance/approvals', '/needs-my-action'],                          // "My Approvals" became the global queue; the address forwards to it (a server redirect)
    // the rest of the app (R-REG): forwards and second addresses of the same page; navPages/coverage.test.ts reads every page file and holds each one to its target
    ['/erm/internal-controls', '/controls'],
    ['/erm/internal-controls/:id', '/controls'],
    ['/erm/ai-risk-assessment', '/erm/risk-assessments/ai-risk-assessment'],
    ['/erm/risks/dashboard', '/erm/risks'],                                  // not a forward: /erm/risks renders this page
    ['/erm/risk-assessments/dashboard', '/erm/risk-assessments'],            // not a forward: /erm/risk-assessments renders this page
    ['/vendor-risk/procurement', '/vendor-risk'],
    ['/vendor-risk/shadow-saas', '/vendor-risk'],
    ['/vendor-risk/settings/alert-rules', '/vendor-risk/policy'],
    ['/automation/scope', '/automation/soc2-controls'],
    ['/admin/access-reviews', '/compliance/access-reviews'],
    ['/admin/access-reviews/connect', '/compliance/access-reviews/connect'],
    ['/admin/access-reviews/rules', '/compliance/access-reviews/rules'],
    ['/admin/access-reviews/:id', '/compliance/access-reviews/:id'],
    ['/admin/teams', '/admin'],
    ['/cyber-assurance/helpdesk/home', '/cyber-assurance/helpdesk/dashboard'],
    ['/cyber-assurance/admin/teams', '/cyber-assurance/admin'],
  ]);
  for (const a of aliases) {
    const target = entry(a.aliasOf as string);
    assert.equal(target.aliasOf, undefined);
    assert.equal(a.label, target.label);
    assert.equal(titleFor(example(a.path)), titleFor(example(target.path)));
    assert.equal(a.tab, undefined);
  }
});

test('every page is reached through a menu entry, a tab, a forward, or the page it hangs under (and says from where)', () => {
  const inMenu = flattenLeaves(navigation).map((l) => l.href);
  for (const e of routes) {
    const reached = inMenu.includes(e.path) || !!e.tab || !!e.aliasOf;
    if (reached) continue;
    assert.ok(e.hidden && e.hidden.length > 10, `${e.path}: not in the menu, no tab, no forward: it needs a reason`);
    assert.ok(e.parent || ROOTS_OUTSIDE_THE_MENU.includes(e.path), `${e.path}: reached from nowhere`);
  }
  assert.ok(routes.every((e) => !e.hidden || !(e.tab || e.aliasOf || inMenu.includes(e.path))), 'a page in a menu or a tab bar is not hidden');
});

test('a short label is a tab\'s display variant and differs from the label; names are unique among the pages that hang under the same page', () => {
  for (const e of routes.filter((r) => r.shortLabel)) {
    assert.ok(e.tab, `${e.path}: a shortLabel belongs to a tab`);
    assert.notEqual(e.shortLabel, e.label);
  }
  const siblings = routes.filter((e) => !e.aliasOf);
  for (const e of siblings) {
    const same = siblings.filter((o) => o.parent === e.parent && o.groups.map((g) => g.label).join('/') === e.groups.map((g) => g.label).join('/') && o.label === e.label);
    assert.equal(same.length, 1, `${e.path} shares its name "${e.label}" with ${same.map((s) => s.path).join(', ')}`);
  }
});

// ---- the URL contract (G1): every URL keeps resolving ----

const CONTRACT = [
  '/governance', '/governance/documents', '/governance/documents/44', '/governance/documents/studio', '/governance/documents/studio/12',
  '/governance/documents/attestation', '/governance/approvals', '/governance/exceptions', '/governance/reviews', '/governance/reviews/calendar',
  '/governance/mappings', '/governance/workflows', '/governance/committees', '/governance/committees/actions', '/governance/committees/3',
  '/governance/committees/meetings/9', '/governance/kpi-report', '/governance/settings', '/governance/regulatory-changes', '/governance/regulatory-changes/5',
  '/governance/regulatory-feeds', '/governance/attestations', '/governance/attestations/campaigns', '/governance/attestations/campaigns/4',
  '/governance/attestations/complete/4', '/governance/attestations/my', '/erm/kris', '/is-projects', '/is-projects/dashboard', '/is-projects/my-projects',
  '/is-projects/7', '/dashboard', '/attest/abc123',
];

test('every URL of the contract resolves to an entry, with its query or hash ignored; the one forward is explicit', () => {
  assert.equal(CONTRACT.length, 33, 'G1_url_contracts.md lists 33 routes');
  for (const url of CONTRACT) {
    assert.ok(routeFor(url), url);
    assert.ok(routeFor(`${url}/`), `${url}/`);
    assert.ok(routeFor(`${url}?tab=approvals&act=ack#top`), `${url}?query`);
    assert.ok(titleFor(url), `${url} has a title`);
    assert.ok(breadcrumbFor(url).length > 0, `${url} has a trail`);
  }
  assert.equal(routeFor('/governance/attestations')?.aliasOf, '/governance/documents/attestation');
  assert.equal(routeFor('/attest/some-token')?.path, '/attest/:token');
});

test('the forward is real: the legacy attestations page replaces itself with the entry the registry names as its target', () => {
  const source = readFileSync(`${APP}(dashboard)/governance/attestations/page.tsx`, 'utf8');
  const forward = routes.find((e) => e.path === '/governance/attestations') as RouteEntry;
  assert.ok(source.includes(`router.replace('${forward.aliasOf}')`), `${forward.path} does not forward to ${forward.aliasOf}`);
});

test("the review calendar's URL is the Reviews page itself, opened on its calendar view: it renders the target's page, it does not redirect", () => {
  const calendar = readFileSync(`${APP}(dashboard)/governance/reviews/calendar/page.tsx`, 'utf8');
  assert.ok(/export \{ default \} from '\.\.\/page';/.test(calendar), 'the calendar URL re-exports the Reviews page');
  assert.ok(!/redirect|router\./.test(calendar), 'no redirect: the address stays /governance/reviews/calendar');
  assert.equal(entry('/governance/reviews/calendar').aliasOf, '/governance/reviews');
  assert.equal(entry('/governance/reviews/calendar').hidden, undefined, "it is no hidden page: it is the Reviews tab's address");
});

test('a static page beats a :param page of the same shape, a :param matches one segment only, and a path that is no route is no entry', () => {
  assert.equal(routeFor('/governance/documents/studio')?.path, '/governance/documents/studio');
  assert.equal(routeFor('/governance/documents/12')?.path, '/governance/documents/:id');
  assert.equal(routeFor('/governance/documents/attestation')?.path, '/governance/documents/attestation');
  assert.equal(routeFor('/governance/documents/overview')?.path, '/governance/documents/overview');
  assert.equal(routeFor('/governance/committees/meetings/9')?.path, '/governance/committees/meetings/:id');
  assert.equal(routeFor('/governance/committees/actions')?.path, '/governance/committees/actions');
  assert.equal(routeFor('/governance/documents/12/extra'), undefined);
  assert.equal(routeFor('/governance/documentsX'), undefined);
  assert.equal(routeFor('/governance/nowhere'), undefined);
  assert.equal(routeFor('/'), undefined);
});

test('the active menu entry agrees with the trail: a page lights the menu entry it hangs under', () => {
  for (const e of routes.filter((r) => !r.aliasOf)) {
    const url = example(e.path);
    let root: RouteEntry = e;
    while (root.parent) root = entry(root.parent);
    const inMenu = flattenLeaves(navigation).some((l) => l.href === root.path);
    assert.equal(activeNavHref(url, navigation), inMenu ? root.path : undefined, `${url} (hangs under ${root.path})`);
  }
});

// ---- names ----

test('titleFor: the destination\'s title, its label by default; a forward has its target\'s', () => {
  assert.equal(titleFor('/governance'), 'Governance Overview');
  assert.equal(subtitleFor('/governance'), 'Real-time policy, framework, and review posture');
  assert.equal(titleFor('/governance/documents'), 'Documents');
  assert.equal(titleFor('/governance/documents/12'), 'Document');
  assert.equal(titleFor('/governance/committees/3'), 'Committee');
  assert.equal(titleFor('/governance/attestations/campaigns/7'), 'Attestation Campaign');
  assert.equal(titleFor('/governance/attestations'), 'Attestation');
  assert.equal(subtitleFor('/governance/attestations'), 'Document acknowledgment campaigns');
  assert.equal(titleFor('/is-projects'), 'Projects');
  assert.equal(titleFor('/erm/kris'), 'KRIs');
  assert.equal(titleFor('/dashboard'), 'Performance Overview');
  assert.equal(titleFor('/governance/exceptions'), 'Exceptions');
  assert.equal(entry('/governance/exceptions').shortLabel, undefined);          // the tab says what the page is called
});

test('the five pages that said only "Governance" in the top bar have their own name now', () => {
  assert.deepEqual(
    ['/governance/approvals', '/governance/mappings', '/governance/reviews', '/governance/workflows', '/governance/exceptions'].map((p) => titleFor(p)),
    ['Needs my action', 'Policy-Control Mappings', 'Document Reviews', 'Approval Workflows', 'Exceptions'],            // /governance/approvals forwards to the queue
  );
  for (const e of routes.filter((r) => r.area === 'governance')) {
    assert.notEqual(titleFor(example(e.path)), 'Governance', e.path);
    assert.notEqual(subtitleFor(example(e.path)), 'Policy and document lifecycle management', e.path);
  }
});

test('the old names stay findable (keywords), and no keyword repeats the label', () => {
  assert.deepEqual(entry('/governance/committees').keywords, ['Board & Committee Management']);
  assert.deepEqual(entry('/is-projects').keywords, ['IS Projects']);
  assert.deepEqual(entry('/erm/kris').keywords, ['Key Risk Indicators']);
  assert.deepEqual(entry('/governance/documents').keywords, ['Document library']);
  assert.deepEqual(entry('/governance/approvals').keywords, ['Pending Approvals']);
  assert.deepEqual(entry('/governance/reviews').keywords, ['Reviews', 'Review Calendar']);
  assert.equal(titleFor('/is-projects/dashboard'), 'Projects Overview');
  for (const e of routes) for (const k of e.keywords ?? []) assert.notEqual(k, e.label, `${e.path}: a keyword repeats the label`);
});

test('breadcrumbFor: the menu groups, the pages it hangs under, then the page (the last is current, with the real URL)', () => {
  assert.deepEqual(breadcrumbFor('/governance/documents/12'), [
    { label: 'Governance', href: '/governance' }, { label: 'Documents', href: '/governance/documents' }, { label: 'Document', href: '/governance/documents/12' },
  ]);
  assert.deepEqual(breadcrumbFor('/governance/committees/3'), [
    { label: 'Governance', href: '/governance' }, { label: 'Committees', href: '/governance/committees' }, { label: 'Committee', href: '/governance/committees/3' },
  ]);
  assert.deepEqual(breadcrumbFor('/governance/attestations/campaigns/7'), [
    { label: 'Governance', href: '/governance' }, { label: 'Documents', href: '/governance/documents' }, { label: 'Attestation', href: '/governance/documents/attestation' },
    { label: 'Attestation Campaigns', href: '/governance/attestations/campaigns' }, { label: 'Attestation Campaign', href: '/governance/attestations/campaigns/7' },
  ]);
  assert.deepEqual(breadcrumbFor('/governance/attestations'), [
    { label: 'Governance', href: '/governance' }, { label: 'Documents', href: '/governance/documents' }, { label: 'Attestation', href: '/governance/documents/attestation' },
  ]);
  assert.deepEqual(breadcrumbFor('/governance/regulatory-changes/5'), [
    { label: 'Compliance Management', href: '/compliance' }, { label: 'Regulatory Changes', href: '/governance/regulatory-changes' }, { label: 'Regulatory change', href: '/governance/regulatory-changes/5' },
  ]);
  assert.deepEqual(breadcrumbFor('/governance'), [{ label: 'Governance', href: '/governance' }, { label: 'Overview', href: '/governance' }]);
  assert.deepEqual(breadcrumbFor('/attest/abc'), [{ label: 'Acknowledge', href: '/attest/abc' }]);
  assert.deepEqual(breadcrumbFor('/tasks'), [{ label: 'Task Management', href: '/tasks' }]);
  assert.deepEqual(breadcrumbFor('/erm/analytics/scenario').map((c) => c.label), ['Risk Management', 'Operational Risk', 'Scenario Analysis']);
});

test('an unknown or odd path falls back (undefined, an empty trail) and never throws', () => {
  for (const odd of ['', '/', '//', '/nowhere', '/governance/%E0%A4%A', `/${'a/'.repeat(300)}`, '?x=1', '#h', '/governance/documents/12/13/14']) {
    assert.equal(titleFor(odd), undefined, odd);
    assert.deepEqual(breadcrumbFor(odd), [], odd);
    assert.equal(routeFor(odd), undefined, odd);
  }
  for (const nothing of [null, undefined]) {
    assert.equal(titleFor(nothing), undefined);
    assert.equal(subtitleFor(nothing), undefined);
    assert.deepEqual(breadcrumbFor(nothing), []);
    assert.equal(isInArea('documents', nothing), false);
    assert.equal(activeTab('documents', nothing), undefined);
  }
});

// ---- tabs (the full pin of the Documents tab bar is documentsTabs.test.ts) ----

test('the Documents strip: seven tabs in order; the Studio only where it is on, Settings only to those who hold its right', () => {
  assert.deepEqual(tabsFor('documents').map((t) => t.path), [
    '/governance/documents', '/governance/documents/overview', '/governance/documents/studio', '/governance/documents/attestation', '/governance/reviews',
    '/governance/exceptions', '/governance/settings',
  ]);
  const labels = (studio: boolean, can: boolean) => tabsFor('documents', { studio, can: () => can }).map((t) => t.label);
  assert.deepEqual(labels(true, true), ['Documents', 'At a glance', 'Comply AI Studio', 'Attestation', 'Document Reviews', 'Exceptions', 'Governance settings']);
  assert.deepEqual(labels(false, true), ['Documents', 'At a glance', 'Attestation', 'Document Reviews', 'Exceptions', 'Governance settings']);
  assert.deepEqual(labels(true, false), ['Documents', 'At a glance', 'Comply AI Studio', 'Attestation', 'Document Reviews', 'Exceptions']);
  assert.deepEqual(labels(false, false), ['Documents', 'At a glance', 'Attestation', 'Document Reviews', 'Exceptions']);
  assert.equal(tabsFor('documents', { studio: true, can: (p) => p === 'governance:settings:*' }).length, 7, 'the right asked for is governance:settings:*');
  assert.equal(tabsFor('documents', { studio: true, can: (p) => p === 'governance:settings:view' }).length, 6);
  assert.deepEqual(tabsFor('nowhere'), []);
});

test('At a glance is the second tab, for everyone who sees the strip with or without the Studio, and its page lights it and not Documents', () => {
  const overview = entry('/governance/documents/overview');
  assert.deepEqual([overview.tab?.area, overview.tab?.id, overview.tab?.order, overview.tab?.permission, overview.tab?.studio], ['documents', 'overview', 2, undefined, undefined]);
  assert.equal(overview.label, 'At a glance', 'not "Overview": the sidebar\'s Governance Overview is the dashboard');
  assert.equal(overview.shortLabel, undefined, 'the tab says what the page is called');
  assert.equal(overview.hidden, undefined);
  assert.equal(overview.permissions, null, 'the registry adds no right and no guard: the server answers 403 to anyone who reads no library and heads no department');
  for (const ctx of [{ studio: true, can: () => false }, { studio: false, can: () => false }, { studio: false, can: () => true }]) {
    assert.equal(tabsFor('documents', ctx)[1].path, '/governance/documents/overview', JSON.stringify(ctx.studio));
  }
  for (const url of ['/governance/documents/overview', '/governance/documents/overview?dept=12', '/governance/documents/overview/']) {
    assert.equal(isInArea('documents', url), true, url);
    assert.equal(activeTab('documents', url)?.path, '/governance/documents/overview', url);
    assert.equal(activeTab('documents', url, { studio: true })?.path, '/governance/documents/overview', `${url} (Studio on)`);
    assert.equal(titleFor(url), 'At a glance', url);
  }
  assert.deepEqual(breadcrumbFor('/governance/documents/overview').map((c) => c.label), ['Governance', 'Documents', 'At a glance']);
  assert.equal(activeTab('documents', '/governance/documents')?.path, '/governance/documents', 'the library still lights Documents');
  assert.equal(activeNavHref('/governance/documents/overview', navigation), '/governance/documents', 'the sidebar keeps Documents lit');
  // Next finds the page before the document page: a static folder beats [id]
  assert.ok(existsSync(`${APP}(dashboard)/governance/documents/overview/page.tsx`));
});

test('Reviews is a door of its own: a tab of the Documents strip for everyone who sees the strip (no right of its own), lit on both of its URLs', () => {
  const reviews = entry('/governance/reviews');
  assert.equal(reviews.hidden, undefined, 'it is no longer reached only from the Overview counter');
  assert.deepEqual([reviews.tab?.area, reviews.tab?.id, reviews.tab?.permission, reviews.tab?.studio], ['documents', 'reviews', undefined, undefined]);
  assert.equal(reviews.label, 'Document Reviews');
  assert.equal(reviews.shortLabel, 'Reviews');
  assert.deepEqual(reviews.permissions, entry('/governance/documents').permissions, 'no right of its own: it is offered to whoever is offered the strip (the Documents entry)');
  for (const ctx of [{ studio: true, can: () => false }, { studio: false, can: () => false }, { studio: false, can: () => true }]) {
    assert.ok(tabsFor('documents', ctx).some((t) => t.path === '/governance/reviews'), JSON.stringify(ctx.studio));
  }
  for (const url of ['/governance/reviews', '/governance/reviews/calendar', '/governance/reviews/calendar?month=2026-11&day=2026-11-12', '/governance/reviews?view=calendar']) {
    assert.equal(isInArea('documents', url), true, url);
    assert.equal(activeTab('documents', url)?.path, '/governance/reviews', url);
    assert.equal(titleFor(url), 'Document Reviews', url);
  }
  assert.deepEqual(breadcrumbFor('/governance/reviews/calendar').map((c) => c.label), ['Governance', 'Documents', 'Document Reviews']);
  // the tabs on either side keep their places
  assert.deepEqual(tabsFor('documents').map((t) => t.tab.order), [1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(tabsFor('documents').map((t) => t.tab.id), ['documents', 'overview', 'studio', 'attestation', 'reviews', 'exceptions', 'settings']);
});

test('a short label is only what the tab shows; the tooltip and the accessible name are the label', () => {
  const settings = tabsFor('documents').find((t) => t.tab.id === 'settings') as RouteEntry;
  assert.equal(settings.label, 'Governance settings');
  assert.equal(settings.shortLabel, 'Settings');
  assert.equal(titleFor('/governance/settings'), 'Governance settings');
});

// ---- the consumers read the registry and keep no names of their own ----

const read = (path: string) => readFileSync(`${SRC}${path}`, 'utf8').replace(/\r\n/g, '\n');
const withoutComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '');
const stringLiterals = (source: string) => withoutComments(source).match(/(['"`])(?:\\.|(?!\1).)*\1/g) ?? [];

test('DocumentsTabs has no route of its own: its tabs, its area rule and its lit tab come from the registry; the label is the tooltip and the accessible name', () => {
  const source = read('components/governance/DocumentsTabs.tsx');
  assert.ok(source.includes("from '@/lib/navRegistry'"));
  assert.deepEqual(stringLiterals(source).filter((s) => /\/governance|\/erm|\/is-projects/.test(s)), [], 'a route literal in DocumentsTabs.tsx');
  for (const call of ['tabsFor(', 'activeTab(', 'isInArea(']) assert.ok(source.includes(call), call);
  assert.ok(source.includes('title={t.label}') && source.includes('aria-label={t.label}'), 'the full label is the tooltip and the accessible name');
  assert.ok(source.includes('t.shortLabel ?? t.label'), 'the short label is what the tab shows');
  // an icon for every tab of the strip (it keeps the presentation; the registry keeps the names)
  for (const { tab } of tabsFor('documents')) assert.ok(new RegExp(`\\b${tab.id}:\\s*\\{\\s*icon:\\s*[A-Z]`).test(source), `no icon for the ${tab.id} tab`);
});

test('the Header names Governance pages from the registry and keeps no Governance title of its own', () => {
  const source = read('components/layout/Header.tsx');
  assert.ok(source.includes("from '@/lib/navRegistry'"));
  assert.ok(source.includes('titleFor(pathname)') && source.includes('subtitleFor(pathname)'));
  const table = source.slice(source.indexOf('const PAGE_TITLES'), source.indexOf('export default function Header'));
  const keys = Array.from(table.matchAll(/^\s*'(\/[^']*)':/gm)).map((m) => m[1]);
  assert.ok(keys.length > 20, 'the title map of the other modules is still there');
  assert.deepEqual(keys.filter((k) => routeFor(k)?.area === 'governance' || k.startsWith('/governance') || k.startsWith('/is-projects')), [], 'a Governance title kept in the Header');
});

test('a page that draws its own heading is flagged in the registry, and only its section is shown in the top bar', () => {
  assert.deepEqual(routes.filter((e) => e.ownHeading && e.area === 'governance').map((e) => e.path).sort(), [
    '/governance', '/governance/committees', '/governance/committees/:id', '/governance/committees/actions', '/governance/committees/meetings/:id', '/governance/kpi-report',
    '/governance/mappings', '/governance/workflows', '/is-projects', '/is-projects/:id', '/is-projects/dashboard', '/is-projects/my-projects',
  ]);
  assert.equal(ownHeadingSection('/governance'), 'Governance');
  assert.equal(ownHeadingSection('/governance/kpi-report'), 'Governance');
  // the four committee pages draw their own heading with PageHeader variant="page" (Committees, the committee's name, the meeting's title, Oversight Actions)
  for (const url of ['/governance/committees', '/governance/committees/3', '/governance/committees/meetings/9', '/governance/committees/actions']) assert.equal(ownHeadingSection(url), 'Governance', url);
  // and so do the four Projects pages (Projects, Projects Overview, My Projects, the project's name)
  for (const url of ['/is-projects', '/is-projects/dashboard', '/is-projects/my-projects', '/is-projects/150']) assert.equal(ownHeadingSection(url), 'Governance', url);
  // and so does Policy-Control Mappings (standalone: its page head is the kit's; inside a document it is a section, and the page there is the document's own)
  assert.equal(ownHeadingSection('/governance/mappings'), 'Governance');
  // and so does the legacy Approval Workflows page (its page head is PageHeader variant="page")
  assert.equal(ownHeadingSection('/governance/workflows'), 'Governance');
  assert.equal(ownHeadingSection('/governance/exceptions'), undefined, 'a page without the flag shows its own title in the top bar');
  assert.equal(ownHeadingSection('/governance/approvals'), '', 'the forward is named as its target: the queue draws its own heading, the top bar names no section');
  assert.equal(ownHeadingSection('/risk/unknown-page'), undefined, 'not a route');
  assert.equal(ownHeadingSection(null), undefined);
});

test('the owner of a department with no governance right gets the library and At a glance, and no other tab', () => {
  const owner = { studio: true, can: () => false, ownerOnly: true };
  assert.deepEqual(tabsFor('documents', owner).map((t) => t.label), ['Documents', 'At a glance']);
  assert.deepEqual(tabsFor('documents', { ...owner, studio: false }).map((t) => t.label), ['Documents', 'At a glance']);
  assert.equal(tabsFor('documents', { studio: true, can: () => true }).length, 7, 'without the flag nothing changes');
  assert.equal(tabsFor('documents').length, 7);
  for (const tab of tabsFor('documents')) assert.equal(!!tab.tab.ownerDoor, ['documents', 'overview'].includes(tab.tab.id), tab.tab.id);
});

// ---- the other modules' groups of pages (lib/navPages/<group>.ts): the rules every builder's entries must keep ----

test("no URL is declared twice: a sidebar leaf, a Governance page and a group's page are one entry each", () => {
  const seen = new Set<string>();
  for (const e of routes) { assert.ok(!seen.has(e.path), `${e.path} is declared twice`); seen.add(e.path); }
});

test('the registry names the Governance pages and the pages with ownHeading, in any module, and no others', () => {
  for (const e of routes) {
    const url = example(e.path);
    const target = e.aliasOf ? entry(e.aliasOf) : e;
    assert.equal(registryNamesPage(url), e.area === 'governance' || !!target.ownHeading, e.path);
    assert.equal(ownHeadingSection(url) !== undefined, !!target.ownHeading, `${e.path}: a section for exactly the pages that draw their own heading`);
  }
  assert.equal(registryNamesPage('/nowhere/at/all'), false, 'not a route');
  assert.equal(registryNamesPage(null), false);
});

test("the section of a page that draws its own heading: its group's name, nothing for a module's top page, an override where the URL says otherwise", () => {
  assert.equal(sectionOfEntry({ area: 'task-management', label: 'Task Management' }), '', 'Task Management says "Task Management" in its body, not also in the bar');
  assert.equal(sectionOfEntry({ area: 'task-management', label: 'Task' }), 'Task Management');
  assert.equal(sectionOfEntry({ area: 'performance-overview', label: 'Performance Overview' }), '');
  assert.equal(sectionOfEntry({ area: 'governance', label: 'Overview', title: 'Governance Overview' }), 'Governance');
  assert.equal(sectionOfEntry({ area: 'compliance-management', label: 'Frameworks' }), 'Compliance Management');
  assert.equal(sectionOfEntry({ area: 'governance', label: 'Regulatory Changes', section: 'Compliance Management' }), 'Compliance Management', 'the URL is under /governance, the menu group is Compliance Management');
  assert.equal(sectionOfEntry({ area: 'no-such-area', label: 'X' }), '', 'an area with no name shows nothing rather than a wrong name');
});

test("an own-heading page shows a section unless it is its module's top page: an area missing from SECTION cannot pass unnoticed", () => {
  for (const e of routes.filter((r) => r.ownHeading)) {
    const section = sectionOfEntry(e);
    if (section === '') assert.ok(e.groups.length === 0 && !e.hidden && !e.parent, `${e.path} shows no section: only a module's top page may (its area '${e.area}' needs a name in SECTION, or a section override)`);
  }
});
