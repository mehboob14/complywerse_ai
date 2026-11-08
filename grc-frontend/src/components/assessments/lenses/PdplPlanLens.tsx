'use client';

/**
 * The PDPL action plan: every control scored below 3 as a line of the remediation log (the gap, the action, who, by when) with its fix status to move forward. It is built from the
 * Controls tab (nothing is typed here but the status); the same gaps are on the workspace's Remediation tab with their due dates.
 */
import { useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Wrench } from 'lucide-react';
import { DebouncedSearch, EmptyState, ErrorState, MultiSelect, PersonStack, RegisterTable, Select, SkeletonLines, StatusPill, useAddressState, useReportedMutation, type ListOption, type RegisterColumn } from '@/components/ui/ds';
import { listOf, text } from '@/lib/addressState';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { rowCountText } from '@/components/ui/ds/tableModel';
import apiClient from '@/lib/api';
import { EMPTY, formatCount } from '@/lib/format';
import { priority as priorityWords, statusPill } from '@/lib/status';
import { remediationState } from '@/lib/statuses/assessments';
import type { LensProps } from '../workspace/lens';
import { matchesText } from './lensData';
import { LensFigures } from './LensFigures';

interface Plan {
  id: number; control_id: string | null; domain: string | null; pdpl_ref: string | null; risk: string | null; gap: string | null; remediation_action: string | null; priority: string | null;
  owner: string | null; target_date: string | null; remediation_status: string; assignees?: Array<{ name: string }>;
}
interface PlanResponse { items: Plan[]; summary: { total: number; open: number; in_progress: number; closed: number; closure_pct: number } }

const SCHEMA = { q: text(), fix: listOf(['open', 'in_progress', 'closed']) };
const STATES: ListOption[] = ['open', 'in_progress', 'closed'].map((s) => ({ value: s, label: remediationState.label(s) }));

export default function PdplPlanLens({ assessmentId, readOnly, onChanged }: LensProps) {
  const qc = useQueryClient();
  const [a, set] = useAddressState(SCHEMA);
  const q = useQuery({
    queryKey: ['assessment-lens-pdpl-plan', assessmentId], staleTime: 15_000,
    queryFn: async () => (await apiClient.get('/compliance/assessments/remediation-plan', { params: { assessment_id: assessmentId } })).data as PlanResponse,
  });
  const move = useReportedMutation({
    mutationFn: async ({ id, status }: { id: number; status: string }) => (await apiClient.patch(`/compliance/assessments/remediation-items/${id}`, { remediation_status: status })).data,
    failure: "Couldn't change the fix status",
    toast: 'errors',
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['assessment-lens-pdpl-plan', assessmentId] }); onChanged(); },
  });
  const rows = useMemo(() => (q.data?.items ?? []).filter((r) => (a.fix.length === 0 || a.fix.includes(r.remediation_status)) && matchesText(`${r.control_id} ${r.domain} ${r.gap} ${r.remediation_action} ${r.owner} ${r.pdpl_ref}`, a.q)), [q.data, a.q, a.fix]);

  if (q.isPending) return <SkeletonLines lines={5} label="Loading the action plan" />;
  if (q.isError || !q.data) return <ErrorState title="Couldn't load the action plan" message={errorMessage(q.error)} onRetry={canRetry(q.error) ? () => { void q.refetch(); } : undefined} />;
  const s = q.data.summary;
  const filtering = a.q.trim() !== '' || a.fix.length > 0;

  const columns: Array<RegisterColumn<Plan>> = [
    {
      key: 'control', header: 'Control', isRowHeader: true, width: 'w-[34%]',
      cell: (r) => (<span className="block min-w-0"><span className="block text-ds-label text-ds-fg-muted">{r.control_id || EMPTY}{r.domain ? ` · ${r.domain}` : ''}{r.pdpl_ref ? ` · ${r.pdpl_ref}` : ''}</span><span className="line-clamp-3 break-words text-ds-body text-ds-fg" title={r.gap ?? ''}>{r.gap || EMPTY}</span></span>),
    },
    { key: 'action', header: 'Action', priority: 2, card: 'meta', cell: (r) => <span className="line-clamp-3 break-words text-ds-body text-ds-fg-body" title={r.remediation_action ?? ''}>{r.remediation_action || EMPTY}</span> },
    { key: 'priority', header: 'Priority', priority: 2, card: 'meta', cell: (r) => (r.priority ? <StatusPill {...statusPill(priorityWords, r.priority)} size="sm" /> : <span className="text-ds-body text-ds-fg-muted">{EMPTY}</span>) },
    { key: 'owner', header: 'Assigned to', priority: 3, card: 'meta', cell: (r) => <PersonStack people={(r.assignees ?? []).map((x) => x.name)} size={24} max={2} label="Assigned to" emptyLabel={r.owner || 'Unassigned'} /> },
    { key: 'target', header: 'Target', priority: 3, card: 'meta', cell: (r) => <span className="text-ds-body text-ds-fg-body">{r.target_date || EMPTY}</span> },
    {
      key: 'fix', header: 'Fix status', card: 'meta',
      cell: (r) => (
        <Select aria-label={`Fix status of ${r.control_id || 'the control'}`} value={r.remediation_status} disabled={readOnly || (move.isPending && move.variables?.id === r.id)} onChange={(e) => move.mutate({ id: r.id, status: e.target.value })} className="min-w-[140px]">
          {STATES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </Select>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-[16px]">
      <LensFigures figures={[
        { label: 'Gaps', value: formatCount(s.total), note: 'controls scored below 3' },
        { label: 'Open', value: formatCount(s.open), tone: s.open ? 'danger' : 'default' },
        { label: 'In progress', value: formatCount(s.in_progress), tone: s.in_progress ? 'warning' : 'default' },
        { label: 'Closed', value: formatCount(s.closed), unit: `${Math.round(s.closure_pct)}%`, tone: s.closed ? 'success' : 'default', progress: s.total ? s.closure_pct : null },
      ]} />
      <div className="flex flex-wrap items-center gap-[8px]">
        <DebouncedSearch className="w-full sm:w-[280px]" label="Search the action plan" placeholder="Search the plan" value={a.q} onSearch={(v) => set({ q: v })} />
        <MultiSelect className="w-full sm:w-auto" label="Fix status" showLabel placeholder="All" options={STATES} value={a.fix} onChange={(v) => set({ fix: v })} />
        <span className="ml-auto text-ds-label text-ds-fg-muted" role="status">{rowCountText({ shown: rows.length, total: rows.length, noun: 'gap' })}{filtering ? ` of ${formatCount(q.data.items.length)}` : ''}</span>
      </div>
      {q.data.items.length === 0 ? <EmptyState kind="firstUse" icon={Wrench} title="No gap to act on" description="Score controls on the Controls tab: any scored below 3 appears here." />
        : rows.length === 0 ? <EmptyState kind="noMatches" title="No gap matches" description="Change or clear the filters." onClearFilters={() => set({ q: '', fix: [] })} />
        : <RegisterTable caption="PDPL action plan" columns={columns} rows={rows} getRowId={(r) => r.id} cardTitle={(r) => <span className="block min-w-0"><span className="block text-ds-label text-ds-fg-muted">{r.control_id || EMPTY}</span><span className="line-clamp-3 break-words text-ds-body font-[600] text-ds-fg">{r.gap || EMPTY}</span></span>} />}
    </div>
  );
}
