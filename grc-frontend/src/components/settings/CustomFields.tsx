'use client';

/** The tenant's own fields and dropdowns, inside the add/edit popup of a record.
 *
 *  Every module that opts in on the backend (services/module_settings.py) gets
 *  the same "Custom fields" tab: fill the fields in, and — for people allowed to
 *  change the module's settings — add, rename, retype, reorder or remove fields,
 *  and edit the options of the module's built-in dropdowns. The form is the
 *  tenant's, not a per-client template of ours.
 *
 *  Removing a field or an option archives it: values already recorded against
 *  it are evidence, so they stay on the record and keep their name.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowDown, ArrowUp, Check, Loader2, Plus, RotateCcw, Settings2, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import apiClient from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';
import ImportFieldsFromTemplate from './ImportFieldsFromTemplate';

export type FieldDef = {
  key: string; label: string; type: string; required: boolean;
  options: string[]; help: string; order: number; archived?: boolean;
  /** Another dropdown this one follows. `groups` maps each of that field's options to this field's options. */
  depends_on?: string | null;
  groups?: Record<string, string[]>;
};
export type ListOption = { value: string; label: string; archived?: boolean; children?: string[] };
export type ListDef = {
  label: string; free_text: boolean; note?: string | null; child_label?: string | null; options: ListOption[];
};
export type SlaTarget = { days: number | null; notify_before: number | null; escalate_after: number | null };
export type Sla = {
  by_priority: Record<string, number>; driver: string; targets: Record<string, SlaTarget>;
  due_soon_days: number; escalate_after_days: number; escalate_to: string[];
  remind_before_due: number; repeat_every: number;
};
export type StatusLevel = {
  key: string; label: string; order: number; terminal: boolean;
  tone: string; escalate_after_days: number | null; clock?: 'runs' | 'paused';
};
export type BuiltinField = {
  key: string; label: string; type: string; required: boolean;
  locked?: boolean; hidden?: boolean; list?: string | null;
};
export type ModuleSettings = {
  statuses?: StatusLevel[]; sla?: Sla; fields: FieldDef[]; lists?: Record<string, ListDef>;
  builtins?: BuiltinField[];
  module: {
    key: string; label: string; record: string; priorities: string[]; sections: string[];
    permissions?: { view?: string; edit?: string };
  };
  updated_at: string | null;
};
export type CustomValues = Record<string, unknown>;

export const FIELD_TYPES: Array<[string, string]> = [
  ['text', 'Short text'], ['textarea', 'Long text'], ['number', 'Number'], ['date', 'Date'],
  ['select', 'Dropdown'], ['multiselect', 'Multi-select'], ['checkbox', 'Yes / no'], ['user', 'Person'],
];

const input = 'w-full rounded border border-slate-200 bg-white px-2.5 py-1.5 text-sm text-slate-900 focus:border-blue-500 focus:outline-none';
const slug = (text: string) => text.toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
const blank = (value: unknown) => value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0);

// ── data ─────────────────────────────────────────────────────────────────────

const settingsKey = (moduleKey: string) => ['module-settings', moduleKey];

export function useModuleSettings(moduleKey: string) {
  return useQuery<ModuleSettings>({
    queryKey: settingsKey(moduleKey),
    queryFn: async () => (await apiClient.get(`/module-settings/${moduleKey}`)).data,
    staleTime: 60_000,
  });
}

export function useSaveModuleSettings(moduleKey: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: Record<string, unknown>) =>
      (await apiClient.put(`/module-settings/${moduleKey}`, patch)).data as ModuleSettings,
    onSuccess: (saved) => qc.setQueryData(settingsKey(moduleKey), saved),
  });
}

/** Whether this person may change the module's form. */
export function useCanCustomise(settings?: ModuleSettings) {
  const { hasPermission, isLoading } = usePermissions();
  const edit = settings?.module.permissions?.edit;
  return !isLoading && !!edit && hasPermission(edit);
}

export const errorText = (e: unknown, fallback = 'Could not save.') => {
  const detail = (e as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
  return typeof detail === 'string' ? detail : fallback;
};

/** A built-in dropdown's options as the tenant set them. The record's own value
 *  stays selectable when it has since been removed, or was typed in. */
/** Status levels the tenant configured, or the list the form shipped with. */
export function statusChoices(settings: ModuleSettings | undefined,
                              fallback: { value: string; label: string }[]) {
  const rows = (settings?.statuses || []).filter((s) => s.key);
  return rows.length ? rows.map((s) => ({ value: s.key, label: s.label || s.key })) : fallback;
}

export function listOptions(settings: ModuleSettings | undefined, key: string, current?: string | null,
                            fallback: ListOption[] = []): ListOption[] {
  const shown = (settings?.lists?.[key]?.options ?? fallback).filter((o) => !o.archived || o.value === current);
  if (current && !shown.some((o) => o.value === current)) shown.push({ value: current, label: current });
  return shown;
}

/** The fields a record's form shows: the live ones, in the tenant's order. */
export const builtinOf = (settings: ModuleSettings | undefined, key: string) =>
  settings?.builtins?.find((b) => b.key === key);

/** False once an admin has removed this existing field from the form. */
export const showBuiltin = (settings: ModuleSettings | undefined, key: string) =>
  !builtinOf(settings, key)?.hidden;

export const builtinLabel = (settings: ModuleSettings | undefined, key: string, fallback: string) =>
  builtinOf(settings, key)?.label || fallback;

export const liveFields = (settings?: ModuleSettings) =>
  (settings?.fields || []).filter((f) => !f.archived).sort((a, b) => a.order - b.order);

/** What the form sends. A new record: every live field (so required ones are
 *  checked). An edit (`initial` given): only the fields changed, a cleared one as
 *  null — so a screen that loaded the record without its values can't blank
 *  them. Never a removed field. Undefined means "leave the values as they are". */
export function valuesToSave(settings: ModuleSettings | undefined, values: CustomValues,
                             initial?: CustomValues | null): CustomValues | undefined {
  if (!settings) return undefined;
  const norm = (v: unknown) => (blank(v) ? null : v);
  const all = liveFields(settings).map((f) => [f.key, norm(values[f.key])] as const);
  if (!initial) return Object.fromEntries(all);
  const changed = all.filter(([k, v]) => JSON.stringify(v) !== JSON.stringify(norm(initial[k])));
  return changed.length ? Object.fromEntries(changed) : undefined;
}

/** Which tab holds a form control — for jumping to a required field left empty. */
export const tabOf = (target: EventTarget | null): 'details' | 'custom' =>
  (target as HTMLElement | null)?.closest?.('[data-tab]')?.getAttribute('data-tab') === 'custom' ? 'custom' : 'details';

function usePeople(moduleKey: string, enabled: boolean) {
  return useQuery<Array<{ id: number; display_name: string }>>({
    queryKey: ['module-people', moduleKey],
    queryFn: async () => (await apiClient.get(`/module-settings/${moduleKey}/people`)).data,
    enabled,
    staleTime: 5 * 60_000,
  }).data || [];
}

// ── filling the fields in ────────────────────────────────────────────────────

export function CustomFieldInputs({ moduleKey, fields, values, onChange }: {
  moduleKey: string; fields: FieldDef[]; values: CustomValues; onChange: (next: CustomValues) => void;
}) {
  const people = usePeople(moduleKey, fields.some((f) => f.type === 'user'));
  const set = (key: string, value: unknown) => {
    const next: CustomValues = { ...values, [key]: value };
    // A child dropdown only makes sense for the parent that was just picked.
    for (const child of fields) {
      if (child.depends_on === key) next[child.key] = child.type === 'multiselect' ? [] : '';
    }
    onChange(next);
  };
  const choicesFor = (f: FieldDef): string[] => {
    if (!f.depends_on) return f.options || [];
    const parent = values[f.depends_on];
    const key = typeof parent === 'string' ? parent : '';
    return (key && f.groups?.[key]) || [];
  };

  return (
    <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
      {fields.map((f) => {
        const value = values[f.key];
        const text = blank(value) ? '' : String(value);
        const wide = f.type === 'textarea' || f.type === 'multiselect';
        return (
          <div key={f.key} className={wide ? 'sm:col-span-2' : ''}>
            {f.type !== 'checkbox' && (
              <label className="mb-0.5 block text-xs font-medium text-slate-600">
                {f.label}{f.required && <span className="text-rose-600"> *</span>}
              </label>
            )}
            {f.type === 'textarea' ? (
              <textarea rows={3} className={input} value={text} required={f.required}
                onChange={(e) => set(f.key, e.target.value)} />
            ) : f.type === 'select' ? (
              <select className={input} value={text} required={f.required && (!f.depends_on || !!values[f.depends_on])} onChange={(e) => set(f.key, e.target.value)}
                disabled={!!f.depends_on && !values[f.depends_on]}>
                <option value="">{f.depends_on && !values[f.depends_on]
                  ? `Select ${fields.find((p) => p.key === f.depends_on)?.label || 'the parent'} first`
                  : '— Select —'}</option>
                {(() => {
                  const opts = choicesFor(f);
                  return [...opts, ...(text && !opts.includes(text) ? [text] : [])];
                })().map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            ) : f.type === 'multiselect' ? (
              <div className="flex flex-wrap gap-1.5">
                {(() => {
                  const opts = choicesFor(f);
                  const picked = Array.isArray(value) ? (value as string[]) : [];
                  return [...opts, ...picked.filter((p) => !opts.includes(p))];
                })().map((o) => {
                  const picked = Array.isArray(value) ? (value as string[]) : [];
                  const on = picked.includes(o);
                  return (
                    <button key={o} type="button" aria-pressed={on}
                      onClick={() => set(f.key, on ? picked.filter((x) => x !== o) : [...picked, o])}
                      className={`rounded-full border px-2.5 py-0.5 text-xs ${on ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
                      {on && <Check className="-ml-0.5 mr-1 inline h-3 w-3" />}{o}
                    </button>
                  );
                })}
                {f.depends_on && choicesFor(f).length === 0 && (
                  <p className="text-[11px] text-slate-400">
                    {values[f.depends_on]
                      ? 'No options for this choice.'
                      : `Select ${fields.find((p) => p.key === f.depends_on)?.label || 'the parent'} first.`}
                  </p>
                )}
              </div>
            ) : f.type === 'checkbox' ? (
              <label className="mt-5 flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" checked={value === true} onChange={(e) => set(f.key, e.target.checked)} />
                {f.label}{f.required && <span className="text-rose-600"> *</span>}
              </label>
            ) : f.type === 'user' ? (
              <select className={input} value={text} required={f.required}
                onChange={(e) => set(f.key, e.target.value ? Number(e.target.value) : null)}>
                <option value="">— Nobody —</option>
                {people.map((p) => <option key={p.id} value={p.id}>{p.display_name}</option>)}
              </select>
            ) : (
              <input className={input} required={f.required} value={text}
                type={f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'}
                step={f.type === 'number' ? 'any' : undefined}
                onChange={(e) => set(f.key, e.target.value)} />
            )}
            {f.help && <p className="mt-0.5 text-[11px] text-slate-400">{f.help}</p>}
          </div>
        );
      })}
    </div>
  );
}

/** Values a record still holds for fields since removed — shown, not editable. */
function KeptValues({ settings, values }: { settings: ModuleSettings; values: CustomValues }) {
  const kept = settings.fields.filter((f) => f.archived && !blank(values[f.key]));
  if (!kept.length) return null;
  return (
    <p className="mt-3 text-[11px] text-slate-400">
      Kept from removed fields: {kept.map((f) => {
        const v = values[f.key];
        return `${f.label}: ${Array.isArray(v) ? v.join(', ') : v === true ? 'Yes' : v === false ? 'No' : String(v)}`;
      }).join(' · ')}
    </p>
  );
}

// ── changing the form ────────────────────────────────────────────────────────

/** Add one option at a time. A textarea of "one per line" was too easy to miss. */
function OptionRows({ options, onChange, placeholder }: {
  options: string[]; onChange: (next: string[]) => void; placeholder: string;
}) {
  const [adding, setAdding] = useState('');
  const add = () => {
    const text = adding.trim();
    if (!text || options.some((o) => o.trim() === text)) return;
    onChange([...options, text]);
    setAdding('');
  };
  return (
    <div className="space-y-1.5">
      {options.map((o, i) => (
        <div key={i} className="flex items-center gap-2">
          <input className={input} value={o} aria-label="Option"
            onChange={(e) => onChange(options.map((x, j) => (j === i ? e.target.value : x)))} />
          <button type="button" title="Remove option" onClick={() => onChange(options.filter((_, j) => j !== i))}
            className="rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600"><Trash2 className="h-3.5 w-3.5" /></button>
        </div>
      ))}
      <div className="flex items-center gap-2">
        <input className={input} value={adding} placeholder={placeholder} aria-label={placeholder}
          onChange={(e) => setAdding(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} />
        <button type="button" onClick={add}
          className="inline-flex shrink-0 items-center gap-1 rounded border border-slate-200 px-2.5 py-1.5 text-xs text-slate-700 hover:bg-slate-50">
          <Plus className="h-3 w-3" /> Add
        </button>
      </div>
    </div>
  );
}

const nextFieldKey = (draft: FieldDef[]) => {
  const taken = new Set(draft.map((f) => f.key));
  let n = draft.length + 1;
  let key = `field_${n}`;
  while (taken.has(key)) { n += 1; key = `field_${n}`; }
  return key;
};

export function FieldsEditor({ moduleKey, settings }: { moduleKey: string; settings: ModuleSettings }) {
  const save = useSaveModuleSettings(moduleKey);
  const [draft, setDraft] = useState<FieldDef[]>(() => liveFields(settings));
  const [done, setDone] = useState(false);
  // Reset when the saved form changes, not on every background refetch.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => setDraft(liveFields(settings)), [settings.updated_at]);

  const removed = settings.fields.filter((f) => f.archived && !draft.some((d) => d.key === f.key));
  const patch = (i: number, change: Partial<FieldDef>) => setDraft(draft.map((f, j) => (j === i ? { ...f, ...change } : f)));
  const move = (i: number, by: number) => {
    const next = [...draft];
    const [f] = next.splice(i, 1);
    next.splice(i + by, 0, f);
    setDraft(next);
  };

  const submit = () => {
    const taken = new Set(settings.fields.map((f) => f.key));
    const fields = draft.map((f, i) => {
      let key = f.key;
      if (!key) {                                   // a new field: keyed from its first label
        let stem = slug(f.label) || 'field';
        if (!/^[a-z][a-z0-9_]{1,39}$/.test(stem)) stem = `f_${stem}`.slice(0, 40);
        key = stem;
        for (let n = 2; taken.has(key); n += 1) key = `${stem.slice(0, 36)}_${n}`;
        taken.add(key);
      }
      const depends = (f.type === 'select' || f.type === 'multiselect') ? (f.depends_on || null) : null;
      const parent = depends ? draft.find((p) => p.key === depends) : undefined;
      const parentOptions = (parent?.options || []).map((o) => o.trim()).filter(Boolean);
      const groups = depends
        ? Object.fromEntries(parentOptions.map((name) => [name, (f.groups?.[name] || []).map((o) => o.trim()).filter(Boolean)]))
        : {};
      return { ...f, key, order: i + 1, archived: false, depends_on: depends, groups,
               options: depends ? [] : (f.options || []).map((o) => o.trim()).filter(Boolean) };
    });
    save.mutate({ fields }, { onSuccess: () => { setDone(true); setTimeout(() => setDone(false), 2000); } });
  };

  return (
    <div className="space-y-2">
      {draft.map((f, i) => {
        const dropdown = f.type === 'select' || f.type === 'multiselect';
        const parents = draft.filter((p, j) => j !== i && p.type === 'select' && !p.depends_on && p.key);
        const parent = parents.find((p) => p.key === f.depends_on);
        const parentOptions = (parent?.options || []).map((o) => o.trim()).filter(Boolean);
        const setType = (type: string) => setDraft(draft.map((row, j) => {
          if (j === i) return { ...row, type, depends_on: type === 'select' || type === 'multiselect' ? row.depends_on : null };
          if (row.depends_on === f.key && type !== 'select') return { ...row, depends_on: null, groups: {} };
          return row;
        }));
        const setOptions = (options: string[]) => {
          const prev = f.options || [];
          setDraft(draft.map((row, j) => {
            if (j === i) return { ...row, options };
            if (row.depends_on !== f.key || !row.groups) return row;
            const groups = { ...row.groups };
            prev.forEach((old, idx) => {
              const next = options[idx];
              if (old && next && old !== next && groups[old] && groups[next] === undefined) {
                groups[next] = groups[old];
                delete groups[old];
              }
            });
            return { ...row, groups };
          }));
        };
        return (
        <div key={f.key || `new-${i}`} className="rounded-md border border-slate-200 p-2">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1.4fr_1fr_auto_auto]">
            <input className={input} value={f.label} placeholder="Field name" aria-label="Field name"
              onChange={(e) => patch(i, { label: e.target.value })} />
            <select className={input} value={f.type} aria-label="Field type" onChange={(e) => setType(e.target.value)}>
              {FIELD_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
            <label className="flex items-center gap-1 whitespace-nowrap text-xs text-slate-600">
              <input type="checkbox" checked={f.required} onChange={(e) => patch(i, { required: e.target.checked })} /> Required
            </label>
            <div className="flex items-center justify-end">
              <button type="button" title="Move up" disabled={i === 0} onClick={() => move(i, -1)}
                className="rounded p-1 text-slate-400 hover:bg-slate-100 disabled:opacity-30"><ArrowUp className="h-3.5 w-3.5" /></button>
              <button type="button" title="Move down" disabled={i === draft.length - 1} onClick={() => move(i, 1)}
                className="rounded p-1 text-slate-400 hover:bg-slate-100 disabled:opacity-30"><ArrowDown className="h-3.5 w-3.5" /></button>
              <button type="button" title="Remove field"
                onClick={() => setDraft(draft.filter((_, j) => j !== i).map((row) => (
                  row.depends_on === f.key ? { ...row, depends_on: null, groups: {} } : row
                )))}
                className="rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600"><Trash2 className="h-3.5 w-3.5" /></button>
            </div>
          </div>
          <input className={`${input} mt-2`} placeholder="Help text (optional)" aria-label="Help text"
            value={f.help || ''} onChange={(e) => patch(i, { help: e.target.value })} />
          {dropdown && (
            <div className="mt-2 rounded-md bg-slate-50 p-2">
              <p className="mb-1.5 text-xs font-medium text-slate-700">Dropdown options</p>
              <label className="mb-2 block text-[11px] text-slate-500">
                Depends on
                <select className={`${input} mt-0.5`} aria-label="Depends on" value={f.depends_on || ''}
                  onChange={(e) => patch(i, { depends_on: e.target.value || null, options: e.target.value ? [] : f.options })}>
                  <option value="">Nothing — one list of options</option>
                  {parents.map((p) => <option key={p.key} value={p.key}>{p.label || p.key}</option>)}
                </select>
              </label>
              {f.depends_on && !parent && (
                <p className="text-[11px] text-amber-700">That dropdown is no longer on the form. Pick another, or use one list.</p>
              )}
              {f.depends_on && parent && parentOptions.length === 0 && (
                <p className="text-[11px] text-slate-500">Add options on {parent.label || 'that dropdown'} first. Each one gets its own list here.</p>
              )}
              {f.depends_on && parent && parentOptions.map((name) => (
                <div key={name} className="mb-2 border-l-2 border-slate-200 pl-2">
                  <p className="mb-1 text-[11px] font-medium text-slate-600">When {parent.label || 'it'} is {name}</p>
                  <OptionRows options={f.groups?.[name] || []} placeholder={`Add option for ${name}`}
                    onChange={(kids) => patch(i, { groups: { ...(f.groups || {}), [name]: kids } })} />
                </div>
              ))}
              {!f.depends_on && (
                <OptionRows options={f.options || []} placeholder="Add an option" onChange={setOptions} />
              )}
            </div>
          )}
        </div>
        );
      })}
      {draft.length === 0 && <p className="text-xs text-slate-400">No added fields yet.</p>}

      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
        <button type="button"
          onClick={() => setDraft([...draft, {
            key: nextFieldKey(draft), label: '', type: 'text', required: false, options: [], help: '', order: draft.length + 1,
          }])}
          className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 hover:underline">
          <Plus className="h-3 w-3" /> Add field
        </button>
        <ImportFieldsFromTemplate moduleKey={moduleKey} />
        <SaveButton label="Save fields" pending={save.isPending} done={done} onClick={submit} />
      </div>
      {save.isError && <ErrorLine text={errorText(save.error, 'Could not save the fields.')} />}
      {removed.length > 0 && (
        <p className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-400">
          Removed, values kept on records:
          {removed.map((f) => (
            <button key={f.key} type="button" title="Bring this field back"
              onClick={() => setDraft([...draft, { ...f, archived: false }])}
              className="inline-flex items-center gap-1 rounded-full border border-slate-200 px-2 py-0.5 hover:bg-slate-50">
              {f.label} <RotateCcw className="h-3 w-3" />
            </button>
          ))}
        </p>
      )}
    </div>
  );
}

export function ListsEditor({ moduleKey, settings }: { moduleKey: string; settings: ModuleSettings }) {
  const save = useSaveModuleSettings(moduleKey);
  const lists = settings.lists || {};
  const keys = Object.keys(lists);
  const [active, setActive] = useState(keys[0] || '');
  const [draft, setDraft] = useState<ListOption[]>(() => lists[active]?.options || []);
  const [adding, setAdding] = useState('');
  const [done, setDone] = useState(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => setDraft(lists[active]?.options || []), [active, settings.updated_at]);

  if (!keys.length) return <p className="text-xs text-slate-400">This form has no dropdowns you can change.</p>;
  const list = lists[active];
  const saved = new Set((list?.options || []).map((o) => o.value));
  const patch = (i: number, change: Partial<ListOption>) => setDraft(draft.map((o, j) => (j === i ? { ...o, ...change } : o)));
  const add = () => {
    const label = adding.trim();
    if (!label) return;
    setDraft([...draft, { value: '', label }]);
    setAdding('');
  };
  const submit = () => save.mutate(
    { lists: { [active]: draft.map((o) => {
      const row: ListOption = o.value ? { ...o } : { label: o.label, archived: !!o.archived };
      if (o.children?.length) row.children = o.children.filter((c) => c.trim());
      else delete row.children;
      return row;
    }) } },
    { onSuccess: () => { setDone(true); setTimeout(() => setDone(false), 2000); } },
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {keys.map((k) => (
          <button key={k} type="button" onClick={() => setActive(k)}
            className={`rounded-full border px-2.5 py-0.5 text-xs ${k === active ? 'border-blue-500 bg-blue-50 font-medium text-blue-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
            {lists[k].label}
          </button>
        ))}
      </div>
      {list?.note && <p className="text-[11px] text-amber-700">{list.note}</p>}
      <div className="space-y-1.5">
        {draft.map((o, i) => !o.archived && (
          <div key={o.value || `new-${i}`} className="space-y-1.5">
            <div className="flex items-center gap-2">
              <input className={input} value={o.label} aria-label="Option name" onChange={(e) => patch(i, { label: e.target.value })} />
              <button type="button" title="Remove option"
                onClick={() => (saved.has(o.value) ? patch(i, { archived: true }) : setDraft(draft.filter((_, j) => j !== i)))}
                className="rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600"><Trash2 className="h-3.5 w-3.5" /></button>
            </div>
            {list?.child_label && (
              <div className="ml-3 border-l-2 border-slate-200 pl-2">
                <p className="mb-1 text-[11px] text-slate-500">{list.child_label} when {o.label || 'this'} is selected</p>
                <OptionRows options={o.children || []} placeholder={`Add ${list.child_label.toLowerCase()}`}
                  onChange={(children) => patch(i, { children })} />
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <input className={input} value={adding} placeholder={`Add to ${list?.label.toLowerCase() || 'this list'}…`}
          onChange={(e) => setAdding(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} />
        <button type="button" onClick={add} className="inline-flex items-center gap-1 rounded border border-slate-200 px-2.5 py-1.5 text-xs text-slate-700 hover:bg-slate-50">
          <Plus className="h-3 w-3" /> Add
        </button>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-400">
          {draft.some((o) => o.archived) && 'Removed, kept on records:'}
          {draft.map((o, i) => o.archived && (
            <button key={o.value} type="button" title="Bring this option back" onClick={() => patch(i, { archived: false })}
              className="inline-flex items-center gap-1 rounded-full border border-slate-200 px-2 py-0.5 hover:bg-slate-50">
              {o.label} <RotateCcw className="h-3 w-3" />
            </button>
          ))}
        </p>
        <SaveButton label={`Save ${list?.label.toLowerCase() || 'list'}`} pending={save.isPending} done={done} onClick={submit} />
      </div>
      {save.isError && <ErrorLine text={errorText(save.error, 'Could not save the list.')} />}
    </div>
  );
}

function SaveButton({ label, pending, done, onClick }: { label: string; pending: boolean; done: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} disabled={pending}
      className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-60">
      {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : done ? <Check className="h-3.5 w-3.5" /> : null}
      {done ? 'Saved' : label}
    </button>
  );
}

const TYPE_NAME = Object.fromEntries(FIELD_TYPES);

/** The fields the form already has: rename them, or take them off the form. */
export function BuiltinEditor({ moduleKey, settings, onEditOptions }: {
  moduleKey: string; settings: ModuleSettings; onEditOptions?: () => void;
}) {
  const save = useSaveModuleSettings(moduleKey);
  const [rows, setRows] = useState<BuiltinField[]>(() => settings.builtins || []);
  const [done, setDone] = useState(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => setRows(settings.builtins || []), [settings.updated_at]);
  if (!rows.length) return null;
  const patch = (key: string, change: Partial<BuiltinField>) =>
    setRows(rows.map((r) => (r.key === key ? { ...r, ...change } : r)));
  const submit = () => save.mutate(
    { layout: Object.fromEntries(rows.map((r) => [r.key, { label: r.label, hidden: !!r.hidden }])) },
    { onSuccess: () => { setDone(true); setTimeout(() => setDone(false), 2000); } },
  );
  const live = rows.filter((r) => !r.hidden);
  const removed = rows.filter((r) => r.hidden);

  return (
    <div className="mb-4 space-y-2 border-b border-slate-200 pb-4">
      <p className="text-xs font-medium text-slate-700">Existing fields</p>
      {live.map((f) => (
        <div key={f.key} className="rounded-md border border-slate-200 bg-white p-2">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1.4fr_1fr_auto]">
            <input className={input} value={f.label} aria-label={`Name of ${f.label}`}
              onChange={(e) => patch(f.key, { label: e.target.value })} />
            <select className={input} value={f.type} aria-label="Field type" disabled title="This field is stored as this type">
              <option value={f.type}>{TYPE_NAME[f.type] || f.type}</option>
            </select>
            <div className="flex items-center justify-end gap-1">
              {f.list && onEditOptions && (
                <button type="button" onClick={onEditOptions} className="px-1 text-xs text-blue-700 hover:underline">Options</button>
              )}
              {f.locked ? (
                <span className="px-1 text-[11px] text-slate-400" title="The record needs this field">Kept</span>
              ) : (
                <button type="button" title="Remove field" onClick={() => patch(f.key, { hidden: true })}
                  className="rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600"><Trash2 className="h-3.5 w-3.5" /></button>
              )}
            </div>
          </div>
        </div>
      ))}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
        <p className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-400">
          {removed.length > 0 && 'Removed from the form:'}
          {removed.map((f) => (
            <button key={f.key} type="button" title="Bring this field back" onClick={() => patch(f.key, { hidden: false })}
              className="inline-flex items-center gap-1 rounded-full border border-slate-200 px-2 py-0.5 hover:bg-slate-50">
              {f.label} <RotateCcw className="h-3 w-3" />
            </button>
          ))}
        </p>
        <SaveButton label="Save existing fields" pending={save.isPending} done={done} onClick={submit} />
      </div>
      {save.isError && <ErrorLine text={errorText(save.error, 'Could not save the fields.')} />}
      <p className="pt-2 text-xs font-medium text-slate-700">Added fields</p>
    </div>
  );
}

const ErrorLine = ({ text }: { text: string }) => (
  <p className="flex items-start gap-1.5 text-xs text-rose-700"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {text}</p>
);

// ── the tab ──────────────────────────────────────────────────────────────────

/** "Details | Custom fields" above a record form. */
export function CustomFieldsTabBar({ tab, onTab, settings }: {
  tab: 'details' | 'custom'; onTab: (tab: 'details' | 'custom') => void; settings?: ModuleSettings;
}) {
  const count = liveFields(settings).length;
  return (
    <div className="mb-3 flex gap-1 border-b border-slate-200" role="tablist">
      {(['details', 'custom'] as const).map((t) => (
        <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => onTab(t)}
          className={`-mb-px border-b-2 px-3 py-1.5 text-xs font-medium ${tab === t ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>
          {t === 'details' ? 'Details' : 'Custom fields'}
          {t === 'custom' && count > 0 && <span className="ml-1.5 rounded-full bg-slate-100 px-1.5 text-[10px] text-slate-600">{count}</span>}
        </button>
      ))}
    </div>
  );
}

/** The tab's body: the fields to fill in, and the form itself for people who may change it. */
export function CustomFieldsTab({ moduleKey, values, onChange }: {
  moduleKey: string; values: CustomValues; onChange: (next: CustomValues) => void;
}) {
  const { data: settings, isLoading, isError } = useModuleSettings(moduleKey);
  const canCustomise = useCanCustomise(settings);
  const [customising, setCustomising] = useState(false);
  const [part, setPart] = useState<'fields' | 'lists'>('fields');

  if (isLoading) return <p className="flex items-center gap-2 text-xs text-slate-500"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading fields…</p>;
  if (isError || !settings) return <ErrorLine text="Could not load this form's custom fields." />;
  const fields = liveFields(settings);
  const hasLists = settings.module.sections.includes('lists');
  const record = settings.module.record.toLowerCase();

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs text-slate-500">
          {fields.length ? `Your organisation's own fields on every ${record}.` : `No custom fields on ${record}s yet.`}
        </p>
        {canCustomise && (
          <button type="button" onClick={() => setCustomising(!customising)}
            className={`inline-flex shrink-0 items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium ${customising ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-700 hover:bg-slate-50'}`}>
            <Settings2 className="h-3.5 w-3.5" /> {customising ? 'Done customising' : 'Customise form'}
          </button>
        )}
      </div>

      {customising ? (
        <div className="rounded-lg border border-blue-100 bg-blue-50/40 p-3">
          {hasLists && (
            <div className="mb-3 inline-flex rounded-md border border-slate-200 bg-white p-0.5 text-xs">
              {(['fields', 'lists'] as const).map((p) => (
                <button key={p} type="button" onClick={() => setPart(p)}
                  className={`rounded px-2.5 py-1 ${part === p ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>
                  {p === 'fields' ? 'Fields' : 'Dropdown options'}
                </button>
              ))}
            </div>
          )}
          {part === 'lists' && hasLists
            ? <ListsEditor moduleKey={moduleKey} settings={settings} />
            : (
              <>
                <BuiltinEditor moduleKey={moduleKey} settings={settings}
                  onEditOptions={hasLists ? () => setPart('lists') : undefined} />
                <FieldsEditor moduleKey={moduleKey} settings={settings} />
              </>
            )}
          <p className="mt-3 text-[11px] text-slate-400">
            Changes apply to every {record} in your organisation. Removing a field or option keeps what records already hold.
          </p>
        </div>
      ) : fields.length > 0 && (
        <CustomFieldInputs moduleKey={moduleKey} fields={fields} values={values} onChange={onChange} />
      )}
      {!customising && <KeptValues settings={settings} values={values} />}
    </div>
  );
}

/** Whether a detail page has anything to show: a live field, or a value kept from a removed one. */
export const hasCustomFields = (settings: ModuleSettings | undefined, values?: CustomValues | null) =>
  !!settings?.fields.some((f) => !f.archived || !blank(values?.[f.key]));

/** A record's custom values on its detail page: shown, and edited in place.
 *  Renders nothing when there is nothing to show (see hasCustomFields). */
export function CustomValuesEditor({ moduleKey, values, onSave }: {
  moduleKey: string; values?: CustomValues | null; onSave: (next: CustomValues | undefined) => Promise<unknown>;
}) {
  const { data: settings } = useModuleSettings(moduleKey);
  const [draft, setDraft] = useState<CustomValues | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!settings || !hasCustomFields(settings, values)) return null;

  if (!draft) {
    return (
      <div className="space-y-2">
        <CustomValuesList moduleKey={moduleKey} values={values} />
        {liveFields(settings).length > 0 && (
          <button type="button" onClick={() => setDraft({ ...(values || {}) })}
            className="text-xs font-medium text-blue-700 hover:underline">Edit custom fields</button>
        )}
      </div>
    );
  }
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await onSave(valuesToSave(settings, draft, values || {}));
      setDraft(null);
    } catch (e) {
      setError(errorText(e, 'Could not save the custom fields.'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-3">
      <CustomFieldInputs moduleKey={moduleKey} fields={liveFields(settings)} values={draft} onChange={setDraft} />
      {error && <ErrorLine text={error} />}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={() => { setDraft(null); setError(null); }}
          className="rounded-md border border-slate-200 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50">Cancel</button>
        <SaveButton label="Save" pending={busy} done={false} onClick={save} />
      </div>
    </div>
  );
}

/** A record's custom values, read-only — for detail pages. */
export function CustomValuesList({ moduleKey, values }: { moduleKey: string; values?: CustomValues | null }) {
  const { data: settings } = useModuleSettings(moduleKey);
  const people = usePeople(moduleKey, !!settings?.fields.some((f) => f.type === 'user' && !blank(values?.[f.key])));
  const shown = (settings?.fields || []).filter((f) => !f.archived || !blank(values?.[f.key]))
    .sort((a, b) => Number(!!a.archived) - Number(!!b.archived) || a.order - b.order);
  if (!shown.length) return null;
  const show = (f: FieldDef, v: unknown) => {
    if (blank(v)) return '—';
    if (Array.isArray(v)) return v.join(', ');
    if (typeof v === 'boolean') return v ? 'Yes' : 'No';
    if (f.type === 'user') return people.find((p) => p.id === Number(v))?.display_name || `User #${v}`;
    return String(v);
  };
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
      {shown.map((f) => (
        <div key={f.key} className="min-w-0">
          <dt className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
            {f.label}{f.archived && <span className="ml-1 normal-case text-slate-400">(removed)</span>}
          </dt>
          <dd className="whitespace-pre-wrap break-words text-sm text-slate-800">{show(f, values?.[f.key])}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Fill and customise fields on a record that is not part of a larger form. */
export function EntityFieldsPanel({ moduleKey, initial, onSave }: {
  moduleKey: string;
  initial?: CustomValues | null;
  onSave: (values: CustomValues | undefined) => Promise<unknown>;
}) {
  const { data: settings } = useModuleSettings(moduleKey);
  const [values, setValues] = useState<CustomValues>(initial || {});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  useEffect(() => setValues(initial || {}), [initial]);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await onSave(valuesToSave(settings, values, initial || {}));
      setDone(true);
      setTimeout(() => setDone(false), 2000);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <CustomFieldsTab moduleKey={moduleKey} values={values} onChange={setValues} />
      <div className="flex items-center justify-end gap-3">
        {error && <ErrorLine text={error} />}
        <SaveButton label="Save fields" pending={busy} done={done} onClick={save} />
      </div>
    </div>
  );
}
