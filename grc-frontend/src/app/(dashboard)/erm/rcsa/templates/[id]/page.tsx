'use client';

// The questionnaire workspace: one questionnaire as the risk team builds it and the assessor meets it. The outline (sections and questions) is on the left and a live preview of what the
// assessor sees on the right (one beside the other from 1024px, a switch between them under it). Edits are a draft in the browser until Save; Save sends the whole questionnaire, and the
// server deletes any question that is no longer in it together with the answers given to it, so the page says so before it does that. A questionnaire the platform provides is read only:
// Clone makes the person's own copy, which they can change.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Copy, Download, FolderPlus, Pencil, Plus } from 'lucide-react';
import { PageHeader } from '@/components/ui';
import { Button, ErrorState, FormError, NoAccessState, SaveBar, SectionCard, SegmentedControl, Skeleton, SkeletonRows, StatusPill, useConfirm, useReportedMutation } from '@/components/ui/ds';
import { errorMessage } from '@/components/ui/ds/reportOutcome';
import { rcsaApi } from '@/lib/api';
import { isForbidden, retryUnlessRefused } from '@/lib/rcsa/registerModel';
import { saveBlob } from '@/lib/rcsa/saveBlob';
import {
  addQuestion, addSection, blankQuestion, deleteCost, draftProblems, duplicateQuestion, fromServer, inUseText, isDirty, moveQuestion, moveSection, plural, questionCount, readOnlyReason,
  removedQuestions, removeQuestion, removeSection, renameSection, saveWarning, sectionNameProblem, sectionNames, templateFileName, toPayload, updateQuestion, whoOf,
  type Draft, type DraftQuestion, type DraftSection, type ServerQuestion,
} from '@/lib/rcsa/templatesModel';
import { truncate } from '@/lib/format';
import { KEYS, fetchAll, useRcsaRights } from '../../_parts/rcsaData';
import { CloneSheet } from '../_parts/LibrarySheets';
import { Outline, type OutlineActions } from './_parts/Outline';
import { Preview } from './_parts/Preview';
import { QuestionSheet, type QuestionEdit } from './_parts/QuestionSheet';
import { DetailsSheet, SectionSheet } from './_parts/SmallSheets';
import { useLeaveGuard } from './_parts/useLeaveGuard';

interface Detail {
  id: number;
  name: string;
  description?: string | null;
  category: string;
  version: string;
  is_system_template?: boolean;
  campaign_count?: number;
  questions: ServerQuestion[];
}

type Pane = 'outline' | 'preview';

export default function QuestionnaireWorkspacePage() {
  const params = useParams() as { id?: string };
  const id = Number(params?.id);
  const { manage, loading: rightsLoading } = useRcsaRights();
  const { confirm, confirmDialog } = useConfirm();
  const query = useQuery({
    queryKey: KEYS.template(id),
    enabled: id > 0,
    retry: retryUnlessRefused,
    queryFn: async () => (await rcsaApi.getTemplate(id)).data as Detail,
  });
  // how many campaigns use it is the library's number (the detail does not carry it): the same cached list the library reads. A failure to read it is not a failure of the page, but
  // then nothing may be said about answers that are safe, so the warnings speak of "any answers" and the chip is left out.
  const usage = useQuery({ queryKey: KEYS.templates, queryFn: () => fetchAll<{ id: number; campaign_count?: number }>('/erm/rcsa/templates') });
  const t = query.data;
  const campaignsKnown = usage.isSuccess;
  const campaigns = usage.data?.find((x) => x.id === id)?.campaign_count ?? 0;
  const forWarning: number | null = campaignsKnown ? campaigns : null;

  const [draft, setDraft] = useState<Draft>([]);
  const [saved, setSaved] = useState<Draft>([]);
  const draftRef = useRef(draft);
  const savedRef = useRef(saved);
  draftRef.current = draft;
  savedRef.current = saved;
  const resetNext = useRef(false);
  const seeded = useRef(false);
  const [problem, setProblem] = useState<unknown>(null);
  const [justSaved, setJustSaved] = useState(false);
  const [pane, setPane] = useState<Pane>('outline');
  const [editing, setEditing] = useState<QuestionEdit | null>(null);
  const [sectionSheet, setSectionSheet] = useState<{ section: DraftSection | null; open: boolean; nonce: number }>({ section: null, open: false, nonce: 0 });
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [detailsNonce, setDetailsNonce] = useState(0);
  const [cloning, setCloning] = useState(false);
  const nonce = useRef(0);

  // the draft starts from the server's questionnaire, and starts over when the server answers after a save; an unsaved draft is never replaced by a refresh
  useEffect(() => {
    if (!t) return;
    if (seeded.current && !resetNext.current && isDirty(draftRef.current, savedRef.current)) return;
    const fresh = fromServer(t.questions);
    seeded.current = true;
    resetNext.current = false;
    setDraft(fresh);
    setSaved(fresh);
  }, [t]);

  const readOnly = !!t?.is_system_template;
  const editable = !!t && !readOnly && !rightsLoading && manage;
  const dirty = editable && isDirty(draft, saved);
  const problems = useMemo(() => draftProblems(draft), [draft]);
  useLeaveGuard(dirty, () => confirm({ title: 'Leave without saving?', message: 'The changes you made to this questionnaire are lost.', confirmLabel: 'Leave', cancelLabel: 'Keep editing', tone: 'danger' }));

  const save = useReportedMutation({
    mutationFn: async () => { await rcsaApi.updateTemplate(id, { questions: toPayload(draftRef.current) }); },
    success: 'Questionnaire saved',
    failure: "The questionnaire wasn't saved",
    toast: 'none',      // the save bar says "Saved" and the notice above the panes says what went wrong, with a Retry
    retryable: false,
    invalidate: [KEYS.template(id), KEYS.templates],
    onSuccess: () => { resetNext.current = true; setProblem(null); setJustSaved(true); window.setTimeout(() => setJustSaved(false), 4000); },
    onError: (e) => setProblem(e),
  });
  const doSave = async () => {
    const warning = saveWarning(removedQuestions(draft, saved).length, forWarning);
    if (warning && !(await confirm({ title: 'Save and delete answers?', message: warning, confirmLabel: 'Save and delete', tone: 'danger' }))) return;
    setProblem(null);
    setJustSaved(false);
    save.mutate();
  };

  const download = useReportedMutation({
    mutationFn: async () => {
      const r = await rcsaApi.downloadTemplate(id);
      saveBlob(new Blob([r.data as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), templateFileName(t?.name ?? ''));
    },
    failure: "The questionnaire couldn't be downloaded",
    fallback: 'Try again in a moment.',
    toast: 'errors',
  });

  const open = (question: DraftQuestion, section: string, isNew: boolean) => { nonce.current += 1; setEditing({ question, section, isNew, nonce: nonce.current }); };
  const sectionNameOf = (key: string) => draft.find((s) => s.questions.some((q) => q.key === key))?.name ?? '';
  const openSection = (section: DraftSection | null) => { nonce.current += 1; setSectionSheet({ section, open: true, nonce: nonce.current }); };

  const actions: OutlineActions = {
    onEdit: (q) => open(q, sectionNameOf(q.key), false),
    onMove: (q, dir) => setDraft((d) => moveQuestion(d, q.key, dir)),
    onDuplicate: (q) => setDraft((d) => duplicateQuestion(d, q.key)),
    onDelete: async (q) => {
      const at = draft.reduce<DraftQuestion[]>((all, s) => all.concat(s.questions), []).findIndex((x) => x.key === q.key) + 1;
      const ok = await confirm({
        title: `Delete question ${at}?`,
        message: <><span className="block break-words">{`"${truncate(q.text, 120).text || 'Untitled question'}"`}</span><span className="mt-[6px] block">{deleteCost(q, forWarning)}</span></>,
        confirmLabel: 'Delete question',
        tone: 'danger',
      });
      if (ok) setDraft((d) => removeQuestion(d, q.key));
    },
    onAddQuestion: (s) => open(blankQuestion('text'), s.name, true),
    onRenameSection: (s) => openSection(s),
    onMoveSection: (s, dir) => setDraft((d) => moveSection(d, s.key, dir)),
    onRemoveSection: (s) => setDraft((d) => removeSection(d, s.key)),
  };

  if (!(id > 0)) return <ErrorState title="This questionnaire doesn't exist" message="Check the address, or go back to the library." />;
  if (query.isLoading) {
    return (
      <div className="flex min-w-0 flex-col gap-[16px]">
        <Skeleton className="h-[28px] w-[40%]" />
        <SkeletonRows rows={6} columns={3} label="Loading the questionnaire" />
      </div>
    );
  }
  const status = (query.error as { response?: { status?: number } } | null)?.response?.status;
  if (query.isError || !t) {
    return (
      <div className="flex min-w-0 flex-col gap-[16px]">
        <PageHeader variant="page" title="Questionnaire" back={{ href: '/erm/rcsa/templates', label: 'Back to templates' }} />
        {isForbidden(query.error) ? (
          <NoAccessState title="You don't have access to this questionnaire" reason="Ask your administrator to give you access to RCSA." />
        ) : (
          <ErrorState
            title={status === 404 ? 'This questionnaire was not found' : "Couldn't load the questionnaire"}
            message={status === 404 ? 'It may have been deleted. Go back to the library to pick another.' : errorMessage(query.error)}
            onRetry={status === 404 ? undefined : () => { void query.refetch(); }}
          />
        )}
      </div>
    );
  }

  const total = questionCount(draft);
  const sections = draft.filter((s) => s.name !== '' || s.questions.length > 0).length;
  const reason = readOnlyReason(t);
  const lastSection = draft.length ? draft[draft.length - 1] : null;
  const details = { name: t.name, description: t.description ?? '', category: t.category, version: t.version };

  return (
    <div className="flex min-w-0 flex-col gap-[16px]">
      <PageHeader
        variant="page"
        title={t.name}
        back={{ href: '/erm/rcsa/templates', label: 'Back to templates' }}
        meta={`Version ${t.version} · ${t.category}`}
        info={t.description || undefined}
        chips={(
          <>
            <StatusPill tone="neutral" label={whoOf(t)} />
            {campaignsKnown && <StatusPill tone={campaigns > 0 ? 'progress' : 'neutral'} label={campaigns > 0 ? `In use by ${plural(campaigns, 'campaign')}` : inUseText(0)} />}
            {!editable && !rightsLoading && <StatusPill tone="neutral" label="Read only" />}
          </>
        )}
        actions={(
          <>
            {editable && <Button leftIcon={<Pencil aria-hidden />} onClick={() => { setDetailsNonce((n) => n + 1); setDetailsOpen(true); }}>Details</Button>}
            {manage && !readOnly && <Button leftIcon={<Copy aria-hidden />} onClick={() => setCloning(true)}>Clone</Button>}
            <Button leftIcon={<Download aria-hidden />} loading={download.isPending} onClick={() => download.mutate()}>Download</Button>
          </>
        )}
      />

      {readOnly && (
        <div role="note" className="flex flex-wrap items-center gap-[12px] rounded-ds-card border border-ds-border bg-ds-surface-subtle px-[16px] py-[10px]">
          <span className="min-w-0 flex-1 basis-[16rem] text-ds-body text-ds-fg">{reason}</span>
          {manage && <Button variant="primary" leftIcon={<Copy aria-hidden />} onClick={() => setCloning(true)}>Clone to edit</Button>}
        </div>
      )}
      {!readOnly && !editable && !rightsLoading && (
        <div role="note" className="rounded-ds-card border border-ds-border bg-ds-surface-subtle px-[16px] py-[10px] text-ds-body text-ds-fg">You can read this questionnaire and download it. The risk team changes it.</div>
      )}
      <FormError title="The questionnaire wasn't saved" error={problem} onRetry={() => { void doSave(); }} />

      <div className="lg:hidden">
        <SegmentedControl<Pane>
          label="Show"
          name="rcsa-workspace-pane"
          value={pane}
          onChange={setPane}
          options={[{ value: 'outline', label: 'Questions' }, { value: 'preview', label: 'Preview' }]}
        />
      </div>

      <div className="grid min-w-0 items-start gap-[16px] lg:grid-cols-2">
        <div className={pane === 'outline' ? 'min-w-0' : 'hidden min-w-0 lg:block'}>
          <SectionCard
            id="questions"
            title="Questions"
            meta={`${plural(total, 'question')} · ${plural(sections, 'section')}`}
            actions={editable ? (
              <>
                <Button size="sm" leftIcon={<FolderPlus aria-hidden />} onClick={() => openSection(null)}>Add section</Button>
                <Button size="sm" variant="primary" leftIcon={<Plus aria-hidden />} onClick={() => open(blankQuestion('text'), lastSection ? lastSection.name : '', true)}>Add question</Button>
              </>
            ) : undefined}
          >
            {draft.length === 0 ? (
              <div className="rounded-ds-card border border-dashed border-ds-border-strong px-[16px] py-[24px] text-center">
                <p className="text-ds-section text-ds-fg">No questions yet</p>
                <p className="mx-auto mt-[4px] max-w-[420px] text-ds-body text-ds-fg-muted">{editable ? 'Add the first question, or upload a spreadsheet of questions from the library.' : 'This questionnaire has no questions.'}</p>
                {editable && <div className="mt-[12px]"><Button variant="primary" leftIcon={<Plus aria-hidden />} onClick={() => open(blankQuestion('text'), '', true)}>Add the first question</Button></div>}
              </div>
            ) : (
              <Outline draft={draft} editable={editable} actions={actions} />
            )}
          </SectionCard>
        </div>
        <div className={pane === 'preview' ? 'min-w-0' : 'hidden min-w-0 lg:block'}>
          <SectionCard id="preview" title="Preview">
            <Preview draft={draft} />
          </SectionCard>
        </div>
      </div>

      <SaveBar
        label="Save the questionnaire"
        canEdit={editable}
        dirty={dirty}
        invalid={problems.length > 0}
        saving={save.isPending}
        justSaved={justSaved}
        onSave={() => { void doSave(); }}
        onDiscard={() => { setDraft(saved); setProblem(null); }}
      />

      <QuestionSheet
        edit={editing}
        sections={sectionNames(draft)}
        onClose={() => setEditing(null)}
        onSave={(question, section) => {
          if (!editing) return;
          setDraft((d) => (editing.isNew ? addQuestion(d, section, question) : updateQuestion(d, question.key, question, section)));
          setEditing(null);
        }}
      />
      <SectionSheet
        nonce={sectionSheet.nonce}
        open={sectionSheet.open}
        title={sectionSheet.section ? 'Rename the section' : 'Add a section'}
        initial={sectionSheet.section ? sectionSheet.section.name : ''}
        problemFor={(name) => sectionNameProblem(draft, name, sectionSheet.section?.key)}
        onClose={() => setSectionSheet((s) => ({ ...s, open: false }))}
        onSave={(name) => {
          setDraft((d) => (sectionSheet.section ? renameSection(d, sectionSheet.section.key, name) : addSection(d, name)));
          setSectionSheet((s) => ({ ...s, open: false }));
        }}
      />
      <DetailsSheet nonce={detailsNonce} open={detailsOpen} templateId={id} initial={details} onClose={() => setDetailsOpen(false)} />
      <CloneSheet open={cloning} template={cloning ? { id, name: t.name, description: t.description } : null} onClose={() => setCloning(false)} />
      {confirmDialog}
    </div>
  );
}
