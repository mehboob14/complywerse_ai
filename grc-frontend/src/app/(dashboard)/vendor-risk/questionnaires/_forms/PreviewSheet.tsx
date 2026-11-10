'use client';

// The questionnaire as the person answering it sees it, with follow-up questions opening as answers are picked. Nothing is saved and nothing here shows a score: that is for the people reading the
// answers. A sheet over the Library or the builder, so a questionnaire can be tried without leaving the page.
import { useState } from 'react';
import { Upload } from 'lucide-react';
import { Button, Sheet, Textarea } from '@/components/ui/ds';
import {
  answerLabel, evidenceOf, evidenceOnOf, optFlag, optLabel, optValue, sectionKey, sectionName, visibleIds, YES_NO,
} from '../../_lib/questionnaires/model';
import type { Question } from '../../_lib/questionnaires/types';

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

export function PreviewSheet({ open, name, questions, onClose }: { open: boolean; name: string; questions: Question[]; onClose: () => void }) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const shown = visibleIds(questions, answers);
  const asked = questions.filter((q) => shown.has(q.id));
  const set = (id: string, value: string) => setAnswers((now) => ({ ...now, [id]: value }));
  const close = () => { setAnswers({}); onClose(); };

  return (
    <Sheet
      open={open}
      onClose={close}
      title="Preview as the supplier sees it"
      subtitle={name}
      width="lg"
      footer={(
        <div className="flex flex-wrap items-center gap-[8px]">
          <span className="mr-auto text-ds-body text-ds-fg-muted">{asked.length} of {questions.length} questions showing</span>
          <Button onClick={() => setAnswers({})}>Clear answers</Button>
          <Button variant="primary" onClick={close}>Close</Button>
        </div>
      )}
    >
      <div className="flex flex-col gap-[24px]">
        {asked.map((q, i) => {
          const prev = asked[i - 1];
          const answer = answers[q.id] || '';
          return (
            <div key={q.id}>
              {(!prev || sectionKey(prev) !== sectionKey(q)) && (
                <h3 className="mb-[12px] border-b border-ds-border pb-[6px] !text-ds-section !font-[600] !text-ds-fg">{sectionName(q)}</h3>
              )}
              <p className="text-ds-body font-[600] text-ds-fg">
                {q.text}
                {!q.required && <span className="ml-[6px] text-ds-label font-normal text-ds-fg-muted">Optional</span>}
              </p>
              {q.help && <p className="mt-[2px] text-ds-body text-ds-fg-muted">{q.help}</p>}
              <div className="mt-[8px]">
                {q.type === 'file' ? (
                  <span className="inline-flex min-h-ds-control items-center gap-[8px] rounded-ds-control border border-dashed border-ds-border-strong px-[12px] text-ds-body text-ds-fg-muted">
                    <Upload aria-hidden className="h-[16px] w-[16px]" /> The supplier uploads a document here
                  </span>
                ) : q.type === 'text' ? (
                  <Textarea rows={2} aria-label={q.text} value={answer} onChange={(e) => set(q.id, e.target.value)} />
                ) : (
                  <div role="radiogroup" aria-label={q.text} className="flex flex-wrap gap-[8px]">
                    {choices(q).map((c) => (
                      <label key={c.value} className="flex min-h-ds-control cursor-pointer items-center rounded-ds-control border border-ds-border-strong bg-ds-surface px-[12px] text-ds-body text-ds-fg-body hover:bg-ds-surface-hover has-[:checked]:border-ds-primary has-[:checked]:bg-ds-primary-soft has-[:checked]:text-ds-primary-text has-[:focus-visible]:shadow-ds-ring">
                        <input type="radio" name={`preview-${q.id}`} value={c.value} checked={answer === c.value} onChange={() => set(q.id, c.value)} className="sr-only" />
                        {c.label}
                      </label>
                    ))}
                  </div>
                )}
              </div>
              {q.type !== 'file' && asks(q, answer).map((line) => <p key={line} className="mt-[6px] text-ds-label text-ds-fg-muted">{line}</p>)}
            </div>
          );
        })}
        {asked.length === 0 && <p className="text-ds-body text-ds-fg-muted">No questions yet.</p>}
      </div>
    </Sheet>
  );
}
