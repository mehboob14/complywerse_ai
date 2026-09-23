'use client';

/** A module's own settings: its status levels, SLA days and extra fields.
 *
 *  One panel serves every module that opts in on the backend
 *  (services/module_settings.py), so a new module needs a defaults block there
 *  and a `<ModuleSettingsPanel moduleKey="…" />` here.
 *
 *  Removing a field archives it: values already recorded against it are audit
 *  evidence, so the panel says so rather than pretending they are gone.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Check, Loader2, Plus, Save, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import apiClient from '@/lib/api';

type StatusLevel = {
  key: string; label: string; order: number; terminal: boolean;
  tone: string; escalate_after_days: number | null;
};
type FieldDef = {
  key: string; label: string; type: string; required: boolean;
  options: string[]; help: string; order: number; archived?: boolean;
};
type Sla = {
  by_priority: Record<string, number>; due_soon_days: number;
  escalate_after_days: number; escalate_to: string[];
  remind_before_due: number; repeat_every: number;
};
type Settings = {
  statuses: StatusLevel[]; fields: FieldDef[]; sla: Sla;
  module: { key: string; label: string; record: string; priorities: string[] };
  updated_at: string | null;
};

const TONES = ['slate', 'blue', 'amber', 'emerald', 'rose', 'violet'];
const TYPES = ['text', 'textarea', 'number', 'date', 'select', 'multiselect', 'checkbox', 'user'];
const TONE_CLS: Record<string, string> = {
  slate: 'bg-slate-100 text-slate-700', blue: 'bg-blue-100 text-blue-700',
  amber: 'bg-amber-100 text-amber-800', emerald: 'bg-emerald-100 text-emerald-700',
  rose: 'bg-rose-100 text-rose-700', violet: 'bg-violet-100 text-violet-700',
};

const input = 'w-full rounded-md border border-slate-300 px-2 py-1 text-sm focus:border-primary-500 focus:outline-none';
const slug = (value: string) => value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);

export default function ModuleSettingsPanel({ moduleKey }: { moduleKey: string }) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<Settings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const { data, isLoading } = useQuery<Settings>({
    queryKey: ['module-settings', moduleKey],
    queryFn: async () => (await apiClient.get(`/module-settings/${moduleKey}`)).data,
  });
  useEffect(() => { if (data) setDraft(structuredClone(data)); }, [data]);

  const save = useMutation({
    mutationFn: async (patch: Record<string, unknown>) =>
      (await apiClient.put(`/module-settings/${moduleKey}`, patch)).data as Settings,
    onSuccess: (result, patch) => {
      setError(null);
      setSaved(Object.keys(patch).join(', '));
      setDraft(structuredClone(result));
      qc.invalidateQueries({ queryKey: ['module-settings', moduleKey] });
      setTimeout(() => setSaved(null), 2500);
    },
    onError: (e: unknown) => {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(detail || 'Could not save these settings.');
    },
  });

  if (isLoading || !draft) {
    return <div className="flex items-center gap-2 p-6 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading settings…</div>;
  }

  const patchStatus = (index: number, change: Partial<StatusLevel>) =>
    setDraft({ ...draft, statuses: draft.statuses.map((s, i) => (i === index ? { ...s, ...change } : s)) });
  const patchField = (index: number, change: Partial<FieldDef>) =>
    setDraft({ ...draft, fields: draft.fields.map((f, i) => (i === index ? { ...f, ...change } : f)) });

  const live = draft.fields.filter((f) => !f.archived);
  const archived = draft.fields.filter((f) => f.archived);

  const SaveButton = ({ section, payload }: { section: string; payload: Record<string, unknown> }) => (
    <button
      onClick={() => save.mutate(payload)}
      disabled={save.isPending}
      className="inline-flex items-center gap-1.5 rounded-md bg-primary-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary-700 disabled:opacity-60"
    >
      {save.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
      Save {section}
    </button>
  );

  return (
    <div className="space-y-6">
      {error && (
        <p className="flex items-start gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
        </p>
      )}
      {saved && (
        <p className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          <Check className="h-4 w-4" /> Saved {saved}.
        </p>
      )}

      {/* ── Status levels ── */}
      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">Status levels</h3>
            <p className="text-xs text-slate-500">
              The states {draft.module.record.toLowerCase()}s move through. Closing levels stop the SLA clock.
            </p>
          </div>
          <SaveButton section="statuses" payload={{ statuses: draft.statuses }} />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-[11px] uppercase tracking-wide text-slate-500">
                <th className="py-1.5 pr-3">Label</th>
                <th className="py-1.5 pr-3">Key</th>
                <th className="py-1.5 pr-3">Colour</th>
                <th className="py-1.5 pr-3">Closes the record</th>
                <th className="py-1.5 pr-3">Days to escalation</th>
                <th className="py-1.5" />
              </tr>
            </thead>
            <tbody>
              {draft.statuses.map((s, i) => (
                <tr key={`${s.key}-${i}`} className="border-b border-slate-100">
                  <td className="py-1.5 pr-3">
                    <input className={input} value={s.label} onChange={(e) => patchStatus(i, { label: e.target.value })} />
                  </td>
                  <td className="py-1.5 pr-3">
                    <code className={`rounded px-1.5 py-0.5 text-xs ${TONE_CLS[s.tone] || TONE_CLS.slate}`}>{s.key}</code>
                  </td>
                  <td className="py-1.5 pr-3">
                    <select className={input} value={s.tone} onChange={(e) => patchStatus(i, { tone: e.target.value })}>
                      {TONES.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </td>
                  <td className="py-1.5 pr-3">
                    <input type="checkbox" checked={s.terminal} onChange={(e) => patchStatus(i, { terminal: e.target.checked })} />
                  </td>
                  <td className="py-1.5 pr-3">
                    <input
                      type="number" min={0} className={input} placeholder="module default"
                      value={s.escalate_after_days ?? ''}
                      onChange={(e) => patchStatus(i, { escalate_after_days: e.target.value === '' ? null : Number(e.target.value) })}
                    />
                  </td>
                  <td className="py-1.5 text-right">
                    <button
                      onClick={() => setDraft({ ...draft, statuses: draft.statuses.filter((_, j) => j !== i) })}
                      className="rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                      title="Remove this level"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button
          onClick={() => setDraft({
            ...draft,
            statuses: [...draft.statuses, { key: `status_${draft.statuses.length + 1}`, label: 'New status', order: draft.statuses.length + 1, terminal: false, tone: 'slate', escalate_after_days: null }],
          })}
          className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary-700 hover:underline"
        >
          <Plus className="h-3 w-3" /> Add status level
        </button>
        <p className="mt-2 text-[11px] text-slate-400">
          Renaming a label is safe. Changing a key leaves records on the old one, so add a level instead of re-keying one in use.
        </p>
      </section>

      {/* ── SLA ── */}
      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">SLA and escalation</h3>
            <p className="text-xs text-slate-500">
              Days allowed by priority. A {draft.module.record.toLowerCase()} with no date of its own is measured from when it was raised.
            </p>
          </div>
          <SaveButton section="SLA" payload={{ sla: draft.sla }} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {draft.module.priorities.map((p) => (
            <label key={p} className="text-xs text-slate-600">
              <span className="mb-1 block font-medium capitalize text-slate-700">{p}</span>
              <input
                type="number" min={0} className={input} value={draft.sla.by_priority[p] ?? 0}
                onChange={(e) => setDraft({ ...draft, sla: { ...draft.sla, by_priority: { ...draft.sla.by_priority, [p]: Number(e.target.value) } } })}
              />
              <span className="mt-0.5 block text-[11px] text-slate-400">days to resolve</span>
            </label>
          ))}
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {([
            ['due_soon_days', 'Due soon within'],
            ['escalate_after_days', 'Escalate after (days past due)'],
            ['remind_before_due', 'Remind before due'],
            ['repeat_every', 'Repeat reminder every'],
          ] as const).map(([key, label]) => (
            <label key={key} className="text-xs text-slate-600">
              <span className="mb-1 block font-medium text-slate-700">{label}</span>
              <input
                type="number" min={0} className={input} value={draft.sla[key]}
                onChange={(e) => setDraft({ ...draft, sla: { ...draft.sla, [key]: Number(e.target.value) } })}
              />
            </label>
          ))}
        </div>
        <label className="mt-3 block text-xs text-slate-600">
          <span className="mb-1 block font-medium text-slate-700">Escalate to</span>
          <input
            className={input} placeholder="role:Head of Internal Audit, user:12"
            value={draft.sla.escalate_to.join(', ')}
            onChange={(e) => setDraft({ ...draft, sla: { ...draft.sla, escalate_to: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) } })}
          />
          <span className="mt-0.5 block text-[11px] text-slate-400">Each entry starts with role: or user:</span>
        </label>
      </section>

      {/* ── Extra fields ── */}
      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">Extra fields</h3>
            <p className="text-xs text-slate-500">
              Your own fields on a {draft.module.record.toLowerCase()}, validated when saved.
            </p>
          </div>
          <SaveButton section="fields" payload={{ fields: live }} />
        </div>
        <div className="space-y-2">
          {live.map((f) => {
            const index = draft.fields.indexOf(f);
            return (
              <div key={f.key} className="grid gap-2 rounded-md border border-slate-200 p-2 sm:grid-cols-[1.4fr_1fr_auto_auto_auto]">
                <input className={input} value={f.label} placeholder="Label"
                  onChange={(e) => patchField(index, { label: e.target.value, key: f.key || slug(e.target.value) })} />
                <select className={input} value={f.type} onChange={(e) => patchField(index, { type: e.target.value })}>
                  {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
                <label className="flex items-center gap-1.5 whitespace-nowrap text-xs text-slate-600">
                  <input type="checkbox" checked={f.required} onChange={(e) => patchField(index, { required: e.target.checked })} /> required
                </label>
                {(f.type === 'select' || f.type === 'multiselect') ? (
                  <input className={input} placeholder="Options, comma separated"
                    value={(f.options || []).join(', ')}
                    onChange={(e) => patchField(index, { options: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) })} />
                ) : <span />}
                <button
                  onClick={() => setDraft({ ...draft, fields: draft.fields.filter((_, j) => j !== index) })}
                  className="justify-self-end rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                  title="Remove this field"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          })}
          {live.length === 0 && <p className="text-xs text-slate-400">No extra fields yet.</p>}
        </div>
        <button
          onClick={() => setDraft({
            ...draft,
            fields: [...draft.fields, { key: `field_${live.length + 1}`, label: '', type: 'text', required: false, options: [], help: '', order: live.length + 1 }],
          })}
          className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary-700 hover:underline"
        >
          <Plus className="h-3 w-3" /> Add field
        </button>
        {archived.length > 0 && (
          <p className="mt-3 text-[11px] text-slate-400">
            Removed and kept for the record: {archived.map((f) => f.label || f.key).join(', ')}. Values already saved against them stay in place and stop being editable.
          </p>
        )}
      </section>

      {draft.updated_at && (
        <p className="text-[11px] text-slate-400">Last changed {new Date(draft.updated_at).toLocaleString()}.</p>
      )}
    </div>
  );
}
