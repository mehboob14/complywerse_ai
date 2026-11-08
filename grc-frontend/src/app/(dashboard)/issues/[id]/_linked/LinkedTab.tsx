'use client';

// The Linked records tab: every record this issue is linked to, grouped by kind (vulnerabilities, risks, assets, controls, evidence, vendors, projects, documents, tasks). A row opens its record;
// "Unlink" takes the link away (the record itself is untouched); "Add a link" opens a searchable list of the records of one kind. Only the kinds that have something linked are read when the tab
// opens. Tasks are shown and opened but not linked from here (no route does it: a promoted action keeps its twin in Task Management). Adding and unlinking need the right to edit issues, which
// is what the server asks. Every write says what happened or why it failed; a kind that could not be read says so with Retry.
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ArrowUpRight, Link2, Unlink } from 'lucide-react';
import { Button, EmptyState, ErrorState, Menu, SectionCard, SkeletonRows, StatusPill, useConfirm, useReportedMutation, type MenuItem } from '@/components/ui/ds';
import { errorMessage } from '@/components/ui/ds/reportOutcome';
import { LinkPicker } from '@/app/(dashboard)/erm/risks/[id]/_workspace/LinkPicker';
import { issuesApi } from '@/lib/api';
import { formatCount, truncate } from '@/lib/format';
import { statusPill } from '@/lib/status';
import { issueSeverity } from '@/lib/statuses/issues';
import { REFRESH, useLinkedRows, type IssueRecord } from '../workspaceData';
import { loadCandidates } from './candidates';
import { FAMILIES, addBody, countOf, familiesWithRecords, linkedRow, linkedTotal, linkedValues, rowSeverity, type Family, type FamilyKey, type LinkedRow } from './linkedModel';

const MUTED = 'text-ds-fg-muted';
type Remover = { remove: (issueId: number, id: number) => Promise<unknown>; add: (issueId: number, body: Record<string, unknown>) => Promise<unknown> };
const apiFor = (family: Exclude<FamilyKey, 'tasks'>): Remover => issuesApi.links[family] as unknown as Remover;

function FamilySection({ issue, family, canEdit, onUnlink }: { issue: IssueRecord; family: Family; canEdit: boolean; onUnlink: (family: FamilyKey, row: LinkedRow) => void }) {
  const q = useLinkedRows(issue.id, family.key, true);
  const rows = useMemo(() => (q.data ?? []).map((r) => linkedRow(family.key, r)), [q.data, family.key]);
  return (
    <SectionCard id={`links-${family.key}`} title={family.label} meta={formatCount(countOf(issue.link_counts, family))}>
      {q.isPending && <div aria-busy="true"><SkeletonRows rows={2} columns={2} label={`Loading the ${family.label.toLowerCase()}`} /></div>}
      {q.isError && <ErrorState compact title={`Couldn't load the ${family.label.toLowerCase()}`} message={errorMessage(q.error)} onRetry={() => { void q.refetch(); }} />}
      {q.data && (
        <ul className="m-0 list-none p-0">
          {rows.map((row) => (
            <li key={row.key} className="flex flex-wrap items-center gap-x-[12px] gap-y-[4px] border-b border-ds-border py-[8px] last:border-b-0">
              <div className="min-w-0 flex-1 basis-[14rem]">
                {row.href ? (
                  <Link href={row.href} dir="auto" className="inline-flex max-w-full items-center gap-[4px] rounded-ds-control text-ds-body font-[600] text-ds-primary-text underline-offset-2 hover:underline focus-visible:outline-none focus-visible:shadow-ds-ring min-h-ds-control">
                    <span className="break-words [overflow-wrap:anywhere]">{row.title}</span><ArrowUpRight aria-hidden size={14} className="shrink-0" />
                  </Link>
                ) : <span dir="auto" className="block break-words text-ds-body font-[600] text-ds-fg [overflow-wrap:anywhere]">{row.title}</span>}
                {row.sub && <span className={`block break-words text-ds-label ${MUTED}`}>{row.sub}</span>}
              </div>
              <div className="flex shrink-0 items-center gap-[8px]">
                {rowSeverity(row) && <StatusPill size="sm" {...statusPill(issueSeverity, rowSeverity(row) as string)} />}
                {canEdit && row.unlink && <Button size="sm" aria-label={`Unlink ${truncate(row.title, 60).text}`} leftIcon={<Unlink aria-hidden />} onClick={() => onUnlink(family.key, row)}>Unlink</Button>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

function PickerHost({ issue, family, onClose }: { issue: IssueRecord; family: Family; onClose: () => void }) {
  const key = family.key as Exclude<FamilyKey, 'tasks'>;
  const list = useQuery({ queryKey: ['issues', 'workspace', 'candidates', key], queryFn: () => loadCandidates(key), staleTime: 60_000, retry: 1 });
  const have = useLinkedRows(issue.id, key, true);
  const [pending, setPending] = useState<string | null>(null);
  const taken = useMemo(() => linkedValues(key, have.data ?? []), [key, have.data]);
  const items = useMemo(() => (list.data ?? []).filter((i) => !taken.has(i.value)), [list.data, taken]);
  const add = useReportedMutation({
    mutationFn: async (value: string) => apiFor(key).add(issue.id, addBody(key, value) as Record<string, unknown>),
    success: () => `${family.noun.charAt(0).toUpperCase()}${family.noun.slice(1)} linked`,
    failure: "Couldn't link it",
    invalidate: REFRESH,
    onSuccess: () => setPending(null),
    onError: () => setPending(null),
  });
  return (
    <LinkPicker
      open
      onClose={onClose}
      title={`Link a ${family.noun}`}
      searchLabel={`Search ${family.label.toLowerCase()}`}
      items={items}
      loading={list.isPending || have.isPending}
      error={list.error ?? have.error}
      onRetry={() => { void list.refetch(); void have.refetch(); }}
      onPick={(value) => { if (addBody(key, value)) { setPending(value); add.mutate(value); } }}
      pending={pending}
      empty={`Every ${family.noun} is already linked.`}
    />
  );
}

export function LinkedTab({ issue, canEdit }: { issue: IssueRecord; canEdit: boolean }) {
  const { confirm, confirmDialog } = useConfirm();
  const [picking, setPicking] = useState<FamilyKey | null>(null);
  const total = linkedTotal(issue.link_counts);
  const shown = familiesWithRecords(issue.link_counts);

  const unlink = useReportedMutation({
    mutationFn: async (v: { family: Exclude<FamilyKey, 'tasks'>; row: LinkedRow }) => apiFor(v.family).remove(issue.id, (v.row.unlink as { id: number }).id),
    success: 'Unlinked', failure: "Couldn't unlink it", invalidate: REFRESH,
  });
  const askUnlink = async (family: FamilyKey, row: LinkedRow) => {
    if (family === 'tasks') return;
    const yes = await confirm({ title: 'Unlink this record?', message: `“${truncate(row.title, 80).text}” stays as it is. It just stops being linked to this issue.`, confirmLabel: 'Unlink' });
    if (yes) unlink.mutate({ family, row });
  };
  const addItems: MenuItem[] = FAMILIES.filter((f) => f.canAdd).map((f) => ({ key: f.key, label: `A ${f.noun}`, onSelect: () => setPicking(f.key) }));
  const picker = picking ? FAMILIES.find((f) => f.key === picking) ?? null : null;

  return (
    <div className="flex flex-col gap-[16px]">
      <div className="flex flex-wrap items-center gap-[12px]">
        <span className={`text-ds-body ${MUTED}`}>{total === 0 ? 'Nothing is linked yet' : `${formatCount(total)} linked ${total === 1 ? 'record' : 'records'}`}</span>
        {canEdit && <span className="ml-auto"><Menu label="Add a link" items={addItems} /></span>}
      </div>
      {total === 0 ? (
        <EmptyState
          bare kind="firstUse" icon={Link2} title="No linked records"
          description={canEdit ? 'Link the risks, assets, controls, evidence and other records this issue is about.' : 'Nothing this issue is about has been linked yet.'}
        />
      ) : (
        shown.map((f) => <FamilySection key={f.key} issue={issue} family={f} canEdit={canEdit} onUnlink={(family, row) => { void askUnlink(family, row); }} />)
      )}
      {picker && <PickerHost key={picker.key} issue={issue} family={picker} onClose={() => setPicking(null)} />}
      {confirmDialog}
    </div>
  );
}
