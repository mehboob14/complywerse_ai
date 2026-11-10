'use client';

// The findings of a drill (the "Findings" tab): what it showed up, with who fixes each and by when. A finding's remediation is DERIVED from the Issue/CAPA handed to Issues (it cannot be closed
// here), so each row says where it stands and links to the issue and the risk it is tied to. Raising one is the form above the table (at or above the tenant's issue threshold it opens an
// issue by itself, and the form says which severity that is); it can be given an owner and a due day when it is raised, and later from the Findings register. What a person may do is what the page
// has always asked for: `bcm:findings:create` to raise, `bcm:findings:edit` to create the issue or link a risk, `bcm:findings:delete` to delete; the row menu holds those and shows only what the
// person may do (the actions are findingActions.tsx, shared with the register's panel). A list of 40 findings is a paged table (cards below 768px).
import { useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { ClipboardCheck, ExternalLink, Link2, Plus, Trash2 } from 'lucide-react';
import { bcmApi } from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';
import { truncate } from '@/lib/format';
import { findingStatus, optionsOf, severity } from '@/lib/statuses/bcm';
import {
  Button, EmptyState, FormField, Menu, Pager, RegisterTable, SectionCard, Select, Textarea, TextInput, useReportedMutation, type RegisterColumn, type SortState,
} from '@/components/ui/ds';
import { errorMessage } from '@/components/ui/ds/reportOutcome';
import { DayCell, OwnerCell } from '../../_register/bits';
import { useFindingActions } from '../../_findings/findingActions';
import { ClampedText, EntityCombobox, FormProblem, LABEL_LINK, Pill, TEXT_LINK } from '../../_bcm-ui';
import { REFRESH_ALL, useIssueThreshold } from '../../bcmData';
import {
  NAME_MAX, blankFindingForm, findingErrors, findingHint, findingPayload, findingSortValue, ordered, pageOf, plural, type Drill, type Finding, type FindingForm,
} from '../../bcmModel';

const MUTED = 'text-ds-fg-muted';
const NOUN = { one: 'finding', other: 'findings' };
const SIZES = [10, 25, 50] as const;

function FindingCell({ f }: { f: Finding }) {
  return (
    <div className="min-w-0">
      <span className="line-clamp-2 break-words text-ds-body font-[500] text-ds-fg [overflow-wrap:anywhere]" title={f.title}>{f.title}</span>
      {f.description && <ClampedText text={f.description} max={160} className="mt-[2px]" />}
    </div>
  );
}

function Remediation({ f }: { f: Finding }) {
  return (
    <span className="flex flex-wrap items-center gap-x-[8px] gap-y-[4px]">
      <Pill registry={findingStatus} word={f.issue_status} />
      {f.issue_code && (
        <Link href="/issues/register" title="Open in Issues / CAPA" className={`inline-flex items-center gap-[4px] text-ds-label ${LABEL_LINK}`}>{f.issue_code}<ExternalLink aria-hidden size={12} /></Link>
      )}
    </span>
  );
}

function RiskCell({ f }: { f: Finding }) {
  if (!f.linked_risk_id) return <span className={MUTED}>Not linked</span>;
  return <Link href={`/erm/risks/${f.linked_risk_id}`} title={f.linked_risk_title || undefined} className={`block ${TEXT_LINK}`}><span className="line-clamp-2 break-words">{f.linked_risk_title || 'Open the risk'}</span></Link>;
}

export function FindingsCard({ drill, canAdd }: { drill: Drill; canAdd: boolean }) {
  const { hasPermission } = usePermissions();
  const canEditFinding = hasPermission('bcm:findings:edit');
  const canDeleteFinding = hasPermission('bcm:findings:delete');
  const findings = useMemo(() => drill.findings ?? [], [drill.findings]);
  const addButton = useRef<HTMLButtonElement | HTMLAnchorElement>(null);
  const actions = useFindingActions({ extraRefresh: [['bcm-drill', drill.id]], onRemoved: () => addButton.current?.focus() });     // the row the person was on is gone, and focus with it
  const threshold = useIssueThreshold(canAdd);

  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState<FindingForm>(blankFindingForm);
  const [showErrors, setShowErrors] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [sort, setSort] = useState<SortState>(null);
  const [page, setPage] = useState(1);
  const [size, setSize] = useState<number>(25);
  const errors = findingErrors(form);
  const now = useMemo(() => Date.now(), [drill.findings]);          // eslint-disable-line react-hooks/exhaustive-deps

  const add = useReportedMutation({
    mutationFn: async (payload: ReturnType<typeof findingPayload>) => (await bcmApi.findings.create(drill.id, payload)).data as Finding,
    success: (f) => ({ title: 'Finding raised', message: f?.issue_code ? `Auto-opened issue ${f.issue_code} for remediation.` : undefined }),
    failure: "Couldn't raise the finding", retryable: false, toast: 'success', invalidate: [['bcm-drill', drill.id], ...REFRESH_ALL],
    onSuccess: () => { setShowAdd(false); setForm(blankFindingForm()); setProblem(null); setShowErrors(false); },
    onError: (error) => setProblem(errorMessage(error)),
  });

  const submit = () => {
    setProblem(null);
    if (Object.keys(errors).length > 0) { setShowErrors(true); return; }
    add.mutate(findingPayload(form));
  };

  const sorted = useMemo(() => ordered(findings, sort, findingSortValue), [findings, sort]);
  const { rows, range } = pageOf(sorted, page, size);
  const hasActions = canEditFinding || canDeleteFinding;

  const menu = (f: Finding) => (
    <Menu
      iconOnly
      label={`Actions for ${truncate(f.title, 60).text}`}
      items={[
        { key: 'issue', label: 'Create issue / CAPA', icon: ClipboardCheck, hidden: !canEditFinding || !!f.linked_issue_id, onSelect: () => { void actions.askIssue(f); } },
        { key: 'link', label: 'Link a risk…', icon: Link2, hidden: !canEditFinding || !!f.linked_risk_id, onSelect: () => actions.startLinkRisk(f) },
        { key: 'newrisk', label: 'Create a new risk', icon: Plus, hidden: !canEditFinding || !!f.linked_risk_id, onSelect: () => { void actions.askNewRisk(f); } },
        { key: 'delete', label: 'Delete', icon: Trash2, danger: true, hidden: !canDeleteFinding, onSelect: () => { void actions.askDelete(f); } },
      ]}
    />
  );

  const columns: RegisterColumn<Finding>[] = [
    { key: 'title', header: 'Finding', isRowHeader: true, sortable: true, cell: (f) => <FindingCell f={f} /> },
    { key: 'severity', header: 'Severity', width: 'w-[108px]', sortable: true, card: 'meta', cell: (f) => <Pill registry={severity} word={f.severity} /> },
    { key: 'status', header: 'Remediation', width: 'w-[200px]', sortable: true, card: 'meta', cell: (f) => <Remediation f={f} /> },
    { key: 'owner', header: 'Owner', width: 'w-[150px]', priority: 2, card: 'meta', cell: (f) => <div className="max-w-[138px]"><OwnerCell name={f.owner_name} withName /></div> },
    { key: 'due', header: 'Due', width: 'w-[140px]', priority: 2, card: 'meta', cell: (f) => <DayCell value={f.due_date} now={now} late={f.is_open} empty="No date" /> },
    { key: 'risk', header: 'Risk', width: 'w-[170px]', priority: 3, card: 'meta', cell: (f) => <RiskCell f={f} /> },
    ...(hasActions ? [{ key: 'actions', header: 'Actions', width: 'w-[64px]', align: 'right' as const, cell: menu }] : []),
  ];

  return (
    <SectionCard
      id="findings" title="Findings" meta={plural(findings.length, 'finding')}
      info="What the drill showed up. A finding's status is read live from the issue it was handed to, so it cannot be closed here. All findings of all drills are on the Findings tab of Business Continuity."
      actions={canAdd ? <Button ref={addButton} size="sm" leftIcon={<Plus aria-hidden />} aria-expanded={showAdd} onClick={() => setShowAdd((v) => !v)}>Add finding</Button> : undefined}
    >
      {showAdd && (
        <div className="mb-[12px] flex flex-col gap-[12px] rounded-ds-card border border-ds-border bg-ds-surface-subtle p-[12px]">
          <FormProblem message={problem} />
          <FormField label="Title" required error={showErrors ? errors.title : undefined}>
            <TextInput value={form.title} maxLength={NAME_MAX} placeholder="Finding title" onChange={(e) => setForm({ ...form, title: e.target.value })} />
          </FormField>
          <FormField label="Description" optional>
            <Textarea rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </FormField>
          <div className="grid gap-[12px] sm:grid-cols-3">
            <FormField label="Severity" hint={findingHint(threshold.data)}>
              <Select value={form.severity} onChange={(e) => setForm({ ...form, severity: e.target.value })}>
                {optionsOf(severity).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </Select>
            </FormField>
            <FormField label="Owner" optional info="The person who fixes it. With none, it falls to the owner of the drill.">
              <EntityCombobox kind="users" label="Owner" placeholder="Assign owner…" clearable value={form.owner_id} onChange={(id) => setForm({ ...form, owner_id: id })} />
            </FormField>
            <FormField label="Due" optional info="The day it should be fixed by.">
              <TextInput type="date" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} />
            </FormField>
          </div>
          <div className="flex justify-end gap-[8px]">
            <Button size="sm" onClick={() => { setShowAdd(false); setProblem(null); setShowErrors(false); }}>Cancel</Button>
            <Button size="sm" variant="primary" loading={add.isPending} onClick={submit}>Raise finding</Button>
          </div>
        </div>
      )}

      <RegisterTable
        caption="Findings of this drill"
        columns={columns}
        rows={rows}
        getRowId={(f) => f.id}
        sort={sort}
        onSortChange={(next) => { setSort(next); setPage(1); }}
        empty={<EmptyState bare kind="firstUse" title="No findings raised for this drill" />}
        cardTitle={(f) => <FindingCell f={f} />}
        cardActions={hasActions ? menu : undefined}
        footer={findings.length > 0 ? <Pager page={range.page} pageSize={size} total={findings.length} noun={NOUN} pageSizes={SIZES} onPage={setPage} onPageSize={(n) => { setSize(n); setPage(1); }} /> : undefined}
      />
      {actions.ui}
    </SectionCard>
  );
}
