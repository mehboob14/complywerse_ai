'use client';

/**
 * Risk Management > Risk Assessments > a framework assessment: the workspace. A head with the name, the stage and the framework; a notice that says how the questions were written (the AI, the
 * method, or standard template questions: the server always said and no screen showed it); a counters band (all, mine, still to answer, blocked, unassigned: each a filter, each the true
 * number) with the progress; and tabs Questions, Insights and Details.
 *
 * Questions is a table of all of them with filters, a status you change where it is, ticks for assigning or setting the status of many, and a drawer for one question (its answers, the AI
 * suggestion, the scores, accepting the risk and adding it to the register, its files) with "Next to answer", so a person answering their own questions ("Mine", also ?mine=1 and the deep link
 * ?question=<id>) never scrolls a list of 150. Regenerate says what it will delete, in numbers, and nothing is deleted before that is read. A failed load is an error with Retry, not a spinner.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, FileEdit, Plus, RefreshCw, Search, Trash2, X } from 'lucide-react';
import { PageHeader } from '@/components/ui';
import {
  Button, Combobox, EmptyState, ErrorState, FilterChips, Menu, Notice, Pager, ProgressBar, SectionCard, Select, SkeletonRows, StatusPill, TabPanel, Tabs, TextInput, useAddressState, useConfirm, useNotify,
  useReportedMutation, useTabParam, type FilterChip, type MenuItem,
} from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { useContainerWidth } from '@/components/records/useContainerWidth';
import { useNarrow } from '@/components/overview/useNarrow';
import { ermApi } from '@/lib/api';
import { formatCount, formatDate, truncate } from '@/lib/format';
import { statusPill } from '@/lib/status';
import { frameworkAssessmentStatus } from '@/lib/statuses/assessments';
import { riskLevel } from '@/lib/statuses/risk';
import { TONE } from '@/lib/status';
import { failureWords, useMeId } from '../../../risks/_register/riskData';
import { BarRow } from '../../_register/BarRow';
import { ASSESSMENT_REFRESH, useAssessmentPeople, useAssessmentRights } from '../../_register/assessmentData';
import { QuestionDrawer } from './_framework/QuestionDrawer';
import { QuestionsTable } from './_framework/QuestionsTable';
import { AddQuestionSheet, EditDetailsSheet, MoveSheet, RegenerateSheet } from './_framework/Sheets';
import {
  FRAMEWORK_SCHEMA, NO_QFILTERS, QUESTION_STATUSES, QUICK_IDS, QUICK_LABEL, assigneeRows, batchWords, countsOf, filterCount, filterQuestions, filtersOf, filtersPatch, madeNotice, madeOf, nextToAnswer, phaseRows,
  questionIdOf, rating, regenerateFacts, type FrameworkAddress, type FrameworkAssessment, type Made, type Question,
} from './_framework/frameworkModel';

const TABS = ['questions', 'insights', 'details'] as const;
type Tab = (typeof TABS)[number];
const PAGE_SIZES = [25, 50, 100] as const;
const STATUS_WORDS: Record<string, string> = { not_started: 'Not started', in_progress: 'In progress', completed: 'Completed', blocked: 'Blocked' };
const STAGES: Array<[string, string]> = [['in_progress', 'In progress'], ['completed', 'Completed'], ['archived', 'Archived']];

export default function FrameworkAssessmentPage() {
  const params = useParams();
  const router = useRouter();
  const qc = useQueryClient();
  const notify = useNotify();
  const { confirm, confirmDialog } = useConfirm();
  const id = Number(params.id);
  const key = useMemo(() => ['framework-risk-assessment', id] as const, [id]);
  const { canWrite, ready } = useAssessmentRights();
  const me = useMeId();
  const people = useAssessmentPeople();
  const narrow = useNarrow();
  const box = useRef<HTMLDivElement>(null);
  const room = useContainerWidth(box);
  const [tab, setTab] = useTabParam<Tab>('tab', TABS, { fallback: 'questions', aliases: { insights: 'insights' } });
  const [address, setAddress] = useAddressState(FRAMEWORK_SCHEMA);
  const filters = filtersOf(address as FrameworkAddress);
  const openId = questionIdOf(address as FrameworkAddress);

  const q = useQuery({
    queryKey: [...key],
    queryFn: async () => (await ermApi.frameworkRiskAssessments.getById(id)).data as unknown as FrameworkAssessment,
    enabled: Number.isFinite(id) && id > 0,
    refetchOnMount: 'always',
    staleTime: 0,
    retry: (failures, e) => failures < 2 && canRetry(e),
  });
  const meth = useQuery({
    queryKey: ['framework-methodologies'],
    queryFn: async () => (await ermApi.frameworkRiskAssessments.getMethodologies()).data.methodologies,
    staleTime: 60 * 60 * 1000,
  });
  const a = q.data;
  const questions = useMemo(() => a?.questions ?? [], [a]);
  const methodology = useMemo(() => {
    const code = questions.find((x) => x.methodology_code)?.methodology_code;
    return code ? (meth.data ?? []).find((m) => m.code === code) : undefined;
  }, [questions, meth.data]);
  const phaseName = useCallback((code: string | null | undefined) => (code ? methodology?.phases.find((p) => p.code === code)?.name ?? code.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()) : 'No phase'), [methodology]);

  // ── how the questions were written: read once from the address, or set by a regenerate ──
  const [made, setMade] = useState<Made | null>(() => madeOf((address as FrameworkAddress).made));
  useEffect(() => { if ((address as FrameworkAddress).made) setAddress({ made: '' }); }, [address, setAddress]);

  // ── derived ──
  const counts = useMemo(() => countsOf(questions, me), [questions, me]);
  const shown = useMemo(() => filterQuestions(questions, filters, me), [questions, filters, me]);   // eslint-disable-line react-hooks/exhaustive-deps
  const [pageNo, setPageNo] = useState(1);
  const [pageSize, setPageSize] = useState<number>(50);
  const viewKey = `${shown.length}|${pageSize}|${JSON.stringify(filters)}`;
  const [seen, setSeen] = useState(viewKey);
  if (seen !== viewKey) { setSeen(viewKey); setPageNo(1); }
  const pages = Math.max(1, Math.ceil(shown.length / pageSize));
  const pageClamped = Math.min(Math.max(1, pageNo), pages);
  const pageRows = useMemo(() => shown.slice((pageClamped - 1) * pageSize, pageClamped * pageSize), [shown, pageClamped, pageSize]);
  const openQ = openId ? questions.find((x) => x.id === openId) ?? null : null;
  const openAt = openQ ? shown.findIndex((x) => x.id === openQ.id) : -1;
  // fixed columns: tick 44, answered by 160, status 150, level 96, files 60, open 52 = 562 (+ phase 130); the question needs ~280. Under 860 each question is a card.
  const roomy = room == null || room >= 1000;
  const cards = narrow || (room != null && room < 860);
  const phases = useMemo(() => phaseRows(questions, methodology?.phases ?? []), [questions, methodology]);
  const [ticked, setTicked] = useState<Set<number>>(new Set());
  const [moreFilters, setMoreFilters] = useState(false);
  const tickedHere = useMemo(() => Array.from(ticked).filter((t) => shown.some((s) => s.id === t)), [ticked, shown]);
  useEffect(() => { if (a) document.title = `${a.name} · Framework risk assessment`; }, [a]);

  // ── saving ──
  const putQuestion = useCallback((updated: Question) => {
    qc.setQueryData<FrameworkAssessment>([...key], (old) => (old ? { ...old, questions: old.questions.map((x) => (x.id === updated.id ? { ...x, ...updated } : x)) } : old));
  }, [qc, key]);
  const saveQuestion = useCallback(async (qn: Question, data: Record<string, unknown>): Promise<boolean> => {
    try {
      const res = await ermApi.frameworkRiskAssessments.updateQuestion(id, qn.id, data);
      putQuestion(res.data as Question);
      void qc.invalidateQueries({ queryKey: ['erm-assessment-register'] });
      return true;
    } catch (e) {
      notify.error(errorMessage(e), { title: 'The change was not saved', retry: canRetry(e) ? () => { void saveQuestion(qn, data); } : undefined });
      return false;
    }
  }, [id, putQuestion, qc, notify]);

  const updateAssessment = useReportedMutation({
    mutationFn: (body: Record<string, unknown>) => ermApi.frameworkRiskAssessments.update(id, body),
    success: { title: 'Saved', message: 'The assessment is updated.' },
    failure: "Couldn't save the assessment",
    invalidate: [[...key], ...ASSESSMENT_REFRESH],
    onSuccess: () => setEditing(false),
  });
  const removeAssessment = useReportedMutation({
    mutationFn: () => ermApi.frameworkRiskAssessments.delete(id),
    success: { title: 'Assessment deleted', message: 'Its questions, answers and files went with it.' },
    failure: "Couldn't delete the assessment",
    invalidate: ASSESSMENT_REFRESH,
    onSuccess: () => router.push('/erm/risk-assessments'),
  });
  const addQuestion = useReportedMutation({
    mutationFn: (text: string) => ermApi.frameworkRiskAssessments.addQuestion(id, { question_text: text }),
    success: { title: 'Question added', message: 'It is at the end of the list.' },
    failure: "Couldn't add the question",
    invalidate: [[...key], ...ASSESSMENT_REFRESH],
    onSuccess: () => setAdding(false),
  });
  const removeQuestion = useReportedMutation({
    mutationFn: (qn: Question) => ermApi.frameworkRiskAssessments.deleteQuestion(id, qn.id),
    success: { title: 'Question deleted', message: 'Its files went with it.' },
    failure: "Couldn't delete the question",
    invalidate: [[...key], ...ASSESSMENT_REFRESH],
    onSuccess: (_d, qn) => { if (openId === qn.id) setAddress({ question: '' }); },
  });
  const regenerate = useReportedMutation({
    mutationFn: (o: { scope?: 'full' | 'sample'; count: number }) => ermApi.frameworkRiskAssessments.generateQuestions(id, { count: o.count, replace_existing: true, scope: o.scope, methodology_code: methodology?.code }),
    success: { title: 'Questions written', message: 'The old questions and their files are gone.' },
    failure: "Couldn't write the questions",
    invalidate: [[...key], ...ASSESSMENT_REFRESH],
    onSuccess: (res) => {
      const src = (res.data as { generation_source?: string }).generation_source ?? '';
      setMade(src.startsWith('methodology') ? 'methodology' : src === 'fallback' ? 'template' : 'ai');
      setRegenerating(false); setTicked(new Set()); setAddress({ question: '' });
    },
  });
  const upload = useReportedMutation({
    mutationFn: ({ qn, file }: { qn: Question; file: File }) => { const fd = new FormData(); fd.append('file', file); return ermApi.frameworkRiskAssessments.uploadEvidence(id, qn.id, fd); },
    success: { title: 'File attached', message: '' },
    failure: "Couldn't upload the file",
    invalidate: [[...key], ...ASSESSMENT_REFRESH],
  });
  const removeFile = useReportedMutation({
    mutationFn: (f: { id: number }) => ermApi.frameworkRiskAssessments.deleteEvidence(id, f.id),
    success: { title: 'File removed', message: '' },
    failure: "Couldn't remove the file",
    invalidate: [[...key], ...ASSESSMENT_REFRESH],
  });
  const moveToRegister = useReportedMutation({
    mutationFn: ({ qn, body }: { qn: Question; body: Record<string, unknown> }) => ermApi.frameworkRiskAssessments.moveQuestionToRiskRegister(id, qn.id, body),
    success: { title: 'Added to the Risk Register', message: 'It is there as an accepted risk. Open it from the question.' },
    failure: "Couldn't add it to the Risk Register",
    invalidate: [[...key], ['erm-risks-lean'], ['erm-risks-dashboard'], ...ASSESSMENT_REFRESH],
    onSuccess: () => setMoving(null),
  });

  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [moving, setMoving] = useState<Question | null>(null);

  const batch = async (what: string, ids: number[], data: Record<string, unknown>) => {
    let done = 0; let failed = 0;
    for (const qid of ids) {
      try { putQuestion((await ermApi.frameworkRiskAssessments.updateQuestion(id, qid, data)).data as Question); done += 1; } catch { failed += 1; }
    }
    const w = batchWords(done, failed, what);
    if (w.ok) notify.success(w.message, { title: w.title }); else notify.warning(w.message, { title: w.title });
    void qc.invalidateQueries({ queryKey: ['erm-assessment-register'] });
    setTicked(new Set(failed ? ids.slice(ids.length - failed) : []));
  };
  const bulkAssign = async (user: string | null) => {
    if (!user) return;
    const person = (people.data ?? []).find((p) => String(p.id) === user)?.display_name ?? 'this person';
    if (await confirm({ title: `Assign ${tickedHere.length} ${tickedHere.length === 1 ? 'question' : 'questions'} to ${person}?`, message: 'Whoever was assigned before is replaced.', confirmLabel: 'Assign' })) await batch('Assign', tickedHere, { assigned_user_id: Number(user) });
  };
  const bulkStatus = async (status: string) => {
    if (await confirm({ title: `Set ${tickedHere.length} ${tickedHere.length === 1 ? 'question' : 'questions'} to ${STATUS_WORDS[status].toLowerCase()}?`, confirmLabel: 'Set status' })) await batch('Set status', tickedHere, { status });
  };
  const askDeleteQuestion = async (qn: Question) => {
    const files = qn.evidence?.length ?? 0;
    if (await confirm({ title: 'Delete this question?', message: `“${truncate(qn.question_text, 120).text}” is deleted${files ? ` with its ${files} ${files === 1 ? 'file' : 'files'}` : ''}. It cannot be undone.`, confirmLabel: 'Delete question', tone: 'danger' })) removeQuestion.mutate(qn);
  };
  const askRemoveFile = async (qn: Question, f: { id: number; file_name: string }) => {
    if (await confirm({ title: 'Remove this file?', message: `“${truncate(f.file_name, 80).text}” is deleted from the question. It cannot be undone.`, confirmLabel: 'Remove file', tone: 'danger' })) removeFile.mutate(f);
  };
  const askDeleteAssessment = async () => {
    if (!a) return;
    const f = regenerateFacts(questions);
    if (await confirm({
      title: `Delete “${truncate(a.name, 80).text}”?`,
      message: `${f.total ? `Its ${formatCount(f.total)} ${f.total === 1 ? 'question' : 'questions'}${f.evidenceFiles ? `, ${formatCount(f.evidenceFiles)} uploaded ${f.evidenceFiles === 1 ? 'file' : 'files'}` : ''} and every answer go with it. ` : ''}Risks already added to the Risk Register stay there. It cannot be undone.`,
      confirmLabel: 'Delete assessment', tone: 'danger',
    })) removeAssessment.mutate();
  };

  // ── the page's states ──
  if (q.isPending) return <div aria-busy="true" className="rounded-ds-card border border-ds-border bg-ds-surface p-[12px]"><SkeletonRows rows={8} columns={5} label="Loading the assessment" /></div>;
  if (q.isError || !a) return <ErrorState {...failureWords(q.error, 'this assessment')} onRetry={canRetry(q.error) ? () => { void q.refetch(); } : undefined} />;

  const write = ready && canWrite;
  const setFilters = (f: typeof NO_QFILTERS) => setAddress({ ...filtersPatch(f), page: '' });
  const quickChips: FilterChip[] = QUICK_IDS.map((qid) => ({
    key: qid, label: QUICK_LABEL[qid], active: filters.quick === qid,
    count: qid === 'all' ? counts.total : qid === 'mine' ? counts.mine : qid === 'blocked' ? counts.byStatus.blocked : qid === 'unassigned' ? counts.unassigned : counts.total - counts.byStatus.completed,
  }));
  const moreItems: MenuItem[] = [
    { key: 'edit', label: 'Edit details', icon: FileEdit, hidden: !write, onSelect: () => setEditing(true) },
    { key: 'regen', label: 'Write the questions again', icon: RefreshCw, hidden: !write, onSelect: () => setRegenerating(true) },
    ...STAGES.map(([v, l], i): MenuItem => ({ key: `stage:${v}`, label: l, icon: v === 'archived' ? Archive : undefined, checked: a.status === v, radio: true, hidden: !write, section: i === 0 ? 'Stage' : undefined, onSelect: () => { if (a.status !== v) updateAssessment.mutate({ status: v }); } })),
    { key: 'delete', label: 'Delete assessment', icon: Trash2, danger: true, hidden: !write, onSelect: () => { void askDeleteAssessment(); } },
  ];
  const notice = made ? madeNotice(made, methodology?.display_name) : null;
  const phaseOptions = phases.filter((p) => p.code !== 'none' || phases.length > 1);
  const insightPeople = assigneeRows(questions);
  const levels = (['critical', 'high', 'medium', 'low'] as const).map((b) => ({ b, n: questions.filter((x) => rating(x) === b).length }));

  return (
    <div ref={box} className="flex min-w-0 flex-col gap-[16px]">
      <PageHeader
        variant="page"
        title={a.name}
        back={{ href: '/erm/risk-assessments?kind=framework', label: 'Back to assessments' }}
        chips={(
          <>
            <StatusPill {...statusPill(frameworkAssessmentStatus, a.status)} />
            {a.framework_name && <span className="text-ds-body text-ds-fg-muted">{a.framework_name}</span>}
            {methodology && <span className="text-ds-body text-ds-fg-muted">Method: {methodology.display_name}</span>}
            <span className="text-ds-body text-ds-fg-muted">{formatCount(counts.total)} {counts.total === 1 ? 'question' : 'questions'}</span>
          </>
        )}
        actions={write ? (
          <>
            <Button variant="primary" leftIcon={<Plus aria-hidden />} onClick={() => setAdding(true)}>Add a question</Button>
            <Menu label="More actions" iconOnly items={moreItems} />
          </>
        ) : undefined}
      />

      {notice && (
        <Notice tone={notice.tone} title={notice.title} action={<Button variant="ghost" leftIcon={<X aria-hidden />} onClick={() => setMade(null)}>Dismiss</Button>}>{notice.text}</Notice>
      )}

      <section aria-label="Counters" className="flex flex-col gap-[8px]">
        <FilterChips label="Questions" chips={quickChips} onToggle={(k) => { setFilters({ ...filters, quick: filters.quick === k || k === 'all' ? 'all' : (k as typeof filters.quick) }); setTab('questions'); }} />
        <ProgressBar value={counts.pct} label="Questions completed" valueText={`${formatCount(counts.byStatus.completed)} of ${formatCount(counts.total)} completed`} className="max-w-[420px]" />
      </section>

      <Tabs<Tab> ariaLabel="Assessment sections" countFormat="exact" tabs={[{ key: 'questions', label: 'Questions', count: counts.total }, { key: 'insights', label: 'Insights' }, { key: 'details', label: 'Details' }]} value={tab} onChange={setTab}>
        <TabPanel tabKey="questions">
          <div className="flex flex-col gap-[12px] pt-[12px]">
            <div className="flex flex-wrap items-center gap-[8px]">
              <TextInput type="search" value={filters.search} onChange={(e) => setFilters({ ...filters, search: e.target.value })} aria-label="Search the questions" placeholder="Search questions" autoComplete="off" className="min-w-[160px] max-w-[320px] flex-1" leftAdornment={<Search aria-hidden className="h-[14px] w-[14px]" />} />
              {narrow && <Button aria-expanded={moreFilters} onClick={() => setMoreFilters((v) => !v)}>{filterCount(filters) > 0 ? `Filters (${filterCount(filters)})` : 'Filters'}</Button>}
              {(!narrow || moreFilters) && phaseOptions.length > 1 && (
                <Select aria-label="Phase" placeholder="All phases" className="w-[170px]" value={filters.phase[0] ?? ''} onChange={(e) => setFilters({ ...filters, phase: e.target.value ? [e.target.value] : [] })}>
                  {phaseOptions.map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}
                </Select>
              )}
              {(!narrow || moreFilters) && <Select aria-label="Status" placeholder="Any status" className="w-[150px]" value={filters.status[0] ?? ''} onChange={(e) => setFilters({ ...filters, status: e.target.value ? [e.target.value] : [] })}>
                {QUESTION_STATUSES.map((s) => <option key={s} value={s}>{STATUS_WORDS[s]}</option>)}
              </Select>}
              {(!narrow || moreFilters) && <Select aria-label="Answered by" placeholder="Anyone" className="w-[170px]" value={filters.assignee[0] ?? ''} onChange={(e) => setFilters({ ...filters, assignee: e.target.value ? [e.target.value] : [] })}>
                {insightPeople.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </Select>}
              {filterCount(filters) > 0 && <Button variant="link" onClick={() => setFilters(NO_QFILTERS)}>Clear filters</Button>}
              <span className="ml-auto text-ds-body text-ds-fg-muted">{formatCount(shown.length)} of {formatCount(counts.total)}</span>
            </div>

            {tickedHere.length > 0 && write && (
              <div role="region" aria-label="Selected questions" className="flex flex-wrap items-center gap-[8px] rounded-ds-card border border-ds-primary bg-ds-primary-soft px-[12px] py-[8px]">
                <span className="text-ds-body font-[600] text-ds-primary-text">{formatCount(tickedHere.length)} selected</span>
                <Combobox label="Assign to" value={null} onChange={(v) => { void bulkAssign(v); }} placeholder="Assign to…" searchPlaceholder="Search people" className="w-[200px]" options={(people.data ?? []).map((p) => ({ value: String(p.id), label: p.display_name, description: p.email ?? undefined }))} />
                <Menu label="Set status" items={QUESTION_STATUSES.map((s) => ({ key: s, label: STATUS_WORDS[s], onSelect: () => { void bulkStatus(s); } }))} />
                <Button variant="link" onClick={() => setTicked(new Set())}>Clear selection</Button>
              </div>
            )}

            {counts.total === 0 ? (
              <div className="rounded-ds-card border border-ds-border bg-ds-surface"><EmptyState kind="firstUse" bare title="No questions yet" description={write ? 'Write them from the framework, or add your own.' : 'Nothing was written for this assessment.'} action={write ? <span className="flex flex-wrap justify-center gap-[8px]"><Button variant="primary" leftIcon={<RefreshCw aria-hidden />} onClick={() => setRegenerating(true)}>Write the questions</Button><Button leftIcon={<Plus aria-hidden />} onClick={() => setAdding(true)}>Add a question</Button></span> : undefined} /></div>
            ) : shown.length === 0 ? (
              <div className="rounded-ds-card border border-ds-border bg-ds-surface"><EmptyState kind="noMatches" bare title="No questions match" description="Loosen a filter, or search for other words." onClearFilters={() => setFilters(NO_QFILTERS)} /></div>
            ) : (
              <>
                <QuestionsTable
                  rows={pageRows}
                  offset={(pageClamped - 1) * pageSize}
                  phaseName={phaseName}
                  ticked={ticked}
                  onTick={(qid) => setTicked((cur) => { const n = new Set(cur); if (n.has(qid)) n.delete(qid); else n.add(qid); return n; })}
                  onTickAll={(on) => setTicked((cur) => { const n = new Set(cur); pageRows.forEach((r) => (on ? n.add(r.id) : n.delete(r.id))); return n; })}
                  canWrite={write}
                  narrow={cards}
                  roomy={roomy}
                  activeId={openQ?.id ?? null}
                  onOpen={(qn) => setAddress({ question: String(qn.id) })}
                  onStatus={(qn, status) => { void saveQuestion(qn, { status }); }}
                />
                <Pager page={pageClamped} pageSize={pageSize} total={shown.length} onPage={setPageNo} onPageSize={setPageSize} pageSizes={PAGE_SIZES} noun={{ one: 'question', other: 'questions' }} />
              </>
            )}
          </div>
        </TabPanel>

        <TabPanel tabKey="insights" lazy>
          <div className="grid gap-[16px] pt-[12px] lg:grid-cols-2">
            <SectionCard id="status" title="Status" info="Press a status to see its questions." meta={`${formatCount(counts.total)} questions`}>
              <div className="flex flex-col">
                {QUESTION_STATUSES.map((s) => <BarRow key={s} label={STATUS_WORDS[s]} value={counts.byStatus[s]} total={counts.total} color={TONE[s === 'completed' ? 'success' : s === 'blocked' ? 'danger' : s === 'in_progress' ? 'progress' : 'neutral'].dot} hint={`Show the ${STATUS_WORDS[s].toLowerCase()} questions`} onPress={counts.byStatus[s] > 0 ? () => { setFilters({ ...NO_QFILTERS, status: [s] }); setTab('questions'); } : undefined} />)}
              </div>
              <p className="mb-0 mt-[12px] text-ds-body text-ds-fg-body">{formatCount(counts.evidence)} {counts.evidence === 1 ? 'file' : 'files'} attached · {formatCount(counts.accepted)} {counts.accepted === 1 ? 'risk' : 'risks'} accepted · {formatCount(counts.moved)} in the Risk Register</p>
            </SectionCard>
            <SectionCard id="phases" title={methodology ? 'Phases' : 'Progress by phase'} info="How many questions of each phase of the method are completed." meta={`${phases.length} ${phases.length === 1 ? 'phase' : 'phases'}`}>
              {phases.length === 0 ? <p className="m-0 text-ds-body text-ds-fg-muted">No questions yet.</p> : (
                <div className="flex flex-col">
                  {phases.map((p) => <BarRow key={p.code} label={p.name} value={p.done} total={p.total} color={TONE.success.dot} hint={`Show the ${p.name} questions`} onPress={() => { setFilters({ ...NO_QFILTERS, phase: [p.code] }); setTab('questions'); }} />)}
                </div>
              )}
            </SectionCard>
            <SectionCard id="people" title="Who answers" info="Open and completed questions for each person. Press a name to see their questions." meta={`${insightPeople.length} ${insightPeople.length === 1 ? 'person' : 'people'}`}>
              <div className="flex flex-col">
                {insightPeople.map((p) => <BarRow key={p.id} label={p.name} value={p.done} total={p.total} color={TONE.progress.dot} hint={`Show the questions of ${p.name}`} onPress={() => { setFilters({ ...NO_QFILTERS, assignee: [p.id] }); setTab('questions'); }} />)}
              </div>
            </SectionCard>
            <SectionCard id="levels" title="Level of the scored questions" info="By the residual score, else the inherent score: critical 20 and over, high 12, medium 6, low below." meta={`${formatCount(levels.reduce((n, l) => n + l.n, 0))} scored`}>
              <div className="flex flex-col">
                {levels.map((l) => <BarRow key={l.b} label={riskLevel.label(l.b)} value={l.n} total={Math.max(1, levels.reduce((n, x) => n + x.n, 0))} color={TONE[({ critical: 'danger', high: 'warning', medium: 'progress', low: 'success' } as const)[l.b]].dot} />)}
              </div>
            </SectionCard>
          </div>
        </TabPanel>

        <TabPanel tabKey="details" lazy>
          <div className="pt-[12px]">
            <SectionCard id="about" title="About this assessment" actions={write ? <Button leftIcon={<FileEdit aria-hidden />} onClick={() => setEditing(true)}>Edit details</Button> : undefined}>
              <dl className="m-0 grid gap-x-[24px] gap-y-[8px] sm:grid-cols-2">
                {[['Framework', a.framework_name], ['Method', methodology?.display_name], ['Created by', a.creator_name], ['Created', a.created_at ? formatDate(a.created_at) : null], ['Last changed', a.updated_at ? formatDate(a.updated_at) : null]].map(([k, v]) => (
                  <div key={k as string}><dt className="text-ds-label text-ds-fg-muted">{k}</dt><dd className="m-0 text-ds-body text-ds-fg">{v || '—'}</dd></div>
                ))}
              </dl>
              {a.description && <p className="mb-0 mt-[12px] whitespace-pre-wrap break-words text-ds-body text-ds-fg-body">{a.description}</p>}
            </SectionCard>
          </div>
        </TabPanel>
      </Tabs>

      <QuestionDrawer
        assessmentId={id}
        q={openQ}
        index={openAt}
        total={shown.length}
        methodology={methodology}
        phaseName={phaseName}
        people={people.data ?? []}
        canWrite={write}
        onClose={() => setAddress({ question: '' })}
        onStep={(dir) => { const next = shown[openAt + dir]; if (next) setAddress({ question: String(next.id) }); }}
        canNextToAnswer={!!nextToAnswer(shown, openQ?.id ?? null)}
        onNextToAnswer={() => { const next = nextToAnswer(shown, openQ?.id ?? null); if (next) setAddress({ question: String(next.id) }); }}
        onSave={saveQuestion}
        onDelete={(qn) => { void askDeleteQuestion(qn); }}
        onUpload={(qn, file) => upload.mutate({ qn, file })}
        uploading={upload.isPending}
        onRemoveFile={(qn, f) => { void askRemoveFile(qn, f); }}
        onMove={(qn) => setMoving(qn)}
      />
      <RegenerateSheet open={regenerating} onClose={() => setRegenerating(false)} questions={questions} methodology={methodology} busy={regenerate.isPending} onRun={(o) => regenerate.mutate(o)} />
      <AddQuestionSheet open={adding} onClose={() => setAdding(false)} busy={addQuestion.isPending} onAdd={(text) => addQuestion.mutate(text)} />
      <MoveSheet question={moving} open={!!moving} onClose={() => setMoving(null)} people={people.data ?? []} busy={moveToRegister.isPending} onMove={(body) => moving && moveToRegister.mutate({ qn: moving, body })} />
      <EditDetailsSheet a={a} open={editing} onClose={() => setEditing(false)} busy={updateAssessment.isPending} onSave={(body) => updateAssessment.mutate(body)} />
      {confirmDialog}
    </div>
  );
}
