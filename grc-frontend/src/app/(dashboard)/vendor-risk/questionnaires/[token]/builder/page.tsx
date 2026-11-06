'use client';

// The questionnaire builder: sections of questions down the page, an outline and the add buttons beside them, and every edit in a
// panel. Each change is saved as it is made (the whole list, in one request), so there is no Save for the page. The rules are in
// _lib/questionnaires/model.ts. It lives at /questionnaires/<id>/builder, not /questionnaires/<id>: that address is the supplier's
// public link (<token>, outside this shell) and a second page cannot sit on it. The folder is called [token] because Next
// wants one name for a segment that two pages share; here it is the questionnaire's id.
import { useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Archive, ArchiveRestore, ClipboardList, Copy, Eye, Library, Pencil, Plus, SlidersHorizontal, Trash2 } from 'lucide-react';
import { useToast } from '@/components/ui/ToastProvider';
import { usePermissions } from '@/hooks/usePermissions';
import { apiErrorText } from '@/lib/apiError';
import { RowActionsMenu, type RowAction } from '@/app/(dashboard)/governance/documents/_workspace/RowActionsMenu';
import {
  DetailHeader, Dialog, EmptyState, ErrorState, Skeleton, StatusPill, TierBadge, fmt, BTN, BTN_DANGER, BTN_PRIMARY,
} from '@/app/(dashboard)/vendor-risk/_ui';
import { TPRM_QUERY_OPTS } from '../../../_lib/tprmQuery';
import { builderHref, LIST_HREF, questionnairesApi, templateKey, templatesKey } from '../../../_lib/questionnairesApi';
import {
  addFromLibrary, chipsFor, dependentsOf, insertAfter, librarySets, moveQuestion, moveRun, optionsLine, orderProblem, removeQuestion,
  replaceQuestion, sectionsOf,
} from '../../../_lib/questionnaires/model';
import type { Question } from '../../../_lib/questionnaires/types';
import { LibraryPicker } from '../../_parts/LibraryPicker';
import { PreviewDialog } from '../../_parts/PreviewDialog';
import { QuestionEditor } from '../../_parts/QuestionEditor';
import { SettingsDialog } from '../../_parts/SettingsDialog';
import { Chip } from '../../_parts/ui';

const ARROW = 'grid h-8 w-8 place-items-center rounded-lg text-[#586472] hover:bg-[#f3f6f8] hover:text-[#1f2933] disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f766e]';

function Row({ question: q, number, chips, answers, editable, busy, canUp, canDown, onEdit, onAddBelow, onUp, onDown, onRemove }: {
  question: Question; number: number; chips: ReturnType<typeof chipsFor>; answers: string; editable: boolean; busy: boolean;
  canUp: boolean; canDown: boolean; onEdit: () => void; onAddBelow: () => void; onUp: () => void; onDown: () => void; onRemove: () => void;
}) {
  const body = (
    <>
      <span className="block text-sm leading-5 text-[#1f2933]">{q.text}</span>
      <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
        {chips.map((c) => <Chip key={c.key} tone={c.tone} title={c.title}>{c.text}</Chip>)}
      </span>
      {answers && <span className="mt-1.5 line-clamp-1 block text-[12px] leading-4 text-[#64707e]">{answers}</span>}
    </>
  );
  const actions: RowAction[] = [
    { key: 'edit', label: 'Edit', icon: Pencil, onClick: onEdit },
    { key: 'below', label: 'Add question below', icon: Plus, onClick: onAddBelow },
    { key: 'remove', label: 'Remove', icon: Trash2, variant: 'danger', onClick: onRemove },
  ];
  return (
    <li className="flex items-start gap-3 px-4 py-3">
      <span className="mt-0.5 w-8 shrink-0 text-[13px] font-semibold tabular-nums text-[#64707e]">Q{number}</span>
      {editable ? (
        <button type="button" onClick={onEdit} className="min-w-0 flex-1 rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f766e]">{body}</button>
      ) : <div className="min-w-0 flex-1">{body}</div>}
      {editable && (
        <div className="flex shrink-0 items-center gap-0.5">
          <button type="button" className={ARROW} aria-label={`Move Q${number} up`} disabled={!canUp || busy} onClick={onUp}><ArrowUp aria-hidden className="h-3.5 w-3.5" /></button>
          <button type="button" className={ARROW} aria-label={`Move Q${number} down`} disabled={!canDown || busy} onClick={onDown}><ArrowDown aria-hidden className="h-3.5 w-3.5" /></button>
          <RowActionsMenu actions={actions} />
        </div>
      )}
    </li>
  );
}

export default function QuestionnaireBuilderPage() {
  const { token } = useParams<{ token: string }>();       // the id: see the note at the top
  const id = Number(token);
  const router = useRouter();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { hasPermission } = usePermissions();
  const erm = hasPermission('erm:risks:edit');
  const canEdit = hasPermission('vendor_risk:templates:edit') || erm;
  const canCreate = hasPermission('vendor_risk:templates:create') || erm;
  const canConfig = hasPermission('vendor_risk:config:edit') || erm;

  const [editing, setEditing] = useState<{ base: Question | null; afterId: string | null } | null>(null);
  const [removing, setRemoving] = useState<Question | null>(null);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const query = useQuery({
    queryKey: templateKey(id),
    queryFn: async () => (await questionnairesApi.get(id)).data,
    enabled: Number.isFinite(id),
    ...TPRM_QUERY_OPTS,
  });
  const everyone = useQuery({
    queryKey: [...templatesKey, 'all'],
    queryFn: async () => (await questionnairesApi.list(true)).data.items,
    placeholderData: keepPreviousData,
    ...TPRM_QUERY_OPTS,
  });
  const template = query.data;
  const questions = useMemo(() => template?.questions ?? [], [template]);
  const runs = useMemo(() => sectionsOf(questions), [questions]);
  const sets = useMemo(() => librarySets(everyone.data ?? [], id), [everyone.data, id]);
  const names = useMemo(() => new Map((everyone.data ?? []).map((t) => [t.id, t.name])), [everyone.data]);
  const archived = !!template?.archived_at;
  const editable = canEdit && !archived;

  const failed = (title: string) => (e: unknown) => toast({ type: 'error', title, message: apiErrorText(e, 'Try again.') });
  const apply = (next: NonNullable<typeof template>) => {
    queryClient.setQueryData(templateKey(id), next);
    queryClient.invalidateQueries({ queryKey: templatesKey });
  };
  const save = useMutation({
    mutationFn: async (next: Question[]) => (await questionnairesApi.update(id, { questions: next })).data,
    onSuccess: apply,
    onError: failed('Could not save'),
  });
  const archive = useMutation({
    mutationFn: async () => (await (archived ? questionnairesApi.restore(id) : questionnairesApi.archive(id))).data,
    onSuccess: (next) => { apply(next); toast({ type: 'success', title: next.archived_at ? 'Archived' : 'Restored' }); },
    onError: failed('Could not do that'),
  });
  const duplicate = useMutation({
    mutationFn: async () => (await questionnairesApi.duplicate(id)).data,
    onSuccess: (copy) => { queryClient.invalidateQueries({ queryKey: templatesKey }); toast({ type: 'success', title: 'Questionnaire copied' }); router.push(builderHref(copy.id)); },
    onError: failed('Could not copy it'),
  });

  /** Save a new order or content, unless it would put a question above the one it depends on. */
  const commit = (next: Question[] | null, done?: () => void) => {
    if (!next) return;
    const problem = orderProblem(next);
    if (problem) { toast({ type: 'error', title: 'Cannot move it there', message: problem }); return; }
    save.mutate(next, { onSuccess: done });
  };

  if (query.isError) {
    return (
      <div className="space-y-4">
        <DetailHeader backHref={`${LIST_HREF}?purpose=due_diligence`} backLabel="Back to Questionnaires" icon={ClipboardList} title="Questionnaire" />
        <ErrorState title="Couldn't open this questionnaire" message={apiErrorText(query.error, 'It may have been deleted.')} onRetry={() => query.refetch()} />
      </div>
    );
  }
  if (!template) {
    return <div className="space-y-4"><Skeleton className="h-20" /><Skeleton className="h-96" /></div>;
  }

  const numberOf = (q: Question) => questions.indexOf(q) + 1;
  const menu: RowAction[] = [
    { key: 'copy', label: 'Duplicate', icon: Copy, onClick: () => duplicate.mutate(), hidden: !canCreate },
    { key: 'archive', label: archived ? 'Restore' : 'Archive', icon: archived ? ArchiveRestore : Archive, onClick: () => archive.mutate(), hidden: !canEdit },
  ];
  const dependents = removing ? dependentsOf(questions, removing.id) : [];

  return (
    <div className="space-y-5">
      <DetailHeader
        backHref={`${LIST_HREF}?purpose=due_diligence`}
        backLabel="Back to Questionnaires"
        icon={ClipboardList}
        title={template.name}
        chips={(
          <>
            <Chip>Due diligence</Chip>
            {template.default_tiers.map((tier) => <TierBadge key={tier} tier={tier} suffix="tier" />)}
            {archived && <StatusPill tone="warning">Archived</StatusPill>}
          </>
        )}
        meta={[`${template.question_count} questions`, `${template.section_count} sections`, `Updated ${fmt.date(template.updated_at)}`, template.updated_by_name].filter(Boolean).join(' · ')}
        actions={(
          <>
            <button type="button" className={BTN} disabled={questions.length === 0} onClick={() => setPreviewOpen(true)}><Eye aria-hidden className="h-4 w-4" /> Preview</button>
            {editable && <button type="button" className={BTN} onClick={() => setSettingsOpen(true)}><SlidersHorizontal aria-hidden className="h-4 w-4" /> Settings</button>}
            {menu.some((a) => !a.hidden) && <RowActionsMenu actions={menu} />}
          </>
        )}
      />

      <div className="grid items-start gap-5 lg:grid-cols-[16rem_minmax(0,1fr)]">
        <aside className="space-y-3 lg:sticky lg:top-4" aria-label="Outline">
          <div className="rounded-xl border border-[#d5dbe1] bg-[#fff] p-3">
            <h2 className="px-1 text-[11px] font-semibold uppercase tracking-wide text-[#64707e]">Sections</h2>
            {runs.length === 0 ? (
              <p className="px-1 pt-2 text-[13px] text-[#64707e]">None yet</p>
            ) : (
              <ul className="mt-1.5 space-y-0.5">
                {runs.map((r, i) => (
                  <li key={`${r.key}-${r.from}`}>
                    <button
                      type="button"
                      onClick={() => document.getElementById(`section-${i}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-[#586472] hover:bg-[#f3f6f8] hover:text-[#1f2933] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f766e]"
                    >
                      <span className="min-w-0 flex-1 truncate">{r.name}</span>
                      <span className="text-[12px] tabular-nums text-[#64707e]">{r.questions.length}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {editable && (
              <div className="mt-3 grid gap-2 border-t border-[#eef1f4] pt-3">
                <button type="button" className={`${BTN_PRIMARY} justify-center`} onClick={() => setEditing({ base: null, afterId: null })}><Plus aria-hidden className="h-4 w-4" /> Add question</button>
                <button type="button" className={`${BTN} justify-center`} onClick={() => setLibraryOpen(true)}><Library aria-hidden className="h-4 w-4" /> From library</button>
              </div>
            )}
          </div>
        </aside>

        <main className="min-w-0 space-y-4">
          {archived && <p className="rounded-lg bg-[#fbf1e4] px-3 py-2 text-[13px] leading-5 text-[#9a5007]">Archived. Restore it to change it.</p>}
          {template.latest_version ? (
            <p className="text-[13px] leading-5 text-[#586472]">
              Questionnaires already sent keep version {template.latest_version}. Changes apply to the ones you send from now on.
            </p>
          ) : null}
          {questions.length === 0 ? (
            <EmptyState
              title="No questions yet"
              hint="Pick questions from the library or write your own."
              action={editable ? (
                <div className="flex flex-wrap justify-center gap-2">
                  <button type="button" className={BTN_PRIMARY} onClick={() => setLibraryOpen(true)}><Library aria-hidden className="h-4 w-4" /> From library</button>
                  <button type="button" className={BTN} onClick={() => setEditing({ base: null, afterId: null })}><Plus aria-hidden className="h-4 w-4" /> Add question</button>
                </div>
              ) : undefined}
            />
          ) : runs.map((run, runIndex) => (
            // a group, not a region: a section split in two has two cards of the same name, and a landmark must be named once
            <div key={`${run.key}-${run.from}`} id={`section-${runIndex}`} role="group" aria-label={run.name} className="scroll-mt-4 overflow-hidden rounded-xl border border-[#d5dbe1] bg-[#fff]">
              <header className="flex items-center gap-2 border-b border-[#e1e6eb] bg-[#f7f9fa] px-4 py-2.5">
                <h2 className="min-w-0 flex-1 truncate text-[15px] font-semibold text-[#1f2933]">{run.name}</h2>
                <span className="text-[13px] tabular-nums text-[#64707e]">{run.questions.length}</span>
                {editable && runs.length > 1 && (
                  <>
                    <button type="button" className={ARROW} aria-label={`Move ${run.name} up`} disabled={runIndex === 0 || save.isPending} onClick={() => commit(moveRun(questions, runIndex, -1))}><ArrowUp aria-hidden className="h-3.5 w-3.5" /></button>
                    <button type="button" className={ARROW} aria-label={`Move ${run.name} down`} disabled={runIndex === runs.length - 1 || save.isPending} onClick={() => commit(moveRun(questions, runIndex, 1))}><ArrowDown aria-hidden className="h-3.5 w-3.5" /></button>
                  </>
                )}
              </header>
              <ol className="divide-y divide-[#eef1f4]">
                {run.questions.map((q, i) => {
                  const parent = q.show_if ? questions.find((x) => x.id === q.show_if?.question) : undefined;
                  return (
                    <Row
                      key={q.id}
                      question={q}
                      number={numberOf(q)}
                      chips={chipsFor(q, {
                        number: numberOf(q),
                        parent: parent ? { number: numberOf(parent), question: parent } : undefined,
                        followName: q.follow_up ? names.get(q.follow_up.template_id) : undefined,
                      })}
                      answers={optionsLine(q)}
                      editable={editable}
                      busy={save.isPending}
                      canUp={i > 0}
                      canDown={i < run.questions.length - 1}
                      onEdit={() => setEditing({ base: q, afterId: null })}
                      onAddBelow={() => setEditing({ base: null, afterId: q.id })}
                      onUp={() => commit(moveQuestion(questions, q.id, -1))}
                      onDown={() => commit(moveQuestion(questions, q.id, 1))}
                      onRemove={() => setRemoving(q)}
                    />
                  );
                })}
              </ol>
            </div>
          ))}
        </main>
      </div>

      {editable && editing && (
        <QuestionEditor
          base={editing.base}
          afterId={editing.afterId}
          questions={questions}
          templates={everyone.data ?? []}
          templateId={id}
          saving={save.isPending}
          onClose={() => setEditing(null)}
          onSave={(q) => commit(
            editing.base ? replaceQuestion(questions, q) : insertAfter(questions, editing.afterId, q),
            () => { setEditing(null); toast({ type: 'success', title: editing.base ? 'Question saved' : 'Question added' }); },
          )}
        />
      )}
      {editable && (
        <LibraryPicker
          open={libraryOpen}
          sets={sets}
          questions={questions}
          onClose={() => setLibraryOpen(false)}
          onAdd={(picked) => commit(addFromLibrary(questions, picked), () => toast({ type: 'success', title: `${picked.length} ${picked.length === 1 ? 'question' : 'questions'} added` }))}
        />
      )}
      {editable && (
        <SettingsDialog open={settingsOpen} template={template} canConfig={canConfig} onClose={() => setSettingsOpen(false)} onSaved={apply} />
      )}
      <PreviewDialog open={previewOpen} name={template.name} questions={questions} onClose={() => setPreviewOpen(false)} />
      <Dialog
        open={!!removing}
        onClose={() => setRemoving(null)}
        title="Remove this question?"
        footer={(
          <>
            <button type="button" className={BTN} onClick={() => setRemoving(null)}>Cancel</button>
            <button
              type="button" className={BTN_DANGER} disabled={save.isPending}
              onClick={() => removing && commit(removeQuestion(questions, removing.id), () => { setRemoving(null); toast({ type: 'success', title: 'Question removed' }); })}
            >
              {save.isPending ? 'Removing…' : 'Remove question'}
            </button>
          </>
        )}
      >
        <p className="text-sm leading-5 text-[#26323d]">
          <span className="font-semibold text-[#1f2933]">{removing?.text}</span> leaves this questionnaire. Questionnaires already sent keep their own copy.
        </p>
        {dependents.length > 0 && (
          <p className="mt-2 text-[13px] leading-5 text-[#9a5007]">
            {dependents.length === 1 ? `Q${numberOf(dependents[0])} only shows after it, and will` : `${dependents.length} questions only show after it, and will`} be asked always.
          </p>
        )}
      </Dialog>
    </div>
  );
}
