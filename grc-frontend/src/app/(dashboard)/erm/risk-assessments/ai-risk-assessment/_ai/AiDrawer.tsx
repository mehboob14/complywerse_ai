'use client';

/**
 * One AI system's risk, in a right-hand panel on the kit (the old one was hand-built: no focus trap, no Escape, no guard for typed text): the fields of the template, the AI suggestion with its
 * source, and the evidence. The score is likelihood x impact on the area's one band system. "Accept the suggestion" fills the blanks on the server AND in the open form, so a Save after it no
 * longer sends the old blanks back over what was accepted. Evidence is downloaded through the signed-in request (a plain link would be refused), and removing a file asks first.
 */
import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, Download, FileText, Paperclip, Upload, X } from 'lucide-react';
import { Button, FormField, IconButton, Select, SidePanel, StatusPill, TextInput, Textarea, useConfirm, useNotify, useReportedMutation } from '@/components/ui/ds';
import { statusOf } from '@/components/ui/ds/reportOutcome';
import { aiRiskAssessmentApi, type AIRiskEvidence } from '@/lib/api';
import { authedFetch } from '@/lib/auth-fetch';
import { formatDate } from '@/lib/format';
import { statusPill } from '@/lib/status';
import { riskLevel } from '@/lib/statuses/risk';
import { EvidenceMaturity } from '@/app/(dashboard)/evidence/_review';
import { AiDraft } from '../../_register/AiDraft';
import { aiFailureWords } from '../../_register/assessmentModel';
import { CATEGORIES, EMPTY_FORM, RESIDUALS, STATUSES, bodyOf, formOf, levelOf, mergeAccepted, sameForm, scoreOf, suggestionOf, type AiEntry, type AiForm } from './aiModel';

export interface AiDrawerProps {
  /** null with `creating`: a new entry; an entry: edit it; null and not creating: closed */
  entry: AiEntry | null;
  creating: boolean;
  people: ReadonlyArray<{ id: number; display_name: string; email: string | null }>;
  canWrite: boolean;
  onClose: () => void;
  onSaved: (entry: AiEntry | null) => void;
  refresh: () => void;
}

const SCALE = [1, 2, 3, 4, 5];

function Section({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="mt-[20px] border-t border-ds-border pt-[16px]">
      <div className="flex flex-wrap items-center gap-[8px]"><h3 className="m-0 !text-ds-body !font-[600] !text-ds-fg">{title}</h3>{action && <span className="ml-auto">{action}</span>}</div>
      <div className="mt-[8px]">{children}</div>
    </section>
  );
}

async function downloadEvidence(entryId: number, link: AIRiskEvidence, onFail: () => void) {
  try {
    const res = await authedFetch(aiRiskAssessmentApi.evidenceDownloadUrl(entryId, link.link_id as number));
    if (!res.ok) throw new Error('refused');
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement('a');
    a.href = url;
    a.download = link.file_name || link.name || 'evidence';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch { onFail(); }
}

function Body({ entry, creating, people, canWrite, onClose, onSaved, refresh, onDirty }: AiDrawerProps & { onDirty: (dirty: boolean) => void }) {
  const notify = useNotify();
  const { confirm, confirmDialog } = useConfirm();
  const base: AiForm = entry ? formOf(entry) : EMPTY_FORM;
  const [form, setForm] = useState<AiForm>(base);
  const dirty = !sameForm(form, base);
  useEffect(() => { onDirty(dirty); return () => onDirty(false); }, [dirty, onDirty]);
  const [ai, setAi] = useState<{ state: 'idle' | 'loading' | 'error'; error?: string }>({ state: 'idle' });
  const file = useRef<HTMLInputElement>(null);
  const set = <K extends keyof AiForm>(k: K, v: AiForm[K]) => setForm((s) => ({ ...s, [k]: v }));
  const sug = entry ? suggestionOf(entry) : 'none';
  const score = scoreOf({ risk_score: null, likelihood: form.likelihood ?? null, impact: form.impact ?? null });

  const evidence = useQuery({ queryKey: ['ai-risk-assessment-evidence', entry?.id], queryFn: async () => (await aiRiskAssessmentApi.listEvidence(entry?.id as number)).data, enabled: !!entry && !creating });

  const save = useReportedMutation({
    mutationFn: async () => (entry ? (await aiRiskAssessmentApi.update(entry.id, bodyOf(form) as never)).data : (await aiRiskAssessmentApi.create(bodyOf(form) as never)).data),
    success: { title: entry ? 'Changes saved' : 'AI system risk added', message: entry ? '' : 'It is in the register.' },
    failure: "Couldn't save the AI system risk",
    invalidate: [['ai-risk-assessment-entries'], ['erm-sections-overview']],
    onSuccess: (saved) => onSaved(saved as AiEntry),
  });
  const accept = useReportedMutation({
    mutationFn: async () => (await aiRiskAssessmentApi.acceptAi((entry as AiEntry).id)).data,
    success: { title: 'Suggestion accepted', message: 'The blank fields were filled. Check them, then save.' },
    failure: "Couldn't accept the suggestion",
    invalidate: [['ai-risk-assessment-entries']],
    onSuccess: (updated) => setForm((f) => mergeAccepted(f, updated as AiEntry)),
  });
  const suggest = async () => {
    if (!entry) return;
    setAi({ state: 'loading' });
    try { await aiRiskAssessmentApi.aiSuggest(entry.id); setAi({ state: 'idle' }); refresh(); } catch (e) { setAi({ state: 'error', error: aiFailureWords(statusOf(e) ?? undefined) }); }
  };
  const upload = useReportedMutation({
    mutationFn: (f: File) => aiRiskAssessmentApi.uploadEvidence((entry as AiEntry).id, f),
    success: { title: 'File attached', message: '' },
    failure: "Couldn't upload the file",
    invalidate: [['ai-risk-assessment-evidence', entry?.id]],
  });
  const unlink = useReportedMutation({
    mutationFn: (linkId: number) => aiRiskAssessmentApi.unlinkEvidence((entry as AiEntry).id, linkId),
    success: { title: 'File removed from this entry', message: 'It stays in Evidence.' },
    failure: "Couldn't remove the file",
    invalidate: [['ai-risk-assessment-evidence', entry?.id]],
  });

  const ready = sug !== 'none' && entry;
  const draftRows = ready ? [
    { key: 'mit', label: 'Mitigation plan', value: entry.ai_suggested_mitigation, onUse: canWrite ? () => set('mitigation_plan', entry.ai_suggested_mitigation ?? '') : undefined },
    { key: 'ctl', label: 'Existing controls', value: entry.ai_suggested_controls, onUse: canWrite ? () => set('existing_controls', entry.ai_suggested_controls ?? '') : undefined },
    { key: 'lik', label: 'Likelihood', value: entry.ai_suggested_likelihood != null ? String(entry.ai_suggested_likelihood) : '', onUse: canWrite && entry.ai_suggested_likelihood != null ? () => set('likelihood', entry.ai_suggested_likelihood as number) : undefined },
    { key: 'imp', label: 'Impact', value: entry.ai_suggested_impact != null ? String(entry.ai_suggested_impact) : '', onUse: canWrite && entry.ai_suggested_impact != null ? () => set('impact', entry.ai_suggested_impact as number) : undefined },
    { key: 'res', label: 'Residual level', value: entry.ai_suggested_residual_level, onUse: canWrite && entry.ai_suggested_residual_level ? () => set('residual_risk_level', entry.ai_suggested_residual_level as string) : undefined },
  ] : [];
  const ro = !canWrite;

  return (
    <div>
      <div className="flex flex-col gap-[12px]">
        <div className="grid gap-[12px] sm:grid-cols-2">
          <FormField label="AI system or use case"><TextInput value={form.ai_system_use_case} onChange={(e) => set('ai_system_use_case', e.target.value)} disabled={ro} placeholder="A chatbot, a fraud model" /></FormField>
          <FormField label="Reference" optional><TextInput value={form.risk_id_external} onChange={(e) => set('risk_id_external', e.target.value)} disabled={ro} placeholder="AI-001" /></FormField>
        </div>
        <FormField label="Risk description" required><Textarea rows={3} value={form.risk_description} onChange={(e) => set('risk_description', e.target.value)} disabled={ro} /></FormField>
        <div className="grid gap-[12px] sm:grid-cols-2">
          <FormField label="Category"><Select placeholder="Choose a category" value={form.risk_category} onChange={(e) => set('risk_category', e.target.value)} disabled={ro}>{CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}</Select></FormField>
          <FormField label="Status"><Select value={form.status} onChange={(e) => set('status', e.target.value)} disabled={ro}>{STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}</Select></FormField>
        </div>
        <div className="grid grid-cols-2 gap-[12px] sm:grid-cols-3">
          <FormField label="Likelihood"><Select placeholder="—" value={form.likelihood ?? ''} onChange={(e) => set('likelihood', e.target.value ? Number(e.target.value) : undefined)} disabled={ro}>{SCALE.map((v) => <option key={v} value={v}>{v}</option>)}</Select></FormField>
          <FormField label="Impact"><Select placeholder="—" value={form.impact ?? ''} onChange={(e) => set('impact', e.target.value ? Number(e.target.value) : undefined)} disabled={ro}>{SCALE.map((v) => <option key={v} value={v}>{v}</option>)}</Select></FormField>
          <div className="col-span-2 flex flex-col gap-[4px] sm:col-span-1">
            <span className="text-ds-label text-ds-fg">Score</span>
            <span className="flex h-ds-control items-center gap-[8px] text-ds-body text-ds-fg">{score ?? '—'}{score != null && <StatusPill size="sm" {...statusPill(riskLevel, levelOf({ risk_score: score, likelihood: null, impact: null }))} />}</span>
          </div>
        </div>
        <FormField label="Residual level" optional hint="The word you recorded. Left empty, it is worked out from the score."><Select placeholder="Work it out" value={form.residual_risk_level} onChange={(e) => set('residual_risk_level', e.target.value)} disabled={ro}>{RESIDUALS.map((r) => <option key={r} value={r}>{r}</option>)}</Select></FormField>
        <FormField label="Existing controls" optional><Textarea rows={2} value={form.existing_controls} onChange={(e) => set('existing_controls', e.target.value)} disabled={ro} /></FormField>
        <FormField label="Mitigation plan" optional><Textarea rows={3} value={form.mitigation_plan} onChange={(e) => set('mitigation_plan', e.target.value)} disabled={ro} /></FormField>
        <div className="grid gap-[12px] sm:grid-cols-2">
          <FormField label="Owner" optional hint="A person, a team, or both.">
            <div className="flex flex-col gap-[6px]">
              <Select placeholder="Assign a person" value={form.risk_owner_user_id ?? ''} disabled={ro} onChange={(e) => {
                const idv = e.target.value ? Number(e.target.value) : undefined;
                const u = people.find((p) => p.id === idv);
                setForm((s) => ({ ...s, risk_owner_user_id: idv, risk_owner: s.risk_owner.trim() ? s.risk_owner : u?.display_name ?? s.risk_owner }));
              }}>{people.map((p) => <option key={p.id} value={p.id}>{p.display_name}</option>)}</Select>
              <TextInput value={form.risk_owner} onChange={(e) => set('risk_owner', e.target.value)} disabled={ro} placeholder="or a team or department" />
            </div>
          </FormField>
          <FormField label="Next review" optional><TextInput type="date" value={form.target_review_date} onChange={(e) => set('target_review_date', e.target.value)} disabled={ro} /></FormField>
        </div>
      </div>

      {entry && (
        <Section title="Suggestion">
          <AiDraft
            state={ai.state === 'idle' ? (ready ? 'ready' : 'idle') : ai.state}
            source={sug === 'none' ? 'unknown' : sug}
            rows={draftRows}
            error={ai.error}
            onRun={() => { void suggest(); }}
            onUseAll={canWrite ? () => { void accept.mutate(); } : undefined}
            disabled={!canWrite}
            idleText="Drafts a mitigation plan, controls, likelihood and impact from the system and the risk description."
            runLabel="Suggest with AI"
            note={entry.ai_rationale ? <>{entry.ai_rationale}{entry.ai_generated_at ? ` (${formatDate(entry.ai_generated_at)})` : ''}</> : undefined}
            extra={ready && canWrite && !entry.ai_suggestion_accepted ? (
              <div className="mt-[8px] flex flex-wrap items-center gap-[8px] border-t border-ds-border pt-[8px]">
                <span className="text-ds-label text-ds-fg-muted">Accepting fills the blank fields only; what you wrote stays.</span>
                <Button size="sm" className="ml-auto" leftIcon={<CheckCircle2 aria-hidden />} loading={accept.isPending} onClick={() => accept.mutate()}>Accept the suggestion</Button>
              </div>
            ) : entry.ai_suggestion_accepted ? <p className="mb-0 mt-[8px] text-ds-label text-ds-fg-muted">Accepted.</p> : undefined}
          />
        </Section>
      )}

      {entry && (
        <Section title={`Evidence${evidence.data?.length ? ` (${evidence.data.length})` : ''}`} action={canWrite ? (
          <>
            <input ref={file} type="file" className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) upload.mutate(f); e.currentTarget.value = ''; }} />
            <Button size="sm" leftIcon={<Upload aria-hidden />} loading={upload.isPending} onClick={() => file.current?.click()}>Upload a file</Button>
          </>
        ) : undefined}>
          {evidence.isPending ? <p className="m-0 text-ds-body text-ds-fg-muted">Loading…</p>
            : evidence.isError ? <p role="alert" className="m-0 text-ds-body text-ds-danger">The evidence could not be loaded. <Button variant="link" onClick={() => { void evidence.refetch(); }}>Try again</Button></p>
              : (evidence.data ?? []).length === 0 ? <p className="m-0 text-ds-body text-ds-fg-muted">No evidence is attached. Audit reports, model cards, fairness scorecards and impact assessments belong here.</p> : (
                <ul className="m-0 list-none p-0">
                  {(evidence.data ?? []).map((it) => (
                    <li key={it.link_id ?? it.evidence_id} className="flex min-h-[44px] items-center gap-[8px] border-b border-ds-border py-[4px] last:border-b-0">
                      <FileText aria-hidden className="h-[14px] w-[14px] shrink-0 text-ds-fg-muted" />
                      <div className="min-w-0 flex-1">
                        <p className="m-0 break-all text-ds-body font-[500] text-ds-fg">{it.file_name || it.name || 'A file'}</p>
                        <p className="m-0 flex flex-wrap items-center gap-x-[8px] text-ds-label text-ds-fg-muted">{it.uploaded_at && <span>{formatDate(it.uploaded_at)}</span>}<EvidenceMaturity evidenceId={it.evidence_id} /></p>
                      </div>
                      {it.link_id && <IconButton label={`Download ${it.file_name || it.name || 'the file'}`} onClick={() => { void downloadEvidence((entry as AiEntry).id, it, () => notify.error('The file could not be downloaded.', { title: 'Download failed' })); }}><Download aria-hidden /></IconButton>}
                      {it.link_id && canWrite && <IconButton label={`Remove ${it.file_name || it.name || 'the file'}`} onClick={async () => { if (await confirm({ title: 'Remove this file from the entry?', message: 'The file stays in Evidence; it is only taken off this AI system risk.', confirmLabel: 'Remove file', tone: 'danger' })) unlink.mutate(it.link_id as number); }}><X aria-hidden /></IconButton>}
                    </li>
                  ))}
                </ul>
              )}
        </Section>
      )}

      <div className="sticky bottom-0 -mx-[16px] mt-[20px] flex flex-wrap items-center gap-[8px] border-t border-ds-border bg-ds-surface px-[16px] py-[12px]">
        {canWrite && <Button variant="primary" loading={save.isPending} disabled={!form.risk_description.trim() || (!!entry && !dirty)} onClick={() => save.mutate()}>{entry ? 'Save changes' : 'Add to the register'}</Button>}
        <Button onClick={onClose}>{dirty ? 'Cancel' : 'Close'}</Button>
        {entry && <span className="ml-auto flex items-center gap-[4px] text-ds-label text-ds-fg-muted"><Paperclip aria-hidden className="h-[12px] w-[12px]" />{entry.bridged_risk_id ? 'In the Risk Register' : 'Not in the Risk Register'}</span>}
      </div>
      {confirmDialog}
    </div>
  );
}

export function AiDrawer(props: AiDrawerProps) {
  const { entry, creating } = props;
  const open = creating || !!entry;
  const [dirty, setDirty] = useState(false);
  return (
    <SidePanel
      open={open}
      onClose={props.onClose}
      title={<span dir="auto" className="line-clamp-2 break-words">{creating ? 'New AI system risk' : entry?.ai_system_use_case || entry?.risk_description || 'AI system risk'}</span>}
      subtitle={creating ? 'A risk of one of the organisation’s own AI systems' : entry?.risk_category || undefined}
      dockFrom={Infinity}
      width="lg"
      dirty={dirty}
    >
      {open && <Body key={creating ? 'new' : entry?.id} {...props} onDirty={setDirty} />}
    </SidePanel>
  );
}
