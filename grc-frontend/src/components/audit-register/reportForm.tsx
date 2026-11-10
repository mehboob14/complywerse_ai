'use client';

// An audit report or exam in the register's own list: its details in the columns of the sheet it belongs to. A finding added on a report takes the report's regulator or firm, number, name and date from
// it, so a report is kept once (here, in Setup, or added while adding a finding) and corrected once: its findings follow. Shared by Setup > Reports and exams and by Add finding.
import { useState } from 'react';
import { Button, FormField, useReportedMutation } from '@/components/ui/ds';
import { auditRegisterApi } from '@/lib/api';
import { FieldInput, type RegisterOptions } from './FieldInput';

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
export const REPORT_COLUMNS = new Set(['regulator', 'source_label', 'report_number', 'report_name', 'report_date', 'engagement_year', 'project_name']);

export const reportTitle = (r: CatalogReport): string => r.report_name || r.project_name || r.report_number || r.report_key;
export const reportDetail = (r: CatalogReport): string => [r.source_label, r.report_number && r.report_number !== reportTitle(r) ? `#${r.report_number}` : null, r.report_date, r.engagement_year].filter(Boolean).join(' · ');
export const reportNoun = (layout?: string): string => (layout === 'regulatory' ? 'Exam or report' : layout === 'archive' ? 'Project' : 'Audit report');

/** What a change to the report list makes stale. */
export const REPORT_REFRESH: ReadonlyArray<readonly unknown[]> = [
  ['audit-register-rows'], ['audit-register-pack'], ['audit-register-reports'], ['audit-register-options'], ['audit-register-status'], ['audit-register-report-catalog'], ['audit-register-next-reference'], ['issues'],
];

export function ReportForm({ spec, report, initialName = '', options, onDone, onCancel }: {
  spec: EntryTemplate; report?: CatalogReport; initialName?: string; options?: RegisterOptions;
  onDone: (report: CatalogReport) => void; onCancel: () => void;
}) {
  const fields = spec.fields.filter((f) => REPORT_COLUMNS.has(f.name)).map((f) => ({
    ...f, kind: f.name === 'report_date' ? 'date' : f.name === 'regulator' || f.name === 'source_label' ? 'pick' : 'text',
  }));
  const sourceField = fields.some((f) => f.name === 'regulator') ? 'regulator' : 'source_label';
  const nameField = fields.some((f) => f.name === 'report_name') ? 'report_name' : 'project_name';
  const [initial] = useState<Record<string, unknown>>(() => (report
    ? Object.fromEntries(fields.map((f) => [f.name, (report as unknown as Record<string, unknown>)[f.name === 'regulator' ? 'source_label' : f.name] ?? '']))
    : { [sourceField]: spec.defaults.source_label ?? '', [nameField]: initialName }));
  const [values, setValues] = useState<Record<string, unknown>>(initial);
  const save = useReportedMutation({
    mutationFn: async () => {
      // an edit sends only what changed, so the findings keep the rest
      const changed = Object.entries(values).filter(([k, v]) => !report || String(v ?? '') !== String(initial[k] ?? ''));
      const body: Record<string, unknown> = Object.fromEntries(changed.map(([k, v]) => [k === 'regulator' ? 'source_label' : k, v === '' ? null : v]));
      return (await (report ? auditRegisterApi.updateReport(report.id, body) : auditRegisterApi.addReport(spec.source, body))).data as CatalogReport;
    },
    success: report ? 'Report saved' : 'Report added',
    failure: "Couldn't save the report",
    invalidate: REPORT_REFRESH,
    retryable: false,
    onSuccess: (saved) => onDone(saved),
  });
  const named = ['report_number', 'report_name', 'project_name'].some((k) => String(values[k] ?? '').trim());

  return (
    <div className="flex flex-col gap-[12px] rounded-ds-card border border-ds-border bg-ds-surface-subtle p-[12px]">
      {fields.map((f) => (
        <FormField key={f.name} label={f.label}>
          <FieldInput field={f} value={values[f.name] ?? ''} options={options} disabled={save.isPending} onChange={(v) => setValues((d) => ({ ...d, [f.name]: v }))} />
        </FormField>
      ))}
      <div className="flex flex-wrap justify-end gap-[8px]">
        <Button onClick={onCancel} disabled={save.isPending}>Cancel</Button>
        <Button variant="primary" loading={save.isPending} disabled={!named} onClick={() => save.mutate()}>{report ? 'Save report' : `Add ${reportNoun(spec.layout).toLowerCase()}`}</Button>
      </div>
    </div>
  );
}
