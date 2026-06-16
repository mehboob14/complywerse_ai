'use client';

// AutomationFlags — per-tenant toggle grid for v2 auto-creation triggers.
// All triggers default OFF; v2 behaves identically to v1 until enabled.

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, Zap, ShieldAlert, Clock, FileWarning, Sparkles } from 'lucide-react';
import { issuesApi } from '@/lib/api';

interface FlagsPayload {
  refresh_document_review: boolean;
  kri_red_breach: boolean;
  overdue_mitigation: boolean;
  control_evidence_rejected: boolean;
  all_enabled: boolean;
}

const TRIGGERS: Array<{
  key: keyof FlagsPayload;
  label: string;
  description: string;
  icon: React.ElementType;
}> = [
  {
    key: 'kri_red_breach',
    label: 'KRI red-threshold breach',
    description: 'When any KRI measurement flips to RED, auto-spawn an Issue (severity = High×High) linked to that KRI. De-duplicated — won\'t double-fire while an issue stays open.',
    icon: ShieldAlert,
  },
  {
    key: 'overdue_mitigation',
    label: 'Mitigation action overdue',
    description: 'Nightly job: any RiskMitigationAction past its due_date and not completed gets an Issue raised against it. Runs at 02:00 PKT.',
    icon: Clock,
  },
  {
    key: 'refresh_document_review',
    label: 'Governance doc review fast-forward',
    description: 'When an Issue is created against a GovernanceDocument, fast-forward its next_review_date to 7 days out so the next review cycle picks it up.',
    icon: FileWarning,
  },
  {
    key: 'control_evidence_rejected',
    label: 'Evidence rejected on a control',
    description: 'When evidence on an active framework-journey control is rejected, raise an Issue tagged as a control_test_failed.',
    icon: Sparkles,
  },
];

export function AutomationFlags() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery<FlagsPayload>({
    queryKey: ['issues-automation-flags'],
    queryFn: async () => (await issuesApi.automationFlags.get()).data,
    staleTime: 30_000,
  });

  const updateMutation = useMutation({
    mutationFn: (patch: Partial<FlagsPayload>) => issuesApi.automationFlags.update(patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['issues-automation-flags'] }),
  });

  if (isLoading || !data) {
    return <div className="h-[200px] rounded-xl border border-slate-200 bg-white animate-pulse" />;
  }

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
              <Zap className="h-4 w-4 text-amber-600" />
              Issue Automation
            </h3>
            <p className="mt-0.5 text-xs text-slate-500 max-w-prose">
              Tenant-level switches for the v2 event-driven Issue spawning. <strong>All default OFF</strong> — enable
              individually once you&apos;re confident the rest of the platform is producing clean signals (a noisy KRI
              spawning hundreds of issues is no fun).
            </p>
          </div>
          <label className="flex items-center gap-2 text-xs font-medium text-slate-700 shrink-0">
            <input
              type="checkbox"
              checked={data.all_enabled}
              onChange={(e) => updateMutation.mutate({ all_enabled: e.target.checked })}
              className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
            />
            All on (override)
          </label>
        </div>

        <div className="mt-3 space-y-1.5">
          {TRIGGERS.map((t) => {
            const Icon = t.icon;
            const enabled = data.all_enabled || data[t.key];
            const disabled = data.all_enabled; // when all_enabled, individual toggles are visual-only
            return (
              <div
                key={t.key}
                className={`flex items-start gap-3 rounded-lg border p-3 transition-colors ${
                  enabled ? 'border-emerald-200 bg-emerald-50/30' : 'border-slate-200 bg-slate-50/30'
                }`}
              >
                <div className={`flex h-7 w-7 items-center justify-center rounded-lg shrink-0 ring-1 ${
                  enabled ? 'bg-emerald-100 ring-emerald-200' : 'bg-slate-100 ring-slate-200'
                }`}>
                  <Icon className={`h-3.5 w-3.5 ${enabled ? 'text-emerald-700' : 'text-slate-500'}`} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-slate-900">{t.label}</span>
                    {enabled && (
                      <span className="rounded bg-emerald-100 px-1.5 py-px text-[9px] font-bold uppercase text-emerald-700">On</span>
                    )}
                  </div>
                  <p className="mt-0.5 text-[11px] text-slate-600 leading-snug">{t.description}</p>
                </div>
                <label className="flex items-center shrink-0">
                  <input
                    type="checkbox"
                    checked={Boolean(data[t.key])}
                    disabled={disabled || updateMutation.isPending}
                    onChange={(e) => updateMutation.mutate({ [t.key]: e.target.checked } as Partial<FlagsPayload>)}
                    className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 disabled:opacity-50"
                  />
                </label>
              </div>
            );
          })}
        </div>

        {updateMutation.isPending && (
          <div className="mt-2 inline-flex items-center gap-1.5 text-[11px] text-slate-500">
            <Loader2 className="h-3 w-3 animate-spin" /> Saving…
          </div>
        )}
      </div>

      <div className="rounded-xl border border-blue-100 bg-blue-50/40 p-3 text-[11px] text-slate-700">
        <strong>Safety note:</strong> auto-created issues are de-duplicated against existing open issues for the same
        source entity, so toggling a flag on won&apos;t flood the queue. Each spawned issue logs its trigger in the activity feed.
      </div>
    </div>
  );
}
