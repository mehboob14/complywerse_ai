'use client';

// The answer of one question, in two forms: the controls an assessor types into (EditAnswer) and the same answer as words for everyone who may only read it (ReadAnswer). Which control a
// question gets follows its type, as the old form did: a risk rating is a likelihood and an impact (1 to 5) with the score they make, a control rating is four choices, a yes or no is two,
// a multiple choice is its options and a text is a text. Controls are named for a screen reader by the question they answer; targets are 44px on a phone (the kit's controls do that).
import { StatusPill, SegmentedControl, Select, Textarea } from '@/components/ui/ds';
import { statusPill } from '@/lib/status';
import { effectiveness } from '@/lib/statuses/rcsa';
import { ratingScore, type Answer, type Question } from '@/lib/rcsa/answers';
import { BAND_LABEL, BAND_TONE, riskBand } from '@/lib/rcsa/scores';

const LIKELIHOOD = ['Rare', 'Unlikely', 'Possible', 'Likely', 'Almost certain'];
const IMPACT = ['Insignificant', 'Minor', 'Moderate', 'Major', 'Catastrophic'];
const EFFECT_ORDER = ['effective', 'partially_effective', 'ineffective', 'not_applicable'];

function Score({ answer }: { answer: Answer }) {
  const score = ratingScore(answer);
  const band = riskBand(score);
  if (score == null || !band) return null;
  return <StatusPill size="sm" tone={BAND_TONE[band]} label={`Score ${score} · ${BAND_LABEL[band]}`} />;
}

export function EditAnswer({ question, answer, onChange, onBlur }: { question: Question; answer: Answer; onChange: (next: Answer, wait?: number) => void; onBlur: () => void }) {
  const name = `q${question.id}`;
  const label = question.question_text.length > 80 ? `${question.question_text.slice(0, 77)}...` : question.question_text;
  switch (question.question_type) {
    case 'risk_rating':
      return (
        <div className="flex flex-wrap items-center gap-x-[8px] gap-y-[8px]">
          <Select aria-label={`Likelihood: ${label}`} placeholder="Likelihood" value={answer.likelihood ?? ''} className="w-[168px] max-w-full"
            onChange={(e) => onChange({ ...answer, likelihood: e.target.value ? Number(e.target.value) : null })}>
            {LIKELIHOOD.map((t, i) => <option key={t} value={i + 1}>{`${i + 1} · ${t}`}</option>)}
          </Select>
          <Select aria-label={`Impact: ${label}`} placeholder="Impact" value={answer.impact ?? ''} className="w-[168px] max-w-full"
            onChange={(e) => onChange({ ...answer, impact: e.target.value ? Number(e.target.value) : null })}>
            {IMPACT.map((t, i) => <option key={t} value={i + 1}>{`${i + 1} · ${t}`}</option>)}
          </Select>
          <Score answer={answer} />
        </div>
      );
    case 'control_rating':
      return (
        <SegmentedControl
          label={`Control effectiveness: ${label}`} name={name} value={answer.effectiveness ?? ''}
          options={EFFECT_ORDER.map((v) => ({ value: v, label: effectiveness.label(v) }))}
          onChange={(v) => onChange({ ...answer, effectiveness: v })}
        />
      );
    case 'yes_no':
      return (
        <SegmentedControl
          label={`Yes or no: ${label}`} name={name} value={answer.yesNo == null ? '' : answer.yesNo ? 'yes' : 'no'}
          options={[{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }]}
          onChange={(v) => onChange({ ...answer, yesNo: v === 'yes' })}
        />
      );
    case 'multiple_choice':
      return (
        <Select aria-label={`Choose one: ${label}`} placeholder="Choose one" value={answer.text ?? ''} className="w-[260px] max-w-full" onChange={(e) => onChange({ ...answer, text: e.target.value || null })}>
          {(question.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
        </Select>
      );
    default:
      return (
        <Textarea
          aria-label={`Answer: ${label}`} rows={2} maxLength={4000} value={answer.text ?? ''} placeholder="Type your answer"
          onChange={(e) => onChange({ ...answer, text: e.target.value }, 1000)} onBlur={onBlur}
        />
      );
  }
}

export function ReadAnswer({ question, answer }: { question: Question; answer: Answer | undefined }) {
  const none = <span className="text-ds-body text-ds-fg-muted">Not answered</span>;
  if (!answer) return none;
  switch (question.question_type) {
    case 'risk_rating': {
      if (!answer.likelihood && !answer.impact) return none;
      return (
        <div className="flex flex-wrap items-center gap-x-[12px] gap-y-[4px] text-ds-body text-ds-fg">
          <span>{answer.likelihood ? `Likelihood ${answer.likelihood} · ${LIKELIHOOD[answer.likelihood - 1] ?? ''}` : 'Likelihood not set'}</span>
          <span>{answer.impact ? `Impact ${answer.impact} · ${IMPACT[answer.impact - 1] ?? ''}` : 'Impact not set'}</span>
          <Score answer={answer} />
        </div>
      );
    }
    case 'control_rating': {
      if (!answer.effectiveness) return none;
      const pill = statusPill(effectiveness, answer.effectiveness);
      return <StatusPill tone={pill.tone} label={pill.label} />;
    }
    case 'yes_no':
      return answer.yesNo == null ? none : <span className="text-ds-body font-[500] text-ds-fg">{answer.yesNo ? 'Yes' : 'No'}</span>;
    default:
      return answer.text && answer.text.trim() ? <p className="whitespace-pre-line break-words text-ds-body text-ds-fg [overflow-wrap:anywhere]">{answer.text}</p> : none;
  }
}
