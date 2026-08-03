'use client';

import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { policyAIApi } from '@/lib/api';
import {
  AlertTriangle,
  CheckCircle,
  Clock,
  Edit3,
  Loader2,
  Mail,
  Shield,
  XCircle,
  Sparkles,
} from 'lucide-react';

type Tab = 'inbox' | 'rules';

interface ChainStep {
  step: number;
  role?: string;
  user_id?: number;
}

interface HistoryEntry {
  step: number;
  decision: string;
  by_username?: string;
  at: string;
  comment?: string;
  via?: string;
  edited?: boolean;
}

interface Proposal {
  id: number;
  document_id: number;
  finding_id: number | null;
  clause_reference: string | null;
  clause_title: string | null;
  draft_text: string;
  edited_text: string | null;
  rationale: string | null;
  status: string;
  approver_chain: ChainStep[];
  current_step: number;
  approval_history: HistoryEntry[];
  is_blocked_by_critical: boolean;
  created_at: string;
  updated_at: string;
}

interface CriticalRule {
  id: number;
  uploaded_framework_id: number | null;
  rule_type: string;
  enabled: boolean;
  params: Record<string, any>;
  approver_chain: ChainStep[];
}

const STATUS_BADGE: Record<string, string> = {
  pending_approval: 'bg-amber-100 text-amber-800 border-amber-300',
  approved: 'bg-emerald-100 text-emerald-800 border-emerald-300',
  rejected: 'bg-rose-100 text-rose-800 border-rose-300',
  superseded: 'bg-slate-100 text-slate-700 border-slate-300',
};

function StatusBadge({ status }: { status: string }) {
  const cls = STATUS_BADGE[status] || 'bg-slate-100 text-slate-700 border-slate-300';
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${cls}`}>
      {status === 'approved' && <CheckCircle size={12} />}
      {status === 'rejected' && <XCircle size={12} />}
      {status === 'pending_approval' && <Clock size={12} />}
      {status.replace('_', ' ')}
    </span>
  );
}

function ProposalCard({ p, onSelect }: { p: Proposal; onSelect: (p: Proposal) => void }) {
  return (
    <button
      onClick={() => onSelect(p)}
      className="w-full rounded-lg border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:border-blue-400 hover:shadow"
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <Sparkles size={14} className="text-blue-500" />
            <span className="text-sm font-semibold text-slate-900">
              Clause {p.clause_reference || '—'}
            </span>
            {p.is_blocked_by_critical && (
              <span className="inline-flex items-center gap-1 rounded-full border border-rose-300 bg-rose-50 px-2 py-0.5 text-xs font-medium text-rose-700">
                <AlertTriangle size={12} /> Critical exception
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-slate-700">{p.clause_title || '(no title)'}</p>
        </div>
        <StatusBadge status={p.status} />
      </div>
      <p className="line-clamp-2 text-xs text-slate-600">{p.draft_text}</p>
      <div className="mt-2 flex items-center justify-between text-xs text-slate-500">
        <span>
          Step {p.current_step} of {p.approver_chain?.length || 1}
        </span>
        <span>{new Date(p.created_at).toLocaleString()}</span>
      </div>
    </button>
  );
}

function ProposalDetail({ p, onClose }: { p: Proposal; onClose: () => void }) {
  const qc = useQueryClient();
  const [comment, setComment] = useState('');
  const [edited, setEdited] = useState(p.edited_text || '');
  const [editMode, setEditMode] = useState(false);
  const [critJustif, setCritJustif] = useState('');

  const decideMut = useMutation({
    mutationFn: (body: { decision: 'approve' | 'reject' | 'edit'; comment?: string; edited_text?: string }) =>
      policyAIApi.decide(p.id, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['policyAI.proposals'] });
      onClose();
    },
  });

  const critMut = useMutation({
    mutationFn: (decision: 'allow' | 'deny') =>
      policyAIApi.criticalDecision(p.id, { decision, justification: critJustif }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['policyAI.proposals'] });
    },
  });

  const emailMut = useMutation({
    mutationFn: (approver_user_id: number) => policyAIApi.sendEmail(p.id, approver_user_id),
  });

  const blocked = p.is_blocked_by_critical;

  return (
    <div className="fixed inset-y-0 right-0 z-50 w-full max-w-2xl overflow-y-auto border-l border-slate-200 bg-white shadow-xl">
      <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white px-6 py-4">
        <div>
          <h3 className="text-base font-semibold text-slate-900">
            Patch · clause {p.clause_reference || '—'}
          </h3>
          <p className="text-xs text-slate-500">{p.clause_title}</p>
        </div>
        <button onClick={onClose} className="rounded p-1 text-slate-500 hover:bg-slate-100">
          ✕
        </button>
      </div>

      <div className="space-y-5 px-6 py-5">
        {blocked && (
          <div className="rounded-lg border border-rose-300 bg-rose-50 p-4">
            <div className="mb-2 flex items-center gap-2 font-medium text-rose-800">
              <AlertTriangle size={16} /> Critical exception — Allow or Deny required
            </div>
            <textarea
              value={critJustif}
              onChange={(e) => setCritJustif(e.target.value)}
              placeholder="Justification (required, ≥5 chars)"
              className="mb-2 h-20 w-full rounded border border-rose-200 bg-white p-2 text-sm text-slate-900"
            />
            <div className="flex gap-2">
              <button
                onClick={() => critMut.mutate('allow')}
                disabled={critJustif.trim().length < 5 || critMut.isPending}
                className="flex items-center gap-1 rounded bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
              >
                <CheckCircle size={14} /> Allow
              </button>
              <button
                onClick={() => critMut.mutate('deny')}
                disabled={critJustif.trim().length < 5 || critMut.isPending}
                className="flex items-center gap-1 rounded bg-rose-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
              >
                <XCircle size={14} /> Deny
              </button>
            </div>
          </div>
        )}

        <div>
          <h4 className="mb-2 text-sm font-semibold text-slate-800">AI-drafted clause</h4>
          {editMode ? (
            <textarea
              value={edited}
              onChange={(e) => setEdited(e.target.value)}
              className="h-48 w-full rounded border border-slate-300 p-3 text-sm text-slate-900"
            />
          ) : (
            <pre className="whitespace-pre-wrap rounded border border-slate-200 bg-slate-50 p-3 text-sm text-slate-800">
              {p.edited_text || p.draft_text}
            </pre>
          )}
          <button
            onClick={() => {
              setEditMode((v) => !v);
              if (!editMode) setEdited(p.edited_text || p.draft_text);
            }}
            className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:underline"
          >
            <Edit3 size={12} /> {editMode ? 'Cancel edit' : 'Edit before approve'}
          </button>
        </div>

        {p.rationale && (
          <div>
            <h4 className="mb-1 text-sm font-semibold text-slate-800">Why this clause</h4>
            <p className="text-sm text-slate-700">{p.rationale}</p>
          </div>
        )}

        <div>
          <h4 className="mb-2 text-sm font-semibold text-slate-800">Approver chain</h4>
          <ol className="space-y-1 text-sm">
            {(p.approver_chain || []).map((step, i) => (
              <li
                key={i}
                className={`flex items-center gap-2 rounded px-2 py-1 ${
                  step.step === p.current_step && p.status === 'pending_approval'
                    ? 'bg-blue-50 font-medium text-blue-800'
                    : 'text-slate-700'
                }`}
              >
                <span>Step {step.step}:</span>
                <span>{step.role || (step.user_id ? `User #${step.user_id}` : 'Approver')}</span>
              </li>
            ))}
          </ol>
        </div>

        {(p.approval_history || []).length > 0 && (
          <div>
            <h4 className="mb-2 text-sm font-semibold text-slate-800">History</h4>
            <ul className="space-y-1 text-xs text-slate-600">
              {p.approval_history.map((h, i) => (
                <li key={i}>
                  Step {h.step}: <b>{h.decision}</b> by {h.by_username || 'system'}
                  {h.via === 'email' && ' (via email)'} —{' '}
                  {new Date(h.at).toLocaleString()}
                  {h.comment && ` — “${h.comment}”`}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div>
          <label className="mb-1 block text-sm font-medium text-slate-800">Comment (optional)</label>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            className="h-16 w-full rounded border border-slate-300 p-2 text-sm text-slate-900"
          />
        </div>

        <div className="flex flex-wrap gap-2 pt-2">
          <button
            disabled={blocked || decideMut.isPending}
            onClick={() =>
              decideMut.mutate({
                decision: editMode ? 'edit' : 'approve',
                comment,
                edited_text: editMode ? edited : undefined,
              })
            }
            className="flex items-center gap-1 rounded bg-emerald-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {decideMut.isPending ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle size={14} />}
            {editMode ? 'Save & approve' : 'Approve'}
          </button>
          <button
            disabled={blocked || decideMut.isPending}
            onClick={() => decideMut.mutate({ decision: 'reject', comment })}
            className="flex items-center gap-1 rounded bg-rose-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            <XCircle size={14} /> Reject
          </button>
          <button
            onClick={() => {
              const id = window.prompt('Approver user id?');
              if (id && /^\d+$/.test(id)) emailMut.mutate(parseInt(id, 10));
            }}
            disabled={blocked || emailMut.isPending}
            className="flex items-center gap-1 rounded border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            <Mail size={14} /> Send email link
          </button>
        </div>
        {emailMut.data && (
          <p className="text-xs text-emerald-700">Email queued to {emailMut.data.approver_email}.</p>
        )}
        {decideMut.error && (
          <p className="text-sm text-rose-600">
            {(decideMut.error as any)?.response?.data?.detail || 'Decision failed'}
          </p>
        )}
        {critMut.error && (
          <p className="text-sm text-rose-600">
            {(critMut.error as any)?.response?.data?.detail || 'Critical decision failed'}
          </p>
        )}
      </div>
    </div>
  );
}

function CriticalRulesTab() {
  const qc = useQueryClient();
  const { data: rules, isLoading } = useQuery<CriticalRule[]>({
    queryKey: ['policyAI.criticalRules'],
    queryFn: async () => (await policyAIApi.listCriticalRules()).data,
  });
  const updateMut = useMutation({
    mutationFn: ({ id, body }: { id: number; body: any }) => policyAIApi.updateCriticalRule(id, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['policyAI.criticalRules'] }),
  });

  if (isLoading) return <Loader2 className="mx-auto mt-12 animate-spin text-slate-400" />;
  if (!rules || rules.length === 0) {
    return (
      <p className="mt-8 text-center text-sm text-slate-500">
        No rules yet. Run gap analysis on a policy to seed defaults, or pass a framework id below.
      </p>
    );
  }
  return (
    <div className="space-y-3">
      {rules.map((r) => (
        <div key={r.id} className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2">
                <Shield size={14} className="text-slate-500" />
                <span className="font-medium text-slate-900">{r.rule_type.replace('_', ' ')}</span>
              </div>
              <p className="mt-1 text-xs text-slate-500">
                Framework: {r.uploaded_framework_id ?? 'global'} · params:{' '}
                <code>{JSON.stringify(r.params)}</code>
              </p>
            </div>
            <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={r.enabled}
                onChange={(e) => updateMut.mutate({ id: r.id, body: { enabled: e.target.checked } })}
              />
              Enabled
            </label>
          </div>
          <div className="mt-3 text-xs text-slate-600">
            <span className="mr-2 font-medium">Approver chain:</span>
            {(r.approver_chain || []).length === 0 ? (
              <span className="italic text-slate-400">default (single Approver)</span>
            ) : (
              (r.approver_chain || []).map((s, i) => (
                <span key={i} className="mr-2">
                  {s.step}. {s.role || `user#${s.user_id}`}
                </span>
              ))
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function PolicyAIPage() {
  const [tab, setTab] = useState<Tab>('inbox');
  const [statusFilter, setStatusFilter] = useState<string>('pending_approval');
  const [selected, setSelected] = useState<Proposal | null>(null);

  const { data: proposals, isLoading } = useQuery<Proposal[]>({
    queryKey: ['policyAI.proposals', statusFilter],
    queryFn: async () =>
      (await policyAIApi.listProposals(statusFilter === 'all' ? undefined : { status: statusFilter })).data,
  });

  const counts = useMemo(() => {
    const c = { pending_approval: 0, approved: 0, rejected: 0, blocked: 0 };
    (proposals || []).forEach((p) => {
      c[p.status as keyof typeof c] = (c[p.status as keyof typeof c] || 0) + 1;
      if (p.is_blocked_by_critical) c.blocked += 1;
    });
    return c;
  }, [proposals]);

  return (
    <div className="mx-auto max-w-6xl p-6">
      <header className="mb-6">
        <h1 className="flex items-center gap-2 text-2xl font-semibold text-slate-900">
          <Sparkles className="text-blue-500" /> Policy AI — HITL Approvals
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Review AI-drafted policy patches, configure critical-exception gates, and audit decisions.
        </p>
      </header>

      <nav className="mb-4 flex gap-2 border-b border-slate-200">
        {(['inbox', 'rules'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-2 text-sm font-medium ${
              tab === t
                ? 'border-b-2 border-blue-600 text-blue-700'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            {t === 'inbox' ? 'Patch Inbox' : 'Critical Rules'}
          </button>
        ))}
      </nav>

      {tab === 'inbox' && (
        <>
          <div className="mb-3 flex items-center gap-2">
            {(['pending_approval', 'approved', 'rejected', 'all'] as const).map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`rounded-full px-3 py-1 text-xs font-medium ${
                  statusFilter === s
                    ? 'bg-blue-600 text-white'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                {s.replace('_', ' ')}
                {s !== 'all' && counts[s as keyof typeof counts] !== undefined && (
                  <span className="ml-1 opacity-75">({counts[s as keyof typeof counts]})</span>
                )}
              </button>
            ))}
            {counts.blocked > 0 && (
              <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-rose-50 px-2 py-1 text-xs text-rose-700">
                <AlertTriangle size={12} /> {counts.blocked} blocked by critical
              </span>
            )}
          </div>
          {isLoading && <Loader2 className="mx-auto mt-12 animate-spin text-slate-400" />}
          {!isLoading && (proposals || []).length === 0 && (
            <p className="mt-8 text-center text-sm text-slate-500">No proposals match this filter.</p>
          )}
          <div className="space-y-2">
            {(proposals || []).map((p) => (
              <ProposalCard key={p.id} p={p} onSelect={setSelected} />
            ))}
          </div>
        </>
      )}

      {tab === 'rules' && <CriticalRulesTab />}

      {selected && <ProposalDetail p={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
