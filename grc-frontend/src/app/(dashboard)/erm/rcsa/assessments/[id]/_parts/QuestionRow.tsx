'use client';

// One question of the form as a row: what is asked (with its guidance and why a reviewer should look first), the answer, and the evidence. From 1024px the three are columns; below it
// they stack, one column, so nothing needs a sideways scroll on a phone. Editing is only offered while the unit can be edited; otherwise the answer is words. A required question that is
// still empty after a submit attempt says so beside it. "Raise a finding" is offered to the people who may (the assessor while answering, the reviewer while deciding, the risk team).
import { AlertTriangle, Flag } from 'lucide-react';
import { Button, ClampedText, StatusPill } from '@/components/ui/ds';
import type { Answer, Question } from '@/lib/rcsa/answers';
import { AiIdeas } from './AiIdeas';
import { EditAnswer, ReadAnswer } from './AnswerCell';
import { EvidenceCell, type EvidenceFile } from './EvidenceCell';

export interface QuestionRowProps {
  assessmentId: number;
  question: Question;
  number: number;
  answer: Answer | undefined;
  editable: boolean;
  onChange: (next: Answer, wait?: number) => void;
  onBlur: () => void;
  evidence: EvidenceFile[];
  onEvidence: (next: EvidenceFile[]) => void;
  /** why the reviewer looks at it first */
  look: string | null;
  /** this required question is empty and the person tried to submit */
  missing: boolean;
  canRaise: boolean;
  onRaise: () => void;
}

export function QuestionRow({ assessmentId, question, number, answer, editable, onChange, onBlur, evidence, onEvidence, look, missing, canRaise, onRaise }: QuestionRowProps) {
  const label = question.question_text;
  return (
    <li id={`q-${question.id}`} className="grid scroll-mt-[64px] gap-x-[16px] gap-y-[8px] border-t border-ds-border px-[12px] py-[12px] first:border-t-0 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)_minmax(0,4fr)]">
      <div className="min-w-0">
        <p className="text-ds-body font-[500] text-ds-fg [overflow-wrap:anywhere]">
          <span className="mr-[6px] tabular-nums text-ds-fg-muted">{number}.</span>
          {label}
          {question.is_required && <span className="ml-[4px] text-ds-danger" title="Required"><span aria-hidden>*</span><span className="sr-only"> (required)</span></span>}
        </p>
        {question.guidance && <ClampedText text={question.guidance} lines={2} className="mt-[4px]" />}
        <div className="mt-[4px] flex flex-wrap items-center gap-[8px]">
          {look && <StatusPill size="sm" tone="warning" label={look} />}
          {missing && (
            <span role="alert" className="inline-flex items-center gap-[4px] text-ds-label font-[600] text-ds-danger">
              <AlertTriangle aria-hidden className="h-[14px] w-[14px]" strokeWidth={2} />
              Answer this question
            </span>
          )}
        </div>
      </div>
      <div className="min-w-0 self-start">
        {editable ? <EditAnswer question={question} answer={answer ?? {}} onChange={onChange} onBlur={onBlur} /> : <ReadAnswer question={question} answer={answer} />}
        <div className="mt-[4px] flex flex-wrap items-center gap-x-[4px]">
          {editable && question.ai_suggestion_enabled && <AiIdeas assessmentId={assessmentId} questionId={question.id} label={label} />}
          {canRaise && <Button size="sm" variant="ghost" leftIcon={<Flag aria-hidden />} aria-label={`Raise a finding about: ${label}`} onClick={onRaise}>Raise a finding</Button>}
        </div>
      </div>
      <div className="min-w-0 self-start">
        <EvidenceCell assessmentId={assessmentId} questionId={question.id} questionLabel={label} files={evidence} editable={editable} onChange={onEvidence} />
      </div>
    </li>
  );
}
