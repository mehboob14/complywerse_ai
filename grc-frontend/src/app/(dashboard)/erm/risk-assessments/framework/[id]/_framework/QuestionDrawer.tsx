'use client';

/**
 * One question, over the table: the whole question and the clause it comes from, its status and who answers it (changed where they are, saved at once), the method's own fields (an AI
 * suggestion fills them a field at a time and nothing is saved until "Save answers"), the four scores with the method's own words and the level they make, "Accept risk" and the
 * notes, "Add to the Risk Register", and the files. Previous, Next and "Next to answer" walk the list as it is shown, so someone answering their questions never goes back to the top.
 */
import { useState } from 'react';
import { ArrowUpRight, ChevronDown, ChevronUp, Paperclip, SkipForward, Trash2, Upload, X } from 'lucide-react';
import {
  Button, Checkbox, ClampedText, Combobox, FormField, IconButton, Menu, Select, SidePanel, StatusPill, TextInput, Textarea, type MenuItem,
} from '@/components/ui/ds';
import { statusOf } from '@/components/ui/ds/reportOutcome';
import { ermApi } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { statusPill } from '@/lib/status';
import { riskLevel } from '@/lib/statuses/risk';
import type { FrameworkMethodology } from '@/types';
import { AiDraft } from '../../../_register/AiDraft';
import { aiFailureWords, inherentOf, residualOf } from '../../../_register/assessmentModel';
import type { PersonOption } from '../../../_register/assessmentData';
import { QUESTION_STATUSES, rating, type Question } from './frameworkModel';

const STATUS_WORDS: Record<string, string> = { not_started: 'Not started', in_progress: 'In progress', completed: 'Completed', blocked: 'Blocked' };

interface AiAnswer {
  suggestions: Record<string, string>;
  recommendations?: string;
  rationale?: string;
  recommended_scores: { inherent_likelihood: number | null; inherent_impact: number | null; residual_likelihood: number | null; residual_impact: number | null };
}

export interface QuestionDrawerProps {
  assessmentId: number;
  q: Question | null;
  index: number;
  total: number;
  methodology?: FrameworkMethodology;
  phaseName: (code: string | null | undefined) => string;
  people: readonly PersonOption[];
  canWrite: boolean;
  onClose: () => void;
  onStep: (dir: -1 | 1) => void;
  onNextToAnswer: () => void;
  canNextToAnswer: boolean;
  onSave: (q: Question, data: Record<string, unknown>) => Promise<boolean>;
  onDelete: (q: Question) => void;
  onUpload: (q: Question, file: File) => void;
  uploading: boolean;
  onRemoveFile: (q: Question, file: { id: number; file_name: string }) => void;
  onMove: (q: Question) => void;
}

function Section({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="mt-[20px] border-t border-ds-border pt-[16px]">
      <div className="flex flex-wrap items-center gap-[8px]">
        <h3 className="m-0 !text-ds-body !font-[600] !text-ds-fg">{title}</h3>
        {action && <span className="ml-auto">{action}</span>}
      </div>
      <div className="mt-[8px]">{children}</div>
    </section>
  );
}

function ScaleSelect({ label, scale, value, disabled, onPick }: { label: string; scale?: FrameworkMethodology['likelihood_scale']; value?: number | null; disabled: boolean; onPick: (v: number | null) => void }) {
  const points = scale && scale.length ? scale.map((s) => ({ value: s.value, label: `${s.value} · ${s.label}`, title: s.description })) : [1, 2, 3, 4, 5].map((v) => ({ value: v, label: String(v), title: undefined }));
  return (
    <FormField label={label}>
      <Select value={value ?? ''} disabled={disabled} onChange={(e) => onPick(e.target.value ? Number(e.target.value) : null)}>
        <option value="">{'—'}</option>
        {points.map((p) => <option key={p.value} value={p.value} title={p.title}>{p.label}</option>)}
      </Select>
    </FormField>
  );
}

function Body(props: QuestionDrawerProps & { q: Question }) {
  const { q, methodology, canWrite, people, assessmentId } = props;
  const [draft, setDraft] = useState<Record<string, string>>({ ...(q.methodology_fields ?? {}) });
  const [notes, setNotes] = useState(q.acceptance_notes ?? '');
  const [hint, setHint] = useState('');
  const [ai, setAi] = useState<{ state: 'idle' | 'loading' | 'ready' | 'error'; answer?: AiAnswer; error?: string }>({ state: 'idle' });
  const fields = methodology && q.methodology_code ? methodology.fields : [];
  const fieldsDirty = fields.some((f) => (draft[f.key] || '') !== ((q.methodology_fields ?? {})[f.key] || ''));
  const notesDirty = (notes || '') !== (q.acceptance_notes || '');
  const save = (data: Record<string, unknown>) => props.onSave(q, data);
  const inh = inherentOf(q);
  const res = residualOf(q);
  const band = rating(q);
  const phase = props.phaseName(q.phase_code);

  const suggest = async () => {
    setAi({ state: 'loading' });
    try {
      const r = await ermApi.frameworkRiskAssessments.aiSuggestQuestion(assessmentId, q.id, hint.trim() || undefined);
      setAi({ state: 'ready', answer: r.data as unknown as AiAnswer });
    } catch (e) {
      setAi({ state: 'error', error: aiFailureWords(statusOf(e) ?? undefined) });
    }
  };
  const a = ai.answer;
  const suggestedScores = a ? Object.entries(a.recommended_scores).filter(([, v]) => v != null) : [];
  const rows = a ? fields.filter((f) => a.suggestions[f.key] !== undefined).map((f) => ({ key: f.key, label: f.label, value: a.suggestions[f.key], onUse: () => setDraft((d) => ({ ...d, [f.key]: a.suggestions[f.key] ?? '' })) })) : [];
  const useScores = () => { if (a) void save(Object.fromEntries(suggestedScores)); };

  return (
    <div>
      <ClampedText text={q.question_text} lines={6} />
      {q.source_quote && <div className="mt-[8px] rounded-ds-control border-l-[3px] border-ds-border-strong pl-[10px] text-ds-label italic text-ds-fg-muted"><ClampedText text={q.source_quote} lines={3} /></div>}

      <div className="mt-[16px] grid gap-[12px] sm:grid-cols-2">
        <FormField label="Status">
          <Select value={q.status} disabled={!canWrite} onChange={(e) => { void save({ status: e.target.value }); }}>
            {QUESTION_STATUSES.map((s) => <option key={s} value={s}>{STATUS_WORDS[s]}</option>)}
          </Select>
        </FormField>
        <FormField label="Answered by">
          <Combobox label="Answered by" clearable disabled={!canWrite} value={q.assigned_user_id != null ? String(q.assigned_user_id) : null} placeholder="Unassigned" searchPlaceholder="Search people"
            options={people.map((p) => ({ value: String(p.id), label: p.display_name, description: p.email ?? undefined }))} onChange={(v) => { void save({ assigned_user_id: v ? Number(v) : null }); }} />
        </FormField>
      </div>
      {(phase !== 'No phase' || q.clause_reference) && <p className="mb-0 mt-[8px] text-ds-label text-ds-fg-muted">{[phase !== 'No phase' ? `Phase: ${phase}` : '', q.clause_reference ? `Clause ${q.clause_reference}` : ''].filter(Boolean).join(' · ')}</p>}

      {fields.length > 0 && (
        <Section title={`Answers by ${methodology?.display_name}`} action={canWrite ? <Button size="sm" variant="primary" disabled={!fieldsDirty} onClick={() => { void save({ methodology_fields: draft }); }}>Save answers</Button> : undefined}>
          {canWrite && (
            <div className="mb-[12px] flex flex-col gap-[8px]">
              <FormField label="Anything the AI should know" optional hint="For example: we host on AWS, about 200 people, no personal data.">
                <TextInput value={hint} onChange={(e) => setHint(e.target.value)} maxLength={500} />
              </FormField>
              <AiDraft
                state={ai.state}
                source="ai"
                rows={rows}
                error={ai.error}
                onRun={() => { void suggest(); }}
                onUseAll={() => a && setDraft((d) => ({ ...d, ...a.suggestions }))}
                idleText="Drafts the answers below, and suggests scores, from the requirement this question comes from."
                extra={suggestedScores.length > 0 ? (
                  <div className="mt-[8px] flex flex-wrap items-center gap-[8px] border-t border-ds-border pt-[8px]">
                    <span className="text-ds-label text-ds-fg-muted">Suggested scores: {suggestedScores.map(([k, v]) => `${k.replace(/_/g, ' ')} ${v}`).join(', ')}</span>
                    <Button size="sm" className="ml-auto" onClick={useScores}>Use scores</Button>
                  </div>
                ) : undefined}
                note={a?.recommendations || a?.rationale ? <>{a?.recommendations}{a?.recommendations && a?.rationale ? ' ' : ''}{a?.rationale}</> : undefined}
              />
            </div>
          )}
          <div className="grid gap-[12px]">
            {fields.map((f) => (
              <FormField key={f.key} label={f.label} required={f.required} hint={f.help_text ?? undefined}>
                {f.field_type === 'textarea' ? <Textarea rows={3} value={draft[f.key] || ''} placeholder={f.placeholder ?? undefined} disabled={!canWrite} onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))} />
                  : f.field_type === 'select' ? <Select value={draft[f.key] || ''} disabled={!canWrite} onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}><option value="">{'—'}</option>{(f.options || []).map((o) => <option key={o} value={o}>{o}</option>)}</Select>
                    : <TextInput value={draft[f.key] || ''} placeholder={f.placeholder ?? undefined} disabled={!canWrite} onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))} />}
              </FormField>
            ))}
          </div>
        </Section>
      )}

      <Section title="Risk rating" action={band !== 'none' ? <StatusPill {...statusPill(riskLevel, band)} /> : undefined}>
        <div className="grid grid-cols-2 gap-[12px]">
          <ScaleSelect label="Inherent likelihood" scale={methodology?.likelihood_scale} value={q.inherent_likelihood} disabled={!canWrite} onPick={(v) => { void save({ inherent_likelihood: v }); }} />
          <ScaleSelect label="Inherent impact" scale={methodology?.impact_scale} value={q.inherent_impact} disabled={!canWrite} onPick={(v) => { void save({ inherent_impact: v }); }} />
          <ScaleSelect label="Residual likelihood" scale={methodology?.likelihood_scale} value={q.residual_likelihood} disabled={!canWrite} onPick={(v) => { void save({ residual_likelihood: v }); }} />
          <ScaleSelect label="Residual impact" scale={methodology?.impact_scale} value={q.residual_impact} disabled={!canWrite} onPick={(v) => { void save({ residual_impact: v }); }} />
        </div>
        <p className="mb-0 mt-[8px] text-ds-body text-ds-fg-body">Inherent score <strong className="font-[600] text-ds-fg">{inh ?? '—'}</strong>, residual score <strong className="font-[600] text-ds-fg">{res ?? '—'}</strong>.{methodology && <span className="text-ds-fg-muted"> The scale follows {methodology.reference_standard}.</span>}</p>
      </Section>

      <Section title="Accept the risk">
        <Checkbox label="Accept this risk" checked={!!q.is_risk_accepted} disabled={!canWrite || !!q.linked_risk_id} onChange={(e) => { void save({ is_risk_accepted: e.target.checked }); }} />
        <p className="mb-[8px] mt-[2px] text-ds-label text-ds-fg-muted">Accepting is the decision to live with the risk. A risk you accept can then be added to the Risk Register.</p>
        <FormField label="Acceptance notes" optional><Textarea rows={2} value={notes} disabled={!canWrite} onChange={(e) => setNotes(e.target.value)} /></FormField>
        <div className="mt-[8px] flex flex-wrap items-center gap-[8px]">
          {canWrite && <Button size="sm" disabled={!notesDirty} onClick={() => { void save({ acceptance_notes: notes }); }}>Save notes</Button>}
          {q.linked_risk_id ? (
            <Button href={`/erm/risks/${q.linked_risk_id}`} rightIcon={<ArrowUpRight aria-hidden />}>This risk is in the Risk Register. Open it</Button>
          ) : canWrite && (
            <Button variant="primary" disabled={!q.is_risk_accepted} title={q.is_risk_accepted ? undefined : 'Accept the risk first'} onClick={() => props.onMove(q)}>Add to the Risk Register</Button>
          )}
          {!q.is_risk_accepted && !q.linked_risk_id && <span className="text-ds-label text-ds-fg-muted">Accept the risk first.</span>}
        </div>
      </Section>

      <Section title={`Files${q.evidence?.length ? ` (${q.evidence.length})` : ''}`} action={canWrite ? (
        <label className="relative inline-flex">
          <span className="inline-flex min-h-ds-control-sm cursor-pointer items-center gap-[6px] rounded-ds-control border border-ds-border-strong px-[10px] text-ds-label font-medium text-ds-fg-body hover:bg-ds-surface-hover focus-within:shadow-ds-ring">
            <Upload aria-hidden className="h-[14px] w-[14px]" />{props.uploading ? 'Uploading…' : 'Upload a file'}
          </span>
          <input type="file" className="sr-only" disabled={props.uploading} onChange={(e) => { const f = e.target.files?.[0]; if (f) props.onUpload(q, f); e.currentTarget.value = ''; }} />
        </label>
      ) : undefined}>
        {(q.evidence ?? []).length === 0 ? <p className="m-0 text-ds-body text-ds-fg-muted">No file is attached.</p> : (
          <ul className="m-0 list-none p-0">
            {(q.evidence ?? []).map((ev) => (
              <li key={ev.id} className="flex min-h-[44px] items-center gap-[8px] border-b border-ds-border py-[4px] last:border-b-0">
                <Paperclip aria-hidden className="h-[14px] w-[14px] shrink-0 text-ds-fg-muted" />
                <div className="min-w-0 flex-1"><p className="m-0 break-all text-ds-body font-[500] text-ds-fg">{ev.file_name}</p><p className="m-0 text-ds-label text-ds-fg-muted">{[ev.uploader_name, ev.uploaded_at ? formatDateTime(ev.uploaded_at) : ''].filter(Boolean).join(' · ')}</p></div>
                {canWrite && <IconButton label={`Remove ${ev.file_name}`} onClick={() => props.onRemoveFile(q, ev)}><X aria-hidden /></IconButton>}
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}

export function QuestionDrawer(props: QuestionDrawerProps) {
  const { q } = props;
  const more: MenuItem[] = q ? [{ key: 'delete', label: 'Delete question', icon: Trash2, danger: true, hidden: !props.canWrite, onSelect: () => props.onDelete(q) }] : [];
  return (
    <SidePanel
      open={!!q}
      onClose={props.onClose}
      title={<span dir="auto" className="line-clamp-2 break-words">{q ? `Question ${props.index + 1} of ${props.total}` : ''}</span>}
      subtitle={q ? STATUS_WORDS[q.status] ?? q.status : undefined}
      dockFrom={Infinity}
      width="lg"
      actions={q && (
        <>
          <IconButton label="Previous question" aria-disabled={props.index <= 0 || undefined} onClick={() => { if (props.index > 0) props.onStep(-1); }}><ChevronUp aria-hidden /></IconButton>
          <IconButton label="Next question" aria-disabled={props.index >= props.total - 1 || undefined} onClick={() => { if (props.index < props.total - 1) props.onStep(1); }}><ChevronDown aria-hidden /></IconButton>
          {more.some((m) => !m.hidden) && <Menu label="More actions" iconOnly items={more} />}
        </>
      )}
      footer={q && <div className="flex flex-wrap items-center gap-[8px]"><Button variant="primary" leftIcon={<SkipForward aria-hidden />} disabled={!props.canNextToAnswer} onClick={props.onNextToAnswer}>Next to answer</Button><Button onClick={props.onClose}>Close</Button></div>}
    >
      {q && <Body key={q.id} {...props} q={q} />}
    </SidePanel>
  );
}
