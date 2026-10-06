'use client';

/** Priority and its SLA, for records whose SLA follows a priority: the pill, the choices and a small editor of the
 *  days allowed per priority. A committee action item measures itself against Task Management's SLA table, so the
 *  editor on its page edits that same table. */
import { AlertTriangle, Check, Clock, Loader2, Save } from 'lucide-react';
import { useEffect, useState } from 'react';
import { errorText, useCanCustomise, useModuleSettings, useSaveModuleSettings, type ModuleSettings, type SlaTarget } from './CustomFields';

export const PRIORITIES = [
  { value: 'critical', label: 'Critical' },
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
];

const PILL: Record<string, string> = {
  critical: 'bg-rose-50 text-rose-700', high: 'bg-orange-50 text-orange-700', medium: 'bg-amber-50 text-amber-700',
  low: 'bg-emerald-50 text-emerald-700', info: 'bg-slate-100 text-slate-600',
};

export function PriorityPill({ priority, title }: { priority?: string | null; title?: string }) {
  if (!priority) return <span className="text-xs text-slate-400">—</span>;
  return (
    <span title={title} className={`inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium capitalize ${PILL[priority] || PILL.info}`}>
      {priority}
    </span>
  );
}

/** Days the SLA allows for a priority (null when it has none). */
export const slaDays = (settings: ModuleSettings | undefined, priority: string): number | null =>
  settings?.sla?.targets?.[priority]?.days ?? settings?.sla?.by_priority?.[priority] ?? null;

/** The priority choices, each with its days when the tenant's SLA has them: "High · 30 days". */
export const priorityChoices = (settings?: ModuleSettings) =>
  PRIORITIES.map((p) => {
    const days = slaDays(settings, p.value);
    return { value: p.value, label: days == null ? p.label : `${p.label} · ${days} days` };
  });

const input = 'w-16 rounded-md border border-slate-300 px-1.5 py-1 text-sm focus:border-primary-500 focus:outline-none disabled:bg-slate-50 disabled:text-slate-500';

export function PrioritySlaEditor({ moduleKey, title, note }: { moduleKey: string; title: string; note: string }) {
  const { data } = useModuleSettings(moduleKey);
  const save = useSaveModuleSettings(moduleKey);
  const canEdit = useCanCustomise(data);
  const [days, setDays] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);
  const sla = data?.sla;
  const priorities = data?.module.priorities || [];

  useEffect(() => {
    if (sla) setDays(Object.fromEntries(priorities.map((p) => [p, String(slaDays(data, p) ?? '')])));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.updated_at, !!data]);

  // No permission to read these settings, or nothing to show: the row's own SLA badge still reads fine.
  if (!data || !sla) return null;

  const onPriority = (sla.driver || 'priority') === 'priority';
  const patch = {
    sla: {
      targets: Object.fromEntries(priorities.map((p) => {
        const kept: SlaTarget = sla.targets?.[p] || { days: null, notify_before: null, escalate_after: null };
        return [p, { ...kept, days: days[p] === '' || days[p] === undefined ? null : Math.max(0, Number(days[p])) }];
      })),
    },
  };

  return (
    <div className="rounded-lg border border-slate-200 bg-white px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <div className="min-w-[220px] flex-1">
          <p className="flex items-center gap-1.5 text-sm font-semibold text-slate-900"><Clock className="h-4 w-4 text-slate-400" /> {title}</p>
          <p className="text-xs text-slate-500">{note}</p>
        </div>
        {onPriority ? (
          <div className="flex flex-wrap items-end gap-3">
            {priorities.map((p) => (
              <label key={p} className="text-xs text-slate-600">
                <span className="mb-0.5 block font-medium capitalize text-slate-700">{p}</span>
                <span className="flex items-center gap-1">
                  <input type="number" min={0} className={input} value={days[p] ?? ''} disabled={!canEdit}
                    title={canEdit ? undefined : 'You can read the SLA but not change it'}
                    onChange={(e) => { setSaved(false); setDays({ ...days, [p]: e.target.value }); }} />
                  <span className="text-slate-400">days</span>
                </span>
              </label>
            ))}
            {canEdit && (
              <button type="button" disabled={save.isPending} onClick={() => save.mutate(patch, { onSuccess: () => setSaved(true) })}
                className="inline-flex items-center gap-1.5 rounded-md bg-primary-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary-700 disabled:opacity-60">
                {save.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : saved ? <Check className="h-3.5 w-3.5" /> : <Save className="h-3.5 w-3.5" />}
                {saved ? 'Saved' : 'Save SLA'}
              </button>
            )}
          </div>
        ) : (
          <p className="text-xs text-slate-500">Task Management sets its SLA by one of its own fields, not by priority, so priorities have no days until it is set back to Priority there.</p>
        )}
      </div>
      {save.isError && (
        <p className="mt-2 flex items-start gap-1.5 text-xs text-rose-700"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {errorText(save.error, 'Could not save the SLA.')}</p>
      )}
    </div>
  );
}
