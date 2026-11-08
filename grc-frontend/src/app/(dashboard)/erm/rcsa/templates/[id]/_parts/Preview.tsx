'use client';

// The preview of a questionnaire: the questions as the assessor sees them, with the real answer controls of the assessment form (EditAnswer), so what is built here is what is answered
// there. The answers typed into it live in this component only and are thrown away with the page; the note on top says so. It follows the draft: change a question and the preview changes.
import { useState } from 'react';
import { EditAnswer } from '../../../assessments/[id]/_parts/AnswerCell';
import type { Answer } from '@/lib/rcsa/answers';
import { previewQuestion, sectionLabel, type Draft } from '@/lib/rcsa/templatesModel';

export function Preview({ draft }: { draft: Draft }) {
  const [answers, setAnswers] = useState<Record<number, Answer>>({});
  let n = 0;
  return (
    <div className="flex min-w-0 flex-col gap-[12px]">
      <p className="text-ds-label text-ds-fg-muted">What the assessor sees. Answers you try here are not saved.</p>
      {draft.every((s) => s.questions.length === 0) ? (
        <p className="rounded-ds-card border border-dashed border-ds-border-strong px-[16px] py-[24px] text-center text-ds-body text-ds-fg-muted">The questions you add appear here.</p>
      ) : draft.map((s) => s.questions.length === 0 ? null : (
        <section key={s.key} aria-label={sectionLabel(s.name)} className="min-w-0 rounded-ds-card border border-ds-border bg-ds-surface">
          {s.name !== '' && <h3 className="border-b border-ds-border px-[12px] py-[6px] break-words !text-ds-body !font-[600] !text-ds-fg">{s.name}</h3>}
          <ol className="m-0 list-none px-[12px] py-0">
            {s.questions.map((q) => {
              n += 1;
              const question = previewQuestion(q, n);
              const answer = answers[question.id] ?? {};
              return (
                <li key={q.key} className="flex min-w-0 flex-col gap-[6px] border-t border-ds-border py-[10px] first:border-t-0">
                  <span dir="auto" className="text-ds-body font-[500] text-ds-fg [overflow-wrap:anywhere]">
                    <span className="mr-[6px] tabular-nums text-ds-fg-muted">{n}.</span>{question.question_text}
                    {q.required && <span aria-hidden className="ml-[4px] text-ds-danger">*</span>}
                    {q.required && <span className="sr-only"> (required)</span>}
                  </span>
                  {question.guidance && <span className="text-ds-label text-ds-fg-muted [overflow-wrap:anywhere]">{question.guidance}</span>}
                  <EditAnswer question={question} answer={answer} onChange={(next) => setAnswers({ ...answers, [question.id]: next })} onBlur={() => undefined} />
                </li>
              );
            })}
          </ol>
        </section>
      ))}
    </div>
  );
}
