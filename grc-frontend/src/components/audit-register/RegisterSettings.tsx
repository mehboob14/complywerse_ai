'use client';

/**
 * The register's settings, set once and used everywhere a finding is handled:
 * - Notifications & SLAs: per status, when an owner is reminded and how often,
 *   when Audit Services hear of it, and whether email goes too.
 * - Reports & exams: the list a new finding's report is picked from.
 * - Dropdown lists: regulators, audit firms, types of audit, titles and the rest.
 * - Issue # numbering: how a new finding is numbered before its report has any.
 */
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Check, Loader2, Pencil, Plus, Trash2, X } from 'lucide-react';
import { MultiSelectDropdown } from '@/components/ui';
import { auditRegisterApi } from '@/lib/api';
import { inputCls, type Options } from './FindingForm';
import { REGISTER_QUERIES, ReportForm, reportNoun, reportTitle, type CatalogReport, type EntryTemplate } from './NewFindingForm';

type Rule = {
  enabled: boolean; remind_before_due?: number | null; repeat_every?: number | null;
  start_within?: number | null; escalate_after?: number | null; validate_within?: number | null;
};
type Settings = {
  sla: Record<string, Rule>; email: boolean; audit_services: number[];
  target_days: Record<string, number | null>;
  lists: Record<string, string[]>; numbering: Record<string, string>;
  values: Record<string, string[]>;
};
type Section = 'sla' | 'reports' | 'lists' | 'numbering';

const SECTIONS: Array<[Section, string]> = [
  ['sla', 'Notifications & SLAs'], ['reports', 'Reports & exams'], ['lists', 'Dropdown lists'],
  ['numbering', 'Issue # numbering'],
];

// Each status's rule, in the words of the person setting it: [setting, before the box, after it].
const SLA_ROWS: Array<[string, string, string, Array<[keyof Rule, string, string]>]> = [
  ['NS', 'Not Started', 'The action plan has not started.', [
    ['remind_before_due', 'Remind the owner', 'days before the target date'],
    ['start_within', 'Nudge the owner if still not started', 'days after it was raised'],
    ['repeat_every', 'Repeat every', 'days'],
  ]],
  ['IP', 'In Progress', 'Work is under way. Findings with no status code follow this rule too.', [
    ['remind_before_due', 'Remind the owner', 'days before the target date'],
    ['repeat_every', 'Repeat every', 'days'],
  ]],
  ['DE', 'Delayed', 'Validation has asked the owner for more.', [
    ['repeat_every', 'Remind the owner every', 'days'],
  ]],
  ['PD', 'Past Due', 'Still open after the target date.', [
    ['repeat_every', 'Remind the owner every', 'days'],
    ['escalate_after', 'Escalate to Audit Services after', 'days past due'],
  ]],
  ['EXT', 'Extension', 'Given a revised target date.', [
    ['remind_before_due', 'Remind the owner', 'days before the revised date'],
    ['repeat_every', 'Repeat every', 'days'],
  ]],
  ['validation', 'Waiting on validation', 'Submitted by the owner, for Audit Services to validate.', [
    ['validate_within', 'Tell Audit Services once it has waited', 'days'],
    ['repeat_every', 'Repeat every', 'days'],
  ]],
];

const LISTS: Array<[string, string, string]> = [
  ['regulator', 'Regulators', 'The Regulator on a regulatory finding.'],
  ['source_label', 'Audit firms and sources', 'Who performed an internal audit, credit review or pen test.'],
  ['type_of_audit', 'Types of audit', 'On IT Pen findings.'],
  ['owner_title', 'Owner titles', 'The Title beside the owner.'],
  ['remediation_type', 'Remediation types', 'On IT Pen findings.'],
  ['current_internal_status', 'Internal statuses', 'On IT Pen findings.'],
];

const card = 'rounded-xl border border-slate-200 bg-white shadow-sm';
const smallBtn = 'inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40';
const primaryBtn = 'inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-semibold text-[#0a0a0a] hover:bg-primary-700 disabled:opacity-50';
const numberCls = 'w-16 rounded-md border border-slate-200 px-1.5 py-0.5 text-xs tabular-nums focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500';

const preview = (pattern: string) => [1, 2].map((n) => pattern.replace('{nnn}', String(n).padStart(3, '0'))
  .replace('{nn}', String(n).padStart(2, '0')).replace('{n}', String(n))).join(', ') + ' …';

function useSave(onSaved?: () => void) {
  const queryClient = useQueryClient();
  const [note, setNote] = useState('');
  const save = useMutation({
    mutationFn: async (patch: Record<string, unknown>) => (await auditRegisterApi.saveSettings(patch)).data as Settings,
    onSuccess: (data) => {
      queryClient.setQueryData(['audit-register-settings'], data);
      ['audit-register-options', 'audit-register-reminders', 'audit-register-next-reference']
        .forEach((k) => queryClient.invalidateQueries({ queryKey: [k] }));
      setNote('Saved.');
      onSaved?.();
    },
    onError: (e: any) => setNote(e?.response?.data?.detail || 'Could not save.'),
  });
  return { save, note, setNote };
}

function SaveBar({ dirty, save, note, onReset }: {
  dirty: boolean; save: () => void; note: string; onReset: () => void; }) {
  return (
    <div className="flex items-center justify-end gap-2 border-t border-slate-100 px-4 py-2.5">
      {note && <span className={`mr-auto text-[11px] ${note === 'Saved.' ? 'text-emerald-700' : 'text-red-600'}`}>{note}</span>}
      <button onClick={onReset} disabled={!dirty} className={smallBtn}>Undo changes</button>
      <button onClick={save} disabled={!dirty} className={primaryBtn}><Check className="h-3.5 w-3.5" /> Save</button>
    </div>
  );
}

// ── notifications & SLAs ─────────────────────────────────────────────────────

function SlaSettings({ settings, users }: { settings: Settings; users: Options['users'] }) {
  const [sla, setSla] = useState(settings.sla);
  const [email, setEmail] = useState(settings.email);
  const [team, setTeam] = useState(settings.audit_services);
  const [days, setDays] = useState(settings.target_days);
  const reset = () => {
    setSla(settings.sla); setEmail(settings.email); setTeam(settings.audit_services); setDays(settings.target_days);
  };
  useEffect(reset, [settings]); // eslint-disable-line react-hooks/exhaustive-deps
  const { save, note, setNote } = useSave();
  const dirty = JSON.stringify([sla, email, team, days])
    !== JSON.stringify([settings.sla, settings.email, settings.audit_services, settings.target_days]);
  const setRule = (status: string, key: keyof Rule, value: any) => {
    setNote('');
    setSla((s) => ({ ...s, [status]: { ...s[status], [key]: value } }));
  };

  return (
    <div className={card}>
      <p className="border-b border-slate-100 px-4 py-2.5 text-xs text-slate-600">
        When owners are reminded, by the finding&apos;s status. The daily reminder job and <b>Remind owners</b> on
        the Register both follow these. A finding is reminded once per <i>Repeat every</i> at most.
      </p>
      <div className="divide-y divide-slate-100">
        {SLA_ROWS.map(([status, title, hint, parts]) => {
          const rule = sla[status] || { enabled: false };
          return (
            <div key={status} className={`grid gap-2 px-4 py-3 md:grid-cols-[220px_1fr] ${rule.enabled ? '' : 'opacity-60'}`}>
              <label className="flex items-start gap-2">
                <input type="checkbox" className="mt-0.5" checked={rule.enabled}
                       onChange={(e) => setRule(status, 'enabled', e.target.checked)} />
                <span>
                  <span className="block text-xs font-semibold text-slate-900">
                    {title}{status !== 'validation' && <span className="font-normal text-slate-400"> ({status})</span>}
                  </span>
                  <span className="block text-[11px] text-slate-500">{hint}</span>
                </span>
              </label>
              <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5">
                {parts.map(([key, before, after]) => (
                  <label key={key} className="inline-flex items-center gap-1.5 text-xs text-slate-700">
                    {before}
                    <input type="number" min={0} max={3650} disabled={!rule.enabled} className={numberCls}
                           value={rule[key] === null || rule[key] === undefined ? '' : String(rule[key])}
                           placeholder="off"
                           onChange={(e) => setRule(status, key, e.target.value === '' ? null : Number(e.target.value))} />
                    {after}
                  </label>
                ))}
              </div>
            </div>
          );
        })}
        <div className="grid gap-2 px-4 py-3 md:grid-cols-[220px_1fr]">
          <span>
            <span className="block text-xs font-semibold text-slate-900">Remediation windows</span>
            <span className="block text-[11px] text-slate-500">
              The target date AI Assist suggests for a new finding: this many days from the report date
              (from today, when that date is already past).
            </span>
          </span>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5">
            {Object.keys(days).map((rating) => (
              <label key={rating} className="inline-flex items-center gap-1.5 text-xs text-slate-700">
                {rating}
                <input type="number" min={1} max={3650} className={numberCls} placeholder="off"
                       value={days[rating] === null || days[rating] === undefined ? '' : String(days[rating])}
                       onChange={(e) => {
                         setNote('');
                         setDays((d) => ({ ...d, [rating]: e.target.value === '' ? null : Number(e.target.value) }));
                       }} />
                days
              </label>
            ))}
          </div>
        </div>
        <div className="grid gap-2 px-4 py-3 md:grid-cols-[220px_1fr]">
          <span>
            <span className="block text-xs font-semibold text-slate-900">Audit Services</span>
            <span className="block text-[11px] text-slate-500">Hear of escalations and validations waiting.</span>
          </span>
          <div className="max-w-md space-y-1">
            <MultiSelectDropdown
              title="Audit Services"
              items={users.map((u) => ({ value: String(u.id), label: u.name, subLabel: u.email || undefined }))}
              selectedValues={team.map(String)}
              onApply={(v) => { setNote(''); setTeam(v.map(Number)); }}
              triggerVariant="input"
              placeholder="Nobody chosen — whoever uploads the workbook"
              searchPlaceholder="Search people…"
              forceSearch
              size="sm"
              className="w-full"
              triggerClassName="w-full"
            />
          </div>
        </div>
        <label className="flex items-center gap-2 px-4 py-3 text-xs text-slate-700">
          <input type="checkbox" checked={email} onChange={(e) => { setNote(''); setEmail(e.target.checked); }} />
          Email reminders as well as the in-app notification
        </label>
      </div>
      <SaveBar dirty={dirty} note={note} onReset={() => { reset(); setNote(''); }}
               save={() => save.mutate({ sla, email, audit_services: team, target_days: days })} />
    </div>
  );
}

// ── reports & exams ──────────────────────────────────────────────────────────

function ReportSettings({ templates, options }: { templates: EntryTemplate[]; options?: Options }) {
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState<string | null>(null);        // finding type the new report is for
  const [editing, setEditing] = useState<number | null>(null);
  const [error, setError] = useState('');
  const catalog = useQuery<CatalogReport[]>({
    queryKey: ['audit-register-report-catalog'],
    queryFn: async () => (await auditRegisterApi.reportCatalog()).data,
  });
  const remove = useMutation({
    mutationFn: async (id: number) => (await auditRegisterApi.deleteReport(id)).data,
    onSuccess: () => REGISTER_QUERIES.forEach((k) => queryClient.invalidateQueries({ queryKey: [k] })),
    onError: (e: any) => setError(e?.response?.data?.detail || 'Could not remove the report.'),
  });
  // One form per source: the EY issue and recommendation sheets share their reports.
  const withReports = templates.filter((t, i) => t.fields.some((f) => f.name === 'report_name' || f.name === 'project_name')
    && templates.findIndex((o) => o.source === t.source) === i);
  const specFor = (source: string) => withReports.find((t) => t.source === source);
  const addingSpec = templates.find((t) => t.key === adding);

  return (
    <div className={card}>
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-2.5">
        <p className="mr-auto text-xs text-slate-600">
          The audit reports and exams findings come from. Adding a finding picks its report from this list,
          which fills in the regulator or firm, report number, name and date. Every report the workbook
          names is here already. Correct a report once and its findings follow.
        </p>
        <select value="" onChange={(e) => { setAdding(e.target.value || null); setEditing(null); }}
                className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-700">
          <option value="">+ Add a report for…</option>
          {withReports.map((t) => <option key={t.key} value={t.key}>{t.source === 'ey' ? 'Internal audit — EY' : t.title}</option>)}
        </select>
      </div>
      {error && <p className="mx-4 mt-2 rounded bg-red-50 px-2 py-1 text-[11px] text-red-700">{error}</p>}
      {addingSpec && (
        <div className="border-b border-slate-100 px-4 py-3">
          <p className="mb-1.5 text-[11px] font-semibold text-slate-600">New {reportNoun(addingSpec.layout).toLowerCase()} · {addingSpec.title}</p>
          <div className="max-w-xl">
            <ReportForm spec={addingSpec} options={options} onDone={() => setAdding(null)} onCancel={() => setAdding(null)} />
          </div>
        </div>
      )}
      {catalog.isLoading ? (
        <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-slate-300" /></div>
      ) : !catalog.data?.length ? (
        <p className="p-8 text-center text-sm text-slate-500">No reports yet — add one, or upload the workbook.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
              <tr>{['Kind', 'Regulator / firm', 'Report', 'Report #', 'Date', 'Year', 'Findings', ''].map((h) => (
                <th key={h} className="whitespace-nowrap px-3 py-2 font-medium">{h}</th>))}</tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {catalog.data.map((r) => {
                const spec = specFor(r.source);
                return editing === r.id && spec ? (
                  <tr key={r.id}>
                    <td colSpan={8} className="bg-slate-50 px-3 py-2">
                      <div className="max-w-xl">
                        <ReportForm spec={spec} report={r} options={options}
                                    onDone={() => setEditing(null)} onCancel={() => setEditing(null)} />
                      </div>
                    </td>
                  </tr>
                ) : (
                  <tr key={r.id} className="hover:bg-slate-50">
                    <td className="whitespace-nowrap px-3 py-2 text-slate-600">{r.source_title}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-slate-700">{r.source_label || '—'}</td>
                    <td className="max-w-[320px] truncate px-3 py-2 text-slate-900" title={reportTitle(r)}>{reportTitle(r)}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-slate-600">{r.report_number || '—'}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-slate-600">{r.report_date || '—'}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-slate-600">{r.engagement_year || '—'}</td>
                    <td className="whitespace-nowrap px-3 py-2 tabular-nums text-slate-700">{r.findings}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right">
                      <div className="inline-flex gap-1">
                        {spec && (
                          <button onClick={() => { setEditing(r.id); setAdding(null); setError(''); }} className={smallBtn}>
                            <Pencil className="h-3 w-3" /> Edit
                          </button>
                        )}
                        <button
                          disabled={r.findings > 0 || remove.isPending}
                          title={r.findings > 0 ? `${r.findings} finding(s) belong to it` : 'Remove from the list'}
                          onClick={() => { setError(''); if (window.confirm(`Remove "${reportTitle(r)}" from the list?`)) remove.mutate(r.id); }}
                          className={smallBtn}>
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── dropdown lists ───────────────────────────────────────────────────────────

function ListSettings({ settings }: { settings: Settings }) {
  const [lists, setLists] = useState(settings.lists);
  const [typed, setTyped] = useState<Record<string, string>>({});
  useEffect(() => setLists(settings.lists), [settings]);
  const { save, note, setNote } = useSave();
  const dirty = JSON.stringify(lists) !== JSON.stringify(settings.lists);
  const add = (field: string) => {
    const value = (typed[field] || '').trim();
    if (!value) return;
    setNote('');
    setLists((l) => ({ ...l, [field]: Array.from(new Set([...(l[field] || []), value])) }));
    setTyped((t) => ({ ...t, [field]: '' }));
  };
  const drop = (field: string, value: string) => {
    setNote('');
    setLists((l) => ({ ...l, [field]: (l[field] || []).filter((v) => v !== value) }));
  };

  return (
    <div className={card}>
      <p className="border-b border-slate-100 px-4 py-2.5 text-xs text-slate-600">
        The values offered in these columns&apos; dropdowns when a finding is added or edited. Values the register
        already uses are offered too. Anyone can still add a new value from the dropdown itself. Line of business
        and business unit come from Business Units, and owners are platform users.
      </p>
      <div className="divide-y divide-slate-100">
        {LISTS.map(([field, title, hint]) => {
          const mine = lists[field] || [];
          const used = (settings.values[field] || []).filter((v) => !mine.includes(v));
          return (
            <div key={field} className="grid gap-2 px-4 py-3 md:grid-cols-[220px_1fr]">
              <span>
                <span className="block text-xs font-semibold text-slate-900">{title}</span>
                <span className="block text-[11px] text-slate-500">{hint}</span>
              </span>
              <div className="space-y-1.5">
                <div className="flex flex-wrap gap-1">
                  {mine.map((v) => (
                    <span key={v} className="inline-flex items-center gap-1 rounded-full bg-primary-50 px-2 py-0.5 text-[11px] text-primary-800 ring-1 ring-primary-200">
                      {v}
                      <button aria-label={`Remove ${v}`} onClick={() => drop(field, v)} className="text-primary-500 hover:text-red-600">
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                  <span className="inline-flex items-center gap-1">
                    <input value={typed[field] || ''} placeholder="Add a value"
                           onChange={(e) => setTyped((t) => ({ ...t, [field]: e.target.value }))}
                           onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(field); } }}
                           className="w-40 rounded-full border border-slate-200 px-2 py-0.5 text-[11px] focus:border-primary-500 focus:outline-none" />
                    <button onClick={() => add(field)} disabled={!(typed[field] || '').trim()} className={smallBtn}>
                      <Plus className="h-3 w-3" />
                    </button>
                  </span>
                </div>
                {used.length > 0 && (
                  <p className="text-[11px] text-slate-400">
                    Also offered, from the register: {used.slice(0, 12).join(', ')}{used.length > 12 ? `, +${used.length - 12} more` : ''}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <SaveBar dirty={dirty} note={note} onReset={() => { setLists(settings.lists); setNote(''); }}
               save={() => save.mutate({ lists })} />
    </div>
  );
}

// ── Issue # numbering ────────────────────────────────────────────────────────

function NumberingSettings({ settings, templates }: { settings: Settings; templates: EntryTemplate[] }) {
  const [numbering, setNumbering] = useState(settings.numbering);
  useEffect(() => setNumbering(settings.numbering), [settings]);
  const { save, note, setNote } = useSave();
  const numbered = templates.filter((t) => t.fields.some((f) => f.name === 'issue_ref') && t.key in settings.numbering);
  const dirty = JSON.stringify(numbering) !== JSON.stringify(settings.numbering);
  const invalid = numbered.some((t) => !/\{n+\}/.test(numbering[t.key] || ''));

  return (
    <div className={card}>
      <p className="border-b border-slate-100 px-4 py-2.5 text-xs text-slate-600">
        A new finding&apos;s Issue # is filled in for you. When its report already has numbered findings, their
        numbering carries on (MRA-3 → MRA-4, 5.2 → 5.3). The first finding on a report is numbered with the
        pattern below: <code>{'{n}'}</code> is the number, <code>{'{nn}'}</code> and <code>{'{nnn}'}</code> pad it
        with zeros. It can always be changed on the form.
      </p>
      <div className="divide-y divide-slate-100">
        {numbered.map((t) => {
          const pattern = numbering[t.key] || '';
          const ok = /\{n+\}/.test(pattern);
          return (
            <label key={t.key} className="grid items-center gap-2 px-4 py-2.5 md:grid-cols-[260px_180px_1fr]">
              <span className="text-xs font-semibold text-slate-900">{t.title}</span>
              <input value={pattern} className={inputCls}
                     onChange={(e) => { setNote(''); setNumbering((n) => ({ ...n, [t.key]: e.target.value })); }} />
              <span className={`text-[11px] ${ok ? 'text-slate-500' : 'text-red-600'}`}>
                {ok ? preview(pattern) : 'Put {n} where the number goes'}
              </span>
            </label>
          );
        })}
      </div>
      <SaveBar dirty={dirty && !invalid} note={note} onReset={() => { setNumbering(settings.numbering); setNote(''); }}
               save={() => save.mutate({ numbering })} />
    </div>
  );
}

export function RegisterSettings({ initial = 'sla' }: { initial?: Section }) {
  const [section, setSection] = useState<Section>(initial);
  const settings = useQuery<Settings>({
    queryKey: ['audit-register-settings'],
    queryFn: async () => (await auditRegisterApi.settings()).data,
  });
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

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1">
        {SECTIONS.map(([id, label]) => (
          <button key={id} onClick={() => setSection(id)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${section === id
                    ? 'bg-slate-900 text-white' : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}>
            {label}
          </button>
        ))}
      </div>
      {settings.isLoading || templates.isLoading ? (
        <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-slate-300" /></div>
      ) : settings.isError || !settings.data || !templates.data ? (
        <p className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white p-6 text-sm text-red-600">
          <AlertTriangle className="h-4 w-4" /> Could not load the settings.
          <button onClick={() => settings.refetch()} className="font-semibold underline">Retry</button>
        </p>
      ) : (
        <>
          {section === 'sla' && <SlaSettings settings={settings.data} users={options.data?.users || []} />}
          {section === 'reports' && <ReportSettings templates={templates.data} options={options.data} />}
          {section === 'lists' && <ListSettings settings={settings.data} />}
          {section === 'numbering' && <NumberingSettings settings={settings.data} templates={templates.data} />}
        </>
      )}
    </div>
  );
}
