// node --test "src/app/(dashboard)/frameworks/_hub/hubPage.test.ts"
// What the Frameworks hub keeps and how it is built now (a facet register on one page), pinned in the files that carry it (there is no React renderer here; behaviour is checked in a browser): the
// requests keep their keys and endpoints and read the lists whole, a failed request is said and never drawn as an empty list or zeros, every figure comes from the journey model, every mutation reports
// and the two deletes ask first, the onboarding gate is the server's (a refusal shows its notice), the deletes follow the page's right and the server's shared-framework refusal, and the kit's rules hold.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { findViolations } from '../../../../components/ui/ds/kitRules.ts';

const DIR = fileURLToPath(new URL('./', import.meta.url));
const SOURCES = readdirSync(DIR).filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f)).map((file) => ({ file, text: readFileSync(`${DIR}${file}`, 'utf8').replace(/\r\n/g, '\n') }));
const TSX = SOURCES.filter((s) => s.file.endsWith('.tsx'));
const src = (file: string) => SOURCES.find((s) => s.file === file)!.text;
/** An emoji or a dingbat: built from a string, because the source is compiled for ES5, which rejects the `u` flag in a literal. */
const EMOJI = new RegExp('[\\u{1F300}-\\u{1FAFF}\\u2600-\\u27BF]', 'u');
const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/\s.*$/gm, '$1');

test('the folder is what the pins read', () => {
  assert.deepEqual(SOURCES.map((s) => s.file).sort(), [
    'FrameworksHub.tsx', 'FrameworksStrip.tsx', 'HubDrawer.tsx', 'HubRegister.tsx', 'HubRows.tsx', 'PostureTiles.tsx', 'TrendActivity.tsx',
    'hubAddress.ts', 'hubData.ts', 'hubFacets.ts', 'hubModel.ts', 'overviewModel.ts', 'useHubActions.tsx',
  ]);
});

test('the requests keep their keys and endpoints, read the lists whole (the old pages read 100 and ignored the library\'s total) and never poll', () => {
  const data = code(src('hubData.ts'));
  assert.match(data, /JOURNEYS_KEY = \['certifications'\]/, 'shared with the Compliance overview and the auditor portal');
  assert.match(data, /LIBRARY_KEY = \['uploaded-frameworks'\]/);
  assert.match(data, /REGISTER_KEY = ONBOARDING_KEYS\.register/, 'shared with the Onboarding tab and the start gates');
  assert.match(data, /AGGREGATE_KEY = \['compliance-frameworks-aggregate'\]/);
  assert.match(data, /apiClient\.get\('\/certifications', \{ params: \{ skip: page \* PAGE, limit: PAGE \} \}\)/);
  assert.match(data, /apiClient\.get\('\/framework-upload\/upload', \{ params: \{ skip: page \* PAGE, limit: PAGE \} \}\)/);
  assert.match(data, /truncated: items\.length < total/, 'a cut library is said');
  assert.match(data, /onboardingApi\.register\(\)/);
  assert.match(data, /complianceApi\.dashboard\.getComplianceTrend\(days\)/);
  assert.match(data, /complianceApi\.dashboard\.getFrameworksAggregate\(\)/);
  assert.doesNotMatch(data, /refetchInterval/, 'the old Dashboard asked the aggregate again every minute');
  assert.equal((data.match(/retry: retryRead/g) ?? []).length, 5, 'every request asks again before it says it failed');
  assert.match(data, /enabled,\s*\n\s*staleTime: 60_000/, 'the trend and the activity are read only when the disclosure is open');
  assert.doesNotMatch(data, /\bcatch\b/, 'a failure is not caught into an empty answer');
});

test('a failed request is an error of its own part: never an empty list, never zeros, never a page that hides itself', () => {
  const hub = code(src('FrameworksHub.tsx'));
  const register = code(src('HubRegister.tsx'));
  assert.match(hub, /journeysFailed = journeysQ\.isError && !journeys/);
  assert.match(hub, /libraryFailed = libraryQ\.isError && !libraryQ\.data/);
  assert.match(hub, /failureOf\('journeys'/);
  assert.match(hub, /failureOf\('library'/);
  assert.match(hub, /Couldn't refresh the journeys/, 'a failed refresh keeps the rows and says they may be out of date');
  assert.match(hub, /The library could not be read/, 'the journeys still work without it');
  assert.match(hub, /Where each onboarding stands could not be read/, 'a framework without a journey is "Not known", never "No journey yet"');
  assert.match(register, /if \(failure\) return <ErrorState/);
  assert.match(register, /canRetry\(error\) \? retry : undefined/, 'Retry only where asking again can help');
  const tiles = code(src('PostureTiles.tsx'));
  assert.match(tiles, /if \(failed\) return null;/, 'a failed read draws no tiles: the list under them says it once, with Retry');
  const trend = code(src('TrendActivity.tsx'));
  assert.match(trend, /Couldn't load the trend/);
  assert.match(trend, /Couldn't load the recent activity/);
  assert.doesNotMatch(code(src('HubRows.tsx')), /\?\? 0\b/, 'a figure that was not recorded is a dash, never 0');
});

test('every figure of a journey is the model\'s: no screen file reads a raw progress key or works out a percentage', () => {
  for (const file of ['HubRows.tsx', 'PostureTiles.tsx', 'FrameworksHub.tsx', 'HubRegister.tsx', 'HubDrawer.tsx', 'TrendActivity.tsx']) {
    const c = code(src(file));
    assert.doesNotMatch(c, /readiness_percentage|completion_percentage|implemented_count|total_controls|not_applicable_count/, `${file}: no raw progress key`);
    if (file !== 'TrendActivity.tsx') assert.doesNotMatch(c, /Math\.round\([^)]*\/[^)]*\)\s*\*\s*100|\/\s*100\)\s*\*/, `${file}: no percentage worked out here`);   // the trend's own line is chart geometry, not a figure
  }
  const model = code(src('hubModel.ts'));
  for (const fn of ['journeyNumbers', 'portfolioNumbers', 'readinessBand', 'targetState', 'isActiveJourney']) assert.match(model, new RegExp(fn), fn);
  assert.match(model, /from '\.\.\/\.\.\/\.\.\/\.\.\/lib\/journeyModel\.ts'/);
  assert.doesNotMatch(code(src('hubData.ts')), /by_framework|avg_readiness_pct|avg_completion_pct|completion_pct|readiness_pct/, 'the aggregate\'s own per-journey figures are not read');
});

test('every mutation reports for itself and the two deletes ask first, in the kit\'s dialog', () => {
  const actions = code(src('useHubActions.tsx'));
  assert.doesNotMatch(actions, /\buseMutation\(/, 'the old pages used bare mutations: a failed start wrote to the console');
  assert.equal((actions.match(/useReportedMutation\(/g) ?? []).length, 5, 'start, onboard, delete journey, delete framework, enhance');
  assert.equal((actions.match(/confirm\(\{/g) ?? []).length, 2);
  assert.match(actions, /confirmLabel: 'Delete journey', tone: 'danger'/);
  assert.match(actions, /confirmLabel: 'Delete framework', tone: 'danger'/);
  assert.match(actions, /It can\\'t be undone/);
  for (const { file, text } of SOURCES) assert.doesNotMatch(code(text), /\buseMutation\(/, `${file}: no bare mutation`);
});

test('the onboarding gate is the server\'s: a start sends the same call as before, a 409 becomes the "Onboarding needed" notice with its button, nothing here moves an onboarding to approved', () => {
  const actions = code(src('useHubActions.tsx'));
  assert.match(actions, /certificationsApi\.create\(body\)/);
  assert.match(actions, /refusalFromProblem\(problemOf\(error\)\)/);
  assert.match(actions, /setRefusal\(\{ frameworkId: v\.frameworkId, name: v\.name, why \}\)/);
  assert.match(code(src('HubRegister.tsx')), /<OnboardingNeeded/);
  assert.match(code(src('HubDrawer.tsx')), /<OnboardingNeeded/);
  for (const { file, text } of SOURCES) assert.doesNotMatch(code(text), /onboardingApi\.(approve|reopen|underway|submit|saveAnswers)/, `${file}: the hub does not decide an onboarding`);
  assert.match(actions, /onboardingApi\.start\(frameworkId\)/, 'it may only make the draft and open it');
  assert.match(actions, /hasPermission\('compliance:framework_onboarding:edit'\) \|\| hasPermission\('compliance:frameworks:edit'\)/, 'the two rights the server asks to make an onboarding (EDIT_ONBOARDING)');
  assert.match(code(src('HubRows.tsx')), /disabled=\{!env\.actions\.canOnboard\}/, 'a button the server would refuse does not look usable');
});

test('deleting follows the right the Manage page asked, and the server\'s refusal of a shared framework is not offered as a button', () => {
  const actions = code(src('useHubActions.tsx'));
  assert.match(actions, /hasPermission\('frameworks:framework_library:delete'\)/);
  const rows = code(src('HubRows.tsx'));
  assert.match(rows, /a\.canDelete && !row\.shared/);
  assert.match(rows, /if \(a\.canDelete\) items\.push\(\{ key: 'delete-journey'/);
  assert.match(code(src('HubDrawer.tsx')), /hidden: !a\.canDelete \|\| row\.shared/);
  assert.match(actions, /apiClient\.delete\(`\/framework-upload\/upload\/\$\{id\}`\)/);
  assert.match(actions, /certificationsApi\.delete\(id\)/);
});

test('invented content is gone: no "(0%)", no emoji, no fixed lifecycle, no default artifact list, no "% confidence", and the controls count is the one the server sends', () => {
  for (const { file, text } of SOURCES) {
    const c = code(text);
    assert.doesNotMatch(c, /\(0%\)/, file);
    assert.doesNotMatch(c, EMOJI, `${file}: an emoji`);
    assert.doesNotMatch(c, /Certification Lifecycle|Stage 2 audit|upload · parse|upload - parse/i, file);
    assert.doesNotMatch(c, /confidence/i, `${file}: the classification confidence is not shown (Rule U1)`);
    assert.doesNotMatch(c, /\bcontrols_count\b/, `${file}: the server sends parsed_controls_count (the old cards printed "undefined controls")`);
  }
  assert.match(src('hubModel.ts'), /parsed_controls_count/);
});

test('dates are the viewer\'s own calendar through lib/format; the target date is sent as the day typed', () => {
  for (const { file, text } of SOURCES) {
    const c = code(text);
    assert.doesNotMatch(c, /toLocaleDateString|toLocaleString|toISOString/, `${file}: dates go through lib/format and todayDay()`);
  }
  assert.match(code(src('HubRows.tsx')), /formatDate\(t\.day, \{ calendar: true \}\)/, 'a date-only value keeps its calendar day');
  assert.match(code(src('useHubActions.tsx')), /if \(v\.targetDay\) body\.target_date = v\.targetDay;/);
  assert.match(code(src('HubDrawer.tsx')), /min=\{todayDay\(\)\}/);
});

test('no native dialog, no hover-only action, no text under 12px, no platform-remapped utility, no legacy governance scope', () => {
  for (const { file, text } of SOURCES) {
    const c = code(text);
    assert.doesNotMatch(c, /window\.(confirm|alert|prompt)\s*\(/, file);
    assert.doesNotMatch(c, /(^|[^\w.$])(alert|prompt)\s*\(/m, `${file}: a bare alert( or prompt(`);
    assert.doesNotMatch(c, /window\.location/, `${file}: a link is a link (router.push), not a page reload`);
  }
  for (const { file, text } of TSX) {
    const c = code(text);
    assert.doesNotMatch(c, /opacity-0[^'"`\n]*group-hover|group-hover[^'"`\n]*opacity-0/, `${file}: hover-only`);
    assert.doesNotMatch(c, /governance-light/, `${file}: the legacy scope`);
    const found = findViolations(text);
    assert.deepEqual(found, [], `${file}: ${found.map((v) => `${v.rule}@${v.line}`).join(', ')}`);
  }
});

test('no bare <p>, <td>, <th>, <h2>, <h3> or <h4>: each names its text size (the platform CSS gives a bare one 11.5px)', () => {
  const SIZE = /(?<![\w:-])!?text-(?:ds-(?:title|section|body|label)|\[\d)/;
  for (const { file, text } of TSX) {
    const c = code(text);
    const tag = /<(p|td|th|h2|h3|h4)(\s[^>]*?)?>/g;
    let m: RegExpExecArray | null;
    while ((m = tag.exec(c)) !== null) {
      const open = c.slice(m.index, m.index + 400).split('>')[0] + '>';
      const named = /className=\{H3\}/.test(open) && SIZE.test(/const H3 = '([^']*)'/.exec(c)?.[1] ?? '');            // a class held in one constant that names its size
      assert.ok(named || SIZE.test(open), `${file}:${c.slice(0, m.index).split('\n').length} <${m[1]}> has no text size: ${open.slice(0, 90)}`);
    }
  }
});

test('the hub draws the kit head with the registry\'s name, the strip, and keeps every address of the old pages alive', () => {
  const hub = src('FrameworksHub.tsx');
  assert.match(hub, /<PageHeader\s+variant="page"/);
  assert.match(hub, /titleFor\('\/frameworks'\) \?\? 'Frameworks'/);
  assert.match(hub, /<FrameworksStrip current=\{scope\} \/>/);
  const strip = code(src('FrameworksStrip.tsx'));
  assert.match(strip, /aria-current=\{open \? 'page' : undefined\}/);
  assert.match(strip, /<nav aria-label="Frameworks pages"/);
  const address = code(src('hubAddress.ts'));
  assert.match(address, /libraryOpenHref = \(frameworkId: number\): string => `\/frameworks\?tab=library&open=\$\{frameworkId\}`/);
  assert.match(address, /tab: oneOf\(TABS, 'journeys'\)/, 'the plain address is the Journeys register');
});

test('the explorer carries the keyboard layer and a phone layout: list and board, "/" search, j / k, Enter, a Filters sheet, cards under the table\'s room', () => {
  const register = code(src('HubRegister.tsx'));
  assert.match(register, /useExplorerKeys\(/);
  assert.match(register, /<BoardColumns/);
  assert.match(register, /<RecordTable/);
  assert.match(register, /card=\{\(row\) => <HubCard/);
  assert.match(register, /views=\{\{ label: 'View'/);
  assert.match(register, /<Pager/);
  assert.match(register, /dockFrom|HubDrawer/);
  assert.match(code(src('HubDrawer.tsx')), /dockFrom=\{Infinity\}/, 'a drawer over the list, never docked');
  assert.match(code(src('HubDrawer.tsx')), /restoreFocus=\{rowOf\(id\)\}/, 'focus returns to the row that opened it');
});
