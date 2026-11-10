'use client';

// One question, edited in a sheet: what is asked, how it is answered, and the rules that go with it (section, weight, evidence, when it shows, what it follows up). The footer says what is in the way of saving.
// The sheet only builds the question (model.questionFrom); the builder page saves the list. Closing with typed changes asks first. A question with answers is a list of answer cards that stack on a phone.
import { useId, useMemo, useRef, useState } from 'react';
import { CheckCircle2, ListChecks, Paperclip, Star, Type, X, type LucideIcon } from 'lucide-react';
import { Button, Checkbox, FormField, IconButton, SegmentedControl, Select, Sheet, Textarea, TextInput } from '@/components/ui/ds';
import { DOMAIN_KEYS, DOMAIN_LABELS } from '../../_lib/tprmShared';
import {
  answerLabel, answerValues, blankDraft, blankOption, draftFrom, draftProblems, isChoice, isScored, MAX_OPTIONS, questionFrom,
  sectionFor, sectionName, TYPE_LABEL, TYPES, WEIGHT, YES_NO,
} from '../../_lib/questionnaires/model';
import type { Draft, OptionDraft } from '../../_lib/questionnaires/model';
import type { EvidenceMode, Question, QuestionType, Template } from '../../_lib/questionnaires/types';

const TYPE_ICON: Record<QuestionType, LucideIcon> = { yes_no: CheckCircle2, multiple_choice: ListChecks, text: Type, rating: Star, file: Paperclip };
const SOLO_NOTE: Partial<Record<QuestionType, string>> = {
  text: 'Recorded for reviewers. It does not change the score.',
  rating: 'Scored from 1 (worst) to 5 (best).',
  file: 'The supplier uploads a document as the answer.',
};
const HINT = 'text-ds-label text-ds-fg-muted';

export function QuestionEditor({ open, base, afterId, questions, templates, templateId, saving, onClose, onSave }: {
  open: boolean;
  /** The question being edited; null for a new one. */
  base: Question | null;
  /** For a new question, the one it goes below (null: the end). */
  afterId: string | null;
  /** The whole list: where the question stands, which ones it can depend on, which sections exist. */
  questions: Question[];
  /** The organisation's questionnaires, for the follow-up. */
  templates: Template[];
  templateId: number;
  saving: boolean;
  onClose: () => void;
  onSave: (next: Question) => void;
}) {
  const uid = useId();
  const [d, setD] = useState<Draft>(() => (base ? draftFrom(base) : blankDraft(sectionFor(questions, afterId))));
  const first = useRef(JSON.stringify(d));
  const set = (patch: Partial<Draft>) => setD((now) => ({ ...now, ...patch }));
  const setOption = (key: string, patch: Partial<OptionDraft>) => setD((now) => ({ ...now, options: now.options.map((o) => (o.uid === key ? { ...o, ...patch } : o)) }));

  const at = base ? questions.findIndex((q) => q.id === base.id) : afterId ? questions.findIndex((q) => q.id === afterId) + 1 : questions.length;
  const parents = questions.slice(0, at < 0 ? questions.length : at).filter((q) => isChoice(q.type) && q.id !== d.id);
  const parent = parents.find((q) => q.id === d.showIfQuestion);
  const sections = useMemo(() => Array.from(new Set(questions.map(sectionName))), [questions]);
  const sends = templates.filter((t) => !t.archived_at && t.id !== templateId);
  const problems = draftProblems(d);
  const choice = d.type === 'multiple_choice';
  const number = base ? at + 1 : null;
  const dirty = open && JSON.stringify(d) !== first.current;
  const ownAnswers = d.type === 'yes_no' ? YES_NO.map((a) => ({ key: a.value, label: a.label })) : d.options.map((o) => ({ key: o.uid, label: o.label.trim() || 'Untitled answer' }));
  const tick = (list: string[], key: string, on: boolean) => (on ? [...list, key] : list.filter((k) => k !== key));
  const followName = d.followTemplate !== null && !sends.some((t) => t.id === d.followTemplate) ? 'An archived questionnaire' : null;

  const submit = () => { if (problems.length === 0 && !saving) onSave(questionFrom(d, base ?? undefined)); };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={base ? `Edit Q${number}` : 'New question'}
      subtitle="Answered by the supplier in the portal."
      width="lg"
      dirty={dirty}
      initialFocus="textarea"
      footer={(
        <div className="flex flex-wrap items-center justify-between gap-[8px]">
          <p role="status" className="min-w-0 flex-1 text-ds-label text-ds-danger">{problems[0] ?? ''}</p>
          <div className="flex shrink-0 gap-[8px]">
            <Button onClick={onClose}>Cancel</Button>
            <Button type="submit" form={`${uid}-form`} variant="primary" loading={saving} disabled={problems.length > 0}>{base ? 'Save question' : 'Add question'}</Button>
          </div>
        </div>
      )}
    >
      <form id={`${uid}-form`} className="flex flex-col gap-[20px]" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <FormField label="Question" required>
          <Textarea rows={2} maxLength={1000} value={d.text} onChange={(e) => set({ text: e.target.value })} />
        </FormField>
        <FormField label="Help text" optional info="Shown under the question to whoever answers it.">
          <TextInput maxLength={2000} value={d.help} onChange={(e) => set({ help: e.target.value })} placeholder="What a good answer includes" />
        </FormField>

        <div className="flex flex-col gap-[4px]">
          <span id={`${uid}-type`} className="text-ds-label text-ds-fg">Answer type</span>
          <div role="radiogroup" aria-labelledby={`${uid}-type`} className="grid grid-cols-2 gap-[8px] sm:grid-cols-3">
            {TYPES.map((type) => {
              const Icon = TYPE_ICON[type];
              const on = d.type === type;
              return (
                <button
                  key={type} type="button" role="radio" aria-checked={on}
                  onClick={() => setD((now) => ({
                    ...now, type,
                    options: type === 'multiple_choice' && now.options.length < 2 ? [blankOption(), blankOption()] : now.options,
                    evidence: type === 'file' ? 'none' : now.evidence === 'none' && now.type === 'file' ? 'optional' : now.evidence,
                    // the answers a rule names belong to the type they were ticked under
                    evidenceOn: [], followWhen: [],
                  }))}
                  className={`flex min-h-ds-control items-center gap-[8px] rounded-ds-control border px-[10px] text-left text-ds-body focus-visible:outline-none focus-visible:shadow-ds-ring ${on ? 'border-ds-primary bg-ds-primary-soft font-[600] text-ds-primary-text' : 'border-ds-border-strong bg-ds-surface text-ds-fg-body hover:bg-ds-surface-hover'}`}
                >
                  <Icon aria-hidden className="h-[16px] w-[16px] shrink-0" strokeWidth={1.75} />
                  {TYPE_LABEL[type]}
                </button>
              );
            })}
          </div>
        </div>

        {d.type === 'yes_no' && (
          <fieldset className="flex flex-col gap-[2px]">
            <legend className="mb-[2px] text-ds-label text-ds-fg">Needs a note on</legend>
            <div className="flex flex-wrap gap-x-[16px]">
              {YES_NO.map((a) => <Checkbox key={a.value} label={a.label} checked={d.noteOn.includes(a.value)} onChange={(e) => set({ noteOn: tick(d.noteOn, a.value, e.target.checked) })} />)}
            </div>
            <p className={HINT}>Not applicable always needs a reason.</p>
          </fieldset>
        )}

        {choice ? (
          <div className="flex flex-col gap-[8px]">
            <span className="text-ds-label text-ds-fg">Answers</span>
            <ul className="flex flex-col gap-[8px]">
              {d.options.map((o, i) => (
                <li key={o.uid} className="flex flex-col gap-[8px] rounded-ds-card border border-ds-border p-[10px]">
                  <div className="flex items-center gap-[8px]">
                    <TextInput className="min-w-0 flex-1" aria-label={`Answer ${i + 1} label`} maxLength={200} value={o.label} onChange={(e) => setOption(o.uid, { label: e.target.value })} placeholder={`Answer ${i + 1}`} />
                    <IconButton
                      label={`Remove ${o.label.trim() || `answer ${i + 1}`}`} disabled={d.options.length <= 2}
                      onClick={() => setD((now) => ({ ...now, options: now.options.filter((x) => x.uid !== o.uid), evidenceOn: now.evidenceOn.filter((k) => k !== o.uid), followWhen: now.followWhen.filter((k) => k !== o.uid) }))}
                    ><X aria-hidden /></IconButton>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-[16px] gap-y-[4px]">
                    <label className="flex items-center gap-[8px] text-ds-label text-ds-fg-muted" title="How good this answer is, 0 to 100. Empty: the answer does not count.">
                      Credit %
                      <TextInput
                        className="w-[84px]" type="number" aria-label={`Answer ${i + 1} credit, 0 to 100`} min={0} max={100} value={o.na || o.score === null ? '' : o.score} disabled={o.na} placeholder="—"
                        onChange={(e) => setOption(o.uid, { score: e.target.value === '' ? null : Math.max(0, Math.min(100, Number(e.target.value))) })}
                      />
                    </label>
                    <Checkbox label="Not applicable" checked={o.na} onChange={(e) => setOption(o.uid, { na: e.target.checked })} />
                    <Checkbox label="Asks for a note" checked={o.note} onChange={(e) => setOption(o.uid, { note: e.target.checked })} />
                  </div>
                </li>
              ))}
            </ul>
            <div><Button disabled={d.options.length >= MAX_OPTIONS} onClick={() => set({ options: [...d.options, blankOption()] })}>Add an answer</Button></div>
            <p className={HINT}>100 is full credit. An answer worth half or less is a gap, and raises a finding. Not applicable is not scored and always asks for a reason.</p>
          </div>
        ) : SOLO_NOTE[d.type] ? (
          <p className="rounded-ds-control bg-ds-surface-subtle px-[12px] py-[10px] text-ds-body text-ds-fg-muted">{SOLO_NOTE[d.type]}</p>
        ) : null}

        <div className="grid gap-[16px] sm:grid-cols-2">
          <FormField label="Section" info="Questions in the same section are reviewed together.">
            <TextInput list={`${uid}-sections`} maxLength={100} value={d.section} onChange={(e) => set({ section: e.target.value })} placeholder={base ? sectionName(base) : 'General'} />
            <datalist id={`${uid}-sections`}>{sections.map((s) => <option key={s} value={s} />)}</datalist>
          </FormField>
          <FormField label="Risk domain" info="Findings and scores are grouped by it. Without a section, it also sorts the question.">
            <Select value={d.domain} onChange={(e) => set({ domain: e.target.value })}>
              <option value="">Not set</option>
              {d.domain && !DOMAIN_KEYS.includes(d.domain) && <option value={d.domain}>{d.domain}</option>}
              {DOMAIN_KEYS.map((k) => <option key={k} value={k}>{DOMAIN_LABELS[k]}</option>)}
            </Select>
          </FormField>
          {isScored(d.type) && (
            <FormField label="Weight" info="How much this counts in the score, among the questions of this questionnaire.">
              <TextInput type="number" min={WEIGHT.min} max={WEIGHT.max} step={WEIGHT.step} value={Number.isFinite(d.weight) ? d.weight : ''} onChange={(e) => set({ weight: e.target.value === '' ? NaN : Number(e.target.value) })} />
            </FormField>
          )}
        </div>

        <div className="flex flex-col gap-[2px]">
          <Checkbox label={d.type === 'file' ? 'Required: a document must be uploaded' : 'Required: must be answered to finish'} checked={d.required} onChange={(e) => set({ required: e.target.checked })} />
          {isScored(d.type) && <Checkbox label="Critical control: a gap raises a critical finding, which blocks approval" checked={d.critical} onChange={(e) => set({ critical: e.target.checked })} />}
          {d.type === 'yes_no' && <Checkbox label="A certificate can answer this: a current SOC 2 or ISO 27001 certificate on file" checked={d.certificate} onChange={(e) => set({ certificate: e.target.checked })} />}
        </div>

        {d.type !== 'file' && (
          <div className="flex flex-col gap-[8px]">
            <SegmentedControl<EvidenceMode>
              label="Evidence the supplier gives with the answer" name={`${uid}-evidence`} value={d.evidence} onChange={(evidence) => set({ evidence })}
              options={[{ value: 'none', label: 'No evidence' }, { value: 'optional', label: 'Evidence optional' }, { value: 'required', label: 'Evidence required' }]}
            />
            {d.evidence === 'required' && isChoice(d.type) && (
              <fieldset className="flex flex-col gap-[2px] rounded-ds-card border border-ds-border p-[10px]">
                <legend className="px-[4px] text-ds-label text-ds-fg-muted">Needed when the answer is</legend>
                {ownAnswers.map((a) => <Checkbox key={a.key} label={a.label} checked={d.evidenceOn.includes(a.key)} onChange={(e) => set({ evidenceOn: tick(d.evidenceOn, a.key, e.target.checked) })} />)}
                <p className={HINT}>None ticked means any answer.</p>
              </fieldset>
            )}
          </div>
        )}

        <div className="flex flex-col gap-[8px]">
          <FormField label="Show this question">
            <Select value={d.showIfQuestion} onChange={(e) => set({ showIfQuestion: e.target.value, showIfAnswers: [] })}>
              <option value="">Always</option>
              {parents.map((p) => {
                const n = questions.indexOf(p) + 1;
                return <option key={p.id} value={p.id}>{`Only if Q${n}: ${p.text.length > 42 ? `${p.text.slice(0, 42)}…` : p.text}`}</option>;
              })}
            </Select>
          </FormField>
          {parent && (
            <fieldset className="flex flex-col gap-[2px] rounded-ds-card border border-ds-border p-[10px]">
              <legend className="px-[4px] text-ds-label text-ds-fg-muted">is answered with</legend>
              {answerValues(parent).map((v) => <Checkbox key={v} label={answerLabel(parent, v)} checked={d.showIfAnswers.includes(v)} onChange={(e) => set({ showIfAnswers: tick(d.showIfAnswers, v, e.target.checked) })} />)}
            </fieldset>
          )}
        </div>

        {isChoice(d.type) && sends.length > 0 && (
          <div className="flex flex-col gap-[8px]">
            <FormField label="Follow up" info="Accepting the answers sends the supplier another questionnaire, once, when the question is answered this way.">
              <Select value={d.followTemplate ?? ''} onChange={(e) => set({ followTemplate: e.target.value ? Number(e.target.value) : null, followWhen: e.target.value ? d.followWhen : [] })}>
                <option value="">Never</option>
                {followName && <option value={d.followTemplate ?? ''}>{followName}</option>}
                {sends.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </Select>
            </FormField>
            {d.followTemplate !== null && (
              <fieldset className="flex flex-col gap-[2px] rounded-ds-card border border-ds-border p-[10px]">
                <legend className="px-[4px] text-ds-label text-ds-fg-muted">when answered with</legend>
                {ownAnswers.map((a) => <Checkbox key={a.key} label={a.label} checked={d.followWhen.includes(a.key)} onChange={(e) => set({ followWhen: tick(d.followWhen, a.key, e.target.checked) })} />)}
              </fieldset>
            )}
          </div>
        )}
      </form>
    </Sheet>
  );
}
