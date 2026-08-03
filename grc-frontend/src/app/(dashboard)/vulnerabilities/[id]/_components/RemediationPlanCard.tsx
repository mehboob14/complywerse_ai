'use client';

/**
 * Remediation plan — the fix lifecycle for one finding.
 *
 *   Recommended → Approved → Applied → Verified
 *
 * Every stage is backed by a real endpoint and a stored row, so the page is
 * showing recorded state rather than local UI state. The point of the four
 * stages is evidence: who approved the fix, when it was applied, and what
 * proved it worked.
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Sparkles, Check, Copy, RefreshCw, ThumbsUp, Play, ShieldCheck,
  Lightbulb, Wrench, AlertTriangle, Loader2,
} from 'lucide-react';
import { vulnManagementApi } from '@/lib/api';
import { GuideMarker } from '@/components/guide';

const STEPS = ['recommended', 'approved', 'applied', 'verified'] as const;
const STEP_LABEL: Record<string, string> = {
  recommended: 'Recommended', approved: 'Approved', applied: 'Applied', verified: 'Verified',
  // `preview` is the server's unsaved draft — a real plan the API computed but
  // deliberately did not store. It sits *before* step 1 on the rail.
  preview: 'Draft',
};

function Stepper({ status }: { status: string }) {
  // A failed apply parks the rail on "Applied" so the failure reads in place.
  const active = status === 'failed' ? 2 : STEPS.indexOf(status as any);
  return (
    <div className="flex items-center">
      {STEPS.map((s, i) => {
        const done = i < active || status === 'verified';
        const now = i === active && status !== 'verified';
        const bad = status === 'failed' && i === 2;
        return (
          <div key={s} className="flex flex-1 items-center last:flex-none">
            <div className="flex flex-col items-center gap-1.5">
              <div
                className={`flex h-8 w-8 items-center justify-center rounded-full border-2 text-[12px] font-bold ${
                  bad ? 'border-rose-500 bg-rose-500 text-white'
                    : done ? 'border-emerald-600 bg-emerald-600 text-white'
                    : now ? 'border-teal-500 text-teal-600'
                    : 'border-slate-200 text-slate-300'
                }`}
              >
                {done ? <Check size={14} strokeWidth={3} /> : i + 1}
              </div>
              <span className={`text-[11.5px] font-semibold ${bad ? 'text-rose-600' : now ? 'text-teal-600' : done ? 'text-slate-700' : 'text-slate-400'}`}>
                {bad ? 'Failed' : STEP_LABEL[s]}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div className={`mx-2 h-px flex-1 ${i < active ? 'bg-emerald-500' : 'bg-slate-200'}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

function Artifact({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-slate-500">
          <Wrench size={12} /> Fix artifact
        </div>
        <button
          onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
          className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] font-medium text-slate-600 hover:bg-slate-100"
        >
          <Copy size={12} /> {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="overflow-x-auto rounded-lg border border-slate-200 bg-slate-50 p-3.5 font-mono text-[11.5px] leading-relaxed text-slate-700">
        {text}
      </pre>
    </div>
  );
}

export default function RemediationPlanCard({ vulnId, hasOwner = true }: { vulnId: number; hasOwner?: boolean }) {
  const qc = useQueryClient();
  const [autoApply, setAutoApply] = useState(false);
  // Evidence is mandatory server-side (min 10 chars). Closing a finding is a
  // claim someone has to stand behind, so the box is part of the action rather
  // than an optional note added afterwards.
  const [evidence, setEvidence] = useState('');

  const plan = useQuery({
    queryKey: ['vuln-remediation-plan', vulnId],
    // A 404 is the normal "not generated yet" answer, so don't retry it.
    queryFn: async () => (await vulnManagementApi.remediationPlans.get(vulnId)).data as any,
    retry: false,
  });

  const done = () => {
    qc.invalidateQueries({ queryKey: ['vuln-remediation-plan', vulnId] });
    qc.invalidateQueries({ queryKey: ['vulnerability', vulnId] });
  };
  const generate = useMutation({ mutationFn: () => vulnManagementApi.remediationPlans.generate(vulnId), onSuccess: done });
  const approve = useMutation({ mutationFn: (id: number) => vulnManagementApi.remediationPlans.approve(id, { auto_apply: autoApply }), onSuccess: done });
  const applyFix = useMutation({ mutationFn: (id: number) => vulnManagementApi.remediationPlans.apply(id), onSuccess: done });
  const verify = useMutation({
    mutationFn: (id: number) => vulnManagementApi.remediationPlans.verify(id, { evidence: evidence.trim() }),
    onSuccess: () => { setEvidence(''); done(); },
  });
  const busy = generate.isPending || approve.isPending || applyFix.isPending || verify.isPending;

  const p = plan.data;
  // The conditions that justified acting, as recorded on the plan. An empty
  // list is a real answer, not missing data — see the panel below.
  const flags: Array<{ code: string; label: string; detail: string }> = p?.triggers ?? [];

  if (plan.isLoading) {
    return <div className="rounded-xl border border-slate-200 bg-white p-6 text-[13px] text-slate-400">Loading remediation plan…</div>;
  }

  if (!p) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-6">
        <div className="mb-1 flex items-center gap-2">
          <Sparkles size={15} className="text-indigo-500" />
          <h3 className="text-[15px] font-semibold text-slate-900">Remediation plan</h3>
        </div>
        <p className="mb-4 text-[12.5px] text-slate-500">
          Build a concrete fix for this finding — the steps to run, why it matters, and a record of who approved it.
        </p>
        <button
          onClick={() => generate.mutate()}
          disabled={busy}
          className="flex items-center gap-2 rounded-lg bg-teal-500 px-4 py-2 text-[13px] font-semibold text-white hover:bg-teal-600 disabled:opacity-50"
        >
          {generate.isPending ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
          {generate.isPending ? 'Generating…' : 'Generate remediation plan'}
        </button>
        {generate.isError && <p className="mt-3 text-[12.5px] text-rose-600">Could not generate a plan — check your permissions.</p>}
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white">
      <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
        <div className="flex gap-2.5">
          <Sparkles size={15} className="mt-0.5 text-indigo-500" />
          <div>
            <div className="flex items-center gap-1.5 text-[15px] font-semibold text-slate-900">
              Remediation plan
              <GuideMarker id="vuln.remediationPlan" n={6} />
            </div>
            <p className="mt-0.5 text-[12.5px] text-slate-500">
              {p.status === 'preview'
                ? 'Draft built from this finding’s risk context — not saved yet. Review it, then adopt it to start the approval trail.'
                : p.source === 'ai'
                ? 'Generated by AI from this finding’s risk context.'
                : 'Built from this finding’s risk context (AI not configured).'}
            </p>
          </div>
        </div>
        <span className="flex-none rounded-full bg-slate-100 px-2.5 py-1 text-[10.5px] font-bold uppercase tracking-wider text-slate-600">
          {STEP_LABEL[p.status] ?? p.status}
        </span>
      </div>

      <div className="space-y-5 px-5 py-5">
        {/* WHY THIS IS HERE AT ALL.
            The backend computes the red flags that make acting warranted, but
            nothing rendered them — so "remediation starts when something is
            wrong" was true in the data and invisible on screen. Every finding
            looked identical: same tab, same plan, same buttons, whether six
            flags were firing or none. This is the difference, shown. */}
        {flags.length > 0 ? (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3">
            <div className="mb-2 flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-rose-700">
              <AlertTriangle size={12} /> Why this needs action now
            </div>
            <ul className="space-y-1.5">
              {flags.map((f) => (
                <li key={f.code} className="text-[13px] leading-snug text-rose-950">
                  <span className="font-semibold">{f.label}</span>
                  <span className="text-rose-800"> — {f.detail}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-[13px] leading-snug text-slate-600">
            <span className="font-semibold text-slate-800">Nothing is flagging this finding.</span>{' '}
            No public exploit, not on CISA&apos;s exploited list, exploitation probability
            is low, still inside its due date, and the asset is neither internet-facing
            nor business-critical. It can wait for the normal patch cycle — adopting a
            plan here is optional.
          </div>
        )}

        <div className="relative">
          <Stepper status={p.status} />
          <GuideMarker id="vuln.lifecycle" n={7} className="absolute -top-2 right-0" />
        </div>

        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="text-[15px] font-semibold text-slate-900">{p.title}</h4>
            <span className="rounded bg-slate-100 px-2 py-0.5 font-mono text-[10.5px] font-bold uppercase tracking-wider text-slate-600">
              {p.fix_type}
            </span>
          </div>
          <p className="mt-2 text-[13.5px] leading-relaxed text-slate-600">{p.summary}</p>
        </div>

        <Artifact text={p.fix_artifact} />

        <div>
          <div className="mb-1.5 flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-slate-500">
            <Lightbulb size={12} /> Rationale
          </div>
          <p className="text-[13.5px] leading-relaxed text-slate-600">{p.rationale}</p>
        </div>

        {/* Recorded facts — the reason the lifecycle is stored at all. */}
        {(p.approved_by_name || p.applied_at || p.verified_at) && (
          <div className="grid gap-3 rounded-lg bg-slate-50 p-4 text-[12.5px] sm:grid-cols-3">
            {p.approved_by_name && (
              <div><div className="text-slate-500">Approved by</div>
                <div className="font-semibold text-slate-900">{p.approved_by_name}</div>
                <div className="text-slate-400">{p.approved_at ? new Date(p.approved_at).toLocaleString() : ''}</div></div>
            )}
            {p.applied_at && (
              <div><div className="text-slate-500">Applied</div>
                <div className="font-semibold text-slate-900">{p.applied_by_name || '—'}{p.auto_applied ? ' (auto)' : ''}</div>
                <div className="text-slate-400">{new Date(p.applied_at).toLocaleString()}</div></div>
            )}
            {p.verified_at && (
              <div><div className="text-slate-500">Verified</div>
                <div className="font-semibold text-slate-900">{p.verified_by_name || '—'}</div>
                <div className="text-slate-400">{new Date(p.verified_at).toLocaleString()}</div></div>
            )}
          </div>
        )}

        {p.change_window_start && p.status === 'approved' && (
          <p className="text-[12.5px] text-slate-500">
            Change window: {new Date(p.change_window_start).toLocaleString()} — {p.change_window_end ? new Date(p.change_window_end).toLocaleString() : '—'}
          </p>
        )}

        {p.failure_reason && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-[12.5px] text-amber-800">
            <AlertTriangle size={14} className="mt-0.5 flex-none" />
            <span>{p.failure_reason}</span>
          </div>
        )}

        {p.verification_evidence && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3">
            <div className="mb-1 text-[10.5px] font-semibold uppercase tracking-wider text-emerald-700">Verification evidence</div>
            <p className="text-[12.5px] leading-relaxed text-emerald-900">{p.verification_evidence}</p>
          </div>
        )}

        {p.execution_log && (
          <details className="rounded-lg border border-slate-200">
            <summary className="cursor-pointer px-4 py-2.5 text-[12.5px] font-semibold text-slate-600">
              Execution log · {p.executor} · exit {p.execution_exit_code}
            </summary>
            <pre className="max-h-72 overflow-auto border-t border-slate-100 p-3.5 font-mono text-[11px] leading-relaxed text-slate-600">
              {p.execution_log}
            </pre>
          </details>
        )}

        {/* actions */}
        <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 pt-4">
          {p.status === 'preview' && (
            <>
              <button onClick={() => generate.mutate()} disabled={busy}
                className="flex items-center gap-2 rounded-lg bg-teal-500 px-4 py-2 text-[13px] font-semibold text-white hover:bg-teal-600 disabled:opacity-50">
                {generate.isPending ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                {generate.isPending ? 'Adopting…' : 'Adopt this plan'}
              </button>
              <span className="text-[12.5px] text-slate-500">
                Saves the plan and opens it for approval.
              </span>
            </>
          )}
          {p.status === 'recommended' && (
            <>
              {/* The server refuses to approve an unowned plan. Say so here so the
                  button explains itself rather than failing on click. */}
              <button onClick={() => approve.mutate(p.id)} disabled={busy || !hasOwner}
                title={hasOwner ? undefined : 'Assign this finding to someone first'}
                className="flex items-center gap-2 rounded-lg bg-teal-500 px-4 py-2 text-[13px] font-semibold text-white hover:bg-teal-600 disabled:opacity-50">
                <ThumbsUp size={14} />{autoApply ? 'Approve & apply' : 'Approve'}
              </button>
              {!hasOwner && (
                <span className="text-[12.5px] text-amber-700">
                  Assign an owner first — an approved plan with nobody on it is work
                  nobody has been asked to do.
                </span>
              )}
              <label className="flex cursor-pointer items-center gap-2 text-[12.5px] text-slate-600">
                <input type="checkbox" checked={autoApply} onChange={(e) => setAutoApply(e.target.checked)} />
                Auto-apply the fix on approval
              </label>
            </>
          )}
          {p.status === 'approved' && (
            <button onClick={() => applyFix.mutate(p.id)} disabled={busy}
              className="flex items-center gap-2 rounded-lg bg-teal-500 px-4 py-2 text-[13px] font-semibold text-white hover:bg-teal-600 disabled:opacity-50">
              <Play size={14} />Apply fix
            </button>
          )}
          {p.status === 'applied' && (
            <div className="w-full space-y-2">
              <label className="block text-[12.5px] font-semibold text-slate-700">
                What did you check?
              </label>
              <p className="text-[12px] text-slate-500">
                Nothing here re-scans the host — this records <em>your</em> confirmation.
                Paste the re-scan output, a ticket reference, or what you saw.
              </p>
              <textarea
                value={evidence}
                onChange={(e) => setEvidence(e.target.value)}
                rows={3}
                placeholder="e.g. Nessus re-scan 21 Jul, plugin 91234 no longer fires on this host — see CHG-4471"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-[13px] text-slate-800 placeholder:text-slate-400 focus:border-emerald-500 focus:outline-none"
              />
              <div className="flex items-center gap-3">
                <button onClick={() => verify.mutate(p.id)} disabled={busy || evidence.trim().length < 10}
                  className="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-[13px] font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">
                  <ShieldCheck size={14} />Attest fixed &amp; close
                </button>
                {/* The hint used to require length > 0, so an EMPTY box gave a
                    disabled button and no explanation — click, nothing happens,
                    no idea why — while two characters correctly said "a little
                    more detail". Silence for the commonest case, feedback only
                    for the rarer one. Now the requirement is always visible
                    until it is met. */}
                {evidence.trim().length < 10 && (
                  <span className="text-[12px] text-slate-500">
                    {evidence.trim().length === 0
                      ? 'Describe what you checked before closing this — at least a sentence.'
                      : 'A little more detail than that.'}
                  </span>
                )}
              </div>
              {verify.isError && (
                <p className="text-[12.5px] text-rose-600">Could not record the attestation.</p>
              )}
            </div>
          )}
          {p.status === 'failed' && (
            <button onClick={() => applyFix.mutate(p.id)} disabled={busy}
              className="flex items-center gap-2 rounded-lg border border-slate-300 px-4 py-2 text-[13px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
              <RefreshCw size={14} />Retry apply
            </button>
          )}
          <button onClick={() => generate.mutate()} disabled={busy || p.status !== 'recommended'}
            hidden={p.status === 'preview'}
            title={p.status !== 'recommended' ? 'Regenerating would discard the existing approval' : undefined}
            className="ml-auto flex items-center gap-2 rounded-lg px-3 py-2 text-[12.5px] font-medium text-slate-500 hover:bg-slate-100 disabled:opacity-40">
            <RefreshCw size={13} />Regenerate
          </button>
        </div>

        {/* The apply step runs a simulated executor by design — it never touches
            a host. A green "Applied" tick with nothing qualifying it reads as
            "the patch is installed", which is a claim the backend deliberately
            refuses to make. Say so where the tick is. */}
        {p.executor === 'simulated' && (p.status === 'applied' || p.status === 'verified') && (
          <p className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-[12.5px] text-amber-900">
            <AlertTriangle size={14} className="mt-0.5 flex-none" />
            <span>
              <strong>Applied in simulation.</strong> The steps above were recorded, not run —
              no command was executed on {p.title.split(' on ').slice(-1)[0] || 'the host'}.
              Someone still has to carry out the fix and attest to it.
            </span>
          </p>
        )}

        {p.status === 'verified' && (
          <p className="text-[12.5px] text-emerald-700">
            {/* This said "Risk contribution 41 → 0" beside a header still
                reading 41/100, which looked like a bug in one of them. Neither
                was wrong: the finding stops counting toward open risk, but its
                own score describes the flaw and attesting to a fix does not
                change the flaw. Saying both removes the apparent contradiction. */}
            Closed on {p.verified_by_name || 'someone'}&apos;s attestation — it no longer
            counts toward open risk. Its score of {Math.round(p.risk_score_before ?? 0)}/100
            is unchanged, because that measures the flaw, not the decision.
          </p>
        )}
      </div>
    </div>
  );
}
