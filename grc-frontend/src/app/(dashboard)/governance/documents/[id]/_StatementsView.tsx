'use client';

/**
 * A document's policy statements: parse the document into statements (in the background), read them by category, add, edit
 * and delete them, see each one's history (compare, roll back), review a re-parse's proposals, export them, and turn one into
 * a control. Used by the AI Studio's Statements view and the classic page. Readers read; the changes are for the document's
 * editors (`canEdit`; the server checks them too).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle, Check, ChevronDown, ChevronUp, ClipboardList, Download, GitCompare, History, Pencil, Plus, RotateCcw,
  Save, ShieldCheck, Trash2, User, Wand2, X,
} from 'lucide-react';
import { governanceApi } from '@/lib/api';
import { AnimatedModal } from '@/components/ui/AnimatedModal';
import { InfoTip } from '@/components/ui/InfoTip';
import {
  Button, Checkbox, EmptyState, ErrorState, FormField, IconButton, Select, SkeletonLines, Textarea, TextInput, useNotify, useReportedMutation,
} from '@/components/ui/ds';
import { errorMessage } from '@/components/ui/ds/reportOutcome';
import CreateControlDialog from '@/components/soc2/CreateControlDialog';
import { fieldRows, goesToLine, pendingFor, proposedOf, proposedStatements, sendLabel, type Proposal } from '@/lib/proposals';
import { dateTime } from '../_view/docDates';
import DocumentSyncPanel from './_DocumentSyncPanel';
import { ProposalActions, proposedWords, useProposalRole, useRefreshAfterProposal } from './_ProposalsView';

const CATEGORY_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  security: { bg: 'bg-primary-100', text: 'text-slate-700', border: 'border-primary-300' },
  privacy: { bg: 'bg-slate-100', text: 'text-slate-700', border: 'border-primary-300' },
  governance: { bg: 'bg-emerald-100', text: 'text-slate-700', border: 'border-emerald-300' },
  compliance: { bg: 'bg-slate-100', text: 'text-slate-700', border: 'border-slate-200' },
  operational: { bg: 'bg-orange-100', text: 'text-slate-700', border: 'border-orange-300' },
  risk_management: { bg: 'bg-amber-100', text: 'text-slate-700', border: 'border-amber-300' },
  hr: { bg: 'bg-slate-100', text: 'text-slate-700', border: 'border-slate-300' },
  it: { bg: 'bg-slate-100', text: 'text-slate-700', border: 'border-slate-200' },
  financial: { bg: 'bg-yellow-100', text: 'text-slate-700', border: 'border-yellow-300' },
  legal: { bg: 'bg-slate-100', text: 'text-slate-700', border: 'border-slate-300' },
  environmental: { bg: 'bg-teal-100', text: 'text-slate-700', border: 'border-teal-300' },
  quality: { bg: 'bg-rose-100', text: 'text-slate-700', border: 'border-rose-300' },
};
const OTHER_COLORS = { bg: 'bg-slate-100', text: 'text-slate-700', border: 'border-slate-300' };

const CATEGORY_ABBREVIATIONS: Record<string, string> = { hr: 'HR', it: 'IT' };
function formatCategory(cat: string): string {
  if (CATEGORY_ABBREVIATIONS[cat]) return CATEGORY_ABBREVIATIONS[cat];
  return cat.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

const PRIORITY_STYLE: Record<string, string> = {
  critical: 'bg-rose-50 text-rose-800', high: 'bg-orange-50 text-orange-800', medium: 'bg-amber-50 text-amber-900', low: 'bg-emerald-50 text-emerald-800',
};

// the AI's one-line summary (statement_summary) is not edited here: it stays as it is and is shown under the statement; why the
// statement changes is asked instead (change_reason, kept in its history and the Change log, and read by the owner of a proposal)
type StatementForm = { statement_text: string; category: string; priority: string; is_mandatory: boolean; source_section: string; change_reason: string };
const EMPTY_FORM: StatementForm = { statement_text: '', category: 'security', priority: 'medium', is_mandatory: true, source_section: '', change_reason: '' };
/** What is sent: the fields, the justification as `change_reason`, and the same words as the message of a proposal (lib/proposals.ts). */
const payload = (f: StatementForm) => ({ ...f, change_reason: f.change_reason.trim(), message: f.change_reason.trim() });
const ready = (f: StatementForm) => !!f.statement_text.trim() && !!f.change_reason.trim();
const formOf = (s: { statement_text?: string | null; category?: string | null; priority?: string | null; is_mandatory?: boolean | null; source_section?: string | null }): StatementForm => ({
  statement_text: s.statement_text || '', category: s.category || 'security', priority: s.priority || 'medium', is_mandatory: s.is_mandatory ?? true,
  source_section: s.source_section || '', change_reason: '',
});

/** The fields of a statement, for adding one or editing one, and why it changes (required). `proposeTo`: the person is not the
 *  document's owner or author, so the change goes to them first. */
function StatementFields({ form, setForm, autoFocus, idPrefix, proposeTo }: {
  form: StatementForm; setForm: (f: (prev: StatementForm) => StatementForm) => void; autoFocus?: boolean; idPrefix: string; proposeTo?: string | null;
}) {
  return (
    <div className="space-y-3">
      <FormField label="Statement">
        <Textarea value={form.statement_text} rows={3} autoFocus={autoFocus} placeholder="What the document requires…"
          onChange={(e) => setForm((p) => ({ ...p, statement_text: e.target.value }))} />
      </FormField>
      <FormField id={`${idPrefix}-why`} required hint={proposeTo ? goesToLine(proposeTo) : undefined}
        label={<>Justification for this change <span className="font-normal text-ds-fg-muted">({proposeTo ? `${proposeTo} reads it` : 'recorded with the change'})</span></>}>
        <Textarea value={form.change_reason} rows={2} maxLength={2000} placeholder="e.g. The new password standard asks for 12 characters"
          onChange={(e) => setForm((p) => ({ ...p, change_reason: e.target.value }))} />
      </FormField>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <FormField label="Category">
          <Select value={form.category} onChange={(e) => setForm((p) => ({ ...p, category: e.target.value }))}>
            {Object.keys(CATEGORY_COLORS).map((c) => <option key={c} value={c}>{formatCategory(c)}</option>)}
          </Select>
        </FormField>
        <FormField label="Priority">
          <Select value={form.priority} onChange={(e) => setForm((p) => ({ ...p, priority: e.target.value }))}>
            <option value="critical">Critical</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </Select>
        </FormField>
        <FormField label="Section">
          <TextInput type="text" value={form.source_section} placeholder="e.g. 4.1" onChange={(e) => setForm((p) => ({ ...p, source_section: e.target.value }))} />
        </FormField>
        <div className="flex items-end">
          <Checkbox checked={form.is_mandatory} label="Mandatory" onChange={(e) => setForm((p) => ({ ...p, is_mandatory: e.target.checked }))} />
        </div>
      </div>
    </div>
  );
}

/** A statement is a commitment; a control is how it is kept. This turns one into the other without leaving the document: the new
 *  control is authored in Common controls and linked back to this statement and this document. */
function StatementControlButton({ stmt, documentId, documentTitle, onCreated, canCreate }: {
  stmt: any; documentId: number; documentTitle?: string; onCreated?: () => void; canCreate: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [created, setCreated] = useState<string | null>(null);
  const text: string = stmt.statement_text || stmt.text || '';
  const name = (stmt.statement_summary || text).replace(/\s+/g, ' ').trim().slice(0, 120);
  const links = [
    {
      type: 'policy_statement', type_label: 'Policy statement', id: stmt.id,
      label: (stmt.statement_summary || text).slice(0, 80) || `Statement ${stmt.id}`,
      code: stmt.statement_code || null, subtitle: stmt.category || null,
      url: `/governance/documents/${documentId}?tab=statements`,
    },
    {
      type: 'document', type_label: 'Document', id: documentId,
      label: documentTitle || `Document ${documentId}`, code: null,
      subtitle: null, url: `/governance/documents/${documentId}`,
    },
  ];
  // Controls already answering this statement (from the payload), plus any created here before the list refetches.
  const existing: { code: string; custom?: boolean }[] = Array.isArray(stmt.controls) ? stmt.controls : [];
  const codes = Array.from(new Set([...existing.map((c) => c.code), ...(created ? [created] : [])]));

  return (
    <>
      {codes.map((c) => (
        <Link key={c} href={`/automation/soc2-controls/${encodeURIComponent(c)}`} title="A control that implements this statement"
          className="inline-flex items-center gap-1 rounded border border-[#99d5cc] bg-[#effaf8] px-1.5 py-0.5 font-mono text-xs font-semibold text-[#0b4f46] hover:bg-[#dff3ef]">
          {c}
        </Link>
      ))}
      {canCreate && (
        <>
          <Button size="sm" leftIcon={<ShieldCheck aria-hidden />} title="Author a control that implements this statement" onClick={() => setOpen(true)}>
            {codes.length ? 'Add control' : 'Create control'}
          </Button>
          <CreateControlDialog
            open={open}
            onClose={() => setOpen(false)}
            title="Create a control for this statement"
            subtitle={[stmt.statement_code, documentTitle].filter(Boolean).join(' · ') || undefined}
            source={{
              kind: 'Policy statement', code: stmt.statement_code || null, text, parent: documentTitle || null,
              tags: [stmt.category, stmt.priority, stmt.is_mandatory ? 'mandatory' : ''].filter(Boolean),
            }}
            prefill={{ name, statement: text, priority: stmt.priority || 'medium', is_key_control: !!stmt.is_mandatory, regulatory_source: documentTitle || '' }}
            links={links}
            onCreated={(code) => { setCreated(code); onCreated?.(); }}
          />
        </>
      )}
    </>
  );
}

/** A statement change someone proposed, waiting for the owner: who, what it changes, why, and Accept / Reject for the owner (Withdraw for
 *  the proposer). */
function ProposedStatementBox({ documentId, p, decider }: { documentId: number; p: Proposal; decider: string }) {
  const rows = fieldRows(p.statement?.before, p.statement?.after).filter((r) => r.changed);
  const what = p.source === 'statement_add' ? 'New statement proposed' : p.source === 'statement_delete' ? 'Removal proposed' : 'Change proposed';
  return (
    <div className="mt-2 rounded-lg border border-amber-300 bg-amber-50 p-3" role="note" aria-label={`${what} by ${p.proposed_by?.name}`}>
      <p className="text-xs font-semibold text-amber-950">{what} by {p.proposed_by?.name} — waiting for {decider}</p>
      {rows.length > 0 && (
        <dl className="mt-1.5 space-y-1">
          {rows.map((r) => (
            <div key={r.key} className="text-xs">
              <dt className="font-semibold text-[#3f4b58]">{r.label}</dt>
              <dd className="break-words text-[#26323d]">
                {r.before === '—' ? <span className="font-medium">{r.after}</span>
                  : r.after === 'Removed' ? <><span className="line-through decoration-rose-400">{r.before}</span> (removed)</>
                  : <><span className="line-through decoration-rose-400">{r.before}</span> → <span className="font-medium">{r.after}</span></>}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {p.message && <p className="mt-1.5 break-words text-xs text-amber-950"><span className="font-semibold">Justification:</span> {p.message}</p>}
      <div className="mt-2"><ProposalActions documentId={documentId} p={p} small /></div>
    </div>
  );
}

function ParseProgress({ isParsing, parseStatus }: { isParsing: boolean; parseStatus: any }) {
  if (!(isParsing || parseStatus?.status === 'parsing' || parseStatus?.status === 'queued')) return null;
  const pct = typeof parseStatus?.progress_percent === 'number' ? parseStatus.progress_percent : null;
  return (
    <div className="rounded-lg border border-[#d5dbe1] bg-[#f7f9fa] px-3 py-2" role="status">
      <div className="mb-1 flex items-center justify-between gap-2 text-xs">
        <span className="truncate text-[#26323d]">{parseStatus?.status === 'queued' && !parseStatus?.automatic ? 'Waiting to start…' : parseStatus?.message || 'Reading the document into statements…'}</span>
        <span className="shrink-0 font-medium text-[#26323d]">{pct != null ? `${pct}%` : ''}</span>
      </div>
      <div className="h-1 w-full overflow-hidden rounded-full bg-[#e3e8ec]">
        {pct ? (
          <div className="h-full rounded-full bg-[#0f766e] transition-all" style={{ width: `${Math.min(100, Math.max(2, pct))}%` }} />
        ) : (
          <div className="h-full w-1/3 animate-[gap-progress_1.4s_ease-in-out_infinite] rounded-full bg-[#0f766e]" />
        )}
      </div>
    </div>
  );
}

export default function StatementsView({ documentId, documentTitle, canEdit, again = null, onAgainOpened }: {
  documentId: number; documentTitle?: string; canEdit: boolean;
  /** a statement change that was not accepted, sent again by its proposer: its form opens with what was proposed */
  again?: Proposal | null;
  onAgainOpened?: () => void;
}) {
  const queryClient = useQueryClient();
  const notify = useNotify();
  const refreshStatements = () => {
    queryClient.invalidateQueries({ queryKey: ['document-policy-statements', documentId] });
    queryClient.invalidateQueries({ queryKey: ['document-chain'] });             // the Change log records every statement change
  };

  const { data: statements, isLoading: statementsLoading, isError: statementsError, error: statementsErr, refetch: refetchStatements } = useQuery({
    queryKey: ['document-policy-statements', documentId],
    queryFn: async () => ((await governanceApi.getDocumentPolicyStatements(documentId)).data as any) || [],
    enabled: !!documentId,
  });

  // ── parsing runs in the background: polled until it is done ──
  const [isParsing, setIsParsing] = useState(false);
  const parsePollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopParsePolling = () => {
    if (parsePollingRef.current) {
      clearInterval(parsePollingRef.current);
      parsePollingRef.current = null;
    }
  };
  useEffect(() => () => stopParsePolling(), []);
  const startParsePolling = () => {
    stopParsePolling();
    setIsParsing(true);
    parsePollingRef.current = setInterval(async () => {
      try {
        const data = (await governanceApi.getParseStatus(documentId)).data as any;
        if (data.status === 'completed') {
          stopParsePolling();
          setIsParsing(false);
          notify.success(data.message || `${data.total_statements || 0} statements found in the document.`, { title: 'Statements ready' });
          refreshStatements();
        } else if (data.status === 'review_required') {
          stopParsePolling();
          setIsParsing(false);
          notify.info(data.message || 'Reading the document again proposes changes to the statements. Review them below.', { title: 'Changes to review' });
          refreshStatements();
          queryClient.invalidateQueries({ queryKey: ['reparse-proposals', documentId] });
        } else if (data.status === 'failed') {
          stopParsePolling();
          setIsParsing(false);
          notify.error(data.error || 'The document could not be read into statements.', { title: 'Not parsed' });
        }
      } catch {
        stopParsePolling();
        setIsParsing(false);
      }
    }, 3000);
  };
  // starting the read is a request to the server (a background job): said after it answered; no Retry, a second try could start a second read
  const parsePolicyMutation = useReportedMutation({
    mutationFn: () => governanceApi.parsePolicy(documentId),
    success: { title: 'Parsing started', message: 'The statements appear here when it is done; you can leave this page.' },
    failure: 'Not parsed',
    fallback: 'The document could not be read into statements.',
    retryable: false,
    onSuccess: () => { startParsePolling(); },
  });

  return (
    <>
      {canEdit && <DocumentSyncPanel documentId={documentId} />}
      <StatementsList statements={statements} statementsLoading={statementsLoading} statementsError={statementsError} statementsErrorText={errorMessage(statementsErr)}
        onRetryStatements={() => { void refetchStatements(); }} documentId={documentId}
        documentTitle={documentTitle} parsePolicyMutation={parsePolicyMutation} isParsing={isParsing} canEdit={canEdit} onChanged={refreshStatements}
        again={again} onAgainOpened={onAgainOpened} />
    </>
  );
}

function StatementsList({ statements, statementsLoading, statementsError, statementsErrorText, onRetryStatements, parsePolicyMutation, isParsing, documentId, documentTitle, canEdit, onChanged, again, onAgainOpened }: {
  statements: any; statementsLoading: boolean; statementsError: boolean; statementsErrorText: string; onRetryStatements: () => void; parsePolicyMutation: { mutate: () => void; isPending: boolean }; isParsing: boolean;
  documentId: number; documentTitle?: string; canEdit: boolean; onChanged: () => void; again: Proposal | null; onAgainOpened?: () => void;
}) {
  const queryClient = useQueryClient();
  const notify = useNotify();
  const stmts: any[] = Array.isArray(statements) ? statements : statements?.statements || [];
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [editingStmtId, setEditingStmtId] = useState<number | null>(null);
  const [editStmtForm, setEditStmtForm] = useState<StatementForm>(EMPTY_FORM);
  const [showAddForm, setShowAddForm] = useState(false);
  const [addForm, setAddForm] = useState<StatementForm>(EMPTY_FORM);
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);
  const [deleteWhy, setDeleteWhy] = useState('');
  const [versionHistoryStmtId, setVersionHistoryStmtId] = useState<number | null>(null);
  const [compareVersions, setCompareVersions] = useState<{ a: number; b: number } | null>(null);
  // a roll back by someone who is not the owner or author asks why first (it goes to the owner)
  const [rollingBack, setRollingBack] = useState<{ versionId: number; why: string } | null>(null);
  const parsing = parsePolicyMutation.isPending || isParsing;
  // changes by others than the owner or author wait for the owner's decision (lib/proposals.ts)
  const { proposes, decider, list: changeProposals } = useProposalRole(documentId);
  const proposeTo = proposes ? decider : null;
  const refreshAfterProposal = useRefreshAfterProposal();

  // the four writers below may become a PROPOSAL (the person is not the owner or author): the server's own sentence then says so and nothing changes in the list
  // yet; otherwise the confirmation is the usual one. Said after the server answered, with the server's words on a refusal; no Retry on a write that makes a record
  const addMutation = useReportedMutation({
    mutationFn: (data: StatementForm) => governanceApi.addStatement(documentId, payload(data)),
    success: (res) => proposedWords(res?.data, decider) ?? 'Statement added',
    failure: 'Not added',
    fallback: 'The statement could not be added.',
    retryable: false,
    onSuccess: (res) => {
      setShowAddForm(false);
      setAddForm(EMPTY_FORM);
      if (proposedOf(res?.data)) { refreshAfterProposal(); return; }       // waits for the owner: not in the list yet
      onChanged();
    },
  });
  const updateMutation = useReportedMutation({
    // statement_summary is not sent: the AI's summary stays as it is
    mutationFn: ({ stmtId, data }: { stmtId: number; data: StatementForm }) => governanceApi.updateStatement(documentId, stmtId, payload(data)),
    success: (res) => proposedWords(res?.data, decider) ?? 'Statement saved',
    failure: 'Not saved',
    fallback: 'The statement could not be saved.',
    retryable: false,
    onSuccess: (res) => {
      setEditingStmtId(null);
      if (proposedOf(res?.data)) { refreshAfterProposal(); return; }       // the statement is as it was until the owner accepts
      onChanged();
      queryClient.invalidateQueries({ queryKey: ['statement-versions', documentId] });
      queryClient.invalidateQueries({ queryKey: ['statement-diff', documentId] });
      queryClient.invalidateQueries({ queryKey: ['document-sync'] });
    },
  });
  const deleteMutation = useReportedMutation({
    mutationFn: ({ stmtId, why }: { stmtId: number; why?: string }) => governanceApi.deleteStatement(documentId, stmtId, why),
    success: (res) => proposedWords(res?.data, decider) ?? 'Statement deleted',
    failure: 'Not deleted',
    fallback: 'The statement could not be deleted.',
    retryable: false,
    onSuccess: (res) => {
      setDeleteConfirm(null);
      setDeleteWhy('');
      if (proposedOf(res?.data)) { refreshAfterProposal(); return; }
      onChanged();
    },
  });

  // the dialog fades out for 200 ms after it is closed: its versions stay (the key keeps the statement it showed, the read is off) instead of flashing "No earlier versions"
  const lastHistoryStmt = useRef<number | null>(null);
  if (versionHistoryStmtId) lastHistoryStmt.current = versionHistoryStmtId;
  const { data: versionData, isLoading: versionsLoading } = useQuery({
    queryKey: ['statement-versions', documentId, versionHistoryStmtId ?? lastHistoryStmt.current],
    queryFn: async () => (await governanceApi.getStatementVersions(documentId, versionHistoryStmtId!)).data as any,
    enabled: !!versionHistoryStmtId,
  });
  const { data: diffData } = useQuery({
    queryKey: ['statement-diff', documentId, versionHistoryStmtId, compareVersions],
    queryFn: async () => (await governanceApi.getStatementDiff(documentId, versionHistoryStmtId!, compareVersions!.a, compareVersions!.b)).data as any,
    enabled: !!versionHistoryStmtId && !!compareVersions,
  });
  const rollbackMutation = useReportedMutation({
    mutationFn: ({ stmtId, versionId, why }: { stmtId: number; versionId: number; why?: string }) => governanceApi.rollbackStatement(documentId, stmtId, versionId, why),
    success: (res) => proposedWords(res?.data, decider) ?? { title: 'Rolled back', message: 'The statement has the wording of that version again.' },
    failure: 'Not rolled back',
    fallback: 'The statement could not be rolled back.',
    retryable: false,
    onSuccess: (res) => {
      setRollingBack(null);
      if (proposedOf(res?.data)) { refreshAfterProposal(); return; }
      onChanged();
      queryClient.invalidateQueries({ queryKey: ['statement-versions', documentId, versionHistoryStmtId] });
    },
  });

  const { data: parseStatus } = useQuery({
    queryKey: ['parse-status', documentId],
    queryFn: async () => (await governanceApi.getParseStatus(documentId)).data as any,
    enabled: !!documentId,
    // polled while parsing is in flight so the progress bar moves; stops once the run is over
    refetchInterval: (query) => {
      const s = (query.state.data as any)?.status;
      return s === 'parsing' || s === 'queued' ? 2000 : false;
    },
  });
  const { data: proposalsData } = useQuery({
    queryKey: ['reparse-proposals', documentId],
    queryFn: async () => (await governanceApi.getReparseProposals(documentId)).data as any,
    enabled: !!parseStatus?.has_proposals || parseStatus?.status === 'review_required',
  });
  // a parse that ends after this view was left and opened again (its own polling stopped with it), or the statements following a
  // new version of the document by themselves: the list is read again
  const parseRunning = parseStatus?.status === 'parsing' || parseStatus?.status === 'queued';
  const wasRunning = useRef(parseRunning);
  useEffect(() => {
    if (wasRunning.current && !parseRunning) {
      onChanged();
      queryClient.invalidateQueries({ queryKey: ['reparse-proposals', documentId] });
      if (parseStatus?.automatic && (parseStatus.added || parseStatus.changed || parseStatus.removed)) {
        notify.info(parseStatus.message, { title: 'Statements updated' });
      }
    }
    wasRunning.current = parseRunning;
  }, [parseRunning]); // eslint-disable-line react-hooks/exhaustive-deps
  const applyProposalsMutation = useReportedMutation({
    mutationFn: (decisions: Array<{ index: number; action: string }>) => governanceApi.applyReparseProposals(documentId, decisions),
    success: (res: any) => ({ title: 'Done', message: res.data?.message || 'Your choices were applied to the statements.' }),
    failure: 'Not applied',
    fallback: 'Your choices could not be applied.',
    retryable: false,
    onSuccess: () => {
      onChanged();
      queryClient.invalidateQueries({ queryKey: ['reparse-proposals', documentId] });
      queryClient.invalidateQueries({ queryKey: ['parse-status', documentId] });
    },
  });

  const grouped = useMemo(() => {
    const groups: Record<string, any[]> = {};
    stmts.forEach((stmt: any) => {
      const cat = stmt.category || 'uncategorized';
      (groups[cat] ||= []).push(stmt);
    });
    return groups;
  }, [stmts]);
  // the statements a newer version no longer says stay listed with their history, but are not counted as the document's
  const removed = stmts.filter((s: any) => s.status === 'superseded').length;
  const inDocument = (list: any[]) => list.filter((s: any) => s.status !== 'superseded').length;

  const toggleCategory = (cat: string) => setCollapsed((prev) => {
    const next = new Set(prev);
    if (next.has(cat)) next.delete(cat);
    else next.add(cat);
    return next;
  });
  const startEdit = (stmt: any) => {
    setEditingStmtId(stmt.id);
    setEditStmtForm(formOf(stmt));
  };
  // Propose again (a statement change that was not accepted): its form opens with what was proposed, for its proposer to adjust
  useEffect(() => {
    if (!again || statementsLoading) return;
    const after = again.statement?.after;
    const target = stmts.find((s: any) => s.id === again.statement?.id);
    if (again.source === 'statement_add' && after) { setAddForm(formOf(after)); setShowAddForm(true); }
    else if (again.source === 'statement_delete' && target) setDeleteConfirm(target.id);
    else if (target) { setEditingStmtId(target.id); setEditStmtForm(after ? formOf(after) : formOf(target)); }
    onAgainOpened?.();
  }, [again, statementsLoading]); // eslint-disable-line react-hooks/exhaustive-deps
  const exportCsv = async () => {
    try {
      const response = await governanceApi.exportPolicyStatements(documentId);
      const url = window.URL.createObjectURL(new Blob([response.data], { type: 'text/csv' }));
      const a = window.document.createElement('a');
      a.href = url;
      a.download = `policy_statements_${documentId}_${new Date().toISOString().slice(0, 10)}.csv`;
      window.document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      window.document.body.removeChild(a);
    } catch {
      notify.error('The statements could not be downloaded.', { title: 'Not exported', retry: () => { void exportCsv(); } });
    }
  };

  const addPanel = showAddForm && canEdit && (
    <section className="rounded-xl border border-[#99d5cc] bg-white p-4">
      <h4 className="mb-3 flex items-center gap-2 text-sm font-semibold text-[#0b4f46]"><Plus className="h-4 w-4" aria-hidden /> New statement</h4>
      <StatementFields form={addForm} setForm={setAddForm} autoFocus idPrefix="statement-new" proposeTo={proposeTo} />
      <div className="mt-3 flex justify-end gap-2 border-t border-[#e3e8ec] pt-3">
        <Button onClick={() => setShowAddForm(false)}>Cancel</Button>
        <Button variant="primary" leftIcon={<Plus aria-hidden />} loading={addMutation.isPending} disabled={!ready(addForm)} onClick={() => addMutation.mutate(addForm)}
          title={ready(addForm) ? undefined : 'Write the statement and why it is added first'}>
          {proposeTo ? sendLabel(proposeTo) : 'Add statement'}
        </Button>
      </div>
    </section>
  );
  // new statements proposed by others, waiting for the owner (they are not statements yet)
  const proposedNew = proposedStatements(changeProposals?.items);
  const proposedPanel = proposedNew.length > 0 && (
    <section className="rounded-xl border border-amber-300 bg-white p-4" aria-label="New statements proposed">
      <h4 className="text-sm font-semibold text-[#1f2933]">New statements proposed</h4>
      {proposedNew.map((p) => <ProposedStatementBox key={p.id} documentId={documentId} p={p} decider={decider} />)}
    </section>
  );

  if (statementsLoading) return <SkeletonLines lines={8} label="Loading the statements" />;
  // a failed read is not "no statements": it says so and offers Retry
  if (statementsError) return <ErrorState title="Couldn't load the statements" message={statementsErrorText} onRetry={onRetryStatements} />;

  if (stmts.length === 0) {
    return (
      <div className="space-y-4">
        {addPanel}
        {proposedPanel}
        <EmptyState kind="firstUse" icon={ClipboardList} title="No statements"
          info={canEdit ? 'Comply Agent reads the document and lists what it requires, one statement each. Mapping and gap analysis work on them.'
            : 'Its editors can parse it into statements. Mapping and gap analysis work on them.'}
          action={canEdit ? (
            <div className="flex flex-wrap items-center justify-center gap-2">
              <Button variant="primary" leftIcon={<Wand2 aria-hidden />} loading={parsing} onClick={() => parsePolicyMutation.mutate()}>{isParsing ? 'Parsing…' : 'Parse document'}</Button>
              <Button leftIcon={<Plus aria-hidden />} onClick={() => setShowAddForm(true)}>Add statement</Button>
            </div>
          ) : undefined} />
        <ParseProgress isParsing={isParsing} parseStatus={parseStatus} />
      </div>
    );
  }

  const categoryKeys = Object.keys(grouped);
  const proposals: any[] = proposalsData?.proposals || [];
  const pendingProposals = proposals.filter((p: any) => p.status === 'pending');

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h3 className="flex items-center gap-1 text-[15px] font-semibold text-[#1f2933]">
            Statements <span className="font-normal text-[#586472]">· {stmts.length - removed}</span>
            <InfoTip label="About the statements" text="What the document requires, one statement each. Mapping and gap analysis work on them." />
          </h3>
          {removed > 0 && (
            <span className="rounded-full bg-[#eef1f4] px-2 py-0.5 text-xs text-[#3f4b58]" title="A newer version of the document no longer says them; they are kept with their history">
              {removed} no longer in the document
            </span>
          )}
          {categoryKeys.filter((cat) => inDocument(grouped[cat]) > 0).map((cat) => {
            const colors = CATEGORY_COLORS[cat] || OTHER_COLORS;
            return <span key={cat} className={`rounded-full px-2 py-0.5 text-xs font-medium ${colors.bg} ${colors.text}`}>{formatCategory(cat)} {inDocument(grouped[cat])}</span>;
          })}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button leftIcon={<Download aria-hidden />} onClick={exportCsv}>Export CSV</Button>
          {canEdit && <Button leftIcon={<Plus aria-hidden />} onClick={() => setShowAddForm(true)}>Add statement</Button>}
          {canEdit && (
            <Button leftIcon={<Wand2 aria-hidden />} loading={parsing} title="Read the document again; changes to the statements are proposed for you to accept or reject"
              onClick={() => parsePolicyMutation.mutate()}>
              {isParsing ? 'Parsing…' : 'Parse again'}
            </Button>
          )}
        </div>
      </div>

      <ParseProgress isParsing={isParsing} parseStatus={parseStatus} />
      {addPanel}
      {proposedPanel}

      {canEdit && pendingProposals.length > 0 && (
        <section className="space-y-3 rounded-xl border border-amber-300 bg-amber-50 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <AlertTriangle className="h-5 w-5 shrink-0 text-amber-700" aria-hidden />
              <h4 className="text-sm font-semibold text-amber-950">Changes to review</h4>
              <span className="text-xs text-amber-900">{proposalsData.total} · {proposalsData.update_count} changed · {proposalsData.new_count} new</span>
              <InfoTip label="About the changes to review" text="Reading the document again proposes these changes to the statements. Accept or reject each one, or all at once." />
            </div>
            <div className="flex items-center gap-2">
              <Button variant="primary" leftIcon={<Check aria-hidden />} disabled={applyProposalsMutation.isPending}
                onClick={() => applyProposalsMutation.mutate(proposals.map((_: any, i: number) => ({ index: i, action: 'accept' })))}>Accept all</Button>
              <Button leftIcon={<X aria-hidden />} disabled={applyProposalsMutation.isPending}
                onClick={() => applyProposalsMutation.mutate(proposals.map((_: any, i: number) => ({ index: i, action: 'reject' })))}>Reject all</Button>
            </div>
          </div>
          <div className="max-h-96 space-y-3 overflow-y-auto">
            {pendingProposals.map((proposal: any, idx: number) => (
              <div key={idx} className="rounded-lg border border-[#d5dbe1] bg-white p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className={`rounded px-2 py-0.5 text-xs font-medium ${proposal.type === 'update' ? 'bg-amber-100 text-amber-900' : 'bg-emerald-50 text-emerald-800'}`}>
                      {proposal.type === 'update' ? 'Changed' : 'New'}
                    </span>
                    {proposal.similarity_score > 0 && <span className="text-xs text-[#586472]">{Math.round(proposal.similarity_score * 100)}% alike</span>}
                  </div>
                  <div className="flex items-center gap-1">
                    <IconButton label="Accept" onClick={() => applyProposalsMutation.mutate([{ index: proposal.index, action: 'accept' }])} disabled={applyProposalsMutation.isPending}><Check aria-hidden /></IconButton>
                    <IconButton label="Reject" onClick={() => applyProposalsMutation.mutate([{ index: proposal.index, action: 'reject' }])} disabled={applyProposalsMutation.isPending}><X aria-hidden /></IconButton>
                  </div>
                </div>
                {proposal.type === 'update' && proposal.existing_text ? (
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="rounded border border-rose-200 bg-rose-50 p-2">
                      <span className="text-xs font-medium text-[#7a1616]">Now</span>
                      <p className="mt-1 line-clamp-3 text-xs text-[#26323d]">{proposal.existing_text}</p>
                    </div>
                    <div className="rounded border border-emerald-200 bg-emerald-50 p-2">
                      <span className="text-xs font-medium text-emerald-800">Proposed</span>
                      <p className="mt-1 line-clamp-3 text-xs text-[#26323d]">{proposal.new_statement?.statement_text}</p>
                    </div>
                  </div>
                ) : (
                  <p className="line-clamp-3 text-xs text-[#26323d]">{proposal.new_statement?.statement_text}</p>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {categoryKeys.map((cat) => {
        const colors = CATEGORY_COLORS[cat] || OTHER_COLORS;
        const isExpanded = !collapsed.has(cat);
        const catStmts = grouped[cat];
        return (
          <section key={cat} className="overflow-hidden rounded-xl border border-[#d5dbe1] bg-[#fff]">
            <button type="button" onClick={() => toggleCategory(cat)} aria-expanded={isExpanded}
              className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-[#f7f9fa]">
              <span className="flex items-center gap-3">
                <span className={`rounded-lg px-2.5 py-1 text-xs font-semibold ${colors.bg} ${colors.text}`}>{formatCategory(cat)}</span>
                <span className="text-sm text-[#586472]">
                  {inDocument(catStmts)}<span className="sr-only"> statements</span>
                  {inDocument(catStmts) < catStmts.length && ` · ${catStmts.length - inDocument(catStmts)} no longer in the document`}
                </span>
              </span>
              {isExpanded ? <ChevronUp className="h-4 w-4 text-[#586472]" aria-hidden /> : <ChevronDown className="h-4 w-4 text-[#586472]" aria-hidden />}
            </button>
            {isExpanded && (
              <div className="divide-y divide-[#e1e6eb] border-t border-[#e1e6eb]">
                {catStmts.map((stmt: any, idx: number) => {
                  const waiting = pendingFor(changeProposals?.items, stmt.id);
                  return (
                  <div key={stmt.id || idx} className="p-4">
                    {editingStmtId === stmt.id ? (
                      <div>
                        <StatementFields form={editStmtForm} setForm={setEditStmtForm} autoFocus idPrefix={`statement-${stmt.id}`} proposeTo={proposeTo} />
                        <div className="mt-3 flex justify-end gap-2">
                          <Button onClick={() => setEditingStmtId(null)}>Cancel</Button>
                          <Button variant="primary" leftIcon={<Save aria-hidden />} loading={updateMutation.isPending} disabled={!ready(editStmtForm)}
                            title={ready(editStmtForm) ? undefined : 'Write why the statement changes first'}
                            onClick={() => updateMutation.mutate({ stmtId: stmt.id, data: editStmtForm })}>
                            {proposeTo ? sendLabel(proposeTo) : 'Save'}
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-2">
                            {stmt.statement_code && <span className="font-mono text-xs text-[#586472]">{stmt.statement_code}</span>}
                            {stmt.source_section && <span className="rounded bg-[#eef1f4] px-2 py-0.5 text-xs text-[#3f4b58]">{stmt.source_section}</span>}
                            {stmt.is_mandatory && <span className="rounded bg-rose-50 px-2 py-0.5 text-xs text-[#7a1616]">Mandatory</span>}
                            {stmt.priority && <span className={`rounded px-2 py-0.5 text-xs font-medium capitalize ${PRIORITY_STYLE[stmt.priority] || 'bg-[#eef1f4] text-[#3f4b58]'}`}>{stmt.priority}</span>}
                          </div>
                          <div className="flex flex-wrap items-center gap-1.5">
                            <StatementControlButton stmt={stmt} documentId={documentId} documentTitle={documentTitle} canCreate={canEdit} onCreated={onChanged} />
                            <IconButton label="History" onClick={() => setVersionHistoryStmtId(stmt.id)}><History aria-hidden /></IconButton>
                            {canEdit && <IconButton label="Edit" onClick={() => startEdit(stmt)}><Pencil aria-hidden /></IconButton>}
                            {canEdit && (deleteConfirm === stmt.id && !proposeTo ? (
                              <span className="flex items-center gap-1">
                                <Button variant="danger" size="sm" loading={deleteMutation.isPending} onClick={() => deleteMutation.mutate({ stmtId: stmt.id })}>
                                  {deleteMutation.isPending ? 'Deleting…' : 'Delete'}
                                </Button>
                                <Button variant="ghost" size="sm" onClick={() => setDeleteConfirm(null)}>Cancel</Button>
                              </span>
                            ) : deleteConfirm === stmt.id ? null : (
                              <IconButton label="Delete" onClick={() => setDeleteConfirm(stmt.id)}><Trash2 aria-hidden /></IconButton>
                            ))}
                          </div>
                        </div>
                        <p className="text-sm text-[#26323d]">{stmt.statement_text || stmt.text}</p>
                        {stmt.pending_in_document && (
                          <span className="mt-1 inline-block rounded border border-amber-300 px-1.5 py-0.5 text-xs text-amber-900" title="Edited since the document was last written">Edited · not yet in the document</span>
                        )}
                        {stmt.source_match === 'not_found' && (
                          <span className="mt-1 inline-block rounded border border-[#b8c4c8] px-1.5 py-0.5 text-xs text-[#3f4b58]" title="This wording was not found in the document file">Not found in the document</span>
                        )}
                        {stmt.status === 'superseded' && (
                          <span className="mt-1 inline-block rounded border border-[#b8c4c8] px-1.5 py-0.5 text-xs text-[#3f4b58]" title="A newer version of the document no longer says this; it is kept with its history">No longer in the document</span>
                        )}
                        {stmt.statement_summary && <p className="mt-1 text-xs italic text-[#586472]">{stmt.statement_summary}</p>}
                        {/* a removal by someone who is not the owner or author: why, then it goes to the owner */}
                        {canEdit && proposeTo && deleteConfirm === stmt.id && (
                          <div className="mt-2 space-y-2 rounded-lg border border-rose-200 bg-rose-50/50 p-3">
                            <FormField id={`statement-${stmt.id}-remove-why`} required hint={goesToLine(proposeTo)}
                              label={<>Why remove it <span className="font-normal text-ds-fg-muted">({proposeTo} reads it)</span></>}>
                              <Textarea value={deleteWhy} onChange={(e) => setDeleteWhy(e.target.value)} rows={2} maxLength={2000} autoFocus />
                            </FormField>
                            <div className="flex flex-wrap justify-end gap-2">
                              <Button onClick={() => { setDeleteConfirm(null); setDeleteWhy(''); }}>Cancel</Button>
                              <Button variant="danger" loading={deleteMutation.isPending} disabled={!deleteWhy.trim()} onClick={() => deleteMutation.mutate({ stmtId: stmt.id, why: deleteWhy })}>
                                {sendLabel(proposeTo)}
                              </Button>
                            </div>
                          </div>
                        )}
                        {waiting && <ProposedStatementBox documentId={documentId} p={waiting} decider={decider} />}
                      </>
                    )}
                  </div>
                  );
                })}
              </div>
            )}
          </section>
        );
      })}

      {/* the statement's versions, compared and rolled back (a kit dialog: it takes focus, wraps Tab, closes on Escape, gives focus back; typing a roll back's reason asks before it is thrown away) */}
      <AnimatedModal isOpen={!!versionHistoryStmtId} onClose={() => { setVersionHistoryStmtId(null); setCompareVersions(null); setRollingBack(null); }} size="xl" title="Statement history"
        dirty={!!rollingBack?.why.trim()}
        headerAccessory={versionData?.total_versions != null ? (
          <span className="rounded-full bg-[#effaf8] px-2.5 py-0.5 text-xs font-medium text-[#0b4f46]">{versionData.total_versions} version{versionData.total_versions !== 1 ? 's' : ''}</span>
        ) : undefined}>
        <div className="space-y-4 p-5">
          {versionsLoading ? (
            <SkeletonLines lines={5} label="Loading the versions" />
          ) : versionData?.versions?.length > 0 ? (
            <>
              <div className="space-y-3">
                {versionData.versions.map((v: any, idx: number) => {
                  const isLatest = idx === 0;
                  return (
                    <div key={v.id} className={`rounded-xl border p-4 ${isLatest ? 'border-[#99d5cc] bg-[#effaf8]' : 'border-[#d5dbe1] bg-white'}`}>
                      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="rounded bg-[#eef1f4] px-2 py-0.5 font-mono text-xs text-[#26323d]">v{v.version_number}</span>
                          <span className="rounded bg-[#eef1f4] px-2 py-0.5 text-xs font-medium capitalize text-[#3f4b58]">{v.change_type?.replace(/_/g, ' ')}</span>
                          {isLatest && <span className="rounded bg-emerald-50 px-2 py-0.5 text-xs text-emerald-800">Current</span>}
                        </div>
                        {!isLatest && (
                          <div className="flex items-center gap-2">
                            <Button size="sm" leftIcon={<GitCompare aria-hidden />} onClick={() => setCompareVersions({ a: v.id, b: versionData.versions[0].id })}>Compare</Button>
                            {canEdit && (
                              <Button size="sm" leftIcon={<RotateCcw aria-hidden />} loading={rollbackMutation.isPending} title="Roll back to this version"
                                onClick={() => (proposeTo ? setRollingBack({ versionId: v.id, why: '' }) : rollbackMutation.mutate({ stmtId: versionHistoryStmtId!, versionId: v.id }))}>
                                {rollbackMutation.isPending ? 'Rolling back…' : 'Roll back'}
                              </Button>
                            )}
                          </div>
                        )}
                      </div>
                      <p className="whitespace-pre-wrap break-words text-sm text-[#26323d]">{v.statement_text}</p>
                      <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-[#586472]">
                        {v.changed_by_name && <span className="flex items-center gap-1"><User className="h-3 w-3" aria-hidden /> {v.changed_by_name}</span>}
                        {v.changed_at && <span className="flex items-center gap-1">{dateTime(v.changed_at)}</span>}
                        {v.change_reason && <span className="italic">&quot;{v.change_reason}&quot;</span>}
                      </div>
                      {proposeTo && rollingBack && rollingBack.versionId === v.id && (
                        <div className="mt-3 space-y-2 rounded-lg border border-[#99d5cc] bg-[#f3fbf9] p-3">
                          <FormField id={`statement-rollback-why-${v.id}`} required hint={goesToLine(proposeTo)}
                            label={<>Justification for this change <span className="font-normal text-ds-fg-muted">({proposeTo} reads it)</span></>}>
                            <Textarea value={rollingBack.why} rows={2} maxLength={2000} autoFocus onChange={(e) => setRollingBack({ versionId: v.id, why: e.target.value })} />
                          </FormField>
                          <div className="flex flex-wrap justify-end gap-2">
                            <Button onClick={() => setRollingBack(null)}>Cancel</Button>
                            <Button variant="primary" loading={rollbackMutation.isPending} disabled={!rollingBack.why.trim()}
                              onClick={() => rollbackMutation.mutate({ stmtId: versionHistoryStmtId!, versionId: v.id, why: rollingBack.why })}>
                              {sendLabel(proposeTo)}
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              {compareVersions && diffData && (
                <div className="mt-4 rounded-xl border border-[#99d5cc] bg-white p-4">
                  <h4 className="mb-3 flex items-center gap-2 text-sm font-semibold text-[#0b4f46]"><GitCompare className="h-4 w-4" aria-hidden /> What changed</h4>
                  {diffData.field_changes?.length > 0 ? (
                    <div className="space-y-2">
                      {diffData.field_changes.map((change: any, i: number) => (
                        <div key={i} className="rounded-lg border border-[#d5dbe1] bg-white p-3">
                          <span className="text-xs font-semibold uppercase text-[#586472]">{change.field.replace(/_/g, ' ')}</span>
                          <div className="mt-1 grid grid-cols-1 gap-3 sm:grid-cols-2">
                            <div className="rounded border border-rose-200 bg-rose-50 p-2">
                              <span className="text-xs text-[#7a1616]">v{diffData.version_a.version_number}</span>
                              <p className="mt-1 whitespace-pre-wrap break-words text-sm text-[#26323d]">{change.version_a_value || '(empty)'}</p>
                            </div>
                            <div className="rounded border border-emerald-200 bg-emerald-50 p-2">
                              <span className="text-xs text-emerald-800">v{diffData.version_b.version_number}</span>
                              <p className="mt-1 whitespace-pre-wrap break-words text-sm text-[#26323d]">{change.version_b_value || '(empty)'}</p>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-[#586472]">No difference</p>
                  )}
                </div>
              )}
            </>
          ) : (
            <p className="py-8 text-center text-sm text-[#586472]">No earlier versions</p>
          )}
        </div>
      </AnimatedModal>
    </div>
  );
}
