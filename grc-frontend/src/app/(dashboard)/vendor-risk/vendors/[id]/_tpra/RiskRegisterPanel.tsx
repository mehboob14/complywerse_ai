'use client';

// Risk-register drawer content — the vendor's inherent/residual posture and the
// bridge into the ERM Risk Register: the residual risk is mirrored there on
// scoring, and each finding can be moved into the register as a vendor-sourced
// third-party risk (with its severity → score).

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ExternalLink, ArrowUpRight, Loader2, ShieldAlert, CheckCircle2 } from 'lucide-react';
import { tpraApi } from '@/lib/api';
import { useToast } from '@/components/ui/ToastProvider';
import { usePermissions } from '@/hooks/usePermissions';
import type { TpraAssessment, Finding } from './types';
import { tierBadge, severityBadge } from './constants';

function errMsg(e: unknown, fallback: string): string {
  return (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || fallback;
}

export default function RiskRegisterPanel({ assessmentId, assessment }: { assessmentId: number; assessment: TpraAssessment }) {
  const qc = useQueryClient();
  const router = useRouter();
  const { toast } = useToast();
  const { hasPermission } = usePermissions();
  const canEdit = hasPermission('vendor_risk:assessments:edit') || hasPermission('erm:risks:edit');

  const { data, isLoading } = useQuery({
    queryKey: ['tpra-findings-risk-drawer', assessmentId],
    queryFn: async () => (await tpraApi.listFindings(assessmentId)).data as { items: Finding[] },
  });
  const findings = (data?.items || []).filter((f) => !f.deleted_at);

  const promote = useMutation({
    mutationFn: (id: number) => tpraApi.promoteFindingToRegister(id),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['tpra-findings-risk-drawer', assessmentId] });
      const riskId = (res?.data as { risk_id?: number })?.risk_id;
      toast({
        type: 'success', title: 'Moved to Risk Register',
        message: riskId ? 'Opening it so you can complete the risk details.' : undefined,
      });
      // Take the user to THIS risk in the ERM register to fill the required fields.
      if (riskId) router.push(`/erm/risks/list?edit=${riskId}`);
    },
    onError: (e) => toast({ type: 'error', title: 'Could not move', message: errMsg(e, 'Try again.') }),
  });

  return (
    <div className="space-y-4">
      {/* Posture summary */}
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-xl border border-gray-200 p-3">
          <p className="text-[11px] text-gray-400">Inherent</p>
          <span className={`mt-1 inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${tierBadge(assessment.inherent_tier)}`}>
            {assessment.inherent_tier || '—'} {assessment.inherent_score != null && `· ${assessment.inherent_score}`}
          </span>
        </div>
        <div className="rounded-xl border border-gray-200 p-3">
          <p className="text-[11px] text-gray-400">Residual (after controls)</p>
          <span className={`mt-1 inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${tierBadge(assessment.residual_rating)}`}>
            {assessment.residual_rating || '—'} {assessment.residual_score != null && `· ${assessment.residual_score}`}
          </span>
        </div>
      </div>

      <div className="flex items-start gap-2 rounded-lg bg-gray-50 p-2.5 text-[11px] text-gray-600">
        <ShieldAlert className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-primary-600" />
        <p>This vendor&apos;s residual risk is mirrored in the ERM Risk Register as a third-party risk and refreshed each time scoring runs. Move individual findings across below.
          <Link href="/erm/risks/list" className="ml-1 inline-flex items-center gap-0.5 font-medium text-primary-600 hover:underline">Open register <ExternalLink className="h-3 w-3" /></Link>
        </p>
      </div>

      {/* Findings → register */}
      <div>
        <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500">Findings</p>
        {isLoading ? (
          <div className="flex items-center gap-2 py-4 text-xs text-gray-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
        ) : findings.length === 0 ? (
          <p className="py-2 text-xs text-gray-400">No findings yet — run scoring to raise them, or add one with &ldquo;Add finding&rdquo; in the Findings list.</p>
        ) : (
          <div className="space-y-1.5">
            {findings.map((f) => (
              <div key={f.id} className="flex items-start justify-between gap-2 rounded-lg border border-gray-200 bg-white p-2.5">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className={`inline-flex items-center rounded-full border px-1.5 text-[10px] font-medium capitalize ${severityBadge(f.severity)}`}>{f.severity}</span>
                    <span className="truncate text-xs font-medium text-slate-800">{f.title || `Finding #${f.id}`}</span>
                  </div>
                  {f.domain && <p className="mt-0.5 text-[11px] capitalize text-gray-400">{f.domain.replace('_', ' ')}</p>}
                </div>
                {f.linked_risk_id ? (
                  <Link href={`/erm/risks/list?edit=${f.linked_risk_id}`} title="Open this risk in the ERM Risk Register"
                    className="inline-flex flex-shrink-0 items-center gap-1 rounded-md bg-emerald-50 px-2 py-1 text-[11px] font-medium text-emerald-600 hover:bg-emerald-100">
                    <CheckCircle2 className="h-3 w-3" /> In register
                  </Link>
                ) : canEdit ? (
                  <button onClick={() => promote.mutate(f.id)} disabled={promote.isPending}
                    className="inline-flex flex-shrink-0 items-center gap-1 rounded-md bg-primary-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-primary-700 disabled:opacity-50">
                    <ArrowUpRight className="h-3 w-3" /> To register
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
