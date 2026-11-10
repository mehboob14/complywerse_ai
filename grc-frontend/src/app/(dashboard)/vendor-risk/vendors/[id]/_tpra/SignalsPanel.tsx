'use client';

// Continuous Monitoring surface (stages 10–11). Capture monitoring signals; a qualifying signal (breach, or one at the level the
// vendor's tier sets) auto-spawns a versioned reassessment server-side — we surface that. Each new signal waits for a decision:
// Acknowledge or Dismiss, with no questions asked. A signal can be raised as a finding with it, or later. RBAC: vendor_risk:monitoring:*.

import { useEffect, useId, useState } from 'react';
import { ErrorState } from '@/components/ui/ds';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, ExternalLink, Flag, Loader2, Plus, Radio, RefreshCw, ShieldCheck, ShieldQuestion, Trash2 } from 'lucide-react';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip } from 'recharts';
import { BTN, BTN_PRIMARY } from '../_record/btn';
import { Dialog, EmptyState, SeverityChip, StatusPill } from '../_record/recordUi';
import { TONE } from '@/lib/status';
import { fmt } from '../../../_ui/fmt';
import { useToast } from '@/components/ui/ToastProvider';
import { usePermissions } from '@/hooks/usePermissions';
import { apiErrorText } from '@/lib/apiError';
import { tpraApi } from '@/lib/api';
import { findingsApi, refreshFindings } from '../../../_lib/findingsApi';
import { SIGNAL_STATUS, signalStatus, signalTypeLabel, waitingLine } from '../../../_lib/findingCardModel';
import { CheckCard, FIELD, Field } from './FindingDialogs';
import type { MonitoringSignal } from './types';
import { SEVERITIES, SIGNAL_TYPES } from './constants';

const FOCUS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-primary';
const SM = `inline-flex h-8 shrink-0 items-center gap-1.5 rounded-ds-card border border-ds-border-strong bg-ds-surface px-2.5 text-[13px] font-medium text-ds-fg-body hover:bg-ds-surface-hover disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS}`;
const GHOST = `inline-flex h-8 shrink-0 items-center gap-1.5 rounded-ds-card px-2.5 text-[13px] font-medium text-ds-primary-text hover:bg-ds-primary-soft disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS}`;
const ICON = `grid h-[32px] w-[32px] place-items-center rounded-ds-card text-ds-fg-muted hover:bg-ds-surface-hover hover:text-ds-fg-body disabled:opacity-50 ${FOCUS}`;
const CHIP = 'inline-flex items-center gap-1 rounded-ds-control border border-ds-border bg-ds-surface-hover px-1.5 py-0.5 text-[12px] font-medium leading-4 text-ds-fg-muted';

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
  const [ruling, setRuling] = useState<number | null>(null);           // a signal about the wrong company: asks why before it is removed
  const [ruleReason, setRuleReason] = useState('');

  const { data, isLoading, isError, refetch } = useQuery({
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
        toast({ type: 'warning', title: 'Reassessment triggered', message: 'This signal opened a new reassessment.' });
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
      toast({ type: 'success', title: 'Finding raised', message: 'It is on the current assessment.' });
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
    <div className="space-y-[12px]">
      {latest && (
        <div className="rounded-ds-card border border-ds-border bg-ds-surface p-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-[13px] font-medium text-ds-fg">External security rating · {latest.provider}</p>
            <p className="text-[13px] text-ds-fg-muted">
              <span className="text-[14px] font-[600] text-ds-fg">{latest.score}</span> on {fmt.date(latest.captured_at)}
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
        <p className="text-[13px] text-ds-fg-muted">{waiting}</p>
        {canCreate && (
          <button type="button" onClick={() => setRecording(true)} className={BTN_PRIMARY}>
            <Plus aria-hidden className="h-4 w-4" /> Record signal
          </button>
        )}
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 py-8 text-[13px] text-ds-fg-muted"><Loader2 aria-hidden className="h-4 w-4 animate-spin" /> Loading…</div>
      ) : isError ? (
        <ErrorState compact title="Couldn’t load the monitoring signals" onRetry={() => { void refetch(); }} />
      ) : signals.length === 0 ? (
        <EmptyState icon={Radio} title="No monitoring signals" hint="Record a breach, a news story, a rating change or a missed service level as you hear of it." />
      ) : (
        <ul className="divide-y divide-ds-border rounded-ds-card border border-ds-border bg-ds-surface px-[16px]">
          {signals.map((s) => {
            const state = signalStatus(s);
            const sources = (s.sources || []).filter((src) => src.url);
            return (
              <li key={s.id} className="flex flex-wrap items-start justify-between gap-[12px] py-3">
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2">
                    <SeverityChip severity={s.severity} />
                    <span className="text-[14px] font-[600] leading-5 text-ds-fg">{s.title || signalTypeLabel(s.signal_type)}</span>
                    <span className={CHIP}>{signalTypeLabel(s.signal_type)}</span>
                    {s.triggered_reassessment && (
                      <span className="inline-flex items-center gap-1 rounded-ds-control border px-1.5 py-0.5 text-[12px] font-medium leading-4"
                        style={{ background: TONE.warning.tint, borderColor: TONE.warning.border, color: TONE.warning.text }}>
                        <RefreshCw aria-hidden className="h-3 w-3" /> Reassessment
                      </span>
                    )}
                    {s.verification && (s.verified === false ? (
                      <span className="inline-flex items-center gap-1 rounded-ds-control border px-1.5 py-0.5 text-[12px] font-medium leading-4"
                        style={{ background: TONE.warning.tint, borderColor: TONE.warning.border, color: TONE.warning.text }}
                        title="Kept and shown, but not emailed and not reopening the assessment until a second publisher reports it">
                        <ShieldQuestion aria-hidden className="h-3 w-3" /> Unverified: {s.verification.reason || 'one source'}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-ds-control border px-1.5 py-0.5 text-[12px] font-medium leading-4"
                        style={{ background: TONE.success.tint, borderColor: TONE.success.border, color: TONE.success.text }}>
                        <ShieldCheck aria-hidden className="h-3 w-3" /> Verified: {s.verification.checks?.corroboration || 'checked'}
                      </span>
                    ))}
                    {s.finding_id && (
                      <Link href={`/vendor-risk/vendors/${vendorId}?tab=findings&finding=${s.finding_id}`} className={`${CHIP} hover:bg-ds-border ${FOCUS}`}>
                        See the finding
                      </Link>
                    )}
                  </p>
                  {s.detail && <p className="mt-1 whitespace-pre-line text-[13px] leading-5 text-ds-fg-muted">{s.detail}</p>}
                  {sources.slice(0, 4).map((src) => (
                    <a key={src.url} href={src.url} target="_blank" rel="noopener noreferrer"
                      className={`mt-0.5 flex items-center gap-1 truncate rounded-ds-control text-[12px] text-ds-primary-text hover:underline ${FOCUS}`}>
                      <ExternalLink aria-hidden className="h-3 w-3 shrink-0" /> {src.domain ? `${src.domain}: ` : ''}{src.title || src.url}
                    </a>
                  ))}
                  <p className="mt-1 text-[12px] leading-4 text-ds-fg-muted">{[s.source, `seen ${fmt.date(s.occurred_at)}`].filter(Boolean).join(' · ')}</p>
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
                      onClick={() => { setRuleReason(''); setRuling(s.id); }}><Ban aria-hidden className="h-3.5 w-3.5" /></button>
                  )}
                  {canDelete && (
                    <button type="button" className={`${ICON} hover:!bg-ds-danger-soft hover:!text-ds-danger`} aria-label="Delete signal" title="Delete signal"
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
      <Dialog
        open={ruling !== null}
        onClose={() => setRuling(null)}
        title="Not about this vendor"
        description="These articles are removed from this vendor and will not be raised again."
        footer={(
          <>
            <button type="button" className={BTN} onClick={() => setRuling(null)}>Cancel</button>
            <button type="button" className={BTN_PRIMARY} disabled={rule.isPending}
              onClick={() => { if (ruling !== null) rule.mutate({ id: ruling, reason: ruleReason.trim() || undefined }, { onSuccess: () => setRuling(null) }); }}>
              {rule.isPending ? 'Removing…' : 'Remove them'}
            </button>
          </>
        )}
      >
        <label htmlFor="signal-rule-reason" className="mb-[4px] block text-[12px] font-medium text-ds-fg-body">Why is this not about the vendor? (optional)</label>
        <textarea id="signal-rule-reason" data-autofocus rows={3} className={FIELD} value={ruleReason} onChange={(e) => setRuleReason(e.target.value)} />
      </Dialog>
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
      <form id={formId} className="space-y-[14px]" onSubmit={(e) => {
        e.preventDefault();
        if (!form.title.trim()) return;
        onRecord({ ...form, title: form.title.trim(), source: form.source.trim() || undefined, detail: form.detail.trim() || undefined,
          raise_finding: canRaise && finding });
      }}>
        <Field id={`${formId}-title`} label="What happened">
          <input id={`${formId}-title`} className={FIELD} value={form.title} maxLength={255} required data-autofocus
            onChange={(e) => set('title', e.target.value)} />
        </Field>
        <div className="grid gap-[14px] sm:grid-cols-2">
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
