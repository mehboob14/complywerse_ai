'use client';

/**
 * One register finding, in its own sheet's columns — viewed and edited here.
 *
 * Only the columns the finding's sheet has are shown: a regulatory MRA never
 * shows affected hosts, a pen-test finding never shows a report number. Every
 * column is editable, either one at a time from its ⋯ menu or all at once, with
 * the client's own codes in searchable dropdowns and a searchable user list for
 * the owner. An edited field is marked, and next month's workbook import keeps
 * it instead of putting the file's older value back.
 */
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Loader2, MoreHorizontal, Pencil, X } from 'lucide-react';
import { MultiSelectDropdown, type MultiSelectDropdownItem } from '@/components/ui';
import { auditRegisterApi } from '@/lib/api';

export type FormField = {
  name: string; label: string; group: string; kind: string;
  value: any; raw?: string | null; edited: boolean;
};
export type Finding = {
  issue_id: number; code: string | null; title: string; source: string; record_type: string;
  source_sheet: string | null; source_row: number | null; workflow_state: string | null;
  severity: string | null; owner_id: number | null; owner_name: string | null;
  layout: string; fields: FormField[]; edited_fields: string[]; added_in_platform?: boolean;
};
export type Options = {
  choices: Record<string, string[]>;
  picks: Record<string, string[]>;
  users: Array<{ id: number; name: string; email: string | null }>;
};

export const GROUP_ORDER = ['Where it came from', 'The finding', 'The response', 'Ownership',
  'Dates and aging', 'Validation', 'IT finding'];

export const inputCls = 'block w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-800 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500';

function display(field: FormField, options?: Options): string | null {
  if (field.value === null || field.value === undefined || field.value === '') return null;
  if (field.kind === 'user') {
    return options?.users.find((u) => u.id === field.value)?.name ?? `User #${field.value}`;
  }
  if (field.kind === 'money') return Number(field.value).toLocaleString(undefined, { minimumFractionDigits: 2 });
  return String(field.value);
}

export function FieldInput({ field, value, onChange, options, autoFocus }: {
  field: Pick<FormField, 'name' | 'label' | 'kind'>; value: any; onChange: (v: any) => void;
  options?: Options; autoFocus?: boolean;
}) {
  const text = value === null || value === undefined ? '' : String(value);
  if (field.kind === 'choice' || field.kind === 'user' || field.kind === 'pick') {
    // pick: the Settings list plus what the register already uses; a new value is one "+ Add" away.
    const items: MultiSelectDropdownItem[] = field.kind === 'user'
      ? (options?.users || []).map((u) => ({ value: String(u.id), label: u.name, subLabel: u.email || undefined }))
      : ((field.kind === 'pick' ? options?.picks : options?.choices)?.[field.name] || [])
        .map((c) => ({ value: c, label: c }));
    // A code the file used that is not in today's list still shows.
    const all = text && !items.some((i) => i.value === text) ? [{ value: text, label: text }, ...items] : items;
    return (
      <MultiSelectDropdown
        title={field.label}
        items={all}
        selectedValues={text ? [text] : []}
        onApply={(v) => onChange(field.kind === 'user' ? (v[0] ? Number(v[0]) : null) : (v[0] ?? null))}
        multiSelect={false}
        triggerVariant="input"
        placeholder={`Select ${field.label.toLowerCase()}`}
        searchPlaceholder={`Search ${field.label.toLowerCase()}…`}
        forceSearch
        showAvatars={field.kind === 'user'}
        onCreate={field.kind === 'pick' ? (v) => onChange(v) : undefined}
        size="sm"
        className="w-full"
        triggerClassName="w-full"
      />
    );
  }
  if (field.kind === 'long') {
    return <textarea value={text} autoFocus={autoFocus} rows={3} className={inputCls}
                     onChange={(e) => onChange(e.target.value)} />;
  }
  const type = field.kind === 'date' ? 'date' : field.kind === 'int' || field.kind === 'money' ? 'number' : 'text';
  return (
    <input type={type} step={field.kind === 'money' ? '0.01' : field.kind === 'int' ? '1' : undefined}
           value={field.kind === 'date' ? text.slice(0, 10) : text} autoFocus={autoFocus}
           className={inputCls} onChange={(e) => onChange(e.target.value)} />
  );
}

export function FindingForm({ issueId, onSaved, startInEdit = false }: {
  issueId: number; onSaved?: () => void; startInEdit?: boolean;
}) {
  const queryClient = useQueryClient();
  const [editingField, setEditingField] = useState<string | null>(null);
  const [menuField, setMenuField] = useState<string | null>(null);
  const [editAll, setEditAll] = useState(startInEdit);
  const [draft, setDraft] = useState<Record<string, any>>({});
  const [showEmpty, setShowEmpty] = useState(false);
  const [error, setError] = useState('');

  const finding = useQuery<Finding>({
    queryKey: ['audit-register-profile', issueId],
    queryFn: async () => (await auditRegisterApi.profile(issueId)).data,
    retry: false,
  });
  const options = useQuery<Options>({
    queryKey: ['audit-register-options'],
    queryFn: async () => (await auditRegisterApi.options()).data,
    staleTime: 60_000,
  });

  useEffect(() => { setDraft({}); setEditingField(null); setEditAll(startInEdit); setError(''); }, [issueId, startInEdit]);

  const save = useMutation({
    mutationFn: async (changes: Record<string, any>) =>
      (await auditRegisterApi.editProfile(issueId, changes)).data as Finding,
    onSuccess: (data) => {
      queryClient.setQueryData(['audit-register-profile', issueId], data);
      queryClient.invalidateQueries({ queryKey: ['audit-register-rows'] });
      queryClient.invalidateQueries({ queryKey: ['audit-register-summary'] });
      queryClient.invalidateQueries({ queryKey: ['audit-register-options'] });
      queryClient.invalidateQueries({ queryKey: ['issue-detail', issueId] });
      setDraft({}); setEditingField(null); setEditAll(false); setError('');
      onSaved?.();
    },
    onError: (e: any) => setError(e?.response?.data?.detail || 'Could not save the change.'),
  });

  const groups = useMemo(() => {
    const fields = finding.data?.fields || [];
    return GROUP_ORDER.map((g) => ({ title: g, fields: fields.filter((f) => f.group === g) }))
      .filter((g) => g.fields.length);
  }, [finding.data]);

  if (finding.isLoading) {
    return <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-slate-300" /></div>;
  }
  if (finding.isError || !finding.data) {
    return <p className="p-4 text-sm text-slate-500">This issue did not come from the audit register.</p>;
  }

  const current = (f: FormField) => (f.name in draft ? draft[f.name] : f.value);
  const changedKeys = Object.keys(draft).filter((k) => {
    const f = finding.data!.fields.find((x) => x.name === k);
    return f && String(draft[k] ?? '') !== String(f.value ?? '');
  });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] text-slate-500">
          {finding.data.added_in_platform
            ? `Added in the platform on the "${(finding.data.source_sheet || '').trim()}" sheet`
            : finding.data.source_sheet ? `From "${finding.data.source_sheet.trim()}"` : 'From the register'}
          {finding.data.source_row ? `, row ${finding.data.source_row}` : ''}
          {finding.data.record_type === 'recommendation' ? ' · Recommendation' : ''}
        </span>
        <div className="ml-auto flex items-center gap-2">
          {!editAll && (
            <label className="flex items-center gap-1 text-[11px] text-slate-500">
              <input type="checkbox" checked={showEmpty} onChange={(e) => setShowEmpty(e.target.checked)} />
              Show empty fields
            </label>
          )}
          {editAll ? (
            <>
              <button onClick={() => { setDraft({}); setEditAll(false); setError(''); }}
                      className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50">
                Cancel
              </button>
              <button
                onClick={() => save.mutate(Object.fromEntries(changedKeys.map((k) => [k, draft[k]])))}
                disabled={!changedKeys.length || save.isPending}
                className="inline-flex items-center gap-1 rounded-lg bg-primary-600 px-2.5 py-1 text-xs font-semibold text-[#0a0a0a] hover:bg-primary-700 disabled:opacity-50"
              >
                {save.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                Save {changedKeys.length ? `(${changedKeys.length})` : ''}
              </button>
            </>
          ) : (
            <button onClick={() => { setEditAll(true); setEditingField(null); }}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50">
              <Pencil className="h-3 w-3" /> Edit all
            </button>
          )}
        </div>
      </div>

      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}

      {groups.map((group) => {
        const visible = group.fields.filter((f) => editAll || showEmpty || display(f, options.data) !== null
          || editingField === f.name);
        if (!visible.length) return null;
        return (
          <section key={group.title} className="rounded-xl border border-slate-200 bg-white">
            <h4 className="border-b border-slate-100 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              {group.title}
            </h4>
            <dl className="divide-y divide-slate-50">
              {visible.map((field) => {
                const isEditing = editAll || editingField === field.name;
                const shown = display(field, options.data);
                return (
                  <div key={field.name} className="group relative grid grid-cols-[150px_1fr_auto] items-start gap-2 px-3 py-2">
                    <dt className="pt-1 text-[11px] text-slate-500">
                      {field.label}
                      {field.edited && (
                        <span title="Edited in the platform — next month's import keeps this value"
                              className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-primary-500 align-middle" />
                      )}
                    </dt>
                    <dd className="min-w-0 text-xs text-slate-900">
                      {isEditing ? (
                        <div className="space-y-1">
                          <FieldInput field={field} value={current(field)} options={options.data}
                                      autoFocus={!editAll}
                                      onChange={(v) => setDraft((d) => ({ ...d, [field.name]: v }))} />
                          {field.kind === 'user' && field.raw && (
                            <p className="text-[10px] text-slate-400">The register names: {field.raw}</p>
                          )}
                          {!editAll && (
                            <div className="flex gap-1.5">
                              <button
                                onClick={() => save.mutate({ [field.name]: current(field) })}
                                disabled={save.isPending}
                                className="inline-flex items-center gap-1 rounded-md bg-primary-600 px-2 py-0.5 text-[11px] font-semibold text-[#0a0a0a] hover:bg-primary-700 disabled:opacity-50">
                                {save.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />} Save
                              </button>
                              <button
                                onClick={() => { setEditingField(null); setDraft({}); setError(''); }}
                                className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-0.5 text-[11px] font-semibold text-slate-600 hover:bg-slate-50">
                                <X className="h-3 w-3" /> Cancel
                              </button>
                            </div>
                          )}
                        </div>
                      ) : (
                        <span className={`whitespace-pre-wrap ${shown ? '' : 'text-slate-300'}`}>
                          {shown ?? '—'}
                          {field.kind === 'user' && !field.value && field.raw && (
                            <span className="ml-1 text-amber-700">{field.raw} · not matched to a user</span>
                          )}
                        </span>
                      )}
                    </dd>
                    {!editAll && !isEditing && (
                      <div className="relative">
                        <button
                          aria-label={`More actions for ${field.label}`}
                          onClick={() => setMenuField(menuField === field.name ? null : field.name)}
                          className="rounded p-1 text-slate-400 opacity-60 hover:bg-slate-100 hover:text-slate-700 group-hover:opacity-100">
                          <MoreHorizontal className="h-3.5 w-3.5" />
                        </button>
                        {menuField === field.name && (
                          <div className="absolute right-0 z-20 mt-1 w-32 rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
                            <button
                              onClick={() => { setEditingField(field.name); setMenuField(null); setDraft({}); }}
                              className="flex w-full items-center gap-1.5 px-3 py-1.5 text-left text-xs text-slate-700 hover:bg-slate-50">
                              <Pencil className="h-3 w-3" /> Edit field
                            </button>
                            {shown && (
                              <button
                                onClick={() => { navigator.clipboard?.writeText(shown); setMenuField(null); }}
                                className="flex w-full items-center gap-1.5 px-3 py-1.5 text-left text-xs text-slate-700 hover:bg-slate-50">
                                Copy value
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </dl>
          </section>
        );
      })}
    </div>
  );
}
