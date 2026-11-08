// node --test "src/app/(dashboard)/tasks/tasksPages.test.ts"
// Source-text pins for the Task Management pages (tasks/ and my-work/), the way the Governance groups pin theirs: the pages stay on the kit (no native dialogs, no hover-only actions, no text
// under 12px, no platform-remapped utilities, no bare <p>/<td>/<th>/<h2>/<h3>, every write through useReportedMutation) AND the behaviour the rebuild preserves is held in place (the rights the
// pages check, the requests they make, the query keys they invalidate, the URL contract). A pin that must change says in its title what contract it now holds.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { findViolations } from '../../../components/ui/ds/kitRules.ts';

const ROOT = 'src/app/(dashboard)';
const FOLDERS = [`${ROOT}/tasks`, `${ROOT}/my-work`];

function sourcesOf(dir: string): Array<{ file: string; text: string }> {
  return (readdirSync(dir, { recursive: true }) as string[])
    .map((f) => f.replace(/\\/g, '/'))
    .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f))
    .map((f) => ({ file: `${dir}/${f}`, text: readFileSync(join(dir, f), 'utf8') }));
}
const ALL = FOLDERS.flatMap(sourcesOf);
const TSX = ALL.filter((s) => s.file.endsWith('.tsx'));
const read = (file: string) => readFileSync(`${ROOT}/${file}`, 'utf8');
const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/\s.*$/gm, '$1');

test('the folders are what the pins read: the Task Management pages and My Work', () => {
  assert.ok(TSX.length >= 20, `${TSX.length} component files`);
  for (const f of ['tasks/page.tsx', 'tasks/[id]/page.tsx', 'tasks/reports/page.tsx', 'tasks/my-tasks/page.tsx', 'tasks/sla/page.tsx', 'my-work/page.tsx']) assert.ok(ALL.some((s) => s.file === `${ROOT}/${f}`), f);
});

test('no native dialog: confirm, alert and prompt are the kit\'s (useConfirm, useNotify), never the browser\'s', () => {
  for (const { file, text } of ALL) {
    const src = code(text);
    assert.doesNotMatch(src, /window\.(confirm|alert|prompt)\s*\(/, file);
    assert.doesNotMatch(src, /(^|[^\w.$])(alert|prompt)\s*\(/m, `${file}: a bare alert( or prompt(`);
    if (/(^|[^\w.$])confirm\s*\(/m.test(src)) assert.match(src, /useConfirm/, `${file} calls confirm( without useConfirm: it would be the browser's`);
  }
});

test('no action that appears only on hover, no text under 12px, no platform-remapped utility, no legacy governance scope in a kit page', () => {
  for (const { file, text } of TSX) {
    const src = code(text);
    assert.doesNotMatch(src, /opacity-0[^'"`\n]*group-hover|group-hover[^'"`\n]*opacity-0/, `${file}: hover-only`);
    assert.doesNotMatch(src, /\.governance-light|governance-light/, `${file}: the legacy scope`);
    const found = findViolations(text);
    assert.deepEqual(found, [], `${file}: ${found.map((v) => `${v.rule}@${v.line}`).join(', ')}`);
  }
});

/** every <p>, <td>, <th>, <h2> and <h3> must name a text size (the platform CSS gives a bare one 11.5px and dark text) */
test('no bare <p>, <td>, <th>, <h2> or <h3>: each names its text size', () => {
  const SIZE = /(?<![\w:-])!?text-(?:ds-(?:title|section|body|label)|\[\d)/;
  for (const { file, text } of TSX) {
    const src = code(text);
    const tag = /<(p|td|th|h2|h3)(\s[^>]*?)?>/g;
    let m: RegExpExecArray | null;
    while ((m = tag.exec(src)) !== null) {
      // an element inside a box that is only read out (`sr-only`) is never drawn; a size from a constant is followed by eye, so the pin asks for it inline
      const open = src.slice(m.index, m.index + 400).split('>')[0] + '>';
      const line = src.slice(0, m.index).split('\n').length;
      assert.match(open, SIZE, `${file}:${line} <${m[1]}> has no text size: ${open.slice(0, 90)}`);
    }
  }
});

test('every write goes through useReportedMutation: no bare useMutation in these pages (a failure is said, a success is said after the server answered)', () => {
  const writers = ALL.filter((s) => /criticalTasksApi\.(update|create|delete|bulkAction|transition|addComment|createSubTask|updateSubTask|deleteSubTask|requestApproval|approveTask|rejectTask|ai[A-Za-z]+)\s*\(/.test(code(s.text)));
  assert.ok(writers.length >= 8, `${writers.length} files write`);
  for (const { file, text } of ALL) assert.doesNotMatch(code(text), /\buseMutation\s*[(<]/, `${file} uses a bare useMutation`);
  for (const { file, text } of writers.filter((w) => !w.file.endsWith('Model.ts') && !w.file.includes('_queries'))) assert.match(code(text), /useReportedMutation/, `${file} writes without useReportedMutation`);
});

test('every page of the group that draws something draws the kit\'s page head (PageHeader variant="page"); the three old pages are forwards and draw nothing', () => {
  for (const f of ['tasks/page.tsx', 'tasks/[id]/page.tsx', 'tasks/[id]/_TaskView.tsx', 'my-work/page.tsx']) {
    assert.match(code(read(f)), /<PageHeader[\s\S]{0,40}variant="page"/, f);
  }
  // the tabs' views draw none: they sit under their page's head
  for (const f of ['tasks/_work/MyWork.tsx', 'tasks/_SettingsTab.tsx', 'tasks/_ReportsView.tsx', 'tasks/_Board.tsx']) assert.doesNotMatch(code(read(f)), /<PageHeader/, f);
  for (const f of ['tasks/my-tasks/page.tsx', 'tasks/reports/page.tsx', 'tasks/sla/page.tsx']) assert.doesNotMatch(code(read(f)), /<PageHeader/, `${f} is a forward`);
});

// ── the behaviour the rebuild preserves ───────────────────────────────────────────────────────────────────────────────────────────────

test('the rights are the ones the pages always checked: New task needs critical_tasks:tasks:create; Edit and Delete need the literals the task page has always used; a document task is deleted by administrators only', () => {
  assert.match(code(read('tasks/page.tsx')), /hasPermission\('critical_tasks:tasks:create'\)/);
  const view = code(read('tasks/[id]/_TaskView.tsx'));
  assert.match(view, /hasPermission\('tasks:task_management:edit'\)/);
  assert.match(view, /hasPermission\('tasks:task_management:delete'\)/);
  assert.match(view, /canDeleteTask\(task, \{ isAdmin, hasDeleteRight: canDelete \}\)/);
  assert.match(code(read('tasks/[id]/_Panels.tsx')), /canDelete/, 'the sub-task delete follows the same right');
  const work = code(read('my-work/page.tsx'));
  assert.match(work, /canOpenMyWork\(isAdmin, hasAnyPermission\)/, 'My Work is for administrators and people with framework, control or evidence access (the rule is myWorkAccess.ts, which Task Management\'s link shares)');
  assert.match(code(read('my-work/myWorkAccess.ts')), /\['compliance:frameworks:\*', 'controls:control_library:\*', 'evidence:evidence_library:\*'\]/);
  assert.match(code(read('my-work/myWorkAccess.ts')), /isAdmin \|\| hasAny\(/);
  assert.match(work, /NoAccessState/, 'the one place that already decided "no access" says it with the kit');
  const register = ['tasks/_Board.tsx', 'tasks/_register/TaskRegister.tsx', 'tasks/_register/TaskRows.tsx', 'tasks/_register/TaskBoard.tsx', 'tasks/_register/TaskDrawer.tsx', 'tasks/_register/BulkTasks.tsx'].map((f) => code(read(f))).join(' ');
  const front = ['tasks/_work/MyWork.tsx', 'tasks/_work/WorkCard.tsx', 'tasks/_work/LoadCard.tsx', 'tasks/_work/workData.ts', 'tasks/_work/useTaskStep.ts'].map((f) => code(read(f))).join(' ');
  assert.doesNotMatch(register + front + code(read('tasks/_ReportsView.tsx')), /NoAccessState/, 'no other page decides "no access": the server answers and the page says its words');
  assert.doesNotMatch(front, /hasPermission\(/, 'My work checks no right to show a step: the person\'s own tasks are the server\'s answer, a step is offered by taskRecord.nextStep (Approve only to the reviewer who is not the owner: what the server lets act)');
  assert.equal((front.match(/isAdmin/g) ?? []).length, 2, 'the one right it reads is whether to OFFER the My Work link (the destructuring and the call of canOpenMyWork)');
  assert.match(code(read('tasks/page.tsx')), /<SettingsTab canEdit=\{canCreate\} \/>/, 'Settings are changed by people who may create tasks: the server\'s module-settings rule (critical_tasks:tasks:create)');
  assert.doesNotMatch(register, /hasPermission|hasAnyPermission|isAdmin/, 'the register checks no right of its own: New task arrives as a prop from the page head, everything else is for the server to allow (recorded as a gap for the owner)');
});

test('the requests are the old ones: the same API calls, the same bulk and list bodies, the same query keys', () => {
  const queries = code(read('tasks/_queries.ts'));
  assert.match(queries, /criticalTasksApi\.getTenantUsers\(\)/);
  const data = code(read('tasks/_register/taskData.ts'));
  assert.match(data, /criticalTasksApi\.list\(\{ lean: 1, limit: LOAD_LIMIT \}\)/, 'the register is ONE complete lean load');
  assert.match(data, /TASKS_KEY = \['critical-tasks', 'lean'\]/, 'the list key still starts with critical-tasks, so every invalidation of that name reaches it');
  assert.match(data, /LOAD_LIMIT = 10_000/, 'the ceiling of the server');
  assert.match(code(read('tasks/[id]/page.tsx')), /queryKey: \['critical-task', taskId\]/);
  const mine = code(read('tasks/_work/workData.ts'));
  assert.match(mine, /WORK_KEY = \['critical-tasks', 'work'\]/, 'the cockpit\'s key starts with critical-tasks, so every invalidation of that name reaches it');
  assert.match(mine, /queryKey: \[\.\.\.WORK_KEY, me\]/);
  assert.match(mine, /criticalTasksApi\.list\(\{ lean: 1, limit: LOAD_LIMIT, \.\.\.filter \}\)/, 'My work asks the lean list with the server\'s own filters');
  for (const filter of ['assignee_id', 'reviewer_id', 'created_by_id']) assert.match(mine, new RegExp(`ask\\(\\{ ${filter}: me as number \\}\\)`), `the tasks the person ${filter}`);
  assert.match(mine, /\.truncated/, 'a cut answer is said');
  const step = code(read('tasks/_work/useTaskStep.ts'));
  assert.match(step, /criticalTasksApi\.transition\(v\.task\.id, \{ new_status: v\.to \}\)/, 'a step of My work is the register\'s: the same bodies');
  assert.match(step, /criticalTasksApi\.requestApproval\(v\.task\.id, \{ comment: ''/);
  assert.match(step, /criticalTasksApi\.approveTask\(v\.task\.id, \{ comment: '' \}\)/);
  assert.match(step, /invalidate: TASK_REFRESH\.filter/);
  assert.match(code(read('tasks/_ReportsView.tsx')), /queryKey: \['task-reports'\]/);
  assert.match(code(read('tasks/_ReportsView.tsx')), /criticalTasksApi\.reportsSummary\(\)/);
  const bulk = code(read('tasks/_register/BulkTasks.tsx'));
  assert.match(bulk, /\{ task_ids: v\.ids, action: v\.action, assigned_owner_id: v\.assignee \}/);
  assert.match(bulk, /\{ task_ids: v\.ids, action: v\.action, value: v\.value \}/);
  assert.match(bulk, /criticalTasksApi\.bulkAction\(bodyOf\(v\)\)/);
  assert.match(code(read('tasks/_AiPriorities.tsx')), /criticalTasksApi\.update\(s\.task_id, \{ priority: s\.suggested_priority \}\)/);
  assert.match(code(read('tasks/_ReportsView.tsx')), /criticalTasksApi\.update\(s\.task_id, \{ assigned_owner_id: s\.suggested_owner_id \}\)/);
  assert.match(code(read('tasks/[id]/_Actions.tsx')), /criticalTasksApi\.transition\(task\.id, \{ new_status: status, comment: comment \|\| undefined \}\)/);
  assert.match(code(read('tasks/[id]/_Panels.tsx')), /criticalTasksApi\.createSubTask\(task\.id, \{ title: value \}\)/);
  assert.match(code(read('tasks/[id]/_Panels.tsx')), /criticalTasksApi\.addComment\(task\.id, \{ content \}\)/);
  assert.match(code(read('my-work/page.tsx')), /queryKey: \['my-work', userId\]/);
  assert.match(code(read('my-work/page.tsx')), /queryKey: \['scf-my-work', userId\]/);
  assert.match(code(read('my-work/page.tsx')), /scfApi\.myWork\(\)/);
});

test('every mutation that changes a task refreshes what shows it: the board list (critical-tasks), the task (critical-task) or the reports', () => {
  assert.match(code(read('tasks/_CreateTask.tsx')), /invalidate: \[\['critical-tasks'\]\]/);
  assert.match(code(read('tasks/_register/BulkTasks.tsx')), /invalidate: TASK_REFRESH/);
  assert.match(code(read('tasks/_register/taskData.ts')), /TASK_REFRESH[^=]*= \[\['critical-tasks'\], \['critical-task'\], \['my-tasks'\], \['task-reports'\]\]/, 'a bulk write refreshes the list, the open task, My Tasks and the reports');
  assert.match(code(read('tasks/_AiPriorities.tsx')), /invalidate: \[\['critical-tasks'\]\]/);
  assert.match(code(read('tasks/_ReportsView.tsx')), /invalidate: \[\['task-reports'\], \['critical-tasks'\]\]/);
  for (const f of ['tasks/[id]/_Actions.tsx', 'tasks/[id]/_Panels.tsx', 'tasks/[id]/_EditTask.tsx', 'tasks/[id]/_AiPanels.tsx']) assert.match(code(read(f)), /\['critical-task', task\.id\]/, f);
});

test('the URL contract: /tasks keeps its four tabs in ?tab= (My work, the default, has the plain address; an old board link with no tab opens All tasks), the register lives in the address, the task page keeps its tabs in ?tab=, and the pages that were embedded are forwards that keep the query', () => {
  const page = code(read('tasks/page.tsx'));
  assert.match(page, /useTabParam\('tab', TASK_TABS, \{ fallback: defaultTab\(search\), aliases: TAB_ALIASES \}\)/, 'the fallback is My work, or All tasks for an address that carries the register\'s parameters (taskTabs.test.ts)');
  assert.match(page, /<TabPanel tabKey="work" className="pt-\[12px\]">\{tab === 'work' && <MyWork \/>\}/, 'My work is the first tab');
  assert.match(code(read('tasks/_register/TaskRegister.tsx')), /useAddressState\(REGISTER_SCHEMA\)/, 'the register lives in the address (the old board links keep working: taskAddress.test.ts)');
  assert.match(code(read('tasks/_Board.tsx')), /<TaskRegister canCreate=\{canCreate\} onNew=\{onNew\} \/>/, 'the Board tab is the register');
  assert.match(code(read('tasks/[id]/_TaskView.tsx')), /useTabParam\('tab', DETAIL_TABS, \{ fallback: 'details' \}\)/);
  for (const f of ['tasks/my-tasks/page.tsx', 'tasks/reports/page.tsx', 'tasks/sla/page.tsx']) assert.match(code(read(f)), /export default function \w+Forward\(\{ searchParams \}/, `${f} is still an address that works: a forward that keeps the query`);
});

test('the pieces other groups own are used as they are: the document request link and card, the module settings panel, the document-task rules', () => {
  assert.match(code(read('tasks/_ui.tsx')), /from '@\/components\/governance\/DocumentTaskActions'/);
  assert.match(code(read('tasks/[id]/_TaskView.tsx')), /DocumentTaskCard/);
  assert.match(code(read('tasks/_SettingsTab.tsx')), /import ModuleSettingsPanel from '@\/components\/settings\/ModuleSettingsPanel'/);
  assert.match(code(read('tasks/_SettingsTab.tsx')), /<ModuleSettingsPanel moduleKey="tasks" \/>/);
  assert.match(code(read('tasks/tasksModel.ts')), /from '\.\.\/\.\.\/\.\.\/lib\/documentTasks\.ts'/);
});

test('the old pages\' own copies are gone: no page-local colour map, no hand-built overlay, no MultiSelectDropdown in the Task Management pages', () => {
  for (const { file, text } of TSX) {
    const src = code(text);
    assert.doesNotMatch(src, /PRIORITY_COLORS|STATUS_COLORS|SLA_COLORS|KANBAN_BORDER_COLORS/, `${file}: a colour map the status registry replaced`);
    assert.doesNotMatch(src, /fixed inset-0/, `${file}: a hand-built overlay (the kit's overlays are used)`);
    assert.doesNotMatch(src, /MultiSelectDropdown|SearchInput\b/, `${file}: a legacy picker`);
  }
});

// ── the All tasks register (Stage 4, tasks-register) ──────────────────────────────────────────────────────────────────────────────────────

test('the register is the shared facet explorer on the kit, loads the lean list once and keeps its state in the address', () => {
  const reg = code(read('tasks/_register/TaskRegister.tsx'));
  for (const piece of ['RecordExplorer', 'RecordTable', 'BulkBar', 'AppliedFilters', 'useSelection', 'useExplorerKeys', 'evaluate']) assert.match(reg, new RegExp(`\\b${piece}\\b`), piece);
  assert.match(reg, /useLeanTasks\(\)/);
  assert.doesNotMatch(reg, /criticalTasksApi\.list\(/, 'the page asks through taskData, once');
  assert.doesNotMatch(reg, /<PageHeader/, 'the register sits under the page head');
  for (const { file, text } of ALL.filter((s) => s.file.includes('/tasks/_register/'))) {
    assert.doesNotMatch(code(text), /localStorage|sessionStorage/, `${file}: state that matters is in the address or on the server`);
  }
});

test('the register moves a task through the workflow endpoints, with the bodies the task page sends', () => {
  const reg = code(read('tasks/_register/TaskRegister.tsx'));
  assert.match(reg, /criticalTasksApi\.transition\(v\.task\.id, \{ new_status: v\.to \}\)/);
  assert.match(reg, /criticalTasksApi\.requestApproval\(v\.task\.id, \{ comment: ''/);
  assert.match(reg, /criticalTasksApi\.approveTask\(v\.task\.id, \{ comment: '' \}\)/);
  assert.match(reg, /invalidate: TASK_REFRESH\.filter/, 'one step refreshes the open task, My Tasks and the reports; the register row is patched, not loaded again');
  const rows = code(read('tasks/_register/TaskRows.tsx')) + code(read('tasks/_register/TaskBoard.tsx'));
  assert.match(rows, /approvalGate\(task, status\)/, 'a step the approval gate holds back says so (and is not pressable)');
  assert.match(rows, /allowedTransitions\(task\)/, 'only the steps the workflow allows are offered');
});

test('the register has no drag and no storage of its own', () => {
  for (const { file, text } of ALL.filter((s) => s.file.includes('/tasks/_register/') && s.file.endsWith('.tsx'))) {
    assert.doesNotMatch(code(text), /draggable|onDragStart|onDrop/, `${file}: a status changes through the menu, never by dragging`);
  }
});

// ── the front door (Stage 4, tasks-front) ─────────────────────────────────────────────────────────────────────────────────────────────────

test('My work is the shared cockpit frame with a worklist row per task and ONE action on it, and keeps nothing in the browser', () => {
  const my = code(read('tasks/_work/MyWork.tsx'));
  for (const piece of ['Cockpit', 'CounterBand', 'SkipToWork', 'useNarrow', 'layoutOf', 'workRowLimit']) assert.match(my, new RegExp(`\\b${piece}\\b`), piece);
  assert.match(code(read('tasks/_work/WorkCard.tsx')), /<WorkRow/, 'a row is the kit\'s worklist row');
  assert.match(code(read('tasks/_work/WorkCard.tsx')), /action=\{r\.action \?/, 'one action a row');
  for (const { file, text } of ALL.filter((s) => s.file.includes('/tasks/_work/'))) {
    assert.doesNotMatch(code(text), /localStorage|sessionStorage/, `${file}: state that matters is in the address or on the server`);
  }
  assert.match(my, /useInbox\(\)/, 'Needs my action is the shared inbox: the same count as its page and the top bar');
});

test('the band\'s links are addresses of All tasks the register reads (taskWork.test.ts holds each number to the register\'s own count); an account that cannot be read is an error, never a skeleton for ever', () => {
  assert.match(code(read('tasks/_work/taskWork.ts')), /tasksHref\('all', \{ quick: 'mine', due: \['overdue'\] \}\)/);
  const my = code(read('tasks/_work/MyWork.tsx'));
  assert.match(my, /me\.failed/);
  assert.match(code(read('tasks/_work/workData.ts')), /failed: id == null && !q\.isPending/);
  assert.match(code(read('my-work/page.tsx')), /me\.failed/, 'My Work says it could not read the account too');
});

test('Settings says the server\'s deadline rules, and they ARE the server\'s (services/task_lean.sla_word): Breached below zero days, At risk up to three, Completed when done, No SLA without a due date', () => {
  const server = readFileSync('../backend/grc/services/task_lean.py', 'utf8');
  assert.match(server, /if days < 0:\s+return "Breached"/);
  assert.match(server, /"At Risk" if days <= 3 else "On Track"/);
  assert.match(server, /if status in DONE:\s+return "Completed"/);
  const tab = code(read('tasks/_SettingsTab.tsx'));
  for (const word of ['On track', 'At risk', 'Breached', 'Completed']) assert.ok(tab.includes(`'${word}'`), word);
  assert.match(tab, /Three days or less until it is due/);
  assert.match(tab, /<fieldset disabled=\{!canEdit\}/, 'a person who may not save reads the settings: the panel is switched off, not hidden');
  const spec = readFileSync('../backend/grc/services/module_settings.py', 'utf8');
  assert.match(spec, /"sections": \("sla", "fields", "lists"\),\r?\n\s+"permissions": \{"view": "critical_tasks:tasks:view", "edit": "critical_tasks:tasks:create"\}/, 'Settings of tasks: no status levels, saved by people who may create tasks');
});
