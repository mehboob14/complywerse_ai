'use client';

// Governance > Settings: how long people have to review, approve and acknowledge documents, reminders, escalation, where each
// alert goes and the Task Management task made for each request. One organisation-wide source (the document page's "Due dates
// and escalation" shows a summary and links here). Administrators and holders of governance:settings:edit change it; everyone
// else reads it. Helpers and rules: lib/governanceSettings.ts; backend: modules/governance/doc_lifecycle.py.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlarmClock, AlertTriangle, ArrowUpRight, Bell, CalendarClock, Check, ChevronRight, Info, ListChecks, Loader2, Lock, Megaphone, PenLine, RotateCcw } from 'lucide-react';
import { clsx } from 'clsx';
import apiClient from '@/lib/api';
import { useToast } from '@/components/ui/ToastProvider';
import {
  CHANNELS, EVENTS, KIND_LABEL, KINDS, PLACEHOLDERS, PRIORITIES, STEP_LABEL, changes, courseOf, renderTemplate, sampleValues, validate,
  type Channel, type GovernanceSettings, type Kind, type Priority, type SettingsAnswer,
} from '@/lib/governanceSettings';

const SETTINGS_KEY = ['document-lifecycle-settings'];       // shared with the document page's summary card
const SETTINGS_URL = '/governance/documents/lifecycle/settings';

const INPUT = 'rounded-lg border bg-white px-2.5 py-1.5 text-sm text-[#1f2933] focus:border-[#0f766e] focus:outline-none focus:ring-2 focus:ring-[#0f766e]/25 disabled:bg-[#f4f6f8] disabled:text-[#586472]';
const BTN = 'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0f766e]/40 disabled:cursor-not-allowed disabled:opacity-50';
const PRIMARY = `${BTN} bg-[#0f766e] text-white hover:bg-[#0b6b58]`;
const SECONDARY = `${BTN} border border-[#d5dbe1] bg-white text-[#26323d] hover:bg-[#f4f6f8]`;
// Task Management's categories (tasks/page.tsx) and the ones the document and committee tasks have used; any other may be typed
const TASK_CATEGORIES = ['Compliance', 'Governance', 'Review', 'Remediation', 'Implementation', 'Reporting', 'Other'];

// ── small pieces ─────────────────────────────────────────────────────────────
function Section({ id, icon: Icon, title, hint, children }: { id: string; icon: typeof Info; title: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="scroll-mt-16 rounded-xl border border-[#d5dbe1] bg-white p-4 sm:p-5">
      <div className="mb-4 flex items-start gap-3">
        <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#e6f4f1] text-[#0f766e]"><Icon size={16} aria-hidden /></span>
        <div className="min-w-0">
          <h2 id={`${id}-h`} className="text-[15px] font-semibold text-[#1f2933]">{title}</h2>
          {hint && <p className="mt-0.5 text-[13px] leading-5 text-[#586472]">{hint}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

function DaysField({ id, label, hint, value, onChange, error, min, max, disabled }: {
  id: string; label: string; hint?: string; value: number; onChange: (n: number) => void; error?: string; min: number; max: number; disabled: boolean;
}) {
  const described = [hint && `${id}-hint`, error && `${id}-err`].filter(Boolean).join(' ') || undefined;
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="block text-[13px] font-medium text-[#26323d]">{label}</label>
      <div className="mt-1 flex items-center gap-2">
        <input id={id} type="number" inputMode="numeric" min={min} max={max} step={1} disabled={disabled}
          value={Number.isFinite(value) ? value : ''} aria-invalid={!!error} aria-describedby={described}
          onChange={(e) => onChange(e.target.value === '' ? Number.NaN : Number(e.target.value))}
          className={clsx(INPUT, 'w-24 text-right', error ? 'border-[#b42318]' : 'border-[#d5dbe1]')} />
        <span className="text-[13px] text-[#586472]">days</span>
      </div>
      {hint && <p id={`${id}-hint`} className="mt-1 text-[12px] leading-4 text-[#586472]">{hint}</p>}
      {error && <p id={`${id}-err`} className="mt-1 text-[12px] leading-4 text-[#b42318]">{error}</p>}
    </div>
  );
}

function ChannelPicker({ name, label, value, onChange, disabled }: { name: string; label: string; value: Channel; onChange: (c: Channel) => void; disabled: boolean }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex shrink-0 self-start rounded-lg border border-[#d5dbe1] bg-white p-0.5 sm:self-auto">
      {CHANNELS.map((c) => (
        <label key={c.value} className="relative">
          <input type="radio" name={name} value={c.value} checked={value === c.value} disabled={disabled} onChange={() => onChange(c.value)} className="peer sr-only" />
          <span className={clsx('block select-none rounded-md px-2.5 py-1 text-[12px] font-medium text-[#586472] peer-focus-visible:ring-2 peer-focus-visible:ring-[#0f766e]/40',
            disabled ? 'cursor-default' : 'cursor-pointer hover:text-[#1f2933]',
            c.value === 'off' ? 'peer-checked:bg-[#eef1f4] peer-checked:text-[#26323d]' : 'peer-checked:bg-[#0f766e] peer-checked:text-white')}>
            {c.label}
          </span>
        </label>
      ))}
    </div>
  );
}

function Note({ children }: { children: ReactNode }) {
  return (
    <p className="mt-3 flex items-start gap-2 rounded-lg bg-[#f4f6f8] px-3 py-2 text-[12px] leading-5 text-[#26323d]">
      <Info size={14} className="mt-0.5 shrink-0 text-[#0f766e]" aria-hidden /> <span>{children}</span>
    </p>
  );
}

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

  const { data, isLoading, isError, refetch } = useQuery<SettingsAnswer>({
    queryKey: SETTINGS_KEY, queryFn: async () => (await apiClient.get(SETTINGS_URL)).data,
  });

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

  if (isLoading) {
    return <div className="flex h-60 items-center justify-center" role="status"><Loader2 className="h-6 w-6 animate-spin text-[#0f766e]" aria-hidden /><span className="sr-only">Loading the settings</span></div>;
  }
  if (isError || !data) {
    return (
      <div className="mx-auto max-w-md rounded-xl border border-[#d5dbe1] bg-white p-6 text-center">
        <AlertTriangle className="mx-auto h-7 w-7 text-[#b42318]" aria-hidden />
        <p className="mt-2 text-sm font-medium text-[#1f2933]">The settings could not be loaded.</p>
        <button type="button" onClick={() => refetch()} className={clsx(SECONDARY, 'mt-3')}>Try again</button>
      </div>
    );
  }
  if (!data.enabled || !s || !saved) {
    return (
      <div className="mx-auto max-w-lg rounded-xl border border-[#d5dbe1] bg-white p-6 text-center">
        <Info className="mx-auto h-7 w-7 text-[#0f766e]" aria-hidden />
        <p className="mt-2 text-sm font-medium text-[#1f2933]">Document approvals and acknowledgements are not switched on for this organisation.</p>
        <p className="mt-1 text-[13px] text-[#586472]">These settings apply once they are.</p>
      </div>
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
  const further = s.escalate_role_id ? `the members of ${roleName || 'the chosen role'}` : 'the administrators';
  const course = courseOf('review', s);
  const values = sampleValues(previewKind, s);

  return (
    <div className="mx-auto max-w-4xl space-y-4 pb-24">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold text-[#1f2933] sm:text-xl">Governance settings</h1>
          <p className="mt-0.5 text-[13px] leading-5 text-[#586472]">
            How long people have to review, approve and acknowledge documents, who is reminded and told when it is late, and the task each person gets. They apply to the whole organisation.
          </p>
        </div>
        {canEdit && (
          <button type="button" onClick={() => data.defaults && set(data.defaults)} disabled={atDefaults} className={clsx(SECONDARY, 'shrink-0 self-start')}
            title="Puts the default settings in the form; nothing changes until you save">
            <RotateCcw size={14} aria-hidden /> Reset to defaults
          </button>
        )}
      </header>

      {ro && (
        <p className="flex items-start gap-2 rounded-lg border border-[#d5dbe1] bg-[#f4f6f8] px-3 py-2 text-[13px] text-[#26323d]">
          <Lock size={14} className="mt-0.5 shrink-0 text-[#586472]" aria-hidden />
          You can see these settings. Only an administrator, or someone given the Governance Settings right, can change them.
        </p>
      )}

      <Section id="due" icon={CalendarClock} title="Due dates" hint="How many days each person has, counted from the day they are asked.">
        <div className="grid gap-4 sm:grid-cols-3">
          <DaysField id="review_days" label="Review" value={s.review_days} min={1} max={365} disabled={ro} error={errors.review_days}
            onChange={(n) => set({ review_days: n })} hint="For each reviewer." />
          <DaysField id="approval_days" label="Approval" value={s.approval_days} min={1} max={365} disabled={ro} error={errors.approval_days}
            onChange={(n) => set({ approval_days: n })} hint="For each approver, once the review is done." />
          <DaysField id="ack_days" label="Acknowledgement" value={s.ack_days} min={1} max={365} disabled={ro} error={errors.ack_days}
            onChange={(n) => set({ ack_days: n })} hint="For everyone, once it is published." />
        </div>
        <Note>A new major version (2.0, 3.0) asks everyone to acknowledge again; a minor version (1.1) does not. That is the organisation&apos;s policy and is not changed here.</Note>
      </Section>

      <Section id="reminders" icon={AlarmClock} title="Reminders" hint="Sent to the person asked until they have done it.">
        <div className="grid gap-4 sm:grid-cols-2">
          <DaysField id="remind_days" label="First reminder, before the due date" value={s.remind_days} min={0} max={60} disabled={ro} error={errors.remind_days}
            onChange={(n) => set({ remind_days: n })} hint="0: no reminder before the due date." />
          <DaysField id="remind_every_days" label="Then remind again every" value={s.remind_every_days} min={0} max={60} disabled={ro} error={errors.remind_every_days}
            onChange={(n) => set({ remind_every_days: n })} hint="0: remind once. Repeats go on after the due date, until it is done." />
        </div>
        {!errors.review_days && !errors.remind_days && (
          <Note>
            Example: a review asked today is due on <b className="font-semibold">{course.due}</b>.{' '}
            {course.firstReminder ? <>The reviewer is reminded on <b className="font-semibold">{course.firstReminder}</b></> : <>There is no reminder before the due date</>}
            {s.remind_every_days > 0 ? <>, then every {s.remind_every_days} day{s.remind_every_days === 1 ? '' : 's'} until it is done.</> : <>.</>}
          </Note>
        )}
      </Section>

      <Section id="escalation" icon={Megaphone} title="Escalation" hint="When a request is late. The person asked is told on the day it becomes overdue.">
        <div className="grid gap-4 sm:grid-cols-3">
          <DaysField id="owner_after_days" label="Tell the document owner after" value={s.owner_after_days} min={0} max={365} disabled={ro} error={errors.owner_after_days}
            onChange={(n) => set({ owner_after_days: n })} hint="Days overdue. 0: the day it becomes overdue." />
          <DaysField id="admin_after_days" label="Then escalate after" value={s.admin_after_days} min={1} max={365} disabled={ro} error={errors.admin_after_days}
            onChange={(n) => set({ admin_after_days: n })} hint="Days overdue, later than the owner." />
          <div className="min-w-0">
            <label htmlFor="escalate_to" className="block text-[13px] font-medium text-[#26323d]">Escalate to</label>
            {canEdit ? (
              <select id="escalate_to" value={s.escalate_role_id ?? ''} onChange={(e) => set({ escalate_role_id: e.target.value ? Number(e.target.value) : null })}
                className={clsx(INPUT, 'mt-1 w-full border-[#d5dbe1]')}>
                <option value="">The administrators</option>
                {(data.roles ?? []).map((r) => <option key={r.id} value={r.id}>Role: {r.name}</option>)}
              </select>
            ) : (
              <p id="escalate_to" className="mt-1 rounded-lg border border-[#d5dbe1] bg-[#f4f6f8] px-2.5 py-1.5 text-sm text-[#26323d]">
                {s.escalate_role_id ? `Role: ${roleName || 'a chosen role'}` : 'The administrators'}
              </p>
            )}
            <p className="mt-1 text-[12px] leading-4 text-[#586472]">A role with nobody active in it falls back to the administrators.</p>
          </div>
        </div>
        <ol aria-label="What happens when a request is late" className="mt-4 flex flex-wrap items-center gap-x-1.5 gap-y-2 text-[12px] text-[#26323d]">
          {[`Due date: the person is told`,
            s.owner_after_days ? `${s.owner_after_days} day${s.owner_after_days === 1 ? '' : 's'} late: the owner` : 'Same day: the owner',
            `${Number.isFinite(s.admin_after_days) ? s.admin_after_days : '?'} day${s.admin_after_days === 1 ? '' : 's'} late: ${further}`].map((step, i, all) => (
            <li key={step} className="flex items-center gap-1.5">
              <span className="rounded-full border border-[#d5dbe1] bg-[#f4f6f8] px-2.5 py-1">{step}</span>
              {i < all.length - 1 && <ChevronRight size={14} className="text-[#7b8794]" aria-hidden />}
            </li>
          ))}
        </ol>
      </Section>

      <Section id="notifications" icon={Bell} title="Notifications" hint="Where each alert goes. Email is sent only where the organisation's email is set up.">
        <ul className="divide-y divide-[#e4e8ec] rounded-lg border border-[#e4e8ec]">
          {EVENTS.map((ev) => (
            <li key={ev.key} className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="text-[13px] font-medium text-[#1f2933]">{ev.label}</p>
                <p className="text-[12px] leading-4 text-[#586472]">{ev.who}</p>
              </div>
              <ChannelPicker name={`notify-${ev.key}`} label={`${ev.label}: where it goes`} value={s.notify[ev.key]} disabled={ro}
                onChange={(c) => setMap('notify', ev.key, c)} />
            </li>
          ))}
        </ul>
        {Object.values(s.notify).every((c) => c === 'off') && (
          <p className="mt-2 text-[12px] text-[#9a3412]">Every alert is off: people will only find their requests in their tasks and on the Approvals page.</p>
        )}
      </Section>

      <Section id="tasks" icon={ListChecks} title="Task creation"
        hint="Each request can also become a task in Task Management, assigned to the person, due on the request's due date, with a button that opens their step in the document. It closes by itself when they do it there; its person, due date and status follow the request, and only an administrator can delete it.">
        <div className="overflow-x-auto rounded-lg border border-[#e4e8ec]">
          <table className="w-full text-left">
            <thead className="bg-[#f4f6f8]">
              <tr>
                <th scope="col" className="px-2 py-2 sm:px-3 text-[12px] font-semibold text-[#26323d]">Request</th>
                <th scope="col" className="px-2 py-2 sm:px-3 text-[12px] font-semibold text-[#26323d]">Make a task</th>
                <th scope="col" className="px-2 py-2 sm:px-3 text-[12px] font-semibold text-[#26323d]">Priority</th>
                <th scope="col" className="px-2 py-2 sm:px-3 text-[12px] font-semibold text-[#26323d]">Due in</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#e4e8ec]">
              {KINDS.map((k) => (
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
                      onChange={(e) => setMap('task_priority', k, e.target.value as Priority)} className={clsx(INPUT, 'border-[#d5dbe1] py-1 text-[13px]')}>
                      {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
                    </select>
                  </td>
                  <td className="px-2 py-2 sm:px-3 text-[12px] text-[#26323d]">
                    {/* the request's own due date: the days are set once, under Due dates */}
                    <a href="#due" className="whitespace-nowrap text-[#0b6b58] underline-offset-2 hover:underline" title="Days from when the person is asked. Change them under Due dates">
                      {(k === 'acknowledgement' ? s.ack_days : k === 'review' ? s.review_days : s.approval_days) || '?'} days
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <div className="min-w-0 space-y-3">
            <div>
              <label htmlFor="task_title" className="block text-[13px] font-medium text-[#26323d]">Task title</label>
              <input id="task_title" ref={fieldRefs.task_title} value={s.task_title} disabled={ro} maxLength={200}
                onFocus={() => { lastField.current = 'task_title'; }} onChange={(e) => set({ task_title: e.target.value })}
                aria-invalid={!!errors.task_title} aria-describedby={errors.task_title ? 'task_title-err' : undefined}
                className={clsx(INPUT, 'mt-1 w-full', errors.task_title ? 'border-[#b42318]' : 'border-[#d5dbe1]')} />
              {errors.task_title && <p id="task_title-err" className="mt-1 text-[12px] text-[#b42318]">{errors.task_title}</p>}
            </div>
            <div>
              <label htmlFor="task_description" className="block text-[13px] font-medium text-[#26323d]">Task description</label>
              <textarea id="task_description" ref={fieldRefs.task_description} value={s.task_description} disabled={ro} rows={4} maxLength={2000}
                onFocus={() => { lastField.current = 'task_description'; }} onChange={(e) => set({ task_description: e.target.value })}
                aria-invalid={!!errors.task_description} aria-describedby={errors.task_description ? 'task_description-err' : undefined}
                className={clsx(INPUT, 'mt-1 w-full resize-y leading-5', errors.task_description ? 'border-[#b42318]' : 'border-[#d5dbe1]')} />
              {errors.task_description && <p id="task_description-err" className="mt-1 text-[12px] text-[#b42318]">{errors.task_description}</p>}
            </div>
            <div>
              <label htmlFor="task_category" className="block text-[13px] font-medium text-[#26323d]">Task category</label>
              <input id="task_category" list="task_category-list" value={s.task_category ?? ''} disabled={ro} maxLength={100}
                onChange={(e) => set({ task_category: e.target.value })}
                aria-invalid={!!errors.task_category} aria-describedby={errors.task_category ? 'task_category-err' : 'task_category-hint'}
                className={clsx(INPUT, 'mt-1 w-full sm:w-64', errors.task_category ? 'border-[#b42318]' : 'border-[#d5dbe1]')} />
              <datalist id="task_category-list">{TASK_CATEGORIES.map((c) => <option key={c} value={c} />)}</datalist>
              {errors.task_category ? <p id="task_category-err" className="mt-1 text-[12px] text-[#b42318]">{errors.task_category}</p>
                : <p id="task_category-hint" className="mt-1 text-[12px] text-[#586472]">How Task Management files these tasks. Pick one or type your own.</p>}
            </div>
            {canEdit && (
              <div>
                <p className="text-[12px] text-[#586472]">Insert where the cursor is:</p>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {PLACEHOLDERS.map((p) => (
                    <button key={p.key} type="button" title={`Insert {${p.key}}: ${p.label}`} aria-label={`Insert {${p.key}}: ${p.label}`} onMouseDown={(e) => e.preventDefault()} onClick={() => insert(`{${p.key}}`)}
                      className="rounded-md border border-[#d5dbe1] bg-white px-2 py-0.5 font-mono text-[12px] text-[#0b6b58] hover:border-[#0f766e] hover:bg-[#e6f4f1] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0f766e]/40">
                      {`{${p.key}}`}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="min-w-0">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-[13px] font-medium text-[#26323d]">Preview</p>
              <div role="radiogroup" aria-label="Preview the task for" className="inline-flex rounded-lg border border-[#d5dbe1] bg-white p-0.5">
                {KINDS.map((k) => (
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
                    <span className="shrink-0 rounded-full border border-[#d5dbe1] bg-white px-2 py-0.5 text-[11px] font-medium text-[#26323d]">{s.task_priority[previewKind]}</span>
                  </div>
                  <p className="mt-1 text-[12px] text-[#586472]">{s.task_category?.trim() || '—'} · due {values.due_date} · assigned to the person asked</p>
                  <p className="mt-2 whitespace-pre-wrap break-words text-[13px] leading-5 text-[#26323d]">{errors.task_description ? '—' : renderTemplate(s.task_description, values)}</p>
                  {/* the buttons the task shows in Task Management (not links here) */}
                  <div className="mt-3 flex flex-wrap gap-2" aria-label="Buttons on the task">
                    <span className="inline-flex items-center gap-1.5 rounded-lg bg-[#0f766e] px-2.5 py-1 text-[12px] font-semibold text-white"><PenLine size={12} aria-hidden /> {STEP_LABEL[previewKind]}</span>
                    <span className="inline-flex items-center gap-1.5 rounded-lg border border-[#d5dbe1] bg-white px-2.5 py-1 text-[12px] font-medium text-[#26323d]"><ArrowUpRight size={12} aria-hidden /> Open document</span>
                  </div>
                </>
              ) : (
                <p className="text-[13px] text-[#586472]">No task is made for {KIND_LABEL[previewKind].toLowerCase()} requests. People still get the alerts above and see the request on the Approvals page.</p>
              )}
            </div>
            <p className="mt-1.5 text-[12px] text-[#586472]">Sample values: a document called &ldquo;{values.document}&rdquo;, version {values.version}, owner {values.owner}.</p>
          </div>
        </div>
      </Section>

      {canEdit && (dirty || savedAt || serverError) && (
        <div className="sticky bottom-3 z-10">
          <div role="region" aria-label="Save the settings"
            className="flex flex-col gap-2 rounded-xl border border-[#d5dbe1] bg-white px-4 py-3 shadow-card sm:flex-row sm:items-center sm:justify-between">
            <p className="text-[13px] text-[#26323d]" aria-live="polite">
              {serverError ? <span className="text-[#b42318]">{serverError}</span>
                : dirty ? (invalid ? <span className="text-[#b42318]">Fix the fields marked in red to save.</span> : 'You have unsaved changes.')
                  : <span className="inline-flex items-center gap-1.5 text-[#0b6b58]"><Check size={14} aria-hidden /> Saved</span>}
            </p>
            {dirty && (
              <div className="flex shrink-0 gap-2">
                <button type="button" onClick={() => { setDraft(null); setServerError(null); }} disabled={save.isPending} className={SECONDARY}>Discard</button>
                <button type="button" onClick={() => save.mutate()} disabled={save.isPending || invalid} className={PRIMARY}>
                  {save.isPending ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <Check size={14} aria-hidden />} Save changes
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
