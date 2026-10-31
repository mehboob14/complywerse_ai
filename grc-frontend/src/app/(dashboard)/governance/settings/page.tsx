'use client';

// Governance > Settings: the organisation's departments (the same records as Administration → Departments; added, edited and
// deactivated here: _DepartmentsSection.tsx), then how long people have to review, approve and acknowledge documents, reminders,
// escalation, where each alert goes and the Task Management task made for each request. The lifecycle settings are one
// organisation-wide source (the document page's "Due dates and escalation" shows a summary and links here). Administrators and
// holders of governance:settings:edit change them; anyone with a governance right reads them, nobody else. Helpers and rules:
// lib/governanceSettings.ts; backend: modules/governance/doc_lifecycle.py.
// The page prints labels, not sentences: what a field used to explain in a line is an (i) next to it (InfoTip).
// It is the first page on the design-system kit (components/ui/ds): PageHeader variant="page", SectionCard, FormField with TextInput / Select /
// Textarea / Checkbox / SegmentedControl, Table, StatusPill, SaveBar, Skeleton / EmptyState / ErrorState, and useReportedMutation for the save.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowUpRight, ChevronRight, Info, Lock, PenLine, RotateCcw } from 'lucide-react';
import apiClient from '@/lib/api';
import { priority as priorityStatus, statusPill } from '@/lib/status';
import { PageHeader } from '@/components/ui';
import { InfoTip } from '@/components/ui/InfoTip';
import {
  Button, Checkbox, EmptyState, ErrorState, FormField, RowHeaderCell, SaveBar, SectionCard, SegmentedControl, Select, SkeletonLines, StatusPill,
  Table, TableFrame, TBody, Td, Textarea, TextInput, Th, THead, Tr,
} from '@/components/ui/ds';
import { errorMessage } from '@/components/ui/ds/reportOutcome';
import { useReportedMutation } from '@/components/ui/ds/useReportedMutation';
import { useAdminDepartments } from '@/components/admin/DepartmentForm';
import {
  CHANNELS, EVENTS, KIND_LABEL, PLACEHOLDERS, PRIORITIES, STEP_LABEL, changes, courseOf, daysFor, noAccess, renderTemplate, retrySettings, sampleValues, shownKinds, validate,
  type Channel, type GovernanceSettings, type Kind, type Priority, type SettingsAnswer,
} from '@/lib/governanceSettings';
import { DepartmentsSection } from './_DepartmentsSection';

const SETTINGS_KEY = ['document-lifecycle-settings'];       // shared with the document page's summary card
const SETTINGS_URL = '/governance/documents/lifecycle/settings';

// Task Management's categories (tasks/page.tsx) and the ones the document and committee tasks have used; any other may be typed
const TASK_CATEGORIES = ['Compliance', 'Governance', 'Review', 'Remediation', 'Implementation', 'Reporting', 'Other'];
const CHANNEL_OPTIONS = CHANNELS.map((c) => ({ ...c, quiet: c.value === 'off' }));          // "Off" reads grey when chosen
const PAGE = 'mx-auto flex max-w-4xl flex-col gap-[12px]';
const FIELDS = 'grid gap-x-[16px] gap-y-[12px] sm:grid-cols-3';

// ── small pieces ─────────────────────────────────────────────────────────────
/** The page when the lifecycle settings cannot be shown (they did not load, or approvals are not switched on): the departments,
 *  which do not depend on them, still can. */
function WithDepartments({ children }: { children: ReactNode }) {
  return (
    <div className={PAGE}>
      <PageHeader variant="page" title="Governance settings" />
      <DepartmentsSection />
      {children}
    </div>
  );
}

/** A whole number of days (or days late / before due) with its label, (i) and error. A read-only person sees the number and cannot change it. */
function DaysField({ id, label, hint, unit = 'days', value, onChange, error, min, max, readOnly }: {
  id: string; label: string; hint?: string; unit?: string; value: number; onChange: (n: number) => void; error?: string; min: number; max: number; readOnly: boolean;
}) {
  return (
    <FormField id={id} label={label} info={hint} error={error}>
      <div className="flex items-center gap-[8px]">
        <TextInput type="number" inputMode="numeric" min={min} max={max} step={1} readOnly={readOnly} className="w-[88px] shrink-0"
          value={Number.isFinite(value) ? value : ''} onChange={(e) => onChange(e.target.value === '' ? Number.NaN : Number(e.target.value))} />
        <span className="min-w-0 text-ds-body text-ds-fg-muted">{unit}</span>
      </div>
    </FormField>
  );
}

const lowerFirst = (t: string) => t.charAt(0).toLowerCase() + t.slice(1);
const plural = (n: number) => `day${n === 1 ? '' : 's'}`;

// ── the page ─────────────────────────────────────────────────────────────────
export default function GovernanceSettingsPage() {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<GovernanceSettings | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [previewKind, setPreviewKind] = useState<Kind>('acknowledgement');
  const lastField = useRef<'task_title' | 'task_description'>('task_description');
  const fieldRefs = { task_title: useRef<HTMLInputElement>(null), task_description: useRef<HTMLTextAreaElement>(null) };

  const { data, isLoading, isError, error, refetch } = useQuery<SettingsAnswer>({
    queryKey: SETTINGS_KEY, queryFn: async () => (await apiClient.get(SETTINGS_URL)).data, retry: retrySettings,
  });
  useAdminDepartments();                               // asked together with the settings, so the Departments card below is not waiting for them

  const saved = data?.settings;
  const s = draft ?? saved;
  const patch = saved && draft ? changes(saved, draft) : {};
  const dirty = Object.keys(patch).length > 0;
  const errors = s ? validate(s) : {};
  const invalid = Object.keys(errors).length > 0;
  const canEdit = !!data?.can_edit;
  const ro = !canEdit;

  useEffect(() => {                                    // leaving with unsaved changes asks first
    if (!dirty) return undefined;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  useEffect(() => {
    if (!savedAt) return undefined;
    const t = window.setTimeout(() => setSavedAt(null), 4000);
    return () => window.clearTimeout(t);
  }, [savedAt]);

  // The confirmation is said only after the server has answered; a refusal stays on screen (with Retry when trying again can help) and is also
  // the line of the save bar. (The one toast line carries what the toast used to say in two.)
  const save = useReportedMutation({
    mutationFn: async () => (await apiClient.put(SETTINGS_URL, patch)).data as SettingsAnswer,
    success: 'Settings saved. New requests, reminders and escalations use them from now on.',
    failure: 'Not saved',
    onSuccess: (answer) => {
      queryClient.setQueryData(SETTINGS_KEY, answer);
      setDraft(null);
      setServerError(null);
      setSavedAt(Date.now());
    },
    onError: (e) => setServerError(errorMessage(e, 'The settings could not be saved. Try again.')),
  });

  if (isLoading) {
    return (
      <div className={PAGE}>
        <PageHeader variant="page" title="Governance settings" />
        <div className="rounded-ds-card border border-ds-border bg-ds-surface p-[16px]"><SkeletonLines lines={5} label="Loading the settings" /></div>
      </div>
    );
  }
  if (noAccess(error)) {
    return (
      <EmptyState kind="firstUse" icon={Lock} title="No access" className="mx-auto max-w-sm"
        info="Only an administrator or someone with a governance right can see these settings." />
    );
  }
  if (isError || !data) {
    return (
      <WithDepartments>
        <ErrorState title="Could not load the settings" onRetry={() => { void refetch(); }} />
      </WithDepartments>
    );
  }
  if (!data.enabled || !s || !saved) {
    return (
      <WithDepartments>
        <EmptyState kind="firstUse" icon={Info} title="Approvals are not switched on"
          info="Document approvals and acknowledgements are not switched on for this organisation. These settings apply once they are." />
      </WithDepartments>
    );
  }

  const set = (p: Partial<GovernanceSettings>) => { setDraft({ ...s, ...p }); setServerError(null); };
  const setMap = <K extends 'notify' | 'task_create' | 'task_priority'>(key: K, name: string, value: GovernanceSettings[K][keyof GovernanceSettings[K]]) =>
    set({ [key]: { ...s[key], [name]: value } } as Partial<GovernanceSettings>);
  const atDefaults = !!data.defaults && Object.keys(changes(data.defaults, s)).length === 0;
  const insert = (token: string) => {
    const key = lastField.current;
    const el = fieldRefs[key].current;
    const text = s[key];
    const at = el && document.activeElement === el ? el.selectionStart ?? text.length : text.length;
    set({ [key]: text.slice(0, at) + token + text.slice(at) } as Partial<GovernanceSettings>);
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(at + token.length, at + token.length); });
  };
  const roleName = data.roles?.find((r) => r.id === s.escalate_role_id)?.name ?? data.escalate_role_name ?? null;
  const further = s.escalate_role_id ? `role ${roleName || 'chosen'}` : 'administrators';
  const course = courseOf('review', s);
  const values = sampleValues(previewKind, s);
  // the Reminders' (i): what it does, and today's example (not shown while one of its numbers is wrong)
  const reminderNote = 'Sent to the person asked until they have done it.' + (errors.review_days || errors.remind_days ? ''
    : ` Example: a review asked today is due on ${course.due}. ${course.firstReminder ? `The reviewer is reminded on ${course.firstReminder}` : 'There is no reminder before the due date'}`
      + (s.remind_every_days > 0 ? `, then every ${s.remind_every_days} ${plural(s.remind_every_days)} until it is done.` : '.'));

  return (
    <div className={`${PAGE} pb-24`}>
      <PageHeader
        variant="page"
        title="Governance settings"
        info="How long people have to review, approve and acknowledge documents, who is reminded and told when it is late, and the task each person gets. They apply to the whole organisation."
        meta={ro ? (
          <span className="inline-flex items-center gap-[6px]">
            <Lock size={14} aria-hidden /> View only
            <InfoTip text="Only an administrator, or someone given the Governance Settings right, can change them." label="Why these settings are view only" />
          </span>
        ) : undefined}
        actions={canEdit ? (
          <Button leftIcon={<RotateCcw aria-hidden />} onClick={() => data.defaults && set(data.defaults)} disabled={atDefaults}
            title="Puts the default settings in the form; nothing changes until you save">
            Reset to defaults
          </Button>
        ) : undefined}
      />

      <DepartmentsSection />

      <SectionCard id="due" title="Due dates" info="How many days each person has, counted from the day they are asked.">
        <div className={FIELDS}>
          <DaysField id="review_days" label="Review" value={s.review_days} min={1} max={365} readOnly={ro} error={errors.review_days}
            onChange={(n) => set({ review_days: n })} hint="For each reviewer." />
          <DaysField id="approval_days" label="Approval" value={s.approval_days} min={1} max={365} readOnly={ro} error={errors.approval_days}
            onChange={(n) => set({ approval_days: n })} hint="For each approver, once the review is done." />
          <DaysField id="ack_days" label="Acknowledgement" value={s.ack_days} min={1} max={365} readOnly={ro} error={errors.ack_days}
            onChange={(n) => set({ ack_days: n })}
            hint="For everyone, once it is published. A new major version (2.0, 3.0) asks everyone again; a minor version (1.1) does not. That is the organisation's policy and is not changed here." />
        </div>
      </SectionCard>

      {s.four_eyes !== undefined && (
        <SectionCard id="approvals" title="Approvals"
          info="Documents go through their reviewers and approvers in turn; anyone whose turn it is can ask for changes, which waits for the author to make them and resubmit.">
          <div className="flex flex-wrap items-center gap-x-[4px] gap-y-[4px]">
            <Checkbox label="Four-eyes approval" checked={s.four_eyes} disabled={!data.can_four_eyes} onChange={(e) => set({ four_eyes: e.target.checked })} />
            <InfoTip text="The person who wrote a document is not asked at an approval stage and cannot approve it; another approver does." label="About four-eyes approval" />
            {!data.can_four_eyes && (
              <span className="ml-[8px] inline-flex items-center gap-[4px] text-ds-label text-ds-fg-muted"><Lock size={12} aria-hidden /> Administrators only</span>
            )}
          </div>
        </SectionCard>
      )}

      <SectionCard id="reminders" title="Reminders" info={reminderNote}>
        <div className={FIELDS}>
          <DaysField id="remind_days" label="First reminder" unit="days before due" value={s.remind_days} min={0} max={60} readOnly={ro} error={errors.remind_days}
            onChange={(n) => set({ remind_days: n })} hint="0: no reminder before the due date." />
          <DaysField id="remind_every_days" label="Repeat every" value={s.remind_every_days} min={0} max={60} readOnly={ro} error={errors.remind_every_days}
            onChange={(n) => set({ remind_every_days: n })} hint="0: remind once. Repeats go on after the due date, until it is done." />
        </div>
      </SectionCard>

      <SectionCard id="escalation" title="Escalation" info="When a request is late. The person asked is told on the day it becomes overdue.">
        <div className={FIELDS}>
          <DaysField id="owner_after_days" label="Tell owner after" unit="days late" value={s.owner_after_days} min={0} max={365} readOnly={ro} error={errors.owner_after_days}
            onChange={(n) => set({ owner_after_days: n })} hint="Days overdue. 0: the day it becomes overdue." />
          <DaysField id="admin_after_days" label="Escalate after" unit="days late" value={s.admin_after_days} min={1} max={365} readOnly={ro} error={errors.admin_after_days}
            onChange={(n) => set({ admin_after_days: n })} hint="Days overdue, later than the owner." />
          <FormField id="escalate_to" label="Escalate to" info="A role with nobody active in it falls back to the administrators.">
            {canEdit ? (
              <Select value={s.escalate_role_id ?? ''} onChange={(e) => set({ escalate_role_id: e.target.value ? Number(e.target.value) : null })}>
                <option value="">Administrators</option>
                {(data.roles ?? []).map((r) => <option key={r.id} value={r.id}>Role: {r.name}</option>)}
              </Select>
            ) : (
              <TextInput readOnly value={s.escalate_role_id ? `Role: ${roleName || 'a chosen role'}` : 'Administrators'} />
            )}
          </FormField>
        </div>
        <ol aria-label="What happens when a request is late" className="mt-[12px] flex flex-wrap items-center gap-x-[6px] gap-y-[8px] text-ds-label font-normal text-ds-fg-body">
          {[`Due date: person told`,
            s.owner_after_days ? `${s.owner_after_days} ${plural(s.owner_after_days)} late: owner` : 'Same day: owner',
            `${Number.isFinite(s.admin_after_days) ? s.admin_after_days : '?'} ${plural(s.admin_after_days)} late: ${further}`].map((step, i, all) => (
            <li key={step} className="flex items-center gap-[6px]">
              <span className="rounded-full border border-ds-border-strong bg-ds-surface-subtle px-[10px] py-[3px]">{step}</span>
              {i < all.length - 1 && <ChevronRight size={14} aria-hidden className="text-ds-fg-muted" />}
            </li>
          ))}
        </ol>
      </SectionCard>

      <SectionCard id="notifications" title="Notifications" info="Where each alert goes. Email is sent only where the organisation's email is set up.">
        <ul className="divide-y divide-ds-border rounded-ds-card border border-ds-border">
          {EVENTS.map((ev) => (
            <li key={ev.key} className="flex flex-col gap-[8px] px-[12px] py-[8px] sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 items-center gap-[4px]">
                <span className="text-ds-body font-[500] text-ds-fg">{ev.label}</span>
                <InfoTip text={`Goes to ${lowerFirst(ev.who)}.`} label={`Who gets: ${ev.label}`} />
              </div>
              <SegmentedControl label={`${ev.label}: where it goes`} name={`notify-${ev.key}`} options={CHANNEL_OPTIONS} value={s.notify[ev.key]} disabled={ro}
                onChange={(c: Channel) => setMap('notify', ev.key, c)} className="self-start sm:self-auto" />
            </li>
          ))}
        </ul>
        {Object.values(s.notify).every((c) => c === 'off') && (
          <p className="mt-[8px] text-ds-label font-normal text-ds-warning">All alerts are off: people see requests only in their tasks and on Approvals.</p>
        )}
      </SectionCard>

      <SectionCard id="tasks" title="Task creation"
        info="Each request can also become a task in Task Management, assigned to the person, due on the request's due date, with a button that opens their step in the document. It closes by itself when they do it there; its person, due date and status follow the request, and only an administrator can delete it.">
        <TableFrame aria-label="Task creation for each kind of request">
          {/* min-w: below it the frame scrolls sideways (on a phone) and the words stay whole */}
          <Table caption="Task creation for each kind of request" className="min-w-[520px]">
            <THead>
              <Tr>
                <Th>Request</Th>
                <Th>Make a task</Th>
                <Th>Priority</Th>
                <Th>Due in</Th>
              </Tr>
            </THead>
            <TBody>
              {shownKinds(s).map((k) => (
                <Tr key={k}>
                  <RowHeaderCell id={`task-kind-${k}`} className="font-normal">{KIND_LABEL[k]}</RowHeaderCell>
                  <Td>
                    <Checkbox label={s.task_create[k] ? 'Yes' : 'No'} checked={s.task_create[k]} disabled={ro} aria-describedby={`task-kind-${k}`}
                      onChange={(e) => setMap('task_create', k, e.target.checked)} />
                  </Td>
                  <Td>
                    <Select aria-label={`${KIND_LABEL[k]} task priority`} value={s.task_priority[k]} disabled={ro || !s.task_create[k]} className="w-[120px]"
                      onChange={(e) => setMap('task_priority', k, e.target.value as Priority)}>
                      {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
                    </Select>
                  </Td>
                  <Td>
                    {/* the request's own due date: the days are set once, under Due dates (a proposed change's are not set there) */}
                    {k === 'decide' || k === 'revise' ? (
                      <span className="whitespace-nowrap" title="Days from when the change was proposed or not accepted">{daysFor(k, s)} days</span>
                    ) : (
                      <a href="#due" className="inline-flex min-h-[24px] items-center whitespace-nowrap text-ds-primary-text underline-offset-[2px] hover:underline"
                        title="Days from when the person is asked. Change them under Due dates">
                        {daysFor(k, s) || '?'} days
                      </a>
                    )}
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        </TableFrame>

        <div className="mt-[16px] grid gap-[16px] lg:grid-cols-2">
          <div className="flex min-w-0 flex-col gap-[12px]">
            <FormField id="task_title" label="Task title" error={errors.task_title}>
              <TextInput ref={fieldRefs.task_title} value={s.task_title} readOnly={ro} maxLength={200}
                onFocus={() => { lastField.current = 'task_title'; }} onChange={(e) => set({ task_title: e.target.value })} />
            </FormField>
            <FormField id="task_description" label="Task description" error={errors.task_description}>
              <Textarea ref={fieldRefs.task_description} value={s.task_description} readOnly={ro} rows={4} maxLength={2000}
                onFocus={() => { lastField.current = 'task_description'; }} onChange={(e) => set({ task_description: e.target.value })} />
            </FormField>
            <FormField id="task_category" label="Task category" info="How Task Management files these tasks. Pick one or type your own." error={errors.task_category}>
              <TextInput list="task_category-list" value={s.task_category ?? ''} readOnly={ro} maxLength={100} className="sm:w-[256px]"
                onChange={(e) => set({ task_category: e.target.value })} />
              <datalist id="task_category-list">{TASK_CATEGORIES.map((c) => <option key={c} value={c} />)}</datalist>
            </FormField>
            {canEdit && (
              <div>
                <div className="flex items-center gap-[4px]">
                  <span className="text-ds-label text-ds-fg-muted">Placeholders</span>
                  <InfoTip text="Click one to insert it where the cursor is." label="About placeholders" />
                </div>
                <div className="mt-[4px] flex flex-wrap gap-[6px]">
                  {PLACEHOLDERS.map((p) => (
                    <Button key={p.key} size="sm" className="font-mono" title={`Insert {${p.key}}: ${p.label}`} aria-label={`Insert {${p.key}}: ${p.label}`}
                      onMouseDown={(e) => e.preventDefault()} onClick={() => insert(`{${p.key}}`)}>
                      {`{${p.key}}`}
                    </Button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="min-w-0">
            <div className="flex flex-wrap items-center justify-between gap-[8px]">
              <div className="flex items-center gap-[4px]">
                <span className="text-ds-label text-ds-fg">Preview</span>
                <InfoTip text={`Filled with sample values: a document called “${values.document}”, version ${values.version}, owner ${values.owner}.`} label="About the preview" />
              </div>
              <SegmentedControl label="Preview the task for" name="preview-kind" value={previewKind} onChange={(k: Kind) => setPreviewKind(k)}
                options={shownKinds(s).map((k) => ({ value: k, label: KIND_LABEL[k] }))} />
            </div>
            <div aria-live="polite" className="mt-[8px] rounded-ds-card border border-ds-border-strong bg-ds-surface-subtle p-[12px]">
              {s.task_create[previewKind] ? (
                <>
                  <div className="flex flex-wrap items-start justify-between gap-[8px]">
                    <p className="min-w-0 break-words text-ds-section text-ds-fg">{errors.task_title ? '—' : renderTemplate(s.task_title, values).slice(0, 255)}</p>
                    <StatusPill size="sm" className="shrink-0" {...statusPill(priorityStatus, s.task_priority[previewKind])} />
                  </div>
                  <p className="mt-[4px] text-ds-label font-normal text-ds-fg-muted">{s.task_category?.trim() || '—'} · due {values.due_date}</p>
                  <p className="mt-[8px] whitespace-pre-wrap break-words text-ds-body text-ds-fg-body">{errors.task_description ? '—' : renderTemplate(s.task_description, values)}</p>
                  {/* the buttons the task shows in Task Management (not links here) */}
                  <div role="group" aria-label="Buttons on the task" className="mt-[12px] flex flex-wrap gap-[8px]">
                    <span className="inline-flex items-center gap-[6px] rounded-ds-control bg-ds-primary px-[10px] py-[4px] text-ds-label font-[600] text-ds-on-primary"><PenLine size={12} aria-hidden /> {STEP_LABEL[previewKind]}</span>
                    <span className="inline-flex items-center gap-[6px] rounded-ds-control border border-ds-border-strong bg-ds-surface px-[10px] py-[4px] text-ds-label text-ds-fg-body"><ArrowUpRight size={12} aria-hidden /> Open document</span>
                  </div>
                </>
              ) : (
                <p className="flex items-center gap-[4px] text-ds-body text-ds-fg-muted">
                  No task is made for this request
                  <InfoTip text="People still get the alerts above and see the request on the Approvals page." label="What people still get" />
                </p>
              )}
            </div>
          </div>
        </div>
      </SectionCard>

      <SaveBar label="Save the settings" canEdit={canEdit} dirty={dirty} invalid={invalid} saving={save.isPending} justSaved={savedAt !== null} error={serverError}
        onSave={() => save.mutate()} onDiscard={() => { setDraft(null); setServerError(null); }} />
    </div>
  );
}
