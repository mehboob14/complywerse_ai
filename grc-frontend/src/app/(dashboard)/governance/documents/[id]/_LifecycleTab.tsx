'use client';

// The document's "Approvals & Acknowledgements" tab: the approval chain (sign-off), who is being waited on, who has
// acknowledged, the lifecycle timeline and the discussion, in one place. Backend: governance/doc_lifecycle.py.
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import apiClient from '@/lib/api';
import { parseUtc } from '@/lib/serverTime';
import { useToast } from '@/components/ui/ToastProvider';
import SignaturePad from '@/components/governance/SignaturePad';
import DocumentAnnotationPanel from '@/components/evidence/DocumentAnnotationPanel';
import { SignOffControlTab } from '../_SignoffControl';

interface Row {
  id: number; kind: 'review' | 'approval' | 'acknowledgement'; user_id: number; user: string | null;
  status: 'pending' | 'done' | 'rejected' | 'cancelled'; version: string | null; requested_at: string | null;
  due_date: string | null; done_at: string | null; comment: string | null; overdue: boolean; escalation_level: number;
}
interface LifecycleSettings { approval_days: number; ack_days: number; remind_days: number; admin_after_days: number; email: boolean }
interface TimelineEvent { at: string | null; kind: string; actor: string | null; detail: string | null }
interface Lifecycle {
  enabled: boolean;
  document: { id: number; title: string; status: string; version: string; owner: string | null; author: string | null };
  approvals: Row[];
  acknowledgements: { total: number; done: number; pending: number; overdue: number; percent: number; people: Row[] };
  mine: Row[];
  timeline: TimelineEvent[];
}

const KIND = { review: 'Review', approval: 'Approval', acknowledgement: 'Acknowledgement' } as const;
const EVENT_LABEL: Record<string, string> = {
  sent_for_review: 'Sent for review', sent_for_approval: 'Sent for approval', signed: 'Signed', rejected: 'Rejected', published: 'Published',
  acknowledged: 'Acknowledged', escalated: 'Escalated', status_changed: 'Status changed', version_created: 'New version',
  statements_written_to_document: 'Statements written to the document', review_requested: 'Review requested',
  approval_requested: 'Approval requested', acknowledgement_requested: 'Acknowledgement requested', file_uploaded: 'File uploaded',
};

const day = (v: string | null) => parseUtc(v)?.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) ?? '-';
const dateTime = (v: string | null) => parseUtc(v)?.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) ?? '-';

function StatusPill({ row }: { row: Row }) {
  const tone = row.status === 'done' ? 'border-emerald-300 text-emerald-800'
    : row.status === 'rejected' ? 'border-rose-300 text-rose-800'
    : row.status === 'cancelled' ? 'border-slate-300 text-slate-600'
    : row.overdue ? 'border-rose-300 text-rose-800' : 'border-amber-300 text-amber-900';
  const label = row.status === 'pending' ? (row.overdue ? 'Overdue' : 'Waiting') : row.status === 'done' ? 'Done' : row.status === 'rejected' ? 'Rejected' : 'Not needed';
  return <span className={`inline-block rounded border px-1.5 py-0.5 text-[11px] ${tone}`}>{label}{row.escalation_level > 0 && row.status === 'pending' ? ` · escalated ${row.escalation_level}` : ''}</span>;
}

function SettingsCard() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<LifecycleSettings | null>(null);
  const { data } = useQuery<{ enabled: boolean; settings: LifecycleSettings; can_edit: boolean }>({
    queryKey: ['document-lifecycle-settings'],
    queryFn: async () => (await apiClient.get('/governance/documents/lifecycle/settings')).data,
  });
  const save = useMutation({
    mutationFn: async () => (await apiClient.put('/governance/documents/lifecycle/settings', draft)).data,
    onSuccess: () => { setOpen(false); queryClient.invalidateQueries({ queryKey: ['document-lifecycle-settings'] }); toast({ type: 'success', title: 'Saved', message: 'New requests use these settings.' }); },
    onError: (e: any) => toast({ type: 'error', title: 'Not saved', message: e?.response?.data?.detail || 'Could not save the settings.' }),
  });
  if (!data?.enabled) return null;
  const s = draft || data.settings;
  const field = (key: keyof LifecycleSettings, label: string) => (
    <label className="flex items-center justify-between gap-3 text-xs text-slate-700">
      {label}
      <input type="number" min={key === 'remind_days' ? 0 : 1} max={key === 'remind_days' ? 60 : 365} value={s[key] as number} disabled={!data.can_edit}
        onChange={(e) => setDraft({ ...s, [key]: Number(e.target.value) })}
        className="w-20 rounded border border-slate-300 bg-white px-2 py-1 text-right text-slate-900 disabled:bg-slate-100" />
    </label>
  );
  return (
    <section className="rounded-xl border border-slate-300 bg-white p-4">
      <button type="button" onClick={() => setOpen(!open)} className="text-sm font-semibold text-slate-900">
        Due dates and escalation {open ? '▾' : '▸'}
      </button>
      {!open && <span className="ml-3 text-xs text-slate-600">approvals {data.settings.approval_days} days · acknowledgements {data.settings.ack_days} days · owner told when overdue, administrators after {data.settings.admin_after_days} more</span>}
      {open && (
        <div className="mt-3 max-w-md space-y-2">
          {field('approval_days', 'Days to review or approve')}
          {field('ack_days', 'Days to acknowledge')}
          {field('remind_days', 'Remind this many days before the due date')}
          {field('admin_after_days', 'Tell tenant administrators this many days after it is overdue')}
          <label className="flex items-center gap-2 text-xs text-slate-700">
            <input type="checkbox" checked={s.email} disabled={!data.can_edit} onChange={(e) => setDraft({ ...s, email: e.target.checked })} /> Also send email (where email is set up)
          </label>
          {data.can_edit
            ? <button type="button" onClick={() => save.mutate()} disabled={save.isPending || !draft} className="rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-primary-700 disabled:opacity-50">Save</button>
            : <p className="text-xs text-slate-500">Only an administrator can change these.</p>}
        </div>
      )}
    </section>
  );
}

export default function LifecycleTab({ documentId, doc }: { documentId: number; doc: any }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const base = `/governance/documents/${documentId}/lifecycle`;
  const [ackComment, setAckComment] = useState('');
  const [ackSignature, setAckSignature] = useState<string | null>(null);
  const [showAck, setShowAck] = useState(false);
  const [onlyPending, setOnlyPending] = useState(true);

  const { data, isLoading } = useQuery<Lifecycle>({
    queryKey: ['document-lifecycle', String(documentId)],
    queryFn: async () => (await apiClient.get(base)).data,
    refetchInterval: 10000,
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['document-lifecycle'] });

  const acknowledge = useMutation({
    mutationFn: async () => (await apiClient.post(`${base}/acknowledge`, { comment: ackComment.trim() || null, signature_image: ackSignature })).data,
    onSuccess: () => { setShowAck(false); setAckComment(''); setAckSignature(null); refresh(); toast({ type: 'success', title: 'Acknowledged', message: 'Your acknowledgement was recorded.' }); },
    onError: (e: any) => toast({ type: 'error', title: 'Not acknowledged', message: e?.response?.data?.detail || 'Could not record the acknowledgement.' }),
  });
  const remind = useMutation({
    mutationFn: async () => (await apiClient.post(`${base}/remind`)).data,
    onSuccess: (r: any) => toast({ type: 'success', title: 'Reminders sent', message: `${r.reminded} ${r.reminded === 1 ? 'person was' : 'people were'} alerted.` }),
    onError: () => toast({ type: 'error', title: 'Reminders failed', message: 'Could not send the reminders.' }),
  });

  if (isLoading || !data) return <div className="flex h-40 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-primary-400" /></div>;
  const acks = data.acknowledgements;
  const myAck = data.mine.find((r) => r.kind === 'acknowledgement');
  const waiting = data.approvals.filter((r) => r.status === 'pending');
  const people = onlyPending ? acks.people.filter((p) => p.status === 'pending') : acks.people;

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-slate-300 bg-white p-4">
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className="font-semibold text-slate-900">Where this document stands</span>
          <span className="rounded border border-slate-300 px-1.5 py-0.5 text-xs text-slate-700">{data.document.status.replace('_', ' ')}</span>
          <span className="text-xs text-slate-600">version {data.document.version} · owner {data.document.owner || '-'}</span>
          {waiting.length > 0 && <span className="text-xs text-amber-900">Waiting for: {waiting.map((r) => r.user).join(', ')}</span>}
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-slate-900">Approval chain</h3>
        <SignOffControlTab documentId={documentId} doc={doc} />
        {data.approvals.length > 0 && (
          <div className="overflow-x-auto rounded-xl border border-slate-300 bg-white">
            <table className="w-full text-left text-xs">
              <thead className="text-slate-600"><tr><th className="p-2">Person</th><th className="p-2">Step</th><th className="p-2">Version</th><th className="p-2">Status</th><th className="p-2">Due</th><th className="p-2">Done</th><th className="p-2">Comment</th></tr></thead>
              <tbody>
                {data.approvals.map((r) => (
                  <tr key={r.id} className="border-t border-slate-200">
                    <td className="p-2 text-slate-900">{r.user}</td><td className="p-2">{KIND[r.kind]}</td><td className="p-2">{r.version}</td>
                    <td className="p-2"><StatusPill row={r} /></td><td className="p-2">{day(r.due_date)}</td><td className="p-2">{dateTime(r.done_at)}</td>
                    <td className="p-2 text-slate-600">{r.comment || ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <h3 className="text-sm font-semibold text-slate-900">Acknowledgements</h3>
          {acks.total > 0 && <span className="text-xs text-slate-600">{acks.done} of {acks.total} users ({acks.percent}%){acks.overdue > 0 ? ` · ${acks.overdue} overdue` : ''}</span>}
          {acks.pending > 0 && (
            <button type="button" onClick={() => remind.mutate()} disabled={remind.isPending}
              className="ml-auto rounded-lg border border-slate-300 px-3 py-1 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50">Remind everyone waiting</button>
          )}
        </div>
        {data.document.status !== 'published' && acks.total === 0 && (
          <p className="text-xs text-slate-600">Every active user is asked to acknowledge the document once it is published.</p>
        )}
        {acks.total > 0 && <div className="h-2 w-full overflow-hidden rounded bg-slate-200"><div className="h-2 bg-emerald-500" style={{ width: `${acks.percent}%` }} /></div>}
        {myAck && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm">
            <p className="text-amber-900">You are asked to acknowledge this document by {day(myAck.due_date)}.</p>
            {!showAck ? (
              <button type="button" onClick={() => setShowAck(true)} className="mt-2 rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-primary-700">Acknowledge</button>
            ) : (
              <div className="mt-2 space-y-2">
                <input value={ackComment} onChange={(e) => setAckComment(e.target.value)} placeholder="Comment (optional)"
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-900 focus:border-primary-500 focus:outline-none" />
                <p className="text-xs text-slate-600">Draw your signature if you want it kept with the acknowledgement (optional).</p>
                <SignaturePad onChange={setAckSignature} />
                <div className="flex gap-2">
                  <button type="button" onClick={() => acknowledge.mutate()} disabled={acknowledge.isPending}
                    className="inline-flex items-center gap-1 rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-primary-700 disabled:opacity-50">
                    {acknowledge.isPending && <Loader2 className="h-3 w-3 animate-spin" />} I have read and acknowledge this document
                  </button>
                  <button type="button" onClick={() => setShowAck(false)} className="rounded-lg px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-100">Cancel</button>
                </div>
              </div>
            )}
          </div>
        )}
        {acks.total > 0 && (
          <div className="rounded-xl border border-slate-300 bg-white">
            <label className="flex items-center gap-2 p-2 text-xs text-slate-700">
              <input type="checkbox" checked={onlyPending} onChange={(e) => setOnlyPending(e.target.checked)} /> Show only people who have not acknowledged
            </label>
            <div className="max-h-80 overflow-auto">
              <table className="w-full text-left text-xs">
                <thead className="text-slate-600"><tr><th className="p-2">Person</th><th className="p-2">Status</th><th className="p-2">Due</th><th className="p-2">Acknowledged</th></tr></thead>
                <tbody>
                  {people.map((p) => (
                    <tr key={p.id} className="border-t border-slate-200">
                      <td className="p-2 text-slate-900">{p.user}</td><td className="p-2"><StatusPill row={p} /></td><td className="p-2">{day(p.due_date)}</td><td className="p-2">{dateTime(p.done_at)}</td>
                    </tr>
                  ))}
                  {people.length === 0 && <tr><td className="p-3 text-slate-600" colSpan={4}>Everyone has acknowledged.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-slate-900">Life cycle</h3>
        <ol className="space-y-2 rounded-xl border border-slate-300 bg-white p-4">
          {data.timeline.length === 0 && <li className="text-xs text-slate-600">Nothing has happened to this document yet.</li>}
          {data.timeline.map((e, i) => (
            <li key={i} className="flex gap-3 text-xs">
              <span className="w-32 shrink-0 text-slate-500">{dateTime(e.at)}</span>
              <span className="w-44 shrink-0 font-medium text-slate-800">{EVENT_LABEL[e.kind] || e.kind.replace(/_/g, ' ')}</span>
              <span className="text-slate-700">{e.actor ? `${e.actor}: ` : ''}{e.detail || ''}</span>
            </li>
          ))}
        </ol>
      </section>

      <SettingsCard />

      <section className="rounded-xl border border-slate-300 bg-white p-4">
        <h3 className="mb-1 text-sm font-semibold text-slate-900">Discussion</h3>
        <p className="mb-3 text-xs text-slate-500">Everyone involved (preparer, reviewers, approvers) can comment here.</p>
        <DocumentAnnotationPanel documentId={documentId} />
      </section>
    </div>
  );
}
