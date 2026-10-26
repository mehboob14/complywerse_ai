'use client';

/**
 * A document's policy statements: parse the document into statements (in the background), read them by category, add, edit
 * and delete them, see each one's history (compare, roll back), review a re-parse's proposals, export them, and turn one into
 * a control. Used by the AI Studio's Statements view and the classic page. Readers read; the changes are for the document's
 * editors (`canEdit`; the server checks them too).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle, Check, ChevronDown, ChevronUp, ClipboardList, Clock, Download, GitCompare, History, Loader2, Pencil, Plus, RotateCcw,
  Save, ShieldCheck, Trash2, User, Wand2, X,
} from 'lucide-react';
import { governanceApi } from '@/lib/api';
import { useToast } from '@/components/ui/ToastProvider';
import { InfoTip } from '@/components/ui/InfoTip';
import { BTN, BTN_PRIMARY as PRIMARY } from '@/components/governance/docUi';
import CreateControlDialog from '@/components/soc2/CreateControlDialog';
import { fieldRows, goesToLine, pendingFor, proposedStatements, sendLabel, type Proposal } from '@/lib/proposals';
import DocumentSyncPanel from './_DocumentSyncPanel';
import { ProposalActions, useProposalRole, useProposedAnswer } from './_ProposalsView';

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
const FIELD = 'w-full rounded-lg border border-[#b8c4c8] bg-white px-3 py-2 text-sm text-[#1f2933] focus:border-[#0f766e] focus:outline-none focus:ring-1 focus:ring-[#0f766e]';
const LABEL = 'mb-1 block text-xs font-medium text-[#3f4b58]';
// (the buttons BTN and PRIMARY are the Documents area's shared ones, components/governance/docUi; ICON is the small one for a row)
const ICON = 'rounded p-1 text-[#3f4b58] hover:bg-[#eef1f4] hover:text-[#0b4f46]';

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
      <label className="block">
        <span className={LABEL}>Statement</span>
        <textarea value={form.statement_text} rows={3} autoFocus={autoFocus} placeholder="What the document requires…" className={FIELD}
          onChange={(e) => setForm((p) => ({ ...p, statement_text: e.target.value }))} />
      </label>
      <div>
        <label htmlFor={`${idPrefix}-why`} className={LABEL}>
          Justification for this change <span className="font-normal text-[#586472]">(required{proposeTo ? `: ${proposeTo} reads it` : ''})</span>
        </label>
        <textarea id={`${idPrefix}-why`} value={form.change_reason} rows={2} maxLength={2000} required aria-required="true" className={FIELD}
          placeholder="e.g. The new password standard asks for 12 characters"
          onChange={(e) => setForm((p) => ({ ...p, change_reason: e.target.value }))} />
        {proposeTo && <p className="mt-1 text-[11px] text-[#0b4f46]">{goesToLine(proposeTo)}</p>}
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <label className="block">
          <span className={LABEL}>Category</span>
          <select value={form.category} className={FIELD} onChange={(e) => setForm((p) => ({ ...p, category: e.target.value }))}>
            {Object.keys(CATEGORY_COLORS).map((c) => <option key={c} value={c}>{formatCategory(c)}</option>)}
          </select>
        </label>
        <label className="block">
          <span className={LABEL}>Priority</span>
          <select value={form.priority} className={FIELD} onChange={(e) => setForm((p) => ({ ...p, priority: e.target.value }))}>
            <option value="critical">Critical</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
        </label>
        <label className="block">
          <span className={LABEL}>Section</span>
          <input type="text" value={form.source_section} placeholder="e.g. 4.1" className={FIELD} onChange={(e) => setForm((p) => ({ ...p, source_section: e.target.value }))} />
        </label>
        <label className="flex cursor-pointer items-end gap-2 pb-2">
          <input type="checkbox" checked={form.is_mandatory} onChange={(e) => setForm((p) => ({ ...p, is_mandatory: e.target.checked }))}
            className="h-4 w-4 rounded border-[#b8c4c8] text-[#0f766e]" />
          <span className="text-sm text-[#26323d]">Mandatory</span>
        </label>
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
          className="inline-flex items-center gap-1 rounded border border-[#99d5cc] bg-[#effaf8] px-1.5 py-0.5 font-mono text-[10.5px] font-semibold text-[#0b4f46] hover:bg-[#dff3ef]">
          {c}
        </Link>
      ))}
      {canCreate && (
        <>
          <button type="button" onClick={() => setOpen(true)} title="Author a control that implements this statement"
            className="inline-flex items-center gap-1 rounded-md border border-[#b8c4c8] bg-white px-2 py-0.5 text-[11px] font-medium text-[#26323d] hover:border-[#0f766e] hover:text-[#0b4f46]">
            <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
            {codes.length ? 'Add control' : 'Create control'}
          </button>
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
  const { toast } = useToast();
  const refreshStatements = () => {
    queryClient.invalidateQueries({ queryKey: ['document-policy-statements', documentId] });
    queryClient.invalidateQueries({ queryKey: ['document-chain'] });             // the Change log records every statement change
  };

  const { data: statements, isLoading: statementsLoading, isError: statementsError } = useQuery({
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
          toast({ type: 'success', title: 'Statements ready', message: data.message || `${data.total_statements || 0} statements found in the document.` });
          refreshStatements();
        } else if (data.status === 'review_required') {
          stopParsePolling();
          setIsParsing(false);
          toast({ type: 'info', title: 'Changes to review', message: data.message || 'Reading the document again proposes changes to the statements. Review them below.' });
          refreshStatements();
          queryClient.invalidateQueries({ queryKey: ['reparse-proposals', documentId] });
        } else if (data.status === 'failed') {
          stopParsePolling();
          setIsParsing(false);
          toast({ type: 'error', title: 'Not parsed', message: data.error || 'The document could not be read into statements.' });
        }
      } catch {
        stopParsePolling();
        setIsParsing(false);
      }
    }, 3000);
  };
  const parsePolicyMutation = useMutation({
    mutationFn: () => governanceApi.parsePolicy(documentId),
    onSuccess: () => {
      toast({ type: 'info', title: 'Parsing started', message: 'The statements appear here when it is done; you can leave this page.' });
      startParsePolling();
    },
    onError: (error: any) => toast({ type: 'error', title: 'Not parsed', message: error?.response?.data?.detail || 'The document could not be read into statements.' }),
  });

  return (
    <>
      {canEdit && <DocumentSyncPanel documentId={documentId} />}
      <StatementsList statements={statements} statementsLoading={statementsLoading} statementsError={statementsError} documentId={documentId}
        documentTitle={documentTitle} parsePolicyMutation={parsePolicyMutation} isParsing={isParsing} canEdit={canEdit} onChanged={refreshStatements}
        again={again} onAgainOpened={onAgainOpened} />
    </>
  );
}

function StatementsList({ statements, statementsLoading, statementsError, parsePolicyMutation, isParsing, documentId, documentTitle, canEdit, onChanged, again, onAgainOpened }: {
  statements: any; statementsLoading: boolean; statementsError: boolean; parsePolicyMutation: { mutate: () => void; isPending: boolean }; isParsing: boolean;
  documentId: number; documentTitle?: string; canEdit: boolean; onChanged: () => void; again: Proposal | null; onAgainOpened?: () => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
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
  const handledAsProposal = useProposedAnswer();

  const addMutation = useMutation({
    mutationFn: (data: StatementForm) => governanceApi.addStatement(documentId, payload(data)),
    onSuccess: (res) => {
      setShowAddForm(false);
      setAddForm(EMPTY_FORM);
      if (handledAsProposal(res?.data, decider)) return;                  // waits for the owner: not in the list yet
      toast({ type: 'success', title: 'Statement added' });
      onChanged();
    },
    onError: (error: any) => toast({ type: 'error', title: 'Not added', message: error?.response?.data?.detail || error?.message || 'The statement could not be added.' }),
  });
  const updateMutation = useMutation({
    // statement_summary is not sent: the AI's summary stays as it is
    mutationFn: ({ stmtId, data }: { stmtId: number; data: StatementForm }) => governanceApi.updateStatement(documentId, stmtId, payload(data)),
    onSuccess: (res) => {
      setEditingStmtId(null);
      if (handledAsProposal(res?.data, decider)) return;                  // the statement is as it was until the owner accepts
      toast({ type: 'success', title: 'Statement saved' });
      onChanged();
      queryClient.invalidateQueries({ queryKey: ['statement-versions', documentId] });
      queryClient.invalidateQueries({ queryKey: ['statement-diff', documentId] });
      queryClient.invalidateQueries({ queryKey: ['document-sync'] });
    },
    onError: (error: any) => toast({ type: 'error', title: 'Not saved', message: error?.response?.data?.detail || 'The statement could not be saved.' }),
  });
  const deleteMutation = useMutation({
    mutationFn: ({ stmtId, why }: { stmtId: number; why?: string }) => governanceApi.deleteStatement(documentId, stmtId, why),
    onSuccess: (res) => {
      setDeleteConfirm(null);
      setDeleteWhy('');
      if (handledAsProposal(res?.data, decider)) return;
      toast({ type: 'success', title: 'Statement deleted' });
      onChanged();
    },
    onError: (error: any) => toast({ type: 'error', title: 'Not deleted', message: error?.response?.data?.detail || 'The statement could not be deleted.' }),
  });

  const { data: versionData, isLoading: versionsLoading } = useQuery({
    queryKey: ['statement-versions', documentId, versionHistoryStmtId],
    queryFn: async () => (await governanceApi.getStatementVersions(documentId, versionHistoryStmtId!)).data as any,
    enabled: !!versionHistoryStmtId,
  });
  const { data: diffData } = useQuery({
    queryKey: ['statement-diff', documentId, versionHistoryStmtId, compareVersions],
    queryFn: async () => (await governanceApi.getStatementDiff(documentId, versionHistoryStmtId!, compareVersions!.a, compareVersions!.b)).data as any,
    enabled: !!versionHistoryStmtId && !!compareVersions,
  });
  const rollbackMutation = useMutation({
    mutationFn: ({ stmtId, versionId, why }: { stmtId: number; versionId: number; why?: string }) => governanceApi.rollbackStatement(documentId, stmtId, versionId, why),
    onSuccess: (res) => {
      setRollingBack(null);
      if (handledAsProposal(res?.data, decider)) return;
      toast({ type: 'success', title: 'Rolled back', message: 'The statement has the wording of that version again.' });
      onChanged();
      queryClient.invalidateQueries({ queryKey: ['statement-versions', documentId, versionHistoryStmtId] });
    },
    onError: (error: any) => toast({ type: 'error', title: 'Not rolled back', message: error?.response?.data?.detail || 'The statement could not be rolled back.' }),
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
        toast({ type: 'info', title: 'Statements updated', message: parseStatus.message });
      }
    }
    wasRunning.current = parseRunning;
  }, [parseRunning]); // eslint-disable-line react-hooks/exhaustive-deps
  const applyProposalsMutation = useMutation({
    mutationFn: (decisions: Array<{ index: number; action: string }>) => governanceApi.applyReparseProposals(documentId, decisions),
    onSuccess: (res: any) => {
      toast({ type: 'success', title: 'Done', message: res.data?.message || 'Your choices were applied to the statements.' });
      onChanged();
      queryClient.invalidateQueries({ queryKey: ['reparse-proposals', documentId] });
      queryClient.invalidateQueries({ queryKey: ['parse-status', documentId] });
    },
    onError: (error: any) => toast({ type: 'error', title: 'Not applied', message: error?.response?.data?.detail || 'Your choices could not be applied.' }),
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
      toast({ type: 'error', title: 'Not exported', message: 'The statements could not be downloaded.' });
    }
  };

  const addPanel = showAddForm && canEdit && (
    <section className="rounded-xl border border-[#99d5cc] bg-white p-4">
      <h4 className="mb-3 flex items-center gap-2 text-sm font-semibold text-[#0b4f46]"><Plus className="h-4 w-4" aria-hidden /> New statement</h4>
      <StatementFields form={addForm} setForm={setAddForm} autoFocus idPrefix="statement-new" proposeTo={proposeTo} />
      <div className="mt-3 flex justify-end gap-2 border-t border-[#e3e8ec] pt-3">
        <button type="button" onClick={() => setShowAddForm(false)} className={BTN}>Cancel</button>
        <button type="button" onClick={() => addMutation.mutate(addForm)} disabled={addMutation.isPending || !ready(addForm)} className={PRIMARY}
          title={ready(addForm) ? undefined : 'Write the statement and why it is added first'}>
          {addMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} {proposeTo ? sendLabel(proposeTo) : 'Add statement'}
        </button>
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

  if (statementsLoading) {
    return <div className="flex h-48 items-center justify-center" role="status" aria-label="Loading the statements"><Loader2 className="h-7 w-7 animate-spin text-[#0f766e]" /></div>;
  }
  if (statementsError) {
    return <p className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-[#7a1616]" role="alert">Could not load the statements.</p>;
  }

  if (stmts.length === 0) {
    return (
      <div className="space-y-4">
        {addPanel}
        {proposedPanel}
        <section className="flex flex-col items-center gap-2 rounded-xl border border-[#d5dbe1] bg-[#fff] px-4 py-8 text-center">
          <ClipboardList className="h-8 w-8 text-[#7b8794]" strokeWidth={1.5} aria-hidden />
          <p className="flex items-center gap-1 text-[13px] font-medium text-[#1f2933]">
            No statements
            <InfoTip label="About the statements"
              text={canEdit ? 'Comply Agent reads the document and lists what it requires, one statement each. Mapping and gap analysis work on them.'
                : 'Its editors can parse it into statements. Mapping and gap analysis work on them.'} />
          </p>
          {canEdit && (
            <div className="mt-1 flex flex-wrap items-center justify-center gap-2">
              <button type="button" onClick={() => parsePolicyMutation.mutate()} disabled={parsing} className={PRIMARY}>
                {parsing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
                {isParsing ? 'Parsing…' : 'Parse document'}
              </button>
              <button type="button" onClick={() => setShowAddForm(true)} className={BTN}><Plus className="h-4 w-4" /> Add statement</button>
            </div>
          )}
          <div className="w-full max-w-md empty:hidden"><ParseProgress isParsing={isParsing} parseStatus={parseStatus} /></div>
        </section>
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
          <button type="button" onClick={exportCsv} className={BTN}><Download className="h-4 w-4" /> Export CSV</button>
          {canEdit && <button type="button" onClick={() => setShowAddForm(true)} className={BTN}><Plus className="h-4 w-4" /> Add statement</button>}
          {canEdit && (
            <button type="button" onClick={() => parsePolicyMutation.mutate()} disabled={parsing} className={BTN}
              title="Read the document again; changes to the statements are proposed for you to accept or reject">
              {parsing ? <Loader2 className="h-4 w-4 animate-spin text-[#0f766e]" /> : <Wand2 className="h-4 w-4" />} {isParsing ? 'Parsing…' : 'Parse again'}
            </button>
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
              <button type="button" disabled={applyProposalsMutation.isPending} className={PRIMARY}
                onClick={() => applyProposalsMutation.mutate(proposals.map((_: any, i: number) => ({ index: i, action: 'accept' })))}>
                <Check className="h-4 w-4" /> Accept all
              </button>
              <button type="button" disabled={applyProposalsMutation.isPending} className={BTN}
                onClick={() => applyProposalsMutation.mutate(proposals.map((_: any, i: number) => ({ index: i, action: 'reject' })))}>
                <X className="h-4 w-4" /> Reject all
              </button>
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
                    <button type="button" onClick={() => applyProposalsMutation.mutate([{ index: proposal.index, action: 'accept' }])} disabled={applyProposalsMutation.isPending}
                      className="rounded-lg p-1.5 text-emerald-700 hover:bg-emerald-50" title="Accept" aria-label="Accept"><Check className="h-4 w-4" /></button>
                    <button type="button" onClick={() => applyProposalsMutation.mutate([{ index: proposal.index, action: 'reject' }])} disabled={applyProposalsMutation.isPending}
                      className="rounded-lg p-1.5 text-[#9b1c1c] hover:bg-rose-50" title="Reject" aria-label="Reject"><X className="h-4 w-4" /></button>
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
                          <button type="button" onClick={() => setEditingStmtId(null)} className={BTN}>Cancel</button>
                          <button type="button" onClick={() => updateMutation.mutate({ stmtId: stmt.id, data: editStmtForm })}
                            disabled={updateMutation.isPending || !ready(editStmtForm)} className={PRIMARY}
                            title={ready(editStmtForm) ? undefined : 'Write why the statement changes first'}>
                            {updateMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} {proposeTo ? sendLabel(proposeTo) : 'Save'}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-2">
                            {stmt.statement_code && <span className="font-mono text-[11px] text-[#586472]">{stmt.statement_code}</span>}
                            {stmt.source_section && <span className="rounded bg-[#eef1f4] px-2 py-0.5 text-xs text-[#3f4b58]">{stmt.source_section}</span>}
                            {stmt.is_mandatory && <span className="rounded bg-rose-50 px-2 py-0.5 text-xs text-[#7a1616]">Mandatory</span>}
                            {stmt.priority && <span className={`rounded px-2 py-0.5 text-xs font-medium capitalize ${PRIORITY_STYLE[stmt.priority] || 'bg-[#eef1f4] text-[#3f4b58]'}`}>{stmt.priority}</span>}
                          </div>
                          <div className="flex flex-wrap items-center gap-1.5">
                            <StatementControlButton stmt={stmt} documentId={documentId} documentTitle={documentTitle} canCreate={canEdit} onCreated={onChanged} />
                            <button type="button" onClick={() => setVersionHistoryStmtId(stmt.id)} className={ICON} title="History" aria-label="History"><History className="h-3.5 w-3.5" /></button>
                            {canEdit && <button type="button" onClick={() => startEdit(stmt)} className={ICON} title="Edit" aria-label="Edit"><Pencil className="h-3.5 w-3.5" /></button>}
                            {canEdit && (deleteConfirm === stmt.id && !proposeTo ? (
                              <span className="flex items-center gap-1">
                                <button type="button" onClick={() => deleteMutation.mutate({ stmtId: stmt.id })} disabled={deleteMutation.isPending}
                                  className="rounded bg-[#b42318] px-2 py-0.5 text-xs font-medium text-white hover:bg-[#912018] disabled:opacity-50">
                                  {deleteMutation.isPending ? 'Deleting…' : 'Delete'}
                                </button>
                                <button type="button" onClick={() => setDeleteConfirm(null)} className="rounded px-2 py-0.5 text-xs text-[#3f4b58] hover:bg-[#eef1f4]">Cancel</button>
                              </span>
                            ) : deleteConfirm === stmt.id ? null : (
                              <button type="button" onClick={() => setDeleteConfirm(stmt.id)} className="rounded p-1 text-[#3f4b58] hover:bg-rose-50 hover:text-[#9b1c1c]" title="Delete" aria-label="Delete">
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            ))}
                          </div>
                        </div>
                        <p className="text-sm text-[#26323d]">{stmt.statement_text || stmt.text}</p>
                        {stmt.pending_in_document && (
                          <span className="mt-1 inline-block rounded border border-amber-300 px-1.5 py-0.5 text-[11px] text-amber-900" title="Edited since the document was last written">Edited · not yet in the document</span>
                        )}
                        {stmt.source_match === 'not_found' && (
                          <span className="mt-1 inline-block rounded border border-[#b8c4c8] px-1.5 py-0.5 text-[11px] text-[#3f4b58]" title="This wording was not found in the document file">Not found in the document</span>
                        )}
                        {stmt.status === 'superseded' && (
                          <span className="mt-1 inline-block rounded border border-[#b8c4c8] px-1.5 py-0.5 text-[11px] text-[#3f4b58]" title="A newer version of the document no longer says this; it is kept with its history">No longer in the document</span>
                        )}
                        {stmt.statement_summary && <p className="mt-1 text-xs italic text-[#586472]">{stmt.statement_summary}</p>}
                        {/* a removal by someone who is not the owner or author: why, then it goes to the owner */}
                        {canEdit && proposeTo && deleteConfirm === stmt.id && (
                          <div className="mt-2 space-y-2 rounded-lg border border-rose-200 bg-rose-50/50 p-3">
                            <label htmlFor={`statement-${stmt.id}-remove-why`} className="block text-xs font-semibold text-[#26323d]">
                              Why remove it <span className="font-normal text-[#586472]">(required: {proposeTo} reads it)</span>
                            </label>
                            <textarea id={`statement-${stmt.id}-remove-why`} value={deleteWhy} onChange={(e) => setDeleteWhy(e.target.value)} rows={2} maxLength={2000}
                              required aria-required="true" autoFocus className={FIELD} />
                            <p className="text-[11px] text-[#0b4f46]">{goesToLine(proposeTo)}</p>
                            <div className="flex flex-wrap justify-end gap-2">
                              <button type="button" onClick={() => { setDeleteConfirm(null); setDeleteWhy(''); }} className={BTN}>Cancel</button>
                              <button type="button" onClick={() => deleteMutation.mutate({ stmtId: stmt.id, why: deleteWhy })} disabled={deleteMutation.isPending || !deleteWhy.trim()}
                                className="inline-flex items-center gap-1.5 rounded-lg bg-[#b42318] px-3 py-1.5 text-sm font-semibold text-white hover:bg-[#912018] disabled:opacity-50">
                                {deleteMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />} {sendLabel(proposeTo)}
                              </button>
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

      {versionHistoryStmtId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-label="Statement history"
          onKeyDown={(e) => { if (e.key === 'Escape') { setVersionHistoryStmtId(null); setCompareVersions(null); } }}>
          <div className="max-h-[85vh] w-full max-w-4xl overflow-y-auto rounded-2xl border border-[#d5dbe1] bg-white shadow-2xl">
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-[#d5dbe1] bg-white px-5 py-3">
              <div className="flex items-center gap-3">
                <History className="h-5 w-5 text-[#0f766e]" aria-hidden />
                <h3 className="text-base font-semibold text-[#1f2933]">Statement history</h3>
                {versionData?.total_versions != null && (
                  <span className="rounded-full bg-[#effaf8] px-2.5 py-0.5 text-xs font-medium text-[#0b4f46]">{versionData.total_versions} version{versionData.total_versions !== 1 ? 's' : ''}</span>
                )}
              </div>
              <button type="button" autoFocus onClick={() => { setVersionHistoryStmtId(null); setCompareVersions(null); }} className={ICON} aria-label="Close"><X className="h-5 w-5" /></button>
            </div>
            <div className="space-y-4 p-5">
              {versionsLoading ? (
                <div className="flex h-32 items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-[#0f766e]" /></div>
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
                                <button type="button" onClick={() => setCompareVersions({ a: v.id, b: versionData.versions[0].id })} className={BTN}><GitCompare className="h-3.5 w-3.5" /> Compare</button>
                                {canEdit && (
                                  <button type="button" disabled={rollbackMutation.isPending} className={BTN} title="Roll back to this version"
                                    onClick={() => (proposeTo ? setRollingBack({ versionId: v.id, why: '' }) : rollbackMutation.mutate({ stmtId: versionHistoryStmtId, versionId: v.id }))}>
                                    <RotateCcw className="h-3.5 w-3.5" /> {rollbackMutation.isPending ? 'Rolling back…' : 'Roll back'}
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                          <p className="whitespace-pre-wrap break-words text-sm text-[#26323d]">{v.statement_text}</p>
                          <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-[#586472]">
                            {v.changed_by_name && <span className="flex items-center gap-1"><User className="h-3 w-3" aria-hidden /> {v.changed_by_name}</span>}
                            {v.changed_at && <span className="flex items-center gap-1"><Clock className="h-3 w-3" aria-hidden /> {new Date(v.changed_at).toLocaleString()}</span>}
                            {v.change_reason && <span className="italic">&quot;{v.change_reason}&quot;</span>}
                          </div>
                          {proposeTo && rollingBack && rollingBack.versionId === v.id && (
                            <div className="mt-3 space-y-2 rounded-lg border border-[#99d5cc] bg-[#f3fbf9] p-3">
                              <label htmlFor={`statement-rollback-why-${v.id}`} className="block text-xs font-semibold text-[#26323d]">
                                Justification for this change <span className="font-normal text-[#586472]">(required: {proposeTo} reads it)</span>
                              </label>
                              <textarea id={`statement-rollback-why-${v.id}`} value={rollingBack.why} rows={2} maxLength={2000} required aria-required="true" autoFocus className={FIELD}
                                onChange={(e) => setRollingBack({ versionId: v.id, why: e.target.value })} />
                              <p className="text-[11px] text-[#0b4f46]">{goesToLine(proposeTo)}</p>
                              <div className="flex flex-wrap justify-end gap-2">
                                <button type="button" onClick={() => setRollingBack(null)} className={BTN}>Cancel</button>
                                <button type="button" disabled={rollbackMutation.isPending || !rollingBack.why.trim()} className={PRIMARY}
                                  onClick={() => rollbackMutation.mutate({ stmtId: versionHistoryStmtId, versionId: v.id, why: rollingBack.why })}>
                                  {rollbackMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />} {sendLabel(proposeTo)}
                                </button>
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
          </div>
        </div>
      )}
    </div>
  );
}
