'use client';

// One register of a framework journey (Gap Analysis, Internal Audit, Risk Treatment, or any of the 54 the framework's own definitions bring): the same
// screen for both kinds of register. A title with what the register is for behind its (i), Add row and AI assess all, search and one filter, a table of
// the six columns that say the most (the form has all of them), a row that opens its form, a menu per row, and the failures said where they happen.
// The two adapters (FrameworkRegisterTab, FrameworkDynamicRegisterTab) read the rows and hand them here; the writes live here.
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ExternalLink, Pencil, Plus, RotateCcw, Search, ShieldAlert, Sparkles, Trash2 } from 'lucide-react';
import { evidenceApi, frameworkTemplatesApi } from '@/lib/api';
import {
  Button, EmptyState, Menu, Notice, Pager, RegisterTable, SectionCard, Select, StatusPill, TextInput, linkClasses, useConfirm, useReportedMutation,
  type MenuItem, type RegisterColumn,
} from '@/components/ui/ds';
import { EMPTY, UNASSIGNED, formatCount, formatPercent } from '@/lib/format';
import { apiErrorText, safeDetail } from '@/lib/apiError';
import { pageRange } from '@/lib/pagerModel';
import MoveToRiskDialog from './MoveToRiskDialog';
import RegisterForm, { type FormContext } from './RegisterForm';
import {
  FACET_ALL, aiItemsOf, aiPatchOf, aiRowsOf, bodyOf, cardTitleOf, cellText, coveragePct, draftOf, facetColumn, facetCounts, matchesFacet,
  matchesSearch, movedCount, optionOf, RISK_NUMBER, ownerName, riskTitleOf, rowLabel, sameDraft, tableColumns, wantsEvidence,
  type AiOut, type ControlLite, type Person, type RegColumn, type RegDef, type RegRow, type RiskLite,
} from './registerModel';

interface Props {
  def: RegDef;
  rows: RegRow[];
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  journeyId: number;
  frameworkId: number | null;
  frameworkName: string;
  people: Person[];
  controls: ControlLite[];
  /** the query this register is read with (a write refreshes it) */
  queryKey: readonly unknown[];
}

// A column's preferred room (it gives way when the pane is narrow, so the actions column stays in view): a pick-list, a person and a day have less than text. A long header wraps.
const KIND_WIDTH: Partial<Record<RegColumn['kind'], string>> = { select: 'w-[140px]', owner: 'w-[130px]', date: 'w-[110px]', datetime: 'w-[150px]', auto: 'w-[100px]' };
const widthOf = (col: RegColumn, i: number): string => `${KIND_WIDTH[col.kind] ?? (i === 0 ? 'w-[120px]' : 'w-[140px]')} !whitespace-normal`;

interface Editing { mode: 'add' | 'edit'; id?: number; draft: Record<string, unknown>; initial: Record<string, unknown> }

const dash = <span className="text-ds-fg-muted">{EMPTY}</span>;

export default function RegisterView({ def, rows, loading, error, onRetry, journeyId, frameworkId, frameworkName, people, controls, queryKey }: Props) {
  const router = useRouter();
  const { confirm, confirmDialog } = useConfirm();
  const [query, setQuery] = useState('');
  const [facetValue, setFacetValue] = useState(FACET_ALL);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [problem, setProblem] = useState<unknown>(null);
  const [move, setMove] = useState<{ row: RegRow; title: string } | null>(null);
  const [moveProblem, setMoveProblem] = useState<unknown>(null);
  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

  const scope = { journey_id: journeyId, framework_id: frameworkId };
  const facet = useMemo(() => facetColumn(def.columns), [def.columns]);
  const shownColumns = useMemo(() => tableColumns(def.columns), [def.columns]);
  const needsRisks = def.type === 'risk_treatment';

  // Risk Treatment: the risks made from or tagged under this framework, for the picker.
  const risksQuery = useQuery({
    queryKey: ['ft-framework-risks', journeyId, frameworkName],
    queryFn: async () => (await frameworkTemplatesApi.registers.frameworkRisks({ journey_id: journeyId, framework_name: frameworkName })).data as { risks: RiskLite[] },
    enabled: !!journeyId && needsRisks && editing != null,
  });
  // The evidence library is read only when a form that can link evidence is open.
  const evidenceQuery = useQuery({
    queryKey: ['evidence-all'],
    queryFn: async () => (await evidenceApi.getAll()).data as unknown as Array<{ id: number; name?: string; title?: string; file_name?: string }>,
    enabled: editing != null && wantsEvidence(def),
    staleTime: 60_000,
  });
  const evidenceNames = useMemo(
    () => (evidenceQuery.data ? Array.from(new Set(evidenceQuery.data.map((e) => e.name || e.title || e.file_name || 'Untitled evidence'))) : undefined),
    [evidenceQuery.data],
  );

  // ── writes: every one says what happened and, when it failed, why ──────────────────────────────────────────────────────────────────────
  const save = useReportedMutation({
    mutationFn: async (v: { mode: 'add' | 'edit'; id?: number; body: Record<string, unknown> }) => (
      v.mode === 'add' ? frameworkTemplatesApi.registers.create(def.type, scope, v.body) : frameworkTemplatesApi.registers.update(v.id as number, v.body)
    ),
    success: (_d, v) => (v.mode === 'add' ? 'Row added' : 'Row saved'),
    failure: "Couldn't save the row",
    toast: 'success',
    invalidate: [queryKey],
    onSuccess: () => { setEditing(null); setProblem(null); },
    onError: (e) => setProblem(e),
  });
  const remove = useReportedMutation({
    mutationFn: (row: RegRow) => frameworkTemplatesApi.registers.remove(row.id),
    success: 'Row deleted',
    failure: "Couldn't delete the row",
    invalidate: [queryKey],
  });
  const reset = useReportedMutation({
    mutationFn: () => frameworkTemplatesApi.registers.reset(def.type, scope),
    success: { title: 'Register reset', message: "It now holds the template's starting rows." },
    failure: "Couldn't reset the register",
    invalidate: [queryKey],
    onSuccess: () => { setAiSummary(null); setQuery(''); setFacetValue(FACET_ALL); },
  });
  const moveToRisk = useReportedMutation({
    mutationFn: (v: { row: RegRow; title: string; description: string }) => frameworkTemplatesApi.registers.moveToRisk(v.row.id, { title: v.title, description: v.description, framework_name: frameworkName }),
    success: (_d, v) => ({ title: 'Moved to the risk register', message: `"${v.title}" is now a risk.` }),
    failure: "Couldn't create the risk",
    toast: 'success',
    retryable: false,
    invalidate: [queryKey, ['ft-framework-risks', journeyId]],
    onSuccess: () => { setMove(null); setMoveProblem(null); },
    onError: (e) => setMoveProblem(e),
  });
  const assess = useReportedMutation({
    mutationFn: async (subset: RegRow[]) => {
      const res = await frameworkTemplatesApi.ai.register({ register_type: def.type, framework_name: frameworkName, rows: aiRowsOf(subset, def.shape) });
      const out = res.data as AiOut;
      const items = aiItemsOf(out, def.shape);
      if (items.length) await frameworkTemplatesApi.registers.applyAI(def.type, { journey_id: journeyId }, items);
      return { summary: out.summary || '', count: items.length };
    },
    success: (r) => ({ title: 'AI assessment applied', message: `${formatCount(r.count)} ${r.count === 1 ? 'row' : 'rows'} updated.` }),
    failure: "AI couldn't assess the rows",
    invalidate: [queryKey],
    onSuccess: (r) => setAiSummary(r.summary || 'AI assessment applied.'),
  });
  const assessForm = useReportedMutation({
    mutationFn: async (draft: Record<string, unknown>) => {
      const res = await frameworkTemplatesApi.ai.register({ register_type: def.type, framework_name: frameworkName, rows: [{ id: editing?.id ?? 0, ...draft }] });
      return aiPatchOf(res.data as AiOut);
    },
    success: { title: 'AI filled the form', message: 'Review the suggestions, then save.' },
    failure: "AI couldn't assess this row",
    onSuccess: (patch) => setEditing((prev) => (prev ? { ...prev, draft: { ...prev.draft, ...patch } } : prev)),
  });

  // ── what is listed ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  const listed = useMemo(
    () => rows.filter((r) => matchesSearch(r, def.columns, people, query) && matchesFacet(r, facet, facetValue)),
    [rows, def.columns, people, query, facet, facetValue],
  );
  const counts = useMemo(() => (facet ? facetCounts(rows, facet) : []), [rows, facet]);
  const filtering = query.trim() !== '' || facetValue !== FACET_ALL;
  useEffect(() => { setPage(1); }, [query, facetValue]);
  const range = pageRange(page, pageSize, listed.length);
  const visible = listed.slice(range.from > 0 ? range.from - 1 : 0, range.to);
  const moved = movedCount(rows);
  const facts = loading || error ? undefined : [
    `${formatCount(rows.length)} ${rows.length === 1 ? 'row' : 'rows'}`,
    def.coverage && rows.length > 0 ? `${formatPercent(coveragePct(rows))} covered` : null,
    moved > 0 ? `${formatCount(moved)} in the risk register` : null,
  ].filter(Boolean).join(' · ');

  const clearFilters = () => { setQuery(''); setFacetValue(FACET_ALL); };
  const openAdd = () => { const d = draftOf(null, def); setProblem(null); setEditing({ mode: 'add', draft: d, initial: d }); };
  const openEdit = (row: RegRow) => { const d = draftOf(row, def); setProblem(null); setEditing({ mode: 'edit', id: row.id, draft: d, initial: { ...d } }); };
  const closeForm = () => { setEditing(null); setProblem(null); };
  const submit = () => {
    if (!editing) return;
    setProblem(null);
    save.mutate({ mode: editing.mode, id: editing.id, body: bodyOf(editing.draft, def) });
  };
  const askDelete = async (row: RegRow) => {
    const what = rowLabel(row, def.columns);
    if (await confirm({ title: 'Delete this row?', message: `"${what}" is removed from ${def.label}. This can't be undone.`, confirmLabel: 'Delete row', tone: 'danger' })) remove.mutate(row);
  };
  const askReset = async () => {
    const ok = await confirm({
      title: `Reset ${def.label}?`,
      message: `Every row, including the ones you added or changed, is replaced by the template's starting rows. This can't be undone.`,
      confirmLabel: 'Reset register',
      tone: 'danger',
    });
    if (ok) reset.mutate();
  };
  const openMove = (row: RegRow) => { setMoveProblem(null); setMove({ row, title: riskTitleOf(row, def) }); };

  const menuOf = (row: RegRow): MenuItem[] => [
    { key: 'edit', label: 'Edit', icon: Pencil, onSelect: () => openEdit(row) },
    { key: 'ai', label: 'AI assess this row', icon: Sparkles, onSelect: () => assess.mutate([row]), disabled: assess.isPending },
    row.riskId != null
      ? { key: 'risk', label: 'Open the risk', icon: ExternalLink, onSelect: () => router.push(`/erm/risks/${row.riskId}`) }
      : { key: 'move', label: 'Move to the risk register', icon: ShieldAlert, onSelect: () => openMove(row) },
    { key: 'delete', label: 'Delete', icon: Trash2, danger: true, onSelect: () => { void askDelete(row); } },
  ];
  const menu = (row: RegRow) => <Menu iconOnly label={`Actions for ${rowLabel(row, def.columns, 40)}`} items={menuOf(row)} />;

  const formContext: FormContext = {
    people,
    controls,
    risks: needsRisks ? (risksQuery.data?.risks ?? []) : null,
    risksFailed: needsRisks && !!risksQuery.error,
    evidence: evidenceNames,
    evidenceFailed: !!evidenceQuery.error,
  };

  const columns: RegisterColumn<RegRow>[] = [
    ...shownColumns.map(({ col, priority }, i): RegisterColumn<RegRow> => ({
      key: col.key,
      header: col.label,
      priority,
      width: widthOf(col, i),
      isRowHeader: i === 0,
      card: i === 0 ? undefined : 'meta',
      cell: (row) => <Cell col={col} row={row} people={people} first={i === 0} />,
      cardCell: (row) => <Cell col={col} row={row} people={people} first={false} />,
    })),
    { key: '__actions', header: 'Actions', align: 'right', card: 'hide', width: 'w-[64px]', cell: menu },
  ];

  const failure = error ? { message: safeDetail(apiErrorText(error, `The rows of ${def.label} couldn't be loaded.`)), onRetry } : null;

  return (
    <SectionCard
      id={`register-${def.type.replace(/[^a-zA-Z0-9_-]/g, '-')}`}
      title={def.label}
      info={def.description}
      meta={facts}
      actions={(
        <>
          <Button leftIcon={<Sparkles aria-hidden />} loading={assess.isPending} disabled={loading || !!error || rows.length === 0} onClick={() => assess.mutate(rows)}>AI assess all</Button>
          <Button variant="primary" leftIcon={<Plus aria-hidden />} disabled={loading || !!error} onClick={openAdd}>Add row</Button>
          <Menu
            iconOnly
            label={`More actions for ${def.label}`}
            items={[{ key: 'reset', label: 'Reset to the template…', icon: RotateCcw, danger: true, onSelect: () => { void askReset(); }, disabled: loading || !!error || reset.isPending }]}
          />
        </>
      )}
    >
      <div className="space-y-[12px]">
        {aiSummary && (
          <Notice tone="info" title="AI assessment" action={<Button size="sm" onClick={() => setAiSummary(null)}>Dismiss</Button>}>{aiSummary}</Notice>
        )}
        {(rows.length > 0 || filtering) && !error && (
          <div className="flex flex-wrap items-center gap-[8px]">
            <TextInput
              aria-label={`Search ${def.label}`}
              placeholder="Search rows"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              leftAdornment={<Search aria-hidden className="h-[16px] w-[16px]" />}
              className="w-full sm:w-[240px]"
            />
            {facet && counts.length > 1 && (
              <Select aria-label={`Show rows by ${facet.label.toLowerCase()}`} value={facetValue} onChange={(e) => setFacetValue(e.target.value)} className="w-full sm:w-[220px]">
                <option value={FACET_ALL}>{`Any ${facet.label.toLowerCase()} (${formatCount(rows.length)})`}</option>
                {counts.map((c) => <option key={c.value || 'unset'} value={c.value}>{`${c.label} (${formatCount(c.count)})`}</option>)}
              </Select>
            )}
            {filtering && <Button variant="link" onClick={clearFilters}>Clear filters</Button>}
            {filtering && <span className="text-ds-label text-ds-fg-muted" aria-live="polite">{`${formatCount(listed.length)} of ${formatCount(rows.length)} shown`}</span>}
          </div>
        )}
        {assess.isPending && <p role="status" className="text-ds-label text-ds-fg-muted">AI is assessing the rows. This can take up to a minute.</p>}
        <RegisterTable
          caption={`${def.label} rows`}
          columns={columns}
          rows={visible}
          getRowId={(r) => r.id}
          loading={loading}
          error={failure}
          onRowActivate={openEdit}
          cardTitle={(r) => cardTitleOf(r, shownColumns[0]?.col, def.columns, people)}
          cardActions={menu}
          footer={listed.length > 25 && !error ? (
            <Pager page={range.page} pageSize={pageSize} total={listed.length} onPage={setPage} onPageSize={(n) => { setPageSize(n); setPage(1); }} pageSizes={[25, 50, 100]} noun={{ one: 'row', other: 'rows' }} />
          ) : undefined}
          empty={
            filtering
              ? <EmptyState kind="noMatches" bare title="No rows match" description="Nothing in this register matches the search or the filter." onClearFilters={clearFilters} />
              : <EmptyState kind="firstUse" bare title="No rows yet" description="Add a row, or reset the register to the template's starting rows." action={<Button variant="primary" leftIcon={<Plus aria-hidden />} onClick={openAdd}>Add row</Button>} />
          }
        />
      </div>

      {editing && (
        <RegisterForm
          def={def}
          mode={editing.mode}
          frameworkName={frameworkName}
          draft={editing.draft}
          onChange={(patch) => setEditing((prev) => (prev ? { ...prev, draft: { ...prev.draft, ...patch } } : prev))}
          dirty={!sameDraft(editing.draft, editing.initial)}
          saving={save.isPending}
          problem={problem}
          onRetry={submit}
          onSave={submit}
          onClose={closeForm}
          ctx={formContext}
          onAi={def.shape === 'data' ? () => assessForm.mutate(editing.draft) : undefined}
          aiBusy={assessForm.isPending}
        />
      )}
      {move && (
        <MoveToRiskDialog
          register={def.label}
          frameworkName={frameworkName}
          initialTitle={move.title}
          pending={moveToRisk.isPending}
          problem={moveProblem}
          onSubmit={(title, description) => { setMoveProblem(null); moveToRisk.mutate({ row: move.row, title, description }); }}
          onClose={() => { setMove(null); setMoveProblem(null); }}
        />
      )}
      {confirmDialog}
    </SectionCard>
  );
}

/** One cell: a pick-list value as a pill with its word, a person by name, a day as written, long text cut at two lines, and nothing as a dash. */
function Cell({ col, row, people, first }: { col: RegColumn; row: RegRow; people: Person[]; first: boolean }) {
  if (col.kind === 'select') {
    const option = optionOf(col, row.values[col.key]);
    const raw = row.values[col.key];
    if (!option && (raw == null || raw === '')) return dash;
    return <StatusPill size="sm" tone={option?.tone ?? 'neutral'} label={option?.label ?? String(raw)} />;
  }
  if (col.kind === 'owner') {
    const name = ownerName(row, people);
    return name ? <span className="whitespace-nowrap text-ds-body text-ds-fg-body">{name}</span> : <span className="whitespace-nowrap text-ds-body text-ds-fg-muted">{UNASSIGNED}</span>;
  }
  const raw = cellText(col, row, people);
  const words = col.picker === 'framework_risks' && RISK_NUMBER.test(raw) ? 'Linked risk' : raw;
  if (!words) return dash;
  const isCode = first || col.kind === 'auto';
  return (
    <span className="block min-w-0">
      <span className={`line-clamp-2 text-ds-body ${isCode ? 'font-medium text-ds-fg' : 'text-ds-fg-body'}`} title={words.length > 80 ? words : undefined}>{words}</span>
      {first && row.riskId != null && (
        <Link href={`/erm/risks/${row.riskId}`} className={linkClasses({ tone: 'text', size: 'label' })}>In the risk register</Link>
      )}
    </span>
  );
}
