// The new / edit observation form, apart from React so `node --test` pins it (formModel.test.ts): the draft a form holds, what is asked of the person before a save, and the payload that
// is sent. An edit sends ONLY what changed (the server's update takes a partial body), so a copy of a register finding never has the fields the register owns sent back at it, and
// saving one field never overwrites another a colleague changed meanwhile. A new observation takes the organisation's own first status when it has no "open" level.
import { lockedField, type Level, type ObservationRow } from './observationModel.ts';

export interface FormDraft {
  title: string;
  description: string;
  observation_type: string;
  priority: string;
  category: string;
  regulator_source: string;
  regulation_reference: string;
  audit_period: string;
  /** a day, "2026-11-30", or '' */
  due_date: string;
  area_domain: string;
  /** a person's id as text, or null */
  owner: string | null;
  management_response: string;
  notes: string;
  custom: Record<string, unknown>;
}

const day = (v: string | null | undefined): string => (v && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : '');

export const draftOf = (o: ObservationRow | null): FormDraft => ({
  title: o?.title ?? '', description: o?.description ?? '', observation_type: o?.observation_type ?? 'requirement', priority: o?.priority ?? 'medium', category: o?.category ?? '',
  regulator_source: o?.regulator_source ?? '', regulation_reference: o?.regulation_reference ?? '', audit_period: o?.audit_period ?? '', due_date: day(o?.due_date),
  area_domain: o?.area_domain ?? '', owner: o?.owner_id ? String(o.owner_id) : null, management_response: o?.management_response ?? '', notes: o?.notes ?? '', custom: { ...(o?.custom_values ?? {}) },
});

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** Whether the person changed anything (the sheet asks before a typed form is thrown away). */
export const isDirty = (opened: FormDraft, now: FormDraft): boolean => (Object.keys(opened) as Array<keyof FormDraft>).some((k) => !same(opened[k], now[k]));

/** What is wrong with the form, in words; empty when it can be saved. */
export function problems(d: FormDraft): { title?: string; due_date?: string } {
  const out: { title?: string; due_date?: string } = {};
  if (!d.title.trim()) out.title = 'Enter a title.';
  else if (d.title.trim().length > 500) out.title = 'Keep the title to 500 characters.';
  if (d.due_date && !/^\d{4}-\d{2}-\d{2}$/.test(d.due_date)) out.due_date = 'Choose a date.';
  return out;
}

const clean = (v: string): string | null => (v.trim() ? v.trim() : null);

/** The status a new observation starts in: "open" when the organisation has that level, else its first level (the server refuses a status that is not one of them). */
export const initialStatus = (levels: readonly Pick<Level, 'key'>[]): string => (levels.some((l) => l.key === 'open') || levels.length === 0 ? 'open' : levels[0].key);

/** The body of a new observation. */
export function createPayload(d: FormDraft, status: string): Record<string, unknown> {
  return {
    title: d.title.trim(), description: d.description.trim() || null, observation_type: d.observation_type, priority: d.priority, status, category: clean(d.category),
    regulator_source: clean(d.regulator_source), regulation_reference: clean(d.regulation_reference), audit_period: clean(d.audit_period), due_date: d.due_date || null,
    area_domain: clean(d.area_domain), owner_id: d.owner ? Number(d.owner) : null, management_response: d.management_response.trim() || null, notes: d.notes.trim() || null, custom_values: d.custom,
  };
}

/** The body of an edit: only the fields that changed, and never one the Issue Register owns on a copy of a register finding. */
export function changes(opened: FormDraft, now: FormDraft, mirrored: boolean): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const put = (field: string, a: unknown, b: unknown, value: unknown) => { if (!same(a, b) && !lockedField(mirrored, field)) out[field] = value; };
  put('title', opened.title.trim(), now.title.trim(), now.title.trim());
  put('description', opened.description, now.description, now.description.trim() || null);
  put('observation_type', opened.observation_type, now.observation_type, now.observation_type);
  put('priority', opened.priority, now.priority, now.priority);
  put('category', opened.category.trim(), now.category.trim(), clean(now.category));
  put('regulator_source', opened.regulator_source.trim(), now.regulator_source.trim(), clean(now.regulator_source));
  put('regulation_reference', opened.regulation_reference.trim(), now.regulation_reference.trim(), clean(now.regulation_reference));
  put('audit_period', opened.audit_period.trim(), now.audit_period.trim(), clean(now.audit_period));
  put('due_date', opened.due_date, now.due_date, now.due_date || null);
  put('area_domain', opened.area_domain.trim(), now.area_domain.trim(), clean(now.area_domain));
  put('owner_id', opened.owner, now.owner, now.owner ? Number(now.owner) : null);
  put('management_response', opened.management_response, now.management_response, now.management_response.trim() || null);
  put('notes', opened.notes, now.notes, now.notes.trim() || null);
  put('custom_values', opened.custom, now.custom, now.custom);
  return out;
}
