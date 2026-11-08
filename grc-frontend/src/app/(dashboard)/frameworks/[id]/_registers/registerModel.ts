// What the Registers tab knows about one register, as plain functions (no React), so `node --test` can pin it. A register is one of two shapes behind
// the same screen: ISO 27001's own three (Gap Analysis, Internal Audit, Risk Treatment) read FIXED columns of the entry (`reference`, `status`,
// `owner_id` ...), the 54 generated ones keep a `data` object. Both become the same row here: `values` is the entry (or its data), the columns say
// what each value is, and the request bodies are built from them the way the old screens built them.
import { formatDate } from '../../../../../lib/format.ts';
import { registerTone } from '../../../../../lib/statuses/frameworkRegisters.ts';
import type { Tone } from '../../../../../lib/status.ts';
import type { RegisterConfig } from '../_tabs/templateConfigs.ts';

export type Shape = 'columns' | 'data';
export type CellKind = 'text' | 'textarea' | 'select' | 'owner' | 'date' | 'datetime' | 'auto';
export type Picker = 'users' | 'evidence' | 'framework_controls' | 'framework_risks';

export interface RegOption { value: string; label: string; tone: Tone }
export interface RegColumn {
  key: string;
  label: string;
  kind: CellKind;
  options?: RegOption[];
  picker?: Picker;
  /** a requirement picker that also fills this other column with the requirement's text */
  autofillKey?: string;
}
export interface RegSection { title: string; keys: string[] }

export interface RegDef {
  type: string;
  shape: Shape;
  label: string;
  description?: string;
  columns: RegColumn[];
  sections: RegSection[];
  /** Gap Analysis: coverage = covered / applicable */
  coverage: boolean;
}

export interface RegRow {
  id: number;
  values: Record<string, unknown>;
  /** the risk register entry this row was moved to */
  riskId: number | null;
  /** a row the template put there (not one a person added) */
  seed: boolean;
}

export interface Person { id: number; name: string }

// ── definitions ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const optionsOf = (list?: Array<{ value: string; label: string; tone?: string }>): RegOption[] | undefined =>
  list ? list.map((o) => ({ value: o.value, label: o.label, tone: registerTone(o.tone) })) : undefined;

/** The ISO 27001 registers: the configs in templateConfigs.ts. */
export function defOfIso(cfg: RegisterConfig): RegDef {
  const columns: RegColumn[] = cfg.columns.map((c) => ({
    key: String(c.key),
    label: c.label,
    kind: c.type,
    options: optionsOf(c.options),
    picker: c.picker,
    autofillKey: c.autofillTitleKey ? String(c.autofillTitleKey) : undefined,
  }));
  return { type: cfg.registerType, shape: 'columns', label: cfg.label, description: cfg.description, columns, sections: sectionsOf(cfg.formSections, columns), coverage: !!cfg.coverage };
}

export interface DefinitionColumn { key: string; label: string; type: string; options?: Array<{ value: string; label: string; tone?: string }>; picker?: string }
export interface Definition { type: string; label: string; description?: string; columns: DefinitionColumn[]; formSections?: Array<{ title: string; keys: string[] }> }

const KINDS: readonly string[] = ['text', 'textarea', 'select', 'date', 'datetime', 'auto'];
const PICKERS: readonly string[] = ['users', 'evidence', 'framework_controls'];

/** A generated register: the definition the backend ships (seed_data/framework_templates). */
export function defOfDefinition(def: Definition): RegDef {
  const columns: RegColumn[] = def.columns.map((c) => ({
    key: c.key,
    label: c.label,
    kind: (KINDS.indexOf(c.type) >= 0 ? c.type : 'text') as CellKind,
    options: optionsOf(c.options),
    picker: c.picker && PICKERS.indexOf(c.picker) >= 0 ? (c.picker as Picker) : undefined,
  }));
  return { type: def.type, shape: 'data', label: def.label, description: def.description, columns, sections: sectionsOf(def.formSections, columns), coverage: false };
}

/** The form's sections: the definition's, keeping only keys that are columns; one section of every column when it gives none. */
export function sectionsOf(sections: ReadonlyArray<{ title: string; keys: ReadonlyArray<unknown> }> | undefined, columns: RegColumn[]): RegSection[] {
  const known = new Set(columns.map((c) => c.key));
  const kept = (sections ?? []).map((s) => ({ title: s.title, keys: s.keys.map(String).filter((k) => known.has(k)) })).filter((s) => s.keys.length > 0);
  return kept.length > 0 ? kept : [{ title: '', keys: columns.map((c) => c.key) }];
}

// ── rows ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** An ISO entry (the server's fixed columns). */
export function rowOfEntry<T extends { id: number }>(entry: T): RegRow {
  const e = entry as unknown as Record<string, unknown>;
  const { data: _data, ...values } = e;
  return { id: entry.id, values, riskId: (e.risk_register_id as number | null | undefined) ?? null, seed: !!e.is_seed };
}

/** A generated entry (the values live in `data`). */
export function rowOfData(e: { id: number; is_seed?: boolean; risk_register_id?: number | null; data?: Record<string, unknown> | null }): RegRow {
  return { id: e.id, values: { ...(e.data ?? {}) }, riskId: e.risk_register_id ?? null, seed: !!e.is_seed };
}

/** The editable copy of a row, and the empty one for "Add row" (a new Gap Analysis row starts "not started", as it always did). */
export function draftOf(row: RegRow | null, def: RegDef): Record<string, unknown> {
  if (row) return { ...row.values };
  return def.type === 'gap_analysis' ? { status: 'not_started' } : {};
}

/** What is sent to create or update: ISO rows send each column (a missing one as null) and the risk link when the draft carries one; generated rows send `{ data }`. */
export function bodyOf(draft: Record<string, unknown>, def: RegDef): Record<string, unknown> {
  if (def.shape === 'data') return { data: draft };
  const body: Record<string, unknown> = {};
  for (const c of def.columns) body[c.key] = draft[c.key] ?? null;
  if (draft.risk_register_id !== undefined) body.risk_register_id = draft.risk_register_id ?? null;
  return body;
}

// ── AI ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** The rows the AI endpoint reads. */
export function aiRowsOf(rows: RegRow[], shape: Shape): Array<Record<string, unknown>> {
  if (shape === 'data') return rows.map((r) => ({ id: r.id, ...r.values }));
  return rows.map((r) => {
    const v = r.values;
    return { id: r.id, reference: v.reference, title: v.title, status: v.status, result: v.result, action: v.action, notes: v.notes };
  });
}

const AI_FIELDS = ['status', 'result', 'finding_type', 'treatment_option', 'linked_control', 'action', 'notes', 'residual_risk'] as const;

export interface AiOut { suggestions?: Array<Record<string, unknown>>; summary?: string; keys?: string[] }

/** What to apply from the AI's answer: ISO rows take the eight assessment fields; generated rows take the keys the endpoint names, only where it said something. */
export function aiItemsOf(out: AiOut, shape: Shape): Array<{ id: number; fields: Record<string, unknown> }> {
  const sugg = (out.suggestions ?? []).filter((s) => s && s.id != null);
  if (shape === 'columns') {
    return sugg.map((s) => {
      const fields: Record<string, unknown> = {};
      for (const k of AI_FIELDS) fields[k] = s[k];
      return { id: Number(s.id), fields };
    });
  }
  const keys = out.keys ?? [];
  return sugg
    .map((s) => {
      const fields: Record<string, unknown> = {};
      keys.forEach((k) => { if (s[k] != null && s[k] !== '') fields[k] = s[k]; });
      return { id: Number(s.id), fields };
    })
    .filter((it) => Object.keys(it.fields).length > 0);
}

/** The first suggestion's values, for the form's "AI assess this item" (generated registers only): only keys that say something. */
export function aiPatchOf(out: AiOut): Record<string, unknown> {
  const sug = (out.suggestions ?? [])[0] ?? {};
  const patch: Record<string, unknown> = {};
  (out.keys ?? []).forEach((k) => { if (sug[k] != null && sug[k] !== '') patch[k] = sug[k]; });
  return patch;
}

// ── what a cell says ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const TYPED = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/;

/** A date-and-time a person typed into a datetime-local box ("2026-11-08T14:30"): shown as typed, in no zone. */
export function formatTyped(value: unknown): string {
  const text = typeof value === 'string' ? value.trim() : '';
  const m = TYPED.exec(text);
  return m ? `${formatDate(m[1])}, ${m[2]}` : formatDate(text, { calendar: true });
}

export function optionOf(col: RegColumn, value: unknown): RegOption | undefined {
  const v = String(value ?? '');
  return v === '' ? undefined : col.options?.find((o) => o.value === v);
}

export function ownerName(row: RegRow, people: Person[]): string {
  const id = row.values.owner_id;
  const byId = typeof id === 'number' ? people.find((p) => p.id === id)?.name : undefined;
  return byId || String(row.values.owner_name ?? '').trim();
}

/** The words of a cell, for the search and for a phone card. Empty when nothing is recorded. */
export function cellText(col: RegColumn, row: RegRow, people: Person[]): string {
  const raw = row.values[col.key];
  switch (col.kind) {
    case 'select': return optionOf(col, raw)?.label ?? (raw == null ? '' : String(raw));
    case 'owner': return ownerName(row, people);
    case 'date': return raw ? formatDate(String(raw), { calendar: true, empty: '' }) : '';
    case 'datetime': return raw ? formatTyped(raw) : '';
    default: return raw == null ? '' : String(raw).trim();
  }
}

// ── list: search, filter, counts ──────────────────────────────────────────────────────────────────────────────────────────────────────────
/** Every column's words, so a search finds what the table shows (and what only the form shows). */
export function matchesSearch(row: RegRow, cols: RegColumn[], people: Person[], query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return cols.some((c) => cellText(c, row, people).toLowerCase().indexOf(q) >= 0);
}

/** The select column the list can be narrowed by: the one that says where a row stands (status, result), else the first select. */
export function facetColumn(cols: RegColumn[]): RegColumn | null {
  const selects = cols.filter((c) => c.kind === 'select' && (c.options?.length ?? 0) > 0);
  return selects.find((c) => /status|result|state/i.test(c.key)) ?? selects[0] ?? null;
}

export interface FacetCount { value: string; label: string; count: number }

/** How many rows hold each option of the column (an option nobody holds is left out; a value that is no option is counted under its own words; "not set" last). */
export function facetCounts(rows: RegRow[], col: RegColumn): FacetCount[] {
  const seen = new Map<string, FacetCount>();
  const order = (col.options ?? []).map((o) => o.value);
  rows.forEach((r) => {
    const v = r.values[col.key] == null ? '' : String(r.values[col.key]);
    const known = optionOf(col, v);
    const hit = seen.get(v) ?? { value: v, label: v === '' ? 'Not set' : known?.label ?? v, count: 0 };
    hit.count += 1;
    seen.set(v, hit);
  });
  return Array.from(seen.values()).sort((a, b) => {
    if (a.value === '') return 1;
    if (b.value === '') return -1;
    const ia = order.indexOf(a.value);
    const ib = order.indexOf(b.value);
    return (ia < 0 ? 1e6 : ia) - (ib < 0 ? 1e6 : ib) || a.label.localeCompare(b.label);
  });
}

export const FACET_ALL = '__all__';

export function matchesFacet(row: RegRow, col: RegColumn | null, chosen: string): boolean {
  if (!col || chosen === FACET_ALL) return true;
  const v = row.values[col.key];
  return (v == null ? '' : String(v)) === chosen;
}

/** Gap Analysis coverage: rows covered of the rows that apply (not-applicable rows leave the count), a whole percent. */
export function coveragePct(rows: RegRow[]): number {
  const applicable = rows.filter((r) => String(r.values.status ?? '') !== 'not_applicable');
  const covered = applicable.filter((r) => String(r.values.status ?? '') === 'covered');
  return applicable.length ? Math.round((100 * covered.length) / applicable.length) : 0;
}

export const movedCount = (rows: RegRow[]): number => rows.filter((r) => r.riskId != null).length;

// ── the table: at most six columns, by how much each says ───────────────────────────────────────────────────────────────────────────────────
export interface TableColumn { col: RegColumn; priority: 1 | 2 | 3 }

const IDISH = /^(reference|ref|id|ref_id|control_id)$/i;
const OWNERISH = /owner|assign|responsib|lead/i;

/** Which columns the table shows (the form shows all of them). Reference first, then the main text, where the row stands, who owns it, when it is due; then the rest
 *  in the order the definition gives them. Shown in the definition's own order. The first three are always shown; the next two from 768px; the rest from 1024px. */
export function tableColumns(cols: RegColumn[], max = 6): TableColumn[] {
  const main = cols.find((c) => (c.kind === 'textarea' || c.kind === 'text') && !IDISH.test(c.key)) ?? null;
  const importance = (c: RegColumn, i: number): number => {
    if (c.kind === 'auto' || IDISH.test(c.key)) return 0;
    if (c.kind === 'select' && /status|result|state/i.test(c.key)) return 2;
    if (c === main) return 1;
    if (c.kind === 'owner' || (c.picker === 'users' && OWNERISH.test(c.key))) return 4;
    if (c.kind === 'date' || c.kind === 'datetime') return 5;
    return 6 + i;
  };
  const ranked = cols.map((col, i) => ({ col, i, rank: importance(col, i) })).sort((a, b) => a.rank - b.rank || a.i - b.i);
  const chosen = new Set(ranked.slice(0, Math.max(1, max)).map((r) => r.col.key));
  const rankOf = new Map(ranked.map((r, n) => [r.col.key, n]));
  return cols
    .filter((c) => chosen.has(c.key))
    .map((col) => {
      const n = rankOf.get(col.key) ?? 99;
      return { col, priority: (n < 3 ? 1 : n < 5 ? 2 : 3) as 1 | 2 | 3 };
    });
}

// ── names ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** What the row is called in a question or a button name ("Delete 4 Context?"): the reference and the main text, cut. */
export function rowLabel(row: RegRow, cols: RegColumn[], max = 60): string {
  const parts: string[] = [];
  for (const c of cols) {
    if (c.kind === 'select' || c.kind === 'owner' || c.kind === 'date' || c.kind === 'datetime') continue;
    const t = String(row.values[c.key] ?? '').trim();
    if (t) parts.push(t);
    if (parts.length === 2) break;
  }
  const text = parts.join(' ').replace(/\s+/g, ' ');
  if (!text) return 'this row';
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/** The title of the risk made from a row: ISO rows use their title or reference; generated rows the first meaningful text, as the move always did. */
export function riskTitleOf(row: RegRow, def: RegDef): string {
  if (def.shape === 'columns') return String(row.values.title || row.values.reference || '').slice(0, 200);
  const data = row.values;
  for (const c of def.columns) {
    if (c.kind === 'textarea' && !c.picker) {
      const s = String(data[c.key] ?? '').trim();
      if (s.length > 2) return s.slice(0, 200);
    }
  }
  for (const c of def.columns) {
    if (c.kind === 'text' && !c.picker) {
      const s = String(data[c.key] ?? '').trim();
      if (s.length > 3 && !/^\d+([.,]\d+)?$/.test(s)) return s.slice(0, 200);
    }
  }
  const vals = Object.values(data).map((x) => String(x ?? '').trim());
  return (vals.find((s) => s.length > 3 && !/^\d+$/.test(s)) || vals.find(Boolean) || '').slice(0, 200);
}

/** Whether the form needs the evidence library (a column with an evidence picker, or the extra "Linked evidence" field of a generated register). */
export function wantsEvidence(def: RegDef): boolean {
  return def.shape === 'data' || def.columns.some((c) => c.picker === 'evidence');
}

/** A generated register without its own evidence column gets a "Linked evidence" field that is kept under `__evidence`. */
export function hasEvidenceColumn(def: RegDef): boolean {
  return def.columns.some((c) => c.picker === 'evidence');
}

export const EVIDENCE_KEY = '__evidence';

// ── the form's pickers ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
export interface ControlLite { code: string; title: string }
export interface RiskLite { id: number; title: string; category?: string | null }
export interface Opt { value: string; label: string }

/** The options with the value already held put first when the list does not have it (a requirement that was renamed, a person who left), so it stays visible. */
export function withCurrent<T extends Opt>(options: T[], current: string): Array<Opt | T> {
  return current && !options.some((o) => o.value === current) ? [{ value: current, label: current }, ...options] : options;
}

/** A requirement picker stores the code when it also fills a companion column (or in a generated register), else the whole "code — title" line (ISO Internal Audit and Risk Treatment, as they always did). */
export function controlStores(def: RegDef, col: RegColumn): 'code' | 'line' {
  return def.shape === 'columns' && !col.autofillKey ? 'line' : 'code';
}

export function controlOptions(controls: ControlLite[], current: string, stores: 'code' | 'line'): Array<Opt> {
  const line = (c: ControlLite) => (c.title ? `${c.code} — ${c.title}` : c.code);
  const list = controls.map((c) => ({ value: stores === 'code' ? c.code : line(c), label: line(c) }));
  return withCurrent(list, current);
}

/** What choosing a requirement changes in the draft: the column, and the companion column with the requirement's text when there is one. */
export function pickControl(col: RegColumn, value: string, controls: ControlLite[]): Record<string, unknown> {
  const patch: Record<string, unknown> = { [col.key]: value };
  if (col.autofillKey) {
    const hit = controls.find((c) => c.code === value);
    if (hit?.title) patch[col.autofillKey] = hit.title;
  }
  return patch;
}

export const riskOptions = (risks: RiskLite[]): Opt[] => risks.map((r) => ({ value: String(r.id), label: r.title || 'Untitled risk' }));

/** What choosing a risk changes in the draft: the link, the reference "#id" and the title (a cleared choice keeps what was typed). */
export function pickRisk(draft: Record<string, unknown>, riskId: number | null, risks: RiskLite[]): Record<string, unknown> {
  const risk = risks.find((r) => r.id === riskId);
  return {
    risk_register_id: riskId,
    reference: risk ? `#${risk.id}` : draft.reference,
    title: risk ? (risk.title || draft.title || '') : draft.title,
  };
}

/** Whether a draft differs from what the form opened with (an unset value, an empty one and a missing one are the same). */
export function sameDraft(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const norm = (v: unknown) => (v == null ? '' : String(v));
  return Array.from(new Set([...Object.keys(a), ...Object.keys(b)])).every((k) => norm(a[k]) === norm(b[k]));
}
