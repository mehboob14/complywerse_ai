'use client';

// One question, edited in a side panel: what is asked on the left, its rules on the right. The footer says what is in the way of
// saving. The panel only builds the question (model.questionFrom); the builder page saves the list.
import { useMemo, useState } from 'react';
import { CheckCircle2, ListChecks, Paperclip, Star, Type, X, type LucideIcon } from 'lucide-react';
import { RightSlidePanel } from '@/components/ui/RightSlidePanel';
import { SegmentedControl, ToggleChip, BTN, BTN_PRIMARY } from '@/app/(dashboard)/vendor-risk/_ui';
import { DOMAIN_KEYS, DOMAIN_LABELS } from '../../_lib/tprmShared';
import {
  answerLabel, answerValues, blankDraft, blankOption, draftFrom, draftProblems, isChoice, isScored, MAX_OPTIONS, questionFrom,
  sectionFor, sectionName, TYPE_LABEL, TYPES, WEIGHT, YES_NO,
} from '../../_lib/questionnaires/model';
import type { Draft, OptionDraft } from '../../_lib/questionnaires/model';
import type { EvidenceMode, Question, QuestionType, Template } from '../../_lib/questionnaires/types';
import { AREA, Check, Field, INPUT, NOTE, ToggleRow } from './ui';

const TYPE_ICON: Record<QuestionType, LucideIcon> = { yes_no: CheckCircle2, multiple_choice: ListChecks, text: Type, rating: Star, file: Paperclip };

const SOLO_NOTE: Partial<Record<QuestionType, string>> = {
  text: 'Recorded for reviewers. It does not change the score.',
  rating: 'Scored from 1 (worst) to 5 (best).',
  file: 'The supplier uploads a document as the answer.',
};

export function QuestionEditor({ base, afterId, questions, templates, templateId, saving, onClose, onSave }: {
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
  const [d, setD] = useState<Draft>(() => (base ? draftFrom(base) : blankDraft(sectionFor(questions, afterId))));
  const set = (patch: Partial<Draft>) => setD((now) => ({ ...now, ...patch }));
  const setOption = (key: string, patch: Partial<OptionDraft>) =>
    setD((now) => ({ ...now, options: now.options.map((o) => (o.uid === key ? { ...o, ...patch } : o)) }));

  const at = base ? questions.findIndex((q) => q.id === base.id) : afterId ? questions.findIndex((q) => q.id === afterId) + 1 : questions.length;
  const parents = questions.slice(0, at < 0 ? questions.length : at).filter((q) => isChoice(q.type) && q.id !== d.id);
  const parent = parents.find((q) => q.id === d.showIfQuestion);
  const sections = useMemo(() => Array.from(new Set(questions.map(sectionName))), [questions]);
  const sends = templates.filter((t) => !t.archived_at && t.id !== templateId);
  const problems = draftProblems(d);
  const choice = d.type === 'multiple_choice';
  const number = base ? at + 1 : null;
  const ownAnswers = d.type === 'yes_no'
    ? YES_NO.map((a) => ({ key: a.value, label: a.label }))
    : d.options.map((o) => ({ key: o.uid, label: o.label.trim() || 'Untitled answer' }));
  const tick = (list: string[], key: string, on: boolean) => (on ? [...list, key] : list.filter((k) => k !== key));

  const submit = () => { if (problems.length === 0 && !saving) onSave(questionFrom(d, base ?? undefined)); };

  return (
    <RightSlidePanel
      isOpen
      onClose={onClose}
      title={base ? `Edit Q${number}` : 'New question'}
      subtitle="Answered by the supplier in the portal."
      width="w-full max-w-[780px]"
      footer={(
        <div className="flex items-center justify-between gap-3">
          <p role="status" className="min-w-0 truncate text-[12px] leading-4 text-[#9a5007]">{problems[0] ?? ''}</p>
          <div className="flex shrink-0 gap-2">
            <button type="button" onClick={onClose} className={BTN}>Cancel</button>
            <button type="button" disabled={problems.length > 0 || saving} onClick={submit} className={BTN_PRIMARY}>
              {saving ? 'Saving…' : base ? 'Save question' : 'Add question'}
            </button>
          </div>
        </div>
      )}
    >
      <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_16.5rem]">
        <div className="min-w-0 space-y-5">
          <Field label="Question" htmlFor="q-text">
            <textarea id="q-text" rows={2} maxLength={1000} value={d.text} onChange={(e) => set({ text: e.target.value })} className={AREA} autoFocus />
          </Field>
          <Field label="Help text" htmlFor="q-help" info="Shown under the question to whoever answers it.">
            <input id="q-help" type="text" maxLength={2000} value={d.help} onChange={(e) => set({ help: e.target.value })} placeholder="What a good answer includes" className={INPUT} />
          </Field>

          <div>
            <p className="mb-1 text-[13px] font-medium leading-5 text-[#26323d]">Answer type</p>
            <div role="radiogroup" aria-label="Answer type" className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
              {TYPES.map((type) => {
                const Icon = TYPE_ICON[type];
                const on = d.type === type;
                return (
                  <button
                    key={type}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => setD((now) => ({
                      ...now, type,
                      options: type === 'multiple_choice' && now.options.length < 2 ? [blankOption(), blankOption()] : now.options,
                      evidence: type === 'file' ? 'none' : now.evidence === 'none' && now.type === 'file' ? 'optional' : now.evidence,
                      // the answers a rule names belong to the type they were ticked under
                      evidenceOn: [], followWhen: [],
                    }))}
                    className={`flex items-center gap-2 rounded-lg border px-2.5 py-2 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f766e] ${on ? 'border-[#0f766e] bg-[#f0fdfa] font-medium text-[#0f766e]' : 'border-[#c3ccd5] bg-[#fff] text-[#586472] hover:bg-[#f3f6f8]'}`}
                  >
                    <Icon aria-hidden className="h-4 w-4 shrink-0" strokeWidth={1.75} />
                    {TYPE_LABEL[type]}
                  </button>
                );
              })}
            </div>
          </div>

          {d.type === 'yes_no' && (
            <div>
              <p className="mb-1 text-[13px] font-medium leading-5 text-[#26323d]">Needs a note on</p>
              <div className="flex flex-wrap gap-1.5">
                {YES_NO.map((a) => (
                  <ToggleChip key={a.value} on={d.noteOn.includes(a.value)} onClick={() => set({ noteOn: tick(d.noteOn, a.value, !d.noteOn.includes(a.value)) })}>
                    {a.label}
                  </ToggleChip>
                ))}
              </div>
              <p className={`mt-1.5 ${NOTE}`}>Not applicable always needs a reason.</p>
            </div>
          )}

          {choice ? (
            <div>
              <p className="mb-1 text-[13px] font-medium leading-5 text-[#26323d]">Answers</p>
              <div className="overflow-hidden rounded-lg border border-[#d5dbe1]">
                <div className="grid grid-cols-[minmax(0,1fr)_4.5rem_auto_2rem] items-center gap-2 border-b border-[#d5dbe1] bg-[#f3f6f8] px-2.5 py-1.5 text-[12px] text-[#64707e]">
                  <span>Label</span><span>Credit %</span><span>Marks</span><span className="sr-only">Remove</span>
                </div>
                <ul className="divide-y divide-[#eef1f4]">
                  {d.options.map((o, i) => (
                    <li key={o.uid} className="grid grid-cols-[minmax(0,1fr)_4.5rem_auto_2rem] items-center gap-2 px-2.5 py-1.5">
                      <input
                        type="text" aria-label={`Answer ${i + 1} label`} value={o.label} maxLength={200}
                        onChange={(e) => setOption(o.uid, { label: e.target.value })} placeholder={`Answer ${i + 1}`} className={`${INPUT} h-8`}
                      />
                      <input
                        type="number" aria-label={`Answer ${i + 1} credit, 0 to 100`} min={0} max={100} value={o.na || o.score === null ? '' : o.score}
                        disabled={o.na} placeholder="—" title="How good this answer is, 0 to 100. Empty: the answer does not count."
                        onChange={(e) => setOption(o.uid, { score: e.target.value === '' ? null : Math.max(0, Math.min(100, Number(e.target.value))) })}
                        className={`${INPUT} h-8 text-right tabular-nums`}
                      />
                      <span className="flex items-center gap-1">
                        <ToggleChip on={o.na} onClick={() => setOption(o.uid, { na: !o.na })} title="Not applicable: not scored, and picking it asks for a reason">N/A</ToggleChip>
                        <ToggleChip on={o.note} onClick={() => setOption(o.uid, { note: !o.note })} title="Picking it asks for a note">Note</ToggleChip>
                      </span>
                      <button
                        type="button" aria-label={`Remove ${o.label.trim() || `answer ${i + 1}`}`} disabled={d.options.length <= 2}
                        onClick={() => setD((now) => ({
                          ...now, options: now.options.filter((x) => x.uid !== o.uid),
                          evidenceOn: now.evidenceOn.filter((k) => k !== o.uid), followWhen: now.followWhen.filter((k) => k !== o.uid),
                        }))}
                        className="grid h-8 w-8 place-items-center rounded-lg text-[#586472] hover:bg-[#f3f6f8] disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f766e]"
                      >
                        <X aria-hidden className="h-3.5 w-3.5" />
                      </button>
                    </li>
                  ))}
                </ul>
                <button
                  type="button" disabled={d.options.length >= MAX_OPTIONS} onClick={() => set({ options: [...d.options, blankOption()] })}
                  className="w-full border-t border-[#d5dbe1] px-3 py-2 text-left text-sm font-medium text-[#0f766e] hover:bg-[#f0fdfa] disabled:text-[#9aa5b1] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#0f766e]"
                >
                  + Add answer
                </button>
              </div>
              <p className={`mt-1.5 ${NOTE}`}>100 is full credit. An answer worth half or less is a gap, and raises a finding.</p>
            </div>
          ) : SOLO_NOTE[d.type] ? (
            <p className="rounded-lg bg-[#f3f6f8] px-3 py-2.5 text-[13px] leading-5 text-[#586472]">{SOLO_NOTE[d.type]}</p>
          ) : null}
        </div>

        <div className="min-w-0 space-y-4 md:border-l md:border-[#e1e6eb] md:pl-5">
          <Field label="Section" htmlFor="q-section" info="Questions in the same section are reviewed together.">
            <input
              id="q-section" type="text" list="q-sections" maxLength={100} value={d.section}
              onChange={(e) => set({ section: e.target.value })}
              placeholder={base ? sectionName(base) : 'General'} className={INPUT}
            />
            <datalist id="q-sections">{sections.map((s) => <option key={s} value={s} />)}</datalist>
          </Field>

          <ToggleRow label="Required" note={d.type === 'file' ? 'A document must be uploaded' : 'Must be answered to finish'} checked={d.required} onChange={(required) => set({ required })} />

          {isScored(d.type) && (
            <Field label="Weight" htmlFor="q-weight" info="How much this counts in the score, among the questions of this questionnaire.">
              <input
                id="q-weight" type="number" min={WEIGHT.min} max={WEIGHT.max} step={WEIGHT.step} value={Number.isFinite(d.weight) ? d.weight : ''}
                onChange={(e) => set({ weight: e.target.value === '' ? NaN : Number(e.target.value) })} className={INPUT}
              />
            </Field>
          )}

          {d.type !== 'file' && (
            <div className="space-y-2">
              <p className="text-[13px] font-medium leading-5 text-[#26323d]">Evidence</p>
              <SegmentedControl<EvidenceMode>
                ariaLabel="Evidence"
                value={d.evidence}
                onChange={(evidence) => set({ evidence })}
                options={[{ value: 'none', label: 'None' }, { value: 'optional', label: 'Optional' }, { value: 'required', label: 'Required' }]}
              />
              {d.evidence === 'required' && isChoice(d.type) && (
                <fieldset className="rounded-lg border border-[#d5dbe1] p-2.5">
                  <legend className="px-1 text-[12px] text-[#64707e]">Needed when the answer is</legend>
                  <div className="space-y-1.5">
                    {ownAnswers.map((a) => (
                      <Check key={a.key} checked={d.evidenceOn.includes(a.key)} onChange={(on) => set({ evidenceOn: tick(d.evidenceOn, a.key, on) })}>{a.label}</Check>
                    ))}
                  </div>
                  <p className={`mt-1.5 ${NOTE}`}>None ticked means any answer.</p>
                </fieldset>
              )}
            </div>
          )}

          <Field label="Risk domain" htmlFor="q-domain" info="Findings and scores are grouped by it. Without a section, it also sorts the question.">
            <select id="q-domain" value={d.domain} onChange={(e) => set({ domain: e.target.value })} className={INPUT}>
              <option value="">Not set</option>
              {d.domain && !DOMAIN_KEYS.includes(d.domain) && <option value={d.domain}>{d.domain}</option>}
              {DOMAIN_KEYS.map((k) => <option key={k} value={k}>{DOMAIN_LABELS[k]}</option>)}
            </select>
          </Field>

          {isScored(d.type) && (
            <ToggleRow label="Critical control" note="A gap raises a critical finding, which blocks approval" checked={d.critical} onChange={(critical) => set({ critical })} />
          )}
          {d.type === 'yes_no' && (
            <ToggleRow label="A certificate can answer this" note="A current SOC 2 or ISO 27001 certificate on file" checked={d.certificate} onChange={(certificate) => set({ certificate })} />
          )}

          <div className="space-y-2">
            <Field label="Show this question" htmlFor="q-show">
              <select
                id="q-show" value={d.showIfQuestion} className={INPUT}
                onChange={(e) => set({ showIfQuestion: e.target.value, showIfAnswers: [] })}
              >
                <option value="">Always</option>
                {parents.map((p) => {
                  const n = questions.indexOf(p) + 1;
                  return <option key={p.id} value={p.id}>{`Only if Q${n}: ${p.text.length > 42 ? `${p.text.slice(0, 42)}…` : p.text}`}</option>;
                })}
              </select>
            </Field>
            {parent && (
              <fieldset className="rounded-lg border border-[#d5dbe1] p-2.5">
                <legend className="px-1 text-[12px] text-[#64707e]">is answered with</legend>
                <div className="space-y-1.5">
                  {answerValues(parent).map((v) => (
                    <Check key={v} checked={d.showIfAnswers.includes(v)} onChange={(on) => set({ showIfAnswers: tick(d.showIfAnswers, v, on) })}>{answerLabel(parent, v)}</Check>
                  ))}
                </div>
              </fieldset>
            )}
          </div>

          {isChoice(d.type) && sends.length > 0 && (
            <div className="space-y-2">
              <Field label="Follow up" htmlFor="q-follow" info="Accepting the answers sends the supplier another questionnaire, once, when the question is answered this way.">
                <select
                  id="q-follow" value={d.followTemplate ?? ''} className={INPUT}
                  onChange={(e) => set({ followTemplate: e.target.value ? Number(e.target.value) : null, followWhen: e.target.value ? d.followWhen : [] })}
                >
                  <option value="">Never</option>
                  {d.followTemplate !== null && !sends.some((t) => t.id === d.followTemplate) && <option value={d.followTemplate}>Questionnaire #{d.followTemplate} (archived)</option>}
                  {sends.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </Field>
              {d.followTemplate !== null && (
                <fieldset className="rounded-lg border border-[#d5dbe1] p-2.5">
                  <legend className="px-1 text-[12px] text-[#64707e]">when answered with</legend>
                  <div className="space-y-1.5">
                    {ownAnswers.map((a) => (
                      <Check key={a.key} checked={d.followWhen.includes(a.key)} onChange={(on) => set({ followWhen: tick(d.followWhen, a.key, on) })}>{a.label}</Check>
                    ))}
                  </div>
                </fieldset>
              )}
            </div>
          )}
        </div>
      </div>
    </RightSlidePanel>
  );
}
