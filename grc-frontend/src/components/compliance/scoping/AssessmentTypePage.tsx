'use client';

/**
 * The page of one Cyber Security assessment type (OWASP ASVS, CSIR maturity, …), before any questions: what you need to start one, the questionnaire it
 * starts from, and the assessments already made from it. A new assessment is made for ONE application (chosen from the asset library) or ONE function or
 * process, as a draft that is scoped first (`AssessmentWorkspace`); the questionnaire itself, with its upload, stays as it was, one click away.
 */
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Plus, Search, Upload } from 'lucide-react';
import { PageHeading } from '@/components/ui/ds/PageHeading';
import {
  Button, EmptyState, PersonChip, ProgressBar, RegisterTable, SectionCard, SegmentedControl, StatusPill, TextInput,
  rowCountText, sortRows, type RegisterColumn, type SortState,
} from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { formatDate, formatRelative } from '@/lib/format';
import StartDialog, { assessmentHref } from './StartDialog';
import { inRegister, PHASE_LABEL, PHASE_TONE, progressOf, registerSortValue, subjectOf, TYPE_INFO, type PhaseFilter } from './scopingModel';
import { scopingApi, type AssessmentRow } from './scopingApi';

export const questionnaireHref = (format: string): string => `/cyber-security/questionnaires/${format}`;

const PHASES = [
  { value: 'all', label: 'All' },
  { value: 'scoping', label: 'Scoping' },
  { value: 'in_progress', label: 'In progress' },
] as const;

export default function AssessmentTypePage({ format }: { format: string }) {
  const info = TYPE_INFO[format];
  const router = useRouter();
  const [starting, setStarting] = useState(false);
  const [phase, setPhase] = useState<PhaseFilter>('all');
  const [text, setText] = useState('');
  const [sort, setSort] = useState<SortState>({ key: 'updated', dir: 'desc' });
  const templates = useQuery({ queryKey: ['scoping-templates'], queryFn: scopingApi.templates });
  const list = useQuery({ queryKey: ['scoping-list', format], queryFn: () => scopingApi.list({ assessment_format: format, limit: 200 }) });

  const tpl = templates.data?.find((t) => t.assessment_format === format);
  const questionnaire = tpl?.questionnaire ?? null;
  const all = useMemo(() => inRegister(list.data ?? [], 'all', ''), [list.data]);
  const rows = useMemo(() => sortRows(inRegister(list.data ?? [], phase, text), sort, registerSortValue), [list.data, phase, text, sort]);
  const filtered = phase !== 'all' || text.trim() !== '';
  if (!info) return null;

  const columns: RegisterColumn<AssessmentRow>[] = [
    {
      key: 'subject', header: info.model === 'asset' ? 'Application' : 'Function', sortable: true, isRowHeader: true,
      cell: (r) => <Link href={assessmentHref(r.id)} className="break-words font-[600] text-ds-fg hover:underline focus-visible:outline-none focus-visible:shadow-ds-ring">{subjectOf(r)}</Link>,
    },
    { key: 'phase', header: 'Phase', sortable: true, card: 'meta', cell: (r) => <StatusPill tone={PHASE_TONE[r.phase ?? 'scoping']} label={PHASE_LABEL[r.phase ?? 'scoping']} size="sm" /> },
    { key: 'owner', header: 'Owner', sortable: true, priority: 2, card: 'meta', cell: (r) => <PersonChip name={r.owner_name} /> },
    {
      key: 'progress', header: 'Progress', sortable: true, width: 'w-[180px]', card: 'meta',
      cell: (r) => <ProgressBar value={r.phase === 'scoping' ? null : progressOf(r)} label={`${subjectOf(r)}: questions marked`} />,
    },
    { key: 'due', header: 'Due', sortable: true, priority: 2, card: 'meta', cell: (r) => formatDate(r.due_date, { calendar: true }) },
    { key: 'updated', header: 'Updated', sortable: true, priority: 3, card: 'meta', cell: (r) => formatRelative(r.updated_at ?? r.created_at) || '—' },
  ];

  const counts = tpl ? ([tpl.in_progress > 0 && `${tpl.in_progress} in progress`, tpl.scoping > 0 && `${tpl.scoping} ${tpl.scoping === 1 ? 'draft' : 'drafts'}`].filter(Boolean).join(' · ') || undefined) : undefined;
  return (
    <div className="flex flex-col gap-[16px]">
      <PageHeading
        title={info.label}
        info={`${info.about} ${info.how}`}
        meta={counts}
        actions={<Button variant="primary" leftIcon={<Plus aria-hidden />} disabled={!questionnaire} onClick={() => setStarting(true)}>Start assessment</Button>}
      />
      <div className="grid gap-[16px] lg:grid-cols-2">
        <SectionCard id="needs" title="Before you start" info="What to have ready. Anything not known yet can be filled in later, by the person who knows it; the questions open only when the required parts are done.">
          <ul className="space-y-[6px]">
            {info.needs.map((n) => (
              <li key={n} className="flex gap-[8px] text-ds-body text-ds-fg-body"><span aria-hidden className="text-ds-fg-muted">•</span><span>{n}</span></li>
            ))}
          </ul>
        </SectionCard>
        <SectionCard
          id="questionnaire" title="Questionnaire"
          info="The questions as uploaded. Each assessment starts from a copy of them without their answers; uploading a new workbook changes the questions of assessments started afterwards, not those already started."
          meta={questionnaire ? `${questionnaire.items} questions · ${questionnaire.domains.length} ${questionnaire.domains.length === 1 ? 'domain' : 'domains'}` : undefined}
          actions={<Button size="sm" href={questionnaireHref(format)} leftIcon={questionnaire ? undefined : <Upload aria-hidden />} rightIcon={questionnaire ? <ArrowRight aria-hidden /> : undefined}>{questionnaire ? 'Open' : 'Upload'}</Button>}
        >
          {templates.isLoading ? <span className="text-ds-body text-ds-fg-muted">Loading…</span>
            : templates.isError ? <span className="text-ds-body text-ds-danger">{errorMessage(templates.error)}</span>
            : questionnaire ? <span className="break-words text-ds-body text-ds-fg-body">{questionnaire.name}</span>
            : <span className="text-ds-body text-ds-fg-muted">No questionnaire uploaded yet: upload the workbook to start an assessment.</span>}
        </SectionCard>
      </div>
      <SectionCard
        id="assessments" title="Assessments"
        meta={rowCountText({ shown: rows.length, total: all.length, noun: 'assessment', loading: list.isLoading, failed: list.isError })}
        actions={(
          <>
            <TextInput type="search" aria-label="Search the assessments" placeholder="Search" value={text} onChange={(e) => setText(e.target.value)} leftAdornment={<Search aria-hidden />} className="w-[14rem]" />
            <SegmentedControl label="Phase" name={`phase-${format}`} options={PHASES} value={phase} onChange={setPhase} />
          </>
        )}
      >
        <RegisterTable<AssessmentRow>
          caption={`${info.label} assessments`}
          columns={columns}
          rows={rows}
          getRowId={(r) => r.id}
          sort={sort}
          onSortChange={setSort}
          onRowActivate={(r) => router.push(assessmentHref(r.id))}
          loading={list.isLoading}
          error={list.isError ? { message: errorMessage(list.error), onRetry: canRetry(list.error) ? () => { void list.refetch(); } : undefined } : null}
          cardTitle={(r) => (
            <Link href={assessmentHref(r.id)} className="break-words font-[600] text-ds-fg hover:underline focus-visible:outline-none focus-visible:shadow-ds-ring">{subjectOf(r)}</Link>
          )}
          empty={filtered ? (
            <EmptyState kind="noMatches" bare title="No assessment matches" onClearFilters={() => { setText(''); setPhase('all'); }} />
          ) : (
            <EmptyState
              kind="firstUse" bare title="No assessments yet"
              description={questionnaire ? `Start one for a ${info.subject}.` : 'Upload the questionnaire first.'}
              action={questionnaire ? <Button variant="primary" leftIcon={<Plus aria-hidden />} onClick={() => setStarting(true)}>Start assessment</Button> : undefined}
            />
          )}
        />
      </SectionCard>
      {starting && <StartDialog format={format} onClose={() => setStarting(false)} />}
    </div>
  );
}
