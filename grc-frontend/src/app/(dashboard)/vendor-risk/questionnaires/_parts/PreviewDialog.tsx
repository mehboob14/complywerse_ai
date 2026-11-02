'use client';

// The questionnaire as the person answering it sees it, with follow-up questions opening as answers are picked. Nothing is saved
// and nothing here shows a score: that is for the people reading the answers.
import { useState } from 'react';
import { Upload } from 'lucide-react';
import { Dialog, BTN } from '@/app/(dashboard)/vendor-risk/_ui';
import {
  answerLabel, evidenceOf, evidenceOnOf, optFlag, optLabel, optValue, sectionKey, sectionName, visibleIds, YES_NO,
} from '../../_lib/questionnaires/model';
import type { Question } from '../../_lib/questionnaires/types';
import { AREA } from './ui';

const NOT_APPLICABLE = { value: 'n-a', label: 'Not applicable' };

function choices(q: Question): Array<{ value: string; label: string }> {
  if (q.type === 'yes_no') return [...YES_NO, NOT_APPLICABLE];
  if (q.type === 'rating') return [1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: String(n) }));
  return (q.options || []).map((o) => ({ value: optValue(o), label: optLabel(o) }));
}

/** What an answer asks of the person: a note, a reason, a document. */
function asks(q: Question, answer: string): string[] {
  const out: string[] = [];
  const picked = (q.options || []).find((o) => optValue(o) === answer);
  if (q.type === 'yes_no' && answer === NOT_APPLICABLE.value) out.push('Not applicable asks for a reason.');
  else if (picked && optFlag(picked, 'na')) out.push('Not applicable asks for a reason.');
  else if (picked && optFlag(picked, 'comment_required')) out.push('This answer asks for a note.');
  if (q.type !== 'file' && evidenceOf(q) === 'required') {
    const on = evidenceOnOf(q);
    if (!answer || on.length === 0 || on.includes(answer)) {
      out.push(on.length && !answer ? `Asks for a supporting document when the answer is ${on.map((v) => answerLabel(q, v)).join(' or ')}.` : 'Asks for a supporting document.');
    }
  } else if (q.type !== 'file' && evidenceOf(q) === 'optional') {
    out.push('A document can be attached.');
  }
  return out;
}

export function PreviewDialog({ open, name, questions, onClose }: {
  open: boolean; name: string; questions: Question[]; onClose: () => void;
}) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const shown = visibleIds(questions, answers);
  const asked = questions.filter((q) => shown.has(q.id));
  const set = (id: string, value: string) => setAnswers((now) => ({ ...now, [id]: value }));
  const close = () => { setAnswers({}); onClose(); };

  return (
    <Dialog
      open={open}
      onClose={close}
      title="Preview"
      description={name}
      size={720}
      footer={(
        <>
          <span className="mr-auto text-[13px] text-[#586472]">{asked.length} of {questions.length} questions showing</span>
          <button type="button" onClick={() => setAnswers({})} className={BTN}>Clear answers</button>
          <button type="button" onClick={close} className={BTN}>Close</button>
        </>
      )}
    >
      <div className="space-y-6">
        {asked.map((q, i) => {
          const prev = asked[i - 1];
          const answer = answers[q.id] || '';
          return (
            <div key={q.id}>
              {(!prev || sectionKey(prev) !== sectionKey(q)) && (
                <h3 className="mb-3 border-b border-[#e1e6eb] pb-1.5 text-[14px] font-semibold text-[#1f2933]">{sectionName(q)}</h3>
              )}
              <p className="text-sm font-medium leading-5 text-[#1f2933]">
                {q.text}
                {!q.required && <span className="ml-1.5 text-[12px] font-normal text-[#64707e]">Optional</span>}
              </p>
              {q.help && <p className="mt-0.5 text-[13px] leading-5 text-[#586472]">{q.help}</p>}
              <div className="mt-2">
                {q.type === 'file' ? (
                  <span className="inline-flex items-center gap-2 rounded-lg border border-dashed border-[#c3ccd5] px-3 py-2 text-[13px] text-[#586472]">
                    <Upload aria-hidden className="h-4 w-4" /> The supplier uploads a document here
                  </span>
                ) : q.type === 'text' ? (
                  <textarea rows={2} aria-label={q.text} value={answer} onChange={(e) => set(q.id, e.target.value)} className={AREA} />
                ) : (
                  <div role="radiogroup" aria-label={q.text} className="flex flex-wrap gap-2">
                    {choices(q).map((c) => (
                      <label key={c.value} className="flex cursor-pointer items-center gap-2 rounded-lg border border-[#c3ccd5] bg-[#fff] px-3 py-1.5 text-sm text-[#26323d] hover:bg-[#f3f6f8] has-[:checked]:border-[#0f766e] has-[:checked]:bg-[#f0fdfa] has-[:checked]:text-[#0f766e] has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-[#0f766e]">
                        <input type="radio" name={`preview-${q.id}`} value={c.value} checked={answer === c.value} onChange={() => set(q.id, c.value)} className="sr-only" />
                        {c.label}
                      </label>
                    ))}
                  </div>
                )}
              </div>
              {q.type !== 'file' && asks(q, answer).map((line) => (
                <p key={line} className="mt-1.5 text-[12px] leading-4 text-[#64707e]">{line}</p>
              ))}
            </div>
          );
        })}
        {asked.length === 0 && <p className="text-sm text-[#586472]">No questions yet.</p>}
      </div>
    </Dialog>
  );
}
