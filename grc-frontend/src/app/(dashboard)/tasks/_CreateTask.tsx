'use client';

// New task, in a drawer that asks "Discard changes?" before it throws typed input away (RightSlidePanel `dirty`). The fields are the old form's, on the kit (FormField with TextInput, Textarea,
// Select, Combobox, MultiSelect, Checkbox), in the tenant's own labels and lists (Settings: builtinLabel, listOptions, showBuiltin) with their custom-fields tab. What is sent is
// createPayload (tasksModel.ts), exactly what the old page sent. The record pickers load when the drawer opens, and one that cannot load says so instead of being an empty list.
// A refused or failed create stays on screen inside the drawer, in the server's words, with everything typed kept and a Retry when trying again can help.
import { useRef, useState, type ReactNode } from 'react';
import { Sparkles } from 'lucide-react';
import { criticalTasksApi } from '@/lib/api';
import { RightSlidePanel } from '@/components/ui';
import { InfoTip } from '@/components/ui/InfoTip';
import { Button, Checkbox, Combobox, ErrorState, FormField, MultiSelect, Select, Textarea, TextInput, useNotify, useReportedMutation } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { CustomFieldsTab, CustomFieldsTabBar, builtinLabel, listOptions, showBuiltin, useModuleSettings, valuesToSave, type CustomValues } from '@/components/settings/CustomFields';
import { truncate } from '@/lib/format';
import { FormProblem } from './_ui';
import { useFrameworkOptions, useRecordOptions, useRequirementOptions, useTenantUsers } from './_queries';
import { TASK_SLA_LABELS, TASK_SLA_ORDER, getTaskSLAConfig, type TaskSLALevel } from './slaConfig';
import {
  CATEGORIES, PRIORITIES, SEVERITIES, SOURCES, TITLE_MAX, aiContextOf, aiContextRequest, aiDescriptionText, applyAiContext, createPayload, emptyTask, fallbackFill, formDirty, titleProblem, userOptions,
  type AiContextItem, type NewTaskForm, type PickerKind, type PickerOption,
} from './tasksModel';

/** What a query tells the form about a list it needs to fill a picker. */
interface Source { data?: PickerOption[]; isLoading: boolean; isError: boolean; error: unknown; refetch: () => unknown }

const RECURRENCE = [{ value: 'daily', label: 'Daily' }, { value: 'weekly', label: 'Weekly' }, { value: 'monthly', label: 'Monthly' }, { value: 'quarterly', label: 'Quarterly' }];

/** One record picker: a searchable list that can be cleared; when the list could not be read the picker says so (an empty picker would read as "there are none"). */
function LinkField({ label, value, onChange, source, hint, disabledText }: { label: string; value: string; onChange: (value: string) => void; source: Source; hint?: string; disabledText?: string }) {
  if (source.isError && !source.data) {
    return <ErrorState compact title={`Couldn't load the ${label.toLowerCase()} list`} message={errorMessage(source.error)} onRetry={canRetry(source.error) ? () => { void source.refetch(); } : undefined} />;
  }
  return (
    <FormField label={label} hint={hint}>
      <Combobox
        label={label}
        clearable
        searchable
        searchPlaceholder={`Search ${label.toLowerCase()}`}
        options={(source.data ?? []).map((o) => ({ value: String(o.id), label: o.label }))}
        value={value || null}
        onChange={(next) => onChange(next ?? '')}
        placeholder={disabledText ?? (source.isLoading ? 'Loading…' : 'None')}
        disabled={!!disabledText}
      />
    </FormField>
  );
}

export function CreateTaskDrawer({ onClose }: { onClose: () => void }) {
  const notify = useNotify();
  const [form, setForm] = useState<NewTaskForm>(emptyTask);
  const [custom, setCustom] = useState<CustomValues>({});
  const [tab, setTab] = useState<'details' | 'custom'>('details');
  const [tried, setTried] = useState(false);                          // the title is checked once a save was tried, not while the person is still typing
  const [problem, setProblem] = useState<{ message: string; retry: boolean } | null>(null);
  const lastPayload = useRef<Record<string, unknown> | null>(null);
  const titleInput = useRef<HTMLInputElement>(null);
  const set = (patch: Partial<NewTaskForm>) => setForm((f) => ({ ...f, ...patch }));

  const { data: settings } = useModuleSettings('tasks');
  const users = useTenantUsers();
  const userList = userOptions(users.data);
  const risks = useRecordOptions('risk', true);
  const controls = useRecordOptions('control', true);
  const vulnerabilities = useRecordOptions('vulnerability', true);
  const changes = useRecordOptions('regulatory', true);
  const committees = useRecordOptions('committee', true);
  const frameworks = useFrameworkOptions(true);
  const requirements = useRequirementOptions(form.linked_framework_id);

  const slaDaysFor = (level: TaskSLALevel): number => {
    const saved = settings?.sla?.targets?.[level]?.days;
    return typeof saved === 'number' ? saved : getTaskSLAConfig()[level];
  };
  const asOptions = (key: string, current: string, fallback: string[]) => listOptions(settings, key, current, fallback.map((v) => ({ value: v, label: v })));

  const create = useReportedMutation({
    mutationFn: (payload: Record<string, unknown>) => criticalTasksApi.create(payload),
    success: (_, payload) => ({ title: 'Task created', message: truncate(String(payload.title), 80).text }),
    failure: "Couldn't create the task",
    invalidate: [['critical-tasks']],
    toast: 'success',                                                  // a failure is shown inside the drawer, once, with the form still filled
    onSuccess: onClose,
    onError: (error) => setProblem({ message: errorMessage(error, 'The task was not created. Nothing you typed was lost.'), retry: canRetry(error) }),
  });

  const submit = () => {
    setTried(true);
    if (titleProblem(form.title)) { titleInput.current?.focus(); return; }
    setProblem(null);
    const payload = createPayload(form, valuesToSave(settings, custom, null));
    lastPayload.current = payload;
    create.mutate(payload);
  };

  // AI Generate: from the linked records when there are some, else from the title alone (the old page's own two paths); it fills only what is empty
  const generate = useReportedMutation({
    mutationFn: async (v: { ctx: AiContextItem[]; form: NewTaskForm }) => {
      if (v.ctx.length === 0) {
        const res = await criticalTasksApi.aiGenerateDescription({ title: v.form.title, category: v.form.category, source: v.form.source, priority: v.form.priority });
        return { ...v, request: null, desc: res.data?.description };
      }
      const request = aiContextRequest(v.ctx, v.form.priority);
      const res = await criticalTasksApi.aiGenerateDescription(request);
      return { ...v, request, desc: res.data?.description };
    },
    success: (r) => (r.ctx.length === 0 ? 'Description drafted' : 'Drafted from the linked records'),
    failure: "AI couldn't draft the task",
    onSuccess: (r) => {
      if (r.request) setForm((f) => applyAiContext(f, r.ctx, r.request, r.desc));
      else if (aiDescriptionText(r.desc)) setForm((f) => ({ ...f, description: aiDescriptionText(r.desc) }));
    },
    onError: (_error, v) => {
      if (v.ctx.length > 0) {                                          // as before, the form is still filled from what was linked: now it says so
        setForm((f) => fallbackFill(f, v.ctx));
        notify.info('The title and description were filled from the linked records instead.');
      }
    },
  });

  const runAi = () => {
    const ctx = aiContextOf(form, { risk: risks.data ?? [], control: controls.data ?? [], vulnerability: vulnerabilities.data ?? [], regulatory: changes.data ?? [], committee: committees.data ?? [] });
    if (ctx.length === 0 && !form.title.trim()) { notify.info('Link a record or type a title first, then AI Generate can draft the rest.'); return; }
    generate.mutate({ ctx, form });
  };

  const titleError = titleProblem(form.title);
  const showTitleError = tried && titleError ? titleError : tooLong(form.title) ? titleError : null;

  return (
    <RightSlidePanel
      isOpen
      onClose={onClose}
      title="New task"
      widthClassName="w-[780px] max-w-full"
      dirty={formDirty(form, custom)}
      footer={(
        <div className="flex items-center justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={create.isPending} onClick={submit}>Create task</Button>
        </div>
      )}
    >
      <div className="flex flex-col gap-[16px]">
        <FormProblem message={problem?.message} onRetry={problem?.retry && lastPayload.current ? () => { setProblem(null); create.mutate(lastPayload.current as Record<string, unknown>); } : undefined} />
        <CustomFieldsTabBar tab={tab} onTab={setTab} settings={settings} />
        <div data-tab="details" className={tab === 'details' ? 'flex flex-col gap-[16px]' : 'hidden'}>
          <Group
            title="Link a source (optional)"
            info="Link the record this task is about. The risk, internal control, vulnerability and framework links are saved with the task. The regulatory change and the committee are used only to help AI Generate write the description: they are not saved."
            action={<Button leftIcon={<Sparkles aria-hidden />} loading={generate.isPending} onClick={runAi}>AI Generate</Button>}
          >
            <div className="grid grid-cols-1 gap-[12px] sm:grid-cols-2">
              <LinkField label="Risk" value={form.linked_risk_id} onChange={(v) => set({ linked_risk_id: v })} source={risks} />
              <LinkField label="Internal control" value={form.linked_control_id} onChange={(v) => set({ linked_control_id: v })} source={controls} />
              <LinkField label="Vulnerability" value={form.linked_vulnerability_id} onChange={(v) => set({ linked_vulnerability_id: v })} source={vulnerabilities} />
              <LinkField label="Regulatory change" value={form.linked_regulatory_change_id} onChange={(v) => set({ linked_regulatory_change_id: v })} source={changes} />
              <LinkField label="Committee" value={form.linked_committee_id} onChange={(v) => set({ linked_committee_id: v })} source={committees} />
              <LinkField label="Compliance framework" value={form.linked_framework_id} onChange={(v) => set({ linked_framework_id: v, linked_requirement_id: '' })} source={frameworks} />
              <LinkField
                label="Framework requirement"
                value={form.linked_requirement_id}
                onChange={(v) => set({ linked_requirement_id: v })}
                source={requirements}
                disabledText={!form.linked_framework_id ? 'Select a framework first' : requirements.isLoading ? 'Loading requirements…' : undefined}
              />
            </div>
          </Group>

          <FormField label={builtinLabel(settings, 'title', 'Title')} required error={showTitleError} hint={showTitleError ? undefined : `${form.title.length} / ${TITLE_MAX}`}>
            <TextInput ref={titleInput} value={form.title} placeholder="Task title" onChange={(e) => set({ title: e.target.value })} />
          </FormField>

          {showBuiltin(settings, 'description') && (
            <FormField label={builtinLabel(settings, 'description', 'Description')}>
              <Textarea rows={3} value={form.description} placeholder="Task description" onChange={(e) => set({ description: e.target.value })} />
            </FormField>
          )}

          <div className="grid grid-cols-1 gap-[12px] sm:grid-cols-2">
            {showBuiltin(settings, 'source') && (
              <FormField label={builtinLabel(settings, 'source', 'Source')}>
                <Select value={form.source} onChange={(e) => set({ source: e.target.value })}>{asOptions('source', form.source, SOURCES).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select>
              </FormField>
            )}
            {showBuiltin(settings, 'priority') && (
              <FormField label={builtinLabel(settings, 'priority', 'Priority')}>
                <Select value={form.priority} onChange={(e) => set({ priority: e.target.value })}>{asOptions('priority', form.priority, PRIORITIES).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select>
              </FormField>
            )}
            {showBuiltin(settings, 'category') && (
              <FormField label={builtinLabel(settings, 'category', 'Category')}>
                <Select value={form.category} onChange={(e) => set({ category: e.target.value })}>{asOptions('category', form.category, CATEGORIES).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select>
              </FormField>
            )}
            {showBuiltin(settings, 'severity') && (
              <FormField label={builtinLabel(settings, 'severity', 'Severity')}>
                <Select placeholder="None" value={form.severity} onChange={(e) => set({ severity: e.target.value })}>{asOptions('severity', form.severity, SEVERITIES).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select>
              </FormField>
            )}
            {showBuiltin(settings, 'owners') && (
              <PeopleField label={builtinLabel(settings, 'owners', 'Assigned owners')} failed={users.isError} error={users.error} retry={() => { void users.refetch(); }}>
                <MultiSelect label="Owners" options={userList} value={form.assigned_user_ids} placeholder="Unassigned" searchPlaceholder="Search users" display="chips" onChange={(v) => set({ assigned_user_ids: v, assigned_owner_id: v[0] || '' })} />
              </PeopleField>
            )}
            {showBuiltin(settings, 'reviewer') && (
              <PeopleField label={builtinLabel(settings, 'reviewer', 'Reviewer')} failed={users.isError} error={users.error} retry={() => { void users.refetch(); }}>
                <Combobox label="Reviewer" clearable searchable options={userList} value={form.reviewer_id || null} placeholder="None" searchPlaceholder="Search users" onChange={(v) => set({ reviewer_id: v ?? '' })} />
              </PeopleField>
            )}
            {showBuiltin(settings, 'due_date') && (
              <FormField label={builtinLabel(settings, 'due_date', 'Due date')}>
                <TextInput type="date" value={form.due_date} onChange={(e) => set({ due_date: e.target.value })} />
              </FormField>
            )}
            <FormField label="SLA level" hint={form.sla_days ? `Applies a ${form.sla_days}-day deadline window.` : undefined}>
              <Select
                placeholder="Select SLA level"
                value={form.sla_level}
                onChange={(e) => {
                  const level = e.target.value as TaskSLALevel | '';
                  set(level ? { sla_level: level, sla_days: String(slaDaysFor(level)) } : { sla_level: '', sla_days: '' });
                }}
              >
                {TASK_SLA_ORDER.map((level) => <option key={level} value={level}>{`${TASK_SLA_LABELS[level]} (${slaDaysFor(level)} days)`}</option>)}
              </Select>
            </FormField>
          </div>

          <Group title="Recurrence and approval">
            <div className="grid grid-cols-1 items-end gap-[12px] sm:grid-cols-3">
              <FormField label="Recurrence">
                <Select placeholder="None" value={form.recurrence_pattern} onChange={(e) => set({ recurrence_pattern: e.target.value })}>
                  {RECURRENCE.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </Select>
              </FormField>
              {form.recurrence_pattern && (
                <FormField label="Interval" hint="Every N periods">
                  <TextInput type="number" min={1} value={form.recurrence_interval} onChange={(e) => set({ recurrence_interval: e.target.value })} />
                </FormField>
              )}
              <Checkbox label="Requires approval" checked={form.approval_required} onChange={(e) => set({ approval_required: e.target.checked })} />
            </div>
          </Group>

          {showBuiltin(settings, 'notes') && (
            <FormField label={builtinLabel(settings, 'notes', 'Evidence / notes')}>
              <Textarea rows={2} value={form.evidence_notes} placeholder="Supporting evidence or notes" onChange={(e) => set({ evidence_notes: e.target.value })} />
            </FormField>
          )}
        </div>
        <div data-tab="custom" className={tab === 'custom' ? '' : 'hidden'}>
          <CustomFieldsTab moduleKey="tasks" values={custom} onChange={setCustom} />
        </div>
      </div>
    </RightSlidePanel>
  );
}

/** a title over the table's limit is said at once (a longer one is a bare 500 from the server); an empty one only after a save was tried */
const tooLong = (title: string) => title.length > TITLE_MAX;

/** A bordered group of fields with its own heading, an (i) and an action on the right. */
function Group({ title, info, action, children }: { title: string; info?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col gap-[12px] rounded-ds-card border border-ds-border bg-ds-surface-hover p-[12px]">
      <div className="flex flex-wrap items-center justify-between gap-[8px]">
        <div className="flex items-center gap-[4px]">
          <h3 className="!text-ds-body !font-[600] !text-ds-fg">{title}</h3>
          {info && <InfoTip text={info} label={`About ${title.toLowerCase()}`} />}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

/** A people picker's field: when the people could not be read it says so, with Retry (an empty list would read as "nobody can be chosen"). */
function PeopleField({ label, failed, error, retry, children }: { label: string; failed: boolean; error: unknown; retry: () => void; children: ReactNode }) {
  if (failed) return <ErrorState compact title="Couldn't load the people" message={errorMessage(error)} onRetry={canRetry(error) ? retry : undefined} />;
  return <FormField label={label}>{children}</FormField>;
}
