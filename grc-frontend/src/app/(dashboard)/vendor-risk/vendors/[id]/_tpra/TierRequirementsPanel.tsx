'use client';

// What the vendor's tier asks for: the questionnaires it answers, the evidence it
// supplies, who approves it, how often it is reassessed and how serious a signal
// must be to reopen it. Change the tier and all of it changes. Also where a tier
// that has stopped being true is flagged, and where a tier is set by hand.

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, CircleDashed, Gauge, Loader2, Send, Tag, XCircle } from 'lucide-react';
import { tpraApi, vendorRiskApi } from '@/lib/api';

interface Requirements {
  tier: string;
  override: { from: string; to: string; computed: string | null; justification: string; at: string } | null;
  retier_reasons: string[];
  cadence_days: number;
  approver_role: string | null;
  reassess_on: string;
  reviewers: string[];
  questionnaires: Array<{ template_id: number; name: string; response_id: number | null; status: 'unsent' | 'sent' | 'answered' }>;
  evidence: Array<{ kind: string; label: string; satisfied: boolean;
    items: Array<{ link_id: number; name: string; expired: boolean; expiry_date: string | null }> }>;
}
interface EvidenceLink { id: number; name: string | null; requirement: string | null }

const TIERS = ['critical', 'high', 'medium', 'low'];
const btn = 'inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium disabled:opacity-60';

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

  const { data, isLoading } = useQuery({
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
  const send = useMutation({
    mutationFn: async (templateId: number) =>
      vendorRiskApi.sendQuestionnaire({ vendor_id: vendorId, template_id: templateId, assessment_id: assessmentId }),
    onSuccess: () => { setError(null); refresh(); },
    onError: (e) => setError(errorText(e)),
  });
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

  if (isLoading || !data) {
    return <div className="flex items-center gap-2 p-3 text-xs text-gray-500"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading what this tier asks for…</div>;
  }
  const untagged = (links || []).filter((l) => !l.requirement);

  return (
    <section className="space-y-3 rounded-lg border border-gray-200 bg-white p-3" aria-label="What this tier asks for">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold text-slate-900">
          What a <span className="capitalize">{data.tier}</span>-tier vendor is asked for
        </p>
        {canEdit && !overriding && (
          <button type="button" className={`${btn} border-gray-200 text-gray-600 hover:bg-gray-50`}
            onClick={() => { setOverriding(true); setNewTier(data.tier); }}>
            <Gauge className="h-3 w-3" /> Set the tier by hand
          </button>
        )}
      </div>

      {data.override && (
        <p className="rounded-md bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-900">
          Set by hand to <b className="capitalize">{data.override.to}</b>
          {data.override.computed ? <> (computed <span className="capitalize">{data.override.computed}</span>)</> : null}
          {' '}on {new Date(data.override.at).toLocaleDateString()}: {data.override.justification}
        </p>
      )}

      {data.retier_reasons.length > 0 && (
        <div className="flex flex-wrap items-start justify-between gap-2 rounded-md border border-red-200 bg-red-50 px-2.5 py-2 text-[11px] text-red-800">
          <p className="flex items-start gap-1.5">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>The facts have changed since this tier was computed: {data.retier_reasons.join('; ')}.</span>
          </p>
          {canEdit && onRunTiering && (
            <button type="button" onClick={onRunTiering} disabled={tieringBusy}
              className={`${btn} border-red-300 bg-white text-red-700 hover:bg-red-100`}>
              {tieringBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Gauge className="h-3 w-3" />} Re-compute the tier
            </button>
          )}
        </div>
      )}

      {overriding && (
        <form className="space-y-2 rounded-md border border-gray-200 bg-gray-50 p-2.5"
          onSubmit={(e) => { e.preventDefault(); override.mutate(); }}>
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-gray-600">
            <label htmlFor={`tier-${assessmentId}`}>New tier</label>
            <select id={`tier-${assessmentId}`} value={newTier} onChange={(e) => setNewTier(e.target.value)}
              className="rounded border border-gray-300 bg-white px-2 py-1 text-[11px] capitalize">
              {TIERS.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <label className="block text-[11px] text-gray-600">
            Why the computed tier is wrong (kept on the audit trail)
            <textarea value={why} onChange={(e) => setWhy(e.target.value)} rows={2} required minLength={10} maxLength={2000}
              className="mt-1 block w-full rounded border border-gray-300 px-2 py-1 text-xs" />
          </label>
          <div className="flex gap-2">
            <button type="submit" disabled={override.isPending || why.trim().length < 10 || newTier === data.tier}
              className={`${btn} border-primary-600 bg-primary-600 text-white`}>
              {override.isPending && <Loader2 className="h-3 w-3 animate-spin" />} Set tier
            </button>
            <button type="button" onClick={() => setOverriding(false)} className={`${btn} border-gray-200 text-gray-600`}>Cancel</button>
          </div>
        </form>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-gray-500">Questionnaires</p>
          {data.questionnaires.length === 0 ? (
            <p className="text-[11px] text-gray-500">None set for this tier. Choose them in Settings.</p>
          ) : (
            <ul className="space-y-1">
              {data.questionnaires.map((q) => (
                <li key={q.template_id} className="flex items-center justify-between gap-2 text-xs">
                  <span className="flex items-center gap-1.5">
                    {q.status === 'answered' ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                      : q.status === 'sent' ? <CircleDashed className="h-3.5 w-3.5 text-amber-600" />
                        : <XCircle className="h-3.5 w-3.5 text-gray-400" />}
                    {q.name}
                    <span className="text-[10px] text-gray-400">{q.status === 'unsent' ? 'not sent' : q.status}</span>
                  </span>
                  {canEdit && q.status === 'unsent' && (
                    <button type="button" disabled={send.isPending} onClick={() => send.mutate(q.template_id)}
                      className={`${btn} border-gray-200 text-gray-600 hover:bg-gray-50`}>
                      <Send className="h-3 w-3" /> Send
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-gray-500">Evidence</p>
          {data.evidence.length === 0 ? <p className="text-[11px] text-gray-500">Nothing required at this tier.</p> : (
            <ul className="space-y-1.5">
              {data.evidence.map((e) => (
                <li key={e.kind} className="text-xs">
                  <span className="flex items-start gap-1.5">
                    {e.satisfied ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
                      : <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-500" />}
                    <span>
                      {e.label}
                      {e.items.map((i) => (
                        <span key={i.link_id} className={`block text-[10px] ${i.expired ? 'text-red-600' : 'text-gray-500'}`}>
                          {i.name}{i.expiry_date ? ` · ${i.expired ? 'expired' : 'valid until'} ${new Date(i.expiry_date).toLocaleDateString()}` : ''}
                        </span>
                      ))}
                    </span>
                  </span>
                  {canEdit && !e.satisfied && untagged.length > 0 && (
                    <label className="ml-5 mt-1 flex items-center gap-1 text-[10px] text-gray-500">
                      <Tag className="h-3 w-3" />
                      <select aria-label={`Evidence that satisfies: ${e.label}`} value="" disabled={tag.isPending}
                        onChange={(ev) => ev.target.value && tag.mutate({ linkId: Number(ev.target.value), kind: e.kind })}
                        className="rounded border border-gray-300 bg-white px-1.5 py-0.5 text-[10px]">
                        <option value="">This vendor&apos;s evidence that satisfies it…</option>
                        {untagged.map((l) => <option key={l.id} value={l.id}>{l.name || `Evidence #${l.id}`}</option>)}
                      </select>
                    </label>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <dl className="grid gap-x-4 gap-y-1 text-[11px] text-gray-600 md:grid-cols-2">
        <div><dt className="inline font-medium text-gray-700">Approved by: </dt>
          <dd className="inline">{data.approver_role ? `someone with the ${data.approver_role} role` : 'anyone who may approve vendors'}</dd></div>
        <div><dt className="inline font-medium text-gray-700">Reassessed: </dt>
          <dd className="inline">every {data.cadence_days} days</dd></div>
        <div><dt className="inline font-medium text-gray-700">Reopened by: </dt>
          <dd className="inline">a {data.reassess_on} or worse monitoring signal; a breach always</dd></div>
        <div><dt className="inline font-medium text-gray-700">Reviewers: </dt>
          <dd className="inline">{data.reviewers.length ? data.reviewers.join(', ') : 'none required'}</dd></div>
      </dl>
      {error && <p role="alert" className="text-[11px] text-red-600">{error}</p>}
    </section>
  );
}
