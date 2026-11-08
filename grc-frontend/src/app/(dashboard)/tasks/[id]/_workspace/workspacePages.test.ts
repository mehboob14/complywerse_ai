// node --test "src/app/(dashboard)/tasks/*/_workspace/workspacePages.test.ts"
// Source-text pins of the task workspace (tasks/[id]/_workspace) and of New task (tasks/_CreateTask.tsx, tasks/_create): what a person sees holds no id and no internal word, what each editor
// sends, who is offered Approve and Reject, that nothing lives in the browser, and that the pieces other pages import are still there. The kit rules (no native dialogs, no hover-only action,
// no text under 12px, no platform-remapped utility, no bare <p>/<h2>/<h3>, every write through useReportedMutation) are held for the whole Task Management folder by tasksPages.test.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

const ROOT = 'src/app/(dashboard)/tasks';
const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/\s.*$/gm, '$1');
const filesIn = (dir: string) => (readdirSync(`${ROOT}/${dir}`) as string[]).filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f)).map((f) => ({ file: `${dir}/${f}`, text: code(readFileSync(`${ROOT}/${dir}/${f}`, 'utf8')) }));
const read = (file: string) => code(readFileSync(`${ROOT}/${file}`, 'utf8'));

const WORKSPACE = filesIn('[id]/_workspace');
const CREATE = [...filesIn('_create'), { file: '_CreateTask.tsx', text: read('_CreateTask.tsx') }];
const TSX = [...WORKSPACE, ...CREATE, { file: '[id]/page.tsx', text: read('[id]/page.tsx') }].filter((s) => s.file.endsWith('.tsx'));

test('the files are what the pins read', () => {
  assert.ok(WORKSPACE.length >= 14, `${WORKSPACE.length} files in the workspace`);
  assert.ok(CREATE.length >= 7, `${CREATE.length} files in New task`);
  for (const f of ['TaskWorkspace.tsx', 'Rail.tsx', 'InlineEditor.tsx', 'DescriptionCard.tsx', 'SubTasks.tsx', 'Activity.tsx', 'AiSheet.tsx', 'ApprovalPanel.tsx']) assert.ok(WORKSPACE.some((w) => w.file.endsWith(`/${f}`)), f);
});

test('no id and no internal word on a screen: no "Task #", no "#<id>" link text, no source entity type, no raw field name in the page\'s words', () => {
  for (const { file, text } of TSX) {
    assert.doesNotMatch(text, /Task #|Issue #|Document #|Regulatory change #|#\$\{[^}]*\.id[^}]*\}|>#\{/i, `${file}: an id in a sentence`);
    assert.doesNotMatch(text, /source_entity_type\}|\.source_entity_id\}|OversightAction|DocumentObligation(?!['"`])/, `${file}: an internal record name in a sentence`);
    assert.doesNotMatch(text, /\bis_admin\b/, `${file}: the approve and reject rule is the model's (taskRecord.mayDecide), never an admin flag of the page's own`);
  }
});

test('the head offers ONE next step (taskRecord.nextStep), Ask AI and Delete; Approve and Reject are drawn only when the model says the server lets this person decide', () => {
  const head = read('[id]/_workspace/TaskWorkspace.tsx');
  assert.match(head, /nextStep\(task, me\.id\)/);
  assert.match(head, /runStep\(step, \{ move: \(to\) => move\.mutate\(to\), decide: \(input\) => decide\.mutate\(input\) \}\)/);
  assert.match(head, /label="Ask AI"/);
  assert.match(head, /rights\.canDelete/);
  const panel = read('[id]/_workspace/ApprovalPanel.tsx');
  assert.match(panel, /\{view\.canDecide && \(/, 'Approve and Reject sit behind canDecide');
  assert.match(panel, /view\.canRequest && /, 'Request approval sits behind canRequest');
  assert.doesNotMatch(panel, /hasPermission|isAdmin/, 'who may decide is not a right of the page\'s: it is what the server lets act');
  assert.match(panel, /criticalTasksApi|useApproval/);
  const actions = read('[id]/_workspace/useTaskActions.ts');
  assert.match(actions, /criticalTasksApi\.requestApproval\(task\.id, \{ comment, \.\.\.\(to \? \{ transition_to: to \} : \{\}\) \}\)/);
  assert.match(actions, /criticalTasksApi\.approveTask\(task\.id, \{ comment \}\)/);
  assert.match(actions, /criticalTasksApi\.rejectTask\(task\.id, \{ comment \}\)/);
});

test('every editor saves through the one update (PUT with the fields that changed) and says what happened; a failure stays where it happened with a Retry', () => {
  const editor = read('[id]/_workspace/InlineEditor.tsx');
  assert.match(editor, /useUpdateTask\(taskId, \{ inline: true, onDone: close, onFail: \(e\) => setError\(e\) \}\)/);
  assert.match(editor, /<FormError title=\{`Couldn't save the \$\{label\.toLowerCase\(\)\}`\}/);
  assert.match(editor, /e\.key === 'Escape' && !e\.defaultPrevented/, 'Escape closes the editor, not an open list inside it');
  assert.match(editor, /trigger\.current\?\.focus\(\)/, 'focus goes back to the Change button');
  assert.match(read('[id]/_workspace/useTaskActions.ts'), /criticalTasksApi\.update\(taskId, patch\)/);
  for (const f of ['Rail.tsx', 'RailPeople.tsx', 'RailLinks.tsx']) assert.doesNotMatch(read(`[id]/_workspace/${f}`), /criticalTasksApi\./, `${f}: a row never sends a request of its own`);
  const rail = read('[id]/_workspace/Rail.tsx');
  assert.match(rail, /useModuleSettings\('tasks'\)/, 'the organization\'s own lists and labels');
  assert.match(rail, /showBuiltin\(settings, key\)/, 'a field the organization removed is not offered');
  const people = read('[id]/_workspace/RailPeople.tsx');
  assert.match(people, /ownersPatch\(draft\)/);
  assert.match(people, /assigned_user_ids|ownersPatch/);
  assert.match(read('[id]/_workspace/taskPageModel.ts'), /assigned_user_ids: ids\.map\(Number\)/, 'owners are sent as the server\'s canonical list');
});

test('a document request\'s task keeps its person, due date and status: the rows are read-only and say so; the rights are the ones the old Edit button checked', () => {
  const rail = read('[id]/_workspace/Rail.tsx');
  assert.match(rail, /rights\.statusLocked/);
  assert.match(rail, /canEdit=\{owners\.edit && !rights\.ownersLocked\}/);
  assert.match(rail, /canEdit=\{due\.edit && !rights\.dueLocked\}/);
  assert.match(read('[id]/_workspace/RailPeople.tsx'), /Follows the document request/);
  assert.match(read('[id]/_workspace/taskPageModel.ts'), /ownersLocked: doc, dueLocked: doc, statusLocked: doc/);
  const server = readFileSync('../backend/grc/modules/governance/doc_lifecycle.py', 'utf8');
  assert.match(server, /_LOCKED\b/, 'the server\'s lock on those fields (doc_lifecycle.locked_change) is what these rows follow');
});

test('the activity feed is the model\'s: comments and history merged in words, Ctrl or Cmd+Enter posts, the old ?tab= addresses scroll to their section', () => {
  const activity = read('[id]/_workspace/Activity.tsx');
  assert.match(activity, /feedOf\(task, filter\)/);
  assert.match(activity, /\(e\.ctrlKey \|\| e\.metaKey\)/);
  assert.match(read('[id]/_workspace/TaskWorkspace.tsx'), /scrollIntoView\(\{ block: 'start' \}\)/);
  assert.doesNotMatch(read('[id]/_workspace/Activity.tsx'), /field_changed|old_value|new_value/, 'the page never prints the stored values: taskTimeline.ts words them');
});

test('New task: it opens on the title, owners, due date and priority; the rest is shut; the seven record lists load only when "Link a record" is opened; a made task offers "Open task"', () => {
  const form = read('_CreateTask.tsx');
  assert.match(form, /export function CreateTaskDrawer\(\{ onClose \}: \{ onClose: \(\) => void \}\)/, 'the export page.tsx imports');
  assert.match(form, /createPayload\(form, valuesToSave\(settings, custom, null\)\)/, 'the body is the one the old form sent');
  assert.match(form, /templateBody\(picked, tform\)/);
  assert.match(form, /\{linkOpen && <LinkRecords /, 'the lists are read when the part is opened');
  assert.doesNotMatch(form, /useRecordOptions|useFrameworkOptions|useRequirementOptions/, 'the form itself reads no record list');
  assert.match(form, /e\.key === 'Enter'[^}]*submitTask\(\)/, 'Enter in the title makes the task');
  assert.match(form, /dirty=\{dirty\}/, 'typed input asks before it is thrown away');
  const made = read('_create/useCreateTask.ts');
  assert.match(made, /label: 'Open task'/);
  assert.match(made, /criticalTasksApi\.create\(body\)/);
  assert.match(made, /criticalTasksApi\.createFromTemplate\(body\)/);
  assert.match(made, /toast: 'none'/, 'a failure is shown inside the drawer once, not also toasted');
});

test('nothing here keeps state in the browser, and nothing reads the per-browser SLA store except the last fallback of the SLA level', () => {
  for (const { file, text } of [...WORKSPACE, ...CREATE]) {
    assert.doesNotMatch(text, /localStorage|sessionStorage/, file);
    if (!file.endsWith('MoreOptions.tsx')) assert.doesNotMatch(text, /slaConfig/, `${file}: the per-browser SLA store`);
  }
  assert.match(read('_create/MoreOptions.tsx'), /slaDaysFor\(settings\?\.sla, level, getTaskSLAConfig\(\)\)/, 'the organization\'s numbers first, the shipped ones last');
});
