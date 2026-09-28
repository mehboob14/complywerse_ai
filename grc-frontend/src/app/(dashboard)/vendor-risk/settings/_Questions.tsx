'use client';

// The onboarding questions, as this organisation asks them. Built-in questions
// can be reworded, made optional or hidden; your own can be of any answer type,
// in any section or in sections of your own, raise a tiering factor and ask the
// supplier for evidence. Each question opens to be edited; nothing is saved
// until the page's save bar is used.

import { useState } from 'react';
import { clsx } from 'clsx';
import { ArrowDown, ArrowUp, ChevronDown, EyeOff, Plus, RotateCcw, Trash2, Undo2 } from 'lucide-react';
import { fieldCls } from './_ui';

export interface Opt { value: string; label: string; archived?: boolean; points?: number }
export interface CustomQuestion {
  key: string; section: string; type: string; label: string; help?: string; required?: boolean; justify?: boolean;
  show_if?: string | null; options?: Opt[]; factor?: string | null; points?: number; evidence?: string | null;
  order?: number; archived?: boolean;
}
export interface BuiltinChange { label?: string; help?: string; required?: boolean; hidden?: boolean; options?: Opt[]; evidence?: string }
export interface QuestionsDraft {
  sections: Array<{ key: string; title: string; archived?: boolean }>;
  builtin_sections: Record<string, { title: string }>;
  builtin: Record<string, BuiltinChange>;
  questions: CustomQuestion[];
}
export interface BuiltinQuestion {
  key: string; type: string; label: string; required?: boolean; justify?: boolean; show_if?: string;
  options?: Array<{ value: string; label: string }>;
}
export interface BuiltinSection { key: string; title: string; questions: BuiltinQuestion[] }

export const TYPE_LABEL: Record<string, string> = {
  yes_no: 'Yes or no', choice: 'One choice', multi_choice: 'Several choices', level: 'Level, none to severe',
  number: 'Number', date: 'Date', text: 'Text',
};
const SCORED = ['yes_no', 'choice', 'multi_choice', 'level'];
const slug = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 30) || 'item';

/** A key made from a name, not yet taken; keys never change once saved. */
export function newKey(label: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const base = `c_${slug(label)}`;
  let key = base;
  for (let i = 2; used.has(key); i += 1) key = `${base}_${i}`;
  return key;
}

export function questionsSummary(d: QuestionsDraft, builtin: BuiltinSection[]): string {
  const own = d.questions.filter((q) => !q.archived).length;
  const hidden = Object.values(d.builtin).filter((c) => c.hidden).length;
  const total = builtin.reduce((n, s) => n + s.questions.length, 0) - hidden + own;
  const sections = builtin.length + d.sections.filter((s) => !s.archived).length;
  return `${sections} sections · ${total} questions asked` + (own ? ` · ${own} of your own` : '') + (hidden ? ` · ${hidden} built-in hidden` : '');
}

export function questionsProblems(d: QuestionsDraft): string[] {
  const out: string[] = [];
  d.questions.filter((q) => !q.archived).forEach((q) => {
    if (!q.label.trim()) out.push('Every question needs its wording');
    if (['choice', 'multi_choice'].includes(q.type) && !(q.options || []).some((o) => !o.archived && o.label.trim())) {
      out.push(`"${q.label || 'A question'}" needs at least one option`);
    }
  });
  return out;
}

export default function QuestionsEditor({ value, onChange, builtin, factors, evidence, savedKeys, canEdit }: {
  value: QuestionsDraft; onChange: (next: QuestionsDraft) => void; builtin: BuiltinSection[];
  factors: Array<{ key: string; label: string }>; evidence: Record<string, string>; savedKeys: Set<string>; canEdit: boolean;
}) {
  const [sectionKey, setSectionKey] = useState(builtin[0]?.key || '');
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [newSection, setNewSection] = useState('');
  const [newQuestion, setNewQuestion] = useState('');
  const [newType, setNewType] = useState('yes_no');

  const sections = [
    ...builtin.map((s) => ({ key: s.key, title: value.builtin_sections[s.key]?.title || s.title, builtin: true })),
    ...value.sections.filter((s) => !s.archived).map((s) => ({ key: s.key, title: s.title, builtin: false })),
  ];
  const current = sections.find((s) => s.key === sectionKey) || sections[0];
  const own = value.questions.filter((q) => q.section === current?.key);
  const builtinHere = builtin.find((s) => s.key === current?.key)?.questions || [];
  const takenKeys = [...builtin.flatMap((s) => s.questions.map((q) => q.key)), ...value.questions.map((q) => q.key)];
  const yesNo = [
    ...builtin.flatMap((s) => s.questions).filter((q) => q.type === 'yes_no' && !value.builtin[q.key]?.hidden)
      .map((q) => ({ key: q.key, label: value.builtin[q.key]?.label || q.label })),
    ...value.questions.filter((q) => q.type === 'yes_no' && !q.archived).map((q) => ({ key: q.key, label: q.label })),
  ];

  const setQuestions = (questions: CustomQuestion[]) => onChange({ ...value, questions: questions.map((q, i) => ({ ...q, order: i + 1 })) });
  const editQ = (key: string, patch: Partial<CustomQuestion>) => setQuestions(value.questions.map((q) => (q.key === key ? { ...q, ...patch } : q)));
  const editB = (key: string, patch: Partial<BuiltinChange>) => {
    const next = { ...(value.builtin[key] || {}), ...patch };
    (Object.keys(next) as Array<keyof BuiltinChange>).forEach((k) => { if (next[k] === undefined || next[k] === '') delete next[k]; });
    const builtinNext = { ...value.builtin, [key]: next };
    if (!Object.keys(next).length) delete builtinNext[key];
    onChange({ ...value, builtin: builtinNext });
  };
  const move = (key: string, step: -1 | 1) => {
    const list = [...value.questions];
    const at = list.findIndex((q) => q.key === key);
    let to = at + step;
    while (to >= 0 && to < list.length && (list[to].section !== list[at].section || list[to].archived)) to += step;
    if (to < 0 || to >= list.length) return;
    [list[at], list[to]] = [list[to], list[at]];
    setQuestions(list);
  };
  const addQuestion = () => {
    const label = newQuestion.trim();
    if (!label || !current) return;
    const key = newKey(label, takenKeys);
    const q: CustomQuestion = { key, section: current.key, type: newType, label, help: '', required: false, justify: false,
      show_if: null, options: ['choice', 'multi_choice'].includes(newType) ? [{ value: 'option_1', label: 'Option 1', points: 0 }] : [],
      factor: null, points: 0, evidence: null };
    setQuestions([...value.questions, q]);
    setNewQuestion('');
    setOpenKey(key);
  };
  const addSection = () => {
    const title = newSection.trim();
    if (!title) return;
    const key = newKey(title, [...builtin.map((s) => s.key), ...value.sections.map((s) => s.key)]);
    onChange({ ...value, sections: [...value.sections, { key, title }] });
    setNewSection('');
    setSectionKey(key);
  };
  const retitle = (title: string) => {
    if (!current) return;
    if (current.builtin) {
      const next = { ...value.builtin_sections };
      if (title.trim()) next[current.key] = { title }; else delete next[current.key];
      onChange({ ...value, builtin_sections: next });
    } else {
      onChange({ ...value, sections: value.sections.map((s) => (s.key === current.key ? { ...s, title } : s)) });
    }
  };
  const activeHere = own.filter((q) => !q.archived);
  const removed = own.filter((q) => q.archived);

  return (
    <div>
      <p className="mb-3 text-xs leading-relaxed text-slate-500">
        Anyone asking for a new supplier answers these. The answers set the tiering factors, so the tier follows from facts.
        Add your own questions of any type, reword or hide the built-in ones, and say what an answer adds to a factor or
        what evidence a yes asks the supplier for.
      </p>

      <div className="mb-3 flex flex-wrap items-center gap-1.5" role="tablist" aria-label="Sections of the form">
        {sections.map((s) => (
          <button key={s.key} type="button" role="tab" aria-selected={current?.key === s.key}
            onClick={() => { setSectionKey(s.key); setOpenKey(null); }}
            className={clsx('rounded-full border px-3 py-1 text-xs font-medium transition-colors',
              current?.key === s.key ? 'border-primary-300 bg-primary-50 text-primary-800' : 'border-slate-200 text-slate-600 hover:bg-slate-50')}>
            {s.title}
          </button>
        ))}
        {canEdit && (
          <span className="inline-flex items-center gap-1">
            <input value={newSection} onChange={(e) => setNewSection(e.target.value)} placeholder="New section"
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addSection(); } }}
              className="w-32 rounded-full border border-dashed border-slate-300 px-3 py-1 text-xs focus:border-primary-500 focus:outline-none" />
            <button type="button" onClick={addSection} disabled={!newSection.trim()} aria-label="Add the section"
              className="rounded-full p-1 text-slate-500 hover:bg-slate-100 disabled:opacity-40"><Plus className="h-3.5 w-3.5" /></button>
          </span>
        )}
      </div>

      {current && (
        <div className="rounded-lg border border-slate-200">
          <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 bg-slate-50/60 px-3 py-2">
            <label className="flex min-w-0 flex-1 items-center gap-2 text-xs text-slate-500">
              Section title
              <input value={current.title} disabled={!canEdit} onChange={(e) => retitle(e.target.value)}
                className="min-w-0 flex-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-sm text-slate-800 disabled:bg-slate-50" />
            </label>
            {!current.builtin && canEdit && (
              <button type="button" disabled={activeHere.length > 0}
                title={activeHere.length ? 'Move or remove its questions first' : 'Remove this section'}
                onClick={() => { onChange({ ...value, sections: value.sections.map((s) => (s.key === current.key ? { ...s, archived: true } : s)) }); setSectionKey(builtin[0]?.key || ''); }}
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-rose-600 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-40">
                <Trash2 className="h-3.5 w-3.5" /> Remove section
              </button>
            )}
          </div>

          <ul className="divide-y divide-slate-100">
            {builtinHere.map((q) => {
              const change = value.builtin[q.key] || {};
              return (
                <QuestionRow key={q.key} open={openKey === q.key} onToggle={() => setOpenKey(openKey === q.key ? null : q.key)}
                  label={change.label || q.label} type={q.type} builtin hidden={!!change.hidden}
                  required={change.required ?? !!q.required} evidence={change.evidence ? evidence[change.evidence] : undefined}>
                  <BuiltinEditor q={q} change={change} canEdit={canEdit} evidence={evidence}
                    onChange={(patch) => editB(q.key, patch)} onReset={() => editB(q.key, { label: undefined, help: undefined, required: undefined, hidden: undefined, options: undefined, evidence: undefined })} />
                </QuestionRow>
              );
            })}
            {activeHere.map((q) => (
              <QuestionRow key={q.key} open={openKey === q.key} onToggle={() => setOpenKey(openKey === q.key ? null : q.key)}
                label={q.label || 'New question'} type={q.type} required={!!q.required}
                factor={q.factor ? `${factors.find((f) => f.key === q.factor)?.label || q.factor}` : undefined}
                evidence={q.evidence ? evidence[q.evidence] : undefined}
                showIf={q.show_if ? yesNo.find((y) => y.key === q.show_if)?.label : undefined}>
                <CustomEditor q={q} canEdit={canEdit} typeLocked={savedKeys.has(q.key)} factors={factors} evidence={evidence}
                  yesNo={yesNo.filter((y) => y.key !== q.key)} sections={sections}
                  onChange={(patch) => editQ(q.key, patch)} onMove={(step) => move(q.key, step)}
                  onRemove={() => { editQ(q.key, { archived: true }); setOpenKey(null); }} />
              </QuestionRow>
            ))}
            {builtinHere.length === 0 && activeHere.length === 0 && (
              <li className="px-3 py-4 text-center text-xs text-slate-400">No questions in this section yet.</li>
            )}
          </ul>

          {canEdit && (
            <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 px-3 py-2.5">
              <input value={newQuestion} onChange={(e) => setNewQuestion(e.target.value)} placeholder="Ask a new question…"
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addQuestion(); } }}
                className={clsx(fieldCls, 'min-w-0 flex-1')} aria-label="The new question" />
              <select value={newType} onChange={(e) => setNewType(e.target.value)} aria-label="Its answer type"
                className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm">
                {Object.entries(TYPE_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
              <button type="button" onClick={addQuestion} disabled={!newQuestion.trim()}
                className="inline-flex items-center gap-1 rounded-lg bg-primary-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50">
                <Plus className="h-4 w-4" /> Add question
              </button>
            </div>
          )}
          {removed.length > 0 && (
            <details className="border-t border-slate-100 px-3 py-2">
              <summary className="cursor-pointer text-xs text-slate-500">Taken off the form ({removed.length}); answers already given are kept</summary>
              <ul className="mt-1 space-y-1">
                {removed.map((q) => (
                  <li key={q.key} className="flex items-center justify-between gap-2 text-xs text-slate-600">
                    {q.label}
                    {canEdit && (
                      <button type="button" onClick={() => editQ(q.key, { archived: false })}
                        className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-primary-700 hover:bg-primary-50">
                        <Undo2 className="h-3 w-3" /> Put back
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

function QuestionRow({ open, onToggle, label, type, builtin, hidden, required, factor, evidence, showIf, children }: {
  open: boolean; onToggle: () => void; label: string; type: string; builtin?: boolean; hidden?: boolean; required?: boolean;
  factor?: string; evidence?: string; showIf?: string; children: React.ReactNode;
}) {
  const chip = 'rounded-full border px-1.5 py-px text-[10px] font-medium';
  return (
    <li className={clsx(hidden && 'bg-slate-50/70')}>
      <button type="button" onClick={onToggle} aria-expanded={open}
        className="flex w-full items-start gap-2 px-3 py-2.5 text-left hover:bg-slate-50">
        <span className="min-w-0 flex-1">
          <span className={clsx('block text-sm', hidden ? 'text-slate-400 line-through' : 'text-slate-800')}>{label}</span>
          <span className="mt-1 flex flex-wrap gap-1">
            <span className={clsx(chip, 'border-slate-200 text-slate-500')}>{TYPE_LABEL[type] || type}</span>
            {builtin && <span className={clsx(chip, 'border-slate-200 bg-slate-100 text-slate-500')}>Built-in</span>}
            {required && <span className={clsx(chip, 'border-amber-200 bg-amber-50 text-amber-800')}>Required</span>}
            {hidden && <span className={clsx(chip, 'border-slate-300 text-slate-500')}><EyeOff className="mr-0.5 inline h-2.5 w-2.5" />Hidden</span>}
            {factor && <span className={clsx(chip, 'border-primary-200 bg-primary-50 text-primary-800')}>Feeds {factor}</span>}
            {evidence && <span className={clsx(chip, 'border-emerald-200 bg-emerald-50 text-emerald-800')}>Asks for {evidence}</span>}
            {showIf && <span className={clsx(chip, 'border-slate-200 text-slate-500')}>Only if yes to: {showIf}</span>}
          </span>
        </span>
        <ChevronDown className={clsx('mt-0.5 h-4 w-4 shrink-0 text-slate-400 transition-transform', open && 'rotate-180')} aria-hidden />
      </button>
      {open && <div className="border-t border-dashed border-slate-200 bg-slate-50/50 px-3 py-3">{children}</div>}
    </li>
  );
}

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="block text-xs font-medium text-slate-600">
      {label}
      <span className="mt-1 block font-normal">{children}</span>
      {hint && <span className="mt-0.5 block font-normal text-[11px] text-slate-400">{hint}</span>}
    </label>
  );
}

function OptionsEditor({ options, scored, canEdit, onChange, fixed = [] }: {
  options: Opt[]; scored: boolean; canEdit: boolean; onChange: (next: Opt[]) => void; fixed?: string[];
}) {
  const [label, setLabel] = useState('');
  const add = () => {
    const text = label.trim();
    if (!text) return;
    const taken = new Set(options.map((o) => o.value));
    let v = slug(text).slice(0, 36);
    for (let i = 2; taken.has(v); i += 1) v = `${slug(text).slice(0, 34)}_${i}`;
    onChange([...options, { value: v, label: text, ...(scored ? { points: 0 } : {}) }]);
    setLabel('');
  };
  return (
    <div className="space-y-1.5">
      {options.map((o, i) => (
        <div key={o.value} className={clsx('flex items-center gap-2', o.archived && 'opacity-50')}>
          <input value={o.label} disabled={!canEdit || o.archived} aria-label={`Option ${i + 1}`}
            onChange={(e) => onChange(options.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
            className={clsx(fieldCls, 'flex-1')} />
          {scored && (
            <label className="flex items-center gap-1 text-[11px] text-slate-500">
              points
              <select value={o.points ?? 0} disabled={!canEdit || o.archived}
                onChange={(e) => onChange(options.map((x, j) => (j === i ? { ...x, points: Number(e.target.value) } : x)))}
                className="rounded-md border border-slate-300 bg-white px-1.5 py-1 text-xs">
                {[0, 1, 2, 3, 4].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
          )}
          {canEdit && (
            o.archived ? (
              <button type="button" onClick={() => onChange(options.map((x, j) => (j === i ? { ...x, archived: false } : x)))}
                className="rounded p-1 text-primary-700 hover:bg-primary-50" aria-label={`Put back ${o.label}`}><Undo2 className="h-3.5 w-3.5" /></button>
            ) : (
              <button type="button" aria-label={`Remove ${o.label}`}
                onClick={() => onChange(fixed.includes(o.value) ? options.map((x, j) => (j === i ? { ...x, archived: true } : x)) : options.filter((_, j) => j !== i))}
                className="rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600"><Trash2 className="h-3.5 w-3.5" /></button>
            )
          )}
        </div>
      ))}
      {canEdit && (
        <div className="flex items-center gap-2">
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Add an option"
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
            className={clsx(fieldCls, 'flex-1 border-dashed')} />
          <button type="button" onClick={add} disabled={!label.trim()} className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs text-slate-600 hover:bg-white disabled:opacity-40">Add</button>
        </div>
      )}
    </div>
  );
}

function BuiltinEditor({ q, change, canEdit, evidence, onChange, onReset }: {
  q: BuiltinQuestion; change: BuiltinChange; canEdit: boolean; evidence: Record<string, string>;
  onChange: (patch: Partial<BuiltinChange>) => void; onReset: () => void;
}) {
  const options: Opt[] = change.options || (q.options || []).map((o) => ({ ...o }));
  return (
    <fieldset disabled={!canEdit} className="grid gap-3 sm:grid-cols-2">
      <div className="sm:col-span-2"><Field label="Question">
        <input className={fieldCls} value={change.label ?? q.label} onChange={(e) => onChange({ label: e.target.value === q.label ? undefined : e.target.value })} />
      </Field></div>
      <div className="sm:col-span-2"><Field label="Help shown under it (optional)">
        <input className={fieldCls} value={change.help || ''} onChange={(e) => onChange({ help: e.target.value || undefined })} />
      </Field></div>
      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input type="checkbox" checked={change.required ?? !!q.required} onChange={(e) => onChange({ required: e.target.checked === !!q.required ? undefined : e.target.checked })} />
        Must be answered
      </label>
      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input type="checkbox" checked={!!change.hidden} onChange={(e) => onChange({ hidden: e.target.checked || undefined })} />
        Hide from the form
      </label>
      {change.hidden && (
        <p className="sm:col-span-2 rounded-md bg-amber-50 px-2 py-1.5 text-[11px] text-amber-800">
          Hidden questions are not asked, so their built-in tiering rule stops counting for new requests.
        </p>
      )}
      {q.type === 'yes_no' && (
        <Field label="A yes also asks the supplier for" hint="On top of what its tier asks for.">
          <select className={fieldCls} value={change.evidence || ''} onChange={(e) => onChange({ evidence: e.target.value || undefined })}>
            <option value="">Nothing more</option>
            {Object.entries(evidence).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </Field>
      )}
      {q.type === 'choice' && (
        <div className="sm:col-span-2">
          <p className="mb-1 text-xs font-medium text-slate-600">Options</p>
          <OptionsEditor options={options} scored={false} canEdit={canEdit} fixed={(q.options || []).map((o) => o.value)}
            onChange={(next) => onChange({ options: next })} />
          <p className="mt-1 text-[11px] text-slate-400">Built-in options can be renamed or taken off, not deleted: the tiering rules read them. New options count as a supplier that supplies us.</p>
        </div>
      )}
      <div className="sm:col-span-2 flex justify-end">
        <button type="button" onClick={onReset} className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-slate-500 hover:bg-white">
          <RotateCcw className="h-3 w-3" /> Back to the built-in question
        </button>
      </div>
    </fieldset>
  );
}

function CustomEditor({ q, canEdit, typeLocked, factors, evidence, yesNo, sections, onChange, onMove, onRemove }: {
  q: CustomQuestion; canEdit: boolean; typeLocked: boolean; factors: Array<{ key: string; label: string }>;
  evidence: Record<string, string>; yesNo: Array<{ key: string; label: string }>; sections: Array<{ key: string; title: string }>;
  onChange: (patch: Partial<CustomQuestion>) => void; onMove: (step: -1 | 1) => void; onRemove: () => void;
}) {
  const scored = SCORED.includes(q.type);
  return (
    <fieldset disabled={!canEdit} className="grid gap-3 sm:grid-cols-2">
      <div className="sm:col-span-2"><Field label="Question">
        <input className={fieldCls} value={q.label} onChange={(e) => onChange({ label: e.target.value })} />
      </Field></div>
      <div className="sm:col-span-2"><Field label="Help shown under it (optional)">
        <input className={fieldCls} value={q.help || ''} onChange={(e) => onChange({ help: e.target.value })} />
      </Field></div>
      <Field label="Answer type" hint={typeLocked ? 'Fixed once saved; answers are kept in this type.' : undefined}>
        <select className={fieldCls} value={q.type} disabled={typeLocked}
          onChange={(e) => onChange({ type: e.target.value, factor: SCORED.includes(e.target.value) ? q.factor : null,
            options: ['choice', 'multi_choice'].includes(e.target.value) ? (q.options?.length ? q.options : [{ value: 'option_1', label: 'Option 1', points: 0 }]) : [] })}>
          {Object.entries(TYPE_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      </Field>
      <Field label="Section">
        <select className={fieldCls} value={q.section} onChange={(e) => onChange({ section: e.target.value })}>
          {sections.map((s) => <option key={s.key} value={s.key}>{s.title}</option>)}
        </select>
      </Field>
      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input type="checkbox" checked={!!q.required} onChange={(e) => onChange({ required: e.target.checked })} /> Must be answered
      </label>
      {q.type === 'yes_no' ? (
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={!!q.justify} onChange={(e) => onChange({ justify: e.target.checked })} /> A yes needs a reason
        </label>
      ) : <span />}
      <div className="sm:col-span-2"><Field label="Ask it only when the answer to this is yes">
        <select className={fieldCls} value={q.show_if || ''} onChange={(e) => onChange({ show_if: e.target.value || null })}>
          <option value="">Always ask it</option>
          {yesNo.map((y) => <option key={y.key} value={y.key}>{y.label}</option>)}
        </select>
      </Field></div>
      {['choice', 'multi_choice'].includes(q.type) && (
        <div className="sm:col-span-2">
          <p className="mb-1 text-xs font-medium text-slate-600">Options{q.factor ? ' and the points each adds' : ''}</p>
          <OptionsEditor options={q.options || []} scored={!!q.factor} canEdit={canEdit} onChange={(next) => onChange({ options: next })} />
        </div>
      )}
      {scored && (
        <div className="sm:col-span-2 grid gap-3 rounded-lg border border-slate-200 bg-white p-2.5 sm:grid-cols-2">
          <Field label="Counts towards the tier through" hint="Raises that factor to at least the points given, out of 4.">
            <select className={fieldCls} value={q.factor || ''} onChange={(e) => onChange({ factor: e.target.value || null })}>
              <option value="">Doesn’t change the tier</option>
              {factors.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
            </select>
          </Field>
          {q.factor && q.type === 'yes_no' && (
            <Field label="A yes raises it to">
              <select className={fieldCls} value={q.points ?? 0} onChange={(e) => onChange({ points: Number(e.target.value) })}>
                {[0, 1, 2, 3, 4].map((n) => <option key={n} value={n}>{n} of 4</option>)}
              </select>
            </Field>
          )}
          {q.factor && q.type === 'level' && <p className="self-end text-[11px] text-slate-500">Raised to the level chosen: none 0, low 1, moderate 2, high 3, severe 4.</p>}
          {q.factor && ['choice', 'multi_choice'].includes(q.type) && <p className="self-end text-[11px] text-slate-500">Set the points on each option above; with several chosen, the highest counts.</p>}
        </div>
      )}
      {q.type === 'yes_no' && (
        <div className="sm:col-span-2"><Field label="A yes asks the supplier for" hint="On top of what its tier asks for.">
          <select className={fieldCls} value={q.evidence || ''} onChange={(e) => onChange({ evidence: e.target.value || null })}>
            <option value="">Nothing more</option>
            {Object.entries(evidence).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </Field></div>
      )}
      {canEdit && (
        <div className="sm:col-span-2 flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 pt-2">
          <span className="flex gap-1">
            <button type="button" onClick={() => onMove(-1)} className="rounded p-1 text-slate-500 hover:bg-white" aria-label="Move up"><ArrowUp className="h-3.5 w-3.5" /></button>
            <button type="button" onClick={() => onMove(1)} className="rounded p-1 text-slate-500 hover:bg-white" aria-label="Move down"><ArrowDown className="h-3.5 w-3.5" /></button>
          </span>
          <button type="button" onClick={onRemove} className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-rose-600 hover:bg-rose-50">
            <Trash2 className="h-3.5 w-3.5" /> Take off the form
          </button>
        </div>
      )}
    </fieldset>
  );
}
