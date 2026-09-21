'use client';

/**
 * Add one finding by hand. Pick the kind of finding and the audit report or
 * exam it came from — reports are kept once under Settings, or added here — and
 * the report's details, its source and the next Issue # fill themselves in.
 * The rest are that kind of finding's own columns, with a dropdown wherever the
 * register keeps a list, and AI Assist can propose the empty ones from what
 * has been entered. It becomes a register finding like any imported row
 * (issue, action plan, links, Statutory Audit for an MRA), and next month's
 * workbook updates it rather than adding it twice.
 */
import { Fragment, useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Plus } from 'lucide-react';
import { MultiSelectDropdown } from '@/components/ui';
import { auditRegisterApi } from '@/lib/api';
import { FieldInput, GROUP_ORDER, inputCls, type Options } from './FindingForm';
import { AiAssistBar, type AiAssistResult, type AiSuggestion } from './AiAssist';

export type EntryTemplate = {
  key: string; label: string; title: string; hint: string; sheet: string; source: string;
  record_type: string; layout: string; defaults: Record<string, unknown>;
  fields: Array<{ name: string; label: string; group: string; kind: string }>;
};

export type CatalogReport = {
  id: number; source: string; source_title: string; report_key: string; source_label: string | null;
  report_number: string | null; report_name: string | null; report_date: string | null;
  engagement_year: string | null; project_name: string | null; notes: string | null; findings: number;
};

/** The columns a picked report fills in; the regulatory sheet calls its source "Regulator". */
const REPORT_COLUMNS = new Set(['regulator', 'source_label', 'report_number', 'report_name', 'report_date',
  'engagement_year', 'project_name']);
const SOURCE_GROUP = 'Where it came from';
// AI Assist sits under the last of these a finding type has: what it reads from.
const AI_READS = ['title', 'issue_text', 'condition'];

export const reportTitle = (r: CatalogReport) =>
  r.report_name || r.project_name || r.report_number || r.report_key;
export const reportDetail = (r: CatalogReport) => [r.source_label,
  r.report_number && r.report_number !== reportTitle(r) ? `#${r.report_number}` : null,
  r.report_date, r.engagement_year].filter(Boolean).join(' · ');
export const reportNoun = (layout?: string) =>
  layout === 'regulatory' ? 'Exam / report' : layout === 'archive' ? 'Project' : 'Audit report';

const smallBtn = 'rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50';
const primaryBtn = 'inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-semibold text-[#0a0a0a] hover:bg-primary-700 disabled:opacity-50';

export const REGISTER_QUERIES = ['audit-register-rows', 'audit-register-pack', 'audit-register-reports',
  'audit-register-options', 'audit-register-status', 'audit-register-report-catalog',
  'audit-register-next-reference', 'issues'];

/** A report's own details, in the columns of the sheet it belongs to. */
export function ReportForm({ spec, report, initialName = '', options, onDone, onCancel }: {
  spec: EntryTemplate; report?: CatalogReport; initialName?: string; options?: Options;
  onDone: (report: CatalogReport) => void; onCancel: () => void;
}) {
  const queryClient = useQueryClient();
  const fields = spec.fields.filter((f) => REPORT_COLUMNS.has(f.name)).map((f) => ({
    ...f, kind: f.name === 'report_date' ? 'date' : f.name === 'regulator' || f.name === 'source_label' ? 'pick' : 'text',
  }));
  const sourceField = fields.some((f) => f.name === 'regulator') ? 'regulator' : 'source_label';
  const nameField = fields.some((f) => f.name === 'report_name') ? 'report_name' : 'project_name';
  const [initial] = useState<Record<string, any>>(() => report
    ? Object.fromEntries(fields.map((f) => [f.name,
      (report as Record<string, any>)[f.name === 'regulator' ? 'source_label' : f.name] ?? '']))
    : { [sourceField]: spec.defaults.source_label ?? '', [nameField]: initialName });
  const [values, setValues] = useState<Record<string, any>>(initial);
  const [error, setError] = useState('');

  const save = useMutation({
    mutationFn: async () => {
      // An edit sends only what changed, so findings keep the rest.
      const changed = Object.entries(values).filter(([k, v]) => !report || String(v ?? '') !== String(initial[k] ?? ''));
      const body: Record<string, unknown> = Object.fromEntries(
        changed.map(([k, v]) => [k === 'regulator' ? 'source_label' : k, v === '' ? null : v]));
      return (await (report ? auditRegisterApi.updateReport(report.id, body)
        : auditRegisterApi.addReport(spec.source, body))).data as CatalogReport;
    },
    onSuccess: (saved) => {
      REGISTER_QUERIES.forEach((k) => queryClient.invalidateQueries({ queryKey: [k] }));
      onDone(saved);
    },
    onError: (e: any) => setError(e?.response?.data?.detail || 'Could not save the report.'),
  });
  const named = ['report_number', 'report_name', 'project_name'].some((k) => String(values[k] ?? '').trim());

  return (
    <div className="space-y-2 rounded-lg border border-primary-200 bg-primary-50/40 p-2.5">
      {error && <p className="rounded bg-red-50 px-2 py-1 text-[11px] text-red-700">{error}</p>}
      {fields.map((f) => (
        <label key={f.name} className="grid grid-cols-[130px_1fr] items-start gap-2">
          <span className="pt-1 text-[11px] text-slate-500">{f.label}</span>
          <FieldInput field={f} value={values[f.name] ?? ''} options={options}
                      onChange={(v) => setValues((d) => ({ ...d, [f.name]: v }))} />
        </label>
      ))}
      <div className="flex justify-end gap-1.5">
        <button onClick={onCancel} className={smallBtn}>Cancel</button>
        <button onClick={() => save.mutate()} disabled={!named || save.isPending} className={primaryBtn}>
          {save.isPending && <Loader2 className="h-3 w-3 animate-spin" />}
          {report ? 'Save report' : `Add ${reportNoun(spec.layout).toLowerCase()}`}
        </button>
      </div>
    </div>
  );
}

export function NewFindingForm({ template, prefill, onCreated, onCancel }: {
  template?: string | null;
  prefill?: Record<string, unknown>;
  onCreated: (issueId: number) => void;
  onCancel: () => void;
}) {
  const queryClient = useQueryClient();
  const [key, setKey] = useState(template || 'regulatory');
  const [values, setValues] = useState<Record<string, any>>({});
  const [reportId, setReportId] = useState<number | null>(null);
  const [addingReport, setAddingReport] = useState<string | null>(null);   // the new report's name so far
  const [refTyped, setRefTyped] = useState(false);
  const [error, setError] = useState('');
  const [ai, setAi] = useState<AiAssistResult | null>(null);
  const [aiError, setAiError] = useState('');
  // Fields filled from AI Assist, with the value it gave: marked until changed.
  const [applied, setApplied] = useState<Record<string, { value: any; source: AiSuggestion['source'] }>>({});

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
  const catalog = useQuery<CatalogReport[]>({
    queryKey: ['audit-register-report-catalog'],
    queryFn: async () => (await auditRegisterApi.reportCatalog()).data,
    staleTime: 60_000,
  });
  const spec = templates.data?.find((t) => t.key === key);
  const hasReport = !!spec?.fields.some((f) => REPORT_COLUMNS.has(f.name));
  const hasRef = !!spec?.fields.some((f) => f.name === 'issue_ref');
  const reports = (catalog.data || []).filter((r) => r.source === spec?.source);
  const report = reports.find((r) => r.id === reportId);

  // A new kind of finding starts from its defaults plus what the report row already says.
  useEffect(() => {
    if (!spec) return;
    const names = new Set(spec.fields.map((f) => f.name));
    const carried = Object.fromEntries(Object.entries(prefill || {}).filter(([k]) => names.has(k)));
    setValues({ ...spec.defaults, ...carried });
    setAddingReport(null);
    setRefTyped(false);
    setError('');
    setAi(null);
    setAiError('');
    setApplied({});
  }, [spec?.key]); // eslint-disable-line react-hooks/exhaustive-deps

  // Added from a report's row: start on that report.
  useEffect(() => {
    const wanted = prefill?.report_key;
    const match = wanted ? catalog.data?.find((r) => r.source === spec?.source && r.report_key === wanted) : undefined;
    if (match) setReportId((current) => current ?? match.id);
  }, [catalog.data, spec?.source]); // eslint-disable-line react-hooks/exhaustive-deps

  // The Issue #: the report's own numbering carried on, else the pattern in Settings.
  const nextRef = useQuery<{ reference: string }>({
    queryKey: ['audit-register-next-reference', key, report?.report_key ?? ''],
    queryFn: async () => (await auditRegisterApi.nextReference(key, report?.report_key)).data,
    enabled: !!spec && hasRef,
  });
  useEffect(() => {
    const reference = nextRef.data?.reference;
    if (reference && !refTyped) setValues((d) => ({ ...d, issue_ref: reference }));
  }, [nextRef.data, refTyped, spec?.key]);

  const [sourceRest, groups] = useMemo(() => {
    const own = (spec?.fields || []).filter((f) => !REPORT_COLUMNS.has(f.name) && f.name !== 'issue_ref');
    const header = hasReport || hasRef;
    return [
      header ? own.filter((f) => f.group === SOURCE_GROUP) : [],
      GROUP_ORDER.filter((g) => !(header && g === SOURCE_GROUP))
        .map((g) => ({ title: g, fields: own.filter((f) => f.group === g) }))
        .filter((g) => g.fields.length),
    ];
  }, [spec, hasReport, hasRef]);

  const filled = () => Object.fromEntries(Object.entries(values)
    .filter(([k, v]) => v !== '' && v != null && !(report && REPORT_COLUMNS.has(k))));
  const same = (a: unknown, b: unknown) => String(a ?? '') === String(b ?? '');

  const assist = useMutation({
    mutationFn: async () => (await auditRegisterApi.assist(key, filled(), report?.id)).data as AiAssistResult,
    onSuccess: (data) => { setAi(data); setAiError(''); },
    onError: (e: any) => setAiError(e?.response?.data?.detail || 'AI Assist could not run. Try again.'),
  });
  const said = (spec?.fields || []).filter((f) => f.kind === 'title' || f.kind === 'long')
    .map((f) => String(values[f.name] ?? '')).join(' ').trim();
  const pending = (ai?.suggestions || []).filter((s) => !(applied[s.field] && same(applied[s.field].value, s.value)));
  const use = (s: AiSuggestion) => {
    setValues((d) => ({ ...d, [s.field]: s.value }));
    setApplied((a) => ({ ...a, [s.field]: { value: s.value, source: s.source } }));
  };
  // Use all never writes over what the person typed after asking.
  const useAll = () => pending.filter((s) => !String(values[s.field] ?? '').trim()).forEach(use);
  const labelOf = (name: string) => spec?.fields.find((f) => f.name === name)?.label || name;

  const create = useMutation({
    mutationFn: async () => {
      const aiFields = Object.entries(applied)
        .filter(([k, a]) => a.source === 'ai' && same(values[k], a.value)).map(([k]) => k);
      return (await auditRegisterApi.addFinding(key, filled(), report?.id, aiFields)).data as { issue_id: number };
    },
    onSuccess: (data) => {
      REGISTER_QUERIES.forEach((k) => queryClient.invalidateQueries({ queryKey: [k] }));
      onCreated(data.issue_id);
    },
    onError: (e: any) => setError(e?.response?.data?.detail || 'Could not add the finding.'),
  });

  if (templates.isLoading) {
    return <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-slate-300" /></div>;
  }

  const row = (field: { name: string; label: string; kind: string }) => {
    const mark = applied[field.name];
    const marked = mark && same(values[field.name], mark.value);
    return (
    <label key={field.name} className="grid grid-cols-[150px_1fr] items-start gap-2 px-3 py-2">
      <span className="pt-1 text-[11px] text-slate-500">
        {field.label}{field.name === 'title' && <span className="text-red-500"> *</span>}
        {marked && (
          <span title={mark.source === 'ai' ? 'Drafted by AI Assist. Review it.' : 'Filled in from your settings and register'}
                className="ml-1 rounded bg-primary-50 px-1 text-[9px] font-semibold uppercase text-primary-700 ring-1 ring-primary-200">
            {mark.source === 'ai' ? 'AI' : 'Auto'}
          </span>
        )}
      </span>
      <FieldInput field={field} value={values[field.name] ?? ''} options={options.data}
                  onChange={(v) => setValues((d) => ({ ...d, [field.name]: v }))} />
    </label>
    );
  };

  const aiBar = (
    <AiAssistBar canRun={said.length >= 3} running={assist.isPending} error={aiError} result={ai}
                 pending={pending} appliedCount={Object.keys(applied).length} labelOf={labelOf}
                 onRun={() => assist.mutate()} onUse={use} onUseAll={useAll} onClose={() => setAi(null)} />
  );
  const aiAnchor = [...(spec?.fields || [])].reverse().find((f) => AI_READS.includes(f.name))?.name;

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">What kind of finding?</p>
        <div className="mt-1.5 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
          {(templates.data || []).map((t) => (
            <button key={t.key} onClick={() => setKey(t.key)} title={t.hint}
                    className={`rounded-lg border bg-white px-2.5 py-1.5 text-left ${key === t.key
                      ? 'border-primary-500 ring-1 ring-primary-500' : 'border-slate-200 hover:border-slate-300'}`}>
              <span className="block text-xs font-semibold text-slate-800">{t.title}</span>
              <span className="block text-[10px] text-slate-400">{t.sheet.trim()} sheet</span>
            </button>
          ))}
        </div>
        {spec?.hint && <p className="mt-2 text-[11px] text-slate-500">{spec.hint}</p>}
      </div>

      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}

      {spec && (hasReport || hasRef) && (
        <section className="rounded-xl border border-slate-200 bg-white">
          <h4 className="border-b border-slate-100 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            {SOURCE_GROUP}
          </h4>
          <div className="divide-y divide-slate-50">
            {hasReport && (
              <div className="grid grid-cols-[150px_1fr] items-start gap-2 px-3 py-2">
                <span className="pt-1 text-[11px] text-slate-500">{reportNoun(spec.layout)}</span>
                <div className="space-y-1">
                  <MultiSelectDropdown
                    title={reportNoun(spec.layout)}
                    items={reports.map((r) => ({
                      value: String(r.id), label: reportTitle(r),
                      subLabel: [reportDetail(r), `${r.findings} finding${r.findings === 1 ? '' : 's'}`].filter(Boolean).join(' · '),
                    }))}
                    selectedValues={report ? [String(report.id)] : []}
                    onApply={(v) => { setReportId(v[0] ? Number(v[0]) : null); setRefTyped(false); }}
                    onCreate={(text) => setAddingReport(text)}
                    multiSelect={false}
                    triggerVariant="input"
                    placeholder={catalog.isLoading ? 'Loading…' : reports.length ? `Pick the ${reportNoun(spec.layout).toLowerCase()}` : 'None yet — add the first'}
                    searchPlaceholder="Search, or type a new name…"
                    forceSearch
                    showAvatars={false}
                    size="sm"
                    className="w-full"
                    triggerClassName="w-full"
                  />
                  {report && <p className="text-[11px] text-slate-500">{reportDetail(report) || 'No other details'}</p>}
                  {addingReport === null && (
                    <button onClick={() => setAddingReport('')} className="text-[11px] font-semibold text-primary-700 hover:underline">
                      + New {reportNoun(spec.layout).toLowerCase()}
                    </button>
                  )}
                </div>
              </div>
            )}
            {hasReport && addingReport !== null && (
              <div className="px-3 py-2">
                <ReportForm spec={spec} initialName={addingReport} options={options.data}
                            onDone={(r) => { setReportId(r.id); setAddingReport(null); setRefTyped(false); }}
                            onCancel={() => setAddingReport(null)} />
              </div>
            )}
            {hasRef && (
              <label className="grid grid-cols-[150px_1fr] items-start gap-2 px-3 py-2">
                <span className="pt-1 text-[11px] text-slate-500">Issue #</span>
                <div>
                  <input value={values.issue_ref ?? ''} className={inputCls}
                         onChange={(e) => { setRefTyped(true); setValues((d) => ({ ...d, issue_ref: e.target.value })); }} />
                  <p className="mt-0.5 text-[10px] text-slate-400">
                    {refTyped ? 'Your own number' : report ? 'The next number on this report — change it if the report numbers differently'
                      : 'Numbered as set under Settings'}
                  </p>
                </div>
              </label>
            )}
            {sourceRest.map(row)}
          </div>
        </section>
      )}

      {groups.map((group) => (
        <section key={group.title} className="rounded-xl border border-slate-200 bg-white">
          <h4 className="border-b border-slate-100 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            {group.title}
          </h4>
          <div className="divide-y divide-slate-50">
            {group.fields.map((f) => (
              <Fragment key={f.name}>{row(f)}{f.name === aiAnchor && aiBar}</Fragment>
            ))}
          </div>
        </section>
      ))}

      <div className="sticky bottom-0 flex justify-end gap-2 border-t border-slate-100 bg-white py-2">
        <button onClick={onCancel} className={smallBtn}>Cancel</button>
        <button onClick={() => create.mutate()} disabled={create.isPending || !String(values.title || '').trim()}
                className={primaryBtn}>
          {create.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
          Add to the register
        </button>
      </div>
    </div>
  );
}
