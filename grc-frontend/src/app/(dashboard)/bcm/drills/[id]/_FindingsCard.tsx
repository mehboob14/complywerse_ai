'use client';

// The findings of a drill: what it showed up. A finding's remediation is DERIVED from the Issue/CAPA handed to Issues (it cannot be closed here), so each row says where it stands and
// links to the issue and the risk it is tied to. Raising one is the form above the table (at or above the tenant's issue threshold it opens an issue by itself). What a person may do is what the
// page has always asked for: `bcm:findings:create` to raise, `bcm:findings:edit` to create the issue or link a risk, `bcm:findings:delete` to delete; the row menu holds those and shows only what the
// person may do. Choosing a risk is a step of its own ("Link risk") because it cannot be undone from here; creating an issue or a risk in another module and deleting ask first. Every request says what
// happened only after the server answered, in the server's words. A list of 40 findings is a paged table (cards below 768px).
import { useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { ClipboardCheck, ExternalLink, Link2, Plus, Trash2 } from 'lucide-react';
import { bcmApi } from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';
import { truncate } from '@/lib/format';
import { findingStatus, optionsOf, severity } from '@/lib/statuses/bcm';
import { AnimatedModal } from '@/components/ui';
import {
  Button, EmptyState, FormField, Menu, Pager, RegisterTable, SectionCard, Select, Textarea, TextInput, useConfirm, useReportedMutation, type RegisterColumn, type SortState,
} from '@/components/ui/ds';
import { errorMessage } from '@/components/ui/ds/reportOutcome';
import { ClampedText, EntityCombobox, FormProblem, Pill, TEXT_LINK } from '../../_bcm-ui';
import {
  FINDING_HINT, NAME_MAX, blankFindingForm, findingDeleteWords, findingErrors, findingPayload, findingSortValue, ordered, pageOf, plural, type Drill, type Finding, type FindingForm,
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
        <Link href="/issues" title="Open in Issues / CAPA" className={`inline-flex items-center gap-[4px] text-ds-label ${TEXT_LINK}`}>{f.issue_code}<ExternalLink aria-hidden size={12} /></Link>
      )}
    </span>
  );
}

function RiskCell({ f }: { f: Finding }) {
  if (!f.linked_risk_id) return <span className={MUTED}>Not linked</span>;
  return <Link href={`/erm/risks/${f.linked_risk_id}`} title={f.linked_risk_title || undefined} className={`block ${TEXT_LINK}`}><span className="line-clamp-2 break-words">{f.linked_risk_title || `Risk #${f.linked_risk_id}`}</span></Link>;
}

/** Choosing the risk and saying so are two steps: a finding cannot be unlinked from a risk here. */
function LinkRiskDialog({ finding, pending, onClose, onLink }: { finding: Finding; pending: boolean; onClose: () => void; onLink: (riskId: number) => void }) {
  const [risk, setRisk] = useState<number | null>(null);
  return (
    <AnimatedModal
      isOpen onClose={onClose} dirty={risk !== null} title="Link a risk" subtitle={truncate(finding.title, 80).text} size="md"
      footer={(
        <div className="flex justify-end gap-[8px]">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={risk === null} loading={pending} onClick={() => { if (risk !== null) onLink(risk); }}>Link risk</Button>
        </div>
      )}
    >
      <div className="px-[20px] py-[16px]">
        <FormField label="Risk" required hint="Links this finding to a risk that is already in the register. It cannot be unlinked from here.">
          <EntityCombobox kind="risks" label="Risk" placeholder="Choose a risk…" value={risk} onChange={setRisk} />
        </FormField>
      </div>
    </AnimatedModal>
  );
}

export function FindingsCard({ drill, canAdd }: { drill: Drill; canAdd: boolean }) {
  const { hasPermission } = usePermissions();
  const canEditFinding = hasPermission('bcm:findings:edit');
  const canDeleteFinding = hasPermission('bcm:findings:delete');
  const { confirm, confirmDialog } = useConfirm();
  const refresh = [['bcm-drill', drill.id]];
  const findings = useMemo(() => drill.findings ?? [], [drill.findings]);

  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState<FindingForm>(blankFindingForm);
  const [showErrors, setShowErrors] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [linking, setLinking] = useState<Finding | null>(null);
  const [sort, setSort] = useState<SortState>(null);
  const [page, setPage] = useState(1);
  const [size, setSize] = useState<number>(25);
  const addButton = useRef<HTMLButtonElement | HTMLAnchorElement>(null);
  const errors = findingErrors(form);

  const add = useReportedMutation({
    mutationFn: async (payload: ReturnType<typeof findingPayload>) => (await bcmApi.findings.create(drill.id, payload)).data as Finding,
    success: (f) => ({ title: 'Finding raised', message: f?.issue_code ? `Auto-opened issue ${f.issue_code} for remediation.` : undefined }),
    failure: "Couldn't raise the finding", retryable: false, toast: 'success', invalidate: refresh,
    onSuccess: () => { setShowAdd(false); setForm(blankFindingForm()); setProblem(null); setShowErrors(false); },
    onError: (error) => setProblem(errorMessage(error)),
  });
  const remove = useReportedMutation({
    mutationFn: async (f: Finding) => (await bcmApi.findings.remove(f.id)).data,
    success: 'Finding deleted', failure: "Couldn't delete the finding", invalidate: refresh,
    onSuccess: () => addButton.current?.focus(),                       // the row the person was on is gone, and focus with it
  });
  const makeIssue = useReportedMutation({
    mutationFn: async (f: Finding) => (await bcmApi.findings.createIssue(f.id)).data as Finding,
    success: (f) => ({ title: 'Issue created', message: f?.issue_code ? `Linked to ${f.issue_code}.` : undefined }),
    failure: "Couldn't create the issue", retryable: false, invalidate: refresh,
  });
  const linkRisk = useReportedMutation({
    mutationFn: async ({ id, riskId }: { id: number; riskId: number | undefined }) => (await bcmApi.findings.linkRisk(id, { risk_id: riskId })).data,
    success: 'Risk linked', failure: "Couldn't link the risk", retryable: false, invalidate: refresh,
  });

  const askDelete = async (f: Finding) => { if (await confirm({ ...findingDeleteWords(f.title), tone: 'danger' })) remove.mutate(f); };
  const askIssue = async (f: Finding) => {
    const yes = await confirm({
      title: 'Create an issue for this finding?', confirmLabel: 'Create issue',
      message: 'The finding is handed to Issues / CAPA for remediation, and its status is then read from the issue. It cannot be unlinked from here.',
    });
    if (yes) makeIssue.mutate(f);
  };
  const askNewRisk = async (f: Finding) => {
    const yes = await confirm({
      title: 'Create a new risk from this finding?', confirmLabel: 'Create risk',
      message: 'A new risk is added to the Risk Register and linked to this finding. It cannot be unlinked from here.',
    });
    if (yes) linkRisk.mutate({ id: f.id, riskId: undefined });
  };

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
        { key: 'issue', label: 'Create issue / CAPA', icon: ClipboardCheck, hidden: !canEditFinding || !!f.linked_issue_id, onSelect: () => { void askIssue(f); } },
        { key: 'link', label: 'Link a risk…', icon: Link2, hidden: !canEditFinding || !!f.linked_risk_id, onSelect: () => setLinking(f) },
        { key: 'newrisk', label: 'Create a new risk', icon: Plus, hidden: !canEditFinding || !!f.linked_risk_id, onSelect: () => { void askNewRisk(f); } },
        { key: 'delete', label: 'Delete', icon: Trash2, danger: true, hidden: !canDeleteFinding, onSelect: () => { void askDelete(f); } },
      ]}
    />
  );

  const columns: RegisterColumn<Finding>[] = [
    { key: 'title', header: 'Finding', isRowHeader: true, sortable: true, cell: (f) => <FindingCell f={f} /> },
    { key: 'severity', header: 'Severity', width: 'w-[108px]', sortable: true, card: 'meta', cell: (f) => <Pill registry={severity} word={f.severity} /> },
    { key: 'status', header: 'Remediation', width: 'w-[200px]', sortable: true, card: 'meta', cell: (f) => <Remediation f={f} /> },
    { key: 'risk', header: 'Risk', width: 'w-[184px]', priority: 2, card: 'meta', cell: (f) => <RiskCell f={f} /> },
    ...(hasActions ? [{ key: 'actions', header: 'Actions', width: 'w-[64px]', align: 'right' as const, cell: menu }] : []),
  ];

  return (
    <SectionCard
      id="findings" title="Findings" meta={plural(findings.length, 'finding')}
      info="What the drill showed up. A finding's status is read live from the issue it was handed to, so it cannot be closed here."
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
          <FormField label="Severity" hint={FINDING_HINT}>
            <Select value={form.severity} className="sm:w-[200px]" onChange={(e) => setForm({ ...form, severity: e.target.value })}>
              {optionsOf(severity).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </Select>
          </FormField>
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

      {linking && (
        <LinkRiskDialog
          finding={linking} pending={linkRisk.isPending} onClose={() => setLinking(null)}
          onLink={(riskId) => linkRisk.mutate({ id: linking.id, riskId }, { onSuccess: () => setLinking(null) })}
        />
      )}
      {confirmDialog}
    </SectionCard>
  );
}
