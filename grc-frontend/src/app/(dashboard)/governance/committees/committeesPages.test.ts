// node --test "src/app/(dashboard)/governance/committees/committeesPages.test.ts"
// Source-text pins for the Committees screens (timeline first): the home (three lanes, a committee as a filter, the management sheet), the forward of the old committee address, the
// meeting workspace and Oversight Actions, with the components they are made of (src/components/committees). What they must not do again (invented data when a request fails, a
// browser dialog, a write that says nothing, text under 12px, an action that only appears under the mouse), what they must keep (the query keys, the requests, "Add manual action" open
// to everyone, every old address) and what they now do (a meeting is run through the server's own start, end, roll call and outcome calls, never a status written by hand).
// Like settingsPage.test.ts these read the files; the rules they pin are in src/lib/committees.ts, committeeHome.ts and meetingRun.ts and their tests, and the behaviour was checked
// in a browser (the report names how).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

import { findViolations } from '../../../../components/ui/ds/kitRules.ts';
import { ownHeadingSection } from '../../../../lib/navRegistry.ts';

const DIR = 'src/app/(dashboard)/governance/committees';
const COMP = 'src/components/committees';
const page = (rel: string) => readFileSync(`${DIR}/${rel}`, 'utf8');
const comp = (name: string) => readFileSync(`${COMP}/${name}`, 'utf8');
const PAGES = { home: 'page.tsx', forward: '[id]/page.tsx', meeting: 'meetings/[id]/page.tsx', actions: 'actions/page.tsx' } as const;
const SOURCES = Object.fromEntries(Object.entries(PAGES).map(([k, f]) => [k, page(f)])) as Record<keyof typeof PAGES, string>;
const COMPONENTS = readdirSync(COMP).filter((f) => /\.tsx?$/.test(f));
const COMPONENT_SOURCES = Object.fromEntries(COMPONENTS.map((f) => [f, comp(f)])) as Record<string, string>;
const EVERY = { ...Object.fromEntries(Object.entries(SOURCES).map(([k, v]) => [`page:${k}`, v])), ...COMPONENT_SOURCES } as Record<string, string>;
/** The code without its comments: a comment may talk about what the page used to do. */
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
const all = (name: string, re: RegExp) => Object.entries(EVERY).some(([, src]) => re.test(src) && name.length > 0);

test('no committee screen opens a browser dialog: questions are dialogs of the kit (useConfirm)', () => {
  for (const [name, src] of Object.entries(EVERY)) {
    assert.doesNotMatch(code(src), /window\.(confirm|alert|prompt)\s*\(|(^|[^.\w])(confirm|alert|prompt)\s*\(\s*[`'"]/m, `${name} calls a native dialog`);
  }
  for (const name of ['page:home', 'page:meeting']) assert.match(EVERY[name], /useConfirm\(\)/, `${name} asks through useConfirm`);
  for (const name of ['MembersPanel.tsx', 'ChartersPanel.tsx', 'AgendaSection.tsx', 'MeetingExtras.tsx']) assert.match(EVERY[name], /useConfirm\(\)/, `${name} asks through useConfirm`);
  assert.match(EVERY['RunMeeting.tsx'], /confirm\(\{ title: plan\.title/, 'start and end are asked first, with what is complete and what is not');
});

test('every write is a reported mutation: no bare useMutation, and each file reports exactly the writes it makes', () => {
  const reported = (src: string) => (src.match(/useReportedMutation\(/g) || []).length;
  for (const [name, src] of Object.entries(EVERY)) assert.doesNotMatch(code(src), /\buseMutation\s*[(<]/, `${name} has a bare useMutation`);
  // the writes, file by file: the 15 of the old committee page, the ten of the old meeting page and the vote, the four of the old actions page, and the new ones
  const expected: Record<string, number> = {
    'ChartersPanel.tsx': 7,          // attach a file, upload a charter, AI draft, AI compare, save the draft, edit, delete
    'MembersPanel.tsx': 2,           // add, remove
    'forms.tsx': 3,                  // new committee, new meeting, edit committee
    'ui.tsx': 2,                     // Deactivate and Reactivate: the one hook both screens use
    'ActionsLane.tsx': 1,            // the done tick
    'RunMeeting.tsx': 2,             // start, end
    'RollCall.tsx': 1,               // the roll
    'VoteStrip.tsx': 1,              // a vote
    'AgendaForms.tsx': 4,            // add an item, edit one, record an outcome, auto-populate
    'AgendaSection.tsx': 2,          // AI parse, remove an item
    'MeetingExtras.tsx': 6,          // minutes (save, upload), an action, a paper (upload, remove)... and its download is a toast on failure
    'ManualActionPanel.tsx': 3,      // create, AI reword, AI summary
  };
  expected['MeetingExtras.tsx'] = 5;       // minutes save, minutes upload, create action, upload paper, remove paper
  for (const [file, n] of Object.entries(expected)) assert.equal(reported(COMPONENT_SOURCES[file]), n, `${file}: the writes it reports`);
  assert.equal(reported(SOURCES.actions), 2, 'actions: the status, the priority');
  assert.equal(reported(SOURCES.home), 0, 'the home writes through the components (the hook, the drawers), never itself');
  assert.equal(reported(SOURCES.meeting), 0, 'the meeting page writes through its sections');
});

test('Oversight Actions and the lanes never answer a failed request with made-up committees or actions', () => {
  for (const name of ['page:actions', 'ActionsLane.tsx', 'MeetingsLane.tsx', 'DecisionsLane.tsx', 'page:home']) {
    const src = code(EVERY[name]);
    for (const invented of ['Update Risk Register for Q1', 'Review Cyber Insurance Policy', 'Incident Response Improvement Plan', 'Address Internal Audit Finding', 'Evaluate Cloud Migration Progress',
      'Board of Directors', 'Risk Management Committee', 'IT Steering Committee', 'David Lee', 'Emily Brown']) {
      assert.ok(!src.includes(invented), `${name}: the invented "${invented}" is back`);
    }
    assert.doesNotMatch(src, /catch\s*(\([^)]*\))?\s*\{\s*return\s*\[/, `${name}: a catch that returns a list hides a failed request`);
  }
  for (const name of ['page:actions', 'ActionsLane.tsx', 'MeetingsLane.tsx', 'DecisionsLane.tsx']) assert.match(EVERY[name], /ErrorState|error=\{/, `${name}: a failed list is an error state with Retry`);
});

test('Oversight Actions opens on the overdue ones from ?overdue=1, through the pure rules, and keeps every filter in the address', () => {
  const src = SOURCES.actions;
  assert.match(src, /useAddressState\(ACTIONS_SCHEMA\)/);
  assert.match(src, /viewOf\(address\)/, 'the old ?overdue=1 is the Overdue view');
  assert.match(src, /viewQuery\(view, filters/, 'the list asks the API through the one rule that the lane shares');
  assert.match(src, /committeeApi\.getActions\(\{ \.\.\.q, limit: 1 \}\)/, 'the totals of the views are the server\'s: one count request each');
});

test('Overdue is what the API means by it (is_overdue), not status === "overdue"', () => {
  for (const [name, src] of Object.entries(EVERY)) assert.doesNotMatch(code(src), /status\s*===\s*['"]overdue['"]/, `${name} tests the stored status alone`);
  assert.match(SOURCES.actions, /isOverdueAction\(a\)/);
  assert.match(comp('ui.tsx'), /isOverdueAction\(/);
  assert.match(comp('LaneParts.tsx'), /overdue: a\.is_overdue/, 'the lane row takes the server\'s flag');
});

test('the old committee address still works: it forwards to the filtered home (the sheet\'s tab for members, charters and settings) and draws a page head while it does', () => {
  const src = SOURCES.forward;
  assert.match(src, /legacyCommitteeAddress\(id, tab\)/);
  assert.match(src, /router\.replace\(/);
  assert.match(src, /<PageHeader\s+variant="page"/, 'the registry flags the page as drawing the kit head');
  assert.match(code(src), /useSearchParams\(\)\?\.get\('tab'\)/, 'the old ?tab= is read');
  assert.doesNotMatch(code(src), /useQuery|committeeApi/, 'the forward asks the server for nothing');
});

test('the pages keep their query keys, so every existing invalidation still finds them', () => {
  const keys = ['committee-overview', 'committee', 'committee-members', 'committee-charters', 'committee-meetings', 'committees-list', 'all-actions', 'committee-meetings-for-actions',
    'available-frameworks-for-charter', 'meeting', 'meeting-agenda', 'meeting-suggested', 'meeting-actions', 'meeting-attachments', 'agenda-votes', 'tenant-users-committee'];
  for (const key of keys) assert.ok(all(key, new RegExp(`'${key}'`)), `a query key '${key}' is gone`);
  // the new keys the lanes own, and that every write that moves a lane refreshes
  for (const key of ['committee-lane-actions', 'committee-decisions', 'meeting-roll', 'action-counts']) assert.ok(all(key, new RegExp(`'${key}'`)), `the key '${key}' is not used`);
  assert.match(comp('RunMeeting.tsx'), /\['committee-meetings'\], \['committee-overview'\]/, 'a started or ended meeting refreshes the lanes and the overview');
  assert.match(comp('ActionsLane.tsx'), /\['committee-lane-actions'\], \['committee-overview'\], \['all-actions'\]/, 'the done tick refreshes the lane, the overview and the register');
});

test('no screen deletes a committee: the home deactivates and reactivates it, through one hook (the API DELETE stays for API clients)', () => {
  for (const [name, src] of Object.entries(EVERY)) assert.doesNotMatch(code(src), /deleteCommittee\b/, `${name} calls deleteCommittee or its plan: the hard delete is not a screen's`);
  const ui = code(comp('ui.tsx'));
  assert.match(ui, /committeeApi\.deactivateCommittee\(/);
  assert.match(ui, /committeeApi\.reactivateCommittee\(/);
  assert.match(SOURCES.home, /useCommitteeActivation\(/, 'the home deactivates through the shared hook');
  // the question is asked first, with the counts, and only a yes calls the server; Reactivate takes nothing away, so it asks nothing
  assert.match(ui, /deactivateCommitteePlan\(/);
  assert.match(ui, /if \(await confirm\(\{[^}]*\}\)\) deactivation\.mutate\(c\)/);
  assert.doesNotMatch(ui, /confirm\([^)]*\)[^;]*reactivation\.mutate/, 'Reactivate asks no question');
  const api = readFileSync('src/lib/api.ts', 'utf8');
  const committeeApi = api.slice(api.indexOf('export const committeeApi')).split('export interface QuickAssessRequest')[0];
  assert.match(committeeApi, /deactivateCommittee: \(id: number\) => apiClient\.post\(`\/governance\/committees\/\$\{id\}\/deactivate`\)/);
  assert.match(committeeApi, /reactivateCommittee: \(id: number\) => apiClient\.post\(`\/governance\/committees\/\$\{id\}\/reactivate`\)/);
  assert.match(committeeApi, /deleteCommittee: \(id: number\) => apiClient\.delete\(`\/governance\/committees\/\$\{id\}`\)/);
});

test('Deactivate and Reactivate are offered to the delete right only (the server asks for the same key) and an inactive committee is not offered new things', () => {
  assert.match(SOURCES.home, /hasPermission\('governance:committees:delete'\)/);
  assert.match(SOURCES.home, /canSwitch=\{canDelete\}/, 'the strip offers it to the delete right');
  const sheet = comp('CommitteeSheet.tsx');
  assert.match(sheet, /hidden: !canDelete/, 'the sheet\'s menu hides it from anyone without the right');
  assert.match(sheet, /Deactivate<\/Button>/);
  assert.match(sheet, /Reactivate<\/Button>/);
  assert.doesNotMatch(sheet, /dangerOutline[^\n]*>Delete<\/Button>/, 'there is no Delete button');
  assert.match(sheet, /\{!active && <p role="note"[^>]*>\{inactiveNote\(canDelete\)\}<\/p>\}/, 'one line says what Inactive means, and the way back only to whoever can take it');
  // no way to add a member to it, and a new meeting or action is not offered it
  assert.match(sheet, /canAdd=\{canCreate && active\}/);
  assert.match(SOURCES.home, /activeCommittees\(rows\)\.map/, 'the New meeting picker is built from the active committees');
  assert.match(SOURCES.home, /defaultCommitteeId=\{selected && isActiveCommittee\(selected\) \? selected\.id : null\}/, 'a chosen inactive committee is not pre-chosen for a meeting');
  assert.match(SOURCES.meeting, /takesActions/);
  assert.match(comp('MeetingExtras.tsx'), /Committee inactive/, 'a meeting of an inactive committee does not offer to create an action');
  assert.match(comp('ManualActionPanel.tsx'), /activeCommittees\(committees\)/);
});

test('the home opens on Active, keeps its status filter, its committee, its sheet and its search in the address, and the chips are the committees the filter shows', () => {
  const src = SOURCES.home;
  assert.match(src, /useAddressState\(HOME_SCHEMA\)/);
  assert.match(src, /committeeChips\(rows, \{ selectedId: selected\?\.id \?\? null, status: address\.status \}\)/);
  assert.match(src, /<ChipsRow/);
  assert.match(comp('CommitteeSheet.tsx'), /<SegmentedControl<CommitteeStatusFilter>\s+label="Show committees"/);
  assert.match(src, /setAddress\(\{ manage: tab \}\)|onTab=\{\(tab\) => setAddress\(\{ manage: tab \}\)\}/, 'the sheet\'s tab is in the address');
  // the pulse counts the server's kpis, not the filtered rows
  assert.match(src, /pulseOf\(overview\)/);
});

test('the three lanes read the server: each action group has its own request and true total, the decisions their own feed, the meetings each committee\'s list', () => {
  const lane = comp('ActionsLane.tsx');
  assert.match(lane, /groupQuery\('overdue'|readGroup\('overdue'/);
  for (const group of ['overdue', 'week', 'later']) assert.ok(lane.includes(`'${group}'`), `the ${group} group`);
  assert.match(lane, /laterTotal\(/, 'later is every open action less the other two');
  assert.match(lane, /enabled: !searching && overdueQ\.isSuccess && weekQ\.isSuccess/, 'later waits for the totals of the groups it skips');
  assert.match(comp('DecisionsLane.tsx'), /committeeApi\.listDecisions\(/);
  assert.match(comp('DecisionsLane.tsx'), /data\.total/, 'the count is the server\'s total');
  assert.match(comp('MeetingsLane.tsx'), /committeeApi\.getMeetings\(id, \{ limit: PER_COMMITTEE \}\)/);
  assert.match(comp('MeetingsLane.tsx'), /groupMeetings\(matched\)/);
  // a lane shows a part and says so: the way to the whole list
  assert.match(lane, /actionsListAddress\(scope/);
});

test('the new write controls are offered to the right to create committee records; voting stays open to everyone signed in, as it always was', () => {
  assert.match(SOURCES.home, /canTick=\{canCreate\}/);
  assert.match(SOURCES.home, /canSchedule=\{canCreate && !nothingToSchedule\}/);
  assert.match(SOURCES.meeting, /const canRun = canCreate;/);
  assert.doesNotMatch(code(comp('VoteStrip.tsx')), /hasPermission|usePermissions/, 'a vote is each person\'s own, and the server asks for no membership');
  assert.match(SOURCES.actions, /const canEdit = hasPermission\('governance:committees:create'\)/, 'the priority in place went with the committee\'s Actions tab, to the same people');
});

test('"Add manual action" stays open to every signed-in user (the server asks no more): recorded in the permission matrix, not changed here', () => {
  const src = code(SOURCES.actions);
  assert.match(SOURCES.actions, /Add manual action/);
  assert.match(src, /const add = <Button variant="primary" leftIcon=\{<Plus aria-hidden \/>\} onClick=\{\(\) => setAdding\(true\)\}>Add manual action<\/Button>;/);
  assert.doesNotMatch(src, /canEdit && add|\{canEdit && <Button[^>]*>Add manual action/, 'the button is not behind a right');
  assert.match(SOURCES.actions, /actions=\{add\}/);
});

test('Oversight Actions still finds the actions of a deactivated committee: its filter lists it marked "(inactive)", the form that adds an action does not', () => {
  const src = SOURCES.actions;
  assert.match(src, /committeeApi\.getCommittees\(\{ is_active: 'all' \}\)/);
  assert.match(src, /\{committeeChoiceLabel\(c\)\}<\/option>/);
  assert.ok(src.includes("queryKey: ['committees-list']"), 'the query key is the same');
});

test('an agenda item\'s edit and remove, a vote and a roll call are buttons you can see, not controls that appear under the mouse', () => {
  for (const [name, src] of Object.entries(EVERY)) assert.doesNotMatch(src, /opacity-0\s+group-hover|group-hover:opacity-100/, name);
  const agenda = comp('AgendaSection.tsx');
  assert.match(agenda, /label=\{`Edit agenda item \$\{it\.item_number\}`\}/);
  assert.match(agenda, /label=\{`Remove agenda item \$\{it\.item_number\}`\}/);
  assert.match(comp('RollCall.tsx'), /aria-pressed=\{m\.status === word\}/);
});

test('a meeting is run through the server\'s own calls (start, end, roll call, outcome) and no screen writes a meeting\'s status or an item\'s outcome by hand', () => {
  for (const [name, src] of Object.entries(EVERY)) {
    assert.doesNotMatch(code(src), /committeeApi\.(updateMeeting|updateMinutes)\(/, `${name} writes a status by hand`);
    assert.doesNotMatch(code(src), /Cancel meeting|Mark as held|Approve minutes/, `${name} invents a transition that was not approved`);
  }
  assert.match(comp('RunMeeting.tsx'), /committeeApi\.startMeeting\(meeting\.id\)/);
  assert.match(comp('RunMeeting.tsx'), /committeeApi\.endMeeting\(meeting\.id\)/);
  assert.match(comp('RollCall.tsx'), /committeeApi\.saveAttendance\(meetingId, members\)/);
  assert.match(comp('AgendaForms.tsx'), /committeeApi\.recordAgendaOutcome\(/);
  // the end question says what is complete first, and a refusal is said in the server's words (the reported mutation does that)
  assert.match(comp('RunMeeting.tsx'), /endPlan\(\{ meeting, roll: roll \?\? null, openItems: undecidedItems\(agenda\)/);
  assert.match(SOURCES.meeting, /barKind\(meeting, canRun\)/);
  assert.match(SOURCES.meeting, /useSectionSpy\(order\)/);
  assert.match(SOURCES.meeting, /<Outline layout="pills"/);
  assert.match(SOURCES.meeting, /<Outline layout="column"/);
});

test('the screens say "Not recorded" where nothing can record the number (the pulse and the strip come from the pure readings), and the performance dialog keeps its readings', () => {
  assert.match(SOURCES.home, /pulseOf\(overview\)/);
  assert.match(comp('HomeHead.tsx'), /stripCells\(health/);
  const perf = comp('PerformanceDialog.tsx');
  for (const reading of ['performanceReading(', 'meetingsHeldReading(', 'measureReason(', 'measureHasData(']) assert.ok(perf.includes(reading), `the performance dialog lost ${reading}`);
  for (const [name, src] of Object.entries(EVERY)) {
    assert.doesNotMatch(code(src), /Math\.round\(k!?\.avg_attendance_pct/, `${name} rounds a number that may not exist`);
    assert.doesNotMatch(code(src), /'no meeting data yet'/);
  }
});

test('the pages draw their own heading with the kit and the registry says so, so the top bar names only the section', () => {
  for (const [name, src] of Object.entries(SOURCES)) assert.match(src, /<PageHeader\s+variant="page"/, `${name} draws no page head`);
  for (const url of ['/governance/committees', '/governance/committees/3', '/governance/committees/meetings/9', '/governance/committees/actions']) {
    assert.equal(ownHeadingSection(url), 'Governance', `${url} is not flagged ownHeading in lib/navRegistry.ts`);
  }
});

test('the pages take their headings from the registry (Committees, Oversight Actions)', () => {
  assert.match(SOURCES.home, /routeFor\('\/governance\/committees'\)/);
  assert.match(SOURCES.actions, /routeFor\('\/governance\/committees\/actions'\)/);
  assert.doesNotMatch(SOURCES.home, /Board &amp; Committee Management|Board & Committee Management/);
});

test('dates go through lib/format and the committee rules, never toLocale*String or new Date(naive)', () => {
  for (const [name, src] of Object.entries(EVERY)) {
    assert.doesNotMatch(code(src), /toLocale(Date|Time)?String\s*\(/, `${name} formats a date by hand`);
    // (a datetime-local field the person typed IS the viewer's clock: new Date(form.scheduled_date).toISOString() is how a meeting is sent, and stays)
    assert.doesNotMatch(code(src), /new Date\(\s*[a-z_.?]*(scheduled_date|due_date|joined_at|next_meeting_date|uploaded_at|effective_date)\s*\)(?!\.toISOString)/i, `${name} reads a naive UTC time as the viewer's clock`);
  }
});

// the lifted charters flow and the performance dialog keep the legacy classes of their dialogs (the AI comparison is a portal dialog): they hold the 12px floor, not every kit rule
const LEGACY = new Set(['ChartersPanel.tsx', 'PerformanceDialog.tsx']);

test('no text under 12px anywhere, and every screen written for this pass follows the kit rules (tokens and arbitrary values, no remapped classes)', () => {
  for (const [name, src] of Object.entries(EVERY)) {
    assert.deepEqual(findViolations(src).filter((v) => v.rule === 'small-text'), [], `${name} has text under 12px`);
  }
  for (const [name, src] of Object.entries(EVERY)) {
    const file = name.replace(/^page:/, '');
    if (LEGACY.has(file) || name === 'page:forward') continue;
    assert.deepEqual(findViolations(src).map((v) => `${name}:${v.line} ${v.rule}`), [], `${name} uses classes the platform CSS rewrites`);
  }
});

test('the screens do not open the legacy .governance-light scope and the AI comparison is not a hand-made overlay', () => {
  for (const [name, src] of Object.entries(EVERY)) assert.doesNotMatch(src, /governance-light/, name);
  assert.doesNotMatch(comp('ChartersPanel.tsx'), /fixed inset-0/);
  assert.match(comp('ChartersPanel.tsx'), /<AnimatedModal[\s\S]*Charter compliance analysis/);
});

test('the drawers ask before they throw typing away (dirty); only a drawer that holds choices, not typing, may go without', () => {
  const choicesOnly: Record<string, number> = { 'AgendaForms.tsx': 1 };          // auto-populate: three ticks
  for (const [name, src] of Object.entries(EVERY)) {
    const panels = (src.match(/<RightSlidePanel/g) || []).length;
    const dirty = (src.match(/dirty=\{/g) || []).length;
    assert.ok(dirty >= panels - (choicesOnly[name] ?? 0), `${name}: ${panels} drawers, ${dirty} with dirty`);
  }
  assert.match(comp('AgendaForms.tsx'), /<DiscardBar onKeep=\{\(\) => setAsking\(false\)\} onDiscard=\{onClose\}/, 'the inline agenda form asks "Discard changes?" too');
});

test('the shared API file only gained optional things: getActions skip, limit and the optional assigned_to / due_after / due_before, an optional is_active on getCommittees, optional filters on getMeetings, and the new calls', () => {
  const api = readFileSync('src/lib/api.ts', 'utf8');
  assert.match(api, /getActions: \(params\?: \{ status\?: string; committee_id\?: number; overdue_only\?: boolean; assigned_to\?: number \| 'me'; due_after\?: string; due_before\?: string; skip\?: number; limit\?: number \}\)/);
  assert.match(api, /getCommittees: \(params\?: \{ is_active\?: 'true' \| 'false' \| 'all' \}\) => apiClient\.get\('\/governance\/committees', \{ params \}\)/);
  assert.match(api, /getMeetings: \(committeeId: number, params\?: \{ status\?: string; from_date\?: string; limit\?: number \}\) =>/);
});
