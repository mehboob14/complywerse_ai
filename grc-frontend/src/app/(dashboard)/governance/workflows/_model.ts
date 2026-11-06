// The rules of the legacy Approval Workflows page, apart from React so `node --test` can pin them (_model.test.ts): what the server sends and how a list answer
// is read, what an overdue step says, how rows are ordered and paged, what each form starts with, what is wrong with it and EXACTLY what each write sends (the
// payloads are the ones the page has always sent: the tests pin them), the reorder rule, and the address the page keeps (?tab= &list= &template=).
import { integer, oneOf, writeAddress } from '../../../../lib/addressState.ts';
import { formatCount, statusLabel } from '../../../../lib/format.ts';
import { pageRange } from '../../../../lib/pagerModel.ts';
import { parseUtc } from '../../../../lib/serverTime.ts';
import type { SortValue } from '../../../../components/ui/ds/tableModel.ts';

// ── what the server sends ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface StepApprover { id: number; step_id: number; approver_type: string; user_id?: number | null; role_id?: number | null; is_required: boolean; sequence: number }

export interface WorkflowStep {
  id: number;
  template_id: number;
  name: string;
  description?: string | null;
  sequence: number;
  step_type: string;
  approval_mode: string;
  is_required: boolean;
  timeout_days?: number | null;
  approvers?: StepApprover[];
}

export interface WorkflowTemplate {
  id: number;
  tenant_id: number;
  name: string;
  description?: string | null;
  doc_types?: string[] | null;
  is_default: boolean;
  is_active: boolean;
  allow_skip: boolean;
  require_all_approvers: boolean;
  auto_publish_on_complete: boolean;
  created_at?: string | null;
  updated_at?: string | null;
  /** the list route counts the steps; only the detail route sends them */
  steps_count?: number;
  steps?: WorkflowStep[];
}

/** One open approval (GET /governance/workflows/pending, and /overdue with `days_overdue`). */
export interface PendingStep {
  step_id: number;
  document_id: number;
  document_title: string;
  document_code?: string | null;
  doc_type: string;
  step_sequence: number;
  step_name: string;
  requested_at?: string | null;
  due_date?: string | null;
  is_overdue: boolean;
  owner_name?: string | null;
  days_overdue?: number;
}

export interface Page<T> { items: T[]; total: number }

/** A list route's answer ({ items, total, skip, limit }) as a page; null when it is anything else. The page reads nothing it cannot read: an array is not a
 *  page (the Assessments approvals page keeps an ARRAY under the same React Query key, ['pending-approvals'], so what is cached there may not be ours), and
 *  a missing total is the length. The total is the server's own count, never smaller than what came. */
export function asPage<T>(data: unknown): Page<T> | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const { items, total } = data as { items?: unknown; total?: unknown };
  if (!Array.isArray(items)) return null;
  return { items: items as T[], total: typeof total === 'number' && Number.isFinite(total) ? Math.max(Math.floor(total), items.length) : items.length };
}

/** "Showing the first 100 of 187 pending approvals" when the server holds more than it sent; null when everything came. */
export function cutTitle(loaded: number, total: number | null | undefined, noun: string): string | null {
  return typeof total === 'number' && Number.isFinite(total) && total > loaded ? `Showing the first ${formatCount(loaded)} of ${formatCount(total)} ${noun}` : null;
}

// ── the page's address ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export const TABS = ['approvals', 'templates'] as const;
export const LISTS = ['pending', 'approved', 'rejected', 'all'] as const;
export type TabKey = (typeof TABS)[number];
export type ListKey = (typeof LISTS)[number];

/** What the page keeps in its address. The bare path is Approvals > Pending (what every link into the page has always opened); `template` is the open
 *  template's id (0: the list). Anything else in the address is the default. */
export const ADDRESS = { tab: oneOf(TABS, 'approvals'), list: oneOf(LISTS, 'pending'), template: integer(0, { min: 0 }) };

/** The address of the template list, or of one template (its name in the list is a real link to it, so Back and "open in a new tab" work). */
export function templatesHref(id = 0): string {
  const query = writeAddress(ADDRESS, '', { tab: 'templates', list: 'pending', template: id });
  return `/governance/workflows${query ? `?${query}` : ''}`;
}

// ── what a person is told ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** The document types a template can be limited to (what the template form has always offered). */
export const DOC_TYPE_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'policy', label: 'Policy' }, { value: 'procedure', label: 'Procedure' }, { value: 'standard', label: 'Standard' },
  { value: 'guideline', label: 'Guideline' }, { value: 'template', label: 'Template' }, { value: 'other', label: 'Other' },
];
export const STEP_TYPES: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'review', label: 'Review' }, { value: 'approval', label: 'Approval' }, { value: 'notification', label: 'Notification' },
];
export const APPROVAL_MODES: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'any', label: 'Any approver' }, { value: 'all', label: 'All approvers' }, { value: 'sequential', label: 'Sequential' },
];

type Option = { value: string; label: string };
const labelIn = (options: readonly Option[], value: string | null | undefined): string => options.find((o) => o.value === value)?.label ?? statusLabel(value);

/** A document type as a word. One that is not among the six (a charter, a framework) reads as itself, not as "Other". */
export const docTypeLabel = (type: string | null | undefined): string => labelIn(DOC_TYPE_OPTIONS, type);
export const stepTypeLabel = (type: string | null | undefined): string => labelIn(STEP_TYPES, type);
export const approvalModeLabel = (mode: string | null | undefined): string => labelIn(APPROVAL_MODES, mode);

/** The options of a select with the value in force among them: a step saved with a type the form does not offer still shows (and keeps) what it has. */
export function withCurrent(options: readonly Option[], current: string | null | undefined): Option[] {
  return current && !options.some((o) => o.value === current) ? options.concat({ value: current, label: statusLabel(current) }) : options.slice();
}

/** What a step that is past its due moment says: "3 days overdue", "1 day overdue", or "Overdue" when the server counted no whole day yet (it sends
 *  `days_overdue` 0 for the first 24 hours: the old page printed that 0 after the year). '' for a step that is not overdue. */
export function overdueWords(step: Pick<PendingStep, 'is_overdue' | 'days_overdue'>): string {
  if (!step.is_overdue) return '';
  const days = step.days_overdue;
  return typeof days === 'number' && days >= 1 ? `${formatCount(days)} ${days === 1 ? 'day' : 'days'} overdue` : 'Overdue';
}

/** The pending rows with `days_overdue` filled in from the overdue list (the pending route does not send it). The input is not touched. */
export function withDays(pending: readonly PendingStep[], overdue: readonly PendingStep[]): PendingStep[] {
  const days: Record<number, number> = {};
  overdue.forEach((s) => { if (typeof s.days_overdue === 'number') days[s.step_id] = s.days_overdue; });
  return pending.map((s) => (s.is_overdue && s.days_overdue === undefined && days[s.step_id] !== undefined ? { ...s, days_overdue: days[s.step_id] } : s));
}

/** The Pending tab's second group, as the page has always split it: the pending rows that are not overdue (the overdue ones come from the overdue list). */
export const notOverdue = (pending: readonly PendingStep[]): PendingStep[] => pending.filter((s) => !s.is_overdue);

/** The document a step is about, opened on its own page. */
export const documentHref = (documentId: number): string => `/governance/documents/${documentId}`;

// ── ordering and paging ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────

const momentOf = (text: string | null | undefined): number | null => parseUtc(text)?.getTime() ?? null;

/** What a column sorts by: the title, the owner's name, the due and requested moments. The server's own order (due soonest first, none last) is the unsorted one. */
export function approvalSortValue(step: PendingStep, key: string): SortValue {
  switch (key) {
    case 'document': return step.document_title;
    case 'owner': return step.owner_name ?? null;
    case 'due': return momentOf(step.due_date);
    case 'requested': return momentOf(step.requested_at);
    default: return null;
  }
}

/** The rows of one page of a list held on the client, and the page actually shown (a page past the end is the last one: a decision shortens the list). */
export function sliceOf<T>(rows: readonly T[], page: number, size: number): { rows: T[]; page: number } {
  const r = pageRange(page, size, rows.length);
  return { rows: rows.slice(r.from === 0 ? 0 : r.from - 1, r.to), page: r.page };
}

// ── templates and their steps ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** The steps in the order they run. */
export const stepsInOrder = (steps: readonly WorkflowStep[] | null | undefined): WorkflowStep[] => (steps ?? []).slice().sort((a, b) => a.sequence - b.sequence);

/** How many steps a template has: the list route's count, else the steps it carries, else nothing known (null: not "0 steps"). */
export function stepCount(t: Pick<WorkflowTemplate, 'steps_count' | 'steps'>): number | null {
  if (typeof t.steps_count === 'number') return t.steps_count;
  return Array.isArray(t.steps) ? t.steps.length : null;
}

/** Where a new step goes: after the last (the number of steps there are, plus one: the page has always done it so). */
export const nextSequence = (steps: readonly WorkflowStep[] | null | undefined): number => (steps?.length || 0) + 1;

/** The reorder request for moving a step one place, as the page has always built it: the steps in order, the moved step and its neighbour trade places, and
 *  every step carries its place in the list as its number. null when the step is not there or is already at that end. */
export function reorderPayload(steps: readonly WorkflowStep[], stepId: number, direction: 'up' | 'down'): { step_id: number; sequence: number }[] | null {
  const ordered = stepsInOrder(steps);
  const from = ordered.findIndex((s) => s.id === stepId);
  const to = direction === 'up' ? from - 1 : from + 1;
  if (from < 0 || to < 0 || to >= ordered.length) return null;
  return ordered.map((s, i) => ({ step_id: s.id, sequence: i === from ? to + 1 : i === to ? from + 1 : i + 1 }));
}

// ── the template form ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** The tenant the page has always sent with a new template and with Seed Defaults (the server checks it against the tenants of the person). */
export const TENANT_ID = 1;

export interface TemplateForm {
  name: string;
  description: string;
  doc_types: string[];
  allow_skip: boolean;
  require_all_approvers: boolean;
  auto_publish_on_complete: boolean;
}

export const emptyTemplateForm = (): TemplateForm => ({ name: '', description: '', doc_types: [], allow_skip: false, require_all_approvers: false, auto_publish_on_complete: false });

/** What editing a template starts with: its own values (the old panels read them once, at the first render, so Edit opened blank). */
export const templateFormFrom = (t: WorkflowTemplate): TemplateForm => ({
  name: t.name || '',
  description: t.description || '',
  doc_types: (t.doc_types || []).slice(),
  allow_skip: !!t.allow_skip,
  require_all_approvers: !!t.require_all_approvers,
  auto_publish_on_complete: !!t.auto_publish_on_complete,
});

export const sameTemplateForm = (a: TemplateForm, b: TemplateForm): boolean =>
  a.name === b.name && a.description === b.description && a.allow_skip === b.allow_skip && a.require_all_approvers === b.require_all_approvers
  && a.auto_publish_on_complete === b.auto_publish_on_complete && a.doc_types.length === b.doc_types.length && a.doc_types.every((t, i) => t === b.doc_types[i]);

/** A document type ticked or unticked: ticked ones are kept in the order they were ticked, as they always were sent. */
export const toggleDocType = (types: readonly string[], type: string): string[] => (types.includes(type) ? types.filter((t) => t !== type) : types.concat(type));

export function templateErrors(form: TemplateForm): { name?: string } {
  return form.name.trim() ? {} : { name: 'Enter a name' };
}

/** POST /governance/workflows/templates (?tenant_id=1 is added by the API client): exactly what the page has always sent. */
export const createTemplatePayload = (f: TemplateForm) => ({
  tenant_id: TENANT_ID, name: f.name, description: f.description, doc_types: f.doc_types,
  allow_skip: f.allow_skip, require_all_approvers: f.require_all_approvers, auto_publish_on_complete: f.auto_publish_on_complete,
});

/** PUT /governance/workflows/templates/{id}: the same fields without the tenant. */
export const updateTemplatePayload = (f: TemplateForm) => ({
  name: f.name, description: f.description, doc_types: f.doc_types,
  allow_skip: f.allow_skip, require_all_approvers: f.require_all_approvers, auto_publish_on_complete: f.auto_publish_on_complete,
});

// ── the step form ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface StepForm {
  name: string;
  description: string;
  step_type: string;
  approval_mode: string;
  is_required: boolean;
  /** what is typed in the box: '' is none */
  timeout_days: string;
  sequence: number;
}

export const emptyStepForm = (sequence: number): StepForm => ({ name: '', description: '', step_type: 'approval', approval_mode: 'any', is_required: true, timeout_days: '', sequence });

export const stepFormFrom = (s: WorkflowStep): StepForm => ({
  name: s.name || '',
  description: s.description || '',
  step_type: s.step_type || 'approval',
  approval_mode: s.approval_mode || 'any',
  is_required: s.is_required ?? true,
  timeout_days: s.timeout_days == null ? '' : String(s.timeout_days),
  sequence: s.sequence,
});

export const sameStepForm = (a: StepForm, b: StepForm): boolean =>
  a.name === b.name && a.description === b.description && a.step_type === b.step_type && a.approval_mode === b.approval_mode
  && a.is_required === b.is_required && a.timeout_days.trim() === b.timeout_days.trim();

const INT_MAX = 2147483647;          // the column is an integer

/** The timeout as the server takes it: null for an empty box, the whole number of days, or undefined when what is typed is not a whole number of days (1 or more). */
export function timeoutDays(text: string): number | null | undefined {
  const t = text.trim();
  if (t === '') return null;
  if (!/^\d+$/.test(t)) return undefined;
  const n = Number(t);
  return n >= 1 && n <= INT_MAX ? n : undefined;
}

export function stepErrors(form: StepForm): { name?: string; timeout_days?: string } {
  const errors: { name?: string; timeout_days?: string } = {};
  if (!form.name.trim()) errors.name = 'Enter a name';
  if (timeoutDays(form.timeout_days) === undefined) errors.timeout_days = 'Enter a whole number of days, 1 or more';
  return errors;
}

/** POST /governance/workflows/templates/{id}/steps: exactly what the page has always sent (no timeout is no field). */
export function createStepPayload(f: StepForm) {
  const days = timeoutDays(f.timeout_days);
  return {
    name: f.name, description: f.description, sequence: f.sequence, step_type: f.step_type, approval_mode: f.approval_mode, is_required: f.is_required,
    ...(typeof days === 'number' ? { timeout_days: days } : {}),
  };
}

/** PUT .../steps/{stepId}: as before, except that a timeout taken out of the box is sent as null. It used to be left out of the request, so the server kept
 *  the old one and the step came back with the timeout the person had just removed. */
export function updateStepPayload(f: StepForm) {
  const days = timeoutDays(f.timeout_days);
  return { name: f.name, description: f.description, step_type: f.step_type, approval_mode: f.approval_mode, is_required: f.is_required, timeout_days: days === undefined ? null : days };
}
