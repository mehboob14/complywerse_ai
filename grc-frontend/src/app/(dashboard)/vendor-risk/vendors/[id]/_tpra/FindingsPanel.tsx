'use client';

// Findings & Remediation CRUD surface (stages 05 Scoring / 06 Findings).
// Lists findings with filter/sort, create/edit/soft-delete+restore, and per-finding
// remediation tasks + risk-acceptance records. RBAC-gated; optimistic concurrency
// via row_version; toasts on success/error.

import { useEffect, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Plus, Trash2, RotateCcw, ChevronDown, ChevronRight, ShieldCheck, Wrench, AlertOctagon, Loader2,
  ArrowUpRight,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { tpraApi } from '@/lib/api';
import { RightSlidePanel } from '@/components/ui';
import { useToast } from '@/components/ui/ToastProvider';
import { usePermissions } from '@/hooks/usePermissions';
import type { Finding, FindingDetail, Remediation, Acceptance } from './types';
import {
  severityBadge, fmtDate, SEVERITIES, FINDING_STATUSES, TREATMENT_TYPES, DOMAIN_LABELS, DOMAIN_KEYS,
} from './constants';
import { useUnsavedGuard } from './useUnsavedGuard';
import EvidencePanel from './EvidencePanel';

const inputCls =
  'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500';

function errMsg(e: unknown, fallback: string): string {
  const anyE = e as { response?: { data?: { detail?: string } } };
  return anyE?.response?.data?.detail || fallback;
}

export default function FindingsPanel({ assessmentId, initialFindingId }: { assessmentId: number; initialFindingId?: number | null }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { hasPermission } = usePermissions();
  const canEdit = hasPermission('vendor_risk:findings:edit') || hasPermission('erm:risks:edit');
  const canCreate = hasPermission('vendor_risk:findings:create') || canEdit;
  const canDelete = hasPermission('vendor_risk:findings:delete') || canEdit;
  const canAccept = hasPermission('vendor_risk:findings:accept_risk') || canEdit;

  const [statusFilter, setStatusFilter] = useState('');
  const [sevFilter, setSevFilter] = useState('');
  const [showRemoved, setShowRemoved] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(initialFindingId ?? null);
  // Open + scroll to a deep-linked finding once it appears in the loaded list.
  const deepLinkDone = useRef(false);

  const { data, isLoading } = useQuery({
    queryKey: ['tpra-findings', assessmentId, statusFilter, sevFilter, showRemoved],
    queryFn: async () => {
      const res = await tpraApi.listFindings(assessmentId, {
        status: statusFilter || undefined,
        severity: sevFilter || undefined,
        include_deleted: showRemoved || undefined,
      });
      return res.data as { items: Finding[]; total: number };
    },
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['tpra-findings', assessmentId] });
    qc.invalidateQueries({ queryKey: ['tpra-lifecycle'] });
  };

  const createMut = useMutation({
    mutationFn: (payload: Record<string, unknown>) => tpraApi.createFinding(assessmentId, payload),
    onSuccess: () => { invalidate(); setShowCreate(false); toast({ type: 'success', title: 'Finding added' }); },
    onError: (e) => toast({ type: 'error', title: 'Could not add finding', message: errMsg(e, 'Try again.') }),
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => tpraApi.deleteFinding(id),
    onSuccess: () => { invalidate(); toast({ type: 'success', title: 'Finding removed' }); },
    onError: (e) => toast({ type: 'error', title: 'Delete failed', message: errMsg(e, 'Try again.') }),
  });

  const restoreMut = useMutation({
    mutationFn: (id: number) => tpraApi.restoreFinding(id),
    onSuccess: () => { invalidate(); toast({ type: 'success', title: 'Finding restored' }); },
  });

  const findings = data?.items || [];

  useEffect(() => {
    if (deepLinkDone.current || initialFindingId == null) return;
    if (findings.some((f) => f.id === initialFindingId)) {
      setExpanded(initialFindingId);
      deepLinkDone.current = true;
      // Defer to after the card renders, then bring it into view.
      requestAnimationFrame(() => {
        document.getElementById(`tpra-finding-${initialFindingId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
    }
  }, [findings, initialFindingId]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <select aria-label="Filter by status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-xs">
            <option value="">All statuses</option>
            {FINDING_STATUSES.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
          </select>
          <select aria-label="Filter by severity" value={sevFilter} onChange={(e) => setSevFilter(e.target.value)}
            className="rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-xs">
            <option value="">All severities</option>
            {SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <label className="flex items-center gap-1.5 text-xs text-gray-500">
            <input type="checkbox" checked={showRemoved} onChange={(e) => setShowRemoved(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-gray-300" />
            Show removed
          </label>
        </div>
        {canCreate && (
          <button onClick={() => setShowCreate(true)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-primary-700">
            <Plus className="h-3.5 w-3.5" /> Add finding
          </button>
        )}
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 py-8 text-sm text-gray-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading findings…
        </div>
      ) : findings.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-6 text-center">
          <ShieldCheck className="mx-auto mb-2 h-6 w-6 text-emerald-500" />
          <p className="text-sm font-medium text-gray-700">No findings</p>
          <p className="text-xs text-gray-500">Run scoring to auto-raise critical-control failures, or add one manually.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {findings.map((f) => (
            <FindingCard
              key={f.id} finding={f}
              expanded={expanded === f.id}
              onToggle={() => setExpanded(expanded === f.id ? null : f.id)}
              canEdit={canEdit} canDelete={canDelete} canAccept={canAccept}
              onDelete={() => deleteMut.mutate(f.id)}
              onRestore={() => restoreMut.mutate(f.id)}
            />
          ))}
        </div>
      )}

      <CreateFindingPanel
        open={showCreate} onClose={() => setShowCreate(false)}
        onSubmit={(payload) => createMut.mutate(payload)} busy={createMut.isPending}
      />
    </div>
  );
}

function FindingCard({
  finding, expanded, onToggle, canEdit, canDelete, canAccept, onDelete, onRestore,
}: {
  finding: Finding; expanded: boolean; onToggle: () => void;
  canEdit: boolean; canDelete: boolean; canAccept: boolean;
  onDelete: () => void; onRestore: () => void;
}) {
  const qc = useQueryClient();
  const router = useRouter();
  const { toast } = useToast();
  const [showRem, setShowRem] = useState(false);
  const [showAcc, setShowAcc] = useState(false);

  const { data: detail } = useQuery({
    queryKey: ['tpra-finding', finding.id],
    queryFn: async () => (await tpraApi.getFinding(finding.id)).data as FindingDetail,
    enabled: expanded,
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['tpra-finding', finding.id] });
    qc.invalidateQueries({ queryKey: ['tpra-findings', finding.assessment_id] });
    qc.invalidateQueries({ queryKey: ['tpra-lifecycle'] });
  };

  const addRem = useMutation({
    mutationFn: (p: Record<string, unknown>) => tpraApi.createRemediation(finding.id, p),
    onSuccess: () => { refresh(); setShowRem(false); toast({ type: 'success', title: 'Remediation added' }); },
    onError: (e) => toast({ type: 'error', title: 'Failed', message: errMsg(e, 'Try again.') }),
  });
  const updRem = useMutation({
    mutationFn: ({ id, p }: { id: number; p: Record<string, unknown> }) => tpraApi.updateRemediation(id, p),
    onSuccess: refresh,
  });
  const delRem = useMutation({
    mutationFn: (id: number) => tpraApi.deleteRemediation(id), onSuccess: refresh,
  });
  const addAcc = useMutation({
    mutationFn: (p: { rationale: string; expiry?: string }) => tpraApi.createAcceptance(finding.id, p),
    onSuccess: () => { refresh(); setShowAcc(false); toast({ type: 'success', title: 'Risk accepted' }); },
    onError: (e) => toast({ type: 'error', title: 'Failed', message: errMsg(e, 'Try again.') }),
  });
  const revokeAcc = useMutation({
    mutationFn: (id: number) => tpraApi.revokeAcceptance(id), onSuccess: refresh,
  });
  const updFinding = useMutation({
    mutationFn: (p: Record<string, unknown>) => tpraApi.updateFinding(finding.id, p),
    onSuccess: refresh,
    onError: (e) => toast({ type: 'error', title: 'Update failed', message: errMsg(e, 'Reload and retry.') }),
  });
  const promoteMut = useMutation({
    mutationFn: () => tpraApi.promoteFindingToRegister(finding.id),
    onSuccess: (res) => {
      refresh();
      const riskId = (res?.data as { risk_id?: number })?.risk_id;
      toast({
        type: 'success', title: 'Moved to Risk Register',
        message: riskId ? 'Opening it so you can complete the risk details.' : 'Created a vendor-sourced risk in the ERM register.',
      });
      // Land the user on THIS risk in the ERM register to fill the required fields.
      if (riskId) router.push(`/erm/risks/list?edit=${riskId}`);
    },
    onError: (e) => toast({ type: 'error', title: 'Promote failed', message: errMsg(e, 'Try again.') }),
  });

  const isRemoved = !!finding.deleted_at;

  return (
    <div id={`tpra-finding-${finding.id}`} className={`scroll-mt-4 rounded-xl border bg-white ${isRemoved ? 'border-dashed border-gray-300 opacity-60' : 'border-gray-200'}`}>
      <div className="flex items-start gap-3 p-3">
        <button onClick={onToggle} disabled={isRemoved} aria-label={expanded ? 'Collapse' : 'Expand'}
          className="mt-0.5 text-gray-400 hover:text-gray-600 disabled:opacity-40">
          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${severityBadge(finding.severity)}`}>
              {finding.severity}
            </span>
            {finding.is_critical_control_fail && (
              <span className="inline-flex items-center gap-1 rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-700">
                <AlertOctagon className="h-3 w-3" /> critical control
              </span>
            )}
            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-600">
              {DOMAIN_LABELS[finding.domain] || finding.domain}
            </span>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">{finding.status.replace('_', ' ')}</span>
            {finding.linked_risk_id && (
              <Link href={`/erm/risks/list?edit=${finding.linked_risk_id}`}
                title="Open this risk in the ERM Risk Register"
                className="inline-flex items-center gap-1 rounded-full border border-primary-200 bg-primary-50 px-2 py-0.5 text-[11px] font-medium text-primary-700 hover:bg-primary-100">
                <ArrowUpRight className="h-3 w-3" strokeWidth={1.75} /> In Risk Register
              </Link>
            )}
            {finding.linked_issue_id && (
              <Link href={`/issues/${finding.linked_issue_id}`}
                title="Tracked as a shared Issue — unified owner / SLA / workflow"
                className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-700 hover:bg-slate-100">
                <ArrowUpRight className="h-3 w-3" strokeWidth={1.75} /> Issue #{finding.linked_issue_id}
              </Link>
            )}
          </div>
          <p className="mt-1 text-sm font-medium text-slate-900">{finding.title || 'Untitled finding'}</p>
          {finding.description && <p className="mt-0.5 text-xs text-gray-500">{finding.description}</p>}
        </div>
        <div className="flex items-center gap-1.5">
          {isRemoved ? (
            canEdit && (
              <button onClick={onRestore} className="inline-flex items-center gap-1 rounded-lg border border-gray-300 px-2 py-1 text-[11px] font-medium text-gray-600 hover:bg-gray-50">
                <RotateCcw className="h-3 w-3" /> Restore
              </button>
            )
          ) : (
            <>
              {canEdit && !finding.linked_risk_id && (
                <button onClick={() => promoteMut.mutate()} disabled={promoteMut.isPending}
                  title="Move this finding into the ERM Risk Register as a vendor-sourced risk"
                  className="inline-flex items-center gap-1 rounded-lg border border-gray-300 bg-white px-2 py-1 text-[11px] font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">
                  {promoteMut.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <ArrowUpRight className="h-3 w-3" />} To register
                </button>
              )}
              {canEdit && (
                <select aria-label="Finding status" value={finding.status}
                  onChange={(e) => updFinding.mutate({ status: e.target.value, row_version: finding.row_version })}
                  className="rounded border border-gray-300 bg-white px-1.5 py-1 text-[11px]">
                  {FINDING_STATUSES.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
                </select>
              )}
              {canDelete && (
                <button onClick={onDelete} aria-label="Delete finding" className="rounded-lg p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {expanded && (
        <div className="border-t border-gray-100 px-3 py-3">
          {/* Remediations */}
          <div className="mb-3">
            <div className="mb-1.5 flex items-center justify-between">
              <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                <Wrench className="h-3.5 w-3.5" /> Remediation
              </p>
              {canEdit && (
                <button onClick={() => setShowRem(true)} className="text-[11px] font-medium text-primary-600 hover:underline">+ Add task</button>
              )}
            </div>
            {(detail?.remediations || []).length === 0 ? (
              <p className="text-xs text-gray-400">No remediation tasks.</p>
            ) : (
              <div className="space-y-1.5">
                {detail!.remediations.map((r: Remediation) => (
                  <div key={r.id} className="flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 p-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium text-slate-800">{r.title || 'Remediation'}</p>
                      <p className="text-[11px] text-gray-500">{r.treatment_type} · due {fmtDate(r.due_date)}</p>
                    </div>
                    {canEdit ? (
                      <select aria-label="Remediation status" value={r.status}
                        onChange={(e) => updRem.mutate({ id: r.id, p: { status: e.target.value, row_version: r.row_version } })}
                        className="rounded border border-gray-300 bg-white px-1.5 py-1 text-[11px]">
                        {['open', 'in_progress', 'completed', 'overdue'].map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
                      </select>
                    ) : <span className="text-[11px] text-gray-500">{r.status}</span>}
                    {canEdit && (
                      <button onClick={() => delRem.mutate(r.id)} aria-label="Delete remediation" className="text-gray-400 hover:text-red-600">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Risk acceptances */}
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                <ShieldCheck className="h-3.5 w-3.5" /> Risk acceptance
              </p>
              {canAccept && (
                <button onClick={() => setShowAcc(true)} className="text-[11px] font-medium text-primary-600 hover:underline">+ Accept risk</button>
              )}
            </div>
            {(detail?.acceptances || []).length === 0 ? (
              <p className="text-xs text-gray-400">No risk acceptances.</p>
            ) : (
              <div className="space-y-1.5">
                {detail!.acceptances.map((a: Acceptance) => (
                  <div key={a.id} className="flex items-center gap-2 rounded-lg border border-primary-200 bg-primary-50/50 p-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs text-slate-800">{a.rationale || 'Accepted'}</p>
                      <p className="text-[11px] text-gray-500">{a.status} · expires {fmtDate(a.expiry)}</p>
                    </div>
                    {canAccept && a.status === 'active' && (
                      <button onClick={() => revokeAcc.mutate(a.id)} className="text-[11px] font-medium text-red-600 hover:underline">Revoke</button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Evidence supporting this finding (upload or link existing) */}
          <div className="mt-3 border-t border-gray-100 pt-3">
            <EvidencePanel assessmentId={finding.assessment_id} findingId={finding.id} title="Evidence" compact />
          </div>
        </div>
      )}

      <AddRemediationPanel open={showRem} onClose={() => setShowRem(false)}
        onSubmit={(p) => addRem.mutate(p)} busy={addRem.isPending} />
      <AddAcceptancePanel open={showAcc} onClose={() => setShowAcc(false)}
        onSubmit={(p) => addAcc.mutate(p)} busy={addAcc.isPending} />
    </div>
  );
}

function CreateFindingPanel({
  open, onClose, onSubmit, busy,
}: { open: boolean; onClose: () => void; onSubmit: (p: Record<string, unknown>) => void; busy: boolean }) {
  const [form, setForm] = useState({ domain: 'cybersecurity', severity: 'medium', title: '', description: '' });
  useUnsavedGuard(open && (!!form.title || !!form.description));
  return (
    <RightSlidePanel isOpen={open} onClose={onClose} title="Add finding" width="w-full max-w-lg"
      footer={
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">Cancel</button>
          <button form="tpra-finding-form" type="submit" disabled={busy}
            className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50">
            {busy ? 'Adding…' : 'Add finding'}
          </button>
        </div>
      }>
      <form id="tpra-finding-form" onSubmit={(e) => { e.preventDefault(); onSubmit(form); }} className="space-y-4">
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-700">Title</label>
          <input className={inputCls} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700">Domain</label>
            <select className={inputCls} value={form.domain} onChange={(e) => setForm({ ...form, domain: e.target.value })}>
              {DOMAIN_KEYS.map((d) => <option key={d} value={d}>{DOMAIN_LABELS[d]}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700">Severity</label>
            <select className={inputCls} value={form.severity} onChange={(e) => setForm({ ...form, severity: e.target.value })}>
              {SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-700">Description</label>
          <textarea className={inputCls} rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </div>
      </form>
    </RightSlidePanel>
  );
}

function AddRemediationPanel({
  open, onClose, onSubmit, busy,
}: { open: boolean; onClose: () => void; onSubmit: (p: Record<string, unknown>) => void; busy: boolean }) {
  const [form, setForm] = useState({ title: '', plan: '', treatment_type: 'remediate', due_date: '' });
  useUnsavedGuard(open && (!!form.title || !!form.plan));
  return (
    <RightSlidePanel isOpen={open} onClose={onClose} title="Add remediation task" width="w-full max-w-lg"
      footer={
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">Cancel</button>
          <button form="tpra-rem-form" type="submit" disabled={busy}
            className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50">
            {busy ? 'Adding…' : 'Add task'}
          </button>
        </div>
      }>
      <form id="tpra-rem-form" onSubmit={(e) => {
        e.preventDefault();
        onSubmit({ ...form, due_date: form.due_date || undefined });
      }} className="space-y-4">
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-700">Task</label>
          <input className={inputCls} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700">Treatment</label>
            <select className={inputCls} value={form.treatment_type} onChange={(e) => setForm({ ...form, treatment_type: e.target.value })}>
              {TREATMENT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700">Due date</label>
            <input type="date" className={inputCls} value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} />
          </div>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-700">Plan</label>
          <textarea className={inputCls} rows={3} value={form.plan} onChange={(e) => setForm({ ...form, plan: e.target.value })} />
        </div>
      </form>
    </RightSlidePanel>
  );
}

function AddAcceptancePanel({
  open, onClose, onSubmit, busy,
}: { open: boolean; onClose: () => void; onSubmit: (p: { rationale: string; expiry?: string }) => void; busy: boolean }) {
  const [rationale, setRationale] = useState('');
  const [expiry, setExpiry] = useState('');
  useUnsavedGuard(open && !!rationale);
  return (
    <RightSlidePanel isOpen={open} onClose={onClose} title="Accept residual risk" width="w-full max-w-lg"
      footer={
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">Cancel</button>
          <button form="tpra-acc-form" type="submit" disabled={busy || !rationale.trim()}
            className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50">
            {busy ? 'Saving…' : 'Sign off acceptance'}
          </button>
        </div>
      }>
      <form id="tpra-acc-form" onSubmit={(e) => { e.preventDefault(); onSubmit({ rationale, expiry: expiry || undefined }); }} className="space-y-4">
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-700">Rationale (recorded with your sign-off)</label>
          <textarea className={inputCls} rows={4} value={rationale} onChange={(e) => setRationale(e.target.value)} required />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-700">Expiry (optional)</label>
          <input type="date" className={inputCls} value={expiry} onChange={(e) => setExpiry(e.target.value)} />
        </div>
      </form>
    </RightSlidePanel>
  );
}
