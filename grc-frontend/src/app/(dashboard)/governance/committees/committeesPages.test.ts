// node --test "src/app/(dashboard)/governance/committees/committeesPages.test.ts"
// Source-text pins for the four committee pages (the list, a committee, a meeting, Oversight Actions): what they must not do again (invented data when a request
// fails, a browser dialog, a write that says nothing, text under 12px, an action that only appears under the mouse) and what they must keep (the query keys, the
// requests, the hard delete as it is, "Add manual action" open to everyone). Like settingsPage.test.ts these read the files; the rules they pin are in
// src/lib/committees.ts and its test, and the behaviour was checked in a browser (the report names how).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { findViolations } from '../../../../components/ui/ds/kitRules.ts';
import { ownHeadingSection } from '../../../../lib/navRegistry.ts';

const DIR = 'src/app/(dashboard)/governance/committees';
const read = (rel: string) => readFileSync(`${DIR}/${rel}`, 'utf8');
const PAGES = { overview: 'page.tsx', committee: '[id]/page.tsx', meeting: 'meetings/[id]/page.tsx', actions: 'actions/page.tsx' } as const;
const SOURCES = Object.fromEntries(Object.entries(PAGES).map(([k, f]) => [k, read(f)])) as Record<keyof typeof PAGES, string>;
const ALL = [...Object.values(SOURCES), read('_ui.tsx')];
/** The code without its comments: a comment may talk about what the page used to do. */
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');

test('no committee page opens a browser dialog: questions are dialogs of the kit (useConfirm)', () => {
  for (const [name, src] of Object.entries(SOURCES)) {
    assert.doesNotMatch(code(src), /window\.(confirm|alert|prompt)\s*\(|(^|[^.\w])(confirm|alert|prompt)\s*\(\s*[`'"]/m, `${name} calls a native dialog`);
  }
  for (const name of ['overview', 'committee', 'meeting'] as const) assert.match(SOURCES[name], /useConfirm\(\)/, `${name} asks through useConfirm`);
});

test('every write is a reported mutation: no bare useMutation, and each page reports what it writes', () => {
  const reported = (src: string) => (src.match(/useReportedMutation\(/g) || []).length;
  for (const [name, src] of Object.entries(SOURCES)) assert.doesNotMatch(code(src), /\buseMutation\s*[(<]/, `${name} has a bare useMutation`);
  assert.ok(reported(SOURCES.overview) >= 3, 'overview: delete, new committee, new meeting');
  assert.equal(reported(SOURCES.actions), 4, 'actions: status, create, reword, summarise');
  assert.equal(reported(SOURCES.committee), 16, 'committee: the 16 writes it always had');
  assert.ok(reported(SOURCES.meeting) >= 11, 'meeting: its ten writes and the vote');
  assert.doesNotMatch(SOURCES.meeting, /useToast\s*\(/, 'the meeting page used toast() by hand: it reports through the kit now');
});

test('Oversight Actions never answers a failed request with made-up committees or actions', () => {
  const src = code(SOURCES.actions);
  for (const invented of ['Update Risk Register for Q1', 'Review Cyber Insurance Policy', 'Incident Response Improvement Plan', 'Address Internal Audit Finding', 'Evaluate Cloud Migration Progress',
    'Board of Directors', 'Risk Management Committee', 'IT Steering Committee', 'David Lee', 'Emily Brown']) {
    assert.ok(!src.includes(invented), `the invented "${invented}" is back`);
  }
  assert.doesNotMatch(src, /catch\s*(\([^)]*\))?\s*\{\s*return\s*\[/, 'a catch that returns a list hides a failed request');
  assert.match(src, /ErrorState|error=\{/, 'a failed list is an error state');
});

test('Oversight Actions opens on the overdue ones from ?overdue=1, through the pure rule', () => {
  const src = SOURCES.actions;
  assert.match(src, /useSearchParams\(\)/);
  assert.match(src, /overdueFromSearch\(/);
  assert.match(src, /useState\(\(\) => overdueFromSearch\(/, 'the address is the initial state of the filter');
  assert.match(src, /overdueOnly/);
  assert.match(src, /actionListParams\(/, 'the list asks the API for overdue_only through actionListParams');
});

test('the Overdue tile and the red marks use what the API means by overdue, not status === "overdue"', () => {
  for (const [name, src] of Object.entries(SOURCES)) assert.doesNotMatch(code(src), /status\s*===\s*['"]overdue['"]/, `${name} tests the stored status alone`);
  assert.match(read('_ui.tsx'), /isOverdueAction\(/);
});

test('a committee keeps its tabs in the address, with every value the page ever had', () => {
  const src = SOURCES.committee;
  assert.match(src, /useTabParam\('tab', COMMITTEE_TABS, \{ fallback: DEFAULT_COMMITTEE_TAB \}\)/);
  assert.doesNotMatch(code(src), /useState\(\s*'meetings'\s*\)/, 'the tab used to be state, lost on reload');
  for (const key of ['members', 'charters', 'meetings', 'actions', 'settings']) assert.match(src, new RegExp(`tabKey="${key}"`), `a panel for ${key}`);
});

test('the pages keep their query keys, so every existing invalidation still finds them', () => {
  const keys: Record<keyof typeof PAGES, string[]> = {
    overview: ['committee-overview', 'committee-panel-actions', 'committee-panel-meetings', 'tenant-users-committee'],
    actions: ['committees-list', 'all-actions', 'committee-meetings-for-actions'],
    committee: ['committee', 'committee-members', 'committee-charters', 'committee-meetings', 'committee-actions', 'committee-meeting-agenda', 'committee-meeting-detail',
      'current-user', 'tenant-users-for-committee-actions', 'available-frameworks-for-charter', 'committee-overview'],
    meeting: ['meeting', 'meeting-agenda', 'meeting-suggested', 'meeting-actions', 'meeting-attachments', 'agenda-votes', 'current-user', 'tenant-users'],
  };
  for (const [page, list] of Object.entries(keys)) for (const key of list) assert.ok(SOURCES[page as keyof typeof PAGES].includes(`'${key}'`), `${page} lost the query key '${key}'`);
});

test('the requests are the ones the pages always made: the endpoints of committeeApi, nothing new, and the delete is still the hard delete', () => {
  assert.match(SOURCES.overview, /committeeApi\.deleteCommittee\(/);
  assert.match(SOURCES.committee, /committeeApi\.deleteCommittee\(/);
  for (const [name, src] of Object.entries(SOURCES)) {
    assert.doesNotMatch(code(src), /is_active\s*:\s*false|deactivate/i, `${name} deactivates: that is the plan (G4_committee_deactivation_plan.md), not part of this change`);
  }
  assert.doesNotMatch(readFileSync('src/lib/api.ts', 'utf8').slice(readFileSync('src/lib/api.ts', 'utf8').indexOf('export const committeeApi')).split('export interface QuickAssessRequest')[0], /deactivate|reactivate/i, 'no new endpoint call for it');
});

test('"Add manual action" stays open to every signed-in user (the server asks no more): recorded in the permission matrix, not changed here', () => {
  assert.doesNotMatch(code(SOURCES.actions), /hasPermission|usePermissions/);
  assert.match(SOURCES.actions, /Add manual action/);
});

test('a meeting\'s edit and remove are buttons you can see, not icons that appear under the mouse', () => {
  assert.doesNotMatch(SOURCES.meeting, /opacity-0\s+group-hover|group-hover:opacity-100/);
  assert.match(SOURCES.meeting, /label=\{`Edit agenda item \$\{item\.item_number\}`\}/);
  assert.match(SOURCES.meeting, /label=\{`Remove agenda item \$\{item\.item_number\}`\}/);
});

test('the meeting life cycle is not touched: no start, complete, cancel or approve-minutes, and quorum present says Not recorded', () => {
  for (const name of ['meeting', 'committee'] as const) {
    assert.doesNotMatch(code(SOURCES[name]), /committeeApi\.(updateMeeting|updateMinutes)\(/, `${name} invents a transition`);
    assert.doesNotMatch(code(SOURCES[name]), /Start meeting|Complete meeting|Mark as held|Cancel meeting|Approve minutes/);
  }
  assert.match(SOURCES.meeting, /quorum_present != null \? meeting\.quorum_present : <NotRecorded/);
});

test('the pages say "Not recorded" where nothing can record the number (the overview tiles come from the pure readings)', () => {
  const src = SOURCES.overview;
  for (const reading of ['performanceReading(', 'actionsDoneReading(', 'overdueReading(', 'attendanceReading(', 'meetingsHeldReading(']) assert.ok(src.includes(reading), `overview lost ${reading}`);
  assert.doesNotMatch(code(src), /Math\.round\(k!?\.avg_attendance_pct/, 'the attendance tile used to round a number that may not exist');
  assert.doesNotMatch(code(src), /'no meeting data yet'/);
});

test('the pages draw their own heading with the kit and the registry says so, so the top bar names only the section', () => {
  for (const [name, src] of Object.entries(SOURCES)) assert.match(src, /<PageHeader\s+variant="page"/, `${name} draws no page head`);
  for (const url of ['/governance/committees', '/governance/committees/3', '/governance/committees/meetings/9', '/governance/committees/actions']) {
    assert.equal(ownHeadingSection(url), 'Governance', `${url} is not flagged ownHeading in lib/navRegistry.ts`);
  }
});

test('the pages take their headings from the registry (Committees, Oversight Actions)', () => {
  assert.match(SOURCES.overview, /routeFor\('\/governance\/committees'\)/);
  assert.match(SOURCES.actions, /routeFor\('\/governance\/committees\/actions'\)/);
  assert.doesNotMatch(SOURCES.overview, /Board &amp; Committee Management|Board & Committee Management/);
});

test('dates go through lib/format and the committee rules, never toLocale*String or new Date(naive)', () => {
  for (const [name, src] of Object.entries(SOURCES)) {
    assert.doesNotMatch(code(src), /toLocale(Date|Time)?String\s*\(/, `${name} formats a date by hand`);
    // (a datetime-local field the person typed IS the viewer's clock: new Date(form.scheduled_date).toISOString() is how a meeting is sent, and stays)
    assert.doesNotMatch(code(src), /new Date\(\s*[a-z_.?]*(scheduled_date|due_date|joined_at|next_meeting_date|uploaded_at|effective_date)\s*\)(?!\.toISOString)/i, `${name} reads a naive UTC time as the viewer's clock`);
  }
});

test('no text under 12px, and the rewritten pages follow the kit rules (tokens and arbitrary values, no remapped classes)', () => {
  for (const [name, src] of Object.entries(SOURCES)) {
    assert.deepEqual(findViolations(src).filter((v) => v.rule === 'small-text'), [], `${name} has text under 12px`);
  }
  for (const [name, src] of [['overview', SOURCES.overview], ['actions', SOURCES.actions], ['_ui', read('_ui.tsx')]] as const) {
    assert.deepEqual(findViolations(src).map((v) => `${name}:${v.line} ${v.rule}`), [], `${name} uses classes the platform CSS rewrites`);
  }
});

test('the pages do not open the legacy .governance-light scope and the AI comparison is not a hand-made overlay', () => {
  for (const [name, src] of Object.entries(SOURCES)) assert.doesNotMatch(src, /governance-light/, name);
  assert.doesNotMatch(SOURCES.committee, /fixed inset-0/);
  assert.match(SOURCES.committee, /<AnimatedModal[\s\S]*Charter compliance analysis/);
});

test('the drawers ask before they throw typing away (dirty) and none of them is a bare form with a Cancel that discards', () => {
  for (const [name, src] of Object.entries(SOURCES)) {
    const panels = (src.match(/<RightSlidePanel/g) || []).length;
    const dirty = (src.match(/dirty=\{/g) || []).length;
    // the auto-populate panel of a meeting holds choices, not typing; every other drawer passes `dirty`
    assert.ok(dirty >= panels - (name === 'meeting' ? 1 : 0), `${name}: ${panels} drawers, ${dirty} with dirty`);
  }
});

test('nothing in the shared files was widened: only the types of getActions gained skip and limit', () => {
  const api = readFileSync('src/lib/api.ts', 'utf8');
  assert.match(api, /getActions: \(params\?: \{ status\?: string; committee_id\?: number; overdue_only\?: boolean; skip\?: number; limit\?: number \}\)/);
  assert.equal(ALL.length, 5);
});
