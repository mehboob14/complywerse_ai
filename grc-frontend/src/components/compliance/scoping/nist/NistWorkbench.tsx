'use client';

/**
 * The Assessment stage of a NIST assessment (SP 800-53A control assessment, CSF 2.0 profile): the figures, a search and the filters (domain, status), and the
 * controls (or subcategories) as a register, a table of them and a card each on a phone. A row opens in a drawer (ItemPanel) where the assessor determines the
 * objectives, files evidence under each artifact NIST names and records the finding. On the design-system kit like the other Cyber Security pages.
 */
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import {
  EmptyState, ErrorState, Pager, PersonStack, ProgressBar, RegisterTable, SegmentedControl, Select, SkeletonRows, StatTile, StatusPill, TextInput, useNotify,
  type RegisterColumn,
} from '@/components/ui/ds';
import { RightSlidePanel } from '@/components/ui/RightSlidePanel';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { formatCount, formatPercent } from '@/lib/format';
import { refreshAssessmentLists } from '../scopingApi';
import ItemPanel from './ItemPanel';
import { NistDocuments } from './NistDocs';
import { nistApi, type Decision, type DecisionResult, type NistDetail } from './nistApi';
import { domainsOf, figuresOf, filterItems, isControl, isProfile, progressOf, statusTone, statusWord, type NistItem, type StatusFilter } from './nistModel';

const PAGE_SIZE = 25;

export default function NistWorkbench({ assessmentId, format }: { assessmentId: number; format: string }) {
  const qc = useQueryClient();
  const notify = useNotify();
  const profile = format === 'nist_csf2';
  const noun = (n: number) => (profile ? (n === 1 ? 'subcategory' : 'subcategories') : (n === 1 ? 'control' : 'controls'));
  const key = ['nist-detail', assessmentId];
  const detail = useQuery({ queryKey: key, queryFn: () => nistApi.detail(assessmentId) });
  const [text, setText] = useState('');
  const [domain, setDomain] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<number | null>(null);

  const items = detail.data?.items ?? [];
  const figures = useMemo(() => figuresOf(items), [items]);
  const domains = useMemo(() => domainsOf(items), [items]);
  const rows = useMemo(() => filterItems(items, { text, domain, status }), [items, text, domain, status]);
  const shown = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const open = items.find((i) => i.id === openId) ?? null;

  // a decision is the server's: its answer (the derived status and the new counts) replaces the item in the list at once
  const decide = useMutation({
    mutationFn: ({ itemId, body }: { itemId: number; body: Decision }) => nistApi.decide(itemId, body),
    onSuccess: (res: DecisionResult) => {
      qc.setQueryData<NistDetail>(key, (old) => old && { ...old, overall_score: res.overall_score, items: old.items.map((i) => (i.id === res.id ? { ...i, assessment_data: res.assessment_data, compliance_status: res.compliance_status } : i)) });
      refreshAssessmentLists(qc);
    },
    onError: (e) => notify.error(e, { title: 'The decision was not saved' }),
  });
  const refresh = () => { void qc.invalidateQueries({ queryKey: key }); refreshAssessmentLists(qc); };
  const narrow = (set: () => void) => { set(); setPage(1); };

  const columns: RegisterColumn<NistItem>[] = [
    {
      key: 'item', header: profile ? 'Subcategory' : 'Control', isRowHeader: true, width: 'w-[34%]',
      cell: (i) => (
        <button type="button" onClick={() => setOpenId(i.id)} className="block w-full min-w-0 text-left focus-visible:outline-none focus-visible:shadow-ds-ring rounded-ds-control">
          <span className="font-[600] text-ds-fg">{i.item_number}</span>
          <span className="ml-[8px] break-words text-ds-fg-body">{isControl(i.assessment_data) ? i.assessment_data.title : isProfile(i.assessment_data) ? i.assessment_data.outcome : ''}</span>
        </button>
      ),
    },
    { key: 'domain', header: profile ? 'Function' : 'Family', priority: 3, card: 'meta', cell: (i) => i.area_domain },
    {
      key: 'progress', header: profile ? 'Current → target' : 'Objectives', width: 'w-[170px]', card: 'meta',
      cell: (i) => {
        if (isProfile(i.assessment_data)) return <span className="text-ds-body text-ds-fg-body">{`${i.assessment_data.current ?? '—'} → ${i.assessment_data.target ?? '—'}`}</span>;
        const p = progressOf(i);
        return <ProgressBar value={p.total > 0 ? Math.round((p.determined / p.total) * 100) : null} valueText={`${p.determined} of ${p.total}`} label={`${i.item_number}: objectives determined`} />;
      },
    },
    { key: 'status', header: 'Status', card: 'meta', cell: (i) => <StatusPill tone={statusTone(i)} label={statusWord(i)} size="sm" /> },
    { key: 'evidence', header: 'Evidence', align: 'right', priority: 2, card: 'meta', cell: (i) => (i.evidence_count > 0 ? formatCount(i.evidence_count) : <span className="text-ds-fg-muted">—</span>) },
    { key: 'assignees', header: 'Assigned', priority: 2, card: 'meta', cell: (i) => <PersonStack people={i.assignees.map((a) => a.name)} size={24} label={`Assigned to ${i.item_number}`} /> },
  ];

  const statusOptions = [
    { value: 'all', label: 'All' }, { value: 'open', label: 'Open' }, { value: 'complied', label: profile ? 'Fully' : 'Satisfied' },
    { value: 'not_complied', label: profile ? 'Not implemented' : 'Other than satisfied' },
    ...(profile ? [{ value: 'partially_complied', label: 'Partly' }] : []), { value: 'na', label: 'N/A' },
  ] as const;

  if (detail.isLoading) return <SkeletonRows rows={6} columns={5} label="Loading the assessment" />;
  if (detail.isError || !detail.data) return <ErrorState title="Couldn't load the assessment" message={errorMessage(detail.error)} onRetry={canRetry(detail.error) ? () => { void detail.refetch(); } : undefined} />;

  return (
    <div className="flex flex-col gap-[16px]">
      <div className="grid gap-[12px] sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label={profile ? 'Rated' : 'Determined'} value={formatPercent(figures.percent)} progress={figures.percent} note={`${formatCount(figures.decided)} of ${formatCount(figures.total)} ${noun(figures.total)}`}
          info={profile ? 'Subcategories with a current implementation rating, not applicable included.' : 'Controls with a finding: every objective determined, or one found other than satisfied. Not applicable counts as decided.'} />
        <StatTile label={profile ? 'Fully implemented' : 'Satisfied'} value={formatCount(figures.complied)} tone={figures.complied > 0 ? 'success' : 'default'} unit={noun(figures.complied)} />
        <StatTile label={profile ? 'Not or partly implemented' : 'Other than satisfied'} value={formatCount(figures.notComplied + figures.partial)} tone={figures.notComplied + figures.partial > 0 ? 'danger' : 'default'} unit={noun(figures.notComplied + figures.partial)}
          info={profile ? undefined : 'Controls where at least one objective was found other than satisfied: the findings.'} />
        <StatTile label="Still to do" value={formatCount(figures.inProgress)} unit={noun(figures.inProgress)} />
      </div>

      <div className="flex flex-wrap items-center gap-[12px]">
        <TextInput type="search" aria-label={profile ? 'Search the subcategories' : 'Search the controls and their objectives'} placeholder="Search" value={text} onChange={(e) => narrow(() => setText(e.target.value))} leftAdornment={<Search aria-hidden />} className="w-[16rem]" />
        <Select aria-label={profile ? 'Function' : 'Family'} value={domain} onChange={(e) => narrow(() => setDomain(e.target.value))} className="w-[16rem]">
          <option value="">{profile ? 'All functions' : 'All families'}</option>
          {domains.map((d) => <option key={d.name} value={d.name}>{`${d.name} (${d.done}/${d.total})`}</option>)}
        </Select>
        <SegmentedControl label="Status" name="nist-status" options={statusOptions} value={status} onChange={(v) => narrow(() => setStatus(v as StatusFilter))} />
        <span className="ml-auto"><NistDocuments format={format} /></span>
      </div>

      <RegisterTable<NistItem>
        caption={profile ? 'Subcategories of the profile' : 'Controls of the assessment'}
        columns={columns}
        rows={shown}
        getRowId={(i) => i.id}
        selectedId={openId}
        onRowActivate={(i) => setOpenId(i.id)}
        cardTitle={(i) => <span><span className="font-[600] text-ds-fg">{i.item_number}</span> <span className="text-ds-fg-body">{isControl(i.assessment_data) ? i.assessment_data.title : isProfile(i.assessment_data) ? i.assessment_data.outcome : ''}</span></span>}
        stickyHead
        empty={<EmptyState kind="noMatches" bare title={profile ? 'No subcategory matches' : 'No control matches'} onClearFilters={() => { setText(''); setDomain(''); setStatus('all'); setPage(1); }} />}
        footer={rows.length > PAGE_SIZE ? <Pager page={page} pageSize={PAGE_SIZE} total={rows.length} onPage={setPage} noun={profile ? 'subcategories' : 'controls'} /> : undefined}
      />

      <RightSlidePanel
        isOpen={!!open} onClose={() => setOpenId(null)} width="w-full max-w-2xl"
        title={open ? `${open.item_number}${isControl(open.assessment_data) ? ` ${open.assessment_data.title}` : ''}` : ''}
        subtitle={open ? open.area_domain : undefined}
      >
        {open && <ItemPanel key={open.id} assessmentId={assessmentId} assessmentName={detail.data.name} item={open} busy={decide.isPending} onChanged={refresh}
          decide={(body) => decide.mutate({ itemId: open.id, body })} />}
      </RightSlidePanel>
    </div>
  );
}
