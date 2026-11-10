'use client';

// Setup > Reminders and SLAs, Reports and exams, Dropdown lists, Issue # numbering: the register's settings, set once and used wherever a finding is handled. Everyone who can read the register can
// read them (the server's GET asks for the view right); changing them is Audit Services' (the create right), so for anyone else the fields are read-only and the save bar is never drawn.
//   Reminders and SLAs   per status: when an owner is reminded and how often, when Audit Services hear of it, whether email goes too
//   Reports and exams    the list a new finding's report is picked from
//   Dropdown lists       regulators, audit firms, types of audit, titles and the rest
//   Issue # numbering    how a new finding is numbered before its report has any
import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Trash2, X } from 'lucide-react';
import {
  Button, Checkbox, ErrorState, FormField, IconButton, MultiSelect, Notice, ReadOnlyNote, RegisterTable, SaveBar, SectionCard, Select, Sheet, SkeletonRows, TextInput, useConfirm,
  useReportedMutation, type RegisterColumn,
} from '@/components/ui/ds';
import { errorMessage } from '@/components/ui/ds/reportOutcome';
import { auditRegisterApi } from '@/lib/api';
import { formatCount, formatDate } from '@/lib/format';
import type { RegisterOptions } from './FieldInput';
import { REPORT_REFRESH, ReportForm, reportNoun, reportTitle, type CatalogReport, type EntryTemplate } from './reportForm';
import { useRegisterOptions } from './registerData';

type Rule = { enabled: boolean; remind_before_due?: number | null; repeat_every?: number | null; start_within?: number | null; escalate_after?: number | null; validate_within?: number | null };
type Settings = {
  sla: Record<string, Rule>; email: boolean; audit_services: number[]; target_days: Record<string, number | null>;
  lists: Record<string, string[]>; numbering: Record<string, string>; values: Record<string, string[]>;
};
export type SettingsSection = 'reminders' | 'reports' | 'lists' | 'numbering';

// Each status's rule in the words of the person setting it: [setting, label, hint]. Every number is in days.
const SLA_ROWS: Array<[string, string, string, Array<[keyof Rule, string, string]>]> = [
  ['NS', 'Not started', 'The action plan has not started.', [
    ['remind_before_due', 'Remind the owner', 'Days before the target date.'], ['start_within', 'Nudge if still not started', 'Days after it was raised.'], ['repeat_every', 'Repeat every', 'Days between reminders.'],
  ]],
  ['IP', 'In progress', 'Work is under way. Findings with no status code follow this rule too.', [
    ['remind_before_due', 'Remind the owner', 'Days before the target date.'], ['repeat_every', 'Repeat every', 'Days between reminders.'],
  ]],
  ['DE', 'Delayed', 'Validation has asked the owner for more.', [['repeat_every', 'Remind the owner every', 'Days between reminders.']]],
  ['PD', 'Past due', 'Still open after the target date.', [
    ['repeat_every', 'Remind the owner every', 'Days between reminders.'], ['escalate_after', 'Escalate to Audit Services after', 'Days past due.'],
  ]],
  ['EXT', 'Extension', 'Given a revised target date.', [
    ['remind_before_due', 'Remind the owner', 'Days before the revised date.'], ['repeat_every', 'Repeat every', 'Days between reminders.'],
  ]],
  ['validation', 'Waiting on validation', 'Submitted by the owner, for Audit Services to validate.', [
    ['validate_within', 'Tell Audit Services once it has waited', 'Days.'], ['repeat_every', 'Repeat every', 'Days between reminders.'],
  ]],
];

const LISTS: Array<[string, string, string]> = [
  ['regulator', 'Regulators', 'The regulator on a regulatory finding.'],
  ['source_label', 'Audit firms and sources', 'Who performed an internal audit, credit review or pen test.'],
  ['type_of_audit', 'Types of audit', 'On IT pen findings.'],
  ['owner_title', 'Owner titles', 'The title beside the owner.'],
  ['remediation_type', 'Remediation types', 'On IT pen findings.'],
  ['current_internal_status', 'Internal statuses', 'On IT pen findings.'],
];

const preview = (pattern: string): string => [1, 2].map((n) => pattern.replace('{nnn}', String(n).padStart(3, '0')).replace('{nn}', String(n).padStart(2, '0')).replace('{n}', String(n))).join(', ') + ' …';
const valid = (pattern: string): boolean => /\{n+\}/.test(pattern);
const numberOf = (v: number | null | undefined): string => (v === null || v === undefined ? '' : String(v));

/** One settings save: puts the answer in the cache and refreshes what reads the settings. */
function useSave(label: string) {
  const qc = useQueryClient();
  return useReportedMutation({
    mutationFn: async (patch: Record<string, unknown>) => (await auditRegisterApi.saveSettings(patch)).data as Settings,
    success: { title: `${label} saved`, message: 'Reminders and new findings use them from now on.' },
    failure: `Couldn't save the ${label.toLowerCase()}`,
    invalidate: [['audit-register-options'], ['audit-register-reminders'], ['audit-register-next-reference']],
    onSuccess: (data) => { qc.setQueryData(['audit-register-settings'], data); },
  });
}

function SlaSettings({ settings, users, canEdit }: { settings: Settings; users: RegisterOptions['users']; canEdit: boolean }) {
  const [sla, setSla] = useState(settings.sla);
  const [email, setEmail] = useState(settings.email);
  const [team, setTeam] = useState(settings.audit_services);
  const [days, setDays] = useState(settings.target_days);
  const reset = () => { setSla(settings.sla); setEmail(settings.email); setTeam(settings.audit_services); setDays(settings.target_days); };
  useEffect(reset, [settings]);                // eslint-disable-line react-hooks/exhaustive-deps
  const save = useSave('Reminder settings');
  const dirty = JSON.stringify([sla, email, team, days]) !== JSON.stringify([settings.sla, settings.email, settings.audit_services, settings.target_days]);
  const setRule = (status: string, key: keyof Rule, value: boolean | number | null) => setSla((s) => ({ ...s, [status]: { ...s[status], [key]: value } }));

  return (
    <div className="flex flex-col gap-[16px]">
      <p className="m-0 text-ds-body text-ds-fg-muted">When owners are reminded, by the finding’s status. The daily reminder job and Remind owners in the register both follow these. A finding is reminded once per “Repeat every” at most.</p>
      {SLA_ROWS.map(([status, title, hint, parts]) => {
        const rule = sla[status] || { enabled: false };
        return (
          <SectionCard key={status} id={`sla-${status}`} title={status === 'validation' ? title : `${title} (${status})`} info={hint}>
            <div className="flex flex-col gap-[12px] p-[12px]">
              <Checkbox label={`Remind about findings that are ${title.toLowerCase()}`} checked={rule.enabled} disabled={!canEdit} onChange={(e) => setRule(status, 'enabled', e.target.checked)} />
              <div className="flex flex-wrap gap-[12px]">
                {parts.map(([key, label, partHint]) => (
                  <FormField key={key} label={label} hint={partHint} className="w-[200px]">
                    <TextInput type="number" min={0} max={3650} unit="days" placeholder="Off" disabled={!canEdit || !rule.enabled} value={numberOf(rule[key] as number | null | undefined)} onChange={(e) => setRule(status, key, e.target.value === '' ? null : Number(e.target.value))} />
                  </FormField>
                ))}
              </div>
            </div>
          </SectionCard>
        );
      })}
      <SectionCard id="sla-windows" title="Remediation windows" info="The target date AI Assist suggests for a new finding: this many days from the report date (from today, when that date is already past).">
        <div className="flex flex-wrap gap-[12px] p-[12px]">
          {Object.keys(days).map((rating) => (
            <FormField key={rating} label={rating} className="w-[160px]">
              <TextInput type="number" min={1} max={3650} unit="days" placeholder="Off" disabled={!canEdit} value={numberOf(days[rating])} onChange={(e) => setDays((d) => ({ ...d, [rating]: e.target.value === '' ? null : Number(e.target.value) }))} />
            </FormField>
          ))}
        </div>
      </SectionCard>
      <SectionCard id="sla-team" title="Audit Services" info="The people who hear of escalations and of validations that are waiting.">
        <div className="flex max-w-[480px] flex-col gap-[12px] p-[12px]">
          <FormField label="Who is on the team" hint="Nobody chosen: whoever uploads the workbook.">
            <MultiSelect label="Audit Services" options={users.map((u) => ({ value: String(u.id), label: u.name, description: u.email || undefined }))} value={team.map(String)} disabled={!canEdit} placeholder="Nobody chosen" onChange={(v) => setTeam(v.map(Number))} />
          </FormField>
          <Checkbox label="Email reminders as well as the in-app notification" checked={email} disabled={!canEdit} onChange={(e) => setEmail(e.target.checked)} />
        </div>
      </SectionCard>
      <SaveBar label="Save the reminder settings" canEdit={canEdit} dirty={dirty} invalid={false} saving={save.isPending} justSaved={false} onSave={() => save.mutate({ sla, email, audit_services: team, target_days: days })} onDiscard={reset} />
    </div>
  );
}

function ReportSettings({ templates, options, canEdit }: { templates: EntryTemplate[]; options?: RegisterOptions; canEdit: boolean }) {
  const { confirm, confirmDialog } = useConfirm();
  const [form, setForm] = useState<{ spec: EntryTemplate; report?: CatalogReport } | null>(null);
  const catalog = useQuery<CatalogReport[]>({ queryKey: ['audit-register-report-catalog'], queryFn: async () => (await auditRegisterApi.reportCatalog()).data as CatalogReport[] });
  const remove = useReportedMutation({
    mutationFn: async (id: number) => (await auditRegisterApi.deleteReport(id)).data,
    success: 'Report removed from the list',
    failure: "Couldn't remove the report",
    invalidate: REPORT_REFRESH,
  });
  // one form per source: the EY issue and recommendation sheets share their reports
  const withReports = templates.filter((t, i) => t.fields.some((f) => f.name === 'report_name' || f.name === 'project_name') && templates.findIndex((o) => o.source === t.source) === i);
  const specFor = (source: string) => withReports.find((t) => t.source === source);
  const ask = async (r: CatalogReport) => { if (await confirm({ title: 'Remove this report from the list?', message: `“${reportTitle(r)}” is removed from the list findings are added on. No finding belongs to it.`, confirmLabel: 'Remove report', tone: 'danger' })) remove.mutate(r.id); };

  const columns: RegisterColumn<CatalogReport>[] = [
    { key: 'report', header: 'Report', isRowHeader: true, cell: (r) => <span className="line-clamp-2 break-words text-ds-body font-[600] text-ds-fg [overflow-wrap:anywhere]">{reportTitle(r)}</span>, card: 'hide' },
    { key: 'kind', header: 'Kind', priority: 2, cell: (r) => <span className="text-ds-body text-ds-fg-body">{r.source_title}</span>, card: 'meta' },
    { key: 'firm', header: 'Regulator or firm', priority: 2, cell: (r) => <span className="text-ds-body text-ds-fg-body">{r.source_label || '—'}</span>, card: 'meta' },
    { key: 'number', header: 'Report number', priority: 3, cell: (r) => <span className="text-ds-body text-ds-fg-body">{r.report_number || '—'}</span>, card: 'hide' },
    { key: 'date', header: 'Date', priority: 3, cell: (r) => <span className="whitespace-nowrap text-ds-body text-ds-fg-body">{formatDate(r.report_date, { calendar: true })}</span>, card: 'hide' },
    { key: 'findings', header: 'Findings', align: 'right', cell: (r) => <span className="tabular-nums text-ds-body text-ds-fg">{formatCount(r.findings)}</span>, card: 'meta' },
    ...(canEdit ? [{
      key: 'actions', header: 'Actions', card: 'hide' as const,
      cell: (r: CatalogReport) => (
        <span className="inline-flex gap-[4px]">
          {specFor(r.source) && <IconButton label={`Edit ${reportTitle(r)}`} onClick={() => setForm({ spec: specFor(r.source) as EntryTemplate, report: r })}><Pencil aria-hidden /></IconButton>}
          <IconButton label={r.findings > 0 ? `${reportTitle(r)} cannot be removed: ${r.findings} findings belong to it` : `Remove ${reportTitle(r)}`} aria-disabled={r.findings > 0 || undefined} onClick={() => { if (r.findings === 0) void ask(r); }}><Trash2 aria-hidden /></IconButton>
        </span>
      ),
    }] : []),
  ];

  return (
    <div className="flex flex-col gap-[12px]">
      <div className="flex flex-wrap items-end justify-between gap-[8px]">
        <p className="m-0 max-w-[640px] text-ds-body text-ds-fg-muted">The audit reports and exams findings come from. Adding a finding picks its report from this list, which fills in the regulator or firm, report number, name and date. Correct a report once and its findings follow.</p>
        {canEdit && (
          <FormField label="Add a report for" className="w-[260px]">
            <Select value="" placeholder="Choose the kind" onChange={(e) => { const spec = specFor(e.target.value); if (spec) setForm({ spec }); }}>
              {withReports.map((t) => <option key={t.key} value={t.source}>{t.source === 'ey' ? 'Internal audit: EY' : t.title}</option>)}
            </Select>
          </FormField>
        )}
      </div>
      <RegisterTable<CatalogReport>
        caption="Reports and exams"
        rows={catalog.data ?? []}
        getRowId={(r) => r.id}
        loading={catalog.isLoading}
        error={catalog.isError ? { message: errorMessage(catalog.error), onRetry: () => { void catalog.refetch(); } } : null}
        empty={<p className="m-0 p-[16px] text-ds-body text-ds-fg-muted">No reports yet. Add one, or upload the workbook.</p>}
        columns={columns}
        cardTitle={(r) => <span className="break-words text-ds-body font-[600] text-ds-fg [overflow-wrap:anywhere]">{reportTitle(r)}</span>}
        cardActions={canEdit ? (r) => <Button size="sm" onClick={() => { const spec = specFor(r.source); if (spec) setForm({ spec, report: r }); }}>Edit</Button> : undefined}
      />
      <Sheet open={!!form} onClose={() => setForm(null)} title={form ? (form.report ? `Edit ${reportNoun(form.spec.layout).toLowerCase()}` : `New ${reportNoun(form.spec.layout).toLowerCase()}`) : ''} subtitle={form?.spec.title} width="md">
        {form && <ReportForm key={form.report?.id ?? 'new'} spec={form.spec} report={form.report} options={options} onDone={() => setForm(null)} onCancel={() => setForm(null)} />}
      </Sheet>
      {confirmDialog}
    </div>
  );
}

function ListSettings({ settings, canEdit }: { settings: Settings; canEdit: boolean }) {
  const [lists, setLists] = useState(settings.lists);
  const [typed, setTyped] = useState<Record<string, string>>({});
  useEffect(() => setLists(settings.lists), [settings]);
  const save = useSave('Dropdown lists');
  const dirty = JSON.stringify(lists) !== JSON.stringify(settings.lists);
  const add = (field: string) => {
    const value = (typed[field] || '').trim();
    if (!value) return;
    setLists((l) => ({ ...l, [field]: Array.from(new Set((l[field] || []).concat(value))) }));
    setTyped((t) => ({ ...t, [field]: '' }));
  };
  return (
    <div className="flex flex-col gap-[16px]">
      <p className="m-0 max-w-[720px] text-ds-body text-ds-fg-muted">The values offered in these columns’ lists when a finding is added or edited. Values the register already uses are offered too. Line of business and business unit come from Business Units, and owners are people of the platform.</p>
      {LISTS.map(([field, title, hint]) => {
        const mine = lists[field] || [];
        const used = (settings.values[field] || []).filter((v) => !mine.includes(v));
        return (
          <SectionCard key={field} id={`list-${field}`} title={title} info={hint}>
            <div className="flex flex-col gap-[8px] p-[12px]">
              <ul className="m-0 flex list-none flex-wrap gap-[6px] p-0" aria-label={title}>
                {mine.length === 0 && <li className="text-ds-body text-ds-fg-muted">Nothing set here.</li>}
                {mine.map((v) => (
                  <li key={v} className="inline-flex items-center gap-[2px] rounded-full bg-ds-primary-soft pl-[10px] text-ds-body text-ds-primary-text">
                    {v}
                    {canEdit && <IconButton label={`Remove ${v}`} onClick={() => setLists((l) => ({ ...l, [field]: (l[field] || []).filter((x) => x !== v) }))}><X aria-hidden /></IconButton>}
                  </li>
                ))}
              </ul>
              {canEdit && (
                <div className="flex max-w-[420px] items-center gap-[8px]">
                  <TextInput aria-label={`Add to ${title}`} placeholder="Add a value" value={typed[field] || ''} onChange={(e) => setTyped((t) => ({ ...t, [field]: e.target.value }))} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(field); } }} />
                  <Button leftIcon={<Plus aria-hidden />} disabled={!(typed[field] || '').trim()} onClick={() => add(field)}>Add</Button>
                </div>
              )}
              {used.length > 0 && <p className="m-0 text-ds-label text-ds-fg-muted">Also offered, from the register: {used.slice(0, 12).join(', ')}{used.length > 12 ? `, and ${formatCount(used.length - 12)} more` : ''}</p>}
            </div>
          </SectionCard>
        );
      })}
      <SaveBar label="Save the dropdown lists" canEdit={canEdit} dirty={dirty} invalid={false} saving={save.isPending} justSaved={false} onSave={() => save.mutate({ lists })} onDiscard={() => setLists(settings.lists)} />
    </div>
  );
}

function NumberingSettings({ settings, templates, canEdit }: { settings: Settings; templates: EntryTemplate[]; canEdit: boolean }) {
  const [numbering, setNumbering] = useState(settings.numbering);
  useEffect(() => setNumbering(settings.numbering), [settings]);
  const save = useSave('Numbering');
  const numbered = useMemo(() => templates.filter((t) => t.fields.some((f) => f.name === 'issue_ref') && t.key in settings.numbering), [templates, settings.numbering]);
  const dirty = JSON.stringify(numbering) !== JSON.stringify(settings.numbering);
  const invalid = numbered.some((t) => !valid(numbering[t.key] || ''));
  return (
    <div className="flex flex-col gap-[16px]">
      <p className="m-0 max-w-[720px] text-ds-body text-ds-fg-muted">A new finding’s Issue # is filled in for you. When its report already has numbered findings their numbering carries on (MRA-3, then MRA-4; 5.2, then 5.3). The first finding on a report is numbered with the pattern below: {'{n}'} is the number, {'{nn}'} and {'{nnn}'} pad it with zeros. It can always be changed on the form.</p>
      <SectionCard id="numbering" title="Patterns">
        <div className="flex flex-col gap-[12px] p-[12px]">
          {numbered.map((t) => {
            const pattern = numbering[t.key] || '';
            return (
              <FormField key={t.key} label={t.title} hint={valid(pattern) ? `Looks like ${preview(pattern)}` : undefined} error={valid(pattern) ? null : 'Put {n} where the number goes.'} className="max-w-[420px]">
                <TextInput value={pattern} disabled={!canEdit} onChange={(e) => setNumbering((n) => ({ ...n, [t.key]: e.target.value }))} />
              </FormField>
            );
          })}
        </div>
      </SectionCard>
      <SaveBar label="Save the numbering" canEdit={canEdit} dirty={dirty} invalid={invalid} saving={save.isPending} justSaved={false} onSave={() => save.mutate({ numbering })} onDiscard={() => setNumbering(settings.numbering)} />
    </div>
  );
}

export function SetupSettings({ section, canEdit }: { section: SettingsSection; canEdit: boolean }) {
  const settings = useQuery<Settings>({ queryKey: ['audit-register-settings'], queryFn: async () => (await auditRegisterApi.settings()).data as Settings });
  const templates = useQuery<EntryTemplate[]>({ queryKey: ['audit-register-templates'], staleTime: 300_000, queryFn: async () => (await auditRegisterApi.templates()).data as EntryTemplate[] });
  const options = useRegisterOptions();
  if (settings.isLoading || templates.isLoading) return <div className="rounded-ds-card border border-ds-border bg-ds-surface p-[12px]"><SkeletonRows rows={6} columns={3} label="Loading the settings" /></div>;
  if (settings.isError || templates.isError || !settings.data || !templates.data) {
    return <ErrorState title="Couldn't load the settings" message={errorMessage(settings.error ?? templates.error)} onRetry={() => { void settings.refetch(); void templates.refetch(); }} />;
  }
  return (
    <div className="flex flex-col gap-[12px]">
      {!canEdit && <ReadOnlyNote>View only</ReadOnlyNote>}
      {!canEdit && section !== 'reports' && <Notice tone="info">Audit Services change these settings.</Notice>}
      {section === 'reminders' && <SlaSettings settings={settings.data} users={options.data?.users || []} canEdit={canEdit} />}
      {section === 'reports' && <ReportSettings templates={templates.data} options={options.data} canEdit={canEdit} />}
      {section === 'lists' && <ListSettings settings={settings.data} canEdit={canEdit} />}
      {section === 'numbering' && <NumberingSettings settings={settings.data} templates={templates.data} canEdit={canEdit} />}
    </div>
  );
}
