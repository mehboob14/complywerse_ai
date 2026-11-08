// node --test "src/lib/navPages/coverage.test.ts"
// THE WHOLE APP IN THE REGISTRY (R-REG, 2026-11-01): every page.tsx of src/app is exactly one entry of lib/navRegistry.ts, except the pages outside the signed-in shell, which are on an
// explicit allow-list with the reason. Every entry keeps the registry's rules (a name, an area, a trail to a sidebar leaf, a sentence for where it opens from, rights, forwards that really
// forward, duplicates that name the entry the sidebar uses, own headings that the page really draws) and the command palette's helpers (pagesForArea, searchRoutes) are exercised in search.test.ts.
// navRegistry.test.ts holds the Governance contract and the rules that need no folder walk; this file walks src/app.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { posix } from 'node:path';
import { fileURLToPath } from 'node:url';

import { areaName, breadcrumbFor, routeFor, routes, type RouteEntry } from '../navRegistry.ts';
import { flattenLeaves, navigation, navPermissions } from '../../components/layout/navAccess.ts';
import { activeNavHref } from '../../components/layout/navActive.ts';

const APP = fileURLToPath(new URL('../../app/', import.meta.url));
const HERE = fileURLToPath(new URL('./', import.meta.url));
const example = (path: string) => path.replace(/:[A-Za-z0-9_]+/g, '7');
const entry = (path: string): RouteEntry => {
  const found = routes.find((e) => e.path === path);
  assert.ok(found, `no entry for ${path}`);
  return found;
};
const leafPaths = flattenLeaves(navigation).map((l) => l.href);

// ---- the pages of the app, found the way Next finds them ----

interface AppPage { route: string; file: string }
/** `(dashboard)/erm/risks/[id]/page.tsx` -> `/erm/risks/:id`: a (route group) folder is transparent, a [param] folder is a :param. */
function allPages(): AppPage[] {
  return (readdirSync(APP, { recursive: true }) as string[])
    .map((file) => file.replace(/\\/g, '/'))
    .filter((file) => file === 'page.tsx' || file.endsWith('/page.tsx'))
    .map((file) => {
      const segments = file.split('/').slice(0, -1).filter((s) => !/^\(.+\)$/.test(s)).map((s) => s.replace(/^\[([A-Za-z0-9_]+)\]$/, ':$1'));
      return { route: `/${segments.join('/')}`, file };
    })
    .sort((a, b) => a.route.localeCompare(b.route));
}
const pages = allPages();
const read = (file: string) => readFileSync(`${APP}${file}`, 'utf8').replace(/\r\n/g, '\n');
const fileOf = (route: string): string => (pages.find((p) => p.route === route) as AppPage).file;

/** The pages that are NOT destinations of the signed-in shell (palette, crumbs, Work panel): they live outside the (dashboard) route group, so no sidebar and no top bar is drawn around them. */
const OUTSIDE_THE_SHELL: Record<string, string> = {
  '/': 'redirects to /dashboard before it draws anything',
  '/login': 'the sign-in page',
  '/register': 'account registration (public)',
  '/supplier': 'the supplier portal: "Get a new link" for a contact without a working one (public, its own layout)',
  '/supplier/:token': "the supplier portal's home, opened by a contact's personal e-mailed link (public)",
  '/supplier/:token/questionnaires/:qid': 'a questionnaire of the supplier portal (public, the link is the key)',
  '/supplier/:token/requests/:id': 'a request of the supplier portal (public, the link is the key)',
  '/vendor-risk/examiner/:token': "an examiner's read-only copy of an approved vendor report (public, the link is the key and expires)",
  '/vendor-risk/questionnaires/:token': "a questionnaire's own link as sent before personal links, still honoured (public, the link is the key)",
};
/** The one page outside the shell that HAS an entry: the Governance URL contract (G1) pins it and its trail. */
const PUBLIC_WITH_AN_ENTRY = '/attest/:token';
/** Sidebar leaves that no page.tsx of their own serves: none since Stage 4 (the DPIA, PDPL and Digital Operations Maturity leaves went; their addresses are the one dynamic page /assessments/:framework). */
const INSTANCES_OF_A_DYNAMIC_PAGE: Record<string, string> = {};

test('the walk finds the app: no catch-all segment (the registry does not model them), and the pages outside the shell are exactly the allow-list and the public attestation page', () => {
  assert.ok(pages.length >= 303, `the app had 303 pages when the registry was completed; the walk found ${pages.length}`);
  assert.deepEqual(pages.filter((p) => /\[\.{3}/.test(p.file)), [], 'a catch-all or optional catch-all folder: the registry has no entry shape for it');
  const outside = pages.filter((p) => !p.file.startsWith('(dashboard)/')).map((p) => p.route).sort();
  assert.deepEqual(outside, Object.keys(OUTSIDE_THE_SHELL).concat(PUBLIC_WITH_AN_ENTRY).sort(), 'a page outside (dashboard) is either allow-listed here or the attestation page');
});

test('EVERY page of the app is exactly one entry, except the allow-listed pages outside the shell (which have none)', () => {
  const missing: string[] = [];
  for (const { route } of pages) {
    const found = routes.filter((e) => e.path === route).length;
    if (route in OUTSIDE_THE_SHELL) assert.equal(found, 0, `${route} is allow-listed (${OUTSIDE_THE_SHELL[route]}): it must have no entry`);
    else if (found !== 1) missing.push(`${route} has ${found} entries`);
  }
  assert.deepEqual(missing, [], 'add the page to navPages/<group>.ts (label, area, parent, hidden), or to OUTSIDE_THE_SHELL here with the reason');
});

test('no ghost entries: every entry is a page of the app, or one of the declared sidebar addresses of a dynamic page (which the page serves and the entry names more exactly)', () => {
  const routesOfPages = pages.map((p) => p.route);
  const ghosts = routes.filter((e) => !routesOfPages.includes(e.path)).map((e) => e.path).sort();
  assert.deepEqual(ghosts, Object.keys(INSTANCES_OF_A_DYNAMIC_PAGE).sort());
  for (const [instance, page] of Object.entries(INSTANCES_OF_A_DYNAMIC_PAGE)) {
    assert.ok(routesOfPages.includes(page), `${page} is a page`);
    assert.ok(leafPaths.includes(instance), `${instance} is a sidebar leaf`);
    assert.equal(routeFor(instance)?.path, instance, `${instance} resolves to its own entry, not to the dynamic page's`);
  }
  assert.equal(routeFor('/assessments/cs_kpi')?.path, '/assessments/:framework', 'any other type is the dynamic page');
});

// ---- the rules every entry keeps ----

test('every entry has a name, an area that has a display name, and (unless a menu leaf, a tab or a forward) a sentence that says where it opens from', () => {
  for (const e of routes) {
    assert.ok(e.label.trim().length > 0, `${e.path}: no label`);
    assert.equal(e.label, e.label.trim(), `${e.path}: label has stray spaces`);
    assert.ok(e.area.length > 0, `${e.path}: no area`);
    assert.ok(areaName(e.area).length > 0, `${e.path}: the area "${e.area}" has no display name (SECTION in navRegistry.ts)`);
    if (!(leafPaths.includes(e.path) || e.tab || e.aliasOf)) {
      assert.ok(e.hidden && e.hidden.length >= 20 && !/^\s|\s$/.test(e.hidden), `${e.path}: needs a sentence for where it opens from`);
    }
    for (const k of e.keywords ?? []) assert.ok(k.trim().length > 1 && k === k.trim(), `${e.path}: keyword "${k}"`);
    assert.equal(new Set(e.keywords ?? []).size, (e.keywords ?? []).length, `${e.path}: a keyword is listed twice`);
  }
});

test('trails: at most 5 entries deep, every one reaches a sidebar leaf (or an explicit root outside the menu) and the sidebar lights exactly that leaf, with at most 7 crumbs', () => {
  for (const e of routes.filter((r) => !r.aliasOf)) {
    let depth = 1;
    let root: RouteEntry = e;
    while (root.parent) { root = entry(root.parent); depth++; assert.ok(depth <= 6, `${e.path}: cycle or a trail deeper than 5`); }
    assert.ok(depth <= 5, `${e.path}: ${depth} entries deep`);
    const url = example(e.path);
    const inMenu = leafPaths.includes(root.path);
    assert.equal(activeNavHref(url, navigation), inMenu ? root.path : undefined, `${url}: the sidebar lights ${activeNavHref(url, navigation) ?? 'nothing'}, the trail ends at ${root.path}`);
    const crumbs = breadcrumbFor(url);
    assert.ok(crumbs.length >= 1 && crumbs.length <= 7, `${url}: ${crumbs.length} crumbs`);
    assert.equal(crumbs[crumbs.length - 1].href, url.replace(/\/$/, ''), `${url}: the last crumb is the page itself`);
  }
});

test('every entry is the one its own example URL resolves to (no pattern hides another)', () => {
  for (const e of routes.filter((r) => !r.aliasOf)) assert.equal(routeFor(example(e.path))?.path, e.path, e.path);
  for (const e of routes.filter((r) => r.aliasOf)) assert.equal(routeFor(example(e.path))?.path, e.path, `${e.path} (a forward)`);
});

test('the group files: each leaf is declared once and is a sidebar leaf, each page once and is not a leaf, and they share no path', async () => {
  const files = readdirSync(HERE).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && f !== 'index.ts').sort();
  assert.ok(files.length >= 20, `the group files: ${files.join(', ')}`);
  const leaves: string[] = [];
  const declared: string[] = [];
  for (const file of files) {
    const group = await import(`./${file}`);
    assert.ok(group.LEAVES && Array.isArray(group.PAGES), `${file}: exports LEAVES and PAGES`);
    leaves.push(...Object.keys(group.LEAVES));
    declared.push(...group.PAGES.map((p: { path: string }) => p.path));
  }
  assert.deepEqual(leaves.filter((p, i) => leaves.indexOf(p) !== i), [], 'a sidebar leaf extra declared by two groups (the later one would silently win)');
  assert.deepEqual(declared.filter((p, i) => declared.indexOf(p) !== i), [], 'a page declared by two groups');
  for (const href of leaves) assert.ok(leafPaths.includes(href), `${href}: a LEAVES key is a sidebar leaf`);
  for (const path of declared) assert.ok(!leafPaths.includes(path), `${path}: a sidebar leaf is not declared as a page`);
  for (const path of declared) assert.ok(routes.some((e) => e.path === path), `${path}: reaches the registry`);
});

// ---- forwards, duplicates, rights ----

/** The page a forward goes to, read from its source: router.replace / redirect with a path (query and hash dropped, a ${...} part standing for :param), else the page it re-exports or renders. */
function forwardTarget(source: string): { to?: string; renders?: string } {
  const call = /(?:router\.(?:replace|push)|redirect)\(\s*(?:[^`'"\n;?]*\?\s*)?[`'"]([^`'"?#$]*)/.exec(source);           // the literal start of the path, up to a query, a hash or a ${...}; a conditional (`query ? `/x?${q}` : '/x'`) is read at its first literal
  if (call) return { to: call[1].replace(/\/$/, '') };
  const reexport = /export\s*\{\s*default[^}]*\}\s*from\s*['"]([^'"]+)['"]/.exec(source) ?? /^import\s+\w+\s+from\s+['"](\.[^'"]*page)['"]/m.exec(source);
  return reexport ? { renders: reexport[1] } : {};
}

test('every forward is real: its page replaces itself with, re-exports or is rendered by the entry the registry names as its target, and has the same name', () => {
  const aliases = routes.filter((e) => e.aliasOf);
  assert.ok(aliases.length >= 17, 'the forwards of the app');
  const pageOf = (file: string) => file.replace(/\.tsx$/, '');
  for (const a of aliases) {
    const target = entry(a.aliasOf as string);
    assert.equal(target.aliasOf, undefined, `${a.path}: a forward points at a page, not at a forward`);
    assert.equal(a.label, target.label, `${a.path}: the name of its target`);
    assert.equal(a.hidden, undefined, `${a.path}: a forward is not hidden`);
    const source = read(fileOf(a.path));
    const hop = source.split('\n').length <= 40 ? forwardTarget(source) : {};          // a long page is a page, not a forward: it is the one the target's page renders
    if (hop.to !== undefined) {
      assert.ok(hop.to === target.path || target.path.startsWith(`${hop.to}/:`), `${a.path} sends to "${hop.to}", the registry says ${target.path}`);
    } else if (hop.renders !== undefined) {
      assert.equal(posix.join(posix.dirname(fileOf(a.path)), hop.renders), pageOf(fileOf(target.path)), `${a.path} re-exports ${hop.renders}, the registry says ${target.path}`);
    } else {
      const there = forwardTarget(read(fileOf(target.path))).renders;
      assert.ok(there !== undefined && posix.join(posix.dirname(fileOf(target.path)), there) === pageOf(fileOf(a.path)), `${a.path}: neither a redirect to ${target.path} nor the page ${target.path} renders`);
    }
  }
});

test('duplicates: the entry a copy names exists, is a page the sidebar (or the top bar) uses, and is not itself a copy or a forward; the pairs are the ones the inventory lists', () => {
  const copies = routes.filter((e) => e.duplicateOf);
  for (const c of copies) {
    const used = entry(c.duplicateOf as string);
    assert.equal(used.duplicateOf, undefined, `${c.path} -> ${used.path} is a copy of a copy`);
    assert.equal(used.aliasOf, undefined, `${c.path} -> ${used.path} is a forward`);
    assert.equal(c.aliasOf, undefined, `${c.path}: a copy is a page of its own, not a forward`);
    assert.ok(c.hidden && c.hidden.length > 20, `${c.path}: a copy says what it is`);
    assert.ok(c.parent, `${c.path}: a copy hangs under a page`);
    assert.ok(c.path !== used.path);
  }
  const byFamily = (prefix: RegExp) => copies.filter((c) => prefix.test(c.path)).length;
  // the GRC-native cyber pages are copies of the ones under /cyber-assurance; Ava's admin / users / ComplyChat pages are copies of the app's
  assert.equal(byFamily(/^\/(assets|asset-discovery|risk-posture|vulnerabilities|integrations|compliance-plugins|my-runs)(\/|$)/), 29, 'the GRC-native cyber pages');
  assert.equal(byFamily(/^\/cyber-assurance\/(admin|users|complychat)(\/|$)/), 19, "Ava's copies of Administration, User Management and ComplyChat");
  assert.equal(copies.length, 29 + 19 + 1, 'and the older Document Library');
  assert.equal(entry('/documents').duplicateOf, '/governance/documents');
  for (const c of copies.filter((x) => /^\/(assets|asset-discovery|risk-posture|vulnerabilities|integrations|compliance-plugins|my-runs)(\/|$)/.test(x.path))) {
    assert.equal(c.duplicateOf, `/cyber-assurance${c.path}`, 'a native cyber page is the copy of the same path under /cyber-assurance');
  }
  for (const c of copies.filter((x) => /^\/cyber-assurance\/admin(\/|$)/.test(x.path))) assert.equal(c.duplicateOf, c.path.replace('/cyber-assurance', ''), "Ava's admin page is the copy of the same path under /admin");
});

test('rights: a leaf has the sidebar\'s, a page navAccess lists has those, a page that gates itself says so (pinned), every other page has those of the page it hangs under or forwards to', () => {
  // the pages that gate themselves or sit under the Administration menu: what their code checks (PermissionGuard with navPermissions, or a "locked" view without the agents right)
  const OWN: Record<string, { permissions: string[] | null; adminOnly?: true }> = {
    '/bcm/plans': { permissions: ['bcm:plans:*'] },                      // the tabs of Business Continuity are offered on their own rights (the one leaf lists the three)
    '/bcm/drills': { permissions: ['bcm:drills:*'] },
    '/bcm/findings': { permissions: ['bcm:findings:*'] },
    '/admin': { permissions: null, adminOnly: true },
    '/admin/ui-kit': { permissions: null, adminOnly: true },        // PermissionGuard required={navPermissions(PATH)}, which is [] for a page nobody listed: administrators only
    '/admin/agents': { permissions: ['compliance:agents:manage'] },
    '/admin/discover': { permissions: ['compliance:discover:execute', 'compliance:agents:manage'] },
    '/admin/integrations/connect': { permissions: ['compliance:agents:manage'] },                  // "Connect Wizard is locked" without it
    '/admin/integrations/connect/ad-discover': { permissions: ['compliance:agents:manage'] },      // "AD Discovery is locked" without it
    '/governance/documents/overview': { permissions: null },       // At a glance: the owner of a department who reads no library opens it (ownerDoor); the server answers 403 to anyone else
    '/cyber-assurance/admin': { permissions: null, adminOnly: true },
    '/cyber-assurance/admin/agents': { permissions: ['compliance:agents:manage'] },
    '/cyber-assurance/admin/discover': { permissions: ['compliance:discover:execute', 'compliance:agents:manage'] },
    '/cyber-assurance/admin/integrations/connect': { permissions: ['compliance:agents:manage'] },
    '/cyber-assurance/admin/integrations/connect/ad-discover': { permissions: ['compliance:agents:manage'] },
  };
  /** What the page says about itself, else what the page it hangs under (or forwards to) says: the rule, written again from the sidebar's own data. */
  const effective = (e: RouteEntry): { permissions: string[] | null; adminOnly?: true } => {
    let at: RouteEntry | undefined = e;
    for (let hops = 0; at && hops < 8; hops++) {
      if (OWN[at.path]) return OWN[at.path];
      const listed = navPermissions(at.path);
      if (listed.length) return { permissions: listed };
      const next: string | undefined = at.aliasOf ?? at.parent;
      at = next ? entry(next) : undefined;
    }
    return { permissions: null };                    // the public attestation page: it hangs under nothing
  };
  for (const e of routes) {
    const from = effective(e);
    assert.deepEqual(e.permissions, from.permissions, `${e.path}: ${navPermissions(e.path).length ? "navAccess lists it" : OWN[e.path] ? 'it gates itself' : 'the rights of the page it hangs under'}`);
    assert.equal(e.adminOnly, from.adminOnly, `${e.path}: the Administration menu's rule goes with it`);
  }
  // everything under /admin that is not one of the scanner-onboarding pages is the Administration menu's (administrators only); nothing outside it is
  const adminOnly = routes.filter((e) => e.adminOnly).map((e) => e.path).sort();
  assert.ok(adminOnly.includes('/admin') && adminOnly.includes('/admin/roles') && adminOnly.includes('/admin/users/:id/usage') && adminOnly.includes('/workflow-engine'));
  assert.ok(!adminOnly.includes('/users') && !adminOnly.includes('/admin/agents'));
  for (const path of adminOnly) assert.ok(/^\/(admin|workflow-engine|cyber-assurance\/admin)(\/|$)/.test(path), `${path}: only the Administration pages are administrators-only`);
  // the people who hold no right see nothing that needs one: a page with rights is never offered "to everyone"
  assert.deepEqual(entry('/users').permissions, ['admin:users:view']);
  assert.deepEqual(entry('/complychat').permissions, ['dashboard:ai_insights:view']);
  assert.deepEqual(entry('/reports/print').permissions, ['reports:reports:*']);
});

// ---- the heading each entry says its page draws ----

test('ownHeading is on exactly the pages that draw the kit head (PageHeader variant="page"), except the pages whose head is drawn by a component, and the Documents area where the tab strip is the top bar', () => {
  // MetricReport.tsx and _Standalone.tsx draw it; the Risk Management monitoring pages (G9) draw it in their register / board / Analytics frame (erm/_monitoring, erm/analytics/_frame); so do Controls Automation's _explorer/ControlsExplorer, review/_review/MappingReview and assurance/_periods/AuditPeriods, and ComplianceOverview.tsx and StatementsRegister.tsx (thin-shell pages), and the control workspace (soc2-controls/[code]/_workspace/ControlHeader); the Frameworks hub (_hub/FrameworksHub), the journey (_workspace/JourneyHeader), a framework's onboarding (the workspace) and the Organisation Profile draw theirs from a component too; so do the three Business Continuity registers (bcm/_plans/PlansRegister, _drills/DrillsRegister, _findings/FindingsRegister); so do the Control Catalog (controls/_catalog/CatalogPage) and the Control Library's pages (control-library/_library/*)
  const HEAD_FROM_A_COMPONENT = ['/governance/kpi-report', '/governance/mappings', '/automation/soc2-controls', '/automation/soc2-controls/review', '/automation/assurance', '/compliance', '/compliance/statements', '/automation/soc2-controls/:code',
    '/frameworks', '/frameworks/:id', '/frameworks/onboarding/:id', '/bcm/plans', '/bcm/drills', '/bcm/findings',
    '/dashboard',
    '/controls', '/control-library', '/control-library/:id', '/control-library/review',
    '/assessments/register', '/assessments/types',
    '/erm/incidents', '/erm/mitigation-actions', '/erm/appetite', '/erm/analytics', '/erm/analytics/aggregation', '/erm/analytics/bowtie', '/erm/analytics/dependencies', '/erm/analytics/kri-triggers',
    '/erm/analytics/scenario', '/erm/risks', '/erm/risk-assessments', '/erm/risk-assessments/ai-risk-assessment',
    '/admin/organization'];                       // Administration > Organisation: the Organisation Profile component draws the head (Company is its first stage)
  const DOCUMENTS_AREA_STRIP = ['/governance/documents/attestation', '/governance/documents/studio', '/governance/documents/overview', '/governance/exceptions', '/governance/reviews', '/governance/settings'];
  const drawing = pages.filter((p) => /<PageHeader[\s\S]{0,60}variant="page"/.test(read(p.file))).map((p) => p.route).sort();
  const flagged = routes.filter((e) => e.ownHeading).map((e) => e.path).sort();
  assert.deepEqual(flagged, drawing.filter((r) => !DOCUMENTS_AREA_STRIP.includes(r)).concat(HEAD_FROM_A_COMPONENT).sort());
  for (const path of flagged) assert.equal(routeFor(example(path))?.ownHeading, true, path);
  for (const path of DOCUMENTS_AREA_STRIP) assert.equal(entry(path).ownHeading, undefined, `${path}: its top bar is the Documents tab strip`);
  // the Access Reviews and Cybersecurity Assurance pages are metadata only: no flag, no file changed
  for (const e of routes.filter((r) => r.path.startsWith('/compliance/access-reviews') || r.path.startsWith('/cyber-assurance'))) assert.equal(e.ownHeading, undefined, e.path);
});

// ---- a trail for an example URL of every module ----

test('breadcrumbFor gives a sane trail for an example URL of every module', () => {
  const labels = (url: string) => breadcrumbFor(url).map((c) => c.label);
  assert.deepEqual(labels('/dashboard'), ['Performance Overview']);
  assert.deepEqual(labels('/tasks/9'), ['Task Management', 'Task']);
  assert.deepEqual(labels('/governance/committees/3'), ['Governance', 'Committees', 'Committee']);
  assert.deepEqual(labels('/erm/risks/12'), ['Risk Management', 'Operational Risk', 'Risk Register', 'Risk']);
  assert.deepEqual(labels('/erm/rcsa/campaigns/4'), ['Risk Management', 'Operational Risk', 'RCSA', 'RCSA Campaigns', 'RCSA campaign']);
  assert.deepEqual(labels('/erm/analytics/heatmap'), ['Risk Management', 'Operational Risk', 'Advanced Analytics'], 'the heat map is the home of Advanced Analytics: its older address is the same page');
  assert.deepEqual(labels('/erm/analytics/dependencies'), ['Risk Management', 'Operational Risk', 'Advanced Analytics', 'Risk Dependencies']);
  assert.deepEqual(labels('/erm/appetite'), ['Risk Management', 'Operational Risk', 'Risk Appetite']);
  assert.deepEqual(labels('/erm/kris'), ['Governance', 'KRIs']);
  assert.deepEqual(labels('/vendor-risk/assessments/5'), ['Third-Party Vendor Risk', 'Vendors', 'Vendor Assessments', 'Vendor assessment']);
  assert.deepEqual(labels('/vendor-risk/policy'), ['Third-Party Vendor Risk', 'Roster', 'Policy']);
  assert.deepEqual(labels('/compliance/assessments/8'), ['Compliance Management', 'Overview', 'Assessment Control Center', 'Assessment']);
  assert.deepEqual(labels('/frameworks/3'), ['Compliance Management', 'Frameworks', 'Framework']);
  assert.deepEqual(labels('/evidence/44'), ['Compliance Management', 'Evidence Management', 'Evidence item']);
  assert.deepEqual(labels('/assessments/dpia'), ['Compliance Management', 'Assessments', 'Overview', 'Framework assessments'], 'an old type address is the forward under the Assessments Overview');
  assert.deepEqual(labels('/assessments/register'), ['Compliance Management', 'Assessments', 'All assessments']);
  assert.deepEqual(labels('/cyber-security/questionnaires/cs_kpi'), ['Compliance Management', 'Assessments', 'Types', 'Assessment type']);
  assert.deepEqual(labels('/assessments/cs_kpi'), ['Compliance Management', 'Assessments', 'Overview', 'Framework assessments']);
  assert.deepEqual(labels('/bcm/plans/2'), ['Compliance Management', 'Business Continuity', 'Plans', 'Continuity plan']);
  assert.deepEqual(labels('/compliance/access-reviews/9'), ['Compliance Management', 'Access Reviews', 'Access review']);
  assert.deepEqual(labels('/control-library/5'), ['Compliance Management', 'Overview', 'Control Library', 'Control domain']);
  assert.deepEqual(labels('/automation/soc2-controls/coverage'), ['Controls Automation', 'Controls', 'Requirement coverage']);
  assert.deepEqual(labels('/issues/3'), ['Issue & Incident Management', 'Issues', 'Issue']);
  assert.deepEqual(labels('/auditor-portal/statutory-audit/6'), ['Auditor Portal', 'Statutory Audit', 'Audit observation']);
  assert.deepEqual(labels('/reports/trends'), ['Reports', 'Quick export', 'Trends']);
  assert.deepEqual(labels('/admin/roles'), ['Administration', 'Roles & permissions']);
  assert.deepEqual(labels('/admin/users/4/usage'), ['Administration', 'Users', 'User usage']);
  assert.deepEqual(labels('/users'), ['User Management']);
  assert.deepEqual(labels('/complychat'), ['Comply Agent']);
  assert.deepEqual(labels('/workflow-engine'), ['Administration', 'Workflow Engine']);
  assert.deepEqual(labels('/cyber-assurance/assets/11'), ['Cybersecurity Assurance', 'IT Asset Inventory', 'Asset']);
  assert.deepEqual(labels('/cyber-assurance/vulnerabilities/sla'), ['Cybersecurity Assurance', 'Vulnerabilities', 'Remediation days']);
  assert.deepEqual(labels('/assets/11'), ['Cybersecurity Assurance', 'IT Asset Inventory', 'Asset'], 'an older copy is not repeated on the way');
  assert.deepEqual(labels('/assets'), ['Cybersecurity Assurance', 'IT Asset Inventory'], 'a copy that is the page itself replaces the name of the page it copies');
  assert.deepEqual(breadcrumbFor('/assets').map((c) => c.href), ['/cyber-assurance/dashboard', '/assets'], 'and keeps its own URL');
  assert.deepEqual(labels('/my-runs'), ['Cybersecurity Assurance', 'Performance', 'My runs & team activity']);
  assert.deepEqual(labels('/vulnerabilities/dashboard'), ['Cybersecurity Assurance', 'Vulnerabilities', 'Vulnerability Dashboard']);
  assert.deepEqual(labels('/cyber-assurance/admin/roles'), ['Cybersecurity Assurance', 'Performance', 'Administration', 'Role Management']);
  assert.deepEqual(labels('/compliance-overview'), ['Cybersecurity Assurance', 'Performance', 'Compliance & Scans']);
  assert.deepEqual(labels('/admin/agents'), ['Administration', 'Compliance Agents']);
  assert.deepEqual(labels('/documents'), ['Governance', 'Documents', 'Document Library']);
  // a forward shows its target's trail
  assert.deepEqual(labels('/erm/internal-controls'), ['Compliance Management', 'Overview', 'Control Catalog']);
  assert.deepEqual(labels('/erm/internal-controls'), labels('/controls'));
  assert.deepEqual(labels('/vendor-risk/shadow-saas'), ['Third-Party Vendor Risk']);
});
