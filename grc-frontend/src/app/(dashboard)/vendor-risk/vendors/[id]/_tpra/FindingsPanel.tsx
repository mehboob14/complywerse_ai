'use client';

// The findings of one assessment (the lifecycle's Findings stage): the same cards as the vendor record's Findings tab, filtered by
// status and severity, with the removed ones on request. RBAC as the server holds it; the cards do the rest.

import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Plus, ShieldCheck } from 'lucide-react';
import { BTN_PRIMARY, TONE, fmt } from '@/app/(dashboard)/vendor-risk/_ui';
import { useToast } from '@/components/ui/ToastProvider';
import { usePermissions } from '@/hooks/usePermissions';
import { apiErrorText } from '@/lib/apiError';
import { tpraApi } from '@/lib/api';
import { usePeople } from '../../../_lib/actions/shared';
import { refreshFindings, type FindingRow } from '../../../_lib/findingsApi';
import { blockingLine } from '../../../_lib/findingsModel';
import { requestsApi } from '../../../_lib/requestsApi';
import FindingCard from './FindingCard';
import { RaiseFindingDialog } from './FindingDialogs';
import { FINDING_STATUSES, SEVERITIES } from './constants';

const SELECT = 'h-8 rounded-lg border border-[#c3ccd5] bg-[#fff] px-2 text-[13px] text-[#1f2933] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f766e]';

export default function FindingsPanel({ assessmentId, initialFindingId }: { assessmentId: number; initialFindingId?: number | null }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { hasPermission } = usePermissions();
  const erm = hasPermission('erm:risks:edit');          // the fallback every vendor-risk write accepts
  const rights = {
    edit: hasPermission('vendor_risk:findings:edit') || erm,
    accept: hasPermission('vendor_risk:findings:accept_risk'),          // no fallback: the approver's own right
    remove: hasPermission('vendor_risk:findings:delete') || erm,
  };
  const canRaise = hasPermission('vendor_risk:findings:create') || erm;
  const people = usePeople();

  const [statusFilter, setStatusFilter] = useState('');
  const [sevFilter, setSevFilter] = useState('');
  const [showRemoved, setShowRemoved] = useState(false);
  const [raising, setRaising] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(initialFindingId ?? null);
  // Open + scroll to a deep-linked finding once it appears in the loaded list.
  const deepLinkDone = useRef(false);

  const { data, isLoading } = useQuery({
    queryKey: ['tpra-findings', assessmentId, statusFilter, sevFilter, showRemoved],
    queryFn: async () => {
      const res = await tpraApi.listFindings(assessmentId, {
        status: statusFilter || undefined,
        severity: sevFilter || undefined,
        include_deleted: showRemoved || undefined,
      });
      return res.data as { items: FindingRow[]; total: number };
    },
  });

  const raise = useMutation({
    mutationFn: (p: Record<string, unknown>) => tpraApi.createFinding(assessmentId, p),
    onSuccess: () => { refreshFindings(qc); setRaising(false); toast({ type: 'success', title: 'Finding raised' }); },
    onError: (e) => toast({ type: 'error', title: 'Could not raise the finding', message: apiErrorText(e, 'Try again.') }),
  });

  const findings = data?.items || [];
  // Findings shared with the vendor and not finished: one request each at a time.
  const vendorId = findings[0]?.vendor_id;
  const { data: asked } = useQuery({
    queryKey: ['tprm-supplier-requests', vendorId],
    queryFn: async () => (await requestsApi.list(vendorId as number)).data,
    enabled: !!vendorId,
  });
  const sharedOf = new Map((asked?.items || [])
    .filter((r) => r.finding && ['open', 'submitted', 'returned'].includes(r.status))
    .map((r) => [r.finding!.id, r] as const));

  useEffect(() => {
    if (deepLinkDone.current || initialFindingId == null) return;
    if (findings.some((f) => f.id === initialFindingId)) {
      setExpanded(initialFindingId);
      deepLinkDone.current = true;
      // After the card has drawn, bring it into view.
      setTimeout(() => document.getElementById(`tpra-finding-${initialFindingId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 0);
    }
  }, [findings, initialFindingId]);

  const blocking = blockingLine(findings);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <select aria-label="Filter by status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className={SELECT}>
            <option value="">All statuses</option>
            {FINDING_STATUSES.map((s) => <option key={s} value={s}>{fmt.status(s)}</option>)}
          </select>
          <select aria-label="Filter by severity" value={sevFilter} onChange={(e) => setSevFilter(e.target.value)} className={SELECT}>
            <option value="">All severities</option>
            {SEVERITIES.map((s) => <option key={s} value={s}>{fmt.status(s)}</option>)}
          </select>
          <label className="flex items-center gap-1.5 text-[13px] text-[#586472]">
            <input type="checkbox" checked={showRemoved} onChange={(e) => setShowRemoved(e.target.checked)} className="h-3.5 w-3.5 accent-[#0f766e]" />
            Show removed
          </label>
        </div>
        {canRaise && (
          <button type="button" onClick={() => setRaising(true)} className={BTN_PRIMARY}>
            <Plus aria-hidden className="h-4 w-4" /> Raise finding
          </button>
        )}
      </div>
      {blocking && <p className="text-[13px] font-semibold" style={{ color: TONE.danger.text }}>{blocking}</p>}

      {isLoading ? (
        <div className="flex items-center gap-2 py-8 text-sm text-[#586472]">
          <Loader2 aria-hidden className="h-4 w-4 animate-spin" /> Loading findings…
        </div>
      ) : findings.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[#c3ccd5] bg-[#fff] p-6 text-center">
          <ShieldCheck aria-hidden className="mx-auto mb-2 h-6 w-6" style={{ color: TONE.success.dot }} />
          <p className="text-sm font-medium text-[#1f2933]">No findings</p>
          <p className="text-[13px] text-[#586472]">Run scoring to raise critical-control failures, or raise one by hand.</p>
        </div>
      ) : (
        <ul className="divide-y divide-[#e1e6eb] rounded-xl border border-[#d5dbe1] bg-[#fff] px-4">
          {findings.map((f) => (
            <FindingCard
              key={f.id} finding={f} people={people} rights={rights} shared={sharedOf.get(f.id)}
              expanded={expanded === f.id} onToggle={() => setExpanded(expanded === f.id ? null : f.id)}
              highlight={initialFindingId === f.id}
            />
          ))}
        </ul>
      )}

      <RaiseFindingDialog
        open={raising} onClose={() => setRaising(false)} busy={raise.isPending} people={people}
        onRaise={(p) => raise.mutate({ title: p.title, description: p.description, severity: p.severity, domain: p.domain,
          owner_id: p.owner_id ?? undefined, is_blocking: p.is_blocking })}
      />
    </div>
  );
}
