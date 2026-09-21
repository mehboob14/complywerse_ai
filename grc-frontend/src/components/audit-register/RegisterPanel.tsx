'use client';

/**
 * What the register says about this finding, and what it may connect to.
 *
 * Shown on an issue that came from the client's workbook: their columns in
 * their words, the validation Audit Services owns, and — separately — controls
 * and risks it looks related to. Suggestions are accepted by a person; nothing
 * is linked to a bank's audit finding on its own.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Link2, Loader2, ShieldCheck, Sparkles } from 'lucide-react';
import { auditRegisterApi, issuesApi } from '@/lib/api';
import { FindingForm } from './FindingForm';
import { FindingWorkflow } from './FindingWorkflow';

type Profile = Record<string, any>;
type ControlSuggestion = {
  normalized_control_id: number; code: string | null; name: string | null;
  domain: string | null; score: number; why: string[];
};
type RiskSuggestion = {
  risk_id: number; title: string; score: number; why: string[]; by: string; reason?: string;
};

export function RegisterPanel({ issueId }: { issueId: number }) {
  const queryClient = useQueryClient();
  const [accepted, setAccepted] = useState<Set<string>>(new Set());
  const [showSuggestions, setShowSuggestions] = useState(false);

  const profile = useQuery<Profile>({
    queryKey: ['audit-register-profile', issueId],
    queryFn: async () => (await auditRegisterApi.profile(issueId)).data,
    retry: false,
  });

  const suggestions = useQuery<{ controls: ControlSuggestion[]; risks: RiskSuggestion[] }>({
    queryKey: ['audit-register-suggestions', issueId],
    queryFn: async () => (await auditRegisterApi.suggestions(issueId)).data,
    enabled: showSuggestions,
  });

  const linkControl = useMutation({
    mutationFn: (controlId: number) =>
      issuesApi.links.controls.add(issueId, {
        target_type: 'normalized', control_id: controlId, link_type: 'failed',
        notes: 'Accepted from the audit register suggestions',
      }),
    onSuccess: (_d, controlId) => {
      setAccepted((prev) => new Set(prev).add(`c${controlId}`));
      queryClient.invalidateQueries({ queryKey: ['issue-links', issueId] });
    },
  });

  const linkRisk = useMutation({
    mutationFn: (riskId: number) =>
      issuesApi.links.risks.add(issueId, {
        risk_id: riskId, link_type: 'instance_of',
        notes: 'Accepted from the audit register suggestions',
      }),
    onSuccess: (_d, riskId) => {
      setAccepted((prev) => new Set(prev).add(`r${riskId}`));
      queryClient.invalidateQueries({ queryKey: ['issue-links', issueId] });
    },
  });

  if (profile.isLoading) {
    return <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-slate-300" /></div>;
  }
  if (profile.isError || !profile.data) return null;   // not a register finding

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3 shadow-sm">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-primary-600" />
          <h3 className="text-sm font-semibold text-slate-900">Audit register</h3>
          <button
            onClick={() => setShowSuggestions((s) => !s)}
            className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            <Sparkles className="h-3.5 w-3.5 text-primary-600" />
            {showSuggestions ? 'Hide' : 'Suggest'} controls &amp; risks
          </button>
        </div>
        <FindingForm issueId={issueId} />
      </div>

      <FindingWorkflow issueId={issueId} />

      {showSuggestions && (
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
            <Sparkles className="h-4 w-4 text-primary-600" /> Related controls and risks
          </h3>
          <p className="mt-0.5 text-[11px] text-slate-500">
            Suggestions only — accept the ones that hold. Controls are matched on wording here on
            the server; risks are read against your own risk register.
          </p>

          {suggestions.isLoading ? (
            <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-slate-300" /></div>
          ) : (
            <div className="mt-3 grid gap-4 md:grid-cols-2">
              <div>
                <h4 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Controls</h4>
                {!suggestions.data?.controls.length ? (
                  <p className="mt-2 text-xs text-slate-500">Nothing close enough to suggest.</p>
                ) : suggestions.data.controls.map((c) => (
                  <div key={c.normalized_control_id} className="mt-2 rounded-lg border border-slate-200 p-2">
                    <div className="flex items-start gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-xs font-medium text-slate-900">
                          {c.code ? `${c.code} · ` : ''}{c.name}
                        </p>
                        <p className="text-[11px] text-slate-500">
                          {c.domain ? `${c.domain} · ` : ''}shares: {c.why.join(', ') || '—'}
                        </p>
                      </div>
                      <button
                        onClick={() => linkControl.mutate(c.normalized_control_id)}
                        disabled={accepted.has(`c${c.normalized_control_id}`) || linkControl.isPending}
                        className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                      >
                        {accepted.has(`c${c.normalized_control_id}`)
                          ? <><CheckCircle2 className="h-3 w-3 text-emerald-600" /> Linked</>
                          : <><Link2 className="h-3 w-3" /> Link</>}
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              <div>
                <h4 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Risks</h4>
                {!suggestions.data?.risks.length ? (
                  <p className="mt-2 text-xs text-slate-500">No risks in the register look related.</p>
                ) : suggestions.data.risks.map((r) => (
                  <div key={r.risk_id} className="mt-2 rounded-lg border border-slate-200 p-2">
                    <div className="flex items-start gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-xs font-medium text-slate-900">{r.title}</p>
                        <p className="text-[11px] text-slate-500">
                          {r.by === 'ai' ? (r.reason || 'Read against this finding') : `shares: ${r.why.join(', ') || '—'}`}
                        </p>
                      </div>
                      <button
                        onClick={() => linkRisk.mutate(r.risk_id)}
                        disabled={accepted.has(`r${r.risk_id}`) || linkRisk.isPending}
                        className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                      >
                        {accepted.has(`r${r.risk_id}`)
                          ? <><CheckCircle2 className="h-3 w-3 text-emerald-600" /> Linked</>
                          : <><Link2 className="h-3 w-3" /> Link</>}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
