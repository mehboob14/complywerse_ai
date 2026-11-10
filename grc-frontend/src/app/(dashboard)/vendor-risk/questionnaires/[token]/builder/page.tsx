'use client';

// The questionnaire builder: sections of questions down the page, an outline and the add buttons beside them, and every edit in a sheet. Each change is saved as it is made (the whole list, in one request),
// so there is no Save for the page; a failed save stays on screen with Retry, and a save made on a copy someone else has since changed is refused and says so (Reload). The rules are in
// _lib/questionnaires/model.ts. It lives at /questionnaires/<id>/builder, not /questionnaires/<id>: that address is the supplier's public link (<token>, outside this shell) and a second page cannot sit on
// it. The folder is called [token] because Next wants one name for a segment that two pages share; here it is the questionnaire's id.
import { useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, ArchiveRestore, ArrowDown, ArrowUp, Copy, Eye, Library, Plus, SlidersHorizontal } from 'lucide-react';
import { PageHeader } from '@/components/ui';
import { Button, EmptyState, ErrorState, IconButton, Menu, Notice, ReadOnlyNote, SectionCard, Skeleton, StatusPill, useConfirm, useNotify, useReportedMutation, type MenuItem } from '@/components/ui/ds';
import { canRetry, errorMessage, statusOf } from '@/components/ui/ds/reportOutcome';
import { formatDate } from '@/lib/format';
import { vendorTier } from '@/lib/statuses/vendor';
import { TPRM_QUERY_OPTS } from '../../../_lib/tprmQuery';
import { LIST_HREF, questionnairesApi, templateKey, templatesKey } from '../../../_lib/questionnairesApi';
import {
  addFromLibrary, chipsFor, dependentsOf, insertAfter, librarySets, moveQuestion, moveRun, optionsLine, orderProblem, removeQuestion, replaceQuestion, sectionsOf,
} from '../../../_lib/questionnaires/model';
import { plural } from '../../../_lib/questionnaires/hubModel';
import type { Question, Template } from '../../../_lib/questionnaires/types';
import { categoryLabel } from '../../_forms/categories';
import { PreviewSheet } from '../../_forms/PreviewSheet';
import { TemplateSettingsSheet } from '../../_forms/TemplateSettingsSheet';
import { useRights } from '../../_forms/useRights';
import { useTemplateOps } from '../../_library/useTemplateOps';
import { useTemplates } from '../../_library/useTemplates';
import { LibrarySheet } from '../../_builder/LibrarySheet';
import { QuestionEditor } from '../../_builder/QuestionEditor';
import { QuestionRow } from '../../_builder/QuestionRow';

const MUTED = 'text-ds-fg-muted';

export default function QuestionnaireBuilderPage() {
  const { token } = useParams<{ token: string }>();       // the id: see the note at the top
  const id = Number(token);
  const qc = useQueryClient();
  const notify = useNotify();
  const { confirm, confirmDialog } = useConfirm();
  const ops = useTemplateOps();
  const rights = useRights();
  const [editing, setEditing] = useState<{ base: Question | null; afterId: string | null } | null>(null);
  const [session, setSession] = useState(0);                 // a new editor draft for every opening
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [conflict, setConflict] = useState(false);

  const query = useQuery({ queryKey: templateKey(id), queryFn: async () => (await questionnairesApi.get(id)).data, enabled: Number.isFinite(id), ...TPRM_QUERY_OPTS });
  const everyone = useTemplates();
  const template = query.data;
  const questions = useMemo(() => template?.questions ?? [], [template]);
  const runs = useMemo(() => sectionsOf(questions), [questions]);
  const sets = useMemo(() => librarySets(everyone.data?.items ?? [], id), [everyone.data, id]);
  const names = useMemo(() => new Map((everyone.data?.items ?? []).map((t) => [t.id, t.name])), [everyone.data]);
  const archived = !!template?.archived_at;
  const editable = rights.edit && !archived;

  const apply = (next: Template) => {
    qc.setQueryData(templateKey(id), next);
    void qc.invalidateQueries({ queryKey: [...templatesKey] });
  };
  // a save made on a copy someone else has since changed is refused with their words; the page offers to read theirs
  const refused = (e: unknown) => {
    if (statusOf(e) === 409 && /someone else/i.test(errorMessage(e))) { setConflict(true); window.setTimeout(() => document.getElementById('questionnaire-conflict')?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 60); }
  };
  const save = useReportedMutation({
    mutationFn: async (v: { next: Question[]; said?: string }) => (await questionnairesApi.update(id, { questions: v.next, expected_updated_at: template?.updated_at })).data,
    success: (_d, v) => v.said ?? 'Saved',
    failure: "Couldn't save the questionnaire",
    onSuccess: apply,
    onError: refused,
  });
  const reorder = useReportedMutation({                      // a move says nothing when it worked: the list changes by itself
    mutationFn: async (v: { next: Question[] }) => (await questionnairesApi.update(id, { questions: v.next, expected_updated_at: template?.updated_at })).data,
    failure: "Couldn't save the new order",
    toast: 'errors',
    onSuccess: apply,
    onError: refused,
  });
  const busy = save.isPending || reorder.isPending;

  /** Save a new order or content, unless it would put a question above the one it depends on. */
  const commit = (next: Question[] | null, said?: string, after?: () => void) => {
    if (!next) return;
    const problem = orderProblem(next);
    if (problem) { notify.error(problem, { title: 'Cannot move it there' }); return; }
    save.mutate({ next, said }, { onSuccess: () => after?.() });
  };
  const move = (next: Question[] | null) => {
    if (!next) return;
    const problem = orderProblem(next);
    if (problem) { notify.error(problem, { title: 'Cannot move it there' }); return; }
    reorder.mutate({ next });
  };
  const reload = () => { setConflict(false); void query.refetch(); };
  const open = (base: Question | null, afterId: string | null) => { setSession((n) => n + 1); setEditing({ base, afterId }); };
  const askRemove = async (q: Question) => {
    const dependents = dependentsOf(questions, q.id);
    const yes = await confirm({
      title: 'Remove this question?',
      message: `${q.text} leaves this questionnaire. Questionnaires already sent keep their own copy.${dependents.length ? ` ${dependents.length === 1 ? `Q${questions.indexOf(dependents[0]) + 1} only shows after it, and will` : `${dependents.length} questions only show after it, and will`} be asked always.` : ''}`,
      confirmLabel: 'Remove question',
      tone: 'danger',
    });
    if (yes) commit(removeQuestion(questions, q.id), 'Question removed');
  };

  const back = { href: LIST_HREF, label: 'Back to Questionnaires' };
  if (query.isError && !template) {
    return (
      <div className="flex flex-col gap-[16px]">
        <PageHeader variant="page" title="Questionnaire" back={back} />
        <ErrorState title="Couldn't open this questionnaire" message={errorMessage(query.error)} onRetry={canRetry(query.error) ? () => { void query.refetch(); } : undefined} />
      </div>
    );
  }
  if (!template) {
    return (
      <div className="flex flex-col gap-[16px]">
        <PageHeader variant="page" title="Questionnaire" back={back} />
        <div aria-busy="true" className="flex flex-col gap-[12px]"><Skeleton className="h-[80px]" /><Skeleton className="h-[320px]" /></div>
      </div>
    );
  }

  const numberOf = (q: Question) => questions.indexOf(q) + 1;
  const menu: MenuItem[] = [
    { key: 'copy', label: 'Duplicate', icon: Copy, hidden: !rights.create, onSelect: () => ops.duplicate(template) },
    { key: 'archive', label: archived ? 'Restore' : 'Archive', icon: archived ? ArchiveRestore : Archive, hidden: !rights.edit, onSelect: () => ops.archive(template) },
  ];
  const meta = [plural(template.question_count, 'question', 'questions'), plural(template.section_count, 'section', 'sections'), `Updated ${formatDate(template.updated_at)}`, template.updated_by_name].filter(Boolean).join(' · ');

  return (
    <div className="flex flex-col gap-[16px]">
      <PageHeader
        variant="page"
        title={template.name}
        back={back}
        meta={meta}
        chips={(
          <>
            {template.category && <StatusPill tone="neutral" label={categoryLabel(template.category)} />}
            {template.default_tiers.map((tier) => <StatusPill key={tier} tone={vendorTier.tone(tier)} label={`${vendorTier.label(tier)} tier`} />)}
            {archived && <StatusPill tone="warning" label="Archived" />}
          </>
        )}
        actions={(
          <>
            <Button leftIcon={<Eye aria-hidden />} disabled={questions.length === 0} onClick={() => setPreviewOpen(true)}>Preview</Button>
            {editable && <Button leftIcon={<SlidersHorizontal aria-hidden />} onClick={() => setSettingsOpen(true)}>Settings</Button>}
            {menu.some((m) => !m.hidden) && <Menu label="More" items={menu} />}
          </>
        )}
      />

      {conflict && (
        <div id="questionnaire-conflict" className="scroll-mt-[16px]">
          <Notice tone="warning" title="Someone else changed this questionnaire" action={<Button size="sm" onClick={reload}>Reload</Button>}>
            Your last change was not saved. Reload to see their version, then make it again.
          </Notice>
        </div>
      )}
      {query.isError && <ErrorState compact title="Couldn't refresh this questionnaire" message={`${errorMessage(query.error)} What is shown may be out of date.`} onRetry={canRetry(query.error) ? () => { void query.refetch(); } : undefined} className="rounded-ds-card border border-ds-danger-border bg-ds-danger-soft" />}
      {archived && <Notice tone="warning">Archived. Restore it to change it.</Notice>}
      {!rights.edit && !archived && <ReadOnlyNote>View only. Changing a questionnaire needs the right to edit questionnaires.</ReadOnlyNote>}
      {template.latest_version ? <p className={`text-ds-body ${MUTED}`}>Questionnaires already sent keep version {template.latest_version}. Changes apply to the ones you send from now on.</p> : null}

      <div className="grid items-start gap-[16px] lg:grid-cols-[256px_minmax(0,1fr)]">
        <aside className="flex flex-col gap-[12px] lg:sticky lg:top-[16px]" aria-label="Outline">
          <SectionCard id="outline" title="Sections" meta={runs.length ? `${runs.length}` : undefined}>
            {runs.length === 0 ? (
              <p className={`text-ds-body ${MUTED}`}>None yet</p>
            ) : (
              <ul className="flex flex-col">
                {runs.map((r, i) => (
                  <li key={`${r.key}-${r.from}`}>
                    <button
                      type="button"
                      onClick={() => document.getElementById(`section-${i}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                      className="flex min-h-ds-control w-full items-center gap-[8px] rounded-ds-control px-[8px] text-left text-ds-body text-ds-fg-body hover:bg-ds-surface-hover focus-visible:outline-none focus-visible:shadow-ds-ring"
                    >
                      <span className="min-w-0 flex-1 truncate">{r.name}</span>
                      <span className={`text-ds-label tabular-nums ${MUTED}`}>{r.questions.length}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {editable && (
              <div className="mt-[12px] flex flex-col gap-[8px] border-t border-ds-border pt-[12px]">
                <Button variant="primary" fullWidth leftIcon={<Plus aria-hidden />} onClick={() => open(null, null)}>Add a question</Button>
                <Button fullWidth leftIcon={<Library aria-hidden />} onClick={() => setLibraryOpen(true)}>From the library</Button>
              </div>
            )}
          </SectionCard>
        </aside>

        <main className="flex min-w-0 flex-col gap-[16px]">
          {questions.length === 0 ? (
            <EmptyState
              kind="firstUse" title="No questions yet" description="Pick questions from the library or write your own."
              action={editable ? (
                <div className="flex flex-wrap justify-center gap-[8px]">
                  <Button variant="primary" leftIcon={<Library aria-hidden />} onClick={() => setLibraryOpen(true)}>From the library</Button>
                  <Button leftIcon={<Plus aria-hidden />} onClick={() => open(null, null)}>Add a question</Button>
                </div>
              ) : undefined}
            />
          ) : runs.map((run, runIndex) => (
            <div key={`${run.key}-${run.from}`} id={`section-${runIndex}`} className="scroll-mt-[16px]">
              <SectionCard
                id={`run-${runIndex}`}
                title={run.name}
                meta={`${run.questions.length} ${run.questions.length === 1 ? 'question' : 'questions'}`}
                actions={editable && runs.length > 1 ? (
                  <>
                    <IconButton label={`Move ${run.name} up`} disabled={runIndex === 0 || busy} onClick={() => move(moveRun(questions, runIndex, -1))}><ArrowUp aria-hidden /></IconButton>
                    <IconButton label={`Move ${run.name} down`} disabled={runIndex === runs.length - 1 || busy} onClick={() => move(moveRun(questions, runIndex, 1))}><ArrowDown aria-hidden /></IconButton>
                  </>
                ) : undefined}
              >
                <ol className="flex flex-col divide-y divide-ds-border">
                  {run.questions.map((q, i) => {
                    const parent = q.show_if ? questions.find((x) => x.id === q.show_if?.question) : undefined;
                    return (
                      <QuestionRow
                        key={q.id}
                        question={q}
                        number={numberOf(q)}
                        chips={chipsFor(q, { number: numberOf(q), parent: parent ? { number: numberOf(parent), question: parent } : undefined, followName: q.follow_up ? names.get(q.follow_up.template_id) : undefined })}
                        answers={optionsLine(q)}
                        editable={editable}
                        busy={busy}
                        canUp={i > 0}
                        canDown={i < run.questions.length - 1}
                        onEdit={() => open(q, null)}
                        onAddBelow={() => open(null, q.id)}
                        onUp={() => move(moveQuestion(questions, q.id, -1))}
                        onDown={() => move(moveQuestion(questions, q.id, 1))}
                        onRemove={() => { void askRemove(q); }}
                      />
                    );
                  })}
                </ol>
              </SectionCard>
            </div>
          ))}
        </main>
      </div>

      {editable && (
        <QuestionEditor
          key={session}
          open={!!editing}
          base={editing?.base ?? null}
          afterId={editing?.afterId ?? null}
          questions={questions}
          templates={everyone.data?.items ?? []}
          templateId={id}
          saving={save.isPending}
          onClose={() => setEditing(null)}
          onSave={(q) => {
            const was = editing;
            commit(was?.base ? replaceQuestion(questions, q) : insertAfter(questions, was?.afterId ?? null, q), was?.base ? 'Question saved' : 'Question added', () => setEditing(null));
          }}
        />
      )}
      {editable && (
        <LibrarySheet
          open={libraryOpen}
          sets={sets}
          questions={questions}
          onClose={() => setLibraryOpen(false)}
          onAdd={(picked) => commit(addFromLibrary(questions, picked), `${picked.length} ${picked.length === 1 ? 'question' : 'questions'} added`)}
        />
      )}
      {editable && <TemplateSettingsSheet open={settingsOpen} template={template} canConfig={rights.config} onClose={() => setSettingsOpen(false)} onSaved={apply} />}
      <PreviewSheet open={previewOpen} name={template.name} questions={questions} onClose={() => setPreviewOpen(false)} />
      {confirmDialog}
      {ops.confirmDialog}
    </div>
  );
}
