// Governance > Settings: the organisation's due dates, reminders, escalation, alert channels and task creation for document
// reviews, approvals and acknowledgements. Backend: modules/governance/doc_lifecycle.py (settings, save_settings) behind
// GET/PUT /governance/documents/lifecycle/settings. Pure helpers here (tested in governanceSettings.test.ts); the page is
// app/(dashboard)/governance/settings/page.tsx.

export type Kind = 'review' | 'approval' | 'acknowledgement';
export type GovEvent = 'request' | 'reminder' | 'overdue' | 'escalation' | 'approved' | 'published' | 'rejected';
export type Channel = 'in_app' | 'email' | 'both' | 'off';
export type Priority = 'Critical' | 'High' | 'Medium' | 'Low';

export interface GovernanceSettings {
  review_days: number;
  approval_days: number;
  ack_days: number;
  remind_days: number;
  remind_every_days: number;
  owner_after_days: number;
  admin_after_days: number;
  escalate_role_id: number | null;
  notify: Record<GovEvent, Channel>;
  task_create: Record<Kind, boolean>;
  task_priority: Record<Kind, Priority>;
  task_title: string;
  task_description: string;
  email: boolean;
}

export interface SettingsAnswer {
  enabled: boolean;
  settings: GovernanceSettings;
  can_edit: boolean;
  defaults?: GovernanceSettings;
  roles?: { id: number; name: string }[];
  escalate_role_name?: string | null;
}

export const KINDS: Kind[] = ['review', 'approval', 'acknowledgement'];
export const KIND_LABEL: Record<Kind, string> = { review: 'Review', approval: 'Approval', acknowledgement: 'Acknowledgement' };
export const ACTION: Record<Kind, string> = { review: 'Review', approval: 'Approve', acknowledgement: 'Acknowledge' };
export const PRIORITIES: Priority[] = ['Critical', 'High', 'Medium', 'Low'];
export const CHANNELS: { value: Channel; label: string }[] = [
  { value: 'in_app', label: 'In-app' }, { value: 'email', label: 'Email' }, { value: 'both', label: 'Both' }, { value: 'off', label: 'Off' },
];
export const EVENTS: { key: GovEvent; label: string; who: string }[] = [
  { key: 'request', label: 'Asked to review or approve', who: 'The reviewer or approver' },
  { key: 'reminder', label: 'Reminder', who: 'The person asked, before the due date and on repeats' },
  { key: 'overdue', label: 'Overdue', who: 'The person asked, once it is late' },
  { key: 'escalation', label: 'Escalation', who: 'The document owner, then the administrators or the chosen role' },
  { key: 'approved', label: 'Approved', who: 'The owner and whoever may publish it' },
  { key: 'published', label: 'Published, please acknowledge', who: 'Everyone asked to acknowledge (email: one list a day)' },
  { key: 'rejected', label: 'Rejected', who: 'The owner and the author' },
];

export const PLACEHOLDERS: { key: string; label: string }[] = [
  { key: 'action', label: 'Review, Approve or Acknowledge' },
  { key: 'document', label: 'Document title' },
  { key: 'version', label: 'Version' },
  { key: 'due_date', label: 'Due date' },
  { key: 'owner', label: 'Document owner' },
  { key: 'link', label: 'Address of the document in the app' },
];
const KNOWN = new Set(PLACEHOLDERS.map((p) => p.key));

/** The problem with a template, in the person's words, or null. Same rules as the server (doc_lifecycle._template_problem). */
export function templateProblem(label: string, text: string, max: number): string | null {
  const t = text.trim();
  if (!t) return `${label} cannot be empty.`;
  if (t.length > max) return `${label} is too long (at most ${max} characters).`;
  // {{ and }} are a literal brace; any other brace opens or closes a placeholder
  const re = /\{\{|\}\}|\{([^{}]*)\}|[{}]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(t))) {
    if (m[0] === '{{' || m[0] === '}}') continue;
    if (m[0] === '{' || m[0] === '}') return `${label}: a { or } is not closed. Placeholders look like {document}.`;
    if (!KNOWN.has(m[1])) return `${label}: {${m[1]}} is not a placeholder. Use ${PLACEHOLDERS.map((p) => `{${p.key}}`).join(', ')}.`;
  }
  return null;
}

/** A template with its placeholders filled (what the task will say). */
export function renderTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{|\}\}|\{([a-z_]+)\}/g, (all, key?: string) =>
    all === '{{' ? '{' : all === '}}' ? '}' : key && key in values ? values[key] : all);
}

const LIMITS: Partial<Record<keyof GovernanceSettings, [number, number, string]>> = {
  review_days: [1, 365, 'Days to review'],
  approval_days: [1, 365, 'Days to approve'],
  ack_days: [1, 365, 'Days to acknowledge'],
  remind_days: [0, 60, 'Days before the due date for the first reminder'],
  remind_every_days: [0, 60, 'Days between reminders'],
  owner_after_days: [0, 365, 'Days overdue before the owner is told'],
  admin_after_days: [1, 365, 'Days overdue before escalating further'],
};

/** Field -> message for everything the server would refuse, so Save can say what to fix before it is pressed. */
export function validate(s: GovernanceSettings): Partial<Record<keyof GovernanceSettings, string>> {
  const out: Partial<Record<keyof GovernanceSettings, string>> = {};
  for (const [key, [low, high, label]] of Object.entries(LIMITS) as [keyof GovernanceSettings, [number, number, string]][]) {
    const v = s[key] as unknown as number;
    if (typeof v !== 'number' || !Number.isInteger(v) || v < low || v > high) out[key] = `${label} must be a whole number from ${low} to ${high}.`;
  }
  if (!out.admin_after_days && !out.owner_after_days && s.admin_after_days <= s.owner_after_days) {
    out.admin_after_days = 'Escalate further later than the owner is told: make its days overdue larger.';
  }
  const title = templateProblem('Task title', s.task_title, 200);
  if (title) out.task_title = title;
  const description = templateProblem('Task description', s.task_description, 2000);
  if (description) out.task_description = description;
  return out;
}

/** Only what changed (a map whole), so a save never overwrites what someone else changed meanwhile in another part. */
export function changes(saved: GovernanceSettings, draft: GovernanceSettings): Partial<GovernanceSettings> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(draft) as (keyof GovernanceSettings)[]) {
    if (key === 'email') continue;                   // follows the channels on the server
    if (JSON.stringify(saved[key]) !== JSON.stringify(draft[key])) out[key] = draft[key];
  }
  // the server's review_days follows approval_days until it is set: send it too, so what the form shows is what is saved
  if ('approval_days' in out) out.review_days = draft.review_days;
  return out as Partial<GovernanceSettings>;
}

const day = (d: Date) => d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
export const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);

/** What the placeholders say for a sample request of ``kind`` made today. */
export function sampleValues(kind: Kind, s: GovernanceSettings, today: Date = new Date()): Record<string, string> {
  const days = kind === 'acknowledgement' ? s.ack_days : kind === 'review' ? s.review_days : s.approval_days;
  return {
    action: ACTION[kind], document: 'Acceptable Use Policy', version: '1.2', due_date: day(addDays(today, days || 0)),
    owner: 'Sara Khan', link: kind === 'acknowledgement' ? '/governance/documents/3' : '/governance/documents/3?tab=lifecycle',
  };
}

/** A request's whole course in dates, for the summary line: asked, reminders, due, owner told, escalated. */
export function courseOf(kind: Kind, s: GovernanceSettings, today: Date = new Date()) {
  const days = kind === 'acknowledgement' ? s.ack_days : kind === 'review' ? s.review_days : s.approval_days;
  const due = addDays(today, days);
  // a reminder further ahead than the request is long goes at once (the next daily run), as the server does
  const firstReminder = s.remind_days > 0 ? addDays(due, -Math.min(s.remind_days, days)) : null;
  return {
    due: day(due), firstReminder: firstReminder ? day(firstReminder) : null,
    owner: day(addDays(due, s.owner_after_days)), further: day(addDays(due, s.admin_after_days)),
  };
}
