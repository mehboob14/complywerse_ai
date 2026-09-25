'use client';

/** A module's own settings: its status levels, SLA rules, fields and dropdowns.
 *
 *  One panel serves every module that opts in on the backend
 *  (services/module_settings.py), showing only the sections that module has, so
 *  a new module needs a defaults block there and a `<ModuleSettingsPanel
 *  moduleKey="…" />` here.
 *
 *  The SLA follows whichever property the tenant picks — priority, or one of
 *  their own dropdown fields — with days to resolve, a reminder and an
 *  escalation point per value, the way the vulnerability SLA table works. Each
 *  status level says whether the clock runs or pauses while a record sits there.
 */
import { AlertTriangle, Check, Loader2, Plus, Save, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  errorText, FieldsEditor, liveFields, ListsEditor, type ModuleSettings, type SlaTarget, type StatusLevel,
  useModuleSettings, useSaveModuleSettings,
} from './CustomFields';

const TONES = ['slate', 'blue', 'amber', 'emerald', 'rose', 'violet'];
const TONE_CLS: Record<string, string> = {
  slate: 'bg-slate-100 text-slate-700', blue: 'bg-blue-100 text-blue-700',
  amber: 'bg-amber-100 text-amber-800', emerald: 'bg-emerald-100 text-emerald-700',
  rose: 'bg-rose-100 text-rose-700', violet: 'bg-violet-100 text-violet-700',
};

const input = 'w-full rounded-md border border-slate-300 px-2 py-1 text-sm focus:border-primary-500 focus:outline-none';
const days = (value: string) => (value === '' ? null : Math.max(0, Number(value)));

/** Where a record stands against the tenant's SLA (services/module_settings.sla_state). */
export type SlaState = {
  state: 'on_track' | 'due_soon' | 'breached' | 'paused' | 'closed' | 'no_due_date';
  days_overdue: number | null; due_in_days: number | null; target_days: number | null;
  implied_due_date: boolean; escalated: boolean;
};

export function SlaBadge({ sla }: { sla?: SlaState | null }) {
  if (!sla || sla.state === 'closed') return <span className="text-xs text-slate-400">—</span>;
  const [cls, text] = {
    breached: ['bg-rose-50 text-rose-700 border-rose-200', `Overdue ${sla.days_overdue}d${sla.escalated ? ' · escalated' : ''}`],
    due_soon: ['bg-amber-50 text-amber-800 border-amber-200', sla.due_in_days ? `Due in ${sla.due_in_days}d` : 'Due today'],
    on_track: ['bg-emerald-50 text-emerald-700 border-emerald-200', `On track · ${sla.due_in_days}d`],
    paused: ['bg-slate-50 text-slate-600 border-slate-200', 'Paused'],
    no_due_date: ['bg-slate-50 text-slate-500 border-slate-200', 'No SLA'],
  }[sla.state];
  const title = sla.target_days != null
    ? `SLA ${sla.target_days} days${sla.implied_due_date ? ', counted from when it was raised' : ''}` : undefined;
  return <span title={title} className={`inline-flex whitespace-nowrap rounded-md border px-1.5 py-0.5 text-[11px] font-medium ${cls}`}>{text}</span>;
}

/** The values an SLA driver sets days per: priorities, or a dropdown field's options. */
function driverValues(settings: ModuleSettings, driver: string): string[] {
  if (driver.startsWith('field:')) return liveFields(settings).find((f) => f.key === driver.slice(6))?.options || [];
  return settings.module.priorities;
}

export default function ModuleSettingsPanel({ moduleKey }: { moduleKey: string }) {
  const { data, isLoading } = useModuleSettings(moduleKey);
  const save = useSaveModuleSettings(moduleKey);
  const [draft, setDraft] = useState<ModuleSettings | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (data) setDraft(structuredClone(data)); }, [data?.updated_at, !!data]);

  if (isLoading || !draft || !data) {
    return <div className="flex items-center gap-2 p-6 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading settings…</div>;
  }
  const sections = draft.module.sections || ['statuses', 'sla', 'fields'];
  const record = draft.module.record.toLowerCase();

  const commit = (label: string, patch: Record<string, unknown>) => save.mutate(patch, {
    onSuccess: () => { setSaved(label); setTimeout(() => setSaved(null), 2500); },
  });
  const SaveButton = ({ label, patch }: { label: string; patch: Record<string, unknown> }) => (
    <button type="button" onClick={() => commit(label, patch)} disabled={save.isPending}
      className="inline-flex items-center gap-1.5 rounded-md bg-primary-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary-700 disabled:opacity-60">
      {save.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
      Save {label}
    </button>
  );

  const statuses = draft.statuses || [];
  const patchStatus = (index: number, change: Partial<StatusLevel>) =>
    setDraft({ ...draft, statuses: statuses.map((s, i) => (i === index ? { ...s, ...change } : s)) });

  const sla = draft.sla;
  const driver = sla?.driver || 'priority';
  const rows = sla ? driverValues(draft, driver) : [];
  const dropdownFields = liveFields(data).filter((f) => f.type === 'select');
  const targetOf = (value: string): SlaTarget => ({
    days: sla?.targets?.[value]?.days ?? (driver === 'priority' ? sla?.by_priority?.[value] ?? null : null),
    notify_before: sla?.targets?.[value]?.notify_before ?? null,
    escalate_after: sla?.targets?.[value]?.escalate_after ?? null,
  });
  const patchTarget = (value: string, change: Partial<SlaTarget>) => sla && setDraft({
    ...draft, sla: { ...sla, targets: { ...sla.targets, [value]: { ...targetOf(value), ...change } } },
  });
  const slaPatch = () => sla && ({
    sla: {
      driver, targets: Object.fromEntries(rows.map((v) => [v, targetOf(v)])),
      due_soon_days: sla.due_soon_days, remind_before_due: sla.remind_before_due, repeat_every: sla.repeat_every,
      escalate_after_days: sla.escalate_after_days, escalate_to: sla.escalate_to,
    },
  });

  return (
    <div className="space-y-6">
      {save.isError && (
        <p className="flex items-start gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {errorText(save.error, 'Could not save these settings.')}
        </p>
      )}
      {saved && (
        <p className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          <Check className="h-4 w-4" /> Saved {saved}.
        </p>
      )}

      {/* ── Status levels ── */}
      {sections.includes('statuses') && (
        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="mb-3 flex items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">Status levels</h3>
              <p className="text-xs text-slate-500">
                The states {record}s move through, and what the SLA clock does in each. Closing levels stop it.
              </p>
            </div>
            <SaveButton label="statuses" patch={{ statuses }} />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-[11px] uppercase tracking-wide text-slate-500">
                  <th className="py-1.5 pr-3">Label</th>
                  <th className="py-1.5 pr-3">Key</th>
                  <th className="py-1.5 pr-3">Colour</th>
                  <th className="py-1.5 pr-3">Closes the record</th>
                  <th className="py-1.5 pr-3">SLA clock</th>
                  <th className="py-1.5 pr-3">Escalate after (days past due)</th>
                  <th className="py-1.5" />
                </tr>
              </thead>
              <tbody>
                {statuses.map((s, i) => (
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
                      {s.terminal ? <span className="text-xs text-slate-400">Stops</span> : (
                        <select className={input} value={s.clock || 'runs'}
                          onChange={(e) => patchStatus(i, { clock: e.target.value as 'runs' | 'paused' })}>
                          <option value="runs">Runs</option>
                          <option value="paused">Paused (waiting on others)</option>
                        </select>
                      )}
                    </td>
                    <td className="py-1.5 pr-3">
                      <input type="number" min={0} className={input} placeholder="SLA default"
                        value={s.escalate_after_days ?? ''}
                        onChange={(e) => patchStatus(i, { escalate_after_days: days(e.target.value) })} />
                    </td>
                    <td className="py-1.5 text-right">
                      <button type="button" title="Remove this level"
                        onClick={() => setDraft({ ...draft, statuses: statuses.filter((_, j) => j !== i) })}
                        className="rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button type="button"
            onClick={() => setDraft({
              ...draft,
              statuses: [...statuses, { key: `status_${statuses.length + 1}`, label: 'New status', order: statuses.length + 1, terminal: false, tone: 'slate', escalate_after_days: null, clock: 'runs' }],
            })}
            className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary-700 hover:underline">
            <Plus className="h-3 w-3" /> Add status level
          </button>
          <p className="mt-2 text-[11px] text-slate-400">
            Renaming a label is safe. Changing a key leaves records on the old one, so add a level instead of re-keying one in use.
          </p>
        </section>
      )}

      {/* ── SLA ── */}
      {sections.includes('sla') && sla && (
        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="mb-3 flex items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">SLA and escalation</h3>
              <p className="text-xs text-slate-500">
                Days allowed per value. A {record} with no date of its own is measured from when it was raised.
              </p>
            </div>
            <SaveButton label="SLA" patch={slaPatch() || {}} />
          </div>

          <label className="mb-3 block max-w-sm text-xs text-slate-600">
            <span className="mb-1 block font-medium text-slate-700">Set the days per</span>
            <select className={input} value={driver}
              onChange={(e) => setDraft({ ...draft, sla: { ...sla, driver: e.target.value, targets: {} } })}>
              <option value="priority">Priority</option>
              {dropdownFields.map((f) => <option key={f.key} value={`field:${f.key}`}>{f.label} (your field)</option>)}
            </select>
            {dropdownFields.length === 0 && (
              <span className="mt-0.5 block text-[11px] text-slate-400">Add a dropdown field below to set the SLA by one of your own properties.</span>
            )}
          </label>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-[11px] uppercase tracking-wide text-slate-500">
                  <th className="py-1.5 pr-3">{driver === 'priority' ? 'Priority' : dropdownFields.find((f) => `field:${f.key}` === driver)?.label || 'Value'}</th>
                  <th className="py-1.5 pr-3">Days to resolve</th>
                  <th className="py-1.5 pr-3">Remind before due</th>
                  <th className="py-1.5 pr-3">Escalate after (days past due)</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((value) => {
                  const t = targetOf(value);
                  return (
                    <tr key={value} className="border-b border-slate-100">
                      <td className="py-1.5 pr-3 font-medium capitalize text-slate-700">{value}</td>
                      <td className="py-1.5 pr-3">
                        <input type="number" min={0} className={input} placeholder={driver === 'priority' ? '' : 'no SLA'} value={t.days ?? ''}
                          onChange={(e) => patchTarget(value, { days: days(e.target.value) })} />
                      </td>
                      <td className="py-1.5 pr-3">
                        <input type="number" min={0} className={input} placeholder={`${sla.remind_before_due} (default)`}
                          value={t.notify_before ?? ''} onChange={(e) => patchTarget(value, { notify_before: days(e.target.value) })} />
                      </td>
                      <td className="py-1.5 pr-3">
                        <input type="number" min={0} className={input} placeholder={`${sla.escalate_after_days} (default)`}
                          value={t.escalate_after ?? ''} onChange={(e) => patchTarget(value, { escalate_after: days(e.target.value) })} />
                      </td>
                    </tr>
                  );
                })}
                {rows.length === 0 && (
                  <tr><td colSpan={4} className="py-2 text-xs text-slate-400">This field has no options yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {([
              ['due_soon_days', 'Due soon within (days)'],
              ['remind_before_due', 'Default reminder (days before due)'],
              ['repeat_every', 'Repeat reminder every (days)'],
              ['escalate_after_days', 'Default escalation (days past due)'],
            ] as const).map(([key, label]) => (
              <label key={key} className="text-xs text-slate-600">
                <span className="mb-1 block font-medium text-slate-700">{label}</span>
                <input type="number" min={0} className={input} value={sla[key]}
                  onChange={(e) => setDraft({ ...draft, sla: { ...sla, [key]: Number(e.target.value) } })} />
              </label>
            ))}
          </div>
          <label className="mt-3 block text-xs text-slate-600">
            <span className="mb-1 block font-medium text-slate-700">Escalate to</span>
            <input className={input} placeholder="role:Head of Internal Audit, user:12"
              value={sla.escalate_to.join(', ')}
              onChange={(e) => setDraft({ ...draft, sla: { ...sla, escalate_to: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) } })} />
            <span className="mt-0.5 block text-[11px] text-slate-400">Each entry starts with role: or user:</span>
          </label>
          <p className="mt-2 text-[11px] text-slate-400">
            Escalation uses the status level&apos;s days first, then the row above, then the default.
          </p>
        </section>
      )}

      {/* ── Fields ── */}
      {sections.includes('fields') && (
        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <h3 className="text-sm font-semibold text-slate-900">Custom fields</h3>
          <p className="mb-3 text-xs text-slate-500">Your own fields on a {record}, validated when saved.</p>
          <FieldsEditor moduleKey={moduleKey} settings={data} />
        </section>
      )}

      {/* ── Built-in dropdowns ── */}
      {sections.includes('lists') && (
        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <h3 className="text-sm font-semibold text-slate-900">Dropdown options</h3>
          <p className="mb-3 text-xs text-slate-500">The choices the {record} form offers.</p>
          <ListsEditor moduleKey={moduleKey} settings={data} />
        </section>
      )}

      {data.updated_at && (
        <p className="text-[11px] text-slate-400">Last changed {new Date(data.updated_at).toLocaleString()}.</p>
      )}
    </div>
  );
}
