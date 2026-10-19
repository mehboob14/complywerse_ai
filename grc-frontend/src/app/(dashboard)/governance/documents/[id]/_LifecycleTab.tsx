'use client';

// The document's "Approvals & Acknowledgements" tab (organisations with the document life cycle): where the document stands
// (its stages), what the person reading is asked to do — sign, or acknowledge — first, then each reviewer and approver with
// where they are, who reviews and approves (and sending it), who has acknowledged which version (with their drawn signature), the life cycle, the due-date settings and
// the discussion. Backend: governance/doc_lifecycle.py (requests, acknowledgements, timeline) and routers/document_signoff.py
// (participants and signatures).
import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, Check, ChevronRight, Clock, FileCheck2, Loader2, Search } from 'lucide-react';
import apiClient from '@/lib/api';
import { dateTime, day, eventLabel, type DocumentLifecycle as Lifecycle, type LifecycleRow as Row } from '@/lib/documentLifecycle';
import { noAccess, retrySettings, type SettingsAnswer } from '@/lib/governanceSettings';
import { useToast } from '@/components/ui/ToastProvider';
import SignaturePad from '@/components/governance/SignaturePad';
import SignatureSeal from '@/components/governance/SignatureSeal';
import DocumentAnnotationPanel from '@/components/evidence/DocumentAnnotationPanel';
import { SIGNOFF_STATUS, SignoffAction, SignoffParticipants, StatusChip, useSignoff, type Signoff } from '../_SignoffControl';

/** a row's own drawn signature (servers from before it was sent leave the field out) */
type Esign = { id: number; image_sha256?: string | null } | null;
const ownEsign = (r: Row): Esign | undefined => ('esign' in r ? (r as Row & { esign: Esign }).esign : undefined);

// ── small pieces ─────────────────────────────────────────────────────────────
const initials = (name: string | null) =>
  (name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '?';

function Avatar({ name }: { name: string | null }) {
  return (
    <span aria-hidden className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary-50 text-xs font-semibold text-primary-800">
      {initials(name)}
    </span>
  );
}

const You = () => <span className="ml-1.5 rounded bg-primary-50 px-1 py-px text-[10px] font-semibold uppercase tracking-wide text-primary-800">you</span>;

type Tone = 'waiting' | 'overdue' | 'done' | 'rejected' | 'none';
const TONE: Record<Tone, string> = {
  waiting: 'border-amber-300 bg-amber-50 text-amber-900',
  overdue: 'border-rose-300 bg-rose-50 text-rose-800',
  done: 'border-emerald-300 bg-emerald-50 text-emerald-800',
  rejected: 'border-rose-300 bg-rose-50 text-rose-800',
  none: 'border-gray-300 bg-white text-gray-600',
};
const toneOf = (r: Row): Tone =>
  r.status === 'done' ? 'done' : r.status === 'rejected' ? 'rejected' : r.status === 'cancelled' ? 'none' : r.overdue ? 'overdue' : 'waiting';

function Badge({ row, doneLabel }: { row: Row; doneLabel: string }) {
  const t = toneOf(row);
  const label = { done: doneLabel, rejected: 'Rejected', none: 'Not needed', overdue: 'Overdue', waiting: 'Waiting' }[t];
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${TONE[t]}`}>
      {label}{row.escalation_level > 0 && row.status === 'pending' ? ' · escalated' : ''}
    </span>
  );
}

// ── where it stands ──────────────────────────────────────────────────────────
const RANK: Record<string, number> = { draft: 0, pending_review: 1, pending_approval: 2, approved: 3, published: 4, expired: 4, archived: 4 };

function Stages({ status, signoff, acks }: { status: string; signoff?: Signoff; acks: Lifecycle['acknowledgements'] }) {
  const rank = RANK[status] ?? 0;
  const p = signoff?.progress || {};
  const count = (x?: { signed: number; required: number }) => (x && x.required > 0 ? `${x.signed}/${x.required}` : rank > 0 ? 'none' : '');
  const steps = [
    { label: 'Draft', note: '', done: rank > 0, current: rank === 0 },
    { label: 'Review', note: count(p.reviewer), done: rank > 1, current: rank === 1 },
    { label: 'Approval', note: count(p.approver), done: rank > 2, current: rank === 2 },
    { label: 'Published', note: '', done: rank >= 4, current: rank === 3 },
    { label: 'Acknowledged', note: acks.total ? `${acks.done}/${acks.total}` : '', done: rank >= 4 && acks.total > 0 && acks.pending === 0, current: rank >= 4 && acks.pending > 0 },
  ];
  return (
    <ol className="mt-4 flex flex-wrap items-center gap-y-3" aria-label="Stages">
      {steps.map((s, i) => (
        <li key={s.label} className="mr-4 flex min-w-0 items-center sm:mr-0">
          <span className="flex items-center gap-2" aria-current={s.current ? 'step' : undefined}>
            <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
              s.done ? 'bg-primary-600 text-white' : s.current ? 'border-2 border-primary-600 bg-white text-primary-700' : 'border border-gray-300 bg-white text-gray-500'}`}>
              {s.done ? <Check className="h-4 w-4" aria-label="done" /> : i + 1}
            </span>
            <span className="leading-tight">
              <span className={`block text-xs ${s.current ? 'font-semibold text-gray-900' : s.done ? 'font-medium text-gray-800' : 'text-gray-500'}`}>{s.label}</span>
              {s.note && <span className="block text-[11px] text-gray-500">{s.note}</span>}
            </span>
          </span>
          {i < steps.length - 1 && <span aria-hidden className={`mx-3 hidden h-px w-8 sm:inline-block md:w-12 ${s.done ? 'bg-primary-500' : 'bg-gray-300'}`} />}
        </li>
      ))}
    </ol>
  );
}

// ── the person's own acknowledgement ─────────────────────────────────────────
export function AckAction({ base, row, onDone, open: startOpen = false, version, onCancel }: {
  base: string; row: Row; onDone: () => void; open?: boolean; version?: string;
  /** a popup that opened it closes on Cancel */
  onCancel?: () => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(startOpen);
  const [comment, setComment] = useState('');
  const [signature, setSignature] = useState<string | null>(null);
  const acknowledge = useMutation({
    mutationFn: async () => (await apiClient.post(`${base}/acknowledge`, { comment: comment.trim() || null, signature_image: signature, version })).data,
    // the toast first: onDone closes the popup this form is in
    onSuccess: () => {
      toast({ type: 'success', title: 'Acknowledged', message: `You acknowledged${version ? ` version ${version}` : ' it'}; it is recorded with the document.` });
      queryClient.invalidateQueries({ queryKey: ['my-document-requests'] });     // the top bar's and My Approvals' "waiting for you"
      setOpen(false); setComment(''); setSignature(null); onDone();
    },
    onError: (e: any) => toast({ type: 'error', title: 'Not acknowledged', message: e?.response?.data?.detail || 'Could not record the acknowledgement.' }),
  });
  return (
    <section className="rounded-xl border-2 border-primary-300 bg-white p-4 shadow-sm" aria-label="Your acknowledgement">
      <div className="flex flex-wrap items-start gap-3">
        <span className="rounded-full bg-primary-50 p-2"><FileCheck2 className="h-5 w-5 text-primary-700" /></span>
        <div className="min-w-[14rem] flex-1">
          <h3 className="text-sm font-semibold text-gray-900">Please read and acknowledge this document{row.due_date ? ` by ${day(row.due_date)}` : ''}</h3>
          <p className="text-xs text-gray-600">Read it first. Acknowledging records that you have read it and will follow it.</p>
        </div>
        {!open && (
          <button type="button" onClick={() => setOpen(true)} className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700">Acknowledge</button>
        )}
      </div>
      {open && (
        <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_18rem]">
          <div>
            <p className="mb-1 text-xs text-gray-600">Your signature (optional): draw it to keep it with your acknowledgement.</p>
            <SignaturePad onChange={setSignature} height={110} />
          </div>
          <div className="flex flex-col gap-2">
            <textarea value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Comment (optional)" rows={3}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none" />
            <button type="button" onClick={() => acknowledge.mutate()} disabled={acknowledge.isPending}
              className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50">
              {acknowledge.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} I have read it and acknowledge it
            </button>
            <button type="button" onClick={() => (onCancel ? onCancel() : setOpen(false))} className="rounded-lg px-4 py-2 text-sm text-gray-700 hover:bg-gray-100">Cancel</button>
          </div>
        </div>
      )}
    </section>
  );
}

// ── each reviewer and approver ───────────────────────────────────────────────
const STEPS = [
  { kind: 'review', title: 'Review', role: 'reviewer', doneLabel: 'Reviewed' },
  { kind: 'approval', title: 'Approval', role: 'approver', doneLabel: 'Approved' },
] as const;

function ReviewAndApproval({ rows, signoff, meId }: { rows: Row[]; signoff?: Signoff; meId?: number }) {
  if (!rows.length) return null;
  const signatures = signoff?.signatures || [];
  const prepared = (signoff?.participants?.prepared_by || []).map((p) => p.display).filter(Boolean).join(', ');
  const manyVersions = new Set(rows.map((r) => r.version)).size > 1;
  return (
    <section className="rounded-xl border border-gray-200 bg-white">
      <div className="flex flex-wrap items-baseline gap-x-2 border-b border-gray-200 px-4 py-3">
        <h3 className="text-sm font-semibold text-gray-900">Review and approval</h3>
        {prepared && <span className="text-xs text-gray-600">prepared by {prepared}</span>}
      </div>
      {STEPS.map((step) => {
        const list = rows.filter((r) => r.kind === step.kind);
        if (!list.length) return null;
        return (
          <div key={step.kind} className="px-4 py-3">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500">{step.title}</p>
            <ul className="space-y-3">
              {list.map((r) => {
                // the row's own signature (each round is its own row); a server without it: this person's latest in the role
                const own = ownEsign(r);
                const sig = own !== undefined ? own : [...signatures].reverse().find((s) => s.signer_user_id === r.user_id && s.role_type === step.role)?.esign;
                return (
                  <li key={r.id} className="flex items-start gap-3">
                    <Avatar name={r.user} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium text-gray-900">{r.user || 'Someone'}{r.user_id === meId && <You />}</span>
                        <Badge row={r} doneLabel={step.doneLabel} />
                        {manyVersions && r.version && <span className="text-[11px] text-gray-500">version {r.version}</span>}
                      </div>
                      <p className="mt-0.5 text-xs text-gray-600">
                        {r.status === 'pending' ? `Due ${day(r.due_date)}` : r.status === 'done' && r.done_at ? `${step.doneLabel} ${dateTime(r.done_at)}`
                          : r.status === 'rejected' && r.done_at ? `Rejected ${dateTime(r.done_at)}` : ''}
                      </p>
                      {r.comment && <p className="mt-0.5 text-xs italic text-gray-700">“{r.comment}”</p>}
                      {r.status === 'done' && sig && <SignatureSeal id={sig.id} fingerprint={sig.image_sha256 ?? ''} />}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </section>
  );
}

// ── acknowledgements ─────────────────────────────────────────────────────────
type Filter = 'waiting' | 'overdue' | 'done' | 'all';

function Acknowledgements({ data, meId, base, canRemind = true }: { data: Lifecycle; meId?: number; base: string; canRemind?: boolean }) {
  const { toast } = useToast();
  const acks = data.acknowledgements;
  const [filter, setFilter] = useState<Filter>(acks.pending > 0 ? 'waiting' : 'all');
  const [q, setQ] = useState('');
  const remind = useMutation({
    mutationFn: async () => (await apiClient.post(`${base}/remind`)).data,
    onSuccess: (r: any) => toast({ type: 'success', title: 'Reminders sent', message: `${r.reminded} ${r.reminded === 1 ? 'person was' : 'people were'} reminded.` }),
    onError: () => toast({ type: 'error', title: 'Reminders failed', message: 'Could not send the reminders.' }),
  });
  const matches = (p: Row) =>
    (filter === 'all' || (filter === 'done' ? p.status === 'done' : filter === 'overdue' ? p.status === 'pending' && p.overdue : p.status === 'pending'))
    && (!q.trim() || (p.user || '').toLowerCase().includes(q.trim().toLowerCase()));
  const people = acks.people.filter(matches);
  // what each person acknowledged before their newest row (a major version asks again; the earlier ones and their seals stay shown)
  const earlier = new Map<number, Row[]>();
  for (const r of acks.history ?? []) earlier.set(r.user_id, [...(earlier.get(r.user_id) ?? []), r]);
  const FILTERS: [Filter, string][] = [['waiting', `Waiting · ${acks.pending}`], ['overdue', `Overdue · ${acks.overdue}`], ['done', `Acknowledged · ${acks.done}`], ['all', 'Everyone']];
  const empty = { waiting: 'Nobody is waiting: everyone has acknowledged.', overdue: 'Nobody is overdue.', done: 'Nobody has acknowledged yet.', all: 'Nobody matches.' }[filter];

  return (
    <section className="rounded-xl border border-gray-200 bg-white">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-gray-200 px-4 py-3">
        <h3 className="text-sm font-semibold text-gray-900">Acknowledgements</h3>
        {acks.total > 0 && <span className="text-xs text-gray-600">{acks.done} of {acks.total} people ({acks.percent}%)</span>}
        {acks.pending > 0 && canRemind && (
          <button type="button" onClick={() => remind.mutate()} disabled={remind.isPending}
            className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50">
            {remind.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Bell className="h-3.5 w-3.5" />} Remind everyone waiting
          </button>
        )}
      </div>
      {acks.total === 0 ? (
        <p className="px-4 py-3 text-xs text-gray-600">
          {data.document.status === 'published' ? 'Nobody has been asked yet.' : 'Once the document is published, everyone in the organisation is asked to read and acknowledge it; each new major version (2.0, 3.0) asks everyone again.'}
        </p>
      ) : (
        <div className="space-y-3 px-4 py-3">
          <div className="h-2 w-full overflow-hidden rounded-full bg-[#e8ecf0]" role="progressbar" aria-valuenow={acks.percent} aria-valuemin={0} aria-valuemax={100} aria-label="Acknowledged">
            <div className="h-2 rounded-full bg-emerald-500" style={{ width: `${acks.percent}%` }} />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex flex-wrap rounded-lg border border-gray-300 p-0.5" role="group" aria-label="Show">
              {FILTERS.map(([key, label]) => (
                <button key={key} type="button" aria-pressed={filter === key} onClick={() => setFilter(key)}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium ${filter === key ? 'bg-primary-600 text-white' : 'text-gray-700 hover:bg-gray-100'}`}>
                  {label}
                </button>
              ))}
            </div>
            <label className="relative ml-auto">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" aria-hidden />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a person" aria-label="Find a person"
                className="w-44 rounded-lg border border-gray-300 py-1 pl-7 pr-2 text-xs focus:border-primary-500 focus:outline-none" />
            </label>
          </div>
          <ul className="max-h-80 divide-y divide-gray-100 overflow-auto">
            {people.map((p) => {
              const seal = p.status === 'done' ? ownEsign(p) : null;
              return (
                <li key={p.id} className="flex items-center gap-3 py-2">
                  <Avatar name={p.user} />
                  <div className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-gray-900">
                      {p.user || 'Someone'}{p.user_id === meId && <You />}
                      {p.version && <span className="ml-2 text-[11px] text-gray-500" title={p.status === 'done' ? 'The version this person acknowledged' : 'The version this person is asked to acknowledge'}>version {p.version}</span>}
                    </span>
                    {seal && <SignatureSeal id={seal.id} fingerprint={seal.image_sha256 ?? ''} />}
                    {(earlier.get(p.user_id) ?? []).map((e) => {
                      const s = ownEsign(e);
                      return (
                        <div key={e.id} className="mt-1 border-l-2 border-emerald-200 pl-2 text-[11px] text-gray-600">
                          Acknowledged version {e.version || '-'} on {day(e.done_at)}
                          {s && <SignatureSeal id={s.id} fingerprint={s.image_sha256 ?? ''} thumb={false} />}
                        </div>
                      );
                    })}
                  </div>
                  <Badge row={p} doneLabel="Acknowledged" />
                  <span className="w-36 shrink-0 text-right text-xs text-gray-600">{p.status === 'done' ? dateTime(p.done_at) : `due ${day(p.due_date)}`}</span>
                </li>
              );
            })}
            {people.length === 0 && <li className="py-3 text-xs text-gray-600">{empty}</li>}
          </ul>
        </div>
      )}
    </section>
  );
}

// ── the life cycle ───────────────────────────────────────────────────────────
const DOT: Record<string, string> = {
  signed: 'bg-emerald-500', acknowledged: 'bg-emerald-500', published: 'bg-primary-600', version_created: 'bg-primary-600',
  rejected: 'bg-rose-500', escalated: 'bg-rose-500', status_changed: 'bg-gray-400',
};

function Timeline({ events }: { events: Lifecycle['timeline'] }) {
  const [all, setAll] = useState(false);
  const shown = all ? events : events.slice(0, 8);
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4">
      <h3 className="mb-3 text-sm font-semibold text-gray-900">Life cycle</h3>
      {events.length === 0 ? (
        <p className="text-xs text-gray-600">Nothing has happened to this document yet.</p>
      ) : (
        <ol className="ml-1.5 border-l border-gray-200">
          {shown.map((e, i) => {
            // dates the server writes as 2026-10-23 are shown as people read them; technical parts (signature ids) are quieter
            const [main, ...rest] = (e.detail || '')
              .replace(/\b\d{4}-\d{2}-\d{2}\b/g, (d) => day(d))
              .replace(/(→|\bto|\bfrom)\s*'?([a-z]+_[a-z_]+|draft|approved|published|archived|expired)\b'?/g, (m, word, s) => `${word} ${SIGNOFF_STATUS[s]?.label ?? s}`)
              .split(' · ');
            return (
              <li key={i} className="relative pb-3 pl-4 last:pb-0">
                <span aria-hidden className={`absolute -left-[5px] top-1.5 h-2.5 w-2.5 rounded-full ring-2 ring-white ${DOT[e.kind] || 'bg-amber-400'}`} />
                <p className="text-xs"><span className="font-medium text-gray-900">{eventLabel(e.kind)}</span><span className="text-gray-500"> · {dateTime(e.at)}</span></p>
                <p className="text-xs text-gray-700">
                  {e.actor ? <span className="font-medium">{e.actor}: </span> : null}{main}
                  {rest.length > 0 && <span className="text-gray-500"> · {rest.join(' · ')}</span>}
                </p>
              </li>
            );
          })}
        </ol>
      )}
      {events.length > 8 && (
        <button type="button" onClick={() => setAll(!all)} className="mt-2 text-xs font-medium text-primary-700 hover:underline">
          {all ? 'Show the latest only' : `Show all ${events.length} events`}
        </button>
      )}
    </section>
  );
}

// ── due dates and escalation: the organisation's settings, changed in Governance > Settings (one source) ──
export function SettingsCard({ inPopup = false }: { inPopup?: boolean }) {
  const { data, error } = useQuery<SettingsAnswer>({
    queryKey: ['document-lifecycle-settings'],
    queryFn: async () => (await apiClient.get('/governance/documents/lifecycle/settings')).data,
    retry: retrySettings,
  });
  if (inPopup && noAccess(error)) {
    return <p className="text-sm text-[#26323d]">Only an administrator or someone with a governance right can see these settings.</p>;
  }
  if (!data?.enabled) return null;
  const s = data.settings;
  const days = (n: number) => `${n} day${n === 1 ? '' : 's'}`;
  const rows: [string, string][] = [
    ['Review', days(s.review_days ?? s.approval_days)],
    ['Approval', days(s.approval_days)],
    ['Acknowledgement', days(s.ack_days)],
    ['Reminders', (s.remind_days ? `${days(s.remind_days)} before the due date` : 'none before the due date')
      + (s.remind_every_days ? `, then every ${days(s.remind_every_days)}` : '')],
    ['When late', `${s.owner_after_days ? `owner told after ${days(s.owner_after_days)}` : 'owner told the same day'}, then `
      + `${s.escalate_role_id ? (data.escalate_role_name || 'the chosen role') : 'the administrators'} after ${days(s.admin_after_days)}`],
  ];
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4">
      {!inPopup && <h3 className="text-sm font-semibold text-gray-900">Due dates and escalation</h3>}{/* the popup's own title says it */}
      <p className="mt-0.5 text-xs text-gray-600">The same for every document in the organisation.</p>
      <dl className="mt-3 grid gap-x-6 gap-y-1.5 sm:grid-cols-[max-content_1fr]">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-xs font-medium text-gray-700">{label}</dt>
            <dd className="text-xs text-gray-900">{value}</dd>
          </div>
        ))}
      </dl>
      <Link href="/governance/settings" className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-[#0f766e] hover:underline">
        {data.can_edit ? 'Change these in Governance settings' : 'See all in Governance settings'} <ChevronRight className="h-3.5 w-3.5" aria-hidden />
      </Link>
    </section>
  );
}

// ── the tab ──────────────────────────────────────────────────────────────────
export default function LifecycleTab({ documentId, doc, canEdit = true, canAnnotate = true, settings = true, ownSteps = true }: {
  documentId: number; doc: any;
  /** who may change the document: participants, Send and Remind */
  canEdit?: boolean;
  /** who may post remarks (editors, auditors, the sign-off's people): the Discussion is theirs, hidden from the others */
  canAnnotate?: boolean;
  /** the organisation-wide due-date settings (the AI Studio's view keeps them behind its ⋯ menu) */
  settings?: boolean;
  /** the person's own sign / acknowledge step (the AI Studio's view asks for those in its own popups) */
  ownSteps?: boolean;
}) {
  const queryClient = useQueryClient();
  const base = `/governance/documents/${documentId}/lifecycle`;
  const { data, isLoading } = useQuery<Lifecycle>({
    queryKey: ['document-lifecycle', String(documentId)],
    queryFn: async () => (await apiClient.get(base)).data,
    refetchInterval: 10000,
  });
  const { data: signoff } = useSignoff(documentId);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['document-lifecycle'] });

  if (isLoading || !data) return <div className="flex h-40 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-primary-400" /></div>;
  const meId = data.me?.id ?? data.mine[0]?.user_id;
  const myAck = data.mine.find((r) => r.kind === 'acknowledgement');
  const mySign = data.mine.find((r) => r.kind === 'review' || r.kind === 'approval');
  const waiting = data.approvals.filter((r) => r.status === 'pending');

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h3 className="text-sm font-semibold text-gray-900">Where this document stands</h3>
          <StatusChip status={data.document.status} />
          <span className="text-xs text-gray-600">version {data.document.version} · owner {data.document.owner || '-'}</span>
        </div>
        <Stages status={data.document.status} signoff={signoff} acks={data.acknowledgements} />
        {waiting.length > 0 && (
          <p className="mt-3 flex flex-wrap items-center gap-1.5 text-xs text-gray-700">
            <Clock className="h-3.5 w-3.5 text-amber-600" aria-hidden />
            Waiting for {waiting.map((r, i) => (
              <span key={r.id} className={r.overdue ? 'font-medium text-rose-700' : 'font-medium text-gray-900'}>
                {r.user_id === meId ? 'you' : r.user}{r.overdue ? ' (overdue)' : ''}{i < waiting.length - 1 ? ',' : ''}
              </span>
            ))}
          </p>
        )}
      </section>

      {ownSteps && <SignoffAction documentId={documentId} due={mySign?.due_date} />}
      {/* the version the request names: while a new version is on its way it is the one in force, not the newest */}
      {ownSteps && myAck && <AckAction base={base} row={myAck} onDone={refresh} version={myAck.version || data.document.version} />}

      <ReviewAndApproval rows={data.approvals} signoff={signoff} meId={meId} />
      <SignoffParticipants documentId={documentId} doc={doc} readOnly={!canEdit} />
      <Acknowledgements data={data} meId={meId} base={base} canRemind={canEdit} />
      <Timeline events={data.timeline} />
      {settings && <SettingsCard />}

      {canAnnotate && (
        <section className="rounded-xl border border-gray-200 bg-white p-4">
          <h3 className="mb-1 text-sm font-semibold text-gray-900">Discussion</h3>
          <p className="mb-3 text-xs text-gray-500">Everyone involved (the author, reviewers and approvers) can comment here.</p>
          <DocumentAnnotationPanel documentId={documentId} />
        </section>
      )}
    </div>
  );
}
