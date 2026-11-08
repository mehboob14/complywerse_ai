'use client';

/**
 * The details of one statement over the register's list (the Facet explorer's drawer): the kit's SidePanel. The head names the statement and its document; the body holds its words and
 * facts, the assessment (status, findings, remediation notes, next assessment date), who it is assigned to, the evidence linked to it (and a picker to add more) and the controls it is
 * auto-mapped to. Each save is said when the server has answered; a failure stays on the screen with Retry. Previous / next walk the list as it is shown.
 * Who may change what is the server's rule: a statement that is assigned can be assessed, linked and reassigned by its assignee or an administrator, and the document's editors may as
 * well; the screen knows the first part (statementModel.mayAssess) and says the server's words when the second refuses.
 */
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight, ChevronDown, ChevronUp, Lock, Save } from 'lucide-react';
import EvidencePreviewButton from '@/components/evidence/EvidencePreviewButton';
import {
  Button, ErrorState, Fact, FactList, FormField, IconButton, MultiSelect, Notice, Select, SidePanel, SkeletonLines, StatusPill, Combobox, Textarea, TextInput, useReportedMutation,
  type ListOption,
} from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { complianceApi } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { statusPill } from '@/lib/status';
import { statementCompliance, statementPriority } from '@/lib/statuses/complianceStatements';
import StatementLinkagePanel from '../_StatementLinkagePanel';
import { STATEMENT_REFRESH, useEvidenceBriefs, useStatementDetail, useTenantUsers, type StatementDetail } from './statementData';
import { NONE, categoryKey, categoryLabel, dayOf, documentName, evidenceToAdd, mayAssess, priorityKey, statementTitle, type StatementRow } from './statementModel';

const FOCUS = 'focus-visible:outline-none focus-visible:shadow-ds-ring';

export interface StatementDrawerProps {
  row: StatementRow | null;
  onClose: () => void;
  onStep: (dir: -1 | 1) => void;
  hasPrev: boolean;
  hasNext: boolean;
  me: number | null;
  isAdmin: boolean;
  /** `compliance:statements:edit` (the old drawer's gate for the Assign button) */
  canEdit: boolean;
}

/** The row the details were opened from, found again when focus has to go back to it. */
const rowOf = (id: number | null) => (): HTMLElement | null => {
  if (id == null || typeof document === 'undefined') return null;
  const rows = Array.from(document.querySelectorAll<HTMLElement>(`[data-record-row="${id}"]`));
  const row = rows.find((r) => r.getClientRects().length > 0) ?? null;
  return row?.querySelector<HTMLElement>('a[href], button') ?? row;
};

export function StatementDrawer({ row, onClose, onStep, hasPrev, hasNext, me, isAdmin, canEdit }: StatementDrawerProps) {
  const id = row?.id ?? null;
  const detail = useStatementDetail(id);
  const [dirty, setDirty] = useState(false);
  return (
    <SidePanel
      open={!!row}
      onClose={onClose}
      title={<span dir="auto" className="line-clamp-3 break-words" title={row ? statementTitle(row) : undefined}>{row ? `${row.statement_code ? `${row.statement_code} · ` : ''}${statementTitle(row)}` : ''}</span>}
      subtitle={row ? documentName(row) : undefined}
      dockFrom={Infinity}
      width="md"
      dirty={dirty}
      padded={false}
      restoreFocus={rowOf(id)}
      actions={row && (
        <>
          <IconButton label={dirty ? 'Previous statement (save your changes first)' : 'Previous statement'} aria-disabled={!hasPrev || dirty || undefined} onClick={() => { if (hasPrev && !dirty) onStep(-1); }}><ChevronUp aria-hidden /></IconButton>
          <IconButton label={dirty ? 'Next statement (save your changes first)' : 'Next statement'} aria-disabled={!hasNext || dirty || undefined} onClick={() => { if (hasNext && !dirty) onStep(1); }}><ChevronDown aria-hidden /></IconButton>
        </>
      )}
    >
      {row && detail.isPending && <div aria-busy="true" className="p-[16px]"><SkeletonLines lines={8} /></div>}
      {row && detail.isError && !detail.data && (
        <ErrorState compact title="Couldn't load this statement" message={errorMessage(detail.error)} onRetry={canRetry(detail.error) ? () => { void detail.refetch(); } : undefined} />
      )}
      {row && detail.data && (
        <Body key={row.id} row={row} detail={detail.data} me={me} isAdmin={isAdmin} canEdit={canEdit} onDirty={setDirty} onClose={onClose} />
      )}
    </SidePanel>
  );
}

interface FormState { status: string; findings: string; remediation: string; next: string; picked: string[] }

function Body({ row, detail, me, isAdmin, canEdit, onDirty, onClose }: { row: StatementRow; detail: StatementDetail; me: number | null; isAdmin: boolean; canEdit: boolean; onDirty: (dirty: boolean) => void; onClose: () => void }) {
  const initial: FormState = useMemo(() => ({
    status: detail.compliance?.compliance_status || 'not_assessed', findings: detail.compliance?.findings ?? '', remediation: detail.compliance?.remediation_notes ?? '', next: dayOf(detail.compliance?.next_assessment_date), picked: [],
  }), [detail]);
  const [form, setForm] = useState<FormState>(initial);
  const [base, setBase] = useState<FormState>(initial);
  const [assignTo, setAssignTo] = useState<string | null>(detail.assigned_to_user_id == null ? null : String(detail.assigned_to_user_id));
  useEffect(() => () => onDirty(false), [onDirty]);       // stepping to another statement, or closing: nothing is left to lose
  const change = (patch: Partial<FormState>) => {
    const next = { ...form, ...patch };
    setForm(next);
    onDirty(JSON.stringify(next) !== JSON.stringify(base));
  };

  const users = useTenantUsers(true);
  const evidence = useEvidenceBriefs(true);
  const linked = detail.compliance?.evidence_ids ?? [];
  const allowed = mayAssess(detail.assigned_to_user_id, me, isAdmin);
  const locked = !allowed;
  const toAdd = evidenceToAdd(form.picked.map(Number), linked);
  const changed = JSON.stringify({ ...form, picked: [] }) !== JSON.stringify({ ...base, picked: [] }) || toAdd.length > 0;

  const userOptions: ListOption[] = (users.data ?? []).map((u) => ({ value: String(u.id), label: u.display_name || u.username || u.email || 'A user', description: u.email }));
  const evidenceOptions: ListOption[] = (evidence.data ?? []).filter((e) => !linked.includes(e.id)).map((e) => ({ value: String(e.id), label: (e.name ?? '').trim() || 'Untitled evidence', description: e.evidence_type ?? undefined }));

  const save = useReportedMutation({
    mutationFn: async (v: { status: string; findings: string; remediation: string; next: string; add: number[] }) => {
      const data: Parameters<typeof complianceApi.statements.updateCompliance>[1] = { compliance_status: v.status };
      if (v.findings) data.findings = v.findings;
      if (v.remediation) data.remediation_notes = v.remediation;
      if (v.next) data.next_assessment_date = v.next;
      await complianceApi.statements.updateCompliance(row.id, data);
      if (v.add.length > 0) await complianceApi.statements.linkEvidence(row.id, v.add);
    },
    success: 'Statement saved',
    failure: "Couldn't save the statement",
    toast: 'always',
    invalidate: STATEMENT_REFRESH,
    onSuccess: () => { const saved = { ...form, picked: [] }; setBase(saved); setForm(saved); onDirty(false); },
  });

  const assign = useReportedMutation({
    mutationFn: (userId: number | null) => complianceApi.statements.assign(row.id, userId),
    success: (_, userId) => (userId == null ? 'Assignment removed' : `Assigned to ${userOptions.find((o) => o.value === String(userId))?.label ?? 'the person you chose'}`),
    failure: "Couldn't change who this is assigned to",
    invalidate: STATEMENT_REFRESH,
  });

  const priority = priorityKey(row);
  return (
    <div className="flex flex-col gap-[20px] p-[16px]">
      <section aria-label="The statement">
        <p dir="auto" className="m-0 whitespace-pre-wrap text-ds-body text-ds-fg [overflow-wrap:anywhere]">{(detail.statement_text ?? '').trim() || statementTitle(row)}</p>
        {detail.statement_summary && detail.statement_text && <p className="m-0 mt-[6px] text-ds-label text-ds-fg-muted">{`Summary: ${detail.statement_summary}`}</p>}
      </section>

      <FactList min={140}>
        <Fact label="Document">
          <Link href={`/governance/documents/${detail.document_id}`} className={`inline-flex items-center gap-[4px] rounded-ds-control text-ds-primary-text hover:underline ${FOCUS}`}>
            {documentName(row)}<ArrowUpRight aria-hidden className="h-[14px] w-[14px]" />
          </Link>
        </Fact>
        <Fact label="Category">{categoryKey(row) === NONE ? null : categoryLabel(categoryKey(row))}</Fact>
        <Fact label="Priority">{priority === NONE ? null : <StatusPill size="sm" {...statusPill(statementPriority, priority)} />}</Fact>
        <Fact label="Mandatory">{detail.is_mandatory ? 'Yes' : 'No'}</Fact>
        <Fact label="Source section">{detail.source_section}</Fact>
        <Fact label="Last assessed">{detail.compliance?.assessment_date ? `${formatDate(detail.compliance.assessment_date)}${detail.compliance.assessor_name ? ` by ${detail.compliance.assessor_name}` : ''}` : null}</Fact>
      </FactList>

      <section aria-label="Assessment">
        <h3 className="m-0 mb-[8px] !text-ds-body !font-[600] !text-ds-fg">Assessment</h3>
        {locked && (
          <Notice tone="warning" icon={Lock} title="Assigned to someone else" className="mb-[12px]">
            {`This statement is assigned to ${detail.assignee_name || 'another person'}. Only the assignee or an administrator can update its assessment or evidence.`}
          </Notice>
        )}
        <div className="flex flex-col gap-[12px]">
          <FormField label="Compliance status">
            <Select value={form.status} onChange={(e) => change({ status: e.target.value })} disabled={locked}>
              {statementCompliance.words.map((w) => <option key={w} value={w}>{statementCompliance.label(w)}</option>)}
            </Select>
          </FormField>
          <FormField label="Findings">
            <Textarea rows={4} value={form.findings} onChange={(e) => change({ findings: e.target.value })} disabled={locked} placeholder="What you found" />
          </FormField>
          <FormField label="Remediation notes">
            <Textarea rows={3} value={form.remediation} onChange={(e) => change({ remediation: e.target.value })} disabled={locked} placeholder="What will be done about it" />
          </FormField>
          <FormField label="Next assessment" optional>
            <TextInput type="date" value={form.next} onChange={(e) => change({ next: e.target.value })} disabled={locked} />
          </FormField>
        </div>
      </section>

      <section aria-label="Evidence">
        <h3 className="m-0 mb-[8px] !text-ds-body !font-[600] !text-ds-fg">Evidence</h3>
        {detail.evidence.length === 0 ? <p className="m-0 mb-[8px] text-ds-body text-ds-fg-muted">No evidence is linked yet.</p> : (
          <ul className="m-0 mb-[12px] flex list-none flex-col gap-[4px] p-0">
            {detail.evidence.map((ev) => (
              <li key={ev.id} className="flex min-h-ds-control items-center gap-[8px] rounded-ds-control border border-ds-border px-[8px]">
                <Link href={`/evidence/${ev.id}`} title="Open the evidence" className={`min-w-0 flex-1 truncate rounded-ds-control text-ds-body text-ds-fg hover:text-ds-primary-text hover:underline ${FOCUS}`}>
                  {ev.name}{ev.file_name ? <span className="ml-[6px] text-ds-label text-ds-fg-muted">{ev.file_name}</span> : null}
                </Link>
                <EvidencePreviewButton evidenceId={ev.id} label="Preview" className="inline-flex min-h-ds-control shrink-0 items-center rounded-ds-control px-[8px] text-ds-label font-[500] text-ds-primary-text hover:bg-ds-surface-hover" />
              </li>
            ))}
          </ul>
        )}
        {evidence.isError && !evidence.data ? (
          <ErrorState compact title="Couldn't load the evidence to choose from" message={errorMessage(evidence.error)} onRetry={canRetry(evidence.error) ? () => { void evidence.refetch(); } : undefined} />
        ) : (
          <FormField label="Add evidence" hint="Evidence can be added here; to take a link off, open the evidence.">
            <MultiSelect label="Add evidence" options={evidenceOptions} value={form.picked} onChange={(picked) => change({ picked })} placeholder={evidence.isPending ? 'Loading the evidence' : 'Choose evidence to link'} disabled={locked || evidence.isPending} searchPlaceholder="Search evidence" />
          </FormField>
        )}
      </section>

      <section aria-label="Who it is assigned to">
        <h3 className="m-0 mb-[8px] !text-ds-body !font-[600] !text-ds-fg">Assigned to</h3>
        <div className="flex flex-wrap items-end gap-[8px]">
          <div className="min-w-[200px] flex-1">
            <Combobox label="Assigned to" options={userOptions} value={assignTo} onChange={setAssignTo} placeholder={users.isPending ? 'Loading people' : 'Unassigned'} clearable disabled={users.isPending || (!canEdit && !isAdmin) || locked} searchPlaceholder="Search people" />
          </div>
          <Button
            loading={assign.isPending}
            disabled={(assignTo ?? null) === (detail.assigned_to_user_id == null ? null : String(detail.assigned_to_user_id)) || (!canEdit && !isAdmin) || locked}
            title={!canEdit && !isAdmin ? 'You do not have permission to assign statements' : locked ? 'Only the assignee or an administrator can change this' : undefined}
            onClick={() => assign.mutate(assignTo == null ? null : Number(assignTo))}
          >
            Assign
          </Button>
        </div>
        {users.isError && !users.data && <p className="m-0 mt-[6px] text-ds-label text-ds-danger">{`The list of people could not be loaded. ${errorMessage(users.error)}`}</p>}
        {detail.assignee_name && <p className="m-0 mt-[6px] text-ds-label text-ds-fg-muted">{`Currently assigned to ${detail.assignee_name}${detail.assignee_email ? ` (${detail.assignee_email})` : ''}.`}</p>}
      </section>

      <StatementLinkagePanel statementId={row.id} />

      <div className="sticky bottom-0 -mx-[16px] -mb-[16px] flex flex-wrap items-center gap-[8px] border-t border-ds-border bg-ds-surface px-[16px] py-[10px]">
        <Button variant="primary" leftIcon={<Save aria-hidden />} loading={save.isPending} disabled={locked || !changed} title={locked ? 'Only the assignee or an administrator can update this statement' : undefined}
          onClick={() => save.mutate({ status: form.status, findings: form.findings.trim(), remediation: form.remediation.trim(), next: form.next, add: toAdd })}>
          Save changes
        </Button>
        <Button onClick={onClose}>Close</Button>
        {changed && !locked && <span role="status" className="text-ds-label text-ds-fg-muted">Not saved yet</span>}
      </div>
    </div>
  );
}
