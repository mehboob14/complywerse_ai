'use client';

// What the vendor's tier asks for: the questionnaires it answers, the evidence it
// supplies, who approves it, how often it is reassessed and how serious a signal
// must be to reopen it. Change the tier and all of it changes. Also where a tier
// that has stopped being true is flagged, and where a tier is set by hand.

import { useState } from 'react';
import { ErrorState } from '@/components/ui/ds';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDate } from '@/lib/format';
import { AlertTriangle, CheckCircle2, CircleDashed, Gauge, Loader2, Send, Tag, XCircle } from 'lucide-react';
import { tpraApi } from '@/lib/api';

interface Requirements {
  tier: string;
  override: { from: string; to: string; computed: string | null; justification: string; at: string } | null;
  retier_reasons: string[];
  cadence_days: number;
  approver_role: string | null;
  reassess_on: string;
  reviewers: string[];
  questionnaires: Array<{ template_id: number; name: string; response_id: number | null; status: 'unsent' | 'sent' | 'answered' }>;
  evidence: Array<{ kind: string; label: string; satisfied: boolean; because?: string;
    items: Array<{ link_id: number; name: string; expired: boolean; expiry_date: string | null }> }>;
}
interface EvidenceLink { id: number; name: string | null; requirement: string | null }

const TIERS = ['critical', 'high', 'medium', 'low'];
const btn = 'inline-flex items-center gap-1 rounded-ds-control border px-2 py-1 text-[12px] font-medium disabled:opacity-60';

function errorText(e: unknown): string {
  return (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || 'That did not save.';
}

export default function TierRequirementsPanel({ vendorId, assessmentId, canEdit, onRunTiering, tieringBusy, onChanged }: {
  vendorId: number; assessmentId: number; canEdit: boolean;
  onRunTiering?: () => void; tieringBusy?: boolean; onChanged?: () => void;
}) {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [overriding, setOverriding] = useState(false);
  const [newTier, setNewTier] = useState('');
  const [why, setWhy] = useState('');

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['tier-requirements', assessmentId],
    queryFn: async () => (await tpraApi.tierRequirements(assessmentId)).data as Requirements,
  });
  const { data: links } = useQuery({
    queryKey: ['tpra-evidence', assessmentId],
    queryFn: async () => ((await tpraApi.listEvidence(assessmentId)).data?.items || []) as EvidenceLink[],
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['tier-requirements', assessmentId] });
    qc.invalidateQueries({ queryKey: ['tpra-evidence', assessmentId] });
    onChanged?.();
  };
  const tag = useMutation({
    mutationFn: async (v: { linkId: number; kind: string }) => tpraApi.tagEvidence(v.linkId, v.kind),
    onSuccess: () => { setError(null); refresh(); },
    onError: (e) => setError(errorText(e)),
  });
  const override = useMutation({
    mutationFn: async () => tpraApi.overrideTier(assessmentId, { tier: newTier, justification: why }),
    onSuccess: () => { setError(null); setOverriding(false); setWhy(''); refresh(); },
    onError: (e) => setError(errorText(e)),
  });

  if (isError) return <ErrorState compact title="Couldn’t load what this tier asks for" onRetry={() => { void refetch(); }} />;
  if (isLoading || !data) {
    return <div className="flex items-center gap-2 p-3 text-[12px] text-ds-fg-muted"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading what this tier asks for…</div>;
  }
  const untagged = (links || []).filter((l) => !l.requirement);

  return (
    <section className="space-y-[12px] rounded-ds-card border border-ds-border bg-ds-surface p-3" aria-label="What this tier asks for">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[12px] font-[600] text-ds-fg">
          What a <span className="capitalize">{data.tier}</span>-tier vendor is asked for
        </p>
        {canEdit && !overriding && (
          <button type="button" className={`${btn} border-ds-border text-ds-fg-body hover:bg-ds-surface-subtle`}
            onClick={() => { setOverriding(true); setNewTier(data.tier); }}>
            <Gauge className="h-3 w-3" /> Set the tier by hand
          </button>
        )}
      </div>

      {data.override && (
        <p className="rounded-ds-control bg-ds-warning-soft px-2.5 py-1.5 text-[12px] text-ds-warning">
          Set by hand to <b className="capitalize">{data.override.to}</b>
          {data.override.computed ? <> (computed <span className="capitalize">{data.override.computed}</span>)</> : null}
          {' '}on {formatDate(data.override.at)}: {data.override.justification}
        </p>
      )}

      {data.retier_reasons.length > 0 && (
        <div className="flex flex-wrap items-start justify-between gap-2 rounded-ds-control border border-ds-danger-border bg-ds-danger-soft px-2.5 py-2 text-[12px] text-ds-danger">
          <p className="flex items-start gap-1.5">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>The facts have changed since this tier was computed: {data.retier_reasons.join('; ')}.</span>
          </p>
          {canEdit && onRunTiering && (
            <button type="button" onClick={onRunTiering} disabled={tieringBusy}
              className={`${btn} border-ds-danger-border bg-ds-surface text-ds-danger hover:bg-ds-danger-soft`}>
              {tieringBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Gauge className="h-3 w-3" />} Re-tier
            </button>
          )}
        </div>
      )}

      {overriding && (
        <form className="space-y-2 rounded-ds-control border border-ds-border bg-ds-surface-subtle p-2.5"
          onSubmit={(e) => { e.preventDefault(); override.mutate(); }}>
          <div className="flex flex-wrap items-center gap-2 text-[12px] text-ds-fg-body">
            <label htmlFor={`tier-${assessmentId}`}>New tier</label>
            <select id={`tier-${assessmentId}`} value={newTier} onChange={(e) => setNewTier(e.target.value)}
              className="rounded border border-ds-border-strong bg-ds-surface px-2 py-1 text-[12px] capitalize">
              {TIERS.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <label className="block text-[12px] text-ds-fg-body">
            Why the computed tier is wrong (kept on the audit trail)
            <textarea value={why} onChange={(e) => setWhy(e.target.value)} rows={2} required minLength={10} maxLength={2000}
              className="mt-1 block w-full rounded border border-ds-border-strong px-2 py-1 text-[12px]" />
          </label>
          <div className="flex gap-2">
            <button type="submit" disabled={override.isPending || why.trim().length < 10 || newTier === data.tier}
              className={`${btn} border-ds-primary bg-ds-primary text-ds-on-primary`}>
              {override.isPending && <Loader2 className="h-3 w-3 animate-spin" />} Set tier
            </button>
            <button type="button" onClick={() => setOverriding(false)} className={`${btn} border-ds-border text-ds-fg-body`}>Cancel</button>
          </div>
        </form>
      )}

      <div className="grid gap-[12px] md:grid-cols-2">
        <div>
          <p className="mb-1 text-[12px] font-medium uppercase tracking-wide text-ds-fg-muted">Questionnaires</p>
          {data.questionnaires.length === 0 ? (
            <p className="text-[12px] text-ds-fg-muted">None set for this tier. Choose them in Settings.</p>
          ) : (
            <ul className="space-y-1">
              {data.questionnaires.map((q) => (
                <li key={q.template_id} className="flex items-center justify-between gap-2 text-[12px]">
                  <span className="flex items-center gap-1.5">
                    {q.status === 'answered' ? <CheckCircle2 className="h-3.5 w-3.5 text-ds-success" />
                      : q.status === 'sent' ? <CircleDashed className="h-3.5 w-3.5 text-ds-warning" />
                        : <XCircle className="h-3.5 w-3.5 text-ds-fg-muted" />}
                    {q.name}
                    <span className="text-[12px] text-ds-fg-muted">{q.status === 'unsent' ? 'not sent' : q.status}</span>
                  </span>
                  {canEdit && q.status === 'unsent' && (
                    <Link href={`/vendor-risk/vendors/${vendorId}?tab=assessments`}
                      className={`${btn} border-ds-border text-ds-fg-body hover:bg-ds-surface-subtle`}>
                      <Send className="h-3 w-3" /> Send
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <p className="mb-1 text-[12px] font-medium uppercase tracking-wide text-ds-fg-muted">Evidence</p>
          {data.evidence.length === 0 ? <p className="text-[12px] text-ds-fg-muted">Nothing required at this tier.</p> : (
            <ul className="space-y-1.5">
              {data.evidence.map((e) => (
                <li key={e.kind} className="text-[12px]">
                  <span className="flex items-start gap-1.5">
                    {e.satisfied ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ds-success" />
                      : <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ds-danger" />}
                    <span>
                      {e.label}
                      {e.because && <span className="block text-[12px] text-ds-primary-text">{e.because}</span>}
                      {e.items.map((i) => (
                        <span key={i.link_id} className={`block text-[12px] ${i.expired ? 'text-ds-danger' : 'text-ds-fg-muted'}`}>
                          {i.name}{i.expiry_date ? ` · ${i.expired ? 'expired' : 'valid until'} ${formatDate(i.expiry_date, { calendar: true })}` : ''}
                        </span>
                      ))}
                    </span>
                  </span>
                  {canEdit && !e.satisfied && untagged.length > 0 && (
                    <label className="ml-5 mt-1 flex items-center gap-1 text-[12px] text-ds-fg-muted">
                      <Tag className="h-3 w-3" />
                      <select aria-label={`Evidence that satisfies: ${e.label}`} value="" disabled={tag.isPending}
                        onChange={(ev) => ev.target.value && tag.mutate({ linkId: Number(ev.target.value), kind: e.kind })}
                        className="rounded border border-ds-border-strong bg-ds-surface px-1.5 py-0.5 text-[12px]">
                        <option value="">This vendor&apos;s evidence that satisfies it…</option>
                        {untagged.map((l) => <option key={l.id} value={l.id}>{l.name || 'Untitled evidence'}</option>)}
                      </select>
                    </label>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <dl className="grid gap-x-4 gap-y-1 text-[12px] text-ds-fg-body md:grid-cols-2">
        <div><dt className="inline font-medium text-ds-fg-body">Approved by: </dt>
          <dd className="inline">{data.approver_role ? `someone with the ${data.approver_role} role` : 'anyone who may approve vendors'}</dd></div>
        <div><dt className="inline font-medium text-ds-fg-body">Reassessed: </dt>
          <dd className="inline">every {data.cadence_days} days</dd></div>
        <div><dt className="inline font-medium text-ds-fg-body">Reopened by: </dt>
          <dd className="inline">a {data.reassess_on} or worse monitoring signal; a breach always</dd></div>
        <div><dt className="inline font-medium text-ds-fg-body">Reviewers: </dt>
          <dd className="inline">{data.reviewers.length ? data.reviewers.join(', ') : 'none required'}</dd></div>
      </dl>
      {error && <p role="alert" className="text-[12px] text-ds-danger">{error}</p>}
    </section>
  );
}
