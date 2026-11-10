'use client';

// Add one finding by hand (the create right: POST /findings). Pick the kind of finding and the audit report or exam it came from (reports are kept once under Setup, or added here) and the report's
// details, its source and the next Issue # fill themselves in. The rest are that kind of finding's own columns, with a list wherever the register keeps one; AI Assist can propose the empty ones from what
// has been entered. It becomes a register finding like any imported row (issue, action plan, links, Statutory Audit for an MRA), and next month's workbook updates it rather than adding it twice.
import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { Button, Combobox, FormField, Select, Sheet, SkeletonLines, TextInput, useReportedMutation, ErrorState } from '@/components/ui/ds';
import { errorMessage } from '@/components/ui/ds/reportOutcome';
import { auditRegisterApi } from '@/lib/api';
import { AiAssistPanel, type AiAssistResult, type AiSuggestion } from './AiAssist';
import { FieldInput, GROUP_ORDER } from './FieldInput';
import { REFRESH_ALL, useRegisterOptions } from './registerData';
import { REPORT_COLUMNS, REPORT_REFRESH, ReportForm, reportDetail, reportNoun, reportTitle, type CatalogReport, type EntryTemplate } from './reportForm';

const SOURCE_GROUP = 'Where it came from';
const AI_READS = ['title', 'issue_text', 'condition'];          // AI Assist sits under the last of these a finding type has: what it reads from
const same = (a: unknown, b: unknown): boolean => String(a ?? '') === String(b ?? '');
const GROUP_HEAD = 'm-0 !text-ds-label !font-[600] !text-ds-fg-muted';

export function NewFindingSheet({ open, template, prefill, onClose, onCreated }: {
  open: boolean; template?: string | null; prefill?: Record<string, unknown>; onClose: () => void; onCreated: (issueId: number) => void;
}) {
  const [key, setKey] = useState(template || 'regulatory');
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [reportId, setReportId] = useState<number | null>(null);
  const [addingReport, setAddingReport] = useState<string | null>(null);        // the new report's name so far
  const [refTyped, setRefTyped] = useState(false);
  const [ai, setAi] = useState<AiAssistResult | null>(null);
  const [aiError, setAiError] = useState('');
  const [applied, setApplied] = useState<Record<string, { value: unknown; source: AiSuggestion['source'] }>>({});      // filled from AI Assist: marked until changed

  const templates = useQuery<EntryTemplate[]>({ queryKey: ['audit-register-templates'], staleTime: 300_000, enabled: open, queryFn: async () => (await auditRegisterApi.templates()).data as EntryTemplate[] });
  const options = useRegisterOptions(open);
  const catalog = useQuery<CatalogReport[]>({ queryKey: ['audit-register-report-catalog'], staleTime: 60_000, enabled: open, queryFn: async () => (await auditRegisterApi.reportCatalog()).data as CatalogReport[] });
  const spec = templates.data?.find((t) => t.key === key);
  const hasReport = !!spec?.fields.some((f) => REPORT_COLUMNS.has(f.name));
  const hasRef = !!spec?.fields.some((f) => f.name === 'issue_ref');
  const reports = (catalog.data || []).filter((r) => r.source === spec?.source);
  const report = reports.find((r) => r.id === reportId);

  // each time the sheet opens it starts on the kind of finding it was asked for
  useEffect(() => { if (open) { setKey(template || 'regulatory'); setReportId(null); } }, [open, template]);       // eslint-disable-line react-hooks/exhaustive-deps
  // a new kind of finding starts from its defaults plus what the report row already says
  useEffect(() => {
    if (!spec) return;
    const names = new Set(spec.fields.map((f) => f.name));
    setValues({ ...spec.defaults, ...Object.fromEntries(Object.entries(prefill || {}).filter(([k]) => names.has(k))) });
    setAddingReport(null); setRefTyped(false); setAi(null); setAiError(''); setApplied({});
  }, [spec?.key, open]);                // eslint-disable-line react-hooks/exhaustive-deps
  // added from a report's row: start on that report
  useEffect(() => {
    const wanted = prefill?.report_key;
    const match = wanted ? catalog.data?.find((r) => r.source === spec?.source && r.report_key === wanted) : undefined;
    if (match) setReportId((current) => current ?? match.id);
  }, [catalog.data, spec?.source]);     // eslint-disable-line react-hooks/exhaustive-deps

  // the Issue #: the report's own numbering carried on, else the pattern in Settings
  const nextRef = useQuery<{ reference: string }>({
    queryKey: ['audit-register-next-reference', key, report?.report_key ?? ''],
    enabled: open && !!spec && hasRef,
    queryFn: async () => (await auditRegisterApi.nextReference(key, report?.report_key)).data as { reference: string },
  });
  useEffect(() => { const reference = nextRef.data?.reference; if (reference && !refTyped) setValues((d) => ({ ...d, issue_ref: reference })); }, [nextRef.data, refTyped, spec?.key]);   // eslint-disable-line react-hooks/exhaustive-deps

  const [sourceRest, groups] = useMemo(() => {
    const own = (spec?.fields || []).filter((f) => !REPORT_COLUMNS.has(f.name) && f.name !== 'issue_ref');
    const header = hasReport || hasRef;
    return [
      header ? own.filter((f) => f.group === SOURCE_GROUP) : [],
      GROUP_ORDER.filter((g) => !(header && g === SOURCE_GROUP)).map((g) => ({ title: g, fields: own.filter((f) => f.group === g) })).filter((g) => g.fields.length),
    ] as const;
  }, [spec, hasReport, hasRef]);

  const filled = () => Object.fromEntries(Object.entries(values).filter(([k, v]) => v !== '' && v != null && !(report && REPORT_COLUMNS.has(k))));
  const assist = useReportedMutation({
    mutationFn: async () => (await auditRegisterApi.assist(key, filled(), report?.id)).data as AiAssistResult,
    failure: 'AI Assist could not run',
    fallback: 'AI Assist could not run. Try again.',
    toast: 'none',
    onSuccess: (data) => { setAi(data); setAiError(''); },
    onError: (e) => setAiError(errorMessage(e, 'AI Assist could not run. Try again.')),
  });
  const said = (spec?.fields || []).filter((f) => f.kind === 'title' || f.kind === 'long').map((f) => String(values[f.name] ?? '')).join(' ').trim();
  const pending = (ai?.suggestions || []).filter((s) => !(applied[s.field] && same(applied[s.field].value, s.value)));
  const use = (s: AiSuggestion) => { setValues((d) => ({ ...d, [s.field]: s.value })); setApplied((a) => ({ ...a, [s.field]: { value: s.value, source: s.source } })); };
  const useAll = () => pending.filter((s) => !String(values[s.field] ?? '').trim()).forEach(use);       // never writes over what the person typed after asking
  const labelOf = (name: string): string => spec?.fields.find((f) => f.name === name)?.label || name;

  const create = useReportedMutation({
    mutationFn: async () => {
      const aiFields = Object.entries(applied).filter(([k, a]) => a.source === 'ai' && same(values[k], a.value)).map(([k]) => k);
      return (await auditRegisterApi.addFinding(key, filled(), report?.id, aiFields)).data as { issue_id: number };
    },
    success: 'Finding added to the register',
    failure: "Couldn't add the finding",
    invalidate: [...REFRESH_ALL, ...REPORT_REFRESH],
    retryable: false,
    onSuccess: (data) => onCreated(data.issue_id),
  });

  const label = (f: { name: string; label: string }): ReactNode => {
    const mark = applied[f.name];
    const marked = mark && same(values[f.name], mark.value);
    return <>{f.label}{marked && <span className="ml-[6px] rounded-ds-control bg-ds-primary-soft px-[6px] text-ds-label font-[600] text-ds-primary-text">{mark.source === 'ai' ? 'AI draft: check it' : 'Auto'}</span>}</>;
  };
  const row = (f: { name: string; label: string; kind: string }) => (
    <FormField key={f.name} label={label(f)} required={f.name === 'title'}>
      <FieldInput field={f} value={values[f.name] ?? ''} options={options.data} disabled={create.isPending} onChange={(v) => setValues((d) => ({ ...d, [f.name]: v }))} />
    </FormField>
  );
  const aiAnchor = [...(spec?.fields || [])].reverse().find((f) => AI_READS.includes(f.name))?.name;
  const dirty = !!spec && Object.entries(values).some(([k, v]) => !same(v, spec.defaults[k]) && String(v ?? '').trim() !== '');

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Add a finding"
      subtitle="Pick the kind of finding and the report it came from"
      width="lg"
      dirty={dirty && !create.isPending}
      footer={(
        <div className="flex w-full flex-wrap justify-end gap-[8px]">
          <Button onClick={onClose} disabled={create.isPending}>Cancel</Button>
          <Button variant="primary" leftIcon={<Plus aria-hidden />} loading={create.isPending} disabled={!String(values.title ?? '').trim()} onClick={() => create.mutate()}>Add to the register</Button>
        </div>
      )}
    >
      {templates.isLoading ? <SkeletonLines lines={6} label="Loading the kinds of finding" />
        : templates.isError || !templates.data ? <ErrorState compact title="Couldn't load the kinds of finding" message={errorMessage(templates.error)} onRetry={() => { void templates.refetch(); }} />
        : (
          <div className="flex flex-col gap-[16px]">
            <FormField label="What kind of finding?" hint={spec?.hint}>
              <Select value={key} disabled={create.isPending} onChange={(e) => setKey(e.target.value)}>
                {templates.data.map((t) => <option key={t.key} value={t.key}>{t.title} · {t.sheet.trim()} sheet</option>)}
              </Select>
            </FormField>

            {spec && (hasReport || hasRef) && (
              <section aria-label={SOURCE_GROUP} className="flex flex-col gap-[12px]">
                <h3 className={GROUP_HEAD}>{SOURCE_GROUP}</h3>
                {hasReport && (
                  <FormField label={reportNoun(spec.layout)} hint={report ? reportDetail(report) || 'No other details' : undefined}>
                    <div className="flex flex-col gap-[8px]">
                      <Combobox
                        label={reportNoun(spec.layout)} value={report ? String(report.id) : null} clearable disabled={create.isPending}
                        options={reports.map((r) => ({ value: String(r.id), label: reportTitle(r), description: [reportDetail(r), `${r.findings} ${r.findings === 1 ? 'finding' : 'findings'}`].filter(Boolean).join(' · ') }))}
                        placeholder={catalog.isLoading ? 'Loading' : reports.length ? `Pick the ${reportNoun(spec.layout).toLowerCase()}` : 'None yet: add the first'} searchPlaceholder="Search the reports"
                        onChange={(v) => { setReportId(v ? Number(v) : null); setRefTyped(false); }}
                      />
                      {addingReport === null && <div><Button variant="link" onClick={() => setAddingReport('')}>New {reportNoun(spec.layout).toLowerCase()}</Button></div>}
                    </div>
                  </FormField>
                )}
                {hasReport && addingReport !== null && (
                  <ReportForm spec={spec} initialName={addingReport} options={options.data} onDone={(r) => { setReportId(r.id); setAddingReport(null); setRefTyped(false); }} onCancel={() => setAddingReport(null)} />
                )}
                {hasRef && (
                  <FormField label="Issue #" hint={refTyped ? 'Your own number' : report ? 'The next number on this report: change it if the report numbers differently' : 'Numbered as set under Setup'}>
                    <TextInput value={String(values.issue_ref ?? '')} disabled={create.isPending} onChange={(e) => { setRefTyped(true); setValues((d) => ({ ...d, issue_ref: e.target.value })); }} />
                  </FormField>
                )}
                {sourceRest.map(row)}
              </section>
            )}

            {groups.map((group) => (
              <section key={group.title} aria-label={group.title} className="flex flex-col gap-[12px]">
                <h3 className={GROUP_HEAD}>{group.title}</h3>
                {group.fields.map((f) => (
                  <Fragment key={f.name}>
                    {row(f)}
                    {f.name === aiAnchor && (
                      <AiAssistPanel canRun={said.length >= 3} running={assist.isPending} error={aiError} result={ai} pending={pending} appliedCount={Object.keys(applied).length} labelOf={labelOf}
                        onRun={() => assist.mutate()} onUse={use} onUseAll={useAll} onClose={() => setAi(null)} />
                    )}
                  </Fragment>
                ))}
              </section>
            ))}
          </div>
        )}
    </Sheet>
  );
}
