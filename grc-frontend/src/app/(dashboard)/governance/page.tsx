'use client';

export const dynamic = 'force-dynamic';

// Governance > Overview: the ONE overview of Governance (it holds what were two pages, this and Documents > At a glance), in three views of one scope: Summary (how governance
// stands, in graphics: five figures, then the cards), Departments (the departments by status, type, waiting on people, reviews or issues, with a graphic, and the frameworks)
// and Board (the documents as cards by status, type or department, each with where its attestation stands). The scope (the whole organisation, one department with
// everything under it, or "No department"), the view, the board's grouping and the departments' columns are in the address (?dept= &view= &group= &measure=), so a link,
// a reload and Back land on the same place (useReturnToPlace puts the scroll back once the data has rendered). An Export menu downloads the departments or the documents
// as CSV, or a PDF summary.
// The document figures are the scope's (GET /governance/document-overview, one answer, only documents the person may read counted by the server); the scores, the
// throughput, the expiry, the exceptions and the frameworks are the whole organisation's and say so when a department is picked. Each card loads, fails with Retry,
// has nothing or says "No access" on its own; a failed or refused request is never drawn as a 0. A head of a department who reads no library sees their own department.
// The scorecard is computed by the server (/governance/dashboard/documents-overview) and shared with the main dashboard under SCORECARD_QUERY_KEYS.governance; the work
// comes from the inbox queries the top bar already holds. The pieces: _overview/SummaryView.tsx, DepartmentsView.tsx, BoardView.tsx; the document figures' rules are
// _overview/docs/, the scorecard's visualsModel.ts, overviewModel.ts and postureModel.ts.
// On the design-system kit: PageHeader variant="page", Button, Menu, SegmentedControl, Select, Notice, and the chart kit (components/overview/charts).
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { FileCheck, FileText, RefreshCw, SearchX } from 'lucide-react';
import apiClient, { governanceApi, policyExceptionApi } from '@/lib/api';
import { titleFor } from '@/lib/navRegistry';
import { PageHeader } from '@/components/ui';
import { Button, EmptyState, IconButton, Menu, NoAccessState, SegmentedControl, Select, useAddressState } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { SCORECARD_QUERY_KEYS } from '@/components/dashboard/scorecard-query-keys';
import { useNarrow } from '@/components/overview/useNarrow';
import { useReturnToPlace } from '@/components/overview/useReturnToPlace';
import { workOf } from '@/components/overview/workList';
import { oneOf, text } from '@/lib/addressState';
import { useInbox } from '@/lib/inbox/inboxApi';
import { BoardView } from './_overview/BoardView';
import { DepartmentsView } from './_overview/DepartmentsView';
import { PerformanceDialog, type OverviewCard } from './_overview/PerformanceDialog';
import { SummaryView } from './_overview/SummaryView';
import { ExportMenu } from './_overview/docs/_Export';
import { useBoard } from './_overview/docs/_BoardPanel';
import { CARDS_BOARD } from './_overview/docs/_board';
import { DEFAULT_MEASURE, TABLE_MEASURE_IDS, type MeasureId } from './_overview/docs/_matrix';
import { ENDPOINT, asOfText, choiceLabel, failureOf, isEmpty, pickedValue, retryOverview as retryDocs, scopeOptions, scopeParams, statusOf, type Choice, type Overview } from './_overview/docs/_model';
import { DEFAULT_GROUP, DEFAULT_VIEW, GROUP_IDS, VIEW_IDS, VIEWS, type GroupId, type ViewId } from './_overview/docs/_views';
import { GOVERNANCE_SOURCES, retryOverview, type TrendPoint } from './_overview/overviewModel';
import { link, toFeed } from './_overview/parts';
import { usePosture } from './_overview/postureApi';
import type { ExceptionsAnswer } from './_overview/visualsModel';

const ADDRESS = {
  dept: text(),
  view: oneOf<ViewId>(VIEW_IDS, DEFAULT_VIEW),
  group: oneOf<GroupId>(GROUP_IDS, DEFAULT_GROUP),
  measure: oneOf<MeasureId>(TABLE_MEASURE_IDS, DEFAULT_MEASURE),
};
const VIEW_OPTIONS = VIEWS.map((v) => ({ value: v.id, label: v.label }));
const GOVERNANCE_TUNING = { configBase: '/governance/dashboard', invalidateKey: [...SCORECARD_QUERY_KEYS.governance] as unknown[] };
const INFO = 'How governance stands: the score, the documents and who they wait on, by department and on a board. Pick a department to narrow the document figures; the scores, the throughput, the expiry and the exceptions are always the whole organisation.';

export default function GovernanceOverviewPage() {
  const router = useRouter();
  const narrow = useNarrow();
  const [address, setAddress] = useAddressState(ADDRESS);
  const { dept, view, group, measure } = address;
  const [perfOpen, setPerfOpen] = useState(false);
  const now = useMemo(() => new Date(), []);              // the throughput window ends in the month the page was opened in
  const onSummary = view === 'summary';
  const onDepartments = view === 'departments';

  // the document figures of the scope: the Scope picker, the as-of line, the export and three of the views rest on this one answer
  const doc = useQuery<Overview>({
    queryKey: ['gov-doc-overview', dept],
    queryFn: async () => (await apiClient.get(ENDPOINT, { params: scopeParams(dept) })).data as Overview,
    retry: retryDocs,
  });
  // the scope's own picker keeps what it last offered, so a scope that is loading or has failed can still be changed
  const [offered, setOffered] = useState<Choice[]>([]);
  useEffect(() => { if (doc.data) setOffered(doc.data.choices); }, [doc.data]);
  const choices = doc.data?.choices ?? offered;
  const showMine = () => setAddress({ dept: '' });

  // the Summary's requests (their keys are shared: the scorecard with the main dashboard); asked only while the Summary is open
  const expiring = useQuery({
    queryKey: ['governance-expiring-soon'],
    queryFn: async () => (await governanceApi.getExpiringSoon(30)).data as { by_timeframe?: Record<string, number> },
    retry: retryOverview,
    enabled: onSummary,
  });
  // the scorecard: its failure is an error state of its own cards (it used to be swallowed into "no data", which read as zeros)
  const scorecard = useQuery({
    queryKey: [...SCORECARD_QUERY_KEYS.governance],
    queryFn: async () => (await governanceApi.getDocumentsOverview()).data as OverviewCard,
    retry: retryOverview,
    enabled: onSummary,
  });
  // the scorecard GET no longer writes: today's score is kept for the trend by one POST per visit, after the first successful read (a failure is silent: it only costs one trend point)
  const snapshotSent = useRef(false);
  useEffect(() => {
    if (!scorecard.isSuccess || snapshotSent.current) return;
    snapshotSent.current = true;
    governanceApi.snapshotDocumentsOverview().then(undefined, () => undefined);
  }, [scorecard.isSuccess]);
  const trends = useQuery({
    queryKey: ['governance-trends'],
    queryFn: async () => (await governanceApi.getTrends(6)).data as { created?: TrendPoint[]; published?: TrendPoint[] },
    retry: retryOverview,
    enabled: onSummary,
  });
  const exceptions = useQuery({
    queryKey: ['governance-policy-exceptions-summary'],
    queryFn: async () => (await policyExceptionApi.getSummary()).data as ExceptionsAnswer,
    retry: retryOverview,
    enabled: onSummary,
  });
  const posture = usePosture('framework', onDepartments);
  const board = useBoard(dept, group, CARDS_BOARD, view === 'board');
  const { inbox, refetch: refetchInbox, fetchingSource } = useInbox({ freshOnOpen: true });       // asked again on every open, as the Needs-my-action page does: what the person did on a document page shows at once
  const work = workOf(inbox, GOVERNANCE_SOURCES);

  const feeds = { doc: toFeed(doc), expiring: toFeed(expiring), scorecard: toFeed(scorecard), trends: toFeed(trends), exceptions: toFeed(exceptions) };
  const scoped = doc.data ? !doc.data.scope.whole_organisation : dept !== '';

  const refreshAll = () => {
    void doc.refetch();
    if (onSummary) [expiring, scorecard, trends, exceptions].forEach((q) => { void q.refetch(); });
    if (onDepartments) void posture.refetch();
    if (view === 'board') void board.refetch();
    refetchInbox();
  };

  // back returns to the same view at the same place: the address holds the view, this holds the scroll, once the data of the open view has answered
  const asked = view === 'summary' ? [doc, expiring, scorecard, trends, exceptions] : view === 'departments' ? [doc, posture] : [doc, board];
  useReturnToPlace(asked.every((q) => !q.isPending));

  const picker = choices.length > 1 ? (
    <Select aria-label="Scope" value={pickedValue(doc.data, dept)} onChange={(e) => setAddress({ dept: e.target.value })} className="w-[300px] max-w-full">
      {scopeOptions(choices).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </Select>
  ) : choices.length === 1 ? (
    <span className="inline-flex h-ds-control max-w-full items-center truncate rounded-ds-control border border-ds-border-control bg-ds-surface px-[12px] text-ds-body text-ds-fg" title="Scope">
      {choiceLabel(choices[0])}
    </span>
  ) : null;

  // a department that is not the person's to open, or that is gone, is said once for the whole page: every figure of the scope would say it
  const problem = !doc.data && doc.isError ? failureOf(statusOf(doc.error), dept) : null;
  let body;
  if (problem === 'not-yours' || problem === 'not-found') {
    body = problem === 'not-yours' ? (
      <NoAccessState title="Not your department" reason={errorMessage(doc.error)} action={<Button onClick={showMine}>Show mine</Button>} />
    ) : (
      <EmptyState kind="firstUse" icon={SearchX} title="Department not found" action={<Button onClick={showMine}>Show mine</Button>} />
    );
  } else if (view === 'departments') {
    body = <DepartmentsView doc={feeds.doc} measure={measure} onMeasure={(next) => setAddress({ measure: next })} posture={posture} scoped={scoped} />;
  } else if (view === 'board') {
    body = <BoardView query={board} group={group} onGroup={(next) => setAddress({ group: next })} />;
  } else {
    body = (
      <SummaryView
        feeds={feeds} work={work} onRetryWork={(source) => refetchInbox(source)} fetchingWork={fetchingSource}
        scoped={scoped} now={now} onHow={() => setPerfOpen(true)}
      />
    );
  }

  return (
    <div className="flex flex-col gap-[16px]">
      <PageHeader
        variant="page"
        title={titleFor('/governance') ?? 'Governance Overview'}
        info={INFO}
        meta={(
          <span className="inline-flex items-center gap-[2px]">
            {doc.data ? asOfText(doc.data.as_of) : undefined}
            <IconButton label="Refresh the overview" onClick={refreshAll}><RefreshCw aria-hidden /></IconButton>
          </span>
        )}
        actions={narrow ? (
          <>
            {picker}
            <Menu
              label="More"
              items={[
                { key: 'attestations', label: 'Attestations', icon: FileCheck, onSelect: () => router.push(link('/governance/documents/attestation')) },
                { key: 'statements', label: 'Statements', icon: FileText, onSelect: () => router.push(link('/compliance/statements')) },
              ]}
            />
            <Button href={link('/governance/documents')} variant="primary" leftIcon={<FileText aria-hidden />}>Manage Documents</Button>
          </>
        ) : (
          <>
            {picker}
            {/* Attestations + Statements moved here from the sidebar: they live under the Governance documents area now */}
            <Button href={link('/governance/documents/attestation')} leftIcon={<FileCheck aria-hidden />}>Attestations</Button>
            <Button href={link('/compliance/statements')} leftIcon={<FileText aria-hidden />}>Statements</Button>
            <Button href={link('/governance/documents')} variant="primary" leftIcon={<FileText aria-hidden />}>Manage Documents</Button>
          </>
        )}
      />
      <div className="flex flex-wrap items-center justify-between gap-[12px]">
        <SegmentedControl<ViewId> label="View" name="overview-view" options={VIEW_OPTIONS} value={view} onChange={(next) => setAddress({ view: next }, { push: true })} />
        {doc.data && !isEmpty(doc.data) && <ExportMenu data={doc.data} />}
      </div>
      {body}
      <PerformanceDialog open={perfOpen} onClose={() => setPerfOpen(false)} card={scorecard.data} tuning={GOVERNANCE_TUNING} />
    </div>
  );
}
