'use client';

// New task, in a sheet that asks "Discard changes?" before it throws typed input away (`dirty`). It opens on what a task needs: the TITLE (Enter makes the task), the owners, the due date and the
// priority; everything else is shut under "More options", "Link a record" (its seven lists load only when it is opened) and "Custom fields". "From a template" starts a task from one of the
// templates the server offers, with its checklist. What is sent is createPayload (tasksModel.ts, exactly what the old form sent) or templateBody (_create/templateModel.ts); the tenant's own
// labels, lists and removed fields (Settings) are respected. A made task says so with an "Open task" button; a refused or failed create stays inside the sheet, in the server's words, with a Retry
// when asking again can help, everything typed kept. The files of this form are in _create/.
import { useRef, useState } from 'react';
import { Disclosure, FormError, FormField, MultiSelect, ErrorState, Button, SegmentedControl, Select, Sheet, TextInput } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { CustomFieldsTab, builtinLabel, listOptions, liveFields, showBuiltin, useModuleSettings, valuesToSave, type CustomValues } from '@/components/settings/CustomFields';
import { useTenantUsers } from './_queries';
import { LinkRecords } from './_create/LinkRecords';
import { MoreOptions } from './_create/MoreOptions';
import { TemplatePane, useTemplates } from './_create/TemplatePane';
import { emptyTemplateForm, templateBody, templateKey, templateProblem, type TemplateForm, type TemplateRow } from './_create/templateModel';
import { useCreateTask } from './_create/useCreateTask';
import { PRIORITIES, TITLE_MAX, createPayload, emptyTask, formDirty, titleProblem, userOptions, type NewTaskForm } from './tasksModel';

type Mode = 'task' | 'template';
const TITLE_ID = 'new-task-title';

export function CreateTaskDrawer({ onClose }: { onClose: () => void }) {
  const [mode, setMode] = useState<Mode>('task');
  const [form, setForm] = useState<NewTaskForm>(emptyTask);
  const [custom, setCustom] = useState<CustomValues>({});
  const [tried, setTried] = useState(false);                          // the title is checked once a create was tried, not while the person is still typing
  const [linkOpen, setLinkOpen] = useState(false);
  const [picked, setPicked] = useState<TemplateRow | null>(null);
  const [tform, setTform] = useState<TemplateForm>({ title: '', owner: '', reviewer: '', approval: false });
  const titleInput = useRef<HTMLInputElement>(null);
  const set = (patch: Partial<NewTaskForm>) => setForm((f) => ({ ...f, ...patch }));

  const { data: settings } = useModuleSettings('tasks');
  const users = useTenantUsers();
  const templates = useTemplates(mode === 'template');
  const made = useCreateTask(onClose);

  const submitTask = () => {
    setTried(true);
    if (titleProblem(form.title)) { titleInput.current?.focus(); return; }
    made.create(createPayload(form, valuesToSave(settings, custom, null)));
  };
  const submitTemplate = () => {
    setTried(true);
    if (!picked || templateProblem(tform)) return;
    made.createFromTemplate(templateBody(picked, tform));
  };
  const submit = mode === 'task' ? submitTask : submitTemplate;

  const titleError = titleProblem(form.title);
  const showTitleError = tried && titleError ? titleError : form.title.length > TITLE_MAX ? titleError : null;
  const liveCount = liveFields(settings).length;
  const dirty = formDirty(form, custom) || (!!picked && (tform.title !== picked.name || !!tform.owner || !!tform.reviewer || tform.approval));
  const priorities = listOptions(settings, 'priority', form.priority, PRIORITIES.map((v) => ({ value: v, label: v })));

  return (
    <Sheet
      open
      onClose={onClose}
      side="right"
      width="lg"
      title="New task"
      dirty={dirty}
      initialFocus={`#${TITLE_ID}`}
      footer={(
        <div className="flex flex-wrap items-center justify-end gap-[8px]">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={made.pending} disabled={mode === 'template' && !picked} onClick={submit}>{mode === 'task' ? 'Create task' : 'Create from template'}</Button>
        </div>
      )}
    >
      <div className="flex flex-col gap-[16px]">
        <SegmentedControl<Mode>
          label="How to start the task"
          name="new-task-mode"
          value={mode}
          onChange={(next) => { setMode(next); made.clear(); setTried(false); }}
          options={[{ value: 'task', label: 'New task' }, { value: 'template', label: 'From a template' }]}
        />
        <FormError title="Couldn't create the task" error={made.problem ? made.problem.message : null} onRetry={made.problem?.retry ? made.retry : undefined} />

        {mode === 'task' ? (
          <>
            <FormField id={TITLE_ID} label={builtinLabel(settings, 'title', 'Title')} required error={showTitleError} hint={showTitleError ? undefined : `${form.title.length} / ${TITLE_MAX}`}>
              <TextInput ref={titleInput} value={form.title} placeholder="What needs to be done?" onChange={(e) => set({ title: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submitTask(); } }} />
            </FormField>
            {showBuiltin(settings, 'owners') && (
              <FormField label={builtinLabel(settings, 'owners', 'Assigned owners')}>
                {users.isError && !users.data
                  ? <ErrorState compact title="Couldn't load the people" message={errorMessage(users.error)} onRetry={canRetry(users.error) ? () => { void users.refetch(); } : undefined} />
                  : <MultiSelect label="Owners" options={userOptions(users.data)} value={form.assigned_user_ids} placeholder={users.isPending ? 'Loading…' : 'Unassigned'} searchPlaceholder="Search people" display="chips" onChange={(v) => set({ assigned_user_ids: v, assigned_owner_id: v[0] || '' })} />}
              </FormField>
            )}
            <div className="grid grid-cols-1 gap-[12px] sm:grid-cols-2">
              {showBuiltin(settings, 'due_date') && (
                <FormField label={builtinLabel(settings, 'due_date', 'Due date')}><TextInput type="date" value={form.due_date} onChange={(e) => set({ due_date: e.target.value })} /></FormField>
              )}
              {showBuiltin(settings, 'priority') && (
                <FormField label={builtinLabel(settings, 'priority', 'Priority')}>
                  <Select value={form.priority} onChange={(e) => set({ priority: e.target.value })}>{priorities.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select>
                </FormField>
              )}
            </div>
            <div className="flex flex-col gap-[8px]">
              <Disclosure label="More options" level={3} region={false}><div className="pt-[12px]"><MoreOptions form={form} set={set} settings={settings} /></div></Disclosure>
              <Disclosure label="Link a record" level={3} region={false} open={linkOpen} onOpenChange={setLinkOpen}>
                <div className="pt-[12px]">{linkOpen && <LinkRecords form={form} set={set} setForm={setForm} />}</div>
              </Disclosure>
              <Disclosure label={liveCount > 0 ? `Custom fields (${liveCount})` : 'Custom fields'} level={3} region={false}>
                <div className="pt-[12px]"><CustomFieldsTab moduleKey="tasks" values={custom} onChange={setCustom} /></div>
              </Disclosure>
            </div>
          </>
        ) : (
          <TemplatePane
            templates={templates}
            picked={picked ? templateKey(picked) : null}
            onPick={(t) => { setPicked(t); setTform(emptyTemplateForm(t)); made.clear(); setTried(false); }}
            form={tform}
            onForm={setTform}
            tried={tried}
          />
        )}
      </div>
    </Sheet>
  );
}
