'use client';

// Edit a task, in a drawer that asks "Discard changes?" before it throws typed input away (RightSlidePanel `dirty`). The fields and what they send are the old edit form's (editFormOf and
// editPayload in tasksModel.ts: ids and days as numbers, an emptied field as null); the record pickers load when the drawer opens. A task made by a document request keeps its person, its due
// date, its status and its link: they follow the request, so the form says so instead of offering them (the server refuses a change to them). A refused or failed save stays on screen inside the
// drawer in the server's words, with everything typed kept and a Retry when trying again can help.
import { useRef, useState } from 'react';
import { criticalTasksApi } from '@/lib/api';
import { RightSlidePanel } from '@/components/ui';
import { Button, Combobox, ErrorState, FormField, Notice, Select, Textarea, TextInput, useReportedMutation } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { dayOf, isDocumentTask, withCurrent } from '@/lib/documentTasks';
import { FormProblem } from '../_ui';
import { useRecordOptions, useTenantUsers } from '../_queries';
import {
  CATEGORIES, PRIORITIES, SEVERITIES, SOURCES, SOURCE_MODULES, TITLE_MAX, editDirty, editFormOf, editPayload, personName, titleProblem, userOptions,
  type EditForm, type PickerOption, type TaskDetail,
} from '../tasksModel';

const ENTITY_TYPES = [{ value: 'risk', label: 'Risk' }, { value: 'control', label: 'Control' }, { value: 'finding', label: 'Audit Finding' }, { value: 'vulnerability', label: 'Vulnerability' }, { value: 'compliance_gap', label: 'Compliance Gap' }];

interface Source { data?: PickerOption[]; isLoading: boolean; isError: boolean; error: unknown; refetch: () => unknown }

function Pick({ label, value, onChange, source }: { label: string; value: string; onChange: (v: string) => void; source: Source }) {
  if (source.isError && !source.data) {
    return <ErrorState compact title={`Couldn't load the ${label.toLowerCase()} list`} message={errorMessage(source.error)} onRetry={canRetry(source.error) ? () => { void source.refetch(); } : undefined} />;
  }
  return (
    <FormField label={label}>
      <Combobox label={label} clearable searchable searchPlaceholder={`Search ${label.toLowerCase()}`} options={(source.data ?? []).map((o) => ({ value: String(o.id), label: o.label }))} value={value || null} onChange={(v) => onChange(v ?? '')} placeholder={source.isLoading ? 'Loading…' : 'None'} />
    </FormField>
  );
}

export function EditTaskDrawer({ task, onClose }: { task: TaskDetail; onClose: () => void }) {
  const doc = isDocumentTask(task);
  const [start] = useState<EditForm>(() => editFormOf(task));
  const [form, setForm] = useState<EditForm>(start);
  const [tried, setTried] = useState(false);
  const [problem, setProblem] = useState<{ message: string; retry: boolean } | null>(null);
  const titleInput = useRef<HTMLInputElement>(null);
  const set = (key: string, value: string) => setForm((f) => ({ ...f, [key]: value }));
  const text = (key: string) => (form[key] as string) ?? '';

  const users = useTenantUsers();
  const risks = useRecordOptions('risk', true);
  const controls = useRecordOptions('control', true);
  const vulnerabilities = useRecordOptions('vulnerability', true);
  const people = userOptions(users.data);

  const save = useReportedMutation({
    mutationFn: (payload: Record<string, unknown>) => criticalTasksApi.update(task.id, payload),
    success: 'Changes saved',
    failure: "Couldn't save the task",
    invalidate: [['critical-task', task.id]],
    toast: 'success',                                                  // a failure is shown inside the drawer, once, with the form still filled
    onSuccess: onClose,
    onError: (error) => setProblem({ message: errorMessage(error, 'The changes were not saved. Nothing you typed was lost.'), retry: canRetry(error) }),
  });
  const lastPayload = useRef<Record<string, unknown> | null>(null);

  const submit = () => {
    setTried(true);
    if (titleProblem(text('title'))) { titleInput.current?.focus(); return; }
    setProblem(null);
    const payload = editPayload(form, task);                           // a document request's task: without the fields its request owns
    lastPayload.current = payload;
    save.mutate(payload);
  };

  const titleError = titleProblem(text('title'));
  const shownError = (tried && titleError) || (text('title').length > TITLE_MAX ? titleError : null);

  return (
    <RightSlidePanel
      isOpen
      onClose={onClose}
      title="Edit task"
      widthClassName="w-[780px] max-w-full"
      dirty={editDirty(form, start)}
      footer={(
        <div className="flex items-center justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={save.isPending} onClick={submit}>Save changes</Button>
        </div>
      )}
    >
      <div className="flex flex-col gap-[16px]">
        <FormProblem message={problem?.message} onRetry={problem?.retry && lastPayload.current ? () => { setProblem(null); save.mutate(lastPayload.current as Record<string, unknown>); } : undefined} />
        <FormField label="Title" required error={shownError} hint={shownError ? undefined : `${text('title').length} / ${TITLE_MAX}`}>
          <TextInput ref={titleInput} value={text('title')} onChange={(e) => set('title', e.target.value)} />
        </FormField>
        <FormField label="Description"><Textarea rows={3} value={text('description')} onChange={(e) => set('description', e.target.value)} /></FormField>
        <div className="grid grid-cols-1 gap-[12px] sm:grid-cols-2">
          <FormField label="Source"><Select value={text('source')} onChange={(e) => set('source', e.target.value)}>{withCurrent(SOURCES, form.source).map((s) => <option key={s} value={s}>{s}</option>)}</Select></FormField>
          <FormField label="Priority"><Select value={text('priority')} onChange={(e) => set('priority', e.target.value)}>{withCurrent(PRIORITIES, form.priority).map((p) => <option key={p} value={p}>{p}</option>)}</Select></FormField>
          <FormField label="Category"><Select value={text('category')} onChange={(e) => set('category', e.target.value)}>{withCurrent(CATEGORIES, form.category).map((c) => <option key={c} value={c}>{c}</option>)}</Select></FormField>
          <FormField label="Severity"><Select placeholder="None" value={text('severity')} onChange={(e) => set('severity', e.target.value)}>{withCurrent(SEVERITIES, form.severity).map((s) => <option key={s} value={s}>{s}</option>)}</Select></FormField>
          {!doc && (
            <>
              <FormField label="Source module"><Select placeholder="None" value={text('source_module')} onChange={(e) => set('source_module', e.target.value)}>{SOURCE_MODULES.map((m) => <option key={m} value={m}>{m}</option>)}</Select></FormField>
              <FormField label="Source entity type"><Select placeholder="None" value={text('source_entity_type')} onChange={(e) => set('source_entity_type', e.target.value)}>{ENTITY_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}</Select></FormField>
            </>
          )}
          {doc ? (
            <div className="sm:col-span-2">
              <Notice tone="info" title="Owner and due date follow the document request">
                Owner: {personName(task.assigned_owner) ?? 'the person asked'}. Due: {dayOf(task.due_date) ?? 'no date'}. They cannot be changed here.
              </Notice>
            </div>
          ) : (
            <FormField label="Owner">
              {users.isError
                ? <ErrorState compact title="Couldn't load the people" message={errorMessage(users.error)} onRetry={canRetry(users.error) ? () => { void users.refetch(); } : undefined} />
                : <Combobox label="Owner" clearable searchable options={people} value={text('assigned_owner_id') || null} onChange={(v) => set('assigned_owner_id', v ?? '')} placeholder="Unassigned" searchPlaceholder="Search users" />}
            </FormField>
          )}
          <FormField label="Reviewer">
            {users.isError
              ? <ErrorState compact title="Couldn't load the people" message={errorMessage(users.error)} onRetry={canRetry(users.error) ? () => { void users.refetch(); } : undefined} />
              : <Combobox label="Reviewer" clearable searchable options={people} value={text('reviewer_id') || null} onChange={(v) => set('reviewer_id', v ?? '')} placeholder="None" searchPlaceholder="Search users" />}
          </FormField>
          {!doc && <FormField label="Due date"><TextInput type="date" value={text('due_date')} onChange={(e) => set('due_date', e.target.value)} /></FormField>}
          <FormField label="SLA days"><TextInput type="number" min={1} unit="days" value={text('sla_days')} onChange={(e) => set('sla_days', e.target.value)} /></FormField>
        </div>
        <FormField label="Evidence / notes"><Textarea rows={2} value={text('evidence_notes')} onChange={(e) => set('evidence_notes', e.target.value)} /></FormField>
        <div className="grid grid-cols-1 gap-[12px] sm:grid-cols-3">
          <Pick label="Risk" value={text('linked_risk_id')} onChange={(v) => set('linked_risk_id', v)} source={risks} />
          <Pick label="Internal control" value={text('linked_control_id')} onChange={(v) => set('linked_control_id', v)} source={controls} />
          <Pick label="Vulnerability" value={text('linked_vulnerability_id')} onChange={(v) => set('linked_vulnerability_id', v)} source={vulnerabilities} />
        </div>
      </div>
    </RightSlidePanel>
  );
}
