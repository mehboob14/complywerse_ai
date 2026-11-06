'use client';

// Continuous Monitoring surface (stages 10–11). Capture monitoring signals; a qualifying signal (breach, or one at the level the
// vendor's tier sets) auto-spawns a versioned reassessment server-side — we surface that. Each new signal waits for a decision:
// Acknowledge or Dismiss, with no questions asked. A signal can be raised as a finding with it, or later. RBAC: vendor_risk:monitoring:*.

import { useEffect, useId, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, ExternalLink, Flag, Loader2, Plus, Radio, RefreshCw, ShieldCheck, ShieldQuestion, Trash2 } from 'lucide-react';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip } from 'recharts';
import { BTN, BTN_PRIMARY, Dialog, EmptyState, SeverityChip, StatusPill, TONE, fmt } from '@/app/(dashboard)/vendor-risk/_ui';
import { useToast } from '@/components/ui/ToastProvider';
import { usePermissions } from '@/hooks/usePermissions';
import { apiErrorText } from '@/lib/apiError';
import { tpraApi } from '@/lib/api';
import { findingsApi, refreshFindings } from '../../../_lib/findingsApi';
import { SIGNAL_STATUS, signalStatus, signalTypeLabel, waitingLine } from '../../../_lib/findingCardModel';
import { CheckCard, FIELD, Field } from './FindingDialogs';
import type { MonitoringSignal } from './types';
import { SEVERITIES, SIGNAL_TYPES } from './constants';

const FOCUS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f766e]';
const SM = `inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-[#c3ccd5] bg-[#fff] px-2.5 text-[13px] font-medium text-[#26323d] hover:bg-[#f3f6f8] disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS}`;
const GHOST = `inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-medium text-[#0f766e] hover:bg-[#f0fdfa] disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS}`;
const ICON = `grid h-8 w-8 place-items-center rounded-lg text-[#64707e] hover:bg-[#f3f6f8] hover:text-[#26323d] disabled:opacity-50 ${FOCUS}`;
const CHIP = 'inline-flex items-center gap-1 rounded-md border border-[#d5dbe1] bg-[#f3f6f8] px-1.5 py-0.5 text-[11px] font-medium leading-4 text-[#586472]';

export default function SignalsPanel({ vendorId }: { vendorId: number }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { hasPermission } = usePermissions();
  const erm = hasPermission('erm:risks:edit');          // the fallback every vendor-risk write accepts
  const canEdit = hasPermission('vendor_risk:monitoring:edit') || erm;
  const canCreate = hasPermission('vendor_risk:monitoring:create') || erm;
  const canDelete = hasPermission('vendor_risk:monitoring:delete') || erm;
  const canRaise = hasPermission('vendor_risk:findings:create') || erm;

  const [recording, setRecording] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['tpra-signals', vendorId],
    queryFn: async () => (await tpraApi.listSignals(vendorId)).data as { items: MonitoringSignal[] },
  });

  const invalidate = () => {
    ['tpra-signals', 'tpra-lifecycle', 'tpra-attention'].forEach((k) => qc.invalidateQueries({ queryKey: k === 'tpra-signals' ? [k, vendorId] : [k] }));
  };
  const failed = (title: string) => (e: unknown) => toast({ type: 'error', title, message: apiErrorText(e, 'Try again.') });

  const record = useMutation({
    mutationFn: (p: Record<string, unknown>) => tpraApi.createSignal(vendorId, p),
    onSuccess: (res) => {
      invalidate();
      setRecording(false);
      const made = res.data as { triggered_reassessment_id?: number | null; finding_id?: number | null };
      if (made.finding_id) refreshFindings(qc);
      if (made.triggered_reassessment_id) {
        toast({ type: 'warning', title: 'Reassessment triggered', message: `Signal opened reassessment #${made.triggered_reassessment_id}.` });
      } else {
        toast({ type: 'success', title: made.finding_id ? 'Signal recorded and finding raised' : 'Signal recorded' });
      }
    },
    onError: failed('Failed'),
  });
  const acknowledge = useMutation({
    mutationFn: ({ id, row_version }: { id: number; row_version: number }) => tpraApi.updateSignal(id, { acknowledged: true, row_version }),
    onSuccess: () => { invalidate(); toast({ type: 'success', title: 'Signal acknowledged' }); },
    onError: failed('Not acknowledged'),
  });
  const dismiss = useMutation({
    mutationFn: (id: number) => findingsApi.dismissSignal(id),
    onSuccess: () => { invalidate(); toast({ type: 'success', title: 'Signal dismissed' }); },
    onError: failed('Not dismissed'),
  });
  const remove = useMutation({ mutationFn: (id: number) => tpraApi.deleteSignal(id), onSuccess: invalidate, onError: failed('Not deleted') });
  const raise = useMutation({
    mutationFn: (id: number) => tpraApi.raiseSignalFinding(id),
    onSuccess: (res) => {
      invalidate();
      refreshFindings(qc);
      toast({ type: 'success', title: 'Finding raised', message: `Finding #${(res.data as { finding_id: number }).finding_id} is on the current assessment.` });
    },
    onError: failed('Could not raise a finding'),
  });
  const rule = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason?: string }) => tpraApi.rejectSignal(id, reason),
    onSuccess: () => { invalidate(); toast({ type: 'success', title: 'Ruled out', message: 'Those articles will not be raised again for this vendor.' }); },
    onError: failed('Not ruled out'),
  });

  // External security ratings, where a provider's scores have been imported or fetched.
  const { data: ratings } = useQuery({
    queryKey: ['tpra-ratings', vendorId],
    queryFn: async () => ((await tpraApi.vendorRatings(vendorId)).data?.items || []) as Array<{ provider: string; score: number; captured_at: string }>,
  });

  const signals = data?.items || [];
  const waiting = waitingLine(signals);
  const latest = ratings && ratings.length ? ratings[ratings.length - 1] : null;
  const earlier = ratings && ratings.length > 1 ? ratings[ratings.length - 2] : null;

  return (
    <div className="space-y-3">
      {latest && (
        <div className="rounded-xl border border-[#d5dbe1] bg-[#fff] p-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-[13px] font-medium text-[#1f2933]">External security rating · {latest.provider}</p>
            <p className="text-[13px] text-[#586472]">
              <span className="text-base font-semibold text-[#1f2933]">{latest.score}</span> on {fmt.date(latest.captured_at)}
              {earlier && (
                <span className="ml-1" style={{ color: latest.score < earlier.score ? TONE.danger.text : TONE.success.text }}>
                  ({latest.score >= earlier.score ? '+' : ''}{Math.round((latest.score - earlier.score) * 10) / 10})
                </span>
              )}
            </p>
          </div>
          {ratings!.length > 1 && (
            <div className="mt-2 h-24">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={ratings!.map((r) => ({ date: fmt.date(r.captured_at), score: r.score }))}>
                  <XAxis dataKey="date" hide />
                  <YAxis domain={[0, 100]} hide />
                  <Tooltip />
                  <Line type="monotone" dataKey="score" stroke="#0f766e" strokeWidth={2} dot={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[13px] text-[#586472]">{waiting}</p>
        {canCreate && (
          <button type="button" onClick={() => setRecording(true)} className={BTN_PRIMARY}>
            <Plus aria-hidden className="h-4 w-4" /> Record signal
          </button>
        )}
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 py-8 text-sm text-[#586472]"><Loader2 aria-hidden className="h-4 w-4 animate-spin" /> Loading…</div>
      ) : signals.length === 0 ? (
        <EmptyState icon={Radio} title="No monitoring signals" hint="Record a breach, a news story, a rating change or a missed service level as you hear of it." />
      ) : (
        <ul className="divide-y divide-[#e1e6eb] rounded-xl border border-[#d5dbe1] bg-[#fff] px-4">
          {signals.map((s) => {
            const state = signalStatus(s);
            const sources = (s.sources || []).filter((src) => src.url);
            return (
              <li key={s.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2">
                    <SeverityChip severity={s.severity} />
                    <span className="text-[14px] font-semibold leading-5 text-[#1f2933]">{s.title || signalTypeLabel(s.signal_type)}</span>
                    <span className={CHIP}>{signalTypeLabel(s.signal_type)}</span>
                    {s.triggered_reassessment && (
                      <span className="inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium leading-4"
                        style={{ background: TONE.warning.tint, borderColor: TONE.warning.border, color: TONE.warning.text }}>
                        <RefreshCw aria-hidden className="h-3 w-3" /> Reassessment
                      </span>
                    )}
                    {s.verification && (s.verified === false ? (
                      <span className="inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium leading-4"
                        style={{ background: TONE.warning.tint, borderColor: TONE.warning.border, color: TONE.warning.text }}
                        title="Kept and shown, but not emailed and not reopening the assessment until a second publisher reports it">
                        <ShieldQuestion aria-hidden className="h-3 w-3" /> Unverified: {s.verification.reason || 'one source'}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium leading-4"
                        style={{ background: TONE.success.tint, borderColor: TONE.success.border, color: TONE.success.text }}>
                        <ShieldCheck aria-hidden className="h-3 w-3" /> Verified: {s.verification.checks?.corroboration || 'checked'}
                      </span>
                    ))}
                    {s.finding_id && (
                      <Link href={`/vendor-risk/vendors/${vendorId}?tab=findings&finding=${s.finding_id}`} className={`${CHIP} hover:bg-[#e8edf1] ${FOCUS}`}>
                        Finding #{s.finding_id}
                      </Link>
                    )}
                  </p>
                  {s.detail && <p className="mt-1 whitespace-pre-line text-[13px] leading-5 text-[#586472]">{s.detail}</p>}
                  {sources.slice(0, 4).map((src) => (
                    <a key={src.url} href={src.url} target="_blank" rel="noopener noreferrer"
                      className={`mt-0.5 flex items-center gap-1 truncate rounded-sm text-[12px] text-[#0f766e] hover:underline ${FOCUS}`}>
                      <ExternalLink aria-hidden className="h-3 w-3 shrink-0" /> {src.domain ? `${src.domain}: ` : ''}{src.title || src.url}
                    </a>
                  ))}
                  <p className="mt-1 text-[12px] leading-4 text-[#64707e]">{[s.source, `seen ${fmt.date(s.occurred_at)}`].filter(Boolean).join(' · ')}</p>
                </div>
                <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
                  <StatusPill tone={SIGNAL_STATUS[state].tone}>{SIGNAL_STATUS[state].label}</StatusPill>
                  {state === 'new' && canEdit && (
                    <>
                      <button type="button" className={SM} disabled={acknowledge.isPending && acknowledge.variables?.id === s.id}
                        onClick={() => acknowledge.mutate({ id: s.id, row_version: s.row_version })}>Acknowledge</button>
                      <button type="button" className={GHOST} disabled={dismiss.isPending && dismiss.variables === s.id}
                        onClick={() => dismiss.mutate(s.id)}>Dismiss</button>
                    </>
                  )}
                  {canRaise && !s.finding_id && (
                    <button type="button" className={ICON} aria-label="Raise as a finding" title="Raise as a finding" disabled={raise.isPending}
                      onClick={() => raise.mutate(s.id)}><Flag aria-hidden className="h-3.5 w-3.5" /></button>
                  )}
                  {canEdit && sources.length > 0 && (
                    <button type="button" className={ICON} aria-label="Not about this vendor" title="Not about this vendor: remove and never raise these articles again"
                      onClick={() => {
                        const reason = window.prompt('Why is this not about the vendor? (optional)') ?? undefined;
                        rule.mutate({ id: s.id, reason });
                      }}><Ban aria-hidden className="h-3.5 w-3.5" /></button>
                  )}
                  {canDelete && (
                    <button type="button" className={`${ICON} hover:!bg-[#fef3f2] hover:!text-[#b42318]`} aria-label="Delete signal" title="Delete signal"
                      onClick={() => remove.mutate(s.id)}><Trash2 aria-hidden className="h-3.5 w-3.5" /></button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <RecordSignalDialog open={recording} onClose={() => setRecording(false)} busy={record.isPending} canRaise={canRaise}
        onRecord={(p) => record.mutate(p)} />
    </div>
  );
}

const BLANK = { signal_type: 'security_rating', severity: 'medium', title: '', detail: '', source: '' };

function RecordSignalDialog({ open, onClose, busy, canRaise, onRecord }: {
  open: boolean; onClose: () => void; busy: boolean; canRaise: boolean; onRecord: (p: Record<string, unknown>) => void;
}) {
  const formId = useId();
  const [form, setForm] = useState(BLANK);
  const [finding, setFinding] = useState(true);                 // a signal nobody has to act on is a note: ticked unless left off
  useEffect(() => { if (!open) { setForm(BLANK); setFinding(true); } }, [open]);
  const set = <K extends keyof typeof BLANK>(key: K, value: string) => setForm((f) => ({ ...f, [key]: value }));
  return (
    <Dialog open={open} onClose={onClose} title="Record signal" size={600}
      footer={(
        <>
          <button type="button" className={BTN} onClick={onClose}>Cancel</button>
          <button type="submit" form={formId} className={BTN_PRIMARY} disabled={busy || !form.title.trim()}>{busy ? 'Saving…' : 'Record signal'}</button>
        </>
      )}>
      <form id={formId} className="space-y-3.5" onSubmit={(e) => {
        e.preventDefault();
        if (!form.title.trim()) return;
        onRecord({ ...form, title: form.title.trim(), source: form.source.trim() || undefined, detail: form.detail.trim() || undefined,
          raise_finding: canRaise && finding });
      }}>
        <Field id={`${formId}-title`} label="What happened">
          <input id={`${formId}-title`} className={FIELD} value={form.title} maxLength={255} required data-autofocus
            onChange={(e) => set('title', e.target.value)} />
        </Field>
        <div className="grid gap-3.5 sm:grid-cols-2">
          <Field id={`${formId}-type`} label="Kind">
            <select id={`${formId}-type`} className={FIELD} value={form.signal_type} onChange={(e) => set('signal_type', e.target.value)}>
              {SIGNAL_TYPES.map((t) => <option key={t} value={t}>{signalTypeLabel(t)}</option>)}
            </select>
          </Field>
          <Field id={`${formId}-sev`} label="Severity" tip="A breach, or a signal at the level this vendor's tier sets, opens a new assessment.">
            <select id={`${formId}-sev`} className={FIELD} value={form.severity} onChange={(e) => set('severity', e.target.value)}>
              {SEVERITIES.map((s) => <option key={s} value={s}>{fmt.status(s)}</option>)}
            </select>
          </Field>
        </div>
        <Field id={`${formId}-detail`} label="Detail" optional>
          <textarea id={`${formId}-detail`} className={FIELD} rows={3} maxLength={8000} value={form.detail} onChange={(e) => set('detail', e.target.value)} />
        </Field>
        <Field id={`${formId}-source`} label="Source" optional>
          <input id={`${formId}-source`} className={FIELD} value={form.source} placeholder="e.g. SecurityScorecard" maxLength={120}
            onChange={(e) => set('source', e.target.value)} />
        </Field>
        {canRaise && (
          <CheckCard checked={finding} onChange={setFinding} title="Raise a finding with it"
            note="Gives it an owner and a due date. Leave off for a note." />
        )}
      </form>
    </Dialog>
  );
}
