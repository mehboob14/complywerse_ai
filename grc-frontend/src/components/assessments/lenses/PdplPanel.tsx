'use client';

/**
 * One PDPL control in a drawer: what the toolkit asks you to check (and AI guidance on request), the maturity score from 0 to 5 which makes the answer, the gap and the
 * remediation when the score is below 3 (the AI drafts the remediation from the gap you wrote and writes nothing else), and the evidence: files, files from the Evidence library,
 * and a template for each document the toolkit asks for. One Save at the foot sends only what changed; the drawer asks before it throws typed input away.
 */
import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronUp, Download, Link2, Sparkles } from 'lucide-react';
import {
  Button, DebouncedSearch, EmptyState, FactList, Fact, FormField, IconButton, Notice, ReadOnlyNote, Select, SidePanel, StatusPill, TabPanel, Tabs, Textarea, TextInput, useReportedMutation,
} from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import apiClient from '@/lib/api';
import { statusPill } from '@/lib/status';
import { controlStatus } from '@/lib/statuses/assessments';
import { buildArtifactTemplate } from '@/components/compliance/artifactTemplates';
import { downloadAsFormat } from '@/components/compliance/downloadUtils';
import { EvidenceSection } from '../workspace/EvidenceSection';
import { PRIORITIES, PRIORITY_LABEL, type ItemPatch } from '../workspace/itemModel';
import { KEYS, workspaceApi } from '../workspace/workspaceApi';
import { AssigneesField } from '../workspace/AssigneesField';
import { mergeItem } from './lensApi';
import { answerFromMaturity, artifactTypeOf, evidenceAsked, isGapScore, pdplFacts, PDPL_LEVELS, PDPL_LEVEL_DESC, type LensItem } from './lensData';

interface Draft { maturity: string; gap: string; fix: string; owner: string; priority: string; target: string; risk: string }
const draftOf = (it: LensItem): Draft => ({ maturity: it.maturity === null ? '' : String(it.maturity), gap: it.gap, fix: it.fix, owner: it.responsible, priority: it.priority, target: it.timeline, risk: it.riskRating });

function patchOf(was: Draft, now: Draft): ItemPatch {
  const p: ItemPatch = {};
  if (now.maturity !== was.maturity) p.maturity_score = now.maturity === '' ? null : Number(now.maturity);
  if (now.gap.trim() !== was.gap.trim()) p.gaps_identified = now.gap.trim();
  if (now.fix.trim() !== was.fix.trim()) p.proposed_solution = now.fix.trim();
  if (now.owner.trim() !== was.owner.trim()) p.responsible_party = now.owner.trim();
  if (now.priority !== was.priority) p.priority = now.priority;
  if (now.target.trim() !== was.target.trim()) p.timeline = now.target.trim();
  if (now.risk !== was.risk) p.risk_rating = now.risk;
  return p;
}

interface AiDraft { how_to_assess?: string; what_good_looks_like?: string; evidence_examples?: string[]; remediation?: string }

/** Evidence the person already holds: search the Evidence library and link a file to this control. */
function LibraryLink({ assessmentId, item, readOnly, onChanged }: { assessmentId: number; item: LensItem; readOnly: boolean; onChanged: () => void }) {
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const library = useQuery({
    queryKey: ['assessment-lens-evidence-library', q], staleTime: 30_000,
    queryFn: async () => (((await apiClient.get('/evidence-mgmt/items', { params: { search: q || undefined, limit: 20 } })).data?.items ?? []) as Array<{ id: number; name?: string | null; file_name?: string | null }>),
  });
  const attached = useQuery({ queryKey: KEYS.evidence(assessmentId, item.id), queryFn: () => workspaceApi.evidence(assessmentId, item.id) });
  const have = new Set((attached.data ?? []).map((e) => e.evidence_id));
  const link = useReportedMutation({
    mutationFn: async (evidenceId: number) => (await apiClient.post(`/compliance/assessments/${assessmentId}/items/${item.id}/evidence/link`, { evidence_id: evidenceId })).data,
    success: 'File linked',
    failure: "Couldn't link the file",
    onSuccess: () => { void qc.invalidateQueries({ queryKey: KEYS.evidence(assessmentId, item.id) }); onChanged(); },
  });
  return (
    <div className="flex flex-col gap-[8px] rounded-ds-card border border-ds-border p-[12px]">
      <p className="text-ds-body font-[600] text-ds-fg">From the Evidence library</p>
      <DebouncedSearch label="Search the Evidence library" placeholder="Search the library" value={q} onSearch={setQ} loading={library.isFetching} />
      {library.isError ? <Notice tone="danger" title="Couldn't search the library" action={canRetry(library.error) ? <Button size="sm" onClick={() => { void library.refetch(); }}>Try again</Button> : undefined}>{errorMessage(library.error)}</Notice>
        : (library.data ?? []).length === 0 ? <p className="text-ds-body text-ds-fg-muted">{q ? 'No file matches.' : 'The library has no file yet.'}</p>
        : (
          <ul className="flex max-h-[240px] flex-col divide-y divide-ds-border overflow-y-auto">
            {(library.data ?? []).map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-[8px] py-[6px]">
                <span className="min-w-0 truncate text-ds-body text-ds-fg" title={e.name || e.file_name || 'Evidence'}>{e.name || e.file_name || 'Evidence'}</span>
                {have.has(e.id) ? <StatusPill tone="success" label="Linked" size="sm" /> : <Button size="sm" leftIcon={<Link2 aria-hidden />} disabled={readOnly || link.isPending} onClick={() => link.mutate(e.id)}>Link</Button>}
              </li>
            ))}
          </ul>
        )}
    </div>
  );
}

export function PdplPanel({ assessmentId, assessmentName, item, prev, next, onOpen, onClose, readOnly, onChanged }: {
  assessmentId: number; assessmentName: string; item: LensItem; prev: LensItem | null; next: LensItem | null; onOpen: (id: number) => void; onClose: () => void; readOnly: boolean; onChanged: () => void;
}) {
  const qc = useQueryClient();
  const [section, setSection] = useState<'guidance' | 'assess' | 'evidence'>('guidance');
  const [base, setBase] = useState<Draft>(() => draftOf(item));
  const [draft, setDraft] = useState<Draft>(base);
  const patch = patchOf(base, draft);
  const dirty = Object.keys(patch).length > 0;
  const shown = useRef(item.id);
  useEffect(() => {
    if (dirty && shown.current === item.id) return;
    shown.current = item.id;
    const fresh = draftOf(item);
    setBase(fresh);
    setDraft(fresh);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item]);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));

  const score = draft.maturity === '' ? null : Number(draft.maturity);
  const facts = pdplFacts(item.remarks);
  const asked = evidenceAsked(item.evidenceReference);
  const dis = readOnly;

  const save = useReportedMutation({
    mutationFn: () => workspaceApi.updateItem(item.id, patch),
    success: 'Assessment saved',
    failure: "Couldn't save the assessment",
    onSuccess: (res) => { mergeItem(qc, assessmentId, item.id, (res ?? {}) as Record<string, unknown>); setBase(draft); onChanged(); },
  });
  const guide = useReportedMutation({
    mutationFn: async (gap?: string) => (((await apiClient.post(`/compliance/assessments/${assessmentId}/items/${item.id}/ai-assess`, null, { params: gap?.trim() ? { gap } : undefined })).data as { draft?: AiDraft })?.draft ?? {}),
    failure: "Couldn't get AI guidance",
    toast: 'none',
  });
  const draftFix = useReportedMutation({
    mutationFn: async () => (((await apiClient.post(`/compliance/assessments/${assessmentId}/items/${item.id}/ai-assess`, null, { params: { gap: draft.gap.trim() } })).data as { draft?: AiDraft })?.draft ?? {}),
    failure: "Couldn't draft the remediation",
    toast: 'none',
    onSuccess: (d) => { if (d.remediation) set('fix', d.remediation); },
  });
  const g = guide.data;

  return (
    <SidePanel
      open onClose={onClose} width="lg" dockFrom={Infinity} dirty={dirty} title={item.number || 'Control'}
      subtitle={<span className="flex flex-wrap items-center gap-[8px]"><StatusPill {...statusPill(controlStatus, answerFromMaturity(score))} size="sm" /><span className="text-ds-label text-ds-fg-muted">{item.domain}</span></span>}
      actions={(
        <>
          <IconButton label={dirty ? 'Previous control (save or discard first)' : 'Previous control'} disabled={!prev || dirty} onClick={() => prev && onOpen(prev.id)}><ChevronUp aria-hidden /></IconButton>
          <IconButton label={dirty ? 'Next control (save or discard first)' : 'Next control'} disabled={!next || dirty} onClick={() => next && onOpen(next.id)}><ChevronDown aria-hidden /></IconButton>
        </>
      )}
      footer={section === 'evidence' || readOnly ? undefined : (
        <div className="flex flex-wrap items-center justify-end gap-[8px]">
          {dirty && <Button disabled={save.isPending} onClick={() => setDraft(base)}>Discard changes</Button>}
          <Button variant="primary" loading={save.isPending} disabled={!dirty} onClick={() => save.mutate()}>Save assessment</Button>
        </div>
      )}
    >
      <Tabs tabs={[{ key: 'guidance', label: 'Guidance' }, { key: 'assess', label: 'Assess' }, { key: 'evidence', label: 'Evidence', count: item.evidenceCount }]} value={section} onChange={setSection} ariaLabel="Control sections" className="flex flex-col gap-[16px]">
        <TabPanel tabKey="guidance">
          <div className="flex flex-col gap-[16px] pt-[16px]">
            <p className="break-words text-ds-body text-ds-fg">{item.description}</p>
            <FactList variant="boxed" min={220}>
              <Fact label="PDPL reference">{facts.ref}</Fact>
              <Fact label="What to verify">{facts.question}</Fact>
              <Fact label="Evidence to look for">{item.evidenceReference}</Fact>
            </FactList>
            <div className="flex flex-col gap-[8px] rounded-ds-card border border-ds-border p-[12px]">
              <div className="flex flex-wrap items-center justify-between gap-[8px]">
                <p className="text-ds-body font-[600] text-ds-fg">AI guidance</p>
                <Button size="sm" leftIcon={<Sparkles aria-hidden />} loading={guide.isPending} onClick={() => guide.mutate(undefined)}>{g ? 'Ask again' : 'Suggest guidance'}</Button>
              </div>
              {guide.isError && <Notice tone="warning" title="Couldn't get guidance" action={<Button size="sm" onClick={() => guide.mutate(undefined)}>Try again</Button>}>{errorMessage(guide.error)}</Notice>}
              {!g && !guide.isPending && !guide.isError && <p className="text-ds-body text-ds-fg-muted">What to check for this control, what good looks like and the evidence to collect, written for someone who sees it for the first time.</p>}
              {g && (
                <div className="flex flex-col gap-[8px] text-ds-body text-ds-fg-body">
                  {g.how_to_assess && <div><p className="text-ds-body font-[600] text-ds-fg">What to check</p><p className="whitespace-pre-line break-words text-ds-body text-ds-fg-body">{g.how_to_assess}</p></div>}
                  {g.what_good_looks_like && <div><p className="text-ds-body font-[600] text-ds-fg">What good looks like</p><p className="whitespace-pre-line break-words text-ds-body text-ds-fg-body">{g.what_good_looks_like}</p></div>}
                  {(g.evidence_examples ?? []).length > 0 && <div><p className="text-ds-body font-[600] text-ds-fg">Evidence to collect</p><ul className="list-disc pl-[20px]">{(g.evidence_examples ?? []).map((e, i) => <li key={i} className="break-words">{e}</li>)}</ul></div>}
                </div>
              )}
            </div>
          </div>
        </TabPanel>
        <TabPanel tabKey="assess" lazy>
          <div className="flex flex-col gap-[16px] pt-[16px]">
            {readOnly && <ReadOnlyNote>You can look at this control but not change it.</ReadOnlyNote>}
            <div className="grid grid-cols-1 gap-[12px] sm:grid-cols-2">
              <FormField label="Maturity" info="The score is the assessment: it makes the answer. 3 to 5 is compliant, 1 and 2 partial, 0 not compliant.">
                <Select value={draft.maturity} disabled={dis || save.isPending} onChange={(e) => set('maturity', e.target.value)}>
                  <option value="">Not assessed</option>
                  {PDPL_LEVELS.map((label, n) => <option key={label} value={n}>{n} · {label}</option>)}
                </Select>
              </FormField>
              <div><p className="mb-[4px] text-ds-label text-ds-fg-muted">Answer that follows</p><StatusPill {...statusPill(controlStatus, answerFromMaturity(score))} /></div>
            </div>
            <ul className="flex flex-col gap-[4px] rounded-ds-card border border-ds-border p-[8px]">
              {PDPL_LEVEL_DESC.map((d, n) => (
                <li key={n} className={`flex gap-[8px] rounded-ds-control px-[8px] py-[4px] text-ds-label ${score === n ? 'bg-ds-primary-soft text-ds-fg' : 'text-ds-fg-body'}`}>
                  <span className="shrink-0 font-[600]">{n}</span><span><span className="font-[600]">{PDPL_LEVELS[n]}</span>: {d}</span>
                </li>
              ))}
            </ul>
            <FormField label="Assigned to"><AssigneesField itemId={item.id} value={item.assignees} disabled={readOnly} onSaved={(list) => { qc.setQueryData(KEYS.detail(assessmentId), (d: unknown) => d && { ...(d as { items: Array<{ id: number }> }), items: (d as { items: Array<{ id: number }> }).items.map((i) => (i.id === item.id ? { ...i, assignees: list } : i)) }); onChanged(); }} /></FormField>
            {score === null ? <Notice tone="info" title="Score the control first">If it scores below 3 the gap and the remediation are recorded here.</Notice>
              : !isGapScore(score) ? <Notice tone="info" title={`Compliant (maturity ${score} of 5)`}>No gap or remediation is needed.</Notice>
              : (
                <div className="flex flex-col gap-[12px]">
                  <FormField label="Gap" hint="What is missing. The AI drafts the remediation from this."><Textarea rows={3} value={draft.gap} disabled={dis} placeholder="Staff contracts have no confidentiality clause." onChange={(e) => set('gap', e.target.value)} /></FormField>
                  <FormField label="Remediation action">
                    <>
                      <Textarea rows={4} value={draft.fix} disabled={dis} onChange={(e) => set('fix', e.target.value)} />
                      {!readOnly && <Button size="sm" className="mt-[6px]" leftIcon={<Sparkles aria-hidden />} loading={draftFix.isPending} disabled={!draft.gap.trim()} onClick={() => draftFix.mutate()}>Draft from my gap (AI)</Button>}
                      {draftFix.isError && <p role="alert" className="mt-[4px] text-ds-label text-ds-danger">{errorMessage(draftFix.error)}</p>}
                    </>
                  </FormField>
                  <div className="grid grid-cols-1 gap-[12px] sm:grid-cols-2">
                    <FormField label="Risk"><Select value={draft.risk} disabled={dis} onChange={(e) => set('risk', e.target.value)}><option value="">Not set</option>{['Low', 'Medium', 'High', 'Critical'].map((r) => <option key={r} value={r}>{r}</option>)}</Select></FormField>
                    <FormField label="Priority"><Select value={draft.priority} disabled={dis} onChange={(e) => set('priority', e.target.value)}><option value="">Not set</option>{PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}</Select></FormField>
                    <FormField label="Owner" hint="As the workbook says; who it is assigned to is above."><TextInput value={draft.owner} disabled={dis} onChange={(e) => set('owner', e.target.value)} /></FormField>
                    <FormField label="Target date" hint="Free text, such as 2026-09-01 or Q3-2026."><TextInput value={draft.target} disabled={dis} onChange={(e) => set('target', e.target.value)} /></FormField>
                  </div>
                </div>
              )}
          </div>
        </TabPanel>
        <TabPanel tabKey="evidence" lazy>
          <div className="flex flex-col gap-[16px] pt-[16px]">
            <EvidenceSection assessmentId={assessmentId} assessmentName={assessmentName} item={item} readOnly={readOnly} onChanged={onChanged} />
            <LibraryLink assessmentId={assessmentId} item={item} readOnly={readOnly} onChanged={onChanged} />
            <div className="flex flex-col gap-[8px] rounded-ds-card border border-ds-border p-[12px]">
              <p className="text-ds-body font-[600] text-ds-fg">Documents this control asks for</p>
              {asked.length === 0 ? <EmptyState kind="firstUse" bare title="The toolkit names none" description="No specific document is listed for this control." />
                : (
                  <ul className="flex flex-col divide-y divide-ds-border">
                    {asked.map((name) => {
                      const type = artifactTypeOf(name);
                      return (
                        <li key={name} className="flex flex-wrap items-center justify-between gap-[8px] py-[6px]">
                          <span className="min-w-0 break-words text-ds-body text-ds-fg">{name}<span className="ml-[8px] text-ds-label text-ds-fg-muted">{type}</span></span>
                          <Button size="sm" leftIcon={<Download aria-hidden />} onClick={() => void downloadAsFormat(name, buildArtifactTemplate({
                            name, artifactType: type, controlRef: item.number || null, description: `Evidence for PDPL control ${item.number}: ${item.description}`.trim(), frameworkName: 'Saudi PDPL', frameworkKey: 'pdpl_ksa',
                            stage: item.domain || 'PDPL', artifactId: item.number || name, owner: null, format: null,
                          }), null, type)}>Download a template</Button>
                        </li>
                      );
                    })}
                  </ul>
                )}
            </div>
          </div>
        </TabPanel>
      </Tabs>
    </SidePanel>
  );
}

