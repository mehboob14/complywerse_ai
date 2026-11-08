'use client';

// A document of a framework journey (the ISMS scope statement, a policy, a procedure ... 84 shipped in seed_data/framework_templates, 2 of ISO 27001's own):
// the template's sections, written in place, with an AI draft, a review workflow (draft, in review, approved), a download as Markdown and a copy published
// to Governance. The rules (where a section stands, the text tools, the merge of an AI draft, the Markdown) are _registers/documentModel.ts.
//
// What this screen guarantees: unsaved text is said ("Unsaved changes"), asked about before another item of the Registers tab replaces it and before the tab
// is closed; a refresh from the server never overwrites unsaved text; "Send for review" is refused with a reason until a reviewer and an approver are chosen;
// and every save, draft, publish, reset and delete says what happened and, when it failed, why.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, Download, FileText, Landmark, Plus, Send, CheckCircle2, SlidersHorizontal, Sparkles, Trash2 } from 'lucide-react';
import { frameworkTemplatesApi, governanceApi } from '@/lib/api';
import {
  Button, EmptyState, ErrorState, Menu, Notice, Select, SkeletonRows, StatusPill, useConfirm, useNotify, useReportedMutation, type MenuItem,
} from '@/components/ui/ds';
import { apiErrorText, safeDetail } from '@/lib/apiError';
import { TONE } from '@/lib/status';
import { documentSectionState, frameworkDocumentStatus } from '@/lib/statuses/frameworkRegisters';
import DocumentDetails from '../_registers/DocumentDetails';
import SectionEditor from '../_registers/SectionEditor';
import { useUnsavedGuard } from '../_registers/unsavedGuard';
import {
  NEW_SECTION, addTableRow, canSendForReview, clampIndex, countsLine, downloadName, mergeDraft, nextStep, openAfterRemove, patchSection, plainHeading, publishBody, removeTableRow,
  saveBody, sectionHasContent, sectionState, setTableCell, toMarkdown, type DocSection, type FrameworkDoc,
} from '../_registers/documentModel';
import type { TenantUserOption } from './templateConfigs';

interface Props {
  docType: string;
  journeyId: number;
  frameworkId: number | null;
  frameworkName: string;
  tenantUsers: TenantUserOption[];
}

type Step = 'save' | 'in_review' | 'approved';

export default function FrameworkDocumentTab({ docType, journeyId, frameworkId, frameworkName, tenantUsers }: Props) {
  const notify = useNotify();
  const { confirm, confirmDialog } = useConfirm();
  const queryKey = ['ft-document', docType, journeyId] as const;

  const { data, isLoading, error, refetch } = useQuery({
    queryKey,
    queryFn: async () => (await frameworkTemplatesApi.documents.get(docType, { journey_id: journeyId, framework_id: frameworkId })).data as FrameworkDoc,
    enabled: !!journeyId,
  });

  const [doc, setDoc] = useState<FrameworkDoc | null>(null);
  const [dirty, setDirty] = useState(false);
  const [active, setActive] = useState(0);
  const [details, setDetails] = useState(false);
  const [askedForReviewers, setAskedForReviewers] = useState(false);
  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const dirtyNow = useRef(false);
  dirtyNow.current = dirty;
  useUnsavedGuard(dirty);

  // The server's copy replaces the open one when it first arrives, after a save, a reset or a delete; never while there is unsaved text.
  const shownId = useRef<number | null>(null);
  useEffect(() => {
    if (!data || dirtyNow.current) return;
    const same = shownId.current === data.id;                        // the same document again: stay on the section that is open
    shownId.current = data.id;
    setDoc(data);
    setActive((i) => (same ? clampIndex(i, data.sections.length) : 0));
  }, [data]);

  const edit = (change: (d: FrameworkDoc) => FrameworkDoc) => { setDoc((prev) => (prev ? change(prev) : prev)); setDirty(true); };
  const set = <K extends keyof FrameworkDoc>(key: K, value: FrameworkDoc[K]) => edit((d) => ({ ...d, [key]: value }));
  const sections = doc?.sections ?? [];
  const sections$ = (fn: (s: DocSection[]) => DocSection[]) => edit((d) => ({ ...d, sections: fn(d.sections) }));

  // ── writes ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  const save = useReportedMutation({
    mutationFn: async (v: { doc: FrameworkDoc; step: Step }) => (await frameworkTemplatesApi.documents.update(v.doc.id, saveBody(v.doc))).data as FrameworkDoc,
    success: (_d, v) => (v.step === 'in_review'
      ? { title: 'Sent for review', message: 'The reviewer and the approver can now act on it.' }
      : v.step === 'approved' ? 'Document approved' : 'Document saved'),
    failure: "Couldn't save the document",
    invalidate: [queryKey],
    onSuccess: (_d, v) => { dirtyNow.current = false; setDirty(false); setDoc(v.doc); },
  });
  const draft = useReportedMutation({
    mutationFn: async (v: { doc: FrameworkDoc; target?: string }) => (await frameworkTemplatesApi.ai.document({
      doc_type: docType, framework_name: frameworkName, title: v.doc.title || undefined, organization: v.doc.organization,
      sections: v.doc.sections as unknown as Array<Record<string, unknown>>,
    })).data as { sections: Array<{ heading: string; body: string }>; summary: string },
    success: (_d, v) => (v.target ? { title: 'Section drafted', message: 'Review it, then save.' } : { title: 'AI draft ready', message: 'Review the drafted sections, then save.' }),
    failure: "AI couldn't draft the document",
    onSuccess: (out, v) => {
      sections$((list) => mergeDraft(list, out.sections || [], v.target));
      setAiSummary(v.target ? `Drafted "${v.target}". Review it and save.` : (out.summary || 'AI draft applied. Review the sections and save.'));
    },
  });
  const remove = useReportedMutation({
    mutationFn: (id: number) => frameworkTemplatesApi.documents.remove(id),
    success: { title: 'Document deleted', message: 'A fresh copy is made from the template the next time it is opened.' },
    failure: "Couldn't delete the document",
    invalidate: [queryKey],
    onSuccess: () => { dirtyNow.current = false; setDirty(false); setDetails(false); },
  });
  const reset = useReportedMutation({
    mutationFn: () => frameworkTemplatesApi.documents.reset(docType, { journey_id: journeyId }),
    success: { title: 'Sections reset', message: "The document's sections are the template's again." },
    failure: "Couldn't reset the document",
    invalidate: [queryKey],
    onSuccess: () => { dirtyNow.current = false; setDirty(false); setDetails(false); setAiSummary(null); },
  });
  const publish = useReportedMutation({
    mutationFn: (d: FrameworkDoc) => governanceApi.createDocument(publishBody(d, frameworkName, frameworkId) as unknown as Record<string, unknown>),
    success: { title: 'Published to Governance', message: `Added to Governance documents as a draft, linked to ${frameworkName}.` },
    failure: "Couldn't publish the document",
    retryable: false,
  });

  const people = useMemo(() => tenantUsers.map((u) => ({ id: u.id, name: u.name })), [tenantUsers]);

  const advance = () => {
    if (!doc) return;
    const next = nextStep(doc.status);
    if (!next) return;
    if (next.to === 'in_review' && !canSendForReview(doc)) {
      notify.warning('Choose a reviewer and an approver first');
      setAskedForReviewers(true);
      setDetails(true);
      return;
    }
    save.mutate({ doc: { ...doc, status: next.to }, step: next.to });
  };
  const askPublish = async () => {
    if (!doc) return;
    const ok = await confirm({
      title: 'Publish to Governance?',
      message: `"${doc.title || 'This document'}" is added to Governance documents as a draft, linked to ${frameworkName}. The current text (${sections.length} ${sections.length === 1 ? 'section' : 'sections'}) is copied. This copy stays here and editable; publishing again makes another copy.`,
      confirmLabel: 'Publish a copy',
    });
    if (ok) publish.mutate(doc);
  };
  const askDelete = async () => {
    if (!doc) return;
    if (await confirm({ title: 'Delete this document?', message: `"${doc.title || 'This document'}" and everything written in it are removed. A fresh copy is made from the template the next time this item is opened.`, confirmLabel: 'Delete document', tone: 'danger' })) remove.mutate(doc.id);
  };
  const askReset = async () => {
    if (await confirm({ title: 'Reset the sections?', message: "Every section goes back to the template's text. The details (title, owner, reviewer, dates) stay as they are. This can't be undone.", confirmLabel: 'Reset sections', tone: 'danger' })) reset.mutate();
  };
  const askRemoveSection = async (idx: number) => {
    const s = sections[idx];
    if (!s) return;
    if (sectionHasContent(s) && !(await confirm({ title: 'Remove this section?', message: `"${s.heading || 'This section'}" and what is written in it are removed from the document (until you leave without saving).`, confirmLabel: 'Remove section', tone: 'danger' }))) return;
    sections$((list) => list.filter((_, i) => i !== idx));
    setActive((cur) => openAfterRemove(cur, idx));
  };
  const download = () => {
    if (!doc) return;
    const url = URL.createObjectURL(new Blob([toMarkdown(doc)], { type: 'text/markdown;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = downloadName(doc);
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  if (isLoading || (!doc && !error)) return <SkeletonRows rows={5} />;
  if (error || !doc) {
    return <ErrorState title="Couldn't load this document" message={safeDetail(apiErrorText(error, 'Please try again.'))} onRetry={() => { void refetch(); }} />;
  }

  const idx = clampIndex(active, sections.length);
  const section = sections[idx] as DocSection | undefined;
  const status = doc.status || 'draft';
  const step = nextStep(status);
  const aiBusyAll = draft.isPending && !draft.variables?.target;
  const aiBusySection = draft.isPending && !!draft.variables?.target;
  const reference = [frameworkName, section?.ref || doc.control_ref].filter(Boolean).join(' · ');

  const more: MenuItem[] = [
    { key: 'download', label: 'Download as Markdown', icon: Download, onSelect: download },
    { key: 'publish', label: 'Publish to Governance…', icon: Landmark, onSelect: () => { void askPublish(); }, disabled: publish.isPending },
    { key: 'delete', label: 'Delete document…', icon: Trash2, danger: true, onSelect: () => { void askDelete(); } },
  ];

  return (
    <div className="flex flex-col gap-[16px]">
      <section aria-label="Document" className="rounded-ds-card border border-ds-border bg-ds-surface p-[16px]">
        <div className="flex flex-wrap items-start justify-between gap-[12px]">
          <div className="min-w-0 flex-1 basis-[260px]">
            <div className="flex flex-wrap items-center gap-[8px]">
              <h2 className="min-w-0 break-words !text-ds-section !text-ds-fg">{doc.title || 'Untitled document'}</h2>
              <StatusPill tone={frameworkDocumentStatus.tone(status)} label={frameworkDocumentStatus.label(status)} />
            </div>
            <p className="mt-[4px] flex flex-wrap items-center gap-x-[6px] text-ds-body text-ds-fg-muted">
              <span>Version {doc.version || '1.0'}</span>
              <span aria-hidden>·</span>
              <span>{frameworkName}</span>
              {doc.control_ref && <><span aria-hidden>·</span><span>{doc.control_ref}</span></>}
              <span aria-hidden>·</span>
              <span role="status" className={dirty ? 'font-medium text-ds-warning' : 'inline-flex items-center gap-[4px]'}>
                {dirty ? 'Unsaved changes' : <><Check aria-hidden className="h-[14px] w-[14px]" />Saved</>}
              </span>
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-[8px]">
            {step && (
              <Button variant="primary" leftIcon={step.to === 'approved' ? <CheckCircle2 aria-hidden /> : <Send aria-hidden />} loading={save.isPending && save.variables?.step === step.to} disabled={save.isPending} onClick={advance}>{step.label}</Button>
            )}
            <Button leftIcon={<Sparkles aria-hidden />} loading={aiBusyAll} disabled={draft.isPending} onClick={() => draft.mutate({ doc })}>AI draft</Button>
            <Button leftIcon={<SlidersHorizontal aria-hidden />} onClick={() => setDetails(true)}>Details</Button>
            <Menu iconOnly label="More actions for this document" items={more} />
          </div>
        </div>

        <div className="mt-[12px] flex flex-wrap items-center gap-x-[12px] gap-y-[6px]">
          <div aria-hidden className="flex min-w-[120px] flex-1 gap-[4px]">
            {sections.map((s, i) => (
              <span key={i} className="h-[6px] flex-1 rounded-full" style={{ background: sectionState(s) === 'to_start' ? 'var(--ds-border-strong)' : TONE[documentSectionState.tone(sectionState(s))].dot }} />
            ))}
          </div>
          <p className="whitespace-nowrap text-ds-label text-ds-fg-muted">{countsLine(sections)}</p>
        </div>

        {aiSummary && <Notice className="mt-[12px]" tone="info" title="AI draft" action={<Button size="sm" onClick={() => setAiSummary(null)}>Dismiss</Button>}>{aiSummary}</Notice>}
      </section>

      <div className="grid grid-cols-1 gap-[16px] lg:grid-cols-[240px_minmax(0,1fr)]">
        <div className="lg:hidden">
          <Select aria-label="Section" value={String(idx)} onChange={(e) => setActive(Number(e.target.value))} disabled={sections.length === 0}>
            {sections.map((s, i) => <option key={i} value={i}>{`${i + 1}. ${plainHeading(s.heading) || 'Untitled'} · ${documentSectionState.label(sectionState(s))}`}</option>)}
          </Select>
        </div>
        <nav aria-label="Sections" className="hidden h-fit overflow-hidden rounded-ds-card border border-ds-border bg-ds-surface lg:block">
          <p className="border-b border-ds-border px-[12px] py-[8px] text-ds-label font-[600] text-ds-fg-muted">{sections.length} {sections.length === 1 ? 'section' : 'sections'}</p>
          <ol className="max-h-[520px] overflow-auto py-[4px]">
            {sections.map((s, i) => {
              const st = sectionState(s);
              return (
                <li key={i}>
                  <button
                    type="button"
                    onClick={() => setActive(i)}
                    aria-current={i === idx ? 'true' : undefined}
                    className={`flex min-h-ds-control w-full items-start gap-[8px] px-[12px] py-[6px] text-left focus-visible:outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--ds-focus)] ${i === idx ? 'bg-ds-primary-soft' : 'hover:bg-ds-surface-hover'}`}
                  >
                    <span className="w-[16px] shrink-0 text-ds-label text-ds-fg-muted">{i + 1}</span>
                    <span className="min-w-0">
                      <span className={`block text-ds-body [overflow-wrap:anywhere] ${i === idx ? 'font-[600] text-ds-primary-text' : 'text-ds-fg-body'}`}>{plainHeading(s.heading) || 'Untitled'}</span>
                      <span className="mt-[2px] inline-flex items-center gap-[6px] text-ds-label text-ds-fg-muted">
                        <span aria-hidden className="h-[6px] w-[6px] rounded-full" style={{ background: TONE[documentSectionState.tone(st)].dot }} />
                        {documentSectionState.label(st)}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
          <div className="border-t border-ds-border p-[4px]">
            <Button variant="ghost" fullWidth leftIcon={<Plus aria-hidden />} onClick={() => { sections$((l) => [...l, { ...NEW_SECTION }]); setActive(sections.length); }}>Add a section</Button>
          </div>
        </nav>

        {section ? (
          <SectionEditor
            key={idx}
            index={idx}
            section={section}
            reference={reference}
            onPatch={(patch) => sections$((l) => patchSection(l, idx, patch))}
            onCell={(r, c, v) => sections$((l) => setTableCell(l, idx, r, c, v))}
            onAddRow={() => sections$((l) => addTableRow(l, idx))}
            onRemoveRow={(r) => sections$((l) => removeTableRow(l, idx, r))}
            onRemoveSection={() => { void askRemoveSection(idx); }}
            onAi={() => draft.mutate({ doc, target: section.heading })}
            aiBusy={aiBusySection}
            aiDisabled={draft.isPending}
            onSave={() => save.mutate({ doc, step: 'save' })}
            saving={save.isPending && save.variables?.step === 'save'}
            dirty={dirty}
          />
        ) : (
          <EmptyState kind="firstUse" icon={FileText} title="No sections yet" description="Add the first section of this document." action={<Button variant="primary" leftIcon={<Plus aria-hidden />} onClick={() => { sections$((l) => [...l, { ...NEW_SECTION }]); setActive(0); }}>Add a section</Button>} />
        )}
      </div>

      {details && (
        <DocumentDetails
          doc={doc}
          people={people}
          set={set}
          askedForReviewers={askedForReviewers}
          dirty={dirty}
          saving={save.isPending && save.variables?.step === 'save'}
          onSave={() => save.mutate({ doc, step: 'save' })}
          onReset={() => { void askReset(); }}
          onClose={() => { setDetails(false); setAskedForReviewers(false); }}
        />
      )}
      {confirmDialog}
    </div>
  );
}
