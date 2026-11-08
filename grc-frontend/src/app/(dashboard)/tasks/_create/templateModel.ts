// The "From a template" part of New task, apart from React so `node --test` can pin it (templateModel.test.ts): the templates the server offers (`GET /critical-tasks/templates/list`: the
// four it ships and the organization's own), what each one gives in words, and the body of `POST /critical-tasks/create-from-template`. The server sets the priority, category, deadline
// (days after it is created) and the checklist from the template; the person gives the title, one owner, a reviewer and whether it needs approval - what the endpoint takes.
import { titleProblem } from '../tasksModel.ts';

export interface TemplateRow {
  /** null for a template the platform ships (it is found by name) */
  id: number | null;
  name: string;
  description: string | null;
  category: string;
  priority: string;
  sla_days: number | null;
  sub_tasks_template: Array<{ title?: string } | string>;
  is_system: boolean;
}

export const templateKey = (t: Pick<TemplateRow, 'id' | 'name'>): string => (t.id != null ? `id-${t.id}` : `name-${t.name}`);

/** The checklist the task starts with, in order. */
export const checklistOf = (t: Pick<TemplateRow, 'sub_tasks_template'>): string[] =>
  (t.sub_tasks_template ?? []).map((s) => (typeof s === 'string' ? s : s?.title ?? '')).map((s) => s.trim()).filter(Boolean);

/** "Due 30 days after it is created", or what it says when the template has no deadline. */
export const deadlineWords = (t: Pick<TemplateRow, 'sla_days'>): string => (t.sla_days ? `Due ${t.sla_days} ${t.sla_days === 1 ? 'day' : 'days'} after it is created` : 'No deadline');

/** "Remediation · High priority · Due 30 days after it is created · 5 steps" */
export function templateFacts(t: TemplateRow): string {
  const steps = checklistOf(t).length;
  return [t.category, t.priority ? `${t.priority} priority` : null, deadlineWords(t), steps ? `${steps} ${steps === 1 ? 'step' : 'steps'}` : null].filter(Boolean).join(' · ');
}

export interface TemplateForm { title: string; owner: string; reviewer: string; approval: boolean }
export const emptyTemplateForm = (t: Pick<TemplateRow, 'name'>): TemplateForm => ({ title: t.name, owner: '', reviewer: '', approval: false });

/** Why the task cannot be made: the title is checked as New task checks it. */
export const templateProblem = (form: TemplateForm): string | null => titleProblem(form.title);

/** What is sent: the template (by id when it is the organization's own, by name when the platform ships it), the title, and the people and the approval flag only when chosen. */
export function templateBody(t: Pick<TemplateRow, 'id' | 'name'>, form: TemplateForm): Record<string, unknown> {
  const body: Record<string, unknown> = { template_name: t.name, title: form.title.trim() };
  if (t.id != null) body.template_id = t.id;
  if (form.owner) body.assigned_owner_id = Number(form.owner);
  if (form.reviewer) body.reviewer_id = Number(form.reviewer);
  if (form.approval) body.approval_required = true;
  return body;
}
