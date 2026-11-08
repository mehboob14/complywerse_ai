'use client';

// The issue register (Issue & Incident Management > Issues): the Facet explorer over every issue (read whole, lean rows), a board by state and a details drawer that carries the
// guided next step. It replaces the Enterprise Log and Contract Compliance tabs: the state of the page is in its address (a filter, a chip, a sort, the open issue), `?category=contract`
// is the old Contract tab, and `?linked=risk:7` is "the issues linked to this record" that a record's panel links to. For a tenant that keeps the client's audit register, a switch in the
// head swaps the platform's issues for that register (as the page did). Raising and importing issues need the right to create them, and a step needs the right to edit: what the server asks.
import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { ArrowUpRight, Plus, Upload } from 'lucide-react';
import { PageHeader } from '@/components/ui';
import {
  Button, EmptyState, Menu, Notice, SegmentedControl, SkeletonRows, useConfirm, useReportedMutation, type MenuItem,
} from '@/components/ui/ds';
import { errorMessage } from '@/components/ui/ds/reportOutcome';
import { AuditRegister } from '@/components/audit-register/AuditRegister';
import { ImportDialog } from '@/components/records/ImportDialog';
import { OwnerCell } from '@/components/records/cells';
import { useCurrentUserId } from '@/components/records/lookups';
import { RecordDetail, RegisterFrame } from '@/components/records/RegisterFrame';
import type { RecordColumn, RecordRow } from '@/components/records/RecordTable';
import { usePermissions } from '@/hooks/usePermissions';
import { auditRegisterApi, issuesApi } from '@/lib/api';
import { UNASSIGNED, formatCount, formatDate, truncate } from '@/lib/format';
import { ISSUE_SCHEMA, codeOf, issueCounts, issueDef, personName, type IssueRow } from '@/lib/issues/issueDef';
import { LINKED_KINDS, parseLinked, sourceWord, stepsFrom, type IssueStep } from '@/lib/issues/words';
import { issueState } from '@/lib/statuses/issues';
import { IssueForm } from '../../_components/IssueForm';
import { IssueDetail, LatePill, SeverityPill, StatePill } from './IssueDetail';
import { useIssueRows } from './issueData';
import { StepDialog } from './StepDialog';

const MUTED = 'text-ds-fg-muted';
const REGISTER_KEY = 'issues.register';
type RegisterType = 'audit' | 'platform';
const STEPPED_KEYS = [['issues'], ['issue-detail'], ['issue-activity'], ['issues-dashboard']];

export default function IssueRegister({ label }: { label: string }) {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const qc = useQueryClient();
  const { hasPermission } = usePermissions();
  const canCreate = hasPermission('issue_management:issues:create');
  const canEdit = hasPermission('issue_management:issues:edit');
  const { confirm, confirmDialog } = useConfirm();
  const me = useCurrentUserId();
  const def = useMemo(() => issueDef(me), [me]);
  const [raising, setRaising] = useState(false);
  const [importing, setImporting] = useState(false);
  const [asking, setAsking] = useState<{ issue: IssueRow; step: IssueStep } | null>(null);

  // ── which register: a tenant with the client's audit register opens it first (as /issues always did) ──
  const status = useQuery<{ has_register: boolean; last_import: { file_name: string | null } | null }>({
    queryKey: ['audit-register-status'], queryFn: async () => (await auditRegisterApi.status()).data, retry: false, staleTime: 60_000,
  });
  const [choice, setChoice] = useState<RegisterType | null>(null);
  useEffect(() => {
    let saved: string | null = null;
    try { saved = localStorage.getItem(REGISTER_KEY); } catch { /* private window: no memory of the choice */ }
    const wanted = params.get('register') || saved;
    if (wanted === 'audit' || wanted === 'platform') setChoice(wanted);
  }, [params]);
  const hasRegister = !!status.data?.has_register;
  const register: RegisterType = hasRegister ? (choice ?? 'audit') : 'platform';
  const templateName = (status.data?.last_import?.file_name || 'the client template').replace(/\.(xlsb|xlsx|xlsm)$/i, '');
  const pickRegister = (value: RegisterType) => {
    setChoice(value);
    try { localStorage.setItem(REGISTER_KEY, value); } catch { /* private window */ }
    const next = new URLSearchParams(params.toString());
    next.set('register', value);
    router.replace(`${pathname}?${next.toString()}`);
  };
  const switcher = hasRegister ? (
    <SegmentedControl
      label="Register" name="issues-register-kind" value={register} onChange={pickRegister}
      options={[{ value: 'platform', label: 'Platform issues' }, { value: 'audit', label: 'Audit register' }]}
    />
  ) : null;

  // ── the platform's issues ──
  const linked = parseLinked(params.get('linked'));
  const list = useIssueRows(linked);
  const rows = list.data?.items ?? [];
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { if (list.dataUpdatedAt) setNow(new Date()); }, [list.dataUpdatedAt]);
  const counts = useMemo(() => issueCounts(rows, now), [rows, now]);
  const showAll = () => {
    const next = new URLSearchParams(params.toString());
    next.delete('linked');
    next.delete('page');
    router.replace(next.toString() ? `${pathname}?${next.toString()}` : pathname);
  };

  const step = useReportedMutation({
    mutationFn: async (v: { issue: IssueRow; step: IssueStep; text?: string }) => {
      if (v.step.kind === 'close') return (await issuesApi.close(v.issue.id, { closure_notes: v.text ?? '' })).data;
      if (v.step.kind === 'reopen') return (await issuesApi.reopen(v.issue.id, { reason: v.text ?? '' })).data;
      return (await issuesApi.transition(v.issue.id, { to_state: v.step.to })).data;
    },
    success: (_d, v) => (v.step.kind === 'close' ? 'Closure approved' : v.step.kind === 'reopen' ? 'Issue reopened' : v.step.to === 'cancelled' ? 'Issue cancelled' : `Moved to ${issueState.label(v.step.to)}`),
    failure: "Couldn't change the issue",
    invalidate: STEPPED_KEYS,
    onSuccess: () => setAsking(null),
  });
  const run = async (issue: IssueRow, s: IssueStep) => {
    if (s.kind === 'close' || s.kind === 'reopen') { setAsking({ issue, step: s }); return; }
    if (s.danger) {
      const yes = await confirm({ title: 'Cancel this issue?', message: `“${truncate(issue.title, 80).text}” will be cancelled. You can reopen it later.`, confirmLabel: 'Cancel issue', tone: 'danger' });
      if (!yes) return;
    }
    step.mutate({ issue, step: s });
  };
  const stepItems = (i: IssueRow): MenuItem[] => (canEdit ? stepsFrom(i.workflow_state).map((s) => ({ key: s.key, label: s.label, danger: s.danger, onSelect: () => { void run(i, s); } })) : []);
  const menuFor = (i: IssueRow): MenuItem[] => [{ key: 'open', label: 'Open issue', icon: ArrowUpRight, onSelect: () => router.push(`/issues/${i.id}`) }, ...stepItems(i)];

  const columns: RecordColumn<IssueRow>[] = [
    {
      key: 'title', header: 'Issue', sortKey: 'title',
      cell: (row) => (
        <div className="min-w-0">
          <span className="line-clamp-2 break-words text-ds-body font-[600] text-ds-fg" title={row.record.title}>{row.record.title}</span>
          <span className={`block truncate text-ds-label ${MUTED}`}>{[codeOf(row.record), sourceWord(row.record.source_type)].join(' · ')}</span>
        </div>
      ),
    },
    { key: 'severity', header: 'Severity', sortKey: 'severity', fit: { px: 112 }, cell: (row) => <SeverityPill i={row.record} /> },
    { key: 'state', header: 'State', sortKey: 'state', fit: { px: 136 }, cell: (row) => <StatePill i={row.record} /> },
    {
      key: 'due', header: 'Target', sortKey: 'due', fit: { px: 132, dropRank: 2 },
      cell: (row) => (
        <div className="flex flex-col items-start gap-[2px]">
          <span className={`whitespace-nowrap text-ds-body ${row.record.target_closure_date ? 'text-ds-fg-body' : MUTED}`}>{formatDate(row.record.target_closure_date)}</span>
          <LatePill i={row.record} now={now} />
        </div>
      ),
    },
    { key: 'assignee', header: 'Assigned to', sortKey: 'assignee', fit: { px: 96, dropRank: 3, wide: { px: 168, titleMin: 420 } }, cell: (row, look) => <OwnerCell name={personName(row.record.assignee)} wide={look.wide} /> },
    {
      key: 'actions', header: 'Actions', sortKey: 'actions', firstDir: 'desc', fit: { px: 84, dropRank: 1 },
      cell: (row) => {
        const total = row.record.action_count ?? 0;
        return total > 0
          ? <span className="whitespace-nowrap tabular-nums text-ds-body text-ds-fg-body" title={`${row.record.actions_done ?? 0} of ${total} corrective actions done`}>{`${row.record.actions_done ?? 0}/${total}`}</span>
          : <span className={`text-ds-body ${MUTED}`} title="No corrective actions"><span aria-hidden>—</span><span className="sr-only">No corrective actions</span></span>;
      },
    },
  ];
  const meta = (i: IssueRow): string => [codeOf(i), i.target_closure_date ? `target ${formatDate(i.target_closure_date)}` : null, personName(i.assignee) || UNASSIGNED].filter(Boolean).join(' · ');
  const card = (row: RecordRow<IssueRow>) => (
    <div className="flex min-w-0 flex-col gap-[6px]">
      <span className="line-clamp-2 break-words text-ds-body font-[600] text-ds-fg">{row.record.title}</span>
      <span className="flex flex-wrap items-center gap-[8px]"><SeverityPill i={row.record} /><StatePill i={row.record} /><LatePill i={row.record} now={now} /></span>
      <span className={`truncate text-ds-label ${MUTED}`}>{meta(row.record)}</span>
    </div>
  );
  const boardCard = (i: IssueRow) => (
    <>
      <span className="line-clamp-2 text-ds-body font-[600] text-ds-fg [overflow-wrap:anywhere]">{i.title}</span>
      <span className="flex flex-wrap items-center gap-[8px]"><SeverityPill i={i} /><LatePill i={i} now={now} /></span>
      <span className={`truncate text-ds-label ${MUTED}`}>{meta(i)}</span>
    </>
  );

  const raiseButtons = canCreate ? (
    <>
      <Button leftIcon={<Upload aria-hidden />} onClick={() => setImporting(true)}>Import</Button>
      <Button variant="primary" leftIcon={<Plus aria-hidden />} onClick={() => setRaising(true)}>Raise issue</Button>
    </>
  ) : null;
  const headMeta = list.data ? [`${formatCount(list.data.total)} ${list.data.total === 1 ? 'issue' : 'issues'}`, `${formatCount(counts.open)} open`, `${formatCount(counts.late)} late`].join(' · ') : undefined;
  const INFO = 'Everything that broke or was found broken, with who is on it and when it is due. Open means not yet closed or cancelled; late means the target date has passed and it is still open.';

  if (status.isLoading) {
    return (
      <div className="flex flex-col gap-[16px]">
        <PageHeader variant="page" title={label} info={INFO} />
        <div aria-busy="true" className="rounded-ds-card border border-ds-border bg-ds-surface p-[12px]"><SkeletonRows rows={8} columns={5} label="Loading the issues" /></div>
      </div>
    );
  }
  if (register === 'audit') {
    return (
      <div className="flex flex-col gap-[16px]">
        <PageHeader variant="page" title={label} info={`The audit register in the client's own template (${templateName}). Every finding is also a platform issue with its owner, actions and links.`} actions={switcher} />
        <AuditRegister initialSource={params.get('source') || ''} />
      </div>
    );
  }

  return (
    <>
      <RegisterFrame
        def={def}
        schema={ISSUE_SCHEMA}
        label={label}
        rows={rows}
        loading={list.isLoading}
        error={list.isError && !list.data ? list.error : undefined}
        refreshError={list.isError && list.data ? list.error : undefined}
        onRetry={() => { void list.refetch(); }}
        serverTotal={list.data?.total}
        head={() => <PageHeader variant="page" title={label} info={INFO} meta={headMeta} actions={<>{switcher}{raiseButtons}</>} />}
        notices={linked ? (
          <Notice tone="info" title={`Showing the issues linked to ${LINKED_KINDS[linked.type]}`} action={<Button onClick={showAll}>Show all issues</Button>}>
            The filters below work inside these.
          </Notice>
        ) : undefined}
        columns={columns}
        card={card}
        boardCard={boardCard}
        boardLabel={(i) => i.title}
        rowActions={(i) => <Menu iconOnly label={`Actions for ${truncate(i.title, 60).text}`} items={menuFor(i)} />}
        rowLabel={(i) => `Select ${truncate(i.title, 60).text}`}
        searchLabel="Search issues by code, title, person, source, type or category"
        noAccess={{ title: "You don't have access to the issues", reason: errorMessage(list.error) }}
        emptyFirst={(
          <EmptyState
            bare kind="firstUse" title={linked ? 'No issues linked to this record' : 'No issues raised'}
            description={linked ? 'Nothing has been raised against it yet.' : canCreate ? 'Raise one, or import a file of them.' : 'No issues have been raised yet.'}
            action={linked ? <Button onClick={showAll}>Show all issues</Button> : canCreate ? <Button variant="primary" leftIcon={<Plus aria-hidden />} onClick={() => setRaising(true)}>Raise issue</Button> : undefined}
          />
        )}
        detail={(open, nav) => {
          const steps = open && canEdit ? stepsFrom(open.workflow_state) : [];
          const primary = steps.find((s) => s.primary) ?? null;
          const rest = steps.filter((s) => s !== primary);
          return (
            <RecordDetail
              id={open?.id ?? null}
              nav={nav}
              title={<span dir="auto" className="line-clamp-3 break-words" title={open?.title}>{open?.title}</span>}
              subtitle={open ? [codeOf(open), open.workflow_state ? issueState.label(open.workflow_state) : null].filter(Boolean).join(' · ') : undefined}
              footer={open ? (
                <div className="flex flex-wrap items-center gap-[8px]">
                  {primary && <Button variant="primary" loading={step.isPending} onClick={() => { void run(open, primary); }}>{primary.label}</Button>}
                  <Button href={`/issues/${open.id}`} variant={primary ? 'secondary' : 'primary'} rightIcon={<ArrowUpRight aria-hidden />}>Open issue</Button>
                  {rest.length > 0 && <Menu label="More" items={rest.map((s) => ({ key: s.key, label: s.label, danger: s.danger, onSelect: () => { void run(open, s); } }))} />}
                </div>
              ) : undefined}
            >
              {open && <IssueDetail i={open} now={now} />}
            </RecordDetail>
          );
        }}
      />
      {raising && <IssueForm open onClose={() => setRaising(false)} />}
      {importing && (
        <ImportDialog
          title="Import issues" noun="issues" accept=".csv,.xlsx,.xls" extensions={/\.(csv|xlsx|xls)$/i} onClose={() => setImporting(false)}
          onAdded={() => { void qc.invalidateQueries({ queryKey: ['issues'] }); void qc.invalidateQueries({ queryKey: ['issues-dashboard'] }); }}
          template={async () => { await issuesApi.downloadTemplate(); }}
          run={async (file) => {
            const r = (await issuesApi.importIssues(file)).data;
            const errors = r.errors ?? [];
            return { message: r.message || `${r.imported} of ${r.total_rows} issues imported`, added: r.imported ?? 0, errors: errors.slice(0, 8), moreErrors: Math.max(0, (r.total_errors ?? errors.length) - 8) };
          }}
        />
      )}
      {asking && (
        <StepDialog
          step={asking.step}
          issueName={`${codeOf(asking.issue)} · ${truncate(asking.issue.title, 80).text}`}
          saving={step.isPending}
          onClose={() => setAsking(null)}
          onSubmit={(text) => step.mutate({ issue: asking.issue, step: asking.step, text })}
        />
      )}
      {confirmDialog}
    </>
  );
}
