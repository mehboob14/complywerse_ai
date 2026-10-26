'use client';

// Governance > Settings: the organisation's departments (the same records as Administration → Departments; added, edited and
// deactivated here: _DepartmentsSection.tsx), then how long people have to review, approve and acknowledge documents, reminders,
// escalation, where each alert goes and the Task Management task made for each request. The lifecycle settings are one
// organisation-wide source (the document page's "Due dates and escalation" shows a summary and links here). Administrators and
// holders of governance:settings:edit change them; anyone with a governance right reads them, nobody else. Helpers and rules:
// lib/governanceSettings.ts; backend: modules/governance/doc_lifecycle.py.
// The page prints labels, not sentences: what a field used to explain in a line is an (i) next to it (InfoTip).
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowUpRight, Check, ChevronRight, Info, Loader2, Lock, PenLine, RotateCcw } from 'lucide-react';
import { clsx } from 'clsx';
import apiClient from '@/lib/api';
import { PageLoader } from '@/components/ui';
import { useToast } from '@/components/ui/ToastProvider';
import { InfoTip } from '@/components/ui/InfoTip';
import { DocPageHeader } from '@/components/governance/DocPageHeader';
import { BTN, BTN_PRIMARY } from '@/components/governance/docUi';
import { useAdminDepartments } from '@/components/admin/DepartmentForm';
import {
  CHANNELS, EVENTS, KIND_LABEL, PLACEHOLDERS, PRIORITIES, STEP_LABEL, changes, courseOf, daysFor, noAccess, renderTemplate, retrySettings, sampleValues, shownKinds, validate,
  type Channel, type GovernanceSettings, type Kind, type Priority, type SettingsAnswer,
} from '@/lib/governanceSettings';
import { DepartmentsSection } from './_DepartmentsSection';
import { Section } from './_Section';

const SETTINGS_KEY = ['document-lifecycle-settings'];       // shared with the document page's summary card
const SETTINGS_URL = '/governance/documents/lifecycle/settings';

// (bg-[#fff], not bg-white: the platform CSS forces bg-white and would paint the disabled field white too)
const INPUT = 'rounded-lg border bg-[#fff] px-2.5 py-1.5 text-sm text-[#1f2933] focus:border-[#0f766e] focus:outline-none focus:ring-2 focus:ring-[#0f766e]/25 disabled:bg-[#f4f6f8] disabled:text-[#586472]';
// Task Management's categories (tasks/page.tsx) and the ones the document and committee tasks have used; any other may be typed
const TASK_CATEGORIES = ['Compliance', 'Governance', 'Review', 'Remediation', 'Implementation', 'Reporting', 'Other'];
const LABEL = 'text-[13px] font-medium text-[#26323d]';
const EMPTY = 'mx-auto flex max-w-sm flex-col items-center gap-2 rounded-xl border border-[#d5dbe1] bg-[#fff] px-4 py-8 text-center';

// ── small pieces ─────────────────────────────────────────────────────────────
/** The page when the lifecycle settings cannot be shown (they did not load, or approvals are not switched on): the departments,
 *  which do not depend on them, still can. */
function WithDepartments({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto max-w-4xl space-y-3">
      <DocPageHeader title="Governance settings" />
      <DepartmentsSection />
      {children}
    </div>
  );
}

// From the sm breakpoint up the fields sit three across: the note of the one in the last column opens leftwards, so it stays on screen
// (the InfoTip is not portalled; below sm the fields are stacked and every note opens to the right as usual).
const LAST_COLUMN = 'sm:[&>[role=tooltip]]:left-auto sm:[&>[role=tooltip]]:right-0';

/** A label with its (i). `last`: it is in the last of the three columns. */
function FieldLabel({ htmlFor, label, hint, last }: { htmlFor?: string; label: string; hint?: string; last?: boolean }) {
  return (
    <div className="flex items-center gap-1">
      <label htmlFor={htmlFor} className={LABEL}>{label}</label>
      {hint && <InfoTip text={hint} label={`About ${label.toLowerCase()}`} className={last ? LAST_COLUMN : ''} />}
    </div>
  );
}

function DaysField({ id, label, hint, unit = 'days', value, onChange, error, min, max, disabled, last }: {
  id: string; label: string; hint?: string; unit?: string; value: number; onChange: (n: number) => void; error?: string; min: number; max: number; disabled: boolean; last?: boolean;
}) {
  return (
    <div className="min-w-0">
      <FieldLabel htmlFor={id} label={label} hint={hint} last={last} />
      <div className="mt-1 flex items-center gap-2">
        <input id={id} type="number" inputMode="numeric" min={min} max={max} step={1} disabled={disabled}
          value={Number.isFinite(value) ? value : ''} aria-invalid={!!error} aria-describedby={error ? `${id}-err` : undefined}
          onChange={(e) => onChange(e.target.value === '' ? Number.NaN : Number(e.target.value))}
          className={clsx(INPUT, 'w-20 text-right', error ? 'border-[#b42318]' : 'border-[#d5dbe1]')} />
        <span className="text-[13px] text-[#586472]">{unit}</span>
      </div>
      {error && <p id={`${id}-err`} className="mt-1 max-w-[16rem] text-[12px] leading-4 text-[#b42318]">{error}</p>}
    </div>
  );
}

function ChannelPicker({ name, label, value, onChange, disabled }: { name: string; label: string; value: Channel; onChange: (c: Channel) => void; disabled: boolean }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex shrink-0 self-start rounded-lg border border-[#d5dbe1] bg-[#fff] p-0.5 sm:self-auto">
      {CHANNELS.map((c) => (
        <label key={c.value} className="relative">
          <input type="radio" name={name} value={c.value} checked={value === c.value} disabled={disabled} onChange={() => onChange(c.value)} className="peer sr-only" />
          <span className={clsx('block select-none rounded-md px-2.5 py-1 text-[12px] font-medium text-[#586472] peer-focus-visible:ring-2 peer-focus-visible:ring-[#0f766e]/40',
            disabled ? 'cursor-default' : 'cursor-pointer hover:text-[#1f2933]',
            c.value === 'off' ? 'peer-checked:bg-[#eef1f4] peer-checked:text-[#26323d]' : 'peer-checked:bg-[#0f766e] peer-checked:text-[#fff]')}>
            {c.label}
          </span>
        </label>
      ))}
    </div>
  );
}

const lowerFirst = (t: string) => t.charAt(0).toLowerCase() + t.slice(1);
const plural = (n: number) => `day${n === 1 ? '' : 's'}`;

// ── the page ─────────────────────────────────────────────────────────────────
export default function GovernanceSettingsPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
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

  const save = useMutation({
    mutationFn: async () => (await apiClient.put(SETTINGS_URL, patch)).data as SettingsAnswer,
    onSuccess: (answer) => {
      queryClient.setQueryData(SETTINGS_KEY, answer);
      setDraft(null);
      setServerError(null);
      setSavedAt(Date.now());
      toast({ type: 'success', title: 'Settings saved', message: 'New requests, reminders and escalations use them from now on.' });
    },
    onError: (e: any) => {
      const detail = e?.response?.data?.detail;
      const message = typeof detail === 'string' ? detail : 'The settings could not be saved. Try again.';
      setServerError(message);
      toast({ type: 'error', title: 'Not saved', message });
    },
  });

  if (isLoading) return <PageLoader size="sm" className="h-60" />;
  if (noAccess(error)) {
    return (
      <div className={EMPTY}>
        <Lock className="h-8 w-8 text-[#9aa5b1]" strokeWidth={1.5} aria-hidden />
        <p className="flex items-center gap-1 text-[15px] font-semibold text-[#1f2933]">
          No access <InfoTip text="Only an administrator or someone with a governance right can see these settings." label="Who can see the settings" />
        </p>
      </div>
    );
  }
  if (isError || !data) {
    return (
      <WithDepartments>
        <div className={EMPTY}>
          <AlertTriangle className="h-8 w-8 text-[#b42318]" strokeWidth={1.5} aria-hidden />
          <p className="text-[15px] font-semibold text-[#1f2933]">Could not load the settings</p>
          <button type="button" onClick={() => refetch()} className={BTN}>Try again</button>
        </div>
      </WithDepartments>
    );
  }
  if (!data.enabled || !s || !saved) {
    return (
      <WithDepartments>
        <div className={EMPTY}>
          <Info className="h-8 w-8 text-[#9aa5b1]" strokeWidth={1.5} aria-hidden />
          <p className="flex items-center gap-1 text-[15px] font-semibold text-[#1f2933]">
            Approvals are not switched on
            <InfoTip text="Document approvals and acknowledgements are not switched on for this organisation. These settings apply once they are." label="Why there are no settings" />
          </p>
        </div>
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
    <div className="mx-auto max-w-4xl space-y-3 pb-24">
      <DocPageHeader
        title="Governance settings"
        info="How long people have to review, approve and acknowledge documents, who is reminded and told when it is late, and the task each person gets. They apply to the whole organisation."
        meta={ro ? (
          <span className="inline-flex items-center gap-1.5">
            <Lock size={13} aria-hidden /> View only
            <InfoTip text="Only an administrator, or someone given the Governance Settings right, can change them." label="Why these settings are view only" />
          </span>
        ) : undefined}
        actions={canEdit ? (
          <button type="button" onClick={() => data.defaults && set(data.defaults)} disabled={atDefaults} className={BTN}
            title="Puts the default settings in the form; nothing changes until you save">
            <RotateCcw size={14} aria-hidden /> Reset to defaults
          </button>
        ) : undefined}
      />

      <DepartmentsSection />

      <Section id="due" title="Due dates" info="How many days each person has, counted from the day they are asked.">
        <div className="grid gap-x-4 gap-y-3 sm:grid-cols-3">
          <DaysField id="review_days" label="Review" value={s.review_days} min={1} max={365} disabled={ro} error={errors.review_days}
            onChange={(n) => set({ review_days: n })} hint="For each reviewer." />
          <DaysField id="approval_days" label="Approval" value={s.approval_days} min={1} max={365} disabled={ro} error={errors.approval_days}
            onChange={(n) => set({ approval_days: n })} hint="For each approver, once the review is done." />
          <DaysField id="ack_days" label="Acknowledgement" last value={s.ack_days} min={1} max={365} disabled={ro} error={errors.ack_days}
            onChange={(n) => set({ ack_days: n })}
            hint="For everyone, once it is published. A new major version (2.0, 3.0) asks everyone again; a minor version (1.1) does not. That is the organisation's policy and is not changed here." />
        </div>
      </Section>

      {s.four_eyes !== undefined && (
        <Section id="approvals" title="Approvals"
          info="Documents go through their reviewers and approvers in turn; anyone whose turn it is can ask for changes, which waits for the author to make them and resubmit.">
          <div className="flex flex-wrap items-center gap-x-1 gap-y-1">
            <label className={clsx(LABEL, 'inline-flex items-center gap-2')}>
              <input type="checkbox" checked={s.four_eyes} disabled={!data.can_four_eyes} onChange={(e) => set({ four_eyes: e.target.checked })}
                className="h-4 w-4 rounded border-[#b8c4c8] accent-[#0f766e]" />
              Four-eyes approval
            </label>
            <InfoTip text="The person who wrote a document is not asked at an approval stage and cannot approve it; another approver does." label="About four-eyes approval" />
            {!data.can_four_eyes && (
              <span className="ml-2 inline-flex items-center gap-1 text-[12px] text-[#586472]"><Lock size={12} aria-hidden /> Administrators only</span>
            )}
          </div>
        </Section>
      )}

      <Section id="reminders" title="Reminders" info={reminderNote}>
        <div className="grid gap-x-4 gap-y-3 sm:grid-cols-3">
          <DaysField id="remind_days" label="First reminder" unit="days before due" value={s.remind_days} min={0} max={60} disabled={ro} error={errors.remind_days}
            onChange={(n) => set({ remind_days: n })} hint="0: no reminder before the due date." />
          <DaysField id="remind_every_days" label="Repeat every" value={s.remind_every_days} min={0} max={60} disabled={ro} error={errors.remind_every_days}
            onChange={(n) => set({ remind_every_days: n })} hint="0: remind once. Repeats go on after the due date, until it is done." />
        </div>
      </Section>

      <Section id="escalation" title="Escalation" info="When a request is late. The person asked is told on the day it becomes overdue.">
        <div className="grid gap-x-4 gap-y-3 sm:grid-cols-3">
          <DaysField id="owner_after_days" label="Tell owner after" unit="days late" value={s.owner_after_days} min={0} max={365} disabled={ro} error={errors.owner_after_days}
            onChange={(n) => set({ owner_after_days: n })} hint="Days overdue. 0: the day it becomes overdue." />
          <DaysField id="admin_after_days" label="Escalate after" unit="days late" value={s.admin_after_days} min={1} max={365} disabled={ro} error={errors.admin_after_days}
            onChange={(n) => set({ admin_after_days: n })} hint="Days overdue, later than the owner." />
          <div className="min-w-0">
            <FieldLabel htmlFor="escalate_to" label="Escalate to" last hint="A role with nobody active in it falls back to the administrators." />
            {canEdit ? (
              <select id="escalate_to" value={s.escalate_role_id ?? ''} onChange={(e) => set({ escalate_role_id: e.target.value ? Number(e.target.value) : null })}
                className={clsx(INPUT, 'mt-1 w-full border-[#d5dbe1]')}>
                <option value="">Administrators</option>
                {(data.roles ?? []).map((r) => <option key={r.id} value={r.id}>Role: {r.name}</option>)}
              </select>
            ) : (
              <p id="escalate_to" className="mt-1 rounded-lg border border-[#d5dbe1] bg-[#f4f6f8] px-2.5 py-1.5 text-sm text-[#26323d]">
                {s.escalate_role_id ? `Role: ${roleName || 'a chosen role'}` : 'Administrators'}
              </p>
            )}
          </div>
        </div>
        <ol aria-label="What happens when a request is late" className="mt-3 flex flex-wrap items-center gap-x-1.5 gap-y-2 text-[12px] text-[#26323d]">
          {[`Due date: person told`,
            s.owner_after_days ? `${s.owner_after_days} ${plural(s.owner_after_days)} late: owner` : 'Same day: owner',
            `${Number.isFinite(s.admin_after_days) ? s.admin_after_days : '?'} ${plural(s.admin_after_days)} late: ${further}`].map((step, i, all) => (
            <li key={step} className="flex items-center gap-1.5">
              <span className="rounded-full border border-[#d5dbe1] bg-[#f4f6f8] px-2.5 py-1">{step}</span>
              {i < all.length - 1 && <ChevronRight size={14} className="text-[#7b8794]" aria-hidden />}
            </li>
          ))}
        </ol>
      </Section>

      <Section id="notifications" title="Notifications" info="Where each alert goes. Email is sent only where the organisation's email is set up.">
        <ul className="divide-y divide-[#e1e6eb] rounded-lg border border-[#e1e6eb]">
          {EVENTS.map((ev) => (
            <li key={ev.key} className="flex flex-col gap-2 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 items-center gap-1">
                <span className="text-[13px] font-medium text-[#1f2933]">{ev.label}</span>
                <InfoTip text={`Goes to ${lowerFirst(ev.who)}.`} label={`Who gets: ${ev.label}`} />
              </div>
              <ChannelPicker name={`notify-${ev.key}`} label={`${ev.label}: where it goes`} value={s.notify[ev.key]} disabled={ro}
                onChange={(c) => setMap('notify', ev.key, c)} />
            </li>
          ))}
        </ul>
        {Object.values(s.notify).every((c) => c === 'off') && (
          <p className="mt-2 text-[12px] text-[#9a3412]">All alerts are off: people see requests only in their tasks and on Approvals.</p>
        )}
      </Section>

      <Section id="tasks" title="Task creation"
        info="Each request can also become a task in Task Management, assigned to the person, due on the request's due date, with a button that opens their step in the document. It closes by itself when they do it there; its person, due date and status follow the request, and only an administrator can delete it.">
        <div className="overflow-x-auto rounded-lg border border-[#e1e6eb]">
          <table className="w-full text-left">
            <thead className="bg-[#f4f6f8]">
              <tr>
                <th scope="col" className="px-2 py-2 sm:px-3 text-[12px] font-semibold text-[#26323d]">Request</th>
                <th scope="col" className="px-2 py-2 sm:px-3 text-[12px] font-semibold text-[#26323d]">Make a task</th>
                <th scope="col" className="px-2 py-2 sm:px-3 text-[12px] font-semibold text-[#26323d]">Priority</th>
                <th scope="col" className="px-2 py-2 sm:px-3 text-[12px] font-semibold text-[#26323d]">Due in</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#e1e6eb]">
              {shownKinds(s).map((k) => (
                <tr key={k}>
                  <td className="px-2 py-2 sm:px-3 text-[13px] text-[#1f2933]">{KIND_LABEL[k]}</td>
                  <td className="px-2 py-2 sm:px-3">
                    <label className="inline-flex cursor-pointer items-center gap-2 text-[13px] text-[#26323d]">
                      <input type="checkbox" checked={s.task_create[k]} disabled={ro} onChange={(e) => setMap('task_create', k, e.target.checked)}
                        className="h-4 w-4 rounded border-[#7b8794] accent-[#0f766e]" />
                      {s.task_create[k] ? 'Yes' : 'No'}
                    </label>
                  </td>
                  <td className="px-2 py-2 sm:px-3">
                    <select aria-label={`${KIND_LABEL[k]} task priority`} value={s.task_priority[k]} disabled={ro || !s.task_create[k]}
                      onChange={(e) => setMap('task_priority', k, e.target.value as Priority)} className={clsx(INPUT, 'border-[#d5dbe1] py-1')}>
                      {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
                    </select>
                  </td>
                  <td className="px-2 py-2 sm:px-3 text-[12px] text-[#26323d]">
                    {/* the request's own due date: the days are set once, under Due dates (a proposed change's are not set there) */}
                    {k === 'decide' || k === 'revise' ? (
                      <span className="whitespace-nowrap" title="Days from when the change was proposed or not accepted">{daysFor(k, s)} days</span>
                    ) : (
                      <a href="#due" className="whitespace-nowrap text-[#0b6b58] underline-offset-2 hover:underline" title="Days from when the person is asked. Change them under Due dates">
                        {daysFor(k, s) || '?'} days
                      </a>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <div className="min-w-0 space-y-3">
            <div>
              <label htmlFor="task_title" className={LABEL}>Task title</label>
              <input id="task_title" ref={fieldRefs.task_title} value={s.task_title} disabled={ro} maxLength={200}
                onFocus={() => { lastField.current = 'task_title'; }} onChange={(e) => set({ task_title: e.target.value })}
                aria-invalid={!!errors.task_title} aria-describedby={errors.task_title ? 'task_title-err' : undefined}
                className={clsx(INPUT, 'mt-1 w-full', errors.task_title ? 'border-[#b42318]' : 'border-[#d5dbe1]')} />
              {errors.task_title && <p id="task_title-err" className="mt-1 text-[12px] text-[#b42318]">{errors.task_title}</p>}
            </div>
            <div>
              <label htmlFor="task_description" className={LABEL}>Task description</label>
              <textarea id="task_description" ref={fieldRefs.task_description} value={s.task_description} disabled={ro} rows={4} maxLength={2000}
                onFocus={() => { lastField.current = 'task_description'; }} onChange={(e) => set({ task_description: e.target.value })}
                aria-invalid={!!errors.task_description} aria-describedby={errors.task_description ? 'task_description-err' : undefined}
                className={clsx(INPUT, 'mt-1 w-full resize-y leading-5', errors.task_description ? 'border-[#b42318]' : 'border-[#d5dbe1]')} />
              {errors.task_description && <p id="task_description-err" className="mt-1 text-[12px] text-[#b42318]">{errors.task_description}</p>}
            </div>
            <div>
              <FieldLabel htmlFor="task_category" label="Task category" hint="How Task Management files these tasks. Pick one or type your own." />
              <input id="task_category" list="task_category-list" value={s.task_category ?? ''} disabled={ro} maxLength={100}
                onChange={(e) => set({ task_category: e.target.value })}
                aria-invalid={!!errors.task_category} aria-describedby={errors.task_category ? 'task_category-err' : undefined}
                className={clsx(INPUT, 'mt-1 w-full sm:w-64', errors.task_category ? 'border-[#b42318]' : 'border-[#d5dbe1]')} />
              <datalist id="task_category-list">{TASK_CATEGORIES.map((c) => <option key={c} value={c} />)}</datalist>
              {errors.task_category && <p id="task_category-err" className="mt-1 text-[12px] text-[#b42318]">{errors.task_category}</p>}
            </div>
            {canEdit && (
              <div>
                <div className="flex items-center gap-1">
                  <span className="text-[12px] font-medium text-[#586472]">Placeholders</span>
                  <InfoTip text="Click one to insert it where the cursor is." label="About placeholders" />
                </div>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {PLACEHOLDERS.map((p) => (
                    <button key={p.key} type="button" title={`Insert {${p.key}}: ${p.label}`} aria-label={`Insert {${p.key}}: ${p.label}`} onMouseDown={(e) => e.preventDefault()} onClick={() => insert(`{${p.key}}`)}
                      className="rounded-md border border-[#d5dbe1] bg-[#fff] px-2 py-0.5 font-mono !text-[12px] text-[#0b6b58] hover:border-[#0f766e] hover:bg-[#e6f4f1] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0f766e]/40">
                      {`{${p.key}}`}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="min-w-0">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1">
                <span className={LABEL}>Preview</span>
                <InfoTip text={`Filled with sample values: a document called “${values.document}”, version ${values.version}, owner ${values.owner}.`} label="About the preview" />
              </div>
              <div role="radiogroup" aria-label="Preview the task for" className="inline-flex rounded-lg border border-[#d5dbe1] bg-[#fff] p-0.5">
                {shownKinds(s).map((k) => (
                  <label key={k} className="relative">
                    <input type="radio" name="preview-kind" checked={previewKind === k} onChange={() => setPreviewKind(k)} className="peer sr-only" />
                    <span className="block cursor-pointer select-none rounded-md px-2 py-0.5 text-[12px] font-medium text-[#586472] hover:text-[#1f2933] peer-checked:bg-[#e6f4f1] peer-checked:text-[#0b6b58] peer-focus-visible:ring-2 peer-focus-visible:ring-[#0f766e]/40">
                      {KIND_LABEL[k]}
                    </span>
                  </label>
                ))}
              </div>
            </div>
            <div aria-live="polite" className="mt-2 rounded-lg border border-[#d5dbe1] bg-[#fafbfc] p-3">
              {s.task_create[previewKind] ? (
                <>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <p className="min-w-0 break-words text-[14px] font-semibold text-[#1f2933]">{errors.task_title ? '—' : renderTemplate(s.task_title, values).slice(0, 255)}</p>
                    <span className="shrink-0 rounded-full border border-[#d5dbe1] bg-[#fff] px-2 py-0.5 text-[11px] font-medium text-[#26323d]">{s.task_priority[previewKind]}</span>
                  </div>
                  <p className="mt-1 text-[12px] text-[#586472]">{s.task_category?.trim() || '—'} · due {values.due_date}</p>
                  <p className="mt-2 whitespace-pre-wrap break-words text-[13px] leading-5 text-[#26323d]">{errors.task_description ? '—' : renderTemplate(s.task_description, values)}</p>
                  {/* the buttons the task shows in Task Management (not links here) */}
                  <div className="mt-3 flex flex-wrap gap-2" aria-label="Buttons on the task">
                    <span className="inline-flex items-center gap-1.5 rounded-lg bg-[#0f766e] px-2.5 py-1 text-[12px] font-semibold text-[#fff]"><PenLine size={12} aria-hidden /> {STEP_LABEL[previewKind]}</span>
                    <span className="inline-flex items-center gap-1.5 rounded-lg border border-[#d5dbe1] bg-[#fff] px-2.5 py-1 text-[12px] font-medium text-[#26323d]"><ArrowUpRight size={12} aria-hidden /> Open document</span>
                  </div>
                </>
              ) : (
                <p className="flex items-center gap-1 text-[13px] text-[#586472]">
                  No task is made for this request
                  <InfoTip text="People still get the alerts above and see the request on the Approvals page." label="What people still get" />
                </p>
              )}
            </div>
          </div>
        </div>
      </Section>

      {canEdit && (dirty || savedAt || serverError) && (
        <div className="sticky bottom-3 z-10">
          <div role="region" aria-label="Save the settings"
            className="flex flex-col gap-2 rounded-xl border border-[#d5dbe1] bg-[#fff] px-4 py-2.5 shadow-card sm:flex-row sm:items-center sm:justify-between">
            <p className="text-[13px] text-[#26323d]" aria-live="polite">
              {serverError ? <span className="text-[#b42318]">{serverError}</span>
                : dirty ? (invalid ? <span className="text-[#b42318]">Fix the fields in red to save</span> : 'Unsaved changes')
                  : <span className="inline-flex items-center gap-1.5 text-[#0b6b58]"><Check size={14} aria-hidden /> Saved</span>}
            </p>
            {dirty && (
              <div className="flex shrink-0 gap-2">
                <button type="button" onClick={() => { setDraft(null); setServerError(null); }} disabled={save.isPending} className={BTN}>Discard</button>
                <button type="button" onClick={() => save.mutate()} disabled={save.isPending || invalid} className={BTN_PRIMARY}>
                  {save.isPending ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <Check size={14} aria-hidden />} Save
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
