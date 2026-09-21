'use client';

/**
 * Add one finding by hand, on one of the client's sheets — the same columns,
 * codes and dropdowns the workbook has for that sheet. It becomes a register
 * finding like any imported row (issue, action plan, links, Statutory Audit for
 * an MRA), and next month's workbook updates it rather than adding it twice.
 */
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Plus } from 'lucide-react';
import { auditRegisterApi } from '@/lib/api';
import { FieldInput, GROUP_ORDER, type Options } from './FindingForm';

export type EntryTemplate = {
  key: string; label: string; sheet: string; source: string; record_type: string; layout: string;
  defaults: Record<string, unknown>;
  fields: Array<{ name: string; label: string; group: string; kind: string }>;
};

export function NewFindingForm({ template, prefill, onCreated, onCancel }: {
  template?: string | null;
  prefill?: Record<string, unknown>;
  onCreated: (issueId: number) => void;
  onCancel: () => void;
}) {
  const queryClient = useQueryClient();
  const [key, setKey] = useState(template || 'regulatory');
  const [values, setValues] = useState<Record<string, any>>({});
  const [error, setError] = useState('');

  const templates = useQuery<EntryTemplate[]>({
    queryKey: ['audit-register-templates'],
    queryFn: async () => (await auditRegisterApi.templates()).data,
    staleTime: 300_000,
  });
  const options = useQuery<Options>({
    queryKey: ['audit-register-options'],
    queryFn: async () => (await auditRegisterApi.options()).data,
    staleTime: 60_000,
  });
  const spec = templates.data?.find((t) => t.key === key);

  // A new sheet starts from its defaults plus what the report already says.
  useEffect(() => {
    if (!spec) return;
    const names = new Set(spec.fields.map((f) => f.name));
    const carried = Object.fromEntries(Object.entries(prefill || {}).filter(([k]) => names.has(k)));
    setValues({ ...spec.defaults, ...carried });
    setError('');
  }, [spec?.key]); // eslint-disable-line react-hooks/exhaustive-deps

  const groups = useMemo(() => GROUP_ORDER
    .map((g) => ({ title: g, fields: (spec?.fields || []).filter((f) => f.group === g) }))
    .filter((g) => g.fields.length), [spec]);

  const create = useMutation({
    mutationFn: async () => {
      const filled = Object.fromEntries(Object.entries(values).filter(([, v]) => v !== '' && v != null));
      return (await auditRegisterApi.addFinding(key, filled)).data as { issue_id: number };
    },
    onSuccess: (data) => {
      ['audit-register-rows', 'audit-register-pack', 'audit-register-reports', 'audit-register-options',
        'audit-register-status', 'issues'].forEach((k) => queryClient.invalidateQueries({ queryKey: [k] }));
      onCreated(data.issue_id);
    },
    onError: (e: any) => setError(e?.response?.data?.detail || 'Could not add the finding.'),
  });

  if (templates.isLoading) {
    return <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-slate-300" /></div>;
  }

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Sheet</p>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {(templates.data || []).map((t) => (
            <button key={t.key} onClick={() => setKey(t.key)}
                    className={`rounded-lg px-2.5 py-1 text-xs font-medium ${key === t.key
                      ? 'bg-primary-600 text-[#0a0a0a]' : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}>
              {t.label}
            </button>
          ))}
        </div>
        {spec && (
          <p className="mt-2 text-[11px] text-slate-500">
            The columns of the client&apos;s “{spec.sheet.trim()}” sheet
            {spec.record_type === 'recommendation' ? ', recorded as a recommendation' : ''}.
            Days past due and aging are worked out from the dates.
          </p>
        )}
      </div>

      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}

      {groups.map((group) => (
        <section key={group.title} className="rounded-xl border border-slate-200 bg-white">
          <h4 className="border-b border-slate-100 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            {group.title}
          </h4>
          <div className="divide-y divide-slate-50">
            {group.fields.map((field) => (
              <label key={field.name} className="grid grid-cols-[150px_1fr] items-start gap-2 px-3 py-2">
                <span className="pt-1 text-[11px] text-slate-500">
                  {field.label}{field.name === 'title' && <span className="text-red-500"> *</span>}
                </span>
                <FieldInput field={field} value={values[field.name] ?? ''} options={options.data}
                            onChange={(v) => setValues((d) => ({ ...d, [field.name]: v }))} />
              </label>
            ))}
          </div>
        </section>
      ))}

      <div className="sticky bottom-0 flex justify-end gap-2 border-t border-slate-100 bg-white py-2">
        <button onClick={onCancel}
                className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50">
          Cancel
        </button>
        <button onClick={() => create.mutate()} disabled={create.isPending || !String(values.title || '').trim()}
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-semibold text-[#0a0a0a] hover:bg-primary-700 disabled:opacity-50">
          {create.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
          Add to the register
        </button>
      </div>
    </div>
  );
}
