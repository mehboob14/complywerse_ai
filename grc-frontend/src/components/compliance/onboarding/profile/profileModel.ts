/**
 * What the organisation-profile screen decides without a server or a screen: the stages and how far each is ("3 of 7"), which fields of a stage are asked
 * (the catalog's `when`, against what has been typed), what is still needed and which stage each item is in, how a refusal from the server maps onto the
 * fields, and what the save status says. The rules of what counts as complete are the server's (`engine.evaluate_org`); this only arranges its answer.
 */
import type { Check, Field, Group, OrgEvaluation, OrgGroupState, Problem, ProfileCatalog, Refs, Values } from '@/lib/frameworkOnboarding';
import { answered, makeVisible, type AnyField, type Lookup } from '../fieldModel.ts';

/** "group.field": the key the server's save takes and the catalog's conditions use. */
export const keyOf = (group: string, field: string): string => `${group}.${field}`;

/** The profile's fields by key. */
export function fieldMap(groups: readonly Group[]): Record<string, Field> {
  const out: Record<string, Field> = {};
  for (const g of groups) for (const f of g.fields) out[keyOf(g.key, f.key)] = f;
  return out;
}

/** Where a value is read from: what has been typed (a draft) over what the server holds. */
export function valueAt(values: Values, drafts: Record<string, unknown>, ref: string): unknown {
  const key = ref.startsWith('org.') ? ref.slice(4) : ref;
  if (key in drafts) return drafts[key];
  const [g, f] = key.split('.');
  return values?.[g]?.[f];
}

/** A lookup for the catalog's conditions: refs are "group.field" inside the profile (an "org." in front is allowed). */
export function profileLookup(groups: readonly Group[], values: Values, drafts: Record<string, unknown> = {}): Lookup {
  const fields = fieldMap(groups);
  return (ref) => ({ field: fields[ref.startsWith('org.') ? ref.slice(4) : ref], value: valueAt(values, drafts, ref) });
}

/** The fields of a stage that are asked now, in catalog order. */
export function visibleFields(group: Group, groups: readonly Group[], values: Values, drafts: Record<string, unknown> = {}): Field[] {
  const visible = makeVisible(fieldMap(groups), profileLookup(groups, values, drafts));
  return group.fields.filter((f) => visible(keyOf(group.key, f.key)));
}

/** A long or many-part field takes the whole row; a short one shares it. */
export function isWide(f: Field): boolean {
  return ['table', 'longtext', 'multichoice', 'org_pick', 'asset_refs', 'departments_derived', 'countries', 'person'].includes(f.type);
}

/** The fields that mirror a column of the organisation record (Administration > Organization). */
export const mirrorsOrganisation = (f: Field): boolean => typeof f.maps_to === 'string' && f.maps_to.startsWith('tenant.');

// ── stages ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface StageProgress { done: number; total: number; text: string; complete: boolean; reviewed: boolean }

/** How far a stage is: "3 of 7" required fields (no words for a stage that asks for nothing). */
export function stageProgress(state: OrgGroupState | undefined): StageProgress {
  if (!state) return { done: 0, total: 0, text: '', complete: false, reviewed: false };
  const { required_ok: done, required_total: total } = state;
  return { done, total, text: total > 0 ? `${done} of ${total}` : '', complete: state.complete, reviewed: state.reviewed };
}

/** The stage the page opens on: the one in the address if it exists, else the first with required fields still open, else the first. */
export function openingStage(groups: readonly Group[], asked: string, evaluation: OrgEvaluation | undefined): string {
  if (groups.some((g) => g.key === asked)) return asked;
  return (groups.find((g) => evaluation?.groups?.[g.key] && !evaluation.groups[g.key].complete) ?? groups[0])?.key ?? '';
}

export const nextStage = (groups: readonly Group[], key: string): string | null => groups[groups.findIndex((g) => g.key === key) + 1]?.key ?? null;

// ── what is still needed ──────────────────────────────────────────────────────────────────────────────────────────────────────────

/** A cross-field check as the catalog describes it (the server sends its definition along with the label). */
type CatalogCheck = ProfileCatalog['checks'][number] & { check?: Record<string, unknown> };

/** The "group.field" references a check reads. */
export function refsOfCheck(check: Record<string, unknown> | undefined): string[] {
  if (!check) return [];
  const out: string[] = [];
  for (const k of ['field', 'first', 'second']) if (typeof check[k] === 'string') out.push(check[k] as string);
  if (Array.isArray(check.fields)) out.push(...(check.fields as unknown[]).filter((x): x is string => typeof x === 'string'));
  return out.map((r) => (r.startsWith('org.') ? r.slice(4) : r));
}

export interface Needed { key: string; label: string; hint: string | null; stage: string; field: string | null }

/**
 * What is still needed, required first and advice after, each item with the stage that holds it. A required field the server says is missing; a check that
 * fails (a check that names a missing field replaces that field's own line: "Regulators listed, or none declared" says it better than "Regulators");
 * advice is a check that fails but does not block, and an advised field with no answer yet.
 */
export function stillNeeded(
  groups: readonly Group[], evaluation: OrgEvaluation | undefined, checks: readonly CatalogCheck[], values: Values, drafts: Record<string, unknown> = {},
): { required: Needed[]; advice: Needed[] } {
  if (!evaluation) return { required: [], advice: [] };
  const defs = new Map(checks.map((c) => [c.key, c]));
  const stageOf = (refs: string[]): string => groups.find((g) => refs.some((r) => r.startsWith(`${g.key}.`)))?.key ?? groups[0]?.key ?? '';
  const failing = (evaluation.checks ?? []).filter((c: Check) => !c.ok);
  const asNeeded = (c: Check): Needed => {
    const refs = refsOfCheck(defs.get(c.key)?.check);
    return { key: `check.${c.key}`, label: c.label, hint: c.hint, stage: stageOf(refs), field: refs[0]?.split('.')[1] ?? null };
  };
  const refsOf = (c: Check) => refsOfCheck(defs.get(c.key)?.check);
  const named = new Set(failing.filter((c) => c.required).flatMap(refsOf));
  const namedAny = new Set(failing.flatMap(refsOf));
  const required: Needed[] = [
    ...(evaluation.missing ?? []).filter((m) => !named.has(keyOf(m.group, m.field))).map((m) => ({ key: keyOf(m.group, m.field), label: m.label, hint: null, stage: m.group, field: m.field })),
    ...failing.filter((c) => c.required).map(asNeeded),
  ];
  const lookup = profileLookup(groups, values, drafts);
  const fields = fieldMap(groups);
  const visible = makeVisible(fields, lookup);
  const advisedFields: Needed[] = groups.flatMap((g) => g.fields
    .filter((f) => f.level === 'advised' && visible(keyOf(g.key, f.key)) && !answered(f as AnyField, valueAt(values, drafts, keyOf(g.key, f.key))) && !namedAny.has(keyOf(g.key, f.key)))
    .map((f) => ({ key: keyOf(g.key, f.key), label: f.label, hint: null, stage: g.key, field: f.key })));
  const advisedChecks = failing.filter((c) => !c.required).map(asNeeded);
  const seen = new Set<string>();
  const advice = [...advisedChecks, ...advisedFields].filter((n) => !seen.has(n.key) && !!seen.add(n.key));
  return { required, advice };
}

// ── refusals and saving ───────────────────────────────────────────────────────────────────────────────────────────────────────

/** A refusal's messages by field key, and the words for a refusal that is about no single field. */
export function refusalOf(problem: Problem, known: Record<string, unknown>): { byField: Record<string, string>; general: string | null } {
  const byField: Record<string, string> = {};
  const rest: string[] = [];
  for (const e of problem.errors) {
    if (e.field in known) byField[e.field] = e.message;
    else if (e.message) rest.push(e.message);
  }
  if (problem.usedBy.length > 0) return { byField, general: `${problem.message} Used by ${problem.usedBy.join(', ')}.` };
  if (Object.keys(byField).length > 0) return { byField, general: null };
  return { byField, general: rest.length > 0 ? rest.join(' ') : problem.message };
}

export type SaveState = 'idle' | 'saving' | 'saved' | 'failed';

/** What the status beside the title says. Nothing until something was changed; "Saving…" from the first key stroke to the answer. */
export function saveState(x: { pending: boolean; saving: boolean; failed: boolean; saved: boolean }): SaveState {
  if (x.failed) return 'failed';
  if (x.saving || x.pending) return 'saving';
  return x.saved ? 'saved' : 'idle';
}
export const SAVE_WORDS: Record<SaveState, string> = { idle: '', saving: 'Saving…', saved: 'Saved', failed: 'Not saved' };

/** Names for what the page picked, ahead of the next read: a new name goes over the server's. */
export function mergeRefs(base: Refs, patch: Partial<Refs>): Refs {
  return {
    users: { ...base.users, ...patch.users },
    assets: { ...base.assets, ...patch.assets },
    vendors: { ...base.vendors, ...patch.vendors },
    departments: { ...base.departments, ...patch.departments },
  };
}

/** What to send: the changes the server has not refused in this very form (a refused value waits until the person changes it, or tries again). */
export function batchToSend(pending: Record<string, unknown>, refused: Record<string, string>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(pending)) if (refused[k] !== JSON.stringify(v ?? null)) out[k] = v;
  return out;
}

/** After a save: what is still pending (a key changed while it was being sent stays). */
export function afterSave(pending: Record<string, unknown>, sent: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(pending)) if (!(k in sent) || JSON.stringify(sent[k] ?? null) !== JSON.stringify(v ?? null)) out[k] = v;
  return out;
}
