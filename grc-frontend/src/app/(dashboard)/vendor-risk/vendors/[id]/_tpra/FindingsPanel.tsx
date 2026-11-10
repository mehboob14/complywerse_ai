'use client';

// The findings of one assessment (the lifecycle's Findings stage): the same cards as the vendor record's Findings tab and the Findings register's drawer (THE finding card), filtered by
// status and severity, with the removed ones on request. RBAC as the server holds it; the cards do the rest. A list that could not be read says so (it used to read as "No findings").
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, ShieldCheck } from 'lucide-react';
import { Button, Checkbox, EmptyState, ErrorState, Select, SkeletonRows, useReportedMutation } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { tpraApi } from '@/lib/api';
import { statusLabel } from '@/lib/format';
import { usePeople } from '../../../_lib/actions/shared';
import { refreshFindings, type FindingRow } from '../../../_lib/findingsApi';
import { blockingLine } from '../../../_lib/findingCardModel';
import { useFindingRights } from './FindingCard';
import FindingList, { useSharedFindings } from './FindingList';
import { RaiseFindingDialog } from './FindingDialogs';
import { FINDING_STATUSES, SEVERITIES } from './constants';

export default function FindingsPanel({ assessmentId, initialFindingId }: { assessmentId: number; initialFindingId?: number | null }) {
  const qc = useQueryClient();
  const { rights, canRaise } = useFindingRights();
  const people = usePeople();

  const [statusFilter, setStatusFilter] = useState('');
  const [sevFilter, setSevFilter] = useState('');
  const [showRemoved, setShowRemoved] = useState(false);
  const [raising, setRaising] = useState(false);
  const [problem, setProblem] = useState<unknown>(null);

  const list = useQuery({
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

  const raise = useReportedMutation({
    mutationFn: (p: Record<string, unknown>) => tpraApi.createFinding(assessmentId, p),
    success: 'Finding raised',
    failure: 'Could not raise the finding',
    toast: 'success',
    onError: (e) => setProblem(e),
    onSuccess: () => { refreshFindings(qc); setRaising(false); },
  });

  const findings = list.data?.items || [];
  const shared = useSharedFindings(findings[0]?.vendor_id);
  const blocking = blockingLine(findings);

  return (
    <div className="flex flex-col gap-[12px]">
      <div className="flex flex-wrap items-center justify-between gap-[8px]">
        <div className="flex flex-wrap items-center gap-[8px]">
          <Select aria-label="Filter by status" className="w-[168px]" value={statusFilter} placeholder="All statuses" onChange={(e) => setStatusFilter(e.target.value)}>
            {FINDING_STATUSES.map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
          </Select>
          <Select aria-label="Filter by severity" className="w-[168px]" value={sevFilter} placeholder="All severities" onChange={(e) => setSevFilter(e.target.value)}>
            {SEVERITIES.map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
          </Select>
          <Checkbox label="Show removed" checked={showRemoved} onChange={(e) => setShowRemoved(e.target.checked)} />
        </div>
        {canRaise && <Button variant="primary" leftIcon={<Plus aria-hidden />} onClick={() => { setProblem(null); setRaising(true); }}>Raise finding</Button>}
      </div>
      {blocking && <p className="text-ds-body font-[600] text-ds-danger">{blocking}</p>}

      {list.isLoading ? (
        <SkeletonRows rows={3} columns={2} label="Loading the findings" />
      ) : !list.data ? (
        <ErrorState title="Couldn't load the findings" message={errorMessage(list.error)} onRetry={canRetry(list.error) ? () => { void list.refetch(); } : undefined} />
      ) : findings.length === 0 ? (
        <EmptyState kind="firstUse" icon={ShieldCheck} title="No findings" description="Run scoring to raise critical-control failures, or raise one by hand." />
      ) : (
        <FindingList boxed items={findings} people={people} rights={rights} shared={shared} deepLinkId={initialFindingId} />
      )}

      <RaiseFindingDialog
        open={raising} onClose={() => setRaising(false)} busy={raise.isPending} error={problem} people={people}
        onRaise={(p) => { setProblem(null); raise.mutate({ title: p.title, description: p.description, severity: p.severity, domain: p.domain, owner_id: p.owner_id ?? undefined, is_blocking: p.is_blocking }); }}
      />
    </div>
  );
}
